// Last Gifts, the Follower Goal and the overlays page in a real headless Chrome, with a pretend TikTok behind the helper: gifts arrive and
// are listed, follows move the bar and a goal celebrates and raises, the editors' test buttons and links work, and the page lists what
// is live and what is coming. Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createHelper } from "../helper/server.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "goal", "index.html"))) throw new Error("dist/ has no goal page. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

class FakeConnection extends EventEmitter {
  async connect() { await sleep(5); }
  disconnect() { this.emit("disconnected"); }
}
const opened = [];
async function withHelper() {
  const made = [];
  const helper = createHelper({ distDir: dist, factory: async () => { const c = new FakeConnection(); made.push(c); return c; }, idleStopMs: 200, offlineWaitMs: 5000 });
  const port = await helper.listen(0);
  opened.push(helper);
  return { base: `http://127.0.0.1:${port}`, made };
}
const until = async (check, ms = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await check()) return; await sleep(30); }
  throw new Error("Timed out");
};
let page;
before(async () => { if (!skip) { page = await launch(); await page.viewport(1280, 900); } });
after(async () => { await page?.close(); for (const h of opened) await h.close(); });

const person = (id, name) => ({ id, displayId: name.toLowerCase().replace(/\W/g, "_"), nickname: name });
const gift = (id, name, giftName, diamondCount, count = 1) => ({ common: { msgId: id }, user: person(id, name), gift: { name: giftName, type: 2, diamondCount }, repeatCount: count });
const follow = (id, name) => ({ common: { msgId: id }, user: person(id, name) });
const text = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim() ?? null`);
const click = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const type = (selector, value) => page.evaluate(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const rows = () => page.evaluate(`[...document.querySelectorAll(".gift:not(.gift--out)")].map((g) => g.querySelector(".gift__words").textContent)`);

test("every new page loads under the security policy with no console errors", { skip }, async () => {
  for (const path of ["/overlays/", "/gifts/", "/goal/", "/overlay/gifts/?demo=1", "/overlay/goal/?demo=1"]) {
    const { base } = await withHelper();
    await page.goto(base + path, { settle: 700 });
    assert.deepEqual(page.problems, [], `${path}: ${page.problems.join(" | ")}`);
  }
});

test("overlay: gifts from a TikTok LIVE are listed, newest at the bottom, the oldest leave when it is full, and small ones can be skipped", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/gifts/?channel=pond_cafe&platform=tiktok&max=3&minDiamonds=2&template=%7Bname%7D+%E2%86%92+%7Bgift%7D`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("gift", gift("g1", "Ann", "Rose", 1)); // too small
  for (const [i, n] of ["Ben", "Cat", "Dan", "Eve"].entries()) made[0].emit("gift", gift("g" + (i + 2), n, "Panda", 100));
  await until(async () => (await rows()).length === 3 && (await rows()).includes("Eve → Panda"));
  assert.deepEqual(await rows(), ["Cat → Panda", "Dan → Panda", "Eve → Panda"], "Ann was too small, Ben left to make room");
});

test("overlay: new gifts go at the top when asked, and the value shows when asked", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/gifts/?channel=pond_cafe&platform=tiktok&order=top&showDiamonds=1`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("gift", gift("g1", "Ann", "Rose", 5, 2));
  made[0].emit("gift", gift("g2", "Ben", "Panda", 100));
  await until(async () => (await rows()).length === 2);
  assert.equal(await page.evaluate(`document.querySelector(".giftlist").dataset.order`), "top");
  assert.match(await text(".gift__value"), /^10 diamonds$/);
});

test("overlay: followers move the goal bar, reaching it celebrates, and the next goal is set", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/goal/?channel=pond_cafe&platform=tiktok&start=8&target=10&step=5&label=Road+to+10&celebrateText=Yay`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  assert.equal(await text(".goal__label"), "Road to 10");
  assert.equal(await text(".goal__numbers"), "8 / 10");
  made[0].emit("follow", follow("f1", "Ann"));
  await until(async () => (await text(".goal__numbers")) === "9 / 10");
  assert.equal(await page.evaluate(`document.querySelector(".goal__fill").style.width`), "90%");
  made[0].emit("follow", follow("f2", "Ben"));
  await until(async () => (await text(".goal__cheer")) === "Yay");
  assert.equal(await page.evaluate(`document.querySelector(".goal").dataset.full`), "true");
  assert.ok(await page.evaluate(`document.querySelectorAll(".goal__fx i").length > 0`), "confetti");
  await until(async () => (await text(".goal__numbers")) === "10 / 15", 9000);
});

test("overlay: with remember turned on, the count survives a reload", { skip }, async () => {
  const { base, made } = await withHelper();
  const url = `${base}/overlay/goal/?channel=keep_me&platform=tiktok&start=0&target=100&keep=1`;
  await page.goto(url, { settle: 800 });
  await page.evaluate(`localStorage.clear()`);
  await page.goto(url, { settle: 800 });
  await until(() => made.length >= 1);
  await sleep(150);
  made[0].emit("follow", follow("f1", "Ann"));
  made[0].emit("follow", follow("f2", "Ben"));
  await until(async () => (await text(".goal__numbers")) === "2 / 100");
  await page.goto(url, { settle: 800 });
  assert.equal(await text(".goal__numbers"), "2 / 100", "remembered");
});

test("editor: the gifts test buttons list gifts, and changing the words and the link work", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/gifts/", { settle: 800 });
  await type("#c-template", "{name} gave {gift}!");
  await click('[data-test="gift"]');
  await click('[data-test="big"]');
  await until(async () => (await rows()).length === 2);
  assert.match((await rows())[0], / gave .+!$/);
  await click('[data-test="clear"]');
  await until(async () => (await rows()).length === 0);
  await type("#source-channel", "pond.pal");
  const url = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(url.pathname, "/overlay/gifts/");
  assert.equal(url.searchParams.get("channel"), "pond.pal");
  assert.ok(url.searchParams.get("template").startsWith("{name} gave"));
});

test("editor: the goal test buttons move the bar, reaching celebrates, and the goal and start can be changed", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/goal/", { settle: 800 });
  await type("#c-target", "20");
  await type("#c-start", "5");
  assert.equal(await text(".goal__numbers"), "5 / 20");
  await click('[data-test="ten"]');
  await until(async () => (await text(".goal__numbers")) === "15 / 20");
  await click('[data-test="reach"]');
  await until(async () => (await text(".goal__cheer")) !== "", 3000);
  await click('[data-test="reset"]');
  await until(async () => /^5 \/ \d+$/.test(await text(".goal__numbers")), 9000);
});

test("overlays page: the live ones link to their editors, and the coming ones are listed without links", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/overlays/", { settle: 600 });
  const links = await page.evaluate(`[...document.querySelectorAll(".tool:not(.tool--soon) a.btn")].map((a) => a.getAttribute("href"))`);
  assert.deepEqual(links, ["/editor/", "/matcha/", "/alerts/", "/gifts/", "/goal/"]);
  const soon = await page.evaluate(`[...document.querySelectorAll(".tool--soon")].map((t) => [t.querySelector(".subtitle").textContent, t.querySelectorAll("a").length])`);
  assert.deepEqual(soon.map((s) => s[0]), ["Free sound library", "Top likers", "TikTok and Twitch chat together", "Like and subscriber alerts"]);
  assert.ok(soon.every((s) => s[1] === 0), "a coming-soon card links nowhere");
  assert.equal(await page.evaluate(`document.querySelectorAll(".tool__badge--soon").length`), 4);
});
