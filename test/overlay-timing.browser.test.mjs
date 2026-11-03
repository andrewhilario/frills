// The overlay's timing: how long messages stay, how fast the practice events come, where the chat sits. These have to wait for real time to pass,
// so each case runs on its own browser at the same time as the others (inParallel) and the whole file waits once, not once per case.
// Skipped (not failed) on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, inParallel, launch, sleep, waitForServer } from "../scripts/lib/chrome.mjs";

const root = join(import.meta.dirname, "..");
if (!existsSync(join(root, "dist", "index.html"))) throw new Error("dist/ is empty. Run `npm run build` first (`npm test` does that for you).");

let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

const port = 3500 + Math.floor(Math.random() * 400);
const base = `http://localhost:${port}`;
let server;

before(async () => {
  if (skip) return;
  server = spawn(process.execPath, ["scripts/serve.mjs", String(port)], { cwd: root, stdio: "ignore" });
  await waitForServer(base + "/");
});
after(() => server?.kill());

const LOOKS = ["", "style=latte&palette=sakura&"];
const showing = (page) => page.evaluate(`[...document.querySelectorAll("#chat .m")].filter((m) => !m.classList.contains("leaving")).length`);

test("overlay: with Keep messages on screen (stay=1) messages never fade, in a general look and a matcha one; without it they leave after their time", { skip }, async () => {
  // a one-second life and a quick practice chat: without stay the list stays short, with stay it fills to max
  const cases = LOOKS.flatMap((look) => [{ look, stay: false }, { look, stay: true }]);
  await inParallel(cases, async ({ look, stay }, page) => {
    await page.goto(`${base}/overlay/?demo=1&pace=300&max=12&life=1&${stay ? "stay=1&" : ""}${look}`, { settle: 300 });
    await sleep(4500);
    const count = await showing(page);
    if (stay) assert.ok(count >= 7, `with stay (${look || "general"}) ${count} messages showing after 4.5 s`);
    else assert.ok(count <= 4, `without stay (${look || "general"}) ${count} messages showing after 4.5 s with a life of 1 s`);
  }, { pages: cases.length });
});

test("overlay: Chat position puts the messages at the bottom of the window (the default) or at the top, in a general look and a matcha one", { skip }, async () => {
  const edges = (page) => page.evaluate(`(() => { const r = document.getElementById("chat").getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(innerHeight - r.bottom), height: Math.round(r.height), window: innerHeight }; })()`);
  const cases = LOOKS.flatMap((look) => [{ look, top: false }, { look, top: true }]);
  await inParallel(cases, async ({ look, top }, page) => {
    await page.goto(`${base}/overlay/?demo=1&pace=300&max=3&life=0&${top ? "place=top&" : ""}${look}`, { settle: 300 });
    await page.waitFor(`document.querySelectorAll("#chat .m").length >= 2`, { timeout: 6000 });
    await sleep(600);
    const at = await edges(page);
    if (top) assert.ok(at.top <= 12 && at.bottom > 40, `with place=top (${look || "general"}) the chat is at the top: ${JSON.stringify(at)}`);
    else assert.ok(at.bottom <= 12 && at.top > 40, `by default (${look || "general"}) the chat is at the bottom: ${JSON.stringify(at)}`);
  }, { pages: cases.length });
});

test("overlay: ?pace= makes the practice events come faster, and without it they come at the usual speed (chat and last gifts, like the other overlays)", { skip }, async () => {
  // how many came in a 3-second stretch, after the first few that a practice chat starts with
  const chatIn3Seconds = async (page, query) => {
    await page.goto(`${base}/overlay/?demo=1&max=40&life=0&${query}`, { settle: 300 });
    await sleep(1800);
    const before = await page.evaluate(`document.querySelectorAll("#chat .m").length`);
    await sleep(3000);
    return (await page.evaluate(`document.querySelectorAll("#chat .m").length`)) - before;
  };
  const giftsIn3Seconds = async (page, query) => {
    await page.goto(`${base}/overlay/gifts/?demo=1&max=30&${query}`, { settle: 100 });
    await sleep(3000);
    return page.evaluate(`document.querySelectorAll("#gifts .gift").length`);
  };
  // one browser, one measurement after another: how many events come in 3 seconds is what a busy computer changes
  const page = await launch();
  const counted = {};
  try {
    counted.usualChat = await chatIn3Seconds(page, "");
    counted.quickChat = await chatIn3Seconds(page, "pace=300");
    // a missing pace is the usual speed, not the fast one (it once was the fast one)
    counted.usualGifts = await giftsIn3Seconds(page, "");
    counted.quickGifts = await giftsIn3Seconds(page, "pace=300");
    // and a pace that is not a number is the usual speed too
    counted.soonGifts = await giftsIn3Seconds(page, "pace=soon");
  } finally {
    await page.close();
  }
  assert.ok(counted.usualChat <= 3, `at the usual pace ${counted.usualChat} new chat messages came in 3 seconds`);
  assert.ok(counted.quickChat >= 6, `with pace=300 ${counted.quickChat} new chat messages came in 3 seconds`);
  assert.ok(counted.usualGifts <= 3, `at the usual pace ${counted.usualGifts} gifts showed in 3 seconds`);
  assert.ok(counted.quickGifts >= 5, `with pace=300 ${counted.quickGifts} gifts showed in 3 seconds`);
  assert.ok(counted.soonGifts <= 3, "a pace that is not a number changes nothing");
});
