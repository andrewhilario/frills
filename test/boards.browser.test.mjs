// The rotating Top Gifters and Likers overlay and its editor in a real headless Chrome: the gifters and the likers take turns, one switched off is shown
// alone, and the editor's test buttons move the rankings. Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createStatic } from "../scripts/lib/static.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "overlay", "leaderboard", "index.html"))) throw new Error("dist/ has no leaderboard overlay. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

let server;
let base;
let page;
before(async () => {
  if (skip) return;
  server = http.createServer(createStatic(dist));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  page = await launch();
  await page.viewport(900, 600);
});
after(async () => {
  await page?.close();
  server?.closeAllConnections?.();
  server?.close();
});

const text = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
const rows = (selector = ".liker") => page.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].map((r) => r.querySelector(".liker__name")?.textContent)`);

test("leaderboard overlay: the top gifters show first, then the top likers take their place after the seconds asked for, and back", { skip }, async () => {
  await page.goto(`${base}/overlay/leaderboard/?demo=1&pace=300&seconds=5`, { settle: 600 });
  await page.waitFor(`document.querySelector(".likers__title")?.textContent === "Top gifters" && document.querySelectorAll(".liker").length >= 2`, { timeout: 6000 });
  assert.ok((await rows()).length >= 2, "gifters are listed");
  const first = await page.evaluate(`document.querySelector(".liker__count").textContent`);
  assert.match(first, /^[\d,]+$/, "with their diamonds");
  await page.waitFor(`document.querySelector(".likers__title")?.textContent === "Top likers" && document.querySelectorAll(".liker").length >= 2`, { timeout: 9000 });
  assert.equal(await page.evaluate(`document.querySelector(".boards").classList.contains("boards--out")`), false, "the change has finished");
  await page.waitFor(`document.querySelector(".likers__title")?.textContent === "Top gifters"`, { timeout: 9000 });
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("leaderboard overlay: with the likers switched off it shows only the gifters, all the time, and never changes", { skip }, async () => {
  await page.goto(`${base}/overlay/leaderboard/?demo=1&pace=300&seconds=5&likers=0`, { settle: 600 });
  await page.waitFor(`document.querySelectorAll(".liker").length >= 2`, { timeout: 6000 });
  await sleep(6500); // longer than one turn
  assert.equal(await text(".likers__title"), "Top gifters");
  assert.equal(await page.evaluate(`document.querySelector(".boards").classList.contains("boards--out")`), false);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("leaderboard overlay: the titles, the people shown and the numbers can be changed by the link, and with no account named it says what to add", { skip }, async () => {
  await page.goto(`${base}/overlay/leaderboard/?demo=1&pace=300&likers=0&titleGifters=Big%20spenders&max=3&showCounts=0`, { settle: 600 });
  await page.waitFor(`document.querySelectorAll(".liker").length >= 3`, { timeout: 8000 });
  await sleep(1500);
  assert.equal(await text(".likers__title"), "Big spenders");
  assert.equal(await page.evaluate(`document.querySelectorAll(".liker:not(.liker--out)").length`), 3, "three people at most");
  assert.equal(await page.evaluate(`[...document.querySelectorAll(".liker__count")].every((c) => c.offsetParent === null)`), true, "no numbers");
  await page.goto(`${base}/overlay/leaderboard/`, { settle: 400 });
  assert.match(await text("#note"), /Add \?channel=yourname/);
});

test("leaderboard editor: the controls are there, the test buttons fill the rankings, and the next-ranking button turns to the likers", { skip }, async () => {
  await page.viewport(1280, 900);
  await page.goto(`${base}/leaderboard/`, { settle: 500 });
  await page.evaluate("localStorage.clear()");
  await page.goto(`${base}/leaderboard/`, { settle: 900 });
  const labels = await page.evaluate(`[...document.querySelectorAll(".panel .ctl__label")].map((l) => l.textContent.trim())`);
  for (const wanted of ["Show the top gifters", "Show the top likers", "Seconds each ranking stays", "People shown", "Title for the gifters", "Title for the likers"]) assert.ok(labels.includes(wanted), `${wanted} is missing`);
  await page.evaluate(`document.querySelector('[data-test="gift"]').click()`);
  await page.waitFor(`document.querySelector(".preview .liker")`, { timeout: 5000 });
  assert.equal(await text(".preview .likers__title"), "Top gifters");
  await page.evaluate(`document.querySelector('[data-test="likes"]').click()`);
  await page.evaluate(`document.querySelector('[data-test="next"]').click()`);
  await page.waitFor(`document.querySelector(".preview .likers__title")?.textContent === "Top likers" && document.querySelector(".preview .liker")`, { timeout: 4000 });
  // a typed title shows at once on the ranking that has it
  await page.evaluate(`document.querySelector('[data-test="next"]').click()`);
  await page.waitFor(`document.querySelector(".preview .likers__title")?.textContent === "Top gifters"`, { timeout: 4000 });
  await page.evaluate(`(() => { const i = document.getElementById("c-titleGifters"); i.value = "Big spenders"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await page.waitFor(`document.querySelector(".preview .likers__title")?.textContent === "Big spenders"`, { timeout: 4000 });
  // the link carries what was changed and the account
  await page.evaluate(`(() => { const i = document.getElementById("source-channel"); i.value = "pond.pal"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await page.waitFor('document.getElementById("link").value.includes("pond.pal")', { timeout: 4000 });
  const link = new URL(await page.evaluate('document.getElementById("link").value'));
  assert.equal(link.pathname, "/overlay/leaderboard/");
  assert.equal(link.searchParams.get("titleGifters"), "Big spenders");
  await page.evaluate("localStorage.clear()");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});
