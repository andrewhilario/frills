// How a chat message is built and how a feed keeps itself small and calm.
// Chat text is somebody else's words, so it only ever goes in with textContent and text nodes, never as HTML.
// A message is a plain object: { id, user, name, text, mod, color, emotes, gift, gifter }.

import { earsMarkup, earsPair } from "./ears.js";

/** Makes an element: el("div", { className: "x" }, child, "text"). */
export const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
};

// Moderator icons. Static strings drawn in the look's colors: currentColor, with --icon-ink for the mark on top.
export const ICONS = {
  shield:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" fill="currentColor"/><path d="m8.4 12 2.5 2.5L15.7 9.6" fill="none" stroke="var(--icon-ink)" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  star:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.4 2.9 6 6.6.9-4.8 4.6 1.2 6.6L12 17.3l-5.9 3.2 1.2-6.6L2.5 9.3l6.6-.9L12 2.4Z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg>',
  leaf:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 20.5C3.5 10 10 3.5 20.5 3.5 20.5 14 14 20.5 3.5 20.5Z" fill="currentColor"/><path d="M5.5 18.5 15 9" fill="none" stroke="var(--icon-ink)" stroke-width="1.7" stroke-linecap="round"/></svg>',
  frog:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="8" r="4.4" fill="currentColor"/><circle cx="17" cy="8" r="4.4" fill="currentColor"/><path d="M2 15.4C2 11.9 6.6 9.8 12 9.8s10 2.1 10 5.6c0 3.5-4.5 6.1-10 6.1S2 18.9 2 15.4Z" fill="currentColor"/><circle cx="7" cy="7.8" r="1.9" fill="var(--icon-ink)"/><circle cx="17" cy="7.8" r="1.9" fill="var(--icon-ink)"/><path d="M8 16.2c2.4 1.7 5.6 1.7 8 0" fill="none" stroke="var(--icon-ink)" stroke-width="1.7" stroke-linecap="round"/></svg>',
};

const iconEl = (type) => {
  const node = el("span", { className: "ico" });
  node.setAttribute("role", "img");
  node.setAttribute("aria-label", "Moderator");
  node.innerHTML = ICONS[type] ?? ICONS.shield; // one of our own icon strings, never chat text
  return node;
};

/** Writes a message's words into `node`, with Twitch emotes (an id and code-point positions) as little pictures. */
export function renderText(node, text, emotes) {
  if (!emotes || emotes.length === 0) {
    node.textContent = text;
    return;
  }
  const chars = Array.from(text);
  let pos = 0;
  for (const e of emotes) {
    if (e.start < pos || e.end < e.start || e.end >= chars.length) continue;
    if (e.start > pos) node.append(chars.slice(pos, e.start).join(""));
    const word = chars.slice(e.start, e.end + 1).join("");
    if (/^[\w-]{1,60}$/.test(e.id)) {
      node.append(el("img", { className: "emote", alt: word, src: `https://static-cdn.jtvnw.net/emoticons/v2/${e.id}/default/dark/1.0` }));
    } else {
      node.append(word);
    }
    pos = e.end + 1;
  }
  if (pos < chars.length) node.append(chars.slice(pos).join(""));
}

/**
 * Writes a TikTok message's words into `node` with its emote pictures put in at their places (pics: [{ at, url }], `at` counting code
 * points). A picture that never loads is taken away, so a broken address leaves no hole.
 */
export function renderPics(node, text, pics) {
  const chars = Array.from(text);
  let pos = 0;
  for (const pic of pics) {
    const at = Math.min(chars.length, Math.max(pos, pic.at));
    if (at > pos) node.append(chars.slice(pos, at).join(""));
    const img = el("img", { className: "emote", alt: "", decoding: "async" });
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => img.remove(), { once: true });
    img.src = pic.url;
    node.append(img);
    pos = at;
  }
  if (pos < chars.length) node.append(chars.slice(pos).join(""));
}

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A profile picture for the round badge. It covers the letter once it has loaded; if it never loads, the letter stays. */
function picture(badge, src) {
  const img = el("img", { className: "av__img", alt: "", decoding: "async" });
  img.referrerPolicy = "no-referrer"; // the picture's server has no need to know which page it is shown on
  img.addEventListener("load", () => badge.classList.add("has-img"), { once: true });
  img.addEventListener("error", () => img.remove(), { once: true });
  img.src = src;
  return img;
}

export class Feed {
  constructor(host, options = {}) {
    this.host = host;
    this.max = 6; // messages on screen at once
    this.life = 15000; // how long one stays, in ms; 0 means it never leaves by itself
    this.modIcon = "shield"; // shield, star, leaf, frog, or none
    this.colors = false; // use each viewer's own name color when the source gives one
    this.emotes = true;
    this.pictures = true; // a chatter's own profile picture in the round badge, when the source has one (TikTok does, Twitch doesn't)
    this.ears = "none"; // a little extra on the top edge of each bubble: none, cat, bunny, bear, fox, horns, bow or halo (see ears.js)
    this.earsFor = "all"; // who gets them: all, mods, or gifts (messages that came with a gift)
    this.glide = true; // older messages slide up when a new one arrives
    this.gapMs = 160; // the fastest a feed shows messages, so a busy chat can't make the page do more work
    this.queueMax = 12; // when chat is faster than that, the oldest waiting messages are dropped
    this.queue = [];
    this.timer = 0;
    this.last = 0;
    this.configure(options);
  }

  configure(options) {
    Object.assign(this, options);
    const dressed = this.ears + "|" + this.earsFor;
    if (dressed !== this.dressed) {
      this.dressed = dressed;
      for (const m of this.host.children) this.dress(m); // ears turned on, off or changed: the messages already here follow
    }
    this.host.dataset.modIcon = this.modIcon;
    if (this.modIcon !== "none") {
      for (const node of this.host.querySelectorAll(".ico")) node.innerHTML = ICONS[this.modIcon] ?? ICONS.shield;
    }
    this.prune();
  }

  /** Puts the chosen ears on a message's bubble, or takes them off, according to the settings and who wrote it. The drawing is one of ours. */
  dress(m) {
    const body = m.querySelector(".body");
    if (!body) return;
    body.querySelector(".ears")?.remove();
    const markup = earsMarkup(this.ears);
    const wears = markup !== "" && (this.earsFor === "all" || (this.earsFor === "mods" && m.dataset.mod === "1") || (this.earsFor === "gifts" && m.classList.contains("gift")));
    m.classList.toggle("has-ears", wears);
    if (!wears) return;
    const ears = el("span", { className: "ears" + (earsPair(this.ears) ? " ears--pair" : "") });
    ears.setAttribute("aria-hidden", "true");
    ears.innerHTML = markup; // our own fixed drawing, never anything a viewer wrote
    body.append(ears);
  }

  /** Messages still on their way out don't count: they are gone from the page 320 ms after they start leaving. */
  showing() {
    return [...this.host.children].filter((c) => !c.classList.contains("leaving"));
  }

  prune() {
    for (let list = this.showing(); list.length > this.max; list = this.showing()) this.remove(list[0]);
  }

  /** Queues a message. They appear one after another, never faster than gapMs apart. */
  add(msg) {
    this.queue.push(msg);
    while (this.queue.length > this.queueMax) this.queue.shift();
    this.drain();
  }

  drain() {
    if (this.timer) return;
    const wait = Math.max(0, this.last + this.gapMs - performance.now());
    this.timer = setTimeout(() => {
      this.timer = 0;
      const msg = this.queue.shift();
      if (!msg) return;
      this.show(msg);
      this.last = performance.now();
      if (this.queue.length) this.drain();
    }, wait);
  }

  /** Draws a message now. */
  show({ id = "", user = "", name, text, mod = false, color = null, emotes = null, pics = null, gift = false, gifter = false, avatar = "" }) {
    const showPics = this.emotes && Array.isArray(pics) && pics.length > 0;
    if (!text && !showPics) return; // a message of only pictures, with pictures turned off, has nothing to draw
    const m = el("div", { className: "m" + (gift ? " gift" : "") });
    m.dataset.id = id;
    m.dataset.user = user;
    m.dataset.mod = mod ? "1" : "0";
    const av = el("div", { className: "av", textContent: (Array.from(name)[0] ?? "?").toUpperCase() });
    if (this.pictures && avatar) av.append(picture(av, avatar));
    const who = el("div", { className: "who" });
    if (mod) who.append(iconEl(this.modIcon === "none" ? "shield" : this.modIcon));
    const nm = el("span", { className: "name", textContent: name });
    if (this.colors && color) nm.style.color = color;
    who.append(nm);
    if (gifter) {
      const badge = el("i", { className: "badge" });
      badge.setAttribute("aria-hidden", "true");
      who.append(badge);
    }
    const tx = el("div", { className: "txt" });
    if (showPics) renderPics(tx, text, pics);
    else renderText(tx, text, this.emotes ? emotes : null);
    m.append(av, el("div", { className: "body" }, who, tx));
    this.dress(m);
    // Older messages glide up to make room, rather than jumping: note where each is, add the new one, then slide each from where it was.
    const glide = this.glide && !this.host.classList.contains("is-static") && !prefersReducedMotion();
    const before = glide ? this.showing().map((c) => [c, c.getBoundingClientRect().top]) : [];
    this.host.append(m);
    this.prune();
    for (const [c, top] of before) {
      if (!c.isConnected || c.classList.contains("leaving")) continue;
      const moved = top - c.getBoundingClientRect().top;
      // "add" lays the slide on top of whatever the message is already doing, so one still arriving isn't cut short; an older browser ignores it.
      if (Math.abs(moved) > 1) c.animate([{ transform: `translateY(${moved}px)` }, { transform: "translateY(0)" }], { duration: 240, easing: "cubic-bezier(0.16, 1, 0.3, 1)", composite: "add" });
    }
    if (this.life > 0) setTimeout(() => this.remove(m), this.life);
  }

  /** Fills the feed with a fixed set of messages and no motion: for the small previews on the home page. */
  fill(messages) {
    this.host.classList.add("is-static");
    this.life = 0;
    this.max = Math.max(this.max, messages.length);
    for (const msg of messages) this.show(msg);
  }

  remove(m) {
    if (!m || !m.isConnected || m.classList.contains("leaving")) return;
    m.classList.add("leaving");
    setTimeout(() => m.remove(), 320);
  }

  /** A moderator deleted one message. */
  removeById(id) {
    if (!id) return;
    this.queue = this.queue.filter((q) => q.id !== id);
    for (const m of [...this.host.children]) if (m.dataset.id === id) this.remove(m);
  }

  /** A moderator timed out or banned someone: everything they said goes. */
  removeUser(user) {
    if (!user) return;
    this.queue = this.queue.filter((q) => q.user !== user);
    for (const m of [...this.host.children]) if (m.dataset.user === user) this.remove(m);
  }

  clear() {
    this.queue = [];
    this.host.replaceChildren();
  }
}
