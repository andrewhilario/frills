// The site built WITH a relay address (RELAY_URL) into a side folder, so the normal build in dist/ is left alone: the pages say TikTok works
// in the browser, tell the truth about the relay in the privacy page, carry the address for the scripts, and the security policy lets
// the page talk to the relay and nothing else new.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const out = mkdtempSync(join(tmpdir(), "frills-relay-site-"));
const RELAY = "https://relay.example.test";
const read = (path) => readFileSync(join(out, path), "utf8");
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ");

before(() => {
  const build = spawnSync(process.execPath, ["build.mjs"], { cwd: root, env: { ...process.env, OUT_DIR: out, RELAY_URL: RELAY + "/" }, encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr || build.stdout);
});
after(() => { rmSync(out, { recursive: true, force: true }); });

test("every page carries the relay's address (tidied) for the scripts, and the overlay too", () => {
  for (const page of ["index.html", "editor/index.html", "matcha/index.html", "overlay/index.html", "guides/tiktok/index.html"]) {
    assert.ok(read(page).includes(`data-relay="${RELAY}"`), page);
    assert.ok(read(page).includes(`data-site="https://frills.valwidgets.live"`), page + " knows its own address");
  }
});

test("the security policy lets the pages reach the relay and still nothing else new", () => {
  const headers = read("_headers");
  assert.ok(headers.includes(`connect-src 'self' wss://irc-ws.chat.twitch.tv ${RELAY};`), "the relay is allowed to be connected to");
  assert.ok(headers.includes("default-src 'self'") && headers.includes("script-src 'self'"));
  assert.ok(!/connect-src[^;]*\*/.test(headers), "no wildcard in connect-src");
});

test("the wording says TikTok works in the browser through a free beta relay, and the privacy page says what that means", () => {
  const home = textOf(read("index.html"));
  assert.match(home, /TikTok LIVE works in your browser \(free beta, may queue\)/);
  assert.match(home, /works right in your browser through a free relay \(beta\)/);
  assert.match(home, /you may wait in line when it is busy/, "the FAQ says it too");
  const privacy = textOf(read("privacy/index.html"));
  assert.match(privacy, /passes through the free Frills relay, a small server we run/);
  assert.match(privacy, /keeps none of it/);
  assert.doesNotMatch(privacy, /Either way, Frills’ own servers never see your chat/, "that promise is only true without the relay");
  const guide = textOf(read("guides/tiktok/index.html"));
  assert.match(guide, /A free relay we run does the reading/);
  assert.match(guide, /wait in line/);
});

test("with a relay, no page tells anyone to install or run a helper", () => {
  for (const page of ["index.html", "editor/index.html", "matcha/index.html", "guides/tiktok/index.html", "guides/obs/index.html", "guides/test/index.html", "privacy/index.html"]) {
    assert.doesNotMatch(textOf(read(page)), /\bhelper\b/i, `${page} still talks about the helper`);
  }
});

test("without a relay the same pages say none of that", () => {
  const plainOut = mkdtempSync(join(tmpdir(), "frills-plain-site-"));
  try {
    const build = spawnSync(process.execPath, ["build.mjs"], { cwd: root, env: { ...process.env, OUT_DIR: plainOut, RELAY_URL: "" }, encoding: "utf8" });
    assert.equal(build.status, 0, build.stderr || build.stdout);
    const plain = readFileSync(join(plainOut, "index.html"), "utf8");
    assert.ok(!plain.includes("free relay"));
    assert.ok(plain.includes('data-relay=""'));
    assert.ok(readFileSync(join(plainOut, "_headers"), "utf8").includes("connect-src 'self' wss://irc-ws.chat.twitch.tv;"), "and the policy has no relay in it");
  } finally {
    rmSync(plainOut, { recursive: true, force: true });
  }
});
