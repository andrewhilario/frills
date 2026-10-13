// The ears on the chat bubbles: the designs (fixed drawings of ours), the settings that choose them, and how they reach a link and the
// look's CSS variables. No page needed. How they sit on a message is checked in a real browser in feed.browser.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { EARS, EAR_IDS, earsHeight, earsMarkup } from "../src/js/ears.js";
import { DEFAULTS, EAR_DEFAULTS, coerce, CONTROLS, fromParams, lookVars, overlayUrl, sanitize, toParams } from "../src/js/settings.js";
import { MATCHA_CONTROLS, MATCHA_DEFAULTS, matchaFromParams, matchaOverlayUrl, sanitizeMatcha } from "../src/js/matcha.js";

const control = (key) => CONTROLS.find((c) => c.key === key);

test("every design is a small drawing made only of shapes, coloured by our two classes; none and unknown give nothing", () => {
  assert.equal(EARS[0].id, "none");
  assert.deepEqual(EAR_IDS, ["none", "cat", "bunny", "bear", "fox", "horns", "bow", "halo"]);
  for (const { id } of EARS.filter((e) => e.id !== "none")) {
    const svg = earsMarkup(id);
    assert.match(svg, /^<svg viewBox="0 0 64 \d+" aria-hidden="true" focusable="false">.+<\/svg>$/, id);
    assert.ok(!/<script|on\w+=|href|style=|url\(/i.test(svg), id + ": nothing that could run or fetch");
    const classes = [...svg.matchAll(/class="(\w+)"/g)].map((m) => m[1]);
    assert.ok(classes.length > 0 && classes.every((c) => ["o", "i", "r"].includes(c)), id + ": only the outside, inside and line classes");
    assert.ok(earsHeight(id) > 0, id);
  }
  assert.equal(earsMarkup("none"), "");
  assert.equal(earsMarkup("<img>"), "");
  assert.equal(earsMarkup("constructor"), "", "a name from the object's own prototype is not a design");
  assert.equal(earsMarkup(undefined), "");
  assert.equal(earsHeight("none"), 0);
});

test("the ears start off, so a look is what it was until they are turned on, and every setting is acceptable", () => {
  assert.equal(DEFAULTS.ears, "none");
  assert.deepEqual({ ...EAR_DEFAULTS }, { ears: "none", earsFor: "all", earSpot: "left", earColor: "#ff9db8", earInner: "#ffd6e2", earSize: 100, earWiggle: true });
  for (const key of Object.keys(EAR_DEFAULTS)) assert.equal(coerce(control(key), EAR_DEFAULTS[key]), EAR_DEFAULTS[key], key);
  assert.equal(coerce(control("ears"), "cat"), "cat");
  assert.equal(coerce(control("ears"), "dragon"), undefined, "not a design");
  assert.equal(coerce(control("earSize"), 9999), 200, "held to its range");
  assert.equal(coerce(control("earSize"), 1), 50);
  assert.equal(coerce(control("earSpot"), "top"), undefined);
  assert.equal(coerce(control("earsFor"), "nobody"), undefined);
  assert.equal(coerce(control("earColor"), "pink"), undefined, "a color has to be a hex color");
});

test("ears go into a link only when they differ from none, and read back the same", () => {
  assert.equal(overlayUrl("https://x.test/overlay/", { channel: "me" }), "https://x.test/overlay/?channel=me", "no ears, nothing added");
  const chosen = sanitize({ ears: "bunny", earColor: "#112233", earSize: 130, earSpot: "right", earsFor: "mods", earWiggle: false });
  const url = new URL(overlayUrl("https://x.test/overlay/", { channel: "me", settings: chosen }));
  assert.equal(url.searchParams.get("ears"), "bunny");
  assert.equal(url.searchParams.get("earWiggle"), "0");
  assert.deepEqual(sanitize(fromParams(url.searchParams)), chosen);
  assert.equal(sanitize(fromParams(new URLSearchParams("ears=%3Cscript%3E"))).ears, "none", "a bad name in a link is dropped");
});

test("the look hands the page the ears' colors, size and place, and the feed who gets which design", () => {
  const { vars, attrs, feed } = lookVars(sanitize({ ears: "cat", earColor: "#112233", earInner: "#445566", earSize: 150, earSpot: "middle", earsFor: "gifts", earWiggle: false }));
  assert.equal(vars["--ear"], "#112233");
  assert.equal(vars["--ear-in"], "#445566");
  assert.equal(vars["--ear-scale"], "1.5");
  assert.deepEqual([attrs.ears, attrs.earSpot, attrs.earWiggle], ["cat", "middle", "off"]);
  assert.deepEqual([feed.ears, feed.earsFor], ["cat", "gifts"]);
  assert.equal(lookVars(DEFAULTS).attrs.earWiggle, "on");
  assert.equal(lookVars(DEFAULTS).feed.ears, "none");
});

test("the matcha looks have the same ears, off to begin with, in the panel and in the link", () => {
  const keys = MATCHA_CONTROLS.map((c) => c.key);
  for (const key of Object.keys(EAR_DEFAULTS)) {
    assert.ok(keys.includes(key), key + " is in the matcha panel");
    assert.equal(MATCHA_DEFAULTS[key], EAR_DEFAULTS[key], key);
  }
  assert.equal(matchaOverlayUrl("https://x.test/overlay/", { channel: "me", settings: MATCHA_DEFAULTS }).includes("ears"), false);
  const chosen = sanitizeMatcha({ style: "latte", ears: "cat", earSpot: "right", earSize: 80 });
  assert.equal(chosen.ears, "cat");
  const url = new URL(matchaOverlayUrl("https://x.test/overlay/", { channel: "me", settings: chosen }));
  assert.equal(url.searchParams.get("ears"), "cat");
  assert.deepEqual(sanitizeMatcha(matchaFromParams(url.searchParams)), chosen);
  assert.equal(sanitizeMatcha({ ears: "nope" }).ears, "none");
});
