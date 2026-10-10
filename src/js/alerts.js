// The alert engine: turns what TikTok tells us (a follow, a gift, a share) into an alert to show, and decides when each one appears and
// goes: how many at once, who waits, who is dropped when the line is too long, and how a crowd of follows is joined into one.
// No page and no clock of its own, so it is tested with a pretend clock; the view (alerts-view.js) only draws what this tells it.

import { PLACEHOLDERS } from "./alerts-settings.js";

/** 1 for a small gift, 2 for a medium one, 3 for a big one. Follows and shares are always 1. */
export const tierOf = (diamonds, config) => (diamonds >= config.giftBig ? 3 : diamonds >= config.giftMid ? 2 : 1);

const TIME_FACTOR = [1, 1.3, 1.7];
const PRIORITY = (item) => (item.kind === "gift" ? item.tier : 0); // gifts outrank follows and shares, bigger gifts outrank smaller

/**
 * A text with {name}, {gift}, {count}, {diamonds}, {total} and {others} in it -> pieces to draw: [{ text, mark }]. `mark` is true for the
 * parts that were filled in with a name or a gift, so the view can colour them. A placeholder we don't know is dropped. The words are
 * somebody else's, so they are only ever drawn as text, never as HTML.
 */
export function fillTemplate(template, vars) {
  const pieces = [];
  let rest = String(template ?? "");
  const pattern = /\{(\w+)\}/;
  for (let m = pattern.exec(rest); m; m = pattern.exec(rest)) {
    if (m.index > 0) pieces.push({ text: rest.slice(0, m.index), mark: false });
    const key = m[1];
    const value = PLACEHOLDERS.includes(key) ? String(vars[key] ?? "") : "";
    if (value) pieces.push({ text: value, mark: key === "name" || key === "gift" });
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) pieces.push({ text: rest, mark: false });
  return pieces;
}

/** An alert's words, from its kind, size and the settings. */
export function wording(item, config) {
  const vars = { name: item.name, gift: item.gift ?? "", count: item.count ?? "", diamonds: item.diamonds ?? "", total: item.total ?? "", others: item.others ?? "" };
  let template;
  if (item.kind === "follow") template = item.others ? config.followCrowd : config.followText;
  else if (item.kind === "share") template = item.others ? config.shareCrowd : config.shareText;
  else template = item.tier === 3 ? config.giftBigText : config.giftText;
  return fillTemplate(template, vars);
}

let serial = 0;

/**
 * An event from the relay ({ kind, id, name, avatar, ... }) -> an alert ready to queue, or null when that kind is switched off or the
 * gift is smaller than the smallest the person wants.
 */
export function makeAlert(event, config) {
  const kind = event?.kind;
  if (!["follow", "gift", "share"].includes(kind) || !config[`${kind}On`]) return null;
  const diamonds = kind === "gift" ? event.diamonds ?? 0 : 0;
  if (kind === "gift" && diamonds < config.giftMin) return null;
  const tier = kind === "gift" ? tierOf(diamonds, config) : 1;
  return {
    key: `a${++serial}`,
    kind,
    tier,
    name: event.name,
    avatar: event.avatar ?? "",
    picture: kind === "gift" ? event.picture ?? "" : "",
    gift: event.gift,
    count: event.count,
    diamonds,
    total: event.total,
    others: 0,
    time: Math.round(config[`${kind}Time`] * 1000 * TIME_FACTOR[tier - 1]),
    sound: config[`${kind}Sound`],
    fx: config[`${kind}Fx`],
  };
}

/**
 * Decides which alerts are on screen. `onShow(item)` and `onHide(item)` draw them; `timers` is setTimeout and clearTimeout (a pretend
 * pair in tests). `config` is the settings (maxShown, maxWaiting, merge, speed).
 */
export class AlertQueue {
  constructor(config, { onShow, onHide, timers = globalThis } = {}) {
    this.config = config;
    this.onShow = onShow ?? (() => {});
    this.onHide = onHide ?? (() => {});
    this.timers = timers;
    this.active = new Map(); // key -> { item, timer }
    this.waiting = [];
    this.gap = 0; // after one leaves, its place is held for its exit, so two never overlap on the same spot
    this.dropped = 0;
  }

  setConfig(config) {
    this.config = config;
    this.pump();
  }

  /** Adds an alert. It shows at once if there is room, else it waits (and may be joined with others, or push one out). */
  push(item) {
    if (this.active.size + this.gap < this.config.maxShown && !this.waiting.length) return this.show(item);
    this.waiting.push(item);
    if (this.config.merge) this.joinCrowd(item.kind);
    this.trim();
    return undefined;
  }

  /** Three or more follows (or shares) waiting become one alert: the first person's name and the number of others. */
  joinCrowd(kind) {
    if (kind === "gift") return;
    const same = this.waiting.filter((w) => w.kind === kind);
    // Three waiting make a crowd; once there is a crowd, the next one to arrive simply joins it.
    if (same.length < 3 && !same.some((w) => w.others)) return;
    if (same.length < 2) return;
    const first = same[0];
    const crowd = { ...first, others: same.reduce((n, w) => n + 1 + (w.others || 0), 0) - 1, key: `${first.key}c` };
    const at = this.waiting.indexOf(first);
    this.waiting = this.waiting.filter((w) => w.kind !== kind);
    this.waiting.splice(Math.min(at, this.waiting.length), 0, crowd);
  }

  /** Too many waiting: the least important, oldest one goes. Gifts outrank follows and shares. */
  trim() {
    while (this.waiting.length > this.config.maxWaiting) {
      let worst = 0;
      for (let i = 1; i < this.waiting.length; i++) if (PRIORITY(this.waiting[i]) < PRIORITY(this.waiting[worst])) worst = i;
      this.waiting.splice(worst, 1);
      this.dropped += 1;
    }
  }

  show(item) {
    const entry = { item, timer: 0 };
    this.active.set(item.key, entry);
    this.onShow(item);
    entry.timer = this.timers.setTimeout(() => this.hide(item.key), item.time);
    return item;
  }

  hide(key) {
    const entry = this.active.get(key);
    if (!entry) return;
    this.timers.clearTimeout(entry.timer);
    this.active.delete(key);
    this.onHide(entry.item);
    this.gap += 1;
    // The place is free again once the exit has played.
    this.timers.setTimeout(() => { this.gap -= 1; this.pump(); }, Math.max(80, this.config.speed * 0.6));
  }

  /** Shows waiting alerts while there is room: the most important first, and in arrival order among equals. */
  pump() {
    while (this.waiting.length && this.active.size + this.gap < this.config.maxShown) {
      let best = 0;
      for (let i = 1; i < this.waiting.length; i++) if (PRIORITY(this.waiting[i]) > PRIORITY(this.waiting[best])) best = i;
      this.show(this.waiting.splice(best, 1)[0]);
    }
  }

  /** Takes everything off the screen and out of the line at once. */
  clear() {
    for (const [key, entry] of [...this.active]) {
      this.timers.clearTimeout(entry.timer);
      this.active.delete(key);
      this.onHide(entry.item);
    }
    this.waiting = [];
  }
}
