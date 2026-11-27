// Who is asking for a Frills Plus feature, worked out from what they brought. Two things can speak for an account:
//   - "overlay": the code in an overlay link (made on the account page or the talking pet page; see overlay-links.mjs). This is how a streaming app, where nobody is signed in, asks.
//   - "session": the signed-in cookie (see accounts.mjs). This is how the website's own editor asks, for a preview, without making a link first.
// This file only says WHO. Whether they may have the feature is decided in plus-gate.mjs. Nothing here reads a payment key.

import { COOKIE, cookieOf } from "./account-routes.mjs";
import { getPlus, sessionAccount } from "./accounts.mjs";
import { accountForOverlayCode } from "./overlay-links.mjs";

/**
 * Returns one of:
 *   { kind: "overlay" | "session", accountId, plus }   a live credential (`plus` is what the account bought: a row, possibly ended, or null)
 *   { kind: "invalid" }                                an overlay code was sent but it is not live (never made, replaced, turned off, or the account is gone)
 *   { kind: "none" }                                   nothing usable was sent (no code, no signed-in cookie, a stale cookie, or no database)
 * A code in the request wins over a cookie, because a streaming app has no cookie and a code that is sent means the sender is that overlay.
 */
export async function resolveCredential(request, env, { now = Date.now(), overlayCode = "" } = {}) {
  const db = env?.DB;
  if (!db) return { kind: "none" };
  const code = String(overlayCode || request.headers.get("x-overlay") || "").trim();
  if (code) {
    const found = await accountForOverlayCode(db, code, "tts", now);
    return found ? { kind: "overlay", accountId: found.accountId, plus: found.plus } : { kind: "invalid" };
  }
  const who = await sessionAccount(db, cookieOf(request, COOKIE), { now });
  if (!who) return { kind: "none" };
  return { kind: "session", accountId: who.accountId, plus: await getPlus(db, who.accountId, now) };
}
