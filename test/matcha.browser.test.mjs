// The matcha page's "More options" in a real headless Chrome: each option changes all six styles live, the palette and the options
// work together, the link carries only what changed (and the overlay page paints the same from it), and the choices are remembered.
// Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createStatic } from "../scripts/lib/static.mjs";
import { MATCHA_PALETTES } from "../src/js/matcha.js";

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
  await page.viewport(1280, 900);
});
after(async () => {
  await page?.close();
  server?.closeAllConnections?.();
  server?.close();
});

const set = (id, value, event = "input") => page.evaluate(`(() => { const i = document.getElementById(${JSON.stringify(id)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); })()`);
const toggle = (id) => page.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
const click = (selector, text) => page.evaluate(`(() => { const list = [...document.querySelectorAll(${JSON.stringify(selector)})]; const el = ${text ? `list.find((e) => e.textContent.trim() === ${JSON.stringify(text)})` : "list[0]"}; if (!el) throw new Error("nothing to click: ${selector}"); el.click(); })()`);
const stages = (name) => page.evaluate(`[...document.querySelectorAll(".matcha-card .chatstage")].map((s) => s.style.getPropertyValue(${JSON.stringify(name)}))`);
const fresh = async () => {
  await page.goto(base + "/matcha/", { settle: 500 });
  await page.evaluate("localStorage.clear()");
  await page.goto(base + "/matcha/", { settle: 900 });
  await page.evaluate(`document.querySelector(".matcha-more").open = true`);
};

test("matcha: More options is there, closed at first, and holds the colours and everything the editor offers", { skip }, async () => {
  await page.goto(base + "/matcha/", { settle: 500 });
  await page.evaluate("localStorage.clear()");
  await page.goto(base + "/matcha/", { settle: 900 });
  assert.equal(await page.evaluate(`document.querySelector(".matcha-more").open`), false);
  assert.equal(await page.evaluate(`document.querySelector(".matcha-more > summary").textContent.trim()`), "More options");
  const labels = await page.evaluate(`[...document.querySelectorAll("#more-controls .ctl__label")].map((l) => l.textContent.trim())`);
  for (const wanted of ["Matcha green", "Deep green", "Cream", "Soft green", "Text colour", "Gift colour", "Text size", "Font", "Roundness", "Box opacity", "Entrance", "Entrance speed", "Show picture", "Use profile pictures", "Messages on screen", "Time on screen", "Spacing", "Viewers' own name colours", "Show emotes"]) {
    assert.ok(labels.includes(wanted), `${wanted} is missing; there is ${labels.join(", ")}`);
  }
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("matcha: a colour, the size, the corners, the font and the entrance change all six styles at once", { skip }, async () => {
  await fresh();
  assert.deepEqual(new Set(await stages("--matcha")), new Set([MATCHA_PALETTES.latte.matcha]));
  await set("m-matcha", "#e0629a");
  assert.deepEqual(new Set(await stages("--matcha")), new Set(["#e0629a"]));
  assert.equal(await page.evaluate(`document.querySelectorAll("#palettes .chip[aria-pressed=true]").length`), 0, "no palette looks pressed once a colour is changed");

  await set("m-scale", "150");
  assert.deepEqual(new Set(await stages("--m-scale")), new Set(["1.5"]));
  const size = await page.evaluate(`getComputedStyle(document.querySelector("#stage-latte .m")).fontSize`);
  assert.equal(size, "24px", "Matcha Latte's 16px text is now 150%");

  await set("m-round", "0");
  const radius = await page.evaluate(`getComputedStyle(document.querySelector("#stage-latte .body")).borderTopLeftRadius`);
  assert.equal(radius, "0px");

  await set("m-font", "Baloo 2", "change");
  await page.waitFor(`document.querySelector("#stage-latte .chatstage").style.getPropertyValue("--m-font").includes("Baloo 2")`);
  assert.match(await page.evaluate(`getComputedStyle(document.querySelector("#stage-glass .m")).fontFamily`), /Baloo 2/);
  assert.equal(await page.evaluate(`document.querySelector("#stage-pixel .chatstage").dataset.font`), "custom");
  await set("m-font", "", "change");
  await page.waitFor(`document.querySelector("#stage-latte .chatstage").style.getPropertyValue("--m-font") === ""`);
  assert.match(await page.evaluate(`getComputedStyle(document.querySelector("#stage-latte .m")).fontFamily`), /Fredoka/, "back to the style's own");

  await set("m-anim", "fade", "change");
  await set("m-speed", "600");
  assert.deepEqual(new Set(await stages("--m-anim")), new Set(["fade"]));
  assert.deepEqual(new Set(await stages("--m-speed")), new Set(["600ms"]));
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector("#stage-sticker .m")).animationName`), "fade");
  await set("m-anim", "", "change");
  assert.deepEqual(new Set(await stages("--m-anim")), new Set([""]), "the style's own entrance again");
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector("#stage-sticker .m")).animationName`), "pop");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("matcha: box opacity, spacing, the round picture and profile pictures can each be switched", { skip }, async () => {
  await fresh();
  await set("m-opacity", "50");
  assert.equal((await stages("--bg-fill"))[0], "rgba(245,240,225,0.5)");
  await set("m-space", "20");
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector("#stage-latte .chatbox")).rowGap`), "20px");
  await toggle("m-avatar");
  assert.deepEqual(new Set(await page.evaluate(`[...document.querySelectorAll(".matcha-card .chatstage")].map((s) => s.dataset.avatar)`)), new Set(["off"]));
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector("#stage-latte .av")).display`), "none");
  await toggle("m-avatar");
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector("#stage-latte .av")).display`), "grid");
  await set("m-max", "3");
  await page.waitFor(`document.querySelectorAll("#stage-latte .m:not(.leaving)").length <= 3`);
});

test("matcha: a palette sets all six colours again, and the options sit on top of it", { skip }, async () => {
  await fresh();
  await set("m-matcha", "#e0629a");
  await click("#palettes .chip", "Forest");
  assert.equal(await page.evaluate(`document.getElementById("m-matcha").value`), MATCHA_PALETTES.forest.matcha, "the colour picker shows the palette's colour again");
  assert.deepEqual(new Set(await stages("--matcha")), new Set([MATCHA_PALETTES.forest.matcha]));
  assert.equal(await page.evaluate(`document.querySelector("#palettes .chip[aria-pressed=true]").textContent.trim()`), "Forest");
  await set("m-pop", "#101010");
  await click("#palettes .chip", "Night");
  assert.equal(await page.evaluate(`document.getElementById("m-pop").value`), MATCHA_PALETTES.night.pop);
});

test("matcha: the link carries only what changed, and the overlay paints the same from it", { skip }, async () => {
  await fresh();
  await set("source-channel", "pond.pal");
  await click("#palettes .chip", "Sakura");
  await click(".matcha-card:nth-child(3) .btn", "Use this style");
  await set("m-matcha", "#e0629a");
  await set("m-scale", "125");
  await set("m-font", "Fredoka", "change");
  await set("m-anim", "pop", "change");
  await toggle("m-pictures");
  const link = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(link.pathname, "/overlay/");
  const q = link.searchParams;
  assert.equal(q.get("style"), "sticker");
  assert.equal(q.get("palette"), "sakura");
  assert.equal(q.get("matcha"), "#e0629a");
  assert.equal(q.get("scale"), "125");
  assert.equal(q.get("font"), "Fredoka");
  assert.equal(q.get("anim"), "pop");
  assert.equal(q.get("pictures"), "0");
  assert.equal(q.has("deep"), false, "colours that still match the palette stay out of the link");
  assert.equal(q.has("round"), false);

  await page.goto(base + link.pathname + link.search + "&demo=1", { settle: 900 });
  const stage = (name) => page.evaluate(`document.getElementById("stage").style.getPropertyValue(${JSON.stringify(name)})`);
  assert.equal(await stage("--matcha"), "#e0629a");
  assert.equal(await stage("--m-scale"), "1.25");
  assert.match(await stage("--m-font"), /Fredoka/);
  assert.equal(await stage("--m-anim"), "pop");
  assert.equal(await page.evaluate(`document.getElementById("stage").classList.contains("look-sticker")`), true);
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector("#chat .m")).fontSize`), "20px", "16px at 125%");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("matcha: the choices are remembered, a link wins over them, and Reset puts the options back", { skip }, async () => {
  await fresh();
  await click("#palettes .chip", "Sakura");
  await set("m-matcha", "#e0629a");
  await set("m-scale", "130");
  await click(".matcha-card:nth-child(4) .btn", "Use this style");
  await page.goto(base + "/matcha/", { settle: 900 });
  assert.equal(await page.evaluate(`document.getElementById("m-matcha").value`), "#e0629a", "remembered after a reload");
  assert.equal(await page.evaluate(`document.getElementById("m-scale").value`), "130");
  assert.equal(await page.evaluate(`document.querySelector(".matcha-card[data-picked=true] h2").textContent`), "4 · Pixel Pond");

  await page.goto(base + "/matcha/?style=night&scale=90", { settle: 900 });
  assert.equal(await page.evaluate(`document.querySelector(".matcha-card[data-picked=true] h2").textContent`), "6 · Night Matcha", "the link's style wins");
  assert.equal(await page.evaluate(`document.getElementById("m-scale").value`), "90", "and its size");
  assert.equal(await page.evaluate(`document.getElementById("m-matcha").value`), "#e0629a", "what the link did not mention is still remembered");

  await page.evaluate(`document.querySelector(".matcha-more").open = true`);
  await click("#more-reset");
  assert.equal(await page.evaluate(`document.getElementById("m-scale").value`), "100");
  assert.equal(await page.evaluate(`document.getElementById("m-matcha").value`), MATCHA_PALETTES.sakura.matcha, "colours go back to the palette picked");
  assert.equal(await page.evaluate(`document.querySelector(".matcha-card[data-picked=true] h2").textContent`), "6 · Night Matcha", "the style stays");
  assert.equal(await page.evaluate(`document.querySelector("#palettes .chip[aria-pressed=true]").textContent.trim()`), "Sakura");
  await page.evaluate("localStorage.clear()");
});

test("matcha: with More options open the page still doesn't scroll sideways or wrap its buttons, down to 320 px", { skip }, async () => {
  for (const width of [320, 375, 768, 1280]) {
    await page.viewport(width, 900);
    await fresh();
    const r = await page.evaluate(`({ scroll: document.documentElement.scrollWidth, inner: innerWidth, wrapped: [...document.querySelectorAll(".matcha-more .btn, .matcha-more .chip")].filter((el) => el.offsetParent && el.getClientRects().length && el.getBoundingClientRect().height > 60).map((el) => el.textContent.trim()) })`);
    assert.ok(r.scroll <= r.inner, `${r.scroll}px wide at ${width}px`);
    assert.deepEqual(r.wrapped, [], `a button wraps at ${width}px`);
  }
  await page.viewport(1280, 900);
});

test("matcha: junk in what was remembered, or in the address, can't break the page", { skip }, async () => {
  await page.goto(base + "/matcha/", { settle: 500 });
  await page.evaluate(`localStorage.setItem("frills:matcha:v1", JSON.stringify({ settings: { style: "<b>", palette: "__proto__", matcha: "javascript:1", scale: 99999, font: "<img>", anim: {}, avatar: "yes" }, channel: "<script>", platform: "ftp" }))`);
  await page.goto(base + "/matcha/?palette=constructor&scale=abc&pictures=%3Cb%3E", { settle: 900 });
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
  assert.equal(await page.evaluate(`document.querySelectorAll(".matcha-card").length`), 6);
  assert.equal(await page.evaluate(`document.getElementById("m-scale").value`), "180", "out-of-range values are pulled back into range");
  assert.equal(await page.evaluate(`document.getElementById("m-matcha").value`), MATCHA_PALETTES.latte.matcha);
  await page.evaluate("localStorage.clear()");
});
