// The relay owner's password, for seeing who is connected from anywhere (the status page on the public address). Set it with the
// RELAY_OWNER_KEY environment variable (at least 12 characters); without it the names are shown only on the device itself.
// It is sent as `Authorization: Bearer <password>`, never in the address, so it does not land in a log or a browser history. Wrong
// tries are counted per visitor address and after 10 in 10 minutes that address is turned away until the 10 minutes are up, so the
// password cannot be guessed by trying many. Kept in memory only.

import { createHash, timingSafeEqual } from "node:crypto";

export const OWNER = { minKey: 12, maxWrong: 10, windowMs: 10 * 60 * 1000, remembered: 500 };

const digest = (text) => createHash("sha256").update(text).digest();

/** Makes the check for one password. `now` is a clock in milliseconds (a parameter so tests can set it). */
export function ownerGate(key, { now = () => Date.now() } = {}) {
  const enabled = typeof key === "string" && key.length >= OWNER.minKey;
  const wrong = new Map(); // visitor address -> the times of its wrong tries
  const wanted = enabled ? digest(key) : null;
  return {
    enabled,
    /**
     * What an Authorization header says, for a visitor at address `who`: "none" (no password sent, or none is set), "ok", "wrong" or
     * "locked" (too many wrong tries lately, so even the right password waits).
     */
    check(header, who) {
      if (!enabled) return "none";
      const given = /^Bearer (.{1,200})$/.exec(String(header ?? ""))?.[1];
      if (!given) return "none";
      const since = now() - OWNER.windowMs;
      const recent = (wrong.get(who) ?? []).filter((t) => t > since);
      if (recent.length >= OWNER.maxWrong) return "locked";
      if (timingSafeEqual(digest(given), wanted)) return "ok";
      recent.push(now());
      wrong.set(who, recent);
      if (wrong.size > OWNER.remembered) wrong.delete(wrong.keys().next().value);
      return "wrong";
    },
  };
}
