// A short sound for each new chat message. Off unless a sound is chosen. This file is in the chat overlay, which is held to a strict weight, so it holds only the rule (which sound, how loud,
// how often); the sounds themselves are made by sounds.js, which the overlay loads only if a sound was asked for (see chat-sounds.js).

/**
 * Makes the function the feed calls when a message appears. `get()` gives the settings as they are right now (the editor changes them while it runs), `player()` gives the sound player, or
 * null while it is still loading. A sound plays only if one is chosen, and not sooner than `soundGap` seconds after the last one that played, so a busy chat is not a constant chatter.
 */
export function chatPing(get, player, now = () => performance.now()) {
  let last = -Infinity;
  return () => {
    const { sound, soundVolume, soundGap } = get();
    if (sound === "none") return;
    const t = now();
    if (t - last < soundGap * 1000) return;
    if (player()?.play(sound, { volume: soundVolume })) last = t;
  };
}
