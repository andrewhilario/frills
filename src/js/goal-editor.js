// The Goals editor page (followers, gifts or likes).

import { GOAL, GOAL_TYPES, GoalState, goalAmount } from "./goal.js";
import { createGoalView } from "./widgets-view.js";
import { startWidgetEditor } from "./widget-editor.js";
import { createSounds } from "./sounds.js";

const sounds = createSounds();

let type = "follow"; // what the goal counts now: the editor asks the relay for that kind of event

/** The test buttons say what they add for this type. */
function labelTests(next) {
  const t = GOAL_TYPES[next] ?? GOAL_TYPES.follow;
  const say = (n) => `+${n.toLocaleString("en-US")} ${t.unit || (n === 1 ? "follower" : "followers")}`;
  const one = document.querySelector('[data-test="one"]');
  const ten = document.querySelector('[data-test="ten"]');
  if (one) one.textContent = say(t.small);
  if (ten) ten.textContent = say(t.big);
}

startWidgetEditor({
  widget: GOAL,
  storeKey: "frills:goal:editor:v1",
  overlayPath: "/overlay/goal/",
  events: () => [GOAL_TYPES[type].kind],
  idleHint: "Type your TikTok name, or frills_demo to get made-up events. The test buttons above work without connecting.",
  create(host, settings, ctx) {
    type = settings.type;
    labelTests(type);
    const view = createGoalView(host);
    const state = new GoalState(settings, {
      onChange: (snapshot) => view.update(snapshot),
      onReach: async () => {
        if (state.settings.celebrate) {
          sounds.play(state.settings.celebrateSound, { volume: 70, tier: 3 });
          await view.celebrate(state.settings.celebrateText);
        }
        state.raise();
      },
    });
    view.apply(settings);
    view.update(state.snapshot);
    return {
      apply(next) {
        const moved = next.type !== type;
        type = next.type;
        view.apply(next);
        state.setSettings(next);
        if (moved) { labelTests(type); ctx.restart(); } // it now waits for a different kind of event
      },
      onEvent: (event) => { const n = goalAmount(type, event); if (n) state.add(n); },
      onInfo: (info) => { if (info.followers && type === "follow" && state.settings.fromLive) state.setLive(info.followers); },
      // (the button is the click that lets the browser play sound)
      tests: {
        one: async () => { await sounds.unlock(); state.add(GOAL_TYPES[type].small); },
        ten: async () => { await sounds.unlock(); state.add(GOAL_TYPES[type].big); },
        reach: async () => { await sounds.unlock(); state.add(Math.max(1, state.goal - state.value)); },
        reset: () => state.reset(),
      },
    };
  },
});
