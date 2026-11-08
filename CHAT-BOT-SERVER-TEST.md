# Chat bot: a private test on the Frills server

When a viewer types `.mouse` in your TikTok chat, a bot posts your reply in that chat, from a TikTok account you choose. The bot runs on
the Frills relay server. Nothing runs on your PC.

**It is off for everyone.** The relay starts the bot only when `BOT_CONFIG_FILE` names a file, and runs it only for the channels in that
file. The controls on the website are hidden unless the editor is opened with `?chatbot=1`. So putting this live changes nothing for
anyone but you.

## What you need first

1. **A signing plan that can send chat.** The free Euler key can't: its Community plan says "Not included" for sending chat. Euler's
   pricing page lists "Send chats to LIVE rooms" under a paid add-on (Premium Webcast Routes, on Business plans). Business has a 5-day
   free trial. Ask Euler which plan covers it, and whether serving more than one streamer is allowed, before you pay.
2. **A throwaway TikTok account for the bot.** Not your main one. Automated posting may break TikTok's terms, and the account can be
   suspended. The library's own README says so.
3. **That account's two login cookies.** Treat them like a password. In a private browser window, log in to tiktok.com as the bot
   account, open the developer tools (F12), then Application (or Storage), Cookies, `https://www.tiktok.com`. Copy the value of
   `sessionid` and the value of `tt-target-idc`. They stop working when you log out of that session or TikTok ends it; copy new ones then.

## On your phone (Termux): what you run now

The phone relay already reads its settings from `~/.frills-relay.env` (your owner password and Euler key live there), and
`update-relay.sh` loads that file before it starts the relay. The bot uses the same file. Do these in Termux.

**1. Make the bot file** (the JSON is in step 3 further down; the two cookies are the throwaway bot account's):

```bash
nano ~/frills-bot.json
```

```bash
chmod 600 ~/frills-bot.json
```

If `nano` is missing, run `pkg install nano` first.

**2. Switch the bot on** by adding one line to the settings file (the single quotes are right: the file is read by bash, which fills in `$HOME`):

```bash
echo 'BOT_CONFIG_FILE="$HOME/frills-bot.json"' >> ~/.frills-relay.env
```

**3. Update and restart the relay.** This also pulls the bot code from GitHub:

```bash
bash ~/frills/update-relay.sh
```

**4. Watch it.** `tmux attach -t relay`, then Ctrl+B and D to leave it running. You should see `Chat bot: ON for the channels in ...`,
then `Chat bot: 1 account running`, then `connected` once you are LIVE.

**To stop it:** remove the `BOT_CONFIG_FILE` line from `~/.frills-relay.env` and run `bash ~/frills/update-relay.sh` again.

Things to know about the phone:

- The bot file holds a TikTok login. Use a throwaway account. Termux's home folder is private to the Termux app on Android.
- The phone relay serves everyone's overlays. Whatever goes wrong inside the bot is caught and logged and does not stop the relay
  (there is a test for that). The bot adds one more connection to TikTok and a little work for the phone.
- If the relay starts by itself when the phone restarts (`~/.termux/boot/frills-relay.sh`), check that script also reads
  `~/.frills-relay.env`. If you are unsure, run `update-relay.sh` once after a restart.

## Steps on a server (later, if you move the relay to one)

**1. Put the code on the server.** Push it to GitHub (the website updates by itself; the bot controls stay hidden), then on the server:

```bash
sudo -u frills git -C /home/frills/frills pull
```

**2. Write the replies on the website.** Open `https://frills.valwidgets.live/actions/?chatbot=1` (once; the browser remembers it). Set your
commands, type each chat reply (up to 150 characters) under its command, tick "Also post the reply in my TikTok chat", and type your
TikTok name in step 3. Copy the overlay link. Its `c=` part holds your commands and replies.

**3. Make the bot file** on the server (it holds the login cookies, so only the `frills` user may read it):

```bash
sudo nano /etc/frills-bot.json
```

```json
{
  "bots": [
    {
      "channel": "yourtiktokname",
      "link": "PASTE THE WHOLE OVERLAY LINK, OR JUST THE c= PART",
      "sessionId": "THE sessionid COOKIE OF THE BOT ACCOUNT",
      "ttTargetIdc": "THE tt-target-idc COOKIE OF THE BOT ACCOUNT",
      "ownLogins": ["thebotaccountname"]
    }
  ]
}
```

```bash
sudo chown frills:frills /etc/frills-bot.json && sudo chmod 600 /etc/frills-bot.json
```

`channel` is the account whose LIVE chat is watched and posted in. `ownLogins` (optional) lists names whose messages are never answered.
Never put this file in git or paste its contents in a chat.

**4. Switch it on.** Add this line to `/etc/frills-relay.env`, then restart the relay:

```text
BOT_CONFIG_FILE=/etc/frills-bot.json
```

```bash
sudo systemctl restart frills-relay
```

**5. Watch it.**

```bash
journalctl -u frills-relay -f
```

You should see `Chat bot: ON for the channels in /etc/frills-bot.json`, then `Chat bot: 1 account running`, then
`bot @yourtiktokname: connected to @yourtiktokname's LIVE chat.` once you are LIVE (it looks again by itself until you are).

**6. Try it.** Go LIVE and type `.mouse` from another account. The reply appears in chat from the bot account.

## Changing or stopping it

- **Change a reply:** edit it on the website, copy the new link into the file. The relay reads the file again every 30 seconds. No restart.
- **Stop one channel:** delete it from the file.
- **Stop everything:** remove the `BOT_CONFIG_FILE` line and restart the relay.

## What the log can tell you

| Log line | Meaning |
| --- | --- |
| `the signing service refused to send chat` | The Euler key's plan can't send chat. The bot stays off until the relay restarts. |
| `chat replies are not switched on in the editor` | Tick "Also post the reply in my TikTok chat" and copy the link again. |
| `the link could not be read` | The link was cut off. Copy it again from the editor. |
| `no command has a chat reply` | Type at least one reply under a command. |
| `could not connect` | You are not LIVE yet, or TikTok or the signing service is busy. It tries again by itself. |
| `three posts in a row failed` | It pauses for 10 minutes. The session cookies may have expired: copy new ones. |

## How it stays polite

- The same command is answered at most once per the cooldown you set in the editor (default 10 seconds).
- At least 5 seconds between any two posts, and at most 3 replies waiting. A fourth is dropped.
- At most 60 posts an hour for one account.
- It never answers its own account, and never its own reply coming back through chat.
- Each message is answered once, even if it arrives twice.
