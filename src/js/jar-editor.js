// The Gift Jar editor page (TikTok LIVE only): customize 6 crystal jar designs, test gift drops & full celebrations,
// connect your TikTok username, and copy one OBS / LIVE Studio Browser source link.

import { JAR, GiftJar } from "./jar.js";
import { createJarView } from "./widgets-view.js";
import { startWidgetEditor } from "./widget-editor.js";
import { fakeAlert } from "./fake-alerts.js";
import { createSounds } from "./sounds.js";

const sounds = createSounds();

startWidgetEditor({
  widget: JAR,
  storeKey: "frills:jar:editor:v1",
  overlayPath: "/overlay/jar/",
  platforms: ["tiktok", "twitch", "both"],
  events: (p) => (p === "twitch" ? ["sub", "subgift", "bits"] : p === "both" ? ["gift", "sub", "subgift", "bits"] : ["gift"]),
  idleHint: (p) => (p === "twitch"
    ? "Type your Twitch channel, or press the test buttons above without connecting."
    : p === "both"
      ? "Type your TikTok @name and Twitch channel to fill one jar from both TikTok gifts and Twitch bits & subs."
      : "Type your TikTok name, or frills_demo for made-up gifts. The test buttons above work without connecting."),
  create(host, settings, ctx) {
    const view = createJarView(host);
    let current = settings;
    const jar = new GiftJar(settings, {
      onDrop: (item) => view.drop(item),
      onChange: (snapshot) => view.render(snapshot),
      onFull: async (snapshot) => {
        const cycle = snapshot.jarsCompleted;
        if (current.celebrate) {
          sounds.play(current.celebrateSound, { volume: 70, tier: 3 });
          await view.celebrate(current.celebrateText, (current.celebrateTime || 6) * 1000);
        }
        jar.finishFullCycle(cycle);
      },
    });
    view.apply(settings);
    view.render(jar.snapshot);

    // Seed two small sample drops on first view only when empty? Keeping empty/ready for instant test buttons matches Frills.
    return {
      apply(next) {
        current = next;
        view.apply(next);
        jar.setSettings(next);
      },
      onEvent: (event) => jar.add(event),
      tests: {
        rose: async () => {
          await sounds.unlock();
          const sample = fakeAlert("gift", { size: 1 });
          jar.add(sample);
        },
        galaxy: async () => {
          await sounds.unlock();
          const sample = fakeAlert("gift", { size: 3 });
          jar.add(sample);
        },
        fill: async () => {
          await sounds.unlock();
          const need = Math.max(1, jar.target - jar.total);
          const sample = fakeAlert("gift", { size: 3 });
          jar.add({
            ...sample,
            gift: current.goalBy === "count" ? "Gift Bundle" : sample.gift,
            count: current.goalBy === "count" ? need : 1,
            diamonds: current.goalBy === "count" ? 10 : need,
            total: need,
          });
        },
        clear: () => {
          jar.clear();
          view.clear();
        },
      },
    };
  },
});
