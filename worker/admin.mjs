// The admin side: the owner reads the feedback and the uploaded files, marks feedback as done, and removes what should not be kept.
// Everything under /api/admin/ needs the owner's password, sent as `Authorization: Bearer <password>`. The password is a Worker secret
// called ADMIN_KEY (set in the Cloudflare dashboard; it is never in the code or the page). Without it, or with one shorter than 12
// characters, the admin side is simply off. Wrong tries are counted in the database (table admin_tries) and after 10 in 10 minutes
// every request waits until the 10 minutes are up, so a password cannot be guessed by trying many. Pure code over the standard
// Request/Response and D1's small API, like the other handlers, so tests and the local server run it with the SQLite stand-in.

import { KINDS } from "./feedback.mjs";
import { MEDIA } from "./media.mjs";

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

async function summary(env) {
  const status = await hasStatus(env);
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback").first();
  const fresh = status ? await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE status = 'new'").first() : total;
  const kinds = (await env.DB.prepare("SELECT kind, COUNT(*) AS n FROM feedback GROUP BY kind").all()).results;
  const files = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM media").first();
  const byKind = (await env.DB.prepare("SELECT kind, COUNT(*) AS n FROM media GROUP BY kind").all()).results;
  return json(200, {
    ok: true,
    canMark: status,
    feedback: { total: total?.n ?? 0, new: fresh?.n ?? 0, kinds: Object.fromEntries(kinds.map((k) => [k.kind, k.n])) },
    media: { count: files?.n ?? 0, bytes: files?.bytes ?? 0, limit: MEDIA.totalBytes, kinds: Object.fromEntries(byKind.map((k) => [k.kind, k.n])) },
  });
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

/** Routes everything under /api/admin/. Returns a Response, or null when the address is not under it. */
export async function handleAdmin(request, env, { now = Date.now() } = {}) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/admin" && !url.pathname.startsWith("/api/admin/")) return null;
  const denied = await authorize(request, env, now);
  if (denied) return denied;
  const method = request.method;
  if (method !== "GET" && !sameOrigin(request)) return json(403, { ok: false, error: "wrong_origin" });
  const [, , , area, rest, ...more] = url.pathname.split("/");
  try {
    if (more.length === 0 && area === "summary" && !rest) return method === "GET" ? await summary(env) : json(405, { ok: false, error: "method" }, { allow: "GET" });
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
