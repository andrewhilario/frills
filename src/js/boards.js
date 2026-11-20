// Top Gifters and Likers, rotating: the settings, and the two rankings that take turns. Gifts come from the relay as one alert per gift ({ kind: "gift", user,
// name, avatar, total } where `total` is the diamonds it was worth); likes come as one line per person per second ({ kind: "like", user, name, avatar, count }).
// Each ranking adds up what it sees and puts people in order, exactly as the Top Likers board does (it is the same board: a gift is just a "like" worth
// `total`). This file only decides which ranking is showing, and when to move to the next. No page and no clock of its own (the page calls `next()` on a
// timer), so it is tested on its own.

import { defineWidget, chipsOf, number, range, text, toggle } from "./widget-settings.js";
import { LikeBoard } from "./likers.js";

export const BOARD_KINDS = ["gifters", "likers"];

export const BOARDS = defineWidget({
  defaults: { gifters: true, likers: true, seconds: 12, max: 5, titleGifters: "Top gifters", titleLikers: "Top likers", title: true, showCounts: true, avatar: true, medals: true, keep: false, swap: "fade" },
  controls: [
    { section: "list", ...toggle("gifters", "Show the top gifters", "Ranked by the diamonds each person sent.") },
    { section: "list", ...toggle("likers", "Show the top likers", "Ranked by the likes each person tapped. Turn one of the two off to show only the other, with no rotating.") },
    { section: "list", ...range("seconds", "Seconds each ranking stays", 5, 60, 1, " s") },
    { section: "list", ...chipsOf("swap", "How one ranking gives way to the next", [["fade", "Fade"], ["slide", "Slide"]]) },
    { section: "list", ...range("max", "People shown", 3, 10, 1, "") },
    { section: "list", ...toggle("title", "Show a title above the list") },
    { section: "list", ...text("titleGifters", "Title for the gifters", 40) },
    { section: "list", ...text("titleLikers", "Title for the likers", 40) },
    { section: "list", ...toggle("showCounts", "Show the numbers", "Diamonds for the gifters, likes for the likers.") },
    { section: "list", ...toggle("avatar", "Show the person's picture") },
    { section: "list", ...toggle("medals", "Gold, silver and bronze for the top 3") },
    { section: "list", ...toggle("keep", "Remember the rankings if the page reloads", "Kept only in this browser or streaming app. Off starts again each time the page loads.") },
  ],
});

/**
 * The settings with at least one ranking on (a link that turns both off would show nothing: it shows the gifters). Used wherever the settings are read,
 * so a hand-edited link cannot leave the overlay empty.
 */
export function boardsOn(settings) {
  const on = BOARD_KINDS.filter((kind) => settings[kind]);
  return on.length ? on : ["gifters"];
}

/** The smallest of the numbers a gift can carry that still counts: a gift is worth at least one diamond, and a free one is not a gift for a ranking. */
const worth = (event) => Math.max(0, Math.round(Number(event.total) || 0));

/**
 * The two rankings and which one is showing. `onChange(view)` is told { kind, title, top } (the ranking now on show, best first) after each change to
 * it and each time it moves on. `next()` moves to the next ranking that has somebody on it (every ranking empty: just the next one, so the title still
 * changes). `entries` ({ gifters: [...], likers: [...] }) starts the rankings from what was remembered.
 */
export class Boards {
  constructor(settings, { onChange, entries = {} } = {}) {
    this.settings = settings;
    this.onChange = onChange ?? (() => {});
    // A ranking is a LikeBoard: its own settings say how many to list, and never to celebrate (that is the Top Likers overlay's job).
    this.boards = Object.fromEntries(BOARD_KINDS.map((kind) => [kind, new LikeBoard(this.inner(settings), { entries: entries[kind] ?? [], onChange: () => this.changed(kind) })]));
    this.current = boardsOn(settings)[0];
  }

  inner(settings) {
    return { max: settings.max, minLikes: 1, celebrate: false, milestone: 1000, celebrateWho: "top" };
  }

  setSettings(settings) {
    this.settings = settings;
    for (const board of Object.values(this.boards)) board.settings = this.inner(settings);
    if (!boardsOn(settings).includes(this.current)) this.current = boardsOn(settings)[0];
    this.onChange(this.view);
  }

  /** What is on show now: the ranking, its title and its people. */
  get view() {
    const kind = this.current;
    return { kind, title: kind === "gifters" ? this.settings.titleGifters : this.settings.titleLikers, top: this.boards[kind].top, only: boardsOn(this.settings).length === 1 };
  }

  changed(kind) {
    if (kind === this.current) this.onChange(this.view);
  }

  /** A line from the relay. A gift goes to the gifters, a like to the likers; anything else is not counted (and false is returned). */
  add(event) {
    if (!event) return false;
    if (event.kind === "gift") {
      const diamonds = worth(event);
      if (!event.user || diamonds <= 0) return false;
      return this.boards.gifters.add({ kind: "like", user: event.user, name: event.name, avatar: event.avatar, count: diamonds });
    }
    if (event.kind === "like") return this.boards.likers.add(event);
    return false;
  }

  /**
   * Moves to the next ranking, among the ones turned on. One that has nobody yet is passed over while another has somebody: a stream that has had likes
   * but no gifts does not spend half its time on an empty list.
   */
  next() {
    const on = boardsOn(this.settings);
    const at = on.indexOf(this.current);
    const order = [...on.slice(at + 1), ...on.slice(0, at + 1)]; // after this one, round to this one last
    const target = order.find((kind) => this.boards[kind].top.length > 0) ?? order[0];
    this.current = target;
    this.onChange(this.view);
    return this.current;
  }

  clear() {
    for (const board of Object.values(this.boards)) board.clear(); // (each one tells us; only the one on show is passed on)
  }

  /** What is worth remembering. */
  get entries() {
    return { gifters: this.boards.gifters.entries, likers: this.boards.likers.entries };
  }
}

export const boardsKey = (channel) => `frills:boards:${channel}`;
const SAVED_KIND = (list) => (Array.isArray(list) ? list.filter((e) => e && typeof e.user === "string" && typeof e.name === "string" && Number.isFinite(e.count) && e.count > 0).slice(0, 100) : []);
export function loadBoards(storage, channel) {
  try {
    const saved = JSON.parse(storage.getItem(boardsKey(channel)) ?? "null");
    return { gifters: SAVED_KIND(saved?.gifters), likers: SAVED_KIND(saved?.likers) };
  } catch {
    return { gifters: [], likers: [] };
  }
}
export function saveBoards(storage, channel, boards) {
  try { storage.setItem(boardsKey(channel), JSON.stringify(boards.entries)); } catch { /* storage can be blocked */ }
}
