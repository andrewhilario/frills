// Editor for Stream Commands & Gear Pop-ups (Actions)
// 100% zero-account architecture: all configuration is serialized into the overlay URL (?c=...) and persisted in localStorage.

import {
  DEFAULT_PREFIX,
  DEFAULT_PACK,
  DEFAULT_DURATION,
  DEFAULT_COOLDOWN,
  DEFAULT_SOUND,
  DEFAULT_POSITION,
  PACK_MASCOTS,
  defaultActionsConfig,
  encodeCommands,
  readCommands,
  cleanTrigger,
  cleanReply,
  MAX_REPLY,
  commandProblems,
  matchCommand,
  createCooldownTracker,
} from "./actions.js";
import { createActionsView } from "./actions-view.js";
import { mountSource } from "./source.js";
import { buildControl, chips, copyButton } from "./ui.js";
import { SOUNDS } from "./alerts-settings.js";

const $ = (id) => document.getElementById(id);
const CANVASES = { vertical: [1080, 1920], landscape: [1920, 1080], square: [1080, 1080] };
const STORE_KEY = "frills.actions";

export function initActionsEditor() {
  const params = new URLSearchParams(location.search);

  // The chat-reply controls are hidden unless switched on, so putting this live changes nothing for anyone else. Open the editor with
  // ?chatbot=1 once (it is remembered in this browser); ?chatbot=0 hides them again.
  const chatbotOn = (() => {
    const asked = params.get("chatbot");
    try {
      if (asked === "1") localStorage.setItem("frills.chatbot", "1");
      if (asked === "0") localStorage.removeItem("frills.chatbot");
      return localStorage.getItem("frills.chatbot") === "1";
    } catch {
      return asked === "1"; // storage blocked: the link alone decides
    }
  })();
  document.body.dataset.chatbot = chatbotOn ? "on" : "off";

  // Load saved state or URL parameters
  const loadSaved = () => {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
    } catch {
      return null;
    }
  };
  const saved = loadSaved();

  let config = defaultActionsConfig();
  let brokenLink = false; // a link was opened but could not be read (cut off by a chat app, say)
  if (params.get("c")) {
    const read = readCommands(params.get("c"));
    config = read.config;
    brokenLink = read.state === "broken";
  } else if (saved?.config) {
    config = { ...config, ...saved.config };
    // the person's own list, even when they have deleted every command
    if (Array.isArray(saved.config.commands)) config.commands = saved.config.commands;
  }

  let cooldown = createCooldownTracker(config.cooldown);
  let view = createActionsView($("widget"), config);
  let source = null;

  function save() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          config,
          channel: source?.channel || saved?.channel || "",
          twitch: source?.twitchChannel || saved?.twitch || "",
          platform: source?.platform || saved?.platform || "tiktok",
          canvas,
        })
      );
    } catch {
      // Storage blocked or full
    }
  }

  // ── Preview stage fitting ──────────────────────────────────────────────────
  let canvas = CANVASES[saved?.canvas] ? saved.canvas : "landscape";
  function fit() {
    const [w, h] = CANVASES[canvas];
    const room = $("stage").getBoundingClientRect();
    const k = Math.max(0.05, Math.min(room.width / w, room.height / h));
    const host = $("widget");
    host.style.width = w + "px";
    host.style.height = h + "px";
    host.style.transform = `translate(-50%, -50%) scale(${k.toFixed(4)})`;
  }

  const canvasControl = buildControl(
    {
      key: "canvas",
      type: "select",
      label: "Preview as",
      options: [
        { id: "landscape", name: "Landscape, 1920 x 1080" },
        { id: "vertical", name: "Vertical LIVE, 1080 x 1920" },
        { id: "square", name: "Square, 1080 x 1080" },
      ],
      hint: "Set your streaming app Browser Source to the same resolution.",
    },
    canvas,
    (value) => {
      canvas = value;
      fit();
      save();
    }
  );
  $("preview-canvas").append(canvasControl.row);
  $("backdrop").addEventListener("change", (e) => {
    $("preview").dataset.back = e.target.value;
  });
  new ResizeObserver(fit).observe($("stage"));

  // ── Mascot & Look Pack Chips ───────────────────────────────────────────────
  const mascotOptions = [
    { id: "frog2", name: "Frog Pond", dot: "#6bb377" },
    { id: "neko", name: "Neko Cafe", dot: "#e8927c" },
    { id: "bunny", name: "Bunny Cloud", dot: "#9c88ff" },
    { id: "hamster", name: "Hamster Burrow", dot: "#f4a261" },
  ];
  chips(
    $("pack-chips"),
    mascotOptions,
    config.pack || DEFAULT_PACK,
    (item) => {
      config.pack = item.id;
      view.apply({ pack: config.pack });
      refreshLink();
      save();
      // Trigger instant preview on mascot switch
      if (config.commands.length > 0) view.trigger(config.commands[0]);
    },
    { dot: true }
  );

  // ── Prefix Selector Chips ─────────────────────────────────────────────────
  const prefixOptions = [
    { id: ".", name: ". (Dot)" },
    { id: "!", name: "! (Exclamation)" },
    { id: "?", name: "? (Question)" },
    { id: "#", name: "# (Hash)" },
    { id: "/", name: "/ (Slash)" },
    { id: "", name: "None (Raw word)" },
  ];
  const isCustomPrefix = !prefixOptions.some((p) => p.id === config.prefix);
  chips(
    $("prefix-chips"),
    prefixOptions,
    isCustomPrefix ? "." : config.prefix,
    (item) => {
      config.prefix = item.id;
      view.apply({ prefix: config.prefix });
      renderCommands();
      renderQuickTests();
      refreshLink();
      save();
    }
  );

  // ── Sound, Duration & Cooldown Controls ───────────────────────────────────
  const soundControl = buildControl(
    {
      key: "sound",
      type: "select",
      label: "Audio chime",
      options: SOUNDS,
      hint: "Plays an instant audio chime when a viewer triggers a command.",
    },
    config.sound || DEFAULT_SOUND,
    (val) => {
      config.sound = val;
      view.apply({ sound: config.sound });
      refreshLink();
      save();
    }
  );
  $("opt-controls").append(soundControl.row);

  const durationControl = buildControl(
    {
      key: "duration",
      type: "range",
      label: "Display time",
      min: 2,
      max: 20,
      step: 1,
      unit: "s",
      hint: "How long the pop-up card stays on screen before auto-dismissing.",
    },
    config.duration || DEFAULT_DURATION,
    (val) => {
      config.duration = val;
      view.apply({ duration: config.duration });
      refreshLink();
      save();
    }
  );
  $("opt-controls").append(durationControl.row);

  const cooldownControl = buildControl(
    {
      key: "cooldown",
      type: "range",
      label: "Anti-spam cooldown",
      min: 0,
      max: 60,
      step: 1,
      unit: "s",
      zero: "Off (0s)",
      hint: "Seconds before the same command can trigger again, preventing spam.",
    },
    config.cooldown ?? DEFAULT_COOLDOWN, // 0 is "Off", so it must not become the default
    (val) => {
      config.cooldown = val;
      cooldown = createCooldownTracker(config.cooldown);
      refreshLink();
      save();
    }
  );
  $("opt-controls").append(cooldownControl.row);

  const positionControl = buildControl(
    {
      key: "position",
      type: "select",
      label: "Screen position",
      options: [
        { id: "bottom-right", name: "Bottom Right" },
        { id: "bottom-left", name: "Bottom Left" },
        { id: "top-right", name: "Top Right" },
        { id: "top-left", name: "Top Left" },
        { id: "bottom-center", name: "Bottom Center" },
        { id: "top-center", name: "Top Center" },
      ],
      hint: "Where the pop-up card appears on your stream canvas.",
    },
    config.position || DEFAULT_POSITION,
    (val) => {
      config.position = val;
      view.apply({ position: config.position });
      refreshLink();
      save();
    }
  );
  $("opt-controls").append(positionControl.row);

  // ── Commands Manager ──────────────────────────────────────────────────────
  const commandsContainer = $("commands-list");

  // Says why a command would never pop up: no trigger, or a trigger another command already has (only the first one fires).
  const warnings = $("cmd-warnings");
  function renderWarnings() {
    if (!warnings) return;
    const notes = [];
    if (brokenLink) {
      notes.push("The link you opened looks cut off, so your own commands could not be read. These are the starting commands: change them, then copy a fresh link.");
    }
    const name = (i) => `"${config.commands[i]?.title || config.commands[i]?.trigger || `command ${i + 1}`}"`;
    for (const p of commandProblems(config.commands)) {
      notes.push(
        p.kind === "empty"
          ? `Command ${p.index + 1} has no trigger, so it can never pop up.`
          : `${name(p.index)} uses the trigger "${p.trigger}", which ${name(p.first)} already has. Only the first one will ever pop up.`,
      );
    }
    warnings.textContent = notes.join(" ");
    warnings.hidden = notes.length === 0;
  }

  function renderCommands() {
    commandsContainer.innerHTML = "";
    config.commands.forEach((cmd, idx) => {
      const row = document.createElement("div");
      row.className = "action-cmd-row";

      // Icon input
      const iconInput = document.createElement("input");
      iconInput.type = "text";
      iconInput.className = "action-cmd-row__icon";
      iconInput.value = cmd.icon || "✨";
      iconInput.title = "Emoji icon";
      iconInput.maxLength = 4;
      iconInput.addEventListener("input", (e) => {
        cmd.icon = e.target.value;
        refreshLink();
        save();
      });

      // Trigger input
      const triggerWrap = document.createElement("div");
      triggerWrap.className = "action-cmd-row__trigger-wrap";
      const prefixSpan = document.createElement("span");
      prefixSpan.className = "action-cmd-row__prefix";
      prefixSpan.textContent = config.prefix || "";
      const triggerInput = document.createElement("input");
      triggerInput.type = "text";
      triggerInput.className = "action-cmd-row__trigger";
      triggerInput.value = cmd.trigger || "";
      triggerInput.placeholder = "trigger (e.g. mouse)";
      triggerInput.spellcheck = false;
      triggerInput.addEventListener("input", (e) => {
        cmd.trigger = cleanTrigger(e.target.value);
        if (e.target.value !== cmd.trigger) e.target.value = cmd.trigger; // a space can never be part of a trigger
        renderWarnings();
        renderQuickTests();
        refreshLink();
        save();
      });
      triggerWrap.append(prefixSpan, triggerInput);

      // Title input
      const titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.className = "action-cmd-row__title";
      titleInput.value = cmd.title || "";
      titleInput.placeholder = "Title (e.g. Mouse & Pad)";
      titleInput.spellcheck = false;
      titleInput.addEventListener("input", (e) => {
        cmd.title = e.target.value;
        refreshLink();
        save();
      });

      // Text input
      const textInput = document.createElement("input");
      textInput.type = "text";
      textInput.className = "action-cmd-row__text";
      textInput.value = cmd.text || "";
      textInput.placeholder = "Details / specs / gear link...";
      textInput.spellcheck = false;
      textInput.addEventListener("input", (e) => {
        cmd.text = e.target.value;
        refreshLink();
        save();
      });

      // Test button
      const testBtn = document.createElement("button");
      testBtn.type = "button";
      testBtn.className = "btn btn--soft btn--sm";
      testBtn.textContent = "Try";
      testBtn.title = "Test this command on the preview stage";
      testBtn.addEventListener("click", () => {
        view.trigger(cmd);
      });

      // Delete button
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn--soft btn--sm action-cmd-row__del";
      delBtn.innerHTML = "✕";
      delBtn.title = "Delete command";
      delBtn.addEventListener("click", () => {
        config.commands.splice(idx, 1);
        renderCommands();
        renderQuickTests();
        refreshLink();
        save();
      });

      // The reply the bot posts in TikTok chat. Empty means it posts nothing for this command (the card still shows).
      const replyWrap = document.createElement("div");
      replyWrap.className = "action-cmd-row__replywrap";
      const replyInput = document.createElement("input");
      replyInput.type = "text";
      replyInput.className = "action-cmd-row__reply";
      replyInput.value = cmd.reply || "";
      replyInput.maxLength = MAX_REPLY;
      replyInput.placeholder = "Chat reply: what the bot says in your TikTok chat (empty = no chat reply)";
      replyInput.spellcheck = false;
      const replyCount = document.createElement("span");
      replyCount.className = "action-cmd-row__count";
      const countReply = () => {
        replyCount.textContent = `${Array.from(replyInput.value).length}/${MAX_REPLY}`;
      };
      countReply();
      replyInput.addEventListener("input", (e) => {
        cmd.reply = e.target.value;
        countReply();
        refreshLink();
        save();
      });
      replyWrap.append(replyInput, replyCount);

      row.append(iconInput, triggerWrap, titleInput, textInput, testBtn, delBtn, replyWrap);
      commandsContainer.append(row);
    });
    renderWarnings();
  }

  // Post the replies in the streamer's TikTok chat. The bot that posts is not connected yet, so for now this only saves the choice in the link.
  const chatToggle = $("chat-on");
  if (chatToggle) {
    chatToggle.checked = Boolean(config.chat);
    chatToggle.addEventListener("change", () => {
      config.chat = chatToggle.checked;
      refreshLink();
      save();
    });
  }

  $("add-cmd-btn").addEventListener("click", () => {
    config.commands.push({
      trigger: "new" + (config.commands.length + 1),
      title: "New Command",
      text: "Details about this command",
      icon: "✨",
      reply: "",
    });
    renderCommands();
    renderQuickTests();
    refreshLink();
    save();
  });

  $("reset-cmds-btn").addEventListener("click", () => {
    brokenLink = false;
    config = defaultActionsConfig();
    cooldown = createCooldownTracker(config.cooldown);
    view.apply(config);
    if (chatToggle) chatToggle.checked = Boolean(config.chat);
    renderCommands();
    renderQuickTests();
    refreshLink();
    save();
  });

  // ── Quick Test Buttons in Preview Bar ─────────────────────────────────────
  function renderQuickTests() {
    const bar = $("quick-tests");
    bar.innerHTML = "";
    const pref = config.prefix || "";
    config.commands.slice(0, 4).forEach((cmd) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--soft btn--sm";
      btn.textContent = `Test ${pref}${cmd.trigger}`;
      btn.addEventListener("click", () => {
        view.trigger(cmd);
      });
      bar.append(btn);
    });
  }

  // ── Live Chat Simulator ───────────────────────────────────────────────────
  const simInput = $("sim-input");
  const simSend = $("sim-send");
  const simFeedback = $("sim-feedback");

  function runSimChat() {
    const raw = simInput.value.trim();
    if (!raw) return;
    simInput.value = "";

    const match = matchCommand(raw, config.commands, config.prefix);
    if (!match) {
      const sample = config.commands[0]?.trigger ? `${config.prefix || ""}${config.commands[0].trigger}` : ".mouse";
      simFeedback.textContent = `No command matched "${raw}". Try typing "${sample}".`;
      simFeedback.dataset.state = "error";
      return;
    }

    if (!cooldown.canTrigger(match.trigger)) {
      const left = cooldown.remaining(match.trigger);
      simFeedback.textContent = `Cooldown active! (${left}s remaining to prevent chat spam).`;
      simFeedback.dataset.state = "cooldown";
      return;
    }

    cooldown.record(match.trigger);
    view.trigger(match);
    const said = chatbotOn ? cleanReply(match.reply) : "";
    const chatLine = said
      ? config.chat
        ? ` In your TikTok chat the bot would say: "${said}"`
        : " (It has a chat reply: turn on chat replies above to post it in chat.)"
      : "";
    simFeedback.textContent = `Triggered ${config.prefix || ""}${match.trigger}! (Playing chime & showing card)${chatLine}`;
    simFeedback.dataset.state = "success";
  }

  simSend.addEventListener("click", runSimChat);
  simInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSimChat();
  });

  // ── Stream Source Connector ───────────────────────────────────────────────
  const handleChat = (m) => {
    if (!m || !m.text) return;
    const match = matchCommand(m.text, config.commands, config.prefix);
    if (match && cooldown.canTrigger(match.trigger)) {
      cooldown.record(match.trigger);
      view.trigger(match);
    }
  };

  source = mountSource($("source"), {
    feeds: [{ add: handleChat, removeById() {}, removeUser() {}, clear() {} }],
    pace: () => [2000, 4000],
    channel: params.get("channel") || saved?.channel || "",
    twitch: params.get("twitch") || saved?.twitch || "",
    platform: params.get("platform") || saved?.platform || "tiktok",
    platforms: ["tiktok", "twitch", "both"],
    autoconnect: Boolean(params.get("channel")),
    tools: false,
    idleHint: "Until you connect, the simulator and test buttons let you try your commands instantly.",
  });

  // ── Copy Link Generator ───────────────────────────────────────────────────
  const linkInput = $("link");
  const copyBtn = $("copy-link");
  copyButton(copyBtn, () => linkInput.value);

  function refreshLink() {
    const channel = source ? source.cleanChannel() : "";
    const twitchChan = source ? source.twitchChannel?.trim() : "";
    const platform = source ? source.platform : "tiktok";

    if (!channel && !twitchChan) {
      linkInput.value = "";
      copyBtn.disabled = true;
      $("link-hint").textContent = "Your link appears here once you type your TikTok or Twitch handle in step 3.";
      return;
    }

    const b64 = encodeCommands(config);
    let query = `?c=${encodeURIComponent(b64)}`;
    if (platform === "both") {
      const channels = source.cleanChannels();
      if (channels.tiktok) query += `&tiktok=${encodeURIComponent(channels.tiktok)}`;
      if (channels.twitch) query += `&twitch=${encodeURIComponent(channels.twitch)}`;
    } else if (platform === "twitch") {
      query += `&channel=${encodeURIComponent(channel)}&platform=twitch`;
    } else {
      query += `&channel=${encodeURIComponent(channel)}&platform=tiktok`;
    }

    linkInput.value = `${location.origin}/overlay/actions/${query}`;
    copyBtn.disabled = false;
    $("link-hint").textContent = "Paste this URL into a Browser Source in OBS, Streamlabs, or TikTok LIVE Studio.";
  }

  linkInput.addEventListener("focus", () => linkInput.select());
  source.onChange(() => {
    refreshLink();
    save();
  });

  // Initial renders
  renderCommands();
  renderQuickTests();
  fit();
  refreshLink();

  // Initial preview popup to greet user
  setTimeout(() => {
    if (config.commands.length > 0) view.trigger(config.commands[0]);
  }, 400);
}

document.addEventListener("DOMContentLoaded", initActionsEditor);
