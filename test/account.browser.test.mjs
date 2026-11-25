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
  server = spawn(process.execPath, ["scripts/serve.mjs", String(port)], { cwd: root, stdio: "ignore", env: { ...process.env, DIST_DIR: variant, FEEDBACK_DB: join(folder, "db.sqlite"), LEMON_CHECKOUT_URL: `${served}/pretend-checkout/`, LEMON_PORTAL_URL: `${served}/pretend-billing/`, LEMON_WEBHOOK_SECRET: SECRET } });
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
  const offDir = join(folder, "dist-off");
  execFileSync(process.execPath, ["build.mjs"], { cwd: root, stdio: "ignore", env: { ...process.env, PLUS_ACCOUNTS: "", OUT_DIR: offDir } });
  assert.equal(existsSync(join(offDir, "account")), false, "a build with PLUS_ACCOUNTS off has no account pages");
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

// ── the My Plus card and the account card ─────────────────────────────────────────────────────────────

const inPage = (action, body = {}) => page.evaluate(`fetch("/api/account/${action}", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(${JSON.stringify(body)}) }).then((r) => r.json().then((j) => [r.status, j]))`);
/** Signs the browser in as this email (through the page's own address, so the cookie is the page's) and returns the account id. */
async function signInAs(email) {
  await page.goto(`${served}/account/`, { settle: 400 });
  const asked = (await outbox()).length;
  await inPage("login", { email });
  await inPage("verify", { token: /#([A-Za-z0-9_-]{43})/.exec((await outbox())[asked].text)[1] });
  const [, checkout] = await inPage("checkout");
  return new URL(checkout.url).searchParams.get("checkout[custom][account_id]");
}
const signedInView = () => page.waitFor(`getComputedStyle(document.getElementById("acct-in")).display !== "none"`, { timeout: 8000 });
const formView = () => page.waitFor(`getComputedStyle(document.getElementById("acct-form")).display !== "none"`, { timeout: 8000 });
const visible = (id) => page.evaluate(`getComputedStyle(document.getElementById(${JSON.stringify(id)})).display !== "none"`);

test("the Frills Plus card shows the status badge, the credits and Manage or cancel (which opens the billing page), and the intro words go once signed in", { skip }, async () => {
  const id = await signInAs("card@example.com");
  await page.goto(`${served}/account/`, { settle: 400 });
  await signedInView();
  assert.equal(await visible("acct-lede"), false, "the 'no account needed' intro is for people who are signed out");
  assert.equal(await visible("acct-badge"), false, "nothing bought: no badge");
  assert.equal(await visible("acct-credits"), false);
  assert.equal(await visible("acct-manage"), false, "nothing to manage yet");
  assert.equal(await visible("acct-buy"), true);

  await notice({ name: "subscription_created", account: id, subscription: "7001", order: "8001" });
  await page.goto(`${served}/account/`, { settle: 400 });
  await signedInView();
  assert.deepEqual([await text("#acct-badge"), await page.evaluate(`document.getElementById("acct-badge").dataset.tone`)], ["On", "on"]);
  assert.match(await text("#acct-credits-text"), /AI voice used this month: 0 of 150,000 characters/);
  assert.equal(await page.evaluate(`document.getElementById("acct-meter").getAttribute("aria-valuemax")`), "150000");
  assert.equal(await visible("acct-manage"), true);
  assert.equal(await visible("acct-buy"), false);
  assert.match(await text("#acct-manage-hint"), /change your card, see your receipts and cancel/);
  await page.evaluate(`document.getElementById("acct-manage").click()`);
  await page.waitFor(`location.pathname === "/pretend-billing/"`, { timeout: 8000 });

  await notice({ name: "subscription_cancelled", account: id, subscription: "7001", status: "cancelled", endsInDays: 12, at: Date.now() + 1000 });
  await page.goto(`${served}/account/`, { settle: 400 });
  await signedInView();
  assert.match(await text("#acct-badge"), /^Ends /);
  assert.equal(await page.evaluate(`document.getElementById("acct-badge").dataset.tone`), "soon");
  await notice({ name: "subscription_expired", account: id, subscription: "7001", status: "expired", endsInDays: 0, at: Date.now() + 2000 });
  await page.goto(`${served}/account/`, { settle: 400 });
  await signedInView();
  assert.deepEqual([await text("#acct-badge"), await visible("acct-credits"), await visible("acct-manage")], ["Off", false, true], "ended: off, no credits, but the billing page (receipts) is still reachable");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

const stored = (key) => page.evaluate(`localStorage.getItem(${JSON.stringify(key)})`);
const setupCount = () => text("#acct-setup-count");
const setupButtons = () => page.evaluate(`[...document.querySelectorAll("#acct-setup-list button")].map((b) => [b.textContent.trim(), b.disabled])`);

test("the set-up checklist: hidden until Plus is on, then walks through the code and the re-paste, remembers the tick, can be hidden, and is forgotten on sign out", { skip }, async () => {
  const id = await signInAs("setup@example.com");
  await page.goto(`${served}/account/`, { settle: 400 });
  await signedInView();
  assert.equal(await visible("acct-setup"), false, "nothing bought: no checklist");

  await notice({ name: "subscription_created", account: id, subscription: "9101", order: "9201" });
  await page.goto(`${served}/account/`, { settle: 500 });
  await signedInView();
  assert.equal(await visible("acct-setup"), true);
  assert.equal(await setupCount(), "1 / 3");
  assert.deepEqual(await setupButtons(), [["Activate on this browser", false], ["I pasted them", true]], "re-pasting cannot be ticked before the code is on this browser");

  await page.evaluate(`document.querySelector("#acct-setup-list button").click()`);
  await page.waitFor(`document.getElementById("acct-setup-count").textContent === "2 / 3"`, { timeout: 8000 });
  assert.match(await stored("frills:plus:code"), /^[0-9a-f]{32}$/, "the code is kept on this browser");
  assert.deepEqual((await setupButtons())[0], ["I pasted them", false]);

  await page.evaluate(`[...document.querySelectorAll("#acct-setup-list button")].find((b) => b.textContent === "I pasted them").click()`);
  assert.equal(await setupCount(), "All set");
  assert.equal(await page.evaluate(`document.getElementById("acct-setup-count").dataset.tone`), "on");
  assert.equal(await stored("frills:plus:setup:pasted"), "1");
  await page.goto(`${served}/account/`, { settle: 500 });
  await signedInView();
  assert.equal(await setupCount(), "All set", "the tick survives a reload");

  await page.evaluate(`document.getElementById("acct-setup-hide").click()`);
  assert.equal(await visible("acct-setup"), false);
  await page.goto(`${served}/account/`, { settle: 500 });
  await signedInView();
  assert.equal(await visible("acct-setup"), false, "hidden stays hidden");

  await page.evaluate(`document.getElementById("acct-out").click()`);
  await formView();
  assert.deepEqual([await stored("frills:plus:setup:pasted"), await stored("frills:plus:setup:hidden"), await stored("frills:plus:code")], [null, null, null], "signing out forgets all of it");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("coming back from paying: a new subscriber gets the Plus code without pressing anything, and the checklist is on screen", { skip }, async () => {
  const id = await signInAs("fresh@example.com");
  await page.evaluate(`localStorage.clear()`);
  await page.goto(`${served}/account/?welcome=1`, { settle: 500 });
  await signedInView();
  assert.equal(await visible("acct-setup"), false, "before the payment notice there is nothing to set up");
  await notice({ name: "subscription_created", account: id, subscription: "9102", order: "9202" });
  await page.waitFor(`document.getElementById("acct-setup-count").textContent === "2 / 3"`, { timeout: 15000 });
  assert.match(await text("#acct-buy-status"), /Follow the steps below/);
  assert.match(await stored("frills:plus:code"), /^[0-9a-f]{32}$/);
  assert.deepEqual((await setupButtons())[0], ["I pasted them", false], "only the re-paste is left");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("Plus prompts are counted anonymously: seen once for each moment in a tab, clicked when taken, and nothing at all for Do Not Track", { skip }, async () => {
  const beacons = () => page.evaluate(`window.__beacons.map((b) => b.body)`);
  // One pretend beacon for the whole test; Do Not Track is switched on by a note in localStorage (the script cannot be swapped part-way: Chrome forgets it after a link is followed)
  const installed = (await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    window.__beacons = [];
    navigator.sendBeacon = (url, body) => { window.__beacons.push({ url, body: String(body) }); return true; };
    try { if (localStorage.getItem("__dnt") === "1") Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true }); } catch {}
  })()` })).identifier;
  const prompt = (moment, step) => JSON.stringify({ e: "plus_prompt", a: moment, b: step });
  await page.goto(`${served}/timer/`, { settle: 200 });
  await page.evaluate(`fetch("/api/account/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })`); // (a Plus account sees the full cloud bar, not the offer)
  await page.evaluate("sessionStorage.clear(); localStorage.clear()");
  try {
    // the tip under an editor, for a visitor who could buy Plus: seen once, and not again after a reload in the same tab
    await page.goto(`${served}/timer/`, { settle: 800 });
    await page.waitFor(`Boolean(document.querySelector(".cloud-tip"))`, { timeout: 8000 });
    assert.equal((await beacons()).filter((b) => b === prompt("editor_tip", "shown")).length, 1);
    await page.goto(`${served}/timer/`, { settle: 800 });
    await page.waitFor(`Boolean(document.querySelector(".cloud-tip"))`, { timeout: 8000 });
    assert.equal((await beacons()).filter((b) => b === prompt("editor_tip", "shown")).length, 0, "a reload in the same tab is not a new person seeing it");
    assert.deepEqual(await page.evaluate(`(() => { document.querySelector(".cloud-tip a").click(); return window.__beacons.map((b) => b.body).filter((b) => b.includes("clicked")); })()`), [prompt("editor_tip", "clicked")]);

    // the free-actions limit: seen when the 10th action is added, clicked on the Plus link in the note
    await page.goto(`${served}/actions/`, { settle: 800 });
    await page.waitFor(`Boolean(document.getElementById("act-add-blank"))`, { timeout: 8000 });
    for (let i = 0; i < 10; i++) await page.evaluate(`(() => { const b = document.getElementById("act-add-blank"); if (!b.disabled) b.click(); })()`);
    await page.waitFor(`document.getElementById("act-count").textContent.startsWith("10 / 10")`, { timeout: 8000 });
    assert.equal(await page.evaluate(`document.getElementById("act-limit-note").hidden`), false);
    assert.equal((await beacons()).filter((b) => b === prompt("action_limit", "shown")).length, 1, "redrawing the note does not count again");
    assert.deepEqual(await page.evaluate(`(() => { document.querySelector('#act-limit-note a[href="/plus/"]').click(); return window.__beacons.map((b) => b.body).filter((b) => b.includes("action_limit") && b.includes("clicked")); })()`), [prompt("action_limit", "clicked")]);

    // the checkout button: counted as the click happens, before the page leaves for the payment page
    await signInAs("prompt@example.com");
    await page.goto(`${served}/account/`, { settle: 500 });
    await signedInView();
    assert.deepEqual(await page.evaluate(`(() => { document.getElementById("acct-buy").click(); return window.__beacons.map((b) => b.body).filter((b) => b.includes("checkout")); })()`), [prompt("checkout", "clicked")]);

    // Do Not Track: the prompt is still shown, nothing is sent
    await page.evaluate('sessionStorage.clear(); localStorage.setItem("__dnt", "1")');
    await page.goto(`${served}/timer/`, { settle: 800 });
    await page.waitFor(`Boolean(document.querySelector(".cloud-tip"))`, { timeout: 8000 });
    assert.deepEqual(await beacons(), [], "Do Not Track: nothing is counted");
  } finally {
    await page.evaluate('localStorage.removeItem("__dnt")').catch(() => {});
    await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: installed }).catch(() => {}); // (so a failed check above is what gets reported)
  }
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("sign out everywhere ends this browser's session and says so", { skip }, async () => {
  await signInAs("everywhere@example.com");
  await page.goto(`${served}/account/`, { settle: 400 });
  await signedInView();
  await page.evaluate(`document.getElementById("acct-out-all").click()`);
  await formView();
  assert.match(await text("#acct-status"), /signed out on every device/);
  assert.equal((await (await page.evaluate(`fetch("/api/account/me").then((r) => r.json())`))).signedIn, false);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("deleting an account: the typed email must be the person's own, a renewing subscription must be cancelled first, and then everything is deleted", { skip }, async () => {
  const id = await signInAs("leaving@example.com");
  await notice({ name: "subscription_created", account: id, subscription: "7002", order: "8002" });
  await page.goto(`${served}/account/`, { settle: 400 });
  await signedInView();
  const open = () => page.evaluate(`document.getElementById("acct-delete").open = true`);
  const type = (value) => page.evaluate(`(() => { const i = document.getElementById("acct-delete-email"); i.value = ${JSON.stringify(value)}; })()`);
  const press = async () => { await page.evaluate(`document.getElementById("acct-delete-go").click()`); await sleep(500); };

  await open();
  await press();
  assert.match(await text("#acct-delete-status"), /not the email of this account/, "nothing typed");
  await type("someone.else@example.com");
  await press();
  assert.match(await text("#acct-delete-status"), /not the email of this account/, "somebody else's email");
  await type("leaving@example.com");
  await press();
  assert.match(await text("#acct-delete-status"), /still renewing/, "a renewing subscription is not deleted away");
  assert.equal((await page.evaluate(`fetch("/api/account/me").then((r) => r.json())`)).signedIn, true, "still signed in, nothing deleted");

  await notice({ name: "subscription_cancelled", account: id, subscription: "7002", status: "cancelled", endsInDays: 5, at: Date.now() + 1000 });
  await press();
  await formView();
  assert.match(await text("#acct-status"), /account and its data were deleted/);
  assert.equal((await page.evaluate(`fetch("/api/account/me").then((r) => r.json())`)).signedIn, false);
  assert.equal(await visible("acct-in"), false);
  // the browser logs the two refusals above (400 for a wrong email, 409 for a renewing subscription) as it should; nothing else may be logged
  const unexpected = page.problems.filter((p) => !/status of (400|409) .*\/api\/account\/delete/.test(p));
  assert.deepEqual(unexpected, [], unexpected.join(" | "));
});
