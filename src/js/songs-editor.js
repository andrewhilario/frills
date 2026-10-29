// The Song requests editor page.

import { SONGS, SongQueue, makeLookup } from "./songs.js";
import { createSongsView } from "./widgets-view.js";
import { startWidgetEditor } from "./widget-editor.js";
import { fakeLookup, fakeRequest } from "./fake-alerts.js";
import { spotifyLayer } from "./songs-spotify.js";
import { sharedCode } from "./spotify-bridge.js";
import { mountSpotify } from "./spotify-connect.js";

// Adopt the streamer's Spotify code if they enabled sharing on the /spotify/ page
try {
  const params = new URLSearchParams(location.search);
  if (!params.has("spotify")) {
    const sharing = localStorage.getItem("frills:spotify:sharing") === "1";
    const bridge = JSON.parse(localStorage.getItem("frills:spotify:bridge") ?? "null");
    const saved = JSON.parse(localStorage.getItem("frills:songs:v1") ?? "null");
    if (sharing && bridge?.code && !saved?.settings?.spotify) {
      params.set("spotify", bridge.code);
      history.replaceState(null, "", "?" + params.toString());
    }
  }
} catch { /* storage can be blocked */ }

startWidgetEditor({
  widget: SONGS,
  storeKey: "frills:songs:v1",
  overlayPath: "/overlay/songs/",
  events: [],
  needs: "roles",
  idleHint: "Type your TikTok name, or frills_demo to get made-up song requests. The test buttons above work without connecting.",
  create(host, settings, ctx) {
    const view = createSongsView(host);
    const real = makeLookup(); // what chat asks for goes to the real catalog; the test buttons use the practice one
    let layer = null;
    const queue = new SongQueue(settings, { lookup: real, onChange: () => layer?.render() });
    // the Spotify step: log in, let Frills keep the login, share the song playing, add chat's songs to the streamer's Spotify queue, try it with a
    // pretend viewer. Frills' Worker does the Spotify work from then on (the overlay in the streaming app passes chat on), so this page can close.
    const spotify = mountSpotify(document.getElementById("spotify-step"), { hear: (message) => queue.handle(message, ctx.channel()), refresh: ctx.refresh });
    if (location.hash === "#spotify-step") requestAnimationFrame(() => document.getElementById("spotify-step")?.scrollIntoView()); // the step stays hidden until it is mounted, so the browser’s own jump to the address missed it
    spotify.setSettings(settings);
    settings.spotify = sharedCode(); // sharing what is playing is turned on in the Spotify step; its code rides in the link by itself
    layer = spotifyLayer({ queue, view });
    view.apply(settings);
    layer.apply(settings);
    layer.render();
    setInterval(() => { if (!layer.playing) queue.tick(); }, 1000);
    return {
      apply(next) { next.spotify = sharedCode(); view.apply(next); queue.setSettings(next); layer.apply(next); spotify.setSettings(next); },
      onChat: (message) => { queue.handle(message, ctx.channel()); spotify.handle(message); },
      tests: {
        one: () => queue.request({ ...fakeRequest({ avoid: queue.items.map((i) => i.query), busy: queue.items.map((i) => i.name) }), via: fakeLookup }),
        three: () => { for (let i = 0; i < 3; i++) setTimeout(() => queue.request({ ...fakeRequest({ avoid: queue.items.map((item) => item.query), busy: queue.items.map((item) => item.name) }), via: fakeLookup }), i * 350); },
        next: () => queue.next(),
        clear: () => queue.clear(),
      },
    };
  },
});
