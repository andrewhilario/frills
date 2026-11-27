// OBS & VTube Studio Actions editor (/actions/): connect OBS Studio via WebSocket v5 and VTube Studio via
// Public API v1.0, auto-discover live scenes/sources/filters/hotkeys/VTS items & expressions, 1-click Replay Cam
// setup, visual "When → Do" rule builder (10 actions free · unlimited + live VTS with Frills Plus), and live log.

import { countPrompt } from "./stats.js";
import { closePlusModal, openPlusModal } from "./plus-modal.js";
import {
  ACTIONS,
  ACTION_STARTERS,
  ACTION_TRIGGERS,
  ACTION_TYPES,
  ActionEngine,
  BANNER_FX,
  COMMAND_ROLES,
  FREE_ACTIONS_LIMIT,
  FREE_STICKY_NOTES_LIMIT,
  MAX_STEPS_PER_RULE,
  PLUS_ACTIONS_LIMIT,
  VTS_MOVE_PRESETS,
  VTS_STICKY_COLORS,
  VTS_STICKY_PIN_MODES,
  VTS_STICKY_SHAPES,
  cleanCommandWord,
  cleanObsPort,
  cleanVtsPort,
  createObsStepExecutor,
  createVtsStepExecutor,
  decodeRules,
  encodeRules,
  hasFreeVtsSteps,
  hasPlusStickyShape,
  hasPlusVtsSteps,
  isPlusStickyShape,
  isPlusVtsStep,
  sanitizeRule,
  sanitizeRules,
  sanitizeStep,
  triggerSummary,
} from "./actions.js";
import { COMMON_GIFTS } from "./timer.js";
import { SOUNDS } from "./alerts-settings.js";
import { OBS_DEFAULT_PORT, ObsClient, withLocalSecretsHash } from "./obs-ws.js";
import { SLOBS_DEFAULT_PORT, SlobsClient, cleanSlobsPort } from "./slobs-ws.js";
import { VtsClient } from "./vts-ws.js";
import { createActionsView } from "./widgets-view.js";
import { startWidgetEditor } from "./widget-editor.js";
import { fakeAlert } from "./fake-alerts.js";
import { createSounds } from "./sounds.js";
import { copyText } from "./ui.js";
import { el } from "./feed.js";

const $ = (id) => document.getElementById(id);
const PASS_STORE_KEY = "frills:actions:obs-pass:v1";
const SLOBS_TOKEN_STORE_KEY = "frills:actions:slobs-token:v1";
const VTS_TOKEN_STORE_KEY = "frills:actions:vts-token:v1";
const sounds = createSounds();

function loadStored(key) {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
}
function saveStored(key, val) {
  try {
    if (val) localStorage.setItem(key, val);
    else localStorage.removeItem(key);
  } catch { /* storage blocked */ }
}

let obsPass = loadStored(PASS_STORE_KEY);
let slobsToken = loadStored(SLOBS_TOKEN_STORE_KEY);
let vtsToken = loadStored(VTS_TOKEN_STORE_KEY);
let activeObsApp = "obs";
const activeStudioSecret = () => (activeObsApp === "slobs" ? slobsToken : obsPass);
let latestRefreshLink = () => {};

startWidgetEditor({
  widget: ACTIONS,
  storeKey: "frills:actions:editor:v1",
  overlayPath: "/overlay/actions/",
  platforms: ["tiktok", "twitch", "both"],
  events: (p) => (p === "twitch"
    ? ["follow", "sub", "subgift", "bits", "raid"]
    : p === "both"
      ? ["follow", "gift", "share", "like", "sub", "subgift", "bits", "raid"]
      : ["follow", "gift", "share", "like"]),
  needs: "roles",
  idleHint: (p) => (p === "twitch"
    ? "Type your Twitch channel, or press Test on any action above without connecting."
    : p === "both"
      ? "Type your TikTok @name and Twitch channel so commands and gifts from both trigger your actions."
      : "Type your TikTok name, or frills_demo for made-up events. Every Test button works without connecting."),
  urlTransform: (url) => withLocalSecretsHash(url, { obsPass: activeStudioSecret(), vtsToken }),
  create(host, settings, ctx) {
    let current = settings;
    let plusActive = false;
    let plusEligible = false;
    let plusChecked = false;
    let rules = decodeRules(settings.rules, { limit: FREE_ACTIONS_LIMIT });
    let openRuleId = rules[0]?.id ?? "";

    const ACTIONS_PLUS_PERKS = [
      { lead: "Unlimited OBS & VTS actions", text: `Go past the ${FREE_ACTIONS_LIMIT}-action free limit with up to ${PLUS_ACTIONS_LIMIT} custom When → Do rules.` },
      { lead: "Full VTube Studio control", text: "Trigger VTS hotkeys, item props, expressions, zooms/flips, and color tints live from gifts, bits, subs, or chat." },
      { lead: "Custom sticker shapes & unlimited notes", text: "Unlock heart, star, chibi paw, and cloud shapes plus unlimited viewer stickers stacking on your avatar." },
    ];
    const openActionsPlusModal = (title, summary, moment = "vts_locked") => {
      openPlusModal({
        title,
        summary,
        perks: ACTIONS_PLUS_PERKS,
        moment,
        eligible: plusEligible,
        checked: plusChecked,
      });
    };

    const limitNow = () => (plusActive ? PLUS_ACTIONS_LIMIT : FREE_ACTIONS_LIMIT);
    const view = createActionsView(host);
    view.apply(settings);

    const logList = $("act-log");
    const logEntries = [];
    const pushLog = (entry) => {
      const time = new Date(entry.at || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      logEntries.unshift({ ...entry, time });
      if (logEntries.length > 20) logEntries.length = 20;
      if (!logList) return;
      logList.replaceChildren(...logEntries.map((item) => {
        const li = el("li", { className: "act-log__item" });
        li.dataset.status = item.status || "ok";
        li.append(
          el("span", { className: "act-log__time", textContent: item.time }),
          el("strong", { className: "act-log__rule", textContent: item.ruleName || "Action" }),
          el("span", { className: "act-log__detail", textContent: `${item.who ? `${item.who} · ` : ""}${item.detail || ""}` }),
        );
        return li;
      }));
    };

    // ── Live OBS Studio / Streamlabs Desktop connection & auto-discovery ───────────────────────────────────────
    activeObsApp = settings.obsApp === "slobs" ? "slobs" : "obs";
    const obsAppSelect = $("obs-app");
    const obsPortLabel = $("obs-port-label");
    const obsPassLabel = $("obs-pass-label");
    const obsStatusEl = $("obs-status");
    const obsConnectBtn = $("obs-connect");
    const obsToolsEl = $("obs-tools");
    const obsReplaySub = $("obs-replay-sub");
    const obsRbText = $("obs-rb-text");
    const obsRbStartBtn = $("obs-start-rb");
    const obsReplayMsg = $("obs-replay-msg");
    const obsRefreshBtn = $("obs-refresh");

    const setObsMsg = (text, state = "") => {
      if (!obsStatusEl) return;
      obsStatusEl.dataset.state = state;
      obsStatusEl.textContent = text;
    };

    const fillDatalist = (id, items) => {
      const dl = $(id);
      if (!dl) return;
      dl.replaceChildren(...items.map((v) => el("option", { value: v })));
    };
    fillDatalist("obs-gifts-dl", COMMON_GIFTS);

    const idleStudioMsg = () => (activeObsApp === "slobs"
      ? "Not connected. Open Streamlabs Desktop → Settings → Mobile (or Remote Control) → click QR code → Show Details → copy API Token."
      : "Not connected. Open OBS → Tools → WebSocket Server Settings to connect.");
    const studioConnectLabel = (connected) => (activeObsApp === "slobs"
      ? (connected ? "Disconnect Streamlabs" : "Connect Streamlabs")
      : (connected ? "Disconnect OBS" : "Connect OBS"));

    const handleStudioStatus = (kind) => ({ state, detail }) => {
      if (kind !== activeObsApp) return;
      if (state === "connected") {
        setObsMsg(detail, "connected");
        if (obsConnectBtn) obsConnectBtn.textContent = studioConnectLabel(true);
        if (obsToolsEl) obsToolsEl.hidden = false;
      } else if (state === "connecting") {
        setObsMsg(detail, "");
        if (obsConnectBtn) obsConnectBtn.textContent = "Connecting…";
      } else if (state === "auth-error" || state === "error") {
        setObsMsg(detail, "error");
        if (obsConnectBtn) obsConnectBtn.textContent = studioConnectLabel(false);
        if (obsToolsEl) obsToolsEl.hidden = true;
      } else {
        setObsMsg(detail || idleStudioMsg(), "");
        if (obsConnectBtn) obsConnectBtn.textContent = studioConnectLabel(false);
        if (obsToolsEl) obsToolsEl.hidden = true;
      }
    };

    const obsClient = new ObsClient({
      port: settings.obsApp === "slobs" ? OBS_DEFAULT_PORT : settings.obsPort,
      password: obsPass,
      reconnect: false,
      onStatus: handleStudioStatus("obs"),
    });
    const slobsClient = new SlobsClient({
      port: settings.obsApp === "slobs" ? settings.obsPort : SLOBS_DEFAULT_PORT,
      token: slobsToken,
      reconnect: false,
      onStatus: handleStudioStatus("slobs"),
    });
    const activeClient = () => (activeObsApp === "slobs" ? slobsClient : obsClient);
    const obs = {
      get kind() { return activeObsApp; },
      get connected() { return activeClient().connected; },
      get version() { return activeClient().version; },
      call: (...args) => activeClient().call(...args),
      waitForEvent: (...args) => activeClient().waitForEvent(...args),
      discover: (...args) => activeClient().discover(...args),
      getFilters: (...args) => activeClient().getFilters(...args),
      ensureReplayCam: (...args) => activeClient().ensureReplayCam(...args),
      connect: () => activeClient().connect(),
      close: () => activeClient().close(),
    };

    const refreshObsDiscovery = async () => {
      const client = activeClient();
      if (!client.connected) return;
      try {
        const info = await client.discover();
        fillDatalist("obs-scenes-dl", info.scenes);
        fillDatalist("obs-sources-dl", info.sources);
        fillDatalist("obs-inputs-dl", info.inputs);
        fillDatalist("obs-media-dl", info.mediaInputs.length ? info.mediaInputs : info.sources);
        fillDatalist("obs-text-dl", info.textInputs.length ? info.textInputs : info.sources);
        fillDatalist("obs-hotkeys-dl", info.hotkeys);
        const appName = activeObsApp === "slobs" ? "Streamlabs Desktop" : `OBS ${client.version || "v5"}`;
        setObsMsg(`Connected to ${appName} · ${info.scenes.length} scene(s), ${info.sources.length} source(s) loaded.`, "connected");
        if (obsRbText && obsRbStartBtn) {
          if (!info.replayBufferSupported) {
            obsRbText.textContent = activeObsApp === "slobs"
              ? "Replay Buffer is off in Streamlabs Settings → Output → Replay Buffer."
              : "Replay Buffer is off in OBS Settings → Output → Replay Buffer.";
            obsRbStartBtn.hidden = true;
          } else if (info.replayBufferActive) {
            obsRbText.textContent = activeObsApp === "slobs"
              ? "Replay Buffer is running and ready for automatic !clip."
              : "Replay Buffer is running and ready for !clip & !replay.";
            obsRbStartBtn.hidden = true;
          } else {
            obsRbText.textContent = activeObsApp === "slobs"
              ? "Replay Buffer is enabled in Streamlabs, but stopped right now."
              : "Replay Buffer is enabled in OBS, but stopped right now.";
            obsRbStartBtn.hidden = false;
          }
        }
      } catch { /* keep connected status */ }
    };

    const obsExecutor = createObsStepExecutor(obs, {
      defaultReplaySource: () => current.replaySource || "Frills Replay Cam",
      previewFallback: true,
      onReplayStart: (info) => view.showReplay(info),
      onReplayEnd: () => view.hideReplay(),
      onToast: (t) => view.showToast(t),
    });

    // ── Live VTube Studio Public API v1.0 connection & discovery (Frills Plus live · testable in editor) ───────
    const vtsPortInput = $("vts-port");
    const vtsConnectBtn = $("vts-connect");
    const vtsStatusEl = $("vts-status");
    const vtsToolsEl = $("vts-tools");
    const vtsForgetBtn = $("vts-forget");
    const vtsPlusNote = $("vts-plus-note");

    const setVtsMsg = (text, state = "") => {
      if (!vtsStatusEl) return;
      vtsStatusEl.dataset.state = state;
      vtsStatusEl.textContent = text;
    };

    const syncVtsForget = () => {
      if (vtsForgetBtn) vtsForgetBtn.hidden = !vtsToken;
    };
    syncVtsForget();

    const vts = new VtsClient({
      port: settings.vtsPort,
      token: vtsToken,
      reconnect: false,
      interactiveAuth: true,
      onToken: (tok) => {
        vtsToken = tok;
        saveStored(VTS_TOKEN_STORE_KEY, tok);
        syncVtsForget();
        ctx.refresh();
        latestRefreshLink();
      },
      onStatus: ({ state, detail }) => {
        if (state === "connected") {
          setVtsMsg(detail, "connected");
          if (vtsConnectBtn) vtsConnectBtn.textContent = "Disconnect VTS";
          if (vtsToolsEl) vtsToolsEl.hidden = false;
        } else if (state === "connecting") {
          setVtsMsg(detail, "");
          if (vtsConnectBtn) vtsConnectBtn.textContent = "Connecting…";
        } else if (state === "auth-error" || state === "error") {
          setVtsMsg(detail, "error");
          if (vtsConnectBtn) vtsConnectBtn.textContent = "Connect VTube Studio";
          if (vtsToolsEl) vtsToolsEl.hidden = true;
        } else {
          setVtsMsg(detail || "Not connected. Turn on Settings → General → Start API (allow plugins) in VTube Studio.", "");
          if (vtsConnectBtn) vtsConnectBtn.textContent = "Connect VTube Studio";
          if (vtsToolsEl) vtsToolsEl.hidden = true;
        }
      },
    });

    const refreshVtsDiscovery = async () => {
      if (!vts.connected) return;
      try {
        const info = await vts.discover();
        fillDatalist("vts-hotkeys-dl", info.hotkeys.map((h) => h.name));
        fillDatalist("vts-expressions-dl", info.expressions.map((e) => e.name || e.file));
        fillDatalist("vts-items-dl", info.items);
        fillDatalist("vts-meshes-dl", info.artMeshes);
        const modelLabel = info.modelLoaded && info.modelName ? `Model “${info.modelName}” · ` : "";
        setVtsMsg(`Connected to VTube Studio · ${modelLabel}${info.hotkeys.length} hotkey(s), ${info.expressions.length} expression(s), ${info.items.length} item(s).`, "connected");
      } catch { /* keep connected status */ }
    };

    const vtsExecutor = createVtsStepExecutor(vts, {
      previewFallback: true,
      maxStickyNotes: FREE_STICKY_NOTES_LIMIT,
      onToast: (t) => view.showToast(t),
      onStickyPreview: (note) => view.showSticky(note),
    });

    const engine = new ActionEngine({
      rules,
      limit: FREE_ACTIONS_LIMIT,
      allowVts: true, // editor always lets you test-drive VTS rules live on your avatar
      channel: ctx.channel(),
      runObs: (step, runCtx) => obsExecutor.run(step, runCtx),
      runVts: (step, runCtx) => vtsExecutor.run(step, runCtx),
      playSound: (soundId, opts) => { if (soundId && soundId !== "none") sounds.play(soundId, { volume: opts?.volume ?? 75, tier: 2 }); },
      showBanner: (banner) => view.showToast(banner),
      onLog: pushLog,
    });

    // ── Wire Step 2 (OBS & VTube Studio Setup) inputs ───────────────────────────────────────────────────────────
    const obsPortInput = $("obs-port");
    const obsPassInput = $("obs-pass");
    const obsPassToggle = $("obs-pass-toggle");
    const obsAutoStartInput = $("obs-autostart");
    const obsReplayInput = $("obs-replay-name");
    const obsReplayLayout = $("obs-replay-layout");

    const syncDeviceInputs = () => {
      activeObsApp = current.obsApp === "slobs" ? "slobs" : "obs";
      const isSlobs = activeObsApp === "slobs";
      if (obsAppSelect) obsAppSelect.value = activeObsApp;
      if (obsPortLabel) obsPortLabel.textContent = isSlobs ? "Streamlabs API port" : "OBS WebSocket port";
      if (obsPassLabel) obsPassLabel.textContent = isSlobs ? "API Token (stays on your PC)" : "Password (stays on your PC)";
      if (obsPortInput) obsPortInput.value = String(current.obsPort ?? (isSlobs ? SLOBS_DEFAULT_PORT : OBS_DEFAULT_PORT));
      if (obsPassInput) {
        obsPassInput.value = isSlobs ? slobsToken : obsPass;
        obsPassInput.placeholder = isSlobs ? "Paste token from Settings → Mobile → Show Details" : "Leave blank if off";
      }
      if (obsAutoStartInput) obsAutoStartInput.checked = current.obsAutoStart !== false;
      if (obsReplayInput) obsReplayInput.value = current.replaySource || "Frills Replay Cam";
      if (obsReplaySub) obsReplaySub.hidden = isSlobs;
      if (obsRefreshBtn) obsRefreshBtn.textContent = isSlobs ? "Refresh Streamlabs lists" : "Refresh OBS lists";
      if (obsConnectBtn) obsConnectBtn.textContent = studioConnectLabel(activeClient().connected);
      if (obsToolsEl) obsToolsEl.hidden = !activeClient().connected;
      if (!activeClient().connected) setObsMsg(idleStudioMsg(), "");
      if (vtsPortInput) vtsPortInput.value = String(current.vtsPort ?? 8001);
    };
    syncDeviceInputs();

    obsAppSelect?.addEventListener("change", () => {
      const prev = activeObsApp;
      const next = obsAppSelect.value === "slobs" ? "slobs" : "obs";
      if (next === prev) return;
      activeClient().close();
      current.obsApp = next;
      activeObsApp = next;
      if (next === "slobs" && Number(current.obsPort) === OBS_DEFAULT_PORT) current.obsPort = SLOBS_DEFAULT_PORT;
      else if (next === "obs" && Number(current.obsPort) === SLOBS_DEFAULT_PORT) current.obsPort = OBS_DEFAULT_PORT;
      syncDeviceInputs();
      ctx.refresh();
      ctx.save();
      latestRefreshLink();
    });

    obsPortInput?.addEventListener("input", () => {
      current.obsPort = activeObsApp === "slobs" ? cleanSlobsPort(obsPortInput.value) : cleanObsPort(obsPortInput.value);
      activeClient().configure({ port: current.obsPort });
      ctx.refresh();
      ctx.save();
    });
    obsPassInput?.addEventListener("input", () => {
      if (activeObsApp === "slobs") {
        slobsToken = obsPassInput.value.trim();
        saveStored(SLOBS_TOKEN_STORE_KEY, slobsToken);
        slobsClient.configure({ token: slobsToken });
      } else {
        obsPass = obsPassInput.value;
        saveStored(PASS_STORE_KEY, obsPass);
        obsClient.configure({ password: obsPass });
      }
      ctx.refresh();
      latestRefreshLink();
    });
    obsPassToggle?.addEventListener("click", () => {
      if (!obsPassInput) return;
      const show = obsPassInput.type === "password";
      obsPassInput.type = show ? "text" : "password";
      obsPassToggle.textContent = show ? "Hide" : "Show";
    });
    obsAutoStartInput?.addEventListener("change", () => {
      current.obsAutoStart = obsAutoStartInput.checked;
      ctx.refresh();
      ctx.save();
    });
    obsReplayInput?.addEventListener("input", () => {
      current.replaySource = obsReplayInput.value.trim().slice(0, 60) || "Frills Replay Cam";
      ctx.refresh();
      ctx.save();
    });
    obsConnectBtn?.addEventListener("click", async () => {
      const client = activeClient();
      if (client.connected) {
        client.close();
        return;
      }
      if (activeObsApp === "slobs") {
        slobsClient.configure({ port: current.obsPort, token: slobsToken });
      } else {
        obsClient.configure({ port: current.obsPort, password: obsPass });
      }
      try {
        await client.connect();
        await refreshObsDiscovery();
        if (current.obsAutoStart) {
          const st = await client.call("GetReplayBufferStatus").catch(() => null);
          if (st && !st.outputActive) {
            await client.call("StartReplayBuffer").catch(() => {});
            await refreshObsDiscovery();
          }
        }
      } catch { /* status already shown */ }
    });
    obsRbStartBtn?.addEventListener("click", async () => {
      try {
        await activeClient().call("StartReplayBuffer");
        await refreshObsDiscovery();
      } catch (err) {
        if (obsRbText) obsRbText.textContent = err?.message || "Could not start Replay Buffer.";
      }
    });
    $("obs-make-replay")?.addEventListener("click", async () => {
      if (!obs.connected) return;
      const btn = $("obs-make-replay");
      btn.disabled = true;
      try {
        const res = await obs.ensureReplayCam({
          sourceName: current.replaySource || "Frills Replay Cam",
          layout: obsReplayLayout?.value === "full" ? "full" : "pip",
        });
        if (obsReplayMsg) {
          obsReplayMsg.dataset.state = "connected";
          obsReplayMsg.textContent = `${res.created ? "Created" : "Ready"} “${res.sourceName}” in scene “${res.sceneName}” (hidden until triggered).`;
        }
        await refreshObsDiscovery();
      } catch (err) {
        if (obsReplayMsg) {
          obsReplayMsg.dataset.state = "error";
          obsReplayMsg.textContent = err?.message || "Could not create Replay Cam source in OBS.";
        }
      } finally {
        btn.disabled = false;
      }
    });
    $("obs-refresh")?.addEventListener("click", () => void refreshObsDiscovery());

    vtsPortInput?.addEventListener("input", () => {
      current.vtsPort = cleanVtsPort(vtsPortInput.value);
      vts.configure({ port: current.vtsPort });
      ctx.refresh();
      ctx.save();
    });
    vtsConnectBtn?.addEventListener("click", async () => {
      if (vts.connected) {
        vts.close();
        return;
      }
      vts.configure({ port: current.vtsPort, token: vtsToken });
      try {
        await vts.connect();
        await refreshVtsDiscovery();
      } catch { /* status already shown */ }
    });
    $("vts-refresh")?.addEventListener("click", () => void refreshVtsDiscovery());
    $("vts-clear-items")?.addEventListener("click", async () => {
      if (!vts.connected) return;
      try {
        await vts.call("ItemUnloadRequest", {
          unloadAllInScene: false,
          unloadAllLoadedByThisPlugin: true,
          allowUnloadingItemsLoadedByUserOrOtherPlugins: false,
          instanceIDs: [],
          fileNames: [],
        });
        vtsExecutor.clearStickyTracking();
        view.clearStickies();
        pushLog({ ruleName: "VTube Studio", who: "Editor", status: "ok", detail: "Cleared Frills sticky notes & props from avatar" });
      } catch (err) {
        setVtsMsg(err?.message || "Could not clear VTS items.", "error");
      }
    });
    vtsForgetBtn?.addEventListener("click", () => {
      vts.close();
      vtsToken = "";
      saveStored(VTS_TOKEN_STORE_KEY, "");
      vts.configure({ token: "" });
      syncVtsForget();
      ctx.refresh();
      latestRefreshLink();
      setVtsMsg("Saved VTube Studio token cleared. Click Connect VTube Studio to pair again.", "");
    });

    // Manual sticky note slap (for missed gifts, tips, or custom shoutouts using your current sticky note style & size)
    const vtsManualName = $("vts-manual-name");
    const vtsManualGift = $("vts-manual-gift");
    const vtsManualAdd = $("vts-manual-add");
    const runManualSticky = async () => {
      const who = (vtsManualName?.value ?? "").trim().slice(0, 48);
      if (!who) {
        vtsManualName?.focus();
        setVtsMsg("Type the viewer’s name first to pin a manual sticky note.", "error");
        return;
      }
      const gift = (vtsManualGift?.value ?? "").trim().slice(0, 48);
      const soundReady = sounds.unlock();
      const stickyRule = rules.find((r) => r.steps.some((s) => s.type === "vts.sticky"));
      const baseStep = stickyRule?.steps.find((s) => s.type === "vts.sticky")
        ?? sanitizeStep({ type: "vts.sticky", title: "{name}", subtitle: "{gift}", shape: "note", color: "random", pinMode: "face", size: 22 });
      const step = sanitizeStep({ ...baseStep, title: "{name}", subtitle: gift ? "{gift}" : "" });
      if (vtsManualAdd) vtsManualAdd.disabled = true;
      try {
        const res = await vtsExecutor.run(step, { who, name: who, gift, label: gift || "Manual", ruleName: "Manual sticky note" });
        soundReady.then(() => sounds.play("pop", { volume: 75, tier: 2 }));
        pushLog({ ruleName: "Manual sticky note", who, status: res?.ok === false ? "error" : "ok", detail: res?.detail || "Pinned" });
        if (res?.ok !== false && vtsManualName) {
          vtsManualName.value = "";
          if (vtsManualGift) vtsManualGift.value = "";
        }
      } catch (err) {
        const detail = err?.message || "Could not pin sticky note.";
        pushLog({ ruleName: "Manual sticky note", who, status: "error", detail });
        setVtsMsg(detail, "error");
      } finally {
        if (vtsManualAdd) vtsManualAdd.disabled = false;
      }
    };
    vtsManualAdd?.addEventListener("click", () => void runManualSticky());
    const submitManualOnEnter = (e) => { if (e.key === "Enter") { e.preventDefault(); void runManualSticky(); } };
    vtsManualName?.addEventListener("keydown", submitManualOnEnter);
    vtsManualGift?.addEventListener("keydown", submitManualOnEnter);

    // ── Step 3: Visual "When → Do" Rule Builder (10 Free · Unlimited + Live VTS with Plus) ──────────────────────
    const startersHost = $("act-starters");
    const rulesHost = $("act-rules");
    const countBadge = $("act-count");
    const limitNote = $("act-limit-note");
    limitNote?.addEventListener("click", (event) => { if (event.target.closest?.('a[href="/plus/"]')) countPrompt("action_limit", "clicked"); });
    $("vts-plus-note")?.addEventListener("click", (event) => { if (event.target.closest?.('a[href="/plus/"]')) countPrompt("vts_locked", "clicked"); });
    const addBlankBtn = $("act-add-blank");
    const exportBtn = $("act-export");
    const importBtn = $("act-import");
    const importBox = $("act-import-box");
    const importArea = $("act-import-text");
    const importApply = $("act-import-apply");
    const importMsg = $("act-import-msg");

    const syncQuotaUi = () => {
      const cap = limitNow();
      const atFreeCap = !plusActive && rules.length >= FREE_ACTIONS_LIMIT;
      if (countBadge) {
        countBadge.textContent = plusActive
          ? `${rules.length} · Unlimited (Plus)`
          : `${rules.length} / ${FREE_ACTIONS_LIMIT} free`;
      }
      if (addBlankBtn) {
        addBlankBtn.disabled = plusActive && rules.length >= PLUS_ACTIONS_LIMIT;
        addBlankBtn.textContent = atFreeCap ? "+ Add action (Plus)" : "+ Add action";
      }
      if (startersHost) {
        for (const btn of startersHost.querySelectorAll("button")) {
          btn.disabled = plusActive && rules.length >= PLUS_ACTIONS_LIMIT;
          if (btn.dataset.plusStarter === "1") {
            btn.textContent = plusActive ? btn.dataset.baseChip : `${btn.dataset.baseChip} (Plus)`;
          }
        }
      }
      if (limitNote) {
        limitNote.hidden = !atFreeCap;
        if (atFreeCap) {
          limitNote.replaceChildren();
          const showPlus = document.body?.dataset?.plusAccounts === "on" && plusEligible;
          if (showPlus) {
            countPrompt("action_limit", "shown");
            limitNote.append(
              `You’ve used all ${FREE_ACTIONS_LIMIT} free actions. `,
              el("a", { href: "/plus/", textContent: "Upgrade to Frills Plus" }),
              " for unlimited actions, live VTube Studio, and Phone Stream Deck triggers.",
            );
          } else {
            limitNote.textContent = `You’ve reached the ${FREE_ACTIONS_LIMIT}-action free limit. Edit or delete an action below to add another.`;
          }
        }
      }
      if (vtsPlusNote) {
        const hasPlusVts = hasPlusVtsSteps(rules);
        const hasFreeSticky = hasFreeVtsSteps(rules);
        const hasPlusShape = hasPlusStickyShape(rules);
        const needsNotice = !plusActive && (hasPlusVts || hasFreeSticky);
        vtsPlusNote.hidden = !needsNotice;
        if (needsNotice) {
          vtsPlusNote.replaceChildren();
          const showPlus = document.body?.dataset?.plusAccounts === "on" && plusEligible;
          if (showPlus) countPrompt("vts_locked", "shown");
          if (hasPlusVts) {
            if (showPlus) {
              vtsPlusNote.append(
                "Named pastel sticky notes run live for free (up to 5 on your face at once). Live stream execution for custom sticker shapes, VTS hotkeys, props, expressions, zooms, and tints—plus unlimited sticky notes—unlocks with ",
                el("a", { href: "/plus/", textContent: "Frills Plus" }),
                ".",
              );
            } else {
              vtsPlusNote.textContent = "Named pastel sticky notes run live for free (up to 5 on your face at once). Live stream execution for custom sticker shapes and other VTube Studio actions requires Frills Plus.";
            }
          } else if (hasPlusShape) {
            if (showPlus) {
              vtsPlusNote.append(
                "Heart, star, paw, and cloud sticker shapes preview free here, and free live links fall back cleanly to classic pastel notes (up to 5 at once). ",
                el("a", { href: "/plus/", textContent: "Upgrade to Frills Plus" }),
                " to pin custom sticker shapes + unlimited sticky notes live.",
              );
            } else {
              vtsPlusNote.textContent = "Custom sticker shapes preview free here; free live links fall back cleanly to classic pastel sticky notes. Frills Plus unlocks all sticker shapes and unlimited notes live.";
            }
          } else if (showPlus) {
            vtsPlusNote.append(
              `Free links keep up to ${FREE_STICKY_NOTES_LIMIT} pastel sticky notes on your face at once (oldest peels off on the 6th). `,
              el("a", { href: "/plus/", textContent: "Upgrade to Frills Plus" }),
              " for custom sticker shapes, unlimited sticky notes piling up + all VTube Studio actions.",
            );
          } else {
            vtsPlusNote.textContent = `Free links keep up to ${FREE_STICKY_NOTES_LIMIT} pastel sticky notes on your face at once (oldest peels off when a 6th arrives). Frills Plus unlocks custom shapes and unlimited sticky notes.`;
          }
        }
      }
    };

    const commitRules = ({ rerender = false } = {}) => {
      const cap = limitNow();
      if (rerender) rules = sanitizeRules(rules, { limit: cap, allowEmpty: true });
      current.rules = encodeRules(rules, { limit: cap });
      engine.setRules(rules, { limit: cap });
      ctx.refresh();
      ctx.save();
      syncQuotaUi();
      if (rerender) renderRules();
    };

    const addRule = (templateRule) => {
      if (!plusActive && (templateRule?.steps ?? []).some(isPlusVtsStep)) {
        openActionsPlusModal(
          "Subscribe for full VTube Studio actions",
          "Pastel viewer sticky notes stay free (up to 5 on your face at once). Subscribe to Frills Plus to add VTS hotkeys, props, expressions, avatar zooms/flips, and color tints.",
          "vts_locked",
        );
        return;
      }
      const cap = limitNow();
      if (rules.length >= cap) {
        if (!plusActive) {
          openActionsPlusModal(
            "Subscribe for unlimited OBS & VTS actions",
            `Your first ${FREE_ACTIONS_LIMIT} OBS & sticky-note actions stay free forever. Subscribe to Frills Plus to add more than ${FREE_ACTIONS_LIMIT} actions.`,
            "action_limit",
          );
        }
        syncQuotaUi();
        return;
      }
      const id = `r${Date.now().toString(36).slice(-4)}${Math.floor(Math.random() * 90 + 10)}`;
      const cloned = sanitizeRule({ ...JSON.parse(JSON.stringify(templateRule)), id }, rules.length);
      rules.push(cloned);
      openRuleId = cloned.id;
      commitRules({ rerender: true });
    };

    if (startersHost) {
      for (const starter of ACTION_STARTERS) {
        const isPlusStarter = (starter.rule?.steps ?? []).some(isPlusVtsStep);
        const btn = el("button", {
          type: "button",
          className: "chip items__preset act-starter",
          textContent: isPlusStarter ? `${starter.chip} (Plus)` : starter.chip,
        });
        btn.dataset.baseChip = starter.chip;
        if (isPlusStarter) btn.dataset.plusStarter = "1";
        btn.addEventListener("click", () => addRule(starter.rule));
        startersHost.append(btn);
      }
    }

    const fieldRow = (labelText, controlEl) => {
      const wrap = el("label", { className: "act-field" });
      wrap.append(el("span", { className: "act-field__label", textContent: labelText }), controlEl);
      return wrap;
    };

    const makeSelect = (options, value, onChange) => {
      const s = el("select");
      for (const [id, name] of options) s.append(el("option", { value: id, textContent: name }));
      s.value = value;
      s.addEventListener("change", () => onChange(s.value));
      return s;
    };

    const makeInput = ({ value = "", type = "text", placeholder = "", list = "", min, max, maxLength, onInput }) => {
      const inp = el("input", { type, value: String(value), placeholder, autocomplete: "off", spellcheck: false });
      if (list) inp.setAttribute("list", list);
      if (min !== undefined) inp.min = String(min);
      if (max !== undefined) inp.max = String(max);
      if (maxLength !== undefined) inp.maxLength = maxLength;
      if (type === "number") inp.inputMode = "numeric";
      inp.addEventListener("input", () => onInput(inp.value));
      return inp;
    };

    const renderTriggerFields = (hostEl, rule, summaryBadge) => {
      hostEl.replaceChildren();
      const t = rule.trigger;
      const updateBadge = () => { summaryBadge.textContent = triggerSummary(rule.trigger); };

      if (t.kind === "command") {
        hostEl.append(
          fieldRow("Command (after !)", makeInput({
            value: t.command,
            placeholder: "clip",
            maxLength: 20,
            onInput: (v) => { t.command = cleanCommandWord(v, "clip"); updateBadge(); commitRules(); },
          })),
          fieldRow("Who can run it", makeSelect(COMMAND_ROLES, t.who, (v) => { t.who = v; commitRules(); })),
        );
      } else if (t.kind === "gift") {
        hostEl.append(
          fieldRow("Gift name (blank = any)", makeInput({
            value: t.giftName,
            placeholder: "e.g. Rose or Galaxy",
            list: "obs-gifts-dl",
            maxLength: 40,
            onInput: (v) => { t.giftName = v.trim().slice(0, 40); updateBadge(); commitRules(); },
          })),
          fieldRow("Min diamonds", makeInput({
            type: "number",
            value: t.minDiamonds,
            min: 1,
            max: 1000000,
            onInput: (v) => { t.minDiamonds = Math.max(1, Math.round(Number(v) || 1)); updateBadge(); commitRules(); },
          })),
        );
      } else if (t.kind === "like") {
        hostEl.append(fieldRow("Run every N likes", makeInput({
          type: "number",
          value: t.minLikes,
          min: 10,
          max: 1000000,
          onInput: (v) => { t.minLikes = Math.max(10, Math.round(Number(v) || 500)); updateBadge(); commitRules(); },
        })));
      } else if (t.kind === "subgift") {
        hostEl.append(fieldRow("Min gifted subs", makeInput({
          type: "number",
          value: t.minCount,
          min: 1,
          max: 1000,
          onInput: (v) => { t.minCount = Math.max(1, Math.round(Number(v) || 1)); updateBadge(); commitRules(); },
        })));
      } else if (t.kind === "bits") {
        hostEl.append(fieldRow("Min bits", makeInput({
          type: "number",
          value: t.minBits,
          min: 1,
          max: 1000000,
          onInput: (v) => { t.minBits = Math.max(1, Math.round(Number(v) || 100)); updateBadge(); commitRules(); },
        })));
      } else if (t.kind === "raid") {
        hostEl.append(fieldRow("Min raiders", makeInput({
          type: "number",
          value: t.minViewers,
          min: 1,
          max: 100000,
          onInput: (v) => { t.minViewers = Math.max(1, Math.round(Number(v) || 2)); updateBadge(); commitRules(); },
        })));
      }
    };

    const renderStepFields = (hostEl, step) => {
      hostEl.replaceChildren();
      if (step.type === "obs.clip") {
        hostEl.append(fieldRow("Toast text (blank = silent)", makeInput({
          value: step.toast,
          placeholder: "Clip saved · {name}",
          maxLength: 80,
          onInput: (v) => { step.toast = v.slice(0, 80); commitRules(); },
        })));
      } else if (step.type === "obs.replay") {
        hostEl.append(
          fieldRow("Replay Media Source", makeInput({
            value: step.source,
            placeholder: "Frills Replay Cam",
            list: "obs-media-dl",
            maxLength: 60,
            onInput: (v) => { step.source = v.trim().slice(0, 60) || "Frills Replay Cam"; commitRules(); },
          })),
          fieldRow("Speed % (75 = slow-mo)", makeInput({
            type: "number",
            value: step.speed,
            min: 25,
            max: 150,
            onInput: (v) => { step.speed = Math.min(150, Math.max(25, Math.round(Number(v) || 100))); commitRules(); },
          })),
          fieldRow("Max duration (sec)", makeInput({
            type: "number",
            value: step.maxSec,
            min: 5,
            max: 60,
            onInput: (v) => { step.maxSec = Math.min(60, Math.max(5, Math.round(Number(v) || 20))); commitRules(); },
          })),
          fieldRow("Badge label", makeInput({
            value: step.badge,
            placeholder: "REPLAY",
            maxLength: 32,
            onInput: (v) => { step.badge = v.trim().slice(0, 32) || "REPLAY"; commitRules(); },
          })),
        );
      } else if (step.type === "obs.scene") {
        hostEl.append(
          fieldRow("OBS Scene name", makeInput({
            value: step.scene,
            placeholder: "Zoom Cam",
            list: "obs-scenes-dl",
            maxLength: 60,
            onInput: (v) => { step.scene = v.trim().slice(0, 60); commitRules(); },
          })),
          fieldRow("Switch back after (sec, 0 = stay)", makeInput({
            type: "number",
            value: step.duration,
            min: 0,
            max: 300,
            onInput: (v) => { step.duration = Math.min(300, Math.max(0, Math.round(Number(v) || 0))); commitRules(); },
          })),
        );
      } else if (step.type === "obs.source") {
        hostEl.append(
          fieldRow("OBS Source name", makeInput({
            value: step.source,
            placeholder: "Webcam or Meme Overlay",
            list: "obs-sources-dl",
            maxLength: 60,
            onInput: (v) => { step.source = v.trim().slice(0, 60); commitRules(); },
          })),
          fieldRow("Action", makeSelect([["show", "Show"], ["hide", "Hide"], ["toggle", "Toggle"]], step.mode, (v) => { step.mode = v; commitRules(); })),
          fieldRow("Revert after (sec, 0 = stay)", makeInput({
            type: "number",
            value: step.duration,
            min: 0,
            max: 300,
            onInput: (v) => { step.duration = Math.min(300, Math.max(0, Math.round(Number(v) || 0))); commitRules(); },
          })),
          fieldRow("Scene (blank = current)", makeInput({
            value: step.scene,
            placeholder: "Current scene",
            list: "obs-scenes-dl",
            maxLength: 60,
            onInput: (v) => { step.scene = v.trim().slice(0, 60); commitRules(); },
          })),
        );
      } else if (step.type === "obs.filter") {
        const srcInput = makeInput({
          value: step.source,
          placeholder: "Webcam",
          list: "obs-sources-dl",
          maxLength: 60,
          onInput: (v) => { step.source = v.trim().slice(0, 60); commitRules(); },
        });
        const loadFilters = async () => {
          if (!obs.connected || !step.source) return;
          fillDatalist("obs-filters-dl", await obs.getFilters(step.source));
        };
        srcInput.addEventListener("change", () => void loadFilters());
        const filterInput = makeInput({
          value: step.filter,
          placeholder: "Blur",
          list: "obs-filters-dl",
          maxLength: 60,
          onInput: (v) => { step.filter = v.trim().slice(0, 60); commitRules(); },
        });
        filterInput.addEventListener("focus", () => void loadFilters());
        hostEl.append(
          fieldRow("Source / Scene", srcInput),
          fieldRow("Filter name", filterInput),
          fieldRow("Mode", makeSelect([["on", "Turn on"], ["off", "Turn off"], ["toggle", "Toggle"]], step.mode, (v) => { step.mode = v; commitRules(); })),
          fieldRow("Revert after (sec, 0 = stay)", makeInput({
            type: "number",
            value: step.duration,
            min: 0,
            max: 300,
            onInput: (v) => { step.duration = Math.min(300, Math.max(0, Math.round(Number(v) || 0))); commitRules(); },
          })),
        );
      } else if (step.type === "obs.mute") {
        hostEl.append(
          fieldRow("Audio source", makeInput({
            value: step.source,
            placeholder: "Mic/Aux",
            list: "obs-inputs-dl",
            maxLength: 60,
            onInput: (v) => { step.source = v.trim().slice(0, 60); commitRules(); },
          })),
          fieldRow("Mode", makeSelect([["mute", "Mute"], ["unmute", "Unmute"], ["toggle", "Toggle"]], step.mode, (v) => { step.mode = v; commitRules(); })),
          fieldRow("Revert after (sec, 0 = stay)", makeInput({
            type: "number",
            value: step.duration,
            min: 0,
            max: 300,
            onInput: (v) => { step.duration = Math.min(300, Math.max(0, Math.round(Number(v) || 0))); commitRules(); },
          })),
        );
      } else if (step.type === "obs.media") {
        hostEl.append(
          fieldRow("OBS Media Source", makeInput({
            value: step.source,
            placeholder: "Meme Video",
            list: "obs-media-dl",
            maxLength: 60,
            onInput: (v) => { step.source = v.trim().slice(0, 60); commitRules(); },
          })),
          fieldRow("Max seconds", makeInput({
            type: "number",
            value: step.maxSec,
            min: 3,
            max: 120,
            onInput: (v) => { step.maxSec = Math.min(120, Math.max(3, Math.round(Number(v) || 15))); commitRules(); },
          })),
          fieldRow("Scene (blank = current)", makeInput({
            value: step.scene,
            placeholder: "Current scene",
            list: "obs-scenes-dl",
            maxLength: 60,
            onInput: (v) => { step.scene = v.trim().slice(0, 60); commitRules(); },
          })),
        );
      } else if (step.type === "obs.text") {
        hostEl.append(
          fieldRow("OBS Text Source", makeInput({
            value: step.source,
            placeholder: "Shoutout Text",
            list: "obs-text-dl",
            maxLength: 60,
            onInput: (v) => { step.source = v.trim().slice(0, 60); commitRules(); },
          })),
          fieldRow("New text ({name}, {gift}, {text})", makeInput({
            value: step.text,
            placeholder: "{name}: {text}",
            maxLength: 140,
            onInput: (v) => { step.text = v.slice(0, 140); commitRules(); },
          })),
        );
      } else if (step.type === "obs.hotkey") {
        hostEl.append(fieldRow("OBS Hotkey name", makeInput({
          value: step.hotkey,
          placeholder: "OBSBasic.Screenshot",
          list: "obs-hotkeys-dl",
          maxLength: 80,
          onInput: (v) => { step.hotkey = v.trim().slice(0, 80); commitRules(); },
        })));
      } else if (step.type === "vts.sticky") {
        const meshInput = makeInput({
          value: step.artMesh,
          placeholder: "Blank = auto face",
          list: "vts-meshes-dl",
          maxLength: 80,
          onInput: (v) => { step.artMesh = v.trim().slice(0, 80); commitRules(); },
        });
        const pickMeshBtn = el("button", { type: "button", className: "btn btn--soft btn--sm", textContent: "Pick in VTS" });
        pickMeshBtn.addEventListener("click", async () => {
          if (!vts.connected) {
            setVtsMsg("Connect VTube Studio in Step 2 first to pick a face mesh.", "error");
            return;
          }
          pickMeshBtn.disabled = true;
          pickMeshBtn.textContent = "Pick inside VTS…";
          try {
            const picked = await vts.pickFaceArtMesh(step.artMesh);
            if (picked) {
              step.artMesh = picked;
              meshInput.value = picked;
              commitRules();
            }
          } catch (err) {
            setVtsMsg(err?.message || "Could not open VTube Studio ArtMesh picker.", "error");
          } finally {
            pickMeshBtn.disabled = false;
            pickMeshBtn.textContent = "Pick in VTS";
          }
        });
        const meshRow = el("span", { className: "act-pass-row" }, meshInput, pickMeshBtn);
        const sizePresets = [["XS", 10], ["S", 18], ["M", 26], ["L", 40], ["XL", 60]];
        const curSize = Math.min(100, Math.max(5, Math.round(Number(step.size) || 22)));
        const sizeValEl = el("span", { className: "act-size-val", textContent: `${curSize}%` });
        const sizeSlider = el("input", { type: "range", min: 5, max: 100, step: 1, value: String(curSize) });
        sizeSlider.setAttribute("aria-label", "Sticky note size percent");
        const sizeChips = el("div", { className: "act-size-chips" });
        const sizeBtns = sizePresets.map(([lbl, val]) => {
          const btn = el("button", { type: "button", className: "act-size-chip", textContent: `${lbl} · ${val}%` });
          btn.dataset.val = String(val);
          btn.dataset.on = String(curSize === val);
          btn.addEventListener("click", () => applyStickySize(val));
          return btn;
        });
        sizeChips.append(...sizeBtns);
        const applyStickySize = (raw) => {
          const next = Math.min(100, Math.max(5, Math.round(Number(raw) || 22)));
          step.size = next;
          sizeSlider.value = String(next);
          sizeValEl.textContent = `${next}%`;
          for (const b of sizeBtns) b.dataset.on = String(Number(b.dataset.val) === next);
          view.setStickySize(next);
          commitRules();
        };
        sizeSlider.addEventListener("input", () => applyStickySize(sizeSlider.value));
        const sizeBox = el("div", { className: "act-size-box" }, el("div", { className: "act-size-row" }, sizeSlider, sizeValEl), sizeChips);
        const shapeSelect = makeSelect(VTS_STICKY_SHAPES, step.shape || "note", (v) => {
          if (!plusActive && isPlusStickyShape(v)) {
            shapeSelect.value = step.shape || "note";
            openActionsPlusModal(
              "Subscribe for custom sticker shapes",
              "Classic pastel sticky notes stay free (up to 5 on your face at once). Subscribe to Frills Plus to unlock Heart, Star, Chibi Paw, Dreamy Cloud, and Random shapes.",
              "vts_locked",
            );
            return;
          }
          step.shape = v;
          commitRules();
        });
        hostEl.append(
          fieldRow("Name on note ({name}, {gift}, {text})", makeInput({
            value: step.title,
            placeholder: "{name}",
            maxLength: 48,
            onInput: (v) => { step.title = v.slice(0, 48); commitRules(); },
          })),
          fieldRow("Second line (optional)", makeInput({
            value: step.subtitle,
            placeholder: "{gift}",
            maxLength: 48,
            onInput: (v) => { step.subtitle = v.slice(0, 48); commitRules(); },
          })),
          fieldRow("Sticker shape", shapeSelect),
          fieldRow("Note color", makeSelect(VTS_STICKY_COLORS, step.color, (v) => { step.color = v; commitRules(); })),
          fieldRow("Note size (5–100%)", sizeBox),
          fieldRow("Placement", makeSelect(VTS_STICKY_PIN_MODES, step.pinMode, (v) => { step.pinMode = v; commitRules(); })),
          fieldRow("Face ArtMesh (blank = auto)", meshRow),
          fieldRow("Remove after (sec, 0 = stay)", makeInput({
            type: "number",
            value: step.duration,
            min: 0,
            max: 300,
            onInput: (v) => { step.duration = Math.min(300, Math.max(0, Math.round(Number(v) || 0))); commitRules(); },
          })),
        );
      } else if (step.type === "vts.hotkey") {
        hostEl.append(
          fieldRow("VTS Hotkey or Item Scene", makeInput({
            value: step.hotkey,
            placeholder: "e.g. Sticky Note",
            list: "vts-hotkeys-dl",
            maxLength: 80,
            onInput: (v) => { step.hotkey = v.trim().slice(0, 80); commitRules(); },
          })),
          fieldRow("Auto-toggle off after (sec, 0 = stay)", makeInput({
            type: "number",
            value: step.duration,
            min: 0,
            max: 300,
            onInput: (v) => { step.duration = Math.min(300, Math.max(0, Math.round(Number(v) || 0))); commitRules(); },
          })),
        );
      } else if (step.type === "vts.item") {
        hostEl.append(
          fieldRow("VTS Item file (in Items folder)", makeInput({
            value: step.fileName,
            placeholder: "e.g. sticky_note.png",
            list: "vts-items-dl",
            maxLength: 80,
            onInput: (v) => { step.fileName = v.trim().slice(0, 80); commitRules(); },
          })),
          fieldRow("Size % (10–100)", makeInput({
            type: "number",
            value: step.size,
            min: 10,
            max: 100,
            onInput: (v) => { step.size = Math.min(100, Math.max(10, Math.round(Number(v) || 32))); commitRules(); },
          })),
          fieldRow("Horizontal X (-100 to 100)", makeInput({
            type: "number",
            value: step.posX,
            min: -100,
            max: 100,
            onInput: (v) => { step.posX = Math.min(100, Math.max(-100, Math.round(Number(v) || 0))); commitRules(); },
          })),
          fieldRow("Vertical Y (-100 to 100)", makeInput({
            type: "number",
            value: step.posY,
            min: -100,
            max: 100,
            onInput: (v) => { step.posY = Math.min(100, Math.max(-100, Math.round(Number(v) || 15))); commitRules(); },
          })),
          fieldRow("Remove after (sec, 0 = stay)", makeInput({
            type: "number",
            value: step.duration,
            min: 0,
            max: 300,
            onInput: (v) => { step.duration = Math.min(300, Math.max(0, Math.round(Number(v) || 0))); commitRules(); },
          })),
        );
      } else if (step.type === "vts.expression") {
        hostEl.append(
          fieldRow("VTS Expression name or file", makeInput({
            value: step.expression,
            placeholder: "e.g. Blush or blush.exp3.json",
            list: "vts-expressions-dl",
            maxLength: 80,
            onInput: (v) => { step.expression = v.trim().slice(0, 80); commitRules(); },
          })),
          fieldRow("Mode", makeSelect([["on", "Turn on"], ["off", "Turn off"], ["toggle", "Toggle"]], step.mode, (v) => { step.mode = v; commitRules(); })),
          fieldRow("Revert after (sec, 0 = stay)", makeInput({
            type: "number",
            value: step.duration,
            min: 0,
            max: 300,
            onInput: (v) => { step.duration = Math.min(300, Math.max(0, Math.round(Number(v) || 0))); commitRules(); },
          })),
        );
      } else if (step.type === "vts.move") {
        hostEl.append(
          fieldRow("Avatar movement", makeSelect(VTS_MOVE_PRESETS, step.preset, (v) => { step.preset = v; commitRules(); })),
          fieldRow("Return to normal after (sec)", makeInput({
            type: "number",
            value: step.duration,
            min: 1,
            max: 120,
            onInput: (v) => { step.duration = Math.min(120, Math.max(1, Math.round(Number(v) || 8))); commitRules(); },
          })),
        );
      } else if (step.type === "vts.tint") {
        const colorInput = el("input", { type: "color", value: step.color || "#ff66aa" });
        colorInput.addEventListener("input", () => { step.color = colorInput.value; commitRules(); });
        hostEl.append(
          fieldRow("Tint color", colorInput),
          fieldRow("Reset color after (sec)", makeInput({
            type: "number",
            value: step.duration,
            min: 1,
            max: 120,
            onInput: (v) => { step.duration = Math.min(120, Math.max(1, Math.round(Number(v) || 8))); commitRules(); },
          })),
        );
      } else if (step.type === "frills.sound") {
        const soundOpts = SOUNDS.filter((s) => s.id !== "none").map((s) => [s.id, s.name]);
        hostEl.append(
          fieldRow("Sound", makeSelect(soundOpts, step.sound, (v) => { step.sound = v; commitRules(); })),
          fieldRow("Volume %", makeInput({
            type: "number",
            value: step.volume,
            min: 10,
            max: 100,
            onInput: (v) => { step.volume = Math.min(100, Math.max(10, Math.round(Number(v) || 75))); commitRules(); },
          })),
        );
      } else if (step.type === "frills.banner") {
        hostEl.append(
          fieldRow("Headline", makeInput({
            value: step.title,
            placeholder: "HYPE!",
            maxLength: 48,
            onInput: (v) => { step.title = v.slice(0, 48); commitRules(); },
          })),
          fieldRow("Message ({name}, {gift}, {text})", makeInput({
            value: step.text,
            placeholder: "{name} triggered an action!",
            maxLength: 100,
            onInput: (v) => { step.text = v.slice(0, 100); commitRules(); },
          })),
          fieldRow("Show for (sec)", makeInput({
            type: "number",
            value: step.seconds,
            min: 2,
            max: 15,
            onInput: (v) => { step.seconds = Math.min(15, Math.max(2, Math.round(Number(v) || 4))); commitRules(); },
          })),
          fieldRow("Effect", makeSelect(BANNER_FX, step.fx, (v) => { step.fx = v; commitRules(); })),
        );
      } else if (step.type === "flow.wait") {
        hostEl.append(fieldRow("Wait (seconds)", makeInput({
          type: "number",
          value: step.seconds,
          min: 1,
          max: 60,
          onInput: (v) => { step.seconds = Math.min(60, Math.max(1, Math.round(Number(v) || 3))); commitRules(); },
        })));
      }
    };

    const renderRules = () => {
      if (!rulesHost) return;
      rulesHost.replaceChildren();
      if (!rules.length) {
        rulesHost.append(el("p", { className: "ctl__hint", textContent: "No actions yet. Tap a starter above or add a blank action." }));
        syncQuotaUi();
        return;
      }

      for (let rIdx = 0; rIdx < rules.length; rIdx++) {
        const rule = rules[rIdx];
        const card = el("details", { className: "act-rule" });
        card.dataset.ruleId = rule.id;
        card.open = rule.id === openRuleId;
        card.addEventListener("toggle", () => { if (card.open) openRuleId = rule.id; });

        const summary = el("summary", { className: "act-rule__head" });
        const enableCb = el("input", { type: "checkbox", className: "act-rule__on", checked: rule.enabled });
        enableCb.setAttribute("aria-label", `Enable ${rule.name}`);
        enableCb.addEventListener("click", (e) => e.stopPropagation());
        enableCb.addEventListener("change", () => { rule.enabled = enableCb.checked; commitRules(); });

        const titleWrap = el("span", { className: "act-rule__meta" });
        const titleText = el("strong", { className: "act-rule__name", textContent: rule.name });
        const badge = el("span", { className: "act-rule__tag", textContent: triggerSummary(rule.trigger) });
        titleWrap.append(titleText, badge);

        const testBtn = el("button", { type: "button", className: "btn btn--soft btn--sm act-rule__test", textContent: "Test" });
        testBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await sounds.unlock();
          engine.runRule(rule.id, { who: "Pond Pal", label: triggerSummary(rule.trigger), gift: "Galaxy", text: "Let’s go!" });
        });

        summary.append(enableCb, titleWrap, testBtn);

        const body = el("div", { className: "act-rule__body" });

        const basics = el("div", { className: "act-grid" });
        basics.append(
          fieldRow("Action name", makeInput({
            value: rule.name,
            placeholder: "Save a clip",
            maxLength: 48,
            onInput: (v) => {
              rule.name = v.trim().slice(0, 48) || "Action";
              titleText.textContent = rule.name;
              commitRules();
            },
          })),
          fieldRow("Cooldown (sec)", makeInput({
            type: "number",
            value: rule.cooldownSec,
            min: 0,
            max: 3600,
            onInput: (v) => { rule.cooldownSec = Math.min(3600, Math.max(0, Math.round(Number(v) || 0))); commitRules(); },
          })),
        );

        const whenBox = el("div", { className: "act-sub" });
        whenBox.append(el("span", { className: "act-sub__kicker", textContent: "WHEN" }));
        const triggerFields = el("div", { className: "act-grid" });
        const triggerSelect = makeSelect(ACTION_TRIGGERS, rule.trigger.kind, (nextKind) => {
          rule.trigger = sanitizeRule({ ...rule, trigger: { kind: nextKind } }, rIdx).trigger;
          badge.textContent = triggerSummary(rule.trigger);
          renderTriggerFields(triggerFields, rule, badge);
          commitRules();
        });
        whenBox.append(fieldRow("Trigger", triggerSelect), triggerFields);
        renderTriggerFields(triggerFields, rule, badge);

        const doBox = el("div", { className: "act-sub" });
        doBox.append(el("span", { className: "act-sub__kicker", textContent: "DO" }));
        const stepsList = el("div", { className: "act-steps" });

        const renderSteps = () => {
          stepsList.replaceChildren();
          rule.steps.forEach((step, sIdx) => {
            const stepBox = el("div", { className: "act-step" });
            const stepHead = el("div", { className: "act-step__head" });
            const stepFields = el("div", { className: "act-grid" });
            const typeSelect = makeSelect(ACTION_TYPES, step.type, (nextType) => {
              if (!plusActive && isPlusVtsStep({ type: nextType })) {
                typeSelect.value = step.type;
                openActionsPlusModal(
                  "Subscribe for full VTube Studio actions",
                  "All OBS actions and pastel VTS sticky notes stay free. Subscribe to Frills Plus to unlock VTS hotkeys, props, expressions, avatar zooms/flips, and color tints.",
                  "vts_locked",
                );
                return;
              }
              rule.steps[sIdx] = sanitizeStep({ type: nextType });
              renderStepFields(stepFields, rule.steps[sIdx]);
              commitRules();
            });
            typeSelect.setAttribute("aria-label", `Step ${sIdx + 1} action type`);
            const rmStep = el("button", { type: "button", className: "items__remove act-step__rm", textContent: "×" });
            rmStep.setAttribute("aria-label", `Remove step ${sIdx + 1}`);
            rmStep.disabled = rule.steps.length <= 1;
            rmStep.addEventListener("click", () => {
              if (rule.steps.length <= 1) return;
              rule.steps.splice(sIdx, 1);
              commitRules();
              renderSteps();
            });
            stepHead.append(typeSelect, rmStep);
            renderStepFields(stepFields, step);
            stepBox.append(stepHead, stepFields);
            stepsList.append(stepBox);
          });
          addStepBtn.disabled = rule.steps.length >= MAX_STEPS_PER_RULE;
        };

        const stepActions = el("div", { className: "act-rule__foot" });
        const addStepBtn = el("button", { type: "button", className: "btn btn--soft btn--sm", textContent: "+ Add step" });
        addStepBtn.addEventListener("click", () => {
          if (rule.steps.length >= MAX_STEPS_PER_RULE) return;
          rule.steps.push(sanitizeStep({ type: "frills.sound", sound: "pop", volume: 75 }));
          commitRules();
          renderSteps();
        });
        const delRuleBtn = el("button", { type: "button", className: "btn btn--soft btn--sm act-rule__del", textContent: "Delete" });
        delRuleBtn.addEventListener("click", () => {
          rules.splice(rIdx, 1);
          commitRules({ rerender: true });
        });
        stepActions.append(addStepBtn, delRuleBtn);
        doBox.append(stepsList, stepActions);
        renderSteps();

        body.append(basics, whenBox, doBox);
        card.append(summary, body);
        rulesHost.append(card);
      }
      syncQuotaUi();
    };

    addBlankBtn?.addEventListener("click", () => {
      addRule({
        name: `Action ${rules.length + 1}`,
        enabled: true,
        cooldownSec: 15,
        queue: true,
        trigger: { kind: "gift", giftName: "", minDiamonds: 10 },
        steps: [{ type: "obs.source", scene: "", source: "", mode: "show", duration: 10 }],
      });
    });

    exportBtn?.addEventListener("click", async () => {
      const ok = await copyText(JSON.stringify(rules, null, 2));
      if (importMsg) {
        importMsg.hidden = false;
        importMsg.textContent = ok ? `Copied ${rules.length} action(s) as JSON to your clipboard.` : "Could not copy JSON.";
      }
    });
    importBtn?.addEventListener("click", () => {
      if (importBox) importBox.hidden = !importBox.hidden;
      if (importBox && !importBox.hidden) importArea?.focus();
    });
    importApply?.addEventListener("click", () => {
      try {
        const parsed = JSON.parse(importArea?.value || "");
        if (!Array.isArray(parsed)) throw new Error("Expected a JSON array of actions.");
        const cap = limitNow();
        rules = sanitizeRules(parsed, { limit: cap, allowEmpty: true });
        openRuleId = rules[0]?.id ?? "";
        commitRules({ rerender: true });
        if (importBox) importBox.hidden = true;
        if (importMsg) {
          importMsg.hidden = false;
          importMsg.textContent = parsed.length > cap
            ? `Imported ${rules.length} of ${parsed.length} actions (capped at ${cap}).`
            : `Imported ${rules.length} action(s).`;
        }
      } catch {
        if (importMsg) {
          importMsg.hidden = false;
          importMsg.textContent = "That JSON could not be read. Export actions first to see the format.";
        }
      }
    });

    renderRules();

    return {
      apply(next) {
        const appChanged = (next.obsApp === "slobs" ? "slobs" : "obs") !== activeObsApp;
        current = next;
        view.apply(next);
        engine.setChannel(ctx.channel());
        if (appChanged) syncDeviceInputs();
      },
      onReset(next) {
        current = next;
        rules = decodeRules(next.rules, { limit: limitNow() });
        openRuleId = rules[0]?.id ?? "";
        engine.setRules(rules, { limit: limitNow() });
        syncDeviceInputs();
        renderRules();
      },
      onPlusStatus(status) {
        const nextActive = Boolean(status?.plusActive);
        const nextEligible = Boolean(status?.eligible);
        const activeChanged = nextActive !== plusActive;
        const eligibleChanged = nextEligible !== plusEligible;
        plusChecked = true;
        plusActive = nextActive;
        plusEligible = nextEligible;
        if (plusActive) closePlusModal();
        vtsExecutor.setMaxStickyNotes(plusActive ? 0 : FREE_STICKY_NOTES_LIMIT);
        if (activeChanged) {
          rules = decodeRules(current.rules, { limit: limitNow() });
          engine.setRules(rules, { limit: limitNow() });
          renderRules();
        } else if (eligibleChanged) {
          syncQuotaUi();
        }
      },
      onChat: (msg) => {
        engine.setChannel(ctx.channel());
        engine.handleChat(msg);
      },
      onEvent: (ev) => {
        engine.setChannel(ctx.channel());
        engine.handleEvent(ev);
      },
      tests: (() => {
        const DEMO_STICKIES = [
          ["Mochi Bun", "Galaxy"],
          ["Pond Pal", "Rose ×10"],
          ["Neko Star", "Confetti"],
          ["Yuzu Tea", "Heart Me"],
          ["Boba Fox", "Corgi"],
          ["Luna Mint", "Doughnut"],
        ];
        let stickyDemoIdx = 0;
        return {
          clip: async () => {
            await sounds.unlock();
            const clipRule = rules.find((r) => r.steps.some((s) => s.type === "obs.clip"));
            if (clipRule) engine.runRule(clipRule.id, { who: "Pond Pal", label: "!clip" });
            else view.showToast({ title: "Clip saved (preview)", text: "Clip saved · Pond Pal", fx: "sparkles" });
          },
          replay: async () => {
            await sounds.unlock();
            const replayRule = rules.find((r) => r.steps.some((s) => s.type === "obs.replay"));
            if (replayRule) engine.runRule(replayRule.id, { who: "Mochi Bun", label: "!replay" });
            else {
              view.showReplay({ badge: "REPLAY", who: "Mochi Bun", label: "!replay" });
              setTimeout(() => view.hideReplay(), 3500);
            }
          },
          sticky: async () => {
            const soundReady = sounds.unlock();
            const [who, gift] = DEMO_STICKIES[stickyDemoIdx % DEMO_STICKIES.length];
            stickyDemoIdx += 1;
            const stickyRule = rules.find((r) => r.steps.some((s) => s.type === "vts.sticky"));
            if (stickyRule) {
              engine.runRule(stickyRule.id, { who, label: gift, gift });
            } else {
              const step = sanitizeStep({ type: "vts.sticky", title: "{name}", subtitle: "{gift}", color: "random" });
              const res = await vtsExecutor.run(step, { who, label: gift, gift, ruleName: "Sticky note (VTS)" });
              soundReady.then(() => sounds.play("pop", { volume: 75, tier: 2 }));
              pushLog({ ruleName: "Sticky note (VTS)", who, status: res?.ok === false ? "error" : "ok", detail: res?.detail || "Ran" });
            }
          },
          gift: async () => {
            await sounds.unlock();
            const plat = ctx.platform();
            const ev = plat === "twitch" ? fakeAlert("bits", { size: 2 }) : fakeAlert("gift", { size: 2 });
            const fired = engine.handleEvent(ev);
            if (!fired.length && rules[0]) engine.runRule(rules[0].id, { who: ev.name, label: ev.gift || `${ev.count} Bits`, gift: ev.gift || "Gift" });
          },
          clear: () => {
            obsExecutor.clear();
            vtsExecutor.clear();
            engine.clear();
            view.clear();
          },
        };
      })(),
    };
  },
});

// Keep link refresh handle updated when local OBS password / Streamlabs token or VTS token changes
latestRefreshLink = () => {
  const linkEl = $("link");
  if (linkEl?.value) linkEl.value = withLocalSecretsHash(linkEl.value, { obsPass: activeStudioSecret(), vtsToken });
};
