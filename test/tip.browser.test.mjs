// The Quick start suggestion in a real headless Chrome: when it shows, that it covers nothing and takes no focus, how it closes, and how often it comes
// back. Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch } from "../scripts/lib/chrome.mjs";
import { createStatic } from "../scripts/lib/static.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "start", "index.html"))) throw new Error("dist/ is empty. Run `npm run build` first (`npm test` does that for you).");
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
  await page.viewport(1100, 800);
});
after(async () => {
  await page?.close();
  server?.closeAllConnections?.();
  server?.close();
});

const KEY = "frills:quickstart-tip:v1";
/** A fresh visitor: nothing remembered (the page is opened once on the site to be allowed to clear its storage). */
async function fresh(path = "/") {
  await page.goto(`${base}/privacy/`, { settle: 200 });
  await page.evaluate(`localStorage.clear(); sessionStorage.clear()`);
  await page.goto(`${base}${path}`, { settle: 400 });
}
const scrollDown = () => page.evaluate(`window.scrollTo(0, document.documentElement.scrollHeight * 0.8)`);
const tipShown = () => page.evaluate(`Boolean(document.querySelector(".tip"))`);
const memory = () => page.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}) ?? "null")`);

test("it does not appear at once, and appears when most of the page has been read", { skip }, async () => {
  await fresh();
  assert.equal(await tipShown(), false, "not on arrival");
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(await tipShown(), false, "not after a couple of seconds either");
  await scrollDown();
  await page.waitFor(`document.querySelector(".tip")`);
  const tip = await page.evaluate(`(() => { const t = document.querySelector(".tip"); const r = t.getBoundingClientRect(); return { text: t.innerText.replace(/\\s+/g, " ").trim(), cta: t.querySelector("a").getAttribute("href"), ctaText: t.querySelector("a").textContent, close: Boolean(t.querySelector(".tip__close")), later: [...t.querySelectorAll("button")].some((b) => b.textContent === "Not now"), inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, width: Math.round(r.width), focus: document.activeElement.tagName, label: t.getAttribute("aria-label"), closeLabel: t.querySelector(".tip__close").getAttribute("aria-label") }; })()`);
  assert.match(tip.text, /New here\? Answer 6 quick questions/);
  assert.equal(tip.cta, "/start/");
  assert.equal(tip.ctaText, "Try the Quick start");
  assert.ok(tip.close && tip.later, "it can be closed two ways");
  assert.ok(tip.inside && tip.width <= 340, `a small card, fully on screen (${tip.width} px)`);
  assert.equal(tip.focus, "BODY", "it does not take the keyboard focus");
  assert.ok(tip.label && tip.closeLabel, "it has names for a screen reader");
  assert.equal((await memory()).shown, 1, "it counts that it was shown");
});

test("it also appears by itself after 15 seconds on the page, to someone who has not scrolled", { skip }, async () => {
  await fresh("/overlays/");
  await new Promise((r) => setTimeout(r, 14000));
  assert.equal(await tipShown(), false, "not yet at 14 seconds");
  await page.waitFor(`document.querySelector(".tip")`, { timeout: 4000 });
});

test("it covers nothing that matters: the page can still be clicked and read, and the main button stays clear", { skip }, async () => {
  await fresh();
  await scrollDown();
  await page.waitFor(`document.querySelector(".tip")`);
  const clear = await page.evaluate(`(() => { const t = document.querySelector(".tip").getBoundingClientRect(); const cover = (el) => { const r = el.getBoundingClientRect(); return !(r.right < t.left || r.left > t.right || r.bottom < t.top || r.top > t.bottom); }; return { scrolls: document.documentElement.scrollHeight > innerHeight, sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth, overNav: cover(document.querySelector("[data-nav]")), position: getComputedStyle(document.querySelector(".tip")).position, backdrop: document.querySelectorAll("[class*=overlay], [class*=backdrop], [class*=modal]").length }; })()`);
  assert.equal(clear.sideways, false);
  assert.equal(clear.overNav, false, "it stays out of the menu");
  assert.equal(clear.position, "fixed");
  await scrollDown(); // the page still scrolls under it
  assert.equal(await page.evaluate(`window.scrollY > 0`), true);
});

test("Not now closes it and it stays away for a month; the close button and Escape do the same", { skip }, async () => {
  await fresh();
  await scrollDown();
  await page.waitFor(`document.querySelector(".tip")`);
  await page.evaluate(`[...document.querySelectorAll(".tip button")].find((b) => b.textContent === "Not now").click()`);
  assert.equal(await tipShown(), false);
  const note = await memory();
  assert.ok(note.closedAt > 0 && note.shown === 1, "it remembers it was closed");
  await page.goto(`${base}/`, { settle: 300 });
  await scrollDown();
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(await tipShown(), false, "closed: it does not come back");
  // the cross
  await fresh();
  await scrollDown();
  await page.waitFor(`document.querySelector(".tip")`);
  await page.evaluate(`document.querySelector(".tip__close").click()`);
  assert.equal(await tipShown(), false);
  assert.ok((await memory()).closedAt > 0);
  // Escape, when the keyboard is on the card
  await fresh();
  await scrollDown();
  await page.waitFor(`document.querySelector(".tip")`);
  await page.evaluate(`document.querySelector(".tip a").focus()`);
  await page.evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  assert.equal(await tipShown(), false, "Escape closes it");
  assert.ok((await memory()).closedAt > 0);
});

test("it shows once in a visit even if it was ignored, and not a third time ever", { skip }, async () => {
  await fresh();
  await scrollDown();
  await page.waitFor(`document.querySelector(".tip")`);
  await page.goto(`${base}/overlays/`, { settle: 300 }); // the visit goes on, the card was ignored
  await scrollDown();
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(await tipShown(), false, "not again in the same visit");
  assert.equal((await memory()).shown, 1);
  await page.evaluate(`sessionStorage.clear()`); // a new visit
  await page.goto(`${base}/`, { settle: 300 });
  await scrollDown();
  await page.waitFor(`document.querySelector(".tip")`);
  assert.equal((await memory()).shown, 2, "a second time, in a new visit");
  await page.evaluate(`sessionStorage.clear(); localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify({ shown: 2, closedAt: 0, done: false }))`);
  await page.goto(`${base}/`, { settle: 300 });
  await scrollDown();
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(await tipShown(), false, "never a third time");
});

test("opening the Quick start from it ends it for good", { skip }, async () => {
  await fresh();
  await scrollDown();
  await page.waitFor(`document.querySelector(".tip")`);
  await page.evaluate(`document.querySelector(".tip a").click()`);
  await page.waitFor(`location.pathname === "/start/"`);
  assert.equal((await memory()).done, true);
  await page.evaluate(`sessionStorage.clear()`);
  await page.goto(`${base}/`, { settle: 300 });
  await scrollDown();
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(await tipShown(), false);
});

test("it stays away from someone who has already used an editor, from the Quick start itself, the editors, the overlays and the legal pages", { skip }, async () => {
  await fresh();
  await page.evaluate(`localStorage.setItem("frills:editor:v1", "{}")`);
  await page.goto(`${base}/`, { settle: 300 });
  await scrollDown();
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(await tipShown(), false, "they have used the editor");
  for (const path of ["/start/", "/editor/", "/gifts/", "/privacy/", "/changelog/", "/overlay/?demo=1"]) {
    await fresh(path);
    await scrollDown();
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(await tipShown(), false, path);
  }
});

test("on a phone-sized screen it is a card at the bottom that fits, and with reduced motion it just appears", { skip }, async () => {
  await page.viewport(390, 844);
  await fresh();
  await scrollDown();
  await page.waitFor(`document.querySelector(".tip")`);
  const phone = await page.evaluate(`(() => { const r = document.querySelector(".tip").getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom), sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth, button: Math.round(document.querySelector(".tip__close").getBoundingClientRect().width) }; })()`);
  assert.ok(phone.left >= 8 && phone.right >= 8 && phone.bottom >= 8, JSON.stringify(phone));
  assert.equal(phone.sideways, false);
  assert.ok(phone.button >= 44, "a close button you can hit with a thumb");
  await page.viewport(1100, 800, { reducedMotion: true });
  await fresh();
  await scrollDown();
  await page.waitFor(`document.querySelector(".tip")`);
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector(".tip")).animationName`), "none", "no movement for people who ask for less");
  await page.viewport(1100, 800);
});
