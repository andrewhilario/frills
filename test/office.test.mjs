// Unit tests for the Frills Virtual Office API (/api/admin/office/*):
// ADMIN_KEY auth & CSRF origin protection, lazy D1 table creation + starter seed, 4 specialist desks,
// agent status updates, task CRUD + auto-beacon sync, and live Ops Scan with real D1 + mock relays.

import test from "node:test";
import assert from "node:assert/strict";
import { handleAdmin } from "../worker/admin.mjs";
import { handleFeedback } from "../worker/feedback.mjs";
import { OFFICE_AGENTS } from "../worker/office.mjs";
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
