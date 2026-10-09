# The Frills helper (testing build)

A small program for your own PC. It does two things:

1. serves the Frills site (editor, matcha page, the overlay for OBS) at `http://127.0.0.1:8765/`, and
2. reads a TikTok account's LIVE chat and gives it to those pages, so TikTok chat shows up in a Frills overlay.

A web page can't read TikTok itself, so this is the part that does.

```bash
npm run tiktok:setup    # once: downloads the TikTok connector (about 25 MB)
npm run tiktok          # builds the site, starts the helper, opens the editor
```

Or double-click `Start-TikTok-Helper.bat` in the project folder. The full test guide is `TIKTOK-TEST-GUIDE.txt`.

## What it does and doesn't do

- Listens on this computer only (`127.0.0.1`). It refuses requests with another Host or Origin, so a web page on the internet can't talk to it.
- Reads **public** chat. No TikTok login, no password, no cookies, no session. Nothing is sent to Frills (there is no Frills server in this). TikTok, and the third-party Euler Stream service that signs the connector's requests (free community tier, no key needed), see your internet address and which account you watch, as they would for any viewer.
- Keeps chat in memory only long enough to show it. Nothing is written to disk.
- One connection per account, shared by every page watching it (the editor and OBS together use one). It lets go 30 seconds after the last page leaves.
- Watches at most 3 accounts at once, to stay inside the free tier.
- Has one pretend account, `frills_demo`: type it as the TikTok name and the helper makes up chat (in TikTok's own message shape, so it goes through the real mapping and delivery) without ever contacting TikTok. It is for testing the editor and OBS when nobody is live. See `demo.mjs`.
- Tries again by itself: an account that isn't live yet is checked every 20 seconds, a dropped connection is retried with growing waits, a busy free tier is retried after a minute.

## Settings (environment variables)

- `PORT` – another port than 8765. The easy way is `npm run tiktok -- --port=8766`.
- `EULER_API_KEY` – optional. A free Euler Stream key raises the connector's rate limits. Keep it in the environment, never in a link.
- `--no-open` (or the environment variable `FRILLS_NO_OPEN=1`) – don't open the browser.

## What the pages are told

The pages ask `GET /tiktok/stream?user=NAME` and receive Server-Sent Events: `status` (`connecting`, `connected`, `offline`, `reconnecting`, `limited`, `error`), `chat` (a Frills message), `remove` and `clear` (a moderator deleted a message or banned someone). `GET /tiktok/ping` says whether the helper is there; the hosted site has a static file at the same address that says it isn't.

## Licence: read this before sharing the helper

The helper uses `tiktok-live-connector` 2.5.0, which is under a **modified AGPL-3.0** (its LICENSE adds sections 18 to 21). As read on 2026-10-07 (not legal advice): a free tool that links the library is allowed, but the extra terms take that permission away if the library powers a *commercial, closed-source or hosted SaaS* platform, such as a relay server, unless the whole server source is published under AGPL-3.0. TikFinity and Euler Stream are named as exceptions. Versions up to 2.4.0 were MIT.

So: using the helper on your own PC for testing is fine. Before giving it to other people, selling anything with it, or running it as a hosted service, settle the licence question first.

## Tests

`npm test` runs them: the message mapping (`test/tiktok.test.mjs`), the helper itself with a pretend TikTok (`test/helper.test.mjs`) and the editor, matcha page and overlay in a real Chrome (`test/tiktok.browser.test.mjs`). None of them touch TikTok.
