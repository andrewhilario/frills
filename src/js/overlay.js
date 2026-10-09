// The overlay page: reads its look and account from the address, draws the chat, and nothing else.
//   /overlay/?channel=yourname&look=frost&accent=%23ff0000      a general look, Twitch chat
//   /overlay/?platform=tiktok&channel=yourname&look=frost       the same, with TikTok chat (needs the Frills helper on this PC)
//   /overlay/?channel=yourname&style=latte&palette=sakura       a matcha style
//   add &demo=1 to see practice messages instead of a real chat

import { Feed } from "./feed.js";
import { sanitize, fromParams } from "./settings.js";
import { isMatchaStyle, sanitizeMatcha, matchaFromParams } from "./matcha.js";
import { fontsReady, generalFaces, matchaFaces, paintGeneral, paintMatcha } from "./look.js";
import { cleanName, connectTo, statusText } from "./connect.js";
import { fakeSource } from "./fake.js";

const params = new URLSearchParams(location.search);
const stage = document.getElementById("stage");
const feed = new Feed(document.getElementById("chat"));
const note = document.getElementById("note");

let faces;
if (isMatchaStyle(params.get("style"))) {
  const settings = sanitizeMatcha(matchaFromParams(params));
  feed.configure(paintMatcha(stage, settings));
  faces = matchaFaces(settings);
} else {
  const settings = sanitize(fromParams(params));
  feed.configure(paintGeneral(stage, settings));
  faces = generalFaces(settings);
}

const platform = params.get("platform") === "tiktok" ? "tiktok" : "twitch";
const channel = cleanName(platform, params.get("channel"));
if (!channel && params.get("demo") !== "1") {
  note.hidden = false;
  note.textContent = "Add ?channel=yourname to this link.";
}
// Fetch the look's typeface first (for at most a second), so the first message is drawn in it rather than in a stand-in.
fontsReady(faces, 1000).then(() => {
  if (params.get("demo") === "1") {
    fakeSource(feed, () => [1500, 3000]);
  } else if (channel) {
    connectTo([feed], platform, channel, (status) => {
      note.hidden = status.state === "connected" || status.state === "stopped";
      note.textContent = statusText(status);
    }, { relay: document.body.dataset.relay || "" });
  }
});
