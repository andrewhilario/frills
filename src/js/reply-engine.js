// The chat bot's brain: no network and no page. It is shown the chat messages, and says what to post in the chat and when.
// Whatever carries the reply to TikTok (a signed-in session, an API) asks `next()` and posts what it gets. This part is shared and tested
// with a pretend clock, so the rules that keep the bot from flooding or answering itself do not depend on the way of posting.
//
//   const bot = createReplyEngine({ commands, prefix: ".", cooldownSeconds: 10, gapSeconds: 5, maxQueue: 3 });
//   bot.handle(message)   // { id, user, text }  ->  "queued", or why not ("cooldown", "duplicate", "own", "dropped", "ignored", "no reply")
//   bot.next()            // the next reply to post ({ trigger, text }), or null when there is none or it is too soon after the last one

import { cleanReply, matchCommand } from "./actions.js";

const SEEN_LIMIT = 500; // message ids remembered, so one message is never answered twice
const ECHO_MS = 60_000; // a reply the bot posted comes back through chat: it must never be taken for a viewer's command

export function createReplyEngine({
  commands = [],
  prefix = ".",
  cooldownSeconds = 10, // the same command is answered at most this often (for everyone: it is a bot, not a per-person limit)
  gapSeconds = 5, // at least this long between any two posts, so five different commands cannot flood the chat
  maxQueue = 3, // replies waiting to be posted; when it is full a new one is dropped, never piled up
  ownIds = [], // the ids of the account that posts, so its own messages are ignored
  now = () => Date.now(),
} = {}) {
  const own = new Set(ownIds.map(String));
  const cooldownMs = Math.max(0, cooldownSeconds) * 1000;
  const gapMs = Math.max(0, gapSeconds) * 1000;
  const seen = new Set();
  const lastAnswered = new Map(); // trigger -> when it was last queued
  const echoes = new Map(); // reply text -> when it was posted
  const queue = [];
  let lastPostAt = -Infinity;
  const stats = { queued: 0, dropped: 0, posted: 0 };

  const forgetOldEchoes = (t) => {
    for (const [text, at] of echoes) if (t - at > ECHO_MS) echoes.delete(text);
  };

  return {
    handle(message) {
      if (!message || typeof message.text !== "string") return "ignored";
      const id = String(message.id ?? "");
      if (id) {
        if (seen.has(id)) return "duplicate";
        seen.add(id);
        if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value);
      }
      if (message.user && own.has(String(message.user))) return "own";

      const t = now();
      forgetOldEchoes(t);
      if (echoes.has(cleanReply(message.text))) return "own";

      const match = matchCommand(message.text, commands, prefix);
      if (!match) return "ignored";
      const text = cleanReply(match.reply);
      if (!text) return "no reply";

      const key = match.trigger.toLowerCase();
      if (cooldownMs && t - (lastAnswered.get(key) ?? -Infinity) < cooldownMs) return "cooldown";
      if (queue.length >= maxQueue) {
        stats.dropped += 1; // a full line does not use up the cooldown: the next viewer who asks may get an answer
        return "dropped";
      }
      lastAnswered.set(key, t);
      queue.push({ trigger: match.trigger, text, queuedAt: t });
      stats.queued += 1;
      return "queued";
    },

    /** The next reply to post, or null. Calling it is what counts as posting: the reply leaves the line and the gap starts. */
    next() {
      const t = now();
      if (!queue.length || t - lastPostAt < gapMs) return null;
      const item = queue.shift();
      lastPostAt = t;
      echoes.set(item.text, t);
      stats.posted += 1;
      return item;
    },

    /** The kill switch: everything waiting is thrown away. */
    clear() {
      queue.length = 0;
    },

    get waiting() {
      return queue.length;
    },
    stats() {
      return { ...stats, waiting: queue.length };
    },
  };
}
