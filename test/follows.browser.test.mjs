// Twitch follows in a real headless Chrome against the local server (the same Worker code over SQLite): a follower put in the post box shows
// up as an alert in the overlay, the alerts editor puts the code in the link and says whether the follows page is running, and the private
// Twitch pages say the right thing without a login. No real Twitch is involved. Skipped on a computer with no Chrome or Edge.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome, launch, sleep, waitForServer } from "../scripts/lib/chrome.mjs";

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
  await waitForServer(base);
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
  // with the box ticked, the preview in the editor also shows a follower the follows page passes on (only ones that arrive after it opened)
  await sleep(5600); // the first look at the box only learns where the line is
  await postToBox({ id: "preview-1", user: "pond_pal", name: "Pond Pal" }, { code, key });
  await page.waitFor(`[...document.querySelectorAll(".alert__words")].some((n) => n.textContent === "Pond Pal just followed!")`, 15000);
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

test("the follows page, logged in (with a pretend Twitch): the login button goes, the listener starts, a follower shows up and reaches the box, and a test follower is sent", { skip }, async () => {
  const added = await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.setItem("frills:twitch:login", JSON.stringify({ token: "abcdefghij1234567890", login: "ainzzuu", userId: "42", savedAt: Date.now() }));
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, options) => {
      const u = String(url);
      if (u === "https://id.twitch.tv/oauth2/validate") return Promise.resolve(new Response(JSON.stringify({ client_id: "tcve57go7uzw3k8bfptf3kgxdjdizz", login: "ainzzuu", user_id: "42", scopes: ["moderator:read:followers"], expires_in: 5000 }), { status: 200 }));
      if (u.startsWith("https://api.twitch.tv/helix/eventsub/subscriptions")) return Promise.resolve(new Response("{}", { status: 202 }));
      return realFetch(url, options);
    };
    window.WebSocket = class {
      constructor(url) {
        this.url = url;
        setTimeout(() => {
          this.onmessage && this.onmessage({ data: JSON.stringify({ metadata: { message_id: "w1", message_type: "session_welcome" }, payload: { session: { id: "s1", keepalive_timeout_seconds: 10 } } }) });
          setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify({ metadata: { message_id: "n1", message_type: "notification" }, payload: { subscription: { type: "channel.follow" }, event: { user_id: "7", user_login: "mochi_bun", user_name: "Mochi Bun", followed_at: "2026-10-13T10:00:00Z" } } }) }), 300);
        }, 50);
      }
      close() {}
      send() {}
    };` });
  try {
    await page.goto(`${base}/twitch/`, { settle: 1500 });
    const shows = (id) => page.evaluate(`(() => { const n = document.getElementById(${JSON.stringify(id)}); return Boolean(n) && !n.hidden && getComputedStyle(n).display !== "none"; })()`);
    assert.equal(await page.evaluate(`document.getElementById("tw-status").textContent`), "Logged in as ainzzuu.");
    assert.equal(await shows("tw-login-btn"), false, "already logged in: no login button");
    assert.equal(await shows("tw-logout-btn"), true);
    assert.equal(await shows("tw-listen-card"), true);
    await page.waitFor(`/Listening/.test(document.getElementById("tw-listen-status").textContent)`);
    await page.waitFor(`/Mochi Bun followed at/.test(document.getElementById("tw-recent").textContent)`);
    const identity = await page.evaluate(`JSON.parse(localStorage.getItem("frills:twitch:bridge"))`);
    await until(async () => {
      const res = await fetch(`${base}/api/follows/${identity.code}?after=0`);
      return (await res.json()).items?.some((i) => i.name === "Mochi Bun" && i.user === "mochi_bun");
    }, 8000);
    await page.evaluate(`document.getElementById("tw-test").click()`);
    await page.waitFor(`/^Sent\./.test(document.getElementById("tw-test-note").textContent)`);
    const names = (await (await fetch(`${base}/api/follows/${identity.code}?after=0`)).json()).items.map((i) => i.name);
    assert.deepEqual(names.slice(-2), ["Mochi Bun", "Frills Test"]);
    await page.evaluate(`document.getElementById("tw-logout-btn").click()`);
    assert.equal(await shows("tw-login-btn"), true, "logged out: the login button is back");
    assert.equal(await shows("tw-listen-card"), false);
    assert.equal(await page.evaluate(`localStorage.getItem("frills:twitch:login")`), null);
  } finally {
    await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: added.identifier });
    await page.evaluate(`localStorage.removeItem("frills:twitch:login")`);
  }
});

test("the alerts editor, logged in to Twitch (with a pretend Twitch): no second page needed, a follower shows in the preview and reaches the box, and the test follower works", { skip }, async () => {
  const added = await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.setItem("frills:twitch:login", JSON.stringify({ token: "abcdefghij1234567890", login: "ainzzuu", userId: "42", savedAt: Date.now() }));
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, options) => {
      const u = String(url);
      if (u === "https://id.twitch.tv/oauth2/validate") return Promise.resolve(new Response(JSON.stringify({ client_id: "tcve57go7uzw3k8bfptf3kgxdjdizz", login: "ainzzuu", user_id: "42", scopes: ["moderator:read:followers"], expires_in: 5000 }), { status: 200 }));
      if (u.startsWith("https://api.twitch.tv/helix/eventsub/subscriptions")) return Promise.resolve(new Response("{}", { status: 202 }));
      return realFetch(url, options);
    };
    window.WebSocket = class {
      constructor(url) {
        this.url = url;
        setTimeout(() => {
          this.onmessage && this.onmessage({ data: JSON.stringify({ metadata: { message_id: "w1", message_type: "session_welcome" }, payload: { session: { id: "s1", keepalive_timeout_seconds: 10 } } }) });
          setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify({ metadata: { message_id: "n1", message_type: "notification" }, payload: { subscription: { type: "channel.follow" }, event: { user_id: "7", user_login: "editor_fan", user_name: "Editor Fan", followed_at: "2026-10-14T10:00:00Z" } } }) }), 400);
        }, 50);
      }
      close() {}
      send() {}
    };` });
  try {
    await page.goto(`${base}/alerts/?platform=twitch`, { settle: 1500 });
    const shows = (selector) => page.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); return Boolean(n) && !n.hidden && getComputedStyle(n).display !== "none"; })()`);
    await page.waitFor(`document.getElementById("tw-status").textContent === "Logged in as @ainzzuu."`);
    assert.equal(await shows("#tw-login-btn"), false, "already logged in: no login button");
    assert.equal(await shows("#tw-logout-btn"), true);
    assert.equal(await shows("#tw-test-follower"), true);
    assert.equal(await page.evaluate(`document.getElementById("follows-on").checked`), true, "logging in turns the follows on for the link");
    await page.evaluate(`(() => { const i = document.getElementById("source-channel"); i.value = "pond_cafe"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    const identity = await page.evaluate(`JSON.parse(localStorage.getItem("frills:twitch:bridge"))`);
    assert.equal(new URL(await page.evaluate(`document.getElementById("link").value`)).searchParams.get("follows"), identity.code);
    // a follower arrives from Twitch: shown in the preview, and put in the box so the real overlay shows it too
    await page.waitFor(`[...document.querySelectorAll(".alert__words")].some((n) => n.textContent === "Editor Fan just followed!")`, 10000);
    await until(async () => (await (await fetch(`${base}/api/follows/${identity.code}?after=0`)).json()).items?.some((i) => i.name === "Editor Fan"), 8000);
    await page.waitFor(`/is running/.test(document.getElementById("follows-state").textContent)`);
    // the test follower
    await page.evaluate(`document.getElementById("tw-test-follower").click()`);
    await page.waitFor(`/Test follower sent/.test(document.getElementById("follows-state").textContent)`);
    await page.waitFor(`[...document.querySelectorAll(".alert__words")].some((n) => n.textContent === "Frills Test just followed!")`, 8000);
    // logging out
    await page.evaluate(`document.getElementById("tw-logout-btn").click()`);
    await page.waitFor(`!document.getElementById("tw-login-btn").hidden`);
    assert.equal(await shows("#tw-test-follower"), false);
    assert.equal(await page.evaluate(`localStorage.getItem("frills:twitch:login")`), null);
  } finally {
    await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: added.identifier });
    await page.evaluate(`localStorage.removeItem("frills:twitch:login")`);
  }
});
