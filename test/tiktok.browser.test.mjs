// TikTok in a real headless Chrome: the editor, the matcha page and the overlay talking to the helper (with a pretend TikTok behind it),
// and what they say when there is no helper. Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createStatic } from "../scripts/lib/static.mjs";
import { createHelper } from "../helper/server.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "index.html"))) throw new Error("dist/ is empty. Run `npm run build` first (`npm test` does that for you).");

let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

class FakeConnection extends EventEmitter {
  constructor(script = {}) { super(); this.script = script; this.gone = false; }
  async connect() { await sleep(5); if (this.script.failWith) throw this.script.failWith; }
  disconnect() { if (!this.gone) { this.gone = true; this.emit("disconnected"); } }
}

const opened = [];
/** A helper with a pretend TikTok behind it. `scripts` say how each connection to "TikTok" goes; `tuning` changes its waits. */
async function withHelper(scripts = [], tuning = {}) {
  const made = [];
  const helper = createHelper({ distDir: dist, factory: async (user) => { const conn = new FakeConnection(scripts.shift() ?? {}); made.push({ user, conn }); return conn; }, idleStopMs: 200, offlineWaitMs: 5000, ...tuning });
  const port = await helper.listen(0);
  opened.push(helper);
  return { base: `http://127.0.0.1:${port}`, made, helper };
}
const until = async (test, ms = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (test()) return;
    await sleep(20);
  }
  throw new Error("Timed out waiting for the helper");
};

let page;
let plain; // the site with no helper behind it, like the hosted one
let plainBase;
before(async () => {
  if (skip) return;
  plain = http.createServer(createStatic(dist));
  await new Promise((resolve) => plain.listen(0, "127.0.0.1", resolve));
  plainBase = `http://127.0.0.1:${plain.address().port}`;
  page = await launch();
  await page.viewport(1280, 900);
});
after(async () => {
  await page?.close();
  for (const h of opened) await h.close();
  plain?.closeAllConnections?.();
  plain?.close();
});

const click = (selector, text) => page.evaluate(`(() => { const list = [...document.querySelectorAll(${JSON.stringify(selector)})]; const el = ${text ? `list.find((e) => e.textContent.trim() === ${JSON.stringify(text)})` : "list[0]"}; if (!el) throw new Error("nothing to click: ${selector}"); el.click(); })()`);
const type = (selector, value) => page.evaluate(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const text = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim() ?? null`);
const chat = (id, content, over = {}) => ({ common: { msgId: id }, user: { id: "42", displayId: "pond.pal", nickname: "Pond Pal" }, content, userIdentity: {}, ...over });

test("editor: TikTok comes first, and with the helper running a name connects and real chat appears in the preview and in the link", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(base + "/editor/", { settle: 700 });
  assert.equal(await page.evaluate(`document.querySelector("#source .chip[aria-pressed=true]").textContent.trim()`), "TikTok");
  assert.equal(await text("#source label"), "Your TikTok @name");
  assert.equal(await page.evaluate(`document.querySelector(".source__helper").hidden`), true, "the helper is there, so no warning");

  await type("#source-channel", "  @Pond.Pal ");
  await click("#source .source__row .btn");
  await page.waitFor(`document.getElementById("source-status").dataset.state === "connected"`);
  assert.match(await text("#source-status"), /^Connected to TikTok\. Waiting for the first chat message/, "connected is not yet reading");
  assert.equal(made[0].user, "pond.pal");

  made[0].conn.emit("chat", chat("m1", "hello from the pond"));
  await page.waitFor(`document.getElementById("source-status").textContent === "Reading @pond.pal's LIVE chat"`);
  made[0].conn.emit("chat", chat("m2", "a moderator speaks", { userIdentity: { isModeratorOfAnchor: true } }));
  made[0].conn.emit("gift", { common: { msgId: "g1" }, user: { id: "7", displayId: "ann", nickname: "Ann" }, gift: { name: "Rose", type: 2 }, repeatCount: 3, repeatEnd: 0 });
  await page.waitFor(`document.querySelectorAll("#chat .m").length === 3`);
  const shown = await page.evaluate(`[...document.querySelectorAll("#chat .m")].map((m) => ({ who: m.querySelector(".name").textContent, said: m.querySelector(".txt").textContent, mod: Boolean(m.querySelector(".ico")), gift: m.classList.contains("gift") }))`);
  assert.deepEqual(shown, [
    { who: "Pond Pal", said: "hello from the pond", mod: false, gift: false },
    { who: "Pond Pal", said: "a moderator speaks", mod: true, gift: false },
    { who: "Ann", said: "sent Rose ×3", mod: false, gift: true },
  ]);

  const link = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(link.origin + link.pathname, `${base}/overlay/`);
  assert.equal(link.searchParams.get("channel"), "pond.pal");
  assert.equal(link.searchParams.get("platform"), "tiktok");
  assert.match(await text("#link-hint"), /only works while the Frills helper is running/);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));

  await click("#source .source__row .btn"); // Disconnect
  await page.waitFor(`document.querySelector("#source .source__row .btn").textContent === "Connect"`);
  await sleep(400);
  assert.equal(made[0].conn.gone, true, "disconnecting lets go of TikTok once nobody is watching");
});

test("editor: the choice of platform changes the label and the link, and is remembered", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/editor/", { settle: 600 });
  await page.evaluate("localStorage.clear()");
  await page.goto(base + "/editor/", { settle: 600 });
  await type("#source-channel", "pondpal");
  await click("#source .chip", "Twitch");
  assert.equal(await text("#source label"), "Your Twitch channel");
  assert.equal(await page.evaluate(`document.getElementById("source-channel").value`), "", "each platform keeps its own name");
  await type("#source-channel", "pond_pal");
  let link = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(link.search, "?channel=pond_pal", "a Twitch link has no platform part");
  await click("#source .chip", "TikTok");
  assert.equal(await page.evaluate(`document.getElementById("source-channel").value`), "pondpal");
  link = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(link.search, "?channel=pondpal&platform=tiktok");
  await page.goto(base + "/editor/", { settle: 600 });
  assert.equal(await page.evaluate(`document.querySelector("#source .chip[aria-pressed=true]").textContent.trim()`), "TikTok", "remembered");
  assert.equal(await page.evaluate(`document.getElementById("source-channel").value`), "pondpal");
  await page.evaluate("localStorage.clear()");
});

test("editor: the built-in frills_demo account fills the preview and says it is practice chat", { skip }, async () => {
  const { base, made } = await withHelper([], { demoPace: [30, 60] });
  await page.goto(base + "/editor/", { settle: 600 });
  await type("#source-channel", "frills_demo");
  await click("#source .source__row .btn");
  await page.waitFor(`document.getElementById("source-status").dataset.state === "connected"`);
  assert.match(await text("#source-status"), /Practice chat made up by Frills/);
  await page.waitFor(`document.querySelectorAll("#chat .m").length >= 3`, { timeout: 6000 });
  await page.waitFor(`document.querySelectorAll("#chat .av.has-img").length >= 2`, { timeout: 4000 });
  assert.equal(await page.evaluate(`[...document.querySelectorAll("#chat .av img")].every((i) => i.naturalWidth > 0)`), true, "the pictures really loaded");
  assert.equal(made.length, 0, "no connection to TikTok was made");
  const link = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(link.searchParams.get("channel"), "frills_demo");
  assert.equal(link.searchParams.get("platform"), "tiktok");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
  await click("#source .source__row .btn"); // Disconnect
});

test("editor: a TikTok name that isn't one is refused before anything is sent", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(base + "/editor/", { settle: 600 });
  await type("#source-channel", "not a name!");
  await click("#source .source__row .btn");
  await sleep(150);
  assert.equal(await text("#source-status"), "TikTok names are letters, numbers, _ and . only.");
  assert.equal(await page.evaluate(`document.getElementById("source-channel").getAttribute("aria-invalid")`), "true");
  assert.equal(made.length, 0);
});

test("editor: an account that isn't live yet says so, and starts working when it goes live", { skip }, async () => {
  class UserOfflineError extends Error {}
  const { base, made } = await withHelper([{ failWith: new UserOfflineError("not live") }], { offlineWaitMs: 1200 });
  await page.goto(base + "/editor/", { settle: 600 });
  await type("#source-channel", "pond.pal");
  await click("#source .source__row .btn");
  await page.waitFor(`document.getElementById("source-status").dataset.state === "offline"`);
  assert.match(await text("#source-status"), /@pond\.pal isn't live right now/);
  assert.equal(await text("#source .source__row .btn"), "Disconnect", "still watching, so it can be stopped");
  // The helper looks again by itself, and the chat starts the moment the LIVE does.
  await page.waitFor(`document.getElementById("source-status").dataset.state === "connected"`, { timeout: 6000 });
  made[1].conn.emit("chat", chat("l1", "we are live"));
  await page.waitFor(`[...document.querySelectorAll("#chat .txt")].some((t) => t.textContent === "we are live")`);
});

test("editor: with no helper behind the site, TikTok says what is missing and doesn't pretend", { skip }, async () => {
  await page.goto(plainBase + "/editor/", { settle: 700 });
  await page.waitFor(`!document.querySelector(".source__helper").hidden`);
  assert.match(await text(".source__helper"), /comes through the free Frills helper/);
  assert.equal(await page.evaluate(`document.querySelector(".source__helper a").getAttribute("href")`), "/guides/tiktok/", "and says where to read how");
  await type("#source-channel", "pond.pal");
  await click("#source .source__row .btn");
  await page.waitFor(`document.getElementById("source-status").dataset.state === "error"`);
  assert.match(await text("#source-status"), /needs the Frills helper running on this PC/);
  assert.equal(await text("#source .source__row .btn"), "Connect", "it never claims to be connected");
  assert.ok((await page.evaluate(`document.querySelectorAll("#chat .m").length`)) >= 1, "practice chat keeps going");
  await click("#source .chip", "Twitch");
  assert.equal(await page.evaluate(`document.querySelector(".source__helper").hidden`), true, "Twitch needs no helper");
});

test("overlay: ?platform=tiktok shows TikTok chat, and the status note goes away once it is connected", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(base + "/overlay/?platform=tiktok&channel=pond.pal&look=mint", { settle: 300 });
  await until(() => made.length === 1);
  await page.waitFor(`document.getElementById("note").hidden`); // "Connecting…" was showing; connected hides it
  made[0].conn.emit("chat", chat("o1", "hello obs", { userIdentity: { isModeratorOfAnchor: true } }));
  await page.waitFor(`document.querySelectorAll("#chat .m").length === 1`);
  assert.equal(await page.evaluate(`document.querySelector("#chat .txt").textContent`), "hello obs");
  assert.equal(await page.evaluate(`Boolean(document.querySelector("#chat .ico"))`), true);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("overlay: waiting for a LIVE shows a note on the page, and the overlay with no helper says so instead of staying blank", { skip }, async () => {
  class UserOfflineError extends Error {}
  const { base } = await withHelper([{ failWith: new UserOfflineError("not live") }]);
  await page.goto(base + "/overlay/?platform=tiktok&channel=pond.pal", { settle: 600 });
  await page.waitFor(`/isn't live right now/.test(document.getElementById("note").textContent)`);
  assert.equal(await page.evaluate(`document.getElementById("note").hidden`), false);

  await page.goto(plainBase + "/overlay/?platform=tiktok&channel=pond.pal", { settle: 900 });
  await page.waitFor(`/Frills helper/.test(document.getElementById("note").textContent)`);
  assert.equal(await page.evaluate(`document.getElementById("note").hidden`), false);
});

test("overlay: Twitch links still work exactly as before (no platform part, no helper involved)", { skip }, async () => {
  await page.goto(plainBase + "/overlay/?demo=1&channel=pond_pal", { settle: 600 });
  await page.waitFor(`document.querySelectorAll("#chat .m").length >= 1`);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("relay: with no helper but a relay behind the page, TikTok works, says it is the relay, and waits in line when it is full", { skip }, async () => {
  const made = [];
  const relay = createHelper({ distDir: dist, relay: { origins: [], slots: 1, maxPerIp: 20, trustProxy: false }, factory: async (user) => { const conn = new FakeConnection(); made.push({ user, conn }); return conn; }, idleStopMs: 150, queueGraceMs: 150 });
  const port = await relay.listen(0);
  opened.push(relay);
  const base = `http://127.0.0.1:${port}`;
  // Somebody else is already using the only spot.
  const taker = http.get({ host: "127.0.0.1", port, path: "/tiktok/stream?user=someone.else" });
  await until(() => made.length === 1);

  await page.goto(base + "/editor/", { settle: 700 });
  assert.equal(await page.evaluate(`document.querySelector(".source__relay").hidden`), false, "the relay note shows");
  assert.match(await text(".source__relay"), /free Frills relay \(beta\)/);
  assert.equal(await page.evaluate(`document.querySelector(".source__helper").hidden`), true, "and the helper warning does not");
  await type("#source-channel", "pond.pal");
  await click("#source .source__row .btn");
  await page.waitFor(`document.getElementById("source-status").dataset.state === "queued"`);
  assert.equal(await text("#source-status"), "The free relay is full. Waiting for a spot: 1 of 1…");
  assert.equal(made.length, 1, "nothing is connected to TikTok for someone who is waiting");

  taker.destroy(); // the other person finishes
  await page.waitFor(`document.getElementById("source-status").dataset.state === "connected"`, { timeout: 6000 });
  assert.equal(made.length, 2);
  made[1].conn.emit("chat", chat("r1", "from the relay"));
  await page.waitFor(`[...document.querySelectorAll("#chat .txt")].some((t) => t.textContent === "from the relay")`);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
  await click("#source .source__row .btn"); // Disconnect
});

test("matcha page: TikTok first too, and its link carries the platform", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(base + "/matcha/", { settle: 800 });
  assert.equal(await page.evaluate(`document.querySelector("#source .chip[aria-pressed=true]").textContent.trim()`), "TikTok");
  await type("#source-channel", "pond.pal");
  await click("#source .source__row .btn");
  await page.waitFor(`document.getElementById("source-status").dataset.state === "connected"`);
  made[0].conn.emit("chat", chat("t1", "matcha time"));
  await page.waitFor(`document.querySelectorAll(".matcha-card .m").length >= 6`); // the same message in every one of the six styles
  const link = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(link.origin + link.pathname, `${base}/overlay/`);
  assert.equal(link.searchParams.get("platform"), "tiktok");
  assert.equal(link.searchParams.get("style"), "latte");
  assert.match(await text("#link-hint"), /only works on this PC/);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("editor: connected but silent (an account that is not LIVE) says so after a while, and says what to do; chat turns it into 'Reading'", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(base + "/editor/", { settle: 700 });
  // the 20 second wait is cut to under a second, only for this page
  await page.evaluate(`(() => { const real = window.setTimeout; window.setTimeout = (fn, ms, ...rest) => real(fn, ms === 20000 ? 700 : ms, ...rest); })()`);
  await type("#source-channel", "not_live_yet");
  await click("#source .source__row .btn");
  await page.waitFor(`document.getElementById("source-status").dataset.state === "connected"`);
  assert.match(await text("#source-status"), /^Connected to TikTok\. Waiting for the first chat message/);
  await page.waitFor(`document.getElementById("source-status").dataset.state === "silent"`);
  assert.match(await text("#source-status"), /Are you LIVE\?.*press Disconnect and then Connect again/);
  made[0].conn.emit("chat", chat("late1", "finally someone"));
  await page.waitFor(`document.getElementById("source-status").dataset.state === "connected"`);
  assert.equal(await text("#source-status"), "Reading @not_live_yet's LIVE chat");
  assert.match(await text("#source ~ .checklist, .checklist"), /go LIVE first/, "the checklist is on the page");
});

// ── a restarted relay: the tunnel answers 502 while it is down, and the page has to come back by itself ──────────────────────────

test("overlay: when the relay is restarted behind its tunnel, the page comes back by itself and chat flows again", { skip }, async () => {
  // the stand-in for the tunnel: it forwards to whatever relay is running now, and answers 502 while there is none (as Cloudflare does)
  let inner = 0;
  const forward = http.createServer((req, res) => {
    if (!inner) { res.writeHead(502, { "content-type": "text/plain" }); res.end("Bad gateway"); return; }
    const up = http.request({ host: "127.0.0.1", port: inner, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
      r.on("close", () => { if (!r.complete) res.destroy(); }); // the relay went away mid-stream: a tunnel drops the visitor too
    });
    up.on("error", () => { if (!res.headersSent) { res.writeHead(502); res.end(); } else res.destroy(); });
    res.on("close", () => up.destroy());
    req.pipe(up);
  });
  await new Promise((resolve) => forward.listen(0, "127.0.0.1", resolve));
  const front = `http://127.0.0.1:${forward.address().port}`;
  // a relay (not a helper on a PC) behind it, because a relay answers to whatever address the tunnel gives it
  const relayBehind = async () => {
    const made = [];
    const helper = createHelper({ distDir: dist, factory: async (user) => { const conn = new FakeConnection(); made.push({ user, conn }); return conn; }, relay: { origins: [front], slots: 10, trustProxy: false }, idleStopMs: 200, beatMs: 200 });
    const port = await helper.listen(0);
    opened.push(helper);
    return { port, made, helper };
  };
  try {
    const first = await relayBehind();
    inner = first.port;
    await page.goto(`${front}/overlay/?platform=tiktok&channel=pond.pal`, { settle: 800 });
    await until(() => first.made.length === 1).catch(() => { throw new Error("the page never reached the first relay"); });
    await sleep(150);
    first.made[0].conn.emit("chat", chat("a1", "before the restart"));
    await page.waitFor(`document.querySelector("#chat .m")`);

    // the relay goes away (the tunnel now says 502) and, several seconds later, a new one starts
    inner = 0;
    await first.helper.close();
    await sleep(5000); // longer than the browser's own wait before trying again (3 seconds), so its first tries are answered 502
    const second = await relayBehind();
    inner = second.port;
    await until(() => second.made.length === 1, 30000).catch(async () => { throw new Error("the page never came back to the new relay; the page says: " + (await page.evaluate(`document.getElementById("note")?.textContent + " | hidden=" + document.getElementById("note")?.hidden`)) + "; inner=" + inner); }); // the page found its way back without anyone reloading it
    await sleep(200);
    second.made[0].conn.emit("chat", chat("b1", "after the restart"));
    await page.waitFor(`[...document.querySelectorAll("#chat .m .txt")].some((n) => n.textContent === "after the restart")`, 8000);
  } finally {
    forward.closeAllConnections?.();
    forward.close();
  }
});

test("editor: after the relay restarts, the status line goes back from \"Lost…\" to the real state (it used to stay on \"Connecting…\" while chat flowed)", { skip }, async () => {
  let inner = 0;
  const forward = http.createServer((req, res) => {
    if (!inner) { res.writeHead(502, { "content-type": "text/plain" }); res.end("Bad gateway"); return; }
    const up = http.request({ host: "127.0.0.1", port: inner, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
      r.on("close", () => { if (!r.complete) res.destroy(); });
    });
    up.on("error", () => { if (!res.headersSent) { res.writeHead(502); res.end(); } else res.destroy(); });
    res.on("close", () => up.destroy());
    req.pipe(up);
  });
  await new Promise((resolve) => forward.listen(0, "127.0.0.1", resolve));
  const front = `http://127.0.0.1:${forward.address().port}`;
  const relayBehind = async () => {
    const helper = createHelper({ distDir: dist, demoPace: [300, 500], relay: { origins: [front], slots: 10, trustProxy: false } });
    const port = await helper.listen(0);
    opened.push(helper);
    return { port, helper };
  };
  const status = () => page.evaluate(`document.getElementById("source-status").textContent`);
  const messages = () => page.evaluate(`document.querySelectorAll("#chat .m").length > 0 ? [...document.querySelectorAll("#chat .m .txt")].map((n) => n.textContent).join("|") : ""`);
  try {
    let relay = await relayBehind();
    inner = relay.port;
    await page.viewport(1280, 900);
    await page.goto(`${front}/editor/`, { settle: 1200 });
    await page.evaluate(`(() => { const i = document.getElementById("source-channel"); i.value = "frills_demo"; i.dispatchEvent(new Event("input", { bubbles: true })); [...document.querySelectorAll(".source__row button")].find((b) => /connect/i.test(b.textContent)).click(); })()`);
    await page.waitFor(`document.querySelector("#chat .m")`, { timeout: 10000 });
    const practice = await status();
    assert.match(practice, /Practice chat/);
    inner = 0;
    await relay.helper.close();
    await page.waitFor(`/Lost/.test(document.getElementById("source-status").textContent)`, { timeout: 10000 });
    await sleep(3000);
    relay = await relayBehind();
    inner = relay.port;
    const stuck = await page.waitFor(`document.getElementById("source-status").textContent.includes("Practice chat")`, { timeout: 40000 }).then(() => "", () => "the status line stayed on: " + "");
    assert.equal(stuck, "", "the status line never went back from the lost/connecting text; it says: " + (await status()));
  } finally {
    forward.closeAllConnections?.();
    forward.close();
  }
});

test("overlay: a page the relay turns away (too many pages open from one address) says so, and gets in by itself once there is room", { skip }, async () => {
  const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const base = `http://127.0.0.1:${port}`;
  const relay = createHelper({ distDir: dist, demoPace: [200, 400], relay: { origins: [base], slots: 10, maxPerIp: 1, trustProxy: false } });
  await relay.listen(port);
  opened.push(relay);
  // the one page that fits: a stream held open by hand
  const first = http.get(`${base}/tiktok/stream?user=frills_demo`, { headers: { Origin: base } });
  await new Promise((resolve) => first.on("response", (res) => { res.on("data", () => {}); resolve(); }));
  try {
    await page.viewport(520, 400);
    await page.goto(`${base}/overlay/alerts/?channel=frills_demo&platform=tiktok`, { settle: 1500 });
    await page.waitFor(`/turned the connection down/.test(document.getElementById("note").textContent)`, { timeout: 10000 });
    first.destroy(); // there is room now
    await page.waitFor(`document.getElementById("note").hidden`, { timeout: 40000 }).catch(async () => { throw new Error("the page never got in; it says: " + (await page.evaluate(`document.getElementById("note").textContent`))); });
  } finally {
    first.destroy();
  }
});

test("overlay: when every new connection attempt hangs with no answer at all (a half-dead link), the page gives up on it and gets back in by itself", { skip }, async () => {
  let mode = "ok";
  let inner = 0;
  const forward = http.createServer((req, res) => {
    if (mode === "hang") return; // the request is taken and never answered, as on a link that has half died
    const up = http.request({ host: "127.0.0.1", port: inner, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
      r.on("close", () => { if (!r.complete) res.destroy(); });
    });
    up.on("error", () => { if (!res.headersSent) { res.writeHead(502); res.end(); } else res.destroy(); });
    res.on("close", () => up.destroy());
    req.pipe(up);
  });
  await new Promise((resolve) => forward.listen(0, "127.0.0.1", resolve));
  const front = `http://127.0.0.1:${forward.address().port}`;
  const helper = createHelper({ distDir: dist, demoPace: [300, 500], relay: { origins: [front], slots: 10, trustProxy: false } });
  inner = await helper.listen(0);
  opened.push(helper);
  const note = () => page.evaluate(`document.getElementById("note").hidden ? "" : document.getElementById("note").textContent`);
  try {
    await page.viewport(520, 400);
    await page.goto(`${front}/overlay/?platform=tiktok&channel=frills_demo`, { settle: 1500 });
    await page.waitFor(`document.querySelector("#chat .m")`, { timeout: 10000 });
    mode = "hang";
    forward.closeAllConnections(); // the link breaks, and from now on every attempt to open a stream sits there unanswered
    await page.waitFor(`!document.getElementById("note").hidden`, { timeout: 15000 });
    await sleep(8000);
    mode = "ok"; // the link is fine again, but the attempt the browser is waiting on will never be answered
    await page.waitFor(`document.getElementById("note").hidden`, { timeout: 90000 }).catch(async () => { throw new Error("it never came back; the note says: " + (await note())); });
  } finally {
    forward.closeAllConnections?.();
    forward.close();
  }
});

// ── the hosted site and a relay on another address: what a person is told when the relay turns their page away ─────────────────────────

/**
 * The site on one address and a relay on another, like the real thing. The page is told where the relay is (the build does that for the real
 * site). With `proxy`, the page reaches the relay through a go-between that can cut the page's side of its streams while leaving the relay's side
 * open: what a connection that dies without a word looks like to the relay.
 */
async function siteAndRelay(relayOptions, { proxy = false } = {}) {
  const files = createStatic(dist);
  const site = http.createServer((req, res) => {
    const writeHead = res.writeHead.bind(res);
    // the build's security policy only lists the real relay's address, so for a relay on a test address it is left out
    res.writeHead = (status, headers = {}) => { for (const key of Object.keys(headers)) if (key.toLowerCase() === "content-security-policy") delete headers[key]; return writeHead(status, headers); };
    files(req, res);
  });
  await new Promise((resolve) => site.listen(0, "127.0.0.1", resolve));
  const siteBase = `http://127.0.0.1:${site.address().port}`;
  const relay = createHelper({ demoPace: [200, 400], relay: { origins: [siteBase], slots: 10, trustProxy: false, ...relayOptions } });
  const relayPort = await relay.listen(0);
  const relayBase = `http://127.0.0.1:${relayPort}`;
  opened.push(relay);
  opened.push({ close: async () => { site.closeAllConnections?.(); site.close(); } });
  let pageRelay = relayBase;
  const held = new Set();
  let go;
  if (proxy) {
    go = http.createServer((req, res) => {
      const up = http.request({ host: "127.0.0.1", port: relayPort, path: req.url, method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
        r.on("close", () => res.destroy());
      });
      up.on("error", () => res.destroy());
      held.add({ res, up });
      up.end(); // (when the page goes away the relay is deliberately not told, as when a connection dies without a word)
    });
    await new Promise((resolve) => go.listen(0, "127.0.0.1", resolve));
    pageRelay = `http://127.0.0.1:${go.address().port}`;
    opened.push({ close: async () => { for (const { up } of held) up.destroy(); go.closeAllConnections?.(); go.close(); } });
  }
  const script = await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `new MutationObserver((list, watcher) => { if (document.body) { document.body.dataset.relay = ${JSON.stringify(pageRelay)}; document.body.dataset.site = location.origin; watcher.disconnect(); } }).observe(document, { childList: true, subtree: true });` });
  return {
    siteBase,
    relayBase,
    relay,
    numbers: async () => (await (await fetch(`${relayBase}/health`, { headers: { Accept: "application/json" } })).json()).streams,
    /** Cuts the page's side of every stream it has open, leaving the relay's side open. */
    cutPages: () => { for (const { res } of held) res.destroy(); },
    forget: () => page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.identifier }),
  };
}

test("overlay: a page the hosted site's relay turns away is told why, in plain words with the numbers, and gets in by itself once there is room", { skip }, async () => {
  const { siteBase, relayBase, relay, numbers, forget } = await siteAndRelay({ maxPerIp: 1 });
  // the one page that fits: a stream held open by hand
  const first = http.get(`${relayBase}/tiktok/stream?user=frills_demo`, { headers: { Origin: siteBase } });
  await new Promise((resolve) => first.on("response", (res) => { res.on("data", () => {}); resolve(); }));
  try {
    await page.viewport(520, 400);
    await page.goto(`${siteBase}/overlay/alerts/?channel=frills_demo&platform=tiktok`, { settle: 1500 });
    const note = () => page.evaluate(`document.getElementById("note").hidden ? "" : document.getElementById("note").textContent`);
    await page.waitFor(`/this relay allows 1/.test(document.getElementById("note").textContent)`, { timeout: 15000 }).catch(async () => { throw new Error("the page never said why; it says: " + (await note())); });
    const said = await note();
    assert.match(said, /^Too many Frills pages are open from your internet address \(this relay allows 1\), so this one is waiting its turn\./);
    assert.match(said, /Close Frills tabs you are not using, or wait/);
    assert.match(said, /Trying again…$/);
    // the relay counted it, and shows it in its numbers
    const counted = await numbers();
    assert.ok(counted.turnedAway >= 1 && counted.limit === 1, JSON.stringify(counted));
    // there is room now
    first.destroy();
    await page.waitFor(`document.getElementById("note").hidden`, { timeout: 40000 }).catch(async () => { throw new Error("the page never got in; it says: " + (await note())); });
    assert.equal((await numbers()).open, 1, "and it is the one page the relay holds");
  } finally {
    first.destroy();
    await forget();
    await relay.close();
  }
});

test("overlay: a page whose connection died without a word and came back is not turned away by its own old stream, even when the limit is one", { skip }, async () => {
  const { siteBase, relay, numbers, cutPages, forget } = await siteAndRelay({ maxPerIp: 1 }, { proxy: true });
  try {
    await page.viewport(520, 400);
    await page.goto(`${siteBase}/overlay/?channel=frills_demo&platform=tiktok`, { settle: 1500 });
    await page.waitFor(`document.querySelector("#chat .m")`, { timeout: 15000 });
    assert.deepEqual([(await numbers()).open, (await numbers()).turnedAway], [1, 0]);
    // the page's side of the stream is cut, and the relay is not told: it still holds the old stream. The browser opens a new one by itself a few
    // seconds later, under the same page name, so the relay lets the old one go instead of counting both.
    cutPages();
    const t0 = Date.now();
    let now = await numbers();
    while (Date.now() - t0 < 15000 && now.replaced < 1 && now.turnedAway === 0) { await sleep(250); now = await numbers(); }
    assert.equal(now.turnedAway, 0, "not turned away by its own old stream: " + JSON.stringify(now));
    assert.ok(now.replaced >= 1, "the old stream was replaced: " + JSON.stringify(now));
    assert.equal(now.open, 1, "one page, one stream");
    await page.waitFor(`document.getElementById("note").hidden && document.querySelectorAll("#chat .m").length > 0`, { timeout: 15000 }).catch(async () => { throw new Error("the page does not say all is well: " + (await page.evaluate(`document.getElementById("note").textContent`))); });
  } finally {
    await forget();
    await relay.close();
  }
});
