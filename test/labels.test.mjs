// Pure tests for Rotating Highlights (labels.js): settings, URLs, TikTok (last gift, last follower, top gifter) &
// Twitch (last follower, last sub, last bits, top sub gifter, top bit sender) tracking, rotation clock, jump-on-new,
// toggle switches, and localStorage persistence.

import test from "node:test";
import assert from "node:assert/strict";
import { LABELS, LABEL_LAYOUTS, LabelBoard, enabledSlotIds, labelsKey, loadLabels, saveLabels } from "../src/js/labels.js";
import { coerce } from "../src/js/widget-settings.js";

function clock() {
  let now = 0;
  let next = 1;
  const jobs = new Map();
  return {
    setTimeout: (fn, ms) => { const id = next++; jobs.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: (id) => jobs.delete(id),
    tick(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...jobs].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        jobs.delete(due[0]);
        due[1].fn();
      }
      now = end;
    },
  };
}

test("Labels settings validate bounds and serialize only overrides cleanly", () => {
  assert.ok(LABEL_LAYOUTS.length >= 12, "offers plenty of highlight card designs");
  for (const c of LABELS.controls) assert.notEqual(coerce(c, LABELS.defaults[c.key]), undefined, `${c.key}`);
  const s = LABELS.sanitize({ layout: "polaroid", enter: "pop", rotateSec: 99, showBits: false, labelGift: "Latest\u0000Gift" });
  assert.deepEqual([s.layout, s.enter, s.rotateSec, s.showBits, s.labelGift], ["polaroid", "pop", 30, false, "Latest Gift"]);

  const url = new URL(LABELS.url("https://x.test/overlay/labels/", { channel: "pondpal", platform: "twitch", settings: s }));
  assert.equal(url.searchParams.get("platform"), "twitch");
  assert.equal(url.searchParams.get("layout"), "polaroid");
  assert.equal(url.searchParams.get("showBits"), "0");
  assert.deepEqual(LABELS.sanitize(LABELS.fromParams(url.searchParams)), s);
  assert.deepEqual(enabledSlotIds("tiktok", LABELS.defaults), ["lastGift", "lastFollower", "topGifter"]);
  assert.deepEqual(enabledSlotIds("twitch", s), ["lastFollower", "lastSub", "topSubGifter", "topBitSender"]);
});

test("TikTok LabelBoard tracks last gift, last follower and top gifter, jumps on arrivals, and rotates cleanly", () => {
  const timers = clock();
  const snaps = [];
  const board = new LabelBoard({ ...LABELS.defaults, rotateSec: 5 }, {
    platform: "tiktok",
    timers,
    onChange: (snap) => snaps.push(snap),
  });

  assert.equal(board.snapshot().card.id, "idle");

  board.add({ kind: "gift", user: "ann", name: "Ann", gift: "Rose", diamonds: 1, count: 3, total: 3 });
  assert.equal(board.snapshot().card.id, "lastGift");
  assert.equal(board.snapshot().card.headline, "Ann · Rose ×3");
  assert.equal(board.snapshot().card.detail, "3 diamonds");
  assert.equal(board.snapshot().count, 2); // lastGift + topGifter

  board.add({ kind: "follow", user: "bob", name: "Bob" });
  assert.equal(board.snapshot().card.id, "lastFollower", "jumps straight to new event");
  assert.equal(board.snapshot().count, 3); // lastGift, lastFollower, topGifter

  // topGifter should update as a bigger diamond sender arrives
  board.add({ kind: "gift", user: "cat", name: "Cat", gift: "Galaxy", diamonds: 1000, count: 1, total: 1000 });
  assert.equal(board.snapshot().card.id, "lastGift");
  assert.equal(board.snapshot().cards.find((c) => c.id === "topGifter").headline, "Cat");

  // Rotation advances strictly through enabled populated slots every 5 seconds
  const order = [board.snapshot().card.id];
  timers.tick(5000); order.push(board.snapshot().card.id);
  timers.tick(5000); order.push(board.snapshot().card.id);
  timers.tick(5000); order.push(board.snapshot().card.id);
  assert.deepEqual(order, ["lastGift", "lastFollower", "topGifter", "lastGift"]);
  board.stop();
});

test("Twitch LabelBoard tracks last follower, last sub, last bits, top sub gifter, top bit sender, and persists state", () => {
  const timers = clock();
  const board = new LabelBoard({ ...LABELS.defaults, rotateSec: 4 }, { platform: "twitch", timers });

  board.add({ kind: "follow", user: "f1", name: "FollowOne" });
  board.add({ kind: "sub", user: "s1", name: "SubOne", resub: true, count: 6 });
  board.add({ kind: "bits", user: "b1", name: "BitKing", count: 1500 });
  board.add({ kind: "subgift", user: "g1", name: "GiftQueen", count: 10 });
  board.add({ kind: "gift", user: "t1", name: "TikTokUser", gift: "Rose", total: 1 }); // ignored on Twitch

  const cards = board.cards();
  assert.deepEqual(cards.map((c) => [c.id, c.headline, c.detail]), [
    ["lastFollower", "FollowOne", ""],
    ["lastSub", "SubOne", "6 months resub"],
    ["lastBits", "BitKing", "1,500 bits"],
    ["topSubGifter", "GiftQueen", "10 gifted subs"],
    ["topBitSender", "BitKing", "1,500 bits"],
  ]);

  const map = new Map();
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
  saveLabels(storage, "twitch", "pondpal", board);
  const loaded = loadLabels(storage, "twitch", "pondpal");
  assert.ok(loaded && map.has(labelsKey("twitch", "pondpal")));

  const restored = new LabelBoard(LABELS.defaults, { platform: "twitch", timers, initial: loaded });
  assert.deepEqual(restored.cards().map((c) => c.headline), ["FollowOne", "SubOne", "BitKing", "GiftQueen", "BitKing"]);
  board.stop();
  restored.stop();
});
