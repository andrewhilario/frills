// Last Gifts and the Follower Goal, with no page and a pretend clock: the settings and the links, which gifts are kept and for how long,
// and how the goal counts, celebrates and raises itself.

import test from "node:test";
import assert from "node:assert/strict";
import { GIFTS, GiftList } from "../src/js/gifts.js";
import { GOAL, GoalState, goalKey, loadGoal, saveGoal, GOAL_TYPES, goalAmount } from "../src/js/goal.js";
import { LOOKS, coerce } from "../src/js/widget-settings.js";
import { fakeAlert, fakeAlertSource } from "../src/js/fake-alerts.js";

function clock() {
  let now = 0;
  let next = 1;
  const jobs = new Map();
  return {
    setTimeout: (fn, ms) => { const id = next++; jobs.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: (id) => jobs.delete(id),
    tick(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...jobs].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        jobs.delete(due[0]);
        due[1].fn();
      }
      now = end;
    },
  };
}

// ── settings ────────────────────────────────────────────────────────────────────────────────────────────────────────

test("each overlay's options have good defaults, and nothing unknown or bad gets through", () => {
  for (const api of [GIFTS, GOAL]) {
    for (const c of api.controls) assert.notEqual(coerce(c, api.defaults[c.key]), undefined, `${c.key}'s default is acceptable to its own control`);
    assert.deepEqual(api.sanitize(undefined), api.defaults);
    assert.deepEqual(api.sanitize({ nonsense: 1, accent: "red", size: "x" }), api.defaults);
  }
  const g = GIFTS.sanitize({ max: 99, order: "sideways", life: "45", template: "A\u0000{name}" + "x".repeat(200), minDiamonds: -5, enter: "pop" });
  assert.deepEqual([g.max, g.order, g.life, g.minDiamonds, g.enter], [20, "bottom", 45, 0, "pop"]);
  assert.equal(g.template.length, 80);
  const goal = GOAL.sanitize({ target: 0, start: "1200.7", step: 5000000, keep: "yes" });
  assert.deepEqual([goal.target, goal.start, goal.step, goal.keep], [1, 1201, 1000000, false]);
});

test("a link carries only what was changed, reads back the same, and a look sets the base", () => {
  const changed = GOAL.sanitize({ label: "Road to 1K", start: 812, target: 1000, step: 0, showPercent: true, accent: "#112233" });
  const url = new URL(GOAL.url("https://x.test/overlay/goal/", { channel: "pond.pal", settings: changed }));
  assert.equal(url.pathname, "/overlay/goal/");
  assert.equal(url.searchParams.get("channel"), "pond.pal");
  assert.equal(url.searchParams.get("platform"), "tiktok");
  assert.equal(url.searchParams.get("showPercent"), "1");
  assert.ok(!url.searchParams.has("celebrate"), "an unchanged option is not in the link");
  assert.deepEqual(GOAL.sanitize(GOAL.fromParams(url.searchParams)), changed);
  assert.deepEqual(GIFTS.sanitize(GIFTS.fromParams(new URLSearchParams("look=arcade&max=3"))).accent, LOOKS.arcade.accent);
  assert.equal(GIFTS.url("https://x.test/overlay/gifts/"), "https://x.test/overlay/gifts/?");
});

// ── last gifts ──────────────────────────────────────────────────────────────────────────────────────────────────────

const gift = (name, diamonds = 1, count = 1) => ({ kind: "gift", id: name, name, gift: "Rose", diamonds, count, total: diamonds * count, picture: "", avatar: "" });
function giftRig(over = {}) {
  const timers = clock();
  const log = [];
  const settings = { ...GIFTS.defaults, ...over };
  const list = new GiftList(settings, { timers, onChange: (items) => log.push(items.map((i) => i.name).join(",")), onGone: (i) => log.push("-" + i.name) });
  return { list, timers, log, settings };
}

test("the last N gifts are kept, oldest leaving first", () => {
  const { list, log } = giftRig({ max: 3 });
  for (const n of ["A", "B", "C", "D", "E"]) list.add(gift(n));
  assert.deepEqual(list.items.map((i) => i.name), ["C", "D", "E"]);
  assert.ok(log.includes("-A") && log.includes("-B"), "the view is told which ones left");
  assert.equal(list.add({ kind: "follow", name: "X" }), null, "only gifts");
  assert.equal(list.add(null), null);
});

test("a gift smaller than the smallest wanted is not listed", () => {
  const { list } = giftRig({ minDiamonds: 10 });
  assert.equal(list.add(gift("Small", 5)), null);
  assert.ok(list.add(gift("Big", 10)));
  assert.deepEqual(list.items.map((i) => i.name), ["Big"]);
});

test("with a time limit each gift leaves by itself; with none it stays until pushed out", () => {
  const { list, timers } = giftRig({ life: 30 });
  list.add(gift("A"));
  timers.tick(20000);
  list.add(gift("B"));
  timers.tick(11000);
  assert.deepEqual(list.items.map((i) => i.name), ["B"], "A's 30 seconds were up");
  timers.tick(20000);
  assert.deepEqual(list.items, []);
  const stays = giftRig({ life: 0 });
  stays.list.add(gift("A"));
  stays.timers.tick(10 * 3600 * 1000);
  assert.equal(stays.list.items.length, 1);
});

test("making the list shorter drops the oldest at once, and clear empties it", () => {
  const { list } = giftRig({ max: 5 });
  for (const n of ["A", "B", "C", "D"]) list.add(gift(n));
  list.setSettings({ ...list.settings, max: 2 });
  assert.deepEqual(list.items.map((i) => i.name), ["C", "D"]);
  list.clear();
  assert.deepEqual(list.items, []);
  assert.equal(fakeAlert("gift", { size: 3 }).diamonds >= 1000, true, "the practice gifts have sizes");
});

test("the practice alerts can be kept to the kinds asked for", async () => {
  const seen = [];
  const source = fakeAlertSource((alert) => seen.push(alert.kind), () => [1, 2], ["follow", "gift"]);
  for (let waited = 0; seen.length < 6 && waited < 5000; waited += 25) await new Promise((resolve) => setTimeout(resolve, 25));
  source.stop();
  assert.equal(seen.length > 5, true);
  assert.equal(seen.every((kind) => kind === "follow" || kind === "gift"), true);
});

// ── the follower goal ───────────────────────────────────────────────────────────────────────────────────────────────

function goalRig(over = {}, extra = {}) {
  const events = [];
  const settings = { ...GOAL.defaults, start: 90, target: 100, step: 25, ...over };
  const state = new GoalState(settings, { ...extra, onChange: (s) => events.push(`${s.value}/${s.goal}`), onReach: () => events.push("reached") });
  return { state, events, settings };
}

test("followers count on top of the number typed, and the percent follows", () => {
  const { state, events } = goalRig();
  assert.deepEqual([state.value, state.goal, state.percent], [90, 100, 90]);
  state.follow();
  state.follow(4);
  assert.deepEqual([state.value, state.percent], [95, 95]);
  assert.deepEqual(events, ["91/100", "95/100"]);
});

test("reaching the goal celebrates once, and raising sets the next goal by the step", () => {
  const { state, events } = goalRig();
  state.follow(10);
  state.follow(2);
  assert.deepEqual(events.filter((e) => e === "reached"), ["reached"], "celebrated once, not again for the next follower");
  assert.equal(state.percent, 100, "the bar never goes past full");
  assert.equal(state.raise(), true);
  assert.equal(state.goal, 125);
  state.follow(30);
  assert.equal(events.filter((e) => e === "reached").length, 2, "the next goal celebrates too");
  state.raise();
  assert.equal(state.goal, 150, "raised past where the count is, not just one step");
  const stops = goalRig({ step: 0 });
  stops.state.follow(50);
  assert.equal(stops.state.raise(), false, "a step of 0 stops at the goal");
  assert.equal(stops.state.goal, 100);
});

test("a count restored past its goal does not celebrate again, and editing the goal moves it", () => {
  const { state, events } = goalRig({}, { gained: 30, target: 100 });
  assert.equal(state.reached, true);
  state.follow();
  assert.ok(!events.includes("reached"));
  state.setSettings({ ...state.settings, target: 500 });
  assert.equal(state.goal, 500, "the person changed the goal");
  assert.equal(state.reached, false);
  state.setSettings({ ...state.settings, start: 0 });
  assert.deepEqual([state.value, state.goal], [31, 500], "changing the start keeps the people counted");
  state.reset();
  assert.deepEqual([state.gained, state.value], [0, 0]);
});

test("goal types: a goal counts what its type says, and nothing else", () => {
  assert.deepEqual(Object.keys(GOAL_TYPES), ["follow", "gift", "like"]);
  assert.equal(goalAmount("follow", { kind: "follow" }), 1);
  assert.equal(goalAmount("follow", { kind: "gift", total: 500 }), 0, "a gift is not a follower");
  assert.equal(goalAmount("gift", { kind: "gift", total: 500, diamonds: 100, count: 5 }), 500, "a gift adds its diamonds");
  assert.equal(goalAmount("gift", { kind: "gift", total: 0 }), 0);
  assert.equal(goalAmount("like", { kind: "like", count: 15 }), 15, "likes add their taps");
  assert.equal(goalAmount("like", { kind: "like", count: -3 }), 0);
  assert.equal(goalAmount("nope", { kind: "like", count: 3 }), 0);
});

test("the real follower count: the bar starts from it, a goal already passed moves up quietly, and a type change starts again", () => {
  const { state, events, settings } = goalRig({ start: 0, target: 100, step: 25 });
  state.add(3);
  state.setLive(81371);
  assert.deepEqual([state.value, state.gained], [81371, 0], "the real count replaces what was typed and what was counted");
  assert.equal(state.goal, 81375, "100 is long passed, so the goal moves up by the step");
  assert.ok(!events.includes("reached"), "nobody just reached it, so no celebration");
  state.add(4);
  assert.deepEqual(events.filter((e) => e === "reached"), ["reached"], "the next follower that gets there celebrates");
  const stop = goalRig({ start: 0, target: 100, step: 0 });
  stop.state.setLive(500);
  assert.deepEqual([stop.state.goal, stop.state.reached], [100, true], "with no step the goal stays and the bar is full");
  state.setSettings({ ...settings, type: "gift", target: 1000 });
  assert.deepEqual([state.value, state.goal], [0, 1000], "a different type counts from the start again");
});

test("a goal's remembered count is kept apart for each type", () => {
  assert.equal(goalKey("pond", "follow"), "frills:goal:pond", "followers keep the key links already use");
  assert.notEqual(goalKey("pond", "gift"), goalKey("pond", "like"));
  assert.notEqual(goalKey("pond", "gift"), goalKey("pond", "follow"));
});

test("a count is kept per account in the browser's storage, and bad or missing storage is harmless", () => {
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  const { state } = goalRig({ keep: true });
  state.follow(7);
  saveGoal(storage, "pond.pal", state);
  assert.equal(goalKey("pond.pal"), "frills:goal:pond.pal");
  assert.deepEqual(loadGoal(storage, "pond.pal"), { gained: 7, goal: 100 });
  assert.equal(loadGoal(storage, "someone_else"), null);
  data.set(goalKey("junk"), "{not json");
  assert.equal(loadGoal(storage, "junk"), null);
  data.set(goalKey("odd"), JSON.stringify({ gained: "lots", goal: null }));
  assert.equal(loadGoal(storage, "odd"), null);
  assert.equal(loadGoal({ getItem() { throw new Error("blocked"); } }, "x"), null);
  assert.doesNotThrow(() => saveGoal({ setItem() { throw new Error("blocked"); } }, "x", state));
});

// ── top likers ──────────────────────────────────────────────────────────────────────────────────────────────────────────

import { LIKERS, LikeBoard, likersKey, loadLikers, saveLikers } from "../src/js/likers.js";
import { fakeLike } from "../src/js/fake-alerts.js";

const like = (user, count, extra = {}) => ({ kind: "like", id: "", user, name: user.toUpperCase(), avatar: "", count, total: 0, ...extra });
const names = (board) => board.top.map((p) => `${p.rank}:${p.name}:${p.count}`);

test("people are ranked by total likes, ties go to whoever got there first, and only the top N are shown", () => {
  const board = new LikeBoard({ ...LIKERS.defaults, max: 3 });
  board.add(like("ann", 5)); board.add(like("ben", 8)); board.add(like("cat", 8)); board.add(like("dan", 1)); board.add(like("eve", 20));
  assert.deepEqual(names(board), ["1:EVE:20", "2:BEN:8", "3:CAT:8"], "Ben reached 8 before Cat");
  board.add(like("ann", 4));
  board.add(like("ann", 1));
  assert.deepEqual(names(board), ["1:EVE:20", "2:ANN:10", "3:BEN:8"], "Ann climbed over both");
  board.add(like("dan", 50));
  assert.equal(board.top[0].name, "DAN", "someone who was not listed can take the top");
});

test("a minimum, bad lines and a smaller list are handled", () => {
  const board = new LikeBoard({ ...LIKERS.defaults, minLikes: 5 });
  assert.equal(board.add(like("ann", 3)), true);
  assert.deepEqual(board.top, [], "3 likes is under the 5 needed");
  board.add(like("ann", 3));
  assert.deepEqual(names(board), ["1:ANN:6"]);
  assert.equal(board.add({ kind: "gift", user: "x", count: 5 }), false);
  assert.equal(board.add(like("ben", 0)), false);
  assert.equal(board.add({ kind: "like", count: 4 }), false, "no person");
  assert.equal(board.add(null), false);
  board.setSettings({ ...board.settings, minLikes: 1, max: 1 });
  assert.equal(board.top.length, 1);
  board.clear();
  assert.deepEqual(board.top, []);
});

test("the board tells the view after every change, and a person's name and picture are kept up to date", () => {
  const seen = [];
  const board = new LikeBoard(LIKERS.defaults, { onChange: (top) => seen.push(top.map((p) => p.name).join(",")) });
  board.add(like("ann", 2, { name: "Ann", avatar: "" }));
  board.add(like("ann", 2, { name: "Ann Lee", avatar: "https://p16.tiktokcdn.com/a.jpeg" }));
  assert.deepEqual(seen, ["Ann", "Ann Lee"]);
  assert.equal(board.top[0].avatar, "https://p16.tiktokcdn.com/a.jpeg");
});

test("a huge crowd never grows the board without limit", () => {
  const board = new LikeBoard(LIKERS.defaults);
  for (let i = 0; i < 5200; i++) board.add(like("u" + i, 1 + (i % 50)));
  assert.ok(board.people.size <= 5000, "kept in check: " + board.people.size);
  assert.equal(board.top.length, 10);
  assert.ok(board.top[0].count >= 50, "the best people were kept");
});

test("with remember on, the best people are kept in the browser's storage and read back, and bad data is ignored", () => {
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  const board = new LikeBoard(LIKERS.defaults);
  board.add(like("ann", 12, { name: "Ann" })); board.add(like("ben", 7, { name: "Ben" }));
  saveLikers(storage, "pond.pal", board);
  assert.equal(likersKey("pond.pal"), "frills:likers:pond.pal");
  const back = new LikeBoard(LIKERS.defaults, { entries: loadLikers(storage, "pond.pal") });
  assert.deepEqual(names(back), ["1:Ann:12", "2:Ben:7"]);
  data.set(likersKey("junk"), "{no");
  assert.deepEqual(loadLikers(storage, "junk"), []);
  data.set(likersKey("odd"), JSON.stringify([{ user: 5, name: "x", count: 1 }, { user: "a", name: "A", count: -3 }, { user: "b", name: "B", count: 4 }]));
  assert.deepEqual(loadLikers(storage, "odd").map((e) => e.user), ["b"], "only well-formed entries");
  assert.deepEqual(loadLikers({ getItem() { throw new Error("blocked"); } }, "x"), []);
  assert.equal(fakeLike({ name: "Z", count: 3 }).count, 3);
});

test("letter spacing is a look option every overlay shares: alerts, gifts, goals, likers and song requests", async () => {
  const { alertVars, DEFAULTS: ALERT_DEFAULTS, sanitize: sanitizeAlerts } = await import("../src/js/alerts-settings.js");
  assert.equal(ALERT_DEFAULTS.letterSpacing, 0);
  assert.equal(alertVars(ALERT_DEFAULTS)["--a-letter"], "0px");
  assert.equal(alertVars(sanitizeAlerts({ letterSpacing: 3 }))["--a-letter"], "3px");
  assert.equal(sanitizeAlerts({ letterSpacing: 40 }).letterSpacing, 10);
  assert.equal(sanitizeAlerts({ letterSpacing: -9 }).letterSpacing, -2);
  const { SONGS } = await import("../src/js/songs.js");
  for (const widget of [GIFTS, GOAL, SONGS]) {
    assert.equal(widget.defaults.letterSpacing, 0);
    assert.equal(widget.sanitize({ letterSpacing: 2.5 }).letterSpacing, 2.5);
    assert.equal(widget.sanitize({ letterSpacing: 99 }).letterSpacing, 10);
    assert.ok(widget.controls.some((c) => c.key === "letterSpacing" && c.section === "look"), "it is in the editor's look section");
    const link = widget.url("https://x.example/o/", { settings: widget.sanitize({ letterSpacing: 4 }) });
    assert.equal(new URL(link).searchParams.get("letterSpacing"), "4");
    assert.equal(widget.sanitize(widget.fromParams(new URL(link).searchParams)).letterSpacing, 4);
  }
});
