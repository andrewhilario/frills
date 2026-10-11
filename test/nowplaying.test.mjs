// "What is playing on Spotify" from a streamer's tab to their overlay: the post box (the Worker, over a real in-memory SQLite with the real
// schema), the tab's publishing rules, the overlay's reading, and how the overlay mixes Spotify's song with the chat's requests.

import test from "node:test";
import assert from "node:assert/strict";
import { handleNowPlaying, tidy } from "../worker/nowplaying.mjs";
import worker from "../worker/index.mjs";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";
import { Publisher, bridgeIdentity, validCode, watchSpotify } from "../src/js/spotify-bridge.js";
import { isPlaying, spotifyLayer, withSpotify } from "../src/js/songs-spotify.js";

const SITE = "https://frills.example";
const CODE = "AbCdEfGhIjKlMnOp";
const KEY = "k".repeat(32);
const fresh = () => ({ DB: localDatabase(":memory:") });
const song = (over = {}) => ({ playing: true, title: "Without Me", artist: "Dayseeker", cover: "https://i.scdn.co/image/ab67616d00001e02abc", progressMs: 165000, durationMs: 225000, ...over });
const put = (env, body, { code = CODE, key = KEY, origin = SITE, now } = {}) =>
  handleNowPlaying(new Request(`${SITE}/api/nowplaying/${code}`, { method: "PUT", headers: { ...(origin ? { origin } : {}), ...(key ? { "x-key": key } : {}), "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }), env, { now });
const get = (env, code = CODE, now) => handleNowPlaying(new Request(`${SITE}/api/nowplaying/${code}`), env, { now });

// ── the post box ────────────────────────────────────────────────────────────────────────────────────────────────────

test("the tab puts the song in, and the overlay reads it with the post box's own clock", async () => {
  const env = fresh();
  assert.equal((await get(env)).status, 404, "nothing yet");
  const wrote = await put(env, song(), { now: 1000 });
  assert.equal(wrote.status, 200);
  const read = await (await get(env, CODE, 5000)).json();
  assert.deepEqual([read.ok, read.now, read.updatedAt], [true, 5000, 1000]);
  assert.deepEqual(read.data, song());
  assert.equal((await get(env)).headers.get("cache-control"), "no-store");
});

test("only the key that made a code can change it, and only from the site itself, and not too fast", async () => {
  const env = fresh();
  await put(env, song(), { now: 1000 });
  assert.equal((await put(env, song({ title: "Hijack" }), { key: "z".repeat(32), now: 5000 })).status, 403, "another key");
  assert.equal((await put(env, song({ title: "Hijack" }), { origin: "https://evil.example", now: 5000 })).status, 403, "another site");
  assert.equal((await put(env, song({ title: "Hijack" }), { origin: "", now: 5000 })).status, 403, "no origin at all");
  assert.equal((await put(env, song(), { key: "", now: 5000 })).status, 401, "no key");
  assert.equal((await put(env, song(), { key: "short", now: 5000 })).status, 401, "a key that is too short");
  assert.equal((await (await get(env)).json()).data.title, "Without Me", "none of those changed it");
  assert.equal((await put(env, song({ title: "Next" }), { now: 1200 })).status, 429, "twice within a moment");
  assert.equal((await put(env, song({ title: "Next" }), { now: 2000 })).status, 200);
  assert.equal((await (await get(env)).json()).data.title, "Next");
  const db = env.DB.raw.prepare("SELECT key_hash FROM nowplaying WHERE code = ?").get(CODE);
  assert.ok(db.key_hash && !db.key_hash.includes(KEY), "only a hash of the key is stored");
});

test("whatever is sent, the overlay is told only short texts, numbers, and a picture from Spotify's own server", async () => {
  assert.deepEqual(tidy({ playing: "yes", title: "A\u0000B\n" + "x".repeat(400), artist: 5, cover: "https://evil.example/a.gif", progressMs: -5, durationMs: 1e12, extra: "<script>" }), {
    playing: false, title: ("A B " + "x".repeat(400)).slice(0, 160), artist: "5", cover: "", progressMs: 0, durationMs: 4 * 3600 * 1000,
  });
  assert.equal(tidy({ cover: "https://i.scdn.co/image/ab67616d00001e02abc" }).cover, "https://i.scdn.co/image/ab67616d00001e02abc");
  assert.equal(tidy({ cover: "https://i.scdn.co/image/../../x" }).cover, "", "no path tricks");
  assert.equal(tidy(null), null);
  const env = fresh();
  assert.equal((await put(env, "{ not json")).status, 400);
  assert.equal((await put(env, "[1,2]")).status, 200, "an array is just empty data, not a crash");
  assert.equal((await put(env, JSON.stringify({ title: "x".repeat(5000) }), { code: "ZyXwVuTsRqPoNmLk" })).status, 413, "too big");
});

test("bad codes are refused, the table is capped, old rows go, and the Worker routes /api/nowplaying", async () => {
  const env = fresh();
  assert.equal((await get(env, "short")).status, 404);
  assert.equal((await get(env, "has space in code!")).status, 404);
  assert.equal((await handleNowPlaying(new Request(`${SITE}/api/nowplaying/${CODE}`, { method: "DELETE" }), env)).status, 405);
  assert.equal((await get({}, CODE)).status, 503, "no database: not ready, not a crash");
  await put(env, song(), { now: 1000 });
  env.DB.raw.prepare("INSERT INTO nowplaying (code, key_hash, data, updated_at) VALUES (?, 'h', '{}', ?)").run("OldOldOldOldOld1", 1);
  await put(env, song(), { code: "NewNewNewNewNew1", now: 20 * 86400000 });
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM nowplaying WHERE code = 'OldOldOldOldOld1'").get().n, 0, "a code unused for two weeks is cleared");
  const viaWorker = await worker.fetch(new Request(`${SITE}/api/nowplaying/NewNewNewNewNew1`), env, { waitUntil() {} });
  assert.equal(viaWorker.status, 200);
});

// ── the tab's end ───────────────────────────────────────────────────────────────────────────────────────────────────

const reply = (status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => ({ ok: true }) });
function pub(over = {}) {
  const sent = [];
  let time = 1000;
  const publisher = new Publisher({ code: CODE, key: KEY, now: () => time, fetchImpl: async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return reply(over.status ?? 200); }, onError: over.onError ?? (() => {}) });
  return { publisher, sent, advance: (ms) => { time += ms; } };
}

test("the tab sends the song only when something changed: a new song, play or pause, a jump, or the 20-second heartbeat", async () => {
  const { publisher, sent, advance } = pub();
  assert.equal(await publisher.send(song()), true, "the first reading");
  assert.equal(sent[0].url, "/api/nowplaying/" + CODE);
  assert.equal(sent[0].init.headers["x-key"], KEY);
  advance(3000);
  assert.equal(await publisher.send(song({ progressMs: 168000 })), false, "just playing on: the overlay counts forward itself");
  advance(3000);
  assert.equal(await publisher.send(song({ progressMs: 171000 })), false);
  assert.equal(await publisher.send(song({ progressMs: 200000 })), true, "skipped ahead");
  advance(1000);
  assert.equal(await publisher.send(song({ progressMs: 201000, playing: false })), true, "paused");
  advance(5000);
  assert.equal(await publisher.send(song({ progressMs: 201000, playing: false })), false, "still paused");
  assert.equal(await publisher.send(song({ title: "Another", progressMs: 0 })), true, "a new song");
  advance(21000);
  assert.equal(await publisher.send(song({ title: "Another", progressMs: 21000 })), true, "the heartbeat");
  assert.equal(sent.length, 5);
  assert.equal(await publisher.send(null), true, "nothing playing is also news");
  assert.equal(sent.at(-1).body.title, "");
});

test("a failed or too-quick send is not counted as sent, so it tries again, and the tab hears about errors", async () => {
  const errors = [];
  const busy = pub({ status: 429 });
  assert.equal(await busy.publisher.send(song()), false);
  assert.equal(busy.publisher.sent, null);
  const refused = pub({ status: 403, onError: (s) => errors.push(s) });
  assert.equal(await refused.publisher.send(song()), false);
  assert.deepEqual(errors, [403]);
  const down = new Publisher({ code: CODE, key: KEY, fetchImpl: async () => { throw new Error("offline"); }, onError: (s) => errors.push(s) });
  assert.equal(await down.send(song()), false);
  assert.deepEqual(errors, [403, 0]);
});

test("the code and the key are made once and kept, and a damaged store is replaced", () => {
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  const a = bridgeIdentity(storage);
  assert.match(a.code, /^[A-Za-z0-9_-]{16}$/);
  assert.match(a.key, /^[A-Za-z0-9_-]{32}$/);
  assert.deepEqual(bridgeIdentity(storage), a, "kept");
  data.set("frills:spotify:bridge", "{ nope");
  assert.notDeepEqual(bridgeIdentity(storage), a, "replaced when damaged");
  assert.equal(validCode(CODE), CODE);
  for (const bad of ["", "short", null, 5, "../../../../etc/pw"]) assert.equal(validCode(bad), "");
  assert.doesNotThrow(() => bridgeIdentity({ getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } }));
});

// ── the overlay's end ───────────────────────────────────────────────────────────────────────────────────────────────

test("the overlay reads the song, counts the position forward with the post box's clock, and treats a quiet tab as nothing playing", async () => {
  const readings = [];
  let reply1 = { ok: true, now: 10000, updatedAt: 4000, data: song({ progressMs: 60000 }) };
  const fetchImpl = async () => ({ ok: Boolean(reply1), json: async () => reply1 });
  const timers = [];
  const watch = watchSpotify(CODE, (s) => readings.push(s), { fetchImpl, now: () => 777, setTimer: (fn) => timers.push(fn) || 1, clearTimer() {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(readings[0].progressMs, 66000, "60 s plus the 6 s since the tab posted it");
  assert.equal(readings[0].at, 777);
  reply1 = { ok: true, now: 10000, updatedAt: 4000, data: song({ progressMs: 60000, playing: false }) };
  await timers.shift()();
  assert.equal(readings[1].progressMs, 60000, "paused: it does not move");
  reply1 = { ok: true, now: 200000, updatedAt: 4000, data: song() };
  await timers.shift()();
  assert.equal(readings[2], null, "nothing posted for over 90 seconds: the tab is gone");
  reply1 = null;
  await timers.shift()();
  assert.equal(readings[3], null, "no such code yet");
  watch.stop();
  assert.equal(timers.length, 1);
  await timers.shift()();
  assert.equal(readings.length, 4, "stopped: nothing more");
});

test("Spotify's song goes first and the requests wait below it, and a request Spotify has reached is no longer waiting", () => {
  const item = (key, title, query = title) => ({ key, title, query, artist: "", name: "Ann", state: "ready" });
  const playing = { ...song(), at: 5000, startedAt: 5000 - 165000 };
  assert.equal(isPlaying(item("a", "Without Me"), playing), true, "the same title");
  assert.equal(isPlaying(item("b", "without me dayseeker", "without me dayseeker"), playing), true, "the request's words are all in the title and artist");
  assert.equal(isPlaying(item("c", "Levitating"), playing), false);
  assert.equal(isPlaying(item("d", "x", "x"), playing), false, "too short to match on");
  const view = withSpotify([item("a", "Without Me"), item("c", "Levitating"), item("e", "Espresso")], playing, { max: 3 });
  assert.deepEqual([view.now.title, view.now.spotify, view.now.paused, view.now.seconds], ["Without Me", true, false, 225]);
  assert.deepEqual(view.next.map((i) => i.title), ["Levitating", "Espresso"], "the requests still waiting, with room for the song playing");
  assert.deepEqual([view.total, view.startedAt, view.at], [3, 5000 - 165000, 5000]);
  assert.equal(withSpotify([], { ...playing, playing: false }).now.paused, true);
});

test("the layer draws the queue until Spotify says something, then Spotify's song on top, and drops a request when Spotify reaches it", () => {
  const drawn = [];
  const items = [{ key: "q1", title: "Without Me", query: "without me", artist: "", name: "Ann", state: "ready" }, { key: "q2", title: "Levitating", query: "levitating", artist: "", name: "Ben", state: "ready" }];
  const queue = { items: [...items], settings: { max: 5 }, get view() { return { now: this.items[0] ?? null, next: this.items.slice(1), total: this.items.length, startedAt: 0, at: 0 }; }, remove(key) { this.items = this.items.filter((i) => i.key !== key); } };
  let push;
  const stops = [];
  const layer = spotifyLayer({ queue, view: { render: (v) => drawn.push(v) }, watch: (code, onSong) => { push = onSong; return { stop: () => stops.push(code) }; } });
  layer.apply({ spotify: "" });
  assert.equal(drawn.at(-1).now.key, "q1", "no code: the chat queue as before");
  layer.apply({ spotify: CODE });
  assert.equal(drawn.at(-1).now.key, "q1", "a code, but nothing posted yet");
  push({ ...song(), at: 1000, progressMs: 10000 });
  assert.equal(drawn.at(-1).now.spotify, true);
  assert.deepEqual(drawn.at(-1).next.map((i) => i.key), ["q2"], "q1 is the song playing, so it left the waiting list");
  assert.deepEqual(queue.items.map((i) => i.key), ["q2"]);
  const start = drawn.at(-1).startedAt;
  push({ ...song(), at: 3500, progressMs: 12500 });
  assert.equal(drawn.at(-1).startedAt, start, "the start is kept steady between readings");
  push({ ...song(), at: 6000, progressMs: 60000 });
  assert.notEqual(drawn.at(-1).startedAt, start, "until the position really jumped");
  push(null);
  assert.equal(drawn.at(-1).now.key, "q2", "the tab went quiet: back to the chat queue");
  layer.apply({ spotify: "ZyXwVuTsRqPoNmLk" });
  assert.deepEqual(stops, [CODE], "a different code stops the old reading");
  layer.apply({ spotify: "not valid" });
  assert.deepEqual(stops, [CODE, "ZyXwVuTsRqPoNmLk"]);
});
