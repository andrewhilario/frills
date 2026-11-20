// The Rotating Highlights overlay: what a streaming app opens. Cycles smoothly through Last Gift, Last Follower, Top Gifter, Top Liker
// (TikTok LIVE) or Last Follower, Last Sub, Last Bits, Top Sub Gifter, and Top Bit Sender (Twitch).
//   /overlay/labels/?channel=yourname&platform=tiktok&rotateSec=6
//   /overlay/labels/?channel=yourchannel&platform=twitch&follows=CODE
//   add &demo=1 for practice events instead of a real stream

import { LABELS, LabelBoard, loadLabels, saveLabels } from "./labels.js";
import { createLabelsView } from "./widgets-view.js";
import { channelFromParams, connectEvents, platformFromParams } from "./widget-overlay.js";
import { demoLabelEvents, fakeLabelSource } from "./fake-alerts.js";
import { fontsReady, generalFaces } from "./look.js";
import { FollowReader, validCode } from "./follow-bridge.js";

const params = new URLSearchParams(location.search);
const platform = platformFromParams(params);
const settings = LABELS.sanitize(LABELS.fromParams(params));
const demoPace = Number(params.get("pace")) ? Math.min(10000, Math.max(300, Number(params.get("pace")))) : 0;

const note = document.getElementById("note");
const say = (text) => { note.hidden = !text; note.textContent = text; };
const channel = channelFromParams(params, platform);
const demo = params.get("demo") === "1";
const followsCode = platform === "twitch" ? validCode(params.get("follows")) : "";

const view = createLabelsView(document.getElementById("labels"));
view.apply(settings);
let saving = 0;

const board = new LabelBoard(settings, {
  platform,
  initial: !demo && settings.keep && channel ? loadLabels(globalThis.localStorage, platform, channel) : null,
  onChange: (snap) => {
    view.render(snap);
    if (!demo && settings.keep && channel && !saving) {
      saving = setTimeout(() => { saving = 0; saveLabels(globalThis.localStorage, platform, channel, board); }, 1500);
    }
  },
});

if (demo) {
  for (const seed of demoLabelEvents(platform)) board.add(seed);
  view.render(board.snapshot());
  fontsReady(generalFaces(settings), 1000).then(() => {
    fakeLabelSource((event) => board.add(event), platform, demoPace ? () => [demoPace * 0.6, demoPace * 1.4] : undefined);
  });
} else {
  view.render(board.snapshot());
  if (!channel) {
    say("Add ?channel=yourname to this link.");
  } else {
    const fonts = fontsReady(generalFaces(settings), 1000);
    if (followsCode) {
      new FollowReader({
        code: followsCode,
        onFollow: (f) => fonts.then(() => board.add({ kind: "follow", id: f.id, user: f.user, name: f.name, avatar: "" })),
      }).start();
    }
    connectEvents({
      channel,
      platform,
      events: platform === "twitch" ? ["sub", "subgift", "bits"] : ["gift", "follow", "like"],
      onAlert: (event) => fonts.then(() => board.add(event)),
      say,
    });
  }
}
