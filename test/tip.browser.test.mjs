// The Quick start suggestion in a real headless Chrome: that it comes just after the page loads, quietly, covers nothing and takes no focus, how it closes,
// and how often it comes back. Skipped on a computer with no Chrome or Edge. `npm test` builds first.

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A fresh visitor: nothing remembered (the page is opened once on the site to be allowed to clear its storage). */
async function fresh(path = "/") {
  await page.goto(`${base}/privacy/`, { settle: 200 });
  await page.evaluate(`localStorage.clear(); sessionStorage.clear()`);
  await page.goto(`${base}${path}`, { settle: 100 });
}
const appears = () => page.waitFor(`document.querySelector(".tip")`, { timeout: 4000 });
const tipShown = () => page.evaluate(`Boolean(document.querySelector(".tip"))`);
const memory = () => page.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}) ?? "null")`);
const stays = async (ms = 2500) => { await sleep(ms); return !(await tipShown()); };

test("it comes just after the page has loaded, by itself, with no scrolling, and fades in rather than jumping", { skip }, async () => {
  await fresh();
  assert.equal(await tipShown(), false, "not in the first blink");
  await appears();
  const tip = await page.evaluate(`(() => { const t = document.querySelector(".tip"); const r = t.getBoundingClientRect(); const s = getComputedStyle(t); return { text: t.innerText.replace(/\\s+/g, " ").trim(), cta: t.querySelector("a").getAttribute("href"), ctaText: t.querySelector("a").textContent.trim(), close: Boolean(t.querySelector(".tip__close")), later: [...t.querySelectorAll("button")].some((b) => b.textContent === "Not now"), inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, width: Math.round(r.width), height: Math.round(r.height), focus: document.activeElement.tagName, label: t.getAttribute("aria-label"), closeLabel: t.querySelector(".tip__close").getAttribute("aria-label"), scrolled: scrollY, animation: s.animationName, border: s.borderTopWidth }; })()`);
  assert.match(tip.text, /New here\? Get your overlay links in 6 quick questions/);
  assert.equal(tip.cta, "/start/");
  assert.equal(tip.ctaText, "Try the Quick start →");
  assert.ok(tip.close && tip.later, "it can be closed two ways");
  assert.ok(tip.inside && tip.width <= 320 && tip.height <= 120, `small and fully on screen (${tip.width} x ${tip.height} px)`);
  assert.equal(tip.focus, "BODY", "it does not take the keyboard focus");
  assert.equal(tip.scrolled, 0, "nobody had to scroll");
  assert.ok(tip.label && tip.closeLabel, "it has names for a screen reader");
  assert.equal(tip.animation, "tip-in", "it fades in");
  assert.equal(tip.border, "1px", "a thin line, not a heavy box");
  assert.equal((await memory()).shown, 1, "it counts that it was shown");
});

test("it is quiet: a small corner card with no heavy box or buttons, covering no content and no menu, and the page still scrolls under it", { skip }, async () => {
  await fresh();
  await appears();
  const look = await page.evaluate(`(() => { const t = document.querySelector(".tip"); const r = t.getBoundingClientRect(); const nav = document.querySelector("[data-nav]").getBoundingClientRect(); const s = getComputedStyle(t); return { position: s.position, overNav: !(r.right < nav.left || r.left > nav.right || r.bottom < nav.top || r.top > nav.bottom), sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth, bigButtons: t.querySelectorAll(".btn").length, area: Math.round(r.width * r.height), screen: innerWidth * innerHeight }; })()`);
  assert.equal(look.position, "fixed");
  assert.equal(look.overNav, false, "it stays out of the menu");
  assert.equal(look.sideways, false);
  assert.equal(look.bigButtons, 0, "plain text links, not big yellow buttons");
  assert.ok(look.area / look.screen < 0.05, "a small part of the screen (under 5%)");
  await page.evaluate(`window.scrollTo(0, 800)`);
  assert.equal(await page.evaluate(`window.scrollY > 0`), true);
});

test("Not now closes it and it stays away for a month; the close button and Escape do the same", { skip }, async () => {
  await fresh();
  await appears();
  await page.evaluate(`[...document.querySelectorAll(".tip button")].find((b) => b.textContent === "Not now").click()`);
  assert.equal(await tipShown(), false);
  const note = await memory();
  assert.ok(note.closedAt > 0 && note.shown === 1, "it remembers it was closed");
  await page.goto(`${base}/`, { settle: 300 });
  assert.equal(await stays(), true, "closed: it does not come back");
  await fresh(); // the cross
  await appears();
  await page.evaluate(`document.querySelector(".tip__close").click()`);
  assert.equal(await tipShown(), false);
  assert.ok((await memory()).closedAt > 0);
  await fresh(); // Escape, when the keyboard is on the card
  await appears();
  await page.evaluate(`document.querySelector(".tip a").focus()`);
  await page.evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  assert.equal(await tipShown(), false, "Escape closes it");
  assert.ok((await memory()).closedAt > 0);
});

test("it shows once in a visit even if it was ignored, and not a third time ever", { skip }, async () => {
  await fresh();
  await appears();
  await page.goto(`${base}/overlays/`, { settle: 300 }); // the visit goes on, the card was ignored
  assert.equal(await stays(), true, "not again in the same visit");
  assert.equal((await memory()).shown, 1);
  await page.evaluate(`sessionStorage.clear()`); // a new visit
  await page.goto(`${base}/`, { settle: 100 });
  await appears();
  assert.equal((await memory()).shown, 2, "a second time, in a new visit");
  await page.evaluate(`sessionStorage.clear(); localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify({ shown: 2, closedAt: 0, done: false }))`);
  await page.goto(`${base}/`, { settle: 300 });
  assert.equal(await stays(), true, "never a third time");
});

test("opening the Quick start from it ends it for good", { skip }, async () => {
  await fresh();
  await appears();
  await page.evaluate(`document.querySelector(".tip a").click()`);
  await page.waitFor(`location.pathname === "/start/"`);
  assert.equal((await memory()).done, true);
  await page.evaluate(`sessionStorage.clear()`);
  await page.goto(`${base}/`, { settle: 300 });
  assert.equal(await stays(), true);
});

test("someone who has used an editor sees it too (it is for anyone who has not tried the Quick start), but only on the pages it is meant for", { skip }, async () => {
  await fresh();
  await page.evaluate(`localStorage.setItem("frills:editor:v1", "{}")`);
  await page.goto(`${base}/`, { settle: 100 });
  await appears();
  for (const path of ["/start/", "/editor/", "/gifts/", "/privacy/", "/changelog/", "/overlay/?demo=1"]) {
    await fresh(path);
    assert.equal(await stays(1800), true, path + " stays free of it");
  }
});

test("it waits while someone is typing, and then comes", { skip }, async () => {
  await fresh();
  await page.evaluate(`(() => { const i = document.createElement("input"); i.id = "typing"; document.body.prepend(i); i.focus(); })()`);
  assert.equal(await stays(2600), true, "not while a text box has the keyboard");
  await page.evaluate(`document.getElementById("typing").blur()`);
  await page.waitFor(`document.querySelector(".tip")`, { timeout: 8000 });
});

test("?tip=show shows it at once to anyone, however much is remembered, and writes nothing down; only on the pages it is meant for", { skip }, async () => {
  await fresh();
  await page.evaluate(`localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify({ shown: 2, closedAt: Date.now(), done: true }))`);
  await page.goto(`${base}/?tip=show`, { settle: 100 });
  await page.waitFor(`document.querySelector(".tip")`, { timeout: 3000 });
  const before = await page.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`);
  await page.evaluate(`document.querySelector(".tip__close").click()`);
  assert.equal(await tipShown(), false, "it closes");
  assert.equal(await page.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`), before, "and nothing was written");
  await page.goto(`${base}/guides/obs/?tip=show`, { settle: 100 });
  await page.waitFor(`document.querySelector(".tip")`, { timeout: 3000 });
  for (const path of ["/editor/?tip=show", "/start/?tip=show", "/privacy/?tip=show"]) {
    await page.goto(`${base}${path}`, { settle: 600 });
    assert.equal(await tipShown(), false, path);
  }
});

test("on a phone-sized screen it is a small card at the bottom that fits, with a close button for a thumb; with reduced motion it just appears", { skip }, async () => {
  await page.viewport(390, 844);
  await fresh();
  await appears();
  const phone = await page.evaluate(`(() => { const r = document.querySelector(".tip").getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom), height: Math.round(r.height), sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth, button: Math.round(document.querySelector(".tip__close").getBoundingClientRect().width) }; })()`);
  assert.ok(phone.left >= 8 && phone.right >= 8 && phone.bottom >= 8, JSON.stringify(phone));
  assert.ok(phone.height <= 170, `still small on a phone (${phone.height} px)`);
  assert.equal(phone.sideways, false);
  assert.ok(phone.button >= 44, "a close button you can hit with a thumb");
  await page.viewport(1100, 800, { reducedMotion: true });
  await fresh();
  await appears();
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector(".tip")).animationName`), "none", "no movement for people who ask for less");
  await page.viewport(1100, 800);
});
