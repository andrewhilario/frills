// Twitch follows in a real headless Chrome against the local server (the same Worker code over SQLite): a follower put in the post box shows
// up as an alert in the overlay, the alerts editor puts the code in the link and says whether the follows page is running, and the private
// Twitch pages say the right thing without a login. No real Twitch is involved. Skipped on a computer with no Chrome or Edge.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";

const root = join(import.meta.dirname, "..");
if (!existsSync(join(root, "dist", "twitch", "index.html"))) throw new Error("dist/ has no Twitch page. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

const port = 5300 + Math.floor(Math.random() * 400);
const base = `http://localhost:${port}`;
const folder = mkdtempSync(join(tmpdir(), "frills-follows-"));
const CODE = "abcdefghij123456";
const KEY = "k".repeat(32);
let server;
let page;

/** What the follows page does: put a follower (or a "still here") in the box. */
const postToBox = async (body, { code = CODE, key = KEY } = {}) => {
  const res = await fetch(`${base}/api/follows/${code}`, { method: "POST", headers: { origin: base, "x-key": key, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
};
const until = async (test, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await test()) return; await sleep(100); }
  throw new Error("Timed out");
};

before(async () => {
  if (skip) return;
  server = spawn(process.execPath, ["scripts/serve.mjs", String(port)], { cwd: root, stdio: "ignore", env: { ...process.env, FEEDBACK_DB: join(folder, "db.sqlite") } });
  await sleep(900);
  page = await launch();
  await page.viewport(1280, 900);
  // Twitch's chat is not reached from the test: a Twitch overlay opens its chat connection, which here never connects
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: "window.WebSocket = class { constructor() { this.readyState = 0; } send() {} close() {} };" });
});
after(async () => {
  await page?.close();
  server?.kill();
  await sleep(300);
  try { rmSync(folder, { recursive: true, force: true }); } catch { /* a temp folder */ }
});

const cards = () => page.evaluate(`[...document.querySelectorAll(".alert")].filter((a) => !a.classList.contains("alert--out")).map((a) => ({ kind: a.dataset.kind, text: a.querySelector(".alert__words").textContent }))`);

test("overlay: a follower put in the box shows as a follow alert, once, and one from before the page loaded does not", { skip }, async () => {
  await postToBox({ id: "old-1", user: "early_bird", name: "Early Bird" }); // before the overlay exists: must never be shown
  await page.goto(`${base}/overlay/alerts/?channel=pond_cafe&platform=twitch&follows=${CODE}&maxShown=3&followTime=4`, { settle: 1500 });
  await postToBox({ id: "new-1", user: "mochi_bun", name: "Mochi Bun" });
  await until(async () => (await cards()).some((c) => c.text === "Mochi Bun just followed!"), 15000);
  const texts = (await cards()).map((c) => c.text);
  assert.ok(!texts.some((t) => /Early Bird/.test(t)), "a follow from before the page loaded is not replayed");
  await postToBox({ id: "new-1", user: "mochi_bun", name: "Mochi Bun" }); // Twitch sending the same follow again
  await sleep(6500);
  const shown = await page.evaluate(`document.querySelectorAll(".alert").length`);
  assert.ok(shown <= 1, "the same follow is not shown twice");
});

test("overlay: without a code in the link nothing is read from any box, and a made-up code is ignored", { skip }, async () => {
  await page.goto(`${base}/overlay/alerts/?channel=pond_cafe&platform=twitch&follows=not-a-code&maxShown=3`, { settle: 1200 });
  const asked = await page.evaluate(`performance.getEntriesByType("resource").filter((r) => r.name.includes("/api/follows/")).length`);
  assert.equal(asked, 0);
});

test("editor: Twitch has the follow test button and section and a box for the follows page; ticking it puts a code in the link, and it says whether the page is running", { skip }, async () => {
  await page.goto(`${base}/alerts/?platform=twitch`, { settle: 800 });
  const visible = (sel) => page.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(sel)}); return Boolean(n) && !n.hidden && n.offsetParent !== null; })()`);
  assert.equal(await visible('[data-test="follow"]'), true, "the follow test button shows on Twitch too");
  assert.equal(await visible(".followbox"), true);
  await page.evaluate(`(() => { const i = document.getElementById("source-channel"); i.value = "pond_cafe"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  const link = () => page.evaluate(`document.getElementById("link").value`);
  assert.ok(!(await link()).includes("follows="), "off to begin with: no code in the link");
  await page.evaluate(`document.getElementById("follows-on").click()`);
  const code = await page.evaluate(`JSON.parse(localStorage.getItem("frills:twitch:bridge")).code`);
  const key = await page.evaluate(`JSON.parse(localStorage.getItem("frills:twitch:bridge")).key`);
  assert.match(code, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(new URL(await link()).searchParams.get("follows"), code);
  assert.equal(new URL(await link()).searchParams.get("platform"), "twitch");
  await page.waitFor(`/not running/.test(document.getElementById("follows-state").textContent)`);
  await postToBox({ ping: true }, { code, key }); // the follows page says "still here"
  await page.evaluate(`document.getElementById("follows-on").click(); document.getElementById("follows-on").click();`);
  await page.waitFor(`/is running/.test(document.getElementById("follows-state").textContent)`);
  // TikTok has no such box, and the code stays out of a TikTok link
  await page.evaluate(`[...document.querySelectorAll("#source .chip")].find((b) => b.textContent.trim() === "TikTok").click()`);
  assert.equal(await visible(".followbox"), false);
  assert.ok(!(await link()).includes("follows="));
});

test("the Twitch pages: logged out they say so and offer the login; a login that did not start here is refused", { skip }, async () => {
  await page.goto(`${base}/twitch/`, { settle: 700 });
  assert.equal(await page.evaluate(`document.getElementById("tw-status").textContent`), "Not logged in.");
  assert.equal(await page.evaluate(`document.getElementById("tw-login-btn").hidden`), false);
  assert.equal(await page.evaluate(`document.getElementById("tw-listen-card").hidden`), true);
  assert.equal(await page.evaluate(`document.querySelector('meta[name="robots"]').content`), "noindex, nofollow");
  await page.goto(`${base}/twitch/callback/#access_token=abcdefghij1234567890&state=somebody-elses&token_type=bearer`, { settle: 800 });
  assert.match(await page.evaluate(`document.getElementById("tw-status").textContent`), /did not come from this page/);
  assert.equal(await page.evaluate(`location.hash`), "", "the login is taken out of the address");
  assert.equal(await page.evaluate(`localStorage.getItem("frills:twitch:login")`), null, "and nothing was kept");
});
