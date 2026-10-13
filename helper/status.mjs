// What the relay says about itself: the numbers (free spots, people waiting, whether the free signing service is busy, a guess of how many
// accounts this device could hold) and the page a person sees when they open the relay's address in a browser. Pure functions, so they are
// tested without a server. Nothing here names an account: only counts.

import os from "node:os";

export const ALERT_AT = 10; // "this many spots left or fewer" raises the alarm

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

/** Keeps a short record of when the free signing service said "busy", so "busy right now" has a meaning. */
export class Signing {
  constructor(now = () => Date.now()) { this.now = now; this.times = []; }
  note() { this.times.push(this.now()); if (this.times.length > 200) this.times.shift(); }
  recent(windowMs = 10 * 60 * 1000) { const from = this.now() - windowMs; return this.times.filter((t) => t >= from).length; }
}

/** Everything the page and the alerts need. `device` (processor, memory) is added only for someone on the device itself. */
export function snapshot({ stats, startedAt, now, version, features, signing, estimate, alertAt = ALERT_AT, device = null, roster = null, ownerLogin = false }) {
  const free = Math.max(0, stats.max - stats.used);
  return {
    ok: true, name: "frills-relay", version, features, slots: stats,
    free, level: level(stats, alertAt), alertAt, uptimeS: Math.max(0, Math.round((now - startedAt) / 1000)),
    signing: { busyRecently: signing.recent(), busy: signing.recent(2 * 60 * 1000) > 0 },
    capacity: estimate,
    ...(device ? { device } : {}),
    ...(roster ? { roster } : {}), // the names: only for the owner (on the device, or with the owner's password), like `device`
    ...(ownerLogin ? { ownerLogin: true } : {}), // says only that an owner password exists, so the page can offer the box for it
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
td a{font-weight:700;color:var(--ink)}.pill{display:inline-block;padding:2px 10px;border-radius:99px;border:2px solid var(--ink);font-weight:700;font-size:.8rem;white-space:nowrap}.pill[data-s="live"]{background:#ffd23f}.pill[data-s="wait"]{background:var(--paper2)}
</style></head>
<body><main data-level="${esc(s.level)}" id="app">
<div class="banner" id="banner" role="alert"></div>
<h1>Frills relay</h1><p class="sub" id="sub">Version ${esc(s.version)}. This page refreshes by itself.</p>
<section class="big" id="big"><div><span class="num" id="free">${esc(s.free)}</span> <span class="of" id="of">free spots of ${esc(s.slots.max)}</span></div>
<p class="state" id="state"></p><div class="bar"><i id="fill"></i></div></section>
<div class="grid">
<div class="card"><b id="waiting">${esc(s.slots.waiting)}</b><span>waiting in line</span></div>
<div class="card"><b id="used">${esc(s.slots.used)}</b><span>accounts connected</span></div>
<div class="card"><b id="up">${esc(span(s.uptimeS))}</b><span>running for</span></div>
<div class="card"><b id="signing">-</b><span>free signing service</span></div>
</div>
<div class="card"><b id="cap">-</b><span id="capnote"></span></div>
<section class="alarm"><label>Warn me when <input type="number" id="at" min="0" max="500" value="${esc(s.alertAt)}"> or fewer spots are left <button id="allow" type="button">Turn on notifications</button></label>
<p class="note" id="allownote">The warning also shows here as a red bar, and plays a short sound. Keep this page open to get it. Your phone can warn you by itself too (Termux notification), see the guide.</p></section>
<section class="card dev" id="dev"><b>This device</b><span id="devtext"></span></section>
<section class="card own" id="own" hidden><b>Owner?</b> <span class="note">Enter the relay password to see who is connected. It stays in this tab only.</span>
<div class="ownrow"><input type="password" id="ownkey" autocomplete="current-password" spellcheck="false" aria-label="Relay password"> <button id="ownsave" type="button">Show who is connected</button></div><p class="note" id="ownmsg" role="status"></p></section>
<section class="card who dev" id="who"><h2>Who is connected</h2><span class="note" id="whonote"></span>
<div class="wrap"><table id="whotable"><thead><tr><th>Account</th><th>Status</th><th>Pages</th><th>Followers</th><th>Here for</th><th>Seen so far</th></tr></thead><tbody id="whobody"></tbody></table></div>
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
    const st=a.state==="connected"?(a.live?["LIVE now","live"]:["Connected, not LIVE yet","wait"]):a.state==="offline"?["Waiting for their LIVE","wait"]:a.state==="limited"?["Waiting (TikTok is busy)","wait"]:[a.state,"wait"];
    const sc=document.createElement("td"),pill=document.createElement("span");pill.className="pill";pill.dataset.s=st[1];pill.textContent=st[0];sc.append(pill);tr.append(sc);
    cell(tr,String(a.pages));cell(tr,a.followers?a.followers.toLocaleString():"-");cell(tr,forText(a.forS));
    cell(tr,a.counts.chat+" chat, "+a.counts.gift+" gifts, "+a.counts.follow+" follows, "+a.counts.share+" shares");
    body.append(tr);
  }
  const live=r.accounts.filter((a)=>a.live).length;
  $("whotable").hidden=r.accounts.length===0;
  $("whonote").textContent=r.accounts.length?r.accounts.length+" connected, "+live+" LIVE right now. Press a name to open their LIVE on TikTok.":"Nobody is connected right now.";
  $("waitnote").textContent=r.waiting.length?"In line: "+r.waiting.map((u)=>"@"+u).join(", "):"";
}
function draw(s){
  const at=Math.max(0,Number($("at").value)||0),free=s.free,low=free<=at||s.slots.waiting>0;
  $("app").dataset.level=free===0?"full":low?"low":"ok";
  $("free").textContent=free;$("of").textContent="free spots of "+s.slots.max;$("waiting").textContent=s.slots.waiting;$("used").textContent=s.slots.used;$("up").textContent=asText(s.uptimeS);
  $("fill").style.width=Math.min(100,100*s.slots.used/Math.max(1,s.slots.max))+"%";
  $("state").textContent=s.slots.waiting>0?s.slots.waiting+" "+(s.slots.waiting===1?"person is":"people are")+" waiting for a spot":free===0?"Full: nobody else fits":low?"Getting full: "+free+" left":"Plenty of room";
  $("signing").textContent=s.signing.busy?"Busy right now":s.signing.busyRecently?"OK (busy "+s.signing.busyRecently+"x lately)":"OK";
  const c=s.capacity;$("cap").textContent="About "+c.estimate+" accounts";$("capnote").textContent=(c.measured?"A guess from what this device uses now.":"A first guess; it improves once a few accounts are open.")+" Your internet and TikTok's free signing usually run out before the device does."+(c.estimate>s.slots.max*1.5?" You set "+s.slots.max+" spots, so there may be room to raise it.":"");
  const b=$("banner");b.dataset.on=String(low);b.textContent=s.slots.waiting>0?"People are waiting in line. Only "+free+" spots left.":free===0?"The relay is full.":"Only "+free+" spots left.";
  $("own").hidden=!s.ownerLogin;$("ownout").hidden=!(s.roster&&OWNER);
  if(s.roster){drawWho(s.roster)}else{$("who").dataset.on="false"}
  if(s.device){$("dev").dataset.on="true";const d=s.device;$("devtext").textContent=d.cores+" processor cores. Memory: "+d.memoryFreeMB+" MB free of "+d.memoryTotalMB+" MB. The relay itself uses "+d.relayMemoryMB+" MB and about "+d.relayCpuPercent+"% of one core. Node "+d.node+"."}
  if(low&&last==="ok"&&!first){beep();try{if(Notification.permission==="granted")new Notification("Frills relay",{body:b.textContent})}catch{}}
  last=low?"low":"ok";first=false;document.title="Frills relay: "+free+" spots free";
}
async function tick(){try{
  const r=await fetch(location.pathname,{headers:{accept:"application/json",...(OWNER?{authorization:"Bearer "+OWNER}:{})},cache:"no-store"});
  if(r.status===401){keep("");$("ownmsg").textContent="That is not the right password.";return tick()}
  if(r.status===429){keep("");$("ownmsg").textContent="Too many wrong tries. Wait ten minutes and try again.";return}
  draw(await r.json())}catch{$("state").textContent="Cannot reach the relay right now."}}
$("ownsave").addEventListener("click",()=>{const v=$("ownkey").value.trim();if(!v)return;keep(v);$("ownkey").value="";$("ownmsg").textContent="";tick()});
$("ownkey").addEventListener("keydown",(e)=>{if(e.key==="Enter")$("ownsave").click()});
$("ownout").addEventListener("click",()=>{keep("");tick()});
draw(${JSON.stringify(s).replace(/</g, "\\u003c")});setInterval(tick,5000);if(OWNER)tick();
</script></body></html>`;
}
