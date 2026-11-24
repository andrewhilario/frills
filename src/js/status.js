// Public Live Server & Relay Status page (/status/): probes same-origin /api/status (Cloudflare edge + both TikTok relays)
// and Twitch WebSocket reachability directly from the visitor's browser without triggering CORS errors.
// Everything dynamic is written via textContent/dataset — never HTML.

import { initNav } from "./nav.js";

const $ = (id) => document.getElementById(id);

function uptimeText(s) {
  if (typeof s !== "number" || s < 0) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return ""; }
}

function applyRelayCard(r, ids, fallbackHost) {
  const card = $(ids.card);
  const pill = $(ids.pill);
  if (!r) {
    card.dataset.state = "warn";
    pill.textContent = "Not checked";
    $(ids.spots).textContent = "—";
    $(ids.queue).textContent = "—";
    $(ids.signing).textContent = "—";
    $(ids.uptime).textContent = "—";
    return "warn";
  }
  $(ids.host).textContent = r.host || fallbackHost;
  if (!r.ok) {
    card.dataset.state = "down";
    pill.textContent = r.status ? `Offline (${r.status})` : "Unreachable";
    $(ids.spots).textContent = "Server offline";
    $(ids.queue).textContent = "—";
    $(ids.signing).textContent = "Offline";
    $(ids.uptime).textContent = r.latencyMs ? `${r.latencyMs} ms (down)` : "Timeout / Error";
    $(ids.fill).style.width = "0%";
    return "down";
  }
  const slots = r.slots ?? { used: 0, max: 30, waiting: 0 };
  const max = Math.max(1, Number(slots.max) || 30);
  const used = Math.max(0, Number(slots.used) || 0);
  const free = typeof r.free === "number" ? r.free : Math.max(0, max - used);
  const waiting = Number(slots.waiting) || 0;
  const fillPct = Math.min(100, Math.round((used / max) * 100));
  $(ids.fill).style.width = Math.max(fillPct, used > 0 ? 4 : 0) + "%";

  const busy = Boolean(r.signing?.busy);
  const state = free === 0 || busy ? "warn" : r.level === "low" ? "warn" : "ok";
  card.dataset.state = state;
  pill.textContent = free === 0 ? "Full (Queue open)" : r.level === "low" ? "Busy" : "Operational";
  $(ids.spots).textContent = `${free} of ${max} free`;
  $(ids.queue).textContent = waiting ? `${waiting} waiting` : "No wait";
  $(ids.signing).textContent = busy ? "Busy (retrying)" : r.signing?.busyRecently ? "Recovering" : "Healthy";
  $(ids.uptime).textContent = `${r.latencyMs ?? "—"} ms · up ${uptimeText(r.uptimeS)}`;
  return state;
}

async function probeServerAndRelays(relayUrl, plusRelayUrl) {
  const relayIds = {
    card: "svc-relay",
    host: "relay-host",
    pill: "relay-pill",
    fill: "relay-fill",
    spots: "relay-spots",
    queue: "relay-queue",
    signing: "relay-signing",
    uptime: "relay-uptime",
  };
  const plusIds = {
    card: "svc-plus-relay",
    host: "plus-relay-host",
    pill: "plus-relay-pill",
    fill: "plus-relay-fill",
    spots: "plus-relay-spots",
    queue: "plus-relay-queue",
    signing: "plus-relay-signing",
    uptime: "plus-relay-uptime",
  };
  const rHost = hostOf(relayUrl);
  const pHost = hostOf(plusRelayUrl);
  const t0 = performance.now();

  try {
    const res = await fetch("/api/status", { headers: { accept: "application/json" }, cache: "no-store" });
    const latency = Math.max(1, Math.round(performance.now() - t0));
    if (!res.ok) {
      $("svc-edge").dataset.state = "down";
      $("edge-pill").textContent = `HTTP ${res.status}`;
      $("edge-latency").textContent = `${latency} ms`;
      $("edge-api").textContent = "Error";
      return ["down", "down", "down"];
    }
    const data = await res.json();
    $("svc-edge").dataset.state = "ok";
    $("edge-pill").textContent = "Operational";
    $("edge-latency").textContent = `${latency} ms`;
    $("edge-api").textContent = "Edge + Worker ready";

    const list = Array.isArray(data.relays) ? data.relays : [];
    const mainRelay = list.find((r) => r.host === rHost) ?? list[0];
    const dedicatedRelay = list.find((r) => r.host === pHost) ?? (list.length > 1 ? list[1] : null);
    return [
      "ok",
      applyRelayCard(mainRelay, relayIds, rHost),
      applyRelayCard(dedicatedRelay, plusIds, pHost),
    ];
  } catch {
    $("svc-edge").dataset.state = "down";
    $("edge-pill").textContent = "Unreachable";
    $("edge-latency").textContent = "—";
    $("edge-api").textContent = "Offline";
    return [
      "down",
      applyRelayCard(null, relayIds, rHost),
      applyRelayCard(null, plusIds, pHost),
    ];
  }
}

function probeTwitch() {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let settled = false;
    const finish = (state, pillText, detail, latency) => {
      if (settled) return;
      settled = true;
      $("svc-twitch").dataset.state = state;
      $("twitch-pill").textContent = pillText;
      $("twitch-state").textContent = detail;
      $("twitch-latency").textContent = latency;
      resolve(state);
    };
    if (typeof WebSocket !== "function") {
      finish("down", "No WebSocket", "Blocked in browser", "—");
      return;
    }
    let ws;
    const timer = setTimeout(() => {
      try { ws?.close(); } catch { /* ignore */ }
      finish("warn", "Slow", "Timed out (>4s)", ">4,000 ms");
    }, 4000);
    try {
      ws = new WebSocket("wss://irc-ws.chat.twitch.tv");
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        const ms = Math.max(1, Math.round(performance.now() - t0));
        try { ws.close(); } catch { /* ignore */ }
        finish("ok", "Operational", "WebSocket connected", `${ms} ms`);
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        finish("down", "Blocked", "Connection refused", "—");
      });
    } catch {
      clearTimeout(timer);
      finish("down", "Error", "WebSocket failed", "—");
    }
  });
}

let checking = false;
async function runChecks() {
  if (checking) return;
  checking = true;
  const board = document.querySelector(".status-board");
  const relayUrl = board?.dataset.relayUrl || "";
  const plusRelayUrl = board?.dataset.plusRelayUrl || "";
  const btn = $("status-refresh");
  if (btn) btn.disabled = true;

  const [serverStates, twitchState] = await Promise.all([
    probeServerAndRelays(relayUrl, plusRelayUrl),
    probeTwitch(),
  ]);
  const results = [...serverStates, twitchState];
  const down = results.filter((s) => s === "down").length;
  const warn = results.filter((s) => s === "warn").length;
  const hero = $("status-hero");
  const headline = $("status-headline");
  const sub = $("status-sub");

  if (down > 0) {
    hero.dataset.state = "down";
    headline.textContent = down === 1 ? "One server needs attention" : `${down} servers are unreachable`;
    sub.textContent = "One or more components failed to respond. Check the cards below for details.";
  } else if (warn > 0) {
    hero.dataset.state = "warn";
    headline.textContent = "Systems online — free relay is busy";
    sub.textContent = "All servers are up, though free TikTok relay capacity is tight or queueing right now.";
  } else {
    hero.dataset.state = "ok";
    headline.textContent = "All systems operational";
    sub.textContent = "Cloudflare edge, TikTok relays, and Twitch direct sockets are responding normally.";
  }

  $("status-time").textContent = "Checked " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (btn) btn.disabled = false;
  checking = false;
}

initNav();
$("status-refresh")?.addEventListener("click", runChecks);
runChecks();
setInterval(() => {
  if (!document.hidden) runChecks();
}, 15000);
