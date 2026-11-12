// The "Ideas for a paid plan" section on /overlays/, in a real headless Chrome: four ideas with an "I would use this" button each, a tap is counted once per idea
// (anonymously, with the page it was on), a second tap or a reload does not count again, nothing is sent for Do Not Track, and nothing is for sale.
// Skipped on a computer with no Chrome or Edge.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch } from "../scripts/lib/chrome.mjs";
import { createStatic } from "../scripts/lib/static.mjs";
import { PLUS_FEATURES } from "../src/js/stats-events.js";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "overlays", "index.html"))) throw new Error("dist/ has no overlays page. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

let server;
let base;
let page;
let installed = null;
before(async () => {
  if (skip) return;
  server = http.createServer(createStatic(dist));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  page = await launch();
  await page.viewport(1100, 900);
});
after(async () => {
  await page?.close();
  server?.closeAllConnections?.();
  server?.close();
});

/** Opens the page with a pretend beacon (what would be sent is written down); `fresh` also forgets what this browser remembered. */
async function open({ dnt = false, fresh = true } = {}) {
  if (installed) await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: installed });
  if (fresh) {
    await page.goto(`${base}/privacy/`, { settle: 100 });
    await page.evaluate("sessionStorage.clear(); localStorage.clear()");
  }
  installed = (await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    window.__beacons = [];
    navigator.sendBeacon = (url, body) => { window.__beacons.push({ url, body: String(body) }); return true; };
    ${dnt ? 'Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true });' : ""}
  })()` })).identifier;
  await page.goto(`${base}/overlays/`, { settle: 500 });
}
const plusBeacons = async () => (await page.evaluate("window.__beacons")).filter((b) => b.body.includes("plus_interest")).map((b) => b.body);
const button = (feature) => `document.querySelector('[data-plus="${feature}"]')`;

test("the section offers one idea for each thing the stats page counts, with a button that script switches on", { skip }, async () => {
  await open();
  const features = await page.evaluate(`[...document.querySelectorAll("[data-plus]")].map((b) => b.dataset.plus)`);
  assert.deepEqual(features, PLUS_FEATURES, "the four ideas the stats page has names for, in its order");
  assert.equal(await page.evaluate(`[...document.querySelectorAll("[data-plus]")].every((b) => !b.hidden && b.offsetParent !== null && b.textContent.trim() === "I would use this")`), true);
  assert.equal(await page.evaluate(`document.getElementById("plus-ideas").textContent.trim()`), "Ideas for a paid plan");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("a tap is counted once with the idea and the page, the button says thanks, and a second tap or a reload does not count again", { skip }, async () => {
  await open();
  await page.evaluate(`${button("remote_link")}.click()`);
  assert.deepEqual(await plusBeacons(), ['{"e":"plus_interest","a":"remote_link","b":"overlays"}']);
  assert.equal(await page.evaluate(`${button("remote_link")}.textContent.trim()`), "Noted, thank you");
  assert.equal(await page.evaluate(`${button("remote_link")}.getAttribute("aria-pressed")`), "true");
  await page.evaluate(`${button("remote_link")}.click()`);
  assert.equal((await plusBeacons()).length, 1, "a second tap on the same idea is not counted");
  for (const feature of PLUS_FEATURES.slice(1)) await page.evaluate(`${button(feature)}.click()`);
  assert.deepEqual((await plusBeacons()).map((b) => JSON.parse(b).a), PLUS_FEATURES, "each idea counted exactly once");
  await open({ fresh: false });
  assert.equal(await page.evaluate(`[...document.querySelectorAll("[data-plus]")].every((b) => b.getAttribute("aria-pressed") === "true")`), true, "a reload remembers what was tapped");
  await page.evaluate(`${button("plus_pack")}.click()`);
  assert.deepEqual(await plusBeacons(), [], "and does not count it again");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("nothing is sent for a visitor with Do Not Track, and the button still answers", { skip }, async () => {
  await open({ dnt: true });
  await page.evaluate(`${button("scene_link")}.click()`);
  assert.deepEqual(await page.evaluate("window.__beacons"), []);
  assert.equal(await page.evaluate(`${button("scene_link")}.textContent.trim()`), "Noted, thank you");
});

test("the section does not sell or promise anything", () => {
  const html = readFileSync(join(dist, "overlays", "index.html"), "utf8");
  const section = html.slice(html.indexOf('id="plus-ideas"'), html.indexOf('class="article__foot"'));
  assert.match(section, /ideas, not promises/);
  assert.match(section, /counted anonymously/);
  assert.doesNotMatch(section, /\$|€|£|per month|price|buy now|subscribe|forever|limited time/i);
});
