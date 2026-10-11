# Handoff: Frills, for whoever continues (a person or another coding tool)

Frills is a free site of chat overlays for live streamers (TikTok LIVE first, Twitch too): pick a look, connect a name, copy one link into a streaming app's browser source. Live at https://frills.valwidgets.live. Repo: github.com/andrewhilario/frills (main deploys by itself). The owner is a non-developer streamer: keep explanations plain, ask before big choices, and never push or run anything outward-facing without being asked.

## Run it
```
npm test            # builds, then runs ~209 tests (Node 22, no install needed; a Chrome/Edge makes the browser tests run)
npm run dev         # build + local server at http://localhost:3020 (also answers the feedback form over SQLite)
npm run deploy      # build + wrangler deploy (normally Cloudflare builds from GitHub instead)
```
Only dev dependency: esbuild. Helper/relay dependency (separate, in `helper/`): tiktok-live-connector 2.5.0 (`npm run tiktok:setup`).

## How it fits together
- **Site:** static files built by `build.mjs` (own tiny template engine: `{{x}}` escaped, `{{{x}}}` raw, `{{>partial}}`) from `src/pages`, `src/partials`, `src/js`, `src/css`; Hallmark "Hum" tokens in `tokens.css`. Cloudflare Workers static assets (`wrangler.jsonc`), custom domain frills.valwidgets.live. Security policy (CSP) is generated into `_headers`.
- **Worker (`worker/`):** only for `/api/*` (feedback form). Saves to a Cloudflare D1 database (binding `DB`, schema `worker/schema.sql`). Pure logic in `worker/feedback.mjs`, tested over SQLite (`scripts/lib/d1-sqlite.mjs`).
- **TikTok has no official chat API.** `helper/` reads it with the unofficial connector and serves pages to the browser as Server-Sent Events (`/tiktok/stream?user=NAME`; events `status`, `chat`, `remove`, `clear`, and `alert` with `?events=follow,gift,share`). It runs as a local helper (`npm run tiktok`) or as the shared **relay** (`npm run relay`, `RELAY_SLOTS`, `RELAY_PER_IP`, ...). The live relay runs on the owner's Android phone in Termux (tmux sessions `relay` and `tunnel`) behind a Cloudflare Tunnel at https://relay.valwidgets.live. See `RELAY-PHONE-GUIDE.md`. Updating it: `tmux kill-session -t relay`, `cd ~/frills && git pull && (cd helper && npm install)`, start it again with the same `RELAY_SLOTS`. The relay must be updated before pages that need new relay features (`/health` lists `features`).
- **Practice account:** TikTok name `frills_demo` makes up chat, gifts, follows and shares without touching TikTok.
- **Overlay pages** (`/overlay/`, `/overlay/alerts/`) must work in old streaming browsers: plain hex/rgba colors only, no `oklch()`, `color-mix()`, `:has()` or CSS nesting. The chat overlay page is held to 20 KB gzipped by a test.

## House rules (tests enforce several)
- Site copy: typographic apostrophes (’), no "...", no " -- ", no marketing filler, never the literal `localhost`/`127.0.0.1` in built pages. Say "streaming app" and "Browser source (or web page or link source)", not only OBS. Page descriptions 70 to 170 characters; titles up to 70.
- Never print, commit or ask for secrets: the Cloudflare tunnel token, `EULER_API_KEY`, `.env*`. Never ask for or accept TikTok or Riot passwords.
- Honesty: say what was tested and what was not. Not yet verified by anyone: OBS itself, TikTok LIVE Studio and Streamlabs behavior (transparency, size, sound), gifts/follows/mods on a real LIVE, the relay under real load.
- Commit and push only when the owner says so; commit messages end with the `Co-Authored-By` line the tool uses. `promo/` (video pipeline) is deliberately not committed.

## State (2026-10-10)
- Live: chat editor, matcha page, TikTok guide, test guide (`/guides/test/`), feedback form, Search Console tag, honest TikTok status messages and a before-you-start checklist.
- **Alerts are built but hidden** (committed, `noindex`, unlisted, unlinked): `/alerts/` (editor), `/overlay/alerts/`, `/guides/alerts/`. To publish: remove `noindex`/`listed:false` from those two page files, re-add the links (nav, footer, FAQ entry), after the phone relay is on 0.2.0 and the owner has tried it on a real stream.
- Plans: `PLAN-WIDGETS.md` and `TECH-PLAN-WIDGETS.md` (Top Likers, Last Gifts, Follower Goal, Alerts).

## Next, in the owner's order
1. Owner tests alerts on a real stream (sound and transparency in TikTok LIVE Studio unknown).
2. A step-by-step tutorial page, and a tutorial video (storyboard + voiceover in `promo/audio/tutorial-*`).
3. Curated CC0 sound library with an in-page search.
4. DONE locally 2026-10-11, not pushed: uploads of own images, GIFs and sounds (300 KB) in the D1 `media` table (`worker/media.mjs`, run the new part of `worker/schema.sql` in the D1 Console first), served from `/api/media/<id>`, one rights checkbox, delete code kept in the browser, picker `src/js/alerts-media.js`, tests `media.test.mjs`, `media.browser.test.mjs`, `alerts-media.test.mjs`. Before making Alerts public: add a sentence about stored uploads to the privacy page.
5. Auto-treat a silent TikTok connection as "not live yet" and retry: wait until it can be tried on a real LIVE.
