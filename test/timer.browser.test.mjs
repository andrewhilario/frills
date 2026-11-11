// The subathon timer in a real headless Chrome: gifts from a pretend TikTok add the seconds the rules say, the editor's buttons reach the overlay
// through the local copy of the Worker's post box (the same code over SQLite), a reload carries the clock on, and the editor puts its code in the link.
// Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome, launch, sleep, waitForServer } from "../scripts/lib/chrome.mjs";
import { createHelper } from "../helper/server.mjs";

const root = join(import.meta.dirname, "..");
const dist = join(root, "dist");
if (!existsSync(join(dist, "timer", "index.html"))) throw new Error("dist/ has no timer page. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

class FakeConnection extends EventEmitter {
  async connect() { await sleep(5); }
  disconnect() { this.emit("disconnected"); }
}
const opened = [];
async function withHelper() {
  const made = [];
  const helper = createHelper({ distDir: dist, factory: async () => { const c = new FakeConnection(); made.push(c); return c; }, idleStopMs: 200, offlineWaitMs: 60, limitedWaitMs: 60, backoffMs: [30, 30] });
  const port = await helper.listen(0);
  opened.push(helper);
  return { base: `http://127.0.0.1:${port}`, made };
}
const until = async (check, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await check()) return; await sleep(40); }
  throw new Error("Timed out");
};

const port = 5800 + Math.floor(Math.random() * 300);
const served = `http://localhost:${port}`;
const folder = mkdtempSync(join(tmpdir(), "frills-timer-"));
const CODE = "abcdefghij123456";
const KEY = "k".repeat(32);
let server;
let page;
before(async () => {
  if (skip) return;
  server = spawn(process.execPath, ["scripts/serve.mjs", String(port)], { cwd: root, stdio: "ignore", env: { ...process.env, FEEDBACK_DB: join(folder, "db.sqlite") } });
  await waitForServer(served);
  page = await launch();
  await page.viewport(1280, 900);
});
after(async () => {
  await page?.close();
  server?.kill();
  for (const h of opened) await h.close();
  await sleep(300);
  try { rmSync(folder, { recursive: true, force: true }); } catch { /* a temp folder */ }
});

const text = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim() ?? null`);
const clock = () => text(".timer__clock");
/** The clock in seconds (it counts down, so it is read as a number): "1:00:10" is 3610. */
const seconds = async () => (await clock()).split(":").reduce((a, n) => a * 60 + Number(n), 0);
const click = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const command = async (body, { code = CODE, key = KEY } = {}) => {
  const res = await fetch(`${served}/api/timer/${code}`, { method: "POST", headers: { origin: served, "x-key": key, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
};
const person = (name) => ({ id: name, displayId: name, nickname: name });
const giftEvent = (id, name, giftName, diamondCount, count = 1) => ({ common: { msgId: id }, user: person(name), gift: { name: giftName, type: 2, diamondCount }, repeatCount: count });

test("the timer pages load under the security policy with no console errors", { skip }, async () => {
  for (const path of ["/timer/", "/overlay/timer/?demo=1"]) {
    await page.goto(served + path, { settle: 600 });
    assert.deepEqual(page.problems, [], `${path}: ${page.problems.join(" | ")}`);
  }
});

test("overlay: gifts from a LIVE add the seconds the rules say, a follow adds its own, and the bump says how much", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/timer/?channel=pond_cafe&platform=tiktok&startMinutes=60&autoStart=1&giftRules=Rose%3D10%2C+Galaxy%3D300&perDiamonds=60&followSeconds=10`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  assert.equal(await clock(), "1:00:00", "ready at the starting time");
  made[0].emit("gift", giftEvent("g1", "Ann", "Rose", 1, 1)); // a streak that ends: the final count comes with repeatEnd
  await until(async () => (await seconds()) >= 3609 && (await seconds()) <= 3610);
  assert.equal(await text(".timer__plus"), "+10s");
  made[0].emit("gift", { ...giftEvent("g2", "Ben", "Galaxy", 1000), repeatEnd: 1 });
  await until(async () => (await seconds()) > 3900 && (await seconds()) <= 3910, 6000);
  made[0].emit("gift", { ...giftEvent("g3", "Cat", "Panda", 100), repeatEnd: 1 }); // not in the list: 100 diamonds at 60 per 100
  await until(async () => (await seconds()) > 3960 && (await seconds()) <= 3970, 6000);
  made[0].emit("follow", { common: { msgId: "f1" }, user: person("Dan") });
  await until(async () => (await seconds()) > 3970 && (await seconds()) <= 3980, 6000);
  assert.equal(await page.evaluate(`document.querySelector(".timer").dataset.status`), "running");
});

test("overlay: the editor's commands reach it through the box: start, add, pause, resume, reset, once each, and an old command is not obeyed on load", { skip }, async () => {
  await command({ cmd: "add", value: 999 }); // before the overlay exists: must never be obeyed
  await page.goto(`${served}/overlay/timer/?channel=pond_cafe&platform=tiktok&startMinutes=60&code=${CODE}`, { settle: 1500 });
  assert.equal(await clock(), "1:00:00", "ready, and the old command did nothing");
  assert.equal(await page.evaluate(`document.querySelector(".timer").dataset.status`), "ready");
  await command({ cmd: "start" });
  await until(async () => (await page.evaluate(`document.querySelector(".timer").dataset.status`)) === "running", 10000);
  await command({ cmd: "add", value: 120 });
  await until(async () => (await seconds()) > 3710 && (await seconds()) <= 3720, 10000);
  await command({ cmd: "pause" });
  await until(async () => (await page.evaluate(`document.querySelector(".timer").dataset.status`)) === "paused", 10000);
  const frozen = await clock();
  await sleep(1500);
  assert.equal(await clock(), frozen, "a paused clock does not move");
  assert.equal(await text(".timer__note"), "Paused");
  await command({ cmd: "resume" });
  await until(async () => (await page.evaluate(`document.querySelector(".timer").dataset.status`)) === "running", 10000);
  // a reload carries on: the clock was running, so it is still running (and has not been started again by an old "start")
  const before = await seconds();
  await page.goto(`${served}/overlay/timer/?channel=pond_cafe&platform=tiktok&startMinutes=60&code=${CODE}`, { settle: 1500 });
  assert.equal(await page.evaluate(`document.querySelector(".timer").dataset.status`), "running", "it carries on after a reload");
  assert.ok(Math.abs((await seconds()) - before) <= 6, `still near ${before}, not started over (now ${await clock()})`);
  await command({ cmd: "reset", value: 300 });
  await until(async () => (await page.evaluate(`document.querySelector(".timer").dataset.status`)) === "ready", 10000);
  assert.equal(await clock(), "5:00");
});

test("overlay: time that runs out ends once and says so", { skip }, async () => {
  const code = "zzzzzzzzzzzzzzzz";
  await page.goto(`${served}/overlay/timer/?channel=pond_cafe&platform=tiktok&startMinutes=1&code=${code}`, { settle: 1200 });
  await command({ cmd: "start" }, { code });
  await command({ cmd: "add", value: -57 }, { code });
  await until(async () => (await page.evaluate(`document.querySelector(".timer").dataset.status`)) === "ended", 15000);
  assert.equal(await clock(), "0:00");
  assert.equal(await text(".timer__note"), "Time’s up!");
});

test("editor: the buttons move the preview clock and post to the box, and the link carries the code and the rules", { skip }, async () => {
  await page.goto(served + "/timer/", { settle: 900 });
  const type = (selector, value) => page.evaluate(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await type("#c-startMinutes", "30");
  await type("#source-channel", "pond.pal");
  await click('[data-test="start"]');
  await until(async () => (await page.evaluate(`document.querySelector(".timer").dataset.status`)) === "running");
  await click('[data-test="minute"]');
  await until(async () => (await seconds()) > 1855);
  await until(async () => /Sent/.test((await text("#timer-sent")) ?? ""), 5000);
  const url = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(url.pathname, "/overlay/timer/");
  assert.equal(url.searchParams.get("startMinutes"), "30");
  const code = url.searchParams.get("code");
  assert.match(code, /^[A-Za-z0-9_-]{16}$/, "the code that joins the buttons to the overlay is in the link");
  const box = await (await fetch(`${served}/api/timer/${code}?after=0`)).json();
  assert.deepEqual(box.items.map((i) => [i.cmd, i.value]), [["start", 0], ["add", 60]], "what the buttons did is what the overlay will be told");
  await click('[data-test="gift"]');
  await click('[data-test="reset"]');
  await until(async () => (await page.evaluate(`document.querySelector(".timer").dataset.status`)) === "ready");
});

test("overlay: each layout draws the clock its own way, and the tiles show hours, minutes and seconds", { skip }, async () => {
  const at = (layout, minutes = 75) => `${served}/overlay/timer/?channel=pond_cafe&platform=tiktok&startMinutes=${minutes}&layout=${layout}`;
  const style = (selector, prop) => page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)}))[${JSON.stringify(prop)}]`);
  await page.goto(at("box"), { settle: 800 });
  assert.equal(await clock(), "1:15:00");
  assert.notEqual(await style(".timer__box", "borderTopWidth"), "0px", "the box has its edge");
  await page.goto(at("minimal"), { settle: 800 });
  assert.equal(await page.evaluate(`document.querySelector(".timer").dataset.layout`), "minimal");
  assert.equal(await style(".timer__box", "borderTopWidth"), "0px", "minimal has no edge");
  assert.equal(await style(".timer__box", "backgroundColor"), "rgba(0, 0, 0, 0)", "and no card");
  await page.goto(at("bar"), { settle: 800 });
  assert.equal(await style(".timer__box", "flexDirection"), "row", "one line: the words and the clock side by side");
  await page.goto(at("tiles"), { settle: 800 });
  assert.equal(await style(".timer__clock", "display"), "none", "the tiles replace the one clock");
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll(".timer__tile:not([hidden])")].map((t) => t.querySelector(".timer__num").textContent + " " + t.querySelector(".timer__unit").textContent)`), ["01 hours", "15 minutes", "00 seconds"]);
  await page.goto(at("tiles", 5), { settle: 800 });
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll(".timer__tile:not([hidden])")].map((t) => t.querySelector(".timer__unit").textContent)`), ["minutes", "seconds"], "no hours card while there are no hours");
});

test("every overlay's card can be made see-through with the opacity setting", { skip }, async () => {
  const bg = (url, selector) => page.goto(served + url, { settle: 800 }).then(() => page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor`));
  assert.notEqual(await bg("/overlay/timer/?demo=1", ".timer__box"), "rgba(0, 0, 0, 0)", "solid by default");
  assert.equal(await bg("/overlay/timer/?demo=1&bgAlpha=0", ".timer__box"), "rgba(255, 246, 214, 0)", "the timer card is see-through at 0");
  assert.equal(await bg("/overlay/counter/?demo=1&bgAlpha=50", ".counter__item"), "rgba(255, 246, 214, 0.5)", "half see-through for the counter");
  assert.equal(await bg("/overlay/gifts/?demo=1&bgAlpha=0", ".giftlist__title"), "rgba(255, 246, 214, 0)");
});

test("editor: the gifts are a list of rows to pick or type, with a time each, and the link carries them", { skip }, async () => {
  await page.goto(served + "/timer/", { settle: 900 });
  const rows = () => page.evaluate(`[...document.querySelectorAll(".pairs__row")].map((r) => r.querySelector(".pairs__name").value + "|" + r.querySelector(".pairs__amount").value + "|" + r.querySelector(".pairs__unit").value)`);
  assert.deepEqual(await rows(), ["Rose|10|sec", "Finger Heart|30|sec"], "the starting list is two rows");
  assert.ok((await page.evaluate(`document.querySelectorAll("#c-giftRules-names option").length`)) >= 10, "common gifts to pick from");
  await click(".pairs__add");
  await page.evaluate(`(() => { const r = [...document.querySelectorAll(".pairs__row")].pop(); const set = (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }; set(r.querySelector(".pairs__name"), "Galaxy"); set(r.querySelector(".pairs__amount"), "5"); set(r.querySelector(".pairs__unit"), "min"); })()`);
  await page.evaluate(`document.querySelector(".pairs__remove").click()`); // takes Rose away
  assert.deepEqual(await rows(), ["Finger Heart|30|sec", "Galaxy|5|min"]);
  await page.evaluate(`(() => { const i = document.querySelector("#source-channel"); i.value = "pond.pal"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  const url = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(url.searchParams.get("giftRules"), "Finger Heart=30, Galaxy=300", "the rows are written into the link, minutes as seconds");
  await click('[data-test="start"]');
  await click('[data-test="gift"]');
  await page.goto(url.href.replace(url.origin, served), { settle: 900 });
  assert.equal(await page.evaluate(`document.querySelector(".timer")?.dataset.layout`), "box", "the link opens the overlay");
});

test("the overlays page lists the timer, marked beta", { skip }, async () => {
  await page.goto(served + "/overlays/", { settle: 500 });
  const card = await page.evaluate(`[...document.querySelectorAll(".tool")].filter((t) => t.querySelector("a[href='/timer/']")).map((t) => t.querySelector(".tool__badge")?.textContent.trim())`);
  assert.deepEqual(card, ["Beta"]);
});
