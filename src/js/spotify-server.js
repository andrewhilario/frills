// The browser's side of "Frills keeps my Spotify login" (the Worker is worker/spotify.mjs). The Frills page logs in to Spotify as it always did,
// then hands the login over once; from then on the Worker asks Spotify, and this page only changes the switches, reads what happened and
// disconnects. The code (in the overlay link) and the key (kept only in this browser) are the same two that the post box uses (spotify-bridge.js).
// The fetch is given in, so this is tested without a server.

const BASE = "/api/spotify/";

/** What the Worker said, in words a streamer can act on, when it did not say it in words itself. */
export function explain(status, error = "") {
  if (status === 0) return "Could not reach Frills. Check your connection and try again.";
  if (status === 503) return "Frills cannot keep Spotify logins on this site yet, so the Spotify player needs this page open for now.";
  if (status === 403 && error === "wrong_origin") return "Frills did not accept that from this address.";
  if (status === 403) return "This browser is not the one that connected Spotify, so Frills would not change it. Disconnect from the browser you connected in, or ask us.";
  if (status === 429) return "Too fast. Try again in a moment.";
  if (status === 507) return "Frills cannot keep any more Spotify logins right now. Tell us on the feedback page.";
  return `Frills answered with an error (${status}).`;
}

export class SpotifyServer {
  constructor({ code, key, fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
    this.code = code;
    this.key = key;
    this.fetch = fetchImpl;
  }

  /** One call. Returns what the Worker said, with `status`, `ok` (the call worked) and, when it did not, `message` in plain words. */
  async call(method, action, body) {
    let res;
    try {
      res = await this.fetch(`${BASE}${this.code}/${action}`, { method, headers: { "x-key": this.key, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      return { status: 0, ok: false, error: "network", message: explain(0) };
    }
    const data = await res.json().catch(() => ({}));
    const ok = res.ok && data.ok !== false;
    return { ...data, status: res.status, ok, ...(ok ? {} : { message: data.message || explain(res.status, data.error) }) };
  }

  /** { connected: false } | { connected: true, state: "ok" | "expired", name, share, queue, log: [{ at, state, text }] } */
  status() { return this.call("GET", "status"); }

  /** Hands the login over: { clientId, refresh, access, expires }. The Worker proves it with Spotify before it says yes. */
  keep(login) { return this.call("POST", "login", login); }

  /** Changes the switches: { share?, queue? }. */
  settings(change) { return this.call("PUT", "settings", change); }

  /** Deletes the login Frills keeps, and the song it was showing. */
  disconnect() { return this.call("DELETE", "login"); }

  /** The "try it" box: a pretend viewer's !sr (practice only while the queue switch is off). */
  request({ query, name }) { return this.call("POST", "request", { query, name, test: true }); }

  /** The "try it" box: !next, as the streamer. */
  next({ name }) { return this.call("POST", "next", { name, test: true }); }
}
