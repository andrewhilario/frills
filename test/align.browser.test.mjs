// Text alignment (left, center, right) in a real headless Chrome: the chat, the alerts, last gifts, goals, top likers and song requests, each in
// their practice mode. Left is the default and changes nothing; center puts the words in the middle; right puts them at the right edge and swaps
// the sides (the picture or the rank moves to the other end). The chat's bubbles fill the row in all three; only the words and the picture move. Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch } from "../scripts/lib/chrome.mjs";
import { createStatic } from "../scripts/lib/static.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "overlay", "gifts", "index.html"))) throw new Error("dist/ has no overlay pages. Run `npm run build` first (`npm test` does that for you).");
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
  await page.viewport(640, 480);
});
after(async () => {
  await page?.close();
  server?.closeAllConnections?.();
  server?.close();
});

/** Opens an overlay in practice mode with an alignment, waits for something to be drawn, and reports computed styles from `probe` (an expression). */
async function look(path, align, waitFor, probe) {
  await page.goto(`${base}${path}${path.includes("?") ? "&" : "?"}align=${align}`, { settle: 400 });
  await page.waitFor(waitFor);
  return page.evaluate(`(() => { const css = (sel, prop) => { const n = document.querySelector(sel); return n ? getComputedStyle(n)[prop] : null; }; return (${probe})(css); })()`);
}

test("chat: left, center and right all fill the row, the words follow the alignment, and right puts the picture on the far side", { skip }, async () => {
  const geometry = (align) => look("/overlay/?demo=1&look=blueberry", align, `document.querySelectorAll("#chat .m").length >= 3`, `() => {
    const box = document.getElementById("chat").getBoundingClientRect();
    const ms = [...document.querySelectorAll("#chat .m")].map((m) => m.getBoundingClientRect());
    const av = document.querySelector("#chat .m .av").getBoundingClientRect();
    const body = document.querySelector("#chat .m .body").getBoundingClientRect();
    return { stage: document.getElementById("stage").dataset.align, box: box.width, narrowest: Math.min(...ms.map((r) => r.width)), gapRight: Math.min(...ms.map((r) => box.right - r.right)), gapLeft: Math.min(...ms.map((r) => r.left - box.left)), words: getComputedStyle(document.querySelector("#chat .m .txt")).textAlign, avatarOnRight: av.left > body.left };
  }`);
  const left = await geometry("left");
  const center = await geometry("center");
  const right = await geometry("right");
  assert.deepEqual([left.stage, center.stage, right.stage], ["left", "center", "right"]);
  for (const [name, g] of [["left", left], ["center", center], ["right", right]]) {
    assert.ok(g.narrowest >= g.box - 2, `${name}: every message is as wide as the chat (${g.narrowest} of ${g.box})`);
    assert.ok(g.gapLeft <= 2 && g.gapRight <= 2, `${name}: and touches both edges (${g.gapLeft}, ${g.gapRight})`);
  }
  assert.ok(["start", "left"].includes(left.words), `left: the words start at the left (${left.words})`);
  assert.equal(center.words, "center");
  assert.equal(right.words, "right");
  assert.equal(left.avatarOnRight, false);
  assert.equal(center.avatarOnRight, false);
  assert.equal(right.avatarOnRight, true, "right: the picture is on the right");
});

test("chat: the decorations never stick out past the page's edges, whatever the alignment, the side of the scene or the pack", { skip }, async () => {
  const worst = [];
  for (const deco of ["frog", "neko", "hamster", "bunny"]) {
    for (const side of ["left", "right"]) {
      for (const align of ["left", "center", "right"]) {
        const out = await look(`/overlay/?demo=1&look=matcha&deco=${deco}&decoSide=${side}&tag=pill&pace=400`, align, `document.querySelectorAll("#chat .m .deco__corner").length >= 3`, `() => {
          const w = document.documentElement.clientWidth;
          let past = 0;
          for (const e of document.querySelectorAll("#chat .m [class*='deco']")) { const b = e.getBoundingClientRect(); if (b.width < 1) continue; past = Math.max(past, -b.left, b.right - w); }
          return Math.round(past);
        }`);
        if (out > 1) worst.push(`${deco}, scene on the ${side}, ${align}: ${out} px`);
      }
    }
  }
  assert.deepEqual(worst, [], "pictures cut off by the page's edge");
});

test("an unknown alignment in a link is ignored, and the chat stays as it was", { skip }, async () => {
  const stage = await look("/overlay/?demo=1&look=blueberry", "sideways", `document.querySelectorAll("#chat .m").length >= 1`, `() => document.getElementById("stage").dataset.align`);
  assert.equal(stage, "left");
});

test("last gifts: each row's words and picture follow the alignment, and right swaps the sides", { skip }, async () => {
  const get = (align) => look("/overlay/gifts/?demo=1&pace=300&max=3", align, `document.querySelector(".gift")`, `(css) => ({ list: document.querySelector(".giftlist").dataset.align, words: css(".gift__words", "textAlign"), row: css(".gift", "flexDirection"), justify: css(".gift", "justifyContent") })`);
  const left = await get("left");
  assert.deepEqual([left.list, left.words, left.row], ["left", "left", "row"]);
  const center = await get("center");
  assert.deepEqual([center.list, center.words, center.justify], ["center", "center", "center"]);
  const right = await get("right");
  assert.deepEqual([right.list, right.words, right.row], ["right", "right", "row-reverse"]);
});

test("top likers: the ranking rows are centered or reversed, and the title goes with them", { skip }, async () => {
  const get = (align) => look("/overlay/likers/?demo=1&pace=200&max=3", align, `document.querySelector(".liker")`, `(css) => ({ board: document.querySelector(".likers").dataset.align, row: css(".liker", "flexDirection"), justify: css(".liker", "justifyContent"), title: css(".likers__title", "textAlign") })`);
  const left = await get("left");
  assert.deepEqual([left.board, left.row], ["left", "row"]);
  const center = await get("center");
  assert.deepEqual([center.justify, center.title], ["center", "center"]);
  const right = await get("right");
  assert.deepEqual([right.row, right.title], ["row-reverse", "right"]);
});

test("goals: the label and the count are centered, or swapped to read from the right", { skip }, async () => {
  const get = (align) => look("/overlay/goal/?demo=1&type=follow&start=20&target=100&step=0", align, `document.querySelector(".goal__head")`, `(css) => ({ goal: document.querySelector(".goal").dataset.align, row: css(".goal__head", "flexDirection"), justify: css(".goal__head", "justifyContent") })`);
  assert.deepEqual(Object.values(await get("left")).slice(0, 2), ["left", "row"]);
  assert.equal((await get("center")).justify, "center");
  assert.equal((await get("right")).row, "row-reverse");
});

test("alerts: the card and its words follow the alignment, and right puts the picture on the far side", { skip }, async () => {
  const get = (align) => look("/overlay/alerts/?demo=1&only=follow&pace=400&maxShown=2", align, `document.querySelector(".alert__card")`, `(css) => ({ alerts: document.querySelector(".alerts").dataset.align, words: css(".alert__words", "textAlign"), row: css(".alert__card", "flexDirection"), justify: css(".alert__card", "justifyContent") })`);
  const left = await get("left");
  assert.deepEqual([left.alerts, left.words, left.row], ["left", "left", "row"]);
  const center = await get("center");
  assert.deepEqual([center.words, center.justify], ["center", "center"]);
  const right = await get("right");
  assert.deepEqual([right.words, right.row], ["right", "row-reverse"]);
});

test("song requests: the words follow the alignment in the card and in the queue", { skip }, async () => {
  const get = (align) => look("/overlay/songs/?demo=1", align, `document.querySelector(".song")`, `(css) => ({ songs: document.querySelector(".songs").dataset.align, text: css(".song__text", "textAlign"), title: css(".songs__title", "textAlign") })`);
  assert.deepEqual(Object.values(await get("left")).slice(0, 2), ["left", "left"]);
  const center = await get("center");
  assert.deepEqual([center.text, center.title], ["center", "center"]);
  const right = await get("right");
  assert.deepEqual([right.text, right.title], ["right", "right"]);
});
