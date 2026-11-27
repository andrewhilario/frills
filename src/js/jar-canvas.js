// Interactive 3D-shaded Glass Jar Renderer + 2D Rigid-Body Gift Physics Engine (HTML5 Canvas, HiDPI).
// Renders 10 translucent glass/crystal vessels with 3D rim curvature, specular sheen, animated rising wave liquid,
// rising fizz bubbles, splash droplets, and real gravity/collision stacking for dropped TikTok LIVE gifts.

const W = 280;
const H = 340;
const TAU = Math.PI * 2;
const safeUrl = (url) => (/^(\/jar-art\/[a-z0-9_-]+\.webp|https:\/\/[^"'\s<>]+|data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+)$/i.test(url || "") ? url : "");

function parseHexRgb(color) {
  const s = String(color || "").trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const raw = hex[1].length === 3 ? hex[1].replace(/(.)/g, "$1$1") : hex[1];
    return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)];
  }
  const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(s);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

const withAlpha = (rgb, a, fallback = [120, 180, 255]) => {
  const [r, g, b] = rgb || fallback;
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
};

function ellipseFloor(cx, cy, rx, ry, x) {
  const dx = Math.min(1, Math.abs(x - cx) / Math.max(1, rx));
  return cy + ry * Math.sqrt(Math.max(0, 1 - dx * dx));
}

function ellipseWall(cx, cy, rx, ry, y) {
  const dy = Math.min(0.98, Math.abs(y - cy) / Math.max(1, ry));
  const half = rx * Math.sqrt(Math.max(0.02, 1 - dy * dy));
  return { cx, left: cx - half, right: cx + half };
}

const VESSELS = {

  boba: {
    cx: 140, mouthY: 72, mouthRx: 26, mouthRy: 6, liqTop: 132, liqBot: 298, fullPile: 22,
    art: { src: "/jar-art/boba.webp", x: 58, y: 0, w: 163, h: 326, shadowY: 324, shadowRx: 52, spillY: 124, spillRx: 58 },
    chamberPath(ctx) {
      ctx.beginPath();
      ctx.moveTo(84, 130);
      ctx.lineTo(196, 130);
      ctx.lineTo(185, 290);
      ctx.quadraticCurveTo(184, 300, 174, 300);
      ctx.lineTo(106, 300);
      ctx.quadraticCurveTo(96, 300, 95, 290);
      ctx.closePath();
    },
    dropPath(ctx) {
      ctx.beginPath();
      ctx.moveTo(106, 68);
      ctx.lineTo(174, 68);
      ctx.quadraticCurveTo(196, 86, 196, 130);
      ctx.lineTo(185, 290);
      ctx.quadraticCurveTo(184, 300, 174, 300);
      ctx.lineTo(106, 300);
      ctx.quadraticCurveTo(96, 300, 95, 290);
      ctx.lineTo(84, 130);
      ctx.quadraticCurveTo(84, 86, 106, 68);
      ctx.closePath();
    },
    wallBounds(y) {
      if (y < 130) return { cx: 140, left: 102, right: 178 };
      const clamped = Math.max(130, Math.min(298, y));
      const frac = (clamped - 130) / 168;
      const hw = 55 - frac * 11;
      return { cx: 140, left: 140 - hw, right: 140 + hw };
    },
    bottomY: (x) => 297 - 3 * Math.pow(Math.min(1, Math.abs(x - 140) / 48), 2),
  },

  potion: {
    cx: 140, mouthY: 108, mouthRx: 20, mouthRy: 6, liqTop: 170, liqBot: 300, fullPile: 22,
    art: { src: "/jar-art/potion.webp", x: 30, y: 0, w: 221, h: 332, shadowY: 328, shadowRx: 66 },
    chamberPath(ctx) {
      ctx.beginPath();
      ctx.ellipse(140, 236, 81, 67, 0, 0, TAU);
    },
    dropPath(ctx) {
      ctx.beginPath();
      ctx.moveTo(120, 106);
      ctx.lineTo(160, 106);
      ctx.lineTo(160, 172);
      ctx.bezierCurveTo(205, 188, 221, 212, 221, 236);
      ctx.bezierCurveTo(221, 276, 186, 303, 140, 303);
      ctx.bezierCurveTo(94, 303, 59, 276, 59, 236);
      ctx.bezierCurveTo(59, 212, 75, 188, 120, 172);
      ctx.closePath();
    },
    wallBounds(y) {
      if (y < 170) return { cx: 140, left: 120, right: 160 };
      return ellipseWall(140, 236, 80, 66, y);
    },
    bottomY: (x) => ellipseFloor(140, 236, 80, 66, x),
  },

  piggy: {
    cx: 140, mouthY: 70, mouthRx: 30, mouthRy: 5, liqTop: 118, liqBot: 274, fullPile: 30,
    art: { src: "/jar-art/piggy.webp", x: 12, y: 32, w: 256, h: 294, shadowY: 324, shadowRx: 86, spillY: 74, spillRx: 32 },
    chamberPath(ctx) {
      ctx.beginPath();
      ctx.ellipse(140, 194, 107, 80, 0, 0, TAU);
    },
    dropPath(ctx) {
      ctx.beginPath();
      ctx.moveTo(110, 70);
      ctx.lineTo(170, 70);
      ctx.lineTo(170, 120);
      ctx.bezierCurveTo(222, 134, 247, 162, 247, 194);
      ctx.bezierCurveTo(247, 242, 200, 274, 140, 274);
      ctx.bezierCurveTo(80, 274, 33, 242, 33, 194);
      ctx.bezierCurveTo(33, 162, 58, 134, 110, 120);
      ctx.closePath();
    },
    wallBounds(y) {
      if (y < 114) return { cx: 140, left: 112, right: 168 };
      return ellipseWall(140, 194, 106, 79, y);
    },
    bottomY: (x) => ellipseFloor(140, 194, 106, 79, x),
  },

  cat: {
    cx: 140, mouthY: 82, mouthRx: 46, mouthRy: 10, liqTop: 136, liqBot: 298, fullPile: 28,
    art: { src: "/jar-art/cat.webp", x: 25, y: 28, w: 230, h: 298, shadowY: 324, shadowRx: 78, spillY: 76, spillRx: 52 },
    chamberPath(ctx) {
      ctx.beginPath();
      ctx.moveTo(88, 108);
      ctx.lineTo(192, 108);
      ctx.bezierCurveTo(222, 136, 236, 174, 235, 214);
      ctx.bezierCurveTo(234, 266, 208, 300, 168, 300);
      ctx.lineTo(112, 300);
      ctx.bezierCurveTo(72, 300, 46, 266, 45, 214);
      ctx.bezierCurveTo(44, 174, 58, 136, 88, 108);
      ctx.closePath();
    },
    wallBounds(y) {
      if (y < 134) return { cx: 140, left: 92, right: 188 };
      return ellipseWall(140, 206, 94, 92, y);
    },
    bottomY: (x) => 298 - 10 * Math.pow(Math.min(1, Math.abs(x - 140) / 90), 2.4),
  },

  frog: {
    cx: 140, mouthY: 88, mouthRx: 52, mouthRy: 10, liqTop: 120, liqBot: 276, fullPile: 30,
    art: { src: "/jar-art/frog.webp", x: 11, y: 38, w: 258, h: 288, shadowY: 324, shadowRx: 88 },
    chamberPath(ctx) {
      ctx.beginPath();
      ctx.ellipse(140, 196, 112, 82, 0, 0, TAU);
    },
    dropPath(ctx) {
      ctx.beginPath();
      ctx.moveTo(86, 88);
      ctx.lineTo(194, 88);
      ctx.bezierCurveTo(234, 118, 252, 154, 252, 196);
      ctx.bezierCurveTo(252, 244, 202, 278, 140, 278);
      ctx.bezierCurveTo(78, 278, 28, 244, 28, 196);
      ctx.bezierCurveTo(28, 154, 46, 118, 86, 88);
      ctx.closePath();
    },
    wallBounds(y) {
      if (y < 114) return { cx: 140, left: 88, right: 192 };
      return ellipseWall(140, 196, 111, 81, y);
    },
    bottomY: (x) => ellipseFloor(140, 196, 111, 81, x),
  },

  arcade: {
    cx: 140, mouthY: 64, mouthRx: 44, mouthRy: 6, liqTop: 74, liqBot: 268, fullPile: 30,
    art: { src: "/jar-art/arcade.webp", x: 55, y: 4, w: 170, h: 322, shadowY: 324, shadowRx: 66, internalSpawn: true, spillY: 72, spillRx: 52 },
    chamberPath(ctx) {
      ctx.beginPath();
      ctx.moveTo(86, 64);
      ctx.lineTo(194, 64);
      ctx.lineTo(205, 80);
      ctx.lineTo(205, 254);
      ctx.lineTo(194, 270);
      ctx.lineTo(86, 270);
      ctx.lineTo(75, 254);
      ctx.lineTo(75, 80);
      ctx.closePath();
    },
    wallBounds(y) {
      if (y < 80) { const t = Math.max(0, (y - 64) / 16); const hw = 54 + t * 11; return { cx: 140, left: 140 - hw, right: 140 + hw }; }
      if (y > 254) { const t = Math.max(0, (270 - y) / 16); const hw = 54 + t * 11; return { cx: 140, left: 140 - hw, right: 140 + hw }; }
      return { cx: 140, left: 75, right: 205 };
    },
    bottomY: (x) => {
      const dx = Math.abs(x - 140);
      return dx <= 52 ? 268 : 268 - (dx - 52) * 0.9;
    },
  },

  bunny: {
    cx: 140, mouthY: 112, mouthRx: 50, mouthRy: 8, liqTop: 158, liqBot: 292, fullPile: 28,
    art: { src: "/jar-art/bunny.webp", x: 26, y: 6, w: 228, h: 316, shadowY: 322, shadowRx: 78, spillY: 112, spillRx: 54 },
    chamberPath(ctx) {
      ctx.beginPath();
      ctx.ellipse(140, 224, 93, 69, 0, 0, TAU);
    },
    dropPath(ctx) {
      ctx.beginPath();
      ctx.moveTo(88, 112);
      ctx.lineTo(192, 112);
      ctx.lineTo(192, 160);
      ctx.bezierCurveTo(222, 174, 234, 198, 234, 224);
      ctx.bezierCurveTo(234, 266, 194, 294, 140, 294);
      ctx.bezierCurveTo(86, 294, 46, 266, 46, 224);
      ctx.bezierCurveTo(46, 198, 58, 174, 88, 160);
      ctx.closePath();
    },
    wallBounds(y) {
      if (y < 158) return { cx: 140, left: 90, right: 190 };
      return ellipseWall(140, 224, 91, 68, y);
    },
    bottomY: (x) => ellipseFloor(140, 224, 91, 68, x),
  },

  heart: {
    cx: 140, mouthY: 65, mouthRx: 42, mouthRy: 7, liqTop: 108, liqBot: 266, fullPile: 26,
    art: { src: "/jar-art/heart.webp", x: 14, y: 56, w: 252, h: 266, shadowY: 322, shadowRx: 64, spillY: 66, spillRx: 44 },
    chamberPath(ctx) {
      ctx.beginPath();
      ctx.moveTo(140, 120);
      ctx.bezierCurveTo(164, 98, 228, 102, 238, 150);
      ctx.bezierCurveTo(246, 194, 198, 246, 140, 268);
      ctx.bezierCurveTo(82, 246, 34, 194, 42, 150);
      ctx.bezierCurveTo(52, 102, 116, 98, 140, 120);
      ctx.closePath();
    },
    dropPath(ctx) {
      ctx.beginPath();
      ctx.moveTo(96, 65);
      ctx.lineTo(184, 65);
      ctx.lineTo(184, 106);
      ctx.bezierCurveTo(216, 110, 238, 128, 238, 154);
      ctx.bezierCurveTo(238, 198, 196, 248, 140, 268);
      ctx.bezierCurveTo(84, 248, 42, 198, 42, 154);
      ctx.bezierCurveTo(42, 128, 64, 110, 96, 106);
      ctx.closePath();
    },
    wallBounds(y) {
      if (y < 108) return { cx: 140, left: 98, right: 182 };
      if (y <= 156) {
        const t = (y - 108) / 48;
        const hw = 42 + 54 * Math.sin(t * Math.PI * 0.5);
        return { cx: 140, left: 140 - hw, right: 140 + hw };
      }
      const t = Math.min(1, (y - 156) / 110);
      const hw = Math.max(24, 96 - 72 * Math.pow(t, 1.25));
      return { cx: 140, left: 140 - hw, right: 140 + hw };
    },
    bottomY: (x) => {
      const dx = Math.min(1, Math.abs(x - 140) / 96);
      return 265 - 108 * Math.pow(dx, 1.85);
    },
  },

  star: {
    cx: 133, mouthY: 104, mouthRx: 36, mouthRy: 7, liqTop: 146, liqBot: 294, fullPile: 26,
    art: { src: "/jar-art/star.webp", x: 27, y: 6, w: 226, h: 316, shadowY: 322, shadowRx: 68, spillY: 104, spillRx: 38 },
    chamberPath(ctx) {
      ctx.beginPath();
      ctx.moveTo(92, 144);
      ctx.lineTo(174, 144);
      ctx.lineTo(220, 196);
      ctx.lineTo(198, 236);
      ctx.lineTo(202, 274);
      ctx.lineTo(184, 296);
      ctx.lineTo(82, 296);
      ctx.lineTo(64, 274);
      ctx.lineTo(68, 236);
      ctx.lineTo(46, 196);
      ctx.closePath();
    },
    dropPath(ctx) {
      ctx.beginPath();
      ctx.moveTo(96, 104);
      ctx.lineTo(170, 104);
      ctx.lineTo(174, 144);
      ctx.lineTo(220, 196);
      ctx.lineTo(198, 236);
      ctx.lineTo(202, 274);
      ctx.lineTo(184, 296);
      ctx.lineTo(82, 296);
      ctx.lineTo(64, 274);
      ctx.lineTo(68, 236);
      ctx.lineTo(46, 196);
      ctx.lineTo(92, 144);
      ctx.closePath();
    },
    wallBounds(y) {
      if (y < 146) return { cx: 133, left: 97, right: 169 };
      if (y <= 198) {
        const t = (y - 146) / 52;
        const hw = 40 + t * 44;
        return { cx: 133, left: 133 - hw, right: 133 + hw };
      }
      if (y <= 236) {
        const t = (y - 198) / 38;
        const hw = 84 - t * 21;
        return { cx: 133, left: 133 - hw, right: 133 + hw };
      }
      if (y <= 272) {
        const t = (y - 236) / 36;
        const hw = 63 + t * 4;
        return { cx: 133, left: 133 - hw, right: 133 + hw };
      }
      const t = Math.min(1, (y - 272) / 22);
      const hw = 67 - t * 17;
      return { cx: 133, left: 133 - hw, right: 133 + hw };
    },
    bottomY: (x) => 293 - 6 * Math.pow(Math.min(1, Math.abs(x - 133) / 56), 2),
  },

  bear: {
    cx: 140, mouthY: 77, mouthRx: 42, mouthRy: 7, liqTop: 124, liqBot: 284, fullPile: 30,
    art: { src: "/jar-art/bear.webp", x: 14, y: 44, w: 252, h: 278, shadowY: 322, shadowRx: 86, spillY: 77, spillRx: 44 },
    chamberPath(ctx) {
      ctx.beginPath();
      ctx.ellipse(140, 204, 104, 80, 0, 0, TAU);
    },
    dropPath(ctx) {
      ctx.beginPath();
      ctx.moveTo(96, 77);
      ctx.lineTo(184, 77);
      ctx.lineTo(184, 126);
      ctx.bezierCurveTo(224, 140, 244, 170, 244, 204);
      ctx.bezierCurveTo(244, 250, 198, 284, 140, 284);
      ctx.bezierCurveTo(82, 284, 36, 250, 36, 204);
      ctx.bezierCurveTo(36, 170, 56, 140, 96, 126);
      ctx.closePath();
    },
    wallBounds(y) {
      if (y < 124) return { cx: 140, left: 98, right: 182 };
      return ellipseWall(140, 204, 102, 79, y);
    },
    bottomY: (x) => ellipseFloor(140, 204, 102, 79, x),
  },

  honey: {
    cx: 135, mouthY: 113, mouthRx: 40, mouthRy: 7, liqTop: 156, liqBot: 298, fullPile: 26,
    art: { src: "/jar-art/honey.webp", x: 32, y: 6, w: 215, h: 316, shadowY: 322, shadowRx: 66, spillY: 113, spillRx: 40 },
    chamberPath(ctx) {
      ctx.beginPath();
      ctx.ellipse(135, 227, 86, 71, 0, 0, TAU);
    },
    dropPath(ctx) {
      ctx.beginPath();
      ctx.moveTo(95, 113);
      ctx.lineTo(175, 113);
      ctx.lineTo(175, 158);
      ctx.bezierCurveTo(208, 172, 221, 198, 221, 227);
      ctx.bezierCurveTo(221, 268, 184, 298, 135, 298);
      ctx.bezierCurveTo(86, 298, 49, 268, 49, 227);
      ctx.bezierCurveTo(49, 198, 62, 172, 95, 158);
      ctx.closePath();
    },
    wallBounds(y) {
      if (y < 156) return { cx: 135, left: 96, right: 174 };
      return ellipseWall(135, 227, 84, 70, y);
    },
    bottomY: (x) => ellipseFloor(135, 227, 84, 70, x),
  },

  gacha: {
    cx: 140, mouthY: 20, mouthRx: 41, mouthRy: 6, liqTop: 50, liqBot: 224, fullPile: 30,
    art: { src: "/jar-art/gacha.webp", x: 18, y: 6, w: 245, h: 316, shadowY: 322, shadowRx: 80, spillY: 20, spillRx: 42 },
    chamberPath(ctx) {
      ctx.beginPath();
      ctx.ellipse(140, 138, 108, 88, 0, 0, TAU);
    },
    dropPath(ctx) {
      ctx.beginPath();
      ctx.moveTo(98, 20);
      ctx.lineTo(182, 20);
      ctx.lineTo(182, 54);
      ctx.bezierCurveTo(226, 68, 248, 102, 248, 138);
      ctx.bezierCurveTo(248, 188, 200, 226, 140, 226);
      ctx.bezierCurveTo(80, 226, 32, 188, 32, 138);
      ctx.bezierCurveTo(32, 102, 54, 68, 98, 54);
      ctx.closePath();
    },
    wallBounds(y) {
      if (y < 50) return { cx: 140, left: 99, right: 181 };
      return ellipseWall(140, 138, 106, 86, y);
    },
    bottomY: (x) => ellipseFloor(140, 138, 106, 86, x),
  },

  ghost: {
    cx: 140, mouthY: 75, mouthRx: 46, mouthRy: 7, liqTop: 100, liqBot: 298, fullPile: 30,
    art: { src: "/jar-art/ghost.webp", x: 14, y: 66, w: 252, h: 256, shadowY: 322, shadowRx: 90, spillY: 75, spillRx: 46 },
    chamberPath(ctx) {
      ctx.beginPath();
      ctx.moveTo(86, 100);
      ctx.lineTo(194, 100);
      ctx.bezierCurveTo(222, 118, 238, 152, 238, 194);
      ctx.lineTo(240, 286);
      ctx.quadraticCurveTo(220, 306, 198, 294);
      ctx.quadraticCurveTo(170, 282, 140, 298);
      ctx.quadraticCurveTo(110, 282, 82, 294);
      ctx.quadraticCurveTo(60, 306, 40, 286);
      ctx.lineTo(42, 194);
      ctx.bezierCurveTo(42, 152, 58, 118, 86, 100);
      ctx.closePath();
    },
    dropPath(ctx) {
      ctx.beginPath();
      ctx.moveTo(92, 75);
      ctx.lineTo(188, 75);
      ctx.lineTo(194, 100);
      ctx.bezierCurveTo(222, 118, 238, 152, 238, 194);
      ctx.lineTo(240, 286);
      ctx.quadraticCurveTo(220, 306, 198, 294);
      ctx.quadraticCurveTo(170, 282, 140, 298);
      ctx.quadraticCurveTo(110, 282, 82, 294);
      ctx.quadraticCurveTo(60, 306, 40, 286);
      ctx.lineTo(42, 194);
      ctx.bezierCurveTo(42, 152, 58, 118, 86, 100);
      ctx.closePath();
    },
    wallBounds(y) {
      if (y < 100) return { cx: 140, left: 94, right: 186 };
      if (y <= 170) {
        const t = (y - 100) / 70;
        const hw = 64 + 32 * Math.sin(t * Math.PI * 0.5);
        return { cx: 140, left: 140 - hw, right: 140 + hw };
      }
      return { cx: 140, left: 44, right: 236 };
    },
    bottomY: (x) => 294 - 5 * Math.cos((x - 140) * 0.085),
  },

  aquarium: {
    cx: 140, mouthY: 67, mouthRx: 48, mouthRy: 7, liqTop: 88, liqBot: 254, fullPile: 30,
    art: { src: "/jar-art/aquarium.webp", x: 14, y: 55, w: 252, h: 267, shadowY: 322, shadowRx: 86, spillY: 67, spillRx: 48 },
    chamberPath(ctx) {
      ctx.beginPath();
      ctx.ellipse(140, 171, 109, 83, 0, 0, TAU);
    },
    dropPath(ctx) {
      ctx.beginPath();
      ctx.moveTo(90, 67);
      ctx.lineTo(190, 67);
      ctx.lineTo(190, 92);
      ctx.bezierCurveTo(230, 108, 249, 138, 249, 171);
      ctx.bezierCurveTo(249, 218, 200, 254, 140, 254);
      ctx.bezierCurveTo(80, 254, 31, 218, 31, 171);
      ctx.bezierCurveTo(31, 138, 50, 108, 90, 92);
      ctx.closePath();
    },
    wallBounds(y) {
      if (y < 88) return { cx: 140, left: 92, right: 188 };
      return ellipseWall(140, 171, 107, 82, y);
    },
    bottomY: (x) => ellipseFloor(140, 171, 107, 82, x),
  },
};

function drawSparkles(ctx, cx, cy, spread, time) {
  ctx.save();
  for (let i = 0; i < 4; i++) {
    const a = time * 0.7 + i * 1.65;
    const sx = cx + Math.cos(a) * spread * 0.62;
    const sy = cy + Math.sin(a * 0.8 + i) * spread * 0.45;
    const sc = 4 + 3 * Math.sin(time * 3.2 + i * 2);
    if (sc <= 1) continue;
    ctx.fillStyle = "rgba(255, 245, 195, 0.85)";
    ctx.beginPath();
    ctx.moveTo(sx, sy - sc);
    ctx.quadraticCurveTo(sx, sy, sx + sc, sy);
    ctx.quadraticCurveTo(sx, sy, sx, sy + sc);
    ctx.quadraticCurveTo(sx, sy, sx - sc, sy);
    ctx.quadraticCurveTo(sx, sy, sx, sy - sc);
    ctx.fill();
  }
  ctx.restore();
}

/** Creates an interactive animated 3D Glass Gift Jar canvas controller inside `container`. */
export function createJarCanvas(container, { reducedMotion = () => false } = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "jar__canvas";
  canvas.setAttribute("aria-hidden", "true");
  container.append(canvas);
  const ctx = canvas.getContext("2d");

  const imgCache = new Map();
  let design = "boba";
  let showLiquid = true;
  let showDrops = true;
  let targetPercent = 0;
  let smoothPercent = 0;
  let isFull = false;
  let palette = { accent: [255, 204, 0], pop: [255, 68, 136], bg: [255, 255, 255], text: [34, 34, 34] };

  const MAX_PHYSICS_BODIES = 48;
  const bodies = []; // persistent active & stacked 2D rigid-body gift tokens inside the vessel
  const spawnQueue = []; // staggered multi-gift & fill-proportional token shower queue
  const spawnedItemUids = new Set(); // ensures logical gift items aren't re-spawned on later syncs
  const splashes = []; // liquid splash droplets when gifts hit the wave surface
  const overflowDrops = []; // spilling tokens cascading over brim when full
  const overflowDrips = []; // glowing liquid beads overflowing the rim
  const bubbles = Array.from({ length: 14 }, (_, i) => ({
    offset: (i / 14),
    speed: 0.16 + (i % 5) * 0.045,
    r: 1.8 + (i % 3) * 1.1,
    phase: i * 1.9,
  }));

  let raf = 0;
  let lastT = 0;
  let simTime = 0;
  let spillAccum = 0;
  let spillSide = 1;
  let spawnCounter = 0;
  let dpr = 1;
  let hasSyncedOnce = false;

  function syncBodiesCount() {
    const v = VESSELS[design] || VESSELS.boba;
    canvas.dataset.bodies = String(bodies.length + spawnQueue.length);
    let escaped = 0;
    for (const b of bodies) {
      const wall = v.wallBounds(b.y);
      if (b.y < v.mouthY - 0.5 || b.x - b.r < wall.left - 1.5 || b.x + b.r > wall.right + 1.5) escaped += 1;
    }
    canvas.dataset.escaped = String(escaped);
  }

  function resize() {
    const cssScale = container.clientWidth > 0 ? container.clientWidth / W : 1;
    dpr = Math.min(3, Math.max(2, cssScale * (globalThis.devicePixelRatio || 1)));
    const pxW = Math.round(W * dpr);
    const pxH = Math.round(H * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
  }
  resize();
  syncBodiesCount();

  function getImg(src) {
    const clean = safeUrl(src);
    if (!clean) return null;
    let entry = imgCache.get(clean);
    if (!entry) {
      const img = new Image();
      if (clean.startsWith("https://")) img.referrerPolicy = "no-referrer";
      entry = { img, ready: false, failed: false };
      img.addEventListener("load", () => { entry.ready = true; renderFrame(); });
      img.addEventListener("error", () => { entry.failed = true; });
      img.src = clean;
      imgCache.set(clean, entry);
    }
    return entry;
  }

  function makeBody(item, fromTop = true, subIndex = 0) {
    const v = VESSELS[design] || VESSELS.boba;
    const unitDiamonds = Math.max(1, Number(item.diamonds) || Number(item.amount) || 1);
    const r = unitDiamonds >= 1000 ? 17.5 : unitDiamonds >= 100 ? 15.5 : 13.5;
    spawnCounter += 1;
    const phi = ((spawnCounter * 0.6180339887) % 1) * 2 - 1;
    const spread = Math.max(-1, Math.min(1, phi * 0.78 + (Math.random() * 2 - 1) * 0.22));
    let x = v.cx;
    let yStart;
    if (fromTop) {
      yStart = v.mouthY + r * 0.25 + (subIndex % 2) * 2;
      const topWall = v.wallBounds(yStart);
      const minX = topWall.left + r + 1;
      const maxX = topWall.right - r - 1;
      x = maxX > minX
        ? Math.max(minX, Math.min(maxX, topWall.cx + spread * (maxX - topWall.cx)))
        : topWall.cx;
    } else {
      const rowHeight = r * 1.65;
      const layer = Math.floor(subIndex / 3);
      const targetY = Math.max(v.liqTop + r, v.liqBot - r - layer * rowHeight);
      const wb = v.wallBounds(targetY);
      const usableHalf = Math.max(4, (wb.right - wb.left) * 0.5 - r - 1);
      x = wb.cx + spread * usableHalf;
      yStart = Math.min(targetY, v.bottomY(x) - r);
    }
    return {
      uid: `${item.uid}:${subIndex}`,
      parentUid: item.uid,
      spawnIdx: spawnCounter,
      picture: item.picture || "",
      amount: unitDiamonds,
      r,
      x,
      y: yStart,
      vx: fromTop ? (Math.random() - 0.5) * 46 : 0,
      vy: fromTop ? 190 + Math.random() * 60 : 0,
      angle: (Math.random() - 0.5) * 0.7,
      vAngle: fromTop ? (Math.random() - 0.5) * 3.5 : 0,
      splashed: !fromTop,
      supported: false,
    };
  }

  function spawnOverflow(item, count = 4) {
    if (reducedMotion()) return;
    const v = VESSELS[design] || VESSELS.boba;
    const spillY = v.art?.spillY ?? (v.mouthY + 2);
    const spillRx = v.art?.spillRx ?? v.mouthRx;
    const fallbackPic = bodies.length ? bodies[bodies.length - 1]?.picture : "";
    const pic = item?.picture || fallbackPic || "";

    if (showDrops) {
      for (let i = 0; i < count; i++) {
        if (overflowDrops.length >= 20) overflowDrops.shift();
        spillSide *= -1;
        const offsetRatio = 0.55 + Math.random() * 0.25;
        overflowDrops.push({
          picture: pic,
          r: 10.5 + Math.random() * 3.5,
          x: v.cx + spillSide * spillRx * offsetRatio,
          y: spillY - Math.random() * 6,
          vx: spillSide * (22 + Math.random() * 26),
          vy: -(78 + Math.random() * 72),
          angle: (Math.random() - 0.5) * 0.8,
          vAngle: spillSide * (2.4 + Math.random() * 2.4),
        });
      }
    }

    if (showLiquid) {
      const drips = Math.min(5, Math.max(1, Math.ceil(count * 0.7)));
      for (let i = 0; i < drips; i++) {
        if (overflowDrips.length >= 28) overflowDrips.shift();
        const side = i % 2 === 0 ? 1 : -1;
        overflowDrips.push({
          x: v.cx + side * (spillRx * (0.58 + Math.random() * 0.24)),
          y: spillY,
          vx: side * (18 + Math.random() * 24),
          vy: -(32 + Math.random() * 44),
          r: 3.2 + Math.random() * 2.4,
          life: 1,
        });
      }
    }
  }

  function stepPhysics(dt, headless = false) {
    const v = VESSELS[design] || VESSELS.boba;
    const liquidY = v.liqBot - (Math.max(0, Math.min(100, smoothPercent)) / 100) * (v.liqBot - v.liqTop);
    const subSteps = 3;
    const h = dt / subSteps;
    const gravity = 940;
    const maxPile = v.fullPile || 28;

    if (!headless) {
      while (spawnQueue.length && spawnQueue[0].readyAt <= simTime) {
        const nextSpawn = spawnQueue.shift();
        if (bodies.length >= maxPile) bodies.shift();
        bodies.push(makeBody(nextSpawn.item, true, nextSpawn.subIndex));
      }

      if (isFull) {
        spillAccum += dt;
        if (spillAccum >= 0.34) {
          spillAccum = 0;
          const pick = bodies.length ? bodies[Math.floor(Math.random() * bodies.length)] : null;
          spawnOverflow(pick, 1);
        }
      } else {
        spillAccum = 0;
      }
    }

    const bodyCount = bodies.length;
    for (let s = 0; s < subSteps; s++) {
      for (let i = 0; i < bodyCount; i++) {
        const b = bodies[i];
        const inLiquid = showLiquid && smoothPercent > 2 && b.y + b.r * 0.5 >= liquidY;

        if (!headless && !b.splashed && inLiquid && b.vy > 70) {
          b.splashed = true;
          for (let k = 0; k < 5; k++) {
            splashes.push({
              x: b.x + (Math.random() - 0.5) * 14,
              y: liquidY,
              vx: (Math.random() - 0.5) * 110,
              vy: -60 - Math.random() * 85,
              life: 1,
            });
          }
        }

        b.vy += gravity * h;
        if (inLiquid) {
          b.vx *= Math.pow(0.65, h);
          b.vy *= Math.pow(0.88, h);
        }
        b.vAngle *= Math.pow(0.12, h);

        b.x += b.vx * h;
        b.y += b.vy * h;
        b.angle += b.vAngle * h;

        const wall = v.wallBounds(b.y);
        if (b.x - b.r < wall.left) {
          b.x = wall.left + b.r;
          b.vx = Math.abs(b.vx) > 20 ? Math.abs(b.vx) * 0.22 : 0;
        } else if (b.x + b.r > wall.right) {
          b.x = wall.right - b.r;
          b.vx = Math.abs(b.vx) > 20 ? -Math.abs(b.vx) * 0.22 : 0;
        }

        const fy = v.bottomY(b.x);
        if (b.y + b.r >= fy) {
          b.y = fy - b.r;
          if (b.vy > 48) b.vy = -b.vy * 0.14;
          else if (b.vy > 0) b.vy = 0;
          b.vx *= 0.82;
          b.vAngle = Math.abs(b.vx) > 8 ? b.vx / Math.max(12, b.r) : 0;
          b.supported = true;
        } else {
          b.supported = false;
        }
      }

      // Multi-pass 2D rigid-body circle collision + anti-totem-pole lateral roll (Matter.js style)
      for (let pass = 0; pass < 6; pass++) {
        for (let i = 0; i < bodyCount; i++) {
          const a = bodies[i];
          for (let j = i + 1; j < bodyCount; j++) {
            const b = bodies[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const minD = a.r + b.r - 0.8;
            const d2 = dx * dx + dy * dy;
            if (d2 >= minD * minD) continue;

            const dist = Math.sqrt(d2);
            const fallbackDir = (a.spawnIdx + b.spawnIdx) % 2 === 0 ? 1 : -1;
            const nx = dist > 0.01 ? dx / dist : fallbackDir * 0.48;
            const ny = dist > 0.01 ? dy / dist : -0.877;
            const pen = minD - dist;

            const aLower = a.y > b.y;
            const wA = aLower ? 0.25 : 0.75;
            const wB = 1 - wA;

            a.x -= nx * pen * wA;
            a.y -= ny * pen * wA;
            b.x += nx * pen * wB;
            b.y += ny * pen * wB;

            // +y is downward: larger y supports the token resting above it
            if (dy > 0.25 * minD) a.supported = true;
            else if (dy < -0.25 * minD) b.supported = true;

            if (pass === 0) {
              const upper = a.y < b.y ? a : b;
              if (Math.abs(nx) < 0.38 && (!upper.supported || Math.abs(upper.vy) > 18)) {
                const rollDir = Math.abs(dx) > 0.4 ? Math.sign(dx) : fallbackDir;
                upper.vx += rollDir * 52;
                upper.x += rollDir * 0.8;
              }
              const rvx = b.vx - a.vx;
              const rvy = b.vy - a.vy;
              const vn = rvx * nx + rvy * ny;
              if (vn < 0) {
                const jImp = -1.14 * vn;
                a.vx -= jImp * nx * wA;
                a.vy -= jImp * ny * wA;
                b.vx += jImp * nx * wB;
                b.vy += jImp * ny * wB;
                a.angle -= (nx * pen * wA) / Math.max(10, a.r);
                b.angle += (nx * pen * wB) / Math.max(10, b.r);
              }
            }
          }
        }

        // Re-clamp against top mouth, outer curved walls & bottom floor after every solver iteration
        for (let i = 0; i < bodyCount; i++) {
          const b = bodies[i];
          const topLimit = v.mouthY + b.r * 0.2;
          if (b.y < topLimit) {
            b.y = topLimit;
            if (b.vy < 0) b.vy = 0;
          }
          const wall = v.wallBounds(b.y);
          if (b.x - b.r < wall.left) b.x = wall.left + b.r;
          if (b.x + b.r > wall.right) b.x = wall.right - b.r;
          const fy = v.bottomY(b.x);
          if (b.y + b.r > fy) {
            b.y = fy - b.r;
            if (b.vy > 0) b.vy = 0;
            b.supported = true;
          }
        }
      }

      // Sleep damping on slow supported tokens so the stacked pile rests solidly
      for (let i = 0; i < bodyCount; i++) {
        const b = bodies[i];
        if (b.supported && Math.hypot(b.vx, b.vy) < 28) {
          b.vx *= 0.7;
          b.vy *= 0.7;
          b.vAngle *= 0.6;
        }
      }
    }

    if (headless) return;

    // Update liquid splash droplets
    for (let i = splashes.length - 1; i >= 0; i--) {
      const sp = splashes[i];
      sp.vy += 420 * dt;
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.life -= dt * 2.1;
      if (sp.life <= 0) splashes.splice(i, 1);
    }

    // Update overflowing gift drops spilling over the outer rim
    for (let i = overflowDrops.length - 1; i >= 0; i--) {
      const od = overflowDrops[i];
      od.vy += 420 * dt;
      od.x += od.vx * dt;
      od.y += od.vy * dt;
      od.angle += od.vAngle * dt;
      if (od.y > H - 14 || od.x < -20 || od.x > W + 20) overflowDrops.splice(i, 1);
    }

    // Update overflowing rim droplets
    for (let i = overflowDrips.length - 1; i >= 0; i--) {
      const d = overflowDrips[i];
      d.vy += 260 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.life -= dt * 0.95;
      if (d.life <= 0 || d.y > H - 16) overflowDrips.splice(i, 1);
    }
  }

  function drawOverflow(context) {
    for (const d of overflowDrips) {
      const yFade = Math.max(0, Math.min(1, d.life)) * (d.y > 260 ? Math.max(0, 1 - (d.y - 260) / 60) : 1);
      const xFade = Math.min(1, Math.max(0, (d.x - d.r - 4) / 14), Math.max(0, (W - d.r - 4 - d.x) / 14));
      const fade = yFade * xFade;
      if (fade <= 0.02) continue;
      context.save();
      context.fillStyle = withAlpha(palette.pop, 0.72 * fade);
      context.beginPath();
      context.arc(d.x, d.y, d.r, 0, TAU);
      context.fill();
      context.fillStyle = `rgba(255, 255, 255, ${(0.55 * fade).toFixed(2)})`;
      context.beginPath();
      context.arc(d.x - d.r * 0.28, d.y - d.r * 0.28, d.r * 0.34, 0, TAU);
      context.fill();
      context.restore();
    }
    for (const od of overflowDrops) {
      const yFade = od.y > 245 ? Math.max(0, 1 - (od.y - 245) / 76) : 1;
      const xFade = Math.min(1, Math.max(0, (od.x - od.r - 4) / 16), Math.max(0, (W - od.r - 4 - od.x) / 16));
      const fade = yFade * xFade;
      if (fade <= 0.02) continue;
      context.save();
      context.globalAlpha = fade * 0.94;
      drawToken(context, od, palette, getImg);
      context.restore();
    }
  }

  function renderFrame() {
    syncBodiesCount();
    if (!ctx) return;
    const v = VESSELS[design] || VESSELS.boba;
    const artEntry = v.art ? getImg(v.art.src) : null;
    const artReady = Boolean(artEntry?.ready && !artEntry?.failed);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Layer 0: Ambient contact shadow under jar base
    const shadowY = artReady ? v.art.shadowY : 312;
    const shadowRx = artReady ? v.art.shadowRx : 88;
    ctx.save();
    const sh = ctx.createRadialGradient(v.cx, shadowY, 8, v.cx, shadowY, shadowRx);
    sh.addColorStop(0, "rgba(0, 0, 0, 0.34)");
    sh.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.ellipse(v.cx, shadowY, shadowRx, 12, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Layer 1: Cylindrical Glass Cavity Shading (edge darkness -> translucent center -> edge glow)
    ctx.save();
    v.chamberPath(ctx);
    ctx.clip();

    const glassGrad = ctx.createLinearGradient(v.cx - 95, 0, v.cx + 95, 0);
    glassGrad.addColorStop(0, withAlpha(palette.accent, 0.14));
    glassGrad.addColorStop(0.22, withAlpha(palette.bg, 0.08));
    glassGrad.addColorStop(0.5, withAlpha(palette.bg, 0.04));
    glassGrad.addColorStop(0.78, withAlpha(palette.bg, 0.08));
    glassGrad.addColorStop(1, withAlpha(palette.pop, 0.14));
    ctx.fillStyle = glassGrad;
    ctx.fillRect(0, 0, W, H);

    // Layer 2: Rising Glow Wave Liquid + 3D Surface Meniscus + Fizzy Bubbles
    const liquidY = v.liqBot - (Math.max(0, Math.min(100, smoothPercent)) / 100) * (v.liqBot - v.liqTop);
    if (showLiquid && smoothPercent > 0.5) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let px = 0; px <= W; px += 8) {
        const wave = Math.sin(px * 0.045 + simTime * 2.6) * 3.5 + Math.cos(px * 0.025 - simTime * 1.8) * 2.2;
        ctx.lineTo(px, liquidY + (smoothPercent >= 99 ? 0.3 * wave : wave));
      }
      ctx.lineTo(W, H);
      ctx.closePath();

      const liqGrad = ctx.createLinearGradient(0, liquidY, 0, v.liqBot);
      liqGrad.addColorStop(0, withAlpha(palette.pop, 0.24));
      liqGrad.addColorStop(0.35, withAlpha(palette.accent, 0.32));
      liqGrad.addColorStop(1, withAlpha(palette.accent, 0.44));
      ctx.fillStyle = liqGrad;
      ctx.fill();

      // Bright luminous top meniscus rim
      ctx.strokeStyle = "rgba(255,255,255,0.72)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let px = 0; px <= W; px += 8) {
        const wave = Math.sin(px * 0.045 + simTime * 2.6) * 3.5 + Math.cos(px * 0.025 - simTime * 1.8) * 2.2;
        const wy = liquidY + (smoothPercent >= 99 ? 0.3 * wave : wave);
        if (px === 0) ctx.moveTo(px, wy);
        else ctx.lineTo(px, wy);
      }
      ctx.stroke();

      // Rising fizz bubbles inside liquid volume
      const depth = Math.max(0, v.liqBot - liquidY);
      if (depth > 16) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.52)";
        for (const bb of bubbles) {
          const cycle = (bb.offset + simTime * bb.speed) % 1;
          const by = v.liqBot - cycle * (depth - 8);
          const span = v.wallBounds(by);
          const bx = span.cx + Math.sin(bb.phase + simTime * 1.9) * Math.max(6, (span.right - span.left) * 0.36);
          ctx.beginPath();
          ctx.arc(bx, by, bb.r, 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // Splashes inside chamber
    for (const sp of splashes) {
      ctx.save();
      ctx.fillStyle = withAlpha(palette.pop, Math.max(0, sp.life * 0.85));
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 2.8 * sp.life, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore(); // end liquid glass clip

    // Layer 3a: Gifts strictly inside vessel / behind PNG glass & front rim
    if (showDrops && bodies.length) {
      ctx.save();
      (v.dropPath || v.chamberPath)(ctx);
      ctx.clip();
      for (const b of bodies) drawToken(ctx, b, palette, getImg);
      ctx.restore();
    }

    // Layer 4: Crisp processed crystal vessel WebP composited over liquid & stacked gifts (or minimal glass stroke while decoding)
    if (artReady) {
      ctx.drawImage(artEntry.img, v.art.x, v.art.y, v.art.w, v.art.h);
      if (isFull) drawSparkles(ctx, v.cx, (v.liqTop + v.liqBot) * 0.5, 68, simTime * 1.3);
    } else {
      ctx.save();
      ctx.strokeStyle = withAlpha(palette.accent, 0.72);
      ctx.lineWidth = 2.6;
      v.chamberPath(ctx);
      ctx.stroke();
      ctx.restore();
    }
    drawOverflow(ctx);
  }

  function loop(now) {
    const dt = lastT ? Math.min(0.033, (now - lastT) / 1000) : 0.016;
    lastT = now;
    if (!reducedMotion()) {
      simTime += dt;
      smoothPercent += (targetPercent - smoothPercent) * Math.min(1, dt * 6.5);
      stepPhysics(dt);
    } else {
      smoothPercent = targetPercent;
    }
    renderFrame();
    raf = requestAnimationFrame(loop);
  }

  function ensureRunning() {
    if (!raf && typeof requestAnimationFrame === "function") raf = requestAnimationFrame(loop);
  }

  function stop() {
    if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
    raf = 0;
  }

  return {
    setConfig({ design: d, showLiquid: liq, showDrops: drops, vars }) {
      const nextDesign = Object.hasOwn(VESSELS, d) ? d : "boba";
      const changed = nextDesign !== design;
      design = nextDesign;
      showLiquid = Boolean(liq);
      showDrops = Boolean(drops);
      resize();
      if (VESSELS[design]?.art) getImg(VESSELS[design].art.src);
      if (vars) {
        palette = {
          accent: parseHexRgb(vars.accent) || palette.accent,
          pop: parseHexRgb(vars.pop) || palette.pop,
          bg: parseHexRgb(vars.bg) || palette.bg,
          text: parseHexRgb(vars.text) || palette.text,
        };
      }
      if (changed) {
        for (const b of bodies) {
          b.vx += (Math.random() - 0.5) * 35;
          b.supported = false;
        }
      }
      ensureRunning();
    },
    sync({ percent, full, items, droppedUid = "" }) {
      const wasFull = isFull;
      targetPercent = Math.max(0, Math.min(100, Number(percent) || 0));
      isFull = Boolean(full);
      const keep = new Set(items.map((it) => it.uid));
      for (let i = bodies.length - 1; i >= 0; i--) {
        if (!keep.has(bodies[i].parentUid)) bodies.splice(i, 1);
      }
      for (let i = spawnQueue.length - 1; i >= 0; i--) {
        if (!keep.has(spawnQueue[i].item.uid)) spawnQueue.splice(i, 1);
      }
      for (const uid of [...spawnedItemUids]) {
        if (!keep.has(uid)) spawnedItemUids.delete(uid);
      }
      const initialLoad = !hasSyncedOnce && !droppedUid;
      hasSyncedOnce = true;
      const fullPile = (VESSELS[design] || VESSELS.boba).fullPile || 40;
      const desiredFillBodies = targetPercent <= 0 ? 0 : Math.max(1, Math.round((Math.min(100, targetPercent) / 100) * fullPile));
      let addedBatch = false;
      let droppedItem = null;
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        if (droppedUid && it.uid === droppedUid) droppedItem = it;
        if (spawnedItemUids.has(it.uid)) continue;
        spawnedItemUids.add(it.uid);

        const rawCount = Math.max(1, Math.round(Number(it.count) || 1));
        const byCount = Math.min(24, rawCount);
        const currentTotal = bodies.length + spawnQueue.length;
        const neededForFill = idx === items.length - 1 ? Math.max(0, desiredFillBodies - currentTotal) : 0;
        const spawnCount = Math.max(1, Math.min(fullPile, Math.max(byCount, neededForFill)));

        if (!initialLoad && !reducedMotion()) {
          bodies.push(makeBody(it, true, 0));
          const interval = spawnCount > 14 ? 0.032 : 0.052;
          const baseReady = spawnQueue.length ? Math.max(simTime, spawnQueue[spawnQueue.length - 1].readyAt) : simTime;
          for (let k = 1; k < spawnCount; k++) {
            spawnQueue.push({ item: it, subIndex: k, readyAt: baseReady + k * interval });
          }
        } else {
          for (let k = 0; k < spawnCount; k++) {
            bodies.push(makeBody(it, false, k));
          }
          addedBatch = true;
        }
      }
      let overflow = bodies.length + spawnQueue.length - fullPile;
      while (overflow > 0 && bodies.length > 0) {
        bodies.shift();
        overflow -= 1;
      }
      if (overflow > 0 && spawnQueue.length > overflow) {
        spawnQueue.splice(0, overflow);
      }
      if (addedBatch) {
        smoothPercent = targetPercent;
        for (let i = 0; i < 75; i++) stepPhysics(0.016, true);
      }
      if (!wasFull && isFull) {
        spawnOverflow(droppedItem || items[items.length - 1], 7);
      } else if (isFull && droppedUid) {
        spawnOverflow(droppedItem || items[items.length - 1], 3);
      }
      syncBodiesCount();
      ensureRunning();
    },
    clear() {
      bodies.length = 0;
      spawnQueue.length = 0;
      spawnedItemUids.clear();
      splashes.length = 0;
      overflowDrops.length = 0;
      overflowDrips.length = 0;
      spillAccum = 0;
      targetPercent = 0;
      smoothPercent = 0;
      isFull = false;
      hasSyncedOnce = false;
      renderFrame();
    },
    destroy: stop,
  };
}

function drawToken(ctx, b, palette, getImg) {
  if ((b.alpha ?? 1) <= 0.02) return;
  ctx.save();
  ctx.globalAlpha *= b.alpha ?? 1;
  ctx.translate(b.x, b.y);
  ctx.rotate(b.angle);

  // Soft 3D spherical rim & contact drop shadow
  ctx.shadowColor = "rgba(0, 0, 0, 0.28)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;

  const coinGrad = ctx.createRadialGradient(-b.r * 0.3, -b.r * 0.35, 2, 0, 0, b.r);
  coinGrad.addColorStop(0, "rgba(255, 255, 255, 0.38)");
  coinGrad.addColorStop(1, withAlpha(palette.accent, 0.25));
  ctx.fillStyle = coinGrad;
  ctx.beginPath();
  ctx.arc(0, 0, b.r, 0, TAU);
  ctx.fill();
  ctx.shadowColor = "transparent";

  const entry = getImg(b.picture);
  if (entry?.ready && !entry.failed) {
    ctx.drawImage(entry.img, -b.r * 0.92, -b.r * 0.92, b.r * 1.84, b.r * 1.84);
  } else {
    // Faceted glowing 3D gem fallback while image loads or lacks picture
    ctx.fillStyle = withAlpha(palette.pop, 0.92);
    ctx.beginPath();
    ctx.moveTo(0, -b.r * 0.72);
    ctx.lineTo(b.r * 0.68, 0);
    ctx.lineTo(0, b.r * 0.72);
    ctx.lineTo(-b.r * 0.68, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    ctx.beginPath();
    ctx.moveTo(0, -b.r * 0.72);
    ctx.lineTo(b.r * 0.68, 0);
    ctx.lineTo(0, -b.r * 0.08);
    ctx.closePath();
    ctx.fill();
  }

  // Subtle specular rim glint on top-left of gift token
  ctx.strokeStyle = "rgba(255, 255, 255, 0.58)";
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(0, 0, b.r - 0.8, Math.PI * 1.05, Math.PI * 1.55);
  ctx.stroke();

  ctx.restore();
}
