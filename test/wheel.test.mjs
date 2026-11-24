// Unit tests for Spin the Wheel (wheel.js): slice parsing, settings validation & URL round-trip,
// qualifying gift/bits/sub vs shared meter triggers, and PrizeWheel spin queue lifecycle.

import test from "node:test";
import assert from "node:assert/strict";
import { WHEEL, WHEEL_DESIGNS, WHEEL_SLICE_PRESETS, DEFAULT_SLICES, MAX_WHEEL_QUEUE, PrizeWheel, parseSlices, wheelEventProgress } from "../src/js/wheel.js";
import { LOOKS, coerce, listText, parseList } from "../src/js/widget-settings.js";

const gift = (name, giftName, diamonds, count = 1) => ({
  kind: "gift",
  id: `g-${name}-${giftName}`,
  user: name.toLowerCase(),
  name,
  gift: giftName,
  diamonds,
  count,
  total: diamonds * count,
});

test("parseSlices handles commas, newlines, trims to 12, and falls back when fewer than 2 slices", () => {
  assert.deepEqual(parseSlices("Pushups, \n Sing a Song , Dance"), ["Pushups", "Sing a Song", "Dance"]);
  assert.equal(parseSlices("Only one").length, DEFAULT_SLICES.split(", ").length);
  assert.equal(parseSlices("1,2,3,4,5,6,7,8,9,10,11,12,13,14").length, 12);
});

test("parseList, listText, and WHEEL_SLICE_PRESETS round-trip cleanly without breaking commas or max length", () => {
  const cleaned = listText(["Win 1,000 pts", "Sing, Dance", "", "  Sip   Water  "]);
  assert.equal(cleaned, "Win 1000 pts, Sing Dance, Sip Water");
  assert.deepEqual(parseList(cleaned), ["Win 1000 pts", "Sing Dance", "Sip Water"]);

  const slicesControl = WHEEL.controls.find((c) => c.key === "slices");
  assert.equal(slicesControl.type, "list");
  assert.equal(slicesControl.minItems, 2);
  assert.equal(slicesControl.maxItems, 12);
  assert.ok(WHEEL_SLICE_PRESETS.length >= 4);
  for (const preset of WHEEL_SLICE_PRESETS) {
    const parsed = parseSlices(preset.value);
    assert.ok(parsed.length >= 2 && parsed.length <= 12, `${preset.id} has 2..12 slices`);
    assert.equal(coerce(slicesControl, preset.value), preset.value);
  }

  // 12 full 32-char slices must fit within control.max without truncation
  const twelveLong = Array.from({ length: 12 }, (_, i) => `Slice ${String(i + 1).padStart(2, "0")} ${"x".repeat(23)}`);
  const serialized = listText(twelveLong);
  assert.equal(coerce(slicesControl, serialized), serialized);
  assert.equal(parseSlices(coerce(slicesControl, serialized)).length, 12);
});

test("WHEEL settings validate cleanly and round-trip via URL params", () => {
  assert.equal(WHEEL_DESIGNS.length, 3);
  for (const c of WHEEL.controls) {
    assert.notEqual(coerce(c, WHEEL.defaults[c.key]), undefined, `${c.key} default valid`);
  }
  const bad = WHEEL.sanitize({ design: "unknown", triggerBy: "likes", idleMode: "bounce", minDiamonds: -5, spinSeconds: 99, winSound: "nope" });
  assert.deepEqual([bad.design, bad.triggerBy, bad.idleMode, bad.minDiamonds, bad.spinSeconds, bad.winSound], ["classic", "any", "show", 1, 10, "fanfare"]);

  const custom = WHEEL.sanitize({
    ...WHEEL.defaults,
    design: "crystal",
    triggerBy: "threshold",
    idleMode: "active",
    minDiamonds: 25,
    giftName: "Galaxy",
    meterTarget: 250,
    spinSeconds: 7,
    holdSeconds: 8,
    tickSound: false,
    accent: LOOKS.arcade.accent,
  });
  const link = new URL(WHEEL.url("https://x.test/overlay/wheel/", { channel: "pondpal", settings: custom }));
  assert.equal(link.searchParams.get("design"), "crystal");
  assert.equal(link.searchParams.get("triggerBy"), "threshold");
  assert.equal(link.searchParams.get("idleMode"), "active");
  assert.equal(link.searchParams.get("giftName"), "Galaxy");
  assert.equal(link.searchParams.get("tickSound"), "0");
  assert.deepEqual(WHEEL.sanitize(WHEEL.fromParams(link.searchParams)), custom);
});

test("wheelEventProgress evaluates qualifying gifts/bits/subs, giftName filter, and spin meter mode", () => {
  const anyCfg = { ...WHEEL.defaults, triggerBy: "any", minDiamonds: 20, giftName: "", minBits: 100 };
  assert.equal(wheelEventProgress(anyCfg, { kind: "like", count: 500 }).triggers, 0);
  assert.equal(wheelEventProgress(anyCfg, gift("Ann", "Rose", 1, 5)).triggers, 0);
  assert.deepEqual(wheelEventProgress(anyCfg, gift("Ben", "Heart", 20, 1)), { triggers: 1, meterDelta: 0, label: "Heart", who: "Ben" });
  assert.equal(wheelEventProgress(anyCfg, { kind: "bits", name: "Cat", count: 50 }).triggers, 0);
  assert.deepEqual(wheelEventProgress(anyCfg, { kind: "bits", name: "Cat", count: 250 }), { triggers: 1, meterDelta: 0, label: "250 Bits", who: "Cat" });
  assert.equal(wheelEventProgress(anyCfg, { kind: "sub", name: "Dan" }).triggers, 1);

  const roseOnly = { ...anyCfg, giftName: "rose", minDiamonds: 1 };
  assert.equal(wheelEventProgress(roseOnly, gift("Ann", "Panda", 100, 1)).triggers, 0);
  assert.equal(wheelEventProgress(roseOnly, gift("Ann", "Rose", 1, 1)).triggers, 1);

  const meterCfg = { ...WHEEL.defaults, triggerBy: "threshold", meterTarget: 100 };
  assert.deepEqual(wheelEventProgress(meterCfg, gift("Eve", "Finger Heart", 5, 3)), { triggers: 0, meterDelta: 15, label: "3× Finger Heart", who: "Eve" });
  assert.deepEqual(wheelEventProgress(meterCfg, { kind: "subgift", name: "Fox", count: 2 }), { triggers: 0, meterDelta: 1000, label: "2 Gifted Subs", who: "Fox" });
});

test("PrizeWheel queues consecutive spins up to cap, accumulates spin meter across gifts, and clears cleanly", () => {
  const started = [];
  const w = new PrizeWheel({ ...WHEEL.defaults, slices: "A, B, C, D", triggerBy: "threshold", meterTarget: 50 }, {
    onSpinStart: (s) => started.push(s.slice),
    rng: () => 0.3, // floor(0.3 * 4) = 1 -> "B"
  });

  w.add(gift("Ann", "Heart", 30, 1));
  assert.deepEqual([w.meter, w.spinning, started.length], [30, false, 0]);

  w.add(gift("Ben", "Panda", 100, 1)); // total 130 -> 2 spins (2*50), remainder 30
  assert.deepEqual([w.meter, w.spinning, w.queue.length, started], [30, true, 1, ["B"]]);

  w.finishSpin();
  assert.deepEqual([w.spinning, w.queue.length, started, w.winner.slice], [true, 0, ["B", "B"], "B"]);

  w.finishSpin();
  assert.equal(w.spinning, false);
  assert.equal(w.totalSpins, 2);

  // Queue cap
  w.setSettings({ ...WHEEL.defaults, slices: "A, B", triggerBy: "any", minDiamonds: 1 });
  for (let i = 0; i < MAX_WHEEL_QUEUE + 5; i++) w.spin({ index: 0 });
  assert.equal(w.queue.length, MAX_WHEEL_QUEUE);

  w.clear();
  assert.deepEqual([w.meter, w.spinning, w.queue.length, w.winner], [0, false, 0, null]);
});
