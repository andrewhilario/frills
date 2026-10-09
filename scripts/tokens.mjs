// Reads colours from tokens.css (they are OKLCH) and gives them back as hex, for the few places that can't use OKLCH:
// the browser's theme-color, the favicon file, and the images the asset script draws.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export function oklchToHex(l, c, h) {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_];
  const enc = (v) => {
    const x = Math.min(1, Math.max(0, v));
    return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
  };
  return "#" + lin.map((v) => enc(v).toString(16).padStart(2, "0")).join("");
}

const css = readFileSync(join(import.meta.dirname, "..", "tokens.css"), "utf8");

/** tokenHex("paper") -> "#f9f6ec" */
export function tokenHex(name) {
  const m = new RegExp(`--color-${name}:\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)`).exec(css);
  if (!m) throw new Error(`tokens.css has no --color-${name}`);
  return oklchToHex(Number(m[1]) / 100, Number(m[2]), Number(m[3]));
}
