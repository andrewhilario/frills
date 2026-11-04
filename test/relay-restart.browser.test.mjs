// The Restart button on the relay's status page in a real headless Chrome: it is there only once the owner's password was accepted, it asks first, it restarts the
// relay (a pretend restart here), and on a relay that nothing would start again it is switched off and says why. Skipped on a computer with no Chrome or Edge.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createHelper } from "../helper/server.mjs";

let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

const KEY = "a-long-owner-password";
const helpers = [];
let page;
before(async () => {
  if (skip) return;
  page = await launch();
  await page.viewport(900, 900);
  // as if the visit came through the tunnel (not from the device itself): that is when the page offers the password box
  await page.send("Network.enable");
  await page.send("Network.setExtraHTTPHeaders", { headers: { "cf-connecting-ip": "203.0.113.7" } });
});
after(async () => {
  await page?.close();
  for (const h of helpers) await h.close();
});

class FakeConnection extends EventEmitter {
  async connect() {}
  disconnect() { this.emit("disconnected"); }
}
async function start({ restart }) {
  const calls = { restart: 0 };
  const helper = createHelper({
    relay: { origins: ["https://frills.example"], slots: 2, maxPerIp: 20, trustProxy: false, ownerKey: KEY, restart: restart ? () => { calls.restart++; } : null, minUptimeMs: 0 },
    factory: async () => new FakeConnection(),
  });
  helpers.push(helper);
  return { base: `http://127.0.0.1:${await helper.listen(0)}`, calls };
}
const signIn = async (base) => {
  await page.goto(`${base}/health`, { settle: 300 });
  await page.evaluate("sessionStorage.clear()");
  await page.goto(`${base}/health`, { settle: 300 });
  await page.waitFor(`!document.getElementById("own").hidden`);
  assert.equal(await page.evaluate(`document.getElementById("ctl").hidden`), true, "no Restart card before the password");
  await page.evaluate(`(() => { document.getElementById("ownkey").value = ${JSON.stringify(KEY)}; document.getElementById("ownsave").click(); })()`);
  await page.waitFor(`!document.getElementById("ctl").hidden`);
};

test("status page: after the owner's password the Restart card appears, asks first, and restarts the relay", { skip }, async () => {
  const { base, calls } = await start({ restart: true });
  await signIn(base);
  assert.equal(await page.evaluate(`document.getElementById("restart").disabled`), false);
  await page.evaluate(`window.confirm = () => false; document.getElementById("restart").click()`);
  await sleep(500);
  assert.equal(calls.restart, 0, "saying no to the question restarts nothing");
  await page.evaluate(`window.confirm = () => true; document.getElementById("restart").click()`);
  await page.waitFor(`document.getElementById("ctlmsg").textContent.startsWith("Restarting")`);
  for (let i = 0; i < 30 && calls.restart === 0; i++) await sleep(100);
  assert.equal(calls.restart, 1);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("status page: on a relay that nothing would start again the button is off and says why", { skip }, async () => {
  const { base, calls } = await start({ restart: false });
  await signIn(base);
  assert.equal(await page.evaluate(`document.getElementById("restart").disabled`), true);
  assert.match(await page.evaluate(`document.getElementById("ctlmsg").textContent`), /cannot restart itself/);
  assert.equal(calls.restart, 0);
});
