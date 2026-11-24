// Browser tests for standalone Gift Gallery Rotator (/gallery/ and /overlay/gallery/) in headless Chrome:
// CSP clean load, custom gift row editing, starter packs, live light-up celebration + crown, auto-collect live mode,
// live TikTok gift unlock via mock helper, URL round-trip, and responsive layout at 320px & 1280px.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createHelper } from "../helper/server.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "gallery", "index.html"))) throw new Error("Run `npm run build` first.");
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
const galleryCard = () => page.evaluate(`(() => {
  const c = document.querySelector(".galcard:not(.galcard--out)");
  if (!c) return null;
  return {
    lit: c.dataset.lit,
    status: c.querySelector(".galcard__status")?.textContent?.trim(),
    name: c.querySelector(".galcard__name")?.textContent?.trim(),
    price: c.querySelector(".galcard__price")?.textContent?.trim(),
    caption: c.querySelector(".galcard__caption")?.textContent?.trim(),
    sender: c.querySelector(".galcard__sender")?.textContent?.trim(),
    crown: Boolean(c.querySelector(".galcard__crown")),
    progress: document.querySelector(".gallery__progress")?.textContent?.trim(),
  };
})()`);

test("Gift Gallery editor & demo overlay load cleanly under CSP with no console errors", { skip }, async () => {
  const { base } = await withHelper();
  for (const path of ["/gallery/", "/overlay/gallery/?demo=1&pace=700", "/overlay/gallery/?mode=live&demo=1&pace=700"]) {
    await page.goto(base + path, { settle: 700 });
    assert.deepEqual(page.problems, [], `${path}: ${page.problems.join(" | ")}`);
  }
});

test("editor: Gift Gallery supports starter packs, custom gift rows, Test light up unlock celebration, and clean link generation", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(`${base}/gallery/`, { settle: 700 });
  await page.evaluate("localStorage.clear()");
  await page.goto(`${base}/gallery/`, { settle: 700 });

  // Reset lit -> all unlit, then switch to VTuber Rewards starter pack
  await click('[data-test="clear"]');
  await page.evaluate(`[...document.querySelectorAll(".gal-preset")].find((b) => b.textContent.includes("VTuber Rewards")).click()`);
  assert.equal(await page.evaluate(`document.querySelectorAll(".gal-row").length`), 6);
  let card = await galleryCard();
  assert.equal(card.lit, "false");
  assert.equal(card.name, "Rose");
  assert.equal(card.caption, "Thank you shoutout");
  assert.equal(card.progress, "0 / 6 lit");

  // Click Test light up -> Rose lights up with crown and progress 1 / 6 lit
  await click('[data-test="unlock"]');
  await until(async () => (await galleryCard())?.lit === "true");
  card = await galleryCard();
  assert.equal(card.status, "LIT UP");
  assert.equal(card.crown, true);
  assert.equal(card.progress, "1 / 6 lit");
  assert.match(card.sender, /^Lit up by /);

  // Add a custom gift row and customize layout + animation
  await click("#gal-add");
  assert.equal(await page.evaluate(`document.querySelectorAll(".gal-row").length`), 7);
  await page.evaluate(`(() => { const s = document.getElementById("c-layout"); s.value = "neon"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await page.evaluate(`[...document.querySelectorAll("#opt-controls .chip")].find((b) => b.textContent.trim() === "3D Flip")?.click()`);
  await type("#source-channel", "pond.pal");

  const rawUrl = await page.evaluate(`document.getElementById("link").value`);
  const parsed = new URL(rawUrl);
  assert.equal(parsed.pathname, "/overlay/gallery/");
  assert.equal(parsed.searchParams.get("channel"), "pond.pal");
  assert.equal(parsed.searchParams.get("layout"), "neon");
  assert.equal(parsed.searchParams.get("enter"), "flip");
  assert.ok(parsed.searchParams.get("items"), "custom preset + added gift serializes into items param");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("overlay: Gift Gallery lights up live TikTok gifts, credits sender, and rotates across cards", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/gallery/?channel=pond_cafe&rotateSec=3`, { settle: 700 });
  await until(() => made.length === 1);
  await sleep(150);

  let card = await galleryCard();
  assert.equal(card.lit, "false");
  assert.equal(card.progress, "0 / 6 lit");

  made[0].emit("gift", gift("gg1", "Maya", "Galaxy", 1000, 1));
  await until(async () => (await galleryCard())?.name === "Galaxy" && (await galleryCard())?.lit === "true");
  card = await galleryCard();
  assert.equal(card.sender, "Lit up by Maya");
  assert.equal(card.crown, true);
  assert.equal(card.progress, "1 / 6 lit");

  // Auto-rotates cleanly to the next slot after 3s
  await until(async () => (await galleryCard())?.name !== "Galaxy", 5000);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("gallery editor has no sideways scrolling at 320px and 1280px", { skip }, async () => {
  const { base } = await withHelper();
  for (const width of [320, 1280]) {
    await page.viewport(width, 900);
    await page.goto(`${base}/gallery/`, { settle: 700 });
    const w = await page.evaluate("({ scroll: document.documentElement.scrollWidth, inner: innerWidth })");
    assert.ok(w.scroll <= w.inner, `/gallery/ at ${width}px is ${w.scroll}px wide`);
    assert.deepEqual(page.problems, [], `/gallery/ at ${width}px: ${page.problems.join(" | ")}`);
  }
});
