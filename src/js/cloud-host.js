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
  let stopped = false;
  let timer = 0;
  let fails = 0;

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
      const qs = version > 0 ? `?v=${version}` : "";
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

  window.addEventListener("pagehide", () => {
    stopped = true;
    clearTimeout(timer);
  });

  poll();
}
