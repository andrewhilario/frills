// OBS & Stream Actions overlay (/overlay/actions/): transparent Browser Source for OBS Studio.
// Listens to TikTok LIVE, Twitch, or Both chat commands & stream events and runs configured OBS WebSocket v5
// actions (clips, instant replay cam, scenes, sources, filters, mute, media, text, hotkeys) plus Frills sounds/banners.
// Free links run up to 10 actions; Frills Plus cloud overlays (/o/<id>) and Plus links unlock unlimited actions.

import {
  ACTIONS,
  ActionEngine,
  FREE_ACTIONS_LIMIT,
  FREE_STICKY_NOTES_LIMIT,
  PLUS_ACTIONS_LIMIT,
  createObsStepExecutor,
  createVtsStepExecutor,
  decodeRules,
  hasFreeVtsSteps,
  hasVtsSteps,
} from "./actions.js";
import { ObsClient, localSecretsFromHash } from "./obs-ws.js";
import { VtsClient } from "./vts-ws.js";
import { createActionsView } from "./widgets-view.js";
import { bothFromParams, channelFromParams, connectEvents, platformFromParams } from "./widget-overlay.js";
import { isPlusCode, plusCodeFromParams } from "./plus-relay.js";
import { createSounds } from "./sounds.js";
import { fontsReady, generalFaces } from "./look.js";

const params = new URLSearchParams(location.search);
const platform = platformFromParams(params);
const both = bothFromParams(params);
const settings = ACTIONS.sanitize(ACTIONS.fromParams(params));
const isPlus = params.has("_cv") || isPlusCode(plusCodeFromParams(params));
const limit = isPlus ? PLUS_ACTIONS_LIMIT : FREE_ACTIONS_LIMIT;
const rules = decodeRules(settings.rules, { limit });
const { obsPass: obsPassword, vtsToken } = localSecretsFromHash(location.hash);

const note = document.getElementById("note");
const say = (text) => { if (!note) return; note.hidden = !text; note.textContent = text; };
const channel = channelFromParams(params, platform);
const demo = params.get("demo") === "1";

const sounds = createSounds();
const view = createActionsView(document.getElementById("actions"));
view.apply(settings);

const needsObs = rules.some((r) => r.enabled && r.steps.some((s) => s.type.startsWith("obs.")));
let obs = null;
if (!demo && needsObs) {
  obs = new ObsClient({
    port: settings.obsPort,
    password: obsPassword,
    reconnect: true,
    onStatus: async ({ state, detail }) => {
      if (state === "connected") {
        say("");
        if (settings.obsAutoStart) {
          const st = await obs.call("GetReplayBufferStatus").catch(() => null);
          if (st && !st.outputActive) obs.call("StartReplayBuffer").catch(() => {});
        }
      } else if (state === "auth-error") {
        say(detail || "OBS WebSocket password was rejected.");
      }
    },
  });
  obs.connect().catch(() => {});
}

// Free links connect to VTube Studio for live named sticky notes (up to 5 on screen at once);
// Frills Plus unlocks unlimited sticky notes plus all other VTS actions (hotkeys, props, expressions, moves, tints).
const needsVts = isPlus ? hasVtsSteps(rules) : hasFreeVtsSteps(rules);
let vts = null;
if (!demo && needsVts) {
  vts = new VtsClient({
    port: settings.vtsPort,
    token: vtsToken,
    reconnect: true,
    interactiveAuth: false,
    onStatus: ({ state, detail }) => {
      if (state === "auth-error") say(detail || "VTube Studio token missing. Reconnect in the Actions editor.");
    },
  });
  vts.connect().catch(() => {});
}

const obsExecutor = createObsStepExecutor(obs, {
  defaultReplaySource: () => settings.replaySource || "Frills Replay Cam",
  previewFallback: demo,
  onReplayStart: (info) => view.showReplay(info),
  onReplayEnd: () => view.hideReplay(),
  onToast: (t) => view.showToast(t),
});

const vtsExecutor = createVtsStepExecutor(vts, {
  previewFallback: demo,
  maxStickyNotes: isPlus ? 0 : FREE_STICKY_NOTES_LIMIT,
  allowPlusShapes: isPlus || demo,
  onToast: (t) => view.showToast(t),
});

const engine = new ActionEngine({
  rules,
  limit,
  allowVts: isPlus || demo,
  channel: both ? both.tiktok : channel,
  runObs: (step, runCtx) => obsExecutor.run(step, runCtx),
  runVts: (step, runCtx) => vtsExecutor.run(step, runCtx),
  playSound: (soundId, opts) => { if (soundId && soundId !== "none") sounds.play(soundId, { volume: opts?.volume ?? 75, tier: 2 }); },
  showBanner: (banner) => view.showToast(banner),
});

window.addEventListener("frills:cloud-cmd", (e) => {
  const raw = String(e.detail?.cmd ?? "");
  if (raw.startsWith("actions:run:")) {
    const ruleId = raw.slice("actions:run:".length).trim();
    if (ruleId) engine.runRule(ruleId, { who: "Stream Deck", label: "Remote tap" });
  } else if (raw === "actions:clear") {
    obsExecutor.clear();
    vtsExecutor.clear();
    engine.clear();
    view.clear();
  }
});

window.addEventListener("pagehide", () => {
  obsExecutor.clear();
  vtsExecutor.clear();
  engine.clear();
  obs?.close();
  vts?.close();
});

if (demo) {
  fontsReady(generalFaces(settings), 1000).then(() => {
    let step = 0;
    const cycle = () => {
      if (step % 2 === 0) {
        view.showToast({ title: "Clip saved", text: "Pond Pal · !clip", fx: "sparkles", ms: 3200 });
      } else {
        view.showReplay({ badge: "REPLAY", who: "Mochi Bun", label: "Galaxy" });
        setTimeout(() => view.hideReplay(), 3200);
      }
      step += 1;
    };
    cycle();
    setInterval(cycle, 5000);
  });
} else if (!channel) {
  say("Add ?channel=yourname to this link.");
} else {
  const fonts = fontsReady(generalFaces(settings), 1000);
  const events = platform === "twitch"
    ? ["follow", "sub", "subgift", "bits", "raid"]
    : platform === "both"
      ? ["follow", "gift", "share", "like", "sub", "subgift", "bits", "raid"]
      : ["follow", "gift", "share", "like"];
  connectEvents({
    channel,
    platform,
    both,
    events,
    onChat: (msg) => fonts.then(() => engine.handleChat(msg)),
    onAlert: (ev) => fonts.then(() => engine.handleEvent(ev)),
    say,
  });
}
