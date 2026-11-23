// The Gift Jar overlay (TikTok LIVE only): transparent Browser source showing gifts filling a custom themed jar.
//   /overlay/jar/?channel=yourname&design=boba&target=1000
//   add &demo=1 (with optional &pace=1200) to drop practice gifts on loop.

import { JAR, GiftJar, loadJar, saveJar } from "./jar.js";
import { createJarView } from "./widgets-view.js";
import { channelFromParams, connectEvents, bothFromParams, platformFromParams } from "./widget-overlay.js";
import { fakeAlertSource } from "./fake-alerts.js";
import { createSounds } from "./sounds.js";
import { fontsReady, generalFaces } from "./look.js";

const params = new URLSearchParams(location.search);
const platform = platformFromParams(params);
const both = bothFromParams(params);
const settings = JAR.sanitize(JAR.fromParams(params));
const demoPace = Number(params.get("pace")) ? Math.min(10000, Math.max(300, Number(params.get("pace")))) : 0;

const note = document.getElementById("note");
const say = (text) => { note.hidden = !text; note.textContent = text; };
const channel = channelFromParams(params, platform);
const demo = params.get("demo") === "1";
const persist = !demo && Boolean(channel) && (settings.keep || params.has("_cv"));

const sounds = createSounds();
const view = createJarView(document.getElementById("jar"));
view.apply(settings);

const remembered = persist ? loadJar(globalThis.localStorage, channel) : null;
let saving = 0;

const jar = new GiftJar(settings, {
  total: remembered?.total ?? 0,
  target: remembered?.target,
  jarsCompleted: remembered?.jarsCompleted ?? 0,
  items: remembered?.items ?? [],
  onDrop: (item) => view.drop(item),
  onChange: (snapshot) => {
    view.render(snapshot);
    if (persist && !saving) {
      saving = setTimeout(() => {
        saving = 0;
        saveJar(globalThis.localStorage, channel, jar);
      }, 1000);
    }
  },
  onFull: async (snapshot) => {
    const cycle = snapshot.jarsCompleted;
    if (settings.celebrate) {
      sounds.play(settings.celebrateSound, { volume: 70, tier: 3 });
      await view.celebrate(settings.celebrateText, (settings.celebrateTime || 6) * 1000);
    }
    jar.finishFullCycle(cycle);
  },
});

view.render(jar.snapshot);

window.addEventListener("frills:cloud-cmd", (e) => {
  const raw = String(e.detail?.cmd ?? "");
  const val = Math.max(1, Math.round(Number(e.detail?.value) || 100));
  if (raw === "jar:clear") {
    jar.clear();
    view.clear();
    if (persist) saveJar(globalThis.localStorage, channel, jar);
  } else if (raw === "jar:fill") {
    const need = Math.max(1, jar.target - jar.total);
    jar.add({ kind: "gift", name: "Stream Deck", gift: "Full Jar", count: settings.goalBy === "count" ? need : 1, diamonds: need, total: need });
  } else if (raw === "jar:drop") {
    jar.add({ kind: "gift", name: "Stream Deck", gift: "Bonus Drop", count: settings.goalBy === "count" ? val : 1, diamonds: val, total: val });
  }
});

if (demo) {
  fontsReady(generalFaces(settings), 1000).then(() => {
    const demoKinds = platform === "twitch" ? ["bits", "subgift"] : platform === "both" ? ["gift", "bits", "subgift"] : ["gift"];
    fakeAlertSource((event) => jar.add(event), demoPace ? () => [demoPace * 0.65, demoPace * 1.35] : () => [900, 2100], demoKinds);
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
    onAlert: (event) => fonts.then(() => jar.add(event)),
    say,
  });
}
