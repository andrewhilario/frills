// The Live Counter editor page.

import { COUNTER, LiveCounter } from "./counter.js";
import { createCounterView } from "./widgets-view.js";
import { startWidgetEditor } from "./widget-editor.js";
import { fakeCounterSource } from "./fake-alerts.js";

startWidgetEditor({
  widget: COUNTER,
  storeKey: "frills:counter:v1",
  overlayPath: "/overlay/counter/",
  events: ["like"],
  idleHint: "Type your TikTok name, or frills_demo to get made-up numbers. The test buttons above work without connecting.",
  create(host, settings) {
    const view = createCounterView(host);
    const counter = new LiveCounter(settings, { onChange: (state) => view.render(state) });
    view.apply(settings);
    let running = null;
    return {
      apply(next) { view.apply(next); counter.setSettings(next); },
      onEvent: (event) => counter.addLike(event),
      onInfo: (info) => { if (info.viewers) counter.setViewers(info.viewers); },
      tests: {
        watch: () => counter.setViewers((counter.viewers ?? 120) + 15 + Math.floor(Math.random() * 40)),
        likes: () => counter.addLike({ kind: "like", count: 25, total: (counter.likes ?? 0) + 25 }),
        burst: () => counter.addLike({ kind: "like", count: 500, total: (counter.likes ?? 0) + 500 }),
        live: () => { running?.stop(); running = fakeCounterSource({ onViewers: (n) => counter.setViewers(n), onLike: (e) => counter.addLike(e) }); },
        clear: () => { running?.stop(); running = null; counter.clear(); },
      },
    };
  },
});
