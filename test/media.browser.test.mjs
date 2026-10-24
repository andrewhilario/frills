// Uploading your own image, GIF and sound in the alerts editor, in a real headless Chrome against the local server (the same Worker code
// over SQLite): tick the rights box, choose a file, it is stored, appears in the link and in the alert, a sound plays, a wrong kind of
// file is refused, and the delete button removes it. Skipped on a computer with no Chrome or Edge.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome, launch, sleep, waitForServer } from "../scripts/lib/chrome.mjs";

const root = join(import.meta.dirname, "..");
if (!existsSync(join(root, "dist", "alerts", "index.html"))) throw new Error("dist/ has no alerts page. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

const port = 4500 + Math.floor(Math.random() * 400);
const base = `http://localhost:${port}`;
const folder = mkdtempSync(join(tmpdir(), "frills-media-"));
let server;
let page;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const GIF = "R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=";
const WAV = "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

before(async () => {
  if (skip) return;
  server = spawn(process.execPath, ["scripts/serve.mjs", String(port)], { cwd: root, stdio: "ignore", env: { ...process.env, FEEDBACK_DB: join(folder, "db.sqlite") } });
  await waitForServer(base);
  page = await launch();
  await page.viewport(1280, 900);
  // a pretend audio system, to see what gets played
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__played = [];
    window.AudioContext = class { constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
      resume() { return Promise.resolve(); } decodeAudioData(d) { return Promise.resolve({ bytes: d.byteLength }); }
      createGain() { return { gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      createBufferSource() { const s = { playbackRate: { value: 1 }, connect() {}, start() { window.__played.push(s.buffer.bytes); } }; return s; }
      createOscillator() { return { frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; } };` });
});
after(async () => {
  await page?.close();
  server?.kill();
  await sleep(300);
  try { rmSync(folder, { recursive: true, force: true }); } catch { /* a temp folder */ }
});

const labels = () => page.evaluate(`[...document.querySelectorAll(".media")].map((m) => m.querySelector(".ctl__label").textContent)`);
const status = (which) => page.evaluate(`document.querySelectorAll(".media")[${which}].querySelector(".media__status").textContent`);
/** Ticks the rights box of picker number `which`, puts a file in its file input, and lets the page see it. */
const pick = (which, b64, name, type) => page.evaluate(`(() => {
  const picker = document.querySelectorAll(".media")[${which}];
  const ok = document.getElementById("media-ok");
  if (!ok.checked) ok.click();
  const input = picker.querySelector("input[type=file]");
  const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} }));
  input.files = dt.files;
  input.dispatchEvent(new Event("change"));
})()`);

test("the file box stays off until the rights box is ticked", { skip }, async () => {
  await page.goto(`${base}/alerts/`, { settle: 700 });
  assert.equal(await page.evaluate(`document.querySelector(".media input[type=file]").disabled`), true);
  await page.evaluate(`document.getElementById("media-ok").click()`);
  assert.equal(await page.evaluate(`document.querySelector(".media input[type=file]").disabled`), false);
});

test("a picture is uploaded, shown, put in the link and drawn in the alert", { skip }, async () => {
  await page.goto(`${base}/alerts/`, { settle: 700 });
  assert.equal((await labels()).length, 16, "an image and a sound each for follow, gift, share and a big gift (TikTok) and for sub, gifted subs, bits and raid (Twitch)");
  const at = (await labels()).findIndex((k) => k === "Your own image or GIF"); // the follow one comes first
  await pick(at, PNG, "me.png", "image/png");
  await page.waitFor(`document.querySelectorAll(".media")[${at}].querySelector(".media__preview img")`);
  assert.match(await status(at), /^Uploaded\. Your delete code is [A-Za-z0-9_-]{16}\./);
  await page.evaluate(`document.getElementById("source-channel").value = "pond_cafe"; document.getElementById("source-channel").dispatchEvent(new Event("input", { bubbles: true }))`);
  const link = new URL(await page.evaluate(`document.getElementById("link").value`));
  const id = link.searchParams.get("giftImage");
  assert.match(id, /^[A-Za-z0-9_-]{16}$/);
  const served = await page.evaluate(`fetch("/api/media/${id}").then(async (r) => [r.status, r.headers.get("content-type"), (await r.arrayBuffer()).byteLength])`);
  assert.deepEqual(served, [200, "image/png", Buffer.from(PNG, "base64").length]);
  await page.evaluate(`document.querySelector('[data-test="gift-1"]').click()`);
  await page.waitFor(`document.querySelector(".alert .alert__custom")`);
  assert.equal(await page.evaluate(`document.querySelector(".alert .alert__custom").getAttribute("src")`), `/api/media/${id}`);
  assert.match(await page.evaluate(`document.querySelector(".alert .alert__custom").className`), /alert__custom--beside/);
});

test("the image can go as a sticker on the corner", { skip }, async () => {
  await page.evaluate(`(() => { const s = [...document.querySelectorAll("#look-controls select")].find((x) => [...x.options].some((o) => o.value === "sticker")); s.value = "sticker"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await page.evaluate(`document.querySelector('[data-test="gift-1"]').click()`);
  await page.waitFor(`document.querySelector(".alert .alert__custom--sticker")`);
});

test("a sound is uploaded and played, a picture in the sound place is refused, and the delete button removes the file", { skip }, async () => {
  await page.goto(`${base}/alerts/`, { settle: 700 });
  const at = (await labels()).findIndex((k) => k === "Your own sound");
  await pick(at, GIF, "pic.gif", "image/gif");
  await page.waitFor(`/That is a picture/.test(document.querySelectorAll(".media")[${at}].querySelector(".media__status").textContent)`);
  assert.equal(await page.evaluate(`document.querySelectorAll(".media")[${at}].querySelector("audio")`), null, "nothing was kept");

  await pick(at, WAV, "ding.wav", "audio/wav");
  await page.waitFor(`document.querySelectorAll(".media")[${at}].querySelector("audio")`);
  const id = await page.evaluate(`new URL(document.querySelectorAll(".media")[${at}].querySelector("audio").src).pathname.split("/").pop()`);
  await page.evaluate(`document.querySelector('[data-test="gift-1"]').click()`);
  await page.waitFor(`window.__played.length > 0`);
  assert.deepEqual(await page.evaluate(`window.__played`), [Buffer.from(WAV, "base64").length], "the uploaded file was fetched, decoded and played");

  await page.evaluate(`[...document.querySelectorAll(".media")[${at}].querySelectorAll("button")].find((b) => b.textContent === "Delete from Frills").click()`);
  await page.waitFor(`/Deleted from Frills/.test(document.querySelectorAll(".media")[${at}].querySelector(".media__status").textContent)`);
  assert.equal(await page.evaluate(`fetch("/api/media/${id}").then((r) => r.status)`), 404, "gone from the server");
});

test("a file that is too big is turned away in the page, before any upload: a picture over 1 MB, a sound over 300 KB", { skip }, async () => {
  await page.goto(`${base}/alerts/`, { settle: 700 });
  const offer = (selector, size, name, type) => page.evaluate(`(() => {
    const picker = [...document.querySelectorAll(".media")].find((m) => m.querySelector(${JSON.stringify(selector)}));
    if (!document.getElementById("media-ok").checked) document.getElementById("media-ok").click();
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(${size})], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} }));
    const input = picker.querySelector("input[type=file]");
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  })()`);
  await offer("input[accept*=image]", 1024 * 1024 + 1, "big.png", "image/png");
  assert.match(await status(0), /picture is over 1 MB/);
  const sounds = await page.evaluate(`[...document.querySelectorAll(".media")].findIndex((m) => m.querySelector("input[accept*=audio]"))`);
  await offer("input[accept*=audio]", 300 * 1024 + 1, "long.wav", "audio/wav");
  assert.match(await status(sounds), /sound is over 300 KB/);
});
