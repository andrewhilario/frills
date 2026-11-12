// The one gate every Frills Plus feature goes through: "does this request come from an account that has Plus right now, in an allowed region, with credits left?" Free features never call it.
// A feature asks `plusGate(...)`, does its work only if `ok`, and then calls `spendCredit(...)` for what it used. Anything it refuses is answered with the same few codes the editor already
// understands, so a refusal always falls back to the free voice and never breaks the free overlay:
//   no_pass            nothing was brought (a free visitor)                               401
//   invalid_pass       a code that is not live, an account with no Plus, or Plus has ended   401
//   region_unavailable the request comes from a region Plus is not sold in                  403
//   quota_exceeded     this month's credits are used up                                    402

import { checkProRegion } from "./region.mjs";
import { plusActive } from "./accounts.mjs";
import { resolveCredential } from "./plus-credential.mjs";

const refuse = (status, error, extra = {}) => ({ present: true, ok: false, status, error, ...extra });

/**
 * Asks the gate. Returns:
 *   { present: false }                                    nothing was brought (the caller decides: a free visitor is refused; a local development server may allow it)
 *   { present: true, ok: false, status, error, ... }      refused, with the code above
 *   { present: true, ok: true, kind, accountId, plus }    allowed
 * `overlayCode` is a code the caller found in the request body (a header is read here).
 */
export async function plusGate(request, env, { now = Date.now(), overlayCode = "" } = {}) {
  const who = await resolveCredential(request, env, { now, overlayCode });
  if (who.kind === "none") return { present: false };
  if (who.kind === "invalid") return refuse(401, "invalid_pass");
  if (!plusActive(who.plus, now)) return refuse(401, "invalid_pass");
  const region = checkProRegion(request, env, { allowRoam: false, passToken: "" });
  if (!region.eligible) return refuse(403, "region_unavailable", { country: region.country });
  if (who.plus.tts_used >= who.plus.tts_limit) return refuse(402, "quota_exceeded", { limit: who.plus.tts_limit });
  return { present: true, ok: true, kind: who.kind, accountId: who.accountId, plus: who.plus };
}

/** Takes one credit from the account's month. Returns what the answer should say about the rest: { used, limit, remaining }. */
export async function spendCredit(db, plus) {
  await db.prepare("UPDATE plus SET tts_used = tts_used + 1 WHERE account_id = ?").bind(plus.account_id).run();
  const used = plus.tts_used + 1;
  return { used, limit: plus.tts_limit, remaining: Math.max(0, plus.tts_limit - used) };
}
