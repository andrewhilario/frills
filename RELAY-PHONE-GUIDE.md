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
| `RELAY_PER_IP=60` | How many pages one internet address may keep open at once (60 unless you say otherwise). Each overlay (chat, alerts, last gifts, goals, top likers) and each editor that is connected is one page, and some internet providers put many homes behind one address, so keep this generous. It is there to stop one address running away, not to count one streamer's pages. |
| `RELAY_ACCOUNTS_PER_IP=12` | How many different TikTok accounts one internet address may watch at once (12 unless you say otherwise), so one address cannot fill all the spots. More pages for an account it already watches are always fine. |
| `RELAY_ORIGINS=...` | The website addresses allowed to use it (default `https://frills.valwidgets.live`). |
| `EULER_API_KEY=...` | A key from the signing service (Euler Stream). **Without one the relay shares the signing service's anonymous limits with everyone else who uses it, and that is what makes TikTok "busy" at night.** The free Community key gives you 2,500 requests a day of your own. Put it in the settings file below, never on a command line. |
| `PORT=8765` | The port it listens on (only the tunnel connects to it). |
| `RELAY_BIND=127.0.0.1` | Leave this alone: it keeps the relay reachable only through the tunnel. |

Never put the key or the tunnel token in a link, a message or GitHub.

## Watching it and choosing the number of spots

- Every 5 minutes the relay prints a line like `spots 7/10, 2 waiting`. See it with `tmux attach -t relay` (Ctrl+B then D to leave again).
- Phone health: run `top` (CPU) and `free -h` (memory). Feel the phone: if it is hot, lower `RELAY_SLOTS`.
- Raise `RELAY_SLOTS` a little at a time (10, then 20, ...) while it stays cool and quick. The right number is whatever your phone and your home internet handle, and only a real test shows it.
- If streamers often wait a long time, the number of spots is too low or the phone is too small. That is the signal to move the relay to a bigger server later. It is the same program.

## Updating

One command does it all (stop, get the new code, install, start, health check):

```bash
bash ~/frills/update-relay.sh
```

It starts the relay with 50 spots. For a different number: `RELAY_SLOTS=70 bash ~/frills/update-relay.sh`. The tunnel is not touched. **From relay 0.5.6 the script reads the settings file `~/.frills-relay.env` if it exists** (it says `using the settings in ~/.frills-relay.env`), so your owner password and your signing-service key (`EULER_API_KEY`) survive an update. Before 0.5.6 it did not, and a relay it started had no owner password and no key. To make the file, see below.

### Restarting by hand, with a settings file (the way to keep the owner password)

Once: put your settings in a private file on the phone, so the password is never typed into a command (and not in a chat, a message or a screenshot).

```bash
nano ~/.frills-relay.env
```

Type these lines inside nano (your own password, 12 or more characters; if it has spaces or symbols, put it in single quotes), then press Ctrl+O, Enter, Ctrl+X:

```text
RELAY_OWNER_KEY=your-own-long-password
```

```bash
chmod 600 ~/.frills-relay.env
```

Every update (leave the `tunnel` session alone):

```bash
tmux kill-session -t relay
```

```bash
cd ~/frills && git pull && (cd helper && npm install)
```

```bash
tmux new-session -d -s relay "cd ~/frills && set -a && . ~/.frills-relay.env && set +a && RELAY_SLOTS=70 RELAY_ALERT_SPOTS=10 npm run relay"
```

Then check it: `tmux attach -t relay` prints a start-up message (leave it again with Ctrl+B, then D). It says `Frills relay 0.5.7 is running` and **`Owner password (...): on`**. If it says `not set` the file was not read, and if it says `NOT USED: it has N characters and needs at least 12` the password is too short. `curl http://127.0.0.1:8765/health` should say `"version":"0.5.7"`.

Without the owner password the same steps work with `tmux new-session -d -s relay "cd ~/frills && RELAY_SLOTS=70 npm run relay"`.

## When TikTok goes quiet on a connection (relay 0.5.3)

A connection to TikTok can say "connected" and then hear nothing at all, even though the account is LIVE and people are chatting (this happened once: the account was LIVE and chat was flowing for a direct connection, while the relay's connection stayed silent). A LIVE always says something every few seconds (at least the viewer count), so from 0.5.3 the relay lets go of a connection that has heard nothing for **2 minutes** and makes a fresh one, which asks TikTok again about the room. The relay's window then prints `@name: nothing from TikTok for 120 s, so it connects again`. If a fresh connection is silent too, the next wait is twice as long (4, 8, then 10 minutes at most), so a room that is really silent does not use up requests to the signing service. Pages see "Lost the connection, trying again…" for a few seconds.

## How it saves requests to the signing service

Every time the relay connects to a TikTok account it uses a request to a free signing service, which allows only so many a day. So:

- An account stays connected for **10 minutes** after its last page closes. Opening it again in that time costs nothing and connects at once.
- An account that is **not live yet** is looked for every **20 seconds** for the first 3 minutes (when a streamer has just opened the overlay and is about to go LIVE), every **minute** until half an hour, every **3 minutes** until 3 hours and then every **10 minutes** (0.5.5; it was every 3 minutes, which made a streamer wait up to 3 minutes for chat after going LIVE). A look at an account that is not LIVE only asks TikTok's own pages (two requests, about 0.9 seconds, measured with the connector we use) and **none to the signing service**, which is asked once, when the LIVE is found. From 0.5.4 it **never stops looking while a page is open** (it used to stop after 30 minutes, and an overlay in OBS, which has no Disconnect button, stayed blank at the streamer's next LIVE until someone reloaded it). A page left open all night costs about 70 requests. A page that **opens** while the account is offline makes the relay look at once (at most once every 30 seconds), so reloading the overlay right after going LIVE does not mean waiting for the next look.

## If something goes wrong

- **`npm error Missing script: "relay"`:** you are in the `helper` folder. The relay is started from the main folder: `cd ~/frills` first, then `npm run relay` (the start commands in this guide do that). Only `npm install` is run inside `helper`.
- **`curl` health works on the phone but not through `relay.valwidgets.live`:** the tunnel is not running (`tmux attach -t tunnel`), or the Public Hostname URL is not `localhost:8765`.
- **A page says "Too many Frills pages are open from your internet address" (older versions: "the relay turned the connection down"):** that address already holds the most pages the relay allows (the number is in the message). It passes by itself when pages close. Pages whose connection died without a word (a Wi-Fi blip, a PC that went to sleep, OBS closing badly) can still look open to the relay for many minutes, and before relay 0.5.2 the limit was 8 and a page that came back was counted next to its own ghost: that is why it used to clear only after about 20 minutes. From 0.5.2 the limit is 60 and a page that comes back replaces its own old connection at once. The status page has **pages open right now** and **pages turned away**, and the relay's window prints `a page was turned away (N pages are already open from its address)`. If it still happens, raise `RELAY_PER_IP`.
- **A page says "Can't reach the free Frills relay":** the relay or its tunnel is not answering: `tmux attach -t tunnel` and `tmux attach -t relay`, then the first line of this list.
- **The editor says the relay turned the connection down for another reason:** the relay is off, or the website address is not in `RELAY_ORIGINS`.
- **Chat stops after the screen turns off:** Android killed Termux. Redo step 5 and check the lock.
- **Everyone gets "TikTok's free connection is busy" (in the Philippines it was worst between midnight and 4 am):** the signing service is limiting your relay's address. See "When the signing service is busy at night" below.
- **Nothing appears for a real account but `frills_demo` works:** the problem is between the phone and TikTok (offline account, blocked address), not in Frills. Tell me the status line you see.

## The status page and the warning (relay 0.5.0)

Open the relay's address in a browser (`https://relay.valwidgets.live/health`, or `http://127.0.0.1:8765/health` on the phone) and you get a page, not just numbers: a big count of **free spots**, a bar, people waiting in line, how long it has been running, whether TikTok's free signing service is busy, and a guess of how many accounts this device could hold. It refreshes by itself every 5 seconds. On the phone itself it also shows the device's own numbers (cores, memory, how much the relay uses); through the tunnel only the public numbers are shown.

**The warning.** By default it speaks when **10 spots or fewer** are left, when someone starts waiting in line, and when the signing service says "busy". Each warning is once per change, so it does not nag.
- On the status page: a red bar, a short sound, and (if you press "Turn on notifications") a browser notification. Keep the page open. You can change the number on the page.
- On the phone itself: a Termux notification. One time only, install the free **Termux:API** app from the same place you got Termux (F-Droid), then run `pkg install termux-api`. Without it, the warning is only written in the relay's window.
- To change the number or turn it off, start the relay with `RELAY_ALERT_SPOTS=15` (or `RELAY_ALERTS=0`). `update-relay.sh` accepts the same variables: `RELAY_ALERT_SPOTS=15 bash ~/frills/update-relay.sh`.

**Pages.** Two more cards (relay 0.5.2): **pages open right now** (every overlay and editor that is listening) and **pages turned away** since the relay started, with how long ago the last one was and how many pages came back and replaced their own old connection. If "turned away" keeps growing, raise `RELAY_PER_IP`.

**How many can it handle?** The "About N accounts" number is a guess from the free memory and how much of one core each open account uses. It gets better once a few accounts are open. The real limit is usually your home internet and TikTok's free signing service (about 2,500 requests a day), so raise `RELAY_SLOTS` a little at a time and watch the page.

## Who is connected (relay 0.5.1)

Open the status page **on the phone itself** (the same `http://localhost:PORT/health` address, in the phone's own browser) and under "This device" there is a table, **Who is connected**: each TikTok account the relay is watching right now, whether it is LIVE, how many overlay pages are listening, its follower count, how long it has been here and how much has passed (chat lines, gifts, follows, shares). Press a name to open their LIVE on TikTok so you can say thank you. Accounts waiting in line are listed under the table.

- It is only shown on the phone. Through the tunnel (the public address) the page and the numbers carry no names at all.
- It is a live view only. Nothing is saved, so there is no history: if you want to know who was on an hour ago, you have to have been looking.
- "LIVE now" comes from what TikTok said when the relay connected. An account that went LIVE a moment later can read "Connected, not LIVE yet" until its next connect.
- The privacy page says that the person running the relay can see who is connected.

### Seeing who is connected from your PC (the owner password)

On the phone itself the table needs nothing. To see it from anywhere, through `https://relay.valwidgets.live/health`, the relay needs a password of your own: 12 or more characters, never shared and never pasted in a chat. **If the public page only offers the numbers and no "Owner?" box, the relay that is running was started without it** (the public numbers then have no `ownerLogin` line). The easy, safe way is the settings file described under "Updating" above (`~/.frills-relay.env` with a `RELAY_OWNER_KEY=` line). The same thing in one command, with the password typed into it:

```bash
tmux kill-session -t relay; tmux new-session -d -s relay "cd ~/frills && RELAY_SLOTS=100 RELAY_ALERT_SPOTS=10 RELAY_OWNER_KEY=your-password npm run relay"
```

Then open the public status page, type the password in the "Owner?" box and press the button. The page remembers it only until you close that tab, and sends it in a header (never in the address). Ten wrong tries in ten minutes lock that visitor out for ten minutes. Without `RELAY_OWNER_KEY` nothing changes: the public page shows only numbers. From 0.5.6 `update-relay.sh` reads `~/.frills-relay.env`, so the owner login stays on after an update (older versions of the script did not carry it).

## When the signing service is busy at night (relay 0.5.6)

TikTok's own pages do not limit the relay. What limits it is the **signing service** (Euler Stream) the connector asks once for every connection. Without a key of your own, the relay is in the service's anonymous tier, where every relay and every streamer who has no key share a small allowance per internet address, and the service says "busy" when it runs out. That is most likely why it gets worst in the Philippine night (midnight to about 4 am, which is 4 pm to 8 pm UTC): that is when a lot of streamers go LIVE at once. This is what we know and what we do not:

- **Known:** the relay can show whether it has a key. Open `https://relay.valwidgets.live/health`: the "Signing service" line now says `own key` or `NO key (shared limits)`, and `N connects in 24 h`. The same numbers are in the JSON as `signing.key`, `signing.connectsHour` and `signing.connectsDay`.
- **Measured on 2026-10-26** (a request with no key from the owner's PC to the service's own limits page, `https://tiktok.eulerstream.com/webcast/rate_limits`): **5 a minute, 30 an hour and 100 a day** for one internet address. Every connection to a LIVE uses one of them, so one relay with no key can connect only 100 times a day in total, and a restart that reconnects many accounts at once runs through the minute and the hour at once. That page was marked deprecated in its headers, the service can change the numbers, and the phone's address (especially on mobile data, where many people share one) may be counted differently, so treat them as a guide. With the free key the daily number is 2,500 (the service says a key gives "an immediate free increase"; it does not publish the per-minute and per-hour numbers for it that I could find).
- **Not known:** whether the relay on your phone is running without a key right now. The status line tells you.

**What to do (you do this, never paste the key in a chat):**

1. Make a free account at the signing service's own website and copy the **Community API key** (2,500 requests a day, 25 websockets at the same time).
2. Add one line to the settings file on the phone (the same file as the owner password):

   ```bash
   nano ~/.frills-relay.env
   ```

   ```text
   EULER_API_KEY=your-key-here
   ```

   then Ctrl+O, Enter, Ctrl+X, and `chmod 600 ~/.frills-relay.env`.
3. Restart with `RELAY_SLOTS=70 bash ~/frills/update-relay.sh` (from 0.5.6 it reads the file). The status page should now say `own key`.
4. Watch `N connects in 24 h` for a few days. A connection uses one request, so 2,500 a day is about 2,500 connections. If the number goes near that, the Business plan ($50 a month, 10,000 a day and 100 websockets, as last checked) is the next step. Check the service's own pricing page before paying, because it can change.

**What 0.5.6 changes by itself, with or without a key:**

- When the service says "busy", the whole relay now pauses together instead of each account waiting its own minute and then asking again at the same moment. The pause doubles each time in a row (1 minute, 2, 4, up to 10) with a little random extra, and starts over after a connection goes through. The relay's window prints `the signing service is busy: waiting about N s before asking it again`.
- After a "busy" only **one** connection tries first, to see if the service has calmed down. The rest follow once it has gone through.
- At most **5** connections are being made at the same moment (a restart used to send every account together).
- Viewers see "TikTok's free connection is busy" while this happens, and it clears by itself.

None of this raises the service's limit. A key of your own does. A relay on a server (DigitalOcean) has its own address, which helps for the same reason, but it is not a substitute for a key.

TikTok emotes (relay 0.5.1): chat messages that contain TikTok emotes, and messages that are only an emote, now reach the overlay as small pictures. Only pictures from TikTok's own picture servers are used. This is new and was tried only with made-up messages. If emotes still do not show, `tmux attach -t relay` prints a line "emotes arrived but none could be shown (picture server ...)" once per account: tell me the server name.
