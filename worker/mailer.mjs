// Sending the sign-in email. Which email service Frills will use is not decided, so there is no real sender here yet: only the two that need no service.
//   - a mailer handed in by a test (anything with send({ to, subject, text })), and
//   - the local development mailer, which sends nothing and writes each message down in env.OUTBOX so the local server (and its tests) can read the link.
// With neither (the live site today) `getMailer` is null and the sign-in route answers "email_off", so nothing pretends to send mail it cannot.

/** The mailer for this request, or null if there is none. `given` is a mailer a test passes in. */
export function getMailer(env, given = null) {
  if (given) return given;
  if (env?.MAILER) return env.MAILER;
  if (env?.DEV) {
    env.OUTBOX = env.OUTBOX ?? [];
    return {
      async send(message) {
        env.OUTBOX.push({ ...message, at: Date.now() });
        if (env.OUTBOX.length > 50) env.OUTBOX.shift();
        return { ok: true };
      },
    };
  }
  return null;
}

/** The words of the sign-in email: plain text only, the link, how long it lasts, and what to do if it was not asked for. */
export function signInMessage(email, link) {
  return {
    to: email,
    subject: "Your Frills sign-in link",
    text: [
      "Here is your link to sign in to Frills:",
      "",
      link,
      "",
      "It works once, for 15 minutes. Open it on the same device you asked from.",
      "",
      "If you did not ask for this, ignore this email: nobody can sign in without the link, and nothing has changed.",
    ].join("\n"),
  };
}
