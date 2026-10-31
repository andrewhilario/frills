// Which season it is, by the date. No page needed.

import test from "node:test";
import assert from "node:assert/strict";
import { SEASONS, activeSeason, seasonById, seasonOn } from "../src/js/season.js";

const on = (month, day) => seasonOn(new Date(2026, month - 1, day, 12, 0, 0)); // local noon of that day

test("Halloween runs from 1 October to 2 November, both days included", () => {
  assert.equal(on(9, 30), null);
  assert.equal(on(10, 1), "halloween");
  assert.equal(on(10, 31), "halloween");
  assert.equal(on(11, 2), "halloween");
  assert.equal(on(11, 3), null);
});

test("Christmas runs from 1 December to 6 January, across the new year", () => {
  assert.equal(on(11, 30), null);
  assert.equal(on(12, 1), "christmas");
  assert.equal(on(12, 25), "christmas");
  assert.equal(on(12, 31), "christmas");
  assert.equal(seasonOn(new Date(2027, 0, 1, 0, 0, 1)), "christmas", "a minute into the new year");
  assert.equal(seasonOn(new Date(2027, 0, 6, 23, 59, 59)), "christmas");
  assert.equal(seasonOn(new Date(2027, 0, 7, 0, 0, 0)), null);
});

test("the rest of the year has no season", () => {
  for (const [month, day] of [[1, 20], [2, 14], [3, 17], [4, 22], [5, 5], [6, 30], [7, 4], [8, 15], [9, 9], [11, 15]]) assert.equal(on(month, day), null, `${month}/${day}`);
});

test("the windows do not overlap, and every season is named", () => {
  const seen = [];
  for (let month = 1; month <= 12; month++) for (let day = 1; day <= 31; day++) {
    const date = new Date(2026, month - 1, day);
    if (date.getMonth() !== month - 1) continue; // 31 June is not a day
    const hits = SEASONS.filter((s) => seasonOn(date) === s.id);
    assert.ok(hits.length <= 1);
    seen.push(seasonOn(date));
  }
  assert.ok(seen.includes("halloween") && seen.includes("christmas") && seen.includes(null));
  assert.ok(SEASONS.every((s) => s.id && s.name));
  assert.equal(seasonById("halloween").name, "Halloween");
  assert.equal(seasonById("easter"), null);
});

test("the address can name a season to look at, or say none; otherwise it is the date", () => {
  const spring = new Date(2026, 3, 22);
  assert.equal(activeSeason("", spring), null);
  assert.equal(activeSeason("?season=christmas", spring), "christmas");
  assert.equal(activeSeason("?look=pumpkin&season=halloween", spring), "halloween");
  assert.equal(activeSeason("?season=none", new Date(2026, 9, 31)), null, "none switches the date's season off");
  assert.equal(activeSeason("?season=easter", new Date(2026, 9, 31)), "halloween", "an unknown name is ignored");
  assert.equal(activeSeason("", new Date(2026, 9, 31)), "halloween");
});
