// The seasonal chat looks, apart from settings.js on purpose: only the editors need them (the overlay in OBS does not), so the overlay page stays light.

import { PRESETS, PRESET_NAMES } from "./settings.js";

// Seasonal looks. The editors offer a season's looks first while it lasts (see season.js) and stop when it is over, but every one is understood all year by the
// editors: an editor address that names one (`/editor/?look=pumpkin`) still applies it, and an overlay made with one keeps working, because its link carries every value. Each also turns on its season's decoration pack (halloween,
// christmas), which can be switched off again; the usual looks leave the decorations as they are.
export const SEASONAL = {
  halloween: {
    pumpkin: { font: "Baloo 2", size: 19, text: "#fff3e0", accent: "#ff8a1f", pop: "#b6ff5a", bg: "#1c0f06", bgAlpha: 90, shape: "filled", borderW: 3, radius: 18, shadow: "hard", blur: 0, anim: "hop", speed: 380, avatar: true, deco: "halloween" },
    ghost: { font: "Fredoka", size: 20, text: "#ffffff", accent: "#cdbdff", pop: "#ffd27a", bg: "#ffffff", bgAlpha: 14, shape: "filled", borderW: 1, radius: 24, shadow: "glow", blur: 10, anim: "fade", speed: 520, avatar: true, deco: "halloween" },
    witch: { font: "Bricolage Grotesque", size: 18, text: "#f3e8ff", accent: "#7dff4a", pop: "#ff7a1a", bg: "#1b0b33", bgAlpha: 92, shape: "filled", borderW: 2, radius: 12, shadow: "glow", blur: 0, anim: "pop", speed: 380, avatar: true, deco: "halloween" },
    bloodmoon: { font: "Space Grotesk", size: 18, text: "#f4f1f6", accent: "#ff3b4a", pop: "#ffd166", bg: "#08070d", bgAlpha: 94, shape: "filled", borderW: 2, radius: 4, shadow: "hard", blur: 0, anim: "slide", speed: 360, avatar: true, deco: "halloween" },
  },
  christmas: {
    candycane: { font: "Baloo 2", size: 19, text: "#ffffff", accent: "#ffffff", pop: "#ffe27a", bg: "#c0152f", bgAlpha: 94, shape: "filled", borderW: 3, radius: 20, shadow: "hard", blur: 0, anim: "hop", speed: 380, avatar: true, deco: "christmas" },
    pine: { font: "Plus Jakarta Sans", size: 18, text: "#fff8e7", accent: "#ffd24a", pop: "#ff6a78", bg: "#0f3d2a", bgAlpha: 92, shape: "filled", borderW: 2, radius: 16, shadow: "soft", blur: 0, anim: "rise", speed: 420, avatar: true, deco: "christmas" },
    snowfall: { font: "Fredoka", size: 20, text: "#ffffff", accent: "#8fd8ff", pop: "#ffd24a", bg: "#0b2540", bgAlpha: 84, shape: "filled", borderW: 2, radius: 26, shadow: "glow", blur: 0, anim: "rise", speed: 460, avatar: true, deco: "christmas" },
    cozy: { font: "Baloo 2", size: 19, text: "#3a1d12", accent: "#c1272d", pop: "#1f7a4d", bg: "#fff4e0", bgAlpha: 100, shape: "filled", borderW: 3, radius: 14, shadow: "hard", blur: 0, anim: "pop", speed: 380, avatar: true, deco: "christmas" },
  },
};
export const SEASONAL_NAMES = {
  pumpkin: "Pumpkin patch", ghost: "Friendly ghost", witch: "Witch's brew", bloodmoon: "Blood moon",
  candycane: "Candy cane", pine: "Pine and gold", snowfall: "Snowfall", cozy: "Cozy knit",
};
/** Every seasonal look by its id, whatever the season. */
export const SEASON_PRESETS = Object.assign({}, ...Object.values(SEASONAL));

/** The starting looks an editor offers in a season (null: between seasons): that season's first, then the usual ones. Each is { id, name, preset, season? }. */
export const looksFor = (season) => [
  ...Object.entries(Object.prototype.hasOwnProperty.call(SEASONAL, season) ? SEASONAL[season] : {}).map(([id, preset]) => ({ id, name: SEASONAL_NAMES[id], preset, season })),
  ...Object.keys(PRESETS).map((id) => ({ id, name: PRESET_NAMES[id], preset: PRESETS[id] })),
];
