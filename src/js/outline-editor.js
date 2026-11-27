// Stream Outline & Border Designer editor (/outline/):
// Purely visual (no channel or relay required), TikTok-first 9:16 + 16:9 + Webcam Box,
// switchable Side Slot (Transparent Widget Box, Gift Menu, Commands & Rules, or Hidden Wide Cam),
// TikTok LIVE safe-zone toggle, client-side transparent PNG exporter (1080p Free / 4K Plus), and Frills Plus cloud sync.

import { currentLook, looksFor } from "./widget-settings.js";
import { activeSeason } from "./season.js";
import { buildControl, chips, copyButton } from "./ui.js";
import { fontsReady, generalFaces } from "./look.js";
import { luminance } from "./color.js";
import { mountMediaPicker } from "./alerts-media.js";
import { mountCloudSave } from "./cloud-save.js";
import { mountEditorMode } from "./editor-mode.js";
import { mountSizeGuide } from "./size-guide.js";
import { closePlusModal, openPlusModal } from "./plus-modal.js";
import { loadPlatformPref } from "./platform-pref.js";
import { loadMatchaProfile, matchaDefaultsFor } from "./matcha-bridge.js";
import {
  DEFAULT_GIFT_MENU,
  DEFAULT_INFO_ITEMS,
  FREE_ROW_LIMIT,
  OUTLINE,
  PLUS_ROW_LIMIT,
  clampBoxRect,
  computeOutlineGeometry,
  encodeCardRows,
  encodeCustomBoxes,
  hasSideCard,
  isPlusCardStyle,
  isPlusFrameStyle,
  isPlusMatMode,
  isPlusMotion,
  listEditableBoxes,
  outlineUrl,
  parseCardRows,
  parseCustomBoxes,
  plusFeaturesUsed,
} from "./outline.js";
import { createOutlineView } from "./outline-view.js";
import { downloadBlob, exportOutlinePng } from "./outline-export.js";

const $ = (id) => document.getElementById(id);
const MATCHA = $("main")?.dataset.mode === "matcha";
const STORE_KEY = MATCHA ? "frills:outline:matcha:v2" : "frills:outline:editor:v2";
const BC_NAME = MATCHA ? "frills:outline:matcha:live" : "frills:outline:live";
const LOOK_FILTER_HIDE = new Set(["deco", "size", "letterSpacing", "align", "border"]);

const params = new URLSearchParams(location.search);
const loadSaved = () => {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? "null"); } catch { return null; }
};
const saved = loadSaved();
const pref = loadPlatformPref();
const matchaBase = MATCHA ? matchaDefaultsFor("outline", loadMatchaProfile()) : null;
const urlOutline = OUTLINE.fromParams(params);
const defaultMode = !MATCHA && !saved?.settings && !urlOutline.mode && pref.platform === "twitch" ? { mode: "screen16x9" } : {};
let settings = OUTLINE.sanitize({ ...(matchaBase ?? {}), ...defaultMode, ...saved?.settings, ...urlOutline });
let plusActive = false;
let plusEligible = false;
let plusChecked = false;
let showSafeZones = false;
let showCutoutHints = true;
let editBoxes = false;
let selectedBox = "";

const OUTLINE_PLUS_PERKS = [
  { lead: "Drag & resize any box", text: "Move or resize cutouts, cards, and banners with 8 handles, snapping, and exact px inputs." },
  { lead: "Collector styles & backdrops", text: "Cyber HUD, Celestial Filigree, Scrapbook Washi, Plush Ribbon, animated glows, starry mats, and custom art." },
  { lead: "10-row cards, socials & 4K PNG", text: "Up to 10 Gift Rewards rows, Plus card layouts, rotating socials, 4K PNG export, and /o/… cloud links." },
];

function openOutlinePlusModal(title, summary) {
  openPlusModal({
    title,
    summary,
    perks: OUTLINE_PLUS_PERKS,
    moment: "outline_plus",
    eligible: plusEligible,
    checked: plusChecked,
  });
}

let liveChannel = null;
try {
  if (typeof BroadcastChannel === "function") liveChannel = new BroadcastChannel(BC_NAME);
} catch { /* ignore */ }

const previewEl = $("preview");
const backdropSel = $("backdrop");
if (backdropSel && previewEl) {
  backdropSel.addEventListener("change", () => {
    previewEl.dataset.back = backdropSel.value;
  });
}

const view = createOutlineView($("widget"), {
  previewAll: false,
  editorOnly: true,
  onRowClick: (idx) => toggleHighlightRow(idx),
  onSelectBox: (id) => {
    if (!plusActive) return;
    if (selectedBox !== id) {
      selectedBox = id;
      paint();
    }
  },
  onBoxChange: (id, rect) => {
    if (!plusActive) return;
    selectedBox = id;
    const map = parseCustomBoxes(settings.customBoxes);
    map[id] = rect;
    settings.customBoxes = encodeCustomBoxes(map);
    paint();
  },
  onBoxCommit: () => {
    if (!plusActive) return;
    saveLocal();
    paint();
  },
});

const writers = {};
const rowsByKey = new Map();
const groupHeadings = [];
let lookChips = null;
const editorMode = mountEditorMode({
  kind: "outline",
  onChange: () => {
    if (rowsByKey.size) syncVisibility();
  },
});

function saveLocal() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ settings }));
  } catch { /* storage full */ }
}

function broadcastHighlight(row) {
  try {
    localStorage.setItem("frills:outline:step:local", String(row));
    liveChannel?.postMessage({ type: "highlight", row });
  } catch { /* ignore */ }
}

function syncVisibility() {
  const m = settings.mode;
  const is9 = m === "screen9x16";
  const is16 = m === "screen16x9";
  const isBox = m === "box";
  const cardOn = hasSideCard(settings);
  const sideIsWidget = !isBox && settings.sideMode === "widget";
  const setHidden = (key, hide) => {
    const row = rowsByKey.get(key);
    if (row) row.hidden = hide;
  };
  setHidden("boxAspect", !isBox);
  setHidden("layout16", !is16);
  setHidden("layout9", !is9);

  // Side slot selector & widget cutout label
  const hasSideSlotOption = is9 || is16;
  setHidden("sideMode", !hasSideSlotOption);
  setHidden("widgetSlotLabel", !sideIsWidget);

  // Spacing & split customization controls
  setHidden("topPad", !is9);
  setHidden("botPad", !is9);
  setHidden("sidePad", false);
  const hasSplit = is9 && !["tt-perimeter", "tt-vtuber", "tt-split-cam"].includes(settings.layout9);
  setHidden("splitPct", !hasSplit);
  const canSwap = (is9 && ["tt-game-cam", "tt-cam-top", "tt-chat-focus", "tt-split-cam"].includes(settings.layout9))
    || (is16 && settings.layout16 !== "perimeter");
  setHidden("swapSides", !canSwap);
  setHidden("lowerZone", !is9 || settings.botPad < 220);

  // Custom window labels
  const geom = computeOutlineGeometry(settings);
  setHidden("slot1Label", geom.cutouts.length < 1);
  setHidden("slot2Label", geom.cutouts.filter((c) => !c.isWidgetSlot).length < 2);

  // Backdrop mat & wallpaper controls
  const hasMat = is16 || is9;
  setHidden("matMode", !hasMat);
  setHidden("matAlpha", !hasMat || settings.matMode === "transparent");
  setHidden("matImage", !hasMat || settings.matMode === "transparent");

  // Decor positioning & sizing
  const hasDecor = (settings.artPack && settings.artPack !== "none") || Boolean(settings.customBadge);
  setHidden("decorPos", !hasDecor);
  setHidden("decorScale", !hasDecor);

  // Header banner, gift callout & nameplate
  const showExtras = is9 || is16;
  setHidden("showBanner", !showExtras);
  setHidden("bannerText", !showExtras || !settings.showBanner);
  setHidden("showPromo", !showExtras);
  setHidden("promoText", !showExtras || !settings.showPromo);

  setHidden("showName", false);
  setHidden("handle", !settings.showName);
  setHidden("tagline", !settings.showName);
  setHidden("socials", !settings.showName);
  setHidden("namePos", !settings.showName);
  setHidden("liveBadge", !settings.showName);

  // Gift Menu / Commands card controls
  setHidden("cardTitle", !cardOn);
  setHidden("cardStyle", !cardOn);
  const builder = $("ol-card-builder");
  if (builder) builder.hidden = !cardOn;

  for (const { el, keys } of groupHeadings) {
    const simple = editorMode.isSimple();
    el.hidden = keys.every((k) => {
      const row = rowsByKey.get(k);
      if (!row || row.hidden) return true;
      return simple && row.classList.contains("ed-adv");
    });
  }

  const ttPresets = $("ol-tt-presets");
  if (ttPresets) ttPresets.hidden = !is9;

  const safeBtn = $("ol-safe-toggle");
  if (safeBtn) {
    safeBtn.hidden = !is9;
    safeBtn.setAttribute("aria-pressed", String(showSafeZones && is9));
  }
  const hintsBtn = $("ol-hints-toggle");
  if (hintsBtn) {
    hintsBtn.hidden = false;
    hintsBtn.setAttribute("aria-pressed", String(showCutoutHints));
  }
  if (!plusActive && editBoxes) editBoxes = false;
  const editOn = plusActive && editBoxes;
  const editBtn = $("ol-edit-toggle");
  if (editBtn) {
    editBtn.setAttribute("aria-pressed", String(editOn));
  }
  const hasCustomBoxes = plusActive && Object.keys(parseCustomBoxes(settings.customBoxes)).length > 0;
  const resetBoxesBtn = $("ol-reset-boxes");
  if (resetBoxesBtn) resetBoxesBtn.hidden = !hasCustomBoxes;
  const boxInspector = $("ol-box-inspector");
  if (boxInspector) boxInspector.hidden = !editOn;
  const prevBtn = $("ol-prev-step");
  const nextBtn = $("ol-next-step");
  if (prevBtn) prevBtn.hidden = !cardOn;
  if (nextBtn) nextBtn.hidden = !cardOn;

  const okWrap = $("media-ok-wrap");
  if (okWrap) okWrap.hidden = false;
}

function syncBoxInspector() {
  const inspector = $("ol-box-inspector");
  if (!inspector) return;
  const geom = computeOutlineGeometry(settings);
  const boxes = listEditableBoxes(geom);
  if (!boxes.length) {
    selectedBox = "";
    return;
  }
  if (!boxes.some((b) => b.id === selectedBox)) selectedBox = boxes[0].id;
  const active = boxes.find((b) => b.id === selectedBox) || boxes[0];
  const sel = $("ol-box-select");
  if (sel) {
    const sig = boxes.map((b) => `${b.id}:${b.label}`).join("|");
    if (sel.dataset.sig !== sig) {
      sel.replaceChildren(
        ...boxes.map((b) => {
          const opt = document.createElement("option");
          opt.value = b.id;
          opt.textContent = b.label;
          return opt;
        }),
      );
      sel.dataset.sig = sig;
    }
    sel.value = active.id;
  }
  const setVal = (id, v) => {
    const el = $(id);
    if (el && document.activeElement !== el) el.value = String(v);
  };
  setVal("ol-box-w", active.w);
  setVal("ol-box-h", active.h);
  setVal("ol-box-x", active.x);
  setVal("ol-box-y", active.y);
  const map = parseCustomBoxes(settings.customBoxes);
  const resetOne = $("ol-box-reset-one");
  const resetAll = $("ol-box-reset-all");
  if (resetOne) resetOne.disabled = !map[active.id];
  if (resetAll) resetAll.disabled = Object.keys(map).length === 0;
}

function syncPlusBanner() {
  const banner = $("ol-plus-banner");
  const export4k = $("ol-export-2x");
  const editBtn = $("ol-edit-toggle");
  const boxBadge = $("ol-box-badge");
  if (export4k) {
    export4k.textContent = plusActive ? "4K PNG" : "4K PNG (Plus)";
  }
  if (editBtn) {
    editBtn.textContent = plusActive ? "Resize boxes" : "Resize boxes (Plus)";
  }
  if (boxBadge) {
    boxBadge.textContent = plusActive ? "Plus active" : "Frills Plus";
  }
  if (banner) {
    banner.hidden = true;
    banner.replaceChildren();
  }
}

const linkInput = $("link");
const copyBtn = $("copy-link");
const linkHint = $("link-hint");
copyButton(copyBtn, () => linkInput.value);

const cloud = mountCloudSave({
  kind: "outline",
  storeKey: STORE_KEY,
  anchor: linkInput.closest(".linkfield"),
  getUrl: () => linkInput.value,
  defaultName: "My stream outline",
  onStatus: (st) => {
    plusChecked = true;
    plusActive = Boolean(st?.plusActive);
    plusEligible = Boolean(st?.eligible);
    if (plusActive) closePlusModal();
    renderCardRows();
    syncPlusBanner();
    paint();
  },
});

const sizeGuide = mountSizeGuide({
  mode: "outline",
  anchor: linkInput.closest(".linkfield"),
  copyBtn,
  getSize: () => {
    const geom = computeOutlineGeometry(settings);
    const label = settings.mode === "screen9x16" ? "9:16 TikTok LIVE"
      : settings.mode === "screen16x9" ? "16:9 Full-Screen"
      : "Webcam / VTuber Box";
    return {
      width: geom.width,
      height: geom.height,
      label,
      appHint: settings.mode === "screen9x16" ? "tiktok" : "obs",
    };
  },
});

function refreshLink() {
  const url = outlineUrl(location.origin, settings);
  linkInput.value = url;
  copyBtn.disabled = false;
  const geom = computeOutlineGeometry(settings);
  if (linkHint) {
    linkHint.textContent = `Recommended Browser source size: ${geom.width} × ${geom.height} px (purely visual — uses 0 chat relay slots).`;
  }
  sizeGuide.sync();
  cloud.sync();
}

function paint() {
  syncVisibility();
  syncBoxInspector();
  syncPlusBanner();
  view.apply(settings, { plusActive, showSafeZones, showCutoutHints, editBoxes: plusActive && editBoxes, selectedBox });
  refreshLink();
}

const RESET_BOXES_KEYS = new Set(["mode", "layout9", "layout16", "boxAspect"]);

function guardPlusOption(key, value) {
  if (plusActive) return true;
  if (key === "frameStyle" && isPlusFrameStyle(value)) {
    openOutlinePlusModal("Subscribe for collector frame styles", "5 frame styles stay free forever. Subscribe to Frills Plus to unlock Cyber Tactical HUD, Celestial Filigree, Scrapbook Washi, and Plush Ribbon.");
    return false;
  }
  if (key === "motion" && isPlusMotion(value)) {
    openOutlinePlusModal("Subscribe for Plus border animations", "Static, Breathing glow, and Soft sheen stay free. Subscribe to Frills Plus to unlock Orbiting neon beam, Flowing gradient, and Twinkling stars.");
    return false;
  }
  if (key === "matMode" && isPlusMatMode(value)) {
    openOutlinePlusModal("Subscribe for starry & custom backdrops", "Soft tinted, solid, dots, grid, stripes, and all 4 watercolor skies stay free. Subscribe to Frills Plus for starry night mats and custom wallpaper uploads.");
    return false;
  }
  if (key === "cardStyle" && isPlusCardStyle(value)) {
    openOutlinePlusModal("Subscribe for Plus card layouts", "Clean stacked cards and compact badge rows stay free. Subscribe to Frills Plus for Horizontal pill strip and RPG Loot / Quest board layouts.");
    return false;
  }
  if ((key === "matImage" || key === "customBadge") && value) {
    openOutlinePlusModal("Subscribe to upload custom art & wallpapers", "All 18 built-in mascot packs and 4 watercolor skies stay free. Subscribe to Frills Plus to upload your own backdrop wallpaper or custom corner mascot.");
    return false;
  }
  if (key === "socials" && String(value || "").trim()) {
    openOutlinePlusModal("Subscribe for rotating socials pills", "Your channel handle, status line, and LIVE pill stay free. Subscribe to Frills Plus to add a rotating socials pill right on your nameplate.");
    return false;
  }
  return true;
}

function change(key, value) {
  if (!guardPlusOption(key, value)) {
    writers[key]?.(settings[key]);
    return;
  }
  settings[key] = value;
  if (RESET_BOXES_KEYS.has(key)) {
    settings.customBoxes = "";
    selectedBox = "";
  }
  // Auto-swap default card rows when flipping between Gift Menu & Commands/Rules
  if (key === "sideMode") {
    if (value === "gifts" && settings.cardItems === DEFAULT_INFO_ITEMS) {
      settings.cardItems = DEFAULT_GIFT_MENU;
      settings.cardTitle = "Gift Rewards";
      writers.cardTitle?.(settings.cardTitle);
      renderCardRows();
    } else if (value === "info" && settings.cardItems === DEFAULT_GIFT_MENU) {
      settings.cardItems = DEFAULT_INFO_ITEMS;
      settings.cardTitle = "Stream Commands";
      writers.cardTitle?.(settings.cardTitle);
      renderCardRows();
    }
  }
  if (key === "font") fontsReady(generalFaces(settings), 600).then(paint);
  else paint();
  lookChips?.set(currentLook({ ...settings }));
  saveLocal();
}

// ── Starting Looks ────────────────────────────────────────────────────────────────────────────────────────────
const swatch = (p) => (luminance(p.accent) < 0.08 ? p.bg : p.accent);
const looks = looksFor(activeSeason());
lookChips = chips(
  $("looks"),
  looks.map((l) => ({ id: l.id, name: l.name, season: l.season, dot: swatch(l.look) })),
  currentLook({ ...settings }),
  (item) => {
    const picked = looks.find((l) => l.id === item.id)?.look;
    if (!picked) return;
    for (const key of Object.keys(picked)) {
      if (key in settings && !LOOK_FILTER_HIDE.has(key)) settings[key] = picked[key];
    }
    syncAllControls();
    fontsReady(generalFaces(settings), 600).then(paint);
    saveLocal();
  },
  { dot: true },
);

// ── Build grouped section controls ────────────────────────────────────────────────────────────────────────────
const SECTION_HOST = {
  mode: "mode-controls",
  look: "look-controls",
  frame: "frame-controls",
  brand: "brand-controls",
  card: "card-controls",
};

let currentGroup = null;
const outlineTracked = [];
for (const control of OUTLINE.controls) {
  if (control.hidden) continue;
  if (control.section === "look" && LOOK_FILTER_HIDE.has(control.key)) continue;
  const hostId = SECTION_HOST[control.section] || "frame-controls";
  const host = $(hostId);
  if (!host) continue;
  if (control.group) {
    const heading = document.createElement("h3");
    heading.className = "stack__group";
    heading.textContent = control.group;
    host.append(heading);
    currentGroup = { el: heading, keys: [] };
    groupHeadings.push(currentGroup);
  }
  const built = control.type === "media" && $("media-ok")
    ? mountMediaPicker({
        consentBox: $("media-ok"),
        kind: control.media,
        label: control.label,
        hint: control.hint,
        value: settings[control.key],
        onBeforePick: (control.key === "matImage" || control.key === "customBadge")
          ? () => {
              if (plusActive) return true;
              openOutlinePlusModal("Subscribe to upload custom art & wallpapers", "All 18 built-in mascot packs and 4 watercolor skies stay free. Subscribe to Frills Plus to upload your own backdrop wallpaper or custom corner mascot.");
              return false;
            }
          : null,
        onSet: (val) => change(control.key, val),
      })
    : buildControl(control, settings[control.key], (val) => change(control.key, val));
  writers[control.key] = built.write;
  rowsByKey.set(control.key, built.row);
  outlineTracked.push({ control, row: built.row });
  if (currentGroup) currentGroup.keys.push(control.key);
  host.append(built.row);
}
editorMode.markControls(outlineTracked);
$("media-ok-wrap")?.classList.add("ed-adv");
if ($("look-controls")) editorMode.addAdvancePrompt($("look-controls"), "All colors & spacing →");

// Gate clicking into the Rotating socials (Plus) input for non-subscribers
const socialsInput = $("c-socials");
socialsInput?.addEventListener("pointerdown", (e) => {
  if (plusActive) return;
  e.preventDefault();
  socialsInput.blur();
  openOutlinePlusModal("Subscribe for rotating socials pills", "Your channel handle, status line, and LIVE pill stay free. Subscribe to Frills Plus to add a rotating socials pill right on your nameplate.");
});

// ── 1-Click TikTok Vertical Starter Presets ───────────────────────────────────────────────────────────────────
const TIKTOK_PRESETS = {
  "mobile-game": {
    mode: "screen9x16",
    layout9: "tt-game-cam",
    sideMode: "widget",
    widgetSlotLabel: "CHAT / GIFT JAR",
    topPad: 210,
    botPad: 460,
    sidePad: 44,
    splitPct: 50,
    swapSides: false,
    lowerZone: "fade",
    frameStyle: "window",
    matMode: "gradient",
    showBanner: true,
    bannerText: "RANKED GRIND · !SR FOR MUSIC",
    showPromo: true,
    promoText: "🌹 Rose = Spin · 🌌 Galaxy = VIP Shoutout!",
    slot1Label: "GAMEPLAY",
    slot2Label: "FACECAM",
  },
  "cam-first": {
    mode: "screen9x16",
    layout9: "tt-cam-top",
    sideMode: "gifts",
    cardTitle: "Gift Rewards",
    cardItems: DEFAULT_GIFT_MENU,
    highlightRow: -1,
    topPad: 210,
    botPad: 460,
    sidePad: 44,
    splitPct: 48,
    swapSides: false,
    lowerZone: "fade",
    frameStyle: "sticker",
    matMode: "dots",
    showBanner: true,
    bannerText: "LIVE NOW · SAY HI IN CHAT!",
    showPromo: true,
    promoText: "Tap the screen for likes! · Follow for daily streams",
    slot1Label: "MY CAM",
    slot2Label: "GAMEPLAY",
  },
  vtuber: {
    mode: "screen9x16",
    layout9: "tt-vtuber",
    sideMode: "gifts",
    cardTitle: "Gift Rewards",
    cardItems: DEFAULT_GIFT_MENU,
    highlightRow: -1,
    topPad: 210,
    botPad: 460,
    sidePad: 48,
    lowerZone: "card",
    frameStyle: "sticker",
    matMode: "stripes",
    artPack: "neko",
    decorPos: "corners",
    showBanner: true,
    bannerText: "COZY VTUBER HANGOUT ✨",
    showPromo: true,
    promoText: "🐱 Rose = Headpat · Drop a follow!",
    slot1Label: "VTUBER",
    slot2Label: "",
  },
  "just-chat": {
    mode: "screen9x16",
    layout9: "tt-chat-focus",
    sideMode: "widget",
    widgetSlotLabel: "GIFT JAR / GOAL",
    topPad: 210,
    botPad: 420,
    sidePad: 48,
    splitPct: 58,
    swapSides: false,
    lowerZone: "clear",
    frameStyle: "clean",
    matMode: "gradient",
    showBanner: true,
    bannerText: "LATE NIGHT CHATS & MUSIC",
    showPromo: false,
    slot1Label: "JUST CHATTING",
    slot2Label: "CHAT BOX",
  },
  "pk-duo": {
    mode: "screen9x16",
    layout9: "tt-split-cam",
    sideMode: "none",
    topPad: 210,
    botPad: 460,
    sidePad: 40,
    swapSides: false,
    lowerZone: "fade",
    frameStyle: "neon",
    matMode: "grid",
    showBanner: true,
    bannerText: "⚡ LIVE BATTLE / CO-HOST NIGHT",
    showPromo: true,
    promoText: "Tap fast for double points! 🔥",
    slot1Label: "HOST",
    slot2Label: "CO-HOST",
  },
};

for (const btn of document.querySelectorAll("[data-tt-preset]")) {
  btn.addEventListener("click", () => {
    const preset = TIKTOK_PRESETS[btn.dataset.ttPreset];
    if (!preset) return;
    settings = OUTLINE.sanitize({ ...settings, ...preset, customBoxes: "" });
    selectedBox = "";
    syncAllControls();
    paint();
    saveLocal();
  });
}

// ── 1-Click Twitch / OBS 16:9 Starter Presets ─────────────────────────────────────────────────────────────────
const TWITCH_PRESETS = {
  "tw-game-cam": {
    mode: "screen16x9",
    layout16: "game-cam",
    sideMode: "widget",
    widgetSlotLabel: "CHAT / ALERTS",
    sidePad: 36,
    swapSides: false,
    frameStyle: "window",
    matMode: "gradient",
    showBanner: true,
    bannerText: "LIVE ON TWITCH · !SR FOR MUSIC",
    showPromo: true,
    promoText: "Prime Sub = Ad-Free · !discord · !commands",
    slot1Label: "16:9 GAMEPLAY",
    slot2Label: "FACECAM",
  },
  "tw-just-chat": {
    mode: "screen16x9",
    layout16: "just-chatting",
    sideMode: "widget",
    widgetSlotLabel: "TWITCH CHAT",
    sidePad: 40,
    swapSides: false,
    frameStyle: "clean",
    matMode: "dots",
    showBanner: true,
    bannerText: "JUST CHATTING & COMMUNITY HANGOUT",
    showPromo: false,
    slot1Label: "FULL CAM",
    slot2Label: "CHAT BOX",
  },
  "tw-vtuber": {
    mode: "screen16x9",
    layout16: "game-cam",
    sideMode: "info",
    cardTitle: "Stream Commands",
    cardItems: DEFAULT_INFO_ITEMS,
    highlightRow: -1,
    sidePad: 38,
    swapSides: false,
    frameStyle: "sticker",
    matMode: "stripes",
    artPack: "neko",
    decorPos: "corners",
    showBanner: true,
    bannerText: "COZY VTUBER STREAM ✨",
    showPromo: true,
    promoText: "!clip · !sr · Bits & Subs trigger live effects!",
    slot1Label: "GAME / ART",
    slot2Label: "VTUBER",
  },
  "tw-dual": {
    mode: "screen16x9",
    layout16: "dual-split",
    sideMode: "none",
    sidePad: 36,
    swapSides: false,
    frameStyle: "neon",
    matMode: "grid",
    showBanner: true,
    bannerText: "⚡ CO-OP / COLLAB NIGHT",
    showPromo: true,
    promoText: "Follow both channels · !multi in chat!",
    slot1Label: "HOST",
    slot2Label: "CO-HOST",
  },
};

for (const btn of document.querySelectorAll("[data-tw-preset]")) {
  btn.addEventListener("click", () => {
    const preset = TWITCH_PRESETS[btn.dataset.twPreset];
    if (!preset) return;
    settings = OUTLINE.sanitize({ ...settings, ...preset, customBoxes: "" });
    selectedBox = "";
    syncAllControls();
    paint();
    saveLocal();
  });
}

// ── Interactive Gift Menu / Commands Row Builder ──────────────────────────────────────────────────────────────
const rowListEl = $("ol-seg-list");
const rowAddBtn = $("ol-seg-add");
const sampleGiftsBtn = $("ol-sample-gifts");
const sampleInfoBtn = $("ol-sample-info");
const rowHintEl = $("ol-seg-hint");

function getRows() {
  return parseCardRows(settings.cardItems, { limit: PLUS_ROW_LIMIT });
}

function toggleHighlightRow(idx) {
  const rows = getRows();
  if (!rows.length) return;
  const next = settings.highlightRow === idx ? -1 : Math.max(-1, Math.min(rows.length - 1, idx));
  settings.highlightRow = next;
  renderCardRows();
  paint();
  saveLocal();
  broadcastHighlight(next);
}

function stepHighlight(delta) {
  const rows = getRows();
  if (!rows.length) return;
  const cur = settings.highlightRow;
  let next;
  if (cur < 0) next = delta > 0 ? 0 : rows.length - 1;
  else {
    next = cur + delta;
    if (next < 0 || next >= rows.length) next = -1;
  }
  settings.highlightRow = next;
  renderCardRows();
  paint();
  saveLocal();
  broadcastHighlight(next);
}

function commitRows(rows) {
  settings.cardItems = encodeCardRows(rows, { limit: PLUS_ROW_LIMIT });
  const cleaned = getRows();
  if (settings.highlightRow >= cleaned.length) settings.highlightRow = -1;
  paint();
  saveLocal();
}

function renderCardRows() {
  if (!rowListEl) return;
  const rows = getRows();
  const isGifts = settings.sideMode === "gifts";
  rowListEl.replaceChildren();
  rows.forEach((rowData, idx) => {
    const row = document.createElement("div");
    row.className = "ol-seg-row";
    row.dataset.active = String(idx === settings.highlightRow);

    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "ol-seg-pick";
    pick.textContent = idx === settings.highlightRow ? "★" : String(idx + 1);
    pick.title = idx === settings.highlightRow ? "Remove spotlight" : `Spotlight row ${idx + 1}`;
    pick.addEventListener("click", () => toggleHighlightRow(idx));

    const labelIn = document.createElement("input");
    labelIn.type = "text";
    labelIn.className = "ol-seg-time";
    labelIn.maxLength = 28;
    labelIn.value = rowData.label;
    labelIn.placeholder = isGifts ? "🌹 Rose" : "!sr";
    labelIn.setAttribute("aria-label", `Row ${idx + 1} badge`);
    labelIn.addEventListener("input", () => {
      const next = getRows();
      if (next[idx]) next[idx].label = labelIn.value;
      commitRows(next);
    });

    const valIn = document.createElement("input");
    valIn.type = "text";
    valIn.className = "ol-seg-title";
    valIn.maxLength = 38;
    valIn.value = rowData.value;
    valIn.placeholder = isGifts ? "Shoutout" : "Request a song";
    valIn.setAttribute("aria-label", `Row ${idx + 1} description`);
    valIn.addEventListener("input", () => {
      const next = getRows();
      if (next[idx]) next[idx].value = valIn.value;
      commitRows(next);
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "ol-seg-del";
    del.textContent = "×";
    del.setAttribute("aria-label", `Remove row ${idx + 1}`);
    del.disabled = rows.length <= 1;
    del.addEventListener("click", () => {
      const next = getRows().filter((_, i) => i !== idx);
      settings.cardItems = encodeCardRows(next, { limit: PLUS_ROW_LIMIT });
      if (settings.highlightRow >= next.length) settings.highlightRow = -1;
      renderCardRows();
      paint();
      saveLocal();
    });

    row.append(pick, labelIn, valIn, del);
    rowListEl.append(row);
  });

  if (rowAddBtn) {
    rowAddBtn.disabled = plusActive && rows.length >= PLUS_ROW_LIMIT;
    rowAddBtn.textContent = !plusActive && rows.length >= FREE_ROW_LIMIT ? "+ Add row (Plus)" : "+ Add row";
  }
  if (rowHintEl) {
    rowHintEl.textContent = !plusActive && rows.length >= FREE_ROW_LIMIT
      ? `${rows.length} / ${FREE_ROW_LIMIT} free rows. Subscribe to Frills Plus for up to ${PLUS_ROW_LIMIT} rows.`
      : "Tap a row number (or click a row in the preview) to spotlight a featured gift or command with ★.";
  }
}

rowAddBtn?.addEventListener("click", () => {
  const next = getRows();
  if (!plusActive && next.length >= FREE_ROW_LIMIT) {
    openOutlinePlusModal(
      "Subscribe for up to 10 Gift & Command rows",
      `Up to ${FREE_ROW_LIMIT} rows stay free forever. Subscribe to Frills Plus to add up to ${PLUS_ROW_LIMIT} rows on your Gift Rewards or Commands card.`,
    );
    return;
  }
  if (next.length >= PLUS_ROW_LIMIT) return;
  const isGifts = settings.sideMode === "gifts";
  next.push(isGifts ? { label: "🎁 Gift", value: "Custom reward" } : { label: "!cmd", value: "Command info" });
  settings.cardItems = encodeCardRows(next, { limit: PLUS_ROW_LIMIT });
  renderCardRows();
  paint();
  saveLocal();
});

sampleGiftsBtn?.addEventListener("click", () => {
  settings.cardTitle = "Gift Rewards";
  settings.cardItems = DEFAULT_GIFT_MENU;
  settings.highlightRow = -1;
  writers.cardTitle?.(settings.cardTitle);
  renderCardRows();
  paint();
  saveLocal();
});

sampleInfoBtn?.addEventListener("click", () => {
  settings.cardTitle = "Stream Commands";
  settings.cardItems = DEFAULT_INFO_ITEMS;
  settings.highlightRow = -1;
  writers.cardTitle?.(settings.cardTitle);
  renderCardRows();
  paint();
  saveLocal();
});

// ── Preview bar actions & Frills Plus box resize inspector ────────────────────────────────────────────────────
$("ol-prev-step")?.addEventListener("click", () => stepHighlight(-1));
$("ol-next-step")?.addEventListener("click", () => stepHighlight(1));
$("ol-safe-toggle")?.addEventListener("click", () => {
  showSafeZones = !showSafeZones;
  paint();
});
$("ol-hints-toggle")?.addEventListener("click", () => {
  showCutoutHints = !showCutoutHints;
  paint();
});
$("ol-edit-toggle")?.addEventListener("click", () => {
  if (!plusActive) {
    openOutlinePlusModal(
      "Subscribe to resize & move boxes",
      "Free layouts stay free with preset spacing and split sliders. Subscribe to Frills Plus to drag and resize boxes directly on the canvas.",
    );
    return;
  }
  editBoxes = !editBoxes;
  paint();
});

function clearAllCustomBoxes() {
  if (!plusActive || !settings.customBoxes) return;
  settings.customBoxes = "";
  paint();
  saveLocal();
}

$("ol-reset-boxes")?.addEventListener("click", clearAllCustomBoxes);
$("ol-box-reset-all")?.addEventListener("click", clearAllCustomBoxes);

$("ol-box-select")?.addEventListener("change", (e) => {
  if (!plusActive) return;
  selectedBox = e.currentTarget.value;
  paint();
});

function updateSelectedBoxFromInputs(commit) {
  if (!plusActive) return;
  const geom = computeOutlineGeometry(settings);
  const active = listEditableBoxes(geom).find((b) => b.id === selectedBox);
  if (!active) return;
  const readNum = (id, fallback) => {
    const raw = Number($(id)?.value);
    return Number.isFinite(raw) ? raw : fallback;
  };
  const next = clampBoxRect(
    active.id,
    {
      x: readNum("ol-box-x", active.x),
      y: readNum("ol-box-y", active.y),
      w: readNum("ol-box-w", active.w),
      h: readNum("ol-box-h", active.h),
    },
    geom.width,
    geom.height,
    { shape: active.shape },
  );
  const map = parseCustomBoxes(settings.customBoxes);
  map[active.id] = next;
  settings.customBoxes = encodeCustomBoxes(map);
  paint();
  if (commit) saveLocal();
}

for (const id of ["ol-box-w", "ol-box-h", "ol-box-x", "ol-box-y"]) {
  $(id)?.addEventListener("input", () => updateSelectedBoxFromInputs(false));
  $(id)?.addEventListener("change", () => updateSelectedBoxFromInputs(true));
}

$("ol-box-center")?.addEventListener("click", () => {
  if (!plusActive) return;
  const geom = computeOutlineGeometry(settings);
  const active = listEditableBoxes(geom).find((b) => b.id === selectedBox);
  if (!active) return;
  const cx = Math.round((geom.width - active.w) / 2);
  const map = parseCustomBoxes(settings.customBoxes);
  map[active.id] = clampBoxRect(active.id, { ...active, x: cx }, geom.width, geom.height, { shape: active.shape });
  settings.customBoxes = encodeCustomBoxes(map);
  paint();
  saveLocal();
});

$("ol-box-reset-one")?.addEventListener("click", () => {
  if (!plusActive) return;
  const map = parseCustomBoxes(settings.customBoxes);
  if (!map[selectedBox]) return;
  delete map[selectedBox];
  settings.customBoxes = encodeCustomBoxes(map);
  paint();
  saveLocal();
});

// Keyboard Arrow nudging when Resize boxes mode is active (outside text inputs)
document.addEventListener("keydown", (e) => {
  if (!plusActive || !editBoxes || !selectedBox) return;
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  const geom = computeOutlineGeometry(settings);
  const active = listEditableBoxes(geom).find((b) => b.id === selectedBox);
  if (!active) return;
  e.preventDefault();
  const step = e.shiftKey ? 1 : 8;
  const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
  const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
  const map = parseCustomBoxes(settings.customBoxes);
  map[active.id] = clampBoxRect(active.id, { ...active, x: active.x + dx, y: active.y + dy }, geom.width, geom.height, { shape: active.shape });
  settings.customBoxes = encodeCustomBoxes(map);
  paint();
  saveLocal();
});

function syncAllControls() {
  for (const control of OUTLINE.controls) {
    if (writers[control.key]) writers[control.key](settings[control.key]);
  }
  lookChips?.set(currentLook({ ...settings }));
  renderCardRows();
}

$("reset")?.addEventListener("click", () => {
  settings = OUTLINE.sanitize({ ...OUTLINE.defaults, ...(matchaBase ?? {}) });
  showSafeZones = false;
  editBoxes = false;
  selectedBox = "";
  syncAllControls();
  paint();
  saveLocal();
});

// ── Transparent PNG Export (1080p Free / 4K Plus) ─────────────────────────────────────────────────────────────
async function handlePngExport(scale, button) {
  if (scale > 1 && !plusActive) {
    openOutlinePlusModal(
      "Subscribe for 4K transparent PNG exports",
      "1080p transparent PNG export stays free forever right beside this button. Subscribe to Frills Plus to export crisp 4K (2×) transparent PNGs.",
    );
    return;
  }
  const prevText = button.textContent;
  button.disabled = true;
  button.textContent = "Rendering PNG…";
  const usedPlus = plusFeaturesUsed(settings);
  const useFreeFallback = !plusActive && usedPlus.length > 0;
  let tempHost = null;
  let tempView = null;
  try {
    let sourceSvg = view.getSvg();
    if (useFreeFallback) {
      tempHost = document.createElement("div");
      tempView = createOutlineView(tempHost, { previewAll: false, editorOnly: false });
      tempView.apply(settings, { plusActive: false, showSafeZones: false, showCutoutHints: false });
      sourceSvg = tempView.getSvg();
    }
    const { blob, width, height } = await exportOutlinePng(sourceSvg, { scale });
    const name = `frills-outline-${settings.mode}-${settings.frameStyle}-${width}x${height}.png`;
    downloadBlob(blob, name);
    if (linkHint) {
      linkHint.textContent = useFreeFallback
        ? `Downloaded Free 1080p PNG (${width} × ${height} px, Plus preview features fell back to Free defaults). Unlock custom box sizing & Plus styles with Frills Plus.`
        : `Downloaded transparent PNG (${width} × ${height} px). Add as an Image Source in OBS or TikTok LIVE Studio.`;
    }
  } catch (err) {
    if (linkHint) linkHint.textContent = err?.message || "Could not export PNG in this browser.";
  } finally {
    tempView?.destroy();
    button.disabled = false;
    button.textContent = prevText;
  }
}

$("ol-export-1x")?.addEventListener("click", (e) => handlePngExport(1, e.currentTarget));
$("ol-export-2x")?.addEventListener("click", (e) => handlePngExport(2, e.currentTarget));
linkInput?.addEventListener("focus", () => linkInput.select());

// Initial draw
renderCardRows();
fontsReady(generalFaces(settings), 800).then(paint);
paint();
