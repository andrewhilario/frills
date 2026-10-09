// Reads a Twitch channel's chat inside the page: no login, no key, no helper program.
// It joins as an anonymous viewer (a "justinfan" name with digits, the long-standing read-only guest login) over Twitch's chat
// WebSocket. Twitch's current docs say a login token is required and don't describe guest reads, so this could stop working one
// day; if Twitch refuses the guest login, the status says so instead of retrying forever.
// Parsing and shaping a message are separate from the connection, so they can be tested without a network.

const ENDPOINT = "wss://irc-ws.chat.twitch.tv:443";
const OPEN = 1;

const ESCAPES = { ":": ";", s: " ", r: "\r", n: "\n", "\\": "\\" };
const unescapeTag = (value) => value.replace(/\\([\s\S]?)/g, (_, c) => (c in ESCAPES ? ESCAPES[c] : c));

/** One line of Twitch chat protocol -> { tags, prefix, command, params, trailing }, or null if it isn't one. */
export function parseIrc(line) {
  let rest = line.replace(/\r?\n$/, "");
  const tags = {};
  if (rest.startsWith("@")) {
    const end = rest.indexOf(" ");
    if (end === -1) return null;
    for (const pair of rest.slice(1, end).split(";")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      tags[eq === -1 ? pair : pair.slice(0, eq)] = eq === -1 ? "" : unescapeTag(pair.slice(eq + 1));
    }
    rest = rest.slice(end + 1).trimStart();
  }
  let prefix = "";
  if (rest.startsWith(":")) {
    const end = rest.indexOf(" ");
    if (end === -1) return null;
    prefix = rest.slice(1, end);
    rest = rest.slice(end + 1).trimStart();
  }
  let trailing = null;
  const t = rest.indexOf(" :");
  if (t !== -1) {
    trailing = rest.slice(t + 2);
    rest = rest.slice(0, t);
  }
  const params = rest.split(" ").filter(Boolean);
  const command = params.shift();
  if (!command) return null;
  return { tags, prefix, command, params, trailing };
}

const badgeNames = (value) => (value ? value.split(",").map((b) => b.split("/")[0]).filter(Boolean) : []);

/** "25:0-4,12-16/1902:6-10" -> [{ id, start, end }] in order. Positions count code points (so an emoji is one), and bad ones are dropped. */
export function parseEmotes(tag, text) {
  if (!tag) return [];
  const length = Array.from(text).length;
  const out = [];
  for (const group of tag.split("/")) {
    const [id, ranges] = group.split(":");
    if (!id || !ranges) continue;
    for (const range of ranges.split(",")) {
      const m = /^(\d+)-(\d+)$/.exec(range);
      if (!m) continue;
      const start = Number(m[1]);
      const end = Number(m[2]);
      if (start <= end && end < length) out.push({ id, start, end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** A PRIVMSG line -> the neutral chat message the overlays use, or null for anything else. */
export function toChatMessage(p) {
  if (!p || p.command !== "PRIVMSG" || p.trailing === null) return null;
  let text = p.trailing;
  const action = /^\u0001ACTION ([\s\S]*?)\u0001?$/.exec(text); // "/me ..." arrives wrapped like this
  if (action) text = action[1];
  const bang = p.prefix.indexOf("!");
  const user = (bang === -1 ? p.prefix : p.prefix.slice(0, bang)).toLowerCase();
  const tags = p.tags;
  const badges = badgeNames(tags.badges);
  const bits = Number(tags.bits) > 0;
  return {
    id: tags.id || "",
    user,
    name: (tags["display-name"] || "").trim() || user,
    text,
    color: /^#[0-9a-fA-F]{6}$/.test(tags.color || "") ? tags.color : null,
    mod: tags.mod === "1" || badges.includes("moderator"),
    broadcaster: badges.includes("broadcaster"),
    subscriber: tags.subscriber === "1" || badges.includes("subscriber") || badges.includes("founder"),
    vip: badges.includes("vip"),
    first: tags["first-msg"] === "1",
    emotes: parseEmotes(tags.emotes, text),
    gift: bits,
    gifter: bits,
    action: Boolean(action),
    source: "twitch",
  };
}

/** What a person typed -> a channel login, or "" if it can't be one. Also keeps anything odd out of the commands we send. */
export function cleanChannel(input) {
  const name = String(input ?? "").trim().replace(/^#/, "").toLowerCase();
  return /^[a-z0-9_]{1,25}$/.test(name) ? name : "";
}

/**
 * Joins a channel and calls back as things happen. Reconnects by itself (growing waits, with a little jitter), answers the
 * server's pings, and notices a connection that has gone silent. Returns { stop() }.
 *   onMessage(msg)   a chat message
 *   onRemove({ id }) a moderator deleted one message
 *   onClear({ user }) a moderator timed out or banned someone (user), or cleared the whole chat (no user)
 *   onStatus({ state, channel, detail, fatal }) state: connecting, connected, reconnecting, error, stopped
 */
export function connect({ channel, onMessage, onRemove, onClear, onStatus, socketFactory, reconnectBase = 1000, reconnectMax = 30000, pingEvery = 45000, silentAfter = 100000 } = {}) {
  const login = cleanChannel(channel);
  const say = (state, detail, fatal = false) => onStatus && onStatus({ state, channel: login, detail, fatal });
  if (!login) {
    say("error", "Channel names are letters, numbers and _ only.", true);
    return { stop() {} };
  }
  const nick = "justinfan" + (10000 + Math.floor(Math.random() * 89999));
  let socket = null;
  let stopped = false;
  let joined = false; // the current socket has been let into the channel
  let attempt = 0; // failed tries in a row, which sets how long to wait before the next
  let retryTimer = 0;
  let pingTimer = 0;
  let lastHeard = 0;

  const send = (line) => {
    if (socket && socket.readyState === OPEN) socket.send(line);
  };

  // Lets go of the current socket first, so nothing it does afterwards can reach us.
  function drop() {
    clearInterval(pingTimer);
    const s = socket;
    socket = null;
    if (!s) return;
    s.onopen = s.onmessage = s.onclose = s.onerror = null;
    try { s.close(); } catch { /* already closed */ }
  }

  function retry() {
    if (stopped) return;
    drop();
    const wait = Math.min(reconnectMax, reconnectBase * 2 ** attempt) * (0.75 + Math.random() * 0.5);
    attempt += 1;
    say("reconnecting");
    retryTimer = setTimeout(open, wait);
  }

  function handle(line) {
    const p = parseIrc(line);
    if (!p) return;
    switch (p.command) {
      case "PING":
        send("PONG :" + (p.trailing ?? "tmi.twitch.tv"));
        break;
      case "JOIN":
      case "ROOMSTATE":
      case "366":
        if (!joined) say("connected");
        joined = true;
        attempt = 0;
        break;
      case "PRIVMSG": {
        const m = toChatMessage(p);
        if (m && onMessage) onMessage(m);
        break;
      }
      case "CLEARMSG":
        if (p.tags["target-msg-id"] && onRemove) onRemove({ id: p.tags["target-msg-id"] });
        break;
      case "CLEARCHAT":
        if (onClear) onClear({ user: (p.trailing || "").toLowerCase() });
        break;
      case "RECONNECT": // Twitch is moving us to another server
        retry();
        break;
      case "NOTICE":
        if (/login (authentication )?failed|improperly formatted auth|invalid nick/i.test(p.trailing || "")) {
          stopped = true;
          drop();
          say("error", "Twitch no longer lets guests read chat, so a Twitch login would be needed.", true);
        } else if (p.tags["msg-id"] === "msg_channel_suspended") {
          say("error", "That channel is suspended.");
        }
        break;
      default:
    }
  }

  function open() {
    if (stopped) return;
    joined = false;
    say(attempt === 0 ? "connecting" : "reconnecting");
    let s;
    try {
      s = (socketFactory ?? ((url) => new WebSocket(url)))(ENDPOINT);
    } catch {
      retry();
      return;
    }
    socket = s;
    s.onopen = () => {
      if (s !== socket) return;
      lastHeard = Date.now();
      send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      send("PASS SCHMOOPIIE");
      send("NICK " + nick);
      send("JOIN #" + login);
      clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (Date.now() - lastHeard > silentAfter) retry(); // nothing at all, not even replies to our pings
        else send("PING :tmi.twitch.tv");
      }, pingEvery);
    };
    s.onmessage = (event) => {
      if (s !== socket) return;
      lastHeard = Date.now();
      for (const line of String(event.data).split("\r\n")) if (line) handle(line);
    };
    s.onclose = () => {
      if (s === socket) retry();
    };
    s.onerror = () => {}; // a close always follows
  }

  open();
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(retryTimer);
      drop();
      say("stopped");
    },
  };
}
