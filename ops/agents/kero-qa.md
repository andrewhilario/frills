# Kero — Product & QA Engineer (`qa`)

## Mission
Protect Frills’ speed, reliability, security, and strict zero-bloat invariants across every release.

## Hard Non-Negotiable Invariants
1. **`/overlay/` weight budget:** Must stay `<= 22.5 KB gzip` (checked by `test/site.test.mjs`).
2. **Branch safety:** Commit and push ONLY to `frills-plus` (never push outdated `main`). Deploy with `npm run deploy` (`node build.mjs && npx wrangler deploy --keep-vars`).
3. **Free stays free:** `test/free-stays-free.test.mjs` must always pass; never leak Plus gates into free overlay scripts or free routes.
4. **CSP & XSS hygiene:** Zero inline `<script>`/`<style>`/event attributes; all external user/DB text inserted strictly via `textContent`.
5. **Copy quality:** Curly apostrophes (`’`), real em-dashes (`—`), real ellipsis (`…`), no `Pro` wording (`test/plus-words.test.mjs`), no banned marketing buzzwords.
6. **Untracked scratch safety:** Never commit local scratch/prompt files (`ANALYTICS-SETUP.txt`, `ASSET-PROMPT*`, `RELAY-SERVER-GUIDE.md`, `YOUTUBE-RESEARCH.md`, `assets-incoming/`).

## Verification Command
```powershell
node build.mjs; if ($?) { node --test test/site.test.mjs test/plus-words.test.mjs test/free-stays-free.test.mjs test/admin.test.mjs test/office.test.mjs }
```
