// The song designs that are drawn from pictures (cassette, turntable, handheld, kawaii, polaroid, neon) in a real headless Chrome: each card asks for its pictures, they load,
// and the cover, the words and the little pieces sit where the picture's window or label is. The places are measured from the sheets (see scripts/cut-song-sheets.mjs), as shares
// of the card, so they hold at any size. Skipped on a computer with no Chrome or Edge. `npm test` builds first.

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
  await page.viewport(560, 640);
});
after(async () => {
  await page?.close();
  server?.closeAllConnections?.();
  server?.close();
});

/** Opens the song overlay with made-up songs in one design and returns facts about the card that is playing. */
async function look(layout, extra = "") {
  await page.goto(`${base}/overlay/songs/?demo=1&layout=${layout}&show=now&pace=500&size=24${extra}`, { settle: 500 });
  await page.waitFor(`document.querySelector(".songs__now .song--now")`, { timeout: 15000 });
  await page.waitFor(`!document.querySelector(".songs__now .song--in")`, { timeout: 5000 }); // its entrance is over, so it is measured where it stays
  return page.evaluate(`(() => {
    const root = document.querySelector(".songs");
    const card = document.querySelector(".songs__now .song--now");
    const css = (el, prop, pseudo) => getComputedStyle(el, pseudo || null).getPropertyValue(prop).trim();
    const art = card.querySelector(".song__art");
    const img = card.querySelector(".song__img");
    const text = card.querySelector(".song__text");
    const W = card.offsetWidth, H = card.offsetHeight;
    // where a piece is, as shares of the card (offsets ignore the tilt a card may have; the cover's are measured from its own frame, the art, which holds it)
    const at = (el) => ({ x0: el.offsetLeft / W, x1: (el.offsetLeft + el.offsetWidth) / W, y0: el.offsetTop / H, y1: (el.offsetTop + el.offsetHeight) / H, cx: (el.offsetLeft + el.offsetWidth / 2) / W, cy: (el.offsetTop + el.offsetHeight / 2) / H });
    const box = card.getBoundingClientRect();
    return JSON.stringify({
      layout: root.dataset.layout, em: parseFloat(css(card, "font-size")), W, H,
      before: css(card, "background-image", "::before"), after: css(card, "background-image", "::after"), textAfter: css(text, "background-image", "::after"), artAfter: css(art, "background-image", "::after"),
      artBefore: css(art, "content", "::before"), borderImage: css(card, "border-image-source"), cardBg: css(card, "background-color"),
      transform: css(card, "transform"), font: css(card, "font-family"),
      artAnim: css(art, "animation-name"), armAnim: css(card, "animation-name", "::after"), titleAnim: css(card.querySelector(".song__title"), "animation-name"),
      art: at(art), img: at(img), text: at(text), textFits: text.scrollHeight <= text.clientHeight + 1,
      bars: [...card.querySelectorAll(".song__bars i")].map((i) => ({ shown: css(i, "display") !== "none", anim: css(i, "animation-name"), image: css(i, "background-image"), ...at(i) })),
      fits: box.right <= innerWidth + 1 && box.left >= -1,
    });
  })()`).then(JSON.parse);
}
const near = (value, want, tolerance, what) => assert.ok(Math.abs(value - want) <= tolerance, `${what}: ${value.toFixed(3)} should be about ${want}`);
const pictures = (c) => [c.before, c.after, c.textAfter, c.artAfter, c.borderImage, ...c.bars.map((b) => b.image)].flatMap((v) => [...v.matchAll(/\/decor\/songs\/[a-z]+\/[a-z0-9-]+\.webp/g)].map((m) => m[0]));

test("cassette: a tape whose two reels turn behind its see-through holes, the words on its label", { skip }, async () => {
  const c = await look("cassette");
  assert.equal(c.layout, "cassette");
  assert.match(c.before, /\/decor\/songs\/cassette\/body\.webp/, "the case");
  const [one, two, star, heart] = c.bars;
  for (const reel of [one, two]) {
    assert.equal(reel.anim, "song-spin", "a reel turns");
    assert.match(reel.image, /\/decor\/songs\/cassette\/reel\.webp/);
  }
  near(one.cx, 0.305, 0.012, "the left reel is in the left hole");
  near(two.cx, 0.696, 0.012, "the right reel is in the right hole");
  near(one.cy, 0.556, 0.015, "the left reel's height");
  near(two.cy, 0.556, 0.015, "the right reel's height");
  assert.match(star.image, /star\.webp/);
  assert.match(heart.image, /heart\.webp/);
  assert.ok(c.text.x0 > 0.2 && c.text.x1 < 0.92 && c.text.y0 > 0.1 && c.text.y1 < 0.4, "the words are on the label");
  assert.ok(c.textFits, "and fit on it");
  assert.ok(c.art.x0 > 0.05 && c.art.x1 < 0.3 && c.art.y1 < 0.45, "the cover is a sticker at the label's left end");
  assert.ok(c.fits);
});

test("turntable: a spinning record with the cover as its label, and a tonearm that swings onto it", { skip }, async () => {
  const c = await look("turntable");
  assert.equal(c.artAnim, "song-spin", "the record turns");
  assert.equal(c.armAnim, "song-arm", "the tonearm swings onto it when the song starts");
  assert.match(c.before, /\/decor\/songs\/turntable\/base\.webp/, "the player");
  assert.match(c.artAfter, /\/decor\/songs\/turntable\/record\.webp/, "the record is drawn over the cover, so the cover shows through its hole");
  assert.match(c.after, /\/decor\/songs\/turntable\/arm\.webp/);
  assert.ok(Math.abs(c.art.x1 - c.art.x0 - (c.art.y1 - c.art.y0) * (c.H / c.W)) < 0.01, "the record is a circle");
  near(c.img.cx, (c.art.x1 - c.art.x0) * 0.505, 0.006, "the cover is on the record's hole, a little right of the middle of its own frame as the hole is");
  assert.ok(c.art.x0 > 0.04 && c.art.x1 < 0.7, "the record is on the platter, the left part of the player");
  assert.ok(c.text.y0 > 0.55, "the words are on the sleeve under the player");
  assert.deepEqual(c.bars.map((b) => /\/decor\/songs\/turntable\/[a-z0-9-]+\.webp/.test(b.image) && b.anim === "song-note"), [true, true, true, true], "four things float up");
  assert.ok(c.fits);
});

test("handheld: pixel letters and the cover on the console's green screen, a few icons blinking", { skip }, async () => {
  const c = await look("handheld");
  assert.match(c.font, /Press Start 2P/);
  assert.match(c.before, /\/decor\/songs\/handheld\/body\.webp/, "the console");
  assert.ok(c.cardBg !== "rgba(0, 0, 0, 0)", "the screen's green and the console's color are the card's own, under the picture");
  assert.ok(c.art.x0 >= 0.145 && c.art.x1 <= 0.855 && c.art.y0 >= 0.134 && c.art.y1 <= 0.494, "the cover is inside the screen's window");
  assert.ok(c.text.x0 >= 0.145 && c.text.x1 <= 0.855 && c.text.y0 >= 0.134 && c.text.y1 <= 0.494, "and so are the words");
  assert.ok(c.textFits, "the words fit on the screen");
  const shown = c.bars.filter((b) => b.shown);
  assert.equal(shown.length, 3, "three icons (the cat is not used)");
  for (const b of shown) assert.ok(b.x0 >= 0.6 && b.x1 <= 0.855 && b.y0 >= 0.134 && b.y1 <= 0.3, "each icon is on the screen's top row");
  assert.ok(c.fits);
});

test("kawaii: the cover inside cat-ear headphones that overlap a pill, a paw peeking over it, little pictures floating up", { skip }, async () => {
  const c = await look("kawaii");
  assert.match(c.artAfter, /\/decor\/songs\/catears\/frame\.webp/, "the headphones are drawn over the cover");
  assert.match(c.textAfter, /\/decor\/songs\/catears\/paw\.webp/, "the paw");
  near(c.art.x1 - c.art.x0, 7.6 * c.em / c.W, 0.01, "the headphones are 7.6 em wide");
  assert.ok(c.img.x0 > 0 && c.img.x1 < c.art.x1 - c.art.x0, "the cover is inside them");
  near(c.img.cx, (c.art.x1 - c.art.x0) / 2, 0.005, "in the middle");
  assert.ok(c.text.x0 < c.art.x1, "the pill goes under the headphones' edge");
  assert.deepEqual(c.bars.map((b) => b.anim), ["song-note", "song-note", "song-note", "song-note"], "four pictures floating up");
  assert.ok(c.bars.every((b) => /\/decor\/songs\/catears\/[a-z0-9-]+\.webp/.test(b.image)));
  assert.ok(c.fits);
});

test("polaroid: the cover in the paper frame's window, the words on its wide strip, tape across the top", { skip }, async () => {
  const c = await look("polaroid");
  assert.notEqual(c.transform, "none", "tilted");
  assert.match(c.before, /\/decor\/songs\/polaroid\/frame\.webp/, "the frame is over the cover, so the cover shows through its window");
  assert.match(c.after, /\/decor\/songs\/polaroid\/tape-1\.webp/, "the tape");
  assert.ok(c.art.x0 >= 0.08 && c.art.x1 <= 0.92 && c.art.y0 >= 0.07 && c.art.y1 <= 0.76, "the cover fills the window");
  assert.ok(c.text.y0 >= 0.75 && c.text.y1 <= 1, "the words are on the strip under it");
  assert.ok(c.textFits);
  assert.deepEqual(c.bars.map((b) => /\/decor\/songs\/polaroid\/[a-z0-9-]+\.webp/.test(b.image)), [true, true, true, true], "two stickers, a clip and a pin");
  assert.ok(c.fits);
});

test("neon: a glowing sign whose frame stretches, a dim sunset inside it, glowing icons that pulse, a title that flickers a little", { skip }, async () => {
  const c = await look("neon");
  assert.equal(c.titleAnim, "song-flicker");
  assert.match(c.borderImage, /\/decor\/songs\/neon\/frame\.webp/, "the sign");
  assert.match(c.before, /\/decor\/songs\/neon\/sunset\.webp/, "the sunset");
  assert.deepEqual(c.bars.map((b) => b.anim), ["song-pulse", "song-pulse", "song-pulse", "song-pulse"], "four icons pulse");
  assert.ok(c.bars.every((b) => /\/decor\/songs\/neon\/[a-z0-9-]+\.webp/.test(b.image)));
  assert.ok(c.fits);
});

test("every picture a design asks for loads, and each one is only asked for from its own design", { skip }, async () => {
  for (const layout of ["cassette", "turntable", "handheld", "kawaii", "polaroid", "neon"]) {
    const c = await look(layout);
    const urls = [...new Set(pictures(c))];
    assert.ok(urls.length >= 4, `${layout} asks for pictures`);
    for (const url of urls) assert.ok(url.startsWith(`/decor/songs/${layout === "kawaii" ? "catears" : layout}/`), `${layout}: ${url} belongs to it`);
    const loaded = await page.evaluate(`(async () => { const out = []; for (const url of ${JSON.stringify(urls)}) { const res = await fetch(url); const bitmap = res.ok ? await createImageBitmap(await res.blob()) : null; out.push([url, res.status, bitmap ? bitmap.width : 0]); } return JSON.stringify(out); })()`).then(JSON.parse);
    for (const [url, status, width] of loaded) assert.ok(status === 200 && width > 0, `${url}: ${status}, ${width} px wide`);
  }
});

test("they work with the queue below, a different cover shape, a blurred cover, and no cover", { skip }, async () => {
  for (const layout of ["cassette", "turntable", "handheld", "kawaii", "polaroid", "neon"]) {
    await page.goto(`${base}/overlay/songs/?demo=1&layout=${layout}&show=both&pace=400&size=24`, { settle: 500 });
    await page.waitFor(`document.querySelectorAll(".songs__rows .song").length >= 2`, { timeout: 15000 });
    assert.equal(await page.evaluate(`document.querySelectorAll(".songs__now .song--now").length`), 1, `${layout}: the song playing and the queue`);
    await page.goto(`${base}/overlay/songs/?demo=1&layout=${layout}&show=now&size=24&coverBlur=1`, { settle: 400 });
    await page.waitFor(`document.querySelector(".songs__now .song--now")`, { timeout: 15000 });
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector(".song--now .song__bg")).display`), "none", `${layout}: the blurred cover would show through the pictures' windows, so it is left out`);
    await page.goto(`${base}/overlay/songs/?demo=1&layout=${layout}&show=now&size=24&coverShape=none`, { settle: 400 });
    await page.waitFor(`document.querySelector(".songs__now .song--now")`, { timeout: 15000 });
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector(".song--now .song__art")).display`), "none", `${layout}: no cover when asked`);
  }
  assert.deepEqual(page.problems.filter((p) => !/cloudflare|Content Security|status of 404/i.test(p)), [], "nothing complained");
});
