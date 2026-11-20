// Rotating Stream Highlights / Labels: pure settings, state tracker for Last Gift, Last Follower, Top Gifter, Top Liker (TikTok),
// plus Last Follower, Last Sub, Last Bits, Top Sub Gifter and Top Bit Sender (Twitch), with timed card rotation and
// optional localStorage persistence. Tested without a browser page.

import { defineWidget, chipsOf, range, selectOf, text, toggle } from "./widget-settings.js";
import { GifterBoard } from "./gifters.js";
import { LikeBoard } from "./likers.js";

const nfmt = (n) => Math.round(n || 0).toLocaleString("en-US");
const plural = (n, one, many) => `${nfmt(n)} ${n === 1 ? one : many}`;

export const LABEL_LAYOUTS = [
  ["card", "Card: bold highlight box"],
  ["bar", "Ticker bar: slim single line"],
  ["pill", "Pill: rounded capsule"],
  ["glass", "Glass: frosted translucent card"],
  ["neon", "Neon: glowing dark sign"],
  ["macos", "macOS: desktop notification window"],
  ["shell", "Shell: retro terminal line"],
  ["discord", "Discord: rich status card"],
  ["kawaii", "Kawaii: playful sticker border"],
  ["ribbon", "Ribbon: two-tone color strip"],
  ["polaroid", "Polaroid: framed photo card"],
  ["minimal", "Minimal: floating text only"],
];

export const LABELS = defineWidget({
  defaults: {
    layout: "card",
    enter: "slide",
    rotateSec: 6,
    showDots: true,
    avatar: true,
    showEmpty: true,
    keep: false,
    showGift: true,
    labelGift: "Last gift",
    showFollow: true,
    labelFollow: "Last follower",
    showTopGifter: true,
    labelTopGifter: "Top gifter",
    showTopLiker: true,
    labelTopLiker: "Top liker",
    showSub: true,
    labelSub: "Last sub",
    showBits: true,
    labelBits: "Last bits",
    showTopSubGifter: true,
    labelTopSub: "Top sub gifter",
    showTopBitSender: true,
    labelTopBits: "Top bit sender",
  },
  controls: [
    { section: "labels", ...selectOf("layout", "Highlight design", LABEL_LAYOUTS) },
    { section: "labels", ...chipsOf("enter", "Transition", [["slide", "Slide"], ["pop", "Pop"], ["fade", "Fade"]]) },
    { section: "labels", ...range("rotateSec", "Rotate every", 3, 30, 1, " s") },
    { section: "labels", ...toggle("showDots", "Show slide dots") },
    { section: "labels", ...toggle("avatar", "Show picture or gift image") },
    { section: "labels", ...toggle("showEmpty", "Show a waiting card before events arrive") },
    { section: "labels", ...toggle("keep", "Remember highlights if the page reloads", "Kept only in this browser or streaming app. Off starts fresh each load.") },
    { section: "labels", onlyPlatform: "tiktok", ...toggle("showGift", "Include last gift") },
    { section: "labels", onlyPlatform: "tiktok", ...text("labelGift", "Last gift label", 28) },
    { section: "labels", ...toggle("showFollow", "Include last follower") },
    { section: "labels", ...text("labelFollow", "Last follower label", 28) },
    { section: "labels", onlyPlatform: "tiktok", ...toggle("showTopGifter", "Include top gifter") },
    { section: "labels", onlyPlatform: "tiktok", ...text("labelTopGifter", "Top gifter label", 28) },
    { section: "labels", onlyPlatform: "tiktok", ...toggle("showTopLiker", "Include top liker", "Whoever has tapped the most likes since the overlay connected.") },
    { section: "labels", onlyPlatform: "tiktok", ...text("labelTopLiker", "Top liker label", 28) },
    { section: "labels", onlyPlatform: "twitch", ...toggle("showSub", "Include last sub") },
    { section: "labels", onlyPlatform: "twitch", ...text("labelSub", "Last sub label", 28) },
    { section: "labels", onlyPlatform: "twitch", ...toggle("showBits", "Include last bits") },
    { section: "labels", onlyPlatform: "twitch", ...text("labelBits", "Last bits label", 28) },
    { section: "labels", onlyPlatform: "twitch", ...toggle("showTopSubGifter", "Include top sub gifter") },
    { section: "labels", onlyPlatform: "twitch", ...text("labelTopSub", "Top sub gifter label", 28) },
    { section: "labels", onlyPlatform: "twitch", ...toggle("showTopBitSender", "Include top bit sender") },
    { section: "labels", onlyPlatform: "twitch", ...text("labelTopBits", "Top bit sender label", 28) },
  ],
});

const NO_MILESTONE = { max: 1, celebrate: false, minDiamonds: 1, twitchMode: "subgift" };
/** The likes board only has to know who is first: no list, no celebration (that is the Top Likers overlay). */
const TOP_ONE = { max: 1, minLikes: 1, celebrate: false, milestone: 1000, celebrateWho: "top" };

/** Orders enabled highlight slots per streaming platform. */
export function enabledSlotIds(platform, settings) {
  if (platform === "twitch") {
    return [
      settings.showFollow && "lastFollower",
      settings.showSub && "lastSub",
      settings.showBits && "lastBits",
      settings.showTopSubGifter && "topSubGifter",
      settings.showTopBitSender && "topBitSender",
    ].filter(Boolean);
  }
  return [
    settings.showGift && "lastGift",
    settings.showFollow && "lastFollower",
    settings.showTopGifter && "topGifter",
    settings.showTopLiker && "topLiker",
  ].filter(Boolean);
}

/**
 * Tracks recent stream highlights and leaderboards and rotates through enabled populated cards.
 * Calls `onChange(snapshot)` whenever the displayed card, count of slides, or content updates.
 */
export class LabelBoard {
  constructor(settings, { platform = "tiktok", onChange, timers = globalThis, initial = null } = {}) {
    this.settings = settings;
    this.platform = platform === "twitch" ? "twitch" : "tiktok";
    this.onChange = onChange ?? (() => {});
    this.timers = timers;
    this.timer = 0;
    this.index = 0;
    this.revision = 0;

    this.lastGift = initial?.lastGift ?? null;
    this.lastFollower = initial?.lastFollower ?? null;
    this.lastSub = initial?.lastSub ?? null;
    this.lastBits = initial?.lastBits ?? null;

    this.diamondBoard = new GifterBoard(NO_MILESTONE, { platform: "tiktok", entries: initial?.tiktokGifters ?? [] });
    this.likeBoard = new LikeBoard(TOP_ONE, { entries: initial?.tiktokLikers ?? [] });
    this.subBoard = new GifterBoard({ ...NO_MILESTONE, twitchMode: "subgift" }, { platform: "twitch", entries: initial?.twitchSubGifters ?? [] });
    this.bitsBoard = new GifterBoard({ ...NO_MILESTONE, twitchMode: "bits" }, { platform: "twitch", entries: initial?.twitchBitSenders ?? [] });

    this.schedule();
  }

  /** Builds the active card list (populated, enabled slots for the active platform). */
  cards() {
    const s = this.settings;
    const out = [];
    for (const id of enabledSlotIds(this.platform, s)) {
      if (id === "lastGift" && this.lastGift) {
        const g = this.lastGift;
        const times = g.count > 1 ? ` ×${g.count}` : "";
        out.push({
          id,
          label: s.labelGift || "Last gift",
          headline: `${g.name} · ${g.gift}${times}`,
          detail: g.total > 0 ? plural(g.total, "diamond", "diamonds") : "",
          avatar: g.avatar || "",
          picture: g.picture || "",
          initialName: g.name,
        });
      } else if (id === "lastFollower" && this.lastFollower) {
        out.push({
          id,
          label: s.labelFollow || "Last follower",
          headline: this.lastFollower.name,
          detail: "",
          avatar: this.lastFollower.avatar || "",
          picture: "",
          initialName: this.lastFollower.name,
        });
      } else if (id === "topGifter" && this.diamondBoard.top[0]) {
        const top = this.diamondBoard.top[0];
        out.push({
          id,
          label: s.labelTopGifter || "Top gifter",
          headline: top.name,
          detail: top.label,
          avatar: top.avatar || "",
          picture: "",
          initialName: top.name,
        });
      } else if (id === "topLiker" && this.likeBoard.top[0]) {
        const top = this.likeBoard.top[0];
        out.push({
          id,
          label: s.labelTopLiker || "Top liker",
          headline: top.name,
          detail: plural(top.count, "like", "likes"),
          avatar: top.avatar || "",
          picture: "",
          initialName: top.name,
        });
      } else if (id === "lastSub" && this.lastSub) {
        const sub = this.lastSub;
        out.push({
          id,
          label: s.labelSub || "Last sub",
          headline: sub.name,
          detail: sub.resub && sub.months > 1 ? `${plural(sub.months, "month", "months")} resub` : "New subscriber",
          avatar: "",
          picture: "",
          initialName: sub.name,
        });
      } else if (id === "lastBits" && this.lastBits) {
        out.push({
          id,
          label: s.labelBits || "Last bits",
          headline: this.lastBits.name,
          detail: plural(this.lastBits.count, "bit", "bits"),
          avatar: "",
          picture: "",
          initialName: this.lastBits.name,
        });
      } else if (id === "topSubGifter" && this.subBoard.top[0]) {
        const top = this.subBoard.top[0];
        out.push({
          id,
          label: s.labelTopSub || "Top sub gifter",
          headline: top.name,
          detail: plural(top.subgifts, "gifted sub", "gifted subs"),
          avatar: "",
          picture: "",
          initialName: top.name,
        });
      } else if (id === "topBitSender" && this.bitsBoard.top[0]) {
        const top = this.bitsBoard.top[0];
        out.push({
          id,
          label: s.labelTopBits || "Top bit sender",
          headline: top.name,
          detail: plural(top.bits, "bit", "bits"),
          avatar: "",
          picture: "",
          initialName: top.name,
        });
      }
    }
    return out;
  }

  snapshot() {
    const cards = this.cards();
    if (!cards.length) {
      if (!this.settings.showEmpty) return { card: null, count: 0, index: 0, revision: this.revision };
      return {
        card: {
          id: "idle",
          empty: true,
          label: this.platform === "twitch" ? "Stream highlights" : "LIVE highlights",
          headline: "Waiting for stream activity…",
          detail: "",
          avatar: "",
          picture: "",
          initialName: "",
        },
        count: 0,
        index: 0,
        revision: this.revision,
      };
    }
    const index = ((this.index % cards.length) + cards.length) % cards.length;
    return { card: cards[index], cards, count: cards.length, index, revision: this.revision };
  }

  emit() {
    this.onChange(this.snapshot());
  }

  schedule() {
    this.timers.clearTimeout(this.timer);
    const cards = this.cards();
    if (cards.length < 2) { this.timer = 0; return; }
    const ms = Math.max(3, Math.min(30, Number(this.settings.rotateSec) || 6)) * 1000;
    this.timer = this.timers.setTimeout(() => this.next(), ms);
  }

  stop() {
    this.timers.clearTimeout(this.timer);
    this.timer = 0;
  }

  next() {
    const cards = this.cards();
    if (!cards.length) { this.schedule(); return; }
    this.index = (this.index + 1) % cards.length;
    this.revision += 1;
    this.emit();
    this.schedule();
  }

  select(id) {
    const at = this.cards().findIndex((c) => c.id === id);
    if (at < 0) return false;
    this.index = at;
    this.revision += 1;
    this.emit();
    this.schedule();
    return true;
  }

  setSettings(settings) {
    this.settings = settings;
    const cards = this.cards();
    this.index = cards.length ? this.index % cards.length : 0;
    this.emit();
    this.schedule();
  }

  setPlatform(platform) {
    const next = platform === "twitch" ? "twitch" : "tiktok";
    if (next === this.platform) return;
    this.platform = next;
    this.index = 0;
    this.revision += 1;
    this.emit();
    this.schedule();
  }

  /** Accepts an alert/event from TikTok relay, Twitch IRC, or FollowWatcher / FollowReader. */
  add(event) {
    if (!event || !event.kind) return false;
    let jumpTo = "";

    if (event.kind === "gift" && this.platform === "tiktok") {
      const name = event.name || event.user;
      const gift = event.gift || "Gift";
      if (!name) return false;
      const count = Math.max(1, Math.round(Number(event.count) || 1));
      const diamonds = Math.max(0, Math.round(Number(event.diamonds) || 0));
      const total = Math.max(0, Math.round(Number(event.total) || diamonds * count));
      this.lastGift = { name, gift, count, diamonds, total, picture: event.picture || "", avatar: event.avatar || "" };
      this.diamondBoard.add({ ...event, total });
      jumpTo = this.settings.showGift ? "lastGift" : (this.settings.showTopGifter ? "topGifter" : "");
    } else if (event.kind === "like" && this.platform === "tiktok") {
      const before = this.cards().length;
      if (!this.likeBoard.add(event)) return false;
      if (this.cards().length === before) {
        // Likes come about once a second. They must not restart the rotation timer or change the slide: the top liker's own slide just
        // updates its words, in place, when it is the one on show.
        if (this.snapshot().card?.id === "topLiker") this.emit();
        return true;
      }
    } else if (event.kind === "follow") {
      const name = event.name || event.user;
      if (!name) return false;
      this.lastFollower = { name, avatar: event.avatar || "" };
      if (this.settings.showFollow) jumpTo = "lastFollower";
    } else if (event.kind === "sub" && this.platform === "twitch") {
      const name = event.name || event.user;
      if (!name) return false;
      this.lastSub = { name, months: Math.max(1, Math.round(Number(event.count) || 1)), resub: Boolean(event.resub) };
      if (this.settings.showSub) jumpTo = "lastSub";
    } else if (event.kind === "subgift" && this.platform === "twitch") {
      if (!event.user) return false;
      this.subBoard.add(event);
      if (this.settings.showTopSubGifter) jumpTo = "topSubGifter";
    } else if (event.kind === "bits" && this.platform === "twitch") {
      const name = event.name || event.user;
      const count = Math.max(0, Math.round(Number(event.count) || 0));
      if (!name || !(count > 0)) return false;
      this.lastBits = { name, count };
      this.bitsBoard.add(event);
      jumpTo = this.settings.showBits ? "lastBits" : (this.settings.showTopBitSender ? "topBitSender" : "");
    } else {
      return false;
    }

    const cards = this.cards();
    const at = jumpTo ? cards.findIndex((c) => c.id === jumpTo) : -1;
    if (at >= 0) this.index = at;
    else if (cards.length) this.index = this.index % cards.length;
    this.revision += 1;
    this.emit();
    this.schedule();
    return true;
  }

  clear() {
    this.lastGift = null;
    this.lastFollower = null;
    this.lastSub = null;
    this.lastBits = null;
    this.diamondBoard.clear();
    this.likeBoard.clear();
    this.subBoard.clear();
    this.bitsBoard.clear();
    this.index = 0;
    this.revision += 1;
    this.emit();
    this.schedule();
  }

  serialize() {
    return {
      lastGift: this.lastGift,
      lastFollower: this.lastFollower,
      lastSub: this.lastSub,
      lastBits: this.lastBits,
      tiktokGifters: this.diamondBoard.entries,
      tiktokLikers: this.likeBoard.entries,
      twitchSubGifters: this.subBoard.entries,
      twitchBitSenders: this.bitsBoard.entries,
    };
  }
}

export const labelsKey = (platform, channel) => `frills:labels:${platform}:${channel}`;

export function loadLabels(storage, platform, channel) {
  try {
    const saved = JSON.parse(storage.getItem(labelsKey(platform, channel)) ?? "null");
    if (!saved || typeof saved !== "object") return null;
    const list = (entries) => (Array.isArray(entries) ? entries.filter((e) => e && typeof e.user === "string" && typeof e.name === "string").slice(0, 100) : []);
    return {
      lastGift: saved.lastGift && typeof saved.lastGift.name === "string" ? saved.lastGift : null,
      lastFollower: saved.lastFollower && typeof saved.lastFollower.name === "string" ? saved.lastFollower : null,
      lastSub: saved.lastSub && typeof saved.lastSub.name === "string" ? saved.lastSub : null,
      lastBits: saved.lastBits && typeof saved.lastBits.name === "string" ? saved.lastBits : null,
      tiktokGifters: list(saved.tiktokGifters),
      tiktokLikers: list(saved.tiktokLikers).filter((e) => Number.isFinite(e.count) && e.count > 0),
      twitchSubGifters: list(saved.twitchSubGifters),
      twitchBitSenders: list(saved.twitchBitSenders),
    };
  } catch {
    return null;
  }
}

export function saveLabels(storage, platform, channel, board) {
  try { storage.setItem(labelsKey(platform, channel), JSON.stringify(board.serialize())); } catch { /* blocked */ }
}
