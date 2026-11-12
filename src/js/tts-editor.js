// Talking Pet TTS editor page: live preview, voice/region/paywall check, browser voice selector, and OBS overlay link builder.

import { TTS, TtsQueue, ttsSpeechFor } from "./tts.js";
import { createTtsPlayer } from "./tts-audio.js";
import { createTtsView } from "./widgets-view.js";
import { startWidgetEditor } from "./widget-editor.js";
import { fakeAlert, practiceName } from "./fake-alerts.js";

const NOTICE_COPY = {
  no_pass: "AI voice blocked by paywall (no Pro Pass) — speaking with built-in browser voice instead.",
  invalid_pass: "Pro Pass key not recognized — using built-in browser voice.",
  region_unavailable: "Pro AI voices are Tier-1 region locked — using free built-in browser voice.",
  quota_exceeded: "Monthly Pro AI credit limit reached — using free built-in browser voice.",
  ai_not_configured: "Server AI key (OpenAI / Google / Groq) not set — using free built-in browser voice.",
  groq_terms_required: "Groq requires accepting Orpheus terms once in Groq Playground (canopylabs/orpheus-v1-english) — using browser voice for now.",
  invalid_api_key: "AI provider rejected your API key (check for typos or quotes around the key) — using browser voice.",
  rate_limited: "Groq free rate limit reached (max 10 tests/min, 100/day) — using browser voice until limit clears.",
  provider_error: "AI voice request failed upstream — using free built-in browser voice.",
  network_error: "Could not reach /api/tts — using free built-in browser voice.",
  no_browser_tts: "This browser does not expose speechSynthesis — use Chrome/Edge or an AI key.",
};

startWidgetEditor({
  widget: TTS,
  storeKey: "frills:tts:v1",
  overlayPath: "/overlay/tts/",
  events: ["gift"],
  idleHint: "Type someone’s TikTok username (or @name) and press Connect to test live gifts & chat.",
  create(host, initial) {
    let settings = initial;
    let simCountry = "";
    const view = createTtsView(host);
    view.apply(settings);

    const statusEl = document.getElementById("pro-status");
    const paywallEl = document.getElementById("pro-paywall");
    const paywallTitle = document.getElementById("pro-paywall-title");
    const paywallBody = document.getElementById("pro-paywall-body");
    const checkoutBtn = document.getElementById("pro-checkout");
    const lsForm = document.getElementById("ls-form");
    const lsKeyInput = document.getElementById("ls-key");
    const testerEl = document.getElementById("pro-tester");
    const simSelect = document.getElementById("sim-country");
    const mintBtn = document.getElementById("mint-pass");
    const clearPassBtn = document.getElementById("clear-pass");
    const checkPassBtn = document.getElementById("check-pass");
    let checkoutUrl = "";
    let lastEligible = true;

    const setStatus = (tone, message) => {
      if (!statusEl) return;
      statusEl.hidden = !message;
      statusEl.dataset.tone = tone;
      statusEl.textContent = message;
    };

    const setPaywall = (visible, title = "", body = "", canBuy = lastEligible) => {
      if (!paywallEl) return;
      paywallEl.hidden = !visible;
      if (visible) {
        paywallTitle.textContent = title;
        paywallBody.textContent = body;
      }
      if (checkoutBtn) checkoutBtn.hidden = !visible || !canBuy || !checkoutUrl;
      if (lsForm) lsForm.hidden = !canBuy;
    };

    const updatePassInput = (value) => {
      const passInput = document.getElementById("c-passToken");
      if (!passInput) return;
      passInput.value = value;
      passInput.dispatchEvent(new Event("input", { bubbles: true }));
    };

    const player = createTtsPlayer({
      onLevel: (lvl) => view.level(lvl),
      getSimCountry: () => simCountry,
      onUsage({ used, limit, remaining }) {
        setStatus(
          remaining > 0 ? "ok" : "warn",
          remaining > 0
            ? `Pro Pass active — ${remaining} of ${limit} AI messages remaining (${used} used).`
            : `Pro Pass exhausted (${used}/${limit} used) — next lines fall back to free browser speech.`,
        );
        if (remaining <= 0) {
          setPaywall(
            true,
            "Monthly AI credits used up",
            `Your pass has used ${used} / ${limit} credits. Top up or issue another test pass below to resume AI voices.`,
          );
        }
      },
      onNotice: (code, detail = "") => {
        if (!code) return;
        if (code === "no_pass" || code === "invalid_pass") {
          setStatus("lock", NOTICE_COPY[code]);
          setPaywall(
            true,
            code === "invalid_pass" ? "Invalid or inactive Pro Pass" : "Unlock AI voices with Frills Pro",
            `Region (${simCountry || "Tier-1"}) is eligible for Frills Pro. Enter a valid Pro Pass key below (or create a test pass in dev mode).`,
          );
          return;
        }
        if (code === "quota_exceeded") {
          setStatus("lock", NOTICE_COPY[code]);
          setPaywall(true, "Monthly AI credits used up", "This pass reached its credit limit. Renew or create a new test pass to keep using AI voices.");
          return;
        }
        if (code === "region_unavailable") {
          setStatus("lock", NOTICE_COPY[code]);
          setPaywall(true, `AI voices unavailable in ${simCountry || "this region"}`, "Paid AI voices launch first in Tier-1 regions (US, CA, UK, EU, AU, NZ). Free browser voices continue working everywhere.");
          return;
        }
        const msg = NOTICE_COPY[code] || `TTS notice (${code})`;
        setStatus("warn", detail ? `${msg} (${detail})` : msg);
      },
    });

    const queue = new TtsQueue(settings, {
      speak: player.speak,
      onStart: (item) => view.start(item),
      onIdle: () => view.idle(),
    });

    const refreshProStatus = async () => {
      try {
        const headers = {};
        if (simCountry) headers["x-frills-country"] = simCountry;
        if (settings.passToken) headers["x-pass"] = settings.passToken;
        const r = await fetch("/api/pro/status", { headers });
        const info = r.ok ? await r.json() : null;
        if (!info) return;

        if (testerEl && info.dev) testerEl.hidden = false;
        checkoutUrl = typeof info.checkoutUrl === "string" ? info.checkoutUrl : "";
        lastEligible = Boolean(info.eligible);

        if (info.country === "DEV") {
          setPaywall(false, "", "", true);
          setStatus(
            info.aiReady ? "ok" : "warn",
            info.aiReady
              ? "Local test mode: AI provider ready & dev bypass active. Use the region dropdown below to test paywall enforcement."
              : "Local test mode: free built-in browser TTS ready. Set GROQ_TTS_KEY, GOOGLE_TTS_KEY, or OPENAI_TTS_KEY to preview AI voices.",
          );
          return;
        }

        if (!info.eligible) {
          setStatus("lock", `Region locked (${info.country}): Pro checkout & AI voices disabled; free browser voices stay available.`);
          setPaywall(
            true,
            `Not available in ${info.country} yet`,
            "Paid AI voices are limited to Tier-1 regions (US, CA, UK, EU, AU, NZ). Built-in browser TTS remains free with no key.",
          );
          return;
        }

        if (info.pass) {
          if (!info.pass.valid) {
            setStatus("lock", `Region ${info.country}: Pro Pass invalid or paused.`);
            setPaywall(true, "Invalid or inactive Pro Pass", "Check your Pro Pass key or issue a fresh test pass.");
          } else if (info.pass.remaining <= 0) {
            setStatus("lock", `Region ${info.country}: Pro Pass quota exhausted (${info.pass.used}/${info.pass.limit}).`);
            setPaywall(true, "Monthly AI credits used up", `Used ${info.pass.used} of ${info.pass.limit} credits.`);
          } else {
            setPaywall(false);
            setStatus(
              info.aiReady ? "ok" : "warn",
              info.aiReady
                ? `Pro Pass active in ${info.country} — ${info.pass.remaining}/${info.pass.limit} AI credits remaining.`
                : `Pro Pass valid (${info.pass.remaining}/${info.pass.limit}), waiting for server AI key.`,
            );
          }
          return;
        }

        // Eligible country, no pass key supplied -> paywall shown
        setStatus("warn", `Region ${info.country} eligible — Pro Pass required for AI voices (built-in browser voices stay free).`);
        setPaywall(
          true,
          "Frills Pro Pass required for AI voices",
          `Your region (${info.country}) is eligible for paid AI voices. Enter a Pro Pass key in Step 2 or generate a 5-credit local test pass below.`,
        );
      } catch { /* offline / static preview */ }
    };

    void refreshProStatus();

    simSelect?.addEventListener("change", () => {
      simCountry = String(simSelect.value || "").trim().toUpperCase();
      player.invalidate();
      void refreshProStatus();
    });

    mintBtn?.addEventListener("click", async () => {
      try {
        const res = await fetch("/api/pro/dev-pass", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ country: simCountry && simCountry !== "PH" && simCountry !== "BR" ? simCountry : "US", limit: 5 }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.token) {
          setStatus("warn", `Could not create test pass (${data?.error || res.status}). Ensure DB is attached (npm run serve or npm run tiktok).`);
          return;
        }
        updatePassInput(data.token);
        if (!simCountry && simSelect) {
          // Automatically switch simulator from DEV bypass to US so paywall & quota counters run realistically
          simCountry = "US";
          simSelect.value = "US";
        }
        player.invalidate();
        await refreshProStatus();
      } catch {
        setStatus("warn", "Failed to contact /api/pro/dev-pass.");
      }
    });

    clearPassBtn?.addEventListener("click", () => {
      updatePassInput("");
      player.invalidate();
      void refreshProStatus();
    });

    checkPassBtn?.addEventListener("click", () => {
      player.invalidate();
      void refreshProStatus();
    });

    checkoutBtn?.addEventListener("click", () => {
      if (checkoutUrl) window.open(checkoutUrl, "_blank", "noopener");
    });

    lsForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const key = String(lsKeyInput?.value ?? "").trim();
      if (!key) return;
      try {
        const headers = { "content-type": "application/json" };
        if (simCountry) headers["x-frills-country"] = simCountry;
        const res = await fetch("/api/pro/activate", {
          method: "POST",
          headers,
          body: JSON.stringify({ licenseKey: key }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          setStatus("lock", `License activation failed (${data?.detail || data?.error || res.status}).`);
          return;
        }
        updatePassInput(data.token || key);
        if (lsKeyInput) lsKeyInput.value = "";
        player.invalidate();
        await refreshProStatus();
      } catch {
        setStatus("warn", "Could not reach /api/pro/activate.");
      }
    });

    // Dynamic browser voice picker populated from speechSynthesis
    const voiceRow = document.getElementById("browser-voice-row");
    const voicePick = document.getElementById("browser-voice-pick");
    const populateBrowserVoices = () => {
      const synth = globalThis.speechSynthesis;
      if (!synth || !voicePick || !voiceRow) return;
      const voices = synth.getVoices?.() ?? [];
      if (!voices.length) return;
      voiceRow.hidden = false;
      const sorted = [...voices].sort((a, b) => {
        const score = (v) => (/natural|online/i.test(v.name) ? 4 : /google|microsoft/i.test(v.name) ? 2 : 0) + (/^en\b/i.test(v.lang) ? 2 : 0);
        return score(b) - score(a) || a.name.localeCompare(b.name);
      });
      const prev = settings.browserVoice || "";
      voicePick.replaceChildren(new Option("Auto (match voice style)", ""));
      for (const v of sorted) voicePick.append(new Option(`${v.name} (${v.lang})`, v.name));
      if (prev) voicePick.value = prev;
    };
    populateBrowserVoices();
    if (globalThis.speechSynthesis) globalThis.speechSynthesis.addEventListener("voiceschanged", populateBrowserVoices);

    voicePick?.addEventListener("change", () => {
      const filterInput = document.getElementById("c-browserVoice");
      if (filterInput) {
        filterInput.value = voicePick.value;
        filterInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    const sayForm = document.getElementById("say-form");
    const sayInput = document.getElementById("say-input");
    sayForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      const raw = String(sayInput?.value ?? "").trim() || "Hello pond! Thanks for hanging out tonight!";
      const name = practiceName();
      const item = ttsSpeechFor({ name, text: raw }, { ...settings, trigger: "all_chat" });
      if (item) {
        item.badge = "preview";
        queue.enqueue(item, { bypassCooldown: true });
      }
    });

    return {
      apply(next) {
        const passChanged = next.passToken !== settings.passToken;
        settings = next;
        view.apply(next);
        queue.setSettings(next);
        if (voicePick && voicePick.value !== (next.browserVoice || "")) voicePick.value = next.browserVoice || "";
        if (passChanged) {
          player.invalidate();
          void refreshProStatus();
        }
      },
      onEvent(event) {
        const item = ttsSpeechFor(event, settings);
        if (item) queue.enqueue(item);
      },
      onChat(msg) {
        const item = ttsSpeechFor(msg, settings);
        if (item) queue.enqueue(item);
      },
      tests: {
        gift() {
          const alert = fakeAlert("gift", { size: 2 });
          const min = Number(settings.minDiamonds) || 0;
          if ((alert.total || 0) < min) {
            alert.diamonds = min;
            alert.total = min;
          }
          const item = ttsSpeechFor(alert, { ...settings, trigger: "both", announceGift: true });
          if (item) queue.enqueue(item, { bypassCooldown: true });
        },
        bigGift() {
          const alert = fakeAlert("gift", { size: 3 });
          const item = ttsSpeechFor(alert, { ...settings, trigger: "both", announceGift: true });
          if (item) queue.enqueue(item, { bypassCooldown: true });
        },
        cmd() {
          const prefix = String(settings.command || "!say").trim() || "!say";
          const item = ttsSpeechFor(
            { name: practiceName(), text: `${prefix} Can our pet cheer for tonight’s stream?` },
            { ...settings, trigger: "cmd" },
          );
          if (item) queue.enqueue(item, { bypassCooldown: true });
        },
        clear() {
          queue.clear();
          player.stop();
          view.clear();
        },
      },
    };
  },
});
