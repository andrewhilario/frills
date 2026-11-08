// ==UserScript==
// @name         Frills Live Stream Chatbot (Transparent & Free)
// @namespace    https://frills.valwidgets.live/
// @version      1.0.0
// @description  Automates custom chat commands (.mouse, .sens, .specs) in TikTok LIVE and Twitch chat without third-party cloud fees or server credential sharing.
// @author       Frills
// @match        https://www.tiktok.com/@*/live*
// @match        https://www.tiktok.com/live*
// @match        https://live.tiktok.com/*
// @match        https://www.twitch.tv/*
// @grant        none
// ==/UserScript==

/**
 * -------------------------------------------------------------------------------------------------
 * TRANSPARENCY & PRIVACY STATEMENT:
 * -------------------------------------------------------------------------------------------------
 * 1. ZERO DATA EXFILTRATION: This script runs 100% locally in your own browser tab. It never transmits
 *    your password, cookies, or session tokens to Frills or any external server.
 * 2. NO PAID SERVICES: Unlike TikFinity or cloud bots, this does not charge subscription fees or route
 *    your traffic through expensive third-party signing proxies.
 * 3. ANTI-SPAM PROTECTION: Built-in cooldowns ensure your account does not flood chat or trigger
 *    TikTok/Twitch automated rate limits.
 * -------------------------------------------------------------------------------------------------
 */

(function () {
  "use strict";

  // ── 1. CONFIGURATION (Customize your triggers and replies here) ──────────────────────────────────
  const CONFIG = {
    // Command prefix (e.g. "." or "!" or "")
    prefix: ".",

    // Minimum seconds before the bot can reply again to prevent chat spam / rate limits
    cooldownSeconds: 8,

    // Your custom commands and the bot's chat replies
    commands: [
      { trigger: "mouse", reply: "🐭 Mouse: Logitech G Pro X Superlight 2 (800 DPI, Artisan Zero Soft pad)" },
      { trigger: "sens", reply: "🎯 Sensitivity: Valorant 0.31 @ 800 DPI (248 eDPI) · Fortnite 6.8%" },
      { trigger: "specs", reply: "💻 Specs: Ryzen 7 7800X3D · RTX 4080 Super · 32GB DDR5-6000" },
      { trigger: "discord", reply: "💬 Join our cozy Discord community: discord.gg/frills" },
      { trigger: "rank", reply: "🏆 Current Rank: Ascendant 2 (Peak: Immortal 1)" },
    ],
  };

  // Cooldown tracker: trigger -> lastSentTimestamp
  const cooldowns = new Map();

  function canSend(trigger) {
    const last = cooldowns.get(trigger.toLowerCase()) || 0;
    const elapsed = (Date.now() - last) / 1000;
    return elapsed >= CONFIG.cooldownSeconds;
  }

  function recordSent(trigger) {
    cooldowns.set(trigger.toLowerCase(), Date.now());
  }

  // ── 2. COMMAND MATCHER ──────────────────────────────────────────────────────────────────────────
  function matchCommand(rawText) {
    if (!rawText || typeof rawText !== "string") return null;
    const firstWord = rawText.trim().split(/\s+/)[0].toLowerCase();
    const pref = (CONFIG.prefix || "").toLowerCase();

    for (const cmd of CONFIG.commands) {
      const trig = cmd.trigger.toLowerCase().trim();
      const startsWithSymbol = /^[!./?#~$%&*@^+=:;-]/.test(trig);

      if (startsWithSymbol) {
        if (firstWord === trig) return cmd;
      } else {
        const expected = pref ? `${pref}${trig}` : trig;
        if (firstWord === expected) return cmd;
      }
    }
    return null;
  }

  // ── 3. PLATFORM CHAT POSTERS ───────────────────────────────────────────────────────────────────

  // TikTok LIVE Web comment sender
  function postTikTokComment(text) {
    // Locate the chat input in TikTok Web
    const input = document.querySelector(
      'div[contenteditable="true"][data-e2e="comment-input"], ' +
      'div[contenteditable="true"], ' +
      'textarea[placeholder*="comment" i], ' +
      'textarea[placeholder*="say something" i], ' +
      'input[placeholder*="comment" i]'
    );

    if (!input) {
      console.warn("[Frills Chatbot] TikTok chat input box not found. Are you on the LIVE page?");
      return false;
    }

    input.focus();

    if (input.isContentEditable) {
      input.innerText = text;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
    } else {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set
        || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (nativeSetter) nativeSetter.call(input, text);
      else input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // Give the DOM a tiny frame to enable the Send button, then submit
    setTimeout(() => {
      const sendBtn = document.querySelector(
        'button[data-e2e="comment-post"], ' +
        'button[type="submit"], ' +
        'div[data-e2e="comment-post"]'
      );

      if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute("aria-disabled") !== "true") {
        sendBtn.click();
        console.log(`[Frills Chatbot] Sent TikTok comment: "${text}"`);
      } else {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
        console.log(`[Frills Chatbot] Dispatched Enter key for comment: "${text}"`);
      }
    }, 120);

    return true;
  }

  // Twitch Web comment sender
  function postTwitchComment(text) {
    const input = document.querySelector(
      '[data-a-target="chat-input"], ' +
      'textarea[data-a-target="chat-input"]'
    );

    if (!input) {
      console.warn("[Frills Chatbot] Twitch chat input box not found.");
      return false;
    }

    input.focus();
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (nativeSetter) nativeSetter.call(input, text);
    else input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));

    setTimeout(() => {
      const sendBtn = document.querySelector('[data-a-target="chat-send-button"]');
      if (sendBtn && !sendBtn.disabled) {
        sendBtn.click();
      } else {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      }
      console.log(`[Frills Chatbot] Sent Twitch comment: "${text}"`);
    }, 100);

    return true;
  }

  function sendComment(text) {
    const host = window.location.hostname;
    if (host.includes("tiktok.com")) return postTikTokComment(text);
    if (host.includes("twitch.tv")) return postTwitchComment(text);
    return false;
  }

  // ── 4. CHAT OBSERVER (Listens to new messages appearing in DOM) ─────────────────────────────────
  // The same message is often seen twice within a moment (a row and the elements inside it, or the page redrawing the row), so
  // the same text is ignored only for a few seconds. Remembering it for good would make a command work once and then never again.
  const DUPLICATE_WINDOW_MS = 4000;
  const recentMessages = new Map(); // text -> when it was last seen

  function isRecentDuplicate(text) {
    const now = Date.now();
    for (const [seen, at] of recentMessages) {
      if (now - at > DUPLICATE_WINDOW_MS) recentMessages.delete(seen);
    }
    if (recentMessages.has(text)) return true;
    recentMessages.set(text, now);
    return false;
  }

  function processMessageNode(node) {
    if (!node || !(node instanceof Element)) return;
    const text = node.textContent?.trim();
    if (!text || text.length > 300) return;

    if (isRecentDuplicate(text)) return;

    const match = matchCommand(text);
    if (match) {
      if (!canSend(match.trigger)) {
        console.log(`[Frills Chatbot] Cooldown active for "${match.trigger}". Suppressing auto-reply.`);
        return;
      }

      console.log(`[Frills Chatbot] Detected command "${match.trigger}" -> Replying: "${match.reply}"`);
      recordSent(match.trigger);

      // Random natural delay (600ms - 1400ms) so it behaves smoothly and naturally
      const delay = 600 + Math.random() * 800;
      setTimeout(() => {
        sendComment(match.reply);
      }, delay);
    }
  }

  function startObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const added of mutation.addedNodes) {
          if (added instanceof Element) {
            processMessageNode(added);
            // Also check children in case a container was appended
            const children = added.querySelectorAll("span, p, div");
            for (let i = 0; i < Math.min(children.length, 5); i++) {
              processMessageNode(children[i]);
            }
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    console.log(
      `%c[Frills Chatbot] Active & Listening!%c Prefix: "${CONFIG.prefix}" | Cooldown: ${CONFIG.cooldownSeconds}s | Commands: ${CONFIG.commands.length}`,
      "color: #10b981; font-weight: bold; font-size: 13px;",
      "color: inherit;"
    );
  }

  // Start after page elements settle
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(startObserver, 2000));
  } else {
    setTimeout(startObserver, 2000);
  }
})();
