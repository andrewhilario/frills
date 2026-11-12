// The account pages: ask for a sign-in link, finish signing in from the link, see who is signed in, sign out. Both pages use this file; each part runs
// only if its page elements are there. The cookie that keeps a person signed in is set by the server and cannot be read from here (HttpOnly).

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
  already_plus: "Frills Plus is already on for this account.",
  sign_in_first: "Please sign in first.",
};
const RESEND_SECONDS = 30;

// ── /account/ ─────────────────────────────────────────────────────────────────────────────────────────
if ($("acct-form")) {
  const form = $("acct-form");
  const email = $("acct-email");
  const status = $("acct-status");
  const send = $("acct-send");
  const say = (text, bad = false) => { status.textContent = text; status.dataset.state = bad ? "error" : ""; };
  const show = (which) => { for (const id of ["acct-loading", "acct-form", "acct-sent", "acct-in"]) $(id).hidden = id !== which; };

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
      show("acct-form");
      email.focus();
    } catch {
      $("acct-out-status").textContent = "Sorry, that did not work. Please try again.";
    } finally {
      $("acct-out").disabled = false;
    }
  });

  // What the Frills Plus panel says and whether it offers the button: on already, on sale, or not on sale yet.
  const showPlus = (me) => {
    const on = me.plus?.status === "active";
    $("acct-plus-state").textContent = on ? "Frills Plus is on for this account." : me.checkout ? "You do not have Frills Plus. It is a paid plan that adds extras to Frills." : "Frills Plus is not on sale yet.";
    $("acct-buy").hidden = on || !me.checkout;
    $("acct-buy-hint").hidden = on || !me.checkout;
  };
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

  fetch("/api/account/me", { credentials: "same-origin" })
    .then((res) => res.json())
    .then((me) => {
      if (me.signedIn) { $("acct-who").textContent = me.email; showPlus(me); show("acct-in"); }
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
