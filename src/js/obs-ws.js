// Minimal browser OBS WebSocket v5 client (zero dependencies): connects to OBS Studio's built-in
// WebSocket server on local loopback (127.0.0.1), handles SHA-256 auth via WebCrypto, sends RPC requests,
// subscribes to ReplayBufferSaved & MediaInputPlaybackEnded events, and discovers scenes/sources/filters/hotkeys.

export const OBS_HOST = "127.0.0.1";
export const OBS_DEFAULT_PORT = 4455;
/** Outputs (1 << 6) | MediaInputs (1 << 8) = ReplayBufferSaved + MediaInputPlaybackEnded. */
export const OBS_EVENTS_MASK = (1 << 6) | (1 << 8);

/** Clamps a user-entered port to 1..65535, falling back to 4455. */
export function cleanObsPort(raw) {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 1 && n <= 65535 ? n : OBS_DEFAULT_PORT;
}

/** Reads local-only credentials (`#obsPass=...&vtsToken=...`) from a URL hash fragment (never query params). */
export function localSecretsFromHash(hash = "") {
  const clean = String(hash ?? "").replace(/^#/, "");
  if (!clean) return { obsPass: "", vtsToken: "" };
  try {
    const sp = new URLSearchParams(clean);
    return { obsPass: sp.get("obsPass") ?? "", vtsToken: sp.get("vtsToken") ?? "" };
  } catch {
    return { obsPass: "", vtsToken: "" };
  }
}

/** Attaches optional `#obsPass=...` / `#vtsToken=...` fragments locally to a Browser Source URL (never sent over HTTP). */
export function withLocalSecretsHash(rawUrl, { obsPass = "", vtsToken = "" } = {}) {
  const base = String(rawUrl ?? "").split("#")[0];
  if (!base) return "";
  const frag = new URLSearchParams();
  if (obsPass) frag.set("obsPass", String(obsPass));
  if (vtsToken) frag.set("vtsToken", String(vtsToken));
  const encoded = frag.toString();
  return encoded ? `${base}#${encoded}` : base;
}

/** Reads an optional OBS WebSocket password from a URL hash fragment (`#obsPass=...`), never query params. */
export function obsPassFromHash(hash = "") {
  return localSecretsFromHash(hash).obsPass;
}

/** Attaches an optional `#obsPass=...` fragment locally to a copied Browser Source URL (never sent over HTTP). */
export function withObsPassHash(rawUrl, password = "") {
  return withLocalSecretsHash(rawUrl, { obsPass: password });
}

function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function sha256Base64(input) {
  const data = new TextEncoder().encode(String(input));
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto is unavailable in this browser context.");
  const digest = await subtle.digest("SHA-256", data);
  return bytesToBase64(new Uint8Array(digest));
}

/** Computes the OBS WebSocket v5 Identify authentication token: base64(SHA256(base64(SHA256(password + salt)) + challenge)). */
export async function obsAuthString(password, salt, challenge) {
  const secret = await sha256Base64(String(password ?? "") + String(salt ?? ""));
  return sha256Base64(secret + String(challenge ?? ""));
}

/**
 * OBS WebSocket v5 client with request/response correlation, one-shot event waiting, auto-discovery,
 * Replay Cam auto-creation, and bounded reconnect backoff.
 */
export class ObsClient {
  constructor({
    port = OBS_DEFAULT_PORT,
    password = "",
    reconnect = true,
    eventSubscriptions = OBS_EVENTS_MASK,
    onStatus = () => {},
    onEvent = () => {},
    WebSocketCtor = globalThis.WebSocket,
  } = {}) {
    this.port = cleanObsPort(port);
    this.password = String(password ?? "");
    this.reconnect = Boolean(reconnect);
    this.eventSubscriptions = eventSubscriptions;
    this.onStatus = onStatus;
    this.onEvent = onEvent;
    this.WebSocketCtor = WebSocketCtor;

    this.ws = null;
    this.state = "disconnected";
    this.version = "";
    this.seq = 0;
    this.pending = new Map();
    this.waiters = new Set();
    this.stopped = false;
    this.retryTimer = 0;
    this.retryAttempt = 0;
    this._connectResolve = null;
    this._connectReject = null;
  }

  get connected() {
    return this.state === "connected" && this.ws?.readyState === 1;
  }

  get url() {
    return `ws://${OBS_HOST}:${this.port}`;
  }

  configure({ port, password } = {}) {
    if (port !== undefined) this.port = cleanObsPort(port);
    if (password !== undefined) this.password = String(password ?? "");
  }

  _setStatus(state, detail = "") {
    this.state = state;
    this.onStatus({ state, detail, version: this.version, port: this.port });
  }

  connect() {
    this.stopped = false;
    clearTimeout(this.retryTimer);
    if (this.ws) {
      try { this.ws.close(1000, "reconnect"); } catch { /* ignore */ }
      this.ws = null;
    }
    if (!this.WebSocketCtor) {
      const err = new Error("WebSocket is unavailable in this environment.");
      this._setStatus("error", err.message);
      return Promise.reject(err);
    }

    this._setStatus("connecting", `Connecting to OBS on port ${this.port}…`);

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

      ws.addEventListener("message", async (ev) => {
        if (this.ws !== ws) return;
        let msg;
        try { msg = JSON.parse(String(ev.data ?? "")); } catch { return; }
        const { op, d } = msg ?? {};

        if (op === 0) {
          // Hello
          this.version = String(d?.obsWebSocketVersion ?? "");
          const identify = { rpcVersion: 1, eventSubscriptions: this.eventSubscriptions };
          if (d?.authentication) {
            if (!this.password) {
              this._setStatus("auth-error", "OBS WebSocket needs your password. Copy it from OBS → Tools → WebSocket Server Settings.");
              try { ws.close(1000, "missing-password"); } catch { /* ignore */ }
              finishConnect(false, new Error("OBS WebSocket password required."));
              return;
            }
            try {
              identify.authentication = await obsAuthString(this.password, d.authentication.salt, d.authentication.challenge);
            } catch (err) {
              this._setStatus("error", err.message);
              try { ws.close(1000, "auth-hash-failed"); } catch { /* ignore */ }
              finishConnect(false, err);
              return;
            }
          }
          if (this.ws !== ws || ws.readyState !== 1) return;
          ws.send(JSON.stringify({ op: 1, d: identify }));
        } else if (op === 2) {
          // Identified
          this.retryAttempt = 0;
          this._setStatus("connected", `Connected to OBS WebSocket ${this.version || "v5"}`);
          finishConnect(true, { version: this.version });
        } else if (op === 7) {
          // RequestResponse
          const entry = this.pending.get(d?.requestId);
          if (!entry) return;
          this.pending.delete(d.requestId);
          clearTimeout(entry.timer);
          if (d?.requestStatus?.result) {
            entry.resolve(d.responseData ?? {});
          } else {
            const comment = d?.requestStatus?.comment || `OBS rejected ${d?.requestType || "request"} (code ${d?.requestStatus?.code ?? "?"})`;
            const err = new Error(comment);
            err.obsCode = d?.requestStatus?.code;
            entry.reject(err);
          }
        } else if (op === 5) {
          // Event
          const type = String(d?.eventType ?? "");
          const data = d?.eventData ?? {};
          for (const w of [...this.waiters]) {
            if (w.eventType === type && w.predicate(data)) {
              this.waiters.delete(w);
              clearTimeout(w.timer);
              w.resolve(data);
            }
          }
          this.onEvent(type, data);
        }
      });

      ws.addEventListener("close", (ev) => {
        if (this.ws !== ws) return;
        this.ws = null;
        this._rejectAll(new Error("OBS connection closed."));
        if (this.stopped) {
          this._setStatus("disconnected", "Disconnected from OBS.");
          finishConnect(false, new Error("Disconnected."));
          return;
        }
        if (ev?.code === 4009) {
          this._setStatus("auth-error", "Wrong OBS WebSocket password. Check OBS → Tools → WebSocket Server Settings.");
          finishConnect(false, new Error("Wrong OBS WebSocket password."));
          return;
        }
        if (this.state !== "auth-error") {
          const detail = this.state === "connecting"
            ? `Could not reach OBS on port ${this.port}. Make sure OBS is open and Tools → WebSocket Server Settings is enabled.`
            : "Lost connection to OBS.";
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

  _rejectAll(err) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(err);
    }
    this.waiters.clear();
  }

  /** Sends an OBS WebSocket v5 request and resolves with `responseData`. */
  call(requestType, requestData = {}, timeoutMs = 8000) {
    if (!this.connected) return Promise.reject(new Error("OBS is not connected."));
    const requestId = `frills-${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`OBS timed out on ${requestType}.`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(err);
      }
    });
  }

  /** Waits for one matching OBS event (`op: 5`) up to `timeoutMs`. */
  waitForEvent(eventType, predicate = () => true, timeoutMs = 15000) {
    if (!this.connected) return Promise.reject(new Error("OBS is not connected."));
    return new Promise((resolve, reject) => {
      const waiter = {
        eventType,
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`Timed out waiting for OBS ${eventType}.`));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  /** Queries OBS for live scenes, sources, audio/media/text inputs, hotkeys, and Replay Buffer status. */
  async discover() {
    const safe = (p, fallback) => p.catch(() => fallback);
    const [sceneData, inputData, hotkeyData, rbData] = await Promise.all([
      safe(this.call("GetSceneList"), { scenes: [], currentProgramSceneName: "" }),
      safe(this.call("GetInputList"), { inputs: [] }),
      safe(this.call("GetHotkeyList"), { hotkeys: [] }),
      this.call("GetReplayBufferStatus")
        .then((r) => ({ supported: true, active: Boolean(r?.outputActive) }))
        .catch(() => ({ supported: false, active: false })),
    ]);

    const scenes = (sceneData.scenes ?? []).map((s) => String(s.sceneName ?? "")).filter(Boolean).reverse();
    const currentScene = String(sceneData.currentProgramSceneName ?? scenes[0] ?? "");
    const inputs = (inputData.inputs ?? []).map((i) => ({
      name: String(i.inputName ?? ""),
      kind: String(i.inputKind ?? ""),
    })).filter((i) => i.name);

    const sourceNames = new Set(inputs.map((i) => i.name));
    if (currentScene) {
      const items = await safe(this.call("GetSceneItemList", { sceneName: currentScene }), { sceneItems: [] });
      for (const item of items.sceneItems ?? []) {
        if (item.sourceName) sourceNames.add(String(item.sourceName));
      }
    }

    const mediaInputs = inputs.filter((i) => /ffmpeg|vlc|media/i.test(i.kind)).map((i) => i.name);
    const textInputs = inputs.filter((i) => /text/i.test(i.kind)).map((i) => i.name);
    const hotkeys = (hotkeyData.hotkeys ?? []).map((h) => String(h ?? "")).filter(Boolean).slice(0, 200);

    return {
      currentScene,
      scenes,
      sources: [...sourceNames].sort((a, b) => a.localeCompare(b)),
      inputs: inputs.map((i) => i.name).sort((a, b) => a.localeCompare(b)),
      mediaInputs,
      textInputs,
      hotkeys,
      replayBufferSupported: rbData.supported,
      replayBufferActive: rbData.active,
    };
  }

  /** Fetches filter names on one source or scene. */
  async getFilters(sourceName) {
    if (!sourceName) return [];
    try {
      const res = await this.call("GetSourceFilterList", { sourceName });
      return (res.filters ?? []).map((f) => String(f.filterName ?? "")).filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Ensures a native OBS Media Source (`ffmpeg_source`) exists in the active scene for instant Replay Cam playback,
   * positioned cleanly as corner Picture-in-Picture (`pip`) or `full`, and hidden until triggered.
   */
  async ensureReplayCam({ sourceName = "Frills Replay Cam", layout = "pip" } = {}) {
    const name = String(sourceName || "Frills Replay Cam").trim().slice(0, 60) || "Frills Replay Cam";
    const { currentProgramSceneName: sceneName } = await this.call("GetCurrentProgramScene");
    if (!sceneName) throw new Error("No active OBS scene found.");

    const video = await this.call("GetVideoSettings").catch(() => ({ baseWidth: 1920, baseHeight: 1080 }));
    const baseW = Math.max(320, Number(video.baseWidth) || 1920);
    const baseH = Math.max(320, Number(video.baseHeight) || 1080);

    let sceneItemId = null;
    try {
      const existing = await this.call("GetSceneItemId", { sceneName, sourceName: name });
      sceneItemId = existing?.sceneItemId ?? null;
    } catch { /* not in this scene yet */ }

    const inputSettings = {
      looping: false,
      restart_on_activate: true,
      close_when_inactive: true,
      hw_decode: true,
      clear_on_media_end: true,
    };

    let created = false;
    if (sceneItemId == null) {
      const allInputs = await this.call("GetInputList").catch(() => ({ inputs: [] }));
      const existsGlobally = (allInputs.inputs ?? []).some((i) => i.inputName === name);
      if (existsGlobally) {
        const added = await this.call("CreateSceneItem", { sceneName, sourceName: name, sceneItemEnabled: false });
        sceneItemId = added?.sceneItemId ?? null;
      } else {
        const res = await this.call("CreateInput", {
          sceneName,
          inputName: name,
          inputKind: "ffmpeg_source",
          inputSettings,
          sceneItemEnabled: false,
        });
        sceneItemId = res?.sceneItemId ?? null;
        created = true;
      }
    }

    if (sceneItemId != null) {
      const isPip = layout !== "full";
      const margin = Math.round(Math.min(baseW, baseH) * 0.035);
      const boxW = isPip ? Math.round(baseW * 0.36) : baseW;
      const boxH = isPip ? Math.round(baseH * 0.36) : baseH;
      const transform = {
        positionX: isPip ? baseW - boxW - margin : 0,
        positionY: isPip ? baseH - boxH - margin : 0,
        boundsType: "OBS_BOUNDS_SCALE_INNER",
        boundsWidth: boxW,
        boundsHeight: boxH,
        boundsAlignment: 0,
      };
      await this.call("SetSceneItemTransform", { sceneName, sceneItemId, sceneItemTransform: transform }).catch(() => {});
      await this.call("SetSceneItemEnabled", { sceneName, sceneItemId, sceneItemEnabled: false }).catch(() => {});
    }

    return { sceneName, sourceName: name, sceneItemId, created };
  }

  close() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this._rejectAll(new Error("OBS client closed."));
    if (this.ws) {
      const sock = this.ws;
      this.ws = null;
      try { sock.close(1000, "closed"); } catch { /* ignore */ }
    }
    this._setStatus("disconnected", "Disconnected from OBS.");
  }
}
