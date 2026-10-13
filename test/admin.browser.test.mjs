// The admin page in a real headless Chrome against the local server (the same Worker code over SQLite): log in (a wrong password is
// refused, the right one opens it), read the feedback, mark one done, delete one, look at the uploaded files and remove one, and log out.
// Skipped on a computer with no Chrome or Edge.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";

const root = join(import.meta.dirname, "..");
if (!existsSync(join(root, "dist", "admin", "index.html"))) throw new Error("dist/ has no admin page. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

const port = 4900 + Math.floor(Math.random() * 400);
const base = `http://localhost:${port}`;
const KEY = "a-long-enough-password";
const folder = mkdtempSync(join(tmpdir(), "frills-admin-"));
let server;
let page;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const WAV = Buffer.from("UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=", "base64");

before(async () => {
  if (skip) return;
  server = spawn(process.execPath, ["scripts/serve.mjs", String(port)], { cwd: root, stdio: "ignore", env: { ...process.env, FEEDBACK_DB: join(folder, "db.sqlite"), ADMIN_KEY: KEY } });
  await sleep(900);
  for (const [kind, message, contact] of [["idea", "Please add cat ears to the chat avatars", "mochi@pond.test"], ["broken", "The alerts stop after a few minutes in OBS", ""], ["look", "The glass look is great <b>thanks</b>", ""]]) {
    const res = await fetch(base + "/api/feedback", { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ kind, message, contact, website: "", took: 5000 }) });
    assert.equal(res.status, 201);
  }
  for (const file of [PNG, WAV]) {
    const res = await fetch(base + "/api/media", { method: "POST", headers: { origin: base, "x-consent": "yes" }, body: file });
    assert.equal(res.status, 201);
  }
  page = await launch();
  await page.viewport(1280, 900);
});
after(async () => {
  await page?.close();
  server?.kill();
  await sleep(300);
  try { rmSync(folder, { recursive: true, force: true }); } catch { /* a temp folder */ }
});

const $text = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
const visible = (selector) => page.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); return Boolean(n) && !n.hidden && n.offsetParent !== null; })()`);
const click = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const count = (selector) => page.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
const login = (password) => page.evaluate(`(() => { document.getElementById("key").value = ${JSON.stringify(password)}; document.getElementById("login-form").requestSubmit(); })()`);

test("a wrong password is refused and shows nothing; the right one opens the page with the totals", { skip }, async () => {
  await page.goto(base + "/admin/", { settle: 600 });
  assert.equal(await visible("#login"), true);
  assert.equal(await visible("#dash"), false);
  await login("not-the-password-at-all");
  await page.waitFor(`/not the right password/.test(document.getElementById("login-status").textContent)`);
  assert.equal(await visible("#dash"), false);
  await login(KEY);
  await page.waitFor(`document.querySelectorAll("#f-list .item").length === 3`);
  assert.equal(await visible("#login"), false);
  assert.equal(await visible("#dash"), true);
  const cards = await page.evaluate(`[...document.querySelectorAll("#cards .stat b")].map((b) => b.textContent)`);
  assert.deepEqual(cards.slice(0, 3), ["3", "3", "2"], "3 messages, 3 not done, 2 files");
});

test("feedback shows newest first, as plain text, with the contact; one can be marked done and the count follows", { skip }, async () => {
  const texts = await page.evaluate(`[...document.querySelectorAll("#f-list .item__text")].map((n) => n.textContent)`);
  assert.deepEqual(texts, ["The glass look is great <b>thanks</b>", "The alerts stop after a few minutes in OBS", "Please add cat ears to the chat avatars"]);
  assert.equal(await count("#f-list .item b"), 0, "a tag in a message is shown as text, never run");
  assert.match(await $text("#f-list .item:last-child .item__contact"), /mochi@pond\.test/);
  await click("#f-list .item:first-child .item__actions .btn");
  await page.waitFor(`document.querySelector("#f-list .item:first-child").classList.contains("is-done")`);
  await page.waitFor(`document.querySelectorAll("#cards .stat b")[1].textContent === "2"`);
  // only the not-done ones
  await page.evaluate(`[...document.querySelectorAll("#f-state .chip")].find((b) => b.textContent === "Not done").click()`);
  await page.waitFor(`document.querySelectorAll("#f-list .item").length === 2`);
  await page.evaluate(`[...document.querySelectorAll("#f-state .chip")].find((b) => b.textContent === "Done").click()`);
  await page.waitFor(`document.querySelectorAll("#f-list .item").length === 1`);
});

test("searching narrows the list, and a delete asks twice before it removes the message", { skip }, async () => {
  await page.evaluate(`[...document.querySelectorAll("#f-state .chip")].find((b) => b.textContent === "All").click()`);
  await page.waitFor(`document.querySelectorAll("#f-list .item").length === 3`);
  await page.evaluate(`(() => { const s = document.getElementById("f-search"); s.value = "cat ears"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await page.waitFor(`document.querySelectorAll("#f-list .item").length === 1`);
  const del = "#f-list .item .admin__danger";
  await click(del);
  assert.equal(await $text(del), "Really delete?");
  assert.equal(await count("#f-list .item"), 1, "one press only asks");
  await click(del);
  await page.waitFor(`document.querySelectorAll("#f-list .item").length === 0`);
  await page.waitFor(`document.querySelectorAll("#cards .stat b")[0].textContent === "2"`);
  assert.equal(await $text("#f-status"), "Nothing here.");
});

test("the files tab shows each upload (a picture, a player), and a file can be removed so its address stops working", { skip }, async () => {
  await click("#tab-files");
  await page.waitFor(`document.querySelectorAll("#m-list .file").length === 2`);
  assert.equal(await count("#m-list .file img"), 1);
  assert.equal(await count("#m-list .file audio"), 1);
  const id = await page.evaluate(`document.querySelector("#m-list .file img").getAttribute("src").split("/").pop()`);
  assert.equal((await fetch(`${base}/api/media/${id}`)).status, 200);
  await page.evaluate(`[...document.querySelectorAll("#m-kind .chip")].find((b) => b.textContent === "Images").click()`);
  await page.waitFor(`document.querySelectorAll("#m-list .file").length === 1`);
  const del = "#m-list .file .admin__danger";
  await click(del);
  await click(del);
  await page.waitFor(`document.querySelectorAll("#m-list .file").length === 0`);
  assert.equal((await fetch(`${base}/api/media/${id}`)).status, 404);
  await page.waitFor(`document.querySelectorAll("#cards .stat b")[2].textContent === "1"`);
});

test("logging out forgets the password, and a reload asks again", { skip }, async () => {
  await click("#logout");
  assert.equal(await visible("#login"), true);
  assert.equal(await visible("#dash"), false);
  await page.goto(base + "/admin/", { settle: 500 });
  assert.equal(await visible("#login"), true, "nothing was remembered");
});
