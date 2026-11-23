// Talking Pet TTS editor page: live preview, voice/region/paywall check, browser voice selector, and OBS overlay link builder.

import { TTS, TtsQueue, ttsSpeechFor } from "./tts.js";
import { createTtsPlayer } from "./tts-audio.js";
import { createTtsView } from "./widgets-view.js";
import { startWidgetEditor } from "./widget-editor.js";
import { fakeAlert, practiceName } from "./fake-alerts.js";
import { clearPlusCode, clearRelayTicketCache, savePlusCode, savedPlusCode } from "./plus-relay.js";

const NOTICE_COPY = {
  no_pass: "AI voices are part of Frills Plus — speaking with the free browser voice instead.",
  invalid_pass: "This Frills Plus link or account is not active — using the free browser voice.",
  region_unavailable: "Cloud AI voices are not sold in this region yet — using the free browser voice.",
  quota_exceeded: "This month's Frills Plus AI voice is used up — using the free browser voice.",
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
  platforms: ["tiktok", "twitch", "both"],
  events: (p) => (p === "twitch" ? ["sub", "subgift", "bits", "raid"] : p === "both" ? ["gift", "sub", "subgift", "bits", "raid"] : ["gift"]),
  idleHint: (p) => (p === "twitch"
    ? "Type your Twitch channel and press Connect to test live chat, bits & subs — or use the test buttons above."
    : p === "both"
      ? "Type your TikTok @name and Twitch channel to let one Talking Pet read both streams at once."
      : "Type someone’s TikTok username (or @name) and press Connect to test live gifts & chat."),
  create(host, initial, ctx) {
    let settings = initial;
    let simCountry = "";
    const view = createTtsView(host);
    view.apply(settings);
    // Show a silent starter bubble on load so look changes in Step 1 are immediately visible in the preview
    view.start({ kind: "gift", author: "Pond Pal", badge: "Doughnut", text: "Pond Pal sent Doughnut!", message: "Doughnut" });
    view.level(0);

    const statusEl = document.getElementById("pro-status");
    const paywallEl = document.getElementById("pro-paywall");
    const paywallTitle = document.getElementById("pro-paywall-title");
    const paywallBody = document.getElementById("pro-paywall-body");
    const accountLink = document.getElementById("pro-account");
    const testerEl = document.getElementById("pro-tester");
    const simSelect = document.getElementById("sim-country");
    const mintBtn = document.getElementById("mint-pass");
    const checkPassBtn = document.getElementById("check-pass");
    let lastEligible = true;
    // Frills Plus is on sale only on a site built with the account pages. Without them (and off a local test server) nothing here talks about paying, signing in or an AI voice: the free voice just speaks.
    const accountsOn = document.getElementById("plus-link")?.dataset.accounts === "on";
    let devSite = false;
    const quiet = () => !accountsOn && !devSite;

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
      // Buying happens on the account page, where the payment is tied to the person's account; the site must be built with the account pages for that link to exist.
      if (accountLink) {
        if (accountsOn) accountLink.setAttribute("href", "/account/"); // (set here, so a page built without accounts has no link to a missing page)
        accountLink.hidden = !visible || !canBuy || !accountsOn;
      }
    };

    const player = createTtsPlayer({
      onLevel: (lvl) => view.level(lvl),
      onTextUpdate: (_item, reply) => view.updateText(reply),
      getSimCountry: () => simCountry,
      onUsage({ used, limit, remaining }) {
        setStatus(
          remaining > 0 ? "ok" : "warn",
          remaining > 0
            ? `Frills Plus is on — ${remaining.toLocaleString()} of ${limit.toLocaleString()} AI voice characters left this month.`
            : `Frills Plus AI voice used up (${used.toLocaleString()} of ${limit.toLocaleString()} characters) — next lines use the free browser voice.`,
        );
        if (remaining <= 0) {
          setPaywall(
            true,
            "Monthly AI voice used up",
            `You have used ${used.toLocaleString()} of ${limit.toLocaleString()} AI voice characters this month. They come back when your Frills Plus renews; until then the free browser voice speaks.`,
          );
        }
      },
      onNotice: (code, detail = "") => {
        if (!code || quiet()) return;
        if (code === "no_pass" || code === "invalid_pass") {
          setStatus("lock", NOTICE_COPY[code]);
          setPaywall(
            true,
            code === "invalid_pass" ? "Frills Plus is not active" : "Unlock AI voices with Frills Plus",
            code === "invalid_pass"
              ? "This account has no active Frills Plus, or the link code is no longer live. Sign in to check, or make a new Plus link."
              : "AI voices are part of Frills Plus. Sign in to get it; the free browser voices need no account.",
          );
          return;
        }
        if (code === "quota_exceeded") {
          setStatus("lock", NOTICE_COPY[code]);
          setPaywall(true, "Monthly AI voice used up", "This month's AI voice is used up. They come back when your Frills Plus renews; the free browser voice keeps working.");
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

    let loadedAccount = false;
    let hasActivePlus = false;
    const syncPlusFeatureControls = () => {
      const showPlusExtras = Boolean(hasActivePlus || (devSite && !simCountry));
      const discoverPlus = Boolean(lastEligible && (accountsOn || devSite));

      let customChip = document.querySelector('#opt-controls .chip[data-pet-custom="1"]');
      if (!customChip) {
        customChip = [...document.querySelectorAll("#opt-controls .chip")].find((b) => b.textContent.trim().startsWith("Custom PNG / GIF")) ?? null;
        if (customChip) customChip.dataset.petCustom = "1";
      }
      if (customChip) {
        customChip.hidden = !discoverPlus && settings.pet !== "custom";
        customChip.textContent = !showPlusExtras && discoverPlus ? "Custom PNG / GIF · Plus" : "Custom PNG / GIF";
      }

      const cohostRow = document.querySelector('[aria-label="AI Pet Co-Host replies"]')?.closest(".ctl");
      if (cohostRow) cohostRow.hidden = !discoverPlus && settings.cohost === "off";
      const cohostActive = (settings.cohost || "off") !== "off";
      const vibeRow = document.querySelector('[aria-label="Co-Host personality"]')?.closest(".ctl");
      if (vibeRow) vibeRow.hidden = !discoverPlus || !cohostActive;
      const askRow = document.getElementById("c-askCommand")?.closest(".ctl");
      if (askRow) askRow.hidden = !discoverPlus || settings.cohost !== "both";

      const giftVoiceRow = document.getElementById("c-giftVoice")?.closest(".ctl");
      if (giftVoiceRow) giftVoiceRow.hidden = !lastEligible || !showPlusExtras;
      const whoRow = document.querySelector('[aria-label="Who can trigger chat TTS"]')?.closest(".ctl");
      if (whoRow) whoRow.hidden = !lastEligible || !showPlusExtras;

      const customPicked = settings.pet === "custom";
      const allowUpload = Boolean(customPicked && lastEligible && (showPlusExtras || settings.petIdle || settings.petTalk || settings.petExcited));
      const consent = document.getElementById("media-consent");
      if (consent) consent.hidden = !allowUpload;
      for (const el of document.querySelectorAll("#opt-controls .media")) el.hidden = !allowUpload;

      const testCohostBtn = document.getElementById("test-cohost");
      if (testCohostBtn) testCohostBtn.hidden = !discoverPlus || (!showPlusExtras && !cohostActive);

      const featureHint = document.getElementById("plus-feature-hint");
      if (featureHint) {
        const tryingLockedPreview = Boolean(discoverPlus && !showPlusExtras && (customPicked || cohostActive));
        featureHint.hidden = !tryingLockedPreview;
        if (tryingLockedPreview) {
          featureHint.replaceChildren(document.createTextNode("Custom 3-frame PNGTuber uploads and AI Pet Co-Host replies unlock with "));
          if (accountsOn) {
            const link = document.createElement("a");
            link.href = "/plus/";
            link.textContent = "Frills Plus";
            featureHint.append(link);
          } else {
            featureHint.append(document.createTextNode("Frills Plus"));
          }
          featureHint.append(document.createTextNode(" — explore the setup here, then subscribe to use them live on stream."));
        }
      }
    };

    const syncRegionUi = (eligible) => {
      const plusBoxEl = document.getElementById("plus-link");
      if (plusBoxEl) plusBoxEl.hidden = !eligible || !loadedAccount;
      const lede = document.querySelector(".panel__lede");
      if (lede) {
        if (!lede.dataset.origHtml) lede.dataset.origHtml = lede.innerHTML;
        lede.innerHTML = eligible
          ? lede.dataset.origHtml
          : lede.dataset.origHtml.replace(/,\s*and Frills Plus adds AI voices/gi, "");
      }
      const engineCtl = document.querySelector('[aria-label="Voice mode"]')?.closest(".ctl");
      if (engineCtl) engineCtl.hidden = !eligible;
      const sampleRow = document.getElementById("ai-voice-preview-row");
      if (sampleRow) sampleRow.hidden = !eligible || (!accountsOn && !devSite);
      syncPlusFeatureControls();
      // In non-eligible regions (e.g. PH), remove/hide any "Frills Plus" wording in control hints and about text
      for (const el of document.querySelectorAll(".ctl__hint")) {
        if (!el.dataset.origText && el.textContent.includes("Frills Plus")) {
          el.dataset.origText = el.textContent;
        }
        if (el.dataset.origText) {
          el.textContent = eligible
            ? el.dataset.origText
            : el.dataset.origText.replace(/The AI voices are part of Frills Plus\. Without Plus, each/i, "Each").replace(/Frills Plus[^.]*\./gi, "").trim();
        }
      }
      for (const li of document.querySelectorAll(".about li")) {
        if (li.textContent.includes("Frills Plus") || li.dataset.plusAbout === "1") {
          li.dataset.plusAbout = "1";
          li.hidden = !eligible;
        }
      }
    };

    const refreshProStatus = async () => {
      try {
        const headers = {};
        if (simCountry) headers["x-frills-country"] = simCountry;
        const r = await fetch("/api/pro/status", { headers });
        const info = r.ok ? await r.json() : null;
        if (!info) return;

        if (testerEl && info.dev) testerEl.hidden = false;
        devSite = Boolean(info.dev);
        if (quiet()) return;
        lastEligible = Boolean(info.eligible);
        syncRegionUi(lastEligible);

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
          if (!info.dev) {
            // Real visitor in a non-eligible region (e.g. PH): show zero Plus banners or paywalls
            setStatus("", "");
            setPaywall(false);
            return;
          }
          setStatus("lock", `Region locked (${info.country}): cloud AI voices are off here; free browser voices stay available.`);
          setPaywall(
            true,
            `Not available in ${info.country} yet`,
            "Cloud AI voices are limited to the US, Canada, UK, EU, Australia and New Zealand for now. The free browser voices work everywhere.",
            false,
          );
          return;
        }

        if (info.pass) {
          if (!info.pass.valid) {
            setStatus("lock", `Region ${info.country}: Frills Plus is not active.`);
            setPaywall(true, "Frills Plus is not active", "Sign in to check your Frills Plus, or make a new Plus link if this link was replaced.");
          } else if (info.pass.remaining <= 0) {
            setStatus("lock", `Region ${info.country}: Frills Plus AI voice used up (${info.pass.used.toLocaleString()} of ${info.pass.limit.toLocaleString()} characters).`);
            setPaywall(true, "Monthly AI voice used up", `Used ${info.pass.used.toLocaleString()} of ${info.pass.limit.toLocaleString()} characters.`);
          } else {
            setPaywall(false);
            setStatus(
              info.aiReady ? "ok" : "warn",
              info.aiReady
                ? `Frills Plus is on in ${info.country} — ${info.pass.remaining.toLocaleString()} of ${info.pass.limit.toLocaleString()} AI voice characters left.`
                : `Frills Plus is on (${info.pass.remaining.toLocaleString()} characters left), waiting for the server's AI key.`,
            );
          }
          return;
        }

        // Eligible country, nothing brought (not signed in, no link code) -> the free voice, with the way to Frills Plus offered
        setStatus("warn", `Region ${info.country}: AI voices are part of Frills Plus (the built-in browser voices stay free).`);
        setPaywall(
          true,
          "Frills Plus gives you AI voices",
          "Sign in to get Frills Plus and use AI voices on your stream. The free browser voices need no account.",
        );
      } catch { /* offline / static preview */ }
    };

    void refreshProStatus();

    // ── Frills Plus link: a person signs in on /account/; this panel then makes the code that rides in the overlay link. The code stands for the account (never the payment), and a new
    // one ends the old. The panel appears only on a site built with the account pages, and where the person can be asked who they are.
    const plusBox = document.getElementById("plus-link");
    if (plusBox && plusBox.dataset.accounts === "on") { // (the account pages are built only when switched on)
      const el = (id) => document.getElementById(id);
      const say = (text, bad = false) => { el("plus-link-status").textContent = text; el("plus-link-status").dataset.state = bad ? "error" : ""; };
      const post = (action) => fetch(`/api/account/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", credentials: "same-origin" }).then(async (res) => ({ ok: res.ok, body: await res.json().catch(() => ({})) }));
      const setCode = (code) => {
        settings.code = code;
        if (code) savePlusCode(code);
        else clearPlusCode();
        clearRelayTicketCache();
        ctx?.refresh?.(); // the overlay link below is rebuilt with (or without) the code
        ctx?.save?.();
        player.invalidate();
        void refreshProStatus();
      };
      const draw = (me) => {
        const plus = Boolean(me.signedIn && me.plus?.active);
        hasActivePlus = plus;
        syncPlusFeatureControls();
        const mine = Boolean(settings.code) && Boolean(me.overlayLink);
        let words;
        if (!me.signedIn) words = "Sign in to use Frills Plus AI voices on your stream. The free browser voices need no account.";
        else if (!plus) words = "You do not have Frills Plus, so your stream uses the free browser voice.";
        else if (mine) words = "Your Plus link is on. The overlay link below carries it, so your overlay can use your AI voice.";
        else if (me.overlayLink) words = "A Plus link was made on another computer or browser. Make a new one to use it here: the old link stops working.";
        else words = "Make your Plus link, then copy the overlay link below into your streaming app.";
        el("plus-link-state").textContent = words;
        el("plus-link-make").hidden = !plus;
        el("plus-link-make").textContent = mine || me.overlayLink ? "Make a new link" : "Make my Plus link";
        el("plus-link-off").hidden = !(plus && (mine || me.overlayLink));
        el("plus-link-account").hidden = plus;
        el("plus-link-account").textContent = me.signedIn ? "Get Frills Plus" : "Sign in";
        el("plus-link-hint").hidden = !plus;
      };
      const load = async () => (await fetch("/api/account/me", { credentials: "same-origin" })).json();
      void (async () => {
        try {
          el("plus-link-account").setAttribute("href", "/account/"); // (set here, so a page built without accounts has no link to a missing page)
          const me = await load();
          if (!me?.ok) return;
          // a link code kept here that the server no longer knows (made new elsewhere, turned off, or the account is gone) is dropped;
          // if the user already activated their Plus code on /account/, pull it in here automatically
          if (settings.code && !(me.signedIn && me.overlayLink)) setCode("");
          else if (!settings.code && me.signedIn && me.overlayLink && savedPlusCode()) setCode(savedPlusCode());
          loadedAccount = true;
          plusBox.hidden = !lastEligible;
          draw(me);
        } catch { /* offline, or a static preview: the panel stays hidden */ }
      })();
      el("plus-link-make").addEventListener("click", async () => {
        el("plus-link-make").disabled = true;
        say("Making your link…");
        try {
          const res = await post("overlay-link");
          if (!res.ok || !res.body.code) { say(res.body.error === "plus_required" ? "Frills Plus is not on for this account." : "Sorry, that did not work. Please try again.", true); return; }
          setCode(res.body.code);
          say("Your new link is ready. Copy the overlay link below into your streaming app (any older link has stopped working).");
          draw(await load());
        } catch {
          say("Sorry, that did not work. Check your connection and try again.", true);
        } finally {
          el("plus-link-make").disabled = false;
        }
      });
      el("plus-link-off").addEventListener("click", async () => {
        el("plus-link-off").disabled = true;
        try {
          await post("overlay-link-off");
          setCode("");
          say("Your Plus link is off. Any overlay using it now speaks with the free browser voice.");
          draw(await load());
        } catch {
          say("Sorry, that did not work. Please try again.", true);
        } finally {
          el("plus-link-off").disabled = false;
        }
      });
    }

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
          credentials: "same-origin",
          body: JSON.stringify({ limit: 300 }),
        });
        const data = await res.json().catch(() => null);
        if (res.status === 401) { setStatus("warn", "Sign in on /account/ first (run npm run serve), then try again: the 300 characters go to the account you are signed in with."); return; }
        if (!res.ok || !data?.ok) { setStatus("warn", `Could not give test characters (${data?.error || res.status}). This works on npm run serve only.`); return; }
        if (!simCountry && simSelect) {
          // switch the simulator from the local bypass to the US so the count and the limits run realistically
          simCountry = "US";
          simSelect.value = "US";
        }
        player.invalidate();
        await refreshProStatus();
      } catch {
        setStatus("warn", "Failed to contact /api/pro/dev-pass.");
      }
    });

    checkPassBtn?.addEventListener("click", () => {
      player.invalidate();
      void refreshProStatus();
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

    const sampleBtn = document.getElementById("ai-voice-preview-btn");
    const sampleHint = document.getElementById("ai-voice-preview-hint");
    sampleBtn?.addEventListener("click", async () => {
      const voice = settings.voice || "nova";
      const volume = (Number(settings.volume) || 90) / 100;
      sampleBtn.disabled = true;
      sampleBtn.textContent = "Playing…";
      view.start({ kind: "gift", author: "AI Voice Preview", badge: voice, text: `Sample of “${voice}” Frills Plus AI voice.` });
      try {
        const res = await player.previewSample(voice, { volume });
        if (sampleHint) {
          if (res.ok && res.mode === "ai") sampleHint.textContent = `Played Studio AI sample for “${voice}”.`;
          else if (res.ok) sampleHint.textContent = `Played browser preview for “${voice}” (configure an AI TTS key to hear Studio AI audio).`;
          else if (res.error === "region_unavailable") sampleHint.textContent = "AI voice preview is not available in this region.";
          else sampleHint.textContent = "Could not load voice sample right now.";
        }
      } finally {
        view.idle();
        sampleBtn.disabled = false;
        sampleBtn.textContent = "▶ Hear AI voice";
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
        settings = next;
        view.apply(next);
        queue.setSettings(next);
        if (voicePick && voicePick.value !== (next.browserVoice || "")) voicePick.value = next.browserVoice || "";
        syncPlusFeatureControls();
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
          const min = Number(settings.minDiamonds) || 0;
          const alert = ctx.platform() === "twitch"
            ? { ...fakeAlert("bits"), count: Math.max(100, min) }
            : fakeAlert("gift", { size: 2 });
          if (ctx.platform() !== "twitch" && (alert.total || 0) < min) {
            alert.diamonds = min;
            alert.total = min;
          }
          const item = ttsSpeechFor(alert, { ...settings, trigger: "both", announceGift: true });
          if (item) queue.enqueue(item, { bypassCooldown: true });
        },
        bigGift() {
          const alert = ctx.platform() === "twitch"
            ? fakeAlert("subgift", { size: 3 })
            : fakeAlert("gift", { size: 3 });
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
        cohost() {
          const askPrefix = String(settings.askCommand || "!ask").trim() || "!ask";
          const item = ttsSpeechFor(
            { name: practiceName(), text: `${askPrefix} What is your favorite cozy snack tonight?` },
            { ...settings, cohost: "both", trigger: "both" },
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
