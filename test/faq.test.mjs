// The FAQ is written once and used twice (the page, and the structured data search engines read), so it is checked on its own: what it
// says about TikTok, and that "where to get the helper" only ever points at something real.

import test from "node:test";
import assert from "node:assert/strict";
import { faq } from "../src/faq.mjs";

const none = { kb: 15, waitlistUrl: "", helperUrl: "" };

test("TikTok comes right after the price, and the answer says yes and points at the TikTok guide", () => {
  const items = faq(none);
  assert.equal(items[0].q, "Is Frills really free?");
  assert.equal(items[1].q, "Does it work with TikTok LIVE?");
  assert.match(items[1].a, /^Yes\./);
  assert.ok(items[1].a.includes('href="/guides/tiktok/"'));
  assert.ok(items[1].a.includes("in testing"), "it is honest that the helper is still in testing");
  assert.doesNotMatch(items.map((i) => i.text).join(" "), /Not yet|is next|haven’t built|isn’t supported/);
});

test("where to get the helper follows what exists: a download, a waitlist, or an honest no download yet", () => {
  const withDownload = faq({ kb: 15, waitlistUrl: "https://w.test/list", helperUrl: "https://d.test/helper" })[1].a;
  assert.ok(withDownload.includes('<a href="https://d.test/helper" rel="noopener">Get the helper</a>'));
  assert.doesNotMatch(withDownload, /waitlist|no download yet/i, "a real download beats a waitlist");
  const withList = faq({ kb: 15, waitlistUrl: "https://w.test/list", helperUrl: "" })[1].a;
  assert.ok(withList.includes("There is no download yet."));
  assert.ok(withList.includes('<a href="https://w.test/list" rel="noopener">Join the waitlist</a>'));
  const neither = faq(none)[1].a;
  assert.ok(neither.includes("There is no download yet"));
  assert.ok(!neither.includes('href="https'), "no link to nowhere");
});

test("the plain text for search engines has no tags, and the answers cover Twitch, pictures, safety and OBS", () => {
  const items = faq({ kb: 15, waitlistUrl: "https://w.test/list", helperUrl: "" });
  for (const item of items) {
    assert.doesNotMatch(item.text, /<|>/, item.q);
    assert.ok(item.text.length > 40, item.q);
  }
  const questions = items.map((i) => i.q);
  for (const wanted of ["Does it work with Twitch?", "Do profile pictures show?", "Is it safe, and is it allowed?", "How do I add it to my stream?"]) assert.ok(questions.includes(wanted), wanted);
  assert.ok(items.find((i) => i.q === "How do I add it to my stream?").a.includes('href="/guides/obs/"'));
  assert.match(items.find((i) => i.q === "Do profile pictures show?").text, /Twitch doesn’t share pictures/);
});

test("the safety answer is straight about TikTok having no official way to read chat", () => {
  const safe = faq(none).find((i) => i.q === "Is it safe, and is it allowed?").text;
  assert.match(safe, /doesn’t log in to your TikTok account/);
  assert.match(safe, /no official way/);
  assert.match(safe, /could change or block it/);
});

test("the numbers in the answers come from the build, and the words use real apostrophes", () => {
  assert.match(faq({ ...none, kb: 17 }).find((i) => i.q === "Will it slow down my stream?").a, /about 17 KB/);
  for (const item of faq(none)) assert.doesNotMatch(item.a, /[A-Za-z]'[a-z]/, `${item.q}: a straight apostrophe`);
});

// ── the overlays' own FAQ ───────────────────────────────────────────────────────────────────────────────────────────────────────

import { overlaysFaq } from "../src/overlays-faq.mjs";

test("the overlays FAQ answers what people ask about alerts, Twitch, uploads, sound, follows and what is kept, in plain text for search engines too", () => {
  const items = overlaysFaq({ kb: 19, relayUrl: "https://relay.example" });
  const questions = items.map((i) => i.q);
  for (const wanted of ["Which overlays are there?", "Do the overlays work with Twitch?", "How do I add an overlay to my stream?", "Can I use my own images, GIFs and sounds in alerts?", "How do follow alerts work on Twitch, and why do they need a login?", "Is my Twitch login safe?", "What does Frills keep about me and my viewers?"]) assert.ok(questions.includes(wanted), wanted);
  assert.equal(new Set(questions).size, questions.length, "no question twice");
  for (const item of items) {
    assert.doesNotMatch(item.text, /<|>/, item.q);
    assert.ok(item.text.length > 60, item.q);
    assert.ok(item.a.length > 0);
  }
});

test("the overlays FAQ keeps its promises: Twitch support as it is, uploads described honestly, and the privacy page linked", () => {
  const items = overlaysFaq({});
  const answer = (q) => items.find((i) => i.q === q).a;
  assert.match(answer("Do the overlays work with Twitch?"), /chat overlay and the alerts do/);
  assert.match(answer("Do the overlays work with Twitch?"), /Last gifts, goals and top likers are for TikTok LIVE only/);
  assert.match(answer("Can I use my own images, GIFs and sounds in alerts?"), /300 KB/);
  assert.match(answer("Can I use my own images, GIFs and sounds in alerts?"), /delete code/);
  assert.ok(answer("Can I use my own images, GIFs and sounds in alerts?").includes('href="/privacy/"'));
  assert.ok(answer("What does Frills keep about me and my viewers?").includes('href="/privacy/"'));
  assert.ok(answer("How do follow alerts work on Twitch, and why do they need a login?").includes('href="/twitch/"'));
  assert.doesNotMatch(items.map((i) => i.text).join(" "), /no database|stores nothing|nothing is stored/i, "it never claims there is no database");
  assert.match(answer("Which overlays are there?"), /Song requests are coming soon/);
});

test("the main FAQ no longer claims there is no database or that nothing is stored", () => {
  const text = faq(none).map((i) => i.text).join(" ");
  assert.doesNotMatch(text, /no database|stores nothing|nothing stored/i);
  const account = faq(none).find((i) => i.q === "Do I need an account?");
  assert.match(account.text, /feedback/);
  assert.match(account.text, /upload/);
  assert.ok(account.a.includes('href="/privacy/"'));
  assert.ok(faq(none).find((i) => i.q.startsWith("Does Frills have alerts")).a.includes('href="/overlays/faq/"'), "and it points at the overlays FAQ");
});
