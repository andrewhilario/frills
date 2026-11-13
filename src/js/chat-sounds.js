// The message sound for the chat overlay, as a file of its own. The overlay loads it (a script tag) only when the link asks for a sound (&sound=...), so a chat with no sound carries none of
// this. It reads the same settings from the link, then plays the chosen sound as each message appears.

import { fromParams, sanitize } from "./settings.js";
import "./chat-sound-settings.js"; // (adds the sound settings, so sanitize knows them)
import { createSounds } from "./sounds.js";
import { chatPing } from "./chat-sound.js";

const settings = sanitize(fromParams(new URLSearchParams(location.search)));
const sounds = createSounds();
if (globalThis.frillsFeed) globalThis.frillsFeed.onShow = chatPing(() => settings, () => sounds);
