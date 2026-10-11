// "What is playing on Spotify", handed from the streamer's browser tab to their overlay. The tab (the private /spotify/ page) logs in to
// Spotify and reads what is playing; the overlay in the streaming app is another browser that has no login. This is the small post box
// between them: the tab puts the song here, the overlay reads it. Spotify's login never comes here: only the song's title, artist, cover
// and position, and nothing is kept for long.
//
// Who can do what: the tab makes a random code (in the overlay link) and a random key (kept only in that browser). The first put with a
// code claims it, storing only the key's hash; after that only the same key can change it. Anyone with the code can read the song, like
// anyone with the overlay link. Nothing lists the codes.

const CODE = /^[A-Za-z0-9_-]{16}$/;
const KEY = /^[A-Za-z0-9_-]{16,64}$/;
const LIMITS = { bytes: 2048, rows: 500, keepDays: 14, minGapMs: 700, hours: 4 * 3600 * 1000 };

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra } });

const sha256 = async (text) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const sameOrigin = (request) => {
  const origin = request.headers.get("origin");
  return Boolean(origin) && origin === new URL(request.url).origin;
};
const clean = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const ms = (value) => Math.max(0, Math.min(LIMITS.hours, Math.round(Number(value) || 0)));

/** What the overlay may be told, whatever was sent: a few short texts and numbers, a picture only from Spotify's own server. */
export function tidy(raw) {
  if (!raw || typeof raw !== "object") return null;
  const cover = typeof raw.cover === "string" && /^https:\/\/i\.scdn\.co\/image\/[A-Za-z0-9]{10,100}$/.test(raw.cover) ? raw.cover : "";
  return {
    playing: raw.playing === true,
    title: clean(raw.title, 160),
    artist: clean(raw.artist, 120),
    cover,
    progressMs: ms(raw.progressMs),
    durationMs: ms(raw.durationMs),
  };
}

/** GET and PUT /api/nowplaying/<code>. */
export async function handleNowPlaying(request, env, { now = Date.now() } = {}) {
  const code = new URL(request.url).pathname.split("/").filter(Boolean)[2] ?? "";
  if (!CODE.test(code)) return json(404, { ok: false, error: "not_found" });
  if (!env?.DB) return json(503, { ok: false, error: "not_ready" });
  try {
    if (request.method === "GET") {
      const row = await env.DB.prepare("SELECT data, updated_at FROM nowplaying WHERE code = ?").bind(code).first();
      if (!row) return json(404, { ok: false, error: "not_found", now });
      return json(200, { ok: true, now, updatedAt: row.updated_at, data: JSON.parse(row.data) });
    }
    if (request.method !== "PUT") return json(405, { ok: false, error: "method" });
    if (!sameOrigin(request)) return json(403, { ok: false, error: "wrong_origin" });
    const key = request.headers.get("x-key") ?? "";
    if (!KEY.test(key)) return json(401, { ok: false, error: "no_key" });
    const text = await request.text();
    if (text.length > LIMITS.bytes) return json(413, { ok: false, error: "too_big" });
    let data;
    try { data = tidy(JSON.parse(text)); } catch { data = null; }
    if (!data) return json(400, { ok: false, error: "bad_data" });
    const hash = await sha256(key);
    const row = await env.DB.prepare("SELECT key_hash, updated_at FROM nowplaying WHERE code = ?").bind(code).first();
    if (row) {
      if (row.key_hash !== hash) return json(403, { ok: false, error: "wrong_key" });
      if (now - row.updated_at < LIMITS.minGapMs) return json(429, { ok: false, error: "too_fast" }, { "retry-after": "1" });
    } else {
      const old = now - LIMITS.keepDays * 86400000;
      await env.DB.prepare("DELETE FROM nowplaying WHERE updated_at < ?").bind(old).run();
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM nowplaying").first();
      if ((count?.n ?? 0) >= LIMITS.rows) return json(507, { ok: false, error: "full" });
    }
    await env.DB.prepare("INSERT INTO nowplaying (code, key_hash, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
      .bind(code, hash, JSON.stringify(data), now).run();
    return json(200, { ok: true, now });
  } catch {
    return json(503, { ok: false, error: "not_ready" });
  }
}
