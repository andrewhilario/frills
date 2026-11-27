// Unit tests for full TikTok LIVE + Twitch + Both (multistream) parity across Alerts, Songs, Last Gifts, Top Gifters, and Rotating Highlights.

import test from "node:test";
import assert from "node:assert/strict";
import { alertsUrl, DEFAULTS as ALERT_DEFAULTS } from "../src/js/alerts-settings.js";
import { SONGS, SongQueue } from "../src/js/songs.js";
import { GIFTS, GiftList } from "../src/js/gifts.js";
import { GIFTERS, GifterBoard } from "../src/js/gifters.js";
import { LABELS, LabelBoard, enabledSlotIds } from "../src/js/labels.js";

test("alertsUrl encodes Both mode (?tiktok=...&twitch=...) and preserves valid Twitch follows code", () => {
  const code = "AbCdEfGhIjKlMnOp";
  const url = alertsUrl("https://site.test/overlay/alerts/", {
    platform: "both",
    both: { tiktok: "pond.pal", twitch: "pondpal" },
    follows: code,
    settings: ALERT_DEFAULTS,
  });
  const p = new URL(url).searchParams;
  assert.equal(p.get("tiktok"), "pond.pal");
  assert.equal(p.get("twitch"), "pondpal");
  assert.equal(p.get("follows"), code);
  assert.equal(p.has("channel"), false);
  assert.equal(p.has("platform"), false);
});

test("SongQueue recognizes both TikTok and Twitch host logins in Both mode", () => {
  const q = new SongQueue(SONGS.defaults, { lookup: async () => null });
  q.handle({ id: "1", user: "u1", name: "Viewer", text: "!sr lofi beats" }, "tik.host+tw_host");
  q.handle({ id: "2", user: "u2", name: "Viewer2", text: "!sr synth wave" }, "tik.host+tw_host");
  assert.equal(q.items.length, 2);
  const skipByTwitchHost = q.handle({ id: "3", user: "tw_host", login: "tw_host", name: "Host", text: "!next" }, "tik.host+tw_host");
  assert.equal(skipByTwitchHost.kind, "next");
  assert.equal(q.items.length, 1);
  const skipByTikTokHost = q.handle({ id: "4", user: "tik.host", login: "tik.host", name: "Host", text: "!skip" }, "tik.host+tw_host");
  assert.equal(skipByTikTokHost.kind, "next");
  assert.equal(q.items.length, 0);
});

test("GiftList accepts TikTok gifts alongside Twitch subs, gifted subs, bits, and raids", () => {
  const list = new GiftList(GIFTS.defaults);
  assert.ok(list.add({ kind: "gift", name: "Mochi", gift: "Rose", count: 3, diamonds: 1, total: 3 }));
  assert.ok(list.add({ kind: "sub", name: "Lily", count: 6, resub: true }));
  assert.ok(list.add({ kind: "subgift", name: "Kero", count: 5 }));
  assert.ok(list.add({ kind: "bits", name: "Matcha", count: 500 }));
  assert.ok(list.add({ kind: "raid", name: "Neko", count: 42 }));
  assert.equal(list.items.length, 5);
  assert.deepEqual(list.items.map((i) => i.kind), ["gift", "sub", "subgift", "bits", "raid"]);
});

test("GifterBoard ranks TikTok diamonds, Twitch gifted subs, and bits together in Both mode", () => {
  const board = new GifterBoard({ ...GIFTERS.defaults, twitchMode: "combined" }, { platform: "both" });
  board.add({ kind: "gift", user: "tik1", name: "TikFan", total: 600 });
  board.add({ kind: "subgift", user: "tw1", name: "TwitchGifter", count: 2 }); // 1000 pts
  board.add({ kind: "bits", user: "tw2", name: "BitCheer", count: 350 });
  assert.deepEqual(board.top.map((p) => p.name), ["TwitchGifter", "TikFan", "BitCheer"]);
  assert.match(board.top[0].label, /2 subs/);
  assert.match(board.top[1].label, /600 diamonds/);
  assert.match(board.top[2].label, /350 bits/);
});

test("LabelBoard rotates both TikTok and Twitch highlight slots together in Both mode", () => {
  const slots = enabledSlotIds("both", LABELS.defaults);
  for (const needed of ["lastGift", "lastFollower", "lastSub", "lastBits", "topGifter", "topSubGifter", "topBitSender", "topStreak", "topLiker"]) {
    assert.ok(slots.includes(needed), `Both mode includes ${needed}`);
  }
  const board = new LabelBoard(LABELS.defaults, { platform: "both" });
  assert.equal(board.add({ kind: "gift", user: "u1", name: "TikFan", gift: "Galaxy", diamonds: 1000, count: 1, total: 1000 }), true);
  assert.equal(board.add({ kind: "sub", user: "u2", name: "TwitchSub", count: 3, resub: true }), true);
  assert.equal(board.add({ kind: "bits", user: "u3", name: "BitHero", count: 500 }), true);
  assert.equal(board.add({ kind: "subgift", user: "u4", name: "SubHero", count: 5 }), true);
  const ids = board.cards().map((c) => c.id);
  for (const id of ["lastGift", "lastSub", "lastBits", "topGifter", "topSubGifter", "topBitSender"]) {
    assert.ok(ids.includes(id), `Both LabelBoard populated ${id}`);
  }
  board.stop();
});
