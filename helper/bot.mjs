// The chat bot runner. It is a private test and it is OFF unless BOT_CONFIG_FILE names a file, and a channel runs only if it is in that file,
// so putting this on a server changes nothing for anyone else.
//
// For each channel in the file it stays connected to that account's LIVE chat, runs what viewers type through the reply engine
// (src/js/reply-engine.js: cooldowns, a gap between posts, a short queue, never answering itself) and posts the replies with a signed-in
// TikTok session. This is the one part of Frills that uses a TikTok login, so use a throwaway account for it, and keep the file private
// (on the server: chmod 600, and never in git).
//
// The file:
//   { "bots": [ { "channel": "yourname",                 // the TikTok account whose LIVE chat to watch (and post in)
//                 "link": "...",                        // the c= part of your overlay link, or the whole link: your commands and replies
//                 "sessionId": "...", "ttTargetIdc": "...",   // the signed-in session of the account that posts
//                 "ownLogins": ["thebotaccount"] } ] }  // optional: names whose messages are never answered
// It is read again every 30 seconds, so changing a reply (paste the new link) needs no restart.

import { readFileSync } from "node:fs";
import { readCommands } from "../src/js/actions.js";
import { createReplyEngine } from "../src/js/reply-engine.js";
import { mapChat } from "./map.mjs";

/** Accepts the c value on its own, or a whole editor or overlay link. */
export function parseLink(link) {
  const text = String(link ?? "").trim();
  if (!text) return "";
  try {
    return new URL(text).searchParams.get("c") ?? "";
  } catch {
    return text;
  }
}

const cleanChannel = (value) => String(value ?? "").trim().replace(/^@/, "").toLowerCase();

/** The file's text -> { bots, problems }. A bot with something missing is left out, and the reason is listed. */
export function loadBots(text) {
  const bots = [];
  const problems = [];
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { bots, problems: ["The bot file is not valid JSON."] };
  }
  const list = Array.isArray(raw?.bots) ? raw.bots : [];
  list.forEach((entry, i) => {
    const channel = cleanChannel(entry?.channel);
    const sessionId = String(entry?.sessionId ?? "").trim();
    const ttTargetIdc = String(entry?.ttTargetIdc ?? "").trim();
    const c = parseLink(entry?.link);
    const label = channel || `bot ${i + 1}`;
    if (!channel) return problems.push(`${label}: no channel.`);
    if (!sessionId || !ttTargetIdc) return problems.push(`${label}: sessionId and ttTargetIdc are both needed to post.`);
    if (!c) return problems.push(`${label}: no link (the c= part of the overlay link).`);
    bots.push({ channel, c, sessionId, ttTargetIdc, ownLogins: (Array.isArray(entry.ownLogins) ? entry.ownLogins : []).map(cleanChannel).filter(Boolean) });
  });
  return { bots, problems };
}

/** The real connection: the library is loaded only now, and the session is what lets sendMessage post as that account. */
export async function realBotFactory(user, { apiKey, session }) {
  const library = await import("tiktok-live-connector");
  return new library.TikTokLiveConnection(user, {
    processInitialData: false,
    ...(apiKey ? { signApiKey: apiKey } : {}),
    session: { cookie: { type: "cookie", value: { sessionId: session.sessionId, ttTargetIdc: session.ttTargetIdc } } },
  });
}

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `file` is the bot file's path. `factory(user, { apiKey, session })` makes a connection (tests pass a pretend one). `tuning` is for tests:
 * tickMs (how often it looks for a reply to post), reloadMs, retryMs (the waits before connecting again), gapSeconds, maxPerHour.
 */
export function createBotRunner({
  file = "",
  readText = file ? () => readFileSync(file, "utf8") : null, // no file and no reader: nothing runs
  factory = realBotFactory,
  apiKey = "",
  log = () => {},
  tickMs = 1000,
  reloadMs = 30_000,
  retryMs = [20_000, 60_000, 180_000, 600_000],
  gapSeconds = 5,
  maxPerHour = 60, // a safety net: however it is set up, one account never posts more than this in an hour
  now = () => Date.now(),
} = {}) {
  const running = new Map(); // channel -> { signature, stop() }
  let reloadTimer = 0;
  let lastText = null;
  let stopped = false;

  function startBot(def) {
    const read = readCommands(def.c);
    const bot = { stopped: false, conn: null, disabled: "", failures: 0, posts: [], pausedUntil: 0 };
    const tag = `bot @${def.channel}`;

    if (read.state !== "ok") {
      log(`${tag}: the link could not be read, so it does nothing. Copy the link again from the editor.`);
      return { stop() {} };
    }
    if (!read.config.chat) {
      log(`${tag}: chat replies are not switched on in the editor, so it does nothing.`);
      return { stop() {} };
    }
    if (!read.config.commands.some((c) => c.reply)) {
      log(`${tag}: no command has a chat reply, so it does nothing.`);
      return { stop() {} };
    }

    const engine = createReplyEngine({
      commands: read.config.commands,
      prefix: read.config.prefix,
      cooldownSeconds: read.config.cooldown,
      gapSeconds,
      now,
    });
    const own = new Set(def.ownLogins);

    const onChat = (data) => {
      const m = mapChat(data);
      if (!m || own.has(String(m.login ?? "").toLowerCase())) return;
      const result = engine.handle({ id: m.id, user: m.user, text: m.text });
      if (result === "queued") log(`${tag}: ${m.login || m.name} asked, a reply is waiting.`);
    };

    const tick = setInterval(async () => {
      if (bot.stopped || bot.disabled || !bot.conn || now() < bot.pausedUntil) return;
      bot.posts = bot.posts.filter((at) => now() - at < 3_600_000);
      if (bot.posts.length >= maxPerHour) {
        engine.clear();
        return;
      }
      const item = engine.next();
      if (!item) return;
      try {
        await bot.conn.sendMessage(item.text);
        bot.posts.push(now());
        bot.failures = 0;
        log(`${tag}: posted "${item.text}"`);
      } catch (error) {
        bot.failures += 1;
        if (error?.name === "PremiumFeatureError") {
          bot.disabled = "refused";
          engine.clear();
          log(`${tag}: the signing service refused to send chat (it needs a paid plan or permission). The bot is switched off until the relay restarts.`);
        } else if (bot.failures >= 3) {
          bot.pausedUntil = now() + 600_000;
          engine.clear();
          log(`${tag}: three posts in a row failed (${error?.message ?? error}). Pausing for 10 minutes.`);
        } else {
          log(`${tag}: a post failed (${error?.message ?? error}).`);
        }
      }
    }, tickMs);

    (async () => {
      let attempt = 0;
      while (!bot.stopped && !bot.disabled) {
        try {
          const conn = await factory(def.channel, { apiKey, session: { sessionId: def.sessionId, ttTargetIdc: def.ttTargetIdc } });
          bot.conn = conn;
          const closed = new Promise((resolve) => {
            conn.on("disconnected", resolve);
            conn.on("streamEnd", resolve);
            conn.on("error", (error) => log(`${tag}: ${error?.message ?? error}`));
          });
          conn.on("chat", onChat);
          await conn.connect();
          attempt = 0;
          log(`${tag}: connected to @${def.channel}'s LIVE chat.`);
          await closed;
          log(`${tag}: the connection ended.`);
        } catch (error) {
          log(`${tag}: could not connect (${error?.message ?? error}). It tries again by itself.`);
        }
        bot.conn = null;
        if (bot.stopped || bot.disabled) break;
        await sleepFor(retryMs[Math.min(attempt, retryMs.length - 1)]);
        attempt += 1;
      }
    })();

    return {
      stop() {
        bot.stopped = true;
        clearInterval(tick);
        engine.clear();
        try { bot.conn?.disconnect?.(); } catch { /* it is closing anyway */ }
      },
    };
  }

  function reload() {
    if (stopped) return;
    let text;
    try {
      text = readText();
    } catch (error) {
      if (lastText === null) log(`Chat bot: could not read ${file || "the bot file"} (${error.message}).`);
      lastText = lastText ?? "";
      return;
    }
    if (text === lastText) return;
    lastText = text;
    const { bots, problems } = loadBots(text);
    problems.forEach((p) => log(`Chat bot: ${p}`));
    const wanted = new Map(bots.map((b) => [b.channel, b]));
    for (const [channel, entry] of running) {
      const def = wanted.get(channel);
      if (!def || entry.signature !== JSON.stringify(def)) {
        entry.stop();
        running.delete(channel);
      }
    }
    for (const [channel, def] of wanted) {
      if (!running.has(channel)) running.set(channel, { signature: JSON.stringify(def), ...startBot(def) });
    }
    log(`Chat bot: ${running.size} account${running.size === 1 ? "" : "s"} running.`);
  }

  return {
    start() {
      if (!readText) return;
      reload();
      reloadTimer = setInterval(reload, reloadMs);
      reloadTimer.unref?.();
    },
    /** For tests and the owner: read the file again now. */
    reloadNow: reload,
    stop() {
      stopped = true;
      clearInterval(reloadTimer);
      for (const entry of running.values()) entry.stop();
      running.clear();
    },
    get count() {
      return running.size;
    },
  };
}
