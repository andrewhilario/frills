// Quick start: how answers become links. No page needed; how the questions look and behave is checked in a browser in start.browser.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { ALIGNS, OVERLAYS, SHAPES, VIBES, buildLinks, linksText, overlaysFor, vibeOf } from "../src/js/quickstart.js";
import { sourcesOf } from "../src/js/both.js";
import { PRESETS, fromParams as chatFromParams, sanitize as chatSanitize } from "../src/js/settings.js";
import { GIFTS } from "../src/js/gifts.js";
import { LOOKS, fromParams as alertFromParams, sanitize as alertSanitize } from "../src/js/alerts-settings.js";
import { MATCHA_PALETTES, MATCHA_STYLES, matchaFromParams, sanitizeMatcha } from "../src/js/matcha.js";

const ORIGIN = "https://site.test";
const ALL = OVERLAYS.map((o) => o.id);
const answers = (over = {}) => ({ platform: "tiktok", channel: "pond.pal", overlays: ALL, vibe: "pink", shape: "vertical", align: "left", ...over });
const params = (url) => new URL(url).searchParams;

test("every vibe names a look that really exists, for the chat and for the other overlays", () => {
  assert.equal(VIBES.length, 5);
  for (const vibe of VIBES) {
    const chat = new URLSearchParams(vibe.chat);
    if (chat.has("look")) assert.ok(PRESETS[chat.get("look")], `${vibe.id}: chat look ${chat.get("look")}`);
    else {
      assert.ok(MATCHA_STYLES.some((s) => s.id === chat.get("style")), `${vibe.id}: matcha style`);
      assert.ok(MATCHA_PALETTES[chat.get("palette")], `${vibe.id}: matcha palette`);
    }
    assert.ok(LOOKS[new URLSearchParams(vibe.widgets).get("look")], `${vibe.id}: overlay look`);
    assert.equal(vibe.swatch.length, 3);
    assert.ok(vibe.swatch.every((c) => /^#[0-9a-f]{6}$/i.test(c)));
  }
  assert.equal(new Set(VIBES.map((v) => v.widgets)).size, 5, "the five vibes use the five different looks of the alerts, gifts, goals and likers");
  assert.equal(vibeOf("nope").id, VIBES[0].id, "an unknown vibe falls back to the first");
});

test("each overlay gets its own link, and a link carries the name, the platform, the look and the alignment", () => {
  const links = buildLinks(ORIGIN, answers({ align: "center" }));
  assert.deepEqual(links.map((l) => l.id), ALL);
  const chat = links[0];
  assert.equal(chat.url, `${ORIGIN}/overlay/?channel=pond.pal&platform=tiktok&look=bubblegum&deco=neko&align=center`);
  assert.equal(links[1].url, `${ORIGIN}/overlay/alerts/?channel=pond.pal&platform=tiktok&look=bubblegum&align=center`);
  for (const l of links) {
    assert.ok(l.url.startsWith(`${ORIGIN}/overlay/`), l.id);
    assert.equal(params(l.url).get("channel"), "pond.pal");
    assert.equal(params(l.url).get("platform"), "tiktok");
    assert.equal(params(l.url).get("align"), "center");
    assert.equal(l.size, SHAPES.vertical.size);
  }
  assert.ok(!params(buildLinks(ORIGIN, answers())[0].url).has("align"), "left is the start, so the link does not say it");
});

test("a link means what it says: the settings read back from it are the vibe's look, for every vibe and every overlay", () => {
  for (const vibe of VIBES) {
    for (const align of ["left", "center", "right"]) {
      for (const link of buildLinks(ORIGIN, answers({ vibe: vibe.id, align }))) {
        const p = params(link.url);
        if (link.id === "chat") {
          if (p.has("look")) {
            const settings = chatSanitize(chatFromParams(p));
            assert.equal(settings.bg, PRESETS[p.get("look")].bg, `${vibe.id}/chat look`);
            assert.equal(settings.align, align, `${vibe.id}/chat align`);
            assert.equal(settings.deco, vibe.id === "pink" ? "neko" : "none");
          } else {
            const settings = sanitizeMatcha(matchaFromParams(p));
            assert.equal(settings.style, "latte");
            assert.equal(settings.deco, "frog");
            assert.equal(settings.align, align);
          }
        } else if (link.id === "alerts") {
          const settings = alertSanitize(alertFromParams(p));
          assert.equal(settings.accent, LOOKS[p.get("look")].accent, `${vibe.id}/alerts look`);
          assert.equal(settings.align, align);
        } else {
          const settings = GIFTS.sanitize(GIFTS.fromParams(p)); // (the look and alignment options are the same in gifts, goals and likers)
          assert.equal(settings.accent, LOOKS[p.get("look")].accent, `${vibe.id}/${link.id} look`);
          assert.equal(settings.align, align);
        }
      }
    }
  }
});

test("Twitch gets all 11 dual-platform overlays, and its alerts/labels links say the follow login is separate", () => {
  const TWITCH_IDS = ["chat", "alerts", "gifters", "labels", "wheel", "gifts", "jar", "goal", "songs", "timer", "tts"];
  assert.deepEqual(overlaysFor("twitch").map((o) => o.id), TWITCH_IDS);
  assert.equal(overlaysFor("tiktok").length, 14);
  const links = buildLinks(ORIGIN, answers({ platform: "twitch", channel: "pondpal" }));
  assert.deepEqual(links.map((l) => l.id), TWITCH_IDS, "all 11 dual-platform overlays work on Twitch");
  assert.ok(links.every((l) => params(l.url).get("platform") === "twitch"));
  assert.match(links[1].note, /follow alerts need one extra login/i);
  assert.match(links[3].note, /last follower needs one extra login/i);
  assert.match(links[4].note, /wheel slices/i);
  assert.equal(params(links[4].preview).get("platform"), "twitch", "Twitch wheel preview uses Twitch platform");
  assert.equal(params(links.find((l) => l.id === "songs").preview).get("platform"), "twitch", "Twitch songs preview uses Twitch platform");
  assert.equal(buildLinks(ORIGIN, answers()).find((l) => l.id === "goal").note.includes("real follower count"), true);
  assert.match(buildLinks(ORIGIN, answers()).find((l) => l.id === "gallery").note, /featured TikTok gifts/i);
});

test("only the chosen overlays are made; without a name there is no link yet but the editor link still works", () => {
  assert.deepEqual(buildLinks(ORIGIN, answers({ overlays: ["gifts", "chat"] })).map((l) => l.id), ["chat", "gifts"], "in the usual order");
  assert.deepEqual(buildLinks(ORIGIN, answers({ overlays: [] })), []);
  const none = buildLinks(ORIGIN, answers({ channel: "" }));
  assert.ok(none.every((l) => l.url === ""), "no name, no link to paste");
  assert.ok(none.every((l) => l.editUrl.startsWith(ORIGIN) && !params(l.editUrl).has("channel") && params(l.editUrl).has("look") || params(l.editUrl).has("style")));
  assert.equal(linksText(none), "");
});

test("the editor link opens the right editor with the same look and name; a Matcha chat goes to the Matcha editor", () => {
  const links = buildLinks(ORIGIN, answers());
  assert.deepEqual(links.map((l) => new URL(l.editUrl).pathname), ["/editor/", "/alerts/", "/gifters/", "/labels/", "/wheel/", "/gifts/", "/jar/", "/gallery/", "/goal/", "/likers/", "/songs/", "/timer/", "/tts/", "/counter/"]);
  for (const l of links) assert.equal(new URL(l.editUrl).search, new URL(l.url).search, `${l.id}: the editor gets the very same options`);
  const green = buildLinks(ORIGIN, answers({ vibe: "green" }));
  assert.equal(new URL(green[0].editUrl).pathname, "/matcha/");
  assert.equal(new URL(green[0].url).pathname, "/overlay/", "the overlay itself is the same page");
  assert.equal(new URL(green[0].url).searchParams.get("style"), "latte");
});

test("each picture on the page is the overlay in practice mode, in the same look, and never uses the name", () => {
  for (const l of buildLinks(ORIGIN, answers({ align: "right" }))) {
    const p = params(l.preview);
    assert.equal(p.get("demo"), "1");
    assert.ok(!p.has("channel"), "a picture does not connect to anything");
    assert.equal(p.get("align"), "right");
    assert.equal(new URL(l.preview).pathname, new URL(l.url).pathname);
  }
  assert.equal(params(buildLinks(ORIGIN, answers({ platform: "twitch" }))[1].preview).get("platform"), "twitch", "Twitch alerts are practised with Twitch alerts");
  assert.equal(buildLinks(ORIGIN, answers({ channel: "" }))[0].preview.includes("demo=1"), true, "and a picture needs no name");
});

test("odd answers are tolerated: an unknown shape or alignment falls back, and the text for 'copy all' lists each link", () => {
  const odd = buildLinks(ORIGIN, answers({ shape: "square", align: "sideways", platform: "myspace" }));
  assert.ok(odd.every((l) => l.size === SHAPES.vertical.size && !params(l.url).has("align") && params(l.url).get("platform") === "tiktok"));
  const text = linksText(buildLinks(ORIGIN, answers({ overlays: ["chat", "alerts"] })));
  assert.deepEqual(text.split("\n").map((l) => l.split(": ")[0]), ["Chat", "Alerts"]);
  assert.ok(ALIGNS.map(([id]) => id).join() === "left,center,right");
});

test("Both: dual-platform overlays each produce one unified TikTok + Twitch link, and TikTok-only ones stay TikTok's", () => {
  const both = (over = {}) => answers({ platform: "both", channel: "pond.pal", twitch: "pondpal", ...over });
  assert.equal(overlaysFor("both").length, 14, "every overlay is on offer");
  const links = buildLinks(ORIGIN, both());
  assert.deepEqual(links.map((l) => l.id), ALL, "one unified card per overlay — no duplicate TikTok/Twitch pairs");
  const chat = links.find((l) => l.id === "chat");
  const alerts = links.find((l) => l.id === "alerts");
  const songs = links.find((l) => l.id === "songs");
  const gallery = links.find((l) => l.id === "gallery");
  for (const unified of [chat, alerts, songs]) {
    const p = params(unified.url);
    assert.deepEqual([p.get("tiktok"), p.get("twitch"), p.has("channel"), p.has("platform")], ["pond.pal", "pondpal", false, false], `${unified.id} carries both accounts`);
  }
  assert.deepEqual(sourcesOf(params(chat.url)), [{ platform: "tiktok", channel: "pond.pal" }, { platform: "twitch", channel: "pondpal" }], "chat reads back as both");
  assert.deepEqual([params(gallery.url).get("channel"), params(gallery.url).get("platform")], ["pond.pal", "tiktok"], "TikTok-only overlays keep TikTok channel");
  assert.match(alerts.note, /follow alerts need one extra login/i);
  assert.match(links.find((l) => l.id === "labels").note, /last follower needs one extra login/i);
  assert.match(chat.note, /small icon/);
  for (const l of links) assert.equal(new URL(l.editUrl).search, new URL(l.url).search, `${l.id}: the editor gets the very same options`);
  assert.equal(new URL(links[0].editUrl).pathname, "/editor/");
  assert.equal(new URL(buildLinks(ORIGIN, both({ vibe: "green" }))[0].editUrl).pathname, "/matcha/", "a Matcha chat goes to the Matcha page, which opens in Both too");
  assert.equal(buildLinks(ORIGIN, both({ overlays: ["chat"] })).length, 1);
  assert.deepEqual(buildLinks(ORIGIN, both({ overlays: ["alerts"] })).map((l) => l.id), ["alerts"]);
});

test("Both: a link only exists once the accounts it needs are named, and the picture of the chat shows both without using them", () => {
  const both = (over = {}) => answers({ platform: "both", channel: "pond.pal", twitch: "pondpal", ...over });
  const onlyTikTok = buildLinks(ORIGIN, both({ twitch: "" }));
  // 3 TikTok-only overlays (gallery, likers, counter) are ready with just TikTok; the 11 unified Both overlays wait for Twitch too
  assert.deepEqual(onlyTikTok.filter((l) => l.url !== "").map((l) => l.id), ["gallery", "likers", "counter"], "only TikTok-only overlays are ready without Twitch");
  const onlyTwitch = buildLinks(ORIGIN, both({ channel: "" }));
  assert.ok(onlyTwitch.every((l) => l.url === ""), "unified Both overlays wait for TikTok name too");
  assert.ok(buildLinks(ORIGIN, both({ channel: "", twitch: "" })).every((l) => l.url === ""));
  assert.equal(linksText(onlyTikTok).split("\n").length, 3, "'copy all' lists only the links that exist");
  // the picture of the chat is practice for two chats, so it shows the icons; no real name goes into any picture
  const chatPicture = buildLinks(ORIGIN, both())[0].preview;
  assert.deepEqual(sourcesOf(params(chatPicture)).map((s) => s.platform), ["tiktok", "twitch"]);
  assert.equal(params(chatPicture).get("demo"), "1");
  for (const l of buildLinks(ORIGIN, both())) assert.ok(!l.preview.includes("pond"), `${l.id}: a picture never carries a real name`);
  // one platform is exactly as before
  assert.deepEqual(buildLinks(ORIGIN, answers()).map((l) => l.id), ALL);
  assert.ok(buildLinks(ORIGIN, answers()).every((l) => l.needs.length === 1 && l.needs[0] === "tiktok"));
});
