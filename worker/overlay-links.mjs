// The link behind a Frills Plus overlay (the talking pet). The overlay runs in the streamer's streaming app, where nobody is signed in, so it needs something to say which account
// it speaks for. That is a random code in the overlay link. The code is not the payment and not a password: it can only ask for spoken lines for that account, it is capped by the
// account's monthly credits, and the streamer can end it at any moment by making a new link (or turning the link off). Only the code's hash is kept here, and an account has at most
// one live link for each kind of overlay.

import { getPlus, plusActive } from "./accounts.mjs";

export const KINDS = ["tts"];
const CODE = /^[0-9a-f]{32}$/;

const sha256 = async (text) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const randomCode = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join(""); // 128 bits

/** Makes a new link code for an account, ending any earlier one of the same kind. Returns the code (the only time it exists in the clear). */
export async function makeOverlayLink(db, accountId, kind = "tts", { now = Date.now() } = {}) {
  if (!KINDS.includes(kind)) throw new Error("kind");
  const code = randomCode();
  await db.prepare("DELETE FROM overlay_links WHERE account_id = ? AND kind = ?").bind(String(accountId), kind).run();
  await db.prepare("INSERT INTO overlay_links (code_hash, account_id, kind, created_at) VALUES (?, ?, ?, ?)").bind(await sha256(code), String(accountId), kind, now).run();
  return code;
}

/** Ends an account's link of one kind (the old code stops working at once). Returns whether there was one. */
export async function endOverlayLink(db, accountId, kind = "tts") {
  const done = await db.prepare("DELETE FROM overlay_links WHERE account_id = ? AND kind = ?").bind(String(accountId), kind).run();
  return Number(done.meta?.changes ?? 0) > 0;
}

/** Whether an account has a live link of this kind. */
export async function hasOverlayLink(db, accountId, kind = "tts") {
  return Boolean(await db.prepare("SELECT 1 AS x FROM overlay_links WHERE account_id = ? AND kind = ?").bind(String(accountId), kind).first());
}

/**
 * What a link code stands for: { accountId, plus } (plus is what the account bought, possibly nothing or ended: the caller asks `plusActive`), or null for a code that is not
 * live (never made, ended by a new one, or the account was deleted).
 */
export async function accountForOverlayCode(db, code, kind = "tts", now = Date.now()) {
  const text = String(code ?? "").trim();
  if (!CODE.test(text)) return null;
  const row = await db.prepare("SELECT account_id FROM overlay_links WHERE code_hash = ? AND kind = ?").bind(await sha256(text), kind).first();
  if (!row) return null;
  return { accountId: row.account_id, plus: await getPlus(db, row.account_id, now) };
}

/** The same, but only for an account that has Plus right now: { accountId, plus } or null. */
export async function plusForOverlayCode(db, code, { now = Date.now(), kind = "tts" } = {}) {
  const found = await accountForOverlayCode(db, code, kind, now);
  return found && plusActive(found.plus, now) ? found : null;
}
