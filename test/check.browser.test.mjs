// The browser check page (/check/) in a real headless Chrome: what it says when everything works, when the browser would load an old copy of the overlay, and when the relay
// cannot be reached. Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch } from "../scripts/lib/chrome.mjs";
import { createStatic } from "../scripts/lib/static.mjs";
import { createHelper } from "../helper/server.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "check", "index.html"))) throw new Error("dist/ has no check page. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

let page;
const opened = [];
before(async () => {
  if (skip) return;
  page = await launch();
  await page.viewport(1280, 900);
});
after(async () => {
  await page?.close();
  for (const server of opened) { server.closeAllConnections?.(); server.close?.(); await server.shutdown?.(); }
});

/** A helper on this PC with a made-up TikTok behind it: it serves the site and answers for chat, like one address would. */
async function helper() {
  const h = createHelper({ distDir: dist, demoPace: [300, 500] });
  const port = await h.listen(0);
  opened.push({ shutdown: () => h.close() });
  return `http://127.0.0.1:${port}`;
}

/** Opens the check and waits for it to finish. Returns each line as { title, state, detail } and the summary. */
async function check(url, ms = 60000) {
  await page.goto(url, { settle: 300 });
  await page.waitFor(`document.body.dataset.result === "done"`, { timeout: ms });
  return page.evaluate(`JSON.stringify({ rows: [...document.querySelectorAll("#list li")].map((li) => ({ title: li.querySelector("strong").textContent, state: li.className.replace("is-", ""), detail: li.querySelector(".check__detail").textContent })), sum: document.getElementById("sum").textContent, sumState: document.getElementById("sum").dataset.state, problems: document.body.dataset.problems })`).then(JSON.parse);
}
const byTitle = (result, title) => result.rows.find((r) => r.title === title);

test("when everything works every line is green: the browser, a fresh copy, animations, fonts, the chat source, made-up chat, and the overlay drawing", { skip }, async () => {
  const base = await helper();
  const result = await check(`${base}/check/`);
  for (const title of ["This browser", "Newest overlay copy", "Animations", "Fonts", "Where chat comes from", "Made-up chat via the relay", "The overlay draws chat"]) {
    assert.equal(byTitle(result, title)?.state, "ok", `${title}: ${byTitle(result, title)?.detail}`);
  }
  assert.equal(result.rows.length, 7, "no line about an account when none was named");
  assert.equal(result.sumState, "ok");
  assert.match(result.sum, /Everything this browser needs works/);
  assert.equal(result.problems, "0");
});

test("with an account and the look of a link, it also tries the link as the app would load it and the account itself", { skip }, async () => {
  const base = await helper();
  const result = await check(`${base}/check/?channel=frills_demo&platform=tiktok&style=latte&palette=latte`);
  assert.equal(result.rows.length, 9);
  assert.equal(byTitle(result, "Your link, as your app loads it")?.state, "ok", byTitle(result, "Your link, as your app loads it")?.detail);
  assert.equal(byTitle(result, "Your account @frills_demo")?.state, "ok", byTitle(result, "Your account @frills_demo")?.detail);
  assert.match(byTitle(result, "The overlay draws chat").detail, /in your look/, "the drawing test uses the look of the link");
  assert.equal(await page.evaluate(`document.getElementById("fig-own").hidden`), false, "the frame with the link is shown");
  assert.equal(result.problems, "0");
});

test("a browser holding an old copy of the overlay is caught, and the lines say which copy it would load and which is the newest", { skip }, async () => {
  // a stand-in for a cache: the page as a browser normally loads it names an old script, and a fetch that skips the cache names the real one
  const site = createStatic(dist);
  const real = await helper();
  const front = http.createServer((req, res) => {
    if (req.url.startsWith("/overlay/") && !/no-cache|no-store/.test(String(req.headers["cache-control"] ?? "") + String(req.headers.pragma ?? "")) && req.headers["sec-fetch-dest"] !== "iframe") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end('<!doctype html><script src="/assets/overlay-OLDOLD11.js"></script>');
      return;
    }
    const up = http.request(`${real}${req.url}`, { method: req.method, headers: { ...req.headers, host: new URL(real).host } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  void site;
  await new Promise((resolve) => front.listen(0, "127.0.0.1", resolve));
  opened.push({ shutdown: () => new Promise((resolve) => { front.closeAllConnections?.(); front.close(resolve); }) });
  const result = await check(`http://127.0.0.1:${front.address().port}/check/`);
  const copy = byTitle(result, "Newest overlay copy");
  assert.equal(copy.state, "bad");
  assert.match(copy.detail, /would load \/assets\/overlay-OLDOLD11\.js but the newest is \/assets\/overlay-[A-Za-z0-9_-]+\.js/);
  assert.match(copy.detail, /Refresh cache/);
  assert.equal(result.sumState, "bad");
  assert.match(result.sum, /Newest overlay copy/);
});

test("when the relay cannot be reached it says so, and skips what needed it", { skip }, async () => {
  const site = http.createServer((req, res) => {
    if (req.url.startsWith("/tiktok/")) { res.writeHead(502); res.end("Bad gateway"); return; }
    createStatic(dist)(req, res);
  });
  await new Promise((resolve) => site.listen(0, "127.0.0.1", resolve));
  opened.push({ shutdown: () => new Promise((resolve) => { site.closeAllConnections?.(); site.close(resolve); }) });
  const result = await check(`http://127.0.0.1:${site.address().port}/check/?channel=frills_demo&platform=tiktok`);
  assert.equal(byTitle(result, "Where chat comes from").state, "bad");
  assert.match(byTitle(result, "Where chat comes from").detail, /cannot reach the free Frills relay/);
  assert.equal(byTitle(result, "Made-up chat via the relay").state, "bad");
  assert.equal(byTitle(result, "Your account @frills_demo").state, "bad");
  assert.equal(byTitle(result, "Animations").state, "ok", "the lines that do not need it are unaffected");
  assert.equal(result.sumState, "bad");
});
