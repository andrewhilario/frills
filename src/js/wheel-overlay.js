// The Spin the Wheel overlay (TikTok LIVE & Twitch): transparent Browser source showing an animated prize wheel.
//   /overlay/wheel/?channel=yourname&design=classic&triggerBy=any&minDiamonds=10
//   add &demo=1 (with optional &pace=4000) for continuous practice spins.

import { WHEEL, PrizeWheel } from "./wheel.js";
import { createWheelView, playWheelTick } from "./widgets-view.js";
import { channelFromParams, connectEvents, bothFromParams, platformFromParams } from "./widget-overlay.js";
import { fakeAlertSource } from "./fake-alerts.js";
import { createSounds } from "./sounds.js";
import { fontsReady, generalFaces } from "./look.js";

const params = new URLSearchParams(location.search);
const platform = platformFromParams(params);
const both = bothFromParams(params);
const settings = WHEEL.sanitize(WHEEL.fromParams(params));
const demoPace = Number(params.get("pace")) ? Math.min(15000, Math.max(1500, Number(params.get("pace")))) : 0;

const note = document.getElementById("note");
const say = (text) => { note.hidden = !text; note.textContent = text; };
const channel = channelFromParams(params, platform);
const demo = params.get("demo") === "1";

const sounds = createSounds();
const view = createWheelView(document.getElementById("wheel"), {
  onTick: () => { if (settings.tickSound) playWheelTick(); },
  onWin: () => {
    if (settings.winSound && settings.winSound !== "none") {
      sounds.play(settings.winSound, { volume: 70, tier: 3 });
    }
  },
});
view.apply(settings);

const wheel = new PrizeWheel(settings, {
  onChange: (snapshot) => view.render(snapshot),
  onSpinStart: async (spinData) => {
    await view.spinTo(spinData, {
      spinMs: (settings.spinSeconds || 5) * 1000,
      holdMs: (settings.holdSeconds || 5) * 1000,
    });
    wheel.finishSpin();
  },
});

view.render(wheel.snapshot);

window.addEventListener("frills:cloud-cmd", (e) => {
  const raw = String(e.detail?.cmd ?? "");
  if (raw === "wheel:spin") {
    wheel.spin({ who: "Stream Deck", label: "Manual Spin" });
  } else if (raw === "wheel:clear") {
    view.clear();
    wheel.clear();
  }
});

if (demo) {
  fontsReady(generalFaces(settings), 1000).then(() => {
    const demoKinds = platform === "twitch" ? ["bits", "subgift"] : platform === "both" ? ["gift", "bits", "subgift"] : ["gift"];
    fakeAlertSource((event) => wheel.add(event), demoPace ? () => [demoPace * 0.75, demoPace * 1.25] : () => [4500, 7500], demoKinds);
  });
} else if (!channel) {
  say("Add ?channel=yourname to this link.");
} else {
  const fonts = fontsReady(generalFaces(settings), 1000);
  connectEvents({
    channel,
    platform,
    both,
    events: platform === "twitch" ? ["sub", "subgift", "bits"] : platform === "both" ? ["gift", "sub", "subgift", "bits"] : ["gift"],
    onAlert: (event) => fonts.then(() => wheel.add(event)),
    say,
  });
}
