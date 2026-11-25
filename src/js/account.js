// The account pages: ask for a sign-in link, finish signing in from the link, see who is signed in, sign out. Both pages use this file; each part runs
// only if its page elements are there. The cookie that keeps a person signed in is set by the server and cannot be read from here (HttpOnly).

import { clearPlusCode, clearRelayTicketCache, savePlusCode, savedPlusCode } from "./plus-relay.js";
import { initNav } from "./nav.js";
import { countPrompt } from "./stats.js";

initNav();

const bindCopy = (btn, getText, label) => {
  let reset = 0;
  btn.addEventListener("click", async () => {
    const text = getText();
    if (!text) return;
    try { await navigator.clipboard.writeText(text); } catch { return; }
    btn.textContent = "Copied";
    clearTimeout(reset);
    reset = setTimeout(() => { btn.textContent = label; }, 1600);
  });
};

const $ = (id) => document.getElementById(id);
const post = (action, body = {}) =>
  fetch(`/api/account/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" }).then(async (res) => ({ ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) }));

const WORDS = {
  bad_email: "That does not look like an email address. Please check it.",
  rate_limited: "Too many links were asked for. Please wait a while and try again.",
  email_off: "Signing in by email is not switched on yet. Please check back soon.",
  mail_failed: "We could not send the email just now. Please try again in a minute.",
  not_ready: "Accounts are not working right now. Please try again later.",
  full: "Accounts are full right now. Please try again later.",
  checkout_off: "Frills Plus is not on sale yet. Please check back soon.",
  region_unavailable: "Frills Plus is not available in your region yet.",
  already_plus: "Frills Plus is already on for this account.",
  sign_in_first: "Please sign in first.",
  portal_off: "The billing page is not available yet. Please check back soon.",
  no_subscription: "There is no subscription on this account.",
  provider_error: "The payment provider did not answer. Please try again in a minute.",
  confirm_mismatch: "That is not the email of this account. Please type it exactly.",
  cancel_first: "Your subscription is still renewing. Press Manage or cancel and cancel it first, then delete your account.",
};
const RESEND_SECONDS = 30;
const validEmail = (address) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
const askLogin = async (address) => {
  const res = await post("login", { email: address });
  if (!res.ok || res.body.ok !== true) return WORDS[res.body.error] ?? "Sorry, that did not work. Please try again.";
  return "";
};
const canBuy = (me) => Boolean(me.checkout) && !me.plus?.active && !["paused", "unpaid"].includes(me.plus?.status);
const launchCheckout = async (button, note) => {
  countPrompt("checkout", "clicked"); // the last step before the payment page: how many who were offered Plus went this far
  button.disabled = true;
  note.hidden = false;
  note.dataset.state = "";
  note.textContent = "Opening the checkout…";
  try {
    const res = await post("checkout");
    if (res.ok && res.body.ok === true && typeof res.body.url === "string") { location.assign(res.body.url); return; }
    note.dataset.state = "error";
    note.textContent = WORDS[res.body.error] ?? "Sorry, the checkout did not open. Please try again.";
  } catch {
    note.dataset.state = "error";
    note.textContent = "Sorry, the checkout did not open. Check your connection and try again.";
  }
  button.disabled = false;
};

// ── /account/ ─────────────────────────────────────────────────────────────────────────────────────────
if ($("acct-form")) {
  const form = $("acct-form");
  const email = $("acct-email");
  const status = $("acct-status");
  const send = $("acct-send");
  const say = (text, bad = false) => { status.textContent = text; status.dataset.state = bad ? "error" : ""; };
  const show = (which) => {
    for (const id of ["acct-loading", "acct-form", "acct-sent", "acct-in"]) $(id).hidden = id !== which;
    $("acct-lede").hidden = which === "acct-in"; // (the "no account needed" words are for people who are not signed in)
  };

  const countdown = () => {
    const again = $("acct-again");
    let left = RESEND_SECONDS;
    again.disabled = true;
    const tick = () => {
      $("acct-wait").textContent = left > 0 ? `You can ask again in ${left} seconds.` : "";
      if (left-- <= 0) { again.disabled = false; return; }
      setTimeout(tick, 1000);
    };
    tick();
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const address = email.value.trim();
    if (!validEmail(address)) {
      email.setAttribute("aria-invalid", "true");
      say(WORDS.bad_email, true);
      email.focus();
      return;
    }
    email.removeAttribute("aria-invalid");
    send.disabled = true;
    say("Sending…");
    try {
      const problem = await askLogin(address);
      if (problem) { say(problem, true); return; }
      $("acct-sent-to").textContent = address;
      show("acct-sent");
      $("acct-sent").focus();
      countdown();
    } catch {
      say("Sorry, that did not send. Check your connection and try again.", true);
    } finally {
      send.disabled = false;
    }
  });

  $("acct-again").addEventListener("click", async () => {
    $("acct-again").disabled = true;
    try {
      const problem = await askLogin($("acct-sent-to").textContent);
      $("acct-wait").textContent = problem || "Sent again.";
    } catch {
      $("acct-wait").textContent = "That did not send. Please try again.";
    }
    setTimeout(countdown, 800);
  });

  $("acct-out").addEventListener("click", async () => {
    $("acct-out").disabled = true;
    try {
      await post("logout");
      clearPlusCode();
      forgetSetup();
      clearRelayTicketCache();
      show("acct-form");
      email.focus();
    } catch {
      $("acct-out-status").textContent = "Sorry, that did not work. Please try again.";
    } finally {
      $("acct-out").disabled = false;
    }
  });

  // What the Frills Plus card says and offers. The Buy button is only offered when there is nothing to pay for already: not while Plus is on, and not while it is paused or
  // unpaid (a second subscription would be paid for twice; those are sorted out with Manage or cancel).
  const day = (ms) => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const shortDay = (ms) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const plusWords = (me) => {
    const plus = me.plus;
    if (plus?.active) {
      if (plus.status === "canceled") return `Frills Plus is on until ${day(plus.renewsAt)}. It will not renew.`;
      return `Frills Plus is on for this account.${plus.renewsAt ? ` It renews around ${day(plus.renewsAt)}.` : ""}`;
    }
    if (plus?.status === "refunded") return "Your Frills Plus was refunded and is off.";
    if (plus?.status === "paused") return "Your Frills Plus is paused.";
    if (plus?.status === "unpaid") return "Your last payment did not go through, so Frills Plus is off.";
    if (plus) return "Your Frills Plus has ended.";
    return me.checkout ? "You do not have Frills Plus. It is a paid plan that adds extras to Frills." : "Frills Plus is not on sale yet.";
  };
  const badgeOf = (me) => {
    const plus = me.plus;
    if (!plus) return null;
    if (plus.active) return plus.status === "canceled" ? { text: `Ends ${shortDay(plus.renewsAt)}`, tone: "soon" } : { text: "On", tone: "on" };
    return { text: "Off", tone: "off" };
  };
  const canBuyAccount = (me) => canBuy(me);

  // The "Get Frills Plus working in OBS" checklist. Paying changes nothing in a streaming app on its own: a link copied before paying has no Plus code, so it keeps using the free
  // connection until the streamer copies it again and pastes it over the old one. Each step is "done" only from something this page can know (the code on this browser, a saved
  // cloud link); pasting into OBS cannot be seen from here, so that one step is the streamer's own tick, remembered on this browser only.
  const SETUP = { pasted: "frills:plus:setup:pasted", hidden: "frills:plus:setup:hidden" };
  const flag = (key) => { try { return localStorage.getItem(key) === "1"; } catch { return false; } };
  const setFlag = (key, on) => { try { if (on) localStorage.setItem(key, "1"); else localStorage.removeItem(key); } catch { /* storage can be blocked */ } };
  const forgetSetup = () => { setFlag(SETUP.pasted, false); setFlag(SETUP.hidden, false); };
  let lastMe = null;
  let cloudCount = null; // how many live cloud links are saved (null until asked)
  const node = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
  const setupSteps = (me) => {
    const activated = Boolean(savedPlusCode()) && Boolean(me.overlayLink);
    return [
      { title: "Frills Plus is on", done: true, text: "Your account is switched on. AI voices and the cloud tools below are yours to use." },
      {
        title: "Use your Plus connection in this browser",
        done: activated,
        text: me.overlayLink && !savedPlusCode()
          ? "A Plus code was made in another browser. Press the button to make a new one here; the older code stops working."
          : "This makes a private code that TikTok overlay links carry, so they use your own always-on connection and can speak AI voices.",
        action: activated ? null : node("button", { className: "btn btn--sm", type: "button", textContent: me.overlayLink ? "Make a new code here" : "Activate on this browser", onclick: () => $("acct-code-make")?.click() }),
      },
      {
        title: "Copy your links again and paste them over the old ones",
        done: flag(SETUP.pasted),
        text: "A link you copied before paying still uses the free connection. Copy it again from Quick start or any editor and replace it in OBS or TikTok LIVE Studio.",
        action: node("span", { className: "acct-row" },
          node("a", { className: "btn btn--sm", href: "/start/", textContent: "Open Quick start" }),
          node("button", { className: "btn btn--outline btn--sm", type: "button", disabled: !activated, textContent: flag(SETUP.pasted) ? "Not done yet" : "I pasted them", onclick: () => { setFlag(SETUP.pasted, !flag(SETUP.pasted)); renderSetup(lastMe); } })),
        locked: !activated,
      },
      {
        title: "Optional: save a link online so you never paste again",
        done: cloudCount > 0,
        optional: true,
        text: "Press Create live link in any editor and paste its /o/… link into OBS once. After that, looks and themes you change here update in OBS by themselves.",
        action: cloudCount > 0 ? null : node("a", { className: "btn btn--outline btn--sm", href: "/editor/", textContent: "Open the Chat editor" }),
      },
    ];
  };
  const renderSetup = (me) => {
    const card = $("acct-setup");
    if (!card || !me) return;
    const on = Boolean(me.plus?.active);
    card.hidden = !on || flag(SETUP.hidden);
    if (card.hidden) return;
    const steps = setupSteps(me);
    const required = steps.filter((s) => !s.optional);
    const finished = required.filter((s) => s.done).length;
    const count = $("acct-setup-count");
    count.hidden = false;
    count.textContent = finished === required.length ? "All set" : `${finished} / ${required.length}`;
    count.dataset.tone = finished === required.length ? "on" : "soon";
    const list = $("acct-setup-list");
    list.replaceChildren(...steps.map((step, i) => {
      const mark = node("span", { className: "acct-step__mark", textContent: step.done ? "✓" : String(i + 1) });
      mark.setAttribute("aria-hidden", "true");
      const li = node("li", { className: "acct-step" }, mark,
        node("p", { className: "acct-step__title", textContent: `${step.title}${step.done ? " (done)" : ""}` }),
        node("p", { className: "form__hint", textContent: step.text }));
      if (step.action) li.append(step.action);
      li.dataset.done = String(step.done);
      if (step.locked) li.dataset.locked = "true";
      return li;
    }));
    $("acct-setup-hide").textContent = finished === required.length ? "Done, hide this checklist" : "Hide this checklist";
  };
  const showPlus = (me) => {
    lastMe = me;
    $("acct-plus-state").textContent = plusWords(me);
    const badge = badgeOf(me);
    $("acct-badge").hidden = !badge;
    if (badge) { $("acct-badge").textContent = badge.text; $("acct-badge").dataset.tone = badge.tone; }
    const credits = me.plus?.active && me.plus.limit > 0;
    $("acct-credits").hidden = !credits;
    if (credits) {
      const used = Math.min(me.plus.used, me.plus.limit);
      $("acct-credits-text").textContent = `AI voice used this month: ${used.toLocaleString()} of ${me.plus.limit.toLocaleString()} characters`;
      const meter = $("acct-meter");
      meter.setAttribute("aria-valuemax", String(me.plus.limit));
      meter.setAttribute("aria-valuenow", String(used));
      meter.dataset.level = used / me.plus.limit >= 0.9 ? "high" : "ok";
      $("acct-meter-fill").style.setProperty("--used", String(used / me.plus.limit));
    }
    $("acct-buy").hidden = !canBuyAccount(me);
    $("acct-buy-hint").hidden = !canBuyAccount(me);
    const promoEl = $("acct-promo");
    if (promoEl) promoEl.hidden = !canBuyAccount(me) || !promoEl.textContent.trim();
    const manage = Boolean(me.portal) && Boolean(me.plus);
    $("acct-manage").hidden = !manage;
    $("acct-manage-hint").hidden = !manage;

    const codeBox = $("acct-code-box");
    if (codeBox) {
      const plusOn = Boolean(me.plus?.active);
      if (!plusOn || !me.overlayLink) {
        if (savedPlusCode() && (!plusOn || !me.overlayLink)) { clearPlusCode(); clearRelayTicketCache(); }
      }
      codeBox.hidden = !plusOn;
      if (plusOn) {
        const local = Boolean(savedPlusCode());
        const mine = local && Boolean(me.overlayLink);
        $("acct-code-state").textContent = mine
          ? "Active on this browser: copied TikTok overlay links include your Plus server code."
          : me.overlayLink
            ? "A Plus code is active on another browser. Press Make a new code to use it here (the older code stops working)."
            : "Not active on this browser yet. Press Activate to route your copied TikTok overlay links through the dedicated Frills Plus server.";
        $("acct-code-make").textContent = mine || me.overlayLink ? "Make a new code" : "Activate on this browser";
        $("acct-code-off").hidden = !(mine || me.overlayLink);
      }
    }
    renderSetup(me);
    loadCloudOverlays(Boolean(me.plus?.active));
  };

  // Saved live-updating cloud overlays (/o/<id>) managed on /account/
  const loadCloudOverlays = async (plusOn) => {
    const section = $("acct-cloud");
    const list = $("acct-cloud-list");
    const count = $("acct-cloud-count");
    const note = $("acct-cloud-status");
    if (!section || !list) return;
    try {
      const res = await fetch("/api/cloud-overlays", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) { section.hidden = true; return; }
      const data = await res.json();
      const items = Array.isArray(data?.overlays) ? data.overlays : [];
      if (cloudCount !== items.length) { cloudCount = items.length; renderSetup(lastMe); }
      section.hidden = !plusOn && !items.length;
      if (section.hidden) return;
      if (count) {
        count.hidden = false;
        count.textContent = `${items.length} / ${data.limit ?? 50}`;
      }
      const themeBar = $("acct-theme-bar");
      if (themeBar) themeBar.hidden = !(plusOn && items.length > 0);
      list.replaceChildren();
      if (!items.length) {
        const empty = document.createElement("li");
        empty.className = "form__hint";
        empty.textContent = "No live cloud overlays saved yet. Open any editor above, type your channel name, and press Create live link.";
        list.append(empty);
        return;
      }
      for (const item of items) {
        const li = document.createElement("li");
        li.className = "acct-cloud__item";

        const top = document.createElement("div");
        top.className = "acct-cloud__top";
        const name = document.createElement("span");
        name.className = "acct-cloud__name";
        name.textContent = item.name;
        const kind = document.createElement("span");
        kind.className = "acct-badge";
        kind.textContent = item.label || item.kind;
        const ver = document.createElement("span");
        ver.className = "acct-cloud__meta";
        ver.textContent = `v${item.version}`;
        top.append(name, kind, ver);

        const urlText = document.createElement("code");
        urlText.className = "acct-cloud__url";
        urlText.textContent = item.liveUrl;

        const actions = document.createElement("div");
        actions.className = "acct-row";
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "btn btn--sm";
        copy.textContent = "Copy live link";
        bindCopy(copy, () => item.liveUrl, "Copy live link");

        const edit = document.createElement("a");
        edit.className = "btn btn--outline btn--sm";
        edit.href = item.editUrl;
        edit.textContent = "Edit";

        const del = document.createElement("button");
        del.type = "button";
        del.className = "btn btn--outline btn--sm acct-cloud__del";
        del.textContent = "Delete";
        del.addEventListener("click", async () => {
          if (del.dataset.armed !== "1") {
            del.dataset.armed = "1";
            del.textContent = "Confirm delete";
            return;
          }
          del.disabled = true;
          note.dataset.state = "";
          note.textContent = "Deleting…";
          try {
            const delRes = await fetch(`/api/cloud-overlays/${item.id}`, { method: "DELETE", credentials: "same-origin" });
            if (delRes.ok) {
              note.textContent = `Deleted “${item.name}”.`;
              loadCloudOverlays(plusOn);
            } else {
              note.dataset.state = "error";
              note.textContent = "Could not delete that overlay. Please try again.";
              del.disabled = false;
            }
          } catch {
            note.dataset.state = "error";
            note.textContent = "Could not reach Frills. Please try again.";
            del.disabled = false;
          }
        });

        actions.append(copy, edit, del);
        li.append(top, urlText, actions);

        if (plusOn && item.kind === "timer") {
          const timerRow = document.createElement("div");
          timerRow.className = "acct-row acct-cloud__timer";
          const controls = [
            ["Start", "start", 0],
            ["Pause", "pause", 0],
            ["Resume", "resume", 0],
            ["+1m", "add", 60],
            ["+5m", "add", 300],
            ["Reset", "reset", 0],
          ];
          for (const [label, cmd, value] of controls) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "btn btn--soft btn--sm";
            btn.textContent = label;
            btn.addEventListener("click", async () => {
              btn.disabled = true;
              try {
                const res = await fetch(`/api/cloud-overlays/${item.id}/timer`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  credentials: "same-origin",
                  body: JSON.stringify({ cmd, value }),
                });
                if (note) {
                  note.dataset.state = res.ok ? "" : "error";
                  note.textContent = res.ok
                    ? `Sent “${label}” to “${item.name}” — your Subathon Timer in OBS updates within a few seconds.`
                    : "Could not send timer command. Please try again.";
                }
              } catch {
                if (note) { note.dataset.state = "error"; note.textContent = "Could not reach Frills."; }
              } finally {
                btn.disabled = false;
              }
            });
            timerRow.append(btn);
          }
          li.append(timerRow);
        } else if (plusOn && item.kind === "tts") {
          const ttsRow = document.createElement("div");
          ttsRow.className = "acct-row acct-cloud__timer";
          const input = document.createElement("input");
          input.type = "text";
          input.maxLength = 160;
          input.placeholder = "Type a live pet announcement…";
          const speakBtn = document.createElement("button");
          speakBtn.type = "button";
          speakBtn.className = "btn btn--soft btn--sm";
          speakBtn.textContent = "Speak live";
          const clearBtn = document.createElement("button");
          clearBtn.type = "button";
          clearBtn.className = "btn btn--outline btn--sm";
          clearBtn.textContent = "Stop / Clear";
          const sendTtsCmd = async (action, text = "") => {
            try {
              const res = await fetch(`/api/cloud-overlays/${item.id}/cmd`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ action, text }),
              });
              if (note) {
                note.dataset.state = res.ok ? "" : "error";
                note.textContent = res.ok
                  ? `Sent to “${item.name}” — your Talking Pet in OBS responds within a few seconds.`
                  : "Could not send command.";
              }
              if (res.ok && action === "tts:say") input.value = "";
            } catch {
              if (note) { note.dataset.state = "error"; note.textContent = "Could not reach Frills."; }
            }
          };
          speakBtn.addEventListener("click", () => {
            const val = input.value.trim();
            if (val) void sendTtsCmd("tts:say", val);
          });
          clearBtn.addEventListener("click", () => void sendTtsCmd("tts:clear"));
          ttsRow.append(input, speakBtn, clearBtn);
          li.append(ttsRow);
        } else if (plusOn && item.kind === "actions") {
          const actRow = document.createElement("div");
          actRow.className = "acct-row acct-cloud__timer";
          let actRules = [];
          try {
            const sp = new URLSearchParams(item.query || "");
            const raw = sp.get("rules") || "";
            if (raw) {
              const norm = raw.replace(/-/g, "+").replace(/_/g, "/");
              const pad = norm.length % 4 ? "=".repeat(4 - (norm.length % 4)) : "";
              const bin = atob(norm + pad);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              const parsed = JSON.parse(new TextDecoder().decode(bytes));
              if (Array.isArray(parsed)) actRules = parsed.filter((r) => r && r.enabled !== false && r.id).slice(0, 20);
            }
          } catch { /* ignore */ }
          const buttons = actRules.map((r) => [String(r.name || r.id).slice(0, 24), "actions:run", String(r.id)]);
          buttons.push(["Clear Queue", "actions:clear", ""]);
          for (const [label, action, text] of buttons) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "btn btn--soft btn--sm";
            btn.textContent = label;
            btn.addEventListener("click", async () => {
              btn.disabled = true;
              try {
                const res = await fetch(`/api/cloud-overlays/${item.id}/cmd`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  credentials: "same-origin",
                  body: JSON.stringify({ action, text }),
                });
                if (note) {
                  note.dataset.state = res.ok ? "" : "error";
                  note.textContent = res.ok
                    ? `Sent “${label}” to “${item.name}” — OBS responds within a few seconds.`
                    : "Could not send command.";
                }
              } catch {
                if (note) { note.dataset.state = "error"; note.textContent = "Could not reach Frills."; }
              } finally {
                btn.disabled = false;
              }
            });
            actRow.append(btn);
          }
          li.append(actRow);
        } else if (plusOn && (item.kind === "alerts" || item.kind === "jar" || item.kind === "wheel" || item.kind === "goal" || item.kind === "gifters" || item.kind === "likers")) {
          const deckRow = document.createElement("div");
          deckRow.className = "acct-row acct-cloud__timer";
          const deckBtns = item.kind === "alerts"
            ? [["Test Gift Alert", "alerts:gift", 0], ["Test Sub Alert", "alerts:sub", 0]]
            : item.kind === "jar"
              ? [["+100 Drop", "jar:drop", 100], ["Fill & Celebrate", "jar:fill", 0], ["Empty Jar", "jar:clear", 0]]
              : item.kind === "wheel"
                ? [["Spin Wheel Now", "wheel:spin", 0], ["Clear Queue", "wheel:clear", 0]]
                : item.kind === "goal"
                  ? [["+1", "goal:add", 1], ["+10", "goal:add", 10], ["Celebrate Goal", "goal:reach", 0], ["Reset", "goal:reset", 0]]
                  : item.kind === "gifters"
                    ? [["Reset leaderboard", "gifters:reset", 0]]
                    : [["Reset leaderboard", "likers:reset", 0]];
          for (const [label, action, value] of deckBtns) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "btn btn--soft btn--sm";
            btn.textContent = label;
            btn.addEventListener("click", async () => {
              btn.disabled = true;
              try {
                const res = await fetch(`/api/cloud-overlays/${item.id}/cmd`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  credentials: "same-origin",
                  body: JSON.stringify({ action, value }),
                });
                if (note) {
                  note.dataset.state = res.ok ? "" : "error";
                  note.textContent = res.ok
                    ? `Sent “${label}” to “${item.name}” — OBS updates within a few seconds.`
                    : "Could not send command.";
                }
              } catch {
                if (note) { note.dataset.state = "error"; note.textContent = "Could not reach Frills."; }
              } finally {
                btn.disabled = false;
              }
            });
            deckRow.append(btn);
          }
          li.append(deckRow);
        }

        list.append(li);
      }

      renderSceneBuilder(plusOn, items);
      renderRecapBuilder(plusOn, data.recap);
    } catch {
      section.hidden = true;
    }
  };

  let recapBound = false;
  let recapChannel = "";
  const RECAP_PALETTES = {
    matcha: { bg: "#f7f4ec", card: "#ffffff", border: "#161b22", ink: "#161b22", sub: "#4b525c", accent: "#f6ce00", pop: "#ff4f73" },
    night: { bg: "#141824", card: "#1e2438", border: "#9db4ff", ink: "#f8f6f0", sub: "#b8c2dc", accent: "#ffd166", pop: "#49d193" },
    bubblegum: { bg: "#1d0c24", card: "#2d1438", border: "#ff5fc8", ink: "#fff0fa", sub: "#e0b3d6", accent: "#58f0ff", pop: "#ff5fc8" },
  };
  const drawRecapCard = (canvasEl = $("acct-recap-canvas"), outScale = 1) => {
    if (!canvasEl || !canvasEl.getContext) return;
    const fmt = $("acct-recap-format")?.value === "16x9" ? "16x9" : "9x16";
    const pal = RECAP_PALETTES[$("acct-recap-theme")?.value] ?? RECAP_PALETTES.matcha;
    const logicalW = fmt === "16x9" ? 800 : 540;
    const logicalH = fmt === "16x9" ? 450 : 960;
    const targetW = logicalW * outScale;
    const targetH = logicalH * outScale;
    if (canvasEl.width !== targetW || canvasEl.height !== targetH) {
      canvasEl.width = targetW;
      canvasEl.height = targetH;
    }
    const ctx = canvasEl.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.scale(outScale, outScale);
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, logicalW, logicalH);

    // Accent strip along bottom
    ctx.fillStyle = pal.accent;
    ctx.fillRect(0, logicalH - 18, logicalW, 18);

    const headline = ($("acct-recap-title")?.value || "").trim() || "Tonight’s Stream MVPs";
    const gifterLine = ($("acct-recap-gifter")?.value || "").trim() || "No gifts recorded yet";
    const likerLine = ($("acct-recap-liker")?.value || "").trim() || "No likes recorded yet";
    const goalLine = ($("acct-recap-goal")?.value || "").trim() || "Stream goal completed!";
    const pad = fmt === "16x9" ? 40 : 34;

    ctx.fillStyle = pal.pop;
    ctx.font = `800 ${fmt === "16x9" ? 15 : 16}px "JetBrains Mono", monospace`;
    ctx.fillText(recapChannel ? `LIVE RECAP · @${recapChannel.toUpperCase()}` : "FRILLS PLUS · STREAM RECAP", pad, fmt === "16x9" ? 44 : 58);

    ctx.fillStyle = pal.ink;
    ctx.font = `800 ${fmt === "16x9" ? 36 : 42}px system-ui, sans-serif`;
    ctx.fillText(headline.slice(0, 32), pad, fmt === "16x9" ? 90 : 114);

    const rows = [
      ["#1 TOP GIFTER / SUB", gifterLine],
      ["#1 TOP SUPPORTER / LIKES", likerLine],
      ["STREAM HIGHLIGHT", goalLine],
    ];
    if (fmt === "16x9") {
      const cardW = (logicalW - pad * 2 - 28) / 3;
      const cardY = 132;
      const cardH = 228;
      rows.forEach(([k, v], i) => {
        const x = pad + i * (cardW + 14);
        ctx.fillStyle = pal.card;
        ctx.strokeStyle = pal.border;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(x, cardY, cardW, cardH, 18);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = pal.pop;
        ctx.font = '800 12px "JetBrains Mono", monospace';
        ctx.fillText(k, x + 16, cardY + 34);
        ctx.fillStyle = pal.ink;
        ctx.font = "800 20px system-ui, sans-serif";
        ctx.fillText(v.slice(0, 22), x + 16, cardY + 86);
        if (v.length > 22) ctx.fillText(v.slice(22, 46), x + 16, cardY + 116);
      });
    } else {
      let y = 170;
      const cardW = logicalW - pad * 2;
      const cardH = 195;
      rows.forEach(([k, v]) => {
        ctx.fillStyle = pal.card;
        ctx.strokeStyle = pal.border;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(pad, y, cardW, cardH, 22);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = pal.pop;
        ctx.font = '800 14px "JetBrains Mono", monospace';
        ctx.fillText(k, pad + 24, y + 42);
        ctx.fillStyle = pal.ink;
        ctx.font = "800 26px system-ui, sans-serif";
        ctx.fillText(v.slice(0, 28), pad + 24, y + 98);
        if (v.length > 28) {
          ctx.fillStyle = pal.sub;
          ctx.font = "700 20px system-ui, sans-serif";
          ctx.fillText(v.slice(28, 60), pad + 24, y + 136);
        }
        y += cardH + 22;
      });
    }

    ctx.fillStyle = pal.sub;
    ctx.font = '700 13px "JetBrains Mono", monospace';
    ctx.fillText("MADE WITH FRILLS.VALWIDGETS.LIVE", pad, logicalH - 36);
    ctx.restore();
  };

  const renderRecapBuilder = (plusOn, recap) => {
    const box = $("acct-recap-box");
    if (!box) return;
    box.hidden = !plusOn;
    if (!plusOn) return;
    if (recap?.channel) recapChannel = recap.channel;
    if (recap?.topGifters?.[0] && !$("acct-recap-gifter")?.value) {
      $("acct-recap-gifter").value = `${recap.topGifters[0].name} · ${recap.topGifters[0].label}`;
    }
    if (recap?.topLikers?.[0] && !$("acct-recap-liker")?.value) {
      $("acct-recap-liker").value = `${recap.topLikers[0].name} · ${recap.topLikers[0].label}`;
    }
    const highlight = recap?.jar?.label || recap?.goal?.label || "";
    if (highlight && !$("acct-recap-goal")?.value) {
      $("acct-recap-goal").value = highlight;
    }
    drawRecapCard();
    if (!recapBound) {
      recapBound = true;
      for (const id of ["acct-recap-format", "acct-recap-theme", "acct-recap-title", "acct-recap-gifter", "acct-recap-liker", "acct-recap-goal"]) {
        $(id)?.addEventListener("input", () => drawRecapCard());
        $(id)?.addEventListener("change", () => drawRecapCard());
      }
      $("acct-recap-download")?.addEventListener("click", () => {
        const off = document.createElement("canvas");
        drawRecapCard(off, 2);
        const a = document.createElement("a");
        a.download = "frills-stream-recap.png";
        a.href = off.toDataURL("image/png");
        a.click();
      });
    }
  };

  let sceneSaveBound = false;
  let activeSceneId = "";
  const SCENE_SLOTS = [
    ["tl", "Top-Left"],
    ["tc", "Top-Center"],
    ["tr", "Top-Right"],
    ["ml", "Middle-Left"],
    ["mc", "Center"],
    ["mr", "Middle-Right"],
    ["bl", "Bottom-Left"],
    ["bc", "Bottom-Center"],
    ["br", "Bottom-Right"],
  ];
  const DEFAULT_SLOT_BY_KIND = {
    chat: "bl",
    matcha: "bl",
    alerts: "tc",
    jar: "br",
    goal: "tr",
    timer: "tl",
    tts: "bc",
    gifters: "mr",
    likers: "mr",
    gifts: "ml",
    counter: "tl",
    labels: "bc",
    songs: "br",
  };
  const renderSceneBuilder = (plusOn, items) => {
    const box = $("acct-scene-box");
    const layersEl = $("acct-scene-layers");
    const linkWrap = $("acct-scene-link-wrap");
    const urlOut = $("acct-scene-url");
    if (!box || !layersEl) return;
    const childItems = items.filter((o) => o.kind !== "scene");
    box.hidden = !(plusOn && childItems.length > 0);
    if (box.hidden) return;

    const existingScene = items.find((o) => o.kind === "scene") ?? null;
    activeSceneId = existingScene?.id ?? "";
    if ($("acct-scene-name") && existingScene?.name) $("acct-scene-name").value = existingScene.name;
    const savedMap = new Map();
    if (existingScene?.query) {
      const sp = new URLSearchParams(existingScene.query);
      if ($("acct-scene-aspect")) $("acct-scene-aspect").value = sp.get("aspect") === "9x16" ? "9x16" : "16x9";
      for (const pair of String(sp.get("items") ?? "").split(",")) {
        const [cid, slot] = pair.trim().split(":");
        if (cid && slot) savedMap.set(cid, slot);
      }
    }
    if (linkWrap && urlOut) {
      linkWrap.hidden = !existingScene;
      if (existingScene) urlOut.textContent = existingScene.liveUrl;
    }

    layersEl.replaceChildren();
    for (const child of childItems) {
      const row = document.createElement("div");
      row.className = "acct-scene__row";
      row.dataset.layerId = child.id;

      const label = document.createElement("label");
      label.className = "acct-scene__pick";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = existingScene ? savedMap.has(child.id) : true;
      label.append(cb, document.createTextNode(`${child.name} (${child.label || child.kind})`));

      const sel = document.createElement("select");
      sel.setAttribute("aria-label", `Screen zone for ${child.name}`);
      for (const [val, textLabel] of SCENE_SLOTS) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = textLabel;
        sel.append(opt);
      }
      sel.value = savedMap.get(child.id) || DEFAULT_SLOT_BY_KIND[child.kind] || "mc";
      row.append(label, sel);
      layersEl.append(row);
    }

    if (!sceneSaveBound) {
      sceneSaveBound = true;
      bindCopy($("acct-scene-copy"), () => $("acct-scene-url")?.textContent || "", "Copy scene link");
      $("acct-scene-save")?.addEventListener("click", async () => {
        const btn = $("acct-scene-save");
        const note = $("acct-cloud-status");
        const picked = [];
        for (const r of layersEl.querySelectorAll(".acct-scene__row")) {
          const cb = r.querySelector("input[type='checkbox']");
          const sel = r.querySelector("select");
          if (cb?.checked && r.dataset.layerId) picked.push(`${r.dataset.layerId}:${sel?.value || "mc"}`);
        }
        if (!picked.length) {
          if (note) { note.dataset.state = "error"; note.textContent = "Select at least one overlay to include in your Master Scene."; }
          return;
        }
        const name = ($("acct-scene-name")?.value || "").trim() || "Main Stream Scene";
        const aspect = $("acct-scene-aspect")?.value === "9x16" ? "9x16" : "16x9";
        const query = `aspect=${aspect}&items=${picked.join(",")}`;
        btn.disabled = true;
        try {
          const res = await fetch(activeSceneId ? `/api/cloud-overlays/${activeSceneId}` : "/api/cloud-overlays", {
            method: activeSceneId ? "PUT" : "POST",
            headers: { "content-type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify(activeSceneId ? { name, query } : { kind: "scene", name, query }),
          });
          const data = await res.json().catch(() => null);
          if (res.ok && data?.overlay) {
            activeSceneId = data.overlay.id;
            if (linkWrap && urlOut) { linkWrap.hidden = false; urlOut.textContent = data.overlay.liveUrl; }
            if (note) { note.dataset.state = ""; note.textContent = `Saved Master Scene (v${data.overlay.version}) — paste ${data.overlay.liveUrl} into OBS once.`; }
            await loadCloudOverlays(true);
          } else if (note) {
            note.dataset.state = "error";
            note.textContent = "Could not save Master Scene right now.";
          }
        } catch {
          if (note) { note.dataset.state = "error"; note.textContent = "Could not reach Frills."; }
        } finally {
          btn.disabled = false;
        }
      });
    }
  };

  // Coming back from paying (the product's confirmation page is /account/?welcome=1): the payment notice from Polar can take a few seconds, so ask again until Plus is on.
  const confirmPayment = async () => {
    const note = $("acct-buy-status");
    note.dataset.state = "";
    note.textContent = "Thank you! Confirming your payment…";
    for (let tries = 0; tries < 30; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        const me = await (await fetch("/api/account/me", { credentials: "same-origin" })).json();
        if (me.signedIn && me.plus?.active) {
          showPlus(me);
          note.textContent = "Your payment is confirmed. Frills Plus is on. Follow the steps below to switch it on in OBS.";
          // A new subscriber with no code yet gets one now: one less step to forget. (With a code already made somewhere else, making another would end it, so that stays a button.)
          if (!me.overlayLink) $("acct-code-make")?.click();
          $("acct-setup")?.scrollIntoView?.({ block: "start", behavior: "smooth" });
          return;
        }
      } catch { /* try again */ }
    }
    note.dataset.state = "error";
    note.textContent = "We have not heard about your payment yet. It can take a few minutes: reload this page in a little while. If Plus is still off after that, check your email for your receipt and get in touch.";
  };

  $("acct-theme-apply")?.addEventListener("click", async () => {
    const btn = $("acct-theme-apply");
    const pick = $("acct-theme-pick");
    const note = $("acct-cloud-status");
    if (!btn || !pick) return;
    btn.disabled = true;
    try {
      const res = await fetch("/api/cloud-overlays/theme", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ theme: pick.value }),
      });
      const data = await res.json().catch(() => null);
      if (note) {
        note.dataset.state = res.ok ? "" : "error";
        note.textContent = res.ok
          ? `Applied theme to ${data?.updated ?? 0} live cloud overlay(s) — OBS updates within a few seconds.`
          : "Could not apply theme. Please try again.";
      }
      if (res.ok) await loadCloudOverlays(true);
    } catch {
      if (note) { note.dataset.state = "error"; note.textContent = "Could not reach Frills."; }
    } finally {
      btn.disabled = false;
    }
  });

  $("acct-setup-hide")?.addEventListener("click", () => { setFlag(SETUP.hidden, true); renderSetup(lastMe); });

  $("acct-buy").addEventListener("click", () => void launchCheckout($("acct-buy"), $("acct-buy-status")));

  $("acct-manage").addEventListener("click", async () => {
    const button = $("acct-manage");
    const note = $("acct-buy-status");
    button.disabled = true;
    note.dataset.state = "";
    note.textContent = "Opening your billing page…";
    try {
      const res = await post("portal");
      if (res.ok && res.body.ok === true && typeof res.body.url === "string") { location.assign(res.body.url); return; }
      note.dataset.state = "error";
      note.textContent = WORDS[res.body.error] ?? "Sorry, the billing page did not open. Please try again.";
    } catch {
      note.dataset.state = "error";
      note.textContent = "Sorry, the billing page did not open. Check your connection and try again.";
    }
    button.disabled = false;
  });

  $("acct-code-make")?.addEventListener("click", async () => {
    const button = $("acct-code-make");
    const note = $("acct-code-status");
    button.disabled = true;
    note.dataset.state = "";
    note.textContent = "Activating…";
    try {
      const res = await post("overlay-link");
      if (res.ok && res.body.code) {
        savePlusCode(res.body.code);
        clearRelayTicketCache();
        note.textContent = "Ready. Any TikTok overlay link you copy from an editor or Quick start now uses your dedicated Frills Plus server.";
        const me = await (await fetch("/api/account/me", { credentials: "same-origin" })).json();
        if (me?.signedIn) showPlus(me);
      } else {
        note.dataset.state = "error";
        note.textContent = WORDS[res.body.error] ?? "Sorry, that did not work. Please try again.";
      }
    } catch {
      note.dataset.state = "error";
      note.textContent = "Sorry, that did not work. Check your connection and try again.";
    } finally {
      button.disabled = false;
    }
  });

  $("acct-code-off")?.addEventListener("click", async () => {
    const button = $("acct-code-off");
    const note = $("acct-code-status");
    button.disabled = true;
    note.dataset.state = "";
    try {
      await post("overlay-link-off");
      clearPlusCode();
      clearRelayTicketCache();
      note.textContent = "Your Plus code is off. Existing overlays fall back to the free server and free browser voices.";
      const me = await (await fetch("/api/account/me", { credentials: "same-origin" })).json();
      if (me?.signedIn) showPlus(me);
    } catch {
      note.dataset.state = "error";
      note.textContent = "Sorry, that did not work. Please try again.";
    } finally {
      button.disabled = false;
    }
  });

  $("acct-out-all").addEventListener("click", async () => {
    const button = $("acct-out-all");
    button.disabled = true;
    try {
      await post("logout-all");
      clearPlusCode();
      forgetSetup();
      clearRelayTicketCache();
      show("acct-form");
      say("You were signed out on every device.");
      email.focus();
    } catch {
      $("acct-out-status").textContent = "Sorry, that did not work. Please try again.";
    } finally {
      button.disabled = false;
    }
  });

  $("acct-delete-go").addEventListener("click", async () => {
    const button = $("acct-delete-go");
    const note = $("acct-delete-status");
    const typed = $("acct-delete-email").value.trim();
    note.dataset.state = "";
    if (!typed) { note.dataset.state = "error"; note.textContent = WORDS.confirm_mismatch; $("acct-delete-email").focus(); return; }
    button.disabled = true;
    note.textContent = "Deleting…";
    try {
      const res = await post("delete", { email: typed });
      if (res.ok && res.body.ok === true) {
        clearPlusCode();
      forgetSetup();
        clearRelayTicketCache();
        $("acct-delete-email").value = "";
        $("acct-delete").open = false;
        note.textContent = "";
        button.disabled = false;
        show("acct-form");
        say("Your account and its data were deleted.");
        return;
      }
      note.dataset.state = "error";
      note.textContent = WORDS[res.body.error] ?? "Sorry, that did not work. Please try again.";
    } catch {
      note.dataset.state = "error";
      note.textContent = "Sorry, that did not work. Check your connection and try again.";
    }
    button.disabled = false;
  });

  fetch("/api/account/me", { credentials: "same-origin" })
    .then((res) => res.json())
    .then((me) => {
      if (me.signedIn) {
        $("acct-who").textContent = me.email;
        showPlus(me);
        show("acct-in");
        if (new URLSearchParams(location.search).get("welcome") === "1" && !me.plus?.active) confirmPayment();
      }
      else show("acct-form");
    })
    .catch(() => { show("acct-form"); say("We could not check whether you are signed in.", true); });
}

// ── /account/verify/ (the link in the email: the token is after the #, which is never sent to a server) ───────────────────
if ($("verify-go")) {
  const token = location.hash.slice(1);
  history.replaceState(null, "", location.pathname); // the token is not kept in the address bar or the history
  const bad = (title, body) => {
    $("verify-ready").hidden = true;
    if (title) $("verify-bad-title").textContent = title;
    if (body) $("verify-bad-body").textContent = body;
    $("verify-bad").hidden = false;
    $("verify-bad").focus();
  };
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    bad("This is not a sign-in link.", "Ask for a new one and open the link from the email.");
  } else {
    $("verify-ready").hidden = false;
    $("verify-go").addEventListener("click", async () => {
      $("verify-go").disabled = true;
      $("verify-status").textContent = "Signing in…";
      try {
        const res = await post("verify", { token });
        if (res.ok && res.body.ok === true) { location.replace("/account/"); return; }
        $("verify-status").textContent = "";
        bad(res.body.error === "invalid_link" || !res.body.error ? undefined : "We could not sign you in.", WORDS[res.body.error]);
      } catch {
        $("verify-status").textContent = "Sorry, that did not work. Check your connection and press the button again.";
        $("verify-go").disabled = false;
      }
    });
  }
}

// ── /plus/ (inline sign-in + direct 1-click Polar checkout inside the plan card) ────────────────────────────
if ($("plus-direct-buy") && $("plus-inline-form")) {
  const ctaLink = $("plus-cta-link");
  const directBuy = $("plus-direct-buy");
  const inlineForm = $("plus-inline-form");
  const inlineEmail = $("plus-inline-email");
  const inlineSend = $("plus-inline-send");
  const cardStatus = $("plus-card-status");
  const sayCard = (text, bad = false) => {
    cardStatus.hidden = !text;
    cardStatus.dataset.state = bad ? "error" : "";
    cardStatus.textContent = text;
  };
  const setLinkLabel = (label) => {
    if (!ctaLink) return;
    const arrow = ctaLink.querySelector(".btn__arrow")?.cloneNode(true);
    ctaLink.textContent = `${label} `;
    if (arrow) ctaLink.append(arrow);
  };

  directBuy.addEventListener("click", () => void launchCheckout(directBuy, cardStatus));

  inlineForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const address = inlineEmail.value.trim();
    if (!validEmail(address)) {
      inlineEmail.setAttribute("aria-invalid", "true");
      sayCard(WORDS.bad_email, true);
      inlineEmail.focus();
      return;
    }
    inlineEmail.removeAttribute("aria-invalid");
    inlineSend.disabled = true;
    sayCard("Sending sign-in link…");
    try {
      const problem = await askLogin(address);
      if (problem) { sayCard(problem, true); return; }
      sayCard(`Check your inbox — we sent a sign-in link to ${address}. Open it to finish signing in (check spam if needed).`);
    } catch {
      sayCard("Sorry, that did not send. Check your connection and try again.", true);
    } finally {
      inlineSend.disabled = false;
    }
  });

  fetch("/api/account/me", { credentials: "same-origin" })
    .then((res) => (res.ok ? res.json() : null))
    .then((me) => {
      if (!me?.ok) return;
      if (me.signedIn) {
        if (me.plus?.active) {
          setLinkLabel("Manage Frills Plus");
          return;
        }
        if (canBuy(me)) {
          if (ctaLink) ctaLink.hidden = true;
          directBuy.hidden = false;
          return;
        }
        setLinkLabel("Open my account");
        return;
      }
      if (ctaLink) ctaLink.hidden = true;
      inlineForm.hidden = false;
    })
    .catch(() => {});
}
