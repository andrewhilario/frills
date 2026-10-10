// The alert events: how TikTok's follow, share and gift events become small clean alerts, how a page asks for only the kinds it wants,
// and that the practice account makes every kind so alerts can be tried without a LIVE. A pretend TikTok connection, no network.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHelper } from "../helper/server.mjs";
import { ALERT_KINDS, mapFollow, mapGiftAlert, mapShare } from "../helper/map.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "index.html"))) throw new Error("dist/ is empty. Run `npm run build` first (`npm test` does that for you).");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const user = (over = {}) => ({ id: "42", displayId: "pond.pal", nickname: "Pond Pal", avatarThumb: { urlList: ["https://p16.tiktokcdn.com/a.jpeg"] }, ...over });
const follow = (id, over = {}) => ({ common: { msgId: id }, user: user(), ...over });

// ── the mapping ─────────────────────────────────────────────────────────────────────────────────────────────────────

test("a follow and a share become a small clean alert with the person's name and picture", () => {
  assert.deepEqual(mapFollow(follow("f1")), { kind: "follow", id: "f1", user: "42", name: "Pond Pal", avatar: "https://p16.tiktokcdn.com/a.jpeg" });
  assert.deepEqual(mapShare(follow("s1")), { kind: "share", id: "s1", user: "42", name: "Pond Pal", avatar: "https://p16.tiktokcdn.com/a.jpeg" });
  assert.equal(mapFollow({ common: { msgId: "x" } }), null, "no person, no alert");
  assert.equal(mapFollow(follow("f2", { user: user({ nickname: "A\u0000B\n" + "x".repeat(200) }) })).name.length, 40, "names are cleaned and cut");
  assert.equal(mapFollow(follow("f3", { user: user({ avatarThumb: { urlList: ["https://evil.example/a.jpg"] } }) })).avatar, "", "a picture from anywhere but TikTok's servers is dropped");
});

test("a gift becomes an alert with its size in diamonds, and a streak is counted once, at its end", () => {
  const gift = { name: "Rose", type: 1, diamondCount: 5, image: { urlList: ["https://p16-webcast.tiktokcdn.com/rose.webp"] } };
  assert.equal(mapGiftAlert({ common: { msgId: "g1" }, user: user(), gift, repeatCount: 2, repeatEnd: 0 }), null, "still counting up");
  assert.deepEqual(mapGiftAlert({ common: { msgId: "g2" }, user: user(), gift, repeatCount: 3, repeatEnd: 1 }), {
    kind: "gift", id: "g2", user: "42", name: "Pond Pal", avatar: "https://p16.tiktokcdn.com/a.jpeg", gift: "Rose", picture: "https://p16-webcast.tiktokcdn.com/rose.webp", diamonds: 5, count: 3, total: 15,
  });
  const single = mapGiftAlert({ common: { msgId: "g3" }, user: user(), gift: { name: "Galaxy", type: 2, diamondCount: 1000 }, repeatCount: 1 });
  assert.deepEqual([single.gift, single.diamonds, single.count, single.total, single.picture], ["Galaxy", 1000, 1, 1000, ""], "a gift that is not a streak is an alert at once");
  assert.equal(mapGiftAlert({ common: { msgId: "g4" }, user: user(), gift: { name: "X", type: 2, diamondCount: -9 }, repeatCount: 99999 }).total, 0, "nonsense numbers are clamped");
  assert.equal(mapGiftAlert({ common: { msgId: "g5" }, user: user(), gift: { name: "Big", type: 2, diamondCount: 1e9 }, repeatCount: 9999 }).diamonds, 1000000);
});

// ── the relay: who gets what ────────────────────────────────────────────────────────────────────────────────────────

class FakeConnection extends EventEmitter {
  async connect() { await sleep(5); }
  disconnect() { this.emit("disconnected"); }
}
let helper;
let port;
const start = async (options = {}) => {
  const made = [];
  helper = createHelper({ distDir: dist, factory: async () => { const c = new FakeConnection(); made.push(c); return c; }, idleStopMs: 80, offlineWaitMs: 40, limitedWaitMs: 40, backoffMs: [30, 30], ...options });
  port = await helper.listen(0);
  return made;
};
after(async () => { await helper?.close(); });

function listen(account, events) {
  const seen = [];
  const query = events === undefined ? "" : `&events=${events}`;
  const req = http.get({ host: "127.0.0.1", port, path: `/tiktok/stream?user=${account}${query}`, headers: { Host: `127.0.0.1:${port}` } });
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
        if (name && data) seen.push({ name, data: JSON.parse(data) });
      }
    });
  });
  req.on("error", () => {});
  return {
    seen,
    alerts: () => seen.filter((e) => e.name === "alert").map((e) => e.data),
    chats: () => seen.filter((e) => e.name === "chat").map((e) => e.data),
    async until(test, ms = 3000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (test()) return; await sleep(10); }
      throw new Error("Timed out. Saw: " + JSON.stringify(seen.map((e) => e.name + ":" + (e.data.kind ?? e.data.state ?? ""))));
    },
    close: () => req.destroy(),
  };
}

test("the filter: one page asks for follow and gift, one asks for nothing, one for share", async () => {
  await helper?.close();
  const made = await start();
  const a = listen("pond_cafe", "follow,gift");
  const b = listen("pond_cafe");
  const c = listen("pond_cafe", "share,nonsense");
  await a.until(() => a.seen.some((e) => e.name === "status" && e.data.state === "connected"));
  const conn = made[0];
  assert.equal(made.length, 1, "three pages share one connection");
  conn.emit("follow", follow("f1"));
  conn.emit("share", follow("s1"));
  conn.emit("gift", { common: { msgId: "g1" }, user: user(), gift: { name: "Rose", type: 2, diamondCount: 1 }, repeatCount: 1 });
  conn.emit("chat", { common: { msgId: "c1" }, user: user(), content: "hello there", userIdentity: {} });
  await a.until(() => a.alerts().length >= 2 && a.chats().length >= 2);
  await c.until(() => c.alerts().length >= 1 && c.chats().length >= 2);
  await sleep(60);
  assert.deepEqual(a.alerts().map((x) => x.kind), ["follow", "gift"]);
  assert.deepEqual(b.alerts(), [], "a page that asked for nothing gets no alerts");
  assert.deepEqual(c.alerts().map((x) => x.kind), ["share"], "unknown kinds are ignored");
  for (const page of [a, b, c]) assert.deepEqual(page.chats().map((m) => m.text), ["sent Rose ×1", "hello there"], "everyone still gets chat, and a gift is a chat line too");
  a.close(); b.close(); c.close();
});

test("the same follow arriving twice is one alert, but a gift's chat line and alert do not cancel each other", async () => {
  await helper?.close();
  const made = await start();
  const a = listen("pond_cafe", "follow,gift");
  await a.until(() => a.seen.some((e) => e.name === "status" && e.data.state === "connected"));
  made[0].emit("follow", follow("dup"));
  made[0].emit("follow", follow("dup"));
  made[0].emit("gift", { common: { msgId: "same" }, user: user(), gift: { name: "Rose", type: 2, diamondCount: 1 }, repeatCount: 1 });
  made[0].emit("follow", { common: { msgId: "" }, user: user() });
  await a.until(() => a.alerts().length >= 3);
  await sleep(60);
  assert.deepEqual(a.alerts().map((x) => x.kind), ["follow", "gift", "follow"], "one follow, the gift, and the one with no id");
  assert.equal(a.chats().length, 1);
  a.close();
});

test("the ping says the program can send alerts, so a page can tell an old one", async () => {
  await helper?.close();
  await start();
  const body = await new Promise((resolve) => http.get({ host: "127.0.0.1", port, path: "/tiktok/ping", headers: { Host: `127.0.0.1:${port}` } }, (res) => { let t = ""; res.on("data", (c) => { t += c; }); res.on("end", () => resolve(JSON.parse(t))); }));
  assert.deepEqual(body.features, ["chat", "alerts"]);
  assert.deepEqual(ALERT_KINDS, ["follow", "gift", "share"]);
});

test("the practice account makes every kind of alert, with gifts of different sizes and pictures", async () => {
  await helper?.close();
  await start({ demoPace: [5, 10] });
  const a = listen("frills_demo", "follow,gift,share");
  await a.until(() => ["follow", "gift", "share"].every((k) => a.alerts().some((x) => x.kind === k)), 6000);
  const gifts = a.alerts().filter((x) => x.kind === "gift");
  assert.ok(gifts.every((g) => g.diamonds > 0 && g.count >= 1 && g.total === g.diamonds * g.count && g.picture.startsWith("data:image/svg+xml;base64,")), "every gift has a size and a drawn picture");
  assert.ok(a.alerts().every((x) => x.name && x.avatar), "every alert has a person with a picture");
  a.close();
});
