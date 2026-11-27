// The web side of Frills Plus accounts (storage rules are in accounts.mjs): ask for a sign-in link, use it, see who is signed in, sign out.
//   POST /api/account/login   { email }   -> emails a link. The answer is the same whether or not the address has an account.
//   POST /api/account/verify  { token }   -> uses the link's token, starts a session, sets the cookie.
//   GET  /api/account/me                  -> who is signed in (and what they bought), or signedIn: false.
//   POST /api/account/logout              -> ends this browser's session.
//   POST /api/account/portal              -> a fresh link to Lemon Squeezy's billing page (change card, receipts, cancel). Signed in, and only with a subscription.
//   POST /api/account/logout-all          -> ends every browser's session for this account.
//   POST /api/account/delete   { email }  -> deletes the account and what is kept about it, if the email typed is theirs and no subscription is still renewing.
//   POST /api/account/overlay-link       -> makes a new link code for the talking pet overlay (ending the old one). Signed in, with Plus on.
//   POST /api/account/overlay-link-off    -> ends the link code.
//   POST /api/account/checkout            -> the address to pay at (Lemon Squeezy), with this account's email and id in it. Signed in only.
// The link in the email points at a page (/account/verify/#token) and the token sits after the #, which a browser never sends to a server. The page then asks the person
// to press "Sign in", so an email scanner that opens every link in a message cannot spend the one-use token before the person gets to it.
// Every change needs the request to come from this site itself (the Origin header), and the cookie is HttpOnly, SameSite=Lax, and Secure on the real site.

import { LIMITS, createLoginLink, deleteAccount, endAllSessions, endSession, getPlus, hasCompPlusByEmail, isCompLoginToken, isCompPlus, normalizeEmail, plusActive, sessionAccount, sweep, useLoginLink } from "./accounts.mjs";
import { getMailer, signInMessage } from "./mailer.mjs";
import { checkoutLink, checkoutReady } from "./checkout.mjs";
import { portalLink, portalReady } from "./portal.mjs";
import { createPolarCheckout, createPolarPortal, polarCheckoutReady, polarIsSandbox, polarPortalReady } from "./polar.mjs";
import { endOverlayLink, hasOverlayLink, makeOverlayLink } from "./overlay-links.mjs";
import { checkProRegion } from "./region.mjs";

export const COOKIE = "frills_session";
const MAX_BODY = 512;

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra } });
const sameOrigin = (request) => {
  const origin = request.headers.get("origin");
  return Boolean(origin) && origin === new URL(request.url).origin;
};
export const cookieOf = (request, name) => {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return "";
};
const setCookie = (env, value, maxAgeSeconds) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${env?.DEV ? "" : "; Secure"}`;
const readBody = async (request) => {
  const text = await request.text();
  if (text.length > MAX_BODY) return { tooBig: true };
  try { const body = JSON.parse(text); return body && typeof body === "object" ? { body } : {}; } catch { return {}; }
};

const regionAllowed = (request, env) => {
  const hasCfCountry = typeof request.cf?.country === "string" && /^[A-Za-z]{2}$/.test(request.cf.country.trim());
  const hasDevSim = Boolean(env?.DEV && (request.headers.get("x-frills-country") || new URL(request.url).searchParams.get("country")));
  if (!hasCfCountry && !hasDevSim) return true;
  return checkProRegion(request, env).eligible;
};

/** While POLAR_SANDBOX=1 on real Cloudflare traffic, lock Sandbox checkout to owner IPs / dev overrides so public visitors cannot check out with test cards. */
const sandboxCheckoutBlocked = (request, env) => {
  if (!polarIsSandbox(env) || env?.DEV) return false;
  const hasCfCountry = typeof request.cf?.country === "string" && /^[A-Za-z]{2}$/.test(request.cf.country.trim());
  if (!hasCfCountry) return false;
  const { reason } = checkProRegion(request, env);
  return reason !== "allowed_ip" && reason !== "dev_override" && reason !== "local_dev";
};

export async function handleAccount(request, env, { now = Date.now(), mailer = null, fetchFn = globalThis.fetch } = {}) {
  const url = new URL(request.url);
  const action = url.pathname.split("/").filter(Boolean)[2] ?? "";
  if (!["login", "verify", "me", "logout", "checkout", "portal", "logout-all", "delete", "overlay-link", "overlay-link-off"].includes(action)) return json(404, { ok: false, error: "not_found" });
  const wanted = action === "me" ? "GET" : "POST";
  if (request.method !== wanted) return json(405, { ok: false, error: "method" }, { allow: wanted });
  if (!env?.DB) return json(503, { ok: false, error: "not_ready" });
  const db = env.DB;

  try {
    if (action === "me") {
      const who = await sessionAccount(db, cookieOf(request, COOKIE), { now });
      if (!who) return json(200, { ok: true, signedIn: false });
      const plus = await getPlus(db, who.accountId, now);
      const comp = isCompPlus(plus);
      return json(200, {
        ok: true,
        signedIn: true,
        email: who.email,
        checkout: (polarCheckoutReady(env) || checkoutReady(env.LEMON_CHECKOUT_URL, Boolean(env.DEV))) && regionAllowed(request, env) && !sandboxCheckoutBlocked(request, env),
        portal: !comp && (polarPortalReady(env) || portalReady(env)),
        overlayLink: await hasOverlayLink(db, who.accountId),
        plus: plus ? { status: plus.status, active: plusActive(plus, now), ...(comp ? { comp: true } : {}), renewsAt: plus.renews_at, used: plus.tts_used, limit: plus.tts_limit } : null,
      });
    }

    if (!sameOrigin(request)) return json(403, { ok: false, error: "wrong_origin" });

    if (action === "logout") {
      await endSession(db, cookieOf(request, COOKIE));
      return json(200, { ok: true }, { "set-cookie": setCookie(env, "", 0) });
    }

    if (action === "checkout") {
      const who = await sessionAccount(db, cookieOf(request, COOKIE), { now });
      if (!who) return json(401, { ok: false, error: "sign_in_first" });
      const plus = await getPlus(db, who.accountId);
      if (plusActive(plus, now)) return json(409, { ok: false, error: "already_plus" });
      if (!regionAllowed(request, env)) return json(403, { ok: false, error: "region_unavailable" });
      if (sandboxCheckoutBlocked(request, env)) return json(503, { ok: false, error: "checkout_off" });
      if (polarCheckoutReady(env)) {
        const site = String(env.SITE_URL ?? url.origin).replace(/\/+$/, "");
        const created = await createPolarCheckout(env, {
          email: who.email,
          accountId: who.accountId,
          successUrl: `${site}/account/?welcome=1&checkout_id={CHECKOUT_ID}`,
          returnUrl: `${site}/account/`,
        }, fetchFn);
        if (!created.ok) {
          const extra = Number.isFinite(created.providerStatus) ? { "x-provider-status": String(created.providerStatus) } : {};
          return json(created.error === "checkout_off" ? 503 : 502, { ok: false, error: created.error }, extra);
        }
        return json(200, { ok: true, url: created.url });
      }
      const link = checkoutLink(env.LEMON_CHECKOUT_URL, { email: who.email, accountId: who.accountId }, { dev: Boolean(env.DEV) });
      if (!link) return json(503, { ok: false, error: "checkout_off" });
      return json(200, { ok: true, url: link });
    }

    if (action === "portal" || action === "logout-all" || action === "delete" || action === "overlay-link" || action === "overlay-link-off") {
      const cookie = cookieOf(request, COOKIE);
      const who = await sessionAccount(db, cookie, { now });
      if (!who) return json(401, { ok: false, error: "sign_in_first" });

      if (action === "overlay-link") {
        if (!plusActive(await getPlus(db, who.accountId), now)) return json(403, { ok: false, error: "plus_required" });
        return json(200, { ok: true, code: await makeOverlayLink(db, who.accountId, "tts", { now }) });
      }
      if (action === "overlay-link-off") {
        await endOverlayLink(db, who.accountId, "tts");
        return json(200, { ok: true });
      }

      if (action === "portal") {
        const plus = await getPlus(db, who.accountId);
        if (!plus?.provider_ref) return json(404, { ok: false, error: "no_subscription" });
        const site = String(env.SITE_URL ?? url.origin).replace(/\/+$/, "");
        const link = polarPortalReady(env)
          ? await createPolarPortal(env, { accountId: who.accountId, returnUrl: `${site}/account/` }, fetchFn)
          : await portalLink(env, plus.provider_ref, fetchFn);
        if (!link.ok) {
          const extra = Number.isFinite(link.providerStatus) ? { "x-provider-status": String(link.providerStatus) } : {};
          return json(link.error === "portal_off" ? 503 : 502, { ok: false, error: link.error }, extra);
        }
        return json(200, { ok: true, url: link.url });
      }

      if (action === "logout-all") {
        await endAllSessions(db, who.accountId);
        return json(200, { ok: true }, { "set-cookie": setCookie(env, "", 0) });
      }

      // delete: the person types their own email to confirm, and a subscription that is still renewing must be cancelled first (deleting would not stop the charge)
      const { body: asked, tooBig: big } = await readBody(request);
      if (big) return json(413, { ok: false, error: "too_big" });
      if (!asked || normalizeEmail(asked.email) !== who.email) return json(400, { ok: false, error: "confirm_mismatch" });
      const plus = await getPlus(db, who.accountId, now);
      if (plus?.status === "active" && !isCompPlus(plus) && plusActive(plus, now)) return json(409, { ok: false, error: "cancel_first" });
      await deleteAccount(db, who.accountId);
      return json(200, { ok: true }, { "set-cookie": setCookie(env, "", 0) });
    }

    const { body, tooBig } = await readBody(request);
    if (tooBig) return json(413, { ok: false, error: "too_big" });
    if (!body) return json(400, { ok: false, error: "bad_data" });

    if (action === "login") {
      const email = normalizeEmail(body.email);
      if (!regionAllowed(request, env) && !(email && (await hasCompPlusByEmail(db, email, now)))) {
        return json(403, { ok: false, error: "region_unavailable" });
      }
      if (!email) return json(400, { ok: false, error: "bad_email" });
      const sender = getMailer(env, mailer, { fetchFn });
      if (!sender) return json(503, { ok: false, error: "email_off" });
      await sweep(db, { now });
      const link = await createLoginLink(db, email, { now, ip: request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "", salt: env.ACCOUNT_SALT ?? "" });
      if (!link.ok) return json(link.error === "rate_limited" ? 429 : 400, { ok: false, error: link.error });
      const site = String(env.SITE_URL ?? url.origin).replace(/\/+$/, "");
      let sent;
      try { sent = await sender.send(signInMessage(link.email, `${site}/account/verify/#${link.token}`)); } catch { sent = { ok: false }; }
      if (!sent?.ok) return json(502, { ok: false, error: "mail_failed" });
      return json(200, { ok: true, minutes: LIMITS.linkMs / 60000 }); // the same for an address that has an account and one that has not
    }

    // verify
    const verifyToken = typeof body.token === "string" ? body.token : "";
    if (!regionAllowed(request, env) && !(await isCompLoginToken(db, verifyToken, now))) {
      return json(403, { ok: false, error: "region_unavailable" });
    }
    const used = await useLoginLink(db, verifyToken, { now });
    if (!used.ok) return json(used.error === "full" ? 503 : 400, { ok: false, error: used.error });
    return json(200, { ok: true, email: used.email, created: used.created }, { "set-cookie": setCookie(env, used.sessionToken, Math.floor(LIMITS.sessionMs / 1000)) });
  } catch {
    return json(500, { ok: false, error: "server" });
  }
}
