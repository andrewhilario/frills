// Uploaded images and sounds on the page side, with no page: how the ids are checked and carried in the link, which image and sound an
// alert gets (a big gift can have its own), and how an uploaded sound is fetched once and played a little higher for a bigger gift.

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, MEDIA_ID, alertsUrl, fromParams, mediaUrl, sanitize } from "../src/js/alerts-settings.js";
import { makeAlert } from "../src/js/alerts.js";
import { createSounds } from "../src/js/sounds.js";

test("an uploaded file is named by exactly 16 safe characters, or nothing", () => {
  const id = "AbCdEf012345_-xY";
  const s = sanitize({ followImage: id, followMySound: "../../etc/passwd", giftImage: "short", shareImage: "AbCdEf012345_-xYZ", giftBigImage: "<script>alert(1)</", imageMode: "sticker" });
  assert.equal(s.followImage, id);
  for (const key of ["followMySound", "giftImage", "shareImage", "giftBigImage"]) assert.equal(s[key], "", `${key} is dropped`);
  assert.equal(s.imageMode, "sticker");
  assert.equal(sanitize({ imageMode: "huge" }).imageMode, "beside");
  assert.ok(MEDIA_ID.test(id) && !MEDIA_ID.test("a b c d e f g h i j"));
  assert.equal(mediaUrl(id), `/api/media/${id}`);
});

test("the ids ride in the link and come back out of it, and an empty one stays out", () => {
  const s = sanitize({ giftImage: "AAAAAAAAAAAAAAAA", giftMySound: "BBBBBBBBBBBBBBBB", imageMode: "avatar" });
  const params = new URL(alertsUrl("https://x.test/overlay/alerts/", { channel: "a_b", settings: s })).searchParams;
  assert.equal(params.get("giftImage"), "AAAAAAAAAAAAAAAA");
  assert.equal(params.get("giftMySound"), "BBBBBBBBBBBBBBBB");
  assert.ok(!params.has("followImage"), "nothing uploaded, nothing in the link");
  assert.deepEqual(sanitize(fromParams(params)), s);
});

test("an alert carries the person's own image and sound, and a big gift can have its own", () => {
  const config = { ...DEFAULTS, followImage: "FFFFFFFFFFFFFFFF", followMySound: "SSSSSSSSSSSSSSSS", giftImage: "GGGGGGGGGGGGGGGG", giftMySound: "HHHHHHHHHHHHHHHH", giftBigImage: "BIGBIGBIGBIGBIG1", giftBigMySound: "BIGBIGBIGBIGBIG2" };
  const follow = makeAlert({ kind: "follow", name: "A" }, config);
  assert.deepEqual([follow.image, follow.mySound], ["FFFFFFFFFFFFFFFF", "SSSSSSSSSSSSSSSS"]);
  const small = makeAlert({ kind: "gift", name: "A", gift: "Rose", diamonds: 1, count: 1, total: 1 }, config);
  assert.deepEqual([small.image, small.mySound], ["GGGGGGGGGGGGGGGG", "HHHHHHHHHHHHHHHH"]);
  const bigGift = { kind: "gift", name: "A", gift: "Galaxy", diamonds: 1500, count: 1, total: 1500 };
  const big = makeAlert(bigGift, config);
  assert.deepEqual([big.image, big.mySound], ["BIGBIGBIGBIGBIG1", "BIGBIGBIGBIGBIG2"]);
  const same = makeAlert(bigGift, { ...config, giftBigImage: "", giftBigMySound: "" });
  assert.deepEqual([same.image, same.mySound], ["GGGGGGGGGGGGGGGG", "HHHHHHHHHHHHHHHH"], "no big-gift file set: the normal one is used");
  const share = makeAlert({ kind: "share", name: "A" }, DEFAULTS);
  assert.deepEqual([share.image, share.mySound], ["", ""]);
});

test("an uploaded sound is fetched and decoded once, and played a little higher for a bigger gift", async () => {
  const played = [];
  class Context {
    constructor() { this.state = "running"; this.destination = {}; }
    resume() { return Promise.resolve(); }
    decodeAudioData(data) { played.push("decoded " + data.byteLength); return Promise.resolve({ decoded: true }); }
    createGain() { return { gain: { value: 0 }, connect() {} }; }
    createBufferSource() { const s = { playbackRate: { value: 1 }, connect() {}, start() { played.push("rate " + s.playbackRate.value); } }; return s; }
  }
  const real = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async (url) => { fetched += 1; return { ok: url === "/api/media/AAAAAAAAAAAAAAAA", arrayBuffer: async () => new ArrayBuffer(10) }; };
  try {
    const sounds = createSounds(Context);
    assert.equal(await sounds.playUrl("/api/media/AAAAAAAAAAAAAAAA", { tier: 1 }), true);
    assert.equal(await sounds.playUrl("/api/media/AAAAAAAAAAAAAAAA", { tier: 3 }), true);
    assert.equal(fetched, 1, "fetched once");
    assert.deepEqual(played, ["decoded 10", "rate 1", "rate 1.26"]);
    assert.equal(await sounds.playUrl("/api/media/MISSINGMISSINGMI", {}), false, "a file that is gone plays nothing and does not throw");
    assert.equal(await sounds.playUrl("/api/media/AAAAAAAAAAAAAAAA", { volume: 0 }), false);
  } finally { globalThis.fetch = real; }
});
