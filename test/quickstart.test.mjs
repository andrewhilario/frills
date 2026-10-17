// Quick start: how answers become links. No page needed; how the questions look and behave is checked in a browser in start.browser.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { ALIGNS, OVERLAYS, SHAPES, VIBES, buildLinks, linksText, overlaysFor, vibeOf } from "../src/js/quickstart.js";
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

test("Twitch gets only the overlays that work there, and its alerts link says the follow login is separate", () => {
  assert.deepEqual(overlaysFor("twitch").map((o) => o.id), ["chat", "alerts"]);
  assert.equal(overlaysFor("tiktok").length, 5);
  const links = buildLinks(ORIGIN, answers({ platform: "twitch", channel: "pondpal" }));
  assert.deepEqual(links.map((l) => l.id), ["chat", "alerts"], "gifts, goals and likers are TikTok's");
  assert.ok(links.every((l) => params(l.url).get("platform") === "twitch"));
  assert.match(links[1].note, /follow alerts need one extra login/i);
  assert.equal(buildLinks(ORIGIN, answers()).find((l) => l.id === "goal").note.includes("real follower count"), true);
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
  assert.deepEqual(links.map((l) => new URL(l.editUrl).pathname), ["/editor/", "/alerts/", "/gifts/", "/goal/", "/likers/"]);
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
