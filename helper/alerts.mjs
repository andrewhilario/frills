// Warns the owner of the relay when it is getting full, without anyone having to look: it writes a line in the relay's window and, on a
// phone with the free Termux:API app, raises a notification on the phone itself. Nothing is sent to anyone else. The check, the clock and
// the notifier are given in, so it is tested without a phone.

import { execFile } from "node:child_process";
import { level } from "./status.mjs";

/** A notification on the phone through Termux:API (`termux-notification`). Says so once when that is not installed. */
export function termuxNotifier({ run = execFile, log = () => {} } = {}) {
  let warned = false;
  return (title, content) => {
    try {
      run("termux-notification", ["--id", "frills-relay", "--title", title, "--content", content, "--priority", "high", "--vibrate", "300,150,300"], (error) => {
        if (error && !warned) {
          warned = true;
          log("alerts: no phone notifications. Install the free Termux:API app and run: pkg install termux-api");
        }
      });
    } catch {
      if (!warned) { warned = true; log("alerts: no phone notifications. Install the free Termux:API app and run: pkg install termux-api"); }
    }
  };
}

/**
 * Looks at the numbers now and then and speaks up when something changes for the worse, once per change: the spots left reach the alarm
 * number, the line starts to form, the free signing service starts saying "busy". It speaks again only after things got better (a few
 * spots more than the alarm number, an empty line, a quiet signing service), so a number hovering around the line does not nag.
 */
export class SlotAlerts {
  constructor({ stats, signing, alertAt = 10, notify = () => {}, log = () => {}, now = () => Date.now() } = {}) {
    this.stats = stats;
    this.signing = signing;
    this.alertAt = alertAt;
    this.notify = notify;
    this.log = log;
    this.now = now;
    this.state = { low: false, waiting: false, busy: false };
  }

  say(title, content) {
    this.log(`alert: ${content}`);
    this.notify(title, content);
  }

  /** One look. Returns the messages it raised (for the tests). */
  check() {
    const raised = [];
    const s = this.stats();
    const free = Math.max(0, s.max - s.used);
    const state = level(s, this.alertAt);
    const say = (title, content) => { raised.push(content); this.say(title, content); };

    if (state !== "ok" && !this.state.low) { this.state.low = true; say("Frills relay is getting full", free === 0 ? "The relay is full: nobody else fits." : `Only ${free} spot${free === 1 ? "" : "s"} left.`); }
    else if (state === "ok" && free > this.alertAt + 3) this.state.low = false;

    if (s.waiting > 0 && !this.state.waiting) { this.state.waiting = true; say("People are waiting on the Frills relay", `${s.waiting} ${s.waiting === 1 ? "person is" : "people are"} waiting in line. ${free} spot${free === 1 ? "" : "s"} left.`); }
    else if (s.waiting === 0) this.state.waiting = false;

    const busy = this.signing.recent(2 * 60 * 1000) > 0;
    if (busy && !this.state.busy) { this.state.busy = true; say("TikTok's free connection is busy", "The free signing service is saying \"busy\". New connections may fail for a minute or two."); }
    else if (!busy && this.signing.recent(10 * 60 * 1000) === 0) this.state.busy = false;
    return raised;
  }

  start(everyMs = 10000) {
    const timer = setInterval(() => this.check(), everyMs);
    timer.unref?.();
    return { stop: () => clearInterval(timer) };
  }
}
