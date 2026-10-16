// Goals: a bar that fills as something happens on your LIVE: followers, the diamonds of gifts, or likes. The settings, and the counting. What
// is counted comes from what the relay sends. For followers the bar can start from the account's real follower count, which the relay
// reads from TikTok when it connects; the number typed in the editor is used when it cannot.

import { defineWidget, number, selectOf, text, toggle } from "./widget-settings.js";

/** What a goal can count. `kind` is the relay event it listens for; `small` and `big` are what the editor's test buttons add. */
export const GOAL_TYPES = {
  follow: { name: "Followers", label: "Follower goal", kind: "follow", small: 1, big: 10, unit: "" },
  gift: { name: "Gifts (diamonds)", label: "Gift goal", kind: "gift", small: 100, big: 1000, unit: "diamonds" },
  like: { name: "Likes", label: "Like goal", kind: "like", small: 50, big: 500, unit: "likes" },
};

/** How much one relay event adds to a goal of this type (0 for an event it does not count). */
export function goalAmount(type, event) {
  const t = GOAL_TYPES[type];
  if (!t || event?.kind !== t.kind) return 0;
  if (t.kind === "follow") return 1;
  const n = Math.round(Number(t.kind === "gift" ? event.total : event.count));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export const GOAL = defineWidget({
  defaults: { type: "follow", label: "", start: 0, fromLive: true, target: 100, step: 25, showNumbers: true, showPercent: false, celebrate: true, celebrateText: "Goal reached! Thank you!", keep: false },
  controls: [
    { section: "goal", ...selectOf("type", "What the goal counts", Object.entries(GOAL_TYPES).map(([id, t]) => [id, t.name]), "Followers count each new follow. Gifts count diamonds, the way TikTok measures them. Likes count taps.") },
    { section: "goal", ...text("label", "Label", 40, "Leave it empty to use the name of the goal type.") },
    { section: "goal", ...number("start", "Starts at", 0, 100000000, { hint: "The bar starts from this and adds what it sees." }) },
    { section: "goal", ...toggle("fromLive", "Followers: start from the account's real count", "Read from TikTok when the overlay connects, so you do not have to type it. If it cannot be read, the number above is used.") },
    { section: "goal", ...number("target", "Goal", 1, 100000000) },
    { section: "goal", ...number("step", "When the goal is reached, raise it by", 0, 1000000, { hint: "The next goal is this many more, and it repeats every time you reach one. 0 stops at the goal and the bar stays full." }) },
    { section: "goal", ...toggle("showNumbers", "Show the numbers (37 / 50)") },
    { section: "goal", ...toggle("showPercent", "Show the percent") },
    { section: "goal", ...toggle("celebrate", "Celebrate when the goal is reached") },
    { section: "goal", ...text("celebrateText", "Celebration words", 60) },
    { section: "goal", ...toggle("keep", "Remember the count if the page reloads", "Kept only in this browser or streaming app. Off starts again each time the page loads.") },
  ],
});

/** The count and the goal. `onChange(state)` after each change, `onReach(state)` each time a goal is reached. */
export class GoalState {
  constructor(settings, { gained = 0, target, onChange, onReach } = {}) {
    this.settings = settings;
    this.liveStart = null; // the account's real count, when the relay told us (see setLive)
    this.seenType = settings.type;
    this.gained = Math.max(0, gained);
    this.goal = target ?? settings.target;
    this.onChange = onChange ?? (() => {});
    this.onReach = onReach ?? (() => {});
    this.seenTarget = settings.target; // (the editor changes one settings object in place, so the goal it had is remembered here)
    this.catchUp(); // a count restored past its goal does not celebrate again, and is not left stuck on it
  }

  get value() { return (this.liveStart ?? this.settings.start) + this.gained; }
  get percent() { return Math.min(100, Math.floor((this.value / this.goal) * 100)); }
  get snapshot() { return { value: this.value, goal: this.goal, percent: this.percent, gained: this.gained, reached: this.reached }; }

  /**
   * The count is already past the goal (it was restored, the real follower count arrived, or a smaller goal was typed): nobody just reached it, so
   * with a step the goal moves up to the next one quietly, with no celebration. With no step it stays and the bar is full.
   */
  catchUp() {
    const { step } = this.settings;
    if (step > 0 && this.goal <= this.value) this.goal += Math.ceil((this.value - this.goal + 1) / step) * step;
    this.reached = this.value >= this.goal;
  }

  /** The settings changed (the person is editing): keep the people counted, take the new start and goal. */
  setSettings(settings) {
    const goalMoved = settings.target !== this.seenTarget;
    const typeMoved = settings.type !== this.seenType;
    this.settings = settings;
    this.seenTarget = settings.target;
    this.seenType = settings.type;
    if (typeMoved) { this.gained = 0; this.liveStart = null; } // a different thing is counted now: start again
    if (goalMoved || typeMoved) this.goal = settings.target;
    this.catchUp();
    this.onChange(this.snapshot);
  }

  /** `n` more of what is counted (one follower, the diamonds of a gift, a number of likes). */
  add(n = 1) {
    this.gained += n;
    this.check();
    this.onChange(this.snapshot);
  }

  follow(n = 1) { this.add(n); }

  /**
   * The account's real follower count, from the relay. The bar starts from it. A goal the count is already past moves up by the step
   * without a celebration, because nobody just reached it.
   */
  setLive(followers) {
    this.liveStart = followers;
    this.gained = 0;
    this.catchUp();
    this.onChange(this.snapshot);
  }

  check() {
    if (this.value < this.goal || this.reached) return;
    this.reached = true;
    this.onReach(this.snapshot);
  }

  /** After a goal is reached and celebrated: the next one, if the person wants one. */
  raise() {
    const { step } = this.settings;
    if (step <= 0) return false;
    if (this.goal <= this.value) this.goal += Math.ceil((this.value - this.goal + 1) / step) * step;
    this.reached = false;
    this.onChange(this.snapshot);
    return true;
  }

  reset() {
    this.gained = 0;
    this.liveStart = null;
    this.goal = this.settings.target;
    this.catchUp();
    this.onChange(this.snapshot);
  }
}

/** Where a count is kept between page loads (only when the person turned that on), per account. */
export const goalKey = (channel, type = "follow") => (type === "follow" ? `frills:goal:${channel}` : `frills:goal:${channel}:${type}`);
export function loadGoal(storage, channel, type = "follow") {
  try {
    const saved = JSON.parse(storage.getItem(goalKey(channel, type)) ?? "null");
    return saved && Number.isFinite(saved.gained) && Number.isFinite(saved.goal) ? { gained: saved.gained, goal: saved.goal } : null;
  } catch {
    return null;
  }
}
export function saveGoal(storage, channel, state) {
  try { storage.setItem(goalKey(channel, state.settings.type), JSON.stringify({ gained: state.gained, goal: state.goal })); } catch { /* storage can be blocked */ }
}
