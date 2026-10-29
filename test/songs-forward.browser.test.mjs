// The Song requests overlay passing viewers' !sr and !next on to Frills (so the Spotify queue works with the Frills page closed), in a real headless
// Chrome: a pretend TikTok (through the helper) gives the overlay chat, and the page's fetch is replaced to write down what is sent to Frills'
// Worker. With a Spotify code in the link each !sr and !next is passed on, with no key; without one, or in practice mode, nothing is.
// Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createHelper } from "../helper/server.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "overlay", "songs", "index.html"))) throw new Error("dist/ has no songs overlay. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

const CODE = "AbCdEfGhIjKlMnOp";
class FakeConnection extends EventEmitter {
  constructor() { super(); this.gone = false; }
  async connect() { await sleep(5); }
  disconnect() { if (!this.gone) { this.gone = true; this.emit("disconnected"); } }
}
const opened = [];
async function withHelper() {
  const made = [];
  const helper = createHelper({ distDir: dist, factory: async (user) => { const conn = new FakeConnection(); made.push({ user, conn }); return conn; }, idleStopMs: 200 });
  const port = await helper.listen(0);
  opened.push(helper);
  return { base: `http://127.0.0.1:${port}`, made };
}
const until = async (test, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await test()) return; await sleep(25); }
  throw new Error("Timed out");
};
const tiktok = (id, content, user = "pal", over = {}) => ({ common: { msgId: id }, user: { id: "id-" + user, displayId: user, nickname: user === "pond_cafe" ? "Streamer" : "Pal" }, content, userIdentity: {}, ...over });

let page;
let stub = null;
before(async () => {
  if (skip) return;
  page = await launch();
  await page.viewport(520, 700);
  // what is sent to Frills' Worker is written down and answered with "ok"; the song catalog answers nothing
  stub = (await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__sent = [];
    const real = window.fetch.bind(window);
    window.fetch = async (input, options = {}) => {
      const url = String(typeof input === "string" ? input : input.url);
      if (url.includes("/api/spotify/")) { window.__sent.push({ method: options.method ?? "GET", url, headers: options.headers ?? {}, body: options.body ? JSON.parse(options.body) : null }); return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }); }
      if (url.includes("/api/songs") || url.includes("/api/nowplaying/")) return new Response(JSON.stringify({ ok: false, results: [] }), { status: 404, headers: { "content-type": "application/json" } });
      return real(input, options);
    };` })).identifier;
});
after(async () => {
  await page?.close();
  for (const h of opened) await h.close();
});
const sent = () => page.evaluate("window.__sent");

async function overlay(query) {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/songs/?${query}`, { settle: 600 });
  await until(() => made.length === 1);
  await sleep(150);
  return made[0].conn;
}

test("with a Spotify code in the link, the overlay passes a viewer's !sr and the streamer's !next on to Frills, with no key", { skip }, async () => {
  const conn = await overlay(`channel=pond_cafe&platform=tiktok&spotify=${CODE}`);
  conn.emit("chat", tiktok("m1", "!sr levitating dua lipa"));
  await until(async () => (await sent()).length === 1);
  conn.emit("chat", tiktok("m2", "!sr dance monkey", "pal2"));
  conn.emit("chat", tiktok("m3", "!next", "pond_cafe"));
  await until(async () => (await sent()).length === 3);
  const all = await sent();
  assert.deepEqual(all.map((c) => [c.method, c.url, c.body]), [
    ["POST", `/api/spotify/${CODE}/request`, { query: "levitating dua lipa", name: "Pal" }],
    ["POST", `/api/spotify/${CODE}/request`, { query: "dance monkey", name: "Pal" }],
    ["POST", `/api/spotify/${CODE}/next`, { name: "Streamer" }],
  ]);
  assert.ok(all.every((c) => !("x-key" in c.headers)), "the overlay has only the code, never the key");
  assert.equal(await page.evaluate('document.getElementById("note").hidden'), true);
});

test("a viewer's !next is not passed on, nor is chat that is not a command", { skip }, async () => {
  const conn = await overlay(`channel=pond_cafe&platform=tiktok&spotify=${CODE}`);
  conn.emit("chat", tiktok("m1", "!next", "pal"));
  conn.emit("chat", tiktok("m2", "hello everyone", "pal"));
  conn.emit("chat", tiktok("m3", "!sr one more song", "pal3"));
  await until(async () => (await sent()).length === 1);
  await sleep(300);
  assert.deepEqual((await sent()).map((c) => c.url), [`/api/spotify/${CODE}/request`]);
});

test("with no Spotify code in the link, or in practice mode, nothing is passed on", { skip }, async () => {
  const conn = await overlay("channel=pond_cafe&platform=tiktok");
  conn.emit("chat", tiktok("m1", "!sr levitating"));
  await sleep(500);
  assert.deepEqual(await sent(), []);
  await page.goto(`${(await withHelper()).base}/overlay/songs/?demo=1&spotify=${CODE}&pace=300`, { settle: 1500 });
  assert.deepEqual((await sent()).filter((c) => c.method === "POST"), [], "the practice requests are made up on the page and never reach Spotify");
});
