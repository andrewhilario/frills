// The alerts editor: pick a look, write the words, choose sounds and effects, try every kind of alert, connect a TikTok or Twitch account, copy one link.

import { AlertQueue, makeAlert } from "./alerts.js";
import { createAlertView } from "./alerts-view.js";
import { CARDS, CONTROLS, DEFAULTS, KINDS, LOOKS, LOOK_NAMES, PLATFORM_KINDS, SECRET_CARDS, TWITCH_CHAT_KINDS, alertsUrl, currentLook, fromParams, mediaUrl, sanitize } from "./alerts-settings.js";
import { mountMediaPicker } from "./alerts-media.js";
import { createSounds } from "./sounds.js";
import { fakeAlert, fakeCrowd } from "./fake-alerts.js";
import { buildControl, chips, copyButton } from "./ui.js";
import { mountSource } from "./source.js";
import { fontsReady, generalFaces } from "./look.js";
import { luminance } from "./color.js";
import { FollowPublisher, FollowReader, followIdentity, followsOn, setFollowsOn } from "./follow-bridge.js";
import { FollowWatcher, REDIRECT_PATH, beginLogin, clearLogin, loadLogin, validate } from "./twitch-follows.js";

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

// The private Matcha alerts editor (/matcha/alerts/) is this same editor, starting from the Matcha look with the frog pond card, offering that card
// (the public editor never does), and keeping its own saved settings apart from the public one.
const MATCHA = $("main")?.dataset.mode === "matcha";
const BASE = MATCHA ? { ...DEFAULTS, ...LOOKS.matcha, card: "frogpond" } : DEFAULTS;
const CONTROL_LIST = MATCHA ? CONTROLS.map((c) => (c.key === "card" ? { ...c, options: [{ id: "frogpond", name: "Frog pond" }, ...CARDS] } : c)) : CONTROLS;

// What is remembered in this browser: the settings and the account. Nothing leaves the page.
const STORE = MATCHA ? "frills:alerts:matcha:v1" : "frills:alerts:v1";
const load = () => { try { return JSON.parse(localStorage.getItem(STORE) ?? "null"); } catch { return null; } };
const saved = load();

let settings = sanitize({ ...BASE, ...saved?.settings, ...fromParams(params) });
if (!MATCHA && SECRET_CARDS.includes(settings.card)) settings.card = DEFAULTS.card; // a style only the Matcha editor offers is not shown here, even from an old link or a saved setting
if (MATCHA) {
  const note = document.createElement("p");
  note.className = "note note--warm";
  note.setAttribute("role", "note");
  const lead = document.createElement("strong");
  lead.textContent = "Matcha alerts. ";
  note.append(lead, "A private editor, not listed on the site. It starts with the Matcha look and the frog pond card, and keeps its settings apart from the public alerts editor.");
  document.querySelector(".panel")?.prepend(note);
}

// ── The stage: alerts drawn over the preview, with sound ─────────────────────────────────────────────────────────
const view = createAlertView($("alerts"));
const sounds = createSounds();
const queue = new AlertQueue(settings, {
  onShow: (item) => {
    view.show(item);
    // the person's own sound when there is one, else the built-in one
    if (item.mySound) sounds.playUrl(mediaUrl(item.mySound), { volume: settings.volume, tier: item.tier });
    else sounds.play(item.sound, { volume: settings.volume, tier: item.tier });
    showSoundState();
  },
  onHide: (item) => view.hide(item),
});
const send = (event) => {
  const alert = makeAlert(event, settings);
  if (alert) queue.push(alert);
};

function showSoundState() {
  const state = sounds.state;
  $("sound-state").textContent = settings.volume === 0 ? "Sound is off (volume 0)"
    : state === "running" ? "Sound is on"
    : state === "none" ? "This browser can't play sound"
    : "Press a test button to turn sound on";
}

// ── Step 1: the look, and all the options ────────────────────────────────────────────────────────────────────────
const swatch = (p) => (luminance(p.accent) < 0.08 ? p.bg : p.accent);
const writers = {};
let lookChips;
/** Fetch the uploaded sounds ahead of time, so the first alert is not late. */
const preloadSounds = () => { for (const key of Object.keys(settings)) if (key.endsWith("MySound") && settings[key]) sounds.preload(mediaUrl(settings[key])); };
const paint = () => { view.apply(settings); queue.setConfig(settings); preloadSounds(); };

function change(key, value) {
  settings[key] = value;
  if (key === "font") fontsReady(generalFaces(settings), 600).then(paint);
  else paint();
  lookChips.set(currentLook(settings));
  if (key === "volume") showSoundState();
  refreshLink();
  save();
}
function syncControls() {
  for (const control of CONTROL_LIST) writers[control.key](settings[control.key]);
  lookChips.set(currentLook(settings));
}

lookChips = chips(
  $("looks"),
  Object.keys(LOOKS).map((id) => ({ id, name: LOOK_NAMES[id], dot: swatch(LOOKS[id]) })),
  currentLook(settings),
  (item) => {
    Object.assign(settings, LOOKS[item.id]);
    syncControls();
    fontsReady(generalFaces(settings), 600).then(paint);
    refreshLink();
    save();
  },
  { dot: true },
);

const HOLDERS = { look: "look-controls", move: "move-controls", queue: "queue-controls", ...Object.fromEntries(KINDS.map((kind) => [kind, `${kind}-controls`])) };
for (const control of CONTROL_LIST) {
  const { row, write } = control.type === "media"
    ? mountMediaPicker({ consentBox: $("media-ok"), kind: control.media, label: control.label, hint: control.hint, value: settings[control.key], onSet: (value) => change(control.key, value) })
    : buildControl(control, settings[control.key], (value) => change(control.key, value));
  writers[control.key] = write;
  $(HOLDERS[control.section]).append(row);
}

$("reset").addEventListener("click", () => {
  settings = { ...BASE };
  syncControls();
  paint();
  refreshLink();
  save();
});

// ── Trying an alert ──────────────────────────────────────────────────────────────────────────────────────────────
const TESTS = {
  follow: () => send(fakeAlert("follow")),
  "gift-1": () => send(fakeAlert("gift", { size: 1 })),
  "gift-3": () => send(fakeAlert("gift", { size: 3 })),
  share: () => send(fakeAlert("share")),
  crowd: () => fakeCrowd("follow", 6).forEach(send),
  sub: () => send(fakeAlert("sub")),
  resub: () => send(fakeAlert("sub", { resub: true })),
  subgift: () => send(fakeAlert("subgift")),
  bits: () => send(fakeAlert("bits", { size: 1 })),
  "bits-big": () => send(fakeAlert("bits", { size: 3 })),
  raid: () => send(fakeAlert("raid")),
};
for (const button of document.querySelectorAll("[data-test]")) {
  button.addEventListener("click", async () => {
    await sounds.unlock(); // this click is what the browser needs to allow sound
    showSoundState();
    TESTS[button.dataset.test]();
  });
}

// ── Step 4: the account, and what arrives ────────────────────────────────────────────────────────────────────────
const seen = Object.fromEntries(KINDS.map((kind) => [kind, 0]));
const showSeen = (kind) => {
  const dd = $(`seen-${kind}`);
  dd.textContent = String(seen[kind]);
  dd.removeAttribute("data-bump");
  void dd.offsetWidth; // so the same animation can run again
  dd.dataset.bump = "";
};

const channelFromLink = params.get("channel") ?? "";
// TikTok or Twitch: the address says, else what was used last, else TikTok. What each one can send is in PLATFORM_KINDS.
let platform = ["tiktok", "twitch"].includes(params.get("platform")) ? params.get("platform") : ["tiktok", "twitch"].includes(saved?.platform) ? saved.platform : "tiktok";
const source = mountSource($("source"), {
  feeds: [],
  pace: () => [2000, 4000],
  channel: channelFromLink || ((saved?.platform ?? "tiktok") === platform ? saved?.channel : "") || "",
  platform,
  platforms: ["tiktok", "twitch"],
  autoconnect: Boolean(channelFromLink),
  waitlistUrl: document.body.dataset.waitlist || "",
  tools: false,
  idleHint: "Type your name. On TikTok, frills_demo gives you made-up follows, gifts and shares. The test buttons above work without connecting.",
  events: () => (platform === "twitch" ? TWITCH_CHAT_KINDS : PLATFORM_KINDS.tiktok), // Twitch follows do not come through the chat connection
  onAlert: (event) => {
    seen[event.kind] += 1;
    showSeen(event.kind);
    send(event);
  },
  onState: (state) => {
    if (state === "connecting") {
      for (const kind of Object.keys(seen)) { seen[kind] = 0; $(`seen-${kind}`).textContent = "0"; }
    }
  },
  onFound: (found) => {
    $("seen-note").textContent = !found ? ""
      : found.features.includes("alerts") ? "The relay you are connected to can send alerts."
      : "The relay is an older version that can only send chat. It needs an update before alerts will arrive.";
  },
});

// ── Step 5: the link ─────────────────────────────────────────────────────────────────────────────────────────────
const linkInput = $("link");
const copyBtn = $("copy-link");
const linkHint = $("link-hint");
copyButton(copyBtn, () => linkInput.value);

function refreshLink() {
  const channel = source.cleanChannel();
  if (!channel) {
    linkInput.value = "";
    copyBtn.disabled = true;
    linkHint.textContent = "Your link appears here once you have typed your name in step 4.";
    return;
  }
  linkInput.value = alertsUrl(`${location.origin}/overlay/alerts/`, { channel, settings, platform, follows: platform === "twitch" && followsOn() ? followIdentity().code : "" });
  copyBtn.disabled = false;
  linkHint.replaceChildren("Paste it into a Browser source in your streaming app, next to your chat. For a vertical LIVE use 1080 wide by 1920 high. ");
  const guide = document.createElement("a");
  guide.href = "/guides/alerts/";
  guide.textContent = "How to set up and test alerts";
  linkHint.append(guide, ".");
}
linkInput.addEventListener("focus", () => linkInput.select());
// ── Twitch follows: in-editor login, watcher & bridge ───────────────────────────────────────────
const mainEl = $("main");
const clientId = mainEl?.dataset?.client || "";
const redirectUri = location.origin + REDIRECT_PATH;
const tickerJs = mainEl?.dataset?.ticker || "";

const twStatus = $("tw-status");
const twLoginBtn = $("tw-login-btn");
const twLogoutBtn = $("tw-logout-btn");
const twTestFollowerBtn = $("tw-test-follower");

const identity = followIdentity();
let lastError = 0;
const publisher = new FollowPublisher({
  code: identity.code,
  key: identity.key,
  onError: (status) => { lastError = status; },
});

let watcher = null;
let watcherClock = null;

function startClock(fn, every) {
  try {
    if (tickerJs) {
      const worker = new Worker(tickerJs);
      worker.onmessage = fn;
      worker.postMessage({ every });
      return { stop: () => worker.terminate() };
    }
  } catch {}
  const id = setInterval(fn, every);
  return { stop: () => clearInterval(id) };
}

function stopWatcher() {
  watcher?.stop();
  watcher = null;
  watcherClock?.stop();
  watcherClock = null;
}

const seenFollowIds = new Set();

async function onTwitchFollow(follow) {
  if (follow.id && seenFollowIds.has(follow.id)) return;
  if (follow.id) seenFollowIds.add(follow.id);
  await publisher.send(follow);
  send({ kind: "follow", id: follow.id, user: follow.user, name: follow.name, avatar: "" });
  seen.follow += 1;
  showSeen("follow");
}

function onWatcherStatus(s) {
  const note = $("follows-state");
  if (!note) return;
  if (s.state === "listening") {
    note.textContent = "The Twitch follows page is running, so new followers will show up in your alerts.";
    note.dataset.state = "";
  } else if (s.state === "expired") {
    note.textContent = "Your Twitch login has ended. Log in again.";
    note.dataset.state = "error";
    stopWatcher();
    clearLogin();
    syncTwitchAuth();
  } else if (s.state === "error") {
    note.textContent = s.detail || "Could not connect to Twitch.";
    note.dataset.state = "error";
  }
}

async function startWatcher(login) {
  if (watcher || !clientId) return;
  watcher = new FollowWatcher({
    token: login.token,
    clientId,
    userId: login.userId,
    onFollow: onTwitchFollow,
    onStatus: onWatcherStatus,
  });
  watcher.start();
  publisher.ping();
  watcherClock = startClock(async () => {
    publisher.ping();
    if (Date.now() - (login.checkedAt ?? 0) > 3600 * 1000) {
      login.checkedAt = Date.now();
      const who = await validate(login.token);
      if (who.expired) onWatcherStatus({ state: "expired", detail: who.error });
    }
  }, 30000);
}

async function syncTwitchAuth() {
  if (!twStatus) return;
  const login = loadLogin();
  if (!login) {
    twStatus.textContent = clientId ? "Not logged in with Twitch." : "This site has no Twitch app set up yet.";
    twStatus.dataset.state = "";
    if (twLoginBtn) { twLoginBtn.hidden = false; twLoginBtn.disabled = !clientId; }
    if (twLogoutBtn) twLogoutBtn.hidden = true;
    if (twTestFollowerBtn) twTestFollowerBtn.hidden = true;
    stopWatcher();
    return;
  }
  twStatus.textContent = `Logged in as @${login.login}.`;
  twStatus.dataset.state = "";
  if (twLoginBtn) twLoginBtn.hidden = true;
  if (twLogoutBtn) twLogoutBtn.hidden = false;
  if (twTestFollowerBtn) twTestFollowerBtn.hidden = false;

  if (!followsBox.checked) {
    followsBox.checked = true;
    setFollowsOn(true);
    refreshLink();
  }

  const who = await validate(login.token);
  if (who.expired) {
    clearLogin();
    syncTwitchAuth();
    twStatus.textContent = who.error || "The Twitch login has ended. Log in again.";
    twStatus.dataset.state = "error";
    return;
  }

  if (platform === "twitch") {
    startWatcher(login);
  }
}

if (twLoginBtn) {
  twLoginBtn.addEventListener("click", () => {
    if (!clientId) return;
    twLoginBtn.disabled = true;
    try { sessionStorage.setItem("frills:twitch:return", location.pathname + location.search); } catch {}
    location.assign(beginLogin({ clientId, redirectUri }));
  });
}

if (twLogoutBtn) {
  twLogoutBtn.addEventListener("click", () => {
    stopWatcher();
    clearLogin();
    syncTwitchAuth();
    checkFollows();
  });
}

if (twTestFollowerBtn) {
  twTestFollowerBtn.addEventListener("click", async () => {
    const note = $("follows-state");
    const testFollow = { id: `test-${Date.now()}`, user: "frills_test", name: "Frills Test" };
    const sent = await publisher.send(testFollow);
    send({ kind: "follow", id: testFollow.id, user: testFollow.user, name: testFollow.name, avatar: "" });
    seen.follow += 1;
    showSeen("follow");
    if (note) {
      note.textContent = sent
        ? "Test follower sent! It pops up here in the preview and in your live overlay."
        : "Sent to preview. (Could not reach bridge server: " + lastError + ")";
      note.dataset.state = "";
    }
  });
}

const followsBox = $("follows-on");
followsBox.checked = followsOn();
let followsTimer = 0;
async function checkFollows() {
  clearTimeout(followsTimer);
  const note = $("follows-state");
  if (platform !== "twitch" || !followsBox.checked) { if (note) note.textContent = ""; return; }
  const login = loadLogin();
  if (login && watcher) {
    if (note) {
      note.textContent = "The Twitch follows page is running, so new followers will show up in your alerts.";
      note.dataset.state = "";
    }
    followsTimer = setTimeout(checkFollows, 10000);
    return;
  }
  try {
    const res = await fetch("/api/follows/" + identity.code, { cache: "no-store" });
    const data = await res.json();
    const alive = data.updatedAt > 0 && data.now - data.updatedAt < 180000;
    if (note) {
      note.textContent = alive
        ? "The Twitch follows page is running, so new followers will show up in your alerts."
        : "The Twitch follows page is not running. Open it, log in, and keep it open while you stream.";
      note.dataset.state = "";
    }
  } catch {
    if (note) note.textContent = "";
  }
  followsTimer = setTimeout(checkFollows, 10000);
}

let followReader = null;
function syncFollowReader() {
  followReader?.stop();
  followReader = null;
  if (platform !== "twitch" || !followsBox.checked) return;
  followReader = new FollowReader({
    code: identity.code,
    onFollow: (f) => {
      if (f.id && seenFollowIds.has(f.id)) return;
      if (f.id) seenFollowIds.add(f.id);
      send({ kind: "follow", id: f.id, user: f.user, name: f.name, avatar: "" });
    },
  }).start();
}

/** Shows what belongs to the chosen place you stream (its test buttons, its sections, its counters) and hides the rest. */
function showPlatform() {
  for (const node of document.querySelectorAll("[data-platform]")) node.hidden = !node.dataset.platform.split(" ").includes(platform);
  if (platform === "twitch") syncTwitchAuth();
  else stopWatcher();
  checkFollows();
  syncFollowReader();
}

followsBox.addEventListener("change", () => { setFollowsOn(followsBox.checked); refreshLink(); checkFollows(); syncFollowReader(); });
source.onChange(() => {
  if (source.platform !== platform) { platform = source.platform; showPlatform(); }
  refreshLink();
  save();
});
showPlatform();

function save() {
  try { localStorage.setItem(STORE, JSON.stringify({ settings, channel: source.channel, platform, canvas })); } catch { /* storage can be blocked; the editor still works */ }
}

// ── The preview itself ───────────────────────────────────────────────────────────────────────────────────────────
$("backdrop").addEventListener("change", (event) => { $("preview").dataset.back = event.target.value; });
// The preview is a true copy of the page your streaming app will show (a vertical LIVE is 1080 x 1920), shrunk to fit the panel, so
// sizes, distances and wrapping are exactly what you will get.
const CANVASES = { vertical: [1080, 1920], landscape: [1920, 1080], square: [1080, 1080] };
let canvas = CANVASES[saved?.canvas] ? saved.canvas : "vertical";
function fit() {
  const [w, h] = CANVASES[canvas];
  const room = $("stage").getBoundingClientRect();
  const k = Math.max(0.05, Math.min(room.width / w, room.height / h));
  const host = $("alerts");
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
new ResizeObserver(fit).observe($("stage"));
fit();

fontsReady(generalFaces(settings), 900).then(paint);
paint();
refreshLink();
showSoundState();
