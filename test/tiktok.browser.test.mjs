// TikTok in a real headless Chrome: the editor, the matcha page and the overlay talking to the helper (with a pretend TikTok behind it),
// and what they say when there is no helper. Skipped on a computer with no Chrome or Edge. `npm test` builds first.

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
if (!existsSync(join(dist, "index.html"))) throw new Error("dist/ is empty. Run `npm run build` first (`npm test` does that for you).");

let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

class FakeConnection extends EventEmitter {
  constructor(script = {}) { super(); this.script = script; this.gone = false; }
  async connect() { await sleep(5); if (this.script.failWith) throw this.script.failWith; }
  disconnect() { if (!this.gone) { this.gone = true; this.emit("disconnected"); } }
}

const opened = [];
/** A helper with a pretend TikTok behind it. `scripts` say how each connection to "TikTok" goes; `tuning` changes its waits. */
async function withHelper(scripts = [], tuning = {}) {
  const made = [];
  const helper = createHelper({ distDir: dist, factory: async (user) => { const conn = new FakeConnection(scripts.shift() ?? {}); made.push({ user, conn }); return conn; }, idleStopMs: 200, offlineWaitMs: 5000, ...tuning });
  const port = await helper.listen(0);
  opened.push(helper);
  return { base: `http://127.0.0.1:${port}`, made, helper };
}
const until = async (test, ms = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (test()) return;
    await sleep(20);
  }
  throw new Error("Timed out waiting for the helper");
};

let page;
let plain; // the site with no helper behind it, like the hosted one
let plainBase;
before(async () => {
  if (skip) return;
  plain = http.createServer(createStatic(dist));
  await new Promise((resolve) => plain.listen(0, "127.0.0.1", resolve));
  plainBase = `http://127.0.0.1:${plain.address().port}`;
  page = await launch();
  await page.viewport(1280, 900);
});
after(async () => {
  await page?.close();
  for (const h of opened) await h.close();
  plain?.closeAllConnections?.();
  plain?.close();
});

const click = (selector, text) => page.evaluate(`(() => { const list = [...document.querySelectorAll(${JSON.stringify(selector)})]; const el = ${text ? `list.find((e) => e.textContent.trim() === ${JSON.stringify(text)})` : "list[0]"}; if (!el) throw new Error("nothing to click: ${selector}"); el.click(); })()`);
const type = (selector, value) => page.evaluate(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const text = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim() ?? null`);
const chat = (id, content, over = {}) => ({ common: { msgId: id }, user: { id: "42", displayId: "pond.pal", nickname: "Pond Pal" }, content, userIdentity: {}, ...over });

test("editor: TikTok comes first, and with the helper running a name connects and real chat appears in the preview and in the link", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(base + "/editor/", { settle: 700 });
  assert.equal(await page.evaluate(`document.querySelector("#source .chip[aria-pressed=true]").textContent.trim()`), "TikTok");
  assert.equal(await text("#source label"), "Your TikTok @name");
  assert.equal(await page.evaluate(`document.querySelector(".source__helper").hidden`), true, "the helper is there, so no warning");

  await type("#source-channel", "  @Pond.Pal ");
  await click("#source .source__row .btn");
  await page.waitFor(`document.getElementById("source-status").dataset.state === "connected"`);
  assert.equal(await text("#source-status"), "Reading @pond.pal's LIVE chat");
  assert.equal(made[0].user, "pond.pal");

  made[0].conn.emit("chat", chat("m1", "hello from the pond"));
  made[0].conn.emit("chat", chat("m2", "a moderator speaks", { userIdentity: { isModeratorOfAnchor: true } }));
  made[0].conn.emit("gift", { common: { msgId: "g1" }, user: { id: "7", displayId: "ann", nickname: "Ann" }, gift: { name: "Rose", type: 2 }, repeatCount: 3, repeatEnd: 0 });
  await page.waitFor(`document.querySelectorAll("#chat .m").length === 3`);
  const shown = await page.evaluate(`[...document.querySelectorAll("#chat .m")].map((m) => ({ who: m.querySelector(".name").textContent, said: m.querySelector(".txt").textContent, mod: Boolean(m.querySelector(".ico")), gift: m.classList.contains("gift") }))`);
  assert.deepEqual(shown, [
    { who: "Pond Pal", said: "hello from the pond", mod: false, gift: false },
    { who: "Pond Pal", said: "a moderator speaks", mod: true, gift: false },
    { who: "Ann", said: "sent Rose ×3", mod: false, gift: true },
  ]);

  const link = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(link.origin + link.pathname, `${base}/overlay/`);
  assert.equal(link.searchParams.get("channel"), "pond.pal");
  assert.equal(link.searchParams.get("platform"), "tiktok");
  assert.match(await text("#link-hint"), /only works while the Frills helper is running/);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));

  await click("#source .source__row .btn"); // Disconnect
  await page.waitFor(`document.querySelector("#source .source__row .btn").textContent === "Connect"`);
  await sleep(400);
  assert.equal(made[0].conn.gone, true, "disconnecting lets go of TikTok once nobody is watching");
});

test("editor: the choice of platform changes the label and the link, and is remembered", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/editor/", { settle: 600 });
  await page.evaluate("localStorage.clear()");
  await page.goto(base + "/editor/", { settle: 600 });
  await type("#source-channel", "pondpal");
  await click("#source .chip", "Twitch");
  assert.equal(await text("#source label"), "Your Twitch channel");
  assert.equal(await page.evaluate(`document.getElementById("source-channel").value`), "", "each platform keeps its own name");
  await type("#source-channel", "pond_pal");
  let link = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(link.search, "?channel=pond_pal", "a Twitch link has no platform part");
  await click("#source .chip", "TikTok");
  assert.equal(await page.evaluate(`document.getElementById("source-channel").value`), "pondpal");
  link = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(link.search, "?channel=pondpal&platform=tiktok");
  await page.goto(base + "/editor/", { settle: 600 });
  assert.equal(await page.evaluate(`document.querySelector("#source .chip[aria-pressed=true]").textContent.trim()`), "TikTok", "remembered");
  assert.equal(await page.evaluate(`document.getElementById("source-channel").value`), "pondpal");
  await page.evaluate("localStorage.clear()");
});

test("editor: the built-in frills_demo account fills the preview and says it is practice chat", { skip }, async () => {
  const { base, made } = await withHelper([], { demoPace: [30, 60] });
  await page.goto(base + "/editor/", { settle: 600 });
  await type("#source-channel", "frills_demo");
  await click("#source .source__row .btn");
  await page.waitFor(`document.getElementById("source-status").dataset.state === "connected"`);
  assert.match(await text("#source-status"), /Practice chat made up by Frills/);
  await page.waitFor(`document.querySelectorAll("#chat .m").length >= 3`, { timeout: 6000 });
  await page.waitFor(`document.querySelectorAll("#chat .av.has-img").length >= 2`, { timeout: 4000 });
  assert.equal(await page.evaluate(`[...document.querySelectorAll("#chat .av img")].every((i) => i.naturalWidth > 0)`), true, "the pictures really loaded");
  assert.equal(made.length, 0, "no connection to TikTok was made");
  const link = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(link.searchParams.get("channel"), "frills_demo");
  assert.equal(link.searchParams.get("platform"), "tiktok");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
  await click("#source .source__row .btn"); // Disconnect
});

test("editor: a TikTok name that isn't one is refused before anything is sent", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(base + "/editor/", { settle: 600 });
  await type("#source-channel", "not a name!");
  await click("#source .source__row .btn");
  await sleep(150);
  assert.equal(await text("#source-status"), "TikTok names are letters, numbers, _ and . only.");
  assert.equal(await page.evaluate(`document.getElementById("source-channel").getAttribute("aria-invalid")`), "true");
  assert.equal(made.length, 0);
});

test("editor: an account that isn't live yet says so, and starts working when it goes live", { skip }, async () => {
  class UserOfflineError extends Error {}
  const { base, made } = await withHelper([{ failWith: new UserOfflineError("not live") }], { offlineWaitMs: 1200 });
  await page.goto(base + "/editor/", { settle: 600 });
  await type("#source-channel", "pond.pal");
  await click("#source .source__row .btn");
  await page.waitFor(`document.getElementById("source-status").dataset.state === "offline"`);
  assert.match(await text("#source-status"), /@pond\.pal isn't live right now/);
  assert.equal(await text("#source .source__row .btn"), "Disconnect", "still watching, so it can be stopped");
  // The helper looks again by itself, and the chat starts the moment the LIVE does.
  await page.waitFor(`document.getElementById("source-status").dataset.state === "connected"`, { timeout: 6000 });
  made[1].conn.emit("chat", chat("l1", "we are live"));
  await page.waitFor(`[...document.querySelectorAll("#chat .txt")].some((t) => t.textContent === "we are live")`);
});

test("editor: with no helper behind the site, TikTok says what is missing and doesn't pretend", { skip }, async () => {
  await page.goto(plainBase + "/editor/", { settle: 700 });
  await page.waitFor(`!document.querySelector(".source__helper").hidden`);
  assert.match(await text(".source__helper"), /comes through the free Frills helper/);
  assert.equal(await page.evaluate(`document.querySelector(".source__helper a").getAttribute("href")`), "/guides/tiktok/", "and says where to read how");
  await type("#source-channel", "pond.pal");
  await click("#source .source__row .btn");
  await page.waitFor(`document.getElementById("source-status").dataset.state === "error"`);
  assert.match(await text("#source-status"), /needs the Frills helper running on this PC/);
  assert.equal(await text("#source .source__row .btn"), "Connect", "it never claims to be connected");
  assert.ok((await page.evaluate(`document.querySelectorAll("#chat .m").length`)) >= 1, "practice chat keeps going");
  await click("#source .chip", "Twitch");
  assert.equal(await page.evaluate(`document.querySelector(".source__helper").hidden`), true, "Twitch needs no helper");
});

test("overlay: ?platform=tiktok shows TikTok chat, and the status note goes away once it is connected", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(base + "/overlay/?platform=tiktok&channel=pond.pal&look=mint", { settle: 300 });
  await until(() => made.length === 1);
  await page.waitFor(`document.getElementById("note").hidden`); // "Connecting…" was showing; connected hides it
  made[0].conn.emit("chat", chat("o1", "hello obs", { userIdentity: { isModeratorOfAnchor: true } }));
  await page.waitFor(`document.querySelectorAll("#chat .m").length === 1`);
  assert.equal(await page.evaluate(`document.querySelector("#chat .txt").textContent`), "hello obs");
  assert.equal(await page.evaluate(`Boolean(document.querySelector("#chat .ico"))`), true);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("overlay: waiting for a LIVE shows a note on the page, and the overlay with no helper says so instead of staying blank", { skip }, async () => {
  class UserOfflineError extends Error {}
  const { base } = await withHelper([{ failWith: new UserOfflineError("not live") }]);
  await page.goto(base + "/overlay/?platform=tiktok&channel=pond.pal", { settle: 600 });
  await page.waitFor(`/isn't live right now/.test(document.getElementById("note").textContent)`);
  assert.equal(await page.evaluate(`document.getElementById("note").hidden`), false);

  await page.goto(plainBase + "/overlay/?platform=tiktok&channel=pond.pal", { settle: 900 });
  await page.waitFor(`/Frills helper/.test(document.getElementById("note").textContent)`);
  assert.equal(await page.evaluate(`document.getElementById("note").hidden`), false);
});

test("overlay: Twitch links still work exactly as before (no platform part, no helper involved)", { skip }, async () => {
  await page.goto(plainBase + "/overlay/?demo=1&channel=pond_pal", { settle: 600 });
  await page.waitFor(`document.querySelectorAll("#chat .m").length >= 1`);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("relay: with no helper but a relay behind the page, TikTok works, says it is the relay, and waits in line when it is full", { skip }, async () => {
  const made = [];
  const relay = createHelper({ distDir: dist, relay: { origins: [], slots: 1, maxPerIp: 20, trustProxy: false }, factory: async (user) => { const conn = new FakeConnection(); made.push({ user, conn }); return conn; }, idleStopMs: 150, queueGraceMs: 150 });
  const port = await relay.listen(0);
  opened.push(relay);
  const base = `http://127.0.0.1:${port}`;
  // Somebody else is already using the only spot.
  const taker = http.get({ host: "127.0.0.1", port, path: "/tiktok/stream?user=someone.else" });
  await until(() => made.length === 1);

  await page.goto(base + "/editor/", { settle: 700 });
  assert.equal(await page.evaluate(`document.querySelector(".source__relay").hidden`), false, "the relay note shows");
  assert.match(await text(".source__relay"), /free Frills relay \(beta\)/);
  assert.equal(await page.evaluate(`document.querySelector(".source__helper").hidden`), true, "and the helper warning does not");
  await type("#source-channel", "pond.pal");
  await click("#source .source__row .btn");
  await page.waitFor(`document.getElementById("source-status").dataset.state === "queued"`);
  assert.equal(await text("#source-status"), "The free relay is full. Waiting for a spot: 1 of 1…");
  assert.equal(made.length, 1, "nothing is connected to TikTok for someone who is waiting");

  taker.destroy(); // the other person finishes
  await page.waitFor(`document.getElementById("source-status").dataset.state === "connected"`, { timeout: 6000 });
  assert.equal(made.length, 2);
  made[1].conn.emit("chat", chat("r1", "from the relay"));
  await page.waitFor(`[...document.querySelectorAll("#chat .txt")].some((t) => t.textContent === "from the relay")`);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
  await click("#source .source__row .btn"); // Disconnect
});

test("matcha page: TikTok first too, and its link carries the platform", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(base + "/matcha/", { settle: 800 });
  assert.equal(await page.evaluate(`document.querySelector("#source .chip[aria-pressed=true]").textContent.trim()`), "TikTok");
  await type("#source-channel", "pond.pal");
  await click("#source .source__row .btn");
  await page.waitFor(`document.getElementById("source-status").dataset.state === "connected"`);
  made[0].conn.emit("chat", chat("t1", "matcha time"));
  await page.waitFor(`document.querySelectorAll(".matcha-card .m").length >= 6`); // the same message in every one of the six styles
  const link = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(link.origin + link.pathname, `${base}/overlay/`);
  assert.equal(link.searchParams.get("platform"), "tiktok");
  assert.equal(link.searchParams.get("style"), "latte");
  assert.match(await text("#link-hint"), /only works on this PC/);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});
