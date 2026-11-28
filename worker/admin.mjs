// The admin side: the owner reads the feedback and the uploaded files, marks feedback as done, and removes what should not be kept.
// Everything under /api/admin/ needs the owner's password, sent as `Authorization: Bearer <password>`. The password is a Worker secret
// called ADMIN_KEY (set in the Cloudflare dashboard; it is never in the code or the page). Without it, or with one shorter than 12
// characters, the admin side is simply off. Wrong tries are counted in the database (table admin_tries) and after 10 in 10 minutes
// every request waits until the 10 minutes are up, so a password cannot be guessed by trying many. Pure code over the standard
// Request/Response and D1's small API, like the other handlers, so tests and the local server run it with the SQLite stand-in.

import { KINDS } from "./feedback.mjs";
import { MEDIA } from "./media.mjs";
import { handleOffice } from "./office.mjs";
import { parseRelayUrls, report } from "./stats-report.mjs";
import { getPlus, grantCompPlus, grantManualPlus, listPlusAccounts, plusActive, resetPlusUsage, revokeCompPlus } from "./accounts.mjs";
import { getMailer, plusOnMessage } from "./mailer.mjs";

export const ADMIN = { minKey: 12, maxWrong: 10, windowMs: 10 * 60 * 1000, pageSize: 40, maxPage: 100 };
export const STATUSES = ["new", "done"];

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-robots-tag": "noindex", ...extra } });

const sameOrigin = (request) => {
  const origin = request.headers.get("origin");
  return Boolean(origin) && origin === new URL(request.url).origin;
};

const digest = async (text) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

/** Compares two texts without stopping at the first difference (it compares their SHA-256 digests, which are always the same length). */
async function same(a, b) {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}

/** Null when the request carries the right password; otherwise the Response to send back. */
async function authorize(request, env, now) {
  const key = env?.ADMIN_KEY;
  if (typeof key !== "string" || key.length < ADMIN.minKey) return json(503, { ok: false, error: "admin_off" });
  if (!env?.DB) return json(503, { ok: false, error: "not_ready" });
  const since = now - ADMIN.windowMs;
  try {
    const wrong = await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_tries WHERE at > ?").bind(since).first();
    if ((wrong?.n ?? 0) >= ADMIN.maxWrong) return json(429, { ok: false, error: "locked" }, { "retry-after": "600" });
  } catch { /* the table is new; without it there is no lockout, but the password still has to be right */ }
  const given = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (given && (await same(given, key))) return null;
  try {
    await env.DB.prepare("DELETE FROM admin_tries WHERE at <= ?").bind(since).run();
    await env.DB.prepare("INSERT INTO admin_tries (at) VALUES (?)").bind(now).run();
  } catch { /* as above */ }
  return json(401, { ok: false, error: "wrong_key" });
}

/** Whether the feedback table has the `status` column (an older database does not until the one line in schema.sql is run). */
async function hasStatus(env) {
  try { await env.DB.prepare("SELECT status FROM feedback LIMIT 1").first(); return true; } catch { return false; }
}

const clampLimit = (value) => Math.min(ADMIN.maxPage, Math.max(1, Math.round(Number(value)) || ADMIN.pageSize));
const likePattern = (text) => `%${text.replace(/[\\%_]/g, (c) => "\\" + c)}%`;

async function summaryData(env, now = Date.now()) {
  const status = await hasStatus(env);
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback").first();
  const fresh = status ? await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE status = 'new'").first() : total;
  const kinds = (await env.DB.prepare("SELECT kind, COUNT(*) AS n FROM feedback GROUP BY kind").all()).results;
  const files = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM media").first();
  const byKind = (await env.DB.prepare("SELECT kind, COUNT(*) AS n FROM media GROUP BY kind").all()).results;
  let plusSummary = { total: 0, active: 0, comp: 0, manual: 0 };
  try {
    const list = await listPlusAccounts(env.DB, { now });
    plusSummary = {
      total: list.length,
      active: list.filter((p) => p.active).length,
      comp: list.filter((p) => p.comp && p.active).length,
      manual: list.filter((p) => p.manual && !p.comp && p.active).length,
    };
  } catch { /* older DBs before accounts/plus tables */ }
  return {
    ok: true,
    canMark: status,
    feedback: { total: total?.n ?? 0, new: fresh?.n ?? 0, kinds: Object.fromEntries(kinds.map((k) => [k.kind, k.n])) },
    media: { count: files?.n ?? 0, bytes: files?.bytes ?? 0, limit: MEDIA.totalBytes, kinds: Object.fromEntries(byKind.map((k) => [k.kind, k.n])) },
    plus: plusSummary,
  };
}

async function summary(env, now = Date.now()) {
  return json(200, await summaryData(env, now));
}

/** What Frills Plus is sold for each month, in US dollars. It is the list price the Plus page shows: what is paid out after tax and fees is less, so this is a guide, not accounts. */
export const PLUS_PRICE_USD = 5.99;
const DAY_MS = 86_400_000;
const midnightUtc = (ms) => Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth(), new Date(ms).getUTCDate());

/** Everything the dashboard's Overview needs that lives in our own database: who signed up, who has Plus and of which kind, who is about to lose it, and the newest feedback. */
async function overview(env, now = Date.now()) {
  const base = await summaryData(env, now);
  let accounts = { total: 0, last24h: 0, last7d: 0, previous7d: 0, perDay: [] };
  let recentAccounts = [];
  let plus = { active: 0, paid: 0, ending: 0, manual: 0, vip: 0, monthlyUsd: 0, expiring: [] };
  try {
    const counts = await env.DB.prepare(
      "SELECT COUNT(*) AS total, COALESCE(SUM(created_at > ?), 0) AS d1, COALESCE(SUM(created_at > ?), 0) AS d7, COALESCE(SUM(created_at > ? AND created_at <= ?), 0) AS p7 FROM accounts",
    ).bind(now - DAY_MS, now - 7 * DAY_MS, now - 14 * DAY_MS, now - 7 * DAY_MS).first();
    const start = midnightUtc(now) - 13 * DAY_MS;
    const rows = (await env.DB.prepare(
      "SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM accounts WHERE created_at >= ? GROUP BY day",
    ).bind(start).all()).results ?? [];
    const byDay = new Map(rows.map((r) => [r.day, Number(r.n) || 0]));
    accounts = {
      total: Number(counts?.total) || 0,
      last24h: Number(counts?.d1) || 0,
      last7d: Number(counts?.d7) || 0,
      previous7d: Number(counts?.p7) || 0,
      perDay: Array.from({ length: 14 }, (_, i) => {
        const day = new Date(start + i * DAY_MS).toISOString().slice(0, 10);
        return { day, n: byDay.get(day) ?? 0 };
      }),
    };
    const newest = (await env.DB.prepare(
      "SELECT a.id, a.email, a.created_at, a.last_login_at, p.provider_ref, p.status, p.renews_at FROM accounts a LEFT JOIN plus p ON p.account_id = a.id ORDER BY a.created_at DESC LIMIT 6",
    ).all()).results ?? [];
    recentAccounts = newest.map((r) => ({
      accountId: r.id,
      email: r.email,
      createdAt: Number(r.created_at) || 0,
      lastLoginAt: Number(r.last_login_at) || 0,
      plus: r.status === undefined || r.status === null ? null : !plusActive(r, now) ? "ended" : r.provider_ref === "comp" ? "vip" : !r.provider_ref ? "manual" : "paid",
    }));
    const list = await listPlusAccounts(env.DB, { now });
    const live = list.filter((p) => p.active);
    const paid = live.filter((p) => !p.comp && !p.manual && p.status === "active");
    plus = {
      active: live.length,
      paid: paid.length,
      ending: live.filter((p) => !p.comp && !p.manual && p.status === "canceled").length,
      manual: live.filter((p) => p.manual && !p.comp).length,
      vip: live.filter((p) => p.comp).length,
      monthlyUsd: Math.round(paid.length * PLUS_PRICE_USD * 100) / 100,
      expiring: live
        .filter((p) => !p.comp && p.renewsAt && p.renewsAt - now <= 7 * DAY_MS && (p.manual || p.status === "canceled"))
        .sort((x, y) => x.renewsAt - y.renewsAt)
        .map((p) => ({ accountId: p.accountId, email: p.email, renewsAt: p.renewsAt, manual: p.manual })),
    };
  } catch { /* older DBs before the accounts and plus tables */ }
  let latestFeedback = [];
  try {
    const rows = (await env.DB.prepare(`SELECT id, created, kind, message${base.canMark ? ", status" : ""} FROM feedback ORDER BY id DESC LIMIT 4`).all()).results ?? [];
    latestFeedback = rows.map((r) => ({ id: r.id, created: r.created, kind: r.kind, message: String(r.message ?? "").slice(0, 200), status: base.canMark ? r.status : null }));
  } catch { /* no feedback table yet */ }
  return json(200, { ok: true, now, summary: base, accounts, plus, recentAccounts, latestFeedback, priceUsd: PLUS_PRICE_USD });
}

async function listFeedback(url, env) {
  const status = await hasStatus(env);
  const where = [];
  const values = [];
  const kind = url.searchParams.get("kind");
  if (KINDS.includes(kind)) { where.push("kind = ?"); values.push(kind); }
  const wanted = url.searchParams.get("status");
  if (status && STATUSES.includes(wanted)) { where.push("status = ?"); values.push(wanted); }
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q) { where.push("(message LIKE ? ESCAPE '\\' OR contact LIKE ? ESCAPE '\\')"); values.push(likePattern(q), likePattern(q)); }
  const before = Number(url.searchParams.get("before"));
  if (Number.isInteger(before) && before > 0) { where.push("id < ?"); values.push(before); }
  const limit = clampLimit(url.searchParams.get("limit"));
  const rows = (await env.DB.prepare(`SELECT id, created, kind, app, message, contact, ${status ? "status" : "'new' AS status"} FROM feedback ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`).bind(...values, limit + 1).all()).results;
  const items = rows.slice(0, limit);
  return json(200, { ok: true, items, next: rows.length > limit ? items[items.length - 1].id : null });
}

async function listMedia(url, env) {
  const where = [];
  const values = [];
  const kind = url.searchParams.get("kind");
  if (kind === "image" || kind === "sound") { where.push("kind = ?"); values.push(kind); }
  const before = url.searchParams.get("before") ?? "";
  if (/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(before)) { where.push("created < ?"); values.push(before); }
  const limit = clampLimit(url.searchParams.get("limit"));
  const rows = (await env.DB.prepare(`SELECT id, kind, mime, size, created FROM media ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created DESC LIMIT ?`).bind(...values, limit + 1).all()).results;
  const items = rows.slice(0, limit);
  return json(200, { ok: true, items, next: rows.length > limit ? items[items.length - 1].created : null });
}

async function markFeedback(id, request, env) {
  if (!(await hasStatus(env))) return json(409, { ok: false, error: "no_status_column" });
  let body;
  try { body = await request.json(); } catch { return json(400, { ok: false, error: "bad_json" }); }
  if (!STATUSES.includes(body?.status)) return json(400, { ok: false, error: "bad_status" });
  if (!(await env.DB.prepare("SELECT id FROM feedback WHERE id = ?").bind(id).first())) return json(404, { ok: false, error: "not_found" });
  await env.DB.prepare("UPDATE feedback SET status = ? WHERE id = ?").bind(body.status, id).run();
  return json(200, { ok: true });
}

async function removeFeedback(id, env) {
  if (!(await env.DB.prepare("SELECT id FROM feedback WHERE id = ?").bind(id).first())) return json(404, { ok: false, error: "not_found" });
  await env.DB.prepare("DELETE FROM feedback WHERE id = ?").bind(id).run();
  return json(200, { ok: true });
}

async function removeMedia(id, env) {
  if (!MEDIA.idPattern.test(id)) return json(404, { ok: false, error: "not_found" });
  if (!(await env.DB.prepare("SELECT id FROM media WHERE id = ?").bind(id).first())) return json(404, { ok: false, error: "not_found" });
  await env.DB.prepare("DELETE FROM media WHERE id = ?").bind(id).run();
  return json(200, { ok: true });
}

const EULER_ACTIONS = new Set(["sync", "refill"]);

async function controlEuler(request, env, { fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
  let body;
  try { body = await request.json(); } catch { return json(400, { ok: false, error: "bad_json" }); }
  const action = String(body?.action ?? "");
  if (!EULER_ACTIONS.has(action)) return json(400, { ok: false, error: "bad_action" });
  const allowedRelays = parseRelayUrls(env);
  const requestedUrl = typeof body?.relayUrl === "string" ? body.relayUrl.trim().replace(/\/+$/, "") : "";
  if (requestedUrl && !allowedRelays.includes(requestedUrl)) return json(400, { ok: false, error: "unknown_relay" });
  const targets = requestedUrl ? [requestedUrl] : allowedRelays;
  const ownerKey = String(env?.RELAY_OWNER_KEY ?? "").trim();
  const payload = JSON.stringify({ action, ...(body?.slot != null ? { slot: Number(body.slot) } : {}) });
  const headers = { "content-type": "application/json", accept: "application/json", ...(ownerKey ? { authorization: `Bearer ${ownerKey}` } : {}) };
  const results = await Promise.all(
    targets.map(async (base) => {
      try {
        const res = await fetchImpl(`${base}/owner/euler`, { method: "POST", headers, body: payload });
        const data = await res.json().catch(() => ({}));
        return { url: base, ok: res.ok, status: res.status, ...data };
      } catch {
        return { url: base, ok: false, status: 0, error: "unreachable" };
      }
    }),
  );
  return json(200, { ok: results.some((r) => r.ok), action, results });
}

/** Sends "Your Frills Plus is on" to an address. Never throws: the caller says what happened ({ emailed: true } or { emailed: false, emailError }). */
async function sendPlusOn(env, email, { mailer = null, fetchImpl, request }) {
  const sender = getMailer(env, mailer, { fetchFn: fetchImpl });
  if (!sender) return { emailed: false, emailError: "email_off" };
  const site = String(env.SITE_URL ?? new URL(request.url).origin).replace(/\/+$/, "");
  let sent;
  try { sent = await sender.send(plusOnMessage(email, site)); } catch { sent = { ok: false }; }
  return sent?.ok ? { emailed: true } : { emailed: false, emailError: "mail_failed" };
}

async function handleAdminPlus(method, rest, more, request, env, now, deps = {}) {
  if (!rest && more.length === 0) {
    if (method === "GET") {
      const items = await listPlusAccounts(env.DB, { now });
      return json(200, { ok: true, items });
    }
    if (method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json(400, { ok: false, error: "bad_json" }); }
      const result = await grantCompPlus(env.DB, body?.email, { limit: body?.limit, now });
      if (!result.ok) {
        const status = result.error === "already_paid" ? 409 : result.error === "full" ? 503 : 400;
        return json(status, result);
      }
      return json(200, result);
    }
    return json(405, { ok: false, error: "method" }, { allow: "GET, POST" });
  }
  if (rest === "manual" && more.length === 0) {
    if (method !== "POST") return json(405, { ok: false, error: "method" }, { allow: "POST" });
    let body;
    try { body = await request.json(); } catch { return json(400, { ok: false, error: "bad_json" }); }
    const result = await grantManualPlus(env.DB, body?.email, { days: body?.days, limit: body?.limit, now });
    if (!result.ok) {
      const status = result.error === "already_paid" || result.error === "already_vip" ? 409 : result.error === "full" ? 503 : 400;
      return json(status, result);
    }
    // The grant stands even if the email cannot be sent: the answer says what happened to it.
    const mail = body?.notify === true ? await sendPlusOn(env, result.email, { ...deps, request }) : {};
    return json(200, { ...result, ...mail });
  }
  const accountId = String(rest ?? "").trim();
  if (!/^[0-9a-f]{16}$/.test(accountId)) return json(404, { ok: false, error: "not_found" });
  if (more.length === 0 && method === "DELETE") {
    const result = await revokeCompPlus(env.DB, accountId, { now });
    if (!result.ok) return json(result.error === "not_comp" ? 409 : 404, result);
    return json(200, result);
  }
  if (more.length === 1 && more[0] === "notify" && method === "POST") {
    const row = await getPlus(env.DB, accountId, now);
    const who = row ? await env.DB.prepare("SELECT email FROM accounts WHERE id = ?").bind(accountId).first() : null;
    if (!row || !who?.email) return json(404, { ok: false, error: "not_found" });
    if (!plusActive(row, now)) return json(409, { ok: false, error: "not_active" });
    const mail = await sendPlusOn(env, who.email, { ...deps, request });
    return json(mail.emailed ? 200 : 502, { ok: mail.emailed, email: who.email, ...mail });
  }
  if (more.length === 1 && more[0] === "reset" && method === "POST") {
    let body = {};
    try { const raw = await request.text(); if (raw.trim()) body = JSON.parse(raw); } catch { return json(400, { ok: false, error: "bad_json" }); }
    const result = await resetPlusUsage(env.DB, accountId, { limit: body?.limit, now });
    if (!result.ok) return json(404, result);
    return json(200, result);
  }
  return json(405, { ok: false, error: "method" }, { allow: "POST, DELETE" });
}

/** Routes everything under /api/admin/. Returns a Response, or null when the address is not under it. */
export async function handleAdmin(request, env, { now = Date.now(), fetchImpl = globalThis.fetch?.bind(globalThis), mailer = null } = {}) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/admin" && !url.pathname.startsWith("/api/admin/")) return null;
  const denied = await authorize(request, env, now);
  if (denied) return denied;
  const method = request.method;
  if (method !== "GET" && !sameOrigin(request)) return json(403, { ok: false, error: "wrong_origin" });
  const [, , , area, rest, ...more] = url.pathname.split("/");
  try {
    if (more.length === 0 && area === "overview" && !rest) return method === "GET" ? await overview(env, now) : json(405, { ok: false, error: "method" }, { allow: "GET" });
    if (more.length === 0 && area === "summary" && !rest) return method === "GET" ? await summary(env, now) : json(405, { ok: false, error: "method" }, { allow: "GET" });
    if (more.length === 0 && area === "stats" && !rest) return method === "GET" ? json(200, await report(env, { now, fetchImpl })) : json(405, { ok: false, error: "method" }, { allow: "GET" });
    if (area === "office") return await handleOffice(request, env, [rest, ...more].filter(Boolean), { now, fetchImpl });
    if (area === "plus") return await handleAdminPlus(method, rest, more, request, env, now, { mailer, fetchImpl });
    if (more.length === 0 && area === "euler" && !rest) return method === "POST" ? await controlEuler(request, env, { fetchImpl }) : json(405, { ok: false, error: "method" }, { allow: "POST" });
    if (more.length === 0 && area === "feedback") {
      if (!rest) return method === "GET" ? await listFeedback(url, env) : json(405, { ok: false, error: "method" }, { allow: "GET" });
      const id = Number(rest);
      if (!Number.isInteger(id) || id < 1) return json(404, { ok: false, error: "not_found" });
      if (method === "PATCH") return await markFeedback(id, request, env);
      if (method === "DELETE") return await removeFeedback(id, env);
      return json(405, { ok: false, error: "method" }, { allow: "PATCH, DELETE" });
    }
    if (more.length === 0 && area === "media") {
      if (!rest) return method === "GET" ? await listMedia(url, env) : json(405, { ok: false, error: "method" }, { allow: "GET" });
      if (method === "DELETE") return await removeMedia(rest, env);
      return json(405, { ok: false, error: "method" }, { allow: "DELETE" });
    }
  } catch {
    return json(503, { ok: false, error: "not_ready" });
  }
  return json(404, { ok: false, error: "not_found" });
}
