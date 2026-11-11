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
      fx.replaceChildren();
      fx.dataset.fx = "confetti";
      if (!reducedMotion()) {
        for (let i = 0; i < 34; i++) {
          const p = el("i");
          const angle = Math.random() * Math.PI * 2;
          const far = 60 + Math.random() * 120;
          p.style.setProperty("--x", Math.round(Math.cos(angle) * far * 1.6) + "px");
          p.style.setProperty("--y", Math.round(Math.sin(angle) * far * 0.8) + "px");
          p.style.setProperty("--r", Math.round(Math.random() * 400 - 200) + "deg");
          p.style.setProperty("--d", Math.round(Math.random() * 300) + "ms");
          p.style.setProperty("--s", (0.7 + Math.random() * 0.7).toFixed(2));
          fx.append(p);
        }
      }
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
/** A little gold crown (drawn here so it is the same on every look), for the person being celebrated. */
function crownIcon() {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 64 48");
  svg.setAttribute("class", "likers__crown");
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
 * The Top Likers ranking. Rows slide to their new places when the order changes. Returns { apply(settings), render(top), clear(),
 * celebrate(person, { onStart }) }. `celebrate` zooms a person in (picture, name, their likes, a crown, confetti) over the list for the
 * seconds the settings say; one at a time, the next waits. It resolves to whether it was shown (false when too many are already waiting).
 */
export function createLikersView(host) {
  const root = el("div", { className: "likers" });
  host.append(root);
  const title = el("p", { className: "likers__title" });
  const rows = el("div", { className: "likers__rows" });
  root.append(title, rows);
  const nodes = new Map(); // person -> { node, count }
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
    if (!reducedMotion()) {
      fx.dataset.fx = "confetti";
      for (let i = 0; i < 46; i++) {
        const p = el("i");
        const angle = Math.random() * Math.PI * 2;
        const far = 150 + Math.random() * 190;
        p.style.setProperty("--x", Math.round(Math.cos(angle) * far * 1.5) + "px");
        p.style.setProperty("--y", Math.round(Math.sin(angle) * far) + "px");
        p.style.setProperty("--r", Math.round(Math.random() * 400 - 200) + "deg");
        p.style.setProperty("--d", Math.round(350 + Math.random() * 350) + "ms");
        p.style.setProperty("--s", (0.7 + Math.random() * 0.8).toFixed(2));
        fx.append(p);
      }
    }
    const pic = el("span", { className: "likers__pic", textContent: [...(person.name || "?")][0].toUpperCase() });
    pic.setAttribute("aria-hidden", "true");
    if (person.avatar) {
      const img = el("img", { className: "gift__avimg", src: person.avatar, alt: "", referrerPolicy: "no-referrer" });
      img.addEventListener("load", () => pic.classList.add("likers__pic--pic"));
      img.addEventListener("error", () => img.remove());
      pic.append(img);
    }
    const card = el("div", { className: "likers__trophy" }, crownIcon(), pic, el("strong", { className: "likers__who", textContent: person.name }));
    card.append(el("span", { className: "likers__total" }, el("span", { className: "likers__num", textContent: Number(person.count).toLocaleString("en-US") }), document.createTextNode(" likes")));
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

  /** Puts each row at its place: a row is placed by its rank, so changing the order is just changing the numbers. */
  function layout() {
    const first = rows.firstElementChild;
    if (!first) { rows.style.height = "0"; return; }
    const gap = parseFloat(getComputedStyle(rows).fontSize) * 0.5;
    const step = first.offsetHeight + gap;
    last.forEach((p, i) => { const n = nodes.get(p.key); if (n) n.node.style.transform = `translateY(${Math.round(i * step)}px)`; });
    rows.style.height = Math.max(0, Math.round(last.length * step - gap)) + "px";
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
    node.append(el("span", { className: "liker__name", textContent: person.name }));
    const count = el("span", { className: "liker__count" });
    count.hidden = !settings.showCounts;
    node.append(count);
    rows.append(node);
    return { node, rank, count, shown: -1 };
  }

  return {
    apply(next) {
      settings = next;
      applyLook(root, next);
      root.dataset.medals = String(next.medals);
      title.hidden = !next.title;
      title.textContent = next.titleText;
      for (const n of nodes.values()) n.count.hidden = !next.showCounts;
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
        n.node.dataset.rank = String(person.rank);
        n.rank.textContent = String(person.rank);
        n.count.textContent = person.count.toLocaleString("en-US");
        if (n.shown !== -1 && n.shown !== person.count) { n.count.classList.remove("liker__count--bump"); void n.count.offsetWidth; n.count.classList.add("liker__count--bump"); }
        n.shown = person.count;
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
