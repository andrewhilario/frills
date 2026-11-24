// Gift Gallery Rotator (TikTok LIVE): standalone rotating gift gallery & gift-reward showcase.
// Supports two modes:
//   - "custom": streamer picks up to 16 featured gifts (with optional diamond price & action/reward caption) that light up live as viewers send them.
//   - "live": automatically collects every unique TikTok LIVE gift sent during the stream, rotating through all collected gifts & who lit them up.
// Pure state, catalog, URL encoding, and localStorage helpers (tested without a browser).

import { defineWidget, chipsOf, range, selectOf, text, toggle } from "./widget-settings.js";

export const MAX_GALLERY_ITEMS = 16;

/** Popular TikTok LIVE gifts with official diamond values and built-in vector icon keys. */
export const GALLERY_CATALOG = [
  { gift: "Rose", diamonds: 1, icon: "rose", color: "#ff4f7b" },
  { gift: "TikTok", diamonds: 1, icon: "note", color: "#25f4ee" },
  { gift: "GG", diamonds: 1, icon: "gg", color: "#6c5ce7" },
  { gift: "Ice Cream Cone", diamonds: 1, icon: "icecream", color: "#ff9ff3" },
  { gift: "Heart Me", diamonds: 1, icon: "heart", color: "#ff5c8a" },
  { gift: "Finger Heart", diamonds: 5, icon: "heart", color: "#ff758f" },
  { gift: "Perfume", diamonds: 20, icon: "perfume", color: "#c084fc" },
  { gift: "Doughnut", diamonds: 30, icon: "doughnut", color: "#f59e0b" },
  { gift: "Paper Crane", diamonds: 99, icon: "star", color: "#38bdf8" },
  { gift: "Confetti", diamonds: 100, icon: "confetti", color: "#fbbf24" },
  { gift: "Hand Hearts", diamonds: 100, icon: "heart", color: "#f43f5e" },
  { gift: "Sunglasses", diamonds: 199, icon: "glasses", color: "#22d3ee" },
  { gift: "Panda", diamonds: 100, icon: "panda", color: "#64748b" },
  { gift: "Corgi", diamonds: 299, icon: "corgi", color: "#fb923c" },
  { gift: "Money Gun", diamonds: 500, icon: "cash", color: "#22c55e" },
  { gift: "Swan", diamonds: 699, icon: "swan", color: "#93c5fd" },
  { gift: "Galaxy", diamonds: 1000, icon: "galaxy", color: "#8b5cf6" },
  { gift: "Whale Diving", diamonds: 2150, icon: "whale", color: "#0ea5e9" },
  { gift: "Lion", diamonds: 29999, icon: "crown", color: "#eab308" },
  { gift: "Universe", diamonds: 44999, icon: "galaxy", color: "#a855f7" },
];

export const GALLERY_GIFT_NAMES = GALLERY_CATALOG.map((g) => g.gift);

const CATALOG_BY_KEY = new Map(GALLERY_CATALOG.map((g) => [normalizeGiftKey(g.gift), g]));

export function normalizeGiftKey(name) {
  return String(name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Finds a gift's default diamond cost, icon id, and accent color from the built-in TikTok catalog. */
export function catalogGift(name) {
  return CATALOG_BY_KEY.get(normalizeGiftKey(name)) ?? { gift: String(name ?? "").trim() || "Gift", diamonds: 0, icon: "gift", color: "#ff5c8a" };
}

export const GALLERY_PRESETS = [
  {
    id: "classic",
    name: "TikTok Gallery",
    items: [
      { gift: "Rose", diamonds: 1, caption: "" },
      { gift: "Heart Me", diamonds: 1, caption: "" },
      { gift: "Doughnut", diamonds: 30, caption: "" },
      { gift: "Confetti", diamonds: 100, caption: "" },
      { gift: "Corgi", diamonds: 299, caption: "" },
      { gift: "Galaxy", diamonds: 1000, caption: "" },
    ],
  },
  {
    id: "vtuber",
    name: "VTuber Rewards",
    items: [
      { gift: "Rose", diamonds: 1, caption: "Thank you shoutout" },
      { gift: "Doughnut", diamonds: 30, caption: "Spin the wheel" },
      { gift: "Confetti", diamonds: 100, caption: "Sticky note on face" },
      { gift: "Corgi", diamonds: 299, caption: "Avatar zoom-in" },
      { gift: "Galaxy", diamonds: 1000, caption: "Slow-mo replay" },
      { gift: "Lion", diamonds: 29999, caption: "VIP crown" },
    ],
  },
  {
    id: "hunt",
    name: "Big Gift Hunt",
    items: [
      { gift: "Perfume", diamonds: 20, caption: "" },
      { gift: "Hand Hearts", diamonds: 100, caption: "" },
      { gift: "Money Gun", diamonds: 500, caption: "" },
      { gift: "Galaxy", diamonds: 1000, caption: "" },
      { gift: "Whale Diving", diamonds: 2150, caption: "" },
      { gift: "Universe", diamonds: 44999, caption: "" },
    ],
  },
];

export const DEFAULT_GALLERY_ITEMS = GALLERY_PRESETS[0].items;

export const GALLERY_LAYOUTS = [
  ["showcase", "Showcase: spotlight pedestal card"],
  ["card", "Card: bold highlight box"],
  ["glass", "Glass: frosted translucent card"],
  ["neon", "Neon: glowing dark sign"],
  ["kawaii", "Kawaii: playful sticker border"],
  ["pill", "Pill: compact horizontal capsule"],
  ["minimal", "Minimal: floating icon & text"],
];

const cleanStr = (v, max = 40) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);

/** Normalizes one custom gallery gift slot. */
export function sanitizeGalleryItem(raw) {
  const item = raw && typeof raw === "object" ? raw : {};
  const gift = cleanStr(item.gift ?? item.name ?? "", 36);
  if (!gift) return null;
  const cat = CATALOG_BY_KEY.get(normalizeGiftKey(gift));
  const rawDiamonds = item.diamonds === "" || item.diamonds == null ? (cat?.diamonds ?? 0) : Number(item.diamonds);
  const diamonds = Number.isFinite(rawDiamonds) && rawDiamonds >= 0 ? Math.min(1000000, Math.round(rawDiamonds)) : (cat?.diamonds ?? 0);
  const caption = cleanStr(item.caption ?? "", 44);
  return { gift, diamonds, caption };
}

/** Normalizes an array of gallery slots (deduplicating gift names case-insensitively, capped at 16). */
export function sanitizeGalleryItems(raw, { allowEmpty = false } = {}) {
  if (!Array.isArray(raw)) return allowEmpty ? [] : DEFAULT_GALLERY_ITEMS.map((i) => ({ ...i }));
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const clean = sanitizeGalleryItem(entry);
    if (!clean) continue;
    const key = normalizeGiftKey(clean.gift);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= MAX_GALLERY_ITEMS) break;
  }
  return out.length || allowEmpty ? out : DEFAULT_GALLERY_ITEMS.map((i) => ({ ...i }));
}

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(encoded) {
  const norm = String(encoded ?? "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 ? "=".repeat(4 - (norm.length % 4)) : "";
  const bin = atob(norm + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Encodes custom gallery items compactly as URL-safe base64url JSON. */
export function encodeGalleryItems(items) {
  const clean = sanitizeGalleryItems(items);
  return toBase64Url(JSON.stringify(clean.map((i) => (i.caption ? [i.gift, i.diamonds, i.caption] : [i.gift, i.diamonds]))));
}

/** Decodes URL-safe base64url (or raw JSON) gallery items safely, falling back to `DEFAULT_GALLERY_ITEMS`. */
export function decodeGalleryItems(raw) {
  if (Array.isArray(raw)) return sanitizeGalleryItems(raw);
  const str = String(raw ?? "").trim();
  if (!str) return sanitizeGalleryItems(DEFAULT_GALLERY_ITEMS);
  try {
    const json = str.startsWith("[") ? str : fromBase64Url(str);
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return sanitizeGalleryItems(DEFAULT_GALLERY_ITEMS);
    const expanded = parsed.map((entry) => (Array.isArray(entry)
      ? { gift: entry[0], diamonds: entry[1], caption: entry[2] ?? "" }
      : entry));
    return sanitizeGalleryItems(expanded);
  } catch {
    return sanitizeGalleryItems(DEFAULT_GALLERY_ITEMS);
  }
}

export const DEFAULT_GALLERY_ENCODED = encodeGalleryItems(DEFAULT_GALLERY_ITEMS);

export const GALLERY = defineWidget({
  defaults: {
    mode: "custom",
    layout: "showcase",
    enter: "pop",
    anim: "shine",
    rotateSec: 5,
    title: "Gift Gallery",
    showProgress: true,
    showDiamonds: true,
    showSender: true,
    showCount: true,
    showDots: true,
    jumpOnGift: true,
    keep: false,
    items: DEFAULT_GALLERY_ENCODED,
  },
  controls: [
    { section: "gallery", ...chipsOf("mode", "Gallery mode", [["custom", "Custom gallery list"], ["live", "Auto-collect live gifts"]]) },
    { section: "gallery", ...selectOf("layout", "Gallery design", GALLERY_LAYOUTS) },
    { section: "gallery", ...chipsOf("enter", "Transition", [["pop", "Pop"], ["slide", "Slide"], ["bounce", "Bounce"], ["flip", "3D Flip"], ["fade", "Fade"]]) },
    { section: "gallery", ...chipsOf("anim", "Card animation", [["shine", "Shine & float"], ["pulse", "Spotlight glow"], ["float", "Gentle float"], ["none", "Still"]]) },
    { section: "gallery", ...range("rotateSec", "Rotate every", 3, 30, 1, " s") },
    { section: "gallery", ...text("title", "Header label (blank = hidden)", 32) },
    { section: "gallery", ...toggle("showProgress", "Show gallery progress count") },
    { section: "gallery", ...toggle("showDiamonds", "Show diamond value") },
    { section: "gallery", ...toggle("showSender", "Show who lit up each gift") },
    { section: "gallery", ...toggle("showCount", "Show how many times it was sent") },
    { section: "gallery", ...toggle("showDots", "Show slide dots") },
    { section: "gallery", ...toggle("jumpOnGift", "Jump to a gift immediately when sent") },
    { section: "gallery", ...toggle("keep", "Remember lit-up gifts if the page reloads", "Kept only in this browser or streaming app. Off starts fresh each load.") },
    { section: "gallery", ...text("items", "Gallery items payload", 4000), hidden: true },
  ],
});

/**
 * Tracks a TikTok LIVE Gift Gallery (custom gift checklist/menu or live auto-collected gifts),
 * rotating smoothly through each gift slide and celebrating live when a viewer lights up a gift.
 */
export class GiftGallery {
  constructor(settings, { onChange, timers = globalThis, initial = null } = {}) {
    this.settings = { ...settings };
    this._mode = this.settings.mode;
    this._itemsRaw = this.settings.items;
    this.onChange = onChange ?? (() => {});
    this.timers = timers;
    this.timer = 0;
    this.index = 0;
    this.revision = 0;
    this.celebrateId = 0;
    this.celebrateKind = "";
    this.customItems = decodeGalleryItems(this.settings.items);

    /** Map<normalizedGiftKey, { gift, diamonds, picture, count, totalDiamonds, firstSender, firstAvatar, lastSender, lastAvatar, unlockedAt }> */
    this.received = new Map();
    if (Array.isArray(initial?.received)) {
      for (const rec of initial.received.slice(0, 100)) {
        const key = normalizeGiftKey(rec?.gift);
        if (!key) continue;
        this.received.set(key, {
          gift: cleanStr(rec.gift, 36),
          diamonds: Math.max(0, Math.round(Number(rec.diamonds) || 0)),
          picture: typeof rec.picture === "string" ? rec.picture : "",
          count: Math.max(1, Math.round(Number(rec.count) || 1)),
          totalDiamonds: Math.max(0, Math.round(Number(rec.totalDiamonds) || 0)),
          firstSender: cleanStr(rec.firstSender || rec.lastSender || "", 40),
          firstAvatar: typeof rec.firstAvatar === "string" ? rec.firstAvatar : "",
          lastSender: cleanStr(rec.lastSender || rec.firstSender || "", 40),
          lastAvatar: typeof rec.lastAvatar === "string" ? rec.lastAvatar : "",
          unlockedAt: Number(rec.unlockedAt) || 0,
        });
      }
    }

    this.schedule();
  }

  /** Builds the active list of gallery slides for the current mode. */
  cards() {
    if (this.settings.mode === "live") {
      const out = [];
      for (const [key, rec] of this.received.entries()) {
        const cat = catalogGift(rec.gift);
        out.push({
          id: `live:${key}`,
          key,
          gift: rec.gift,
          diamonds: rec.diamonds || cat.diamonds,
          caption: "",
          icon: cat.icon,
          color: cat.color,
          picture: rec.picture || "",
          unlocked: true,
          count: rec.count,
          totalDiamonds: rec.totalDiamonds,
          sender: rec.firstSender || rec.lastSender,
          senderAvatar: rec.firstAvatar || rec.lastAvatar,
          lastSender: rec.lastSender,
        });
      }
      return out;
    }

    return this.customItems.map((slot) => {
      const key = normalizeGiftKey(slot.gift);
      const cat = catalogGift(slot.gift);
      const rec = this.received.get(key);
      return {
        id: `custom:${key}`,
        key,
        gift: slot.gift,
        diamonds: slot.diamonds > 0 ? slot.diamonds : (rec?.diamonds || cat.diamonds),
        caption: slot.caption || "",
        icon: cat.icon,
        color: cat.color,
        picture: rec?.picture || "",
        unlocked: Boolean(rec),
        count: rec?.count || 0,
        totalDiamonds: rec?.totalDiamonds || 0,
        sender: rec?.firstSender || "",
        senderAvatar: rec?.firstAvatar || "",
        lastSender: rec?.lastSender || "",
      };
    });
  }

  snapshot() {
    const cards = this.cards();
    const unlockedCount = cards.filter((c) => c.unlocked).length;
    if (!cards.length) {
      return {
        card: {
          id: "idle",
          empty: true,
          gift: "Gift Gallery",
          diamonds: 0,
          caption: "Send any gift to light up the gallery!",
          icon: "gift",
          color: "#ff5c8a",
          picture: "",
          unlocked: false,
          count: 0,
          totalDiamonds: 0,
          sender: "",
          senderAvatar: "",
          lastSender: "",
        },
        cards: [],
        count: 0,
        index: 0,
        unlockedCount: 0,
        totalSlots: 0,
        revision: this.revision,
        celebrateId: this.celebrateId,
        celebrateKind: this.celebrateKind,
      };
    }
    const index = ((this.index % cards.length) + cards.length) % cards.length;
    return {
      card: cards[index],
      cards,
      count: cards.length,
      index,
      unlockedCount,
      totalSlots: cards.length,
      revision: this.revision,
      celebrateId: this.celebrateId,
      celebrateKind: this.celebrateKind,
    };
  }

  emit() {
    this.onChange(this.snapshot());
  }

  schedule() {
    this.timers.clearTimeout(this.timer);
    const cards = this.cards();
    if (cards.length < 2) { this.timer = 0; return; }
    const ms = Math.max(3, Math.min(30, Number(this.settings.rotateSec) || 5)) * 1000;
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

  select(index) {
    const cards = this.cards();
    if (!cards.length || index < 0 || index >= cards.length) return false;
    this.index = index;
    this.revision += 1;
    this.emit();
    this.schedule();
    return true;
  }

  setSettings(settings) {
    const prevMode = this._mode;
    const prevItems = this._itemsRaw;
    this.settings = { ...settings };
    this._mode = this.settings.mode;
    this._itemsRaw = this.settings.items;
    if (this._itemsRaw !== prevItems) {
      this.customItems = decodeGalleryItems(this._itemsRaw);
    }
    const cards = this.cards();
    if (this._mode !== prevMode) {
      this.index = 0;
      this.revision += 1;
    } else {
      this.index = cards.length ? this.index % cards.length : 0;
    }
    this.emit();
    this.schedule();
  }

  /** Accepts a TikTok `gift` event from the relay or demo generator. Returns true if it updated the gallery. */
  add(event) {
    if (!event || event.kind !== "gift") return false;
    const gift = cleanStr(event.gift || "", 36);
    const name = cleanStr(event.name || event.user || "", 40);
    const key = normalizeGiftKey(gift);
    if (!key || !name) return false;

    const inCustom = this.customItems.some((item) => normalizeGiftKey(item.gift) === key);
    if (this.settings.mode === "custom" && !inCustom) return false;

    const count = Math.max(1, Math.round(Number(event.count) || 1));
    const diamonds = Math.max(0, Math.round(Number(event.diamonds) || 0));
    const total = Math.max(0, Math.round(Number(event.total) || diamonds * count));
    const prev = this.received.get(key);
    const firstUnlock = !prev;

    if (prev) {
      prev.count += count;
      prev.totalDiamonds += total;
      if (diamonds > 0 && !prev.diamonds) prev.diamonds = diamonds;
      if (event.picture) prev.picture = event.picture;
      prev.lastSender = name;
      if (event.avatar) prev.lastAvatar = event.avatar;
    } else {
      this.received.set(key, {
        gift,
        diamonds,
        picture: event.picture || "",
        count,
        totalDiamonds: total,
        firstSender: name,
        firstAvatar: event.avatar || "",
        lastSender: name,
        lastAvatar: event.avatar || "",
        unlockedAt: Date.now(),
      });
      if (this.received.size > 100) {
        const oldest = this.received.keys().next().value;
        if (oldest && !this.customItems.some((item) => normalizeGiftKey(item.gift) === oldest)) {
          this.received.delete(oldest);
        }
      }
    }

    const cards = this.cards();
    const targetIdx = cards.findIndex((c) => c.key === key);
    const activeBefore = cards[this.index % Math.max(1, cards.length)]?.key;
    const jumped = Boolean(this.settings.jumpOnGift && targetIdx >= 0);

    if (jumped) {
      this.index = targetIdx;
      if (activeBefore !== key) this.revision += 1;
      this.schedule();
    } else if (cards.length) {
      this.index = this.index % cards.length;
      if (!this.timer && cards.length >= 2) this.schedule();
    }

    this.celebrateId += 1;
    this.celebrateKind = firstUnlock ? "unlock" : "repeat";
    this.emit();
    return true;
  }

  /** Returns the next unlit gift slot (in custom mode) for editor testing, or the first slot if all are lit. */
  nextUnlitGift() {
    if (this.settings.mode === "custom" && this.customItems.length) {
      const unlit = this.customItems.find((i) => !this.received.has(normalizeGiftKey(i.gift)));
      return unlit ?? this.customItems[this.index % this.customItems.length];
    }
    const unlitCat = GALLERY_CATALOG.find((g) => !this.received.has(normalizeGiftKey(g.gift)));
    return unlitCat ?? GALLERY_CATALOG[0];
  }

  clear() {
    this.received.clear();
    this.index = 0;
    this.revision += 1;
    this.celebrateKind = "";
    this.emit();
    this.schedule();
  }

  serialize() {
    return {
      received: [...this.received.values()].slice(0, 100),
    };
  }
}

export const galleryKey = (channel) => `frills:gallery:tiktok:${channel}`;

export function loadGallery(storage, channel) {
  try {
    const saved = JSON.parse(storage.getItem(galleryKey(channel)) ?? "null");
    if (!saved || typeof saved !== "object" || !Array.isArray(saved.received)) return null;
    return {
      received: saved.received
        .filter((r) => r && typeof r.gift === "string" && Number.isFinite(r.count) && r.count > 0)
        .slice(0, 100),
    };
  } catch {
    return null;
  }
}

export function saveGallery(storage, channel, gallery) {
  try { storage.setItem(galleryKey(channel), JSON.stringify(gallery.serialize())); } catch { /* blocked */ }
}
