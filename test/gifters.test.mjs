// Pure tests for Top Gifters (gifters.js): settings, URLs, TikTok diamond rankings, Twitch sub gifter / bit sender / combined modes,
// tie-breaking, milestone celebrations, pruning, and localStorage persistence.

import test from "node:test";
import assert from "node:assert/strict";
import { GIFTERS, GIFTER_LAYOUTS, GifterBoard, MIN_GIFTER_MILESTONE, giftersKey, loadGifters, saveGifters } from "../src/js/gifters.js";
import { LOOKS, coerce } from "../src/js/widget-settings.js";

const gift = (name, diamonds, count = 1) => ({ kind: "gift", id: `g-${name}`, user: name.toLowerCase(), name, gift: "Galaxy", diamonds, count, total: diamonds * count, picture: "", avatar: "" });
const subgift = (name, count) => ({ kind: "subgift", id: `s-${name}`, user: name.toLowerCase(), name, count, avatar: "" });
const bits = (name, count) => ({ kind: "bits", id: `b-${name}`, user: name.toLowerCase(), name, count, avatar: "" });

test("Top Gifters settings validate cleanly and round-trip via URL params for both TikTok and Twitch", () => {
  assert.ok(GIFTER_LAYOUTS.length >= 10, "offers plenty of leaderboard designs");
  for (const c of GIFTERS.controls) {
    assert.notEqual(coerce(c, GIFTERS.defaults[c.key]), undefined, `${c.key} default valid`);
  }
  assert.deepEqual(GIFTERS.sanitize(undefined), GIFTERS.defaults);
  const bad = GIFTERS.sanitize({ layout: "invalid", max: 99, twitchMode: "raids", milestone: 1, minDiamonds: -5, titleText: "Top\u0000" + "x".repeat(60) });
  assert.deepEqual([bad.layout, bad.max, bad.twitchMode, bad.milestone, bad.minDiamonds], ["classic", 10, "subgift", MIN_GIFTER_MILESTONE, 1]);
  assert.equal(bad.titleText.length, 40);

  const custom = GIFTERS.sanitize({ layout: "glass", max: 5, twitchMode: "bits", keep: true, accent: LOOKS.arcade.accent });
  const link = new URL(GIFTERS.url("https://x.test/overlay/gifters/", { channel: "pondpal", platform: "twitch", settings: custom }));
  assert.equal(link.searchParams.get("channel"), "pondpal");
  assert.equal(link.searchParams.get("platform"), "twitch");
  assert.equal(link.searchParams.get("layout"), "glass");
  assert.equal(link.searchParams.get("twitchMode"), "bits");
  assert.equal(link.searchParams.get("keep"), "1");
  assert.ok(!link.searchParams.has("showCounts"), "unchanged defaults omitted");
  assert.deepEqual(GIFTERS.sanitize(GIFTERS.fromParams(link.searchParams)), custom);
});

test("TikTok GifterBoard ranks by total diamonds, breaks ties by earliest arrival, and enforces minDiamonds and max", () => {
  const snapshots = [];
  const board = new GifterBoard({ ...GIFTERS.defaults, max: 3, minDiamonds: 10 }, { onChange: (t) => snapshots.push(t) });
  board.add(gift("Ann", 5)); // under minDiamonds (10)
  board.add(gift("Ben", 100));
  board.add(gift("Cat", 200));
  board.add(gift("Dan", 200));
  board.add(gift("Ann", 20)); // total 25 -> now eligible
  board.add(gift("Eve", 50));

  assert.deepEqual(board.top.map((p) => [p.rank, p.name, p.label]), [
    [1, "Cat", "200 diamonds"],
    [2, "Dan", "200 diamonds"],
    [3, "Ben", "100 diamonds"],
  ]);
  assert.equal(board.add({ kind: "follow", user: "x", name: "X" }), false);
  assert.ok(snapshots.length >= 5);
});

test("Twitch GifterBoard switches cleanly between subgifters, bit senders, and combined modes", () => {
  const board = new GifterBoard({ ...GIFTERS.defaults, twitchMode: "subgift" }, { platform: "twitch" });
  board.add(subgift("Alice", 5));
  board.add(bits("Bob", 3000));
  board.add(subgift("Bob", 2));
  board.add(bits("Alice", 500));

  assert.deepEqual(board.top.map((p) => [p.name, p.label]), [
    ["Alice", "5 subs"],
    ["Bob", "2 subs"],
  ]);

  board.setSettings({ ...board.settings, twitchMode: "bits" });
  assert.deepEqual(board.top.map((p) => [p.name, p.label]), [
    ["Bob", "3,000 bits"],
    ["Alice", "500 bits"],
  ]);

  board.setSettings({ ...board.settings, twitchMode: "combined" });
  // Combined score: Bob = 2*500 + 3000 = 4000, Alice = 5*500 + 500 = 3000
  assert.deepEqual(board.top.map((p) => [p.name, p.label, p.count]), [
    ["Bob", "2 subs · 3,000 bits", 4000],
    ["Alice", "5 subs · 500 bits", 3000],
  ]);
});

test("GifterBoard fires milestone celebrations accurately and persists top gifters safely in storage", () => {
  const cheers = [];
  const board = new GifterBoard({ ...GIFTERS.defaults, celebrate: true, milestone: 5, twitchMode: "subgift" }, {
    platform: "twitch",
    onMilestone: (info) => cheers.push(info),
  });
  board.add(subgift("Maya", 3));
  assert.equal(cheers.length, 0);
  board.add(subgift("Maya", 4)); // crosses 5 -> 7 total
  assert.deepEqual(cheers.map((c) => [c.name, c.count, c.milestone, c.unit]), [["Maya", 7, 5, "gifted subs"]]);

  const map = new Map();
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
  saveGifters(storage, "twitch", "maya_tv", board);
  assert.ok(map.has(giftersKey("twitch", "maya_tv")));
  const restored = loadGifters(storage, "twitch", "maya_tv");
  assert.deepEqual(restored.map((e) => [e.name, e.subgifts]), [["Maya", 7]]);
});
