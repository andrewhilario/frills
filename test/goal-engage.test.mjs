// What makes a goal worth watching, as settings and counting: the reward line, "N to go", the thank-you bubbles and the cheer at a quarter, half and three quarters.
// (How it looks is in goal-engage.browser.test.mjs.)

import test from "node:test";
import assert from "node:assert/strict";
import { GOAL, GoalState, MOMENTS, crossed, isAuto, niceGoal, usesLiveCount } from "../src/js/goal.js";

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
  const settings = GOAL.sanitize({ target: 100, start: 0, step: 0, fromLive: false, autoGoal: false });
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

// ── a follower goal that sets itself ───────────────────────────────────────────────────────────────────

test("the next round number above a count: the step grows with the size, and a goal that is almost reached already is pushed one step further", () => {
  const table = [[0, 10], [9, 10], [10, 20], [95, 100], [99, 100], [100, 150], [499, 550], [500, 600], [999, 1100], [1000, 1500], [1243, 1500], [4950, 5000], [4980, 5500], [4999, 5500], [5000, 6000], [9800, 10000], [10000, 15000], [49999, 55000], [123456, 150000], [600000, 700000]];
  for (const [count, goal] of table) assert.equal(niceGoal(count), goal, String(count));
  for (const odd of [-5, NaN, undefined, "abc", 12.9]) assert.ok(niceGoal(odd) >= 10, String(odd));
  for (let n = 0; n < 200000; n += 37) {
    const g = niceGoal(n);
    assert.ok(g > n, "always ahead of the count: " + n);
    assert.ok(g - n <= Math.max(10, n) * 1.3, "and never a long way off: " + n + " -> " + g);
  }
});

test("a follower goal sets itself by default; only a follower goal does; a gift or like goal keeps the numbers typed", () => {
  const d = GOAL.sanitize({});
  assert.equal(d.autoGoal, true);
  assert.equal(isAuto(d), true);
  assert.equal(isAuto(GOAL.sanitize({ type: "gift" })), false);
  assert.equal(isAuto(GOAL.sanitize({ type: "like" })), false);
  assert.equal(isAuto(GOAL.sanitize({ autoGoal: false })), false);
  assert.deepEqual([usesLiveCount(d), usesLiveCount(GOAL.sanitize({ autoGoal: false, fromLive: true })), usesLiveCount(GOAL.sanitize({ autoGoal: false, fromLive: false })), usesLiveCount(GOAL.sanitize({ type: "gift" }))], [true, true, false, false]);
});

test("the real follower count picks the goal once; the bar then follows the count, and reaching the goal moves it to the next round number with no step to type", () => {
  const reached = [];
  const state = new GoalState(GOAL.sanitize({}), { onReach: (s) => reached.push(s.goal) });
  assert.deepEqual([state.value, state.goal], [0, 10], "before the count arrives: counting from nothing, toward 10");
  state.setLive(1243);
  assert.deepEqual([state.value, state.goal, state.percent], [1243, 1500, 82]);
  state.setLive(1260); // the count keeps coming: the goal stays, the bar moves
  state.setLive(1275);
  assert.deepEqual([state.value, state.goal], [1275, 1500]);
  state.add(224);
  assert.equal(state.reached, false);
  state.add(1);
  assert.deepEqual([reached, state.reached], [[1500], true], "reaching it is a celebration, once");
  assert.equal(state.raise(), true);
  assert.deepEqual([state.value, state.goal, state.reached], [1500, 2000, false], "the next round number");
  assert.equal(state.raise(), true, "and asking again changes nothing while it is not reached");
  assert.equal(state.goal, 2000);
});

test("a count that is already past the goal moves it up quietly, a typed step is ignored, and a goal typed in the settings is not used", () => {
  const celebrated = [];
  const state = new GoalState(GOAL.sanitize({ target: 7, step: 3, start: 999 }), { onReach: () => celebrated.push(1) });
  assert.equal(state.goal, 10, "target 7, step 3 and start 999 mean nothing to a goal that sets itself");
  state.setLive(4999);
  assert.deepEqual([state.goal, celebrated.length], [5500, 0], "nobody just reached it: no celebration");
  const again = new GoalState(GOAL.sanitize({}), {});
  again.setLive(800);
  again.setLive(1000); // the count crossed the goal on its own: quietly the next one
  assert.deepEqual([again.value, again.goal], [1000, 1500]);
});

test("turning it off gives back the typed goal, turning it on picks from the count again, and changing the type starts over", () => {
  const settings = GOAL.sanitize({ target: 150, step: 25, start: 40 });
  const state = new GoalState(settings, {});
  state.setLive(1243);
  assert.equal(state.goal, 1500);
  settings.autoGoal = false; // (the editor changes one object in place)
  state.setSettings(settings);
  assert.deepEqual([state.goal, state.value], [150 + 25 * Math.ceil((1243 - 150 + 1) / 25) - 0, 1243], "typed goal and step again, moved past the count quietly");
  settings.autoGoal = true;
  state.setSettings(settings);
  assert.equal(state.goal, 1500);
  settings.type = "gift";
  state.setSettings(settings);
  assert.deepEqual([state.goal, state.value, state.auto], [150, 40, false], "a gift goal: the typed numbers, from the start typed");
});

test("the reset button starts the automatic goal over from nothing", () => {
  const state = new GoalState(GOAL.sanitize({}), {});
  state.setLive(1243);
  state.reset();
  assert.deepEqual([state.value, state.goal], [0, 10]);
  state.setLive(300);
  assert.equal(state.goal, 350, "and the next real count picks again");
});

test("a link: a goal that sets itself carries none of the typed numbers; a link made before has them and keeps them; only an old link with none of them sets itself", () => {
  const auto = GOAL.url("https://x.test/overlay/goal/", { channel: "pond_cafe", settings: GOAL.sanitize({ target: 777, step: 5, start: 12, fromLive: false, reward: "Karaoke" }) });
  const q = new URL(auto).searchParams;
  assert.deepEqual([q.has("target"), q.has("step"), q.has("start"), q.has("fromLive"), q.has("autoGoal"), q.get("reward")], [false, false, false, false, false, "Karaoke"]);
  const typed = new URL(GOAL.url("https://x.test/overlay/goal/", { channel: "pond_cafe", settings: GOAL.sanitize({ autoGoal: false, target: 150, step: 40 }) })).searchParams;
  assert.deepEqual([typed.get("autoGoal"), typed.get("target"), typed.get("step")], ["0", "150", "40"]);
  const back = (query) => GOAL.sanitize(GOAL.fromParams(new URLSearchParams(query)));
  assert.equal(back("type=follow&target=150&step=25").autoGoal, false, "a link from before: it keeps the goal typed in it");
  assert.equal(back("type=follow&start=300").autoGoal, false);
  assert.equal(back("type=follow&fromLive=0").autoGoal, false);
  assert.equal(back("type=follow&target=150&autoGoal=1").autoGoal, true, "unless it says so");
  assert.equal(back("type=follow").autoGoal, true);
  assert.equal(back("type=follow&reward=Karaoke").autoGoal, true, "a link with only look settings sets itself");
  assert.equal(back("type=gift&target=500").autoGoal, false);
});
