// Virtual Office backend (/api/admin/office/*): manages the 5 Frills operator desks (Mochi Ops, Yuzu Growth,
// Boba Community, Kero QA, Mango Plus Sales), their task & approval queue in D1, real-time operational pulse (relay fleet,
// Frills Plus subscriber counts, unread /feedback/ queue, media storage), and real approval execution hooks
// (auto-resolving linked /feedback/ items + optional Discord Ops / Announcements webhook publishing).

import { MEDIA } from "./media.mjs";
import { checkRelays } from "./stats-report.mjs";

export const OFFICE_AGENTS = [
  {
    id: "ops",
    name: "Mochi",
    role: "Ops & Relay Watchdog",
    mascot: "frog",
    room: "Server Bay",
    accent: "mint",
    embedColor: 0x7fd694,
    playbook: "ops/agents/mochi-ops.md",
    summary: "Watches live TikTok relays, Plus subscriber counts, media storage, and daily site health.",
  },
  {
    id: "growth",
    name: "Yuzu",
    role: "Growth & Content Strategist",
    mascot: "neko",
    room: "Content Studio",
    accent: "sakura",
    embedColor: 0xff9ec6,
    playbook: "ops/agents/yuzu-growth.md",
    summary: "Drafts TikTok/Shorts viral demo scripts, X release posts, and VTuber creator outreach for founder approval.",
  },
  {
    id: "community",
    name: "Boba",
    role: "Community & Support Desk",
    mascot: "bunny",
    room: "Help Lounge",
    accent: "lavender",
    embedColor: 0xc2a8ff,
    playbook: "ops/agents/boba-community.md",
    summary: "Triages live /feedback/ submissions, prepares Discord FAQ answers, and tracks top creator requests.",
  },
  {
    id: "qa",
    name: "Kero",
    role: "Product & QA Engineer",
    mascot: "hamster",
    room: "Test Lab",
    accent: "butter",
    embedColor: 0xffd166,
    playbook: "ops/agents/kero-qa.md",
    summary: "Guards the 22.5 KB /overlay/ budget, runs automated browser tests, and prototypes community-voted features.",
  },
  {
    id: "sales",
    name: "Mango",
    role: "Frills Plus Sales Agent",
    mascot: "duck",
    room: "Sales Counter",
    accent: "sky",
    embedColor: 0x7ec8ff,
    playbook: "ops/agents/mango-plus-sales.md",
    summary: "Runs on its own every day: watches the Frills Plus funnel, posts a vetted Plus tip each week, and flags a broken checkout or a refund spike.",
  },
];

export const AGENT_IDS = new Set(OFFICE_AGENTS.map((a) => a.id));
export const AGENT_BY_ID = new Map(OFFICE_AGENTS.map((a) => [a.id, a]));
export const AGENT_STATUSES = ["idle", "working", "waiting", "alert"];
export const TASK_STATUSES = ["queued", "working", "needs_review", "approved", "done", "archived"];
export const TASK_KINDS = ["ops", "content", "support", "qa", "outreach"];
export const TASK_PRIORITIES = ["normal", "high", "urgent"];
export const TASK_SOURCES = ["founder", "agent", "schedule", "feedback"];

const DISCORD_WEBHOOK_RE = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/\d{15,24}\/[A-Za-z0-9_-]{20,120}$/;

const STARTER_TASKS = [
  {
    agent_id: "growth",
    title: "30s TikTok & Reels script: VTS Chibi Paw Stickers on Avatar Face",
    kind: "content",
    priority: "high",
    status: "needs_review",
    source: "agent",
    body: "High-retention vertical showcase demonstrating free 5 pastel sticky notes + Plus custom shapes (chibi paw, heart, star, dreamy cloud) on /actions/.",
    output: [
      "HOOK (0–3s): [VTuber avatar gets slapped with a pastel sticky note reading 'MochiFan · Galaxy' while reacting]",
      "LINE: \"Wait—you can slap viewer names on your VTuber’s face for FREE with zero downloads?!\"",
      "DEMO (4–16s): Show /actions/ -> pick Sticker Shape -> tap Test sticky note -> cycle classic note, heart, chibi paw & dreamy cloud sticking to head movement.",
      "PROOF (17–24s): \"5 pastel sticky notes at once are completely free, no account needed. Frills Plus ($5.99/mo) unlocks unlimited stickers + custom shapes + VTS zoom/flip.\"",
      "CTA (25–30s): \"Link in bio — try it on frills.valwidgets.live/actions/ and drop your avatar clip in our Discord!\"",
    ].join("\n"),
  },
  {
    agent_id: "community",
    title: "Discord Community Launch Kit (channels, welcome & setup macros)",
    kind: "support",
    priority: "high",
    status: "needs_review",
    source: "agent",
    body: "Minimal 6-channel Discord structure so Month-2 streamers have a home to share setups, get OBS/TikTok LIVE Studio help, and vote on features.",
    output: [
      "CHANNELS:",
      "1. #announcements (shipped overlays & Plus updates)",
      "2. #show-your-setup (streamers post clips/screenshots — weekly spotlight!)",
      "3. #obs-and-vts-help (pinned Quick Start + /guides/setup/ + /guides/not-showing/)",
      "4. #feature-votes (let real streamers vote: YouTube/Kick vs MP4 Alerts vs Boss Bar)",
      "5. #bug-reports (platform, app, overlay link type)",
      "6. #founding-creators (private channel for Founding 20 Frills Plus creators)",
      "",
      "WELCOME MACRO: \"Welcome to Frills! Start at frills.valwidgets.live/start/ for a 60-second setup, drop your stream layout in #show-your-setup, or ask in #obs-and-vts-help.\"",
    ].join("\n"),
  },
  {
    agent_id: "ops",
    title: "Daily Relay Fleet, Plus Readiness & Feedback Check",
    kind: "ops",
    priority: "normal",
    status: "queued",
    source: "schedule",
    body: "Press “Run Live Scan” above (or run Mochi via /schedule) to probe both TikTok relays, check active Plus accounts, and surface unread feedback.",
    output: "Ready for live scan. Mochi checks relay slots, latency, unread /feedback/ count, Plus subscribers, and media storage.",
  },
  {
    agent_id: "qa",
    title: "Weekly Regression & 22.5 KB /overlay/ Budget Audit",
    kind: "qa",
    priority: "normal",
    status: "queued",
    source: "schedule",
    body: "Run full build + unit/browser test suite, verify /overlay/ stays <= 22.5 KB gzip, and confirm CSP & sitemap checks stay green before deploys.",
    output: "Checklist:\n- node build.mjs (verify /overlay/ <= 22.5 KB gzip)\n- node --test test/site.test.mjs test/plus-words.test.mjs test/free-stays-free.test.mjs\n- Verify zero console errors on /actions/, /start/, /gallery/, /plus/",
  },
];

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex",
      ...extra,
    },
  });

const cleanText = (v, max = 200) => String(v ?? "").replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, "").trim().slice(0, max);

/** Validates that a configured secret is strictly a real Discord webhook URL (prevents SSRF). */
export function validDiscordWebhook(raw) {
  const s = String(raw ?? "").trim();
  return DISCORD_WEBHOOK_RE.test(s) ? s : "";
}

async function sendDiscordWebhook(webhookUrl, { agent, title, body, output, channelLabel }, { fetchImpl } = {}) {
  const safeUrl = validDiscordWebhook(webhookUrl);
  if (!safeUrl) return { ok: false, detail: "Invalid Discord webhook URL format" };
  const descParts = [];
  if (output) descParts.push(output.slice(0, 3500));
  else if (body) descParts.push(body.slice(0, 3500));
  const payload = {
    username: `${agent?.name || "Frills"} · Frills HQ`,
    embeds: [
      {
        title: title.slice(0, 250),
        description: descParts.join("\n\n") || "Approved in Frills Virtual Office.",
        color: agent?.embedColor ?? 0x7fd694,
        footer: { text: `Frills Virtual Office · ${agent?.role || "Operator"} · ${channelLabel}` },
        timestamp: new Date().toISOString(),
      },
    ],
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetchImpl(safeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (res.ok) return { ok: true, detail: `Posted to Discord (${channelLabel})` };
    return { ok: false, detail: `Discord webhook returned HTTP ${res.status}` };
  } catch {
    return { ok: false, detail: "Could not reach Discord webhook" };
  } finally {
    clearTimeout(timer);
  }
}

export async function ensureOfficeTables(db, now) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS office_agents (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'idle',
    current_task TEXT NOT NULL DEFAULT '',
    last_summary TEXT NOT NULL DEFAULT '',
    last_run_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS office_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    output TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'ops',
    priority TEXT NOT NULL DEFAULT 'normal',
    status TEXT NOT NULL DEFAULT 'queued',
    source TEXT NOT NULL DEFAULT 'founder',
    feedback_id INTEGER,
    action_log TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`).run();

  // Safely upgrade existing office_tasks tables created before approval hooks existed
  for (const alter of [
    "ALTER TABLE office_tasks ADD COLUMN feedback_id INTEGER",
    "ALTER TABLE office_tasks ADD COLUMN action_log TEXT NOT NULL DEFAULT ''",
  ]) {
    try { await db.prepare(alter).run(); } catch { /* column already exists */ }
  }

  await db.prepare("CREATE INDEX IF NOT EXISTS office_tasks_agent ON office_tasks (agent_id, status, updated_at)").run();

  const existing = await db.prepare("SELECT COUNT(*) AS n FROM office_agents").first();
  if ((existing?.n ?? 0) === 0) {
    for (const a of OFFICE_AGENTS) {
      const initStatus = a.id === "growth" || a.id === "community" ? "waiting" : "idle";
      const initTask = a.id === "growth"
        ? "TikTok VTS Sticker Script ready for review"
        : a.id === "community"
          ? "Discord Launch Kit ready for review"
          : a.id === "ops"
            ? "Standing by for Live Ops Scan"
            : "All 76 Phase 0 checks green";
      await db.prepare(
        "INSERT OR IGNORE INTO office_agents (id, status, current_task, last_summary, last_run_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(a.id, initStatus, initTask, a.summary, now, now).run();
    }
    const existingTasks = await db.prepare("SELECT COUNT(*) AS n FROM office_tasks").first();
    if ((existingTasks?.n ?? 0) === 0) {
      for (let i = 0; i < STARTER_TASKS.length; i++) {
        const t = STARTER_TASKS[i];
        const ts = now - (STARTER_TASKS.length - i) * 60_000;
        await db.prepare(
          "INSERT INTO office_tasks (agent_id, title, body, output, kind, priority, status, source, feedback_id, action_log, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, '', ?, ?)",
        ).bind(t.agent_id, t.title, t.body, t.output, t.kind, t.priority, t.status, t.source, ts, ts).run();
      }
    }
  }

  // An agent added after the first seed (a database that already has the others) gets its row here.
  for (const a of OFFICE_AGENTS) {
    await db.prepare(
      "INSERT OR IGNORE INTO office_agents (id, status, current_task, last_summary, last_run_at, updated_at) VALUES (?, 'idle', ?, ?, 0, ?)",
    ).bind(a.id, a.id === "sales" ? "Watching the Plus funnel" : "", a.summary, now).run();
  }
}

async function safeCount(db, sql, fallback = 0) {
  try {
    const row = await db.prepare(sql).first();
    return Number(row?.n) || 0;
  } catch {
    return fallback;
  }
}

async function collectPulse(env, { fetchImpl, probeRelays = true } = {}) {
  const db = env.DB;
  const feedbackTotal = await safeCount(db, "SELECT COUNT(*) AS n FROM feedback");
  let feedbackNew = feedbackTotal;
  let recentNew = [];
  try {
    feedbackNew = await safeCount(db, "SELECT COUNT(*) AS n FROM feedback WHERE status = 'new'", feedbackTotal);
    const rows = (await db.prepare(
      "SELECT id, created, kind, app, message, contact FROM feedback WHERE status = 'new' ORDER BY id DESC LIMIT 6",
    ).all()).results;
    recentNew = rows.map((r) => ({
      id: r.id,
      created: r.created,
      kind: r.kind,
      app: r.app || "",
      message: String(r.message ?? "").slice(0, 280),
      contact: String(r.contact ?? "").slice(0, 80),
    }));
  } catch {
    try {
      const rows = (await db.prepare(
        "SELECT id, created, kind, app, message, contact FROM feedback ORDER BY id DESC LIMIT 6",
      ).all()).results;
      recentNew = rows.map((r) => ({
        id: r.id,
        created: r.created,
        kind: r.kind,
        app: r.app || "",
        message: String(r.message ?? "").slice(0, 280),
        contact: String(r.contact ?? "").slice(0, 80),
      }));
    } catch { /* no feedback table */ }
  }

  let mediaCount = 0;
  let mediaBytes = 0;
  try {
    const m = await db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM media").first();
    mediaCount = Number(m?.n) || 0;
    mediaBytes = Number(m?.bytes) || 0;
  } catch { /* no media table */ }

  const accountsTotal = await safeCount(db, "SELECT COUNT(*) AS n FROM accounts");
  const plusActive = await safeCount(db, "SELECT COUNT(*) AS n FROM plus WHERE status = 'active'");
  const cloudOverlays = await safeCount(db, "SELECT COUNT(*) AS n FROM cloud_overlays");

  let relays = [];
  if (probeRelays && fetchImpl) {
    const timedFetch = async (url, init = {}) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4500);
      try {
        return await fetchImpl(url, { ...init, signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
    };
    const relayEnv = {
      ...env,
      RELAY_URLS: env?.RELAY_URLS || "https://relay.valwidgets.live,https://plus-relay.valwidgets.live",
    };
    try {
      const probed = await checkRelays(relayEnv, { fetchImpl: timedFetch });
      relays = probed.map((r) => ({
        host: r.host,
        label: r.label,
        ok: Boolean(r.ok),
        level: r.level || (r.ok ? "ok" : "down"),
        latencyMs: r.latencyMs ?? null,
        free: r.free ?? 0,
        used: r.slots?.used ?? 0,
        max: r.slots?.max ?? 0,
        waiting: r.slots?.waiting ?? 0,
        version: r.version || "—",
      }));
    } catch {
      relays = [];
    }
  }

  return {
    relays,
    feedback: { total: feedbackTotal, new: feedbackNew, recentNew },
    accounts: { total: accountsTotal, plusActive, cloudOverlays },
    media: { count: mediaCount, bytes: mediaBytes, limit: MEDIA.totalBytes },
    hooks: {
      feedbackAutoResolve: true,
      discordOffice: Boolean(validDiscordWebhook(env?.DISCORD_OFFICE_WEBHOOK)),
      discordAnnounce: Boolean(validDiscordWebhook(env?.DISCORD_ANNOUNCE_WEBHOOK)),
    },
  };
}

function serializeTask(r) {
  return {
    id: r.id,
    agentId: r.agent_id,
    title: r.title,
    body: r.body,
    output: r.output,
    kind: r.kind,
    priority: r.priority,
    status: r.status,
    source: r.source,
    feedbackId: r.feedback_id ? Number(r.feedback_id) : null,
    actionLog: String(r.action_log ?? ""),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function readOfficeState(env, url, { now, fetchImpl }) {
  await ensureOfficeTables(env.DB, now);
  const agentRows = (await env.DB.prepare("SELECT id, status, current_task, last_summary, last_run_at, updated_at FROM office_agents").all()).results;
  const byId = new Map(agentRows.map((r) => [r.id, r]));

  const where = [];
  const binds = [];
  const agentFilter = url.searchParams.get("agent") || "";
  if (AGENT_IDS.has(agentFilter)) {
    where.push("agent_id = ?");
    binds.push(agentFilter);
  }
  const statusFilter = url.searchParams.get("status") || "";
  if (TASK_STATUSES.includes(statusFilter)) {
    where.push("status = ?");
    binds.push(statusFilter);
  }
  const limit = Math.min(100, Math.max(1, Math.round(Number(url.searchParams.get("limit"))) || 60));
  const taskRows = (await env.DB.prepare(
    `SELECT id, agent_id, title, body, output, kind, priority, status, source, feedback_id, action_log, created_at, updated_at
     FROM office_tasks ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY CASE status WHEN 'needs_review' THEN 0 WHEN 'working' THEN 1 WHEN 'queued' THEN 2 WHEN 'approved' THEN 3 WHEN 'done' THEN 4 ELSE 5 END,
              CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
              updated_at DESC, id DESC
     LIMIT ?`,
  ).bind(...binds, limit).all()).results;

  const allCountRows = (await env.DB.prepare(
    "SELECT agent_id, status, COUNT(*) AS n FROM office_tasks GROUP BY agent_id, status",
  ).all()).results;

  const countsByAgent = new Map();
  const counts = { needsReview: 0, queued: 0, working: 0, approved: 0, done: 0, archived: 0, total: 0 };
  for (const row of allCountRows) {
    const n = Number(row.n) || 0;
    counts.total += n;
    if (row.status === "needs_review") counts.needsReview += n;
    else if (row.status in counts) counts[row.status] += n;
    if (!countsByAgent.has(row.agent_id)) countsByAgent.set(row.agent_id, { needsReview: 0, active: 0, done: 0, total: 0 });
    const entry = countsByAgent.get(row.agent_id);
    entry.total += n;
    if (row.status === "needs_review") entry.needsReview += n;
    if (row.status === "queued" || row.status === "working" || row.status === "needs_review") entry.active += n;
    if (row.status === "approved" || row.status === "done") entry.done += n;
  }

  const agents = OFFICE_AGENTS.map((def) => {
    const saved = byId.get(def.id);
    return {
      ...def,
      status: AGENT_STATUSES.includes(saved?.status) ? saved.status : "idle",
      currentTask: saved?.current_task || "",
      lastSummary: saved?.last_summary || def.summary,
      lastRunAt: Number(saved?.last_run_at) || 0,
      updatedAt: Number(saved?.updated_at) || 0,
      tasks: countsByAgent.get(def.id) ?? { needsReview: 0, active: 0, done: 0, total: 0 },
    };
  });

  const skipProbe = url.searchParams.get("probe") === "0";
  const pulse = await collectPulse(env, { fetchImpl, probeRelays: !skipProbe });
  return json(200, { ok: true, now, agents, tasks: taskRows.map(serializeTask), counts, pulse });
}

async function updateAgent(id, request, env, now) {
  if (!AGENT_IDS.has(id)) return json(404, { ok: false, error: "unknown_agent" });
  await ensureOfficeTables(env.DB, now);
  let body;
  try { body = await request.json(); } catch { return json(400, { ok: false, error: "bad_json" }); }
  const current = await env.DB.prepare("SELECT status, current_task, last_summary, last_run_at FROM office_agents WHERE id = ?").bind(id).first();
  const status = body?.status !== undefined ? String(body.status) : (current?.status || "idle");
  if (!AGENT_STATUSES.includes(status)) return json(400, { ok: false, error: "bad_status" });
  const currentTask = body?.currentTask !== undefined ? cleanText(body.currentTask, 120) : (current?.current_task || "");
  const lastSummary = body?.lastSummary !== undefined ? cleanText(body.lastSummary, 500) : (current?.last_summary || "");
  const lastRunAt = body?.touchRun ? now : (Number(current?.last_run_at) || now);
  await env.DB.prepare(
    `INSERT INTO office_agents (id, status, current_task, last_summary, last_run_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, current_task = excluded.current_task, last_summary = excluded.last_summary, last_run_at = excluded.last_run_at, updated_at = excluded.updated_at`,
  ).bind(id, status, currentTask, lastSummary, lastRunAt, now).run();
  return json(200, { ok: true, agent: { id, status, currentTask, lastSummary, lastRunAt, updatedAt: now } });
}

async function createTask(request, env, now) {
  await ensureOfficeTables(env.DB, now);
  let body;
  try { body = await request.json(); } catch { return json(400, { ok: false, error: "bad_json" }); }
  const agentId = String(body?.agentId ?? "");
  if (!AGENT_IDS.has(agentId)) return json(400, { ok: false, error: "bad_agent" });
  const title = cleanText(body?.title, 120);
  if (!title) return json(400, { ok: false, error: "missing_title" });
  const desc = cleanText(body?.body, 1500);
  const output = cleanText(body?.output, 8000);
  const kind = TASK_KINDS.includes(body?.kind) ? body.kind : (agentId === "growth" ? "content" : agentId === "community" ? "support" : agentId === "qa" ? "qa" : agentId === "sales" ? "outreach" : "ops");
  const priority = TASK_PRIORITIES.includes(body?.priority) ? body.priority : "normal";
  const status = TASK_STATUSES.includes(body?.status) ? body.status : "queued";
  const source = TASK_SOURCES.includes(body?.source) ? body.source : "founder";
  const feedbackId = Number.isInteger(Number(body?.feedbackId)) && Number(body.feedbackId) > 0 ? Number(body.feedbackId) : null;

  const inserted = await env.DB.prepare(
    "INSERT INTO office_tasks (agent_id, title, body, output, kind, priority, status, source, feedback_id, action_log, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?) RETURNING id",
  ).bind(agentId, title, desc, output, kind, priority, status, source, feedbackId, now, now).first();
  const id = Number(inserted?.id) || 0;

  if (status === "needs_review" || status === "working") {
    const nextAgentStatus = status === "needs_review" ? "waiting" : "working";
    await env.DB.prepare(
      "UPDATE office_agents SET status = ?, current_task = ?, updated_at = ? WHERE id = ?",
    ).bind(nextAgentStatus, title.slice(0, 120), now, agentId).run();
  }

  return json(201, {
    ok: true,
    task: { id, agentId, title, body: desc, output, kind, priority, status, source, feedbackId, actionLog: "", createdAt: now, updatedAt: now },
  });
}

async function updateTask(id, request, env, now, { fetchImpl } = {}) {
  await ensureOfficeTables(env.DB, now);
  const row = await env.DB.prepare("SELECT * FROM office_tasks WHERE id = ?").bind(id).first();
  if (!row) return json(404, { ok: false, error: "not_found" });
  let body;
  try { body = await request.json(); } catch { return json(400, { ok: false, error: "bad_json" }); }

  const agentId = body?.agentId !== undefined ? String(body.agentId) : row.agent_id;
  if (!AGENT_IDS.has(agentId)) return json(400, { ok: false, error: "bad_agent" });
  const title = body?.title !== undefined ? cleanText(body.title, 120) : row.title;
  if (!title) return json(400, { ok: false, error: "missing_title" });
  const desc = body?.body !== undefined ? cleanText(body.body, 1500) : row.body;
  const output = body?.output !== undefined ? cleanText(body.output, 8000) : row.output;
  const kind = body?.kind !== undefined ? (TASK_KINDS.includes(body.kind) ? body.kind : row.kind) : row.kind;
  const priority = body?.priority !== undefined ? (TASK_PRIORITIES.includes(body.priority) ? body.priority : row.priority) : row.priority;
  const status = body?.status !== undefined ? String(body.status) : row.status;
  if (!TASK_STATUSES.includes(status)) return json(400, { ok: false, error: "bad_status" });

  const feedbackId = row.feedback_id ? Number(row.feedback_id) : null;
  const actions = [];
  const becomingApproved = status === "approved" && row.status !== "approved";
  const becomingFinished = (status === "approved" || status === "done") && row.status !== "approved" && row.status !== "done";

  // 1. Auto-resolve linked /feedback/ entry in D1 when Boba's task is approved or marked done
  if (feedbackId && becomingFinished) {
    try {
      const fb = await env.DB.prepare("SELECT id, status FROM feedback WHERE id = ?").bind(feedbackId).first();
      if (fb && fb.status !== "done") {
        await env.DB.prepare("UPDATE feedback SET status = 'done' WHERE id = ?").bind(feedbackId).run();
        actions.push({ kind: "feedback_resolved", ok: true, detail: `Marked feedback #${feedbackId} done in /admin/` });
      }
    } catch {
      actions.push({ kind: "feedback_resolved", ok: false, detail: `Could not update feedback #${feedbackId}` });
    }
  }

  // 2. Real Discord webhook dispatch when approved (or explicitly requested via publishDiscord: "office" | "announce")
  const requestedDiscord = body?.publishDiscord; // "office" | "announce" | "none" | undefined
  const shouldPostDiscord = requestedDiscord === "office" || requestedDiscord === "announce"
    || (becomingApproved && requestedDiscord !== "none" && Boolean(validDiscordWebhook(env?.DISCORD_OFFICE_WEBHOOK)));

  if (shouldPostDiscord && fetchImpl) {
    const channel = requestedDiscord === "announce" ? "announce" : "office";
    const webhookUrl = channel === "announce" ? env?.DISCORD_ANNOUNCE_WEBHOOK : env?.DISCORD_OFFICE_WEBHOOK;
    const channelLabel = channel === "announce" ? "#announcements" : "#founder-ops";
    if (validDiscordWebhook(webhookUrl)) {
      const sent = await sendDiscordWebhook(
        webhookUrl,
        { agent: AGENT_BY_ID.get(agentId), title, body: desc, output, channelLabel },
        { fetchImpl },
      );
      actions.push({ kind: "discord", channel, ...sent });
    } else if (requestedDiscord === "announce" || requestedDiscord === "office") {
      actions.push({ kind: "discord", channel, ok: false, detail: `Set ${channel === "announce" ? "DISCORD_ANNOUNCE_WEBHOOK" : "DISCORD_OFFICE_WEBHOOK"} secret in Cloudflare` });
    }
  }

  const receipt = actions.length
    ? actions.map((a) => `${a.ok ? "✓" : "⚠"} ${a.detail}`).join(" · ")
    : "";
  const nextLog = receipt ? `${receipt} (${new Date(now).toISOString().slice(11, 16)} UTC)`.slice(0, 320) : String(row.action_log ?? "");

  await env.DB.prepare(
    "UPDATE office_tasks SET agent_id = ?, title = ?, body = ?, output = ?, kind = ?, priority = ?, status = ?, action_log = ?, updated_at = ? WHERE id = ?",
  ).bind(agentId, title, desc, output, kind, priority, status, nextLog, now, id).run();

  // Keep the assigned bot's desk beacon accurate automatically
  const pending = await env.DB.prepare(
    "SELECT status, title FROM office_tasks WHERE agent_id = ? AND status IN ('needs_review', 'working') ORDER BY CASE status WHEN 'needs_review' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1",
  ).bind(agentId).first();
  const autoStatus = pending?.status === "needs_review" ? "waiting" : pending?.status === "working" ? "working" : "idle";
  const autoTask = pending?.title || (status === "done" || status === "approved" ? `Completed: ${title}`.slice(0, 120) : "");
  await env.DB.prepare(
    "UPDATE office_agents SET status = ?, current_task = ?, updated_at = ? WHERE id = ? AND status != 'alert'",
  ).bind(autoStatus, autoTask, now, agentId).run();

  return json(200, {
    ok: true,
    actions,
    task: { id, agentId, title, body: desc, output, kind, priority, status, source: row.source, feedbackId, actionLog: nextLog, createdAt: row.created_at, updatedAt: now },
  });
}

async function deleteTask(id, env, now) {
  await ensureOfficeTables(env.DB, now);
  const row = await env.DB.prepare("SELECT id FROM office_tasks WHERE id = ?").bind(id).first();
  if (!row) return json(404, { ok: false, error: "not_found" });
  await env.DB.prepare("DELETE FROM office_tasks WHERE id = ?").bind(id).run();
  return json(200, { ok: true });
}

async function testDiscordHook(request, env, { fetchImpl } = {}) {
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const channel = body?.channel === "announce" ? "announce" : "office";
  const secretName = channel === "announce" ? "DISCORD_ANNOUNCE_WEBHOOK" : "DISCORD_OFFICE_WEBHOOK";
  const webhookUrl = channel === "announce" ? env?.DISCORD_ANNOUNCE_WEBHOOK : env?.DISCORD_OFFICE_WEBHOOK;
  if (!validDiscordWebhook(webhookUrl)) {
    return json(400, { ok: false, error: "webhook_not_configured", detail: `Set the ${secretName} secret in Cloudflare Workers first.` });
  }
  const sent = await sendDiscordWebhook(
    webhookUrl,
    {
      agent: AGENT_BY_ID.get("ops"),
      title: "Frills Virtual Office Connected!",
      output: "Mochi, Yuzu, Boba, and Kero can now publish approved deliverables straight to this Discord channel.",
      channelLabel: channel === "announce" ? "#announcements" : "#founder-ops",
    },
    { fetchImpl },
  );
  return json(sent.ok ? 200 : 502, { ok: sent.ok, channel, detail: sent.detail });
}

async function runLiveOpsScan(env, { now, fetchImpl }) {
  await ensureOfficeTables(env.DB, now);
  const pulse = await collectPulse(env, { fetchImpl, probeRelays: true });

  const onlineRelays = pulse.relays.filter((r) => r.ok);
  const offlineRelays = pulse.relays.filter((r) => !r.ok);
  const activeStreamers = onlineRelays.reduce((sum, r) => sum + (r.used || 0), 0);
  const totalSlots = onlineRelays.reduce((sum, r) => sum + (r.max || 0), 0);
  const mediaPct = Math.round((100 * pulse.media.bytes) / Math.max(1, pulse.media.limit));

  const issues = [];
  if (offlineRelays.length) issues.push(`${offlineRelays.length} relay(s) offline (${offlineRelays.map((r) => r.host).join(", ")})`);
  if (pulse.relays.some((r) => r.ok && r.level === "full")) issues.push("A relay is at 100% capacity");
  if (mediaPct >= 85) issues.push(`Alert media storage at ${mediaPct}%`);

  const opsStatus = issues.length ? "alert" : "idle";
  const opsSummary = [
    `Relays: ${onlineRelays.length}/${pulse.relays.length} online (${activeStreamers}/${totalSlots} rooms active)`,
    `Plus: ${pulse.accounts.plusActive} active sub(s) · ${pulse.accounts.total} account(s) · ${pulse.accounts.cloudOverlays} cloud overlay(s)`,
    `Feedback: ${pulse.feedback.new} unread of ${pulse.feedback.total} total`,
    `Media: ${pulse.media.count} file(s) (${mediaPct}% of limit)`,
  ].join("\n");

  const opsHeadline = issues.length
    ? `Alert: ${issues[0]}`
    : `${onlineRelays.length}/${pulse.relays.length} relays healthy · ${activeStreamers} live`;

  await env.DB.prepare(
    "UPDATE office_agents SET status = ?, current_task = ?, last_summary = ?, last_run_at = ?, updated_at = ? WHERE id = 'ops'",
  ).bind(opsStatus, opsHeadline.slice(0, 120), opsSummary.slice(0, 500), now, now).run();

  const bobaStatus = pulse.feedback.new > 0 ? "waiting" : "idle";
  const bobaTask = pulse.feedback.new > 0
    ? `${pulse.feedback.new} unread feedback message${pulse.feedback.new === 1 ? "" : "s"} to triage`
    : "Feedback inbox clear";
  await env.DB.prepare(
    "UPDATE office_agents SET status = ?, current_task = ?, last_summary = ?, last_run_at = ?, updated_at = ? WHERE id = 'community'",
  ).bind(
    bobaStatus,
    bobaTask,
    pulse.feedback.new > 0
      ? `Latest unread: ${pulse.feedback.recentNew[0]?.message?.slice(0, 160) || "Check /admin/"}`
      : "Zero unread messages in /feedback/ right now.",
    now,
    now,
  ).run();

  const stamp = new Date(now).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const reportTitle = issues.length ? `Ops Alert (${stamp})` : `Live Ops Briefing (${stamp})`;
  const reportBody = issues.length ? `Attention needed: ${issues.join("; ")}.` : "Automated health check across relays, D1 accounts, feedback, and alert media.";
  const reportStatus = issues.length ? "needs_review" : "done";
  const reportPriority = issues.length ? "urgent" : "normal";

  let actionLog = "";
  if (issues.length && validDiscordWebhook(env?.DISCORD_OFFICE_WEBHOOK) && fetchImpl) {
    const sent = await sendDiscordWebhook(
      env.DISCORD_OFFICE_WEBHOOK,
      { agent: AGENT_BY_ID.get("ops"), title: reportTitle, body: reportBody, output: opsSummary, channelLabel: "#founder-ops" },
      { fetchImpl },
    );
    actionLog = `${sent.ok ? "✓" : "⚠"} ${sent.detail}`;
  }

  const inserted = await env.DB.prepare(
    "INSERT INTO office_tasks (agent_id, title, body, output, kind, priority, status, source, feedback_id, action_log, created_at, updated_at) VALUES (?, ?, ?, ?, 'ops', ?, ?, 'agent', NULL, ?, ?, ?) RETURNING id",
  ).bind("ops", reportTitle, reportBody, opsSummary, reportPriority, reportStatus, actionLog, now, now).first();

  return json(200, {
    ok: true,
    now,
    taskId: Number(inserted?.id) || 0,
    issues,
    summary: opsSummary,
    actionLog,
    pulse,
  });
}

/** Handles `/api/admin/office` and sub-routes after `authorize()` and `sameOrigin()` have already passed in `admin.mjs`. */
export async function handleOffice(request, env, subParts = [], { now = Date.now(), fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
  const method = request.method;
  const url = new URL(request.url);
  const [section, idRaw, ...extra] = subParts;
  if (extra.length > 0) return json(404, { ok: false, error: "not_found" });

  if (!section) {
    return method === "GET"
      ? await readOfficeState(env, url, { now, fetchImpl })
      : json(405, { ok: false, error: "method" }, { allow: "GET" });
  }
  if (section === "scan" && !idRaw) {
    return method === "POST"
      ? await runLiveOpsScan(env, { now, fetchImpl })
      : json(405, { ok: false, error: "method" }, { allow: "POST" });
  }
  if (section === "hooks" && idRaw === "test") {
    return method === "POST"
      ? await testDiscordHook(request, env, { fetchImpl })
      : json(405, { ok: false, error: "method" }, { allow: "POST" });
  }
  if (section === "agents" && idRaw) {
    return method === "PATCH"
      ? await updateAgent(idRaw, request, env, now)
      : json(405, { ok: false, error: "method" }, { allow: "PATCH" });
  }
  if (section === "tasks") {
    if (!idRaw) {
      return method === "POST"
        ? await createTask(request, env, now)
        : json(405, { ok: false, error: "method" }, { allow: "POST" });
    }
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id < 1) return json(404, { ok: false, error: "not_found" });
    if (method === "PATCH") return await updateTask(id, request, env, now, { fetchImpl });
    if (method === "DELETE") return await deleteTask(id, env, now);
    return json(405, { ok: false, error: "method" }, { allow: "PATCH, DELETE" });
  }
  return json(404, { ok: false, error: "not_found" });
}
