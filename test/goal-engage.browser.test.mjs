// The goal overlay and its editor in a real headless Chrome: the reward line under the bar, "N to go", the "+1 name" bubbles, and the cheer at a quarter; each
// one can be switched off. Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createStatic } from "../scripts/lib/static.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "overlay", "goal", "index.html"))) throw new Error("dist/ has no goal overlay. Run `npm run build` first (`npm test` does that for you).");
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
  await page.viewport(900, 500);
});
after(async () => {
  await page?.close();
  server?.closeAllConnections?.();
  server?.close();
});

const still = "demo=1&pace=300&target=100&step=0&fromLive=0"; // practice events a little over a quarter of a second apart, and no next goal
const text = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
const shown = (selector) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return Boolean(e) && !e.hidden && getComputedStyle(e).display !== "none"; })()`);

test("goal: the reward sits under the bar, the numbers say how many are left, a bubble with the name rises for each one, and a quarter is cheered", { skip }, async () => {
  await page.goto(`${base}/overlay/goal/?${still}&start=24&reward=Karaoke%20night!`, { settle: 600 });
  await page.waitFor(`document.querySelector(".goal__gain")`, { timeout: 8000 });
  assert.match(await text(".goal__gain"), /^\+\d+ \S/, "a plus, how much, and the name");
  assert.equal(await text(".goal__reward"), "At the goal: Karaoke night!");
  assert.equal(await shown(".goal__reward"), true);
  assert.match(await text(".goal__numbers"), /\d+ to go/);
  await page.waitFor(`!document.querySelector(".goal__moment").hidden`, { timeout: 8000 });
  assert.equal(await text(".goal__moment"), "A quarter of the way!");
  const where = await page.evaluate(`(() => { const g = document.querySelector(".goal").getBoundingClientRect(); const b = document.querySelector(".goal__gain").getBoundingClientRect(); const m = document.querySelector(".goal__moment").getBoundingClientRect(); return { gainAboveBar: b.bottom <= document.querySelector(".goal__track").getBoundingClientRect().bottom, momentAboveGoal: m.bottom <= g.top + 4 }; })()`);
  assert.equal(where.gainAboveBar, true, "the bubble rises from the bar");
  assert.equal(where.momentAboveGoal, true, "the cheer is above everything");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("goal: each of those can be switched off, and a link with none of them looks like the goal did before", { skip }, async () => {
  await page.goto(`${base}/overlay/goal/?${still}&start=24&thanks=0&milestones=0&toGo=0`, { settle: 600 });
  await sleep(2500); // plenty of practice events pass, and the bar passes a quarter
  assert.equal(await page.evaluate(`document.querySelectorAll(".goal__gain").length`), 0, "no name bubbles");
  assert.equal(await shown(".goal__moment"), false, "no cheer");
  assert.doesNotMatch(await text(".goal__numbers"), /to go/);
  assert.equal(await shown(".goal__reward"), false, "no reward line when none was typed");
});

test("goal editor: the options are there, the test buttons make a name bubble, and a typed reward shows under the bar at once", { skip }, async () => {
  await page.viewport(1280, 900);
  await page.goto(`${base}/goal/`, { settle: 500 });
  await page.evaluate("localStorage.clear()");
  await page.goto(`${base}/goal/`, { settle: 900 });
  const labels = await page.evaluate(`[...document.querySelectorAll(".panel .ctl__label")].map((l) => l.textContent.trim())`);
  for (const wanted of ["Show how many are left (53 to go)", "What you get at the goal", "Thank each person (+1 and their name)", "Cheer at 25%, 50% and 75%"]) assert.ok(labels.includes(wanted), `${wanted} is missing`);
  await page.evaluate(`document.querySelector('[data-test="one"]').click()`);
  await page.waitFor(`document.querySelector(".preview .goal__gain")`, { timeout: 5000 });
  assert.match(await text(".preview .goal__gain"), /^\+1 \S/);
  await page.evaluate(`(() => { const i = document.getElementById("c-reward"); i.value = "Dance on stream"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await page.waitFor(`document.querySelector(".preview .goal__reward")?.textContent === "At the goal: Dance on stream"`, { timeout: 4000 });
  await page.evaluate("localStorage.clear()");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});
