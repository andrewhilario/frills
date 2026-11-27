// Shared parametric SVG + CSS renderer for Stream Outline (/outline/ editor & /overlay/outline/ live source).
// Pure SVG presentation attributes + external CSS classes (zero inline style="" attributes -> strict style-src 'self' CSP).

import { PACKS } from "./decor.js";
import { luminance, rgba } from "./color.js";
import { FONTS } from "./settings.js";
import { mediaUrl } from "./alerts-settings.js";
import {
  OUTLINE_BACKDROPS,
  TIKTOK_SAFE_ZONES,
  boxMinSize,
  clampBoxRect,
  computeOutlineGeometry,
  effectiveOutlineSettings,
  listEditableBoxes,
} from "./outline.js";

const SVG_NS = "http://www.w3.org/2000/svg";
let uidCounter = 0;

function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    node.setAttribute(k, String(v));
  }
  for (const child of children) {
    if (child == null) continue;
    if (typeof child === "string") node.append(document.createTextNode(child));
    else node.append(child);
  }
  return node;
}

/** Contrasting ink (#17171f or #ffffff) guaranteed readable over `hex`. */
function inkOn(hex) {
  return luminance(hex) > 0.42 ? "#181822" : "#ffffff";
}

/** Truncates text cleanly to fit inside an SVG box width estimate. */
function fitText(str, maxChars) {
  const s = String(str ?? "").trim();
  if (!s) return "";
  if (s.length <= maxChars) return s;
  return s.slice(0, Math.max(1, maxChars - 1)).trimEnd() + "…";
}

/** Builds an SVG path `d` for a cutout shape: rect (rounded), circle, arch, cyber chamfer, or 8-bit pixel staircase. */
function shapePath(box, radius, frameStyle) {
  const { x, y, w, h, shape = "rect" } = box;
  if (shape === "circle") {
    const r = Math.min(w, h) / 2;
    const cx = x + w / 2;
    const cy = y + h / 2;
    return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
  }
  if (shape === "arch") {
    const r = Math.min(w / 2, h * 0.48);
    const br = Math.min(radius, 24);
    return [
      `M ${x} ${y + r}`,
      `A ${r} ${r} 0 0 1 ${x + w} ${y + r}`,
      `L ${x + w} ${y + h - br}`,
      `Q ${x + w} ${y + h} ${x + w - br} ${y + h}`,
      `L ${x + br} ${y + h}`,
      `Q ${x} ${y + h} ${x} ${y + h - br}`,
      "Z",
    ].join(" ");
  }
  if (frameStyle === "cyber") {
    const c = Math.max(16, Math.min(36, Math.round(Math.min(w, h) * 0.08)));
    return [
      `M ${x + c} ${y}`,
      `L ${x + w - c} ${y}`,
      `L ${x + w} ${y + c}`,
      `L ${x + w} ${y + h - c}`,
      `L ${x + w - c} ${y + h}`,
      `L ${x + c} ${y + h}`,
      `L ${x} ${y + h - c}`,
      `L ${x} ${y + c}`,
      "Z",
    ].join(" ");
  }
  if (frameStyle === "pixel") {
    const s = Math.max(8, Math.min(18, Math.round(Math.min(w, h) * 0.03)));
    const s2 = s * 2;
    return [
      `M ${x + s2} ${y}`,
      `H ${x + w - s2}`,
      `V ${y + s} H ${x + w - s} V ${y + s2} H ${x + w}`,
      `V ${y + h - s2}`,
      `H ${x + w - s} V ${y + h - s} H ${x + w - s2} V ${y + h}`,
      `H ${x + s2}`,
      `V ${y + h - s} H ${x + s} V ${y + h - s2} H ${x}`,
      `V ${y + s2}`,
      `H ${x + s} V ${y + s} H ${x + s2}`,
      "Z",
    ].join(" ");
  }
  const r = Math.max(0, Math.min(radius, Math.floor(Math.min(w, h) / 2)));
  if (r <= 1) return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
  return [
    `M ${x + r} ${y}`,
    `H ${x + w - r}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `V ${y + h - r}`,
    `Q ${x + w} ${y + h} ${x + w - r} ${y + h}`,
    `H ${x + r}`,
    `Q ${x} ${y + h} ${x} ${y + h - r}`,
    `V ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    "Z",
  ].join(" ");
}

/** Draws a 4-point sparkle star centered at (cx, cy) with outer radius r. */
function star4Path(cx, cy, r) {
  const ir = r * 0.34;
  return [
    `M ${cx} ${cy - r}`,
    `Q ${cx + ir * 0.5} ${cy - ir * 0.5} ${cx + r} ${cy}`,
    `Q ${cx + ir * 0.5} ${cy + ir * 0.5} ${cx} ${cy + r}`,
    `Q ${cx - ir * 0.5} ${cy + ir * 0.5} ${cx - r} ${cy}`,
    `Q ${cx - ir * 0.5} ${cy - ir * 0.5} ${cx} ${cy - r}`,
    "Z",
  ].join(" ");
}

/** Draws a cute symmetrical heart centered at (cx, cy) with size s. */
function heartPath(cx, cy, s) {
  return [
    `M ${cx} ${cy + s * 0.85}`,
    `C ${cx - s * 1.1} ${cy + s * 0.15} ${cx - s * 1.05} ${cy - s * 0.85} ${cx} ${cy - s * 0.25}`,
    `C ${cx + s * 1.05} ${cy - s * 0.85} ${cx + s * 1.1} ${cy + s * 0.15} ${cx} ${cy + s * 0.85}`,
    "Z",
  ].join(" ");
}

/** Draws symmetrical SVG corner filigree curls for the Celestial style. */
function buildCelestialCorner(x, y, sx, sy, color, pop) {
  const g = svgEl("g", { transform: `translate(${x} ${y}) scale(${sx} ${sy})` });
  g.append(
    svgEl("path", {
      d: "M 0 58 C 0 18 18 0 58 0 M 10 42 C 12 20 20 12 42 10 M 0 28 C 12 28 28 12 28 0",
      fill: "none",
      stroke: color,
      "stroke-width": 3,
      "stroke-linecap": "round",
    }),
    svgEl("circle", { cx: 14, cy: 14, r: 4.5, fill: pop }),
    svgEl("path", { d: star4Path(34, 24, 7), fill: pop, opacity: 0.9 }),
  );
  return g;
}

/** Draws a cute ribbon bow centered at (cx, cy) for the Plush Ribbon Kawaii style. */
function buildRibbonBow(cx, cy, accent, pop, cream) {
  const g = svgEl("g", { class: "ol-ribbon-bow" });
  g.append(
    // trailing tails
    svgEl("path", { d: `M ${cx - 10} ${cy + 8} L ${cx - 34} ${cy + 42} L ${cx - 18} ${cy + 34} L ${cx - 8} ${cy + 46} L ${cx - 2} ${cy + 12} Z`, fill: pop, stroke: cream, "stroke-width": 3, "stroke-linejoin": "round" }),
    svgEl("path", { d: `M ${cx + 10} ${cy + 8} L ${cx + 34} ${cy + 42} L ${cx + 18} ${cy + 34} L ${cx + 8} ${cy + 46} L ${cx + 2} ${cy + 12} Z`, fill: pop, stroke: cream, "stroke-width": 3, "stroke-linejoin": "round" }),
    // left & right loops
    svgEl("path", { d: `M ${cx - 6} ${cy} C ${cx - 46} ${cy - 32} ${cx - 58} ${cy + 26} ${cx - 6} ${cy + 8} Z`, fill: accent, stroke: cream, "stroke-width": 3.5, "stroke-linejoin": "round" }),
    svgEl("path", { d: `M ${cx + 6} ${cy} C ${cx + 46} ${cy - 32} ${cx + 58} ${cy + 26} ${cx + 6} ${cy + 8} Z`, fill: accent, stroke: cream, "stroke-width": 3.5, "stroke-linejoin": "round" }),
    // center knot
    svgEl("rect", { x: cx - 11, y: cy - 9, width: 22, height: 20, rx: 8, fill: pop, stroke: cream, "stroke-width": 3 }),
  );
  return g;
}

/** Renders the frame chrome around one cutout or panel box according to `s.frameStyle` and `s.motion`. */
function buildFrameGroup(box, s, ids, { isPanel = false } = {}) {
  const { x, y, w, h, shape = "rect", primary = false } = box;
  const sw = Math.max(2, Number(s.strokeW) || 6);
  const rad = s.frameStyle === "pixel" ? 0 : Math.max(0, Math.min(48, Number(s.radius) || 20));
  const d = shapePath(box, rad, s.frameStyle);
  const cream = "#fffdf6";
  const g = svgEl("g", { class: `ol-frame ol-frame--${s.frameStyle}` });

  // Outer drop shadow or soft glow halo
  if (s.frameStyle === "sticker" || s.shadow === "hard") {
    g.append(
      svgEl("path", {
        d,
        fill: isPanel ? rgba(s.bg, (s.bgAlpha ?? 95) / 100) : "none",
        stroke: "rgba(20, 14, 28, 0.42)",
        "stroke-width": sw + (s.frameStyle === "sticker" ? 8 : 2),
        transform: "translate(7 7)",
      }),
    );
  } else if (s.frameStyle === "neon" || s.frameStyle === "cyber" || s.shadow === "glow") {
    g.append(
      svgEl("path", {
        class: "ol-glow-layer",
        d,
        fill: "none",
        stroke: s.accent,
        "stroke-width": sw + 12,
        opacity: s.frameStyle === "neon" ? 0.36 : 0.24,
        filter: `url(#${ids.glow})`,
      }),
    );
  }

  // Optional filled surface for panels (agenda / nameplate)
  if (isPanel) {
    const panelFill = s.frameStyle === "scrapbook" ? "#fffaf0" : rgba(s.bg, Math.max(0.72, (s.bgAlpha ?? 95) / 100));
    g.append(svgEl("path", { d, fill: panelFill }));
  }

  // Style-specific layered vector strokes & accents
  if (s.frameStyle === "sticker") {
    g.append(
      svgEl("path", { d, fill: "none", stroke: cream, "stroke-width": sw + 9, "stroke-linejoin": "round" }),
      svgEl("path", { d, fill: "none", stroke: s.accent, "stroke-width": sw, "stroke-linejoin": "round" }),
    );
    if (shape === "rect" && w > 120 && h > 90) {
      const inset = Math.max(8, Math.round(sw * 1.1));
      g.append(
        svgEl("path", {
          d: shapePath({ x: x + inset, y: y + inset, w: w - inset * 2, h: h - inset * 2, shape }, Math.max(4, rad - 6), "clean"),
          fill: "none",
          stroke: rgba(cream, 0.72),
          "stroke-width": 2,
          "stroke-dasharray": "9 8",
          "stroke-linecap": "round",
        }),
      );
    }
  } else if (s.frameStyle === "neon") {
    g.append(
      svgEl("path", { d, fill: "none", stroke: "rgba(12, 10, 22, 0.85)", "stroke-width": sw + 8 }),
      svgEl("path", { class: "ol-glow-layer", d, fill: "none", stroke: `url(#${ids.strokeGrad})`, "stroke-width": sw + 5, opacity: 0.6, filter: `url(#${ids.glow})` }),
      svgEl("path", { d, fill: "none", stroke: `url(#${ids.strokeGrad})`, "stroke-width": sw }),
      svgEl("path", { d, fill: "none", stroke: "#ffffff", "stroke-width": Math.max(1.5, sw * 0.34), opacity: 0.9 }),
    );
    if (shape === "rect" && w > 240) {
      for (const tx of [x + w * 0.25, x + w * 0.75]) {
        g.append(
          svgEl("rect", { x: tx - 8, y: y - sw / 2 - 4, width: 16, height: sw + 8, rx: 3, fill: "#1f2030", stroke: rgba("#ffffff", 0.3), "stroke-width": 1.2 }),
          svgEl("rect", { x: tx - 8, y: y + h - sw / 2 - 4, width: 16, height: sw + 8, rx: 3, fill: "#1f2030", stroke: rgba("#ffffff", 0.3), "stroke-width": 1.2 }),
        );
      }
    }
  } else if (s.frameStyle === "window") {
    const barH = Math.min(38, Math.max(28, Math.round(h * 0.08)));
    g.append(
      svgEl("path", { d, fill: "none", stroke: s.accent, "stroke-width": sw + 2 }),
      svgEl("path", { d, fill: "none", stroke: rgba("#ffffff", 0.45), "stroke-width": 2 }),
    );
    if (shape === "rect") {
      const rTop = Math.min(rad, barH / 2);
      const barPath = `M ${x} ${y + barH} V ${y + rTop} Q ${x} ${y} ${x + rTop} ${y} H ${x + w - rTop} Q ${x + w} ${y} ${x + w} ${y + rTop} V ${y + barH} Z`;
      const ink = inkOn(s.accent);
      g.append(
        svgEl("path", { d: barPath, fill: s.accent }),
        svgEl("path", { d: star4Path(x + 24, y + barH / 2, 7), fill: ink, opacity: 0.9 }),
        svgEl("rect", { x: x + 38, y: y + barH / 2 - 4, width: 22, height: 8, rx: 4, fill: s.pop, opacity: 0.9 }),
        svgEl("text", {
          x: x + w / 2,
          y: y + barH / 2 + 5,
          "text-anchor": "middle",
          fill: ink,
          "font-family": FONTS[s.font] || FONTS.Fredoka,
          "font-size": 15,
          "font-weight": 700,
          "letter-spacing": "0.06em",
        }, String(box.label || "STREAM.EXE").toUpperCase()),
      );
    }
  } else if (s.frameStyle === "pixel") {
    g.append(
      svgEl("path", { d, fill: "none", stroke: "#101320", "stroke-width": sw + 6, "shape-rendering": "crispEdges" }),
      svgEl("path", { d, fill: "none", stroke: s.accent, "stroke-width": sw, "shape-rendering": "crispEdges" }),
    );
    if (shape === "rect") {
      const sq = Math.max(10, sw + 4);
      for (const [cx, cy] of [[x - 2, y - 2], [x + w - sq + 2, y - 2], [x - 2, y + h - sq + 2], [x + w - sq + 2, y + h - sq + 2]]) {
        g.append(svgEl("rect", { x: cx, y: cy, width: sq, height: sq, fill: s.pop, stroke: "#101320", "stroke-width": 2 }));
      }
    }
  } else if (s.frameStyle === "cyber") {
    g.append(
      svgEl("path", { d, fill: "none", stroke: rgba(s.bg, 0.85), "stroke-width": sw + 6 }),
      svgEl("path", { d, fill: "none", stroke: `url(#${ids.strokeGrad})`, "stroke-width": sw }),
    );
    if (shape === "rect") {
      const L = Math.min(54, Math.round(Math.min(w, h) * 0.14));
      const off = Math.round(sw * 0.8 + 4);
      const brackets = [
        `M ${x - off} ${y + L} V ${y + 18} L ${x + 18} ${y - off} H ${x + L}`,
        `M ${x + w - L} ${y - off} H ${x + w - 18} L ${x + w + off} ${y + 18} V ${y + L}`,
        `M ${x + w + off} ${y + h - L} V ${y + h - 18} L ${x + w - 18} ${y + h + off} H ${x + w - L}`,
        `M ${x + L} ${y + h + off} H ${x + 18} L ${x - off} ${y + h - 18} V ${y + h - L}`,
      ];
      for (const bd of brackets) {
        g.append(svgEl("path", { d: bd, fill: "none", stroke: s.pop, "stroke-width": Math.max(4, sw * 0.8), "stroke-linecap": "square" }));
      }
      // Side telemetry ticks
      if (w > 260) {
        for (let i = 0; i < 4; i++) {
          g.append(svgEl("rect", { x: x + w / 2 - 34 + i * 18, y: y - off - 2, width: 10, height: 5, fill: i % 2 === 0 ? s.pop : s.accent }));
        }
      }
    }
  } else if (s.frameStyle === "celestial") {
    g.append(
      svgEl("path", { d, fill: "none", stroke: s.accent, "stroke-width": Math.max(3, sw * 0.72) }),
    );
    if (shape === "rect" && w > 120 && h > 90) {
      g.append(
        svgEl("path", {
          d: shapePath({ x: x + 9, y: y + 9, w: w - 18, h: h - 18, shape }, Math.max(4, rad - 8), "clean"),
          fill: "none",
          stroke: s.pop,
          "stroke-width": 2,
          opacity: 0.85,
        }),
        buildCelestialCorner(x - 4, y - 4, 1, 1, s.accent, s.pop),
        buildCelestialCorner(x + w + 4, y - 4, -1, 1, s.accent, s.pop),
        buildCelestialCorner(x - 4, y + h + 4, 1, -1, s.accent, s.pop),
        buildCelestialCorner(x + w + 4, y + h + 4, -1, -1, s.accent, s.pop),
      );
      if (primary) {
        // Crescent moon emblem at top center
        const mx = x + w / 2;
        const my = y;
        g.append(
          svgEl("circle", { cx: mx, cy: my, r: 22, fill: s.bg, stroke: s.accent, "stroke-width": 2.5 }),
          svgEl("path", { d: `M ${mx + 5} ${my - 12} A 13 13 0 1 0 ${mx + 5} ${my + 12} A 9.5 9.5 0 1 1 ${mx + 5} ${my - 12} Z`, fill: s.pop }),
          svgEl("path", { d: star4Path(mx - 36, my, 8), fill: s.pop }),
          svgEl("path", { d: star4Path(mx + 36, my, 8), fill: s.pop }),
        );
      }
    }
  } else if (s.frameStyle === "scrapbook") {
    g.append(
      svgEl("path", { d, fill: "none", stroke: "#f8efe0", "stroke-width": sw + 12, "stroke-linejoin": "round" }),
      svgEl("path", { d, fill: "none", stroke: rgba(s.accent, 0.8), "stroke-width": Math.max(2, sw * 0.5), "stroke-dasharray": "6 5" }),
    );
    if (shape === "rect") {
      // Tilted pastel washi tape strips on opposite corners
      const tapeW = Math.min(116, Math.round(w * 0.22));
      const tapeH = 26;
      const t1 = svgEl("g", { transform: `translate(${x + 22} ${y + 8}) rotate(-28)` });
      t1.append(
        svgEl("rect", { x: -tapeW / 2, y: -tapeH / 2, width: tapeW, height: tapeH, rx: 3, fill: rgba(s.accent, 0.85), stroke: "#fffdf6", "stroke-width": 2 }),
        svgEl("line", { x1: -tapeW / 2 + 12, y1: 0, x2: tapeW / 2 - 12, y2: 0, stroke: rgba("#ffffff", 0.55), "stroke-width": 3, "stroke-dasharray": "8 8" }),
      );
      const t2 = svgEl("g", { transform: `translate(${x + w - 22} ${y + h - 8}) rotate(-28)` });
      t2.append(
        svgEl("rect", { x: -tapeW / 2, y: -tapeH / 2, width: tapeW, height: tapeH, rx: 3, fill: rgba(s.pop, 0.82), stroke: "#fffdf6", "stroke-width": 2 }),
        svgEl("line", { x1: -tapeW / 2 + 12, y1: 0, x2: tapeW / 2 - 12, y2: 0, stroke: rgba("#ffffff", 0.55), "stroke-width": 3, "stroke-dasharray": "6 6" }),
      );
      g.append(t1, t2);
    }
  } else if (s.frameStyle === "ribbon") {
    g.append(
      svgEl("path", { d, fill: "none", stroke: cream, "stroke-width": sw + 10, "stroke-linejoin": "round" }),
      svgEl("path", { d, fill: "none", stroke: `url(#${ids.strokeGrad})`, "stroke-width": sw + 1, "stroke-linejoin": "round" }),
    );
    if (shape === "rect" && primary) {
      g.append(
        buildRibbonBow(x + w / 2, y, s.accent, s.pop, cream),
        svgEl("path", { d: heartPath(x + 22, y + h - 14, 14), fill: s.pop, stroke: cream, "stroke-width": 2.5 }),
        svgEl("path", { d: heartPath(x + w - 22, y + h - 14, 12), fill: s.accent, stroke: cream, "stroke-width": 2.5 }),
      );
    }
  } else {
    // clean minimal
    g.append(
      svgEl("path", { d, fill: "none", stroke: s.accent, "stroke-width": sw }),
    );
    if (shape === "rect" && w > 120 && h > 90) {
      g.append(
        svgEl("path", {
          d: shapePath({ x: x + 8, y: y + 8, w: w - 16, h: h - 16, shape }, Math.max(2, rad - 6), "clean"),
          fill: "none",
          stroke: rgba("#ffffff", 0.35),
          "stroke-width": 1.5,
        }),
      );
    }
  }

  // Animated overlays (orbiting neon beam / shimmer / twinkling stars)
  if (s.motion === "orbit") {
    g.append(
      svgEl("path", {
        class: "ol-orbit-beam",
        d,
        pathLength: 100,
        fill: "none",
        stroke: s.pop,
        "stroke-width": sw + 2,
        "stroke-linecap": "round",
        filter: `url(#${ids.glow})`,
      }),
    );
  } else if (s.motion === "shimmer") {
    g.append(
      svgEl("path", {
        class: "ol-shimmer-beam",
        d,
        pathLength: 100,
        fill: "none",
        stroke: "#ffffff",
        "stroke-width": Math.max(2, sw * 0.6),
        "stroke-linecap": "round",
        opacity: 0.72,
      }),
    );
  } else if (s.motion === "twinkle" && shape === "rect") {
    const pts = [
      [x + 18, y + 18, 9, "ol-star-a"],
      [x + w - 18, y + 20, 11, "ol-star-b"],
      [x + w - 20, y + h - 18, 8, "ol-star-c"],
      [x + 20, y + h - 20, 10, "ol-star-a"],
    ];
    for (const [sx, sy, sr, cls] of pts) {
      g.append(svgEl("path", { class: `ol-twinkle-star ${cls}`, d: star4Path(sx, sy, sr), fill: s.pop, stroke: "#ffffff", "stroke-width": 1.2 }));
    }
  }

  return g;
}

/** Renders the nameplate / channel status bar (and optional Frills Plus rotating socials pill). */
function buildNameplate(rect, s, ids, socialIdx) {
  const { x, y, w, h } = rect;
  const font = FONTS[s.font] || FONTS.Fredoka;
  const g = svgEl("g", { class: "ol-nameplate" });
  const panelStyle = s.frameStyle === "window" ? "clean" : s.frameStyle;
  g.append(buildFrameGroup({ x, y, w, h, shape: "rect" }, { ...s, frameStyle: panelStyle, strokeW: Math.min(5, s.strokeW) }, ids, { isPanel: true }));

  const textCol = s.frameStyle === "scrapbook" ? "#2e241b" : s.text;
  let cursorX = x + 24;
  const midY = y + h / 2;

  if (s.liveBadge) {
    const badgeW = 86;
    const badgeH = 34;
    g.append(
      svgEl("rect", { x: cursorX, y: midY - badgeH / 2, width: badgeW, height: badgeH, rx: badgeH / 2, fill: s.pop }),
      svgEl("circle", { class: "ol-live-dot", cx: cursorX + 18, cy: midY, r: 5.5, fill: inkOn(s.pop) }),
      svgEl("text", {
        x: cursorX + 32,
        y: midY + 5,
        fill: inkOn(s.pop),
        "font-family": font,
        "font-size": 15,
        "font-weight": 800,
        "letter-spacing": "0.08em",
      }, "LIVE"),
    );
    cursorX += badgeW + 18;
  }

  const handle = fitText(s.handle || "@yourhandle", 26);
  const tagline = fitText(s.tagline || "", w > 900 ? 48 : 28);
  const handleSize = h >= 80 ? 28 : 24;

  g.append(
    svgEl("text", {
      x: cursorX,
      y: tagline && w < 720 ? midY - 4 : midY + 9,
      fill: textCol,
      "font-family": font,
      "font-size": handleSize,
      "font-weight": 700,
    }, handle),
  );

  if (tagline) {
    if (w < 720) {
      g.append(
        svgEl("text", {
          x: cursorX,
          y: midY + 21,
          fill: textCol,
          opacity: 0.78,
          "font-family": font,
          "font-size": 15,
          "font-weight": 600,
        }, tagline),
      );
    } else {
      const approxHandleW = Math.min(340, handle.length * (handleSize * 0.58) + 28);
      g.append(
        svgEl("circle", { cx: cursorX + approxHandleW, cy: midY, r: 4, fill: s.accent }),
        svgEl("text", {
          x: cursorX + approxHandleW + 16,
          y: midY + 7,
          fill: textCol,
          opacity: 0.86,
          "font-family": font,
          "font-size": 21,
          "font-weight": 600,
        }, tagline),
      );
    }
  }

  // Frills Plus rotating social chip on the right side
  if (s.socials.length > 0 && w >= 620) {
    const label = fitText(s.socials[socialIdx % s.socials.length], 28);
    const pillW = Math.min(320, Math.max(150, label.length * 10.5 + 34));
    const pillH = 38;
    const px = x + w - pillW - 22;
    const py = midY - pillH / 2;
    g.append(
      svgEl("rect", { class: "ol-social-pill", x: px, y: py, width: pillW, height: pillH, rx: pillH / 2, fill: rgba(s.accent, 0.22), stroke: s.accent, "stroke-width": 2 }),
      svgEl("text", {
        x: px + pillW / 2,
        y: midY + 6,
        "text-anchor": "middle",
        fill: textCol,
        "font-family": font,
        "font-size": 16,
        "font-weight": 700,
      }, label),
    );
  }

  return g;
}

/** Renders the Gift Menu / Rewards or Commands & Rules card inside `rect` (zero strikethrough — every row stays crisp and readable). */
function buildSideCardPanel(rect, s, ids, { onRowClick } = {}) {
  const { x, y, w, h, compact = false } = rect;
  const font = FONTS[s.font] || FONTS.Fredoka;
  const isGifts = s.sideMode === "gifts";
  const rows = s.rows.length ? s.rows : [{ label: isGifts ? "🌹 Rose" : "!sr", value: isGifts ? "Shoutout" : "Request a song" }];
  const hi = s.highlightRow;
  const useTicker = s.cardStyle === "ticker" || (compact && w > h * 2.4);
  const textCol = s.frameStyle === "scrapbook" ? "#2e241b" : s.text;
  const accentInk = inkOn(s.accent);
  const popInk = inkOn(s.pop);

  const g = svgEl("g", { class: `ol-card ol-card--${s.cardStyle}` });
  const panelStyle = s.frameStyle === "window" ? "clean" : s.frameStyle;
  g.append(buildFrameGroup({ x, y, w, h, shape: "rect" }, { ...s, frameStyle: panelStyle, strokeW: Math.min(5, s.strokeW) }, ids, { isPanel: true }));

  const padX = 22;
  const defaultHead = isGifts ? "Gift Rewards" : "Stream Commands";
  const heading = fitText(s.cardTitle || defaultHead, 26);

  if (useTicker) {
    const headY = y + 32;
    g.append(
      svgEl("text", { x: x + padX, y: headY, fill: s.accent, "font-family": font, "font-size": 15, "font-weight": 800, "letter-spacing": "0.08em" }, heading.toUpperCase()),
      svgEl("text", { x: x + w - padX, y: headY, "text-anchor": "end", fill: textCol, opacity: 0.72, "font-family": font, "font-size": 13, "font-weight": 700 }, isGifts ? "GIFT MENU" : "INFO"),
    );
    const maxVisible = Math.min(rows.length, w >= 1100 ? 4 : 3);
    const start = hi >= 0 ? Math.max(0, Math.min(rows.length - maxVisible, hi - 1)) : 0;
    const slice = rows.slice(start, start + maxVisible);
    const gap = 12;
    const pillW = Math.floor((w - padX * 2 - gap * (slice.length - 1)) / slice.length);
    const pillH = Math.min(62, h - 48);
    const pillY = y + 42;

    slice.forEach((row, idx) => {
      const realIdx = start + idx;
      const isHot = realIdx === hi;
      const px = x + padX + idx * (pillW + gap);
      const itemG = svgEl("g", { class: "ol-card-row", "data-row": String(realIdx) });
      itemG.append(
        svgEl("rect", {
          x: px,
          y: pillY,
          width: pillW,
          height: pillH,
          rx: 14,
          fill: isHot ? s.accent : rgba(textCol, 0.1),
          stroke: isHot ? s.pop : rgba(s.accent, 0.45),
          "stroke-width": isHot ? 3 : 1.5,
        }),
        svgEl("text", {
          x: px + 14,
          y: pillY + (row.value ? pillH * 0.44 : pillH / 2 + 6),
          fill: isHot ? accentInk : textCol,
          "font-family": font,
          "font-size": 16,
          "font-weight": 800,
        }, fitText(row.label, Math.max(10, Math.floor((pillW - 28) / 10)))),
      );
      if (row.value) {
        itemG.append(
          svgEl("text", {
            x: px + 14,
            y: pillY + pillH * 0.78,
            fill: isHot ? accentInk : textCol,
            opacity: isHot ? 0.92 : 0.76,
            "font-family": font,
            "font-size": 14,
            "font-weight": 600,
          }, fitText(row.value, Math.max(12, Math.floor((pillW - 28) / 8.5)))),
        );
      }
      if (onRowClick) itemG.addEventListener("click", () => onRowClick(realIdx));
      g.append(itemG);
    });
    return g;
  }

  // Vertical card styles: cards, pills, quest
  const isQuest = s.cardStyle === "quest";
  const isPills = s.cardStyle === "pills";
  const headerH = isQuest ? 62 : 56;

  if (isQuest) {
    g.append(
      svgEl("rect", { x: x + 16, y: y + 14, width: w - 32, height: 42, rx: 10, fill: rgba(s.accent, 0.22), stroke: s.accent, "stroke-width": 2 }),
      svgEl("path", { d: star4Path(x + 36, y + 35, 9), fill: s.pop }),
      svgEl("text", { x: x + 54, y: y + 41, fill: textCol, "font-family": font, "font-size": 19, "font-weight": 800, "letter-spacing": "0.06em" }, heading.toUpperCase()),
      svgEl("text", { x: x + w - 28, y: y + 40, "text-anchor": "end", fill: s.pop, "font-family": font, "font-size": 13, "font-weight": 800 }, isGifts ? "LOOT" : "GUIDE"),
    );
  } else {
    g.append(
      svgEl("text", { x: x + padX, y: y + 40, fill: textCol, "font-family": font, "font-size": 23, "font-weight": 800 }, heading),
      svgEl("rect", { x: x + w - 92, y: y + 18, width: 70, height: 28, rx: 14, fill: rgba(s.accent, 0.24), stroke: s.accent, "stroke-width": 1.5 }),
      svgEl("text", { x: x + w - 57, y: y + 37, "text-anchor": "middle", fill: textCol, "font-family": font, "font-size": 12, "font-weight": 800, "letter-spacing": "0.06em" }, isGifts ? "GIFTS" : "INFO"),
    );
  }

  const listTop = y + headerH + 8;
  const listH = Math.max(96, h - headerH - 22);
  const maxRows = Math.max(2, Math.min(rows.length, Math.floor(listH / 54)));
  const startIdx = rows.length > maxRows && hi >= 0 ? Math.max(0, Math.min(rows.length - maxRows, hi - 1)) : 0;
  const visible = rows.slice(startIdx, startIdx + maxRows);
  const rowGap = 10;
  const rowH = Math.min(82, Math.floor((listH - rowGap * (visible.length - 1)) / visible.length));

  visible.forEach((row, idx) => {
    const realIdx = startIdx + idx;
    const isHot = realIdx === hi;
    const ry = listTop + idx * (rowH + rowGap);
    const cy = ry + rowH / 2;
    const itemG = svgEl("g", { class: "ol-card-row", "data-row": String(realIdx) });

    itemG.append(
      svgEl("rect", {
        x: x + padX - 4,
        y: ry,
        width: w - (padX - 4) * 2,
        height: rowH,
        rx: isQuest ? 10 : isPills ? Math.min(28, Math.round(rowH / 2)) : 14,
        fill: isHot ? rgba(s.accent, 0.28) : rgba(textCol, 0.08),
        stroke: isHot ? s.pop : rgba(s.accent, 0.32),
        "stroke-width": isHot ? 3 : 1.5,
      }),
    );

    const pillMaxW = Math.min(182, Math.round((w - padX * 2) * 0.44));
    const pillH = Math.min(36, rowH - 14);
    const pillX = x + padX + 8;
    const pillY = cy - pillH / 2;

    if (row.value) {
      // Left gift / command badge pill + right bold reward/action text
      itemG.append(
        svgEl("rect", {
          x: pillX,
          y: pillY,
          width: pillMaxW,
          height: pillH,
          rx: isQuest ? 8 : Math.round(pillH / 2),
          fill: isHot ? s.pop : s.accent,
        }),
        svgEl("text", {
          x: pillX + pillMaxW / 2,
          y: cy + 6,
          "text-anchor": "middle",
          fill: isHot ? popInk : accentInk,
          "font-family": font,
          "font-size": rowH >= 56 ? 16 : 14,
          "font-weight": 800,
        }, fitText(row.label, Math.max(8, Math.floor((pillMaxW - 18) / 9.5)))),
        svgEl("text", {
          x: pillX + pillMaxW + 14,
          y: cy + 6,
          fill: textCol,
          "font-family": font,
          "font-size": rowH >= 56 ? 18 : 15,
          "font-weight": 700,
        }, fitText(row.value, Math.max(10, Math.floor((w - padX * 2 - pillMaxW - 36) / 10)))),
      );
    } else {
      itemG.append(
        svgEl("text", {
          x: pillX + 6,
          y: cy + 6,
          fill: textCol,
          "font-family": font,
          "font-size": rowH >= 56 ? 18 : 16,
          "font-weight": 700,
        }, fitText(row.label, Math.max(14, Math.floor((w - padX * 2 - 28) / 10)))),
      );
    }

    if (isHot) {
      itemG.append(
        svgEl("path", { d: star4Path(x + w - padX - 10, cy, 8), fill: s.pop }),
      );
    }

    if (onRowClick) itemG.addEventListener("click", () => onRowClick(realIdx));
    g.append(itemG);
  });

  return g;
}

/** Renders the optional top stream title banner (`COME HANG OUT · !SR FOR MUSIC`). */
function buildBanner(rect, s, ids) {
  const { x, y, w, h } = rect;
  const font = FONTS[s.font] || FONTS.Fredoka;
  const g = svgEl("g", { class: "ol-banner" });
  const rad = s.frameStyle === "pixel" ? 0 : Math.min(20, Math.round(h / 2));
  const fillCol = s.frameStyle === "scrapbook" ? "#fffaf0" : rgba(s.bg, 0.92);
  const ink = s.frameStyle === "scrapbook" ? "#2e241b" : s.text;
  g.append(
    svgEl("rect", { x, y, width: w, height: h, rx: rad, fill: fillCol, stroke: s.accent, "stroke-width": Math.min(4, Math.max(2, s.strokeW * 0.7)) }),
    svgEl("path", { d: star4Path(x + 28, y + h / 2, 9), fill: s.pop }),
    svgEl("path", { d: star4Path(x + w - 28, y + h / 2, 9), fill: s.pop }),
    svgEl("text", {
      x: x + w / 2,
      y: y + h / 2 + 7,
      "text-anchor": "middle",
      fill: ink,
      "font-family": font,
      "font-size": Math.min(23, Math.max(16, Math.round(h * 0.38))),
      "font-weight": 800,
      "letter-spacing": "0.06em",
    }, fitText(s.bannerText, Math.max(24, Math.floor((w - 90) / 13)))),
  );
  return g;
}

/** Renders the TikTok gift / tap callout pill (`🌹 Rose = Shoutout · Tap screen for likes!`). */
function buildPromoStrip(rect, s) {
  const { x, y, w, h } = rect;
  const font = FONTS[s.font] || FONTS.Fredoka;
  const g = svgEl("g", { class: "ol-promo" });
  const rad = s.frameStyle === "pixel" ? 0 : Math.round(h / 2);
  const bgCol = s.accent;
  const ink = inkOn(bgCol);
  g.append(
    svgEl("rect", { x, y, width: w, height: h, rx: rad, fill: bgCol, stroke: rgba("#ffffff", 0.5), "stroke-width": 2 }),
    svgEl("text", {
      x: x + w / 2,
      y: y + h / 2 + 6,
      "text-anchor": "middle",
      fill: ink,
      "font-family": font,
      "font-size": Math.min(20, Math.max(15, Math.round(h * 0.37))),
      "font-weight": 800,
    }, fitText(s.promoText, Math.max(28, Math.floor((w - 44) / 11)))),
  );
  return g;
}

/** Styles the lower TikTok native chat zone (`fade` gradient scrim or `card` framed chat box). */
function buildLowerChatZone(rect, s, ids) {
  const { x, y, w, h, style } = rect;
  const font = FONTS[s.font] || FONTS.Fredoka;
  const g = svgEl("g", { class: `ol-lower-chat ol-lower-chat--${style}` });
  if (style === "fade") {
    g.append(
      svgEl("rect", { x: 0, y: Math.max(0, y - 40), width: 1080, height: 1920 - Math.max(0, y - 40), fill: `url(#${ids.chatFade})` }),
    );
    return g;
  }
  // Framed TikTok chat card
  const rad = s.frameStyle === "pixel" ? 0 : Math.min(24, Number(s.radius) || 20);
  g.append(
    svgEl("rect", {
      x,
      y,
      width: w,
      height: h,
      rx: rad,
      fill: rgba(s.bg, 0.32),
      stroke: rgba(s.accent, 0.72),
      "stroke-width": 3,
      "stroke-dasharray": "10 8",
    }),
    svgEl("rect", { x: x + 20, y: y - 14, width: 158, height: 28, rx: 14, fill: s.accent }),
    svgEl("text", {
      x: x + 99,
      y: y + 5,
      "text-anchor": "middle",
      fill: inkOn(s.accent),
      "font-family": font,
      "font-size": 13,
      "font-weight": 800,
      "letter-spacing": "0.08em",
    }, "LIVE CHAT"),
  );
  return g;
}

/** Renders Frills' existing decor pack images (peeker, corner scene, sparkles) + optional Plus custom corner mascot. */
function buildDecorLayer(geom, s) {
  const g = svgEl("g", { class: "ol-decor" });
  const anchor = geom.decorAnchor;
  if (!anchor) return g;

  const scale = Math.max(0.6, Math.min(1.5, (Number(s.decorScale) || 100) / 100));
  const pos = s.decorPos || "corners";
  const pack = s.artPack && s.artPack !== "none" ? PACKS[s.artPack] : null;

  if (pack) {
    if (pack.peek?.length) {
      const p = pack.peek[0];
      const pw = Math.round(Math.min(180, Math.max(104, anchor.w * 0.16)) * scale);
      const ph = Math.round(pw * (p.ratio || 0.55));
      const px = pos === "top"
        ? Math.round(anchor.x + (anchor.w - pw) / 2)
        : pos === "flipped"
          ? Math.max(12, anchor.x + 28)
          : Math.min(geom.width - pw - 14, anchor.x + anchor.w - pw - 28);
      const py = Math.max(4, anchor.y - ph + Math.round(16 * scale));
      g.append(svgEl("image", { class: "ol-decor-img", href: p.src, x: px, y: py, width: pw, height: ph, preserveAspectRatio: "xMidYMax meet" }));
    }
    if (pack.corner?.length && pos !== "top") {
      const c = pack.corner[0];
      const cw = Math.round(Math.min(132, Math.max(84, anchor.w * 0.12)) * scale);
      const cx = pos === "flipped"
        ? Math.min(geom.width - cw - 8, anchor.x + anchor.w - cw + 10)
        : Math.max(8, anchor.x - 10);
      const cy = Math.min(geom.height - cw - 8, anchor.y + anchor.h - cw - 2);
      g.append(svgEl("image", { class: "ol-decor-img", href: c.src, x: cx, y: cy, width: cw, height: cw, preserveAspectRatio: "xMidYMid meet" }));
    }
    if (pack.spark?.length) {
      const s1 = pack.spark[0];
      const s2 = pack.spark[1 % pack.spark.length];
      const sz1 = Math.round(50 * scale);
      const sz2 = Math.round(40 * scale);
      const sx1 = pos === "flipped" ? Math.min(geom.width - sz1 - 8, anchor.x + anchor.w - sz1 + 10) : Math.max(6, anchor.x - 10);
      const sx2 = pos === "top"
        ? Math.min(geom.width - sz2 - 8, anchor.x + anchor.w - sz2 - 14)
        : pos === "flipped"
          ? Math.min(geom.width - sz2 - 8, anchor.x + anchor.w - sz1 - sz2)
          : Math.min(geom.width - sz2 - 8, anchor.x + sz1 - 6);
      g.append(
        svgEl("image", { class: "ol-decor-img ol-spark-float", href: s1.src, x: sx1, y: Math.max(6, anchor.y - Math.round(14 * scale)), width: sz1, height: sz1 }),
        svgEl("image", { class: "ol-decor-img ol-spark-float-b", href: s2.src, x: sx2, y: Math.max(6, anchor.y - Math.round(20 * scale)), width: sz2, height: sz2 }),
      );
    }
  }

  // Frills Plus custom uploaded corner mascot/logo
  if (s.customBadge) {
    const size = Math.round(Math.min(136, Math.max(84, anchor.w * 0.13)) * scale);
    const bx = pos === "flipped"
      ? Math.max(12, anchor.x - 8)
      : Math.min(geom.width - size - 14, anchor.x + anchor.w - size + 10);
    const by = Math.min(geom.height - size - 14, anchor.y + anchor.h - size + 10);
    g.append(
      svgEl("circle", { cx: bx + size / 2, cy: by + size / 2, r: size / 2 + 4, fill: s.bg, stroke: s.accent, "stroke-width": 4 }),
      svgEl("image", {
        class: "ol-decor-img",
        href: mediaUrl(s.customBadge),
        x: bx + 6,
        y: by + 6,
        width: size - 12,
        height: size - 12,
        preserveAspectRatio: "xMidYMid meet",
      }),
    );
  }

  return g;
}

/** Editor-only translucent TikTok LIVE 9:16 UI safe-zone overlay (excluded from live overlay & PNG export). */
function buildSafeZoneGuide() {
  const g = svgEl("g", { class: "ol-safezone", "data-editor-only": "1" });
  const zones = [TIKTOK_SAFE_ZONES.topBar, TIKTOK_SAFE_ZONES.bottomChat];
  for (const z of zones) {
    g.append(
      svgEl("rect", { x: z.x, y: z.y, width: z.w, height: z.h, fill: "rgba(255, 62, 118, 0.24)", stroke: "rgba(255, 118, 158, 0.85)", "stroke-width": 3, "stroke-dasharray": "12 10" }),
      svgEl("text", {
        x: z.x + z.w / 2,
        y: z.y + z.h / 2 + 7,
        "text-anchor": "middle",
        fill: "#ffffff",
        "font-family": "system-ui, sans-serif",
        "font-size": 24,
        "font-weight": 800,
      }, z.label),
    );
  }
  const safe = TIKTOK_SAFE_ZONES.safeRect;
  g.append(
    svgEl("rect", { x: safe.x, y: safe.y, width: safe.w, height: safe.h, fill: "none", stroke: "rgba(89, 255, 160, 0.9)", "stroke-width": 3, "stroke-dasharray": "10 8" }),
  );
  return g;
}

/** Editor-only interactive box selection, 8 resize handles, live pixel readout, and snap guides (Frills Plus). */
function buildEditOverlay(geom, selectedId, snapLines) {
  const g = svgEl("g", { class: "ol-edit-layer", "data-editor-only": "1" });
  const boxes = listEditableBoxes(geom);
  if (!boxes.length) return g;

  // Magnetic snap guide lines shown while dragging/resizing
  for (const vx of snapLines?.vertical ?? []) {
    g.append(svgEl("line", { class: "ol-snap-line", x1: vx, y1: 0, x2: vx, y2: geom.height, stroke: "#5ce1e6", "stroke-width": 2.5, "stroke-dasharray": "10 8" }));
  }
  for (const hy of snapLines?.horizontal ?? []) {
    g.append(svgEl("line", { class: "ol-snap-line", x1: 0, y1: hy, x2: geom.width, y2: hy, stroke: "#5ce1e6", "stroke-width": 2.5, "stroke-dasharray": "10 8" }));
  }

  const active = boxes.find((b) => b.id === selectedId) || boxes[0];
  for (const b of boxes) {
    const isSel = b.id === active.id;
    g.append(
      svgEl("rect", {
        class: isSel ? "ol-edit-hit ol-edit-hit--selected" : "ol-edit-hit",
        "data-ol-box": b.id,
        x: b.x,
        y: b.y,
        width: b.w,
        height: b.h,
        rx: b.shape === "circle" ? Math.round(Math.min(b.w, b.h) / 2) : 10,
        fill: isSel ? "rgba(246, 211, 74, 0.08)" : "rgba(255, 255, 255, 0.001)",
        stroke: isSel ? "none" : "rgba(255, 255, 255, 0.48)",
        "stroke-width": isSel ? 0 : 2.5,
        "stroke-dasharray": isSel ? undefined : "10 8",
      }),
    );
  }

  // High-contrast double-stroke selection box on active target
  const { x, y, w, h } = active;
  const strokeW = Math.max(3, Math.round(geom.width * 0.0032));
  g.append(
    svgEl("rect", {
      class: "ol-edit-outline",
      x,
      y,
      width: w,
      height: h,
      rx: 6,
      fill: "none",
      stroke: "#141720",
      "stroke-width": strokeW + 3,
    }),
    svgEl("rect", {
      class: "ol-edit-outline",
      x,
      y,
      width: w,
      height: h,
      rx: 6,
      fill: "none",
      stroke: "#f6d34a",
      "stroke-width": strokeW,
      "stroke-dasharray": "12 8",
    }),
  );

  // Live logical pixel readout badge (`W × H px`), tucked cleanly clear of handles and neighboring banners
  const hs = Math.max(18, Math.round(geom.width * 0.017));
  const badgeFont = Math.max(20, Math.round(geom.width * 0.02));
  const badgeText = `${active.label}: ${w} × ${h} px`;
  const badgeW = Math.min(geom.width - 24, Math.max(196, Math.round(badgeText.length * badgeFont * 0.58 + 32)));
  const badgeH = Math.round(badgeFont * 1.75);
  const badgeX = Math.max(12, Math.min(geom.width - badgeW - 12, Math.round(x + w / 2 - badgeW / 2)));
  const insideTop = y + Math.round(hs / 2) + 14;
  const aboveTop = y - badgeH - Math.round(hs / 2) - 10;
  const belowBot = y + h + Math.round(hs / 2) + 10;
  const badgeY = h >= badgeH + hs + 34
    ? insideTop
    : aboveTop >= 12
      ? aboveTop
      : Math.min(geom.height - badgeH - 12, belowBot);
  g.append(
    svgEl("rect", { class: "ol-edit-badge", x: badgeX, y: badgeY, width: badgeW, height: badgeH, rx: Math.round(badgeH / 2), fill: "#141720", stroke: "#f6d34a", "stroke-width": 2.5 }),
    svgEl("text", {
      class: "ol-edit-badge-text",
      x: badgeX + badgeW / 2,
      y: badgeY + badgeH / 2 + Math.round(badgeFont * 0.34),
      "text-anchor": "middle",
      fill: "#fffdf6",
      "font-family": "system-ui, sans-serif",
      "font-size": badgeFont,
      "font-weight": 800,
    }, badgeText),
  );

  // 8 corner & edge handles with generous invisible hit targets
  const hit = Math.round(hs * 2.2);
  const handles = [
    ["nw", x, y],
    ["n", x + w / 2, y],
    ["ne", x + w, y],
    ["e", x + w, y + h / 2],
    ["se", x + w, y + h],
    ["s", x + w / 2, y + h],
    ["sw", x, y + h],
    ["w", x, y + h / 2],
  ];
  for (const [dir, hx, hy] of handles) {
    const hg = svgEl("g", { class: `ol-edit-handle ol-edit-handle--${dir}`, "data-ol-handle": dir, "data-ol-box": active.id });
    hg.append(
      svgEl("rect", { x: hx - hit / 2, y: hy - hit / 2, width: hit, height: hit, fill: "rgba(255, 255, 255, 0.001)" }),
      svgEl("rect", { x: hx - hs / 2, y: hy - hs / 2, width: hs, height: hs, rx: Math.round(hs * 0.25), fill: "#fffdf6", stroke: "#141720", "stroke-width": 3.5 }),
    );
    g.append(hg);
  }
  return g;
}

/**
 * Mounts the live Stream Outline SVG renderer into `host`.
 * Returns `{ apply(settings, opts?), getSvg(), getGeometry(), setHighlight(index), destroy() }`.
 */
export function createOutlineView(
  host,
  { previewAll = false, editorOnly = false, onRowClick = null, onSelectBox = null, onBoxChange = null, onBoxCommit = null } = {},
) {
  const wrap = document.createElement("div");
  wrap.className = "ol-wrap";
  host.replaceChildren(wrap);

  let lastSettings = null;
  let lastOpts = { plusActive: false, showSafeZones: false, showCutoutHints: editorOnly, editBoxes: false, selectedBox: "" };
  let lastGeom = null;
  let currentSvg = null;
  let socialIdx = 0;
  let socialTimer = 0;
  let drag = null;
  let activeSnapLines = null;

  const clientToSvg = (clientX, clientY) => {
    if (!currentSvg || !lastGeom) return null;
    const ctm = currentSvg.getScreenCTM();
    if (ctm) {
      const pt = currentSvg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const out = pt.matrixTransform(ctm.inverse());
      return { x: out.x, y: out.y };
    }
    const r = currentSvg.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return {
      x: ((clientX - r.left) / r.width) * lastGeom.width,
      y: ((clientY - r.top) / r.height) * lastGeom.height,
    };
  };

  const snapScalar = (val, targets, threshold = 12) => {
    let best = null;
    let bestDist = threshold + 1;
    for (const t of targets) {
      const d = Math.abs(val - t);
      if (d <= threshold && d < bestDist) {
        best = t;
        bestDist = d;
      }
    }
    return best;
  };

  const handlePointerDown = (e) => {
    if (!editorOnly || !lastOpts.editBoxes || !lastGeom || !currentSvg) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const handleNode = e.target.closest?.("[data-ol-handle]");
    const boxNode = handleNode || e.target.closest?.("[data-ol-box]");
    if (!boxNode) return;
    const id = boxNode.getAttribute("data-ol-box");
    const boxes = listEditableBoxes(lastGeom);
    const target = boxes.find((b) => b.id === id);
    if (!target) return;
    const pt = clientToSvg(e.clientX, e.clientY);
    if (!pt) return;
    e.preventDefault();
    onSelectBox?.(id);
    const handle = handleNode?.getAttribute("data-ol-handle") || "";
    const snapX = [lastGeom.width / 2];
    const snapY = [lastGeom.height / 2];
    for (const sib of boxes) {
      if (sib.id === id) continue;
      snapX.push(sib.x, sib.x + sib.w / 2, sib.x + sib.w);
      snapY.push(sib.y, sib.y + sib.h / 2, sib.y + sib.h);
    }
    drag = {
      pointerId: e.pointerId,
      mode: handle ? "resize" : "move",
      handle,
      id,
      shape: target.shape,
      startPt: pt,
      orig: { x: target.x, y: target.y, w: target.w, h: target.h },
      snapX,
      snapY,
      moved: false,
    };
    try { wrap.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const handlePointerMove = (e) => {
    if (!drag || e.pointerId !== drag.pointerId || !lastGeom) return;
    const pt = clientToSvg(e.clientX, e.clientY);
    if (!pt) return;
    const dx = pt.x - drag.startPt.x;
    const dy = pt.y - drag.startPt.y;
    if (!drag.moved && Math.hypot(dx, dy) < 2) return;
    drag.moved = true;

    const { orig, handle, id, shape, snapX, snapY } = drag;
    const { minW, minH } = boxMinSize(id);
    const fine = Boolean(e.shiftKey);
    const grid = (n) => (fine ? Math.round(n) : Math.round(n / 8) * 8);
    const vLines = [];
    const hLines = [];
    let x = orig.x;
    let y = orig.y;
    let w = orig.w;
    let h = orig.h;

    if (drag.mode === "move") {
      x = grid(orig.x + dx);
      y = grid(orig.y + dy);
      if (!fine) {
        const sLeft = snapScalar(x, snapX);
        const sCenter = snapScalar(x + w / 2, snapX);
        const sRight = snapScalar(x + w, snapX);
        if (sCenter !== null) { x = Math.round(sCenter - w / 2); vLines.push(sCenter); }
        else if (sLeft !== null) { x = Math.round(sLeft); vLines.push(sLeft); }
        else if (sRight !== null) { x = Math.round(sRight - w); vLines.push(sRight); }

        const sTop = snapScalar(y, snapY);
        const sMid = snapScalar(y + h / 2, snapY);
        const sBot = snapScalar(y + h, snapY);
        if (sMid !== null) { y = Math.round(sMid - h / 2); hLines.push(sMid); }
        else if (sTop !== null) { y = Math.round(sTop); hLines.push(sTop); }
        else if (sBot !== null) { y = Math.round(sBot - h); hLines.push(sBot); }
      }
    } else {
      const right = orig.x + orig.w;
      const bottom = orig.y + orig.h;
      if (handle.includes("e")) {
        let nr = grid(right + dx);
        if (!fine) {
          const s = snapScalar(nr, snapX);
          if (s !== null) { nr = s; vLines.push(s); }
        }
        w = Math.max(minW, nr - orig.x);
      }
      if (handle.includes("s")) {
        let nb = grid(bottom + dy);
        if (!fine) {
          const s = snapScalar(nb, snapY);
          if (s !== null) { nb = s; hLines.push(s); }
        }
        h = Math.max(minH, nb - orig.y);
      }
      if (handle.includes("w")) {
        let nl = grid(orig.x + dx);
        if (!fine) {
          const s = snapScalar(nl, snapX);
          if (s !== null) { nl = s; vLines.push(s); }
        }
        nl = Math.min(right - minW, nl);
        x = nl;
        w = right - nl;
      }
      if (handle.includes("n")) {
        let nt = grid(orig.y + dy);
        if (!fine) {
          const s = snapScalar(nt, snapY);
          if (s !== null) { nt = s; hLines.push(s); }
        }
        nt = Math.min(bottom - minH, nt);
        y = nt;
        h = bottom - nt;
      }
      if (shape === "circle") {
        const side = Math.max(minW, Math.abs(dx) >= Math.abs(dy) ? w : h);
        if (handle.includes("w")) x = right - side;
        if (handle.includes("n")) y = bottom - side;
        w = side;
        h = side;
      }
    }

    const clamped = clampBoxRect(id, { x, y, w, h }, lastGeom.width, lastGeom.height, { shape });
    activeSnapLines = vLines.length || hLines.length ? { vertical: vLines, horizontal: hLines } : null;
    onBoxChange?.(id, clamped);
  };

  const finishDrag = (e) => {
    if (!drag || (e && e.pointerId !== drag.pointerId)) return;
    const didMove = drag.moved;
    try { if (e) wrap.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    drag = null;
    activeSnapLines = null;
    if (didMove) onBoxCommit?.();
    else render();
  };

  if (editorOnly) {
    wrap.addEventListener("pointerdown", handlePointerDown);
    wrap.addEventListener("pointermove", handlePointerMove);
    wrap.addEventListener("pointerup", finishDrag);
    wrap.addEventListener("pointercancel", finishDrag);
  }

  const render = () => {
    if (!lastSettings) return;
    const eff = effectiveOutlineSettings(lastSettings, { plusActive: lastOpts.plusActive, previewAll });
    const geom = computeOutlineGeometry(eff);
    lastGeom = geom;

    const uid = ++uidCounter;
    const ids = {
      mask: `ol-cut-${uid}`,
      glow: `ol-glow-${uid}`,
      strokeGrad: `ol-sg-${uid}`,
      matGrad: `ol-mg-${uid}`,
      dots: `ol-dots-${uid}`,
      grid: `ol-grid-${uid}`,
      stripes: `ol-stripes-${uid}`,
      stars: `ol-stars-${uid}`,
      chatFade: `ol-cfade-${uid}`,
    };

    const svg = svgEl("svg", {
      class: `ol-svg ol-motion--${eff.motion} ol-mode--${eff.mode}`,
      viewBox: `0 0 ${geom.width} ${geom.height}`,
      preserveAspectRatio: "xMidYMid meet",
      "data-w": geom.width,
      "data-h": geom.height,
      xmlns: SVG_NS,
      role: "img",
      "aria-label": `Stream outline (${eff.mode})`,
    });

    const defs = svgEl("defs");

    // Soft glow filter
    const filt = svgEl("filter", { id: ids.glow, x: "-18%", y: "-18%", width: "136%", height: "136%" });
    filt.append(svgEl("feGaussianBlur", { stdDeviation: 7, result: "b" }));
    defs.append(filt);

    // Accent -> Pop gradient for neon/cyber/ribbon strokes & progress bar
    const sg = svgEl("linearGradient", { id: ids.strokeGrad, x1: "0%", y1: "0%", x2: "100%", y2: "100%" });
    sg.append(
      svgEl("stop", { offset: "0%", "stop-color": eff.accent }),
      svgEl("stop", { offset: "52%", "stop-color": eff.pop }),
      svgEl("stop", { offset: "100%", "stop-color": eff.accent }),
    );
    defs.append(sg);

    // Optional mat gradient & subtle polka-dot pattern
    const mg = svgEl("linearGradient", { id: ids.matGrad, x1: "0%", y1: "0%", x2: "100%", y2: "100%" });
    mg.append(
      svgEl("stop", { offset: "0%", "stop-color": eff.bg }),
      svgEl("stop", { offset: "100%", "stop-color": eff.accent, "stop-opacity": 0.35 }),
    );
    defs.append(mg);

    const pat = svgEl("pattern", { id: ids.dots, width: 28, height: 28, patternUnits: "userSpaceOnUse" });
    pat.append(
      svgEl("rect", { width: 28, height: 28, fill: eff.bg }),
      svgEl("circle", { cx: 14, cy: 14, r: 3, fill: eff.accent, opacity: 0.28 }),
    );
    defs.append(pat);

    const gridPat = svgEl("pattern", { id: ids.grid, width: 44, height: 44, patternUnits: "userSpaceOnUse" });
    gridPat.append(
      svgEl("rect", { width: 44, height: 44, fill: eff.bg }),
      svgEl("path", { d: "M 44 0 H 0 V 44", fill: "none", stroke: eff.accent, "stroke-width": 1.4, opacity: 0.24 }),
    );
    defs.append(gridPat);

    const stripePat = svgEl("pattern", { id: ids.stripes, width: 32, height: 32, patternUnits: "userSpaceOnUse", patternTransform: "rotate(35)" });
    stripePat.append(
      svgEl("rect", { width: 32, height: 32, fill: eff.bg }),
      svgEl("rect", { x: 0, y: 0, width: 14, height: 32, fill: eff.accent, opacity: 0.16 }),
    );
    defs.append(stripePat);

    const starPat = svgEl("pattern", { id: ids.stars, width: 140, height: 140, patternUnits: "userSpaceOnUse" });
    starPat.append(
      svgEl("rect", { width: 140, height: 140, fill: eff.bg }),
      svgEl("path", { d: star4Path(26, 30, 8), fill: eff.pop, opacity: 0.72 }),
      svgEl("path", { d: star4Path(106, 84, 6), fill: eff.accent, opacity: 0.65 }),
      svgEl("circle", { cx: 88, cy: 22, r: 2.4, fill: "#ffffff", opacity: 0.6 }),
      svgEl("circle", { cx: 42, cy: 112, r: 2.2, fill: eff.pop, opacity: 0.55 }),
    );
    defs.append(starPat);

    const cf = svgEl("linearGradient", { id: ids.chatFade, x1: "0%", y1: "0%", x2: "0%", y2: "100%" });
    cf.append(
      svgEl("stop", { offset: "0%", "stop-color": eff.bg, "stop-opacity": 0 }),
      svgEl("stop", { offset: "28%", "stop-color": eff.bg, "stop-opacity": 0.45 }),
      svgEl("stop", { offset: "100%", "stop-color": eff.bg, "stop-opacity": 0.86 }),
    );
    defs.append(cf);

    // Cutout mask punching 100% transparent holes through backdrop mat
    if (geom.hasMat && eff.matMode !== "transparent" && eff.matAlpha > 0 && geom.cutouts.length > 0) {
      const mask = svgEl("mask", { id: ids.mask });
      mask.append(svgEl("rect", { x: 0, y: 0, width: geom.width, height: geom.height, fill: "#ffffff" }));
      const rad = eff.frameStyle === "pixel" ? 0 : Math.max(0, Math.min(48, Number(eff.radius) || 20));
      for (const c of geom.cutouts) {
        mask.append(svgEl("path", { d: shapePath(c, rad, eff.frameStyle), fill: "#000000" }));
      }
      defs.append(mask);
    }

    svg.append(defs);

    // 1. Optional punched-out backdrop mat (or Plus custom wallpaper) around multi-cutout layouts
    if (geom.hasMat && eff.matMode !== "transparent" && eff.matAlpha > 0 && geom.cutouts.length > 0) {
      const matOpacity = Math.max(0, Math.min(1, eff.matAlpha / 100));
      const matGroup = svgEl("g", { mask: `url(#${ids.mask})`, opacity: matOpacity });
      if (eff.matImage) {
        matGroup.append(
          svgEl("rect", { x: 0, y: 0, width: geom.width, height: geom.height, fill: eff.bg }),
          svgEl("image", {
            class: "ol-decor-img",
            href: mediaUrl(eff.matImage),
            x: 0,
            y: 0,
            width: geom.width,
            height: geom.height,
            preserveAspectRatio: "xMidYMid slice",
          }),
        );
      } else if (OUTLINE_BACKDROPS[eff.matMode]) {
        matGroup.append(
          svgEl("rect", { x: 0, y: 0, width: geom.width, height: geom.height, fill: eff.bg }),
          svgEl("image", {
            class: "ol-decor-img",
            href: OUTLINE_BACKDROPS[eff.matMode],
            x: 0,
            y: 0,
            width: geom.width,
            height: geom.height,
            preserveAspectRatio: "xMidYMid slice",
          }),
        );
      } else if (eff.matMode === "dots") {
        matGroup.append(svgEl("rect", { x: 0, y: 0, width: geom.width, height: geom.height, fill: `url(#${ids.dots})` }));
      } else if (eff.matMode === "grid") {
        matGroup.append(svgEl("rect", { x: 0, y: 0, width: geom.width, height: geom.height, fill: `url(#${ids.grid})` }));
      } else if (eff.matMode === "stripes") {
        matGroup.append(svgEl("rect", { x: 0, y: 0, width: geom.width, height: geom.height, fill: `url(#${ids.stripes})` }));
      } else if (eff.matMode === "stars") {
        matGroup.append(svgEl("rect", { x: 0, y: 0, width: geom.width, height: geom.height, fill: `url(#${ids.stars})` }));
      } else if (eff.matMode === "gradient") {
        matGroup.append(
          svgEl("rect", { x: 0, y: 0, width: geom.width, height: geom.height, fill: eff.bg }),
          svgEl("rect", { x: 0, y: 0, width: geom.width, height: geom.height, fill: `url(#${ids.matGrad})`, opacity: 0.6 }),
        );
      } else {
        matGroup.append(svgEl("rect", { x: 0, y: 0, width: geom.width, height: geom.height, fill: eff.bg }));
      }
      svg.append(matGroup);
    }

    // 1b. Optional TikTok bottom chat zone fade or framed chat card
    if (geom.lowerChatRect) {
      svg.append(buildLowerChatZone(geom.lowerChatRect, eff, ids));
    }

    // 2. Editor-only translucent cutout hints (shows where gameplay/webcam/widgets sit behind transparent holes)
    if (lastOpts.showCutoutHints && geom.cutouts.length > 0) {
      const hintG = svgEl("g", { class: "ol-cutout-hints", "data-editor-only": "1" });
      for (const c of geom.cutouts) {
        const sub = c.isWidgetSlot ? "DROP FRILLS CHAT / JAR / WHEEL HERE" : "TRANSPARENT";
        hintG.append(
          svgEl("text", {
            x: c.x + c.w / 2,
            y: c.y + c.h / 2 - 4,
            "text-anchor": "middle",
            fill: "rgba(255, 255, 255, 0.68)",
            "font-family": "system-ui, sans-serif",
            "font-size": Math.min(26, Math.max(15, Math.round(c.w * 0.034))),
            "font-weight": 800,
            "letter-spacing": "0.06em",
          }, c.label.toUpperCase()),
          svgEl("text", {
            x: c.x + c.w / 2,
            y: c.y + c.h / 2 + 22,
            "text-anchor": "middle",
            fill: "rgba(255, 255, 255, 0.44)",
            "font-family": "system-ui, sans-serif",
            "font-size": Math.min(16, Math.max(11, Math.round(c.w * 0.022))),
            "font-weight": 700,
            "letter-spacing": "0.06em",
          }, `(${sub})`),
        );
      }
      svg.append(hintG);
    }

    // 3. Vector frames around every cutout
    for (const c of geom.cutouts) {
      svg.append(buildFrameGroup(c, eff, ids));
    }

    // 4. Docked Gift Menu / Commands Card
    if (geom.cardRect) {
      svg.append(buildSideCardPanel(geom.cardRect, eff, ids, { onRowClick: lastOpts.editBoxes ? null : onRowClick }));
    }

    // 5. Top stream title banner, nameplate & TikTok gift/tap callout strip
    if (geom.bannerRect) {
      svg.append(buildBanner(geom.bannerRect, eff, ids));
    }
    if (geom.nameplateRect) {
      svg.append(buildNameplate(geom.nameplateRect, eff, ids, socialIdx));
    }
    if (geom.promoRect) {
      svg.append(buildPromoStrip(geom.promoRect, eff));
    }

    // 6. Frills decor pack illustrations & custom corner mascot
    svg.append(buildDecorLayer(geom, eff));

    // 7. Editor-only TikTok 9:16 Safe-Zone Guide
    if (lastOpts.showSafeZones && eff.mode === "screen9x16") {
      svg.append(buildSafeZoneGuide());
    }

    // 8. Editor-only Frills Plus interactive box drag & resize handles
    if (editorOnly && lastOpts.editBoxes) {
      svg.append(buildEditOverlay(geom, lastOpts.selectedBox, activeSnapLines));
    }

    wrap.dataset.mode = eff.mode;
    wrap.dataset.motion = eff.motion;
    wrap.dataset.editing = String(Boolean(editorOnly && lastOpts.editBoxes));
    wrap.replaceChildren(svg);
    currentSvg = svg;

    // Manage rotating social timer cleanly
    clearInterval(socialTimer);
    if (eff.socials.length > 1 && geom.nameplateRect) {
      socialTimer = setInterval(() => {
        socialIdx = (socialIdx + 1) % eff.socials.length;
        render();
      }, 4500);
    }
  };

  return {
    apply(settings, opts = {}) {
      lastSettings = settings;
      lastOpts = { ...lastOpts, ...opts };
      render();
    },
    setHighlight(rowIndex) {
      if (!lastSettings) return;
      lastSettings = { ...lastSettings, highlightRow: rowIndex };
      render();
    },
    getSvg: () => currentSvg,
    getGeometry: () => lastGeom,
    destroy() {
      clearInterval(socialTimer);
      if (editorOnly) {
        wrap.removeEventListener("pointerdown", handlePointerDown);
        wrap.removeEventListener("pointermove", handlePointerMove);
        wrap.removeEventListener("pointerup", finishDrag);
        wrap.removeEventListener("pointercancel", finishDrag);
      }
      wrap.replaceChildren();
    },
  };
}
