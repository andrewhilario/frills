// The private stats page (/admin/stats/): the numbers for Frills and valwidgets.live, live TikTok relay fleet status,
// Google Search Console metrics, and one-click CSV/JSON export. Everything is put in with textContent, never as HTML.

import { el } from "./feed.js";

const $ = (id) => document.getElementById(id);
const KEY = "frills:admin:key";

let key = "";
let latestReport = null;
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
const pct1 = (rate) => (rate === null || rate === undefined ? "—" : (rate * 100).toFixed(1) + "%");
const pos1 = (pos) => (!pos ? "—" : Number(pos).toFixed(1));
const uptimeText = (s) => {
  if (typeof s !== "number" || s < 0) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

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

/** Draws the live Relay Fleet Status section (supports 1 or multiple relays). */
function drawRelays(host, relays) {
  host.replaceChildren();
  if (!Array.isArray(relays) || !relays.length) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const onlineCount = relays.filter((r) => r.ok).length;
  const totalFree = relays.reduce((s, r) => s + (r.free || 0), 0);
  const totalMax = relays.reduce((s, r) => s + (r.slots?.max || 0), 0);
  const totalUsed = relays.reduce((s, r) => s + (r.slots?.used || 0), 0);
  const totalWait = relays.reduce((s, r) => s + (r.slots?.waiting || 0), 0);

  const fleetBadge = el("span", {
    className: "stats__delta",
    textContent: onlineCount === relays.length ? `● ${onlineCount}/${relays.length} ONLINE · ${totalFree} FREE SPOTS` : `${onlineCount}/${relays.length} ONLINE · DEGRADED`,
  });
  fleetBadge.dataset.tone = onlineCount === relays.length && totalFree > 0 ? "up" : "down";

  const head = el(
    "div",
    { className: "stats__panel-head" },
    el(
      "div",
      { className: "stats__panel-title-group" },
      el("h2", { className: "admin__h", id: "relays-title", textContent: "TikTok Relay Fleet Status" }),
      el("span", { className: "stats__panel-sub", textContent: `Total Fleet Capacity: ${number(totalUsed)} / ${number(totalMax)} rooms in use · ${number(totalWait)} queued · Multi-relay ready (RELAY_URLS)` }),
    ),
    fleetBadge,
  );

  const grid = el("div", { className: "stats__relay-grid" });
  for (const r of relays) {
    const statusPill = el("span", { className: "stats__delta" });
    if (!r.ok) {
      statusPill.textContent = `OFFLINE (${r.status || "unreachable"})`;
      statusPill.dataset.tone = "down";
    } else if (r.level === "full") {
      statusPill.textContent = `FULL · ${r.latencyMs}ms`;
      statusPill.dataset.tone = "down";
    } else if (r.level === "low") {
      statusPill.textContent = `LOW SPOTS · ${r.latencyMs}ms`;
      statusPill.dataset.tone = "flat";
    } else {
      statusPill.textContent = `ONLINE · ${r.latencyMs}ms`;
      statusPill.dataset.tone = "up";
    }

    const cardHead = el(
      "div",
      { className: "stats__card-top" },
      el("div", { className: "stats__relay-name" }, el("strong", { textContent: r.label }), el("a", { className: "stats__relay-link", href: r.url, target: "_blank", rel: "noopener", textContent: "Open relay status ↗" })),
      statusPill,
    );

    if (!r.ok) {
      grid.append(
        el(
          "div",
          { className: "stats__panel stats__relay-card" },
          cardHead,
          el("p", { className: "admin__note", textContent: `Could not reach ${r.url}/health (latency ${r.latencyMs}ms). Check if the relay server or Cloudflare tunnel is running.` }),
        ),
      );
      continue;
    }

    const usedPct = r.slots.max > 0 ? Math.min(100, Math.round((r.slots.used / r.slots.max) * 100)) : 0;
    const fill = el("i", {});
    fill.style.width = Math.max(3, usedPct) + "%";
    const track = el("div", { className: "stats__funnel-track stats__relay-bar" }, fill);
    track.dataset.level = r.level || "ok";

    const signText = r.signing
      ? `${r.signing.busy ? "Busy (rate-limited)" : "Healthy"}${typeof r.signing.connectsHour === "number" ? ` · ${r.signing.connectsHour}/hr (${r.signing.connectsDay}/24h)` : ""}`
      : "—";
    const streamsText = r.streams ? `${number(r.streams.open)} open (${number(r.streams.turnedAway)} turned away)` : "—";
    const capText = r.capacity ? `~${number(r.capacity.estimate)} max accounts (${r.capacity.perRoomMB} MB/room)` : "—";

    const miniGrid = el(
      "div",
      { className: "stats__relay-metrics" },
      el("div", { className: "stats__relay-stat" }, el("span", { textContent: "Free Spots" }), el("b", { textContent: `${number(r.free)} of ${number(r.slots.max)}` })),
      el("div", { className: "stats__relay-stat" }, el("span", { textContent: "In Use / Queue" }), el("b", { textContent: `${number(r.slots.used)} active · ${number(r.slots.waiting)} waiting` })),
      el("div", { className: "stats__relay-stat" }, el("span", { textContent: "Open Browser Streams" }), el("b", { textContent: streamsText })),
      el("div", { className: "stats__relay-stat" }, el("span", { textContent: "Signing Service" }), el("b", { textContent: signText })),
      el("div", { className: "stats__relay-stat" }, el("span", { textContent: "Uptime & Version" }), el("b", { textContent: `${uptimeText(r.uptimeS)} · v${r.version}` })),
      el("div", { className: "stats__relay-stat" }, el("span", { textContent: "Est. Device Capacity" }), el("b", { textContent: capText })),
    );

    grid.append(el("div", { className: "stats__panel stats__relay-card" }, cardHead, track, miniGrid));
  }

  host.append(head, grid);
}

/** Draws the Google Search Console section (or setup instructions when not yet connected). */
function drawGsc(host, gsc) {
  host.replaceChildren();
  host.hidden = false;
  host.append(el("h2", { className: "admin__h", id: "gsc-title", textContent: "Google Search Console (Organic SEO)" }));

  if (!gsc || !gsc.configured) {
    host.append(
      el(
        "div",
        { className: "stats__panel" },
        el("h3", { className: "stats__panel-title", textContent: "Connect Google Search Console (Optional 2-Minute Setup)" }),
        el("p", { className: "admin__note", textContent: "To pull live Google Search clicks, impressions, rankings, queries, and countries into this dashboard:" }),
        el(
          "ol",
          { className: "stats__setup-list" },
          el("li", { textContent: "In Google Cloud Console, enable the 'Google Search Console API' and create a Service Account with a JSON key." }),
          el("li", { textContent: "In Google Search Console (Settings -> Users and permissions), add the Service Account's client_email as a Restricted (Read-Only) user." }),
          el("li", { textContent: "In Cloudflare (Workers & Pages -> frills -> Settings -> Variables and Secrets), add secret GSC_SERVICE_ACCOUNT with the JSON key contents, then press Refresh." }),
        ),
      ),
    );
    return;
  }

  if (gsc.error) {
    host.append(
      el("p", {
        className: "admin__note admin__note--warn",
        textContent: `Google Search Console returned an error (${gsc.error}, status ${gsc.status || "none"}). Check that the Service Account email is added to Search Console under Settings -> Users and permissions.`,
      }),
    );
    return;
  }

  const w = gsc.week ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const m = gsc.month ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };

  const cards = el(
    "div",
    { className: "admin__cards" },
    kpiCard("Search Clicks (7d)", number(w.clicks), { text: `28d: ${number(m.clicks)}`, tone: w.clicks > 0 ? "up" : "flat" }, [
      ["28d Clicks", number(m.clicks)],
      ["Property", gsc.siteUrl || "frills.valwidgets.live"],
    ]),
    kpiCard("Search Impressions (7d)", number(w.impressions), { text: `28d: ${number(m.impressions)}`, tone: w.impressions > 0 ? "up" : "flat" }, [
      ["28d Impressions", number(m.impressions)],
      ["7d Clicks", number(w.clicks)],
    ]),
    kpiCard("Search CTR (7d)", pct1(w.ctr), { text: `28d Avg: ${pct1(m.ctr)}`, tone: w.ctr >= 0.03 ? "up" : "flat" }, [
      ["28d CTR", pct1(m.ctr)],
      ["Target", "3.0%+"],
    ]),
    kpiCard("Avg Search Position (7d)", pos1(w.position), { text: `28d Avg: ${pos1(m.position)}`, tone: w.position > 0 && w.position <= 15 ? "up" : "flat" }, [
      ["28d Position", pos1(m.position)],
      ["Page 1 Target", "1.0 – 10.0"],
    ]),
  );

  const gscTable = (title, colLabel, rows) => {
    const thead = el(
      "thead",
      {},
      el("tr", {}, el("th", { textContent: colLabel }), el("th", { className: "stats__n", textContent: "Clicks" }), el("th", { className: "stats__n", textContent: "Impr." }), el("th", { className: "stats__n", textContent: "CTR" }), el("th", { className: "stats__n", textContent: "Pos" })),
    );
    const body = el("tbody");
    for (const r of (rows ?? []).slice(0, 10)) {
      const label = r.key.replace(/^https?:\/\/[^/]+/, "") || "/";
      body.append(
        el(
          "tr",
          {},
          el("td", { className: "stats__cell-name" }, el("span", { className: "stats__cell-text", textContent: label })),
          el("td", { className: "stats__n stats__n--bold", textContent: number(r.clicks) }),
          el("td", { className: "stats__n", textContent: number(r.impressions) }),
          el("td", { className: "stats__n stats__n--pct", textContent: pct1(r.ctr) }),
          el("td", { className: "stats__n stats__n--pct", textContent: pos1(r.position) }),
        ),
      );
    }
    if (!rows?.length) body.append(el("tr", {}, el("td", { colSpan: 5, className: "stats__empty", textContent: "No search data in last 28 days" })));
    return el("div", { className: "stats__table" }, el("h3", { textContent: title }), el("table", {}, thead, body));
  };

  const tables = el(
    "div",
    { className: "stats__tables" },
    gscTable("Top Google Search Queries (28d)", "Query", gsc.queries),
    gscTable("Top Google Search Pages (28d)", "Page", gsc.pages),
    gscTable("Top Search Countries (28d)", "Country (ISO)", gsc.countries),
  );

  host.append(cards, tables);
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
  latestReport = data;
  $("setup").hidden = data.error !== "not_set";
  $("plus").hidden = true;
  $("relays").hidden = true;
  $("gsc").hidden = true;
  $("frills").replaceChildren();
  $("valwidgets").replaceChildren();
  if (data.error === "not_set") {
    $("setup").textContent = "To read the numbers, set two secrets on the Frills worker in Cloudflare (Workers & Pages, frills, Settings, Variables and Secrets): CF_ACCOUNT_ID (your account id, on the Workers & Pages overview) and CF_API_TOKEN (a token with the one permission Account, Account Analytics, Read). Also set STATS_SALT (any long random text) so different overlays can be counted. Then press Refresh.";
    say($("status"), "");
    return;
  }
  say($("status"), "Last updated: " + new Date(data.now).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) + " · Press Refresh for live numbers.");
  drawRelays($("relays"), data.relays);
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
  drawGsc($("gsc"), data.gsc);
  site($("valwidgets"), "valwidgets", "Valorant Widgets (valwidgets.live)", data.valwidgets);
}

/** Triggers a browser download of `content` with `filename` and `mime`. */
function downloadFile(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cols) => cols.map(csvCell).join(",");

function exportCsv() {
  if (!latestReport?.ok) return;
  const stamp = new Date(latestReport.now || Date.now()).toISOString().slice(0, 10);
  const f = latestReport.frills ?? {};
  const v = latestReport.valwidgets ?? {};
  const lines = [];

  lines.push(csvRow(["Frills Analytics & System Status Export", new Date(latestReport.now || Date.now()).toISOString()]));
  lines.push("");

  // 1. Summary KPIs
  lines.push(csvRow(["Section", "Metric", "Today", "Yesterday", "Last 7 Days", "Prev 7 Days", "Last 28 Days"]));
  if (!f.error) {
    lines.push(csvRow(["Frills", "Site Visits", f.visits?.today, f.visits?.yesterday, f.visits?.week, f.visits?.before, f.visits?.total]));
    lines.push(csvRow(["Frills", "Links Copied", f.copies?.today, f.copies?.yesterday, f.copies?.week, f.copies?.before, f.copies?.total]));
    lines.push(csvRow(["Frills", "Live Stream Loads", f.loads?.live?.today, f.loads?.live?.yesterday, f.loads?.live?.week, f.loads?.live?.before, f.loads?.live?.total]));
    lines.push(csvRow(["Frills", "Unique Active Streamers", f.active?.today, "", f.active?.week, f.active?.before, f.active?.month]));
    lines.push(csvRow(["Frills", "Streamer Retention (WoW)", "", "", pct(f.active?.returningRate), `${f.active?.returning || 0} of ${f.active?.before || 0}`, ""]));
  }
  if (!v.error) {
    lines.push(csvRow(["valwidgets.live", "Site Visits", v.visits?.today, v.visits?.yesterday, v.visits?.week, v.visits?.before, v.visits?.total]));
    lines.push(csvRow(["valwidgets.live", "Links Copied", v.copies?.today, v.copies?.yesterday, v.copies?.week, v.copies?.before, v.copies?.total]));
    lines.push(csvRow(["valwidgets.live", "Live Stream Loads", v.loads?.live?.today, v.loads?.live?.yesterday, v.loads?.live?.week, v.loads?.live?.before, v.loads?.live?.total]));
  }
  lines.push("");

  // 2. Relay Fleet Status
  if (latestReport.relays?.length) {
    lines.push(csvRow(["Relay Label", "URL", "Status", "Latency (ms)", "Free Spots", "Used Spots", "Max Spots", "Queue Waiting", "Uptime (s)", "Version"]));
    for (const r of latestReport.relays) {
      lines.push(csvRow([r.label, r.url, r.ok ? r.level : "down", r.latencyMs, r.free ?? "", r.slots?.used ?? "", r.slots?.max ?? "", r.slots?.waiting ?? "", r.uptimeS ?? "", r.version ?? ""]));
    }
    lines.push("");
  }

  // 3. 28-Day Daily Time Series
  if (f.visits?.perDay?.length) {
    lines.push(csvRow(["Date", "Frills Visits", "Frills Links Copied", "Frills Live Stream Loads", "valwidgets.live Visits"]));
    const cMap = new Map((f.copies?.perDay ?? []).map((d) => [d.day, d.n]));
    const lMap = new Map((f.loads?.livePerDay ?? []).map((d) => [d.day, d.n]));
    const vMap = new Map((v.visits?.perDay ?? []).map((d) => [d.day, d.n]));
    for (const { day, n } of f.visits.perDay) {
      lines.push(csvRow([day, n, cMap.get(day) ?? 0, lMap.get(day) ?? 0, vMap.get(day) ?? 0]));
    }
    lines.push("");
  }

  // 4. Breakdowns
  const dumpSplit = (cat, rows28d, rows7d) => {
    const wMap = new Map((rows7d ?? []).map((r) => [r.label, r.n]));
    for (const { label, n } of rows28d ?? []) {
      lines.push(csvRow([cat, nameOf(label), label, wMap.get(label) ?? 0, n]));
    }
  };
  if (!f.error) {
    lines.push(csvRow(["Breakdown Category", "Name", "Raw Key", "Last 7 Days", "Last 28 Days"]));
    dumpSplit("Traffic Sources", f.visits?.sources, f.visits?.sourcesWeek);
    dumpSplit("Landing Pages", f.visits?.pages, f.visits?.pagesWeek);
    dumpSplit("Live Overlays by Type", f.loads?.byKind, f.loads?.byKindWeek);
    dumpSplit("Links Copied by Tool", f.copies?.byOverlay, f.copies?.byOverlayWeek);
    dumpSplit("Links Copied by Platform", f.copies?.byPlatform, f.copies?.byPlatformWeek);
    dumpSplit("Frills Plus Clicks", f.plus?.byFeature, f.plus?.byFeatureWeek);
    lines.push("");
  }

  // 5. Google Search Console
  if (latestReport.gsc?.configured && !latestReport.gsc.error) {
    const g = latestReport.gsc;
    lines.push(csvRow(["GSC Dimension", "Key", "Clicks (28d)", "Impressions (28d)", "CTR", "Position"]));
    lines.push(csvRow(["Summary (7d)", g.siteUrl, g.week?.clicks, g.week?.impressions, pct1(g.week?.ctr), pos1(g.week?.position)]));
    lines.push(csvRow(["Summary (28d)", g.siteUrl, g.month?.clicks, g.month?.impressions, pct1(g.month?.ctr), pos1(g.month?.position)]));
    for (const r of g.queries ?? []) lines.push(csvRow(["Query", r.key, r.clicks, r.impressions, pct1(r.ctr), pos1(r.position)]));
    for (const r of g.pages ?? []) lines.push(csvRow(["Page", r.key, r.clicks, r.impressions, pct1(r.ctr), pos1(r.position)]));
    for (const r of g.countries ?? []) lines.push(csvRow(["Country", r.key, r.clicks, r.impressions, pct1(r.ctr), pos1(r.position)]));
  }

  downloadFile(`frills-analytics-${stamp}.csv`, "text/csv;charset=utf-8", lines.join("\r\n"));
}

function exportJson() {
  if (!latestReport?.ok) return;
  const stamp = new Date(latestReport.now || Date.now()).toISOString().slice(0, 10);
  downloadFile(`frills-analytics-${stamp}.json`, "application/json;charset=utf-8", JSON.stringify(latestReport, null, 2));
}

async function refresh() {
  say($("status"), "Reading live analytics & relay status…");
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
$("export-csv")?.addEventListener("click", () => exportCsv());
$("export-json")?.addEventListener("click", () => exportJson());
if (key) { showDash(true); refresh(); }
