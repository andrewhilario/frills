// The matcha page (laid out like the editor: a live preview beside the steps) in a real headless Chrome: the six styles are a row of choices, each option
// under "More options" changes the preview live, the palette and the options work together, the link carries only what changed (and the overlay page paints
// the same from it), the frog pond alerts have their own tab and link, and the choices are remembered.
// Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs, { existsSync } from "node:fs";
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
const stages = (name) => page.evaluate(`[document.getElementById("stage")].map((s) => s.style.getPropertyValue(${JSON.stringify(name)}))`);
const pickStyle = (name) => click("#styles .chip", name);
const pickedStyle = () => page.evaluate(`document.querySelector("#styles .chip[aria-pressed=true]").textContent.trim()`);
const fresh = async () => {
  await page.goto(base + "/matcha/", { settle: 500 });
  await page.evaluate("localStorage.clear()");
  await page.goto(base + "/matcha/", { settle: 900 });
  await page.evaluate(`document.querySelector(".matcha-more").open = true`);
};

test("matcha: More options is there, closed at first, and holds the colors and everything the editor offers", { skip }, async () => {
  await page.goto(base + "/matcha/", { settle: 500 });
  await page.evaluate("localStorage.clear()");
  await page.goto(base + "/matcha/", { settle: 900 });
  assert.equal(await page.evaluate(`document.querySelector(".matcha-more").open`), false);
  assert.equal(await page.evaluate(`document.querySelector(".matcha-more > summary").textContent.trim()`), "More options");
  const labels = await page.evaluate(`[...document.querySelectorAll("#more-controls .ctl__label")].map((l) => l.textContent.trim())`);
  for (const wanted of ["Matcha green", "Deep green", "Cream", "Soft green", "Text color", "Gift color", "Text size", "Font", "Roundness", "Box opacity", "Entrance", "Entrance speed", "Show picture", "Use profile pictures", "Messages on screen", "Time on screen", "Spacing", "Viewers' own name colors", "Show emotes"]) {
    assert.ok(labels.includes(wanted), `${wanted} is missing; there is ${labels.join(", ")}`);
  }
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("matcha: a color, the size, the corners, the font and the entrance change the preview, in each style", { skip }, async () => {
  await fresh();
  assert.deepEqual(new Set(await stages("--matcha")), new Set([MATCHA_PALETTES.latte.matcha]));
  await set("m-matcha", "#e0629a");
  assert.deepEqual(new Set(await stages("--matcha")), new Set(["#e0629a"]));
  assert.equal(await page.evaluate(`document.querySelectorAll("#palettes .chip[aria-pressed=true]").length`), 0, "no palette looks pressed once a color is changed");

  await set("m-scale", "150");
  assert.deepEqual(new Set(await stages("--m-scale")), new Set(["1.5"]));
  const size = await page.evaluate(`getComputedStyle(document.querySelector("#stage .m")).fontSize`);
  assert.equal(size, "24px", "Matcha Latte's 16px text is now 150%");

  await set("m-round", "0");
  const radius = await page.evaluate(`getComputedStyle(document.querySelector("#stage .body")).borderTopLeftRadius`);
  assert.equal(radius, "0px");

  await set("m-font", "Baloo 2", "change");
  await page.waitFor(`document.querySelector("#stage").style.getPropertyValue("--m-font").includes("Baloo 2")`);
  await pickStyle("Matcha Glass");
  assert.match(await page.evaluate(`getComputedStyle(document.querySelector("#stage .m")).fontFamily`), /Baloo 2/);
  await pickStyle("Pixel Pond");
  assert.equal(await page.evaluate(`document.querySelector("#stage").dataset.font`), "custom");
  await pickStyle("Matcha Latte");
  await set("m-font", "", "change");
  await page.waitFor(`document.querySelector("#stage").style.getPropertyValue("--m-font") === ""`);
  assert.match(await page.evaluate(`getComputedStyle(document.querySelector("#stage .m")).fontFamily`), /Fredoka/, "back to the style's own");

  await set("m-anim", "fade", "change");
  await set("m-speed", "600");
  assert.deepEqual(new Set(await stages("--m-anim")), new Set(["fade"]));
  assert.deepEqual(new Set(await stages("--m-speed")), new Set(["600ms"]));
  await pickStyle("Cartoon Sticker");
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector("#stage .m")).animationName`), "fade");
  await set("m-anim", "", "change");
  assert.deepEqual(new Set(await stages("--m-anim")), new Set([""]), "the style's own entrance again");
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector("#stage .m")).animationName`), "pop");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("matcha: box opacity, spacing, the round picture and profile pictures can each be switched", { skip }, async () => {
  await fresh();
  await set("m-opacity", "50");
  assert.equal((await stages("--bg-fill"))[0], "rgba(245,240,225,0.5)");
  await set("m-space", "20");
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector("#stage .chatbox")).rowGap`), "20px");
  await toggle("m-avatar");
  assert.deepEqual(new Set(await page.evaluate(`[document.getElementById("stage")].map((s) => s.dataset.avatar)`)), new Set(["off"]));
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector("#stage .av")).display`), "none");
  await toggle("m-avatar");
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector("#stage .av")).display`), "grid");
  await set("m-max", "3");
  await page.waitFor(`document.querySelectorAll("#stage .m:not(.leaving)").length <= 3`);
});

test("matcha: a palette sets all six colors again, and the options sit on top of it", { skip }, async () => {
  await fresh();
  await set("m-matcha", "#e0629a");
  await click("#palettes .chip", "Forest");
  assert.equal(await page.evaluate(`document.getElementById("m-matcha").value`), MATCHA_PALETTES.forest.matcha, "the color picker shows the palette's color again");
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
  await pickStyle("Cartoon Sticker");
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
  assert.equal(q.has("deep"), false, "colors that still match the palette stay out of the link");
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
  await pickStyle("Pixel Pond");
  await page.goto(base + "/matcha/", { settle: 900 });
  assert.equal(await page.evaluate(`document.getElementById("m-matcha").value`), "#e0629a", "remembered after a reload");
  assert.equal(await page.evaluate(`document.getElementById("m-scale").value`), "130");
  assert.equal(await pickedStyle(), "Pixel Pond");
  assert.match(await page.evaluate(`document.getElementById("style-note").textContent`), /Pixel borders/, "and the line about it");

  await page.goto(base + "/matcha/?style=night&scale=90", { settle: 900 });
  assert.equal(await pickedStyle(), "Night Matcha", "the link's style wins");
  assert.equal(await page.evaluate(`document.getElementById("m-scale").value`), "90", "and its size");
  assert.equal(await page.evaluate(`document.getElementById("m-matcha").value`), "#e0629a", "what the link did not mention is still remembered");

  await page.evaluate(`document.querySelector(".matcha-more").open = true`);
  await click("#more-reset");
  assert.equal(await page.evaluate(`document.getElementById("m-scale").value`), "100");
  assert.equal(await page.evaluate(`document.getElementById("m-matcha").value`), MATCHA_PALETTES.sakura.matcha, "colors go back to the palette picked");
  assert.equal(await pickedStyle(), "Night Matcha", "the style stays");
  assert.equal(await page.evaluate(`document.querySelector("#palettes .chip[aria-pressed=true]").textContent.trim()`), "Sakura");
  await page.evaluate("localStorage.clear()");
});

test("matcha: with More options open the page still doesn't scroll sideways or wrap its buttons, down to 320 px", { skip }, async () => {
  for (const width of [320, 375, 768, 1280]) {
    await page.viewport(width, 900);
    await fresh();
    const r = await page.evaluate(`({ scroll: document.documentElement.scrollWidth, inner: innerWidth, wrapped: [...document.querySelectorAll(".matcha-more .btn, .matcha-more .chip, #styles .chip, #palettes .chip, #icons .chip, #decos .chip, .preview__tabs .chip")].filter((el) => el.offsetParent && el.getClientRects().length && el.getBoundingClientRect().height > 60).map((el) => el.textContent.trim()) })`);
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
  assert.equal(await page.evaluate(`document.querySelectorAll("#styles .chip").length`), 6);
  assert.equal(await page.evaluate(`document.getElementById("m-scale").value`), "180", "out-of-range values are pulled back into range");
  assert.equal(await page.evaluate(`document.getElementById("m-matcha").value`), MATCHA_PALETTES.latte.matcha);
  await page.evaluate("localStorage.clear()");
});

test("matcha: the frog pond alerts have their own tab in the preview and their own link (the frog pond card, in the matcha colors), and the backdrop choice moves the preview too", { skip }, async () => {
  await fresh();
  assert.equal(await page.evaluate(`document.querySelector("#alerts-stage iframe")`), null, "the practice alerts are not loaded until the tab is opened");
  await click("#view-alerts");
  assert.equal(await page.evaluate(`document.getElementById("preview").dataset.view`), "alerts");
  assert.equal(await page.evaluate(`getComputedStyle(document.getElementById("stage")).display`), "none", "the chat is out of the way");
  const section = await page.evaluate(`({ title: document.getElementById("alerts-title").textContent, frame: document.querySelector("#alerts-stage iframe")?.getAttribute("src"), link: document.getElementById("alerts-link").value, copyOff: document.getElementById("copy-alerts-link").disabled, edit: document.getElementById("alerts-edit").getAttribute("href") })`);
  assert.equal(section.title, "Frog pond alerts");
  const preview = new URL(section.frame, base);
  assert.equal(preview.pathname, "/overlay/alerts/");
  assert.deepEqual([preview.searchParams.get("deco"), preview.searchParams.has("card"), preview.searchParams.get("demo"), preview.searchParams.get("accent")], ["frog2", false, "1", "#8dae5f"], "made-up alerts, the frog pond pictures on the plain card, the matcha colors");
  assert.deepEqual([section.link, section.copyOff], ["", true], "no link until there is a name");
  assert.equal(section.edit, "/matcha/alerts/", "the button opens the private Matcha alerts editor, not the public one");
  await set("source-channel", "pond.pal");
  const link = new URL(await page.evaluate(`document.getElementById("alerts-link").value`));
  assert.equal(link.pathname, "/overlay/alerts/");
  assert.deepEqual([link.searchParams.get("channel"), link.searchParams.get("platform"), link.searchParams.get("deco"), link.searchParams.get("bg"), link.searchParams.get("text")], ["pond.pal", "tiktok", "frog2", "#f5f0e1", "#33432a"]);
  assert.equal(await page.evaluate(`document.getElementById("copy-alerts-link").disabled`), false);
  assert.equal(new URL(await page.evaluate(`document.getElementById("link").value`)).pathname, "/overlay/", "the chat link is still its own");
  await set("backdrop", "bright", "change");
  assert.equal(await page.evaluate(`document.getElementById("preview").dataset.back`), "bright", "the backdrop is the preview's, so the alerts move with it");
  // the page shows the frog pond alerts for real: the card in the preview wears a frog
  const wears = await page.evaluate(`new Promise((resolve) => { const t0 = Date.now(); const look = () => { const d = document.querySelector("#alerts-stage iframe").contentDocument; const peek = d?.querySelector(".alert__deco img.deco__peek"); if (peek) resolve(peek.src.includes("/decor/frog2/")); else if (Date.now() - t0 > 9000) resolve(false); else setTimeout(look, 150); }; look(); })`);
  assert.equal(wears, true, "a frog peeks over the top of the card in the preview");
  await click("#view-chat");
  assert.equal(await page.evaluate(`getComputedStyle(document.getElementById("alerts-stage")).display`), "none", "and the chat tab brings the chat back");
  assert.equal(await page.evaluate(`getComputedStyle(document.getElementById("stage")).display`), "flex");
});

test("matcha: it is laid out like the editor (the live preview stays beside the steps while they scroll) and the style choices are in the first step", { skip }, async () => {
  await page.viewport(1280, 800);
  await fresh();
  const at = () => page.evaluate(`(() => { const r = document.getElementById("preview").getBoundingClientRect(); return { top: Math.round(r.top), height: Math.round(r.height), left: Math.round(r.left), panelLeft: Math.round(document.querySelector(".panel").getBoundingClientRect().left) }; })()`);
  const before = await at();
  assert.ok(before.panelLeft < before.left, "the steps are on the left and the preview beside them");
  await page.evaluate("window.scrollTo(0, 600)");
  const after = await at();
  // (it sits a hair lower before the page is scrolled, under the menu bar's own edge)
  assert.ok(Math.abs(after.top - before.top) <= 3 && after.height === before.height, `the preview does not move while the page scrolls: ${JSON.stringify([before, after])}`);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll(".step-card .step-card__title")].map((h) => h.textContent.trim())`), ["Pick a style", "Connect your chat", "Add it to your stream", "Frog pond alerts"]);
  assert.equal(await page.evaluate(`document.querySelectorAll("#chat .m").length > 0`), true, "the preview shows made-up messages from the start");
  assert.equal(await page.evaluate(`document.querySelector("#styles").closest(".step-card").querySelector(".step-card__title").textContent`), "Pick a style");
});

test("the Matcha alerts editor is its own private page: it starts with the Matcha look and the frog pond pictures, which stay on every card style, keeps its own settings, and the public editor never shows them", { skip }, async () => {
  const rowOf = (label) => `[...document.querySelectorAll("#look-controls > *")].find((r) => r.querySelector(".ctl__label")?.textContent.trim() === ${JSON.stringify(label)})`;
  const chipsOf = (label) => page.evaluate(`[...(${rowOf(label)}?.querySelectorAll(".chip") ?? [])].map((b) => b.textContent.trim() + (b.getAttribute("aria-pressed") === "true" ? "*" : ""))`);
  const chooseIn = (label, name) => page.evaluate(`${rowOf(label)}.querySelectorAll(".chip").forEach((b) => b.textContent.trim() === ${JSON.stringify(name)} && b.click())`);
  const wears = () => page.evaluate(`document.querySelectorAll("#alerts .alert__deco img.deco__peek").length > 0`);
  await page.goto(base + "/alerts/", { settle: 600 });
  await page.evaluate("localStorage.clear()");
  // the public editor: no pictures row at all, and a link that asks for them (or for the old frog pond card) gets the plain card with none
  await page.goto(base + "/alerts/?deco=frog2&card=frogpond&look=matcha", { settle: 900 });
  assert.deepEqual(await chipsOf("Pictures on the card"), [], "no pictures row in the public editor");
  assert.equal(await page.evaluate(`document.getElementById("alerts").dataset.card + "/" + document.getElementById("alerts").dataset.deco`), "card/none");
  await set("source-channel", "pond.pal");
  const publicLink = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.deepEqual([publicLink.searchParams.has("card"), publicLink.searchParams.has("deco")], [false, false], "the public link carries neither");
  // the Matcha editor (starting from empty browser memory, so what it saves can be told apart)
  await page.evaluate("localStorage.clear()");
  await page.goto(base + "/matcha/alerts/", { settle: 900 });
  assert.equal((await chipsOf("Card style"))[0], "Simple*", "the card is the plain one");
  assert.deepEqual((await chipsOf("Pictures on the card")).slice(0, 3), ["None", "Frog pond", "Frog pond V2*"], "and the frog pond V2 pictures are picked");
  assert.equal(await page.evaluate(`[...document.querySelectorAll("#looks .chip")].find((b) => b.getAttribute("aria-pressed") === "true")?.textContent.trim()`), "Matcha", "in the Matcha look");
  assert.match(await page.evaluate(`document.querySelector(".panel .note").textContent`), /^Matcha alerts\. A private editor/);
  await set("source-channel", "pond.pal");
  const link = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(link.pathname, "/overlay/alerts/");
  assert.deepEqual([link.searchParams.get("channel"), link.searchParams.get("deco"), link.searchParams.has("card"), link.searchParams.get("bg")], ["pond.pal", "frog2", false, "#f5f0e1"]);
  await page.evaluate(`document.querySelector('[data-test="gift-1"]').click()`);
  await page.waitFor(`document.querySelector("#alerts .alert__deco img.deco__peek")`, { timeout: 6000 });
  // another card style keeps the pictures, on the alert already showing and on the next one
  await chooseIn("Card style", "Trading card");
  assert.equal(await page.evaluate(`document.getElementById("alerts").dataset.card`), "trading");
  assert.equal(await wears(), true, "the frog is still on the alert that was showing");
  await page.evaluate(`document.querySelector('[data-test="gift-1"]').click()`);
  await page.waitFor(`document.querySelectorAll("#alerts .alert").length >= 2`, { timeout: 6000 });
  assert.equal(await page.evaluate(`[...document.querySelectorAll("#alerts .alert")].every((a) => a.querySelector("img.deco__peek"))`), true, "and on the next one");
  assert.equal(new URL(await page.evaluate(`document.getElementById("link").value`)).searchParams.get("card"), "trading");
  // switching the pictures off takes them off the alerts showing, and back on puts them back
  await chooseIn("Pictures on the card", "None");
  assert.equal(await wears(), false);
  assert.equal(new URL(await page.evaluate(`document.getElementById("link").value`)).searchParams.has("deco"), false, "none is the usual, so the link says nothing");
  await chooseIn("Pictures on the card", "Frog pond V2");
  assert.equal(await wears(), true);
  assert.equal(new URL(await page.evaluate(`document.getElementById("link").value`)).searchParams.get("deco"), "frog2");
  // remembered here and nowhere else; Reset goes back to the plain card with the frog pond pictures
  assert.equal(await page.evaluate(`JSON.parse(localStorage.getItem("frills:alerts:matcha:v1")).settings.card`), "trading");
  assert.equal(await page.evaluate(`localStorage.getItem("frills:alerts:v1")`), null, "the public editor's saved settings are not touched");
  await page.goto(base + "/matcha/alerts/", { settle: 900 });
  assert.ok((await chipsOf("Card style")).includes("Trading card*"), "remembered after a reload");
  await click("#reset");
  assert.equal(await page.evaluate(`document.getElementById("alerts").dataset.card + "/" + document.getElementById("alerts").dataset.deco`), "card/frog2");
  // an older saved setting or link with the "frogpond" card becomes the plain card with the pictures
  await page.evaluate(`localStorage.setItem("frills:alerts:matcha:v1", JSON.stringify({ settings: { card: "frogpond" } }))`);
  await page.goto(base + "/matcha/alerts/", { settle: 900 });
  assert.equal(await page.evaluate(`document.getElementById("alerts").dataset.card + "/" + document.getElementById("alerts").dataset.deco`), "card/frog2");
  assert.equal((await chipsOf("Card style"))[0], "Simple*");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
  await page.evaluate("localStorage.clear()");
});

test("the Matcha alerts editor is private: not in the sitemap, not linked from the menu or the footer, and asks search engines to stay away", async () => {
  const sitemap = fs.readFileSync(join(dist, "sitemap.xml"), "utf8");
  assert.equal(sitemap.includes("/matcha/"), false);
  const html = fs.readFileSync(join(dist, "matcha", "alerts", "index.html"), "utf8");
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  for (const file of ["index.html", "overlays/index.html", "alerts/index.html"]) assert.equal(fs.readFileSync(join(dist, file), "utf8").includes("/matcha/alerts"), false, file + " does not link to it");
});
