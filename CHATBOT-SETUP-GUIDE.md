# Transparent In-Chat Bot Setup Guide (TikTok & Twitch)

This guide explains with **100% transparency** how to set up an automated in-chat bot that physically types comments into your **TikTok LIVE** or **Twitch** chat room when viewers trigger commands like `.mouse`, `.sens`, or `!specs`.

---

## 1. Transparency Notice: How TikTok Chat Actually Works

| Capability | Technical Reality | Cost & Privacy |
| :--- | :--- | :--- |
| **Reading Public Chat** | Anyone can listen to public TikTok LIVE chat anonymously with 0 logins (this is how the Frills OBS chat overlays work). | **Free & 0 Accounts** |
| **Writing / Sending Comments** | TikTok **does not permit anonymous comments**. Every comment in chat requires an authenticated user with an active session (`sessionid`). | **Requires a Logged-in Account** |
| **How TikFinity Does It** | TikFinity makes you download their Windows desktop software, opens an embedded Chromium browser, and requires you to log into your TikTok account on your PC. | **Desktop Login Required** |
| **How Cloud Signing Proxies Do It** | Cloud APIs (like Euler Stream) charge paid monthly subscriptions ($15–$50/mo) to sign API requests through their cloud datacenters. | **Expensive & High Ban Risk** |
| **The Frills Transparent Solution** | A lightweight, open-source script running locally in your browser where you are already logged in to TikTok Web. | **100% Free, Private, Inspectable** |

---

## 2. Option A: The 1-Minute Tampermonkey Setup (Recommended)

This is the fastest, safest, and most transparent method. It runs directly inside your browser tab on `tiktok.com` or `twitch.tv`. You can read and verify every line of code before enabling it.

### Step 1: Install Tampermonkey
Install the free **Tampermonkey** extension on Chrome, Edge, or Brave:
- Chrome Web Store: [Tampermonkey for Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)

### Step 2: Add the Frills Userscript
1. Click the Tampermonkey icon in your browser &rarr; **Create a new script**.
2. Select all existing text and replace it with the code from:
   [`scripts/frills-chat-bot.user.js`](file:///g:/Personal%20Project/frills/scripts/frills-chat-bot.user.js)
3. Press **Ctrl + S** (or File &rarr; Save).

### Step 3: Customize Your Commands (Optional)
Inside the script, lines 30–42 contain the configuration:
```javascript
const CONFIG = {
  prefix: ".",            // Change to "!" if you prefer !mouse
  cooldownSeconds: 8,     // Anti-spam delay between replies

  commands: [
    { trigger: "mouse", reply: "🐭 Mouse: Logitech G Pro X Superlight 2 (800 DPI)" },
    { trigger: "sens", reply: "🎯 Sensitivity: Valorant 0.31 @ 800 DPI · Fortnite 6.8%" },
    { trigger: "specs", reply: "💻 Specs: Ryzen 7 7800X3D · RTX 4080 Super · 32GB DDR5" },
    { trigger: "discord", reply: "💬 Join our cozy Discord: discord.gg/frills" },
  ],
};
```

### Step 4: Open Your LIVE Stream & Test
1. In your browser, open your TikTok LIVE page:
   `https://www.tiktok.com/@yourusername/live`
2. Open Developer Tools (**F12** &rarr; **Console**). You will see:
   `[Frills Chatbot] Active & Listening! Prefix: "." | Cooldown: 8s`
3. Have a friend or a second account type `.mouse` in your chat.
4. The bot will automatically type your mouse specs into the comment box and send it!

---

## 3. Account Best Practices & Safety

- **Which Account Posts the Replies?**
  Whichever TikTok account is logged into the browser tab where the script is running.
  - If you are logged into your **main streamer account**, the comment appears from you (streamers often do this so viewers know it's verified).
  - If you prefer a **dedicated bot account** (e.g. `@YourName_Bot`), simply log into that bot account in a separate Chrome Profile or secondary browser, open your stream's LIVE page, and let the script run there.
- **Anti-Spam Cooldown:**
  TikTok has rate limits for repeated comments. We recommend keeping `cooldownSeconds: 8` or higher so your account is never flagged for spam.
- **Zero Remote Data Transfer:**
  No passwords, tokens, or cookies ever leave your machine.
