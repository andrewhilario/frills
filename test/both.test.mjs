// One chat for TikTok and Twitch together, the parts that need no page: which accounts a link names, keeping each platform's messages apart, the
// status line for two connections, and the links that name two accounts. How it behaves in a browser is in both.browser.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { noteFor, scoped, sourcesOf } from "../src/js/both.js";
import { CONTROLS, DEFAULTS, coerce, fromParams, overlayUrl, sanitize } from "../src/js/settings.js";
import { MATCHA_CONTROLS, MATCHA_DEFAULTS, matchaFromParams, matchaOverlayUrl, sanitizeMatcha } from "../src/js/matcha.js";

const q = (s) => new URLSearchParams(s);

test("a link names one account or two: tiktok= and twitch= (new), channel= and platform= (older, Twitch unless it says TikTok)", () => {
  assert.deepEqual(sourcesOf(q("tiktok=Pond.Pal&twitch=PondPal")), [{ platform: "tiktok", channel: "pond.pal" }, { platform: "twitch", channel: "pondpal" }], "both, cleaned, TikTok first");
  assert.deepEqual(sourcesOf(q("twitch=pondpal&tiktok=@pond.pal")), [{ platform: "tiktok", channel: "pond.pal" }, { platform: "twitch", channel: "pondpal" }], "whatever the order in the address");
  assert.deepEqual(sourcesOf(q("tiktok=pond.pal")), [{ platform: "tiktok", channel: "pond.pal" }]);
  assert.deepEqual(sourcesOf(q("twitch=pondpal")), [{ platform: "twitch", channel: "pondpal" }]);
  assert.deepEqual(sourcesOf(q("channel=pondpal")), [{ platform: "twitch", channel: "pondpal" }], "an older link without a platform is Twitch");
  assert.deepEqual(sourcesOf(q("channel=pond.pal&platform=tiktok")), [{ platform: "tiktok", channel: "pond.pal" }]);
  assert.deepEqual(sourcesOf(q("")), []);
  assert.deepEqual(sourcesOf(q("tiktok=not a name!&twitch=")), [], "nothing usable is nothing");
  assert.deepEqual(sourcesOf(q("tiktok=pond.pal&twitch=bad name!")), [{ platform: "tiktok", channel: "pond.pal" }], "one good name still gives one account");
  assert.deepEqual(sourcesOf(q("tiktok=pond.pal&twitch=pondpal&channel=other&platform=twitch")), [{ platform: "tiktok", channel: "pond.pal" }, { platform: "twitch", channel: "pondpal" }], "the new names win over the older ones");
});

test("each platform's messages are its own: ids and people carry the platform, so a delete or a clear finds only its own", () => {
  const calls = [];
  const feed = { add: (m) => calls.push(["add", m]), removeById: (id) => calls.push(["removeById", id]), removeUser: (u) => calls.push(["removeUser", u]), clearWhere: (p) => calls.push(["clearWhere", p]), clear: () => calls.push(["clear"]) };
  const tiktok = scoped(feed, "tiktok");
  const twitch = scoped(feed, "twitch");
  tiktok.add({ id: "7", user: "pal", name: "Pal", text: "hi" });
  twitch.add({ id: "7", user: "pal", name: "Pal", text: "hi" });
  assert.deepEqual(calls[0][1], { id: "tiktok:7", user: "tiktok:pal", name: "Pal", text: "hi", platform: "tiktok" });
  assert.deepEqual(calls[1][1], { id: "twitch:7", user: "twitch:pal", name: "Pal", text: "hi", platform: "twitch" }, "the same id and name on the other platform is a different message and person");
  twitch.removeById("7");
  twitch.removeUser("pal");
  twitch.clear();
  tiktok.clear();
  assert.deepEqual(calls.slice(2), [["removeById", "twitch:7"], ["removeUser", "twitch:pal"], ["clearWhere", "twitch"], ["clearWhere", "tiktok"]]);
  calls.length = 0;
  tiktok.add({ name: "No id", text: "x" });
  assert.deepEqual([calls[0][1].id, calls[0][1].user], ["", ""], "a message with no id or person stays that way");
  scoped(feed, "twitch").removeById("");
  assert.deepEqual(calls.at(-1), ["removeById", ""], "and an empty id never matches a real one");
});

test("the status line for two connections is empty when both are fine, and names the platform that is not", () => {
  const words = (s) => `<${s.state}>`;
  assert.equal(noteFor({}, words), "", "nothing heard yet is not a warning");
  assert.equal(noteFor({ tiktok: { state: "connected" }, twitch: { state: "connected" } }, words), "");
  assert.equal(noteFor({ tiktok: { state: "stopped" }, twitch: { state: "connected" } }, words), "");
  assert.equal(noteFor({ tiktok: { state: "connected" }, twitch: { state: "reconnecting" } }, words), "Twitch: <reconnecting>");
  assert.equal(noteFor({ tiktok: { state: "queued" }, twitch: { state: "connecting" } }, words), "TikTok: <queued> · Twitch: <connecting>", "both, TikTok first");
  assert.equal(noteFor({ twitch: { state: "error" } }, words), "Twitch: <error>");
});

test("the links that name two accounts: tiktok= and twitch= instead of channel= and platform=; one account is unchanged", () => {
  const url = overlayUrl("https://x.test/overlay/", { settings: sanitize({ look: "frost", align: "center" }), both: { tiktok: "pond.pal", twitch: "pondpal" } });
  const p = new URL(url).searchParams;
  assert.deepEqual([p.get("tiktok"), p.get("twitch"), p.has("channel"), p.has("platform")], ["pond.pal", "pondpal", false, false]);
  assert.equal(p.get("align"), "center");
  assert.deepEqual(sourcesOf(p), [{ platform: "tiktok", channel: "pond.pal" }, { platform: "twitch", channel: "pondpal" }], "and it reads back as the same two accounts");
  assert.equal(overlayUrl("https://x.test/overlay/", { channel: "pondpal" }), "https://x.test/overlay/?channel=pondpal", "one account: as before");
  assert.equal(overlayUrl("https://x.test/overlay/", { channel: "pond.pal", platform: "tiktok" }), "https://x.test/overlay/?channel=pond.pal&platform=tiktok");
  assert.equal(overlayUrl("https://x.test/overlay/", { channel: "pondpal", both: { tiktok: "", twitch: "pondpal" } }), "https://x.test/overlay/?channel=pondpal", "only one of the two filled in is not 'both'");
  const matcha = new URL(matchaOverlayUrl("https://x.test/overlay/", { settings: MATCHA_DEFAULTS, both: { tiktok: "pond.pal", twitch: "pondpal" } })).searchParams;
  assert.deepEqual([matcha.get("tiktok"), matcha.get("twitch"), matcha.get("style"), matcha.has("channel")], ["pond.pal", "pondpal", "latte", false]);
});

test("the platform icon is a setting on both kinds of look, on by default, and only a non-default choice goes into a link", () => {
  const control = CONTROLS.find((c) => c.key === "source");
  assert.ok(control && control.where === "main");
  assert.deepEqual(control.options.map((o) => o.id), ["icon", "none"]);
  assert.equal(DEFAULTS.source, "icon");
  assert.equal(coerce(control, "none"), "none");
  assert.equal(coerce(control, "banner"), undefined);
  assert.equal(sanitize({ source: "banner" }).source, "icon", "an unknown value falls back");
  assert.ok(!overlayUrl("https://x.test/o/", { channel: "a", settings: DEFAULTS }).includes("source="));
  assert.equal(new URL(overlayUrl("https://x.test/o/", { channel: "a", settings: sanitize({ source: "none" }) })).searchParams.get("source"), "none");
  assert.equal(sanitize(fromParams(q("source=none"))).source, "none");
  assert.ok(MATCHA_CONTROLS.some((c) => c.key === "source"), "the Matcha looks have it too");
  assert.equal(MATCHA_DEFAULTS.source, "icon");
  assert.equal(sanitizeMatcha(matchaFromParams(q("style=latte&source=none"))).source, "none");
  assert.ok(!matchaOverlayUrl("https://x.test/o/", { channel: "a", settings: MATCHA_DEFAULTS }).includes("source="));
});
