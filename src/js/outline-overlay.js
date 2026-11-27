// Live Stream Outline & Border overlay (/overlay/outline/):
// 100% purely visual (zero relay slots, zero network polling).
// - Direct Free links render all Free frame styles, transparent widget cutouts, decor, and up to 5 card rows cleanly.
// - When hosted inside a verified same-origin Frills Plus cloud frame (/o/<id>), unlocks Plus styles/wallpapers/10 rows
//   and responds live to Phone Remote Deck commands (outline:next, outline:prev, outline:set, outline:reset).

import { fontsReady, generalFaces } from "./look.js";
import { FREE_ROW_LIMIT, OUTLINE, PLUS_ROW_LIMIT, parseCardRows } from "./outline.js";
import { createOutlineView } from "./outline-view.js";

const BC_NAME = "frills:outline:live";
const CLOUD_STEP_KEY = "frills:outline:step";

function isHostedInCloudFrame() {
  try {
    return (
      window.self !== window.top &&
      window.parent.location.origin === window.location.origin &&
      /^\/o\/[A-Za-z0-9_-]{12}\/?$/.test(window.parent.location.pathname)
    );
  } catch {
    return false;
  }
}

const params = new URLSearchParams(location.search);
const plusActive = isHostedInCloudFrame();
let settings = OUTLINE.sanitize(OUTLINE.fromParams(params));

if (plusActive) {
  try {
    const savedRow = Number(localStorage.getItem(CLOUD_STEP_KEY));
    if (Number.isInteger(savedRow) && savedRow >= -1) settings.highlightRow = savedRow;
  } catch { /* storage blocked */ }
}

const root = document.getElementById("outline-root");
const view = createOutlineView(root, { previewAll: false, editorOnly: false });

const persistRow = (row) => {
  try { localStorage.setItem(CLOUD_STEP_KEY, String(row)); } catch { /* ignore */ }
};

const render = () => {
  view.apply(settings, { plusActive, showSafeZones: false, showCutoutHints: false });
};

const rowCount = () => parseCardRows(settings.cardItems, { limit: plusActive ? PLUS_ROW_LIMIT : FREE_ROW_LIMIT }).length;

const setHighlight = (nextRow) => {
  const n = rowCount();
  const val = Math.round(Number(nextRow));
  const clamped = !Number.isFinite(val) || val < 0 || n === 0 ? -1 : Math.min(n - 1, val);
  settings = { ...settings, highlightRow: clamped };
  persistRow(clamped);
  render();
};

const stepHighlight = (delta) => {
  const n = rowCount();
  if (!n) return;
  const cur = settings.highlightRow;
  if (cur < 0) setHighlight(delta > 0 ? 0 : n - 1);
  else {
    const next = cur + delta;
    setHighlight(next < 0 || next >= n ? -1 : next);
  }
};

// Local same-PC highlight sync from /outline/ editor
try {
  if (typeof BroadcastChannel === "function") {
    const bc = new BroadcastChannel(BC_NAME);
    bc.onmessage = (ev) => {
      if (ev?.data?.type === "highlight") setHighlight(ev.data.row);
    };
  }
} catch { /* ignore */ }

// Frills Plus Phone Remote Deck live commands dispatched by /o/<id> (`cloud-host.js`)
window.addEventListener("frills:cloud-cmd", (ev) => {
  const detail = ev?.detail;
  const cmd = String(detail?.cmd ?? "");
  if (cmd === "outline:next") stepHighlight(1);
  else if (cmd === "outline:prev") stepHighlight(-1);
  else if (cmd === "outline:reset") setHighlight(-1);
  else if (cmd === "outline:set") setHighlight(Number(detail?.value));
});

fontsReady(generalFaces(settings), 900).then(render);
render();
