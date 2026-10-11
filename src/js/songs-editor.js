// The Song requests editor page.

import { SONGS, SongQueue, makeLookup } from "./songs.js";
import { createSongsView } from "./widgets-view.js";
import { startWidgetEditor } from "./widget-editor.js";
import { fakeLookup, fakeRequest } from "./fake-alerts.js";

startWidgetEditor({
  widget: SONGS,
  storeKey: "frills:songs:v1",
  overlayPath: "/overlay/songs/",
  events: [],
  needs: "roles",
  idleHint: "Type your TikTok name, or frills_demo to get made-up song requests. The test buttons above work without connecting.",
  create(host, settings, ctx) {
    const view = createSongsView(host);
    const real = makeLookup(); // what chat asks for goes to the real catalog; the test buttons use the practice one
    const queue = new SongQueue(settings, { lookup: real, onChange: (v) => view.render(v) });
    view.apply(settings);
    view.render(queue.view);
    setInterval(() => queue.tick(), 1000);
    return {
      apply(next) { view.apply(next); queue.setSettings(next); },
      onChat: (message) => queue.handle(message, ctx.channel()),
      tests: {
        one: () => queue.request({ ...fakeRequest({ avoid: queue.items.map((i) => i.query) }), via: fakeLookup }),
        three: () => { for (let i = 0; i < 3; i++) setTimeout(() => queue.request({ ...fakeRequest({ avoid: queue.items.map((item) => item.query) }), via: fakeLookup }), i * 350); },
        next: () => queue.next(),
        clear: () => queue.clear(),
      },
    };
  },
});
