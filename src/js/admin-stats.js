// The private stats page (/admin/stats/): the numbers for Frills and valwidgets.live, read by the Worker from Cloudflare (worker/stats-report.mjs) and drawn here.
// It uses the admin password (kept in this tab's session storage, the same place the admin page keeps it), and everything is put in with textContent, never as HTML.

import { el } from "./feed.js";

const $ = (id) => document.getElementById(id);
const KEY = "frills:admin:key";

let key = "";
try { key = sessionStorage.getItem(KEY) ?? ""; } catch { /* storage can be blocked; the password is then asked for each visit */ }

class Wrong extends Error {}

async function load() {
  let res;
  try {
    res = await fetch("/api/admin/stats", { headers: { authorization: `Bearer ${key}` }, cache: "no-store" });
  } catch {
    throw new Wrong("Could not reach the server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  if (res.status === 401) { logout("That is not the right password."); throw new Wrong("That is not the right password."); }
  if (res.status === 429) throw new Wrong("Too many wrong tries. Wait ten minutes, then try again.");
  if (res.status === 503 && data.error === "admin_off") throw new Wrong("The admin side is switched off. Set the ADMIN_KEY secret in Cloudflare (12 or more characters) and try again.");
  throw new Wrong("Something went wrong (" + res.status + ").");
}

const say = (node, text, bad = false) => { node.textContent = text; node.dataset.state = bad ? "error" : ""; };
const number = (n) => Math.round(n || 0).toLocaleString("en-US");
const pct = (rate) => (rate === null || rate === undefined ? "—" : Math.round(rate * 100) + "%");

/** Returns { text, tone } for a week-over-week comparison badge. */
function deltaBadge(week, before) {
  if (!before) return week ? { text: "NEW vs prev 7d", tone: "up" } : { text: "0 prev 7d", tone: "flat" };
  const diff = Math.round(((week - before) / before) * 100);
  if (diff === 0) return { text: "0% vs prev 7d", tone: "flat" };
  return {
    text: `${diff > 0 ? "▲ +" : "▼ "}${diff}% vs prev 7d`,
    tone: diff > 0 ? "up" : "down",
  };
}

const NAMES = {
  chat: "Chat Box",
  alerts: "Alerts",
  gifts: "Last Gifts",
  goal: "Stream Goals",
  likers: "Top Likers",
  songs: "Song Requests (!sr)",
  matcha: "Matcha Theme",
  home: "Home Page (/)",
  editor: "Chat Editor (/editor/)",
  overlays: "Overlays Hub (/overlays/)",
  start: "Quick Start (/start/)",
  guides: "Guides & Looks",
  other: "Other Pages",
  overlay: "Overlay Page",
  rank: "Rank Page",
  mastery: "Mastery Page",
  "valorant-rank": "Rank Overlay",
  "valorant-mastery": "Mastery Overlay",
  direct: "Direct / Bookmark",
  tiktok: "TikTok",
  twitch: "Twitch",
  both: "TikTok + Twitch (Dual)",
  reddit: "Reddit",
  discord: "Discord",
  youtube: "YouTube",
  search: "Google / Search",
  bio: "Profile Bio Link",
  ad1: "Ad Campaign 1",
  ad2: "Ad Campaign 2",
  ad3: "Ad Campaign 3",
  remote_link: "Remote-Control Link (Live OBS Update)",
  custom_upload: "Custom Sound & Sticker Kit",
  scene_link: "All-in-One Scene Link",
  plus_pack: "Collector Art Packs",
};
const nameOf = (label) => NAMES[label] ?? label;

function kpiCard(title, big, badge, metaItems) {
  const pill = el("span", { className: "stats__delta", textContent: badge.text });
  pill.dataset.tone = badge.tone;
  const top = el("div", { className: "stats__card-top" }, el("span", { className: "stats__label", textContent: title }), pill);
  const meta = el(
    "div",
    { className: "stats__meta" },
    ...metaItems.map(([k, v]) => el("span", { className: "stats__meta-item" }, el("span", { textContent: k + ": " }), el("b", { textContent: v }))),
  );
  return el("div", { className: "stats__card" }, top, el("b", { className: "stats__big", textContent: big }), meta);
}

/** Visual 3-stage conversion funnel (7d & 28d): Visits -> Links Copied -> Live Overlay Loads. */
function funnelSection(visits, copies, loads, funnel) {
  const wVisits = visits.week || 0;
  const wCopies = copies.week || 0;
  const wLive = loads.live.week || 0;
  const mVisits = visits.total || 0;
  const mCopies = copies.total || 0;
  const mLive = loads.live.total || 0;

  const stage = (step, label, count7d, rate7d, barPct, sub28d) => {
    const fill = el("i", {});
    fill.style.width = Math.max(3, Math.min(100, Math.round(barPct))) + "%";
    return el(
      "div",
      { className: "stats__funnel-step" },
      el(
        "div",
        { className: "stats__funnel-head" },
        el("span", { className: "stats__funnel-title" }, el("b", { textContent: `${step}. ` }), el("span", { textContent: label })),
        el("span", { className: "stats__funnel-nums" }, el("b", { textContent: number(count7d) }), el("span", { className: "stats__funnel-rate", textContent: rate7d })),
      ),
      el("div", { className: "stats__funnel-track" }, fill),
      el("span", { className: "stats__funnel-sub", textContent: sub28d }),
    );
  };

  const copyBar = wVisits > 0 ? (wCopies / wVisits) * 100 : 0;
  const liveBar = wVisits > 0 ? Math.min(100, (wLive / wVisits) * 100) : 0;

  return el(
    "div",
    { className: "stats__panel" },
    el(
      "div",
      { className: "stats__panel-head" },
      el("h3", { className: "stats__panel-title", textContent: "Conversion Funnel (Last 7 Days vs. 28 Days)" }),
      el("span", { className: "stats__panel-sub", textContent: "Visitor → Copy URL → Open in OBS" }),
    ),
    el(
      "div",
      { className: "stats__funnel-grid" },
      stage("1", "Site Visits", wVisits, "100%", 100, `28d total: ${number(mVisits)} visits`),
      stage("2", "Overlay Links Copied", wCopies, `${pct(funnel?.week?.copyRate)} of visits`, copyBar, `28d: ${number(mCopies)} copied (${pct(funnel?.month?.copyRate)} of visits)`),
      stage("3", "Live Stream Loads (OBS)", wLive, `${pct(funnel?.week?.liveRate)} per copy`, liveBar, `28d: ${number(mLive)} live loads (${number(loads.demo.total)} demo/preview loads)`),
    ),
  );
}

/** Interactive 28-day daily bar chart with tabs for Visits, Links Copied, and Live Stream Loads. */
function dailyChartSection(visits, copies, loads) {
  const seriesList = [
    { id: "visits", label: "Site Visits", data: visits.perDay ?? [] },
    { id: "copies", label: "Links Copied", data: copies.perDay ?? [] },
    { id: "live", label: "Live Stream Loads", data: loads.livePerDay ?? [] },
  ].filter((s) => s.data.length > 0);

  const summaryNode = el("span", { className: "stats__panel-sub" });
  const box = el("div", { className: "stats__bars" });
  box.setAttribute("role", "img");
  const tabsWrap = el("div", { className: "stats__chart-tabs" });

  function renderSeries(series) {
    const pts = series.data;
    const sum = pts.reduce((a, d) => a + d.n, 0);
    const avg = pts.length ? Math.round(sum / pts.length) : 0;
    const peak = pts.reduce((best, d) => (d.n > best.n ? d : best), { day: "—", n: 0 });
    const top = Math.max(1, peak.n);

    box.setAttribute("aria-label", `${series.label} per day, the last 28 days`);
    summaryNode.textContent = `28d Total: ${number(sum)} · Daily Avg: ${number(avg)}/day · Peak: ${number(peak.n)} (${peak.day.slice(5)})`;

    box.replaceChildren();
    pts.forEach(({ day, n }, idx) => {
      const isToday = idx === pts.length - 1;
      const bar = el("i", { title: `${day}${isToday ? " (Today)" : ""}: ${number(n)} ${series.label.toLowerCase()}` });
      if (isToday) bar.dataset.today = "true";
      bar.style.height = (n === 0 ? 3 : Math.max(8, Math.round((n / top) * 100))) + "%";
      if (n === 0) bar.dataset.zero = "true";
      box.append(bar);
    });
  }

  seriesList.forEach((s, i) => {
    const btn = el("button", { type: "button", className: "stats__tab", textContent: s.label });
    if (i === 0) btn.dataset.active = "true";
    btn.addEventListener("click", () => {
      for (const child of tabsWrap.children) delete child.dataset.active;
      btn.dataset.active = "true";
      renderSeries(s);
    });
    tabsWrap.append(btn);
  });

  if (seriesList[0]) renderSeries(seriesList[0]);
  const firstDay = seriesList[0]?.data?.[0]?.day?.slice(5) ?? "28 days ago";
  const lastDay = seriesList[0]?.data?.at(-1)?.day?.slice(5) ?? "Today";

  return el(
    "div",
    { className: "stats__panel" },
    el(
      "div",
      { className: "stats__panel-head" },
      el("div", { className: "stats__panel-title-group" }, el("h3", { className: "stats__panel-title", textContent: "Daily Activity Trend (28 Days)" }), summaryNode),
      tabsWrap,
    ),
    el("div", { className: "stats__chart" }, box, el("div", { className: "stats__axis" }, el("span", { textContent: firstDay }), el("span", { textContent: `${lastDay} (Today highlighted)` }))),
  );
}

/** A breakdown table with 7d, 28d, % Share, and an inline progress bar. */
function table(title, rows28d, rows7d, total28d) {
  const weekMap = new Map((rows7d ?? []).map((r) => [r.label, r.n]));
  const thead = el(
    "thead",
    {},
    el("tr", {}, el("th", { textContent: "Item" }), el("th", { className: "stats__n", textContent: "7d" }), el("th", { className: "stats__n", textContent: "28d" }), el("th", { className: "stats__n", textContent: "Share" })),
  );
  const body = el("tbody");
  for (const { label, n } of (rows28d ?? []).slice(0, 8)) {
    const share = total28d ? Math.round((n / total28d) * 100) : 0;
    const wCount = weekMap.get(label) ?? 0;
    const bar = el("i", { className: "stats__row-bar" });
    bar.style.width = Math.max(2, share) + "%";
    const nameCell = el("td", { className: "stats__cell-name" }, el("span", { className: "stats__cell-text", textContent: nameOf(label) }), bar);
    body.append(
      el(
        "tr",
        {},
        nameCell,
        el("td", { className: "stats__n", textContent: number(wCount) }),
        el("td", { className: "stats__n stats__n--bold", textContent: number(n) }),
        el("td", { className: "stats__n stats__n--pct", textContent: total28d ? share + "%" : "—" }),
      ),
    );
  }
  if (!rows28d?.length) body.append(el("tr", {}, el("td", { colSpan: 4, className: "stats__empty", textContent: "No events recorded yet" })));
  return el("div", { className: "stats__table" }, el("h3", { textContent: title }), el("table", {}, thead, body));
}

function site(host, id, title, data, { frills = false } = {}) {
  host.replaceChildren(el("h2", { className: "admin__h", id: id + "-title", textContent: title }));
  if (data.error) {
    host.append(el("p", { className: "admin__note", textContent: `Cloudflare did not give the counts for this site (answer ${data.status || "none"}). If counting has only just started there may be nothing to read yet: it appears after the first visit.` }));
    return;
  }
  const { visits, copies, loads, plus, funnel } = data;
  const cards = el(
    "div",
    { className: "admin__cards" },
    kpiCard("Site Visits (7d)", number(visits.week), deltaBadge(visits.week, visits.before), [
      ["Today", number(visits.today)],
      ["Yesterday", number(visits.yesterday)],
      ["28d", number(visits.total)],
    ]),
    kpiCard("Links Copied (7d)", number(copies.week), deltaBadge(copies.week, copies.before), [
      ["Today", number(copies.today)],
      ["Yesterday", number(copies.yesterday)],
      ["28d", number(copies.total)],
    ]),
    kpiCard("Live Stream Loads (7d)", number(loads.live.week), deltaBadge(loads.live.week, loads.live.before), [
      ["Today", number(loads.live.today)],
      ["Yesterday", number(loads.live.yesterday)],
      ["28d", number(loads.live.total)],
    ]),
  );

  if (frills) {
    const a = data.active;
    cards.append(
      kpiCard("Weekly Active Streamers", number(a.week), deltaBadge(a.week, a.before), [
        ["Today", number(a.today)],
        ["Prev 7d", number(a.before)],
        ["28d Unique", number(a.month)],
      ]),
      kpiCard(
        "Streamer Retention (WoW)",
        a.returningRate === null ? "—" : Math.round(a.returningRate * 100) + "%",
        { text: a.before ? `${number(a.returning)} of ${number(a.before)} returned` : "Wait 1 more week", tone: a.returningRate >= 0.4 ? "up" : "flat" },
        [
          ["Returned", number(a.returning)],
          ["Last Week Cohort", number(a.before)],
          ["Target", "40%+"],
        ],
      ),
    );
    if (funnel) {
      cards.append(
        kpiCard(
          "Copy Conversion (7d)",
          pct(funnel.week.copyRate),
          { text: `28d Avg: ${pct(funnel.month.copyRate)}`, tone: (funnel.week.copyRate ?? 0) >= 0.15 ? "up" : "flat" },
          [
            ["7d Copied", `${number(copies.week)} / ${number(visits.week)}`],
            ["28d Copied", `${number(copies.total)} / ${number(visits.total)}`],
          ],
        ),
      );
    }
  }

  host.append(cards);
  if (frills && funnel) host.append(funnelSection(visits, copies, loads, funnel));
  host.append(dailyChartSection(visits, copies, loads));

  if (frills && !data.active.month) {
    host.append(el("p", { className: "admin__note", textContent: "Different overlays are counted only once the STATS_SALT secret is set on the worker (and overlays have opened on a real account since)." }));
  }

  const tables = el(
    "div",
    { className: "stats__tables" },
    table("Traffic Sources", visits.sources, visits.sourcesWeek, visits.total),
    table("Top Landing Pages", visits.pages, visits.pagesWeek, visits.total),
    table("Live Overlays by Type", loads.byKind, loads.byKindWeek, loads.live.total),
    table("Links Copied by Tool", copies.byOverlay, copies.byOverlayWeek, copies.total),
  );
  if (frills && copies.byPlatform?.length) {
    const platformTotal = copies.byPlatform.reduce((sum, r) => sum + r.n, 0);
    tables.append(table("Links Copied by Platform", copies.byPlatform, copies.byPlatformWeek, platformTotal));
  }
  if (frills && plus?.byFeature?.length) {
    tables.append(table("Frills Plus Interest Clicks", plus.byFeature, plus.byFeatureWeek, plus.total));
  }
  host.append(tables);
  if (data.others?.length) host.append(el("p", { className: "admin__note", textContent: "Other counts (28 days): " + data.others.map((o) => `${nameOf(o.label)} ${number(o.n)}`).join(", ") + "." }));
}

const SCORE_PROGRESS = {
  overlays: (data) => Math.min(100, Math.round(((data.active?.week || 0) / 50) * 100)),
  returning: (data) => (data.active?.returningRate === null || data.active?.returningRate === undefined ? 0 : Math.min(100, Math.round((data.active.returningRate / 0.4) * 100))),
  copies: (data) => Math.min(100, Math.round(((data.copies?.week || 0) / 100) * 100)),
};

function draw(data) {
  $("setup").hidden = data.error !== "not_set";
  $("plus").hidden = true;
  $("frills").replaceChildren();
  $("valwidgets").replaceChildren();
  if (data.error === "not_set") {
    $("setup").textContent = "To read the numbers, set two secrets on the Frills worker in Cloudflare (Workers & Pages, frills, Settings, Variables and Secrets): CF_ACCOUNT_ID (your account id, on the Workers & Pages overview) and CF_API_TOKEN (a token with the one permission Account, Account Analytics, Read). Also set STATS_SALT (any long random text) so different overlays can be counted. Then press Refresh.";
    say($("status"), "");
    return;
  }
  say($("status"), "Last updated: " + new Date(data.now).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) + " · Press Refresh for live numbers.");
  if (data.frills.scorecard) {
    $("plus").hidden = false;
    $("score").replaceChildren(
      ...data.frills.scorecard.map((row) => {
        const pctProgress = SCORE_PROGRESS[row.id] ? SCORE_PROGRESS[row.id](data.frills) : row.ok ? 100 : 0;
        const fill = el("i", {});
        fill.style.width = Math.max(4, pctProgress) + "%";
        const li = el(
          "li",
          { className: "stats__row" },
          el("span", { className: "stats__tick", textContent: row.ok ? "READY" : "IN PROGRESS" }),
          el(
            "div",
            { className: "stats__goal-main" },
            el("span", { className: "stats__what", textContent: row.label }),
            el("div", { className: "stats__goal-track" }, fill),
          ),
          el("b", { className: "stats__goal-val", textContent: row.value }),
          el("span", { className: "stats__target", textContent: `/ ${row.target}` }),
        );
        li.dataset.ok = String(row.ok);
        return li;
      }),
    );
  }
  site($("frills"), "frills", "Frills (frills.valwidgets.live)", data.frills, { frills: true });
  site($("valwidgets"), "valwidgets", "Valorant Widgets (valwidgets.live)", data.valwidgets);
}

async function refresh() {
  say($("status"), "Reading live analytics…");
  try { draw(await load()); } catch (error) { if (error instanceof Wrong) say($("status"), error.message, true); else throw error; }
}

function showDash(on) {
  $("login").hidden = on;
  $("dash").hidden = !on;
  $("bar-actions").hidden = !on;
}
function logout(message = "") {
  key = "";
  try { sessionStorage.removeItem(KEY); } catch { /* nothing to forget */ }
  showDash(false);
  $("key").value = "";
  say($("login-status"), message, Boolean(message));
}
$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  key = $("key").value.trim();
  if (!key) return;
  say($("login-status"), "Checking…");
  $("login-go").disabled = true;
  try {
    const data = await load();
    try { sessionStorage.setItem(KEY, key); } catch { /* the page still works until it is closed */ }
    say($("login-status"), "");
    showDash(true);
    draw(data);
  } catch (error) {
    if (error instanceof Wrong && $("login").hidden === false) say($("login-status"), error.message, true);
    else if (!(error instanceof Wrong)) throw error;
  } finally {
    $("login-go").disabled = false;
  }
});
$("logout").addEventListener("click", () => logout());
$("refresh").addEventListener("click", () => refresh());
if (key) { showDash(true); refresh(); }
