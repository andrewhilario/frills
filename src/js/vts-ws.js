// Minimal browser VTube Studio Public API v1.0 client (zero dependencies): connects to VTube Studio's
// built-in local WebSocket API on loopback (127.0.0.1, default port 8001), handles 1-click plugin Allow
// token flow, discovers live model hotkeys/expressions/items, and triggers VTuber actions cleanly.

export const VTS_HOST = "127.0.0.1";
export const VTS_DEFAULT_PORT = 8001;
const API_NAME = "VTubeStudioPublicAPI";
const API_VERSION = "1.0";

const STICKY_PALETTES = {
  yellow: { paper: "#fff29b", shade: "#f3da6c", curl: "#fff8c6", tape: "#f7aec5", tapeDot: "#ffe6ee", ink: "#3c241b", blush: "#f38ca2" },
  pink: { paper: "#ffd6e6", shade: "#f4b2cb", curl: "#ffecf3", tape: "#a9e0cb", tapeDot: "#e5fff4", ink: "#402131", blush: "#f2789a" },
  mint: { paper: "#d7f6d3", shade: "#b3e4ae", curl: "#edffeb", tape: "#ffd38c", tapeDot: "#fff4d9", ink: "#233927", blush: "#f395a6" },
  blue: { paper: "#d3ecff", shade: "#aed6fa", curl: "#ebf6ff", tape: "#fbb6ce", tapeDot: "#ffe8f0", ink: "#1e3046", blush: "#f294af" },
  lavender: { paper: "#e7d8ff", shade: "#ccb7f8", curl: "#f5efff", tape: "#ffde8a", tapeDot: "#fff6d8", ink: "#2f2247", blush: "#f292b2" },
};
const STICKY_KEYS = Object.keys(STICKY_PALETTES);
export const STICKY_SHAPES = ["note", "heart", "star", "paw", "cloud"];
const PLUS_STICKY_SHAPES = ["heart", "star", "paw", "cloud"];
const FALLBACK_1X1_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Picks the best face/head ArtMesh ID from a model's `artMeshNames` (or returns `preferred` when set). */
export function pickFaceMeshName(names, preferred = "") {
  const list = (names ?? []).map((n) => String(n ?? "").trim()).filter(Boolean);
  const want = String(preferred ?? "").trim();
  if (want) {
    const matched = list.find((n) => n === want) || list.find((n) => n.toLowerCase() === want.toLowerCase());
    return matched || want;
  }
  if (!list.length) return "";
  const avoid = /(eye|iris|pupil|lash|brow|mouth|lip|teeth|tooth|tongue|tear|shadow|shade|blush|highlight|shine|outline|line|neck|body|arm|hand|leg|cloth|shirt|dress|jacket|hair_back|back_hair|bg)/i;
  let best = "";
  let bestScore = 0;
  for (const name of list) {
    const n = name.toLowerCase();
    let score = 0;
    if (/(face_skin|skin_face|head_skin|face_base|facebase|face_0|kao)/.test(n)) score += 120;
    else if (/(forehead|cheek|face|head|atama)/.test(n)) score += 80;
    else if (/skin/.test(n)) score += 45;
    if (avoid.test(n)) score -= 90;
    if (/front|main|base/.test(n)) score += 15;
    if (score > bestScore) { bestScore = score; best = name; }
  }
  return best;
}

function wrapCanvasLines(ctx, text, maxWidth, maxLines = 2) {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  const words = raw.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
    } else if (!line) {
      let cut = word;
      while (cut.length > 2 && ctx.measureText(cut + "…").width > maxWidth) cut = cut.slice(0, -1);
      lines.push(cut.length < word.length ? cut + "…" : cut);
      if (lines.length >= maxLines) return lines;
    } else {
      lines.push(line);
      if (lines.length >= maxLines) return lines;
      line = word;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.slice(0, maxLines);
}

function drawSparkle4(ctx, cx, cy, r, fill, stroke = "") {
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.quadraticCurveTo(cx, cy, cx + r, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy + r);
    ctx.quadraticCurveTo(cx, cy, cx - r, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy - r);
    ctx.closePath();
  };
  ctx.save();
  trace();
  ctx.lineWidth = 9;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  trace();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = 3.5;
    ctx.lineJoin = "round";
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
  ctx.restore();
}

function drawCheeks(ctx, leftX, rightX, y, color, rx = 14, ry = 8) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.65;
  ctx.beginPath(); ctx.ellipse(leftX, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(rightX, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function traceHeartPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(0, 178);
  ctx.bezierCurveTo(-112, 118, -214, 34, -214, -58);
  ctx.bezierCurveTo(-214, -148, -142, -196, -78, -196);
  ctx.bezierCurveTo(-34, -196, -8, -168, 0, -138);
  ctx.bezierCurveTo(8, -168, 34, -196, 78, -196);
  ctx.bezierCurveTo(142, -196, 214, -148, 214, -58);
  ctx.bezierCurveTo(214, 34, 112, 118, 0, 178);
  ctx.closePath();
}

function traceStarPath(ctx, cx = 0, cy = 12, outerR = 224, innerR = 136) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  const n = pts.length;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    const t = i % 2 === 0 ? 0.26 : 0.28;
    const p1x = curr[0] + (prev[0] - curr[0]) * t;
    const p1y = curr[1] + (prev[1] - curr[1]) * t;
    const p2x = curr[0] + (next[0] - curr[0]) * t;
    const p2y = curr[1] + (next[1] - curr[1]) * t;
    if (i === 0) ctx.moveTo(p1x, p1y);
    else ctx.lineTo(p1x, p1y);
    ctx.quadraticCurveTo(curr[0], curr[1], p2x, p2y);
  }
  ctx.closePath();
}

function traceCloudPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(-134, 128);
  ctx.bezierCurveTo(-218, 128, -238, 42, -184, -4);
  ctx.bezierCurveTo(-206, -68, -142, -132, -78, -96);
  ctx.bezierCurveTo(-56, -182, 56, -186, 82, -98);
  ctx.bezierCurveTo(148, -134, 214, -68, 186, -2);
  ctx.bezierCurveTo(240, 44, 216, 128, 134, 128);
  ctx.closePath();
}

function tracePawPadPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(0, -34);
  ctx.bezierCurveTo(72, -34, 134, -2, 158, 56);
  ctx.bezierCurveTo(180, 110, 154, 184, 86, 184);
  ctx.bezierCurveTo(44, 184, 24, 168, 0, 168);
  ctx.bezierCurveTo(-24, 168, -44, 184, -86, 184);
  ctx.bezierCurveTo(-154, 184, -180, 110, -158, 56);
  ctx.bezierCurveTo(-134, -2, -72, -34, 0, -34);
  ctx.closePath();
}

function drawDieCutBackdrop(ctx, traceFn) {
  ctx.save();
  traceFn(ctx);
  ctx.lineWidth = 28;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.restore();
}

function drawStickyNoteShape(ctx, p) {
  ctx.translate(256, 266);
  ctx.rotate((-5 * Math.PI) / 180);

  const w = 382;
  const h = 382;
  const x0 = -w / 2;
  const y0 = -h / 2;
  const curl = 88;

  // Main note paper path with curved curled corner at bottom-right
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + w, y0);
  ctx.lineTo(x0 + w, y0 + h - curl);
  ctx.quadraticCurveTo(x0 + w - 26, y0 + h - 22, x0 + w - curl, y0 + h);
  ctx.lineTo(x0, y0 + h);
  ctx.closePath();
  ctx.fillStyle = p.paper;
  ctx.fill();

  // Soft interior highlight (left/top) & paper shade (right/bottom)
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.42)";
  ctx.fillRect(x0, y0, 14, h);
  ctx.fillRect(x0, y0, w, 12);
  ctx.fillStyle = p.shade;
  ctx.beginPath();
  ctx.moveTo(x0 + w - 26, y0);
  ctx.lineTo(x0 + w, y0);
  ctx.lineTo(x0 + w, y0 + h);
  ctx.lineTo(x0 + 40, y0 + h);
  ctx.quadraticCurveTo(x0 + w - 40, y0 + h - 42, x0 + w - 26, y0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Crisp outer paper ink stroke
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + w, y0);
  ctx.lineTo(x0 + w, y0 + h - curl);
  ctx.quadraticCurveTo(x0 + w - 26, y0 + h - 22, x0 + w - curl, y0 + h);
  ctx.lineTo(x0, y0 + h);
  ctx.closePath();
  ctx.lineWidth = 9;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = p.ink;
  ctx.stroke();

  // Curled corner flap
  ctx.beginPath();
  ctx.moveTo(x0 + w - curl, y0 + h);
  ctx.quadraticCurveTo(x0 + w - curl + 18, y0 + h - curl + 18, x0 + w - curl + 10, y0 + h - curl + 10);
  ctx.quadraticCurveTo(x0 + w - 34, y0 + h - curl + 14, x0 + w, y0 + h - curl);
  ctx.quadraticCurveTo(x0 + w - 26, y0 + h - 22, x0 + w - curl, y0 + h);
  ctx.closePath();
  ctx.fillStyle = p.curl;
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = p.ink;
  ctx.stroke();

  // Cute polka-dot washi tape at top center
  const tw = 148;
  const th = 54;
  const tx = -tw / 2;
  const ty = y0 - th * 0.56;
  const traceTape = () => {
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + tw, ty);
    for (let i = 1; i <= 4; i++) {
      ctx.lineTo(tx + tw - (i % 2 ? 9 : 0), ty + (th * i) / 4);
    }
    ctx.lineTo(tx, ty + th);
    for (let i = 3; i >= 0; i--) {
      ctx.lineTo(tx + (i % 2 ? 9 : 0), ty + (th * i) / 4);
    }
    ctx.closePath();
  };
  ctx.save();
  traceTape();
  ctx.fillStyle = p.tape;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = p.tapeDot;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 6; col++) {
      ctx.beginPath();
      ctx.arc(tx + 18 + col * 24 + (row % 2 ? 10 : 0), ty + 16 + row * 22, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  traceTape();
  ctx.lineWidth = 7;
  ctx.lineJoin = "round";
  ctx.strokeStyle = p.ink;
  ctx.stroke();
  ctx.restore();

  // Tiny kawaii face doodle in bottom-left corner
  const fx = x0 + 78;
  const fy = y0 + h - 46;
  ctx.fillStyle = p.ink;
  ctx.beginPath(); ctx.arc(fx - 22, fy - 4, 6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(fx + 22, fy - 4, 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = p.ink;
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(fx, fy - 1, 9, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.fillStyle = p.blush;
  ctx.beginPath(); ctx.ellipse(fx - 34, fy + 6, 8, 4.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(fx + 34, fy + 6, 8, 4.5, 0, 0, Math.PI * 2); ctx.fill();

  return { maxTextW: w - 58, centerY: -4, subShift: -18, maxMain: 64, minMain: 30, maxSub: 32 };
}

function drawHeartStickerShape(ctx, p) {
  ctx.translate(256, 270);
  ctx.rotate((-4 * Math.PI) / 180);

  drawDieCutBackdrop(ctx, traceHeartPath);
  traceHeartPath(ctx);
  ctx.fillStyle = p.paper;
  ctx.fill();

  // Inner crescent shading + glossy left lobe shine
  ctx.save();
  ctx.clip();
  ctx.fillStyle = p.shade;
  ctx.beginPath();
  ctx.moveTo(220, -140);
  ctx.bezierCurveTo(184, 34, 86, 134, -44, 186);
  ctx.lineTo(240, 190);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.72)";
  ctx.lineWidth = 18;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(-96, -92, 62, 1.15 * Math.PI, 1.68 * Math.PI);
  ctx.stroke();
  ctx.restore();

  // Ink outline
  traceHeartPath(ctx);
  ctx.lineWidth = 9;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = p.ink;
  ctx.stroke();

  // Kawaii rosy cheeks & sparkles
  drawCheeks(ctx, -114, 114, 24, p.blush, 16, 9);
  drawSparkle4(ctx, 146, -158, 22, "#ffffff", p.ink);
  drawSparkle4(ctx, -168, 108, 15, p.tape, p.ink);

  return { maxTextW: 266, centerY: -22, subShift: -16, maxMain: 56, minMain: 28, maxSub: 30 };
}

function drawStarStickerShape(ctx, p) {
  ctx.translate(256, 260);
  ctx.rotate((4 * Math.PI) / 180);

  drawDieCutBackdrop(ctx, traceStarPath);
  traceStarPath(ctx);
  ctx.fillStyle = p.paper;
  ctx.fill();

  // Inner soft rim highlight + lower shade
  ctx.save();
  ctx.clip();
  ctx.fillStyle = p.shade;
  ctx.beginPath();
  ctx.arc(36, 56, 210, -0.1 * Math.PI, 0.9 * Math.PI);
  ctx.lineTo(250, 250);
  ctx.lineTo(-250, 250);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.52)";
  ctx.beginPath();
  ctx.ellipse(-34, -96, 44, 18, -0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  traceStarPath(ctx);
  ctx.lineWidth = 9;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = p.ink;
  ctx.stroke();

  drawCheeks(ctx, -96, 96, 62, p.blush, 14, 8);
  drawSparkle4(ctx, -172, -138, 18, "#ffffff", p.ink);
  drawSparkle4(ctx, 178, -124, 14, p.tape, p.ink);

  return { maxTextW: 254, centerY: 12, subShift: -14, maxMain: 52, minMain: 24, maxSub: 28 };
}

function drawPawStickerShape(ctx, p) {
  ctx.translate(256, 264);
  ctx.rotate((-3 * Math.PI) / 180);

  const toes = [
    { x: -124, y: -96, rx: 46, ry: 60, rot: -0.34 },
    { x: 0, y: -138, rx: 48, ry: 64, rot: 0 },
    { x: 124, y: -96, rx: 46, ry: 60, rot: 0.34 },
  ];

  // Unified chunky white vinyl die-cut backing
  ctx.save();
  ctx.lineWidth = 30;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  for (const t of toes) {
    ctx.beginPath();
    ctx.ellipse(t.x, t.y, t.rx, t.ry, t.rot, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  tracePawPadPath(ctx);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Three pastel toe beans
  for (const t of toes) {
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(t.rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, t.rx, t.ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = p.tape;
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.58)";
    ctx.beginPath();
    ctx.ellipse(-12, -18, 12, 20, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 0, t.rx, t.ry, 0, 0, Math.PI * 2);
    ctx.lineWidth = 8.5;
    ctx.strokeStyle = p.ink;
    ctx.stroke();
    ctx.restore();
  }

  // Plump main paw pad carrying the gifter's name
  tracePawPadPath(ctx);
  ctx.fillStyle = p.paper;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = p.shade;
  ctx.beginPath();
  ctx.ellipse(42, 164, 175, 74, -0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath();
  ctx.ellipse(-56, 2, 66, 18, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  tracePawPadPath(ctx);
  ctx.lineWidth = 9;
  ctx.lineJoin = "round";
  ctx.strokeStyle = p.ink;
  ctx.stroke();

  drawSparkle4(ctx, 182, -162, 16, "#ffffff", p.ink);

  return { maxTextW: 266, centerY: 74, subShift: -15, maxMain: 52, minMain: 26, maxSub: 28 };
}

function drawCloudStickerShape(ctx, p) {
  ctx.translate(256, 272);
  ctx.rotate((-2 * Math.PI) / 180);

  drawDieCutBackdrop(ctx, traceCloudPath);
  traceCloudPath(ctx);
  ctx.fillStyle = p.paper;
  ctx.fill();

  // Fluffy lower pillow shade & top highlight puffs
  ctx.save();
  ctx.clip();
  ctx.fillStyle = p.shade;
  ctx.beginPath();
  ctx.rect(-240, 74, 480, 90);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  ctx.beginPath(); ctx.ellipse(-104, -62, 42, 22, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(16, -112, 54, 24, -0.1, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  traceCloudPath(ctx);
  ctx.lineWidth = 9;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = p.ink;
  ctx.stroke();

  drawCheeks(ctx, -130, 130, 62, p.blush, 16, 9);
  drawSparkle4(ctx, -172, -134, 20, "#ffffff", p.ink);
  drawSparkle4(ctx, 174, -124, 16, p.tape, p.ink);

  return { maxTextW: 296, centerY: 6, subShift: -16, maxMain: 58, minMain: 28, maxSub: 30 };
}

/**
 * Renders a crisp 512×512 transparent kawaii sticky note or custom sticker PNG (`note`, `heart`, `star`,
 * `paw`, `cloud`, or `random`) with the gifter's name & optional subtitle centered cleanly inside the shape,
 * returning raw base64 PNG bytes ready for VTS `ItemLoadRequest.customDataBase64`.
 */
export function renderStickyNoteBase64({ title = "Viewer", subtitle = "", color = "yellow", shape = "note" } = {}) {
  if (typeof document === "undefined") return FALLBACK_1X1_PNG;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext?.("2d");
  if (!ctx) return FALLBACK_1X1_PNG;

  const paletteKey = color === "random"
    ? STICKY_KEYS[Math.floor(Math.random() * STICKY_KEYS.length)]
    : (STICKY_PALETTES[color] ? color : "yellow");
  const p = STICKY_PALETTES[paletteKey];

  const resolvedShape = shape === "random"
    ? PLUS_STICKY_SHAPES[Math.floor(Math.random() * PLUS_STICKY_SHAPES.length)]
    : (STICKY_SHAPES.includes(shape) ? shape : "note");

  ctx.clearRect(0, 0, 512, 512);
  ctx.save();

  const bounds = resolvedShape === "heart"
    ? drawHeartStickerShape(ctx, p)
    : resolvedShape === "star"
      ? drawStarStickerShape(ctx, p)
      : resolvedShape === "paw"
        ? drawPawStickerShape(ctx, p)
        : resolvedShape === "cloud"
          ? drawCloudStickerShape(ctx, p)
          : drawStickyNoteShape(ctx, p);

  // Write the gifter's name (bold, centered, auto-sized to fit cleanly inside the shape)
  const mainText = String(title ?? "").trim() || "Viewer";
  const subText = String(subtitle ?? "").trim();
  const maxTextW = bounds.maxTextW;
  const fontStack = '"Fredoka", "Comic Sans MS", "Segoe UI", system-ui, sans-serif';
  const mainWords = mainText.split(/\s+/);
  let fontSize = mainText.length <= 8 ? bounds.maxMain : mainText.length <= 14 ? Math.max(bounds.minMain, bounds.maxMain - 10) : Math.max(bounds.minMain, bounds.maxMain - 18);
  let mainLines = [];
  while (fontSize >= bounds.minMain) {
    ctx.font = `800 ${fontSize}px ${fontStack}`;
    mainLines = wrapCanvasLines(ctx, mainText, maxTextW, 2);
    const fitsWithoutEllipsis = mainWords.every((w) => ctx.measureText(w).width <= maxTextW)
      && mainLines.join(" ").length >= mainText.length
      && mainLines.every((l) => ctx.measureText(l).width <= maxTextW);
    if (fitsWithoutEllipsis) break;
    fontSize -= 3;
  }

  ctx.fillStyle = p.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lineH = fontSize * 1.16;
  const hasSub = Boolean(subText);
  const blockCenter = hasSub ? bounds.centerY + bounds.subShift : bounds.centerY;
  const blockTop = blockCenter - ((mainLines.length - 1) * lineH) / 2;
  ctx.font = `800 ${fontSize}px ${fontStack}`;
  mainLines.forEach((ln, idx) => {
    ctx.fillText(ln, 0, blockTop + idx * lineH);
  });

  if (hasSub) {
    let subSize = bounds.maxSub;
    ctx.font = `700 ${subSize}px ${fontStack}`;
    while (subSize > 18 && ctx.measureText(subText).width > maxTextW) {
      subSize -= 2;
      ctx.font = `700 ${subSize}px ${fontStack}`;
    }
    const subLines = wrapCanvasLines(ctx, subText, maxTextW, 1);
    const subY = blockTop + (mainLines.length - 1) * lineH + fontSize * 0.86;
    ctx.globalAlpha = 0.82;
    ctx.fillText(subLines[0] || subText, 0, subY);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
  const dataUrl = canvas.toDataURL("image/png");
  return dataUrl.includes(",") ? dataUrl.split(",")[1] : FALLBACK_1X1_PNG;
}

/** Clamps a VTS port to 1..65535, falling back to 8001. */
export function cleanVtsPort(raw) {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 1 && n <= 65535 ? n : VTS_DEFAULT_PORT;
}

/**
 * VTube Studio Public API v1.0 WebSocket client with request/response correlation, 1-click plugin Allow
 * authentication, live model/hotkey/expression/item discovery, and bounded reconnect backoff.
 */
export class VtsClient {
  constructor({
    port = VTS_DEFAULT_PORT,
    token = "",
    pluginName = "Frills Actions",
    pluginDeveloper = "Frills",
    reconnect = true,
    interactiveAuth = false,
    onStatus = () => {},
    onToken = () => {},
    WebSocketCtor = globalThis.WebSocket,
  } = {}) {
    this.port = cleanVtsPort(port);
    this.token = String(token ?? "").trim();
    this.pluginName = pluginName;
    this.pluginDeveloper = pluginDeveloper;
    this.reconnect = Boolean(reconnect);
    this.interactiveAuth = Boolean(interactiveAuth);
    this.onStatus = onStatus;
    this.onToken = onToken;
    this.WebSocketCtor = WebSocketCtor;

    this.ws = null;
    this.state = "disconnected";
    this.seq = 0;
    this.pending = new Map();
    this.stopped = false;
    this.retryTimer = 0;
    this.retryAttempt = 0;
    this._customItemPerm = false;
  }

  get connected() {
    return this.state === "connected" && this.ws?.readyState === 1;
  }

  get url() {
    return `ws://${VTS_HOST}:${this.port}`;
  }

  configure({ port, token } = {}) {
    if (port !== undefined) this.port = cleanVtsPort(port);
    if (token !== undefined) this.token = String(token ?? "").trim();
  }

  _setStatus(state, detail = "") {
    this.state = state;
    this.onStatus({ state, detail, port: this.port });
  }

  connect() {
    this.stopped = false;
    clearTimeout(this.retryTimer);
    if (this.ws) {
      try { this.ws.close(1000, "reconnect"); } catch { /* ignore */ }
      this.ws = null;
    }
    if (!this.WebSocketCtor) {
      const err = new Error("WebSocket is unavailable in this browser.");
      this._setStatus("error", err.message);
      return Promise.reject(err);
    }

    this._setStatus("connecting", `Connecting to VTube Studio on port ${this.port}…`);

    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new this.WebSocketCtor(this.url);
      } catch (err) {
        const msg = err?.message || "Blocked by browser security settings.";
        this._setStatus("error", msg);
        reject(new Error(msg));
        return;
      }
      this.ws = ws;
      let settled = false;
      const done = (ok, val) => {
        if (settled) return;
        settled = true;
        if (ok) resolve(val);
        else reject(val);
      };

      ws.addEventListener("message", (ev) => {
        if (this.ws !== ws) return;
        let msg;
        try { msg = JSON.parse(String(ev.data ?? "")); } catch { return; }
        const entry = this.pending.get(msg?.requestID);
        if (!entry) return;
        this.pending.delete(msg.requestID);
        clearTimeout(entry.timer);
        if (msg.messageType === "APIError") {
          const err = new Error(msg.data?.message || `VTube Studio error (${msg.data?.errorID ?? "?"})`);
          err.vtsErrorId = msg.data?.errorID;
          entry.reject(err);
        } else {
          entry.resolve(msg.data ?? {});
        }
      });

      ws.addEventListener("open", async () => {
        if (this.ws !== ws) return;
        try {
          let authenticated = false;
          if (this.token) {
            const auth = await this._rawCall("AuthenticationRequest", {
              pluginName: this.pluginName,
              pluginDeveloper: this.pluginDeveloper,
              authenticationToken: this.token,
            }, 10000);
            authenticated = auth?.authenticated === true;
          }

          if (!authenticated) {
            if (!this.interactiveAuth) {
              this._setStatus("auth-error", "VTube Studio token is missing or expired. Reconnect in the Actions editor and copy your link again.");
              try { ws.close(1000, "auth-required"); } catch { /* ignore */ }
              done(false, new Error("VTube Studio authentication token required."));
              return;
            }
            this._setStatus("connecting", "Click “Allow” on the VTube Studio popup on your PC…");
            const tok = await this._rawCall("AuthenticationTokenRequest", {
              pluginName: this.pluginName,
              pluginDeveloper: this.pluginDeveloper,
            }, 60000);
            const nextToken = String(tok?.authenticationToken ?? "").trim();
            if (!nextToken) throw new Error("VTube Studio did not return an authentication token.");
            this.token = nextToken;
            this.onToken(nextToken);
            const auth2 = await this._rawCall("AuthenticationRequest", {
              pluginName: this.pluginName,
              pluginDeveloper: this.pluginDeveloper,
              authenticationToken: nextToken,
            }, 10000);
            if (auth2?.authenticated !== true) {
              throw new Error(auth2?.reason || "VTube Studio rejected authentication.");
            }
          }

          this.retryAttempt = 0;
          this._setStatus("connected", `Connected to VTube Studio (port ${this.port})`);
          done(true, { token: this.token });
        } catch (err) {
          const detail = err?.vtsErrorId === 50
            ? "Permission denied in VTube Studio. Click Connect VTS again and press Allow."
            : (err?.message || "Could not authenticate with VTube Studio.");
          this._setStatus("auth-error", detail);
          try { ws.close(1000, "auth-failed"); } catch { /* ignore */ }
          done(false, new Error(detail));
        }
      });

      ws.addEventListener("close", () => {
        if (this.ws !== ws) return;
        this.ws = null;
        this._rejectAll(new Error("VTube Studio connection closed."));
        if (this.stopped) {
          this._setStatus("disconnected", "Disconnected from VTube Studio.");
          done(false, new Error("Disconnected."));
          return;
        }
        if (this.state !== "auth-error") {
          const detail = this.state === "connecting"
            ? `Could not reach VTube Studio on port ${this.port}. Enable Settings → General → Start API (allow plugins) in VTube Studio.`
            : "Lost connection to VTube Studio.";
          this._setStatus("error", detail);
          done(false, new Error(detail));
        }
        if (this.reconnect && this.state !== "auth-error") {
          const delay = Math.min(15000, [2000, 4000, 8000, 15000][Math.min(this.retryAttempt, 3)]);
          this.retryAttempt += 1;
          this.retryTimer = setTimeout(() => { if (!this.stopped) this.connect().catch(() => {}); }, delay);
        }
      });

      ws.addEventListener("error", () => {});
    });
  }

  _rejectAll(err) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  _rawCall(messageType, data = {}, timeoutMs = 8000) {
    if (!this.ws || this.ws.readyState !== 1) return Promise.reject(new Error("VTube Studio socket is not open."));
    const requestID = `frills-vts-${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestID);
        reject(new Error(`VTube Studio timed out on ${messageType}.`));
      }, timeoutMs);
      this.pending.set(requestID, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ apiName: API_NAME, apiVersion: API_VERSION, requestID, messageType, data }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(requestID);
        reject(err);
      }
    });
  }

  /** Sends an authenticated VTube Studio Public API request and resolves with `data`. */
  call(messageType, data = {}, timeoutMs = 8000) {
    if (!this.connected) return Promise.reject(new Error("VTube Studio is not connected."));
    return this._rawCall(messageType, data, timeoutMs);
  }

  /** Queries VTube Studio for the active model, its hotkeys (including pinned Item Scenes), expressions, ArtMeshes, and Items folder files. */
  async discover() {
    const safe = (p, fallback) => p.catch(() => fallback);
    const [modelData, hotkeyData, exprData, itemData, meshData] = await Promise.all([
      safe(this.call("CurrentModelRequest"), { modelLoaded: false }),
      safe(this.call("HotkeysInCurrentModelRequest"), { availableHotkeys: [] }),
      safe(this.call("ExpressionStateRequest", { details: true }), { expressions: [] }),
      safe(this.call("ItemListRequest", {
        includeAvailableSpots: false,
        includeItemInstancesInScene: true,
        includeAvailableItemFiles: true,
      }), { availableItemFiles: [] }),
      safe(this.call("ArtMeshListRequest"), { artMeshNames: [] }),
    ]);

    const hotkeys = (hotkeyData.availableHotkeys ?? [])
      .map((h) => ({
        id: String(h.hotkeyID ?? ""),
        name: String(h.name || h.file || h.hotkeyID || "").trim(),
        type: String(h.type ?? ""),
      }))
      .filter((h) => h.id && h.name);

    const expressions = (exprData.expressions ?? [])
      .map((e) => ({
        name: String(e.name || e.file || "").trim(),
        file: String(e.file ?? "").trim(),
        active: Boolean(e.active),
      }))
      .filter((e) => e.file);

    const items = (itemData.availableItemFiles ?? [])
      .map((i) => String(i.fileName ?? "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    const artMeshes = [...new Set((meshData.artMeshNames ?? []).map((m) => String(m ?? "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));

    return {
      modelLoaded: Boolean(modelData.modelLoaded),
      modelName: String(modelData.modelName ?? ""),
      modelID: String(modelData.modelID ?? ""),
      hotkeys,
      expressions,
      items,
      artMeshes,
    };
  }

  /** Requests the one-time `LoadCustomImagesAsItems` VTS permission required for dynamic name sticky notes. */
  async ensureCustomItemPermission() {
    if (this._customItemPerm) return true;
    const res = await this.call("PermissionRequest", { requestedPermission: "LoadCustomImagesAsItems" }, 60000);
    const granted = res?.grantSuccess === true || (res?.permissions ?? []).some((p) => p?.name === "LoadCustomImagesAsItems" && p?.granted === true);
    if (!granted) {
      throw new Error("Allow “Load custom images as items” in VTube Studio so Frills can draw the gifter’s name on sticky notes.");
    }
    this._customItemPerm = true;
    return true;
  }

  /** Resolves the best ArtMesh on the currently loaded model to pin a sticky note onto (honoring a user-selected `preferred` mesh). */
  async resolveFaceArtMesh(preferred = "") {
    const res = await this.call("ArtMeshListRequest").catch(() => ({ artMeshNames: [] }));
    return pickFaceMeshName(res?.artMeshNames ?? [], preferred);
  }

  /** Opens VTube Studio's native ArtMesh picker so the streamer can visually click their forehead/cheek mesh once. */
  async pickFaceArtMesh(current = "") {
    const res = await this.call("ArtMeshSelectionRequest", {
      textOverride: "Pick 1 face or head ArtMesh where Frills should pin gift sticky notes.",
      helpOverride: "Pick your avatar’s face/skin mesh so sticky notes with gifter names stick and move with your head.",
      requestedArtMeshCount: 1,
      activeArtMeshes: current ? [current] : [],
    }, 60000);
    if (!res?.success || !res?.activeArtMeshes?.length) return "";
    return String(res.activeArtMeshes[0] ?? "").trim();
  }

  /** Resolves a friendly hotkey display name (e.g. "Sticky Note") or raw `hotkeyID` to its live VTS `hotkeyID`. */
  async resolveHotkeyId(nameOrId) {
    const wanted = String(nameOrId ?? "").trim();
    if (!wanted) return "";
    const res = await this.call("HotkeysInCurrentModelRequest").catch(() => ({ availableHotkeys: [] }));
    const list = res.availableHotkeys ?? [];
    const exactId = list.find((h) => h.hotkeyID === wanted);
    if (exactId) return exactId.hotkeyID;
    const lower = wanted.toLowerCase();
    const byName = list.find((h) => String(h.name ?? "").trim().toLowerCase() === lower || String(h.file ?? "").trim().toLowerCase() === lower);
    return byName ? String(byName.hotkeyID) : wanted;
  }

  /** Resolves an expression name or `.exp3.json` filename to its live VTS `expressionFile` and current `active` state. */
  async resolveExpression(nameOrFile) {
    const wanted = String(nameOrFile ?? "").trim();
    if (!wanted) return { file: "", active: false };
    const res = await this.call("ExpressionStateRequest", { details: true }).catch(() => ({ expressions: [] }));
    const list = res.expressions ?? [];
    const lower = wanted.toLowerCase();
    const found = list.find((e) =>
      String(e.file ?? "").trim().toLowerCase() === lower ||
      String(e.name ?? "").trim().toLowerCase() === lower ||
      String(e.file ?? "").replace(/\.exp3\.json$/i, "").trim().toLowerCase() === lower);
    return found ? { file: String(found.file), active: Boolean(found.active) } : { file: wanted, active: false };
  }

  close() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this._rejectAll(new Error("VTube Studio client closed."));
    if (this.ws) {
      const sock = this.ws;
      this.ws = null;
      try { sock.close(1000, "closed"); } catch { /* ignore */ }
    }
    this._setStatus("disconnected", "Disconnected from VTube Studio.");
  }
}
