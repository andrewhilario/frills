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

// ── the other overlays wear the pictures too, not just the colors ─────────────────────────────────────────────────────────────

const pictures = (selector) => page.evaluate(`(async () => { const imgs = [...document.querySelectorAll(${JSON.stringify(selector + " img")})]; const ok = await Promise.all(imgs.map((i) => i.decode().then(() => i.naturalWidth > 0, () => false))); return JSON.stringify({ count: imgs.length, loaded: ok.filter(Boolean).length, folders: [...new Set(imgs.map((i) => new URL(i.src).pathname.split("/")[2]))] }); })()`).then(JSON.parse);

test("the gifts, goal, likers and songs overlays draw a season's pictures from their link, and accept nothing else", { skip }, async () => {
  for (const [path, root] of [["gifts", ".giftlist"], ["goal", ".goal"], ["likers", ".likers"], ["songs", ".songs"]]) {
    await page.goto(`${base}/overlay/${path}/?demo=1&deco=halloween`, { settle: 800 });
    assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(root)}).dataset.deco`), "halloween", `${path}: dressed`);
    assert.deepEqual(await pictures(`${root} .widget__deco`), { count: 5, loaded: 5, folders: ["halloween"] }, `${path}: a friend on the edge, a corner scene and three sparkles, all loaded`);
    await page.goto(`${base}/overlay/${path}/?demo=1&deco=christmas`, { settle: 800 });
    assert.deepEqual((await pictures(`${root} .widget__deco`)).folders, ["christmas"], `${path}: Christmas too`);
    for (const query of ["demo=1", "demo=1&deco=frog2", "demo=1&deco=none", "demo=1&deco=%3Cimg%3E"]) { // the private packs and anything else are not accepted
      await page.goto(`${base}/overlay/${path}/?${query}`, { settle: 600 });
      assert.equal(await page.evaluate(`document.querySelectorAll(".widget__deco").length`), 0, `${path}?${query}: no pictures`);
      assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(root)}).dataset.deco`), "none");
    }
  }
});

test("the alerts overlay draws the pictures on its cards from its link", { skip }, async () => {
  await page.goto(`${base}/overlay/alerts/?demo=1&deco=halloween&pace=600`, { settle: 800 });
  await page.waitFor(`document.querySelector(".alert__deco img")`, { timeout: 15000 });
  const seen = await pictures(".alert__deco");
  assert.ok(seen.count >= 5 && seen.count === seen.loaded && seen.folders.length === 1 && seen.folders[0] === "halloween");
});

test("a small overlay's editor: a seasonal look turns the pictures on and puts them in the link, None takes them off, and out of season only the usual choices show", { skip }, async () => {
  await open("/gifts/?season=halloween");
  assert.deepEqual(await chipNames('[aria-label="Seasonal pictures"]'), ["None", "Halloween"], "in season: none, or the season's pack (never the private ones)");
  assert.equal(await pressed('[aria-label="Seasonal pictures"]'), "None", "off until a seasonal look is chosen");
  await click("#looks .chip", "Witch's brew");
  assert.equal(await pressed('[aria-label="Seasonal pictures"]'), "Halloween", "the look brought its pictures");
  await page.waitFor(`document.querySelectorAll(".widget__deco img").length === 5`, { timeout: 8000 });
  await page.evaluate(`(() => { const i = document.querySelector("#source-channel"); i.value = "pond.pal"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  assert.equal(new URL(await page.evaluate(`document.getElementById("link").value`)).searchParams.get("deco"), "halloween");
  await click('[aria-label="Seasonal pictures"] .chip', "None");
  await page.waitFor(`document.querySelectorAll(".widget__deco img").length === 0`, { timeout: 8000 });
  assert.equal(new URL(await page.evaluate(`document.getElementById("link").value`)).searchParams.has("deco"), false, "off: the link carries nothing");
  await open("/gifts/?season=none");
  assert.equal(await page.evaluate(`document.querySelector('[aria-label="Seasonal pictures"]') ? JSON.stringify([...document.querySelectorAll('[aria-label="Seasonal pictures"] .chip')].map((c) => c.textContent.trim())) : "[]"`), JSON.stringify(["None"]), "between seasons: just None");
});

test("the alerts editor: a seasonal look turns its pictures on, and they show on the alert cards", { skip }, async () => {
  await open("/alerts/?season=christmas");
  assert.deepEqual(await chipNames('[aria-label="Seasonal pictures"]'), ["None", "Christmas"]);
  await click("#looks .chip", "Candy cane");
  assert.equal(await pressed('[aria-label="Seasonal pictures"]'), "Christmas");
  await page.evaluate(`document.querySelector('[data-test="follow"]').click()`);
  await page.waitFor(`document.querySelector(".alert__deco img")`, { timeout: 8000 });
  assert.deepEqual((await pictures(".alert__deco")).folders, ["christmas"]);
  const link = new URL(await page.evaluate(`(() => { const i = document.querySelector("#source-channel"); i.value = "pond.pal"; i.dispatchEvent(new Event("input", { bubbles: true })); return document.getElementById("link").value; })()`));
  assert.equal(link.searchParams.get("deco"), "christmas");
  assert.equal(link.searchParams.get("accent"), "#ffffff");
  // a private pack in an old link or saved setting is still not accepted by the public editor
  await open("/alerts/?season=none&deco=frog2");
  assert.equal(await page.evaluate(`document.querySelectorAll(".alert__deco img").length`), 0);
});
