// Posts a chat message into a TikTok LIVE room with our own headless Chrome, signed in as the bot account. No signing service and no
// paid plan: the browser opens the same LIVE page a viewer would, finds the comment box, types the reply and sends it.
//
// What it needs: Chrome or Chromium on the machine that runs it (set CHROME_PATH if it is somewhere unusual, and CHROME_FLAGS="--no-sandbox"
// if the machine needs that), the bot account's two login cookies, and some memory (a browser is a few hundred MB while it is open).
// Set BOT_DEBUG_DIR to a folder and it saves a picture of the page whenever posting fails, which shows what TikTok is asking for.
//
// This is the part most likely to break: it depends on TikTok's page. The selectors below are guesses that are tried in order, and they
// can be replaced in the bot file ("inputSelector", "sendSelector") without changing any code. Nothing here tries to hide that it is a
// browser, so TikTok may ask it to verify itself, or refuse it.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "../scripts/lib/chrome.mjs";

export const INPUT_SELECTORS = [
  '[data-e2e="comment-input"] [contenteditable="true"]',
  'div[contenteditable="true"][data-e2e="comment-input"]',
  'div[data-e2e="comment-input"]',
  'div[contenteditable="true"]',
  'textarea[placeholder*="comment" i]',
  'textarea[placeholder*="chat" i]',
  'input[placeholder*="comment" i]',
];
export const SEND_SELECTORS = ['[data-e2e="comment-post"]', 'button[type="submit"]'];

// the cookies a TikTok login is made of (the same names the connector library sets), all holding the one session id
const SESSION_COOKIES = ["sessionid", "sessionid_ss", "sid_tt", "sid_guard"];
const TARGET_COOKIE = "tt-target-idc";

export const liveAddress = (channel) => `https://www.tiktok.com/@${channel}/live`;

/** The domain to give the cookies: TikTok's own, or (for a test page) the address's host. */
export function cookieDomain(address) {
  const host = new URL(address).hostname;
  return /(^|\.)tiktok\.com$/.test(host) ? ".tiktok.com" : host;
}

const list = (value, fallback) => {
  const given = (Array.isArray(value) ? value : [value]).filter((s) => typeof s === "string" && s.trim());
  return given.length ? given : fallback;
};

class SenderError extends Error {
  constructor(message) {
    super(message);
    this.name = "SenderError"; // what happened to the page, as opposed to the browser itself failing
  }
}

export function createBrowserSender({
  channel,
  sessionId,
  ttTargetIdc,
  address = liveAddress(channel),
  inputSelector,
  sendSelector,
  launcher = launch,
  flags = [],
  light = true, // no pictures, video or fonts: only the comment box is needed, and the video is the heavy part
  debugDir = "",
  log = () => {},
  loadTimeoutMs = 45_000,
  verifyMs = 4000,
} = {}) {
  const inputs = list(inputSelector, INPUT_SELECTORS);
  const sends = list(sendSelector, SEND_SELECTORS);
  let page = null;
  let starting = null;

  async function picture(name) {
    if (!debugDir || !page) return;
    try {
      mkdirSync(debugDir, { recursive: true });
      const file = join(debugDir, `${name}-${Date.now()}.png`);
      writeFileSync(file, await page.screenshot());
      log(`saved a picture of the page: ${file}`);
    } catch {
      /* a picture is only a help */
    }
  }

  const findInput = () =>
    page.evaluate(`(() => { for (const s of ${JSON.stringify(inputs)}) { const el = document.querySelector(s); if (el && el.getClientRects().length > 0) return s; } return ""; })()`);

  async function open() {
    page = await launcher({ flags });
    await page.send("Network.enable");
    if (light) {
      try {
        await page.send("Network.setBlockedURLs", { urls: ["*.mp4*", "*.m3u8*", "*.flv*", "*.m4s*", "*.png*", "*.jpg*", "*.jpeg*", "*.webp*", "*.gif*", "*.woff*", "*.woff2*"] });
      } catch {
        /* an older or newer Chrome that wants this another way: it only saves bandwidth */
      }
    }
    const domain = cookieDomain(address);
    const secure = address.startsWith("https:");
    const cookies = [...SESSION_COOKIES.map((name) => ({ name, value: sessionId })), { name: TARGET_COOKIE, value: ttTargetIdc }].map((c) => ({
      ...c,
      domain,
      path: "/",
      secure,
      httpOnly: c.name !== TARGET_COOKIE,
    }));
    await page.send("Network.setCookies", { cookies });
    await page.send("Page.navigate", { url: address });

    const started = Date.now();
    for (;;) {
      if (await findInput()) return;
      if (Date.now() - started > loadTimeoutMs) {
        await picture("no-comment-box");
        throw new SenderError("the comment box did not appear (the cookies may have expired, TikTok may be asking for a check, the account may not be live, or the page changed)");
      }
      await sleep(500);
    }
  }

  // Opens the browser and waits until the comment box is there. A reply asked for while it is still loading waits for that, instead of failing.
  function start() {
    if (starting) return starting;
    if (page) return Promise.resolve();
    starting = open()
      .catch(async (error) => {
        await stop();
        throw error;
      })
      .finally(() => {
        starting = null;
      });
    return starting;
  }

  async function stop() {
    const closing = page;
    page = null;
    try {
      await closing?.close();
    } catch {
      /* it is closing anyway */
    }
  }

  async function post(text) {
    await start();
    try {
      const selector = await findInput();
      if (!selector) {
        await picture("no-comment-box");
        throw new SenderError("the comment box is not on the page any more");
      }
      // focus the box and select what is in it, so typing replaces it
      await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); if (typeof el.select === "function") el.select(); else document.execCommand("selectAll"); })()`);
      await page.send("Input.insertText", { text });
      await sleep(150);
      const clicked = await page.evaluate(
        `(() => { for (const s of ${JSON.stringify(sends)}) { const b = document.querySelector(s); if (b && !b.disabled && b.getAttribute("aria-disabled") !== "true") { b.click(); return true; } } return false; })()`,
      );
      if (!clicked) {
        const key = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
        await page.send("Input.dispatchKeyEvent", { type: "keyDown", text: "\r", ...key });
        await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
      }
      // it was sent when the box is empty again
      const started = Date.now();
      while (Date.now() - started < verifyMs) {
        const empty = await page.evaluate(
          `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return true; return String("value" in el && el.tagName !== "DIV" ? el.value : el.textContent).trim() === ""; })()`,
        );
        if (empty) return;
        await sleep(150);
      }
      await picture("not-sent");
      throw new SenderError("the comment box did not empty after sending (TikTok may have refused the comment, or asked to verify)");
    } catch (error) {
      if (error?.name !== "SenderError") await stop(); // the browser itself failed: start a fresh one next time
      throw error;
    }
  }

  return { start, post, stop };
}
