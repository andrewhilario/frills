// Spin the Wheel (TikTok LIVE + Twitch): settings, slice list parsing, gift/bits/sub/meter triggers,
// spin queueing, URL serialization, and testable wheel state machine.

import { defineWidget, chipsOf, list, number, parseList, range, selectOf, text, toggle } from "./widget-settings.js";
import { SOUNDS } from "./alerts-settings.js";

/** Maximum queued consecutive spins so spam combos stay bounded. */
export const MAX_WHEEL_QUEUE = 5;

export const DEFAULT_SLICES = "10 Pushups, Sing a Chorus, VIP Shoutout, Sip Water, Chat Picks Next, Silly Voice 1m, Dance Break, Double Goal";

export const WHEEL_SLICE_PRESETS = [
  { id: "dares", name: "Dares", value: DEFAULT_SLICES },
  { id: "cozy", name: "Cozy", value: "Hydrate Break, Posture Check, Stretch 30s, Pick Next Song, Pet Cameo, Chat Q&A, VIP Shoutout, Tea Refill" },
  { id: "gaming", name: "Gaming", value: "Invert Aim 1m, No Sprint, Chat Picks Loadout, Drop Best Item, Whisper Only, Switch Weapon, 10 Pushups, Play Next Round" },
  { id: "yesno", name: "Yes / No", value: "YES!, NO!, YES!, NO!, Spin Again, Chat Decides" },
];

export const WHEEL_DESIGNS = [
  ["classic", "Arcade wheel: bold slices & rim bulbs"],
  ["crystal", "Crystal glass: frosted neon rim"],
  ["kawaii", "Kawaii pastel: candy stripes & star hub"],
];

export const WHEEL_TRIGGERS = [
  ["any", "Every qualifying gift, sub or cheer"],
  ["threshold", "Fill a spin meter (team goal)"],
];

export const WHEEL_IDLE_MODES = [
  ["show", "Always show wheel on screen"],
  ["active", "Show only while spinning"],
];

/** Splits comma- or newline-separated prizes/dares into 2..12 clean labels, falling back to defaults if < 2. */
export function parseSlices(raw) {
  const items = parseList(raw, { maxItems: 12, itemMax: 32 });
  if (items.length >= 2) return items;
  return parseList(DEFAULT_SLICES, { maxItems: 12, itemMax: 32 });
}

export const WHEEL = defineWidget({
  defaults: {
    design: "classic",
    slices: DEFAULT_SLICES,
    triggerBy: "any",
    minDiamonds: 10,
    giftName: "",
    minBits: 100,
    meterTarget: 100,
    spinSeconds: 5,
    holdSeconds: 5,
    idleMode: "show",
    title: true,
    titleText: "Spin the wheel!",
    showPrompt: true,
    tickSound: true,
    winSound: "fanfare",
  },
  controls: [
    { section: "wheel", ...selectOf("design", "Wheel design", WHEEL_DESIGNS) },
    {
      section: "wheel",
      ...list("slices", "Wheel slices", {
        max: 420,
        minItems: 2,
        maxItems: 12,
        itemMax: 32,
        itemLabel: "Slice",
        placeholder: "Prize or dare",
        addLabel: "+ Add slice",
        presets: WHEEL_SLICE_PRESETS,
        shuffle: true,
        minHint: "Fill in at least 2 slices so the wheel uses yours.",
        hint: "Pick a starter pack or edit 2 to 12 slices. Press Enter to add another, or paste a list.",
      }),
    },
    { section: "wheel", ...chipsOf("triggerBy", "How viewers trigger a spin", WHEEL_TRIGGERS) },
    { section: "wheel", ...number("minDiamonds", "Minimum TikTok gift diamonds (in qualifying mode)", 1, 1000000) },
    { section: "wheel", ...text("giftName", "Only spin for this TikTok gift name (optional)", 40, "Leave blank for any gift meeting the minimum diamonds, or type e.g. Rose or Galaxy.") },
    { section: "wheel", ...number("minBits", "Minimum Twitch bits (in qualifying mode)", 1, 1000000) },
    { section: "wheel", ...number("meterTarget", "Diamonds or bits needed per spin (in spin meter mode)", 5, 1000000) },
    { section: "wheel", ...range("spinSeconds", "Spin duration", 3, 10, 1, " s") },
    { section: "wheel", ...range("holdSeconds", "Winner banner time", 2, 12, 1, " s") },
    { section: "wheel", ...chipsOf("idleMode", "When not spinning", WHEEL_IDLE_MODES) },
    { section: "wheel", ...toggle("title", "Show a headline above the wheel") },
    { section: "wheel", ...text("titleText", "Headline", 40) },
    { section: "wheel", ...toggle("showPrompt", "Show how to spin below the wheel") },
    { section: "wheel", ...toggle("tickSound", "Play pointer tick clicks while spinning") },
    { section: "wheel", ...selectOf("winSound", "Winner sound", SOUNDS.map(({ id, name }) => [id, name])) },
  ],
});

let spinSeq = 0;

/** Evaluates an incoming TikTok or Twitch event against `settings` and returns spin triggers or meter contribution. */
export function wheelEventProgress(settings, event) {
  const none = { triggers: 0, meterDelta: 0, label: "", who: "" };
  if (!event) return none;

  const mode = settings.triggerBy || "any";
  const who = String(event.name || "Viewer").slice(0, 40);
  const wantGift = String(settings.giftName || "").trim().toLowerCase();

  if (event.kind === "gift") {
    const giftLabel = String(event.gift || "Gift").trim();
    if (wantGift && giftLabel.toLowerCase() !== wantGift) return none;
    const count = Math.max(1, Math.round(Number(event.count) || 1));
    const total = Math.max(0, Math.round(Number(event.total) || ((Number(event.diamonds) || 0) * count)));
    if (!(total > 0)) return none;
    const label = count > 1 ? `${count}× ${giftLabel}` : giftLabel;
    if (mode === "threshold") return { triggers: 0, meterDelta: total, label, who };
    const minD = Math.max(1, Math.round(Number(settings.minDiamonds) || 1));
    return total >= minD ? { triggers: 1, meterDelta: 0, label, who } : none;
  }

  if (event.kind === "bits") {
    const bits = Math.max(0, Math.round(Number(event.count) || 0));
    if (!(bits > 0)) return none;
    const label = `${bits.toLocaleString("en-US")} Bits`;
    if (mode === "threshold") return { triggers: 0, meterDelta: bits, label, who };
    const minB = Math.max(1, Math.round(Number(settings.minBits) || 1));
    return bits >= minB ? { triggers: 1, meterDelta: 0, label, who } : none;
  }

  if (event.kind === "sub") {
    if (mode === "threshold") return { triggers: 0, meterDelta: 500, label: "Twitch Sub", who };
    return { triggers: 1, meterDelta: 0, label: "Twitch Sub", who };
  }

  if (event.kind === "subgift") {
    const subs = Math.max(1, Math.round(Number(event.count) || 1));
    const label = subs > 1 ? `${subs} Gifted Subs` : "Gifted Sub";
    if (mode === "threshold") return { triggers: 0, meterDelta: subs * 500, label, who };
    return { triggers: 1, meterDelta: 0, label, who };
  }

  return none;
}

/**
 * Stateful prize wheel controller: manages slice list, spin meter accumulation, queued spins,
 * and `onSpinStart` / `onChange` lifecycle callbacks.
 */
export class PrizeWheel {
  constructor(settings, { onChange, onSpinStart, rng = Math.random } = {}) {
    this.settings = settings;
    this.slices = parseSlices(settings.slices);
    this.meter = 0;
    this.queue = [];
    this.spinning = false;
    this.activeSpin = null;
    this.winner = null;
    this.totalSpins = 0;
    this.rng = rng;
    this.onChange = onChange ?? (() => {});
    this.onSpinStart = onSpinStart ?? (() => {});
  }

  get snapshot() {
    const target = Math.max(5, Math.round(Number(this.settings.meterTarget) || 100));
    return {
      slices: this.slices,
      triggerBy: this.settings.triggerBy || "any",
      meter: this.meter,
      meterTarget: target,
      meterPercent: Math.min(100, Math.floor((this.meter / target) * 100)),
      queued: this.queue.length,
      spinning: this.spinning,
      activeSpin: this.activeSpin,
      winner: this.winner,
      totalSpins: this.totalSpins,
    };
  }

  setSettings(next) {
    this.settings = next;
    this.slices = parseSlices(next.slices);
    this.onChange(this.snapshot);
  }

  /** Accepts an incoming stream event; returns true if it queued a spin or advanced the meter. */
  add(event) {
    const res = wheelEventProgress(this.settings, event);
    if (!res.triggers && !res.meterDelta) return false;

    if (res.meterDelta > 0) {
      const target = Math.max(5, Math.round(Number(this.settings.meterTarget) || 100));
      this.meter += res.meterDelta;
      while (this.meter >= target) {
        this.meter -= target;
        this._enqueue({ who: res.who, label: res.label });
      }
      this.onChange(this.snapshot);
      this._pump();
      return true;
    }

    for (let i = 0; i < res.triggers; i++) {
      this._enqueue({ who: res.who, label: res.label });
    }
    this.onChange(this.snapshot);
    this._pump();
    return true;
  }

  /** Enqueues an immediate spin (manual/test button or remote Phone Stream Deck action). */
  spin({ who = "Streamer", label = "Manual Spin", index } = {}) {
    const entry = this._enqueue({ who, label, index });
    this.onChange(this.snapshot);
    this._pump();
    return entry;
  }

  _enqueue({ who = "Streamer", label = "Spin", index } = {}) {
    const totalNeeded = (this.spinning ? 1 : 0) + this.queue.length;
    if (totalNeeded >= MAX_WHEEL_QUEUE + 1) return null;
    const len = this.slices.length;
    const idx = Number.isInteger(index) && index >= 0 && index < len
      ? index
      : Math.floor(Math.max(0, Math.min(0.999999, this.rng())) * len);
    const entry = {
      uid: `spin-${++spinSeq}`,
      index: idx,
      slice: this.slices[idx],
      who: String(who || "Viewer").slice(0, 40),
      label: String(label || "Spin").slice(0, 48),
    };
    this.queue.push(entry);
    return entry;
  }

  _pump() {
    if (this.spinning || !this.queue.length) return;
    const next = this.queue.shift();
    this.spinning = true;
    this.activeSpin = next;
    this.totalSpins += 1;
    this.onChange(this.snapshot);
    this.onSpinStart(next);
  }

  /** Marks the active spin animation/winner banner complete and launches any next queued spin. */
  finishSpin() {
    if (!this.spinning) return;
    this.winner = this.activeSpin;
    this.activeSpin = null;
    this.spinning = false;
    this.onChange(this.snapshot);
    this._pump();
  }

  clear() {
    this.meter = 0;
    this.queue = [];
    this.spinning = false;
    this.activeSpin = null;
    this.winner = null;
    this.onChange(this.snapshot);
  }
}
