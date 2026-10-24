// The overlay page: reads its look and account from the address, draws the chat, and nothing else.
//   /overlay/?channel=yourname&look=frost&accent=%23ff0000      a general look, Twitch chat
//   /overlay/?platform=tiktok&channel=yourname&look=frost       the same, with TikTok chat (needs the Frills helper on this PC)
//   /overlay/?channel=yourname&style=latte&palette=sakura       a matcha style
//   /overlay/?tiktok=yourname&twitch=yourchannel&look=frost    both chats in one, each message marked with its platform
//   add &demo=1 to see practice messages instead of a real chat (and &pace=700 to make them come about that many milliseconds apart)

import { Feed } from "./feed.js";
import { sanitize, fromParams } from "./settings.js";
import { isMatchaStyle, sanitizeMatcha, matchaFromParams } from "./matcha.js";
import { fontsReady, generalFaces, matchaFaces, paintGeneral, paintMatcha } from "./look.js";
import { connectTo, statusText } from "./connect.js";
import { noteFor, scoped, sourcesOf, takingTurns } from "./both.js";
import { relayForPage } from "./tiktok.js";
import { fakeSource } from "./fake.js";

const params = new URLSearchParams(location.search);
const stage = document.getElementById("stage");
const feed = new Feed(document.getElementById("chat"));
const note = document.getElementById("note");

let faces;
let mark = true; // whether the little platform icon is wanted (it only shows when two chats are read)
if (isMatchaStyle(params.get("style"))) {
  const settings = sanitizeMatcha(matchaFromParams(params));
  feed.configure(paintMatcha(stage, settings));
  faces = matchaFaces(settings);
  mark = settings.source !== "none";
} else {
  const settings = sanitize(fromParams(params));
  feed.configure(paintGeneral(stage, settings));
  faces = generalFaces(settings);
  mark = settings.source !== "none";
}

// ?pace=700 makes the practice (demo) messages come about that many milliseconds apart: handy for trying a look, or for filming it
const demoPace = Number(params.get("pace")) ? Math.min(10000, Math.max(300, Number(params.get("pace")))) : 0; // (no pace, or not a number: the usual speed)
const practicePace = () => (demoPace ? [demoPace, demoPace * 1.7] : [1500, 3000]);
// The accounts the link names: one (channel= and platform=, or tiktok= or twitch=) or two (tiktok= and twitch=).
const sources = sourcesOf(params);
const both = sources.length === 2;
feed.configure({ markPlatform: both && mark });
if (!sources.length && params.get("demo") !== "1") {
  note.hidden = false;
  note.textContent = "Add ?channel=yourname to this link.";
}
// Fetch the look's typeface first (for at most a second), so the first message is drawn in it rather than in a stand-in.
const fonts = fontsReady(faces, 1000);
if (params.get("demo") === "1") {
  fonts.then(() => {
    if (both) {
      // practice for two chats: the made-up messages take turns being TikTok's and Twitch's (gifts are always TikTok's)
      fakeSource(takingTurns(scoped(feed, "tiktok"), scoped(feed, "twitch")), practicePace);
    } else fakeSource(feed, practicePace);
  });
} else if (sources.length) {
  // A real chat starts connecting at once instead of waiting for the typeface (connecting takes seconds, and the typeface is nearly always in by then).
  // What arrives before the typeface is in waits its turn, in order, so the first message is still drawn in the right face.
  let ready = false;
  const waiting = [];
  fonts.then(() => { ready = true; waiting.splice(0).forEach((run) => run()); });
  const later = (run) => (...args) => (ready ? run(...args) : waiting.push(() => run(...args)));
  const held = {
    add: later((m) => feed.add(m)),
    removeById: later((id) => feed.removeById(id)),
    removeUser: later((user) => feed.removeUser(user)),
    clear: later(() => feed.clear()),
    clearWhere: later((platform) => feed.clearWhere(platform)),
  };
  if (both) {
    const parts = {};
    for (const { platform, channel } of sources) {
      connectTo([scoped(held, platform)], platform, channel, (status) => {
        parts[platform] = status;
        const text = noteFor(parts, statusText);
        note.hidden = text === "";
        note.textContent = text;
      }, { relay: relayForPage(), assumeRelay: true });
    }
  } else {
    const [{ platform, channel }] = sources;
    connectTo([held], platform, channel, (status) => {
      note.hidden = status.state === "connected" || status.state === "stopped";
      note.textContent = statusText(status);
    }, { relay: relayForPage(), assumeRelay: true });
  }
}
