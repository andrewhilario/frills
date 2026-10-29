// The Spotify login Frills keeps, so the Spotify player works with the Frills page closed (worker/spotify.mjs): the login is kept encrypted and
// only the right key can change it; the post box asks Spotify itself when the overlay reads; the overlay's !sr and !next reach the streamer's
// queue (slowly, and only when that is switched on); Disconnect and the daily clean-up delete everything. Run over a real in-memory SQLite with
// the real schema and a made-up Spotify.

import test from "node:test";
import assert from "node:assert/strict";
import { handleSpotify, liveSong, pruneSpotify, ready } from "../worker/spotify.mjs";
import { handleNowPlaying } from "../worker/nowplaying.mjs";
import worker from "../worker/index.mjs";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";

const SITE = "https://frills.example";
const CODE = "AbCdEfGhIjKlMnOp";
const KEY = "k".repeat(32);
const SECRET = Buffer.alloc(32, 7).toString("base64"); // a made-up Worker secret: 32 bytes
const CLIENT = "a".repeat(32);
const REFRESH = "refresh-token-" + "r".repeat(40);
const ACCESS = "access-token-" + "a".repeat(40);
const T0 = 1_000_000_000_000;

const id22 = (seed) => (seed + "x".repeat(22)).slice(0, 22).replace(/[^A-Za-z0-9]/g, "x");
const track = (name, artist, seed = name) => ({ id: id22(seed), uri: `spotify:track:${id22(seed)}`, name, duration_ms: 200000, artists: [{ name: artist }], album: { images: [{ url: "https://i.scdn.co/image/aaaaaaaaaaaa1" }, { url: "https://i.scdn.co/image/bbbbbbbbbbbb2" }, { url: "https://i.scdn.co/image/cccccccccccc3" }] } });
const reply = (body, status = 200, headers = {}) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** A made-up Spotify: answers the calls Frills makes and writes each one down. Change `spotify.*` to make it say something else. */
function fakeSpotify(over = {}) {
  const spotify = { calls: [], renewals: 0, rotate: false, refreshStatus: 200, meStatus: 200, playing: { is_playing: true, progress_ms: 12000, item: track("Without Me", "Dayseeker") }, queueStatus: 204, nextStatus: 204, found: [track("Levitating", "Dua Lipa")], ...over };
  spotify.fetch = async (url, options = {}) => {
    const u = new URL(url);
    const call = { method: options.method ?? "GET", host: u.hostname, path: u.pathname, query: Object.fromEntries(u.searchParams), auth: options.headers?.authorization ?? "", body: options.body ? String(options.body) : "" };
    spotify.calls.push(call);
    if (u.hostname === "accounts.spotify.com") {
      if (spotify.refreshStatus !== 200) return reply({ error: "invalid_grant" }, spotify.refreshStatus);
      spotify.renewals += 1;
      return reply({ access_token: `renewed-${spotify.renewals}-` + "n".repeat(30), expires_in: 3600, ...(spotify.rotate ? { refresh_token: `rotated-${spotify.renewals}-` + "r".repeat(30) } : {}) });
    }
    if (u.pathname === "/v1/me") return spotify.meStatus === 200 ? reply({ display_name: "Tester", id: "tester" }) : reply({ error: { status: spotify.meStatus, message: "User not registered in the Developer Dashboard" } }, spotify.meStatus);
    if (u.pathname === "/v1/me/player/currently-playing") return spotify.playing ? reply(spotify.playing) : new Response(null, { status: 204 });
    if (u.pathname === "/v1/search") return reply({ tracks: { items: spotify.found } });
    if (u.pathname === "/v1/me/player/queue") return spotify.queueStatus === 204 ? new Response(null, { status: 204 }) : reply({ error: { status: spotify.queueStatus, reason: spotify.queueStatus === 404 ? "NO_ACTIVE_DEVICE" : "PREMIUM_REQUIRED", message: "x" } }, spotify.queueStatus);
    if (u.pathname === "/v1/me/player/next") return spotify.nextStatus === 204 ? new Response(null, { status: 204 }) : reply({ error: { status: spotify.nextStatus } }, spotify.nextStatus);
    return reply({}, 404);
  };
  return spotify;
}

const fresh = (extra = {}) => ({ DB: localDatabase(":memory:"), SPOTIFY_TOKEN_KEY: SECRET, ...extra });
const call = (env, spotify, method, path, { code = CODE, key = KEY, origin = SITE, body, now = T0 } = {}) =>
  handleSpotify(new Request(`${SITE}/api/spotify/${code}/${path}`, { method, headers: { ...(origin ? { origin } : {}), ...(key ? { "x-key": key } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }), env, { now, fetchImpl: spotify.fetch });
const login = (env, spotify, over = {}, options = {}) => call(env, spotify, "POST", "login", { body: { clientId: CLIENT, refresh: REFRESH, access: ACCESS, expires: T0 + 3600_000, ...over }, ...options });
const nowPlaying = (env, spotify, now) => handleNowPlaying(new Request(`${SITE}/api/nowplaying/${CODE}`), env, { now, fetchImpl: spotify.fetch });
const row = (env) => env.DB.raw.prepare("SELECT * FROM spotify_logins WHERE code = ?").get(CODE);
const body = async (response) => response.json();
/** A connected streamer: logged in, with the Spotify queue switched on when asked. */
async function connected({ queue = false, ...over } = {}) {
  const env = fresh();
  const spotify = fakeSpotify(over);
  assert.equal((await login(env, spotify)).status, 200);
  if (queue) assert.equal((await call(env, spotify, "PUT", "settings", { body: { queue: true } })).status, 200);
  spotify.calls.length = 0;
  return { env, spotify };
}
const ask = (env, spotify, text, over = {}) => call(env, spotify, "POST", "request", { key: "", body: { query: text, name: "Ann", ...over.body }, ...over.options });

// ── keeping the login ───────────────────────────────────────────────────────────────────────────────────────────────

test("without the Worker's secret nothing is kept, and the post box carries on as before", async () => {
  const env = { DB: localDatabase(":memory:") };
  const spotify = fakeSpotify();
  assert.equal(await ready(env), false);
  assert.equal((await login(env, spotify)).status, 503);
  assert.equal((await (await login(env, spotify)).json()).error, "not_ready");
  assert.equal(spotify.calls.length, 0, "Spotify was not asked anything");
  assert.equal((await call(env, spotify, "GET", "status")).status, 503);
  assert.equal((await nowPlaying(env, spotify, T0)).status, 404, "the post box still answers, with nothing in it");
  for (const bad of ["", "not base64 at all", Buffer.alloc(16, 1).toString("base64")]) assert.equal(await ready({ DB: env.DB, SPOTIFY_TOKEN_KEY: bad }), false, `"${bad}" is not a usable key`);
});

test("a table that has not been made yet never breaks the post box", async () => {
  const env = fresh();
  env.DB.raw.exec("DROP TABLE spotify_logins");
  assert.deepEqual(await liveSong(env, CODE, { now: T0, fetchImpl: fakeSpotify().fetch }), { kind: "none" });
  assert.equal((await nowPlaying(env, fakeSpotify(), T0)).status, 404);
});

test("logging in: the login is proved with Spotify, kept encrypted, and never shown again", async () => {
  const env = fresh();
  const spotify = fakeSpotify();
  const done = await login(env, spotify);
  assert.equal(done.status, 200);
  assert.deepEqual(await done.json(), { ok: true, name: "Tester", share: true, queue: false });
  assert.equal(spotify.calls.map((c) => c.path).join(), "/v1/me", "it was proved by asking who it is");
  assert.equal(spotify.calls[0].auth, `Bearer ${ACCESS}`);
  const stored = row(env);
  assert.equal(stored.state, "ok");
  const dump = JSON.stringify(stored) + Buffer.from(stored.secret, "base64").toString("latin1"); // the row as stored, and the secret even if someone decoded the base64
  for (const part of [REFRESH, ACCESS, CLIENT]) assert.ok(!dump.includes(part), "no part of the login is readable in the database: encrypted, not just encoded");
  assert.ok(stored.key_hash && !stored.key_hash.includes(KEY), "only a hash of the key is stored");
  const state = await body(await call(env, spotify, "GET", "status"));
  assert.deepEqual([state.connected, state.state, state.name, state.share, state.queue], [true, "ok", "Tester", true, false]);
  assert.ok(!JSON.stringify(state).includes("token"), "the answer carries no login");
});

test("a login can be opened only with the Worker's key, and only for the code it was made for", async () => {
  const env = fresh();
  await login(env, fakeSpotify());
  const stored = row(env);
  const other = fresh({ SPOTIFY_TOKEN_KEY: Buffer.alloc(32, 9).toString("base64") });
  other.DB.raw.prepare("INSERT INTO spotify_logins (code, key_hash, secret, created_at, used_at) VALUES (?, ?, ?, 1, 1)").run(CODE, stored.key_hash, stored.secret);
  const spotify = fakeSpotify();
  assert.deepEqual(await liveSong(other, CODE, { now: T0, fetchImpl: spotify.fetch }), { kind: "keep" }, "another secret cannot read it: kept as it is");
  assert.equal(other.DB.raw.prepare("SELECT state FROM spotify_logins").get().state, "expired", "and it is marked as needing a new login");
  assert.equal(spotify.calls.length, 0);
  const moved = fresh();
  const elsewhere = "ZyXwVuTsRqPoNmLk";
  moved.DB.raw.prepare("INSERT INTO spotify_logins (code, key_hash, secret, created_at, used_at) VALUES (?, ?, ?, 1, 1)").run(elsewhere, stored.key_hash, stored.secret);
  assert.deepEqual(await liveSong(moved, elsewhere, { now: T0, fetchImpl: spotify.fetch }), { kind: "keep" }, "a row copied under another code cannot be opened");
});

test("only the key that made a code may change it, and only from the site itself", async () => {
  const env = fresh();
  const spotify = fakeSpotify();
  await login(env, spotify);
  assert.equal((await login(env, spotify, {}, { key: "z".repeat(32) })).status, 403, "another key");
  assert.equal((await login(env, spotify, {}, { origin: "https://evil.example" })).status, 403, "another site");
  assert.equal((await login(env, spotify, {}, { origin: "" })).status, 403, "no origin");
  assert.equal((await login(env, spotify, {}, { key: "" })).status, 401, "no key");
  assert.equal((await call(env, spotify, "GET", "status", { key: "z".repeat(32) })).status, 403, "another key cannot read the log");
  assert.equal((await call(env, spotify, "GET", "status", { key: "" })).status, 401);
  assert.equal((await call(env, spotify, "PUT", "settings", { key: "z".repeat(32), body: { queue: true } })).status, 403);
  assert.equal((await call(env, spotify, "DELETE", "login", { key: "z".repeat(32) })).status, 403);
  assert.equal((await call(env, spotify, "DELETE", "login", { origin: "https://evil.example" })).status, 403);
  assert.equal(row(env).queue, 0, "none of that changed anything");
  assert.equal((await call(env, spotify, "POST", "login", { code: "short", body: {} })).status, 404);
  assert.equal((await call(env, spotify, "GET", "bogus")).status, 404);
  assert.equal((await call(env, spotify, "PATCH", "login")).status, 405);
});

test("a login Spotify refuses is not kept: not on the app's allowlist, or not a real login", async () => {
  const env = fresh();
  const blocked = fakeSpotify({ meStatus: 403 });
  const refused = await login(env, blocked);
  assert.equal(refused.status, 403);
  const answer = await refused.json();
  assert.equal(answer.error, "not_allowed");
  assert.match(answer.message, /allowlist/);
  assert.equal(row(env), undefined, "nothing was kept");
  const bad = await login(env, fakeSpotify({ meStatus: 401, refreshStatus: 400 }), { access: "", expires: 0 });
  assert.equal(bad.status, 400);
  assert.equal(row(env), undefined);
  for (const wrong of [{ clientId: "no" }, { refresh: "short" }, { access: "bad token!" }]) assert.equal((await login(env, fakeSpotify(), wrong)).status, 400, JSON.stringify(wrong));
  assert.equal((await call(env, fakeSpotify(), "POST", "login", { body: "{ not json" })).status, 400);
  assert.equal((await call(env, fakeSpotify(), "POST", "login", { body: "x".repeat(5000) })).status, 413);
});

test("a second login keeps the switches, and a failed one leaves the first login as it was", async () => {
  const { env, spotify } = await connected({ queue: true });
  await call(env, spotify, "PUT", "settings", { body: { share: false } });
  const before = row(env).secret;
  assert.equal((await login(env, fakeSpotify({ meStatus: 403 }))).status, 403);
  assert.equal(row(env).secret, before, "the old login is still there");
  assert.equal((await login(env, spotify, { refresh: "second-" + "s".repeat(40) })).status, 200);
  assert.notEqual(row(env).secret, before);
  const state = await body(await call(env, spotify, "GET", "status"));
  assert.deepEqual([state.share, state.queue], [false, true], "the switches stayed as they were set");
});

test("the number of kept logins is limited, and old ones make room", async () => {
  const env = fresh();
  const spotify = fakeSpotify();
  const insert = env.DB.raw.prepare("INSERT INTO spotify_logins (code, key_hash, secret, created_at, used_at) VALUES (?, 'h', 's', ?, ?)");
  for (let i = 0; i < 200; i++) insert.run("C" + String(i).padStart(15, "0"), T0, T0);
  assert.equal((await login(env, spotify)).status, 507, "full");
  env.DB.raw.prepare("UPDATE spotify_logins SET used_at = ? WHERE code = 'C000000000000000'").run(T0 - 15 * 86400000);
  assert.equal((await login(env, spotify)).status, 200, "one idle for two weeks was cleared to make room");
});

// ── what is playing ─────────────────────────────────────────────────────────────────────────────────────────────────

test("the overlay's read asks Spotify itself, but no more than once in 2.5 seconds", async () => {
  const { env, spotify } = await connected();
  const first = await body(await nowPlaying(env, spotify, T0 + 1000));
  assert.deepEqual(first.data, { playing: true, title: "Without Me", artist: "Dayseeker", cover: "https://i.scdn.co/image/bbbbbbbbbbbb2", progressMs: 12000, durationMs: 200000 });
  assert.equal(first.updatedAt, T0 + 1000);
  assert.equal(spotify.calls.filter((c) => c.path.includes("currently-playing")).length, 1);
  await nowPlaying(env, spotify, T0 + 2000);
  await nowPlaying(env, spotify, T0 + 3400);
  assert.equal(spotify.calls.filter((c) => c.path.includes("currently-playing")).length, 1, "the stored song is still fresh");
  spotify.playing = { is_playing: true, progress_ms: 15000, item: track("Next Song", "Someone") };
  const later = await body(await nowPlaying(env, spotify, T0 + 3600));
  assert.equal(later.data.title, "Next Song");
  assert.equal(spotify.calls.filter((c) => c.path.includes("currently-playing")).length, 2);
  assert.equal(spotify.calls.find((c) => c.path.includes("currently-playing")).query.additional_types, "track");
});

test("nothing playing, a paused song, and a podcast are all shown sensibly", async () => {
  const { env, spotify } = await connected({ playing: null });
  assert.deepEqual((await body(await nowPlaying(env, spotify, T0 + 1000))).data, { playing: false, title: "", artist: "", cover: "", progressMs: 0, durationMs: 0 });
  spotify.playing = { is_playing: false, progress_ms: 5000, item: track("Quiet", "Band") };
  const paused = (await body(await nowPlaying(env, spotify, T0 + 4000))).data;
  assert.deepEqual([paused.playing, paused.title, paused.progressMs], [false, "Quiet", 5000]);
  spotify.playing = { is_playing: true, progress_ms: 1, item: { name: "An episode", duration_ms: 60000, show: { name: "A show" }, images: [] } };
  const episode = (await body(await nowPlaying(env, spotify, T0 + 8000))).data;
  assert.deepEqual([episode.title, episode.artist, episode.cover], ["An episode", "", ""]);
});

test("with sharing off nothing is shown or kept, and turning it on again shows it", async () => {
  const { env, spotify } = await connected();
  await nowPlaying(env, spotify, T0 + 1000);
  const off = await call(env, spotify, "PUT", "settings", { body: { share: false } });
  assert.deepEqual(await off.json(), { ok: true, share: false, queue: false });
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM nowplaying").get().n, 0, "the shown song was deleted");
  spotify.calls.length = 0;
  assert.equal((await nowPlaying(env, spotify, T0 + 9000)).status, 404);
  assert.equal(spotify.calls.length, 0, "and Spotify is not asked");
  await call(env, spotify, "PUT", "settings", { body: { share: true } });
  assert.equal((await nowPlaying(env, spotify, T0 + 12000)).status, 200);
});

test("the login is renewed when it ends, and a replacement refresh token is kept", async () => {
  const { env, spotify } = await connected({ rotate: true });
  const later = T0 + 2 * 3600_000; // the first access token has ended
  const song = await body(await nowPlaying(env, spotify, later));
  assert.equal(song.data.title, "Without Me");
  assert.equal(spotify.renewals, 1);
  const renew = spotify.calls.find((c) => c.host === "accounts.spotify.com");
  assert.match(renew.body, /grant_type=refresh_token/);
  assert.match(renew.body, new RegExp(`client_id=${CLIENT}`));
  assert.ok(renew.body.includes(REFRESH), "the first refresh token was used");
  assert.match(spotify.calls.find((c) => c.path.includes("currently-playing")).auth, /^Bearer renewed-1-/);
  await nowPlaying(env, spotify, later + 3 * 3600_000); // ends again: now the replacement is the one sent
  assert.match(spotify.calls.filter((c) => c.host === "accounts.spotify.com")[1].body, /refresh_token=rotated-1-/);
  assert.equal(spotify.renewals, 2);
});

test("when Spotify no longer accepts the login the streamer is told to log in again, and Spotify is left alone", async () => {
  const { env, spotify } = await connected();
  spotify.refreshStatus = 400;
  const later = T0 + 2 * 3600_000;
  assert.equal((await nowPlaying(env, spotify, later)).status, 404, "nothing to show");
  assert.equal(row(env).state, "expired");
  const state = await body(await call(env, spotify, "GET", "status", { now: later }));
  assert.equal(state.state, "expired");
  spotify.calls.length = 0;
  await nowPlaying(env, spotify, later + 10_000);
  assert.equal(spotify.calls.length, 0, "no more questions while it is expired");
  assert.equal((await ask(env, spotify, "levitating", { options: { now: later } })).status, 409);
  assert.equal((await login(env, fakeSpotify(), {}, { now: later })).status, 200, "logging in again fixes it");
  assert.equal(row(env).state, "ok");
});

test("if Spotify says no in the middle of a call, one renewal is tried before giving up", async () => {
  const { env, spotify } = await connected();
  let answered = 0;
  const real = spotify.fetch;
  spotify.fetch = async (url, options) => (String(url).includes("currently-playing") && answered++ === 0 ? reply({ error: { status: 401 } }, 401) : real(url, options));
  const song = await body(await nowPlaying(env, spotify, T0 + 1000));
  assert.equal(song.data.title, "Without Me");
  assert.equal(spotify.renewals, 1, "a new login was fetched and the call repeated");
});

test("when Spotify asks us to slow down, it is left alone for a while and the stored song stays", async () => {
  const { env, spotify } = await connected();
  await nowPlaying(env, spotify, T0 + 1000);
  const real = spotify.fetch;
  spotify.fetch = async (url, options) => (String(url).includes("currently-playing") ? reply({ error: { status: 429 } }, 429, { "retry-after": "20" }) : real(url, options));
  const held = await body(await nowPlaying(env, spotify, T0 + 4000));
  assert.equal(held.data.title, "Without Me", "the song stored a moment ago is still what is shown");
  spotify.calls.length = 0;
  await nowPlaying(env, spotify, T0 + 12000);
  assert.equal(spotify.calls.length, 0, "20 seconds were asked for");
  spotify.fetch = real;
  await nowPlaying(env, spotify, T0 + 25000);
  assert.equal(spotify.calls.filter((c) => c.path.includes("currently-playing")).length, 1);
});

// ── viewers' songs ──────────────────────────────────────────────────────────────────────────────────────────────────

test("an !sr passed on by the overlay is ignored while the Spotify queue switch is off", async () => {
  const { env, spotify } = await connected();
  const answer = await body(await ask(env, spotify, "levitating dua lipa"));
  assert.deepEqual(answer, { ok: true, ignored: "queue_off" });
  assert.equal(spotify.calls.length, 0, "Spotify was not asked");
  assert.equal(JSON.parse(row(env).log).length, 0);
});

test("with the switch on, the first match goes to the end of the streamer's queue, and the streamer can read what happened", async () => {
  const { env, spotify } = await connected({ queue: true });
  const answer = await body(await ask(env, spotify, "  levitating   dua lipa "));
  assert.deepEqual([answer.ok, answer.added, answer.title, answer.artist], [true, true, "Levitating", "Dua Lipa", ]);
  assert.equal(answer.entry.text, "Ann: “Levitating” · Dua Lipa was added to your Spotify queue.");
  const [search, queued] = spotify.calls;
  assert.deepEqual([search.path, search.query.q, search.query.type, search.query.limit], ["/v1/search", "levitating dua lipa", "track", "5"]);
  assert.deepEqual([queued.method, queued.path, queued.query.uri], ["POST", "/v1/me/player/queue", track("Levitating", "Dua Lipa").uri]);
  const state = await body(await call(env, spotify, "GET", "status"));
  assert.deepEqual(state.log.map((e) => [e.state, e.text]), [["ok", "Ann: “Levitating” · Dua Lipa was added to your Spotify queue."]]);
});

test("the same song is not queued twice in ten minutes, a song Spotify cannot find says so, and short or empty asks are refused", async () => {
  const { env, spotify } = await connected({ queue: true });
  await ask(env, spotify, "levitating", { options: { now: T0 } });
  const again = await body(await ask(env, spotify, "levitating please", { options: { now: T0 + 3000 } }));
  assert.equal(again.ignored, "recent");
  assert.match(again.entry.text, /queued a moment ago/);
  assert.equal(spotify.calls.filter((c) => c.path.includes("player/queue")).length, 1);
  const later = await body(await ask(env, spotify, "levitating", { options: { now: T0 + 11 * 60_000 } }));
  assert.equal(later.added, true, "after ten minutes it may go again");
  spotify.found = [];
  const none = await body(await ask(env, spotify, "zzzz qqqq", { options: { now: T0 + 12 * 60_000 } }));
  assert.equal(none.ignored, "not_found");
  assert.match(none.entry.text, /Spotify found nothing/);
  assert.equal((await ask(env, spotify, "x", { options: { now: T0 + 13 * 60_000 } })).status, 400);
  assert.equal((await ask(env, spotify, "", { options: { now: T0 + 13 * 60_000 } })).status, 400);
});

test("Spotify's refusals reach the streamer in words, and an expired login is reported as that", async () => {
  const { env, spotify } = await connected({ queue: true, queueStatus: 404 });
  const noDevice = await ask(env, spotify, "levitating");
  assert.equal(noDevice.status, 502);
  assert.match((await noDevice.json()).message, /no device to play on/);
  assert.match(JSON.parse(row(env).log)[0].text, /no device to play on/);
  spotify.queueStatus = 403;
  const premium = await ask(env, spotify, "dance monkey", { options: { now: T0 + 5000 } });
  assert.match((await premium.json()).message, /Premium/);
});

test("the overlay's link cannot flood the queue: one add every 2 seconds, 200 an hour", async () => {
  const { env, spotify } = await connected({ queue: true });
  spotify.found = [track("One", "A", "one")];
  assert.equal((await ask(env, spotify, "one", { options: { now: T0 } })).status, 200);
  const quick = await ask(env, spotify, "two", { options: { now: T0 + 500 } });
  assert.equal(quick.status, 429);
  assert.equal((await quick.json()).error, "too_fast");
  assert.equal(spotify.calls.filter((c) => c.path.includes("search")).length, 1, "and Spotify was not asked for the second");
  env.DB.raw.prepare("UPDATE spotify_logins SET hour_start = ?, hour_count = 200, last_act = 0").run(T0);
  assert.equal((await ask(env, spotify, "three", { options: { now: T0 + 60_000 } })).status, 429, "200 in the hour");
  assert.equal((await ask(env, spotify, "four", { options: { now: T0 + 3600_000 + 1 } })).status, 200, "a new hour");
});

test("a !next from the overlay skips only when the switch is on, and says so", async () => {
  const { env, spotify } = await connected();
  const off = await body(await call(env, spotify, "POST", "next", { key: "", body: { name: "Mod" } }));
  assert.equal(off.ignored, "queue_off");
  assert.equal(spotify.calls.length, 0);
  await call(env, spotify, "PUT", "settings", { body: { queue: true } });
  const done = await body(await call(env, spotify, "POST", "next", { key: "", body: { name: "Mod" }, now: T0 + 5000 }));
  assert.equal(done.skipped, true);
  assert.equal(done.entry.text, "Mod used !next: skipped to the next song.");
  assert.deepEqual([spotify.calls.at(-1).method, spotify.calls.at(-1).path], ["POST", "/v1/me/player/next"]);
  spotify.nextStatus = 404;
  const broken = await call(env, spotify, "POST", "next", { key: "", body: {}, now: T0 + 9000 });
  assert.equal(broken.status, 502);
  assert.match((await broken.json()).entry.text, /^!next: /);
});

test("the editor's try-it box has the key: it only practices while the switch is off, and the overlay cannot ask for a practice", async () => {
  const { env, spotify } = await connected();
  const practice = await body(await call(env, spotify, "POST", "request", { body: { query: "levitating", name: "Pretend viewer", test: true } }));
  assert.equal(practice.practice, true);
  assert.match(practice.entry.text, /\(Practice: not added to your queue\.\)/);
  assert.equal(spotify.calls.some((c) => c.path.includes("player/queue")), false, "nothing was added");
  const skip = await body(await call(env, spotify, "POST", "next", { body: { name: "Streamer", test: true }, now: T0 + 5000 }));
  assert.match(skip.entry.text, /Practice: nothing was skipped/);
  assert.equal(spotify.calls.some((c) => c.path.includes("player/next")), false);
  const fake = await body(await ask(env, spotify, "levitating", { body: { test: true }, options: { now: T0 + 9000 } }));
  assert.equal(fake.ignored, "queue_off", "without the key a practice is just a request, and the switch is off");
  assert.equal((await call(env, spotify, "POST", "request", { key: "z".repeat(32), body: { query: "levitating", test: true } })).status, 403, "another key is refused, not treated as the overlay");
  assert.equal((await call(env, spotify, "POST", "request", { code: "ZyXwVuTsRqPoNmLk", key: "", body: { query: "levitating" } })).status, 404, "a code with no login");
});

// ── ending it ───────────────────────────────────────────────────────────────────────────────────────────────────────

test("Disconnect deletes the login and the song that was shown, at once, and is safe to press twice", async () => {
  const { env, spotify } = await connected({ queue: true });
  await nowPlaying(env, spotify, T0 + 1000);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM nowplaying").get().n, 1);
  assert.equal((await call(env, spotify, "DELETE", "login")).status, 200);
  assert.equal(row(env), undefined);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM nowplaying").get().n, 0);
  assert.equal((await call(env, spotify, "DELETE", "login")).status, 200, "nothing left, and that is fine");
  assert.equal((await body(await call(env, spotify, "GET", "status"))).connected, false);
  assert.equal((await ask(env, spotify, "levitating")).status, 404);
  assert.equal((await nowPlaying(env, spotify, T0 + 20000)).status, 404);
});

test("the daily clean-up deletes logins and shown songs that have not been used for 14 days, and only those", async () => {
  const env = fresh();
  const spotify = fakeSpotify();
  await login(env, spotify, {}, { now: T0 });
  const insert = env.DB.raw.prepare("INSERT INTO spotify_logins (code, key_hash, secret, created_at, used_at) VALUES (?, 'h', 's', 1, ?)");
  insert.run("OldOldOldOldOld1", T0 - 15 * 86400000);
  insert.run("NewNewNewNewNew1", T0 - 13 * 86400000);
  env.DB.raw.prepare("INSERT INTO nowplaying (code, key_hash, data, updated_at) VALUES ('OldOldOldOldOld1', 'h', '{}', ?), ('NewNewNewNewNew1', 'h', '{}', ?)").run(T0 - 15 * 86400000, T0 - 13 * 86400000);
  await pruneSpotify(env, T0);
  assert.deepEqual(env.DB.raw.prepare("SELECT code FROM spotify_logins ORDER BY code").all().map((r) => r.code), [CODE, "NewNewNewNewNew1"]);
  assert.deepEqual(env.DB.raw.prepare("SELECT code FROM nowplaying").all().map((r) => r.code), ["NewNewNewNewNew1"]);
  const ran = [];
  await worker.scheduled({}, env, { waitUntil: (promise) => ran.push(promise) });
  assert.equal(ran.length, 1, "the Worker's daily trigger runs it");
  await Promise.all(ran);
  await pruneSpotify({ DB: { prepare() { throw new Error("no such table"); } } }); // a missing table is not an error
});

test("using a login now and then keeps it from being cleaned up", async () => {
  const { env, spotify } = await connected();
  env.DB.raw.prepare("UPDATE spotify_logins SET used_at = ?").run(T0 - 13 * 86400000);
  await nowPlaying(env, spotify, T0 + 1000);
  assert.equal(row(env).used_at, T0 + 1000, "a read that reached Spotify counts as use");
});

test("the Worker routes /api/spotify/ to this, and answers 503 on a Worker with no secret", async () => {
  const env = fresh();
  const answer = await worker.fetch(new Request(`${SITE}/api/spotify/${CODE}/status`, { headers: { "x-key": KEY } }), env, { waitUntil() {} });
  assert.equal(answer.status, 200);
  assert.equal((await answer.json()).connected, false);
  const bare = await worker.fetch(new Request(`${SITE}/api/spotify/${CODE}/status`, { headers: { "x-key": KEY } }), { DB: env.DB }, { waitUntil() {} });
  assert.equal(bare.status, 503);
});
