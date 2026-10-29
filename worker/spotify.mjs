// The streamer's Spotify, kept by the Worker so the Spotify player works with the Frills page closed.
//
// Before this, the Frills page held the Spotify login in its browser and asked Spotify what was playing, so it had to stay open. Now the page hands
// the login over once (POST /api/spotify/<code>/login); the Worker keeps it, encrypted, and does the rest:
//  - the song playing: nowplaying.mjs calls `liveSong` each time the overlay reads and the stored song is a few seconds old;
//  - viewers' songs: the overlay (it is open in the streaming app anyway) passes each accepted !sr and !next on (POST .../request and .../next),
//    and the Worker looks the song up on Spotify and adds it to the streamer's queue, or skips.
//
// What is kept, and how: the login (Spotify's refresh token and access token) goes into the spotify_logins table encrypted with AES-GCM under a
// key that is only a secret of the Worker (SPOTIFY_TOKEN_KEY), never in the database or the code. Without that key the Worker answers "not_ready"
// and nothing here works. The login is deleted when the streamer presses Disconnect, and by the daily clean-up (`pruneSpotify`) after 14 days
// without use. It is never sent to a browser, a log or an answer. Spotify's own rules for this: a way to disconnect that deletes the person's
// data, and industry-standard care of it (developer.spotify.com/policy).
//
// Who can do what: like the post box, a streamer's browser makes a random code (in the overlay link, so the overlay can read and pass requests
// on) and a random key (kept only in that browser: needed to log in, disconnect, change the switches and read the log). The first login with a
// code claims it, storing only the key's hash. The overlay has only the code, so all it can do is read the song and pass on requests, slowly:
// at most one add or skip every 2 seconds and 200 an hour, so a leaked overlay link cannot flood the queue or take the login.
//
// The Spotify calls are given a `fetchImpl`, so this is tested without Spotify.

import { API_URL, TOKEN_URL, describe, tidyTrack } from "../src/js/spotify.js";
import { CODE, KEY, clean, json, sameOrigin, sha256 } from "./box.mjs";

/** How old the stored song may be before the next read of the post box asks Spotify again. */
export const REFRESH_MS = 2500;
const LIMITS = { bytes: 4096, rows: 200, keepDays: 14, minGapMs: 2000, perHour: 200, recentMs: 10 * 60 * 1000, logLines: 12, usedEveryMs: 3600 * 1000 };
const CLIENT_ID = /^[A-Za-z0-9]{16,64}$/;
const TOKEN = /^[A-Za-z0-9._~+/=-]{16,1500}$/;
const TRACK = /^spotify:track:[A-Za-z0-9]{22}$/;

// ── keeping the login encrypted ────────────────────────────────────────────────────────────────────────────────────

const bytesOf = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const base64 = (bytes) => btoa(String.fromCharCode(...bytes));
const words = new TextEncoder();

/** The Worker's key for the logins (SPOTIFY_TOKEN_KEY: 32 random bytes, in base64), or null when there is none or it is not usable. */
async function lock(env) {
  const raw = String(env?.SPOTIFY_TOKEN_KEY ?? "").trim().replace(/-/g, "+").replace(/_/g, "/");
  if (!raw) return null;
  try {
    const bytes = bytesOf(raw);
    return bytes.length === 32 ? await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]) : null;
  } catch {
    return null;
  }
}

/** Whether this Worker can keep logins: it has a database and a usable key. */
export const ready = async (env) => Boolean(env?.DB && (await lock(env)));

/** A login as the text kept in the database: a fresh random start, then the encrypted login, which also carries the code so a row cannot be moved to another. */
async function seal(env, code, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: words.encode(code) }, await lock(env), words.encode(JSON.stringify(value))));
  return base64(new Uint8Array([...iv, ...data]));
}

/** The login inside kept text, or null when it cannot be read (another key, damaged, or made for another code). */
async function open(env, code, text) {
  try {
    const all = bytesOf(text);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12), additionalData: words.encode(code) }, await lock(env), all.slice(12));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

// ── talking to Spotify with the kept login ─────────────────────────────────────────────────────────────────────────

const grab = (env, code) => env.DB.prepare("SELECT * FROM spotify_logins WHERE code = ?").bind(code).first();
const list = (text) => { try { const value = JSON.parse(text); return Array.isArray(value) ? value : []; } catch { return []; } };

/**
 * A login good for the next minute: the kept access token, or a new one from Spotify (the new refresh token Spotify may give is kept too).
 * Returns { access } or { error }: "expired" (Spotify no longer accepts the login, so the streamer has to log in again), "unreadable" or "spotify".
 */
async function access(env, row, { now, fetchImpl, force = false }) {
  const blob = await open(env, row.code, row.secret);
  if (!blob?.refresh || !CLIENT_ID.test(String(blob.clientId))) {
    await env.DB.prepare("UPDATE spotify_logins SET state = 'expired' WHERE code = ?").bind(row.code).run();
    return { error: "unreadable" };
  }
  if (!force && blob.access && blob.expires - now > 60000) return { access: blob.access };
  let res;
  let data;
  try {
    res = await fetchImpl(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: blob.refresh, client_id: blob.clientId }) });
    data = await res.json().catch(() => ({}));
  } catch {
    return { error: "spotify" };
  }
  if (res.ok && data.access_token) {
    const next = { clientId: blob.clientId, refresh: data.refresh_token || blob.refresh, access: data.access_token, expires: now + (Number(data.expires_in) || 3600) * 1000 };
    await env.DB.prepare("UPDATE spotify_logins SET secret = ?, state = 'ok', used_at = ? WHERE code = ?").bind(await seal(env, row.code, next), now, row.code).run();
    return { access: next.access };
  }
  if (res.status === 400 || res.status === 401) {
    // Spotify can hand a refresh token over to a newer one: if another request just renewed the login, use that one before giving up
    const latest = await grab(env, row.code);
    const other = latest ? await open(env, row.code, latest.secret) : null;
    if (other?.access && other.refresh !== blob.refresh && other.expires - now > 60000) return { access: other.access };
    await env.DB.prepare("UPDATE spotify_logins SET state = 'expired' WHERE code = ?").bind(row.code).run();
    return { error: "expired" };
  }
  return { error: "spotify" };
}

/** One call to Spotify as the streamer. Returns { status, data } or, when it went wrong, { status, error: "words", expired?, retryAfter? }. */
async function spotify(env, row, method, path, { query, now, fetchImpl }) {
  let got = await access(env, row, { now, fetchImpl });
  for (let attempt = 0; ; attempt++) {
    if (got.error === "spotify") return { status: 502, error: describe(502) };
    if (got.error) return { status: 401, error: describe(401), expired: true };
    let res;
    try {
      res = await fetchImpl(`${API_URL}${path}${query ? "?" + new URLSearchParams(query) : ""}`, { method, headers: { authorization: `Bearer ${got.access}` } });
    } catch {
      return { status: 502, error: describe(502) };
    }
    if (res.status === 401 && attempt === 0) { got = await access(env, row, { now, fetchImpl, force: true }); continue; }
    if (res.status === 204) return { status: 204, data: null };
    const data = await res.json().catch(() => null);
    if (res.ok) return { status: res.status, data };
    const retryAfter = Number(res.headers?.get?.("retry-after")) || 0;
    return { status: res.status, data, error: describe(res.status, data?.error?.reason ?? data?.error?.message ?? "", retryAfter), expired: res.status === 401, retryAfter };
  }
}

// ── what is playing (for nowplaying.mjs) ───────────────────────────────────────────────────────────────────────────

/**
 * Asked by the post box when the overlay reads and the stored song is a few seconds old. Says what to do:
 *  { kind: "none" }     this code has no kept login (or the Worker cannot keep any): the post box works as it always did;
 *  { kind: "hidden" }   the streamer turned sharing off: nothing is shown;
 *  { kind: "keep" }     Spotify could not be asked just now (login ran out, or told us to slow down): keep what is stored;
 *  { kind: "song", song, keyHash }  what Spotify says is playing now (title "" when nothing is).
 * Never throws: if the table is missing (not set up yet) it is simply "none", so the post box keeps working for everyone else.
 */
export async function liveSong(env, code, { now, fetchImpl }) {
  try {
    if (!(await ready(env))) return { kind: "none" };
    const row = await grab(env, code);
    if (!row) return { kind: "none" };
    if (!row.share) return { kind: "hidden" };
    if (row.state !== "ok" || now < row.hold_until) return { kind: "keep" };
    const r = await spotify(env, row, "GET", "/me/player/currently-playing", { query: { additional_types: "track" }, now, fetchImpl });
    if (r.error) {
      if (r.status === 429 || r.status >= 500) await env.DB.prepare("UPDATE spotify_logins SET hold_until = ? WHERE code = ?").bind(now + Math.max(5, r.retryAfter || 0) * 1000, code).run();
      return { kind: "keep" };
    }
    if (now - row.used_at > LIMITS.usedEveryMs) await env.DB.prepare("UPDATE spotify_logins SET used_at = ? WHERE code = ?").bind(now, code).run();
    const item = r.data?.item;
    const track = item ? tidyTrack(item) : null;
    const song = track
      ? { playing: r.data.is_playing === true, title: track.title, artist: track.artist, cover: track.cover, progressMs: Number(r.data.progress_ms) || 0, durationMs: Number(item.duration_ms) || 0 }
      : { playing: false, title: "", artist: "", cover: "", progressMs: 0, durationMs: 0 };
    return { kind: "song", song, keyHash: row.key_hash };
  } catch {
    return { kind: "none" };
  }
}

// ── the answers ────────────────────────────────────────────────────────────────────────────────────────────────────

async function readJson(request) {
  const text = await request.text();
  if (text.length > LIMITS.bytes) return { tooBig: true };
  try { const body = JSON.parse(text); return { body: body && typeof body === "object" ? body : {} }; } catch { return { body: {} }; }
}

/** Writes down what happened (for the streamer to read in the editor), and what was queued, and counts it against the hour's limit. */
async function record(env, row, now, { state, text, recent = null, acted = false }) {
  const entry = { at: now, state, text: clean(text, 220) };
  const log = [entry, ...list(row.log)].slice(0, LIMITS.logLines);
  const sameHour = now - row.hour_start < 3600 * 1000;
  const count = (sameHour ? row.hour_count : 0) + (acted ? 1 : 0);
  await env.DB.prepare("UPDATE spotify_logins SET log = ?, recent = ?, last_act = ?, hour_start = ?, hour_count = ?, used_at = ? WHERE code = ?")
    .bind(JSON.stringify(log), JSON.stringify(recent ?? list(row.recent)), acted ? now : row.last_act, sameHour ? row.hour_start : now, count, now, row.code).run();
  return entry;
}

/** Whether this row may add or skip now: not within 2 seconds of the last one, and not more than 200 in an hour. */
function slow(row, now) {
  if (now - row.last_act < LIMITS.minGapMs) return json(429, { ok: false, error: "too_fast" }, { "retry-after": "2" });
  if (now - row.hour_start < 3600 * 1000 && row.hour_count >= LIMITS.perHour) return json(429, { ok: false, error: "too_many" }, { "retry-after": "60" });
  return null;
}

async function login({ env, code, now, fetchImpl, request, keyHash }) {
  if (!keyHash) return json(401, { ok: false, error: "no_key" });
  const { body, tooBig } = await readJson(request);
  if (tooBig) return json(413, { ok: false, error: "too_big" });
  const clientId = String(body.clientId ?? "");
  const refresh = String(body.refresh ?? "");
  const given = String(body.access ?? "");
  if (!CLIENT_ID.test(clientId) || !TOKEN.test(refresh) || (given && !TOKEN.test(given))) return json(400, { ok: false, error: "bad_data" });
  const existing = await grab(env, code);
  if (existing && existing.key_hash !== keyHash) return json(403, { ok: false, error: "wrong_key" });
  const box = await env.DB.prepare("SELECT key_hash FROM nowplaying WHERE code = ?").bind(code).first();
  if (!existing && box && box.key_hash !== keyHash) return json(403, { ok: false, error: "wrong_key" }); // that code already belongs to another browser
  if (!existing) {
    await pruneSpotify(env, now);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM spotify_logins").first();
    if ((count?.n ?? 0) >= LIMITS.rows) return json(507, { ok: false, error: "full" });
  }
  const expires = Number(body.expires) || 0;
  const secret = await seal(env, code, { clientId, refresh, access: given && expires - now > 60000 ? given : "", expires: given ? expires : 0 });
  await env.DB.prepare("INSERT INTO spotify_logins (code, key_hash, secret, state, created_at, used_at) VALUES (?, ?, ?, 'ok', ?, ?) ON CONFLICT(code) DO UPDATE SET secret = excluded.secret, state = 'ok', hold_until = 0, used_at = excluded.used_at")
    .bind(code, keyHash, secret, now, now).run();
  // prove the login works before saying yes (and learn whose it is): a person who is not on the app's allowlist is told now, not later
  const me = await spotify(env, await grab(env, code), "GET", "/me", { now, fetchImpl });
  if (me.error) {
    if (existing) await env.DB.prepare("UPDATE spotify_logins SET secret = ?, state = ? WHERE code = ?").bind(existing.secret, existing.state, code).run();
    else await env.DB.prepare("DELETE FROM spotify_logins WHERE code = ?").bind(code).run();
    return json(me.status === 403 ? 403 : 400, { ok: false, error: me.status === 403 ? "not_allowed" : "bad_login", message: me.error });
  }
  const name = clean(me.data?.display_name ?? me.data?.id, 60);
  await env.DB.prepare("UPDATE spotify_logins SET name = ? WHERE code = ?").bind(name, code).run();
  const row = await grab(env, code);
  return json(200, { ok: true, name, share: row.share === 1, queue: row.queue === 1 });
}

async function disconnect({ env, code, keyHash }) {
  if (!keyHash) return json(401, { ok: false, error: "no_key" });
  const row = await grab(env, code);
  if (row && row.key_hash !== keyHash) return json(403, { ok: false, error: "wrong_key" });
  // gone at once: the login, and the song that was being shown
  await env.DB.prepare("DELETE FROM spotify_logins WHERE code = ?").bind(code).run();
  await env.DB.prepare("DELETE FROM nowplaying WHERE code = ?").bind(code).run();
  return json(200, { ok: true });
}

async function status({ env, code, now, keyHash }) {
  if (!keyHash) return json(401, { ok: false, error: "no_key" });
  const row = await grab(env, code);
  if (!row) return json(200, { ok: true, connected: false, now });
  if (row.key_hash !== keyHash) return json(403, { ok: false, error: "wrong_key" });
  return json(200, { ok: true, connected: true, state: row.state, name: row.name, share: row.share === 1, queue: row.queue === 1, log: list(row.log), now });
}

async function settings({ env, code, request, keyHash }) {
  if (!keyHash) return json(401, { ok: false, error: "no_key" });
  const row = await grab(env, code);
  if (!row) return json(404, { ok: false, error: "not_connected" });
  if (row.key_hash !== keyHash) return json(403, { ok: false, error: "wrong_key" });
  const { body, tooBig } = await readJson(request);
  if (tooBig) return json(413, { ok: false, error: "too_big" });
  const share = typeof body.share === "boolean" ? Number(body.share) : row.share;
  const queue = typeof body.queue === "boolean" ? Number(body.queue) : row.queue;
  await env.DB.prepare("UPDATE spotify_logins SET share = ?, queue = ? WHERE code = ?").bind(share, queue, code).run();
  if (!share) await env.DB.prepare("DELETE FROM nowplaying WHERE code = ?").bind(code).run(); // not shown, so not kept
  return json(200, { ok: true, share: share === 1, queue: queue === 1 });
}

/** A viewer's !sr, passed on by the overlay (or the editor's "try it" box, which has the key and may only practice when the switch is off). */
async function addSong({ env, code, now, fetchImpl, request, keyHash }) {
  const row = await grab(env, code);
  if (!row) return json(404, { ok: false, error: "not_connected" });
  if (keyHash && keyHash !== row.key_hash) return json(403, { ok: false, error: "wrong_key" });
  const { body, tooBig } = await readJson(request);
  if (tooBig) return json(413, { ok: false, error: "too_big" });
  const practice = Boolean(keyHash) && body.test === true;
  if (row.state !== "ok") return json(409, { ok: false, error: "expired", message: describe(401) });
  if (!row.queue && !practice) return json(200, { ok: true, ignored: "queue_off" });
  const query = clean(body.query, 80);
  if (query.length < 2) return json(400, { ok: false, error: "bad_data" });
  const who = clean(body.name, 40) || "viewer";
  const tooSoon = slow(row, now);
  if (tooSoon) return tooSoon;
  const found = await spotify(env, row, "GET", "/search", { query: { q: query, type: "track", limit: "5" }, now, fetchImpl });
  if (found.error) {
    const entry = await record(env, row, now, { state: "error", text: `${who} asked for “${query}”: ${found.error}`, acted: true });
    return json(found.expired ? 409 : 502, { ok: false, error: found.expired ? "expired" : "spotify", message: found.error, entry });
  }
  const song = (found.data?.tracks?.items ?? []).map(tidyTrack).find((t) => TRACK.test(t.uri));
  if (!song) return json(200, { ok: true, ignored: "not_found", entry: await record(env, row, now, { state: "info", text: `${who} asked for “${query}”: Spotify found nothing.`, acted: true }) });
  const recent = list(row.recent).filter(([, at]) => now - at <= LIMITS.recentMs);
  if (recent.some(([uri]) => uri === song.uri)) return json(200, { ok: true, ignored: "recent", entry: await record(env, row, now, { state: "info", text: `${who} asked for “${song.title}”: it was queued a moment ago.`, recent, acted: true }) });
  const label = `“${song.title}” · ${song.artist}`;
  const kept = [...recent, [song.uri, now]].slice(-20);
  if (!row.queue) return json(200, { ok: true, practice: true, entry: await record(env, row, now, { state: "ok", text: `${who} asked for ${label}. (Practice: not added to your queue.)`, recent: kept, acted: true }) });
  const added = await spotify(env, row, "POST", "/me/player/queue", { query: { uri: song.uri }, now, fetchImpl });
  if (added.error) return json(added.expired ? 409 : 502, { ok: false, error: added.expired ? "expired" : "spotify", message: added.error, entry: await record(env, row, now, { state: "error", text: `${who} asked for ${label}: ${added.error}`, acted: true }) });
  return json(200, { ok: true, added: true, title: song.title, artist: song.artist, entry: await record(env, row, now, { state: "ok", text: `${who}: ${label} was added to your Spotify queue.`, recent: kept, acted: true }) });
}

/** A !next from the streamer or a moderator, passed on by the overlay (which has already checked who typed it). */
async function skipSong({ env, code, now, fetchImpl, request, keyHash }) {
  const row = await grab(env, code);
  if (!row) return json(404, { ok: false, error: "not_connected" });
  if (keyHash && keyHash !== row.key_hash) return json(403, { ok: false, error: "wrong_key" });
  const { body, tooBig } = await readJson(request);
  if (tooBig) return json(413, { ok: false, error: "too_big" });
  const practice = Boolean(keyHash) && body.test === true;
  if (row.state !== "ok") return json(409, { ok: false, error: "expired", message: describe(401) });
  if (!row.queue && !practice) return json(200, { ok: true, ignored: "queue_off" });
  const who = clean(body.name, 40) || "someone";
  const tooSoon = slow(row, now);
  if (tooSoon) return tooSoon;
  if (!row.queue) return json(200, { ok: true, practice: true, entry: await record(env, row, now, { state: "ok", text: `${who} used !next. (Practice: nothing was skipped.)`, acted: true }) });
  const skipped = await spotify(env, row, "POST", "/me/player/next", { now, fetchImpl });
  if (skipped.error) return json(skipped.expired ? 409 : 502, { ok: false, error: skipped.expired ? "expired" : "spotify", message: skipped.error, entry: await record(env, row, now, { state: "error", text: `!next: ${skipped.error}`, acted: true }) });
  return json(200, { ok: true, skipped: true, entry: await record(env, row, now, { state: "ok", text: `${who} used !next: skipped to the next song.`, acted: true }) });
}

/** /api/spotify/<code>/<login | status | settings | request | next>. */
export async function handleSpotify(request, env, { now = Date.now(), fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const code = parts[2] ?? "";
  const action = parts[3] ?? "";
  if (parts.length !== 4 || !CODE.test(code) || !["login", "status", "settings", "request", "next"].includes(action)) return json(404, { ok: false, error: "not_found" });
  if (!(await ready(env))) return json(503, { ok: false, error: "not_ready" });
  const reads = request.method === "GET" && action === "status";
  if (!reads && !sameOrigin(request)) return json(403, { ok: false, error: "wrong_origin" });
  const key = request.headers.get("x-key") ?? "";
  const answer = { env, code, now, fetchImpl, request, keyHash: KEY.test(key) ? await sha256(key) : "" };
  try {
    const route = `${request.method} ${action}`;
    if (route === "POST login") return await login(answer);
    if (route === "DELETE login") return await disconnect(answer);
    if (route === "GET status") return await status(answer);
    if (route === "PUT settings") return await settings(answer);
    if (route === "POST request") return await addSong(answer);
    if (route === "POST next") return await skipSong(answer);
    return json(405, { ok: false, error: "method" });
  } catch {
    return json(503, { ok: false, error: "not_ready" });
  }
}

/** The clean-up, run once a day: logins (and shown songs) that have not been used for 14 days are deleted. */
export async function pruneSpotify(env, now = Date.now()) {
  const old = now - LIMITS.keepDays * 86400000;
  try {
    await env.DB.prepare("DELETE FROM spotify_logins WHERE used_at < ?").bind(old).run();
    await env.DB.prepare("DELETE FROM nowplaying WHERE updated_at < ?").bind(old).run();
  } catch { /* the table is not set up yet: nothing to clean */ }
}
