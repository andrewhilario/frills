// The subathon timer overlay: what a streaming app opens. A see-through page with a countdown that the streamer starts from the editor, and that
// grows when viewers send gifts (and, if wanted, follows and shares).
//   /overlay/timer/?channel=yourname&platform=tiktok&code=...      your account; the code joins it to the editor's Start button
//   add &demo=1 to see a practice timer that gets practice gifts

import { TIMER, SubTimer, formatClock } from "./timer.js";
import { createTimerView } from "./widgets-view.js";
import { channelFromParams, connectEvents } from "./widget-overlay.js";
import { readCommands, validCode } from "./timer-bridge.js";
import { fakeAlertSource } from "./fake-alerts.js";
import { fontsReady, generalFaces } from "./look.js";

const params = new URLSearchParams(location.search);
const settings = TIMER.sanitize(TIMER.fromParams(params));
const demoPace = Number(params.get("pace")) ? Math.min(10000, Math.max(300, Number(params.get("pace")))) : 0;

const note = document.getElementById("note");
const say = (text) => { note.hidden = !text; note.textContent = text; };
const channel = channelFromParams(params);
const demo = params.get("demo") === "1";
const code = validCode(settings.code);

const view = createTimerView(document.getElementById("timer"));
view.apply(settings);
const timer = new SubTimer(settings, { onAdd: (seconds) => view.pop(seconds) });

// A reload carries on from where the clock was: a running clock is kept as the moment it ends, and the number of the last command obeyed is kept too.
const storeKey = `frills:timer:state:${code || channel || "demo"}`;
let seq = null;
if (!demo) {
  try {
    const saved = JSON.parse(localStorage.getItem(storeKey) ?? "null");
    timer.restore(saved);
    if (Number.isFinite(saved?.seq)) seq = saved.seq;
  } catch { /* nothing usable was kept */ }
}
const save = () => { if (!demo) try { localStorage.setItem(storeKey, JSON.stringify({ ...timer.save(), seq })); } catch { /* storage can be blocked */ } };
const draw = () => {
  const now = Date.now();
  timer.tick(now);
  view.render({ text: formatClock(timer.remaining(now), settings.hours), status: timer.state(now) });
};
draw();
setInterval(() => { draw(); save(); }, 250);

if (demo) {
  fontsReady(generalFaces(settings), 1000).then(() => {
    timer.start(Date.now());
    fakeAlertSource((event) => { timer.handle(event, Date.now()); draw(); }, demoPace ? () => [demoPace * 0.6, demoPace * 1.4] : undefined, ["gift", "follow"]);
  });
} else if (!channel) {
  say("Add ?channel=yourname to this link.");
} else {
  const fonts = fontsReady(generalFaces(settings), 1000); // the connection starts at once; only drawing waits for the font
  connectEvents({ channel, events: ["gift", "follow", "share"], onAlert: (event) => fonts.then(() => { timer.handle(event, Date.now()); draw(); save(); }), say });
}
if (!demo && code) {
  readCommands({
    code,
    seq,
    onCommand: (command) => { timer.command(command, Date.now()); draw(); save(); },
    onSeq: (n) => { seq = n; save(); },
  });
}
