// Signing in to Frills in a real headless Chrome, against the local server (the same Worker code over SQLite, with the local mailer that writes the email down): ask for a link,
// find it in the outbox, open it, press "Sign in", stay signed in after a reload, sign out. Also the dead ends: a used link, a damaged link, and the pages not existing while
// the feature is off. This test builds its own copy of the site with the feature on (PLUS_ACCOUNTS=1), so it does not touch dist/. Skipped with no Chrome or Edge.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome, launch, sleep, waitForServer } from "../scripts/lib/chrome.mjs";
import { signedDelivery } from "../scripts/lib/lemon-fake.mjs";

const root = join(import.meta.dirname, "..");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

const folder = mkdtempSync(join(tmpdir(), "frills-account-"));
const variant = join(folder, "dist-on");
const port = 6200 + Math.floor(Math.random() * 300);
const served = `http://localhost:${port}`;
const SECRET = "whsec-browser-test";
let server;
let page;

before(async () => {
  if (skip) return;
  execFileSync(process.execPath, ["build.mjs"], { cwd: root, stdio: "ignore", env: { ...process.env, PLUS_ACCOUNTS: "1", OUT_DIR: variant } });
  server = spawn(process.execPath, ["scripts/serve.mjs", String(port)], { cwd: root, stdio: "ignore", env: { ...process.env, DIST_DIR: variant, FEEDBACK_DB: join(folder, "db.sqlite"), LEMON_CHECKOUT_URL: `${served}/pretend-checkout/`, LEMON_WEBHOOK_SECRET: SECRET } });
  await waitForServer(served);
  page = await launch();
  await page.viewport(1000, 800);
});
after(async () => {
  await page?.close();
  server?.kill();
  await sleep(300);
  try { rmSync(folder, { recursive: true, force: true }); } catch { /* a temp folder */ }
});

const text = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim() ?? null`);
const shown = (id) => page.evaluate(`getComputedStyle(document.getElementById(${JSON.stringify(id)})).display !== "none"`); // (what is on screen, not only the attribute)
const outbox = async () => (await fetch(`${served}/api/dev/outbox`)).json();
const typeEmail = (value) => page.evaluate(`(() => { const i = document.getElementById("acct-email"); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);

test("the page asks for an email, says to check the inbox, and the emailed link signs in, stays signed in after a reload, and signs out", { skip }, async () => {
  await page.goto(`${served}/account/`, { settle: 500 });
  await page.waitFor(`getComputedStyle(document.getElementById("acct-form")).display !== "none"`, { timeout: 5000 });
  assert.equal(await shown("acct-in"), false);

  await typeEmail("not an email");
  await page.evaluate(`document.getElementById("acct-send").click()`);
  assert.match(await text("#acct-status"), /does not look like an email/);
  assert.equal((await outbox()).length, 0, "nothing sent for a bad address");

  await typeEmail("Streamer@Example.com");
  await page.evaluate(`document.getElementById("acct-send").click()`);
  await page.waitFor(`getComputedStyle(document.getElementById("acct-sent")).display !== "none"`, { timeout: 5000 });
  assert.equal(await text("#acct-sent-to"), "Streamer@Example.com");
  assert.match(await text("#acct-sent"), /look in your spam folder/);
  assert.equal(await page.evaluate(`document.getElementById("acct-again").disabled`), true, "a second request has to wait");

  const mails = await outbox();
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, "streamer@example.com");
  const link = /(http:\/\/localhost:\d+\/account\/verify\/#[A-Za-z0-9_-]{43})/.exec(mails[0].text)[1];

  await page.goto(link, { settle: 500 });
  assert.equal(await page.evaluate(`location.hash`), "", "the token is taken out of the address bar");
  assert.equal(await shown("verify-ready"), true);
  assert.equal((await fetch(`${served}/api/account/me`)).status, 200);
  await page.evaluate(`document.getElementById("verify-go").click()`);
  await page.waitFor(`location.pathname === "/account/" && getComputedStyle(document.getElementById("acct-in")).display !== "none"`, { timeout: 8000 });
  assert.equal(await text("#acct-who"), "streamer@example.com");
  assert.deepEqual(await Promise.all(["acct-loading", "acct-form", "acct-sent", "acct-in"].map(shown)), [false, false, false, true], "only the signed-in view is on screen");

  await page.goto(`${served}/account/`, { settle: 500 });
  await page.waitFor(`getComputedStyle(document.getElementById("acct-in")).display !== "none"`, { timeout: 5000 });
  assert.equal(await text("#acct-who"), "streamer@example.com", "still signed in after a reload");
  assert.equal(await page.evaluate(`document.cookie.includes("frills_session")`), false, "the cookie cannot be read by the page's script");

  await page.evaluate(`document.getElementById("acct-out").click()`);
  await page.waitFor(`getComputedStyle(document.getElementById("acct-form")).display !== "none"`, { timeout: 5000 });
  await page.goto(`${served}/account/`, { settle: 500 });
  await page.waitFor(`getComputedStyle(document.getElementById("acct-form")).display !== "none"`, { timeout: 5000 });
  assert.equal(await shown("acct-in"), false, "signed out stays signed out");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("a link that was already used, or is damaged, or is missing, says so and offers a new one", { skip }, async () => {
  const before = (await outbox()).length;
  await page.goto(`${served}/account/`, { settle: 500 });
  await page.waitFor(`getComputedStyle(document.getElementById("acct-form")).display !== "none"`, { timeout: 5000 });
  await typeEmail("second@example.com");
  await page.evaluate(`document.getElementById("acct-send").click()`);
  await page.waitFor(`getComputedStyle(document.getElementById("acct-sent")).display !== "none"`, { timeout: 5000 });
  const link = /(http:\/\/localhost:\d+\/account\/verify\/#[A-Za-z0-9_-]{43})/.exec((await outbox())[before].text)[1];

  await page.goto(link, { settle: 500 });
  await page.evaluate(`document.getElementById("verify-go").click()`);
  await page.waitFor(`location.pathname === "/account/"`, { timeout: 8000 });

  await page.goto(link, { settle: 500 });
  await page.evaluate(`document.getElementById("verify-go").click()`);
  await page.waitFor(`!document.getElementById("verify-bad").hidden`, { timeout: 5000 });
  assert.match(await text("#verify-bad"), /used already, or it is older than 15 minutes/);
  assert.equal(await page.evaluate(`document.querySelector("#verify-bad a").getAttribute("href")`), "/account/");

  await page.goto(`${served}/account/`, { settle: 300 }); // (a change of only the # would not load the page again)
  await page.goto(`${served}/account/verify/#damaged`, { settle: 500 });
  assert.equal(await shown("verify-ready"), false);
  assert.match(await text("#verify-bad"), /not a sign-in link/);
  await page.goto(`${served}/account/`, { settle: 300 });
  await page.goto(`${served}/account/verify/`, { settle: 500 });
  assert.match(await text("#verify-bad"), /not a sign-in link/);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("the account pages carry noindex, and a site built with the feature off has no account pages at all", { skip }, async () => {
  const html = await (await fetch(`${served}/account/`)).text();
  assert.match(html, /<meta name="robots" content="noindex/);
  const sitemap = await (await fetch(`${served}/sitemap.xml`)).text();
  assert.equal(sitemap.includes("/account"), false, "not listed for search engines");
  const off = join(root, "dist", "account");
  assert.equal(existsSync(off), false, "the normal build (feature off) has no account pages");
});

test("a signed-in person sees the Frills Plus panel, and Get Frills Plus opens the checkout with their email and account id", { skip }, async () => {
  await page.goto(`${served}/account/`, { settle: 500 });
  await page.waitFor(`!document.getElementById("acct-form").hidden || !document.getElementById("acct-in").hidden`, { timeout: 5000 });
  const before = (await outbox()).length;
  const post = (action, body) => page.evaluate(`fetch("/api/account/${action}", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(${JSON.stringify(body)}) }).then((r) => r.status)`);
  assert.equal(await post("login", { email: "buyer@example.com" }), 200);
  const token = /#([A-Za-z0-9_-]{43})/.exec((await outbox())[before].text)[1];
  assert.equal(await post("verify", { token }), 200);
  await page.goto(`${served}/account/`, { settle: 500 });
  await page.waitFor(`getComputedStyle(document.getElementById("acct-in")).display !== "none"`, { timeout: 5000 });
  assert.equal(await text("#acct-who"), "buyer@example.com");
  assert.match(await text("#acct-plus-state"), /do not have Frills Plus/);
  assert.equal(await shown("acct-buy-hint"), true);
  assert.match(await text("#acct-buy-hint"), /Frills never sees your card/);
  assert.equal(await page.evaluate(`getComputedStyle(document.getElementById("acct-buy")).display !== "none"`), true, "the button shows");

  await page.evaluate(`document.getElementById("acct-buy").click()`);
  await page.waitFor(`location.pathname === "/pretend-checkout/"`, { timeout: 8000 });
  const url = new URL(await page.evaluate("location.href"));
  assert.equal(url.searchParams.get("checkout[email]"), "buyer@example.com");
  assert.match(url.searchParams.get("checkout[custom][account_id]"), /^[0-9a-f]{16}$/);
});

/** A made-up, signed notice from Lemon Squeezy to the local server. */
async function notice(options) {
  const { headers, body } = signedDelivery({ ...options }, SECRET);
  const res = await fetch(`${served}/api/webhooks/lemonsqueezy`, { method: "POST", headers, body });
  assert.equal(res.status, 200, await res.clone().text());
  return res.json();
}
const state = () => text("#acct-plus-state");
const buyVisible = () => page.evaluate(`getComputedStyle(document.getElementById("acct-buy")).display !== "none"`);

test("paying: the page waits for the payment notice and switches Plus on by itself, and cancelling, ending and a refund each show the right words and offer the right button", { skip }, async () => {
  // 1. sign in and open the checkout to learn the account id
  await page.goto(`${served}/account/`, { settle: 500 });
  await page.waitFor(`getComputedStyle(document.getElementById("acct-form")).display !== "none" || getComputedStyle(document.getElementById("acct-in")).display !== "none"`, { timeout: 5000 });
  const asked = (await outbox()).length;
  const post = (action, body) => page.evaluate(`fetch("/api/account/${action}", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(${JSON.stringify(body)}) }).then((r) => r.status)`);
  await post("login", { email: "payer@example.com" });
  await post("verify", { token: /#([A-Za-z0-9_-]{43})/.exec((await outbox())[asked].text)[1] });
  const checkout = await page.evaluate(`fetch("/api/account/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.json())`);
  const accountId = new URL(checkout.url).searchParams.get("checkout[custom][account_id]");
  assert.match(accountId, /^[0-9a-f]{16}$/);

  // 2. back from the checkout before the notice has arrived: the page says it is confirming, then switches on by itself
  await page.goto(`${served}/account/?welcome=1`, { settle: 500 });
  await page.waitFor(`getComputedStyle(document.getElementById("acct-in")).display !== "none"`, { timeout: 5000 });
  assert.match(await state(), /do not have Frills Plus/);
  assert.match(await text("#acct-buy-status"), /Confirming your payment/);
  await notice({ name: "subscription_created", account: accountId, subscription: "5001", order: "6001" });
  await page.waitFor(`document.getElementById("acct-buy-status").textContent.includes("payment is confirmed")`, { timeout: 15000 });
  assert.match(await state(), /Frills Plus is on for this account. It renews around/);
  assert.equal(await buyVisible(), false, "no Buy button while Plus is on");

  // 3. cancelled: still on, until the end date, no new purchase offered
  await notice({ name: "subscription_cancelled", account: accountId, subscription: "5001", status: "cancelled", endsInDays: 10, at: Date.now() + 1000 });
  await page.goto(`${served}/account/`, { settle: 500 });
  await page.waitFor(`getComputedStyle(document.getElementById("acct-in")).display !== "none"`, { timeout: 5000 });
  assert.match(await state(), /Frills Plus is on until .* It will not renew./);
  assert.equal(await buyVisible(), false);

  // 4. ended: off, and a new purchase is offered
  await notice({ name: "subscription_expired", account: accountId, subscription: "5001", status: "expired", endsInDays: 0, at: Date.now() + 2000 });
  await page.goto(`${served}/account/`, { settle: 500 });
  await page.waitFor(`getComputedStyle(document.getElementById("acct-in")).display !== "none"`, { timeout: 5000 });
  assert.match(await state(), /Your Frills Plus has ended/);
  assert.equal(await buyVisible(), true, "after it ends, buying again is offered");

  // 5. bought again, then refunded in full: off, and buying again is offered
  await notice({ name: "subscription_created", account: accountId, subscription: "5002", order: "6002", at: Date.now() + 3000 });
  await notice({ name: "order_refunded", order: "6002", orderStatus: "refunded", at: Date.now() + 4000 });
  await page.goto(`${served}/account/`, { settle: 500 });
  await page.waitFor(`getComputedStyle(document.getElementById("acct-in")).display !== "none"`, { timeout: 5000 });
  assert.match(await state(), /was refunded and is off/);
  assert.equal(await buyVisible(), true);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("the checkout is not offered a second time while Plus is on (the server refuses it too)", { skip }, async () => {
  const sessionState = await page.evaluate(`fetch("/api/account/me").then((r) => r.json())`);
  assert.equal(sessionState.signedIn, true);
  const accountId = new URL((await page.evaluate(`fetch("/api/account/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.json())`)).url).searchParams.get("checkout[custom][account_id]");
  await notice({ name: "subscription_created", account: accountId, subscription: "5003", order: "6003", at: Date.now() + 5000 });
  const second = await page.evaluate(`fetch("/api/account/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => [r.status, r.headers.get("content-type")])`);
  assert.equal(second[0], 409);
});
