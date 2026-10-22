// Decorations on the chat bubbles and the name tag: the packs (data), the settings that choose them, how they reach a link and the look's
// variables. No page needed. How they sit on a message is checked in a real browser in decor.browser.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DECOS, DECO_IDS, PACKS, decoPieces, hasDeco, seedOf } from "../src/js/decor.js";
import { CONTROLS, DECO_DEFAULTS, DEFAULTS, coerce, decoAttrs, decoFeed, decoVars, fromParams, lookVars, overlayUrl, sanitize } from "../src/js/settings.js";
import { MATCHA_CONTROLS, MATCHA_DEFAULTS, matchaFromParams, matchaOverlayUrl, sanitizeMatcha } from "../src/js/matcha.js";

const control = (key) => CONTROLS.find((c) => c.key === key);

test("the packs: none, Frog pond, Neko cafe, Hamster burrow and Bunny cloud (pictures that really exist in the site)", () => {
  assert.deepEqual(DECO_IDS, ["none", "frog", "neko", "hamster", "bunny"]);
  assert.deepEqual(Object.keys(PACKS), ["frog", "neko", "hamster", "bunny"]);
  assert.equal(DECOS[0].id, "none");
  const files = join(import.meta.dirname, "..", "public");
  for (const name of ["frog", "neko", "hamster", "bunny"]) {
    for (const piece of [...PACKS[name].peek, ...PACKS[name].corner, ...PACKS[name].spark]) {
      assert.match(piece.src, new RegExp(`^/decor/${name}/[a-z0-9-]+\\.webp$`), "a picture from this site only");
      assert.ok(existsSync(join(files, piece.src)), `${piece.src} is in public/`);
    }
    assert.ok(PACKS[name].corner.length > 0 && PACKS[name].spark.length > 0);
  }
  for (const name of ["neko", "hamster", "bunny"]) {
    assert.equal(PACKS[name].peek.length, 2, `${name}: two friends peek over the top`);
    assert.ok(PACKS[name].peek.every((p) => p.ratio > 0.3 && p.ratio < 1), `${name}: the friends on top say how tall they are, so room is left for them`);
    assert.equal(PACKS[name].spark.length, 8, `${name}: eight little pieces`);
  }
});

test("a message gets the same pieces every time, different messages get different ones, and the switches leave pieces out", () => {
  assert.equal(seedOf("abc"), seedOf("abc"));
  assert.notEqual(seedOf("abc"), seedOf("abd"));
  assert.equal(seedOf(undefined), seedOf(""));
  const a = decoPieces("neko", seedOf("one"));
  assert.deepEqual(a, decoPieces("neko", seedOf("one")));
  assert.ok(PACKS.neko.peek.includes(a.peek) && PACKS.neko.corner.includes(a.corner));
  assert.equal(a.spark.length, 3);
  assert.equal(new Set(a.spark.map((p) => p.src)).size, 3, "three different little pieces around one message");
  const kinds = new Set(Array.from({ length: 40 }, (_, i) => decoPieces("neko", seedOf("m" + i)).spark[0].src));
  assert.ok(kinds.size > 1, "the little pieces vary from message to message");
  const peekers = new Set(Array.from({ length: 40 }, (_, i) => decoPieces("neko", seedOf("m" + i)).peek.src));
  assert.equal(peekers.size, 2, "both cats turn up");
  const some = decoPieces("neko", 1, { peek: false, corner: false, spark: true });
  assert.equal(some.peek, null);
  assert.equal(some.corner, null);
  assert.ok(some.spark.length > 0);
  assert.equal(hasDeco(decoPieces("neko", 1, { peek: false, corner: false, spark: false })), false);
  assert.equal(decoPieces("none", 1), null);
  assert.equal(decoPieces("constructor", 1), null, "a name from the object's own prototype is not a pack");
  assert.equal(decoPieces("frog", 1).peek, null, "the frog has no peeking friend yet, so that slot stays empty instead of breaking");
  assert.equal(hasDeco(null), false);
});

test("decorations and the name tag start off, so a look is what it was, and every setting is acceptable", () => {
  assert.equal(DEFAULTS.deco, "none");
  assert.equal(DEFAULTS.tag, "inside");
  assert.deepEqual({ ...DECO_DEFAULTS }, { deco: "none", decoSize: 100, decoSide: "left", decoPeek: true, decoCorner: true, decoSpark: true, decoFor: "all", tag: "inside" });
  for (const key of Object.keys(DECO_DEFAULTS)) assert.equal(coerce(control(key), DECO_DEFAULTS[key]), DECO_DEFAULTS[key], key);
  assert.equal(coerce(control("deco"), "frog"), "frog");
  assert.equal(coerce(control("deco"), "dragons"), undefined);
  assert.equal(coerce(control("decoSize"), 9999), 200);
  assert.equal(coerce(control("decoSize"), 1), 50);
  assert.equal(coerce(control("decoSide"), "middle"), undefined);
  assert.equal(coerce(control("tag"), "pill"), "pill");
  assert.equal(coerce(control("tag"), "banner"), undefined);
  assert.equal(coerce(control("decoFor"), "nobody"), undefined);
});

test("the decoration settings sit up front under the picker and are hidden by the editors while it is None; the name tag is always there", () => {
  const keys = CONTROLS.map((c) => c.key);
  const at = keys.indexOf("deco");
  assert.deepEqual(keys.slice(at + 1, at + 8), ["decoSize", "decoSide", "decoPeek", "decoCorner", "decoSpark", "decoFor", "tag"]);
  for (const key of ["decoSize", "decoSide", "decoPeek", "decoCorner", "decoSpark", "decoFor"]) assert.equal(control(key).needs, "deco", key);
  assert.equal(control("deco").needs, undefined);
  assert.equal(control("tag").needs, undefined, "a name tag does not need a decoration");
  assert.ok(control("deco").where === "main" && control("tag").where === "main");
});

test("decorations and the tag go into a link only when they differ from the start, and read back the same", () => {
  assert.equal(overlayUrl("https://x.test/overlay/", { channel: "me" }), "https://x.test/overlay/?channel=me");
  const chosen = sanitize({ deco: "neko", decoSize: 130, decoSide: "right", decoPeek: false, decoFor: "mods", tag: "pill" });
  const url = new URL(overlayUrl("https://x.test/overlay/", { channel: "me", settings: chosen }));
  assert.equal(url.searchParams.get("deco"), "neko");
  assert.equal(url.searchParams.get("decoPeek"), "0");
  assert.equal(url.searchParams.get("tag"), "pill");
  assert.deepEqual(sanitize(fromParams(url.searchParams)), chosen);
  assert.equal(sanitize(fromParams(new URLSearchParams("deco=%3Cimg%3E"))).deco, "none");
  assert.equal(sanitize(fromParams(new URLSearchParams("deco=shapes"))).deco, "none", "a link made when there was a Plain shapes pack just shows no decorations");
});

test("the look hands the page the size, the pack, the side and the tag, and the feed what to draw", () => {
  const s = sanitize({ deco: "frog", decoSize: 150, decoSide: "right", decoSpark: false, decoFor: "gifts", tag: "pill" });
  assert.deepEqual({ ...decoVars(s) }, { "--deco-scale": "1.5" });
  assert.deepEqual({ ...decoAttrs(s) }, { deco: "frog", decoSide: "right", tag: "pill" });
  assert.deepEqual({ ...decoFeed(s) }, { deco: "frog", decoFor: "gifts", decoPeek: true, decoCorner: true, decoSpark: false });
  const { vars, attrs, feed } = lookVars(s);
  assert.equal(vars["--deco-scale"], "1.5");
  assert.equal(attrs.deco, "frog");
  assert.equal(attrs.tag, "pill");
  assert.equal(feed.deco, "frog");
  assert.equal(lookVars(DEFAULTS).attrs.deco, "none");
  assert.equal(lookVars(DEFAULTS).feed.deco, "none");
});

test("the matcha looks have the same decorations and name tag, off to begin with", () => {
  const keys = MATCHA_CONTROLS.map((c) => c.key);
  for (const key of Object.keys(DECO_DEFAULTS)) {
    assert.ok(keys.includes(key), key + " is in the matcha panel");
    assert.equal(MATCHA_DEFAULTS[key], DECO_DEFAULTS[key], key);
  }
  assert.equal(matchaOverlayUrl("https://x.test/overlay/", { channel: "me", settings: MATCHA_DEFAULTS }).includes("deco"), false);
  const chosen = sanitizeMatcha({ style: "latte", deco: "frog", tag: "pill", decoSide: "right" });
  const url = new URL(matchaOverlayUrl("https://x.test/overlay/", { channel: "me", settings: chosen }));
  assert.equal(url.searchParams.get("deco"), "frog");
  assert.deepEqual(sanitizeMatcha(matchaFromParams(url.searchParams)), chosen);
});
