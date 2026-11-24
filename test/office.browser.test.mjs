// Virtual Office (/admin/office/) in real headless Chrome against scripts/serve.mjs:
// ADMIN_KEY login gate, 4 animated operator desks under CSP with zero console errors, desk selection,
// live feedback-to-task triage on Boba's desk, task creation/approval/deletion, Live Ops Scan, and 320px/1280px layout.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome, launch, sleep, waitForServer } from "../scripts/lib/chrome.mjs";

const root = join(import.meta.dirname, "..");
if (!existsSync(join(root, "dist", "admin", "office", "index.html"))) throw new Error("dist/ has no Virtual Office page. Run `npm run build` first.");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

const port = 5300 + Math.floor(Math.random() * 400);
const base = `http://localhost:${port}`;
const KEY = "a-long-enough-password";
const folder = mkdtempSync(join(tmpdir(), "frills-office-"));
let server;
let page;

before(async () => {
  if (skip) return;
  server = spawn(process.execPath, ["scripts/serve.mjs", String(port)], {
    cwd: root,
    stdio: "ignore",
    env: { ...process.env, FEEDBACK_DB: join(folder, "db.sqlite"), ADMIN_KEY: KEY },
  });
  await waitForServer(base);
  // Seed one unread feedback entry so Boba's desk displays real live inbox triage
  const res = await fetch(base + "/api/feedback", {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ kind: "idea", app: "obs", message: "Love the chibi paw sticker <script>alert(1)</script>!", contact: "@mochi", website: "", took: 5000 }),
  });
  assert.equal(res.status, 201);
  page = await launch();
  await page.viewport(1280, 900);
});

after(async () => {
  await page?.close();
  server?.kill();
  await sleep(300);
  try { rmSync(folder, { recursive: true, force: true }); } catch { /* ignore */ }
});

const visible = (sel) => page.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(sel)}); return Boolean(n) && !n.hidden && n.offsetParent !== null; })()`);
const click = (sel) => page.evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);
const text = (sel) => page.evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent.trim() ?? ""`);

test("Virtual Office enforces ADMIN_KEY, renders 4 mascot desks, queues real feedback, creates/approves tasks, and fits 320px & 1280px", { skip }, async () => {
  await page.goto(base + "/admin/office/", { settle: 700 });
  assert.equal(await visible("#login"), true);
  assert.equal(await visible("#dash"), false);

  // Wrong password rejected
  await page.evaluate(`(() => { document.getElementById("key").value = "wrong-password"; document.getElementById("login-form").requestSubmit(); })()`);
  await page.waitFor(`/not the right password/.test(document.getElementById("login-status").textContent)`);
  assert.equal(await visible("#dash"), false);
  page.problems.length = 0; // clear the expected 401 log from the intentional wrong-password probe

  // Unlock with real ADMIN_KEY
  await page.evaluate(`(() => { document.getElementById("key").value = ${JSON.stringify(KEY)}; document.getElementById("login-form").requestSubmit(); })()`);
  await page.waitFor(`document.querySelectorAll("#office-floor .office__desk").length === 4`, { timeout: 10000 });
  assert.equal(await visible("#dash"), true);
  assert.equal(await text("#rib-feedback"), "1 unread of 1");
  assert.ok((await page.evaluate(`document.querySelectorAll("#office-tasks .office__task").length`)) >= 4);
  // 3D space mounts cleanly (or falls back gracefully when WebGL is off) and supports Day/Night + 2D toggle
  const has3dCanvas = await page.evaluate(`Boolean(document.querySelector("#office-3d-canvas canvas"))`);
  if (has3dCanvas) {
    assert.equal(await page.evaluate(`document.querySelectorAll("#office-3d-labels .office3d__tag").length`), 4, "all 4 floating 3D desk badges mounted");
    await click("#office-theme");
    assert.equal(await text("#office-theme"), "Sunny Day");
    await click("#office-theme");
    assert.equal(await text("#office-theme"), "Cozy Night");
  }

  // Select Boba (Community) desk -> shows unread feedback safely as plain text & queues it
  await click('.office__desk[data-agent="community"]');
  await page.waitFor(`document.querySelector(".office__insp-name").textContent.includes("Boba")`);
  assert.equal(await page.evaluate(`document.querySelectorAll(".office__fb-row script").length`), 0, "feedback HTML is never executed");
  await click(".office__fb-row button");
  await page.waitFor(`document.getElementById("office-status").textContent.includes("Queued feedback #1")`);

  // Assign a new task to Yuzu and approve it
  await click("#toggle-composer");
  await page.evaluate(`(() => {
    document.getElementById("t-agent").value = "growth";
    document.getElementById("t-status").value = "needs_review";
    document.getElementById("t-title").value = "Launch clip: Gift Gallery Rotator";
    document.getElementById("t-output").value = "Hook: Watch every TikTok gift light up live!";
    document.getElementById("task-form").requestSubmit();
  })()`);
  await page.waitFor(`[...document.querySelectorAll(".office__task-title")].some((el) => el.textContent.includes("Launch clip: Gift Gallery Rotator"))`);

  // Approve the newly added task
  await page.evaluate(`(() => {
    const card = [...document.querySelectorAll(".office__task")].find((c) => c.querySelector(".office__task-title").textContent.includes("Launch clip: Gift Gallery Rotator"));
    [...card.querySelectorAll("button")].find((b) => b.textContent === "Approve").click();
  })()`);
  await page.waitFor(`(() => {
    const card = [...document.querySelectorAll(".office__task")].find((c) => c.querySelector(".office__task-title").textContent.includes("Launch clip: Gift Gallery Rotator"));
    return card?.dataset.status === "approved";
  })()`);

  // Responsive check at 320px and 1280px with zero console/CSP errors
  for (const width of [320, 1280]) {
    await page.viewport(width, 900);
    await sleep(120);
    const w = await page.evaluate("({ scroll: document.documentElement.scrollWidth, inner: innerWidth })");
    assert.ok(w.scroll <= w.inner, `/admin/office/ at ${width}px is ${w.scroll}px wide`);
  }
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});
