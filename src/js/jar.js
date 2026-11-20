// Gift Jar (TikTok LIVE only): settings, diamond/count accumulation, gift token stacking, full-jar milestone modes,
// and localStorage persistence. Pure module so logic and bounds are verified directly without a DOM.

import { defineWidget, chipsOf, number, range, selectOf, text, toggle } from "./widget-settings.js";
import { SOUNDS } from "./alerts-settings.js";

/** Maximum visual gift tokens held inside the jar chamber at once so DOM size stays bounded on busy streams. */
export const MAX_JAR_ITEMS = 42;

export const JAR_DESIGNS = [
  ["boba", "Boba cup: domed lid & straw"],
  ["cat", "Cat jar: kitty-eared glass jar"],
  ["potion", "Potion flask: crystal bottle & cork"],
  ["frog", "Frog pond: cute round terrarium"],
  ["arcade", "Arcade tank: glowing cyber neon glass"],
  ["piggy", "Piggy jar: cute coin-slot bank"],
];

export const JAR_MODES = [
  ["diamonds", "Total diamonds"],
  ["count", "Number of gifts"],
];

export const JAR_FULL_MODES = [
  ["stay", "Stay full until cleared"],
  ["empty", "Celebrate & start a new jar"],
  ["raise", "Celebrate & raise target"],
];

export const JAR = defineWidget({
  defaults: {
    design: "boba",
    goalBy: "diamonds",
    target: 1000,
    whenFull: "stay",
    step: 500,
    title: true,
    titleText: "Gift jar",
    showNumbers: true,
    capNumbers: true,
    showPercent: false,
    showLiquid: true,
    showDrops: true,
    showThanks: true,
    celebrate: true,
    celebrateText: "Jar full! Thank you!",
    celebrateTime: 6,
    celebrateSound: "fanfare",
    keep: false,
  },
  controls: [
    { section: "jar", ...selectOf("design", "Jar design", JAR_DESIGNS) },
    { section: "jar", ...chipsOf("goalBy", "What fills the jar", JAR_MODES) },
    { section: "jar", ...number("target", "Full at", 1, 10000000, { hint: "Diamonds or number of gifts needed to fill the jar to the brim." }) },
    { section: "jar", ...chipsOf("whenFull", "When the jar gets full", JAR_FULL_MODES) },
    { section: "jar", ...number("step", "Raise target by (when raising)", 10, 1000000) },
    { section: "jar", ...toggle("title", "Show a label above the jar") },
    { section: "jar", ...text("titleText", "Label", 36) },
    { section: "jar", ...toggle("showNumbers", "Show goal text below jar (0 / 1,000 gifts)", "Turn off to hide the diamond or gift count underneath the jar.") },
    { section: "jar", ...toggle("capNumbers", "Cap count at full target (1,000 / 1,000)", "Keep the displayed count at 1,000 / 1,000 when overflowing; turn off to count past the brim.") },
    { section: "jar", ...toggle("showPercent", "Show percent filled") },
    { section: "jar", ...toggle("showLiquid", "Show rising glow fill inside the jar") },
    { section: "jar", ...toggle("showDrops", "Keep gift icons piled inside the jar") },
    { section: "jar", ...toggle("showThanks", "Show who dropped the last gift") },
    { section: "jar", ...toggle("celebrate", "Celebrate when the jar becomes full") },
    { section: "jar", ...text("celebrateText", "Full jar message", 48) },
    { section: "jar", ...range("celebrateTime", "Seconds on screen", 3, 15, 1, " s") },
    { section: "jar", ...selectOf("celebrateSound", "Sound", SOUNDS.map(({ id, name }) => [id, name])) },
    { section: "jar", ...toggle("keep", "Remember jar progress if the page reloads", "Kept only in this browser or streaming app. Off starts fresh each time the page loads.") },
  ],
});

let tokenSeq = 0;

/** Computes the normalized progress delta for one incoming TikTok gift or Twitch bits/sub/subgift event under `goalBy`. */
export function jarAmount(goalBy, event) {
  if (!event) return 0;
  if (event.kind === "gift") {
    if (goalBy === "count") {
      const n = Math.round(Number(event.count) || 1);
      return Number.isFinite(n) && n > 0 ? n : 1;
    }
    const diamonds = Number(event.total) || ((Number(event.diamonds) || 0) * (Number(event.count) || 1));
    const n = Math.round(diamonds);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  if (event.kind === "bits") {
    const bits = Math.round(Number(event.count) || 0);
    if (!(bits > 0)) return 0;
    return goalBy === "count" ? 1 : bits;
  }
  if (event.kind === "sub") {
    return goalBy === "count" ? 1 : 500;
  }
  if (event.kind === "subgift") {
    const subs = Math.max(1, Math.round(Number(event.count) || 1));
    return goalBy === "count" ? subs : subs * 500;
  }
  return 0;
}

/**
 * Tracks accumulated TikTok gifts, jar capacity/target, full-jar completion, and piled visual gift items.
 * Emits `onDrop(item)` for each newly dropped gift, `onChange(snapshot)` after state updates, and `onFull(snapshot)`
 * once when the jar transitions from under-target to full.
 */
export class GiftJar {
  constructor(settings, { total = 0, target, jarsCompleted = 0, items = [], onChange, onDrop, onFull } = {}) {
    this.settings = settings;
    this.total = Math.max(0, Math.round(Number(total) || 0));
    this.target = Math.max(1, Math.round(Number(target ?? settings.target) || 1));
    this.seenTarget = Math.max(1, Math.round(Number(settings.target) || 1));
    this.jarsCompleted = Math.max(0, Math.round(Number(jarsCompleted) || 0));
    this.items = Array.isArray(items) ? items.slice(-MAX_JAR_ITEMS).map((it) => ({ ...it })) : [];
    this.wasFull = this.total >= this.target;
    this.lastGift = null;
    this.onChange = onChange ?? (() => {});
    this.onDrop = onDrop ?? (() => {});
    this.onFull = onFull ?? (() => {});
  }

  get percent() {
    return Math.min(100, Math.floor((this.total / this.target) * 100));
  }

  get full() {
    return this.total >= this.target;
  }

  get snapshot() {
    return {
      total: this.total,
      target: this.target,
      percent: this.percent,
      full: this.full,
      jarsCompleted: this.jarsCompleted,
      goalBy: this.settings.goalBy || "diamonds",
      items: this.items,
      lastGift: this.lastGift,
    };
  }

  setSettings(next) {
    this.settings = next;
    const nextTarget = Math.max(1, Math.round(Number(next.target) || 1));
    if (nextTarget !== this.seenTarget) {
      this.seenTarget = nextTarget;
      this.target = nextTarget;
    }
    this.wasFull = this.full;
    this.onChange(this.snapshot);
  }

  /** Accepts a single TikTok `gift` event; ignores non-gift events and invalid positive amounts. */
  add(event) {
    const amount = jarAmount(this.settings.goalBy, event);
    if (!(amount > 0)) return false;

    const prevFull = this.wasFull;
    this.total += amount;

    const giftLabel = event.kind === "bits"
      ? `${Math.max(1, Math.round(Number(event.count) || 100))} Bits`
      : event.kind === "subgift"
        ? "Gifted Sub"
        : event.kind === "sub"
          ? "Twitch Sub"
          : String(event.gift || "Gift");
    const item = {
      uid: `jar-${++tokenSeq}`,
      name: String(event.name || "Viewer"),
      gift: giftLabel,
      picture: String(event.picture || ""),
      diamonds: Math.max(0, Math.round(Number(event.diamonds ?? (event.kind === "bits" ? event.count : event.kind === "sub" || event.kind === "subgift" ? 500 : 0)) || 0)),
      count: Math.max(1, Math.round(Number(event.count) || 1)),
      amount,
      slot: this.items.length,
    };

    // Keep the pile visually bounded without resetting earlier gifts' positions while below cap.
    if (this.items.length >= MAX_JAR_ITEMS) {
      this.items.shift();
      this.items.forEach((entry, i) => { entry.slot = i; });
    }
    item.slot = this.items.length;
    this.items.push(item);
    this.lastGift = item;

    this.onDrop(item);
    this.onChange(this.snapshot);

    if (!prevFull && this.full) {
      this.wasFull = true;
      this.jarsCompleted += 1;
      this.onFull(this.snapshot);
    }
    return true;
  }

  /** Completes a full-jar cycle after any celebration finishes (`empty` resets cleanly; `raise` lifts target). */
  finishFullCycle(expectedCycle) {
    if (expectedCycle !== undefined && this.jarsCompleted !== expectedCycle) return;
    if (!this.full) return;
    const mode = this.settings.whenFull || "stay";
    if (mode === "raise") {
      const step = Math.max(10, Math.round(Number(this.settings.step) || 500));
      this.target += step;
      this.wasFull = this.full;
      this.onChange(this.snapshot);
      return;
    }
    if (mode === "empty") {
      this.total = Math.max(0, this.total - this.target);
      this.items = [];
      this.wasFull = this.full;
      this.onChange(this.snapshot);
    }
  }

  clear() {
    this.total = 0;
    this.target = Math.max(1, Math.round(Number(this.settings.target) || 1));
    this.items = [];
    this.lastGift = null;
    this.wasFull = false;
    this.onChange(this.snapshot);
  }
}

export const jarKey = (channel) => `frills:jar:${channel}`;

export function loadJar(storage, channel) {
  try {
    const raw = JSON.parse(storage?.getItem(jarKey(channel)) ?? "null");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const total = Number(raw.total);
    const target = Number(raw.target);
    if (!Number.isFinite(total) || total < 0 || !Number.isFinite(target) || target < 1) return null;
    const items = Array.isArray(raw.items)
      ? raw.items
        .filter((it) => it && typeof it.gift === "string" && Number.isFinite(Number(it.amount)) && Number(it.amount) > 0)
        .slice(-MAX_JAR_ITEMS)
        .map((it, i) => ({
          uid: `restored-${++tokenSeq}`,
          name: String(it.name || "Viewer").slice(0, 40),
          gift: String(it.gift).slice(0, 40),
          picture: typeof it.picture === "string" ? it.picture : "",
          diamonds: Math.max(0, Math.round(Number(it.diamonds) || 0)),
          count: Math.max(1, Math.round(Number(it.count) || 1)),
          amount: Math.round(Number(it.amount)),
          slot: i,
        }))
      : [];
    return {
      total: Math.round(total),
      target: Math.round(target),
      jarsCompleted: Math.max(0, Math.round(Number(raw.jarsCompleted) || 0)),
      items,
    };
  } catch {
    return null;
  }
}

export function saveJar(storage, channel, jar) {
  try {
    storage?.setItem(
      jarKey(channel),
      JSON.stringify({
        total: jar.total,
        target: jar.target,
        jarsCompleted: jar.jarsCompleted,
        items: jar.items.slice(-MAX_JAR_ITEMS).map(({ name, gift, picture, diamonds, count, amount }) => ({
          name,
          gift,
          picture: picture.startsWith("https://") || picture.startsWith("data:image/svg+xml;base64,") ? picture : "",
          diamonds,
          count,
          amount,
        })),
      }),
    );
  } catch {
    /* ignore quota / private mode failures */
  }
}
