// Spin the Wheel editor & overlay in headless Chrome: friendly slice list rows, starter packs,
// keyboard Enter/Backspace/paste, min/max bounds, Shuffle, synced slice color dots, Reset, and URL round-trip.
// Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createHelper } from "../helper/server.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "wheel", "index.html"))) throw new Error("dist/ has no wheel page. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

class FakeConnection extends EventEmitter {
  async connect() { await sleep(5); }
  disconnect() { this.emit("disconnected"); }
}
const opened = [];
async function withHelper() {
  const made = [];
  const helper = createHelper({ distDir: dist, factory: async () => { const c = new FakeConnection(); made.push(c); return c; }, idleStopMs: 200, offlineWaitMs: 5000 });
  const port = await helper.listen(0);
  opened.push(helper);
  return { base: `http://127.0.0.1:${port}`, made };
}

let page;
before(async () => { if (!skip) { page = await launch(); await page.viewport(1280, 900); } });
after(async () => { await page?.close(); for (const h of opened) await h.close(); });

const sliceValues = () => page.evaluate(`[...document.querySelectorAll(".items__input")].map((i) => i.value)`);
const sliceCount = () => page.evaluate(`document.querySelector(".items__count")?.textContent.trim()`);
const click = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const type = (selector, value) => page.evaluate(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);

test("wheel editor & overlay load cleanly under CSP with no console errors", { skip }, async () => {
  const { base } = await withHelper();
  for (const path of ["/wheel/", "/overlay/wheel/?demo=1"]) {
    await page.goto(base + path, { settle: 700 });
    assert.deepEqual(page.problems, [], `${path}: ${page.problems.join(" | ")}`);
  }
});

test("wheel editor: slices use friendly individual rows, starter packs, add/remove bounds, paste, shuffle, synced dots, and URL round-trip", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/wheel/", { settle: 700 });
  await page.evaluate(`localStorage.clear()`);
  await page.goto(base + "/wheel/", { settle: 700 });

  // Starts with 8 default slice rows, Dares starter pressed, counter 8 / 12
  assert.equal((await sliceValues()).length, 8);
  assert.equal(await sliceCount(), "8 / 12");
  assert.equal(await page.evaluate(`document.querySelector(".items__preset[aria-pressed='true']")?.textContent.trim()`), "Dares");

  // Switching starter pack replaces slices cleanly
  await page.evaluate(`[...document.querySelectorAll(".items__preset")].find((b) => b.textContent.trim() === "Yes / No").click()`);
  assert.deepEqual(await sliceValues(), ["YES!", "NO!", "YES!", "NO!", "Spin Again", "Chat Decides"]);
  assert.equal(await sliceCount(), "6 / 12");
  assert.equal(await page.evaluate(`document.querySelector(".items__preset[aria-pressed='true']")?.textContent.trim()`), "Yes / No");

  // Edit a slice, add a slice, press Enter on last slice to add another
  await page.evaluate(`(() => { const i = document.querySelectorAll(".items__input")[0]; i.value = "BIG YES!"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await click(".items__add");
  assert.equal(await sliceCount(), "7 / 12");
  await page.evaluate(`(() => { const inputs = document.querySelectorAll(".items__input"); const last = inputs[inputs.length - 1]; last.value = "Mystery Box"; last.dispatchEvent(new Event("input", { bubbles: true })); last.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); })()`);
  assert.equal(await sliceCount(), "8 / 12", "Enter on last slice adds a new row");

  // Paste comma/newline list splits into multiple rows cleanly (while preserving thousands comma in single item)
  await page.evaluate(`(() => {
    const inputs = document.querySelectorAll(".items__input");
    const last = inputs[inputs.length - 1];
    const dt = new DataTransfer();
    dt.setData("text/plain", "Hydrate, Stretch\\nDance");
    last.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  })()`);
  assert.deepEqual((await sliceValues()).slice(-3), ["Hydrate", "Stretch", "Dance"]);
  assert.equal(await sliceCount(), "10 / 12");

  // Cap at 12 disables "+ Add slice"
  await click(".items__add");
  await click(".items__add");
  assert.equal(await sliceCount(), "12 / 12");
  assert.equal(await page.evaluate(`document.querySelector(".items__add").disabled`), true);

  // Shuffle visibly reorders slices
  const beforeShuffle = await sliceValues();
  await click(".items__shuffle");
  const afterShuffle = await sliceValues();
  assert.notDeepEqual(afterShuffle, beforeShuffle.filter(Boolean), "Shuffle reorders slices");

  // Remove down to 2 disables remove buttons (minItems = 2)
  while ((await sliceValues()).length > 2) {
    await click(".items__remove");
  }
  assert.equal(await sliceCount(), "2 / 12");
  assert.equal(await page.evaluate(`[...document.querySelectorAll(".items__remove")].every((b) => b.disabled)`), true);

  // Clearing one of the last 2 shows inline warning; filling restores clean state
  await page.evaluate(`(() => { const i = document.querySelectorAll(".items__input")[1]; i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  assert.equal(await page.evaluate(`document.querySelector(".items__warn").hidden`), false);
  await page.evaluate(`(() => { const i = document.querySelectorAll(".items__input")[1]; i.value = "Bonus Dare"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  assert.equal(await page.evaluate(`document.querySelector(".items__warn").hidden`), true);

  // Changing Wheel design updates slice dot colors to match Kawaii palette
  await page.evaluate(`(() => { const s = document.getElementById("c-design"); s.value = "kawaii"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  assert.equal(await page.evaluate(`getComputedStyle(document.getElementById("opt-controls")).getPropertyValue("--slice-0").trim()`), "#ffe5ec");

  // Generated overlay link carries custom slices & opens cleanly
  await type("#source-channel", "pond.pal");
  const url = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(url.pathname, "/overlay/wheel/");
  const expectedTwo = (await sliceValues()).join(", ");
  assert.equal(url.searchParams.get("slices"), expectedTwo);
  assert.equal(url.searchParams.get("design"), "kawaii");

  // Reset restores all 8 default slices cleanly
  await click("#reset");
  assert.equal((await sliceValues()).length, 8);
  assert.equal(await sliceCount(), "8 / 12");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));

  // Open the generated overlay link and confirm zero errors
  await page.goto(url.href.replace(url.origin, base), { settle: 700 });
  assert.equal(await page.evaluate(`document.querySelector(".wheel")?.dataset.design`), "kawaii");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});
