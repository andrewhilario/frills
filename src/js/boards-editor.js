// The rotating Top Gifters and Likers editor page.

import { BOARDS, Boards, boardsOn } from "./boards.js";
import { createBoardsView } from "./widgets-view.js";
import { startWidgetEditor } from "./widget-editor.js";
import { fakeAlert, fakeLike, fakeLikeSource } from "./fake-alerts.js";

startWidgetEditor({
  widget: BOARDS,
  storeKey: "frills:leaderboard:v1",
  overlayPath: "/overlay/leaderboard/",
  events: ["gift", "like"],
  idleHint: "Type your TikTok name, or frills_demo to get made-up gifts and likes. The test buttons above work without connecting.",
  create(host, settings) {
    const view = createBoardsView(host);
    let current = settings;
    let turn = 0;
    const boards = new Boards(settings, { onChange: (now) => view.show(now) });
    // The rankings take turns here too, so a look can be judged as it will be on stream. (It follows the seconds typed: a change starts the wait again.)
    const restart = () => {
      clearInterval(turn);
      turn = boardsOn(current).length > 1 ? setInterval(() => boards.next(), Math.max(5, current.seconds) * 1000) : 0;
    };
    view.apply(settings);
    view.show(boards.view);
    restart();
    let running = null;
    return {
      apply(next) {
        const moved = next.seconds !== current.seconds || boardsOn(next).join() !== boardsOn(current).join();
        current = next;
        view.apply(next);
        boards.setSettings(next);
        if (moved) restart();
      },
      onEvent: (event) => boards.add(event),
      tests: {
        gift: () => boards.add(fakeAlert("gift")),
        likes: () => boards.add(fakeLike()),
        crowd: () => {
          running?.stop();
          let left = 30;
          for (let i = 0; i < 8; i++) setTimeout(() => boards.add(fakeAlert("gift")), i * 150);
          running = fakeLikeSource((e) => { boards.add(e); if (--left <= 0) running?.stop(); }, () => [60, 140]);
        },
        next: () => { boards.next(); restart(); },
        clear: () => { running?.stop(); boards.clear(); },
      },
    };
  },
});
