// The message sound for the chat, in a real headless Chrome with a pretend audio system that counts what it is asked to play (nothing is heard): the chat overlay with no sound in its link loads
// no sound file and plays nothing; with a sound it loads the file and plays one sound per message, no sooner than the quiet time apart; the editor offers the choice (with "No sound" first),
// plays a sound when one is picked, and puts the choice in the link only when there is one. Skipped on a computer with no Chrome or Edge.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createStatic } from "../scripts/lib/static.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "overlay", "index.html"))) throw new Error("dist/ has no overlay page. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

let server;
let base;
let page;
before(async () => {
  if (skip) return;
  server = http.createServer(createStatic(dist));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  page = await launch();
  await page.viewport(1100, 800);
  // Every page gets a pretend audio system: each note it is asked to play is written down (the "pop" sound is one note, so one pop is one entry).
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__notes = [];
    window.AudioContext = class { constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
      resume() { return Promise.resolve(); } createGain() { return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      createOscillator() { return { frequency: { setValueAtTime(f) { window.__notes.push(Math.round(f)); }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; } };` });
});
after(async () => {
  await page?.close();
  server?.closeAllConnections?.();
  server?.close();
});

const notes = () => page.evaluate("window.__notes.length");
const soundScripts = () => page.evaluate(`document.querySelectorAll('script[src*="chatSounds"]').length`);
const overlay = async (query) => { await page.goto(`${base}/overlay/?demo=1&pace=300&look=blueberry${query}`, { settle: 400 }); };

test("a chat with no sound in its link loads no sound file and plays nothing", { skip }, async () => {
  await overlay("");
  await sleep(3000);
  assert.equal(await page.evaluate(`document.querySelectorAll("#chat .m").length > 0`), true, "messages did appear");
  assert.equal(await notes(), 0);
  assert.equal(await soundScripts(), 0, "the sound player was never even loaded");
  await overlay("&sound=none");
  await sleep(1500);
  assert.deepEqual([await notes(), await soundScripts()], [0, 0], "'none' written in the link is the same");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("with a sound in the link the file loads and each message plays it", { skip }, async () => {
  await overlay("&sound=pop&soundGap=0");
  await page.waitFor("window.__notes.length >= 3", { timeout: 9000 });
  assert.equal(await soundScripts(), 1);
  assert.equal(await page.evaluate("window.__notes[0]"), 700, "it is the pop sound");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("the quiet time keeps the sounds apart", { skip }, async () => {
  await overlay("&sound=pop&soundGap=5");
  await page.waitFor("window.__notes.length >= 1", { timeout: 9000 });
  await sleep(3500);
  assert.equal(await notes(), 1, "many messages in 4 seconds, one sound");
});

test("a sound the list does not have plays nothing", { skip }, async () => {
  await overlay("&sound=gong&soundGap=0");
  await sleep(3000);
  assert.equal(await notes(), 0);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("the editor offers No sound first, plays a sound when one is picked, and puts the choice in the link only when there is one", { skip }, async () => {
  await page.goto(`${base}/editor/?season=none`, { settle: 700 });
  const row = `[...document.querySelectorAll(".ctl")].find((r) => r.querySelector(".ctl__label")?.textContent.trim() === "Sound for each message")`;
  assert.deepEqual(await page.evaluate(`[...${row}.querySelectorAll("option")].map((o) => o.textContent.trim()).slice(0, 3)`), ["No sound", "Pop", "Boop"]);
  assert.equal(await page.evaluate(`${row}.querySelector("select").value`), "none", "silent to begin with");
  assert.equal(await page.evaluate(`[...document.querySelectorAll(".ctl__label")].some((l) => l.textContent.trim() === "Message sound volume")`), true, "volume and quiet time are there under more options");
  await page.evaluate(`(() => { const i = document.getElementById("source-channel"); i.value = "pond.pal"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  const link = () => page.evaluate(`document.getElementById("link").value`);
  assert.equal((await link()).includes("sound"), false);

  await page.evaluate("window.__notes.length = 0");
  await page.evaluate(`(() => { const s = ${row}.querySelector("select"); s.value = "pop"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  assert.equal(new URL(await link()).searchParams.get("sound"), "pop");
  await page.waitFor("window.__notes.length >= 1", { timeout: 4000 }); // the choice plays once, so it can be heard before it goes on stream

  await page.evaluate(`(() => { const s = ${row}.querySelector("select"); s.value = "none"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  assert.equal((await link()).includes("sound"), false, "back to No sound: nothing about sound in the link");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});
