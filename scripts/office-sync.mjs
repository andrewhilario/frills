#!/usr/bin/env node
// Frills Virtual Office CLI bridge for autonomous / scheduled T3 agents (zero dependencies).
// Reads FRILLS_ADMIN_KEY (required) and FRILLS_SITE_URL (defaults to https://frills.valwidgets.live) from env.
// Usage:
//   node scripts/office-sync.mjs pull [--agent growth] [--status queued]
//   node scripts/office-sync.mjs scan
//   node scripts/office-sync.mjs checkin <agentId> <idle|working|waiting|alert> "<currentTask>" ["<lastSummary>"]
//   node scripts/office-sync.mjs deliver <taskId> --status needs_review [--text "..."] [--file path.txt]
//   node scripts/office-sync.mjs create <agentId> "<title>" [--status needs_review] [--priority high] [--body "..."] [--file path.txt]

import { readFileSync } from "node:fs";

const SITE = String(process.env.FRILLS_SITE_URL || "https://frills.valwidgets.live").replace(/\/+$/, "");
const ADMIN_KEY = String(process.env.FRILLS_ADMIN_KEY || "").trim();

function usage(exitCode = 1) {
  console.error([
    "Frills Virtual Office Sync CLI",
    "Set FRILLS_ADMIN_KEY in your environment (never hardcode or commit it).",
    "",
    "Commands:",
    "  pull [--agent ops|growth|community|qa] [--status queued|working|needs_review|approved|done]",
    "  scan",
    "  checkin <agentId> <idle|working|waiting|alert> <currentTask> [lastSummary]",
    "  deliver <taskId> [--status needs_review|done] [--text \"...\"] [--file path]",
    "  create <agentId> <title> [--status queued|needs_review] [--priority normal|high|urgent] [--body \"...\"] [--text \"...\"] [--file path]",
  ].join("\n"));
  process.exit(exitCode);
}

function parseFlags(args) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--") && i + 1 < args.length) {
      flags[a.slice(2)] = args[++i];
    } else {
      pos.push(a);
    }
  }
  return { pos, flags };
}

async function req(method, path, body) {
  if (!ADMIN_KEY) {
    console.error("Missing FRILLS_ADMIN_KEY environment variable.");
    process.exit(1);
  }
  const res = await fetch(`${SITE}/api/admin/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${ADMIN_KEY}`,
      origin: SITE,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`HTTP ${res.status}:`, JSON.stringify(data));
    process.exit(1);
  }
  return data;
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === "-h" || cmd === "--help") usage(0);
const { pos, flags } = parseFlags(rest);

if (cmd === "pull") {
  const q = new URLSearchParams();
  if (flags.agent) q.set("agent", flags.agent);
  if (flags.status) q.set("status", flags.status);
  if (flags.probe === "0") q.set("probe", "0");
  const data = await req("GET", `office${q.toString() ? `?${q}` : ""}`);
  console.log(JSON.stringify(data, null, 2));
} else if (cmd === "scan") {
  const data = await req("POST", "office/scan", {});
  console.log(JSON.stringify(data, null, 2));
} else if (cmd === "checkin") {
  const [agentId, status, currentTask = "", lastSummary] = pos;
  if (!agentId || !status) usage();
  const data = await req("PATCH", `office/agents/${encodeURIComponent(agentId)}`, {
    status,
    currentTask,
    ...(lastSummary !== undefined ? { lastSummary } : {}),
    touchRun: true,
  });
  console.log(JSON.stringify(data, null, 2));
} else if (cmd === "deliver") {
  const [taskId] = pos;
  if (!taskId) usage();
  const output = flags.file ? readFileSync(flags.file, "utf8") : (flags.text ?? "");
  const data = await req("PATCH", `office/tasks/${encodeURIComponent(taskId)}`, {
    status: flags.status || "needs_review",
    output,
  });
  console.log(JSON.stringify(data, null, 2));
} else if (cmd === "create") {
  const [agentId, title] = pos;
  if (!agentId || !title) usage();
  const output = flags.file ? readFileSync(flags.file, "utf8") : (flags.text ?? "");
  const data = await req("POST", "office/tasks", {
    agentId,
    title,
    body: flags.body || "",
    output,
    priority: flags.priority || "normal",
    status: flags.status || "needs_review",
    source: flags.source || "agent",
  });
  console.log(JSON.stringify(data, null, 2));
} else {
  usage();
}
