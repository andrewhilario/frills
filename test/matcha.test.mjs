import test from "node:test";
import assert from "node:assert/strict";
import { COLOR_KEYS, MATCHA_CONTROLS, MATCHA_DEFAULTS, MATCHA_PALETTES, MATCHA_STYLES, currentPalette, isMatchaStyle, matchaFromParams, matchaOverlayUrl, matchaVars, paletteColors, sanitizeMatcha } from "../src/js/matcha.js";

test("the six styles and five palettes are all there", () => {
  assert.deepEqual(MATCHA_STYLES.map((s) => s.id), ["latte", "glass", "sticker", "pixel", "minimal", "night"]);
  assert.deepEqual(Object.keys(MATCHA_PALETTES), ["latte", "ceremonial", "forest", "sakura", "night"]);
  assert.ok(isMatchaStyle("pixel") && !isMatchaStyle("blueberry") && !isMatchaStyle(null));
});

test("matcha settings start with the leaf and are checked like every other look", () => {
  assert.deepEqual(sanitizeMatcha(null), MATCHA_DEFAULTS);
  assert.equal(MATCHA_DEFAULTS.modIcon, "leaf");
  const s = sanitizeMatcha({ style: "night", palette: "forest", modIcon: "frog", max: 99, life: -5, colors: "yes", emotes: false, evil: "x" });
  assert.equal(s.style, "night");
  assert.equal(s.palette, "forest");
  assert.equal(s.modIcon, "frog");
  assert.equal(s.max, 12); // clamped
  assert.equal(s.life, 0); // clamped
  assert.equal(s.colors, false); // a string is not a toggle
  assert.equal(s.emotes, false);
  assert.equal("evil" in s, false);
  assert.equal(sanitizeMatcha({ style: "nope", palette: "nope", modIcon: "<b>" }).style, "latte");
  assert.equal(sanitizeMatcha({ modIcon: "<b>" }).modIcon, "leaf");
});

test("a matcha link round-trips and stays short", () => {
  const settings = sanitizeMatcha({ style: "glass", palette: "sakura", modIcon: "star", max: 4 });
  const url = matchaOverlayUrl("https://frills.app/overlay/", { channel: "somename", settings });
  const back = sanitizeMatcha(matchaFromParams(new URL(url).searchParams));
  assert.deepEqual(back, settings);
  assert.equal(new URL(url).searchParams.get("style"), "glass");
  assert.equal(matchaOverlayUrl("https://x/o/", { settings: MATCHA_DEFAULTS }), "https://x/o/?style=latte");
});

test("palette variables are plain colours with no color-mix needed", () => {
  for (const id of Object.keys(MATCHA_PALETTES)) {
    const vars = matchaVars(id);
    for (const key of ["--bg", "--ink", "--soft", "--matcha", "--deep", "--pop", "--matcha-lift", "--matcha-a70", "--matcha-a55", "--night-body", "--night-av"]) {
      assert.ok(key in vars, `${id} ${key}`);
      assert.doesNotMatch(vars[key], /color-mix|oklch/);
    }
  }
  assert.equal(matchaVars("nope")["--bg"], MATCHA_PALETTES.latte.bg);
});

test("a palette gives the six colours, and any colour that comes with it wins", () => {
  assert.deepEqual(paletteColors("forest"), { bg: "#eef2de", ink: "#1e3524", soft: "#cfddb0", matcha: "#6e9650", deep: "#2f5233", pop: "#f2a65a" });
  assert.deepEqual(paletteColors("nope"), paletteColors("latte"));
  const plain = sanitizeMatcha({ palette: "forest" });
  for (const key of COLOR_KEYS) assert.equal(plain[key], MATCHA_PALETTES.forest[key]);
  const own = sanitizeMatcha({ palette: "forest", matcha: "#FF00AA", pop: "red", deep: "#12" });
  assert.equal(own.matcha, "#ff00aa", "a good colour is kept, in lower case");
  assert.equal(own.pop, MATCHA_PALETTES.forest.pop, "a bad colour falls back to the palette's");
  assert.equal(own.deep, MATCHA_PALETTES.forest.deep);
  assert.equal(own.palette, "forest");
});

test("a name that is not a palette, even one every object has, is ignored", () => {
  for (const bad of ["constructor", "__proto__", "toString", "hasOwnProperty", 7, null, {}]) {
    const s = sanitizeMatcha({ palette: bad });
    assert.equal(s.palette, "latte", String(bad));
    assert.equal(s.matcha, MATCHA_PALETTES.latte.matcha);
  }
  assert.deepEqual(paletteColors("__proto__"), paletteColors("latte"));
});

test("currentPalette names the palette until a colour is changed", () => {
  assert.equal(currentPalette(sanitizeMatcha({ palette: "sakura" })), "sakura");
  assert.equal(currentPalette(sanitizeMatcha({ palette: "sakura", matcha: "#123456" })), null);
  assert.equal(currentPalette({ ...MATCHA_DEFAULTS, ...paletteColors("night"), palette: "latte" }), "night", "colours that match another palette are named for it");
});

test("everything under More options is checked, clamped and falls back to how the style was designed", () => {
  const s = sanitizeMatcha({ scale: 999, round: -4, opacity: 40, font: "Comic Sans", anim: "explode", speed: 5, space: 99, avatar: "no", pictures: false, evil: 1 });
  assert.equal(s.scale, 180);
  assert.equal(s.round, 0);
  assert.equal(s.opacity, 40);
  assert.equal(s.font, "", "an unknown font means the style's own");
  assert.equal(s.anim, "", "an unknown entrance means the style's own");
  assert.equal(s.speed, 150);
  assert.equal(s.space, 24);
  assert.equal(s.avatar, true, "a word is not a switch");
  assert.equal(s.pictures, false);
  assert.equal("evil" in s, false);
  const good = sanitizeMatcha({ font: "Fredoka", anim: "hop" });
  assert.equal(good.font, "Fredoka");
  assert.equal(good.anim, "hop");
  assert.deepEqual(MATCHA_CONTROLS.map((c) => c.key).slice(0, 6), ["matcha", "deep", "bg", "soft", "ink", "pop"]);
  for (const control of MATCHA_CONTROLS) assert.ok(control.key in MATCHA_DEFAULTS, control.key + " has a default");
});

test("a link carries only what was changed, and a changed colour is measured against the palette picked", () => {
  const base = "https://x.test/overlay/";
  assert.equal(matchaOverlayUrl(base, { settings: sanitizeMatcha({ palette: "forest" }) }), base + "?style=latte&palette=forest", "a plain palette adds nothing else");
  const mine = sanitizeMatcha({ style: "pixel", palette: "forest", matcha: "#ff00aa", scale: 125, font: "Fredoka", anim: "pop", speed: 380, pictures: false });
  const url = new URL(matchaOverlayUrl(base, { channel: "pond.pal", platform: "tiktok", settings: mine }));
  assert.equal(url.searchParams.get("matcha"), "#ff00aa");
  assert.equal(url.searchParams.has("deep"), false, "a colour that still matches the palette is left out");
  assert.equal(url.searchParams.get("scale"), "125");
  assert.equal(url.searchParams.get("font"), "Fredoka");
  assert.equal(url.searchParams.get("anim"), "pop");
  assert.equal(url.searchParams.get("pictures"), "0");
  assert.equal(url.searchParams.has("round"), false);
  assert.deepEqual(sanitizeMatcha(matchaFromParams(url.searchParams)), mine, "reading the link gives the same settings back");
  // Changing colours on the default palette needs no palette part.
  const latte = new URL(matchaOverlayUrl(base, { settings: sanitizeMatcha({ pop: "#101010" }) }));
  assert.equal(latte.searchParams.has("palette"), false);
  assert.equal(latte.searchParams.get("pop"), "#101010");
  // A link can't smuggle in a word where a colour belongs.
  assert.equal(sanitizeMatcha(matchaFromParams(new URLSearchParams("style=night&matcha=javascript:alert(1)&bg=%23fff"))).matcha, MATCHA_PALETTES.latte.matcha);
});

test("the variables follow the settings: sizes, corners, box opacity and the colours that were changed", () => {
  const vars = matchaVars(sanitizeMatcha({ palette: "latte", matcha: "#ff00aa", scale: 150, round: 50, opacity: 50, space: 12 }));
  assert.equal(vars["--matcha"], "#ff00aa");
  assert.equal(vars["--matcha-lift"].startsWith("#"), true, "the blends are worked out from the changed colour");
  assert.equal(vars["--m-scale"], "1.5");
  assert.equal(vars["--m-round"], "0.5");
  assert.equal(vars["--g-space"], "12px");
  assert.equal(vars["--bg-fill"], "rgba(245,240,225,0.5)");
  assert.equal(vars["--glass-fill"], "rgba(255,255,255,0.07)");
  for (const value of Object.values(vars)) assert.doesNotMatch(value, /color-mix|oklch|var\(/, "plain values only");
  const plain = matchaVars("latte");
  assert.equal(plain["--m-scale"], "1");
  assert.equal(plain["--bg-fill"], "rgba(245,240,225,1)", "full opacity is the design");
});
