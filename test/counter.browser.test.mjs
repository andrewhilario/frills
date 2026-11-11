// The Live Counter in a real headless Chrome, with a pretend TikTok behind the helper: the viewers and the likes of a LIVE are shown and change,
// the viewers stay hidden until TikTok has said, the look settings in the link work, and the editor's test buttons and link work.
// Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createHelper } from "../helper/server.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "counter", "index.html"))) throw new Error("dist/ has no counter page. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

class FakeConnection extends EventEmitter {
  async connect() { await sleep(5); }
  disconnect() { this.emit("disconnected"); }
}
const opened = [];
async function withHelper() {
  const made = [];
  const helper = createHelper({ distDir: dist, factory: async () => { const c = new FakeConnection(); made.push(c); return c; }, idleStopMs: 200, offlineWaitMs: 60, limitedWaitMs: 60, backoffMs: [30, 30] });
  const port = await helper.listen(0);
  opened.push(helper);
  return { base: `http://127.0.0.1:${port}`, made };
}
const until = async (check, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await check()) return; await sleep(30); }
  throw new Error("Timed out");
};
let page;
before(async () => { if (!skip) { page = await launch(); await page.viewport(1280, 900); } });
after(async () => { await page?.close(); for (const h of opened) await h.close(); });

const text = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim() ?? null`);
const shown = (kind) => page.evaluate(`(() => { const i = document.querySelector(".counter__item--${kind}"); return i && !i.hidden ? i.textContent.trim() : null; })()`);
const click = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const type = (selector, value) => page.evaluate(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const person = (name) => ({ id: name, displayId: name, nickname: name });
const like = (id, count, total) => ({ common: { msgId: id }, user: person("ann"), likeCount: count, totalLikeCount: total });

test("the counter pages load under the security policy with no console errors", { skip }, async () => {
  for (const path of ["/counter/", "/overlay/counter/?demo=1"]) {
    await page.goto(`http://127.0.0.1:${(await withHelper()).base.split(":").pop()}${path}`, { settle: 600 });
    assert.deepEqual(page.problems, [], `${path}: ${page.problems.join(" | ")}`);
  }
});

test("overlay: the likes of the LIVE and how many are watching are shown, and the viewers stay hidden until TikTok has said", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/counter/?channel=pond_cafe&platform=tiktok`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  assert.equal(await shown("viewers"), null, "no number yet: nothing is shown instead of a wrong 0");
  assert.equal(await shown("likes"), null, "no likes yet either");
  made[0].emit("like", like("1", 5, 1200));
  await until(async () => (await shown("likes")) !== null);
  assert.equal(await text(".counter__item--likes .counter__num"), "1,200");
  assert.equal(await text(".counter__item--likes .counter__label"), "likes");
  made[0].emit("roomUser", { viewerCount: 48 });
  await until(async () => (await shown("viewers")) !== null);
  assert.equal(await text(".counter__item--viewers .counter__num"), "48");
  assert.equal(await text(".counter__item--viewers .counter__label"), "watching");
  made[0].emit("like", like("2", 20, 1220));
  await until(async () => (await text(".counter__item--likes .counter__num")) === "1,220");
});

test("overlay: the link's settings change what shows and how", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/counter/?channel=pond_cafe&platform=tiktok&layout=pill&short=1&showLikes=1&viewersLabel=in+the+pond&icons=0`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("like", like("1", 5, 12345));
  made[0].emit("roomUser", { viewerCount: 2500 });
  await until(async () => (await shown("viewers")) !== null && (await shown("likes")) !== null);
  assert.equal(await text(".counter__item--likes .counter__num"), "12.3K", "short numbers");
  assert.equal(await text(".counter__item--viewers .counter__num"), "2.5K");
  assert.equal(await text(".counter__item--viewers .counter__label"), "in the pond");
  assert.equal(await page.evaluate(`document.querySelector(".counter").dataset.layout`), "pill");
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector(".counter__icon")).display`), "none", "no little pictures when turned off");
  await page.goto(`${base}/overlay/counter/?demo=1&showViewers=0`, { settle: 800 });
  await until(async () => (await shown("likes")) !== null);
  assert.equal(await shown("viewers"), null, "the viewers can be switched off");
});

test("overlay: the practice page (no account) fills in made-up numbers that change", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(`${base}/overlay/counter/?demo=1&pace=300`, { settle: 800 });
  await until(async () => (await shown("viewers")) !== null && (await shown("likes")) !== null);
  const first = await text(".counter__item--likes .counter__num");
  await until(async () => (await text(".counter__item--likes .counter__num")) !== first, 4000);
});

test("editor: the test buttons move the numbers, and the link carries the changes", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/counter/", { settle: 800 });
  await click('[data-test="watch"]');
  await click('[data-test="likes"]');
  await until(async () => (await shown("viewers")) !== null && (await shown("likes")) !== null);
  const before = await text(".counter__item--likes .counter__num");
  await click('[data-test="burst"]');
  await until(async () => (await text(".counter__item--likes .counter__num")) !== before);
  await click('[data-test="clear"]');
  await until(async () => (await shown("viewers")) === null && (await shown("likes")) === null);
  await type("#c-viewersLabel", "friends");
  await type("#source-channel", "pond.pal");
  const url = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(url.pathname, "/overlay/counter/");
  assert.equal(url.searchParams.get("viewersLabel"), "friends");
  assert.equal(url.searchParams.get("channel"), "pond.pal");
});

test("the overlays page lists the counter, marked beta", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/overlays/", { settle: 500 });
  const card = await page.evaluate(`[...document.querySelectorAll(".tool")].filter((t) => t.querySelector("a[href='/counter/']")).map((t) => t.querySelector(".tool__badge")?.textContent.trim())`);
  assert.deepEqual(card, ["Beta"]);
});
