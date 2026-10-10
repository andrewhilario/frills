// The alert sounds, made in the browser with the Web Audio API: no files, nothing to host, nothing to download. Each sound is a few
// short notes. A bigger gift (tier 2 or 3) plays the same sound again, higher, so size can be heard.
//
// A browser only lets a page make sound after the person has clicked or pressed something on it. In the editor the test buttons are
// that click. In OBS the page is allowed to play by itself. In other apps we can't tell, so the page asks (`state`) and the editor says.

/** [seconds from the start, frequency in Hz, length in seconds, wave, loudness 0 to 1, optional frequency to slide to] */
const NOTES = {
  chime: [[0, 1318.5, 0.5, "sine", 0.5], [0.11, 1760, 0.8, "sine", 0.45]],
  pop: [[0, 700, 0.14, "sine", 0.6, 180]],
  bell: [[0, 880, 1.2, "sine", 0.4], [0, 1760, 0.9, "sine", 0.18], [0, 2637, 0.6, "sine", 0.1]],
  sparkle: [[0, 1568, 0.2, "triangle", 0.3], [0.07, 1976, 0.2, "triangle", 0.3], [0.14, 2349, 0.2, "triangle", 0.3], [0.21, 2637, 0.2, "triangle", 0.3], [0.28, 3136, 0.5, "triangle", 0.3]],
  levelup: [[0, 523.3, 0.16, "triangle", 0.5], [0.12, 659.3, 0.16, "triangle", 0.5], [0.24, 784, 0.16, "triangle", 0.5], [0.36, 1046.5, 0.6, "triangle", 0.55]],
  coin: [[0, 987.8, 0.09, "square", 0.22], [0.08, 1318.5, 0.5, "square", 0.22]],
  boop: [[0, 330, 0.22, "sine", 0.7, 250]],
  bubble: [[0, 400, 0.12, "sine", 0.55, 900], [0.1, 600, 0.1, "sine", 0.4, 1200]],
  fanfare: [[0, 523.3, 0.18, "square", 0.2], [0.16, 659.3, 0.18, "square", 0.2], [0.32, 784, 0.18, "square", 0.2], [0.48, 1046.5, 0.8, "square", 0.22], [0.48, 784, 0.8, "square", 0.15], [0.48, 659.3, 0.8, "square", 0.15]],
};

/** How each size repeats the sound: [delay in seconds, steps up in semitones]. Tier 1 plays once. */
const LAYERS = { 1: [[0, 0]], 2: [[0, 0], [0.16, 5]], 3: [[0, 0], [0.16, 5], [0.32, 12]] };

export const soundIds = () => Object.keys(NOTES);

/** One sound player. `contextClass` is a parameter so tests can hand it a pretend. */
export function createSounds(contextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext) {
  let ctx = null;
  const make = () => {
    if (!ctx && contextClass) {
      try { ctx = new contextClass(); } catch { ctx = null; }
    }
    return ctx;
  };

  return {
    /** Call from a click or key press. Resolves to true when the page is allowed to make sound. */
    async unlock() {
      const c = make();
      if (!c) return false;
      // resume() can stay pending for ever when the browser has not allowed sound, so it only gets a moment to answer.
      try { if (c.state === "suspended") await Promise.race([c.resume(), new Promise((resolve) => setTimeout(resolve, 300))]); } catch { /* the browser refused */ }
      return c.state === "running";
    },
    /** "running" (will play), "suspended" (the browser is waiting for a click) or "none" (this browser can't). */
    get state() { return ctx ? ctx.state : contextClass ? "suspended" : "none"; },
    /** Plays a sound. `volume` is 0 to 100. Does nothing for "none", an unknown id, silence, or a blocked browser. */
    play(id, { volume = 70, tier = 1 } = {}) {
      const notes = NOTES[id];
      if (!notes || volume <= 0) return false;
      const c = make();
      if (!c) return false;
      if (c.state === "suspended") { try { c.resume(); } catch { /* wait for a click */ } }
      if (c.state !== "running") return false;
      const master = c.createGain();
      master.gain.value = Math.min(1, volume / 100) * 0.8;
      master.connect(c.destination);
      const now = c.currentTime + 0.02;
      for (const [delay, steps] of LAYERS[tier] ?? LAYERS[1]) {
        const ratio = Math.pow(2, steps / 12);
        for (const [at, freq, length, wave, loud, slideTo] of notes) {
          const osc = c.createOscillator();
          const gain = c.createGain();
          const start = now + delay + at;
          osc.type = wave;
          osc.frequency.setValueAtTime(freq * ratio, start);
          if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo * ratio, start + length);
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(loud, start + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
          osc.connect(gain);
          gain.connect(master);
          osc.start(start);
          osc.stop(start + length + 0.05);
        }
      }
      return true;
    },
  };
}
