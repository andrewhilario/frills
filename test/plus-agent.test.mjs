// Mango, the Frills Plus sales agent (worker/plus-agent.mjs), over a real in-memory SQLite database with the real schema and a pretend Discord and stats report.
// The agent acts with nobody approving it, so these tests are its guard rails: every public post passes the checks and a bad one is refused, it speaks only when it should
// (Mondays, Thursdays, a real alert), never twice for the same thing, never when switched off, and never throws.

import test from "node:test";
import assert from "node:assert/strict";
import { PUBLIC_TAIL, TIPS, briefText, funnelOf, insights, lintPublicPost, plusCounts, planPlays, runPlusAgent } from "../worker/plus-agent.mjs";
import { OFFICE_AGENTS } from "../worker/office.mjs";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";

const DAY = 86_400_000;
const TUE = Date.UTC(2026, 10, 24, 15, 17); // a Tuesday
const MON = Date.UTC(2026, 10, 30, 15, 17);
const THU = Date.UTC(2026, 10, 26, 15, 17);
const THU2 = THU + 7 * DAY;
const OFFICE_HOOK = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEFGHIJ";
const PUBLIC_HOOK = "https://discord.com/api/webhooks/987654321098765432/ZYXWVUTSRQPONMLKJIHGFEDCBAzyxwvutsrq";

const fresh = (extra = {}) => ({ DB: localDatabase(":memory:"), ...extra });
const metricsOf = (over = {}) => ({ accounts: 2, paying: 0, paidOrRenewedWeek: 0, leftWeek: 0, refundedWeek: 0, funnel: null, ...over });
const funnel = (over = {}) => ({ visitsWeek: 300, copiesWeek: 150, liveWeek: 40, shown: 0, clicked: 0, checkout: 0, checkoutWeek: 0, moments: {}, ...over });
/** A stats report as the Worker would read it from Cloudflare. */
const reportWith = (frills) => async () => ({ ok: true, frills });
const prompts = (shown, clicked, week = {}) => ({ prompts: { shown, clicked, shownTotal: shown.reduce((s, r) => s + r.n, 0), clickedTotal: clicked.reduce((s, r) => s + r.n, 0), shownWeek: [], clickedWeek: week.clicked ?? [] }, visits: { week: 300 }, copies: { week: 150 }, loads: { live: { week: 40 } } });
/** A pretend Discord: every post it receives is written down, and it can be made to fail. */
const discord = ({ ok = true } = {}) => { const posts = []; const fn = async (url, init) => { posts.push({ url, body: JSON.parse(init.body) }); return { ok }; }; fn.posts = posts; return fn; };
const addPlus = (env, id, { provider = "sub_1", status = "active", periodStart, updated }) =>
  env.DB.raw.prepare("INSERT INTO plus (account_id, provider_ref, order_ref, status, renews_at, tts_used, tts_limit, period_start, updated_at) VALUES (?, ?, '', ?, NULL, 0, 150000, ?, ?)").run(id, provider, status, periodStart, updated);
const tasks = (env) => env.DB.raw.prepare("SELECT title, status, action_log, output FROM office_tasks WHERE agent_id = 'sales' ORDER BY id").all();

test("Mango is a desk in the Office, with its own playbook", () => {
  const mango = OFFICE_AGENTS.find((a) => a.id === "sales");
  assert.equal(mango.name, "Mango");
  assert.equal(mango.playbook, "ops/agents/mango-plus-sales.md");
});

test("every post in the library passes the public checks, and the checks refuse what they should", () => {
  assert.ok(TIPS.length >= 8);
  assert.equal(new Set(TIPS.map((t) => t.id)).size, TIPS.length, "ids are unique");
  for (const tip of TIPS) assert.deepEqual(lintPublicPost(tip.text), { ok: true, problems: [] }, tip.id);

  const good = TIPS[0].text;
  const bad = (text) => lintPublicPost(text).problems;
  assert.ok(bad("Frills Plus is great.").length, "too short and no price line");
  assert.ok(bad(good.replace(PUBLIC_TAIL, "Frills Plus is $5.99/mo.")).includes("missing the price and refund line"));
  assert.ok(bad(good.replace("Did OBS crash", "Supercharge your stream: did OBS crash")).includes("hype or pressure wording"));
  assert.ok(bad(good + " Limited time only.").includes("hype or pressure wording"));
  assert.ok(bad(good + " Frills Pro is better.").includes("hype or pressure wording"), "Plus is never called Pro");
  assert.ok(bad(good + " Ask @everyone.").includes("mention or markup"));
  assert.ok(bad(good + " <b>now</b>").includes("mention or markup"));
  assert.ok(bad(good.replace(`${"https://frills.valwidgets.live"}/plus/`, "https://evil.example/plus/")).includes("a link that is not on this site"));
  assert.ok(bad(good.replace("Did OBS crash", "Save 99% on time. Did OBS crash")).includes("a number that is not a known fact"), "an invented number");
  assert.ok(bad(good.replace(" https://frills.valwidgets.live/plus/", "")).includes("a link that is not on this site"), "a post with no link is refused too");
  assert.equal(lintPublicPost(null).ok, false);
});

test("the numbers are read: visits, prompts per moment, and the rules that say what to look at", () => {
  const rep = { ok: true, frills: prompts([{ label: "action_limit", n: 40 }, { label: "editor_tip", n: 100 }], [{ label: "action_limit", n: 2 }, { label: "editor_tip", n: 15 }, { label: "checkout", n: 6 }], { clicked: [{ label: "checkout", n: 4 }] }) };
  const f = funnelOf(rep);
  assert.deepEqual([f.visitsWeek, f.copiesWeek, f.liveWeek, f.shown, f.clicked, f.checkout, f.checkoutWeek], [300, 150, 40, 140, 23, 6, 4]);
  assert.deepEqual(f.moments.action_limit, { shown: 40, clicked: 2 });
  assert.equal(funnelOf({ ok: false }), null);
  assert.equal(funnelOf({ ok: true, frills: { error: "unreadable" } }), null);

  const found = insights(metricsOf({ funnel: f, paidOrRenewedWeek: 0 }));
  const keys = found.map((i) => i.key);
  assert.equal(keys.includes("weak-action_limit"), false, "2 of 40 is 5%: not weak");
  assert.ok(keys.includes("strong-editor_tip"), "15 of 100 is 15%: it works");
  assert.equal(keys.includes("checkout-no-sales"), true, "6 checkout clicks (4 this week) and nobody paid");
});

test("insights: weak and strong prompts, a broken checkout, refunds, churn and missing stats", () => {
  const f = funnel({ moments: { action_limit: { shown: 100, clicked: 1 }, editor_tip: { shown: 50, clicked: 8 }, vts_locked: { shown: 5, clicked: 0 } }, checkoutWeek: 4, checkout: 6, shown: 155 });
  const found = insights(metricsOf({ funnel: f, paying: 2, paidOrRenewedWeek: 0 }));
  const by = (k) => found.find((i) => i.key === k);
  assert.equal(by("weak-action_limit").level, "warn");
  assert.match(by("weak-action_limit").text, /seen 100 times and clicked 1 \(1%\)/);
  assert.equal(by("strong-editor_tip").level, "info");
  assert.equal(by("weak-vts_locked"), undefined, "too few views to judge");
  assert.equal(by("checkout-no-sales").level, "alert", "checkout clicked 4 times and nobody paid");
  assert.equal(insights(metricsOf({ funnel: f, paidOrRenewedWeek: 1 })).some((i) => i.key === "checkout-no-sales"), false, "someone paid: no alert");
  assert.equal(insights(metricsOf({ funnel: funnel({ checkoutWeek: 2 }), paidOrRenewedWeek: 0 })).some((i) => i.key === "checkout-no-sales"), false, "two clicks is not a pattern");

  assert.equal(insights(metricsOf({ paying: 4, refundedWeek: 2 })).find((i) => i.key === "refunds-high").level, "alert");
  assert.equal(insights(metricsOf({ paying: 10, refundedWeek: 1, leftWeek: 3 })).find((i) => i.key === "churn").level, "warn");
  assert.equal(insights(metricsOf()).find((i) => i.key === "no-stats").level, "info", "no stats, no crash");
  assert.equal(insights(metricsOf({ funnel: funnel({ visitsWeek: 0 }) })).find((i) => i.key === "no-visits").level, "warn");
});

test("the brief says what the numbers are, in plain words", () => {
  const f = funnel({ shown: 20, clicked: 2, checkout: 1, checkoutWeek: 1, moments: { action_limit: { shown: 20, clicked: 2 } } });
  const text = briefText(metricsOf({ funnel: f, paying: 3, paidOrRenewedWeek: 1, leftWeek: 0 }), insights(metricsOf({ funnel: f })), MON);
  assert.match(text, /Plus funnel, week to 2026-11-30/);
  assert.match(text, /300 visits, 150 links copied, 40 overlays opened/);
  assert.match(text, /20 seen, 2 clicked \(10%\)/);
  assert.match(text, /the free-actions limit: 20 seen, 2 clicked \(10%\)/);
  assert.match(text, /3 paying, 1 paid or renewed in 7 days/);
  assert.match(briefText(metricsOf(), [], MON), /not readable this week[\s\S]*Nothing needs fixing this week/);
});

test("counts: complimentary rows are not customers, and the week windows are right", async () => {
  const env = fresh();
  const old = TUE - 20 * DAY;
  env.DB.raw.prepare("INSERT INTO accounts (id, email, created_at, last_login_at) VALUES ('a1', 'x@example.com', 1, 1), ('a2', 'y@example.com', 1, 1), ('a3', 'z@example.com', 1, 1), ('a4', 'w@example.com', 1, 1)").run();
  addPlus(env, "a1", { provider: "sub_1", status: "active", periodStart: TUE - 2 * DAY, updated: TUE - 2 * DAY });
  addPlus(env, "a2", { provider: "sub_2", status: "active", periodStart: old, updated: old });
  addPlus(env, "a3", { provider: "", status: "active", periodStart: TUE - DAY, updated: TUE - DAY }); // a complimentary grant
  addPlus(env, "a4", { provider: "sub_4", status: "refunded", periodStart: old, updated: TUE - DAY });
  assert.deepEqual(await plusCounts(env.DB, TUE), { accounts: 4, paying: 2, paidOrRenewedWeek: 1, leftWeek: 1, refundedWeek: 1 });
  assert.deepEqual(await plusCounts({ prepare() { throw new Error("db down"); } }, TUE), { accounts: 0, paying: 0, paidOrRenewedWeek: 0, leftWeek: 0, refundedWeek: 0 }, "a failing database gives zeros, not a crash");
});

test("planning: the brief on Mondays only, once; alerts on any day, not repeated for 3 days; the tip on Thursdays only", () => {
  const env = { DISCORD_ANNOUNCE_WEBHOOK: PUBLIC_HOOK };
  const plan = (now, found = [], history = [], e = env) => planPlays({ now, metrics: metricsOf(), found, history, env: e });
  assert.deepEqual(plan(TUE).map((p) => p.title), [], "a Tuesday with nothing wrong: nothing to do");
  assert.deepEqual(plan(MON).map((p) => p.title), ["[Mango] Weekly brief 2026-11-30"]);
  assert.deepEqual(plan(MON, [], [{ title: "[Mango] Weekly brief 2026-11-30", created_at: MON }]).map((p) => p.title), [], "not twice the same day");
  assert.equal(plan(THU).map((p) => p.channel).join(), "announce", "a Thursday: the public tip");

  const alert = [{ level: "alert", key: "checkout-no-sales", text: "bad" }];
  assert.equal(plan(TUE, alert)[0].priority, "urgent");
  assert.deepEqual(plan(TUE + DAY, alert, [{ title: "[Mango] Alert: checkout-no-sales 2026-11-24", created_at: TUE }]).map((p) => p.title), [], "the same alert a day later is not repeated");
  assert.equal(plan(TUE + 4 * DAY, alert, [{ title: "[Mango] Alert: checkout-no-sales 2026-11-24", created_at: TUE }]).length, 1, "after 3 days it may repeat");
  assert.equal(plan(TUE, [{ level: "warn", key: "churn", text: "x" }]).length, 0, "a warning goes in the weekly brief, not in an alert");
});

test("the public tip: needs the public channel, once a week, in turn, and never off", () => {
  const on = { DISCORD_ANNOUNCE_WEBHOOK: PUBLIC_HOOK };
  const plan = (now, history, env = on) => planPlays({ now, metrics: metricsOf(), found: [], history, env });
  assert.equal(plan(THU, [], {}).length, 0, "no public channel: no tip");
  assert.equal(plan(THU, [], { DISCORD_ANNOUNCE_WEBHOOK: "https://evil.example/hook" }).length, 0, "only a real Discord webhook counts");
  assert.equal(plan(THU, [], { ...on, PLUS_AGENT_PUBLIC: "off" }).length, 0, "the public switch");

  const first = plan(THU, [])[0];
  assert.equal(first.title, `[Mango] Plus tip: ${TIPS[0].id} 2026-11-26`);
  assert.equal(first.text, TIPS[0].text);
  assert.equal(plan(THU + 3600_000, [{ title: first.title, created_at: THU }]).length, 0, "not twice in a week");
  const next = plan(THU2, [{ title: first.title, created_at: THU }])[0];
  assert.equal(next.title, `[Mango] Plus tip: ${TIPS[1].id} 2026-12-03`, "next week, the next one");

  // after the whole library, it starts again, and never repeats the last one straight away
  const all = TIPS.map((t, i) => ({ title: `[Mango] Plus tip: ${t.id} d${i}`, created_at: THU - (TIPS.length - i) * 7 * DAY })).reverse();
  assert.equal(plan(THU, all)[0].text, TIPS[0].text, "round again from the oldest");
});

test("a library post that fails its checks is never sent: the owner is told instead", () => {
  const saved = TIPS[0].text;
  TIPS[0].text = saved.replace("Did OBS crash", "Supercharge your stream: did OBS crash");
  try {
    const plays = planPlays({ now: THU, metrics: metricsOf(), found: [], history: [], env: { DISCORD_ANNOUNCE_WEBHOOK: PUBLIC_HOOK } });
    assert.deepEqual(plays.map((p) => [p.channel, p.alert]), [["office", true]], "a private alert, no public post");
    assert.match(plays[0].text, /hype or pressure wording/);
  } finally {
    TIPS[0].text = saved;
  }
});

test("a run: the Monday brief goes to the private channel and is written to the Office, once", async () => {
  const env = fresh({ DISCORD_OFFICE_WEBHOOK: OFFICE_HOOK });
  const fetchImpl = discord();
  const loadReport = reportWith(prompts([], []));
  const first = await runPlusAgent(env, { now: MON, fetchImpl, loadReport });
  assert.equal(first.ran, true);
  assert.equal(first.plays.length, 1);
  assert.equal(fetchImpl.posts.length, 1);
  assert.equal(fetchImpl.posts[0].url, OFFICE_HOOK);
  assert.deepEqual(fetchImpl.posts[0].body.allowed_mentions, { parse: [] }, "it can never ping anyone");
  assert.match(fetchImpl.posts[0].body.embeds[0].description, /Plus funnel, week to 2026-11-30/);
  const rows = tasks(env);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].title, rows[0].status], ["[Mango] Weekly brief 2026-11-30", "done"]);
  assert.match(rows[0].action_log, /^Posted to #founder-ops/);

  const second = await runPlusAgent(env, { now: MON + 3600_000, fetchImpl, loadReport });
  assert.equal(second.plays.length, 0, "run again the same day: nothing new");
  assert.equal(fetchImpl.posts.length, 1);
  const agent = env.DB.raw.prepare("SELECT status, current_task FROM office_agents WHERE id = 'sales'").get();
  assert.deepEqual([agent.status, agent.current_task], ["idle", "Watching the Plus funnel"]);
});

test("a run: Thursday's tip is a plain public post with no mentions; a broken checkout raises an alert on the desk", async () => {
  const env = fresh({ DISCORD_OFFICE_WEBHOOK: OFFICE_HOOK, DISCORD_ANNOUNCE_WEBHOOK: PUBLIC_HOOK });
  const fetchImpl = discord();
  const broken = reportWith({ ...prompts([{ label: "action_limit", n: 30 }], [{ label: "checkout", n: 6 }], { clicked: [{ label: "checkout", n: 5 }] }) });
  const run = await runPlusAgent(env, { now: THU, fetchImpl, loadReport: broken });
  assert.equal(run.plays.length, 2);
  const pub = fetchImpl.posts.find((p) => p.url === PUBLIC_HOOK);
  assert.equal(pub.body.content, TIPS[0].text);
  assert.equal(pub.body.embeds, undefined, "the public post is plain text");
  assert.deepEqual(pub.body.allowed_mentions, { parse: [] });
  const alert = fetchImpl.posts.find((p) => p.url === OFFICE_HOOK);
  assert.match(alert.body.embeds[0].title, /Alert: checkout-no-sales/);
  assert.equal(alert.body.embeds[0].color, 0xf43f5e);
  const agent = env.DB.raw.prepare("SELECT status, current_task FROM office_agents WHERE id = 'sales'").get();
  assert.equal(agent.status, "alert");
  assert.match(agent.current_task, /nobody has paid/);
});

test("with no Discord set up it only writes to the Office; a failing Discord is recorded, never thrown", async () => {
  const bare = fresh();
  const none = discord();
  await runPlusAgent(bare, { now: MON, fetchImpl: none, loadReport: reportWith(prompts([], [])) });
  assert.equal(none.posts.length, 0);
  assert.match(tasks(bare)[0].action_log, /Logged here only \(set DISCORD_OFFICE_WEBHOOK/);

  const env = fresh({ DISCORD_OFFICE_WEBHOOK: OFFICE_HOOK });
  const down = discord({ ok: false });
  const run = await runPlusAgent(env, { now: MON, fetchImpl: down, loadReport: reportWith(prompts([], [])) });
  assert.equal(run.ran, true);
  assert.match(tasks(env)[0].action_log, /^Could not post to #founder-ops/);
  const dead = async () => { throw new Error("network"); };
  assert.equal((await runPlusAgent(fresh({ DISCORD_OFFICE_WEBHOOK: OFFICE_HOOK }), { now: MON, fetchImpl: dead, loadReport: async () => { throw new Error("cloudflare down"); } })).ran, true, "stats and Discord both down: still runs");
});

test("the switches: PLUS_AGENT=off stops everything, PLUS_AGENT_PUBLIC=off stops only the public post, no database is no crash", async () => {
  const hooks = { DISCORD_OFFICE_WEBHOOK: OFFICE_HOOK, DISCORD_ANNOUNCE_WEBHOOK: PUBLIC_HOOK };
  const off = fresh({ ...hooks, PLUS_AGENT: "off" });
  const sent = discord();
  assert.deepEqual(await runPlusAgent(off, { now: MON, fetchImpl: sent, loadReport: reportWith(prompts([], [])) }), { ran: false, reason: "off", plays: [] });
  assert.equal(sent.posts.length, 0);
  assert.equal(off.DB.raw.prepare("SELECT COUNT(*) AS n FROM office_tasks").get().n, 0, "switched off: it writes nothing at all");

  const quiet = fresh({ ...hooks, PLUS_AGENT_PUBLIC: "off" });
  const posts = discord();
  await runPlusAgent(quiet, { now: THU, fetchImpl: posts, loadReport: reportWith(prompts([], [])) });
  assert.equal(posts.posts.filter((p) => p.url === PUBLIC_HOOK).length, 0);

  assert.deepEqual(await runPlusAgent({}, { now: MON }), { ran: false, reason: "no_db", plays: [] });
  assert.equal((await runPlusAgent({ DB: { prepare() { throw new Error("broken"); } } }, { now: MON })).reason, "error", "a broken database: reported, not thrown");
});
