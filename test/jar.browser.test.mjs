// Browser tests for Gift Jar (/jar/ editor and /overlay/jar/ overlay) in headless Chrome:
// 6 crystal container designs, live gift drops, full-jar badge & celebration, clear button, demo mode, URL serialization, and CSP clean check.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createHelper } from "../helper/server.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "jar", "index.html"))) throw new Error("Run `npm run build` first.");
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
const until = async (check, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await check()) return; await sleep(35); }
  throw new Error("Timed out");
};
let page;
before(async () => { if (!skip) { page = await launch(); await page.viewport(1280, 900); } });
after(async () => { await page?.close(); for (const h of opened) await h.close(); });

const person = (id, name) => ({ id, displayId: name.toLowerCase().replace(/\W/g, "_"), nickname: name });
const gift = (id, name, giftName, diamondCount, count = 1) => ({ common: { msgId: id }, user: person(name.toLowerCase(), name), gift: { name: giftName, type: 2, diamondCount }, repeatCount: count });
const click = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const type = (selector, value) => page.evaluate(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);

test("Gift Jar editor and overlay (demo + named designs) load cleanly under CSP", { skip }, async () => {
  const { base } = await withHelper();
  const paths = ["/jar/", "/overlay/jar/?demo=1&pace=500&design=boba", ...["potion", "piggy", "cat", "frog", "arcade"].map((d) => `/overlay/jar/?demo=1&design=${d}`)];
  for (const path of paths) {
    await page.goto(base + path, { settle: 450 });
    assert.deepEqual(page.problems, [], `${path}: ${page.problems.join(" | ")}`);
  }
});

test("overlay: Gift Jar drops real TikTok gifts inside chamber and marks FULL when target is reached", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/jar/?channel=pond_cafe&platform=tiktok&design=cat&target=500&celebrateTime=3`, { settle: 700 });
  await until(() => made.length === 1);
  assert.equal(await page.evaluate(`document.querySelector(".jar").dataset.design`), "cat");
  assert.ok(await page.evaluate(`Boolean(document.querySelector("canvas.jar__canvas"))`), "renders 3D physics canvas");
  assert.equal(await page.evaluate(`document.querySelector(".jar__meta").textContent`), "0 / 500 diamonds");

  made[0].emit("gift", gift("g1", "Ann", "Panda", 100, 1));
  await until(async () => (await page.evaluate(`Number(document.querySelector(".jar__box").dataset.items)`)) === 1);
  assert.equal(await page.evaluate(`document.querySelector(".jar__meta").textContent`), "100 / 500 diamonds");
  assert.equal(await page.evaluate(`document.querySelector(".jar").dataset.full`), "false");

  made[0].emit("gift", gift("g2", "Ben", "Galaxy", 1000, 1));
  await until(async () => (await page.evaluate(`document.querySelector(".jar").dataset.full`)) === "true");
  assert.equal(await page.evaluate(`document.querySelector(".jar__meta").textContent`), "500 / 500 diamonds");
  assert.equal(await page.evaluate(`document.querySelector(".jar__fullbadge").hidden`), false);
  assert.equal(await page.evaluate(`document.querySelector(".jar__party").hidden`), false);

  // When capNumbers=0 in gift-count mode, overflowing counts past target cleanly and stacks all 5 gifts
  const idx2 = made.length;
  await page.goto(`${base}/overlay/jar/?channel=pond_cafe_uncap&platform=tiktok&design=boba&goalBy=count&target=2&capNumbers=0`, { settle: 500 });
  await until(() => made.length > idx2);
  made[idx2].emit("gift", gift("g3", "Ann", "Rose", 1, 5));
  await until(async () => (await page.evaluate(`document.querySelector(".jar").dataset.full`)) === "true");
  assert.equal(await page.evaluate(`document.querySelector(".jar__meta").textContent`), "5 / 2 gifts");
  assert.ok(await page.evaluate(`Number(document.querySelector("canvas.jar__canvas").dataset.bodies) >= 5`), "drops and stacks >= 5 physical tokens for 5x Rose");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("editor: Gift Jar supports switching between the 6 jar designs, dropping gifts, filling, clearing, and generating URL", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(`${base}/jar/`, { settle: 700 });
  await click('[data-test="rose"]');
  await until(async () => (await page.evaluate(`Number(document.querySelector(".jar__box").dataset.items)`)) === 1);

  await page.evaluate(`(() => { const s = document.getElementById("c-design"); s.value = "potion"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  assert.equal(await page.evaluate(`document.querySelector(".jar").dataset.design`), "potion");

  await click('[data-test="fill"]');
  await until(async () => (await page.evaluate(`document.querySelector(".jar").dataset.full`)) === "true");
  assert.ok(await page.evaluate(`Number(document.querySelector("canvas.jar__canvas").dataset.bodies) >= 20`), "Fill jar showers >= 20 physical stacked gift icons");
  await sleep(600);
  assert.equal(await page.evaluate(`document.querySelector("canvas.jar__canvas").dataset.escaped`), "0", "No interior token escapes vessel walls or above mouth");

  await click('[data-test="clear"]');
  await until(async () => (await page.evaluate(`Number(document.querySelector(".jar__box").dataset.items)`)) === 0);
  assert.equal(await page.evaluate(`document.querySelector("canvas.jar__canvas").dataset.bodies`), "0");
  assert.equal(await page.evaluate(`document.querySelector(".jar").dataset.full`), "false");

  await type("#source-channel", "pond.pal");
  let url = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(url.pathname, "/overlay/jar/");
  assert.equal(url.searchParams.get("channel"), "pond.pal");
  assert.equal(url.searchParams.get("design"), "potion");

  assert.equal(await page.evaluate(`document.querySelector(".jar__meta").hidden`), false);
  await click("#c-capNumbers");
  url = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(url.searchParams.get("capNumbers"), "0");
  await click("#c-showNumbers");
  assert.equal(await page.evaluate(`document.querySelector(".jar__meta").hidden`), true);
  url = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(url.searchParams.get("showNumbers"), "0");
  await page.goto(url.toString(), { settle: 700 });
  assert.equal(await page.evaluate(`document.querySelector(".jar__meta").hidden`), true);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});
