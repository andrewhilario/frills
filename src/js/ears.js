// The little extras that sit on the top edge of a chat bubble: cat ears, bunny ears, a bow and so on. Each design is a fixed drawing of ours
// (never anything a viewer typed), coloured by two classes the stylesheet fills in: "o" is the outside color and "i" the inside color; "r" is
// a line drawn in the outside color. They are plain shapes, so even an old OBS browser draws them. Pure data, so it is tested without a page.

export const EARS = [
  { id: "none", name: "None" },
  { id: "cat", name: "Cat ears" },
  { id: "bunny", name: "Bunny ears" },
  { id: "bear", name: "Bear ears" },
  { id: "fox", name: "Fox ears" },
  { id: "horns", name: "Little horns" },
  { id: "bow", name: "Bow" },
  { id: "halo", name: "Halo" },
];

// The drawing for each design, and how tall it is for 64 wide (the stylesheet uses this to leave room above each bubble).
const SHAPES = {
  cat: { h: 34, body: '<path class="o" d="M3 34 L7 3 L27 34 Z"/><path class="o" d="M61 34 L57 3 L37 34 Z"/><path class="i" d="M9 31 L8.6 14 L21 31 Z"/><path class="i" d="M55 31 L55.4 14 L43 31 Z"/>' },
  bunny: { h: 52, body: '<ellipse class="o" cx="16" cy="38" rx="8" ry="26" transform="rotate(-10 16 38)"/><ellipse class="o" cx="48" cy="38" rx="8" ry="26" transform="rotate(10 48 38)"/><ellipse class="i" cx="16" cy="40" rx="3.6" ry="17" transform="rotate(-10 16 38)"/><ellipse class="i" cx="48" cy="40" rx="3.6" ry="17" transform="rotate(10 48 38)"/>' },
  bear: { h: 16, body: '<circle class="o" cx="12" cy="16" r="12"/><circle class="o" cx="52" cy="16" r="12"/><circle class="i" cx="12" cy="16" r="6.5"/><circle class="i" cx="52" cy="16" r="6.5"/>' },
  fox: { h: 40, body: '<path class="o" d="M2 40 L9 3 L27 40 Z"/><path class="o" d="M62 40 L55 3 L37 40 Z"/><path class="i" d="M9 37 L10 15 L21 37 Z"/><path class="i" d="M55 37 L54 15 L43 37 Z"/>' },
  horns: { h: 30, body: '<path class="o" d="M10 30 C4 18 6 6 14 2 C16 12 24 20 26 30 Z"/><path class="o" d="M54 30 C60 18 58 6 50 2 C48 12 40 20 38 30 Z"/>' },
  bow: { h: 30, body: '<path class="o" d="M32 17 C24 3 5 2 5 15 C5 28 24 27 32 17 Z"/><path class="o" d="M32 17 C40 3 59 2 59 15 C59 28 40 27 32 17 Z"/><circle class="o" cx="32" cy="17" r="6"/><circle class="i" cx="32" cy="17" r="2.6"/>' },
  halo: { h: 16, body: '<ellipse class="r" cx="32" cy="9" rx="24" ry="5.5"/>' },
};

export const EAR_IDS = EARS.map((e) => e.id);

/** The drawing for a design as an SVG string, or "" for "none" and anything that is not a design. */
export function earsMarkup(id) {
  const shape = Object.prototype.hasOwnProperty.call(SHAPES, id) ? SHAPES[id] : null;
  return shape ? `<svg viewBox="0 0 64 ${shape.h}" aria-hidden="true" focusable="false">${shape.body}</svg>` : "";
}

/** How tall a design stands above its bubble, in em for the stylesheet's 3.6em width. */
export const earsHeight = (id) => (Object.prototype.hasOwnProperty.call(SHAPES, id) ? Math.round((SHAPES[id].h / 64) * 3.6 * 100) / 100 : 0);
