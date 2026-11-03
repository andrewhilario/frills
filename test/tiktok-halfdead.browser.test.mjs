// TikTok in a real headless Chrome, the one test that has to wait for the overlay's own give-up time (about 40 s) when every new connection hangs with no
// answer at all. It is in its own file so it runs at the same time as the others and the rest of the TikTok tests are not held up behind it.
// Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import http from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createHelper } from "../helper/server.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "index.html"))) throw new Error("dist/ is empty. Run `npm run build` first (`npm test` does that for you).");

let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

const opened = [];
let page;
before(async () => {
  if (skip) return;
  page = await launch();
  await page.viewport(1280, 900);
});
after(async () => {
  await page?.close();
  for (const h of opened) await h.close();
});

test("overlay: when every new connection attempt hangs with no answer at all (a half-dead link), the page gives up on it and gets back in by itself", { skip }, async () => {
  let mode = "ok";
  let inner = 0;
  const forward = http.createServer((req, res) => {
    if (mode === "hang") return; // the request is taken and never answered, as on a link that has half died
    const up = http.request({ host: "127.0.0.1", port: inner, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
      r.on("close", () => { if (!r.complete) res.destroy(); });
    });
    up.on("error", () => { if (!res.headersSent) { res.writeHead(502); res.end(); } else res.destroy(); });
    res.on("close", () => up.destroy());
    req.pipe(up);
  });
  await new Promise((resolve) => forward.listen(0, "127.0.0.1", resolve));
  const front = `http://127.0.0.1:${forward.address().port}`;
  const helper = createHelper({ distDir: dist, demoPace: [300, 500], relay: { origins: [front], slots: 10, trustProxy: false } });
  inner = await helper.listen(0);
  opened.push(helper);
  const note = () => page.evaluate(`document.getElementById("note").hidden ? "" : document.getElementById("note").textContent`);
  try {
    await page.viewport(520, 400);
    await page.goto(`${front}/overlay/?platform=tiktok&channel=frills_demo`, { settle: 1500 });
    await page.waitFor(`document.querySelector("#chat .m")`, { timeout: 10000 });
    mode = "hang";
    forward.closeAllConnections(); // the link breaks, and from now on every attempt to open a stream sits there unanswered
    await page.waitFor(`!document.getElementById("note").hidden`, { timeout: 15000 });
    await sleep(8000);
    mode = "ok"; // the link is fine again, but the attempt the browser is waiting on will never be answered
    await page.waitFor(`document.getElementById("note").hidden`, { timeout: 90000 }).catch(async () => { throw new Error("it never came back; the note says: " + (await note())); });
  } finally {
    forward.closeAllConnections?.();
    forward.close();
  }
});
