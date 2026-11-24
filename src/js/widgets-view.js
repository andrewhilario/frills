// Draws the Last Gifts list and the Follower Goal bar. What to show comes from gifts.js and goal.js; this only makes the elements.
// Everything somebody else wrote (a name, a gift) goes in with textContent and text nodes, never as HTML.

import { el } from "./feed.js";
import { GOAL_TYPES, MOMENTS } from "./goal.js";
import { formatCount } from "./counter.js";
import { commandWord } from "./songs.js";
import { MEDIA_ID, mediaUrl } from "./alerts-settings.js";
import { fillTemplate } from "./alerts.js";
import { lookVars } from "./widget-settings.js";
import { decoPieces, hasDeco, seedOf } from "./decor.js";
import { createJarCanvas } from "./jar-canvas.js";

const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function applyLook(host, settings) {
  for (const [name, value] of Object.entries(lookVars(settings))) host.style.setProperty(name, value);
  host.dataset.align = settings.align || "left";
  dress(host, settings.deco);
}

/**
 * The pictures of a season on a small overlay (the `deco` setting: a pack from decor.js, "none" for no pictures): a friend peeking over an edge, a scene on a corner and
 * sparkles. They are our own pictures, never anything a viewer wrote, they sit over the overlay without taking a click, and the overlay leaves room for them (see widgets.css).
 * Any earlier ones come off first, so this also takes them away or swaps them. An overlay always gets the same pieces, so it does not change when it is drawn again.
 */
function dress(host, pack) {
  host.querySelector(":scope > .widget__deco")?.remove();
  host.style.removeProperty("--peek-ratio");
  const pieces = pack && pack !== "none" ? decoPieces(pack, seedOf(host.className + pack)) : null;
  host.dataset.deco = hasDeco(pieces) ? pack : "none";
  if (!hasDeco(pieces)) return;
  const layer = el("span", { className: "widget__deco" });
  layer.setAttribute("aria-hidden", "true");
  const piece = (what, className) => {
    const img = el("img", { className, alt: "", decoding: "async" });
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => img.remove(), { once: true }); // a picture that does not load leaves no hole
    img.src = what.src;
    layer.append(img);
  };
  if (pieces.peek) piece(pieces.peek, "deco__peek");
  if (pieces.corner) piece(pieces.corner, "deco__corner");
  pieces.spark.forEach((what, i) => piece(what, `deco__spark deco__spark--${i + 1}`));
  host.append(layer);
  if (pieces.peek?.ratio) host.style.setProperty("--peek-ratio", String(pieces.peek.ratio));
}

/** The Last Gifts list. Returns { apply(settings), render(items), gone(item), clear() }. */
export function createGiftsView(host) {
  const root = el("div", { className: "giftlist" }); // inside the host, so the host can be the editor's scaled canvas
  host.append(root);
  const title = el("p", { className: "giftlist__title" });
  const rows = el("div", { className: "giftlist__rows" });
  root.append(title, rows);
  const nodes = new Map();
  let settings = null;

  function row(item) {
    const words = el("span", { className: "gift__words" });
    for (const piece of fillTemplate(settings.template, { name: item.name, gift: item.gift, count: item.count, diamonds: item.diamonds, total: item.total })) {
      words.append(piece.mark ? el("strong", { className: "gift__mark", textContent: piece.text }) : document.createTextNode(piece.text));
    }
    const node = el("div", { className: "gift gift--in" });
    // The entrance is played once. Without this, anything that moves the row in the page (see render) would play it again.
    node.addEventListener("animationend", () => node.classList.remove("gift--in"), { once: true });
    if (settings.avatar) {
      const av = el("span", { className: "gift__av", textContent: [...(item.name || "?")][0].toUpperCase() });
      av.setAttribute("aria-hidden", "true");
      if (item.avatar) {
        const img = el("img", { className: "gift__avimg", src: item.avatar, alt: "", referrerPolicy: "no-referrer" });
        img.addEventListener("load", () => av.classList.add("gift__av--pic"));
        img.addEventListener("error", () => img.remove());
        av.append(img);
      }
      node.append(av);
    }
    node.append(words);
    if (settings.showDiamonds && item.total) node.append(el("span", { className: "gift__value", textContent: `${item.total.toLocaleString("en-US")} diamonds` }));
    if (settings.showPicture && item.picture) node.append(el("img", { className: "gift__pic", src: item.picture, alt: "", referrerPolicy: "no-referrer" }));
    return node;
  }

  return {
    apply(next) {
      settings = next;
      applyLook(root, next);
      root.dataset.order = next.order;
      root.dataset.enter = next.enter;
      title.hidden = !next.title;
      title.textContent = next.titleText;
    },
    /** The whole list, oldest first. New items get a row; the order of the rows follows the list. */
    render(items) {
      if (!settings) return;
      for (const item of items) {
        if (nodes.has(item.key)) continue;
        const node = row(item);
        nodes.set(item.key, node);
        rows.append(node);
      }
      // Keep the rows in the list's order, moving a row only when it is out of place: moving one makes the browser play its animations again.
      let before = rows.firstChild;
      for (const item of items) {
        const node = nodes.get(item.key);
        while (before && before !== node && before.classList.contains("gift--out")) before = before.nextSibling; // rows on their way out stay where they are
        if (before === node) before = node.nextSibling;
        else rows.insertBefore(node, before);
      }
    },
    gone(item) {
      const node = nodes.get(item.key);
      if (!node) return;
      nodes.delete(item.key);
      node.classList.remove("gift--in");
      node.classList.add("gift--out");
      setTimeout(() => node.remove(), 420);
    },
    clear() {
      for (const node of nodes.values()) node.remove();
      nodes.clear();
    },
  };
}

/** The Follower Goal bar. Returns { apply(settings), update(snapshot), celebrate(text) }. */
export function createGoalView(host) {
  const root = el("div", { className: "goal" });
  host.append(root);
  const label = el("span", { className: "goal__label" });
  const numbers = el("span", { className: "goal__numbers" });
  const track = el("div", { className: "goal__track" });
  const pct = el("span", { className: "goal__pct" }); // (only the ring design shows it: inside the ring)
  const fill = el("div", { className: "goal__fill" });
  const reward = el("p", { className: "goal__reward", hidden: true }); // what you get at the goal, under the bar
  const cheer = el("p", { className: "goal__cheer", hidden: true });
  const fx = el("span", { className: "alert__fx goal__fx" });
  const gains = el("div", { className: "goal__gains" }); // the "+1 name" bubbles that rise from the bar
  const moment = el("p", { className: "goal__moment", hidden: true }); // "Halfway there!"
  for (const layer of [fx, gains, moment]) layer.setAttribute("aria-hidden", "true");
  track.append(fill);
  root.append(el("div", { className: "goal__head" }, label, numbers), track, pct, reward, cheer, fx, gains, moment);
  let settings = null;
  let last = null;
  let momentTimer = 0;

  const show = () => {
    if (!settings || !last) return;
    const type = GOAL_TYPES[settings.type] ?? GOAL_TYPES.follow;
    label.textContent = settings.label || type.label;
    const ring = settings.barStyle === "ring";
    const parts = [];
    if (settings.showNumbers) parts.push(`${last.value.toLocaleString("en-US")} / ${last.goal.toLocaleString("en-US")}${type.unit ? " " + type.unit : ""}`);
    if (settings.showPercent && !ring) parts.push(`${last.percent}%`); // (the ring shows the percent inside itself)
    if (settings.toGo && !ring && last.goal > last.value) parts.push(`${(last.goal - last.value).toLocaleString("en-US")} to go`);
    numbers.textContent = parts.join("  ·  ");
    pct.textContent = settings.showPercent ? `${last.percent}%` : "";
    reward.hidden = !settings.reward;
    reward.replaceChildren(...(settings.reward ? [el("b", { textContent: "At the goal: " }), document.createTextNode(settings.reward)] : []));
    fill.style.width = last.percent + "%";
    root.style.setProperty("--p", String(last.percent)); // (the ring design is drawn from this)
    root.dataset.full = String(last.percent >= 100);
  };

  return {
    apply(next) { settings = next; applyLook(root, next); root.dataset.style = next.barStyle || "bar"; show(); },
    update(snapshot) { last = snapshot; show(); },
    /**
     * Something was added: a "+1 name" bubble rises from the end of the bar (at most three at once), and a moment passed on the way (a quarter, half, three
     * quarters) is cheered for a few seconds. Each is switched on or off in the editor.
     */
    gain({ name = "", amount = 1, milestones = [] } = {}) {
      if (settings?.thanks) {
        const bubble = el("span", { className: "goal__gain", textContent: `+${Number(amount).toLocaleString("en-US")} ${name}`.trim() });
        bubble.style.left = Math.max(14, Math.min(86, last?.percent ?? 0)) + "%"; // (it keeps the place it was made at while the bar moves on)
        gains.append(bubble);
        while (gains.children.length > 3) gains.firstElementChild.remove();
        setTimeout(() => bubble.remove(), 2200);
      }
      const passed = milestones.at(-1);
      if (settings?.milestones && passed && MOMENTS[passed]) {
        moment.textContent = MOMENTS[passed];
        moment.hidden = false;
        moment.classList.remove("goal__moment--on");
        void moment.offsetWidth; // (so the same cheer can play again)
        moment.classList.add("goal__moment--on");
        clearTimeout(momentTimer);
        momentTimer = setTimeout(() => { moment.hidden = true; moment.classList.remove("goal__moment--on"); }, 3000);
      }
    },
    /** Confetti and the words, for a few seconds. Resolves when it is over. */
    celebrate(words, ms = 6000) {
      cheer.textContent = words;
      cheer.hidden = !words;
      root.classList.add("goal--party");
      confettiBurst(fx, 34, { spreadX: 120, spreadY: 120, minDist: 60, yMul: 0.8 });
      return new Promise((resolve) => setTimeout(() => {
        cheer.hidden = true;
        root.classList.remove("goal--party");
        fx.replaceChildren();
        resolve();
      }, ms));
    },
  };
}

const SVG = "http://www.w3.org/2000/svg";
function confettiBurst(fx, count = 34, { spreadX = 180, spreadY = 100, minDist = 60, yMul = 0.8 } = {}) {
  fx.replaceChildren();
  fx.dataset.fx = "confetti";
  if (reducedMotion()) return;
  for (let i = 0; i < count; i++) {
    const p = el("i");
    const angle = Math.random() * Math.PI * 2;
    const far = minDist + Math.random() * spreadX;
    p.style.setProperty("--x", Math.round(Math.cos(angle) * far * 1.5) + "px");
    p.style.setProperty("--y", Math.round(Math.sin(angle) * (minDist + Math.random() * spreadY) * yMul) + "px");
    p.style.setProperty("--r", Math.round(Math.random() * 400 - 200) + "deg");
    p.style.setProperty("--d", Math.round(300 + Math.random() * 350) + "ms");
    p.style.setProperty("--s", (0.7 + Math.random() * 0.75).toFixed(2));
    fx.append(p);
  }
}

/** A little gold crown (drawn here so it is the same on every look), for the person being celebrated. */
function crownIcon(className = "likers__crown") {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 64 48");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const add = (tag, attrs) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); svg.append(n); };
  add("path", { d: "M6 40 L10 12 L24 26 L32 6 L40 26 L54 12 L58 40 Z", fill: "#ffd23f", stroke: "#b8860b", "stroke-width": "3", "stroke-linejoin": "round" });
  add("rect", { x: "6", y: "40", width: "52", height: "7", rx: "2.5", fill: "#ffc107", stroke: "#b8860b", "stroke-width": "3" });
  add("circle", { cx: "10", cy: "12", r: "4", fill: "#ff5f86" });
  add("circle", { cx: "32", cy: "6", r: "4", fill: "#59d4ff" });
  add("circle", { cx: "54", cy: "12", r: "4", fill: "#7be06a" });
  return svg;
}

const PARTY_WAITING = 3; // celebrations that can wait their turn; when more pile up, the rest are skipped

/**
 * Shared leaderboard view powering Top Likers and Top Gifters. Rows slide cleanly as rank changes.
 * `formatRow(person)` formats the score pill; `defaultUnit` sets the celebration unit when `person.unit` is omitted.
 */
function createLeaderboardView(host, { defaultUnit = "likes", formatRow = (p) => Number(p.count).toLocaleString("en-US") } = {}) {
  const root = el("div", { className: "likers" });
  root.dataset.unit = defaultUnit;
  host.append(root);
  const title = el("p", { className: "likers__title" });
  const rows = el("div", { className: "likers__rows" });
  root.append(title, rows);
  const nodes = new Map(); // key -> { node, rank, count, shown }
  let settings = null;
  let last = [];
  const waiting = [];
  let showing = false;

  /** One celebration: the card that zooms in, with the confetti behind it. */
  function party(person, ms) {
    const node = el("div", { className: "likers__party likers__party--in" });
    node.style.setProperty("--party-ms", ms + "ms");
    const fx = el("span", { className: "alert__fx likers__fx" });
    fx.setAttribute("aria-hidden", "true");
    confettiBurst(fx, 46, { spreadX: 190, spreadY: 190, minDist: 150, yMul: 1 });
    const pic = el("span", { className: "likers__pic", textContent: [...(person.name || "?")][0].toUpperCase() });
    pic.setAttribute("aria-hidden", "true");
    if (person.avatar) {
      const img = el("img", { className: "gift__avimg", src: person.avatar, alt: "", referrerPolicy: "no-referrer" });
      img.addEventListener("load", () => pic.classList.add("likers__pic--pic"));
      img.addEventListener("error", () => img.remove());
      pic.append(img);
    }
    const unit = person.unit || defaultUnit;
    const card = el("div", { className: "likers__trophy" }, crownIcon(), pic, el("strong", { className: "likers__who", textContent: person.name }));
    card.append(el("span", { className: "likers__total" }, el("span", { className: "likers__num", textContent: Number(person.count).toLocaleString("en-US") }), document.createTextNode(" " + unit)));
    if (settings?.celebrateText) card.append(el("span", { className: "likers__cheer", textContent: settings.celebrateText }));
    node.append(fx, card);
    return node;
  }

  function nextParty() {
    if (showing || !waiting.length) return;
    showing = true;
    const { person, onStart, done } = waiting.shift();
    const ms = Math.max(3, Number(settings?.celebrateTime) || 7) * 1000;
    const node = party(person, ms);
    root.append(node);
    onStart?.();
    setTimeout(() => { node.classList.remove("likers__party--in"); node.classList.add("likers__party--out"); }, ms - 450);
    setTimeout(() => { node.remove(); showing = false; done(true); nextParty(); }, ms);
  }

  /** Puts each row at its place: reads heights first, places fresh rows directly, and glides existing rows smoothly. */
  function layout() {
    const gap = parseFloat(getComputedStyle(rows).fontSize || "24") * (settings?.layout === "compact" ? 0.3 : 0.5);
    let y = 0;
    const placements = [];
    for (const p of last) {
      const n = nodes.get(p.key);
      if (!n) continue;
      placements.push([n, Math.round(y)]);
      y += n.node.offsetHeight + gap;
    }
    for (const [n, topY] of placements) {
      if (n.fresh) {
        n.node.style.transition = "none";
        n.node.style.transform = `translateY(${topY}px)`;
        void n.node.offsetHeight;
        n.node.style.transition = "";
        n.fresh = false;
      } else {
        n.node.style.transform = `translateY(${topY}px)`;
      }
    }
    rows.style.height = Math.max(0, Math.round(placements.length ? y - gap : 0)) + "px";
  }

  function build(person) {
    const node = el("div", { className: "liker liker--in" });
    const rank = el("span", { className: "liker__rank" });
    node.append(rank);
    if (settings.avatar) {
      const av = el("span", { className: "liker__av", textContent: [...(person.name || "?")][0].toUpperCase() });
      av.setAttribute("aria-hidden", "true");
      if (person.avatar) {
        const img = el("img", { className: "gift__avimg", src: person.avatar, alt: "", referrerPolicy: "no-referrer" });
        img.addEventListener("load", () => av.classList.add("liker__av--pic"));
        img.addEventListener("error", () => img.remove());
        av.append(img);
      }
      node.append(av);
    }
    const count = el("span", { className: "liker__count" });
    const icon = el("span", { className: "liker__icon" });
    icon.setAttribute("aria-hidden", "true");
    icon.append(counterIcon(defaultUnit === "likes" ? "heart" : "gem"));
    const stats = el("span", { className: "liker__stats" }, icon, count);
    stats.hidden = !settings.showCounts;
    const info = el("div", { className: "liker__info" }, el("span", { className: "liker__name", textContent: person.name }), stats);
    node.append(info);
    rows.append(node);
    return { node, rank, count, stats, shown: "", fresh: true };
  }

  return {
    apply(next) {
      settings = next;
      applyLook(root, next);
      root.dataset.layout = next.layout || "classic";
      root.dataset.medals = String(next.medals);
      title.hidden = !next.title;
      title.textContent = next.titleText;
      for (const n of nodes.values()) n.stats.hidden = !next.showCounts;
      layout();
    },
    render(top) {
      if (!settings) return;
      last = top;
      const keep = new Set(top.map((p) => p.key));
      for (const [key, n] of [...nodes]) {
        if (keep.has(key)) continue;
        nodes.delete(key);
        n.node.classList.remove("liker--in");
        n.node.classList.add("liker--out");
        setTimeout(() => n.node.remove(), 450);
      }
      for (const person of top) {
        const n = nodes.get(person.key) ?? (() => { const made = build(person); nodes.set(person.key, made); return made; })();
        const formatted = formatRow(person);
        n.node.dataset.rank = String(person.rank);
        n.rank.textContent = String(person.rank);
        n.count.textContent = formatted;
        if (n.shown !== "" && n.shown !== formatted) { n.count.classList.remove("liker__count--bump"); void n.count.offsetWidth; n.count.classList.add("liker__count--bump"); }
        n.shown = formatted;
      }
      layout();
    },
    clear() {
      for (const n of nodes.values()) n.node.remove();
      nodes.clear();
      last = [];
      layout();
    },
    celebrate(person, { onStart } = {}) {
      if (!settings || waiting.length >= PARTY_WAITING) return Promise.resolve(false);
      return new Promise((resolve) => { waiting.push({ person, onStart, done: resolve }); nextParty(); });
    },
  };
}

/**
 * The Top Likers ranking. Rows slide to their new places when the order changes. Returns { apply(settings), render(top), clear(),
 * celebrate(person, { onStart }) }. `celebrate` zooms a person in (picture, name, their likes, a crown, confetti) over the list for the
 * seconds the settings say; one at a time, the next waits. It resolves to whether it was shown (false when too many are already waiting).
 */
export const createLikersView = (host) => createLeaderboardView(host, { defaultUnit: "likes" });

/** The Top Gifters leaderboard (TikTok gift diamonds or Twitch gifted subs & bits). Shares animation and celebration engine. */
export const createGiftersView = (host) => createLeaderboardView(host, { defaultUnit: "diamonds", formatRow: (p) => p.label ?? Number(p.count).toLocaleString("en-US") });

/** Whether the first song gets its own card: when asked for, and always when the overlay shows only that song. */
const standsOut = (s) => s.showNow || s.show === "now";

/** An album cover is drawn only from the catalog's picture server, or a picture a practice song carries itself. Anything else is left out. */
const safeCover = (address) => (/^https:\/\/cdn-images\.dzcdn\.net\//.test(address) || /^https:\/\/i\.scdn\.co\//.test(address) || /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(address) || /^\/api\/media\/[A-Za-z0-9_-]{16}$/.test(address) ? address : "");

/**
 * The Song requests queue: the song being played stands out, the ones after it are listed below. Returns { apply(settings), render(view) }
 * where view is { now, next, startedAt, at } from SongQueue. A row is made once and only changed in place after that, so only a new request
 * animates. The look of the song playing (card, strip, stack, disc, glass, equalizer, capsule, poster) is all CSS on the overlay's own
 * data-layout, so changing it in the editor changes the preview at once; the card carries every part any layout may want and each layout
 * shows the ones it needs.
 */
export function createSongsView(host) {
  const root = el("div", { className: "songs" });
  host.append(root);
  const title = el("p", { className: "songs__title" });
  const nowHost = el("div", { className: "songs__now" });
  const rows = el("div", { className: "songs__rows" });
  const idle = el("div", { className: "songs__idle" });
  const idleIcon = el("span", { className: "songs__idleicon", textContent: "\u266a" });
  idleIcon.setAttribute("aria-hidden", "true");
  const idleText = el("span", { className: "songs__idletext" });
  idle.append(idleIcon, idleText);
  root.append(title, idle, nowHost, rows);
  const nodes = new Map(); // item key -> parts
  let nowKey = "";
  let settings = null;
  let last = null;
  let builtWith = "";

  /** A long title that does not fit slides to its end and back, instead of being cut with ... (only the song playing). */
  function measure(parts) {
    if (!parts.t) return;
    const over = parts.title.clientWidth > 0 ? parts.t.scrollWidth - parts.title.clientWidth : 0;
    parts.title.classList.toggle("is-long", over > 2);
    parts.title.style.setProperty("--shift", -Math.max(0, over) + "px");
  }

  /** The progress bar starts when the song comes up and fills over the song's length, with nothing ticking: it is one CSS animation. */
  function progress(parts, item) {
    const seconds = item.seconds > 0 ? item.seconds : 0;
    const mark = seconds ? [item.key, item.title, seconds, item.paused ? "paused" : Math.round((last?.startedAt ?? 0) / 1000)].join(":") : "";
    if (parts.timed === mark) return;
    parts.timed = mark;
    parts.node.classList.toggle("song--timed", Boolean(seconds));
    parts.bar.replaceChildren();
    if (!seconds) return;
    const fillBar = el("i");
    const elapsed = Math.max(0, Math.min(seconds, ((last?.at ?? 0) - (last?.startedAt ?? 0)) / 1000));
    fillBar.style.animationDuration = seconds + "s";
    fillBar.style.animationDelay = -elapsed + "s";
    fillBar.style.animationPlayState = item.paused ? "paused" : "running";
    parts.bar.append(fillBar);
  }

  function fill(parts, item) {
    (parts.t ?? parts.title).textContent = item.title;
    parts.artist.textContent = item.state === "searching" ? "Looking it up…" : item.artist;
    parts.artist.hidden = !parts.artist.textContent;
    parts.by.textContent = item.spotify ? "on Spotify" : `asked by ${item.name}`;
    parts.by.hidden = !settings.requester;
    parts.node.dataset.state = item.state;
    // the song playing can wear the streamer's own picture (a GIF loops, like a canvas) in place of the album cover
    const own = parts.t && MEDIA_ID.test(settings.coverMedia ?? "") ? mediaUrl(settings.coverMedia) : "";
    const cover = settings.cover ? safeCover(own || item.cover) : "";
    if (parts.img.getAttribute("src") !== cover) {
      if (cover) { parts.img.src = cover; parts.img.hidden = false; } else { parts.img.removeAttribute("src"); parts.img.hidden = true; }
    }
    if (parts.bg && (parts.bg.getAttribute("src") ?? "") !== cover) {
      if (cover) parts.bg.src = cover; else parts.bg.removeAttribute("src");
    }
    parts.art.hidden = !settings.cover;
    if (parts.bar) progress(parts, item);
    if (parts.t) requestAnimationFrame(() => measure(parts));
  }

  function build(item, big) {
    const node = el("div", { className: big ? "song song--now song--in" : "song song--in" });
    const art = el("span", { className: "song__art", textContent: "♪" });
    art.setAttribute("aria-hidden", "true");
    const img = el("img", { className: "song__img", alt: "", referrerPolicy: "no-referrer" });
    img.hidden = true;
    img.addEventListener("error", () => { img.hidden = true; });
    art.append(img);
    const text = el("span", { className: "song__text" });
    const label = el("span", { className: "song__label" });
    const name = el("span", { className: "song__title" });
    const artist = el("span", { className: "song__artist" });
    const by = el("span", { className: "song__by" });
    text.append(label, name, artist, by);
    const parts = { node, art, img, label, title: name, artist, by };
    if (big) {
      // the parts only some layouts show: a blurred copy of the cover, the sliding title, the equalizer bars and the progress bar
      parts.bg = el("img", { className: "song__bg", alt: "", referrerPolicy: "no-referrer" });
      parts.bg.setAttribute("aria-hidden", "true");
      parts.t = el("span", { className: "song__t" });
      name.append(parts.t);
      parts.bar = el("span", { className: "song__progress" });
      parts.bar.setAttribute("aria-hidden", "true");
      text.append(parts.bar);
      const bars = el("span", { className: "song__bars" });
      bars.setAttribute("aria-hidden", "true");
      for (let i = 0; i < 4; i++) bars.append(el("i"));
      node.append(parts.bg, art, text, bars);
    } else {
      node.append(art, text);
    }
    node.addEventListener("animationend", (e) => { if (e.target === node) node.classList.remove("song--in"); }); // played once, never again when the row is moved
    parts.label.textContent = big ? settings.nowText : "";
    parts.label.hidden = !big || !settings.nowText;
    fill(parts, item);
    return parts;
  }

  function show() {
    if (!settings || !last) return;
    const { now, next } = last;
    // the first song: its own card (or an ordinary row when "make the first song stand out" is off)
    const wantedNow = now ? now.key : "";
    if (wantedNow !== nowKey) {
      nowHost.replaceChildren();
      nodes.delete(nowKey);
      nowKey = wantedNow;
      if (now) {
        nodes.get(now.key)?.node.remove(); // it was a row in the list a moment ago: it becomes the card
        const parts = build(now, standsOut(settings));
        nodes.set(now.key, parts);
        nowHost.append(parts.node);
      }
    } else if (now) {
      fill(nodes.get(now.key), now);
    }
    const keep = new Set(next.map((i) => i.key));
    for (const [key, parts] of [...nodes]) {
      if (key === nowKey || keep.has(key)) continue;
      nodes.delete(key);
      parts.node.classList.remove("song--in");
      parts.node.classList.add("song--out");
      setTimeout(() => parts.node.remove(), 420);
    }
    for (const item of next) {
      let parts = nodes.get(item.key);
      if (!parts) { parts = build(item, false); nodes.set(item.key, parts); rows.append(parts.node); } else fill(parts, item);
    }
    // keep the rows in order, moving a row only when it is out of place (moving one makes the browser play its animations again)
    let before = rows.firstChild;
    for (const item of next) {
      const node = nodes.get(item.key).node;
      while (before && before !== node && before.classList.contains("song--out")) before = before.nextSibling;
      if (before === node) before = node.nextSibling;
      else rows.insertBefore(node, before);
    }
    root.dataset.empty = String(!now);
  }

  return {
    apply(next) {
      // (the editor changes one settings object in place, so what the first card was built from is remembered here, not read from `settings`)
      const built = `${standsOut(next)}|${next.nowText}`;
      const changed = builtWith !== "" && builtWith !== built;
      builtWith = built;
      settings = next;
      applyLook(root, next);
      root.dataset.layout = next.layout;
      root.dataset.show = next.show;
      root.dataset.progress = String(next.progress);
      root.dataset.scroll = String(next.scrollTitle);
      root.dataset.cover = next.coverShape;
      root.dataset.glow = String(next.coverGlow);
      root.dataset.blur = String(next.coverBlur);
      root.dataset.idle = String(next.idleCard);
      idleText.textContent = String(next.idleText).split("{command}").join(commandWord(next));
      title.hidden = !next.title;
      title.textContent = next.titleText;
      if (changed) { nowHost.replaceChildren(); nodes.delete(nowKey); nowKey = ""; }
      show();
      if (nowKey && nodes.get(nowKey)?.t) requestAnimationFrame(() => measure(nodes.get(nowKey)));
    },
    render(view) { last = view; show(); },
  };
}

// ── The Live Counter ────────────────────────────────────────────────────────────────────────────────────────────────

const ICON_PATHS = {
  eye: ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"],
  heart: ["M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"],
  gem: ["M6 3h12l4 6-10 12L2 9Z"],
};

/** A small drawn picture (an eye, a heart): our own shapes, not anything a viewer wrote. */
function counterIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ICON_PATHS[name]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  if (name === "eye") {
    const pupil = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    pupil.setAttribute("cx", "12");
    pupil.setAttribute("cy", "12");
    pupil.setAttribute("r", "3");
    svg.append(pupil);
  }
  return svg;
}

/** The Live Counter: how many are watching and the likes. Returns { apply(settings), render({ viewers, likes }) }. */
export function createCounterView(host) {
  const root = el("div", { className: "counter" });
  const box = el("div", { className: "counter__box" });
  root.append(box);
  host.append(root);
  const parts = {};
  for (const [kind, icon] of [["viewers", "eye"], ["likes", "heart"]]) {
    const picture = el("span", { className: "counter__icon" });
    picture.append(counterIcon(icon));
    const num = el("span", { className: "counter__num" });
    const label = el("span", { className: "counter__label" });
    const item = el("div", { className: `counter__item counter__item--${kind}`, hidden: true });
    item.append(picture, num, label);
    box.append(item);
    parts[kind] = { item, picture, num, label, shown: -1 };
  }
  let settings = null;
  let last = { viewers: null, likes: null };

  function paint({ viewers, likes }, bumpAllowed) {
    const values = { viewers, likes };
    for (const kind of ["viewers", "likes"]) {
      const part = parts[kind];
      const wanted = kind === "viewers" ? settings.showViewers : settings.showLikes;
      const value = values[kind];
      part.item.hidden = !wanted || value === null; // (each number stays hidden until it is known)
      part.picture.hidden = !settings.icons;
      part.label.textContent = kind === "viewers" ? settings.viewersLabel : settings.likesLabel;
      part.label.hidden = !part.label.textContent;
      if (value === null || value === part.shown) continue;
      part.num.textContent = formatCount(value, settings.short);
      if (bumpAllowed && settings.bump && part.shown >= 0 && value > part.shown && !reducedMotion()) {
        part.num.classList.remove("counter__num--bump");
        void part.num.offsetWidth; // so the bump starts over when numbers come quickly
        part.num.classList.add("counter__num--bump");
      }
      part.shown = value;
    }
  }

  return {
    apply(next) {
      settings = next;
      applyLook(root, next);
      root.dataset.layout = next.layout;
      for (const part of Object.values(parts)) part.shown = -1; // written again: the number's look (short or not) may have changed
      paint(last, false);
    },
    render(state) {
      if (!settings) return;
      last = state;
      paint(state, true);
    },
  };
}

// ── The subathon timer ──────────────────────────────────────────────────────────────────────────────────────────────

/** Seconds written short for the "+" bump: 30s, 2m 30s, 1h 5m. */
function shortSeconds(seconds) {
  const n = Math.abs(Math.round(seconds));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  return [h && `${h}h`, m && `${m}m`, (s || (!h && !m)) && !h && `${s}s`].filter(Boolean).join(" ");
}

/** The subathon timer. Returns { apply(settings), render({ text, status }), pop(seconds) }. `status` is ready, running, paused or ended. */
export function createTimerView(host) {
  const root = el("div", { className: "timer" });
  const box = el("div", { className: "timer__box" });
  const label = el("p", { className: "timer__label" });
  const clock = el("div", { className: "timer__clock" });
  // the Tiles layout writes the clock as three cards instead: hours, minutes, seconds
  const tiles = el("div", { className: "timer__tiles" });
  const tile = {};
  for (const [part, name] of [["h", "hours"], ["m", "minutes"], ["s", "seconds"]]) {
    tile[part] = { num: el("b", { className: "timer__num" }), unit: el("small", { className: "timer__unit", textContent: name }) };
    tiles.append(el("div", { className: "timer__tile" }, tile[part].num, tile[part].unit));
  }
  const note = el("p", { className: "timer__note", hidden: true });
  const plus = el("span", { className: "timer__plus", hidden: true });
  box.append(label, clock, tiles, note, plus);
  root.append(box);
  host.append(root);
  let settings = null;
  let total = 0;
  let hide = 0;
  let shown = { text: "", status: "" };

  return {
    apply(next) {
      settings = next;
      applyLook(root, next);
      label.textContent = next.label;
      label.hidden = !next.label;
      root.dataset.layout = next.layout;
      shown.text = ""; // written again: the layout (and so the way the time is written) may have changed
    },
    render({ text, status }) {
      if (text !== shown.text) {
        clock.textContent = text;
        const parts = text.split(":");
        while (parts.length < 3) parts.unshift("0");
        tile.h.num.parentElement.hidden = settings?.hours !== "always" && parts[0] === "0"; // no hours card while there are none, unless they are always shown
        [tile.h.num.textContent, tile.m.num.textContent, tile.s.num.textContent] = [parts[0].padStart(2, "0"), parts[1], parts[2]];
      }
      if (status !== shown.status) {
        root.dataset.status = status;
        note.hidden = status !== "paused" && status !== "ended";
        note.textContent = status === "ended" ? "Time’s up!" : "Paused";
      }
      shown = { text, status };
    },
    /** A bump for time that was added (or taken away): several in a short time add up in one bump. */
    pop(seconds) {
      if (!settings?.showPlus || !seconds) return;
      total += seconds;
      plus.hidden = false;
      plus.textContent = `${total > 0 ? "+" : "−"}${shortSeconds(total)}`;
      plus.dataset.tone = total > 0 ? "up" : "down";
      plus.classList.remove("timer__plus--in");
      if (!reducedMotion()) {
        void plus.offsetWidth; // so the bump starts over for each gift
        plus.classList.add("timer__plus--in");
      }
      clearTimeout(hide);
      hide = setTimeout(() => { plus.hidden = true; total = 0; }, 1800);
    },
  };
}

// ── AI Talking Pet TTS ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Talking pet mascot + speech bubble view. Swaps between peeker-a and peeker-b while audio
 * amplitude pulses `--tts-level` (0..1) so the pet hops along with its voice.
 */
export function createTtsView(host) {
  const root = el("div", { className: "tts", "data-speaking": "0" });
  const stage = el("div", { className: "tts__stage" });
  const petBox = el("div", { className: "tts__pet", "aria-hidden": "true" });
  const imgA = el("img", { className: "tts__sprite tts__sprite--a", alt: "" });
  const imgB = el("img", { className: "tts__sprite tts__sprite--b", alt: "", hidden: true });
  const imgC = el("img", { className: "tts__sprite tts__sprite--c", alt: "", hidden: true });
  petBox.append(imgA, imgB, imgC);

  const bubble = el("div", { className: "tts__bubble", hidden: true });
  const meta = el("div", { className: "tts__meta" });
  const author = el("span", { className: "tts__author" });
  const badge = el("span", { className: "tts__badge" });
  meta.append(author, badge);
  const textEl = el("p", { className: "tts__text" });
  bubble.append(meta, textEl);

  stage.append(petBox, bubble);
  root.append(stage);
  host.append(root);

  let settings = null;
  let speaking = false;
  let useExcited = false;
  let idleTimer = 0;
  let lastFlip = 0;
  let useB = false;

  const syncPet = (pet, next = settings) => {
    const off = !pet || pet === "none";
    petBox.hidden = off;
    if (off) return;
    if (pet === "custom" && MEDIA_ID.test(next?.petIdle ?? "")) {
      const idleSrc = mediaUrl(next.petIdle);
      const talkSrc = MEDIA_ID.test(next?.petTalk ?? "") ? mediaUrl(next.petTalk) : idleSrc;
      const excitedSrc = MEDIA_ID.test(next?.petExcited ?? "") ? mediaUrl(next.petExcited) : talkSrc;
      imgA.src = idleSrc;
      imgB.src = talkSrc;
      imgC.src = excitedSrc;
    } else {
      const fallbackPet = pet === "custom" ? "frog2" : pet;
      const a = decoPieces(fallbackPet, 0, { peek: true, corner: false, spark: false })?.peek;
      const b = decoPieces(fallbackPet, 1, { peek: true, corner: false, spark: false })?.peek;
      if (a?.src) imgA.src = a.src;
      if (b?.src || a?.src) {
        imgB.src = b?.src || a.src;
        imgC.src = b?.src || a.src;
      }
    }
    if (!speaking) {
      imgA.hidden = false;
      imgB.hidden = true;
      imgC.hidden = true;
    }
  };

  return {
    apply(next) {
      settings = next;
      applyLook(root, next);
      syncPet(next.pet, next);
      root.dataset.pet = next.pet || "none";
      if (!next.showBubble) bubble.hidden = true;
      else if (speaking) bubble.hidden = false;
    },
    start(item) {
      clearTimeout(idleTimer);
      speaking = true;
      useExcited = Boolean(item.kind === "gift" && settings?.pet === "custom" && MEDIA_ID.test(settings?.petExcited ?? ""));
      root.dataset.speaking = "1";
      root.dataset.kind = item.kind || "chat";
      author.textContent = item.author || "";
      badge.textContent = item.badge || "";
      badge.hidden = !item.badge || item.badge === "chat";
      textEl.textContent = item.kind === "gift" ? item.text : item.message || item.text;
      bubble.hidden = settings ? !settings.showBubble : false;
    },
    updateText(nextText) {
      if (typeof nextText === "string" && nextText.trim()) {
        textEl.textContent = nextText.trim();
      }
    },
    level(v) {
      const clamped = Math.max(0, Math.min(1, Number(v) || 0));
      root.style.setProperty("--tts-level", clamped.toFixed(3));
      const now = performance.now();
      if (speaking && clamped > 0.24 && now - lastFlip > 130) {
        useB = !useB;
        lastFlip = now;
        imgA.hidden = useB;
        imgB.hidden = !useB || useExcited;
        imgC.hidden = !useB || !useExcited;
      } else if (!speaking || clamped <= 0.05) {
        useB = false;
        imgA.hidden = false;
        imgB.hidden = true;
        imgC.hidden = true;
      }
    },
    idle() {
      speaking = false;
      useExcited = false;
      root.style.setProperty("--tts-level", "0");
      useB = false;
      imgA.hidden = false;
      imgB.hidden = true;
      imgC.hidden = true;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (speaking) return;
        root.dataset.speaking = "0";
        bubble.hidden = true;
      }, 900);
    },
    clear() {
      clearTimeout(idleTimer);
      speaking = false;
      useExcited = false;
      root.dataset.speaking = "0";
      root.style.setProperty("--tts-level", "0");
      imgA.hidden = false;
      imgB.hidden = true;
      imgC.hidden = true;
      bubble.hidden = true;
    },
  };
}

const safePic = (url) => (/^https:\/\/[^"'\s<>]+$/i.test(url || "") || /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(url || "") ? url : "");

/**
 * The Rotating Highlights overlay view: displays the active card (Last gift, Last follower, Last sub, Last bits,
 * Top gifter / sub gifter / bit sender) with smooth enter/exit transitions and indicator dots. Returns { apply(settings), render(snapshot), clear() }.
 */
export function createLabelsView(host) {
  const root = el("div", { className: "labels" });
  host.append(root);
  const stage = el("div", { className: "labels__stage" });
  const dots = el("div", { className: "labels__dots" });
  dots.setAttribute("aria-hidden", "true");
  root.append(stage, dots);

  let settings = null;
  let lastSnapshot = null;
  let lastRevision = -1;
  let lastCelebrateId = -1;
  let currentCard = null;
  const fxTimers = new Set();

  function populateMedia(media, card) {
    media.replaceChildren();
    const giftPic = safePic(card.picture);
    const hasMedia = !card.empty && Boolean(giftPic || card.initialName);
    media.hidden = !(Boolean(settings?.avatar) && hasMedia);
    if (!hasMedia) return false;
    if (giftPic) {
      const img = el("img", { className: "labelcard__gift", src: giftPic, alt: "", referrerPolicy: "no-referrer" });
      img.addEventListener("error", () => { img.remove(); media.hidden = true; }, { once: true });
      media.append(img);
    } else {
      const initial = [...(card.initialName || "?")][0].toUpperCase();
      const av = el("span", { className: "labelcard__av", textContent: initial });
      const avPic = safePic(card.avatar);
      if (avPic) {
        const img = el("img", { className: "gift__avimg", src: avPic, alt: "", referrerPolicy: "no-referrer" });
        img.addEventListener("load", () => av.classList.add("labelcard__av--pic"), { once: true });
        img.addEventListener("error", () => img.remove(), { once: true });
        av.append(img);
      }
      media.append(av);
    }
    if (card.top) media.append(crownIcon("labelcard__crown"));
    return true;
  }

  function sparkleBurst(fxHost, kind) {
    if (!fxHost || settings?.anim === "none" || reducedMotion()) return;
    fxHost.replaceChildren();
    if (kind === "leader") {
      confettiBurst(fxHost, 18, { spreadX: 95, spreadY: 65, minDist: 34, yMul: 0.75 });
    }
    const glyphs = kind === "leader" ? ["★", "✦", "✧"] : ["✦", "✧", "★"];
    const total = kind === "leader" ? 10 : 8;
    for (let i = 0; i < total; i += 1) {
      const p = el("span", { className: "labelcard__spark", textContent: glyphs[i % glyphs.length] });
      const angle = (Math.PI * 2 * i) / total + (Math.random() - 0.5) * 0.4;
      const dist = 42 + Math.random() * 52;
      p.style.setProperty("--sx", `${Math.round(Math.cos(angle) * dist * 1.25)}px`);
      p.style.setProperty("--sy", `${Math.round(Math.sin(angle) * dist * 0.75)}px`);
      p.style.setProperty("--sr", `${Math.round((Math.random() - 0.5) * 90)}deg`);
      p.style.setProperty("--sd", `${Math.round(i * 22)}ms`);
      p.style.color = i % 2 === 0 ? "#ffd23f" : "var(--a-pop, #f48)";
      fxHost.append(p);
    }
    const tid = setTimeout(() => {
      fxTimers.delete(tid);
      fxHost.replaceChildren();
    }, 1050);
    fxTimers.add(tid);
  }

  function buildCard(card) {
    const node = el("div", { className: "labelcard labelcard--in" });
    node.dataset.slot = card.id || "idle";
    node.dataset.top = card.top ? "true" : "false";

    const clip = el("span", { className: "labelcard__clip" }, el("i", { className: "labelcard__sheen" }));
    clip.setAttribute("aria-hidden", "true");
    const fxHost = el("span", { className: "alert__fx labelcard__fx" });
    fxHost.setAttribute("aria-hidden", "true");

    const media = el("span", { className: "labelcard__media" });
    media.setAttribute("aria-hidden", "true");
    const hasMedia = populateMedia(media, card);

    const kicker = el("span", { className: "labelcard__kicker" });
    const label = el("span", { className: "labelcard__label", textContent: card.label || "" });
    if (card.top) {
      const mini = crownIcon("labelcard__minicrown");
      kicker.append(mini, label);
    } else {
      kicker.append(label);
    }
    const headline = el("strong", { className: "labelcard__headline", textContent: card.headline || "" });
    const detail = el("span", { className: "labelcard__detail", textContent: card.detail || "" });
    detail.hidden = !card.detail;

    const body = el("span", { className: "labelcard__body" }, kicker, headline, detail);
    node.append(clip, fxHost, media, body);
    node.addEventListener("animationend", (e) => {
      if (e.target === node) node.classList.remove("labelcard--in", "labelcard--bump");
    });
    return {
      node,
      fxHost,
      label,
      headline,
      detail,
      media,
      hasMedia,
      mediaKey: `${card.picture || ""}|${card.avatar || ""}|${card.initialName || ""}|${Boolean(card.top)}`,
    };
  }

  function renderDots(snapshot) {
    const show = Boolean(settings?.showDots) && snapshot.count > 1;
    dots.hidden = !show;
    if (!show) { dots.replaceChildren(); return; }
    dots.replaceChildren();
    for (let i = 0; i < snapshot.count; i += 1) {
      const dot = el("i", { className: "labels__dot" });
      if (i === snapshot.index) {
        dot.setAttribute("aria-current", "true");
        dot.append(el("b", { className: "labels__dotfill" }));
      }
      dots.append(dot);
    }
  }

  return {
    apply(next) {
      settings = next;
      applyLook(root, next);
      root.dataset.layout = next.layout || "card";
      root.dataset.enter = next.enter || "slide";
      root.dataset.anim = next.anim || "shine";
      const rotateMs = Math.max(3, Math.min(30, Number(next.rotateSec) || 6)) * 1000;
      root.style.setProperty("--rotate-ms", `${rotateMs}ms`);
      if (lastSnapshot) this.render(lastSnapshot);
    },
    render(snapshot) {
      if (!settings || !snapshot) return;
      lastSnapshot = snapshot;
      renderDots(snapshot);

      const celebId = Number(snapshot.celebrateId) || 0;
      const shouldCelebrate = lastCelebrateId >= 0 && celebId > lastCelebrateId;
      lastCelebrateId = celebId;

      if (!snapshot.card) {
        if (currentCard) { currentCard.node.remove(); currentCard = null; }
        lastRevision = snapshot.revision;
        return;
      }

      const rotated = snapshot.revision !== lastRevision;
      lastRevision = snapshot.revision;

      if (!rotated && currentCard && currentCard.node.dataset.slot === (snapshot.card.id || "idle")) {
        const nextMediaKey = `${snapshot.card.picture || ""}|${snapshot.card.avatar || ""}|${snapshot.card.initialName || ""}|${Boolean(snapshot.card.top)}`;
        if (nextMediaKey !== currentCard.mediaKey) {
          currentCard.hasMedia = populateMedia(currentCard.media, snapshot.card);
          currentCard.mediaKey = nextMediaKey;
        } else {
          currentCard.media.hidden = !(Boolean(settings?.avatar) && currentCard.hasMedia);
        }
        currentCard.node.dataset.top = snapshot.card.top ? "true" : "false";
        currentCard.label.textContent = snapshot.card.label || "";
        currentCard.headline.textContent = snapshot.card.headline || "";
        currentCard.detail.textContent = snapshot.card.detail || "";
        currentCard.detail.hidden = !snapshot.card.detail;
        if (shouldCelebrate) {
          currentCard.node.classList.remove("labelcard--bump");
          void currentCard.node.offsetWidth;
          currentCard.node.classList.add("labelcard--bump");
          sparkleBurst(currentCard.fxHost, snapshot.celebrateKind || "event");
        }
        return;
      }

      const prev = currentCard?.node;
      if (prev) {
        prev.classList.remove("labelcard--in", "labelcard--bump");
        prev.classList.add("labelcard--out");
        setTimeout(() => prev.remove(), 280);
      }

      currentCard = buildCard(snapshot.card);
      stage.append(currentCard.node);
      if (shouldCelebrate && !snapshot.card.empty) {
        sparkleBurst(currentCard.fxHost, snapshot.card.top ? "leader" : (snapshot.celebrateKind || "event"));
      }
    },
    clear() {
      for (const tid of fxTimers) clearTimeout(tid);
      fxTimers.clear();
      stage.replaceChildren();
      dots.replaceChildren();
      dots.hidden = true;
      currentCard = null;
      lastSnapshot = null;
      lastRevision = -1;
      lastCelebrateId = -1;
    },
  };
}

/**
 * The Gift Jar overlay view (TikTok LIVE only): 6 crystal glass container designs with live 2D rigid-body
 * gift physics, rising bubbling liquid wave, overflowing rim cascade, and full celebration confetti.
 */
export function createJarView(host) {
  const root = el("div", { className: "jar" });
  host.append(root);

  const title = el("p", { className: "jar__title" });
  const thanks = el("p", { className: "jar__thanks", hidden: true });
  const box = el("div", { className: "jar__box" });
  box.dataset.items = "0";
  const canvasCtrl = createJarCanvas(box, { reducedMotion });
  const fullBadge = el("span", { className: "jar__fullbadge", textContent: "FULL!", hidden: true });
  const meta = el("p", { className: "jar__meta" });
  const partyLayer = el("div", { className: "jar__party", hidden: true });
  partyLayer.setAttribute("aria-hidden", "true");
  const fx = el("span", { className: "alert__fx jar__fx" });
  const cheer = el("p", { className: "jar__cheer" });
  partyLayer.append(fx, cheer);

  box.append(fullBadge, partyLayer);
  root.append(title, box, meta, thanks);

  let settings = null;
  let lastSnapshot = null;
  let thanksTimer = 0;
  let partyTimer = 0;
  let pendingDropUid = "";

  function readThemeVars(next) {
    const cs = getComputedStyle(root);
    const read = (prop, cssVar, fallback) => next[prop] || cs.getPropertyValue(cssVar).trim() || fallback;
    return {
      accent: read("accent", "--a-accent", "#34d399"),
      pop: read("pop", "--a-pop", "#facc15"),
      bg: read("bg", "--a-bg", "#0f172a"),
      text: read("text", "--a-text", "#f8fafc"),
    };
  }

  function syncMeta() {
    if (!settings || !lastSnapshot) return;
    const { total, target, percent, full, goalBy, items } = lastSnapshot;
    const parts = [];
    if (settings.showNumbers) {
      const shown = settings.capNumbers ? Math.min(total, target) : total;
      const unit = goalBy === "count" ? (target === 1 ? "gift" : "gifts") : "diamonds";
      parts.push(`${shown.toLocaleString("en-US")} / ${target.toLocaleString("en-US")} ${unit}`);
    }
    if (settings.showPercent) parts.push(`${percent}%`);
    meta.hidden = parts.length === 0;
    meta.textContent = parts.join(" · ");
    fullBadge.hidden = !full;
    root.dataset.full = String(Boolean(full));
    const count = settings.showDrops && Array.isArray(items) ? items.length : 0;
    box.dataset.items = String(count);
  }

  return {
    apply(next) {
      settings = next;
      applyLook(root, next);
      const design = next.design || "boba";
      root.dataset.design = design;
      title.hidden = !next.title;
      title.textContent = next.titleText || "Gift jar";
      if (!next.showThanks) thanks.hidden = true;
      canvasCtrl.setConfig({
        design,
        showLiquid: Boolean(next.showLiquid),
        showDrops: Boolean(next.showDrops),
        vars: readThemeVars(next),
      });
      if (lastSnapshot) {
        syncMeta();
        canvasCtrl.sync({
          percent: lastSnapshot.percent,
          full: lastSnapshot.full,
          items: lastSnapshot.items || [],
          droppedUid: "",
        });
      }
    },
    drop(item) {
      pendingDropUid = item?.uid || "";
      if (settings?.showThanks && item) {
        thanks.textContent = item.count > 1 ? `${item.name} sent ${item.count}x ${item.gift}` : `${item.name} sent ${item.gift}`;
        thanks.hidden = false;
        clearTimeout(thanksTimer);
        thanksTimer = setTimeout(() => { thanks.hidden = true; }, 3500);
      }
    },
    render(snapshot) {
      if (!settings || !snapshot) return;
      lastSnapshot = snapshot;
      syncMeta();
      canvasCtrl.sync({
        percent: snapshot.percent,
        full: snapshot.full,
        items: snapshot.items || [],
        droppedUid: pendingDropUid,
      });
      pendingDropUid = "";
    },
    celebrate(words, ms = 6000) {
      clearTimeout(partyTimer);
      cheer.textContent = words || "Jar full!";
      cheer.hidden = !words;
      root.dataset.celebrating = "true";
      partyLayer.hidden = false;
      partyLayer.classList.add("jar__party--on");
      confettiBurst(fx, 44, { spreadX: 160, spreadY: 160, minDist: 80, yMul: 0.95 });
      return new Promise((resolve) => {
        partyTimer = setTimeout(() => {
          delete root.dataset.celebrating;
          partyLayer.hidden = true;
          partyLayer.classList.remove("jar__party--on");
          fx.replaceChildren();
          resolve();
        }, ms);
      });
    },
      clear() {
        clearTimeout(thanksTimer);
        clearTimeout(partyTimer);
        delete root.dataset.celebrating;
        thanks.hidden = true;
        partyLayer.hidden = true;
        partyLayer.classList.remove("jar__party--on");
        fx.replaceChildren();
        box.dataset.items = "0";
        canvasCtrl.clear();
        if (lastSnapshot) {
          lastSnapshot = { ...lastSnapshot, total: 0, percent: 0, full: false, items: [] };
          syncMeta();
          canvasCtrl.sync({ percent: 0, full: false, items: [], droppedUid: "" });
        }
      },
      destroy() {
        clearTimeout(thanksTimer);
        clearTimeout(partyTimer);
        canvasCtrl.destroy?.();
      },
  };
}

// ── Spin the Wheel ───────────────────────────────────────────────────────────────────────────────────────────────────

let sharedTickCtx = null;

/** Synthesizes a short woody peg click via Web Audio for wheel pointer ticks with zero external assets. */
export function playWheelTick() {
  const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Ctor) return false;
  try {
    if (!sharedTickCtx) sharedTickCtx = new Ctor();
    if (sharedTickCtx.state === "suspended") { try { sharedTickCtx.resume(); } catch {} }
    if (sharedTickCtx.state !== "running") return false;
    const now = sharedTickCtx.currentTime;
    const osc = sharedTickCtx.createOscillator();
    const gain = sharedTickCtx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1450, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.028);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);
    osc.connect(gain);
    gain.connect(sharedTickCtx.destination);
    osc.start(now);
    osc.stop(now + 0.04);
    return true;
  } catch {
    return false;
  }
}

const CLASSIC_WHEEL_PALETTE = ["#ffcc00", "#ff5f86", "#53c68c", "#65b8f6", "#c8b6ff", "#ffb347"];
const KAWAII_WHEEL_PALETTE = ["#ffe5ec", "#d8f3dc", "#fff3b0", "#e9efff", "#f3d9fa", "#fde2e4"];
const CRYSTAL_WHEEL_PALETTE = ["#1e2638", "#35405c", "#1e2638", "#35405c", "#1e2638", "#35405c"];

/** Returns the 6 slice swatch colors & dot border color matching the wheel's active design & look palette. */
export function wheelSlicePalette(settings) {
  const accent = settings?.accent || "#ffcc00";
  const pop = settings?.pop || "#ff5f86";
  const design = settings?.design || "classic";
  if (design === "kawaii") return { colors: KAWAII_WHEEL_PALETTE, ring: "#1f2430" };
  if (design === "crystal") return { colors: CRYSTAL_WHEEL_PALETTE, ring: accent };
  return { colors: [accent, pop, ...CLASSIC_WHEEL_PALETTE.slice(2)], ring: "#1f2430" };
}

function hexLuminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return 180;
  const n = parseInt(m[1], 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
}

/**
 * Animated canvas Spin the Wheel view (3 designs, spring top flapper, peg tick events, queue pill,
 * confetti winner banner, and optional active-only idle hiding).
 */
export function createWheelView(host, { onTick = () => {}, onWin = () => {} } = {}) {
  const root = el("div", { className: "wheel" });
  host.append(root);

  const title = el("p", { className: "wheel__title" });
  const box = el("div", { className: "wheel__box" });
  const canvas = document.createElement("canvas");
  canvas.className = "wheel__canvas";
  canvas.setAttribute("aria-hidden", "true");
  const queueBadge = el("span", { className: "wheel__queue", hidden: true });

  const partyLayer = el("div", { className: "wheel__party", hidden: true });
  partyLayer.setAttribute("aria-hidden", "true");
  const fx = el("span", { className: "alert__fx wheel__fx" });
  const winCard = el("div", { className: "wheel__wincard" });
  const winWho = el("span", { className: "wheel__who" });
  const winPrize = el("strong", { className: "wheel__prize" });
  winCard.append(winWho, winPrize);
  partyLayer.append(fx, winCard);

  box.append(canvas, queueBadge, partyLayer);
  const meta = el("p", { className: "wheel__meta" });
  root.append(title, box, meta);

  const SIZE = 340;
  const TAU = Math.PI * 2;
  const ctx = canvas.getContext("2d");

  let settings = null;
  let lastSnapshot = null;
  let theta = 0;
  let flapAngle = 0;
  let spinning = false;
  let spinGen = 0;
  let raf = 0;
  let bulbPhase = 0;
  let activeResolve = null;

  function resize() {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const px = Math.round(SIZE * dpr);
    if (canvas.width !== px || canvas.height !== px) {
      canvas.width = px;
      canvas.height = px;
    }
    return dpr;
  }

  function themePalette() {
    const cs = getComputedStyle(root);
    const read = (prop, cssVar, fallback) => settings?.[prop] || cs.getPropertyValue(cssVar).trim() || fallback;
    const accent = read("accent", "--a-accent", "#ffcc00");
    const pop = read("pop", "--a-pop", "#ff5f86");
    const bg = read("bg", "--a-bg", "#ffffff");
    const text = read("text", "--a-text", "#1f2430");
    const design = settings?.design || "classic";
    if (design === "kawaii") return { design, accent, pop, bg, text, slices: KAWAII_WHEEL_PALETTE };
    return {
      design,
      accent,
      pop,
      bg,
      text,
      slices: [accent, pop, ...CLASSIC_WHEEL_PALETTE.slice(2)],
    };
  }

  function fitSliceLabel(context, rawText, maxW) {
    let txt = String(rawText || "");
    if (context.measureText(txt).width <= maxW) return txt;
    while (txt.length > 2 && context.measureText(txt + "…").width > maxW) txt = txt.slice(0, -1);
    return txt + "…";
  }

  function draw() {
    if (!ctx) return;
    const dpr = resize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);

    const cx = SIZE / 2;
    const cy = SIZE / 2 + 6;
    const outerR = 144;
    const slices = lastSnapshot?.slices?.length >= 2 ? lastSnapshot.slices : ["Prize 1", "Prize 2", "Prize 3", "Prize 4"];
    const arc = TAU / slices.length;
    const pal = themePalette();
    const isCrystal = pal.design === "crystal";
    const isKawaii = pal.design === "kawaii";

    // Contact drop shadow under wheel
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
    ctx.beginPath();
    ctx.arc(cx, cy + 7, outerR + 10, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Outer rim bezel
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, outerR + 10, 0, TAU);
    ctx.fillStyle = isCrystal ? "rgba(255, 255, 255, 0.22)" : isKawaii ? "#fff0f5" : "#1f2430";
    ctx.fill();
    ctx.lineWidth = isCrystal ? 2.5 : 4;
    ctx.strokeStyle = isCrystal ? pal.accent : isKawaii ? pal.pop : pal.accent;
    ctx.stroke();

    // Draw slices
    for (let i = 0; i < slices.length; i++) {
      const a0 = theta + i * arc;
      const a1 = a0 + arc;
      const sliceColor = pal.slices[i % pal.slices.length];

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, outerR - 1, a0, a1);
      ctx.closePath();

      if (isCrystal) {
        ctx.fillStyle = i % 2 === 0 ? "rgba(18, 24, 38, 0.72)" : "rgba(38, 46, 68, 0.72)";
      } else {
        ctx.fillStyle = sliceColor;
      }
      ctx.fill();

      ctx.lineWidth = isCrystal ? 1.8 : 2.5;
      ctx.strokeStyle = isCrystal ? "rgba(255, 255, 255, 0.55)" : isKawaii ? "#ffffff" : "#1f2430";
      ctx.stroke();

      // Slice text
      const mid = a0 + arc * 0.5;
      ctx.save();
      ctx.translate(cx, cy);
      const onRight = Math.cos(mid) >= 0;
      ctx.rotate(onRight ? mid : mid + Math.PI);
      const fontPx = slices.length >= 10 ? 11 : slices.length >= 7 ? 12.5 : 14;
      ctx.font = `800 ${fontPx}px ${settings?.font || "sans-serif"}`;
      ctx.textBaseline = "middle";
      ctx.textAlign = onRight ? "right" : "left";
      const label = fitSliceLabel(ctx, slices[i], outerR - 54);
      const textColor = isCrystal ? "#ffffff" : hexLuminance(sliceColor) < 142 ? "#ffffff" : "#1f2430";
      ctx.fillStyle = textColor;
      if (textColor === "#ffffff") {
        ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
        ctx.shadowBlur = 3;
      }
      ctx.fillText(label, onRight ? outerR - 16 : -(outerR - 16), 0);
      ctx.restore();
    }

    // Glossy inner radial highlight
    const sheen = ctx.createRadialGradient(cx - 28, cy - 36, 12, cx, cy, outerR);
    sheen.addColorStop(0, "rgba(255, 255, 255, 0.24)");
    sheen.addColorStop(1, "rgba(0, 0, 0, 0.08)");
    ctx.fillStyle = sheen;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, TAU);
    ctx.fill();

    // Peg studs on rim at each slice boundary
    for (let i = 0; i < slices.length; i++) {
      const pegA = theta + i * arc;
      const px = cx + Math.cos(pegA) * (outerR + 4);
      const py = cy + Math.sin(pegA) * (outerR + 4);
      ctx.beginPath();
      ctx.arc(px, py, 3.6, 0, TAU);
      const lit = (i + bulbPhase) % 2 === 0;
      ctx.fillStyle = lit ? "#ffffff" : pal.accent;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#1f2430";
      ctx.stroke();
    }

    // Center hub cap
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, TAU);
    ctx.fillStyle = isKawaii ? "#ffffff" : isCrystal ? pal.pop : "#1f2430";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = pal.accent;
    ctx.stroke();

    ctx.fillStyle = isKawaii ? pal.pop : "#ffd23f";
    ctx.font = "900 18px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("★", cx, cy + 1);
    ctx.restore();

    // Top 12 o'clock spring flapper pointer
    ctx.save();
    ctx.translate(cx, cy - outerR - 6);
    ctx.rotate(flapAngle);
    ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(-13, -10);
    ctx.lineTo(13, -10);
    ctx.lineTo(0, 18);
    ctx.closePath();
    ctx.fillStyle = pal.pop;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#1f2430";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -6, 4.5, 0, TAU);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.restore();
  }

  function syncMeta() {
    if (!settings || !lastSnapshot) return;
    queueBadge.hidden = !(lastSnapshot.queued > 0);
    queueBadge.textContent = `+${lastSnapshot.queued} ${lastSnapshot.queued === 1 ? "spin" : "spins"} queued`;

    const idleHide = settings.idleMode === "active" && !spinning;
    root.dataset.idleHidden = String(idleHide);

    if (!settings.showPrompt) {
      meta.hidden = true;
      return;
    }
    meta.hidden = false;
    if (lastSnapshot.triggerBy === "threshold") {
      meta.textContent = `${lastSnapshot.meter.toLocaleString("en-US")} / ${lastSnapshot.meterTarget.toLocaleString("en-US")} to next spin`;
    } else if (settings.giftName) {
      meta.textContent = `Send ${settings.giftName} to spin!`;
    } else {
      meta.textContent = `Send ${Number(settings.minDiamonds || 10).toLocaleString("en-US")}+ diamonds or ${Number(settings.minBits || 100).toLocaleString("en-US")}+ bits to spin!`;
    }
  }

  function clearTimersAndRaf() {
    if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
    raf = 0;
    if (activeResolve) {
      const done = activeResolve;
      activeResolve = null;
      done();
    }
  }

  return {
    apply(next) {
      settings = next;
      applyLook(root, next);
      root.dataset.design = next.design || "classic";
      title.hidden = !next.title;
      title.textContent = next.titleText || "Spin the wheel!";
      syncMeta();
      draw();
    },
    render(snapshot) {
      lastSnapshot = snapshot;
      if (snapshot?.totalSpins !== undefined) root.dataset.spins = String(snapshot.totalSpins);
      root.dataset.spinning = String(Boolean(snapshot?.spinning || spinning));
      syncMeta();
      draw();
    },
    spinTo(spinData, { spinMs = 5000, holdMs = 5000 } = {}) {
      clearTimersAndRaf();
      const myGen = ++spinGen;
      spinning = true;
      partyLayer.hidden = true;
      partyLayer.classList.remove("wheel__party--on");
      fx.replaceChildren();
      root.dataset.spinning = "true";
      syncMeta();

      const slices = lastSnapshot?.slices?.length >= 2 ? lastSnapshot.slices : parseSlicesFallback();
      const arc = TAU / slices.length;
      const targetIdx = Math.max(0, Math.min(slices.length - 1, Number(spinData?.index) || 0));
      const jitter = (Math.random() * 2 - 1) * arc * 0.28;
      const desiredMod = ((-Math.PI / 2 - (targetIdx + 0.5) * arc + jitter) % TAU + TAU) % TAU;
      const currentMod = ((theta % TAU) + TAU) % TAU;
      let deltaMod = (desiredMod - currentMod + TAU) % TAU;
      if (deltaMod < 0.15) deltaMod += TAU;
      const extraTurns = (5 + Math.floor(Math.random() * 2)) * TAU;
      const startTheta = theta;
      const totalDelta = extraTurns + deltaMod;

      const animSpinMs = reducedMotion() ? 140 : Math.max(1500, spinMs);
      const animHoldMs = reducedMotion() ? 450 : Math.max(1000, holdMs);
      let lastPeg = Math.floor((((-Math.PI / 2 - theta) % TAU + TAU) % TAU) / arc);

      return new Promise((resolve) => {
        activeResolve = resolve;
        const t0 = performance.now();

        const step = (now) => {
          if (myGen !== spinGen) return;
          const elapsed = now - t0;
          const t = Math.min(1, elapsed / animSpinMs);
          const eased = 1 - Math.pow(1 - t, 5);
          theta = startTheta + totalDelta * eased;

          const curPeg = Math.floor((((-Math.PI / 2 - theta) % TAU + TAU) % TAU) / arc);
          if (curPeg !== lastPeg && t < 0.995) {
            lastPeg = curPeg;
            bulbPhase = (bulbPhase + 1) % 2;
            flapAngle = -0.48;
            onTick(spinData);
          } else {
            flapAngle *= 0.82;
          }
          draw();

          if (t < 1) {
            raf = requestAnimationFrame(step);
            return;
          }
          raf = 0;
          flapAngle = 0;
          draw();

          winWho.textContent = spinData?.who ? `${spinData.who} · ${spinData.label || "Spin"}` : "Wheel Winner!";
          winPrize.textContent = spinData?.slice || slices[targetIdx];
          partyLayer.hidden = false;
          partyLayer.classList.add("wheel__party--on");
          confettiBurst(fx, 36, { spreadX: 165, spreadY: 165, minDist: 75, yMul: 0.9 });
          onWin(spinData);

          setTimeout(() => {
            if (myGen !== spinGen) return;
            partyLayer.hidden = true;
            partyLayer.classList.remove("wheel__party--on");
            fx.replaceChildren();
            spinning = false;
            root.dataset.spinning = "false";
            syncMeta();
            const done = activeResolve;
            activeResolve = null;
            done?.();
          }, animHoldMs);
        };

        if (typeof requestAnimationFrame === "function") raf = requestAnimationFrame(step);
        else {
          theta = startTheta + totalDelta;
          draw();
          spinning = false;
          const done = activeResolve;
          activeResolve = null;
          done?.();
        }
      });
    },
    clear() {
      ++spinGen;
      clearTimersAndRaf();
      spinning = false;
      partyLayer.hidden = true;
      partyLayer.classList.remove("wheel__party--on");
      fx.replaceChildren();
      theta = 0;
      flapAngle = 0;
      root.dataset.spinning = "false";
      syncMeta();
      draw();
    },
    destroy() {
      ++spinGen;
      clearTimersAndRaf();
    },
  };
}

function parseSlicesFallback() {
  return ["10 Pushups", "Sing a Chorus", "VIP Shoutout", "Sip Water"];
}

// ── OBS & Stream Actions ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Transparent overlay view for Actions: renders a pulsing broadcast `● REPLAY` badge during Replay Cam playback
 * and themed Frills action toast/banner cards with optional particle bursts. Stays completely invisible when idle.
 */
export function createActionsView(host) {
  const root = el("div", { className: "actions" });
  host.append(root);

  const replayBar = el("div", { className: "actions__replay", hidden: true });
  replayBar.setAttribute("aria-live", "polite");
  const replayDot = el("span", { className: "actions__dot" });
  replayDot.setAttribute("aria-hidden", "true");
  const replayBadge = el("strong", { className: "actions__rbadge", textContent: "REPLAY" });
  const replayWho = el("span", { className: "actions__rwho" });
  replayBar.append(replayDot, replayBadge, replayWho);

  const stack = el("div", { className: "actions__stack" });
  const stickyLayer = el("div", { className: "actions__stickies" });
  stickyLayer.setAttribute("aria-hidden", "true");
  root.append(replayBar, stack, stickyLayer);

  let settings = null;
  const timers = new Set();
  const activeStickies = [];
  let stickySlot = 0;
  const STICKY_SPOTS = [
    [52, 46, -8],
    [71, 36, 9],
    [34, 62, -12],
    [66, 66, 6],
    [48, 72, -4],
    [28, 40, 11],
  ];

  return {
    apply(next) {
      settings = next;
      applyLook(root, next);
    },
    showReplay({ badge = "REPLAY", who = "", label = "" } = {}) {
      replayBadge.textContent = String(badge || "REPLAY");
      replayWho.textContent = who ? `${who}${label ? ` · ${label}` : ""}` : "";
      replayWho.hidden = !replayWho.textContent;
      replayBar.hidden = false;
    },
    hideReplay() {
      replayBar.hidden = true;
    },
    showSticky({ base64 = "", maxNotes = 0 } = {}) {
      const clean = String(base64 || "").replace(/[^A-Za-z0-9+/=]/g, "");
      if (!clean) return;
      const [bx, by, brot] = STICKY_SPOTS[stickySlot % STICKY_SPOTS.length];
      stickySlot += 1;
      const jx = (Math.random() - 0.5) * 6;
      const jy = (Math.random() - 0.5) * 5;
      const jrot = (Math.random() - 0.5) * 8;
      const img = el("img", {
        className: "actions__sticky",
        src: `data:image/png;base64,${clean}`,
        alt: "",
      });
      img.style.setProperty("--sx", `${Math.max(12, Math.min(82, Math.round(bx + jx)))}%`);
      img.style.setProperty("--sy", `${Math.max(20, Math.min(78, Math.round(by + jy)))}%`);
      img.style.setProperty("--sr", `${Math.round(brot + jrot)}deg`);
      stickyLayer.append(img);
      activeStickies.push(img);

      const cap = maxNotes > 0 ? maxNotes : 16;
      while (activeStickies.length > cap) {
        const oldest = activeStickies.shift();
        if (!oldest) continue;
        oldest.classList.add("actions__sticky--out");
        const rid = setTimeout(() => { timers.delete(rid); oldest.remove(); }, 340);
        timers.add(rid);
      }
    },
    clearStickies() {
      activeStickies.length = 0;
      stickySlot = 0;
      stickyLayer.replaceChildren();
    },
    showToast({ title = "", text = "", fx = "none", ms } = {}) {
      if (settings && settings.showToasts === false && !fx) return;
      const card = el("div", { className: "actions__toast" });
      const fxHost = el("span", { className: "alert__fx actions__fx" });
      fxHost.setAttribute("aria-hidden", "true");
      const body = el("div", { className: "actions__tbody" });
      if (title) body.append(el("strong", { className: "actions__ttitle", textContent: String(title) }));
      if (text) body.append(el("span", { className: "actions__ttext", textContent: String(text) }));
      card.append(fxHost, body);
      stack.append(card);
      while (stack.children.length > 3) stack.firstElementChild?.remove();

      if (fx === "confetti") confettiBurst(fxHost, 24, { spreadX: 120, spreadY: 90, minDist: 40, yMul: 0.8 });
      else if (fx === "sparkles" || fx === "hearts") {
        const glyphs = fx === "hearts" ? ["♥", "♡"] : ["✦", "✧", "★"];
        for (let i = 0; i < 12; i++) {
          const p = el("i", { textContent: glyphs[i % glyphs.length] });
          const angle = (Math.PI * 2 * i) / 12 + Math.random() * 0.35;
          const dist = 48 + Math.random() * 58;
          p.style.setProperty("--dx", `${Math.round(Math.cos(angle) * dist)}px`);
          p.style.setProperty("--dy", `${Math.round(Math.sin(angle) * dist)}px`);
          p.style.setProperty("--r", `${Math.round((Math.random() - 0.5) * 50)}deg`);
          p.style.color = i % 2 === 0 ? "var(--a-accent, #fc0)" : "var(--a-pop, #f48)";
          fxHost.append(p);
        }
      }

      const hold = Math.max(1500, Number(ms) || ((Number(settings?.toastSeconds) || 4) * 1000));
      const tid = setTimeout(() => {
        timers.delete(tid);
        card.classList.add("actions__toast--out");
        const rid = setTimeout(() => { timers.delete(rid); card.remove(); }, 280);
        timers.add(rid);
      }, hold);
      timers.add(tid);
    },
    clear() {
      for (const tid of timers) clearTimeout(tid);
      timers.clear();
      replayBar.hidden = true;
      stack.replaceChildren();
      activeStickies.length = 0;
      stickySlot = 0;
      stickyLayer.replaceChildren();
    },
    destroy() {
      this.clear();
    },
  };
}
