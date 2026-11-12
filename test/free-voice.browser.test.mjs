// A free visitor on the talking pet's page, in a real headless Chrome: the free browser voice is the only voice they get, and the page never asks the server for an AI voice for them.
// The local server here has an AI provider key (a made-up one that is never used) and requires a pass, and the page's region simulator is set to the US, so the only thing keeping a free
// visitor out is the Plus check itself. Skipped on a computer with no Chrome or Edge.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome, launch, sleep, waitForServer } from "../scripts/lib/chrome.mjs";

const root = join(import.meta.dirname, "..");
if (!existsSync(join(root, "dist", "tts", "index.html"))) throw new Error("dist/ has no talking pet page. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

const folder = mkdtempSync(join(tmpdir(), "frills-freevoice-"));
const port = 6900 + Math.floor(Math.random() * 300);
const served = `http://localhost:${port}`;
let server;
let page;
let installed = null;

before(async () => {
  if (skip) return;
  server = spawn(process.execPath, ["scripts/serve.mjs", String(port)], { cwd: root, stdio: "ignore", env: { ...process.env, FEEDBACK_DB: join(folder, "db.sqlite"), REQUIRE_PRO_PASS: "1", OPENAI_TTS_KEY: "sk-made-up-never-used" } });
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

async function openWithRecorder() {
  if (installed) await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: installed });
  installed = (await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    window.__calls = [];
    const real = window.fetch.bind(window);
    window.fetch = (input, options = {}) => { window.__calls.push(((options && options.method) || "GET") + " " + (typeof input === "string" ? input : input.url)); return real(input, options); };
  })()` })).identifier;
  await page.goto(`${served}/tts/`, { settle: 600 });
}
const calls = () => page.evaluate("window.__calls");

test("a free visitor who asks for a line gets no AI voice: the page asks the server what is allowed, is told no, and never asks for the voice", { skip }, async () => {
  await openWithRecorder();
  await page.waitFor(`getComputedStyle(document.getElementById("sim-country")).display !== "none"`, { timeout: 8000 });
  await page.evaluate(`(() => { const s = document.getElementById("sim-country"); s.value = "US"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await sleep(500);
  await page.evaluate(`(() => { document.getElementById("say-input").value = "Hello pond, nice stream"; document.getElementById("say-form").requestSubmit(); })()`);
  await sleep(1800);
  const all = await calls();
  assert.ok(all.some((c) => c === "GET /api/pro/status"), "the page asked the server what this visitor may do");
  assert.deepEqual(all.filter((c) => c.includes("/api/tts")), [], "and, told it is not allowed, never asked for an AI voice");
});

test("the same visitor can still speak a line with the free voice mode, with no request to the server for a voice at all", { skip }, async () => {
  await openWithRecorder();
  await page.waitFor(`document.getElementById("c-engine") !== null || document.querySelector('[aria-label="Voice mode"]') !== null`, { timeout: 8000 });
  await page.evaluate(`(() => { const chip = [...document.querySelectorAll('[aria-label="Voice mode"] .chip')].find((c) => c.textContent.trim().startsWith("Browser voice")); chip.click(); })()`);
  await sleep(600);
  await page.evaluate("window.__calls.length = 0"); // (the page asks for its own status line when it opens; what counts is what speaking asks for)
  await page.evaluate(`(() => { document.getElementById("say-input").value = "Free voice only"; document.getElementById("say-form").requestSubmit(); })()`);
  await sleep(1500);
  const all = await calls();
  assert.deepEqual(all.filter((c) => c.includes("/api/tts") || c.includes("/api/pro/status")), [], "browser voice mode asks the server for nothing");
});
