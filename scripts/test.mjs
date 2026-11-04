// Builds the site and runs the tests, so nobody has to remember the flags.
//   npm test                  everything
//   npm run test:quick        everything that needs no browser (seconds, not minutes)
//   npm test -- songs tiktok  only the test files whose name contains one of these words
// FRILLS_TEST_SETTLE=1 gives every page its full settle time again (the default is half of it, for speed). TEST_CONCURRENCY sets how many test files run at once (default 4: more than that and the timing tests start to fail on a busy computer).

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const quick = args.includes("--quick");
const words = args.filter((a) => !a.startsWith("--"));

const build = spawnSync(process.execPath, ["build.mjs"], { cwd: root, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const files = readdirSync(join(root, "test"))
  .filter((name) => name.endsWith(".test.mjs"))
  .filter((name) => !quick || !name.includes(".browser."))
  .filter((name) => !words.length || words.some((w) => name.includes(w)))
  .map((name) => join("test", name));
if (!files.length) {
  console.error("No test file matches.");
  process.exit(1);
}

// A test file that has not finished after five minutes is stuck (the slowest takes one to two, more when the computer is busy): end it with an error, don't wait for ever.
const run = spawnSync(process.execPath, ["--test", `--test-concurrency=${process.env.TEST_CONCURRENCY ?? 4}`, "--test-timeout=300000", ...files], { cwd: root, stdio: "inherit", env: { ...process.env, FRILLS_TEST_SETTLE: process.env.FRILLS_TEST_SETTLE ?? "0.5" } });
process.exit(run.status ?? 1);
