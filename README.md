# Frills

Free, cute, customizable chat overlays for live streams. Pick a look, change anything, paste one link into a Browser source in your streaming app.

Twitch chat works straight from the browser. TikTok chat works through a small helper that runs on the streamer's own PC (see "TikTok" below). The helper is a testing build with no public download yet, so the site says so: it says TikTok works with the helper (in testing), and the TikTok guide (`/guides/tiktok/`) says there is no download until `helperUrl` is set.

The site is plain static files. There is no server, no database and no account: the settings live in the link, and Twitch chat is read in the viewer's browser.

## Run it

You need Node 22 or newer.

```bash
npm install
npm run dev
```

`npm run dev` builds the site, serves it at http://localhost:3020/ and rebuilds when a file changes. The server applies the same headers the live site will (including the Content-Security-Policy), so a blocked script shows up here and not after a deploy.

```bash
npm run build     # writes dist/
npm test          # builds, then runs every test
```

The browser tests drive a real Chrome or Edge. On a computer with neither they skip themselves.

## TikTok (testing build)

A web page can't read TikTok, so TikTok chat comes through the Frills helper: a small Node program that runs on the streamer's PC, reads a LIVE account's public chat and also serves the Frills pages from `http://127.0.0.1:8765/`. OBS loads the overlay from there, so nothing depends on the website being up.

```bash
npm run tiktok:setup    # once: downloads the TikTok connector (about 25 MB)
npm run tiktok          # builds the site, starts the helper, opens the editor
```

Or double-click `Start-TikTok-Helper.bat`. Type `frills_demo` as the TikTok name to get made-up chat through the whole real path when nobody is live. **[TIKTOK-TEST-GUIDE.txt](TIKTOK-TEST-GUIDE.txt) is the step-by-step guide** (tests in the editor, OBS, TikTok LIVE Studio and the matcha page, troubleshooting, what isn't finished). How the helper works, its limits and the licence warning are in [helper/README.md](helper/README.md).

Read the licence part before giving the helper to anyone: the connector it uses is under a modified AGPL that restricts commercial or hosted use.

TikTok chatters' profile pictures show in the round badge (a setting, "Use profile pictures", on by default). They load from TikTok's picture servers, which the Content-Security-Policy lists (`*.tiktokcdn.com`, `-us` and `-eu`); the page only accepts addresses on those, or a drawn picture inside the address for the pretend account. Twitch gives no pictures with chat, so Twitch chatters keep the letter.

On the hosted site the TikTok button says the helper is needed. `public/tiktok/ping` is a static file that answers "no helper here" at the address the helper answers "yes" at, so the page can tell without a failed request.

## What is where

```text
src/pages/        one folder per page (index.html is the page); a JSON comment at the top is its title, description and so on
src/partials/     nav, footer, logo, the mascot, the editor's top bar
src/layouts/      base (site pages) and bare (the overlay, which has no chrome)
src/js/           feed.js (the chat), twitch.js and tiktok.js (the two chat sources), connect.js (picks one), settings.js (the looks
                  and controls as data), look.js (paints a look), editor.js, home.js, overlay.js, ...
src/css/          chat.css + looks*.css are the overlay; site.css, base.css and the rest are the site
helper/           the Frills helper: server.mjs (serves the site, answers the pages), rooms.mjs (one TikTok connection per account),
                  map.mjs (TikTok's events -> Frills messages). Its own package.json: the site's build never installs it.
tokens.css        every colour, font, size and space on the site (Hallmark "Hum", tuned for Frills)
public/           fonts, icons, the social card: copied into dist/ as they are
build.mjs         bundles with esbuild, renders the pages, writes sitemap, robots.txt and _headers
scripts/          the local server, the dev loop, the brand-image maker
test/             unit tests, static checks of the built site, helper tests, and browser tests
```

Things the build does for you:

- Scripts and styles get a content hash in their names and are cached for a year. Pages are not.
- The numbers on the site (how many looks, how many controls, how small the overlay is) are measured from the code, so they cannot go stale.
- `sitemap.xml`, `robots.txt` and `_headers` are written from the page list and `src/site.mjs`.
- The build stops if a template name is missing or the site address is not a plain https address.

## Rules worth keeping

- **The overlay must work in an old OBS.** `chat.css`, `looks.css`, `looks-matcha.css` and the overlay script use plain hex and rgba only: no `color-mix()`, `oklch()`, `:has()` or CSS nesting. Colours that need maths are worked out in `src/js/color.js`. The overlay page is held to 20 KB by a test.
- **Chat text is somebody else's words.** It only goes into the page with `textContent` and text nodes, never as HTML. Emote ids are checked before they become an image address.
- **The site CSS uses tokens.** No raw colours or font names outside `tokens.css` (the overlay files above are the one exception, for the reason above).
- **No tracking.** Nothing is stored on a server and there is no analytics script. The privacy page promises it, so change the page first if that ever changes.

## Settings you will want to change

`site.config.json`:

```json
{ "url": "https://frills.valwidgets.live", "feedbackUrl": "", "waitlistUrl": "", "helperUrl": "" }
```

- `url` is the address everything is built around: canonical links, the sitemap and the social card. Change it together with the route in `wrangler.jsonc`, and run `node scripts/make-assets.mjs` again, because the share image prints the address.
- `feedbackUrl` is a link to wherever feedback should go (a form, a Discord invite). Empty means no Feedback link is shown.
- `waitlistUrl` is a link to a form for people who want to hear when the TikTok helper can be downloaded. Empty means the FAQ, the TikTok guide and the note under the chat box have no such link.
- `helperUrl` is where the TikTok helper can be downloaded. While it is empty, the FAQ and the TikTok guide say there is no download yet (and offer the waitlist if there is one). Once it is set, both show a "Get the helper" link instead. Set it only when the download exists, and settle the licence question in `helper/README.md` first.

Any of them can be overridden for one build with `SITE_URL`, `FEEDBACK_URL`, `WAITLIST_URL` and `HELPER_URL` in the environment.

## Deploy (Cloudflare Workers, static assets)

`wrangler.jsonc` serves `dist/` and nothing else. There is no Worker code, and requests for static files are free on Cloudflare.

One time, from this folder:

```bash
npx wrangler login
npm run deploy
```

Or build it from GitHub: push the repo, then in Cloudflare go to Workers & Pages, create from Git, pick the repo, and set

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

`.node-version` asks for Node 22.

**The address** is `https://frills.valwidgets.live`, a subdomain of the Tally domain. The `routes` entry in `wrangler.jsonc` is all it takes: the first deploy makes Cloudflare create the DNS record and the certificate. Do not add a DNS record for `frills` yourself. A Custom Domain can't be created on a name that already has a CNAME, so if you did, delete it before deploying.

The deploy also gets a `frills.<your-account>.workers.dev` address. Its pages point their canonical links and social card at the subdomain, which is what you want once the subdomain works. To try the workers.dev address before then, set `SITE_URL` to it for that build (a build variable in Workers Builds, or `SITE_URL=... npm run deploy`) and remove it afterwards.

Since it shares a zone with Tally:

- Always Use HTTPS (SSL/TLS, Edge Certificates) is already on for the zone if you turned it on for Tally.
- Cloudflare's bot and AI-crawler settings are per zone, so whatever you chose for valwidgets.live most likely applies here too. On Tally they blocked search and assistant crawlers at the edge, in front of the site's own `robots.txt`. After going live, check a few: `curl -s -o /dev/null -w "%{http_code}\n" -A "PerplexityBot" https://frills.valwidgets.live/` should print 200.
- Search engines treat a subdomain as its own site, so Frills needs its own entry in Search Console.
- Moving to a domain of its own later: change `url` and the route, deploy, and add a redirect from the old subdomain.

**After every deploy,** look at the live site and not only at status codes: view source on the home page and check that the canonical link, `og:image` and `sitemap.xml` say the real address, and that `/overlay/?demo=1` shows chat.

## Brand images

`public/favicon.svg`, `favicon.ico`, `apple-touch-icon.png` and `og.png` are drawn from the tokens by `scripts/make-assets.mjs` (it needs Chrome or Edge). They are committed, because a Cloudflare build has no Chrome. Run it again after changing the tokens, the home page headline or the site address (the share image prints it):

```bash
node scripts/make-assets.mjs
```

## Fonts

The fonts are self-hosted from `public/fonts` (the site never calls Google Fonts, and the Content-Security-Policy would block it). They came from the open-source Fontsource packages and are under the SIL Open Font License; each licence is in `public/fonts/licenses`.

## Things to know

- **Twitch.** Chat is read as an anonymous guest (`justinfan` plus digits) over Twitch's chat websocket. Twitch's current documentation does not describe guest reads, so this could stop working without notice. If Twitch refuses the login, the overlay says so instead of retrying forever. The fallback would be Twitch's own sign-in (OAuth), which needs a small backend.
- **The Matcha page** at `/matcha/` is the partner's own set of styles. It is not in the nav or the sitemap and is marked noindex. To make it public: link it from the nav, take `noindex` and `"listed": false` out of its front matter, and delete the `/matcha/*` block that `build.mjs` writes into `_headers`.
- **AI crawlers.** `robots.txt` asks AI training crawlers to stay out (the list is in `src/site.mjs`) and lets search and assistant crawlers in. It is the same policy as Tally.
- **Design memory.** `.hallmark/` records which design choices this site made, so a later Hallmark run can pick something different or keep the system.

## The shared relay (free beta, for streamers who install nothing)

`npm run relay` runs the same program as the helper, but as a shared service: it answers the Frills website from another address (`RELAY_ORIGINS`), has a limited number of spots (`RELAY_SLOTS`) and a line for them, limits streams per visitor address (`RELAY_PER_IP`), keeps no chat and serves no site of its own. Set `relayUrl` in `site.config.json` (or `RELAY_URL`) to its public address and the site's pages, FAQ, privacy page and security policy follow. [RELAY-PHONE-GUIDE.md](RELAY-PHONE-GUIDE.md) sets it up on an Android phone with Termux and a Cloudflare Tunnel. The local helper stays the choice for anyone who wants no waiting.

## Licence

Frills is free software under the GNU Affero General Public License v3 (see `LICENSE`). The TikTok helper and relay use `tiktok-live-connector`, which has its own modified AGPL licence; see `helper/README.md`. If you run a modified copy of the relay as a service for other people, the AGPL asks you to share your changes.
