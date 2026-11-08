// The commands overlay and its editor in a real headless Chrome, with a pretend TikTok behind the helper: a chat command shows its card
// with the streamer's own words, the cooldown (and Off) work, a damaged link says so and shows no sample gear, and the editor explains a
// trigger that could never pop up and carries Off and an empty list into the link. Skipped on a computer with no Chrome or Edge.
// `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createHelper } from "../helper/server.mjs";
import { defaultActionsConfig, encodeCommands, readCommands } from "../src/js/actions.js";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "actions", "index.html"))) throw new Error("dist/ has no actions page. Run `npm run build` first (`npm test` does that for you).");
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
const say = (made, id, content) => made[0].emit("chat", { common: { msgId: id }, user: person(id, "Ann"), content });
const type = (selector, value) => page.evaluate(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const typeAt = (selector, index, value) => page.evaluate(`(() => { const i = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); return i.value; })()`);
const text = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim() ?? null`);
const card = () => page.evaluate(`(() => { const c = document.querySelector(".action-popup"); return c ? { title: c.querySelector(".action-title").textContent, text: c.querySelector(".action-text").textContent } : null; })()`);
const mark = () => page.evaluate(`document.querySelector(".action-popup").dataset.first = "1"`);
const marked = () => page.evaluate(`document.querySelector(".action-popup")?.dataset.first === "1"`);

const mine = (extra = {}) => ({
  ...defaultActionsConfig(),
  commands: [
    { trigger: "keys", title: "Keyboard", text: "Wooting 60HE", icon: "⌨️" },
    { trigger: "mouse", title: "Mouse", text: "Razer Viper V3 Pro", icon: "🖱️" },
  ],
  ...extra,
});
const overlayUrl = (base, config) => `${base}/overlay/actions/?c=${encodeURIComponent(encodeCommands(config))}&channel=pond_cafe&platform=tiktok`;
const linkC = async () => new URL(await page.evaluate(`document.getElementById("link").value`)).searchParams.get("c");

test("both pages load under the security policy with no console errors", { skip }, async () => {
  const { base } = await withHelper();
  for (const path of ["/actions/", "/overlay/actions/"]) {
    await page.goto(base + path, { settle: 700 });
    assert.deepEqual(page.problems, [], `${path}: ${page.problems.join(" | ")}`);
  }
});

test("overlay: a chat command shows its card with the streamer's own words, and other chat does nothing", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(overlayUrl(base, mine()), { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  say(made, "a1", "hello chat");
  await sleep(400);
  assert.equal(await card(), null, "chat that is not a command shows nothing");
  say(made, "a2", ".mouse what mouse is that?");
  await until(async () => (await card()) !== null);
  assert.deepEqual(await card(), { title: "Mouse", text: "Razer Viper V3 Pro" }, "the streamer's words, not the sample gear");
});

test("overlay: the cooldown keeps a repeat out, and Off lets it through at once", { skip }, async () => {
  // a 30 s cooldown: the second .mouse is ignored, so the first card is still the one on screen
  let { base, made } = await withHelper();
  await page.goto(overlayUrl(base, mine({ cooldown: 30 })), { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  say(made, "b1", ".mouse");
  await until(async () => (await card()) !== null);
  await mark();
  say(made, "b2", ".mouse");
  await sleep(500);
  assert.equal(await marked(), true, "the repeat was held back by the cooldown");

  // Off (0): the repeat shows a new card straight away. This is the one that used to turn into the 10 s default.
  ({ base, made } = await withHelper());
  await page.goto(overlayUrl(base, mine({ cooldown: 0 })), { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  say(made, "c1", ".mouse");
  await until(async () => (await card()) !== null);
  await mark();
  say(made, "c2", ".mouse");
  await until(async () => (await marked()) === false, 3000);
  assert.notEqual(await card(), null, "a new card is showing");
});

test("overlay: a damaged link says so and shows no sample gear, and a list with no commands does nothing", { skip }, async () => {
  const full = encodeCommands(mine());
  const cut = full.slice(0, Math.floor(full.length * 0.6));
  let { base, made } = await withHelper();
  await page.goto(`${base}/overlay/actions/?c=${encodeURIComponent(cut)}&channel=pond_cafe&platform=tiktok`, { settle: 800 });
  assert.match(await text("#note"), /cut off/);
  assert.equal(made.length, 0, "it does not even connect to chat");
  assert.equal(await card(), null);
  assert.deepEqual(page.problems, []);

  ({ base, made } = await withHelper());
  assert.equal(readCommands(encodeCommands(mine({ commands: [] }))).state, "ok");
  await page.goto(overlayUrl(base, mine({ commands: [] })), { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  say(made, "d1", ".mouse");
  await sleep(500);
  assert.equal(await card(), null, "no commands, so the sample .mouse does not come back");
});

test("editor: Off and an empty list go into the link, and a link with no commands opens with none", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/actions/", { settle: 800 });
  await type("#source-channel", "pond.pal");
  await type("#c-cooldown", "0");
  assert.equal(readCommands(await linkC()).config.cooldown, 0, "Off stays Off in the link");

  // delete every command
  for (let i = 0; i < 20; i++) {
    const left = await page.evaluate(`document.querySelectorAll(".action-cmd-row").length`);
    if (!left) break;
    await page.evaluate(`document.querySelector(".action-cmd-row__del").click()`);
  }
  assert.equal(await page.evaluate(`document.querySelectorAll(".action-cmd-row").length`), 0);
  const read = readCommands(await linkC());
  assert.equal(read.state, "ok");
  assert.equal(read.config.commands.length, 0, "the sample commands do not come back");

  // opening that link keeps it empty
  const { base: again } = await withHelper();
  await page.goto(`${again}/actions/?c=${encodeURIComponent(await linkC())}`, { settle: 800 });
  assert.equal(await page.evaluate(`document.querySelectorAll(".action-cmd-row").length`), 0);
  assert.equal(await page.evaluate(`document.getElementById("cmd-warnings").hidden`), true);
});

test("editor: a space is not kept in a trigger, a repeated or empty trigger is explained, and a cut-off link is said to be", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/actions/", { settle: 800 });
  assert.equal(await page.evaluate(`document.getElementById("cmd-warnings").hidden`), true, "the starting commands have nothing to warn about");

  assert.equal(await typeAt(".action-cmd-row__trigger", 0, "My Mouse"), "mymouse", "lower case, and no space");
  await typeAt(".action-cmd-row__trigger", 1, "mymouse");
  const warning = await text("#cmd-warnings");
  assert.match(warning, /Only the first one will ever pop up/);
  assert.equal(await page.evaluate(`document.getElementById("cmd-warnings").hidden`), false);

  await typeAt(".action-cmd-row__trigger", 1, "");
  assert.match(await text("#cmd-warnings"), /has no trigger/);
  await typeAt(".action-cmd-row__trigger", 1, "other");
  assert.equal(await page.evaluate(`document.getElementById("cmd-warnings").hidden`), true, "fixed, so the warning goes");

  // a link a chat app cut off: the editor says so and starts from the starting commands
  const full = encodeCommands(mine());
  const { base: second } = await withHelper();
  await page.goto(`${second}/actions/?c=${encodeURIComponent(full.slice(0, Math.floor(full.length * 0.6)))}`, { settle: 800 });
  assert.match(await text("#cmd-warnings"), /cut off/);
  assert.equal(await page.evaluate(`document.querySelectorAll(".action-cmd-row").length`), 5);
});

test("editor: the chat-reply controls are hidden until the editor is opened with ?chatbot=1, and then they stay on", { skip }, async () => {
  const shown = (selector) => page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).display !== "none"`);
  const parts = [".action-chat-toggle", "#chat-hint", ".action-cmd-row__replywrap"];
  const { base } = await withHelper();
  await page.goto(base + "/actions/", { settle: 800 });
  for (const selector of parts) assert.equal(await shown(selector), false, `${selector} is hidden for everyone by default`);

  await page.goto(base + "/actions/?chatbot=1", { settle: 800 });
  for (const selector of parts) assert.equal(await shown(selector), true, `${selector} shows with ?chatbot=1`);
  await page.goto(base + "/actions/", { settle: 800 });
  assert.equal(await shown(".action-chat-toggle"), true, "and it is remembered in this browser");
  await page.goto(base + "/actions/?chatbot=0", { settle: 800 });
  assert.equal(await shown(".action-chat-toggle"), false, "?chatbot=0 hides it again");
});

test("editor: each command has a chat reply with a counter, the choice goes into the link, and the practice chat shows what the bot would say", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/actions/?chatbot=1", { settle: 800 });
  await type("#source-channel", "pond.pal");

  // the starting commands carry no chat reply, so nothing sample can ever be posted to a real chat
  assert.equal(await page.evaluate(`document.querySelectorAll(".action-cmd-row__reply").length`), 5);
  assert.equal(await page.evaluate(`[...document.querySelectorAll(".action-cmd-row__reply")].every((i) => i.value === "")`), true);
  assert.equal(await page.evaluate(`document.querySelector(".action-cmd-row__reply").maxLength`), 150);
  const start = readCommands(await linkC()).config;
  assert.equal(start.chat, false, "chat replies are off until the streamer turns them on");

  const reply = "I use a Razer Viper V3 Pro at 800 DPI";
  await typeAt(".action-cmd-row__reply", 0, reply);
  assert.equal(await page.evaluate(`document.querySelectorAll(".action-cmd-row__count")[0].textContent`), `${reply.length}/150`);

  await page.evaluate(`document.getElementById("chat-on").click()`);
  const on = readCommands(await linkC()).config;
  assert.equal(on.chat, true);
  assert.equal(on.commands[0].reply, reply);

  // the practice chat says what the bot would post, without posting anything
  await type("#sim-input", `${on.prefix}${on.commands[0].trigger}`);
  await page.evaluate(`document.getElementById("sim-send").click()`);
  assert.match(await text("#sim-feedback"), /the bot would say: "I use a Razer Viper V3 Pro at 800 DPI"/);
  assert.deepEqual(page.problems, []);
});
