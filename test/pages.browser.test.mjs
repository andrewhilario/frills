// Every page, in a real headless Chrome or Edge: no console errors under the security policy, no sideways scrolling, no button or chip that wraps.
// These sweeps visit a lot of pages, so each one runs on a few browsers at once (inParallel) and not one page after another.
// Skipped (not failed) on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, inParallel, waitForServer } from "../scripts/lib/chrome.mjs";

const root = join(import.meta.dirname, "..");
if (!existsSync(join(root, "dist", "index.html"))) throw new Error("dist/ is empty. Run `npm run build` first (`npm test` does that for you).");

let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

const port = 3500 + Math.floor(Math.random() * 400);
const base = `http://localhost:${port}`;
let server;

before(async () => {
  if (skip) return;
  server = spawn(process.execPath, ["scripts/serve.mjs", String(port)], { cwd: root, stdio: "ignore" });
  await waitForServer(base + "/");
});
after(() => server?.kill());

const PAGES = ["/", "/editor/", "/feedback/", "/alerts/", "/gifts/", "/goal/", "/likers/", "/overlays/", "/guides/alerts/", "/overlay/?demo=1", "/overlay/alerts/?demo=1", "/matcha/", "/guides/obs/", "/guides/test/", "/guides/tiktok/", "/privacy/"];

// The fonts are already waited for by goto(); what is left to wait for is only the page's own scripts drawing their first frame.
const SETTLE = 300;

test("every page loads under the security policy without a single console error", { skip }, async () => {
  await inParallel(PAGES, async (path, page) => {
    await page.viewport(1280, 900);
    await page.goto(base + path, { settle: 800 });
    assert.deepEqual(page.problems, [], `${path}: ${page.problems.join(" | ")}`);
  });
});

test("no page scrolls sideways at any width from 320 to 1920 px", { skip }, async () => {
  await inParallel([320, 375, 414, 768, 1280, 1920], async (width, page) => {
    await page.viewport(width, 800);
    for (const path of PAGES) {
      await page.goto(base + path, { settle: SETTLE });
      const w = await page.evaluate("({ scroll: document.documentElement.scrollWidth, inner: innerWidth })");
      assert.ok(w.scroll <= w.inner, `${path} at ${width}px is ${w.scroll}px wide`);
    }
  });
});

test("no button, link or chip wraps onto two lines, from 320 to 1280 px", { skip }, async () => {
  await inParallel([320, 375, 768, 1280], async (width, page) => {
    await page.viewport(width, 800);
    for (const path of PAGES) {
      await page.goto(base + path, { settle: SETTLE });
      const wrapped = await page.evaluate(`(() => {
        const bad = [];
        for (const el of document.querySelectorAll(".btn, .nav__link, .chip, .foot__links a, .look-card__link")) {
          if (!el.offsetParent && getComputedStyle(el).position !== "fixed") continue; // hidden
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let wrapped = false;
          while (walker.nextNode()) {
            if (!walker.currentNode.textContent.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(walker.currentNode);
            const tops = new Set([...range.getClientRects()].filter((r) => r.width > 2).map((r) => Math.round(r.top / 4)));
            if (tops.size > 1) wrapped = true;
          }
          if (wrapped) bad.push(el.textContent.trim());
        }
        return bad;
      })()`);
      assert.deepEqual(wrapped, [], `${path} at ${width}px`);
    }
  });
});
