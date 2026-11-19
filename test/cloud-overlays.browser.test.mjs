// Real headless-Chrome end-to-end test for Live-Updating Cloud Overlays (/o/<id>):
//   1. Free signed-out visitor on /editor/ sees NO cloud-save box (zero clutter for free users).
//   2. Signed-in Frills Plus user creates a live cloud link on /editor/, opens /o/<id> in a separate OBS-style browser
//      (zero login cookies), changes the look in /editor/ and clicks Save live update, and verifies the open
//      /o/<id> tab automatically reloads its iframe to v2 with the updated look within ~4 seconds!
//   3. /account/ lists the saved overlay with Edit & 2-click Delete.

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { launch, sleep, waitForServer } from "../scripts/lib/chrome.mjs";

const root = join(import.meta.dirname, "..");
const port = 7300 + Math.floor(Math.random() * 400);
const base = `http://localhost:${port}`;

test("Live-updating cloud overlay: hidden for free users, creates /o/<id> for Plus, updates open OBS tab live, and manages on /account/", async () => {
  const server = spawn(process.execPath, ["scripts/serve.mjs", String(port)], {
    cwd: root,
    env: { ...process.env, FEEDBACK_DB: ":memory:" },
    stdio: "ignore",
  });
  let editorPage;
  let obsPage;
  try {
    await waitForServer(`${base}/`);
    editorPage = await launch();

    // 1. Free / signed-out user sees NO .cloud-box in /editor/
    await editorPage.goto(`${base}/editor/`, { settle: 700 });
    assert.equal(await editorPage.evaluate(`Boolean(document.querySelector(".cloud-box"))`), false);

    // 2. Sign in via /account/ magic link and activate dev Plus credits on this local test server
    await editorPage.goto(`${base}/account/`, { settle: 500 });
    await editorPage.evaluate(`(() => {
      const i = document.getElementById("acct-email");
      i.value = "cloudtester@example.com";
      i.dispatchEvent(new Event("input", { bubbles: true }));
      document.getElementById("acct-send").click();
    })()`);
    await sleep(450);
    const outbox = await (await fetch(`${base}/api/dev/outbox`)).json();
    const verifyUrl = /http:\/\/[^\s]+/.exec(outbox.at(-1).text)[0];
    await editorPage.goto(verifyUrl, { settle: 400 });
    await editorPage.evaluate(`document.getElementById("verify-go").click()`);
    await editorPage.waitFor(`location.pathname === "/account/"`);
    const devPassOk = await editorPage.evaluate(`fetch("/api/pro/dev-pass", { method: "POST", credentials: "same-origin" }).then(r => r.ok)`);
    assert.equal(devPassOk, true);

    // 3. Open /editor/ as active Plus user -> Live cloud link box mounts cleanly
    await editorPage.goto(`${base}/editor/?platform=tiktok&channel=frills_demo&look=frost`, { settle: 700 });
    await editorPage.waitFor(`Boolean(document.querySelector(".cloud-box"))`);

    // Create a live cloud overlay named "Main Stream Chat"
    await editorPage.evaluate(`(() => {
      document.getElementById("cloud-name-chat").value = "Main Stream Chat";
      document.querySelector(".cloud-box__save button").click();
    })()`);
    await editorPage.waitFor(`Boolean(document.getElementById("cloud-url-chat")?.value)`);
    const liveUrl = await editorPage.evaluate(`document.getElementById("cloud-url-chat").value`);
    assert.match(liveUrl, new RegExp(`^http://localhost:${port}/o/[A-Za-z0-9_-]{12}$`));

    // 4. Open /o/<id> in a completely separate clean browser (simulating OBS Studio with zero cookies!)
    obsPage = await launch();
    await obsPage.goto(liveUrl, { settle: 600 });
    await obsPage.waitFor(`Boolean(document.querySelector("iframe.cloud-frame")?.getAttribute("src"))`);
    const src1 = await obsPage.evaluate(`document.querySelector("iframe.cloud-frame").getAttribute("src")`);
    assert.match(src1, /^\/overlay\/\?.*channel=frills_demo.*&_cv=1$/);
    assert.match(src1, /accent=%239ee7ff/);

    // 5. Switch look in /editor/ to another preset and hit "Save live update" -> OBS tab auto-updates to v2!
    await editorPage.evaluate(`(() => {
      const chips = [...document.querySelectorAll("#presets button")];
      const pick = chips.find((b) => b.getAttribute("aria-pressed") !== "true");
      pick?.click();
    })()`);
    await sleep(250);
    const dirtyMsg = await editorPage.evaluate(`document.querySelector(".cloud-box__status")?.textContent ?? ""`);
    assert.match(dirtyMsg, /Unsaved changes/);

    await editorPage.evaluate(`document.querySelector(".cloud-box__save button").click()`);
    await editorPage.waitFor(`/Saved \\(v2\\)/.test(document.querySelector(".cloud-box__status")?.textContent ?? "")`);

    // Wait up to 8s for the open OBS tab to poll and swap its iframe to _cv=2 automatically (without touching obsPage!)
    await obsPage.waitFor(`(document.querySelector("iframe.cloud-frame")?.getAttribute("src") ?? "").includes("_cv=2")`, { timeout: 8000 });
    const src2 = await obsPage.evaluate(`document.querySelector("iframe.cloud-frame").getAttribute("src")`);
    assert.match(src2, /_cv=2/);
    assert.notEqual(src2, src1);

    // 6. Verify /account/ lists the overlay and 2-click Delete removes it
    await editorPage.goto(`${base}/account/`, { settle: 600 });
    await editorPage.waitFor(`/Main Stream Chat/.test(document.getElementById("acct-cloud-list")?.textContent ?? "")`);
    const listed = await editorPage.evaluate(`document.getElementById("acct-cloud-list").textContent`);
    assert.match(listed, /v2/);

    // First click arms confirm, second click deletes
    await editorPage.evaluate(`document.querySelector(".acct-cloud__del").click()`);
    assert.equal(await editorPage.evaluate(`document.querySelector(".acct-cloud__del").textContent`), "Confirm delete");
    await editorPage.evaluate(`document.querySelector(".acct-cloud__del").click()`);
    await editorPage.waitFor(`/No live cloud overlays saved yet/.test(document.getElementById("acct-cloud-list")?.textContent ?? "")`);
  } finally {
    await obsPage?.close();
    await editorPage?.close();
    server.kill();
  }
});
