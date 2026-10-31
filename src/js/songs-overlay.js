// The Song requests overlay: what a streaming app opens. A see-through page with the queue of songs viewers asked for in the LIVE chat.
//   /overlay/songs/?channel=yourname&platform=tiktok&command=sr&max=5&keep=1      your account
//   add &demo=1 to see practice requests instead of a real account

import { SONGS, SongQueue, loadSongs, makeLookup, saveSongs } from "./songs.js";
import { createSongsView } from "./widgets-view.js";
import { channelFromParams, connectEvents } from "./widget-overlay.js";
import { fakeLookup, fakeSongSource } from "./fake-alerts.js";
import { spotifyLayer } from "./songs-spotify.js";
import { SpotifyForward } from "./spotify-forward.js";
import { validCode } from "./spotify-bridge.js";
import { fontsReady, generalFaces } from "./look.js";

const params = new URLSearchParams(location.search);
const settings = SONGS.sanitize(SONGS.fromParams(params));
// ?pace=1500 makes the practice (demo) requests come about that many milliseconds apart: handy for trying a look, or for filming it
const demoPace = Number(params.get("pace")) ? Math.min(10000, Math.max(300, Number(params.get("pace")))) : 0; // (no pace, or not a number: the usual speed)

const note = document.getElementById("note");
const say = (text) => { note.hidden = !text; note.textContent = text; };
const channel = channelFromParams(params);
const demo = params.get("demo") === "1";

const view = createSongsView(document.getElementById("songs"));
view.apply(settings);
let saving = 0;
let layer = null; // draws the queue, with what Spotify is playing on top when there is a Spotify code
const queue = new SongQueue(settings, {
  lookup: demo ? fakeLookup : makeLookup(),
  entries: settings.keep && channel && !demo ? loadSongs(globalThis.localStorage, channel) : [],
  onChange: () => {
    layer?.render();
    if (settings.keep && channel && !demo && !saving) saving = setTimeout(() => { saving = 0; saveSongs(globalThis.localStorage, channel, queue); }, 1000);
  },
});
layer = spotifyLayer({ queue, view });
layer.apply(settings);
layer.render();
// With a Spotify code in the link, Frills keeps the streamer's Spotify login: this page, open in the streaming app, passes each !sr and !next on
// (the Worker adds the song to the streamer's Spotify queue, if the streamer switched that on in the editor). The editor's own preview does not.
const forward = !demo && channel && validCode(settings.spotify) ? new SpotifyForward({ code: settings.spotify, channel, settings }) : null;
setInterval(() => { if (!layer.playing) queue.tick(); }, 1000); // with Spotify playing, the song moves on by itself

if (demo) {
  fontsReady(generalFaces(settings), 1000).then(() => {
    fakeSongSource((request) => queue.request(request), demoPace ? () => [demoPace * 0.6, demoPace * 1.4] : undefined);
    // the practice also plays songs through: the first one is done every so often
    setInterval(() => queue.next(), Math.max(6000, (demoPace || 4000) * 3));
  });
} else if (!channel) {
  say("Add ?channel=yourname to this link.");
} else {
  const fonts = fontsReady(generalFaces(settings), 1000); // the connection starts at once; only drawing waits for the font
  connectEvents({ channel, events: [], onChat: (message) => { fonts.then(() => queue.handle(message, channel)); forward?.handle(message); }, say });
}
