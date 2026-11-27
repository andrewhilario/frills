// Unit tests for Gift Jar (jar.js): 6 crystal container designs, settings validation & URL round-trip,
// diamond and gift-count modes, full-jar behaviors (stay, empty, raise), token bounds, and localStorage persistence.

import test from "node:test";
import assert from "node:assert/strict";
import { JAR, JAR_DESIGNS, JAR_SIZES, GiftJar, jarAmount, jarKey, loadJar, saveJar, MAX_JAR_ITEMS } from "../src/js/jar.js";
import { LOOKS, coerce } from "../src/js/widget-settings.js";

const gift = (name, giftName, diamonds, count = 1, picture = "") => ({
  kind: "gift",
  id: `g-${name}-${giftName}`,
  user: name.toLowerCase(),
  name,
  gift: giftName,
  diamonds,
  count,
  total: diamonds * count,
  picture,
  avatar: "",
});

test("Gift Jar offers all 14 crystal designs, Small/Medium/Large sizes, validates settings safely, and round-trips via URL", () => {
  assert.equal(JAR_DESIGNS.length, 14, "offers all 14 crystal jar container designs");
  assert.deepEqual(JAR_SIZES.map(([id]) => id), ["small", "medium", "large"], "offers Small, Medium, and Large jar sizes");
  assert.equal(JAR.defaults.jarSize, "medium", "defaults to medium for backward compatibility");
  for (const c of JAR.controls) {
    assert.notEqual(coerce(c, JAR.defaults[c.key]), undefined, `${c.key} default valid`);
  }
  assert.deepEqual(JAR.sanitize(undefined), JAR.defaults);
  const bad = JAR.sanitize({ design: "unknown-jar", jarSize: "jumbo", goalBy: "subs", whenFull: "explode", target: -10, step: 0, titleText: "My\u0000" + "x".repeat(60) });
  assert.deepEqual([bad.design, bad.jarSize, bad.goalBy, bad.whenFull, bad.target, bad.step], ["boba", "medium", "diamonds", "stay", 1, 10]);
  assert.equal(bad.titleText.length, 36);

  // Medium (default) stays clean in URL; small and large serialize and round-trip cleanly
  const defaultLink = new URL(JAR.url("https://x.test/overlay/jar/", { channel: "pondpal", settings: JAR.defaults }));
  assert.equal(defaultLink.searchParams.get("jarSize"), null);
  for (const sizeId of ["small", "large"]) {
    const sized = JAR.sanitize({ ...JAR.defaults, jarSize: sizeId });
    const link = new URL(JAR.url("https://x.test/overlay/jar/", { channel: "pondpal", settings: sized }));
    assert.equal(link.searchParams.get("jarSize"), sizeId);
    assert.deepEqual(JAR.sanitize(JAR.fromParams(link.searchParams)), sized);
  }

  for (const [id] of JAR_DESIGNS.filter(([d]) => d !== "boba")) {
    const custom = JAR.sanitize({ ...JAR.defaults, design: id, goalBy: "count", whenFull: "empty", target: 25, showNumbers: false, capNumbers: false, showPercent: true, keep: true, accent: LOOKS.arcade.accent });
    const link = new URL(JAR.url("https://x.test/overlay/jar/", { channel: "pondpal", settings: custom }));
    assert.equal(link.searchParams.get("design"), id);
    assert.equal(link.searchParams.get("goalBy"), "count");
    assert.equal(link.searchParams.get("whenFull"), "empty");
    assert.equal(link.searchParams.get("target"), "25");
    assert.equal(link.searchParams.get("showNumbers"), "0");
    assert.equal(link.searchParams.get("capNumbers"), "0");
    assert.equal(link.searchParams.get("showPercent"), "1");
    assert.equal(link.searchParams.get("keep"), "1");
    assert.deepEqual(JAR.sanitize(JAR.fromParams(link.searchParams)), custom);
  }
});

test("jarAmount handles diamond and count modes and ignores non-gift events", () => {
  assert.equal(jarAmount("diamonds", { kind: "like", count: 50 }), 0);
  assert.equal(jarAmount("diamonds", gift("Ann", "Rose", 1, 5)), 5);
  assert.equal(jarAmount("count", gift("Ann", "Rose", 1, 5)), 5);
  assert.equal(jarAmount("diamonds", gift("Ben", "Galaxy", 1000, 1)), 1000);
  assert.equal(jarAmount("count", gift("Ben", "Galaxy", 1000, 1)), 1);
  assert.equal(jarAmount("diamonds", { kind: "bits", count: 350 }), 350);
  assert.equal(jarAmount("count", { kind: "bits", count: 350 }), 1);
  assert.equal(jarAmount("diamonds", { kind: "sub" }), 500);
  assert.equal(jarAmount("count", { kind: "sub" }), 1);
  assert.equal(jarAmount("diamonds", { kind: "subgift", count: 5 }), 2500);
  assert.equal(jarAmount("count", { kind: "subgift", count: 5 }), 5);
});

test("GiftJar drops tokens inside chamber, caps items cleanly, and triggers full-jar cycles properly", () => {
  const dropped = [];
  let fullCalls = 0;
  const jar = new GiftJar({ ...JAR.defaults, target: 100, whenFull: "stay" }, {
    onDrop: (it) => dropped.push(it.gift),
    onFull: () => { fullCalls += 1; },
  });

  assert.equal(jar.add({ kind: "follow", user: "x", name: "X" }), false);
  jar.add(gift("Ann", "Rose", 40, 1));
  assert.deepEqual([jar.total, jar.percent, jar.full, fullCalls], [40, 40, false, 0]);

  jar.add(gift("Ben", "Panda", 100, 1)); // hits 140 >= 100
  assert.deepEqual([jar.total, jar.percent, jar.full, fullCalls, jar.jarsCompleted], [140, 100, true, 1, 1]);

  // Additional gifts while staying full do not re-fire onFull
  jar.add(gift("Cat", "Rose", 20, 1));
  assert.deepEqual([jar.total, jar.full, fullCalls], [160, true, 1]);
  assert.deepEqual(dropped, ["Rose", "Panda", "Rose"]);

  // Verify raise mode
  jar.setSettings({ ...JAR.defaults, target: 100, whenFull: "raise", step: 200 });
  jar.total = 160;
  jar.wasFull = true;
  jar.finishFullCycle(1);
  assert.deepEqual([jar.target, jar.full, jar.percent], [300, false, 53]);

  // Verify empty mode
  const jar2 = new GiftJar({ ...JAR.defaults, target: 50, whenFull: "empty" });
  jar2.add(gift("Maya", "Heart", 70, 1));
  assert.equal(jar2.full, true);
  jar2.finishFullCycle(1);
  assert.deepEqual([jar2.total, jar2.items.length, jar2.full], [20, 0, false]);

  // Verify token cap MAX_JAR_ITEMS
  for (let i = 0; i < MAX_JAR_ITEMS + 10; i++) jar2.add(gift("User", `Gift${i}`, 1, 1));
  assert.equal(jar2.items.length, MAX_JAR_ITEMS);
});

test("GiftJar persists progress safely to storage and ignores corrupted entries", () => {
  const map = new Map();
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
  const jar = new GiftJar({ ...JAR.defaults, target: 500 });
  jar.add(gift("Ann", "Galaxy", 1000, 1, "https://cdn.example/g.png"));
  saveJar(storage, "pond.pal", jar);
  assert.equal(jarKey("pond.pal"), "frills:jar:pond.pal");

  const restored = loadJar(storage, "pond.pal");
  assert.equal(restored.total, 1000);
  assert.equal(restored.target, 500);
  assert.equal(restored.jarsCompleted, 1);
  assert.deepEqual(restored.items.map((it) => [it.gift, it.amount, it.picture]), [["Galaxy", 1000, "https://cdn.example/g.png"]]);

  map.set(jarKey("bad"), "{broken");
  assert.equal(loadJar(storage, "bad"), null);
  map.set(jarKey("neg"), JSON.stringify({ total: -5, target: 100 }));
  assert.equal(loadJar(storage, "neg"), null);
});
