// Decorations for the chat bubbles: little pictures laid over a bubble's edges (a friend peeking over the top, a small scene on a bottom corner,
// sparkles around it). A PACK is a set of such pieces in one mood. "Frog pond", "Frog pond V2", "Neko cafe", "Hamster burrow" and "Bunny cloud" are pictures (loaded from this
// site, only when the pack is chosen). More packs add a name and their pieces here.
// Pure data and small functions, so it is tested without a page.

export const DECOS = [
  { id: "none", name: "None" },
  { id: "frog", name: "Frog pond" },
  { id: "frog2", name: "Frog pond V2" },
  { id: "neko", name: "Neko cafe" },
  { id: "hamster", name: "Hamster burrow" },
  { id: "bunny", name: "Bunny cloud" },
];
export const DECO_IDS = DECOS.map((d) => d.id);

// The pieces of each pack, by where they sit. A piece is a picture ({ src }). `peek` goes on the top edge, `corner` on a
// bottom corner, `spark` scattered around. A role with no pieces is simply left out.
export const PACKS = {
  frog: {
    peek: [], // the peeking frogs are still to come (see ASSET-PROMPTS.txt)
    corner: [{ src: "/decor/frog/corner-pond.webp" }, { src: "/decor/frog/corner-lily.webp" }], // the frog on its lily pad, and the lotus (each message gets one)
    spark: [{ src: "/decor/frog/sparkle-a.webp" }, { src: "/decor/frog/sparkle-b.webp" }, { src: "/decor/frog/sparkle-c.webp" }],
  },
  frog2: {
    // the second frog pond (the first stays as it was): a frog peeking over the top (one with hearts above its head), a frog on a lily pad with a lotus, and eight little pond things
    peek: [{ src: "/decor/frog2/peeker-a.webp", ratio: 0.413 }, { src: "/decor/frog2/peeker-b.webp", ratio: 0.597 }],
    corner: [{ src: "/decor/frog2/corner.webp" }],
    spark: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ src: `/decor/frog2/confetti-${n}.webp` })),
  },
  neko: {
    // a cat peeking over the top (ratio = how tall the picture is for its width, so the stylesheet can leave room above the bubble), a sleeping kitten
    // on a cushion, and little cat things scattered around
    peek: [{ src: "/decor/neko/peeker-a.webp", ratio: 0.525 }, { src: "/decor/neko/peeker-b.webp", ratio: 0.694 }],
    corner: [{ src: "/decor/neko/corner.webp" }],
    spark: ["paw-brown", "heart-pink", "fish", "star", "paw-cream", "yarn", "heart-yellow", "cat-face"].map((name) => ({ src: `/decor/neko/${name}.webp` })),
  },
  hamster: {
    // a hamster peeking over the top (one with seeds floating over its head), a hamster beside its wheel and a pile of sunflower seeds, and eight little hamster things
    peek: [{ src: "/decor/hamster/peeker-a.webp", ratio: 0.488 }, { src: "/decor/hamster/peeker-b.webp", ratio: 0.719 }],
    corner: [{ src: "/decor/hamster/corner.webp" }],
    spark: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ src: `/decor/hamster/confetti-${n}.webp` })),
  },
  bunny: {
    // a bunny peeking over the top (a sleepy one with a moon and stars), a bunny on a cloud with a rainbow, and eight little sky and bunny things
    peek: [{ src: "/decor/bunny/peeker-a.webp", ratio: 0.463 }, { src: "/decor/bunny/peeker-b.webp", ratio: 0.625 }],
    corner: [{ src: "/decor/bunny/corner.webp" }],
    spark: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ src: `/decor/bunny/confetti-${n}.webp` })),
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
