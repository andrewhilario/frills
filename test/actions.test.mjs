// Unit tests for OBS WebSocket v5 client (obs-ws.js) and OBS & Stream Actions engine (actions.js):
// SHA-256 auth handshake, URL hash password isolation, 10-free vs unlimited-Plus rule limits,
// all trigger kinds (commands with roles, gifts, likes, subs, bits, raids), cooldowns, queue,
// and all 9 OBS step types including instant Replay Cam & auto-revert timers.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ObsClient, cleanObsPort, localSecretsFromHash, obsAuthString, obsPassFromHash, withLocalSecretsHash, withObsPassHash } from "../src/js/obs-ws.js";
import { SLOBS_DEFAULT_PORT, SlobsClient, cleanSlobsPort } from "../src/js/slobs-ws.js";
import { VtsClient, cleanVtsPort, pickFaceMeshName } from "../src/js/vts-ws.js";
import {
  ACTIONS,
  ACTION_STARTERS,
  ActionEngine,
  FREE_ACTIONS_LIMIT,
  FREE_STICKY_NOTES_LIMIT,
  PLUS_ACTIONS_LIMIT,
  VTS_STICKY_SHAPES,
  createObsStepExecutor,
  createVtsStepExecutor,
  decodeRules,
  encodeRules,
  formatTemplate,
  hasFreeVtsSteps,
  hasPlusStickyShape,
  hasPlusVtsSteps,
  hasVtsSteps,
  sanitizeRules,
  sanitizeStep,
} from "../src/js/actions.js";

test("obsAuthString matches OBS WebSocket v5 SHA-256 formula and password stays strictly in URL #hash", async () => {
  const secret = createHash("sha256").update("supersecret" + "salt123").digest("base64");
  const expected = createHash("sha256").update(secret + "challenge456").digest("base64");
  assert.equal(await obsAuthString("supersecret", "salt123", "challenge456"), expected);

  assert.equal(cleanObsPort("4455"), 4455);
  assert.equal(cleanObsPort("0"), 4455);
  assert.equal(cleanObsPort("99999"), 4455);
  assert.equal(cleanObsPort("4499"), 4499);

  const link = withObsPassHash("https://frills.valwidgets.live/overlay/actions/?channel=mochi", "p@ss#word=1");
  const parsed = new URL(link);
  assert.equal(parsed.searchParams.has("obsPass"), false, "password never enters query string");
  assert.equal(obsPassFromHash(parsed.hash), "p@ss#word=1");
  assert.equal(withObsPassHash("https://frills.valwidgets.live/overlay/actions/?channel=mochi", ""), "https://frills.valwidgets.live/overlay/actions/?channel=mochi");
});

test("Free tier enforces 10-action cap while Plus unlocks unlimited actions (up to 100) and URL round-trips cleanly", () => {
  assert.equal(FREE_ACTIONS_LIMIT, 10);
  assert.ok(PLUS_ACTIONS_LIMIT >= 50);

  const fifteen = Array.from({ length: 15 }, (_, i) => ({
    id: `rule_${i + 1}`,
    name: `Action ${i + 1}`,
    trigger: { kind: "command", command: `cmd${i + 1}`, who: "everyone" },
    steps: [{ type: "frills.sound", sound: "pop", volume: 80 }],
  }));

  const freeClean = sanitizeRules(fifteen, { limit: FREE_ACTIONS_LIMIT });
  assert.equal(freeClean.length, 10, "free users are capped at 10 actions");

  const plusClean = sanitizeRules(fifteen, { limit: PLUS_ACTIONS_LIMIT });
  assert.equal(plusClean.length, 15, "Plus users keep all 15 actions");

  const encoded = encodeRules(fifteen, { limit: PLUS_ACTIONS_LIMIT });
  assert.equal(decodeRules(encoded, { limit: FREE_ACTIONS_LIMIT }).length, 10, "overlay enforces 10 cap for free links");
  assert.equal(decodeRules(encoded, { limit: PLUS_ACTIONS_LIMIT }).length, 15, "overlay unlocks all 15 for Plus links");

  const settings = ACTIONS.sanitize({ ...ACTIONS.defaults, obsPort: 4488, rules: encoded, showToasts: false });
  const url = new URL(ACTIONS.url("https://frills.example/overlay/actions/", { channel: "pondpal", settings }));
  assert.equal(url.searchParams.get("obsPort"), "4488");
  assert.equal(url.searchParams.get("showToasts"), "0");
  assert.deepEqual(ACTIONS.sanitize(ACTIONS.fromParams(url.searchParams)), settings);
  assert.ok(ACTION_STARTERS.length >= 8);
});

test("ObsClient handles v5 handshake, auth errors, RPC calls, ReplayBufferSaved events, discovery & Replay Cam creation", async () => {
  const sent = [];
  let sockInstance = null;
  class FakeWS {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.listeners = new Map();
      sockInstance = this;
      queueMicrotask(() => {
        this._emit("message", {
          data: JSON.stringify({
            op: 0,
            d: { obsWebSocketVersion: "5.5.2", authentication: { challenge: "ch1", salt: "sa1" } },
          }),
        });
      });
    }
    addEventListener(ev, fn) {
      if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
      this.listeners.get(ev).add(fn);
    }
    _emit(ev, payload) {
      for (const fn of this.listeners.get(ev) ?? []) fn(payload);
    }
    send(raw) {
      const msg = JSON.parse(raw);
      sent.push(msg);
      if (msg.op === 1) {
        if (msg.d.authentication === "BAD") {
          this._emit("close", { code: 4009 });
        } else {
          this._emit("message", { data: JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }) });
        }
      } else if (msg.op === 6) {
        const { requestType, requestId } = msg.d;
        const respond = (responseData = {}) => {
          this._emit("message", { data: JSON.stringify({ op: 7, d: { requestType, requestId, requestStatus: { result: true, code: 100 }, responseData } }) });
        };
        if (requestType === "GetSceneList") respond({ currentProgramSceneName: "Gameplay", scenes: [{ sceneName: "BRB" }, { sceneName: "Gameplay" }] });
        else if (requestType === "GetInputList") respond({ inputs: [{ inputName: "Mic/Aux", inputKind: "wasapi_input_capture" }] });
        else if (requestType === "GetSceneItemList") respond({ sceneItems: [{ sourceName: "Webcam", sceneItemId: 2 }] });
        else if (requestType === "GetHotkeyList") respond({ hotkeys: ["OBSBasic.Screenshot"] });
        else if (requestType === "GetReplayBufferStatus") respond({ outputActive: true });
        else if (requestType === "GetCurrentProgramScene") respond({ currentProgramSceneName: "Gameplay" });
        else if (requestType === "GetVideoSettings") respond({ baseWidth: 1920, baseHeight: 1080 });
        else if (requestType === "GetSceneItemId") {
          this._emit("message", { data: JSON.stringify({ op: 7, d: { requestType, requestId, requestStatus: { result: false, code: 600, comment: "Not found" } } }) });
        } else if (requestType === "CreateInput") respond({ sceneItemId: 42 });
        else respond({});
      }
    }
    close() {
      this.readyState = 3;
      this._emit("close", { code: 1000 });
    }
  }

  const statuses = [];
  const client = new ObsClient({ port: 4455, password: "secret", reconnect: false, WebSocketCtor: FakeWS, onStatus: (s) => statuses.push(s.state) });
  await client.connect();
  assert.equal(client.connected, true);
  assert.equal(client.version, "5.5.2");
  assert.equal(sent[0].d.authentication, await obsAuthString("secret", "sa1", "ch1"));

  const disc = await client.discover();
  assert.deepEqual(disc.scenes, ["Gameplay", "BRB"]);
  assert.equal(disc.replayBufferActive, true);
  assert.ok(disc.sources.includes("Webcam"));

  const cam = await client.ensureReplayCam({ sourceName: "Frills Replay Cam", layout: "pip" });
  assert.equal(cam.created, true);
  assert.equal(cam.sceneItemId, 42);

  const waitEv = client.waitForEvent("ReplayBufferSaved", () => true, 2000);
  sockInstance._emit("message", { data: JSON.stringify({ op: 5, d: { eventType: "ReplayBufferSaved", eventData: { savedReplayPath: "C:/Replays/clip1.mp4" } } }) });
  assert.equal((await waitEv).savedReplayPath, "C:/Replays/clip1.mp4");
  client.close();
});

test("ActionEngine evaluates roles, gifts, likes, bits, cooldowns, dedupe, and multi-step execution cleanly", async () => {
  let clock = 10_000;
  const ran = [];
  const logs = [];
  const rules = [
    { id: "clip", name: "Clip", cooldownSec: 15, queue: true, trigger: { kind: "command", command: "clip", who: "mods" }, steps: [{ type: "obs.clip", toast: "Saved by {name}" }] },
    { id: "rose", name: "Rose Mute", cooldownSec: 0, queue: true, trigger: { kind: "gift", giftName: "Rose", minDiamonds: 1 }, steps: [{ type: "obs.mute", source: "Mic/Aux", mode: "mute", duration: 5 }, { type: "frills.sound", sound: "pop", volume: 80 }] },
    { id: "likes", name: "Like Burst", cooldownSec: 0, queue: false, trigger: { kind: "like", minLikes: 100 }, steps: [{ type: "frills.banner", title: "Likes!", text: "{who} hit {count}", seconds: 3, fx: "hearts" }] },
    { id: "bits", name: "Bits Filter", cooldownSec: 0, queue: true, trigger: { kind: "bits", minBits: 100 }, steps: [{ type: "obs.filter", source: "Webcam", filter: "Spin", mode: "on", duration: 8 }] },
  ];

  const engine = new ActionEngine({
    rules,
    limit: FREE_ACTIONS_LIMIT,
    channel: "pondpal",
    now: () => clock,
    runObs: async (step, ctx) => { ran.push(`${step.type}:${ctx.who}`); return { ok: true, detail: step.type }; },
    playSound: (s) => ran.push(`sound:${s}`),
    showBanner: (b) => ran.push(`banner:${b.title}:${b.text}`),
    wait: async () => {},
    onLog: (l) => logs.push(l),
  });

  // Viewer cannot run mods-only !clip
  assert.deepEqual(engine.handleChat({ id: "c1", user: "v1", name: "Viewer", text: "!clip", mod: false, host: false }), []);
  assert.equal(logs[logs.length - 1].status, "skipped");

  // Mod runs !clip; duplicate message ID ignored; second run within 15s hits cooldown
  assert.deepEqual(engine.handleChat({ id: "c2", user: "m1", name: "ModCat", text: "!clip", mod: true }), ["clip"]);
  assert.deepEqual(engine.handleChat({ id: "c2", user: "m1", name: "ModCat", text: "!clip", mod: true }), []);
  clock += 5000;
  assert.deepEqual(engine.handleChat({ id: "c3", user: "m1", name: "ModCat", text: "!clip", mod: true }), []);
  clock += 12000;
  assert.deepEqual(engine.handleChat({ id: "c4", user: "h1", login: "pondpal", name: "Host", text: "!clip" }), ["clip"]);

  // Gift exact name check (including same platform msgId arriving on chat + alert streams, as TikTok gifts & Twitch bits do)
  assert.deepEqual(engine.handleChat({ id: "g2", user: "u-ben", name: "Ben", text: "sent Rose ×1", gift: true }), []);
  assert.deepEqual(engine.handleEvent({ id: "g1", kind: "gift", name: "Ann", gift: "Panda", diamonds: 100, count: 1, total: 100 }), []);
  assert.deepEqual(engine.handleEvent({ id: "g2", kind: "gift", name: "Ben", gift: "Rose", diamonds: 1, count: 1, total: 1 }), ["rose"]);
  assert.deepEqual(engine.handleEvent({ id: "g2", kind: "gift", name: "Ben", gift: "Rose", diamonds: 1, count: 1, total: 1 }), [], "duplicate gift alert still deduped");

  // Likes accumulate until 100
  assert.deepEqual(engine.handleEvent({ id: "l1", kind: "like", name: "Cat", count: 60 }), []);
  assert.deepEqual(engine.handleEvent({ id: "l2", kind: "like", name: "Dan", count: 55 }), ["likes"]);

  // Twitch bits threshold
  assert.deepEqual(engine.handleEvent({ id: "b1", kind: "bits", name: "Eve", count: 50 }), []);
  assert.deepEqual(engine.handleEvent({ id: "b2", kind: "bits", name: "Eve", count: 250 }), ["bits"]);

  await new Promise((r) => setTimeout(r, 20));
  assert.ok(ran.includes("obs.clip:ModCat"));
  assert.ok(ran.includes("obs.clip:Host"));
  assert.ok(ran.includes("obs.mute:Ben"));
  assert.ok(ran.includes("sound:pop"));
  assert.ok(ran.includes("banner:Likes!:Dan hit 100"));
  assert.ok(ran.includes("obs.filter:Eve"));
  assert.equal(formatTemplate("{name} sent {gift} ({count})", { who: "Mochi", gift: "Galaxy", count: 2 }), "Mochi sent Galaxy (2)");
});

test("createObsStepExecutor runs instant Replay Cam end-to-end and auto-reverts timed scenes/mutes", async () => {
  const calls = [];
  const scheduled = [];
  const fakeObs = {
    connected: true,
    async call(type, data = {}) {
      calls.push([type, data]);
      if (type === "GetCurrentProgramScene") return { currentProgramSceneName: "Main" };
      if (type === "GetSceneItemId") return { sceneItemId: 7 };
      if (type === "GetInputMute") return { inputMuted: false };
      return {};
    },
    waitForEvent(type) {
      if (type === "ReplayBufferSaved") return Promise.resolve({ savedReplayPath: "C:/Clips/last.mp4" });
      if (type === "MediaInputPlaybackEnded") return Promise.resolve({ inputName: "Frills Replay Cam" });
      return Promise.resolve({});
    },
  };

  const replayEvents = [];
  const exec = createObsStepExecutor(fakeObs, {
    onReplayStart: (i) => replayEvents.push(["start", i.badge]),
    onReplayEnd: () => replayEvents.push(["end"]),
    schedule: (fn, ms) => { scheduled.push({ fn, ms }); return scheduled.length; },
    cancelSchedule: () => {},
  });

  // 1. Instant Replay Cam
  const r = await exec.run({ type: "obs.replay", source: "Frills Replay Cam", speed: 75, saveFirst: true, maxSec: 20, badge: "SLOW-MO" }, { who: "Ann", label: "!replay" });
  assert.equal(r.ok, true);
  assert.deepEqual(replayEvents, [["start", "SLOW-MO"], ["end"]]);
  assert.ok(calls.some(([t, d]) => t === "SetInputSettings" && d.inputSettings.local_file === "C:/Clips/last.mp4" && d.inputSettings.speed_percent === 75));
  assert.ok(calls.some(([t, d]) => t === "SetSceneItemEnabled" && d.sceneItemId === 7 && d.sceneItemEnabled === true));
  assert.ok(calls.some(([t, d]) => t === "SetSceneItemEnabled" && d.sceneItemId === 7 && d.sceneItemEnabled === false));

  // 2. Timed scene switch + mute auto-revert
  await exec.run({ type: "obs.scene", scene: "Zoom Cam", duration: 10 }, { who: "Ben" });
  await exec.run({ type: "obs.mute", source: "Mic/Aux", mode: "mute", duration: 8 }, { who: "Ben" });
  assert.equal(scheduled.length, 2);
  assert.deepEqual(scheduled.map((s) => s.ms), [10000, 8000]);
  for (const s of scheduled) s.fn();
  await new Promise((res) => setTimeout(res, 5));
  assert.ok(calls.some(([t, d]) => t === "SetCurrentProgramScene" && d.sceneName === "Main"), "scene reverted");
  assert.ok(calls.some(([t, d]) => t === "SetInputMute" && d.inputName === "Mic/Aux" && d.inputMuted === false), "mic unmuted");
});

test("VtsClient pairs via Allow popup, discovers hotkeys/expressions/items/meshes, and createVtsStepExecutor runs & reverts all 6 VTS actions including named sticky notes", async () => {
  assert.equal(cleanVtsPort("8001"), 8001);
  assert.equal(cleanVtsPort("0"), 8001);
  assert.equal(pickFaceMeshName(["Eye_Left", "Mouth_Inner", "Face_Skin", "Hair_Back"]), "Face_Skin");
  assert.equal(pickFaceMeshName(["Eye_Left", "Face_Skin"], "Cheek_L"), "Cheek_L");
  const bothUrl = withLocalSecretsHash("https://frills.example/overlay/actions/?channel=mochi", { obsPass: "obs1", vtsToken: "vts-tok-99" });
  const parsed = new URL(bothUrl);
  assert.equal(parsed.searchParams.has("vtsToken"), false);
  assert.deepEqual(localSecretsFromHash(parsed.hash), { obsPass: "obs1", vtsToken: "vts-tok-99" });

  const sent = [];
  class FakeVtsWS {
    constructor() {
      this.readyState = 1;
      this.listeners = new Map();
      queueMicrotask(() => this._emit("open", {}));
    }
    addEventListener(ev, fn) {
      if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
      this.listeners.get(ev).add(fn);
    }
    _emit(ev, payload) { for (const fn of this.listeners.get(ev) ?? []) fn(payload); }
    send(raw) {
      const msg = JSON.parse(raw);
      sent.push(msg);
      const reply = (messageType, data = {}) => this._emit("message", { data: JSON.stringify({ apiName: "VTubeStudioPublicAPI", apiVersion: "1.0", requestID: msg.requestID, messageType, data }) });
      if (msg.messageType === "AuthenticationTokenRequest") reply("AuthenticationTokenResponse", { authenticationToken: "vts-live-token" });
      else if (msg.messageType === "AuthenticationRequest") reply("AuthenticationResponse", { authenticated: msg.data.authenticationToken === "vts-live-token" });
      else if (msg.messageType === "CurrentModelRequest") reply("CurrentModelResponse", { modelLoaded: true, modelName: "Mochi Live2D", modelID: "m1", modelPosition: { positionX: 0.1, positionY: -0.2, rotation: 0, size: -20 } });
      else if (msg.messageType === "HotkeysInCurrentModelRequest") reply("HotkeysInCurrentModelResponse", { availableHotkeys: [{ hotkeyID: "hk-sticky", name: "Sticky Note", type: "ToggleItemScene" }] });
      else if (msg.messageType === "ExpressionStateRequest") reply("ExpressionStateResponse", { expressions: [{ name: "Blush", file: "blush.exp3.json", active: false }] });
      else if (msg.messageType === "ItemListRequest") reply("ItemListResponse", { availableItemFiles: [{ fileName: "sticky_note.png" }] });
      else if (msg.messageType === "ArtMeshListRequest") reply("ArtMeshListResponse", { modelLoaded: true, artMeshNames: ["Eye_L", "Face_Skin", "Hair_Front"] });
      else if (msg.messageType === "PermissionRequest") reply("PermissionResponse", { grantSuccess: true, requestedPermission: msg.data.requestedPermission, permissions: [{ name: "LoadCustomImagesAsItems", granted: true }] });
      else if (msg.messageType === "ItemLoadRequest") reply("ItemLoadResponse", { instanceID: msg.data.customDataBase64 ? "inst-sticky-88" : "inst-77", fileName: msg.data.fileName });
      else if (msg.messageType === "ItemPinRequest") reply("ItemPinResponse", { isPinned: true, itemInstanceID: msg.data.itemInstanceID });
      else reply(msg.messageType.replace(/Request$/, "Response"), {});
    }
    close() { this.readyState = 3; this._emit("close", { code: 1000 }); }
  }

  let savedTok = "";
  const client = new VtsClient({ port: 8001, interactiveAuth: true, reconnect: false, WebSocketCtor: FakeVtsWS, onToken: (t) => { savedTok = t; } });
  await client.connect();
  assert.equal(client.connected, true);
  assert.equal(savedTok, "vts-live-token");

  const disc = await client.discover();
  assert.equal(disc.modelName, "Mochi Live2D");
  assert.equal(disc.hotkeys[0].name, "Sticky Note");
  assert.equal(disc.expressions[0].file, "blush.exp3.json");
  assert.deepEqual(disc.items, ["sticky_note.png"]);
  assert.deepEqual(disc.artMeshes, ["Eye_L", "Face_Skin", "Hair_Front"]);

  const scheduled = [];
  const renderedSticky = [];
  const exec = createVtsStepExecutor(client, {
    renderStickyNote: (opts) => { renderedSticky.push(opts); return "iVBORw0KGgoAAAANSUhEUg=="; },
    schedule: (fn, ms) => { scheduled.push({ fn, ms }); return scheduled.length; },
    cancelSchedule: () => {},
  });

  // 0. Dynamic Sticky note with gifter's name (duration: 0 -> stays on face across reloads)
  const stickyStayRes = await exec.run(
    { type: "vts.sticky", title: "{name}", subtitle: "{gift}", color: "random", pinMode: "face", artMesh: "", size: 22, rotation: -6, duration: 0 },
    { who: "Mochi Fan", gift: "Galaxy" },
  );
  assert.equal(stickyStayRes.ok, true);
  assert.match(stickyStayRes.detail, /pinned to Face_Skin \(stays\)/);
  assert.deepEqual(renderedSticky[0], { title: "Mochi Fan", subtitle: "Galaxy", color: "random", shape: "note" });
  assert.ok(sent.some((m) => m.messageType === "PermissionRequest" && m.data.requestedPermission === "LoadCustomImagesAsItems"));
  const loadSticky = sent.find((m) => m.messageType === "ItemLoadRequest" && m.data.customDataBase64);
  assert.ok(loadSticky, "sticky note loaded with customDataBase64");
  assert.match(loadSticky.data.fileName, /^[a-z0-9-]{4,28}\.png$/);
  assert.ok(loadSticky.data.fileName.length >= 8 && loadSticky.data.fileName.length <= 32);
  assert.equal(loadSticky.data.customDataAskUserFirst, false);
  assert.equal(loadSticky.data.unloadWhenPluginDisconnects, false, "permanent sticky notes stay on face");
  const pinSticky = sent.find((m) => m.messageType === "ItemPinRequest" && m.data.itemInstanceID === "inst-sticky-88");
  assert.ok(pinSticky, "sticky note pinned to avatar");
  assert.equal(pinSticky.data.pinInfo.artMeshID, "Face_Skin");
  assert.equal(pinSticky.data.vertexPinType, "Random");

  // 0b. Timed sticky note (duration > 0 -> schedules auto-unload)
  const stickyRes = await exec.run(
    { type: "vts.sticky", title: "{name}", subtitle: "{gift}", color: "yellow", pinMode: "center", artMesh: "", size: 26, rotation: -6, duration: 25 },
    { who: "Timed Fan", gift: "Rose" },
  );
  assert.equal(stickyRes.ok, true);
  assert.ok(sent.some((m) => m.messageType === "ItemPinRequest" && m.data.vertexPinType === "Center" && m.data.pinInfo.artMeshID === "Face_Skin"));

  // 1. Hotkey ("Sticky Note" resolves to "hk-sticky") + toggle-off timer
  await exec.run({ type: "vts.hotkey", hotkey: "Sticky Note", duration: 30 }, { who: "Ann" });
  assert.ok(sent.some((m) => m.messageType === "HotkeyTriggerRequest" && m.data.hotkeyID === "hk-sticky"));

  // 2. Drop item + auto-unload timer
  await exec.run({ type: "vts.item", fileName: "sticky_note.png", size: 35, posX: 10, posY: 20, rotation: 0, duration: 20 }, { who: "Ben" });
  assert.ok(sent.some((m) => m.messageType === "ItemLoadRequest" && m.data.fileName === "sticky_note.png"));

  // 3. Expression ("Blush" resolves to "blush.exp3.json") + revert
  await exec.run({ type: "vts.expression", expression: "Blush", mode: "on", duration: 10 }, { who: "Cat" });
  assert.ok(sent.some((m) => m.messageType === "ExpressionActivationRequest" && m.data.expressionFile === "blush.exp3.json" && m.data.active === true));

  // 4. Move zoom + restore to original modelPosition
  await exec.run({ type: "vts.move", preset: "zoom", duration: 8 }, { who: "Dan" });
  assert.ok(sent.some((m) => m.messageType === "MoveModelRequest" && m.data.valuesAreRelativeToModel === true && m.data.size === 32));

  // 5. Color tint + reset to white
  await exec.run({ type: "vts.tint", color: "#ff66aa", duration: 6 }, { who: "Eve" });
  assert.ok(sent.some((m) => m.messageType === "ColorTintRequest" && m.data.colorTint.colorR === 255 && m.data.colorTint.colorG === 102 && m.data.colorTint.colorB === 170));

  // Fire all 6 auto-revert timers
  assert.deepEqual(scheduled.map((s) => s.ms), [25000, 30000, 20000, 10000, 8000, 6000]);
  for (const s of scheduled) s.fn();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(sent.some((m) => m.messageType === "ItemUnloadRequest" && m.data.instanceIDs?.[0] === "inst-sticky-88"), "named sticky note unloaded");
  assert.equal(sent.filter((m) => m.messageType === "HotkeyTriggerRequest" && m.data.hotkeyID === "hk-sticky").length, 2, "hotkey toggled back off");
  assert.ok(sent.some((m) => m.messageType === "ItemUnloadRequest" && m.data.instanceIDs?.[0] === "inst-77"), "dropped item unloaded");
  assert.ok(sent.some((m) => m.messageType === "ExpressionActivationRequest" && m.data.expressionFile === "blush.exp3.json" && m.data.active === false), "expression reverted");
  assert.ok(sent.some((m) => m.messageType === "MoveModelRequest" && m.data.valuesAreRelativeToModel === false && m.data.size === -20), "model restored to original position");
  assert.ok(sent.some((m) => m.messageType === "ColorTintRequest" && m.data.colorTint.colorR === 255 && m.data.colorTint.colorG === 255 && m.data.colorTint.colorB === 255), "tint reset to white");

  // Free 10-sticky-note automatic cap: 10 stay on face, manual notes from the website bypass the cap without evicting,
  // 11th automatic note evicts oldest; Plus (0 = unlimited) keeps all 12!
  assert.equal(FREE_STICKY_NOTES_LIMIT, 10);
  let seq = 0;
  const capSent = [];
  const capClient = {
    connected: true,
    async ensureCustomItemPermission() { return true; },
    async resolveFaceArtMesh() { return "Face_Skin"; },
    async call(type, data) {
      capSent.push([type, data]);
      if (type === "ItemLoadRequest") return { instanceID: `sticky-${++seq}`, fileName: data.fileName };
      return {};
    },
  };
  const freeExec = createVtsStepExecutor(capClient, { maxStickyNotes: FREE_STICKY_NOTES_LIMIT, renderStickyNote: () => "iVBORw0KGgo=" });
  for (let i = 1; i <= 10; i++) {
    await freeExec.run({ type: "vts.sticky", title: "{name}", subtitle: "", color: "yellow", pinMode: "face", artMesh: "", size: 22, rotation: -6, duration: 0 }, { who: `Fan ${i}` });
  }
  assert.equal(capSent.filter(([t]) => t === "ItemUnloadRequest").length, 0, "first 10 automatic free sticky notes stay without eviction");
  // Manual sticky note pinned from the website bypasses the 10-note automatic cap and does not evict existing notes
  const manualExtra = await freeExec.run({ type: "vts.sticky", title: "{name}", subtitle: "", color: "pink", pinMode: "face", artMesh: "", size: 22, rotation: -6, duration: 0 }, { who: "Manual VIP", manual: true });
  assert.equal(manualExtra.ok, true);
  assert.doesNotMatch(manualExtra.detail, /free cap/);
  assert.equal(capSent.filter(([t]) => t === "ItemUnloadRequest").length, 0, "manual sticky note does not evict automatic notes");
  const eleventh = await freeExec.run({ type: "vts.sticky", title: "{name}", subtitle: "", color: "yellow", pinMode: "face", artMesh: "", size: 22, rotation: -6, duration: 0 }, { who: "Fan 11" });
  assert.match(eleventh.detail, /10\/10 free cap/);
  assert.deepEqual(capSent.filter(([t]) => t === "ItemUnloadRequest").map(([, d]) => d.instanceIDs[0]), ["sticky-1"], "11th automatic free sticky note peels off oldest (#1)");

  // Unlimited (Plus): 12 automatic sticky notes all stay with zero evictions
  freeExec.clearStickyTracking();
  freeExec.setMaxStickyNotes(0);
  const unloadsBeforePlus = capSent.filter(([t]) => t === "ItemUnloadRequest").length;
  for (let i = 1; i <= 12; i++) {
    await freeExec.run({ type: "vts.sticky", title: "{name}", subtitle: "", color: "random", pinMode: "face", artMesh: "", size: 22, rotation: -6, duration: 0 }, { who: `Plus ${i}` });
  }
  assert.equal(capSent.filter(([t]) => t === "ItemUnloadRequest").length, unloadsBeforePlus, "Plus allows unlimited sticky notes without eviction");

  // Free live overlay allows vts.sticky live, blocks Plus-only vts.hotkey / vts.move cleanly when allowVts is false
  const logs = [];
  const ranVts = [];
  const freeRules = [
    { id: "s1", name: "Named Sticky", cooldownSec: 0, trigger: { kind: "gift", minDiamonds: 100 }, steps: [{ type: "vts.sticky", title: "{name}", duration: 0 }] },
    { id: "h1", name: "Hotkey", cooldownSec: 0, trigger: { kind: "gift", minDiamonds: 100 }, steps: [{ type: "vts.hotkey", hotkey: "Sticky Note", duration: 30 }] },
  ];
  assert.equal(hasVtsSteps(freeRules), true);
  assert.equal(hasFreeVtsSteps(freeRules), true);
  assert.equal(hasPlusVtsSteps(freeRules), true);
  const freeEngine = new ActionEngine({
    rules: freeRules,
    allowVts: false,
    runVts: async (step) => { ranVts.push(step.type); return { ok: true, detail: step.type }; },
    onLog: (l) => logs.push(l),
  });
  freeEngine.handleEvent({ id: "g100", kind: "gift", name: "Ann", gift: "Confetti", diamonds: 100, count: 1, total: 100 });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(ranVts, ["vts.sticky"], "free live overlay executes vts.sticky and blocks Plus-only vts.hotkey");
  const blocked = logs.find((l) => l.ruleId === "h1");
  assert.equal(blocked?.status, "error");
  assert.match(blocked?.detail || "", /Frills Plus/);
  // Custom sticker shapes: sanitizeStep validates shapes, Plus runs all shapes, Free gracefully falls back to pastel note
  assert.equal(VTS_STICKY_SHAPES.length, 6);
  assert.equal(sanitizeStep({ type: "vts.sticky", shape: "paw" }).shape, "paw");
  assert.equal(sanitizeStep({ type: "vts.sticky", shape: "heart" }).shape, "heart");
  assert.equal(sanitizeStep({ type: "vts.sticky", shape: "unknown-shape" }).shape, "note");
  assert.equal(hasPlusStickyShape([{ enabled: true, steps: [{ type: "vts.sticky", shape: "star" }] }]), true);
  assert.equal(hasPlusStickyShape([{ enabled: true, steps: [{ type: "vts.sticky", shape: "note" }] }]), false);

  const shapeCalls = [];
  const freeShapeExec = createVtsStepExecutor(capClient, {
    maxStickyNotes: FREE_STICKY_NOTES_LIMIT,
    allowPlusShapes: false,
    renderStickyNote: (opts) => { shapeCalls.push(opts.shape); return "iVBORw0KGgo="; },
  });
  const freeFallbackRes = await freeShapeExec.run(
    { type: "vts.sticky", title: "{name}", subtitle: "{gift}", shape: "paw", color: "pink", pinMode: "face", artMesh: "", size: 22, rotation: -6, duration: 0 },
    { who: "Free Fan", gift: "Rose" },
  );
  assert.equal(freeFallbackRes.ok, true);
  assert.match(freeFallbackRes.detail, /Plus shape fell back to pastel note/);
  assert.deepEqual(shapeCalls, ["note"], "free live overlay gracefully renders pastel note instead of failing");

  freeShapeExec.setAllowPlusShapes(true);
  for (const sh of ["heart", "star", "paw", "cloud", "random"]) {
    await freeShapeExec.run(
      { type: "vts.sticky", title: "{name}", subtitle: "{gift}", shape: sh, color: "pink", pinMode: "face", artMesh: "", size: 22, rotation: -6, duration: 0 },
      { who: "Plus Fan", gift: "Galaxy" },
    );
  }
  assert.deepEqual(shapeCalls.slice(1), ["heart", "star", "paw", "cloud", "random"], "Plus live overlay passes custom sticker shapes through");

  // Sticky note sizing: supports 5–100% (chibi-friendly down to 5%) and forwards size to both preview and VTS
  assert.equal(sanitizeStep({ type: "vts.sticky", size: 8 }).size, 8);
  assert.equal(sanitizeStep({ type: "vts.sticky", size: 2 }).size, 5);
  assert.equal(sanitizeStep({ type: "vts.sticky", size: 150 }).size, 100);
  const previewSizes = [];
  const sizeExec = createVtsStepExecutor(null, {
    previewFallback: true,
    renderStickyNote: () => "iVBORw0KGgo=",
    onStickyPreview: (p) => previewSizes.push(p.size),
  });
  await sizeExec.run({ type: "vts.sticky", title: "{name}", size: 10 }, { who: "Chibi" });
  assert.deepEqual(previewSizes, [10], "preview callback receives configured sticky note size");

  client.close();
});

test("SlobsClient speaks SockJS JSON-RPC, authenticates, resolves PROMISE emitters, discovers scenes/audio, and runs !clip/scene/source/mute", async () => {
  assert.equal(SLOBS_DEFAULT_PORT, 59650);
  assert.equal(cleanSlobsPort("59650"), 59650);
  assert.equal(cleanSlobsPort("0"), 59650);
  assert.equal(cleanSlobsPort("59700"), 59700);

  // URL round-trip preserves obsApp=slobs and port 59650
  const slobsSettings = ACTIONS.sanitize({ ...ACTIONS.defaults, obsApp: "slobs", obsPort: 59650 });
  const slobsUrl = new URL(ACTIONS.url("https://frills.example/overlay/actions/", { channel: "ainz", settings: slobsSettings }));
  assert.equal(slobsUrl.searchParams.get("obsApp"), "slobs");
  assert.equal(slobsUrl.searchParams.get("obsPort"), "59650");
  assert.deepEqual(ACTIONS.sanitize(ACTIONS.fromParams(slobsUrl.searchParams)), slobsSettings);

  // Missing token fails fast with auth-error
  const statuses = [];
  const noTok = new SlobsClient({ port: 59650, token: "", reconnect: false, onStatus: (s) => statuses.push(s.state) });
  await assert.rejects(() => noTok.connect(), /API token/i);
  assert.equal(statuses.at(-1), "auth-error");

  const rpcCalls = [];
  let replayStatus = "offline";
  let muted = false;
  let itemVisible = false;

  class FakeSlobsWS {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.listeners = new Map();
      assert.match(url, /^ws:\/\/127\.0\.0\.1:59650\/api\/\d{3}\/[a-z0-9]{8}\/websocket$/);
      queueMicrotask(() => this._emit("message", { data: "o" }));
    }
    addEventListener(ev, fn) {
      if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
      this.listeners.get(ev).add(fn);
    }
    _emit(ev, payload) {
      for (const fn of this.listeners.get(ev) ?? []) fn(payload);
    }
    _sendSock(obj) {
      this._emit("message", { data: "a" + JSON.stringify([JSON.stringify(obj)]) });
    }
    send(raw) {
      const batch = JSON.parse(raw);
      assert.ok(Array.isArray(batch), "client sends SockJS array frames");
      const msg = JSON.parse(batch[0]);
      const { id, method, params } = msg;
      const resource = params?.resource;
      const args = params?.args ?? [];
      rpcCalls.push([resource, method, args]);

      if (resource === "TcpServerService" && method === "auth") {
        this._sendSock({ jsonrpc: "2.0", id, result: args[0] === "good-token" });
      } else if (resource === "ScenesService" && method === "getScenes") {
        this._sendSock({
          jsonrpc: "2.0",
          id,
          result: [
            {
              id: "scene_1",
              name: "Bawowant",
              nodes: [{ id: "node_1", sceneId: "scene_1", sceneItemId: "item_1", sourceId: "src_cam", sceneNodeType: "item", name: "Model", visible: itemVisible }],
            },
            { id: "scene_2", name: "Wiwim", nodes: [] },
          ],
        });
      } else if (resource === "ScenesService" && method === "activeScene") {
        this._sendSock({ jsonrpc: "2.0", id, result: { id: "scene_1", name: "Bawowant" } });
      } else if (resource === "ScenesService" && method === "makeSceneActive") {
        this._sendSock({ jsonrpc: "2.0", id, result: true });
      } else if (resource === "AudioService" && method === "getSources") {
        this._sendSock({ jsonrpc: "2.0", id, result: [{ sourceId: "mic_1", name: "Mic/Aux", muted }] });
      } else if (resource === "StreamingService" && method === "getModel") {
        this._sendSock({ jsonrpc: "2.0", id, result: { streamingStatus: "live", recordingStatus: "offline", replayBufferStatus: replayStatus } });
      } else if (resource === "StreamingService" && method === "startReplayBuffer") {
        replayStatus = "running";
        // Exercise async PROMISE emitter completion path
        this._sendSock({ jsonrpc: "2.0", id, result: { _type: "SUBSCRIPTION", emitter: "PROMISE", resourceId: "promise_rb" } });
        queueMicrotask(() => this._sendSock({ jsonrpc: "2.0", id: null, result: { _type: "EVENT", emitter: "PROMISE", resourceId: "promise_rb", data: true } }));
      } else if (resource === "StreamingService" && method === "saveReplay") {
        this._sendSock({ jsonrpc: "2.0", id, result: null });
      } else if (resource.startsWith("SceneItem[") && method === "setVisibility") {
        itemVisible = Boolean(args[0]);
        this._sendSock({ jsonrpc: "2.0", id, result: null });
      } else if (resource === 'AudioSource["mic_1"]' && method === "setMuted") {
        muted = Boolean(args[0]);
        this._sendSock({ jsonrpc: "2.0", id, result: null });
      } else {
        this._sendSock({ jsonrpc: "2.0", id, result: null });
      }
    }
    close() {
      this.readyState = 3;
      this._emit("close", { code: 1000 });
    }
  }

  // Bad token triggers auth-error
  const bad = new SlobsClient({ port: 59650, token: "wrong-token", reconnect: false, WebSocketCtor: FakeSlobsWS });
  await assert.rejects(() => bad.connect(), /Wrong Streamlabs API token/i);

  // Good token connects, discovers, auto-starts Replay Buffer, and executes !clip, scene switch, source toggle, audio mute
  const slobs = new SlobsClient({ port: 59650, token: "good-token", reconnect: false, WebSocketCtor: FakeSlobsWS });
  await slobs.connect();
  assert.equal(slobs.connected, true);

  const info = await slobs.discover();
  assert.deepEqual(info.scenes, ["Bawowant", "Wiwim"]);
  assert.ok(info.sources.includes("Model"));
  assert.ok(info.inputs.includes("Mic/Aux"));
  assert.equal(info.replayBufferSupported, true);
  assert.equal(info.replayBufferActive, false);

  await slobs.call("StartReplayBuffer");
  assert.equal((await slobs.call("GetReplayBufferStatus")).outputActive, true);

  const toasts = [];
  const exec = createObsStepExecutor(slobs, { onToast: (t) => toasts.push(t) });
  const clipRes = await exec.run({ type: "obs.clip", toast: "Clip saved · {name}" }, { who: "Ainz" });
  assert.equal(clipRes.ok, true);
  assert.match(clipRes.detail, /Streamlabs/);
  assert.equal(toasts[0].text, "Clip saved · Ainz");
  assert.ok(rpcCalls.some(([r, m]) => r === "StreamingService" && m === "saveReplay"));

  await exec.run({ type: "obs.scene", scene: "Wiwim", duration: 0 }, { who: "Ainz" });
  assert.ok(rpcCalls.some(([r, m, a]) => r === "ScenesService" && m === "makeSceneActive" && a[0] === "scene_2"));

  await exec.run({ type: "obs.source", scene: "Bawowant", source: "Model", mode: "show", duration: 0 }, { who: "Ainz" });
  assert.equal(itemVisible, true);

  await exec.run({ type: "obs.mute", source: "Mic/Aux", mode: "mute", duration: 0 }, { who: "Ainz" });
  assert.equal(muted, true);

  slobs.close();
});
