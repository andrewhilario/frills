// AI Talking Pet TTS widget settings, message-to-speech formatting, and sequential queue.
// Keeps formatting and queue pacing pure (no DOM or audio APIs here) so it tests cleanly in Node.

import { defineWidget, chipsOf, number, range, selectOf, text, toggle } from "./widget-settings.js";

export const VOICES = [
  ["nova", "Nova (warm female)"],
  ["shimmer", "Shimmer (bright female)"],
  ["alloy", "Alloy (balanced)"],
  ["echo", "Echo (calm male)"],
  ["onyx", "Onyx (deep male)"],
  ["fable", "Fable (British / expressive)"],
];

export const PET_OPTIONS = [
  ["frog2", "Frog"],
  ["neko", "Cat"],
  ["bunny", "Bunny"],
  ["hamster", "Hamster"],
  ["none", "No pet"],
];

export const TTS = defineWidget({
  defaults: {
    engine: "auto",
    voice: "nova",
    browserVoice: "",
    pet: "frog2",
    trigger: "both",
    command: "!say",
    minDiamonds: 5,
    announceGift: true,
    readUser: true,
    rate: 100,
    volume: 90,
    cooldownSec: 8,
    maxChars: 140,
    showBubble: true,
    passToken: "",
    code: "",
  },
  controls: [
    { section: "voice", ...chipsOf("engine", "Voice mode", [["auto", "Auto (AI + free fallback)"], ["browser", "Browser voice (free)"], ["ai", "Pro AI voice only"]]) },
    { section: "voice", ...selectOf("voice", "Voice style / AI voice", VOICES, "Maps across AI providers (OpenAI, Google, Groq) and distinct browser personas.") },
    { section: "voice", ...text("browserVoice", "Browser voice filter", 64, "Auto-matches your voice style, or pick/type any installed Windows/Edge voice name.") },
    { section: "voice", ...range("rate", "Voice speed", 70, 150, 5, "%") },
    { section: "voice", ...range("volume", "Volume", 10, 100, 5, "%") },
    { section: "pet", ...chipsOf("pet", "Talking pet", PET_OPTIONS) },
    { section: "pet", ...toggle("showBubble", "Show speech bubble on stream", "Turn off for voice-only mode.") },
    { section: "rules", ...chipsOf("trigger", "When it speaks", [["gift", "Gifts only"], ["cmd", "Chat command"], ["both", "Gifts + command"], ["all_chat", "Every chat message"]]) },
    { section: "rules", ...text("command", "Chat command", 20, "Viewers type this first, e.g. !say hello.") },
    { section: "rules", ...number("minDiamonds", "Smallest gift to read (diamonds)", 0, 50000, { hint: "0 reads every gift including 1-coin Roses." }) },
    { section: "rules", ...toggle("announceGift", "Read out gift thank-yous") },
    { section: "rules", ...toggle("readUser", "Say viewer name before message") },
    { section: "rules", ...number("cooldownSec", "Per-viewer cooldown (seconds)", 0, 120) },
    { section: "rules", ...range("maxChars", "Max spoken characters", 40, 220, 10, "") },
    { section: "pro", ...text("passToken", "Pro Pass key", 128, "Leave blank when testing locally on your own computer.") },
    { section: "pro", ...text("code", "Frills Plus link code", 32), hidden: true }, // filled in by the Plus link panel: it rides in the overlay link and stands for the account (never the payment)
  ],
});

const cleanName = (raw) =>
  String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 36);

/** Strips links, control characters, and repeated spam punctuation, keeping spoken text natural and bounded. */
export function cleanSpeechText(raw, maxChars = 140) {
  const cap = Math.max(10, Math.min(220, Math.round(Number(maxChars) || 140)));
  const cleaned = String(raw ?? "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/([!?.,])\1{2,}/g, "$1$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  if (cleaned.length <= cap) return cleaned;
  return cleaned.slice(0, cap).trim();
}

/**
 * Turns a TikTok gift alert or chat message into a speech item according to the streamer's rules.
 * Returns `{ kind, userKey, author, badge, text, message }` or `null` if it should not speak.
 */
export function ttsSpeechFor(input, settings) {
  if (!input || typeof input !== "object") return null;
  const cfg = settings || TTS.defaults;

  if (input.kind === "gift") {
    if (!cfg.announceGift) return null;
    if (cfg.trigger !== "gift" && cfg.trigger !== "both") return null;
    const count = Math.max(1, Math.round(Number(input.count)) || 1);
    const diamonds = Math.max(0, Number(input.total) || (Number(input.diamonds) || 0) * count);
    if (diamonds < (Number(cfg.minDiamonds) || 0)) return null;

    const author = cleanName(input.name || input.user || "Someone") || "Someone";
    const gift = cleanName(input.gift || "a gift") || "a gift";
    const badge = count > 1 ? `${count}x ${gift}` : gift;
    const line = cfg.readUser
      ? count > 1 ? `${author} sent ${count} ${gift}!` : `${author} sent ${gift}!`
      : count > 1 ? `${count} ${gift}!` : `${gift}!`;
    const userKey = cleanName(input.user || author).toLowerCase() || "gift";
    return { kind: "gift", userKey, author, badge, text: line.slice(0, 220), message: badge };
  }

  if (input.kind && input.kind !== "chat") return null;
  if (typeof input.text !== "string") return null;
  if (cfg.trigger === "gift") return null;

  let rawText = input.text.trim();
  if (!rawText) return null;

  if (cfg.trigger === "cmd" || cfg.trigger === "both") {
    const prefix = String(cfg.command || "!say").trim().toLowerCase() || "!say";
    const lower = rawText.toLowerCase();
    if (!lower.startsWith(prefix)) return null;
    const after = rawText.slice(prefix.length);
    if (!after || !/^\s/.test(after)) return null;
    rawText = after.trim();
  }

  const message = cleanSpeechText(rawText, cfg.maxChars);
  if (!message) return null;

  const author = cleanName(input.name || input.user || "Viewer") || "Viewer";
  const userKey = cleanName(input.user || author).toLowerCase() || "viewer";
  const fullText = cfg.readUser ? `${author} says: ${message}` : message;
  return {
    kind: "chat",
    userKey,
    author,
    badge: "chat",
    text: fullText.slice(0, 220),
    message,
  };
}

/** Sequential speech queue with per-viewer cooldown, backlog cap, and clean cancellation. */
export class TtsQueue {
  constructor(settings, { speak, onStart, onIdle, now = Date.now, maxQueue = 6, gapMs = 300 } = {}) {
    this.settings = settings || TTS.defaults;
    this.speak = speak ?? (async () => {});
    this.onStart = onStart ?? (() => {});
    this.onIdle = onIdle ?? (() => {});
    this.now = now;
    this.maxQueue = maxQueue;
    this.gapMs = gapMs;
    this.pending = [];
    this.busy = false;
    this.lastByUser = new Map();
    this.epoch = 0;
  }

  setSettings(next) {
    this.settings = next || this.settings;
  }

  enqueue(item, { bypassCooldown = false } = {}) {
    if (!item || !item.text) return false;
    const t = this.now();
    const cooldownMs = Math.max(0, (Number(this.settings.cooldownSec) || 0) * 1000);
    if (!bypassCooldown && cooldownMs > 0) {
      const prev = this.lastByUser.get(item.userKey);
      if (prev !== undefined && t - prev < cooldownMs) return false;
    }
    if (this.pending.length >= this.maxQueue) return false;
    this.lastByUser.set(item.userKey, t);
    this.pending.push(item);
    void this.#drain();
    return true;
  }

  clear() {
    this.epoch += 1;
    this.pending.length = 0;
    this.busy = false;
    this.onIdle();
  }

  async #drain() {
    if (this.busy) return;
    this.busy = true;
    const runEpoch = this.epoch;
    try {
      while (this.pending.length > 0 && runEpoch === this.epoch) {
        const next = this.pending.shift();
        this.onStart(next);
        try {
          await this.speak(next, this.settings);
        } catch {
          /* Never stall queue on a single utterance failure */
        }
        if (runEpoch !== this.epoch) break;
        if (this.pending.length > 0 && this.gapMs > 0) {
          await new Promise((r) => setTimeout(r, this.gapMs));
        }
      }
    } finally {
      if (runEpoch === this.epoch) {
        this.busy = false;
        this.onIdle();
      }
    }
  }
}
