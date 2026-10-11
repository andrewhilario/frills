// Song requests: the settings, the chat commands, and the queue. A viewer types "!sr song name" in the LIVE chat; the song is looked up in a
// free catalog (for the proper title, artist and cover), and the queue shows what was asked for. Frills plays no music: the streamer plays
// each song wherever they like, and "!next" (from the streamer's own account, or a moderator) moves the queue on. No page and no clock of
// its own (the lookup and the time are given to it), so it is tested on its own.

import { defineWidget, number, range, selectOf, text, toggle } from "./widget-settings.js";

export const SONG_LAYOUTS = [["card", "Card"], ["strip", "Strip: one slim line"], ["stack", "Stack: big cover on top"], ["disc", "Disc: a spinning record"]];
export const SONG_SHOWS = [["both", "The song playing and the queue"], ["now", "Only the song playing"], ["queue", "Only the queue"]];

export const SONGS = defineWidget({
  defaults: {
    show: "both", layout: "card", command: "sr", max: 5, limit: 20, perUser: 2, modsSkip: true, onlyFound: false, autoNext: false,
    title: true, titleText: "Song requests", showNow: true, nowText: "Now playing", cover: true, requester: true, keep: false,
  },
  controls: [
    { section: "layout", ...selectOf("show", "What this overlay shows", SONG_SHOWS, "Add one overlay for the song playing and another for the queue if you want them in different places.") },
    { section: "layout", ...selectOf("layout", "How the song playing looks", SONG_LAYOUTS) },
    { section: "rules", ...text("command", "The word viewers type after !", 16, "Viewers type !sr song name. Letters and numbers only. !songrequest always works too.") },
    { section: "rules", ...number("limit", "Most requests waiting", 3, 50) },
    { section: "rules", ...number("perUser", "Most per person waiting", 1, 5) },
    { section: "rules", ...toggle("modsSkip", "Moderators can use !next too", "You can always use !next from your own TikTok account. Needs the relay to be up to date.") },
    { section: "rules", ...toggle("onlyFound", "Skip songs the catalog cannot find", "Off keeps the request as it was typed, so you can decide.") },
    { section: "rules", ...toggle("autoNext", "Move on by itself when the song ends", "Uses the song's length from the catalog. Off waits for !next (or the button in the editor).") },
    { section: "list", ...range("max", "Songs shown", 2, 8, 1, "") },
    { section: "list", ...toggle("title", "Show a title above the list") },
    { section: "list", ...text("titleText", "Title", 40) },
    { section: "list", ...toggle("showNow", "Make the first song stand out") },
    { section: "list", ...text("nowText", "Words above the first song", 30) },
    { section: "list", ...toggle("cover", "Show the album cover") },
    { section: "list", ...toggle("requester", "Show who asked") },
    { section: "list", ...toggle("keep", "Remember the queue if the page reloads", "Kept only in this browser or streaming app. Off starts again each time the page loads.") },
  ],
});

/** The word after "!": letters and numbers, lower case, "sr" when there is nothing usable. */
export const commandWord = (settings) => String(settings.command ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) || "sr";

const clean = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** What a chat line means: { kind: "request", query } | { kind: "next" } | { kind: "remove" } | null. */
export function parseCommand(line, settings) {
  const m = /^\s*[!！]\s*([a-z0-9]+)\s*(.*)$/is.exec(String(line ?? ""));
  if (!m) return null;
  const word = m[1].toLowerCase();
  const rest = clean(m[2], 120);
  if (word === commandWord(settings) || word === "songrequest") {
    const query = clean(rest.replace(/^[-:,]\s*/, ""), 80);
    return query.length >= 2 ? { kind: "request", query } : null;
  }
  if (word === "next" || word === "skip") return { kind: "next" };
  if (word === "wrongsong" || word === "removesong") return { kind: "remove" };
  return null;
}

/** The same song asked for in different ways looks the same: no case, no punctuation, one space. */
const same = (text) => String(text ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9À-￿]+/g, " ").trim();

const CAP_TEXT = 200;

/**
 * The queue. `lookup(query)` (async) returns { id, title, artist, cover, seconds, link } or null; `now()` is the time in ms. `onChange(view)`
 * gets { now, next, total } after every change: `now` is the first request (what is being played), `next` the ones after it.
 */
export class SongQueue {
  constructor(settings, { lookup, now = () => Date.now(), onChange, entries = [] } = {}) {
    this.settings = settings;
    this.lookup = lookup ?? (async () => null);
    this.clock = now;
    this.onChange = onChange ?? (() => {});
    this.items = [];
    this.heard = new Set(); // message ids already handled, so a repeated delivery never asks twice
    this.counter = 0;
    this.startedAt = 0;
    for (const e of entries) this.items.push({ ...e, state: e.state === "searching" ? "ready" : e.state, key: `q${++this.counter}` });
    if (this.items.length) this.startedAt = this.clock();
  }

  setSettings(settings) {
    this.settings = settings;
    this.trim();
    this.onChange(this.view);
  }

  get view() {
    const { max } = this.settings;
    return { now: this.items[0] ?? null, next: this.items.slice(1, max), total: this.items.length };
  }

  /** Waiting items grow past a smaller limit when the person lowers it: the newest go. */
  trim() {
    if (this.items.length > this.settings.limit) this.items.length = this.settings.limit;
  }

  /**
   * One chat message ({ id, user, name, text, avatar, mod, host, login }). `channel` is the streamer's TikTok name.
   * Returns what it meant: "request", "next", "remove", or "ignored" (with a `why` for the editor's sake and the tests).
   */
  handle(message, channel = "") {
    if (!message || !message.text) return { kind: "ignored", why: "empty" };
    const command = parseCommand(message.text, this.settings);
    if (!command) return { kind: "ignored", why: "not a command" };
    if (message.id) {
      if (this.heard.has(message.id)) return { kind: "ignored", why: "repeat" };
      this.heard.add(message.id);
      if (this.heard.size > 500) this.heard.delete(this.heard.values().next().value);
    }
    const streamer = message.host === true || (channel && String(message.login ?? "").toLowerCase() === String(channel).toLowerCase());
    if (command.kind === "next") {
      if (!(streamer || (this.settings.modsSkip && message.mod === true))) return { kind: "ignored", why: "not allowed" };
      return this.next() ? { kind: "next" } : { kind: "ignored", why: "nothing playing" };
    }
    if (command.kind === "remove") {
      for (let i = this.items.length - 1; i >= 0; i--) {
        if (this.items[i].user === message.user) { this.remove(this.items[i].key); return { kind: "remove" }; }
      }
      return { kind: "ignored", why: "nothing of theirs" };
    }
    return this.request({ user: message.user, name: message.name, avatar: message.avatar, query: command.query });
  }

  /** A request, from chat or from the editor's test button. */
  request({ user, name, avatar = "", query, via }) {
    const wanted = same(query);
    if (!wanted) return { kind: "ignored", why: "empty" };
    if (this.items.length >= this.settings.limit) return { kind: "ignored", why: "queue full" };
    const mine = this.items.filter((i) => i.user === user).length;
    if (user && mine >= this.settings.perUser) return { kind: "ignored", why: "too many from this person" };
    if (this.items.some((i) => same(i.query) === wanted)) return { kind: "ignored", why: "already in the queue" };
    const item = { key: `q${++this.counter}`, user, name: clean(name, 40) || "viewer", avatar, query: clean(query, 80), title: clean(query, CAP_TEXT), artist: "", cover: "", seconds: 0, link: "", trackId: "", state: "searching" };
    if (via) Object.defineProperty(item, "via", { value: via, enumerable: false }); // a practice request asks the practice catalog
    this.items.push(item);
    if (this.items.length === 1) this.startedAt = this.clock();
    this.onChange(this.view);
    this.resolve(item);
    return { kind: "request", key: item.key };
  }

  async resolve(item) {
    let track = null;
    try { track = await (item.via ?? this.lookup)(item.query); } catch { track = null; }
    if (!this.items.includes(item)) return; // it was skipped or removed while the catalog answered
    if (track?.title) {
      if (track.id && this.items.some((i) => i !== item && i.trackId === String(track.id))) {
        this.items.splice(this.items.indexOf(item), 1); // the same song under another spelling
      } else {
        Object.assign(item, { title: clean(track.title, CAP_TEXT), artist: clean(track.artist, 100), cover: String(track.cover ?? ""), seconds: Math.max(0, Math.round(Number(track.seconds) || 0)), link: String(track.link ?? ""), trackId: String(track.id ?? ""), state: "ready" });
      }
    } else if (this.settings.onlyFound) {
      this.items.splice(this.items.indexOf(item), 1);
    } else {
      item.state = "missing";
    }
    this.onChange(this.view);
  }

  /** The song that was playing is done: the next one is up. Returns false when the queue was empty. */
  next() {
    if (!this.items.length) return false;
    this.items.shift();
    this.startedAt = this.clock();
    this.onChange(this.view);
    return true;
  }

  remove(key) {
    const at = this.items.findIndex((i) => i.key === key);
    if (at < 0) return false;
    this.items.splice(at, 1);
    if (at === 0) this.startedAt = this.clock();
    this.onChange(this.view);
    return true;
  }

  clear() {
    this.items = [];
    this.onChange(this.view);
  }

  /** Call every second or so. With "move on by itself", the song that has played for its whole length (and a few seconds) is done. */
  tick() {
    const current = this.items[0];
    if (!this.settings.autoNext || !current || !current.seconds) return false;
    if (this.clock() - this.startedAt < (current.seconds + 4) * 1000) return false;
    return this.next();
  }

  /** What is worth remembering across a reload. */
  get entries() {
    return this.items.filter((i) => i.state !== "searching").map(({ user, name, avatar, query, title, artist, cover, seconds, link, trackId, state }) => ({ user, name, avatar, query, title, artist, cover, seconds, link, trackId, state }));
  }
}

/** The song catalog is asked through the site's own address (it asks the catalog for us), and the answers are kept for the session. */
export function makeLookup(fetchImpl = globalThis.fetch?.bind(globalThis), base = "") {
  const seen = new Map();
  return async (query) => {
    const key = same(query);
    if (seen.has(key)) return seen.get(key);
    if (!fetchImpl) return null;
    let track = null;
    try {
      const res = await fetchImpl(`${base}/api/songs?q=${encodeURIComponent(query)}`, { signal: globalThis.AbortSignal?.timeout?.(5000) });
      if (res.ok) track = (await res.json())?.results?.[0] ?? null;
    } catch { track = null; }
    if (seen.size > 200) seen.clear();
    seen.set(key, track);
    return track;
  };
}

/** Where a queue is kept between page loads (only when the person turned that on), per account. */
export const songsKey = (channel) => `frills:songs:${channel}`;
export function loadSongs(storage, channel) {
  try {
    const saved = JSON.parse(storage.getItem(songsKey(channel)) ?? "null");
    return Array.isArray(saved) ? saved.filter((e) => e && typeof e.title === "string" && typeof e.query === "string").slice(0, 50).map((e) => ({
      user: String(e.user ?? ""), name: clean(e.name, 40) || "viewer", avatar: String(e.avatar ?? ""), query: clean(e.query, 80), title: clean(e.title, CAP_TEXT), artist: clean(e.artist, 100),
      cover: String(e.cover ?? ""), seconds: Math.max(0, Math.round(Number(e.seconds) || 0)), link: String(e.link ?? ""), trackId: String(e.trackId ?? ""), state: e.state === "ready" ? "ready" : "missing",
    })) : [];
  } catch {
    return [];
  }
}
export function saveSongs(storage, channel, queue) {
  try { storage.setItem(songsKey(channel), JSON.stringify(queue.entries)); } catch { /* storage can be blocked */ }
}
