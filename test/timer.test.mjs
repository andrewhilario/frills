// The subathon timer, with no page and a pretend clock: the settings and the link, how a gift becomes seconds, the clock's states (start, pause,
// resume, add, the limit, time up, coming back), what is kept for a reload, and the two ends of the controls (the editor's post and the overlay's reading).

import test from "node:test";
import assert from "node:assert/strict";
import { TIMER, SubTimer, formatClock, parseGiftRules, secondsFor } from "../src/js/timer.js";
import { CODE, readCommands, sendCommand, timerIdentity, validCode } from "../src/js/timer-bridge.js";

const settings = (over = {}) => TIMER.sanitize({ startMinutes: 10, perDiamonds: 60, giftRules: "Rose=10, Galaxy=300", followSeconds: 10, shareSeconds: 0, ...over });
const gift = (name, diamonds, count = 1) => ({ kind: "gift", gift: name, diamonds, count, total: diamonds * count });
const T0 = 1_000_000;

// ── the settings ───────────────────────────────────────────────────────────────────────────────────

test("the timer's settings are checked, and a link carries only what was changed", () => {
  const d = TIMER.sanitize({});
  assert.deepEqual([d.startMinutes, d.capMinutes, d.revive, d.autoStart, d.hours], [60, 0, false, false, "auto"]);
  const odd = TIMER.sanitize({ startMinutes: 0, capMinutes: -5, hours: "weekly", giftRules: "x".repeat(900), code: "short" });
  assert.equal(odd.startMinutes, 1, "at least a minute");
  assert.equal(odd.capMinutes, 0);
  assert.equal(odd.hours, "auto");
  assert.equal(odd.giftRules.length, 600, "the list is cut");
  const link = TIMER.url("https://frills.test/overlay/timer/", { channel: "pond.pal", settings: { ...d, startMinutes: 90, giftRules: "Rose=5", code: "abcdefghij123456" } });
  const params = new URL(link).searchParams;
  assert.deepEqual([params.get("startMinutes"), params.get("giftRules"), params.get("code"), params.has("hours")], ["90", "Rose=5", "abcdefghij123456", false]);
  const back = TIMER.sanitize(TIMER.fromParams(params));
  assert.deepEqual([back.startMinutes, back.giftRules], [90, "Rose=5"], "the link reads back the same");
});

// ── gifts become seconds ───────────────────────────────────────────────────────────────────────────

test("the gift list is read forgivingly: names in any case, spaces, commas, lines, and anything that is not name=number is skipped", () => {
  const rules = parseGiftRules("Rose=10, finger  heart = 30\nGalaxy=300; broken, =5, Lion=abc, Big=-3, Huge=99999, Tiny=0");
  assert.deepEqual([...rules], [["rose", 10], ["finger heart", 30], ["galaxy", 300], ["tiny", 0]]);
  assert.equal(parseGiftRules(null).size, 0);
});

test("a gift in the list adds its own seconds for each one; any other gift adds its diamonds at the rate; a follow and a share add their own", () => {
  const s = settings();
  assert.equal(secondsFor(gift("Rose", 1, 1), s), 10);
  assert.equal(secondsFor(gift("rose", 1, 5), s), 50, "a streak of 5 Roses is 5 times the time, whatever the case");
  assert.equal(secondsFor(gift("Galaxy", 1000), s), 300);
  assert.equal(secondsFor(gift("Panda", 100), s), 60, "100 diamonds at 60 seconds for every 100");
  assert.equal(secondsFor(gift("Lion", 29999), s), 17999, "big gifts count by their diamonds");
  assert.equal(secondsFor(gift("Heart", 20, 3), s), 36, "a streak counts all its diamonds: 60 diamonds");
  assert.equal(secondsFor(gift("Panda", 100), settings({ perDiamonds: 0 })), 0, "a rate of 0 means other gifts add nothing");
  assert.equal(secondsFor({ kind: "follow" }, s), 10);
  assert.equal(secondsFor({ kind: "share" }, s), 0);
  assert.equal(secondsFor({ kind: "like", count: 50 }, s), 0, "likes add nothing");
  assert.equal(secondsFor(null, s), 0);
});

test("the clock is written 4:05, or 1:04:05 once an hour is left", () => {
  assert.deepEqual([0, 999, 1000, 65_000, 3_599_000, 3_600_000, 3_665_000, 90_061_000].map((ms) => formatClock(ms)), ["0:00", "0:01", "0:01", "1:05", "59:59", "1:00:00", "1:01:05", "25:01:01"]);
  assert.equal(formatClock(65_000, "always"), "0:01:05");
  assert.equal(formatClock(-5), "0:00");
  assert.equal(formatClock("junk"), "0:00");
});

// ── the clock ──────────────────────────────────────────────────────────────────────────────────────

test("the clock is ready, runs when started, pauses and resumes where it was, and resets", () => {
  const t = new SubTimer(settings());
  assert.equal(t.state(T0), "ready");
  assert.equal(t.remaining(T0), 600_000, "ready at the starting time");
  t.start(T0);
  assert.equal(t.state(T0 + 1000), "running");
  assert.equal(t.remaining(T0 + 60_000), 540_000);
  t.pause(T0 + 60_000);
  assert.equal(t.state(T0 + 120_000), "paused");
  assert.equal(t.remaining(T0 + 120_000), 540_000, "a paused clock does not move");
  t.resume(T0 + 120_000);
  assert.equal(t.remaining(T0 + 180_000), 480_000);
  t.reset();
  assert.equal(t.state(T0), "ready");
  assert.equal(t.remaining(T0), 600_000);
  t.reset(90);
  assert.equal(t.remaining(T0), 90_000, "reset to a number of seconds");
});

test("the starting time follows the setting until the clock has been started", () => {
  const t = new SubTimer(settings({ startMinutes: 10 }));
  t.setSettings(settings({ startMinutes: 20 }));
  assert.equal(t.remaining(T0), 1_200_000);
  t.start(T0);
  t.setSettings(settings({ startMinutes: 5 }));
  assert.equal(t.remaining(T0 + 1000), 1_199_000, "a running clock is not changed by the setting");
});

test("time added moves a running clock, a paused one and one not started; and it is told what really went on", () => {
  const added = [];
  const t = new SubTimer(settings(), { onAdd: (s) => added.push(s) });
  assert.equal(t.add(30, T0), 30);
  assert.equal(t.remaining(T0), 630_000, "added before the start: the starting time grows");
  t.start(T0);
  assert.equal(t.remaining(T0), 600_000, "starting begins from the setting again");
  assert.equal(t.add(60, T0 + 10_000), 60);
  assert.equal(t.remaining(T0 + 10_000), 650_000);
  t.pause(T0 + 10_000);
  t.add(-50, T0 + 20_000);
  assert.equal(t.remaining(T0 + 20_000), 600_000);
  assert.equal(t.add(-5000, T0 + 20_000), -600, "taking away more than is left goes to zero");
  assert.deepEqual(added, [30, 60, -50, -600]);
});

test("time up: the clock ends once, stays at zero, and a gift does not bring it back unless allowed", () => {
  let ends = 0;
  const t = new SubTimer(settings({ startMinutes: 1 }), { onEnd: () => ends++ });
  t.start(T0);
  t.tick(T0 + 59_000);
  assert.equal(ends, 0);
  t.tick(T0 + 60_000);
  t.tick(T0 + 61_000);
  assert.equal(ends, 1, "told once");
  assert.equal(t.state(T0 + 62_000), "ended");
  assert.equal(t.handle(gift("Rose", 1), T0 + 62_000), 0, "after time is up a gift adds nothing");
  assert.equal(t.state(T0 + 63_000), "ended");

  const again = new SubTimer(settings({ startMinutes: 1, revive: true }));
  again.start(T0);
  again.tick(T0 + 61_000);
  assert.equal(again.handle(gift("Rose", 1), T0 + 70_000), 10);
  assert.equal(again.state(T0 + 71_000), "running", "allowed: a gift starts it again");
  assert.equal(again.remaining(T0 + 70_000), 10_000);
});

test("the longest it can get: gifts cannot push the clock past it", () => {
  const t = new SubTimer(settings({ startMinutes: 10, capMinutes: 11 }));
  t.start(T0);
  assert.equal(t.add(30, T0), 30);
  assert.equal(t.add(300, T0), 30, "only what fits goes on: 11 minutes at the most");
  assert.equal(t.remaining(T0), 660_000);
  assert.equal(t.add(300, T0), 0, "already at the limit");
});

test("handle: a gift, follow or share adds by the rules, and 'start by itself' starts the clock with the first one that adds time", () => {
  const t = new SubTimer(settings({ autoStart: true }));
  assert.equal(t.state(T0), "ready");
  assert.equal(t.handle({ kind: "share" }, T0), 0, "a share that adds nothing does not start it");
  assert.equal(t.state(T0), "ready");
  assert.equal(t.handle(gift("Galaxy", 1000), T0), 300);
  assert.equal(t.state(T0 + 1), "running");
  assert.equal(t.remaining(T0), 900_000);
  const quiet = new SubTimer(settings());
  quiet.handle(gift("Rose", 1), T0);
  assert.equal(quiet.state(T0 + 1), "ready", "without it, the clock waits for Start");
});

test("commands from the editor do what the buttons say", () => {
  const t = new SubTimer(settings());
  t.command({ cmd: "start", value: 0 }, T0);
  t.command({ cmd: "add", value: 120 }, T0);
  assert.equal(t.remaining(T0), 720_000);
  t.command({ cmd: "pause", value: 0 }, T0 + 1000);
  t.command({ cmd: "resume", value: 0 }, T0 + 5000);
  assert.equal(t.state(T0 + 5000), "running");
  t.command({ cmd: "reset", value: 0 }, T0);
  assert.equal(t.remaining(T0), 600_000, "reset with no number is the starting time");
  t.command({ cmd: "reset", value: 45 }, T0);
  assert.equal(t.remaining(T0), 45_000);
  t.command({ cmd: "explode", value: 5 }, T0);
  assert.equal(t.remaining(T0), 45_000, "an unknown command does nothing");
});

test("what is kept for a reload carries the clock on, a running one by the moment it ends", () => {
  const t = new SubTimer(settings());
  t.start(T0);
  t.add(60, T0);
  const kept = JSON.parse(JSON.stringify(t.save()));
  const back = new SubTimer(settings());
  back.restore(kept);
  assert.equal(back.state(T0 + 30_000), "running");
  assert.equal(back.remaining(T0 + 30_000), 630_000, "30 seconds went by while the page was closed");
  assert.equal(back.state(T0 + 700_000), "ended", "and a clock that ran out while it was closed is over");
  const damaged = new SubTimer(settings());
  damaged.restore({ running: "yes", endsAt: "x", left: -5 });
  assert.equal(damaged.state(T0), "ready");
  damaged.restore(null);
  damaged.restore("junk");
});

// ── the controls: the editor's post and the overlay's reading ──────────────────────────────────────────────────────

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test("the editor makes a code and a key once, and keeps them", () => {
  const storage = memory();
  const a = timerIdentity(storage);
  assert.ok(CODE.test(a.code) && a.key.length === 32);
  assert.deepEqual(timerIdentity(storage), a);
  assert.equal(validCode(a.code), a.code);
  assert.deepEqual([validCode("nope"), validCode(null), validCode("a".repeat(17))], ["", "", ""]);
  storage.setItem("frills:timer:bridge", "{ damaged");
  assert.ok(CODE.test(timerIdentity(storage).code), "a damaged store is replaced");
});

test("sending a command posts it with the key, and says plainly when it did not go", async () => {
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push({ url, init }); return { ok: true, json: async () => ({ ok: true }) }; };
  const id = { code: "abcdefghij123456", key: "k".repeat(32) };
  assert.deepEqual(await sendCommand(id, { cmd: "add", value: 60 }, { fetchImpl }), { ok: true });
  assert.equal(sent[0].url, "/api/timer/abcdefghij123456");
  assert.equal(sent[0].init.headers["x-key"], id.key);
  assert.deepEqual(JSON.parse(sent[0].init.body), { cmd: "add", value: 60 });
  assert.deepEqual(await sendCommand(id, { cmd: "start" }, { fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ ok: false, error: "wrong_key" }) }) }), { ok: false, error: "wrong_key" });
  assert.deepEqual(await sendCommand(id, { cmd: "start" }, { fetchImpl: async () => { throw new Error("offline"); } }), { ok: false, error: "offline" });
});

test("the overlay learns where the line is on the first look, then obeys each new command once, in order", async () => {
  let box = { seq: 7, items: [] };
  const asked = [];
  const fetchImpl = async (url) => { asked.push(url); const after = /after=(\d+)/.exec(url)?.[1]; return { ok: true, json: async () => ({ ok: true, seq: box.seq, items: after === undefined ? [] : box.items.filter((i) => i.seq > Number(after)) }) }; };
  const obeyed = [];
  const seqs = [];
  const queue = [];
  const timers = { setTimeout: (fn) => { queue.push(fn); return queue.length; }, clearTimeout: () => {} };
  const reader = readCommands({ code: "abcdefghij123456", onCommand: (c) => obeyed.push(c), onSeq: (n) => seqs.push(n), fetchImpl, timers });
  const turn = async () => { await queue.shift()(); };
  await turn();
  assert.deepEqual([asked[0], obeyed.length, seqs], ["/api/timer/abcdefghij123456", 0, [7]], "the first look obeys nothing: commands from before the page opened are old");
  box = { seq: 9, items: [{ seq: 8, cmd: "start", value: 0 }, { seq: 9, cmd: "add", value: 60 }] };
  await turn();
  assert.equal(asked[1], "/api/timer/abcdefghij123456?after=7");
  assert.deepEqual(obeyed, [{ cmd: "start", value: 0 }, { cmd: "add", value: 60 }]);
  await turn();
  assert.equal(obeyed.length, 2, "nothing is obeyed twice");
  assert.deepEqual(seqs, [7, 9]);
  reader.stop();
  const after = queue.length;
  await turn().catch(() => {});
  assert.ok(queue.length <= after);
});

test("a reload that remembers its number does not obey an old command, and a box that does not answer is tried again", async () => {
  let fail = true;
  const fetchImpl = async () => { if (fail) throw new Error("down"); return { ok: true, json: async () => ({ ok: true, seq: 5, items: [{ seq: 4, cmd: "start", value: 0 }, { seq: 5, cmd: "pause", value: 0 }] }) }; };
  const obeyed = [];
  const queue = [];
  const timers = { setTimeout: (fn) => { queue.push(fn); return 1; }, clearTimeout: () => {} };
  readCommands({ code: "abcdefghij123456", seq: 4, onCommand: (c) => obeyed.push(c.cmd), fetchImpl, timers });
  await queue.shift()();
  assert.equal(queue.length, 1, "it asks again later");
  fail = false;
  await queue.shift()();
  assert.deepEqual(obeyed, ["pause"], "only what came after the number it remembered");
});
