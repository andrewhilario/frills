// A pretend TikTok account, for testing the whole chain (editor -> helper -> OBS) when no LIVE is handy or TikTok is being difficult.
// Type  frills_demo  as the TikTok name. It makes up chat in the same shape the real connector delivers, so every message goes through
// the real mapping, de-duplication and delivery; only the connection to TikTok is pretend. Nothing is sent to TikTok.

import { EventEmitter } from "node:events";

export const DEMO_USER = "frills_demo";

const NAMES = [
  ["pond.pal", "Pond Pal"], ["mochi_bun", "Mochi Bun"], ["frogfan_99", "frogfan 🐸"], ["mattcha", "Mattcha"], ["little_lily", "Little Lily"],
  ["croaker", "Croaker"], ["nori_neko", "Nori Neko"], ["sunny_side", "Sunny Side"], ["bubbletea", "Bubbletea"], ["kero_chan", "Kero-chan"],
];
const LINES = [
  "hi everyone!!", "that was so cute", "LET'S GOOO", "first time here, hi!", "gg", "the overlay looks so pretty", "can you say hi to me?",
  "this is my comfort stream", "ahhh clutch!!", "love the vibe today", "how long have you been live", "so good", "😂😂", "wait what",
  "you're so funny", "sending love from everywhere", "こんにちは！", "best chat box ever", "okay that jump scared me",
];
// Gifts with what they cost in diamonds, so the alerts can be tried at every size.
const GIFTS = [["Rose", 1, "#ff5f86"], ["Finger Heart", 5, "#ffb347"], ["Heart", 20, "#ff4d6d"], ["Panda", 100, "#6c7a89"], ["Galaxy", 1000, "#7b61ff"]];
const giftIcon = (colour) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="${colour}"/><path d="M32 18l4.6 9.4 10.4 1.5-7.5 7.3 1.8 10.3L32 41.6l-9.3 4.9 1.8-10.3-7.5-7.3 10.4-1.5z" fill="#fff"/></svg>`).toString("base64")}`;
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Each made-up chatter gets a small drawn face as a profile picture, so a look can be judged with pictures in it. Real TikTok pictures
// arrive as addresses on TikTok's servers; these carry the drawing inside the address, so nothing is fetched from anywhere.
const FACES = [["#bfe3a8", "#2f5d34"], ["#ffd6e0", "#8a3b57"], ["#cfe4ff", "#2d4f86"], ["#fff1b8", "#6b5a12"], ["#e6d6ff", "#51308f"], ["#ffd9b8", "#8a4a1a"]];
const face = ([paper, ink]) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${paper}"/><circle cx="22" cy="28" r="4.5" fill="${ink}"/><circle cx="42" cy="28" r="4.5" fill="${ink}"/><path d="M20 42q12 12 24 0" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/></svg>`;
const PICTURES = FACES.map((colours) => `data:image/svg+xml;base64,${Buffer.from(face(colours)).toString("base64")}`);

export class DemoConnection extends EventEmitter {
  /** `pace` is the [shortest, longest] wait in ms between made-up events. */
  constructor({ pace = [1100, 2600] } = {}) {
    super();
    this.pace = pace;
    this.pretend = true; // the helper tells the page, so it never says "reading TikTok" about this
    this.timer = 0;
    this.gone = false;
    this.count = 0;
    this.recent = [];
  }

  async connect() {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (this.gone) return;
    this.tick(400); // a first message soon, so a test shows something at once
  }

  disconnect() {
    clearTimeout(this.timer);
    if (this.gone) return;
    this.gone = true;
    this.emit("disconnected");
  }

  tick(after) {
    this.timer = setTimeout(() => {
      if (this.gone) return;
      this.say();
      this.tick(this.pace[0] + Math.random() * (this.pace[1] - this.pace[0]));
    }, after);
  }

  /** A made-up person by number (for a crowd). */
  fan(n) {
    const [handle, nickname] = NAMES[n % NAMES.length];
    return { id: String(6800000000000001000n + BigInt(n)), displayId: handle + (n >= NAMES.length ? n : ""), nickname, avatarThumb: { urlList: [PICTURES[n % PICTURES.length]] } };
  }

  say() {
    const [handle, nickname] = pick(NAMES);
    const user = { id: String(6800000000000000000n + BigInt(handle.length * 7919)), displayId: handle, nickname, avatarThumb: { urlList: [PICTURES[NAMES.findIndex(([h]) => h === handle) % PICTURES.length]] } };
    const id = `demo-${++this.count}`;
    // Alerts come on a fixed rhythm so each kind turns up regularly: a crowd every 23rd tick, a share every 11th, a follow every 7th and a
    // gift every 5th. The rest is chat, and now and then a moderator deleting a message.
    const n = this.count;
    const roll = n % 23 === 10 ? 0 : n % 11 === 4 ? 0.15 : n % 7 === 3 ? 0.1 : n % 5 === 2 ? 0.25 : 0.4 + Math.random() * 0.6;
    if (roll < 0.04) {
      // A crowd of follows at once, to see them merge.
      for (let i = 0; i < 6; i++) setTimeout(() => !this.gone && this.emit("follow", { common: { msgId: `${id}-f${i}` }, user: this.fan(i + this.count) }), i * 250);
    } else if (roll < 0.14) {
      this.emit("follow", { common: { msgId: id }, user });
    } else if (roll < 0.18) {
      this.emit("share", { common: { msgId: id }, user });
    } else if (roll < 0.3) {
      // A gift. The ones that can be sent in a streak arrive twice, as they do from TikTok: counting, then the final count.
      const [name, diamondCount, colour] = pick(GIFTS);
      const gift = { name, type: 1, diamondCount, image: { urlList: [giftIcon(colour)] } };
      const count = 1 + Math.floor(Math.random() * 5);
      this.emit("gift", { common: { msgId: id + "-a" }, user, gift, repeatCount: Math.max(1, count - 1), repeatEnd: 0 });
      setTimeout(() => !this.gone && this.emit("gift", { common: { msgId: id + "-b" }, user, gift, repeatCount: count, repeatEnd: 1 }), 700);
    } else if (roll > 0.4 && roll < 0.43 && this.recent.length) {
      // A moderator deleting one of the last few messages.
      this.emit("imDelete", { deleteMsgIds: [this.recent.splice(Math.floor(Math.random() * this.recent.length), 1)[0]], deleteUserIds: [] });
    } else {
      const mod = roll > 0.8 && roll < 0.9;
      this.emit("chat", { common: { msgId: id }, user, content: pick(LINES), userIdentity: { isModeratorOfAnchor: mod, isGiftGiverOfAnchor: roll > 0.5 && roll < 0.6 } });
      this.recent.push(id);
      if (this.recent.length > 4) this.recent.shift();
    }
  }
}
