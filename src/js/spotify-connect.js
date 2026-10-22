// The "Connect Spotify" step of the Song requests editor: log in with Spotify, show the song that is playing on the stream, let chat's !sr
// songs go into the streamer's own Spotify queue, and try it with a pretend viewer. It is the friendly home of what the private /spotify/ test
// page does in a technical way; both use the same login and the same post box. The login stays in this browser only; only the song's title,
// artist, cover and position are passed on (see spotify-bridge.js).

import { REDIRECT_PATH, SpotifyClient } from "./spotify.js";
import { SpotifyRequests } from "./spotify-requests.js";
import { Publisher, bridgeIdentity, rememberReturn, startClock } from "./spotify-bridge.js";
import { buildControl } from "./ui.js";
import { onScreenWords } from "./songs.js";

export const SHARING = "frills:spotify:sharing"; // "1" while the song playing is shared with the overlay
export const QUEUE = "frills:spotify:queue"; // "1" while viewers' !sr songs are added to the streamer's Spotify queue
const get = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const put = (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage can be blocked; the choice lasts until the page closes */ } };

// A Spotify cover is drawn only from Spotify's own picture server.
const safeCover = (address) => (/^https:\/\/i\.scdn\.co\//.test(address) ? address : "");

/**
 * Sets up the step inside `root` (the section, with the ids spx-*). `hear(message)` gives a chat message to the on-screen queue and returns what it
 * did; `refresh()` makes the editor rebuild its link; `channel()` is the streamer's TikTok name. Returns { handle(message), setSettings(settings), loggedIn }.
 */
export function mountSpotify(root, { hear, refresh = () => {}, channel = () => "" } = {}) {
  const none = { handle() {}, setSettings() {}, loggedIn: () => false };
  const clientId = root?.dataset.client || "";
  if (!root || !clientId) return none; // no Spotify app on this site: the step stays hidden
  root.hidden = false;
  const $ = (id) => document.getElementById("spx-" + id);
  const client = new SpotifyClient({ clientId, redirectUri: location.origin + REDIRECT_PATH });
  const identity = bridgeIdentity();
  const say = (el, text, bad = false) => { el.textContent = text; el.dataset.state = bad ? "error" : ""; };

  let sharing = get(SHARING) === "1";
  let queueOn = get(QUEUE) === "1";
  let ticker = null;
  let busy = false;

  // ── what Spotify says is playing, passed to the overlay ────────────────────────────────────────────────────────────────
  const publisher = new Publisher({
    code: identity.code,
    key: identity.key,
    onError: (status) => say($("share-note"), status === 0 ? "Could not reach Frills to share the song. It will try again." : `Frills could not take the song (error ${status}). It will try again.`, true),
  });
  const publish = (now) => {
    if (!sharing || now.error) return;
    publisher.send(now.title ? { playing: now.playing, title: now.title, artist: now.artist, cover: now.cover, progressMs: now.progressMs, durationMs: now.durationMs } : { playing: false, title: "", artist: "", cover: "", progressMs: 0, durationMs: 0 });
  };

  async function readNow() {
    if (busy) return;
    busy = true;
    try {
      const now = await client.nowPlaying();
      publish(now);
      const cover = $("cover");
      if (now.error) { say($("now-note"), now.error, true); return; }
      say($("now-note"), "");
      const art = safeCover(now.cover ?? "");
      if (art) { cover.src = art; cover.hidden = false; } else cover.hidden = true;
      if (!now.title) {
        $("title").textContent = "Nothing is playing";
        $("artist").textContent = "Start a song in Spotify and it shows up here within a few seconds.";
      } else {
        $("title").textContent = now.title;
        $("artist").textContent = now.artist + (now.playing ? "" : " (paused)");
      }
    } finally {
      busy = false;
    }
  }

  // ── the two switches ───────────────────────────────────────────────────────────────────────────────────────────────────
  const shareNote = (on) => say($("share-note"), on ? "Sharing. The song playing shows on your stream, as long as this page stays open." : "Not sharing. Your stream shows only the songs viewers ask for.");
  const share = buildControl({ key: "spShare", type: "toggle", label: "Show what is playing on my stream" }, sharing, (on) => {
    sharing = on;
    put(SHARING, on ? "1" : "0");
    shareNote(on);
    publisher.sent = null; // send the song that is playing right away
    refresh(); // the link carries the code only while this is on
    if (on) readNow();
  });
  const queue = buildControl({ key: "spQueue", type: "toggle", label: "Add songs my viewers ask for to my Spotify queue" }, queueOn, (on) => {
    queueOn = on;
    requests.real = on;
    put(QUEUE, on ? "1" : "0");
    say($("queue-note"), on ? "On. A viewer's !sr song goes to the end of your Spotify queue. This needs Spotify Premium and Spotify open on a device." : "Off. Songs viewers ask for only go to the list on your stream.");
  });
  share.row.append($("share-note")); // each switch says what it did right under itself
  queue.row.append($("queue-note"));
  $("switches").append(share.row, queue.row);

  // ── trying it with a pretend viewer ────────────────────────────────────────────────────────────────────────────────────
  const log = $("log");
  const line = (state, text) => {
    const li = document.createElement("li");
    li.dataset.state = state;
    li.textContent = text;
    log.prepend(li);
    while (log.children.length > 20) log.lastElementChild.remove();
  };
  const requests = new SpotifyRequests(client, { channel: channel(), real: queueOn, onLog: ({ state, text }) => line(state, text) });
  const nameBox = buildControl({ key: "spName", type: "text", label: "Viewer name", max: 30 }, "Pretend viewer", () => {}, { id: "spx-try-name" });
  const textBox = buildControl({ key: "spText", type: "text", label: "What the viewer types", max: 120, hint: "For example !sr levitating dua lipa. Type !next to skip, as yourself." }, "", () => {}, { id: "spx-try-text" });
  $("viewer-fields").append(nameBox.row, textBox.row);
  $("try").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = $("try-text").value.trim();
    if (!text) return;
    const name = $("try-name").value.trim() || "Pretend viewer";
    const skipping = ["!next", "!skip"].some((word) => text.toLowerCase().startsWith(word));
    const message = { id: "", user: "try-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, text, mod: false, host: skipping };
    const words = onScreenWords(hear(message));
    if (words) line("info", words);
    handle(message, { practice: true });
    $("try-text").value = "";
  });

  // ── a chat message: the song goes to the streamer's Spotify queue when that is on (a pretend viewer is tried even when it is off) ─────────
  function handle(message, { practice = false } = {}) {
    if (!client.loggedIn || !(queueOn || practice)) return null;
    requests.channel = channel();
    return requests.handle({ ...message, login: message.login ?? "" });
  }

  // ── logging in and out ─────────────────────────────────────────────────────────────────────────────────────────────────
  async function show() {
    const on = client.loggedIn;
    $("login").hidden = on;
    $("logout").hidden = !on;
    $("on").hidden = !on;
    ticker?.stop();
    ticker = null;
    if (!on) { say($("status"), "Not connected. Spotify asks you to say yes on its own page, and Frills never sees your password."); return; }
    say($("status"), "Connected to Spotify.");
    const me = await client.me();
    if (me.error) say($("status"), me.error, true); else say($("status"), `Connected to Spotify as ${me.name || "your account"}.`);
    shareNote(sharing);
    say($("queue-note"), queueOn ? "On. A viewer's !sr song goes to the end of your Spotify queue. This needs Spotify Premium and Spotify open on a device." : "Off. Songs viewers ask for only go to the list on your stream.");
    await readNow();
    ticker = startClock(root.dataset.ticker, readNow, 3000);
  }

  $("login").addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    rememberReturn("/songs/"); // the callback page brings the person back here
    location.assign(await client.begin());
  });
  $("logout").addEventListener("click", () => {
    client.logout();
    sharing = false;
    put(SHARING, "0");
    share.write(false);
    refresh();
    show();
  });

  // first time connected from here: sharing starts on (the person pressed Log in on the page whose job is showing the song), with the switch to turn it off
  if (client.loggedIn && get(SHARING) === null) { sharing = true; put(SHARING, "1"); share.write(true); refresh(); }
  show();

  return { handle, setSettings(settings) { requests.settings = settings; }, loggedIn: () => client.loggedIn };
}
