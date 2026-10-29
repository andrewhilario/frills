// Song requests in a real headless Chrome, with a pretend TikTok behind the helper: viewers type !sr in the LIVE chat and the queue fills,
// the streamer's !next moves it on, the practice mode and the editor's test buttons work with nobody live, and the page has nothing the
// security policy refuses. Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createHelper } from "../helper/server.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "songs", "index.html"))) throw new Error("dist/ has no songs page. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

class FakeConnection extends EventEmitter {
  async connect() { await sleep(5); }
  disconnect() { this.emit("disconnected"); }
}
const opened = [];
async function withHelper() {
  const made = [];
  const helper = createHelper({ distDir: dist, factory: async () => { const c = new FakeConnection(); made.push(c); return c; }, idleStopMs: 200, offlineWaitMs: 5000 });
  const port = await helper.listen(0);
  opened.push(helper);
  return { base: `http://127.0.0.1:${port}`, made };
}
const until = async (check, ms = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await check()) return; await sleep(30); }
  throw new Error("Timed out");
};
let page;
before(async () => { if (!skip) { page = await launch(); await page.viewport(1280, 900); } });
after(async () => { await page?.close(); for (const h of opened) await h.close(); });

const text = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim() ?? null`);
const click = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const titles = () => page.evaluate(`[...document.querySelectorAll(".song:not(.song--out) .song__title")].map((e) => e.textContent)`);

let counter = 0;
const say = (content, { name = "Ann", id = ++counter, mod = false, anchor = false, login = name.toLowerCase() } = {}) => ({
  common: { msgId: "m" + id },
  user: { id: "u" + name, displayId: login, nickname: name },
  content,
  userIdentity: { isModeratorOfAnchor: mod, isAnchor: anchor },
});

test("pages: the song pages load under the security policy with no console errors", { skip }, async () => {
  for (const path of ["/songs/", "/overlay/songs/?demo=1", "/overlays/"]) {
    const { base } = await withHelper();
    await page.goto(base + path, { settle: 900 });
    // this server has files only: the Worker that answers /api/spotify/ (is a Spotify login kept?) is not behind it, so that one 404 is not a finding
    const problems = page.problems.filter((p) => !p.includes("/api/spotify/"));
    assert.deepEqual(problems, [], `${path}: ${problems.join(" | ")}`);
  }
});

test("overlay: !sr in the LIVE chat adds songs, other chat is ignored, and the streamer's !next moves the queue on", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/songs/?channel=pond_cafe&platform=tiktok`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("chat", say("hello everyone"));
  made[0].emit("chat", say("!sr blinding lights", { name: "Ann" }));
  made[0].emit("chat", say("!sr levitating", { name: "Ben" }));
  made[0].emit("chat", say("!sr espresso", { name: "Cat" }));
  await until(async () => (await text(".song--now .song__title")) !== null && (await titles()).length === 3);
  assert.deepEqual(await titles(), ["blinding lights", "levitating", "espresso"], "no catalog on this test server, so each shows as it was typed");
  assert.equal(await text(".song--now .song__label"), "Now playing");
  assert.match(await text(".song--now .song__by"), /asked by Ann/);
  made[0].emit("chat", say("!next", { name: "Viewer" }));
  await sleep(300);
  assert.equal((await titles()).length, 3, "a viewer cannot");
  made[0].emit("chat", say("!next", { name: "Pond_Cafe", login: "pond_cafe" }));
  await until(async () => (await titles()).length === 2);
  assert.deepEqual(await titles(), ["levitating", "espresso"]);
  assert.match(await text(".song--now .song__by"), /asked by Ben/);
  made[0].emit("chat", say("!skip", { name: "Mod", mod: true }));
  await until(async () => (await titles()).length === 1);
  assert.equal(await text(".song--now .song__title"), "espresso");
});

test("overlay: a new request animates only itself, the songs already there stay still", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/songs/?channel=pond_cafe&platform=tiktok`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("chat", say("!sr first song", { name: "Ann" }));
  made[0].emit("chat", say("!sr second song", { name: "Ben" }));
  await until(async () => (await titles()).length === 2);
  await sleep(900);
  made[0].emit("chat", say("!sr third song", { name: "Cat" }));
  await until(async () => (await titles()).length === 3);
  const moving = await page.evaluate(`[...document.querySelectorAll(".song")].slice(0, 2).map((e) => e.getAnimations().length)`);
  assert.deepEqual(moving, [0, 0]);
});

test("overlay: the settings in the link are used, the command word and how many are shown", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/songs/?channel=pond_cafe&platform=tiktok&command=play&max=2&cover=0&requester=0&titleText=Requests`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("chat", say("!sr ignored song", { name: "Ann" }));
  for (const [i, n] of ["one", "two", "three"].entries()) made[0].emit("chat", say(`!play ${n} song`, { name: "P" + i }));
  await until(async () => (await titles()).length === 2);
  assert.deepEqual(await titles(), ["one song", "two song"], "!sr is not the command now, and only 2 are shown");
  assert.equal(await text(".songs__title"), "Requests");
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector(".song__by")).display`), "none");
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector(".song__art")).display`), "none");
});

test("overlay: practice mode fills the queue by itself and moves on, with nobody live", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(`${base}/overlay/songs/?demo=1&pace=500`, { settle: 800 });
  await until(async () => (await titles()).length >= 3, 8000);
  assert.ok((await text(".song--now .song__title")).length > 2);
  assert.ok(await page.evaluate(`document.querySelector(".song--now .song__img")?.src.startsWith("data:image/svg+xml")`), "a practice song has its own cover");
  const first = await text(".song--now .song__title");
  await until(async () => (await text(".song--now .song__title")) !== first, 15000);
});

test("editor: the test buttons add requests and move on, and the link carries the settings", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/songs/", { settle: 800 });
  await click('[data-test="one"]');
  await until(async () => (await titles()).length === 1);
  await click('[data-test="three"]');
  await until(async () => (await titles()).length === 4, 6000); // the one from before and the three, which arrive a moment apart
  const before = 4;
  const first = await text(".song--now .song__title");
  await click('[data-test="next"]');
  await until(async () => (await titles()).length === before - 1);
  assert.notEqual(await text(".song--now .song__title"), first);
  await click('[data-test="clear"]');
  await until(async () => (await titles()).length === 0);
  await page.evaluate(`(() => { const i = document.getElementById("source-channel"); i.value = "pond.pal"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  const url = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(url.pathname, "/overlay/songs/");
  assert.equal(url.searchParams.get("channel"), "pond.pal");
});

test("editor: connected to a LIVE, chat commands fill the preview and the streamer's !next works", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(base + "/songs/?channel=pond_cafe", { settle: 800 });
  await until(() => made.length === 1);
  await sleep(200);
  made[0].emit("chat", say("!sr a real request", { name: "Ann" }));
  await until(async () => (await titles()).includes("a real request"));
  made[0].emit("chat", say("!next", { name: "Pond_Cafe", login: "pond_cafe" }));
  await until(async () => !(await titles()).includes("a real request"));
});

test("overlay: letter spacing from the link spaces the letters, and the default leaves them alone", { skip }, async () => {
  const { base } = await withHelper();
  const spacing = (selector) => page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).letterSpacing`);
  await page.goto(`${base}/overlay/songs/?demo=1&pace=400&letterSpacing=3.5`, { settle: 900 });
  await until(async () => (await titles()).length >= 1);
  assert.equal(await spacing(".song__title"), "3.5px");
  for (const path of ["/overlay/gifts/?demo=1&letterSpacing=2", "/overlay/goal/?demo=1&letterSpacing=2", "/overlay/likers/?demo=1&letterSpacing=2", "/overlay/alerts/?demo=1&letterSpacing=2"]) {
    await page.goto(base + path, { settle: 900 });
    const root = await page.evaluate("[...document.querySelectorAll('.giftlist, .goal, .likers, .alerts')].map((e) => getComputedStyle(e).letterSpacing)");
    assert.deepEqual(root, ["2px"], path);
  }
  await page.goto(`${base}/overlay/songs/?demo=1&pace=400`, { settle: 900 });
  await until(async () => (await titles()).length >= 1);
  assert.ok(["normal", "0px"].includes(await spacing(".song__title")), "the default leaves the font's own spacing");
  const { base: chatBase, made } = await withHelper();
  await page.goto(`${chatBase}/overlay/?channel=pond_cafe&platform=tiktok&letter=4`, { settle: 900 });
  await until(() => made.length === 1);
  await sleep(200);
  made[0].emit("chat", say("hello there"));
  await until(async () => (await page.evaluate("document.querySelectorAll('.m').length")) === 1);
  assert.equal(await page.evaluate("getComputedStyle(document.querySelector('.m')).letterSpacing"), "4px", "the chat overlay too");
});

test("overlay: layouts and what it shows come from the link", { skip }, async () => {
  const { base, made } = await withHelper();
  const probe = () => page.evaluate(`(() => {
    const now = document.querySelector(".song--now");
    const shown = (selector) => { const e = document.querySelector(selector); return Boolean(e) && e.getClientRects().length > 0; }; // drawn at all (a hidden parent counts)
    return { layout: document.querySelector(".songs")?.dataset.layout ?? null, now: shown(".songs__now .song"), rows: shown(".songs__rows .song"), title: shown(".songs__title"), by: shown(".song--now .song__by"), label: shown(".song--now .song__label") };
  })()`);
  const open = async (query) => {
    await page.goto(`${base}/overlay/songs/?demo=1&pace=400&${query}`, { settle: 900 });
    await until(async () => (await titles()).length >= 3, 9000);
  };
  await open("layout=card");
  assert.deepEqual(await probe(), { layout: "card", now: true, rows: true, title: true, by: true, label: true });
  await open("layout=strip");
  const strip = await probe();
  assert.equal(strip.layout, "strip");
  assert.deepEqual([strip.by, strip.label], [false, false], "a strip is one slim line: no label, no asker");
  await open("layout=disc");
  assert.equal((await probe()).layout, "disc");
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector(".song--now .song__art")).borderRadius`), "50%", "the cover is round");
  await open("layout=stack");
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector(".song--now")).flexDirection`), "column");
  await page.goto(`${base}/overlay/songs/?demo=1&pace=400&show=now`, { settle: 900 });
  await until(async () => (await probe()).now, 8000);
  assert.deepEqual(await probe(), { layout: "card", now: true, rows: false, title: false, by: true, label: true }, "only the song playing, even with 'make the first song stand out' off or on");
  await page.goto(`${base}/overlay/songs/?demo=1&pace=400&show=queue`, { settle: 900 });
  await until(async () => (await probe()).rows, 8000);
  const queueOnly = await probe();
  assert.deepEqual([queueOnly.now, queueOnly.rows, queueOnly.title], [false, true, true]);
});

test("editor: changing how the song playing looks, and what the overlay shows, changes the preview at once", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/songs/", { settle: 800 });
  await click('[data-test="three"]');
  await until(async () => (await titles()).length >= 2, 6000);
  const pick = (id, value) => page.evaluate(`(() => { const s = document.getElementById(${JSON.stringify(id)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event("change", { bubbles: true })); s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  const look = () => page.evaluate(`(() => { const n = document.querySelector(".song--now"); const art = n.querySelector(".song__art"); const rows = document.querySelector(".songs__rows"); return { direction: getComputedStyle(n).flexDirection, round: getComputedStyle(art).borderRadius === "50%", byShown: n.querySelector(".song__by").getClientRects().length > 0, rowsShown: rows.getClientRects().length > 0, nowShown: n.getClientRects().length > 0 }; })()`);
  assert.deepEqual(await look(), { direction: "row", round: false, byShown: true, rowsShown: true, nowShown: true });
  await pick("c-layout", "stack");
  assert.equal((await look()).direction, "column", "stack: the cover on top");
  await pick("c-layout", "disc");
  assert.equal((await look()).round, true, "disc: a round record");
  await pick("c-layout", "strip");
  assert.equal((await look()).byShown, false, "strip: one slim line, no asker");
  await pick("c-layout", "card");
  assert.deepEqual(await look(), { direction: "row", round: false, byShown: true, rowsShown: true, nowShown: true }, "and back");
  await pick("c-show", "now");
  assert.equal((await look()).rowsShown, false, "only the song playing");
  await pick("c-show", "queue");
  const queueOnly = await look();
  assert.deepEqual([queueOnly.nowShown, queueOnly.rowsShown], [false, true], "only the queue");
  await pick("c-show", "both");
  assert.deepEqual([(await look()).nowShown, (await look()).rowsShown], [true, true]);
  const link = await page.evaluate(`(() => { const i = document.getElementById("source-channel"); i.value = "pond.pal"; i.dispatchEvent(new Event("input", { bubbles: true })); return document.getElementById("link").value; })()`);
  await pick("c-layout", "disc");
  await pick("c-show", "now");
  const url = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.deepEqual([url.searchParams.get("layout"), url.searchParams.get("show")], ["disc", "now"], "the link carries the choice");
  assert.ok(link.includes("channel=pond.pal"));
});

test("overlay: glass, equalizer, capsule and poster each show their own parts, and the progress bar fills over the song", { skip }, async () => {
  const { base } = await withHelper();
  const probe = () => page.evaluate(`(() => {
    const now = document.querySelector(".song--now");
    const drawn = (selector) => { const e = now.querySelector(selector); return Boolean(e) && e.getClientRects().length > 0; };
    const cs = (selector, prop) => getComputedStyle(selector ? now.querySelector(selector) : now)[prop];
    return { bg: drawn(".song__bg"), bars: drawn(".song__bars"), progress: drawn(".song__progress"), radius: cs("", "borderRadius"), dir: cs("", "flexDirection"), artRound: cs(".song__art", "borderRadius") === "50%", by: drawn(".song__by"), label: drawn(".song__label") };
  })()`);
  const open = async (query) => {
    await page.goto(`${base}/overlay/songs/?demo=1&pace=400&${query}`, { settle: 900 });
    await until(async () => (await titles()).length >= 2, 9000);
    await until(async () => await page.evaluate('document.querySelector(".song--now")?.classList.contains("song--timed")'), 5000);
  };
  await open("layout=glass");
  const glass = await probe();
  assert.deepEqual([glass.bg, glass.bars, glass.progress], [true, false, true], "glass: a blurred cover and a progress bar");
  await open("layout=equalizer");
  const eq = await probe();
  assert.deepEqual([eq.bg, eq.bars, eq.progress], [false, true, true], "equalizer: bouncing bars");
  await open("layout=capsule");
  const capsule = await probe();
  assert.equal(capsule.artRound, true, "capsule: a round disc");
  assert.ok(parseFloat(capsule.radius) > 100, "capsule: a pill");
  assert.deepEqual([capsule.by, capsule.label], [false, false]);
  await open("layout=poster");
  const poster = await probe();
  assert.equal(poster.dir, "column", "poster: the cover on top");
  assert.equal(poster.bars, false);
  await open("layout=glass&progress=0");
  assert.equal((await probe()).progress, false, "the progress bar can be switched off");
  await open("layout=strip");
  assert.equal((await probe()).progress, false, "a strip is one slim line: no bar");
  await open("layout=card");
  const bar = await page.evaluate(`(() => { const i = document.querySelector(".song--now .song__progress i"); const cs = getComputedStyle(i); return { duration: parseFloat(cs.animationDuration), name: cs.animationName }; })()`);
  assert.equal(bar.name, "song-progress");
  assert.ok(bar.duration >= 100, "the bar fills over the song's own length: " + bar.duration);
});

test("overlay: a title that does not fit slides instead of being cut, and a short one stays still", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/songs/?channel=pond_cafe&platform=tiktok&size=40`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("chat", say("!sr " + "a very long song title that will never fit in the card ".repeat(2), { name: "Ann" }));
  await until(async () => (await titles()).length === 1);
  await until(async () => await page.evaluate('document.querySelector(".song--now .song__title").classList.contains("is-long")'), 4000);
  assert.equal(await page.evaluate('getComputedStyle(document.querySelector(".song--now .song__t")).animationName'), "song-slide");
  await page.goto(`${base}/overlay/songs/?channel=pond_cafe&platform=tiktok&scrollTitle=0`, { settle: 800 });
  await until(() => made.length >= 1);
  made.at(-1).emit("chat", say("!sr " + "a very long song title that will never fit in the card ".repeat(2), { name: "Ann", id: 9991 }));
  await until(async () => (await titles()).length === 1);
  await sleep(300);
  assert.equal(await page.evaluate('getComputedStyle(document.querySelector(".song--now .song__t")).animationName'), "none", "switched off: it is cut as before");
});

test("overlay: the cover shape, glow and blur work on any layout, and boxy and minimal look like themselves", { skip }, async () => {
  const { base } = await withHelper();
  const open = async (query) => {
    await page.goto(`${base}/overlay/songs/?demo=1&pace=400&${query}`, { settle: 900 });
    await until(async () => (await titles()).length >= 2, 9000);
  };
  const art = (prop) => page.evaluate(`getComputedStyle(document.querySelector(".song--now .song__art"))[${JSON.stringify(prop)}]`);
  await open("layout=card&coverShape=round");
  assert.equal(await art("borderRadius"), "50%", "round, on a card");
  assert.equal(await art("animationName"), "none");
  await open("layout=card&coverShape=vinyl");
  assert.equal(await art("animationName"), "song-spin", "vinyl: it turns");
  await open("layout=disc&coverShape=square");
  assert.equal(await art("borderRadius"), "0px", "square wins over the disc layout's round cover");
  await open("layout=card&coverGlow=1");
  assert.notEqual(await art("boxShadow"), "none", "glow");
  await open("layout=card");
  assert.equal(await art("boxShadow"), "none");
  await open("layout=card&coverBlur=1");
  assert.equal(await page.evaluate('document.querySelector(".song--now .song__bg").getClientRects().length > 0'), true, "blur on a card");
  await open("layout=card");
  assert.equal(await page.evaluate('document.querySelector(".song--now .song__bg").getClientRects().length > 0'), false, "and not unless asked");
  await open("layout=boxy");
  const boxy = await page.evaluate(`(() => { const n = document.querySelector(".song--now"); const art = getComputedStyle(n.querySelector(".song__art")); const text = getComputedStyle(n.querySelector(".song__text")); return { card: getComputedStyle(n).backgroundColor, artBorder: parseFloat(art.borderTopWidth), textBorder: parseFloat(text.borderTopWidth), textBg: text.backgroundColor }; })()`);
  assert.equal(boxy.card, "rgba(0, 0, 0, 0)", "boxy: no card behind the two boxes");
  assert.ok(boxy.artBorder > 0 && boxy.textBorder > 0 && boxy.textBg !== "rgba(0, 0, 0, 0)", "the cover and the words each in a box of their own");
  await open("layout=minimal");
  const minimal = await page.evaluate(`(() => { const n = document.querySelector(".song--now"); const cs = getComputedStyle(n); return { bg: cs.backgroundColor, border: parseFloat(cs.borderTopWidth), art: n.querySelector(".song__art").getClientRects().length, shadow: getComputedStyle(n.querySelector(".song__text")).textShadow !== "none" }; })()`);
  assert.deepEqual(minimal, { bg: "rgba(0, 0, 0, 0)", border: 0, art: 0, shadow: true }, "minimal: just the words, with a shadow so they read on any picture");
});

test("overlay: before the first request a card says how to ask, in the streamer's own command word, and it can be switched off", { skip }, async () => {
  const { base, made } = await withHelper();
  const idle = () => page.evaluate(`(() => { const e = document.querySelector(".songs__idle"); return e && e.getClientRects().length > 0 ? e.querySelector(".songs__idletext").textContent.trim() : null; })()`);
  await page.goto(`${base}/overlay/songs/?channel=pond_cafe&platform=tiktok`, { settle: 900 });
  await until(() => made.length === 1);
  assert.match(await idle(), /Nothing playing. Type !sr and a song name./);
  made[0].emit("chat", say("!sr first song", { name: "Ann" }));
  await until(async () => (await titles()).length === 1);
  assert.equal(await idle(), null, "gone as soon as there is a song");
  await page.goto(`${base}/overlay/songs/?channel=pond_two&platform=tiktok&command=play`, { settle: 900 });
  assert.match(await idle(), /Type !play and a song name/, "it follows the command word");
  await page.goto(`${base}/overlay/songs/?channel=pond_two&platform=tiktok&idleCard=0`, { settle: 900 });
  assert.equal(await idle(), null, "switched off");
  await page.goto(`${base}/overlay/songs/?channel=pond_two&platform=tiktok&show=queue`, { settle: 900 });
  assert.equal(await idle(), null, "the queue-only overlay has no card of its own");
  await page.goto(`${base}/overlay/songs/?channel=pond_two&platform=tiktok&idleText=Ask+with+%21{command}`, { settle: 900 });
  assert.equal(await idle(), "Ask with !sr", "its own words");
});

test("spotify test pages: they load under the security policy, say what to do, and the callback explains a visit that did not come from Spotify", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/spotify/", { settle: 900 });
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
  assert.match(await text("#sp-status"), /Not logged in/);
  assert.equal(await page.evaluate('document.getElementById("sp-login-btn").hidden'), false);
  assert.equal(await page.evaluate('document.getElementById("sp-now-card").hidden'), true, "the player parts wait for a login");
  const facts = await page.evaluate('[...document.querySelectorAll("#sp-facts dd")].map((e) => e.textContent)');
  assert.ok(facts[0].startsWith("48c133"), "it says which Spotify app it uses");
  assert.ok(facts[1].endsWith("/spotify/callback/"), "and the redirect address to register: " + facts[1]);
  assert.equal(await page.evaluate('document.querySelector("meta[name=robots]")?.content'), "noindex, nofollow");
  await page.goto(base + "/spotify/callback/", { settle: 900 });
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
  assert.match(await text("#sp-status"), /needs to be opened by Spotify/);
  await page.goto(base + "/spotify/callback/?error=access_denied&state=x", { settle: 900 });
  assert.match(await text("#sp-status"), /said no/);
});

test("spotify test page: the chat section is part of the page and waits for a login like the rest", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/spotify/", { settle: 900 });
  assert.equal(await page.evaluate('document.getElementById("sp-chat-card").hidden'), true, "hidden until logged in");
  for (const id of ["sp-channel", "sp-listen", "sp-real", "sp-fake", "sp-log"]) assert.equal(await page.evaluate(`Boolean(document.getElementById(${JSON.stringify(id)}))`), true, id);
  assert.equal(await page.evaluate('document.getElementById("sp-real").checked'), false, "it never touches the real queue unless asked");
});

test("overlay: the song playing wears the uploaded picture in place of the album cover, and the queue keeps album covers", { skip }, async () => {
  const { base } = await withHelper();
  const id = "AbCdEfGhIjKlMnOp";
  await page.goto(`${base}/overlay/songs/?demo=1&pace=400&coverMedia=${id}`, { settle: 900 });
  await until(async () => (await titles()).length >= 3, 9000);
  const srcs = await page.evaluate(`({ now: document.querySelector(".song--now .song__img")?.getAttribute("src"), nowBg: document.querySelector(".song--now .song__bg")?.getAttribute("src"), row: document.querySelector(".songs__rows .song .song__img")?.getAttribute("src") })`);
  assert.equal(srcs.now, "/api/media/" + id, "the song playing: the uploaded picture");
  assert.equal(srcs.nowBg, "/api/media/" + id, "and the blur behind it, when that is on, is the same picture");
  assert.match(srcs.row, /^data:image\/svg\+xml/, "the songs waiting keep their own covers");
  await page.goto(`${base}/overlay/songs/?demo=1&pace=400&coverMedia=not-a-real-id`, { settle: 900 });
  await until(async () => (await titles()).length >= 2, 9000);
  assert.match(await page.evaluate('document.querySelector(".song--now .song__img").getAttribute("src")'), /^data:image\/svg\+xml/, "a made-up id is ignored");
  await page.goto(base + "/songs/", { settle: 900 });
  assert.equal(await page.evaluate('Boolean(document.getElementById("media-ok"))'), true, "the box to tick");
  assert.equal(await page.evaluate('[...document.querySelectorAll("#opt-controls .media__choose")].length'), 1, "and one place to choose a picture");
});
