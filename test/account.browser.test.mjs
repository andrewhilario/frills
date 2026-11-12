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

const root = join(import.meta.dirname, "..");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

const folder = mkdtempSync(join(tmpdir(), "frills-account-"));
const variant = join(folder, "dist-on");
const port = 6200 + Math.floor(Math.random() * 300);
const served = `http://localhost:${port}`;
let server;
let page;

before(async () => {
  if (skip) return;
  execFileSync(process.execPath, ["build.mjs"], { cwd: root, stdio: "ignore", env: { ...process.env, PLUS_ACCOUNTS: "1", OUT_DIR: variant } });
  server = spawn(process.execPath, ["scripts/serve.mjs", String(port)], { cwd: root, stdio: "ignore", env: { ...process.env, DIST_DIR: variant, FEEDBACK_DB: join(folder, "db.sqlite") } });
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
const shown = (id) => page.evaluate(`!document.getElementById(${JSON.stringify(id)}).hidden`);
const outbox = async () => (await fetch(`${served}/api/dev/outbox`)).json();
const typeEmail = (value) => page.evaluate(`(() => { const i = document.getElementById("acct-email"); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);

test("the page asks for an email, says to check the inbox, and the emailed link signs in, stays signed in after a reload, and signs out", { skip }, async () => {
  await page.goto(`${served}/account/`, { settle: 500 });
  await page.waitFor(`!document.getElementById("acct-form").hidden`, { timeout: 5000 });
  assert.equal(await shown("acct-in"), false);

  await typeEmail("not an email");
  await page.evaluate(`document.getElementById("acct-send").click()`);
  assert.match(await text("#acct-status"), /does not look like an email/);
  assert.equal((await outbox()).length, 0, "nothing sent for a bad address");

  await typeEmail("Streamer@Example.com");
  await page.evaluate(`document.getElementById("acct-send").click()`);
  await page.waitFor(`!document.getElementById("acct-sent").hidden`, { timeout: 5000 });
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
  await page.waitFor(`location.pathname === "/account/" && !document.getElementById("acct-in").hidden`, { timeout: 8000 });
  assert.equal(await text("#acct-who"), "streamer@example.com");

  await page.goto(`${served}/account/`, { settle: 500 });
  await page.waitFor(`!document.getElementById("acct-in").hidden`, { timeout: 5000 });
  assert.equal(await text("#acct-who"), "streamer@example.com", "still signed in after a reload");
  assert.equal(await page.evaluate(`document.cookie.includes("frills_session")`), false, "the cookie cannot be read by the page's script");

  await page.evaluate(`document.getElementById("acct-out").click()`);
  await page.waitFor(`!document.getElementById("acct-form").hidden`, { timeout: 5000 });
  await page.goto(`${served}/account/`, { settle: 500 });
  await page.waitFor(`!document.getElementById("acct-form").hidden`, { timeout: 5000 });
  assert.equal(await shown("acct-in"), false, "signed out stays signed out");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("a link that was already used, or is damaged, or is missing, says so and offers a new one", { skip }, async () => {
  const before = (await outbox()).length;
  await page.goto(`${served}/account/`, { settle: 500 });
  await page.waitFor(`!document.getElementById("acct-form").hidden`, { timeout: 5000 });
  await typeEmail("second@example.com");
  await page.evaluate(`document.getElementById("acct-send").click()`);
  await page.waitFor(`!document.getElementById("acct-sent").hidden`, { timeout: 5000 });
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
