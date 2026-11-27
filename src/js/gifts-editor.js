// The Last Gifts editor page.

import { GIFTS, GiftList } from "./gifts.js";
import { createGiftsView } from "./widgets-view.js";
import { startWidgetEditor } from "./widget-editor.js";
import { fakeAlert } from "./fake-alerts.js";

startWidgetEditor({
  widget: GIFTS,
  storeKey: "frills:gifts:v1",
  overlayPath: "/overlay/gifts/",
  platforms: ["tiktok", "twitch", "both"],
  events: (p) => (p === "twitch" ? ["sub", "subgift", "bits", "raid"] : p === "both" ? ["gift", "sub", "subgift", "bits", "raid"] : ["gift"]),
  idleHint: (p) => (p === "twitch"
    ? "Type your Twitch channel to show recent subs, gifted subs, bits and raids — or use the test buttons above."
    : p === "both"
      ? "Type your TikTok @name and Twitch channel to list TikTok gifts and Twitch subs, bits and raids in one feed."
      : "Type your TikTok name, or frills_demo to get made-up gifts. The test buttons above work without connecting."),
  create(host, settings, ctx) {
    const view = createGiftsView(host);
    const list = new GiftList(settings, { onChange: (items) => view.render(items), onGone: (item) => view.gone(item) });
    view.apply(settings);
    const pickMany = () => {
      const p = ctx.platform();
      const kinds = p === "twitch" ? ["sub", "subgift", "bits", "raid"] : p === "both" ? ["gift", "sub", "bits", "gift", "subgift", "raid"] : ["gift"];
      return kinds[Math.floor(Math.random() * kinds.length)];
    };
    return {
      apply(next) { view.apply(next); list.setSettings(next); },
      onEvent: (event) => list.add(event),
      tests: {
        gift: () => list.add(fakeAlert("gift", { size: 1 })),
        big: () => list.add(fakeAlert("gift", { size: 3 })),
        sub: () => list.add(fakeAlert("sub", { resub: Math.random() < 0.4 })),
        subgift: () => list.add(fakeAlert("subgift")),
        bits: () => list.add(fakeAlert("bits")),
        raid: () => list.add(fakeAlert("raid")),
        many: () => { for (let i = 0; i < 6; i++) setTimeout(() => list.add(fakeAlert(pickMany())), i * 250); },
        clear: () => list.clear(),
      },
    };
  },
});
