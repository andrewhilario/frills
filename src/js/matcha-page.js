// The matcha page: six styles side by side, a palette, a mod icon and "More options" to pick, and the link for the style you choose.

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

// The frog pond alerts: the alerts page's Matcha look with the frog pond card (a card style that only this page offers).
const ALERT_FROG = { ...ALERT_DEFAULTS, ...ALERT_LOOKS.matcha, card: "frogpond" };
const alertsStage = $("alerts-stage");
const alertsFrame = el("iframe", { className: "matcha-alerts__frame", title: "Frog pond alerts on made-up follows, gifts and shares", loading: "lazy", tabIndex: -1 });
alertsFrame.setAttribute("aria-hidden", "true");
alertsFrame.src = alertsUrl("/overlay/alerts/", { settings: ALERT_FROG }) + "&demo=1&pace=2400&maxShown=1&vpos=middle&hpos=center";
alertsStage.append(alertsFrame);
/** The practice alerts page is 1080 wide; shrink it to the room there is. */
const fitAlerts = () => {
  const k = Math.max(0.1, alertsStage.clientWidth / 1080);
  alertsFrame.style.transform = `scale(${k.toFixed(4)})`;
  alertsStage.style.height = Math.round(560 * k) + "px";
};
new ResizeObserver(fitAlerts).observe(alertsStage);
fitAlerts();

const grid = $("matcha-grid");
const cards = MATCHA_STYLES.map((style, index) => {
  const stage = el("div", { className: "chatstage" });
  const chat = el("div", { className: "chatbox" });
  stage.append(chat);
  const pick = el("button", { type: "button", className: "btn btn--soft btn--sm", textContent: "Use this style" });
  pick.addEventListener("click", () => {
    settings.style = style.id;
    refresh();
  });
  const card = el(
    "article",
    { className: "matcha-card" },
    el("div", { className: "matcha-card__head" }, el("h2", { className: "subtitle", textContent: `${index + 1} · ${style.name}` }), el("p", { textContent: style.note })),
    el("div", { className: "matcha-card__stage", id: `stage-${style.id}` }, stage),
    el("div", { className: "matcha-card__foot" }, pick),
  );
  grid.append(card);
  return { style, stage, card, feed: new Feed(chat), back: card.querySelector(".matcha-card__stage") };
});

function paintAll() {
  for (const c of cards) c.feed.configure(paintMatcha(c.stage, { ...settings, style: c.style.id }));
}

function save() {
  try { localStorage.setItem(STORE, JSON.stringify({ settings, channel: source.channel, twitch: source.twitchChannel, platform: source.platform })); } catch { /* storage can be blocked; the page still works */ }
}

function refresh() {
  paintAll();
  for (const c of cards) c.card.dataset.picked = String(c.style.id === settings.style);
  const both = source.platform === "both";
  const names = both ? source.cleanChannels() : null; // in "both" the link needs each of the two accounts
  const channel = source.cleanChannel();
  const ready = both ? Boolean(names.tiktok && names.twitch) : Boolean(channel);
  const on = both && settings.source !== "none"; // one chat reading TikTok and Twitch: a small icon before each name
  for (const c of cards) c.feed.configure({ markPlatform: on });
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

// ── The quick choices: palette, mod icon, what sits behind the chat ───────────────────────────────────────────────────────
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
chips(
  $("backs"),
  [{ id: "dark", name: "Dark game" }, { id: "bright", name: "Bright game" }, { id: "busy", name: "Busy scene" }],
  "dark",
  (item) => { cards.forEach((c) => { c.back.dataset.back = item.id; }); $("alerts-stage").dataset.back = item.id; },
);

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
  for (const control of MATCHA_CONTROLS) if (control.needs) rows[control.key].style.display = settings[control.needs] === "none" ? "none" : "";
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
  feeds: cards.map((c) => c.feed),
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
