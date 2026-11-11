// The post box for the subathon timer's controls (worker/timer.mjs), over a real in-memory SQLite database with the real schema: who may send, who
// may read, that a command is obeyed once and never replayed, what a command may be, and the limits.

import test from "node:test";
import assert from "node:assert/strict";
import { COMMANDS, LIMITS, handleTimer, tidy } from "../worker/timer.mjs";
import worker from "../worker/index.mjs";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";

const SITE = "https://frills.example";
const CODE = "abcdefghij123456";
const KEY = "a-key-of-sixteen-or-more";
const fresh = () => ({ DB: localDatabase(":memory:") });

const post = async (env, body, { code = CODE, key = KEY, origin = SITE, now } = {}) => {
  const headers = { ...(origin ? { origin } : {}), ...(key ? { "x-key": key } : {}), "content-type": "application/json" };
  const res = await handleTimer(new Request(`${SITE}/api/timer/${code}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }), env, { now });
  return { status: res.status, body: await res.json() };
};
const get = async (env, query = "", code = CODE, now) => {
  const res = await handleTimer(new Request(`${SITE}/api/timer/${code}${query}`), env, { now });
  return { status: res.status, body: await res.json() };
};

test("a command is a name from the short list and a whole number of seconds, cleaned", () => {
  assert.deepEqual(COMMANDS, ["start", "pause", "resume", "reset", "add"]);
  assert.deepEqual(tidy({ cmd: "start", value: 99 }), { cmd: "start", value: 0 }, "start, pause and resume carry no number");
  assert.deepEqual(tidy({ cmd: "add", value: 60.4 }), { cmd: "add", value: 60 });
  assert.deepEqual(tidy({ cmd: "add", value: -300 }), { cmd: "add", value: -300 }, "taking time away is allowed");
  assert.deepEqual(tidy({ cmd: "reset", value: -5 }), { cmd: "reset", value: 0 }, "a reset time is never negative");
  assert.equal(tidy({ cmd: "add", value: 1e12 }).value, LIMITS.maxSeconds, "an enormous number is cut");
  assert.equal(tidy({ cmd: "add", value: "lots" }).value, 0);
  for (const bad of [{ cmd: "explode" }, { cmd: "" }, {}, null, "start", 7]) assert.equal(tidy(bad), null, JSON.stringify(bad));
});

test("the first post claims a box, a command is read once by number, and a page that loads never sees old ones", async () => {
  const env = fresh();
  const empty = await get(env);
  assert.deepEqual(empty.body, { ok: true, now: empty.body.now, seq: 0, items: [] }, "nobody has posted: an empty box, not an error");
  assert.equal((await post(env, { cmd: "start" })).body.seq, 1);
  assert.equal((await post(env, { cmd: "add", value: 60 })).body.seq, 2);
  const baseline = await get(env);
  assert.deepEqual([baseline.body.seq, baseline.body.items], [2, []], "no 'after': only where the line is now");
  const all = await get(env, "?after=0");
  assert.deepEqual(all.body.items, [{ seq: 1, cmd: "start", value: 0 }, { seq: 2, cmd: "add", value: 60 }]);
  assert.deepEqual((await get(env, "?after=1")).body.items, [{ seq: 2, cmd: "add", value: 60 }]);
  assert.deepEqual((await get(env, "?after=2")).body.items, [], "nothing new");
  assert.deepEqual((await get(env, "?after=banana")).body.items.length, 2, "a damaged number is read as 0");
});

test("only the key that claimed a box may send, and a send must come from the site itself, with a sound command", async () => {
  const env = fresh();
  assert.equal((await post(env, { cmd: "start" })).status, 200);
  assert.deepEqual((await post(env, { cmd: "pause" }, { key: "another-key-that-is-long" })).body, { ok: false, error: "wrong_key" });
  assert.equal((await post(env, { cmd: "pause" }, { key: "another-key-that-is-long" })).status, 403);
  assert.equal((await post(env, { cmd: "pause" }, { origin: "https://evil.example" })).status, 403, "another site cannot make a visitor's browser send");
  assert.equal((await post(env, { cmd: "pause" }, { origin: "" })).status, 403, "no origin at all is refused");
  assert.equal((await post(env, { cmd: "pause" }, { key: "" })).status, 401);
  assert.equal((await post(env, { cmd: "pause" }, { key: "short" })).status, 401);
  assert.equal((await post(env, { cmd: "explode" })).status, 400);
  assert.equal((await post(env, "{ not json")).status, 400);
  assert.equal((await post(env, { cmd: "add", value: 1, pad: "x".repeat(600) })).status, 413);
  assert.equal((await get(env)).body.seq, 1, "nothing refused was kept");
  assert.equal((await post(env, { cmd: "start" }, { code: "short" })).status, 404);
  assert.equal((await get(env, "", "nope")).status, 404);
  assert.equal((await handleTimer(new Request(`${SITE}/api/timer/${CODE}`, { method: "PUT" }), env)).status, 405);
  assert.equal((await handleTimer(new Request(`${SITE}/api/timer/${CODE}`), {})).status, 503, "no database: not ready, not a crash");
});

test("a burst of commands is slowed, old ones are dropped, and there is room for only so many boxes", async () => {
  const env = fresh();
  const t0 = 1_700_000_000_000;
  for (let i = 0; i < LIMITS.burst; i++) assert.equal((await post(env, { cmd: "add", value: 1 }, { now: t0 + i })).status, 200);
  const slow = await post(env, { cmd: "add", value: 1 }, { now: t0 + 100 });
  assert.equal(slow.status, 429);
  assert.equal((await post(env, { cmd: "add", value: 1 }, { now: t0 + LIMITS.burstMs + 1000 })).status, 200, "later it is fine again");

  const keep = fresh();
  for (let i = 0; i < LIMITS.perBox + 20; i++) await post(keep, { cmd: "add", value: 1 }, { now: t0 + i * (LIMITS.burstMs / 5) });
  const rows = (await get(keep, "?after=0", CODE, t0 + 1e9)).body;
  assert.ok(rows.seq >= LIMITS.perBox + 20);
  assert.ok(rows.items.length <= LIMITS.page);

  const full = fresh();
  const was = LIMITS.boxes;
  LIMITS.boxes = 2;
  try {
    assert.equal((await post(full, { cmd: "start" }, { code: "aaaaaaaaaaaaaaaa" })).status, 200);
    assert.equal((await post(full, { cmd: "start" }, { code: "bbbbbbbbbbbbbbbb" })).status, 200);
    assert.equal((await post(full, { cmd: "start" }, { code: "cccccccccccccccc" })).status, 507, "no room for a new box");
    assert.equal((await post(full, { cmd: "pause" }, { code: "aaaaaaaaaaaaaaaa" })).status, 200, "a box that exists still works");
  } finally { LIMITS.boxes = was; }
});

test("boxes untouched for a month are swept away when a new one is made", async () => {
  const env = fresh();
  const t0 = 1_700_000_000_000;
  await post(env, { cmd: "start" }, { code: "oldoldoldoldoldo", now: t0 });
  assert.equal((await get(env, "?after=0", "oldoldoldoldoldo", t0)).body.items.length, 1);
  await post(env, { cmd: "start" }, { code: "newnewnewnewnewn", now: t0 + (LIMITS.keepDays + 1) * 86400000 });
  assert.deepEqual((await get(env, "?after=0", "oldoldoldoldoldo", t0)).body, { ok: true, now: t0, seq: 0, items: [] }, "the old box and its commands are gone");
});

test("the real Worker routes the timer box, and the site's own address only", async () => {
  const env = fresh();
  const res = await worker.fetch(new Request(`${SITE}/api/timer/${CODE}`, { method: "POST", headers: { origin: SITE, "x-key": KEY }, body: JSON.stringify({ cmd: "start" }) }), { ...env, ASSETS: { fetch: async () => new Response("asset") } }, { waitUntil() {} });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).seq, 1);
});
