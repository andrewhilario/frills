// The admin page: log in with the password, read the feedback, mark it done, and look at and remove the uploaded files. It only talks to
// /api/admin/ (worker/admin.mjs). The password is kept in this tab's session storage and sent with every call; closing the tab forgets it.
// Everything that came from visitors (messages, contacts, ids) goes in with textContent, never as HTML.

import { el } from "./feed.js";

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
  throw new Wrong("Something went wrong (" + res.status + ").");
}

const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const size = (bytes) => (bytes >= 1073741824 ? (bytes / 1073741824).toFixed(1).replace(/\.0$/, "") + " GB" : bytes >= 1048576 ? (bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB");
const say = (node, text, bad = false) => { node.textContent = text; node.dataset.state = bad ? "error" : ""; };
const run = async (node, job) => { try { return await job(); } catch (error) { if (error instanceof Wrong) say(node, error.message, true); else throw error; return undefined; } };

/** A delete button that asks twice: the first press changes it to "Really delete?", the second does it. It relaxes after a few seconds. */
function confirmButton(label, action) {
  const button = el("button", { type: "button", className: "btn btn--outline btn--sm admin__danger", textContent: label });
  let timer = 0;
  button.addEventListener("click", async () => {
    if (!button.dataset.sure) {
      button.dataset.sure = "1";
      button.textContent = "Really delete?";
      timer = setTimeout(() => { delete button.dataset.sure; button.textContent = label; }, 4000);
      return;
    }
    clearTimeout(timer);
    button.disabled = true;
    button.textContent = "Deleting…";
    try { await action(); } catch { button.disabled = false; delete button.dataset.sure; button.textContent = label; }
  });
  return button;
}

// ── Login ──────────────────────────────────────────────────────────────────────────────────────────────────────────
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
function tab(which) {
  for (const name of ["feedback", "files"]) {
    $("panel-" + name).hidden = name !== which;
    $("tab-" + name).setAttribute("aria-pressed", String(name === which));
  }
}
$("tab-feedback").addEventListener("click", () => tab("feedback"));
$("tab-files").addEventListener("click", () => tab("files"));

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

async function refreshAll() {
  try {
    await refreshSummary();
    await Promise.all([loadFeedback(true), loadMedia(true)]);
  } catch (error) {
    if (!(error instanceof Wrong)) throw error;
  }
}

if (key) enter(); else showDash(false);
