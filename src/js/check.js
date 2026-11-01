// The browser check page: open it as a Browser source in a streaming app (or in any browser) and it says what THAT browser does with Frills, in plain words.
// It answers the question "it works on the website but not in my streaming app": is the app holding an old copy of the overlay, does it play animations,
// can it reach the relay, does the real overlay draw chat in it, and does the relay see your account LIVE. Nothing is changed or saved.
//   /check/                                    the browser, the relay, and the overlay drawing made-up messages
//   /check/?channel=yourname&platform=tiktok   also your account, and your link as the app would load it (give it the same address parts as your overlay link)

import { cleanTikTokUser, findTikTokSource, relayForPage } from "./tiktok.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rows = [];

/** Adds a line to the list, saying "checking…" until `done(state, text)` is called with "ok", "warn" or "bad". */
function row(title) {
  const li = document.createElement("li");
  li.className = "is-wait";
  const mark = document.createElement("span");
  mark.className = "check__mark";
  mark.textContent = "…";
  const name = document.createElement("strong");
  name.textContent = title;
  const detail = document.createElement("span");
  detail.className = "check__detail";
  detail.textContent = "checking…";
  li.append(mark, name, detail);
  $("list").append(li);
  const item = { title, state: "wait" };
  rows.push(item);
  return (state, text) => {
    item.state = state;
    li.className = "is-" + state;
    mark.textContent = { ok: "✓", warn: "!", bad: "✗" }[state];
    detail.textContent = text;
  };
}

/** Runs one check; whatever it throws becomes a red line instead of stopping the page. */
async function run(done, check) {
  try {
    const [state, text] = await check();
    done(state, text);
  } catch (error) {
    done("bad", "The check itself failed: " + (error && error.message ? error.message : String(error)));
  }
}

/** Listens to the relay (or the helper) for one account, and says what came: its words about the account, whether it is LIVE, and how many chat lines. */
function listen(base, user, ms, enough = 0) {
  return new Promise((resolve) => {
    const seen = { states: [], detail: "", chat: 0, firstChatMs: 0, live: null, followers: 0, failed: false };
    const t0 = Date.now();
    const id = "check" + Math.random().toString(36).slice(2, 10) + t0.toString(36);
    const source = new EventSource(`${base}/tiktok/stream?user=${encodeURIComponent(user)}${base ? `&page=${id}` : ""}`);
    let timer = 0;
    const finish = () => { clearTimeout(timer); source.close(); resolve(seen); };
    const read = (event, fn) => source.addEventListener(event, (e) => { try { fn(JSON.parse(e.data)); } catch { /* a damaged event is skipped */ } });
    read("status", (s) => { seen.states.push(String(s.state)); if (typeof s.detail === "string" && s.detail) seen.detail = s.detail; });
    read("info", (i) => { seen.live = i.live === true; seen.followers = Number(i.followers) || 0; });
    read("chat", () => { seen.chat += 1; if (!seen.firstChatMs) seen.firstChatMs = Date.now() - t0; if (enough && seen.chat >= enough) finish(); });
    source.onerror = () => { seen.failed = true; if (source.readyState === 2) finish(); };
    timer = setTimeout(finish, ms);
  });
}

/** Loads the overlay in a frame (it is on this same address, so the page can look inside) and counts the messages it has drawn. */
function frameTest(frame, src, ms, enough) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const look = () => {
      let count = 0;
      let note = "";
      let started = false;
      try {
        const doc = frame.contentDocument;
        started = Boolean(doc && doc.getElementById("stage"));
        count = doc ? doc.querySelectorAll("#chat .m").length : 0;
        const n = doc && doc.getElementById("note");
        note = n && !n.hidden ? n.textContent : "";
      } catch {
        resolve({ blocked: true });
        return;
      }
      if (count >= enough || Date.now() - t0 > ms) resolve({ count, note, started, seconds: (Date.now() - t0) / 1000 });
      else setTimeout(look, 300);
    };
    frame.addEventListener("load", () => setTimeout(look, 300), { once: true });
    frame.src = src;
  });
}

const channel = cleanTikTokUser(params.get("channel") ?? params.get("tiktok") ?? "");
const twitchOnly = params.get("platform") === "twitch" || (params.has("twitch") && !params.has("tiktok"));
const hasLink = params.has("channel") || params.has("tiktok") || params.has("twitch");

// the lines, in the order they are shown
const done = {
  browser: row("This browser"),
  copy: row("Newest overlay copy"),
  anim: row("Animations"),
  font: row("Fonts"),
  source: row("Where chat comes from"),
  practice: row("Made-up chat via the relay"),
  draw: row("The overlay draws chat"),
  ...(hasLink ? { own: row("Your link, as your app loads it") } : {}),
  ...(channel && !twitchOnly ? { account: row(`Your account @${channel}`) } : {}),
};

async function main() {
  await run(done.browser, async () => {
    const version = Number((/Chrome\/(\d+)/.exec(navigator.userAgent) ?? [])[1]);
    const size = `window ${innerWidth} x ${innerHeight}, ${document.visibilityState}`;
    if (!version) return ["warn", `Not a Chrome-based browser (${navigator.userAgent.slice(0, 90)}). ${size}`];
    if (version < 80) return ["bad", `Chrome ${version} is too old for Frills (it needs 80 or newer; Frills is tested from 100). ${size}`];
    if (version < 100) return ["warn", `Chrome ${version}. Frills is tested from 100, so some things may not draw exactly. ${size}`];
    return ["ok", `Chrome ${version}. ${size}`];
  });

  // The page this browser would show is the one it keeps; the newest is what the site serves right now. If they differ, the app is holding an old copy.
  await run(done.copy, async () => {
    const pick = (html) => (/\/assets\/overlay-[A-Za-z0-9_-]+\.js/.exec(html) ?? [])[0] ?? "";
    const url = "/overlay/?channel=check";
    const kept = pick(await fetch(url).then((r) => r.text()));
    const newest = pick(await fetch(url, { cache: "no-store" }).then((r) => r.text()));
    if (!newest) return ["bad", "Could not read the overlay page from the site."];
    if (kept !== newest) return ["bad", `This browser would load ${kept || "an old copy"} but the newest is ${newest}. Clear the app’s cache (in the Browser source: "Refresh cache of current page"), or make the source again.`];
    return ["ok", `This browser is not holding an old copy (${newest.replace("/assets/", "")}).`];
  });

  await run(done.anim, async () => {
    const box = document.createElement("div");
    box.className = "check__probe";
    const played = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 1500);
      box.addEventListener("animationend", () => { clearTimeout(timer); resolve(true); }, { once: true });
      document.body.append(box);
    });
    box.remove();
    return played ? ["ok", "Animations play. Chat bubbles can come in."] : ["bad", "Animations do not play in this browser, so chat bubbles could stay invisible."];
  });

  await run(done.font, async () => {
    const t0 = Date.now();
    await Promise.race([new FontFace("Fredoka", "url(/fonts/fredoka-500.woff2)").load(), wait(5000).then(() => { throw new Error("no answer in 5 seconds"); })]);
    return ["ok", `Loaded in ${Date.now() - t0} ms.`];
  });

  let found = null;
  await run(done.source, async () => {
    found = await findTikTokSource(relayForPage());
    if (!found) return ["bad", "Neither the relay nor a helper answered. This browser cannot reach the free Frills relay (check the internet, a firewall or VPN on this PC)."];
    return ["ok", found.kind === "relay" ? `The free Frills relay answers (${found.base.replace(/^https?:\/\//, "")}).` : "A Frills helper on this PC answers."];
  });

  const base = found ? found.base : "";
  const slow = [];
  if (found) {
    slow.push(run(done.practice, async () => {
      const seen = await listen(base, "frills_demo", 10000, 2);
      if (seen.chat > 0) return ["ok", `${seen.chat} made-up message${seen.chat === 1 ? "" : "s"} arrived (the first after ${(seen.firstChatMs / 1000).toFixed(1)} s). The connection works from here.`];
      return ["bad", `Nothing arrived in 10 seconds (${seen.failed ? "the connection failed" : "states: " + (seen.states.join(", ") || "none")}).`];
    }));
  } else done.practice("bad", "Skipped: nothing to connect to.");

  // the overlay itself, drawing made-up messages in this browser, in the look of the link when it has one
  slow.push(run(done.draw, async () => {
    const q = new URLSearchParams(location.search);
    for (const key of ["channel", "tiktok", "twitch", "platform", "demo", "pace"]) q.delete(key);
    if (!q.has("style") && !q.has("look")) { q.set("style", "latte"); q.set("palette", "latte"); }
    q.set("demo", "1");
    q.set("pace", "500");
    const result = await frameTest($("f-demo"), "/overlay/?" + q, 12000, 2);
    if (result.blocked) return ["warn", "This browser does not let the check look inside the overlay frame."];
    if (!result.started) return ["bad", "The overlay page did not start in this browser (its script did not run). The browser may be too old."];
    if (result.count >= 2) return ["ok", `The overlay drew ${result.count} messages in ${result.seconds.toFixed(1)} s${hasLink && (params.get("style") || params.get("look")) ? " in your look" : ""}.`];
    return ["bad", `The overlay started but drew ${result.count} messages in ${Math.round(result.seconds)} s${result.note ? ` (it says: "${result.note}")` : ""}.`];
  }));

  if (done.own) {
    $("fig-own").hidden = false;
    slow.push(run(done.own, async () => {
      const q = new URLSearchParams(location.search);
      q.delete("demo");
      const result = await frameTest($("f-own"), "/overlay/?" + q, 15000, 1);
      if (result.blocked) return ["warn", "This browser does not let the check look inside the overlay frame."];
      if (!result.started) return ["bad", "Your link did not start the overlay in this browser."];
      if (result.count >= 1) return ["ok", `Your link drew ${result.count} message${result.count === 1 ? "" : "s"} within ${Math.round(result.seconds)} s.`];
      return ["warn", `Your link started but showed no message in 15 s${result.note ? `. The overlay says: "${result.note}"` : ""}. Chat only shows while the account is LIVE.`];
    }));
  }

  if (done.account && found) {
    slow.push(run(done.account, async () => {
      const seen = await listen(base, channel, 15000);
      const last = seen.states[seen.states.length - 1] ?? "";
      const words = seen.detail ? ` (${seen.detail})` : "";
      if (last === "offline") return ["bad", `The relay says @${channel} is not LIVE right now${words}. Chat only comes while the account is LIVE. Check the spelling of the name too.`];
      if (last === "error") return ["bad", `The relay could not connect to @${channel}${words}.`];
      if (last === "queued") return ["warn", "The free relay is full right now and this account is waiting for a spot."];
      if (last === "limited") return ["warn", `TikTok’s free connection is busy right now${words}. It tries again by itself.`];
      if (last === "connected" && seen.live === false && !seen.chat) return ["warn", `The relay is connected to @${channel}, but TikTok does not say it is LIVE.`];
      if (last === "connected" && seen.chat > 0) return ["ok", `LIVE: ${seen.chat} chat message${seen.chat === 1 ? "" : "s"} in 15 s${seen.followers ? `, ${seen.followers.toLocaleString("en-US")} followers` : ""}.`];
      if (last === "connected") return ["warn", `Connected to @${channel} and LIVE, but no chat arrived in 15 s (a quiet chat?).`];
      return ["warn", `No answer about @${channel} in 15 s (states: ${seen.states.join(", ") || "none"}).`];
    }));
  } else if (done.account) done.account("bad", "Skipped: nothing to connect to.");

  await Promise.all(slow);

  const bad = rows.filter((r) => r.state === "bad");
  const warn = rows.filter((r) => r.state === "warn");
  const sum = $("sum");
  if (bad.length) {
    sum.dataset.state = "bad";
    sum.textContent = `${bad.length} problem${bad.length === 1 ? "" : "s"} found: ${bad.map((r) => r.title).join(", ")}. Take a screenshot of this page and send it.`;
  } else if (warn.length) {
    sum.dataset.state = "warn";
    sum.textContent = `This browser works. Look at: ${warn.map((r) => r.title).join(", ")}.`;
  } else {
    sum.dataset.state = "ok";
    sum.textContent = "Everything this browser needs works. If chat still does not show in your app, check the account name in your link and that you are LIVE.";
  }
  document.body.dataset.problems = String(bad.length);
  document.body.dataset.result = "done";
}

main();
