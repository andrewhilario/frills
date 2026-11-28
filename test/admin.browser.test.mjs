// The admin page in a real headless Chrome against the local server (the same Worker code over SQLite): log in (a wrong password is
// refused, the right one opens it), read the feedback, mark one done, delete one, look at the uploaded files and remove one, and log out.
// Skipped on a computer with no Chrome or Edge.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome, launch, sleep, waitForServer } from "../scripts/lib/chrome.mjs";

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
  await waitForServer(base);
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

test("the dashboard opens on the Overview: what needs attention, six numbers that never invent a figure, the chart, system health and the newest accounts and feedback; the side menu moves between sections", { skip }, async () => {
  await click("#tab-overview");
  assert.equal(await visible("#panel-overview"), true);
  assert.equal(await $text("#dash-title"), "Overview");
  await page.waitFor(`document.querySelectorAll("#kpis .kpi").length === 6 && /not connected/i.test(document.getElementById("attention").textContent)`);
  const kpis = await page.evaluate(`[...document.querySelectorAll("#kpis .kpi")].map((k) => [k.dataset.key, k.querySelector(".kpi__value").textContent, k.querySelector(".kpi__sub").textContent])`);
  assert.deepEqual(kpis.map((k) => k[0]), ["plus", "revenue", "accounts", "visits", "copies", "live"]);
  assert.deepEqual(kpis[0].slice(0, 2), ["plus", "0"], "no one has Plus in this database");
  assert.deepEqual(kpis[1].slice(0, 2), ["revenue", "$0.00"]);
  assert.deepEqual(kpis.slice(3).map((k) => [k[1], k[2]]), [["—", "Not connected"], ["—", "Not connected"], ["—", "Not connected"]], "with no Cloudflare secrets the traffic cards say so instead of showing numbers");
  assert.match(await $text("#chart-sentence"), /Not connected/);
  assert.equal(await count("#chart-tabs .chip"), 3);
  assert.match(await $text("#health"), /Database[\s\S]*Online/);
  assert.equal(await $text("#accounts"), "No accounts yet.");

  // the feedback that is still not done is on the menu, in the needs-attention list and in the latest feedback
  const fresh = Number(await page.evaluate(`document.querySelectorAll("#cards .stat b")[1].textContent`));
  assert.ok(fresh > 0, "the earlier tests leave some feedback not done");
  assert.equal(await $text("#nav-feedback"), String(fresh));
  assert.match(await $text("#attention"), new RegExp(`${fresh} new feedback`));
  assert.ok((await count("#latest .dash__row")) >= 1);

  // the buttons in the list and the menu go to the right section, and the address follows
  await page.evaluate(`[...document.querySelectorAll("#attention button")].find((b) => b.textContent === "Open inbox").click()`);
  assert.equal(await visible("#panel-feedback"), true);
  assert.equal(await visible("#panel-overview"), false);
  assert.equal(await $text("#dash-title"), "Feedback");
  assert.equal(await page.evaluate("location.hash"), "#feedback");
  await click("#tab-overview");
  assert.equal(await page.evaluate("location.hash"), "");
  await click("#quick-activate");
  assert.equal(await visible("#panel-plus"), true);
  assert.equal(await page.evaluate("document.activeElement.id"), "mp-email", "Activate a customer lands in the email box");
  await page.goto(base + "/404.html", { settle: 300 });
  await page.goto(base + "/admin/#plus", { settle: 600 });
  await page.waitFor(`!document.getElementById("dash").hidden`);
  assert.equal(await visible("#panel-plus"), true, "a link to #plus opens that section");
  assert.equal(await $text("#dash-title"), "Frills Plus");
  await click("#tab-overview");
});

test("the dashboard fits a phone: nothing runs off the side, and every button and menu link is a single line, at least 44px tall", { skip }, async () => {
  await click("#tab-overview");
  await page.waitFor(`document.querySelectorAll("#kpis .kpi").length === 6`);
  for (const width of [320, 375, 414, 768]) {
    await page.viewport(width, 800);
    await sleep(200);
    const m = await page.evaluate(`(() => {
      const d = document.documentElement;
      const touch = [...document.querySelectorAll(".dash .btn, .dash__link, .dash .chip, .dash__more")].filter((e) => e.offsetParent);
      return { overflow: Math.max(0, d.scrollWidth - d.clientWidth), offscreen: [...document.querySelectorAll(".dash *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).length, short: touch.filter((e) => e.getBoundingClientRect().height < 43.5).map((e) => e.textContent.trim()), tall: touch.filter((e) => e.getBoundingClientRect().height > 60).map((e) => e.textContent.trim()) };
    })()`);
    assert.deepEqual(m, { overflow: 0, offscreen: 0, short: [], tall: [] }, `at ${width}px: ${JSON.stringify(m)}`);
  }
  await page.viewport(1280, 900);
});

test("activating a customer can email them that their subscription is active, every customer has an email button that asks twice, and the confirmation stays on screen", { skip }, async () => {
  await click("#tab-plus");
  const outbox = async () => (await (await fetch(base + "/api/dev/outbox")).json());
  await page.evaluate(`(() => { document.getElementById("mp-email").value = "buyer@example.com"; document.getElementById("mp-form").requestSubmit(); })()`);
  await page.waitFor(`document.querySelectorAll("#p-list .item").length === 1`);
  assert.match(await $text("#p-status"), /Frills Plus is now active for buyer@example\.com for 30 days.*We emailed them\./, "the confirmation is still there after the list reloads");
  const mail = (await outbox()).find((m) => m.to === "buyer@example.com");
  assert.equal(mail.subject, "Your Frills Plus subscription is active");
  assert.match(mail.text, /\/account\/ with this email/);
  assert.match(mail.text, /\/guides\/plus\//);

  const send = "#p-list .item .admin__confirm";
  await click(send);
  assert.equal(await $text(send), "Really send?", "the first press only asks");
  assert.equal((await outbox()).filter((m) => m.to === "buyer@example.com").length, 1, "nothing is sent by the first press");
  await click(send);
  await page.waitFor(`/Sent .Your Frills Plus subscription is active. to buyer@example\.com/.test(document.getElementById("p-status").textContent)`);
  assert.equal((await outbox()).filter((m) => m.to === "buyer@example.com").length, 2);

  // with the box unticked, activating sends nothing
  await page.evaluate(`(() => { document.getElementById("mp-notify").checked = false; document.getElementById("mp-email").value = "quiet@example.com"; document.getElementById("mp-form").requestSubmit(); })()`);
  await page.waitFor(`/Frills Plus is now active for quiet@example\.com/.test(document.getElementById("p-status").textContent)`);
  assert.equal((await outbox()).some((m) => m.to === "quiet@example.com"), false);
  assert.doesNotMatch(await $text("#p-status"), /emailed/);
  await click("#tab-overview");
});

test("logging out forgets the password, and a reload asks again", { skip }, async () => {
  await click("#logout");
  assert.equal(await visible("#login"), true);
  assert.equal(await visible("#dash"), false);
  await page.goto(base + "/admin/", { settle: 500 });
  assert.equal(await visible("#login"), true, "nothing was remembered");
});
