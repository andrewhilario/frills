// The post box for Twitch follows (worker/follows.mjs), over a real in-memory SQLite database with the real schema: who may add to a box, who
// may read it, that a follow is seen once and never replayed, and the limits.

import test from "node:test";
import assert from "node:assert/strict";
import { LIMITS, handleFollows, tidy } from "../worker/follows.mjs";
import worker from "../worker/index.mjs";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";

const SITE = "https://frills.example";
const CODE = "abcdefghij123456";
const KEY = "a-key-of-sixteen-or-more";
const fresh = () => ({ DB: localDatabase(":memory:") });

const post = async (env, body, { code = CODE, key = KEY, origin = SITE, now } = {}) => {
  const headers = { ...(origin ? { origin } : {}), ...(key ? { "x-key": key } : {}), "content-type": "application/json" };
  const res = await handleFollows(new Request(`${SITE}/api/follows/${code}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }), env, { now });
  return { status: res.status, body: await res.json() };
};
const get = async (env, query = "", code = CODE, now) => {
  const res = await handleFollows(new Request(`${SITE}/api/follows/${code}${query}`), env, { now });
  return { status: res.status, body: await res.json() };
};
let n = 0;
const follow = (name, over = {}) => ({ id: `ev-${++n}`, user: name.toLowerCase(), name, ...over });

test("what is kept of a follow is a short id, a Twitch login name and a shown name, cleaned", () => {
  assert.deepEqual(tidy({ id: "x1", user: "Mochi_Bun", name: "Mochi  Bun" }), { id: "x1", user: "mochi_bun", name: "Mochi Bun" });
  assert.equal(tidy({ user: "bad name!", name: "Okay" }).user, "", "a login that is not one is dropped, the shown name stays");
  assert.equal(tidy({ user: "frog", name: "" }).name, "frog", "no shown name: the login is used");
  assert.equal(tidy({ id: "y".repeat(500), name: "A".repeat(500) }).name.length, 60);
  assert.equal(tidy({ id: "y".repeat(500), name: "A" }).id.length, 80);
  assert.equal(tidy({ user: "", name: "" }), null);
  assert.equal(tidy("nope"), null);
  assert.equal(tidy(null), null);
});

test("the first post claims a box, a follow can be read once by number, and a page that loads never sees old ones", async () => {
  const env = fresh();
  const empty = await get(env);
  assert.deepEqual([empty.status, empty.body.seq, empty.body.updatedAt, empty.body.items], [200, 0, 0, []], "nothing there yet: not an error, just empty");
  assert.equal((await post(env, follow("Ann"), { now: 1000 })).body.seq, 1);
  assert.equal((await post(env, follow("Ben"), { now: 2000 })).body.seq, 2);
  const first = await get(env, "", CODE, 3000);
  assert.deepEqual([first.body.seq, first.body.items.length, first.body.updatedAt], [2, 0, 2000], "no \"after\": it only says where the line is, so nothing is replayed");
  assert.equal((await post(env, follow("Cat"), { now: 4000 })).body.seq, 3);
  const next = await get(env, "?after=2", CODE, 5000);
  assert.deepEqual(next.body.items.map((i) => [i.seq, i.name, i.user]), [[3, "Cat", "cat"]]);
  assert.deepEqual((await get(env, "?after=3")).body.items, [], "nothing newer");
  assert.deepEqual((await get(env, "?after=0")).body.items.map((i) => i.name), ["Ann", "Ben", "Cat"], "in order");
});

test("only the key that claimed a box can add to it, and every change needs the site's own origin", async () => {
  const env = fresh();
  await post(env, follow("Ann"));
  assert.equal((await post(env, follow("Evil"), { key: "another-key-of-sixteen" })).status, 403);
  assert.equal((await post(env, follow("Evil"), { key: false })).status, 401, "no key at all");
  assert.equal((await post(env, follow("Evil"), { key: "short" })).status, 401, "a key that is too short");
  assert.equal((await post(env, follow("Evil"), { origin: "https://evil.example" })).status, 403);
  assert.equal((await post(env, follow("Evil"), { origin: false })).status, 403);
  assert.equal((await get(env, "?after=0")).body.items.length, 1, "only Ann got in");
  assert.equal((await post(env, "not json")).status, 400);
  assert.equal((await post(env, { name: "" })).status, 400);
  assert.equal((await post(env, "x".repeat(2000))).status, 413);
  assert.equal((await post(env, follow("A"), { code: "short" })).status, 404, "a code that is not one");
  assert.equal((await get(env, "", "../../etc/passwd/xx")).status, 404);
  const rows = env.DB.raw.prepare("SELECT key_hash FROM twitch_boxes").all();
  assert.match(rows[0].key_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(rows[0].key_hash, KEY, "only the hash of the key is kept");
});

test("a follow Twitch reports twice is added once, and a burst is slowed down", async () => {
  const env = fresh();
  const same = follow("Ann", { id: "same-id" });
  assert.equal((await post(env, same, { now: 1000 })).body.seq, 1);
  const again = await post(env, same, { now: 1500 });
  assert.deepEqual([again.status, again.body.seq, again.body.duplicate], [200, 1, true]);
  for (let i = 0; i < LIMITS.burst - 1; i++) assert.equal((await post(env, follow("F" + i), { now: 2000 + i })).status, 200);
  const slowed = await post(env, follow("One too many"), { now: 3000 });
  assert.equal(slowed.status, 429);
  assert.equal((await post(env, follow("Later"), { now: 3000 + LIMITS.burstMs + 100 })).status, 200, "a few seconds later it is fine again");
});

test("a ping says the tab is still there without adding a follow, and old follows are tidied away", async () => {
  const env = fresh();
  await post(env, follow("Ann"), { now: 1000 });
  const ping = await post(env, { ping: true }, { now: 50000 });
  assert.deepEqual([ping.status, ping.body.seq], [200, 1]);
  assert.equal((await get(env, "", CODE, 60000)).body.updatedAt, 50000);
  assert.equal((await post(env, { ping: true }, { key: "another-key-of-sixteen" })).status, 403, "only its own tab can say it is there");
  await post(env, follow("Later"), { now: 1000 + LIMITS.keepEventsMs + 5000 });
  assert.deepEqual((await get(env, "?after=0")).body.items.map((i) => i.name), ["Later"], "a day later, the old one is gone");
  for (let i = 0; i < LIMITS.perBox + 20; i++) await post(env, follow("B" + i), { now: 1000 + LIMITS.keepEventsMs + 6000 + i * 20000 });
  assert.ok((await get(env, "?after=0")).body.items.length <= LIMITS.page, "a page of answers is limited");
  assert.ok(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM twitch_follows").get().n <= LIMITS.perBox, "and a box holds only so many");
});

test("a box nobody has used for two weeks is cleared when a new one is made, and there is a ceiling on boxes", async () => {
  const env = fresh();
  await post(env, follow("Ann"), { now: 1000 });
  await post(env, follow("Ben"), { code: "bbbbbbbbbb123456", now: 1000 + LIMITS.keepDays * 86400000 + 5000 });
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM twitch_boxes WHERE code = ?").get(CODE).n, 0, "the old box is gone");
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM twitch_follows WHERE code = ?").get(CODE).n, 0, "with its follows");
  const full = fresh();
  for (let i = 0; i < LIMITS.boxes; i++) full.DB.raw.prepare("INSERT INTO twitch_boxes (code, key_hash, seq, updated_at) VALUES (?, 'h', 0, ?)").run("c" + String(i).padStart(15, "0"), Date.now());
  assert.equal((await post(full, follow("Ann"), { now: Date.now() })).status, 507);
});

test("through the Worker, /api/follows/ reaches the box", async () => {
  const env = { ...fresh(), ASSETS: { fetch: () => new Response("static") } };
  const res = await worker.fetch(new Request(`${SITE}/api/follows/${CODE}`), env, {});
  assert.equal(res.status, 200);
  assert.equal((await res.json()).seq, 0);
});
