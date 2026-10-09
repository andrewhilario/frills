// The shared relay (the helper run for many people): which websites may use it, the line for spots when it is full, and the limit on how
// many streams one visitor address can hold open. Run for real on a spare port with a pretend TikTok behind it.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { createHelper } from "../helper/server.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITE = "https://site.test";

class FakeConnection extends EventEmitter {
  constructor() { super(); this.gone = false; }
  async connect() { await sleep(5); }
  disconnect() { if (!this.gone) { this.gone = true; this.emit("disconnected"); } }
}

const everyHelper = [];
let helper;
let port;
/** A relay with a few spots. Short waits, so the line moves quickly in a test. */
async function start({ relay = {}, ...tuning } = {}) {
  const made = [];
  helper = createHelper({ relay: { origins: [SITE], slots: 2, maxPerIp: 20, trustProxy: false, ...relay }, factory: async (user) => { const c = new FakeConnection(); made.push({ user, c }); return c; }, queueGraceMs: 80, idleStopMs: 60, ...tuning });
  everyHelper.push(helper);
  port = await helper.listen(0);
  return made;
}
after(async () => { for (const h of everyHelper) await h.close(); });

const raw = (path, { method = "GET", headers = {} } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: "127.0.0.1", port, path, method, headers: { Host: "relay.example.test", ...headers } }, (res) => {
    let body = "";
    res.on("data", (c) => { body += c; });
    res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
  });
  req.on("error", reject);
  req.end();
});

/** Listens to a stream like a page on the website would. */
function listen(user, headers = {}) {
  const events = [];
  const req = http.get({ host: "127.0.0.1", port, path: `/tiktok/stream?user=${encodeURIComponent(user)}`, headers: { Host: "relay.example.test", Origin: SITE, ...headers } });
  let status = 0;
  const done = new Promise((resolve) => {
    req.on("response", (res) => {
      status = res.statusCode;
      res.setEncoding("utf8");
      let buffer = "";
      res.on("data", (chunk) => {
        buffer += chunk;
        let cut;
        while ((cut = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const name = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (name && data) events.push({ name, data: JSON.parse(data) });
        }
      });
      res.on("close", resolve);
    });
    req.on("error", resolve);
  });
  return {
    events,
    get status() { return status; },
    last: () => events.filter((e) => e.name === "status").at(-1)?.data,
    states: () => events.filter((e) => e.name === "status").map((e) => e.data.state),
    async until(test, ms = 2000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (test()) return;
        await sleep(10);
      }
      throw new Error("Timed out. Saw: " + JSON.stringify(events.map((e) => e.data.state + (e.data.position ? ":" + e.data.position : ""))));
    },
    close: () => { req.destroy(); return done; },
  };
}

test("a relay says what it is and how full it is, and only the website's own pages may use it from a browser", async () => {
  await start();
  const ping = await raw("/tiktok/ping");
  assert.equal(ping.status, 200);
  const body = JSON.parse(ping.body);
  assert.equal(body.name, "frills-relay");
  assert.deepEqual(body.slots, { used: 0, max: 2, waiting: 0 });
  assert.deepEqual(JSON.parse((await raw("/health")).body).slots, { used: 0, max: 2, waiting: 0 });

  const fromSite = await raw("/tiktok/ping", { headers: { Origin: SITE } });
  assert.equal(fromSite.headers["access-control-allow-origin"], SITE);
  assert.equal(fromSite.headers.vary, "Origin");
  assert.equal((await raw("/tiktok/ping", { headers: { Origin: "https://evil.example" } })).status, 403);
  const preflight = await raw("/tiktok/stream?user=a.b", { method: "OPTIONS", headers: { Origin: SITE } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], SITE);
  assert.equal((await raw("/tiktok/stream?user=a.b", { method: "OPTIONS", headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await raw("/editor/")).status, 404, "a relay serves no site of its own");
  assert.equal((await raw("/tiktok/stream?user=no%20spaces", { headers: { Origin: SITE } })).status, 400);
  await helper.close();
});

test("when every spot is taken the next accounts wait in line, are told their place, and get a spot as people finish", async () => {
  const made = await start();
  const a = listen("acct.a");
  const b = listen("acct.b");
  await Promise.all([a.until(() => a.states().includes("connected")), b.until(() => b.states().includes("connected"))]);
  const c = listen("acct.c");
  await c.until(() => c.last()?.state === "queued");
  assert.deepEqual([c.last().position, c.last().total], [1, 1]);
  const d = listen("acct.d");
  await d.until(() => d.last()?.state === "queued");
  await c.until(() => c.last().total === 2);
  assert.deepEqual([c.last().position, d.last().position, d.last().total], [1, 2, 2]);
  assert.deepEqual(helper.hub.stats(), { used: 2, max: 2, waiting: 2 });
  assert.equal(made.length, 2, "nothing is connected to TikTok for someone who is waiting");

  await a.close(); // a leaves; its spot is let go a moment later and the first in line gets it
  await c.until(() => c.states().includes("connected"));
  await d.until(() => d.last()?.position === 1 && d.last()?.total === 1);
  assert.equal(made.length, 3);
  assert.deepEqual(helper.hub.stats(), { used: 2, max: 2, waiting: 1 });
  c.events.at(-1); // c is now an ordinary page
  made.find((m) => m.user === "acct.c").c.emit("chat", { common: { msgId: "1" }, user: { id: "9", displayId: "x", nickname: "Ann" }, content: "from the line", userIdentity: {} });
  await c.until(() => c.events.some((e) => e.name === "chat"));

  await c.close(); // the moved page leaving still frees its spot
  await d.until(() => d.states().includes("connected"));
  await Promise.all([b.close(), d.close()]);
  await helper.close();
});

test("two pages for the same waiting account share one place, and a page that reloads in time keeps its turn", async () => {
  await start({ relay: { slots: 1 } });
  const a = listen("acct.a");
  await a.until(() => a.states().includes("connected"));
  const c1 = listen("acct.c");
  const c2 = listen("acct.c");
  const d = listen("acct.d");
  await Promise.all([c1.until(() => c1.last()?.state === "queued"), c2.until(() => c2.last()?.state === "queued"), d.until(() => d.last()?.state === "queued")]);
  assert.equal(helper.hub.stats().waiting, 2, "c is one place, not two");
  await d.until(() => d.last().position === 2);
  await Promise.all([c1.close(), c2.close()]);
  const back = listen("acct.c"); // reloaded within the grace time
  await back.until(() => back.last()?.state === "queued");
  assert.equal(back.last().position, 1, "it is still first in line");
  await Promise.all([a.close(), back.close(), d.close()]);
  await helper.close();
});

test("a place nobody is listening to is given up after a short while, and the line closes up", async () => {
  await start({ relay: { slots: 1 } });
  const a = listen("acct.a");
  await a.until(() => a.states().includes("connected"));
  const c = listen("acct.c");
  const d = listen("acct.d");
  await d.until(() => d.last()?.position === 2);
  await c.close();
  await d.until(() => d.last().position === 1, 1500);
  assert.equal(helper.hub.stats().waiting, 1);
  await Promise.all([a.close(), d.close()]);
  await helper.close();
});

test("one visitor address can only hold a few streams open at once, and the limit follows the real address behind a tunnel", async () => {
  await start({ relay: { slots: 10, maxPerIp: 2, trustProxy: true } });
  const ip = (address) => ({ "cf-connecting-ip": address });
  const one = listen("acct.a", ip("1.1.1.1"));
  const two = listen("acct.b", ip("1.1.1.1"));
  await Promise.all([one.until(() => one.states().includes("connected")), two.until(() => two.states().includes("connected"))]);
  const refused = await raw("/tiktok/stream?user=acct.c", { headers: { Origin: SITE, ...ip("1.1.1.1") } });
  assert.equal(refused.status, 429);
  const other = listen("acct.c", ip("2.2.2.2"));
  await other.until(() => other.states().includes("connected"));
  await one.close();
  await sleep(60);
  const again = listen("acct.d", ip("1.1.1.1"));
  await again.until(() => again.states().includes("connected"));
  await Promise.all([two.close(), other.close(), again.close()]);
  await helper.close();
});

test("the pretend account works through a relay too, and still never touches TikTok", async () => {
  const made = await start({ demoPace: [10, 20] });
  const page = listen("frills_demo");
  await page.until(() => page.events.filter((e) => e.name === "chat").length >= 3, 3000);
  assert.equal(made.length, 0);
  await page.close();
  await helper.close();
});
