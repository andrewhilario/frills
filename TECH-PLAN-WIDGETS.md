# Technical plan: Alerts, Last Gifts, Follower Goal, Top Likers

Companion to [PLAN-WIDGETS.md](PLAN-WIDGETS.md) (what and why). This is how, where it runs, and what limits it. Nothing is built yet.

## 1. How the data flows

```
TikTok LIVE room
   │  (unofficial websocket, signed by the free Euler Stream community tier)
   ▼
tiktok-live-connector 2.5.0, inside the RELAY (Node, on your phone in Termux, public through a Cloudflare Tunnel)
   │  one connection per TikTok account, shared by every page watching that account (a "room")
   │  maps raw events to small clean JSON, filters per page, adds up likes for 1 s
   ▼
Server-Sent Events:  GET https://relay.valwidgets.live/tiktok/stream?user=NAME&events=gift,follow
   ▼
Overlay page in OBS (static HTML + JS from frills.valwidgets.live, Cloudflare)
   │  keeps the state in memory (and optionally localStorage): alert queue, like totals, follower count
   ▼
What viewers see
```

Nothing new is needed: no database, no accounts, no new server, no cost. The relay already does the first three steps for chat. The pages are static files like today's.

## 2. Where each part is deployed

| Part | Where | How it gets there |
| --- | --- | --- |
| Pages and scripts (widgets hub, editors, overlays) | Cloudflare Workers static assets, `frills.valwidgets.live` | `git push` to `main`, Cloudflare builds (same as now) |
| Relay changes (new events, filter, like adding-up) | Your phone: Termux + Cloudflare Tunnel to `relay.valwidgets.live` | `git pull`, restart the relay (manual, as today) |
| Everything else (state, settings) | The streamer's own browser / OBS | nothing to deploy |

**Order matters.** The relay must be updated before the pages that need it. To make a mismatch obvious, the relay's `/health` gets a `features` list (`["chat","events"]`). A widget page checks it and, if the relay is old, shows "The relay needs an update" instead of sitting blank.

If the phone ever becomes the limit, the relay is plain Node, so it can move to any small server without changing the pages (only the address in `site.config.json`).

## 3. Relay changes (`helper/`)

- `map.mjs`: new pure functions `mapLike`, `mapFollow`, `mapShare`, `mapSub`, and `mapGiftEvent` (the structured version of a gift: gift name, picture, diamonds each, count, streak end). Each clamps and cleans every field, like the chat mapper does.
- `rooms.mjs` (`Room.wire`): listen to `like`, `follow`, `share`, `subscribe` (and later `goalUpdate`, `rankUpdate`), keep the same de-duplication by message id.
- Per-page filter: a client subscribes with `events=gift,follow`. `broadcast` sends each event only to clients that asked for that kind. The default stays chat only, so today's overlays are unchanged.
- Like adding-up: likes are collected per person and flushed once a second as `{user, name, avatar, count}` (count = taps in that second). A busy LIVE sends about one small line per liker per second, not one per tap. Per-room cap on distinct likers in a flush.
- Slow-client protection: if a page can't keep up (`res.writableLength` over a limit), drop its like events first, then close it. Today one stuck page could grow memory.
- `server.mjs`: whitelist the `events` values (unknown ones ignored), per-visitor limit 4 → 8 (an account can run chat + four widgets), `/health` gets `features`.
- `demo.mjs`: `frills_demo` also makes up likes, gifts of different sizes, follows, shares, and sometimes a burst of 30 follows (to test merging). Same path as a real LIVE.

Event shapes sent to pages (all strings cleaned, lengths capped):

| Event | Fields |
| --- | --- |
| `gift` | `id, user, name, avatar, gift, picture, diamonds` (each), `count`, `final` (streak ended) |
| `like` | `user, name, avatar, count` (in the last second), `room` (TikTok's total) |
| `follow`, `share` | `id, user, name, avatar` |
| `sub` | `id, user, name, avatar` (only if TikTok sends it; to be checked) |

## 4. Page-side code (`src/js/`)

Each widget is a small separate bundle (the chat overlay is held to 20 KB; each widget gets its own test budget). Plain hex/rgba colours only and no CSS nesting, so old OBS browsers draw it.

| File | Job |
| --- | --- |
| `live.js` | one connection that gives typed callbacks (`onGift`, `onLike`, `onFollow`…) on top of `connectTikTok`, with `events=` |
| `alerts.js` | the alert engine: queue, tiers, crowd merging, templates, timing (pure logic, no DOM, so it is testable) |
| `alerts-view.js` | draws one alert: looks, animation, picture, sound |
| `likers.js` | adds up likes per person, keeps the top N, animates rows into new places |
| `goal.js` | the follower count and bar, the celebration, the next goal |
| `gifts.js` | the last-gifts list (reuses `feed.js` and the existing looks) |
| `widgets/*.js` | each widget's settings list, checking and link writing, in the same style as `settings.js` (one controls list builds the editor, checks input and writes the link) |

Pages: `/widgets/` (hub) and one editor + one overlay page per widget, built by `build.mjs` like the existing pages. Overlay links look like `/overlay/alerts/?channel=NAME&platform=tiktok&...`.

Links carry only what differs from the defaults. Alerts have more settings than chat (five types, tiers), so the link will be longer; settings are packed into short keys and one compact rules parameter, and a test fails if a link goes past about 3 KB. There is no server to store configs on, so no short codes. That is a known cost of having no accounts.

State: in memory, saved to `localStorage` (keyed by account and widget) when "keep between LIVEs" is on. The like table is capped (for example 5,000 people, lowest dropped), so a huge LIVE can't use up memory. All text from TikTok (names, gift names) and from templates is put in with `textContent`, never as HTML.

## 5. Testing

- Pure logic with unit tests: like adding-up, ranking and ties, tier choice, template filling, crowd merging, queue caps, link round trip and length.
- Relay: extend the existing fake TikTok connection to emit like, follow, share and gift, and test the filter, adding-up, caps and limits (the harness already exists in `test/helper.test.mjs`).
- Real headless Chrome tests for each widget against a helper with a fake TikTok, like `tiktok.browser.test.mjs`.
- A load script: 1,000 pretend likers for 5 minutes through the relay, measuring the phone's CPU and the bytes out.
- Step 0: a read-only script that watches a real LIVE and prints only the shape of each event and counts, never names, to settle the open questions.
- Size budgets and Lighthouse per page, as for the existing pages.

## 6. Limitations (what this cannot do, or cannot promise)

**TikTok side**
- The feed is unofficial. TikTok can change or block likes, gifts or follows separately from chat, and the free Euler tier has rate limits that all relay traffic shares (it comes from one home address).
- Only events seen after the page connects exist. No history, no backfill. If a page or the relay reconnects, events during the gap are lost (the stream has no replay).
- Top Likers counts only taps it saw. Follows have no unfollows. Totals can drift after drops. They are a good guide, not accounting.
- Open questions to settle in step 0: what `followCount` really is (a starting total or not), whether like events carry anything per person, how fast likes arrive, whether subscribe notices arrive.
- Gift pictures come from TikTok's servers (the page's security policy already allows its picture hosts). We never copy them.

**Our side**
- Relay capacity is unmeasured. The phone, the tunnel and the Euler limits are shared by everyone. More event kinds mean more traffic; the filter and the one-second adding-up keep it small, but it needs the load test before many streamers use it.
- Slots count accounts, not pages, so a streamer's five widgets cost one slot, but the per-visitor limit has to rise to 8. Many streamers behind one shared network address (a school, a café) will share that limit.
- The relay can only serve a few dozen accounts (30 today by setting, 20 live). That is the real ceiling of "free for everyone" until it moves off the phone.
- No uploads: custom sounds and images need somewhere to live, so version 1 has built-in ones. A link to a sound or picture on another host would also need the security policy to allow that host.
- OBS: browser sources play sound only if "Control audio via OBS" is ticked, and old OBS ships an old Chrome, so no new CSS. `localStorage` in OBS survives restarts normally, but clearing OBS's cache or using another profile wipes saved totals. "Shutdown source when not visible" ends the page and its running totals unless saved.
- Long links. See section 4.
- Twitch is out of scope: follows, gifts (bits) and subscriptions there need Twitch login.

**Legal and privacy**
- Names and pictures of viewers are shown on stream and held in the overlay's memory (and optionally the streamer's own browser storage). Frills' servers keep nothing, and the privacy page needs one more sentence saying so.
- The connector is under a modified AGPL licence and Frills is AGPL, as settled before.

## 7. Build order, with what "done" means

| Step | What | Done when |
| --- | --- | --- |
| 0 | Event shape check on a real LIVE | the four open questions have written answers |
| 1 | Shared part: relay events and filter, like adding-up, `frills_demo` events, limit 8, `features`, `live.js` | relay and page tests pass; a page receives each event kind from the practice account |
| 2 | Alerts: engine + one look + test buttons, then looks, tiers, merging, sound | all five alert types work from practice events; a 30-follow burst merges; queue cap holds |
| 3 | Last Gifts | the list shows streaks once, with count and picture |
| 4 | Follower Goal | follows move the bar; the celebration and next goal work |
| 5 | Top Likers | ranking and tie-breaks correct in tests; rows animate |
| 6 | `/widgets/` hub, guides, FAQ, privacy line, nav, deploy, load test result | live on the site; the load test numbers are in the notes |

Each step ends with all tests passing and a check in a real browser. I commit and push only when you say so, and I update the relay on your phone only by giving you the exact commands.

## 8. Where people actually stream: TikTok LIVE Studio first, Streamlabs second (added 2026-10-08)

The user says most TikTok streamers use TikTok LIVE Studio, and some use Streamlabs. We have never run Frills in either. From third-party guides and vendor help pages (nothing official from TikTok):

- LIVE Studio shows a web page through a **Link** source (some versions call it Browser or Web page). Sizes of 1080 x 1920 (vertical) are common.
- One vendor reports that LIVE Studio sometimes loads link sources at **0 x 0**, and that the embedded browser can **freeze** with **no refresh button** (their workaround: change a query parameter and save). Another says its embedded browser is an **older engine**.
- Transparency in LIVE Studio is **unconfirmed**: a forum post says a transparent background came out black for window capture.
- Audio from a link source is **unconfirmed**. No source covers it.
- Streamlabs Desktop has an OBS-style **Browser Source** (URL, width, height, custom CSS, "shutdown when not visible", "refresh when scene becomes active"), so OBS behaviour should carry over, but that is not tested either.

What this changes in the plan:
1. **Test first.** Before building, the user opens one test link in LIVE Studio (and Streamlabs) and answers: is the background transparent, what size does it open at, does it keep updating for 10 minutes. This decides the rest.
2. **Vertical first.** Design every widget for a 1080 x 1920 canvas: the Top 10 as a tall narrow column, goal bar and alerts sized for portrait, positions relative to the canvas. Landscape second.
3. **Old engine.** Build the widget bundles for an older browser (lower the esbuild `target` for overlay bundles), keep CSS plain, and add a test that fails if a newer feature slips in.
4. **Self-healing.** A page-level watchdog: if no heartbeat from the relay for about 30 s, reconnect, and after repeated failures reload the page. LIVE Studio may have no refresh button, so the overlay must not need one.
5. **0 x 0 and odd sizes.** Layouts use the canvas size actually given (viewport units), and the page shows nothing rather than breaking when it is tiny.
6. **If transparency fails.** Give every widget an optional solid or frosted background card so it still looks right on an opaque rectangle. Document the OBS Virtual Camera route as a last resort.
7. **Sound is optional.** Alerts are visual first. Sound is on by default only after the test shows it plays in LIVE Studio; otherwise off by default with a note.
8. **Guides lead with LIVE Studio.** The setup guide gets LIVE Studio first (Add source > Link > paste, set 1080 x 1920), then Streamlabs Desktop, then OBS, each marked "tested by us" or "from other guides, not yet tested by us".
9. **Native features.** LIVE Studio may already offer its own gifts, goals or top-gifter displays. Not researched; to check so Frills' versions are better, not duplicates.
