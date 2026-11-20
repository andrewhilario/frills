// The Rotating Highlights editor page: configure sliding/rotational cards for Last Gift, Last Follower, Top Gifter, Top Liker (TikTok)
// and Last Follower, Last Sub, Last Bits, Top Sub Gifter, Top Bit Sender (Twitch), including optional in-editor Twitch Follow login.

import { LABELS, LabelBoard } from "./labels.js";
import { createLabelsView } from "./widgets-view.js";
import { startWidgetEditor } from "./widget-editor.js";
import { demoLabelEvents, fakeAlert, fakeLike } from "./fake-alerts.js";
import { mountFollowBox } from "./twitch-follow-box.js";

let board = null;
let followBox = null;

const editor = startWidgetEditor({
  widget: LABELS,
  storeKey: "frills:labels:v1",
  overlayPath: "/overlay/labels/",
  platforms: ["tiktok", "twitch"],
  events: (p) => (p === "twitch" ? ["sub", "subgift", "bits"] : ["gift", "follow", "like"]),
  extraUrlParams: ({ platform }) => {
    const follows = followBox?.codeFor(platform);
    return follows ? { follows } : {};
  },
  idleHint: (p) => (p === "twitch"
    ? "Type your Twitch channel, or test each slide above. Log in below to include Twitch follows."
    : "Type your TikTok name, or frills_demo to see practice gifts and follows. The test buttons above work without connecting."),
  create(host, settings, ctx) {
    const view = createLabelsView(host);
    board = new LabelBoard(settings, {
      platform: ctx.platform(),
      onChange: (snap) => view.render(snap),
    });
    for (const seed of demoLabelEvents(ctx.platform())) board.add(seed);
    view.apply(settings);
    view.render(board.snapshot());

    return {
      apply(next) {
        view.apply(next);
        board.setSettings(next);
      },
      onPlatform(platform) {
        board.setPlatform(platform);
        if (board.cards().length === 0) {
          for (const seed of demoLabelEvents(platform)) board.add(seed);
        }
        followBox?.sync();
      },
      onEvent: (event) => board.add(event),
      tests: {
        gift: () => board.add(fakeAlert("gift")),
        follow: () => board.add(fakeAlert("follow")),
        likes: () => board.add(fakeLike({ count: 25 })),
        sub: () => board.add(fakeAlert("sub", { resub: Math.random() < 0.45 })),
        subgift: () => board.add(fakeAlert("subgift")),
        bits: () => board.add(fakeAlert("bits")),
        next: () => board.next(),
        clear: () => board.clear(),
      },
    };
  },
});

followBox = mountFollowBox({
  getPlatform: () => editor.platform(),
  onFollow: (event) => board?.add(event),
  onChanged: () => editor.refreshLink(),
});
followBox.sync();
editor.refreshLink();
