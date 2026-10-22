// The upload side of alerts, over a real in-memory SQLite database with the real schema: what a file has to be, what is refused, what is
// served back (and how), who can delete, and the limits.

import test from "node:test";
import assert from "node:assert/strict";
import { MEDIA, handleMedia, sniff } from "../worker/media.mjs";
import worker from "../worker/index.mjs";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";

const SITE = "https://frills.example";
const fresh = () => ({ DB: localDatabase(":memory:") });
const bytes = (...parts) => Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const FILES = {
  png: bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13, 73, 72, 68, 82]),
  jpg: bytes([0xff, 0xd8, 0xff, 0xe0], [0, 16, 74, 70, 73, 70, 0, 1, 1, 0]),
  gif: bytes("GIF89a", [1, 0, 1, 0, 0, 0, 0, 0, 0]),
  webp: bytes("RIFF", [24, 0, 0, 0], "WEBP", "VP8 ", [0, 0, 0, 0]),
  wav: bytes("RIFF", [36, 0, 0, 0], "WAVE", "fmt ", [16, 0, 0, 0]),
  ogg: bytes("OggS", [0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  mp3id3: bytes("ID3", [3, 0, 0, 0, 0, 0, 33, 0, 0, 0]),
  mp3raw: bytes([0xff, 0xfb, 0x90, 0x64], [0, 0, 0, 0, 0, 0, 0, 0]),
};
const WANT = { png: ["image", "image/png"], jpg: ["image", "image/jpeg"], gif: ["image", "image/gif"], webp: ["image", "image/webp"], wav: ["sound", "audio/wav"], ogg: ["sound", "audio/ogg"], mp3id3: ["sound", "audio/mpeg"], mp3raw: ["sound", "audio/mpeg"] };

const upload = async (file, env, { origin = SITE, consent = "yes", type = "application/octet-stream", now } = {}) => {
  const headers = { "content-type": type, ...(origin ? { origin } : {}), ...(consent ? { "x-consent": consent } : {}) };
  const res = await handleMedia(new Request(`${SITE}/api/media`, { method: "POST", headers, body: file }), env, { now });
  return { status: res.status, body: await res.json() };
};
const get = (id, env) => handleMedia(new Request(`${SITE}/api/media/${id}`), env);
const remove = (id, code, env, origin = SITE) => handleMedia(new Request(`${SITE}/api/media/${id}`, { method: "DELETE", headers: { ...(origin ? { origin } : {}), ...(code ? { "x-delete-code": code } : {}) } }), env);

test("each kind of file is recognised by what it is, not by what the browser says", async () => {
  for (const [name, [kind, mime]] of Object.entries(WANT)) {
    assert.deepEqual(sniff(FILES[name]) && [sniff(FILES[name]).kind, sniff(FILES[name]).mime], [kind, mime], name);
    const env = fresh();
    const res = await upload(FILES[name], env, { type: "text/plain" });
    assert.equal(res.status, 201, name);
    assert.deepEqual([res.body.kind, res.body.mime, res.body.size], [kind, mime, FILES[name].length], name + ": the real type is what is stored");
  }
});

test("anything else is refused: scripts, pictures that can run code, documents, empty and tiny files", async () => {
  const env = fresh();
  for (const [name, file] of Object.entries({
    svg: bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    html: bytes("<!doctype html><script>alert(1)</script>"),
    exe: bytes("MZ", [144, 0, 3, 0, 0, 0, 4, 0, 0, 0, 255, 255]),
    zip: bytes("PK", [3, 4, 20, 0, 0, 0, 8, 0, 0, 0, 0, 0]),
    empty: new Uint8Array(0),
    tiny: bytes([1, 2, 3]),
  })) {
    const res = await upload(file, env);
    assert.equal(res.status, 415, name);
    assert.equal(res.body.error, "bad_type", name);
  }
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM media").get().n, 0);
});

const padded = (file, size) => { const out = new Uint8Array(size); out.set(file); return out; };

test("a picture or GIF can be up to 1 MB and a sound up to 300 KB, and a file over its limit is refused whether or not it says how big it is", async () => {
  assert.deepEqual([MEDIA.maxImageBytes, MEDIA.maxBytes], [1024 * 1024, 300 * 1024]);
  const env = fresh();
  const tooBigPicture = await upload(padded(FILES.png, MEDIA.maxImageBytes + 1), env);
  assert.deepEqual([tooBigPicture.status, tooBigPicture.body.error, tooBigPicture.body.kind], [413, "too_big", "image"]);
  const tooBigSound = await upload(padded(FILES.wav, MEDIA.maxBytes + 1), env);
  assert.deepEqual([tooBigSound.status, tooBigSound.body.error, tooBigSound.body.kind], [413, "too_big", "sound"], "300 KB is still the most for a sound");
  assert.equal((await upload(padded(FILES.gif, 900 * 1024), env)).status, 201, "a 900 KB GIF is fine now");
  const exactPicture = await upload(padded(FILES.png, MEDIA.maxImageBytes), env);
  assert.deepEqual([exactPicture.status, exactPicture.body.size], [201, MEDIA.maxImageBytes], "exactly the limit is fine");
  const back = await get(exactPicture.body.id, env);
  assert.equal((await back.arrayBuffer()).byteLength, MEDIA.maxImageBytes, "and the whole file comes back");
  assert.equal((await upload(padded(FILES.ogg, MEDIA.maxBytes), env)).status, 201);
  const declared = await handleMedia(new Request(`${SITE}/api/media`, { method: "POST", headers: { origin: SITE, "x-consent": "yes", "content-length": String(MEDIA.maxImageBytes * 2) }, body: FILES.png }), env);
  assert.equal(declared.status, 413, "a file that says it is far too big is turned away before it is read");
});

test("the biggest picture still fits in one D1 value once it is text (D1 takes 2,000,000 bytes in a value)", () => {
  const asText = Math.ceil(MEDIA.maxImageBytes / 3) * 4;
  assert.ok(asText < 2_000_000, `a ${MEDIA.maxImageBytes}-byte file is ${asText} characters as base64`);
});

test("uploads are also capped by how many bytes came in the last hour, and the ceiling on everything stored is under what a free D1 database holds", async () => {
  assert.ok(MEDIA.totalBytes * (4 / 3) < 500 * 1024 * 1024, "300 MB of files is 400 MB as text, under the 500 MB of a free database");
  const env = fresh();
  const before = MEDIA.perHourBytes;
  MEDIA.perHourBytes = 2500;
  try {
    const now = Date.parse("2026-10-22T12:00:00Z");
    assert.equal((await upload(padded(FILES.png, 1200), env, { now })).status, 201);
    assert.equal((await upload(padded(FILES.png, 1200), env, { now: now + 1000 })).status, 201);
    const third = await upload(padded(FILES.png, 1200), env, { now: now + 2000 });
    assert.deepEqual([third.status, third.body.error], [429, "busy"], "the third would take it over the hour's bytes");
    assert.equal((await upload(padded(FILES.png, 1200), env, { now: now + 3700 * 1000 })).status, 201, "an hour later there is room again");
  } finally { MEDIA.perHourBytes = before; }
});

test("the upload needs the rights tick and comes from this site's own page", async () => {
  const env = fresh();
  assert.equal((await upload(FILES.png, env, { consent: "" })).body.error, "no_consent");
  assert.equal((await upload(FILES.png, env, { consent: "maybe" })).body.error, "no_consent");
  assert.equal((await upload(FILES.png, env, { origin: "https://evil.example" })).status, 403);
  assert.equal((await upload(FILES.png, env, { origin: "" })).status, 403);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM media").get().n, 0);
});

test("the file comes back exactly as it went in, with safe headers and a day of caching", async () => {
  const env = fresh();
  const { body } = await upload(FILES.gif, env);
  assert.match(body.id, MEDIA.idPattern);
  const res = await get(body.id, env);
  assert.equal(res.status, 200);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), FILES.gif);
  assert.equal(res.headers.get("content-type"), "image/gif");
  assert.equal(res.headers.get("cache-control"), "public, max-age=86400", "visitors keep it a day, no longer");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("content-security-policy"), /default-src 'none'; sandbox/);
  assert.equal((await get("AAAAAAAAAAAAAAAA", env)).status, 404, "an id that does not exist");
  assert.equal(await get("../../etc/passwd", env), null, "a path trick is not our address at all");
  assert.equal((await get("not%20an%20id%21%21%21%21", env)).status, 404, "an id that is not an id");
  assert.equal((await get("short", env)).status, 404);
});

test("only the person with the delete code can delete, and the code itself is never stored", async () => {
  const env = fresh();
  const { body } = await upload(FILES.mp3id3, env);
  const row = env.DB.raw.prepare("SELECT * FROM media WHERE id = ?").get(body.id);
  assert.equal(row.delete_hash.length, 64);
  assert.ok(![row.id, row.data, row.delete_hash].includes(body.deleteCode), "the code is not in the database");
  assert.equal((await remove(body.id, "", env)).status, 403, "no code");
  assert.equal((await remove(body.id, "wrong-code-wrong-1", env)).status, 403, "wrong code");
  assert.equal((await remove(body.id, body.deleteCode, env, "https://evil.example")).status, 403, "wrong site");
  assert.equal((await get(body.id, env)).status, 200, "still there");
  assert.equal((await remove(body.id, body.deleteCode, env)).status, 200);
  assert.equal((await get(body.id, env)).status, 404, "gone");
  assert.equal((await remove(body.id, body.deleteCode, env)).status, 404, "and already gone");
});

test("each upload gets its own id and delete code", async () => {
  const env = fresh();
  const a = (await upload(FILES.png, env)).body;
  const b = (await upload(FILES.png, env)).body;
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.deleteCode, b.deleteCode);
  assert.equal((await remove(a.id, b.deleteCode, env)).status, 403, "b's code does not delete a's file");
});

test("after an hour's limit of uploads, more wait; and a full store takes no more", async () => {
  const env = fresh();
  const now = Date.UTC(2026, 9, 11, 12, 0, 0);
  for (let i = 0; i < MEDIA.perHour; i++) assert.equal((await upload(FILES.png, env, { now: now + i })).status, 201);
  const refused = await handleMedia(new Request(`${SITE}/api/media`, { method: "POST", headers: { origin: SITE, "x-consent": "yes" }, body: FILES.png }), env, { now: now + 60_000 });
  assert.equal(refused.status, 429);
  assert.equal((await upload(FILES.png, env, { now: now + 3600_000 + 60_000 })).status, 201, "an hour later it works again");

  const full = fresh();
  const before = MEDIA.totalBytes;
  MEDIA.totalBytes = 100;
  try {
    assert.equal((await upload(FILES.png, full)).status, 201);
    for (let i = 0; i < 10; i++) await upload(FILES.png, full); // together they pass 100 bytes
    assert.equal((await upload(FILES.png, full)).status, 507);
  } finally { MEDIA.totalBytes = before; }
});

test("with no database, or a broken one, uploads and downloads say so and do not crash", async () => {
  assert.equal((await upload(FILES.png, {})).body.error, "not_ready");
  const broken = { DB: { prepare() { throw new Error("no such table"); } } };
  assert.equal((await upload(FILES.png, broken)).status, 503);
  assert.equal((await get("AAAAAAAAAAAAAAAA", {})).status, 404);
});

test("the Worker serves media, and hands everything else on", async () => {
  const env = { ...fresh(), ASSETS: { fetch: async (req) => new Response(`asset ${new URL(req.url).pathname}`) } };
  const res = await worker.fetch(new Request(`${SITE}/api/media`, { method: "POST", headers: { origin: SITE, "x-consent": "yes" }, body: FILES.webp }), env, {});
  assert.equal(res.status, 201);
  const { id } = await res.json();
  assert.equal((await worker.fetch(new Request(`${SITE}/api/media/${id}`), env, {})).headers.get("content-type"), "image/webp");
  assert.equal(await (await worker.fetch(new Request(`${SITE}/privacy/`), env, {})).text(), "asset /privacy/");
  assert.equal(handleMedia(new Request(`${SITE}/api/other`), env), null);
  assert.equal((await handleMedia(new Request(`${SITE}/api/media`, { method: "GET" }), env)).status, 405);
});

test("the edge keeps a file for an hour only, and a delete clears it at once", async () => {
  const stored = new Map();
  const pending = [];
  const real = Object.getOwnPropertyDescriptor(globalThis, "caches");
  Object.defineProperty(globalThis, "caches", { configurable: true, value: { default: {
    match: async (req) => stored.get(req.url)?.clone(),
    put: async (req, res) => { stored.set(req.url, res); },
    delete: async (req) => stored.delete(req.url),
  } } });
  try {
    const env = { ...fresh(), ASSETS: { fetch: async () => new Response("asset") } };
    const ctx = { waitUntil: (p) => pending.push(p) };
    const up = await worker.fetch(new Request(`${SITE}/api/media`, { method: "POST", headers: { origin: SITE, "x-consent": "yes" }, body: FILES.png }), env, ctx);
    const { id, deleteCode } = await up.json();
    const first = await worker.fetch(new Request(`${SITE}/api/media/${id}?x=1`), env, ctx);
    assert.equal(first.headers.get("cache-control"), "public, max-age=86400", "the visitor gets a day");
    await Promise.all(pending);
    assert.equal(stored.size, 1, "one entry for the file");
    assert.equal([...stored.values()][0].headers.get("cache-control"), "public, max-age=3600", "the edge copy lives an hour");
    env.DB.raw.prepare("UPDATE media SET data = ? WHERE id = ?").run("AAAA", id);
    assert.deepEqual(new Uint8Array(await (await worker.fetch(new Request(`${SITE}/api/media/${id}`), env, ctx)).arrayBuffer()), FILES.png, "the second read comes from the edge, not the database");
    const del = await worker.fetch(new Request(`${SITE}/api/media/${id}`, { method: "DELETE", headers: { origin: SITE, "x-delete-code": deleteCode } }), env, ctx);
    assert.equal(del.status, 200);
    await Promise.all(pending);
    assert.equal(stored.size, 0, "the delete cleared the edge copy");
    assert.equal((await worker.fetch(new Request(`${SITE}/api/media/${id}`), env, ctx)).status, 404);
  } finally {
    if (real) Object.defineProperty(globalThis, "caches", real); else delete globalThis.caches;
  }
});
