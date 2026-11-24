// What the relay says about itself: the numbers (free spots, people waiting, whether the free signing service is busy, a guess of how many
// accounts this device could hold) and the page a person sees when they open the relay's address in a browser. Pure functions, so they are
// tested without a server. Nothing here names an account: only counts.

import os from "node:os";

export const ALERT_AT = 10; // "this many spots left or fewer" raises the alarm
export const EULER_DEFAULT_CAP = 1500;
export const EULER_DEFAULT_RESETS = 3;
export const EULER_POOL_SIZE = 3;
export const EULER_RATE_LIMITS_URL = "https://tiktok.eulerstream.com/accounts/me/rate_limits";

/** How full it is: "ok", "low" (the alarm number or fewer left) or "full" (nobody else fits). */
export function level({ used, max }, alertAt = ALERT_AT) {
  const free = Math.max(0, max - used);
  return free === 0 ? "full" : free <= alertAt ? "low" : "ok";
}

/**
 * A rough guess of how many accounts this device could keep, from what it measures about itself. Memory: what is free, half of it, divided
 * by what an account costs (measured once a couple are open, else a typical 6 MB). Processor: how much of one core the program uses per
 * account (measured once a couple are open). The smaller of the two. It is a guess: the real limit is usually the internet at home and
 * TikTok's free signing service, not the device.
 */
export function capacity({ freeMem, rss, baseRss, rooms, cpuFraction }) {
  const measured = rooms >= 2;
  const perRoom = measured && rss > baseRss ? Math.max(1.5e6, (rss - baseRss) / rooms) : 6e6;
  const memory = Math.floor((freeMem * 0.5) / perRoom);
  const cpu = measured && cpuFraction > 0 ? Math.floor(0.5 / (cpuFraction / rooms)) : null;
  const estimate = Math.max(1, Math.min(memory, cpu ?? Infinity, 500));
  return { estimate, memory, cpu, measured, perRoomMB: Math.round((perRoom / 1e6) * 10) / 10 };
}

/**
 * Keeps a short record of when the free signing service said "busy", how many requests were used in 1h/24h,
 * and (when Euler keys are configured) manages up to 3 Euler key accounts with a per-key 1,500 request cap
 * and 3 resets per key before failing over to the next backup account.
 */
export class Signing {
  constructor(now = () => Date.now(), { keys = [], resetUrls = [], cap = EULER_DEFAULT_CAP, maxResets = EULER_DEFAULT_RESETS, onReset = null, onRotate = null } = {}) {
    this.now = now;
    this.times = [];
    this.uses = [];
    const list = (Array.isArray(keys) ? keys : [keys]).map((k) => String(k ?? "").trim()).filter(Boolean);
    const urls = (Array.isArray(resetUrls) ? resetUrls : [resetUrls]).map((u) => String(u ?? "").trim());
    this.cap = Math.max(1, Number(cap) || EULER_DEFAULT_CAP);
    this.maxResets = Math.max(0, Number.isFinite(Number(maxResets)) ? Number(maxResets) : EULER_DEFAULT_RESETS);
    this.onReset = typeof onReset === "function" ? onReset : null;
    this.onRotate = typeof onRotate === "function" ? onRotate : null;
    this.lastLimitActionAt = 0;
    this.hasPool = list.length > 0;
    this.slots = this.hasPool
      ? Array.from({ length: Math.max(EULER_POOL_SIZE, list.length) }, (_, i) => {
          const key = list[i] ?? "";
          const configured = Boolean(key);
          return {
            slot: i + 1,
            label: i === 0 ? "Account 1 (Primary)" : `Account ${i + 1} (Backup ${i})`,
            key,
            resetUrl: urls[i] ?? "",
            configured,
            used: 0,
            totalUsed: 0,
            cap: this.cap,
            resetsUsed: 0,
            resetsLeft: configured ? this.maxResets : 0,
            maxResets: this.maxResets,
            exhausted: false,
            lastResetAt: null,
            remote: null,
          };
        })
      : [];
    this.activeIndex = this.hasPool ? Math.max(0, this.slots.findIndex((s) => s.configured)) : 0;
  }

  note() { this.times.push(this.now()); if (this.times.length > 200) this.times.shift(); }
  recent(windowMs = 10 * 60 * 1000) { const from = this.now() - windowMs; return this.times.filter((t) => t >= from).length; }
  hasKeys() { return Boolean(this.hasPool && this.slots.some((s) => s.configured)); }

  /** Queries Euler Stream's `/accounts/me/rate_limits` endpoint for each configured key slot and syncs quotas & exhaustion state. */
  async syncRemoteLimits({ fetchImpl = globalThis.fetch?.bind(globalThis), url = EULER_RATE_LIMITS_URL } = {}) {
    if (!this.hasKeys() || typeof fetchImpl !== "function") return null;
    await Promise.all(
      this.slots.map(async (s) => {
        if (!s.configured || !s.key) return;
        try {
          const res = await fetchImpl(url, { method: "GET", headers: { "x-api-key": s.key, accept: "application/json" } });
          if (!res.ok) {
            s.remote = { ok: false, status: res.status, syncedAt: this.now() };
            return;
          }
          const body = await res.json().catch(() => null);
          if (!body || typeof body !== "object") {
            s.remote = { ok: false, status: 502, syncedAt: this.now() };
            return;
          }
          const day = body.day && typeof body.day === "object" ? { max: Number(body.day.max) || 0, remaining: Number(body.day.remaining) || 0, reset_at: body.day.reset_at ?? null } : null;
          const hour = body.hour && typeof body.hour === "object" ? { max: Number(body.hour.max) || 0, remaining: Number(body.hour.remaining) || 0, reset_at: body.hour.reset_at ?? null } : null;
          const minute = body.minute && typeof body.minute === "object" ? { max: Number(body.minute.max) || 0, remaining: Number(body.minute.remaining) || 0, reset_at: body.minute.reset_at ?? null } : null;
          s.remote = { ok: true, day, hour, minute, syncedAt: this.now() };
          if (day && day.max > 0) {
            if (s.exhausted && day.remaining > 0 && (!hour || hour.remaining > 0)) {
              s.exhausted = false;
              s.used = Math.max(0, Math.min(s.cap, day.max - day.remaining));
            } else if (!s.exhausted && (day.remaining <= 0 || (hour && hour.remaining <= 0))) {
              if (this.slots[this.activeIndex]?.slot === s.slot && s.resetUrl && s.resetsLeft > 0) {
                this.consumeReset(s.slot);
              } else {
                s.exhausted = true;
                s.used = s.cap;
              }
            } else if (day.max === s.cap) {
              s.used = Math.max(s.used, Math.max(0, Math.min(s.cap, day.max - day.remaining)));
            }
          }
        } catch {
          s.remote = { ok: false, status: 0, syncedAt: this.now() };
        }
      }),
    );
    if (this.slots[this.activeIndex]?.exhausted) {
      this.#advance(this.slots[this.activeIndex].slot);
    }
    return this.poolSummary();
  }

  /** Returns the active Euler API key, or "" if none is configured or all accounts are exhausted. */
  currentKey() {
    if (!this.hasPool) return "";
    const cur = this.slots[this.activeIndex];
    if (cur && cur.configured && !cur.exhausted) return cur.key;
    const nextIdx = this.slots.findIndex((s) => s.configured && !s.exhausted);
    if (nextIdx >= 0) {
      this.activeIndex = nextIdx;
      return this.slots[nextIdx].key;
    }
    return "";
  }

  /** Advance activeIndex to the next configured, non-exhausted key account. Returns { from, to } or null. */
  #advance(fromSlot) {
    const after = this.slots.findIndex((c, idx) => idx > this.activeIndex && c.configured && !c.exhausted);
    const any = after >= 0 ? after : this.slots.findIndex((c, idx) => idx !== this.activeIndex && c.configured && !c.exhausted);
    if (any >= 0) {
      this.activeIndex = any;
      const ev = { from: fromSlot, to: this.slots[any].slot, label: this.slots[any].label };
      this.onRotate?.(ev);
      return ev;
    }
    const ev = { from: fromSlot, to: null, label: null };
    this.onRotate?.(ev);
    return ev;
  }

  /** Consume a reset on a slot (defaults to active slot), resetting cycle usage to 0. If no resets left, marks exhausted and rotates to the next backup key. */
  consumeReset(slotNumber = null) {
    if (!this.hasPool) return null;
    const idx = slotNumber == null ? this.activeIndex : Number(slotNumber) - 1;
    const s = this.slots[idx];
    if (!s || !s.configured) return null;
    if (s.resetsLeft > 0) {
      s.resetsUsed += 1;
      s.resetsLeft -= 1;
      s.used = 0;
      s.exhausted = false;
      s.lastResetAt = this.now();
      const info = { action: "reset", slot: s.slot, label: s.label, resetsUsed: s.resetsUsed, resetsLeft: s.resetsLeft, resetUrl: s.resetUrl };
      this.onReset?.(info);
      return info;
    }
    s.exhausted = true;
    const rotated = idx === this.activeIndex ? this.#advance(s.slot) : { from: s.slot, to: this.slots[this.activeIndex]?.slot ?? null };
    return { action: "exhausted", slot: s.slot, label: s.label, rotatedTo: rotated?.to ?? null };
  }

  /** Switch to a specific configured slot number (1..3) or the next available configured backup key. */
  rotateKey(toSlotNumber = null) {
    if (!this.hasPool) return null;
    const fromSlot = this.slots[this.activeIndex]?.slot ?? null;
    if (toSlotNumber != null) {
      const idx = Number(toSlotNumber) - 1;
      const target = this.slots[idx];
      if (!target || !target.configured || target.exhausted) return null;
      this.activeIndex = idx;
      const ev = { from: fromSlot, to: target.slot, label: target.label };
      this.onRotate?.(ev);
      return ev;
    }
    return this.#advance(fromSlot);
  }

  /** Refill one key slot or "all" configured slots back to 0 used and full resets (e.g. after a daily Euler quota refresh or dashboard reset). */
  refillKey(slotNumber = "all") {
    if (!this.hasPool) return false;
    let changed = false;
    for (const s of this.slots) {
      if (!s.configured) continue;
      if (slotNumber !== "all" && s.slot !== Number(slotNumber)) continue;
      s.used = 0;
      s.resetsUsed = 0;
      s.resetsLeft = this.maxResets;
      s.exhausted = false;
      changed = true;
    }
    if (changed) {
      const firstReady = this.slots.findIndex((s) => s.configured && !s.exhausted);
      if (firstReady >= 0 && (slotNumber === "all" || this.slots[this.activeIndex]?.exhausted)) this.activeIndex = firstReady;
    }
    return changed;
  }

  /** Called when the upstream signing service reports HTTP 429 rate-limit despite local tracking (debounced so concurrent rooms don't burn multiple resets at once). */
  limitHit() {
    this.note();
    if (!this.hasKeys()) return null;
    const now = this.now();
    if (now - this.lastLimitActionAt < 5000) return null;
    this.lastLimitActionAt = now;
    const cur = this.slots[this.activeIndex];
    if (cur && cur.configured && !cur.resetUrl) {
      // Without an automated reset webhook, a live HTTP 429 means this key is exhausted right now:
      // immediately fail over to the next backup key instead of retrying the same rate-limited key.
      cur.exhausted = true;
      cur.used = cur.cap;
      const rotated = this.#advance(cur.slot);
      return { action: "exhausted", slot: cur.slot, label: cur.label, rotatedTo: rotated?.to ?? null };
    }
    return this.consumeReset();
  }

  /** One connection that went through the signing service (each one is a request to it, which a free key only allows so many of a day). */
  use() {
    this.uses.push(this.now());
    if (this.uses.length > 5000) this.uses.shift();
    if (!this.hasKeys()) return;
    let s = this.slots[this.activeIndex];
    if (!s || !s.configured || s.exhausted) {
      const nextIdx = this.slots.findIndex((c) => c.configured && !c.exhausted);
      if (nextIdx < 0) return;
      this.activeIndex = nextIdx;
      s = this.slots[nextIdx];
    }
    s.used += 1;
    s.totalUsed += 1;
    if (s.used >= s.cap) {
      this.consumeReset(s.slot);
    }
  }

  usedIn(windowMs) { const from = this.now() - windowMs; return this.uses.filter((t) => t >= from).length; }

  /** Safe telemetry summary of the 3-account key pool (never exposes raw API keys). */
  poolSummary() {
    if (!this.hasPool) return null;
    const cur = this.slots[this.activeIndex];
    const activeSlot = cur && cur.configured && !cur.exhausted ? cur.slot : null;
    const totalRemainingRequests = this.slots.reduce((sum, s) => {
      if (!s.configured || s.exhausted) return sum;
      const cycleLeft = s.remote?.ok && typeof s.remote?.day?.remaining === "number"
        ? Math.min(Math.max(0, s.cap - s.used), Math.max(0, s.remote.day.remaining))
        : Math.max(0, s.cap - s.used);
      const resetCap = s.remote?.ok && s.remote?.day?.max > 0 ? s.remote.day.max : s.cap;
      return sum + cycleLeft + s.resetsLeft * resetCap;
    }, 0);
    return {
      activeSlot,
      cap: this.cap,
      maxResets: this.maxResets,
      configuredCount: this.slots.filter((s) => s.configured).length,
      exhaustedCount: this.slots.filter((s) => s.configured && s.exhausted).length,
      totalRemainingRequests,
      accounts: this.slots.map((s, idx) => ({
        slot: s.slot,
        label: s.label,
        configured: s.configured,
        active: idx === this.activeIndex && s.configured && !s.exhausted,
        exhausted: s.exhausted,
        state: !s.configured ? "unconfigured" : s.exhausted ? "exhausted" : idx === this.activeIndex ? "active" : "standby",
        used: s.used,
        totalUsed: s.totalUsed,
        cap: s.cap,
        resetsUsed: s.resetsUsed,
        resetsLeft: s.resetsLeft,
        maxResets: s.maxResets,
        lastResetAt: s.lastResetAt,
        remote: s.remote ?? null,
      })),
    };
  }
}

/** Everything the page and the alerts need. `device` (processor, memory) is added only for someone on the device itself. */
export function snapshot({ stats, startedAt, now, version, features, signing, estimate, streams = null, alertAt = ALERT_AT, device = null, roster = null, ownerLogin = false, keyed = null, actions = null }) {
  const free = Math.max(0, stats.max - stats.used);
  const pool = typeof signing.poolSummary === "function" ? signing.poolSummary() : null;
  return {
    ok: true, name: "frills-relay", version, features, slots: stats,
    free, level: level(stats, alertAt), alertAt, uptimeS: Math.max(0, Math.round((now - startedAt) / 1000)),
    signing: { busyRecently: signing.recent(), busy: signing.recent(2 * 60 * 1000) > 0, ...(signing.usedIn ? { connectsHour: signing.usedIn(3600000), connectsDay: signing.usedIn(86400000) } : {}), ...(keyed === null ? {} : { key: keyed }), ...(pool ? { pool } : {}) },
    capacity: estimate,
    // the pages listening right now, the most one internet address may hold, how many pages were turned away because of it (and how long ago the last was),
    // and how many came back and replaced their own earlier stream; only counts, like everything else here
    ...(streams ? { streams } : {}),
    ...(device ? { device } : {}),
    ...(roster ? { roster } : {}), // the names: only for the owner (on the device, or with the owner's password), like `device`
    ...(ownerLogin ? { ownerLogin: true } : {}), // says only that an owner password exists, so the page can offer the box for it
    ...(actions ? { actions } : {}), // what the owner may do from the page (only when the owner's password was sent and is right)
  };
}

/** The device's own numbers, for the page that is opened on the device itself. */
export function deviceFacts(cpuFraction) {
  const mem = process.memoryUsage();
  return {
    cores: os.cpus().length || 1,
    memoryTotalMB: Math.round(os.totalmem() / 1e6),
    memoryFreeMB: Math.round(os.freemem() / 1e6),
    relayMemoryMB: Math.round(mem.rss / 1e6),
    relayCpuPercent: Math.round(cpuFraction * 1000) / 10,
    node: process.version,
  };
}

const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const span = (s) => { const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; };

/** The page for a browser: a big number, a bar, the numbers that matter, and an alarm you can turn on. It refreshes itself every 5 seconds. */
export function statusPage(s) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Frills relay: ${esc(s.free)} spots free</title><meta name="robots" content="noindex">
<style>
:root{--paper:#f8f5ec;--paper2:#efe9d6;--ink:#1c1a15;--ink2:#5a5547;--ok:#2f9e63;--low:#e0a100;--full:#d6455d;--line:#d9d2bd}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px 16px 48px}
main{max-width:640px;margin:0 auto}h1{font-size:1.4rem;margin:0 0 4px}.sub{color:var(--ink2);margin:0 0 20px}
.banner{display:none;margin:0 0 16px;padding:14px 16px;border-radius:14px;background:var(--full);color:#fff;font-weight:700}.banner[data-on="true"]{display:block}
.big{border:2px solid var(--ink);border-radius:20px;background:#fff;padding:20px;box-shadow:0 5px 0 var(--ink)}
.num{font-size:4.5rem;font-weight:800;line-height:1;letter-spacing:-.03em}.of{color:var(--ink2);font-size:1.1rem}
.state{margin:8px 0 14px;font-weight:700}.bar{height:16px;border-radius:99px;background:var(--paper2);overflow:hidden}.bar i{display:block;height:100%;width:0;background:var(--ok);transition:width .6s}
[data-level="low"] .bar i{background:var(--low)}[data-level="full"] .bar i{background:var(--full)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0}.card{border:2px solid var(--line);border-radius:14px;padding:12px 14px;background:#fff}
.card b{display:block;font-size:1.3rem}.card span{color:var(--ink2);font-size:.9rem}
.alarm{border:2px dashed var(--line);border-radius:14px;padding:14px;margin-top:16px}.alarm label{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
input[type=number]{width:5rem;padding:6px;border:2px solid var(--ink);border-radius:8px;font:inherit}button{font:inherit;font-weight:700;border:2px solid var(--ink);border-radius:99px;background:#ffd23f;padding:8px 16px;cursor:pointer;box-shadow:0 3px 0 var(--ink)}
.note{color:var(--ink2);font-size:.9rem}.dev{display:none}.dev[data-on="true"]{display:block}
.own{margin-top:16px}.ownrow{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.ownrow input{flex:1 1 12rem;min-width:0;padding:8px;border:2px solid var(--ink);border-radius:8px;font:inherit}#ownout{margin-top:8px}.who{margin-top:16px}.who h2{font-size:1.1rem;margin:0 0 4px}.wrap{overflow-x:auto;margin-top:8px}table{border-collapse:collapse;width:100%;font-size:.92rem}
th{text-align:left;color:var(--ink2);font-weight:600;padding:6px 8px;border-bottom:2px solid var(--line);white-space:nowrap}td{padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
td a{font-weight:700;color:var(--ink)}.pill{display:inline-block;padding:2px 10px;border-radius:99px;border:2px solid var(--ink);font-weight:700;font-size:.8rem;white-space:nowrap}.pill[data-s="live"]{background:#ffd23f}.pill[data-s="wait"]{background:var(--paper2)}.pill[data-s="gone"]{background:transparent;border-style:dashed}
</style></head>
<body><main data-level="${esc(s.level)}" id="app">
<div class="banner" id="banner" role="alert"></div>
<h1>Frills relay</h1><p class="sub" id="sub">Version ${esc(s.version)}. This page refreshes by itself.</p>
<section class="big" id="big"><div><span class="num" id="free">${esc(s.free)}</span> <span class="of" id="of">free spots of ${esc(s.slots.max)}</span></div>
<p class="state" id="state"></p><div class="bar"><i id="fill"></i></div></section>
<div class="grid">
<div class="card"><b id="waiting">${esc(s.slots.waiting)}</b><span>waiting in line</span></div>
<div class="card"><b id="used">${esc(s.slots.used)}</b><span>spots in use</span></div>
<div class="card"><b id="up">${esc(span(s.uptimeS))}</b><span>running for</span></div>
<div class="card"><b id="signing">-</b><span>free signing service</span></div>
<div class="card"><b id="streams">-</b><span>pages open right now</span></div>
<div class="card"><b id="away">-</b><span id="awaynote">pages turned away</span></div>
</div>
<div class="card"><b id="cap">-</b><span id="capnote"></span></div>
<section class="card own" id="euler" hidden><b>Euler Signing Key Pool (3 Accounts · 1,500 Cap · 3 Resets Each)</b><p class="note" id="eulernote"></p><div class="grid" id="eulergrid"></div><div class="ownrow" id="eulerctl" hidden><button id="euler-reset" type="button">Use 1 reset on active key</button><button id="euler-rotate" type="button">Rotate to backup key</button><button id="euler-refill" type="button">Refill all (after daily reset)</button><button id="euler-sync" type="button">Sync live Euler quota</button></div><p class="note" id="eulermsg" role="status"></p></section>
<section class="alarm"><label>Warn me when <input type="number" id="at" min="0" max="500" value="${esc(s.alertAt)}"> or fewer spots are left <button id="allow" type="button">Turn on notifications</button></label>
<p class="note" id="allownote">The warning also shows here as a red bar, and plays a short sound. Keep this page open to get it. Your phone can warn you by itself too (Termux notification), see the guide.</p></section>
<section class="card dev" id="dev"><b>This device</b><span id="devtext"></span></section>
<section class="card own" id="own" hidden><b>Owner?</b> <span class="note">Enter the relay password to see who is connected and to restart the relay. It stays in this tab only.</span>
<div class="ownrow"><input type="password" id="ownkey" autocomplete="current-password" spellcheck="false" aria-label="Relay password"> <button id="ownsave" type="button">Sign in</button></div><p class="note" id="ownmsg" role="status"></p></section>
<section class="card own" id="ctl" hidden><b>Restart</b> <span class="note">Stops the relay and starts it again. Everyone's chat reconnects by itself in a few seconds.</span>
<div class="ownrow"><button id="restart" type="button">Restart the relay</button></div><p class="note" id="ctlmsg" role="status"></p></section>
<section class="card who dev" id="who"><h2>Who is connected</h2><span class="note" id="whonote"></span>
<div class="wrap"><table id="whotable"><thead><tr><th>Account</th><th>Status</th><th>Pages</th><th>Followers</th><th>Here for</th><th>Last minute</th></tr></thead><tbody id="whobody"></tbody></table></div>
<p class="note" id="waitnote"></p><button id="ownout" type="button" hidden>Hide the names again</button></section>
</main>
<script>
const $=(id)=>document.getElementById(id);let last="ok",first=true;
const asText=(s)=>{const h=Math.floor(s/3600),m=Math.floor(s%3600/60);return h?h+" h "+m+" min":m+" min"};
let OWNER="";try{OWNER=sessionStorage.getItem("frills:relay:owner")||""}catch{}
const keep=(v)=>{OWNER=v;try{v?sessionStorage.setItem("frills:relay:owner",v):sessionStorage.removeItem("frills:relay:owner")}catch{}};
const AT=localStorage.getItem("frills:relay:at");if(AT!==null)$("at").value=AT;
$("at").addEventListener("input",()=>localStorage.setItem("frills:relay:at",$("at").value));
$("allow").addEventListener("click",async()=>{try{const r=await Notification.requestPermission();$("allownote").textContent=r==="granted"?"Notifications are on. You will get one when spots run low.":"Notifications are blocked in this browser. The red bar and the sound still work."}catch{$("allownote").textContent="This browser cannot send notifications. The red bar and the sound still work."}});
let ctx;const beep=()=>{try{ctx=ctx||new AudioContext();const o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=880;g.gain.setValueAtTime(.2,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.5);o.start();o.stop(ctx.currentTime+.5)}catch{}};
const cell=(tr,text)=>{const td=document.createElement("td");td.textContent=text;tr.append(td);return td};
const forText=(n)=>n<90?n+" s":n<5400?Math.round(n/60)+" min":Math.floor(n/3600)+" h "+Math.round(n%3600/60)+" min";
function drawWho(r){
  $("who").dataset.on="true";
  const body=$("whobody");body.replaceChildren();
  for(const a of r.accounts){
    const tr=document.createElement("tr"),td=document.createElement("td"),link=document.createElement("a");
    link.textContent="@"+a.user;link.href="https://www.tiktok.com/@"+encodeURIComponent(a.user)+"/live";link.target="_blank";link.rel="noopener noreferrer";td.append(link);tr.append(td);
    // A page open is what makes it "in use". With none, the account is only kept for a few minutes (the last page may be back), and says so.
    const st=a.pages===0?["No page open"+(a.live?" (still LIVE)":"")+", leaves in "+forText(a.leavesInS||0),"gone"]:a.state==="connected"?(a.live?["LIVE now","live"]:["Connected, not LIVE yet","wait"]):a.state==="offline"?[a.endedS!=null?"LIVE ended "+forText(a.endedS)+" ago, waiting":"Waiting for their LIVE","wait"]:a.state==="limited"?["Waiting (TikTok is busy)","wait"]:[a.state,"wait"];
    const sc=document.createElement("td"),pill=document.createElement("span");pill.className="pill";pill.dataset.s=st[1];pill.textContent=st[0];sc.append(pill);tr.append(sc);
    cell(tr,String(a.pages));cell(tr,a.followers?a.followers.toLocaleString():"-");cell(tr,forText(a.forS));
    cell(tr,a.counts.chat+" chat, "+a.counts.gift+" gifts, "+a.counts.follow+" follows, "+a.counts.share+" shares"+(a.lastS==null?" · nothing yet":" · last "+forText(a.lastS)+" ago"));
    body.append(tr);
  }
  const gone=r.accounts.filter((a)=>a.pages===0).length,live=r.accounts.filter((a)=>a.pages>0&&a.state==="connected"&&a.live).length,wait=r.accounts.length-gone-live;
  $("whotable").hidden=r.accounts.length===0;
  $("whonote").textContent=r.accounts.length?r.accounts.length+" on the list: "+live+" LIVE now with a page open, "+wait+" with a page open waiting for a LIVE, "+gone+" with no page open (about to leave). Press a name to open their LIVE on TikTok.":"Nobody is connected right now.";
  $("waitnote").textContent=r.waiting.length?"In line: "+r.waiting.map((u)=>"@"+u).join(", "):"";
}
function draw(s){
  const at=Math.max(0,Number($("at").value)||0),free=s.free,low=free<=at||s.slots.waiting>0;
  $("app").dataset.level=free===0?"full":low?"low":"ok";
  $("free").textContent=free;$("of").textContent="free spots of "+s.slots.max;$("waiting").textContent=s.slots.waiting;$("used").textContent=s.slots.used;$("up").textContent=asText(s.uptimeS);
  $("fill").style.width=Math.min(100,100*s.slots.used/Math.max(1,s.slots.max))+"%";
  $("state").textContent=s.slots.waiting>0?s.slots.waiting+" "+(s.slots.waiting===1?"person is":"people are")+" waiting for a spot":free===0?"Full: nobody else fits":low?"Getting full: "+free+" left":"Plenty of room";
  const pool = s.signing.pool;
  const poolNote = pool ? (pool.activeSlot ? " · Pool Key #" + pool.activeSlot + " (" + pool.accounts[pool.activeSlot - 1].used + "/" + pool.cap + ", " + pool.accounts[pool.activeSlot - 1].resetsLeft + "/" + pool.maxResets + " resets left)" : " · ALL POOL KEYS EXHAUSTED") : "";
  $("signing").textContent=(s.signing.busy?"Busy right now":s.signing.busyRecently?"OK (busy "+s.signing.busyRecently+"x lately)":"OK")+(s.signing.key===undefined?"":s.signing.key?" · own key":" · NO key (shared limits)")+poolNote+(s.signing.connectsDay===undefined?"":" · "+s.signing.connectsDay+" connects in 24 h");
  if(pool){
    $("euler").hidden=false;
    $("eulernote").textContent=pool.configuredCount+" of "+pool.accounts.length+" keys configured · "+pool.totalRemainingRequests.toLocaleString()+" estimated requests remaining in pool.";
    const g=$("eulergrid");g.replaceChildren();
    for(const a of pool.accounts){
      const box=document.createElement("div");box.className="card";
      const b=document.createElement("b");b.textContent=a.label+": "+a.state.toUpperCase();
      const sp=document.createElement("span");
      const remote=a.remote&&a.remote.ok&&a.remote.day?" · Euler live: "+a.remote.day.remaining+"/"+a.remote.day.max+" day":"";
      sp.textContent=a.configured?a.used+" / "+a.cap+" reqs · "+a.resetsLeft+" / "+a.maxResets+" resets left · "+a.totalUsed+" total"+remote:"Not configured (set EULER_API_KEYS or EULER_API_KEY_"+a.slot+")";
      box.append(b,sp);g.append(box);
    }
    $("eulerctl").hidden=!(s.actions||s.device);
  }else{$("euler").hidden=true}
  if(s.streams){const t=s.streams;$("streams").textContent=t.open;$("away").textContent=t.turnedAway;$("awaynote").textContent="pages turned away since it started"+(t.lastTurnedAwayS===null?"":" (the last "+forText(t.lastTurnedAwayS)+" ago)")+". One internet address may keep "+t.limit+" open."+(t.replaced?" "+t.replaced+" came back and replaced their own old connection.":"")}
  const c=s.capacity;$("cap").textContent="About "+c.estimate+" accounts";$("capnote").textContent=(c.measured?"A guess from what this device uses now.":"A first guess; it improves once a few accounts are open.")+" Your internet and TikTok's free signing usually run out before the device does."+(c.estimate>s.slots.max*1.5?" You set "+s.slots.max+" spots, so there may be room to raise it.":"");
  const b=$("banner");b.dataset.on=String(low);b.textContent=s.slots.waiting>0?"People are waiting in line. Only "+free+" spots left.":free===0?"The relay is full.":"Only "+free+" spots left.";
  $("own").hidden=!s.ownerLogin;$("ownout").hidden=!(s.roster&&OWNER);
  $("ctl").hidden=!(s.actions||s.device); // the owner (signed in) or someone on the device itself: the card says what is missing when it cannot be used
  // the card's own lines (what is missing, or that it cannot restart) are put up and taken down here; what a press of the button said is left alone
  const ownLine=(key,text)=>{if(cardNote!==key){cardNote=key;$("ctlmsg").textContent=text}};
  if(!s.actions){
    if(!restarting){$("restart").disabled=true;ownLine(s.ownerLogin?"in":"none",s.ownerLogin?"Sign in with the owner password above to restart the relay.":"This relay has no owner password, so it cannot be restarted from this page. Set RELAY_OWNER_KEY (12 or more characters) and start the relay again.")}
  }else{
    if(restarting&&s.uptimeS<restarting){restarting=0;cardNote="";$("restart").disabled=!s.actions.restart;$("ctlmsg").textContent="Back, and restarted just now."}
    else if(!restarting){
      $("restart").disabled=!s.actions.restart;
      if(s.actions.restart){if(cardNote){cardNote="";$("ctlmsg").textContent=""}}else ownLine("alone","This relay cannot restart itself, because nothing would start it again. Start it with npm run relay (the guide has the steps).");
    }
    lastUp=s.uptimeS;
  }
  if(s.roster){drawWho(s.roster)}else{$("who").dataset.on="false"}
  if(s.device){$("dev").dataset.on="true";const d=s.device;$("devtext").textContent=d.cores+" processor cores. Memory: "+d.memoryFreeMB+" MB free of "+d.memoryTotalMB+" MB. The relay itself uses "+d.relayMemoryMB+" MB and about "+d.relayCpuPercent+"% of one core. Node "+d.node+"."}
  if(low&&last==="ok"&&!first){beep();try{if(Notification.permission==="granted")new Notification("Frills relay",{body:b.textContent})}catch{}}
  last=low?"low":"ok";first=false;document.title="Frills relay: "+free+" spots free";
}
async function tick(){try{
  const r=await fetch("/health",{headers:{accept:"application/json",...(OWNER?{authorization:"Bearer "+OWNER}:{})},cache:"no-store"});
  if(r.status===401){keep("");$("ownmsg").textContent="That is not the right password.";return tick()}
  if(r.status===429){keep("");$("ownmsg").textContent="Too many wrong tries. Wait ten minutes and try again.";return}
  draw(await r.json())}catch{$("state").textContent="Cannot reach the relay right now."}}
$("ownsave").addEventListener("click",()=>{const v=$("ownkey").value.trim();if(!v)return;keep(v);$("ownkey").value="";$("ownmsg").textContent="";tick()});
$("ownkey").addEventListener("keydown",(e)=>{if(e.key==="Enter")$("ownsave").click()});
$("ownout").addEventListener("click",()=>{keep("");tick()});
let restarting=0,lastUp=0,cardNote="";
$("restart").addEventListener("click",async()=>{
  if(!OWNER||!confirm("Restart the relay now? Everyone's chat reconnects by itself in a few seconds."))return;
  $("restart").disabled=true;$("ctlmsg").textContent="Asking the relay to restart...";
  try{
    const r=await fetch("/owner/restart",{method:"POST",headers:{authorization:"Bearer "+OWNER},cache:"no-store"});
    const j=await r.json().catch(()=>({}));
    if(r.ok){restarting=lastUp||1;$("ctlmsg").textContent="Restarting. This page finds the relay again by itself."}
    else{$("ctlmsg").textContent=({not_supervised:"It cannot restart itself, because nothing would start it again. Start it with npm run relay (the guide has the steps).",too_soon:"It was started or restarted a moment ago. Wait half a minute.",locked:"Too many wrong tries. Wait ten minutes.",wrong_key:"That is not the right password.",key_needed:"Enter the password first.",no_owner_password:"The relay has no owner password set."})[j.error]||"The relay said no ("+r.status+").";$("restart").disabled=false}
  }catch{$("ctlmsg").textContent="Cannot reach the relay right now.";$("restart").disabled=false}
});
async function eulerAction(action){
  $("eulermsg").textContent="Updating key pool...";
  try{
    const r=await fetch("/owner/euler",{method:"POST",headers:{"content-type":"application/json",...(OWNER?{authorization:"Bearer "+OWNER}:{})},body:JSON.stringify({action}),cache:"no-store"});
    const j=await r.json().catch(()=>({}));
    if(r.ok){$("eulermsg").textContent="Updated key pool ("+action+").";tick()}
    else{$("eulermsg").textContent="Action failed ("+(j.error||r.status)+")."}
  }catch{$("eulermsg").textContent="Cannot reach the relay right now."}
}
$("euler-reset").addEventListener("click",()=>eulerAction("reset"));
$("euler-rotate").addEventListener("click",()=>eulerAction("rotate"));
$("euler-refill").addEventListener("click",()=>eulerAction("refill"));
$("euler-sync").addEventListener("click",()=>eulerAction("sync"));
draw(${JSON.stringify(s).replace(/</g, "\\u003c")});setInterval(tick,5000);if(OWNER)tick();
</script></body></html>`;
}
