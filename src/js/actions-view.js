// View builder for Stream Commands & Gear Pop-ups (Actions)
// Displays an animated, cozy card on stream with mascot peekers, trigger badge, gear details, and audio chime.

import { PACK_MASCOTS, DEFAULT_PACK, DEFAULT_DURATION } from "./actions.js";
import { createSounds } from "./sounds.js";

const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "className") node.className = v;
    else if (k === "textContent") node.textContent = v;
    else if (k.startsWith("data-")) node.setAttribute(k, v);
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (typeof child === "string" || typeof child === "number") node.append(document.createTextNode(String(child)));
    else if (child instanceof Node) node.append(child);
  }
  return node;
};

export function createActionsView(host, initialConfig = {}) {
  let config = { ...initialConfig };
  let sounds = null;
  let activeCard = null;
  let dismissTimer = null;
  let animTimer = null;

  try {
    sounds = createSounds();
  } catch {
    sounds = null;
  }

  // Ensure host has correct stage classes
  host.classList.add("action-stage");
  if (config.position) host.dataset.position = config.position;

  function playSound() {
    if (!sounds || !config.sound || config.sound === "none") return;
    try {
      sounds.play(config.sound);
    } catch {
      // Audio playback restrictions or unsupported
    }
  }

  function dismiss() {
    if (dismissTimer) clearTimeout(dismissTimer);
    if (animTimer) clearTimeout(animTimer);
    dismissTimer = null;
    animTimer = null;

    if (activeCard) {
      const card = activeCard;
      activeCard = null;
      card.classList.remove("action--enter");
      card.classList.add("action--exit");
      animTimer = setTimeout(() => {
        card.remove();
      }, 400);
    }
  }

  function trigger(command) {
    if (!command) return;

    // Dismiss existing card immediately or morph
    if (activeCard) {
      if (dismissTimer) clearTimeout(dismissTimer);
      if (animTimer) clearTimeout(animTimer);
      activeCard.remove();
      activeCard = null;
    }

    const packKey = PACK_MASCOTS[config.pack] ? config.pack : DEFAULT_PACK;
    const pack = PACK_MASCOTS[packKey];
    const duration = Math.max(2, Math.min(30, Number(config.duration) || DEFAULT_DURATION));

    // Sound chime
    playSound();

    // Trigger label: e.g. ".mouse" or "!specs"
    const prefix = config.prefix ?? ".";
    const rawTrig = command.trigger || "";
    const displayTrig = /^[!./?#~$%&*@^+=:;-]/.test(rawTrig) ? rawTrig : `${prefix}${rawTrig}`;

    // Elements
    const peekerImg = el("img", {
      className: "action-peeker",
      src: pack.peeker,
      alt: pack.name,
      loading: "eager",
      "aria-hidden": "true",
    });

    const badgeIcon = command.icon ? el("span", { className: "action-badge__icon", textContent: command.icon }) : null;
    const badgeText = el("span", { className: "action-badge__text", textContent: displayTrig });
    const badge = el("div", { className: "action-badge" }, ...(badgeIcon ? [badgeIcon] : []), badgeText);

    const titleEl = el("h3", { className: "action-title", textContent: command.title || displayTrig });
    const headerRow = el("div", { className: "action-header" }, badge, titleEl);

    const bodyEl = el("p", { className: "action-text", textContent: command.text || "" });

    // Progress countdown bar
    const barInner = el("div", { className: "action-bar-inner" });
    barInner.style.animationDuration = `${duration}s`;
    const bar = el("div", { className: "action-bar" }, barInner);

    const card = el(
      "div",
      { className: "action-popup action--enter", "data-pack": packKey },
      peekerImg,
      headerRow,
      bodyEl,
      bar
    );

    host.append(card);
    activeCard = card;

    // Auto-dismiss countdown
    dismissTimer = setTimeout(() => {
      dismiss();
    }, duration * 1000);
  }

  function apply(newConfig) {
    config = { ...config, ...newConfig };
    if (config.position) host.dataset.position = config.position;
  }

  function destroy() {
    dismiss();
    host.innerHTML = "";
    host.classList.remove("action-stage");
  }

  return {
    trigger,
    dismiss,
    apply,
    destroy,
    get active() {
      return Boolean(activeCard);
    },
  };
}
