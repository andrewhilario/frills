// Decorations for the chat bubbles: little pictures laid over a bubble's edges (a friend peeking over the top, a small scene on a bottom corner,
// sparkles around it). A PACK is a set of such pieces in one mood. "Frog pond" uses pictures (loaded from this site, only when the pack is
// chosen); "Plain shapes" is drawn in code and takes the look's own colors, so it suits any look. More packs add a name and their pieces here.
// Pure data and small functions, so it is tested without a page.

export const DECOS = [
  { id: "none", name: "None" },
  { id: "frog", name: "Frog pond" },
  { id: "shapes", name: "Plain shapes" },
];
export const DECO_IDS = DECOS.map((d) => d.id);

// Shapes drawn in code. The classes are filled by the stylesheet: "o" with the first color, "i" with the second (--deco and --deco-in).
const svg = (box, body) => `<svg viewBox="0 0 ${box}" aria-hidden="true" focusable="false">${body}</svg>`;
export const SHAPES = {
  bow: { box: "64 30", markup: svg("64 30", '<path class="o" d="M32 17 C24 3 5 2 5 15 C5 28 24 27 32 17 Z"/><path class="o" d="M32 17 C40 3 59 2 59 15 C59 28 40 27 32 17 Z"/><circle class="o" cx="32" cy="17" r="6"/><circle class="i" cx="32" cy="17" r="2.6"/>') },
  flower: { box: "40 40", markup: svg("40 40", '<circle class="o" cx="20" cy="9" r="7.5"/><circle class="o" cx="30" cy="16.5" r="7.5"/><circle class="o" cx="26.2" cy="28.5" r="7.5"/><circle class="o" cx="13.8" cy="28.5" r="7.5"/><circle class="o" cx="10" cy="16.5" r="7.5"/><circle class="i" cx="20" cy="20" r="5.5"/>') },
  sparkle: { box: "40 40", markup: svg("40 40", '<path class="o" d="M20 2 C22 14 26 18 38 20 C26 22 22 26 20 38 C18 26 14 22 2 20 C14 18 18 14 20 2 Z"/>') },
  heart: { box: "40 36", markup: svg("40 36", '<path class="o" d="M20 34 C6 24 2 16 2 11 C2 5 7 2 12 2 C16 2 19 5 20 8 C21 5 24 2 28 2 C33 2 38 5 38 11 C38 16 34 24 20 34 Z"/>') },
  star: { box: "40 40", markup: svg("40 40", '<path class="o" stroke-linejoin="round" stroke-width="3" d="M20 3 L25 15 L38 16 L28 24.5 L31.5 37 L20 30 L8.5 37 L12 24.5 L2 16 L15 15 Z"/>') },
};

// The pieces of each pack, by where they sit. A piece is a picture ({ src }) or a shape ({ shape }). `peek` goes on the top edge, `corner` on a
// bottom corner, `spark` scattered around. A role with no pieces is simply left out.
export const PACKS = {
  frog: {
    peek: [], // the peeking frogs are still to come (see ASSET-PROMPTS.txt)
    corner: [{ src: "/decor/frog/corner-pond.webp" }, { src: "/decor/frog/corner-lily.webp" }], // the frog on its lily pad, and the lotus (each message gets one)
    spark: [{ src: "/decor/frog/sparkle-a.webp" }, { src: "/decor/frog/sparkle-b.webp" }, { src: "/decor/frog/sparkle-c.webp" }],
  },
  shapes: {
    peek: [{ shape: "bow" }],
    corner: [{ shape: "flower" }],
    spark: [{ shape: "sparkle" }, { shape: "heart" }, { shape: "star" }],
  },
};

/** A small number from any text (a message's id), so the same message always gets the same pieces and a chat is not copy-pasted. */
export function seedOf(text) {
  let h = 2166136261;
  for (const c of String(text ?? "")) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** The pieces for one message: { peek, corner, spark: [..3] } (each a piece, or null / an empty list), from the pack and the seed. */
export function decoPieces(deco, seed = 0, { peek = true, corner = true, spark = true } = {}) {
  const pack = Object.prototype.hasOwnProperty.call(PACKS, deco) ? PACKS[deco] : null;
  if (!pack) return null;
  const pick = (list, n) => (list.length ? list[n % list.length] : null);
  return {
    peek: peek ? pick(pack.peek, seed) : null,
    corner: corner ? pick(pack.corner, seed >>> 3) : null,
    // three sparkles, each a different one when the pack has three, in an order that changes from message to message
    spark: spark ? [0, 1, 2].map((i) => pick(pack.spark, (seed >>> 5) + i)).filter(Boolean) : [],
  };
}

/** Whether a pack has anything to show at all with these switches. */
export const hasDeco = (pieces) => Boolean(pieces && (pieces.peek || pieces.corner || pieces.spark.length));
