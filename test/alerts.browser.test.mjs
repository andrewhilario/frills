// The alerts in a real headless Chrome: the editor (every test button, the options, the link, the "what Frills sees" counters) and the
// overlay (a pretend TikTok behind the helper sends follows, gifts and shares; they appear, wait their turn, join into a crowd, and make
// their sound). Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createStatic } from "../scripts/lib/static.mjs";
import { createHelper } from "../helper/server.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "alerts", "index.html"))) throw new Error("dist/ has no alerts page. Run `npm run build` first (`npm test` does that for you).");

let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

class FakeConnection extends EventEmitter {
  async connect() { await sleep(5); }
  disconnect() { this.emit("disconnected"); }
}
const opened = [];
async function withHelper() {
  const made = [];
  const helper = createHelper({ distDir: dist, factory: async () => { const conn = new FakeConnection(); made.push(conn); return conn; }, idleStopMs: 200, offlineWaitMs: 5000 });
  const port = await helper.listen(0);
  opened.push(helper);
  return { base: `http://127.0.0.1:${port}`, made };
}
const until = async (test, ms = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await test()) return; await sleep(30); }
  throw new Error("Timed out");
};

let page;
before(async () => {
  if (skip) return;
  page = await launch();
  await page.viewport(1280, 900);
});
after(async () => {
  await page?.close();
  for (const h of opened) await h.close();
});

const person = (id, name) => ({ id, displayId: name.toLowerCase().replace(/\W/g, "_"), nickname: name });
const follow = (id, name) => ({ common: { msgId: id }, user: person(id, name) });
const gift = (id, name, giftName, diamondCount, count = 1) => ({ common: { msgId: id }, user: person(id, name), gift: { name: giftName, type: 2, diamondCount }, repeatCount: count });
const cards = () => page.evaluate(`[...document.querySelectorAll(".alert")].map((a) => ({ kind: a.dataset.kind, tier: a.dataset.tier, out: a.classList.contains("alert--out"), text: a.querySelector(".alert__words").textContent }))`);
const liveCards = async () => (await cards()).filter((c) => !c.out);
const click = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const type = (selector, value) => page.evaluate(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
/** Counts what the page asks its (pretend) audio system to play, so sound is tested without hearing it. */
const spyOnAudio = () => page.send("Page.addScriptToEvaluateOnNewDocument", { source: `
  window.__notes = [];
  window.AudioContext = class { constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
    resume() { return Promise.resolve(); } createGain() { return { gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    createOscillator() { const o = { frequency: { setValueAtTime(f) { window.__notes.push(Math.round(f)); }, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; return o; } };` });

test("the alerts pages load under the security policy with no console errors", { skip }, async () => {
  for (const path of ["/alerts/", "/overlay/alerts/?demo=1"]) {
    const { base } = await withHelper();
    await page.goto(base + path, { settle: 700 });
    assert.deepEqual(page.problems, [], `${path}: ${page.problems.join(" | ")}`);
  }
});

test("editor: each test button shows its alert, a big gift is bigger, and a crowd joins into one", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/alerts/", { settle: 700 });
  await click('[data-test="follow"]');
  await until(async () => (await liveCards()).some((c) => c.kind === "follow"));
  assert.match((await liveCards())[0].text, /just followed!$/);
  await click('[data-test="share"]');
  await click('[data-test="gift-3"]');
  await until(async () => (await liveCards()).some((c) => c.kind === "gift"));
  const big = (await liveCards()).find((c) => c.kind === "gift");
  assert.equal(big.tier, "3", "a big gift is the biggest size");
  assert.match(big.text, /!!$/, "and uses the big-gift wording");
  // a crowd: with room for two on screen, six follows wait and the waiting ones join
  await click('[data-test="crowd"]');
  await sleep(300);
  const state = await page.evaluate(`document.querySelectorAll(".alert").length`);
  assert.ok(state <= 3, "no pile-up of cards: only what fits is on screen (" + state + ")");
});

test("editor: changing the words, the look and the position changes the alert and the link", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/alerts/", { settle: 700 });
  await type("#c-followText", "Welcome {name}, you are brilliant!");
  await click('[data-test="follow"]');
  await until(async () => (await liveCards()).some((c) => c.kind === "follow"));
  assert.match((await liveCards())[0].text, /^Welcome .+, you are brilliant!$/);
  await click('#looks .chip:nth-child(3)'); // Night
  assert.equal(await page.evaluate(`document.getElementById("alerts").style.getPropertyValue("--a-accent")`), "#9db4ff");
  assert.equal(await page.evaluate(`document.getElementById("alerts").style.getPropertyValue("--a-font")`).then((f) => f.includes("Plus Jakarta Sans")), true);
  await page.evaluate(`[...document.querySelectorAll("#move-controls .chip")].find((b) => b.textContent.trim() === "Bottom").click()`);
  assert.equal(await page.evaluate(`document.getElementById("alerts").dataset.vpos`), "bottom");
  // the link appears with a name, carrying only what was changed
  await type("#source-channel", "pond.pal");
  const link = await page.evaluate(`document.getElementById("link").value`);
  const url = new URL(link);
  assert.equal(url.pathname, "/overlay/alerts/");
  assert.equal(url.searchParams.get("channel"), "pond.pal");
  assert.equal(url.searchParams.get("platform"), "tiktok");
  assert.equal(url.searchParams.get("vpos"), "bottom");
  assert.equal(url.searchParams.get("accent"), "#9db4ff");
  assert.ok(url.searchParams.get("followText").startsWith("Welcome"));
  assert.ok(!url.searchParams.has("giftText"), "unchanged settings are not in the link");
  assert.equal(await page.evaluate(`document.getElementById("copy-link").disabled`), false);
});

test("overlay: follows, gifts and shares from a TikTok LIVE appear, a gift is sized, and sound plays for each", { skip }, async () => {
  await spyOnAudio();
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/alerts/?channel=pond_cafe&platform=tiktok&maxShown=3&followSound=pop&giftSound=pop&shareSound=pop&volume=80&followTime=3`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("follow", follow("f1", "Mochi Bun"));
  made[0].emit("share", follow("s1", "Croaker"));
  made[0].emit("gift", gift("g1", "Little Lily", "Galaxy", 1500));
  await until(async () => (await liveCards()).length === 3);
  const shown = await liveCards();
  assert.deepEqual(shown.map((c) => c.kind).sort(), ["follow", "gift", "share"]);
  assert.match(shown.find((c) => c.kind === "follow").text, /^Mochi Bun just followed!$/);
  assert.match(shown.find((c) => c.kind === "share").text, /^Croaker shared the LIVE!$/);
  const g = shown.find((c) => c.kind === "gift");
  assert.equal(g.tier, "3");
  assert.match(g.text, /^Little Lily sent Galaxy ×1!!$/);
  // pop is one note, played once for each of a follow (tier 1), a share (tier 1) and a tier 3 gift (3 layers)
  const notes = await page.evaluate(`window.__notes.length`);
  assert.equal(notes, 1 + 1 + 3, "one note each for the follow and the share, three for the big gift");
  // and they leave by themselves, the follow first
  await until(async () => !(await liveCards()).some((c) => c.kind === "follow"), 6000);
});

test("overlay: a kind that is switched off, and a gift smaller than the smallest wanted, never show", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/alerts/?channel=pond_cafe&platform=tiktok&shareOn=0&giftMin=50`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("share", follow("s1", "Croaker"));
  made[0].emit("gift", gift("g1", "Little Lily", "Rose", 1));
  made[0].emit("gift", gift("g2", "Kero Chan", "Panda", 100));
  made[0].emit("follow", follow("f1", "Mochi Bun"));
  await until(async () => (await liveCards()).length >= 2);
  await sleep(300);
  assert.deepEqual((await liveCards()).map((c) => c.kind).sort(), ["follow", "gift"], "no share, no Rose");
  assert.match((await liveCards()).find((c) => c.kind === "gift").text, /Panda/);
});

test("overlay: with one place on screen, the rest wait their turn and the people who follow in a crowd are joined", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/alerts/?channel=pond_cafe&platform=tiktok&maxShown=1&followTime=2&speed=250`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  for (const [i, name] of ["Ann", "Ben", "Cat", "Dan", "Eve"].entries()) made[0].emit("follow", follow("f" + i, name));
  await until(async () => (await liveCards()).length === 1);
  assert.match((await liveCards())[0].text, /^Ann just followed!$/);
  await until(async () => (await liveCards()).some((c) => /others followed/.test(c.text)), 8000);
  assert.match((await liveCards())[0].text, /^Ben and 3 others followed!$/, "Ben, Cat, Dan and Eve were joined into one");
});

test("editor: the counters show what arrived from a connected account, and an older relay is called out", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(base + "/alerts/", { settle: 700 });
  await type("#source-channel", "pond_cafe");
  await page.evaluate(`[...document.querySelectorAll("#source button")].find((b) => b.textContent.trim() === "Connect").click()`);
  await until(() => made.length === 1);
  await sleep(200);
  made[0].emit("follow", follow("f1", "Mochi Bun"));
  made[0].emit("follow", follow("f2", "Croaker"));
  made[0].emit("gift", gift("g1", "Little Lily", "Rose", 1));
  await until(async () => (await page.evaluate(`document.getElementById("seen-follow").textContent`)) === "2");
  assert.equal(await page.evaluate(`document.getElementById("seen-gift").textContent`), "1");
  assert.equal(await page.evaluate(`document.getElementById("seen-share").textContent`), "0");
  assert.match(await page.evaluate(`document.getElementById("seen-note").textContent`), /can send alerts/);

  // an old relay: same address, but its ping says chat only and its stream sends no alerts
  const old = http.createServer((req, res) => {
    if (req.url.startsWith("/tiktok/ping")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, name: "frills-helper", version: "0.1.0" })); return; }
    createStatic(dist)(req, res);
  });
  await new Promise((resolve) => old.listen(0, "127.0.0.1", resolve));
  try {
    await page.goto(`http://127.0.0.1:${old.address().port}/alerts/`, { settle: 800 });
    assert.match(await page.evaluate(`document.getElementById("seen-note").textContent`), /older version that can only send chat/);
  } finally {
    old.closeAllConnections?.();
    old.close();
  }
});

test("overlay: an old relay that cannot send alerts is called out on the page, and demo mode shows practice alerts", { skip }, async () => {
  const old = http.createServer((req, res) => {
    if (req.url.startsWith("/tiktok/ping")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, name: "frills-helper", version: "0.1.0" })); return; }
    createStatic(dist)(req, res);
  });
  await new Promise((resolve) => old.listen(0, "127.0.0.1", resolve));
  try {
    await page.goto(`http://127.0.0.1:${old.address().port}/overlay/alerts/?channel=pond_cafe&platform=tiktok`, { settle: 900 });
    await until(async () => /needs an update/.test((await page.evaluate(`document.getElementById("note").textContent`)) ?? ""));
  } finally {
    old.closeAllConnections?.();
    old.close();
  }
  const { base } = await withHelper();
  await page.goto(`${base}/overlay/alerts/?demo=1`, { settle: 600 });
  await until(async () => (await cards()).length > 0, 6000);
});
