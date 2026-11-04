// The matcha page, laid out like the editor: one live preview that stays put, and beside it a style, a palette, a mod icon, pictures and "More options" to pick,
// where chat comes from, and the links (the chat, and the frog pond alerts, which have a second preview behind a tab).

import { Feed, ICONS, el } from "./feed.js";
import { MATCHA_CONTROLS, MATCHA_DEFAULTS, MATCHA_PALETTES, MATCHA_STYLES, currentPalette, matchaFromParams, matchaOverlayUrl, paletteColors, sanitizeMatcha } from "./matcha.js";
import { MOD_ICONS } from "./settings.js";
import { DECOS } from "./decor.js";
import { fontsReady, matchaFaces, paintMatcha } from "./look.js";
import { buildControl, chips, copyButton } from "./ui.js";
import { mountSource } from "./source.js";
import { sourcesOf } from "./both.js";
import { DEFAULTS as ALERT_DEFAULTS, LOOKS as ALERT_LOOKS, alertsUrl } from "./alerts-settings.js";

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

// The frog pond alerts: the alerts page's Matcha look wearing the frog pond pictures (a setting that only the Matcha editor offers). The practice page is
// only loaded when its tab is first opened, and it is 1080 wide by 560 high: it is shrunk to the room the preview has.
const ALERT_FROG = { ...ALERT_DEFAULTS, ...ALERT_LOOKS.matcha, deco: "frog2" };
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
    alertsFrame.src = alertsUrl("/overlay/alerts/", { settings: ALERT_FROG }) + "&demo=1&pace=2400&maxShown=1&vpos=middle&hpos=center";
    alertsStage.append(alertsFrame);
  }
  fitAlerts();
}
$("view-chat").addEventListener("click", () => showView("chat"));
$("view-alerts").addEventListener("click", () => showView("alerts"));

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
  link.value = ready ? matchaOverlayUrl(`${location.origin}/overlay/`, { channel, settings, platform: source.platform, both: names }) : "";
  copyBtn.disabled = !ready;
  const alertName = both ? names.tiktok : channel; // alerts come from one account: in "Both" it is the TikTok one
  const alertPlatform = source.platform === "twitch" ? "twitch" : "tiktok";
  alertsLink.value = alertName ? alertsUrl(`${location.origin}/overlay/alerts/`, { channel: alertName, settings: ALERT_FROG, platform: alertPlatform }) : "";
  alertsCopy.disabled = !alertName;
  alertsHint.textContent = alertName ? "Paste it into a Browser source in your streaming app: 1080 wide by 1920 high for a vertical LIVE." : "Type your TikTok name above and the alerts link appears here.";
  hint.textContent = !ready ? (both ? "Type your TikTok name and your Twitch channel above and your link appears here." : "Type your TikTok name or Twitch channel above and your link appears here.") : (source.platform === "tiktok" || both) && !source.usesRelay ? "This link only works on this PC, while the Frills helper is running." : "";
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
const width = buildControl({ key: "previewW", type: "range", label: "Width", min: 280, max: 720, step: 10, unit: " px" }, 440, (value) => $("chat").style.setProperty("--preview-w", value + "px"), { id: "c-previewW" });
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
  const { row, write } = buildControl(control, settings[control.key], (value) => change(control.key, value), { id: "m-" + control.key });
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
source.onChange(refresh);

fontsReady(matchaFaces(settings), 600).then(refresh);
refresh();
