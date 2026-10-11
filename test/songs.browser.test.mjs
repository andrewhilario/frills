// Song requests in a real headless Chrome, with a pretend TikTok behind the helper: viewers type !sr in the LIVE chat and the queue fills,
// the streamer's !next moves it on, the practice mode and the editor's test buttons work with nobody live, and the page has nothing the
// security policy refuses. Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createHelper } from "../helper/server.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "songs", "index.html"))) throw new Error("dist/ has no songs page. Run `npm run build` first (`npm test` does that for you).");
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

const text = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim() ?? null`);
const click = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const titles = () => page.evaluate(`[...document.querySelectorAll(".song:not(.song--out) .song__title")].map((e) => e.textContent)`);

let counter = 0;
const say = (content, { name = "Ann", id = ++counter, mod = false, anchor = false, login = name.toLowerCase() } = {}) => ({
  common: { msgId: "m" + id },
  user: { id: "u" + name, displayId: login, nickname: name },
  content,
  userIdentity: { isModeratorOfAnchor: mod, isAnchor: anchor },
});

test("pages: the song pages load under the security policy with no console errors", { skip }, async () => {
  for (const path of ["/songs/", "/overlay/songs/?demo=1", "/overlays/"]) {
    const { base } = await withHelper();
    await page.goto(base + path, { settle: 900 });
    assert.deepEqual(page.problems, [], `${path}: ${page.problems.join(" | ")}`);
  }
});

test("overlay: !sr in the LIVE chat adds songs, other chat is ignored, and the streamer's !next moves the queue on", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/songs/?channel=pond_cafe&platform=tiktok`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("chat", say("hello everyone"));
  made[0].emit("chat", say("!sr blinding lights", { name: "Ann" }));
  made[0].emit("chat", say("!sr levitating", { name: "Ben" }));
  made[0].emit("chat", say("!sr espresso", { name: "Cat" }));
  await until(async () => (await text(".song--now .song__title")) !== null && (await titles()).length === 3);
  assert.deepEqual(await titles(), ["blinding lights", "levitating", "espresso"], "no catalog on this test server, so each shows as it was typed");
  assert.equal(await text(".song--now .song__label"), "Now playing");
  assert.match(await text(".song--now .song__by"), /asked by Ann/);
  made[0].emit("chat", say("!next", { name: "Viewer" }));
  await sleep(300);
  assert.equal((await titles()).length, 3, "a viewer cannot");
  made[0].emit("chat", say("!next", { name: "Pond_Cafe", login: "pond_cafe" }));
  await until(async () => (await titles()).length === 2);
  assert.deepEqual(await titles(), ["levitating", "espresso"]);
  assert.match(await text(".song--now .song__by"), /asked by Ben/);
  made[0].emit("chat", say("!skip", { name: "Mod", mod: true }));
  await until(async () => (await titles()).length === 1);
  assert.equal(await text(".song--now .song__title"), "espresso");
});

test("overlay: a new request animates only itself, the songs already there stay still", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/songs/?channel=pond_cafe&platform=tiktok`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("chat", say("!sr first song", { name: "Ann" }));
  made[0].emit("chat", say("!sr second song", { name: "Ben" }));
  await until(async () => (await titles()).length === 2);
  await sleep(900);
  made[0].emit("chat", say("!sr third song", { name: "Cat" }));
  await until(async () => (await titles()).length === 3);
  const moving = await page.evaluate(`[...document.querySelectorAll(".song")].slice(0, 2).map((e) => e.getAnimations().length)`);
  assert.deepEqual(moving, [0, 0]);
});

test("overlay: the settings in the link are used, the command word and how many are shown", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/songs/?channel=pond_cafe&platform=tiktok&command=play&max=2&cover=0&requester=0&titleText=Requests`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("chat", say("!sr ignored song", { name: "Ann" }));
  for (const [i, n] of ["one", "two", "three"].entries()) made[0].emit("chat", say(`!play ${n} song`, { name: "P" + i }));
  await until(async () => (await titles()).length === 2);
  assert.deepEqual(await titles(), ["one song", "two song"], "!sr is not the command now, and only 2 are shown");
  assert.equal(await text(".songs__title"), "Requests");
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector(".song__by")).display`), "none");
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector(".song__art")).display`), "none");
});

test("overlay: practice mode fills the queue by itself and moves on, with nobody live", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(`${base}/overlay/songs/?demo=1&pace=500`, { settle: 800 });
  await until(async () => (await titles()).length >= 3, 8000);
  assert.ok((await text(".song--now .song__title")).length > 2);
  assert.ok(await page.evaluate(`document.querySelector(".song--now .song__img")?.src.startsWith("data:image/svg+xml")`), "a practice song has its own cover");
  const first = await text(".song--now .song__title");
  await until(async () => (await text(".song--now .song__title")) !== first, 15000);
});

test("editor: the test buttons add requests and move on, and the link carries the settings", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/songs/", { settle: 800 });
  await click('[data-test="one"]');
  await until(async () => (await titles()).length === 1);
  await click('[data-test="three"]');
  await until(async () => (await titles()).length >= 3, 6000);
  const before = (await titles()).length;
  const first = await text(".song--now .song__title");
  await click('[data-test="next"]');
  await until(async () => (await titles()).length === before - 1);
  assert.notEqual(await text(".song--now .song__title"), first);
  await click('[data-test="clear"]');
  await until(async () => (await titles()).length === 0);
  await page.evaluate(`(() => { const i = document.getElementById("source-channel"); i.value = "pond.pal"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  const url = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(url.pathname, "/overlay/songs/");
  assert.equal(url.searchParams.get("channel"), "pond.pal");
});

test("editor: connected to a LIVE, chat commands fill the preview and the streamer's !next works", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(base + "/songs/?channel=pond_cafe", { settle: 800 });
  await until(() => made.length === 1);
  await sleep(200);
  made[0].emit("chat", say("!sr a real request", { name: "Ann" }));
  await until(async () => (await titles()).includes("a real request"));
  made[0].emit("chat", say("!next", { name: "Pond_Cafe", login: "pond_cafe" }));
  await until(async () => !(await titles()).includes("a real request"));
});

test("overlay: letter spacing from the link spaces the letters, and the default leaves them alone", { skip }, async () => {
  const { base } = await withHelper();
  const spacing = (selector) => page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).letterSpacing`);
  await page.goto(`${base}/overlay/songs/?demo=1&pace=400&letterSpacing=3.5`, { settle: 900 });
  await until(async () => (await titles()).length >= 1);
  assert.equal(await spacing(".song__title"), "3.5px");
  for (const path of ["/overlay/gifts/?demo=1&letterSpacing=2", "/overlay/goal/?demo=1&letterSpacing=2", "/overlay/likers/?demo=1&letterSpacing=2", "/overlay/alerts/?demo=1&letterSpacing=2"]) {
    await page.goto(base + path, { settle: 900 });
    const root = await page.evaluate("[...document.querySelectorAll('.giftlist, .goal, .likers, .alerts')].map((e) => getComputedStyle(e).letterSpacing)");
    assert.deepEqual(root, ["2px"], path);
  }
  await page.goto(`${base}/overlay/songs/?demo=1&pace=400`, { settle: 900 });
  await until(async () => (await titles()).length >= 1);
  assert.ok(["normal", "0px"].includes(await spacing(".song__title")), "the default leaves the font's own spacing");
  const { base: chatBase, made } = await withHelper();
  await page.goto(`${chatBase}/overlay/?channel=pond_cafe&platform=tiktok&letter=4`, { settle: 900 });
  await until(() => made.length === 1);
  await sleep(200);
  made[0].emit("chat", say("hello there"));
  await until(async () => (await page.evaluate("document.querySelectorAll('.m').length")) === 1);
  assert.equal(await page.evaluate("getComputedStyle(document.querySelector('.m')).letterSpacing"), "4px", "the chat overlay too");
});
