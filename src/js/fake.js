// Practice chat: made-up messages, so a look can be judged without anybody being live.

const NAMES = ["pondpal", "mochi_bun", "frogfan_99", "mattcha", "little_lily", "croaker", "nori_neko", "sunny_side", "bubbletea", "tadpole_tim", "leafy", "kero_chan"];
const LINES = [
  "hi everyone!!", "that was so cute", "LET'S GOOO", "first time here, hi!", "gg", "the overlay looks so pretty", "can you say hi to me?",
  "this is my comfort stream", "ahhh clutch!!", "love the vibe today", "how long have you been live", "so good", "😂😂", "wait what",
  "you're so funny", "sending love from everywhere", "best chat box ever", "okay that jump scared me",
];
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
let counter = 0;

/** One made-up message. Some are from moderators, some from gifters, a few are gifts. */
export function fakeMessage() {
  const name = pick(NAMES);
  const base = { id: "practice" + ++counter, user: name, name, mod: hash(name) % 4 === 0 };
  if (Math.random() < 0.1) return { ...base, text: "sent a Rose ×" + (1 + Math.floor(Math.random() * 5)) + " 🌹", gift: true, gifter: true };
  return { ...base, text: pick(LINES), gifter: hash(name) % 3 === 0 };
}

let testIndex = 0;

/** For the "send a test message" button: plain, then from a moderator, then a gift, round and round, so every part of a look shows. */
export function testMessage() {
  const kinds = [
    { text: "this is how a normal message looks" },
    { text: "and this one is from a moderator", mod: true },
    { text: "sent a Rose ×5 🌹", gift: true, gifter: true },
  ];
  const kind = kinds[testIndex % kinds.length];
  const name = pick(NAMES);
  testIndex += 1;
  return { id: "test" + testIndex, user: name, name, ...kind };
}

/** A fixed, readable set for previews: a moderator, a gifter, a gift. */
export const SAMPLE_MESSAGES = [
  { id: "s1", user: "mochi_bun", name: "mochi_bun", text: "hi everyone!!", mod: true },
  { id: "s2", user: "frogfan_99", name: "frogfan_99", text: "that was so cute", gifter: true },
  { id: "s3", user: "little_lily", name: "little_lily", text: "sent a Rose ×3 🌹", gift: true, gifter: true },
];

/** Feeds practice messages into one or more feeds, at a pace you can change. */
export function fakeSource(feeds, getPace) {
  const list = Array.isArray(feeds) ? feeds : [feeds];
  let paused = false;
  let stopped = false;
  const timers = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
  };
  list.forEach((feed, i) => {
    for (let k = 0; k < 3; k++) later(() => !stopped && feed.add(fakeMessage()), 200 + k * 450 + i * 90);
    const loop = () => {
      if (stopped) return;
      if (!paused) feed.add(fakeMessage());
      const [lo, hi] = getPace();
      later(loop, lo + Math.random() * (hi - lo));
    };
    later(loop, 1800 + i * 260);
  });
  return {
    stop: () => {
      stopped = true;
      timers.forEach(clearTimeout);
      timers.clear();
    },
    pause: (value) => { paused = value; },
    burst: () => list.forEach((feed, i) => { for (let k = 0; k < 6; k++) later(() => !stopped && feed.add(fakeMessage()), k * 140 + i * 40); }),
    /** One message right now, in every feed. */
    send: (msg = fakeMessage()) => list.forEach((feed) => feed.add(msg)),
  };
}
