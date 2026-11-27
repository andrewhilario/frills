// The private Matcha Stream Studio:
//  1. Top sticky workspace: 6 exclusive Matcha chat styles + 5 Matcha palettes + Frog Pond alerts tab.
//  2. Full-width Complete Matcha Stream Suite below: every other Frills overlay (14 overlays -> 16 total!)
//     pre-colored to the active Matcha palette, active mascot, and connected TikTok / Twitch / Both stream,
//     with on-demand live previews, full-size lightbox preview, 1-click Copy link, Copy all links, and Open editor.

import { Feed, ICONS, el } from "./feed.js";
import { MATCHA_CONTROLS, MATCHA_DEFAULTS, MATCHA_PALETTES, MATCHA_STYLES, currentPalette, matchaFromParams, matchaOverlayUrl, paletteColors, sanitizeMatcha } from "./matcha.js";
import { MOD_ICONS } from "./settings.js";
import { DECOS } from "./decor.js";
import { fontsReady, matchaFaces, paintMatcha } from "./look.js";
import { buildControl, chips, copyButton, copyText } from "./ui.js";
import { MATCHA_HINTS, withHint } from "./chat-hints.js";
import { mountSource } from "./source.js";
import { sourcesOf } from "./both.js";
import { DEFAULTS as ALERT_DEFAULTS, LOOKS as ALERT_LOOKS, alertsUrl } from "./alerts-settings.js";
import { appendPlusCode } from "./plus-relay.js";
import { mountCloudSave } from "./cloud-save.js";
import { mountSizeGuide } from "./size-guide.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// What is remembered in this browser: the settings, the account and where it streams. Nothing leaves the page.
const STORE = "frills:matcha:v1";
const load = () => { try { return JSON.parse(localStorage.getItem(STORE) ?? "null"); } catch { return null; } };
const saved = load();

// A link (the style, the palette, anything under More options) wins over what was remembered, unless what it says isn't a number.
const fromLink = Object.fromEntries(Object.entries(matchaFromParams(params)).filter(([, value]) => value !== null && value !== undefined && !Number.isNaN(value)));
let settings = sanitizeMatcha({ ...saved?.settings, ...fromLink });

const preview = $("preview");
const stage = $("stage");
const feed = new Feed($("chat"));

// Valid mascot packs supported by Talking Pet TTS and Stream Outline so selecting any mascot in Step 1 carries through cleanly.
const VALID_MASCOTS = new Set([
  "frog2", "neko", "hamster", "bunny", "shiba", "capybara", "dino", "astro",
  "skatecat", "dragon", "sakura", "valentine", "summer", "autumn", "anime-xmas", "anime-halloween",
]);
const activeMascot = () => (VALID_MASCOTS.has(settings.deco) ? settings.deco : "frog2");

/** High-contrast accent/bg/text/pop derived from the active Matcha palette or custom colors. */
function activeMatchaLook() {
  const isDefaultLattePop = settings.palette === "latte" && settings.pop === MATCHA_PALETTES.latte.pop;
  return {
    ...ALERT_LOOKS.matcha,
    accent: settings.matcha,
    bg: settings.bg,
    text: settings.ink,
    pop: isDefaultLattePop ? ALERT_LOOKS.matcha.pop : settings.pop,
    ...(settings.font ? { font: settings.font } : {}),
  };
}

/** Current Frog Pond alert settings synced to the chosen Matcha palette. */
function currentAlertSettings() {
  return { ...ALERT_DEFAULTS, ...activeMatchaLook(), deco: "frog2" };
}

// The frog pond alerts: the alerts page's Matcha look wearing the frog pond pictures (a setting that only the Matcha editor offers). The practice page is
// only loaded when its tab is first opened, and it is 1080 wide by 560 high: it is shrunk to the room the preview has.
const alertsStage = $("alerts-stage");
let alertsFrame = null;
const fitAlerts = () => {
  if (!alertsFrame) return;
  const w = alertsStage.clientWidth;
  const h = alertsStage.clientHeight;
  const k = Math.max(0.1, Math.min(w / 1080, h / 560));
  alertsFrame.style.transform = `translate(${Math.round((w - 1080 * k) / 2)}px, ${Math.round((h - 560 * k) / 2)}px) scale(${k.toFixed(4)})`;
};
new ResizeObserver(fitAlerts).observe(alertsStage);
function showView(view) {
  preview.dataset.view = view;
  $("view-chat").setAttribute("aria-pressed", String(view === "chat"));
  $("view-alerts").setAttribute("aria-pressed", String(view === "alerts"));
  if (view === "alerts" && !alertsFrame) {
    alertsFrame = el("iframe", { className: "matcha-alerts__frame", title: "Frog pond alerts on made-up follows, gifts and shares", tabIndex: -1 });
    alertsFrame.setAttribute("aria-hidden", "true");
    alertsFrame.src = alertsUrl("/overlay/alerts/", { settings: currentAlertSettings() }) + "&demo=1&pace=2400&maxShown=1&vpos=middle&hpos=center";
    alertsStage.append(alertsFrame);
  }
  fitAlerts();
}
$("view-chat").addEventListener("click", () => showView("chat"));
$("view-alerts").addEventListener("click", () => showView("alerts"));

// ── Complete Matcha Stream Suite (all 14 other overlays -> 16 total on /matcha/) ────────────────────────────────────────────
const SUITE_ITEMS = [
  {
    id: "jar",
    name: "Gift & bits jar",
    cat: "both",
    badge: "TikTok + Twitch · Both",
    sizeLabel: () => "1080 × 1920",
    frameSize: () => [540, 680],
    blurb: "Drop TikTok gifts and Twitch bits & subs into the Frog Pond crystal terrarium (or any of 14 jars in S / M / L).",
    editor: "/matcha/jar/",
    overlay: "/overlay/jar/",
    platforms: ["tiktok", "twitch", "both"],
    extra: () => ({ design: "frog", jarSize: "medium", titleText: "Matcha jar" }),
  },
  {
    id: "wheel",
    name: "Spin the wheel",
    cat: "both",
    badge: "TikTok + Twitch · Both",
    sizeLabel: () => "1080 × 1080",
    frameSize: () => [720, 720],
    blurb: "Animated Kawaii pastel prize & dare wheel spun by TikTok gifts, Twitch bits & subs, or a shared team spin meter.",
    editor: "/matcha/wheel/",
    overlay: "/overlay/wheel/",
    platforms: ["tiktok", "twitch", "both"],
    extra: () => ({ design: "kawaii" }),
  },
  {
    id: "outline",
    name: "Stream outline & borders",
    cat: "visual",
    badge: "TikTok 9:16 + Twitch 16:9",
    sizeLabel: (p) => (p === "twitch" ? "1920 × 1080" : "1080 × 1920"),
    frameSize: (p) => (p === "twitch" ? [960, 540] : [540, 960]),
    blurb: "Transparent-cutout stream frames with Frog Pond corner art, 4 watercolor skies, safe-zone guides, and PNG export.",
    editor: "/matcha/outline/",
    overlay: "/overlay/outline/",
    platforms: ["visual"],
    extra: (p, ch) => ({
      mode: p === "twitch" ? "screen16x9" : "screen9x16",
      layout: p === "twitch" ? "game-cam" : "tt-game-cam",
      frameStyle: "sticker",
      artPack: activeMascot(),
      handle: ch ? (ch.startsWith("@") ? ch : `@${ch}`) : "@matcha",
    }),
  },
  {
    id: "songs",
    name: "Song requests (!sr + Spotify)",
    cat: "both",
    badge: "TikTok + Twitch · Both",
    sizeLabel: () => "600 × 700",
    frameSize: () => [680, 560],
    blurb: "Viewers type !sr in TikTok or Twitch chat (or both) for an on-screen queue with album art and optional Spotify sync.",
    editor: "/matcha/songs/",
    overlay: "/overlay/songs/",
    platforms: ["tiktok", "twitch", "both"],
    extra: () => ({ layout: "equalizer" }),
  },
  {
    id: "tts",
    name: "Talking pet TTS (!say)",
    cat: "both",
    badge: "TikTok + Twitch · Both",
    sizeLabel: () => "600 × 420",
    frameSize: () => [660, 440],
    blurb: "A hopping frog (or your chosen mascot) reads out TikTok gifts, Twitch bits & subs, and viewer !say chat messages.",
    editor: "/matcha/tts/",
    overlay: "/overlay/tts/",
    platforms: ["tiktok", "twitch", "both"],
    extra: () => ({ pet: activeMascot() }),
  },
  {
    id: "goal",
    name: "Follower, sub & gift goal bar",
    cat: "both",
    badge: "TikTok + Twitch · Both",
    sizeLabel: () => "800 × 240",
    frameSize: () => [800, 260],
    blurb: "Goal bar with milestone cheers at 25%, 50%, and 75%, confetti celebration at 100%, and automatic next-target bumps.",
    editor: "/matcha/goal/",
    overlay: "/overlay/goal/",
    platforms: ["tiktok", "twitch", "both"],
    extra: (p) => ({ style: "candy", type: p === "twitch" ? "sub" : "follow" }),
  },
  {
    id: "timer",
    name: "Subathon countdown timer",
    cat: "both",
    badge: "TikTok + Twitch · Both",
    sizeLabel: () => "600 × 260",
    frameSize: () => [660, 280],
    blurb: "Countdown clock that grows automatically from TikTok gifts and Twitch subs, gifted subs & bits.",
    editor: "/matcha/timer/",
    overlay: "/overlay/timer/",
    platforms: ["tiktok", "twitch", "both"],
    extra: () => ({}),
  },
  {
    id: "gifts",
    name: "Recent gifts & support",
    cat: "both",
    badge: "TikTok + Twitch · Both",
    sizeLabel: () => "520 × 640",
    frameSize: () => [580, 560],
    blurb: "Live scrolling feed of your latest TikTok gifts and Twitch subs, gifted subs, bit cheers, and raids.",
    editor: "/matcha/gifts/",
    overlay: "/overlay/gifts/",
    platforms: ["tiktok", "twitch", "both"],
    extra: () => ({}),
  },
  {
    id: "gifters",
    name: "Top gifters leaderboard",
    cat: "both",
    badge: "TikTok + Twitch · Both",
    sizeLabel: () => "520 × 640",
    frameSize: () => [580, 560],
    blurb: "Live supporter leaderboard ranking TikTok diamonds and Twitch gifted subs & bits with crown celebrations.",
    editor: "/matcha/gifters/",
    overlay: "/overlay/gifters/",
    platforms: ["tiktok", "twitch", "both"],
    extra: () => ({}),
  },
  {
    id: "labels",
    name: "Rotating stream highlights",
    cat: "both",
    badge: "TikTok + Twitch · Both",
    sizeLabel: () => "620 × 220",
    frameSize: () => [700, 250],
    blurb: "Compact cycling card showing Last Gift, Last Follower, Last Sub, Last Bits, Top Gifter, and Top Liker.",
    editor: "/matcha/labels/",
    overlay: "/overlay/labels/",
    platforms: ["tiktok", "twitch", "both"],
    extra: () => ({}),
  },
  {
    id: "actions",
    name: "OBS & VTube Studio actions",
    cat: "visual",
    badge: "OBS · VTS · 10 auto notes free",
    sizeLabel: () => "1920 × 1080",
    frameSize: () => [820, 460],
    blurb: "Auto !clip, instant replay cam, scene switches, plus 10 free automatic + unlimited manual VTS sticky notes.",
    editor: "/matcha/actions/",
    overlay: "/overlay/actions/",
    platforms: ["tiktok", "twitch", "both"],
    needsSetup: true,
    extra: () => ({}),
  },
  {
    id: "likers",
    name: "Top likers leaderboard",
    cat: "tiktok",
    badge: "TikTok LIVE",
    sizeLabel: () => "520 × 640",
    frameSize: () => [580, 560],
    blurb: "Ranks top heart-tappers live on TikTok LIVE with gold crown milestone celebrations every 1,000 likes.",
    editor: "/matcha/likers/",
    overlay: "/overlay/likers/",
    platforms: ["tiktok"],
    extra: () => ({}),
  },
  {
    id: "gallery",
    name: "Gift gallery showcase",
    cat: "tiktok",
    badge: "TikTok LIVE",
    sizeLabel: () => "620 × 420",
    frameSize: () => [660, 440],
    blurb: "Rotating animated showcase of your signature TikTok gifts that lights up as viewers unlock each one.",
    editor: "/matcha/gallery/",
    overlay: "/overlay/gallery/",
    platforms: ["tiktok"],
    extra: () => ({}),
  },
  {
    id: "counter",
    name: "Live viewer & like counter",
    cat: "tiktok",
    badge: "TikTok LIVE",
    sizeLabel: () => "420 × 160",
    frameSize: () => [540, 220],
    blurb: "Clean live viewer count and total hearts counter pill for TikTok LIVE.",
    editor: "/matcha/counter/",
    overlay: "/overlay/counter/",
    platforms: ["tiktok"],
    extra: () => ({}),
  },
];

function buildSuiteUrls(item) {
  const plat = source.platform;
  const both = plat === "both";
  const names = both ? source.cleanChannels() : null;
  const channel = source.cleanChannel();
  const tiktokName = both ? names.tiktok : (plat === "tiktok" ? channel : "");
  const look = activeMatchaLook();
  const baseParams = new URLSearchParams();
  baseParams.set("look", "matcha");
  baseParams.set("accent", look.accent);
  baseParams.set("bg", look.bg);
  baseParams.set("text", look.text);
  baseParams.set("pop", look.pop);
  if (settings.font) baseParams.set("font", settings.font);

  const extra = item.extra(plat, tiktokName || channel) || {};
  for (const [k, v] of Object.entries(extra)) {
    if (v !== "" && v !== null && v !== undefined) baseParams.set(k, String(v));
  }

  // Demo preview URL (always works immediately with made-up events!)
  const demoParams = new URLSearchParams(baseParams);
  demoParams.set("demo", "1");
  const demoUrl = `${item.overlay}?${demoParams}`;

  // Editor URL (always opens pre-loaded with the saved Matcha colors, mascot & channel)
  const editorParams = new URLSearchParams(baseParams);
  if (item.platforms[0] === "visual") {
    // outline uses visual params only
  } else if (item.platforms.length === 1 && item.platforms[0] === "tiktok") {
    if (tiktokName) { editorParams.set("channel", tiktokName); editorParams.set("platform", "tiktok"); }
  } else if (both && names.tiktok && names.twitch) {
    editorParams.set("tiktok", names.tiktok);
    editorParams.set("twitch", names.twitch);
  } else if (channel) {
    editorParams.set("channel", channel);
    editorParams.set("platform", plat === "twitch" ? "twitch" : "tiktok");
  }
  const editorUrl = `${item.editor}?${editorParams}`;

  // Live Browser source URL
  let liveUrl = "";
  let note = "";
  if (item.platforms[0] === "visual") {
    liveUrl = `${location.origin}${item.overlay}?${baseParams}`;
    note = "Visual frame — ready to copy right away (no channel needed).";
  } else if (item.needsSetup) {
    note = "Open the Actions editor to pair OBS / VTube Studio and copy your #hash link.";
  } else if (item.platforms.length === 1 && item.platforms[0] === "tiktok") {
    if (tiktokName) {
      const p = new URLSearchParams(baseParams);
      p.set("channel", tiktokName);
      p.set("platform", "tiktok");
      liveUrl = appendPlusCode(`${location.origin}${item.overlay}?${p}`);
    } else {
      note = "TikTok LIVE overlay — enter a TikTok name in Step 2 to generate this link.";
    }
  } else if (both) {
    if (names.tiktok && names.twitch) {
      const p = new URLSearchParams(baseParams);
      p.set("tiktok", names.tiktok);
      p.set("twitch", names.twitch);
      liveUrl = appendPlusCode(`${location.origin}${item.overlay}?${p}`);
    } else {
      note = "Enter both TikTok and Twitch names in Step 2 to get your combined link.";
    }
  } else if (channel) {
    const p = new URLSearchParams(baseParams);
    p.set("channel", channel);
    p.set("platform", plat === "twitch" ? "twitch" : "tiktok");
    const raw = `${location.origin}${item.overlay}?${p}`;
    liveUrl = plat === "tiktok" ? appendPlusCode(raw) : raw;
  } else {
    note = "Type your channel name in Step 2 and this link fills in automatically.";
  }

  return { demoUrl, editorUrl, liveUrl, note, sizeText: item.sizeLabel(plat), frameSize: item.frameSize(plat) };
}

function fitScaledFrame(container, frame, fw, fh) {
  if (!container || !frame) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (!w || !h) return;
  const k = Math.max(0.08, Math.min(w / fw, h / fh));
  frame.style.width = `${fw}px`;
  frame.style.height = `${fh}px`;
  frame.style.transform = `translate(${Math.round((w - fw * k) / 2)}px, ${Math.round((h - fh * k) / 2)}px) scale(${k.toFixed(4)})`;
}

// ── Build Matcha Suite cards + Full-size Lightbox ───────────────────────────────────────────────────────────────────────────
const suiteGrid = $("matcha-grid");
const suitePalettePill = $("suite-palette-pill");
const suiteChannelPill = $("suite-channel-pill");
const suiteMsg = $("suite-msg");
const suiteCopyAllBtn = $("suite-copy-all");
const suiteLoadAllBtn = $("suite-load-all");
const lightbox = $("matcha-lightbox");
const mlbTitle = $("mlb-title");
const mlbSize = $("mlb-size");
const mlbStage = $("mlb-stage");
const mlbLink = $("mlb-link");
const mlbCopy = $("mlb-copy");
const mlbEdit = $("mlb-edit");
const mlbBackdrop = $("mlb-backdrop");
const mlbClose = $("mlb-close");

let suiteFilter = "all";
let lightboxItem = null;
let lightboxFrame = null;
const suiteCards = [];

const fitLightbox = () => {
  if (!lightboxItem || !lightboxFrame || !lightbox?.open) return;
  const [fw, fh] = lightboxItem.frameSize(source.platform);
  fitScaledFrame(mlbStage, lightboxFrame, fw, fh);
};
if (mlbStage) new ResizeObserver(fitLightbox).observe(mlbStage);

function openLightbox(item) {
  if (!lightbox) return;
  lightboxItem = item;
  const urls = buildSuiteUrls(item);
  mlbTitle.textContent = item.name;
  mlbSize.textContent = urls.sizeText;
  mlbLink.value = urls.liveUrl;
  mlbCopy.disabled = !urls.liveUrl;
  mlbEdit.href = urls.editorUrl;
  mlbBackdrop.value = preview.dataset.back || "dark";
  mlbStage.dataset.back = mlbBackdrop.value;
  mlbStage.replaceChildren();
  lightboxFrame = el("iframe", { className: "matcha-card__frame", title: `${item.name} full preview`, tabIndex: -1 });
  lightboxFrame.src = urls.demoUrl;
  mlbStage.append(lightboxFrame);
  if (!lightbox.open) lightbox.showModal();
  requestAnimationFrame(fitLightbox);
}

function closeLightbox() {
  if (!lightbox?.open) return;
  lightbox.close();
  mlbStage.replaceChildren();
  lightboxFrame = null;
  lightboxItem = null;
}

mlbClose?.addEventListener("click", closeLightbox);
lightbox?.addEventListener("click", (e) => { if (e.target === lightbox) closeLightbox(); });
lightbox?.addEventListener("cancel", () => { mlbStage.replaceChildren(); lightboxFrame = null; lightboxItem = null; });
mlbBackdrop?.addEventListener("change", () => { if (mlbStage) mlbStage.dataset.back = mlbBackdrop.value; });
if (mlbCopy) copyButton(mlbCopy, () => mlbLink.value, { label: "Copy link" });
mlbLink?.addEventListener("focus", () => mlbLink.select());

function mountSuiteCard(item) {
  const card = el("article", { className: "matcha-card" });
  card.dataset.cat = item.cat;
  card.dataset.id = item.id;

  const title = el("h3", { className: "matcha-card__title", textContent: item.name });
  const badge = el("span", { className: `matcha-card__badge${item.cat === "tiktok" ? " matcha-card__badge--tt" : ""}`, textContent: item.badge });
  const sizeBadge = el("span", { className: "matcha-card__size", textContent: item.sizeLabel("tiktok") });
  const head = el("div", { className: "matcha-card__head" }, title, el("div", { className: "matcha-card__badges" }, badge, sizeBadge));

  const stageBox = el("div", { className: "matcha-card__stage" });
  const loadBtn = el("button", { type: "button", className: "btn btn--soft btn--sm", textContent: "Preview live" });
  const placeholder = el("div", { className: "matcha-card__placeholder" },
    el("p", { textContent: "Matcha live preview ready on demand" }),
    loadBtn,
  );
  stageBox.append(placeholder);

  const blurb = el("p", { className: "matcha-card__blurb", textContent: item.blurb });

  const input = el("input", {
    type: "text",
    className: "matcha-card__input",
    readOnly: true,
    placeholder: item.needsSetup ? "Configure in Actions editor" : "Appears once you type a channel in Step 2",
    spellcheck: false,
    autocomplete: "off",
  });
  input.setAttribute("aria-label", `${item.name} Browser source link`);
  input.addEventListener("focus", () => input.select());
  const noteEl = el("p", { className: "matcha-card__note" });
  const linkRow = el("div", { className: "matcha-card__linkrow" }, input, noteEl);

  const copyBtnEl = el("button", { type: "button", className: "btn btn--sm", textContent: "Copy link" });
  copyButton(copyBtnEl, () => input.value, { label: "Copy link" });
  const fullBtn = el("button", { type: "button", className: "btn btn--soft btn--sm", textContent: "Full preview" });
  fullBtn.addEventListener("click", () => openLightbox(item));
  const editLink = el("a", { className: "btn btn--soft btn--sm", href: item.editor, textContent: "Customize" });
  const actions = el("div", { className: "matcha-card__actions" }, copyBtnEl, fullBtn, editLink);

  card.append(head, stageBox, blurb, linkRow, actions);
  suiteGrid?.append(card);

  let frame = null;
  let lastDemoSrc = "";
  let frameDims = item.frameSize("tiktok");
  const fit = () => { if (frame) fitScaledFrame(stageBox, frame, frameDims[0], frameDims[1]); };
  new ResizeObserver(fit).observe(stageBox);

  const loadPreview = () => {
    const urls = buildSuiteUrls(item);
    frameDims = urls.frameSize;
    if (!frame) {
      stageBox.dataset.loaded = "true";
      stageBox.replaceChildren();
      frame = el("iframe", { className: "matcha-card__frame", title: `${item.name} live preview`, tabIndex: -1 });
      frame.setAttribute("aria-hidden", "true");
      stageBox.append(frame);
    }
    if (lastDemoSrc !== urls.demoUrl) {
      lastDemoSrc = urls.demoUrl;
      frame.src = urls.demoUrl;
    }
    fit();
  };
  loadBtn.addEventListener("click", loadPreview);

  const sync = () => {
    const urls = buildSuiteUrls(item);
    sizeBadge.textContent = urls.sizeText;
    frameDims = urls.frameSize;
    input.value = urls.liveUrl;
    copyBtnEl.disabled = !urls.liveUrl;
    noteEl.textContent = urls.note;
    noteEl.hidden = !urls.note;
    editLink.href = urls.editorUrl;
    if (frame && lastDemoSrc !== urls.demoUrl) {
      lastDemoSrc = urls.demoUrl;
      frame.src = urls.demoUrl;
      fit();
    }
    return urls;
  };

  suiteCards.push({ item, card, sync, loadPreview, isLoaded: () => Boolean(frame) });
}

if (suiteGrid) {
  for (const item of SUITE_ITEMS) mountSuiteCard(item);
}

for (const btn of document.querySelectorAll("#suite-filters [data-suite-filter]")) {
  btn.addEventListener("click", () => {
    suiteFilter = btn.dataset.suiteFilter || "all";
    for (const b of document.querySelectorAll("#suite-filters [data-suite-filter]")) {
      b.setAttribute("aria-pressed", String(b === btn));
    }
    for (const c of suiteCards) {
      c.card.hidden = suiteFilter !== "all" && c.item.cat !== suiteFilter;
    }
  });
}

suiteLoadAllBtn?.addEventListener("click", () => {
  for (const c of suiteCards) {
    if (!c.card.hidden) c.loadPreview();
  }
  suiteLoadAllBtn.textContent = "All previews live";
  suiteLoadAllBtn.disabled = true;
});

suiteCopyAllBtn?.addEventListener("click", async () => {
  const lines = [];
  if (link.value) lines.push(`Matcha Chat: ${link.value}`);
  if (alertsLink.value) lines.push(`Frog Pond Alerts: ${alertsLink.value}`);
  for (const c of suiteCards) {
    const urls = buildSuiteUrls(c.item);
    if (urls.liveUrl) lines.push(`${c.item.name}: ${urls.liveUrl}`);
  }
  if (!lines.length) return;
  const ok = await copyText(lines.join("\n"));
  if (suiteMsg) {
    suiteMsg.hidden = false;
    suiteMsg.textContent = ok
      ? `Copied ${lines.length} Matcha overlay links to your clipboard.`
      : "Could not copy automatically — copy any link from its box below.";
  }
});

let lastAlertsDemoSrc = "";
function refreshSuite() {
  const palId = currentPalette(settings);
  const palName = palId ? MATCHA_PALETTES[palId]?.name : "Custom";
  if (suitePalettePill) suitePalettePill.textContent = `Palette: ${palName}`;

  const plat = source.platform;
  const names = plat === "both" ? source.cleanChannels() : null;
  const ch = source.cleanChannel();
  if (suiteChannelPill) {
    suiteChannelPill.textContent = plat === "both"
      ? (names.tiktok && names.twitch ? `Both: @${names.tiktok} + ${names.twitch}` : "Both: enter both names")
      : ch
        ? `${plat === "twitch" ? "Twitch" : "TikTok"}: ${plat === "tiktok" ? `@${ch}` : ch}`
        : "Channel: Practice mode";
  }

  let readyCount = (link.value ? 1 : 0) + (alertsLink.value ? 1 : 0);
  for (const c of suiteCards) {
    const urls = c.sync();
    if (urls.liveUrl) readyCount += 1;
  }
  if (suiteCopyAllBtn) {
    suiteCopyAllBtn.disabled = readyCount === 0;
    suiteCopyAllBtn.textContent = readyCount > 0 ? `Copy all links (${readyCount})` : "Copy all links";
  }
  if (lightboxItem && lightbox?.open) {
    const urls = buildSuiteUrls(lightboxItem);
    mlbSize.textContent = urls.sizeText;
    mlbLink.value = urls.liveUrl;
    mlbCopy.disabled = !urls.liveUrl;
    mlbEdit.href = urls.editorUrl;
    if (lightboxFrame && lightboxFrame.src !== new URL(urls.demoUrl, location.origin).href) {
      lightboxFrame.src = urls.demoUrl;
    }
    fitLightbox();
  }
}

// The six styles: one row of choices, and a line about the one picked.
const styleChips = chips($("styles"), MATCHA_STYLES.map((s) => ({ id: s.id, name: s.name })), settings.style, (item) => {
  settings.style = item.id;
  refresh();
});

function paintAll() {
  feed.configure(paintMatcha(stage, settings));
}

function save() {
  try { localStorage.setItem(STORE, JSON.stringify({ settings, channel: source.channel, twitch: source.twitchChannel, platform: source.platform })); } catch { /* storage can be blocked; the page still works */ }
}

function refresh() {
  paintAll();
  styleChips.set(settings.style);
  $("style-note").textContent = MATCHA_STYLES.find((s) => s.id === settings.style)?.note ?? "";
  const both = source.platform === "both";
  const names = both ? source.cleanChannels() : null; // in "both" the link needs each of the two accounts
  const channel = source.cleanChannel();
  const ready = both ? Boolean(names.tiktok && names.twitch) : Boolean(channel);
  const on = both && settings.source !== "none"; // one chat reading TikTok and Twitch: a small icon before each name
  feed.configure({ markPlatform: on });
  const rawChat = ready ? matchaOverlayUrl(`${location.origin}/overlay/`, { channel, settings, platform: source.platform, both: names }) : "";
  link.value = rawChat && (source.platform === "tiktok" || both) ? appendPlusCode(rawChat) : rawChat;
  copyBtn.disabled = !ready;

  const alertSettings = currentAlertSettings();
  const alertReady = both ? Boolean(names.tiktok && names.twitch) : Boolean(channel);
  const rawAlert = alertReady
    ? alertsUrl(`${location.origin}/overlay/alerts/`, {
      channel: both ? "" : channel,
      both: both ? names : null,
      settings: alertSettings,
      platform: source.platform,
    })
    : "";
  alertsLink.value = rawAlert && (source.platform === "tiktok" || both) ? appendPlusCode(rawAlert) : rawAlert;
  alertsCopy.disabled = !alertReady;
  alertsHint.textContent = alertReady
    ? (source.platform === "twitch"
      ? "Paste it into a Browser source in OBS: 1920 wide by 1080 high for widescreen Twitch."
      : "Paste it into a Browser source in your streaming app: 1080 wide by 1920 high for a vertical LIVE.")
    : (both
      ? "Type your TikTok name and your Twitch channel above and your combined alerts link appears here."
      : "Type your TikTok name or Twitch channel above and the alerts link appears here.");
  if (alertsFrame) {
    const nextDemo = alertsUrl("/overlay/alerts/", { settings: alertSettings }) + "&demo=1&pace=2400&maxShown=1&vpos=middle&hpos=center";
    if (lastAlertsDemoSrc !== nextDemo) {
      lastAlertsDemoSrc = nextDemo;
      alertsFrame.src = nextDemo;
    }
  }

  hint.textContent = !ready ? (both ? "Type your TikTok name and your Twitch channel above and your link appears here." : "Type your TikTok name or Twitch channel above and your link appears here.") : (source.platform === "tiktok" || both) && !source.usesRelay ? "This link only works on this PC, while the Frills helper is running." : "";
  refreshSuite();
  cloud?.sync();
  save();
}

// ── The quick choices: palette, mod icon, pictures, and the preview's backdrop and width ───────────────────────────────────────────────────────
const paletteChips = chips(
  $("palettes"),
  Object.entries(MATCHA_PALETTES).map(([id, p]) => ({ id, name: p.name, dot: p.matcha })),
  currentPalette(settings),
  (item) => {
    settings.palette = item.id;
    Object.assign(settings, paletteColors(item.id)); // a palette sets all six colors; they can be changed one by one under More options
    syncControls();
    refresh();
  },
  { dot: true },
);
chips(
  $("icons"),
  MOD_ICONS.map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1), svg: id === "none" ? "" : ICONS[id] })),
  settings.modIcon,
  (item) => { settings.modIcon = item.id; refresh(); },
);
const decoChips = chips(
  $("decos"),
  DECOS.map((d) => ({ id: d.id, name: d.id === "none" ? "None" : d.name })),
  settings.deco,
  (item) => {
    settings.deco = item.id;
    writers.deco?.(item.id); // the same setting is also under More options: keep the two in step
    showNeeded();
    refresh();
  },
);
$("backdrop").addEventListener("change", (event) => { preview.dataset.back = event.target.value; });
let chatPreviewW = 440;
let chatPreviewH = 800;
let chatSizeGuide = null;
const width = buildControl({ key: "previewW", type: "range", label: "Width", min: 280, max: 720, step: 10, unit: " px" }, chatPreviewW, (value) => {
  chatPreviewW = value;
  $("chat").style.setProperty("--preview-w", value + "px");
  chatSizeGuide?.sync();
}, { id: "c-previewW" });
$("preview-width").append(width.row);

// ── More options: built from the same kind of list the editor uses ────────────────────────────────────────────────────────
const writers = {};
function change(key, value) {
  settings[key] = value;
  paletteChips.set(currentPalette(settings)); // no palette looks pressed once a color has been changed
  if (key === "deco") decoChips.set(value);
  if (key === "font") fontsReady(matchaFaces(settings), 600).then(refresh);
  else refresh();
  showNeeded(); // the settings that depend on another one (the decorations) appear and go with it
}
const rows = {};
for (const control of MATCHA_CONTROLS) {
  const { row, write } = buildControl(withHint(control, MATCHA_HINTS), settings[control.key], (value) => change(control.key, value), { id: "m-" + control.key });
  writers[control.key] = write;
  rows[control.key] = row;
  $("more-controls").append(row);
}
/** The settings that only matter once something is picked (the decoration's size and place) are hidden until it is. */
function showNeeded() {
  for (const control of MATCHA_CONTROLS) {
    if (control.needs) rows[control.key].style.display = settings[control.needs] === "none" ? "none" : "";
    if (control.hideWhen) rows[control.key].style.display = settings[control.hideWhen] === true ? "none" : "";
  }
}
showNeeded();
function syncControls() {
  for (const control of MATCHA_CONTROLS) writers[control.key](settings[control.key]);
  showNeeded();
  decoChips.set(settings.deco);
  paletteChips.set(currentPalette(settings));
}
$("more-reset").addEventListener("click", () => {
  // Everything under More options goes back to how the style was designed; the style, palette and mod icon you picked stay.
  const { style, palette, modIcon } = settings;
  settings = { ...MATCHA_DEFAULTS, ...paletteColors(palette), style, palette, modIcon };
  syncControls();
  fontsReady(matchaFaces(settings), 600).then(refresh);
});

// ── Where chat comes from, and the link ──────────────────────────────────────────────────────────────────────────────────
// A link can name one account (channel= and platform=, or tiktok= or twitch=) or two (tiktok= and twitch=: the page then opens in "Both").
const named = params.has("tiktok") || params.has("twitch") ? sourcesOf(params) : [];
const wanted = named.length === 2 ? "both" : named.length === 1 ? named[0].platform : params.get("platform");
const channelFromLink = named.length ? named[0].channel : params.get("channel") ?? "";
const source = mountSource($("source"), {
  feeds: [feed],
  pace: () => [900, 1900],
  channel: channelFromLink || saved?.channel || "",
  twitch: named.length === 2 ? named[1].channel : saved?.twitch ?? "",
  platform: wanted === "twitch" || wanted === "tiktok" || wanted === "both" ? wanted : saved?.platform ?? "tiktok", // made for a TikTok streamer
  platforms: ["tiktok", "twitch", "both"],
  autoconnect: Boolean(channelFromLink),
  waitlistUrl: document.body.dataset.waitlist || "",
});
const link = $("link");
const hint = $("link-hint");
const alertsLink = $("alerts-link");
const alertsCopy = $("copy-alerts-link");
const alertsHint = $("alerts-hint");
copyButton(alertsCopy, () => alertsLink.value, { label: "Copy alerts link" });
alertsLink.addEventListener("focus", () => alertsLink.select());
const copyBtn = $("copy-link");
copyButton(copyBtn, () => link.value);
link.addEventListener("focus", () => link.select());
chatSizeGuide = mountSizeGuide({
  mode: "chat",
  anchor: link.closest(".linkfield"),
  copyBtn,
  getSize: () => ({
    width: chatPreviewW,
    height: chatPreviewH,
    appHint: source.platform === "twitch" ? "obs" : "tiktok",
  }),
  onPreset: (preset) => {
    chatPreviewW = preset.width;
    chatPreviewH = preset.height;
    width.write(preset.width);
    $("chat").style.setProperty("--preview-w", preset.width + "px");
  },
});
mountSizeGuide({
  mode: "scene",
  anchor: alertsLink.closest(".linkfield"),
  copyBtn: alertsCopy,
  getSize: () => ({
    width: source.platform === "twitch" ? 1920 : 1080,
    height: source.platform === "twitch" ? 1080 : 1920,
    canvas: source.platform === "twitch" ? "landscape" : "vertical",
    appHint: source.platform === "twitch" ? "obs" : "tiktok",
  }),
});
const cloud = mountCloudSave({ kind: "matcha", storeKey: STORE, anchor: link.closest(".linkfield") ?? hint, getUrl: () => link.value, defaultName: "Matcha chat" });
source.onChange(refresh);

fontsReady(matchaFaces(settings), 600).then(refresh);
refresh();
