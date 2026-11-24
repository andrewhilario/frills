// Rotating Stream Highlights / Labels: pure settings, state tracker for Last Gift, Last Follower, Top Gifter (with animated gift badge),
// Top Streak (highest multi-send gift combo), Top Liker (TikTok), plus Last Follower, Last Sub, Last Bits, Top Sub Gifter and Top Bit Sender (Twitch),
// with timed card rotation and optional localStorage persistence. Tested without a browser page.

import { defineWidget, chipsOf, range, selectOf, text, toggle } from "./widget-settings.js";
import { GifterBoard } from "./gifters.js";
import { LikeBoard } from "./likers.js";

const nfmt = (n) => Math.round(n || 0).toLocaleString("en-US");
const plural = (n, one, many) => `${nfmt(n)} ${n === 1 ? one : many}`;
const STREAK_WINDOW_MS = 15000;
const normGiftKey = (g) => String(g ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const ANIMATED_GIFT_NAMES = new Set(["hand hearts", "super gg", "confetti", "corgi", "money gun", "swan", "galaxy", "whale diving", "lion", "universe", "panda", "sunglasses"]);
const giftTier = (gift, diamonds = 0) => (diamonds >= 500 ? 3 : (diamonds >= 20 || ANIMATED_GIFT_NAMES.has(normGiftKey(gift)) ? 2 : 1));

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
    anim: "shine",
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
    showTopGiftAnim: true,
    showTopStreak: true,
    labelTopStreak: "Top streak",
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
    { section: "labels", ...chipsOf("enter", "Transition", [["slide", "Slide"], ["pop", "Pop"], ["bounce", "Bounce"], ["flip", "3D Flip"], ["fade", "Fade"]]) },
    { section: "labels", ...chipsOf("anim", "Card animation", [["shine", "Shine & crown"], ["pulse", "Spotlight glow"], ["float", "Gentle float"], ["none", "Still"]]) },
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
    { section: "labels", onlyPlatform: "tiktok", ...toggle("showTopGiftAnim", "Show top gifter’s animated gift", "Displays an animated badge of the biggest gift the top gifter sent (like Hand Hearts, Super GG, or Galaxy).") },
    { section: "labels", onlyPlatform: "tiktok", ...toggle("showTopStreak", "Include top streak", "Highest multi-send gift combo streak in this LIVE.") },
    { section: "labels", onlyPlatform: "tiktok", ...text("labelTopStreak", "Top streak label", 28) },
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
    settings.showTopStreak && "topStreak",
    settings.showTopLiker && "topLiker",
  ].filter(Boolean);
}

/**
 * Tracks recent stream highlights and leaderboards and rotates through enabled populated cards.
 * Calls `onChange(snapshot)` whenever the displayed card, count of slides, or content updates.
 */
export class LabelBoard {
  constructor(settings, { platform = "tiktok", onChange, timers = globalThis, now = () => Date.now(), initial = null } = {}) {
    this.settings = settings;
    this.platform = platform === "twitch" ? "twitch" : "tiktok";
    this.onChange = onChange ?? (() => {});
    this.timers = timers;
    this.now = now;
    this.timer = 0;
    this.index = 0;
    this.revision = 0;
    this.celebrateId = 0;
    this.celebrateKind = "";

    this.lastGift = initial?.lastGift ?? null;
    this.lastFollower = initial?.lastFollower ?? null;
    this.lastSub = initial?.lastSub ?? null;
    this.lastBits = initial?.lastBits ?? null;
    this.topStreak = initial?.topStreak ?? null;
    this.bestGiftByUser = new Map();
    if (Array.isArray(initial?.bestGifts)) {
      for (const entry of initial.bestGifts.slice(0, 100)) {
        if (Array.isArray(entry) && typeof entry[0] === "string" && entry[1] && typeof entry[1].gift === "string") {
          this.bestGiftByUser.set(entry[0], entry[1]);
        }
      }
    }
    this.activeStreaks = new Map();

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
        const best = this.bestGiftByUser.get(top.key) ?? null;
        out.push({
          id,
          top: true,
          label: s.labelTopGifter || "Top gifter",
          headline: top.name,
          detail: top.label,
          avatar: top.avatar || "",
          picture: "",
          initialName: top.name,
          giftBadge: best && s.showTopGiftAnim !== false ? {
            gift: best.gift,
            picture: best.picture || "",
            diamonds: best.diamonds || 0,
            count: best.count || 1,
            tier: giftTier(best.gift, best.diamonds),
          } : null,
        });
      } else if (id === "topStreak" && this.topStreak) {
        const st = this.topStreak;
        out.push({
          id,
          top: true,
          streak: true,
          label: s.labelTopStreak || "Top streak",
          headline: st.name,
          detail: `${nfmt(st.count)}× ${st.gift}`,
          avatar: st.avatar || "",
          picture: "",
          initialName: st.name,
          streakCount: st.count,
          giftBadge: {
            gift: st.gift,
            picture: st.picture || "",
            diamonds: st.diamonds || 0,
            count: st.count,
            streak: true,
            tier: st.count >= 50 ? 3 : (st.count >= 10 ? 2 : giftTier(st.gift, st.diamonds)),
          },
        });
      } else if (id === "topLiker" && this.likeBoard.top[0]) {
        const top = this.likeBoard.top[0];
        out.push({
          id,
          top: true,
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
          top: true,
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
          top: true,
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
      if (!this.settings.showEmpty) return { card: null, count: 0, index: 0, revision: this.revision, celebrateId: this.celebrateId, celebrateKind: this.celebrateKind };
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
        celebrateId: this.celebrateId,
        celebrateKind: this.celebrateKind,
      };
    }
    const index = ((this.index % cards.length) + cards.length) % cards.length;
    return { card: cards[index], cards, count: cards.length, index, revision: this.revision, celebrateId: this.celebrateId, celebrateKind: this.celebrateKind };
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
    let newLeader = false;

    if (event.kind === "gift" && this.platform === "tiktok") {
      const name = event.name || event.user;
      const gift = event.gift || "Gift";
      if (!name) return false;
      const userKey = String(event.user || name);
      const count = Math.max(1, Math.round(Number(event.count) || 1));
      const diamonds = Math.max(0, Math.round(Number(event.diamonds) || 0));
      const total = Math.max(0, Math.round(Number(event.total) || diamonds * count));
      const prevTop = this.diamondBoard.top[0]?.key ?? "";
      this.lastGift = { name, gift, count, diamonds, total, picture: event.picture || "", avatar: event.avatar || "" };
      this.diamondBoard.add({ ...event, user: userKey, name, total });
      const nextTop = this.diamondBoard.top[0]?.key ?? "";
      newLeader = Boolean(nextTop && nextTop !== prevTop);

      // Remember each gifter's signature / highest-tier gift so Top Gifter displays an animated showcase of what they sent
      const prevBest = this.bestGiftByUser.get(userKey);
      const gKey = normGiftKey(gift);
      const bestBetter = !prevBest
        || diamonds > (prevBest.diamonds || 0)
        || (diamonds === (prevBest.diamonds || 0) && total >= (prevBest.total || 0));
      if (bestBetter) {
        this.bestGiftByUser.set(userKey, {
          gift,
          picture: event.picture || (prevBest && normGiftKey(prevBest.gift) === gKey ? prevBest.picture : "") || "",
          diamonds,
          count,
          total,
        });
        if (this.bestGiftByUser.size > 200) this.bestGiftByUser.delete(this.bestGiftByUser.keys().next().value);
      } else if (prevBest && !prevBest.picture && event.picture && normGiftKey(prevBest.gift) === gKey) {
        prevBest.picture = event.picture;
      }

      // Track multi-send gift combo streaks (both TikTok repeatCount >= 2 and rapid back-to-back sends within 15s)
      const comboKey = `${userKey}|${gKey}`;
      const tNow = this.now();
      const prevCombo = this.activeStreaks.get(comboKey);
      let combo;
      if (prevCombo && (tNow - prevCombo.lastAt) <= STREAK_WINDOW_MS) {
        prevCombo.count += count;
        prevCombo.total += total;
        prevCombo.lastAt = tNow;
        combo = prevCombo;
      } else {
        combo = { count, total, lastAt: tNow };
        this.activeStreaks.set(comboKey, combo);
        if (this.activeStreaks.size > 200) this.activeStreaks.delete(this.activeStreaks.keys().next().value);
      }

      let newStreakRecord = false;
      if (combo.count >= 2) {
        const cur = this.topStreak;
        const beats = !cur
          || combo.count > cur.count
          || (combo.count === cur.count && combo.total > (cur.total || 0))
          || (cur.user === userKey && cur.giftKey === gKey && combo.count >= cur.count);
        if (beats) {
          const prevHolder = cur?.user ?? "";
          this.topStreak = {
            user: userKey,
            name,
            avatar: event.avatar || (cur && cur.user === userKey ? cur.avatar : "") || "",
            gift,
            giftKey: gKey,
            picture: event.picture || (cur && cur.giftKey === gKey ? cur.picture : "") || "",
            diamonds,
            count: combo.count,
            total: combo.total,
          };
          newStreakRecord = true;
          if (!prevHolder || prevHolder !== userKey || combo.count > (cur?.count || 0)) newLeader = true;
        }
      }

      jumpTo = this.settings.showGift
        ? "lastGift"
        : (newStreakRecord && this.settings.showTopStreak)
          ? "topStreak"
          : (this.settings.showTopGifter ? "topGifter" : (this.settings.showTopStreak && this.topStreak ? "topStreak" : ""));
    } else if (event.kind === "like" && this.platform === "tiktok") {
      const before = this.cards().length;
      const prevTop = this.likeBoard.top[0]?.user ?? "";
      if (!this.likeBoard.add(event)) return false;
      const nextTop = this.likeBoard.top[0]?.user ?? "";
      newLeader = Boolean(nextTop && nextTop !== prevTop);
      if (this.cards().length === before) {
        // Likes come about once a second. They must not restart the rotation timer or change the slide: the top liker's own slide just
        // updates its words, in place, when it is the one on show.
        if (this.snapshot().card?.id === "topLiker") {
          if (newLeader) {
            this.celebrateId += 1;
            this.celebrateKind = "leader";
          }
          this.emit();
        }
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
      const prevTop = this.subBoard.top[0]?.user ?? "";
      this.subBoard.add(event);
      const nextTop = this.subBoard.top[0]?.user ?? "";
      newLeader = Boolean(nextTop && nextTop !== prevTop);
      if (this.settings.showTopSubGifter) jumpTo = "topSubGifter";
    } else if (event.kind === "bits" && this.platform === "twitch") {
      const name = event.name || event.user;
      const count = Math.max(0, Math.round(Number(event.count) || 0));
      if (!name || !(count > 0)) return false;
      const prevTop = this.bitsBoard.top[0]?.user ?? "";
      this.lastBits = { name, count };
      this.bitsBoard.add(event);
      const nextTop = this.bitsBoard.top[0]?.user ?? "";
      newLeader = Boolean(nextTop && nextTop !== prevTop);
      jumpTo = this.settings.showBits ? "lastBits" : (this.settings.showTopBitSender ? "topBitSender" : "");
    } else {
      return false;
    }

    const cards = this.cards();
    const at = jumpTo ? cards.findIndex((c) => c.id === jumpTo) : -1;
    if (at >= 0) this.index = at;
    else if (cards.length) this.index = this.index % cards.length;
    this.revision += 1;
    this.celebrateId += 1;
    this.celebrateKind = newLeader ? "leader" : "event";
    this.emit();
    this.schedule();
    return true;
  }

  clear() {
    this.lastGift = null;
    this.lastFollower = null;
    this.lastSub = null;
    this.lastBits = null;
    this.topStreak = null;
    this.bestGiftByUser.clear();
    this.activeStreaks.clear();
    this.diamondBoard.clear();
    this.likeBoard.clear();
    this.subBoard.clear();
    this.bitsBoard.clear();
    this.index = 0;
    this.revision += 1;
    this.celebrateKind = "";
    this.emit();
    this.schedule();
  }

  serialize() {
    return {
      lastGift: this.lastGift,
      lastFollower: this.lastFollower,
      lastSub: this.lastSub,
      lastBits: this.lastBits,
      topStreak: this.topStreak,
      bestGifts: [...this.bestGiftByUser.entries()].slice(0, 100),
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
    const topStreak = saved.topStreak && typeof saved.topStreak.name === "string" && typeof saved.topStreak.gift === "string" && Number.isFinite(saved.topStreak.count) && saved.topStreak.count >= 2
      ? saved.topStreak
      : null;
    const bestGifts = Array.isArray(saved.bestGifts)
      ? saved.bestGifts.filter((p) => Array.isArray(p) && typeof p[0] === "string" && p[1] && typeof p[1].gift === "string").slice(0, 100)
      : [];
    return {
      lastGift: saved.lastGift && typeof saved.lastGift.name === "string" ? saved.lastGift : null,
      lastFollower: saved.lastFollower && typeof saved.lastFollower.name === "string" ? saved.lastFollower : null,
      lastSub: saved.lastSub && typeof saved.lastSub.name === "string" ? saved.lastSub : null,
      lastBits: saved.lastBits && typeof saved.lastBits.name === "string" ? saved.lastBits : null,
      topStreak,
      bestGifts,
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
