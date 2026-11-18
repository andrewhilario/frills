// The Gift Jar overlay (TikTok LIVE only): transparent Browser source showing gifts filling a custom themed jar.
//   /overlay/jar/?channel=yourname&design=boba&target=1000
//   add &demo=1 (with optional &pace=1200) to drop practice gifts on loop.

import { JAR, GiftJar, loadJar, saveJar } from "./jar.js";
import { createJarView } from "./widgets-view.js";
import { channelFromParams, connectEvents } from "./widget-overlay.js";
import { fakeAlertSource } from "./fake-alerts.js";
import { createSounds } from "./sounds.js";
import { fontsReady, generalFaces } from "./look.js";

const params = new URLSearchParams(location.search);
const settings = JAR.sanitize(JAR.fromParams(params));
const demoPace = Number(params.get("pace")) ? Math.min(10000, Math.max(300, Number(params.get("pace")))) : 0;

const note = document.getElementById("note");
const say = (text) => { note.hidden = !text; note.textContent = text; };
const channel = channelFromParams(params);
const demo = params.get("demo") === "1";

const sounds = createSounds();
const view = createJarView(document.getElementById("jar"));
view.apply(settings);

const remembered = !demo && settings.keep && channel ? loadJar(globalThis.localStorage, channel) : null;
let saving = 0;

const jar = new GiftJar(settings, {
  total: remembered?.total ?? 0,
  target: remembered?.target,
  jarsCompleted: remembered?.jarsCompleted ?? 0,
  items: remembered?.items ?? [],
  onDrop: (item) => view.drop(item),
  onChange: (snapshot) => {
    view.render(snapshot);
    if (!demo && settings.keep && channel && !saving) {
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

if (demo) {
  fontsReady(generalFaces(settings), 1000).then(() => {
    fakeAlertSource((event) => jar.add(event), demoPace ? () => [demoPace * 0.65, demoPace * 1.35] : () => [900, 2100], ["gift"]);
  });
} else if (!channel) {
  say("Add ?channel=yourname to this link.");
} else {
  const fonts = fontsReady(generalFaces(settings), 1000);
  connectEvents({
    channel,
    events: ["gift"],
    onAlert: (event) => fonts.then(() => jar.add(event)),
    say,
  });
}
