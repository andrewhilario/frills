# Frills Plus — Production Launch Checklist

All Frills Plus code is built and enabled (`"plusAccounts": true` in `site.config.json`). Complete these 5 setup steps before running `npm run deploy` so sign-in emails, billing, webhooks, and AI voices work end to end.

---

## Step 1 — Run the D1 Database Migration (Cloudflare)

Open **Cloudflare Dashboard -> Storage & Databases -> D1 -> `frills-feedback` -> Console** (or run via `wrangler d1 execute`) and execute lines 101–148 of `worker/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_links (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS login_links_email ON login_links (email, created_at);
CREATE INDEX IF NOT EXISTS login_links_ip ON login_links (ip_hash, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions (account_id);

CREATE TABLE IF NOT EXISTS plus (
  account_id TEXT PRIMARY KEY,
  provider_ref TEXT NOT NULL DEFAULT '',
  order_ref TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  renews_at INTEGER,
  tts_used INTEGER NOT NULL DEFAULT 0,
  tts_limit INTEGER NOT NULL DEFAULT 150000,
  period_start INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS overlay_links (
  code_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS overlay_links_account ON overlay_links (account_id, kind);

CREATE TABLE IF NOT EXISTS cloud_overlays (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  query TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cloud_overlays_account ON cloud_overlays (account_id, updated_at);
```

*(If an older `plus` table already existed without `order_ref`, run `ALTER TABLE plus ADD COLUMN order_ref TEXT NOT NULL DEFAULT '';`.)*

---

## Step 2 — Configure Resend (Sign-In Emails)

1. Sign up at [resend.com](https://resend.com/) -> **Domains -> Add Domain** -> enter `valwidgets.live` (or a subdomain like `mail.valwidgets.live`).
2. Add the **SPF, DKIM, and DMARC DNS records** Resend gives you inside **Cloudflare DNS** for `valwidgets.live` and click **Verify**.
3. Create an **API Key** in Resend with **Sending access** for that domain.
4. Set Worker secrets from PowerShell in `g:\Personal Project\frills`:
   ```powershell
   npx wrangler secret put RESEND_API_KEY
   # Optional if using a different sender than "Frills <noreply@valwidgets.live>":
   npx wrangler secret put MAIL_FROM
   # Random salt for hashing login requester IPs:
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   npx wrangler secret put ACCOUNT_SALT
   ```

---

## Step 3 — Configure Polar.sh ($5.99/mo Subscription — Sandbox first, then Live)

1. Start in **Polar Sandbox** at [sandbox.polar.sh](https://sandbox.polar.sh/) (instant testing with fake cards **and** working Customer Portal before store approval), or [polar.sh](https://polar.sh/) for Live.
2. Create your Organization -> **Products -> New Product**:
   - **Name:** `Frills Plus`
   - **Price:** Recurring -> **$5.99 / month**
   - Copy the **Product ID** (UUID, e.g., `12345678-...`).
3. Go to **Settings -> Developers -> Tokens** -> create an **Organization Access Token** (`polar_oat_...`) with `checkouts:write`, `customer_sessions:write`, and `subscriptions:read`.
4. Go to **Settings -> Developers -> Webhooks -> Add Endpoint**:
   - **URL:** `https://frills.valwidgets.live/api/webhooks/polar`
   - **Secret:** copy the signing secret (`whsec_...` or `polar_whs_...`)
   - **Events to enable:**
     - `subscription.created`
     - `subscription.active`
     - `subscription.updated`
     - `subscription.canceled`
     - `subscription.uncanceled`
     - `subscription.revoked`
     - `order.paid`
     - `order.refunded`
5. Upload your **Sandbox** and **Live** secrets once in PowerShell — then flip between Sandbox and Production with a single `POLAR_SANDBOX` flag (`1` = Sandbox, `0` = Production):
   ```powershell
   # Sandbox secrets (from sandbox.polar.sh):
   npx wrangler secret put POLAR_SANDBOX_ACCESS_TOKEN    # Sandbox polar_oat_...
   npx wrangler secret put POLAR_SANDBOX_PRODUCT_ID      # Sandbox Product UUID
   npx wrangler secret put POLAR_SANDBOX_WEBHOOK_SECRET  # Sandbox whsec_...

   # Live Production secrets (from polar.sh):
   npx wrangler secret put POLAR_ACCESS_TOKEN            # Live polar_oat_...
   npx wrangler secret put POLAR_PRODUCT_ID              # Live Product UUID
   npx wrangler secret put POLAR_WEBHOOK_SECRET          # Live whsec_...

   # Switch to Sandbox (locked to your PRO_ALLOW_IPS so public visitors cannot use test cards):
   Write-Output "1" | npx wrangler secret put POLAR_SANDBOX

   # Switch to Production Live anytime:
   Write-Output "0" | npx wrangler secret put POLAR_SANDBOX
   ```

> **Security guard:** While `POLAR_SANDBOX=1` on Cloudflare, checkout is automatically locked to `PRO_ALLOW_IPS` (so public Tier-1 visitors cannot check out with fake sandbox cards). Setting `POLAR_SANDBOX=0` switches to `api.polar.sh` with your Live `POLAR_*` secrets and unlocks checkout for all Tier-1 visitors immediately.
>
> **Reviewer link if Polar asks to inspect `/plus/` from outside Tier-1:** Set `npx wrangler secret put PLUS_REVIEW_KEY` (any random token) and share `https://frills.valwidgets.live/plus/?review=YOUR_KEY` — works from any country while `/plus/` stays hidden in PH.

---

## Step 4 — Configure AI Voice Provider (Pick One)

`worker/tts.mjs` checks providers in order: `OPENAI_TTS_KEY`, then `GOOGLE_TTS_KEY`, then `GROQ_TTS_KEY`. Set **one**:

```powershell
# Option A — Google Cloud Text-to-Speech (Neural2, includes free 1M chars/mo tier)
npx wrangler secret put GOOGLE_TTS_KEY

# Option B — OpenAI TTS (tts-1, ~$15 / 1M chars)
npx wrangler secret put OPENAI_TTS_KEY

# Option C — Groq Orpheus TTS (~$22 / 1M chars)
npx wrangler secret put GROQ_TTS_KEY
```

*(Default monthly allowance is `150000` characters — override with `PLUS_MONTHLY_CHARS` if desired.)*

---

## Step 5 — Region Lock & Owner Self-Testing

Frills Plus stays restricted to **Tier-1 regions** (`US, CA, AU, NZ, GB, IE, EU-27 + EFTA` in `worker/region.mjs`).

- **Browser testing from your own IP (recommended):** `PRO_ALLOW_IPS` accepts a comma-separated list of IPv4/IPv6 addresses (matched against Cloudflare's unspoofable `cf-connecting-ip` header) so you can sign in, buy via Polar, and test AI voices in your browser from outside Tier-1. If your home ISP rotates your IP, refresh it anytime:
  ```powershell
  # Check the exact IP(s) Cloudflare sees from your machine:
  curl.exe -4 -s https://www.cloudflare.com/cdn-cgi/trace | Select-String "^ip="
  curl.exe -6 -s https://www.cloudflare.com/cdn-cgi/trace | Select-String "^ip="
  # Save IPv4 (and IPv6 comma-separated if present) into Cloudflare Worker secrets:
  npx wrangler secret put PRO_ALLOW_IPS
  ```
- **API / `curl` testing override:** You can also set `PRO_DEV_KEY` (`npx wrangler secret put PRO_DEV_KEY`) and pass `-H "x-frills-dev: YOUR_PRO_DEV_KEY"` (it must be at least 16 characters, and it is a separate secret: the admin password is never accepted here) (browsers cannot send this header).

---

## Step 6 — Dedicated DigitalOcean Plus Relay (`plus-relay.valwidgets.live`)

Once your DigitalOcean Droplet is running (see `DIGITALOCEAN-DEPLOY.md`), link Cloudflare to it with one shared secret:

```powershell
# 1. Generate a 32-byte hex secret (paste the exact same value into RELAY_TICKET_SECRET on DigitalOcean):
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 2. Upload it to Cloudflare Worker secrets:
npx wrangler secret put PLUS_RELAY_SECRET
# (PLUS_RELAY_URL defaults to https://plus-relay.valwidgets.live — only set it if using another hostname)
```

Until `PLUS_RELAY_SECRET` is set, overlays silently fall back to the free relay (`https://relay.valwidgets.live`).

---

## Step 7 — Deploy & Smoke Test

```powershell
npm run deploy
```

Verify live endpoints after deploy:

```powershell
# 1. Pages load (200 OK)
curl.exe -sI https://frills.valwidgets.live/plus/ | Select-String "HTTP/"
curl.exe -sI https://frills.valwidgets.live/account/ | Select-String "HTTP/"

# 2. Pro status shows aiReady: true
curl.exe -s https://frills.valwidgets.live/api/pro/status

# 3. End-to-end manual test in browser:
#    - Open https://frills.valwidgets.live/account/
#    - Enter your email -> verify Resend delivers the sign-in link
#    - Click link -> press "Sign in" -> verify signed-in My Plus panel loads
#    - Click "Get Frills Plus" -> complete test checkout -> return to /account/?welcome=1
#    - Confirm status switches to "On" and 0 of 150,000 characters meter appears
#    - Open /tts/ -> create Plus overlay link -> test AI voice -> test Manage or cancel -> test refund turns Plus off
```
