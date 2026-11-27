// Mango, the Frills Plus sales agent. It runs by itself on the Worker's daily schedule and nobody approves what it does, so what keeps it safe is built in and
// cannot be skipped:
//   - It only speaks on channels the owner owns (the private #founder-ops and the public #announcements webhooks), and never contacts anyone else.
//   - Anything public comes from a library of posts (TIPS) that were read and agreed once. Nothing is written freely at run time, and every post must still pass
//     lintPublicPost (no hype words, the exact price and refund line, only true numbers, only links to this site) or it is not sent.
//   - What it does with numbers is private: a weekly brief, and alerts when the checkout looks broken or refunds are high.
//   - It never changes a price, a discount, a page or a setting, and it never uses an email address.
//   - One switch turns it off: set the PLUS_AGENT secret to "off". PLUS_AGENT_PUBLIC="off" keeps the public posts off but leaves the private ones on.
// Everything it does is written to the Office as a task, so the owner can read what it did after the fact.

import { report } from "./stats-report.mjs";
import { AGENT_BY_ID, ensureOfficeTables, validDiscordWebhook } from "./office.mjs";

const DAY = 86_400_000;
const MAX_PLAYS_PER_RUN = 3;

export const SITE = "https://frills.valwidgets.live";
/** The line that ends every public post: the real price, the real refund promise, and the promise that free stays free. */
export const PUBLIC_TAIL = "Frills Plus is $5.99/mo with a 14-day full refund, and free Frills stays free.";

/** The public posts, one a week in turn. Every claim here is on the Frills Plus page already. Change the words here, in a commit, not at run time. */
export const TIPS = [
  { id: "crash-proof", text: `Did OBS crash in the middle of a subathon? Frills Plus backs up your timer, gift jar and goal totals to the cloud, so a crash or a PC restart does not reset them. ${PUBLIC_TAIL} ${SITE}/plus/` },
  { id: "one-link", text: `One link for your whole stream scene. Frills Plus combines your chat, alerts, gift jar, goals and timer into a single OBS or TikTok LIVE Studio source, in 16:9 or 9:16. ${PUBLIC_TAIL} ${SITE}/plus/` },
  { id: "theme-sync", text: `Change your whole look in one click. With Frills Plus you save up to 50 permanent links and switch every open OBS source to a new theme without pasting a link again. ${PUBLIC_TAIL} ${SITE}/plus/` },
  { id: "phone-deck", text: `Run your stream from your phone. Frills Plus lets you start, pause or add time to your subathon timer, fire test alerts and bump your goals from your account page. ${PUBLIC_TAIL} ${SITE}/plus/` },
  { id: "actions", text: `Past 10 free rules in Actions? Frills Plus removes the limit and adds custom sticky-note shapes and the full VTube Studio controls. ${PUBLIC_TAIL} ${SITE}/actions/` },
  { id: "ai-voices", text: `Give your talking pet a natural voice. Frills Plus adds 150,000 AI voice characters a month, about 3,000 messages, and your own mascot pictures. The free browser voices stay free. ${PUBLIC_TAIL} ${SITE}/tts/` },
  { id: "tiktok-connection", text: `Free TikTok overlays share a community relay that can queue when it is busy. Frills Plus gives yours its own always-on connection that falls back to the free one. ${PUBLIC_TAIL} ${SITE}/plus/` },
  { id: "vip-alerts", text: `Make your biggest moments look big. Frills Plus adds golden VIP spotlights with your own GIFs and sounds for big cheers and sub bombs. ${PUBLIC_TAIL} ${SITE}/alerts/` },
  { id: "recap", text: `End every stream with a recap card. Frills Plus fills in your top gifter, top liker and goal progress, and you download the picture to post. ${PUBLIC_TAIL} ${SITE}/plus/` },
];

// ── The checks every public post has to pass ────────────────────────────────────────────────────────────────

/** Words and phrases that are hype, pressure or a claim nobody can back up. */
const BANNED = /\b(revolutioni[sz]e|supercharge|unleash|seamless(ly)?|empower|elevate|game[- ]changing|cutting[- ]edge|limited[- ]time|act now|hurry|do not miss|don'?t miss|last chance|guaranteed?|best[- ]in|number one|10x|pro)\b|#1/i;
/** Every number a public post may contain; they are all facts from the Frills Plus page. */
const ALLOWED_NUMBERS = new Set(["5.99", "14", "50", "10", "150,000", "3,000", "16:9", "9:16"]);
const LINK = /^https:\/\/frills\.valwidgets\.live\/[a-z0-9\-/]*$/;

/** Whether a public post may be sent. `problems` says why not. */
export function lintPublicPost(text) {
  const problems = [];
  const t = typeof text === "string" ? text : "";
  if (t.length < 60 || t.length > 700) problems.push("length");
  if (!t.includes("Frills Plus")) problems.push("does not say Frills Plus");
  if (!t.includes(PUBLIC_TAIL)) problems.push("missing the price and refund line");
  if (BANNED.test(t)) problems.push("hype or pressure wording");
  if (/[@<>]/.test(t)) problems.push("mention or markup");
  const links = t.match(/https?:\/\/\S+/g) ?? [];
  if (!links.length || links.some((l) => !LINK.test(l.replace(/[.,;:!?)]+$/, "")))) problems.push("a link that is not on this site");
  const numbers = (t.replace(/https?:\/\/\S+/g, " ").match(/\d[\d,.:]*/g) ?? []).map((n) => n.replace(/[.,:]+$/, ""));
  if (numbers.some((n) => !ALLOWED_NUMBERS.has(n))) problems.push("a number that is not a known fact");
  return { ok: problems.length === 0, problems };
}

// ── What it looks at ────────────────────────────────────────────────────────────────────────────────────────

const MOMENT_LABELS = {
  action_limit: "the free-actions limit",
  vts_locked: "the sticker and VTube Studio note",
  editor_tip: "the tip under an editor",
  copy_nudge: "the post-copy live link nudge",
  outline_plus: "the Stream Outline Plus preview",
  tts_voice: "the Talking Pet AI voice lock",
  checkout: "the checkout button",
};
const pct = (num, den) => (den > 0 ? `${Math.round((num / den) * 100)}%` : "n/a");

/** The Plus rows, counted. Rows with no payment provider (a complimentary grant) are not customers and are left out. */
export async function plusCounts(db, now) {
  const week = now - 7 * DAY;
  const zero = { accounts: 0, paying: 0, paidOrRenewedWeek: 0, leftWeek: 0, refundedWeek: 0 };
  try {
    const plus = await db.prepare(
      `SELECT
         SUM(CASE WHEN provider_ref != '' AND status = 'active' THEN 1 ELSE 0 END) AS paying,
         SUM(CASE WHEN provider_ref != '' AND status = 'active' AND period_start >= ? THEN 1 ELSE 0 END) AS paid_week,
         SUM(CASE WHEN provider_ref != '' AND status IN ('canceled', 'expired', 'refunded', 'unpaid') AND updated_at >= ? THEN 1 ELSE 0 END) AS left_week,
         SUM(CASE WHEN provider_ref != '' AND status = 'refunded' AND updated_at >= ? THEN 1 ELSE 0 END) AS refunded_week
       FROM plus`,
    ).bind(week, week, week).first();
    const accounts = await db.prepare("SELECT COUNT(*) AS n FROM accounts").first();
    return {
      accounts: Number(accounts?.n) || 0,
      paying: Number(plus?.paying) || 0,
      paidOrRenewedWeek: Number(plus?.paid_week) || 0,
      leftWeek: Number(plus?.left_week) || 0,
      refundedWeek: Number(plus?.refunded_week) || 0,
    };
  } catch {
    return zero;
  }
}

/** The funnel numbers out of the stats report, or null when the report could not be read. */
export function funnelOf(rep) {
  const f = rep?.frills;
  if (!rep?.ok || !f || f.error) return null;
  const moments = {};
  for (const r of f.prompts?.shown ?? []) moments[r.label] = { shown: r.n, clicked: 0 };
  for (const r of f.prompts?.clicked ?? []) {
    moments[r.label] = moments[r.label] ?? { shown: 0, clicked: 0 };
    moments[r.label].clicked = r.n;
  }
  return {
    visitsWeek: f.visits?.week ?? 0,
    copiesWeek: f.copies?.week ?? 0,
    liveWeek: f.loads?.live?.week ?? 0,
    shown: f.prompts?.shownTotal ?? 0,
    clicked: f.prompts?.clickedTotal ?? 0,
    checkout: moments.checkout?.clicked ?? 0,
    checkoutWeek: (f.prompts?.clickedWeek ?? []).find((r) => r.label === "checkout")?.n ?? 0,
    moments,
  };
}

export async function collectMetrics(env, { now, fetchImpl, loadReport = report }) {
  const counts = await plusCounts(env.DB, now);
  let funnel = null;
  try { funnel = funnelOf(await loadReport(env, { now, fetchImpl })); } catch { funnel = null; }
  return { ...counts, funnel };
}

/** What the numbers say, as plain sentences. `alert` means something may be broken now; `warn` means worth a look this week; `info` is context. */
export function insights(m) {
  const out = [];
  const f = m.funnel;
  if (!f) {
    out.push({ level: "info", key: "no-stats", text: "The traffic numbers could not be read (Cloudflare analytics), so only the subscriber counts are in this brief." });
  } else {
    if (f.visitsWeek === 0) out.push({ level: "warn", key: "no-visits", text: "No visits were counted in the last 7 days. Either nobody came, or the counter is broken: open the site with Do Not Track off and check the stats page." });
    if (f.shown === 0 && f.visitsWeek > 0) out.push({ level: "info", key: "no-prompts", text: "No Plus prompt has been seen in 28 days. They only show to visitors in the sales regions who reach a limit or open an editor, so this usually just means too little traffic yet." });
    for (const [moment, v] of Object.entries(f.moments)) {
      if (moment === "checkout" || v.shown < 20) continue;
      const rate = v.clicked / v.shown;
      const label = MOMENT_LABELS[moment] ?? moment;
      if (rate < 0.02) out.push({ level: "warn", key: `weak-${moment}`, text: `${label} was seen ${v.shown} times and clicked ${v.clicked} (${pct(v.clicked, v.shown)}). Its words are the cheapest thing to change.` });
      else if (rate >= 0.1) out.push({ level: "info", key: `strong-${moment}`, text: `${label} works: seen ${v.shown} times, clicked ${v.clicked} (${pct(v.clicked, v.shown)}). Show it in more places.` });
    }
    if (f.checkoutWeek >= 3 && m.paidOrRenewedWeek === 0) {
      out.push({ level: "alert", key: "checkout-no-sales", text: `The checkout button was clicked ${f.checkoutWeek} times this week and nobody has paid in 7 days. Do a test purchase and check that Polar's webhook deliveries are succeeding.` });
    }
    if (f.copiesWeek < 100) out.push({ level: "info", key: "traffic", text: `Only ${f.copiesWeek} overlay links were copied this week. Traffic is the biggest lever on Plus sales, more than any wording.` });
  }
  if (m.refundedWeek >= 2 || (m.paying > 0 && m.refundedWeek / m.paying > 0.3)) {
    out.push({ level: "alert", key: "refunds-high", text: `${m.refundedWeek} refunds in 7 days against ${m.paying} paying subscribers. Read the refund reasons in Polar and check that the setup steps on the account page work.` });
  } else if (m.leftWeek >= 2) {
    out.push({ level: "warn", key: "churn", text: `${m.leftWeek} subscribers cancelled or lapsed in 7 days. Ask them why: Polar's cancellation reasons are in its dashboard.` });
  }
  return out;
}

export function briefText(m, found, now) {
  const f = m.funnel;
  const lines = [`Plus funnel, week to ${new Date(now).toISOString().slice(0, 10)} (UTC)`, ""];
  if (f) {
    lines.push(`Traffic, 7 days: ${f.visitsWeek} visits, ${f.copiesWeek} links copied, ${f.liveWeek} overlays opened on a real account.`);
    lines.push(`Plus prompts, 28 days: ${f.shown} seen, ${f.clicked} clicked (${pct(f.clicked, f.shown)}).`);
    for (const [moment, v] of Object.entries(f.moments)) if (moment !== "checkout") lines.push(`  ${MOMENT_LABELS[moment] ?? moment}: ${v.shown} seen, ${v.clicked} clicked (${pct(v.clicked, v.shown)})`);
    lines.push(`Checkout button, 28 days: ${f.checkout} clicks (${f.checkoutWeek} this week).`);
  } else {
    lines.push("Traffic numbers: not readable this week.");
  }
  lines.push(`Frills Plus: ${m.paying} paying, ${m.paidOrRenewedWeek} paid or renewed in 7 days, ${m.leftWeek} left in 7 days (${m.refundedWeek} refunded), ${m.accounts} accounts in all.`);
  lines.push("", "What to look at:");
  if (!found.length) lines.push("- Nothing needs fixing this week.");
  for (const i of found) lines.push(`- ${i.text}`);
  return lines.join("\n");
}

// ── What it decides to do today ─────────────────────────────────────────────────────────────────────────────

const stamp = (now) => new Date(now).toISOString().slice(0, 10);

/**
 * The plays for today, none that have already been done. `history` is the agent's own recent tasks (newest first). Plays carry everything needed to
 * send them; a public play is only planned when its channel is set up and its text passes lintPublicPost.
 */
export function planPlays({ now, metrics, found, history, env }) {
  const plays = [];
  const day = new Date(now).getUTCDay(); // 0 is Sunday
  const done = (title) => history.some((h) => h.title === title);

  // 1. Mondays: the brief, to the private channel.
  const briefTitle = `[Mango] Weekly brief ${stamp(now)}`;
  if (day === 1 && !done(briefTitle)) {
    plays.push({ title: briefTitle, kind: "ops", priority: "normal", channel: "office", embed: true, why: "Weekly look at the Plus funnel.", text: briefText(metrics, found, now) });
  }

  // 2. Any day: an alert when something may be broken, at most once every 3 days for the same problem.
  for (const item of found.filter((i) => i.level === "alert")) {
    const title = `[Mango] Alert: ${item.key} ${stamp(now)}`;
    const recent = history.some((h) => h.title.startsWith(`[Mango] Alert: ${item.key} `) && now - h.created_at < 3 * DAY);
    if (!recent && !done(title)) plays.push({ title, kind: "ops", priority: "urgent", channel: "office", embed: true, alert: true, why: "Something in the Plus funnel may be broken.", text: item.text });
  }

  // 3. Thursdays: one public tip from the library, if the public channel is set up, it was not used lately, and it passes the checks.
  const publicOn = String(env?.PLUS_AGENT_PUBLIC ?? "").toLowerCase() !== "off" && Boolean(validDiscordWebhook(env?.DISCORD_ANNOUNCE_WEBHOOK));
  const tipTitles = history.filter((h) => h.title.startsWith("[Mango] Plus tip: "));
  const postedThisWeek = tipTitles.some((h) => now - h.created_at < 6 * DAY);
  if (day === 4 && publicOn && !postedThisWeek) {
    const recentIds = tipTitles.slice(0, TIPS.length - 1).map((h) => h.title.slice("[Mango] Plus tip: ".length).split(" ")[0]);
    const tip = TIPS.find((t) => !recentIds.includes(t.id));
    if (tip) {
      const checked = lintPublicPost(tip.text);
      if (checked.ok) {
        plays.push({ title: `[Mango] Plus tip: ${tip.id} ${stamp(now)}`, kind: "outreach", priority: "normal", channel: "announce", embed: false, why: "This week's Plus tip for the public channel.", text: tip.text });
      } else {
        const title = `[Mango] Alert: tip-blocked ${stamp(now)}`;
        if (!done(title)) plays.push({ title, kind: "ops", priority: "high", channel: "office", embed: true, alert: true, why: "A library post failed its checks.", text: `The post "${tip.id}" was not sent because it failed the checks (${checked.problems.join(", ")}). Fix its words in worker/plus-agent.mjs.` });
      }
    }
  }
  return plays;
}

// ── Doing it ────────────────────────────────────────────────────────────────────────────────────────────────

async function postDiscord(url, payload, fetchImpl) {
  const safe = validDiscordWebhook(url);
  if (!safe || typeof fetchImpl !== "function") return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    // allowed_mentions with nothing in it: a post can never ping @everyone, a role or a person
    const res = await fetchImpl(safe, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }), signal: ctrl.signal });
    return Boolean(res?.ok);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function perform(env, play, now, fetchImpl) {
  const agent = AGENT_BY_ID.get("sales");
  const inserted = await env.DB.prepare(
    "INSERT INTO office_tasks (agent_id, title, body, output, kind, priority, status, source, feedback_id, action_log, created_at, updated_at) VALUES ('sales', ?, ?, ?, ?, ?, 'working', 'schedule', NULL, '', ?, ?) RETURNING id",
  ).bind(play.title.slice(0, 120), play.why, play.text.slice(0, 8000), play.kind, play.priority, now, now).first();
  const id = Number(inserted?.id) || 0;

  const secret = play.channel === "announce" ? env?.DISCORD_ANNOUNCE_WEBHOOK : env?.DISCORD_OFFICE_WEBHOOK;
  const channelName = play.channel === "announce" ? "#announcements" : "#founder-ops";
  let receipt;
  if (!validDiscordWebhook(secret)) {
    receipt = `Logged here only (set ${play.channel === "announce" ? "DISCORD_ANNOUNCE_WEBHOOK" : "DISCORD_OFFICE_WEBHOOK"} to send it to ${channelName})`;
  } else {
    const payload = play.embed
      ? { username: `${agent.name} · Frills HQ`, embeds: [{ title: play.title.slice(0, 250), description: play.text.slice(0, 3800), color: play.alert ? 0xf43f5e : agent.embedColor, footer: { text: `Frills Virtual Office · ${agent.role} · ${channelName}` }, timestamp: new Date(now).toISOString() }] }
      : { username: "Frills", content: play.text };
    const ok = await postDiscord(secret, payload, fetchImpl);
    receipt = ok ? `Posted to ${channelName}` : `Could not post to ${channelName}`;
  }
  await env.DB.prepare("UPDATE office_tasks SET status = 'done', action_log = ?, updated_at = ? WHERE id = ?")
    .bind(`${receipt} (${new Date(now).toISOString().slice(11, 16)} UTC)`.slice(0, 320), now, id).run();
  return { title: play.title, receipt, alert: Boolean(play.alert) };
}

/**
 * One run, called by the Worker's schedule. It never throws: a failure here must not take the scheduled job down with it.
 * `loadReport` is only for tests.
 */
export async function runPlusAgent(env, { now = Date.now(), fetchImpl = globalThis.fetch?.bind(globalThis), loadReport = report } = {}) {
  const result = { ran: false, reason: "", plays: [] };
  try {
    if (String(env?.PLUS_AGENT ?? "").toLowerCase() === "off") return { ...result, reason: "off" };
    if (!env?.DB) return { ...result, reason: "no_db" };
    await ensureOfficeTables(env.DB, now);

    const rows = (await env.DB.prepare("SELECT title, created_at FROM office_tasks WHERE agent_id = 'sales' AND created_at >= ? ORDER BY id DESC LIMIT 200").bind(now - 90 * DAY).all()).results ?? [];
    const metrics = await collectMetrics(env, { now, fetchImpl, loadReport });
    const found = insights(metrics);
    const plays = planPlays({ now, metrics, found, history: rows.map((r) => ({ title: String(r.title), created_at: Number(r.created_at) })), env });

    for (const play of plays.slice(0, MAX_PLAYS_PER_RUN)) {
      try { result.plays.push(await perform(env, play, now, fetchImpl)); } catch { result.plays.push({ title: play.title, receipt: "error", alert: false }); }
    }

    const alerting = found.some((i) => i.level === "alert");
    const summary = result.plays.length ? result.plays.map((p) => p.title.replace("[Mango] ", "")).join("; ") : "Nothing to do today";
    await env.DB.prepare("UPDATE office_agents SET status = ?, current_task = ?, last_summary = ?, last_run_at = ?, updated_at = ? WHERE id = 'sales'")
      .bind(alerting ? "alert" : "idle", alerting ? found.find((i) => i.level === "alert").text.slice(0, 120) : "Watching the Plus funnel", summary.slice(0, 300), now, now).run();
    return { ...result, ran: true };
  } catch {
    return { ...result, reason: "error" };
  }
}
