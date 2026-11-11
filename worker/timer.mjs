// The subathon timer's controls, handed from the streamer's browser tab to their timer overlay. The overlay in the streaming app keeps the clock and
// adds time for gifts by itself; what it cannot do is press Start. So the tab (the timer editor) puts a command in this small post box (start, pause,
// resume, reset, add time) and the overlay reads it from here. Nothing about viewers or gifts comes here: only a command and a number of seconds.
//
// Who can do what: the tab makes a random code (in the overlay link) and a random key (kept only in that browser). The first post with a code claims it,
// storing only the key's hash; after that only the same key can send commands. Anyone with the code can read the commands, like anyone with the overlay
// link. Nothing lists the codes. Each command has a number that only goes up, so an overlay asks "anything after number N?" and never obeys one twice.

const CODE = /^[A-Za-z0-9_-]{16}$/;
const KEY = /^[A-Za-z0-9_-]{16,64}$/;
export const COMMANDS = ["start", "pause", "resume", "reset", "add"];
export const LIMITS = { bytes: 512, boxes: 500, keepDays: 30, keepCommandsMs: 24 * 3600 * 1000, perBox: 100, burst: 20, burstMs: 10000, page: 50, maxSeconds: 7 * 86400 };

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra } });

const sha256 = async (text) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const sameOrigin = (request) => {
  const origin = request.headers.get("origin");
  return Boolean(origin) && origin === new URL(request.url).origin;
};

/** One command, whatever was sent: a name from the short list and a whole number of seconds (negative only for "add"). Null if it is not one. */
export function tidy(raw) {
  if (!raw || typeof raw !== "object" || !COMMANDS.includes(raw.cmd)) return null;
  const n = Math.round(Number(raw.value) || 0);
  const value = raw.cmd === "add" ? Math.max(-LIMITS.maxSeconds, Math.min(LIMITS.maxSeconds, n)) : raw.cmd === "reset" ? Math.max(0, Math.min(LIMITS.maxSeconds, n)) : 0;
  return { cmd: raw.cmd, value };
}

/** GET and POST /api/timer/<code>. */
export async function handleTimer(request, env, { now = Date.now() } = {}) {
  const url = new URL(request.url);
  const code = url.pathname.split("/").filter(Boolean)[2] ?? "";
  if (!CODE.test(code)) return json(404, { ok: false, error: "not_found" });
  if (!env?.DB) return json(503, { ok: false, error: "not_ready" });
  try {
    if (request.method === "GET") {
      const box = await env.DB.prepare("SELECT seq, updated_at FROM timer_boxes WHERE code = ?").bind(code).first();
      if (!box) return json(200, { ok: true, now, seq: 0, items: [] }); // nobody has posted here yet
      const after = url.searchParams.get("after");
      // Without "after" an overlay only learns where the line is now, so a page that loads never obeys a command that was given before it opened.
      if (after === null) return json(200, { ok: true, now, seq: box.seq, items: [] });
      const from = Math.max(0, Math.round(Number(after)) || 0);
      const rows = (await env.DB.prepare("SELECT seq, cmd, value FROM timer_commands WHERE code = ? AND seq > ? ORDER BY seq LIMIT ?").bind(code, from, LIMITS.page).all()).results;
      return json(200, { ok: true, now, seq: box.seq, items: rows.map((r) => ({ seq: r.seq, cmd: r.cmd, value: r.value })) });
    }
    if (request.method !== "POST") return json(405, { ok: false, error: "method" }, { allow: "GET, POST" });
    if (!sameOrigin(request)) return json(403, { ok: false, error: "wrong_origin" });
    const key = request.headers.get("x-key") ?? "";
    if (!KEY.test(key)) return json(401, { ok: false, error: "no_key" });
    const text = await request.text();
    if (text.length > LIMITS.bytes) return json(413, { ok: false, error: "too_big" });
    let body;
    try { body = JSON.parse(text); } catch { return json(400, { ok: false, error: "bad_data" }); }
    const command = tidy(body);
    if (!command) return json(400, { ok: false, error: "bad_data" });

    const hash = await sha256(key);
    let box = await env.DB.prepare("SELECT key_hash, seq FROM timer_boxes WHERE code = ?").bind(code).first();
    if (box) {
      if (box.key_hash !== hash) return json(403, { ok: false, error: "wrong_key" });
    } else {
      const old = now - LIMITS.keepDays * 86400000;
      await env.DB.prepare("DELETE FROM timer_commands WHERE code IN (SELECT code FROM timer_boxes WHERE updated_at < ?)").bind(old).run();
      await env.DB.prepare("DELETE FROM timer_boxes WHERE updated_at < ?").bind(old).run();
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM timer_boxes").first();
      if ((count?.n ?? 0) >= LIMITS.boxes) return json(507, { ok: false, error: "full" });
      await env.DB.prepare("INSERT INTO timer_boxes (code, key_hash, seq, updated_at) VALUES (?, ?, 0, ?)").bind(code, hash, now).run();
      box = { key_hash: hash, seq: 0 };
    }
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM timer_commands WHERE code = ? AND at > ?").bind(code, now - LIMITS.burstMs).first();
    if ((recent?.n ?? 0) >= LIMITS.burst) return json(429, { ok: false, error: "too_fast" }, { "retry-after": "10" });
    const seq = box.seq + 1;
    await env.DB.prepare("INSERT INTO timer_commands (code, seq, cmd, value, at) VALUES (?, ?, ?, ?, ?)").bind(code, seq, command.cmd, command.value, now).run();
    await env.DB.prepare("UPDATE timer_boxes SET seq = ?, updated_at = ? WHERE code = ?").bind(seq, now, code).run();
    await env.DB.prepare("DELETE FROM timer_commands WHERE code = ? AND (at < ? OR seq <= ?)").bind(code, now - LIMITS.keepCommandsMs, seq - LIMITS.perBox).run();
    return json(200, { ok: true, now, seq });
  } catch {
    return json(503, { ok: false, error: "not_ready" });
  }
}
