// The words that change when Frills Plus accounts exist. While the feature is off (the site today) every text here is exactly what the site already said, so nothing changes for anyone; with it on
// (PLUS_ACCOUNTS=1) the pages stop saying "no accounts" and say what an account keeps, what a payment is, where the words of an AI voice go, how to cancel and how to delete. Used by build.mjs.
// Every claim below is about what the code does: the tables are in worker/schema.sql, the cookie in worker/account-routes.mjs, the mailer in worker/mailer.mjs, the voice route in worker/tts.mjs.

const NOT_AFFILIATED_OFF = "Frills isn’t affiliated with, endorsed by or sponsored by Twitch, TikTok or OBS. Those names belong to their owners.";
const NOT_AFFILIATED_ON = "Frills isn’t affiliated with, endorsed by or sponsored by Twitch, TikTok, OBS, Polar, Resend, OpenAI, Google or Groq. Those names belong to their owners.";

export function plusWords({ on = false, promoBanner = "" } = {}) {
  if (!on) {
    return {
      notAffiliated: NOT_AFFILIATED_OFF,
      privacyLede: "Frills has no accounts. It does keep a few things you choose to send it, such as images and sounds you upload for alerts. Here is exactly what.",
      privacyStoredIntro: "Frills has no accounts, but it does use a small database on Cloudflare for the few things below. Nothing else is kept, and none of it is sold or used for advertising.",
      privacyAccountItems: "",
      privacyCookies: "Frills itself sets no cookies.",
      privacyPlusSection: "",
      footerPlusItem: "",
      sheetPlusLink: "",
      navPlusLink: "",
      appbarPlusLink: "",
      homePlusBand: "",
      overlaysCard: "",
      ideasIntro: "Frills is free today. If we ever add a paid plan, it would be for extras that cost money to run, and we would say so up front. These are ideas, not promises: nothing here is for sale or promised for a date. Tap the ones you would use. Each tap is counted anonymously (no account, nothing that identifies you), so we build what people want.",
      ttsAi: "",
      ttsAboutItem: "",
      accountsLabel: "accounts",
      accountsNote: "Your settings live in your browser and in your link.",
    };
  }
  return {
    notAffiliated: NOT_AFFILIATED_ON,
    privacyLede: "Frills needs no account for anything free. An account exists only for Frills Plus, and only if you make one. Frills also keeps a few things you choose to send it, such as images and sounds you upload for alerts. Here is exactly what.",
    privacyStoredIntro: "Frills needs no account for anything free, but it does use a small database on Cloudflare for the few things below. The first four items apply only if you make a Frills account. Nothing else is kept, and none of it is sold or used for advertising.",
    privacyAccountItems: `
        <li><strong>Your account, if you make one (Frills Plus).</strong> Your email address, the day you made the account and the day you last signed in. Nothing else about you: there is no password, no name and no address. Frills uses the email only to send you a sign-in link (delivered through Resend). You can delete the account yourself at any time (below).</li>
        <li><strong>Sign-in links and signed-in browsers.</strong> A sign-in link is kept as a scrambled copy (a hash) of its code, so it cannot be read back, and it works once, for 15 minutes. Next to it Frills keeps a scrambled copy of the internet address that asked, only to slow down abuse. Both are deleted after a day. A browser you have signed in is kept as a scrambled copy of its cookie value, for up to 30 days or until you sign out.</li>
        <li><strong>What you bought, if you buy Frills Plus.</strong> Whether it is on, until when, how many characters of AI voice you have used this month, and the order and subscription numbers that Polar gives Frills. Not your card and not your address: see Payments below.</li>
        <li><strong>Your Plus overlay link, if you make one.</strong> The link for your streaming app carries a random code that stands for your account, never your payment. Frills keeps a scrambled copy of the code. Making a new link, turning it off or deleting your account ends the old one at once.</li>`,
    privacyCookies: "Frills sets no cookies, with one exception: if you sign in to a Frills account, a cookie keeps you signed in for up to 30 days. It is only for that, it is not used for tracking or advertising, and nothing sets it until you sign in.",
    privacyPlusSection: `
      <h2 class="subtitle">Payments, sign-in emails, AI voices and deleting your account</h2>
      <p><strong>Sign-in emails.</strong> When you ask for a sign-in link, Frills passes your email address and the one-time link to Resend so the email can be delivered to your inbox. Resend keeps its own delivery records under its own privacy policy.</p>
      <p><strong>Payments.</strong> Frills Plus is sold through Polar, which acts as Merchant of Record, takes the payment, charges any sales tax or VAT and sends your receipt. Polar sees your card details and billing address; Frills never does. Frills is told whether a subscription is paid, cancelled or refunded, with its order and subscription numbers. Polar keeps its own records under its own privacy policy.</p>
      <p><strong>AI voices.</strong> They are a Frills Plus extra. When one is spoken, the words to be said (a viewer’s chat message or a gift thank-you, and the viewer’s name if you have “Say viewer name before message” on) go from Frills to the company that makes the voice (OpenAI, Google or Groq, whichever Frills is set up with) and come back as sound. Frills does not keep the words or the sound. That company has its own rules for what it keeps. The free browser voices send nothing anywhere: they run on your device.</p>
      <p><strong>Counting Frills Plus prompts.</strong> The anonymous counts above also include how often a Frills Plus prompt is seen or clicked: the note that appears when you use up the free actions, the note about sticker shapes and VTube Studio, the tip under an editor, and the button that opens the checkout. A count is only the name of the prompt and whether it was seen or clicked, never who saw it, and it follows the same rules as the other counts, including doing nothing if your browser sends Do Not Track or Global Privacy Control.</p>
      <p><strong>Deleting your account.</strong> On the <a href="/account/">account page</a>, type your email and press Delete. That removes your account, your sign-in links, your signed-in browsers, your record of what you bought and your Plus overlay link, at once. A subscription that is still renewing has to be cancelled first (Manage or cancel on the same page), because deleting an account does not stop a payment. Cancelling and refunds are explained on the <a href="/plus/">Frills Plus page</a>.</p>`,
    footerPlusItem: `\n        <li><a href="/plus/">Frills Plus</a></li>\n        <li><a href="/account/">Account</a></li>`,
    sheetPlusLink: `\n    <a class="nav__link" href="/plus/">Frills Plus</a>\n    <a class="nav__link" href="/account/">Account</a>`,
    navPlusLink: `\n      <a class="nav__link nav__link--plus" href="/plus/" data-plus-only hidden>Frills Plus</a>`,
    appbarPlusLink: `\n      <a class="nav__link nav__link--plus" href="/plus/" data-plus-only hidden>Frills Plus</a>`,
    homePlusBand: `
  <section class="band band--pear" id="plus" data-plus-only hidden aria-labelledby="plus-band-title">
    <div class="shell">
      <div class="band__head">
        <h2 class="title" id="plus-band-title">Want 1 OBS link for your whole stream, live theme sync and AI pet voices?</h2>
        <p class="lede">Every overlay on Frills is free with no account. Frills Plus is an optional upgrade for Twitch and TikTok creators who want a 1-Link Master Stream Scene (16:9 &amp; 9:16), 1-click theme swaps, crash-proof cloud backup, natural AI voices and custom PNGTubers.</p>
      </div>
      <div class="plus-card">
        <div class="plus-card__top">
          <div class="acct-card__head">
            <h3 class="acct-card__title">Frills Plus</h3>
            <span class="acct-badge" data-tone="soon">Optional upgrade</span>
          </div>
          <p class="plus-card__price">$5.99 <span class="plus-card__per">/ month</span></p>
        </div>
        <p class="plus-card__meta">Renews monthly until cancelled · 14-day full refund · Cancel in two clicks</p>${promoBanner}
        <ul class="plus-card__list">
          <li><strong>1-Link Master Stream Scene (16:9 &amp; 9:16):</strong> combine your Chat, Alerts, Gift Jar, Goal Bar, Subathon Timer &amp; Pet TTS into a single <code>/o/…</code> OBS or TikTok LIVE Studio source with 1-click global theme swaps.</li>
          <li><strong>Crash-Proof Cloud Memory, Phone Stream Deck &amp; MVP Recap Cards:</strong> automatic cloud backup for <a href="/timer/">Subathon Timers</a>, <a href="/jar/">Gift Jars</a>, <a href="/goal/">Goal Bars</a> and Weekly/Monthly <a href="/gifters/">Top Gifters</a> &amp; <a href="/likers/">Top Likers</a>, live phone triggers, plus 1-click 9:16 / 16:9 Stream Recap PNGs.</li>
          <li><strong>VIP Jackpot Alert Tiers &amp; Natural AI Pet Voices (150,000 chars/mo):</strong> golden <code>★ VIP</code> spotlights &amp; big-tier GIF/sound overrides on <a href="/alerts/">Alerts</a>, plus ~3,000 expressive AI messages &amp; Sub/VIP chat filters on <a href="/tts/">Talking Pet</a>.</li>
          <li><strong>Custom 3-Frame PNGTuber Mascot:</strong> upload your own idle, talking and excited transparent PNG, WebP or GIF mascot frames on <a href="/tts/">Talking Pet</a>.</li>
          <li><strong>Unlimited Actions &amp; Full VTube Studio Controls:</strong> remove the 10-action and 5-sticky-note limits in <a href="/actions/">Actions</a>—pile unlimited named sticky notes onto your VTube Studio avatar’s face and unlock VTS hotkeys, props, expressions, zoom/flip, and color tints live.</li>
          <li><strong>Dedicated 24/7 TikTok LIVE Relay (+ Native Twitch):</strong> priority cloud connection with automatic free fallback so you never miss a paid alert.</li>
        </ul>
        <div class="plus-card__actions">
          <a class="btn" href="/plus/">See Frills Plus <span class="btn__arrow" aria-hidden="true">→</span></a>
          <a class="btn btn--outline" href="/tts/">Try Talking Pet</a>
        </div>
      </div>
    </div>
  </section>
`,
    overlaysCard: `
      <section class="plus-card" data-plus-only hidden aria-labelledby="overlays-plus-title">
        <div class="plus-card__top">
          <div class="acct-card__head">
            <h2 class="acct-card__title" id="overlays-plus-title">Frills Plus — 1-Link Master Scenes, AI voices &amp; cloud backup</h2>
            <span class="acct-badge" data-tone="soon">$5.99 / mo</span>
          </div>
        </div>${promoBanner}
        <ul class="plus-card__list">
          <li><strong>1-Link Master Scene (16:9 &amp; 9:16) &amp; 1-Click Theme Sync</strong> across permanent <code>/o/…</code> OBS links — rearrange widgets or switch looks live without re-pasting URLs.</li>
          <li><strong>Crash-Proof Cloud Memory &amp; Phone Stream Deck</strong> for <a href="/timer/">Subathon Timer</a>, <a href="/jar/">Gift Jar</a>, <a href="/goal/">Goal Bar</a> and Weekly/Monthly <a href="/gifters/">Top Gifters</a> &amp; <a href="/likers/">Top Likers</a>, plus live phone triggers.</li>
          <li><strong>150,000 AI Pet Voice Chars/mo &amp; 3-Frame Custom PNGTuber uploads</strong> (~3,000 expressive messages/mo, separate alert voices &amp; Sub/VIP filters) on <a href="/tts/">Talking Pet</a>, plus a 24/7 TikTok server.</li>
        </ul>
        <div class="plus-card__actions">
          <a class="btn btn--sm" href="/plus/">See Frills Plus <span class="btn__arrow" aria-hidden="true">→</span></a>
          <a class="btn btn--outline btn--sm" href="/tts/">Try Talking Pet</a>
        </div>
      </section>
`,
    ideasIntro: "Frills is free today, and what is free stays free. Frills Plus is a paid extra for things that cost money to run (AI voices for the talking pet are the first), and we say so up front. The ideas below are still ideas, not promises: nothing here is for sale or promised for a date. Tap the ones you would use. Each tap is counted anonymously (no account, nothing that identifies you), so we build what people want.",
    ttsAi: ", and Frills Plus adds AI voices",
    ttsAboutItem: `\n        <li>AI voices are part of <a href="/plus/">Frills Plus</a>. They run through Frills, which checks that your account has Plus and that you are in a country where it is sold (the US, Canada, the UK, Ireland, the EU and EFTA countries, Australia and New Zealand), and falls back to your browser voice if not.</li>`,
    accountsLabel: "accounts needed",
    accountsNote: "For anything free. Your settings live in your browser and in your link.",
  };
}
