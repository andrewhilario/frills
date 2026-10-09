// The feedback form: checks the message, sends it as JSON to this site's own /api/feedback, and says what happened.
// Nothing is kept in the browser. If sending fails the person's words stay in the form.

const form = document.getElementById("feedback-form");
const message = document.getElementById("fb-message");
const status = document.getElementById("fb-status");
const send = document.getElementById("fb-send");
const thanks = document.getElementById("fb-thanks");
const again = document.getElementById("fb-again");
const opened = Date.now(); // a person takes a while to write; the server treats a form sent within a second or so as a bot

const WORDS = {
  too_short: "Please write a little more, at least 10 characters.",
  too_long: "That is a bit long. Please keep it under 2,000 characters.",
  busy: "We are getting a lot of messages right now. Please try again in a few minutes.",
  not_ready: "Feedback is not working right now. Please try again later.",
};

const say = (text, bad = false) => {
  status.textContent = text;
  status.dataset.state = bad ? "error" : "";
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (message.value.trim().length < 10) {
    message.setAttribute("aria-invalid", "true");
    say(WORDS.too_short, true);
    message.focus();
    return;
  }
  message.removeAttribute("aria-invalid");
  const data = new FormData(form);
  send.disabled = true;
  say("Sending…");
  try {
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: data.get("kind"),
        app: data.get("app"),
        message: data.get("message"),
        contact: data.get("contact"),
        website: data.get("website"),
        took: Date.now() - opened,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok !== true) {
      say(WORDS[body.error] ?? "Sorry, that did not send. Please try again.", true);
      return;
    }
    form.hidden = true;
    thanks.hidden = false;
    thanks.focus();
  } catch {
    say("Sorry, that did not send. Check your connection and try again.", true);
  } finally {
    send.disabled = false;
  }
});

again.addEventListener("click", () => {
  form.reset();
  say("");
  thanks.hidden = true;
  form.hidden = false;
  message.focus();
});
