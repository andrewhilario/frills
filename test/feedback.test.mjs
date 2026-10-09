// The feedback form's receiving end, run over a real (in-memory) SQLite database with the same schema D1 gets: what is saved, what is
// refused, how a bot is treated, the hourly limit, a missing database, and the Worker's wiring in wrangler.jsonc.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handleFeedback, LIMITS } from "../worker/feedback.mjs";
import worker from "../worker/index.mjs";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";

const SITE = "https://frills.example";
const good = { kind: "idea", app: "obs", message: "Please add a pink look with hearts.", contact: "@mochi", website: "", took: 8000 };

const post = (body, { origin = SITE, type = "application/json", raw } = {}) =>
  new Request(`${SITE}/api/feedback`, { method: "POST", headers: { origin, "content-type": type }, body: raw ?? JSON.stringify(body) });
const send = async (body, env, opts, extra) => {
  const res = await handleFeedback(post(body, opts), env, extra);
  return { status: res.status, body: await res.json() };
};
const rows = (env) => env.DB.raw.prepare("SELECT * FROM feedback ORDER BY id").all();
const fresh = () => ({ DB: localDatabase(":memory:") });

test("a good message is saved with its date, kind, app and contact, and nothing else", async () => {
  const env = fresh();
  const now = Date.UTC(2026, 9, 9, 12, 0, 0);
  const res = await send(good, env, {}, { now });
  assert.deepEqual([res.status, res.body], [201, { ok: true }]);
  const [row] = rows(env);
  assert.deepEqual({ ...row }, { id: 1, created: "2026-10-09T12:00:00.000Z", kind: "idea", app: "obs", message: "Please add a pink look with hearts.", contact: "@mochi" });
});

test("the app and the contact are optional", async () => {
  const env = fresh();
  const res = await send({ kind: "broken", message: "The chat is empty in my scene.", took: 5000 }, env);
  assert.equal(res.status, 201);
  const [row] = rows(env);
  assert.equal(row.app, null);
  assert.equal(row.contact, null);
});

test("only this site's own page may send, and only JSON by POST", async () => {
  const env = fresh();
  assert.equal((await send(good, env, { origin: "https://evil.example" })).status, 403);
  assert.equal((await handleFeedback(new Request(`${SITE}/api/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(good) }), env)).status, 403, "no Origin at all");
  assert.equal((await send(good, env, { type: "text/plain" })).status, 415);
  const get = await handleFeedback(new Request(`${SITE}/api/feedback`, { method: "GET" }), env);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");
  assert.equal((await send(null, env, { raw: "{not json" })).status, 400);
  assert.equal((await send(null, env, { raw: "[1,2]" })).status, 400);
  assert.equal((await send(null, env, { raw: JSON.stringify({ message: "x".repeat(LIMITS.bodyChars + 1) }) })).status, 413);
  assert.equal(rows(env).length, 0, "none of that was saved");
});

test("messages must be between 10 and 2000 characters, and the kind and app must be known", async () => {
  const env = fresh();
  assert.equal((await send({ ...good, message: "too short" }, env)).body.error, "too_short");
  assert.equal((await send({ ...good, message: "   \n\n   " }, env)).body.error, "too_short");
  assert.equal((await send({ ...good, message: "a".repeat(2001) }, env)).body.error, "too_long");
  assert.equal((await send({ ...good, message: "a".repeat(2000) }, env)).status, 201);
  assert.equal((await send({ ...good, kind: "spam" }, env)).body.error, "bad_kind");
  assert.equal((await send({ ...good, app: "my-own-app" }, env)).body.error, "bad_app");
  assert.equal(rows(env).length, 1);
});

test("control characters are removed, line breaks kept in the message, and the contact is cut to length", async () => {
  const env = fresh();
  await send({ ...good, message: "First line\u0000 here\r\n\r\n\r\n\r\nSecond\u0007 line, long enough.", contact: "a".repeat(300) + "\n\u0001" }, env);
  const [row] = rows(env);
  assert.equal(row.message, "First line  here\n\nSecond  line, long enough.");
  assert.equal(row.contact.length, LIMITS.contact);
});

test("a bot (the hidden field filled, or sent too fast) gets a normal thanks and nothing is saved", async () => {
  const env = fresh();
  assert.deepEqual((await send({ ...good, website: "http://spam.example" }, env)).body, { ok: true });
  assert.deepEqual((await send({ ...good, took: 200 }, env)).body, { ok: true });
  assert.deepEqual((await send({ ...good, took: undefined }, env)).body, { ok: true });
  assert.equal(rows(env).length, 0);
});

test("after an hour's limit of messages, more are turned away until the hour has passed", async () => {
  const env = fresh();
  const now = Date.UTC(2026, 9, 9, 12, 0, 0);
  for (let i = 0; i < LIMITS.perHour; i++) assert.equal((await send(good, env, {}, { now: now + i * 1000 })).status, 201);
  const refused = await handleFeedback(post(good), env, { now: now + 120_000 });
  assert.equal(refused.status, 429);
  assert.equal(refused.headers.get("retry-after"), "600");
  assert.equal(rows(env).length, LIMITS.perHour);
  assert.equal((await send(good, env, {}, { now: now + 3600_000 + 120_000 })).status, 201, "an hour later it works again");
});

test("with no database (not set up yet) or a broken one, it says so and does not crash", async () => {
  assert.equal((await send(good, {})).body.error, "not_ready");
  const broken = { DB: { prepare() { throw new Error("no such table"); } } };
  assert.equal((await send(good, broken)).status, 503);
});

test("the Worker answers /api/feedback itself and hands every other address to the static files", async () => {
  const env = { ...fresh(), ASSETS: { fetch: async (req) => new Response(`asset ${new URL(req.url).pathname}`) } };
  assert.equal((await worker.fetch(post(good), env)).status, 201);
  assert.equal(await (await worker.fetch(new Request(`${SITE}/privacy/`), env)).text(), "asset /privacy/");
});

test("wrangler.jsonc sends only /api/* to the Worker, so pages stay free static files", () => {
  const text = readFileSync(join(import.meta.dirname, "..", "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, "");
  const config = JSON.parse(text);
  assert.equal(config.main, "worker/index.mjs");
  assert.deepEqual(config.assets.run_worker_first, ["/api/*"]);
  assert.equal(config.assets.binding, "ASSETS");
  assert.equal(config.d1_databases[0].binding, "DB", "the Worker reads the database as env.DB");
  assert.match(config.d1_databases[0].database_id, /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/, "with a real database id");
});
