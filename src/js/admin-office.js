// Frills Virtual Office (/admin/office/): cozy interactive studio floor with 5 specialist operator desks
// (Mochi Ops, Yuzu Growth, Boba Community, Kero QA, Mango Plus Sales), live relay & feedback telemetry, 1-click Ops Scan,
// copyable T3 agent prompts, and a D1-backed founder task & approval queue. Strictly textContent for user/DB text.

import { el } from "./feed.js";
import { mountOffice3D } from "./office-3d.js";

const $ = (id) => document.getElementById(id);
const KEY = "frills:admin:key";

let key = "";
let state = null;
let selectedAgent = "ops";
let statusFilter = "all";
let scopeFilter = "all";
let office3d = null;
let view3d = true;
try { key = sessionStorage.getItem(KEY) ?? ""; } catch { /* storage blocked */ }

class Wrong extends Error {}

const STATUS_LABELS = {
  idle: "Idle",
  working: "Working",
  waiting: "Needs review",
  alert: "Alert",
};

const TASK_STATUS_LABELS = {
  needs_review: "Needs review",
  working: "Working",
  queued: "Queued",
  approved: "Approved",
  done: "Done",
  archived: "Archived",
};

// Curated static kawaii desk mascot SVGs (never interpolated with untrusted data)
const MASCOT_SVGS = {
  frog: `<svg viewBox="0 0 96 84" aria-hidden="true">
    <ellipse cx="48" cy="76" rx="34" ry="6" fill="rgba(26,28,36,0.12)"/>
    <circle cx="30" cy="24" r="13" fill="#8fd694" stroke="#223027" stroke-width="3.5"/>
    <circle cx="66" cy="24" r="13" fill="#8fd694" stroke="#223027" stroke-width="3.5"/>
    <ellipse cx="48" cy="48" rx="32" ry="25" fill="#9de0a1" stroke="#223027" stroke-width="3.5"/>
    <ellipse cx="48" cy="56" rx="22" ry="13" fill="#e6f9d8"/>
    <circle cx="30" cy="24" r="5" fill="#223027"/><circle cx="28.5" cy="22.5" r="1.8" fill="#fff"/>
    <circle cx="66" cy="24" r="5" fill="#223027"/><circle cx="64.5" cy="22.5" r="1.8" fill="#fff"/>
    <ellipse cx="26" cy="48" rx="6" ry="3.5" fill="#f79eb2" opacity="0.8"/>
    <ellipse cx="70" cy="48" rx="6" ry="3.5" fill="#f79eb2" opacity="0.8"/>
    <path d="M40 48q8 6 16 0" fill="none" stroke="#223027" stroke-width="3.2" stroke-linecap="round"/>
  </svg>`,
  neko: `<svg viewBox="0 0 96 84" aria-hidden="true">
    <ellipse cx="48" cy="76" rx="34" ry="6" fill="rgba(26,28,36,0.12)"/>
    <path d="M22 38L18 14l20 12Z" fill="#ffd4e4" stroke="#3c2231" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M74 38l4-24-20 12Z" fill="#ffd4e4" stroke="#3c2231" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M24 31l-2-11 10 6Z" fill="#ff9cc2"/><path d="M72 31l2-11-10 6Z" fill="#ff9cc2"/>
    <ellipse cx="48" cy="48" rx="31" ry="24" fill="#fff0f6" stroke="#3c2231" stroke-width="3.5"/>
    <circle cx="36" cy="45" r="4.5" fill="#3c2231"/><circle cx="34.5" cy="43.5" r="1.6" fill="#fff"/>
    <circle cx="60" cy="45" r="4.5" fill="#3c2231"/><circle cx="58.5" cy="43.5" r="1.6" fill="#fff"/>
    <ellipse cx="26" cy="52" rx="5.5" ry="3.2" fill="#ff94b8" opacity="0.85"/>
    <ellipse cx="70" cy="52" rx="5.5" ry="3.2" fill="#ff94b8" opacity="0.85"/>
    <path d="M43 52q2.5 3.5 5 0q2.5 3.5 5 0" fill="none" stroke="#3c2231" stroke-width="2.8" stroke-linecap="round"/>
    <path d="M12 46h10M13 53h9M74 46h10M74 53h9" stroke="#3c2231" stroke-width="2.4" stroke-linecap="round"/>
  </svg>`,
  bunny: `<svg viewBox="0 0 96 84" aria-hidden="true">
    <ellipse cx="48" cy="76" rx="34" ry="6" fill="rgba(26,28,36,0.12)"/>
    <ellipse cx="36" cy="20" rx="8.5" ry="18" transform="rotate(-8 36 20)" fill="#e8dcff" stroke="#2d2247" stroke-width="3.5"/>
    <ellipse cx="60" cy="20" rx="8.5" ry="18" transform="rotate(8 60 20)" fill="#e8dcff" stroke="#2d2247" stroke-width="3.5"/>
    <ellipse cx="36" cy="21" rx="4" ry="11" transform="rotate(-8 36 21)" fill="#f8b6d2"/>
    <ellipse cx="60" cy="21" rx="4" ry="11" transform="rotate(8 60 21)" fill="#f8b6d2"/>
    <ellipse cx="48" cy="51" rx="30" ry="22" fill="#f5efff" stroke="#2d2247" stroke-width="3.5"/>
    <circle cx="37" cy="48" r="4.3" fill="#2d2247"/><circle cx="35.6" cy="46.6" r="1.5" fill="#fff"/>
    <circle cx="59" cy="48" r="4.3" fill="#2d2247"/><circle cx="57.6" cy="46.6" r="1.5" fill="#fff"/>
    <ellipse cx="28" cy="55" rx="5.5" ry="3.2" fill="#f79ec1" opacity="0.85"/>
    <ellipse cx="68" cy="55" rx="5.5" ry="3.2" fill="#f79ec1" opacity="0.85"/>
    <path d="M44 54q4 4 8 0" fill="none" stroke="#2d2247" stroke-width="2.8" stroke-linecap="round"/>
  </svg>`,
  duck: `<svg viewBox="0 0 96 84" aria-hidden="true">
    <ellipse cx="48" cy="76" rx="34" ry="6" fill="rgba(26,28,36,0.12)"/>
    <path d="M46 24q-3-11 7-9" fill="none" stroke="#3b2a05" stroke-width="3.5" stroke-linecap="round"/>
    <ellipse cx="48" cy="50" rx="31" ry="24" fill="#ffe27a" stroke="#3b2a05" stroke-width="3.5"/>
    <ellipse cx="48" cy="60" rx="20" ry="11" fill="#fff3bf"/>
    <circle cx="36" cy="44" r="4.3" fill="#3b2a05"/><circle cx="34.6" cy="42.6" r="1.5" fill="#fff"/>
    <circle cx="60" cy="44" r="4.3" fill="#3b2a05"/><circle cx="58.6" cy="42.6" r="1.5" fill="#fff"/>
    <path d="M37 52q11-7 22 0q-2 10-11 10t-11-10z" fill="#ff9d3d" stroke="#3b2a05" stroke-width="3" stroke-linejoin="round"/>
    <ellipse cx="25" cy="52" rx="5.5" ry="3.2" fill="#f79ec1" opacity="0.85"/>
    <ellipse cx="71" cy="52" rx="5.5" ry="3.2" fill="#f79ec1" opacity="0.85"/>
  </svg>`,
  hamster: `<svg viewBox="0 0 96 84" aria-hidden="true">
    <ellipse cx="48" cy="76" rx="34" ry="6" fill="rgba(26,28,36,0.12)"/>
    <circle cx="24" cy="28" r="10" fill="#ffd97d" stroke="#3c2814" stroke-width="3.5"/>
    <circle cx="72" cy="28" r="10" fill="#ffd97d" stroke="#3c2814" stroke-width="3.5"/>
    <circle cx="24" cy="28" r="5" fill="#f9b5c4"/><circle cx="72" cy="28" r="5" fill="#f9b5c4"/>
    <ellipse cx="48" cy="48" rx="33" ry="24" fill="#ffe8a8" stroke="#3c2814" stroke-width="3.5"/>
    <ellipse cx="48" cy="57" rx="22" ry="12" fill="#fff8e3"/>
    <rect x="28" y="38" width="16" height="12" rx="5" fill="rgba(255,255,255,0.65)" stroke="#3c2814" stroke-width="2.6"/>
    <rect x="52" y="38" width="16" height="12" rx="5" fill="rgba(255,255,255,0.65)" stroke="#3c2814" stroke-width="2.6"/>
    <path d="M44 44h8" stroke="#3c2814" stroke-width="2.6"/>
    <circle cx="36" cy="44" r="3.4" fill="#3c2814"/><circle cx="60" cy="44" r="3.4" fill="#3c2814"/>
    <ellipse cx="24" cy="53" rx="6" ry="3.5" fill="#f796a8" opacity="0.8"/>
    <ellipse cx="72" cy="53" rx="6" ry="3.5" fill="#f796a8" opacity="0.8"/>
    <path d="M44 53q4 3.5 8 0" fill="none" stroke="#3c2814" stroke-width="2.8" stroke-linecap="round"/>
  </svg>`,
};

const QUICK_BRIEFS = {
  sales: [
    ["+ Check Funnel Now", "Review the Plus funnel and what changed this week", "Read Mango's last brief in the log, compare it with /admin/stats/, and name the one thing to change."],
    ["+ Write New Tips", "Write 3 new public Plus tips for the library in worker/plus-agent.mjs", "Facts from /plus/ only, ending with the exact PUBLIC_TAIL line, no hype words. The tests lint every one."],
  ],
  growth: [
    ["+ TikTok VTS Clip", "Draft 30s TikTok clip: VTuber Sticky Notes & Paw Stamps", "Focus on free 5 pastel notes -> Plus chibi paw/heart/cloud shapes in /actions/."],
    ["+ X Launch Thread", "Draft 4-post X thread: Frills Plus 1-Link Master Scene", "Highlight 1-click theme switching + crash-proof subathon memory for $5.99/mo."],
    ["+ Creator Outreach", "Draft 5 DM templates for Founding 20 VTuber & TikTok creators", "Friendly, zero-spam offer of free Frills Plus in exchange for honest stream feedback."],
  ],
  qa: [
    ["+ Full Regression", "Run full build + unit/browser regression suite", "Verify node build.mjs, /overlay/ <= 22.5 KB gzip, CSP headers, and zero console errors."],
    ["+ Mobile 320px Sweep", "Audit mobile 320px layout across editors & /start/", "Ensure zero horizontal scroll or clipped buttons on phone viewports."],
    ["+ SEO & Sitemap Check", "Audit sitemap dates, descriptions, and structured data", "Verify test/site.test.mjs & test/plus-words.test.mjs pass with accounts on and off."],
  ],
};

async function api(method, path, body) {
  let res;
  try {
    res = await fetch("/api/admin/" + path, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new Wrong("Could not reach the server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  if (res.status === 401) { logout("That is not the right password."); throw new Wrong("That is not the right password."); }
  if (res.status === 429) throw new Wrong("Too many wrong tries. Wait ten minutes, then try again.");
  if (res.status === 503 && data.error === "admin_off") throw new Wrong("The admin side is switched off. Set the ADMIN_KEY secret in Cloudflare (12+ chars).");
  if (res.status === 503) throw new Wrong("The database is not ready yet.");
  throw new Wrong(data.error ? `Error: ${data.error}` : `Something went wrong (${res.status}).`);
}

const say = (node, text, bad = false) => { if (!node) return; node.textContent = text; node.dataset.state = bad ? "error" : ""; };
const fmtTime = (ms) => {
  if (!ms) return "Never";
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
};
const fmtBytes = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");

function confirmBtn(label, action) {
  const btn = el("button", { type: "button", className: "btn btn--outline btn--sm admin__danger", textContent: label });
  let timer = 0;
  btn.addEventListener("click", async () => {
    if (!btn.dataset.sure) {
      btn.dataset.sure = "1";
      btn.textContent = "Really delete?";
      timer = setTimeout(() => { delete btn.dataset.sure; btn.textContent = label; }, 4000);
      return;
    }
    clearTimeout(timer);
    btn.disabled = true;
    btn.textContent = "Deleting…";
    try { await action(); } catch { btn.disabled = false; delete btn.dataset.sure; btn.textContent = label; }
  });
  return btn;
}

function buildAgentPrompt(agent) {
  const pulse = state?.pulse;
  const relays = (pulse?.relays ?? []).map((r) => `${r.host}: ${r.ok ? `${r.used}/${r.max} live` : "OFFLINE"}`).join(", ") || "not probed";
  const openTasks = (state?.tasks ?? [])
    .filter((t) => t.agentId === agent.id && (t.status === "queued" || t.status === "working" || t.status === "needs_review"))
    .slice(0, 3)
    .map((t) => `- [${t.status}] ${t.title}${t.body ? ` — ${t.body}` : ""}`)
    .join("\n") || "- (No open tasks queued — pick the highest-impact item from your playbook)";
  return [
    `Act as ${agent.name} (${agent.role}) in the Frills Virtual Office.`,
    `First read your playbook: ${agent.playbook}.`,
    `Live studio snapshot: Relays (${relays}) | Plus subs: ${pulse?.accounts?.plusActive ?? 0} | Unread feedback: ${pulse?.feedback?.new ?? 0}.`,
    `Current open tasks for your desk:\n${openTasks}`,
    "Execute your next task thoroughly and return a clean, copy-ready deliverable I can approve in /admin/office/.",
  ].join("\n\n");
}

// ── Auth ────────────────────────────────────────────────────────────────────────────────────────────────────────
function showDash(on) {
  $("login").hidden = on;
  $("dash").hidden = !on;
  $("bar-actions").hidden = !on;
}

function logout(message = "") {
  key = "";
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  showDash(false);
  $("key").value = "";
  say($("login-status"), message, Boolean(message));
}

async function refresh(probe = true) {
  say($("office-status"), "Syncing Virtual Office…");
  try {
    state = await api("GET", probe ? "office" : "office?probe=0");
    renderAll();
    say($("office-sync"), `Synced ${fmtTime(state.now)}`);
    say($("office-status"), "");
  } catch (err) {
    if (err instanceof Wrong) say($("office-status"), err.message, true);
    else throw err;
  }
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  key = $("key").value.trim();
  if (!key) return;
  say($("login-status"), "Unlocking Frills HQ…");
  $("login-go").disabled = true;
  try {
    state = await api("GET", "office");
    try { sessionStorage.setItem(KEY, key); } catch { /* ignore */ }
    say($("login-status"), "");
    showDash(true);
    renderAll();
    say($("office-sync"), `Synced ${fmtTime(state.now)}`);
  } catch (err) {
    if (err instanceof Wrong && !$("login").hidden) say($("login-status"), err.message, true);
    else if (!(err instanceof Wrong)) throw err;
  } finally {
    $("login-go").disabled = false;
  }
});

$("logout").addEventListener("click", () => logout());
$("refresh").addEventListener("click", () => void refresh(true));

$("office-scan").addEventListener("click", async () => {
  const btn = $("office-scan");
  btn.disabled = true;
  btn.textContent = "Scanning…";
  say($("office-status"), "Mochi is probing live relays, Plus accounts, and /feedback/…");
  try {
    const res = await api("POST", "office/scan", {});
    await refresh(false);
    say(
      $("office-status"),
      res.issues?.length ? `Ops scan flagged: ${res.issues.join("; ")}.` : "Live Ops Scan complete — all relays and systems healthy.",
      Boolean(res.issues?.length),
    );
  } catch (err) {
    if (err instanceof Wrong) say($("office-status"), err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Run Live Scan";
  }
});

// ── Filters & Composer ──────────────────────────────────────────────────────────────────────────────────────────
function mountChipGroup(host, items, get, set) {
  const btns = items.map(([id, text]) => {
    const b = el("button", { type: "button", className: "chip", textContent: text });
    b.addEventListener("click", () => { set(id); mark(); renderTasks(); });
    return [id, b];
  });
  const mark = () => btns.forEach(([id, b]) => b.setAttribute("aria-pressed", String(id === get())));
  host.replaceChildren(...btns.map(([, b]) => b));
  mark();
  return { mark };
}

const statusChips = mountChipGroup(
  $("f-status"),
  [["all", "All"], ["needs_review", "Needs review"], ["active", "Queued & working"], ["finished", "Approved & done"]],
  () => statusFilter,
  (v) => { statusFilter = v; },
);
const scopeChips = mountChipGroup(
  $("f-scope"),
  [["all", "All 4 desks"], ["selected", "Selected desk only"]],
  () => scopeFilter,
  (v) => { scopeFilter = v; },
);

function openComposer({ agentId = selectedAgent, title = "", body = "", output = "", priority = "normal", status = "queued" } = {}) {
  const form = $("task-form");
  form.hidden = false;
  $("t-agent").value = agentId;
  $("t-title").value = title;
  $("t-body").value = body;
  $("t-output").value = output;
  $("t-priority").value = priority;
  $("t-status").value = status;
  $("t-title").focus();
}

$("toggle-composer").addEventListener("click", () => {
  const form = $("task-form");
  if (form.hidden) openComposer({ agentId: selectedAgent });
  else form.hidden = true;
});
$("t-cancel").addEventListener("click", () => { $("task-form").hidden = true; });

$("task-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("t-title").value.trim();
  if (!title) return;
  const btn = $("t-submit");
  btn.disabled = true;
  try {
    await api("POST", "office/tasks", {
      agentId: $("t-agent").value,
      priority: $("t-priority").value,
      status: $("t-status").value,
      title,
      body: $("t-body").value.trim(),
      output: $("t-output").value.trim(),
      source: "founder",
    });
    $("task-form").hidden = true;
    await refresh(false);
    say($("office-status"), `Assigned “${title}”.`);
  } catch (err) {
    if (err instanceof Wrong) say($("office-status"), err.message, true);
  } finally {
    btn.disabled = false;
  }
});

// ── Rendering ───────────────────────────────────────────────────────────────────────────────────────────────────
function renderRibbon() {
  const p = state.pulse;
  const relays = p.relays ?? [];
  const online = relays.filter((r) => r.ok);
  const used = online.reduce((s, r) => s + (r.used || 0), 0);
  const max = online.reduce((s, r) => s + (r.max || 0), 0);
  $("rib-relays").textContent = relays.length
    ? `${online.length}/${relays.length} Online · ${used}/${max} live`
    : "Standby (run scan)";
  $("rib-plus").textContent = `${p.accounts.plusActive} active · ${p.accounts.total} accts · ${p.accounts.cloudOverlays} cloud`;
  $("rib-feedback").textContent = `${p.feedback.new} unread of ${p.feedback.total}`;
  $("rib-review").textContent = `${state.counts.needsReview} to review · ${state.counts.queued + state.counts.working} active`;
}

function renderFloor() {
  const host = $("office-floor");
  host.replaceChildren();
  const workingCount = state.agents.filter((a) => a.status === "working" || a.status === "waiting").length;
  $("office-floor-tag").textContent = workingCount ? `${workingCount} DESK${workingCount === 1 ? "" : "S"} ACTIVE` : "4 DESKS ON STANDBY";

  state.agents.forEach((agent, idx) => {
    const desk = el("button", { type: "button", className: "office__desk" });
    desk.dataset.agent = agent.id;
    desk.dataset.accent = agent.accent;
    desk.dataset.status = agent.status;
    desk.setAttribute("aria-pressed", String(agent.id === selectedAgent));

    const head = el(
      "div",
      { className: "office__desk-top" },
      el("span", { className: "office__room-tag", textContent: `${idx + 1} · ${agent.room}` }),
      el("span", { className: "office__beacon", textContent: STATUS_LABELS[agent.status] || agent.status }),
    );

    const avatar = el("div", { className: "office__avatar" });
    avatar.innerHTML = MASCOT_SVGS[agent.mascot] || MASCOT_SVGS.frog;

    const screen = el(
      "div",
      { className: "office__monitor" },
      el("span", { className: "office__monitor-bar" }),
      el("span", { className: "office__monitor-bar office__monitor-bar--short" }),
    );
    const workstation = el("div", { className: "office__workstation" }, avatar, screen);

    const bubble = el("p", {
      className: "office__bubble",
      textContent: agent.currentTask || agent.summary,
    });

    const footer = el(
      "div",
      { className: "office__desk-foot" },
      el("div", { className: "office__who" }, el("strong", { textContent: agent.name }), el("span", { textContent: agent.role })),
      el("span", {
        className: "office__pill",
        textContent: agent.tasks.needsReview
          ? `${agent.tasks.needsReview} review`
          : `${agent.tasks.active} active`,
      }),
    );

    desk.append(head, workstation, bubble, footer);
    desk.addEventListener("click", () => selectDesk(agent.id, { focus3d: true }));
    host.append(desk);
  });
}

function renderInspector() {
  const host = $("office-inspector");
  const agent = state.agents.find((a) => a.id === selectedAgent) ?? state.agents[0];
  if (!agent) return;

  const avatar = el("div", { className: "office__avatar office__avatar--lg" });
  avatar.innerHTML = MASCOT_SVGS[agent.mascot] || MASCOT_SVGS.frog;

  const head = el(
    "div",
    { className: "office__insp-head" },
    avatar,
    el(
      "div",
      { className: "office__insp-meta" },
      el("span", { className: "office__room-tag", textContent: agent.room }),
      el("h3", { className: "office__insp-name", textContent: `${agent.name} — ${agent.role}` }),
      el("p", { className: "admin__note", textContent: `Playbook: ${agent.playbook} · Last check: ${fmtTime(agent.lastRunAt)}` }),
    ),
  );

  // Quick status pills for the selected bot
  const statusRow = el("div", { className: "office__insp-statuses" });
  for (const st of ["idle", "working", "waiting", "alert"]) {
    const b = el("button", { type: "button", className: "chip", textContent: STATUS_LABELS[st] });
    b.setAttribute("aria-pressed", String(agent.status === st));
    b.addEventListener("click", async () => {
      try {
        await api("PATCH", `office/agents/${agent.id}`, { status: st, touchRun: true });
        await refresh(false);
      } catch (err) {
        if (err instanceof Wrong) say($("office-status"), err.message, true);
      }
    });
    statusRow.append(b);
  }

  const summaryBox = el(
    "div",
    { className: "office__insp-box" },
    el("span", { className: "office__kicker", textContent: "Latest desk report" }),
    el("p", { className: "office__insp-text", textContent: agent.lastSummary }),
  );

  // Actions: Copy T3 Agent Prompt + Assign Task
  const copyPrompt = el("button", { type: "button", className: "btn btn--sm", textContent: `Copy ${agent.name} Prompt` });
  copyPrompt.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(buildAgentPrompt(agent));
      copyPrompt.textContent = "Prompt copied!";
    } catch {
      copyPrompt.textContent = "Copy failed";
    }
    setTimeout(() => { copyPrompt.textContent = `Copy ${agent.name} Prompt`; }, 1800);
  });
  const assignBtn = el("button", { type: "button", className: "btn btn--soft btn--sm", textContent: `+ Assign to ${agent.name}` });
  assignBtn.addEventListener("click", () => openComposer({ agentId: agent.id }));
  const btnRow = el("div", { className: "office__insp-actions" }, copyPrompt, assignBtn);

  // Desk-specific live telemetry / quick tools
  const extra = el("div", { className: "office__insp-extra" });
  if (agent.id === "ops") {
    extra.append(el("span", { className: "office__kicker", textContent: "Live Relay & Storage Pulse" }));
    const list = el("ul", { className: "office__mini-list" });
    for (const r of state.pulse.relays) {
      list.append(el("li", {}, el("strong", { textContent: r.host }), el("span", { textContent: r.ok ? ` · ${r.used}/${r.max} live (${r.latencyMs}ms)` : " · OFFLINE" })));
    }
    if (!state.pulse.relays.length) list.append(el("li", { textContent: "Press Run Live Scan to probe both TikTok relays." }));
    list.append(el("li", {}, el("strong", { textContent: "Alert media:" }), el("span", { textContent: ` ${state.pulse.media.count} files · ${fmtBytes(state.pulse.media.bytes)} of ${fmtBytes(state.pulse.media.limit)}` })));
    extra.append(list);
  } else if (agent.id === "community") {
    extra.append(el("span", { className: "office__kicker", textContent: `Unread /feedback/ (${state.pulse.feedback.new})` }));
    const list = el("div", { className: "office__fb-list" });
    const recent = state.pulse.feedback.recentNew ?? [];
    if (!recent.length) {
      list.append(el("p", { className: "admin__note", textContent: "Inbox zero! No unread feedback messages right now." }));
    } else {
      for (const fb of recent) {
        const toTask = el("button", { type: "button", className: "btn btn--soft btn--sm", textContent: "+ Queue for Boba" });
        toTask.addEventListener("click", async () => {
          toTask.disabled = true;
          try {
            await api("POST", "office/tasks", {
              agentId: "community",
              kind: "support",
              priority: fb.kind === "broken" ? "high" : "normal",
              status: "needs_review",
              source: "feedback",
              feedbackId: fb.id,
              title: `Triage feedback #${fb.id} (${fb.kind})`,
              body: `${fb.message}${fb.contact ? `\nContact: ${fb.contact}` : ""}${fb.app ? `\nApp: ${fb.app}` : ""}`,
              output: `Suggested reply / action for #${fb.id}: review user message and mark Approved to auto-resolve feedback #${fb.id} in /admin/.`,
            });
            await refresh(false);
            say($("office-status"), `Queued feedback #${fb.id} on Boba’s desk — approving it will auto-resolve #${fb.id} in /admin/.`);
          } catch (err) {
            if (err instanceof Wrong) say($("office-status"), err.message, true);
          } finally {
            toTask.disabled = false;
          }
        });
        list.append(
          el(
            "div",
            { className: "office__fb-row" },
            el("p", { className: "office__fb-msg", textContent: `#${fb.id} [${fb.kind}] ${fb.message}` }),
            toTask,
          ),
        );
      }
    }
    extra.append(list);
  } else if (QUICK_BRIEFS[agent.id]) {
    extra.append(el("span", { className: "office__kicker", textContent: "Quick Starter Assignments" }));
    const row = el("div", { className: "office__quick-row" });
    for (const [label, title, body] of QUICK_BRIEFS[agent.id]) {
      const b = el("button", { type: "button", className: "btn btn--soft btn--sm", textContent: label });
      b.addEventListener("click", () => openComposer({ agentId: agent.id, title, body, priority: "high" }));
      row.append(b);
    }
    extra.append(row);
  }

  host.replaceChildren(head, statusRow, summaryBox, btnRow, extra);
}

function renderHooks() {
  const host = $("office-hooks");
  if (!host || !state?.pulse?.hooks) return;
  const h = state.pulse.hooks;

  const hookPill = (title, on, detail, testChannel = "") => {
    const badge = el("span", { className: "office__hook-state", textContent: on ? "ACTIVE" : "OPTIONAL" });
    badge.dataset.on = on ? "true" : "false";
    const row = el(
      "div",
      { className: "office__hook" },
      el("div", { className: "office__hook-top" }, el("strong", { textContent: title }), badge),
      el("span", { className: "office__hook-sub", textContent: detail }),
    );
    if (on && testChannel) {
      const btn = el("button", { type: "button", className: "btn btn--soft btn--sm", textContent: "Test Ping" });
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          const res = await api("POST", "office/hooks/test", { channel: testChannel });
          say($("office-status"), res.detail || "Sent Discord test ping.");
        } catch (err) {
          if (err instanceof Wrong) say($("office-status"), err.message, true);
        } finally {
          btn.disabled = false;
        }
      });
      row.append(btn);
    }
    return row;
  };

  host.replaceChildren(
    hookPill("Auto-Resolve /feedback/", true, "Approving Boba’s linked support cards automatically marks them Done in /admin/."),
    hookPill(
      "Discord #founder-ops",
      h.discordOffice,
      h.discordOffice ? "Approved tasks & urgent relay alerts post automatically." : "Add DISCORD_OFFICE_WEBHOOK secret in Cloudflare to post on Approve.",
      "office",
    ),
    hookPill(
      "Discord #announcements",
      h.discordAnnounce,
      h.discordAnnounce ? "Unlocks 1-click Approve & Announce on Yuzu & Boba cards." : "Optional: add DISCORD_ANNOUNCE_WEBHOOK secret for public posts.",
      "announce",
    ),
    hookPill("T3 Agent Sync CLI", true, "Run scripts/office-sync.mjs locally or via /schedule to check in 3D & deliver drafts."),
  );
}

function renderTasks() {
  const host = $("office-tasks");
  const agentsById = new Map(state.agents.map((a) => [a.id, a]));
  const hooks = state.pulse?.hooks ?? {};
  const items = state.tasks.filter((t) => {
    if (scopeFilter === "selected" && t.agentId !== selectedAgent) return false;
    if (statusFilter === "needs_review") return t.status === "needs_review";
    if (statusFilter === "active") return t.status === "queued" || t.status === "working";
    if (statusFilter === "finished") return t.status === "approved" || t.status === "done";
    return t.status !== "archived";
  });

  if (!items.length) {
    host.replaceChildren(el("p", { className: "admin__note", textContent: "No tasks match this filter. Press “+ Assign Task” or pick another desk." }));
    return;
  }

  host.replaceChildren(...items.map((task) => {
    const owner = agentsById.get(task.agentId);
    const card = el("article", { className: "office__task" });
    card.dataset.status = task.status;
    card.dataset.agent = task.agentId;

    const head = el(
      "div",
      { className: "office__task-head" },
      el("span", { className: "office__agent-tag", textContent: owner ? `${owner.name} · ${owner.room}` : task.agentId }),
      el("span", { className: "office__status-pill", textContent: TASK_STATUS_LABELS[task.status] || task.status }),
      ...(task.priority !== "normal" ? [el("span", { className: "office__prio", textContent: task.priority.toUpperCase() })] : []),
      ...(task.feedbackId ? [el("span", { className: "office__fb-pill", textContent: `Feedback #${task.feedbackId} (auto-resolves)` })] : []),
      el("span", { className: "item__meta item__id", textContent: `#${task.id} · ${fmtTime(task.updatedAt)}` }),
    );

    const title = el("h3", { className: "office__task-title", textContent: task.title });
    const body = task.body ? el("p", { className: "office__task-body", textContent: task.body }) : null;
    const outputPre = task.output ? el("pre", { className: "office__output", textContent: task.output }) : null;
    const receipt = task.actionLog ? el("p", { className: "office__receipt", textContent: task.actionLog }) : null;

    // Inline editor box for updating output
    const editBox = el("div", { className: "office__edit", hidden: true });
    const editArea = el("textarea", { rows: 5, maxLength: 8000, value: task.output || "" });
    const saveEdit = el("button", { type: "button", className: "btn btn--sm", textContent: "Save Deliverable" });
    saveEdit.addEventListener("click", async () => {
      saveEdit.disabled = true;
      try {
        await api("PATCH", `office/tasks/${task.id}`, { output: editArea.value, status: task.status === "queued" ? "needs_review" : task.status });
        await refresh(false);
      } catch (err) {
        if (err instanceof Wrong) say($("office-status"), err.message, true);
      } finally {
        saveEdit.disabled = false;
      }
    });
    const cancelEdit = el("button", { type: "button", className: "btn btn--soft btn--sm", textContent: "Close" });
    cancelEdit.addEventListener("click", () => { editBox.hidden = true; });
    editBox.append(editArea, el("div", { className: "office__composer-actions" }, saveEdit, cancelEdit));

    const actions = el("div", { className: "item__actions" });
    if (task.output) {
      const copyOut = el("button", { type: "button", className: "btn btn--sm", textContent: "Copy Deliverable" });
      copyOut.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(task.output); copyOut.textContent = "Copied!"; } catch { copyOut.textContent = "Copy failed"; }
        setTimeout(() => { copyOut.textContent = "Copy Deliverable"; }, 1600);
      });
      actions.append(copyOut);
    }

    const moveBtn = (label, nextStatus, extra = {}, cls = "btn btn--soft btn--sm") => {
      const b = el("button", { type: "button", className: cls, textContent: label });
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          const res = await api("PATCH", `office/tasks/${task.id}`, { status: nextStatus, ...extra });
          if (nextStatus === "approved" || nextStatus === "done") office3d?.celebrate(task.agentId);
          await refresh(false);
          if (res.actions?.length) {
            const msg = res.actions.map((a) => `${a.ok ? "✓" : "⚠"} ${a.detail}`).join(" · ");
            say($("office-status"), msg, res.actions.some((a) => !a.ok));
          } else if (nextStatus === "approved") {
            say($("office-status"), `Approved “${task.title}”.`);
          }
        } catch (err) {
          if (err instanceof Wrong) say($("office-status"), err.message, true);
        } finally {
          b.disabled = false;
        }
      });
      return b;
    };

    if (task.status === "needs_review") {
      const approveLabel = hooks.discordOffice
        ? (task.feedbackId ? `Approve · Discord & Resolve #${task.feedbackId}` : "Approve & Send to Discord")
        : (task.feedbackId ? `Approve & Resolve #${task.feedbackId}` : "Approve");
      actions.append(moveBtn(approveLabel, "approved", {}, "btn btn--sm"));
      if (hooks.discordAnnounce && (task.agentId === "growth" || task.agentId === "community")) {
        actions.append(moveBtn("Approve & Announce", "approved", { publishDiscord: "announce" }));
      }
      if (hooks.discordOffice) {
        actions.append(moveBtn("Approve only", "approved", { publishDiscord: "none" }));
      }
      actions.append(moveBtn("Mark Done", "done"));
    } else if (task.status === "queued" || task.status === "working") {
      actions.append(moveBtn("Send to Review", "needs_review"), moveBtn(task.feedbackId ? `Done & Resolve #${task.feedbackId}` : "Mark Done", "done"));
    } else if (task.status === "approved") {
      actions.append(moveBtn("Mark Done", "done"));
    } else {
      actions.append(moveBtn("Reopen", "queued"));
    }

    const editBtn = el("button", { type: "button", className: "btn btn--soft btn--sm", textContent: task.output ? "Edit Output" : "+ Add Output" });
    editBtn.addEventListener("click", () => { editBox.hidden = !editBox.hidden; if (!editBox.hidden) editArea.focus(); });
    actions.append(editBtn);

    actions.append(confirmBtn("Delete", async () => {
      await api("DELETE", `office/tasks/${task.id}`);
      await refresh(false);
    }));

    card.append(head, title);
    if (body) card.append(body);
    if (outputPre) card.append(outputPre);
    if (receipt) card.append(receipt);
    card.append(editBox, actions);
    return card;
  }));
}

function selectDesk(agentId, { focus3d = true } = {}) {
  selectedAgent = agentId;
  renderFloor();
  renderInspector();
  if (scopeFilter === "selected") renderTasks();
  if (office3d) {
    office3d.sync(state, selectedAgent);
    if (focus3d && view3d) office3d.focusAgent(selectedAgent);
  }
}

function ensure3D() {
  const wrap = $("office-3d-wrap");
  if (!wrap) return;
  if (!view3d) {
    wrap.hidden = true;
    $("office-floor")?.classList.remove("office__floor--dock");
    return;
  }
  if (!office3d && state?.agents?.length) {
    office3d = mountOffice3D({
      canvasHost: $("office-3d-canvas"),
      overlayHost: $("office-3d-labels"),
      agents: state.agents,
      onSelect: (id) => selectDesk(id, { focus3d: true }),
    });
  }
  if (!office3d) {
    view3d = false;
    wrap.hidden = true;
    if ($("office-mode")) $("office-mode").hidden = true;
    if ($("office-overview")) $("office-overview").hidden = true;
    if ($("office-theme")) $("office-theme").hidden = true;
    return;
  }
  wrap.hidden = false;
  $("office-floor")?.classList.add("office__floor--dock");
  office3d.resize();
  office3d.sync(state, selectedAgent);
}

$("office-overview")?.addEventListener("click", () => office3d?.resetOverview());
$("office-theme")?.addEventListener("click", () => {
  if (!office3d) return;
  const next = !office3d.isNight();
  office3d.setNight(next);
  $("office-theme").textContent = next ? "Sunny Day" : "Cozy Night";
});
$("office-mode")?.addEventListener("click", () => {
  view3d = !view3d;
  $("office-mode").textContent = view3d ? "2D View" : "3D Space";
  if ($("office-overview")) $("office-overview").hidden = !view3d;
  if ($("office-theme")) $("office-theme").hidden = !view3d;
  ensure3D();
});
window.addEventListener("pagehide", () => office3d?.dispose());

function renderAll() {
  if (!state) return;
  renderRibbon();
  renderFloor();
  renderInspector();
  renderHooks();
  statusChips.mark();
  scopeChips.mark();
  renderTasks();
  ensure3D();
}

document.addEventListener("keydown", (e) => {
  if ($("dash").hidden || !state) return;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target?.tagName)) return;
  if (e.key === "0") { office3d?.resetOverview(); return; }
  const idx = Number(e.key) - 1;
  if (idx >= 0 && idx < state.agents.length) {
    selectDesk(state.agents[idx].id, { focus3d: true });
  }
});

if (key) {
  showDash(true);
  void refresh(true);
} else {
  showDash(false);
}
