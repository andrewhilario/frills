# Running the Frills relay on your phone (POCO F3)

## What this is

The relay is the Frills helper run as a shared service. The Frills website (on Cloudflare) talks to it, so a TikTok streamer can use Frills with nothing installed.

- It holds one connection to TikTok for each streamer who is LIVE.
- It has a limited number of **spots**. When they are all taken, the next streamers wait in a line, and the editor shows their place ("Waiting for a spot: 3 of 12").
- It keeps no chat. Nothing is written to disk.

```text
TikTok  <--  your phone (relay)  <--  Cloudflare Tunnel  <--  Frills website pages (OBS, editor)
```

The phone is a free, small server. Be honest with yourself about the limits:

- If the phone, the Wi-Fi or the power goes off, everyone's TikTok chat stops until it is back.
- Every connection to TikTok comes from your home internet address. TikTok or the free signing service may slow that down if too many streamers use it. Start with few spots and watch.
- Use a spare phone if you can, kept cool and plugged in with a charge limit.

> I have **not** run this on a phone myself. Steps 1 to 4 are the test of whether it works there.

## What you need first

- The Frills code on GitHub, so the phone can download it.
- A Cloudflare account with `valwidgets.live` on it (you have this).
- The phone on your home Wi-Fi, plugged in.

## 1. Install Termux

Install **Termux** and **Termux:Boot** from **F-Droid** (f-droid.org). Do **not** use the Play Store version: it is old and does not work. Open Termux once, and open Termux:Boot once too, so Android knows it.

## 2. Install the tools (in Termux)

```bash
pkg update && pkg upgrade
```

```bash
pkg install nodejs git tmux cloudflared
```

Check the Node version:

```bash
node -v
```

It should print `v22` or newer. If `cloudflared` is not found in the package list, tell me; there is another way to get it.

## 3. Get the code and install the connector

Use your real GitHub name instead of `YOURNAME`:

```bash
git clone https://github.com/YOURNAME/frills.git
```

```bash
cd frills/helper && npm install && cd ..
```

`npm install` downloads the TikTok connector, about 25 MB.

## 4. Try the relay on the phone

```bash
RELAY_SLOTS=10 npm run relay
```

It prints "Frills relay ... is running". Open a **second** Termux session (swipe in from the left edge, then "New session") and run:

```bash
curl http://127.0.0.1:8765/health
```

You should see `"name":"frills-relay"` and `"slots":{"used":0,"max":10,"waiting":0}`.

To test the chat path without TikTok, ask for the pretend account:

```bash
curl -N "http://127.0.0.1:8765/tiktok/stream?user=frills_demo"
```

Made-up chat should start to scroll. Press Ctrl+C to stop that, then stop the relay (Ctrl+C in the first session).

## 5. Stop Android from killing it

Android and Xiaomi's MIUI close background apps. Do **all** of these:

- Settings > Apps > Manage apps > Termux > Battery saver: **No restrictions**.
- Settings > Apps > Manage apps > Termux > **Autostart: ON**. Same for Termux:Boot.
- Open the recent-apps screen, long-press the Termux card and choose **Lock** (the padlock).
- Keep Wi-Fi on during sleep (in the Wi-Fi settings).
- In Termux run `termux-wake-lock` (it shows a notification; that is correct).
- Keep the phone **plugged in**. If Settings > Battery has a charge limit (about 80%), turn it on.
- Keep it **cool**: no case, not in the sun, not under a pillow.

## 6. Put the relay on the internet (Cloudflare Tunnel)

On your PC, in the Cloudflare dashboard:

1. Zero Trust > Networks > Tunnels > **Create a tunnel** > Cloudflared. Name it `frills-relay`.
2. It shows an install command with a long **token**. Copy only the token. It is a **secret**: do not paste it in chat, in GitHub or in a screenshot.
3. Public Hostname: subdomain `relay`, domain `valwidgets.live`, service type **HTTP**, URL `localhost:8765`.

Back in Termux, start both things in tmux so they keep running:

```bash
tmux new -s relay
```

```bash
RELAY_SLOTS=10 npm run relay
```

Press **Ctrl+B** then **D** to detach. Then:

```bash
tmux new -s tunnel
```

```bash
cloudflared tunnel run --token PASTE_THE_TOKEN_HERE
```

Press **Ctrl+B** then **D** to detach.

Check from your **PC** (not the phone):

```bash
curl https://relay.valwidgets.live/health
```

You should see the same `frills-relay` answer.

## 7. Start by itself after a reboot

Create the Termux:Boot script:

```bash
mkdir -p ~/.termux/boot
```

```bash
nano ~/.termux/boot/frills-relay.sh
```

Put this in it (change the token, and the folder name if you used a different one):

```sh
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
cd ~/frills
tmux new-session -d -s relay "RELAY_SLOTS=10 npm run relay"
tmux new-session -d -s tunnel "cloudflared tunnel run --token PASTE_THE_TOKEN_HERE"
```

Save (Ctrl+O, Enter, Ctrl+X) and make it runnable:

```bash
chmod +x ~/.termux/boot/frills-relay.sh
```

Restart the phone once to check that it comes back on its own.

## 8. Switch the website on

In the project folder on your PC, open `site.config.json` and set:

```json
"relayUrl": "https://relay.valwidgets.live"
```

Then commit, push and let Cloudflare deploy. The pages then say TikTok works in the browser (free beta, may queue), the security policy allows the relay, and the editor and the OBS overlay use it when no helper is running on the PC. Leave `relayUrl` empty to keep the site saying "helper only".

## Settings

Put these before `npm run relay`:

| Setting | What it does |
| --- | --- |
| `RELAY_SLOTS=10` | How many TikTok accounts at once. The line forms after this. Start low. |
| `RELAY_PER_IP=4` | How many streams one visitor address may hold open. |
| `RELAY_ORIGINS=...` | The website addresses allowed to use it (default `https://frills.valwidgets.live`). |
| `EULER_API_KEY=...` | Optional: a free key from the signing service, to raise its limits. |
| `PORT=8765` | The port it listens on (only the tunnel connects to it). |
| `RELAY_BIND=127.0.0.1` | Leave this alone: it keeps the relay reachable only through the tunnel. |

Never put the key or the tunnel token in a link, a message or GitHub.

## Watching it and choosing the number of spots

- Every 5 minutes the relay prints a line like `spots 7/10, 2 waiting`. See it with `tmux attach -t relay` (Ctrl+B then D to leave again).
- Phone health: run `top` (CPU) and `free -h` (memory). Feel the phone: if it is hot, lower `RELAY_SLOTS`.
- Raise `RELAY_SLOTS` a little at a time (10, then 20, ...) while it stays cool and quick. The right number is whatever your phone and your home internet handle, and only a real test shows it.
- If streamers often wait a long time, the number of spots is too low or the phone is too small. That is the signal to move the relay to a bigger server later. It is the same program.

## Updating

```bash
tmux kill-session -t relay
```

```bash
cd ~/frills && git pull && (cd helper && npm install)
```

```bash
tmux new-session -d -s relay "RELAY_SLOTS=10 npm run relay"
```

## If something goes wrong

- **`curl` health works on the phone but not through `relay.valwidgets.live`:** the tunnel is not running (`tmux attach -t tunnel`), or the Public Hostname URL is not `localhost:8765`.
- **The editor says the relay turned the connection down:** the relay is off, or the website address is not in `RELAY_ORIGINS`, or too many pages are open from one address.
- **Chat stops after the screen turns off:** Android killed Termux. Redo step 5 and check the lock.
- **Everyone gets "TikTok's free connection is busy":** the signing service is limiting your home address. Lower `RELAY_SLOTS`, or set a free `EULER_API_KEY`.
- **Nothing appears for a real account but `frills_demo` works:** the problem is between the phone and TikTok (offline account, blocked address), not in Frills. Tell me the status line you see.
