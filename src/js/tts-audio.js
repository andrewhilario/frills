// Audio playback, multi-voice browser persona matching, and real-time speech level metering for Talking Pet TTS.
// Calls same-origin GET /api/pro/status + POST /api/tts for AI voices, and speechSynthesis for unlimited free playback.

const PITCH_BY_VOICE = {
  nova: 1.08,
  shimmer: 1.22,
  alloy: 1.0,
  fable: 1.04,
  echo: 0.9,
  onyx: 0.78,
};

const VOICE_ORDER = ["nova", "shimmer", "alloy", "echo", "onyx", "fable"];
const FEMALE_RE = /\b(aria|jenny|ava|emma|michelle|ana|zira|hazel|sonia|libby|samantha|victoria|karen|susan|natasha|female)\b/i;
const MALE_RE = /\b(guy|andrew|brian|christopher|eric|ryan|george|david|mark|alex|daniel|william|liam|male)\b/i;

/** Ranks browser voices so Microsoft Online (Natural) / Google voices come first, then spreads presets across all distinct voices. */
export function pickBrowserVoice(voices, { voice = "nova", browserVoice = "" } = {}) {
  if (!Array.isArray(voices) || !voices.length) return null;
  const usable = voices.filter((v) => v?.name && !/compact/i.test(v.name));
  const pool = usable.length ? usable : voices;

  const filter = String(browserVoice ?? "").trim().toLowerCase();
  if (filter) {
    const exact = pool.find((v) => v.name.toLowerCase().includes(filter));
    if (exact) return exact;
  }

  const score = (v) =>
    (/natural|online/i.test(v.name) ? 4 : /google|microsoft|apple/i.test(v.name) ? 2 : 0) +
    (/en[-_]/i.test(v.lang) ? 2 : 0);
  const en = pool
    .filter((v) => /^en\b/i.test(v.lang))
    .sort((a, b) => score(b) - score(a));
  const ranked = en.length ? en : pool;

  if (voice === "fable") {
    const uk = ranked.find((v) => /^en[-_]GB/i.test(v.lang));
    if (uk) return uk;
  }
  const wantMale = voice === "echo" || voice === "onyx";
  const gendered = ranked.filter((v) => (wantMale ? MALE_RE : FEMALE_RE).test(v.name));
  const idx = Math.max(0, VOICE_ORDER.indexOf(voice));
  const genderedIdx = wantMale ? (voice === "onyx" ? 1 : 0) : idx;
  if (gendered.length > genderedIdx) return gendered[genderedIdx];
  return ranked[idx % ranked.length] ?? gendered[0] ?? null;
}

const SAMPLE_TEXT = {
  nova: "Ribbit! Thanks so much for the gift, Pond Pal — this stream is super cozy!",
  shimmer: "Yay! Welcome in chat! Send a gift anytime and watch me hop along!",
  alloy: "Hello stream! Your custom Talking Pet is ready for Twitch and TikTok alerts.",
  echo: "Chill vibes tonight. Drop a cheer or say hello anytime with the chat command.",
  onyx: "Boom! Five hundred bits from a legend — appreciate the huge hype tonight!",
  fable: "Splendid stream, everyone! Ask me a question or drop a sub to say hello!",
};

/** Creates a cancellable speech player emitting smoothed 0..1 level updates, quota telemetry, and notice codes. */
export function createTtsPlayer({ onLevel = () => {}, onNotice = () => {}, onUsage = () => {}, onTextUpdate = () => {}, getSimCountry = () => "" } = {}) {
  let ctx = null;
  let activeSource = null;
  let activeAudio = null;
  let rafId = 0;
  let abortCtl = null;
  let cadenceTimer = 0;
  let settleTimer = 0;
  let cancelled = false;
  let statusCache = null;
  let statusKey = "";

  const fetchProStatus = async (settings, force = false) => {
    const sim = String(getSimCountry() || "").trim().toUpperCase();
    const code = String(settings.code || "").trim(); // a Frills Plus overlay link
    const key = `${sim}|${code}`;
    if (!force && statusCache && statusKey === key) return statusCache;

    const headers = {};
    if (sim) headers["x-frills-country"] = sim;
    if (code) headers["x-overlay"] = code;
    const data = await fetch("/api/pro/status", { headers })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (data) {
      statusCache = data;
      statusKey = key;
    }
    return data;
  };

  const checkAiEligibility = async (settings) => {
    const info = await fetchProStatus(settings);
    if (!info) return { allow: false, code: "network_error" };
    if (!info.aiReady) return { allow: false, code: "ai_not_configured" };
    if (!info.eligible) return { allow: false, code: "region_unavailable" };
    if (info.country !== "DEV") {
      // The server says who this is (an overlay link's code, or a signed-in browser) and what they may do: nothing here guesses.
      if (!info.pass) return { allow: false, code: "no_pass" };
      if (!info.pass.valid) return { allow: false, code: "invalid_pass" };
      if (info.pass.remaining <= 0) return { allow: false, code: "quota_exceeded" };
    }
    return { allow: true, code: "" };
  };

  const stopMeter = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (cadenceTimer) clearInterval(cadenceTimer);
    cadenceTimer = 0;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = 0;
    onLevel(0);
  };

  const stop = () => {
    cancelled = true;
    abortCtl?.abort();
    abortCtl = null;
    try { activeSource?.stop(); } catch { /* already stopped */ }
    activeSource = null;
    if (activeAudio) {
      try { activeAudio.pause(); } catch { /* ignore */ }
      if (activeAudio.src?.startsWith("blob:")) URL.revokeObjectURL(activeAudio.src);
      activeAudio = null;
    }
    try { globalThis.speechSynthesis?.cancel(); } catch { /* ignore */ }
    stopMeter();
  };

  const audioCtx = () => {
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return ctx;
  };

  const playBuffer = (buffer, volume) =>
    new Promise(async (resolve) => {
      const ac = audioCtx();
      if (!ac) return resolve(false);
      if (ac.state === "suspended") {
        try { await Promise.race([ac.resume(), new Promise((r) => setTimeout(r, 300))]); } catch { /* ignore */ }
      }
      if (ac.state !== "running") return resolve(false);
      ac.decodeAudioData(
        buffer.slice(0),
        (decoded) => {
          if (cancelled) return resolve(true);
          const source = ac.createBufferSource();
          const gain = ac.createGain();
          const analyser = ac.createAnalyser();
          analyser.fftSize = 256;
          gain.gain.value = Math.max(0.05, Math.min(1, volume));
          source.buffer = decoded;
          source.connect(gain);
          gain.connect(analyser);
          analyser.connect(ac.destination);

          const bins = new Uint8Array(analyser.fftSize);
          const tick = () => {
            if (cancelled || activeSource !== source) return;
            analyser.getByteTimeDomainData(bins);
            let sum = 0;
            for (let i = 0; i < bins.length; i++) {
              const v = (bins[i] - 128) / 128;
              sum += v * v;
            }
            const rms = Math.sqrt(sum / bins.length);
            onLevel(Math.min(1, rms * 3.8));
            rafId = requestAnimationFrame(tick);
          };

          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            if (activeSource === source) activeSource = null;
            stopMeter();
            resolve(true);
          };
          activeSource = source;
          source.onended = finish;
          settleTimer = setTimeout(finish, Math.min(35000, Math.max(2500, Math.ceil((decoded.duration + 1) * 1000))));
          source.start();
          rafId = requestAnimationFrame(tick);
        },
        () => resolve(false),
      );
    });

  const playHtmlAudio = (bytes, volume, mime = "audio/mpeg") =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      const audio = new Audio(url);
      audio.volume = Math.max(0.05, Math.min(1, volume));
      activeAudio = audio;
      let phase = 0;
      cadenceTimer = setInterval(() => {
        phase += 0.7;
        onLevel(0.35 + Math.abs(Math.sin(phase)) * 0.55);
      }, 90);
      const finish = () => {
        if (activeAudio === audio) activeAudio = null;
        URL.revokeObjectURL(url);
        stopMeter();
        resolve();
      };
      audio.onended = finish;
      audio.onerror = finish;
      audio.play().catch(finish);
    });

  const speakBrowser = (text, settings) =>
    new Promise((resolve) => {
      const synth = globalThis.speechSynthesis;
      if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
        onNotice("no_browser_tts");
        return resolve();
      }
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = Math.max(0.7, Math.min(1.5, (Number(settings.rate) || 100) / 100));
      utter.volume = Math.max(0.05, Math.min(1, (Number(settings.volume) || 90) / 100));
      utter.pitch = PITCH_BY_VOICE[settings.voice] ?? 1;

      const picked = pickBrowserVoice(synth.getVoices?.() ?? [], settings);
      if (picked) utter.voice = picked;

      let phase = 0;
      let lastBoundary = 0;
      cadenceTimer = setInterval(() => {
        if (cancelled) return;
        phase += 0.65;
        const boost = Date.now() - lastBoundary < 220 ? 0.9 : 0.45 + Math.abs(Math.sin(phase)) * 0.4;
        onLevel(boost);
      }, 85);

      const done = () => {
        stopMeter();
        resolve();
      };
      utter.onboundary = () => { lastBoundary = Date.now(); onLevel(0.95); };
      utter.onend = done;
      utter.onerror = done;

      settleTimer = setTimeout(done, Math.min(25000, Math.max(5000, text.length * 140)));
      try {
        synth.speak(utter);
      } catch {
        done();
      }
    });

  const speak = async (item, rawSettings) => {
    stop();
    cancelled = false;
    onNotice("");
    const chosenVoice = item.voice && item.voice !== "same" ? item.voice : rawSettings.voice || "nova";
    const settings = chosenVoice === rawSettings.voice ? rawSettings : { ...rawSettings, voice: chosenVoice };
    const engine = settings.engine || "auto";
    const volume = (Number(settings.volume) || 90) / 100;

    if (engine !== "browser") {
      const pre = await checkAiEligibility(settings);
      if (!pre.allow) {
        onNotice(pre.code);
        if (engine === "ai" || cancelled) return;
      } else {
        abortCtl = new AbortController();
        try {
          const headers = { "content-type": "application/json" };
          if (settings.code) headers["x-overlay"] = settings.code;
          const sim = String(getSimCountry() || "").trim().toUpperCase();
          if (sim) headers["x-frills-country"] = sim;

          let spokenText = item.text;
          if (item.cohost) {
            try {
              const coRes = await fetch("/api/cohost", {
                method: "POST",
                headers,
                signal: abortCtl.signal,
                body: JSON.stringify({
                  eventKind: item.cohost.eventKind,
                  author: item.cohost.author,
                  detail: item.cohost.detail,
                  vibe: settings.cohostVibe || "cozy",
                  pet: settings.pet || "frog2",
                  overlay: settings.code || "",
                }),
              });
              if (cancelled) return;
              if (coRes.ok) {
                const coData = await coRes.json().catch(() => null);
                if (coData?.reply) {
                  spokenText = coData.reply;
                  onTextUpdate(item, coData.reply);
                }
              }
            } catch (e) {
              if (e?.name === "AbortError" || cancelled) return;
            }
          }

          const res = await fetch("/api/tts", {
            method: "POST",
            headers,
            signal: abortCtl.signal,
            body: JSON.stringify({
              text: spokenText,
              voice: settings.voice || "nova",
              rate: (Number(settings.rate) || 100) / 100,
              overlay: settings.code || "",
            }),
          });
          if (cancelled) return;
          if (res.ok) {
            const used = Number(res.headers.get("x-tts-used"));
            const limit = Number(res.headers.get("x-tts-limit"));
            const remaining = Number(res.headers.get("x-tts-remaining"));
            if (Number.isFinite(used) && Number.isFinite(limit)) {
              statusCache = null; // keep preflight fresh on next utterance
              onUsage({ used, limit, remaining });
            }
            const mime = res.headers.get("content-type") || "audio/mpeg";
            const buf = await res.arrayBuffer();
            if (cancelled) return;
            const played = await playBuffer(buf, volume);
            if (!played && !cancelled) await playHtmlAudio(buf, volume, mime);
            return;
          }
          const err = await res.json().catch(() => null);
          statusCache = null;
          onNotice(err?.error || `http_${res.status}`, err?.detail || "");
        } catch (e) {
          if (e?.name === "AbortError" || cancelled) return;
          onNotice("network_error");
        }
        if (engine === "ai" || cancelled) return;
      }
    }

    await speakBrowser(item.text, settings);
  };

  /** Plays the cached server AI voice sample (falls back to free browser preview if server keys aren't configured locally). */
  const previewSample = async (voice = "nova", { volume = 0.9 } = {}) => {
    stop();
    cancelled = false;
    const chosen = SAMPLE_TEXT[voice] ? voice : "nova";
    try {
      const headers = {};
      const sim = String(getSimCountry() || "").trim().toUpperCase();
      if (sim) headers["x-frills-country"] = sim;
      abortCtl = new AbortController();
      const res = await fetch(`/api/voice-sample?voice=${encodeURIComponent(chosen)}`, { headers, signal: abortCtl.signal });
      if (cancelled) return { ok: false, error: "cancelled" };
      if (res.ok) {
        const mime = res.headers.get("content-type") || "audio/mpeg";
        const buf = await res.arrayBuffer();
        if (cancelled) return { ok: false, error: "cancelled" };
        const played = await playBuffer(buf, volume);
        if (!played && !cancelled) await playHtmlAudio(buf, volume, mime);
        return { ok: true, mode: "ai" };
      }
      const err = await res.json().catch(() => null);
      if (err?.error === "ai_not_configured") {
        await speakBrowser(SAMPLE_TEXT[chosen], { voice: chosen, rate: 100, volume: Math.round(volume * 100) });
        return { ok: true, mode: "browser_fallback" };
      }
      return { ok: false, error: err?.error || `http_${res.status}` };
    } catch (e) {
      if (e?.name === "AbortError" || cancelled) return { ok: false, error: "cancelled" };
      return { ok: false, error: "network_error" };
    }
  };

  return { speak, previewSample, stop, invalidate: () => { statusCache = null; } };
}
