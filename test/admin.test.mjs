// The admin side of the Worker, over a real in-memory SQLite database with the real schema: who gets in (the password, and never when it is
// missing or short), the lockout after wrong tries, what each call lists, marks and removes, and that a removed file is really gone.

import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN, handleAdmin } from "../worker/admin.mjs";
import { handleFeedback } from "../worker/feedback.mjs";
import { handleMedia } from "../worker/media.mjs";
import worker from "../worker/index.mjs";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";

const SITE = "https://frills.example";
const KEY = "a-long-enough-password";
const fresh = (over = {}) => ({ DB: localDatabase(":memory:"), ADMIN_KEY: KEY, ...over });
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const WAV = Uint8Array.from([..."RIFF"].map((c) => c.charCodeAt(0)).concat([36, 0, 0, 0], [..."WAVE"].map((c) => c.charCodeAt(0)), [..."fmt "].map((c) => c.charCodeAt(0)), [16, 0, 0, 0]));

/** One admin call. `key` false sends no password; `origin` false sends no Origin (a browser always sends one with a change). */
async function call(env, method, path, { key = KEY, origin = SITE, body, now } = {}) {
  const headers = { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(origin ? { origin } : {}), ...(body ? { "content-type": "application/json" } : {}) };
  const res = await handleAdmin(new Request(SITE + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, { now });
  return { status: res.status, body: await res.json(), res };
}

let tick = 0;
const post = (env, over = {}) => handleFeedback(new Request(`${SITE}/api/feedback`, {
  method: "POST", headers: { origin: SITE, "content-type": "application/json" },
  body: JSON.stringify({ kind: "idea", message: "A message that is long enough " + ++tick, website: "", took: 5000, ...over }),
}), env, { now: Date.UTC(2026, 9, 1, 12, 0, tick) });
const upload = async (env, file, now) => {
  const res = await handleMedia(new Request(`${SITE}/api/media`, { method: "POST", headers: { origin: SITE, "x-consent": "yes" }, body: file }), env, { now });
  return (await res.json()).id;
};

test("without a password in the settings, or with a short one, the admin side is off", async () => {
  assert.equal((await call({ DB: localDatabase(":memory:") }, "GET", "/api/admin/summary")).body.error, "admin_off");
  assert.equal((await call(fresh({ ADMIN_KEY: "short" }), "GET", "/api/admin/summary", { key: "short" })).status, 503, "even the right short password does not get in");
  assert.equal((await call(fresh({ ADMIN_KEY: "" }), "GET", "/api/admin/summary", { key: "" })).status, 503);
});

test("only the right password gets in, and a wrong one says nothing about what was wrong", async () => {
  const env = fresh();
  assert.equal((await call(env, "GET", "/api/admin/summary", { key: false })).status, 401);
  assert.equal((await call(env, "GET", "/api/admin/summary", { key: "a-long-enough-passwor" })).status, 401);
  assert.equal((await call(env, "GET", "/api/admin/summary", { key: KEY + "x" })).status, 401);
  const ok = await call(env, "GET", "/api/admin/summary");
  assert.equal(ok.status, 200);
  assert.equal(ok.res.headers.get("cache-control"), "no-store");
  assert.equal(ok.res.headers.get("x-robots-tag"), "noindex");
  const wrong = await call(env, "GET", "/api/admin/summary", { key: "nope" });
  assert.deepEqual(wrong.body, { ok: false, error: "wrong_key" });
});

test("after ten wrong tries in ten minutes everything waits, even the right password, until the time is up", async () => {
  const env = fresh();
  const t0 = Date.UTC(2026, 9, 1, 12, 0, 0);
  for (let i = 0; i < ADMIN.maxWrong; i++) assert.equal((await call(env, "GET", "/api/admin/summary", { key: "guess" + i, now: t0 + i * 1000 })).status, 401);
  const locked = await call(env, "GET", "/api/admin/summary", { now: t0 + 20000 });
  assert.equal(locked.status, 429);
  assert.equal(locked.res.headers.get("retry-after"), "600");
  assert.equal((await call(env, "GET", "/api/admin/summary", { now: t0 + ADMIN.windowMs + 20000 })).status, 200, "ten minutes later the right password works again");
});

test("an address that is not one of the admin calls is refused, and the Worker routes /api/admin/ to it", async () => {
  const env = fresh();
  assert.equal((await call(env, "GET", "/api/admin/nothing")).status, 404);
  assert.equal(await handleAdmin(new Request(SITE + "/api/feedback"), env), null);
  const viaWorker = await worker.fetch(new Request(SITE + "/api/admin/summary"), { ...env, ASSETS: { fetch: () => new Response("static") } }, {});
  assert.equal(viaWorker.status, 401);
});

test("the summary counts the feedback and the files, and says whether feedback can be marked", async () => {
  const env = fresh();
  await post(env, { kind: "idea" });
  await post(env, { kind: "broken" });
  await post(env, { kind: "idea" });
  await upload(env, PNG, Date.now());
  await upload(env, WAV, Date.now());
  const { body } = await call(env, "GET", "/api/admin/summary");
  assert.equal(body.canMark, true);
  assert.deepEqual(body.feedback, { total: 3, new: 3, kinds: { idea: 2, broken: 1 } });
  assert.equal(body.media.count, 2);
  assert.equal(body.media.bytes, PNG.length + WAV.length);
  assert.deepEqual(body.media.kinds, { image: 1, sound: 1 });
  assert.ok(body.media.limit > body.media.bytes);
});

test("feedback is listed newest first, in pages, and can be filtered by kind, state and a word", async () => {
  const env = fresh();
  for (let i = 0; i < 5; i++) await post(env, { kind: i % 2 ? "broken" : "idea", message: `Message number ${i} about ${i === 3 ? "frogs" : "ponds"}`, contact: i === 3 ? "frog@pond.test" : "" });
  const all = await call(env, "GET", "/api/admin/feedback");
  assert.deepEqual(all.body.items.map((f) => f.id), [5, 4, 3, 2, 1]);
  assert.equal(all.body.next, null);
  assert.deepEqual(Object.keys(all.body.items[0]).sort(), ["app", "contact", "created", "id", "kind", "message", "status"]);
  const page1 = await call(env, "GET", "/api/admin/feedback?limit=2");
  assert.deepEqual(page1.body.items.map((f) => f.id), [5, 4]);
  assert.equal(page1.body.next, 4);
  const page2 = await call(env, "GET", `/api/admin/feedback?limit=2&before=${page1.body.next}`);
  assert.deepEqual(page2.body.items.map((f) => f.id), [3, 2]);
  assert.deepEqual((await call(env, "GET", "/api/admin/feedback?kind=broken")).body.items.map((f) => f.id), [4, 2]);
  assert.deepEqual((await call(env, "GET", "/api/admin/feedback?q=frogs")).body.items.map((f) => f.id), [4]);
  assert.deepEqual((await call(env, "GET", "/api/admin/feedback?q=frog%40pond")).body.items.map((f) => f.id), [4], "the contact is searched too");
  assert.deepEqual((await call(env, "GET", "/api/admin/feedback?q=%25")).body.items, [], "a % in the search is just a %, not 'anything'");
  assert.equal((await call(env, "GET", "/api/admin/feedback?kind=nonsense")).body.items.length, 5, "an unknown kind is ignored");
  assert.equal((await call(env, "GET", "/api/admin/feedback?limit=999")).body.items.length, 5);
});

test("feedback can be marked done and new again, and removed, and every change needs the site's own origin", async () => {
  const env = fresh();
  await post(env);
  await post(env);
  assert.equal((await call(env, "PATCH", "/api/admin/feedback/1", { body: { status: "done" } })).status, 200);
  assert.deepEqual((await call(env, "GET", "/api/admin/feedback?status=done")).body.items.map((f) => f.id), [1]);
  assert.deepEqual((await call(env, "GET", "/api/admin/feedback?status=new")).body.items.map((f) => f.id), [2]);
  assert.equal((await call(env, "GET", "/api/admin/summary")).body.feedback.new, 1);
  assert.equal((await call(env, "PATCH", "/api/admin/feedback/1", { body: { status: "new" } })).status, 200);
  assert.equal((await call(env, "PATCH", "/api/admin/feedback/1", { body: { status: "sneaky" } })).body.error, "bad_status");
  assert.equal((await call(env, "PATCH", "/api/admin/feedback/99", { body: { status: "done" } })).status, 404);
  assert.equal((await call(env, "PATCH", "/api/admin/feedback/1", { origin: "https://evil.test", body: { status: "done" } })).status, 403);
  assert.equal((await call(env, "DELETE", "/api/admin/feedback/1", { origin: false })).status, 403, "no Origin, no change");
  assert.equal((await call(env, "DELETE", "/api/admin/feedback/1")).status, 200);
  assert.equal((await call(env, "DELETE", "/api/admin/feedback/1")).status, 404);
  assert.equal((await call(env, "DELETE", "/api/admin/feedback/abc")).status, 404);
  assert.deepEqual((await call(env, "GET", "/api/admin/feedback")).body.items.map((f) => f.id), [2]);
});

test("a database from before the admin page (no status column) still lists and deletes, and says it cannot mark", async () => {
  const env = fresh();
  env.DB.raw.exec("DROP TABLE feedback; CREATE TABLE feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT NOT NULL, kind TEXT NOT NULL, app TEXT, message TEXT NOT NULL, contact TEXT);"); // the table as it was before the status column
  await post(env);
  assert.equal((await call(env, "GET", "/api/admin/summary")).body.canMark, false);
  const list = await call(env, "GET", "/api/admin/feedback?status=done");
  assert.equal(list.body.items.length, 1, "the state filter is ignored, since there is no state");
  assert.equal(list.body.items[0].status, "new");
  assert.equal((await call(env, "PATCH", "/api/admin/feedback/1", { body: { status: "done" } })).body.error, "no_status_column");
  assert.equal((await call(env, "DELETE", "/api/admin/feedback/1")).status, 200);
});

test("files are listed newest first, in pages, by kind, without their contents", async () => {
  const env = fresh();
  const ids = [];
  ids.push(await upload(env, PNG, Date.UTC(2026, 9, 1, 12, 0, 1)));
  ids.push(await upload(env, WAV, Date.UTC(2026, 9, 1, 12, 0, 2)));
  ids.push(await upload(env, PNG, Date.UTC(2026, 9, 1, 12, 0, 3)));
  const all = await call(env, "GET", "/api/admin/media");
  assert.deepEqual(all.body.items.map((m) => m.id), [ids[2], ids[1], ids[0]]);
  assert.deepEqual(Object.keys(all.body.items[0]).sort(), ["created", "id", "kind", "mime", "size"], "never the file itself");
  const page1 = await call(env, "GET", "/api/admin/media?limit=2");
  assert.equal(page1.body.items.length, 2);
  const page2 = await call(env, "GET", `/api/admin/media?limit=2&before=${encodeURIComponent(page1.body.next)}`);
  assert.deepEqual(page2.body.items.map((m) => m.id), [ids[0]]);
  assert.deepEqual((await call(env, "GET", "/api/admin/media?kind=sound")).body.items.map((m) => m.id), [ids[1]]);
  assert.equal((await call(env, "GET", "/api/admin/media?before=not-a-date")).body.items.length, 3, "a bad date is ignored");
});

test("the owner can remove any file without its delete code, and then it is gone for everyone", async () => {
  const env = fresh();
  const id = await upload(env, PNG, Date.now());
  assert.equal((await handleMedia(new Request(`${SITE}/api/media/${id}`), env)).status, 200);
  assert.equal((await call(env, "DELETE", `/api/admin/media/${id}`, { origin: "https://evil.test" })).status, 403);
  assert.equal((await call(env, "DELETE", `/api/admin/media/${id}`, { key: false })).status, 401);
  assert.equal((await call(env, "DELETE", `/api/admin/media/${id}`)).status, 200);
  assert.equal((await handleMedia(new Request(`${SITE}/api/media/${id}`), env)).status, 404);
  assert.equal((await call(env, "DELETE", `/api/admin/media/${id}`)).status, 404);
  assert.equal((await call(env, "DELETE", "/api/admin/media/..%2f..%2fx")).status, 404);
  assert.equal((await call(env, "GET", "/api/admin/summary")).body.media.count, 0);
});

test("through the Worker, removing a file also clears the copy the edge holds", async () => {
  const env = fresh();
  const id = await upload(env, PNG, Date.now());
  const cleared = [];
  globalThis.caches = { default: { match: async () => undefined, put: async () => {}, delete: async (request) => { cleared.push(request.url); return true; } } };
  try {
    const jobs = [];
    const res = await worker.fetch(new Request(`${SITE}/api/admin/media/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${KEY}`, origin: SITE } }), { ...env, ASSETS: {} }, { waitUntil: (p) => jobs.push(p) });
    assert.equal(res.status, 200);
    await Promise.all(jobs);
    assert.deepEqual(cleared, [`${SITE}/api/media/${id}`]);
  } finally {
    delete globalThis.caches;
  }
});
