// The Follower Goal overlay: what a streaming app opens. A see-through page with one progress bar.
//   /overlay/goal/?channel=yourname&platform=tiktok&type=follow&target=150&step=25      your account (type: follow, gift or like)
//   add &demo=1 to see practice events instead of a real account

import { GOAL, GOAL_TYPES, GoalState, goalAmount, loadGoal, saveGoal } from "./goal.js";
import { createGoalView } from "./widgets-view.js";
import { channelFromParams, connectEvents } from "./widget-overlay.js";
import { fontsReady, generalFaces } from "./look.js";

const params = new URLSearchParams(location.search);
const settings = GOAL.sanitize(GOAL.fromParams(params));
// ?pace=1500 makes the practice (demo) events come about that many milliseconds apart: handy for trying a look, or for filming it
const demoPace = Number(params.get("pace")) ? Math.min(10000, Math.max(300, Number(params.get("pace")))) : 0; // (no pace, or not a number: the usual speed)

const note = document.getElementById("note");
const say = (text) => { note.hidden = !text; note.textContent = text; };
const channel = channelFromParams(params);
const demo = params.get("demo") === "1";

const view = createGoalView(document.getElementById("goal"));
view.apply(settings);
const remembered = settings.keep && channel ? loadGoal(globalThis.localStorage, channel, settings.type) : null;
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
    const type = GOAL_TYPES[settings.type] ?? GOAL_TYPES.follow;
    const send = () => { state.add(Math.max(1, Math.round(type.small * (1 + Math.random() * 2)))); setTimeout(send, demoPace ? demoPace * (0.6 + Math.random() * 0.8) : 1800 + Math.random() * 2500); };
    send();
  });
} else if (!channel) {
  say("Add ?channel=yourname to this link.");
} else {
  const fonts = fontsReady(generalFaces(settings), 1000); // the connection starts at once; only drawing waits for the font
  connectEvents({
    channel,
    events: [GOAL_TYPES[settings.type].kind],
    onAlert: (event) => fonts.then(() => { const n = goalAmount(settings.type, event); if (n) state.add(n); }),
    // The account's real follower count: the bar starts from it instead of from the number typed in the editor.
    onInfo: (info) => { if (info.followers && settings.type === "follow" && settings.fromLive) fonts.then(() => state.setLive(info.followers)); },
    say,
  });
}
