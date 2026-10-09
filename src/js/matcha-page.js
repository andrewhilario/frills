// The matcha page: six styles side by side, a palette, a mod icon and "More options" to pick, and the link for the style you choose.

import { Feed, ICONS, el } from "./feed.js";
import { MATCHA_CONTROLS, MATCHA_DEFAULTS, MATCHA_PALETTES, MATCHA_STYLES, currentPalette, matchaFromParams, matchaOverlayUrl, paletteColors, sanitizeMatcha } from "./matcha.js";
import { MOD_ICONS } from "./settings.js";
import { fontsReady, matchaFaces, paintMatcha } from "./look.js";
import { buildControl, chips, copyButton } from "./ui.js";
import { mountSource } from "./source.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// What is remembered in this browser: the settings, the account and where it streams. Nothing leaves the page.
const STORE = "frills:matcha:v1";
const load = () => { try { return JSON.parse(localStorage.getItem(STORE) ?? "null"); } catch { return null; } };
const saved = load();

// A link (the style, the palette, anything under More options) wins over what was remembered, unless what it says isn't a number.
const fromLink = Object.fromEntries(Object.entries(matchaFromParams(params)).filter(([, value]) => value !== null && value !== undefined && !Number.isNaN(value)));
let settings = sanitizeMatcha({ ...saved?.settings, ...fromLink });

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
  try { localStorage.setItem(STORE, JSON.stringify({ settings, channel: source.channel, platform: source.platform })); } catch { /* storage can be blocked; the page still works */ }
}

function refresh() {
  paintAll();
  for (const c of cards) c.card.dataset.picked = String(c.style.id === settings.style);
  const channel = source.cleanChannel();
  link.value = channel ? matchaOverlayUrl(`${location.origin}/overlay/`, { channel, settings, platform: source.platform }) : "";
  copyBtn.disabled = !channel;
  hint.textContent = !channel ? "Type your TikTok name or Twitch channel above and your link appears here." : source.platform === "tiktok" && !source.usesRelay ? "This link only works on this PC, while the Frills helper is running." : "";
  save();
}

// ── The quick choices: palette, mod icon, what sits behind the chat ───────────────────────────────────────────────────────
const paletteChips = chips(
  $("palettes"),
  Object.entries(MATCHA_PALETTES).map(([id, p]) => ({ id, name: p.name, dot: p.matcha })),
  currentPalette(settings),
  (item) => {
    settings.palette = item.id;
    Object.assign(settings, paletteColors(item.id)); // a palette sets all six colours; they can be changed one by one under More options
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
chips(
  $("backs"),
  [{ id: "dark", name: "Dark game" }, { id: "bright", name: "Bright game" }, { id: "busy", name: "Busy scene" }],
  "dark",
  (item) => cards.forEach((c) => { c.back.dataset.back = item.id; }),
);

// ── More options: built from the same kind of list the editor uses ────────────────────────────────────────────────────────
const writers = {};
function change(key, value) {
  settings[key] = value;
  paletteChips.set(currentPalette(settings)); // no palette looks pressed once a colour has been changed
  if (key === "font") fontsReady(matchaFaces(settings), 600).then(refresh);
  else refresh();
}
for (const control of MATCHA_CONTROLS) {
  const { row, write } = buildControl(control, settings[control.key], (value) => change(control.key, value), { id: "m-" + control.key });
  writers[control.key] = write;
  $("more-controls").append(row);
}
function syncControls() {
  for (const control of MATCHA_CONTROLS) writers[control.key](settings[control.key]);
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
const wanted = params.get("platform");
const source = mountSource($("source"), {
  feeds: cards.map((c) => c.feed),
  pace: () => [900, 1900],
  channel: params.get("channel") ?? saved?.channel ?? "",
  platform: wanted === "twitch" || wanted === "tiktok" ? wanted : saved?.platform ?? "tiktok", // made for a TikTok streamer
  autoconnect: Boolean(params.get("channel")),
  waitlistUrl: document.body.dataset.waitlist || "",
});
const link = $("link");
const hint = $("link-hint");
const copyBtn = $("copy-link");
copyButton(copyBtn, () => link.value);
link.addEventListener("focus", () => link.select());
source.onChange(refresh);

fontsReady(matchaFaces(settings), 600).then(refresh);
refresh();
