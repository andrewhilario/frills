// The admin dashboard's Overview logic (src/js/admin-overview.js): what needs the owner, the six cards, the chart sentence, and that nothing is invented.

import test from "node:test";
import assert from "node:assert/strict";
import { attention, change, chartSentence, chartSeries, dollars, kpiCards, number, quotaOf, relayName, relayState, statsState } from "../src/js/admin-overview.js";

const relay = (over = {}) => ({ ok: true, host: "relay.valwidgets.live", level: "ok", free: 80, slots: { used: 20, max: 100, waiting: 0 }, ...over });
const days = (n, fill) => Array.from({ length: 28 }, (_, i) => ({ day: `2026-11-${String(i + 1).padStart(2, "0")}`, n: fill(i) }));
const stats = (over = {}) => ({
  ok: true,
  relays: [relay(), relay({ host: "plus-relay.valwidgets.live" })],
  frills: {
    visits: { today: 12, week: 140, before: 100, perDay: days(28, (i) => (i === 20 ? 40 : 2)) },
    copies: { today: 3, week: 30, before: 30, perDay: days(28, () => 1) },
    loads: { livePerDay: days(28, () => 0) },
    active: { today: 4, week: 20, before: 25 },
  },
  ...over,
});
const overview = (over = {}) => ({
  summary: { feedback: { new: 0, total: 5 } },
  accounts: { total: 3, last7d: 2, previous7d: 1 },
  plus: { active: 3, paid: 1, manual: 1, vip: 1, ending: 0, monthlyUsd: 5.99, expiring: [] },
  ...over,
});

test("numbers and money read the same everywhere", () => {
  assert.equal(number(1234567), "1,234,567");
  assert.equal(number(undefined), "0");
  assert.equal(dollars(5.99), "$5.99");
  assert.equal(dollars(0), "$0.00");
});

test("a week-on-week change says how much and which way, and never divides by nothing", () => {
  assert.deepEqual(change(140, 100), { text: "+40% vs last week", tone: "up" });
  assert.deepEqual(change(50, 100), { text: "−50% vs last week", tone: "down" });
  assert.deepEqual(change(10, 10), { text: "No change", tone: "flat" });
  assert.deepEqual(change(0, 0), { text: "No change", tone: "flat" });
  assert.deepEqual(change(7, 0), { text: "Up from none last week", tone: "up" });
  assert.equal(change(undefined, 3), null);
});

test("each relay has a friendly name, and a status that is a word as well as a color", () => {
  assert.equal(relayName({ host: "relay.valwidgets.live" }), "Free relay");
  assert.equal(relayName({ host: "plus-relay.valwidgets.live" }), "Plus relay");
  assert.equal(relayName({ host: "other.example.com", label: "Relay 3 (other.example.com)" }), "Relay 3 (other.example.com)");
  assert.deepEqual(relayState(relay()), { tone: "ok", word: "Online", detail: "20 of 100 spots used" });
  assert.equal(relayState(relay({ level: "low" })).word, "Nearly full");
  assert.equal(relayState(relay({ level: "full" })).tone, "bad");
  assert.deepEqual(relayState({ ok: false, status: 530 }), { tone: "bad", word: "Down", detail: "No good answer (status 530)" });
  assert.equal(relayState({ ok: false }).detail, "No answer");
});

test("the Euler quota comes from Euler's own count when the relay has it, and is null when it does not say", () => {
  assert.deepEqual(quotaOf({ signing: { quota: { cap: 1500, remaining: 1490, remote: { ok: true, day: { max: 1500, remaining: 1490 } } } } }), { left: 1490, max: 1500, share: 1490 / 1500 });
  assert.equal(quotaOf({ signing: { quota: { cap: 1500, remaining: 300 } } }).share, 0.2);
  assert.equal(quotaOf({ signing: { key: true } }), null, "an older relay only says whether it has a key");
  assert.equal(quotaOf(null), null);
});

test("what needs attention: a down relay says what it means for people, worst first, and an all-clear is an empty list", () => {
  assert.deepEqual(attention({ overview: overview(), stats: stats() }), []);

  const bad = attention({
    overview: overview({ summary: { feedback: { new: 2 } }, plus: { expiring: [{ email: "a@example.com", renewsAt: Date.UTC(2026, 11, 28), manual: true }] } }),
    stats: stats({ relays: [relay({ ok: false, status: 530 }), relay({ host: "plus-relay.valwidgets.live", level: "low", free: 8 })] }),
  });
  assert.deepEqual(bad.map((i) => i.tone), ["bad", "warn", "warn", "info"]);
  assert.match(bad[0].text, /Free relay is down\. TikTok chat does not work for free users/);
  assert.match(bad[1].text, /Plus relay has 8 spots left/);
  assert.match(bad[2].text, /a@example\.com: manual Plus ends Dec 28/);
  assert.equal(bad[2].view, "plus");
  assert.match(bad[3].text, /2 new feedback messages/);
  assert.equal(bad[3].view, "feedback");

  const plusDown = attention({ overview: overview(), stats: stats({ relays: [relay(), relay({ host: "plus-relay.valwidgets.live", ok: false })] }) });
  assert.match(plusDown[0].text, /Plus subscribers fall back to the free relay/);

  const quota = attention({ overview: overview(), stats: stats({ relays: [relay({ signing: { quota: { cap: 1500, remaining: 100 } } })] }) });
  assert.match(quota[0].text, /Free relay: only 100 of 1,500 Euler requests are left today/);

  assert.match(attention({ overview: overview(), stats: null })[0].text, /could not be read/);
  assert.match(attention({ overview: overview(), stats: { ok: false, error: "not_set" } })[0].text, /CF_ACCOUNT_ID and CF_API_TOKEN/);
  assert.deepEqual(attention({ overview: overview(), stats: undefined }), [], "still loading says nothing");
  assert.match(attention({ overview: overview({ summary: { feedback: { new: 1 } } }), stats: stats() })[0].text, /1 new feedback message to read/);
});

test("the six cards use real numbers, and show a dash with the reason while a number is missing", () => {
  const ready = kpiCards({ overview: overview(), stats: stats() });
  assert.deepEqual(ready.map((c) => c.key), ["plus", "revenue", "accounts", "visits", "copies", "live"]);
  assert.deepEqual([ready[0].value, ready[0].sub], ["3", "1 paid · 1 manual · 1 VIP"]);
  assert.deepEqual([ready[1].value, ready[1].sub], ["$5.99", "List price · 1 paid subscriber"]);
  assert.deepEqual([ready[2].value, ready[2].sub, ready[2].change.text], ["3", "2 new this week", "+100% vs last week"]);
  assert.deepEqual([ready[3].value, ready[3].sub, ready[3].change.text], ["140", "12 today", "+40% vs last week"]);
  assert.equal(ready[5].change.tone, "down", "live overlays fell from 25 to 20");

  const loading = kpiCards({ overview: overview(), stats: undefined });
  assert.deepEqual([loading[3].value, loading[3].sub], ["—", "Loading…"]);
  assert.equal(loading[0].value, "3", "our own database numbers do not wait for the stats");
  assert.equal(kpiCards({ overview: overview(), stats: { ok: false, error: "not_set" } })[3].sub, "Not connected");
  assert.equal(kpiCards({ overview: overview(), stats: null })[4].sub, "Could not read");
  assert.equal(kpiCards({ overview: overview(), stats: stats({ frills: { error: "unreadable" } }) })[5].sub, "Could not read");
  assert.equal(kpiCards({}).every((c) => c.value === "—"), true, "with nothing loaded, nothing is invented");

  const paid = kpiCards({ overview: overview({ plus: { active: 2, paid: 2, manual: 0, vip: 0, ending: 1, monthlyUsd: 11.98, expiring: [] } }), stats: stats() });
  assert.equal(paid[1].sub, "List price · 2 paid subscribers · 1 ending");
});

test("the chart reads the right series, and its sentence says what the bars say", () => {
  assert.equal(statsState(undefined), "loading");
  assert.equal(statsState(null), "error");
  assert.equal(statsState({ ok: false }), "off");
  assert.equal(statsState(stats()), "ready");
  const visits = chartSeries(stats(), "visits");
  assert.equal(visits.length, 28);
  assert.equal(chartSeries(stats(), "copies")[0].n, 1);
  assert.equal(chartSeries(stats(), "live").every((d) => d.n === 0), true);
  assert.equal(chartSeries(null, "visits"), null);
  assert.equal(chartSeries(stats({ frills: { error: "unreadable" } }), "visits"), null);
  assert.equal(chartSentence(visits, "visits"), "94 visits in 28 days. Busiest day: Nov 21 with 40. Today: 2.");
  assert.equal(chartSentence(chartSeries(stats(), "live"), "live overlay opens"), "No live overlay opens in the last 28 days.");
  assert.equal(chartSentence(null, "visits"), "");
});
