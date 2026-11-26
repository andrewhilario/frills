// What the relay says about itself: the numbers (free spots, people waiting, whether the free signing service is busy, a guess of how many
// accounts this device could hold) and the page a person sees when they open the relay's address in a browser. Pure functions, so they are
// tested without a server. Nothing here names an account: only counts.

import os from "node:os";

export const ALERT_AT = 10; // "this many spots left or fewer" raises the alarm
export const EULER_DEFAULT_CAP = 1500;
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
 * Tracks Euler Stream signing usage for one compliant Euler account (default 1,500 requests/day),
 * enforces an optional daily budget guard/reserve so free traffic never starves Frills Plus or
 * hammers Euler with doomed 429 retries, and records leak-shield savings (offline checks skipped,
 * cached roomId reconnects, live connects vs reconnects).
 */
export class Signing {
  constructor(now = () => Date.now(), { key = "", keys = [], cap = EULER_DEFAULT_CAP, reserve = 0, onBudgetPause = null } = {}) {
    this.now = now;
    this.times = [];
    this.uses = [];
    const list = (Array.isArray(keys) ? keys : [keys]).map((k) => String(k ?? "").trim()).filter(Boolean);
    const singleKey = String(key ?? "").trim() || list[0] || "";
    this.key = singleKey;
    this.cap = Math.max(1, Number(cap) || EULER_DEFAULT_CAP);
    this.reserve = Math.max(0, Math.min(this.cap - 1, Math.round(Number(reserve) || 0)));
    this.onBudgetPause = typeof onBudgetPause === "function" ? onBudgetPause : null;
    this.used = 0;
    this.totalUsed = 0;
    this.exhausted = false;
    this.pauseUntil = 0;
    this.remote = null;
    this.lastLimitActionAt = 0;
    this.metrics = {
      liveConnects: 0,
      reconnects: 0,
      offlineSaved: 0,
      roomIdCacheHits: 0,
      budgetBlocked: 0,
      rateLimited: 0,
    };
  }

  note() { this.times.push(this.now()); if (this.times.length > 200) this.times.shift(); }
  recent(windowMs = 10 * 60 * 1000) { const from = this.now() - windowMs; return this.times.filter((t) => t >= from).length; }
  hasKeys() { return Boolean(this.key); }
  currentKey() { return this.key && !this.exhausted ? this.key : ""; }

  noteOfflineSaved() { this.metrics.offlineSaved += 1; }
  noteCacheHit() { this.metrics.roomIdCacheHits += 1; }
  noteBudgetBlocked() { this.metrics.budgetBlocked += 1; }

  /** Effective daily cap from Euler's live /rate_limits response if synced, otherwise configured local cap. */
  effectiveCap() {
    return this.remote?.ok && this.remote.day?.max > 0 ? this.remote.day.max : this.cap;
  }

  /** Remaining daily requests before hitting the hard cap (respects synced Euler quota when present). */
  remainingDaily() {
    const cap = this.effectiveCap();
    const localLeft = Math.max(0, cap - this.used);
    if (this.remote?.ok && typeof this.remote.day?.remaining === "number") {
      return Math.min(localLeft, Math.max(0, this.remote.day.remaining));
    }
    return localLeft;
  }

  /** Remaining requests available for new connects after honoring `reserve`. */
  availableBudget() {
    if (!this.key) return Infinity;
    if (this.exhausted) return 0;
    if (this.pauseUntil > this.now()) return 0;
    if (this.remote?.ok && this.remote.hour && this.remote.hour.remaining <= 0) {
      const hourReset = Date.parse(this.remote.hour.reset_at ?? "");
      if (!Number.isFinite(hourReset) || hourReset > this.now()) return 0;
    }
    return Math.max(0, this.remainingDaily() - this.reserve);
  }

  /** True when this relay is allowed to open a new Euler-signed WebSocket connection right now. */
  canSign() {
    if (!this.key) return true;
    // Auto-clear time-bounded pause once its reset window has elapsed
    if (this.pauseUntil > 0 && this.now() >= this.pauseUntil) {
      this.pauseUntil = 0;
      this.exhausted = false;
      this.used = 0;
    }
    return this.availableBudget() > 0;
  }

  /** Next reset timestamp (ms) reported by Euler, or 0 if unknown. */
  nextResetAt() {
    const candidates = [this.pauseUntil];
    if (this.remote?.ok) {
      const hr = Date.parse(this.remote.hour?.reset_at ?? "");
      const dy = Date.parse(this.remote.day?.reset_at ?? "");
      if (this.remote.hour?.remaining <= 0 && Number.isFinite(hr)) candidates.push(hr);
      if (this.remote.day?.remaining <= this.reserve && Number.isFinite(dy)) candidates.push(dy);
    }
    const valid = candidates.filter((t) => Number.isFinite(t) && t > this.now());
    return valid.length ? Math.min(...valid) : 0;
  }

  /** Queries Euler Stream's `/accounts/me/rate_limits` for the single configured key and updates pause/quota state. */
  async syncRemoteLimits({ fetchImpl = globalThis.fetch?.bind(globalThis), url = EULER_RATE_LIMITS_URL } = {}) {
    if (!this.key || typeof fetchImpl !== "function") return null;
    try {
      const res = await fetchImpl(url, { method: "GET", headers: { "x-api-key": this.key, accept: "application/json" } });
      if (!res.ok) {
        this.remote = { ok: false, status: res.status, syncedAt: this.now() };
        return this.quotaSummary();
      }
      const body = await res.json().catch(() => null);
      if (!body || typeof body !== "object") {
        this.remote = { ok: false, status: 502, syncedAt: this.now() };
        return this.quotaSummary();
      }
      const day = body.day && typeof body.day === "object" ? { max: Number(body.day.max) || 0, remaining: Number(body.day.remaining) || 0, reset_at: body.day.reset_at ?? null } : null;
      const hour = body.hour && typeof body.hour === "object" ? { max: Number(body.hour.max) || 0, remaining: Number(body.hour.remaining) || 0, reset_at: body.hour.reset_at ?? null } : null;
      const minute = body.minute && typeof body.minute === "object" ? { max: Number(body.minute.max) || 0, remaining: Number(body.minute.remaining) || 0, reset_at: body.minute.reset_at ?? null } : null;
      this.remote = { ok: true, day, hour, minute, syncedAt: this.now() };
      if (day && day.max > 0) {
        this.used = Math.max(0, Math.min(day.max, day.max - day.remaining));
        const dayExhausted = day.remaining <= this.reserve;
        const hourExhausted = Boolean(hour && hour.remaining <= 0);
        if (dayExhausted || hourExhausted) {
          this.exhausted = true;
          const resetMs = Date.parse((hourExhausted ? hour?.reset_at : day?.reset_at) ?? "");
          this.pauseUntil = Number.isFinite(resetMs) && resetMs > this.now() ? resetMs : this.now() + 15 * 60 * 1000;
          this.onBudgetPause?.({ reason: hourExhausted ? "hour_limit" : "day_budget", pauseUntil: this.pauseUntil });
        } else {
          this.exhausted = false;
          this.pauseUntil = 0;
        }
      }
    } catch {
      this.remote = { ok: false, status: 0, syncedAt: this.now() };
    }
    return this.quotaSummary();
  }

  /** Resets the local daily counter and clears any budget pause (e.g. after Euler's daily quota resets). */
  refillKey() {
    if (!this.key) return false;
    this.used = 0;
    this.exhausted = false;
    this.pauseUntil = 0;
    return true;
  }

  /** Called when Euler reports HTTP 429 rate-limit despite local tracking (debounced to avoid log/pause storms). */
  limitHit() {
    this.note();
    this.metrics.rateLimited += 1;
    if (!this.key) return null;
    const now = this.now();
    if (now - this.lastLimitActionAt < 5000) return null;
    this.lastLimitActionAt = now;
    this.exhausted = true;
    const resetAt = this.nextResetAt();
    this.pauseUntil = resetAt || now + 5 * 60 * 1000;
    this.onBudgetPause?.({ reason: "rate_limited", pauseUntil: this.pauseUntil });
    return { action: "paused", pauseUntil: this.pauseUntil };
  }

  /** Records one signed TikTok WebSocket connection through Euler. */
  use({ reconnect = false } = {}) {
    this.uses.push(this.now());
    if (this.uses.length > 5000) this.uses.shift();
    if (reconnect) this.metrics.reconnects += 1;
    else this.metrics.liveConnects += 1;
    if (!this.key) return;
    this.used += 1;
    this.totalUsed += 1;
    if (this.remote?.ok && this.remote.day && this.remote.day.remaining > 0) {
      this.remote.day.remaining = Math.max(0, this.remote.day.remaining - 1);
    }
    if (this.remote?.ok && this.remote.hour && this.remote.hour.remaining > 0) {
      this.remote.hour.remaining = Math.max(0, this.remote.hour.remaining - 1);
    }
    if (this.remainingDaily() <= this.reserve) {
      this.exhausted = true;
      const resetAt = this.nextResetAt();
      this.pauseUntil = resetAt || this.now() + 15 * 60 * 1000;
      this.onBudgetPause?.({ reason: "day_budget", pauseUntil: this.pauseUntil });
    }
  }

  usedIn(windowMs) { const from = this.now() - windowMs; return this.uses.filter((t) => t >= from).length; }

  /** Safe telemetry summary for the single compliant Euler key (never exposes the raw API key). */
  quotaSummary() {
    if (!this.key) return null;
    const cap = this.effectiveCap();
    const remaining = this.remainingDaily();
    const available = this.availableBudget();
    const paused = !this.canSign();
    const state = paused ? (remaining <= 0 ? "exhausted" : "reserved") : "active";
    const resetAt = this.nextResetAt();
    return {
      mode: "single",
      configured: true,
      state,
      used: this.used,
      totalUsed: this.totalUsed,
      cap,
      reserve: this.reserve,
      remaining,
      available,
      resetAt: resetAt ? new Date(resetAt).toISOString() : (this.remote?.day?.reset_at ?? null),
      remote: this.remote ?? null,
      metrics: { ...this.metrics },
    };
  }

  /** Compatibility alias returning the single-account summary in the legacy `pool` shape for older monitors. */
  poolSummary() {
    const q = this.quotaSummary();
    if (!q) return null;
    return {
      mode: "single",
      activeSlot: q.state === "active" ? 1 : null,
      cap: q.cap,
      reserve: q.reserve,
      configuredCount: 1,
      exhaustedCount: q.state === "active" ? 0 : 1,
      totalRemainingRequests: q.available,
      metrics: q.metrics,
      accounts: [
        {
          slot: 1,
          label: "Primary Euler Account",
          configured: true,
          active: q.state === "active",
          exhausted: q.state !== "active",
          state: q.state,
          used: q.used,
          totalUsed: q.totalUsed,
          cap: q.cap,
          reserve: q.reserve,
          remaining: q.remaining,
          available: q.available,
          resetAt: q.resetAt,
          remote: q.remote,
        },
      ],
    };
  }
}

/** Everything the page and the alerts need. `device` (processor, memory) is added only for someone on the device itself. */
export function snapshot({ stats, startedAt, now, version, features, signing, estimate, streams = null, alertAt = ALERT_AT, device = null, roster = null, ownerLogin = false, keyed = null, actions = null }) {
  const free = Math.max(0, stats.max - stats.used);
  const quota = typeof signing.quotaSummary === "function" ? signing.quotaSummary() : null;
  const pool = typeof signing.poolSummary === "function" ? signing.poolSummary() : null;
  const metrics = signing.metrics ? { ...signing.metrics } : null;
  return {
    ok: true, name: "frills-relay", version, features, slots: stats,
    free, level: level(stats, alertAt), alertAt, uptimeS: Math.max(0, Math.round((now - startedAt) / 1000)),
    signing: {
      busyRecently: signing.recent(),
      busy: signing.recent(2 * 60 * 1000) > 0,
      ...(signing.usedIn ? { connectsHour: signing.usedIn(3600000), connectsDay: signing.usedIn(86400000) } : {}),
      ...(keyed === null ? {} : { key: keyed }),
      ...(metrics ? { metrics } : {}),
      ...(quota ? { quota } : {}),
      ...(pool ? { pool } : {}),
    },
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

/**
 * Hallmark ("Hum tuned for Frills") self-contained relay health & command console.
 * Uses Frills' exact OKLCH tokens (cream paper, cool near-black ink, pear/sky/coral/mint/lavender accents),
 * Frilly SVG mascot, tabular mono numerals, filterable live roster, Euler Leak Shield card, and 5s auto-refresh.
 * Zero external requests (fits strict `default-src 'none'` CSP).
 */
export function statusPage(s) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Frills relay: ${esc(s.free)} spots free</title><meta name="robots" content="noindex">
<style>
/*! Hallmark · genre: playful · theme: Hum (tuned for Frills) · enrichment: Tier-B SVG Frilly */
:root{
  --color-paper:#f8f5ec;--color-paper:oklch(97% 0.012 95);
  --color-paper-2:#efeae0;--color-paper-2:oklch(94% 0.016 95);
  --color-paper-3:#e6e0d2;--color-paper-3:oklch(91% 0.020 95);
  --color-rule:#d5cec0;--color-rule:oklch(82% 0.024 90);
  --color-rule-2:#9f9888;--color-rule-2:oklch(64% 0.022 90);
  --color-ink:#1a1c22;--color-ink:oklch(20% 0.012 250);
  --color-ink-2:#545863;--color-ink-2:oklch(40% 0.014 250);
  --color-accent:#e6dc3a;--color-accent:oklch(86% 0.18 95);
  --color-accent-deep:#9a8920;--color-accent-deep:oklch(62% 0.15 85);
  --color-accent-tint:#f5f0c8;--color-accent-tint:oklch(93% 0.07 95);
  --color-accent-2:#3f9be8;--color-accent-2:oklch(66% 0.18 235);
  --color-accent-2-tint:#e4eff9;--color-accent-2-tint:oklch(93% 0.035 235);
  --color-accent-3:#e65558;--color-accent-3:oklch(68% 0.24 18);
  --color-accent-3-tint:#fae7e7;--color-accent-3-tint:oklch(93% 0.04 18);
  --color-mint:#5cc98a;--color-mint:oklch(80% 0.16 150);
  --color-mint-tint:#e2f4e9;--color-mint-tint:oklch(93% 0.05 150);
  --color-lavender-tint:#eee6f9;--color-lavender-tint:oklch(93% 0.04 305);
  --color-ink-cast:oklch(20% 0.012 250 / 0.22);
  --color-focus:oklch(48% 0.20 265);
  --color-error:#a5222d;--color-error:oklch(50% 0.20 25);
  --color-success:#28734d;--color-success:oklch(46% 0.10 155);
  --color-warn:#b8860b;--color-warn:oklch(74% 0.15 85);
  --font-body:"Plus Jakarta Sans",ui-rounded,system-ui,-apple-system,"Segoe UI",sans-serif;
  --font-mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --radius-sm:10px;--radius-card:20px;--radius-chunk:26px;--radius-pill:999px;
  --ease-out:cubic-bezier(0.16,1,0.3,1);
}
*{box-sizing:border-box}
body{margin:0;background:var(--color-paper);color:var(--color-ink);font:15px/1.5 var(--font-body);padding:clamp(16px,3vw,28px) clamp(12px,3vw,24px) 64px;-webkit-font-smoothing:antialiased}
main{max-width:1040px;margin:0 auto;display:grid;gap:16px}
[hidden]{display:none!important}
.mono{font-family:var(--font-mono);font-variant-numeric:tabular-nums}
.num-tab{font-variant-numeric:tabular-nums}

/* Top bar with Frilly mascot */
.topbar{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:12px 18px;border:2px solid var(--color-ink);border-radius:var(--radius-card);background:var(--color-paper-2);box-shadow:0 4px 0 var(--color-ink-cast)}
.brand{display:flex;align-items:center;gap:12px;min-width:0}
.frilly{width:46px;height:46px;flex:none;animation:bob 3.6s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
.brand h1{margin:0;font-size:clamp(1.2rem,2.4vw,1.5rem);font-weight:800;letter-spacing:-0.025em;line-height:1.15;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ver{display:inline-flex;align-items:center;padding:2px 9px;border-radius:var(--radius-pill);border:1.5px solid var(--color-ink);background:var(--color-accent-tint);font:700 0.72rem/1.3 var(--font-mono);letter-spacing:0.02em}
.sub{margin:2px 0 0;color:var(--color-ink-2);font-size:0.84rem}
.live-badge{display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border-radius:var(--radius-pill);border:1.5px solid var(--color-ink);background:var(--color-paper);font:700 0.76rem/1 var(--font-mono);color:var(--color-ink);white-space:nowrap}
.dot{width:9px;height:9px;border-radius:50%;background:var(--color-success);box-shadow:0 0 0 3px var(--color-mint-tint);animation:pulse 2.2s ease-in-out infinite}
[data-level="low"] .dot{background:var(--color-warn);box-shadow:0 0 0 3px var(--color-accent-tint)}
[data-level="full"] .dot{background:var(--color-error);box-shadow:0 0 0 3px var(--color-accent-3-tint)}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(.88)}}

/* Alert banner */
.banner{display:none;padding:12px 16px;border-radius:var(--radius-card);border:2px solid var(--color-ink);background:var(--color-accent-3);color:#fff;font-weight:800;box-shadow:0 4px 0 var(--color-ink-cast)}
.banner[data-on="true"]{display:flex;align-items:center;gap:10px}

/* Hero capacity card */
.hero{position:relative;overflow:hidden;border:2px solid var(--color-ink);border-radius:var(--radius-chunk);background:var(--color-paper);padding:22px;box-shadow:0 6px 0 var(--color-ink);display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:20px;align-items:center}
.hero::before{content:"";position:absolute;top:0;left:0;right:0;height:6px;background:var(--color-mint)}
[data-level="low"] .hero::before{background:var(--color-accent)}
[data-level="full"] .hero::before{background:var(--color-accent-3)}
.kicker{font:800 0.72rem/1 var(--font-mono);text-transform:uppercase;letter-spacing:0.08em;color:var(--color-ink-2);margin:0 0 6px}
.hero-num-row{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.num{font-size:clamp(3.2rem,6vw,4.6rem);font-weight:800;line-height:.95;letter-spacing:-0.04em;font-variant-numeric:tabular-nums}
.of{color:var(--color-ink-2);font-size:1.05rem;font-weight:600}
.state{margin:8px 0 14px;font-weight:700;font-size:0.98rem;color:var(--color-ink)}
.bar{height:14px;border-radius:var(--radius-pill);background:var(--color-paper-3);border:1.5px solid var(--color-ink);overflow:hidden}
.bar i{display:block;height:100%;width:0;border-radius:var(--radius-pill);background:var(--color-success);transition:width .5s var(--ease-out)}
[data-level="low"] .bar i{background:var(--color-warn)}
[data-level="full"] .bar i{background:var(--color-error)}
.hero-side{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.mini{border:1.5px solid var(--color-rule-2);border-radius:16px;padding:12px 13px;background:var(--color-paper-2);display:grid;gap:3px;align-content:start}
.mini b{font-size:1.45rem;font-weight:800;line-height:1.05;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}
.mini span{font-size:0.78rem;color:var(--color-ink-2);font-weight:600}

/* Telemetry strip */
.bento{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.card{border:2px solid var(--color-rule-2);border-radius:var(--radius-card);padding:15px 16px;background:var(--color-paper);min-width:0}
.card--ink{border-color:var(--color-ink);box-shadow:0 4px 0 var(--color-ink-cast)}
.card--mint{border-color:var(--color-ink);background:linear-gradient(180deg,var(--color-mint-tint) 0%,var(--color-paper) 56%);box-shadow:0 4px 0 var(--color-ink-cast)}
.card--lav{border-color:var(--color-ink);background:linear-gradient(180deg,var(--color-lavender-tint) 0%,var(--color-paper) 70%);box-shadow:0 4px 0 var(--color-ink-cast)}
.card--sky{border-color:var(--color-rule-2);background:var(--color-paper-2)}
.card__label{display:block;font:800 0.7rem/1.1 var(--font-mono);text-transform:uppercase;letter-spacing:0.06em;color:var(--color-ink-2);margin-bottom:6px}
.card b.val{display:block;font-size:1.2rem;font-weight:800;line-height:1.25;letter-spacing:-0.015em;font-variant-numeric:tabular-nums;word-break:break-word}
.card .hint{display:block;margin-top:4px;color:var(--color-ink-2);font-size:0.82rem;line-height:1.4}
.card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.card-head h2{margin:0;font-size:1.1rem;font-weight:800;letter-spacing:-0.015em}
.note{margin:4px 0 0;color:var(--color-ink-2);font-size:0.85rem;line-height:1.45}

/* Euler panel */
.euler-bar{height:10px;border-radius:var(--radius-pill);background:var(--color-paper-3);border:1.5px solid var(--color-ink);overflow:hidden;margin:10px 0 12px}
.euler-bar i{display:block;height:100%;width:0;background:var(--color-success);transition:width .4s var(--ease-out)}
.euler-bar[data-level="low"] i{background:var(--color-warn)}
.euler-bar[data-level="full"] i{background:var(--color-error)}
.euler-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:10px 0 12px}
.metric{border:1.5px solid var(--color-rule-2);border-radius:14px;padding:11px 13px;background:var(--color-paper);display:grid;gap:2px}
.metric b{font-size:1.15rem;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-0.015em}
.metric span{font-size:0.78rem;color:var(--color-ink-2)}

/* Buttons & Inputs (Hallmark tactile) */
button{font:700 0.86rem/1 var(--font-body);color:var(--color-ink);border:2px solid var(--color-ink);border-radius:var(--radius-pill);background:var(--color-accent);padding:10px 16px;min-height:40px;cursor:pointer;box-shadow:0 3px 0 var(--color-ink);transition:transform 110ms var(--ease-out),box-shadow 110ms var(--ease-out),background 120ms}
button:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 0 var(--color-ink)}
button:active:not(:disabled){transform:translateY(2px);box-shadow:0 1px 0 var(--color-ink)}
button:disabled{opacity:.48;cursor:not-allowed;box-shadow:none}
button.btn-soft{background:var(--color-paper)}
button.btn-coral{background:var(--color-accent-3-tint);color:var(--color-error)}
button:focus-visible,input:focus-visible{outline:3px solid var(--color-focus);outline-offset:2px}
input[type=number],input[type=password],input[type=search]{font:inherit;font-size:0.92rem;color:var(--color-ink);background:var(--color-paper);border:2px solid var(--color-ink);border-radius:12px;padding:8px 12px;min-height:40px}
input[type=number]{width:5.2rem;text-align:center;font-family:var(--font-mono);font-weight:700}
.ownrow{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
.ownrow input{flex:1 1 13rem;min-width:0}

/* Who is connected table + filters */
.dev{display:none}.dev[data-on="true"]{display:block}
.who-tools{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:10px 0 12px}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{min-height:32px;padding:6px 12px;font-size:0.78rem;font-weight:800;border-width:1.5px;background:var(--color-paper-2);box-shadow:none}
.chip:hover:not(:disabled){transform:none;box-shadow:none;background:var(--color-paper-3)}
.chip[data-on="true"]{background:var(--color-ink);color:var(--color-paper);border-color:var(--color-ink)}
.who-search{flex:0 1 14rem;min-height:34px;padding:6px 12px;font-size:0.84rem;border-width:1.5px}
.wrap{overflow-x:auto;border:1.5px solid var(--color-rule);border-radius:14px;background:var(--color-paper)}
table{border-collapse:collapse;width:100%;font-size:0.88rem}
thead th{text-align:left;background:var(--color-paper-2);color:var(--color-ink-2);font:800 0.7rem/1.2 var(--font-mono);text-transform:uppercase;letter-spacing:0.06em;padding:10px 12px;border-bottom:2px solid var(--color-ink);white-space:nowrap}
tbody td{padding:11px 12px;border-bottom:1px solid var(--color-rule);vertical-align:top}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover{background:var(--color-paper-2)}
td.num-col{font-family:var(--font-mono);font-variant-numeric:tabular-nums;white-space:nowrap}
td a{font-weight:800;color:var(--color-ink);text-decoration:none;border-bottom:1.5px solid var(--color-accent-2)}
td a:hover{color:var(--color-accent-2)}
.pill{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:var(--radius-pill);border:1.5px solid var(--color-ink);font-weight:800;font-size:0.76rem;line-height:1.2;white-space:nowrap}
.pill[data-s="live"]{background:var(--color-accent)}
.pill[data-s="live"]::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--color-success)}
.pill[data-s="wait"]{background:var(--color-paper-2);border-color:var(--color-rule-2);color:var(--color-ink)}
.pill[data-s="err"]{background:var(--color-accent-3-tint);border-color:var(--color-error);color:var(--color-error)}
.pill[data-s="gone"]{background:transparent;border-style:dashed;border-color:var(--color-rule-2);color:var(--color-ink-2)}
.st-sub{margin-top:4px;font-size:0.76rem;line-height:1.35;color:var(--color-ink-2);max-width:290px;word-break:break-word}
.st-sub[data-err="true"]{color:var(--color-error);font-weight:700}

/* Bottom dock (Alarm + Owner/Device) */
.dock{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start}
.dock-stack{display:grid;gap:14px}
.alarm{border:2px dashed var(--color-rule-2);border-radius:var(--radius-card);padding:16px;background:var(--color-paper-2)}
.alarm label{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-weight:700;font-size:0.9rem}
.who-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:10px}
.q-pill{display:inline-flex;align-items:center;padding:4px 10px;border-radius:var(--radius-pill);border:1.5px solid var(--color-ink);font:800 0.72rem/1 var(--font-mono);background:var(--color-paper)}
.q-pill[data-state="active"]{background:var(--color-mint-tint);color:var(--color-success);border-color:var(--color-success)}
.q-pill[data-state="reserved"],.q-pill[data-state="exhausted"]{background:var(--color-accent-3-tint);color:var(--color-error);border-color:var(--color-error)}

@media(max-width:860px){
  .hero{grid-template-columns:1fr}
  .bento,.euler-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .dock{grid-template-columns:1fr}
}
@media(max-width:520px){
  .hero-side{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
  .mini{padding:9px 10px}.mini b{font-size:1.15rem}
  .bento,.euler-grid{grid-template-columns:1fr}
  .who-search{flex:1 1 100%;width:100%}
}
@media(prefers-reduced-motion:reduce){
  .frilly,.dot{animation:none}
  *{transition:none!important}
}
</style></head>
<body><main data-level="${esc(s.level)}" id="app">
<header class="topbar">
  <div class="brand">
    <svg class="frilly" viewBox="0 0 120 120" width="46" height="46" aria-hidden="true" focusable="false"><path d="M26 78 19 101 47 80Z" fill="var(--color-accent)" stroke="var(--color-ink)" stroke-width="3.4" stroke-linejoin="round"/><path d="M40 12H80A28 28 0 0 1 108 40V74A8 8 0 0 1 92 74A8 8 0 0 1 76 74A8 8 0 0 1 60 74A8 8 0 0 1 44 74A8 8 0 0 1 28 74A8 8 0 0 1 12 74V40A28 28 0 0 1 40 12Z" fill="var(--color-accent)" stroke="var(--color-ink)" stroke-width="3.4" stroke-linejoin="round"/><path d="M24 66H96" fill="none" stroke="var(--color-accent-deep)" stroke-width="2.4" stroke-dasharray="4 5" stroke-linecap="round"/><circle cx="46" cy="44" r="5.2" fill="var(--color-ink)"/><circle cx="74" cy="44" r="5.2" fill="var(--color-ink)"/><circle cx="47.9" cy="42.1" r="1.7" fill="var(--color-paper)"/><circle cx="75.9" cy="42.1" r="1.7" fill="var(--color-paper)"/><ellipse cx="34" cy="56" rx="7" ry="4.2" fill="var(--color-accent-3)" opacity="0.7"/><ellipse cx="86" cy="56" rx="7" ry="4.2" fill="var(--color-accent-3)" opacity="0.7"/><path d="M53 55q7 7 14 0" fill="none" stroke="var(--color-ink)" stroke-width="3" stroke-linecap="round"/></svg>
    <div>
      <h1>Frills relay <span class="ver">v${esc(s.version)}</span></h1>
      <p class="sub" id="sub">Version ${esc(s.version)}. Refreshes every 5 seconds automatically.</p>
    </div>
  </div>
  <span class="live-badge"><i class="dot" aria-hidden="true"></i><span id="pulse-text">Live · 5s poll</span></span>
</header>

<div class="banner" id="banner" role="alert"></div>

<section class="hero" id="big">
  <div>
    <p class="kicker">Live Relay Capacity</p>
    <div class="hero-num-row"><span class="num" id="free">${esc(s.free)}</span><span class="of" id="of">free spots of ${esc(s.slots.max)}</span></div>
    <p class="state" id="state"></p>
    <div class="bar" aria-hidden="true"><i id="fill"></i></div>
  </div>
  <div class="hero-side">
    <div class="mini"><b id="used">${esc(s.slots.used)}</b><span>spots in use</span></div>
    <div class="mini"><b id="waiting">${esc(s.slots.waiting)}</b><span>waiting in line</span></div>
    <div class="mini"><b id="up">${esc(span(s.uptimeS))}</b><span>running for</span></div>
  </div>
</section>

<section class="bento" aria-label="Live relay metrics">
  <div class="card"><span class="card__label">Signing Service</span><b class="val" id="signing">-</b><span class="hint" id="signingnote">Euler single-account handshake</span></div>
  <div class="card"><span class="card__label">Pages Open</span><b class="val" id="streams">-</b><span class="hint">pages open right now</span></div>
  <div class="card"><span class="card__label">Rate Guard</span><b class="val" id="away">-</b><span class="hint" id="awaynote">pages turned away</span></div>
  <div class="card card--sky"><span class="card__label">Hardware Headroom</span><b class="val" id="cap">-</b><span class="hint" id="capnote"></span></div>
</section>

<section class="card card--mint" id="euler" hidden>
  <div class="card-head">
    <div>
      <span class="card__label">Single Account · 1,500/day</span>
      <h2>Euler Signing Quota &amp; Leak Shield</h2>
      <p class="note" id="eulernote"></p>
    </div>
    <span class="q-pill" id="euler-pill" data-state="active">ACTIVE</span>
  </div>
  <div class="euler-bar" id="euler-bar" data-level="ok" aria-hidden="true"><i id="euler-fill"></i></div>
  <div class="euler-grid" id="eulergrid"></div>
  <div class="ownrow" id="eulerctl" hidden>
    <button id="euler-sync" type="button">Sync live Euler quota</button>
    <button class="btn-soft" id="euler-refill" type="button">Reset local counter</button>
  </div>
  <p class="note" id="eulermsg" role="status"></p>
</section>

<section class="card card--ink who dev" id="who">
  <div class="card-head">
    <div>
      <span class="card__label">Owner Live Roster</span>
      <h2>Who is connected</h2>
      <p class="note" id="whonote"></p>
    </div>
  </div>
  <div class="who-tools">
    <div class="chips" id="whofilters" role="group" aria-label="Filter connected accounts">
      <button class="chip" type="button" data-filter="all" data-on="true">All</button>
      <button class="chip" type="button" data-filter="live">LIVE</button>
      <button class="chip" type="button" data-filter="wait">Waiting</button>
      <button class="chip" type="button" data-filter="err">Errors</button>
    </div>
    <input class="who-search" type="search" id="whosearch" placeholder="Filter @handle…" aria-label="Filter accounts by handle" spellcheck="false">
  </div>
  <div class="wrap"><table id="whotable"><thead><tr><th>Account</th><th>Status</th><th>Pages</th><th>Followers</th><th>Here for</th><th>Last minute</th></tr></thead><tbody id="whobody"></tbody></table></div>
  <div class="who-foot">
    <p class="note" id="waitnote"></p>
    <button class="btn-soft" id="ownout" type="button" hidden>Hide the names again</button>
  </div>
</section>

<div class="dock">
  <section class="alarm">
    <span class="card__label">Low-Spot Alarm</span>
    <label>Warn me when <input type="number" id="at" min="0" max="500" value="${esc(s.alertAt)}"> or fewer spots are left <button id="allow" type="button">Turn on notifications</button></label>
    <p class="note" id="allownote">The warning also shows here as a red bar, and plays a short sound. Keep this page open to get it. Your phone can warn you by itself too (Termux notification), see the guide.</p>
  </section>

  <div class="dock-stack">
    <section class="card dev" id="dev"><span class="card__label">Host Hardware</span><b class="val">This device</b><span class="hint mono" id="devtext"></span></section>
    <section class="card card--lav" id="own" hidden>
      <span class="card__label">Owner Access</span>
      <b class="val">Owner?</b>
      <p class="note">Enter the relay password to see who is connected and to restart the relay. It stays in this tab only.</p>
      <div class="ownrow"><input type="password" id="ownkey" autocomplete="current-password" spellcheck="false" aria-label="Relay password"> <button id="ownsave" type="button">Sign in</button></div>
      <p class="note" id="ownmsg" role="status"></p>
    </section>
    <section class="card card--lav" id="ctl" hidden>
      <span class="card__label">Process Control</span>
      <b class="val">Restart</b>
      <p class="note">Stops the relay and starts it again. Everyone's chat reconnects by itself in a few seconds.</p>
      <div class="ownrow"><button class="btn-coral" id="restart" type="button">Restart the relay</button></div>
      <p class="note" id="ctlmsg" role="status"></p>
    </section>
  </div>
</div>
</main>
<script>
const $=(id)=>document.getElementById(id);let last="ok",first=true,rosterFilter="all",rosterQuery="",lastRoster=null;
const asText=(s)=>{const h=Math.floor(s/3600),m=Math.floor(s%3600/60);return h?h+" h "+m+" min":m+" min"};
let OWNER="";try{OWNER=sessionStorage.getItem("frills:relay:owner")||""}catch{}
const keep=(v)=>{OWNER=v;try{v?sessionStorage.setItem("frills:relay:owner",v):sessionStorage.removeItem("frills:relay:owner")}catch{}};
const AT=localStorage.getItem("frills:relay:at");if(AT!==null)$("at").value=AT;
$("at").addEventListener("input",()=>localStorage.setItem("frills:relay:at",$("at").value));
$("allow").addEventListener("click",async()=>{try{const r=await Notification.requestPermission();$("allownote").textContent=r==="granted"?"Notifications are on. You will get one when spots run low.":"Notifications are blocked in this browser. The red bar and the sound still work."}catch{$("allownote").textContent="This browser cannot send notifications. The red bar and the sound still work."}});
let ctx;const beep=()=>{try{ctx=ctx||new AudioContext();const o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=880;g.gain.setValueAtTime(.2,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.5);o.start();o.stop(ctx.currentTime+.5)}catch{}};
const cell=(tr,text,cls)=>{const td=document.createElement("td");if(cls)td.className=cls;td.textContent=text;tr.append(td);return td};
const forText=(n)=>n<90?n+" s":n<5400?Math.round(n/60)+" min":Math.floor(n/3600)+" h "+Math.round(n%3600/60)+" min";
function bucketOf(a){return a.pages===0?"gone":a.state==="connected"&&a.live?"live":(a.state==="error"||a.state==="limited")?"err":"wait"}
function drawWho(r){
  lastRoster=r;
  $("who").dataset.on="true";
  const body=$("whobody");body.replaceChildren();
  const q=rosterQuery.trim().toLowerCase().replace(/^@/,"");
  const rows=r.accounts.filter((a)=>{
    if(q&&!a.user.toLowerCase().includes(q))return false;
    if(rosterFilter==="all")return true;
    return bucketOf(a)===rosterFilter;
  });
  for(const a of rows){
    const tr=document.createElement("tr"),td=document.createElement("td"),link=document.createElement("a");
    link.textContent="@"+a.user;link.href="https://www.tiktok.com/@"+encodeURIComponent(a.user)+"/live";link.target="_blank";link.rel="noopener noreferrer";td.append(link);tr.append(td);
    const took = typeof a.connectMs === "number" ? "Connected in " + (a.connectMs / 1000).toFixed(1) + " s" : "";
    const retry = typeof a.retryInS === "number" ? "Next check in " + forText(a.retryInS) : "";
    const st=a.pages===0?["No page open"+(a.live?" (still LIVE)":"")+", leaves in "+forText(a.leavesInS||0),"gone",""]
      :a.state==="connected"?(a.live?["LIVE now","live",took]:["Connected, not LIVE yet","wait",took])
      :a.state==="offline"?[a.endedS!=null?"LIVE ended "+forText(a.endedS)+" ago, waiting":"Waiting for their LIVE","wait",[retry,a.detail&&/stopped looking|Looking again/.test(a.detail)?a.detail:""].filter(Boolean).join(" · ")]
      :a.state==="limited"?["Rate limited / paused","err",[a.lastError||a.detail||"Waiting for signing quota or cooldown",retry].filter(Boolean).join(" · ")]
      :a.state==="error"?["Error","err",[a.lastError||a.detail||"Could not connect to TikTok",retry].filter(Boolean).join(" · ")]
      :[a.state,"wait",[a.detail||"",retry].filter(Boolean).join(" · ")];
    const sc=document.createElement("td"),pill=document.createElement("span");pill.className="pill";pill.dataset.s=st[1];pill.textContent=st[0];sc.append(pill);
    if(st[2]){const sub=document.createElement("div");sub.className="st-sub";if(st[1]==="err")sub.dataset.err="true";sub.textContent=st[2];sc.append(sub);}
    tr.append(sc);
    cell(tr,String(a.pages),"num-col");cell(tr,a.followers?a.followers.toLocaleString():"-","num-col");cell(tr,forText(a.forS),"num-col");
    cell(tr,a.counts.chat+" chat, "+a.counts.gift+" gifts, "+a.counts.follow+" follows, "+a.counts.share+" shares"+(a.lastS==null?" · nothing yet":" · last "+forText(a.lastS)+" ago"));
    body.append(tr);
  }
  const gone=r.accounts.filter((a)=>a.pages===0).length,live=r.accounts.filter((a)=>a.pages>0&&a.state==="connected"&&a.live).length,errored=r.accounts.filter((a)=>a.pages>0&&(a.state==="error"||a.state==="limited")).length,wait=r.accounts.length-gone-live-errored;
  for(const btn of $("whofilters").querySelectorAll("button")){
    const f=btn.dataset.filter;
    btn.dataset.on=String(f===rosterFilter);
    btn.textContent=f==="all"?"All ("+r.accounts.length+")":f==="live"?"LIVE ("+live+")":f==="wait"?"Waiting ("+wait+")":"Errors ("+errored+")";
  }
  $("whotable").hidden=rows.length===0;
  $("whonote").textContent=r.accounts.length?r.accounts.length+" on the list: "+live+" LIVE now, "+wait+" waiting for a LIVE"+(errored?", "+errored+" with error/limit":"")+", "+gone+" with no page open. Press a name to open their LIVE on TikTok.":"Nobody is connected right now.";
  $("waitnote").textContent=r.waiting.length?"In line: "+r.waiting.map((u)=>"@"+u).join(", "):"";
}
$("whofilters").addEventListener("click",(e)=>{const b=e.target.closest("button[data-filter]");if(!b)return;rosterFilter=b.dataset.filter;if(lastRoster)drawWho(lastRoster)});
$("whosearch").addEventListener("input",(e)=>{rosterQuery=e.target.value;if(lastRoster)drawWho(lastRoster)});
function draw(s){
  const at=Math.max(0,Number($("at").value)||0),free=s.free,low=free<=at||s.slots.waiting>0;
  $("app").dataset.level=free===0?"full":low?"low":"ok";
  $("free").textContent=free;$("of").textContent="free spots of "+s.slots.max;$("waiting").textContent=s.slots.waiting;$("used").textContent=s.slots.used;$("up").textContent=asText(s.uptimeS);
  $("fill").style.width=Math.min(100,100*s.slots.used/Math.max(1,s.slots.max))+"%";
  $("state").textContent=s.slots.waiting>0?s.slots.waiting+" "+(s.slots.waiting===1?"person is":"people are")+" waiting for a spot":free===0?"Full: nobody else fits":low?"Getting full: "+free+" left":"Plenty of room";
  const q = s.signing.quota;
  $("signing").textContent=(s.signing.busy?"Busy right now":s.signing.busyRecently?"OK (busy "+s.signing.busyRecently+"x)":"OK")+(s.signing.key===undefined?"":s.signing.key?" · own key":" · shared");
  const sigParts=[];
  if(q)sigParts.push(q.state==="active"?q.available.toLocaleString()+"/"+q.cap.toLocaleString()+" left today":"Quota paused ("+q.state.toUpperCase()+")");
  if(s.signing.connectsDay!==undefined)sigParts.push(s.signing.connectsDay+" connects in 24 h");
  $("signingnote").textContent=sigParts.length?sigParts.join(" · "):"Euler single-account handshake";
  if(q){
    $("euler").hidden=false;
    const remote=q.remote&&q.remote.ok&&q.remote.day?"Euler live: "+q.remote.day.remaining.toLocaleString()+" / "+q.remote.day.max.toLocaleString()+" day"+(q.remote.hour?" · "+q.remote.hour.remaining+"/"+q.remote.hour.max+" hr":""):"Press Sync live Euler quota to read Euler directly";
    $("eulernote").textContent=remote+(q.reserve?" · "+q.reserve+" reserved for Plus":"");
    const ep=$("euler-pill");ep.dataset.state=q.state;ep.textContent=q.state.toUpperCase();
    const pct=q.cap>0?Math.min(100,Math.round(100*(q.cap-q.available)/q.cap)):0;
    $("euler-fill").style.width=Math.max(2,pct)+"%";
    $("euler-bar").dataset.level=pct>=90||q.state!=="active"?"full":pct>=70?"low":"ok";
    const g=$("eulergrid");g.replaceChildren();
    const m=q.metrics||{};
    const cells=[
      [q.available.toLocaleString()+" / "+q.cap.toLocaleString(),"daily budget left ("+q.used+" used)"],
      [(m.offlineSaved||0).toLocaleString(),"offline checks saved (0 Euler)"],
      [(m.liveConnects||0)+" live · "+(m.reconnects||0)+" reconn","signed WebSocket connects"],
      [(m.roomIdCacheHits||0)+" cache · "+(m.budgetBlocked||0)+" guarded","roomId cache · budget pauses"],
    ];
    for(const [val,lbl] of cells){
      const box=document.createElement("div");box.className="metric";
      const b=document.createElement("b");b.textContent=val;
      const sp=document.createElement("span");sp.textContent=lbl;
      box.append(b,sp);g.append(box);
    }
    $("eulerctl").hidden=!(s.actions||s.device);
  }else{$("euler").hidden=true}
  if(s.streams){const t=s.streams;$("streams").textContent=t.open;$("away").textContent=t.turnedAway;$("awaynote").textContent="pages turned away since start"+(t.lastTurnedAwayS===null?"":" (last "+forText(t.lastTurnedAwayS)+" ago)")+" · limit "+t.limit+"/IP"+(t.replaced?" · "+t.replaced+" replaced":"")}
  const c=s.capacity;$("cap").textContent="About "+c.estimate+" accounts";$("capnote").textContent=(c.measured?"Measured from current load.":"Initial estimate; sharpens as rooms open.")+(c.estimate>s.slots.max*1.5?" Room to raise above "+s.slots.max+" spots.":"");
  const b=$("banner");b.dataset.on=String(low);b.textContent=s.slots.waiting>0?"People are waiting in line. Only "+free+" spots left.":free===0?"The relay is full.":"Only "+free+" spots left.";
  $("own").hidden=!s.ownerLogin;$("ownout").hidden=!(s.roster&&OWNER);
  $("ctl").hidden=!(s.actions||s.device);
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
  if(s.device){$("dev").dataset.on="true";const d=s.device;$("devtext").textContent=d.cores+(d.cores===1?" core · ":" cores · ")+d.memoryFreeMB+" / "+d.memoryTotalMB+" MB free · relay "+d.relayMemoryMB+" MB & "+d.relayCpuPercent+"% CPU · Node "+d.node}
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
  $("eulermsg").textContent="Updating Euler quota...";
  try{
    const r=await fetch("/owner/euler",{method:"POST",headers:{"content-type":"application/json",...(OWNER?{authorization:"Bearer "+OWNER}:{})},body:JSON.stringify({action}),cache:"no-store"});
    const j=await r.json().catch(()=>({}));
    if(r.ok){$("eulermsg").textContent="Updated Euler quota ("+action+").";tick()}
    else{$("eulermsg").textContent="Action failed ("+(j.error||r.status)+")."}
  }catch{$("eulermsg").textContent="Cannot reach the relay right now."}
}
$("euler-refill").addEventListener("click",()=>eulerAction("refill"));
$("euler-sync").addEventListener("click",()=>eulerAction("sync"));
draw(${JSON.stringify(s).replace(/</g, "\\u003c")});setInterval(tick,5000);if(OWNER)tick();
</script></body></html>`;
}
