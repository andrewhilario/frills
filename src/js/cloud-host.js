// Live-updating Frills Plus cloud overlay host (/o/<id>):
//   1. Fetches the saved overlay target (/overlay/...?<query>) from GET /api/o/<id>
//   2. Mounts a full-bleed transparent same-origin iframe (allow="autoplay")
//   3. Polls GET /api/o/<id>?v=<version> every 3.5s and reloads cleanly the instant the streamer saves a change in any Frills editor

const ID_RE = /^\/o\/([A-Za-z0-9_-]{12})\/?$/;
const POLL_MS = 3500;
const root = document.getElementById("cloud-root");
const note = document.getElementById("note");

const say = (text) => {
  if (!note) return;
  note.hidden = !text;
  note.textContent = text;
};

/** Only allows relative same-origin Frills overlay URLs (/overlay/...). */
function safeOverlayTarget(rawUrl, version) {
  if (typeof rawUrl !== "string" || !rawUrl.startsWith("/overlay/")) return "";
  try {
    const parsed = new URL(rawUrl, location.origin);
    if (parsed.origin !== location.origin || !parsed.pathname.startsWith("/overlay/")) return "";
    parsed.searchParams.set("_cv", String(version));
    return parsed.pathname + parsed.search;
  } catch {
    return "";
  }
}

const match = ID_RE.exec(location.pathname);
const id = match ? match[1] : "";

if (!id) {
  say("This Frills cloud overlay link is incomplete.");
} else {
  let frame = null;
  let version = 0;
  let cmdSeq = null;
  let activeKind = "";
  let activeUrl = "";
  let stopped = false;
  let timer = 0;
  let fails = 0;
  let lastSavedState = "";

  const cleanChannel = (s) => String(s ?? "").trim().replace(/^@+/, "").toLowerCase();

  /** Derives an exact key matcher for the active overlay so sibling OBS sources never collide. */
  const matchesKeyFor = (kind, rawUrl) => {
    if (!kind || !rawUrl) return null;
    try {
      const p = new URL(rawUrl, location.origin).searchParams;
      const tt = cleanChannel(p.get("tiktok"));
      const tw = cleanChannel(p.get("twitch"));
      const platform = tt && tw ? "both" : p.get("platform") === "twitch" ? "twitch" : "tiktok";
      const channel = tt && tw ? `${tt}+${tw}` : cleanChannel(p.get("channel"));
      if (kind === "timer") {
        const code = String(p.get("code") || "").trim();
        const key = `frills:timer:state:${code || channel || "demo"}`;
        return (k) => k === key;
      }
      if (!channel) return null;
      if (kind === "jar") return (k) => k === `frills:jar:${channel}`;
      if (kind === "goal") {
        const t = String(p.get("type") || "follow").trim() || "follow";
        const key = t === "follow" ? `frills:goal:${channel}` : `frills:goal:${channel}:${t}`;
        return (k) => k === key;
      }
      if (kind === "gifters" || kind === "likers") {
        const base = kind === "gifters" ? `frills:gifters:${platform}:${channel}` : `frills:likers:${channel}`;
        const period = p.get("period") || "all";
        if (period === "week") return (k) => k.startsWith(`${base}:w:`);
        if (period === "month") return (k) => k.startsWith(`${base}:m:`);
        return (k) => k === base;
      }
    } catch { /* ignore */ }
    return null;
  };

  const restoreState = (stateObj) => {
    if (!stateObj || typeof stateObj !== "object") return;
    try {
      for (const [k, v] of Object.entries(stateObj)) {
        if (typeof k === "string" && k.startsWith("frills:") && typeof v === "string") {
          localStorage.setItem(k, v);
        }
      }
      lastSavedState = JSON.stringify(stateObj);
    } catch { /* storage blocked */ }
  };

  const checkpointState = () => {
    if (stopped || !frame) return;
    const isMatch = matchesKeyFor(activeKind, activeUrl);
    if (!isMatch) return;
    try {
      const snap = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !isMatch(k)) continue;
        const val = localStorage.getItem(k);
        if (val !== null && val.length <= 14000) snap[k] = val;
      }
      const nextJson = JSON.stringify(snap);
      if (nextJson === "{}" || nextJson === lastSavedState || nextJson.length > 16000) return;
      lastSavedState = nextJson;
      fetch(`/api/o/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: snap }),
      }).catch(() => {});
    } catch { /* ignore */ }
  };

  const dispatchCommands = (cmds) => {
    if (!Array.isArray(cmds) || !cmds.length || !frame?.contentWindow) return;
    let shouldFlush = false;
    for (const item of cmds) {
      try {
        frame.contentWindow.dispatchEvent(new CustomEvent("frills:cloud-cmd", { detail: item }));
        const c = String(item?.cmd ?? "");
        if (c === "gifters:reset" || c === "likers:reset" || c === "jar:clear" || c === "goal:reset") shouldFlush = true;
      } catch { /* ignore */ }
    }
    if (shouldFlush) setTimeout(checkpointState, 600);
  };

  const mountTarget = (targetUrl) => {
    if (!frame) {
      frame = document.createElement("iframe");
      frame.className = "cloud-frame";
      frame.setAttribute("allow", "autoplay");
      frame.title = "Frills live overlay";
      root.replaceChildren(frame);
    }
    frame.src = targetUrl;
  };

  const poll = async () => {
    if (stopped) return;
    try {
      const params = new URLSearchParams();
      if (version > 0) params.set("v", String(version));
      if (cmdSeq !== null) params.set("c", String(cmdSeq));
      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/o/${id}${qs}`, { cache: "no-store" });
      if (res.status === 404) {
        stopped = true;
        if (frame) { frame.remove(); frame = null; }
        say("This Frills cloud overlay was removed or does not exist.");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      fails = 0;
      if (data?.ok) {
        say("");
        if (data.kind) activeKind = data.kind;
        if (data.url) activeUrl = data.url;
        if (version === 0 && data.state) restoreState(data.state);
        if (cmdSeq !== null && Array.isArray(data.cmds) && data.cmds.length) {
          dispatchCommands(data.cmds);
        }
        if (Number.isFinite(Number(data.cmdSeq))) cmdSeq = Number(data.cmdSeq);
        if (data.changed !== false && Number(data.version) > 0 && Number(data.version) !== version) {
          const target = safeOverlayTarget(data.url, data.version);
          if (target) {
            version = Number(data.version);
            mountTarget(target);
          }
        }
      }
    } catch {
      fails += 1;
      if (!frame && fails >= 2) say("Connecting to Frills cloud overlay…");
    }
    if (!stopped) {
      const wait = fails > 2 ? Math.min(20000, POLL_MS * Math.min(5, fails)) : POLL_MS;
      timer = setTimeout(poll, wait);
    }
  };

  const ckTimer = setInterval(checkpointState, 12000);
  window.addEventListener("pagehide", () => {
    stopped = true;
    clearTimeout(timer);
    clearInterval(ckTimer);
  });

  poll();
}
