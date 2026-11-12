# Plan: Frills Plus with a light account (email sign-in, no passwords)

Status: a plan only. Nothing here is built. Written 12 November 2026.

## What this replaces
Today (uncommitted code in this folder: worker/billing.mjs, worker/region.mjs, worker/tts.mjs, src/js/tts-*.js) a buyer pays on Lemon Squeezy, gets a license key, pastes it into "Activate key" on /tts, and the key is also written into the overlay link. That is a chore and the key in the link can be seen and spent by anyone who sees the link.

## The idea in one paragraph
Free Frills stays exactly as it is: no account. Plus uses an account made of just an email address. The user signs in with a link sent to their inbox (no password). They press Get Frills Plus, pay on Lemon Squeezy (which takes the card and sends the receipt), come back, and Plus is on. A "My Plus" page shows what they have and lets them manage or cancel. The overlay link carries only a harmless code, never anything that can be spent.

## What I checked (sources, not tested by us)
- Lemon Squeezy lets a checkout link carry custom data (`checkout[custom][...]`), and it comes back in the webhook as `meta.custom_data`; the email can be pre-filled with `checkout[email]` but the buyer can still change it, so we link the payment to the account by an account id in custom data, never by email. (docs.lemonsqueezy.com, "Passing Custom Data", "Pre-filled checkout fields")
- Lemon Squeezy has a hosted customer portal (change plan, pause, cancel, payment method). The signed portal link from the API is valid for 24 hours, so we fetch a fresh one when the user presses the button. (docs.lemonsqueezy.com, "Customer Portal")
- Resend's free plan was listed as 3,000 emails a month and 100 a day (resend.com/blog/new-free-tier; third-party pages differ, so check resend.com/pricing). Every sign-in email counts.
- NOT checked: which countries Lemon Squeezy can pay out to (owner must check), and the exact current limits of any email service.

## The pieces (in build order)
1. **Safe starting point.** Commit the current TTS/Pro work on its own branch so it is not lost (needs the owner's go-ahead: that folder has other uncommitted work).
2. **Tables (D1). DONE (12 Nov 2026):** `worker/accounts.mjs`, tables in `worker/schema.sql`, `test/accounts.test.mjs` (15 tests). The owner must run the new SQL once in the D1 console before step 3 goes live. `accounts` (id, email, created_at), `login_links` (token hash, account id, expires 15 min, used), `sessions` (token hash, account id, expires 30 days), `plus` (account id, Lemon Squeezy subscription id, status, renews_at, credits used / limit, period start). Existing `pro_passes` / `pro_links` are kept only for the local dev pass.
3. **Sign in by email.** `POST /api/account/login` (email) always answers the same ("check your inbox") so nobody can find out who has an account; a single-use link that expires in 15 minutes; clicking it sets a secure session cookie (HttpOnly, Secure, SameSite=Lax). Limits per address and per internet address.
4. **Checkout.** "Get Frills Plus" needs sign-in first, then opens the Lemon Squeezy checkout with the email pre-filled and the account id in custom data.
5. **Webhook.** Reuse the signature check already in billing.mjs. On order/subscription created: switch Plus on for the account id in custom data. On payment success: renew the month and reset credits. On refund, cancel, expire: switch off. Unknown events change nothing.
6. **My Plus page (/account/).** Plan and price, status, renewal date, voice credits used of limit, "Manage or cancel" (fresh portal link), how refunds work, sign out, "Delete my account and data".
7. **Overlay links without secrets.** The TTS overlay link gets a random code made in the editor (the same pattern as the subathon timer: a code in the link, the control in the browser). The server maps the code to the account's Plus and credits. A "make a new link" button replaces the code if a link leaks. The license key is never in a link again.
8. **One gate for every Plus feature.** A single server check "is this account Plus and within its limit" used by every Plus route. Free routes are untouched. Free users see Plus features marked "Plus", can preview them, and are never nagged.
9. **Remove** the "Activate key" box and the Pro Pass key setting. Keep the local-only test pass.
10. **Words.** Privacy page (what is stored: email, Plus status; why; how to delete), home page "No account" wording (free features), FAQ promise (extras that cost money to run, said up front), a short refund and cancel page, "not affiliated" notes.

## Tests (each piece is done only when these pass)
- Login link: single use, expires, wrong or reused link refused, same answer for known and unknown emails, rate limits.
- Webhook: bad signature refused, creates / renews / cancels by account id (not email), a changed checkout email still links to the right account, test-mode events ignored on the live site.
- Gate matrix: free visitor, signed-in free account, Plus account, exhausted credits, cancelled, refunded: each gets the right answer on the AI voice route; free features work for all.
- Browser: sign in with a pretend mailer, My Plus in each state, the Buy button shows only when a checkout address exists.
- Lemon Squeezy test mode by hand: buy with the test card, see Plus turn on, refund, see it turn off.
- Live smoke checklist after deploy (the same gate matrix with curl).

## Decisions the owner must make
1. Name: "Frills Plus" (the interest buttons) or "Frills Pro" (the current code). One name everywhere.
2. What is in Plus at launch: AI voices only, or also bigger uploads, scenes, packs.
3. Price and type: monthly subscription or one-time. (Credits and renewal logic assume monthly.)
4. Region lock: keep Tier-1 only, or allow everyone now that Lemon Squeezy handles tax and receipts. (The owner may be in a locked region and could not test as themselves.)
5. Email service and the sending address on valwidgets.live (needs DNS records added in Cloudflare by the owner).
6. Whether Lemon Squeezy can pay out to the owner's country.

## Owner's tasks
- Lemon Squeezy store in test mode with a product, its checkout link, an API key, a webhook secret and a public webhook address.
- Email service account and the DNS records it asks for.
- Pick a text-to-speech provider key (Google, OpenAI or Groq) and check its pricing.

## Risks
- More to build and look after than a key: sessions, email delivery, deleting accounts. Worth it only if people want Plus: check the "I would use this" counts on /overlays/ first.
- Email can land in spam; the sign-in page must say "check spam" and offer to resend.
- Anyone with a TTS overlay link can use that account's credits until the link is replaced; the "new link" button and the credit limit cap the harm.
- Lemon Squeezy's checkout email field is editable; that is why the account id, not the email, links a payment.
