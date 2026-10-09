// The feedback form in a real headless Chrome, talking to the local server, which answers /api/feedback with the same Worker code the
// live site runs over a SQLite file. Checks: it loads under the security policy, short messages are caught in the page, a good one is
// saved and thanked, a bot's is not saved, and the form can be used again. Skipped on a computer with no Chrome or Edge.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";

const root = join(import.meta.dirname, "..");
if (!existsSync(join(root, "dist", "feedback", "index.html"))) throw new Error("dist/ has no feedback page. Run `npm run build` first (`npm test` does that for you).");

let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

const port = 4000 + Math.floor(Math.random() * 400);
const base = `http://localhost:${port}`;
const folder = mkdtempSync(join(tmpdir(), "frills-feedback-"));
const file = join(folder, "feedback.sqlite");
let server;
let page;

const saved = () => {
  const db = new DatabaseSync(file);
  try { return db.prepare("SELECT kind, app, message, contact FROM feedback ORDER BY id").all().map((r) => ({ ...r })); } finally { db.close(); }
};
const text = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent.trim()`);
const set = (selector, value) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const click = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);

before(async () => {
  if (skip) return;
  server = spawn(process.execPath, ["scripts/serve.mjs", String(port)], { cwd: root, stdio: "ignore", env: { ...process.env, FEEDBACK_DB: file } });
  await sleep(900);
  page = await launch();
  await page.viewport(1100, 900);
});
after(async () => {
  await page?.close();
  server?.kill();
  await sleep(300);
  try { rmSync(folder, { recursive: true, force: true }); } catch { /* a temp folder */ }
});

test("the form loads under the security policy with no console errors, and has the fields a person needs", { skip }, async () => {
  await page.goto(`${base}/feedback/`, { settle: 800 });
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
  assert.equal(await page.evaluate(`document.querySelectorAll('input[name="kind"]').length`), 4);
  assert.equal(await page.evaluate(`document.querySelector('input[name="kind"]:checked').value`), "idea");
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector(".form__trap")).position`), "absolute", "the bot trap is out of sight");
});

test("a message that is too short is caught in the page and nothing is sent", async () => {
  await set("#fb-message", "short");
  await click("#fb-send");
  await sleep(200);
  assert.match(await text("#fb-status"), /at least 10 characters/);
  assert.equal(await page.evaluate(`document.getElementById("fb-message").getAttribute("aria-invalid")`), "true");
  assert.equal(saved().length, 0);
});

test("a good message is saved and thanked, and the form can be used again", async () => {
  await click('input[name="kind"][value="look"]');
  await page.evaluate(`document.getElementById("fb-app").value = "tiktok-live-studio"`);
  await set("#fb-message", "Please add a look with little frogs and a green glow.");
  await set("#fb-contact", "@mochi");
  await sleep(1700); // a person takes longer than this; the server treats anything faster as a bot
  await click("#fb-send");
  await page.waitFor(`!document.getElementById("fb-thanks").hidden`);
  assert.equal(await page.evaluate(`document.getElementById("feedback-form").hidden`), true);
  assert.match(await text("#fb-thanks"), /Thank you/);
  assert.deepEqual(saved(), [{ kind: "look", app: "tiktok-live-studio", message: "Please add a look with little frogs and a green glow.", contact: "@mochi" }]);

  await click("#fb-again");
  assert.equal(await page.evaluate(`document.getElementById("feedback-form").hidden`), false);
  assert.equal(await page.evaluate(`document.getElementById("fb-message").value`), "", "the form is empty again");
});

test("a filled hidden field (a bot) still sees thanks, but nothing is saved", async () => {
  await set("#fb-message", "Buy cheap followers at my website now please.");
  await set('input[name="website"]', "http://spam.example");
  await sleep(1700);
  await click("#fb-send");
  await page.waitFor(`!document.getElementById("fb-thanks").hidden`);
  assert.equal(saved().length, 1, "still only the real message");
});

test("with the server answering an error, the person's words stay and a clear line says what happened", async () => {
  await page.goto(`${base}/feedback/`, { settle: 600 });
  await set("#fb-message", "Written before the connection failed, so keep it.");
  await page.evaluate(`window.fetch = async () => new Response(JSON.stringify({ ok: false, error: "busy" }), { status: 429, headers: { "content-type": "application/json" } })`);
  await click("#fb-send");
  await page.waitFor(`document.getElementById("fb-status").dataset.state === "error"`);
  assert.match(await text("#fb-status"), /try again in a few minutes/);
  assert.equal(await page.evaluate(`document.getElementById("fb-message").value`), "Written before the connection failed, so keep it.");
  assert.equal(await page.evaluate(`document.getElementById("fb-send").disabled`), false, "the button works again");
});
