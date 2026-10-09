// Small colour helpers. The overlay can run in older OBS browsers, so colours are worked out here and handed to the page as plain
// hex or rgba() values, never as color-mix() or oklch() (those need a newer browser engine than some OBS installs ship).

export const HEX = /^#[0-9a-f]{6}$/i;

export const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

export const rgba = (hex, alpha) => `rgba(${rgb(hex).join(",")},${alpha})`;

/** Relative luminance, 0 (black) to 1 (white). */
export function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Text colour that stays readable on `hex`: dark on a light colour, white on a dark one. */
export const inkFor = (hex) => (luminance(hex) > 0.18 ? "#10141a" : "#ffffff");

/** Blends two colours. `share` is how much of `a` there is (0 to 1). */
export function mix(a, b, share) {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const channel = (x, y) => Math.round(x * share + y * (1 - share));
  return "#" + [channel(ar, br), channel(ag, bg), channel(ab, bb)].map((v) => v.toString(16).padStart(2, "0")).join("");
}
