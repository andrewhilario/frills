// The editor: pick a look, change anything, connect a channel, copy one link.

import { Feed } from "./feed.js";
import { CONTROLS, DEFAULTS, PRESETS, PRESET_NAMES, currentPreset, overlayUrl, sanitize } from "./settings.js";
import { fontsReady, generalFaces, paintGeneral } from "./look.js";
import { buildControl, chips, copyButton } from "./ui.js";
import { mountSource } from "./source.js";
import { luminance } from "./color.js";

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

// What is remembered in this browser: the settings and the channel. Nothing leaves the page.
const STORE = "frills:editor:v1";
const load = () => { try { return JSON.parse(localStorage.getItem(STORE) ?? "null"); } catch { return null; } };
const saved = load();

let settings = sanitize(saved?.settings);
if (PRESETS[params.get("look")]) Object.assign(settings, PRESETS[params.get("look")]); // a link from the home page: start from that look

const stage = $("stage");
const preview = $("preview");
const feed = new Feed($("chat"));
const paint = () => feed.configure(paintGeneral(stage, settings));

// ── Step 1: the look ──────────────────────────────────────────────────────────────────────────────────────────────────
const swatch = (p) => (luminance(p.accent) < 0.08 ? p.bg : p.accent);
const writers = {};
let presetChips;

function change(key, value) {
  settings[key] = value;
  if (key === "font") fontsReady(generalFaces(settings), 600).then(paint);
  else paint();
  presetChips.set(currentPreset(settings));
  refreshLink();
  save();
}

function syncControls() {
  for (const control of CONTROLS) writers[control.key](settings[control.key]);
  presetChips.set(currentPreset(settings));
}

presetChips = chips(
  $("presets"),
  Object.keys(PRESETS).map((id) => ({ id, name: PRESET_NAMES[id], dot: swatch(PRESETS[id]) })),
  currentPreset(settings),
  (item) => {
    Object.assign(settings, PRESETS[item.id]);
    syncControls();
    fontsReady(generalFaces(settings), 600).then(paint);
    refreshLink();
    save();
  },
  { dot: true },
);

for (const control of CONTROLS) {
  const { row, write } = buildControl(control, settings[control.key], (value) => change(control.key, value));
  writers[control.key] = write;
  $(control.where === "main" ? "main-controls" : "more-controls").append(row);
}

$("reset").addEventListener("click", () => {
  settings = { ...DEFAULTS };
  syncControls();
  paint();
  refreshLink();
  save();
});

// ── Step 2: the chat ──────────────────────────────────────────────────────────────────────────────────────────────────
const channelFromLink = params.get("channel") ?? "";
// TikTok first. A name saved before there were two platforms was a Twitch channel.
const platformFromLink = ["tiktok", "twitch"].includes(params.get("platform")) ? params.get("platform") : "";
const source = mountSource($("source"), {
  feeds: [feed],
  pace: () => [1500, 3000],
  channel: channelFromLink || saved?.channel || "",
  platform: platformFromLink || saved?.platform || (saved?.channel ? "twitch" : "tiktok"),
  autoconnect: Boolean(channelFromLink),
  waitlistUrl: document.body.dataset.waitlist || "",
});

// ── Step 3: the link ──────────────────────────────────────────────────────────────────────────────────────────────────
const linkInput = $("link");
const copyBtn = $("copy-link");
const linkHint = $("link-hint");
copyButton(copyBtn, () => linkInput.value);

function refreshLink() {
  const channel = source.cleanChannel();
  if (!channel) {
    linkInput.value = "";
    copyBtn.disabled = true;
    linkHint.textContent = "Your link appears here once you have typed your TikTok name or Twitch channel in step 2.";
    return;
  }
  linkInput.value = overlayUrl(`${location.origin}/overlay/`, { channel, settings, platform: source.platform });
  copyBtn.disabled = false;
  // Through the site’s relay a link works anywhere. A link made with the helper points at the helper on this PC, so it only works here.
  linkHint.replaceChildren(source.platform === "tiktok" && !source.usesRelay ? "Paste it into a Browser source in your streaming app on this PC. It only works while the Frills helper is running. " : "Paste it into a Browser source in your streaming app. ");
  const guide = document.createElement("a");
  guide.href = "/guides/obs/";
  guide.textContent = "Step by step";
  const test = document.createElement("a");
  test.href = "/guides/test/";
  test.textContent = "Not LIVE yet? Test it first";
  linkHint.append(guide, ". ", test, ".");
}
linkInput.addEventListener("focus", () => linkInput.select());
source.onChange(() => { refreshLink(); save(); });

function save() {
  try { localStorage.setItem(STORE, JSON.stringify({ settings, channel: source.channel, platform: source.platform })); } catch { /* storage can be blocked; the editor still works */ }
}

// ── The preview itself: what sits behind the chat, and how wide it is ─────────────────────────────────────────────────
$("backdrop").addEventListener("change", (event) => { preview.dataset.back = event.target.value; });
const width = buildControl({ key: "previewW", type: "range", label: "Preview width", min: 280, max: 720, step: 10, unit: " px" }, 440, (value) => $("chat").style.setProperty("--preview-w", value + "px"), { id: "c-previewW" });
$("preview-width").append(width.row);

paint();
refreshLink();
