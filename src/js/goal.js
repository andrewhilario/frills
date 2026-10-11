// The Follower Goal: the settings, and the counting. Followers are counted from what the relay sends (each follow is +1), added to a
// number the streamer types for "followers now", because TikTok's own total is not something we can rely on.

import { defineWidget, number, text, toggle } from "./widget-settings.js";

export const GOAL = defineWidget({
  defaults: { label: "Follower goal", start: 0, target: 100, step: 25, showNumbers: true, showPercent: false, celebrate: true, celebrateText: "Goal reached! Thank you!", keep: false },
  controls: [
    { section: "goal", ...text("label", "Label", 40) },
    { section: "goal", ...number("start", "Followers now", 0, 100000000, { hint: "The bar starts from this and adds each new follower it sees." }) },
    { section: "goal", ...number("target", "Goal", 1, 100000000) },
    { section: "goal", ...number("step", "After the goal, raise it by", 0, 1000000, { hint: "0 stops at the goal. Otherwise the next goal is this many more." }) },
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
    this.gained = Math.max(0, gained);
    this.goal = target ?? settings.target;
    this.onChange = onChange ?? (() => {});
    this.onReach = onReach ?? (() => {});
    this.reached = this.value >= this.goal; // a count restored past its goal does not celebrate again
    this.seenTarget = settings.target; // (the editor changes one settings object in place, so the goal it had is remembered here)
  }

  get value() { return this.settings.start + this.gained; }
  get percent() { return Math.min(100, Math.floor((this.value / this.goal) * 100)); }
  get snapshot() { return { value: this.value, goal: this.goal, percent: this.percent, gained: this.gained, reached: this.reached }; }

  /** The settings changed (the person is editing): keep the people counted, take the new start and goal. */
  setSettings(settings) {
    const goalMoved = settings.target !== this.seenTarget;
    this.settings = settings;
    this.seenTarget = settings.target;
    if (goalMoved) this.goal = settings.target;
    this.reached = this.value >= this.goal;
    this.onChange(this.snapshot);
  }

  /** One new follower, or `n`. */
  follow(n = 1) {
    this.gained += n;
    this.check();
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
    while (this.goal <= this.value) this.goal += step;
    this.reached = false;
    this.onChange(this.snapshot);
    return true;
  }

  reset() {
    this.gained = 0;
    this.goal = this.settings.target;
    this.reached = this.value >= this.goal;
    this.onChange(this.snapshot);
  }
}

/** Where a count is kept between page loads (only when the person turned that on), per account. */
export const goalKey = (channel) => `frills:goal:${channel}`;
export function loadGoal(storage, channel) {
  try {
    const saved = JSON.parse(storage.getItem(goalKey(channel)) ?? "null");
    return saved && Number.isFinite(saved.gained) && Number.isFinite(saved.goal) ? { gained: saved.gained, goal: saved.goal } : null;
  } catch {
    return null;
  }
}
export function saveGoal(storage, channel, state) {
  try { storage.setItem(goalKey(channel), JSON.stringify({ gained: state.gained, goal: state.goal })); } catch { /* storage can be blocked */ }
}
