// The Quick start suggestion's rules (when it may appear and when it must stay away), without a page. How it looks and behaves is in tip.browser.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { DELAY_MS, KEY, MAX_SHOWS, PAGES, QUIET_DAYS, mayShow, readMemory, writeMemory } from "../src/js/tip.js";

const DAY = 86400000;
const NOW = 1_800_000_000_000;
const ask = (over = {}) => mayShow({ path: "/", memory: { shown: 0, closedAt: 0, done: false }, now: NOW, shownThisVisit: false, ...over });
const storage = () => { const data = new Map(); return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), data }; };

test("it is quiet by design: it comes just after the page loads, only a few times, and then keeps away for a long time", () => {
  assert.ok(DELAY_MS >= 500 && DELAY_MS <= 3000, "a moment after load, not in the first blink and not long after");
  assert.ok(MAX_SHOWS <= 2, "at most twice, ever");
  assert.ok(QUIET_DAYS >= 30, "a month of peace once it has been closed");
});

test("it may appear on the home page, the overlays page and the guides, and nowhere else", () => {
  for (const path of PAGES) assert.equal(ask({ path }), true, path);
  for (const path of ["/editor/", "/alerts/", "/gifts/", "/goal/", "/likers/", "/matcha/", "/start/", "/overlay/", "/overlay/alerts/", "/privacy/", "/changelog/", "/feedback/", "/admin/", "/twitch/", "/overlays/faq/", "/404.html"]) {
    assert.equal(ask({ path }), false, path + " must stay free of it");
  }
  assert.ok(PAGES.every((p) => !/editor|overlay\/|start|admin|privacy/.test(p)));
});

test("it stays away once it has been closed (for a month), shown twice, shown this visit, or the Quick start has been opened from it", () => {
  assert.equal(ask(), true, "a first visit");
  assert.equal(ask({ shownThisVisit: true }), false, "once in a visit");
  assert.equal(ask({ memory: { shown: MAX_SHOWS, closedAt: 0, done: false } }), false, "twice in all");
  assert.equal(ask({ memory: { shown: 1, closedAt: NOW - 5 * DAY, done: false } }), false, "closed five days ago");
  assert.equal(ask({ memory: { shown: 1, closedAt: NOW - 29 * DAY, done: false } }), false, "closed 29 days ago");
  assert.equal(ask({ memory: { shown: 1, closedAt: NOW - 31 * DAY, done: false } }), true, "a month later it may come back (once more)");
  assert.equal(ask({ memory: { shown: 0, closedAt: 0, done: true } }), false, "they opened the Quick start: never again");
});

test("what the browser remembers is one small note, read safely and changed one part at a time", () => {
  const s = storage();
  assert.deepEqual(readMemory(s), { shown: 0, closedAt: 0, done: false });
  writeMemory(s, { shown: 1 });
  writeMemory(s, { closedAt: NOW });
  assert.deepEqual(readMemory(s), { shown: 1, closedAt: NOW, done: false }, "a change keeps the rest");
  writeMemory(s, { done: true });
  assert.equal(readMemory(s).done, true);
  assert.equal(s.data.size, 1, "one entry, under one key");
  assert.equal(KEY, "frills:quickstart-tip:v1");
  s.setItem(KEY, "{not json");
  assert.deepEqual(readMemory(s), { shown: 0, closedAt: 0, done: false }, "a damaged note is the same as none");
  s.setItem(KEY, JSON.stringify({ shown: "lots", closedAt: "never", done: "yes" }));
  assert.deepEqual(readMemory(s), { shown: 0, closedAt: 0, done: false }, "wrong kinds of value count as nothing");
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.deepEqual(readMemory(blocked), { shown: 0, closedAt: 0, done: false });
  assert.doesNotThrow(() => writeMemory(blocked, { shown: 1 }), "blocked storage is not an error");
});
