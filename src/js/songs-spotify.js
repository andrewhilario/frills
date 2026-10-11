// Song requests with "what is playing on Spotify": when the overlay has a Spotify code, the song playing is the one Spotify says is playing
// (with its real position), and the chat's requests wait below it. A request that Spotify has reached leaves the waiting list by itself.
// Pure functions and a small layer; the post box reader is given in, so it is tested without a server.

import { same } from "./songs.js";
import { validCode, watchSpotify } from "./spotify-bridge.js";

/** Whether a waiting request is the song Spotify is playing: the same title, or the request's words all found in the song's title and artist. */
export function isPlaying(item, song) {
  if (!song?.title) return false;
  const title = same(song.title);
  if (title && same(item.title) === title) return true;
  const words = same(item.query);
  return words.length > 2 && same(`${song.title} ${song.artist}`).includes(words);
}

/** The view the overlay draws when Spotify is playing: its song first, then the requests that are still waiting. */
export function withSpotify(items, song, { max = 5 } = {}) {
  const waiting = items.filter((i) => !isPlaying(i, song));
  const now = {
    key: "spotify", user: "", name: "Spotify", avatar: "", query: song.title, title: song.title, artist: song.artist, cover: song.cover,
    seconds: Math.round((song.durationMs || 0) / 1000), link: "", trackId: "", state: "ready", spotify: true, paused: !song.playing,
  };
  return { now, next: waiting.slice(0, Math.max(0, max - 1)), total: waiting.length + 1, startedAt: song.startedAt, at: song.at };
}

/**
 * Connects a queue and its drawing to the post box. `apply(settings)` starts (or stops) reading when the code in the settings changes;
 * `render()` draws what there is now. Use it in place of view.render(queue.view).
 */
export function spotifyLayer({ queue, view, watch = watchSpotify }) {
  let song = null;
  let code = "";
  let watcher = null;
  let anchor = { title: "", playing: false, start: 0 };

  /** The start of the song, kept steady between readings: it only moves when the song, play or pause, or the position really changed. */
  const smooth = (reading) => {
    const start = reading.at - reading.progressMs;
    if (reading.title !== anchor.title || reading.playing !== anchor.playing || Math.abs(start - anchor.start) > 3000) anchor = { title: reading.title, playing: reading.playing, start };
    return { ...reading, startedAt: anchor.start };
  };

  const render = () => view.render(song?.title ? withSpotify(queue.items, song, { max: queue.settings.max }) : queue.view);

  return {
    render,
    apply(settings) {
      const next = validCode(settings.spotify);
      if (next !== code) {
        watcher?.stop();
        song = null;
        code = next;
        if (code) {
          watcher = watch(code, (reading) => {
            song = reading ? smooth(reading) : null;
            if (song) for (const item of queue.items.filter((i) => isPlaying(i, song))) queue.remove(item.key); // reached: it is no longer waiting
            render();
          });
        }
      }
      render();
    },
    get playing() { return song; },
  };
}
