// Cuts the six song-design sheets (made in ChatGPT from ASSET-PROMPTS-SONG-DESIGNS.md) into the pieces the designs use:
//   node scripts/cut-song-sheets.mjs [turntable|cassette|catears|handheld|polaroid|neon]
// Reads   assets-incoming/<folder>/<sheet>.png   (1254 x 1254; magenta sheets have the pieces and every see-through window on flat #FF00FF, the neon sheet is on pure black)
// Writes  public/decor/songs/<design>/<piece>.webp   (what the site serves; the see-through windows and holes come out see-through)
// and prints, for the pieces with a window or a hole, where it is as a share of the piece, which is what the CSS in widgets.css is laid out from.
// A piece is cut from a box on the sheet (the boxes were found with scripts/cutout.mjs's piece finder and checked by eye); the magenta goes with cutout.mjs.
// The neon sheet cannot be keyed from a colour: glowing light on black is turned into see-through by how bright it is (a pixel's brightest channel is how solid it is), so
// the glow fades out into whatever is behind it instead of leaving a black box. Needs ffmpeg and ffprobe on the PATH, like the other art tools.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boxOf, decode, keyOut, save } from "./cutout.mjs";

const root = join(import.meta.dirname, "..");
const incoming = join(root, "assets-incoming");

// box = [x0, y0, x1, y1] on the sheet; max = the longest side in pixels; pad = empty pixels kept around (0 where the share of a window is measured from the piece)
// hole = a point inside a see-through window or hole, to measure it
const SHEETS = {
  turntable: {
    file: "turn-table/turn-table.png",
    pieces: {
      base: { box: [44, 52, 718, 548], max: 640, pad: 0, hole: [] },
      record: { box: [768, 46, 1241, 520], max: 440, pad: 0, hole: [1005, 283] },
      arm: { box: [48, 584, 708, 734], max: 520, pad: 0 },
      "note-1": { box: [118, 798, 262, 945], max: 96 },
      "note-2": { box: [394, 791, 560, 943], max: 96 },
      heart: { box: [696, 804, 855, 941], max: 96 },
      star: { box: [978, 791, 1145, 948], max: 96 },
    },
  },
  cassette: {
    file: "cassete/cassete.png",
    pieces: {
      body: { box: [223, 36, 1029, 510], max: 640, pad: 0, hole: [470, 300], hole2: [782, 300] },
      reel: { box: [160, 533, 449, 817], max: 200, pad: 0 },
      star: { box: [55, 844, 242, 1019], max: 96 },
      heart: { box: [263, 856, 442, 1013], max: 96 },
    },
  },
  catears: {
    file: "cat-headset/cat-headset-2.png",
    pieces: {
      frame: { box: [120, 48, 1132, 752], max: 600, pad: 0, hole: [630, 440] },
      paw: { box: [81, 739, 432, 967], max: 240 },
      "note-1": { box: [494, 799, 643, 966], max: 96 },
      "note-2": { box: [707, 774, 888, 968], max: 96 },
      heart: { box: [970, 811, 1152, 965], max: 96 },
      star: { box: [242, 1029, 395, 1181], max: 96 },
    },
  },
  handheld: {
    file: "handheld/handheld.png",
    pieces: {
      body: { box: [208, 67, 1046, 678], max: 640, pad: 0, hole: [627, 260] },
      heart: { box: [91, 743, 305, 926], max: 72 },
      note: { box: [386, 730, 585, 915], max: 72 },
      battery: { box: [925, 751, 1187, 904], max: 96 },
    },
  },
  polaroid: {
    file: "polaroid/polaroid.png",
    pieces: {
      frame: { box: [78, 52, 617, 711], max: 560, pad: 0, hole: [345, 325] },
      "tape-1": { box: [698, 32, 1132, 214], max: 300 },
      clip: { box: [667, 625, 812, 804], max: 110 },
      pin: { box: [878, 628, 998, 812], max: 110 },
      star: { box: [52, 797, 245, 980], max: 96 },
      heart: { box: [261, 807, 450, 971], max: 96 },
    },
  },
  neon: {
    file: "neon.png",
    neon: true,
    // the boxes run to the middle of the gap to the next piece, so a glow is not cut off short; the glow fades out on its own
    pieces: {
      frame: { box: [10, 68, 648, 536], max: 640, pad: 0, join: 12 },
      sunset: { box: [0, 575, 1254, 1194], max: 720, pad: 0, join: 30 },
      "note-2": { box: [796, 116, 946, 308], max: 96 },
      heart: { box: [946, 117, 1095, 300], max: 96 },
      star: { box: [1095, 117, 1254, 300], max: 96 },
      bolt: { box: [640, 309, 788, 519], max: 96 },
    },
  },
};

/** Glowing light on black to something that can be laid over anything: how bright a pixel is, is how solid it is. */
function glowOut(image) {
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const bright = Math.max(data[i], data[i + 1], data[i + 2]);
    if (bright < 14) { data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0; continue; } // the generator's black is not exactly black: this floor keeps a faint haze from outlining a piece
    for (let c = 0; c < 3; c++) data[i + c] = Math.min(255, Math.round((data[i + c] * 255) / bright));
    data[i + 3] = Math.round(((bright - 14) * 255) / 241);
  }
  return image;
}

/** A square of pixels `r` wide around every set pixel of a mask (two passes over running totals, so it is quick on a big sheet). */
function dilate(mask, w, h, r) {
  const across = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < Math.min(w, r); x++) sum += mask[y * w + x];
    for (let x = 0; x < w; x++) {
      if (x + r < w) sum += mask[y * w + x + r];
      if (x - r - 1 >= 0) sum -= mask[y * w + x - r - 1];
      across[y * w + x] = sum > 0 ? 1 : 0;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y < Math.min(h, r); y++) sum += across[y * w + x];
    for (let y = 0; y < h; y++) {
      if (y + r < h) sum += across[(y + r) * w + x];
      if (y - r - 1 >= 0) sum -= across[(y - r - 1) * w + x];
      out[y * w + x] = sum > 0 ? 1 : 0;
    }
  }
  return out;
}

/** How far (in pixels, roughly) every pixel is from the nearest set pixel of a mask: two sweeps with the neighbours' distances added up. */
function distances(mask, w, h) {
  const d = new Float32Array(w * h).fill(1e9);
  for (let i = 0; i < w * h; i++) if (mask[i]) d[i] = 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 1e9 : d[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = Math.min(d[y * w + x], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) d[y * w + x] = Math.min(d[y * w + x], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
  return d;
}

/**
 * A copy of what is inside `area` with only the main piece left: the group of solid pixels (apart by no more than `join` pixels) that has the most pixels. A neighbour whose box
 * overlaps this one on the sheet, or a speck from the generator, is made see-through. `grow` keeps the soft edge (or the glow) round the group.
 */
function isolate(image, { x0, y0, x1, y1 }, { join, floor, grow, edge = 0 }) {
  const w = x1 - x0, h = y1 - y0;
  const copy = { width: w, height: h, data: new Uint8Array(w * h * 4) };
  const core = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const from = ((y0 + y) * image.width + x0 + x) * 4, to = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) copy.data[to + c] = image.data[from + c];
      if (image.data[from + 3] > floor) core[y * w + x] = 1;
    }
  }
  const joined = dilate(core, w, h, join);
  const label = new Int32Array(w * h);
  const mass = [0];
  for (let start = 0; start < w * h; start++) {
    if (!joined[start] || label[start]) continue;
    const id = mass.length;
    mass.push(0);
    const stack = [start];
    label[start] = id;
    while (stack.length) {
      const at = stack.pop();
      const x = at % w, y = (at - x) / w;
      if (core[at]) mass[id]++;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (joined[k] && !label[k]) { label[k] = id; stack.push(k); }
      }
    }
  }
  const best = mass.indexOf(Math.max(...mass.slice(1)));
  const main = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (core[i] && label[i] === best) main[i] = 1;
  const keep = edge ? new Uint8Array(w * h).fill(1) : dilate(main, w, h, grow);
  for (let i = 0; i < w * h; i++) if (!keep[i]) copy.data[i * 4] = copy.data[i * 4 + 1] = copy.data[i * 4 + 2] = copy.data[i * 4 + 3] = 0;
  if (edge) {
    // glowing pieces: the glow fades out smoothly with its distance from the piece (never to a straight line at the edge of the box), and what is nearer to a
    // neighbouring piece than to this one fades out too, so a neighbour's glow does not come along
    const others = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (core[i] && !main[i]) others[i] = 1;
    const near = distances(main, w, h), other = distances(others, w, h);
    for (let i = 0; i < w * h; i++) {
      const t = Math.min(1, Math.max(0, (near[i] - 10) / (grow - 10)));
      const mine = Math.min(1, Math.max(0, 0.5 + (other[i] - near[i]) / 16));
      copy.data[i * 4 + 3] = Math.round(copy.data[i * 4 + 3] * (1 - t * t * (3 - 2 * t)) * mine);
    }
  }
  return copy;
}

/** The see-through hole that holds `at`: its box, from filling out over every see-through pixel around it. Null when `at` is not see-through. */
function holeAt(image, [px, py]) {
  const { width, height, data } = image;
  const clear = (x, y) => data[(y * width + x) * 4 + 3] < 24;
  if (!clear(px, py)) return null;
  const seen = new Uint8Array(width * height);
  const stack = [py * width + px];
  seen[stack[0]] = 1;
  let x0 = px, x1 = px, y0 = py, y1 = py, count = 0;
  while (stack.length) {
    const at = stack.pop();
    const x = at % width, y = (at - x) / width;
    count++;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const k = ny * width + nx;
      if (!seen[k] && clear(nx, ny)) { seen[k] = 1; stack.push(k); }
    }
  }
  return { x0, y0, x1: x1 + 1, y1: y1 + 1, count };
}

const toWebp = (png, webp) => {
  const run = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", png, "-c:v", "libwebp", "-quality", "88", "-compression_level", "6", webp]);
  if (run.status !== 0) throw new Error(String(run.stderr));
};

const only = process.argv[2];
if (only && !SHEETS[only]) throw new Error(`No sheet called "${only}". Try: ${Object.keys(SHEETS).join(", ")}`);
const work = join(tmpdir(), "frills-cut-songs");
mkdirSync(work, { recursive: true });

for (const [design, sheet] of Object.entries(SHEETS)) {
  if (only && only !== design) continue;
  const file = join(incoming, sheet.file);
  if (!existsSync(file)) throw new Error(`No sheet for "${design}" at ${file}`);
  const image = sheet.neon ? glowOut(decode(file)) : keyOut(decode(file));
  const out = join(root, "public", "decor", "songs", design);
  mkdirSync(out, { recursive: true });
  for (const [name, spec] of Object.entries(sheet.pieces)) {
    const [x0, y0, x1, y1] = spec.box;
    const piece = isolate(image, { x0, y0, x1, y1 }, sheet.neon ? { join: spec.join ?? 6, floor: 90, grow: 40, edge: 30 } : { join: spec.join ?? 8, floor: 30, grow: 4 });
    const found = boxOf(piece, undefined, sheet.neon ? 40 : 20);
    if (!found) throw new Error(`${design}/${name}: nothing found in ${spec.box}`);
    const pad = spec.pad ?? (sheet.neon ? 14 : 3);
    const png = join(work, `${design}-${name}.png`);
    const size = save(piece, found, png, { max: spec.max, pad });
    toWebp(png, join(out, `${name}.webp`));
    const box = { x0: Math.max(0, found.x0 - pad), y0: Math.max(0, found.y0 - pad), x1: Math.min(piece.width, found.x1 + pad), y1: Math.min(piece.height, found.y1 + pad) };
    let note = "";
    for (const key of ["hole", "hole2"]) {
      if (!spec[key]?.length) continue;
      const h = holeAt(piece, [spec[key][0] - x0, spec[key][1] - y0]);
      if (!h || h.x1 - h.x0 > box.x1 - box.x0 || h.y1 - h.y0 > box.y1 - box.y0) { note += `  ${key}: NOT ENCLOSED`; continue; }
      const w = box.x1 - box.x0, ht = box.y1 - box.y0;
      const pc = (v) => (v * 100).toFixed(1) + "%";
      note += `  ${key}: x ${pc((h.x0 - box.x0) / w)}-${pc((h.x1 - box.x0) / w)} y ${pc((h.y0 - box.y0) / ht)}-${pc((h.y1 - box.y0) / ht)} (centre ${pc(((h.x0 + h.x1) / 2 - box.x0) / w)}, ${pc(((h.y0 + h.y1) / 2 - box.y0) / ht)}; ${h.x1 - h.x0} x ${h.y1 - h.y0})`;
    }
    console.log(`${design}/${name}: ${size.width} x ${size.height}  (sheet ${box.x1 - box.x0} x ${box.y1 - box.y0})${note}`);
  }
}
