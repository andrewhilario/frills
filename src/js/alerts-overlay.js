// The alerts overlay: what a streaming app opens. It reads its look and account from the address, listens for follows, gifts and shares
// (TikTok) or subs, gifted subs, bits and raids (Twitch), and shows them with the chosen animation and sound. A see-through page.
//   /overlay/alerts/?channel=yourname&platform=tiktok&look=night&volume=50     your account
//   /overlay/alerts/?channel=yourname&platform=twitch                          the same, for a Twitch channel
//   add &demo=1 to see practice alerts instead of a real account

import { AlertQueue, makeAlert } from "./alerts.js";
import { createAlertView } from "./alerts-view.js";
import { KINDS, PLATFORM_KINDS, TWITCH_CHAT_KINDS, fromParams, mediaUrl, sanitize } from "./alerts-settings.js";
import { createSounds } from "./sounds.js";
import { bothFromParams, channelFromParams, connectEvents, platformFromParams } from "./widget-overlay.js";
import { fakeAlert, fakeAlertSource } from "./fake-alerts.js";
import { fontsReady, generalFaces } from "./look.js";
import { FollowReader, validCode } from "./follow-bridge.js";

const params = new URLSearchParams(location.search);
const settings = sanitize(fromParams(params));
// ?pace=1500 makes the practice (demo) events come about that many milliseconds apart: handy for trying a look, or for filming it
const demoPace = Number(params.get("pace")) ? Math.min(10000, Math.max(300, Number(params.get("pace")))) : 0; // (no pace, or not a number: the usual speed)
const both = bothFromParams(params);
const platform = platformFromParams(params);
// ?only=follow,gift keeps the practice to those kinds; a Twitch overlay practises with Twitch kinds, Both practises with all kinds
const demoOnly = (params.get("only") ?? "").split(",").filter((kind) => KINDS.includes(kind));
if (platform === "twitch" && !demoOnly.length) demoOnly.push(...PLATFORM_KINDS.twitch);
else if (platform === "both" && !demoOnly.length) demoOnly.push(...KINDS);

const note = document.getElementById("note");
const say = (text) => { note.hidden = !text; note.textContent = text; };

const view = createAlertView(document.getElementById("alerts"));
view.apply(settings);
const sounds = createSounds();
for (const key of Object.keys(settings)) if (key.endsWith("MySound") && settings[key]) sounds.preload(mediaUrl(settings[key])); // fetched ahead, so the first alert is not late
sounds.unlock(); // an app that lets a page make sound by itself (OBS does) lets this through; one that doesn't leaves it silent

const queue = new AlertQueue(settings, {
  onShow: (item) => {
    view.show(item);
    if (item.mySound) sounds.playUrl(mediaUrl(item.mySound), { volume: settings.volume, tier: item.tier });
    else sounds.play(item.sound, { volume: settings.volume, tier: item.tier });
  },
  onHide: (item) => view.hide(item),
});
const push = (event) => {
  const alert = makeAlert(event, settings);
  if (alert) queue.push(alert);
};

window.addEventListener("frills:cloud-cmd", (e) => {
  const cmd = String(e.detail?.cmd ?? "");
  if (cmd === "alerts:gift") push(fakeAlert(platform === "twitch" ? "bits" : "gift"));
  else if (cmd === "alerts:sub") push(fakeAlert("sub"));
});

const channel = channelFromParams(params, platform);
// Twitch follows reach this page another way: the streamer's Twitch follows page puts each one in a small post box, and this reads the box.
const followsCode = (platform === "twitch" || platform === "both") ? validCode(params.get("follows")) : "";
if (followsCode && params.get("demo") !== "1") new FollowReader({ code: followsCode, onFollow: (f) => push({ kind: "follow", id: f.id, user: f.user, name: f.name, avatar: "" }) }).start();
if (params.get("demo") === "1") {
  fontsReady(generalFaces(settings), 1000).then(() => fakeAlertSource(push, demoPace ? () => [demoPace * 0.6, demoPace * 1.4] : undefined, demoOnly));
} else if (!channel) {
  say("Add ?channel=yourname to this link.");
} else {
  // The connection starts at once: waiting for the font (up to a second) before even asking for the stream made every overlay slower to connect. The first
  // alert is still drawn in the chosen font, because drawing is what waits for it.
  const fonts = fontsReady(generalFaces(settings), 1000);
  const events = platform === "twitch" ? TWITCH_CHAT_KINDS : platform === "both" ? [...PLATFORM_KINDS.tiktok, ...TWITCH_CHAT_KINDS] : PLATFORM_KINDS.tiktok;
  connectEvents({
    channel,
    platform,
    both,
    events,
    onAlert: (alert) => fonts.then(() => push(alert)),
    say,
  });
}
