// Browser tests for Top Gifters (/gifters/, /overlay/gifters/) and Rotating Highlights (/labels/, /overlay/labels/)
// in headless Chrome: editors, live TikTok events via test helper, Twitch demo mode, Twitch follow bridge, platform switching,
// link serialization, and CSP clean check.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createHelper } from "../helper/server.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "gifters", "index.html"))) throw new Error("Run `npm run build` first.");
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
const follow = (id, name) => ({ common: { msgId: id }, user: person(name.toLowerCase(), name) });
const click = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const type = (selector, value) => page.evaluate(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const gifterRows = () => page.evaluate(`[...document.querySelectorAll(".liker:not(.liker--out)")].sort((a, b) => Number(a.dataset.rank) - Number(b.dataset.rank)).map((r) => r.dataset.rank + ":" + r.querySelector(".liker__name").textContent + ":" + r.querySelector(".liker__count").textContent)`);
const labelState = () => page.evaluate(`(() => { const c = document.querySelector(".labelcard:not(.labelcard--out)"); return c ? { slot: c.dataset.slot, label: c.querySelector(".labelcard__label")?.textContent, headline: c.querySelector(".labelcard__headline")?.textContent, detail: c.querySelector(".labelcard__detail")?.textContent, hidden: c.querySelector(".labelcard__detail")?.hidden } : null; })()`);

test("Top Gifters & Rotating Highlights pages load cleanly under CSP in both live and Twitch demo modes", { skip }, async () => {
  const { base } = await withHelper();
  for (const path of ["/gifters/", "/labels/", "/overlay/gifters/?demo=1&pace=500", "/overlay/gifters/?platform=twitch&demo=1&pace=500", "/overlay/labels/?demo=1&pace=500", "/overlay/labels/?platform=twitch&demo=1&pace=500"]) {
    await page.goto(base + path, { settle: 700 });
    assert.deepEqual(page.problems, [], `${path}: ${page.problems.join(" | ")}`);
  }
});

test("overlay: Top Gifters ranks live TikTok diamonds and reorders when someone overtakes", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/gifters/?channel=pond_cafe&platform=tiktok&max=3&celebrate=0`, { settle: 700 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("gift", gift("g1", "Ann", "Rose", 10, 2)); // 20
  made[0].emit("gift", gift("g2", "Ben", "Galaxy", 1000, 1)); // 1000
  await until(async () => (await gifterRows()).length === 2);
  assert.deepEqual(await gifterRows(), ["1:Ben:1,000 diamonds", "2:Ann:20 diamonds"]);
  made[0].emit("gift", gift("g3", "Ann", "Lion", 2000, 1)); // 2020
  await until(async () => (await gifterRows())[0] === "1:Ann:2,020 diamonds");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("editor: Top Gifters supports switching TikTok & Twitch, updates controls, tests, and copies Twitch link", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(`${base}/gifters/`, { settle: 700 });
  await click('[data-test="gift"]');
  await until(async () => (await gifterRows()).length === 1);
  assert.match((await gifterRows())[0], /diamonds?$/);

  await page.evaluate(`[...document.querySelectorAll("#source .chip")].find((b) => b.textContent.trim() === "Twitch")?.click()`);
  await click('[data-test="subgift"]');
  await until(async () => (await gifterRows()).some((r) => /sub/.test(r)));
  await page.evaluate(`[...document.querySelectorAll("#opt-controls .chip")].find((b) => b.textContent.trim() === "Bit senders")?.click()`);
  await click('[data-test="bits"]');
  await until(async () => (await gifterRows()).some((r) => /bits?$/.test(r)));

  await type("#source-channel", "pondpal");
  await page.evaluate(`(() => { const s = document.getElementById("c-layout"); s.value = "neon"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  assert.equal(await page.evaluate(`document.querySelector(".likers").dataset.layout`), "neon");
  const url = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(url.pathname, "/overlay/gifters/");
  assert.equal(url.searchParams.get("platform"), "twitch");
  assert.equal(url.searchParams.get("channel"), "pondpal");
  assert.equal(url.searchParams.get("twitchMode"), "bits");
  assert.equal(url.searchParams.get("layout"), "neon");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("overlay & editor: Rotating Highlights receives live TikTok gifts/follows, rotates cards, and includes Twitch Follow box", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/labels/?channel=pond_cafe&platform=tiktok&rotateSec=3`, { settle: 700 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("gift", gift("g1", "Maya", "Galaxy", 1000, 1));
  await until(async () => (await labelState())?.slot === "lastGift");
  assert.equal((await labelState()).headline, "Maya · Galaxy");
  made[0].emit("follow", follow("f1", "NewFriend"));
  await until(async () => (await labelState())?.slot === "lastFollower");
  assert.equal((await labelState()).headline, "NewFriend");
  // Wait for auto-rotation
  await until(async () => (await labelState())?.slot !== "lastFollower", 5000);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));

  // Editor Twitch mode shows Follow box and generates Twitch link with design + animation choices
  await page.goto(`${base}/labels/`, { settle: 700 });
  await page.evaluate(`[...document.querySelectorAll("#source .chip")].find((b) => b.textContent.trim() === "Twitch")?.click()`);
  assert.equal(await page.evaluate(`document.querySelector(".followbox").hidden`), false);
  await page.evaluate(`(() => { const s = document.getElementById("c-layout"); s.value = "macos"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  assert.equal(await page.evaluate(`document.querySelector(".labels").dataset.layout`), "macos");
  await page.evaluate(`[...document.querySelectorAll("#opt-controls .chip")].find((b) => b.textContent.trim() === "3D Flip")?.click()`);
  await page.evaluate(`[...document.querySelectorAll("#opt-controls .chip")].find((b) => b.textContent.trim() === "Spotlight glow")?.click()`);
  assert.equal(await page.evaluate(`document.querySelector(".labels").dataset.enter`), "flip");
  assert.equal(await page.evaluate(`document.querySelector(".labels").dataset.anim`), "pulse");
  await type("#source-channel", "pondpal");
  await click('[data-test="bits"]');
  await until(async () => (await labelState())?.slot === "lastBits");
  await click('[data-test="subgift"]');
  await until(async () => (await labelState())?.slot === "topSubGifter");
  assert.equal(await page.evaluate(`Boolean(document.querySelector(".labelcard:not(.labelcard--out)[data-top='true'] .labelcard__crown"))`), true, "top highlight wears animated gold crown");
  assert.equal(await page.evaluate(`Boolean(document.querySelector(".labelcard:not(.labelcard--out) .labelcard__sheen"))`), true, "card has TikOps-style glossy sheen");
  const url = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(url.pathname, "/overlay/labels/");
  assert.equal(url.searchParams.get("platform"), "twitch");
  assert.equal(url.searchParams.get("layout"), "macos");
  assert.equal(url.searchParams.get("enter"), "flip");
  assert.equal(url.searchParams.get("anim"), "pulse");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("overlay: Rotating Highlights shows the top liker from live TikTok likes, in its own slide, and the rotation keeps going while likes arrive", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/labels/?channel=pond_cafe&platform=tiktok&rotateSec=3&showGift=0&showTopGifter=0`, { settle: 700 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("follow", follow("f1", "NewFriend"));
  await until(async () => (await labelState())?.slot === "lastFollower");
  const like = (id, name, count) => ({ common: { msgId: id }, user: person(name.toLowerCase(), name), likeCount: count });
  made[0].emit("like", like("l1", "Ann", 5));
  made[0].emit("like", like("l2", "Ben", 20));
  // a like arrives every half second, as on a busy LIVE, and the slides still change by themselves
  let n = 0;
  const busy = setInterval(() => made[0].emit("like", like("b" + ++n, "Cat", 1)), 500);
  try {
    await until(async () => (await labelState())?.slot === "topLiker", 6000);
    const card = await labelState();
    assert.equal(card.label, "Top liker");
    assert.equal(card.headline, "Ben", "20 likes beats 5, and Cat's single taps are still adding up");
    await until(async () => (await labelState())?.slot === "lastFollower", 6000); // and it came round again
  } finally {
    clearInterval(busy);
  }
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("editor: Rotating Highlights has the top liker switch, label and test button for TikTok, and the test button makes the slide", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(`${base}/labels/`, { settle: 500 });
  await page.evaluate("localStorage.clear()");
  await page.goto(`${base}/labels/`, { settle: 900 });
  const labels = await page.evaluate(`[...document.querySelectorAll(".panel .ctl__label")].map((l) => l.textContent.trim())`);
  for (const wanted of ["Include top gifter", "Show top gifter’s animated gift", "Include top streak", "Include top liker", "Top liker label"]) assert.ok(labels.includes(wanted), `${wanted} is missing`);
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-test="likes"]')).display !== "none"`), true, "the test button is there on TikTok");
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-test="streak"]')).display !== "none"`), true, "Test streak button is visible on TikTok");

  // Demo seed puts Top Gifter with animated gift showcase AND Test streak shows Top Streak with fiery ×N combo badge
  await click('[data-test="streak"]');
  await until(async () => (await labelState())?.slot === "topStreak", 3000);
  assert.equal(await page.evaluate(`document.querySelector(".labelcard:not(.labelcard--out)").dataset.streak`), "true");
  assert.equal(await page.evaluate(`Boolean(document.querySelector(".labelcard:not(.labelcard--out) .labelcard__streakpill"))`), true, "top streak displays animated ×N combo pill");
  assert.equal(await page.evaluate(`Boolean(document.querySelector(".labelcard:not(.labelcard--out) .labelcard__giftpic"))`), true, "top streak displays animated gift icon");

  await click('[data-test="clear"]');
  await click('[data-test="likes"]');
  await click('[data-test="next"]');
  await until(async () => (await labelState())?.slot === "topLiker", 3000);
  assert.equal((await labelState()).label, "Top liker");
  await type("#c-labelTopLiker", "Heart king");
  await until(async () => (await labelState())?.label === "Heart king", 3000);
  await page.evaluate("localStorage.clear()");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("overlay: Top Gifter shows animated gift badge (Hand Hearts / Super GG) and Top Streak tracks multi-send combos live", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/labels/?channel=pond_cafe&platform=tiktok&rotateSec=3&showGift=0&showFollow=0&showTopLiker=0`, { settle: 700 });
  await until(() => made.length === 1);
  await sleep(150);

  // Send Hand Hearts (100 diamonds) -> Top Gifter showcases animated Hand Hearts gift medallion
  made[0].emit("gift", gift("tg1", "Maya", "Hand Hearts", 100, 1));
  await until(async () => (await labelState())?.slot === "topGifter");
  assert.equal(await page.evaluate(`document.querySelector(".labelcard:not(.labelcard--out) .labelcard__gifttag")?.textContent?.trim()`), "Hand Hearts");
  assert.equal(await page.evaluate(`Boolean(document.querySelector(".labelcard:not(.labelcard--out) .labelcard__giftshow:not([hidden]) .labelcard__giftpic"))`), true);

  // Multi-send Rose x18 streak -> Top Streak lights up with ×18 badge
  made[0].emit("gift", gift("ts1", "Kai", "Rose", 1, 18));
  await until(async () => (await labelState())?.slot === "topStreak");
  assert.equal((await labelState()).headline, "Kai");
  assert.equal((await labelState()).detail, "18× Rose");
  assert.equal(await page.evaluate(`document.querySelector(".labelcard:not(.labelcard--out) .labelcard__streakpill")?.textContent?.trim()`), "×18");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});
