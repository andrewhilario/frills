// The rotating Top Gifters and Likers overlay: what a streaming app opens. A see-through page that shows the top gifters, then the top likers, and back.
//   /overlay/leaderboard/?channel=yourname&platform=tiktok&seconds=15&keep=1      your account
//   add &demo=1 to see practice gifts and likes instead of a real account

import { BOARDS, Boards, boardsOn, loadBoards, saveBoards } from "./boards.js";
import { createBoardsView } from "./widgets-view.js";
import { channelFromParams, connectEvents } from "./widget-overlay.js";
import { fakeAlert, fakeLikeSource, practiceName } from "./fake-alerts.js";
import { fontsReady, generalFaces } from "./look.js";

const params = new URLSearchParams(location.search);
const settings = BOARDS.sanitize(BOARDS.fromParams(params));
// ?pace=1500 makes the practice (demo) events come about that many milliseconds apart: handy for trying a look, or for filming it
const demoPace = Number(params.get("pace")) ? Math.min(10000, Math.max(300, Number(params.get("pace")))) : 0; // (no pace, or not a number: the usual speed)

const note = document.getElementById("note");
const say = (text) => { note.hidden = !text; note.textContent = text; };
const channel = channelFromParams(params);
const demo = params.get("demo") === "1";

const view = createBoardsView(document.getElementById("boards"));
view.apply(settings);
let saving = 0;
const boards = new Boards(settings, {
  entries: settings.keep && channel && !demo ? loadBoards(globalThis.localStorage, channel) : {},
  onChange: (now) => {
    view.show(now);
    if (settings.keep && channel && !demo && !saving) saving = setTimeout(() => { saving = 0; saveBoards(globalThis.localStorage, channel, boards); }, 1500);
  },
});
view.show(boards.view);

// The rankings take turns. (One ranking on: nothing to take turns with.)
if (boardsOn(settings).length > 1) setInterval(() => boards.next(), Math.max(5, settings.seconds) * 1000);

if (demo) {
  // practice: a handful of made-up people send gifts and likes, so both rankings fill and change
  fontsReady(generalFaces(settings), 1000).then(() => {
    const pace = demoPace ? () => [demoPace * 0.6, demoPace * 1.4] : undefined;
    fakeLikeSource((event) => boards.add(event), pace);
    const gift = () => { boards.add(fakeAlert("gift", { name: practiceName() })); setTimeout(gift, demoPace ? demoPace * (0.8 + Math.random() * 0.8) : 700 + Math.random() * 1300); };
    setTimeout(gift, 300);
  });
} else if (!channel) {
  say("Add ?channel=yourname to this link.");
} else {
  const fonts = fontsReady(generalFaces(settings), 1000); // the connection starts at once; only drawing waits for the font
  connectEvents({ channel, events: ["gift", "like"], onAlert: (event) => fonts.then(() => boards.add(event)), say });
}
