// The subathon timer: the settings, how a gift (or a follow or a share) turns into seconds, and the clock. A countdown that the streamer starts,
// and that grows when viewers send gifts: each gift can add its own number of seconds. No page and no clock of its own (the time is given in),
// so it is tested without a browser.

import { defineWidget, chipsOf, number, text, toggle } from "./widget-settings.js";

export const TIMER = defineWidget({
  defaults: { startMinutes: 60, capMinutes: 0, revive: false, perDiamonds: 60, giftRules: "Rose=10, Finger Heart=30", followSeconds: 10, shareSeconds: 0, label: "Time left", showPlus: true, hours: "auto", autoStart: false, code: "" },
  controls: [
    { section: "time", ...number("startMinutes", "Starts at (minutes)", 1, 10080, { hint: "The clock starts here when you press Start." }) },
    { section: "time", ...number("capMinutes", "Longest it can get (minutes)", 0, 10080, { hint: "0 means no limit. Gifts cannot push the clock past this." }) },
    { section: "time", ...toggle("revive", "A gift after time is up starts it again") },
    { section: "time", ...toggle("autoStart", "Start by itself with the first gift", "Without this, you press Start in the editor.") },
    { section: "rules", ...number("perDiamonds", "Seconds for every 100 diamonds", 0, 100000, { hint: "For gifts that are not in the list below. 0 means other gifts add nothing." }) },
    { section: "rules", ...text("giftRules", "Gifts that add their own time", 600, "Name=seconds, separated by commas, for each of that gift: Rose=10, Galaxy=300.") },
    { section: "rules", ...number("followSeconds", "Seconds for a new follower", 0, 3600) },
    { section: "rules", ...number("shareSeconds", "Seconds for a share", 0, 3600) },
    { section: "words", ...text("label", "Words above the clock", 30, "Leave empty for none.") },
    { section: "words", ...chipsOf("hours", "Hours", [["auto", "Only when needed"], ["always", "Always (1:05:00)"]]) },
    { section: "words", ...toggle("showPlus", "Show “+30s” when time is added") },
    { section: "time", ...text("code", "Timer code", 16), hidden: true }, // filled in by itself: it joins the editor's buttons to the overlay in the streaming app
  ],
});

/** "Rose=10, Galaxy=300" -> a Map of lower-case gift name -> seconds per gift. Anything that is not "name=number" is skipped. */
export function parseGiftRules(textValue) {
  const rules = new Map();
  for (const part of String(textValue ?? "").split(/[,\n;]/)) {
    const at = part.lastIndexOf("=");
    if (at < 1) continue;
    const name = part.slice(0, at).trim().toLowerCase().replace(/\s+/g, " ");
    const seconds = Math.round(Number(part.slice(at + 1).trim()));
    if (name && Number.isFinite(seconds) && seconds >= 0 && seconds <= 86400) rules.set(name, seconds);
  }
  return rules;
}

/**
 * How many seconds an event adds, by the rules. A gift in the list adds its own seconds for each of it (a streak of 5 Roses adds 5 times); any other
 * gift adds its diamonds (the whole streak) at the rate for 100 diamonds; a follow and a share add their own number. Other events add nothing.
 */
export function secondsFor(event, settings) {
  if (!event) return 0;
  if (event.kind === "follow") return settings.followSeconds;
  if (event.kind === "share") return settings.shareSeconds;
  if (event.kind !== "gift") return 0;
  const named = parseGiftRules(settings.giftRules).get(String(event.gift ?? "").toLowerCase().replace(/\s+/g, " ").trim());
  if (named !== undefined) return named * Math.max(1, Math.round(Number(event.count)) || 1);
  const diamonds = Math.max(0, Number(event.total) || (Number(event.diamonds) || 0) * Math.max(1, Number(event.count) || 1));
  return Math.round((diamonds / 100) * settings.perDiamonds);
}

/** A time left, written for the clock: 4:05, or 1:04:05 once an hour or more is left (or always, when asked). */
export function formatClock(ms, hours = "auto") {
  const total = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n) => String(n).padStart(2, "0");
  return h > 0 || hours === "always" ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/**
 * The clock. `state()` is one of: "ready" (not started), "running", "paused", "ended". Time is given in (`now`, milliseconds), so a reload picks the
 * clock up from where it was: a running clock is kept as the moment it ends. `onEnd()` is told once when a running clock reaches zero.
 */
export class SubTimer {
  constructor(settings, { onEnd, onAdd } = {}) {
    this.settings = settings;
    this.onEnd = onEnd ?? (() => {});
    this.onAdd = onAdd ?? (() => {});
    this.running = false;
    this.endsAt = 0;
    this.left = settings.startMinutes * 60000; // while it is not running
    this.began = false; // started at least once
  }

  setSettings(settings) {
    // Until it has been started, the starting time follows the setting.
    if (!this.began) this.left = settings.startMinutes * 60000;
    this.settings = settings;
  }

  remaining(now) {
    return this.running ? Math.max(0, this.endsAt - now) : this.left;
  }

  state(now) {
    if (this.running) return this.endsAt > now ? "running" : "ended";
    if (!this.began) return "ready";
    return this.left <= 0 ? "ended" : "paused";
  }

  /** Call often: a running clock that has reached zero stops, and `onEnd` is told. */
  tick(now) {
    if (this.running && this.endsAt <= now) {
      this.running = false;
      this.left = 0;
      this.onEnd();
    }
  }

  start(now) {
    this.began = true;
    this.left = this.settings.startMinutes * 60000;
    this.running = true;
    this.endsAt = now + this.left;
  }

  pause(now) {
    this.tick(now);
    if (!this.running) return;
    this.left = this.remaining(now);
    this.running = false;
  }

  resume(now) {
    this.tick(now);
    if (this.running || this.left <= 0) return;
    this.began = true;
    this.running = true;
    this.endsAt = now + this.left;
  }

  reset(seconds = this.settings.startMinutes * 60) {
    this.running = false;
    this.began = false;
    this.left = Math.max(0, seconds) * 1000;
  }

  /** Adds (or takes away, with a negative number) seconds. Returns the seconds that really went on: time is never added after it is up unless allowed, nor past the limit. */
  add(seconds, now) {
    this.tick(now);
    const wasEnded = this.state(now) === "ended";
    if (wasEnded && !this.settings.revive && seconds > 0) return 0;
    const before = this.remaining(now);
    const cap = this.settings.capMinutes > 0 ? this.settings.capMinutes * 60000 : Infinity;
    const after = Math.max(0, Math.min(cap, before + seconds * 1000));
    if (after === before) return 0;
    if (this.running) this.endsAt = now + after;
    else if (wasEnded) {
      this.began = true;
      this.left = after;
      this.running = after > 0;
      this.endsAt = now + after;
    } else this.left = after;
    const added = Math.round((after - before) / 1000);
    this.onAdd(added);
    return added;
  }

  /** A gift, follow or share from the relay. Returns the seconds it added (0 for nothing). With "start by itself", the first one that adds time starts the clock. */
  handle(event, now) {
    const seconds = secondsFor(event, this.settings);
    if (seconds <= 0) return 0;
    if (!this.began && this.settings.autoStart) this.start(now);
    return this.add(seconds, now);
  }

  /** A command from the editor: { cmd, value (seconds) }. */
  command({ cmd, value }, now) {
    if (cmd === "start") this.start(now);
    else if (cmd === "pause") this.pause(now);
    else if (cmd === "resume") this.resume(now);
    else if (cmd === "reset") this.reset(value > 0 ? value : undefined);
    else if (cmd === "add") this.add(Number(value) || 0, now);
  }

  /** What is kept in the browser so a reload carries on. */
  save() {
    return { running: this.running, endsAt: this.endsAt, left: this.left, began: this.began };
  }

  restore(saved) {
    if (!saved || typeof saved !== "object") return;
    const n = (v, max) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Number(v))) : 0);
    this.running = saved.running === true;
    this.began = saved.began === true || this.running;
    this.endsAt = n(saved.endsAt, 8.64e15);
    this.left = n(saved.left, 7 * 86400000 * 4);
  }
}
