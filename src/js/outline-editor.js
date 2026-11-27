// Stream Outline & Border Designer editor (/outline/):
// Purely visual (no channel or relay required), TikTok-first 9:16 + 16:9 + Webcam Box + Gift Menu / Info Card,
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
import { countPrompt } from "./stats.js";
import {
  DEFAULT_GIFT_MENU,
  DEFAULT_INFO_ITEMS,
  FREE_ROW_LIMIT,
  OUTLINE,
  PLUS_ROW_LIMIT,
  computeOutlineGeometry,
  encodeCardRows,
  hasSideCard,
  outlineUrl,
  parseCardRows,
  plusFeaturesUsed,
} from "./outline.js";
import { createOutlineView } from "./outline-view.js";
import { downloadBlob, exportOutlinePng } from "./outline-export.js";

const $ = (id) => document.getElementById(id);
const STORE_KEY = "frills:outline:editor:v2";
const BC_NAME = "frills:outline:live";
const LOOK_FILTER_HIDE = new Set(["deco", "size", "letterSpacing", "align", "border"]);

const params = new URLSearchParams(location.search);
const loadSaved = () => {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? "null"); } catch { return null; }
};
const saved = loadSaved();
let settings = OUTLINE.sanitize({ ...saved?.settings, ...OUTLINE.fromParams(params) });
let plusActive = false;
let plusEligible = false;
let showSafeZones = false;
let showCutoutHints = true;

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
  previewAll: true,
  editorOnly: true,
  onRowClick: (idx) => toggleHighlightRow(idx),
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
  const isCardOnly = m === "card";
  const cardOn = hasSideCard(settings);
  const sideIsWidget = !isCardOnly && !isBox && settings.sideMode === "widget";
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
  setHidden("sidePad", isCardOnly);
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

  setHidden("showName", isCardOnly);
  setHidden("handle", isCardOnly || !settings.showName);
  setHidden("tagline", isCardOnly || !settings.showName);
  setHidden("socials", isCardOnly || !settings.showName);
  setHidden("namePos", isCardOnly || !settings.showName);
  setHidden("liveBadge", isCardOnly || !settings.showName);

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
    hintsBtn.hidden = isCardOnly;
    hintsBtn.setAttribute("aria-pressed", String(showCutoutHints));
  }
  const prevBtn = $("ol-prev-step");
  const nextBtn = $("ol-next-step");
  if (prevBtn) prevBtn.hidden = !cardOn;
  if (nextBtn) nextBtn.hidden = !cardOn;

  const okWrap = $("media-ok-wrap");
  if (okWrap) okWrap.hidden = false;
}

function syncPlusBanner() {
  const banner = $("ol-plus-banner");
  const export4k = $("ol-export-2x");
  const used = plusFeaturesUsed(settings);
  const showPlusCta = document.body?.dataset?.plusAccounts === "on" && plusEligible;
  if (export4k) {
    export4k.textContent = plusActive ? "4K PNG" : "4K PNG (Plus)";
  }
  if (!banner) return;
  if (plusActive || used.length === 0) {
    banner.hidden = true;
    banner.replaceChildren();
    return;
  }
  banner.hidden = false;
  banner.replaceChildren();
  banner.append(`Previewing Frills Plus features (${used.join(", ")}). Free Browser links fall back to Free styles automatically — `);
  if (showPlusCta) {
    countPrompt("outline_plus", "shown");
    const link = document.createElement("a");
    link.href = "/plus/";
    link.textContent = "unlock live with Frills Plus →";
    link.addEventListener("click", () => countPrompt("outline_plus", "clicked"));
    banner.append(link);
  } else {
    banner.append("save as a live /o/… cloud link with Frills Plus to go live with them.");
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
    plusActive = Boolean(st?.plusActive);
    plusEligible = Boolean(st?.eligible);
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
      : settings.mode === "box" ? "Webcam / VTuber Box"
      : "Gift Menu / Info Card";
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
  syncPlusBanner();
  view.apply(settings, { plusActive, showSafeZones, showCutoutHints });
  refreshLink();
}

function change(key, value) {
  settings[key] = value;
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
    settings = OUTLINE.sanitize({ ...settings, ...preset });
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
  const isGifts = settings.sideMode === "gifts" || (settings.mode === "card" && settings.sideMode !== "info");
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

  if (rowAddBtn) rowAddBtn.disabled = rows.length >= PLUS_ROW_LIMIT;
  if (rowHintEl) {
    rowHintEl.textContent = rows.length > FREE_ROW_LIMIT && !plusActive
      ? `${rows.length} rows (Free links show the first ${FREE_ROW_LIMIT}; save as a Frills Plus cloud link for up to ${PLUS_ROW_LIMIT}).`
      : "Tap a row number (or click a row in the preview) to spotlight a featured gift or command with ★.";
  }
}

rowAddBtn?.addEventListener("click", () => {
  const next = getRows();
  if (next.length >= PLUS_ROW_LIMIT) return;
  const isGifts = settings.sideMode === "gifts" || (settings.mode === "card" && settings.sideMode !== "info");
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

// ── Preview bar actions ───────────────────────────────────────────────────────────────────────────────────────
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

function syncAllControls() {
  for (const control of OUTLINE.controls) {
    if (writers[control.key]) writers[control.key](settings[control.key]);
  }
  lookChips?.set(currentLook({ ...settings }));
  renderCardRows();
}

$("reset")?.addEventListener("click", () => {
  settings = { ...OUTLINE.defaults };
  showSafeZones = false;
  syncAllControls();
  paint();
  saveLocal();
});

// ── Transparent PNG Export (1080p Free / 4K Plus) ─────────────────────────────────────────────────────────────
async function handlePngExport(scale, button) {
  if (scale > 1 && !plusActive) {
    if (document.body?.dataset?.plusAccounts === "on" && plusEligible) {
      countPrompt("outline_plus", "shown");
    }
    if (linkHint) {
      linkHint.replaceChildren("4K PNG export is part of Frills Plus. Use Download PNG (1080p) free right beside it");
      if (document.body?.dataset?.plusAccounts === "on" && plusEligible) {
        linkHint.append(", or ");
        const link = document.createElement("a");
        link.href = "/plus/";
        link.textContent = "see Frills Plus →";
        link.addEventListener("click", () => countPrompt("outline_plus", "clicked"));
        linkHint.append(link);
      } else {
        linkHint.append(".");
      }
    }
    return;
  }
  const prevText = button.textContent;
  button.disabled = true;
  button.textContent = "Rendering PNG…";
  try {
    const { blob, width, height } = await exportOutlinePng(view.getSvg(), { scale });
    const name = `frills-outline-${settings.mode}-${settings.frameStyle}-${width}x${height}.png`;
    downloadBlob(blob, name);
    if (linkHint) linkHint.textContent = `Downloaded transparent PNG (${width} × ${height} px). Add as an Image Source in OBS or TikTok LIVE Studio.`;
  } catch (err) {
    if (linkHint) linkHint.textContent = err?.message || "Could not export PNG in this browser.";
  } finally {
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
