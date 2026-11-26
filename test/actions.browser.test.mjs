// OBS & Stream Actions editor & overlay in headless Chrome against a real local RFC 6455 Mock OBS WebSocket v5 server:
// SHA-256 auth over ws://127.0.0.1 under Frills CSP, OBS scene/source discovery, 1-click Replay Cam creation,
// 10-free action cap enforcement, live !clip & !replay execution, password hash isolation, and live overlay triggers.
// Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createHelper } from "../helper/server.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "actions", "index.html"))) throw new Error("dist/ has no actions page. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

// ── Minimal RFC 6455 Mock OBS WebSocket v5 server (zero dependencies) ─────────────────────────────────────────
function wsEncodeText(text) {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;
  let head;
  if (len < 126) {
    head = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x81; head[1] = 126; head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

function wsDecodeFrames(buf) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buf.length) {
    const fin = (buf[offset] & 0x80) !== 0;
    const opcode = buf[offset] & 0x0f;
    const masked = (buf[offset + 1] & 0x80) !== 0;
    let len = buf[offset + 1] & 0x7f;
    let pos = offset + 2;
    if (len === 126) { if (pos + 2 > buf.length) break; len = buf.readUInt16BE(pos); pos += 2; }
    else if (len === 127) { if (pos + 8 > buf.length) break; len = Number(buf.readBigUInt64BE(pos)); pos += 8; }
    const maskLen = masked ? 4 : 0;
    if (pos + maskLen + len > buf.length) break;
    const mask = masked ? buf.subarray(pos, pos + 4) : null;
    pos += maskLen;
    const data = Buffer.from(buf.subarray(pos, pos + len));
    if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
    frames.push({ fin, opcode, data, text: data.toString("utf8") });
    offset = pos + len;
  }
  return { frames, rest: buf.subarray(offset) };
}

async function startMockObs({ password = "obs-secret-42" } = {}) {
  const calls = [];
  const sockets = new Set();
  const salt = "testSalt==";
  const challenge = "testChallenge==";
  const expectedAuth = createHash("sha256")
    .update(createHash("sha256").update(password + salt).digest("base64") + challenge)
    .digest("base64");
  let replayActive = false;
  let replayCreated = false;

  const server = http.createServer((_req, res) => { res.writeHead(426); res.end(); });
  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    sockets.add(socket);
    socket.on("error", () => {});
    const send = (obj) => { if (!socket.destroyed) socket.write(wsEncodeText(JSON.stringify(obj))); };
    send({ op: 0, d: { obsWebSocketVersion: "5.5.0", rpcVersion: 1, authentication: { challenge, salt } } });

    let pendingBuf = Buffer.alloc(0);
    let fragParts = [];
    socket.on("data", (chunk) => {
      pendingBuf = Buffer.concat([pendingBuf, chunk]);
      const { frames, rest } = wsDecodeFrames(pendingBuf);
      pendingBuf = rest;
      for (const f of frames) {
        if (f.opcode === 8) { socket.end(); return; }
        let fullText = "";
        if (f.opcode === 1) {
          if (f.fin) fullText = f.text;
          else { fragParts = [f.data]; continue; }
        } else if (f.opcode === 0 && fragParts.length) {
          fragParts.push(f.data);
          if (!f.fin) continue;
          fullText = Buffer.concat(fragParts).toString("utf8");
          fragParts = [];
        } else {
          continue;
        }
        let msg;
        try { msg = JSON.parse(fullText); } catch { continue; }
        if (msg.op === 1) {
          if (msg.d?.authentication !== expectedAuth) {
            socket.write(Buffer.from([0x88, 0x02, 0x0f, 0xa9])); // close 4009
            socket.end();
            return;
          }
          send({ op: 2, d: { negotiatedRpcVersion: 1 } });
        } else if (msg.op === 6) {
          const { requestType, requestId, requestData = {} } = msg.d;
          calls.push([requestType, requestData]);
          const ok = (responseData = {}) => send({ op: 7, d: { requestType, requestId, requestStatus: { result: true, code: 100 }, responseData } });
          const fail = (code, comment) => send({ op: 7, d: { requestType, requestId, requestStatus: { result: false, code, comment } } });
          if (requestType === "GetSceneList") ok({ currentProgramSceneName: "Main Scene", scenes: [{ sceneName: "Zoom Cam" }, { sceneName: "Main Scene" }] });
          else if (requestType === "GetCurrentProgramScene") ok({ currentProgramSceneName: "Main Scene" });
          else if (requestType === "GetVideoSettings") ok({ baseWidth: 1920, baseHeight: 1080 });
          else if (requestType === "GetInputList") ok({ inputs: [{ inputName: "Mic/Aux", inputKind: "wasapi_input_capture" }, ...(replayCreated ? [{ inputName: "Frills Replay Cam", inputKind: "ffmpeg_source" }] : [])] });
          else if (requestType === "GetSceneItemList") ok({ sceneItems: [{ sourceName: "Webcam", sceneItemId: 3 }] });
          else if (requestType === "GetHotkeyList") ok({ hotkeys: ["OBSBasic.Screenshot"] });
          else if (requestType === "GetReplayBufferStatus") ok({ outputActive: replayActive });
          else if (requestType === "StartReplayBuffer") { replayActive = true; ok(); }
          else if (requestType === "GetSceneItemId") {
            if (requestData.sourceName === "Frills Replay Cam" && !replayCreated) fail(600, "Not found");
            else ok({ sceneItemId: 9 });
          } else if (requestType === "CreateInput") {
            if (requestData.inputName === "Frills Replay Cam") replayCreated = true;
            ok({ sceneItemId: 9 });
          } else if (requestType === "SaveReplayBuffer") {
            ok();
            setTimeout(() => send({ op: 5, d: { eventType: "ReplayBufferSaved", eventData: { savedReplayPath: "C:/Replays/moment.mp4" } } }), 40);
          } else if (requestType === "SetSceneItemEnabled") {
            ok();
            if (requestData.sceneItemId === 9 && requestData.sceneItemEnabled === true) {
              setTimeout(() => send({ op: 5, d: { eventType: "MediaInputPlaybackEnded", eventData: { inputName: "Frills Replay Cam" } } }), 120);
            }
          } else {
            ok();
          }
        }
      }
    });
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    port,
    calls,
    password,
    close: () => new Promise((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(resolve);
    }),
  };
}

// ── Minimal RFC 6455 Mock VTube Studio Public API v1.0 server ────────────────────────────────────────────────
async function startMockVts() {
  const calls = [];
  const sockets = new Set();
  const issuedToken = "vts-mock-token-abc123";
  const server = http.createServer((_req, res) => { res.writeHead(426); res.end(); });
  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    sockets.add(socket);
    socket.on("error", () => {});
    const send = (obj) => { if (!socket.destroyed) socket.write(wsEncodeText(JSON.stringify(obj))); };
    let pendingBuf = Buffer.alloc(0);
    let fragParts = [];
    socket.on("data", (chunk) => {
      pendingBuf = Buffer.concat([pendingBuf, chunk]);
      const { frames, rest } = wsDecodeFrames(pendingBuf);
      pendingBuf = rest;
      for (const f of frames) {
        if (f.opcode === 8) { socket.end(); return; }
        let fullText = "";
        if (f.opcode === 1) {
          if (f.fin) fullText = f.text;
          else { fragParts = [f.data]; continue; }
        } else if (f.opcode === 0 && fragParts.length) {
          fragParts.push(f.data);
          if (!f.fin) continue;
          fullText = Buffer.concat(fragParts).toString("utf8");
          fragParts = [];
        } else {
          continue;
        }
        let msg;
        try { msg = JSON.parse(fullText); } catch { continue; }
        calls.push([msg.messageType, msg.data ?? {}]);
        const reply = (messageType, data = {}) => send({ apiName: "VTubeStudioPublicAPI", apiVersion: "1.0", requestID: msg.requestID, messageType, data });
        if (msg.messageType === "AuthenticationTokenRequest") reply("AuthenticationTokenResponse", { authenticationToken: issuedToken });
        else if (msg.messageType === "AuthenticationRequest") reply("AuthenticationResponse", { authenticated: msg.data?.authenticationToken === issuedToken });
        else if (msg.messageType === "CurrentModelRequest") reply("CurrentModelResponse", { modelLoaded: true, modelName: "Mochi Live2D", modelID: "m1", modelPosition: { positionX: 0, positionY: 0, rotation: 0, size: 0 } });
        else if (msg.messageType === "HotkeysInCurrentModelRequest") reply("HotkeysInCurrentModelResponse", { availableHotkeys: [{ hotkeyID: "hk-sticky-note", name: "Sticky Note", type: "ToggleItemScene" }] });
        else if (msg.messageType === "ExpressionStateRequest") reply("ExpressionStateResponse", { expressions: [{ name: "Blush", file: "blush.exp3.json", active: false }] });
        else if (msg.messageType === "ItemListRequest") reply("ItemListResponse", { availableItemFiles: [{ fileName: "sticky_note.png" }] });
        else if (msg.messageType === "ArtMeshListRequest") reply("ArtMeshListResponse", { modelLoaded: true, artMeshNames: ["Eye_L", "Face_Skin", "Hair_Front"] });
        else if (msg.messageType === "PermissionRequest") reply("PermissionResponse", { grantSuccess: true, requestedPermission: msg.data?.requestedPermission, permissions: [{ name: "LoadCustomImagesAsItems", granted: true }] });
        else if (msg.messageType === "ItemLoadRequest") reply("ItemLoadResponse", { instanceID: `inst-${calls.length}`, fileName: msg.data?.fileName });
        else if (msg.messageType === "ItemPinRequest") reply("ItemPinResponse", { isPinned: true, itemInstanceID: msg.data?.itemInstanceID });
        else reply(msg.messageType.replace(/Request$/, "Response"), {});
      }
    });
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    calls,
    issuedToken,
    close: () => new Promise((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(resolve);
    }),
  };
}

class FakeConnection extends EventEmitter {
  async connect() { await sleep(5); }
  disconnect() { this.emit("disconnected"); }
}
const opened = [];
async function withHelper() {
  const made = [];
  const helper = createHelper({ distDir: dist, factory: async () => { const c = new FakeConnection(); made.push(c); return c; }, idleStopMs: 200, offlineWaitMs: 5000 });
  const port = await helper.listen(0);
  opened.push(helper);
  return { base: `http://127.0.0.1:${port}`, made };
}
const until = async (check, ms = 6000, label = "") => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await check()) return; await sleep(40); }
  const msg = typeof label === "function" ? label() : label;
  throw new Error(msg ? `Timed out: ${msg}` : "Timed out");
};

let page;
let mockObs;
let mockVts;
before(async () => {
  if (skip) return;
  mockObs = await startMockObs();
  mockVts = await startMockVts();
  page = await launch();
  await page.viewport(1280, 900);
});
after(async () => {
  await page?.close();
  await mockObs?.close();
  await mockVts?.close();
  for (const h of opened) await h.close();
});

const type = (selector, value) => page.evaluate(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const click = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const text = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim() ?? null`);

test("actions editor & overlay load under CSP with no console errors, and Test sticky note previews 5-note FIFO stack without VTS", { skip }, async () => {
  const { base } = await withHelper();
  for (const path of ["/actions/", "/overlay/actions/?demo=1"]) {
    await page.goto(base + path, { settle: 700 });
    assert.deepEqual(page.problems, [], `${path}: ${page.problems.join(" | ")}`);
  }
  await page.goto(base + "/actions/", { settle: 700 });
  for (let i = 0; i < 6; i++) await click('[data-test="sticky"]');
  await until(async () => (await page.evaluate(`document.querySelectorAll(".actions__sticky:not(.actions__sticky--out)").length`)) === 5);
  await sleep(380);
  const stickies = await page.evaluate(`[...document.querySelectorAll(".actions__sticky:not(.actions__sticky--out)")].map((img) => img.src.slice(0, 32))`);
  assert.equal(stickies.length, 5, "free sticky note preview caps at 5 notes and peels off the oldest on #6");
  assert.ok(stickies.every((src) => src.startsWith("data:image/png;base64,iVBORw0KG")), "every preview sticky note renders a real base64 PNG");
  await click('[data-test="clear"]');
  assert.equal(await page.evaluate(`document.querySelectorAll(".actions__sticky").length`), 0, "Clear wipes preview sticky notes");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("actions editor connects to real mock OBS WebSocket v5, creates Replay Cam, enforces 10-free cap, runs !clip & !replay, and keeps password in #hash", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(base + "/actions/", { settle: 700 });
  await page.evaluate(`localStorage.clear()`);
  await page.goto(base + "/actions/", { settle: 700 });

  assert.equal(await text("#act-count"), "2 / 10 free");

  // Connect to live mock OBS WebSocket v5 with SHA-256 auth
  await type("#obs-port", String(mockObs.port));
  await type("#obs-pass", mockObs.password);
  await click("#obs-connect");
  await until(async () => (await text("#obs-status") ?? "").includes("Connected to OBS 5.5.0"));
  assert.equal(await page.evaluate(`document.getElementById("obs-tools").hidden`), false);
  assert.ok((await page.evaluate(`document.querySelectorAll("#obs-scenes-dl option").length`)) >= 2, "OBS scenes populated");

  // 1-click Create Replay Cam calls CreateInput in OBS
  await click("#obs-make-replay");
  await until(async () => (await text("#obs-replay-msg") ?? "").includes("Created “Frills Replay Cam”"));
  assert.ok(mockObs.calls.some(([t, d]) => t === "CreateInput" && d.inputName === "Frills Replay Cam" && d.inputKind === "ffmpeg_source"));

  // Test !clip and !replay live against OBS
  await click('[data-test="clip"]');
  await until(async () => mockObs.calls.some(([t]) => t === "SaveReplayBuffer"));
  await click('[data-test="replay"]');
  await until(async () => mockObs.calls.some(([t, d]) => t === "SetInputSettings" && d.inputSettings?.local_file === "C:/Replays/moment.mp4"));
  await until(async () => mockObs.calls.some(([t, d]) => t === "SetSceneItemEnabled" && d.sceneItemId === 9 && d.sceneItemEnabled === false));

  // Add actions up to 10 free cap -> add buttons disable and free-limit note shows
  for (let i = 0; i < 8; i++) await click("#act-add-blank");
  assert.equal(await text("#act-count"), "10 / 10 free");
  assert.equal(await page.evaluate(`document.getElementById("act-add-blank").disabled`), true);
  assert.equal(await page.evaluate(`document.getElementById("act-limit-note").hidden`), false);

  // Copy link carries port & rules in query, and password ONLY in #hash
  await type("#source-channel", "pond.pal");
  const rawLink = await page.evaluate(`document.getElementById("link").value`);
  const parsed = new URL(rawLink);
  assert.equal(parsed.pathname, "/overlay/actions/");
  assert.equal(parsed.searchParams.get("obsPort"), String(mockObs.port));
  assert.equal(parsed.searchParams.has("obsPass"), false, "password never enters query string");
  assert.equal(new URLSearchParams(parsed.hash.slice(1)).get("obsPass"), mockObs.password);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));

  // Open the generated overlay link against mock TikTok + mock OBS and fire !clip from chat
  const beforeClips = mockObs.calls.filter(([t]) => t === "SaveReplayBuffer").length;
  await page.goto(parsed.href.replace(parsed.origin, base), { settle: 900 });
  await until(() => made.length >= 1);
  await sleep(250);
  // Non-mod viewer is blocked by mods-only !clip
  made[made.length - 1].emit("chat", {
    common: { msgId: "live-clip-blocked" },
    user: { id: "u0", displayId: "random_viewer", nickname: "Random Viewer" },
    comment: "!clip",
  });
  await sleep(150);
  assert.equal(mockObs.calls.filter(([t]) => t === "SaveReplayBuffer").length, beforeClips, "non-mod viewer cannot trigger mods-only !clip");
  // Moderator triggers !clip cleanly
  made[made.length - 1].emit("chat", {
    common: { msgId: "live-clip-1" },
    user: { id: "u1", displayId: "mod_cat", nickname: "Mod Cat" },
    userIdentity: { isModeratorOfAnchor: true },
    comment: "!clip",
  });
  await until(async () => mockObs.calls.filter(([t]) => t === "SaveReplayBuffer").length > beforeClips);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("actions editor connects to mock VTube Studio API, runs free 5-sticky-note cap live, isolates #vtsToken, and gates other VTS actions to Frills Plus", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(base + "/actions/", { settle: 700 });
  await page.evaluate(`localStorage.clear()`);
  await page.goto(base + "/actions/", { settle: 700 });

  await type("#vts-port", String(mockVts.port));
  await click("#vts-connect");
  await until(async () => (await text("#vts-status") ?? "").includes("Model “Mochi Live2D”"));
  assert.ok((await page.evaluate(`document.querySelectorAll("#vts-hotkeys-dl option").length`)) >= 1, "VTS hotkeys discovered");
  assert.ok((await page.evaluate(`document.querySelectorAll("#vts-items-dl option").length`)) >= 1, "VTS items discovered");
  assert.ok((await page.evaluate(`document.querySelectorAll("#vts-meshes-dl option").length`)) >= 1, "VTS ArtMeshes discovered");

  // Disable default OBS rules so this VTS-only setup never attempts to connect to OBS port 4455
  await page.evaluate(`for (const cb of document.querySelectorAll(".act-rule__on")) { if (cb.checked) cb.click(); }`);

  // Add "+ VTS Sticky note" (free up to 5) and "+ VTS Face zoom" (Plus-only live) starter rules
  await page.evaluate(`[...document.querySelectorAll(".act-starter")].find((b) => b.textContent.includes("Sticky note")).click()`);
  // Set cooldown to 0 so test can rapid-fire 6 gifts in browser test
  await page.evaluate(`(() => { const r = [...document.querySelectorAll(".act-rule")].pop(); const cd = r.querySelector('input[type="number"]'); cd.value = "0"; cd.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await page.evaluate(`[...document.querySelectorAll(".act-starter")].find((b) => b.textContent.includes("Face zoom")).click()`);
  // Change Face zoom trigger from Twitch bits to TikTok gift (minDiamonds 100) so one helper tests both on same stream
  await page.evaluate(`(() => { const r = [...document.querySelectorAll(".act-rule")].pop(); const sel = r.querySelector(".act-sub select"); sel.value = "gift"; sel.dispatchEvent(new Event("change", { bubbles: true })); })()`);

  assert.equal(await page.evaluate(`document.getElementById("vts-plus-note").hidden`), false);
  const beforePins = mockVts.calls.filter(([t]) => t === "ItemPinRequest").length;
  await page.evaluate(`[...document.querySelectorAll(".act-rule")][2].querySelector(".act-rule__test").click()`);
  await until(async () => mockVts.calls.filter(([t, d]) => t === "ItemPinRequest" && d.pinInfo?.artMeshID === "Face_Skin").length > beforePins);
  const editorLoad = mockVts.calls.filter(([t, d]) => t === "ItemLoadRequest" && d.customDataBase64).at(-1);
  assert.ok(editorLoad && editorLoad[1].customDataBase64.startsWith("iVBORw0KGgo"), "editor draws real base64 PNG sticky note with viewer name");

  // Selecting a Plus custom sticker shape (chibi paw) renders a distinct valid base64 PNG in editor preview
  await page.evaluate(`(() => { const r = [...document.querySelectorAll(".act-rule")][2]; const shapeSel = [...r.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "paw")); shapeSel.value = "paw"; shapeSel.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  const beforePawPins = mockVts.calls.filter(([t]) => t === "ItemPinRequest").length;
  await page.evaluate(`[...document.querySelectorAll(".act-rule")][2].querySelector(".act-rule__test").click()`);
  await until(async () => mockVts.calls.filter(([t]) => t === "ItemPinRequest").length > beforePawPins);
  const pawLoad = mockVts.calls.filter(([t, d]) => t === "ItemLoadRequest" && d.customDataBase64).at(-1);
  assert.ok(pawLoad && pawLoad[1].customDataBase64.startsWith("iVBORw0KGgo"), "paw sticker renders valid base64 PNG");
  assert.notEqual(pawLoad[1].customDataBase64, editorLoad[1].customDataBase64, "paw sticker image differs from classic pastel note");
  // Switch back to classic note for the live overlay assertions below
  await page.evaluate(`(() => { const r = [...document.querySelectorAll(".act-rule")][2]; const shapeSel = [...r.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "paw")); shapeSel.value = "note"; shapeSel.dispatchEvent(new Event("change", { bubbles: true })); })()`);

  // Copy link carries vtsPort in query, and vtsToken strictly in #hash (never query string)
  await type("#source-channel", "pond.pal");
  const rawLink = await page.evaluate(`document.getElementById("link").value`);
  const parsed = new URL(rawLink);
  assert.equal(parsed.searchParams.get("vtsPort"), String(mockVts.port));
  assert.equal(parsed.searchParams.has("vtsToken"), false);
  assert.equal(new URLSearchParams(parsed.hash.slice(1)).get("vtsToken"), mockVts.issuedToken);

  // Free overlay link (no Plus code): runs 6 live sticky notes (peeling oldest on #6), but BLOCKS Plus-only Face zoom (MoveModelRequest)!
  const authBeforeFree = mockVts.calls.filter(([t]) => t === "AuthenticationRequest").length;
  const pinsBeforeFree = mockVts.calls.filter(([t]) => t === "ItemPinRequest").length;
  const unloadsBeforeFree = mockVts.calls.filter(([t]) => t === "ItemUnloadRequest").length;
  const movesBeforeFree = mockVts.calls.filter(([t]) => t === "MoveModelRequest").length;
  await page.goto(parsed.href.replace(parsed.origin, base), { settle: 800 });
  await until(() => made.length >= 1 && mockVts.calls.filter(([t]) => t === "AuthenticationRequest").length > authBeforeFree);
  await sleep(150);
  for (let i = 1; i <= 6; i++) {
    made[made.length - 1].emit("gift", {
      common: { msgId: `vts-free-gift-${i}` },
      user: { id: `uf${i}`, displayId: `viewer_${i}`, nickname: `Viewer ${i}` },
      gift: { name: "Confetti", type: 2, diamondCount: 100 },
      repeatCount: 1,
    });
  }
  await until(
    async () => mockVts.calls.filter(([t]) => t === "ItemPinRequest").length >= pinsBeforeFree + 6,
    8000,
    () => `pins=${mockVts.calls.filter(([t]) => t === "ItemPinRequest").length - pinsBeforeFree} loads=${mockVts.calls.filter(([t]) => t === "ItemLoadRequest").length} tail=${mockVts.calls.slice(-8).map(([t]) => t).join(",")}`,
  );
  await until(async () => mockVts.calls.filter(([t]) => t === "ItemUnloadRequest").length >= unloadsBeforeFree + 1);
  assert.equal(mockVts.calls.filter(([t]) => t === "MoveModelRequest").length, movesBeforeFree, "free live overlay blocks Plus-only VTS Face zoom");

  // Plus overlay link (with 32-hex Plus code): runs BOTH unlimited sticky notes (no eviction on 6th) AND Plus-only VTS Face zoom!
  const plusHelper = await withHelper();
  const authBeforePlus = mockVts.calls.filter(([t]) => t === "AuthenticationRequest").length;
  const unloadsBeforePlus = mockVts.calls.filter(([t]) => t === "ItemUnloadRequest").length;
  const movesBeforePlus = mockVts.calls.filter(([t]) => t === "MoveModelRequest").length;
  parsed.searchParams.set("code", "a".repeat(32));
  await page.goto(parsed.href.replace(parsed.origin, plusHelper.base), { settle: 900 });
  await until(() => plusHelper.made.length >= 1 && mockVts.calls.filter(([t]) => t === "AuthenticationRequest").length > authBeforePlus);
  await sleep(150);
  plusHelper.made[0].emit("gift", {
    common: { msgId: "vts-gift-plus" },
    user: { id: "u3", displayId: "viewer_b", nickname: "Viewer B" },
    gift: { name: "Confetti", type: 2, diamondCount: 100 },
    repeatCount: 1,
  });
  await until(async () => mockVts.calls.filter(([t]) => t === "MoveModelRequest").length > movesBeforePlus);
  assert.equal(mockVts.calls.filter(([t]) => t === "ItemUnloadRequest").length, unloadsBeforePlus, "Plus overlay does not evict sticky notes");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("Streamlabs Desktop: connect via SockJS Remote Control API, auto-start Replay Buffer, and run automatic !clip in live overlay", { skip }, async () => {
  const rpcCalls = [];
  const token = "slobs-secret-token-99";
  let replayStatus = "offline";
  const sockets = new Set();

  const server = http.createServer((_req, res) => { res.writeHead(426); res.end(); });
  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    sockets.add(socket);
    socket.on("error", () => {});
    const sendRaw = (text) => { if (!socket.destroyed) socket.write(wsEncodeText(text)); };
    const sendRpc = (obj) => sendRaw("a" + JSON.stringify([JSON.stringify(obj)]));
    sendRaw("o");

    let pendingBuf = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      pendingBuf = Buffer.concat([pendingBuf, chunk]);
      const { frames, rest } = wsDecodeFrames(pendingBuf);
      pendingBuf = rest;
      for (const f of frames) {
        if (f.opcode === 8) { socket.end(); return; }
        if (f.opcode !== 1) continue;
        let batch;
        try { batch = JSON.parse(f.text); } catch { continue; }
        for (const item of Array.isArray(batch) ? batch : [batch]) {
          let msg;
          try { msg = typeof item === "string" ? JSON.parse(item) : item; } catch { continue; }
          const { id, method, params } = msg;
          const res = params?.resource;
          const args = params?.args ?? [];
          rpcCalls.push([res, method, args]);
          if (res === "TcpServerService" && method === "auth") {
            sendRpc({ jsonrpc: "2.0", id, result: args[0] === token });
          } else if (res === "ScenesService" && method === "getScenes") {
            sendRpc({ jsonrpc: "2.0", id, result: [{ id: "sc1", name: "Bawowant", nodes: [{ id: "n1", sceneId: "sc1", sceneItemId: "i1", sourceId: "s1", sceneNodeType: "item", name: "Model", visible: true }] }] });
          } else if (res === "ScenesService" && method === "activeScene") {
            sendRpc({ jsonrpc: "2.0", id, result: { id: "sc1", name: "Bawowant" } });
          } else if (res === "AudioService" && method === "getSources") {
            sendRpc({ jsonrpc: "2.0", id, result: [{ sourceId: "mic1", name: "Mic/Aux", muted: false }] });
          } else if (res === "StreamingService" && method === "getModel") {
            sendRpc({ jsonrpc: "2.0", id, result: { streamingStatus: "live", recordingStatus: "offline", replayBufferStatus: replayStatus } });
          } else if (res === "StreamingService" && method === "startReplayBuffer") {
            replayStatus = "running";
            sendRpc({ jsonrpc: "2.0", id, result: null });
          } else if (res === "StreamingService" && method === "saveReplay") {
            sendRpc({ jsonrpc: "2.0", id, result: null });
          } else {
            sendRpc({ jsonrpc: "2.0", id, result: null });
          }
        }
      }
    });
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const slobsPort = server.address().port;

  try {
    const { base, made } = await withHelper();
    await page.viewport(1280, 900);
    await page.goto(base + "/actions/", { settle: 700 });
    await page.evaluate("localStorage.clear()");
    await page.goto(base + "/actions/", { settle: 700 });

    // Switch Streaming app to Streamlabs Desktop, fill port + token, and connect
    await page.evaluate(`(() => { const s = document.getElementById("obs-app"); s.value = "slobs"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    assert.equal(await page.evaluate(`document.getElementById("obs-port").value`), "59650", "defaults to Streamlabs port 59650");
    assert.equal(await page.evaluate(`document.getElementById("obs-replay-sub").hidden`), true, "OBS-only Replay Cam creator hidden on Streamlabs");
    await type("#obs-port", String(slobsPort));
    await type("#obs-pass", token);
    await click("#obs-connect");
    await until(async () => /Connected to Streamlabs Desktop/.test(await page.evaluate(`document.getElementById("obs-status").textContent`)));
    assert.ok(rpcCalls.some(([r, m]) => r === "StreamingService" && m === "startReplayBuffer"), "auto-started Streamlabs Replay Buffer");

    // Generate live overlay link -> obsApp=slobs in query, token strictly in #obsPass hash
    await type("#source-channel", "ainz");
    const rawLink = await page.evaluate(`document.getElementById("link").value`);
    const parsed = new URL(rawLink);
    assert.equal(parsed.searchParams.get("obsApp"), "slobs");
    assert.equal(parsed.searchParams.get("obsPort"), String(slobsPort));
    assert.equal(parsed.searchParams.has("obsPass"), false);
    assert.equal(new URLSearchParams(parsed.hash.slice(1)).get("obsPass"), token);

    // Open overlay in headless Chrome and fire !clip from TikTok chat -> triggers StreamingService.saveReplay automatically!
    const savesBefore = rpcCalls.filter(([r, m]) => r === "StreamingService" && m === "saveReplay").length;
    await page.goto(parsed.href.replace(parsed.origin, base), { settle: 800 });
    await until(() => made.length >= 1 && rpcCalls.filter(([r, m]) => r === "TcpServerService" && m === "auth").length >= 2);
    await sleep(150);
    made[made.length - 1].emit("chat", {
      common: { msgId: "slobs-clip-1" },
      user: { id: "u1", displayId: "mod_pal", nickname: "Mod Pal" },
      content: "!clip",
      userIdentity: { isModeratorOfAnchor: true },
    });
    await until(() => rpcCalls.filter(([r, m]) => r === "StreamingService" && m === "saveReplay").length > savesBefore);
    assert.deepEqual(page.problems, [], page.problems.join(" | "));
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise((r) => server.close(r));
  }
});

test("actions editor has no sideways scrolling or wrapped buttons at 320px and 1280px", { skip }, async () => {
  const { base } = await withHelper();
  for (const width of [320, 1280]) {
    await page.viewport(width, 900);
    await page.goto(base + "/actions/", { settle: 700 });
    const w = await page.evaluate("({ scroll: document.documentElement.scrollWidth, inner: innerWidth })");
    assert.ok(w.scroll <= w.inner, `/actions/ at ${width}px is ${w.scroll}px wide`);
    assert.deepEqual(page.problems, [], `/actions/ at ${width}px: ${page.problems.join(" | ")}`);
  }
});
