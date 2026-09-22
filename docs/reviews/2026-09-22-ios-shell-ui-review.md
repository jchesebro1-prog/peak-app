# iOS native-shell UI review — 2026-09-22

Reviewed on: iPhone 18 Pro simulator, iOS 27.0, Xcode 27 headless build of `App` scheme
(bundle `com.peaksystemsgroup.quartzite`), loading production (`quartzite-six.vercel.app`)
in the Capacitor remote/hybrid WKWebView shell. Signed in as Jeff Chesebro.

**Method:** navigated every top-level nav destination and their primary sub-views/tabs;
tapped navigational and read-only controls (tabs, filters, expand/collapse, drawers,
list items). Did NOT submit forms or trigger create/send/delete/win/approve actions —
this is a live production database with one shared Neon instance across
Production/Preview/Development, so a mutating click here is a real business-data change,
not a test. Flows that need exercising are called out below as "needs a safe test pass"
rather than clicked.

**Legend:** 🔴 broken/blocking · 🟡 visual/cosmetic · 🔵 UX friction (works, but awkward) ·
⚪ needs a safe test pass (mutating action, not clicked)

---

## Executive summary

**21 findings**: 5 🔴 blocking, 10 🟡 visual/cosmetic, 6 🔵 UX friction. Coverage was capped by
the #1 finding below — CRM, DESIGN, Settings, and Account (roughly two-thirds of the app's
screens) are unreachable from the native shell's nav and could not be visually reviewed at all
this pass.

### Triage for tonight

**Held for Jeff at 7am — needs a decision, not just a fix, or is foundational enough to want a
second pair of eyes before anything ships:**
1. 🔴🔴🔴 Nav drawer cuts off after PM's first 2 children — CRM/DESIGN/Settings/Account
   unreachable. (Plan: I'll draft a candidate fix overnight on a branch and use it locally —
   never deployed — to unblock reviewing the screens this hides, but the actual fix stays
   unmerged for your review.)
2. 🔴 Estimator's landing page shows a blank "New estimate" PDF preview instead of a
   configurator picker — need your call on whether that's a real bug or an actual (if
   confusing) leftover draft state.
3. 🔴 Reports → Installs: KPI row drags the whole page horizontally + two summary cards draw on
   top of each other — real bug, but the Installs report's chart-grid code is unfamiliar to me
   and touches a few charts at once; want your eyes on the approach before I start moving chart
   components around.
4. 🔵 Inbox "Close" silently mutates a thread's state (marks it closed) rather than dismissing
   the panel — a behavior/labeling call, not just a style fix.

**Safe to draft + test overnight (branch only, not merged/deployed without you):**
5. 🟡 Header company name truncates to "Peak Syst…"
6. 🟡 Home tab row wraps to 2 lines at phone width
7. 🟡 Nav drawer profile row overlaps the status bar/Dynamic Island
8. 🟡 Calendar month view: event pills truncate to one character, unreadable
9. 🟡 Reports → Sales: stray gray bar overlaps "Top customers by won value" text (looks like a
   stuck chart tooltip on touch)
10. 🟡 Inbox thread list: action-icon toolbar overlaps long sender names/subjects
11. 🔵 Inbox thread reader has no header/back button — only an 8pt edge strip
12. 🟡 Reports → Installs: chart x-axis month labels run together with no spacing
13. 🟡 Project detail: "Timeline" tab label clips at the screen edge
14. 🔵 Quotes: inline status buttons (Draft/Sent/Won/Lost) sit close together with no confirm step
15. 🔵 Hamburger doesn't close the drawer on a second tap — only backdrop-tap or navigating away does

**Needs a human, not a fix:**
16. 🔵 "My Quotes" nav row was unusually hard to hit precisely in testing — inconclusive,
    worth a 10-second manual check rather than trusting an automated verdict either way.
17. ⚪ Everything tagged ⚪ throughout — mutating flows (Submit for review, Save revision, quote
    status changes, task creation, Download PDF, etc.) that were deliberately not exercised
    against production and need a safe test pass (e.g. against a throwaway record, or in a
    non-production environment).

---
## Home / Dashboard

🟡 **Header company name truncates hard.** "Peak Systems Group" renders as "Peak Syst…" next to
the logo chip — the row (hamburger, logo+name, BETA pill, Synced pill, bell) is too tight at
phone width. Worth checking: does the full name matter here, or should the header drop the
company name on narrow screens and rely on the logo alone?

## Home / Reports tab (Sales sub-view)

🟡 **Home tab row wraps to two lines at phone width.** "Dashboard · My Queue · Calendar · Inbox"
fit line 1, "Reports" wraps alone to line 2. Works, but reads like a layout mistake and eats
extra vertical space above the fold.

🟡🟡 **Chart region: a stray vertical gray bar overlaps real content, obscuring text.** On
Reports → Sales → 6 months, below the "Win rate" donut card, a vertical light-gray rectangle
(looks like a leftover chart tooltip/cursor rail, likely Recharts) renders down through the
"Top customers by won value" card and visually cuts through the customer name ("H[...]onville
School District" — should read "Hendersonville School District" or similar) and the project
count ("2 [...]ects"). Confirmed NOT a transient tap artifact — persisted across a second,
no-input screenshot. Also a "$2k" label floats at the bottom edge of the donut ring, looking
like a mis-positioned axis/tooltip label rather than a legend item. Likely cause: a chart
tooltip/crosshair component whose hover state gets stuck "on" on a touch device (touch events
often register as hover-and-never-unhover on mobile web), or an absolutely-positioned element
with a wrong offset. **Obscures real data — flagging higher priority than typical cosmetic.**

## Home tabs / Nav drawer

### Nav drawer
- 🟡 Profile header row (avatar "JC" + role text) sits in the same vertical band as the status
  bar / Dynamic Island — the black pill visually cuts across the role text, and the clock sits
  right next to the avatar. Needs more top safe-area padding before the drawer's first row.
- Otherwise clean: group headers legible, no clipping, scrolls smoothly, Sign out/Settings
  separated by a divider at the bottom. All nav items are flat links (no accordion expand).

### My Queue
- No visual issues found. Empty state, "Assign something" form, and the assignee picker all
  render correctly.

### Calendar
- 🟡 **Month view is functionally unreadable.** Event pills truncate to a single character +
  ellipsis ("H…", "9…", "1…") — the grid is populated but you can't tell events apart without
  tapping in.
- 🔵 Week view is tight but workable (time + a couple truncated words); all-day events across
  every day column truncate to "Ho…".
- Day view is clean — full titles, no overlap. View-switcher itself works correctly.

### Inbox
- 🟡 Thread list rows: the always-visible action toolbar (archive/flag/pin/delete, right-aligned)
  overlaps long sender names/subjects instead of the text truncating before the icon column.
- 🟡 Thread reader has no header at all (no hamburger/logo/bell) and no visible back button —
  the only way out is tapping an ~8pt strip at the left screen edge, with the list visibly
  bleeding through underneath the whole time. Works, but undiscoverable.
- 🔵 **"Close" on a thread is a real state mutation (marks it closed), not a panel-dismiss
  action** — easy to mistake for "close this view." (Verified by toggling it and reopening;
  reverted cleanly.) Worth a copy/icon change, not just visual polish.
- ⚪ Owner dropdown, Mark replied, Reply/Reply all/Forward — not tested (mutating).

### Reports — Installs tab + chart layout
- 🔴 **KPI card row overflows the viewport and drags the whole page horizontally.** Swiping to
  see the clipped 4th card (Avg. Margin) scrolls the entire page — nav tabs included — sideways,
  with a horizontal scrollbar mid-page. Not a contained carousel; a real layout overflow.
- 🔴 **Two summary cards overlap outright** on the Installs report: "Book by stage" draws on top
  of "Project[s] by location," leaving only word fragments of the bottom card visible ("Proj…",
  "loca…", "0", "pin", "size", …).
  Chart region doesn't collapse to single-column at phone width — the same failure pattern.
- 🟡 Backlog timeline x-axis month labels run together with no spacing ("SepNovJanMarMay Jul Sep").
- The stray-gray-bar bug (Sales tab, logged above) does not reproduce on Installs — Installs has
  its own distinct overlap bugs.

## 🔴🔴🔴 CRITICAL — Nav drawer cuts off after PM's first two children; most of the app is unreachable

**Directly verified by me** (not just a subagent report — this contradicted an earlier subagent
claim, so I re-tested by hand twice with in-bounds swipe gestures before trusting it):

Opening the hamburger drawer shows, top to bottom: a "Synced" status card ("Last synced never" —
itself odd, see below), then **HOME** (all 5: Dashboard/My Queue/Calendar/Inbox/Reports), **EST**
(all 4: Quotes/My Quotes/Estimator/Reviews), **PM** — but only 2 of its 8 children (Projects,
My Projects); Schedule, Field Work, Flame Tests, Rigging Inspections, Repairs, and Rentals are
missing. Then a divider and "Sign out." **CRM (7 items: Opportunities, Leads, My Leads,
Companies, People, Venues, Venue Assessments), DESIGN (9 items), and Settings/Account are not
present at all.**

I tested scrolling the drawer with two separate, valid in-bounds swipe gestures (up-drag from
(200,800) to (200,250), 0.6s duration) — **zero visual change**, pixel-identical before/after.
This is not a "scroll further" problem; the content is clipped and the list does not respond to
touch-scroll in this shell.

**Root-cause hypothesis (for the brainstorm, not verified as THE fix):** read `src/components/
nav/Nav.tsx` — the drawer's scrollable `<nav>` (`flex:1; overflowY:auto`) sits inside a
`position:absolute; top:0; bottom:0` column, which should give it a definite height for the
overflow to work under normal CSS rules. Nothing in the codebase sets
`-webkit-overflow-scrolling: touch` on any scrollable region, and nothing in
`capacitor.config.ts` or the iOS `AppDelegate.swift` configures WKWebView scroll/bounce
behavior. A missing `-webkit-overflow-scrolling: touch` (or a touch-event conflict with the
backdrop's `onClick={() => setDrawerOpen(false)}`, which sits on the same gesture path) is the
leading suspect — this is a very common iOS WKWebView pattern where a nested `overflow:auto`
region scrolls fine with a mouse/trackpad (desktop testing) but silently fails to respond to a
touch drag. Worth testing whether this also reproduces in mobile Safari/Chrome (not just the
Capacitor shell) to know if it's a shell-specific fix or a shared responsive-CSS fix.

**Secondary, related finding:** the "Synced" card reads "Last synced never" right after a fresh
sign-in — worth checking whether that's expected first-run copy or a sync-state bug, since it
also eats ~300pt of the drawer's limited height, making the cutoff worse.

**Impact:** on the native iOS shell, only 11 of the app's ~30+ top-level destinations are
reachable at all (Home's 5, EST's 4, PM's first 2). **CRM, DESIGN, Settings, and Account could
not be visually reviewed in this pass because there is no way to reach them from the native app.**
This should be the #1 priority fix — it blocks real usage, not just this QA pass.

## Settings + Account — could not be reviewed (see critical nav finding above)

Confirmed unreachable via any path tried: avatar chip, header logo chip, and top-bar "P" logo
are all non-interactive; no bottom tab bar exists; the hamburger only ever opens the drawer
(tapping it again while open does not close it — only navigating away or tapping the backdrop
does, a minor UX inconsistency). As independent confirmation the routes exist server-side, an
out-of-session browser tab hitting `/settings` while signed out showed "Need access? Ask an
admin to add you in Settings → Team" — so the feature exists, it's just unreachable from this
build's nav. 🔵 Bell icon (2 pending) was not tested — opening it may mark items read.

## EST group (Quotes / Estimator / Reviews) + Projects

### Quotes (`/quotes`)
Renders cleanly. Stats, My work/Everyone toggle, status tabs, and type filter chips all update
the list and counts correctly (verified: "Flame test" filter recalculated to 1 quote/$0
pipeline/$956 won).
- 🔵 Tapping a row expands an inline detail panel exposing "Submit for review," a reviewer
  dropdown, "Save revision," and four status buttons (Draft/Sent/Won/Lost) stacked close
  together with no confirmation step — easy to mis-tap into a mutating action while just
  browsing a quote. Worth a second look at spacing/confirmation for status changes.
- ⚪ Submit for review / Save revision / status buttons / "Open repair quote" — not tested.

### My Quotes (`/quotes?who=mine`)
🔵 **Inconclusive — this nav row was unusually hard to hit precisely.** Repeated targeted taps
at coordinates that reliably landed on "Quotes" (the row above) or "Estimator" (the row below)
never visibly landed on "My Quotes" itself — either its tap target is smaller/misaligned versus
its neighbors, or this is aim error on a very tightly packed (~39pt-row) list that automated
testing couldn't resolve either way. Worth a 10-second manual tap-test on a real device rather
than trusting this report either way.

### Estimator (`/estimator`)
🔴 **Landing page is not the expected configurator picker — it's a live PDF preview of a blank,
unsaved "New estimate."** Confirmed independently (hit this screen twice from two different
navigation attempts): shows "New estimate," today's date, "Prepared by Jeff Chesebro," no
customer in PREPARED FOR, all SHOW ON PDF boxes pre-checked, a Format dropdown reading
"Unknown," and a "Download PDF" button — with a banner "View only on phone — open on iPad or
desktop to edit." Whether this is the intended landing state or a wrong-default/leftover-draft
bug, it does not match what "Estimator" should show (a picker among the 3 configurators). No
mutation risk (view-only on phone). ⚪ "Download PDF" not tested.

### Reviews (`/reviews`)
No visual issues found. My queue / Unclaimed / Submitted by me tabs switch correctly, each with
an appropriately worded empty state.

### Projects (`/projects`)
Renders cleanly — stats, Open scheduler/Won quotes buttons, status tabs, My work/Everyone
toggle, teammate filter, and List/Board toggle all work without overflow. Opened one record
(Hortonville School District, S-4001) read-only: Materials/Deliveries checklist, tabs, value
cards, field progress — no issues navigating in and back out.
- 🟡 In the project detail's tab row (Overview/Procurement/Deliveries/Timeline), "Timeline"
  clips at the screen edge ("Timeli...") — the tab bar doesn't scroll or wrap.
- ⚪ "Add a task…" input + Install/Unassigned dropdowns + Add — not tested.

### My Projects (`/projects?who=mine`)
Confirmed functionally distinct from Projects (My work pre-selected, teammate pill reads "Jeff
Chesebro (me)"), same single record shown since Jeff is PM on it. No visual issues.

