# Frills Workspace Rules

## Mandatory Hallmark UI Audit & Visual Screenshot Scan (ALWAYS)

Every time any UI, CSS, HTML, SVG, or editor layout file is created or modified in this repository, you MUST run a real **Hallmark UI audit** and **visually inspect rendered screenshots one by one** before handing back to the user — never guess what the UI looks like from code alone.

### Required Procedure on Every UI Change
1. **Load Hallmark criteria:** Read `C:\Users\drodo\.claude\skills\hallmark\SKILL.md` (and `references/verbs/audit.md`, `references/slop-test.md`, `references/responsive.md`, `references/interaction-and-states.md`, `references/anti-patterns.md`) plus Frills's locked `tokens.css` and `.hallmark/preflight.json`.
2. **Build & render in headless Chrome:** Run `node build.mjs`, serve `dist/` locally (e.g. `node scripts/serve.mjs 3020`), and capture real PNG screenshots using `scripts/lib/chrome.mjs` across:
   - **Mobile & tablet viewports:** `320px`, `375px`, `414px`, and `768px`
   - **Desktop viewport:** `1280px`
   - **Every affected UI state:** e.g. `Simple setup` vs. `Advanced`, active/pressed buttons, open builders/cards, and scrolled Step 4 / `.cloud-tip` / `.cloud-nudge` states.
3. **Inspect every screenshot one by one with `read_file`:** Do not rely only on DOM assertions or `scrollWidth <= clientWidth` (remember `overflow-x: clip` hides scrollbars even when panel children silently clip off-screen or behind a sticky `.preview`!). Visually verify alignment, spacing, truncation, overlaps, contrast, and typography on each PNG.
4. **Enforce Frills + Hallmark non-negotiables:**
   - **Locked tokens only (Gate 48):** Every site-UI color, font, radius, spacing, and easing must come from `tokens.css` (no hardcoded `#hex`, `rgba(...)`, or undefined `--border`/`--surface`/`--font-ui` vars). Preserve `tokens.css`, `src/css/fonts.css`, and `public/fonts`.
   - **No re-drawn OS chrome (Gate 47):** Never draw macOS traffic-light dots, fake browser bars, or fake phone frames.
   - **Single-line clickables & no grid blowout (Gates 34 & 49):** Keep buttons, chips, tabs, nav links, and badges single-line; lock grid containers (`.panel`, `.step-card`, `.stack`) to `grid-template-columns: minmax(0, 1fr); min-width: 0;`.
   - **8-state controls & 44px touch targets (Gates 26 & 39):** Every interactive button/input must define default, `@media (hover: hover)`, instant `:focus-visible`, `:active`, `:disabled`, constant `1px` border width, and `>= 44px` hit target (using `::before` expansion for compact icon buttons).
   - **Strict CSP & Free-stays-free:** Zero inline `style=""` attributes (strict `style-src 'self'`), no `blob:` in `img-src`, and `test/free-stays-free.test.mjs` must always pass.
5. **Re-scan after fixes:** After fixing any Hallmark or visual finding, rebuild, capture **after** screenshots, inspect them with `read_file`, and run the relevant browser & unit tests before reporting back.
