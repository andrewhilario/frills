// The feedback form's receiving end: checks a message, and saves it in a Cloudflare D1 database (env.DB). Pure code over the standard
// Request/Response and D1's small API (prepare, bind, run, first), so tests and the local server run it with a stand-in database.
//
// What it keeps: the date, the kind, the app the person picked, the message and the contact if they typed one. Not their address and
// nothing about their browser. What it refuses: anything that is not a same-site JSON POST, anything too long, and, once an hour's
// limit is reached, more messages until the hour has passed (so a flood cannot fill the database or your reading list).

export const KINDS = ["broken", "idea", "look", "other"];
export const APPS = ["tiktok-live-studio", "streamlabs", "obs", "other-app", "none-yet"];
export const LIMITS = { message: [10, 2000], contact: 100, bodyChars: 6000, perHour: 60, fastestMs: 1500 };

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra } });

/** Plain text: no control characters. Line breaks are kept (as \n) only when `lines` is true. Trimmed and cut to `max`. */
const clean = (value, max, lines = false) => {
  let text = typeof value === "string" ? value.replace(/\r\n?/g, "\n") : "";
  text = text.replace(lines ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, " ");
  if (lines) text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  else text = text.replace(/\s+/g, " ");
  return text.trim().slice(0, max);
};

/** The whole feedback request: returns a Response. `now` is a time in milliseconds (a parameter so tests can set it). */
export async function handleFeedback(request, env, { now = Date.now() } = {}) {
  if (request.method !== "POST") return json(405, { ok: false, error: "post_only" }, { allow: "POST" });

  // Only this site's own page may send it: a browser attaches the page's address as Origin to a fetch like this.
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return json(403, { ok: false, error: "wrong_origin" });
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) return json(415, { ok: false, error: "json_only" });

  const text = await request.text();
  if (text.length > LIMITS.bodyChars) return json(413, { ok: false, error: "too_big" });
  let body;
  try { body = JSON.parse(text); } catch { return json(400, { ok: false, error: "bad_json" }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, { ok: false, error: "bad_json" });

  // A person fills in a form in more than a second and leaves the hidden field alone. A bot that fails either gets a normal-looking
  // "thanks" and nothing is saved, so it learns nothing about what was wrong.
  const trap = typeof body.website === "string" && body.website.trim() !== "";
  const tooFast = !(Number(body.took) >= LIMITS.fastestMs);
  if (trap || tooFast) return json(201, { ok: true });

  const message = clean(body.message, LIMITS.message[1] + 1, true);
  if (message.length < LIMITS.message[0]) return json(400, { ok: false, error: "too_short" });
  if (message.length > LIMITS.message[1]) return json(400, { ok: false, error: "too_long" });
  const kind = KINDS.includes(body.kind) ? body.kind : null;
  if (!kind) return json(400, { ok: false, error: "bad_kind" });
  const app = body.app === "" || body.app == null ? null : APPS.includes(body.app) ? body.app : "bad";
  if (app === "bad") return json(400, { ok: false, error: "bad_app" });
  const contact = clean(body.contact, LIMITS.contact) || null;

  if (!env?.DB) return json(503, { ok: false, error: "not_ready" });
  try {
    const since = new Date(now - 3600 * 1000).toISOString();
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE created > ?").bind(since).first();
    if ((recent?.n ?? 0) >= LIMITS.perHour) return json(429, { ok: false, error: "busy" }, { "retry-after": "600" });
    await env.DB.prepare("INSERT INTO feedback (created, kind, app, message, contact) VALUES (?, ?, ?, ?, ?)").bind(new Date(now).toISOString(), kind, app, message, contact).run();
  } catch {
    return json(503, { ok: false, error: "not_ready" });
  }
  return json(201, { ok: true });
}
