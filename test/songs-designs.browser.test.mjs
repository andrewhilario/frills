// The song designs with their own artwork (cassette, turntable, handheld, kawaii, polaroid, neon) in a real headless Chrome: each one draws its pieces (the reels, the
// tonearm, the buttons, the ears, the tape, the glow) and comes from the link. Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch } from "../scripts/lib/chrome.mjs";
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
  await page.viewport(560, 480);
});
after(async () => {
  await page?.close();
  server?.closeAllConnections?.();
  server?.close();
});

/** Opens the song overlay with made-up songs in one design and returns facts about the card that is playing. */
async function look(layout, extra = "") {
  await page.goto(`${base}/overlay/songs/?demo=1&layout=${layout}&show=now&pace=500${extra}`, { settle: 500 });
  await page.waitFor(`document.querySelector(".songs__now .song--now")`, { timeout: 15000 });
  await page.waitFor(`!document.querySelector(".songs__now .song--in")`, { timeout: 5000 }); // its entrance is over, so it is measured where it stays
  return page.evaluate(`(() => {
    const root = document.querySelector(".songs");
    const card = document.querySelector(".songs__now .song--now");
    const css = (el, prop, pseudo) => getComputedStyle(el, pseudo || null).getPropertyValue(prop).trim();
    const art = card.querySelector(".song__art");
    const reels = [...card.querySelectorAll(".song__bars i")].filter((i) => getComputedStyle(i).display !== "none");
    const box = card.getBoundingClientRect();
    return JSON.stringify({
      layout: root.dataset.layout,
      before: css(card, "content", "::before"), after: css(card, "content", "::after"),
      transform: css(card, "transform"), font: css(card, "font-family"),
      artAnim: css(art, "animation-name"), armAnim: css(card, "animation-name", "::after"),
      reels: reels.length, reelAnim: reels[0] ? css(reels[0], "animation-name") : "", noteBefore: reels[0] ? css(reels[0], "content", "::before") : "",
      titleAnim: css(card.querySelector(".song__title"), "animation-name"),
      earClip: css(card, "clip-path", "::before"),
      width: Math.round(box.width), fits: box.right <= innerWidth + 1 && box.left >= -1,
    });
  })()`).then(JSON.parse);
}

test("cassette: a tape with two reels that turn, screws, and a window", { skip }, async () => {
  const c = await look("cassette");
  assert.equal(c.layout, "cassette");
  assert.equal(c.before, '""', "the window");
  assert.equal(c.after, '""', "the screws");
  assert.equal(c.reels, 2, "two reels (the other two bars are hidden)");
  assert.equal(c.reelAnim, "song-spin");
  assert.ok(c.fits);
});

test("turntable: a spinning record with its label, and a tonearm that swings onto it", { skip }, async () => {
  const c = await look("turntable");
  assert.equal(c.artAnim, "song-spin", "the record turns");
  assert.equal(c.armAnim, "song-arm", "the tonearm swings onto it when the song starts");
  assert.equal(c.before, '""', "the pivot");
  assert.ok(c.fits);
});

test("handheld: pixel letters on a green screen, a pad and two buttons", { skip }, async () => {
  const c = await look("handheld");
  assert.match(c.font, /Press Start 2P/);
  assert.equal(c.before, '""', "the pad");
  assert.equal(c.after, '""', "the buttons");
  assert.ok(c.fits);
});

test("kawaii: cat ears, and little notes that float up", { skip }, async () => {
  const c = await look("kawaii");
  assert.notEqual(c.earClip, "none", "the ears are triangles");
  assert.equal(c.reelAnim, "song-note", "the four bars are notes floating up");
  assert.match(c.noteBefore, /[\u266a\u266b\u2661]/);
  assert.ok(c.fits);
});

test("polaroid: a photo on tilted paper with a piece of tape", { skip }, async () => {
  const c = await look("polaroid");
  assert.notEqual(c.transform, "none", "tilted");
  assert.equal(c.before, '""', "the tape");
  assert.ok(c.fits);
});

test("neon: a glowing sign whose title flickers a little", { skip }, async () => {
  const c = await look("neon");
  assert.equal(c.titleAnim, "song-flicker");
  assert.equal(c.before, '""', "the grid horizon");
  assert.ok(c.fits);
});

test("they work with the queue below, a different cover shape, and no cover", { skip }, async () => {
  for (const layout of ["cassette", "turntable", "handheld", "kawaii", "polaroid", "neon"]) {
    await page.goto(`${base}/overlay/songs/?demo=1&layout=${layout}&show=both&pace=400`, { settle: 500 });
    await page.waitFor(`document.querySelectorAll(".songs__rows .song").length >= 2`, { timeout: 15000 });
    assert.equal(await page.evaluate(`document.querySelectorAll(".songs__now .song--now").length`), 1, `${layout}: the song playing and the queue`);
    await page.goto(`${base}/overlay/songs/?demo=1&layout=${layout}&show=now&cover=none`.replace("cover=", "coverShape="), { settle: 400 });
    await page.waitFor(`document.querySelector(".songs__now .song--now")`, { timeout: 15000 });
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector(".song--now .song__art")).display`), "none", `${layout}: no cover when asked`);
  }
  assert.deepEqual(page.problems.filter((p) => !/cloudflare|Content Security|status of 404/i.test(p)), [], "nothing complained");
});
