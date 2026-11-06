// What makes a goal worth watching, as settings and counting: the reward line, "N to go", the thank-you bubbles and the cheer at a quarter, half and three quarters.
// (How it looks is in goal-engage.browser.test.mjs.)

import test from "node:test";
import assert from "node:assert/strict";
import { GOAL, GoalState, MOMENTS, crossed } from "../src/js/goal.js";

test("the new goal options start on (the reward is empty), and a link carries only what was changed", () => {
  const d = GOAL.sanitize({});
  assert.deepEqual([d.toGo, d.thanks, d.milestones, d.reward], [true, true, true, ""]);
  const params = GOAL.toParams(GOAL.sanitize({ reward: "Karaoke night!", thanks: false }));
  assert.deepEqual([params.get("reward"), params.get("thanks")], ["Karaoke night!", "0"]);
  assert.equal(params.has("toGo"), false);
  assert.equal(params.has("milestones"), false);
  const back = GOAL.sanitize(GOAL.fromParams(new URLSearchParams("reward=Karaoke+night!&toGo=0&milestones=0")));
  assert.deepEqual([back.reward, back.toGo, back.milestones, back.thanks], ["Karaoke night!", false, false, true]);
});

test("the reward is one clean line of at most 60 characters", () => {
  assert.equal(GOAL.sanitize({ reward: "a\u0000b\nc" }).reward, "a b c");
  assert.equal(GOAL.sanitize({ reward: "x".repeat(200) }).reward.length, 60);
});

test("which cheering moments a change passes: the ones between, never going back, never ones already behind", () => {
  assert.deepEqual(Object.keys(MOMENTS).map(Number), [25, 50, 75]);
  assert.deepEqual(crossed(20, 30), [25]);
  assert.deepEqual(crossed(24, 25), [25]);
  assert.deepEqual(crossed(0, 99), [25, 50, 75]);
  assert.deepEqual(crossed(50, 50), []);
  assert.deepEqual(crossed(26, 49), []);
  assert.deepEqual(crossed(80, 70), []);
  assert.deepEqual(crossed(74, 75), [75]);
});

test("each thing added tells who gave it, how much and which moments it passed, after the bar has moved; nothing else does", () => {
  const seen = [];
  const settings = GOAL.sanitize({ target: 100, start: 0, step: 0, fromLive: false });
  const state = new GoalState(settings, {
    onChange: (s) => seen.push(["change", s.value]),
    onGain: (g) => seen.push(["gain", g.name, g.amount, g.milestones]),
  });
  seen.length = 0;
  state.add(10, "Mochi Bun");
  assert.deepEqual(seen, [["change", 10], ["gain", "Mochi Bun", 10, []]], "the bar first, then the thank-you");
  seen.length = 0;
  state.add(20);
  assert.deepEqual(seen.at(-1), ["gain", "", 20, [25]], "no name is an empty name, and 10 to 30 passed a quarter");
  seen.length = 0;
  state.add(45, "Croaker");
  assert.deepEqual(seen.at(-1), ["gain", "Croaker", 45, [50, 75]], "30 to 75 passed halfway and reached three quarters");
  seen.length = 0;
  state.add(25, "Pond Pal");
  assert.deepEqual(seen.at(-1)[3], [], "from three quarters to the goal there is no moment left: the goal itself is the celebration");
  const jump = [];
  const late = new GoalState(settings, { onGain: (g) => jump.push(g.milestones) });
  late.add(60);
  late.add(40);
  assert.deepEqual(jump, [[25, 50], [75]], "a jump from 60% straight to the goal still cheers the three quarters it passed, but never the goal as a moment");
  seen.length = 0;
  state.setSettings({ ...settings, target: 200 });
  state.setLive(500);
  state.reset();
  assert.deepEqual(seen.filter((s) => s[0] === "gain"), [], "changing the settings, the real count or starting again is nobody's gift");
});
