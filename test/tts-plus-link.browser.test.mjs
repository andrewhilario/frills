// The Frills Plus link panel on the talking pet's page, in a real headless Chrome against the local server (the same Worker code over SQLite, with a made-up payment notice): a visitor who is
// not signed in is pointed to sign in, an account without Plus is pointed to Plus, and an account with Plus makes a link code that rides in the overlay link (never the payment), replaces it
// with a new one (the old stops working), keeps it after a reload, and turns it off. The voice route is asked directly with each code to show which ones work.
// This test builds its own copy of the site with the account feature on, so it does not touch dist/. Skipped with no Chrome or Edge.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome, launch, sleep, waitForServer } from "../scripts/lib/chrome.mjs";
import { signedDelivery } from "../scripts/lib/lemon-fake.mjs";

const root = join(import.meta.dirname, "..");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

const SECRET = "whsec-plus-link";
const folder = mkdtempSync(join(tmpdir(), "frills-pluslink-"));
const variant = join(folder, "dist-on");
const port = 6600 + Math.floor(Math.random() * 300);
const served = `http://localhost:${port}`;
let server;
let page;

before(async () => {
  if (skip) return;
  execFileSync(process.execPath, ["build.mjs"], { cwd: root, stdio: "ignore", env: { ...process.env, PLUS_ACCOUNTS: "1", OUT_DIR: variant } });
  server = spawn(process.execPath, ["scripts/serve.mjs", String(port)], { cwd: root, stdio: "ignore", env: { ...process.env, DIST_DIR: variant, FEEDBACK_DB: join(folder, "db.sqlite"), LEMON_WEBHOOK_SECRET: SECRET, REQUIRE_PRO_PASS: "1" } });
  await waitForServer(served);
  page = await launch();
  await page.viewport(1280, 900);
});
after(async () => {
  await page?.close();
  server?.kill();
  await sleep(300);
  try { rmSync(folder, { recursive: true, force: true }); } catch { /* a temp folder */ }
});

const text = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim() ?? null`);
const visible = (id) => page.evaluate(`(() => { const e = document.getElementById(${JSON.stringify(id)}); return Boolean(e) && getComputedStyle(e).display !== "none"; })()`);
const outbox = async () => (await fetch(`${served}/api/dev/outbox`)).json();
const inPage = (action) => page.evaluate(`fetch("/api/account/${action}", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.json().then((j) => [r.status, j]))`);
const post = (action, body) => page.evaluate(`fetch("/api/account/${action}", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(${JSON.stringify(body)}) }).then((r) => r.status)`);
const linkValue = () => page.evaluate(`document.getElementById("link").value`);
const codeOf = async () => new URL(await linkValue()).searchParams.get("code");
/** The voice route asked with a code: 401 if the code is not live; 503 ai_not_configured means it got past the gate (this server has no AI provider key). */
const voice = async (code) => {
  const res = await fetch(`${served}/api/tts`, { method: "POST", headers: { origin: served, "content-type": "application/json", "x-overlay": code, "x-frills-country": "US" }, body: JSON.stringify({ text: "hello", voice: "nova" }) });
  return [res.status, (await res.json()).error];
};
async function open() {
  await page.goto(`${served}/tts/`, { settle: 600 });
  await page.waitFor(`getComputedStyle(document.getElementById("plus-link")).display !== "none"`, { timeout: 8000 });
}
const accountIdOf = (email) => { const db = new DatabaseSync(join(folder, "db.sqlite"), { readOnly: true }); try { return db.prepare("SELECT id FROM accounts WHERE email = ?").get(email).id; } finally { db.close(); } };
const typeChannel = () => page.evaluate(`(() => { const i = document.getElementById("source-channel"); i.value = "pond.pal"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);

test("a visitor who is not signed in is pointed to sign in, and an account without Plus is pointed to Plus; neither can make a link", { skip }, async () => {
  await open();
  assert.match(await text("#plus-link-state"), /Sign in to use Frills Plus AI voices/);
  assert.deepEqual([await text("#plus-link-account"), await visible("plus-link-account"), await visible("plus-link-make")], ["Sign in", true, false]);

  const asked = (await outbox()).length;
  await post("login", { email: "pet@example.com" });
  await post("verify", { token: /#([A-Za-z0-9_-]{43})/.exec((await outbox())[asked].text)[1] });
  await open();
  assert.match(await text("#plus-link-state"), /You do not have Frills Plus/);
  assert.deepEqual([await text("#plus-link-account"), await visible("plus-link-make")], ["Get Frills Plus", false]);
  assert.deepEqual((await inPage("overlay-link"))[1], { ok: false, error: "plus_required" }, "the server refuses too");
});

test("with Plus: make a link (the code rides in the overlay link), replace it (the old stops working), keep it after a reload, turn it off", { skip }, async () => {
  const id = accountIdOf("pet@example.com"); // (read from the local database: no checkout link is set on this server)
  const { headers, body } = signedDelivery({ name: "subscription_created", account: id, subscription: "9001", order: "9101", testMode: false }, SECRET);
  assert.equal((await fetch(`${served}/api/webhooks/lemonsqueezy`, { method: "POST", headers, body })).status, 200);

  await open();
  assert.match(await text("#plus-link-state"), /Make your Plus link/);
  assert.deepEqual([await text("#plus-link-make"), await visible("plus-link-make"), await visible("plus-link-off"), await visible("plus-link-hint")], ["Make my Plus link", true, false, true]);
  await typeChannel();
  assert.equal(await codeOf(), null, "no code in the link yet");

  await page.evaluate(`document.getElementById("plus-link-make").click()`);
  await page.waitFor(`document.getElementById("plus-link-status").textContent.includes("link is ready")`, { timeout: 8000 });
  const first = await codeOf();
  assert.match(first, /^[0-9a-f]{32}$/, "the overlay link now carries the code");
  assert.equal((await linkValue()).includes("pass"), false, "and no payment key");
  assert.deepEqual([await text("#plus-link-make"), await visible("plus-link-off")], ["Make a new link", true]);
  assert.deepEqual(await voice(first), [503, "ai_not_configured"], "past the gate (this server has no AI key to speak with)");

  await page.evaluate(`document.getElementById("plus-link-make").click()`);
  await page.waitFor(`new URL(document.getElementById("link").value).searchParams.get("code") !== ${JSON.stringify(first)}`, { timeout: 8000 });
  const second = await codeOf();
  assert.notEqual(second, first);
  assert.deepEqual(await voice(first), [401, "invalid_pass"], "the old link has stopped");
  assert.deepEqual(await voice(second), [503, "ai_not_configured"]);

  await open();
  await typeChannel();
  assert.equal(await codeOf(), second, "kept after a reload");
  assert.match(await text("#plus-link-state"), /Your Plus link is on/);

  await page.evaluate(`document.getElementById("plus-link-off").click()`);
  await page.waitFor(`!new URL(document.getElementById("link").value).searchParams.has("code")`, { timeout: 8000 });
  assert.deepEqual(await voice(second), [401, "invalid_pass"], "turned off");
  assert.match(await text("#plus-link-state"), /Make your Plus link/);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});
