// Goals: a bar that fills as something happens on your LIVE: followers, the diamonds of gifts, or likes. The settings, and the counting. What
// is counted comes from what the relay sends. For followers the bar can start from the account's real follower count, which the relay
// reads from TikTok when it connects; the number typed in the editor is used when it cannot. For followers the goal can also set itself: the next round
// number above the real count (and the next one after that each time it is reached), so there is nothing to type.

import { SOUNDS } from "./alerts-settings.js";
import { chipsOf, defineWidget, number, selectOf, text, toggle } from "./widget-settings.js";

/** The designs of the bar. Each one is drawn by widgets.css from `data-style` on the goal. */
export const GOAL_STYLES = [
  { id: "bar", name: "Classic" },
  { id: "candy", name: "Candy stripes" },
  { id: "blocks", name: "Blocks" },
  { id: "hearts", name: "Hearts" },
  { id: "stars", name: "Stars" },
  { id: "neon", name: "Neon glow" },
  { id: "ring", name: "Ring" },
  { id: "line", name: "Thin line" },
];

/** What a goal can count. `kind` is the relay event it listens for; `small` and `big` are what the editor's test buttons add. */
export const GOAL_TYPES = {
  follow: { name: "Followers", label: "Follower goal", kind: "follow", small: 1, big: 10, unit: "" },
  gift: { name: "Gifts (diamonds)", label: "Gift goal", kind: "gift", small: 100, big: 1000, unit: "diamonds" },
  like: { name: "Likes", label: "Like goal", kind: "like", small: 50, big: 500, unit: "likes" },
  sub: { name: "Subscribers (Twitch)", label: "Sub goal", kind: "sub", small: 1, big: 5, unit: "subs" },
  bits: { name: "Bits (Twitch)", label: "Bit goal", kind: "bits", small: 100, big: 1000, unit: "bits" },
};

/** How much one relay or Twitch event adds to a goal of this type (0 for an event it does not count). */
export function goalAmount(type, event) {
  const t = GOAL_TYPES[type];
  if (!t || !event) return 0;
  if (type === "sub") {
    if (event.kind === "sub") return 1;
    if (event.kind === "subgift") {
      const n = Math.round(Number(event.count) || 1);
      return Number.isFinite(n) && n > 0 ? n : 1;
    }
    return 0;
  }
  if (type === "bits") {
    if (event.kind !== "bits") return 0;
    const n = Math.round(Number(event.count));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  if (event.kind !== t.kind) return 0;
  if (t.kind === "follow") return 1;
  const n = Math.round(Number(t.kind === "gift" ? event.total : event.count));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The next round number above `n`, for a goal that sets itself: the step grows with the size (10 up to 100, then 50, 100, 500, 1,000, 5,000 ...) and the goal is always the next multiple of it,
 * pushed one step further when it would be almost there already (under a tenth of a step away). 0 gives 10, 1,243 gives 1,500, 4,950 gives 5,000, 4,980 gives 5,500, 9,800 gives 10,000.
 */
export function niceGoal(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  const step = v < 100 ? 10 : v < 500 ? 50 : v < 1000 ? 100 : v < 5000 ? 500 : v < 10000 ? 1000 : v < 50000 ? 5000 : v < 100000 ? 10000 : v < 500000 ? 50000 : 100000;
  let goal = (Math.floor(v / step) + 1) * step;
  if (goal - v < step / 10) goal += step;
  return goal;
}

/** The goal sets itself: a follower goal with that switched on (it is the usual). */
export const isAuto = (settings) => settings?.type === "follow" && settings?.autoGoal === true;

/** Whether the bar starts from the account's real follower count (for the automatic goal, always; otherwise only if the person asked). */
export const usesLiveCount = (settings) => settings?.type === "follow" && (settings.autoGoal === true || settings.fromLive === true);

/** The moments on the way that get a cheer, as a percent of the goal, and what the cheer says. */
export const MOMENTS = { 25: "A quarter of the way!", 50: "Halfway there!", 75: "Almost there!" };

/** Which of those moments a change from `before` to `after` percent passed (none going backwards, none that were already behind). */
export function crossed(before, after) {
  return Object.keys(MOMENTS).map(Number).filter((m) => before < m && after >= m);
}

const GOAL_WIDGET = defineWidget({
  defaults: { type: "follow", barStyle: "bar", label: "", start: 0, fromLive: true, autoGoal: true, target: 100, step: 25, showNumbers: true, showPercent: false, toGo: true, reward: "", thanks: true, milestones: true, celebrate: true, celebrateSound: "none", celebrateText: "Goal reached! Thank you!", keep: false },
  controls: [
    { section: "goal", ...selectOf("type", "What the goal counts", Object.entries(GOAL_TYPES).map(([id, t]) => [id, t.name]), "Followers count each new follow. Gifts count diamonds, the way TikTok measures them. Likes count taps.") },
    { section: "goal", ...chipsOf("barStyle", "Bar design", GOAL_STYLES.map((s) => [s.id, s.name])) },
    { section: "goal", ...text("label", "Label", 40, "Leave it empty to use the name of the goal type.") },
    { section: "goal", ...toggle("autoGoal", "Followers: set the goal for me", "On: the bar starts from your real follower count, read from TikTok when the overlay connects, and the goal is the next round number above it (1,243 followers gives a goal of 1,500). When you reach it, the goal moves to the next round number. If TikTok's count cannot be read, it counts the followers it sees from the start. Off: you set the numbers below."), showWhen: (s) => s.type === "follow" },
    { section: "goal", ...number("start", "Starts at", 0, 100000000, { hint: "The bar starts from this and adds what it sees." }), showWhen: (s) => !isAuto(s) },
    { section: "goal", ...toggle("fromLive", "Followers: start from the account's real count", "Read from TikTok when the overlay connects, so you do not have to type it. If it cannot be read, the number above is used."), showWhen: (s) => s.type === "follow" && !s.autoGoal },
    { section: "goal", ...number("target", "Goal", 1, 100000000), showWhen: (s) => !isAuto(s) },
    { section: "goal", ...number("step", "When the goal is reached, raise it by", 0, 1000000, { hint: "The next goal is this many more, and it repeats every time you reach one. 0 stops at the goal and the bar stays full." }), showWhen: (s) => !isAuto(s) },
    { section: "goal", ...toggle("showNumbers", "Show the numbers (37 / 50)") },
    { section: "goal", ...toggle("showPercent", "Show the percent") },
    { section: "goal", ...toggle("toGo", "Show how many are left (53 to go)") },
    { section: "goal", ...text("reward", "What you get at the goal", 60, "For example: Karaoke night! It stays under the bar, so viewers know what they are helping to win. Leave it empty for none.") },
    { section: "goal", ...toggle("thanks", "Thank each person (+1 and their name)", "A little bubble with the name rises from the bar for every follow, gift or like.") },
    { section: "goal", ...toggle("milestones", "Cheer at 25%, 50% and 75%") },
    { section: "goal", ...toggle("celebrate", "Celebrate when the goal is reached") },
    { section: "goal", ...selectOf("celebrateSound", "Celebration sound", SOUNDS.map(({ id, name }) => [id, name]), "Played when the goal is reached, together with the celebration. No sound keeps it quiet. A streaming app may need to be allowed to play sound.") },
    { section: "goal", ...text("celebrateText", "Celebration words", 60) },
    { section: "goal", ...toggle("keep", "Remember the count if the page reloads", "Kept only in this browser or streaming app. Off starts again each time the page loads.") },
  ],
});

/** A link made before goals could set themselves has the numbers typed in it (a goal, a step, a start); it keeps them. Only a link with none of those, or one that says autoGoal=1, sets itself. */
const TYPED_BEFORE = ["target", "step", "start", "fromLive"];
const fromParams = (params) => {
  const raw = GOAL_WIDGET.fromParams(params);
  if (!params.has("autoGoal") && TYPED_BEFORE.some((key) => params.has(key))) raw.autoGoal = false;
  return raw;
};
/** For the link of a goal that sets itself, the numbers typed for the other way are left out (they would only confuse it), and it says autoGoal=1 only when it must. */
const toParams = (settings, params = new URLSearchParams()) => {
  GOAL_WIDGET.toParams(settings, params);
  if (isAuto(settings)) for (const key of TYPED_BEFORE) params.delete(key);
  return params;
};
const url = (overlayBase, { channel = "", settings = GOAL_WIDGET.defaults } = {}) => {
  const params = new URLSearchParams();
  if (channel) { params.set("channel", channel); params.set("platform", "tiktok"); }
  return overlayBase + "?" + toParams(settings, params);
};
export const GOAL = { ...GOAL_WIDGET, fromParams, toParams, url };

/**
 * The count and the goal. `onChange(state)` after each change, `onReach(state)` each time a goal is reached, and `onGain({ name, amount, milestones })` for each
 * thing that was added (who gave it, how much, and which cheering moments it passed on the way).
 */
export class GoalState {
  constructor(settings, { gained = 0, target, onChange, onReach, onGain } = {}) {
    this.settings = settings;
    this.liveStart = null; // the account's real count, when the relay told us (see setLive)
    this.liveSeen = false; // the first real count has set the automatic goal (later ones only move the bar)
    this.seenType = settings.type;
    this.seenAuto = isAuto(settings);
    this.gained = Math.max(0, gained);
    this.goal = target ?? (this.seenAuto ? niceGoal(this.gained) : settings.target);
    this.onChange = onChange ?? (() => {});
    this.onReach = onReach ?? (() => {});
    this.onGain = onGain ?? (() => {});
    this.seenTarget = settings.target; // (the editor changes one settings object in place, so the goal it had is remembered here)
    this.catchUp(); // a count restored past its goal does not celebrate again, and is not left stuck on it
  }

  get auto() { return isAuto(this.settings); }
  get value() { return (this.liveStart ?? (this.auto ? 0 : this.settings.start)) + this.gained; }
  get percent() { return Math.min(100, Math.floor((this.value / this.goal) * 100)); }
  get snapshot() { return { value: this.value, goal: this.goal, percent: this.percent, gained: this.gained, reached: this.reached }; }

  /**
   * The count is already past the goal (it was restored, the real follower count arrived, or a smaller goal was typed): nobody just reached it, so
   * with a step the goal moves up to the next one quietly, with no celebration. With no step it stays and the bar is full.
   */
  catchUp() {
    const { step } = this.settings;
    if (this.auto) { if (this.goal <= this.value) this.goal = niceGoal(this.value); } // (the next round number, whatever the typed step says)
    else if (step > 0 && this.goal <= this.value) this.goal += Math.ceil((this.value - this.goal + 1) / step) * step;
    this.reached = this.value >= this.goal;
  }

  /** The settings changed (the person is editing): keep the people counted, take the new start and goal. */
  setSettings(settings) {
    const goalMoved = settings.target !== this.seenTarget;
    const typeMoved = settings.type !== this.seenType;
    this.settings = settings;
    this.seenTarget = settings.target;
    this.seenType = settings.type;
    const autoMoved = isAuto(settings) !== this.seenAuto;
    this.seenAuto = isAuto(settings);
    if (typeMoved) { this.gained = 0; this.liveStart = null; this.liveSeen = false; } // a different thing is counted now: start again
    if (autoMoved) this.liveSeen = false;
    if (this.auto) { if (autoMoved || typeMoved) this.goal = niceGoal(this.value); } // (a goal that sets itself ignores the typed one)
    else if (goalMoved || typeMoved || autoMoved) this.goal = settings.target;
    this.catchUp();
    this.onChange(this.snapshot);
  }

  /** `n` more of what is counted (one follower, the diamonds of a gift, a number of likes), from `who` when it is known. */
  add(n = 1, who = "") {
    const before = this.percent;
    this.gained += n;
    this.check();
    this.onChange(this.snapshot);
    this.onGain({ name: who, amount: n, milestones: crossed(before, Math.min(99, this.percent)) }); // (reaching the goal itself is the celebration, not a moment)
  }

  follow(n = 1) { this.add(n); }

  /**
   * The account's real follower count, from the relay. The bar starts from it. A goal the count is already past moves up by the step
   * without a celebration, because nobody just reached it.
   */
  setLive(followers) {
    this.liveStart = followers;
    this.gained = 0;
    if (this.auto && !this.liveSeen) this.goal = niceGoal(this.value); // the first real count picks the goal; later ones (the count keeps coming) only move the bar
    this.liveSeen = true;
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
    if (this.auto) { if (this.goal <= this.value) this.goal = niceGoal(this.value); }
    else if (step <= 0) return false;
    else if (this.goal <= this.value) this.goal += Math.ceil((this.value - this.goal + 1) / step) * step;
    this.reached = false;
    this.onChange(this.snapshot);
    return true;
  }

  reset() {
    this.gained = 0;
    this.liveStart = null;
    this.liveSeen = false;
    this.goal = this.auto ? niceGoal(0) : this.settings.target;
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
