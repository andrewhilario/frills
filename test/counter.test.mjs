// The Live Counter: the settings and the link, how numbers are written, how the likes and the viewers are kept, and the relay passing the viewer
// count on (a pretend TikTok connection, no network).

import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHelper } from "../helper/server.mjs";
import { COUNTER, LiveCounter, formatCount } from "../src/js/counter.js";
import { fakeCounterSource } from "../src/js/fake-alerts.js";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "index.html"))) throw new Error("dist/ is empty. Run `npm run build` first (`npm test` does that for you).");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the settings ───────────────────────────────────────────────────────────────────────────────────

test("the counter's settings are checked, and a link carries only what was changed", () => {
  const defaults = COUNTER.sanitize({});
  assert.deepEqual([defaults.showViewers, defaults.showLikes, defaults.layout, defaults.short], [true, true, "row", false]);
  const odd = COUNTER.sanitize({ layout: "diagonal", showViewers: "yes", viewersLabel: "x".repeat(99) + "\n", short: true });
  assert.equal(odd.layout, "row", "an unknown layout is the default");
  assert.equal(odd.showViewers, true, "a toggle must be a real true or false");
  assert.equal(odd.viewersLabel.length, 24, "the words are cut");
  assert.ok(!odd.viewersLabel.includes("\n"), "and have no line breaks");
  assert.equal(odd.short, true);
  const link = COUNTER.url("https://frills.test/overlay/counter/", { channel: "pond.pal", settings: { ...defaults, layout: "pill", showLikes: false } });
  const params = new URL(link).searchParams;
  assert.deepEqual([params.get("channel"), params.get("layout"), params.get("showLikes"), params.has("showViewers")], ["pond.pal", "pill", "0", false]);
  const back = COUNTER.sanitize(COUNTER.fromParams(params));
  assert.deepEqual([back.layout, back.showLikes, back.showViewers], ["pill", false, true], "the link reads back the same");
});

test("numbers are written in full, or short", () => {
  assert.deepEqual([0, 7, 999, 1000, 12345, 1234567].map((n) => formatCount(n)), ["0", "7", "999", "1,000", "12,345", "1,234,567"]);
  assert.deepEqual([0, 999, 1000, 1234, 12345, 99999, 123456, 999999, 1000000, 2500000].map((n) => formatCount(n, true)), ["0", "999", "1K", "1.2K", "12.3K", "99.9K", "123K", "1M", "1M", "2.5M"]);
  assert.deepEqual([formatCount("junk"), formatCount(-4), formatCount(null), formatCount(12.6)], ["0", "0", "0", "13"]);
});

// ── the numbers ────────────────────────────────────────────────────────────────────────────────────

test("the viewers stay unknown until the relay says, and a sound number replaces the last one", () => {
  const seen = [];
  const counter = new LiveCounter(COUNTER.sanitize({}), { onChange: (s) => seen.push(s) });
  assert.deepEqual(counter.state, { viewers: null, likes: null });
  counter.setViewers(40);
  counter.setViewers(40);
  counter.setViewers(41);
  assert.equal(seen.length, 2, "the same number again changes nothing");
  for (const bad of [-1, "lots", NaN, 1e12, undefined]) counter.setViewers(bad);
  assert.equal(counter.viewers, 41, "a damaged number is ignored");
  counter.setViewers(0);
  assert.equal(counter.viewers, 0, "nobody watching is a real number");
});

test("the likes follow the LIVE's total and never go back down; an event with no total adds its own count", () => {
  const counter = new LiveCounter(COUNTER.sanitize({}));
  counter.addLike({ kind: "like", count: 5, total: 1200 });
  assert.equal(counter.likes, 1200, "the first total is taken as it is: the overlay may open in the middle of a LIVE");
  counter.addLike({ kind: "like", count: 3, total: 1210 });
  counter.addLike({ kind: "like", count: 9, total: 1205 });
  assert.equal(counter.likes, 1210, "a late event with a lower total cannot lower it");
  counter.addLike({ kind: "like", count: 4, total: 0 });
  assert.equal(counter.likes, 1214, "no total: the count is added");
  counter.addLike({ kind: "gift", count: 99, total: 99999 });
  counter.addLike(null);
  assert.equal(counter.likes, 1214, "other events are not likes");
  counter.clear();
  assert.deepEqual(counter.state, { viewers: null, likes: null });
  counter.addLike({ kind: "like", count: 0, total: 0 });
  assert.equal(counter.likes, 0, "a LIVE with no likes yet is a real 0");
});

test("the practice source makes the viewers drift and the likes grow, and stops when asked", async () => {
  const viewers = [];
  const likes = [];
  const source = fakeCounterSource({ onViewers: (n) => viewers.push(n), onLike: (e) => likes.push(e) }, () => [5, 10]);
  await sleep(700);
  source.stop();
  const seen = viewers.length;
  await sleep(60);
  assert.equal(viewers.length, seen, "stopped means stopped");
  assert.ok(viewers.length >= 3 && viewers.every((n) => n >= 5));
  const totals = likes.map((e) => e.total);
  assert.deepEqual(totals, [...totals].sort((a, b) => a - b), "the total only goes up");
  assert.ok(likes.every((e) => e.kind === "like"));
});

// ── the relay passes the viewer count on ───────────────────────────────────────────────────────────

class FakeConnection extends EventEmitter {
  async connect() { await sleep(5); }
  disconnect() { this.emit("disconnected"); }
}
let helper;
let port;
after(async () => { await helper?.close(); });
async function start() {
  const made = [];
  helper = createHelper({ distDir: dist, factory: async () => { const c = new FakeConnection(); made.push(c); return c; }, idleStopMs: 80, offlineWaitMs: 40, limitedWaitMs: 40, backoffMs: [30, 30] });
  port = await helper.listen(0);
  return made;
}
function listen(account) {
  const seen = [];
  const req = http.get({ host: "127.0.0.1", port, path: `/tiktok/stream?user=${account}&events=like`, headers: { Host: `127.0.0.1:${port}` } });
  req.on("response", (res) => {
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
        if (name && data) seen.push({ name, data: JSON.parse(data) });
      }
    });
  });
  req.on("error", () => {});
  return {
    infos: () => seen.filter((e) => e.name === "info").map((e) => e.data),
    async until(check, ms = 4000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (check()) return; await sleep(10); }
      throw new Error("Timed out. Saw: " + JSON.stringify(seen.map((e) => e.name)));
    },
    close: () => req.destroy(),
  };
}

test("the relay says it can send the viewer count, and passes on how many are watching: first at once, then at most every few seconds", async () => {
  const made = await start();
  const res = await new Promise((resolve) => http.get({ host: "127.0.0.1", port, path: "/tiktok/ping", headers: { Host: `127.0.0.1:${port}` } }, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => resolve(JSON.parse(b))); }));
  assert.ok(res.features.includes("viewers"), "a page can tell this relay can say how many are watching");
  const page = listen("pond_cafe");
  await page.until(() => made.length === 1);
  await sleep(60);
  made[0].emit("roomUser", { viewerCount: 48 });
  await page.until(() => page.infos().some((i) => i.viewers === 48));
  made[0].emit("roomUser", { viewerCount: 50 });
  made[0].emit("roomUser", { viewerCount: 51 });
  made[0].emit("roomUser", { viewerCount: "many" });
  made[0].emit("roomUser", { viewerCount: -4 });
  made[0].emit("roomUser", {});
  await sleep(200);
  assert.equal(page.infos().filter((i) => i.viewers > 48).length, 0, "a number that comes too soon after the last waits for its turn");
  await page.until(() => page.infos().some((i) => i.viewers === 51), 5000);
  assert.ok(!page.infos().some((i) => i.viewers === 50), "and only the newest of the waiting numbers is sent");
  assert.ok(page.infos().every((i) => i.viewers === undefined || (Number.isInteger(i.viewers) && i.viewers > 0)), "nothing damaged reaches a page");
  page.close();
});

test("a page that opens in the middle of a LIVE is told the number at once", async () => {
  await helper?.close();
  const made = await start();
  const first = listen("pond_cafe");
  await first.until(() => made.length === 1);
  await sleep(60);
  made[0].emit("roomUser", { viewerCount: 77 });
  await first.until(() => first.infos().some((i) => i.viewers === 77));
  const late = listen("pond_cafe");
  await late.until(() => late.infos().some((i) => i.viewers === 77), 2000);
  first.close();
  late.close();
});
