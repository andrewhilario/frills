// Practice alerts: made-up follows, gifts of every size and shares, so alerts can be designed and tried without anybody being live.
// The same shape the relay sends (and acceptAlert checks), so they go through exactly the same engine and drawing.

const NAMES = ["Pond Pal", "Mochi Bun", "frogfan 🐸", "Mattcha", "Little Lily", "Croaker", "Nori Neko", "Sunny Side", "Bubbletea", "Kero-chan"];
const GIFTS = [["Rose", 1, "#ff5f86"], ["Finger Heart", 5, "#ffb347"], ["Heart", 20, "#ff4d6d"], ["Panda", 100, "#6c7a89"], ["Galaxy", 1000, "#7b61ff"], ["Lion", 29999, "#e8a33d"]];
const pick = (list) => list[Math.floor(Math.random() * list.length)];
let counter = 0;

/** A small round gift picture drawn in a color, as an address that carries its own drawing. */
const giftPicture = (color) =>
  "data:image/svg+xml;base64," + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="${color}"/><path d="M32 18l4.6 9.4 10.4 1.5-7.5 7.3 1.8 10.3L32 41.6l-9.3 4.9 1.8-10.3-7.5-7.3 10.4-1.5z" fill="#fff"/></svg>`);

/**
 * One made-up alert of a kind: "follow", "share", or "gift" (`size` 1 small, 2 medium, 3 big, or leave it out for any). Names that are
 * given are used as they are; otherwise one is picked.
 */
export function fakeAlert(kind, { size, name } = {}) {
  const who = name ?? pick(NAMES);
  const base = { kind, id: `practice-${++counter}`, user: who, name: who, avatar: "" };
  if (kind !== "gift") return base;
  const [gift, diamonds, color] = pick(GIFTS.filter((_, i) => !size || (size === 1 ? i < 3 : size === 2 ? i === 3 : i >= 4)));
  const count = diamonds >= 100 ? 1 : 1 + Math.floor(Math.random() * 5);
  return { ...base, gift, picture: giftPicture(color), diamonds, count, total: diamonds * count };
}

/** A crowd of follows (or shares) arriving together, to see them join. */
export const fakeCrowd = (kind = "follow", size = 6) => Array.from({ length: size }, () => fakeAlert(kind));

/** Sends practice alerts to `push` now and then, at a pace you can change. Returns { stop() }. */
export function fakeAlertSource(push, getPace = () => [1800, 4200]) {
  let stopped = false;
  let timer = 0;
  const loop = () => {
    if (stopped) return;
    const roll = Math.random();
    if (roll < 0.08) fakeCrowd().forEach((a, i) => setTimeout(() => !stopped && push(a), i * 200));
    else push(fakeAlert(roll < 0.45 ? "follow" : roll < 0.6 ? "share" : "gift"));
    const [lo, hi] = getPace();
    timer = setTimeout(loop, lo + Math.random() * (hi - lo));
  };
  timer = setTimeout(loop, 400);
  return { stop() { stopped = true; clearTimeout(timer); } };
}

const LIKERS = ["Pond Pal", "Mochi Bun", "frogfan 🐸", "Mattcha", "Little Lily", "Croaker", "Nori Neko", "Sunny Side", "Bubbletea", "Kero-chan", "Leafy", "Tadpole Tim", "Matcha Mia", "Toad Tom"];

/** One made-up line of likes from a person (a number of taps), in the shape the relay sends. */
export function fakeLike({ name, count } = {}) {
  const who = name ?? pick(LIKERS);
  return { kind: "like", id: "", user: who, name: who, avatar: "", count: count ?? 1 + Math.floor(Math.random() * 15), total: 0 };
}

/** Sends practice likes to `push` every moment, from a handful of people, so a ranking fills and changes. Returns { stop() }. */
export function fakeLikeSource(push, getPace = () => [350, 900]) {
  let stopped = false;
  let timer = 0;
  const weights = LIKERS.map((_, i) => 1 + (LIKERS.length - i) * 0.4); // the first few tap more, so the order settles but still changes
  const loop = () => {
    if (stopped) return;
    let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
    let at = 0;
    while (at < weights.length - 1 && (roll -= weights[at]) > 0) at += 1;
    push(fakeLike({ name: LIKERS[at] }));
    const [lo, hi] = getPace();
    timer = setTimeout(loop, lo + Math.random() * (hi - lo));
  };
  timer = setTimeout(loop, 300);
  return { stop() { stopped = true; clearTimeout(timer); } };
}
