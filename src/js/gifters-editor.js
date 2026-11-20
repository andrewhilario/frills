// The Top Gifters editor page (TikTok gift diamonds + Twitch sub gifters & bit senders).

import { GIFTERS, GifterBoard, milestoneInfo } from "./gifters.js";
import { createGiftersView } from "./widgets-view.js";
import { startWidgetEditor } from "./widget-editor.js";
import { fakeAlert, fakeGifterSource } from "./fake-alerts.js";
import { createSounds } from "./sounds.js";

const sounds = createSounds();

startWidgetEditor({
  widget: GIFTERS,
  storeKey: "frills:gifters:v1",
  overlayPath: "/overlay/gifters/",
  platforms: ["tiktok", "twitch"],
  events: (p) => (p === "twitch" ? ["subgift", "bits"] : ["gift"]),
  idleHint: (p) => (p === "twitch"
    ? "Type your Twitch channel, or press the test buttons above without connecting."
    : "Type your TikTok name, or frills_demo to get made-up gifts. The test buttons above work without connecting."),
  create(host, settings, ctx) {
    const view = createGiftersView(host);
    let current = settings;
    let running = null;
    const cheer = (person) => view.celebrate(person, { onStart: () => sounds.play(current.celebrateSound, { volume: 70, tier: 3 }) });
    const board = new GifterBoard(settings, {
      platform: ctx.platform(),
      onChange: (top) => view.render(top),
      onMilestone: cheer,
    });
    view.apply(settings);

    const stopCrowd = () => { running?.stop(); running = null; };
    const topEvent = (target) => {
      if (board.platform === "twitch") {
        if (current.twitchMode === "bits") return { kind: "bits", id: "", user: target.key, name: target.name, avatar: target.avatar, count: Math.max(100, (board.top[0]?.bits ?? 0) - target.bits + 100) };
        return { kind: "subgift", id: "", user: target.key, name: target.name, avatar: target.avatar, count: Math.max(1, (board.top[0]?.subgifts ?? 0) - target.subgifts + 2) };
      }
      const needed = Math.max(10, (board.top[0]?.diamonds ?? 0) - target.diamonds + 50);
      return { kind: "gift", id: "", user: target.key, name: target.name, avatar: target.avatar, gift: "Galaxy", diamonds: needed, count: 1, total: needed, picture: "" };
    };

    return {
      apply(next) {
        current = next;
        view.apply(next);
        board.setSettings(next);
      },
      onPlatform(platform) {
        stopCrowd();
        board.setPlatform(platform);
      },
      onEvent: (event) => board.add(event),
      tests: {
        gift: () => board.add(fakeAlert("gift")),
        subgift: () => board.add(fakeAlert("subgift")),
        bits: () => board.add(fakeAlert("bits")),
        crowd: () => {
          stopCrowd();
          let left = 18;
          running = fakeGifterSource(
            (e) => { board.add(e); if (--left <= 0) stopCrowd(); },
            board.platform,
            () => [120, 260],
            current.twitchMode,
          );
        },
        overtake: () => {
          const top = board.top;
          if (top.length < 2) {
            const kind = board.platform === "twitch" ? (current.twitchMode === "bits" ? "bits" : "subgift") : "gift";
            return board.add(fakeAlert(kind, { size: 2 }));
          }
          board.add(topEvent(top[top.length - 1]));
        },
        milestone: async () => {
          await sounds.unlock();
          const top = board.top[0] ?? { key: "pondpal", name: "Pond Pal", avatar: "", diamonds: 0, subgifts: 0, bits: 0 };
          const info = milestoneInfo(top, board.platform, current.twitchMode);
          const count = Math.max(info.metric, board.platform === "twitch" && current.twitchMode === "subgift" ? Math.max(5, Math.min(board.every, 10)) : board.every);
          cheer({ key: top.key, name: top.name, avatar: top.avatar, count, unit: info.unit, milestone: count, rank: 1 });
        },
        clear: () => { stopCrowd(); board.clear(); },
      },
    };
  },
});
