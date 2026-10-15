// Cuts the flat magenta background (#FF00FF) out of a generated picture, so a piece can be laid over a chat bubble.
//   node scripts/cutout.mjs <in.webp|png> <out.png> [--max 512] [--pad 6] [--split]
//     --max   the longest side of the result in pixels (pieces show small on a stream; 512 is plenty). Default 512.
//     --pad   empty pixels kept around the piece. Default 6.
//     --glow  the piece is light and soft-edged (sparkles, glows, stars): how see-through a pixel is comes from its green instead, which is
//             0 in the magenta and high in a light piece, so a soft glow fades out cleanly instead of leaving a pink halo.
//     --split the picture holds several separate pieces (a sheet of sparkles or badges): each one is cut out on its own and saved as
//             <out>-1.png, <out>-2.png, ... from top-left to bottom-right.
// Needs ffmpeg and ffprobe on the PATH (the promo videos need them too). Nothing else is installed.
//
// How the magenta goes: a pixel is "background" when its red and blue are both high and its green is low. Pixels on the edge, where the piece
// blends into the magenta, are made partly see-through and have the magenta taken back out of their color, so no pink fringe is left.

import { execFileSync, spawnSync } from "node:child_process";

const BACK = [255, 0, 255];
const FULL = 175; // how magenta a pixel is (min(red, blue) - green) at which it is fully background
const NONE = 70; // ... and below which it is fully the piece

/** Decodes any picture ffmpeg can read to raw RGBA. */
export function decode(file) {
  const size = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]).toString().trim().split(",").map(Number);
  const [width, height] = size;
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: width * height * 4 + 1024 });
  return { width, height, data: Uint8Array.from(raw) };
}

/** Makes the magenta see-through, in place, and takes it back out of the edge colors. */
export function keyOut(image, { glow = false } = {}) {
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const magenta = Math.min(r, b) - g;
    let alpha;
    if (glow) alpha = g < 22 ? 0 : Math.min(1, g / 232); // the pieces are light: green is about 232 inside them and 0 in the magenta
    else alpha = magenta >= FULL ? 0 : magenta <= NONE ? 1 : (FULL - magenta) / (FULL - NONE);
    if (alpha === 1) { data[i + 3] = 255; continue; }
    if (alpha === 0) { data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0; continue; }
    // color = alpha * piece + (1 - alpha) * magenta, so the piece's own color is what is left when the magenta is taken out
    for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, Math.round((data[i + c] - (1 - alpha) * BACK[c]) / alpha)));
    data[i + 3] = Math.round(alpha * 255);
  }
  return image;
}

/** The smallest box around everything that is not see-through, or null. */
export function boxOf(image, area = { x0: 0, y0: 0, x1: image.width, y1: image.height }, floor = 20) {
  let x0 = area.x1, y0 = area.y1, x1 = -1, y1 = -1;
  for (let y = area.y0; y < area.y1; y++) {
    for (let x = area.x0; x < area.x1; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] > floor) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** Separate pieces on one sheet: groups of touching (or nearly touching) pixels, as boxes, top-left to bottom-right. */
export function pieces(image, join = 24) {
  const { width, height, data } = image;
  const cell = 4;
  const w = Math.ceil(width / cell), h = Math.ceil(height / cell);
  const filled = new Uint8Array(w * h);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 30) filled[Math.floor(y / cell) * w + Math.floor(x / cell)] = 1;
  const reach = Math.ceil(join / cell);
  const grown = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!filled[y * w + x]) continue;
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) grown[ny * w + nx] = 1;
    }
  }
  const label = new Int32Array(w * h);
  const found = [];
  for (let start = 0; start < w * h; start++) {
    if (!grown[start] || label[start]) continue;
    const id = found.length + 1;
    const stack = [start];
    label[start] = id;
    const box = { x0: width, y0: height, x1: 0, y1: 0 };
    while (stack.length) {
      const at = stack.pop();
      const x = at % w, y = Math.floor(at / w);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && grown[ny * w + nx] && !label[ny * w + nx]) { label[ny * w + nx] = id; stack.push(ny * w + nx); }
      }
    }
    found.push(id);
  }
  // each group's box, from the pixels that really are in it
  const boxes = found.map(() => ({ x0: width, y0: height, x1: 0, y1: 0 }));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] <= 30) continue;
    const id = label[Math.floor(y / cell) * w + Math.floor(x / cell)];
    if (!id) continue;
    const b = boxes[id - 1];
    if (x < b.x0) b.x0 = x;
    if (x >= b.x1) b.x1 = x + 1;
    if (y < b.y0) b.y0 = y;
    if (y >= b.y1) b.y1 = y + 1;
  }
  const real = boxes.filter((b) => b.x1 > b.x0 && (b.x1 - b.x0) * (b.y1 - b.y0) > 24 * 24);
  const rowHeight = Math.max(1, ...real.map((b) => b.y1 - b.y0));
  return real.sort((a, b) => Math.round((a.y0 + a.y1) / 2 / rowHeight) - Math.round((b.y0 + b.y1) / 2 / rowHeight) || a.x0 - b.x0);
}

/** Writes the part of an image inside `box` (plus `pad`) as a PNG no longer than `max` on its longest side. */
export function save(image, box, file, { max = 512, pad = 6 } = {}) {
  const x0 = Math.max(0, box.x0 - pad), y0 = Math.max(0, box.y0 - pad);
  const x1 = Math.min(image.width, box.x1 + pad), y1 = Math.min(image.height, box.y1 + pad);
  const w = x1 - x0, h = y1 - y0;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) Buffer.from(image.data.buffer, ((y0 + y) * image.width + x0) * 4, w * 4).copy(out, y * w * 4);
  const scale = Math.max(w, h) > max ? `scale='if(gt(iw,ih),${max},-2)':'if(gt(iw,ih),-2,${max})':flags=lanczos,` : "";
  const final = Math.max(w, h) > max ? (w >= h ? { width: max, height: Math.round((h * max) / w) } : { width: Math.round((w * max) / h), height: max }) : { width: w, height: h };
  const run = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${w}x${h}`, "-i", "-", "-vf", `${scale}format=rgba`, file], { input: out });
  if (run.status !== 0) throw new Error(String(run.stderr));
  return final;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : fallback; };
  const [input, output] = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && args[i - 1] !== "--split"));
  if (!input || !output) {
    console.error("Usage: node scripts/cutout.mjs <in> <out.png> [--max 512] [--pad 6] [--glow] [--split]");
    process.exit(1);
  }
  const options = { max: flag("--max", 512), pad: flag("--pad", 6) };
  const image = keyOut(decode(input), { glow: args.includes("--glow") });
  if (args.includes("--split")) {
    const all = pieces(image);
    all.forEach((box, i) => {
      const file = output.replace(/\.png$/i, `-${i + 1}.png`);
      console.log(file, JSON.stringify(save(image, box, file, options)));
    });
  } else {
    const box = boxOf(image);
    if (!box) throw new Error("nothing is left after taking out the background");
    console.log(output, JSON.stringify(save(image, box, output, options)));
  }
}
