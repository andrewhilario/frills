// The two ends of "press Start in the editor, and the timer in my streaming app starts": the timer editor posts a command to the small post box
// (worker/timer.mjs) and the timer overlay reads new commands from it. Only a command name and a number of seconds travel. The fetch, the storage
// and the clock are given in, so both ends are tested without a server.

export const CODE = /^[A-Za-z0-9_-]{16}$/;
const STORE = "frills:timer:bridge";
const BOX = "/api/timer/";

/** A valid code, or "" (a made-up or damaged one is ignored). */
export const validCode = (value) => (typeof value === "string" && CODE.test(value) ? value : "");

const randomId = (length, random = (bytes) => globalThis.crypto.getRandomValues(bytes)) => {
  const bytes = new Uint8Array(length);
  random(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, length);
};

/** The code (goes in the overlay link) and the key (stays in this browser), made once and kept. */
export function timerIdentity(storage = globalThis.localStorage, random) {
  try {
    const saved = JSON.parse(storage.getItem(STORE) ?? "null");
    if (saved && CODE.test(saved.code) && /^[A-Za-z0-9_-]{16,64}$/.test(saved.key)) return saved;
  } catch { /* nothing usable was kept */ }
  const made = { code: randomId(16, random), key: randomId(32, random) };
  try { storage.setItem(STORE, JSON.stringify(made)); } catch { /* storage can be blocked: the code works until the tab closes */ }
  return made;
}

/** The editor's end: sends one command. Resolves with { ok, error? }; never rejects. */
export async function sendCommand({ code, key }, command, { fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
  try {
    const res = await fetchImpl(BOX + code, { method: "POST", headers: { "content-type": "application/json", "x-key": key }, body: JSON.stringify(command) });
    const body = await res.json().catch(() => ({}));
    return res.ok && body.ok ? { ok: true } : { ok: false, error: body.error ?? `status ${res.status}` };
  } catch {
    return { ok: false, error: "offline" };
  }
}

/**
 * The overlay's end. Asks the box now and then for commands after the last one it obeyed, and calls `onCommand({ cmd, value })` for each, once, in order.
 * The first look only learns where the line is, so a page that opens never obeys a command given before it. `seq` can be given (what was kept
 * last time) so a reload does not obey one twice. `onSeq(n)` is told the number to keep. Returns { stop(), poll() }.
 */
export function readCommands({ code, seq = null, onCommand, onSeq = () => {}, everyMs = 2500, fetchImpl = globalThis.fetch?.bind(globalThis), timers = globalThis }) {
  let last = seq;
  let stopped = false;
  let timer = 0;
  async function poll() {
    try {
      const res = await fetchImpl(BOX + code + (last === null ? "" : `?after=${last}`), { cache: "no-store" });
      const body = res.ok ? await res.json() : null;
      if (body?.ok) {
        for (const item of body.items ?? []) {
          if (stopped) return;
          if (item.seq > (last ?? 0)) onCommand({ cmd: item.cmd, value: Number(item.value) || 0 });
        }
        const next = Math.max(last ?? 0, Number(body.seq) || 0, ...(body.items ?? []).map((i) => i.seq));
        if (next !== last) { last = next; onSeq(next); }
      }
    } catch { /* the box did not answer: try again next time */ }
    if (!stopped) timer = timers.setTimeout(poll, everyMs);
  }
  timer = timers.setTimeout(poll, 0);
  return { stop() { stopped = true; timers.clearTimeout(timer); }, poll };
}
