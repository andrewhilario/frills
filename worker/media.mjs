// Uploaded images, GIFs and sounds for alerts, kept in the same D1 database as the feedback (table `media`, see schema.sql) and served
// back from our own address, so the site's security policy needs no change.
//
// Who can do what: anyone can upload a small file once they tick that they have the right to use it; they get back an id (goes in the
// alert link) and a delete code (shown once, never stored: only its hash is). Anyone with the link can see the file, like any picture
// on a website; nobody can list the files. Limits: 300 KB a file, png jpg webp gif mp3 ogg wav (the file's own first bytes decide, not
// what the browser says), an hourly cap on uploads, and a ceiling on the total stored.
//
// The file is kept as base64 text, because that behaves the same in D1 and in the SQLite stand-in used by tests and `npm run dev`.

export const MEDIA = {
  maxBytes: 300 * 1024,
  perHour: 120,
  totalBytes: 2 * 1024 * 1024 * 1024,
  idPattern: /^[A-Za-z0-9_-]{16}$/,
};

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra } });

/** What a file really is, from its first bytes: { kind: "image" | "sound", mime } or null. */
export function sniff(bytes) {
  const at = (i, ...values) => values.every((v, k) => bytes[i + k] === v);
  const ascii = (i, text) => [...text].every((c, k) => bytes[i + k] === c.charCodeAt(0));
  if (bytes.length < 12) return null;
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { kind: "image", mime: "image/png" };
  if (at(0, 0xff, 0xd8, 0xff)) return { kind: "image", mime: "image/jpeg" };
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return { kind: "image", mime: "image/gif" };
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return { kind: "image", mime: "image/webp" };
  if (ascii(0, "RIFF") && ascii(8, "WAVE")) return { kind: "sound", mime: "audio/wav" };
  if (ascii(0, "OggS")) return { kind: "sound", mime: "audio/ogg" };
  if (ascii(0, "ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0)) return { kind: "sound", mime: "audio/mpeg" };
  return null;
}

const toBase64 = (bytes) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const random = (n) => {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const sha256 = async (text) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const sameOrigin = (request) => {
  const origin = request.headers.get("origin");
  return Boolean(origin) && origin === new URL(request.url).origin;
};

/** POST /api/media: the file's bytes as the body, and `x-consent: yes`. Returns { ok, id, kind, mime, size, deleteCode }. */
export async function uploadMedia(request, env, { now = Date.now() } = {}) {
  if (!sameOrigin(request)) return json(403, { ok: false, error: "wrong_origin" });
  if (request.headers.get("x-consent") !== "yes") return json(400, { ok: false, error: "no_consent" });
  const declared = Number(request.headers.get("content-length"));
  if (declared > MEDIA.maxBytes) return json(413, { ok: false, error: "too_big" });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MEDIA.maxBytes) return json(413, { ok: false, error: "too_big" });
  const found = sniff(bytes);
  if (!found) return json(415, { ok: false, error: "bad_type" });
  if (!env?.DB) return json(503, { ok: false, error: "not_ready" });
  try {
    const since = new Date(now - 3600 * 1000).toISOString();
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM media WHERE created > ?").bind(since).first();
    if ((recent?.n ?? 0) >= MEDIA.perHour) return json(429, { ok: false, error: "busy" }, { "retry-after": "600" });
    const stored = await env.DB.prepare("SELECT COALESCE(SUM(size), 0) AS total FROM media").first();
    if ((stored?.total ?? 0) + bytes.length > MEDIA.totalBytes) return json(507, { ok: false, error: "full" });
    const id = random(12);
    const deleteCode = random(12);
    await env.DB.prepare("INSERT INTO media (id, kind, mime, size, data, created, delete_hash) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, found.kind, found.mime, bytes.length, toBase64(bytes), new Date(now).toISOString(), await sha256(deleteCode)).run();
    return json(201, { ok: true, id, kind: found.kind, mime: found.mime, size: bytes.length, deleteCode });
  } catch {
    return json(503, { ok: false, error: "not_ready" });
  }
}

/** GET /api/media/<id>: the file, cached for a year (an id never changes what it points to). */
export async function getMedia(id, env) {
  if (!MEDIA.idPattern.test(id) || !env?.DB) return json(404, { ok: false, error: "not_found" });
  try {
    const row = await env.DB.prepare("SELECT mime, data FROM media WHERE id = ?").bind(id).first();
    if (!row) return json(404, { ok: false, error: "not_found" });
    return new Response(fromBase64(row.data), {
      status: 200,
      headers: {
        "content-type": row.mime,
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "content-disposition": "inline",
      },
    });
  } catch {
    return json(503, { ok: false, error: "not_ready" });
  }
}

/** DELETE /api/media/<id> with the delete code in `x-delete-code`. */
export async function deleteMedia(id, request, env) {
  if (!sameOrigin(request)) return json(403, { ok: false, error: "wrong_origin" });
  if (!MEDIA.idPattern.test(id) || !env?.DB) return json(404, { ok: false, error: "not_found" });
  const code = request.headers.get("x-delete-code") ?? "";
  try {
    const row = await env.DB.prepare("SELECT delete_hash FROM media WHERE id = ?").bind(id).first();
    if (!row) return json(404, { ok: false, error: "not_found" });
    if (!code || (await sha256(code)) !== row.delete_hash) return json(403, { ok: false, error: "wrong_code" });
    await env.DB.prepare("DELETE FROM media WHERE id = ?").bind(id).run();
    return json(200, { ok: true });
  } catch {
    return json(503, { ok: false, error: "not_ready" });
  }
}

/** Routes /api/media and /api/media/<id>. Returns a Response, or null when the address is not one of ours. */
export function handleMedia(request, env, options) {
  const { pathname } = new URL(request.url);
  const match = /^\/api\/media(?:\/([^/]+))?$/.exec(pathname);
  if (!match) return null;
  const id = match[1];
  if (!id) return request.method === "POST" ? uploadMedia(request, env, options) : json(405, { ok: false, error: "post_only" }, { allow: "POST" });
  if (request.method === "GET") return getMedia(id, env);
  if (request.method === "DELETE") return deleteMedia(id, request, env);
  return json(405, { ok: false, error: "method" }, { allow: "GET, DELETE" });
}
