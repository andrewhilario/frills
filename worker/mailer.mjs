// Sending the sign-in email (Resend in production, local outbox in dev, or an injected test mailer).
//   - a mailer handed in by a test (anything with send({ to, subject, text, html })),
//   - the local development mailer (env.DEV without RESEND_LIVE), which sends nothing and writes each message into env.OUTBOX so the local server and tests can read the link, and
//   - Resend (https://api.resend.com/emails) when RESEND_API_KEY is set in Cloudflare Worker secrets.
// With none of those configured, `getMailer` returns null and the sign-in route answers "email_off", so nothing pretends to send mail it cannot.

export const DEFAULT_FROM = "Frills <noreply@valwidgets.live>";
export const RESEND_URL = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 8000;

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Validates MAIL_FROM against header injection and falls back cleanly to DEFAULT_FROM. */
export function resolveFrom(raw) {
  const clean = String(raw ?? "").trim();
  if (!clean || clean.length > 254 || /[\r\n]/.test(clean) || !clean.includes("@")) return DEFAULT_FROM;
  return clean;
}

/** Sends transactional sign-in mail through Resend's REST API (zero dependencies, Cloudflare Workers compatible). */
export function resendMailer({ apiKey, from = DEFAULT_FROM, fetchFn = globalThis.fetch } = {}) {
  const key = String(apiKey ?? "").trim();
  const sender = resolveFrom(from);
  return {
    async send(message) {
      if (!key || !message?.to || !message?.subject || !message?.text) return { ok: false, status: 0 };
      const payload = {
        from: sender,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      };
      const init = {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          "user-agent": "frills-worker",
        },
        body: JSON.stringify(payload),
      };
      if (typeof AbortSignal?.timeout === "function") init.signal = AbortSignal.timeout(SEND_TIMEOUT_MS);
      let res;
      try {
        res = await fetchFn(RESEND_URL, init);
      } catch {
        return { ok: false, status: 0 };
      }
      if (!res?.ok) return { ok: false, status: Number(res?.status ?? 0) };
      let id = "";
      try {
        const data = await res.json();
        if (typeof data?.id === "string") id = data.id;
      } catch { /* empty or non-JSON 2xx is still accepted */ }
      return { ok: true, id };
    },
  };
}

/** The mailer for this request, or null if there is none. `given` is a mailer a test passes in. */
export function getMailer(env, given = null, { fetchFn = globalThis.fetch } = {}) {
  if (given) return given;
  if (env?.MAILER) return env.MAILER;
  if (env?.DEV && !env?.RESEND_LIVE) {
    env.OUTBOX = env.OUTBOX ?? [];
    return {
      async send(message) {
        env.OUTBOX.push({ ...message, at: Date.now() });
        if (env.OUTBOX.length > 50) env.OUTBOX.shift();
        return { ok: true };
      },
    };
  }
  const apiKey = String(env?.RESEND_API_KEY ?? "").trim();
  if (apiKey) return resendMailer({ apiKey, from: resolveFrom(env?.MAIL_FROM), fetchFn });
  return null;
}

/** The sign-in email: plain text (always) plus clean minimal HTML for modern inboxes. */
export function signInMessage(email, link) {
  const safeHref = /^https?:\/\//i.test(String(link)) ? escapeHtml(link) : "";
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
    html: [
      "<!doctype html>",
      '<html lang="en"><body style="margin:0;padding:24px;background:#faf8f2;color:#12171b;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;line-height:1.5;">',
      '<div style="max-width:480px;margin:0 auto;padding:28px;background:#ffffff;border:2px solid #12171b;border-radius:16px;">',
      '<p style="margin:0 0 12px;font-size:18px;font-weight:800;letter-spacing:-0.01em;">Frills</p>',
      '<p style="margin:0 0 20px;font-size:15px;">Press the button below to finish signing in to your Frills account.</p>',
      safeHref
        ? `<p style="margin:0 0 20px;"><a href="${safeHref}" style="display:inline-block;padding:12px 20px;background:#f6ce00;color:#12171b;font-weight:700;font-size:15px;text-decoration:none;border:2px solid #12171b;border-radius:999px;">Sign in to Frills &rarr;</a></p>`
        : "",
      '<p style="margin:0 0 14px;font-size:13px;color:#4a5560;">This link works once, for 15 minutes. Open it on the same device you asked from.</p>',
      safeHref
        ? `<p style="margin:0 0 18px;font-size:12px;color:#4a5560;word-break:break-all;">Or copy and paste this address:<br><a href="${safeHref}" style="color:#0b57d0;">${safeHref}</a></p>`
        : "",
      '<hr style="border:0;border-top:1px dashed #d6d0c4;margin:18px 0;">',
      '<p style="margin:0;font-size:12px;color:#5c6670;">If you did not ask for this, ignore this email: nobody can sign in without the link, and nothing has changed.</p>',
      "</div></body></html>",
    ].join(""),
  };
}

/** "Your Frills Plus subscription is active": sent by the owner from the admin page to a customer whose Plus is active. It reads as an ordinary subscription confirmation and says what to do, in order. */
export function plusOnMessage(email, siteBase) {
  const site = String(siteBase ?? "").replace(/\/+$/, "");
  const account = `${site}/account/`;
  const start = `${site}/start/`;
  const guide = `${site}/guides/plus/`;
  const feedback = `${site}/feedback/`;
  const who = escapeHtml(email);
  const button = (href, label) => `<a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;background:#f6ce00;color:#12171b;font-weight:700;font-size:15px;text-decoration:none;border:2px solid #12171b;border-radius:999px;">${label}</a>`;
  const link = (href) => `<a href="${escapeHtml(href)}" style="color:#0b57d0;">${escapeHtml(href)}</a>`;
  return {
    to: email,
    subject: "Your Frills Plus subscription is active",
    text: [
      "Hi,",
      "",
      `Thank you for subscribing to Frills Plus. Your subscription is now active on ${email}.`,
      "",
      "To start using it, do these three things once:",
      "",
      `1. Sign in at ${account} with this email. We send you a link, so there is no password.`,
      '2. Press "Activate on this browser" under "Dedicated TikTok server & overlay code".',
      `3. Copy your overlay links again from ${start} (or from any editor) and paste them over the old ones in OBS or TikTok LIVE Studio. A link you copied before still uses the free connection.`,
      "",
      `A step-by-step guide to every Plus feature is here: ${guide}`,
      "",
      `Need help? Tell us what you pressed and what you saw: ${feedback}`,
      "",
      "Frills",
    ].join("\n"),
    html: [
      "<!doctype html>",
      '<html lang="en"><body style="margin:0;padding:24px;background:#faf8f2;color:#12171b;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;line-height:1.5;">',
      '<div style="max-width:480px;margin:0 auto;padding:28px;background:#ffffff;border:2px solid #12171b;border-radius:16px;">',
      '<p style="margin:0 0 12px;font-size:18px;font-weight:800;letter-spacing:-0.01em;">Frills</p>',
      `<p style="margin:0 0 16px;font-size:15px;">Thank you for subscribing to Frills Plus. Your subscription is now active on <strong>${who}</strong>.</p>`,
      '<p style="margin:0 0 8px;font-size:15px;font-weight:700;">To start using it, do these three things once:</p>',
      '<ol style="margin:0 0 20px;padding-left:20px;font-size:15px;">',
      `<li style="margin-bottom:8px;">Sign in at ${link(account)} with this email. We send you a link, so there is no password.</li>`,
      '<li style="margin-bottom:8px;">Press <strong>Activate on this browser</strong> under <strong>Dedicated TikTok server &amp; overlay code</strong>.</li>',
      `<li>Copy your overlay links again from ${link(start)} (or from any editor) and paste them over the old ones in OBS or TikTok LIVE Studio. A link you copied before still uses the free connection.</li>`,
      "</ol>",
      `<p style="margin:0 0 20px;">${button(guide, "Open the Frills Plus guide &rarr;")}</p>`,
      '<hr style="border:0;border-top:1px dashed #d6d0c4;margin:18px 0;">',
      `<p style="margin:0;font-size:13px;color:#4a5560;">Need help? Tell us what you pressed and what you saw: ${link(feedback)}</p>`,
      "</div></body></html>",
    ].join(""),
  };
}
