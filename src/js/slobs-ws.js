// Minimal browser Streamlabs Desktop (SLOBS) Remote Control client (zero dependencies):
// speaks SockJS WebSocket framing + JSON-RPC 2.0 on local loopback (127.0.0.1, default port 59650),
// authenticates via TcpServerService.auth, resolves PROMISE emitters, discovers scenes/sources/audio/replay status,
// and adapts OBS-style action calls (SaveReplayBuffer, StartReplayBuffer, Get/SetCurrentProgramScene,
// Get/SetSceneItemEnabled, Get/SetInputMute) so Frills Actions work seamlessly in Streamlabs Desktop.

export const SLOBS_HOST = "127.0.0.1";
export const SLOBS_DEFAULT_PORT = 59650;

/** Clamps a user-entered Streamlabs port to 1..65535, falling back to 59650. */
export function cleanSlobsPort(raw) {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 1 && n <= 65535 ? n : SLOBS_DEFAULT_PORT;
}

function randomDigits(len = 3) {
  let out = "";
  for (let i = 0; i < len; i++) out += Math.floor(Math.random() * 10);
  return out;
}

function randomSessionId(len = 8) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/**
 * Streamlabs Desktop Remote Control client implementing the same high-level surface as `ObsClient`
 * (`connect`, `close`, `call`, `waitForEvent`, `discover`, `getFilters`, `ensureReplayCam`).
 */
export class SlobsClient {
  constructor({
    port = SLOBS_DEFAULT_PORT,
    token = "",
    password = "",
    reconnect = true,
    onStatus = () => {},
    onEvent = () => {},
    WebSocketCtor = globalThis.WebSocket,
  } = {}) {
    this.kind = "slobs";
    this.port = cleanSlobsPort(port);
    this.token = String(token || password || "").trim();
    this.reconnect = Boolean(reconnect);
    this.onStatus = onStatus;
    this.onEvent = onEvent;
    this.WebSocketCtor = WebSocketCtor;

    this.ws = null;
    this.state = "disconnected";
    this.version = "Streamlabs";
    this.seq = 0;
    this.pending = new Map();
    this.pendingPromises = new Map();
    this.waiters = new Set();
    this.stopped = false;
    this.retryTimer = 0;
    this.retryAttempt = 0;
    this._connectResolve = null;
    this._connectReject = null;
    this._authed = false;
    this._sceneCache = [];
    this._audioCache = [];
  }

  get connected() {
    return this.state === "connected" && this._authed && this.ws?.readyState === 1;
  }

  get url() {
    return `ws://${SLOBS_HOST}:${this.port}/api/${randomDigits(3)}/${randomSessionId(8)}/websocket`;
  }

  configure({ port, token, password } = {}) {
    if (port !== undefined) this.port = cleanSlobsPort(port);
    if (token !== undefined) this.token = String(token ?? "").trim();
    else if (password !== undefined) this.token = String(password ?? "").trim();
  }

  _setStatus(state, detail = "") {
    this.state = state;
    this.onStatus({ state, detail, version: this.version, port: this.port, kind: "slobs" });
  }

  _emitLocalEvent(eventType, data = {}) {
    for (const w of [...this.waiters]) {
      if (w.eventType === eventType && w.predicate(data)) {
        this.waiters.delete(w);
        clearTimeout(w.timer);
        w.resolve(data);
      }
    }
    this.onEvent(eventType, data);
  }

  connect() {
    this.stopped = false;
    clearTimeout(this.retryTimer);
    this._authed = false;
    if (this.ws) {
      try { this.ws.close(1000, "reconnect"); } catch { /* ignore */ }
      this.ws = null;
    }
    if (!this.WebSocketCtor) {
      const err = new Error("WebSocket is unavailable in this environment.");
      this._setStatus("error", err.message);
      return Promise.reject(err);
    }
    if (!this.token) {
      const msg = "Streamlabs Desktop needs your API token. Open Streamlabs → Settings → Mobile (or Remote Control) → click QR code → Show Details → copy API Token.";
      this._setStatus("auth-error", msg);
      return Promise.reject(new Error(msg));
    }

    this._setStatus("connecting", `Connecting to Streamlabs Desktop on port ${this.port}…`);

    return new Promise((resolve, reject) => {
      this._connectResolve = resolve;
      this._connectReject = reject;
      let ws;
      try {
        ws = new this.WebSocketCtor(this.url);
      } catch (err) {
        const msg = err?.message || "Blocked by browser security settings.";
        this._setStatus("error", msg);
        this._connectResolve = null;
        this._connectReject = null;
        reject(new Error(msg));
        return;
      }
      this.ws = ws;

      const finishConnect = (ok, val) => {
        const res = this._connectResolve;
        const rej = this._connectReject;
        this._connectResolve = null;
        this._connectReject = null;
        if (ok) res?.(val);
        else rej?.(val);
      };

      const startAuth = () => {
        if (this.ws !== ws || this._authed) return;
        this.rpc("TcpServerService", "auth", [this.token], 8000, { allowUnauthed: true })
          .then((ok) => {
            if (this.ws !== ws) return;
            if (!ok) {
              const msg = "Wrong Streamlabs API token. Check Settings → Mobile (or Remote Control) → Show Details.";
              this._setStatus("auth-error", msg);
              try { ws.close(1000, "auth-failed"); } catch { /* ignore */ }
              finishConnect(false, new Error(msg));
              return;
            }
            this._authed = true;
            this.retryAttempt = 0;
            this._setStatus("connected", "Connected to Streamlabs Desktop");
            finishConnect(true, { version: this.version });
          })
          .catch((err) => {
            if (this.ws !== ws) return;
            const raw = String(err?.message ?? err ?? "");
            const isAuth = /token|auth|invalid|unauthorized|rejected/i.test(raw);
            const msg = isAuth
              ? "Wrong Streamlabs API token. Check Settings → Mobile (or Remote Control) → Show Details."
              : (raw || "Failed to authenticate with Streamlabs Desktop.");
            this._setStatus(isAuth ? "auth-error" : "error", msg);
            try { ws.close(1000, "auth-error"); } catch { /* ignore */ }
            finishConnect(false, new Error(msg));
          });
      };

      ws.addEventListener("message", (ev) => {
        if (this.ws !== ws) return;
        const raw = String(ev.data ?? "");
        if (!raw) return;
        // SockJS framing: "o" = open, "h" = heartbeat, "a[...]" = message batch, "c[code,reason]" = close
        if (raw === "o") {
          startAuth();
          return;
        }
        if (raw === "h") return;
        if (raw[0] === "c") {
          try { ws.close(1000, "sockjs-close"); } catch { /* ignore */ }
          return;
        }
        if (raw[0] === "a") {
          let batch;
          try { batch = JSON.parse(raw.slice(1)); } catch { return; }
          if (!Array.isArray(batch)) return;
          for (const item of batch) {
            let msg;
            try { msg = typeof item === "string" ? JSON.parse(item) : item; } catch { continue; }
            this._handleRpc(msg);
          }
          return;
        }
        // Fallback if a raw JSON-RPC frame is received directly
        try { this._handleRpc(JSON.parse(raw)); } catch { /* ignore */ }
      });

      ws.addEventListener("close", () => {
        if (this.ws !== ws) return;
        this.ws = null;
        this._authed = false;
        this._rejectAll(new Error("Streamlabs Desktop connection closed."));
        if (this.stopped) {
          this._setStatus("disconnected", "Disconnected from Streamlabs Desktop.");
          finishConnect(false, new Error("Disconnected."));
          return;
        }
        if (this.state !== "auth-error") {
          const detail = this.state === "connecting"
            ? `Could not reach Streamlabs Desktop on port ${this.port}. Make sure Streamlabs Desktop is open and check Settings → Mobile (or Remote Control) → Show Details.`
            : "Lost connection to Streamlabs Desktop.";
          this._setStatus("error", detail);
          finishConnect(false, new Error(detail));
        }
        if (this.reconnect && this.state !== "auth-error") {
          const delay = Math.min(15000, [2000, 4000, 8000, 15000][Math.min(this.retryAttempt, 3)]);
          this.retryAttempt += 1;
          this.retryTimer = setTimeout(() => { if (!this.stopped) this.connect().catch(() => {}); }, delay);
        }
      });

      ws.addEventListener("error", () => {
        // Close event follows and handles status & retry cleanly.
      });
    });
  }

  _handleRpc(msg) {
    if (!msg || typeof msg !== "object") return;
    if (typeof msg.id === "number") {
      const entry = this.pending.get(msg.id);
      if (entry) {
        this.pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.error) {
          entry.reject(new Error(msg.error.message || `Streamlabs rejected ${entry.desc}`));
          return;
        }
        const res = msg.result;
        if (res && typeof res === "object" && res._type === "SUBSCRIPTION" && res.emitter === "PROMISE" && res.resourceId) {
          entry.timer = setTimeout(() => {
            this.pendingPromises.delete(res.resourceId);
            entry.reject(new Error(`Streamlabs timed out on ${entry.desc}.`));
          }, 15000);
          this.pendingPromises.set(res.resourceId, entry);
          return;
        }
        entry.resolve(res);
        return;
      }
    }
    const res = msg.result;
    if (res && typeof res === "object" && res._type === "EVENT" && res.emitter === "PROMISE" && res.resourceId) {
      const entry = this.pendingPromises.get(res.resourceId);
      if (!entry) return;
      this.pendingPromises.delete(res.resourceId);
      clearTimeout(entry.timer);
      if (res.isRejected) {
        const detail = typeof res.data === "string" ? res.data : (res.data ? JSON.stringify(res.data) : "");
        entry.reject(new Error(detail || `${entry.desc} failed in Streamlabs Desktop.`));
      } else {
        entry.resolve(res.data);
      }
    }
  }

  _rejectAll(err) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
    for (const entry of this.pendingPromises.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pendingPromises.clear();
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(err);
    }
    this.waiters.clear();
  }

  /** Sends one raw Streamlabs Desktop JSON-RPC 2.0 call over SockJS WebSocket framing. */
  rpc(resource, method, args = [], timeoutMs = 8000, { allowUnauthed = false } = {}) {
    if (!this.ws || this.ws.readyState !== 1 || (!allowUnauthed && !this._authed)) {
      return Promise.reject(new Error("Streamlabs Desktop is not connected."));
    }
    const id = ++this.seq;
    const desc = `${resource}.${method}`;
    const payload = { jsonrpc: "2.0", id, method, params: { resource, args } };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Streamlabs Desktop timed out on ${desc}.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, desc });
      try {
        // SockJS WebSocket client frame: JSON array containing the JSON-RPC string
        this.ws.send(JSON.stringify([JSON.stringify(payload)]));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  async _getScenes(force = false) {
    if (!force && this._sceneCache.length) return this._sceneCache;
    const list = await this.rpc("ScenesService", "getScenes");
    this._sceneCache = Array.isArray(list) ? list : [];
    return this._sceneCache;
  }

  async _findScene(sceneName) {
    const scenes = await this._getScenes(true);
    const target = String(sceneName ?? "").trim();
    const exact = scenes.find((s) => s.name === target);
    if (exact) return exact;
    const lower = target.toLowerCase();
    return scenes.find((s) => String(s.name ?? "").toLowerCase() === lower) ?? null;
  }

  async _findSceneItems(sceneName, sourceName) {
    const scene = sceneName ? await this._findScene(sceneName) : await this.rpc("ScenesService", "activeScene");
    if (!scene) throw new Error(sceneName ? `Scene “${sceneName}” not found in Streamlabs Desktop.` : "No active scene in Streamlabs Desktop.");
    const full = Array.isArray(scene.nodes) ? scene : (await this._findScene(scene.name)) ?? scene;
    const nodes = Array.isArray(full.nodes) ? full.nodes : [];
    const target = String(sourceName ?? "").trim();
    const lower = target.toLowerCase();
    const matches = nodes.filter((n) => n?.sceneNodeType === "item" && (n.name === target || String(n.name ?? "").toLowerCase() === lower));
    if (!matches.length) throw new Error(`Source “${target}” was not found in scene “${full.name}”.`);
    return { scene: full, matches };
  }

  async _findAudioSource(inputName) {
    const sources = await this.rpc("AudioService", "getSources");
    this._audioCache = Array.isArray(sources) ? sources : [];
    const target = String(inputName ?? "").trim();
    const lower = target.toLowerCase();
    const found = this._audioCache.find((s) => s.name === target)
      ?? this._audioCache.find((s) => String(s.name ?? "").toLowerCase() === lower);
    if (!found) throw new Error(`Audio source “${target}” was not found in Streamlabs Desktop.`);
    return found;
  }

  /**
   * Adapts Frills' OBS-style action requests onto Streamlabs Desktop JSON-RPC services so
   * `!clip`, auto-start Replay Buffer, scene switching, source show/hide, and audio mute work natively.
   */
  async call(requestType, requestData = {}) {
    if (!this.connected) throw new Error("Streamlabs Desktop is not connected.");

    if (requestType === "GetReplayBufferStatus") {
      const model = await this.rpc("StreamingService", "getModel");
      const status = String(model?.replayBufferStatus ?? "offline").toLowerCase();
      return { outputActive: status === "running" || status === "saving", status };
    }

    if (requestType === "StartReplayBuffer") {
      await this.rpc("StreamingService", "startReplayBuffer");
      return {};
    }

    if (requestType === "SaveReplayBuffer") {
      const model = await this.rpc("StreamingService", "getModel").catch(() => null);
      const status = String(model?.replayBufferStatus ?? "").toLowerCase();
      if (status && status !== "running" && status !== "saving") {
        throw new Error("Replay Buffer is off in Streamlabs Desktop. Click the Replay Buffer icon next to REC (or enable Auto-start Replay Buffer).");
      }
      await this.rpc("StreamingService", "saveReplay");
      this._emitLocalEvent("ReplayBufferSaved", { savedReplayPath: "" });
      return {};
    }

    if (requestType === "GetCurrentProgramScene") {
      const active = await this.rpc("ScenesService", "activeScene");
      return { currentProgramSceneName: String(active?.name ?? "") };
    }

    if (requestType === "SetCurrentProgramScene") {
      const scene = await this._findScene(requestData.sceneName);
      if (!scene) throw new Error(`Scene “${requestData.sceneName}” was not found in Streamlabs Desktop.`);
      await this.rpc("ScenesService", "makeSceneActive", [scene.id]);
      return {};
    }

    if (requestType === "GetSceneList") {
      const [scenes, active] = await Promise.all([
        this._getScenes(true),
        this.rpc("ScenesService", "activeScene").catch(() => null),
      ]);
      return {
        currentProgramSceneName: String(active?.name ?? scenes[0]?.name ?? ""),
        scenes: scenes.map((s) => ({ sceneName: String(s.name ?? "") })).filter((s) => s.sceneName),
      };
    }

    if (requestType === "GetSceneItemId") {
      const { scene, matches } = await this._findSceneItems(requestData.sceneName, requestData.sourceName);
      const primary = matches[0];
      return {
        sceneName: scene.name,
        sceneItemId: JSON.stringify({
          sceneId: scene.id,
          sourceName: primary.name,
          items: matches.map((m) => ({
            sceneId: m.sceneId || scene.id,
            sceneItemId: m.sceneItemId || m.id,
            sourceId: m.sourceId,
            visible: Boolean(m.visible),
          })),
        }),
      };
    }

    if (requestType === "GetSceneItemEnabled") {
      let parsed = null;
      try { parsed = JSON.parse(String(requestData.sceneItemId ?? "")); } catch { /* ignore */ }
      if (parsed?.sourceName) {
        const { matches } = await this._findSceneItems(requestData.sceneName, parsed.sourceName);
        return { sceneItemEnabled: Boolean(matches[0]?.visible) };
      }
      return { sceneItemEnabled: false };
    }

    if (requestType === "SetSceneItemEnabled") {
      let parsed = null;
      try { parsed = JSON.parse(String(requestData.sceneItemId ?? "")); } catch { /* ignore */ }
      const items = parsed?.items ?? [];
      if (!items.length) throw new Error("Could not locate source item in Streamlabs Desktop.");
      const visible = Boolean(requestData.sceneItemEnabled);
      for (const it of items) {
        const resource = `SceneItem${JSON.stringify([it.sceneId, it.sceneItemId, it.sourceId])}`;
        await this.rpc(resource, "setVisibility", [visible]);
      }
      return {};
    }

    if (requestType === "GetInputMute") {
      const src = await this._findAudioSource(requestData.inputName);
      return { inputMuted: Boolean(src.muted) };
    }

    if (requestType === "SetInputMute") {
      const src = await this._findAudioSource(requestData.inputName);
      const muted = Boolean(requestData.inputMuted);
      try {
        await this.rpc(`AudioSource${JSON.stringify([src.sourceId])}`, "setMuted", [muted]);
      } catch {
        await this.rpc("SourcesService", "setMuted", [src.sourceId, muted]);
      }
      return {};
    }

    throw new Error(`“${requestType}” needs OBS Studio. Streamlabs Desktop supports !clip (Save Replay), scene switches, show/hide source, and audio mute.`);
  }

  waitForEvent(eventType, predicate = () => true, timeoutMs = 15000) {
    if (!this.connected) return Promise.reject(new Error("Streamlabs Desktop is not connected."));
    return new Promise((resolve, reject) => {
      const waiter = {
        eventType,
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`Timed out waiting for Streamlabs ${eventType}.`));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  /** Queries Streamlabs Desktop for live scenes, sources, audio inputs, and Replay Buffer status. */
  async discover() {
    const safe = (p, fallback) => p.catch(() => fallback);
    const [scenes, active, audioSources, streamModel] = await Promise.all([
      safe(this._getScenes(true), []),
      safe(this.rpc("ScenesService", "activeScene"), null),
      safe(this.rpc("AudioService", "getSources"), []),
      safe(this.rpc("StreamingService", "getModel"), null),
    ]);

    const sceneNames = scenes.map((s) => String(s?.name ?? "")).filter(Boolean);
    const currentScene = String(active?.name ?? sceneNames[0] ?? "");
    const sourceNames = new Set();
    for (const s of scenes) {
      for (const node of s?.nodes ?? []) {
        if (node?.sceneNodeType === "item" && node.name) sourceNames.add(String(node.name));
      }
    }
    const audioList = Array.isArray(audioSources) ? audioSources : [];
    const inputNames = audioList.map((a) => String(a?.name ?? "")).filter(Boolean);
    for (const n of inputNames) sourceNames.add(n);

    const rbStatus = String(streamModel?.replayBufferStatus ?? "offline").toLowerCase();
    return {
      currentScene,
      scenes: sceneNames,
      sources: [...sourceNames].sort((a, b) => a.localeCompare(b)),
      inputs: [...new Set(inputNames)].sort((a, b) => a.localeCompare(b)),
      mediaInputs: [],
      textInputs: [],
      hotkeys: [],
      replayBufferSupported: Boolean(streamModel && "replayBufferStatus" in streamModel),
      replayBufferActive: rbStatus === "running" || rbStatus === "saving",
    };
  }

  async getFilters() {
    return [];
  }

  async ensureReplayCam() {
    throw new Error("1-click Replay Cam creation is OBS Studio only. In Streamlabs Desktop, !clip saves clips directly to your Replay folder.");
  }

  close() {
    this.stopped = true;
    this._authed = false;
    clearTimeout(this.retryTimer);
    this._rejectAll(new Error("Streamlabs Desktop client closed."));
    if (this.ws) {
      const sock = this.ws;
      this.ws = null;
      try { sock.close(1000, "closed"); } catch { /* ignore */ }
    }
    this._setStatus("disconnected", "Disconnected from Streamlabs Desktop.");
  }
}
