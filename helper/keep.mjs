// Runs the relay and starts it again whenever it stops, so it can be restarted from the owner's status page (and a crash does not leave it down until someone
// looks at the phone). `npm run relay` runs this. It tells the relay it is being kept (RELAY_SUPERVISED=1), which is what turns the page's Restart button on.
// Ctrl+C or a stop signal (tmux kill-session, systemd) stops both, and it is not started again then.
//
// A relay that stops again straight away (a wrong setting, the port already in use) is started again after a longer and longer wait, up to half a minute,
// instead of many times a second.

import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Runs `command` and starts it again each time it ends, until `stop()` is called. A run shorter than `quickMs` counts as a quick stop (shorter than the 15 seconds the relay waits before it accepts a restart, so a restart someone asked for never counts as one): the wait before the
 * next start doubles for each quick stop in a row (from `delayMs`, never beyond `maxDelayMs`). Returns { stop(signal), done } where `done` resolves with the
 * exit code once it was stopped and the program has ended.
 */
export function keep({ command, args = [], env = process.env, log = () => {}, quickMs = 10000, delayMs = 1000, maxDelayMs = 30000, spawnFn = spawn } = {}) {
  let child = null;
  let timer = null;
  let stopping = false;
  let quick = 0;
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });

  const start = () => {
    timer = null;
    const startedAt = Date.now();
    let ended = false;
    const ran = spawnFn(command, args, { stdio: "inherit", env: { ...env, RELAY_SUPERVISED: "1" } });
    child = ran;
    const over = (code, signal) => {
      if (ended) return;
      ended = true;
      child = null;
      if (stopping) return finish(code ?? 0);
      quick = Date.now() - startedAt < quickMs ? quick + 1 : 0;
      const wait = quick ? Math.min(maxDelayMs, delayMs * 2 ** Math.min(quick, 6)) : delayMs;
      log(`It stopped (${signal ?? `code ${code}`}). Starting it again in ${wait >= 1000 ? Math.round(wait / 1000) + " s" : wait + " ms"}.`);
      timer = setTimeout(start, wait);
    };
    ran.on("exit", over);
    ran.on("error", (error) => { log(`Could not start it: ${error.message}`); over(1, null); });
  };

  start();
  return {
    stop(signal = "SIGTERM") {
      stopping = true;
      clearTimeout(timer);
      if (child) child.kill(signal);
      else finish(0);
    },
    done,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = fileURLToPath(new URL("./server.mjs", import.meta.url));
  const run = keep({ command: process.execPath, args: [server, "--relay", ...process.argv.slice(2)], log: (line) => console.log(`[keeper] ${line}`) });
  // (Ctrl+C reaches the relay itself too, from the terminal; the stop signal sent here is the same one, and the relay ignores the second.)
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => run.stop("SIGTERM"));
  run.done.then((code) => process.exit(code));
}
