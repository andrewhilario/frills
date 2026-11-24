// Spin the Wheel editor page (TikTok LIVE & Twitch): customize 3 wheel designs, 2–12 slices,
// qualifying gift/bits or team spin meter rules, test spins, connect live chat/gifts, and copy one OBS link.

import { WHEEL, PrizeWheel } from "./wheel.js";
import { createWheelView, playWheelTick, wheelSlicePalette } from "./widgets-view.js";
import { startWidgetEditor } from "./widget-editor.js";
import { fakeAlert } from "./fake-alerts.js";
import { createSounds } from "./sounds.js";

const sounds = createSounds();

function syncSliceDots(settings) {
  const host = document.getElementById("opt-controls");
  if (!host) return;
  const { colors, ring } = wheelSlicePalette(settings);
  colors.forEach((hex, idx) => host.style.setProperty(`--slice-${idx}`, hex));
  host.style.setProperty("--slice-ring", ring);
}

startWidgetEditor({
  widget: WHEEL,
  storeKey: "frills:wheel:editor:v1",
  overlayPath: "/overlay/wheel/",
  platforms: ["tiktok", "twitch", "both"],
  events: (p) => (p === "twitch" ? ["sub", "subgift", "bits"] : p === "both" ? ["gift", "sub", "subgift", "bits"] : ["gift"]),
  idleHint: (p) => (p === "twitch"
    ? "Type your Twitch channel, or click the test buttons above without connecting."
    : p === "both"
      ? "Type your TikTok @name and Twitch channel to trigger spins from both TikTok gifts and Twitch cheers & subs."
      : "Type your TikTok name, or frills_demo for made-up gifts. The test buttons above work without connecting."),
  create(host, settings, ctx) {
    let current = settings;
    const view = createWheelView(host, {
      onTick: () => { if (current.tickSound) playWheelTick(); },
      onWin: () => {
        if (current.winSound && current.winSound !== "none") {
          sounds.play(current.winSound, { volume: 70, tier: 3 });
        }
      },
    });
    const wheel = new PrizeWheel(settings, {
      onChange: (snapshot) => view.render(snapshot),
      onSpinStart: async (spinData) => {
        await view.spinTo(spinData, {
          spinMs: (current.spinSeconds || 5) * 1000,
          holdMs: (current.holdSeconds || 5) * 1000,
        });
        wheel.finishSpin();
      },
    });
    view.apply(settings);
    view.render(wheel.snapshot);

    return {
      apply(next) {
        current = next;
        view.apply(next);
        wheel.setSettings(next);
        syncSliceDots(next);
      },
      onEvent: (event) => wheel.add(event),
      tests: {
        spin: async () => {
          await sounds.unlock();
          wheel.spin({ who: "Pond Pal", label: "Galaxy" });
        },
        gift: async () => {
          await sounds.unlock();
          const plat = ctx.platform();
          const ev = plat === "twitch" ? fakeAlert("bits", { size: 2 }) : fakeAlert("gift", { size: 2 });
          if (!wheel.add(ev)) wheel.spin({ who: ev.name, label: ev.gift || `${ev.count} Bits` });
        },
        queue: async () => {
          await sounds.unlock();
          wheel.spin({ who: "Mochi Bun", label: "Sub" });
          wheel.spin({ who: "Little Lily", label: "Rose" });
        },
        clear: () => {
          view.clear();
          wheel.clear();
        },
      },
    };
  },
});
