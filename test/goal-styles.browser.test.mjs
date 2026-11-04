// The goal's designs and its celebration sound in a real headless Chrome: each design is really drawn that way on the overlay page, the editor offers them
// and puts them in the link, and the sound plays when a goal is reached only when one is chosen. Skipped on a computer with no Chrome or Edge.
// `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createStatic } from "../scripts/lib/static.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "index.html"))) throw new Error("dist/ is empty. Run `npm run build` first (`npm test` does that for you).");

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

const still = "demo=1&pace=10000&start=45&fromLive=0&target=100&step=0"; // a bar at about 45 %, and the practice events too far apart to matter
const open = (query) => page.goto(`${base}/overlay/goal/?${still}&${query}`, { settle: 600 });
const css = (selector, property, pseudo = null) => page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)}), ${JSON.stringify(pseudo)}).getPropertyValue(${JSON.stringify(property)})`);

const rect = (selector) => page.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) }; })()`);
const near = (a, b, within = 1) => Math.abs(a - b) <= within;

test("goal designs: each one is drawn its own way, as one piece (the words and the bar together, lined up), and an unknown one is the classic bar", { skip }, async () => {
  await open("barStyle=bar&showPercent=1");
  assert.equal(await page.evaluate(`document.querySelector(".goal").dataset.style`), "bar");
  assert.equal(await css(".goal__track", "mask-image"), "none");
  assert.equal(await css(".goal", "border-top-width"), "0px", "the classic goal is two boxes, not one card");
  const percent = Number(await page.evaluate(`document.querySelector(".goal").style.getPropertyValue("--p")`));
  assert.ok(percent >= 45 && percent <= 55, `the bar is at about 45 % (${percent})`);

  // candy stripes: the words sit on the bar itself
  await open("barStyle=candy&showPercent=1");
  assert.equal(await css(".goal__fill", "animation-name"), "goal-stripes", "the stripes move");
  const candy = { head: await rect(".goal__head"), track: await rect(".goal__track") };
  assert.ok(candy.head.left >= candy.track.left && candy.head.right <= candy.track.right && candy.head.top >= candy.track.top && candy.head.bottom <= candy.track.bottom, `the words are on the bar: ${JSON.stringify(candy)}`);
  assert.equal(await css(".goal__head", "background-color"), "rgba(0, 0, 0, 0)", "with no box of their own");

  // the card designs: one card around the words and the bar, the words with no box of their own, and the words and the bar the same width
  for (const design of ["blocks", "hearts", "stars", "neon"]) {
    await open(`barStyle=${design}&showPercent=1`);
    assert.notEqual(await css(".goal", "border-top-width"), "0px", `${design}: one card around everything`);
    assert.equal(await css(".goal__head", "background-color"), "rgba(0, 0, 0, 0)", `${design}: the words have no box of their own`);
    assert.equal(await css(".goal__head", "border-top-width"), "0px");
    const head = await rect(".goal__head");
    const track = await rect(".goal__track");
    const card = await rect(".goal");
    assert.ok(near(head.left, track.left) && near(head.right, track.right), `${design}: the words and the bar line up (${JSON.stringify([head, track])})`);
    assert.ok(track.left > card.left && track.right < card.right && head.top > card.top && track.bottom < card.bottom, `${design}: both are inside the card`);
  }
  await open("barStyle=blocks");
  assert.notEqual(await css(".goal__track", "content", "::after"), "none", "blocks: the gaps between the blocks are drawn over the fill");
  for (const shape of ["hearts", "stars"]) {
    await open(`barStyle=${shape}`);
    assert.match(await css(".goal__track", "mask-image"), /svg/, `${shape}: the track is cut to little shapes`);
  }
  await open("barStyle=neon");
  assert.notEqual(await css(".goal", "box-shadow"), "none", "neon glows, card and all");

  // the ring: a card with the ring, the percent in the middle of it, and the name and the count beside it
  await open("barStyle=ring&showPercent=1");
  assert.equal(await css(".goal__track", "border-radius"), "50%", "the ring is a circle");
  assert.equal(await css(".goal__track", "width"), await css(".goal__track", "height"));
  assert.match(await css(".goal__track", "background-image"), /conic-gradient/);
  assert.equal(await css(".goal__fill", "display"), "none");
  const ring = await rect(".goal__track");
  const pct = await rect(".goal__pct");
  assert.ok(near(pct.left + pct.right, ring.left + ring.right, 2) && near(pct.top + pct.bottom, ring.top + ring.bottom, 2), "the percent is in the middle of the ring");
  assert.match(await page.evaluate(`document.querySelector(".goal__pct").textContent`), /^\d+%$/);
  const label = await rect(".goal__label");
  const numbers = await rect(".goal__numbers");
  assert.ok(label.left >= ring.right && numbers.left >= ring.right, "the name and the count are beside the ring");
  assert.ok(label.top >= ring.top && numbers.bottom <= ring.bottom, "and level with it");
  assert.doesNotMatch(await page.evaluate(`document.querySelector(".goal__numbers").textContent`), /%/, "the percent is not said twice");

  await open("barStyle=%3Cscript%3E");
  assert.equal(await page.evaluate(`document.querySelector(".goal").dataset.style`), "bar");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("goal designs: the small ones (hearts, stars, ring) sit where the alignment says, left, center or right", { skip }, async () => {
  const width = Number(await page.evaluate("innerWidth"));
  for (const design of ["hearts", "stars", "ring"]) {
    await open(`barStyle=${design}&align=left`);
    let box = await rect(".goal");
    assert.ok(near(box.left, width * 0.04, 2), `${design} left: starts at the left margin (${box.left})`);
    await open(`barStyle=${design}&align=center`);
    box = await rect(".goal");
    assert.ok(near(box.left + box.right, width, 3), `${design} center: in the middle (${JSON.stringify(box)})`);
    await open(`barStyle=${design}&align=right`);
    box = await rect(".goal");
    assert.ok(near(box.right, width * 0.96, 2), `${design} right: ends at the right margin (${box.right})`);
  }
});

test("goal designs: the editor offers them as choices, the preview changes at once, and the link carries the design and the sound", { skip }, async () => {
  await page.viewport(1280, 900);
  await page.goto(`${base}/goal/`, { settle: 500 });
  await page.evaluate("localStorage.clear()");
  await page.goto(`${base}/goal/`, { settle: 900 });
  const row = (label) => `[...document.querySelectorAll("#main-controls .ctl, .panel .ctl")].find((r) => r.querySelector(".ctl__label")?.textContent.trim() === ${JSON.stringify(label)})`;
  const names = await page.evaluate(`[...${row("Bar design")}.querySelectorAll(".chip")].map((b) => b.textContent.trim())`);
  assert.deepEqual(names, ["Classic", "Candy stripes", "Blocks", "Hearts", "Stars", "Neon glow", "Ring"]);
  assert.equal(await page.evaluate(`document.querySelector(".preview .goal").dataset.style`), "bar");
  await page.evaluate(`[...${row("Bar design")}.querySelectorAll(".chip")].find((b) => b.textContent.trim() === "Hearts").click()`);
  assert.equal(await page.evaluate(`document.querySelector(".preview .goal").dataset.style`), "hearts");
  assert.equal(await page.evaluate(`${row("Bar design")}.querySelector('[aria-pressed="true"]').textContent.trim()`), "Hearts");
  const sounds = await page.evaluate(`[...${row("Celebration sound")}.querySelectorAll("option")].map((o) => o.textContent.trim())`);
  assert.equal(sounds[0], "No sound");
  assert.ok(sounds.includes("Fanfare"));
  assert.equal(await page.evaluate(`${row("Celebration sound")}.querySelector("select").value`), "none", "quiet to begin with");
  await page.evaluate(`(() => { const s = ${row("Celebration sound")}.querySelector("select"); s.value = "chime"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await page.evaluate(`(() => { const i = document.getElementById("source-channel"); i.value = "pond.pal"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  const link = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(link.pathname, "/overlay/goal/");
  assert.deepEqual([link.searchParams.get("barStyle"), link.searchParams.get("celebrateSound")], ["hearts", "chime"]);
  await page.evaluate("localStorage.clear()");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("goal celebration sound: reaching the goal plays the chosen sound, and No sound plays nothing", { skip }, async () => {
  // a pretend sound card that counts the notes it is asked to play
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    window.__notes = 0;
    const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
    window.AudioContext = class { constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
      resume() { return Promise.resolve(); }
      createGain() { return { gain: param(), connect() {} }; }
      createOscillator() { window.__notes++; return { type: "", frequency: param(), connect() {}, start() {}, stop() {} }; } };
  })()` });
  const reach = "demo=1&pace=300&start=97&target=100&step=0&fromLive=0"; // (the celebration is on unless a link says celebrate=0)
  const notes = () => page.evaluate("window.__notes");
  await page.goto(`${base}/overlay/goal/?${reach}&celebrateSound=chime`, { settle: 300 });
  await page.waitFor(`document.querySelector(".goal--party")`, { timeout: 10000 });
  assert.ok(await notes() > 0, "the chime played when the goal was reached");
  await page.goto(`${base}/overlay/goal/?${reach}`, { settle: 300 });
  await page.waitFor(`document.querySelector(".goal--party")`, { timeout: 10000 });
  await sleep(300);
  assert.equal(await notes(), 0, "with no sound chosen, the celebration is silent");
  await page.goto(`${base}/overlay/goal/?${reach}&celebrateSound=chime&celebrate=0`, { settle: 300 });
  await sleep(2500);
  assert.equal(await page.evaluate(`document.querySelector(".goal--party")`), null);
  assert.equal(await notes(), 0, "and with the celebration switched off there is no sound either");
});
