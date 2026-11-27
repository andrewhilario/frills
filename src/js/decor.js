// Decorations for the chat bubbles: little pictures laid over a bubble's edges (a friend peeking over the top, a small scene on a bottom corner,
// sparkles around it). A PACK is a set of such pieces in one mood. "Frog pond", "Frog pond V2", "Neko cafe", "Hamster burrow" and "Bunny cloud" are pictures (loaded from this
// site, only when the pack is chosen). More packs add a name and their pieces here.
// Pure data and small functions, so it is tested without a page.

const STD = [
  ["frog2", "Frog pond V2", 0.413, 0.597],
  ["hamster", "Hamster burrow", 0.488, 0.719],
  ["bunny", "Bunny cloud", 0.463, 0.625],
  ["shiba", "Shiba gamer", 0.609, 0.662],
  ["capybara", "Chill capybara", 0.722, 0.613],
  ["dino", "Retro dino", 0.694, 0.65],
  ["astro", "Space bot", 0.738, 0.744],
  ["skatecat", "Skate cat", 0.722, 0.625],
  ["dragon", "RPG dragon", 0.603, 0.625],
  ["sakura", "Sakura spring", 0.653, 0.706],
  ["valentine", "Valentine café", 0.55, 0.659],
  ["summer", "Summer matsuri", 0.659, 0.716],
  ["autumn", "Cozy autumn", 0.644, 0.734],
  ["anime-xmas", "Cozy winter", 0.728, 0.775],
  ["anime-halloween", "Cozy witch", 0.7, 0.738],
  ["halloween", "Halloween", 0.581, 0.406, "halloween"],
  ["christmas", "Christmas", 0.7, 0.588, "christmas"],
];

export const DECOS = [
  { id: "none", name: "None" },
  { id: "frog", name: "Frog pond" },
  { id: "frog2", name: "Frog pond V2" },
  { id: "neko", name: "Neko cafe" },
  ...STD.slice(1).map(([id, name, , , season]) => (season ? { id, name, season } : { id, name })),
];
export const DECO_IDS = DECOS.map((d) => d.id);

const std = (id, a, b) => ({
  peek: [{ src: `/decor/${id}/peeker-a.webp`, ratio: a }, { src: `/decor/${id}/peeker-b.webp`, ratio: b }],
  corner: [{ src: `/decor/${id}/corner.webp` }],
  spark: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ src: `/decor/${id}/confetti-${n}.webp` })),
});

// The pieces of each pack, by where they sit. A piece is a picture ({ src }). `peek` goes on the top edge, `corner` on a
// bottom corner, `spark` scattered around. A role with no pieces is simply left out.
export const PACKS = {
  frog: {
    peek: [], // the peeking frogs are still to come (see ASSET-PROMPTS.txt)
    corner: [{ src: "/decor/frog/corner-pond.webp" }, { src: "/decor/frog/corner-lily.webp" }], // the frog on its lily pad, and the lotus (each message gets one)
    spark: [{ src: "/decor/frog/sparkle-a.webp" }, { src: "/decor/frog/sparkle-b.webp" }, { src: "/decor/frog/sparkle-c.webp" }],
  },
  neko: {
    peek: [{ src: "/decor/neko/peeker-a.webp", ratio: 0.525 }, { src: "/decor/neko/peeker-b.webp", ratio: 0.694 }],
    corner: [{ src: "/decor/neko/corner.webp" }],
    spark: ["paw-brown", "heart-pink", "fish", "star", "paw-cream", "yarn", "heart-yellow", "cat-face"].map((name) => ({ src: `/decor/neko/${name}.webp` })),
  },
  ...Object.fromEntries(STD.map(([id, , a, b]) => [id, std(id, a, b)])),
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
