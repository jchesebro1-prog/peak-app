# iOS UI Punchlist — Overnight Safe Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 6 "safe to draft + test overnight" cosmetic/UX bugs from `docs/reviews/2026-09-22-ios-shell-ui-review.md` (triage items #5–#15), grouped by shared file into 6 tasks. Every task lands on this branch only — no push to `origin/main`, no merge, no deploy. Jeff reviews at 7am.

**Architecture:** Pure CSS/layout/JSX fixes in existing client components; no schema, no server-action, no data-model changes. Each task is scoped to one or two files that already exist.

**Tech Stack:** Next.js 16 App Router, React 19 inline-style components (this codebase does not use a CSS-in-JS library — styles are plain `style={{...}}` objects and a handful of classes in `src/app/globals.css`), `tsx` harnesses (`test:specs` pure, `test:smoke` real server).

## Global Constraints

- Node at `~/.local/node/bin`: `export PATH=$HOME/.local/node/bin:$PATH` first. Work in the worktree `/Users/sm/Downloads/peak-app/.claude/worktrees/ios-ui-punchlist` (branch `worktree-ios-ui-punchlist`), based on `origin/main` at `0e6fbe1`. `node_modules` is a symlink to the main checkout.
- **Do NOT touch triage items #1 (nav drawer), #2 (Estimator landing page), #3 (Reports → Installs KPI-overflow / card-overlap), or #4 (Inbox "Close" mutation)** — these are explicitly held for Jeff. Item #3 in particular shares a file (`reports/page.tsx`) and even a shared layout constant (`GRID_MAIN`) with Task 3 below — do not touch the Installs-tab (`renderInstalls`/second `GRID_MAIN` usage) code path at all, only the Sales-tab one.
- **Never submit a form, click Save/Send/Delete/Win/Lose, or otherwise mutate data while verifying in the simulator** — same production-data rule as the review pass. Verification is visual (screenshot) and structural (read the diff), not "click through the live app and create records."
- **Baseline gates** (run once before Task 1 to record the starting numbers, then after every task): `npx tsc --noEmit 2>&1 | grep -c 'error TS'`, `npx eslint <touched files>`, `npx tsx scripts/test-review-and-spec.ts 2>&1 | grep -c '^FAIL'`. `test:smoke` boots its own dev server — confirm `ps aux | grep -E 'tsx|next dev' | grep -v grep` is empty first, never run it alongside anything else.
- No emoji in UI copy. No hardcoded accent colors — use `var(--accent)` / existing color tokens already present in the file you're editing.
- `git add` only the files each task names. Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Do NOT run `npx cap sync`, Xcode, or any simulator command inside a subagent task — verification is code-reading + the gates above. The controller (main session) will do a final simulator screenshot pass after all tasks land.

---

## File Map

| File | Task | Fix |
|---|---|---|
| `src/components/nav/Nav.tsx` | 1 | Header company-name room, drawer profile-row safe-area padding, hamburger toggle |
| `src/app/(app)/home-tabs.tsx` | 2 | Tab row: wrap → horizontal scroll |
| `src/app/(app)/reports/page.tsx` | 3 | Sales-tab chart-overlap (GRID_MAIN, scoped) + Installs chart-label spacing (typography only) |
| `src/app/(app)/inbox/thread-list.tsx`, `src/app/(app)/inbox/thread-reader.tsx` | 4 | Row toolbar/text overlap; close-button visibility |
| `src/app/(app)/projects/view.tsx` | 5 | Project-detail tab row: clipped "Timeline" label |
| `src/app/(app)/quotes/page.tsx` | 6 | Status-button spacing in the inline quote-detail panel |

---

### Task 1: Nav.tsx — header truncation, drawer safe-area, hamburger toggle

**Files:**
- Modify: `src/components/nav/Nav.tsx`

**Context:** Three separate findings, all in this one file, all low-risk CSS/behavior tweaks.

1. **Header company name (review item #5).** `.pk-company` (in `src/app/globals.css:121-129`) already truncates with an ellipsis (`white-space:nowrap; overflow:hidden; text-overflow:ellipsis`) — that part is working as designed. The real problem is there's so little room left for it next to the BETA pill, Synced pill, and bell that it truncates to "Peak Syst…" even for a company name that isn't that long. Read `Nav.tsx` around the header JSX (search for `pk-company`, roughly lines 200-266) and the `narrow` state (already tracked in this file, `useState` + a resize listener — search for `const [narrow`). Below the `narrow` breakpoint, hide the `.pk-company` text node entirely (render `null` for it, keep the logo mark) so the header reads as mark + BETA + Synced + bell only on phone width — the same "logo carries the brand, full name is a desktop nicety" pattern most apps use. Do not change `.pk-company`'s CSS (still correct for wider layouts where it does have room). Read `src/app/globals.css:97-102` (`.pk-nav-left`) to confirm `min-width:0` stays in place (needed for the ellipsis to work at all).

2. **Drawer profile row overlaps the status bar (review item #7).** Read the drawer's profile-row block (search for `user.initials` inside the `narrow && drawerOpen` block, roughly lines 663-693 — the `<div style={{display:"flex", alignItems:"center", gap:11, padding:"16px 16px 14px", ...}}>` wrapping the avatar circle, name/role text, and close button). Add top safe-area room: either bump this row's top padding to include `env(safe-area-inset-top)` (matching the pattern already used in `.pk-nav`'s CSS at `globals.css:95`: `calc(11px + env(safe-area-inset-top))`), or add `paddingTop: "calc(16px + env(safe-area-inset-top))"` to this specific div's inline style (simpler, scoped to just this drawer row, doesn't touch the shared `.pk-nav` class other screens rely on). Use the inline-style approach — it's local to this one element and can't have side effects elsewhere.

3. **Hamburger doesn't toggle-close (review item #15).** Find the hamburger button's `onClick` — it currently reads `onClick={() => setDrawerOpen(true)}` (search for that exact string). Change it to toggle: `onClick={() => setDrawerOpen((open) => !open)}`.

- [ ] **Step 1: Make the three edits described above.** Read the surrounding ~15 lines before each edit to match existing formatting/indentation exactly.
- [ ] **Step 2: Typecheck + lint.** `npx tsc --noEmit 2>&1 | grep -c 'error TS'` must equal the baseline you recorded before Task 1 (record it now if you haven't: run the same command on a clean worktree first). `npx eslint src/components/nav/Nav.tsx` clean.
- [ ] **Step 3: Visual check is NOT part of this task** — the controller does one combined simulator pass after all 6 tasks land, to avoid 6 separate rebuild/resync cycles. Confirm your change compiles and reads correctly by re-reading the final diff, not by rebuilding the app.
- [ ] **Step 4: Commit.**

```bash
git add src/components/nav/Nav.tsx
git commit -m "fix(nav): hide company name at phone width, safe-area pad the drawer profile row, hamburger toggles open/closed

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Home tab row — wrap to scroll

**Files:**
- Modify: `src/app/(app)/home-tabs.tsx`

**Context:** The tab row (`Dashboard | My Queue | Calendar | Inbox | Reports`) uses `flexWrap: "wrap"` (search for it, in the `<div style={{display:"flex", gap:6, flexWrap:"wrap", ...}}>` wrapping the `HOME_TABS.map(...)`) — deliberate, but at phone width it wraps "Reports" to its own second line, costing vertical space and reading like a layout mistake (review item #6).

- [ ] **Step 1:** Change that wrapper's style from wrapping to horizontally scrolling with no visible scrollbar and no wrap:

```tsx
style={{
  display: "flex", gap: 6, flexWrap: "nowrap",
  overflowX: "auto", WebkitOverflowScrolling: "touch",
  scrollbarWidth: "none", msOverflowStyle: "none",
  borderBottom: "1px solid #eef0f3",
  paddingBottom: 10, marginBottom: 18,
}}
```

  (`scrollbarWidth`/`msOverflowStyle` hide the scrollbar in Firefox/older Edge; for WebKit/Chrome, also add a one-off CSS rule since inline styles can't target `::-webkit-scrollbar`. In `src/app/globals.css`, near the other `.pk-*` rules, add:

```css
.pk-home-tabs-scroll::-webkit-scrollbar {
  display: none;
}
```

  and add `className="pk-home-tabs-scroll"` to the same wrapper div in `home-tabs.tsx`, alongside its existing `style` prop.)
- [ ] **Step 2:** Each `<Link>` inside needs `flexShrink: 0` added to its existing `style` object so tabs don't get squeezed instead of scrolling — read the `Link` block right after the wrapper (search for `HOME_TABS.map((t) =>`) and add `flexShrink: 0` to its style object.
- [ ] **Step 3: Typecheck + lint.** `npx tsc --noEmit 2>&1 | grep -c 'error TS'` unchanged from baseline. `npx eslint src/app/\(app\)/home-tabs.tsx src/app/globals.css` — eslint won't lint the `.css` file (no rule for it), just confirm `npx tsc` is clean and the CSS file parses (`grep -c "pk-home-tabs-scroll" src/app/globals.css` returns 1).
- [ ] **Step 4: Commit.**

```bash
git add "src/app/(app)/home-tabs.tsx" src/app/globals.css
git commit -m "fix(home): tab row scrolls horizontally at phone width instead of wrapping to 2 lines

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Reports — Sales-tab chart overlap (scoped) + Installs label spacing (typography only)

**Files:**
- Modify: `src/app/(app)/reports/page.tsx`

**Context — read this carefully, it defines the boundary of this task:**

`GRID_MAIN` (search for `const GRID_MAIN`, around line 494) is `{ display:"grid", gridTemplateColumns:"minmax(0,1fr) 340px", gap:18, alignItems:"start" }` — a hard-coded two-column grid with **no responsive breakpoint at all**. It's spread onto a `<div style={GRID_MAIN}>` in **two places**: once in the Sales-tab render (search for the first `<div style={GRID_MAIN}>`, it's followed by a `ChartCard` containing `<StackedBars bars={bars} .../>` — this is the LEFT column with the "Quoted vs. won by month" chart, and the RIGHT column has the "Win rate" `Donut` and "Top customers by won value" card) and once in the Installs-tab render (the second `<div style={GRID_MAIN}>`, further down the file). **Only touch the Sales-tab one. Do not touch the Installs-tab one or the shared `GRID_MAIN` constant itself** — Installs' overflow/card-overlap is review item #3, explicitly held for Jeff, and it happens to share this constant; touching the constant would change Installs' rendering too, which is out of scope tonight.

Root cause of review item #9 (stray gray bar + "$2k" label overlapping "Top customers by won value"): at phone width, `minmax(0,1fr)` next to a fixed `340px` column leaves the left column only ~40-50pt wide — far too narrow for `StackedBars`' 4+ flex bars. `StackedBars` (search for `function StackedBars`, around line 265) renders each bar's dollar value (`b.top`, e.g. "$2k") in normal flow above the bar, and each bar's category label (`b.label`) `position:absolute; bottom:-22px` relative to the bar column. When the column is squeezed to near-zero width, this text doesn't shrink — it overflows sideways out of the narrow left column, past the 18px grid gap, and lands on top of the right column's cards, which is exactly what review item #9 describes.

- [ ] **Step 1:** Locate the FIRST (Sales-tab) `<div style={GRID_MAIN}>` only. Replace `style={GRID_MAIN}` on that one element with an inline override that collapses to a single column below 700px, using the same media-query-via-CSS-class approach already used elsewhere in this codebase for breakpoints (check `src/app/globals.css` for any existing `@media` rules on report/grid classes as a pattern reference; if none exist, add a new class). Add to `src/app/globals.css`:

```css
.pk-reports-sales-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 18px;
  align-items: start;
}
@media (max-width: 700px) {
  .pk-reports-sales-grid {
    grid-template-columns: 1fr;
  }
}
```

  Then change that one `<div style={GRID_MAIN}>` to `<div className="pk-reports-sales-grid">` (drop the `style={GRID_MAIN}` prop entirely on this element only — `GRID_MAIN` itself stays untouched for the Installs-tab usage).
- [ ] **Step 2 (review item #12, typography only):** On the Installs tab, find the backlog-timeline chart whose x-axis month labels run together ("SepNovJanMarMay Jul Sep" per the review). Search for month-label rendering near a "backlog" or "timeline" chart — likely a `.map` over month abbreviations rendered as adjacent `<span>`s or a flex row with no gap. Add `gap: 4` (or similar small value) to that row's flex container, or `marginRight`/`letterSpacing` to the individual label spans if they aren't in a flex row — whichever matches the existing structure. **This is a spacing-only change: do not touch the surrounding chart's layout, sizing, or the "Book by stage"/"Project by location" overlapping cards** (that's item #3, held). If you cannot find a change that is purely additive spacing without touching anything else on the Installs tab, stop and report DONE_WITH_CONCERNS rather than risk scope creep into item #3.
- [ ] **Step 3: Typecheck + lint.** `npx tsc --noEmit 2>&1 | grep -c 'error TS'` unchanged. `npx eslint "src/app/(app)/reports/page.tsx"` clean.
- [ ] **Step 4: Self-review the diff for exactly this scope** — `git diff` should touch only the Sales-tab `GRID_MAIN` usage (now a className) and the Installs month-label spacing. If `git diff` shows any change to the Installs-tab `<div style={GRID_MAIN}>` line, the `GRID_MAIN` constant, or the "Book by stage"/"Project by location" cards, undo it before committing.
- [ ] **Step 5: Commit.**

```bash
git add "src/app/(app)/reports/page.tsx" src/app/globals.css
git commit -m "fix(reports): Sales-tab chart grid collapses to one column at phone width; Installs month-label spacing

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Inbox — thread-list overlap + thread-reader close-button visibility

**Files:**
- Modify: `src/app/(app)/inbox/thread-list.tsx`
- Modify: `src/app/(app)/inbox/thread-reader.tsx`

**Context:**

1. **Thread-list row overlap (review item #10).** In `thread-list.tsx`, sender/subject text already has `whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"` in several places (search for those three properties together — there are ~5 occurrences; the ones inside the main row-rendering block, roughly lines 130-180 and 430-480, are the relevant ones for sender name and subject). The action-icon toolbar (archive/flag/pin/delete) is a sibling element, right-aligned. The bug: the text element's `flex`/width isn't accounting for the toolbar's width, so the ellipsis triggers only when the text overflows the ROW, not when it overflows the space actually available before the icons. Find the row's flex container (parent of both the text block and the icon toolbar) and confirm the text block has `flex: 1, minWidth: 0` (the `minWidth:0` is what lets `text-overflow:ellipsis` actually engage inside a flex child — if it's missing, that's the bug). If the text block is missing `minWidth: 0`, add it. If it already has `flex:1, minWidth:0` and the toolbar is the problem (e.g. the toolbar is absolutely positioned on top of the text instead of being a normal flex sibling), read enough of the surrounding structure to understand which, and fix whichever is actually wrong — don't guess blindly, read the real JSX first.

2. **Thread-reader close button visibility (review item #11).** In `thread-reader.tsx`, a close button already exists and is conditionally rendered `{variant === "overlay" && (...)}` (search for `variant === "overlay"`, around line 673) — and `inbox-shell.tsx` already passes `variant="overlay"` for the narrow/mobile case (confirmed — don't re-verify this, it's correct). So the button should be present; the review finding may be about low visual contrast rather than absence: the button today is `width:32, height:32, border:"1px solid #e4e7ec", background:"#fff", color:"#5b616e", fontSize:17` — a light-gray-bordered white square with a gray "×" on a white header background, which can be genuinely hard to spot in a quick glance. Increase its visual weight: change `border` to `"1px solid #c7cbd3"` (darker), `background` to `"#f1f2f5"` (matches the muted-chip background pattern used elsewhere in this same file — search for `"#f1f2f5"` to confirm it's an existing token in this file, not a new color), and `color` to `"#16181d"` (near-black, matches the file's primary text color — search for `"#16181d"` to confirm). Keep the size and `×` character as-is; this is a contrast fix, not a redesign.

- [ ] **Step 1:** Read `thread-list.tsx` around both flagged line ranges, identify and fix the actual overflow cause per the investigation guidance above.
- [ ] **Step 2:** Make the close-button contrast edit in `thread-reader.tsx` exactly as specified.
- [ ] **Step 3: Typecheck + lint.** `npx tsc --noEmit 2>&1 | grep -c 'error TS'` unchanged. `npx eslint "src/app/(app)/inbox/thread-list.tsx" "src/app/(app)/inbox/thread-reader.tsx"` clean.
- [ ] **Step 4: Commit.**

```bash
git add "src/app/(app)/inbox/thread-list.tsx" "src/app/(app)/inbox/thread-reader.tsx"
git commit -m "fix(inbox): thread-list text respects the icon toolbar's width; reader close button gets more contrast

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Project detail — clipped "Timeline" tab

**Files:**
- Modify: `src/app/(app)/projects/view.tsx`

**Context (review item #13):** the project-detail tab row (Overview/Procurement/Deliveries/Timeline) clips "Timeline" at the right screen edge — the tab bar doesn't scroll or wrap. Search `view.tsx` for the tab row (likely a `.map` over an array of tab labels including `"Timeline"`, rendered as a flex row). Apply the same fix pattern as Task 2: `flexWrap: "nowrap", overflowX: "auto", WebkitOverflowScrolling: "touch"` on the row container, `flexShrink: 0` on each tab button/link. If this tab row already shares a component with Task 2's home-tabs scroll pattern (unlikely, but check), reuse it; otherwise this is an independent inline fix, no shared component needed for two occurrences.

- [ ] **Step 1:** Find the tab row, apply the scroll-not-clip fix.
- [ ] **Step 2: Typecheck + lint.** `npx tsc --noEmit 2>&1 | grep -c 'error TS'` unchanged. `npx eslint "src/app/(app)/projects/view.tsx"` clean.
- [ ] **Step 3: Commit.**

```bash
git add "src/app/(app)/projects/view.tsx"
git commit -m "fix(projects): detail tab row scrolls instead of clipping 'Timeline' at the edge

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Quotes — status-button spacing

**Files:**
- Modify: `src/app/(app)/quotes/page.tsx`

**Context (review item #14):** in the inline quote-detail panel, "Submit for review"/"Resubmit for review" (search for that string, around line 881) and the status-change buttons that follow it (search for `name="status"` — several `<button type="submit" name="status" value="...">` for sent/won/lost, right after) are stacked with tight spacing and no visual separation between "safe to browse" actions and "changes status" actions.

- [ ] **Step 1:** Find the container wrapping these buttons/forms (the parent of the `<form action={setQuoteStatus}>` blocks). Increase the gap between them (if the parent is a flex/grid container, bump its `gap`; if buttons are adjacent with only `marginRight`/`marginBottom`, increase those values). A reasonable target: at least 10-12px between distinct action buttons, and if the container doesn't already visually separate the "Submit for review" form from the status-change buttons below it, add a `borderTop` or extra `marginTop` between those two groups so they don't read as one dense button cluster. Match the file's existing spacing scale (search nearby for other `gap:`/`marginTop:` values used in this file to stay consistent — don't invent a new value out of nowhere).
- [ ] **Step 2: Typecheck + lint.** `npx tsc --noEmit 2>&1 | grep -c 'error TS'` unchanged. `npx eslint "src/app/(app)/quotes/page.tsx"` clean.
- [ ] **Step 3: Commit.**

```bash
git add "src/app/(app)/quotes/page.tsx"
git commit -m "fix(quotes): more breathing room between status-change buttons in the inline detail panel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7 (controller, not a subagent): Combined simulator verification

After Tasks 1-6 all land clean:
- [ ] Run the full gate suite once on the final tree: `npx tsc --noEmit`, `npx eslint` on all touched files, `test:specs`, `test:smoke` (with no stray `tsx`/`next dev` processes first).
- [ ] `npm run build` locally to catch anything the dev-only gates miss (this branch will NOT be deployed — this is just a build-health check, same as the native-auth work's Task 6 gate).
- [ ] Boot `next dev` on this branch with `CAPACITOR_SERVER_URL=http://<LAN-IP-or-localhost>:3000`, `npx cap sync ios`, rebuild the `App` scheme for the booted simulator, and screenshot each of the 6 fixed screens to confirm visually before writing up the summary for Jeff.
