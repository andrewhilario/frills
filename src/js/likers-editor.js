// The Top Likers editor page.

import { LIKERS, LikeBoard } from "./likers.js";
import { createLikersView } from "./widgets-view.js";
import { startWidgetEditor } from "./widget-editor.js";
import { fakeLike, fakeLikeSource } from "./fake-alerts.js";

startWidgetEditor({
  widget: LIKERS,
  storeKey: "frills:likers:v1",
  overlayPath: "/overlay/likers/",
  events: ["like"],
  idleHint: "Type your TikTok name, or frills_demo to get made-up likes. The test buttons above work without connecting.",
  create(host, settings) {
    const view = createLikersView(host);
    const board = new LikeBoard(settings, { onChange: (top) => view.render(top) });
    view.apply(settings);
    let running = null;
    return {
      apply(next) { view.apply(next); board.setSettings(next); },
      onEvent: (event) => board.add(event),
      tests: {
        likes: () => board.add(fakeLike()),
        crowd: () => { running?.stop(); let left = 40; running = fakeLikeSource((e) => { board.add(e); if (--left <= 0) running?.stop(); }, () => [60, 140]); },
        overtake: () => {
          const top = board.top;
          if (top.length < 2) return board.add(fakeLike({ count: 30 }));
          const last = top[top.length - 1];
          board.add({ kind: "like", user: last.key, name: last.name, avatar: last.avatar, count: top[0].count - last.count + 5 });
        },
        clear: () => { running?.stop(); board.clear(); },
      },
    };
  },
});
