// The words around Frills Plus (src/plus-words.mjs and the pages that use it), checked in two builds of the site on the side: with accounts OFF (the site today) every page still says what it
// said before, and mentions no payment company; with accounts ON no page still says "no accounts", the privacy page lists what an account and a payment keep and where the words of an AI voice go,
// the Frills Plus page says how to cancel and how to get a refund, and the footer and every "not affiliated" note name the new companies. Also that the account page links to that page.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const build = (flag) => {
  const out = mkdtempSync(join(tmpdir(), flag ? "frills-words-on-" : "frills-words-off-"));
  execFileSync(process.execPath, ["build.mjs"], { cwd: root, stdio: "ignore", env: { ...process.env, PLUS_ACCOUNTS: flag ? "1" : "", OUT_DIR: out } });
  return out;
};
const page = (out, path) => readFileSync(join(out, path, "index.html"), "utf8");
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "’").replace(/\s+/g, " ");
const htmlFiles = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? htmlFiles(full) : name.endsWith(".html") ? [full] : [];
});

const off = build(false);
const on = build(true);

test("accounts off: the pages say what they always said, and there is no Frills Plus page or payment company anywhere", () => {
  const privacy = textOf(page(off, "privacy"));
  assert.match(privacy, /Frills has no accounts\. It does keep a few things you choose to send it/);
  assert.match(privacy, /Frills itself sets no cookies\./);
  assert.match(privacy, /isn’t affiliated with, endorsed by or sponsored by Twitch, TikTok or OBS\./);
  assert.doesNotMatch(privacy, /Polar|Lemon Squeezy|Resend|OpenAI|Groq/);
  assert.equal(existsSync(join(off, "plus", "index.html")), false);
  assert.doesNotMatch(readFileSync(join(off, "sitemap.xml"), "utf8"), /\/plus\//);
  const home = page(off, ".");
  assert.match(home, /<span class="stat__label">accounts<\/span>/);
  assert.doesNotMatch(home, /href="\/plus\/"/);
  for (const file of htmlFiles(off)) assert.doesNotMatch(readFileSync(file, "utf8"), /Lemon Squeezy|\bPolar\b/, file);
  for (const file of htmlFiles(off)) assert.doesNotMatch(readFileSync(file, "utf8"), /Pro AI voices|Frills Pro|Pro Pass/, file + ": no Pro wording, and no AI voice on sale");
});

test("accounts on: no page still says there are no accounts", () => {
  for (const file of htmlFiles(on)) {
    const words = textOf(readFileSync(file, "utf8"));
    assert.doesNotMatch(words, /Frills has no accounts|has no accounts\b|It keeps no chat and has no accounts/i, file);
  }
  const home = page(on, ".");
  assert.match(home, /<span class="stat__label">accounts needed<\/span>/);
  assert.match(textOf(home), /Do I need an account\? .{0,40}No\. Your settings live in your browser and in the link you copy, and nothing free needs an account\. An account exists only for Frills Plus/);
  assert.match(textOf(page(on, "overlays")), /Frills is free today, and what is free stays free\. Frills Plus is a paid extra for things that cost money to run/);
});

test("accounts on: the talking pet pages offer AI voices only as part of Frills Plus, and nothing says Pro", () => {
  for (const file of htmlFiles(on)) assert.doesNotMatch(readFileSync(file, "utf8"), /Pro AI voices|Frills Pro|Pro Pass/, file);
  assert.match(textOf(page(on, "tts")), /AI voices are part of Frills Plus . They run through Frills, which checks that your account has Plus/);
  assert.match(textOf(page(on, "tts")), /browser voices work locally with zero keys, and Frills Plus adds AI voices./);
  assert.match(textOf(page(on, "overlays")), /with no keys, and Frills Plus adds AI voices./);
});

test("accounts on: the privacy page lists what an account, a sign-in and a payment keep, the cookie, the AI voice words, and how to delete", () => {
  const privacy = textOf(page(on, "privacy"));
  for (const part of [
    /Frills needs no account for anything free\. An account exists only for Frills Plus/,
    /Your account, if you make one \(Frills Plus\)\. Your email address/,
    /no password, no name and no address/,
    /Sign-in links and signed-in browsers\..*works once, for 15 minutes/,
    /scrambled copy of its cookie value, for up to 30 days/,
    /What you bought, if you buy Frills Plus\..*Not your card/,
    /Your Plus overlay link, if you make one/,
    /Frills sets no cookies, with one exception: if you sign in to a Frills account, a cookie keeps you signed in for up to 30 days/,
    /Sign-in emails\. When you ask for a sign-in link, Frills passes your email address and the one-time link to Resend/,
    /Payments\. Frills Plus is sold through Polar.*Frills never does/,
    /AI voices\. They are a Frills Plus extra\. When one is spoken, the words to be said .* go from Frills to the company that makes the voice \(OpenAI, Google or Groq.*Frills does not keep the words or the sound/,
    /The free browser voices send nothing anywhere/,
    /Deleting your account\. On the account page.*has to be cancelled first/,
    /isn’t affiliated with, endorsed by or sponsored by Twitch, TikTok, OBS, Polar, Resend, OpenAI, Google or Groq/,
  ]) assert.match(privacy, part);
});

test("accounts on: the Frills Plus page says what it is, how to cancel and how refunds work, and every address on it exists", () => {
  const html = page(on, "plus");
  const words = textOf(html);
  assert.match(words, /Frills stays free\. Frills Plus is a paid extra/);
  assert.match(words, /\$5\.99 \/ month/);
  assert.match(words, /150,000 AI voice characters a month/);
  assert.match(words, /Everything that is free today stays free, with no account/);
  assert.match(words, /press Manage or cancel/);
  assert.match(words, /stays on until the end of the month you already paid for/);
  assert.match(words, /within 14 days of a payment and we will refund that payment in full/);
  assert.match(words, /rights you have by law/);
  assert.match(words, /affiliated with, endorsed by or sponsored by Twitch, TikTok, OBS, Polar, Resend/);
  assert.match(readFileSync(join(on, "sitemap.xml"), "utf8"), /\/plus\//);
  for (const href of new Set([...html.matchAll(/href="(\/[^"#]*)"/g)].map((m) => m[1]))) {
    assert.ok(existsSync(join(on, href.replace(/^\//, ""), href.endsWith("/") ? "index.html" : "")) || existsSync(join(on, href)), `${href} exists`);
  }
  assert.match(readFileSync(join(on, "account", "index.html"), "utf8"), /href="\/plus\/">How cancelling and refunds work<\/a>/);
});

test("accounts on: the footer links to the Frills Plus page and names the new companies on every page that has a footer", () => {
  for (const path of ["", "privacy", "overlays", "plus"]) {
    const html = readFileSync(join(on, path, "index.html"), "utf8");
    assert.match(html, /<li><a href="\/plus\/">Frills Plus<\/a><\/li>/, path || "home");
    assert.match(html, /<li><a href="\/account\/">Account<\/a><\/li>/, path || "home");
    assert.match(textOf(html), /Twitch, TikTok, OBS, Polar, Resend, OpenAI, Google or Groq/, path || "home");
  }
});
