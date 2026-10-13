// Twitch follows, handed from the streamer's browser tab to their alerts overlay. Twitch only tells a logged-in streamer who follows, and the
// overlay in the streaming app is another browser with no login. So the tab (the private /twitch/ page) logs in to Twitch, listens for new
// followers, and puts each one in this small post box; the overlay reads them from here. Twitch's login never comes here: only the new
// follower's name (and their short Twitch name), and each one is kept for a day.
//
// Who can do what: the tab makes a random code (in the overlay link) and a random key (kept only in that browser). The first post with a
// code claims it, storing only the key's hash; after that only the same key can add to it. Anyone with the code can read the follows, like
// anyone with the overlay link. Nothing lists the codes. Each follow has a number that only goes up, so an overlay asks "anything after
// number N?" and never sees one twice.

const CODE = /^[A-Za-z0-9_-]{16}$/;
const KEY = /^[A-Za-z0-9_-]{16,64}$/;
export const LIMITS = { bytes: 1024, boxes: 500, keepDays: 14, keepEventsMs: 24 * 3600 * 1000, perBox: 200, burst: 30, burstMs: 10000, page: 50 };

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra } });

const sha256 = async (text) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const sameOrigin = (request) => {
  const origin = request.headers.get("origin");
  return Boolean(origin) && origin === new URL(request.url).origin;
};
const clean = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** What the overlay may be told about one follow, whatever was sent: a short id, a Twitch login name and a shown name. Null if there is no name. */
export function tidy(raw) {
  if (!raw || typeof raw !== "object") return null;
  const login = String(raw.user ?? "").toLowerCase();
  const name = clean(raw.name, 60) || clean(raw.user, 25);
  if (!name) return null;
  return { id: clean(raw.id, 80) || `${login}-${Date.now()}`, user: /^[a-z0-9_]{1,25}$/.test(login) ? login : "", name };
}

/** GET and POST /api/follows/<code>. */
export async function handleFollows(request, env, { now = Date.now() } = {}) {
  const url = new URL(request.url);
  const code = url.pathname.split("/").filter(Boolean)[2] ?? "";
  if (!CODE.test(code)) return json(404, { ok: false, error: "not_found" });
  if (!env?.DB) return json(503, { ok: false, error: "not_ready" });
  try {
    if (request.method === "GET") {
      const box = await env.DB.prepare("SELECT seq, updated_at FROM twitch_boxes WHERE code = ?").bind(code).first();
      if (!box) return json(200, { ok: true, now, seq: 0, updatedAt: 0, items: [] }); // nobody has posted here yet
      const after = url.searchParams.get("after");
      // Without "after" an overlay only learns where the line is now, so a page that loads never replays follows that already happened.
      if (after === null) return json(200, { ok: true, now, seq: box.seq, updatedAt: box.updated_at, items: [] });
      const from = Math.max(0, Math.round(Number(after)) || 0);
      const rows = (await env.DB.prepare("SELECT seq, ev, login, name, at FROM twitch_follows WHERE code = ? AND seq > ? ORDER BY seq LIMIT ?").bind(code, from, LIMITS.page).all()).results;
      return json(200, { ok: true, now, seq: box.seq, updatedAt: box.updated_at, items: rows.map((r) => ({ seq: r.seq, id: r.ev, user: r.login, name: r.name, at: r.at })) });
    }
    if (request.method !== "POST") return json(405, { ok: false, error: "method" }, { allow: "GET, POST" });
    if (!sameOrigin(request)) return json(403, { ok: false, error: "wrong_origin" });
    const key = request.headers.get("x-key") ?? "";
    if (!KEY.test(key)) return json(401, { ok: false, error: "no_key" });
    const text = await request.text();
    if (text.length > LIMITS.bytes) return json(413, { ok: false, error: "too_big" });
    let body;
    try { body = JSON.parse(text); } catch { return json(400, { ok: false, error: "bad_data" }); }
    const ping = body?.ping === true;
    const follow = ping ? null : tidy(body);
    if (!ping && !follow) return json(400, { ok: false, error: "bad_data" });

    const hash = await sha256(key);
    let box = await env.DB.prepare("SELECT key_hash, seq FROM twitch_boxes WHERE code = ?").bind(code).first();
    if (box) {
      if (box.key_hash !== hash) return json(403, { ok: false, error: "wrong_key" });
    } else {
      const old = now - LIMITS.keepDays * 86400000;
      await env.DB.prepare("DELETE FROM twitch_follows WHERE code IN (SELECT code FROM twitch_boxes WHERE updated_at < ?)").bind(old).run();
      await env.DB.prepare("DELETE FROM twitch_boxes WHERE updated_at < ?").bind(old).run();
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM twitch_boxes").first();
      if ((count?.n ?? 0) >= LIMITS.boxes) return json(507, { ok: false, error: "full" });
      await env.DB.prepare("INSERT INTO twitch_boxes (code, key_hash, seq, updated_at) VALUES (?, ?, 0, ?)").bind(code, hash, now).run();
      box = { key_hash: hash, seq: 0 };
    }
    if (ping) {
      await env.DB.prepare("UPDATE twitch_boxes SET updated_at = ? WHERE code = ?").bind(now, code).run();
      return json(200, { ok: true, now, seq: box.seq });
    }
    const again = await env.DB.prepare("SELECT seq FROM twitch_follows WHERE code = ? AND ev = ?").bind(code, follow.id).first();
    if (again) return json(200, { ok: true, now, seq: box.seq, duplicate: true }); // Twitch can tell us the same follow twice
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM twitch_follows WHERE code = ? AND at > ?").bind(code, now - LIMITS.burstMs).first();
    if ((recent?.n ?? 0) >= LIMITS.burst) return json(429, { ok: false, error: "too_fast" }, { "retry-after": "10" });
    const seq = box.seq + 1;
    await env.DB.prepare("INSERT INTO twitch_follows (code, seq, ev, login, name, at) VALUES (?, ?, ?, ?, ?, ?)").bind(code, seq, follow.id, follow.user, follow.name, now).run();
    await env.DB.prepare("UPDATE twitch_boxes SET seq = ?, updated_at = ? WHERE code = ?").bind(seq, now, code).run();
    await env.DB.prepare("DELETE FROM twitch_follows WHERE code = ? AND (at < ? OR seq <= ?)").bind(code, now - LIMITS.keepEventsMs, seq - LIMITS.perBox).run();
    return json(200, { ok: true, now, seq });
  } catch {
    return json(503, { ok: false, error: "not_ready" });
  }
}
