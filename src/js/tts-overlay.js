// Talking Pet TTS OBS Browser Source overlay: connects to live TikTok LIVE or Twitch alerts & chat and speaks through the animated pet.

import { TTS, TtsQueue, ttsSpeechFor } from "./tts.js";
import { createTtsPlayer } from "./tts-audio.js";
import { createTtsView } from "./widgets-view.js";
import { channelFromParams, connectEvents, bothFromParams, platformFromParams } from "./widget-overlay.js";
import { fontsReady, generalFaces } from "./look.js";

const params = new URLSearchParams(location.search);
const platform = platformFromParams(params);
const settings = TTS.sanitize(TTS.fromParams(params));
const host = document.getElementById("tts");
const note = document.getElementById("note");
const view = createTtsView(host);
view.apply(settings);

const player = createTtsPlayer({
  onLevel: (lvl) => view.level(lvl),
});

const queue = new TtsQueue(settings, {
  speak: player.speak,
  onStart: (item) => view.start(item),
  onIdle: () => view.idle(),
});

window.addEventListener("frills:cloud-cmd", (e) => {
  const raw = String(e.detail?.cmd ?? "");
  if (raw === "tts:clear") {
    queue.clear();
    player.stop();
    view.clear();
  } else if (raw.startsWith("tts:say:")) {
    const text = raw.slice("tts:say:".length).trim();
    const item = ttsSpeechFor({ name: "Streamer", text, broadcaster: true }, { ...settings, trigger: "all_chat", readUser: false });
    if (item) {
      item.badge = "live";
      queue.enqueue(item, { bypassCooldown: true });
    }
  }
});

const say = (message) => {
  if (!message) {
    note.hidden = true;
    return;
  }
  note.textContent = message;
  note.hidden = false;
};

if (params.get("demo") === "1") {
  fontsReady(generalFaces(settings), 1000).then(() => {
    const sampleGift = platform === "twitch"
      ? ttsSpeechFor({ kind: "bits", name: "Pond Pal", count: 500 }, settings)
      : ttsSpeechFor({ kind: "gift", name: "Pond Pal", gift: "Doughnut", diamonds: 30, count: 1, total: 30 }, settings);
    const sampleChat = ttsSpeechFor({ name: "Mochi Bun", text: `${settings.command || "!say"} Happy to catch the stream tonight!` }, { ...settings, trigger: "cmd" });
    if (sampleGift) queue.enqueue(sampleGift, { bypassCooldown: true });
    if (sampleChat) queue.enqueue(sampleChat, { bypassCooldown: true });
  });
} else {
  const both = bothFromParams(params);
  const channel = channelFromParams(params, platform);
  if (!channel) {
    say("Add ?channel=yourname to this link.");
  } else {
    const fonts = fontsReady(generalFaces(settings), 1000);
    connectEvents({
      channel,
      platform,
      both,
      events: platform === "twitch" ? ["sub", "subgift", "bits", "raid"] : platform === "both" ? ["gift", "sub", "subgift", "bits", "raid"] : ["gift"],
      onAlert(event) {
        fonts.then(() => {
          const item = ttsSpeechFor(event, settings);
          if (item) queue.enqueue(item);
        });
      },
      onChat(msg) {
        fonts.then(() => {
          const item = ttsSpeechFor(msg, settings);
          if (item) queue.enqueue(item);
        });
      },
      say,
    });
  }
}
