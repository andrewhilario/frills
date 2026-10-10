// Alerts are plain data, like chat looks: one list of options builds the editor, checks anything that arrives (saved in the browser, or in
// a link), and writes the link. Everything here is pure, so it is tested without a page.

import { HEX } from "./color.js";
import { FONTS } from "./settings.js";

export const KINDS = ["follow", "gift", "share"];
export const KIND_NAMES = { follow: "Follow", gift: "Gift", share: "Share" };

/** The sounds, by id. The sounds themselves are made in sounds.js. */
export const SOUNDS = [
  { id: "none", name: "No sound" },
  { id: "chime", name: "Chime" },
  { id: "pop", name: "Pop" },
  { id: "bell", name: "Bell" },
  { id: "sparkle", name: "Sparkle" },
  { id: "levelup", name: "Level up" },
  { id: "coin", name: "Coin" },
  { id: "boop", name: "Boop" },
  { id: "bubble", name: "Bubble" },
  { id: "fanfare", name: "Fanfare" },
];

export const FX = [
  { id: "none", name: "None" },
  { id: "hearts", name: "Hearts" },
  { id: "sparkles", name: "Sparkles" },
  { id: "confetti", name: "Confetti" },
  { id: "bubbles", name: "Bubbles" },
];

/** The starting looks. A look sets only these settings. */
export const LOOKS = {
  sticker: { font: "Baloo 2", size: 40, text: "#2b1d00", accent: "#ffd23f", pop: "#d93a78", bg: "#fff6d6", border: 3, radius: 22, shadow: "hard" },
  matcha: { font: "Fredoka", size: 40, text: "#33432a", accent: "#8dae5f", pop: "#c4572f", bg: "#f5f0e1", border: 2, radius: 28, shadow: "soft" },
  night: { font: "Plus Jakarta Sans", size: 36, text: "#f4f6fa", accent: "#9db4ff", pop: "#ffd166", bg: "#10131a", border: 2, radius: 18, shadow: "glow" },
  bubblegum: { font: "Bricolage Grotesque", size: 40, text: "#fff0fa", accent: "#ff5fc8", pop: "#58f0ff", bg: "#1a0a1f", border: 2, radius: 16, shadow: "glow" },
  arcade: { font: "Press Start 2P", size: 24, text: "#e8f6ff", accent: "#59ffa0", pop: "#ffd23f", bg: "#101a2e", border: 3, radius: 0, shadow: "hard" },
};
export const LOOK_NAMES = { sticker: "Sticker", matcha: "Matcha", night: "Night", bubblegum: "Bubblegum", arcade: "Arcade" };
export const LOOK_KEYS = Object.keys(LOOKS.sticker);

const list = (...pairs) => pairs.map(([id, name]) => ({ id, name }));

/** What each placeholder in a text means, for the editor's hint and for filling a template. */
export const PLACEHOLDERS = ["name", "gift", "count", "diamonds", "total", "others"];

export const DEFAULTS = {
  ...LOOKS.sticker,
  // where it sits
  vpos: "top", hpos: "center", offset: 8,
  // how it moves
  enter: "pop", leave: "fade", idle: "float", speed: 500,
  // how many, and how a crowd is handled
  maxShown: 2, maxWaiting: 8, merge: true,
  // sound and pictures
  volume: 70, avatar: true, giftPicture: true,
  // each kind
  followOn: true, followText: "{name} just followed!", followCrowd: "{name} and {others} others followed!", followSound: "chime", followTime: 4, followFx: "hearts",
  giftOn: true, giftText: "{name} sent {gift} ×{count}", giftBigText: "{name} sent {gift} ×{count}!!", giftSound: "coin", giftTime: 5, giftFx: "confetti", giftMid: 100, giftBig: 1000, giftMin: 0,
  shareOn: true, shareText: "{name} shared the LIVE!", shareCrowd: "{name} and {others} others shared!", shareSound: "pop", shareTime: 4, shareFx: "sparkles",
};

const text = (key, label, hint) => ({ key, type: "text", label, max: 80, hint });
const range = (key, label, min, max, step, unit, extra = {}) => ({ key, type: "range", label, min, max, step, unit, ...extra });
const toggle = (key, label, hint) => ({ key, type: "toggle", label, hint });
const select = (key, label, options, hint) => ({ key, type: "select", label, options, hint });
const chipsOf = (key, label, options) => ({ key, type: "chips", label, options });

/**
 * One entry per option. `section` says where the editor puts it: look, move, queue, or the kind it belongs to (follow, gift, share).
 */
export const CONTROLS = [
  // look
  { section: "look", key: "accent", type: "color", label: "Accent colour" },
  { section: "look", key: "bg", type: "color", label: "Card colour" },
  { section: "look", key: "text", type: "color", label: "Text colour" },
  { section: "look", key: "pop", type: "color", label: "Highlight colour", hint: "The colour of the name and the gift." },
  { section: "look", key: "font", type: "select", label: "Font", options: Object.keys(FONTS).map((f) => ({ id: f, name: f })) },
  { section: "look", ...range("size", "Text size", 16, 96, 1, " px", { hint: "In pixels of the page your streaming app shows. A vertical LIVE is 1080 wide." }) },
  { section: "look", ...range("radius", "Roundness", 0, 60, 1, " px") },
  { section: "look", ...range("border", "Edge thickness", 0, 12, 1, " px") },
  { section: "look", ...chipsOf("shadow", "Shadow", list(["none", "None"], ["soft", "Soft"], ["hard", "Hard"], ["glow", "Glow"])) },
  { section: "look", ...toggle("avatar", "Show the person's picture") },
  { section: "look", ...toggle("giftPicture", "Show the gift's picture") },
  // where and how it moves
  { section: "move", ...chipsOf("vpos", "Up and down", list(["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"])) },
  { section: "move", ...chipsOf("hpos", "Left and right", list(["left", "Left"], ["center", "Middle"], ["right", "Right"])) },
  { section: "move", ...range("offset", "Distance from the edge", 0, 40, 1, " %", { hint: "TikTok's own buttons cover the bottom and the right edge of a vertical LIVE." }) },
  { section: "move", ...select("enter", "How it arrives", list(["pop", "Pop"], ["bounce", "Bounce"], ["slide", "Slide in"], ["drop", "Drop down"], ["zoom", "Zoom"], ["fade", "Fade"])) },
  { section: "move", ...select("leave", "How it leaves", list(["fade", "Fade"], ["slide", "Slide away"], ["shrink", "Shrink"])) },
  { section: "move", ...select("idle", "While it shows", list(["none", "Still"], ["float", "Float"], ["wiggle", "Wiggle"], ["pulse", "Pulse"])) },
  { section: "move", ...range("speed", "Animation speed", 250, 1000, 50, " ms") },
  // the queue
  { section: "queue", ...range("maxShown", "Alerts at once", 1, 3, 1, "") },
  { section: "queue", ...range("maxWaiting", "Waiting in line", 1, 20, 1, "", { hint: "When more are waiting, the oldest follows and shares are dropped first. Gifts are kept longest." }) },
  { section: "queue", ...toggle("merge", "Join a crowd into one alert", "Many follows in a row become “Mochi and 5 others followed!”.") },
  { section: "queue", ...range("volume", "Volume", 0, 100, 5, " %") },
  // follow
  { section: "follow", ...toggle("followOn", "Show follows") },
  { section: "follow", ...text("followText", "Text") },
  { section: "follow", ...text("followCrowd", "Text for a crowd") },
  { section: "follow", ...select("followSound", "Sound", SOUNDS.map(({ id, name }) => [id, name])) },
  { section: "follow", ...select("followFx", "Effect", FX.map(({ id, name }) => [id, name])) },
  { section: "follow", ...range("followTime", "Seconds on screen", 2, 15, 1, " s") },
  // gift
  { section: "gift", ...toggle("giftOn", "Show gifts") },
  { section: "gift", ...text("giftText", "Text") },
  { section: "gift", ...text("giftBigText", "Text for a big gift") },
  { section: "gift", ...select("giftSound", "Sound", SOUNDS.map(({ id, name }) => [id, name])) },
  { section: "gift", ...select("giftFx", "Effect", FX.map(({ id, name }) => [id, name])) },
  { section: "gift", ...range("giftTime", "Seconds on screen", 2, 15, 1, " s") },
  { section: "gift", ...range("giftMin", "Smallest gift to show", 0, 1000, 1, " diamonds", { zero: "every gift" }) },
  { section: "gift", ...range("giftMid", "A medium gift is at least", 1, 5000, 1, " diamonds", { hint: "Medium gifts stay longer, get a bigger effect and a higher sound." }) },
  { section: "gift", ...range("giftBig", "A big gift is at least", 1, 50000, 1, " diamonds", { hint: "Big gifts get the biggest effect, the longest time and the big-gift text." }) },
  // share
  { section: "share", ...toggle("shareOn", "Show shares") },
  { section: "share", ...text("shareText", "Text") },
  { section: "share", ...text("shareCrowd", "Text for a crowd") },
  { section: "share", ...select("shareSound", "Sound", SOUNDS.map(({ id, name }) => [id, name])) },
  { section: "share", ...select("shareFx", "Effect", FX.map(({ id, name }) => [id, name])) },
  { section: "share", ...range("shareTime", "Seconds on screen", 2, 15, 1, " s") },
].map((c) => (Array.isArray(c.options) && Array.isArray(c.options[0]) ? { ...c, options: list(...c.options) } : c));

const byKey = Object.fromEntries(CONTROLS.map((c) => [c.key, c]));

/** One value, checked against its control. Returns undefined if it isn't acceptable. */
export function coerce(control, value) {
  if (control.type === "color") return typeof value === "string" && HEX.test(value) ? value.toLowerCase() : undefined;
  if (control.type === "range") {
    const n = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
    return Number.isFinite(n) ? Math.min(control.max, Math.max(control.min, Math.round(n / control.step) * control.step)) : undefined;
  }
  if (control.type === "toggle") return typeof value === "boolean" ? value : undefined;
  if (control.type === "text") {
    if (typeof value !== "string") return undefined;
    return value.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, control.max);
  }
  return control.options.some((o) => o.id === value) ? value : undefined;
}

/** Anything that comes in (saved in the browser, or in a link) goes through here first. Unknown keys and bad values are dropped. */
export function sanitize(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== "object") return out;
  for (const control of CONTROLS) {
    const value = coerce(control, raw[control.key]);
    if (value !== undefined) out[control.key] = value;
  }
  // A medium gift can't be bigger than a big one.
  if (out.giftMid > out.giftBig) out.giftMid = out.giftBig;
  return out;
}

/** A link's query -> raw settings. `look=night` (or any starting look) sets the base; individual settings win over it. */
export function fromParams(params) {
  const raw = {};
  if (LOOKS[params.get("look")]) Object.assign(raw, LOOKS[params.get("look")]);
  for (const control of CONTROLS) {
    if (!params.has(control.key)) continue;
    const value = params.get(control.key);
    raw[control.key] = control.type === "toggle" ? value === "1" : control.type === "range" ? Number(value) : value;
  }
  return raw;
}

/** Settings -> the part of a link that differs from the defaults, in a fixed order. */
export function toParams(settings, params = new URLSearchParams()) {
  for (const control of CONTROLS) {
    const value = settings[control.key];
    if (value === DEFAULTS[control.key]) continue;
    params.set(control.key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
  }
  return params;
}

/** The address a streamer pastes into their streaming app. `base` is the alerts overlay page's address. */
export function alertsUrl(base, { channel = "", settings = DEFAULTS } = {}) {
  const params = new URLSearchParams();
  if (channel) {
    params.set("channel", channel);
    params.set("platform", "tiktok");
  }
  return base + "?" + toParams(settings, params);
}

/** The name of the starting look these settings still match exactly, or null once they've been changed. */
export const currentLook = (settings) => Object.keys(LOOKS).find((id) => LOOK_KEYS.every((k) => settings[k] === LOOKS[id][k])) ?? null;

/** The overlay's look as CSS variables (plain colours, so even an old browser draws them). */
export function alertVars(s) {
  const shadows = { none: "none", soft: "0 6px 14px -6px rgba(0,0,0,.55)", hard: `5px 5px 0 ${s.accent}`, glow: `0 0 18px -2px ${s.accent}` };
  return {
    "--a-font": FONTS[s.font],
    "--a-size": s.size + "px",
    "--a-text": s.text,
    "--a-accent": s.accent,
    "--a-pop": s.pop,
    "--a-bg": s.bg,
    "--a-border": s.border + "px",
    "--a-radius": s.radius + "px",
    "--a-shadow": shadows[s.shadow],
    "--a-speed": s.speed + "ms",
    "--a-offset": s.offset + "%",
  };
}

export { byKey as CONTROL_BY_KEY };
