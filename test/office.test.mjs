// Unit tests for the Frills Virtual Office API (/api/admin/office/*):
// ADMIN_KEY auth & CSRF origin protection, lazy D1 table creation + starter seed, 4 specialist desks,
// agent status updates, task CRUD + auto-beacon sync, and live Ops Scan with real D1 + mock relays.

import test from "node:test";
import assert from "node:assert/strict";
import { handleAdmin } from "../worker/admin.mjs";
import { handleFeedback } from "../worker/feedback.mjs";
import { OFFICE_AGENTS, validDiscordWebhook } from "../worker/office.mjs";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";

const SITE = "https://frills.example";
const KEY = "a-long-enough-password";
const fresh = (over = {}) => ({ DB: localDatabase(":memory:"), ADMIN_KEY: KEY, RELAY_URLS: "https://relay-a.test,https://relay-b.test", ...over });

const mockRelaysOk = async (url) => {
  if (url.includes("relay-a.test")) {
    return new Response(JSON.stringify({ ok: true, version: "1.9", free: 92, slots: { used: 8, max: 100, waiting: 0 } }), { status: 200 });
  }
  return new Response(JSON.stringify({ ok: true, version: "1.9", free: 100, slots: { used: 0, max: 100, waiting: 0 } }), { status: 200 });
};

async function call(env, method, path, { key = KEY, origin = SITE, body, now = Date.UTC(2026, 10, 24, 10, 0, 0), fetchImpl = mockRelaysOk } = {}) {
  const headers = { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(origin ? { origin } : {}), ...(body ? { "content-type": "application/json" } : {}) };
  const res = await handleAdmin(new Request(SITE + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, { now, fetchImpl });
  return { status: res.status, body: await res.json(), res };
}

test("office API requires ADMIN_KEY + same-origin on mutations, auto-seeds 4 desks and starter tasks", async () => {
  const env = fresh();
  assert.equal((await call(env, "GET", "/api/admin/office", { key: false })).status, 401);
  assert.equal((await call(env, "POST", "/api/admin/office/tasks", { origin: "https://evil.test", body: { agentId: "ops", title: "Bad" } })).status, 403);

  const init = await call(env, "GET", "/api/admin/office");
  assert.equal(init.status, 200);
  assert.equal(init.body.ok, true);
  assert.equal(init.body.agents.length, OFFICE_AGENTS.length);
  assert.deepEqual(init.body.agents.map((a) => a.id), ["ops", "growth", "community", "qa"]);
  assert.equal(init.body.tasks.length, 4, "seeds 4 practical Month-2 starter tasks on first boot");
  assert.equal(init.body.counts.needsReview, 2);
  assert.equal(init.body.pulse.relays.length, 2);
  assert.equal(init.body.pulse.relays[0].used, 8);
});

test("agent desk status updates and task CRUD validate inputs and sync desk beacons", async () => {
  const env = fresh();
  await call(env, "GET", "/api/admin/office?probe=0");

  // Update agent status
  const badAgent = await call(env, "PATCH", "/api/admin/office/agents/unknown", { body: { status: "working" } });
  assert.equal(badAgent.status, 404);
  const badStatus = await call(env, "PATCH", "/api/admin/office/agents/qa", { body: { status: "napping" } });
  assert.equal(badStatus.status, 400);
  const okAgent = await call(env, "PATCH", "/api/admin/office/agents/qa", { body: { status: "working", currentTask: "Running browser tests", touchRun: true } });
  assert.equal(okAgent.status, 200);
  assert.equal(okAgent.body.agent.status, "working");

  // Create task -> moves agent to waiting when status is needs_review
  const badTask = await call(env, "POST", "/api/admin/office/tasks", { body: { agentId: "growth", title: "   " } });
  assert.equal(badTask.status, 400);
  const created = await call(env, "POST", "/api/admin/office/tasks", {
    body: { agentId: "qa", title: "Check /overlay/ gzip budget", body: "Must stay <= 22.5 KB", output: "Measured 22.2 KB gzip", priority: "high", status: "needs_review" },
  });
  assert.equal(created.status, 201);
  const id = created.body.task.id;
  assert.ok(id > 0);

  let state = (await call(env, "GET", "/api/admin/office?probe=0")).body;
  assert.equal(state.agents.find((a) => a.id === "qa").status, "waiting");

  // Approve task -> desk relaxes back to idle when no more review/working tasks exist
  const approved = await call(env, "PATCH", `/api/admin/office/tasks/${id}`, { body: { status: "approved", output: "Approved by founder" } });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.task.status, "approved");

  state = (await call(env, "GET", "/api/admin/office?probe=0")).body;
  assert.equal(state.agents.find((a) => a.id === "qa").status, "idle");

  // Delete task
  assert.equal((await call(env, "DELETE", `/api/admin/office/tasks/${id}`)).status, 200);
  assert.equal((await call(env, "DELETE", `/api/admin/office/tasks/${id}`)).status, 404);
});

test("POST /api/admin/office/scan reads real unread feedback & relays, flagging degraded relays as alert", async () => {
  const env = fresh();
  await handleFeedback(new Request(`${SITE}/api/feedback`, {
    method: "POST",
    headers: { origin: SITE, "content-type": "application/json" },
    body: JSON.stringify({ kind: "broken", app: "obs", message: "Sticky note test question from streamer", contact: "@vtuber", website: "", took: 4000 }),
  }), env, { now: Date.UTC(2026, 10, 24, 9, 0, 0) });

  // Healthy scan
  const okScan = await call(env, "POST", "/api/admin/office/scan", { body: {}, fetchImpl: mockRelaysOk });
  assert.equal(okScan.status, 200);
  assert.deepEqual(okScan.body.issues, []);
  assert.equal(okScan.body.pulse.feedback.new, 1);
  assert.match(okScan.body.summary, /Relays: 2\/2 online \(8\/200 rooms active\)/);

  let state = (await call(env, "GET", "/api/admin/office?probe=0")).body;
  assert.equal(state.agents.find((a) => a.id === "ops").status, "idle");
  assert.equal(state.agents.find((a) => a.id === "community").status, "waiting");

  // Degraded relay scan -> Mochi enters alert status and creates urgent needs_review task
  const degradedFetch = async (url) => (url.includes("relay-a.test")
    ? new Response(JSON.stringify({ ok: true, free: 90, slots: { used: 10, max: 100, waiting: 0 } }), { status: 200 })
    : new Response("down", { status: 503 }));
  const alertScan = await call(env, "POST", "/api/admin/office/scan", { body: {}, fetchImpl: degradedFetch });
  assert.equal(alertScan.status, 200);
  assert.equal(alertScan.body.issues.length, 1);

  state = (await call(env, "GET", "/api/admin/office?probe=0")).body;
  assert.equal(state.agents.find((a) => a.id === "ops").status, "alert");
  const alertTask = state.tasks.find((t) => t.id === alertScan.body.taskId);
  assert.equal(alertTask?.status, "needs_review");
  assert.equal(alertTask?.priority, "urgent");
});

test("approving tasks executes real hooks: auto-resolves linked /feedback/, posts Discord embeds safely, and blocks bad webhook URLs", async () => {
  const OFFICE_HOOK = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789";
  const ANNOUNCE_HOOK = "https://discord.com/api/webhooks/987654321098765432/zyxwvutsrqponmlkjihgfedcba9876543210";
  assert.equal(validDiscordWebhook(OFFICE_HOOK), OFFICE_HOOK);
  assert.equal(validDiscordWebhook("https://evil.test/api/webhooks/1/2"), "");

  const env = fresh({ DISCORD_OFFICE_WEBHOOK: OFFICE_HOOK, DISCORD_ANNOUNCE_WEBHOOK: ANNOUNCE_HOOK });
  await handleFeedback(new Request(`${SITE}/api/feedback`, {
    method: "POST",
    headers: { origin: SITE, "content-type": "application/json" },
    body: JSON.stringify({ kind: "idea", app: "obs", message: "Please add a paw print sticker!", contact: "@mochi", website: "", took: 4000 }),
  }), env, { now: Date.UTC(2026, 10, 24, 9, 0, 0) });

  const posted = [];
  const hookFetch = async (url, init) => {
    if (String(url).startsWith("https://discord.com/")) {
      posted.push({ url, body: JSON.parse(init.body) });
      return new Response(null, { status: 204 });
    }
    return mockRelaysOk(url);
  };

  const init = await call(env, "GET", "/api/admin/office?probe=0", { fetchImpl: hookFetch });
  assert.deepEqual(init.body.pulse.hooks, { feedbackAutoResolve: true, discordOffice: true, discordAnnounce: true });

  // Queue Boba task linked to feedback #1
  const created = await call(env, "POST", "/api/admin/office/tasks", {
    body: { agentId: "community", title: "Reply to feedback #1", output: "Chibi paw stamps are now live in /actions/!", status: "needs_review", feedbackId: 1 },
    fetchImpl: hookFetch,
  });
  assert.equal(created.body.task.feedbackId, 1);

  // Approve -> auto-resolves feedback #1 in D1 AND posts to #founder-ops Discord webhook
  const approved = await call(env, "PATCH", `/api/admin/office/tasks/${created.body.task.id}`, {
    body: { status: "approved" },
    fetchImpl: hookFetch,
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.actions.length, 2);
  assert.equal(approved.body.actions[0].kind, "feedback_resolved");
  assert.equal(approved.body.actions[0].ok, true);
  assert.equal(approved.body.actions[1].kind, "discord");
  assert.equal(approved.body.actions[1].channel, "office");
  assert.equal(approved.body.actions[1].ok, true);
  assert.match(approved.body.task.actionLog, /Marked feedback #1 done/);
  assert.match(approved.body.task.actionLog, /Posted to Discord \(#founder-ops\)/);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, OFFICE_HOOK);
  assert.equal(posted[0].body.embeds[0].title, "Reply to feedback #1");

  // Feedback #1 is genuinely marked done in /admin/feedback!
  const fbCheck = await call(env, "GET", "/api/admin/feedback?status=new", { fetchImpl: hookFetch });
  assert.equal(fbCheck.body.items.length, 0, "feedback #1 is now resolved");

  // Publish to #announcements + test ping + skip Discord with publishDiscord:"none"
  const growth = await call(env, "POST", "/api/admin/office/tasks", {
    body: { agentId: "growth", title: "New Feature Announcement", output: "Custom VTS sticker shapes are live!", status: "needs_review" },
    fetchImpl: hookFetch,
  });
  await call(env, "PATCH", `/api/admin/office/tasks/${growth.body.task.id}`, {
    body: { status: "approved", publishDiscord: "announce" },
    fetchImpl: hookFetch,
  });
  assert.equal(posted.length, 2);
  assert.equal(posted[1].url, ANNOUNCE_HOOK);

  const silent = await call(env, "POST", "/api/admin/office/tasks", {
    body: { agentId: "qa", title: "Quiet internal check", status: "needs_review" },
    fetchImpl: hookFetch,
  });
  await call(env, "PATCH", `/api/admin/office/tasks/${silent.body.task.id}`, {
    body: { status: "approved", publishDiscord: "none" },
    fetchImpl: hookFetch,
  });
  assert.equal(posted.length, 2, "publishDiscord:none skips Discord cleanly");

  const ping = await call(env, "POST", "/api/admin/office/hooks/test", { body: { channel: "office" }, fetchImpl: hookFetch });
  assert.equal(ping.status, 200);
  assert.equal(posted.length, 3);
});
