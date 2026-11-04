// Drives the built site in a real headless Chrome or Edge: no console errors under the security policy, no sideways scrolling, the home
// page's look switcher and link maker, the editor, the overlay page. Skipped (not failed) on a computer with no Chrome or Edge.
// `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { PRESETS } from "../src/js/settings.js";
import { MATCHA_PALETTES } from "../src/js/matcha.js";

const root = join(import.meta.dirname, "..");
if (!existsSync(join(root, "dist", "index.html"))) throw new Error("dist/ is empty. Run `npm run build` first (`npm test` does that for you).");

let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

const port = 3500 + Math.floor(Math.random() * 400);
const base = `http://localhost:${port}`;
let server;
let page;

before(async () => {
  if (skip) return;
  server = spawn(process.execPath, ["scripts/serve.mjs", String(port)], { cwd: root, stdio: "ignore" });
  await sleep(700);
  page = await launch();
  await page.viewport(1280, 900);
});
after(async () => {
  await page?.close();
  server?.kill();
});

const stubClipboard = () => page.evaluate(`Object.defineProperty(navigator.clipboard, "writeText", { value: async (t) => { window.__copied = t; }, configurable: true })`);
const css = (selector, name) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).style.getPropertyValue(${JSON.stringify(name)})`);
const click = (selector, text) => page.evaluate(`(() => { const list = [...document.querySelectorAll(${JSON.stringify(selector)})]; const el = ${text ? `list.find((e) => e.textContent.trim() === ${JSON.stringify(text)})` : "list[0]"}; if (!el) throw new Error("nothing to click: ${selector}"); el.click(); })()`);
const type = (selector, value) => page.evaluate(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);

test("a page that doesn't exist answers 404 with the friendly page", { skip }, async () => {
  const res = await fetch(base + "/no-such-page/");
  assert.equal(res.status, 404);
  assert.match(await res.text(), /That page isn’t here/);
});

test("home: choosing a look restyles the stage", { skip }, async () => {
  await page.goto(base + "/", { settle: 900 });
  assert.equal(await css("#hero-stage", "--g-accent"), PRESETS.butter.accent, "starts on Butter");
  await click("#hero-looks .chip", "Frost");
  assert.equal(await css("#hero-stage", "--g-accent"), PRESETS.frost.accent);
  assert.match(await css("#hero-stage", "--g-font"), /Plus Jakarta Sans/);
  assert.equal(await page.evaluate(`document.querySelector("#hero-looks .chip[aria-pressed=true]").textContent.trim()`), "Frost");
  assert.ok((await page.evaluate("document.querySelectorAll('#hero-chat .m').length")) >= 3, "messages appear straight away");
});

test("home: the link maker asks for a real channel, then copies a link that carries the chosen look", { skip }, async () => {
  await page.goto(base + "/", { settle: 900 });
  await stubClipboard();
  await click("#hero-looks .chip", "Mint");
  await click("#lm-copy");
  await sleep(150);
  assert.equal(await page.evaluate(`document.getElementById("lm-channel").getAttribute("aria-invalid")`), "true");
  assert.match(await page.evaluate(`document.getElementById("lm-hint").textContent`), /Type your Twitch channel name first/);
  await type("#lm-channel", "  #SomeChannel ");
  await click("#lm-copy");
  await sleep(250);
  const copied = await page.evaluate("window.__copied");
  const url = new URL(copied);
  assert.equal(url.origin + url.pathname, `${base}/overlay/`);
  assert.equal(url.searchParams.get("channel"), "somechannel");
  assert.equal(url.searchParams.get("font"), "Space Grotesk", "the Mint look's font rides along");
  assert.equal(url.searchParams.get("accent"), PRESETS.mint.accent);
  assert.match(await page.evaluate(`document.getElementById("lm-hint").textContent`), /Copied/);
  assert.equal(await page.evaluate(`document.getElementById("lm-copy").dataset.state`), "copied");
});

test("home: every look gets a live preview once the section is near, and the numbers are in the page", { skip }, async () => {
  await page.goto(base + "/", { settle: 900 });
  assert.equal(await page.evaluate(`document.querySelectorAll("[data-look] .m").length`), 0, "nothing is drawn (and no font fetched) before it is needed");
  await page.evaluate(`window.scrollTo(0, document.getElementById("looks").getBoundingClientRect().top + scrollY - 100)`);
  await page.waitFor(`[...document.querySelectorAll("[data-look]")].every((s) => s.querySelectorAll(".m").length === 3)`, { timeout: 6000 });
  const previews = await page.evaluate(`[...document.querySelectorAll("[data-look]")].map((s) => [s.dataset.look, s.querySelectorAll(".m").length])`);
  assert.deepEqual(previews.map((p) => p[0]), Object.keys(PRESETS));
  for (const [look, count] of previews) assert.equal(count, 3, `${look} shows three messages`);
  assert.equal(await page.evaluate(`document.querySelectorAll(".stat__num [data-count]").length`), 4);
});

test("home: motion respects the person who asked for less", { skip }, async () => {
  await page.viewport(1280, 900, { reducedMotion: true });
  await page.goto(base + "/", { settle: 800 });
  const names = await page.evaluate(`({ frilly: getComputedStyle(document.querySelector(".frilly")).animationName, marquee: getComputedStyle(document.querySelector(".foot__track")).animationName })`);
  assert.deepEqual(names, { frilly: "none", marquee: "none" });
  await page.viewport(1280, 900);
});

test("the nav menu opens on a phone and closes with Escape", { skip }, async () => {
  await page.viewport(390, 800);
  await page.goto(base + "/", { settle: 500 });
  assert.equal(await page.evaluate(`document.getElementById("nav-sheet").hidden`), true);
  await click(".nav__toggle");
  assert.equal(await page.evaluate(`document.getElementById("nav-sheet").hidden`), false);
  assert.equal(await page.evaluate(`document.querySelector(".nav__toggle").getAttribute("aria-expanded")`), "true");
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(150);
  assert.equal(await page.evaluate(`document.getElementById("nav-sheet").hidden`), true);
  await page.viewport(1280, 900);
});

test("editor: a look, a control and a channel become a link the overlay understands", { skip }, async () => {
  await page.goto(base + "/editor/?look=bubblegum", { settle: 900 });
  assert.equal(await css("#stage", "--g-accent"), PRESETS.bubblegum.accent, "the look from the address is applied");
  assert.equal(await page.evaluate(`document.querySelector("#presets .chip[aria-pressed=true]").textContent.trim()`), "Bubblegum");
  assert.equal(await page.evaluate(`document.getElementById("copy-link").disabled`), true, "no link until there is a channel");
  assert.match(await page.evaluate(`document.getElementById("link-hint").textContent`), /once you have typed your TikTok name or Twitch channel/);

  await page.evaluate(`(() => { const i = document.getElementById("c-radius"); i.value = 4; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  assert.equal(await css("#stage", "--g-radius"), "4px", "a control changes the preview live");
  assert.equal(await page.evaluate(`document.querySelectorAll("#presets .chip[aria-pressed=true]").length`), 0, "no starting look is pressed once it has been changed");

  await type("#source-channel", "somechannel");
  const link = await page.evaluate(`document.getElementById("link").value`);
  assert.equal(await page.evaluate(`document.getElementById("copy-link").disabled`), false);
  const url = new URL(link);
  assert.equal(url.pathname, "/overlay/");
  assert.equal(url.searchParams.get("channel"), "somechannel");
  assert.equal(url.searchParams.get("radius"), "4");

  // The same link, opened as the overlay, paints the same look.
  await page.goto(base + url.pathname + url.search + "&demo=1", { settle: 700 });
  assert.equal(await css("#stage", "--g-radius"), "4px");
  assert.equal(await css("#stage", "--g-accent"), PRESETS.bubblegum.accent);
  assert.match(await css("#stage", "--g-font"), /Bricolage Grotesque/);
});

test("editor: it remembers you, and Reset puts the defaults back", { skip }, async () => {
  await page.goto(base + "/editor/", { settle: 700 });
  await page.evaluate("localStorage.clear()");
  await page.goto(base + "/editor/", { settle: 500 });
  await click("#presets .chip", "Butter");
  await page.goto(base + "/editor/", { settle: 700 });
  assert.equal(await css("#stage", "--g-accent"), PRESETS.butter.accent, "remembered after a reload");
  await click("#reset");
  assert.equal(await css("#stage", "--g-accent"), PRESETS.blueberry.accent);
  await page.evaluate("localStorage.clear()");
});

test("editor: the preview's width slider is in the bar above the preview, and it changes the preview's width", { skip }, async () => {
  await page.goto(base + "/editor/?look=matcha", { settle: 700 });
  const where = await page.evaluate(`(() => {
    const slider = document.getElementById("c-previewW");
    const bar = document.querySelector(".preview__bar");
    return { inBar: Boolean(slider && bar && bar.contains(slider)), aboveStage: slider.getBoundingClientRect().bottom <= document.getElementById("stage").getBoundingClientRect().top + 1, oldCardGone: !document.querySelector(".preview-tools"), label: bar.querySelector(".ctl__label").textContent.trim() };
  })()`);
  assert.deepEqual(where, { inBar: true, aboveStage: true, oldCardGone: true, label: "Width" });
  const widthAt = async (value) => {
    await page.evaluate(`(() => { const i = document.getElementById("c-previewW"); i.value = ${value}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    return page.evaluate(`({ prop: document.getElementById("chat").style.getPropertyValue("--preview-w"), width: Math.round(document.getElementById("chat").getBoundingClientRect().width) })`);
  };
  const narrow = await widthAt(300);
  assert.equal(narrow.prop, "300px");
  assert.ok(narrow.width <= 302, `the chat is about 300 px wide (${narrow.width})`);
  const wide = await widthAt(600);
  assert.equal(wide.prop, "600px");
  assert.ok(wide.width > narrow.width + 100, `and gets wider with the slider (${narrow.width} -> ${wide.width})`);
});

test("editor: junk in saved settings or the address can't break the page", { skip }, async () => {
  await page.goto(base + "/editor/", { settle: 500 });
  await page.evaluate(`localStorage.setItem("frills:editor:v1", JSON.stringify({ settings: { accent: "red", radius: 9999, font: "Comic Sans", avatar: "yes", modIcon: "<img>", max: -4 }, channel: "<script>" }))`);
  await page.goto(base + "/editor/?look=nonsense&channel=%3Cscript%3E", { settle: 700 });
  assert.deepEqual(page.problems, []);
  assert.equal(await css("#stage", "--g-radius"), "32px", "out-of-range values are pulled back into range");
  assert.match(await css("#stage", "--g-font"), /Geist/, "an unknown font falls back to the default");
  await page.evaluate("localStorage.clear()");
});

test("editor: a test message cycles through plain, moderator and gift", { skip }, async () => {
  await page.goto(base + "/editor/", { settle: 700 });
  await page.evaluate(`localStorage.clear()`);
  await click("#source button", "Send a test message");
  await click("#source button", "Send a test message");
  await click("#source button", "Send a test message");
  await page.waitFor(`document.querySelectorAll("#chat .m.gift").length >= 1 && document.querySelectorAll("#chat .m .ico svg").length >= 1`);
});

test("editor: a bad Twitch channel name is explained, not ignored", { skip }, async () => {
  await page.goto(base + "/editor/", { settle: 600 });
  await page.evaluate("localStorage.clear()");
  await page.goto(base + "/editor/", { settle: 500 });
  await click("#source .chip", "Twitch"); // TikTok is the first choice; its own check is in tiktok.browser.test.mjs
  await type("#source-channel", "not a channel!");
  await click("#source .source__row button");
  assert.equal(await page.evaluate(`document.getElementById("source-channel").getAttribute("aria-invalid")`), "true");
  assert.match(await page.evaluate(`document.getElementById("source-status").textContent`), /letters, numbers and _ only/);
  assert.equal(await page.evaluate(`document.getElementById("copy-link").disabled`), true);
  await page.evaluate("localStorage.clear()");
});

test("overlay: a matcha style and palette in the address are applied", { skip }, async () => {
  await page.goto(base + "/overlay/?demo=1&style=night&palette=forest&modIcon=frog", { settle: 700 });
  assert.equal(await page.evaluate(`document.getElementById("stage").classList.contains("look-night")`), true);
  assert.equal(await css("#stage", "--matcha"), MATCHA_PALETTES.forest.matcha);
  assert.equal(await page.evaluate(`document.getElementById("chat").dataset.modIcon`), "frog");
});

test("overlay: with no channel it says what to add, and with demo=1 it draws practice messages, never more than max", { skip }, async () => {
  await page.goto(base + "/overlay/", { settle: 500 });
  assert.equal(await page.evaluate(`document.getElementById("note").hidden`), false);
  assert.match(await page.evaluate(`document.getElementById("note").textContent`), /\?channel=yourname/);
  await page.goto(base + "/overlay/?demo=1&max=3&life=0", { settle: 500 });
  await page.waitFor(`document.querySelectorAll("#chat .m").length >= 2`, { timeout: 6000 });
  await sleep(2500);
  const count = await page.evaluate(`[...document.querySelectorAll("#chat .m")].filter((m) => !m.classList.contains("leaving")).length`);
  assert.ok(count >= 2 && count <= 3, `${count} messages showing`);
});

test("overlay: the page is truly see-through", { skip }, async () => {
  await page.goto(base + "/overlay/?channel=notarealchannel", { settle: 600 });
  const png = await page.screenshot({ transparent: true });
  let pos = 8;
  let colorType = -1;
  const idat = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString("ascii", pos + 4, pos + 8);
    if (type === "IHDR") colorType = png[pos + 8 + 9];
    if (type === "IDAT") idat.push(png.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  assert.equal(colorType, 6, "the picture has an alpha channel");
  const raw = inflateSync(Buffer.concat(idat));
  assert.equal(raw[1 + 3], 0, "the top-left pixel is fully transparent");
});

test("matcha: pick a style and the link follows, once there is a channel", { skip }, async () => {
  await page.goto(base + "/matcha/", { settle: 900 });
  assert.equal(await page.evaluate(`document.querySelectorAll("#styles .chip").length`), 6);
  assert.equal(await page.evaluate(`document.getElementById("copy-link").disabled`), true);
  await click("#palettes .chip", "Forest");
  await click("#styles .chip", "Pixel Pond");
  await type("#source-channel", "somechannel");
  const url = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(url.searchParams.get("style"), "pixel");
  assert.equal(url.searchParams.get("palette"), "forest");
  assert.equal(url.searchParams.get("channel"), "somechannel");
  assert.equal(await page.evaluate(`document.querySelector("#styles .chip[aria-pressed=true]").textContent.trim()`), "Pixel Pond");
});

test("keyboard: the first Tab goes to the skip link, which jumps to the content", { skip }, async () => {
  await page.goto(base + "/", { settle: 500 });
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  assert.equal(await page.evaluate(`document.activeElement.className`), "skip");
  assert.notEqual(await page.evaluate(`getComputedStyle(document.activeElement).outlineStyle`), "none", "the focus ring shows");
});
