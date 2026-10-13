# Pop-out Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Implement `docs/superpowers/specs/2026-10-13-popout-windows-design.md`:
- named pop-out windows for the Inbox, a thread, the Estimator and a customer record
- pop-out mode: no nav, a slim header, Open in main window
- ⧉ buttons, a nav hover ⧉, and shift-click
- per-kind window geometry memory
- live cross-window refresh via `BroadcastChannel("peak")`

**Architecture:** all client-side.
- Pure helpers in `src/lib/popout/` handle names, geometry, the guard decision and message shapes.
- Client components handle the head script, `PopHeader`, `LiveSync`, `PopoutButton`, `PopLink` and the nav ⧉.
- Posters are added to the existing save paths.
- No server, data or route changes.

**Tech stack:** Next.js 16 App Router (read `node_modules/next/dist/docs` before using Script or head APIs), React client components, CSS in `src/app/globals.css`, and the tsx harness.

## Global Constraints

- The spec is binding. Window name is `peak-pop:<kind>:<id>`, and the kinds are `inbox | thread | estimate | customer`.
- The head script only reads `window.name` and only adds the `pk-pop` class. It does no network work and calls no storage.
- Every `BroadcastChannel`, `localStorage` and `window.open` call goes inside try/catch and degrades silently. Server render must never touch `window`.
- Self-ignore uses a per-window id carried in the message, not a time window. The typing guard defers a refresh until 3 s after the last keystroke in an editable field.
- Pop-out affordances are hidden below a 900 px viewport and in the native shell. Check how the app detects Capacitor or the native shell; search for `Capacitor` / `isNative`.
- Existing behaviour must not change for plain clicks, cmd/ctrl-clicks, or any screen that doesn't pop out.
- Client components import only actions, pure modules and types (store imports break only in `next build`).
- Process rules (same as before):
  - No `server-only`.
  - PGlite is single-process; never touch `.data/pglite`.
  - Never `git stash`.
  - Never `git add .superpowers/`.
  - Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Use targeted Edits only in `scripts/test-review-and-spec.ts`.
  - `export PATH=$HOME/.local/node/bin:$PATH`.
- Tests go in a new `scripts/test-popout.ts` (`npm run test:popout`; same mktemp/cleanup script pattern as `test:inbox-org`), chained into `test:specs`.

---

### Task 1: Pure core + channel

**Files:** `src/lib/popout/names.ts`, `geometry.ts`, `guard.ts`, `channel.ts`, `scripts/test-popout.ts`, `package.json`, plus harness wiring. Migrate `src/lib/inbox-org/broadcast.ts` and its callers (`organize-box.tsx`, `src/components/inbox-changed-listener.tsx`, the reader-org posts) to the new channel.

**What each module provides:**
- **`names.ts`**
  - `popName(kind, id)`
  - `parsePopName(name): {kind, id} | null`
  - `isPopName(name)`
- **`geometry.ts`**
  - `DEFAULT_GEO: Record<PopKind, {width, height}>`. Defaults: estimate 1100×800, customer 900×800, thread/inbox 760×800.
  - `clampGeo(saved, screen: {availLeft, availTop, availWidth, availHeight}) → {left, top, width, height}`. Keeps at least 100 px visible, caps the size to the screen, and centres the defaults on the screen.
  - `featuresFor(geo)` returns the `popup=yes,left=…,top=…,width=…,height=…` string.
  - `geoKey(kind)`.
- **`guard.ts`**
  - `shouldRefreshNow({ lastKeyAt, now, activeIsEditable })` returns `"now" | { deferMs }`.
  - `shouldFocusRefresh(lastRefreshAt, now)` is true when more than 30 s have passed.
- **`channel.ts`** (client-safe, no React)
  - Types: `Changed = {type:"changed"; entity: "thread"|"quote"|"customer"|"task"|"inbox"; id?: string; from: string}` and `OpenInMain = {type:"open-in-main"; url: string; from: string}`, plus the `{type:"main-ack"}` reply.
  - `windowId()` is stable per window, kept in a module variable and `sessionStorage`.
  - `postChanged(entity, id?)`, `postOpenInMain(url)`, `onMessage(handler) → unsubscribe`.
  - Backward compatible: `onMessage` also maps a legacy `{type:"inbox-changed", threadId}` to `changed/thread`.
- **Tests:** names round-trip, clamp (including off-screen and oversized), the guard table, and that a message's `from` lets a window ignore its own posts.
- **Gates:** test:popout, test:inbox-org (to confirm the migration), tsc. Commit.

### Task 2: Pop-out mode + LiveSync

**Files:** `src/app/layout.tsx` (head script), `src/app/globals.css`, `src/components/popout/pop-header.tsx`, `src/components/popout/live-sync.tsx`, `src/app/(app)/layout.tsx` (mount once), and removal of `inbox-changed-listener` usage on Home and in the Inbox shell (replaced by `LiveSync`).

- **Head script:** an inline, synchronous script that runs before paint:
  ```js
  try { if ((window.name || "").indexOf("peak-pop:") === 0) document.documentElement.classList.add("pk-pop") } catch (e) {}
  ```
  Use the Next 16-recommended way to put a raw inline script in the root layout `<head>`; read the docs. Add `suppressHydrationWarning` on `<html>` if the class causes a mismatch (check whether `<html>` already has it).
- **CSS:**
  - `html.pk-pop` hides the nav root. Find the Nav's root className in `src/components/nav/Nav.tsx`.
  - `.pk-shell` becomes a single column and `.pk-main` goes full width.
  - `.pk-pop-header` is `display: none` except under `html.pk-pop`.
  - Use the design tokens and never hardcode accent colours.
- **`PopHeader`:**
  - Renders the title (from `document.title`, updated on route change).
  - **Open in main window:** call `postOpenInMain(location.href)` and wait 500 ms for a `{type:"main-ack"}` reply. If none comes, `window.open(url, "_blank")`.
  - **✕** calls `window.close()`.
- **`LiveSync`:** one per window.
  - On any `changed` message not from itself, refresh using the guard (debounce 1 s, typing deferral).
  - On visibility or focus, refresh when the 30 s rule says so.
  - In the main window (no `pk-pop`), handle `open-in-main`: reply `main-ack`, call `window.focus()`, then `router.push(url)`.
  - Track `lastKeyAt` with a capture-phase `keydown` listener on editable targets.
- **Tests:** source pins (head script content, LiveSync/PopHeader mounted once in the (app) layout, old listener removed), plus the guard logic already covered in Task 1. Run `next build`. Commit.

### Task 3: Opening affordances

**Files:** `src/lib/popout/open.ts` (client), `src/components/popout/popout-button.tsx`, `src/components/popout/pop-link.tsx` (or a `usePopoutClick` hook), `src/components/nav/Nav.tsx` (hover ⧉ on Inbox, Estimator and Customers), plus the four headers:
- Inbox shell header (whole box)
- thread reader header
- Estimator header (`estimator-header.tsx`; hidden until the quote has an id)
- customer record header (`src/app/(app)/companies/[id]`)

And the shift-click sites:
- Inbox thread list rows
- Quotes hub rows
- customer record quote lists
- Home quote cards
- the companies directory rows

- **`openPopout(kind, id, url)`:**
  - Reads the geometry (try/catch).
  - Calls `window.open(url, popName(kind, id), featuresFor(clampGeo(...)))`.
  - When the call returns null, shows the existing toast system's message: "Your browser blocked the window — allow pop-ups for this site." Find the toast helper; if none exists, use a small inline banner.
- **Saving geometry:** each pop-out saves its geometry on resize (debounced 500 ms) and on `beforeunload`, keyed by the parsed kind. Put this in `LiveSync` or a small `PopGeometry` component mounted in the layout.
- **Shift-click:** `onClick` with `e.shiftKey && !e.metaKey && !e.ctrlKey` → `preventDefault` + `openPopout`. All other clicks are untouched.
- **Hiding:** affordances are hidden below 900 px (CSS media query) and in the native shell.
- **Tests:** source pins for the four headers and the nav, a pure check of the shift-click decision function, and `next build`. Commit.

### Task 4: Posters

Add `postChanged(...)` after successful saves:
- **Estimator** (`src/app/(app)/estimator/*`): save quote, status change, submit/approve/send/withdraw, client-package selection, Grid link. Post `quote`, with the quote id.
- **Customer record** (`src/app/(app)/companies/[id]/*` and the company actions): edits, contacts, venues, notes, documents. Post `customer`, with the company id.
- **Tasks:** create, complete, delete in the task dialogs, the Home queue, thread task actions and the Organize promise-task undo. Post `task`.

Post client-side after the action returns ok, in the client components that call these actions. **Tests:** source pins listing each poster site. tsc, `next build`. Commit.

### Task 5: Docs, gates, browser check

- DECISIONS D902+ (recheck numbering), PUNCHLIST #336, AGENTS phase 55, MASTER-HOWTO section ("Pop-out windows").
- Gates: test:popout, test:inbox-org, test:assist, tsc, eslint (changed files), `next build`, test:specs (0 FAIL), test:smoke.
- Browser check if feasible:
  - Start a scratch dev server per the repo's worktree notes. Never use the main `.data/pglite`. If the only launch config opens the real DB, skip this and say so.
  - In the browser pane, verify that a pop-out URL loaded with `window.name` set (e.g. via `javascript_tool`: `window.name="peak-pop:estimate:x"; location.reload()`) hides the nav and shows the pop header.
  - Verify the ⧉ button exists on the Estimator.
- Commit docs. The controller pushes after the final review.
