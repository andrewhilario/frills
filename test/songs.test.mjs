// Song requests: the chat commands, the queue and its rules, the song lookup, and the Worker that asks the catalog. No page, no network:
// the lookup, the time and the catalog's answer are all pretend.

import test from "node:test";
import assert from "node:assert/strict";
import { SONGS, SongQueue, commandWord, loadSongs, makeLookup, parseCommand, saveSongs, songsKey } from "../src/js/songs.js";
import { handleSongs, shape } from "../worker/songs.mjs";

const settings = (over = {}) => ({ ...SONGS.defaults, ...over });
const msg = (text, over = {}) => ({ id: "", user: "u1", name: "Ann", text, avatar: "", mod: false, host: false, login: "ann", ...over });
const track = (id, title, artist = "Artist", seconds = 180) => ({ id, title, artist, cover: "https://cdn-images.dzcdn.net/images/cover/" + "a".repeat(32) + "/250x250-000000-80-0-0.jpg", seconds, link: "" });
const settle = () => new Promise((r) => setTimeout(r, 0));

function rig(over = {}, catalog = {}) {
  const views = [];
  let time = 1000;
  const lookup = async (q) => catalog[q.toLowerCase()] ?? null;
  const queue = new SongQueue(settings(over), { lookup, now: () => time, onChange: (v) => views.push(v) });
  return { queue, views, advance: (ms) => { time += ms; }, last: () => views.at(-1) };
}

test("the commands: !sr with a song, !next, !skip, !wrongsong, and anything else is not a command", () => {
  const s = settings();
  assert.deepEqual(parseCommand("!sr Blinding Lights", s), { kind: "request", query: "Blinding Lights" });
  assert.deepEqual(parseCommand("  !SR   levitating   dua lipa ", s), { kind: "request", query: "levitating dua lipa" });
  assert.deepEqual(parseCommand("!songrequest espresso", s), { kind: "request", query: "espresso" });
  assert.deepEqual(parseCommand("！sr full width mark", s), { kind: "request", query: "full width mark" });
  assert.equal(parseCommand("!sr", s), null, "no song named");
  assert.equal(parseCommand("!sr a", s), null, "too short to be a song");
  assert.deepEqual(parseCommand("!next", s), { kind: "next" });
  assert.deepEqual(parseCommand("!skip now please", s), { kind: "next" });
  assert.deepEqual(parseCommand("!wrongsong", s), { kind: "remove" });
  assert.equal(parseCommand("sr blinding lights", s), null, "needs the !");
  assert.equal(parseCommand("hello !sr no", s), null, "the command starts the line");
  assert.equal(parseCommand("!hello world", s), null);
  assert.equal(parseCommand(null, s), null);
  assert.equal(parseCommand("!sr " + "x".repeat(500), s).query.length, 80, "cut to a sensible length");
});

test("the command word can be changed, and nonsense falls back to sr", () => {
  assert.equal(commandWord({ command: " Play! " }), "play");
  assert.equal(commandWord({ command: "!!" }), "sr");
  assert.equal(commandWord({}), "sr");
  assert.deepEqual(parseCommand("!play blinding lights", settings({ command: "play" })), { kind: "request", query: "blinding lights" });
  assert.deepEqual(parseCommand("!songrequest x y", settings({ command: "play" })), { kind: "request", query: "x y" }, "!songrequest always works");
  assert.equal(parseCommand("!sr blinding lights", settings({ command: "play" })), null);
});

test("a request joins the queue at once, then the catalog gives it its proper title, artist and cover", async () => {
  const { queue, last } = rig({}, { "blinding lights": track("1", "Blinding Lights", "The Weeknd") });
  assert.equal(queue.handle(msg("!sr blinding lights", { id: "m1" })).kind, "request");
  assert.deepEqual([last().now.title, last().now.state], ["blinding lights", "searching"], "shown as typed while it is looked up");
  await settle();
  assert.deepEqual([last().now.title, last().now.artist, last().now.state], ["Blinding Lights", "The Weeknd", "ready"]);
  assert.ok(last().now.cover.startsWith("https://cdn-images.dzcdn.net/"));
  assert.equal(last().now.name, "Ann");
});

test("a song the catalog cannot find stays as typed, or is dropped when asked to skip those", async () => {
  const keep = rig();
  keep.queue.handle(msg("!sr zzzz nothing"));
  await settle();
  assert.deepEqual([keep.last().now.title, keep.last().now.state], ["zzzz nothing", "missing"]);
  const drop = rig({ onlyFound: true });
  drop.queue.handle(msg("!sr zzzz nothing"));
  await settle();
  assert.equal(drop.last().total, 0);
  const broken = new SongQueue(settings(), { lookup: async () => { throw new Error("catalog down"); } });
  broken.handle(msg("!sr anything goes"));
  await settle();
  assert.equal(broken.items[0].state, "missing", "a lookup that fails is just not found");
});

test("the rules: one message counts once, a person has a limit, the queue has a limit, and the same song twice is ignored", () => {
  const { queue } = rig({ perUser: 2, limit: 4 });
  assert.equal(queue.handle(msg("!sr first song", { id: "a" })).kind, "request");
  assert.equal(queue.handle(msg("!sr first song", { id: "a" })).why, "repeat", "the same message delivered twice");
  assert.equal(queue.handle(msg("!sr second song", { id: "b" })).kind, "request");
  assert.equal(queue.handle(msg("!sr third song", { id: "c" })).why, "too many from this person");
  assert.equal(queue.handle(msg("!SR  First   Song!", { id: "d", user: "u2", name: "Ben" })).why, "already in the queue", "spelled differently, still the same song");
  assert.equal(queue.handle(msg("!sr other one", { id: "e", user: "u2", name: "Ben" })).kind, "request");
  assert.equal(queue.handle(msg("!sr another", { id: "f", user: "u3", name: "Cat" })).kind, "request");
  assert.equal(queue.handle(msg("!sr one more", { id: "g", user: "u4", name: "Dan" })).why, "queue full");
  assert.equal(queue.items.length, 4);
});

test("!next: the streamer's own account (or TikTok's host flag) can, a moderator can unless switched off, a viewer cannot", () => {
  const { queue } = rig();
  for (const [i, who] of ["a", "b", "c", "d"].entries()) queue.handle(msg(`!sr song ${who}${who}`, { user: "u" + i, name: who }));
  assert.equal(queue.handle(msg("!next", { id: "n1", user: "x" })).why, "not allowed");
  assert.equal(queue.items.length, 4);
  assert.equal(queue.handle(msg("!next", { id: "n2", user: "x", login: "pond_cafe" }), "Pond_Cafe").kind, "next", "the streamer, by their @name");
  assert.equal(queue.handle(msg("!next", { id: "n3", user: "x", host: true })).kind, "next", "the streamer, by TikTok's flag");
  assert.equal(queue.handle(msg("!skip", { id: "n4", user: "x", mod: true })).kind, "next", "a moderator");
  assert.equal(queue.items.length, 1);
  queue.setSettings(settings({ modsSkip: false }));
  assert.equal(queue.handle(msg("!next", { id: "n5", user: "x", mod: true })).why, "not allowed");
  assert.equal(queue.handle(msg("!next", { id: "n6", user: "x", host: true })).kind, "next");
  assert.equal(queue.handle(msg("!next", { id: "n7", user: "x", host: true })).why, "nothing playing");
});

test("!wrongsong takes the asker's latest song out, and only theirs", () => {
  const { queue } = rig();
  queue.handle(msg("!sr one song", { user: "u1" }));
  queue.handle(msg("!sr two song", { user: "u2", name: "Ben" }));
  queue.handle(msg("!sr three song", { user: "u1" }));
  assert.equal(queue.handle(msg("!wrongsong", { id: "w1", user: "u1" })).kind, "remove");
  assert.deepEqual(queue.items.map((i) => i.query), ["one song", "two song"]);
  assert.equal(queue.handle(msg("!wrongsong", { id: "w2", user: "u9" })).why, "nothing of theirs");
});

test("the view: the first song is what is playing, the next ones follow, and 'songs shown' limits the list", () => {
  const { queue, last } = rig({ max: 3 });
  for (const n of ["one", "two", "three", "four", "five"]) queue.request({ user: n, name: n, query: n + " song" });
  assert.equal(last().now.query, "one song");
  assert.deepEqual(last().next.map((i) => i.query), ["two song", "three song"], "the first plus two more is three shown");
  assert.equal(last().total, 5);
  queue.next();
  assert.equal(last().now.query, "two song");
  queue.clear();
  assert.deepEqual([last().now, last().next, last().total], [null, [], 0]);
});

test("a song found under another spelling that is already waiting is dropped", async () => {
  const { queue, last } = rig({}, { "blinding lights": track("7", "Blinding Lights"), "blinding light weeknd": track("7", "Blinding Lights") });
  queue.request({ user: "a", name: "A", query: "blinding lights" });
  await settle();
  queue.request({ user: "b", name: "B", query: "blinding light weeknd" });
  await settle();
  assert.equal(last().total, 1);
});

test("moving on by itself: only when switched on, and only after the song's length and a few seconds", async () => {
  const off = rig({ autoNext: false }, { "a song": track("1", "A Song", "X", 100) });
  off.queue.request({ user: "a", name: "A", query: "a song" });
  await settle();
  off.advance(500000);
  assert.equal(off.queue.tick(), false);

  const on = rig({ autoNext: true }, { "a song": track("1", "A Song", "X", 100), "b song": track("2", "B Song", "X", 100) });
  on.queue.request({ user: "a", name: "A", query: "a song" });
  on.queue.request({ user: "b", name: "B", query: "b song" });
  await settle();
  on.advance(100 * 1000);
  assert.equal(on.queue.tick(), false, "the song is still playing");
  on.advance(5000);
  assert.equal(on.queue.tick(), true);
  assert.equal(on.last().now.title, "B Song");
  on.advance(60 * 1000);
  assert.equal(on.queue.tick(), false, "its own length is counted from when it came up");
});

test("lowering the limit trims the queue, and a song removed while it is looked up never comes back", async () => {
  const { queue, last } = rig({ limit: 10 }, { "slow song": track("1", "Slow Song") });
  queue.request({ user: "a", name: "A", query: "slow song" });
  queue.request({ user: "b", name: "B", query: "second song" });
  queue.request({ user: "c", name: "C", query: "third song" });
  queue.remove(queue.items[0].key);
  await settle();
  assert.deepEqual(last().now.query, "second song", "the removed one did not return when the catalog answered");
  queue.request({ user: "d", name: "D", query: "fourth song" });
  queue.request({ user: "e", name: "E", query: "fifth song" });
  assert.equal(queue.items.length, 4);
  queue.setSettings(settings({ limit: 3 }));
  assert.deepEqual(queue.items.map((i) => i.query), ["second song", "third song", "fourth song"], "past the new limit, the newest go");
});

test("a remembered queue comes back after a reload, and bad or missing storage is harmless", async () => {
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  const { queue } = rig({}, { "a song": track("1", "A Song", "X") });
  queue.request({ user: "a", name: "A", query: "a song" });
  await settle();
  queue.request({ user: "b", name: "B", query: "pending song" });
  saveSongs(storage, "pond", queue);
  const back = loadSongs(storage, "pond");
  assert.equal(back.length, 1, "a song still being looked up is not remembered");
  assert.equal(back[0].title, "A Song");
  assert.equal(new SongQueue(settings(), { entries: back }).items.length, 1);
  assert.deepEqual(loadSongs({ getItem: () => "{ nope" }, "pond"), []);
  assert.deepEqual(loadSongs({ getItem: () => JSON.stringify([{ nonsense: true }, null, 3]) }, "pond"), []);
  assert.deepEqual(loadSongs({ getItem: () => { throw new Error("blocked"); } }, "pond"), []);
  assert.notEqual(songsKey("a"), songsKey("b"));
});

test("the page's lookup asks the site's own address once per song and remembers the answer", async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return { ok: true, json: async () => ({ results: [track("1", "A Song")] }) }; };
  const lookup = makeLookup(fetchImpl);
  assert.equal((await lookup("A Song!")).title, "A Song");
  assert.equal((await lookup("a  song")).title, "A Song");
  assert.equal(calls.length, 1, "the same song, asked another way, is not asked again");
  assert.equal(calls[0], "/api/songs?q=A%20Song!");
  assert.equal(await makeLookup(async () => ({ ok: false }))("x y"), null);
  assert.equal(await makeLookup(async () => { throw new Error("offline"); })("x y"), null);
  assert.equal(await makeLookup(async () => ({ ok: true, json: async () => ({ results: [] }) }))("x y"), null);
});

// ── the Worker that asks the catalog ────────────────────────────────────────────────────────────────────────────────

const deezer = (over = {}) => ({ id: 908604612, readable: true, title: "Blinding Lights", title_short: "Blinding Lights", link: "https://www.deezer.com/track/908604612", duration: 200, md5_image: "fd00ebd6d30d7253f813dba3bb1c66a9", artist: { name: "The Weeknd" }, ...over });

test("the catalog's answer is cut down to what the overlay shows, and anything unusable is left out", () => {
  assert.deepEqual(shape({ data: [deezer()] }), [{ id: "908604612", title: "Blinding Lights", artist: "The Weeknd", cover: "https://cdn-images.dzcdn.net/images/cover/fd00ebd6d30d7253f813dba3bb1c66a9/250x250-000000-80-0-0.jpg", seconds: 200, link: "https://www.deezer.com/track/908604612" }]);
  const odd = shape({ data: [deezer({ md5_image: "<script>" }), deezer({ id: 0 }), deezer({ title: "", title_short: "" }), deezer({ readable: false }), deezer({ link: "https://evil.example/x", duration: -4 })] });
  assert.equal(odd.length, 2);
  assert.equal(odd[0].cover, "", "a cover that is not the catalog's own kind of name is dropped");
  assert.equal(odd[1].link, "");
  assert.equal(odd[1].seconds, 0);
  assert.equal(shape({ data: Array.from({ length: 9 }, (_, i) => deezer({ id: i + 1 })) }).length, 3, "three at most");
  assert.deepEqual(shape(null), []);
  assert.deepEqual(shape({ data: "nope" }), []);
});

test("/api/songs answers a search, refuses a missing one, and a catalog that is down gives an empty list", async () => {
  const ask = (q, fetchImpl, method = "GET") => handleSongs(new Request("https://frills.example/api/songs" + (q === undefined ? "" : "?q=" + encodeURIComponent(q)), { method }), { fetchImpl, cache: null });
  let asked = "";
  const ok = await ask("  blinding   lights ", async (url) => { asked = url; return new Response(JSON.stringify({ data: [deezer()] })); });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).results[0].title, "Blinding Lights");
  assert.equal(asked, "https://api.deezer.com/search?q=blinding%20lights&limit=5", "only the song words are sent");
  const never = async () => { throw new Error("must not be asked"); };
  assert.equal((await ask(undefined, never)).status, 400);
  assert.equal((await ask("a", never)).status, 400);
  assert.deepEqual(await (await ask("blinding lights", async () => { throw new Error("down"); })).json(), { results: [] });
  assert.deepEqual(await (await ask("blinding lights", async () => new Response("nope", { status: 500 }))).json(), { results: [] });
  assert.equal((await ask("blinding lights", async () => new Response("{}"), "POST")).status, 405);
  const long = await ask("x".repeat(300), async (url) => { asked = url; return new Response(JSON.stringify({ data: [] })); });
  assert.equal(long.status, 200);
  assert.ok(decodeURIComponent(asked.split("q=")[1].split("&")[0]).length <= 80, "a long query is cut");
});

test("a song asked for before is answered from the edge's memory, and nothing found is not kept", async () => {
  const store = new Map();
  const cache = { match: async (k) => store.get(k.url)?.clone(), put: async (k, v) => { store.set(k.url, v); } };
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response(JSON.stringify({ data: [deezer()] })); };
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  const ask = (q, f, c) => handleSongs(new Request("https://frills.example/api/songs?q=" + q), { fetchImpl: f, cache: c, ctx });
  await ask("Blinding%20Lights", fetchImpl, cache);
  await Promise.all(waits);
  const again = await ask("Blinding%20Lights", fetchImpl, cache);
  assert.equal(calls, 1);
  assert.equal((await again.json()).results.length, 1);
  const none = new Map();
  let empties = 0;
  const emptyCache = { match: async (k) => none.get(k.url)?.clone(), put: async (k, v) => { none.set(k.url, v); } };
  const empty = async () => { empties++; return new Response(JSON.stringify({ data: [] })); };
  await ask("zzzz", empty, emptyCache);
  await Promise.all(waits);
  await ask("zzzz", empty, emptyCache);
  assert.equal(empties, 2, "nothing found is not kept, so a song added to the catalog later is found");
});

test("layouts: the song playing can be a card, a strip, a stack or a disc, and an overlay can show only the song or only the queue", async () => {
  const { SONG_LAYOUTS, SONG_SHOWS } = await import("../src/js/songs.js");
  assert.deepEqual(SONG_LAYOUTS.map((l) => l[0]), ["card", "strip", "stack", "disc"]);
  assert.deepEqual(SONG_SHOWS.map((l) => l[0]), ["both", "now", "queue"]);
  assert.deepEqual([SONGS.defaults.layout, SONGS.defaults.show], ["card", "both"], "what it was before: a card, and both");
  for (const layout of ["card", "strip", "stack", "disc"]) assert.equal(SONGS.sanitize({ layout }).layout, layout);
  assert.equal(SONGS.sanitize({ layout: "<script>" }).layout, "card", "anything else falls back");
  assert.equal(SONGS.sanitize({ show: "now" }).show, "now");
  assert.equal(SONGS.sanitize({ show: "everything" }).show, "both");
  const link = SONGS.url("https://x.example/o/", { settings: SONGS.sanitize({ layout: "disc", show: "now" }) });
  const params = new URL(link).searchParams;
  assert.deepEqual([params.get("layout"), params.get("show")], ["disc", "now"]);
  assert.equal(new URL(SONGS.url("https://x.example/o/")).searchParams.has("layout"), false, "the defaults are not written into the link");
});

test("the practice catalog finds each practice song by its own words, not by a word they share", async () => {
  const { fakeLookup, fakeRequest } = await import("../src/js/fake-alerts.js");
  const asked = new Set();
  const found = new Set();
  for (let i = 0; i < 8; i++) {
    const request = fakeRequest({ avoid: [...asked] });
    asked.add(request.query);
    found.add((await fakeLookup(request.query)).title);
  }
  assert.equal(asked.size, 8, "eight different requests, none asked twice");
  assert.equal(found.size, 8, "and each one is found as its own song");
  assert.equal((await fakeLookup("Stay The Kid LAROI")).title, "Stay", "\"The\" in The Weeknd does not win");
  assert.equal((await fakeLookup("zzzz nothing here")).artist, "Practice Band");
});
