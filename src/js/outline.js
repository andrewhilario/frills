// Stream Outline & Border Designer (/outline/ & /overlay/outline/):
// Pure settings schema, TikTok-first Vertical 9:16 + 16:9 + Box geometry engine with switchable Side Slot
// (Transparent Widget Cutout, TikTok Gift Menu / Rewards, Commands & Rules, or Hidden Wide Cam), spacing/split/swap
// customization, TikTok LIVE UI safe-zone metrics, and Free vs. Frills Plus capability bounds.

import { defineWidget, chipsOf, imageOf, number, range, selectOf, text, toggle } from "./widget-settings.js";

export const FREE_ROW_LIMIT = 5;
export const PLUS_ROW_LIMIT = 10;
// Legacy aliases kept so existing imports stay compatible
export const FREE_AGENDA_LIMIT = FREE_ROW_LIMIT;
export const PLUS_AGENDA_LIMIT = PLUS_ROW_LIMIT;

export const OUTLINE_MODES = [
  ["screen9x16", "Vertical 9:16 (TikTok LIVE)"],
  ["screen16x9", "Full-Screen 16:9 (OBS / Twitch)"],
  ["box", "Webcam / VTuber Box"],
];

export const SIDE_MODES = [
  ["widget", "Transparent Widget Box (Chat / Jar / Wheel)"],
  ["gifts", "TikTok Gift Menu / Rewards"],
  ["info", "Commands & Rules Card"],
  ["none", "Hide (Expand Camera Full-Width)"],
];

export const BOX_ASPECTS = [
  ["16x9", "16:9 Widescreen"],
  ["4x3", "4:3 Classic"],
  ["1x1", "1:1 Square"],
  ["9x16", "9:16 Portrait / VTuber"],
  ["circle", "Circle portrait"],
  ["arch", "Arched window"],
];

export const LAYOUTS_9X16 = [
  ["tt-game-cam", "Game on Top + Cam & Side Slot"],
  ["tt-cam-top", "Cam / VTuber on Top + Gameplay"],
  ["tt-game-stack", "Full-Width Cam + Full-Width Game"],
  ["tt-vtuber", "VTuber / IRL Portrait Showcase"],
  ["tt-chat-focus", "Just Chatting + Split Widget / Info"],
  ["tt-split-cam", "Dual Co-Host / PK Split"],
  ["tt-perimeter", "Clean Full-Screen Perimeter"],
];

export const LAYOUTS_16X9 = [
  ["game-cam", "Gameplay + Cam & Side Slot"],
  ["just-chatting", "Just Chatting + Sidebar"],
  ["perimeter", "Full-Screen Perimeter Border"],
  ["dual-split", "Dual Co-Host / Collab Split"],
];

export const MAT_MODES = [
  ["gradient", "Soft tinted mat (Free)"],
  ["solid", "Solid color mat (Free)"],
  ["dots", "Polka dots mat (Free)"],
  ["grid", "Aesthetic grid mat (Free)"],
  ["stripes", "Pastel stripes mat (Free)"],
  ["wp-sakura", "Sakura sky watercolor (Free)"],
  ["wp-summer", "Summer fireworks watercolor (Free)"],
  ["wp-autumn", "Autumn leaves watercolor (Free)"],
  ["wp-winter", "Snowy pine watercolor (Free)"],
  ["stars", "Starry night mat (Plus)"],
  ["transparent", "Borders only · see-through (Free)"],
];

export const OUTLINE_BACKDROPS = Object.freeze({
  "wp-sakura": "/backdrops/sakura.webp",
  "wp-summer": "/backdrops/summer.webp",
  "wp-autumn": "/backdrops/autumn.webp",
  "wp-winter": "/backdrops/winter.webp",
});

export const LOWER_ZONES = [
  ["clear", "Clean (leave space for TikTok chat)"],
  ["fade", "Soft bottom fade (readable chat)"],
  ["card", "Framed TikTok Chat Box"],
];

export const FRAME_STYLES = [
  ["sticker", "Cozy Sticker (Free)"],
  ["clean", "Clean Minimal (Free)"],
  ["neon", "Neon Tube (Free)"],
  ["window", "Retro OS Window (Free)"],
  ["pixel", "8-Bit Arcade (Free)"],
  ["cyber", "Cyber Tactical HUD (Plus)"],
  ["celestial", "Celestial Filigree (Plus)"],
  ["scrapbook", "Scrapbook Washi (Plus)"],
  ["ribbon", "Plush Ribbon Kawaii (Plus)"],
];

export const FREE_FRAME_STYLES = Object.freeze(["sticker", "clean", "neon", "window", "pixel"]);
export const PLUS_FRAME_STYLES = Object.freeze(["cyber", "celestial", "scrapbook", "ribbon"]);

export const MOTION_STYLES = [
  ["breathe", "Breathing glow (Free)"],
  ["static", "Static · 0% GPU (Free)"],
  ["shimmer", "Soft sheen (Free)"],
  ["orbit", "Orbiting neon beam (Plus)"],
  ["gradient", "Flowing gradient (Plus)"],
  ["twinkle", "Twinkling stars (Plus)"],
];

export const FREE_MOTIONS = Object.freeze(["static", "breathe", "shimmer"]);
export const PLUS_MOTIONS = Object.freeze(["orbit", "gradient", "twinkle"]);

export const ART_PACKS = [
  ["none", "None"],
  ["frog2", "Frog pond"],
  ["neko", "Neko café"],
  ["hamster", "Hamster burrow"],
  ["bunny", "Bunny cloud"],
  ["shiba", "Shiba gamer"],
  ["capybara", "Chill capybara"],
  ["dino", "Retro dino"],
  ["astro", "Space bot"],
  ["skatecat", "Skate cat"],
  ["dragon", "RPG dragon"],
  ["sakura", "Sakura spring"],
  ["valentine", "Valentine café"],
  ["summer", "Summer matsuri"],
  ["autumn", "Cozy autumn"],
  ["anime-xmas", "Cozy winter"],
  ["anime-halloween", "Cozy witch"],
  ["halloween", "Halloween"],
  ["christmas", "Christmas"],
];

export const DECOR_POSITIONS = [
  ["corners", "Top-right peek + bottom-left"],
  ["flipped", "Top-left peek + bottom-right"],
  ["top", "Centered peeker on top edge"],
];

export const NAME_POSITIONS = [
  ["bottom", "Bottom bar"],
  ["top", "Top bar"],
];

export const CARD_STYLES = [
  ["cards", "Clean stacked cards (Free)"],
  ["pills", "Compact badge rows (Free)"],
  ["ticker", "Horizontal pill strip (Plus)"],
  ["quest", "RPG Loot / Quest board (Plus)"],
];

export const FREE_CARD_STYLES = Object.freeze(["cards", "pills"]);
export const PLUS_CARD_STYLES = Object.freeze(["ticker", "quest"]);

export const DEFAULT_GIFT_MENU = "🌹 Rose~Shoutout|🍩 Doughnut~10 Pushups|🐼 Panda~Spin Wheel|🌌 Galaxy~VIP + Follow";
export const DEFAULT_INFO_ITEMS = "!sr~Request a song|!clip~Save last 30s|♥ Rules~Be kind & have fun|🔔 Follow~Join the squad!";

export const OUTLINE = defineWidget({
  defaults: {
    mode: "screen9x16",
    boxAspect: "16x9",
    layout9: "tt-game-cam",
    layout16: "game-cam",
    sideMode: "widget",
    widgetSlotLabel: "CHAT / WIDGETS",
    topPad: 210,
    botPad: 460,
    sidePad: 48,
    splitPct: 52,
    swapSides: false,
    lowerZone: "fade",
    slot1Label: "",
    slot2Label: "",
    matMode: "gradient",
    matAlpha: 88,
    matImage: "",
    frameStyle: "sticker",
    strokeW: 6,
    motion: "breathe",
    artPack: "frog2",
    decorPos: "corners",
    decorScale: 100,
    customBadge: "",
    showBanner: true,
    bannerText: "COME HANG OUT · !SR FOR MUSIC",
    showPromo: true,
    promoText: "🌹 Rose = Shoutout · Tap screen for likes!",
    showName: true,
    handle: "@yourhandle",
    tagline: "LIVE · Come hang out!",
    socials: "",
    namePos: "bottom",
    liveBadge: true,
    cardTitle: "Gift Rewards",
    cardStyle: "cards",
    cardItems: DEFAULT_GIFT_MENU,
    highlightRow: -1,
    customBoxes: "",
  },
  controls: [
    // Mode & layout geometry
    { section: "mode", group: "Canvas & layout", ...chipsOf("mode", "Outline mode", OUTLINE_MODES) },
    { section: "mode", ...selectOf("layout9", "9:16 TikTok LIVE layout", LAYOUTS_9X16) },
    { section: "mode", ...selectOf("layout16", "16:9 scene layout", LAYOUTS_16X9) },
    { section: "mode", ...selectOf("boxAspect", "Box shape & aspect", BOX_ASPECTS) },
    { section: "mode", group: "Side slot content", ...selectOf("sideMode", "What goes in the side slot", SIDE_MODES, "Pick a transparent window for Frills Chat / Gift Jar / Wheel, a TikTok Gift Menu, a Commands & Rules card, or hide it for a full-width cam.") },
    { section: "mode", ...text("widgetSlotLabel", "Widget box label", 28, "Examples: CHAT / WIDGETS, GIFT JAR, SPIN WHEEL, TOP GIFTERS") },
    { section: "mode", group: "Spacing & proportions", ...range("topPad", "Top margin (TikTok host bar)", 40, 340, 10, "px", { hint: "210px clears TikTok's top profile pill. Lower to 40px for full-bleed OBS/Reels." }) },
    { section: "mode", ...range("botPad", "Bottom margin (TikTok chat)", 40, 560, 10, "px", { hint: "460px leaves room for TikTok LIVE's comment feed & gift tray." }) },
    { section: "mode", ...range("sidePad", "Side padding", 16, 96, 4, "px") },
    { section: "mode", ...range("splitPct", "Top vs. bottom split", 30, 70, 2, "%", { hint: "Adjusts how tall the upper gameplay/cam box is compared to the lower section." }) },
    { section: "mode", ...toggle("swapSides", "Swap left & right panels", "Flips camera and side slot (or co-host windows) horizontally.") },
    { section: "mode", ...selectOf("lowerZone", "TikTok bottom chat zone", LOWER_ZONES, "Styles the lower area where TikTok's native chat scrolls.") },
    { section: "mode", group: "Custom window titles", ...text("slot1Label", "Main window title (optional)", 28, "Shown on Retro Window / HUD headers (leave blank for default).") },
    { section: "mode", ...text("slot2Label", "Second window title (optional)", 28) },

    // Frame, backdrop & decor
    { section: "frame", group: "Border & motion", ...selectOf("frameStyle", "Frame style", FRAME_STYLES, "5 styles work free live; preview all 4 Frills Plus styles right here.") },
    { section: "frame", ...selectOf("motion", "Animation & glow", MOTION_STYLES) },
    { section: "frame", ...range("strokeW", "Border thickness", 2, 18, 1, "px") },
    { section: "frame", group: "Backdrop mat (outside cutouts)", ...selectOf("matMode", "Backdrop pattern", MAT_MODES, "Cutouts stay 100% transparent so your game, cam, and Frills widgets show through.") },
    { section: "frame", ...range("matAlpha", "Mat opacity", 0, 100, 5, "%") },
    { section: "frame", ...imageOf("matImage", "Custom wallpaper backdrop (Plus)", "Upload any cozy room or aesthetic image to sit behind your transparent cutouts (Frills Plus).") },
    { section: "frame", group: "Mascots & corner art", ...selectOf("artPack", "Corner mascot & sparkles", ART_PACKS, "Uses Frills' transparent illustration packs on your frame.") },
    { section: "frame", ...selectOf("decorPos", "Mascot placement", DECOR_POSITIONS) },
    { section: "frame", ...range("decorScale", "Mascot size", 60, 150, 5, "%") },
    { section: "frame", ...imageOf("customBadge", "Custom corner mascot / logo (Plus)", "Upload a transparent PNG/WebP to pin onto the frame corner (Frills Plus).") },

    // Branding & TikTok callouts
    { section: "brand", group: "TikTok header & gift callout", ...toggle("showBanner", "Show top stream title banner", "Helps FYP viewers know what your LIVE is about in 1 second.") },
    { section: "brand", ...text("bannerText", "Top banner text", 54) },
    { section: "brand", ...toggle("showPromo", "Show gift / tap callout strip", "Pin your gift menu, Rose challenge, or tap reminder right on the outline.") },
    { section: "brand", ...text("promoText", "Callout text", 64) },
    { section: "brand", group: "Channel nameplate", ...toggle("showName", "Show nameplate & status bar") },
    { section: "brand", ...text("handle", "Channel / @handle", 36) },
    { section: "brand", ...text("tagline", "Status line", 64) },
    { section: "brand", ...text("socials", "Rotating socials (Plus · separate with |)", 120, "Example: TikTok @you | Twitch /you | Discord .gg/you") },
    { section: "brand", ...chipsOf("namePos", "Nameplate edge", NAME_POSITIONS) },
    { section: "brand", ...toggle("liveBadge", "Show pulsing ● LIVE pill") },

    // Gift Menu / Commands Card panel
    { section: "card", group: "Gift Menu / Commands Card", ...text("cardTitle", "Card heading", 36) },
    { section: "card", ...selectOf("cardStyle", "Card layout style", CARD_STYLES) },
    { section: "card", ...text("cardItems", "Card rows (encoded)", 600), hidden: true },
    { section: "card", ...number("highlightRow", "Highlighted row index", -1, PLUS_ROW_LIMIT - 1), hidden: true },
    { section: "mode", ...text("customBoxes", "Custom box positions & sizes (Plus · encoded)", 700), hidden: true },
  ],
});

/** Clean one row field so delimiters (`|`, `~`) never break round-tripping. */
function cleanRowField(str, max) {
  return String(str ?? "")
    .replace(/[\u0000-\u001f\u007f|~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Parses `🌹 Rose~Shoutout|🌌 Galaxy~VIP` into `[{ label, value }]`, bounded by `limit`. */
export function parseCardRows(raw, { limit = PLUS_ROW_LIMIT } = {}) {
  const cap = Math.max(1, Math.min(PLUS_ROW_LIMIT, Math.round(Number(limit) || PLUS_ROW_LIMIT)));
  const items = [];
  for (const chunk of String(raw ?? "").split(/[|\n]+/)) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const tilde = trimmed.indexOf("~");
    const rawLabel = tilde >= 0 ? trimmed.slice(0, tilde) : trimmed;
    const rawValue = tilde >= 0 ? trimmed.slice(tilde + 1) : "";
    const label = cleanRowField(rawLabel, 28);
    const value = cleanRowField(rawValue, 38);
    if (!label && !value) continue;
    items.push({ label: label || value, value: label ? value : "" });
    if (items.length >= cap) break;
  }
  return items;
}

/** Encodes `[{ label, value }]` back into a compact URL-safe pipe string. */
export function encodeCardRows(items, { limit = PLUS_ROW_LIMIT } = {}) {
  const cap = Math.max(1, Math.min(PLUS_ROW_LIMIT, Math.round(Number(limit) || PLUS_ROW_LIMIT)));
  return (items ?? [])
    .map((it) => {
      const label = cleanRowField(typeof it === "string" ? it : (it?.label ?? it?.title), 28);
      const value = cleanRowField(typeof it === "string" ? "" : (it?.value ?? it?.time), 38);
      if (!label) return "";
      return value ? `${label}~${value}` : label;
    })
    .filter(Boolean)
    .slice(0, cap)
    .join("|");
}

/** Parses `TikTok @a | Twitch /a` into up to 5 rotating social chips. */
export function parseSocials(raw) {
  return String(raw ?? "")
    .split("|")
    .map((s) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 32))
    .filter(Boolean)
    .slice(0, 5);
}

export const isPlusFrameStyle = (style) => PLUS_FRAME_STYLES.includes(style);
export const isPlusMotion = (motion) => PLUS_MOTIONS.includes(motion);
export const isPlusCardStyle = (style) => PLUS_CARD_STYLES.includes(style);
export const isPlusMatMode = (matMode) => matMode === "stars";
export const hasSideCard = (s) => (s.mode === "screen9x16" || s.mode === "screen16x9") && (s.sideMode === "gifts" || s.sideMode === "info");

/** Allowed editable box IDs in `customBoxes` (`id:x,y,w,h|...`). */
const VALID_BOX_IDS = new Set(["game", "cam", "widget", "chat", "host1", "host2", "main", "card", "nameplate", "banner", "promo"]);
const STRIP_BOX_IDS = new Set(["nameplate", "banner", "promo"]);

/** Returns the minimum safe logical pixel size for editable box `id`. */
export function boxMinSize(id) {
  return STRIP_BOX_IDS.has(id) ? { minW: 200, minH: 38 } : { minW: 160, minH: 110 };
}

/** Clamps one `{ x, y, w, h }` box cleanly inside the logical SVG canvas (preserving square bounds for circles). */
export function clampBoxRect(id, rect, canvasW, canvasH, { shape = "rect" } = {}) {
  const margin = 8;
  const { minW, minH } = boxMinSize(id);
  const maxW = Math.max(minW, canvasW - margin * 2);
  const maxH = Math.max(minH, canvasH - margin * 2);
  let w = Math.max(minW, Math.min(maxW, Math.round(Number(rect?.w) || minW)));
  let h = Math.max(minH, Math.min(maxH, Math.round(Number(rect?.h) || minH)));
  if (shape === "circle") {
    const side = Math.max(minW, Math.min(maxW, maxH, Math.round((w + h) / 2)));
    w = side;
    h = side;
  }
  const x = Math.max(margin, Math.min(canvasW - w - margin, Math.round(Number(rect?.x) || margin)));
  const y = Math.max(margin, Math.min(canvasH - h - margin, Math.round(Number(rect?.y) || margin)));
  return { x, y, w, h };
}

/** Parses `game:48,260,984,540|cam:48,822,480,390` into `{ [id]: { x, y, w, h } }`. */
export function parseCustomBoxes(raw) {
  const out = {};
  for (const chunk of String(raw ?? "").split("|")) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const id = trimmed.slice(0, colon).trim();
    if (!VALID_BOX_IDS.has(id)) continue;
    const nums = trimmed.slice(colon + 1).split(",").map((n) => Math.round(Number(n)));
    if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) continue;
    const [x, y, w, h] = nums;
    if (w <= 0 || h <= 0) continue;
    out[id] = { x, y, w, h };
  }
  return out;
}

/** Encodes `{ [id]: { x, y, w, h } }` back into a compact URL-safe string. */
export function encodeCustomBoxes(map) {
  const parts = [];
  for (const [id, r] of Object.entries(map ?? {})) {
    if (!VALID_BOX_IDS.has(id) || !r) continue;
    const vals = [r.x, r.y, r.w, r.h].map((n) => Math.round(Number(n)));
    if (vals.some((n) => !Number.isFinite(n)) || vals[2] <= 0 || vals[3] <= 0) continue;
    parts.push(`${id}:${vals.join(",")}`);
  }
  return parts.join("|");
}

/** Lists every box on `geom` that can be selected, dragged, or resized in Frills Plus edit mode. */
export function listEditableBoxes(geom) {
  if (!geom) return [];
  const list = [];
  for (const c of geom.cutouts ?? []) {
    list.push({ id: c.id, label: c.label || c.id, x: c.x, y: c.y, w: c.w, h: c.h, shape: c.shape || "rect", kind: "cutout" });
  }
  if (geom.cardRect) {
    list.push({ id: "card", label: "Side Card", x: geom.cardRect.x, y: geom.cardRect.y, w: geom.cardRect.w, h: geom.cardRect.h, shape: "rect", kind: "card" });
  }
  if (geom.bannerRect) {
    list.push({ id: "banner", label: "Top Banner", x: geom.bannerRect.x, y: geom.bannerRect.y, w: geom.bannerRect.w, h: geom.bannerRect.h, shape: "rect", kind: "banner" });
  }
  if (geom.nameplateRect) {
    list.push({ id: "nameplate", label: "Nameplate", x: geom.nameplateRect.x, y: geom.nameplateRect.y, w: geom.nameplateRect.w, h: geom.nameplateRect.h, shape: "rect", kind: "nameplate" });
  }
  if (geom.promoRect) {
    list.push({ id: "promo", label: "Callout Strip", x: geom.promoRect.x, y: geom.promoRect.y, w: geom.promoRect.w, h: geom.promoRect.h, shape: "rect", kind: "promo" });
  }
  return list;
}

/** Lists all Frills Plus features currently selected in `settings` (for editor badges and subtle prompts). */
export function plusFeaturesUsed(settings) {
  const used = [];
  if (isPlusFrameStyle(settings.frameStyle)) used.push("collector frame style");
  if (isPlusMotion(settings.motion)) used.push("animated border motion");
  if (isPlusMatMode(settings.matMode)) used.push("starry backdrop");
  if (settings.matImage) used.push("custom wallpaper backdrop");
  if (Object.keys(parseCustomBoxes(settings.customBoxes)).length > 0) used.push("custom box resize & placement");
  if (hasSideCard(settings)) {
    if (isPlusCardStyle(settings.cardStyle)) used.push("Plus card layout");
    if (parseCardRows(settings.cardItems, { limit: PLUS_ROW_LIMIT }).length > FREE_ROW_LIMIT) {
      used.push(`more than ${FREE_ROW_LIMIT} card rows`);
    }
  }
  if (settings.customBadge) used.push("custom corner mascot");
  if (parseSocials(settings.socials).length > 0) used.push("rotating socials");
  return used;
}

/**
 * Resolves the effective settings for rendering.
 * - When `plusActive` is true (or `previewAll` is true in the editor), every Plus feature renders at full fidelity.
 * - On Free direct links (`plusActive: false, previewAll: false`), Plus-only picks gracefully fall back to clean Free defaults.
 */
export function effectiveOutlineSettings(rawSettings, { plusActive = false, previewAll = false } = {}) {
  const s = OUTLINE.sanitize(rawSettings);
  const allowPlus = Boolean(plusActive || previewAll);
  const frameStyle = allowPlus || !isPlusFrameStyle(s.frameStyle) ? s.frameStyle : "sticker";
  const motion = allowPlus || !isPlusMotion(s.motion) ? s.motion : "breathe";
  const matMode = allowPlus || !isPlusMatMode(s.matMode) ? s.matMode : "gradient";
  const cardStyle = allowPlus || !isPlusCardStyle(s.cardStyle) ? s.cardStyle : "cards";
  const limit = allowPlus ? PLUS_ROW_LIMIT : FREE_ROW_LIMIT;
  const rows = parseCardRows(s.cardItems, { limit });
  const rawHi = Math.round(Number(s.highlightRow));
  const highlightRow = Number.isFinite(rawHi) && rawHi >= 0 && rawHi < rows.length ? rawHi : -1;
  const socials = allowPlus ? parseSocials(s.socials) : [];
  const customBadge = allowPlus ? s.customBadge : "";
  const matImage = allowPlus ? s.matImage : "";
  const customBoxes = allowPlus ? encodeCustomBoxes(parseCustomBoxes(s.customBoxes)) : "";
  return {
    ...s,
    frameStyle,
    motion,
    matMode,
    cardStyle,
    rows,
    highlightRow,
    socials,
    customBadge,
    matImage,
    customBoxes,
    plusUnlocked: allowPlus,
  };
}

/** TikTok LIVE 9:16 (1080×1920) native UI occlusion regions, used for the editor-only safe-zone guide. */
export const TIKTOK_SAFE_ZONES = Object.freeze({
  width: 1080,
  height: 1920,
  topBar: { x: 0, y: 0, w: 1080, h: 200, label: "TikTok LIVE Host & Viewer Bar" },
  bottomChat: { x: 0, y: 1460, w: 1080, h: 460, label: "TikTok LIVE Chat & Gift Tray" },
  safeRect: { x: 40, y: 204, w: 1000, h: 1252 },
});

/** Applies validated Frills Plus `customBoxes` overrides on top of preset layout geometry. */
function applyCustomBoxes(geom, rawOverrides) {
  const overrides = parseCustomBoxes(rawOverrides);
  if (Object.keys(overrides).length === 0) return geom;
  const cutouts = geom.cutouts.map((c) => {
    const ov = overrides[c.id];
    if (!ov) return c;
    return { ...c, ...clampBoxRect(c.id, ov, geom.width, geom.height, { shape: c.shape }) };
  });
  let cardRect = geom.cardRect;
  if (cardRect && overrides.card) {
    const next = clampBoxRect("card", overrides.card, geom.width, geom.height);
    cardRect = { ...cardRect, ...next, compact: next.w > next.h * 2.4 };
  }
  const bannerRect = geom.bannerRect && overrides.banner
    ? { ...geom.bannerRect, ...clampBoxRect("banner", overrides.banner, geom.width, geom.height) }
    : geom.bannerRect;
  const nameplateRect = geom.nameplateRect && overrides.nameplate
    ? { ...geom.nameplateRect, ...clampBoxRect("nameplate", overrides.nameplate, geom.width, geom.height) }
    : geom.nameplateRect;
  const promoRect = geom.promoRect && overrides.promo
    ? { ...geom.promoRect, ...clampBoxRect("promo", overrides.promo, geom.width, geom.height) }
    : geom.promoRect;
  const anchorId = geom.decorAnchor?.id;
  const decorAnchor = anchorId ? (cutouts.find((c) => c.id === anchorId) || geom.decorAnchor) : geom.decorAnchor;
  return { ...geom, cutouts, cardRect, bannerRect, nameplateRect, promoRect, decorAnchor };
}

/**
 * Computes the logical SVG canvas dimensions (`width`, `height`), transparent `cutouts` (including the
 * transparent Widget Box cutout when `sideMode === "widget"`), optional `cardRect` (when `sideMode` is
 * `"gifts"` or `"info"`), `nameplateRect`, `bannerRect`, `promoRect`, and `lowerChatRect`.
 */
export function computeOutlineGeometry(settings) {
  return applyCustomBoxes(computeBaseOutlineGeometry(settings), settings?.customBoxes);
}

function computeBaseOutlineGeometry(settings) {
  const rawMode = settings.mode || "screen9x16";
  const mode = rawMode === "screen16x9" || rawMode === "box" ? rawMode : "screen9x16";
  const sideMode = settings.sideMode || "widget";
  const sideIsWidget = sideMode === "widget";
  const sideIsCard = sideMode === "gifts" || sideMode === "info";
  const hasSide = sideIsWidget || sideIsCard;
  const showName = Boolean(settings.showName);
  const lbl1 = (fallback) => String(settings.slot1Label || "").trim() || fallback;
  const lbl2 = (fallback) => String(settings.slot2Label || "").trim() || fallback;
  const widgetLbl = String(settings.widgetSlotLabel || "").trim() || "CHAT / WIDGETS";

  if (mode === "box") {
    const dims = {
      "16x9": [1280, 720],
      "4x3": [1024, 768],
      "1x1": [900, 900],
      "9x16": [720, 1280],
      circle: [900, 900],
      arch: [840, 1080],
    }[settings.boxAspect] ?? [1280, 720];
    const [width, height] = dims;
    const pad = Math.max(20, Math.min(72, Math.round(Number(settings.sidePad) || 34)));
    const shape = settings.boxAspect === "circle" ? "circle" : settings.boxAspect === "arch" ? "arch" : "rect";
    const hole = {
      id: "cam",
      label: lbl1("Camera / VTuber"),
      x: pad,
      y: pad,
      w: width - pad * 2,
      h: height - pad * 2,
      shape,
      primary: true,
    };
    const npW = Math.min(540, Math.round(hole.w * 0.72));
    const npH = 74;
    const nameplateRect = showName
      ? {
          x: Math.round((width - npW) / 2),
          y: settings.namePos === "top" ? Math.max(8, hole.y - 12) : Math.min(height - npH - 8, hole.y + hole.h - npH + 14),
          w: npW,
          h: npH,
        }
      : null;
    return {
      mode,
      width,
      height,
      hasMat: false,
      cutouts: [hole],
      cardRect: null,
      nameplateRect,
      bannerRect: null,
      promoRect: null,
      lowerChatRect: null,
      decorAnchor: hole,
    };
  }

  if (mode === "screen9x16") {
    const width = 1080;
    const height = 1920;
    const layout = settings.layout9 || "tt-game-cam";
    const padX = Math.max(16, Math.min(96, Math.round(Number(settings.sidePad) || 48)));
    const innerW = width - padX * 2;
    const topY0 = Math.max(40, Math.min(340, Math.round(Number(settings.topPad) || 210)));
    const botPad = Math.max(40, Math.min(560, Math.round(Number(settings.botPad) || 460)));
    const split = Math.max(30, Math.min(70, Math.round(Number(settings.splitPct) || 52))) / 100;
    const swap = Boolean(settings.swapSides);
    const gap = 22;

    const showBanner = Boolean(settings.showBanner && String(settings.bannerText || "").trim());
    const showPromo = Boolean(settings.showPromo && String(settings.promoText || "").trim());
    const nameTop = showName && settings.namePos === "top";
    const nameBot = showName && settings.namePos === "bottom";

    const bannerH = showBanner ? 60 : 0;
    const promoH = showPromo ? 54 : 0;
    const nameH = showName ? 82 : 0;

    let cursorTop = topY0;
    let cursorBot = height - botPad;

    let bannerRect = null;
    if (showBanner) {
      bannerRect = { x: padX, y: cursorTop, w: innerW, h: bannerH };
      cursorTop += bannerH + 16;
    }

    let nameplateRect = null;
    if (nameTop) {
      nameplateRect = { x: padX, y: cursorTop, w: innerW, h: nameH };
      cursorTop += nameH + 18;
    }

    let promoRect = null;
    if (showPromo) {
      cursorBot -= promoH;
      promoRect = { x: padX, y: cursorBot, w: innerW, h: promoH };
      cursorBot -= 16;
    }

    if (nameBot) {
      cursorBot -= nameH;
      nameplateRect = { x: padX, y: cursorBot, w: innerW, h: nameH };
      cursorBot -= 18;
    }

    const bodyY = cursorTop;
    const bodyH = Math.max(360, cursorBot - cursorTop);

    const lowerChatRect = botPad >= 220 && settings.lowerZone !== "clear"
      ? { x: padX, y: height - botPad + 22, w: innerW, h: Math.max(160, botPad - 54), style: settings.lowerZone }
      : null;

    if (layout === "tt-perimeter") {
      const hole = { id: "main", label: lbl1("Vertical Stream"), x: padX, y: bodyY, w: innerW, h: bodyH, shape: "rect", primary: true };
      const barW = Math.max(400, innerW - 40);
      const barX = Math.round((width - barW) / 2);
      const cardRect = sideIsCard ? { x: barX, y: bodyY + bodyH - 156, w: barW, h: 136, compact: true } : null;
      return { mode, width, height, hasMat: false, cutouts: [hole], cardRect, nameplateRect, bannerRect, promoRect, lowerChatRect, decorAnchor: hole };
    }

    if (layout === "tt-vtuber") {
      const extraH = hasSide ? Math.min(230, Math.round(bodyH * 0.25)) : 0;
      const camH = Math.max(280, bodyH - extraH - (extraH ? gap : 0));
      const cam = { id: "cam", label: lbl1("VTuber / Portrait Cam"), x: padX, y: bodyY, w: innerW, h: camH, shape: "rect", primary: true };
      const extraBox = { x: padX, y: cam.y + cam.h + gap, w: innerW, h: extraH };
      const cutouts = sideIsWidget
        ? [cam, { id: "widget", label: widgetLbl, ...extraBox, shape: "rect", primary: false, isWidgetSlot: true }]
        : [cam];
      const cardRect = sideIsCard ? { ...extraBox, compact: true } : null;
      return { mode, width, height, hasMat: true, cutouts, cardRect, nameplateRect, bannerRect, promoRect, lowerChatRect, decorAnchor: cam };
    }

    if (layout === "tt-chat-focus") {
      const camH = Math.max(240, Math.round((bodyH - gap) * split));
      const lowerY = bodyY + camH + gap;
      const lowerH = Math.max(160, bodyH - camH - gap);
      const cam = { id: "cam", label: lbl1("Just Chatting / Cam"), x: padX, y: bodyY, w: innerW, h: camH, shape: "rect", primary: true };
      const leftW = hasSide ? Math.round((innerW - gap) * 0.5) : innerW;
      const rightW = innerW - leftW - gap;
      const chatBox = {
        id: "chat",
        label: lbl2("Chat Box"),
        x: hasSide && swap ? padX + rightW + gap : padX,
        y: lowerY,
        w: leftW,
        h: lowerH,
        shape: "rect",
        primary: false,
      };
      const sideBox = { x: swap ? padX : padX + leftW + gap, y: lowerY, w: rightW, h: lowerH };
      const cutouts = sideIsWidget
        ? [cam, chatBox, { id: "widget", label: widgetLbl, ...sideBox, shape: "rect", primary: false, isWidgetSlot: true }]
        : [cam, chatBox];
      const cardRect = sideIsCard ? { ...sideBox, compact: false } : null;
      return { mode, width, height, hasMat: true, cutouts, cardRect, nameplateRect, bannerRect, promoRect, lowerChatRect, decorAnchor: cam };
    }

    if (layout === "tt-split-cam") {
      const extraH = hasSide ? Math.min(184, Math.round(bodyH * 0.22)) : 0;
      const splitH = Math.max(240, bodyH - extraH - (extraH ? gap : 0));
      const colW = Math.floor((innerW - gap) / 2);
      const col2W = innerW - colW - gap;
      const left = { id: "host1", label: lbl1("Host / Cam 1"), x: swap ? padX + colW + gap : padX, y: bodyY, w: swap ? col2W : colW, h: splitH, shape: "rect", primary: true };
      const right = { id: "host2", label: lbl2("Co-Host / PK"), x: swap ? padX : padX + colW + gap, y: bodyY, w: swap ? colW : col2W, h: splitH, shape: "rect", primary: false };
      const extraBox = { x: padX, y: bodyY + splitH + gap, w: innerW, h: extraH };
      const cutouts = sideIsWidget
        ? [left, right, { id: "widget", label: widgetLbl, ...extraBox, shape: "rect", primary: false, isWidgetSlot: true }]
        : [left, right];
      const cardRect = sideIsCard ? { ...extraBox, compact: true } : null;
      return { mode, width, height, hasMat: true, cutouts, cardRect, nameplateRect, bannerRect, promoRect, lowerChatRect, decorAnchor: swap ? right : left };
    }

    if (layout === "tt-game-stack") {
      const extraH = hasSide ? Math.min(168, Math.round(bodyH * 0.2)) : 0;
      const availH = Math.max(280, bodyH - extraH - (extraH ? gap : 0));
      const topH = Math.max(150, Math.round((availH - gap) * split));
      const botH = Math.max(150, availH - topH - gap);
      const topBox = { id: "cam", label: lbl1("Camera / VTuber"), x: padX, y: bodyY, w: innerW, h: topH, shape: "rect", primary: true };
      const botBox = { id: "game", label: lbl2("Full-Width Gameplay"), x: padX, y: bodyY + topH + gap, w: innerW, h: botH, shape: "rect", primary: false };
      const extraBox = { x: padX, y: botBox.y + botBox.h + gap, w: innerW, h: extraH };
      const cutouts = sideIsWidget
        ? [topBox, botBox, { id: "widget", label: widgetLbl, ...extraBox, shape: "rect", primary: false, isWidgetSlot: true }]
        : [topBox, botBox];
      const cardRect = sideIsCard ? { ...extraBox, compact: true } : null;
      return { mode, width, height, hasMat: true, cutouts, cardRect, nameplateRect, bannerRect, promoRect, lowerChatRect, decorAnchor: topBox };
    }

    if (layout === "tt-cam-top") {
      const topH = Math.max(200, Math.round((bodyH - gap) * split));
      const gameY = bodyY + topH + gap;
      const gameH = Math.max(200, bodyH - topH - gap);
      const camW = hasSide ? Math.round((innerW - gap) * 0.48) : innerW;
      const sideW = innerW - camW - gap;
      const cam = { id: "cam", label: lbl1("Camera / VTuber"), x: hasSide && swap ? padX + sideW + gap : padX, y: bodyY, w: camW, h: topH, shape: "rect", primary: true };
      const sideBox = { x: swap ? padX : padX + camW + gap, y: bodyY, w: sideW, h: topH };
      const game = { id: "game", label: lbl2("Gameplay"), x: padX, y: gameY, w: innerW, h: gameH, shape: "rect", primary: false };
      const cutouts = sideIsWidget
        ? [cam, { id: "widget", label: widgetLbl, ...sideBox, shape: "rect", primary: false, isWidgetSlot: true }, game]
        : [cam, game];
      const cardRect = sideIsCard ? { ...sideBox, compact: false } : null;
      return { mode, width, height, hasMat: true, cutouts, cardRect, nameplateRect, bannerRect, promoRect, lowerChatRect, decorAnchor: cam };
    }

    // Default: tt-game-cam — Centered 16:9 gameplay on top + cam & switchable side slot below
    const gameH = Math.max(220, Math.round((bodyH - gap) * split));
    const lowerY = bodyY + gameH + gap;
    const lowerH = Math.max(180, bodyH - gameH - gap);
    const game = { id: "game", label: lbl1("16:9 Gameplay"), x: padX, y: bodyY, w: innerW, h: gameH, shape: "rect", primary: true };
    const camW = hasSide ? Math.round((innerW - gap) * 0.48) : innerW;
    const sideW = innerW - camW - gap;
    const cam = {
      id: "cam",
      label: lbl2("Camera / VTuber"),
      x: hasSide && swap ? padX + sideW + gap : padX,
      y: lowerY,
      w: camW,
      h: lowerH,
      shape: "rect",
      primary: false,
    };
    const sideBox = { x: swap ? padX : padX + camW + gap, y: lowerY, w: sideW, h: lowerH };
    const cutouts = sideIsWidget
      ? [game, cam, { id: "widget", label: widgetLbl, ...sideBox, shape: "rect", primary: false, isWidgetSlot: true }]
      : [game, cam];
    const cardRect = sideIsCard ? { ...sideBox, compact: false } : null;
    return { mode, width, height, hasMat: true, cutouts, cardRect, nameplateRect, bannerRect, promoRect, lowerChatRect, decorAnchor: game };
  }

  // screen16x9 (1920 × 1080)
  const width = 1920;
  const height = 1080;
  const layout = settings.layout16 || "game-cam";
  const padX = Math.max(20, Math.min(84, Math.round(Number(settings.sidePad) || 40)));
  const innerW = width - padX * 2;
  const swap = Boolean(settings.swapSides);
  const gap = 28;
  const showBanner = Boolean(settings.showBanner && String(settings.bannerText || "").trim());
  const showPromo = Boolean(settings.showPromo && String(settings.promoText || "").trim());
  const nameTop = showName && settings.namePos === "top";
  const nameBot = showName && settings.namePos === "bottom";

  let topY = 30;
  let botY = height - 30;
  let bannerRect = null;
  let promoRect = null;
  let nameplateRect = null;

  if (showBanner && layout !== "perimeter") {
    bannerRect = { x: padX, y: topY, w: innerW, h: 52 };
    topY += 66;
  }
  if (nameTop) {
    nameplateRect = { x: layout === "perimeter" ? 64 : padX, y: topY, w: layout === "perimeter" ? 640 : innerW, h: 78 };
    if (layout !== "perimeter") topY += 94;
  }
  if (showPromo && layout !== "perimeter") {
    botY -= 48;
    promoRect = { x: padX, y: botY, w: innerW, h: 48 };
    botY -= 14;
  }
  if (nameBot) {
    if (layout === "perimeter") {
      nameplateRect = { x: 64, y: height - 118, w: 640, h: 80 };
    } else {
      botY -= 78;
      nameplateRect = { x: padX, y: botY, w: innerW, h: 78 };
      botY -= 16;
    }
  }
  const bodyH = Math.max(420, botY - topY);

  if (layout === "perimeter") {
    const hole = { id: "main", label: lbl1("Full Screen"), x: 26, y: 26, w: 1868, h: 1028, shape: "rect", primary: true };
    const cardRect = sideIsCard ? { x: swap ? 58 : 1446, y: 64, w: 416, h: 360, compact: false } : null;
    return {
      mode,
      width,
      height,
      hasMat: false,
      cutouts: [hole],
      cardRect,
      nameplateRect,
      bannerRect: showBanner ? { x: Math.round((width - 760) / 2), y: 42, w: 760, h: 52 } : null,
      promoRect: showPromo ? { x: 1220, y: 970, w: 636, h: 52 } : null,
      lowerChatRect: null,
      decorAnchor: hole,
    };
  }

  if (layout === "just-chatting") {
    const sideW = 472;
    const camW = innerW - sideW - gap;
    const camX = swap ? padX + sideW + gap : padX;
    const sideX = swap ? padX : padX + camW + gap;
    const cam = { id: "cam", label: lbl1("Main Camera / VTuber"), x: camX, y: topY, w: camW, h: bodyH, shape: "rect", primary: true };
    const upperH = hasSide ? Math.round(bodyH * 0.48) : 0;
    const chatY = hasSide ? topY + upperH + gap : topY;
    const chatH = bodyH - (hasSide ? upperH + gap : 0);
    const chat = { id: "chat", label: lbl2("Chat Area"), x: sideX, y: chatY, w: sideW, h: chatH, shape: "rect", primary: false };
    const topSlot = { x: sideX, y: topY, w: sideW, h: upperH };
    const cutouts = sideIsWidget
      ? [cam, { id: "widget", label: widgetLbl, ...topSlot, shape: "rect", primary: false, isWidgetSlot: true }, chat]
      : [cam, chat];
    const cardRect = sideIsCard ? { ...topSlot, compact: false } : null;
    return { mode, width, height, hasMat: true, cutouts, cardRect, nameplateRect, bannerRect, promoRect, lowerChatRect: null, decorAnchor: cam };
  }

  if (layout === "dual-split") {
    const extraH = hasSide ? 148 : 0;
    const slotH = bodyH - (extraH ? extraH + 22 : 0);
    const colW = Math.floor((innerW - gap) / 2);
    const col2W = innerW - colW - gap;
    const left = { id: "host1", label: lbl1("Host / Gameplay"), x: swap ? padX + colW + gap : padX, y: topY, w: swap ? col2W : colW, h: slotH, shape: "rect", primary: true };
    const right = { id: "host2", label: lbl2("Co-Host / Cam"), x: swap ? padX : padX + colW + gap, y: topY, w: swap ? colW : col2W, h: slotH, shape: "rect", primary: false };
    const extraBox = { x: padX, y: topY + slotH + 22, w: innerW, h: extraH };
    const cutouts = sideIsWidget
      ? [left, right, { id: "widget", label: widgetLbl, ...extraBox, shape: "rect", primary: false, isWidgetSlot: true }]
      : [left, right];
    const cardRect = sideIsCard ? { ...extraBox, compact: true } : null;
    return { mode, width, height, hasMat: true, cutouts, cardRect, nameplateRect, bannerRect, promoRect, lowerChatRect: null, decorAnchor: swap ? right : left };
  }

  // Default: game-cam (16:9 gameplay cutout + sidebar cam & switchable side slot)
  const sideW = 412;
  const gameW = innerW - sideW - gap;
  const gameX = swap ? padX + sideW + gap : padX;
  const sideX = swap ? padX : padX + gameW + gap;
  const game = { id: "game", label: lbl1("16:9 Gameplay"), x: gameX, y: topY, w: gameW, h: bodyH, shape: "rect", primary: true };
  const camH = hasSide ? Math.round(bodyH * 0.38) : bodyH;
  const cam = { id: "cam", label: lbl2("Camera / VTuber"), x: sideX, y: topY, w: sideW, h: camH, shape: "rect", primary: false };
  const lowerY = topY + camH + gap;
  const lowerH = bodyH - camH - gap;
  const lowerBox = { x: sideX, y: lowerY, w: sideW, h: lowerH };
  const cutouts = sideIsWidget
    ? [game, cam, { id: "widget", label: widgetLbl, ...lowerBox, shape: "rect", primary: false, isWidgetSlot: true }]
    : [game, cam];
  const cardRect = sideIsCard ? { ...lowerBox, compact: false } : null;
  return { mode, width, height, hasMat: true, cutouts, cardRect, nameplateRect, bannerRect, promoRect, lowerChatRect: null, decorAnchor: game };
}

/** Builds the direct Browser Source URL for `/overlay/outline/`. Always carries a non-empty query so cloud save works with zero channel input. */
export function outlineUrl(origin, settings) {
  const clean = OUTLINE.sanitize(settings);
  const params = OUTLINE.toParams(clean);
  if (!params.has("mode")) params.set("mode", clean.mode);
  return `${origin}/overlay/outline/?${params.toString()}`;
}
