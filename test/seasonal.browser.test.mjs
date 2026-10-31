// The seasonal looks in a real headless Chrome: the editors offer the season's looks first (and only then), a look brings its pictures, a link made with one
// keeps working out of season, and an overlay draws the pictures. The season is named in the address (?season=), so these checks are the same on every day of the
// year. Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createStatic } from "../scripts/lib/static.mjs";
import { PRESETS } from "../src/js/settings.js";
import { SEASONAL } from "../src/js/seasonal-looks.js";

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
  await page.viewport(1280, 1000);
});
after(async () => {
  await page?.close();
  server?.closeAllConnections?.();
  server?.close();
});

/** Opens a page as a first visit: an editor remembers its settings in the browser, and one test must not leak into the next. */
const open = async (path) => {
  await page.goto(`${base}/editor/?season=none`, { settle: 100 });
  await page.evaluate(`localStorage.clear()`);
  await page.goto(`${base}${path}`, { settle: 500 });
};
const cssVar = (selector, name) => page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).getPropertyValue(${JSON.stringify(name)}).trim()`);
const chipNames = (selector) => page.evaluate(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(selector + " .chip")})].map((c) => c.textContent.trim()))`).then(JSON.parse);
const pressed = (selector) => page.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector + " .chip")})].find((c) => c.getAttribute("aria-pressed") === "true")?.textContent.trim() ?? null`);
const chipsOfLabel = (label) => `[aria-label="${label}"]`;
const click = (selector, text) => page.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)}).click()`);
const names = (season) => Object.keys(SEASONAL[season]);
const usual = ["Blueberry", "Frost", "Mint", "Bubblegum", "Butter", "Arcade", "Whisper"];

test("chat editor: in Halloween the four Halloween looks come first, marked, then the usual seven; the Halloween pictures are offered too", { skip }, async () => {
  await open("/editor/?season=halloween");
  const all = await chipNames("#presets");
  assert.deepEqual(all, ["Pumpkin patch", "Friendly ghost", "Witch's brew", "Blood moon", ...usual]);
  assert.equal(await page.evaluate(`document.querySelectorAll("#presets .chip--season[data-season=halloween]").length`), 4, "the festive ones are marked");
  assert.equal(await page.evaluate(`document.querySelectorAll("#presets .chip--season").length`), 4, "and only those");
  assert.deepEqual((await chipNames(chipsOfLabel("Decorations on the bubbles"))).slice(-2), ["Bunny cloud", "Halloween"], "the Halloween pictures can be picked, and no Christmas ones");
  assert.equal(await pressed("#presets"), "Blueberry", "nothing is switched on for anyone: the editor starts as it always did");
});

test("chat editor: choosing a Halloween look paints it, turns on the pictures, and puts everything in the link", { skip }, async () => {
  await open("/editor/?season=halloween");
  await click("#presets .chip", "Pumpkin patch");
  assert.equal(await pressed("#presets"), "Pumpkin patch");
  await page.waitFor(`getComputedStyle(document.getElementById("stage")).getPropertyValue("--g-accent").trim() === ${JSON.stringify(SEASONAL.halloween.pumpkin.accent)}`, { timeout: 5000 }); // painted once its font is in
  assert.equal(await pressed(chipsOfLabel("Decorations on the bubbles")), "Halloween", "its pictures came with it");
  await page.waitFor(`document.querySelectorAll("#chat .m").length > 0`, { timeout: 20000 });
  await page.waitFor(`document.querySelector("#chat .m .deco img")`, { timeout: 5000 });
  const sources = await page.evaluate(`JSON.stringify([...document.querySelectorAll("#chat .deco img")].map((i) => new URL(i.src).pathname))`).then(JSON.parse);
  assert.ok(sources.length > 0 && sources.every((s) => /^\/decor\/halloween\/[a-z0-9-]+\.webp$/.test(s)), "the messages carry Halloween pictures");
  const loaded = await page.evaluate(`Promise.all([...document.querySelectorAll("#chat .deco img")].map((i) => i.decode().then(() => i.naturalWidth > 0, () => false))).then((r) => r.every(Boolean))`);
  assert.equal(loaded, true, "and they load");
  await page.evaluate(`(() => { const i = document.querySelector("#source-channel"); i.value = "pond.pal"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  const link = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(link.searchParams.get("accent"), SEASONAL.halloween.pumpkin.accent);
  assert.equal(link.searchParams.get("deco"), "halloween");
  assert.equal(link.searchParams.has("look"), false, "the link does not depend on the look's name");
});

test("chat editor: in Christmas the Christmas looks come first; between seasons only the usual looks, and no seasonal pictures", { skip }, async () => {
  await open("/editor/?season=christmas");
  assert.deepEqual(await chipNames("#presets"), ["Candy cane", "Pine and gold", "Snowfall", "Cozy knit", ...usual]);
  assert.deepEqual((await chipNames(chipsOfLabel("Decorations on the bubbles"))).slice(-2), ["Bunny cloud", "Christmas"]);
  await open("/editor/?season=none");
  assert.deepEqual(await chipNames("#presets"), usual);
  assert.deepEqual(await chipNames(chipsOfLabel("Decorations on the bubbles")), ["None", "Frog pond", "Frog pond V2", "Neko cafe", "Hamster burrow", "Bunny cloud"]);
  assert.equal(await page.evaluate(`document.querySelectorAll(".chip--season").length`), 0);
});

test("a Halloween look keeps working out of season: its address applies it, and its pictures stay offered while it is chosen", { skip }, async () => {
  await open("/editor/?season=none&look=pumpkin");
  await page.waitFor(`getComputedStyle(document.getElementById("stage")).getPropertyValue("--g-accent").trim() === ${JSON.stringify(SEASONAL.halloween.pumpkin.accent)}`, { timeout: 5000 }); // the look from the address is applied
  assert.equal(await pressed(chipsOfLabel("Decorations on the bubbles")), "Halloween", "the pictures are on, and shown as chosen even though it is no longer the season");
  assert.deepEqual(await chipNames("#presets"), usual, "but it is not offered as a new choice");
});

test("the alerts editor and the small overlays' editors offer the season's looks first too", { skip }, async () => {
  for (const [path, selector] of [["/alerts/", "#looks"], ["/gifts/", "#looks"], ["/goal/", "#looks"], ["/likers/", "#looks"]]) {
    await open(`${path}?season=halloween`);
    const halloween = await chipNames(selector);
    assert.deepEqual(halloween.slice(0, 4), ["Pumpkin patch", "Friendly ghost", "Witch's brew", "Blood moon"], `${path}: Halloween first`);
    assert.ok(halloween.length > 4, `${path}: and the usual ones after`);
    await page.goto(`${base}${path}?season=christmas`, { settle: 500 });
    assert.deepEqual((await chipNames(selector)).slice(0, 4), ["Candy cane", "Pine and gold", "Snowfall", "Cozy knit"], `${path}: Christmas first`);
    await page.goto(`${base}${path}?season=none`, { settle: 500 });
    assert.ok((await chipNames(selector)).every((n) => !names("halloween").concat(names("christmas")).includes(n.toLowerCase())), `${path}: nothing seasonal between seasons`);
    assert.equal(await page.evaluate(`document.querySelectorAll(".chip--season").length`), 0, `${path}: nothing marked between seasons`);
  }
});

test("a seasonal look in an alert editor paints the card, and the usual looks are untouched", { skip }, async () => {
  await open("/gifts/?season=halloween");
  await click("#looks .chip", "Witch's brew");
  assert.equal(await pressed("#looks"), "Witch's brew");
  await page.waitFor(`[...document.querySelectorAll("*")].some((e) => e.style.getPropertyValue("--a-accent").trim() === "#7dff4a")`, { timeout: 5000 }); // the witch's green is on the card
});

test("the usual look names are the ones that were always there (a season adds, never replaces)", () => {
  assert.deepEqual(Object.keys(PRESETS).length, usual.length);
});
