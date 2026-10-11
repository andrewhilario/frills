// Last Gifts: the settings, and the list that keeps the most recent gifts. A gift is one alert event from the relay ({ kind: "gift", name,
// gift, count, diamonds, total, picture, avatar }). No page and no clock of its own, so it is tested with a pretend clock.

import { defineWidget, chipsOf, number, range, selectOf, text, toggle } from "./widget-settings.js";

export const GIFTS = defineWidget({
  defaults: { max: 10, order: "bottom", life: 0, minDiamonds: 0, template: "{name} sent {gift} ×{count}", showDiamonds: false, showPicture: true, avatar: true, title: false, titleText: "Last gifts", enter: "slide" },
  controls: [
    { section: "list", ...range("max", "Gifts shown", 1, 20, 1, "") },
    { section: "list", ...chipsOf("order", "Where new gifts go", [["bottom", "At the bottom"], ["top", "At the top"]]) },
    { section: "list", ...range("life", "Seconds each stays", 0, 300, 5, " s", { zero: "stays", hint: "“Stays” keeps it until newer gifts push it out." }) },
    { section: "list", ...number("minDiamonds", "Smallest gift to show (diamonds)", 0, 100000, { hint: "0 shows every gift." }) },
    { section: "list", ...text("template", "Words", 80, "Use {name}, {gift}, {count}, {diamonds} and {total}.") },
    { section: "list", ...toggle("showPicture", "Show the gift's picture") },
    { section: "list", ...toggle("showDiamonds", "Show the value in diamonds") },
    { section: "list", ...toggle("avatar", "Show the person's picture") },
    { section: "list", ...toggle("title", "Show a title above the list") },
    { section: "list", ...text("titleText", "Title", 40) },
    { section: "list", ...selectOf("enter", "How new gifts arrive", [["slide", "Slide in"], ["pop", "Pop"], ["fade", "Fade"]]) },
  ],
});

let serial = 0;

/**
 * Keeps the last `max` gifts. `onChange(items)` is told the whole list (oldest first) whenever it changes, and `onGone(item)` when one
 * leaves (for an exit animation). `timers` is setTimeout and clearTimeout (a pretend pair in tests).
 */
export class GiftList {
  constructor(settings, { onChange, onGone, timers = globalThis } = {}) {
    this.settings = settings;
    this.onChange = onChange ?? (() => {});
    this.onGone = onGone ?? (() => {});
    this.timers = timers;
    this.items = []; // oldest first
    this.timer = new Map();
  }

  setSettings(settings) {
    this.settings = settings;
    this.trim();
    this.onChange(this.items);
  }

  /** A gift from the relay. Returns the item that was added, or null when it is smaller than the smallest wanted. */
  add(event) {
    if (!event || event.kind !== "gift") return null;
    const diamonds = event.diamonds ?? 0;
    if (diamonds < this.settings.minDiamonds) return null;
    const item = { key: `g${++serial}`, name: event.name, avatar: event.avatar ?? "", gift: event.gift, picture: event.picture ?? "", count: event.count ?? 1, diamonds, total: event.total ?? diamonds * (event.count ?? 1) };
    this.items.push(item);
    if (this.settings.life > 0) this.timer.set(item.key, this.timers.setTimeout(() => this.remove(item.key), this.settings.life * 1000));
    this.trim();
    this.onChange(this.items);
    return item;
  }

  remove(key) {
    const at = this.items.findIndex((i) => i.key === key);
    if (at === -1) return;
    const [item] = this.items.splice(at, 1);
    this.timers.clearTimeout(this.timer.get(key));
    this.timer.delete(key);
    this.onGone(item);
    this.onChange(this.items);
  }

  /** Too many: the oldest leave. */
  trim() {
    while (this.items.length > this.settings.max) {
      const [item] = this.items.splice(0, 1);
      this.timers.clearTimeout(this.timer.get(item.key));
      this.timer.delete(item.key);
      this.onGone(item);
    }
  }

  clear() {
    for (const item of [...this.items]) this.remove(item.key);
  }
}
