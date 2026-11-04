// The goal's designs and its celebration sound, as settings: what they are called, that a link can carry them, that nonsense is ignored, and that each
// design has its drawing in the stylesheet. (The drawing itself is looked at in goal-styles.browser.test.mjs.)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GOAL, GOAL_STYLES } from "../src/js/goal.js";
import { SOUNDS } from "../src/js/alerts-settings.js";

const css = readFileSync(join(import.meta.dirname, "..", "src", "css", "widgets.css"), "utf8");

test("the goal has seven designs, the first is the classic bar, and the celebration sound is quiet unless it is chosen", () => {
  assert.deepEqual(GOAL_STYLES.map((s) => s.id), ["bar", "candy", "blocks", "hearts", "stars", "neon", "ring"]);
  assert.equal(GOAL.defaults.barStyle, "bar");
  assert.equal(GOAL.defaults.celebrateSound, "none", "a goal that was silent stays silent until a sound is picked");
  const design = GOAL.controls.find((c) => c.key === "barStyle");
  assert.deepEqual(design.options.map((o) => o.id), GOAL_STYLES.map((s) => s.id));
  const sound = GOAL.controls.find((c) => c.key === "celebrateSound");
  assert.deepEqual(sound.options.map((o) => o.id), SOUNDS.map((s) => s.id), "the same sounds as everywhere else, and No sound among them");
  assert.equal(sound.options[0].id, "none");
});

test("a link carries the design and the sound only when they are not the defaults, and a design or sound that does not exist is ignored", () => {
  const settings = GOAL.sanitize({ barStyle: "hearts", celebrateSound: "chime" });
  assert.deepEqual([settings.barStyle, settings.celebrateSound], ["hearts", "chime"]);
  const params = GOAL.toParams(settings);
  assert.deepEqual([params.get("barStyle"), params.get("celebrateSound")], ["hearts", "chime"]);
  assert.equal(GOAL.toParams(GOAL.sanitize({})).has("barStyle"), false);
  assert.equal(GOAL.toParams(GOAL.sanitize({})).has("celebrateSound"), false);
  const back = GOAL.sanitize(GOAL.fromParams(new URLSearchParams("barStyle=ring&celebrateSound=fanfare")));
  assert.deepEqual([back.barStyle, back.celebrateSound], ["ring", "fanfare"]);
  const junk = GOAL.sanitize(GOAL.fromParams(new URLSearchParams("barStyle=%3Cb%3E&celebrateSound=__proto__")));
  assert.deepEqual([junk.barStyle, junk.celebrateSound], ["bar", "none"]);
});

test("every design but the classic one has its drawing in the stylesheet", () => {
  for (const { id } of GOAL_STYLES) {
    if (id === "bar") continue;
    assert.ok(css.includes(`.goal[data-style="${id}"]`), `${id} has no drawing in widgets.css`);
  }
});
