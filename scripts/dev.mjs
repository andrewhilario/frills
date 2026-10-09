// Builds, serves, and rebuilds when a file changes:  npm run dev
import { spawn, spawnSync } from "node:child_process";
import { watch } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const build = () => {
  const result = spawnSync(process.execPath, ["build.mjs"], { cwd: root, encoding: "utf8" });
  console.log(result.status === 0 ? "rebuilt" : `build failed:\n${result.stderr || result.stdout}`);
};

build();
spawn(process.execPath, ["scripts/serve.mjs"], { cwd: root, stdio: "inherit" });

let timer = 0;
for (const target of ["src", "public", "tokens.css", "site.config.json"]) {
  watch(join(root, target), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(build, 150);
  });
}
