// The Frills helper, run for real on a spare port with a pretend TikTok connection: what a page sees when it listens, what the helper
// refuses, and how it keeps one connection per account and tries again by itself. No TikTok and no browser needed.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHelper } from "../helper/server.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "index.html"))) throw new Error("dist/ is empty. Run `npm run build` first (`npm test` does that for you).");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FAST = { idleStopMs: 80, offlineWaitMs: 40, limitedWaitMs: 40, backoffMs: [30, 30] };

/** A pretend TikTok connection. `script` says what connect() does. */
class FakeConnection extends EventEmitter {
  constructor(script = {}) {
    super();
    this.script = script;
    this.gone = false;
  }
  async connect() {
    await sleep(5);
    if (this.script.failWith) throw this.script.failWith;
  }
  disconnect() {
    if (this.gone) return;
    this.gone = true;
    this.emit("disconnected");
  }
}

/** A factory that hands out the scripted connections one by one (then plain working ones) and remembers them. */
function scripted(...scripts) {
  const made = [];
  const factory = async (user) => {
    const conn = new FakeConnection(scripts.shift() ?? {});
    made.push({ user, conn });
    return conn;
  };
  return { factory, made };
}

let helper;
let port;
const everyHelper = [];
const start = async (factory, tuning = {}) => {
  helper = createHelper({ distDir: dist, factory, ...FAST, ...tuning });
  everyHelper.push(helper);
  port = await helper.listen(0);
};
// A test that fails halfway must not leave a server running, or the whole run never ends.
after(async () => { for (const h of everyHelper) await h.close(); });

/** Listens to a stream like a page would, and collects its events. */
function listen(user) {
  const events = [];
  const req = http.get({ host: "127.0.0.1", port, path: `/tiktok/stream?user=${encodeURIComponent(user)}`, headers: { Host: `127.0.0.1:${port}` } });
  const done = new Promise((resolve) => {
    req.on("response", (res) => {
      res.setEncoding("utf8");
      let buffer = "";
      res.on("data", (chunk) => {
        buffer += chunk;
        let cut;
        while ((cut = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const name = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (name && data) events.push({ name, data: JSON.parse(data) });
        }
      });
      res.on("close", resolve);
    });
    req.on("error", resolve);
  });
  return {
    events,
    states: () => events.filter((e) => e.name === "status").map((e) => e.data.state),
    chats: () => events.filter((e) => e.name === "chat").map((e) => e.data),
    async until(test, ms = 2000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (test()) return;
        await sleep(10);
      }
      throw new Error("Timed out. Saw: " + JSON.stringify(events.map((e) => e.name + ":" + (e.data.state ?? e.data.text ?? ""))));
    },
    close: () => { req.destroy(); return done; },
  };
}

/** A plain request with whatever Host and Origin we choose (a browser won't let a page forge these, a program will). */
const raw = (path, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: "127.0.0.1", port, path, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
    let body = "";
    res.on("data", (c) => { body += c; });
    res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
  });
  req.on("error", reject);
  req.end();
});

const chat = (id, text, over = {}) => ({ common: { msgId: id }, user: { id: "42", displayId: "pond.pal", nickname: "Pond Pal" }, content: text, userIdentity: {}, ...over });

test("it answers a ping, serves the built site with its security headers, and says no to a bad name", async () => {
  await start(scripted().factory);
  const ping = await raw("/tiktok/ping");
  assert.equal(ping.status, 200);
  assert.deepEqual(JSON.parse(ping.body), { ok: true, name: "frills-helper", version: "0.1.0" });
  const editor = await raw("/editor/");
  assert.equal(editor.status, 200);
  assert.match(editor.body, /Connect your chat/);
  assert.match(editor.headers["content-security-policy"], /default-src 'self'/);
  assert.equal((await raw("/no-such-page/")).status, 404);
  assert.equal((await raw("/tiktok/stream?user=no%20spaces")).status, 400);
  assert.equal((await raw("/tiktok/stream")).status, 400);
  await helper.close();
});

test("a page from somewhere else is refused: wrong Host (DNS tricks) and wrong Origin (another website)", async () => {
  await start(scripted().factory);
  assert.equal((await raw("/tiktok/ping", { Host: "evil.example" })).status, 421);
  assert.equal((await raw("/editor/", { Host: `evil.example:${port}` })).status, 421);
  assert.equal((await raw("/tiktok/ping", { Origin: "https://evil.example" })).status, 403);
  assert.equal((await raw("/tiktok/ping", { Origin: `http://127.0.0.1:${port}` })).status, 200, "its own pages are fine");
  assert.equal((await raw("/tiktok/ping", { Host: `localhost:${port}` })).status, 200, "and so is the name localhost");
  const ping = await raw("/tiktok/ping");
  assert.equal(ping.headers["access-control-allow-origin"], undefined, "no CORS: other sites can't read answers");
  await helper.close();
});

test("a page hears the status, then each chat message once, then gifts and deletes", async () => {
  const { factory, made } = scripted();
  await start(factory);
  const page = listen("Pond.Pal");
  await page.until(() => page.states().includes("connected"));
  assert.deepEqual(page.states(), ["connecting", "connected"]);
  assert.equal(made[0].user, "pond.pal", "the name is tidied before it reaches TikTok");
  const conn = made[0].conn;
  conn.emit("chat", chat("m1", "hello pond"));
  conn.emit("chat", chat("m1", "hello pond")); // the same message arriving twice
  conn.emit("chat", chat("m2", "second", { userIdentity: { isModeratorOfAnchor: true } }));
  conn.emit("chat", chat("m3", ""));
  conn.emit("gift", { common: { msgId: "g1" }, user: { id: "7", displayId: "ann", nickname: "Ann" }, gift: { name: "Rose", type: 1 }, repeatCount: 2, repeatEnd: 0 });
  conn.emit("gift", { common: { msgId: "g2" }, user: { id: "7", displayId: "ann", nickname: "Ann" }, gift: { name: "Rose", type: 1 }, repeatCount: 5, repeatEnd: 1 });
  conn.emit("imDelete", { deleteMsgIds: ["m1"], deleteUserIds: ["99"] });
  await page.until(() => page.events.some((e) => e.name === "clear"));
  assert.deepEqual(page.chats().map((m) => [m.text, m.mod, m.gift]), [["hello pond", false, false], ["second", true, false], ["sent Rose ×5", false, true]]);
  assert.deepEqual(page.events.filter((e) => e.name === "remove").map((e) => e.data), [{ id: "m1" }]);
  assert.deepEqual(page.events.filter((e) => e.name === "clear").map((e) => e.data), [{ user: "99" }]);
  await page.close();
  await helper.close();
});

test("two pages watching the same account share one connection to TikTok", async () => {
  const { factory, made } = scripted();
  await start(factory);
  const editor = listen("pond.pal");
  const obs = listen("pond.pal");
  await Promise.all([editor.until(() => editor.states().includes("connected")), obs.until(() => obs.states().includes("connected"))]);
  assert.equal(made.length, 1);
  made[0].conn.emit("chat", chat("a1", "to both"));
  await Promise.all([editor.until(() => editor.chats().length === 1), obs.until(() => obs.chats().length === 1)]);
  await editor.close();
  await sleep(150);
  assert.equal(made[0].conn.gone, false, "one page left, so TikTok stays connected");
  made[0].conn.emit("chat", chat("a2", "still here"));
  await obs.until(() => obs.chats().length === 2);
  await obs.close();
  await helper.close();
});

test("an account that isn't live yet is waited for, and picked up when it goes live", async () => {
  class UserOfflineError extends Error {}
  const { factory, made } = scripted({ failWith: new UserOfflineError("not live") }, {});
  await start(factory);
  const page = listen("pond.pal");
  await page.until(() => page.states().includes("offline"));
  await page.until(() => page.states().includes("connected"));
  assert.deepEqual(page.states(), ["connecting", "offline", "connected"], "no flicker back to connecting while waiting");
  assert.equal(made.length, 2);
  await page.close();
  await helper.close();
});

test("when TikTok's free connection is busy it says so and tries again", async () => {
  class SignatureRateLimitError extends Error {}
  const { factory } = scripted({ failWith: new SignatureRateLimitError("slow down") }, {});
  await start(factory);
  const page = listen("pond.pal");
  await page.until(() => page.states().includes("connected"));
  assert.deepEqual(page.states(), ["connecting", "limited", "connected"]);
  await page.close();
  await helper.close();
});

test("a dropped connection is retried by itself", async () => {
  const { factory, made } = scripted();
  await start(factory);
  const page = listen("pond.pal");
  await page.until(() => page.states().includes("connected"));
  made[0].conn.emit("disconnected");
  await page.until(() => page.states().filter((s) => s === "connected").length === 2);
  assert.deepEqual(page.states(), ["connecting", "connected", "reconnecting", "connected"]);
  assert.equal(made.length, 2);
  await page.close();
  await helper.close();
});

test("the LIVE ending is announced, and the next LIVE is picked up", async () => {
  const { factory, made } = scripted();
  await start(factory);
  const page = listen("pond.pal");
  await page.until(() => page.states().includes("connected"));
  made[0].conn.emit("streamEnd");
  await page.until(() => page.states().includes("offline"));
  await page.until(() => page.states().filter((s) => s === "connected").length === 2);
  await page.close();
  await helper.close();
});

test("when the last page leaves, the connection to TikTok is let go", async () => {
  const { factory, made } = scripted();
  await start(factory);
  const page = listen("pond.pal");
  await page.until(() => page.states().includes("connected"));
  await page.close();
  await sleep(250);
  assert.equal(made[0].conn.gone, true);
  assert.equal(helper.hub.rooms.size, 0);
  await helper.close();
});

test("a name TikTok doesn't accept ends the attempt with a plain message, and there is a limit on accounts at once", async () => {
  class InvalidUniqueIdError extends Error {}
  const { factory } = scripted({ failWith: new InvalidUniqueIdError("bad") });
  await start(factory, { maxRooms: 1 });
  const bad = listen("pond.pal");
  await bad.until(() => bad.events.some((e) => e.data.fatal));
  assert.equal(bad.events.at(-1).data.state, "error");
  assert.match(bad.events.at(-1).data.detail, /doesn't know that name/);
  const second = listen("other.pal");
  await second.until(() => second.events.some((e) => e.data.fatal));
  assert.match(second.events.at(-1).data.detail, /already watching 1 TikTok account/);
  await bad.close();
  await second.close();
  await helper.close();
});

test("the built-in frills_demo account makes up chat through the real path and never touches TikTok", async () => {
  const { factory, made } = scripted();
  await start(factory, { demoPace: [10, 25] });
  const page = listen("Frills_Demo");
  await page.until(() => page.chats().length >= 4, 4000);
  const connected = page.events.find((e) => e.name === "status" && e.data.state === "connected");
  assert.match(connected.data.detail, /Practice chat made up by the Frills helper/, "the page is told it is pretend");
  for (const m of page.chats()) {
    assert.ok(m.id && m.name && m.text, "every made-up message has what a real one has");
    assert.equal(typeof m.mod, "boolean");
    assert.ok(m.avatar.startsWith("data:image/svg+xml;base64,"), "every made-up chatter has a drawn picture");
  }
  assert.equal(made.length, 0, "the pretend TikTok was never asked for");
  await page.close();
  await helper.close();
});

test("it only ever listens on this computer", async () => {
  await start(scripted().factory);
  assert.equal(helper.server.address().address, "127.0.0.1");
  await helper.close();
});
