// Checks the built site in dist/ without a browser: addresses, search settings, links, headers, weight, copy.
// `npm test` builds first. If you run this file alone, run `npm run build` before it.

import { overlaysFaq } from "../src/overlays-faq.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, relative } from "node:path";
import { site } from "../src/site.mjs";
import { CONTROLS, PRESETS } from "../src/js/settings.js";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "index.html"))) throw new Error("dist/ is empty. Run `npm run build` first (`npm test` does that for you).");

const read = (path) => readFileSync(join(dist, path), "utf8");
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const files = walk(dist).map((f) => relative(dist, f).replace(/\\/g, "/"));
const urlOf = (file) => (file === "404.html" ? "/404.html" : "/" + file.replace(/index\.html$/, ""));
const pages = files.filter((f) => f.endsWith(".html")).map((file) => ({ file, url: urlOf(file), html: read(file) }));
const indexable = pages.filter((p) => !/<meta name="robots" content="noindex/.test(p.html));
const meta = (html, name) => (new RegExp(`<meta (?:name|property)="${name}" content="([^"]*)"`).exec(html) ?? [])[1];
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
const gz = (data) => gzipSync(data, { level: 9 }).length;
const assetOf = (html, kind) => (new RegExp(`${kind === "css" ? 'href="(/assets/[^"]+\\.css)"' : 'src="(/assets/[^"]+\\.js)"'}`).exec(html) ?? [])[1];

test("the pages we expect are all there", () => {
  const urls = pages.map((p) => p.url).sort();
  assert.deepEqual(urls, ["/", "/404.html", "/admin/", "/alerts/", "/changelog/", "/editor/", "/feedback/", "/gifts/", "/goal/", "/guides/alerts/", "/guides/both/", "/guides/not-showing/", "/guides/obs/", "/guides/setup/", "/guides/test/", "/guides/tiktok/", "/likers/", "/looks/", "/matcha/", "/matcha/alerts/", "/overlay/", "/overlay/alerts/", "/overlay/gifts/", "/overlay/goal/", "/overlay/likers/", "/overlay/songs/", "/overlays/", "/overlays/faq/", "/privacy/", "/songs/", "/spotify/", "/spotify/callback/", "/start/", "/twitch/", "/twitch/callback/"]);
});

test("every indexable page has its own title and description, a canonical address, share tags and one h1", () => {
  assert.ok(indexable.length >= 4);
  const titles = new Set();
  const descriptions = new Set();
  for (const { url, html } of indexable) {
    const title = (/<title>([^<]*)<\/title>/.exec(html) ?? [])[1];
    const description = meta(html, "description");
    assert.ok(title && title.length <= 70, `${url}: title "${title}" must exist and fit in 70 characters`);
    assert.ok(description && description.length >= 70 && description.length <= 170, `${url}: description is ${description?.length} characters, wanted 70 to 170`);
    assert.ok(!titles.has(title), `${url}: title repeats another page`);
    assert.ok(!descriptions.has(description), `${url}: description repeats another page`);
    titles.add(title);
    descriptions.add(description);
    assert.match(html, new RegExp(`<link rel="canonical" href="${site.url}${url === "/404.html" ? "/404.html" : url}">`), `${url}: canonical`);
    assert.equal(meta(html, "og:title"), title, `${url}: og:title`);
    assert.equal(meta(html, "og:url"), site.url + url, `${url}: og:url`);
    assert.equal(meta(html, "og:image"), `${site.url}/og.png`, `${url}: og:image`);
    assert.equal(meta(html, "twitter:card"), "summary_large_image", `${url}: twitter card`);
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, `${url}: exactly one h1`);
    assert.match(html, /<html lang="en">/, `${url}: lang`);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1/, `${url}: viewport`);
  }
});

test("pages that should stay out of search say so, in the page and in the headers", () => {
  const headers = read("_headers");
  for (const url of ["/overlay/", "/matcha/", "/matcha/alerts/", "/404.html"]) {
    assert.match(pages.find((p) => p.url === url).html, /<meta name="robots" content="noindex, nofollow">/, url);
  }
  assert.match(headers, /\/overlay\/\*\n  X-Robots-Tag: noindex, nofollow/);
  assert.match(headers, /\/matcha\/\*\n  X-Robots-Tag: noindex, nofollow/);
});

test("the sitemap lists exactly the indexable pages", () => {
  const sitemap = read("sitemap.xml");
  const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
  assert.deepEqual(listed, indexable.filter((p) => p.url !== "/404.html").map((p) => site.url + p.url).sort());
  assert.doesNotMatch(sitemap, /matcha|\/overlay\/|og-card/); // (the /overlays/ page is a normal page; the overlay pages themselves are not listed)
});

test("robots.txt keeps training crawlers out, lets search and assistant crawlers in, and points at the sitemap", () => {
  const robots = read("robots.txt");
  assert.match(robots, new RegExp(`Sitemap: ${site.url}/sitemap.xml`));
  const groups = robots.split(/\n\s*\n/).map((g) => ({ agents: [...g.matchAll(/^User-agent: (.+)$/gm)].map((m) => m[1]), rules: g }));
  const blocked = (agent) => groups.some((g) => g.agents.includes(agent) && /^Disallow: \/$/m.test(g.rules));
  for (const agent of site.trainingCrawlers) assert.ok(blocked(agent), `${agent} should be asked to stay out`);
  for (const agent of ["Googlebot", "Bingbot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Perplexity-User", "Claude-SearchBot", "Claude-User", "DuckAssistBot", "Applebot"]) {
    assert.ok(!blocked(agent), `${agent} must never be blocked`);
  }
  assert.match(robots, /User-agent: \*\nAllow: \/\nDisallow: \/overlay\//);
  assert.doesNotMatch(robots, /matcha/, "the unlisted page shouldn't be named in a public file");
});

test("every link and file the pages point at exists, and every #anchor has a target", () => {
  const exists = (path) => files.includes(path) || files.includes(path.replace(/\/$/, "") + "/index.html");
  for (const { url, html } of pages) {
    for (const m of html.matchAll(/(?:href|src)="(\/[^"#?]*)(?:\?[^"#]*)?(#[^"]*)?"/g)) {
      const [, path, hash] = m;
      const target = path === "/" ? "index.html" : path.replace(/^\//, "");
      assert.ok(exists(target) || files.includes(target), `${url}: ${path} does not exist`);
      if (hash) {
        const page = pages.find((p) => p.url === path);
        assert.ok(page && page.html.includes(`id="${hash.slice(1)}"`), `${url}: ${path}${hash} has no target`);
      }
    }
  }
  for (const file of files.filter((f) => f.endsWith(".css"))) {
    for (const m of read(file).matchAll(/url\(["']?(\/[^"')]+)["']?\)/g)) assert.ok(files.includes(m[1].slice(1)), `${file}: ${m[1]} does not exist`);
  }
});

test("nothing the security policy would block: no inline styles, inline scripts or event attributes", () => {
  for (const { url, html } of pages) {
    assert.doesNotMatch(html, /\sstyle="/, `${url}: inline style attribute`);
    assert.doesNotMatch(html, /\son[a-z]+="/, `${url}: inline event handler`);
    for (const m of html.matchAll(/<script([^>]*)>/g)) {
      assert.ok(/\ssrc="/.test(m[1]) || /type="application\/ld\+json"/.test(m[1]), `${url}: inline script ${m[0]}`);
    }
  }
});

test("the security headers are in place", () => {
  const headers = read("_headers");
  for (const rule of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "font-src 'self'", "connect-src 'self' wss://irc-ws.chat.twitch.tv", "img-src 'self' data: https://static-cdn.jtvnw.net https://cdn-images.dzcdn.net https://i.scdn.co https://*.tiktokcdn.com https://*.tiktokcdn-us.com https://*.tiktokcdn-eu.com", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
    assert.ok(headers.includes(rule), `the policy lacks ${rule}`);
  }
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /Referrer-Policy: strict-origin-when-cross-origin/);
  assert.match(headers, /\/assets\/\*\n  Cache-Control: public, max-age=31536000, immutable/);
  assert.match(headers, /\/fonts\/\*\n  Cache-Control: public, max-age=31536000, immutable/);
});

test("the only outside addresses are Twitch, the site itself, Tally and the standards", () => {
  const relayHost = site.relayUrl ? new URL(site.relayUrl).host : "no-relay.invalid";
  const allowed = [new RegExp(`^${relayHost.replace(/\./g, "\\.")}$`), /^static-cdn\.jtvnw\.net$/, /^irc-ws\.chat\.twitch\.tv$/, /^eventsub\.wss\.twitch\.tv$/, /^api\.twitch\.tv$/, /^id\.twitch\.tv$/, /^accounts\.spotify\.com$/, /^api\.spotify\.com$/, /^i\.scdn\.co$/, new RegExp(`^${new URL(site.url).host.replace(/\./g, "\\.")}$`), new RegExp(`^${new URL(site.tally.url).host.replace(/\./g, "\\.")}$`), /^schema\.org$/, /^www\.w3\.org$/, /^www\.sitemaps\.org$/];
  for (const file of files.filter((f) => /\.(html|js|css|xml|txt)$/.test(f) && !f.startsWith("fonts/licenses/"))) {
    for (const m of read(file).matchAll(/(?:https?|wss?):\/\/([a-z0-9.-]+)/gi)) {
      assert.ok(allowed.some((re) => re.test(m[1])), `${file} talks to ${m[1]}`);
    }
  }
});

test("the overlay stays light, and the site's own numbers are true", () => {
  const overlay = pages.find((p) => p.url === "/overlay/");
  const bytes = gz(overlay.html) + gz(readFileSync(join(dist, assetOf(overlay.html, "css")))) + gz(readFileSync(join(dist, assetOf(overlay.html, "js"))));
  // The budget was 20 KB. Reading TikTok and Twitch together, and saying why the relay turned a page away, cost about 0.7 KB between them (October 2026).
  // The budget is now 21.5 KB (the home page still says 21, which is what it rounds to): the two seasonal decoration packs, Halloween and Christmas, cost 0.2 KB (October 2026).
  // The seasonal looks themselves are kept out of the overlay (seasonal-looks.js is only loaded by the editors) to spend nothing more.
  assert.ok(bytes <= 21.5 * 1024, `the overlay is ${(bytes / 1024).toFixed(1)} KB gzipped; the budget is 21.5 KB`);
  const home = pages.find((p) => p.url === "/").html;
  assert.match(home, new RegExp(`data-count="${Math.round(bytes / 1024)}"`), "the KB on the home page matches what was measured");
  assert.match(home, new RegExp(`data-count="${CONTROLS.length}"`), "the settings count matches");
  assert.match(home, new RegExp(`data-count="${Object.keys(PRESETS).length}"`), "the looks count matches");
  assert.equal((home.match(/class="look-card"/g) ?? []).length, Object.keys(PRESETS).length, "one card per look");
});

test("nothing from the machine it was built on leaks into the site", () => {
  for (const file of files.filter((f) => /\.(html|js|css|xml|txt)$/.test(f))) assert.doesNotMatch(read(file), /localhost|127\.0\.0\.1/, file);
});

test("the brand images exist and are the right size", () => {
  const size = (file) => { const b = readFileSync(join(dist, file)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  assert.deepEqual(size("og.png"), [1200, 630]);
  assert.deepEqual(size("apple-touch-icon.png"), [180, 180]);
  assert.ok(files.includes("favicon.svg") && files.includes("favicon.ico"));
});

test("no page still says TikTok is missing or only coming, and the TikTok pages point at each other", () => {
  for (const { url, html } of pages) {
    const text = textOf(html);
    assert.doesNotMatch(text, /TikTok( LIVE)? (is|are) (next|coming)|TikTok( LIVE)? isn’t supported|we haven’t built it|Twitch (chat )?(works )?today/i, `${url}: still says TikTok isn't available`);
  }
  const home = pages.find((p) => p.url === "/").html;
  const guide = pages.find((p) => p.url === "/guides/tiktok/").html;
  assert.match(textOf(home), site.relayUrl ? /TikTok LIVE works in your browser \(free beta, may queue\)/ : /TikTok LIVE works with a free helper/);
  assert.ok(home.includes('href="/guides/tiktok/"'), "the home page links to the TikTok guide");
  assert.ok(pages.find((p) => p.url === "/guides/obs/").html.includes('href="/guides/tiktok/"'), "and so does the OBS guide");
  assert.ok(guide.includes('href="/guides/obs/"'), "the TikTok guide links to the OBS guide");
  assert.ok(site.googleSiteVerification && home.includes(`<meta name="google-site-verification" content="${site.googleSiteVerification}">`), "the home page carries the Google Search Console tag");
  const feedbackPage = pages.find((p) => p.url === "/feedback/").html;
  assert.ok(site.feedbackForm && feedbackPage.includes('id="feedback-form"'), "the feedback form page exists when the form is on");
  assert.ok(home.includes('<a href="/feedback/" rel="noopener">Feedback</a>') || home.includes('href="/feedback/"'), "the footer links to the feedback form");
  assert.ok(pages.find((p) => p.url === "/privacy/").html.includes("Feedback you send."), "the privacy page says what the form saves");
  const testGuide = pages.find((p) => p.url === "/guides/test/").html;
  assert.ok(home.includes('<a class="nav__link" href="/guides/test/">Test it</a>'), "the top menu offers the test guide on every page");
  assert.ok(testGuide.includes('<a class="nav__link" href="/guides/test/" aria-current="page">Test it</a>'), "and marks it as the current page there");
  assert.ok(testGuide.includes("frills_demo"), "the test guide names the practice account");
  assert.ok(testGuide.includes(`${site.url}/overlay/?channel=frills_demo&amp;platform=tiktok`), "and shows a whole example link on the site's own address");
  assert.ok(guide.includes('href="/guides/test/"'), "the TikTok guide links to the test guide");
  assert.ok(pages.find((p) => p.url === "/guides/obs/").html.includes('href="/guides/test/"'), "so does the setup guide");
  assert.ok(guide.includes('<a class="nav__link" href="/guides/tiktok/" aria-current="page">TikTok</a>'), "the nav marks the TikTok guide as the current page");
  const faq = home.slice(home.indexOf('"@type":"FAQPage"'), home.indexOf("</script>", home.indexOf('"@type":"FAQPage"')));
  assert.ok(faq.includes("Does it work with TikTok LIVE?"));
  assert.ok(!faq.includes("Not yet."), "the TikTok answer no longer says not yet");
});

test("the copy uses real punctuation", () => {
  for (const { url, html } of pages) {
    const text = textOf(html);
    assert.doesNotMatch(text, /[A-Za-z]'[a-z]/, `${url}: a straight apostrophe in the copy`);
    assert.doesNotMatch(text, /\.\.\./, `${url}: three dots instead of an ellipsis`);
    assert.doesNotMatch(text, / -- /, `${url}: a double hyphen instead of a dash`);
    assert.doesNotMatch(text, /\b(revolutionize|supercharge|unleash|seamless|empower|elevate|game-changing|cutting-edge)\b/i, `${url}: marketing filler`);
  }
});

test("structured data is valid JSON and describes the page", () => {
  for (const { url, html } of pages) {
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      const data = JSON.parse(m[1]);
      assert.equal(data["@context"], "https://schema.org", url);
      assert.ok(data["@type"], url);
    }
  }
  const home = pages.find((p) => p.url === "/").html;
  const types = [...home.matchAll(/"@type":"(WebSite|SoftwareApplication|FAQPage)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(types, ["FAQPage", "SoftwareApplication", "WebSite"]);
  assert.match(home, /"price":"0"/);
  assert.doesNotMatch(home, /aggregateRating|ratingValue/, "no invented ratings");
});

test("the privacy page says what the database keeps (feedback, uploaded files and their delete code, Twitch followers, Spotify) and no longer says there is no database", () => {
  const html = read("privacy/index.html").replace(/\s+/g, " ");
  assert.doesNotMatch(html, /no database/i);
  assert.doesNotMatch(html, /no accounts and no database/i);
  for (const phrase of ["What Frills keeps on its server", "Feedback you send.", "Images, GIFs and sounds you upload for alerts.", "delete code", "1 MB", "300 KB", "do not store your name or your address", "New Twitch followers", "kept for one day", "The song playing", "Song names in Song requests", "Cloudflare", "private page"]) {
    assert.ok(html.includes(phrase), `the privacy page says "${phrase}"`);
  }
  // Frills keeps the Spotify login (so the player works with the page closed): the page has to say so, say how it is protected and how it goes away
  for (const phrase of ["Your Spotify login, if you connect Spotify in Song requests", "encrypted", "never your Spotify password", "Pressing Disconnect deletes all of it at once", "not been used for 14 days is deleted by itself", "spotify.com/account/apps"]) {
    assert.ok(html.includes(phrase), `the privacy page says "${phrase}"`);
  }
  assert.doesNotMatch(html, /Your Spotify login stays in your browser/, "that stopped being true when Frills began keeping the login");
});

test("the overlays FAQ is its own indexable page with structured data, listed in the sitemap, and linked from the overlays page and the main FAQ", () => {
  const html = read("overlays/faq/index.html");
  assert.equal((html.match(/<details>/g) ?? []).length, overlaysFaq({ kb: 19, relayUrl: site.relayUrl }).length);
  const data = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const page = data.find((d) => d["@type"] === "FAQPage");
  assert.equal(page.mainEntity.length, (html.match(/<details>/g) ?? []).length);
  assert.ok(data.some((d) => d["@type"] === "BreadcrumbList"));
  assert.match(read("sitemap.xml"), new RegExp(`${site.url}/overlays/faq/`));
  assert.ok(read("overlays/index.html").includes('href="/overlays/faq/"'));
  assert.ok(read("index.html").includes('href="/overlays/faq/"'), "the main FAQ points at it");
  assert.doesNotMatch(read("index.html"), /nothing stored|no database/i);
});

test("the changelog page says what the 14 October update did, the banner points to it, and the alerts editor has the Twitch login it describes", () => {
  const changelog = read("changelog/index.html");
  assert.ok(changelog.includes("14 October 2026"));
  assert.ok(changelog.includes("Log in with Twitch inside the alerts editor"));
  assert.ok(changelog.includes("Text alignment"));
  assert.ok(read("sitemap.xml").includes(`${site.url}/changelog/`));
  assert.ok(read("index.html").includes('href="/changelog/"'));
  assert.ok(read("index.html").includes("See what"), "the banner on the home page points at it");
  assert.ok(read("alerts/index.html").includes('id="tw-login-btn"'));
  assert.ok(read("alerts/index.html").includes('id="tw-test-follower"'));
});

test("the changelog page is listed, linked from the menu and footer, and its claims match the site (the overlays FAQ, the privacy page, alignment)", () => {
  const html = read("changelog/index.html");
  assert.match(read("sitemap.xml"), new RegExp(`${site.url}/changelog/`));
  assert.ok(read("index.html").includes('href="/changelog/"'), "the home page's menu and footer link to it");
  assert.ok(html.includes('href="/overlays/faq/"') && html.includes('href="/privacy/"') && html.includes('href="/twitch/"'));
  assert.match(html, /Text alignment/);
  assert.ok(html.indexOf("14 October 2026") < html.indexOf("13 October 2026") && html.indexOf("13 October 2026") < html.indexOf("8 to 10 October 2026"), "newest first");
});

test("the update banner sits above the menu where it scrolls away, appears once, and is not on the editor pages whose preview sticks under the top bar", () => {
  const home = read("index.html");
  assert.equal((home.match(/id="site-announcement"/g) ?? []).length, 1);
  assert.ok(home.indexOf('id="site-announcement"') < home.indexOf('<header class="nav"'), "above the sticky menu, not inside it");
  assert.match(home, /<aside class="announcement" id="site-announcement"[^>]* hidden>/, "hidden until the script has checked that it was not dismissed");
  for (const editor of ["alerts/index.html", "editor/index.html", "gifts/index.html", "likers/index.html", "goal/index.html", "songs/index.html", "matcha/index.html"]) {
    assert.ok(!read(editor).includes("site-announcement"), `${editor} has no banner (its preview is pinned under the top bar)`);
  }
});

test("the setup clips page has a clip and written steps for each of the five overlays, every file it names is in the site, and the clips never start by themselves", () => {
  const page = pages.find((p) => p.url === "/guides/setup/").html;
  const names = ["chat", "alerts", "gifts", "goal", "likers"];
  for (const name of names) {
    const section = new RegExp(String.raw`<section class="setup" id="${name}"[\s\S]*?</section>`).exec(page)?.[0];
    assert.ok(section, name + ": a section");
    assert.equal((section.match(/<video /g) ?? []).length, 1, name + ": one clip");
    assert.ok((section.match(/<li><div><h3 class="subtitle">/g) ?? []).length >= 4, name + ": the steps are written out too");
    for (const file of [`${name}.mp4`, `${name}.jpg`]) assert.ok(files.includes("guides/clips/" + file), file + " is in the site");
    assert.match(section, new RegExp(String.raw`poster="/guides/clips/${name}\.jpg"`));
    assert.ok(/<video [^>]*\bwidth="\d+" height="\d+"/.test(section), name + ": the size is set, so the page does not jump");
    assert.ok(/<video [^>]*preload="none"/.test(section) && !/<video [^>]*\bautoplay\b/.test(section), name + ": nothing downloads or plays until it is on screen");
    assert.ok(/<video [^>]*\bcontrols\b/.test(section) && /aria-label="A silent clip/.test(section), name + ": it has controls and a description");
    assert.ok(section.includes(`href="/${name === "chat" ? "editor" : name}/"`), name + ": a link to its editor");
  }
  for (const file of files.filter((x) => x.startsWith("guides/clips/") && /\.mp4$/.test(x))) assert.ok(readFileSync(join(dist, file)).length < 1_200_000, file + " stays small");
  // the editors and the overlays page point to it
  for (const [url, anchor] of [["/editor/", "chat"], ["/alerts/", "alerts"], ["/gifts/", "gifts"], ["/goal/", "goal"], ["/likers/", "likers"]]) {
    assert.ok(pages.find((p) => p.url === url).html.includes(`href="/guides/setup/#${anchor}"`), url + " links to its clip");
    assert.ok(pages.find((p) => p.url === "/overlays/").html.includes(`href="/guides/setup/#${anchor}"`), "the overlays page links to the " + anchor + " clip");
  }
  assert.ok(pages.find((p) => p.url === "/").html.includes('href="/guides/setup/"'), "the home page links to the clips");
});

test("only the overlay pages may be shown inside one of our own pages (the Quick start pictures); every other page, and anyone else, still may not frame anything", () => {
  const headers = read("_headers");
  const rule = (pattern) => new RegExp(String.raw`^${pattern.replace("*", "\\*")}\n((?:[ ]{2}.*\n?)+)`, "m").exec(headers)?.[1] ?? "";
  const everything = rule("/*");
  assert.ok(/Content-Security-Policy: .*frame-ancestors 'none'/.test(everything), "the default is: nobody may frame a page");
  const overlays = rule("/overlay/*");
  assert.ok(/^ {2}! Content-Security-Policy$/m.test(overlays), "the overlay rule first lets go of the default policy");
  const own = /^ {2}Content-Security-Policy: (.*)$/m.exec(overlays)?.[1] ?? "";
  assert.ok(own.includes("frame-ancestors 'self'") && !own.includes("frame-ancestors 'none'"), "and sets its own: only this site may frame an overlay");
  const defaultPolicy = /^ {2}Content-Security-Policy: (.*)$/m.exec(everything)[1];
  assert.equal(own, defaultPolicy.replace("frame-ancestors 'none'", "frame-ancestors 'self'"), "the rest of the policy is exactly the default");
  for (const other of ["/matcha/*", "/admin/*", "/assets/*"]) assert.ok(!/Content-Security-Policy/.test(rule(other)), other + " keeps the default");
  assert.ok(!/frame-ancestors (\*|http)/.test(headers), "no outside site is ever allowed to frame anything");
});

test("the Quick start page is there, is found from the home page and the footer, and brings only its own script and styles", () => {
  const start = pages.find((p) => p.url === "/start/").html;
  assert.equal((start.match(/<h1[ >]/g) ?? []).length, 1);
  assert.ok(start.includes('id="start"') && /<noscript>[\s\S]*\/editor\//.test(start), "the page has its place for the questions and a way on without script");
  assert.ok(pages.find((p) => p.url === "/").html.includes('href="/start/"'), "the home page links to it");
  assert.ok(read("start/index.html").includes("/guides/setup/"), "and it points to the clips");
  assert.ok(pages.every((p) => !p.html.includes("Quick start") || p.html.includes('href="/start/"') || p.url === "/start/"), "any page that names it links to it");
});
