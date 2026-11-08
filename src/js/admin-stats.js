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
const number = (n) => Math.round(n).toLocaleString("en-US");
/** "up 12%", "down 30%", "same", or "new" when there was nothing the week before. */
function change(week, before) {
  if (!before) return week ? "new this week" : "nothing yet";
  const pct = Math.round(((week - before) / before) * 100);
  return pct === 0 ? "same as the week before" : `${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% on the week before`;
}
const NAMES = { chat: "Chat", alerts: "Alerts", gifts: "Last gifts", goal: "Goals", likers: "Top likers", songs: "Song requests", matcha: "Matcha", home: "Home page", editor: "Chat editor", overlays: "Overlays page", start: "Quick start", guides: "Guides and looks", other: "Other pages", overlay: "Overlay page", rank: "Rank page", mastery: "Mastery page", "valorant-rank": "Rank overlay", "valorant-mastery": "Mastery overlay", direct: "Direct (typed, bookmarked or no referrer)", tiktok: "TikTok", twitch: "Twitch", both: "TikTok + Twitch together", reddit: "Reddit", discord: "Discord", youtube: "YouTube", search: "Search engines", bio: "Link in a profile", ad1: "Ad 1", ad2: "Ad 2", ad3: "Ad 3", remote_link: "Remote-control link (update OBS live)", custom_upload: "Custom sound and sticker kit", scene_link: "One link for the whole scene", plus_pack: "Collector look packs" };
const nameOf = (label) => NAMES[label] ?? label;
const pct = (rate) => (rate === null || rate === undefined ? "-" : Math.round(rate * 100) + "%");

function card(title, big, small) {
  return el("div", { className: "stats__card" }, el("span", { className: "stats__label", textContent: title }), el("b", { className: "stats__big", textContent: big }), el("span", { className: "stats__small", textContent: small }));
}

/** The visits per day, as bars (the last 28 days; the tallest is the full height). */
function bars(perDay) {
  const top = Math.max(1, ...perDay.map((d) => d.n));
  const box = el("div", { className: "stats__bars" });
  box.setAttribute("role", "img");
  box.setAttribute("aria-label", "Visits per day, the last 28 days");
  for (const { day, n } of perDay) {
    const bar = el("i", { title: `${day}: ${number(n)}` });
    bar.style.height = Math.max(2, Math.round((n / top) * 100)) + "%";
    box.append(bar);
  }
  return el("div", { className: "stats__chart" }, box, el("div", { className: "stats__axis" }, el("span", { textContent: "28 days ago" }), el("span", { textContent: "today" })));
}

/** A small table: label, count and share of the total. */
function table(title, rows, total) {
  const body = el("tbody");
  for (const { label, n } of rows.slice(0, 8)) body.append(el("tr", {}, el("td", { textContent: nameOf(label) }), el("td", { className: "stats__n", textContent: number(n) }), el("td", { className: "stats__n", textContent: total ? Math.round((n / total) * 100) + "%" : "" })));
  if (!rows.length) body.append(el("tr", {}, el("td", { colSpan: 3, textContent: "Nothing yet" })));
  return el("div", { className: "stats__table" }, el("h3", { textContent: title }), el("table", {}, body));
}

function site(host, id, title, data, { frills = false } = {}) {
  host.replaceChildren(el("h2", { className: "admin__h", id: id + "-title", textContent: title }));
  if (data.error) {
    host.append(el("p", { className: "admin__note", textContent: `Cloudflare did not give the counts for this site (answer ${data.status || "none"}). If counting has only just started there may be nothing to read yet: it appears after the first visit.` }));
    return;
  }
  const { visits, copies, loads, plus, funnel } = data;
  const cards = el("div", { className: "admin__cards" }, card("Visits, last 7 days", number(visits.week), change(visits.week, visits.before)), card("Links copied, last 7 days", number(copies.week), change(copies.week, copies.before)), card("Overlays opened (real accounts), last 7 days", number(loads.live.week), change(loads.live.week, loads.live.before)));
  if (frills) {
    const a = data.active;
    cards.append(
      card("Different overlays, last 7 days", number(a.week), a.before ? `${number(a.before)} the week before` : "no earlier week yet"),
      card("Came back from the week before", a.returningRate === null ? "-" : Math.round(a.returningRate * 100) + "%", `${number(a.returning)} of ${number(a.before)}`),
    );
    if (funnel) {
      cards.append(card("Funnel: Visits -> Copied (7d)", pct(funnel.week.copyRate), `28 days: ${pct(funnel.month.copyRate)} (${number(copies.total)} of ${number(visits.total)})`));
    }
  }
  host.append(cards, el("p", { className: "admin__note", textContent: `Visits per day, the last 28 days (${number(visits.total)} in all):` }), bars(visits.perDay));
  if (frills && !data.active.month) host.append(el("p", { className: "admin__note", textContent: "Different overlays are counted only once the STATS_SALT secret is set on the worker (and overlays have opened on a real account since)." }));
  const tables = el("div", { className: "stats__tables" }, table("Where visits came from (28 days)", visits.sources, visits.total), table("Pages visits started on (28 days)", visits.pages, visits.total), table("Overlays opened on real accounts (28 days)", loads.byKind, loads.live.total), table("Links copied, by editor (28 days)", copies.byOverlay, copies.total));
  if (frills && copies.byPlatform?.length) {
    const platformTotal = copies.byPlatform.reduce((sum, r) => sum + r.n, 0);
    tables.append(table("Links copied, by platform (28 days)", copies.byPlatform, platformTotal));
  }
  if (frills && plus?.byFeature?.length) {
    tables.append(table("Frills Plus feature clicks (28 days)", plus.byFeature, plus.total));
  }
  host.append(tables);
  if (data.others?.length) host.append(el("p", { className: "admin__note", textContent: "Other counts (28 days): " + data.others.map((o) => `${nameOf(o.label)} ${number(o.n)}`).join(", ") + "." }));
  if (loads.demo.total) host.append(el("p", { className: "admin__note", textContent: `Practice overlays and previews, counted apart: ${number(loads.demo.total)} in 28 days.` }));
}

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
  say($("status"), "Counts up to " + new Date(data.now).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) + ". Press Refresh to read them again.");
  if (data.frills.scorecard) {
    $("plus").hidden = false;
    $("score").replaceChildren(...data.frills.scorecard.map((row) => {
      const li = el("li", { className: "stats__row" }, el("span", { className: "stats__tick", textContent: row.ok ? "Yes" : "Not yet" }), el("span", { className: "stats__what", textContent: row.label }), el("b", { textContent: row.value }), el("span", { className: "stats__target", textContent: "target: " + row.target }));
      li.dataset.ok = String(row.ok);
      return li;
    }));
  }
  site($("frills"), "frills", "Frills", data.frills, { frills: true });
  site($("valwidgets"), "valwidgets", "valwidgets.live", data.valwidgets);
}

async function refresh() {
  say($("status"), "Reading the counts…");
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
