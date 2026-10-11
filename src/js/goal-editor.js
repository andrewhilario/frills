// The Follower Goal editor page.

import { GOAL, GoalState } from "./goal.js";
import { createGoalView } from "./widgets-view.js";
import { startWidgetEditor } from "./widget-editor.js";

startWidgetEditor({
  widget: GOAL,
  storeKey: "frills:goal:editor:v1",
  overlayPath: "/overlay/goal/",
  events: ["follow"],
  idleHint: "Type your TikTok name, or frills_demo to get made-up followers. The test buttons above work without connecting.",
  create(host, settings) {
    const view = createGoalView(host);
    const state = new GoalState(settings, {
      onChange: (snapshot) => view.update(snapshot),
      onReach: async () => {
        if (state.settings.celebrate) await view.celebrate(state.settings.celebrateText);
        state.raise();
      },
    });
    view.apply(settings);
    view.update(state.snapshot);
    return {
      apply(next) { view.apply(next); state.setSettings(next); },
      onEvent: (event) => event.kind === "follow" && state.follow(),
      tests: {
        one: () => state.follow(1),
        ten: () => state.follow(10),
        reach: () => state.follow(Math.max(1, state.goal - state.value)),
        reset: () => state.reset(),
      },
    };
  },
});
