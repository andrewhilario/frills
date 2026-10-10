// The alerts overlay: what a streaming app opens. It reads its look and account from the address, listens for follows, gifts and shares,
// and shows them with the chosen animation and sound. A see-through page, nothing else.
//   /overlay/alerts/?channel=yourname&platform=tiktok&look=night&volume=50     your account
//   add &demo=1 to see practice alerts instead of a real account

import { AlertQueue, makeAlert } from "./alerts.js";
import { createAlertView } from "./alerts-view.js";
import { fromParams, sanitize } from "./alerts-settings.js";
import { createSounds } from "./sounds.js";
import { cleanName, connectTo, statusText } from "./connect.js";
import { relayForPage } from "./tiktok.js";
import { fakeAlertSource } from "./fake-alerts.js";
import { fontsReady, generalFaces } from "./look.js";

const params = new URLSearchParams(location.search);
const settings = sanitize(fromParams(params));
const note = document.getElementById("note");
const say = (text) => { note.hidden = !text; note.textContent = text; };

const view = createAlertView(document.getElementById("alerts"));
view.apply(settings);
const sounds = createSounds();
sounds.unlock(); // an app that lets a page make sound by itself (OBS does) lets this through; one that doesn't leaves it silent

const queue = new AlertQueue(settings, {
  onShow: (item) => {
    view.show(item);
    sounds.play(item.sound, { volume: settings.volume, tier: item.tier });
  },
  onHide: (item) => view.hide(item),
});
const push = (event) => {
  const alert = makeAlert(event, settings);
  if (alert) queue.push(alert);
};

const channel = cleanName("tiktok", params.get("channel"));
if (params.get("demo") === "1") {
  fontsReady(generalFaces(settings), 1000).then(() => fakeAlertSource(push));
} else if (!channel) {
  say("Add ?channel=yourname to this link.");
} else {
  // The first alert should be drawn in the chosen font, so fetch it first (for at most a second).
  fontsReady(generalFaces(settings), 1000).then(() => {
    const noFeed = { add() {}, removeById() {}, removeUser() {}, clear() {} }; // chat is not shown here; only alerts
    let old = false; // the relay we found can only send chat: say so, and keep saying it
    connectTo([noFeed], "tiktok", channel, (status) => {
      if (old) return;
      say(status.state === "connected" || status.state === "stopped" ? "" : statusText(status));
    }, {
      relay: relayForPage(),
      events: ["follow", "gift", "share"],
      onAlert: push,
      onFound: (found) => {
        if (found && !found.features.includes("alerts")) {
          old = true;
          say("The Frills relay needs an update before it can send alerts.");
        }
      },
    });
  });
}
