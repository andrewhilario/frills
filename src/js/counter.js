// The Live Counter: how many are watching and how many likes the LIVE has. The settings, and the numbers. The viewer count comes from the relay's
// "info" (how many are watching, said every few seconds) and the likes from the like events (each carries the LIVE's running total). No page and
// no clock of its own, so it is tested without a browser.

import { defineWidget, chipsOf, text, toggle } from "./widget-settings.js";

export const COUNTER = defineWidget({
  defaults: { showViewers: true, showLikes: true, viewersLabel: "watching", likesLabel: "likes", layout: "row", short: false, icons: true, bump: true },
  controls: [
    { section: "show", ...toggle("showViewers", "Show how many are watching") },
    { section: "show", ...toggle("showLikes", "Show the likes") },
    { section: "show", ...chipsOf("layout", "Layout", [["row", "Side by side"], ["stack", "One under the other"], ["pill", "One small pill"]]) },
    { section: "show", ...toggle("icons", "Show the little pictures (an eye and a heart)") },
    { section: "words", ...text("viewersLabel", "Words next to the viewers", 24, "For example “watching” or “in the pond”.") },
    { section: "words", ...text("likesLabel", "Words next to the likes", 24, "For example “likes” or “hearts”.") },
    { section: "words", ...toggle("short", "Write big numbers short (12.3K, not 12,345)") },
    { section: "words", ...toggle("bump", "A little bump when a number goes up") },
  ],
});

/** A count written for the overlay: 12,345, or 12.3K / 1.2M when `short`. Anything that is not a number is 0. */
export function formatCount(value, short = false) {
  const n = Math.max(0, Math.round(Number(value) || 0));
  if (!short || n < 1000) return n.toLocaleString("en-US");
  const unit = n >= 999500 ? [1e6, "M"] : [1e3, "K"]; // (999,600 is nearly a million: 1M, not 1000K)
  const scaled = Math.max(1, n / unit[0]);
  const text = (scaled >= 100 ? Math.round(scaled) : Math.floor(scaled * 10) / 10).toString();
  return `${text}${unit[1]}`;
}

/**
 * Keeps the two numbers. `onChange({ viewers, likes })` is told after every change (each is null until it is known: the relay says how many are watching, and the first like event gives the likes).
 * Likes only go up while the LIVE goes on: a like event carries the LIVE's total, and the highest total seen is the one kept, so an event that
 * arrives late can never make the number go down. An event with no total adds its own count instead.
 */
export class LiveCounter {
  constructor(settings, { onChange } = {}) {
    this.settings = settings;
    this.onChange = onChange ?? (() => {});
    this.viewers = null;
    this.likes = null; // like the viewers: unknown until the first like event, so a counter opened in the middle of a LIVE shows nothing instead of a wrong 0
  }

  get state() {
    return { viewers: this.viewers, likes: this.likes };
  }

  setSettings(settings) {
    this.settings = settings;
    this.onChange(this.state);
  }

  /** How many are watching, from the relay's info. Anything that is not a whole number of 0 or more is ignored. */
  setViewers(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 0 || n >= 1e9 || n === this.viewers) return;
    this.viewers = n;
    this.onChange(this.state);
  }

  /** A like event from the relay ({ kind: "like", count, total }). */
  addLike(event) {
    if (!event || event.kind !== "like") return;
    const total = Math.round(Number(event.total)) || 0;
    const count = Math.max(0, Math.round(Number(event.count)) || 0);
    const had = this.likes ?? 0;
    const next = total > 0 ? Math.max(had, total) : had + count;
    if (next === this.likes) return;
    this.likes = Math.min(next, 1e10);
    this.onChange(this.state);
  }

  clear() {
    this.viewers = null;
    this.likes = null;
    this.onChange(this.state);
  }
}
