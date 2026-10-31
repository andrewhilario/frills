// The Top Likers overlay: what a streaming app opens. A see-through page with a ranking of who sent the most likes.
//   /overlay/likers/?channel=yourname&platform=tiktok&max=5&keep=1      your account
//   add &demo=1 to see practice likes instead of a real account

import { LIKERS, LikeBoard, loadLikers, saveLikers } from "./likers.js";
import { createLikersView } from "./widgets-view.js";
import { channelFromParams, connectEvents } from "./widget-overlay.js";
import { demoLikers, fakeLikeSource } from "./fake-alerts.js";
import { createSounds } from "./sounds.js";
import { fontsReady, generalFaces } from "./look.js";

const params = new URLSearchParams(location.search);
const settings = LIKERS.sanitize(LIKERS.fromParams(params));
// ?pace=1500 makes the practice (demo) events come about that many milliseconds apart: handy for trying a look, or for filming it
const demoPace = Number(params.get("pace")) ? Math.min(10000, Math.max(300, Number(params.get("pace")))) : 0; // (no pace, or not a number: the usual speed)

const note = document.getElementById("note");
const say = (text) => { note.hidden = !text; note.textContent = text; };
const channel = channelFromParams(params);
const demo = params.get("demo") === "1";

const view = createLikersView(document.getElementById("likers"));
view.apply(settings);
const sounds = createSounds();
let saving = 0;
const board = new LikeBoard(settings, {
  // the practice page starts with a few likers, the first just short of a milestone, so the celebration can be seen
  entries: demo ? demoLikers(settings.milestone) : settings.keep && channel ? loadLikers(globalThis.localStorage, channel) : [],
  onMilestone: (person) => view.celebrate(person, { onStart: () => sounds.play(settings.celebrateSound, { volume: 70, tier: 3 }) }),
  onChange: (top) => {
    view.render(top);
    if (settings.keep && channel && !saving) saving = setTimeout(() => { saving = 0; saveLikers(globalThis.localStorage, channel, board); }, 1500);
  },
});
view.render(board.top);

if (demo) {
  fontsReady(generalFaces(settings), 1000).then(() => fakeLikeSource((event) => board.add(event), demoPace ? () => [demoPace * 0.6, demoPace * 1.4] : undefined));
} else if (!channel) {
  say("Add ?channel=yourname to this link.");
} else {
  const fonts = fontsReady(generalFaces(settings), 1000); // the connection starts at once; only drawing waits for the font
  connectEvents({ channel, events: ["like"], onAlert: (event) => fonts.then(() => board.add(event)), say });
}
