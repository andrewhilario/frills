// The extra fonts in a real headless Chrome: choosing one in a link makes the chat, the alerts and the song overlay load that font's file and draw with it. Skipped on a
// computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch } from "../scripts/lib/chrome.mjs";
import { createStatic } from "../scripts/lib/static.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "index.html"))) throw new Error("dist/ is empty. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

const NEW = ["Poppins", "Montserrat", "Nunito", "Quicksand", "Lilita One", "Bangers", "Permanent Marker", "Pacifico", "Dancing Script", "Caveat", "Orbitron", "Silkscreen"];
let server;
let base;
let page;
before(async () => {
  if (skip) return;
  server = http.createServer(createStatic(dist));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  page = await launch();
  await page.viewport(640, 360);
});
after(async () => {
  await page?.close();
  server?.closeAllConnections?.();
  server?.close();
});

/** Whether the page has loaded a font file for this family. */
const loaded = (name) => page.evaluate(`[...document.fonts].some((f) => f.family.replace(/"/g, "") === ${JSON.stringify(name)} && f.status === "loaded")`);

test("each new font, chosen in the chat overlay's link, loads its file and the messages are drawn in it", { skip }, async () => {
  for (const name of NEW) {
    await page.goto(`${base}/overlay/?demo=1&pace=300&font=${encodeURIComponent(name)}`, { settle: 300 });
    await page.waitFor(`document.querySelector("#chat .m .txt")`, { timeout: 15000 });
    await page.waitFor(`[...document.fonts].some((f) => f.family.replace(/"/g, "") === ${JSON.stringify(name)} && f.status === "loaded")`, { timeout: 8000 }).catch(() => {});
    assert.equal(await loaded(name), true, `${name}: its file loaded`);
    assert.match(await page.evaluate(`getComputedStyle(document.querySelector("#chat .m .txt")).fontFamily`), new RegExp(`^"?${name}"?,`), `${name}: the messages use it first`);
  }
});

test("the alerts, the gifts and the song overlays can use a new font too", { skip }, async () => {
  for (const [path, selector, name] of [["alerts", ".alert", "Pacifico"], ["gifts", ".gift", "Caveat"], ["songs", ".song", "Orbitron"]]) {
    await page.goto(`${base}/overlay/${path}/?demo=1&pace=400&font=${encodeURIComponent(name)}`, { settle: 300 });
    await page.waitFor(`document.querySelector(${JSON.stringify(selector)})`, { timeout: 15000 });
    await page.waitFor(`[...document.fonts].some((f) => f.family.replace(/"/g, "") === ${JSON.stringify(name)} && f.status === "loaded")`, { timeout: 8000 }).catch(() => {});
    assert.equal(await loaded(name), true, `${path}: ${name} loaded`);
    assert.match(await page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).fontFamily`), new RegExp(`${name}`), `${path}: drawn in ${name}`);
  }
});

test("a font that is not chosen is not downloaded (the files only load when a look uses them)", { skip }, async () => {
  await page.goto(`${base}/overlay/?demo=1&pace=300&font=Poppins`, { settle: 300 });
  await page.waitFor(`document.querySelector("#chat .m .txt")`, { timeout: 15000 });
  await page.waitFor(`[...document.fonts].some((f) => f.family.replace(/"/g, "") === "Poppins" && f.status === "loaded")`, { timeout: 8000 });
  const loadedFamilies = await page.evaluate(`JSON.stringify([...new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")))])`).then(JSON.parse);
  for (const other of NEW.filter((n) => n !== "Poppins")) assert.ok(!loadedFamilies.includes(other), `${other} stayed unloaded`);
});
