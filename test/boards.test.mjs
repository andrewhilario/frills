// The rotating Top Gifters and Likers: the settings, the two rankings (gifts are ranked by diamonds, likes by taps), and which one is showing.
// No page and no clock: the page calls next() on a timer, so the tests call it themselves.

import test from "node:test";
import assert from "node:assert/strict";
import { BOARDS, BOARD_KINDS, Boards, boardsKey, boardsOn, loadBoards, saveBoards } from "../src/js/boards.js";

const gift = (user, total, extra = {}) => ({ kind: "gift", user, name: user.toUpperCase(), avatar: "", gift: "Rose", count: 1, diamonds: total, total, ...extra });
const like = (user, count) => ({ kind: "like", user, name: user.toUpperCase(), avatar: "", count });
const make = (raw = {}) => {
  const seen = [];
  const boards = new Boards(BOARDS.sanitize(raw), { onChange: (view) => seen.push(view) });
  return { boards, seen };
};
const names = (top) => top.map((p) => p.name);

test("the settings: both rankings on, 12 seconds, five people; each is held to its range; a link that turns both off still shows one", () => {
  const d = BOARDS.sanitize({});
  assert.deepEqual([d.gifters, d.likers, d.seconds, d.max, d.swap], [true, true, 12, 5, "fade"]);
  assert.deepEqual([BOARDS.sanitize({ seconds: 1 }).seconds, BOARDS.sanitize({ seconds: 600 }).seconds, BOARDS.sanitize({ max: 1 }).max, BOARDS.sanitize({ max: 99 }).max], [5, 60, 3, 10]);
  assert.equal(BOARDS.sanitize({ swap: "spin" }).swap, "fade", "an unknown way to change is the usual one");
  assert.deepEqual(boardsOn(d), ["gifters", "likers"]);
  assert.deepEqual(boardsOn(BOARDS.sanitize({ gifters: false })), ["likers"]);
  assert.deepEqual(boardsOn(BOARDS.sanitize({ gifters: false, likers: false })), ["gifters"], "never empty-handed");
  assert.deepEqual(BOARD_KINDS, ["gifters", "likers"]);
});

test("a link: the usual settings make a short link, a change is carried, and it reads back the same", () => {
  assert.equal(BOARDS.toParams(BOARDS.sanitize({})).toString(), "");
  const link = new URL(BOARDS.url("https://x.test/overlay/leaderboard/", { channel: "pond_cafe", settings: BOARDS.sanitize({ likers: false, seconds: 20, titleGifters: "Big spenders" }) }));
  assert.equal(link.searchParams.get("likers"), "0");
  assert.equal(link.searchParams.get("seconds"), "20");
  const back = BOARDS.sanitize(BOARDS.fromParams(link.searchParams));
  assert.deepEqual([back.likers, back.gifters, back.seconds, back.titleGifters], [false, true, 20, "Big spenders"]);
});

test("gifters are ranked by the diamonds each person sent, adding up, best first; the person who got there first wins a tie", () => {
  const { boards } = make();
  boards.add(gift("ann", 5));
  boards.add(gift("bob", 100));
  boards.add(gift("ann", 100)); // ann now has 105
  boards.add(gift("cat", 105)); // a tie with ann: ann got there first
  const top = boards.boards.gifters.top;
  assert.deepEqual(top.map((p) => [p.name, p.count, p.rank]), [["ANN", 105, 1], ["CAT", 105, 2], ["BOB", 100, 3]]);
  boards.add(gift("bob", 6));
  assert.equal(boards.boards.gifters.top[0].name, "BOB", "overtaking moves a person up");
});

test("a gift that is worth nothing, or has no person, or a line that is neither a gift nor a like, is not counted", () => {
  const { boards } = make();
  assert.equal(boards.add(gift("ann", 0)), false);
  assert.equal(boards.add(gift("", 50)), false);
  assert.equal(boards.add(gift("ann", NaN)), false);
  assert.equal(boards.add({ kind: "follow", user: "ann", name: "ANN" }), false);
  assert.equal(boards.add(null), false);
  assert.equal(boards.add(like("ann", 0)), false);
  assert.deepEqual([boards.boards.gifters.top.length, boards.boards.likers.top.length], [0, 0]);
  assert.equal(boards.add(gift("ann", 3)), true);
  assert.equal(boards.add(like("ann", 3)), true);
});

test("likes and gifts are separate rankings: the same person can be in both, with their own numbers", () => {
  const { boards } = make();
  boards.add(gift("ann", 500));
  boards.add(like("ann", 12));
  boards.add(like("bob", 80));
  assert.deepEqual(boards.boards.gifters.top.map((p) => [p.name, p.count]), [["ANN", 500]]);
  assert.deepEqual(boards.boards.likers.top.map((p) => [p.name, p.count]), [["BOB", 80], ["ANN", 12]]);
});

test("it lists at most the number of people asked for, and a likers milestone never celebrates in here", () => {
  const { boards } = make({ max: 3 });
  for (const who of ["a", "b", "c", "d", "e"]) boards.add(gift(who, 10));
  assert.equal(boards.boards.gifters.top.length, 3);
  let cheered = 0;
  boards.boards.likers.onMilestone = () => cheered++;
  boards.add(like("a", 5000)); // far past a thousand likes
  assert.equal(cheered, 0, "celebrating is the Top Likers overlay's job");
});

test("the rankings take turns, gifters then likers then gifters, and the title and the people are those of the one on show", () => {
  const { boards } = make({ titleGifters: "Big spenders", titleLikers: "Heart tappers" });
  boards.add(gift("ann", 50));
  boards.add(like("bob", 7));
  assert.deepEqual([boards.view.kind, boards.view.title, names(boards.view.top)], ["gifters", "Big spenders", ["ANN"]]);
  assert.equal(boards.next(), "likers");
  assert.deepEqual([boards.view.kind, boards.view.title, names(boards.view.top)], ["likers", "Heart tappers", ["BOB"]]);
  assert.equal(boards.next(), "gifters");
  assert.equal(boards.view.only, false);
});

test("a ranking with nobody on it is passed over while the other has somebody; with nobody on either it still moves on, so the title changes", () => {
  const { boards } = make();
  boards.add(like("bob", 7)); // likes but no gifts
  assert.equal(boards.view.kind, "gifters", "it starts on the gifters, empty for now");
  assert.equal(boards.next(), "likers");
  assert.equal(boards.next(), "likers", "the gifters are empty, so it stays on the likers");
  boards.add(gift("ann", 9));
  assert.equal(boards.next(), "gifters");
  const empty = make().boards;
  assert.deepEqual([empty.next(), empty.next(), empty.next()], ["likers", "gifters", "likers"]);
});

test("only the ranking on show tells the page about a change, and a turn tells it too", () => {
  const { boards, seen } = make();
  boards.add(like("bob", 7)); // the likers are not on show
  assert.equal(seen.length, 0);
  boards.add(gift("ann", 50));
  assert.deepEqual(seen.map((v) => v.kind), ["gifters"]);
  boards.next();
  assert.deepEqual(seen.map((v) => v.kind), ["gifters", "likers"]);
  boards.add(like("cat", 9));
  assert.deepEqual(seen.map((v) => v.kind), ["gifters", "likers", "likers"]);
});

test("one ranking turned on is shown all the time: there is nothing to turn to", () => {
  const { boards } = make({ likers: false });
  boards.add(gift("ann", 50));
  boards.add(like("bob", 7));
  assert.deepEqual([boards.view.kind, boards.view.only], ["gifters", true]);
  assert.equal(boards.next(), "gifters");
  const likesOnly = make({ gifters: false }).boards;
  assert.deepEqual([likesOnly.view.kind, likesOnly.view.only], ["likers", true]);
});

test("changing the settings while it runs: a ranking turned off is left, the people shown and the titles change, and the count kept stays", () => {
  const { boards, seen } = make();
  boards.add(gift("ann", 50));
  boards.add(gift("bob", 40));
  boards.add(gift("cat", 30));
  boards.next(); // likers (empty: stays on gifters because they are the only ones with people)
  assert.equal(boards.view.kind, "gifters");
  boards.setSettings(BOARDS.sanitize({ gifters: false })); // the gifters go away
  assert.deepEqual([boards.view.kind, boards.view.only], ["likers", true]);
  boards.setSettings(BOARDS.sanitize({ max: 3, titleGifters: "Spenders" })); // both back, the gifters again with a new title
  assert.equal(boards.view.top.length, 0, "it is still on the likers, which are empty");
  boards.current = "gifters";
  boards.setSettings(BOARDS.sanitize({ max: 3, titleGifters: "Spenders" }));
  assert.deepEqual([boards.view.title, boards.view.top.length], ["Spenders", 3], "what was counted while it was away is still there");
  assert.ok(seen.length > 0);
  boards.setSettings(BOARDS.sanitize({ max: 3, gifters: true, titleGifters: "Spenders" }));
  boards.boards.gifters.add({ kind: "like", user: "dan", name: "DAN", avatar: "", count: 1 });
  assert.equal(boards.boards.gifters.top.length, 3, "three at most");
});

test("clear empties both rankings", () => {
  const { boards } = make();
  boards.add(gift("ann", 50));
  boards.add(like("bob", 7));
  boards.clear();
  assert.deepEqual([boards.boards.gifters.top.length, boards.boards.likers.top.length], [0, 0]);
});

test("remembering: both rankings are kept for the account, come back as they were, and a damaged copy is ignored", () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const { boards } = make();
  boards.add(gift("ann", 50));
  boards.add(gift("bob", 20));
  boards.add(like("cat", 9));
  saveBoards(storage, "pond_cafe", boards);
  assert.ok(store.has(boardsKey("pond_cafe")));
  assert.equal(store.has(boardsKey("someone_else")), false);
  const later = new Boards(BOARDS.sanitize({}), { entries: loadBoards(storage, "pond_cafe") });
  assert.deepEqual(later.boards.gifters.top.map((p) => [p.name, p.count]), [["ANN", 50], ["BOB", 20]]);
  assert.deepEqual(later.boards.likers.top.map((p) => [p.name, p.count]), [["CAT", 9]]);
  later.add(gift("bob", 40)); // it carries on from what was kept
  assert.equal(later.boards.gifters.top[0].name, "BOB");
  for (const bad of ["not json", "[]", '{"gifters":[{"user":1}],"likers":"x"}', "null"]) {
    store.set(boardsKey("broken"), bad);
    assert.deepEqual(loadBoards(storage, "broken"), { gifters: [], likers: [] }, bad);
  }
  assert.deepEqual(loadBoards({ getItem() { throw new Error("blocked"); } }, "x"), { gifters: [], likers: [] }, "storage that is blocked is not an error");
});
