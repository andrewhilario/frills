// The alerts in a real headless Chrome: the editor (every test button, the options, the link, the "what Frills sees" counters) and the
// overlay (a pretend TikTok behind the helper sends follows, gifts and shares; they appear, wait their turn, join into a crowd, and make
// their sound). Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createStatic } from "../scripts/lib/static.mjs";
import { createHelper } from "../helper/server.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "alerts", "index.html"))) throw new Error("dist/ has no alerts page. Run `npm run build` first (`npm test` does that for you).");

let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

class FakeConnection extends EventEmitter {
  async connect() { await sleep(5); }
  disconnect() { this.emit("disconnected"); }
}
const opened = [];
async function withHelper() {
  const made = [];
  const helper = createHelper({ distDir: dist, factory: async () => { const conn = new FakeConnection(); made.push(conn); return conn; }, idleStopMs: 200, offlineWaitMs: 5000 });
  const port = await helper.listen(0);
  opened.push(helper);
  return { base: `http://127.0.0.1:${port}`, made };
}
const until = async (test, ms = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await test()) return; await sleep(30); }
  throw new Error("Timed out");
};

let page;
before(async () => {
  if (skip) return;
  page = await launch();
  await page.viewport(1280, 900);
});
after(async () => {
  await page?.close();
  for (const h of opened) await h.close();
});

const person = (id, name) => ({ id, displayId: name.toLowerCase().replace(/\W/g, "_"), nickname: name });
const follow = (id, name) => ({ common: { msgId: id }, user: person(id, name) });
const gift = (id, name, giftName, diamondCount, count = 1) => ({ common: { msgId: id }, user: person(id, name), gift: { name: giftName, type: 2, diamondCount }, repeatCount: count });
const cards = () => page.evaluate(`[...document.querySelectorAll(".alert")].map((a) => ({ kind: a.dataset.kind, tier: a.dataset.tier, out: a.classList.contains("alert--out"), text: a.querySelector(".alert__words").textContent }))`);
const liveCards = async () => (await cards()).filter((c) => !c.out);
const click = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const type = (selector, value) => page.evaluate(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
/** Counts what the page asks its (pretend) audio system to play, so sound is tested without hearing it. */
const spyOnAudio = () => page.send("Page.addScriptToEvaluateOnNewDocument", { source: `
  window.__notes = [];
  window.AudioContext = class { constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
    resume() { return Promise.resolve(); } createGain() { return { gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    createOscillator() { const o = { frequency: { setValueAtTime(f) { window.__notes.push(Math.round(f)); }, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; return o; } };` });

test("the alerts pages load under the security policy with no console errors", { skip }, async () => {
  for (const path of ["/alerts/", "/overlay/alerts/?demo=1"]) {
    const { base } = await withHelper();
    await page.goto(base + path, { settle: 700 });
    assert.deepEqual(page.problems, [], `${path}: ${page.problems.join(" | ")}`);
  }
});

test("editor: each test button shows its alert, a big gift is bigger, and a crowd joins into one", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/alerts/", { settle: 700 });
  await click('[data-test="follow"]');
  await until(async () => (await liveCards()).some((c) => c.kind === "follow"));
  assert.match((await liveCards())[0].text, /just followed!$/);
  await click('[data-test="share"]');
  await click('[data-test="gift-3"]');
  await until(async () => (await liveCards()).some((c) => c.kind === "gift"));
  const big = (await liveCards()).find((c) => c.kind === "gift");
  assert.equal(big.tier, "3", "a big gift is the biggest size");
  assert.match(big.text, /!!$/, "and uses the big-gift wording");
  // a crowd: with room for two on screen, six follows wait and the waiting ones join
  await click('[data-test="crowd"]');
  await sleep(300);
  const state = await page.evaluate(`document.querySelectorAll(".alert").length`);
  assert.ok(state <= 3, "no pile-up of cards: only what fits is on screen (" + state + ")");
});

test("editor: changing the words, the look and the position changes the alert and the link", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/alerts/", { settle: 700 });
  await type("#c-followText", "Welcome {name}, you are brilliant!");
  await click('[data-test="follow"]');
  await until(async () => (await liveCards()).some((c) => c.kind === "follow"));
  assert.match((await liveCards())[0].text, /^Welcome .+, you are brilliant!$/);
  await click('#looks .chip:nth-child(3)'); // Night
  assert.equal(await page.evaluate(`document.getElementById("alerts").style.getPropertyValue("--a-accent")`), "#9db4ff");
  assert.equal(await page.evaluate(`document.getElementById("alerts").style.getPropertyValue("--a-font")`).then((f) => f.includes("Plus Jakarta Sans")), true);
  await page.evaluate(`[...document.querySelectorAll("#move-controls .chip")].find((b) => b.textContent.trim() === "Bottom").click()`);
  assert.equal(await page.evaluate(`document.getElementById("alerts").dataset.vpos`), "bottom");
  // the link appears with a name, carrying only what was changed
  await type("#source-channel", "pond.pal");
  const link = await page.evaluate(`document.getElementById("link").value`);
  const url = new URL(link);
  assert.equal(url.pathname, "/overlay/alerts/");
  assert.equal(url.searchParams.get("channel"), "pond.pal");
  assert.equal(url.searchParams.get("platform"), "tiktok");
  assert.equal(url.searchParams.get("vpos"), "bottom");
  assert.equal(url.searchParams.get("accent"), "#9db4ff");
  assert.ok(url.searchParams.get("followText").startsWith("Welcome"));
  assert.ok(!url.searchParams.has("giftText"), "unchanged settings are not in the link");
  assert.equal(await page.evaluate(`document.getElementById("copy-link").disabled`), false);
});

test("overlay: follows, gifts and shares from a TikTok LIVE appear, a gift is sized, and sound plays for each", { skip }, async () => {
  await spyOnAudio();
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/alerts/?channel=pond_cafe&platform=tiktok&maxShown=3&followSound=pop&giftSound=pop&shareSound=pop&volume=80&followTime=3`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("follow", follow("f1", "Mochi Bun"));
  made[0].emit("share", follow("s1", "Croaker"));
  made[0].emit("gift", gift("g1", "Little Lily", "Galaxy", 1500));
  await until(async () => (await liveCards()).length === 3);
  const shown = await liveCards();
  assert.deepEqual(shown.map((c) => c.kind).sort(), ["follow", "gift", "share"]);
  assert.match(shown.find((c) => c.kind === "follow").text, /^Mochi Bun just followed!$/);
  assert.match(shown.find((c) => c.kind === "share").text, /^Croaker shared the LIVE!$/);
  const g = shown.find((c) => c.kind === "gift");
  assert.equal(g.tier, "3");
  assert.match(g.text, /^Little Lily sent Galaxy ×1!!$/);
  // pop is one note, played once for each of a follow (tier 1), a share (tier 1) and a tier 3 gift (3 layers)
  const notes = await page.evaluate(`window.__notes.length`);
  assert.equal(notes, 1 + 1 + 3, "one note each for the follow and the share, three for the big gift");
  // and they leave by themselves, the follow first
  await until(async () => !(await liveCards()).some((c) => c.kind === "follow"), 6000);
});

test("overlay: a kind that is switched off, and a gift smaller than the smallest wanted, never show", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/alerts/?channel=pond_cafe&platform=tiktok&shareOn=0&giftMin=50`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("share", follow("s1", "Croaker"));
  made[0].emit("gift", gift("g1", "Little Lily", "Rose", 1));
  made[0].emit("gift", gift("g2", "Kero Chan", "Panda", 100));
  made[0].emit("follow", follow("f1", "Mochi Bun"));
  await until(async () => (await liveCards()).length >= 2);
  await sleep(300);
  assert.deepEqual((await liveCards()).map((c) => c.kind).sort(), ["follow", "gift"], "no share, no Rose");
  assert.match((await liveCards()).find((c) => c.kind === "gift").text, /Panda/);
});

test("overlay: with one place on screen, the rest wait their turn and the people who follow in a crowd are joined", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/alerts/?channel=pond_cafe&platform=tiktok&maxShown=1&followTime=2&speed=250`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  for (const [i, name] of ["Ann", "Ben", "Cat", "Dan", "Eve"].entries()) made[0].emit("follow", follow("f" + i, name));
  await until(async () => (await liveCards()).length === 1);
  assert.match((await liveCards())[0].text, /^Ann just followed!$/);
  await until(async () => (await liveCards()).some((c) => /others followed/.test(c.text)), 8000);
  assert.match((await liveCards())[0].text, /^Ben and 3 others followed!$/, "Ben, Cat, Dan and Eve were joined into one");
});

test("editor: the counters show what arrived from a connected account, and an older relay is called out", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(base + "/alerts/", { settle: 700 });
  await type("#source-channel", "pond_cafe");
  await page.evaluate(`[...document.querySelectorAll("#source button")].find((b) => b.textContent.trim() === "Connect").click()`);
  await until(() => made.length === 1);
  await sleep(200);
  made[0].emit("follow", follow("f1", "Mochi Bun"));
  made[0].emit("follow", follow("f2", "Croaker"));
  made[0].emit("gift", gift("g1", "Little Lily", "Rose", 1));
  await until(async () => (await page.evaluate(`document.getElementById("seen-follow").textContent`)) === "2");
  assert.equal(await page.evaluate(`document.getElementById("seen-gift").textContent`), "1");
  assert.equal(await page.evaluate(`document.getElementById("seen-share").textContent`), "0");
  assert.match(await page.evaluate(`document.getElementById("seen-note").textContent`), /can send alerts/);

  // an old relay: same address, but its ping says chat only and its stream sends no alerts
  const old = http.createServer((req, res) => {
    if (req.url.startsWith("/tiktok/ping")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, name: "frills-helper", version: "0.1.0" })); return; }
    createStatic(dist)(req, res);
  });
  await new Promise((resolve) => old.listen(0, "127.0.0.1", resolve));
  try {
    await page.goto(`http://127.0.0.1:${old.address().port}/alerts/`, { settle: 800 });
    assert.match(await page.evaluate(`document.getElementById("seen-note").textContent`), /older version that can only send chat/);
  } finally {
    old.closeAllConnections?.();
    old.close();
  }
});

test("overlay: an old relay that cannot send alerts is called out on the page, and demo mode shows practice alerts", { skip }, async () => {
  const old = http.createServer((req, res) => {
    if (req.url.startsWith("/tiktok/ping")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, name: "frills-helper", version: "0.1.0" })); return; }
    createStatic(dist)(req, res);
  });
  await new Promise((resolve) => old.listen(0, "127.0.0.1", resolve));
  try {
    await page.goto(`http://127.0.0.1:${old.address().port}/overlay/alerts/?channel=pond_cafe&platform=tiktok`, { settle: 900 });
    await until(async () => /needs an update/.test((await page.evaluate(`document.getElementById("note").textContent`)) ?? ""));
  } finally {
    old.closeAllConnections?.();
    old.close();
  }
  const { base } = await withHelper();
  await page.goto(`${base}/overlay/alerts/?demo=1`, { settle: 600 });
  await until(async () => (await cards()).length > 0, 6000);
});

// ── Card styles ───────────────────────────────────────────────────────────────────────────────────────────────────────

test("overlay: each card style draws its own format, and a style that does not exist is ignored", { skip }, async () => {
  const { base } = await withHelper();
  const probe = async (card) => {
    await page.goto(`${base}/overlay/alerts/?demo=1&only=gift&pace=300&maxShown=1&hpos=left&offset=0&card=${card}`, { settle: 500 });
    await until(async () => (await cards()).length > 0, 8000);
    return page.evaluate(`(() => {
      const card = document.querySelector(".alert .alert__card");
      const cs = getComputedStyle(card);
      const host = document.querySelector(".alerts");
      const tag = card.querySelector(".alert__tag");
      const av = card.querySelector(".alert__av");
      return {
        style: host.dataset.card, dir: cs.flexDirection, edge: cs.borderTopStyle, top: parseFloat(cs.borderTopWidth), left: parseFloat(cs.borderLeftWidth), bg: cs.backgroundColor, bgImage: cs.backgroundImage,
        radius: parseFloat(cs.borderTopLeftRadius), shadow: cs.boxShadow, words: cs.textShadow, filter: cs.filter, width: card.offsetWidth, em: parseFloat(cs.fontSize),
        before: getComputedStyle(card, "::before").content, after: getComputedStyle(card, "::after").content, afterShown: getComputedStyle(card, "::after").display,
        tagShown: getComputedStyle(tag).display, tagText: tag.textContent, art: av ? av.offsetWidth / card.offsetWidth : 0,
        wide: Math.round(card.parentElement.offsetWidth / host.clientWidth * 100), // the layout width: the entrance animation scales what getBoundingClientRect measures
      };
    })()`);
  };
  const IDS = ["card", "trading", "profile", "ticket", "polaroid", "stack", "note", "capsule", "banner", "bubble", "neon", "text"];
  const all = {};
  for (const id of IDS) all[id] = await probe(id);
  for (const [id, r] of Object.entries(all)) assert.equal(r.style, id);
  assert.deepEqual([all.card.dir, all.card.edge, all.card.tagShown], ["row", "solid", "none"], "the simple card: a row with an edge, and no label");
  assert.ok(all.card.top > 0 && all.card.bg !== "rgba(0, 0, 0, 0)" && all.card.wide < 80, "with a color and the width of its words");
  // the cards that are objects of their own
  assert.equal(all.trading.dir, "column", "a trading card is tall");
  assert.ok(all.trading.tagShown === "block" && ["Gift"].includes(all.trading.tagText), "with a name bar saying what it is: " + all.trading.tagText);
  assert.ok(all.trading.art > 0.8 && all.trading.width < all.trading.em * 13, "and a picture window across it: " + all.trading.art);
  assert.ok(all.trading.shadow.includes("inset") && all.trading.shadow.split("rgb").length > 3, "in a double frame");
  assert.equal(all.profile.dir, "column", "a profile card stacks");
  assert.ok(!["none", "normal"].includes(all.profile.before) && all.profile.tagShown === "block", "with a banner across the top and a label on it");
  assert.ok(all.ticket.bgImage.includes("radial-gradient") && all.ticket.filter.includes("drop-shadow") && all.ticket.top === 0, "a ticket has cut-out notches and a shadow that follows its shape");
  assert.ok(all.polaroid.dir === "column" && all.polaroid.width < all.polaroid.em * 10 && !["none", "normal"].includes(all.polaroid.before), "a polaroid is a narrow frame with tape on top");
  assert.ok(all.stack.shadow.split("rgb").length >= 5, "a stack has cards behind it: " + all.stack.shadow);
  assert.ok(all.note.bgImage.includes("linear-gradient") && !["none", "normal"].includes(all.note.before) && !["none", "normal"].includes(all.note.after) && all.note.afterShown === "block", "a sticky note has tape and a folded corner");
  for (const id of ["trading", "profile", "ticket", "polaroid", "stack"]) assert.notEqual(all[id].afterShown, "block", id + ": no big-gift ring");
  // the simpler formats
  assert.ok(all.capsule.radius >= 500, "the capsule is rounded all the way: " + all.capsule.radius);
  assert.ok(all.banner.wide >= 95 && all.banner.top === 0 && all.banner.left > all.card.top, `the banner runs across and has a bar on one side (${all.banner.wide}%)`);
  assert.ok(!["none", "normal"].includes(all.bubble.before), "the bubble has a tail: " + all.bubble.before);
  assert.ok(all.neon.shadow.includes("inset"), "the neon edge glows inside as well as out: " + all.neon.shadow);
  assert.ok(all.text.bg === "rgba(0, 0, 0, 0)" && all.text.top === 0 && all.text.shadow === "none" && all.text.words !== "none", "text only has no box and an outline on the words");
  assert.equal((await probe("sideways")).style, "card", "a made-up style is the plain card");
});

test("overlay: the label on a card says what the alert is (follow, gift, share)", { skip }, async () => {
  const { base } = await withHelper();
  const labels = [];
  for (const only of ["follow", "gift", "share"]) {
    await page.goto(`${base}/overlay/alerts/?demo=1&only=${only}&pace=300&maxShown=1&card=trading`, { settle: 500 });
    await until(async () => (await cards()).length > 0, 8000);
    labels.push(await page.evaluate(`document.querySelector(".alert__tag").textContent`));
  }
  assert.deepEqual(labels, ["New follower", "Gift", "Shared the LIVE"]);
});

test("overlay: the frog pond card (a style only the Matcha page offers) wears a frog on top, a lily pad on the corner and sparkles, and room is left for the frog", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(`${base}/overlay/alerts/?demo=1&only=follow&pace=300&maxShown=1&look=matcha&card=frogpond&vpos=middle`, { settle: 600 });
  await until(async () => (await cards()).length > 0, 8000);
  await until(() => page.evaluate(`document.querySelectorAll(".alert__deco img").length > 0 && [...document.querySelectorAll(".alert__deco img")].every((i) => i.complete)`), 5000);
  const r = await page.evaluate(`(() => {
    const alert = document.querySelector(".alert");
    const imgs = [...alert.querySelectorAll(".alert__deco img")];
    const peek = alert.querySelector("img.deco__peek");
    const card = alert.querySelector(".alert__card").getBoundingClientRect();
    const box = peek.getBoundingClientRect();
    return { style: document.querySelector(".alerts").dataset.card, loaded: imgs.every((i) => i.naturalWidth > 0 && i.src.includes("/decor/frog2/")), peek: peek.src.split("/").pop(), corner: Boolean(alert.querySelector("img.deco__corner")), sparks: alert.querySelectorAll(".deco__spark").length, onTop: box.bottom > card.top && box.bottom - card.top <= 10, margin: parseFloat(getComputedStyle(alert).marginTop) };
  })()`);
  assert.deepEqual({ ...r, peek: undefined, margin: undefined }, { style: "frogpond", loaded: true, peek: undefined, corner: true, sparks: 3, onTop: true, margin: undefined });
  assert.match(r.peek, /^peeker-[ab]\.webp$/);
  assert.ok(r.margin > 10, "the frog has room above the card: " + r.margin);
  await page.goto(`${base}/overlay/alerts/?demo=1&only=follow&pace=300&maxShown=1&card=trading`, { settle: 600 });
  await until(async () => (await cards()).length > 0, 8000);
  assert.equal(await page.evaluate(`document.querySelectorAll(".alert__deco").length`), 0, "no other style wears pictures");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("editor: Card style is the first Look option, changing it redraws the alert, and the link carries it only when it is not the plain card", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/alerts/", { settle: 700 });
  const label = await page.evaluate(`document.querySelector("#look-controls > *:first-child .ctl__label").textContent.trim()`);
  assert.equal(label, "Card style");
  const names = await page.evaluate(`[...document.querySelectorAll("#look-controls > *:first-child .chip")].map((b) => b.textContent.trim())`);
  assert.deepEqual(names, ["Simple", "Trading card", "Profile card", "Ticket", "Polaroid", "Card stack", "Sticky note", "Capsule", "Banner", "Bubble", "Neon", "Text only"], "and the frog pond is not among them");
  await type("#source-channel", "pond.pal");
  assert.equal(new URL(await page.evaluate(`document.getElementById("link").value`)).searchParams.has("card"), false, "the plain card adds nothing to the link");
  await click('[data-test="follow"]');
  await page.evaluate(`[...document.querySelectorAll("#look-controls > *:first-child .chip")].find((b) => b.textContent.trim() === "Banner").click()`);
  assert.equal(await page.evaluate(`document.getElementById("alerts").dataset.card`), "banner");
  assert.equal(new URL(await page.evaluate(`document.getElementById("link").value`)).searchParams.get("card"), "banner");
  await click('#looks .chip:nth-child(3)'); // choosing a starting look keeps the card style
  assert.equal(await page.evaluate(`document.getElementById("alerts").dataset.card`), "banner");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

// ── Twitch ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const shown = (selector) => page.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].filter((n) => !n.hidden).map((n) => n.dataset.test ?? n.querySelector("summary")?.textContent)`);

test("editor: choosing Twitch shows its own test buttons and sections, and the link names Twitch", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/alerts/?platform=twitch&maxShown=3&subTime=2&subgiftTime=2&bitsTime=2&raidTime=2&speed=250", { settle: 700 });
  assert.deepEqual(await shown(".preview__tests [data-test]"), ["follow", "sub", "resub", "subgift", "bits", "bits-big", "raid"]);
  assert.deepEqual(await shown("details[data-platform]"), ["Follows", "Subs and resubs", "Gifted subs", "Bits", "Raids"]);
  assert.equal((await shown(".seen__list [data-platform]")).length, 4, "four counters: subs, gifted subs, bits and raids");
  await type("#source-channel", "pond_cafe");
  const link = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(link.searchParams.get("platform"), "twitch");
  assert.equal(link.searchParams.get("channel"), "pond_cafe");

  for (const [test, pattern] of [["sub", /subscribed!$/], ["resub", /resubscribed for \d+ months!$/], ["subgift", /gifted \d+ subs!$/], ["bits", /cheered \d+ bits!/], ["bits-big", /cheered \d+ bits!/], ["raid", /is raiding with \d+ viewers!$/]]) {
    await click(`[data-test="${test}"]`);
    await until(async () => (await liveCards()).some((c) => pattern.test(c.text)), 6000);
  }

  // back to TikTok: its buttons return, and the link follows
  await page.evaluate(`[...document.querySelectorAll("#source .chip")].find((b) => b.textContent.trim() === "TikTok").click()`);
  assert.deepEqual(await shown(".preview__tests [data-test]"), ["follow", "gift-1", "gift-3", "share", "crowd"]);
  await type("#source-channel", "pond_cafe");
  assert.equal(new URL(await page.evaluate(`document.getElementById("link").value`)).searchParams.get("platform"), "tiktok");
});

test("overlay: Twitch subs, gifted subs, bits and raids come from Twitch's chat connection and are shown, each once", { skip }, async () => {
  // a pretend Twitch chat server: after the page joins a channel it sends a sub, a repeat of that sub, a batch of 3 gifted subs with its
  // 3 one-by-one lines, a lone gifted sub, a cheer and a raid
  const lines = [
    ":x JOIN #pond",
    "@id=n1;msg-id=sub;login=newbie;display-name=Newbie;msg-param-cumulative-months=1 :tmi.twitch.tv USERNOTICE #pond",
    "@id=n1;msg-id=sub;login=newbie;display-name=Newbie;msg-param-cumulative-months=1 :tmi.twitch.tv USERNOTICE #pond",
    "@id=g1;msg-id=submysterygift;login=kind;display-name=Kind;msg-param-mass-gift-count=3;msg-param-origin-id=b1 :tmi.twitch.tv USERNOTICE #pond",
    "@id=g2;msg-id=subgift;login=kind;display-name=Kind;msg-param-origin-id=b1 :tmi.twitch.tv USERNOTICE #pond",
    "@id=g3;msg-id=subgift;login=kind;display-name=Kind;msg-param-origin-id=b1 :tmi.twitch.tv USERNOTICE #pond",
    "@id=g4;msg-id=subgift;login=kind;display-name=Kind;msg-param-origin-id=b1 :tmi.twitch.tv USERNOTICE #pond",
    "@id=g5;msg-id=subgift;login=solo;display-name=Solo;msg-param-origin-id=lone :tmi.twitch.tv USERNOTICE #pond",
    "@id=c1;bits=50;display-name=Cheerer :cheerer!cheerer@cheerer PRIVMSG #pond :cheer50 go",
    "@id=r1;msg-id=raid;login=big;display-name=Big;msg-param-viewerCount=40 :tmi.twitch.tv USERNOTICE #pond",
  ];
  const added = await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.WebSocket = class {
      constructor(url) { this.url = url; this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 5); }
      send(line) {
        if (!String(line).startsWith("JOIN")) return;
        setTimeout(() => this.onmessage && this.onmessage({ data: ${JSON.stringify(lines.join("\r\n") + "\r\n")} }), 20);
      }
      close() { this.readyState = 3; }
    };` });
  try {
    const { base } = await withHelper();
    await page.goto(`${base}/overlay/alerts/?channel=pond&platform=twitch&maxShown=3&subTime=2&subgiftTime=2&bitsTime=2&raidTime=2&speed=250`, { settle: 600 });
    const seen = new Set();
    await until(async () => { for (const c of await cards()) seen.add(c.text); return seen.size >= 5; }, 15000);
    await sleep(2500); // long enough for a wrongly repeated alert to turn up
    for (const c of await cards()) seen.add(c.text);
    assert.deepEqual([...seen].sort(), ["Big is raiding with 40 viewers!", "Cheerer cheered 50 bits!", "Kind gifted 3 subs!", "Newbie subscribed!", "Solo gifted a sub!"]);
  } finally {
    await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: added.identifier });
  }
});
