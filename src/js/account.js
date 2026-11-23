// The account pages: ask for a sign-in link, finish signing in from the link, see who is signed in, sign out. Both pages use this file; each part runs
// only if its page elements are there. The cookie that keeps a person signed in is set by the server and cannot be read from here (HttpOnly).

import { clearPlusCode, clearRelayTicketCache, savePlusCode, savedPlusCode } from "./plus-relay.js";

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

  const ask = async (address) => {
    const res = await post("login", { email: address });
    if (!res.ok || res.body.ok !== true) return WORDS[res.body.error] ?? "Sorry, that did not work. Please try again.";
    return "";
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      email.setAttribute("aria-invalid", "true");
      say(WORDS.bad_email, true);
      email.focus();
      return;
    }
    email.removeAttribute("aria-invalid");
    send.disabled = true;
    say("Sending…");
    try {
      const problem = await ask(address);
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
      const problem = await ask($("acct-sent-to").textContent);
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
  const canBuy = (me) => Boolean(me.checkout) && !me.plus?.active && !["paused", "unpaid"].includes(me.plus?.status);
  const showPlus = (me) => {
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
    $("acct-buy").hidden = !canBuy(me);
    $("acct-buy-hint").hidden = !canBuy(me);
    const promoEl = $("acct-promo");
    if (promoEl) promoEl.hidden = !canBuy(me) || !promoEl.textContent.trim();
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
        } else if (plusOn && (item.kind === "jar" || item.kind === "goal" || item.kind === "gifters" || item.kind === "likers")) {
          const deckRow = document.createElement("div");
          deckRow.className = "acct-row acct-cloud__timer";
          const deckBtns = item.kind === "jar"
            ? [["+100 Drop", "jar:drop", 100], ["Fill & Celebrate", "jar:fill", 0], ["Empty Jar", "jar:clear", 0]]
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
    } catch {
      section.hidden = true;
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
        if (me.signedIn && me.plus?.active) { showPlus(me); note.textContent = "Your payment is confirmed. Frills Plus is on."; return; }
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

  $("acct-buy").addEventListener("click", async () => {
    const button = $("acct-buy");
    const note = $("acct-buy-status");
    button.disabled = true;
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
  });

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
