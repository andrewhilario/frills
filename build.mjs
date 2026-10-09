// Builds the whole site into dist/:  node build.mjs
//   1. bundles the scripts and styles (esbuild), with a content hash in each file name so they can be cached for a year
//   2. renders each page from src/pages with the shared nav, footer and layout
//   3. measures the overlay page, so the numbers on the site are the real ones
//   4. writes sitemap.xml, robots.txt and the security headers
// The site is plain static files: there is no server and no database behind it.

import { build as esbuild } from "esbuild";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { site, checkSite } from "./src/site.mjs";
import { CONTROLS, PRESETS, PRESET_NAMES } from "./src/js/settings.js";
import { faq } from "./src/faq.mjs";
import { tokenHex } from "./scripts/tokens.mjs";

const root = import.meta.dirname;
const dist = process.env.OUT_DIR ? resolve(process.env.OUT_DIR) : join(root, "dist"); // OUT_DIR lets a test build a variant on the side
const src = join(root, "src");
const started = Date.now();
// The social share image is drawn from a page that only exists when scripts/make-assets.mjs asks for it.
const withOgCard = Boolean(process.env.OG_CARD);

const problems = checkSite();
if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const read = (path) => readFileSync(path, "utf8");
const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const gz = (data) => gzipSync(data, { level: 9 }).length;
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

/** A tiny template language: {{>partial}}, {{{raw}}}, {{escaped}}. A name that isn't known is a mistake, so the build stops. */
function render(template, vars, partials, where) {
  const get = (key) => {
    const value = key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), vars);
    if (value === undefined) throw new Error(`${where}: the template uses {{${key}}} but nothing provides it`);
    return String(value);
  };
  return template
    .replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) => {
      if (!(name in partials)) throw new Error(`${where}: there is no partial called ${name}`);
      return render(partials[name].trimEnd(), vars, partials, `${where} > ${name}`);
    })
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, key) => get(key))
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => esc(get(key)));
}

// ── 1. Scripts and styles ─────────────────────────────────────────────────────────────────────────────────────────────
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
if (existsSync(join(root, "public"))) cpSync(join(root, "public"), dist, { recursive: true });

const common = { absWorkingDir: root, bundle: true, minify: true, metafile: true, logLevel: "warning", outdir: join(dist, "assets"), entryNames: "[name]-[hash]", target: ["chrome100", "firefox100", "safari15"] };
const jsEntries = { home: "src/js/home.js", editor: "src/js/editor.js", overlay: "src/js/overlay.js", matcha: "src/js/matcha-page.js", page: "src/js/page.js", feedback: "src/js/feedback.js", ...(withOgCard && { og: "src/js/og.js" }) };
const cssEntries = { home: "src/css/entry/home.css", page: "src/css/entry/page.css", editor: "src/css/entry/editor.css", matcha: "src/css/entry/matcha.css", overlay: "src/css/entry/overlay.css", ...(withOgCard && { og: "src/css/entry/og.css" }) };
const jsBuild = await esbuild({ ...common, entryPoints: jsEntries, format: "iife", legalComments: "none" });
const cssBuild = await esbuild({ ...common, entryPoints: cssEntries, external: ["/fonts/*"], legalComments: "inline" });

const assets = { js: {}, css: {} };
for (const [kind, entries, result] of [["js", jsEntries, jsBuild], ["css", cssEntries, cssBuild]]) {
  for (const [file, info] of Object.entries(result.metafile.outputs)) {
    if (!info.entryPoint) continue;
    const key = Object.keys(entries).find((k) => entries[k] === info.entryPoint);
    assets[kind][key] = "/" + relative(dist, resolve(root, file)).replace(/\\/g, "/");
  }
}
const assetFile = (url) => join(dist, url.slice(1));

// ── 2. Pages ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const partials = Object.fromEntries(readdirSync(join(src, "partials")).map((f) => [f.replace(/\.html$/, ""), read(join(src, "partials", f))]));
const layouts = Object.fromEntries(readdirSync(join(src, "layouts")).map((f) => [f.replace(/\.html$/, ""), read(join(src, "layouts", f))]));
const pages = walk(join(src, "pages")).filter((f) => f.endsWith(".html")).map((file) => {
  const text = read(file);
  const m = /^<!--\s*(\{[\s\S]*?\})\s*-->\s*/.exec(text);
  if (!m) throw new Error(`${relative(root, file)} has no front matter`);
  return { file, meta: JSON.parse(m[1]), body: text.slice(m[0].length), mtime: statSync(file).mtime };
}).filter((p) => !p.meta.devOnly || withOgCard).filter((p) => !p.meta.feature || (p.meta.feature === "feedbackForm" && site.feedbackForm));

const looksCount = Object.keys(PRESETS).length;
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const builtOn = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

const looksGrid = [
  ...Object.keys(PRESETS).map((id, i) => `        <li class="look-card" data-tint="${["pear", "coral", "mint", "lavender", "paper"][i % 5]}">
          <div class="look-card__stage${id === "whisper" ? " look-card__stage--busy" : ""}"><div class="chatstage" data-look="${id}" aria-hidden="true"><div class="chatbox"></div></div></div>
          <h3 class="look-card__name">${PRESET_NAMES[id]}</h3>
          <a class="look-card__link" href="/editor/?look=${id}">Use this look<span class="visually-hidden"> (${PRESET_NAMES[id]})</span> <span class="btn__arrow" aria-hidden="true">→</span></a>
        </li>`),
  `        <li class="look-card look-card--own">
          <div>
            <h3 class="look-card__name">Build your own</h3>
            <p>Change every colour, font and corner until it’s yours.</p>
          </div>
          <a class="look-card__link" href="/editor/">Open the editor <span class="btn__arrow" aria-hidden="true">→</span></a>
        </li>`,
].join("\n");

const linkTag = (cls, url, label) => `<a class="${cls}" href="${esc(url)}" rel="noopener">${label}</a>`;
// The TikTok guide's "Get the helper" part (only used when the site has no relay): a download button when there is a download, and an honest sentence when there isn't yet.
const helperGet = site.helperUrl
  ? `<p>Download the helper with the button below and follow the short instructions that come with it. It is free and runs on your own PC.</p>\n      <p><a class="btn" href="${esc(site.helperUrl)}" rel="noopener">Get the helper <span class="btn__arrow" aria-hidden="true">→</span></a></p>`
  : `<p>The helper is in testing, so there is no download yet.${site.waitlistUrl ? ` ${linkTag("", site.waitlistUrl, "Join the waitlist")} and we will tell you when it is ready.` : " We will put the download here when it is ready."}</p>`;
// Wording that depends on whether the site has a shared relay: a free, capped beta that lets TikTok work with nothing installed. With a
// relay the pages talk about the relay only; the helper on a PC is only described when there is no relay.
const relayOn = Boolean(site.relayUrl);
const copy = {
  statusTikTok: relayOn ? "TikTok LIVE works in your browser (free beta, may queue)" : "TikTok LIVE works with a free helper (in testing)",
  tiktokLede: relayOn
    ? "Frills can show your TikTok LIVE chat in your streaming app, such as OBS or TikTok LIVE Studio. TikTok has no official way for overlays to read chat, so Frills reads your LIVE’s public chat for you, through a free relay we run. It is a beta, and there is nothing to install."
    : "Frills can show your TikTok LIVE chat in your streaming app, such as OBS or TikTok LIVE Studio. TikTok has no official way for overlays to read chat, so a small free helper on your own PC does the reading. The helper is in testing.",
  tiktokStep: relayOn
    ? '<p>On TikTok LIVE, pick TikTok in the editor and type your @name. There is nothing to install: a free relay (beta) reads your chat for you, and when it is busy you wait in line for a spot. <a href="/guides/tiktok/">How it works</a>.</p>'
    : '<p>On TikTok LIVE, start the free Frills helper on your PC and type your @name. It reads your public chat without logging in. <a href="/guides/tiktok/">How the helper works</a>.</p>',
  privacyTikTok: relayOn
    ? '<p>On TikTok, your chat passes through the free Frills relay, a small server we run. It reads your LIVE’s public chat without logging in to TikTok, hands it to your overlay and keeps none of it. TikTok, the signing service the relay uses to talk to TikTok, and the relay itself see which account is being watched.</p>\n      <p>On Twitch, your browser reads chat itself and Frills’ own servers never see it.</p>'
    : '<p>On TikTok, the Frills helper on your own PC reads your LIVE’s public chat, without logging in to TikTok, and hands it to the overlay on that same PC. TikTok, and the signing service the helper uses to talk to TikTok, see your address and which account you are watching, the same as they do for any viewer.</p>\n      <p>Either way, Frills’ own servers never see your chat.</p>',
  privacyPictures: relayOn ? "On TikTok, chatters’ profile pictures come from TikTok’s picture servers." : "If you use the TikTok helper on your own PC, chatters’ profile pictures come from TikTok’s picture servers.",
  obsTikTok: relayOn
    ? "On TikTok, that is all: the free relay reads your chat, and the link works on any PC. The <a href=\"/guides/tiktok/\">TikTok guide</a> says more."
    : "On TikTok, open the editor from the Frills helper on your PC first: the <a href=\"/guides/tiktok/\">TikTok guide</a> shows how.",
  obsNothing: relayOn ? "On TikTok, also check that you are LIVE and that the relay isn’t full." : "On TikTok, also check that the helper is running and that you are LIVE.",
  obsTikTokNote: relayOn
    ? '<p class="note note--warm"><strong>Using TikTok LIVE?</strong> Your link reads your chat through the free Frills relay (beta). When the relay is full the source waits for a spot, so open the editor first and check that it connects. The <a href="/guides/tiktok/">TikTok guide</a> has the steps.</p>'
    : '<p class="note note--warm"><strong>Using TikTok LIVE?</strong> Your link points at the Frills helper on your PC, so the helper has to be running and your streaming app has to be on the same PC. The <a href="/guides/tiktok/">TikTok guide</a> has the steps.</p>',
  homeLink: relayOn ? "The editor gives you the link as soon as you have typed your TikTok name or Twitch channel." : "On TikTok the editor gives you the link once the helper is running. On Twitch you can make yours right here, in the look you picked above.",
  testBusy: relayOn
    ? '<li><strong>It says it is waiting for a spot.</strong> The free relay is full for now. Leave the source open and it connects when a spot frees up.</li>'
    : '<li><strong>The editor says TikTok needs the helper.</strong> Open the editor from the address the helper prints, and start the helper first.</li>',
  matchaLede: relayOn ? "real TikTok chat or Twitch chat" : "real TikTok chat (with the Frills helper) or Twitch chat",
};
copy.tiktokGuide = render(partials[relayOn ? "guide-tiktok-relay" : "guide-tiktok-helper"], { helperGet }, partials, "guide-tiktok");
const shared = {
  ...copy,
  themeColor: tokenHex("paper"),
  siteHost: new URL(site.url).host,
  waitlist: site.waitlistUrl,
  helperGet,
  relay: site.relayUrl,
  siteAddress: site.url,
  privacyFeedback: site.feedbackForm ? `\n      <h2 class="subtitle">If you send feedback</h2>\n      <p>The feedback form saves your message, the kind you pick, the streaming app you pick, your contact if you type one, and the date, in a database on Cloudflare. It does not save your address with the message. Only we read it, and we use it to improve Frills. Ask us to delete a message by sending another one that says which.</p>` : "",
  gscTag: site.googleSiteVerification ? `\n<meta name="google-site-verification" content="${esc(site.googleSiteVerification)}">` : "",
  tallyUrl: site.tally.url,
  tallyBlurb: site.tally.blurb,
  year: String(site.year),
  builtOn,
  feedbackItem: site.feedbackUrl ? `\n        <li>${linkTag("", site.feedbackUrl, "Feedback")}</li>` : "",
  feedbackSheetLink: site.feedbackUrl ? `\n    ${linkTag("nav__link", site.feedbackUrl, "Feedback")}` : "",
  feedbackLink: site.feedbackUrl ? linkTag("nav__link", site.feedbackUrl, "Feedback") : "",
  feedbackParagraph: site.feedbackUrl ? `\n      <p>Questions, or something broken? ${linkTag("", site.feedbackUrl, "Tell us")}.</p>` : "",
  looksGrid,
};

function jsonLd(meta, canonical, faqItems) {
  const nodes = [];
  for (const kind of meta.jsonld ?? []) {
    if (kind === "website") nodes.push({ "@type": "WebSite", name: site.name, url: `${site.url}/`, description: site.description });
    if (kind === "software") nodes.push({ "@type": "SoftwareApplication", name: site.name, url: `${site.url}/`, description: site.description, applicationCategory: "MultimediaApplication", operatingSystem: "Any (runs in a web browser)", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } });
    if (kind === "faq") nodes.push({ "@type": "FAQPage", mainEntity: faqItems.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.text } })) });
    if (kind.startsWith("breadcrumb:")) nodes.push({ "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: site.name, item: `${site.url}/` }, { "@type": "ListItem", position: 2, name: kind.slice(11), item: canonical }] });
  }
  return nodes.map((n) => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", ...n }).replace(/</g, "\\u003c")}</script>`).join("\n");
}

function renderPage(page, stats) {
  const { meta } = page;
  const canonical = site.url + meta.path;
  const faqItems = faq({ kb: stats.kb, waitlistUrl: site.waitlistUrl, helperUrl: site.helperUrl, relayUrl: site.relayUrl });
  const vars = {
    ...shared,
    stats,
    title: meta.title,
    description: meta.description ?? site.description,
    canonical,
    ogImage: `${site.url}/og.png`,
    robots: meta.noindex ? '\n<meta name="robots" content="noindex, nofollow">' : "",
    css: assets.css[meta.css],
    js: assets.js[meta.js],
    bodyClass: meta.bodyClass ?? "",
    jsonld: jsonLd(meta, canonical, faqItems),
    navGuide: meta.navGuide ? ' aria-current="page"' : "",
    navTikTok: meta.navTikTok ? ' aria-current="page"' : "",
    navTest: meta.navTest ? ' aria-current="page"' : "",
    navFeedback: meta.navFeedback ? ' aria-current="page"' : "",
    faqItems: faqItems.map((i) => `        <details><summary>${esc(i.q)}</summary><div class="faq__answer"><p>${i.a}</p></div></details>`).join("\n"),
  };
  const where = relative(root, page.file);
  const content = render(page.body, vars, partials, where);
  const chrome = meta.chrome === "nav" ? render(partials.nav, vars, partials, "nav") : meta.chrome === "appbar" ? render(partials.appbar, vars, partials, "appbar") : "";
  const footer = meta.footer ? render(partials.footer, vars, partials, "footer") : "";
  return render(layouts[meta.layout ?? "base"], { ...vars, content, chrome, footer }, partials, `${where} (layout)`);
}

function writePage(page, html) {
  const target = page.meta.file ? join(dist, page.meta.file) : join(dist, page.meta.path.replace(/^\//, ""), "index.html");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, html);
  return target;
}

// ── 3. Measure the overlay, then render everything with the real numbers ──────────────────────────────────────────────
const overlayPage = pages.find((p) => p.meta.path === "/overlay/");
const draft = renderPage(overlayPage, { looks: looksCount, looksWord: "", looksWordLower: "", settings: CONTROLS.length, kb: 0 });
const overlayBytes = gz(draft) + gz(readFileSync(assetFile(assets.css.overlay))) + gz(readFileSync(assetFile(assets.js.overlay)));
const stats = {
  looks: looksCount,
  looksWordLower: WORDS[looksCount] ?? String(looksCount),
  looksWord: (WORDS[looksCount] ?? String(looksCount)).replace(/^./, (c) => c.toUpperCase()),
  settings: CONTROLS.length,
  kb: Math.round(overlayBytes / 1024),
};
for (const page of pages) writePage(page, renderPage(page, stats));

// ── 4. Sitemap, robots, headers ───────────────────────────────────────────────────────────────────────────────────────
const listed = pages.filter((p) => !p.meta.noindex && p.meta.listed !== false).sort((a, b) => a.meta.path.localeCompare(b.meta.path));
writeFileSync(
  join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${listed.map((p) => `  <url><loc>${site.url}${p.meta.path}</loc><lastmod>${p.mtime.toISOString().slice(0, 10)}</lastmod></url>`).join("\n")}\n</urlset>\n`,
);
writeFileSync(
  join(dist, "robots.txt"),
  `User-agent: *\nAllow: /\nDisallow: /overlay/\n\n# AI training crawlers: please stay out. Search and assistant crawlers are welcome.\n${site.trainingCrawlers.map((c) => `User-agent: ${c}`).join("\n")}\nDisallow: /\n\nSitemap: ${site.url}/sitemap.xml\n`,
);

// The page can only run its own files, talk to Twitch's chat server, and show pictures from three places: Twitch's emotes, and TikTok's
// picture servers for chatters' profile pictures (the three families TikTok uses for them). Nothing else is allowed.
const TIKTOK_PICTURES = "https://*.tiktokcdn.com https://*.tiktokcdn-us.com https://*.tiktokcdn-eu.com";
const csp = ["default-src 'self'", "script-src 'self'", "style-src 'self'", `img-src 'self' data: https://static-cdn.jtvnw.net ${TIKTOK_PICTURES}`, "font-src 'self'", `connect-src 'self' wss://irc-ws.chat.twitch.tv${site.relayUrl ? " " + site.relayUrl : ""}`, "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", "object-src 'none'"].join("; ");
writeFileSync(
  join(dist, "_headers"),
  `/*\n  Content-Security-Policy: ${csp}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()\n\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n\n/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n\n/overlay/*\n  X-Robots-Tag: noindex, nofollow\n\n/matcha/*\n  X-Robots-Tag: noindex, nofollow\n`,
);

// ── Report ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const line = (label, bytes, zipped) => console.log(`  ${label.padEnd(30)} ${(bytes / 1024).toFixed(1).padStart(7)} KB   ${(zipped / 1024).toFixed(1).padStart(6)} KB gzip`);
console.log(`\nFrills built in ${((Date.now() - started) / 1000).toFixed(1)}s for ${site.url}`);
console.log(`  ${pages.length} pages, ${listed.length} in the sitemap`);
for (const [kind, map] of Object.entries(assets)) for (const [key, url] of Object.entries(map)) { const b = readFileSync(assetFile(url)); line(`${kind} ${key}`, b.length, gz(b)); }
console.log(`  The overlay page, with its code: ${(overlayBytes / 1024).toFixed(1)} KB gzip (the site says ${stats.kb})`);
