# Frills TikTok Relay — DigitalOcean Deployment Runbook

> **Architecture Split**
> - **Stays on Cloudflare (`npm run deploy`):** The website and APIs at `https://frills.valwidgets.live` (`wrangler.jsonc` — Cloudflare Workers + D1 + Assets + Analytics Engine).
> - **Free TikTok Relay (`https://relay.valwidgets.live`):** Shared community relay (Termux phone or separate free server, `RELAY_TICKET_SECRET` unset).
> - **Dedicated Frills Plus Relay (`https://plus-relay.valwidgets.live`):** Runs on this DigitalOcean Droplet with `RELAY_TICKET_SECRET` set — accepts only short-lived HMAC-SHA256 tickets minted by Cloudflare for active Frills Plus accounts.

```text
TikTok LIVE <-- DigitalOcean Droplet (plus-relay.valwidgets.live, ticket-locked) <-- Cloudflare Tunnel <-- Frills Plus Overlays
TikTok LIVE <-- Termux Phone / Free Server (relay.valwidgets.live, open)         <-- Cloudflare Tunnel <-- Free Overlays & Plus Fallback
```

**Security rule:** Never paste `RELAY_OWNER_KEY`, `EULER_API_KEY`, or your Cloudflare Tunnel token into GitHub, screenshots, or chat.

---

## Step 1 — Create SSH Key on Windows (PowerShell)

Skip if you already have `%USERPROFILE%\.ssh\id_ed25519.pub`.

```powershell
ssh-keygen -t ed25519 -C "frills-relay"
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
```

Copy the entire `.pub` output (never share the private key without `.pub`).

---

## Step 2 — Create the DigitalOcean Droplet

1. Sign in at [digitalocean.com](https://www.digitalocean.com/) -> **Create** -> **Droplets**.
2. **Region:** Closest to you (e.g., Singapore).
3. **OS Image:** **Ubuntu 24.04 (LTS) x64**.
4. **Size:** **Basic** -> **Regular (SSD)** -> **$6/mo** (`1 GiB RAM / 1 vCPU / 25 GiB SSD`). *(Avoid the $4 / 512 MiB plan.)*
5. **Authentication:** **SSH Key** -> **New SSH Key** -> paste your `.pub` key.
6. **Hostname:** `frills-relay`. Leave paid backups off (the relay stores nothing on disk).
7. Click **Create Droplet** and copy the assigned **IPv4 address**.

---

## Step 3 — Initial Server Hardening & Swap

Connect from PowerShell on your PC:

```powershell
ssh root@YOUR_DROPLET_IP
```

Once logged in as `root`:

```bash
# Update system packages
apt update && apt upgrade -y

# Create dedicated non-root user + copy SSH key
adduser --disabled-password --gecos "" frills
rsync --archive --chown=frills:frills ~/.ssh /home/frills

# Firewall: SSH only (Cloudflare Tunnel is outbound; Node binds strictly to 127.0.0.1)
ufw allow OpenSSH
ufw --force enable

# Add 1 GB swap safety net for memory spikes
fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -h
```

Verify `free -h` shows `1.0Gi` on the `Swap:` line.

---

## Step 4 — Install Node.js 22, Git, and `cloudflared`

Run as `root`:

```bash
# Node 22 (matches .node-version) + git
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs git
node -v   # must print v22.x or newer

# Official Cloudflare Tunnel repository
mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | tee /etc/apt/sources.list.d/cloudflared.list
apt-get update && apt-get install -y cloudflared
```

---

## Step 5 — Clone Frills & Install Relay Dependencies

> **Branch note:** Latest relay code (`v0.6.0`) is on `frills-plus`. Use `-b frills-plus` below (or merge `frills-plus` into `main` first and omit `-b frills-plus`).

```bash
sudo -u frills git clone -b frills-plus https://github.com/andrewhilario/frills.git /home/frills/frills
sudo -u frills bash -c "cd /home/frills/frills/helper && npm install --no-audit --no-fund"
```

---

## Step 6 — Configure Environment Secrets (`/etc/frills-relay.env`)

Create the secrets file (`systemd` loads it as `root` before dropping privileges to `frills`):

```bash
nano /etc/frills-relay.env
```

Paste and replace placeholder values (`RELAY_OWNER_KEY` must be at least 12 characters):

```env
RELAY_SLOTS=100
RELAY_ALERT_SPOTS=10
RELAY_PER_IP=120
RELAY_ACCOUNTS_PER_IP=25
RELAY_OWNER_KEY=REPLACE_WITH_LONG_OWNER_PASSWORD
# Dedicated Frills Plus lock (REQUIRED for plus-relay.valwidgets.live — must match PLUS_RELAY_SECRET in Cloudflare!):
RELAY_TICKET_SECRET=REPLACE_WITH_32_BYTE_HEX_SECRET
# Strongly recommended on DigitalOcean so TikTok signing uses your own Euler quota:
# EULER_API_KEY=REPLACE_WITH_EULER_KEY
# Optional overrides (defaults already match production):
# RELAY_ORIGINS=https://frills.valwidgets.live
# PORT=8765
# RELAY_BIND=127.0.0.1
```

> **Generate & sync `RELAY_TICKET_SECRET` / `PLUS_RELAY_SECRET`:**
> On your Windows PC, generate a 32-byte hex secret once:
> ```powershell
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```
> Paste that **exact same secret** into:
> 1. `RELAY_TICKET_SECRET=` in `/etc/frills-relay.env` on DigitalOcean
> 2. Cloudflare Worker secret: `npx wrangler secret put PLUS_RELAY_SECRET`
>
> **Cloudflare Tunnel Public Hostname:** Create a separate tunnel (e.g., `frills-plus-relay`) in **Cloudflare Zero Trust -> Networks -> Tunnels** pointing `https://plus-relay.valwidgets.live` -> `http://127.0.0.1:8765` so your free relay (`relay.valwidgets.live`) stays untouched!

Save (`Ctrl+O`, `Enter`, `Ctrl+X`) and lock permissions:

```bash
chmod 600 /etc/frills-relay.env
```

---

## Step 7 — Create & Start the `systemd` Service

Running under `systemd` handles boot auto-start, crash recovery, and sets `INVOCATION_ID` (which unlocks the remote **Restart** button on `/health`).

```bash
nano /etc/systemd/system/frills-relay.service
```

Paste:

```ini
[Unit]
Description=Frills TikTok Relay
After=network-online.target
Wants=network-online.target

[Service]
User=frills
WorkingDirectory=/home/frills/frills
EnvironmentFile=/etc/frills-relay.env
ExecStart=/usr/bin/node helper/server.mjs --relay
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Save, enable, start, and verify locally:

```bash
systemctl daemon-reload
systemctl enable --now frills-relay
curl -s http://127.0.0.1:8765/health
journalctl -u frills-relay -n 30 --no-pager
```

Confirm:
- Health JSON returns `"name":"frills-relay"` and `"version":"0.6.0"`.
- Logs show `Owner password ... on` and `Restart from the status page: on`.

---

## Step 8 — Test TikTok LIVE Connectivity BEFORE Cutover

**Do not skip this step.** Verify TikTok does not block or throttle the DigitalOcean datacenter IP while the phone still serves production traffic:

```bash
# 1. Synthetic demo stream (Ctrl+C after a few messages)
curl -N "http://127.0.0.1:8765/tiktok/stream?user=frills_demo"

# 2. Real currently-LIVE TikTok username (replace LIVE_USERNAME)
curl -N "http://127.0.0.1:8765/tiktok/stream?user=LIVE_USERNAME"
```

Let the real stream run for 2–5 minutes and confirm chat/viewer events arrive without refused/blocked errors.
- If blocked: add `EULER_API_KEY` in `/etc/frills-relay.env`, run `systemctl restart frills-relay`, and retest (or test another DigitalOcean region before switching traffic).

---

## Step 9 — Cut Over Cloudflare Tunnel (`relay.valwidgets.live`)

> **Important:** Never run two machines with the same Cloudflare Tunnel token at the same time — Cloudflare load-balances unpredictably between them.

1. **On the Termux phone — stop the phone tunnel first:**
   ```bash
   tmux kill-session -t tunnel
   ```
   Edit `~/.termux/boot/frills-relay.sh` and comment out (`#`) the `tmux new-session -d -s tunnel ...` line so a phone reboot does not reconnect it. *(Keep the token written down securely for rollback.)*

2. **On the DigitalOcean Droplet — install the tunnel service:**
   Copy your tunnel token from **Cloudflare Zero Trust -> Networks -> Tunnels -> `frills-relay`** (or your phone's boot script), then run as `root`:
   ```bash
   cloudflared service install PASTE_CLOUDFLARE_TUNNEL_TOKEN_HERE
   systemctl status cloudflared --no-pager
   ```

3. **Verify from your Windows PC (PowerShell):**
   ```powershell
   curl.exe -s https://relay.valwidgets.live/health
   ```
   Confirm `"version":"0.6.0"` with a fresh low `uptimeS`, then test a live TikTok stream on `https://frills.valwidgets.live/editor/`.

---

## Step 10 — Day-2 Operations

### Update Relay Code
Run as `root` on the Droplet:

```bash
sudo -u frills git -C /home/frills/frills pull
sudo -u frills bash -c "cd /home/frills/frills/helper && npm install --no-audit --no-fund"
systemctl restart frills-relay
curl -s http://127.0.0.1:8765/health
```

### Live Logs & Resource Monitoring
```bash
journalctl -u frills-relay -f
free -h
top
```
Public health dashboard: `https://relay.valwidgets.live/health` (use `RELAY_OWNER_KEY` to inspect connected streamers or trigger a restart).

### Instant Rollback to Termux Phone
1. **On DigitalOcean Droplet** (if reachable):
   ```bash
   systemctl stop cloudflared
   ```
2. **On Termux phone:**
   ```bash
   tmux new-session -d -s tunnel "cloudflared tunnel run --token PASTE_CLOUDFLARE_TUNNEL_TOKEN_HERE"
   ```
Overlays reconnect automatically within ~1–2 minutes.
