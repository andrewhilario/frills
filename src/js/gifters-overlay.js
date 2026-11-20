// The Top Gifters overlay: what a streaming app opens. Shows a live leaderboard of Top Gifters on TikTok LIVE (diamonds)
// or Twitch (sub gifters, bit senders, or combined).
//   /overlay/gifters/?channel=yourname&platform=tiktok&max=5&keep=1
//   /overlay/gifters/?channel=yourchannel&platform=twitch&twitchMode=subgift
//   add &demo=1 for practice events instead of a real account

import { GIFTERS, GifterBoard, loadGifters, saveGifters } from "./gifters.js";
import { createGiftersView } from "./widgets-view.js";
import { channelFromParams, connectEvents, platformFromParams } from "./widget-overlay.js";
import { demoGifters, fakeGifterSource } from "./fake-alerts.js";
import { createSounds } from "./sounds.js";
import { fontsReady, generalFaces } from "./look.js";

const params = new URLSearchParams(location.search);
const platform = platformFromParams(params);
const settings = GIFTERS.sanitize(GIFTERS.fromParams(params));
const demoPace = Number(params.get("pace")) ? Math.min(10000, Math.max(300, Number(params.get("pace")))) : 0;

const note = document.getElementById("note");
const say = (text) => { note.hidden = !text; note.textContent = text; };
const channel = channelFromParams(params, platform);
const demo = params.get("demo") === "1";

const view = createGiftersView(document.getElementById("gifters"));
view.apply(settings);
const sounds = createSounds();
let saving = 0;

const board = new GifterBoard(settings, {
  platform,
  entries: demo
    ? demoGifters(platform, settings.twitchMode, settings.milestone)
    : settings.keep && channel ? loadGifters(globalThis.localStorage, platform, channel) : [],
  onMilestone: (person) => view.celebrate(person, { onStart: () => sounds.play(settings.celebrateSound, { volume: 70, tier: 3 }) }),
  onChange: (top) => {
    view.render(top);
    if (settings.keep && channel && !saving && !demo) {
      saving = setTimeout(() => { saving = 0; saveGifters(globalThis.localStorage, platform, channel, board); }, 1500);
    }
  },
});
view.render(board.top);

if (demo) {
  fontsReady(generalFaces(settings), 1000).then(() => {
    fakeGifterSource((event) => board.add(event), platform, demoPace ? () => [demoPace * 0.6, demoPace * 1.4] : undefined, settings.twitchMode);
  });
} else if (!channel) {
  say("Add ?channel=yourname to this link.");
} else {
  const fonts = fontsReady(generalFaces(settings), 1000);
  connectEvents({
    channel,
    platform,
    events: platform === "twitch" ? ["subgift", "bits"] : ["gift"],
    onAlert: (event) => fonts.then(() => board.add(event)),
    say,
  });
}
