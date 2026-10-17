// Quick start in a real headless Chrome: the six questions, the links at the end, the name that can still change, copying, the Edit links and the
// practice pictures. Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch } from "../scripts/lib/chrome.mjs";
import { createStatic } from "../scripts/lib/static.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "start", "index.html"))) throw new Error("dist/ has no Quick start page. Run `npm run build` first (`npm test` does that for you).");
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
  await page.viewport(1100, 900);
});
after(async () => {
  await page?.close();
  server?.closeAllConnections?.();
  server?.close();
});

const ask = () => page.evaluate(`document.querySelector("#start .start__ask")?.textContent ?? ""`);
const pick = (text) => page.evaluate(`[...document.querySelectorAll("#start .pick")].find((b) => b.textContent.includes(${JSON.stringify(text)})).click()`);
const press = (text) => page.evaluate(`[...document.querySelectorAll("#start button")].find((b) => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
/** Chooses an answer and goes on: no question moves on by itself. */
const choose = async (text) => {
  await pick(text);
  await page.evaluate(`document.querySelector("#start .start__nav .btn:not(.btn--soft)").click()`); // "Next", or "Show my links" on the last question
};
const typeName = (value) => page.evaluate(`(() => { const i = document.getElementById("start-name"); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const cards = () => page.evaluate(`JSON.stringify([...document.querySelectorAll("#start .card")].map((c) => ({ name: c.querySelector("h3").textContent, link: c.querySelector("input").value, edit: c.querySelector("a.btn").getAttribute("href"), copyOff: c.querySelector("button").disabled, size: c.querySelector(".card__size strong").textContent, note: c.querySelector(".card__note")?.textContent ?? "" })))`).then(JSON.parse);

/** Answers all six questions. */
async function walk({ platform = "TikTok LIVE", name = "@Pond_Pal", all = false, vibe = "Cute and pink", shape = "A phone LIVE", align = "Center" } = {}) {
  await page.goto(`${base}/start/`, { settle: 600 });
  await choose(platform);
  await typeName(name);
  await press("Next");
  if (all) await page.evaluate(`[...document.querySelectorAll("#start .pick--check input")].forEach((b) => { if (!b.checked) b.click(); })`);
  await press("Next");
  await choose(vibe);
  await choose(shape);
  await choose(align);
  await page.waitFor(`document.querySelector("#start .card")`);
}

test("six questions in order, one at a time, with how far along you are", { skip }, async () => {
  await page.goto(`${base}/start/`, { settle: 600 });
  const seen = [];
  const step = async () => { seen.push((await ask()) + " | " + (await page.evaluate(`document.querySelector("#start .start__step").textContent`))); };
  await step();
  await pick("TikTok LIVE");
  assert.equal(await ask(), "Where do you stream?", "choosing does not move on by itself");
  await press("Next"); await step();
  await press("I will add it later"); await step();
  await press("Next"); await step();
  await pick("Retro arcade");
  assert.equal(await ask(), "What is your vibe?", "choosing a vibe does not move on by itself, so a few can be tried");
  await pick("Cute and pink");
  assert.equal(await ask(), "What is your vibe?");
  assert.equal(await page.evaluate(`document.querySelectorAll("#start .pick[aria-pressed=true]").length`), 1, "only the last one chosen is pressed");
  await pick("Retro arcade");
  await press("Next"); await step();
  await pick("A PC stream");
  assert.equal(await ask(), "What shape is your stream?", "choosing does not move on by itself");
  await press("Next"); await step();
  assert.deepEqual(seen, [
    "Where do you stream? | Question 1 of 6",
    "What is your TikTok @name? | Question 2 of 6",
    "Which overlays do you want? | Question 3 of 6",
    "What is your vibe? | Question 4 of 6",
    "What shape is your stream? | Question 5 of 6",
    "Where should the text sit? | Question 6 of 6",
  ]);
  await press("Back");
  assert.equal(await ask(), "What shape is your stream?");
  assert.equal(await page.evaluate(`document.querySelectorAll("#start .picks")[0].children.length`), 2);
});

test("the name is checked, cleaned, and can be skipped; at least one overlay has to stay ticked", { skip }, async () => {
  await page.goto(`${base}/start/`, { settle: 600 });
  await choose("TikTok LIVE");
  await typeName("not a name!");
  await press("Next");
  assert.equal(await ask(), "What is your TikTok @name?", "it stays on the question");
  assert.match(await page.evaluate(`document.querySelector("#start .start__error").textContent`), /letters, numbers, _ and \./);
  await typeName("@Pond_Pal");
  await press("Next");
  assert.equal(await ask(), "Which overlays do you want?");
  await page.evaluate(`[...document.querySelectorAll("#start .pick--check input")].forEach((b) => { if (b.checked) b.click(); })`);
  await press("Next");
  assert.equal(await ask(), "Which overlays do you want?", "nothing ticked: it stays");
  assert.match(await page.evaluate(`[...document.querySelectorAll("#start .start__error")].map((e) => e.textContent).join("")`), /at least one overlay/);
});

test("the links page has a card for each chosen overlay, with a link, the size, a picture and an Edit button, and follows the answers", { skip }, async () => {
  await walk({ all: true });
  assert.equal(await ask(), "Your links are ready");
  const list = await cards();
  assert.deepEqual(list.map((c) => c.name), ["Chat", "Alerts", "Last gifts", "Goals", "Top likers"]);
  assert.equal(list[0].link, `${base}/overlay/?channel=pond_pal&platform=tiktok&look=bubblegum&deco=neko&align=center`, "the name is cleaned: no @, lower case");
  assert.equal(list[1].link, `${base}/overlay/alerts/?channel=pond_pal&platform=tiktok&look=bubblegum&align=center`);
  assert.ok(list.every((c) => c.size === "1080 × 1920" && !c.copyOff));
  assert.equal(list[0].edit, list[0].link.replace("/overlay/", "/editor/"));
  assert.match(list[3].note, /real follower count/);
  assert.equal(await page.evaluate(`document.querySelectorAll("#start .card__frame").length`), 5, "a picture of each");
});

test("each picture is the real overlay in practice mode and draws; the pictures never connect to anything", { skip }, async () => {
  await walk({ all: true, vibe: "Cozy and green" });
  await page.waitFor(`[...document.querySelectorAll("#start .card__frame")].every((f) => { try { return f.contentDocument.body.children.length > 0; } catch { return false; } })`, { timeout: 15000 });
  const drawn = await page.evaluate(`JSON.stringify([...document.querySelectorAll("#start .card__frame")].map((f) => ({ path: new URL(f.src).pathname, demo: new URL(f.src).searchParams.get("demo"), channel: new URL(f.src).searchParams.get("channel"), shown: f.contentDocument.body.children.length > 0 })))`);
  for (const f of JSON.parse(drawn)) { assert.equal(f.demo, "1", f.path); assert.equal(f.channel, null, f.path); assert.equal(f.shown, true, f.path); }
  const chat = await page.evaluate(`new URL(document.querySelector("#start .card__frame").src).search`);
  assert.match(chat, /style=latte&palette=latte&deco=frog/, "the green vibe is the Matcha latte with a frog");
  const edit = await cards();
  assert.equal(new URL(edit[0].edit, base).pathname, "/matcha/", "a Matcha chat is edited on the Matcha page");
});

test("the name can still be changed on the last page: every link follows it, and without one there is nothing to copy", { skip }, async () => {
  await walk({ name: "" });
  assert.ok((await cards()).every((c) => c.link === "" && c.copyOff), "no name yet");
  await page.evaluate(`(() => { const i = document.getElementById("result-name"); i.value = "@Kero.Chan"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  const named = await cards();
  assert.ok(named.every((c) => c.link.includes("channel=kero.chan") && !c.copyOff));
  await page.evaluate(`(() => { const i = document.getElementById("result-name"); i.value = "no good!"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  assert.ok((await cards()).every((c) => c.link === ""), "a name that is not acceptable gives no link");
  assert.match(await page.evaluate(`document.querySelector("#start .start__field--inline .start__error").textContent`), /letters, numbers/);
});

test("Copy link and Copy all links put the right text on the clipboard", { skip }, async () => {
  await walk({ name: "pond_pal" });
  await page.evaluate(`(() => { window.__copied = []; Object.defineProperty(navigator, "clipboard", { value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } }, configurable: true }); })()`);
  await page.evaluate(`document.querySelector("#start .card .btn").click()`);
  await page.evaluate(`[...document.querySelectorAll("#start button")].find((b) => b.textContent.includes("Copy all links")).click()`);
  await page.waitFor(`window.__copied.length >= 2`);
  const copied = JSON.parse(await page.evaluate(`JSON.stringify(window.__copied)`));
  assert.equal(copied[0], `${base}/overlay/?channel=pond_pal&platform=tiktok&look=bubblegum&deco=neko&align=center`);
  assert.equal(copied[1], `Chat: ${copied[0]}\nAlerts: ${base}/overlay/alerts/?channel=pond_pal&platform=tiktok&look=bubblegum&align=center`);
});

test("Twitch gets chat and alerts only, and says follow alerts need their own login", { skip }, async () => {
  await page.goto(`${base}/start/`, { settle: 600 });
  await choose("Twitch");
  assert.equal(await ask(), "What is your Twitch channel?");
  await typeName("PondPal");
  await press("Next");
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll("#start .pick--check .pick__name")].map((n) => n.textContent)`), ["Chat", "Alerts"]);
  await press("Next");
  await choose("Dark and gamer"); await choose("A PC stream"); await choose("Left");
  await page.waitFor(`document.querySelector("#start .card")`);
  const list = await cards();
  assert.deepEqual(list.map((c) => c.name), ["Chat", "Alerts"]);
  assert.ok(list.every((c) => c.link.includes("channel=pondpal") && c.link.includes("platform=twitch") && c.size === "1920 × 1080"));
  assert.match(list[1].note, /follow alerts need one extra login/i);
});

test("the Edit links open each editor already set up like the link: look, alignment and pictures", { skip }, async () => {
  await walk({ all: true, name: "pond_pal" });
  const list = await cards();
  const pressed = async (href) => {
    await page.goto(new URL(href, base).href, { settle: 1200 });
    return page.evaluate(`JSON.stringify([...document.querySelectorAll('.chip[aria-pressed="true"]')].map((c) => (c.closest(".ctl, .step-card")?.querySelector(".ctl__label, .step-card__title")?.textContent.trim() ?? "") + "=" + c.textContent.trim()))`);
  };
  const chat = await pressed(list[0].edit);
  for (const part of ["Pick a look=Bubblegum", "Text alignment=Center", "Decorations on the bubbles=Neko cafe"]) assert.ok(chat.includes(part), `chat editor: ${part} in ${chat}`);
  for (const i of [1, 2, 3, 4]) {
    const text = await pressed(list[i].edit);
    assert.ok(text.includes("Pick a look=Bubblegum") && text.includes("Text alignment=Center"), `${list[i].name} editor: ${text}`);
  }
});

test("the Quick start works with the keyboard and on a phone-sized screen", { skip }, async () => {
  await page.viewport(390, 844);
  await page.goto(`${base}/start/`, { settle: 600 });
  await choose("TikTok LIVE");
  await page.evaluate(`document.getElementById("start-name").value = "pond_pal"`);
  await page.evaluate(`document.getElementById("start-name").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
  assert.equal(await ask(), "Which overlays do you want?", "Enter goes on");
  await press("Next");
  await choose("Sunny and bold"); await choose("A phone LIVE"); await choose("Right");
  await page.waitFor(`document.querySelector("#start .card")`);
  assert.equal(await page.evaluate(`document.documentElement.scrollWidth > document.documentElement.clientWidth`), false, "no sideways scrolling");
  assert.equal(await page.evaluate(`document.activeElement?.classList.contains("start__ask")`), true, "the keyboard focus is on the heading of the new page");
  await page.viewport(1100, 900);
});
