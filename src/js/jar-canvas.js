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
    cx: 140, mouthY: 72, mouthRx: 26, mouthRy: 6, liqTop: 132, liqBot: 298,
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
    cx: 140, mouthY: 108, mouthRx: 20, mouthRy: 6, liqTop: 170, liqBot: 300,
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
    cx: 140, mouthY: 70, mouthRx: 30, mouthRy: 5, liqTop: 118, liqBot: 274,
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
    cx: 140, mouthY: 82, mouthRx: 46, mouthRy: 10, liqTop: 136, liqBot: 298,
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
    cx: 140, mouthY: 88, mouthRx: 52, mouthRy: 10, liqTop: 120, liqBot: 276,
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
    cx: 140, mouthY: 64, mouthRx: 44, mouthRy: 6, liqTop: 74, liqBot: 268,
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

  const bodies = []; // active physics bodies inside the vessel
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
  let dpr = 1;

  function resize() {
    dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const pxW = Math.round(W * dpr);
    const pxH = Math.round(H * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
  }
  resize();

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

  function makeBody(item, fromTop = true) {
    const v = VESSELS[design] || VESSELS.boba;
    const amt = Math.max(1, Number(item.amount) || Number(item.diamonds) || 1);
    const r = amt >= 1000 ? 20 : amt >= 50 ? 17.5 : 15;
    const maxSpread = Math.max(3, (v.mouthRx || 30) - r - 3);
    const jitter = (Math.random() * 2 - 1) * maxSpread * 0.85;
    const yStart = fromTop
      ? (v.art?.internalSpawn ? v.mouthY - 2 : Math.max(-18, v.mouthY - 26 - Math.random() * 14))
      : (v.liqBot - 40 - Math.random() * 80);
    return {
      uid: item.uid,
      picture: item.picture || "",
      amount: amt,
      r,
      x: v.cx + jitter,
      y: yStart,
      vx: fromTop ? (Math.random() - 0.5) * 75 : 0,
      vy: fromTop ? 88 + Math.random() * 60 : 0,
      angle: (Math.random() - 0.5) * 0.8,
      vAngle: fromTop ? (Math.random() - 0.5) * 4 : 0,
      splashed: !fromTop,
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
        const offsetRatio = 0.72 + Math.random() * 0.35;
        overflowDrops.push({
          picture: pic,
          r: 10.5 + Math.random() * 3.5,
          x: v.cx + spillSide * spillRx * offsetRatio,
          y: spillY - Math.random() * 6,
          vx: spillSide * (62 + Math.random() * 64),
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
          x: v.cx + side * (spillRx * (0.78 + Math.random() * 0.28)),
          y: spillY,
          vx: side * (42 + Math.random() * 46),
          vy: -(32 + Math.random() * 44),
          r: 3.2 + Math.random() * 2.4,
          life: 1,
        });
      }
    }
  }

  function stepPhysics(dt) {
    const v = VESSELS[design] || VESSELS.boba;
    const liquidY = v.liqBot - (Math.max(0, Math.min(100, smoothPercent)) / 100) * (v.liqBot - v.liqTop);
    const subSteps = 3;
    const h = dt / subSteps;
    const gravity = 680;

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

    for (let s = 0; s < subSteps; s++) {
      for (const b of bodies) {
        const insideMouth = !v.art?.internalSpawn && b.y < v.mouthY + 6;
        const inLiquid = showLiquid && smoothPercent > 2 && b.y + b.r * 0.5 >= liquidY;

        if (!b.splashed && inLiquid && b.vy > 70) {
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

        b.vy += gravity * h * (inLiquid ? 0.36 : 1);
        if (inLiquid) {
          b.vx *= Math.pow(0.08, h);
          b.vy *= Math.pow(0.12, h);
        }
        b.vAngle *= Math.pow(0.05, h);

        b.x += b.vx * h;
        b.y += b.vy * h;
        b.angle += b.vAngle * h;

        if (!insideMouth) {
          const wall = v.wallBounds(b.y);
          if (b.x - b.r < wall.left) {
            b.x = wall.left + b.r;
            b.vx = Math.abs(b.vx) > 25 ? Math.abs(b.vx) * 0.24 : 0;
            b.vAngle *= 0.6;
          } else if (b.x + b.r > wall.right) {
            b.x = wall.right - b.r;
            b.vx = Math.abs(b.vx) > 25 ? -Math.abs(b.vx) * 0.24 : 0;
            b.vAngle *= 0.6;
          }
          const fy = v.bottomY(b.x);
          if (b.y + b.r > fy) {
            b.y = fy - b.r;
            b.vy = b.vy > 36 ? -b.vy * 0.2 : 0;
            b.vx *= 0.72;
            b.vAngle = Math.abs(b.vx) > 6 ? b.vx / Math.max(12, b.r) : 0;
          }
        }

        if (Math.hypot(b.vx, b.vy) < 6) {
          b.vx *= 0.5;
          b.vy *= 0.5;
          b.vAngle *= 0.5;
          if (Math.hypot(b.vx, b.vy) < 1.5) {
            b.vx = 0;
            b.vy = 0;
            b.vAngle = 0;
          }
        }
      }

      // Circle-to-circle collisions (calm weighted solver passes with contact friction & zero micro-jitter bounce)
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < bodies.length; i++) {
          const a = bodies[i];
          for (let j = i + 1; j < bodies.length; j++) {
            const b = bodies[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const minD = a.r + b.r - 0.6;
            const distSq = dx * dx + dy * dy;
            if (distSq >= minD * minD) continue;
            const dist = Math.sqrt(distSq) || 0.01;
            const nx = dx / dist;
            const ny = dy / dist;
            const overlap = minD - dist - 0.35;
            if (overlap > 0) {
              const push = overlap * 0.42;
              a.x -= nx * push;
              a.y -= ny * push;
              b.x += nx * push;
              b.y += ny * push;
            }

            const rvx = b.vx - a.vx;
            const rvy = b.vy - a.vy;
            const relNorm = rvx * nx + rvy * ny;
            if (relNorm < 0) {
              const e = relNorm < -55 ? 0.22 : 0;
              const imp = -(1 + e) * relNorm * 0.5;
              a.vx -= imp * nx;
              a.vy -= imp * ny;
              b.vx += imp * nx;
              b.vy += imp * ny;
              // Damp tangential sliding between resting tokens
              const tx = -ny;
              const ty = nx;
              const relTan = rvx * tx + rvy * ty;
              const tanImp = relTan * 0.14;
              a.vx += tanImp * tx;
              a.vy += tanImp * ty;
              b.vx -= tanImp * tx;
              b.vy -= tanImp * ty;
            }
          }
        }
      }

      // Re-clamp against outer boundary post circle push so nothing ever escapes a curved wall
      for (const b of bodies) {
        if (b.y >= v.mouthY + 4) {
          const wall = v.wallBounds(b.y);
          if (b.x - b.r < wall.left) b.x = wall.left + b.r;
          if (b.x + b.r > wall.right) b.x = wall.right - b.r;
          const fy = v.bottomY(b.x);
          if (b.y + b.r > fy) { b.y = fy - b.r; b.vy = Math.min(0, b.vy); }
        }
      }
    }

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
      const fade = Math.max(0, Math.min(1, d.life)) * (d.y > 260 ? Math.max(0, 1 - (d.y - 260) / 60) : 1);
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
      const fade = od.y > 245 ? Math.max(0, 1 - (od.y - 245) / 76) : 1;
      if (fade <= 0.02) continue;
      context.save();
      context.globalAlpha = fade * 0.94;
      drawToken(context, od, palette, getImg);
      context.restore();
    }
  }

  function renderFrame() {
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
      liqGrad.addColorStop(0, withAlpha(palette.pop, 0.68));
      liqGrad.addColorStop(0.35, withAlpha(palette.accent, 0.74));
      liqGrad.addColorStop(1, withAlpha(palette.accent, 0.9));
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
      for (const b of bodies) {
        if (!artReady || v.art.internalSpawn || b.y + b.r >= v.mouthY) drawToken(ctx, b, palette, getImg);
      }
      ctx.restore();
    }

    // Layer 4: Crisp processed crystal vessel WebP composited over liquid & stacked gifts (or minimal glass stroke while decoding)
    if (artReady) {
      ctx.drawImage(artEntry.img, v.art.x, v.art.y, v.art.w, v.art.h);
      if (isFull) drawSparkles(ctx, v.cx, (v.liqTop + v.liqBot) * 0.5, 68, simTime * 1.3);
      if (showDrops && bodies.length && !v.art.internalSpawn) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W, v.mouthY + 1);
        ctx.clip();
        for (const b of bodies) if (b.y - b.r < v.mouthY) drawToken(ctx, b, palette, getImg);
        ctx.restore();
      }
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
        for (const b of bodies) b.vx += (Math.random() - 0.5) * 35;
      }
      ensureRunning();
    },
    sync({ percent, full, items, droppedUid = "" }) {
      const wasFull = isFull;
      targetPercent = Math.max(0, Math.min(100, Number(percent) || 0));
      isFull = Boolean(full);
      const keep = new Set(items.map((it) => it.uid));
      for (let i = bodies.length - 1; i >= 0; i--) {
        if (!keep.has(bodies[i].uid)) bodies.splice(i, 1);
      }
      const existing = new Set(bodies.map((b) => b.uid));
      let addedBatch = false;
      let droppedItem = null;
      for (const it of items) {
        if (droppedUid && it.uid === droppedUid) droppedItem = it;
        if (existing.has(it.uid)) continue;
        const freshDrop = !droppedUid || it.uid === droppedUid;
        bodies.push(makeBody(it, freshDrop && !reducedMotion()));
        if (!freshDrop || reducedMotion()) addedBatch = true;
      }
      // Headless pre-settle restored items immediately
      if (addedBatch) {
        smoothPercent = targetPercent;
        for (let i = 0; i < 90; i++) stepPhysics(0.016);
      }
      if (!wasFull && isFull) {
        spawnOverflow(droppedItem || items[items.length - 1], 7);
      } else if (isFull && droppedUid) {
        spawnOverflow(droppedItem || items[items.length - 1], 3);
      }
      ensureRunning();
    },
    clear() {
      bodies.length = 0;
      splashes.length = 0;
      overflowDrops.length = 0;
      overflowDrips.length = 0;
      spillAccum = 0;
      targetPercent = 0;
      smoothPercent = 0;
      isFull = false;
      renderFrame();
    },
    destroy: stop,
  };
}

function drawToken(ctx, b, palette, getImg) {
  ctx.save();
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
