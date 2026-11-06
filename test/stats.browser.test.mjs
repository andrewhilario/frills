// The anonymous counts from the browser and the private stats page, in a real headless Chrome: a visit is counted once per tab session (and not at all with Do Not Track),
// a copied link is counted by editor, a ?ref= label in a link is the source, and the stats page draws what the Worker reports. Skipped on a computer with no Chrome or Edge.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createStatic } from "../scripts/lib/static.mjs";
import { activeOverlays, scorecard, summarize } from "../worker/stats-report.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "admin", "stats", "index.html"))) throw new Error("dist/ has no stats page. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

let server;
let base;
let page;
let installed = null;
before(async () => {
  if (skip) return;
  server = http.createServer(createStatic(dist));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  page = await launch();
  await page.viewport(1100, 900);
});
after(async () => {
  await page?.close();
  server?.closeAllConnections?.();
  server?.close();
});

/** Opens an address with a pretend beacon (what would be sent is written down), optionally Do Not Track, a clipboard that works, and extra code before the page's own. */
async function open(path, { dnt = false, before: extra = "", fresh = true } = {}) {
  if (installed) await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: installed });
  if (fresh) {
    await page.goto(`${base}/privacy/`, { settle: 100 });
    await page.evaluate("sessionStorage.clear(); localStorage.clear()");
  }
  installed = (await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    window.__beacons = [];
    navigator.sendBeacon = (url, body) => { window.__beacons.push({ url, body: String(body) }); return true; };
    ${dnt ? 'Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true });' : ""}
    try { Object.defineProperty(navigator.clipboard, "writeText", { value: async () => {}, configurable: true }); } catch {}
    ${extra}
  })()` })).identifier;
  await page.goto(`${base}${path}`, { settle: 500 });
}
const beacons = async () => (await page.evaluate("window.__beacons")).map((b) => b.url + " " + b.body);

test("counts: a visit is counted once per tab session, with the page it started on and where it came from, and a ?ref= label in the link is the source", { skip }, async () => {
  await open("/");
  assert.deepEqual(await beacons(), ['/api/e {"e":"visit","a":"home","b":"direct"}']);
  await open("/editor/", { fresh: false });
  assert.deepEqual(await beacons(), [], "the same tab session: not a new visit");
  await open("/goal/?ref=ad1");
  assert.deepEqual(await beacons(), ['/api/e {"e":"visit","a":"goal","b":"ad1"}']);
  await open("/guides/obs/?ref=nonsense");
  assert.deepEqual(await beacons(), ['/api/e {"e":"visit","a":"guides","b":"direct"}'], "a label that is not ours is ignored");
});

test("counts: nothing is sent for a visitor with Do Not Track, and a copied link is counted by editor", { skip }, async () => {
  await open("/", { dnt: true });
  assert.deepEqual(await beacons(), []);
  await open("/editor/");
  await page.evaluate("window.__beacons.length = 0");
  await page.evaluate(`(() => { const i = document.getElementById("source-channel"); i.value = "pond.pal"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await page.waitFor(`!document.getElementById("copy-link").disabled`);
  await page.evaluate(`document.getElementById("copy-link").click()`);
  await page.waitFor(`window.__beacons.length > 0`, { timeout: 4000 });
  assert.deepEqual(await beacons(), ['/api/e {"e":"link_copied","a":"chat"}']);
  await open("/goal/");
  await page.evaluate("window.__beacons.length = 0");
  await page.evaluate(`(() => { const i = document.getElementById("source-channel"); i.value = "pond.pal"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await page.waitFor(`!document.getElementById("copy-link").disabled`);
  await page.evaluate(`document.getElementById("copy-link").click()`);
  await page.waitFor(`window.__beacons.length > 0`, { timeout: 4000 });
  assert.deepEqual(await beacons(), ['/api/e {"e":"link_copied","a":"goal"}']);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("counts: the overlays themselves carry no counting code at all (they are at their weight cap, and the Worker counts them)", { skip }, async () => {
  await open("/overlay/?demo=1");
  await sleep(600);
  assert.deepEqual(await beacons(), []);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

const T = Date.now();
const day = (age) => new Date(T - age * 86400000).toISOString().slice(0, 19).replace("T", " "); // (a time of day is fine: the report counts whole days)
const rows = [{ ev: "visit", a: "home", b: "tiktok", d: day(0), n: 30 }, { ev: "visit", a: "editor", b: "reddit", d: day(1), n: 12 }, { ev: "visit", a: "home", b: "tiktok", d: day(9), n: 20 }, { ev: "link_copied", a: "chat", b: "", d: day(1), n: 7 }, { ev: "overlay_load", a: "chat", b: "live", d: day(2), n: 40 }, { ev: "overlay_load", a: "chat", b: "demo", d: day(2), n: 90 }];
const ids = [{ id: "a", d: day(0) }, { id: "b", d: day(1) }, { id: "a", d: day(8) }];
const REPORT = (() => { const summary = summarize(rows, T); const active = activeOverlays(ids, T); return { ok: true, now: T, frills: { ...summary, active, scorecard: scorecard(summary, active), idsReadable: true }, valwidgets: summarize([{ ev: "visit", a: "rank", b: "search", d: day(0), n: 5 }, { ev: "pro_click", a: "footer", b: "", d: day(0), n: 2 }], T) }; })();

/** The stats page with a pretend Worker: what /api/admin/stats answers is given. */
async function stats(reply, { signedIn = true } = {}) {
  await open("/admin/stats/", { before: `
    ${signedIn ? 'sessionStorage.setItem("frills:admin:key", "pretend-password");' : ""}
    const real = window.fetch.bind(window);
    window.fetch = async (input, options = {}) => String(typeof input === "string" ? input : input.url).includes("/api/admin/stats")
      ? new Response(JSON.stringify(${JSON.stringify(reply.body)}), { status: ${reply.status}, headers: { "content-type": "application/json" } })
      : real(input, options);` });
}

test("stats page: it draws both sites, the Frills Plus check with yes and not yet, and the 28 days of visits", { skip }, async () => {
  await stats({ status: 200, body: REPORT });
  await page.waitFor(`document.querySelectorAll("#score li").length === 3`, { timeout: 5000 });
  const score = await page.evaluate(`[...document.querySelectorAll("#score li")].map((li) => li.dataset.ok + ":" + li.querySelector(".stats__tick").textContent)`);
  assert.deepEqual(score, ["false:Not yet", "true:Yes", "false:Not yet"], "two overlays and seven copies are not enough, but the one overlay of the week before did come back");
  const texts = await page.evaluate(`({ frills: document.getElementById("frills").textContent, tally: document.getElementById("valwidgets").textContent, bars: document.querySelectorAll("#frills .stats__bars i").length })`);
  assert.equal(texts.bars, 28);
  assert.match(texts.frills, /Visits, last 7 days.*42/);
  assert.match(texts.frills, /Different overlays, last 7 days.*2/);
  assert.match(texts.frills, /TikTok/);
  assert.match(texts.frills, /Practice overlays and previews, counted apart: 90/);
  assert.match(texts.tally, /Rank page/);
  assert.match(texts.tally, /pro_click 2/, "an event only that site has is listed by name");
  assert.equal(await page.evaluate(`document.getElementById("login").hidden`), true);
  assert.deepEqual(page.problems.filter((p) => !p.includes("api/admin/stats")), [], page.problems.join(" | "));
});

test("stats page: before the Cloudflare secrets are set it says how, a site that could not be read says so while the other shows, and a wrong password goes back to the login", { skip }, async () => {
  await stats({ status: 200, body: { ok: false, error: "not_set" } });
  await page.waitFor(`!document.getElementById("setup").hidden`, { timeout: 5000 });
  assert.match(await page.evaluate(`document.getElementById("setup").textContent`), /CF_ACCOUNT_ID[\s\S]*CF_API_TOKEN[\s\S]*STATS_SALT/);
  await stats({ status: 200, body: { ...REPORT, valwidgets: { error: "unreadable", status: 400 } } });
  await page.waitFor(`document.querySelectorAll("#frills .stats__card").length > 0`, { timeout: 5000 });
  assert.match(await page.evaluate(`document.getElementById("valwidgets").textContent`), /did not give the counts for this site \(answer 400\)/);
  await stats({ status: 401, body: { ok: false, error: "wrong_key" } });
  await page.waitFor(`!document.getElementById("login").hidden`, { timeout: 5000 });
  assert.match(await page.evaluate(`document.getElementById("login-status").textContent`), /not the right password/);
  assert.equal(await page.evaluate(`sessionStorage.getItem("frills:admin:key")`), null, "the wrong password is forgotten");
});
