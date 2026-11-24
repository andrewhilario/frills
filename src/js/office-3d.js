// Cozy 3D Virtual Office Diorama for /admin/office/ powered by Three.js (self-hosted, zero external URLs).
// Renders Frills HQ with 4 animated 3D kawaii operator desks (Mochi Frog, Yuzu Neko, Boba Bunny, Kero Hamster),
// live dynamic wall whiteboard, blinking server rack LEDs, LED ring light, orbiting camera + click raycasting,
// Day / Cozy Night lighting toggle, and 3D-projected floating status badges.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const DESK_LAYOUT = {
  ops:       { x: -2.45, z: -2.05, yaw: 0.25,  accent: 0x7fd694, matHex: "#8fd694", screenBg: "#12211b", screenAccent: "#6df2b0" },
  growth:    { x:  2.45, z: -2.05, yaw: -0.25, accent: 0xff9ec6, matHex: "#ff9ec6", screenBg: "#251420", screenAccent: "#ff85bd" },
  community: { x: -2.45, z:  2.15, yaw: 0.35,  accent: 0xc2a8ff, matHex: "#c2a8ff", screenBg: "#1a162b", screenAccent: "#bda4ff" },
  qa:        { x:  2.45, z:  2.15, yaw: -0.35, accent: 0xffd166, matHex: "#ffd166", screenBg: "#241d10", screenAccent: "#ffd166" },
};

const STATUS_COLORS = {
  idle: 0x94a3b8,
  working: 0x34d399,
  waiting: 0xfbbf24,
  alert: 0xf43f5e,
};

const STATUS_LABELS = {
  idle: "Idle",
  working: "Working",
  waiting: "Needs review",
  alert: "Alert",
};

const OVERVIEW_POS = new THREE.Vector3(11.4, 9.8, 11.4);
const OVERVIEW_TARGET = new THREE.Vector3(0, 0.75, 0.1);

function makeFloorTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#e7cba0";
  ctx.fillRect(0, 0, 512, 512);
  const plankH = 64;
  for (let row = 0; row < 8; row++) {
    ctx.fillStyle = row % 2 === 0 ? "#e9ce9f" : "#e2c493";
    ctx.fillRect(0, row * plankH, 512, plankH);
    ctx.strokeStyle = "rgba(110, 74, 38, 0.18)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, row * plankH);
    ctx.lineTo(512, row * plankH);
    ctx.stroke();
    const offset = (row % 2) * 128;
    for (let x = offset; x < 512; x += 256) {
      ctx.beginPath();
      ctx.moveTo(x, row * plankH);
      ctx.lineTo(x, (row + 1) * plankH);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeMonitorTexture(agentId, bg, accent) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 160;
  const ctx = c.getContext("2d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 160);
  // Top window bar
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.fillRect(0, 0, 256, 22);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = ["#ff6b81", "#ffd166", "#6df2b0"][i];
    ctx.beginPath(); ctx.arc(14 + i * 14, 11, 4, 0, Math.PI * 2); ctx.fill();
  }
  if (agentId === "ops") {
    // Relay bars + pulse wave
    for (let i = 0; i < 6; i++) {
      const h = 24 + ((i * 29) % 58);
      ctx.fillStyle = i % 2 === 0 ? accent : "#38bdf8";
      ctx.fillRect(18 + i * 36, 118 - h, 22, h);
    }
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(16, 138); ctx.lineTo(68, 138); ctx.lineTo(84, 124); ctx.lineTo(100, 146); ctx.lineTo(122, 134); ctx.lineTo(240, 134);
    ctx.stroke();
  } else if (agentId === "growth") {
    // Video timeline + play preview
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(16, 32, 118, 72);
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.moveTo(64, 52); ctx.lineTo(64, 84); ctx.lineTo(90, 68); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ffe5f0";
    ctx.fillRect(146, 36, 92, 12);
    ctx.fillRect(146, 56, 72, 10);
    ctx.fillRect(146, 74, 84, 10);
    ctx.fillStyle = accent;
    ctx.fillRect(16, 118, 160, 12);
    ctx.fillStyle = "#ffd166";
    ctx.fillRect(16, 136, 112, 10);
  } else if (agentId === "community") {
    // Chat bubbles
    for (let i = 0; i < 3; i++) {
      const y = 34 + i * 38;
      ctx.fillStyle = i % 2 === 0 ? accent : "#7dd3fc";
      ctx.beginPath(); ctx.arc(28, y + 14, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(48, y + 2, 178 - (i % 2) * 38, 24);
    }
  } else {
    // QA green check bars
    for (let i = 0; i < 4; i++) {
      const y = 34 + i * 28;
      ctx.fillStyle = "#4ade80";
      ctx.beginPath(); ctx.arc(26, y + 9, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = i === 0 ? accent : "rgba(255,255,255,0.28)";
      ctx.fillRect(44, y + 3, 180 - i * 20, 12);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeWhiteboard() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;

  const draw = (state) => {
    ctx.fillStyle = "#fbfaf6";
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = "#262834";
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, 504, 248);

    ctx.fillStyle = "#262834";
    ctx.font = "800 28px system-ui, sans-serif";
    ctx.fillText("FRILLS HQ · LIVE BOARD", 24, 44);
    ctx.fillStyle = "#16a34a";
    ctx.beginPath(); ctx.arc(472, 34, 9, 0, Math.PI * 2); ctx.fill();

    const relays = state?.pulse?.relays ?? [];
    const online = relays.filter((r) => r.ok);
    const liveRooms = online.reduce((s, r) => s + (r.used || 0), 0);
    const maxRooms = online.reduce((s, r) => s + (r.max || 0), 0);
    const plusSubs = state?.pulse?.accounts?.plusActive ?? 0;
    const unread = state?.pulse?.feedback?.new ?? 0;
    const review = state?.counts?.needsReview ?? 0;

    const cards = [
      ["RELAYS", relays.length ? `${online.length}/${relays.length} ON` : "STANDBY", "#dff7e5", "#16653b"],
      ["LIVE ROOMS", maxRooms ? `${liveRooms}/${maxRooms}` : "0", "#e3f2ff", "#1e40af"],
      ["FRILLS PLUS", `${plusSubs} SUBS`, "#ffe6f2", "#9d174d"],
      ["TO REVIEW", `${review} · ${unread} FB`, "#fff4d1", "#92400e"],
    ];
    cards.forEach(([k, v, bg, ink], idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = 24 + col * 236;
      const y = 66 + row * 86;
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, 224, 72);
      ctx.strokeStyle = "#262834";
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, 224, 72);
      ctx.fillStyle = "#55586b";
      ctx.font = "700 15px system-ui, sans-serif";
      ctx.fillText(k, x + 14, y + 25);
      ctx.fillStyle = ink;
      ctx.font = "800 24px system-ui, sans-serif";
      ctx.fillText(v, x + 14, y + 56);
    });
    tex.needsUpdate = true;
  };
  draw(null);
  return { texture: tex, draw };
}

function makePosterTexture(bg, accent, label) {
  const c = document.createElement("canvas");
  c.width = 160;
  c.height = 200;
  const ctx = c.getContext("2d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 160, 200);
  ctx.fillStyle = accent;
  ctx.beginPath(); ctx.arc(80, 82, 42, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#262834";
  ctx.beginPath(); ctx.arc(66, 78, 5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(94, 78, 5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#262834";
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(80, 85, 8, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.font = "800 20px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label, 80, 166);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.06, ...opts });

function addShadow(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildPlant(scale = 1) {
  const g = new THREE.Group();
  const pot = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.24 * scale, 0.18 * scale, 0.36 * scale, 12), mat(0xd98a5f)));
  pot.position.y = 0.18 * scale;
  g.add(pot);
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.21 * scale, 0.21 * scale, 0.04 * scale, 12), mat(0x4b3626));
  soil.position.y = 0.35 * scale;
  g.add(soil);
  const leafMat = mat(0x4fa96a, { roughness: 0.55 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const leaf = addShadow(new THREE.Mesh(new THREE.SphereGeometry(0.16 * scale, 10, 8), leafMat));
    leaf.scale.set(1.3, 0.45, 0.75);
    leaf.position.set(Math.cos(a) * 0.16 * scale, (0.48 + (i % 2) * 0.1) * scale, Math.sin(a) * 0.16 * scale);
    leaf.rotation.set(0.35, -a, 0.25);
    g.add(leaf);
  }
  return g;
}

/** Builds a cute 3D kawaii mascot seated in a chair, returning animated limb references. */
function buildMascot(kind) {
  const root = new THREE.Group();
  const bodyColor = { frog: 0x8fd694, neko: 0xfff0f6, bunny: 0xf4edff, hamster: 0xffe49e }[kind] ?? 0x8fd694;
  const bellyColor = { frog: 0xe7fad9, neko: 0xffd4e4, bunny: 0xe6d6ff, hamster: 0xfff8e1 }[kind] ?? 0xffffff;
  const inkMat = mat(0x262834, { roughness: 0.3 });
  const blushMat = mat(0xf792b2, { roughness: 0.7 });
  const bodyMat = mat(bodyColor, { roughness: 0.55 });
  const bellyMat = mat(bellyColor, { roughness: 0.65 });

  // Plump torso
  const torso = addShadow(new THREE.Mesh(new THREE.SphereGeometry(0.38, 18, 14), bodyMat));
  torso.scale.set(1, 0.92, 0.88);
  torso.position.y = 0.42;
  root.add(torso);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), bellyMat);
  belly.scale.set(0.95, 0.85, 0.5);
  belly.position.set(0, 0.38, 0.24);
  root.add(belly);

  // Animated head group
  const head = new THREE.Group();
  head.position.set(0, 0.92, 0.02);
  const skull = addShadow(new THREE.Mesh(new THREE.SphereGeometry(0.39, 20, 16), bodyMat));
  skull.scale.set(1.12, 0.94, 0.96);
  head.add(skull);

  // Rosy cheeks
  for (const sx of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), blushMat);
    cheek.scale.set(1.25, 0.7, 0.45);
    cheek.position.set(sx * 0.24, -0.05, 0.31);
    head.add(cheek);
  }

  if (kind === "frog") {
    // Classic protruding kawaii frog eye bumps on top of head
    for (const sx of [-1, 1]) {
      const bump = addShadow(new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 12), bodyMat));
      bump.position.set(sx * 0.22, 0.3, 0.14);
      head.add(bump);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), inkMat);
      eye.position.set(sx * 0.22, 0.31, 0.26);
      head.add(eye);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.6 }));
      glint.position.set(sx * 0.22 - 0.02, 0.33, 0.315);
      head.add(glint);
    }
  } else {
    // Glossy eyes on front face
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), inkMat);
      eye.position.set(sx * 0.14, 0.03, 0.35);
      head.add(eye);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.6 }));
      glint.position.set(sx * 0.14 - 0.015, 0.05, 0.395);
      head.add(glint);
    }
  }

  // Species-specific ears & accessories
  if (kind === "neko") {
    for (const sx of [-1, 1]) {
      const ear = addShadow(new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.32, 4), mat(0xffd4e4)));
      ear.position.set(sx * 0.26, 0.35, 0.02);
      ear.rotation.set(0, Math.PI / 4, -sx * 0.28);
      head.add(ear);
    }
    const bow = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), mat(0xff6da8));
    bow.scale.set(1.4, 0.8, 0.6);
    bow.position.set(0.28, 0.24, 0.22);
    head.add(bow);
  } else if (kind === "bunny") {
    for (const sx of [-1, 1]) {
      const ear = addShadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.36, 6, 10), mat(0xe6d6ff)));
      ear.position.set(sx * 0.17, 0.48, -0.02);
      ear.rotation.z = -sx * 0.16;
      head.add(ear);
    }
  } else if (kind === "hamster") {
    for (const sx of [-1, 1]) {
      const ear = addShadow(new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), mat(0xffcf6b)));
      ear.position.set(sx * 0.33, 0.24, 0);
      head.add(ear);
      // Cute 3D round glasses
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.018, 8, 18), inkMat);
      rim.position.set(sx * 0.14, 0.03, 0.375);
      head.add(rim);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), inkMat);
    bridge.position.set(0, 0.03, 0.375);
    head.add(bridge);
  }
  root.add(head);

  // Typing paws reaching toward the desk keyboard
  const pawGeo = new THREE.SphereGeometry(0.105, 12, 10);
  const leftPaw = addShadow(new THREE.Mesh(pawGeo, bodyMat));
  leftPaw.scale.set(1, 0.78, 1.25);
  leftPaw.position.set(-0.24, 0.48, 0.36);
  const rightPaw = addShadow(new THREE.Mesh(pawGeo, bodyMat));
  rightPaw.scale.set(1, 0.78, 1.25);
  rightPaw.position.set(0.24, 0.48, 0.36);
  root.add(leftPaw, rightPaw);

  return { root, head, leftPaw, rightPaw };
}

/** Builds one full interactive 3D operator desk + chair + mascot + signature room props. */
function buildDeskStation(agentDef, cfg) {
  const group = new THREE.Group();
  group.position.set(cfg.x, 0, cfg.z);
  group.rotation.y = cfg.yaw;
  group.userData.agentId = agentDef.id;

  // Pastel floor mat under the workstation
  const floorMat = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.82, 0.04, 28), mat(cfg.accent, { roughness: 0.85 }));
  floorMat.position.y = 0.02;
  floorMat.receiveShadow = true;
  group.add(floorMat);

  // Selection glow ring (visible when desk is selected)
  const ringMat = new THREE.MeshBasicMaterial({ color: cfg.accent, transparent: true, opacity: 0.85 });
  const selectRing = new THREE.Mesh(new THREE.TorusGeometry(1.88, 0.065, 12, 40), ringMat);
  selectRing.rotation.x = Math.PI / 2;
  selectRing.position.y = 0.07;
  selectRing.visible = false;
  group.add(selectRing);

  // Wooden desk top + 4 tapered legs
  const woodMat = mat(0xf6e4c8, { roughness: 0.55 });
  const legMat = mat(0x5b4636, { roughness: 0.6 });
  const top = addShadow(new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.12, 1.12), woodMat));
  top.position.set(0, 0.96, -0.35);
  group.add(top);

  for (const [lx, lz] of [[-1.02, -0.82], [1.02, -0.82], [-1.02, 0.12], [1.02, 0.12]]) {
    const leg = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.94, 10), legMat));
    leg.position.set(lx, 0.47, lz);
    group.add(leg);
  }

  // Desk pad
  const pad = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 0.52), mat(cfg.accent, { roughness: 0.8 }));
  pad.position.set(0, 1.03, -0.18);
  group.add(pad);

  // Monitor stand + glowing screen
  const darkMat = mat(0x262834, { roughness: 0.4 });
  const stand = addShadow(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.12), darkMat));
  stand.position.set(0, 1.18, -0.68);
  group.add(stand);

  const bezel = addShadow(new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.72, 0.08), darkMat));
  bezel.position.set(0, 1.52, -0.65);
  group.add(bezel);

  const screenTex = makeMonitorTexture(agentDef.id, cfg.screenBg, cfg.screenAccent);
  const screenMat = new THREE.MeshStandardMaterial({
    map: screenTex,
    emissive: new THREE.Color(cfg.screenAccent),
    emissiveMap: screenTex,
    emissiveIntensity: 0.45,
    roughness: 0.25,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 0.62), screenMat);
  screen.position.set(0, 1.52, -0.605);
  group.add(screen);

  // Keyboard + mouse
  const kb = addShadow(new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.04, 0.24), mat(0xfbfaf6)));
  kb.position.set(-0.08, 1.05, -0.16);
  group.add(kb);
  const mouse = addShadow(new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), mat(0xfbfaf6)));
  mouse.scale.set(0.85, 0.55, 1.25);
  mouse.position.set(0.42, 1.05, -0.14);
  group.add(mouse);

  // Warm desk lamp on right corner
  const lampBase = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.05, 12), darkMat));
  lampBase.position.set(0.88, 1.045, -0.58);
  const lampStem = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.52, 8), darkMat));
  lampStem.position.set(0.88, 1.3, -0.58);
  const lampShade = addShadow(new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.22, 14), mat(cfg.accent, { emissive: cfg.accent, emissiveIntensity: 0.25 })));
  lampShade.position.set(0.84, 1.56, -0.54);
  lampShade.rotation.z = 0.28;
  group.add(lampBase, lampStem, lampShade);

  const deskLight = new THREE.PointLight(cfg.accent, 0.45, 5.2, 2);
  deskLight.position.set(0.75, 1.45, -0.45);
  group.add(deskLight);

  // Coffee mug on left corner
  const mug = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.068, 0.14, 12), mat(0xffffff)));
  mug.position.set(-0.88, 1.09, -0.2);
  group.add(mug);

  // Cozy swivel chair facing the desk (-z)
  const chair = new THREE.Group();
  chair.position.set(0, 0, 0.62);
  const chairBase = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.4, 0.08, 14), darkMat));
  chairBase.position.y = 0.06;
  const chairStem = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 10), darkMat));
  chairStem.position.y = 0.28;
  const seat = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.4, 0.12, 18), mat(cfg.accent)));
  seat.position.y = 0.5;
  const backrest = addShadow(new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.56, 0.12), mat(cfg.accent)));
  backrest.position.set(0, 0.82, 0.34);
  chair.add(chairBase, chairStem, seat, backrest);

  // Seated 3D mascot facing monitor (-z)
  const mascot = buildMascot(agentDef.mascot);
  mascot.root.position.set(0, 0.52, -0.02);
  mascot.root.rotation.y = Math.PI;
  chair.add(mascot.root);
  group.add(chair);

  // Desk-specific signature props
  const extraRefs = { serverLeds: [], envelopes: [], holoCube: null };
  if (agentDef.id === "ops") {
    // Mini Server Rack Tower beside Mochi
    const rack = addShadow(new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.72, 0.62), mat(0x232736, { roughness: 0.45, metalness: 0.25 })));
    rack.position.set(-1.55, 0.86, -0.45);
    group.add(rack);
    for (let row = 0; row < 4; row++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.04), mat(0x32384c));
      blade.position.set(-1.55, 0.42 + row * 0.34, -0.13);
      group.add(blade);
      const ledMat = new THREE.MeshBasicMaterial({ color: 0x34d399 });
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 8), ledMat);
      led.position.set(-1.38, 0.42 + row * 0.34, -0.1);
      group.add(led);
      extraRefs.serverLeds.push(ledMat);
    }
  } else if (agentDef.id === "growth") {
    // Tripod LED Ring Light + studio mic
    const pole = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.75, 8), darkMat));
    pole.position.set(1.42, 0.88, -0.5);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.045, 10, 24), mat(0xffffff, { emissive: 0xffd6eb, emissiveIntensity: 0.9 }));
    ring.position.set(1.42, 1.84, -0.46);
    ring.rotation.y = -0.35;
    group.add(pole, ring);
    const mic = addShadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.14, 6, 10), darkMat));
    mic.position.set(-0.62, 1.24, -0.35);
    const micStand = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.06, 0.22, 8), darkMat));
    micStand.position.set(-0.62, 1.11, -0.35);
    group.add(mic, micStand);
  } else if (agentDef.id === "community") {
    // Cozy pastel mail envelope stack (reflects unread feedback count!)
    for (let i = 0; i < 4; i++) {
      const env = addShadow(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.045, 0.22), mat(0xfff7d6)));
      env.position.set(-0.78, 1.05 + i * 0.048, -0.52);
      env.rotation.y = (i - 1.5) * 0.14;
      env.visible = i === 0;
      group.add(env);
      extraRefs.envelopes.push(env);
    }
    const beanbag = addShadow(new THREE.Mesh(new THREE.SphereGeometry(0.48, 16, 12), mat(0xd8c8ff)));
    beanbag.scale.set(1.15, 0.65, 1.1);
    beanbag.position.set(-1.5, 0.3, 0.45);
    group.add(beanbag);
  } else if (agentDef.id === "qa") {
    // Rotating holographic neon test cube
    const holo = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.18, 0),
      new THREE.MeshStandardMaterial({ color: 0x6df2b0, emissive: 0x34d399, emissiveIntensity: 0.7, roughness: 0.2, metalness: 0.2, wireframe: false }),
    );
    holo.position.set(-0.78, 1.32, -0.52);
    group.add(holo);
    extraRefs.holoCube = holo;
  }

  // Floating 3D status diamond beacon above the desk
  const beaconMat = new THREE.MeshStandardMaterial({
    color: STATUS_COLORS.idle,
    emissive: STATUS_COLORS.idle,
    emissiveIntensity: 0.75,
    roughness: 0.2,
  });
  const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), beaconMat);
  beacon.position.set(0, 2.55, 0.15);
  group.add(beacon);

  // Tag every child mesh with agentId so raycasting hits cleanly on any part of the desk
  group.traverse((obj) => { obj.userData.agentId = agentDef.id; });

  return { group, chair, mascot, screenMat, deskLight, selectRing, beacon, beaconMat, extraRefs, status: "idle" };
}

/**
 * Mounts the interactive 3D Virtual Office inside `canvasHost` with floating HTML labels inside `overlayHost`.
 * Returns null gracefully if WebGL is unavailable so the 2D floor can take over without errors.
 */
export function mountOffice3D({ canvasHost, overlayHost, agents, onSelect }) {
  if (!canvasHost) return null;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  if (!renderer?.domElement) return null;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  canvasHost.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  const DAY_BG = new THREE.Color(0xefeae0);
  const NIGHT_BG = new THREE.Color(0x161926);
  scene.background = DAY_BG.clone();

  const camera = new THREE.PerspectiveCamera(36, 16 / 10, 0.1, 80);
  camera.position.copy(OVERVIEW_POS);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 6.2;
  controls.maxDistance = 21;
  controls.maxPolarAngle = Math.PI / 2.22;
  controls.minPolarAngle = 0.28;
  controls.target.copy(OVERVIEW_TARGET);

  // Studio lighting (shifts smoothly between Sunny Day and Cozy Night)
  const hemi = new THREE.HemisphereLight(0xfffaf0, 0xbfa98e, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff5e4, 1.35);
  sun.position.set(9, 14, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 36;
  const d = 8.5;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
  sun.shadow.bias = -0.0008;
  scene.add(sun);

  // ── Cozy Diorama Architecture ──────────────────────────────────────────────────────────────────────────────
  const studio = new THREE.Group();
  scene.add(studio);

  // Beveled dark wood diorama base + warm plank floor
  const baseSlab = addShadow(new THREE.Mesh(new THREE.BoxGeometry(11.4, 0.52, 11.4), mat(0x3a2f2a, { roughness: 0.8 })));
  baseSlab.position.y = -0.26;
  studio.add(baseSlab);

  const floorTex = makeFloorTexture();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(10.8, 0.06, 10.8), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.72 }));
  floor.position.y = -0.02;
  floor.receiveShadow = true;
  studio.add(floor);

  // Central woven cream-and-sage rug
  const rugOuter = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.78, 0.03, 36), mat(0xa8d5b0, { roughness: 0.9 }));
  rugOuter.position.y = 0.015;
  rugOuter.receiveShadow = true;
  const rugInner = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.44, 0.035, 36), mat(0xfbf7ec, { roughness: 0.92 }));
  rugInner.position.y = 0.02;
  rugInner.receiveShadow = true;
  studio.add(rugOuter, rugInner);

  // Cutaway North & West walls with wood trim
  const wallMat = mat(0xf7f2e8, { roughness: 0.85 });
  const trimMat = mat(0xd8bd98, { roughness: 0.65 });
  const northWall = addShadow(new THREE.Mesh(new THREE.BoxGeometry(11.1, 3.6, 0.28), wallMat));
  northWall.position.set(0, 1.8, -5.42);
  const westWall = addShadow(new THREE.Mesh(new THREE.BoxGeometry(0.28, 3.6, 11.1), wallMat));
  westWall.position.set(-5.42, 1.8, 0);
  const northTrim = new THREE.Mesh(new THREE.BoxGeometry(10.9, 0.22, 0.08), trimMat);
  northTrim.position.set(0, 0.11, -5.24);
  const westTrim = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 10.9), trimMat);
  westTrim.position.set(-5.24, 0.11, 0);
  studio.add(northWall, westWall, northTrim, westTrim);

  // Sunlit studio window on North-Left wall
  const winFrame = addShadow(new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.7, 0.12), mat(0x6b523c)));
  winFrame.position.set(-2.5, 2.25, -5.24);
  const winPaneMat = new THREE.MeshStandardMaterial({ color: 0xb7e4ff, emissive: 0x9bd7ff, emissiveIntensity: 0.55, roughness: 0.2 });
  const winPane = new THREE.Mesh(new THREE.PlaneGeometry(2.56, 1.46), winPaneMat);
  winPane.position.set(-2.5, 2.25, -5.17);
  const winCrossH = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.06), mat(0x6b523c));
  winCrossH.position.set(-2.5, 2.25, -5.16);
  const winCrossV = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 0.06), mat(0x6b523c));
  winCrossV.position.set(-2.5, 2.25, -5.16);
  studio.add(winFrame, winPane, winCrossH, winCrossV);

  // Dynamic live FRILLS HQ Whiteboard on North-Right wall
  const whiteboard = makeWhiteboard();
  const wbFrame = addShadow(new THREE.Mesh(new THREE.BoxGeometry(3.5, 1.8, 0.1), mat(0x262834)));
  wbFrame.position.set(2.1, 2.15, -5.24);
  const wbScreen = new THREE.Mesh(new THREE.PlaneGeometry(3.32, 1.66), new THREE.MeshStandardMaterial({ map: whiteboard.texture, roughness: 0.35 }));
  wbScreen.position.set(2.1, 2.15, -5.18);
  studio.add(wbFrame, wbScreen);

  // Framed Frills mascot art posters on West wall
  const posters = [
    ["#e6f8e8", "#8fd694", "FROG", -2.5],
    ["#ffeef6", "#ff9ec6", "NEKO", 0.0],
    ["#f2ebff", "#c8b4ff", "BUNNY", 2.5],
  ];
  for (const [bg, acc, lbl, pz] of posters) {
    const frame = addShadow(new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.25, 1.0), mat(0x3a2f2a)));
    frame.position.set(-5.24, 2.25, pz);
    const art = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.1), new THREE.MeshStandardMaterial({ map: makePosterTexture(bg, acc, lbl), roughness: 0.6 }));
    art.rotation.y = Math.PI / 2;
    art.position.set(-5.19, 2.25, pz);
    studio.add(frame, art);
  }

  // Cozy coffee counter & corner studio plants
  const counter = addShadow(new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.92, 1.85), mat(0xeed7b6)));
  counter.position.set(-4.72, 0.46, 0.05);
  const espresso = addShadow(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.48, 0.46), mat(0x2b303f, { metalness: 0.45, roughness: 0.35 })));
  espresso.position.set(-4.72, 1.16, -0.25);
  const cup = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.13, 10), mat(0xffc9de)));
  cup.position.set(-4.62, 0.99, 0.36);
  studio.add(counter, espresso, cup);

  const plantNW = buildPlant(1.35); plantNW.position.set(-4.6, 0, -4.6);
  const plantNE = buildPlant(1.25); plantNE.position.set(4.55, 0, -4.55);
  const plantSW = buildPlant(1.15); plantSW.position.set(-4.6, 0, 4.4);
  studio.add(plantNW, plantNE, plantSW);

  // ── 4 Operator Desks & Floating 3D-Projected Labels ────────────────────────────────────────────────────────
  const stations = new Map();
  const hitObjects = [];
  const labelNodes = new Map();
  overlayHost?.replaceChildren();

  for (const agent of agents) {
    const cfg = DESK_LAYOUT[agent.id] ?? DESK_LAYOUT.ops;
    const st = buildDeskStation(agent, cfg);
    studio.add(st.group);
    stations.set(agent.id, st);
    hitObjects.push(st.group);

    if (overlayHost) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "office3d__tag";
      btn.dataset.agent = agent.id;
      const dot = document.createElement("i");
      dot.className = "office3d__tag-dot";
      const nameSpan = document.createElement("strong");
      nameSpan.textContent = agent.name;
      const statusSpan = document.createElement("span");
      statusSpan.className = "office3d__tag-sub";
      statusSpan.textContent = STATUS_LABELS[agent.status] || agent.status;
      btn.append(dot, nameSpan, statusSpan);
      btn.addEventListener("click", () => onSelect?.(agent.id));
      overlayHost.append(btn);
      labelNodes.set(agent.id, { btn, statusSpan });
    }
  }

  // ── Raycasting & Camera Fly-To ─────────────────────────────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downX = 0;
  let downY = 0;
  let flyGoal = null;
  let nightMode = false;
  let selectedId = agents[0]?.id ?? "ops";
  let hoverId = "";

  const flyTo = (pos, target) => {
    flyGoal = { pos: pos.clone(), target: target.clone() };
  };

  const focusAgent = (id) => {
    selectedId = id;
    const cfg = DESK_LAYOUT[id];
    if (!cfg) return;
    const target = new THREE.Vector3(cfg.x, 1.05, cfg.z);
    const offset = new THREE.Vector3(cfg.x >= 0 ? 4.8 : -4.8, 4.4, cfg.z >= 0 ? 5.2 : 5.4);
    flyTo(target.clone().add(offset), target);
  };

  const resetOverview = () => flyTo(OVERVIEW_POS, OVERVIEW_TARGET);

  controls.addEventListener("start", () => { flyGoal = null; });

  const pickAt = (clientX, clientY) => {
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return "";
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(hitObjects, true);
    return hits[0]?.object?.userData?.agentId || "";
  };

  renderer.domElement.addEventListener("pointerdown", (e) => { downX = e.clientX; downY = e.clientY; });
  renderer.domElement.addEventListener("pointermove", (e) => {
    const hit = pickAt(e.clientX, e.clientY);
    if (hit !== hoverId) {
      hoverId = hit;
      renderer.domElement.style.cursor = hit ? "pointer" : "grab";
    }
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
    const hit = pickAt(e.clientX, e.clientY);
    if (hit) onSelect?.(hit);
  });

  // ── Resize Handling ────────────────────────────────────────────────────────────────────────────────────────
  const resize = () => {
    const w = Math.max(240, Math.round(canvasHost.clientWidth || 640));
    const h = Math.max(280, Math.round(canvasHost.clientHeight || 460));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };
  resize();
  const ro = "ResizeObserver" in window ? new ResizeObserver(resize) : null;
  ro?.observe(canvasHost);

  // ── Day / Cozy Night Lighting Switch ───────────────────────────────────────────────────────────────────────
  const setNight = (on) => {
    nightMode = Boolean(on);
    scene.background.copy(nightMode ? NIGHT_BG : DAY_BG);
    hemi.intensity = nightMode ? 0.38 : 1.05;
    hemi.color.setHex(nightMode ? 0x9bb2ff : 0xfffaf0);
    sun.intensity = nightMode ? 0.42 : 1.35;
    sun.color.setHex(nightMode ? 0x9ab4ff : 0xfff5e4);
    winPaneMat.color.setHex(nightMode ? 0x1d2747 : 0xb7e4ff);
    winPaneMat.emissive.setHex(nightMode ? 0x2f3f7a : 0x9bd7ff);
    winPaneMat.emissiveIntensity = nightMode ? 0.9 : 0.55;
    for (const st of stations.values()) {
      st.deskLight.intensity = nightMode ? 2.1 : 0.45;
      st.screenMat.emissiveIntensity = nightMode ? 0.95 : 0.45;
    }
  };

  // ── State Sync from /api/admin/office ──────────────────────────────────────────────────────────────────────
  let relaysAlert = false;
  const sync = (officeState, currentSelected) => {
    if (currentSelected) selectedId = currentSelected;
    whiteboard.draw(officeState);
    const relays = officeState?.pulse?.relays ?? [];
    relaysAlert = relays.some((r) => !r.ok || r.level === "full");
    const unreadFb = officeState?.pulse?.feedback?.new ?? 0;

    for (const agent of officeState?.agents ?? []) {
      const st = stations.get(agent.id);
      if (!st) continue;
      st.status = agent.status || "idle";
      const col = STATUS_COLORS[st.status] ?? STATUS_COLORS.idle;
      st.beaconMat.color.setHex(col);
      st.beaconMat.emissive.setHex(col);
      st.selectRing.visible = agent.id === selectedId;

      if (agent.id === "community") {
        const showCount = Math.min(st.extraRefs.envelopes.length, Math.max(0, unreadFb));
        st.extraRefs.envelopes.forEach((env, idx) => { env.visible = idx < showCount; });
      }

      const tag = labelNodes.get(agent.id);
      if (tag) {
        tag.btn.dataset.status = st.status;
        tag.btn.setAttribute("aria-pressed", String(agent.id === selectedId));
        tag.statusSpan.textContent = agent.tasks?.needsReview
          ? `${agent.tasks.needsReview} review`
          : (STATUS_LABELS[st.status] || st.status);
      }
    }
  };

  // ── 60fps Animation Loop (pauses cleanly when tab hidden or reduced-motion) ────────────────────────────────
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  const projVec = new THREE.Vector3();
  const clock = new THREE.Clock();
  let raf = 0;
  let disposed = false;

  const animate = () => {
    if (disposed) return;
    raf = requestAnimationFrame(animate);
    if (document.hidden) return;
    const t = clock.getElapsedTime();

    if (flyGoal) {
      camera.position.lerp(flyGoal.pos, 0.09);
      controls.target.lerp(flyGoal.target, 0.11);
      if (camera.position.distanceTo(flyGoal.pos) < 0.08 && controls.target.distanceTo(flyGoal.target) < 0.05) {
        flyGoal = null;
      }
    }
    controls.update();

    const w = canvasHost.clientWidth || 640;
    const h = canvasHost.clientHeight || 460;

    let idx = 0;
    for (const [id, st] of stations.entries()) {
      idx += 1;
      const phase = t * 2.4 + idx * 1.3;
      if (!reducedMotion) {
        if (st.status === "working") {
          st.mascot.root.position.y = 0.52 + Math.abs(Math.sin(t * 7 + idx)) * 0.05;
          st.mascot.head.rotation.z = Math.sin(t * 4 + idx) * 0.07;
          st.mascot.leftPaw.position.y = 0.48 + Math.sin(t * 14) * 0.04;
          st.mascot.rightPaw.position.y = 0.48 - Math.sin(t * 14) * 0.04;
          st.chair.rotation.y = Math.sin(t * 2 + idx) * 0.06;
        } else if (st.status === "waiting" || st.status === "alert") {
          st.mascot.root.position.y = 0.52 + Math.sin(phase) * 0.03;
          st.mascot.head.rotation.y = Math.sin(t * 1.8 + idx) * 0.16;
          st.mascot.leftPaw.position.y = 0.48;
          st.mascot.rightPaw.position.y = 0.48;
        } else {
          st.mascot.root.position.y = 0.52 + Math.sin(t * 1.4 + idx) * 0.015;
          st.mascot.head.rotation.z = Math.sin(t * 0.9 + idx) * 0.04;
          st.mascot.head.rotation.y = Math.sin(t * 0.6 + idx) * 0.08;
        }

        // Beacon spin + bob
        st.beacon.rotation.y = t * (st.status === "alert" ? 4.2 : 1.8) + idx;
        st.beacon.position.y = 2.52 + Math.sin(t * (st.status === "waiting" || st.status === "alert" ? 4.5 : 2.1) + idx) * 0.11;
        if (st.selectRing.visible) {
          const s = 1 + Math.sin(t * 3.2) * 0.025;
          st.selectRing.scale.set(s, s, 1);
        }
        if (st.extraRefs.holoCube) {
          st.extraRefs.holoCube.rotation.y = t * 1.4;
          st.extraRefs.holoCube.rotation.x = t * 0.8;
          st.extraRefs.holoCube.position.y = 1.34 + Math.sin(t * 2.5) * 0.05;
        }
        st.extraRefs.serverLeds.forEach((ledMat, li) => {
          const on = Math.sin(t * (relaysAlert ? 9 : 3.2) + li * 1.7) > -0.25;
          ledMat.color.setHex(relaysAlert ? (on ? 0xf43f5e : 0x4c1120) : (on ? 0x34d399 : 0x164e3a));
        });
      }

      // Project floating label to 2D coordinates inside overlayHost
      const tag = labelNodes.get(id);
      if (tag) {
        projVec.set(0, 2.95, 0.15);
        st.group.localToWorld(projVec);
        projVec.project(camera);
        const inFront = projVec.z < 1;
        const sx = (projVec.x * 0.5 + 0.5) * w;
        const sy = (-projVec.y * 0.5 + 0.5) * h;
        tag.btn.style.transform = `translate(-50%, -50%) translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
        tag.btn.hidden = !inFront || sx < 24 || sx > w - 24 || sy < 18 || sy > h - 18;
      }
    }

    renderer.render(scene, camera);
  };
  animate();

  return {
    sync,
    focusAgent,
    resetOverview,
    setNight,
    isNight: () => nightMode,
    resize,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      controls.dispose();
      renderer.dispose();
    },
  };
}
