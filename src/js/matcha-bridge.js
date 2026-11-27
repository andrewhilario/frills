// Shared Matcha studio bridge for all 14 dedicated /matcha/<slug>/ editors:
// reads the active Matcha palette, mascot, and connected TikTok / Twitch / Both channels saved in /matcha/
// so every dedicated Matcha overlay editor opens pre-styled in the saved Matcha palette and aesthetic.

import { LOOKS as ALERT_LOOKS } from "./alerts-settings.js";
import { MATCHA_PALETTES, sanitizeMatcha } from "./matcha.js";

export const MATCHA_STORE_KEY = "frills:matcha:v1";

const VALID_MASCOTS = new Set([
  "frog2", "neko", "hamster", "bunny", "shiba", "capybara", "dino", "astro",
  "skatecat", "dragon", "sakura", "valentine", "summer", "autumn", "anime-xmas", "anime-halloween",
]);

/** Reads the saved Matcha studio settings and channels (or safe defaults if not yet saved). */
export function loadMatchaProfile() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(MATCHA_STORE_KEY) ?? "null");
  } catch { /* storage blocked */ }
  const settings = sanitizeMatcha(saved?.settings ?? {});
  const isDefaultLattePop = settings.palette === "latte" && settings.pop === MATCHA_PALETTES.latte.pop;
  const look = {
    ...ALERT_LOOKS.matcha,
    accent: settings.matcha,
    bg: settings.bg,
    text: settings.ink,
    pop: isDefaultLattePop ? ALERT_LOOKS.matcha.pop : settings.pop,
    ...(settings.font ? { font: settings.font } : {}),
  };
  const mascot = VALID_MASCOTS.has(settings.deco) ? settings.deco : "frog2";
  const platform = saved?.platform === "twitch" || saved?.platform === "both" ? saved.platform : "tiktok";
  const channel = String(saved?.channel ?? "").trim();
  const twitch = String(saved?.twitch ?? "").trim();
  return { settings, look, mascot, platform, channel, twitch };
}

/** Matcha-themed starting settings for a specific dedicated /matcha/<slug>/ editor. */
export function matchaDefaultsFor(slug, profile = loadMatchaProfile()) {
  const { look, mascot, platform, channel, twitch } = profile;
  const cleanHandle = (channel || twitch || "matcha").replace(/^@+/, "");
  const base = { ...look };
  if (slug === "jar") return { ...base, design: "frog", jarSize: "medium", titleText: "Matcha jar" };
  if (slug === "wheel") return { ...base, design: "kawaii" };
  if (slug === "songs") return { ...base, layout: "equalizer" };
  if (slug === "tts") return { ...base, pet: mascot };
  if (slug === "goal") return { ...base, style: "candy", type: platform === "twitch" ? "sub" : "follow" };
  if (slug === "outline") {
    return {
      ...base,
      mode: platform === "twitch" ? "screen16x9" : "screen9x16",
      layout: platform === "twitch" ? "game-cam" : "tt-game-cam",
      frameStyle: "sticker",
      artPack: mascot,
      handle: `@${cleanHandle}`,
    };
  }
  return base;
}
