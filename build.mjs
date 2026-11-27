// Builds the whole site into dist/:  node build.mjs
//   1. bundles the scripts and styles (esbuild), with a content hash in each file name so they can be cached for a year
//   2. renders each page from src/pages with the shared nav, footer and layout
//   3. measures the overlay page, so the numbers on the site are the real ones
//   4. writes sitemap.xml, robots.txt and the security headers
// The site is plain static files. A small Worker and a Cloudflare D1 database sit behind a few of its features (feedback, uploaded files, Twitch follows, Spotify); see worker/.

import { build as esbuild } from "esbuild";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { site, checkSite } from "./src/site.mjs";
import { CONTROLS, PRESETS, PRESET_NAMES } from "./src/js/settings.js";
import { faq } from "./src/faq.mjs";
import { plusWords } from "./src/plus-words.mjs";
import { overlaysFaq } from "./src/overlays-faq.mjs";
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
const jsEntries = { home: "src/js/home.js", check: "src/js/check.js", status: "src/js/status.js", editor: "src/js/editor.js", overlay: "src/js/overlay.js", cloudHost: "src/js/cloud-host.js", matcha: "src/js/matcha-page.js", page: "src/js/page.js", account: "src/js/account.js", start: "src/js/start.js", feedback: "src/js/feedback.js", alerts: "src/js/alerts-editor.js", alertsOverlay: "src/js/alerts-overlay.js", gifts: "src/js/gifts-editor.js", jar: "src/js/jar-editor.js", jarOverlay: "src/js/jar-overlay.js", wheel: "src/js/wheel-editor.js", wheelOverlay: "src/js/wheel-overlay.js", actions: "src/js/actions-editor.js", actionsOverlay: "src/js/actions-overlay.js", outline: "src/js/outline-editor.js", outlineOverlay: "src/js/outline-overlay.js", likers: "src/js/likers-editor.js", likersOverlay: "src/js/likers-overlay.js", gifters: "src/js/gifters-editor.js", giftersOverlay: "src/js/gifters-overlay.js", labels: "src/js/labels-editor.js", labelsOverlay: "src/js/labels-overlay.js", gallery: "src/js/gallery-editor.js", galleryOverlay: "src/js/gallery-overlay.js", songs: "src/js/songs-editor.js", songsOverlay: "src/js/songs-overlay.js", spotify: "src/js/spotify-page.js", twitch: "src/js/twitch-page.js", admin: "src/js/admin.js", adminStats: "src/js/admin-stats.js", adminOffice: "src/js/admin-office.js", ticker: "src/js/ticker.js", goal: "src/js/goal-editor.js", giftsOverlay: "src/js/gifts-overlay.js", goalOverlay: "src/js/goal-overlay.js", counter: "src/js/counter-editor.js", counterOverlay: "src/js/counter-overlay.js", timer: "src/js/timer-editor.js", timerOverlay: "src/js/timer-overlay.js", tts: "src/js/tts-editor.js", ttsOverlay: "src/js/tts-overlay.js", ...(withOgCard && { og: "src/js/og.js" }) };
const cssEntries = { home: "src/css/entry/home.css", check: "src/css/entry/check.css", page: "src/css/entry/page.css", start: "src/css/entry/start.css", editor: "src/css/entry/editor.css", matcha: "src/css/entry/matcha.css", overlay: "src/css/entry/overlay.css", cloudHost: "src/css/entry/cloud-host.css", alerts: "src/css/entry/alerts.css", alertsOverlay: "src/css/entry/alerts-overlay.css", widget: "src/css/entry/widget.css", admin: "src/css/entry/admin.css", widgetOverlay: "src/css/entry/widget-overlay.css", ...(withOgCard && { og: "src/css/entry/og.css" }) };
const jsBuild = await esbuild({ ...common, entryPoints: jsEntries, format: "iife", legalComments: "none" });
const cssBuild = await esbuild({ ...common, entryPoints: cssEntries, external: ["/fonts/*", "/decor/*"], legalComments: "inline" });

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
}).filter((p) => !p.meta.devOnly || withOgCard).filter((p) => !p.meta.feature || (Object.hasOwn(site, p.meta.feature) && site[p.meta.feature] === true)); // a page that names a feature is built only while that feature is on

// Dedicated private Matcha editors (/matcha/<slug>/) for all 14 remaining Frills overlays (16 total with /matcha/ and /matcha/alerts/).
// Derived directly from the live public editor templates so controls, tests, and fixes never drift out of sync.
const MATCHA_SLUGS = ["studio", "alerts", "jar", "wheel", "outline", "songs", "tts", "goal", "timer", "gifts", "gifters", "labels", "actions", "likers", "gallery", "counter"];
const MATCHA_OVERLAY_PAGES = [
  { slug: "jar", name: "Matcha gift & bits jar", lede: "Your private Frog Pond & crystal gift jar editor, starting from your Matcha palette for TikTok LIVE, Twitch, or Both." },
  { slug: "wheel", name: "Matcha spin the wheel", lede: "Your private Kawaii prize & dare wheel editor, pre-colored in your Matcha palette for TikTok gifts and Twitch bits & subs." },
  { slug: "outline", name: "Matcha stream outline", lede: "Your private 9:16 TikTok LIVE & 16:9 OBS stream outline designer, starting with your Matcha palette and Frog Pond corner art." },
  { slug: "songs", name: "Matcha song requests", lede: "Your private !sr song request queue and Spotify player editor, pre-styled in your Matcha palette for TikTok, Twitch, or Both." },
  { slug: "tts", name: "Matcha talking pet TTS", lede: "Your private Talking Pet TTS editor with your Matcha palette and active mascot reading gifts, bits, subs, and !say chat." },
  { slug: "goal", name: "Matcha goal bar", lede: "Your private follower, sub, gift, and bits goal bar editor, starting in your Matcha palette with milestone cheers." },
  { slug: "timer", name: "Matcha subathon timer", lede: "Your private subathon countdown timer editor, pre-styled in your Matcha palette for TikTok gifts and Twitch subs & bits." },
  { slug: "gifts", name: "Matcha recent gifts", lede: "Your private live recent gifts & support feed editor, pre-styled in your Matcha palette for TikTok, Twitch, or Both." },
  { slug: "gifters", name: "Matcha top gifters", lede: "Your private supporter leaderboard editor, ranking TikTok diamonds and Twitch gifted subs & bits in your Matcha palette." },
  { slug: "labels", name: "Matcha rotating highlights", lede: "Your private rotating stream highlights editor (Last Gift, Last Follower, Last Sub, Last Bits, Top Gifter) in your Matcha palette." },
  { slug: "actions", name: "Matcha OBS & VTS actions", lede: "Your private OBS Studio, Streamlabs & VTube Studio actions editor with sticky notes, scenes, and instant replay cam." },
  { slug: "likers", name: "Matcha top likers", lede: "Your private TikTok LIVE top likers leaderboard editor, pre-colored in your Matcha palette with crown celebrations." },
  { slug: "gallery", name: "Matcha gift gallery", lede: "Your private TikTok LIVE rotating gift gallery editor, pre-styled in your Matcha palette." },
  { slug: "counter", name: "Matcha viewer & like counter", lede: "Your private TikTok LIVE viewer and heart counter editor, pre-styled in your Matcha palette." },
];
for (const entry of MATCHA_OVERLAY_PAGES) {
  const sourcePage = pages.find((p) => p.meta.path === `/${entry.slug}/`);
  if (!sourcePage) throw new Error(`Missing source editor page /${entry.slug}/ for /matcha/${entry.slug}/`);
  const introHtml = `<header class="panel__intro">\n      <div class="matcha-subhead">\n        <span class="matcha-subhead__pill">Private Matcha Studio</span>\n        <a class="matcha-subhead__back" href="/matcha/#matcha-suite">← All 16 Matcha overlays</a>\n      </div>\n      <h1 class="panel__title">${esc(entry.name)}</h1>\n      <p class="panel__lede">${esc(entry.lede)}</p>\n    </header>`;
  const body = sourcePage.body
    .replace(/<main\b([^>]*)>/, `<main$1 data-mode="matcha" data-matcha-slug="${entry.slug}">`)
    .replace(/\{\{\{\s*intro\s*\}\}\}/, introHtml)
    .replace(/\{\{\{\s*about\s*\}\}\}/, "");
  pages.push({
    file: sourcePage.file,
    mtime: sourcePage.mtime,
    meta: {
      ...sourcePage.meta,
      title: `${entry.name} | Frills`,
      description: entry.lede,
      path: `/matcha/${entry.slug}/`,
      bodyClass: `${sourcePage.meta.bodyClass ?? ""} page-matcha-editor`.trim(),
      chrome: "matcha",
      matchaNav: entry.slug,
      footer: false,
      noindex: true,
      listed: false,
      intro: undefined,
      about: undefined,
      jsonld: [],
    },
    body,
  });
}

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
            <p>Change every color, font and corner until it’s yours.</p>
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
    ? '<p>On TikTok, your chat passes through the free Frills relay, a small server we run. It reads your LIVE’s public chat without logging in to TikTok, hands it to your overlay and keeps none of it. TikTok, the signing service the relay uses to talk to TikTok, and the relay itself see which account is being watched. The person who runs the relay can also see, live on the relay’s own screen, which accounts are connected right now (on the relay’s own status page, with a password), so they know who they are helping and can say thank you. That list is not saved anywhere: there is no history.</p>\n      <p>On Twitch, your browser reads chat itself and Frills’ own servers never see it.</p>'
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
const plusPromoBanner = site.plusAccounts && site.plusPromoCode
  ? `\n        <p class="plus-promo"><strong>Founding 20 offer:</strong> use code <code>${esc(site.plusPromoCode)}</code> at checkout for <strong>20% off forever</strong> ($4.79/month — first 20 subscribers only).</p>`
  : "";
const words = plusWords({ on: site.plusAccounts === true, promoBanner: plusPromoBanner }); // (what the pages say changes once accounts exist: see src/plus-words.mjs)
const shared = {
  ...copy,
  themeColor: tokenHex("paper"),
  siteHost: new URL(site.url).host,
  waitlist: site.waitlistUrl,
  helperGet,
  relay: site.relayUrl,
  plusRelay: site.plusRelayUrl,
  ...Object.fromEntries(Object.entries(words).map(([k, v]) => ["plus" + k[0].toUpperCase() + k.slice(1), v])), // plusNotAffiliated, plusPrivacyLede, plusIdeasIntro, ...
  plusAccounts: site.plusAccounts ? "on" : "", // ("on" when the Frills Plus account pages are built: a page that links to them checks this)
  plusPromoCode: site.plusAccounts && site.plusPromoCode ? site.plusPromoCode : "",
  plusPromoBanner,
  siteAddress: site.url,
  spotifyClientId: site.spotifyClientId ?? "",
  twitchClientId: site.twitchClientId ?? "",
  tickerJs: assets.js.ticker,
  privacyAlerts: relayOn ? `\n      <h2 class="subtitle">Alerts, last gifts and goals</h2>\n      <p>These work like chat: follows, gifts and shares pass through the free Frills relay to your overlay and nobody keeps them. The list of gifts, the follower count and the like ranking live only in your overlay page\u2019s memory. If you turn on \u201cremember\u201d, the count is kept in your own browser or streaming app and nowhere else.</p>` : "",
  // Everything the site's database keeps, in one list. Each item says what is kept, for how long, and who can see it.
  privacyStored: `\n      <h2 class="subtitle">What Frills keeps on its server</h2>
      <p>${words.privacyStoredIntro}</p>
      <ul>${words.privacyAccountItems}${site.feedbackForm ? `
        <li><strong>Feedback you send.</strong> The message, the kind you pick, the streaming app you pick, your contact if you type one, and the date. It does not save your address with the message. Only we read it, and we use it to improve Frills. Ask us to delete a message by sending another one that says which.</li>` : ""}
        <li><strong>Images, GIFs and sounds you upload for alerts.</strong> The file itself, its type, its size and the time, plus a scrambled copy (a hash) of the delete code you are shown once. We do not store your name or your address with it. A file stays until you delete it with that code or we remove it. Anyone who has your overlay link, or the file\u2019s own address, can open it, so do not upload anything private; the files are not listed anywhere. After a deletion a copy can stay at Cloudflare for up to an hour. Pictures and GIFs are limited to 1 MB, sounds to 300 KB, and to common picture and sound types, and you must have the right to use what you upload.</li>${site.twitchClientId ? `
        <li><strong>New Twitch followers, if you use Twitch follow alerts.</strong> Your Twitch login stays in your browser and is never sent to Frills. Each new follower\u2019s name and Twitch name are kept for one day, under a random code in your overlay link, so that your overlay can show them. The page that listens also tells Frills now and then that it is still running.</li>` : ""}${site.spotifyClientId ? `
        <li><strong>Your Spotify login, if you connect Spotify in Song requests</strong> (beta). When you press Log in with Spotify, Frills keeps the login Spotify gives it (never your Spotify password) in this database, encrypted with a key that is not stored in the database, so that the Spotify player works with the Frills page closed. It is used only to read what is playing and, if you switch that on, to look up the songs your viewers ask for, add them to your Spotify queue, and skip. Alongside it Frills keeps the last 12 lines of what happened (a viewer’s name and the song they asked for, or what Spotify refused), shown only to you in the editor, and which of the two switches are on. Pressing Disconnect deletes all of it at once, and a login that has not been used for 14 days is deleted by itself. You can also remove Frills at spotify.com/account/apps.</li>
        <li><strong>The song playing, if you share Spotify with Song requests</strong> (beta). Its title, artist, cover and position go to a small box under a random code, so that your overlay can show it. It is replaced as the song changes and removed after 14 days of no use, or when you press Disconnect or turn sharing off.</li>` : ""}
        <li><strong>Song names in Song requests</strong> (beta). The words a viewer types to ask for a song are looked up on Deezer\u2019s public catalog through Frills\u2019 server, so that the overlay can show a cover. Frills does not keep them, but Cloudflare can keep the answer for a short while.</li>
      </ul>
      <p>The person who runs Frills can read all of the above on a private page, to read feedback and to remove files that should not be there. Wrong-password tries on that page are counted for ten minutes so that guessing is stopped.</p>`,
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

const ORG = { "@type": "Organization", name: site.name, url: `${site.url}/`, logo: `${site.url}/apple-touch-icon.png` };
const FEATURES = ["Chat overlay for TikTok LIVE, Twitch and Both in one link, with cute looks and little pets", "Pop-up alerts for TikTok follows, gifts and shares and Twitch subs, gifted subs, bits, raids and follows", "Recent gifts and support feed for TikTok and Twitch", "14 crystal Gift and Bits Jars in Small, Medium and Large", "Goal bars for followers, subs, gifts, bits or likes", "Spin the wheel prize and dare overlay", "Subathon countdown timer for TikTok gifts and Twitch subs and bits", "Talking Pet TTS (!say, gifts and bits)", "Song requests (!sr) with queue and optional Spotify player for TikTok and Twitch", "Top gifters, top likers, rotating highlights, gift gallery and live counter", "Stream outline and border designer for 9:16 TikTok LIVE and 16:9 Twitch/OBS", "OBS, Streamlabs and VTube Studio Actions with 10 free automatic plus unlimited manual sticky notes", "Simple and Advanced setup mode with Overlay Size Guide", "Free, no account"];

function jsonLd(meta, canonical, faqItems, overlayItems = []) {
  const nodes = [];
  for (const kind of meta.jsonld ?? []) {
    if (kind === "website") nodes.push({ "@type": "WebSite", name: site.name, url: `${site.url}/`, description: site.description, publisher: ORG });
    if (kind === "organization") nodes.push(ORG); // (no sameAs yet: it is added when Frills has public profiles to point to)
    if (kind === "article") nodes.push({ "@type": "Article", headline: meta.headline ?? meta.title.replace(/ \| Frills$/, ""), description: meta.description, mainEntityOfPage: canonical, ...(meta.published && { datePublished: meta.published }), dateModified: meta.updated ?? meta.published, author: ORG, publisher: ORG, image: `${site.url}/og.png` });
    if (kind === "software") nodes.push({ "@type": "SoftwareApplication", name: site.name, url: `${site.url}/`, description: site.description, applicationCategory: "MultimediaApplication", operatingSystem: "Any (runs in a web browser)", featureList: FEATURES, screenshot: `${site.url}/og.png`, publisher: ORG, offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } });
    if (kind === "webapp") nodes.push({ "@type": "WebApplication", name: meta.title.replace(/ \| Frills$/, ""), url: canonical, description: meta.description, applicationCategory: "MultimediaApplication", operatingSystem: "Any (runs in a web browser)", isAccessibleForFree: true, offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, isPartOf: { "@type": "WebSite", name: site.name, url: `${site.url}/` } });
    if (kind === "faq") nodes.push({ "@type": "FAQPage", mainEntity: faqItems.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.text } })) });
    if (kind === "faq-overlays") nodes.push({ "@type": "FAQPage", mainEntity: overlayItems.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.text } })) });
    if (kind.startsWith("breadcrumb:")) nodes.push({ "@type": "BreadcrumbList", itemListElement: [{ name: site.name, item: `${site.url}/` }, ...(meta.parent ? [{ name: meta.parent.name, item: `${site.url}${meta.parent.path}` }] : []), { name: kind.slice(11), item: canonical }].map((x, i) => ({ "@type": "ListItem", position: i + 1, ...x })) });
  }
  return nodes.map((n) => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", ...n }).replace(/</g, "\\u003c")}</script>`).join("\n");
}

function renderPage(page, stats) {
  const { meta } = page;
  const canonical = site.url + meta.path;
  const vars0 = { ...shared, stats };
  const where0 = relative(root, page.file);
  const faqItems = faq({ kb: stats.kb, waitlistUrl: site.waitlistUrl, helperUrl: site.helperUrl, relayUrl: site.relayUrl, plus: site.plusAccounts === true });
  const overlayItems = overlaysFaq({ kb: stats.kb, relayUrl: site.relayUrl, plus: site.plusAccounts === true });
  const vars = {
    ...shared,
    stats,
    title: meta.title,
    description: meta.description ?? site.description,
    canonical,
    updated: meta.updated ?? "",
    updatedHuman: meta.updated ? new Date(meta.updated + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "",
    ogImage: `${site.url}/og.png`,
    robots: meta.noindex ? '\n<meta name="robots" content="noindex, nofollow">' : "",
    css: assets.css[meta.css],
    js: assets.js[meta.js],
    bodyClass: meta.bodyClass ?? "",
    jsonld: jsonLd(meta, canonical, faqItems, overlayItems),
    // A page can ask for two blocks of its own by partial name: "intro" (a heading and a line at the top of an editor's panel) and "about" (a
    // short explanation at the bottom of it). Pages that share a template (the alerts editor and the private Matcha one) differ only by these.
    intro: meta.intro ? render(partials[meta.intro], vars0, partials, `${where0} > ${meta.intro}`) : "",
    about: meta.about ? render(partials[meta.about], vars0, partials, `${where0} > ${meta.about}`) : "",
    navGuide: meta.navGuide ? ' aria-current="page"' : "",
    navTikTok: meta.navTikTok ? ' aria-current="page"' : "",
    navTest: meta.navTest ? ' aria-current="page"' : "",
    navFeedback: meta.navFeedback ? ' aria-current="page"' : "",
    navOverlays: meta.navOverlays ? ' aria-current="page"' : "",
    ...Object.fromEntries(MATCHA_SLUGS.map((s) => [`matchaNav${s[0].toUpperCase()}${s.slice(1)}`, meta.matchaNav === s ? ' aria-current="page"' : ""])),
    overlaysFaqItems: overlayItems.map((i) => `        <details><summary><h3 class="faq__q">${esc(i.q)}</h3></summary><div class="faq__answer"><p>${i.a}</p></div></details>`).join("\n"),
    faqItems: faqItems.map((i) => `        <details><summary><h3 class="faq__q">${esc(i.q)}</h3></summary><div class="faq__answer"><p>${i.a}</p></div></details>`).join("\n"),
  };
  const where = relative(root, page.file);
  const content = render(page.body, vars, partials, where);
  const chrome = meta.chrome === "nav" ? render(partials.nav, vars, partials, "nav") : meta.chrome === "appbar" ? render(partials.appbar, vars, partials, "appbar") : meta.chrome === "matcha" ? render(partials["matcha-bar"], vars, partials, "matcha-bar") : "";
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
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${listed.map((p) => `  <url><loc>${site.url}${p.meta.path}</loc>${p.meta.updated ? `<lastmod>${p.meta.updated}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`,
);
writeFileSync(
  join(dist, "robots.txt"),
  `User-agent: *\nAllow: /\nDisallow: /overlay/\nDisallow: /o/\n\n# AI training crawlers: please stay out. Search and assistant crawlers are welcome.\n${site.trainingCrawlers.map((c) => `User-agent: ${c}`).join("\n")}\nDisallow: /\n\nSitemap: ${site.url}/sitemap.xml\n`,
);

// The page can only run its own files, talk to Twitch's chat server, and show pictures from three places: Twitch's emotes, and TikTok's
// picture servers for chatters' profile pictures (the three families TikTok uses for them). Nothing else is allowed.
const TIKTOK_PICTURES = "https://*.tiktokcdn.com https://*.tiktokcdn-us.com https://*.tiktokcdn-eu.com";
const TWITCH_CONNECT = site.twitchClientId ? " wss://eventsub.wss.twitch.tv https://api.twitch.tv https://id.twitch.tv" : "";
const SPOTIFY_CONNECT = site.spotifyClientId ? " https://accounts.spotify.com https://api.spotify.com" : "";
const SPOTIFY_PICTURES = site.spotifyClientId ? " https://i.scdn.co" : "";
const RELAY_CONNECT = [site.relayUrl, site.plusRelayUrl].filter(Boolean).map((u) => " " + u).join("");
const csp = ["default-src 'self'", "script-src 'self'", "style-src 'self'", `img-src 'self' data: https://static-cdn.jtvnw.net https://cdn-images.dzcdn.net${SPOTIFY_PICTURES} ${TIKTOK_PICTURES}`, "font-src 'self'", `connect-src 'self' wss://irc-ws.chat.twitch.tv${RELAY_CONNECT}${TWITCH_CONNECT}${SPOTIFY_CONNECT}`, "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", "object-src 'none'"].join("; ");
const actionsCsp = csp.replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:* ws://localhost:*");
const actionsOverlayCsp = actionsCsp.replace("frame-ancestors 'none'", "frame-ancestors 'self'");
writeFileSync(
  join(dist, "_headers"),
  `/*\n  Content-Security-Policy: ${csp}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Strict-Transport-Security: max-age=31536000\n  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()\n\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n\n/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n\n/actions/*\n  ! Content-Security-Policy\n  Content-Security-Policy: ${actionsCsp}\n\n/overlay/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n  ! Content-Security-Policy\n  Content-Security-Policy: ${csp.replace("frame-ancestors 'none'", "frame-ancestors 'self'")}\n\n/overlay/actions/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n  ! Content-Security-Policy\n  Content-Security-Policy: ${actionsOverlayCsp}\n\n/o/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n\n/matcha/*\n  X-Robots-Tag: noindex, nofollow\n\n/matcha/actions/*\n  X-Robots-Tag: noindex, nofollow\n  ! Content-Security-Policy\n  Content-Security-Policy: ${actionsCsp}\n\n/check/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n\n/admin/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n`,
);

// ── Report ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const line = (label, bytes, zipped) => console.log(`  ${label.padEnd(30)} ${(bytes / 1024).toFixed(1).padStart(7)} KB   ${(zipped / 1024).toFixed(1).padStart(6)} KB gzip`);
console.log(`\nFrills built in ${((Date.now() - started) / 1000).toFixed(1)}s for ${site.url}`);
console.log(`  ${pages.length} pages, ${listed.length} in the sitemap`);
for (const [kind, map] of Object.entries(assets)) for (const [key, url] of Object.entries(map)) { const b = readFileSync(assetFile(url)); line(`${kind} ${key}`, b.length, gz(b)); }
console.log(`  The overlay page, with its code: ${(overlayBytes / 1024).toFixed(1)} KB gzip (the site says ${stats.kb})`);
