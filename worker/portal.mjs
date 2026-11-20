// The link to Lemon Squeezy's billing page for a person's subscription, where they change their card, see receipts, and cancel. Lemon Squeezy makes a signed link for each
// subscription (urls.customer_portal) that works for 24 hours, so it is asked for fresh each time the person presses "Manage or cancel", never saved.
// Two ways to get a link, in this order:
//   1. env.LEMON_API_KEY: ask Lemon Squeezy's API for this subscription's signed link.
//   2. env.LEMON_PORTAL_URL: the store's own billing page (https://<store>.lemonsqueezy.com/billing), where the person signs in at Lemon Squeezy with their email.
// A link is passed on only if it is https on lemonsqueezy.com (plain http to this computer only on a local development server).

const API = "https://api.lemonsqueezy.com/v1/subscriptions/";

/** The link if it is acceptable, otherwise null. */
export function acceptablePortalUrl(raw, dev = false) {
  let url;
  try { url = new URL(String(raw ?? "").trim()); } catch { return null; }
  if (url.username || url.password) return null;
  const lemon = url.protocol === "https:" && (url.hostname === "lemonsqueezy.com" || url.hostname.endsWith(".lemonsqueezy.com"));
  const local = dev && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  return lemon || local ? url.toString() : null;
}

/** Whether a billing link can be made at all (so the page knows whether to offer the button). */
export const portalReady = (env) => Boolean(env?.LEMON_API_KEY) || acceptablePortalUrl(env?.LEMON_PORTAL_URL, Boolean(env?.DEV)) !== null;

/** A fresh billing link for a subscription: { ok: true, url } or { ok: false, error: "portal_off" | "provider_error" }. */
export async function portalLink(env, providerRef, fetchFn = globalThis.fetch) {
  const dev = Boolean(env?.DEV);
  const fallback = acceptablePortalUrl(env?.LEMON_PORTAL_URL, dev);
  if (env?.LEMON_API_KEY) {
    if (!/^\d{1,20}$/.test(String(providerRef ?? ""))) return fallback ? { ok: true, url: fallback } : { ok: false, error: "provider_error" }; // (a subscription id that is not a number never reaches the address)
    try {
      const res = await fetchFn(API + providerRef, { headers: { accept: "application/vnd.api+json", authorization: `Bearer ${env.LEMON_API_KEY}` }, signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const body = await res.json().catch(() => null);
        const signed = acceptablePortalUrl(body?.data?.attributes?.urls?.customer_portal, dev);
        if (signed) return { ok: true, url: signed };
      }
    } catch { /* fall through to the store's billing page, if there is one */ }
    return fallback ? { ok: true, url: fallback } : { ok: false, error: "provider_error" };
  }
  return fallback ? { ok: true, url: fallback } : { ok: false, error: "portal_off" };
}
