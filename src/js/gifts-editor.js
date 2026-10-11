// The Last Gifts editor page.

import { GIFTS, GiftList } from "./gifts.js";
import { createGiftsView } from "./widgets-view.js";
import { startWidgetEditor } from "./widget-editor.js";
import { fakeAlert } from "./fake-alerts.js";

startWidgetEditor({
  widget: GIFTS,
  storeKey: "frills:gifts:v1",
  overlayPath: "/overlay/gifts/",
  events: ["gift"],
  idleHint: "Type your TikTok name, or frills_demo to get made-up gifts. The test buttons above work without connecting.",
  create(host, settings) {
    const view = createGiftsView(host);
    const list = new GiftList(settings, { onChange: (items) => view.render(items), onGone: (item) => view.gone(item) });
    view.apply(settings);
    return {
      apply(next) { view.apply(next); list.setSettings(next); },
      onEvent: (event) => list.add(event),
      tests: {
        gift: () => list.add(fakeAlert("gift", { size: 1 })),
        big: () => list.add(fakeAlert("gift", { size: 3 })),
        many: () => { for (let i = 0; i < 6; i++) setTimeout(() => list.add(fakeAlert("gift")), i * 250); },
        clear: () => list.clear(),
      },
    };
  },
});
