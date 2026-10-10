// Draws alerts. The engine (alerts.js) says what to show and when; this makes the card, runs its entrance, its burst of particles and its
// exit with CSS animations, and takes it away. Everything somebody else wrote (a name, a gift) goes in with textContent and text nodes,
// never as HTML.

import { el } from "./feed.js";
import { wording } from "./alerts.js";
import { alertVars } from "./alerts-settings.js";

const BURST = [10, 18, 30]; // particles for a small, medium and big alert
const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const rand = (min, max) => min + Math.random() * (max - min);

/**
 * The alerts on a page. `host` is an empty element the overlay or the editor's preview gives us (positioned over the whole stage).
 * Returns { apply(config), show(item), hide(item), clear() }.
 */
export function createAlertView(host) {
  host.classList.add("alerts");
  let config = null;
  const cards = new Map();

  function apply(next) {
    config = next;
    for (const [name, value] of Object.entries(alertVars(next))) host.style.setProperty(name, value);
    host.dataset.vpos = next.vpos;
    host.dataset.hpos = next.hpos;
    host.dataset.enter = next.enter;
    host.dataset.leave = next.leave;
    host.dataset.idle = next.idle;
    host.style.setProperty("--a-dir", next.hpos === "right" ? "1" : "-1");
  }

  function avatar(item) {
    const node = el("span", { className: "alert__av", textContent: [...(item.name || "?")][0].toUpperCase() });
    node.setAttribute("aria-hidden", "true");
    if (item.avatar) {
      const img = el("img", { className: "alert__img", src: item.avatar, alt: "", referrerPolicy: "no-referrer" });
      img.addEventListener("load", () => node.classList.add("alert__av--pic"));
      img.addEventListener("error", () => img.remove());
      node.append(img);
    }
    return node;
  }

  function burst(item) {
    const layer = el("span", { className: "alert__fx" });
    layer.setAttribute("aria-hidden", "true");
    if (item.fx === "none" || reducedMotion()) return layer;
    layer.dataset.fx = item.fx;
    const count = BURST[item.tier - 1] ?? BURST[0];
    for (let i = 0; i < count; i++) {
      const p = el("i");
      const angle = rand(0, Math.PI * 2);
      const far = rand(70, 150) * (1 + (item.tier - 1) * 0.35);
      p.style.setProperty("--x", Math.round(Math.cos(angle) * far * 1.5) + "px");
      p.style.setProperty("--y", Math.round(Math.sin(angle) * far) + "px");
      p.style.setProperty("--r", Math.round(rand(-200, 200)) + "deg");
      p.style.setProperty("--d", Math.round(rand(0, 260)) + "ms");
      p.style.setProperty("--s", rand(0.7, 1.4).toFixed(2));
      layer.append(p);
    }
    return layer;
  }

  function show(item) {
    if (!config) return;
    const words = el("span", { className: "alert__words" });
    for (const piece of wording(item, config)) {
      words.append(piece.mark ? el("strong", { className: "alert__mark", textContent: piece.text }) : document.createTextNode(piece.text));
    }
    const card = el("div", { className: "alert__card" });
    if (config.avatar) card.append(avatar(item));
    card.append(words);
    if (config.giftPicture && item.picture) card.append(el("img", { className: "alert__gift", src: item.picture, alt: "", referrerPolicy: "no-referrer" }));
    const node = el("div", { className: "alert alert--in" }, burst(item), card);
    node.dataset.kind = item.kind;
    node.dataset.tier = String(item.tier);
    node.setAttribute("role", "status");
    cards.set(item.key, node);
    host.append(node);
  }

  function hide(item) {
    const node = cards.get(item.key);
    if (!node) return;
    cards.delete(item.key);
    node.classList.remove("alert--in");
    node.classList.add("alert--out");
    setTimeout(() => node.remove(), (config?.speed ?? 500) + 80);
  }

  function clear() {
    for (const node of cards.values()) node.remove();
    cards.clear();
  }

  return { apply, show, hide, clear };
}
