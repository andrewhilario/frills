// Frills Plus accounts: the storage rules, with no web address and no email in it (those come in later steps). An account is an email address and nothing else.
// A person signs in with a link sent to their inbox; there is no password to leak. Three secrets exist, and none is ever stored as it was given:
//   - the sign-in link's token (works once, for 15 minutes),
//   - the session cookie's value (30 days),
// each is kept only as its sha-256 hash, so a copy of the database cannot be used to sign in.
// The same answer must be given whether or not an email has an account, and one email or one internet address may only ask for so many links an hour.

export const LIMITS = {
  linkMs: 15 * 60 * 1000,
  sessionMs: 30 * 24 * 3600 * 1000,
  touchMs: 3600 * 1000, // a session is marked "seen" at most this often, to keep writes few
  perEmail: 5,
  perIp: 20,
  windowMs: 3600 * 1000,
  keepLinksMs: 24 * 3600 * 1000,
  accounts: 20000,
  emailMax: 254,
};

const sha256 = async (text) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
const randomToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); // 43 characters, safe in a link and a cookie
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The email as it is kept (trimmed, lower case), or null if it cannot be an address. Deliberately plain: the real test is whether the link arrives. */
export function normalizeEmail(raw) {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 6 || email.length > LIMITS.emailMax) return null;
  if (/[\s<>()[\]\\,;:"]/.test(email)) return null;
  const parts = email.split("@");
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (!local || local.length > 64 || !/^[a-z0-9._%+'-]+$/.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) || domain.split(".").some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) return null;
  return email;
}

/**
 * Makes a sign-in link's token for an email. Returns { ok, token } (the caller emails the token and never stores it), or { ok: false, error }:
 * "bad_email", or "rate_limited" (too many for this email or this internet address in the last hour). `ip` is the asker's address and `salt` a secret
 * from the environment, so what is kept cannot be turned back into an address.
 */
export async function createLoginLink(db, rawEmail, { now = Date.now(), ip = "", salt = "" } = {}) {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, error: "bad_email" };
  const ipHash = await sha256(`${salt}|${String(ip)}`);
  const since = now - LIMITS.windowMs;
  const byEmail = await db.prepare("SELECT COUNT(*) AS n FROM login_links WHERE email = ? AND created_at > ?").bind(email, since).first();
  if (byEmail.n >= LIMITS.perEmail) return { ok: false, error: "rate_limited" };
  const byIp = await db.prepare("SELECT COUNT(*) AS n FROM login_links WHERE ip_hash = ? AND created_at > ?").bind(ipHash, since).first();
  if (byIp.n >= LIMITS.perIp) return { ok: false, error: "rate_limited" };
  const token = randomToken();
  await db.prepare("INSERT INTO login_links (token_hash, email, ip_hash, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, NULL)").bind(await sha256(token), email, ipHash, now, now + LIMITS.linkMs).run();
  return { ok: true, token, email, expiresAt: now + LIMITS.linkMs };
}

/**
 * Uses a sign-in link's token: it is spent in one step (a second use, or two at once, loses), the account for that email is found or made, and a session starts.
 * Returns { ok, accountId, email, created, sessionToken, expiresAt } or { ok: false, error: "invalid_link" } (never says whether it was wrong, used or old) or "full".
 */
export async function useLoginLink(db, token, { now = Date.now() } = {}) {
  if (typeof token !== "string" || !TOKEN.test(token)) return { ok: false, error: "invalid_link" };
  const hash = await sha256(token);
  const spent = await db.prepare("UPDATE login_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").bind(now, hash, now).run();
  if (!spent.meta?.changes) return { ok: false, error: "invalid_link" };
  const link = await db.prepare("SELECT email FROM login_links WHERE token_hash = ?").bind(hash).first();

  let account = await db.prepare("SELECT id FROM accounts WHERE email = ?").bind(link.email).first();
  const created = !account;
  if (created) {
    const total = await db.prepare("SELECT COUNT(*) AS n FROM accounts").first();
    if (total.n >= LIMITS.accounts) return { ok: false, error: "full" };
    const id = randomHex(8);
    await db.prepare("INSERT INTO accounts (id, email, created_at, last_login_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING").bind(id, link.email, now, now).run();
    account = await db.prepare("SELECT id FROM accounts WHERE email = ?").bind(link.email).first(); // (the winner, if two links for a new email were used at once)
  } else {
    await db.prepare("UPDATE accounts SET last_login_at = ? WHERE id = ?").bind(now, account.id).run();
  }

  const sessionToken = randomToken();
  await db.prepare("INSERT INTO sessions (token_hash, account_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").bind(await sha256(sessionToken), account.id, now, now + LIMITS.sessionMs, now).run();
  return { ok: true, accountId: account.id, email: link.email, created, sessionToken, expiresAt: now + LIMITS.sessionMs };
}

/** Who a session cookie belongs to: { accountId, email } or null (unknown, ended, or old). */
export async function sessionAccount(db, token, { now = Date.now() } = {}) {
  if (typeof token !== "string" || !TOKEN.test(token)) return null;
  const hash = await sha256(token);
  const row = await db.prepare("SELECT s.account_id AS accountId, s.expires_at AS expiresAt, s.last_seen_at AS seen, a.email AS email FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?").bind(hash).first();
  if (!row) return null;
  if (row.expiresAt <= now) {
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(hash).run();
    return null;
  }
  if (now - row.seen > LIMITS.touchMs) await db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").bind(now, hash).run();
  return { accountId: row.accountId, email: row.email };
}

/** Signs one browser out. */
export async function endSession(db, token) {
  if (typeof token !== "string" || !TOKEN.test(token)) return;
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

/** Signs an account out everywhere (for "sign out of every device"). */
export async function endAllSessions(db, accountId) {
  await db.prepare("DELETE FROM sessions WHERE account_id = ?").bind(String(accountId)).run();
}

/** How long after the date a payment should have renewed an active Plus is still honoured, in case a notice from the payment service is late or lost. */
export const PLUS_GRACE_MS = 3 * 24 * 3600 * 1000;
export const COMP_PROVIDER = "comp";
export const COMP_MONTHLY_MS = 30 * 24 * 3600 * 1000;
export const DEFAULT_COMP_LIMIT = 150_000;

/** True when a `plus` row is an owner-granted complimentary VIP pass (no Polar / Lemon Squeezy billing, works in any country). */
export const isCompPlus = (row) => Boolean(row && row.provider_ref === COMP_PROVIDER && row.status === "active");

/**
 * Whether what an account bought gives it Plus right now. "active" does (until three days past its renewal date, if that date is known); "canceled" is a
 * subscription that was cancelled but is paid until its end date, so it counts until that date; every other status (paused, unpaid, expired, refunded) does not.
 */
export function plusActive(row, now = Date.now()) {
  if (!row) return false;
  if (row.status === "active") return row.renews_at == null || now <= row.renews_at + PLUS_GRACE_MS;
  if (row.status === "canceled") return row.renews_at != null && now < row.renews_at;
  return false;
}

/** Auto-refreshes a complimentary VIP account's monthly AI voice allowance every 30 days since there is no billing renewal webhook. */
async function refreshCompPeriod(db, row, now) {
  if (!isCompPlus(row)) return row;
  const started = Number(row.period_start) || 0;
  if (started > 0 && now - started < COMP_MONTHLY_MS) return row;
  await db.prepare("UPDATE plus SET tts_used = 0, period_start = ?, updated_at = ? WHERE account_id = ? AND provider_ref = ?")
    .bind(now, now, row.account_id, COMP_PROVIDER).run();
  return { ...row, tts_used: 0, period_start: now, updated_at: now };
}

/** What an account has bought (or been comped), or null. */
export async function getPlus(db, accountId, now = Date.now()) {
  const row = (await db.prepare("SELECT account_id, provider_ref, order_ref, status, renews_at, tts_used, tts_limit, period_start, updated_at FROM plus WHERE account_id = ?").bind(String(accountId)).first()) ?? null;
  if (!row) return null;
  return refreshCompPeriod(db, row, now);
}

/** True when an email address currently holds an active owner-granted complimentary Frills Plus pass. */
export async function hasCompPlusByEmail(db, rawEmail, now = Date.now()) {
  const email = normalizeEmail(rawEmail);
  if (!email) return false;
  const row = await db.prepare("SELECT p.account_id, p.provider_ref, p.status, p.renews_at FROM accounts a JOIN plus p ON p.account_id = a.id WHERE a.email = ?").bind(email).first();
  return isCompPlus(row) && plusActive(row, now);
}

/** True when an unspent, unexpired magic sign-in token belongs to an active complimentary VIP account. */
export async function isCompLoginToken(db, token, now = Date.now()) {
  if (typeof token !== "string" || !TOKEN.test(token)) return false;
  const hash = await sha256(token);
  const link = await db.prepare("SELECT email FROM login_links WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").bind(hash, now).first();
  if (!link?.email) return false;
  return hasCompPlusByEmail(db, link.email, now);
}

/** Grants (or renews) a complimentary lifetime Frills Plus VIP pass to an email address, creating the account row if needed. */
export async function grantCompPlus(db, rawEmail, { limit = DEFAULT_COMP_LIMIT, now = Date.now() } = {}) {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, error: "bad_email" };
  const cleanLimit = Math.max(1000, Math.min(10_000_000, Math.round(Number(limit) || DEFAULT_COMP_LIMIT)));
  let account = await db.prepare("SELECT id FROM accounts WHERE email = ?").bind(email).first();
  const created = !account;
  if (created) {
    const total = await db.prepare("SELECT COUNT(*) AS n FROM accounts").first();
    if (total.n >= LIMITS.accounts) return { ok: false, error: "full" };
    const id = randomHex(8);
    await db.prepare("INSERT INTO accounts (id, email, created_at, last_login_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING").bind(id, email, now, now).run();
    account = await db.prepare("SELECT id FROM accounts WHERE email = ?").bind(email).first();
  }
  const existing = await db.prepare("SELECT * FROM plus WHERE account_id = ?").bind(account.id).first();
  if (existing && existing.provider_ref && existing.provider_ref !== COMP_PROVIDER && plusActive(existing, now)) {
    return { ok: false, error: "already_paid" };
  }
  await db.prepare(
    "INSERT INTO plus (account_id, provider_ref, order_ref, status, renews_at, tts_used, tts_limit, period_start, updated_at) VALUES (?, ?, 'vip', 'active', NULL, 0, ?, ?, ?) " +
    "ON CONFLICT(account_id) DO UPDATE SET provider_ref = excluded.provider_ref, order_ref = 'vip', status = 'active', renews_at = NULL, tts_used = 0, tts_limit = excluded.tts_limit, period_start = excluded.period_start, updated_at = excluded.updated_at",
  ).bind(account.id, COMP_PROVIDER, cleanLimit, now, now).run();
  return { ok: true, accountId: account.id, email, created, limit: cleanLimit };
}

/** Revokes an owner-granted complimentary VIP pass without touching paid subscriptions. */
export async function revokeCompPlus(db, accountId, { now = Date.now() } = {}) {
  const id = String(accountId ?? "").trim();
  if (!id) return { ok: false, error: "not_found" };
  const row = await db.prepare("SELECT account_id, provider_ref FROM plus WHERE account_id = ?").bind(id).first();
  if (!row) return { ok: false, error: "not_found" };
  if (row.provider_ref !== COMP_PROVIDER) return { ok: false, error: "not_comp" };
  await db.prepare("UPDATE plus SET status = 'expired', renews_at = NULL, updated_at = ? WHERE account_id = ?").bind(now, id).run();
  return { ok: true, accountId: id };
}

/** Resets monthly AI voice usage (and optionally updates the monthly character cap) for a Plus account. */
export async function resetPlusUsage(db, accountId, { limit, now = Date.now() } = {}) {
  const id = String(accountId ?? "").trim();
  const row = await db.prepare("SELECT account_id, tts_limit FROM plus WHERE account_id = ?").bind(id).first();
  if (!row) return { ok: false, error: "not_found" };
  const nextLimit = limit !== undefined && limit !== null && limit !== ""
    ? Math.max(1000, Math.min(10_000_000, Math.round(Number(limit) || row.tts_limit)))
    : Number(row.tts_limit) || DEFAULT_COMP_LIMIT;
  await db.prepare("UPDATE plus SET tts_used = 0, tts_limit = ?, period_start = ?, updated_at = ? WHERE account_id = ?")
    .bind(nextLimit, now, now, id).run();
  return { ok: true, accountId: id, limit: nextLimit };
}

/** Lists Plus accounts (both paid and owner-granted VIP passes) for the private admin page. */
export async function listPlusAccounts(db, { now = Date.now(), limit = 200 } = {}) {
  const rows = (await db.prepare(
    "SELECT p.account_id, a.email, p.provider_ref, p.status, p.renews_at, p.tts_used, p.tts_limit, p.period_start, p.updated_at FROM plus p JOIN accounts a ON a.id = p.account_id ORDER BY p.updated_at DESC LIMIT ?",
  ).bind(Math.max(1, Math.min(500, limit))).all()).results ?? [];
  const items = [];
  for (const r of rows) {
    const fresh = await refreshCompPeriod(db, r, now);
    items.push({
      accountId: fresh.account_id,
      email: r.email,
      comp: fresh.provider_ref === COMP_PROVIDER,
      status: fresh.status,
      active: plusActive(fresh, now),
      renewsAt: fresh.renews_at,
      used: Number(fresh.tts_used) || 0,
      limit: Number(fresh.tts_limit) || DEFAULT_COMP_LIMIT,
      periodStart: Number(fresh.period_start) || 0,
      updatedAt: Number(fresh.updated_at) || 0,
    });
  }
  return items;
}

/** Deletes an account and everything kept about it: its sessions, its sign-in links, what it bought. Returns true if there was such an account. */
export async function deleteAccount(db, accountId) {
  const account = await db.prepare("SELECT email FROM accounts WHERE id = ?").bind(String(accountId)).first();
  if (!account) return false;
  await db.prepare("DELETE FROM sessions WHERE account_id = ?").bind(String(accountId)).run();
  await db.prepare("DELETE FROM plus WHERE account_id = ?").bind(String(accountId)).run();
  await db.prepare("DELETE FROM overlay_links WHERE account_id = ?").bind(String(accountId)).run();
  try { await db.prepare("DELETE FROM cloud_overlays WHERE account_id = ?").bind(String(accountId)).run(); } catch { /* older DBs before cloud_overlays migration */ }
  await db.prepare("DELETE FROM login_links WHERE email = ?").bind(account.email).run();
  await db.prepare("DELETE FROM accounts WHERE id = ?").bind(String(accountId)).run();
  return true;
}

/** Removes what is no longer needed: sessions that have ended, and sign-in links older than a day (that is also how long the rate limit looks back). */
export async function sweep(db, { now = Date.now() } = {}) {
  await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();
  await db.prepare("DELETE FROM login_links WHERE created_at < ?").bind(now - LIMITS.keepLinksMs).run();
}
