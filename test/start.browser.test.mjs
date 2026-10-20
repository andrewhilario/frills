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

// ── Both: TikTok and Twitch together ─────────────────────────────────────────────────────────────────────────────────────────────────
const typeInto = (id, value) => page.evaluate(`(() => { const i = document.getElementById(${JSON.stringify(id)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const enterIn = (id) => page.evaluate(`document.getElementById(${JSON.stringify(id)}).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
const startBoth = async () => {
  await page.goto(`${base}/start/`, { settle: 600 });
  await choose("Both at once");
};

test("Both: it asks for the TikTok name and the Twitch channel, checks each, and Enter goes from the first box to the second", { skip }, async () => {
  await startBoth();
  assert.equal(await ask(), "What are your TikTok @name and Twitch channel?");
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll("#start input[data-platform]")].map((i) => i.dataset.platform + ":" + i.getAttribute("aria-label"))`), ["tiktok:Your TikTok name", "twitch:Your Twitch channel"]);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll("#start .start__label")].map((l) => l.textContent)`), ["Your TikTok @name", "Your Twitch channel"], "each box is labelled");
  assert.equal(await page.evaluate(`document.activeElement.id`), "start-name", "the cursor starts in the first box");
  await typeInto("start-name", "@Pond.Pal");
  await enterIn("start-name");
  assert.equal(await ask(), "What are your TikTok @name and Twitch channel?", "Enter in the first box does not go on");
  assert.equal(await page.evaluate(`document.activeElement.id`), "start-name-2", "it moves to the second box");
  // a Twitch name cannot have a dot, and the one that is wrong is the one marked
  await typeInto("start-name-2", "pond.pal");
  await enterIn("start-name-2");
  assert.equal(await ask(), "What are your TikTok @name and Twitch channel?", "a wrong Twitch name stops it");
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll("#start input[data-platform]")].map((i) => i.hasAttribute("aria-invalid"))`), [false, true]);
  assert.match(await page.evaluate(`document.querySelector("#start .start__error").textContent`), /Twitch channel: letters, numbers and _ only/);
  await typeInto("start-name-2", "PondPal");
  await enterIn("start-name-2");
  assert.equal(await ask(), "Which overlays do you want?", "two good names go on");
  // the overlays say which are for what
  const text = await page.evaluate(`JSON.stringify([...document.querySelectorAll("#start .pick--check .pick__body")].map((b) => b.textContent))`).then(JSON.parse);
  assert.equal(text.length, 5, "every overlay is on offer");
  assert.match(text[0], /TikTok and Twitch chat together/);
  assert.match(text[1], /One for TikTok and one for Twitch/);
  for (const t of text.slice(2)) assert.match(t, /TikTok only/);
  // going back keeps what was typed
  await press("Back");
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll("#start input[data-platform]")].map((i) => i.value)`), ["@Pond.Pal", "PondPal"]);
});

test("Both: the links page has one chat for both, alerts for each platform, and the rest for TikTok", { skip }, async () => {
  await startBoth();
  await typeInto("start-name", "@Pond.Pal");
  await typeInto("start-name-2", "PondPal");
  await press("Next");
  await page.evaluate(`[...document.querySelectorAll("#start .pick--check input")].forEach((b) => { if (!b.checked) b.click(); })`);
  await press("Next");
  await choose("Cute and pink"); await choose("A phone LIVE"); await choose("Center");
  await page.waitFor(`document.querySelector("#start .card")`);
  assert.equal(await ask(), "Your links are ready");
  const list = await cards();
  assert.deepEqual(list.map((c) => c.name), ["Chat", "Alerts (TikTok)", "Alerts (Twitch)", "Last gifts", "Goals", "Top likers"]);
  assert.equal(list[0].link, `${base}/overlay/?tiktok=pond.pal&twitch=pondpal&look=bubblegum&deco=neko&align=center`, "one chat link names both accounts");
  assert.equal(list[1].link, `${base}/overlay/alerts/?channel=pond.pal&platform=tiktok&look=bubblegum&align=center`);
  assert.equal(list[2].link, `${base}/overlay/alerts/?channel=pondpal&platform=twitch&look=bubblegum&align=center`);
  for (const c of list.slice(3)) assert.match(c.link, /channel=pond\.pal&platform=tiktok/, `${c.name} is TikTok's`);
  assert.ok(list.every((c) => !c.copyOff && c.size === "1080 × 1920"));
  assert.match(list[0].note, /small icon/);
  assert.match(list[2].note, /follow alerts need one extra login/i);
  assert.equal(list[0].edit, list[0].link.replace("/overlay/", "/editor/"), "the editor gets the very same two accounts");
  // two name boxes on this page, each already filled in
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll("#start .start__field--inline input")].map((i) => i.id + "=" + i.value)`), ["result-name=@Pond.Pal", "result-name-2=PondPal"]);
  assert.match(await page.evaluate(`document.querySelector("#start .start__next").textContent`), /real chat and gifts only show while you are LIVE/);
});

test("Both: each link waits only for the names it needs, and a wrong name is explained", { skip }, async () => {
  await startBoth();
  await typeInto("start-name", "pond.pal");
  await typeInto("start-name-2", "pondpal");
  await press("Next");
  await press("Next"); // the chat and the alerts are the two that are ticked to begin with
  await choose("Cute and pink"); await choose("A phone LIVE"); await choose("Left");
  await page.waitFor(`document.querySelector("#start .card")`);
  assert.deepEqual((await cards()).map((c) => c.name), ["Chat", "Alerts (TikTok)", "Alerts (Twitch)"]);
  // take the Twitch channel away: the chat and the Twitch alerts have nothing to read, the TikTok alerts still do
  await typeInto("result-name-2", "");
  let list = await cards();
  assert.deepEqual(list.map((c) => c.link !== ""), [false, true, false]);
  assert.deepEqual(list.map((c) => c.copyOff), [true, false, true]);
  const holders = await page.evaluate(`JSON.stringify([...document.querySelectorAll("#start .card__input")].map((i) => i.placeholder))`).then(JSON.parse);
  assert.deepEqual(holders, ["Type both names above to get this link", "Type your TikTok @name above to get this link", "Type your Twitch channel above to get this link"]);
  // and the other way round
  await typeInto("result-name-2", "pondpal");
  await typeInto("result-name", "");
  list = await cards();
  assert.deepEqual(list.map((c) => c.link !== ""), [false, false, true]);
  // a name the platform does not accept is told which rule it broke, and does not become a link
  await typeInto("result-name", "no good!");
  assert.match(await page.evaluate(`document.querySelector("#start .start__field--inline .start__error").textContent`), /TikTok @name: letters, numbers, _ and \. only/);
  assert.equal(await page.evaluate(`document.getElementById("result-name").hasAttribute("aria-invalid")`), true);
  assert.equal(await page.evaluate(`document.getElementById("result-name-2").hasAttribute("aria-invalid")`), false);
  await typeInto("result-name", "Pond.Pal");
  list = await cards();
  assert.equal(list[0].link, `${base}/overlay/?tiktok=pond.pal&twitch=pondpal&look=bubblegum&deco=neko`);
  assert.equal(await page.evaluate(`document.querySelector("#start .start__field--inline .start__error").hidden`), true);
});

test("Both: the picture of the chat shows TikTok and Twitch messages, each with its icon, and never connects", { skip }, async () => {
  await startBoth();
  await press("I will add them later");
  await press("Next"); // the chat and the alerts are ticked to begin with
  await choose("Cute and pink"); await choose("A phone LIVE"); await choose("Left");
  await page.waitFor(`document.querySelector("#start .card__frame")`);
  const src = await page.evaluate(`new URL(document.querySelector("#start .card__frame").src).search`);
  assert.match(src, /demo=1/);
  assert.match(src, /tiktok=demo&twitch=demo/);
  // practice messages take turns being TikTok's and Twitch's, so both icons turn up
  await page.waitFor(`(() => { try { const d = document.querySelector("#start .card__frame").contentDocument; return d.querySelector('.m[data-platform="tiktok"] .src') && d.querySelector('.m[data-platform="twitch"] .src'); } catch { return false; } })()`, { timeout: 20000 });
  // with no names, nothing can be copied, but the editor links still open
  const list = await cards();
  assert.ok(list.every((c) => c.link === "" && c.copyOff));
  assert.ok(list.every((c) => c.edit.startsWith(`${base}/`)));
});

test("Both: changing the platform afterwards keeps each name with its own platform", { skip }, async () => {
  await startBoth();
  await typeInto("start-name", "pond.pal");
  await typeInto("start-name-2", "pondpal");
  await press("Next");
  await press("Next");
  await choose("Cute and pink"); await choose("A phone LIVE"); await choose("Left");
  await page.waitFor(`document.querySelector("#start .card")`);
  await press("Change my answers");
  assert.equal(await ask(), "Where do you stream?");
  assert.equal(await page.evaluate(`document.querySelector("#start .pick[aria-pressed=true]").textContent.includes("Both at once")`), true, "the choice is still there");
  await choose("Twitch");
  assert.equal(await page.evaluate(`document.getElementById("start-name").value`), "pondpal", "the Twitch box has the Twitch channel, not the TikTok name");
  assert.equal(await page.evaluate(`document.querySelectorAll("#start input[data-platform]").length`), 1);
  await press("Back");
  await choose("TikTok LIVE");
  assert.equal(await page.evaluate(`document.getElementById("start-name").value`), "pond.pal");
});
