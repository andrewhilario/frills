// The matcha looks: six styles made for one streamer, in five matcha palettes, with the same kind of "More options" the general editor
// has. Pure data and checks, like settings.js.
// Their colours are worked out here (not with color-mix() in the stylesheet) so old OBS browsers draw them too.

import { HEX, mix, rgba } from "./color.js";
import { CONTROLS, FONTS, coerce } from "./settings.js";

export const MATCHA_STYLES = [
  { id: "latte", name: "Matcha Latte", note: "Soft cream bubbles that hop in, with a ripple. Cute and gentle. Light on the PC." },
  { id: "glass", name: "Matcha Glass", note: "Frosted panes with a green glow. Dreamy. A bit heavier: the blur costs more on a weak PC." },
  { id: "sticker", name: "Cartoon Sticker", note: "Thick outlines, a hard shadow, a little tilt. Playful and bold. Light." },
  { id: "pixel", name: "Pixel Pond", note: "Pixel borders and a stepped slide. Retro. The lightest of all." },
  { id: "minimal", name: "Clean Broadcast", note: "No boxes, just outlined text. Readable over anything. Very light." },
  { id: "night", name: "Night Matcha", note: "Dark green bubbles with a soft green edge. Calm. Best over bright gameplay." },
];

// Each palette: a cream, an ink, a soft green, a matcha, a deep green and one little pop colour.
export const MATCHA_PALETTES = {
  latte: { name: "Latte", bg: "#f5f0e1", ink: "#33432a", soft: "#e4ebcb", matcha: "#8dae5f", deep: "#4e6b3a", pop: "#f4b8a2" },
  ceremonial: { name: "Ceremonial", bg: "#f3f7dd", ink: "#26401c", soft: "#ddebaa", matcha: "#9cc13e", deep: "#4a7a1e", pop: "#ffd66b" },
  forest: { name: "Forest", bg: "#eef2de", ink: "#1e3524", soft: "#cfddb0", matcha: "#6e9650", deep: "#2f5233", pop: "#f2a65a" },
  sakura: { name: "Sakura", bg: "#fbf6ec", ink: "#3a4a30", soft: "#e8efd2", matcha: "#a5c27b", deep: "#5d7b45", pop: "#f7c0cd" },
  night: { name: "Night", bg: "#1b2a1f", ink: "#eaf2d8", soft: "#2a3d2c", matcha: "#a8cf6a", deep: "#7fa454", pop: "#ffd1a3" },
};

/** The six colours a palette is made of. Each can be changed on its own under "More options". */
export const COLOR_KEYS = ["bg", "ink", "soft", "matcha", "deep", "pop"];

const own = (object, key) => typeof key === "string" && Object.prototype.hasOwnProperty.call(object, key);

/** The colours of a palette (the first one, latte, for a name that isn't one). */
export const paletteColors = (id) => {
  const palette = MATCHA_PALETTES[own(MATCHA_PALETTES, id) ? id : "latte"];
  return Object.fromEntries(COLOR_KEYS.map((key) => [key, palette[key]]));
};

const general = (key) => CONTROLS.find((c) => c.key === key);
const colour = (key, label) => ({ key, where: "more", type: "color", label });
const styleOwn = (label) => ({ id: "", name: label });

/**
 * Everything under "More options", in the order it is shown. The same list builds the panel, checks anything that is loaded or
 * arrives in a link, and writes the link. Settings that mean the same as in the general editor are taken from its list.
 */
export const MATCHA_CONTROLS = [
  colour("matcha", "Matcha green"),
  colour("deep", "Deep green"),
  colour("bg", "Cream"),
  colour("soft", "Soft green"),
  colour("ink", "Text colour"),
  colour("pop", "Gift colour"),
  { key: "scale", where: "more", type: "range", label: "Text size", min: 60, max: 180, step: 5, unit: "%" },
  { key: "font", where: "more", type: "select", label: "Font", options: [styleOwn("The style's own"), ...Object.keys(FONTS).map((f) => ({ id: f, name: f }))] },
  { key: "round", where: "more", type: "range", label: "Roundness", min: 0, max: 200, step: 10, unit: "%", hint: "The corners of the boxes. Pixel Pond and Clean Broadcast have none." },
  { key: "opacity", where: "more", type: "range", label: "Box opacity", min: 0, max: 100, step: 5, unit: "%", hint: "Clean Broadcast has no box, so it ignores this." },
  { key: "anim", where: "more", type: "select", label: "Entrance", options: [styleOwn("The style's own"), ...general("anim").options] },
  { key: "speed", where: "more", type: "range", label: "Entrance speed", min: 150, max: 900, step: 10, unit: " ms", hint: "Used once you pick an entrance above." },
  general("avatar"),
  general("pictures"),
  general("max"),
  general("life"),
  general("space"),
  general("colors"),
  general("emotes"),
];

// The mod icon has its own row of buttons on the page, so it is checked and linked here but not listed under "More options".
const SETTINGS = [general("modIcon"), ...MATCHA_CONTROLS];

export const MATCHA_DEFAULTS = {
  style: "latte",
  palette: "latte",
  ...paletteColors("latte"),
  modIcon: "leaf",
  scale: 100,
  font: "",
  round: 100,
  opacity: 100,
  anim: "",
  speed: 420,
  avatar: true,
  pictures: true,
  max: 6,
  life: 15,
  space: 8,
  colors: false,
  emotes: true,
};

export const isMatchaStyle = (id) => MATCHA_STYLES.some((s) => s.id === id);

/** Checks anything that comes in (a saved choice, or a link). The palette sets the six colours; any colour that came with it wins. */
export function sanitizeMatcha(raw) {
  const out = { ...MATCHA_DEFAULTS };
  if (!raw || typeof raw !== "object") return out;
  if (isMatchaStyle(raw.style)) out.style = raw.style;
  if (own(MATCHA_PALETTES, raw.palette)) out.palette = raw.palette;
  Object.assign(out, paletteColors(out.palette));
  for (const control of SETTINGS) {
    const value = coerce(control, raw[control.key]);
    if (value !== undefined) out[control.key] = value;
  }
  return out;
}

/** A link's query -> raw settings. */
export function matchaFromParams(params) {
  const raw = { style: params.get("style"), palette: params.get("palette") };
  for (const control of SETTINGS) {
    if (!params.has(control.key)) continue;
    const value = params.get(control.key);
    raw[control.key] = control.type === "toggle" ? value === "1" : control.type === "range" ? Number(value) : value;
  }
  return raw;
}

/** The name of the palette whose six colours these settings still match exactly, or null once any has been changed. */
export function currentPalette(settings) {
  const same = (id) => COLOR_KEYS.every((key) => settings[key] === MATCHA_PALETTES[id][key]);
  if (own(MATCHA_PALETTES, settings.palette) && same(settings.palette)) return settings.palette;
  return Object.keys(MATCHA_PALETTES).find(same) ?? null;
}

/** The address a streamer pastes into OBS. A link carries only what differs from the starting point: the palette, then the colours that differ from it. */
export function matchaOverlayUrl(base, { channel = "", settings = MATCHA_DEFAULTS, platform = "twitch" } = {}) {
  const params = new URLSearchParams();
  if (channel) params.set("channel", channel);
  if (channel && platform === "tiktok") params.set("platform", "tiktok");
  params.set("style", settings.style);
  if (settings.palette !== MATCHA_DEFAULTS.palette) params.set("palette", settings.palette);
  const palette = paletteColors(settings.palette);
  for (const control of SETTINGS) {
    const value = settings[control.key];
    const start = COLOR_KEYS.includes(control.key) ? palette[control.key] : MATCHA_DEFAULTS[control.key];
    if (value === start) continue;
    params.set(control.key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
  }
  return base + "?" + params;
}

/**
 * The CSS variables for a look: the six colours (of a palette, or of settings that changed some of them), the blends the styles need,
 * and the sizes. Takes a palette name or a settings object.
 */
export function matchaVars(from) {
  const settings = typeof from === "string" ? { palette: from } : from ?? {};
  const p = paletteColors(settings.palette);
  for (const key of COLOR_KEYS) if (HEX.test(settings[key] ?? "")) p[key] = settings[key];
  const number = (value, fallback) => (Number.isFinite(value) ? value : fallback);
  const fill = number(settings.opacity, 100) / 100; // how much of each box shows, 1 as designed
  const nightBody = mix(p.deep, "#0a120b", 0.38);
  return {
    "--bg": p.bg,
    "--ink": p.ink,
    "--soft": p.soft,
    "--matcha": p.matcha,
    "--deep": p.deep,
    "--pop": p.pop,
    "--matcha-lift": mix(p.matcha, "#ffffff", 0.7),
    "--matcha-a70": rgba(p.matcha, 0.7),
    "--matcha-a55": rgba(p.matcha, 0.55),
    "--night-body": nightBody,
    "--night-av": mix(p.matcha, "#0a120b", 0.7),
    "--outline": "#14240f",
    // The boxes' fills with the opacity applied, for the styles that draw one.
    "--bg-fill": rgba(p.bg, fill),
    "--soft-fill": rgba(p.soft, fill),
    "--night-body-fill": rgba(nightBody, fill),
    "--glass-fill": `rgba(255,255,255,${+(0.14 * fill).toFixed(3)})`,
    "--m-scale": String(number(settings.scale, 100) / 100),
    "--m-round": String(number(settings.round, 100) / 100),
    "--g-space": number(settings.space, 8) + "px",
  };
}
