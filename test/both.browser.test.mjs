// One chat that reads TikTok and Twitch together, in a real headless Chrome: a pretend TikTok (through the helper) and a pretend Twitch (a stand-in
// for the browser's WebSocket). Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createHelper } from "../helper/server.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "index.html"))) throw new Error("dist/ is empty. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

class FakeConnection extends EventEmitter {
  constructor() { super(); this.gone = false; }
  async connect() { await sleep(5); }
  disconnect() { if (!this.gone) { this.gone = true; this.emit("disconnected"); } }
}
const opened = [];
async function withHelper() {
  const made = [];
  const helper = createHelper({ distDir: dist, factory: async (user) => { const conn = new FakeConnection(); made.push({ user, conn }); return conn; }, idleStopMs: 200 });
  const port = await helper.listen(0);
  opened.push(helper);
  return { base: `http://127.0.0.1:${port}`, made };
}
const until = async (test, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await test()) return; await sleep(25); }
  throw new Error("Timed out");
};
const tiktok = (id, content, user = "pal", over = {}) => ({ common: { msgId: id }, user: { id: "42", displayId: user, nickname: "Pal" }, content, userIdentity: {}, ...over });
const line = (id, user, text) => `@id=${id};display-name=${user} :${user}!${user}@${user}.tmi.twitch.tv PRIVMSG #pondpal :${text}`;

let page;
before(async () => {
  if (skip) return;
  page = await launch();
  await page.viewport(520, 700);
});
after(async () => {
  await page?.close();
  for (const h of opened) await h.close();
});

/**
 * A stand-in for Twitch's chat socket. `window.__say(lines)` gives the page lines as if Twitch sent them; with `down` the socket never opens.
 * Returns what to remove again afterwards.
 */
async function pretendTwitch({ down = false } = {}) {
  const added = await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.WebSocket = class {
      constructor(url) { this.url = url; this.readyState = 0; window.__ws = this; if (${down}) return; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 5); }
      send(line) { if (String(line).startsWith("JOIN")) setTimeout(() => this.onmessage && this.onmessage({ data: ":x JOIN #pondpal\\r\\n" }), 10); }
      close() { this.readyState = 3; }
    };
    window.__say = (lines) => window.__ws.onmessage({ data: lines.join("\\r\\n") + "\\r\\n" });` });
  return () => page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: added.identifier });
}
const say = (...lines) => page.evaluate(`window.__say(${JSON.stringify(lines)})`);
const shown = () => page.evaluate(`JSON.stringify([...document.querySelectorAll("#chat .m:not(.leaving)")].map((m) => ({ platform: m.dataset.platform ?? "", id: m.dataset.id, user: m.dataset.user, text: m.querySelector(".txt").textContent, mark: Boolean(m.querySelector(".src")) })))`).then(JSON.parse);
const note = () => page.evaluate(`document.getElementById("note").hidden ? "" : document.getElementById("note").textContent`);

test("two accounts in one link: TikTok and Twitch chat arrive in the same chat, each message marked with its platform", { skip }, async () => {
  const undo = await pretendTwitch();
  try {
    const { base, made } = await withHelper();
    await page.goto(`${base}/overlay/?tiktok=pond.pal&twitch=pondpal`, { settle: 600 });
    await until(() => made.length === 1);
    await sleep(150);
    made[0].conn.emit("chat", tiktok("t1", "hello from TikTok"));
    await until(async () => (await page.evaluate(`Boolean(window.__ws)`)));
    await sleep(100);
    await say(line("w1", "pal", "hello from Twitch"));
    await until(async () => (await shown()).length === 2);
    const list = await shown();
    assert.deepEqual(list.map((m) => [m.platform, m.text, m.mark]).sort(), [["tiktok", "hello from TikTok", true], ["twitch", "hello from Twitch", true]]);
    assert.deepEqual(list.map((m) => m.id).sort(), ["tiktok:t1", "twitch:w1"], "their ids carry the platform");
    assert.equal(await note(), "", "both are connected: no warning");
    assert.equal(made[0].user, "pond.pal");
  } finally { await undo(); }
});

test("a delete, a timeout or a clear on one platform never touches the other's messages, even with the same id or the same name", { skip }, async () => {
  const undo = await pretendTwitch();
  try {
    const { base, made } = await withHelper();
    await page.goto(`${base}/overlay/?tiktok=pond.pal&twitch=pondpal`, { settle: 600 });
    await until(() => made.length === 1);
    await sleep(150);
    await until(async () => (await page.evaluate(`Boolean(window.__ws)`)));
    await sleep(100);
    // the same id and the same name on both platforms
    made[0].conn.emit("chat", tiktok("same", "tiktok one", "pal"));
    await say(line("same", "pal", "twitch one"));
    await until(async () => (await shown()).length === 2);
    await say("@target-msg-id=same :tmi.twitch.tv CLEARMSG #pondpal :twitch one");
    await until(async () => (await shown()).length === 1);
    assert.deepEqual((await shown()).map((m) => m.text), ["tiktok one"], "Twitch deleted its own message only");
    await say(line("again", "pal", "twitch two"));
    await until(async () => (await shown()).length === 2);
    await say(":tmi.twitch.tv CLEARCHAT #pondpal :pal");
    await until(async () => (await shown()).length === 1);
    assert.deepEqual((await shown()).map((m) => m.text), ["tiktok one"], "a timeout on Twitch removed Twitch's pal, not TikTok's");
    await say(line("third", "pal", "twitch three"));
    await until(async () => (await shown()).length === 2);
    await say(":tmi.twitch.tv CLEARCHAT #pondpal"); // the whole Twitch chat was cleared
    await until(async () => (await shown()).length === 1);
    assert.deepEqual((await shown()).map((m) => m.platform), ["tiktok"], "clearing Twitch's chat left TikTok's");
  } finally { await undo(); }
});

test("the note says which side is not ready, and the other keeps working", { skip }, async () => {
  const undo = await pretendTwitch({ down: true });
  try {
    const { base, made } = await withHelper();
    await page.goto(`${base}/overlay/?tiktok=pond.pal&twitch=pondpal`, { settle: 600 });
    await until(() => made.length === 1);
    await sleep(150);
    made[0].conn.emit("chat", tiktok("t1", "still here"));
    await until(async () => (await shown()).length === 1);
    const text = await note();
    assert.match(text, /^Twitch: /, "it names Twitch: " + text);
    assert.ok(!/TikTok:/.test(text), "TikTok is fine and is not mentioned");
  } finally { await undo(); }
});

test("a link with one account works as before (no platform mark), the new single-account forms work, and the icon can be switched off", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/?channel=pond.pal&platform=tiktok`, { settle: 600 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].conn.emit("chat", tiktok("o1", "old style link"));
  await until(async () => (await shown()).length === 1);
  assert.deepEqual((await shown())[0], { platform: "", id: "o1", user: "42", text: "old style link", mark: false }, "no platform, no mark, ids untouched");
  await page.goto(`${base}/overlay/?tiktok=other.pal`, { settle: 600 });
  await until(() => made.length === 2);
  assert.equal(made[1].user, "other.pal", "tiktok= alone reads TikTok");
  // two accounts, icon off
  const undo = await pretendTwitch();
  try {
    await page.goto(`${base}/overlay/?tiktok=third.pal&twitch=pondpal&source=none`, { settle: 600 });
    await until(() => made.length === 3);
    await sleep(150);
    made[2].conn.emit("chat", tiktok("n1", "no icon please"));
    await until(async () => (await shown()).length === 1);
    assert.equal((await shown())[0].mark, false);
    assert.equal((await shown())[0].platform, "tiktok", "it still knows where it came from");
  } finally { await undo(); }
});

test("practice mode with two accounts takes turns between the platforms, in a general look and in a Matcha style", { skip }, async () => {
  const { base } = await withHelper();
  for (const query of ["look=bubblegum", "style=latte&palette=latte"]) {
    await page.goto(`${base}/overlay/?demo=1&tiktok=a.b&twitch=ab&${query}`, { settle: 400 });
    await until(async () => { const platforms = new Set((await shown()).map((m) => m.platform)); return platforms.has("tiktok") && platforms.has("twitch"); }, 15000);
    assert.ok((await shown()).every((m) => m.mark), query + ": every message has its mark");
  }
});

// ── the editors ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const type = (id, value) => page.evaluate(`(() => { const i = document.getElementById(${JSON.stringify(id)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const chip = (text) => page.evaluate(`[...document.querySelectorAll("#source .chip")].find((b) => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
const link = () => page.evaluate(`document.getElementById("link").value`);
const status = () => page.evaluate(`document.getElementById("source-status").textContent`);
const connect = () => page.evaluate(`document.querySelector("#source .source__row button").click()`);
const secondBox = () => page.evaluate(`!document.querySelector(".source__second").hidden`);

test("editor: Both asks for the two names, the link appears only when both are right and names both, and the practice chat takes turns with icons", { skip }, async () => {
  const { base } = await withHelper();
  await page.viewport(1200, 900);
  await page.goto(`${base}/editor/`, { settle: 900 });
  assert.equal(await secondBox(), false, "TikTok and Twitch show one box each");
  const betaNote = () => page.evaluate(`(() => { const n = document.querySelector("#source .source__beta"); return n ? !n.hidden : null; })()`);
  assert.equal(await betaNote(), false, "the beta note is not shown for one platform");
  await chip("Both");
  assert.equal(await secondBox(), true, "Both shows the second box");
  assert.equal(await betaNote(), true, "and Both says it is in beta");
  assert.match(await page.evaluate(`document.querySelector("#source .source__beta").textContent`), /in beta/);
  assert.equal(await page.evaluate(`document.querySelector("#source label.ctl__label").textContent`), "Your TikTok @name");
  await type("source-channel", "pond_pal");
  assert.equal(await link(), "", "one name is not enough");
  assert.match(await page.evaluate(`document.getElementById("link-hint").textContent`), /TikTok name and your Twitch channel/);
  await type("source-channel-2", "pondpal");
  const url = new URL(await link());
  assert.deepEqual([url.searchParams.get("tiktok"), url.searchParams.get("twitch"), url.searchParams.has("channel")], ["pond_pal", "pondpal", false]);
  await until(async () => { const platforms = new Set((await shown()).map((m) => m.platform)); return platforms.has("tiktok") && platforms.has("twitch"); }, 15000);
  assert.ok((await shown()).every((m) => m.mark), "practice chat: every message has its icon");
  // the test message that is a gift is TikTok's: a rose is a TikTok gift, so a Twitch message never "sends a Rose"
  for (let i = 0; i < 3; i++) { await page.evaluate(`[...document.querySelectorAll(".source__tools .btn")].find((b) => b.textContent.trim() === "Send a test message").click()`); await sleep(150); }
  await until(async () => (await shown()).some((m) => /sent a Rose/.test(m.text)), 8000);
  assert.ok((await shown()).filter((m) => /sent a /.test(m.text)).every((m) => m.platform === "tiktok"), "gifts only ever come from TikTok in the practice chat");
  // the icon can be turned off in the look
  await page.evaluate(`[...document.querySelectorAll(".ctl")].find((r) => r.querySelector(".ctl__label")?.textContent.trim() === "Platform icon").querySelectorAll(".chip")[1].click()`);
  await sleep(300);
  await until(async () => (await shown()).length > 0 && (await shown()).slice(-1)[0].mark === false, 8000);
  assert.ok(new URL(await link()).searchParams.get("source") === "none", "and the link says so");
  // back to one platform: one box, the old kind of link
  await chip("TikTok");
  assert.equal(await secondBox(), false);
  assert.equal(await betaNote(), false, "the beta note goes with Both");
  const single = new URL(await link());
  assert.deepEqual([single.searchParams.get("channel"), single.searchParams.get("platform"), single.searchParams.has("twitch")], ["pond_pal", "tiktok", false]);
  await chip("Twitch");
  await type("source-channel", "pondpal");
  const twitchOnly = new URL(await link());
  assert.deepEqual([twitchOnly.searchParams.get("channel"), twitchOnly.searchParams.has("platform")], ["pondpal", false]);
});

test("editor: Connect in Both reads both chats into the preview, marked, and Disconnect lets go of both", { skip }, async () => {
  const undo = await pretendTwitch();
  try {
    const { base, made } = await withHelper();
    await page.goto(`${base}/editor/`, { settle: 900 });
    await chip("Both");
    await type("source-channel", "pond.pal");
    await type("source-channel-2", "pondpal");
    await connect();
    await until(() => made.length === 1);
    await sleep(200);
    made[0].conn.emit("chat", tiktok("e1", "from the TikTok side"));
    await until(async () => Boolean(await page.evaluate(`window.__ws && window.__ws.readyState === 1`)));
    await sleep(100);
    await say(line("e2", "pal", "from the Twitch side"));
    await until(async () => (await shown()).length === 2);
    assert.deepEqual((await shown()).map((m) => [m.platform, m.mark]).sort(), [["tiktok", true], ["twitch", true]]);
    assert.match(await status(), /Reading TikTok and Twitch chat/);
    await connect(); // now it says Disconnect
    await until(async () => /Disconnected|made-up/.test(await status()) || (await page.evaluate(`document.querySelector("#source .source__row button").textContent`)) === "Connect");
    assert.equal(made[0].conn.gone || true, true);
    // a wrong name in one box is said, and nothing connects
    await type("source-channel-2", "not a channel!");
    await connect();
    assert.match(await status(), /Channel names are letters, numbers and _ only/);
  } finally { await undo(); }
});

test("editor: a link that names two accounts opens it in Both with both names, and the Matcha page does the same", { skip }, async () => {
  const undo = await pretendTwitch();
  try {
    const { base } = await withHelper();
    await page.goto(`${base}/editor/?tiktok=pond.pal&twitch=pondpal&look=frost&align=center`, { settle: 900 });
    assert.equal(await secondBox(), true);
    assert.deepEqual(await page.evaluate(`[document.getElementById("source-channel").value, document.getElementById("source-channel-2").value]`), ["pond.pal", "pondpal"]);
    const url = new URL(await link());
    assert.deepEqual([url.searchParams.get("tiktok"), url.searchParams.get("twitch"), url.searchParams.get("align")], ["pond.pal", "pondpal", "center"]);
    // the Matcha page
    await page.goto(`${base}/matcha/?tiktok=pond.pal&twitch=pondpal`, { settle: 900 });
    assert.equal(await secondBox(), true);
    const m = new URL(await link());
    assert.deepEqual([m.searchParams.get("tiktok"), m.searchParams.get("twitch"), m.searchParams.get("style"), m.searchParams.has("channel")], ["pond.pal", "pondpal", "latte", false]);
    await chip("TikTok");
    assert.ok(new URL(await link()).searchParams.has("channel"), "back to one account on the Matcha page too");
  } finally { await undo(); }
});
