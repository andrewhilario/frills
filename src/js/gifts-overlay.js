// The Last Gifts overlay: what a streaming app opens. A see-through page with the most recent gifts.
//   /overlay/gifts/?channel=yourname&platform=tiktok&max=8&order=top      your account
//   add &demo=1 to see practice gifts instead of a real account

import { GIFTS, GiftList } from "./gifts.js";
import { createGiftsView } from "./widgets-view.js";
import { bothFromParams, channelFromParams, connectEvents, platformFromParams } from "./widget-overlay.js";
import { fakeAlert } from "./fake-alerts.js";
import { fontsReady, generalFaces } from "./look.js";

const params = new URLSearchParams(location.search);
const platform = platformFromParams(params);
const both = bothFromParams(params);
const settings = GIFTS.sanitize(GIFTS.fromParams(params));
// ?pace=1500 makes the practice (demo) events come about that many milliseconds apart: handy for trying a look, or for filming it
const demoPace = Number(params.get("pace")) ? Math.min(10000, Math.max(300, Number(params.get("pace")))) : 0; // (no pace, or not a number: the usual speed)

const note = document.getElementById("note");
const say = (text) => { note.hidden = !text; note.textContent = text; };

const view = createGiftsView(document.getElementById("gifts"));
view.apply(settings);
const list = new GiftList(settings, { onChange: (items) => view.render(items), onGone: (item) => view.gone(item) });

const channel = channelFromParams(params, platform);
if (params.get("demo") === "1") {
  const demoKinds = platform === "twitch" ? ["sub", "subgift", "bits", "raid"] : platform === "both" ? ["gift", "sub", "bits", "subgift"] : ["gift"];
  fontsReady(generalFaces(settings), 1000).then(() => {
    const send = () => {
      const kind = demoKinds[Math.floor(Math.random() * demoKinds.length)];
      list.add(fakeAlert(kind));
      setTimeout(send, demoPace ? demoPace * (0.6 + Math.random() * 0.8) : 1500 + Math.random() * 2500);
    };
    send();
  });
} else if (!channel) {
  say("Add ?channel=yourname to this link.");
} else {
  const fonts = fontsReady(generalFaces(settings), 1000); // the connection starts at once; only drawing waits for the font
  const events = platform === "twitch" ? ["sub", "subgift", "bits", "raid"] : platform === "both" ? ["gift", "sub", "subgift", "bits", "raid"] : ["gift"];
  connectEvents({ channel, platform, both, events, onAlert: (event) => fonts.then(() => list.add(event)), say });
}
