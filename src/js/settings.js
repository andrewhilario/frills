// A Frills look is plain data. Everything here is pure (no page needed), so it can be tested on its own and shared by the editor,
// the overlay page and the home page: the options, the starting looks, how settings are checked, how they become a link, and how
// they become the CSS variables the chat is drawn with.

import { HEX, inkFor, rgba } from "./color.js";

// The faces a look can use, as the CSS stacks the page sets. Files are self-hosted; each one loads only when a look uses it.
export const FONTS = {
  "Geist": '"Geist", system-ui, sans-serif',
  "Plus Jakarta Sans": '"Plus Jakarta Sans", system-ui, sans-serif',
  "Fredoka": '"Fredoka", system-ui, sans-serif',
  "Baloo 2": '"Baloo 2", system-ui, sans-serif',
  "Bricolage Grotesque": '"Bricolage Grotesque", system-ui, sans-serif',
  "Space Grotesk": '"Space Grotesk", system-ui, sans-serif',
  "JetBrains Mono": '"JetBrains Mono", ui-monospace, monospace',
  "Press Start 2P": '"Press Start 2P", ui-monospace, monospace',
};

// How a message arrives: the CSS animation, and the curve it runs on.
export const ANIMS = {
  none: { name: "none", ease: "linear" },
  fade: { name: "fade", ease: "ease-out" },
  rise: { name: "rise", ease: "ease-out" },
  slide: { name: "slidein", ease: "ease-out" },
  pop: { name: "pop", ease: "cubic-bezier(.2,1.6,.4,1)" },
  hop: { name: "hop", ease: "cubic-bezier(.3,1.4,.5,1)" },
  step: { name: "slidepx", ease: "steps(5)" },
};

export const SHADOWS = {
  none: "none",
  soft: "0 6px 14px -6px rgba(0,0,0,.55)",
  hard: "4px 4px 0 var(--g-accent)",
  glow: "0 0 16px -2px var(--g-accent)",
};

// The starting looks. A look sets only these settings: how many messages, how long, spacing and the icon stay as they are.
export const PRESETS = {
  blueberry: { font: "Geist", size: 18, text: "#f4f6fa", accent: "#9db4ff", pop: "#ffd166", bg: "#10131a", bgAlpha: 78, shape: "filled", borderW: 0, radius: 16, shadow: "soft", blur: 0, anim: "rise", speed: 420, avatar: true },
  frost: { font: "Plus Jakarta Sans", size: 18, text: "#ffffff", accent: "#9ee7ff", pop: "#ffd27a", bg: "#ffffff", bgAlpha: 16, shape: "filled", borderW: 1, radius: 20, shadow: "soft", blur: 10, anim: "rise", speed: 420, avatar: true },
  mint: { font: "Space Grotesk", size: 18, text: "#ffffff", accent: "#7cf0b4", pop: "#ffd27a", bg: "#000000", bgAlpha: 0, shape: "outline", borderW: 2, radius: 12, shadow: "none", blur: 0, anim: "slide", speed: 360, avatar: false },
  bubblegum: { font: "Bricolage Grotesque", size: 18, text: "#fff0fa", accent: "#ff5fc8", pop: "#58f0ff", bg: "#1a0a1f", bgAlpha: 84, shape: "filled", borderW: 2, radius: 14, shadow: "glow", blur: 0, anim: "pop", speed: 380, avatar: true },
  butter: { font: "Baloo 2", size: 19, text: "#2b1d00", accent: "#2b1d00", pop: "#ff9bd0", bg: "#ffe066", bgAlpha: 100, shape: "filled", borderW: 3, radius: 18, shadow: "hard", blur: 0, anim: "pop", speed: 380, avatar: true },
  arcade: { font: "Press Start 2P", size: 13, text: "#e8f6ff", accent: "#59ffa0", pop: "#ffd23f", bg: "#101a2e", bgAlpha: 100, shape: "filled", borderW: 3, radius: 0, shadow: "hard", blur: 0, anim: "step", speed: 360, avatar: true },
  whisper: { font: "Fredoka", size: 21, text: "#ffffff", accent: "#ffd23f", pop: "#ff9bd0", bg: "#000000", bgAlpha: 0, shape: "none", borderW: 0, radius: 0, shadow: "none", blur: 0, anim: "fade", speed: 300, avatar: false },
};

export const PRESET_NAMES = {
  blueberry: "Blueberry", frost: "Frost", mint: "Mint", bubblegum: "Bubblegum", butter: "Butter", arcade: "Arcade", whisper: "Whisper",
};

export const LOOK_KEYS = Object.keys(PRESETS.blueberry);

export const MOD_ICONS = ["shield", "star", "leaf", "frog", "none"];

export const DEFAULTS = { ...PRESETS.blueberry, modIcon: "shield", max: 6, life: 15, space: 8, colors: false, emotes: true, pictures: true };

const list = (...pairs) => pairs.map(([id, name]) => ({ id, name }));

// One entry per control. The same list builds the editor's panel, checks anything that is loaded or arrives in a link, and writes
// the link. `where` says whether it sits up front or under "More options".
export const CONTROLS = [
  { key: "accent", where: "main", type: "color", label: "Accent colour" },
  { key: "bg", where: "main", type: "color", label: "Box colour" },
  { key: "bgAlpha", where: "main", type: "range", label: "Box opacity", min: 0, max: 100, step: 1, unit: "%" },
  { key: "radius", where: "main", type: "range", label: "Roundness", min: 0, max: 32, step: 1, unit: " px" },
  { key: "font", where: "main", type: "select", label: "Font", options: Object.keys(FONTS).map((f) => ({ id: f, name: f })) },
  { key: "size", where: "main", type: "range", label: "Text size", min: 12, max: 34, step: 1, unit: " px" },
  { key: "text", where: "more", type: "color", label: "Text colour" },
  { key: "pop", where: "more", type: "color", label: "Gift colour" },
  { key: "shape", where: "more", type: "chips", label: "Box", options: list(["filled", "Filled"], ["outline", "Outline"], ["none", "Text only"]) },
  { key: "borderW", where: "more", type: "range", label: "Edge thickness", min: 0, max: 6, step: 1, unit: " px" },
  { key: "shadow", where: "more", type: "chips", label: "Shadow", options: list(["none", "None"], ["soft", "Soft"], ["hard", "Hard"], ["glow", "Glow"]) },
  { key: "blur", where: "more", type: "range", label: "Frosted blur", min: 0, max: 20, step: 1, unit: " px", hint: "Looks like frosted glass, but costs more on a weak PC." },
  { key: "anim", where: "more", type: "select", label: "Entrance", options: list(["none", "None"], ["fade", "Fade"], ["rise", "Rise"], ["slide", "Slide"], ["pop", "Pop"], ["hop", "Hop"], ["step", "Pixel steps"]) },
  { key: "speed", where: "more", type: "range", label: "Entrance speed", min: 150, max: 900, step: 10, unit: " ms" },
  { key: "avatar", where: "more", type: "toggle", label: "Show picture", hint: "The round badge beside each message: a letter, or the chatter's own picture." },
  { key: "pictures", where: "more", type: "toggle", label: "Use profile pictures", hint: "TikTok chatters pick their own pictures, so turn this off if you would rather not risk showing one you didn't choose. Twitch has no pictures to show." },
  { key: "modIcon", where: "more", type: "chips", label: "Moderator icon", options: MOD_ICONS.map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1) })) },
  { key: "max", where: "more", type: "range", label: "Messages on screen", min: 2, max: 12, step: 1, unit: "" },
  { key: "life", where: "more", type: "range", label: "Time on screen", min: 0, max: 60, step: 1, unit: " s", zero: "stays" },
  { key: "space", where: "more", type: "range", label: "Spacing", min: 0, max: 24, step: 1, unit: " px" },
  { key: "colors", where: "more", type: "toggle", label: "Viewers' own name colours" },
  { key: "emotes", where: "more", type: "toggle", label: "Show emotes" },
];

/** One value, checked against its control. Returns undefined if it isn't acceptable. */
export function coerce(control, value) {
  if (control.type === "color") return typeof value === "string" && HEX.test(value) ? value.toLowerCase() : undefined;
  if (control.type === "range") {
    const n = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
    return Number.isFinite(n) ? Math.min(control.max, Math.max(control.min, Math.round(n / control.step) * control.step)) : undefined;
  }
  if (control.type === "toggle") return typeof value === "boolean" ? value : undefined;
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
  return out;
}

/** A link's query -> raw settings. `look=blueberry` (or any starting look) sets the base; individual settings win over it. */
export function fromParams(params) {
  const raw = {};
  const look = PRESETS[params.get("look")];
  if (look) Object.assign(raw, look);
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

/** The address a streamer pastes into OBS. `base` is the overlay page's address. Twitch is the default, so only TikTok adds a part. */
export function overlayUrl(base, { channel = "", settings = DEFAULTS, platform = "twitch" } = {}) {
  const params = new URLSearchParams();
  if (channel) params.set("channel", channel);
  if (channel && platform === "tiktok") params.set("platform", "tiktok");
  return base + "?" + toParams(settings, params);
}

/** The name of the starting look these settings still match exactly, or null once they've been changed. */
export function currentPreset(settings) {
  return Object.keys(PRESETS).find((id) => LOOK_KEYS.every((k) => settings[k] === PRESETS[id][k])) ?? null;
}

/**
 * Settings -> what the page needs to draw them: CSS variables for the chat's stage, two data attributes, and the feed's options.
 * Colours are plain hex and rgba() so even old OBS browsers draw them.
 */
export function lookVars(s) {
  const filled = s.shape === "filled";
  const vars = {
    "--g-font": FONTS[s.font],
    "--g-size": s.size + "px",
    "--g-text": s.text,
    "--g-accent": s.accent,
    "--g-accent-ink": inkFor(s.accent),
    "--g-pop": s.pop,
    "--g-pop-ink": inkFor(s.pop),
    "--g-bg": filled ? rgba(s.bg, s.bgAlpha / 100) : "transparent",
    "--g-bw": (s.shape === "none" ? 0 : s.shape === "outline" ? Math.max(2, s.borderW) : s.borderW) + "px",
    "--g-radius": s.radius + "px",
    "--g-shadow": s.shape === "none" ? "none" : SHADOWS[s.shadow],
    "--g-bf": filled && s.blur > 0 ? `blur(${s.blur}px) saturate(1.3)` : "none", // no filter at all when off: it costs even at 0
    "--g-anim": ANIMS[s.anim].name,
    "--g-ease": ANIMS[s.anim].ease,
    "--g-speed": s.speed + "ms",
    "--g-space": s.space + "px",
    "--g-outline": inkFor(s.text) === "#ffffff" ? "#f5f5f5" : "#0b0b0b", // a text outline that contrasts with the text
  };
  return {
    vars,
    attrs: { shape: s.shape, avatar: s.avatar ? "on" : "off" },
    feed: { max: s.max, life: s.life * 1000, modIcon: s.modIcon, colors: s.colors, emotes: s.emotes, pictures: s.pictures },
  };
}
