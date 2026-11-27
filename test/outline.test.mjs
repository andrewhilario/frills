import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GIFT_MENU,
  FREE_FRAME_STYLES,
  FREE_ROW_LIMIT,
  OUTLINE,
  PLUS_FRAME_STYLES,
  PLUS_ROW_LIMIT,
  TIKTOK_SAFE_ZONES,
  computeOutlineGeometry,
  effectiveOutlineSettings,
  encodeCardRows,
  outlineUrl,
  parseCardRows,
  parseSocials,
  plusFeaturesUsed,
} from "../src/js/outline.js";

test("gift menu & commands card rows round-trip cleanly and strip control delimiters", () => {
  const parsed = parseCardRows(DEFAULT_GIFT_MENU);
  assert.equal(parsed.length, 4);
  assert.deepEqual(parsed[0], { label: "🌹 Rose", value: "Shoutout" });
  assert.deepEqual(parsed[3], { label: "🌌 Galaxy", value: "VIP + Follow" });

  const noisy = [
    { label: "🌹 Rose | Extra", value: "10 Pushups ~ Now" },
    { label: "   ", value: "" },
    { label: "!sr", value: "Request a song" },
  ];
  const encoded = encodeCardRows(noisy);
  assert.equal(encoded, "🌹 Rose Extra~10 Pushups Now|!sr~Request a song");
  assert.deepEqual(parseCardRows(encoded), [
    { label: "🌹 Rose Extra", value: "10 Pushups Now" },
    { label: "!sr", value: "Request a song" },
  ]);
});

test("Free vs. Frills Plus effective settings enforce caps without breaking previewAll", () => {
  const tenRows = Array.from({ length: 10 }, (_, i) => ({ label: `Gift ${i + 1}`, value: `Reward ${i + 1}` }));
  const raw = {
    ...OUTLINE.defaults,
    sideMode: "gifts",
    frameStyle: "cyber",
    motion: "orbit",
    matMode: "stars",
    matImage: "WallPaper1234567",
    cardStyle: "quest",
    cardItems: encodeCardRows(tenRows),
    highlightRow: 8,
    socials: "TikTok @frills | Twitch /frills",
    customBadge: "AbCdEfGh12345678",
  };

  const used = plusFeaturesUsed(raw);
  assert.ok(used.includes("collector frame style"));
  assert.ok(used.includes("animated border motion"));
  assert.ok(used.includes("starry backdrop"));
  assert.ok(used.includes("custom wallpaper backdrop"));
  assert.ok(used.includes("Plus card layout"));
  assert.ok(used.includes("custom corner mascot"));
  assert.ok(used.includes("rotating socials"));

  const freeEff = effectiveOutlineSettings(raw, { plusActive: false, previewAll: false });
  assert.ok(FREE_FRAME_STYLES.includes(freeEff.frameStyle));
  assert.equal(freeEff.motion, "breathe");
  assert.equal(freeEff.matMode, "gradient");
  assert.equal(freeEff.matImage, "");
  assert.equal(freeEff.cardStyle, "cards");
  assert.equal(freeEff.rows.length, FREE_ROW_LIMIT);
  assert.equal(freeEff.highlightRow, -1);
  assert.deepEqual(freeEff.socials, []);
  assert.equal(freeEff.customBadge, "");

  const plusEff = effectiveOutlineSettings(raw, { plusActive: true });
  assert.equal(plusEff.frameStyle, "cyber");
  assert.equal(plusEff.motion, "orbit");
  assert.equal(plusEff.matMode, "stars");
  assert.equal(plusEff.matImage, "WallPaper1234567");
  assert.equal(plusEff.cardStyle, "quest");
  assert.equal(plusEff.rows.length, PLUS_ROW_LIMIT);
  assert.equal(plusEff.highlightRow, 8);
  assert.deepEqual(plusEff.socials, ["TikTok @frills", "Twitch /frills"]);
  assert.equal(plusEff.customBadge, "AbCdEfGh12345678");
  assert.equal(PLUS_FRAME_STYLES.length, 4);
});

test("switchable Side Slot supports transparent widget cutout, Gift Menu card, Commands card, and Wide Cam", () => {
  const asWidget = computeOutlineGeometry({ ...OUTLINE.defaults, mode: "screen9x16", layout9: "tt-game-cam", sideMode: "widget", widgetSlotLabel: "GIFT JAR" });
  assert.equal(asWidget.cutouts.length, 3, "game + cam + transparent widget slot cutout");
  assert.equal(asWidget.cutouts[2].isWidgetSlot, true);
  assert.equal(asWidget.cutouts[2].label, "GIFT JAR");
  assert.equal(asWidget.cardRect, null);

  const asGifts = computeOutlineGeometry({ ...OUTLINE.defaults, mode: "screen9x16", layout9: "tt-game-cam", sideMode: "gifts" });
  assert.equal(asGifts.cutouts.length, 2, "game + cam cutouts");
  assert.ok(asGifts.cardRect, "renders docked Gift Menu card in side slot");

  const asNone = computeOutlineGeometry({ ...OUTLINE.defaults, mode: "screen9x16", layout9: "tt-game-cam", sideMode: "none" });
  assert.equal(asNone.cutouts.length, 2);
  assert.equal(asNone.cardRect, null);
  assert.equal(asNone.cutouts[1].w, asNone.cutouts[0].w, "hiding side slot expands cam to full width");
});

test("all 7 TikTok LIVE 9:16 layouts stay horizontally symmetric, respect spacing sliders, and swap cleanly", () => {
  const layouts = ["tt-game-cam", "tt-cam-top", "tt-game-stack", "tt-vtuber", "tt-chat-focus", "tt-split-cam", "tt-perimeter"];
  for (const layout9 of layouts) {
    const geom = computeOutlineGeometry({ ...OUTLINE.defaults, mode: "screen9x16", layout9, sideMode: "widget", showName: true, showBanner: true, showPromo: true });
    assert.equal(geom.width, 1080);
    assert.equal(geom.height, 1920);
    if (geom.bannerRect) {
      assert.equal(geom.bannerRect.x, geom.width - (geom.bannerRect.x + geom.bannerRect.w), `${layout9} banner centered`);
    }
    if (geom.nameplateRect) {
      assert.equal(geom.nameplateRect.x, geom.width - (geom.nameplateRect.x + geom.nameplateRect.w), `${layout9} nameplate centered`);
    }
    if (geom.promoRect) {
      assert.equal(geom.promoRect.x, geom.width - (geom.promoRect.x + geom.promoRect.w), `${layout9} promo centered`);
    }
    for (const c of geom.cutouts) {
      assert.ok(c.y >= TIKTOK_SAFE_ZONES.topBar.h, `${layout9} cutout ${c.id} clears top bar`);
      assert.ok(c.y + c.h <= TIKTOK_SAFE_ZONES.bottomChat.y, `${layout9} cutout ${c.id} clears bottom chat`);
    }
  }

  const a = computeOutlineGeometry({ ...OUTLINE.defaults, mode: "screen9x16", layout9: "tt-game-cam", sideMode: "gifts", splitPct: 36, swapSides: false });
  const b = computeOutlineGeometry({ ...OUTLINE.defaults, mode: "screen9x16", layout9: "tt-game-cam", sideMode: "gifts", splitPct: 64, swapSides: true });
  assert.ok(b.cutouts[0].h > a.cutouts[0].h + 150, "splitPct resizes upper gameplay cutout");
  assert.ok(b.cutouts[1].x > a.cutouts[1].x + 300, "swapSides flips camera and side slot horizontally");
});

test("all 4 outline modes compute valid non-overflowing geometry and URLs", () => {
  for (const mode of ["screen9x16", "screen16x9", "box", "card"]) {
    const geom = computeOutlineGeometry({ ...OUTLINE.defaults, mode });
    assert.ok(geom.width > 0 && geom.height > 0);
    for (const c of geom.cutouts) {
      assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= geom.width && c.y + c.h <= geom.height);
    }
    const url = outlineUrl("https://frills.valwidgets.live", { ...OUTLINE.defaults, mode });
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/overlay/outline/");
    assert.ok(parsed.searchParams.toString().length > 0);
  }
  assert.deepEqual(parseSocials("  TikTok @a | | Twitch /b "), ["TikTok @a", "Twitch /b"]);
});
