import test from "node:test";
import assert from "node:assert/strict";
import { CONTROLS, DEFAULTS, FONTS, LOOK_KEYS, PRESETS, coerce, currentPreset, fromParams, lookVars, overlayUrl, sanitize, toParams } from "../src/js/settings.js";
import { HEX, inkFor, luminance, mix, rgba } from "../src/js/color.js";

const control = (key) => CONTROLS.find((c) => c.key === key);

test("every starting look sets exactly the look settings, and every value is acceptable", () => {
  for (const [name, look] of Object.entries(PRESETS)) {
    assert.deepEqual(Object.keys(look).sort(), [...LOOK_KEYS].sort(), name);
    for (const key of LOOK_KEYS) assert.equal(coerce(control(key), look[key]), look[key], `${name}.${key}`);
    assert.ok(look.font in FONTS, `${name} uses a font we ship`);
  }
});

test("the defaults are a complete, valid set of settings", () => {
  assert.deepEqual(Object.keys(DEFAULTS).sort(), CONTROLS.map((c) => c.key).sort());
  assert.deepEqual(sanitize(DEFAULTS), DEFAULTS);
});

test("sanitize drops what it doesn't understand and clamps numbers", () => {
  const s = sanitize({ accent: "red", bg: "#ABCDEF", radius: 9999, size: -3, font: "Comic Sans", avatar: "yes", modIcon: "<img>", max: "7.4", life: "", evil: "<script>", shape: "filled" });
  assert.equal(s.accent, DEFAULTS.accent); // not a hex colour
  assert.equal(s.bg, "#abcdef"); // lower-cased
  assert.equal(s.radius, 32); // clamped to the top of its range
  assert.equal(s.size, 12); // clamped to the bottom
  assert.equal(s.font, DEFAULTS.font); // not a font we ship
  assert.equal(s.avatar, DEFAULTS.avatar); // a string is not a toggle
  assert.equal(s.modIcon, DEFAULTS.modIcon);
  assert.equal(s.max, 7); // rounded to a step
  assert.equal(s.life, DEFAULTS.life); // an empty value isn't zero
  assert.equal("evil" in s, false);
  assert.deepEqual(sanitize(null), DEFAULTS);
  assert.deepEqual(sanitize("nonsense"), DEFAULTS);
});

test("a link round-trips: toParams then fromParams then sanitize gives the same settings", () => {
  const tweaked = { ...PRESETS.bubblegum, ...{ modIcon: "frog", max: 9, life: 0, colors: true, emotes: false, space: 14 } };
  const settings = sanitize({ ...DEFAULTS, ...tweaked });
  const back = sanitize(fromParams(toParams(settings)));
  assert.deepEqual(back, settings);
});

test("a link only carries what differs from the defaults, in a fixed order", () => {
  assert.equal(toParams(DEFAULTS).toString(), "");
  const p = toParams(sanitize({ accent: "#ff0000", avatar: false, radius: 4 }));
  assert.deepEqual([...p.keys()], ["accent", "radius", "avatar"]);
  assert.equal(p.get("avatar"), "0");
});

test("look= in a link picks a starting look, and individual settings win over it", () => {
  const params = new URLSearchParams("look=butter&accent=%23ff0000");
  const s = sanitize(fromParams(params));
  assert.equal(s.font, "Baloo 2");
  assert.equal(s.accent, "#ff0000");
  assert.equal(sanitize(fromParams(new URLSearchParams("look=nonsense"))).font, DEFAULTS.font);
});

test("overlayUrl puts the channel first and keeps links short", () => {
  assert.equal(overlayUrl("https://frills.app/overlay/", { channel: "somename" }), "https://frills.app/overlay/?channel=somename");
  const url = overlayUrl("https://frills.app/overlay/", { channel: "somename", settings: sanitize({ accent: "#ff0000" }) });
  assert.equal(new URL(url).searchParams.get("channel"), "somename");
  assert.equal(new URL(url).searchParams.get("accent"), "#ff0000");
});

test("currentPreset names the look until something changes", () => {
  assert.equal(currentPreset(sanitize(PRESETS.frost)), "frost");
  assert.equal(currentPreset({ ...sanitize(PRESETS.frost), radius: 3 }), null);
  assert.equal(currentPreset(DEFAULTS), "blueberry");
});

test("lookVars gives plain colours an old OBS browser can draw", () => {
  for (const [name, preset] of Object.entries(PRESETS)) {
    const { vars, attrs, feed } = lookVars(sanitize(preset));
    for (const [key, value] of Object.entries(vars)) {
      assert.doesNotMatch(String(value), /color-mix|oklch|lab\(|lch\(/, `${name} ${key}`);
    }
    assert.ok(["filled", "outline", "none"].includes(attrs.shape));
    assert.ok(feed.max >= 2 && feed.life >= 0);
  }
});

test("lookVars reflects the shape: no box means no fill, edge or shadow", () => {
  const text = lookVars(sanitize({ ...PRESETS.whisper })).vars;
  assert.equal(text["--g-bg"], "transparent");
  assert.equal(text["--g-bw"], "0px");
  assert.equal(text["--g-shadow"], "none");
  const outline = lookVars(sanitize({ ...PRESETS.mint, borderW: 0 })).vars;
  assert.equal(outline["--g-bw"], "2px"); // an outline always shows
  const frost = lookVars(sanitize(PRESETS.frost)).vars;
  assert.match(frost["--g-bf"], /^blur\(10px\)/);
  assert.equal(lookVars(sanitize(PRESETS.blueberry)).vars["--g-bf"], "none"); // no filter at all when off
});

test("colour helpers", () => {
  assert.ok(HEX.test("#a1B2c3") && !HEX.test("#abc") && !HEX.test("red"));
  assert.equal(inkFor("#ffe066"), "#10141a"); // dark text on light yellow
  assert.equal(inkFor("#10131a"), "#ffffff"); // white text on near-black
  assert.ok(luminance("#ffffff") > 0.99 && luminance("#000000") === 0);
  assert.equal(rgba("#ff8000", 0.5), "rgba(255,128,0,0.5)");
  assert.equal(mix("#ffffff", "#000000", 0.5), "#808080");
  assert.equal(mix("#ff0000", "#0000ff", 1), "#ff0000");
});
