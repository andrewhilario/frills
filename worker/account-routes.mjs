// The web side of Frills Plus accounts (storage rules are in accounts.mjs): ask for a sign-in link, use it, see who is signed in, sign out.
//   POST /api/account/login   { email }   -> emails a link. The answer is the same whether or not the address has an account.
//   POST /api/account/verify  { token }   -> uses the link's token, starts a session, sets the cookie.
//   GET  /api/account/me                  -> who is signed in (and what they bought), or signedIn: false.
//   POST /api/account/logout              -> ends this browser's session.
// The link in the email points at a page (/account/verify/#token) and the token sits after the #, which a browser never sends to a server. The page then asks the person
// to press "Sign in", so an email scanner that opens every link in a message cannot spend the one-use token before the person gets to it.
// Every change needs the request to come from this site itself (the Origin header), and the cookie is HttpOnly, SameSite=Lax, and Secure on the real site.

import { LIMITS, createLoginLink, endSession, getPlus, normalizeEmail, sessionAccount, sweep, useLoginLink } from "./accounts.mjs";
import { getMailer, signInMessage } from "./mailer.mjs";

export const COOKIE = "frills_session";
const MAX_BODY = 512;

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra } });
const sameOrigin = (request) => {
  const origin = request.headers.get("origin");
  return Boolean(origin) && origin === new URL(request.url).origin;
};
const cookieOf = (request, name) => {
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

export async function handleAccount(request, env, { now = Date.now(), mailer = null } = {}) {
  const url = new URL(request.url);
  const action = url.pathname.split("/").filter(Boolean)[2] ?? "";
  if (!["login", "verify", "me", "logout"].includes(action)) return json(404, { ok: false, error: "not_found" });
  const wanted = action === "me" ? "GET" : "POST";
  if (request.method !== wanted) return json(405, { ok: false, error: "method" }, { allow: wanted });
  if (!env?.DB) return json(503, { ok: false, error: "not_ready" });
  const db = env.DB;

  try {
    if (action === "me") {
      const who = await sessionAccount(db, cookieOf(request, COOKIE), { now });
      if (!who) return json(200, { ok: true, signedIn: false });
      const plus = await getPlus(db, who.accountId);
      return json(200, {
        ok: true,
        signedIn: true,
        email: who.email,
        plus: plus ? { status: plus.status, renewsAt: plus.renews_at, used: plus.tts_used, limit: plus.tts_limit } : null,
      });
    }

    if (!sameOrigin(request)) return json(403, { ok: false, error: "wrong_origin" });

    if (action === "logout") {
      await endSession(db, cookieOf(request, COOKIE));
      return json(200, { ok: true }, { "set-cookie": setCookie(env, "", 0) });
    }

    const { body, tooBig } = await readBody(request);
    if (tooBig) return json(413, { ok: false, error: "too_big" });
    if (!body) return json(400, { ok: false, error: "bad_data" });

    if (action === "login") {
      const email = normalizeEmail(body.email);
      if (!email) return json(400, { ok: false, error: "bad_email" });
      const sender = getMailer(env, mailer);
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
    const used = await useLoginLink(db, typeof body.token === "string" ? body.token : "", { now });
    if (!used.ok) return json(used.error === "full" ? 503 : 400, { ok: false, error: used.error });
    return json(200, { ok: true, email: used.email, created: used.created }, { "set-cookie": setCookie(env, used.sessionToken, Math.floor(LIMITS.sessionMs / 1000)) });
  } catch {
    return json(500, { ok: false, error: "server" });
  }
}
