// Cuts the Halloween and Christmas decoration sheets (made in ChatGPT from ASSET-PROMPTS-SEASONAL.md) into the pieces of each pack:
//   node scripts/cut-seasonal-sheets.mjs [halloween|christmas]
// Reads   assets-incoming/<pack>/<pack>-sheet.png   (1254 x 1254, the pieces on flat magenta)
// Writes  assets-incoming/<pack>/{peeker-a,peeker-b,corner,confetti-1..8}.png   (the cut-out pieces, kept for reference)
//         public/decor/<pack>/{peeker-a,peeker-b,corner,confetti-1..8}.webp     (what the site serves, sized like the other packs)
// The regions are where the pieces sit on the sheet (every sheet follows the same layout), taken a little generously so a piece's sparkles come with it.
// The magenta is cut out by cutout.mjs. Needs ffmpeg on the PATH, like the rest of the art tools.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
// crop = width:height:x:y on the sheet
const REGIONS = {
  halloween: {
    "peeker-a": "505:290:70:55",
    "peeker-b": "620:255:630:85",
    corner: "555:390:35:405",
    confetti: "620:305:615:455",
  },
  christmas: {
    "peeker-a": "495:340:80:15",
    "peeker-b": "540:315:660:50",
    corner: "535:405:45:410",
    confetti: "590:320:640:455",
  },
};
const MAX = { "peeker-a": 320, "peeker-b": 320, corner: 320, confetti: 96 }; // the widest side of a piece, in pixels, as in the other packs

const packs = process.argv[2] ? [process.argv[2]] : Object.keys(REGIONS);
const work = join(tmpdir(), "frills-cut-seasonal");
mkdirSync(work, { recursive: true });
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
const toWebp = (png, webp) => run("ffmpeg", ["-y", "-v", "error", "-i", png, "-c:v", "libwebp", "-quality", "88", "-compression_level", "6", webp]);

for (const pack of packs) {
  const sheet = join(root, "assets-incoming", pack, `${pack}-sheet.png`);
  if (!REGIONS[pack] || !existsSync(sheet)) throw new Error(`No sheet for "${pack}" at ${sheet}`);
  const incoming = join(root, "assets-incoming", pack);
  const out = join(root, "public", "decor", pack);
  mkdirSync(out, { recursive: true });
  for (const [name, crop] of Object.entries(REGIONS[pack])) {
    const cropped = join(work, `${pack}-${name}-crop.png`);
    run("ffmpeg", ["-y", "-v", "error", "-i", sheet, "-vf", `crop=${crop}`, cropped]);
    if (name !== "confetti") {
      const cut = join(incoming, `${name}.png`);
      run("node", [join(root, "scripts", "cutout.mjs"), cropped, cut, "--max", String(MAX[name])]);
      toWebp(cut, join(out, `${name}.webp`));
      console.log(`${pack}/${name}: ${run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", cut]).toString().trim()}`);
    } else {
      // eight small separate things: each is cut out on its own, from the top left to the bottom right
      const prefix = join(work, `${pack}-confetti`);
      const found = () => readdirSync(work).filter((f) => new RegExp(`^${pack}-confetti-\\d+\\.png$`).test(f)).sort((a, b) => parseInt(a.match(/(\d+)\.png$/)[1]) - parseInt(b.match(/(\d+)\.png$/)[1]));
      // how far apart (in pixels) two things can be and still count as one: the sheets are tight, so start small, and stop at the first distance that gives exactly eight
      let pieces = [];
      for (const reach of ["4", "3", "2", "1"]) {
        for (const old of found()) rmSync(join(work, old));
        run("node", [join(root, "scripts", "cutout.mjs"), cropped, `${prefix}.png`, "--split", "--join", reach, "--max", String(MAX.confetti)]);
        pieces = found();
        if (pieces.length === 8) break;
      }
      if (pieces.length !== 8) throw new Error(`${pack}: expected 8 small pieces, found ${pieces.length}. Check the confetti region.`);
      pieces.forEach((file, i) => {
        copyFileSync(join(work, file), join(incoming, `confetti-${i + 1}.png`));
        toWebp(join(work, file), join(out, `confetti-${i + 1}.webp`));
      });
      console.log(`${pack}/confetti: 8 pieces`);
    }
  }
}
