// What the relay says about itself: the readable status page, the numbers (free spots, line, signing busy, a capacity guess), who may see the
// device's own numbers, and the alarm when spots run low. A pretend TikTok and pretend notifier: no phone and no network.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { createHelper } from "../helper/server.mjs";
import { ALERT_AT, Signing, capacity, deviceFacts, level, snapshot, statusPage } from "../helper/status.mjs";
import { SlotAlerts, termuxNotifier } from "../helper/alerts.mjs";

// ── the pure parts ──────────────────────────────────────────────────────────────────────────────────────────────────

test("how full it is: plenty, low at the alarm number or fewer, and full", () => {
  assert.equal(ALERT_AT, 10);
  assert.equal(level({ used: 39, max: 50 }), "ok", "11 left");
  assert.equal(level({ used: 40, max: 50 }), "low", "10 left: the alarm number");
  assert.equal(level({ used: 49, max: 50 }), "low");
  assert.equal(level({ used: 50, max: 50 }), "full");
  assert.equal(level({ used: 60, max: 50 }), "full", "more than the spots still reads as full, never negative");
  assert.equal(level({ used: 2, max: 5 }, 1), "ok", "a different alarm number");
});

test("the capacity guess: a typical cost at first, measured once a couple of accounts are open, bounded, and never below one", () => {
  const first = capacity({ freeMem: 4e9, rss: 80e6, baseRss: 60e6, rooms: 0, cpuFraction: 0 });
  assert.deepEqual([first.measured, first.cpu, first.perRoomMB], [false, null, 6], "no accounts: a typical 6 MB each");
  assert.equal(first.estimate, Math.floor((4e9 * 0.5) / 6e6) > 500 ? 500 : Math.floor((4e9 * 0.5) / 6e6), "capped at 500");
  const measured = capacity({ freeMem: 1e9, rss: 100e6, baseRss: 60e6, rooms: 10, cpuFraction: 0.05 });
  assert.equal(measured.measured, true);
  assert.equal(measured.perRoomMB, 4, "40 MB for 10 accounts");
  assert.equal(measured.memory, Math.floor((1e9 * 0.5) / 4e6));
  assert.equal(measured.cpu, Math.floor(0.5 / (0.05 / 10)), "half a core, at 0.5% of a core per account");
  assert.equal(measured.estimate, Math.min(measured.memory, measured.cpu, 500), "the smaller of the two");
  assert.equal(capacity({ freeMem: 1e6, rss: 1, baseRss: 0, rooms: 0, cpuFraction: 0 }).estimate, 1, "never zero");
  assert.ok(capacity({ freeMem: 1e9, rss: 70e6, baseRss: 70e6, rooms: 5, cpuFraction: 0 }).perRoomMB >= 1.5, "an account is never free");
});

test("the signing service's busy times are counted over a window", () => {
  let t = 1000000;
  const signing = new Signing(() => t);
  assert.equal(signing.recent(), 0);
  signing.note(); signing.note();
  t += 3 * 60 * 1000;
  signing.note();
  assert.equal(signing.recent(10 * 60 * 1000), 3);
  assert.equal(signing.recent(2 * 60 * 1000), 1);
  t += 11 * 60 * 1000;
  assert.equal(signing.recent(), 0, "forgotten after ten minutes");
});

const snap = (over = {}) => snapshot({ stats: { used: 45, max: 50, waiting: 2 }, startedAt: 0, now: 3 * 3600 * 1000 + 12 * 60 * 1000, version: "0.5.0", features: ["chat", "status"], signing: new Signing(), estimate: { estimate: 120, measured: true, memory: 120, cpu: 200, perRoomMB: 4 }, ...over });

test("the numbers: free spots, the level, the line, uptime, and the device only when it is given", () => {
  const s = snap();
  assert.deepEqual([s.free, s.level, s.slots.waiting, s.uptimeS, s.alertAt], [5, "low", 2, 11520, 10]);
  assert.deepEqual(s.signing, { busyRecently: 0, busy: false });
  assert.equal(s.capacity.estimate, 120);
  assert.equal("device" in s, false, "the public numbers never carry the device's details");
  assert.equal(snap({ device: deviceFacts(0.12) }).device.cores >= 1, true);
  const facts = deviceFacts(0.0123);
  assert.equal(facts.relayCpuPercent, 1.2);
  assert.ok(facts.memoryTotalMB > 0 && facts.relayMemoryMB > 0 && /^v\d+/.test(facts.node));
});

test("the page shows the free spots big, says what to do, escapes everything, and refreshes itself", () => {
  const html = statusPage(snap({ stats: { used: 3, max: 50, waiting: 0 } }));
  assert.match(html, /<title>Frills relay: 47 spots free<\/title>/);
  assert.match(html, /<span class="num" id="free">47<\/span>/);
  assert.match(html, /free spots of 50/);
  assert.match(html, /Warn me when <input type="number" id="at" min="0" max="500" value="10">/);
  assert.match(html, /setInterval\(tick,5000\)/, "it asks again every 5 seconds");
  assert.match(html, /headers:\{accept:"application\/json",/, "and asks for the numbers, not the page");
  assert.ok(!html.includes("</script><script"), "the data inside the page cannot close the script");
  const hostile = statusPage({ ...snap(), version: "<img src=x onerror=alert(1)>" });
  assert.ok(!hostile.includes("<img src=x"), "a hostile value is escaped");
  assert.match(statusPage(snap({ stats: { used: 50, max: 50, waiting: 4 } })), /<span class="num" id="free">0<\/span>/);
});

test("the numbers carry the pages block when it is given (pages open, the most one address may hold, how many were turned away and how long ago, how many came back), and the page shows it", () => {
  assert.equal("streams" in snap(), false, "a program run on a PC has no such numbers");
  const streams = { open: 7, limit: 60, turnedAway: 2, replaced: 1, lastTurnedAwayS: 30 };
  assert.deepEqual(snap({ streams }).streams, streams);
  const html = statusPage(snap({ streams }));
  assert.match(html, /pages open right now/);
  assert.match(html, /pages turned away/);
  assert.match(html, /"turnedAway":2/, "the numbers are in the page it starts with");
  assert.match(html, /if\(s\.streams\)/, "and the script that draws them only runs when they are there");
});

// ── the alarm ───────────────────────────────────────────────────────────────────────────────────────────────────────

function alarm(over = {}) {
  const state = { used: 20, max: 50, waiting: 0 };
  const sent = [];
  const logs = [];
  const signing = new Signing(over.clock);
  const alerts = new SlotAlerts({ stats: () => state, signing, alertAt: 10, notify: (title, content) => sent.push([title, content]), log: (l) => logs.push(l), ...over.options });
  return { alerts, state, sent, logs, signing };
}

test("the alarm speaks once when spots run down to the alarm number, not again while it stays low, and again only after it got better", () => {
  const { alerts, state, sent } = alarm();
  assert.deepEqual(alerts.check(), [], "plenty of room: silent");
  state.used = 39;
  assert.deepEqual(alerts.check(), [], "11 left is still fine");
  state.used = 40;
  assert.deepEqual(alerts.check(), ["Only 10 spots left."], "10 left: the alarm");
  state.used = 44;
  assert.deepEqual(alerts.check(), [], "lower still: it does not nag");
  assert.equal(sent.length, 1);
  state.used = 38;
  alerts.check();
  state.used = 40;
  assert.deepEqual(alerts.check(), [], "hovering around the line does not repeat it: 12 left is not 'better' enough");
  state.used = 30;
  alerts.check();
  state.used = 41;
  assert.deepEqual(alerts.check(), ["Only 9 spots left."], "after real room came back, it speaks again");
  assert.equal(sent[0][0], "Frills relay is getting full");
});

test("full and the line forming each get their own message, and 'one spot' reads right", () => {
  const { alerts, state, sent } = alarm();
  state.used = 49;
  assert.deepEqual(alerts.check(), ["Only 1 spot left."]);
  state.used = 50;
  state.waiting = 1;
  const again = alerts.check();
  assert.deepEqual(again, ["1 person is waiting in line. 0 spots left."], "already warned about being low: only the new thing is said");
  state.waiting = 3;
  assert.deepEqual(alerts.check(), [], "more people in line is not a new alarm");
  state.waiting = 0;
  state.used = 10;
  alerts.check();
  state.used = 50;
  state.waiting = 2;
  const full = alerts.check();
  assert.ok(full.includes("The relay is full: nobody else fits.") && full.includes("2 people are waiting in line. 0 spots left."));
  assert.equal(sent.at(-1)[0], "People are waiting on the Frills relay");
});

test("the free signing service saying 'busy' is an alarm of its own, and it quiets down after ten calm minutes", () => {
  let t = 1000000;
  const { alerts, signing, sent } = alarm({ clock: () => t });
  assert.deepEqual(alerts.check(), []);
  signing.note();
  assert.match(alerts.check()[0], /signing service is saying "busy"/);
  assert.deepEqual(alerts.check(), [], "once");
  t += 3 * 60 * 1000;
  assert.deepEqual(alerts.check(), [], "no longer busy, but not yet calm for ten minutes");
  t += 8 * 60 * 1000;
  alerts.check();
  signing.note();
  assert.equal(alerts.check().length, 1, "busy again after a calm spell: it speaks again");
  assert.equal(sent.length, 2);
});

test("the phone notification uses Termux:API, with no shell, and says once how to get it when it is not installed", () => {
  const calls = [];
  const logs = [];
  const run = (cmd, args, done) => { calls.push([cmd, args]); done(Object.assign(new Error("not found"), { code: "ENOENT" })); };
  const notify = termuxNotifier({ run, log: (l) => logs.push(l) });
  notify("Frills relay", "Only 10 spots left; rm -rf / $(x)");
  notify("Frills relay", "again");
  assert.equal(calls[0][0], "termux-notification");
  assert.ok(calls[0][1].includes("--title") && calls[0][1].includes("Only 10 spots left; rm -rf / $(x)"), "the words are one argument, never run as a command");
  assert.equal(logs.length, 1, "the hint is given once");
  assert.match(logs[0], /pkg install termux-api/);
  const throwing = termuxNotifier({ run: () => { throw new Error("no such command"); }, log: (l) => logs.push(l) });
  assert.doesNotThrow(() => throwing("a", "b"));
});

// ── the server ──────────────────────────────────────────────────────────────────────────────────────────────────────

class FakeConnection extends EventEmitter {
  async connect() {}
  disconnect() { this.emit("disconnected"); }
}
let helper;
let port;
after(async () => { await helper?.close(); });
const start = async (relay = {}) => {
  await helper?.close(); // one at a time: an earlier one left open would keep the test run from ending
  helper = createHelper({ factory: async () => new FakeConnection(), relay: { origins: ["https://site.example"], slots: 50, ...relay }, idleStopMs: 50 });
  port = await helper.listen(0);
};
const ask = (path, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: "127.0.0.1", port, path, headers: { Host: "relay.example.test", ...headers } }, (res) => {
    let body = "";
    res.on("data", (c) => { body += c; });
    res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
  });
  req.on("error", reject);
  req.end();
});

test("the relay's address gives a readable page to a browser and the numbers as JSON to a program", async () => {
  await start();
  const page = await ask("/health", { Accept: "text/html,application/xhtml+xml" });
  assert.equal(page.status, 200);
  assert.match(page.headers["content-type"], /text\/html/);
  assert.match(page.body, /id="free">50</);
  assert.match(page.headers["content-security-policy"], /default-src 'none'/);
  assert.equal((await ask("/", { Accept: "text/html" })).status, 200, "the bare address works too");
  const json = JSON.parse((await ask("/health", { Accept: "application/json" })).body);
  assert.deepEqual([json.name, json.version, json.free, json.level, json.slots], ["frills-relay", "0.5.2", 50, "ok", { used: 0, max: 50, waiting: 0 }]);
  assert.ok(json.features.includes("status"));
  assert.ok(json.capacity.estimate >= 1 && json.capacity.estimate <= 500);
  assert.equal(JSON.parse((await ask("/health")).body).free, 50, "no Accept header at all: JSON, as before");
  assert.equal((await ask("/tiktok/ping")).status, 200);
});

test("only someone on the device itself sees its details, never anyone through the tunnel", async () => {
  await start();
  const local = JSON.parse((await ask("/health", { Accept: "application/json" })).body);
  assert.ok(local.device && local.device.cores >= 1, "on the device: cores and memory");
  const viaTunnel = JSON.parse((await ask("/health", { Accept: "application/json", "CF-Connecting-IP": "203.0.113.9" })).body);
  assert.equal("device" in viaTunnel, false, "through the tunnel: only the public numbers");
  const page = await ask("/health", { Accept: "text/html", "CF-Connecting-IP": "203.0.113.9" });
  assert.ok(!page.body.includes('"cores"'), "and not in the page either");
  const viaProxy = JSON.parse((await ask("/health", { Accept: "application/json", "X-Forwarded-For": "203.0.113.9" })).body);
  assert.equal("device" in viaProxy, false);
});

test("the alarm number is the owner's to set, and the server counts the signing service's 'busy'", async () => {
  await start({ alertAt: 25 });
  assert.equal(JSON.parse((await ask("/health", { Accept: "application/json" })).body).alertAt, 25);
  helper.signing.note();
  const json = JSON.parse((await ask("/health", { Accept: "application/json" })).body);
  assert.deepEqual(json.signing, { busyRecently: 1, busy: true });
});

// ── who is connected: names, for the owner's own screen only ───────────────────────────────────────────────────────────────────

/** Opens a page's event stream for an account, as an overlay would, and resolves once the relay has let it in. Returns the request, to end it. */
const listen = (user) => new Promise((resolve, reject) => {
  const req = http.request({ host: "127.0.0.1", port, path: `/tiktok/stream?user=${user}`, headers: { Host: "relay.example.test", Origin: "https://site.example", Accept: "text/event-stream" } }, (res) => {
    res.once("data", () => resolve(req)); // the first thing sent is the status
  });
  req.on("error", reject);
  req.end();
});

test("the list of who is connected shows names, LIVE or not, and how long, only on the device itself", async () => {
  await start();
  const first = await listen("mochi_bun");
  const second = await listen("pond.cafe");
  try {
    const local = JSON.parse((await ask("/health", { Accept: "application/json" })).body);
    assert.deepEqual(local.roster.accounts.map((a) => a.user).sort(), ["mochi_bun", "pond.cafe"]);
    const one = local.roster.accounts.find((a) => a.user === "mochi_bun");
    assert.deepEqual(Object.keys(one).sort(), ["counts", "followers", "forS", "live", "pages", "state", "user"]);
    assert.equal(one.pages, 1);
    assert.ok(one.forS >= 0);
    assert.deepEqual(local.roster.waiting, []);
    assert.deepEqual(local.slots.used, 2);

    const viaTunnel = await ask("/health", { Accept: "application/json", "CF-Connecting-IP": "203.0.113.9" });
    assert.equal("roster" in JSON.parse(viaTunnel.body), false, "through the tunnel: numbers only");
    assert.ok(!viaTunnel.body.includes("mochi_bun") && !viaTunnel.body.includes("pond.cafe"), "no name anywhere");
    const viaProxy = await ask("/health", { Accept: "application/json", "X-Forwarded-For": "203.0.113.9" });
    assert.ok(!viaProxy.body.includes("mochi_bun"));
    const publicPage = await ask("/health", { Accept: "text/html", "CF-Connecting-IP": "203.0.113.9" });
    assert.ok(!publicPage.body.includes("mochi_bun"), "and not in the page for everyone else");
    const ownPage = await ask("/health", { Accept: "text/html" });
    assert.ok(ownPage.body.includes("mochi_bun"), "the page on the device has them in it");
    assert.match(ownPage.body, /Who is connected/);
    assert.equal((await ask("/tiktok/ping")).body.includes("mochi_bun"), false, "the ping never lists anyone");
  } finally {
    first.destroy();
    second.destroy();
  }
});

test("the status page draws the table: a link to each LIVE, a status for each, and who is in line", () => {
  const roster = { accounts: [{ user: "mochi_bun", state: "connected", live: true, pages: 2, followers: 1234, forS: 400, counts: { chat: 5, gift: 1, follow: 2, share: 0 } }], waiting: ["late.comer"] };
  const page = statusPage(snapshot({ stats: { used: 1, max: 50, waiting: 1 }, startedAt: 0, now: 1000, version: "0.5.1", features: [], signing: new Signing(), estimate: { estimate: 20, measured: false }, roster }));
  assert.match(page, /id="who"/);
  assert.match(page, /tiktok\.com\/@"\+encodeURIComponent\(a\.user\)\+"\/live/, "each name links to their LIVE");
  assert.ok(page.includes('"user":"mochi_bun"'), "the first drawing already has the data");
  assert.ok(page.includes("late.comer"));
  const without = statusPage(snapshot({ stats: { used: 1, max: 50, waiting: 0 }, startedAt: 0, now: 1000, version: "0.5.1", features: [], signing: new Signing(), estimate: { estimate: 20, measured: false } }));
  assert.ok(!without.includes("mochi_bun"));
});

// ── the owner's password: the names from anywhere, to nobody else ─────────────────────────────────────────────────────────────

import { OWNER, ownerGate } from "../helper/owner.mjs";

const KEY = "a-long-enough-relay-password";
const PUBLIC = { Accept: "application/json", "CF-Connecting-IP": "203.0.113.9" };
const asOwner = (key, over = {}) => ({ ...PUBLIC, Authorization: `Bearer ${key}`, ...over });

test("the gate: no password set means nothing opens; a short one is the same; the right one opens; wrong tries lock that address only", () => {
  let t = 1000;
  assert.equal(ownerGate(undefined).check("Bearer anything", "a"), "none");
  assert.equal(ownerGate("short").enabled, false, "a short password is not accepted as a password at all");
  assert.equal(ownerGate("short").check("Bearer short", "a"), "none");
  const gate = ownerGate(KEY, { now: () => t });
  assert.equal(gate.enabled, true);
  assert.equal(gate.check(undefined, "a"), "none", "nothing sent");
  assert.equal(gate.check("Basic abc", "a"), "none", "not a bearer password");
  assert.equal(gate.check(`Bearer ${KEY}`, "a"), "ok");
  assert.equal(gate.check(`Bearer ${KEY}x`, "a"), "wrong");
  assert.equal(gate.check(`Bearer ${KEY.slice(1)}`, "a"), "wrong");
  for (let i = 0; i < OWNER.maxWrong - 2; i++) assert.equal(gate.check("Bearer nope" + i, "a"), "wrong");
  assert.equal(gate.check(`Bearer ${KEY}`, "a"), "locked", "ten wrong tries: even the right password waits");
  assert.equal(gate.check(`Bearer ${KEY}`, "b"), "ok", "another address is not affected");
  t += OWNER.windowMs + 1;
  assert.equal(gate.check(`Bearer ${KEY}`, "a"), "ok", "after ten minutes it works again");
});

test("with the owner's password the names come through the public address; without it, never", async () => {
  await start({ ownerKey: KEY });
  const first = await listen("mochi_bun");
  try {
    const open = JSON.parse((await ask("/health", PUBLIC)).body);
    assert.equal("roster" in open, false, "the public address: numbers only");
    assert.equal(open.ownerLogin, true, "and it says a password exists, so the page can offer the box");
    const page = await ask("/health", { Accept: "text/html", "CF-Connecting-IP": "203.0.113.9" });
    assert.ok(!page.body.includes("mochi_bun"));
    assert.match(page.body, /id="own"/);

    const asked = await ask("/health", asOwner(KEY));
    assert.equal(asked.status, 200);
    const owner = JSON.parse(asked.body);
    assert.deepEqual(owner.roster.accounts.map((a) => a.user), ["mochi_bun"]);
    assert.ok(owner.device.cores >= 1);
    assert.equal("ownerLogin" in owner, false, "the owner is not asked again");
    assert.equal(asked.headers["cache-control"], "no-store");

    const wrong = await ask("/health", asOwner("not-the-password-at-all"));
    assert.equal(wrong.status, 401);
    assert.ok(!wrong.body.includes("mochi_bun"));
    assert.equal(JSON.parse(wrong.body).error, "wrong_key");
    assert.ok(!(await ask("/tiktok/ping", asOwner(KEY))).body.includes("mochi_bun"), "the password opens the status page only");
  } finally {
    first.destroy();
  }
});

test("too many wrong passwords lock that visitor out, even for the right one, and the device itself is never locked", async () => {
  await start({ ownerKey: KEY, trustProxy: true });
  for (let i = 0; i < OWNER.maxWrong; i++) assert.equal((await ask("/health", asOwner("guess-number-" + i))).status, 401);
  const locked = await ask("/health", asOwner(KEY));
  assert.equal(locked.status, 429);
  assert.equal(locked.headers["retry-after"], "600");
  assert.equal((await ask("/health", asOwner(KEY, { "CF-Connecting-IP": "198.51.100.7" }))).status, 200, "somebody else, from another address, is fine");
  assert.ok(JSON.parse((await ask("/health", { Accept: "application/json" })).body).device, "on the device: always");
});

test("without a password set, a password sent changes nothing, and the page offers no box", async () => {
  await start();
  const sent = await ask("/health", asOwner("whatever-it-is-123"));
  assert.equal(sent.status, 200);
  const json = JSON.parse(sent.body);
  assert.equal("roster" in json, false);
  assert.equal("ownerLogin" in json, false);
});
