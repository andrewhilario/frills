// Draws the Last Gifts list and the Follower Goal bar. What to show comes from gifts.js and goal.js; this only makes the elements.
// Everything somebody else wrote (a name, a gift) goes in with textContent and text nodes, never as HTML.

import { el } from "./feed.js";
import { fillTemplate } from "./alerts.js";
import { lookVars } from "./widget-settings.js";

const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function applyLook(host, settings) {
  for (const [name, value] of Object.entries(lookVars(settings))) host.style.setProperty(name, value);
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
  const fill = el("div", { className: "goal__fill" });
  const cheer = el("p", { className: "goal__cheer", hidden: true });
  const fx = el("span", { className: "alert__fx goal__fx" });
  fx.setAttribute("aria-hidden", "true");
  track.append(fill);
  root.append(el("div", { className: "goal__head" }, label, numbers), track, cheer, fx);
  let settings = null;
  let last = null;

  const show = () => {
    if (!settings || !last) return;
    label.textContent = settings.label;
    const parts = [];
    if (settings.showNumbers) parts.push(`${last.value.toLocaleString("en-US")} / ${last.goal.toLocaleString("en-US")}`);
    if (settings.showPercent) parts.push(`${last.percent}%`);
    numbers.textContent = parts.join("  ·  ");
    fill.style.width = last.percent + "%";
    root.dataset.full = String(last.percent >= 100);
  };

  return {
    apply(next) { settings = next; applyLook(root, next); show(); },
    update(snapshot) { last = snapshot; show(); },
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

/** The Top Likers ranking. Rows slide to their new places when the order changes. Returns { apply(settings), render(top), clear() }. */
export function createLikersView(host) {
  const root = el("div", { className: "likers" });
  host.append(root);
  const title = el("p", { className: "likers__title" });
  const rows = el("div", { className: "likers__rows" });
  root.append(title, rows);
  const nodes = new Map(); // person -> { node, count }
  let settings = null;
  let last = [];

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
  };
}
