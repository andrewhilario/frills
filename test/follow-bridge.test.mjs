// The two ends of the Twitch follows post box in the browser (src/js/follow-bridge.js): the code and key a tab makes and keeps, the tab's
// sending (and trying again), and the overlay's reading (once each, never replayed). A pretend fetch, pretend storage and a pretend clock.

import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { FollowPublisher, FollowReader, followIdentity, followsOn, setFollowsOn, validCode } from "../src/js/follow-bridge.js";
import { alertsUrl, DEFAULTS, PLATFORM_KINDS, TWITCH_CHAT_KINDS } from "../src/js/alerts-settings.js";

const memory = () => { const data = new Map(); return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), data }; };

test("a tab makes its code and key once and keeps them; a damaged keep is replaced; blocked storage still gives a pair", () => {
  const storage = memory();
  const first = followIdentity(storage);
  assert.match(first.code, /^[A-Za-z0-9_-]{16}$/);
  assert.match(first.key, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(first.code, first.key.slice(0, 16));
  assert.deepEqual(followIdentity(storage), first, "the same pair every time");
  storage.setItem("frills:twitch:bridge", JSON.stringify({ code: "short", key: "x" }));
  const replaced = followIdentity(storage);
  assert.match(replaced.code, /^[A-Za-z0-9_-]{16}$/);
  const blocked = followIdentity({ getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); } });
  assert.match(blocked.code, /^[A-Za-z0-9_-]{16}$/);
});

test("a code from a link is accepted only when it is one", () => {
  assert.equal(validCode("abcdefghij123456"), "abcdefghij123456");
  for (const bad of ["", "short", "abcdefghij12345678", "abcdefghij12345!", "../../abcdefghij", null, undefined, 7]) assert.equal(validCode(bad), "", String(bad));
});

test("whether to put the follows in the link is remembered, off to begin with", () => {
  const storage = memory();
  assert.equal(followsOn(storage), false);
  setFollowsOn(true, storage);
  assert.equal(followsOn(storage), true);
  setFollowsOn(false, storage);
  assert.equal(followsOn(storage), false);
  assert.equal(followsOn({ getItem() { throw new Error("no"); } }), false);
});

test("the link carries the code only for a Twitch link, and only a real code", () => {
  const code = "abcdefghij123456";
  const url = (platform, follows) => alertsUrl("https://x.test/overlay/alerts/", { channel: "me", settings: DEFAULTS, platform, follows });
  assert.equal(url("twitch", code), `https://x.test/overlay/alerts/?channel=me&platform=twitch&follows=${code}`);
  assert.equal(url("twitch", ""), "https://x.test/overlay/alerts/?channel=me&platform=twitch");
  assert.equal(url("twitch", "not a code!"), "https://x.test/overlay/alerts/?channel=me&platform=twitch", "nothing odd ever goes into a link");
  assert.equal(url("tiktok", code), "https://x.test/overlay/alerts/?channel=me&platform=tiktok", "TikTok has no follow box");
  assert.deepEqual(PLATFORM_KINDS.twitch, ["follow", "sub", "subgift", "bits", "raid"]);
  assert.deepEqual(TWITCH_CHAT_KINDS, ["sub", "subgift", "bits", "raid"], "follows are the one kind that does not come in the chat connection");
});

test("the tab posts each follower with its key, keeps one that could not be sent and tries again, and says it is still here", async () => {
  const sent = [];
  let down = false;
  let status = 200;
  const fetchImpl = async (url, options) => {
    if (down) throw new Error("offline");
    sent.push({ url, body: JSON.parse(options.body), key: options.headers["x-key"], method: options.method });
    return { ok: status >= 200 && status < 300, status };
  };
  const errors = [];
  const tab = new FollowPublisher({ code: "abcdefghij123456", key: "k".repeat(32), fetchImpl, onError: (s) => errors.push(s) });
  assert.equal(await tab.send({ id: "1", user: "ann", name: "Ann" }), true);
  assert.deepEqual(sent[0], { url: "/api/follows/abcdefghij123456", body: { id: "1", user: "ann", name: "Ann" }, key: "k".repeat(32), method: "POST" });
  down = true;
  assert.equal(await tab.send({ id: "2", user: "ben", name: "Ben" }), false, "offline: kept");
  assert.equal(await tab.send({ id: "3", user: "cat", name: "Cat" }), false);
  assert.equal(tab.waiting.length, 2);
  down = false;
  assert.equal(await tab.ping(), true, "the next call sends what was waiting first, in order, then says it is here");
  assert.deepEqual(sent.slice(1).map((s) => s.body), [{ id: "2", user: "ben", name: "Ben" }, { id: "3", user: "cat", name: "Cat" }, { ping: true }]);
  assert.equal(tab.waiting.length, 0);
  status = 429;
  assert.equal(await tab.send({ id: "4", user: "dan", name: "Dan" }), false, "too fast: kept for later");
  status = 400;
  assert.equal(await tab.send({ id: "5", user: "eve", name: "Eve" }), true, "a follow the server refuses (and the one waiting before it) is let go, not tried forever");
  assert.equal(tab.waiting.length, 0);
  assert.ok(errors.includes(0) && errors.includes(429));
  down = true;
  for (let i = 0; i < 30; i++) await tab.send({ id: "x" + i, user: "u", name: "N" + i });
  assert.equal(tab.waiting.length, 20, "at most twenty are kept");
  assert.equal(tab.waiting[0].name, "N10", "the oldest give way");
});

test("the overlay learns where the line is, then gets each new follower once, and says whether the tab has been seen lately", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const asked = [];
  let answer = { ok: true, now: 1000000, seq: 5, updatedAt: 990000, items: [] };
  const fetchImpl = async (url) => { asked.push(url); return { ok: true, json: async () => answer }; };
  const got = [];
  const states = [];
  const reader = new FollowReader({ code: "abcdefghij123456", fetchImpl, onFollow: (f) => got.push(f.name), onState: (s) => states.push(s.alive), everyMs: 5000 }).start();
  try {
    await new Promise((r) => setImmediate(r));
    assert.equal(asked[0], "/api/follows/abcdefghij123456", "the first ask has no number: it only learns where the line is");
    assert.deepEqual(got, [], "nothing from before is replayed");
    answer = { ok: true, now: 1005000, seq: 7, updatedAt: 1004000, items: [{ seq: 6, id: "a", user: "ann", name: "Ann" }, { seq: 7, id: "b", user: "ben", name: "Ben" }] };
    mock.timers.tick(5000);
    await new Promise((r) => setImmediate(r));
    assert.equal(asked[1], "/api/follows/abcdefghij123456?after=5");
    assert.deepEqual(got, ["Ann", "Ben"]);
    answer = { ...answer, items: [{ seq: 7, id: "b", user: "ben", name: "Ben" }, { seq: 8, id: "c", user: "cat", name: "Cat" }] };
    mock.timers.tick(5000);
    await new Promise((r) => setImmediate(r));
    assert.equal(asked[2], "/api/follows/abcdefghij123456?after=7");
    assert.deepEqual(got, ["Ann", "Ben", "Cat"], "Ben is not shown again");
    assert.deepEqual(states.slice(0, 2), [true, true]);
    answer = { ...answer, now: 1000000 + 400000, items: [] };
    mock.timers.tick(5000);
    await new Promise((r) => setImmediate(r));
    assert.equal(states.at(-1), false, "no sign of the tab for three minutes");
  } finally {
    reader.stop();
    mock.timers.reset();
  }
});

test("when the box cannot be reached the overlay just asks again, from the same number, and stop() ends it", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  let fail = false;
  const asked = [];
  const fetchImpl = async (url) => { asked.push(url); if (fail) throw new Error("offline"); return { ok: true, json: async () => ({ now: 10, seq: 3, updatedAt: 5, items: asked.length > 2 ? [{ seq: 4, id: "z", user: "z", name: "Zed" }] : [] }) }; };
  const got = [];
  const reader = new FollowReader({ code: "abcdefghij123456", fetchImpl, onFollow: (f) => got.push(f.name) }).start();
  try {
    await new Promise((r) => setImmediate(r));
    fail = true;
    mock.timers.tick(5000);
    await new Promise((r) => setImmediate(r));
    fail = false;
    mock.timers.tick(5000);
    await new Promise((r) => setImmediate(r));
    assert.equal(asked.at(-1), "/api/follows/abcdefghij123456?after=3", "asked again from the number it knew");
    assert.deepEqual(got, ["Zed"]);
    reader.stop();
    const count = asked.length;
    mock.timers.tick(60000);
    assert.equal(asked.length, count, "nothing after stop");
  } finally {
    reader.stop();
    mock.timers.reset();
  }
});
