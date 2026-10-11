// The Follower Goal overlay: what a streaming app opens. A see-through page with one progress bar.
//   /overlay/goal/?channel=yourname&platform=tiktok&start=120&target=150&step=25      your account
//   add &demo=1 to see practice followers instead of a real account

import { GOAL, GoalState, loadGoal, saveGoal } from "./goal.js";
import { createGoalView } from "./widgets-view.js";
import { channelFromParams, connectEvents } from "./widget-overlay.js";
import { fontsReady, generalFaces } from "./look.js";

const params = new URLSearchParams(location.search);
const settings = GOAL.sanitize(GOAL.fromParams(params));
const note = document.getElementById("note");
const say = (text) => { note.hidden = !text; note.textContent = text; };
const channel = channelFromParams(params);
const demo = params.get("demo") === "1";

const view = createGoalView(document.getElementById("goal"));
view.apply(settings);
const remembered = settings.keep && channel ? loadGoal(globalThis.localStorage, channel) : null;
const state = new GoalState(settings, {
  gained: remembered?.gained ?? 0,
  target: remembered?.goal,
  onChange: (snapshot) => {
    view.update(snapshot);
    if (settings.keep && channel) saveGoal(globalThis.localStorage, channel, state);
  },
  onReach: async () => {
    if (settings.celebrate) await view.celebrate(settings.celebrateText);
    state.raise();
  },
});
view.update(state.snapshot);

if (demo) {
  fontsReady(generalFaces(settings), 1000).then(() => {
    const send = () => { state.follow(1 + Math.floor(Math.random() * 3)); setTimeout(send, 1800 + Math.random() * 2500); };
    send();
  });
} else if (!channel) {
  say("Add ?channel=yourname to this link.");
} else {
  fontsReady(generalFaces(settings), 1000).then(() => connectEvents({ channel, events: ["follow"], onAlert: (event) => event.kind === "follow" && state.follow(), say }));
}
