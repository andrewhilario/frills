// Talking Pet TTS OBS Browser Source overlay: connects to live TikTok gifts & chat and speaks through the animated pet.

import { TTS, TtsQueue, ttsSpeechFor } from "./tts.js";
import { createTtsPlayer } from "./tts-audio.js";
import { createTtsView } from "./widgets-view.js";
import { channelFromParams, connectEvents } from "./widget-overlay.js";

const params = new URLSearchParams(location.search);
const settings = TTS.fromParams(params);
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

const say = (message) => {
  if (!message) {
    note.hidden = true;
    return;
  }
  note.textContent = message;
  note.hidden = false;
};

if (params.get("demo") === "1") {
  const sampleGift = ttsSpeechFor({ kind: "gift", name: "Pond Pal", gift: "Doughnut", diamonds: 30, count: 1, total: 30 }, settings);
  const sampleChat = ttsSpeechFor({ name: "Mochi Bun", text: `${settings.command || "!say"} Happy to catch the stream tonight!` }, { ...settings, trigger: "cmd" });
  if (sampleGift) queue.enqueue(sampleGift, { bypassCooldown: true });
  if (sampleChat) queue.enqueue(sampleChat, { bypassCooldown: true });
} else {
  const channel = channelFromParams(params);
  if (channel) {
    connectEvents({
      channel,
      events: ["gift"],
      onAlert(event) {
        const item = ttsSpeechFor(event, settings);
        if (item) queue.enqueue(item);
      },
      onChat(msg) {
        const item = ttsSpeechFor(msg, settings);
        if (item) queue.enqueue(item);
      },
      say,
    });
  }
}
