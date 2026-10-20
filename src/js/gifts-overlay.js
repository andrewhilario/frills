// The Last Gifts overlay: what a streaming app opens. A see-through page with the most recent gifts.
//   /overlay/gifts/?channel=yourname&platform=tiktok&max=8&order=top      your account
//   add &demo=1 to see practice gifts instead of a real account

import { GIFTS, GiftList } from "./gifts.js";
import { createGiftsView } from "./widgets-view.js";
import { channelFromParams, connectEvents } from "./widget-overlay.js";
import { fakeAlert } from "./fake-alerts.js";
import { fontsReady, generalFaces } from "./look.js";

const params = new URLSearchParams(location.search);
const settings = GIFTS.sanitize(GIFTS.fromParams(params));
// ?pace=1500 makes the practice (demo) events come about that many milliseconds apart: handy for trying a look, or for filming it
const demoPace = Number(params.get("pace")) ? Math.min(10000, Math.max(300, Number(params.get("pace")))) : 0; // (no pace, or not a number: the usual speed)

const note = document.getElementById("note");
const say = (text) => { note.hidden = !text; note.textContent = text; };

const view = createGiftsView(document.getElementById("gifts"));
view.apply(settings);
const list = new GiftList(settings, { onChange: (items) => view.render(items), onGone: (item) => view.gone(item) });

const channel = channelFromParams(params);
if (params.get("demo") === "1") {
  fontsReady(generalFaces(settings), 1000).then(() => {
    const send = () => { list.add(fakeAlert("gift")); setTimeout(send, demoPace ? demoPace * (0.6 + Math.random() * 0.8) : 1500 + Math.random() * 2500); };
    send();
  });
} else if (!channel) {
  say("Add ?channel=yourname to this link.");
} else {
  fontsReady(generalFaces(settings), 1000).then(() => connectEvents({ channel, events: ["gift"], onAlert: (event) => list.add(event), say }));
}
