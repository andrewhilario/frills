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
  const s = LABELS.sanitize({ layout: "polaroid", enter: "flip", anim: "pulse", rotateSec: 99, showBits: false, labelGift: "Latest\u0000Gift" });
  assert.deepEqual([s.layout, s.enter, s.anim, s.rotateSec, s.showBits, s.labelGift], ["polaroid", "flip", "pulse", 30, false, "Latest Gift"]);
  assert.equal(LABELS.sanitize({ enter: "bounce", anim: "float" }).enter, "bounce");
  assert.equal(LABELS.sanitize({ enter: "bounce", anim: "float" }).anim, "float");

  const url = new URL(LABELS.url("https://x.test/overlay/labels/", { channel: "pondpal", platform: "twitch", settings: s }));
  assert.equal(url.searchParams.get("platform"), "twitch");
  assert.equal(url.searchParams.get("layout"), "polaroid");
  assert.equal(url.searchParams.get("enter"), "flip");
  assert.equal(url.searchParams.get("anim"), "pulse");
  assert.equal(url.searchParams.get("showBits"), "0");
  assert.deepEqual(LABELS.sanitize(LABELS.fromParams(url.searchParams)), s);
  // Default animation & transition stay omitted from URLs so links stay short
  const defUrl = new URL(LABELS.url("https://x.test/overlay/labels/", { channel: "pondpal", platform: "twitch", settings: LABELS.defaults }));
  assert.equal(defUrl.searchParams.has("anim"), false);
  assert.equal(defUrl.searchParams.has("enter"), false);
  assert.deepEqual(enabledSlotIds("tiktok", LABELS.defaults), ["lastGift", "lastFollower", "topGifter", "topStreak", "topLiker"]);
  assert.deepEqual(enabledSlotIds("twitch", s), ["lastFollower", "lastSub", "topSubGifter", "topBitSender"]);
});

test("TikTok LabelBoard tracks last gift, last follower, top gifter (with animated best gift), and top streak, and rotates cleanly", () => {
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
  assert.equal(board.snapshot().count, 3); // lastGift + topGifter + topStreak (count 3 >= 2)
  assert.equal(board.snapshot().cards.find((c) => c.id === "topStreak").detail, "3× Rose");

  board.add({ kind: "follow", user: "bob", name: "Bob" });
  assert.equal(board.snapshot().card.id, "lastFollower", "jumps straight to new event");
  assert.equal(board.snapshot().count, 4); // lastGift, lastFollower, topGifter, topStreak

  // topGifter should update as a bigger diamond sender arrives AND carry their signature animated gift badge
  board.add({ kind: "gift", user: "cat", name: "Cat", gift: "Hand Hearts", diamonds: 100, count: 1, total: 100, picture: "https://p16.tiktokcdn.com/hand-hearts.png" });
  assert.equal(board.snapshot().card.id, "lastGift");
  const topGifterCard = board.snapshot().cards.find((c) => c.id === "topGifter");
  assert.equal(topGifterCard.headline, "Cat");
  assert.deepEqual(topGifterCard.giftBadge, {
    gift: "Hand Hearts",
    picture: "https://p16.tiktokcdn.com/hand-hearts.png",
    diamonds: 100,
    count: 1,
    tier: 2,
  });

  // Rotation advances strictly through enabled populated slots every 5 seconds
  const order = [board.snapshot().card.id];
  timers.tick(5000); order.push(board.snapshot().card.id);
  timers.tick(5000); order.push(board.snapshot().card.id);
  timers.tick(5000); order.push(board.snapshot().card.id);
  timers.tick(5000); order.push(board.snapshot().card.id);
  assert.deepEqual(order, ["lastGift", "lastFollower", "topGifter", "topStreak", "lastGift"]);
  board.stop();
});

test("Top Streak tracks both multi-send repeatCount and consecutive combo taps within 15s, keeps Top Gifter's highest gift, and persists", () => {
  const timers = clock();
  let fakeNow = 1000;
  const board = new LabelBoard(LABELS.defaults, { platform: "tiktok", timers, now: () => fakeNow });

  // Single x1 gift does NOT create a top streak yet
  board.add({ kind: "gift", user: "ann", name: "Ann", gift: "Super GG", diamonds: 100, count: 1, total: 100 });
  assert.equal(board.cards().some((c) => c.id === "topStreak"), false, "single gift is not a streak");
  assert.equal(board.cards().find((c) => c.id === "topGifter").giftBadge.gift, "Super GG");

  // Sending a tiny Rose later must NOT downgrade Ann's signature gift on Top Gifter from Super GG
  fakeNow += 2000;
  board.add({ kind: "gift", user: "ann", name: "Ann", gift: "Rose", diamonds: 1, count: 1, total: 1 });
  assert.equal(board.cards().find((c) => c.id === "topGifter").giftBadge.gift, "Super GG");

  // Consecutive Super GG taps within 15s accumulate into a 3x streak!
  fakeNow += 3000;
  board.add({ kind: "gift", user: "ann", name: "Ann", gift: "Super GG", diamonds: 100, count: 1, total: 100 });
  fakeNow += 3000;
  board.add({ kind: "gift", user: "ann", name: "Ann", gift: "Super GG", diamonds: 100, count: 1, total: 100 });
  let streak = board.cards().find((c) => c.id === "topStreak");
  assert.equal(streak.headline, "Ann");
  assert.equal(streak.detail, "3× Super GG");
  assert.equal(streak.streakCount, 3);

  // A bigger direct repeatCount streak from Ben overtakes Ann
  fakeNow += 20000;
  board.add({ kind: "gift", user: "ben", name: "Ben", gift: "Rose", diamonds: 1, count: 25, total: 25 });
  streak = board.cards().find((c) => c.id === "topStreak");
  assert.equal(streak.headline, "Ben");
  assert.equal(streak.detail, "25× Rose");
  assert.equal(streak.giftBadge.streak, true);
  assert.equal(streak.giftBadge.count, 25);

  // Persists both topStreak and bestGifts cleanly across reloads
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  saveLabels(storage, "tiktok", "pondpal", board);
  const restored = new LabelBoard(LABELS.defaults, { platform: "tiktok", timers, initial: loadLabels(storage, "tiktok", "pondpal") });
  assert.equal(restored.cards().find((c) => c.id === "topStreak").detail, "25× Rose");
  assert.equal(restored.cards().find((c) => c.id === "topGifter").giftBadge.gift, "Super GG");

  // Disabling showTopGiftAnim hides giftBadge on Top Gifter, and showTopStreak: false hides Top Streak
  restored.setSettings({ ...LABELS.defaults, showTopGiftAnim: false, showTopStreak: false });
  assert.equal(restored.cards().find((c) => c.id === "topGifter").giftBadge, null);
  assert.equal(restored.cards().some((c) => c.id === "topStreak"), false);
  board.stop();
  restored.stop();
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

test("TikTok LabelBoard shows the top liker: ranked by taps, first slide it adds appears without jumping, and likes never restart the rotation", () => {
  const timers = clock();
  const snaps = [];
  const board = new LabelBoard({ ...LABELS.defaults, rotateSec: 5 }, { platform: "tiktok", timers, onChange: (snap) => snaps.push(snap) });
  assert.deepEqual(enabledSlotIds("tiktok", LABELS.defaults), ["lastGift", "lastFollower", "topGifter", "topStreak", "topLiker"]);
  assert.deepEqual(enabledSlotIds("twitch", LABELS.defaults).includes("topLiker"), false, "Twitch has no likes");

  board.add({ kind: "follow", user: "bob", name: "Bob" });
  board.add({ kind: "follow", user: "bob", name: "Bob" });
  assert.equal(board.cards().some((c) => c.id === "topLiker"), false, "no card until somebody has liked");
  assert.equal(board.add({ kind: "like", user: "", name: "?", count: 5 }), false);
  assert.equal(board.add({ kind: "like", user: "ann", name: "Ann", count: 0 }), false);

  board.add({ kind: "like", user: "ann", name: "Ann", avatar: "", count: 12 });
  assert.equal(board.snapshot().card.id, "lastFollower", "a like does not move the slide on show");
  assert.equal(board.cards().find((c) => c.id === "topLiker").headline, "Ann");
  assert.equal(board.cards().find((c) => c.id === "topLiker").detail, "12 likes");
  assert.equal(board.cards().find((c) => c.id === "topLiker").label, "Top liker");

  board.add({ kind: "like", user: "cat", name: "Cat", count: 40 });
  board.add({ kind: "like", user: "ann", name: "Ann", count: 20 }); // Ann now 32
  assert.equal(board.cards().find((c) => c.id === "topLiker").headline, "Cat");
  board.add({ kind: "like", user: "ann", name: "Ann", count: 20 }); // Ann now 52
  assert.deepEqual([board.cards().find((c) => c.id === "topLiker").headline, board.cards().find((c) => c.id === "topLiker").detail], ["Ann", "52 likes"]);

  // A like arrives every second; the rotation still moves on every 5 seconds, because likes do not restart its timer.
  const seen = [board.snapshot().card.id];
  for (let i = 0; i < 4; i++) { timers.tick(1000); board.add({ kind: "like", user: "dan", name: "Dan", count: 1 }); }
  timers.tick(1000);
  seen.push(board.snapshot().card.id);
  assert.deepEqual(seen, ["lastFollower", "topLiker"]);

  // When the top liker's slide is on show, a new leader updates its words in place (the same slide, no new revision).
  const revision = board.snapshot().revision;
  board.add({ kind: "like", user: "dan", name: "Dan", count: 500 });
  const now = board.snapshot();
  assert.deepEqual([now.card.id, now.card.headline, now.revision], ["topLiker", "Dan", revision]);
  assert.equal(snaps.at(-1).card.headline, "Dan", "and the page was told");
  board.stop();
});

test("the top liker can be turned off, renamed, cleared, and remembered with the other highlights", () => {
  const timers = clock();
  const off = new LabelBoard({ ...LABELS.defaults, showTopLiker: false }, { platform: "tiktok", timers });
  off.add({ kind: "like", user: "ann", name: "Ann", count: 12 });
  assert.equal(off.cards().some((c) => c.id === "topLiker"), false);
  off.stop();

  const board = new LabelBoard({ ...LABELS.defaults, labelTopLiker: "Heart king" }, { platform: "tiktok", timers });
  board.add({ kind: "like", user: "ann", name: "Ann", count: 12 });
  assert.equal(board.cards().find((c) => c.id === "topLiker").label, "Heart king");

  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  saveLabels(storage, "tiktok", "pondpal", board);
  const later = new LabelBoard(LABELS.defaults, { platform: "tiktok", timers, initial: loadLabels(storage, "tiktok", "pondpal") });
  assert.deepEqual([later.cards().find((c) => c.id === "topLiker").headline, later.cards().find((c) => c.id === "topLiker").detail], ["Ann", "12 likes"]);
  store.set(labelsKey("tiktok", "broken"), JSON.stringify({ tiktokLikers: [{ user: "a", name: "A", count: "lots" }, { user: "b", name: "B", count: -4 }] }));
  assert.deepEqual(loadLabels(storage, "tiktok", "broken").tiktokLikers, [], "damaged entries are dropped");

  board.clear();
  assert.equal(board.cards().some((c) => c.id === "topLiker"), false);
  board.stop(); later.stop();
});
