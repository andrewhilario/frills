// The one gate every Frills Plus feature goes through: "does this request come from an account that has Plus right now, in an allowed region, with credits left?" Free features never call it.
// A feature asks `plusGate(...)`, then takes what it will use with `spendCharacters(...)` BEFORE doing its work, and puts it back with `giveBackCharacters(...)` if the work fails. Anything it refuses is answered with the same few codes the editor already
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
  const region = checkProRegion(request, env);
  if (!region.eligible) return refuse(403, "region_unavailable", { country: region.country });
  if (who.plus.tts_used >= who.plus.tts_limit) return refuse(402, "quota_exceeded", { limit: who.plus.tts_limit });
  return { present: true, ok: true, kind: who.kind, accountId: who.accountId, plus: who.plus };
}

/**
 * Takes `amount` characters from the account's month, in one step that also checks there is something left (so many requests at once cannot all pass the check and then all spend). The allowance is
 * counted in CHARACTERS of the words spoken, because that is what the voice companies charge for. A line that is longer than what is left is still allowed (the month then reads "all used", never
 * more than the limit), so at most one line goes over; with nothing left it is refused. Returns { ok: true, used, limit, remaining, spent }, or { ok: false, limit } when nothing was left.
 */
export async function spendCharacters(db, plus, amount) {
  const n = Math.max(1, Math.floor(Number(amount) || 1));
  const done = await db.prepare("UPDATE plus SET tts_used = MIN(tts_used + ?, tts_limit) WHERE account_id = ? AND tts_used < tts_limit").bind(n, plus.account_id).run();
  const row = await db.prepare("SELECT tts_used, tts_limit FROM plus WHERE account_id = ?").bind(plus.account_id).first();
  if (!done?.meta?.changes) return { ok: false, limit: row?.tts_limit ?? plus.tts_limit };
  return { ok: true, used: row.tts_used, limit: row.tts_limit, remaining: Math.max(0, row.tts_limit - row.tts_used), spent: n };
}

/** Puts characters back (the voice could not be made, so the account should not pay for it). Never goes below nothing used. */
export async function giveBackCharacters(db, plus, amount) {
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  if (n) await db.prepare("UPDATE plus SET tts_used = MAX(0, tts_used - ?) WHERE account_id = ?").bind(n, plus.account_id).run();
}
