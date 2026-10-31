// The seasonal looks (Halloween, Christmas): that each is a complete, valid look, readable, offered first in its season and only then, and understood
// all year by links and saved settings. No page needed; how the editors show them is checked in a real browser in seasonal.browser.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { CONTROLS, DEFAULTS, FONTS, LOOK_KEYS, PRESETS, coerce, currentPreset, fromParams, lookVars, overlayUrl, sanitize } from "../src/js/settings.js";
import { SEASONAL, SEASONAL_NAMES, SEASON_PRESETS, looksFor } from "../src/js/seasonal-looks.js";
import * as alerts from "../src/js/alerts-settings.js";
import { defineWidget } from "../src/js/widget-settings.js";
import { DECO_IDS } from "../src/js/decor.js";
import { SEASONS } from "../src/js/season.js";
import { luminance } from "../src/js/color.js";

const control = (key) => CONTROLS.find((c) => c.key === key);
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test("each season has at least three looks, and every look has a name and a unique id", () => {
  assert.deepEqual(Object.keys(SEASONAL).sort(), SEASONS.map((s) => s.id).sort(), "one set of looks for every season");
  for (const [season, looks] of Object.entries(SEASONAL)) assert.ok(Object.keys(looks).length >= 3, `${season} has a choice of at least three`);
  const ids = Object.keys(SEASON_PRESETS);
  assert.equal(new Set(ids).size, ids.length, "no look is in two seasons");
  assert.ok(ids.every((id) => !(id in PRESETS)), "no seasonal look takes the name of a usual one");
  assert.ok(ids.every((id) => SEASONAL_NAMES[id]), "each has a name");
  assert.deepEqual(Object.keys(alerts.SEASON_LOOKS).sort(), [...ids].sort(), "the alert cards have the same looks");
});

test("every seasonal chat look sets the look settings, every value is acceptable, it uses a font we ship and a pack that exists, and it can be read", () => {
  for (const [season, looks] of Object.entries(SEASONAL)) {
    for (const [name, look] of Object.entries(looks)) {
      assert.deepEqual(Object.keys(look).sort(), [...LOOK_KEYS, "deco"].sort(), `${name}: the usual look settings, and its season's pictures`);
      for (const key of [...LOOK_KEYS, "deco"]) assert.equal(coerce(control(key), look[key]), look[key], `${name}.${key}`);
      assert.ok(look.font in FONTS, `${name} uses a font we ship`);
      assert.equal(look.deco, season, `${name} brings its season's pictures`);
      assert.ok(DECO_IDS.includes(look.deco));
      if (look.bgAlpha >= 50) assert.ok(contrast(look.text, look.bg) >= 4.5, `${name}: the words stand out from the box (${contrast(look.text, look.bg).toFixed(1)}:1)`);
      assert.ok(contrast(look.accent, look.bg) >= 3 || look.bgAlpha < 50, `${name}: the name stands out from the box`);
      const { vars } = lookVars(sanitize(look));
      for (const [key, value] of Object.entries(vars)) assert.doesNotMatch(String(value), /color-mix|oklch|lab\(|lch\(/, `${name} ${key}: plain colors an old OBS browser can draw`);
    }
  }
});

test("every seasonal alert look sets the alert look settings, every value is acceptable, and it can be read", () => {
  for (const [season, looks] of Object.entries(alerts.SEASONAL_LOOKS)) {
    for (const [name, look] of Object.entries(looks)) {
      assert.deepEqual(Object.keys(look).sort(), [...alerts.LOOK_KEYS, "deco"].sort(), `${name}: the usual look settings, and its season's pictures`);
      const kept = alerts.sanitize(look);
      for (const key of [...alerts.LOOK_KEYS, "deco"]) assert.equal(kept[key], look[key], `${season}/${name}.${key}`);
      assert.equal(look.deco, season, `${name} brings its season's pictures`);
      assert.ok(look.font in FONTS);
      assert.ok(contrast(look.text, look.bg) >= 4.5, `${name}: the words stand out from the card (${contrast(look.text, look.bg).toFixed(1)}:1)`);
    }
  }
});

test("an editor is offered the season's looks first, and only that season's, then the usual ones", () => {
  const usual = Object.keys(PRESETS);
  const halloween = looksFor("halloween");
  assert.deepEqual(halloween.slice(0, Object.keys(SEASONAL.halloween).length).map((l) => l.id), Object.keys(SEASONAL.halloween));
  assert.ok(halloween.slice(0, Object.keys(SEASONAL.halloween).length).every((l) => l.season === "halloween" && l.name && l.preset));
  assert.deepEqual(halloween.slice(Object.keys(SEASONAL.halloween).length).map((l) => l.id), usual, "then the usual ones, in their own order, with no season mark");
  assert.ok(halloween.slice(-usual.length).every((l) => l.season === undefined));
  assert.ok(looksFor("christmas").slice(0, 3).every((l) => l.season === "christmas"));
  assert.ok(!looksFor("christmas").some((l) => l.id === "pumpkin"), "no Halloween look at Christmas");
  for (const none of [null, undefined, "easter", "constructor", "__proto__"]) assert.deepEqual(looksFor(none).map((l) => l.id), usual, `between seasons: only the usual looks (${none})`);
  const alertLooks = alerts.looksFor("halloween");
  assert.deepEqual(alertLooks.slice(0, 4).map((l) => l.id), Object.keys(alerts.SEASONAL_LOOKS.halloween));
  assert.deepEqual(alerts.looksFor(null).map((l) => l.id), Object.keys(alerts.LOOKS));
});

test("a seasonal look still works when its season is over: an address names it, and the editor knows it", () => {
  const raw = fromParams(new URLSearchParams("look=pumpkin"), SEASON_PRESETS);
  assert.equal(raw.accent, SEASONAL.halloween.pumpkin.accent);
  assert.equal(raw.deco, "halloween", "its pictures come with it");
  const settings = sanitize(raw);
  assert.equal(settings.bg, SEASONAL.halloween.pumpkin.bg);
  assert.equal(currentPreset(settings, SEASON_PRESETS), "pumpkin", "the editor names it");
  assert.equal(currentPreset({ ...settings, radius: 3 }, SEASON_PRESETS), null, "until something changes");
  assert.equal(currentPreset(sanitize(PRESETS.frost), SEASON_PRESETS), "frost", "the usual looks are still found");
  assert.equal(fromParams(new URLSearchParams("look=nonsense"), SEASON_PRESETS).accent, undefined);
  assert.equal(fromParams(new URLSearchParams("look=constructor"), SEASON_PRESETS).accent, undefined, "a name from the object's own prototype is not a look");
  assert.equal(fromParams(new URLSearchParams("look=pumpkin")).accent, undefined, "the overlay page does not carry the seasonal looks (to stay light): its links carry every value instead");

  // an overlay made with one carries every value in its link, so it looks the same at any time of year
  const link = new URL(overlayUrl("https://x.test/overlay/", { channel: "pond.pal", settings }));
  for (const key of ["accent", "bg", "text", "font", "deco"]) assert.ok(link.searchParams.has(key), `${key} is in the link`);
  assert.equal(link.searchParams.has("look"), false, "the link does not depend on the look's name");
  assert.deepEqual(sanitize(fromParams(link.searchParams)), settings, "and reads back to the same overlay, with no help from the seasonal looks");

  assert.equal(alerts.fromParams(new URLSearchParams("look=ghost")).bg, alerts.SEASONAL_LOOKS.halloween.ghost.bg);
  assert.equal(alerts.currentLook(alerts.sanitize(alerts.SEASONAL_LOOKS.christmas.cozy)), "cozy");
  const widget = defineWidget({ controls: [], defaults: {} });
  assert.equal(widget.fromParams(new URLSearchParams("look=candycane")).accent, alerts.SEASONAL_LOOKS.christmas.candycane.accent);
  assert.equal(widget.fromParams(new URLSearchParams("look=nonsense")).accent, undefined);
});

test("the usual looks and the defaults are exactly what they were", () => {
  assert.deepEqual(Object.keys(PRESETS), ["blueberry", "frost", "mint", "bubblegum", "butter", "arcade", "whisper"]);
  assert.equal(DEFAULTS.deco, "none");
  assert.deepEqual(Object.keys(alerts.LOOKS), ["sticker", "matcha", "night", "bubblegum", "arcade"]);
});
