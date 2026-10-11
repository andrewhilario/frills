// The editor for the smaller overlays (Last Gifts, Follower Goal): pick a look, set the options, try it, connect a TikTok account, copy
// one link. Each overlay passes what is its own; the rest is the same for both, and the same way the alerts editor works.

import { LOOKS, LOOK_NAMES, currentLook } from "./widget-settings.js";
import { buildControl, chips, copyButton } from "./ui.js";
import { mountSource } from "./source.js";
import { fontsReady, generalFaces } from "./look.js";
import { luminance } from "./color.js";

const $ = (id) => document.getElementById(id);
const CANVASES = { vertical: [1080, 1920], landscape: [1920, 1080], square: [1080, 1080] };

/**
 * `widget` is the settings (GIFTS or GOAL). `create(host, settings)` makes the overlay's view and returns
 * { apply(settings), onEvent(event), tests: { id: () => void } }. `events` are the TikTok event kinds it wants.
 */
export function startWidgetEditor({ widget, storeKey, overlayPath, events, needs = "alerts", create, idleHint }) {
  const params = new URLSearchParams(location.search);
  const load = () => { try { return JSON.parse(localStorage.getItem(storeKey) ?? "null"); } catch { return null; } };
  const saved = load();
  let settings = widget.sanitize({ ...saved?.settings, ...widget.fromParams(params) });
  let source = null;
  // `ctx.restart()` reconnects (for an overlay whose settings change what it waits for); `ctx.info(fn)` is for what the account says.
  const api = create($("widget"), settings, { restart: () => source?.restart(), channel: () => source?.cleanChannel() ?? "", features: () => source?.features ?? null });

  // ── the look and the options ────────────────────────────────────────────────────────────────────────────────────
  const swatch = (p) => (luminance(p.accent) < 0.08 ? p.bg : p.accent);
  const writers = {};
  let lookChips;
  const paint = () => api.apply(settings);
  function change(key, value) {
    settings[key] = value;
    if (key === "font") fontsReady(generalFaces(settings), 600).then(paint);
    else paint();
    lookChips.set(currentLook({ ...settings }));
    refreshLink();
    save();
  }
  function syncControls() {
    for (const control of widget.controls) writers[control.key](settings[control.key]);
    lookChips.set(currentLook({ ...settings }));
  }
  lookChips = chips(
    $("looks"),
    Object.keys(LOOKS).map((id) => ({ id, name: LOOK_NAMES[id], dot: swatch(LOOKS[id]) })),
    currentLook({ ...settings }),
    (item) => {
      for (const key of Object.keys(LOOKS[item.id])) if (key in settings) settings[key] = LOOKS[item.id][key];
      syncControls();
      fontsReady(generalFaces(settings), 600).then(paint);
      refreshLink();
      save();
    },
    { dot: true },
  );
  for (const control of widget.controls) {
    const { row, write } = buildControl(control, settings[control.key], (value) => change(control.key, value));
    writers[control.key] = write;
    $(control.section === "look" ? "look-controls" : "opt-controls").append(row);
  }
  $("reset").addEventListener("click", () => {
    settings = { ...widget.defaults };
    syncControls();
    paint();
    refreshLink();
    save();
  });

  // ── trying it ───────────────────────────────────────────────────────────────────────────────────────────────────
  for (const button of document.querySelectorAll("[data-test]")) button.addEventListener("click", () => api.tests[button.dataset.test]?.());

  // ── the account ─────────────────────────────────────────────────────────────────────────────────────────────────
  const channelFromLink = params.get("channel") ?? "";
  source = mountSource($("source"), {
    // chat is not drawn here, but an overlay that reads commands from it (song requests) is given each message; connecting or
    // disconnecting never empties it (clear does nothing)
    feeds: [{ add: (m) => api.onChat?.(m), removeById() {}, removeUser() {}, clear() {} }],
    pace: () => [2000, 4000],
    channel: channelFromLink || saved?.channel || "",
    platform: "tiktok",
    platforms: ["tiktok"],
    autoconnect: Boolean(channelFromLink),
    waitlistUrl: document.body.dataset.waitlist || "",
    tools: false,
    idleHint,
    events,
    onInfo: (info) => api.onInfo?.(info),
    onAlert: (event) => api.onEvent(event),
    onFound: (found) => {
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
  function refreshLink() {
    const channel = source.cleanChannel();
    if (!channel) {
      linkInput.value = "";
      copyBtn.disabled = true;
      $("link-hint").textContent = "Your link appears here once you have typed your TikTok name in step 3.";
      return;
    }
    linkInput.value = widget.url(`${location.origin}${overlayPath}`, { channel, settings });
    copyBtn.disabled = false;
    $("link-hint").textContent = "Paste it into a Browser source in your streaming app. For a vertical LIVE use 1080 wide by 1920 high.";
  }
  linkInput.addEventListener("focus", () => linkInput.select());
  source.onChange(() => { refreshLink(); save(); });

  // ── the preview: a true copy of the page your streaming app shows, shrunk to fit ───────────────────────────────────────
  let canvas = CANVASES[saved?.canvas] ? saved.canvas : "vertical";
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
    (value) => { canvas = value; fit(); save(); },
  );
  $("preview-canvas").append(canvasControl.row);
  $("backdrop").addEventListener("change", (event) => { $("preview").dataset.back = event.target.value; });
  new ResizeObserver(fit).observe($("stage"));

  function save() {
    try { localStorage.setItem(storeKey, JSON.stringify({ settings, channel: source.channel, canvas })); } catch { /* storage can be blocked; the editor still works */ }
  }

  fit();
  fontsReady(generalFaces(settings), 900).then(paint);
  paint();
  refreshLink();
  return { settings: () => settings };
}
