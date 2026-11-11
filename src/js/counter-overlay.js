// The Live Counter overlay: what a streaming app opens. A see-through page with how many are watching and the likes of your LIVE.
//   /overlay/counter/?channel=yourname&platform=tiktok         your account
//   add &demo=1 to see practice numbers instead of a real account

import { COUNTER, LiveCounter } from "./counter.js";
import { createCounterView } from "./widgets-view.js";
import { channelFromParams, connectEvents } from "./widget-overlay.js";
import { fakeCounterSource } from "./fake-alerts.js";
import { fontsReady, generalFaces } from "./look.js";

const params = new URLSearchParams(location.search);
const settings = COUNTER.sanitize(COUNTER.fromParams(params));
// ?pace=1500 makes the practice (demo) numbers change about that many milliseconds apart
const demoPace = Number(params.get("pace")) ? Math.min(10000, Math.max(300, Number(params.get("pace")))) : 0;

const note = document.getElementById("note");
const say = (text) => { note.hidden = !text; note.textContent = text; };
const channel = channelFromParams(params);
const demo = params.get("demo") === "1";

const view = createCounterView(document.getElementById("counter"));
view.apply(settings);
const counter = new LiveCounter(settings, { onChange: (state) => view.render(state) });

if (demo) {
  fontsReady(generalFaces(settings), 1000).then(() => fakeCounterSource({ onViewers: (n) => counter.setViewers(n), onLike: (e) => counter.addLike(e) }, demoPace ? () => [demoPace * 0.6, demoPace * 1.4] : undefined));
} else if (!channel) {
  say("Add ?channel=yourname to this link.");
} else {
  const fonts = fontsReady(generalFaces(settings), 1000); // the connection starts at once; only drawing waits for the font
  connectEvents({
    channel,
    events: ["like"],
    onAlert: (event) => fonts.then(() => counter.addLike(event)),
    onInfo: (info) => { if (info.viewers) fonts.then(() => counter.setViewers(info.viewers)); },
    say,
  });
}
