// Top Likers: the settings, and the board that adds up each person's likes. Likes come from the relay as one line per person per second
// ({ kind: "like", user, name, avatar, count }); the board adds them up and ranks people by their total. It can only count what it saw,
// so it starts when the overlay connects. No page and no clock, so it is tested on its own.

import { defineWidget, number, range, text, toggle } from "./widget-settings.js";

export const LIKERS = defineWidget({
  defaults: { max: 10, title: true, titleText: "Top likers", showCounts: true, avatar: true, medals: true, minLikes: 1, keep: false },
  controls: [
    { section: "list", ...range("max", "People shown", 3, 10, 1, "") },
    { section: "list", ...toggle("title", "Show a title above the list") },
    { section: "list", ...text("titleText", "Title", 40) },
    { section: "list", ...toggle("showCounts", "Show the number of likes") },
    { section: "list", ...toggle("avatar", "Show the person's picture") },
    { section: "list", ...toggle("medals", "Gold, silver and bronze for the top 3") },
    { section: "list", ...number("minLikes", "Likes needed to be listed", 1, 1000000) },
    { section: "list", ...toggle("keep", "Remember the likes if the page reloads", "Kept only in this browser or streaming app. Off starts again each time the page loads.") },
  ],
});

const CAP = 5000; // people held at most; past that the ones with the fewest likes go
const SAVED = 100; // people kept when remembering

/** The ranking. `onChange(top)` is told the listed people, best first, after each change. */
export class LikeBoard {
  constructor(settings, { onChange, entries = [] } = {}) {
    this.settings = settings;
    this.onChange = onChange ?? (() => {});
    this.people = new Map(); // user -> { user, name, avatar, count, order }
    this.order = 0; // who reached a count first wins a tie
    for (const e of entries) this.people.set(e.user, { user: e.user, name: e.name, avatar: e.avatar ?? "", count: e.count, order: this.order++ });
  }

  setSettings(settings) {
    this.settings = settings;
    this.onChange(this.top);
  }

  /** The listed people, best first: most likes, and among equals the one who got there first. */
  get top() {
    return [...this.people.values()]
      .filter((p) => p.count >= this.settings.minLikes)
      .sort((a, b) => b.count - a.count || a.order - b.order)
      .slice(0, this.settings.max)
      .map((p, i) => ({ key: p.user, name: p.name, avatar: p.avatar, count: p.count, rank: i + 1 }));
  }

  /** A line from the relay. Returns false for anything that is not a like. */
  add(event) {
    if (!event || event.kind !== "like" || !event.user || !(event.count > 0)) return false;
    const held = this.people.get(event.user);
    if (held) {
      held.count += event.count;
      held.name = event.name || held.name;
      if (event.avatar) held.avatar = event.avatar;
      held.order = this.order++; // the latest to add likes is the later to arrive at that count
    } else {
      this.people.set(event.user, { user: event.user, name: event.name, avatar: event.avatar ?? "", count: event.count, order: this.order++ });
    }
    if (this.people.size > CAP) this.prune();
    this.onChange(this.top);
    return true;
  }

  /** Too many people: keep the better half. */
  prune() {
    const keep = [...this.people.values()].sort((a, b) => b.count - a.count || a.order - b.order).slice(0, Math.floor(CAP / 2));
    this.people = new Map(keep.map((p) => [p.user, p]));
  }

  clear() {
    this.people.clear();
    this.onChange(this.top);
  }

  /** What is worth remembering. */
  get entries() {
    return [...this.people.values()].sort((a, b) => b.count - a.count).slice(0, SAVED).map(({ user, name, avatar, count }) => ({ user, name, avatar, count }));
  }
}

export const likersKey = (channel) => `frills:likers:${channel}`;
export function loadLikers(storage, channel) {
  try {
    const saved = JSON.parse(storage.getItem(likersKey(channel)) ?? "null");
    if (!Array.isArray(saved)) return [];
    return saved.filter((e) => e && typeof e.user === "string" && typeof e.name === "string" && Number.isFinite(e.count) && e.count > 0).slice(0, SAVED);
  } catch {
    return [];
  }
}
export function saveLikers(storage, channel, board) {
  try { storage.setItem(likersKey(channel), JSON.stringify(board.entries)); } catch { /* storage can be blocked */ }
}
