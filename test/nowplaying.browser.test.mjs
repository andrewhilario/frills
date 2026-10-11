// "What is playing on Spotify" on the Song requests overlay, in a real headless Chrome against the local server (the same Worker code over
// SQLite): the tab's song is put in the post box and the overlay shows it as the song playing, with its position, follows a pause and a
// new song, and a code that was never used changes nothing. Skipped on a computer with no Chrome or Edge.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";

const root = join(import.meta.dirname, "..");
if (!existsSync(join(root, "dist", "songs", "index.html"))) throw new Error("dist/ has no songs page. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

const port = 4900 + Math.floor(Math.random() * 300);
const base = `http://localhost:${port}`;
const folder = mkdtempSync(join(tmpdir(), "frills-np-"));
const CODE = "AbCdEfGhIjKlMnOp";
const KEY = "k".repeat(32);
let server;
let page;

before(async () => {
  if (skip) return;
  server = spawn(process.execPath, ["scripts/serve.mjs", String(port)], { cwd: root, stdio: "ignore", env: { ...process.env, FEEDBACK_DB: join(folder, "db.sqlite") } });
  await sleep(900);
  page = await launch();
  await page.viewport(900, 700);
});
after(async () => {
  await page?.close();
  server?.kill();
  await sleep(200);
  rmSync(folder, { recursive: true, force: true });
});

const post = async (song, code = CODE) => {
  const res = await fetch(`${base}/api/nowplaying/${code}`, { method: "PUT", headers: { origin: base, "x-key": KEY, "content-type": "application/json" }, body: JSON.stringify(song) });
  return res.status;
};
const song = (over = {}) => ({ playing: true, title: "Without Me", artist: "Dayseeker", cover: "https://i.scdn.co/image/ab67616d00001e02abcdef", progressMs: 165000, durationMs: 225000, ...over });
const until = async (check, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await check()) return; await sleep(100); }
  throw new Error("Timed out");
};
const look = () => page.evaluate(`(() => {
  const now = document.querySelector(".song--now");
  const bar = now?.querySelector(".song__progress i");
  return now ? { title: now.querySelector(".song__title")?.textContent, artist: now.querySelector(".song__artist")?.textContent, by: now.querySelector(".song__by")?.textContent, cover: now.querySelector(".song__img")?.getAttribute("src"), bar: bar ? { state: getComputedStyle(bar).animationPlayState, duration: parseFloat(getComputedStyle(bar).animationDuration), delay: parseFloat(getComputedStyle(bar).animationDelay) } : null } : null;
})()`);

test("the overlay shows what Spotify is playing as the song playing, with its real position, and follows a pause and a new song", { skip }, async () => {
  assert.equal(await post(song()), 200);
  await page.goto(`${base}/overlay/songs/?channel=pond_cafe&platform=tiktok&spotify=${CODE}`, { settle: 900 });
  await until(async () => (await look())?.title === "Without Me");
  let now = await look();
  assert.deepEqual([now.title, now.artist, now.by], ["Without Me", "Dayseeker", "on Spotify"]);
  assert.equal(now.cover, "https://i.scdn.co/image/ab67616d00001e02abcdef");
  assert.equal(now.bar.state, "running");
  assert.equal(now.bar.duration, 225, "the bar fills over the song's own length");
  assert.ok(-now.bar.delay >= 165 && -now.bar.delay < 175, "and starts where Spotify is: " + now.bar.delay);
  await sleep(1100);
  await post(song({ playing: false, progressMs: 170000 }));
  await until(async () => (await look())?.bar?.state === "paused", 9000);
  now = await look();
  assert.ok(-now.bar.delay >= 169.5 && -now.bar.delay <= 171, "paused where it was: " + now.bar.delay);
  await sleep(800);
  await post(song({ title: "Heat Waves", artist: "Glass Animals", progressMs: 5000, durationMs: 238000 }));
  await until(async () => (await look())?.title === "Heat Waves", 9000);
  now = await look();
  assert.deepEqual([now.artist, now.bar.state, now.bar.duration], ["Glass Animals", "running", 238]);
});

test("a code nobody has used shows the chat's own queue as before, and a made-up code is ignored", { skip }, async () => {
  await page.goto(`${base}/overlay/songs/?channel=pond_cafe&platform=tiktok&spotify=ZyXwVuTsRqPoNmLk`, { settle: 1500 });
  assert.equal(await look(), null, "nothing playing and no requests: no song card");
  await page.goto(`${base}/overlay/songs/?channel=pond_cafe&platform=tiktok&spotify=../../etc`, { settle: 1500 });
  assert.equal(await look(), null);
  assert.equal(await page.evaluate('getComputedStyle(document.querySelector(".songs__idle")).display'), "flex", "the card that says how to ask");
});

test("the Spotify page has the share step, hidden until logged in, and it never shares unless asked", { skip }, async () => {
  await page.goto(`${base}/spotify/`, { settle: 900 });
  assert.equal(await page.evaluate('document.getElementById("sp-share-card").hidden'), true);
  assert.equal(await page.evaluate('document.getElementById("sp-sharing").checked'), false);
  assert.equal(await page.evaluate('document.getElementById("sp-link-box").hidden'), true);
});
