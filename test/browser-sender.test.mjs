// The browser sender against a pretend TikTok LIVE page served from this computer, driven by a real headless Chrome. The pretend page only shows
// its comment box when the login cookies arrive, and records what was posted on the "server" side, so these tests show that the cookies are sent,
// that the reply is typed and sent (with the send button, or with Enter when there is none), and what happens when the page does not behave.
// Nothing here touches TikTok. They are skipped if there is no Chrome or Edge on the computer.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cookieDomain, createBrowserSender, liveAddress } from "../helper/browser-sender.mjs";
import { findChrome } from "../scripts/lib/chrome.mjs";

let skip = false;
try {
  findChrome();
} catch {
  skip = "no Chrome or Edge on this computer";
}

/** A local page that behaves like a LIVE room: ?mode=button (a send button), enter (no button, Enter sends), stuck (sending does nothing), noinput (no comment box). */
async function pretendTikTok() {
  const received = [];
  const server = createServer((req, res) => {
    const cookie = String(req.headers.cookie ?? "");
    const loggedIn = /(^|; )sessionid=SESSION(;|$)/.test(cookie) && /(^|; )tt-target-idc=IDC(;|$)/.test(cookie);
    const url = new URL(req.url, "http://pretend");
    if (req.method === "POST" && url.pathname === "/send") {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        if (loggedIn) received.push(body);
        res.writeHead(loggedIn ? 200 : 401).end();
      });
      return;
    }
    const mode = url.searchParams.get("mode") ?? "button";
    const page = `<!doctype html><meta charset="utf-8"><title>pretend LIVE</title><body>
<div id="room"></div>
<script>
  const MODE = ${JSON.stringify(mode)};
  const LOGGED_IN = ${JSON.stringify(loggedIn)};
  async function send(box) {
    const text = box.textContent.trim();
    if (!text || MODE === "stuck") return;
    await fetch("/send", { method: "POST", body: text });
    box.textContent = "";
  }
  // like the real page, the comment box arrives a moment after the page has loaded
  setTimeout(() => {
    if (!LOGGED_IN || MODE === "noinput") { document.getElementById("room").innerHTML = '<a href="/login">Log in to chat</a>'; return; }
    document.getElementById("room").innerHTML = '<div data-e2e="comment-input"><div contenteditable="true" id="box"></div></div>' + (MODE === "enter" ? "" : '<button data-e2e="comment-post" id="post">Chat</button>');
    const box = document.getElementById("box");
    box.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (MODE === "enter") send(box); } });
    document.getElementById("post")?.addEventListener("click", () => send(box));
  }, 400);
</script>`;
    res.writeHead(200, { "content-type": "text/html" }).end(page);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { received, base, address: (mode) => `${base}/@pond.pal/live?mode=${mode}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

const sender = (address, extra = {}) => createBrowserSender({ channel: "pond.pal", sessionId: "SESSION", ttTargetIdc: "IDC", address, verifyMs: 1500, loadTimeoutMs: 8000, ...extra });

test("the address and the cookie domain", () => {
  assert.equal(liveAddress("pond.pal"), "https://www.tiktok.com/@pond.pal/live");
  assert.equal(cookieDomain("https://www.tiktok.com/@x/live"), ".tiktok.com");
  assert.equal(cookieDomain("http://127.0.0.1:8080/x"), "127.0.0.1");
});

test("it signs in with the cookies, finds the comment box, types the reply and presses the send button, in order", { skip }, async () => {
  const tiktok = await pretendTikTok();
  const s = sender(tiktok.address("button"));
  try {
    await s.post("Viper V3 Pro at 800 DPI");
    await s.post("0.31 at 800 DPI");
    assert.deepEqual(tiktok.received, ["Viper V3 Pro at 800 DPI", "0.31 at 800 DPI"]);
  } finally {
    await s.stop();
    await tiktok.close();
  }
});

test("with no send button on the page it presses Enter", { skip }, async () => {
  const tiktok = await pretendTikTok();
  const s = sender(tiktok.address("enter"));
  try {
    await s.post("hello from the bot");
    assert.deepEqual(tiktok.received, ["hello from the bot"]);
  } finally {
    await s.stop();
    await tiktok.close();
  }
});

test("without a working login there is no comment box: it says so, saves a picture, and nothing is posted", { skip }, async () => {
  const tiktok = await pretendTikTok();
  const debugDir = mkdtempSync(join(tmpdir(), "frills-sender-"));
  const logs = [];
  const s = sender(tiktok.address("button"), { sessionId: "EXPIRED", loadTimeoutMs: 2500, debugDir, log: (l) => logs.push(l) });
  try {
    await assert.rejects(s.post("hi"), /comment box did not appear/);
    assert.deepEqual(tiktok.received, []);
    assert.ok(readdirSync(debugDir).some((f) => /^no-comment-box-.*\.png$/.test(f)), "a picture of the page was saved");
    assert.ok(logs.some((l) => /saved a picture/.test(l)));
  } finally {
    await s.stop();
    await tiktok.close();
    rmSync(debugDir, { recursive: true, force: true });
  }
});

test("a page with no comment box at all (not live, or changed) is reported, not guessed at", { skip }, async () => {
  const tiktok = await pretendTikTok();
  const s = sender(tiktok.address("noinput"), { loadTimeoutMs: 2500 });
  try {
    await assert.rejects(s.post("hi"), /comment box did not appear/);
    assert.deepEqual(tiktok.received, []);
  } finally {
    await s.stop();
    await tiktok.close();
  }
});

test("if the page does not accept the comment, the box never empties and that is an error, with a picture", { skip }, async () => {
  const tiktok = await pretendTikTok();
  const debugDir = mkdtempSync(join(tmpdir(), "frills-sender-"));
  const s = sender(tiktok.address("stuck"), { verifyMs: 800, debugDir });
  try {
    await assert.rejects(s.post("hi"), /did not empty after sending/);
    assert.ok(readdirSync(debugDir).some((f) => /^not-sent-.*\.png$/.test(f)));
    assert.deepEqual(tiktok.received, []);
  } finally {
    await s.stop();
    await tiktok.close();
    rmSync(debugDir, { recursive: true, force: true });
  }
});

test("your own selectors replace the guesses, and stop() closes the browser (a later post opens a fresh one)", { skip }, async () => {
  const tiktok = await pretendTikTok();
  let opened = 0;
  const closed = [];
  const counting = async (options) => {
    const { launch } = await import("../scripts/lib/chrome.mjs");
    const page = await launch(options);
    opened += 1;
    const close = page.close;
    page.close = async () => {
      closed.push(1);
      return close();
    };
    return page;
  };
  const s = sender(tiktok.address("button"), { inputSelector: "#box", sendSelector: "#post", launcher: counting });
  try {
    await s.post("one");
    await s.stop();
    assert.equal(closed.length, 1, "the browser was closed");
    await s.post("two");
    assert.equal(opened, 2, "and a new one was opened for the next reply");
    assert.deepEqual(tiktok.received, ["one", "two"]);
  } finally {
    await s.stop();
    await tiktok.close();
  }
});

test("a reply asked for while the page is still loading waits for the comment box instead of failing", { skip }, async () => {
  const tiktok = await pretendTikTok();
  const s = sender(tiktok.address("button"));
  try {
    const opening = s.start(); // what the relay does when the stream connects: not awaited
    await s.post("asked too early"); // a viewer's command arrives straight away
    await opening;
    assert.deepEqual(tiktok.received, ["asked too early"]);
  } finally {
    await s.stop();
    await tiktok.close();
  }
});

test("a browser that fails to open is stopped, and the next post tries again", { skip }, async () => {
  const tiktok = await pretendTikTok();
  let tries = 0;
  const { launch } = await import("../scripts/lib/chrome.mjs");
  const flaky = async (options) => {
    tries += 1;
    if (tries === 1) throw new Error("The browser didn't start.");
    return launch(options);
  };
  const s = sender(tiktok.address("button"), { launcher: flaky });
  try {
    await assert.rejects(s.post("first"), /didn't start/);
    await s.post("second");
    assert.deepEqual(tiktok.received, ["second"]);
    assert.equal(tries, 2);
  } finally {
    await s.stop();
    await tiktok.close();
  }
});
