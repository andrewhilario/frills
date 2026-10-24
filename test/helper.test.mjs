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
  assert.deepEqual(JSON.parse(ping.body), { ok: true, name: "frills-helper", version: "0.5.5", features: ["chat", "alerts", "info", "roles", "status"] });
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
  assert.match(connected.data.detail, /Practice chat made up by Frills/, "the page is told it is pretend");
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

test("an account that never goes live is looked for only so long, and a new connection starts the wait again", async () => {
  class UserOfflineError extends Error {}
  const never = Array.from({ length: 40 }, () => ({ failWith: new UserOfflineError("not live") }));
  const { factory, made } = scripted(...never);
  await start(factory, { offlineWaitMs: 20, offlineGiveUpMs: 150 });
  const page = listen("pond.pal");
  await page.until(() => helper.hub.rooms.get("pond.pal")?.status.detail.startsWith("Still not live"), 3000);
  const room = helper.hub.rooms.get("pond.pal");
  const looks = made.length;
  assert.ok(looks >= 2 && looks < 20, "it looked several times, then stopped: " + looks);
  await sleep(150);
  assert.equal(made.length, looks, "no more requests to TikTok once it gave up");
  assert.equal(room.running, false);
  await page.close();
  const again = listen("pond.pal");
  await again.until(() => made.length > looks, 3000);
  await again.close();
  await helper.close();
});

test("an account that stays offline is looked at less and less often, never given up on while a page listens, and found by itself when it goes LIVE", async () => {
  class UserOfflineError extends Error {}
  const offline = Array.from({ length: 12 }, () => ({ failWith: new UserOfflineError("not live") }));
  const { factory, made } = scripted(...offline);
  // 20 ms between looks, then 120 ms once 150 ms have passed (the real relay: 3 minutes, then 10 after half an hour, then 30 after 3 hours)
  await start(factory, { offlineWaitMs: 20, offlineGiveUpMs: 0, offlineSlowSteps: [[150, 120]], wakeGapMs: 1e9 });
  const page = listen("pond.pal");
  await page.until(() => /Looking again every/.test(helper.hub.rooms.get("pond.pal")?.status.detail ?? ""), 3000);
  const room = helper.hub.rooms.get("pond.pal");
  assert.match(room.status.detail, /^Not live yet. Looking again every (second|d+ seconds). Opening this link again looks right away.$/);
  assert.equal(room.running, true, "it is still looking");
  const before = made.length;
  await sleep(300);
  assert.ok(made.length - before <= 4, "at the slow pace there are only a few looks in 300 ms: " + (made.length - before));
  // the twelve offline answers run out, so a later look finds the LIVE with nobody pressing anything
  await page.until(() => room.status.state === "connected", 4000);
  assert.ok(!page.events.some((e) => e.name === "status" && /stopped looking/.test(e.data.detail ?? "")), "it never said it had stopped looking");
  await page.close();
  await helper.close();
});

test("a page that opens while the account is offline makes the relay look right away, but not again within the gap", async () => {
  class UserOfflineError extends Error {}
  const offline = Array.from({ length: 30 }, () => ({ failWith: new UserOfflineError("not live") }));
  const { factory, made } = scripted(...offline);
  await start(factory, { offlineWaitMs: 100000, offlineGiveUpMs: 0, wakeGapMs: 300 });
  const first = listen("pond.pal");
  await first.until(() => made.length === 1 && helper.hub.rooms.get("pond.pal")?.status.state === "offline", 3000);
  await sleep(350); // past the gap
  const second = listen("pond.pal");
  await second.until(() => made.length === 2, 3000); // it did not wait out its 100 seconds
  const third = listen("pond.pal"); // straight after a look: inside the gap
  await sleep(150);
  assert.equal(made.length, 2, "a page opened right after a look does not make another one");
  await Promise.all([first.close(), second.close(), third.close()]);
  await helper.close();
});

test("the relay writes how long each connection to TikTok took", async () => {
  const lines = [];
  const { factory } = scripted();
  await start(factory, { log: (line) => lines.push(line) });
  const page = listen("pond.pal");
  await page.until(() => page.states().includes("connected"));
  assert.ok(lines.some((line) => /^@pond\.pal: connected in \d+\.\d s$/.test(line)), "a line says how long it took: " + JSON.stringify(lines));
  await page.close();
  await helper.close();
});

test("the shared relay looks for an account that is not LIVE often at first and less often later, and never gives up", () => {
  const relay = createHelper({ relay: { origins: ["https://site.test"], slots: 3, maxPerIp: 5, trustProxy: false }, factory: async () => ({}) });
  const { offlineWaitMs, offlineGiveUpMs, offlineSlowSteps } = relay.hub.opts;
  assert.equal(offlineWaitMs, 20000, "every 20 seconds at first, when a streamer has just opened the overlay and is about to go LIVE");
  assert.deepEqual(offlineSlowSteps, [[180000, 60000], [1800000, 180000], [10800000, 600000]], "a minute after 3 minutes, 3 minutes after half an hour, 10 minutes after 3 hours");
  assert.equal(offlineGiveUpMs, 0, "never gives up while a page listens");
  assert.ok(offlineSlowSteps.every(([after, every], i) => every > (offlineSlowSteps[i - 1]?.[1] ?? offlineWaitMs) && after > (offlineSlowSteps[i - 1]?.[0] ?? 0)), "each step is later and slower than the one before");
});

test("a chat message with emotes, and an emote-only message, reach a page as pictures with their places", async () => {
  const { factory, made } = scripted();
  await start(factory);
  const page = listen("pond.pal");
  await page.until(() => page.states().includes("connected"));
  const conn = made[0].conn;
  const url = "https://p16-webcast.tiktokcdn.com/webcast-va/rose.webp";
  const user = { id: "7", displayId: "ann", nickname: "Ann" };
  conn.emit("chat", { common: { msgId: "e1" }, user, content: "love this", emotes: [{ placeInComment: 4, emote: { emoteId: "1", image: { imageUrl: url } } }] });
  conn.emit("chat", { common: { msgId: "e2" }, user, content: "", emotes: [{ placeInComment: 0, emote: { emoteId: "1", image: { imageUrl: url } } }] });
  conn.emit("emote", { common: { msgId: "e3" }, user, emoteList: [{ emoteId: "2", image: { url: [url] } }] });
  conn.emit("chat", { common: { msgId: "e4" }, user, content: "from nowhere", emotes: [{ placeInComment: 0, emote: { emoteId: "1", image: { imageUrl: "https://evil.example/x.png" } } }] });
  await page.until(() => page.chats().length === 4);
  assert.deepEqual(page.chats().map((m) => [m.text, m.pics ?? null]), [
    ["love this", [{ at: 4, url }]],
    ["", [{ at: 0, url }]],
    ["", [{ at: 0, url }]],
    ["from nowhere", null],
  ]);
  await page.close();
  await helper.close();
});

// ── a connection that says "connected" and then says nothing ─────────────────────────────────────────────────────────────────────

test("a connection that says connected and then goes silent is let go and replaced by a fresh one, which delivers", async () => {
  const { factory, made } = scripted();
  await start(factory, { silentMs: 120, silentMaxMs: 480 });
  const page = listen("pond.pal");
  await page.until(() => page.states().includes("connected"));
  await page.until(() => made.length === 2, 3000); // the first never says a word
  assert.equal(made[0].conn.gone, true, "the silent one is let go");
  await page.until(() => page.states().filter((s) => s === "connected").length === 2, 2000);
  assert.ok(page.states().includes("reconnecting"), "the page is told it is connecting again");
  made[1].conn.emit("chat", chat("1", "hello from the fresh one"));
  await page.until(() => page.chats().some((c) => c.text === "hello from the fresh one"));
  await page.close();
  await helper.close();
});

test("a connection that keeps hearing from TikTok, even only the viewer count, is left alone", async () => {
  const { factory, made } = scripted();
  await start(factory, { silentMs: 150 });
  const page = listen("pond.pal");
  await page.until(() => page.states().includes("connected"));
  const tick = setInterval(() => made[0].conn.emit("roomUser", { viewerCount: 3 }), 40);
  await sleep(700); // several times the silence that would have replaced it
  clearInterval(tick);
  assert.equal(made.length, 1, "no new connection was made");
  assert.equal(made[0].conn.gone, false);
  await page.close();
  await helper.close();
});

test("a silence that a fresh connection did not change is waited out for twice as long the next time, and a switch off is respected", async () => {
  const { factory, made } = scripted();
  const times = [];
  const stamped = async (user, options) => { times.push(Date.now()); return factory(user, options); };
  await start(stamped, { silentMs: 100, silentMaxMs: 400 });
  const page = listen("pond.pal");
  await page.until(() => times.length >= 4, 6000);
  const gaps = [times[1] - times[0], times[2] - times[1], times[3] - times[2]];
  assert.ok(gaps[1] > gaps[0] * 1.3 && gaps[2] > gaps[1] * 1.3, "each wait is longer than the last: " + gaps.join(", ") + " ms");
  assert.ok(gaps[2] < 700, "and it stops growing at the limit: " + gaps.join(", ") + " ms");
  await page.close();
  await helper.close();

  const off = scripted();
  await start(off.factory, { silentMs: 0 });
  const quiet = listen("pond.pal");
  await quiet.until(() => quiet.states().includes("connected"));
  await sleep(400);
  assert.equal(off.made.length, 1, "with the watch switched off a silent connection stays");
  await quiet.close();
  await helper.close();
});
