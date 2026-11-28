// The admin page: log in with the password, read the feedback, mark it done, and look at and remove the uploaded files. It only talks to
// /api/admin/ (worker/admin.mjs). The password is kept in this tab's session storage and sent with every call; closing the tab forgets it.
// Everything that came from visitors (messages, contacts, ids) goes in with textContent, never as HTML.

import { el } from "./feed.js";
import { CHARTS, PLUS_KIND_WORDS, attention, chartSentence, chartSeries, kpiCards, number, quotaOf, relayName, relayState } from "./admin-overview.js";

const $ = (id) => document.getElementById(id);
const KEY = "frills:admin:key";
const KINDS = { broken: "Something broke", idea: "Idea", look: "A look", other: "Other" };
const APPS = { "tiktok-live-studio": "TikTok LIVE Studio", streamlabs: "Streamlabs", obs: "OBS", "other-app": "Another app", "none-yet": "No app yet" };

let key = "";
try { key = sessionStorage.getItem(KEY) ?? ""; } catch { /* storage can be blocked; the password is then asked for each visit */ }

class Wrong extends Error {}

/** One call to the admin side. Throws a Wrong with words a person can read. */
async function api(method, path, body) {
  let res;
  try {
    res = await fetch("/api/admin/" + path, { method, headers: { authorization: `Bearer ${key}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  } catch {
    throw new Wrong("Could not reach the server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  if (res.status === 401) { logout("That is not the right password."); throw new Wrong("That is not the right password."); }
  if (res.status === 429) throw new Wrong("Too many wrong tries. Wait ten minutes, then try again.");
  if (res.status === 503 && data.error === "admin_off") throw new Wrong("The admin side is switched off. Set the ADMIN_KEY secret in Cloudflare (12 or more characters) and try again.");
  if (res.status === 503) throw new Wrong("The database is not ready. Check the D1 tables in schema.sql exist.");
  if (data.error === "no_status_column") throw new Wrong("The database has no status column yet. See the note at the top.");
  if (data.error === "bad_email") throw new Wrong("That does not look like a valid email address.");
  if (data.error === "already_paid") throw new Wrong("That account already has an active paid Frills Plus subscription.");
  if (data.error === "already_vip") throw new Wrong("That account has a VIP pass already. Revoke it first if you want to give a paid-style Plus instead.");
  if (data.error === "email_off") throw new Wrong("Email is not set up on the server. Add the RESEND_API_KEY secret in Cloudflare.");
  if (data.error === "mail_failed") throw new Wrong("The email service did not accept the message. Try again in a minute.");
  if (data.error === "not_active") throw new Wrong("That account does not have an active Plus subscription right now.");
  if (data.error === "is_vip") throw new Wrong("A VIP pass is not emailed: the email is a subscription confirmation for customers.");
  if (data.error === "not_comp") throw new Wrong("Only VIP passes and manual grants can be ended here (cancel paid plans in Polar).");
  throw new Wrong("Something went wrong (" + res.status + ").");
}

const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const size = (bytes) => (bytes >= 1073741824 ? (bytes / 1073741824).toFixed(1).replace(/\.0$/, "") + " GB" : bytes >= 1048576 ? (bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB");
const say = (node, text, bad = false) => { node.textContent = text; node.dataset.state = bad ? "error" : ""; };
const run = async (node, job) => { try { return await job(); } catch (error) { if (error instanceof Wrong) say(node, error.message, true); else throw error; return undefined; } };

/** A delete button that asks twice: the first press changes it to "Really delete?", the second does it. It relaxes after a few seconds. */
function confirmButton(label, action, { sure = "Really delete?", busy = "Deleting…", extra = "admin__danger" } = {}) {
  const button = el("button", { type: "button", className: `btn btn--outline btn--sm ${extra}`, textContent: label });
  let timer = 0;
  button.addEventListener("click", async () => {
    if (!button.dataset.sure) {
      button.dataset.sure = "1";
      button.textContent = sure;
      timer = setTimeout(() => { delete button.dataset.sure; button.textContent = label; }, 4000);
      return;
    }
    clearTimeout(timer);
    button.disabled = true;
    button.textContent = busy;
    try { await action(); } catch { button.disabled = false; delete button.dataset.sure; button.textContent = label; }
  });
  return button;
}

// ── Login ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function showDash(on) {
  $("login").hidden = on;
  $("dash").hidden = !on;
}
function logout(message = "") {
  key = "";
  try { sessionStorage.removeItem(KEY); } catch { /* nothing to forget */ }
  showDash(false);
  $("key").value = "";
  say($("login-status"), message, Boolean(message));
}
async function enter() {
  showDash(true);
  await refreshAll();
}
$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  key = $("key").value.trim();
  if (!key) return;
  const status = $("login-status");
  say(status, "Checking…");
  $("login-go").disabled = true;
  try {
    await api("GET", "summary");
    try { sessionStorage.setItem(KEY, key); } catch { /* the page still works until it is closed */ }
    say(status, "");
    await enter();
  } catch (error) {
    if (error instanceof Wrong && $("login").hidden === false) say(status, error.message, true);
    else if (!(error instanceof Wrong)) throw error;
  } finally {
    $("login-go").disabled = false;
  }
});
$("logout").addEventListener("click", () => logout());
$("refresh").addEventListener("click", () => refreshAll());

// ── Totals ─────────────────────────────────────────────────────────────────────────────────────────────────────────
let canMark = true;
async function refreshSummary() {
  const s = await api("GET", "summary");
  canMark = s.canMark;
  $("no-status").hidden = canMark;
  const used = Math.min(100, Math.round((100 * s.media.bytes) / Math.max(1, s.media.limit)));
  $("cards").replaceChildren(
    card(String(s.feedback.total), "feedback messages"),
    card(String(s.feedback.new), canMark ? "not marked done" : "(marking is off)"),
    card(String(s.media.count), `files (${plural(s.media.kinds.image ?? 0, "image", "images")}, ${plural(s.media.kinds.sound ?? 0, "sound", "sounds")})`),
    card(size(s.media.bytes), `stored of ${size(s.media.limit)}`, used),
  );
  if (dash.overview) {
    dash.overview.summary = s;
    renderNav();
    renderAttention();
    renderHealth();
  }
}
function card(number, label, percent) {
  const node = el("div", { className: "stat" }, el("b", { textContent: number }), el("span", { textContent: label }));
  if (percent !== undefined) {
    const bar = el("i", { className: "stat__bar" });
    bar.style.setProperty("--used", percent + "%");
    node.append(bar);
  }
  return node;
}

// ── Tabs ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const VIEWS = { overview: "Overview", feedback: "Feedback", files: "Files", plus: "Frills Plus" };
const SUBS = { feedback: "What visitors sent you through the feedback form.", files: "The pictures and sounds visitors uploaded for their alerts.", plus: "Turn Plus on for a customer, give a VIP pass, and see who has Plus." };
let view = "overview";
function tab(which) {
  if (!VIEWS[which]) which = "overview";
  view = which;
  for (const name of Object.keys(VIEWS)) {
    const panel = $("panel-" + name);
    const btn = $("tab-" + name);
    if (panel) panel.hidden = name !== which;
    if (btn) btn.setAttribute("aria-pressed", String(name === which));
  }
  $("dash-title").textContent = VIEWS[which];
  renderSub();
  try { history.replaceState(null, "", which === "overview" ? location.pathname : "#" + which); } catch { /* the address is only a convenience */ }
}
for (const name of Object.keys(VIEWS)) $("tab-" + name)?.addEventListener("click", () => tab(name));
$("go-plus")?.addEventListener("click", () => tab("plus"));
$("go-feedback")?.addEventListener("click", () => tab("feedback"));
$("quick-activate")?.addEventListener("click", () => { tab("plus"); $("mp-email")?.focus({ preventScroll: false }); });

// ── Overview ─────────────────────────────────────────────────────────────
// dash.overview is our own database (fast); dash.stats is traffic and relay health from Cloudflare and the relays (slower, and may be off).
const dash = { overview: undefined, stats: undefined, chart: "visits", updatedAt: 0 };
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const utcDay = (iso) => new Date(Date.parse(iso + "T00:00:00Z")).toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" });
const none = (text) => el("li", { className: "dash__none", textContent: text });
const withTone = (node, tone) => { node.dataset.tone = tone; return node; };
const NOT_CONNECTED = "Not connected. Set the CF_ACCOUNT_ID and CF_API_TOKEN secrets in Cloudflare.";

function renderSub() {
  $("dash-sub").textContent = view === "overview" ? (dash.updatedAt ? `Updated ${clock(dash.updatedAt)}` : "Loading…") : SUBS[view];
}
function renderNav() {
  const fresh = dash.overview?.summary?.feedback?.new ?? 0;
  $("nav-feedback").hidden = !fresh;
  $("nav-feedback").textContent = fresh ? number(fresh) : "";
}
const TONE_WORDS = { bad: "Urgent", warn: "Check", info: "Note", ok: "All clear" };
function attentionRow(item) {
  const row = withTone(el("li", { className: "dash__attn-item" }), item.tone);
  row.append(withTone(el("span", { className: "dash__chip", textContent: TONE_WORDS[item.tone] }), item.tone), el("p", { className: "dash__attn-text", textContent: item.text }));
  if (item.href) row.append(el("a", { className: "btn btn--soft btn--sm dash__attn-action", href: item.href, textContent: item.action }));
  else if (item.view) {
    const go = el("button", { type: "button", className: "btn btn--soft btn--sm dash__attn-action", textContent: item.action });
    go.addEventListener("click", () => tab(item.view));
    row.append(go);
  }
  return row;
}
function renderAttention() {
  if (!dash.overview) { $("attention").replaceChildren(none("Checking…")); $("attn-count").textContent = ""; return; }
  const items = attention({ overview: dash.overview, stats: dash.stats });
  $("attn-count").textContent = items.length ? plural(items.length, "item", "items") : "";
  const clear = dash.stats === undefined ? "Nothing needs you so far. Still checking the relays…" : "All clear. Nothing needs you right now.";
  $("attention").replaceChildren(...(items.length ? items.map(attentionRow) : [attentionRow({ tone: "ok", text: clear })]));
}
function renderKpis() {
  $("kpis").replaceChildren(...kpiCards({ overview: dash.overview, stats: dash.stats }).map((c) => {
    const node = el("article", { className: "kpi" }, el("span", { className: "kpi__label", textContent: c.label }), el("b", { className: "kpi__value", textContent: c.value }), el("span", { className: "kpi__sub", textContent: c.sub }));
    node.dataset.key = c.key;
    if (c.change) node.append(withTone(el("span", { className: "kpi__change", textContent: c.change.text }), c.change.tone));
    return node;
  }));
}
/** Bars scaled to the biggest day. Every bar has its date and number in its title; the sentence under the chart says it in words. */
function bars(target, series) {
  const max = Math.max(1, ...series.map((d) => d.n));
  target.replaceChildren(...series.map((d, i) => {
    const bar = el("i", { title: `${utcDay(d.day)}: ${number(d.n)}` });
    bar.style.setProperty("--h", Math.round((d.n / max) * 100) + "%");
    if (d.n === 0) bar.dataset.zero = "true";
    if (i === series.length - 1) bar.dataset.today = "true";
    return bar;
  }));
}
function renderChart() {
  const tabs = $("chart-tabs");
  if (!tabs.children.length) {
    for (const c of CHARTS) {
      const b = el("button", { type: "button", className: "chip", textContent: c.label });
      b.dataset.kind = c.key;
      b.addEventListener("click", () => { dash.chart = c.key; renderChart(); });
      tabs.append(b);
    }
  }
  for (const b of tabs.children) b.setAttribute("aria-pressed", String(b.dataset.kind === dash.chart));
  const series = chartSeries(dash.stats, dash.chart);
  if (!series) {
    const words = dash.stats === undefined ? "Loading the numbers…" : dash.stats && dash.stats.ok === false ? NOT_CONNECTED : "The traffic numbers could not be read. Press Refresh to try again.";
    $("chart").replaceChildren(el("p", { className: "dash__empty", textContent: words }));
    $("chart-from").textContent = "";
    $("chart-to").textContent = "";
    $("chart-sentence").textContent = words;
    return;
  }
  bars($("chart"), series);
  $("chart-from").textContent = utcDay(series[0].day);
  $("chart-to").textContent = "Today";
  $("chart-sentence").textContent = chartSentence(series, CHARTS.find((c) => c.key === dash.chart).noun);
}
function renderHealth() {
  const list = $("health");
  const s = dash.stats;
  const rows = [];
  if (s === undefined) rows.push(none("Checking the relays…"));
  else if (s === null) rows.push(none("The relay check could not be read. Press Refresh to try again."));
  else if (s.ok === false) rows.push(none("Relay health: " + NOT_CONNECTED));
  else if (!s.relays?.length) rows.push(none("No relays are set up to check."));
  else {
    for (const r of s.relays) {
      const st = relayState(r);
      const quota = quotaOf(r);
      const line = [st.detail, quota ? `${number(quota.left)} of ${number(quota.max)} Euler requests left today` : "", r.version && r.version !== "—" ? `version ${r.version}` : ""].filter(Boolean).join(" · ");
      rows.push(el("li", { className: "dash__relay" }, el("span", { className: "dash__relay-name", textContent: relayName(r) }), withTone(el("span", { className: "dash__chip", textContent: st.word }), st.tone), el("span", { className: "dash__relay-line", textContent: line })));
    }
  }
  if (dash.overview) {
    const o = dash.overview;
    rows.push(el("li", { className: "dash__relay" }, el("span", { className: "dash__relay-name", textContent: "Database" }), withTone(el("span", { className: "dash__chip", textContent: "Online" }), "ok"), el("span", { className: "dash__relay-line", textContent: `${number(o.accounts.total)} accounts · ${number(o.summary.feedback.total)} feedback · ${size(o.summary.media.bytes)} of files` })));
  }
  list.replaceChildren(...rows);
}
function renderAccounts() {
  const o = dash.overview;
  if (!o) { $("accounts").replaceChildren(none("Loading…")); return; }
  bars($("signups"), o.accounts.perDay);
  const week = o.accounts.perDay.reduce((n, d) => n + d.n, 0);
  $("signups-sentence").textContent = `${plural(week, "sign-up", "sign-ups")} in the last 14 days.`;
  $("accounts").replaceChildren(...(o.recentAccounts.length ? o.recentAccounts.map((a) => {
    const top = el("div", { className: "dash__row-top" }, el("span", { className: "dash__row-main", textContent: a.email }));
    if (a.plus) { const tag = el("span", { className: "tag", textContent: PLUS_KIND_WORDS[a.plus] }); tag.dataset.kind = a.plus; top.append(tag); }
    const seen = a.lastLoginAt && a.lastLoginAt - a.createdAt > 60_000 ? ` · last signed in ${when(a.lastLoginAt)}` : "";
    return el("li", { className: "dash__row" }, top, el("span", { className: "dash__row-meta", textContent: `${a.plus ? "" : "Free account · "}Joined ${when(a.createdAt)}${seen}` }));
  }) : [none("No accounts yet.")]));
}
function renderLatest() {
  const o = dash.overview;
  if (!o) { $("latest").replaceChildren(none("Loading…")); return; }
  $("latest").replaceChildren(...(o.latestFeedback.length ? o.latestFeedback.map((f) => {
    const top = el("div", { className: "dash__row-top" }, el("span", { className: "tag", textContent: KINDS[f.kind] ?? f.kind }));
    if (f.status === "new") top.append(el("span", { className: "tag", textContent: "New" }));
    top.append(el("span", { className: "dash__row-meta", textContent: when(f.created) }));
    return el("li", { className: "dash__row" }, top, el("p", { className: "dash__clamp", textContent: f.message }));
  }) : [none("No feedback yet.")]));
}
function renderStatsParts() { renderAttention(); renderKpis(); renderChart(); renderHealth(); }
function renderOverview() { renderNav(); renderSub(); renderAttention(); renderKpis(); renderChart(); renderHealth(); renderAccounts(); renderLatest(); }

async function loadOverview() {
  dash.overview = await api("GET", "overview");
  dash.updatedAt = Date.now();
  renderOverview();
}
/** Traffic, relays and Euler quota. Slow, so it never holds the page up: the cards say "Loading…" until it answers. */
async function loadStats() {
  dash.stats = undefined;
  renderStatsParts();
  try { dash.stats = await api("GET", "stats"); } catch { dash.stats = null; }
  renderStatsParts();
}

/** A row of chips where one is pressed. Returns { get, set }. */
function pick(host, items, onPick) {
  let current = items[0][0];
  const buttons = items.map(([id, name]) => {
    const b = el("button", { type: "button", className: "chip", textContent: name });
    b.addEventListener("click", () => { current = id; mark(); onPick(id); });
    return [id, b];
  });
  const mark = () => buttons.forEach(([id, b]) => b.setAttribute("aria-pressed", String(id === current)));
  host.replaceChildren(...buttons.map(([, b]) => b));
  mark();
  return { get: () => current };
}

// ── Feedback ───────────────────────────────────────────────────────────────────────────────────────────────────────
let fNext = null;
const state = pick($("f-state"), [["", "All"], ["new", "Not done"], ["done", "Done"]], () => loadFeedback(true));

function feedbackCard(f) {
  const done = f.status === "done";
  const node = el("article", { className: "item" + (done ? " is-done" : "") });
  node.append(
    el("div", { className: "item__head" },
      el("span", { className: "tag", textContent: KINDS[f.kind] ?? f.kind }),
      ...(f.app ? [el("span", { className: "item__meta", textContent: APPS[f.app] ?? f.app })] : []),
      el("time", { className: "item__meta", dateTime: f.created, textContent: when(f.created) }),
      el("span", { className: "item__meta item__id", textContent: "#" + f.id }),
    ),
    el("p", { className: "item__text", textContent: f.message }),
  );
  if (f.contact) node.append(el("p", { className: "item__contact" }, "Contact: ", el("strong", { textContent: f.contact })));
  const actions = el("div", { className: "item__actions" });
  if (canMark) {
    const toggle = el("button", { type: "button", className: "btn btn--soft btn--sm", textContent: done ? "Mark not done" : "Mark done" });
    toggle.addEventListener("click", async () => {
      toggle.disabled = true;
      await run($("f-status"), async () => {
        const next = f.status === "done" ? "new" : "done";
        await api("PATCH", "feedback/" + f.id, { status: next });
        f.status = next;
        if (state.get() && state.get() !== next) node.remove();
        else { node.classList.toggle("is-done", next === "done"); toggle.textContent = next === "done" ? "Mark not done" : "Mark done"; }
        await refreshSummary();
      });
      toggle.disabled = false;
    });
    actions.append(toggle);
  }
  actions.append(confirmButton("Delete", () => run($("f-status"), async () => {
    await api("DELETE", "feedback/" + f.id);
    node.remove();
    await refreshSummary();
    if (!$("f-list").children.length) say($("f-status"), "Nothing here.");
    return true;
  }).then((ok) => { if (!ok) throw new Error("not deleted"); })));
  node.append(actions);
  return node;
}

async function loadFeedback(fresh) {
  const params = new URLSearchParams();
  if ($("f-kind").value) params.set("kind", $("f-kind").value);
  if (state.get()) params.set("status", state.get());
  if ($("f-search").value.trim()) params.set("q", $("f-search").value.trim());
  if (!fresh && fNext) params.set("before", String(fNext));
  say($("f-status"), "Loading…");
  const data = await run($("f-status"), () => api("GET", "feedback?" + params));
  if (!data) return;
  if (fresh) $("f-list").replaceChildren();
  $("f-list").append(...data.items.map(feedbackCard));
  fNext = data.next;
  $("f-more").hidden = !fNext;
  say($("f-status"), $("f-list").children.length ? "" : "Nothing here.");
}
$("f-more").addEventListener("click", () => loadFeedback(false));
$("f-kind").addEventListener("change", () => loadFeedback(true));
let searching = 0;
$("f-search").addEventListener("input", () => { clearTimeout(searching); searching = setTimeout(() => loadFeedback(true), 300); });

// ── Files ──────────────────────────────────────────────────────────────────────────────────────────────────────────
let mNext = null;
const kinds = pick($("m-kind"), [["", "All"], ["image", "Images"], ["sound", "Sounds"]], () => loadMedia(true));

function fileCard(m) {
  const url = "/api/media/" + m.id;
  const node = el("article", { className: "file" });
  const preview = m.kind === "image"
    ? el("img", { className: "file__img", src: url, alt: "", loading: "lazy", referrerPolicy: "no-referrer" })
    : el("audio", { className: "file__audio", src: url, controls: true, preload: "none" });
  const copy = el("button", { type: "button", className: "btn btn--soft btn--sm", textContent: "Copy link" });
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.origin + url); copy.textContent = "Copied"; } catch { copy.textContent = "Copy failed"; }
    setTimeout(() => { copy.textContent = "Copy link"; }, 1500);
  });
  node.append(
    el("div", { className: "file__preview" }, preview),
    el("p", { className: "file__meta" }, el("b", { textContent: m.kind === "image" ? "Image" : "Sound" }), ` ${m.mime.split("/")[1]} · ${size(m.size)}`),
    el("p", { className: "file__meta", textContent: when(m.created) }),
    el("p", { className: "file__id", textContent: m.id }),
    el("div", { className: "item__actions" }, copy, confirmButton("Delete", () => run($("m-status"), async () => {
      await api("DELETE", "media/" + m.id);
      node.remove();
      await refreshSummary();
      if (!$("m-list").children.length) say($("m-status"), "Nothing here.");
      return true;
    }).then((ok) => { if (!ok) throw new Error("not deleted"); }))),
  );
  return node;
}

async function loadMedia(fresh) {
  const params = new URLSearchParams();
  if (kinds.get()) params.set("kind", kinds.get());
  if (!fresh && mNext) params.set("before", mNext);
  say($("m-status"), "Loading…");
  const data = await run($("m-status"), () => api("GET", "media?" + params));
  if (!data) return;
  if (fresh) $("m-list").replaceChildren();
  $("m-list").append(...data.items.map(fileCard));
  mNext = data.next;
  $("m-more").hidden = !mNext;
  say($("m-status"), $("m-list").children.length ? "" : "Nothing here.");
}
$("m-more").addEventListener("click", () => loadMedia(false));

// ── Frills Plus VIP ────────────────────────────────────────────────────────────────────────────────────────────────
function plusCard(p) {
  const node = el("article", { className: "item" + (p.active ? "" : " is-done") });
  const kindTag = el("span", { className: p.comp ? "tag tag--vip" : "tag", textContent: p.comp ? "VIP (Free)" : p.manual ? "Manual" : "Paid" });
  const stateTag = el("span", { className: p.active ? "tag tag--vip" : "tag tag--off", textContent: p.active ? "Active" : p.status });
  const pct = Math.min(100, Math.round((100 * p.used) / Math.max(1, p.limit)));
  const bar = el("i", { className: "stat__bar" });
  bar.style.setProperty("--used", pct + "%");
  node.append(
    el("div", { className: "item__head" },
      kindTag,
      stateTag,
      el("strong", { textContent: p.email }),
      el("span", { className: "item__meta item__id", textContent: p.accountId }),
    ),
    el("p", { className: "item__meta", textContent: `AI voice: ${p.used.toLocaleString()} / ${p.limit.toLocaleString()} chars (${pct}%)` }),
    bar,
  );
  if (!p.comp && p.renewsAt) node.append(el("p", { className: "item__meta", textContent: `${p.active ? "Plus until" : "Plus ended"} ${when(p.renewsAt)}` }));
  const actions = el("div", { className: "item__actions" });
  const resetBtn = el("button", { type: "button", className: "btn btn--soft btn--sm", textContent: "Reset AI credits" });
  resetBtn.addEventListener("click", async () => {
    resetBtn.disabled = true;
    await run($("p-status"), async () => {
      await api("POST", `plus/${p.accountId}/reset`, {});
      say($("p-status"), `Reset AI voice credits for ${p.email}.`);
      await loadPlus();
    });
    resetBtn.disabled = false;
  });
  actions.append(resetBtn);
  if (p.active && !p.comp) {
    actions.append(confirmButton("Email: subscription active", () => run($("p-status"), async () => {
      const res = await api("POST", `plus/${p.accountId}/notify`);
      say($("p-status"), `Sent “Your Frills Plus subscription is active” to ${res.email}.`);
      return true;
    }).then((ok) => { if (!ok) throw new Error("not sent"); }).then(() => loadPlus()), { sure: "Really send?", busy: "Sending…", extra: "admin__confirm" }));
  }
  if ((p.comp || p.manual) && p.active) {
    actions.append(confirmButton(p.comp ? "Revoke VIP" : "End manual Plus", () => run($("p-status"), async () => {
      await api("DELETE", `plus/${p.accountId}`);
      say($("p-status"), `${p.comp ? "Revoked complimentary" : "Ended manual"} Frills Plus for ${p.email}.`);
      await Promise.all([loadPlus(), refreshSummary()]);
      return true;
    }).then((ok) => { if (!ok) throw new Error("not revoked"); })));
  } else if (p.comp && !p.active) {
    const restoreBtn = el("button", { type: "button", className: "btn btn--sm", textContent: "Re-enable VIP" });
    restoreBtn.addEventListener("click", async () => {
      restoreBtn.disabled = true;
      await run($("p-status"), async () => {
        await api("POST", "plus", { email: p.email, limit: p.limit });
        say($("p-status"), `Re-enabled VIP Frills Plus for ${p.email}.`);
        await Promise.all([loadPlus(), refreshSummary()]);
      });
      restoreBtn.disabled = false;
    });
    actions.append(restoreBtn);
  }
  node.append(actions);
  return node;
}

async function loadPlus(refreshOverview = true) {
  if (!$("p-list")) return;
  const data = await run($("p-status"), () => api("GET", "plus"));
  if (!data) return;
  $("p-list").replaceChildren(...(data.items ?? []).map(plusCard));
  // The line above the list keeps what an action just said ("Frills Plus is on for…"); only its own empty-list note comes and goes.
  const status = $("p-status");
  if (!$("p-list").children.length) say(status, "No Frills Plus or VIP accounts yet. Activate a customer or grant a VIP pass above.");
  else if (status.textContent.startsWith("No Frills Plus or VIP accounts yet")) say(status, "");
  if (refreshOverview && dash.overview) void loadOverview().catch(() => {});
}

$("p-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const address = $("p-email").value.trim();
  const limit = Number($("p-limit").value) || 150000;
  if (!address) return;
  $("p-grant").disabled = true;
  say($("p-status"), "Granting…");
  await run($("p-status"), async () => {
    const res = await api("POST", "plus", { email: address, limit });
    $("p-email").value = "";
    say($("p-status"), `Complimentary Frills Plus granted to ${res.email}. They can now sign in at /account/ with this email.`);
    await Promise.all([loadPlus(), refreshSummary()]);
  });
  $("p-grant").disabled = false;
});

$("mp-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const address = $("mp-email").value.trim();
  const days = Math.round(Number($("mp-days").value)) || 30;
  const limit = Number($("mp-limit").value) || 150000;
  const notify = $("mp-notify").checked;
  if (!address) return;
  $("mp-grant").disabled = true;
  say($("p-status"), "Activating…");
  await run($("p-status"), async () => {
    const res = await api("POST", "plus/manual", { email: address, days, limit, notify });
    $("mp-email").value = "";
    const mail = !notify ? "" : res.emailed ? " We emailed them." : res.emailError === "email_off" ? " The email was not sent: email is not set up on the server." : " The email could not be sent; use Email: subscription active in the list to try again.";
    say($("p-status"), `Frills Plus is now active for ${res.email} for ${plural(res.days, "day", "days")}${res.extended ? " more" : ""}, until ${when(res.renewsAt)}.${res.created ? " They have no account yet: they sign in at /account/ with this email." : ""}${mail}`);
    await Promise.all([loadPlus(), refreshSummary()]);
  });
  $("mp-grant").disabled = false;
});

async function refreshAll() {
  try {
    await refreshSummary();
    await Promise.all([loadOverview(), loadFeedback(true), loadMedia(true), loadPlus(false)]);
  } catch (error) {
    if (!(error instanceof Wrong)) throw error;
  }
  void loadStats();
}

if (key) enter(); else showDash(false);
{ const wanted = location.hash.slice(1); if (VIEWS[wanted]) tab(wanted); else renderOverview(); }
