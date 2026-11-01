// A very small way to drive a headless Chrome or Edge that is already installed: open a page, wait for fonts, click, read, take a picture.
// No packages. Set CHROME_PATH if yours is somewhere unusual.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits until a server just started answers (any answer will do), for at most `ms`. The tests that start scripts/serve.mjs used to sleep a fixed
 * 900 ms and hope: on a busy computer that was not always enough, and the first request failed.
 */
export async function waitForServer(url, ms = 20000) {
  const started = Date.now();
  for (;;) {
    try {
      await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(1500) });
      return;
    } catch {
      if (Date.now() - started > ms) throw new Error(`The server at ${url} did not answer within ${ms} ms`);
      await sleep(100);
    }
  }
}

export function findChrome() {
  const found = CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error("No Chrome or Edge found. Set CHROME_PATH to its executable.");
  return found;
}

/** Starts a headless browser. Returns the page's controls, and close() when you're done. */
export async function launch() {
  const port = 9700 + Math.floor(Math.random() * 200);
  const profile = mkdtempSync(join(tmpdir(), "frills-chrome-"));
  const chrome = spawn(findChrome(), ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "--force-device-scale-factor=1", "--force-color-profile=srgb", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "about:blank"], { stdio: "ignore" });
  const close = async () => {
    chrome.kill();
    await sleep(300);
    // Chrome's helper processes hold the folder for a moment after it is killed, and a profile left behind is 100 to 250 MB: the disk filled up with them (November 2026).
    // So the removal tries again for a few seconds instead of giving up on the first refusal.
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); } catch { /* still held: it is only a temp folder */ }
  };
  try {
    let target;
    for (let i = 0; i < 100 && !target; i++) {
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* not up yet */ }
      if (!target) await sleep(100);
    }
    if (!target) throw new Error("The browser didn't start.");
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error("Couldn't connect to the browser.")); });

    let id = 0;
    const waiting = new Map();
    const handlers = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const pending = waiting.get(message.id);
        if (!pending) return;
        waiting.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result);
      } else {
        for (const handler of handlers.get(message.method) ?? []) handler(message.params);
      }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      waiting.set(++id, { resolve, reject, method });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const on = (method, handler) => handlers.set(method, [...(handlers.get(method) ?? []), handler]);
    const once = (method) => new Promise((resolve) => {
      const handler = (params) => {
        handlers.set(method, (handlers.get(method) ?? []).filter((h) => h !== handler));
        resolve(params);
      };
      on(method, handler);
    });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Log.enable");

    // Everything the page complains about: uncaught errors, console errors, blocked requests, failed loads.
    const problems = [];
    on("Runtime.exceptionThrown", (e) => problems.push("exception: " + (e.exceptionDetails?.exception?.description ?? e.exceptionDetails?.text)));
    on("Runtime.consoleAPICalled", (e) => e.type === "error" && problems.push("console: " + e.args.map((a) => a.value ?? a.description).join(" ")));
    on("Log.entryAdded", (e) => e.entry.level === "error" && problems.push("log: " + e.entry.text + " " + (e.entry.url ?? "")));

    const api = {
      send,
      problems,
      async evaluate(expression) {
        const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return result.result.value;
      },
      async viewport(width, height, { reducedMotion = false } = {}) {
        await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
        await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" }] });
      },
      /**
       * Opens a page, waits for it and its fonts, then a little longer. A page that has not finished loading after `timeout` ms ends the test with an error that
       * names it (a load that never finishes used to wait for ever, and a whole test run with it).
       */
      async goto(url, { settle = 400, timeout = 60000 } = {}) {
        problems.length = 0;
        const loaded = once("Page.loadEventFired");
        let timer;
        const gaveUp = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`The page did not finish loading in ${timeout / 1000} s: ${url}`)), timeout); });
        // (the navigate command itself does not come back while the address does not answer, so it is inside the time limit too)
        const arrived = send("Page.navigate", { url }).then(() => loaded);
        arrived.catch(() => {}); // if the limit wins, what this does later is not an error
        try { await Promise.race([arrived, gaveUp]); } finally { clearTimeout(timer); }
        await api.evaluate("document.fonts.ready.then(() => true)");
        await sleep(settle);
      },
      async waitFor(expression, { timeout = 8000 } = {}) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          if (await api.evaluate(`Boolean(${expression})`)) return;
          await sleep(100);
        }
        throw new Error(`Timed out waiting for: ${expression}`);
      },
      /** A PNG of what the page shows now. */
      async screenshot({ transparent = false } = {}) {
        await send("Emulation.setDefaultBackgroundColorOverride", transparent ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {});
        const { data } = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
        return Buffer.from(data, "base64");
      },
      /** Opens a page at a size and returns a PNG of it. */
      async shoot(url, { width, height, transparent = false, settle = 600 }) {
        await api.viewport(width, height);
        await api.goto(url, { settle });
        return api.screenshot({ transparent });
      },
      close,
    };
    return api;
  } catch (error) {
    await close();
    throw error;
  }
}

/** Runs fn(page) inside one headless browser, then closes it. */
export async function browser(fn) {
  const page = await launch();
  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}
