// Overlay runner for Stream Commands & Gear Pop-ups (Actions)
// Loaded in OBS Studio, Streamlabs, or TikTok LIVE Studio Browser Source.
// Connects to TikTok LIVE and/or Twitch chat, listens for configured commands, and triggers on-screen cards with sounds.

import { readCommands, matchCommand, createCooldownTracker } from "./actions.js";
import { createActionsView } from "./actions-view.js";
import { sourcesOf } from "./both.js";
import { connectTo, statusText } from "./connect.js";
import { relayForPage } from "./tiktok.js";

const $ = (id) => document.getElementById(id);

export function startActionsOverlay() {
  const params = new URLSearchParams(location.search);
  const { config, state } = readCommands(params.get("c") || "");

  const stage = $("action-stage") || document.body;
  const note = $("note");

  const say = (text) => {
    if (!note) return;
    note.textContent = text;
    note.hidden = !text;
  };

  // A link that is cut off, or has no commands in it, must not put the sample gear on stream: do nothing, and say why.
  if (state !== "ok") {
    say(
      state === "broken"
        ? "This link looks cut off. Copy it again from the Frills commands editor."
        : "This link has no commands in it. Make yours in the Frills commands editor.",
    );
    return;
  }

  const cooldown = createCooldownTracker(config.cooldown);
  const view = createActionsView(stage, config);

  function handleMessage(m) {
    if (!m || !m.text) return;
    const match = matchCommand(m.text, config.commands, config.prefix);
    if (match && cooldown.canTrigger(match.trigger)) {
      cooldown.record(match.trigger);
      view.trigger(match);
    }
  }

  const feed = {
    add: handleMessage,
    removeById() {},
    removeUser() {},
    clear() {},
  };

  const sources = sourcesOf(params);
  if (!sources.length) {
    say("Type your TikTok or Twitch name in the Frills actions editor to connect chat.");
    return;
  }

  const connections = [];
  const relay = relayForPage();

  sources.forEach(({ platform, channel }) => {
    const conn = connectTo(
      [feed],
      platform,
      channel,
      (status) => {
        if (status.state === "connected" || status.state === "stopped") {
          say("");
        } else {
          say(statusText(status));
        }
      },
      {
        relay,
        keepTrying: true,
        assumeRelay: true,
        events: [],
      }
    );
    connections.push(conn);
  });

  window.addEventListener("beforeunload", () => {
    connections.forEach((c) => c?.stop?.());
    view.destroy();
  });
}

document.addEventListener("DOMContentLoaded", startActionsOverlay);
