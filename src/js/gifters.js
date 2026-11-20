// Top Gifters: settings, multi-platform leaderboard logic (TikTok Diamonds + Twitch Sub Gifters / Bit Senders / Combined),
// milestone celebration checks, and optional localStorage persistence. Pure code so it is tested without a page.

import { defineWidget, chipsOf, number, range, selectOf, text, toggle } from "./widget-settings.js";
import { LEADERBOARD_LAYOUTS } from "./leaderboard-layouts.js";
import { SOUNDS } from "./alerts-settings.js";

/** Minimum celebration interval so milestones cannot fire on every single 1-diamond gift. */
export const MIN_GIFTER_MILESTONE = 5;

export const GIFTER_LAYOUTS = LEADERBOARD_LAYOUTS;

export const GIFTERS = defineWidget({
  defaults: {
    layout: "classic",
    max: 10,
    title: true,
    titleText: "Top gifters",
    showCounts: true,
    avatar: true,
    medals: true,
    twitchMode: "subgift",
    minDiamonds: 1,
    keep: false,
    celebrate: true,
    milestone: 1000,
    celebrateWho: "top",
    celebrateText: "Thank you!",
    celebrateTime: 7,
    celebrateSound: "fanfare",
  },
  controls: [
    { section: "list", ...selectOf("layout", "Leaderboard design", GIFTER_LAYOUTS) },
    { section: "list", ...range("max", "People shown", 3, 10, 1, "") },
    { section: "list", ...toggle("title", "Show a title above the list") },
    { section: "list", ...text("titleText", "Title", 40) },
    { section: "list", ...toggle("showCounts", "Show the score") },
    { section: "list", ...toggle("avatar", "Show the person's picture") },
    { section: "list", ...toggle("medals", "Gold, silver and bronze for the top 3") },
    { section: "list", onlyPlatform: "twitch", ...chipsOf("twitchMode", "Twitch ranks", [["subgift", "Sub gifters"], ["bits", "Bit senders"], ["combined", "Both together"]]) },
    { section: "list", onlyPlatform: "tiktok", ...number("minDiamonds", "Diamonds needed to be listed", 1, 1000000) },
    { section: "list", ...toggle("keep", "Remember the totals if the page reloads", "Kept only in this browser or streaming app. Off starts again each time the page loads.") },
    { section: "list", ...toggle("celebrate", "Celebrate a gift milestone", "When someone reaches a milestone, their picture, name and score zoom in with a crown, for a few seconds.") },
    { section: "list", ...number("milestone", "Celebrate every", MIN_GIFTER_MILESTONE, 1000000, { hint: "Diamonds on TikTok, bits on Twitch, or gifted subs (try 5 or 10 for Sub gifters)." }) },
    { section: "list", ...chipsOf("celebrateWho", "Who is celebrated", [["top", "The top gifter"], ["any", "Anyone on the list"]]) },
    { section: "list", ...text("celebrateText", "Words under the name", 40) },
    { section: "list", ...range("celebrateTime", "Seconds on screen", 3, 15, 1, " s") },
    { section: "list", ...selectOf("celebrateSound", "Sound", SOUNDS.map(({ id, name }) => [id, name])) },
  ],
});

const CAP = 5000;
const SAVED = 100;
const SUB_WEIGHT = 500; // 1 gifted sub ≈ $5 ≈ 500 bits equivalent in combined mode

const nfmt = (n) => Math.round(n || 0).toLocaleString("en-US");
const plural = (n, one, many) => `${nfmt(n)} ${n === 1 ? one : many}`;

/** Numeric score used for sorting and minimum filtering under the active platform and Twitch mode. */
export function gifterScore(person, platform = "tiktok", twitchMode = "subgift") {
  if (platform !== "twitch") return person.diamonds || 0;
  if (twitchMode === "bits") return person.bits || 0;
  if (twitchMode === "combined") return (person.subgifts || 0) * SUB_WEIGHT + (person.bits || 0);
  return person.subgifts || 0;
}

/** Human-readable score label shown on each leaderboard row. */
export function formatGifterScore(person, platform = "tiktok", twitchMode = "subgift") {
  if (platform !== "twitch") return plural(person.diamonds || 0, "diamond", "diamonds");
  if (twitchMode === "bits") return plural(person.bits || 0, "bit", "bits");
  if (twitchMode === "subgift") return plural(person.subgifts || 0, "sub", "subs");
  const s = person.subgifts || 0;
  const b = person.bits || 0;
  if (s > 0 && b > 0) return `${plural(s, "sub", "subs")} · ${plural(b, "bit", "bits")}`;
  if (s > 0) return plural(s, "sub", "subs");
  return plural(b, "bit", "bits");
}

/** Returns { metric, unit } for milestone counting and the trophy popup text. */
export function milestoneInfo(person, platform = "tiktok", twitchMode = "subgift") {
  if (platform !== "twitch") return { metric: person.diamonds || 0, unit: (person.diamonds || 0) === 1 ? "diamond" : "diamonds" };
  if (twitchMode === "bits") return { metric: person.bits || 0, unit: (person.bits || 0) === 1 ? "bit" : "bits" };
  if (twitchMode === "subgift") return { metric: person.subgifts || 0, unit: (person.subgifts || 0) === 1 ? "gifted sub" : "gifted subs" };
  return { metric: gifterScore(person, platform, twitchMode), unit: "points" };
}

/**
 * Ranks gifters for TikTok LIVE (gift diamonds) or Twitch (sub gifters, bit senders, or both).
 * Calls `onChange(top)` after every state change and `onMilestone(info)` when a tracked threshold is crossed.
 */
export class GifterBoard {
  constructor(settings, { platform = "tiktok", onChange, onMilestone, entries = [] } = {}) {
    this.settings = settings;
    this.platform = platform === "twitch" ? "twitch" : "tiktok";
    this.onChange = onChange ?? (() => {});
    this.onMilestone = onMilestone ?? (() => {});
    this.people = new Map();
    this.order = 0;
    for (const e of entries) {
      this.people.set(e.user, {
        user: e.user,
        name: e.name,
        avatar: e.avatar ?? "",
        diamonds: Number(e.diamonds) || 0,
        subgifts: Number(e.subgifts) || 0,
        bits: Number(e.bits) || 0,
        order: this.order++,
      });
    }
  }

  setSettings(settings) {
    this.settings = settings;
    this.onChange(this.top);
  }

  setPlatform(platform) {
    const next = platform === "twitch" ? "twitch" : "tiktok";
    if (next === this.platform) return;
    this.platform = next;
    this.onChange(this.top);
  }

  get every() {
    return Math.max(MIN_GIFTER_MILESTONE, Math.round(Number(this.settings.milestone)) || 1000);
  }

  /** Ranked entries, best first; earliest achiever wins ties. */
  get top() {
    const twitchMode = this.settings.twitchMode || "subgift";
    const minScore = this.platform === "twitch" ? 1 : Math.max(1, Number(this.settings.minDiamonds) || 1);
    return [...this.people.values()]
      .map((p) => ({ person: p, score: gifterScore(p, this.platform, twitchMode) }))
      .filter(({ score }) => score >= minScore)
      .sort((a, b) => b.score - a.score || a.person.order - b.person.order)
      .slice(0, this.settings.max)
      .map(({ person, score }, i) => ({
        key: person.user,
        name: person.name,
        avatar: person.avatar,
        count: score,
        label: formatGifterScore(person, this.platform, twitchMode),
        diamonds: person.diamonds,
        subgifts: person.subgifts,
        bits: person.bits,
        rank: i + 1,
      }));
  }

  /** Processes a relay gift (TikTok) or Twitch subgift / bits event. */
  add(event) {
    if (!event || !event.user) return false;
    let deltaDiamonds = 0;
    let deltaSubs = 0;
    let deltaBits = 0;

    if (event.kind === "gift") {
      deltaDiamonds = Number(event.total) || ((Number(event.diamonds) || 0) * Math.max(1, Number(event.count) || 1));
      if (!(deltaDiamonds > 0)) return false;
    } else if (event.kind === "subgift") {
      deltaSubs = Math.max(0, Math.round(Number(event.count) || 1));
      if (!(deltaSubs > 0)) return false;
    } else if (event.kind === "bits") {
      deltaBits = Math.max(0, Math.round(Number(event.count) || 0));
      if (!(deltaBits > 0)) return false;
    } else {
      return false;
    }

    const twitchMode = this.settings.twitchMode || "subgift";
    const held = this.people.get(event.user);
    const before = held ? milestoneInfo(held, this.platform, twitchMode).metric : 0;

    if (held) {
      held.diamonds += deltaDiamonds;
      held.subgifts += deltaSubs;
      held.bits += deltaBits;
      held.name = event.name || held.name;
      if (event.avatar) held.avatar = event.avatar;
      held.order = this.order++;
    } else {
      this.people.set(event.user, {
        user: event.user,
        name: event.name || event.user,
        avatar: event.avatar ?? "",
        diamonds: deltaDiamonds,
        subgifts: deltaSubs,
        bits: deltaBits,
        order: this.order++,
      });
    }

    if (this.people.size > CAP) this.prune();
    this.onChange(this.top);
    this.checkMilestone(event.user, before);
    return true;
  }

  checkMilestone(user, before) {
    if (!this.settings.celebrate) return;
    const person = this.people.get(user);
    if (!person) return;
    const twitchMode = this.settings.twitchMode || "subgift";
    const { metric, unit } = milestoneInfo(person, this.platform, twitchMode);
    if (metric <= before) return;
    const reached = Math.floor(metric / this.every);
    if (reached <= Math.floor(before / this.every)) return;
    const at = this.top.findIndex((p) => p.key === user);
    if (at < 0 || (this.settings.celebrateWho !== "any" && at !== 0)) return;
    this.onMilestone({
      key: user,
      name: person.name,
      avatar: person.avatar,
      count: metric,
      unit,
      milestone: reached * this.every,
      rank: at + 1,
    });
  }

  prune() {
    const twitchMode = this.settings.twitchMode || "subgift";
    const keep = [...this.people.values()]
      .sort((a, b) => gifterScore(b, this.platform, twitchMode) - gifterScore(a, this.platform, twitchMode) || a.order - b.order)
      .slice(0, Math.floor(CAP / 2));
    this.people = new Map(keep.map((p) => [p.user, p]));
  }

  clear() {
    this.people.clear();
    this.onChange(this.top);
  }

  get entries() {
    const twitchMode = this.settings.twitchMode || "subgift";
    return [...this.people.values()]
      .sort((a, b) => gifterScore(b, this.platform, twitchMode) - gifterScore(a, this.platform, twitchMode) || a.order - b.order)
      .slice(0, SAVED)
      .map(({ user, name, avatar, diamonds, subgifts, bits }) => ({ user, name, avatar, diamonds, subgifts, bits }));
  }
}

export const giftersKey = (platform, channel) => `frills:gifters:${platform}:${channel}`;

export function loadGifters(storage, platform, channel) {
  try {
    const saved = JSON.parse(storage.getItem(giftersKey(platform, channel)) ?? "null");
    if (!Array.isArray(saved)) return [];
    return saved
      .filter((e) => e && typeof e.user === "string" && typeof e.name === "string"
        && ((e.diamonds > 0) || (e.subgifts > 0) || (e.bits > 0)))
      .slice(0, SAVED);
  } catch {
    return [];
  }
}

export function saveGifters(storage, platform, channel, board) {
  try { storage.setItem(giftersKey(platform, channel), JSON.stringify(board.entries)); } catch { /* blocked */ }
}
