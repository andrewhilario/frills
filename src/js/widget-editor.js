// The editor for the smaller overlays (Last Gifts, Follower Goal): pick a look, set the options, try it, connect a TikTok account, copy
// one link. Each overlay passes what is its own; the rest is the same for both, and the same way the alerts editor works.

import { currentLook, looksFor } from "./widget-settings.js";
import { activeSeason } from "./season.js";
import { buildControl, chips, copyButton } from "./ui.js";
import { mountSource } from "./source.js";
import { fontsReady, generalFaces } from "./look.js";
import { luminance } from "./color.js";
import { mountMediaPicker } from "./alerts-media.js";
import { acceptInfo } from "./info.js";
import { appendPlusCode } from "./plus-relay.js";
import { mountCloudSave } from "./cloud-save.js";
import { mountEditorMode } from "./editor-mode.js";
import { mountSizeGuide } from "./size-guide.js";
import { loadPlatformPref, savePlatformPref } from "./platform-pref.js";
import { loadMatchaProfile, matchaDefaultsFor } from "./matcha-bridge.js";

const $ = (id) => document.getElementById(id);
const CANVASES = { vertical: [1080, 1920], landscape: [1920, 1080], square: [1080, 1080] };

/**
 * `widget` is the settings (GIFTS, GOAL, GIFTERS, etc.). `create(host, settings, ctx)` makes the overlay's view and returns
 * { apply(settings), onEvent(event), onPlatform?(platform), tests: { id: () => void } }. `events` can be a list of kinds or a
 * function returning them for the current platform. `platforms` defaults to `["tiktok"]`.
 */
export function startWidgetEditor({ widget, storeKey, overlayPath, events, needs = "alerts", platforms = ["tiktok"], defaultPlatform = "tiktok", extraUrlParams, urlTransform, create, idleHint }) {
  const params = new URLSearchParams(location.search);
  const MATCHA = $("main")?.dataset.mode === "matcha";
  const matchaSlug = $("main")?.dataset.matchaSlug || String(overlayPath ?? "").replace(/^\/overlay\/|\/+$/g, "");
  const effectiveStoreKey = MATCHA ? `${storeKey}:matcha` : storeKey;
  const matchaProfile = MATCHA ? loadMatchaProfile() : null;
  const matchaBase = MATCHA ? matchaDefaultsFor(matchaSlug, matchaProfile) : null;
  const load = () => { try { return JSON.parse(localStorage.getItem(effectiveStoreKey) ?? "null"); } catch { return null; } };
  const saved = load();
  const pref = loadPlatformPref();
  let settings = widget.sanitize({ ...(matchaBase ?? {}), ...saved?.settings, ...widget.fromParams(params) });
  const askedPlatform = params.get("tiktok") && params.get("twitch") && platforms.includes("both")
    ? "both"
    : params.get("platform");
  const initialPlatform = platforms.includes(askedPlatform) ? askedPlatform
    : platforms.includes(saved?.platform) ? saved.platform
    : MATCHA && platforms.includes(matchaProfile?.platform) ? matchaProfile.platform
    : platforms.includes(pref.platform) ? pref.platform
    : platforms.includes(defaultPlatform) ? defaultPlatform : platforms[0];
  let currentPlatform = initialPlatform;
  let source = null;
  // `ctx.restart()` reconnects (for an overlay whose settings change what it waits for); `ctx.info(fn)` is for what the account says.
  let ready = false; // the editor is whole once everything below has been made
  const api = create($("widget"), settings, {
    restart: () => source?.restart(),
    channel: () => source?.cleanChannel() ?? "",
    platform: () => source?.platform ?? currentPlatform,
    features: () => source?.features ?? null,
    refresh: () => { if (ready) { paint(); refreshLink(); } },
    save: () => { if (ready) save(); },
  });

  // ── the look and the options ────────────────────────────────────────────────────────────────────────────────────
  const swatch = (p) => (luminance(p.accent) < 0.08 ? p.bg : p.accent);
  const writers = {};
  const rowsByControl = [];
  let lookChips;
  const paint = () => api.apply(settings, currentPlatform);
  function change(key, value) {
    if (api.beforeChange?.(key, value, settings[key]) === false) {
      writers[key]?.(settings[key]);
      return;
    }
    settings[key] = value;
    if (key === "font") fontsReady(generalFaces(settings), 600).then(paint);
    else paint();
    lookChips.set(currentLook({ ...settings }));
    refreshLink();
    save();
  }
  function syncControls() {
    for (const control of widget.controls) writers[control.key]?.(settings[control.key]);
    lookChips.set(currentLook({ ...settings }));
  }
  function syncPlatformUi(platform) {
    currentPlatform = platform;
    for (const node of document.querySelectorAll("[data-platform]")) {
      node.hidden = !node.dataset.platform.split(" ").includes(platform);
    }
    for (const { control, row } of rowsByControl) {
      if (control.onlyPlatform) row.hidden = !String(control.onlyPlatform).split(" ").includes(platform);
    }
  }
  // The season's looks come first while it lasts (Halloween, Christmas), then the usual ones.
  const looks = looksFor(activeSeason());
  lookChips = chips(
    $("looks"),
    looks.map((l) => ({ id: l.id, name: l.name, season: l.season, dot: swatch(l.look) })),
    currentLook({ ...settings }),
    (item) => {
      const picked = looks.find((l) => l.id === item.id).look;
      for (const key of Object.keys(picked)) if (key in settings) settings[key] = picked[key];
      syncControls();
      fontsReady(generalFaces(settings), 600).then(paint);
      refreshLink();
      save();
    },
    { dot: true },
  );
  const cloudKind = String(overlayPath ?? "").replace(/^\/overlay\/|\/+$/g, "");
  const editorMode = mountEditorMode({ kind: cloudKind });
  for (const control of widget.controls) {
    if (control.hidden) continue; // a setting the page fills in itself
    const { row, write } = control.type === "media" && $("media-ok")
      ? mountMediaPicker({ consentBox: $("media-ok"), kind: control.media, label: control.label, hint: control.hint, value: settings[control.key], onSet: (value) => change(control.key, value) })
      : buildControl(control, settings[control.key], (value) => change(control.key, value));
    writers[control.key] = write;
    rowsByControl.push({ control, row });
    $(control.section === "look" ? "look-controls" : "opt-controls").append(row);
  }
  editorMode.markControls(rowsByControl);
  if ($("look-controls")) editorMode.addAdvancePrompt($("look-controls"));
  const hasAdvancedOpts = rowsByControl.some(({ control, row }) => control.section !== "look" && row.classList.contains("ed-adv"));
  if (hasAdvancedOpts && $("opt-controls")) editorMode.addAdvancePrompt($("opt-controls"), "All options (Advanced) →");
  $("reset").addEventListener("click", () => {
    settings = widget.sanitize({ ...widget.defaults, ...(matchaBase ?? {}) });
    syncControls();
    api.onReset?.(settings);
    paint();
    refreshLink();
    save();
  });

  // ── trying it ───────────────────────────────────────────────────────────────────────────────────────────────────
  for (const button of document.querySelectorAll("[data-test]")) button.addEventListener("click", () => api.tests[button.dataset.test]?.());

  // ── the account ─────────────────────────────────────────────────────────────────────────────────────────────────
  const channelFromLink = params.get("tiktok") || params.get("channel") || "";
  const twitchFromLink = params.get("twitch") || "";
  const matchaPrimary = MATCHA ? (initialPlatform === "twitch" ? (matchaProfile?.twitch || matchaProfile?.channel) : matchaProfile?.channel) : "";
  const prefPrimary = initialPlatform === "twitch" ? pref.twitch : pref.tiktok;
  const savedMatchesInitial = !saved?.platform || saved.platform === initialPlatform || (initialPlatform === "both" && saved.platform === "tiktok");
  const initialChannel = channelFromLink || (savedMatchesInitial ? saved?.channel : "") || matchaPrimary || prefPrimary || "";
  const initialTwitch = twitchFromLink || saved?.twitch || (MATCHA ? matchaProfile?.twitch : "") || pref.twitch || "";
  source = mountSource($("source"), {
    // chat is not drawn here, but an overlay that reads commands from it (song requests) is given each message; connecting or
    // disconnecting never empties it (clear does nothing)
    feeds: [{ add: (m) => api.onChat?.(m), removeById() {}, removeUser() {}, clear() {} }],
    pace: () => [2000, 4000],
    channel: initialChannel,
    twitch: initialTwitch,
    platform: initialPlatform,
    platforms,
    autoconnect: Boolean(channelFromLink),
    waitlistUrl: document.body.dataset.waitlist || "",
    tools: false,
    idleHint: typeof idleHint === "function" ? idleHint(initialPlatform) : idleHint,
    events: typeof events === "function" ? () => events(source?.platform ?? initialPlatform) : events,
    onInfo: (raw) => { const info = acceptInfo(raw); if (info) api.onInfo?.(info); },
    onAlert: (event) => api.onEvent(event),
    onFound: (found) => {
      const p = source?.platform ?? initialPlatform;
      if (p !== "tiktok" && p !== "both") { $("relay-note").textContent = ""; return; }
      $("relay-note").textContent = !found ? ""
        : found.features.includes(needs) ? ""
        : needs === "roles" ? "The relay is an older version, so !next from your own account will not work yet (moderators can still use it). It needs an update."
        : "The relay is an older version that can only send chat. It needs an update before this overlay can get live events.";
    },
  });

  // ── the link ────────────────────────────────────────────────────────────────────────────────────────────────────
  const linkInput = $("link");
  const copyBtn = $("copy-link");
  copyButton(copyBtn, () => linkInput.value);
  const cloud = cloudKind ? mountCloudSave({ kind: cloudKind, storeKey: effectiveStoreKey, anchor: linkInput.closest(".linkfield"), getUrl: () => linkInput.value, defaultName: MATCHA ? `Matcha ${cloudKind}` : `My ${cloudKind} overlay`, onStatus: (st) => api.onPlusStatus?.(st) }) : { sync() {} };
  function refreshLink() {
    const platform = source.platform;
    const isBoth = platform === "both";
    const both = isBoth ? source.cleanChannels() : null;
    const channel = isBoth ? (both.tiktok && both.twitch ? both.tiktok : "") : source.cleanChannel();
    if (!channel) {
      linkInput.value = "";
      copyBtn.disabled = true;
      $("link-hint").textContent = isBoth
        ? "Your link appears here once you have typed both your TikTok and Twitch names in step 3."
        : platforms.length > 1
          ? "Your link appears here once you have typed your name in step 3."
          : "Your link appears here once you have typed your TikTok name in step 3.";
      cloud.sync();
      return;
    }
    let nextUrl = widget.url(`${location.origin}${overlayPath}`, { channel, platform, both, settings });
    if (extraUrlParams) {
      const parsed = new URL(nextUrl);
      for (const [k, v] of Object.entries(extraUrlParams({ channel, platform, both, settings }) ?? {})) {
        if (v) parsed.searchParams.set(k, String(v));
      }
      nextUrl = parsed.toString();
    }
    if (platform === "tiktok" || platform === "both" || cloudKind === "tts" || cloudKind === "actions") nextUrl = appendPlusCode(nextUrl);
    if (urlTransform) nextUrl = urlTransform(nextUrl, { channel, platform, both, settings });
    linkInput.value = nextUrl;
    copyBtn.disabled = false;
    cloud.sync();
    $("link-hint").textContent = isBoth
      ? "Paste one Browser source link into OBS or Streamlabs — reads TikTok LIVE and Twitch together."
      : platform === "twitch"
        ? "Paste it into a Browser source in OBS or Streamlabs. For a PC stream use 1920 wide by 1080 high."
        : "Paste it into a Browser source in your streaming app. For a vertical LIVE use 1080 wide by 1920 high.";
  }
  linkInput.addEventListener("focus", () => linkInput.select());
  syncPlatformUi(source.platform);
  source.onChange(() => {
    if (source.platform !== currentPlatform) {
      syncPlatformUi(source.platform);
      if (source.platform !== "tiktok" && source.platform !== "both") $("relay-note").textContent = "";
      api.onPlatform?.(source.platform);
    }
    savePlatformPref({
      platform: source.platform,
      tiktok: source.platform === "tiktok" || source.platform === "both" ? source.channel : undefined,
      twitch: source.platform === "twitch" ? source.channel : source.platform === "both" ? source.twitchChannel : undefined,
    });
    refreshLink();
    save();
  });

  // ── the preview: a true copy of the page your streaming app shows, shrunk to fit ───────────────────────────────────────
  let canvas = CANVASES[saved?.canvas] ? saved.canvas : initialPlatform === "twitch" ? "landscape" : "vertical";
  let sizeGuide = null;
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
    { key: "canvas", type: "select", label: "Preview as", options: [{ id: "vertical", name: "Vertical LIVE, 1080 x 1920" }, { id: "landscape", name: "Landscape, 1920 x 1080" }, { id: "square", name: "Square, 1080 x 1080" }], hint: "Set your streaming app's source to the same size." },
    canvas,
    (value) => { canvas = value; fit(); sizeGuide?.sync(); save(); },
  );
  $("preview-canvas").append(canvasControl.row);
  $("backdrop").addEventListener("change", (event) => { $("preview").dataset.back = event.target.value; });
  new ResizeObserver(fit).observe($("stage"));

  sizeGuide = mountSizeGuide({
    mode: "scene",
    anchor: linkInput.closest(".linkfield"),
    copyBtn,
    getSize: () => {
      const [w, h] = CANVASES[canvas] ?? CANVASES.vertical;
      return {
        width: w,
        height: h,
        canvas,
        appHint: canvas === "landscape" || source.platform === "twitch" ? "obs" : "tiktok",
      };
    },
    onPreset: (preset) => {
      if (!CANVASES[preset.id]) return;
      canvas = preset.id;
      canvasControl.write(canvas);
      fit();
      save();
    },
  });

  function save() {
    try { localStorage.setItem(effectiveStoreKey, JSON.stringify({ settings, channel: source.channel, twitch: source.twitchChannel, platform: source.platform, canvas })); } catch { /* storage can be blocked; the editor still works */ }
  }

  fit();
  fontsReady(generalFaces(settings), 900).then(paint);
  api.onPlatform?.(source.platform);
  paint();
  refreshLink();
  ready = true;
  return { settings: () => settings, platform: () => source.platform, refreshLink };
}
