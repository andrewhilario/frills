// Restarting the relay from the owner's status page: who may ask, when it says no, what a page on another site can't do, and the keeper that starts the relay
// again (helper/keep.mjs). The button on the page itself is in relay-restart.browser.test.mjs.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHelper } from "../helper/server.mjs";
import { keep } from "../helper/keep.mjs";

const SITE = "https://frills.example";
const KEY = "a-long-owner-password";
const helpers = [];
after(async () => { for (const h of helpers) await h.close(); });

class FakeConnection extends EventEmitter {
  async connect() {}
  disconnect() { this.emit("disconnected"); }
}

/** A relay with the owner's password and a pretend restart that counts how often it was asked for. */
async function start({ relay = {} } = {}) {
  const calls = { restart: 0 };
  const helper = createHelper({
    relay: { origins: [SITE], slots: 2, maxPerIp: 20, trustProxy: false, ownerKey: KEY, restart: () => { calls.restart++; }, minUptimeMs: 0, restartGapMs: 60000, ...relay },
    factory: async () => new FakeConnection(),
  });
  helpers.push(helper);
  const port = await helper.listen(0);
  return { base: `http://127.0.0.1:${port}`, calls };
}
const post = (base, key, headers = {}) => fetch(`${base}/owner/restart`, { method: "POST", headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers } });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("restart: only the owner's password restarts the relay, only by POST, and the relay is told once", async () => {
  const { base, calls } = await start();
  assert.equal((await fetch(`${base}/owner/restart`)).status, 405, "a plain visit does nothing");
  const none = await post(base, "");
  assert.deepEqual([none.status, (await none.json()).error], [401, "key_needed"]);
  const wrong = await post(base, "not-the-password-at-all");
  assert.deepEqual([wrong.status, (await wrong.json()).error], [401, "wrong_key"]);
  await wait(400);
  assert.equal(calls.restart, 0, "nothing restarted so far");

  const ok = await post(base, KEY);
  assert.deepEqual([ok.status, await ok.json()], [200, { ok: true, restarting: true }]);
  await wait(500); // (the relay answers first, then stops a moment later)
  assert.equal(calls.restart, 1);

  const again = await post(base, KEY);
  assert.deepEqual([again.status, (await again.json()).error], [429, "too_soon"], "a second ask straight away is turned down");
  await wait(400);
  assert.equal(calls.restart, 1);
});

test("restart: it says no when there is no owner password, when nothing would start the relay again, and in the first moments after a start", async () => {
  const noKey = await start({ relay: { ownerKey: undefined } });
  const a = await post(noKey.base, KEY);
  assert.deepEqual([a.status, (await a.json()).error], [403, "no_owner_password"]);

  const alone = await start({ relay: { restart: null } });
  const b = await post(alone.base, KEY);
  assert.deepEqual([b.status, (await b.json()).error], [409, "not_supervised"], "a relay nobody would start again stays up");

  const fresh = await start({ relay: { minUptimeMs: 15000 } });
  const c = await post(fresh.base, KEY);
  assert.deepEqual([c.status, (await c.json()).error], [429, "too_soon"]);
  await wait(300);
  assert.equal(fresh.calls.restart, 0);
});

test("restart: a page on another site gets no permission to ask, and the status numbers show the restart choice only to the owner", async () => {
  const { base, calls } = await start();
  const preflight = await fetch(`${base}/owner/restart`, { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization" } });
  assert.equal(preflight.headers.get("access-control-allow-origin"), null, "no permission is given to another site");
  const sent = await post(base, "", { Origin: "https://evil.example" });
  assert.equal(sent.headers.get("access-control-allow-origin"), null);
  assert.equal(calls.restart, 0);

  const plain = await (await fetch(`${base}/health`)).json();
  assert.equal("actions" in plain, false, "the public numbers carry no controls (not even to someone on the same device)");
  const owner = await (await fetch(`${base}/health`, { headers: { authorization: `Bearer ${KEY}` } })).json();
  assert.deepEqual(owner.actions, { restart: true });
  const alone = await start({ relay: { restart: null } });
  assert.deepEqual((await (await fetch(`${alone.base}/health`, { headers: { authorization: `Bearer ${KEY}` } })).json()).actions, { restart: false });
});

test("keeper: it runs the relay with RELAY_SUPERVISED set, starts it again each time it ends, and stops for good when asked", async () => {
  const lines = [];
  // a program that is happy only when it was told it is being kept
  const run = keep({ command: process.execPath, args: ["-e", "setTimeout(() => process.exit(process.env.RELAY_SUPERVISED === '1' ? 0 : 3), 60)"], delayMs: 20, quickMs: 1, log: (line) => lines.push(line) });
  for (let i = 0; i < 100 && lines.length < 3; i++) await wait(50); // (starting a program takes a moment, more on some computers)
  run.stop();
  const code = await run.done;
  assert.equal(code, 0, "it was told it is kept");
  const starts = lines.length;
  assert.ok(starts >= 3, `it started the program again and again (${starts} times)`);
  assert.ok(lines.every((line) => /code 0/.test(line)), lines.join(" | "));
  await wait(200);
  assert.equal(lines.length, starts, "and after stop() nothing starts again");
});

test("keeper: a program that stops straight away is started again after longer and longer waits, not many times a second", async () => {
  const lines = [];
  const run = keep({ command: process.execPath, args: ["-e", "process.exit(1)"], delayMs: 40, maxDelayMs: 160, quickMs: 10000, log: (line) => lines.push(line) });
  await wait(1000);
  run.stop();
  await run.done;
  assert.ok(lines.length >= 3 && lines.length <= 9, `${lines.length} starts in a second: ${lines.join(" | ")}`);
});
