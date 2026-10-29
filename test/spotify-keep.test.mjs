// The two browser-side parts of "Frills keeps my Spotify login" (the Worker's part is in spotify-server.test.mjs): the editor's way of talking to the
// Worker (spotify-server.js), and the overlay's passing of !sr and !next on (spotify-forward.js).

import test from "node:test";
import assert from "node:assert/strict";
import { SpotifyServer, explain } from "../src/js/spotify-server.js";
import { SpotifyForward } from "../src/js/spotify-forward.js";
import { SONGS } from "../src/js/songs.js";

const CODE = "AbCdEfGhIjKlMnOp";
const KEY = "k".repeat(32);
const answer = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fetch that writes down what it was asked and answers with `reply`. */
function recorder(reply = () => answer({ ok: true })) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? "GET", headers: options.headers ?? {}, body: options.body === undefined ? undefined : JSON.parse(options.body) });
    return reply(url, options);
  };
  return { calls, fetchImpl };
}

// ── the editor's side ───────────────────────────────────────────────────────────────────────────────────────────────

test("the editor asks the Worker with its key, and sends a body only when there is one", async () => {
  const { calls, fetchImpl } = recorder();
  const server = new SpotifyServer({ code: CODE, key: KEY, fetchImpl });
  await server.status();
  await server.keep({ clientId: "c".repeat(32), refresh: "r".repeat(40), access: "a".repeat(40), expires: 123 });
  await server.settings({ queue: true });
  await server.disconnect();
  await server.request({ query: "levitating", name: "Bob" });
  await server.next({ name: "Streamer" });
  assert.deepEqual(calls.map((c) => [c.method, c.url]), [
    ["GET", `/api/spotify/${CODE}/status`],
    ["POST", `/api/spotify/${CODE}/login`],
    ["PUT", `/api/spotify/${CODE}/settings`],
    ["DELETE", `/api/spotify/${CODE}/login`],
    ["POST", `/api/spotify/${CODE}/request`],
    ["POST", `/api/spotify/${CODE}/next`],
  ]);
  assert.ok(calls.every((c) => c.headers["x-key"] === KEY), "every call carries the key");
  assert.equal(calls[0].body, undefined);
  assert.equal(calls[0].headers["content-type"], undefined, "no body, no content type");
  assert.equal(calls[1].headers["content-type"], "application/json");
  assert.deepEqual(calls[2].body, { queue: true });
  assert.deepEqual(calls[4].body, { query: "levitating", name: "Bob", test: true }, "the try-it box only ever practices unless the switch is on");
  assert.deepEqual(calls[5].body, { name: "Streamer", test: true });
});

test("what the Worker said comes back with its status, and a failure comes with words", async () => {
  const good = await new SpotifyServer({ code: CODE, key: KEY, fetchImpl: recorder(() => answer({ ok: true, connected: true, state: "ok", name: "Tester", share: true, queue: false, log: [] })).fetchImpl }).status();
  assert.deepEqual([good.ok, good.status, good.connected, good.name], [true, 200, true, "Tester"]);
  assert.equal(good.message, undefined);
  const notAllowed = await new SpotifyServer({ code: CODE, key: KEY, fetchImpl: recorder(() => answer({ ok: false, error: "not_allowed", message: "Spotify said no. ..." }, 403)).fetchImpl }).keep({});
  assert.deepEqual([notAllowed.ok, notAllowed.error, notAllowed.message], [false, "not_allowed", "Spotify said no. ..."], "the Worker's own words are kept");
  const notReady = await new SpotifyServer({ code: CODE, key: KEY, fetchImpl: recorder(() => answer({ ok: false, error: "not_ready" }, 503)).fetchImpl }).status();
  assert.equal(notReady.ok, false);
  assert.match(notReady.message, /cannot keep Spotify logins on this site yet/);
  const lying = await new SpotifyServer({ code: CODE, key: KEY, fetchImpl: recorder(() => answer({ ok: false, error: "x" }, 200)).fetchImpl }).settings({});
  assert.equal(lying.ok, false, "an answer that says it failed is a failure whatever the status");
  const broken = await new SpotifyServer({ code: CODE, key: KEY, fetchImpl: recorder(() => new Response("<html>", { status: 500 })).fetchImpl }).status();
  assert.deepEqual([broken.ok, broken.status, broken.message], [false, 500, "Frills answered with an error (500)."]);
  const offline = await new SpotifyServer({ code: CODE, key: KEY, fetchImpl: async () => { throw new TypeError("Failed to fetch"); } }).status();
  assert.deepEqual([offline.ok, offline.status, offline.error], [false, 0, "network"]);
  assert.match(offline.message, /Could not reach Frills/);
  for (const status of [0, 403, 429, 503, 507, 500]) assert.ok(explain(status).length > 20, `status ${status} has words`);
});

// ── the overlay's side ──────────────────────────────────────────────────────────────────────────────────────────────

const chat = (text, over = {}) => ({ id: "", user: "viewer1", name: "Ann", text, mod: false, host: false, login: "ann", ...over });
const forward = (over = {}) => {
  const clock = { t: 100000 };
  const rec = recorder();
  const f = new SpotifyForward({ code: CODE, channel: "pond_cafe", fetchImpl: rec.fetchImpl, now: () => clock.t, ...over });
  return { f, clock, calls: rec.calls };
};

test("the overlay passes a viewer's !sr on, with the words and the name, and with no key", async () => {
  const { f, calls } = forward();
  assert.equal(await f.handle(chat("!sr levitating dua lipa")), "sent");
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].method, calls[0].url, calls[0].body], ["POST", `/api/spotify/${CODE}/request`, { query: "levitating dua lipa", name: "Ann" }]);
  assert.equal(calls[0].headers["x-key"], undefined, "the overlay has only the code");
  assert.equal(await f.handle(chat("!songrequest dance monkey", { user: "viewer2", name: "Bob" })), "sent", "!songrequest always works");
  assert.equal(calls[1].body.name, "Bob");
});

test("the overlay follows the streamer's own command word", async () => {
  const { f, calls } = forward({ settings: { ...SONGS.defaults, command: "play" } });
  assert.equal(await f.handle(chat("!play levitating")), "sent");
  assert.equal(calls[0].body.query, "levitating");
});

test("one person's second !sr within 15 seconds is not passed on, and anyone else's is", async () => {
  const { f, clock, calls } = forward();
  assert.equal(await f.handle(chat("!sr one")), "sent");
  clock.t += 5000;
  assert.equal(await f.handle(chat("!sr two")), "too soon");
  assert.equal(await f.handle(chat("!sr three", { user: "viewer2" })), "sent");
  clock.t += 11000;
  assert.equal(await f.handle(chat("!sr four")), "sent", "15 seconds after the first");
  assert.equal(calls.length, 3);
});

test("the same chat message is passed on once, however many times it is delivered", async () => {
  const { f, calls } = forward();
  assert.equal(await f.handle(chat("!sr one", { id: "m1" })), "sent");
  assert.equal(await f.handle(chat("!sr one", { id: "m1", user: "viewer2" })), "repeat");
  assert.equal(calls.length, 1);
});

test("!next is passed on only from the streamer, from the host flag, or from a moderator when that is allowed", async () => {
  const { f, calls } = forward();
  assert.equal(await f.handle(chat("!next", { login: "stranger" })), "not allowed");
  assert.equal(await f.handle(chat("!next", { login: "Pond_Cafe", name: "Streamer" })), "sent", "the channel's own account, whatever the capitals");
  assert.equal(await f.handle(chat("!skip", { host: true })), "sent");
  assert.equal(await f.handle(chat("!next", { mod: true, login: "helper" })), "sent");
  assert.deepEqual(calls.map((c) => c.url), [`/api/spotify/${CODE}/next`, `/api/spotify/${CODE}/next`, `/api/spotify/${CODE}/next`]);
  assert.deepEqual(calls[0].body, { name: "Streamer" });
  const strict = forward({ settings: { ...SONGS.defaults, modsSkip: false } });
  assert.equal(await strict.f.handle(chat("!next", { mod: true, login: "helper" })), "not allowed");
  assert.equal(strict.calls.length, 0);
});

test("nothing else in chat is passed on, and a failing Worker never breaks the overlay", async () => {
  const { f, calls } = forward();
  assert.equal(await f.handle(chat("hello everyone")), "not a command");
  assert.equal(await f.handle(chat("!sr")), "not a command", "no song name");
  assert.equal(await f.handle(chat("!wrongsong")), "not for Spotify");
  assert.equal(await f.handle(null), "not a command");
  assert.equal(calls.length, 0);
  const down = new SpotifyForward({ code: CODE, channel: "pond_cafe", fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  assert.equal(await down.handle(chat("!sr levitating")), "failed");
});

// ── the two sides together ──────────────────────────────────────────────────────────────────────────────────────────

test("the editor's client, the overlay's forwarder and the Worker agree on every message (all three real, Spotify made up)", async () => {
  const { handleSpotify } = await import("../worker/spotify.mjs");
  const { localDatabase } = await import("../scripts/lib/d1-sqlite.mjs");
  const SITE = "https://frills.example";
  const uri = "spotify:track:" + "L".repeat(22);
  const asked = [];
  const spotify = async (url, options = {}) => {
    const u = new URL(url);
    asked.push(`${options.method ?? "GET"} ${u.pathname}`);
    if (u.pathname === "/v1/me") return answer({ display_name: "Tester" });
    if (u.pathname === "/v1/search") return answer({ tracks: { items: [{ id: "L".repeat(22), uri, name: "Levitating", duration_ms: 1000, artists: [{ name: "Dua Lipa" }], album: { images: [] } }] } });
    return new Response(null, { status: 204 });
  };
  const env = { DB: localDatabase(":memory:"), SPOTIFY_TOKEN_KEY: Buffer.alloc(32, 3).toString("base64") };
  let now = 1_000_000_000_000;
  const toWorker = (url, options = {}) => handleSpotify(new Request(SITE + url, { ...options, headers: { ...options.headers, origin: SITE } }), env, { now, fetchImpl: spotify });
  const editor = new SpotifyServer({ code: CODE, key: KEY, fetchImpl: toWorker });
  const overlay = new SpotifyForward({ code: CODE, channel: "pond_cafe", fetchImpl: toWorker, now: () => now });

  assert.deepEqual(await editor.status().then((s) => [s.ok, s.connected]), [true, false]);
  const kept = await editor.keep({ clientId: "c".repeat(32), refresh: "r".repeat(40), access: "a".repeat(40), expires: now + 3600_000 });
  assert.deepEqual([kept.ok, kept.name, kept.share, kept.queue], [true, "Tester", true, false]);
  assert.deepEqual(await editor.status().then((s) => [s.connected, s.state, s.name]), [true, "ok", "Tester"]);

  asked.length = 0;
  await overlay.handle(chat("!sr levitating dua lipa"));
  assert.deepEqual(asked, [], "the queue switch is off: the overlay's request reached the Worker and Spotify was not asked");
  assert.equal((await editor.settings({ queue: true })).queue, true);
  now += 20000;
  await overlay.handle(chat("!sr levitating dua lipa", { user: "viewer2", name: "Bob" }));
  assert.deepEqual(asked, ["GET /v1/search", "POST /v1/me/player/queue"], "the switch is on: found and queued");
  now += 5000;
  await overlay.handle(chat("!next", { login: "pond_cafe", name: "Streamer" }));
  assert.equal(asked.at(-1), "POST /v1/me/player/next");
  const lines = (await editor.status()).log.map((e) => e.text);
  assert.deepEqual(lines, ["Streamer used !next: skipped to the next song.", "Bob: “Levitating” · Dua Lipa was added to your Spotify queue."], "and the editor can read it afterwards");

  now += 10000;
  const practice = await editor.request({ query: "levitating", name: "Pretend viewer" });
  assert.equal(practice.ok, true);
  assert.deepEqual(await editor.disconnect().then((d) => d.ok), true);
  assert.deepEqual(await editor.status().then((s) => s.connected), false);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM spotify_logins").get().n, 0, "gone");
});
