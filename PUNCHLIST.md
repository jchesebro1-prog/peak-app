# Peak Punch List

Running list of requested changes. Jeff adds items (often with screenshots); nothing gets
implemented until he says so. Statuses: `OPEN` → `IN PROGRESS` → `DONE`.

---

## 1. Inbox must actively sync with Gmail state — DONE (D73/D74)

**Area:** `/inbox` — `src/app/(app)/inbox/` (likely `page.tsx`, `actions.ts`, `thread-list.tsx`)
plus `src/lib/gmail/api.ts`

**Reported:** 2026-07-16

**Ask:** The inbox needs to actively sync. If an email is archived or filed into a folder
(on the Gmail side), it should stop showing up in the Peak inbox.

**Notes / what to figure out when implementing:**
- Current behavior appears to be a one-way pull that doesn't reconcile removals — threads that
  lose the `INBOX` label elsewhere are presumably still listed.
- Needs a real reconcile, not just an append: honor Gmail label state (`INBOX` present/absent),
  and drop or hide threads that no longer qualify.
- Decide the sync trigger: on page load, polling interval, and/or Gmail push notifications
  (watch + Pub/Sub). Jeff's phrasing "actively sync" suggests he expects it to keep up on its
  own, not only on manual refresh.
- Confirm whether Peak stores threads locally (cache/DB) or reads live from the Gmail API —
  that determines whether this is a cache-invalidation fix or a query fix.

**Status:** DONE (code) — implemented 2026-07-19, decision **D73**. What ships:
- **Reconcile:** every sync ends with an ids-only `threads.list in:inbox` sweep per
  mailbox; threads archived OR filed on the Gmail side get `gmailInboxed=false`, leave
  the Peak inbox, and show under Archived. Gmail putting a thread back flips it back.
  Covers the initial-import case (which used to pull Gmail-archived mail straight into
  the inbox) and cursor resets. Local Peak archive stays separate — no flip-flop wars.
- **"Actively":** the inbox now background-syncs on open and every 3 min while visible,
  throttled server-side by atomic per-mailbox claims (≥2 min apart, any number of
  tabs/users). No cron or push infrastructure needed.
- Adjacent fixes: a new inbound resurfaces a locally-archived thread (mirrors Gmail);
  Needs-reply stops counting Gmail-disposed threads; the reader's Archive button now
  toggles to Unarchive; bridge thread creation made race-safe.
- Verified: predicate exercised end-to-end against the dev DB (thread left inbox →
  appeared in Archived → reverted); two adversarial review rounds (findings fixed);
  tsc + build + browser. **Not yet live-tested against real Gmail** — dev has no Google
  creds (blocked on the deploy accounts, item Q-A). First real Send/Receive after
  connecting will also file all Gmail-archived mail from the 90-day import into
  Archived — expect that one-time shuffle.
- **ANSWERED 2026-07-19 (Jeff) and built the same day (commit `8315b54`, D74):**
  - **Server-side sync** — a boot timer covers any long-running server, and
    `/api/gmail/sync` + `vercel.json` crons cover Vercel (needs a `CRON_SECRET` env
    var at deploy time; DEPLOY.md documents it, incl. the Hobby-plan cron limitation).
  - **Two-way archive** — built. Archiving in Peak archives in Gmail (and Unarchive
    re-inboxes). Mailboxes connected before this need a one-time **Reconnect** in
    Settings → Mailboxes to grant the extra permission.

---

## 2. Site visits: schedule → customer link → calendar invite → in-app calendar — DONE (D76/D77/D81)

**Area:** new feature. Touches `/inbox`, `/customers`, `/schedule`, `src/lib/gmail/*`
(OAuth), and a new `src/lib/google/calendar.ts` + likely a new `/calendar` route.

**Reported:** 2026-07-16

**Ask (Jeff's words, unpacked):**
1. Schedule a **site visit** and **link it to a customer**.
2. It **auto-sends a calendar invite** he can drop into his calendar, carrying: contact name,
   venue address, reason for the visit, and the contact's info.
3. **Event title = venue name + reason for the site visit.**
4. Creatable **from inside the Inbox tab**, then pushed to the calendar.
5. Longer term: an **in-app calendar that links with Google Calendar**, where events can be
   added directly.

**What already exists (checked 2026-07-16 — good news, most of the data is there):**
- `src/lib/stores/customers.ts` already models exactly what the invite needs:
  customer → `locations[]` (each a venue, with address + `venueKind`) → `contacts[]`
  (name, email, phone, `primary` flag). Helpers exist: `locationById`, `contactsForId`,
  `contactByName`, plus travel/geo via `coordsOf` and `src/lib/geo`.
- `/schedule` (`src/app/(app)/schedule/`) already exists — but it's **crew booking against
  projects** (`bookCrew`, `updateBooking`, `removeBooking`, a Leaflet map, ported from
  `Scheduling.dc.html`). Site visits are a different object. **Open question:** does a site
  visit become a first-class record that also shows on `/schedule`, or does it live only in
  the new calendar? Don't duplicate scheduling concepts by accident.
- Google OAuth plumbing is built and working (`src/lib/gmail/oauth.ts`, `config.ts`,
  `connections.ts`), all plain `fetch()` against REST — no new npm deps, by deliberate design.
  Keep any Calendar work to that same pattern.

**Decisions Jeff needs to make before this gets built:**
- **A. Invite delivery — two very different builds:**
  - *(i) `.ics` attachment emailed to him.* Works today with zero new OAuth scope. He gets a
    mail, clicks it, it lands in whatever calendar he wants. Matches "auto sends me a calendar
    invite that I can put into my calendar" most literally. Much smaller job.
  - *(ii) Direct write to Google Calendar via the Calendar API.* Event just appears — no email
    step. Needs a **new OAuth scope** (`calendar.events`), which means **re-consenting every
    connected mailbox**, and per [[peak-deployment]] the OAuth flow has known `invalid_request`
    gotchas — read that memory before touching it. Required anyway for item 5 (in-app calendar).
  - These aren't exclusive: (i) is a good phase 1, (ii) is the real destination.
- **B. Are attendees invited, or is this just Jeff's own event?** "sends me a calendar invite"
  reads as *Jeff only*. But an event with the customer contact as an **attendee** would email
  *the customer* — that's an outbound message to a client and must not happen by accident.
  **Default to Jeff-only; contact info goes in the event body/location, not the attendee list**,
  unless he says otherwise.
- **C. Which calendar?** His personal Google Calendar, or a shared Peak one?
- **D. "Reason for the visit" — free text, or a picklist** (measure/survey, punch walk, sales
  call, warranty, install check…)? Picklist makes the titles consistent and reportable; free
  text is faster to build and never gets in his way.

**Sketch of the build (once decisions land):**
- New `siteVisits` record in `src/db/schema.ts`: customer id, location/venue id, contact id,
  reason, start/end, notes, plus `googleEventId` for sync.
- Title formatter: `` `${venue.name} — ${reason}` `` (confirm the separator he wants).
- Event body: contact name, phone, email, full venue address, reason, link back to the Peak
  customer record. Event `location` = venue address so phone maps/nav work.
- Inbox entry point: an action on a thread ("Schedule site visit") that pre-fills the customer
  from the thread's matched contact — the linkage is the whole point, so lean on however the
  inbox already resolves a thread → customer.
- In-app calendar: new route, month/week view, reads Google Calendar as source of truth.
  **Related to item 1** — same sync question (poll vs. push), so decide the sync strategy once
  and use it for both.

**Investigated 2026-07-19 (code-verified — two corrections and four new decisions):**
- The sketch holds: MIME builder already does attachments (`mime.ts:30-101`), so a
  phase-1 `.ics` email needs **zero new OAuth scope** — just an ics formatter + a small
  `buildRaw`+`sendRaw` helper (NOT the comms seam, which is hardwired to email the
  thread's customer contact). Phase 2 = one scope-array edit (`config.ts:24-28`) +
  reconnect of each calendar-bearing mailbox (flow already uses `prompt=consent`);
  no token-storage changes. `/schedule` derives purely from `project.crew[]`, so a
  separate `siteVisits` collection composes cleanly.
- **Correction 1:** `CustomerContact` has **no phone field** (`customers.ts:48-53`).
- **Correction 2:** `CustomerLocation` has **no street address** — only label, city,
  state, lat/lng (`customers.ts:35-46`). So "venue address + contact phone" on the
  invite needs schema + form additions, or a reduced payload (label + city/state +
  a maps link).
- **New decisions (beyond A–D): E.** which mailbox sends the .ics (needs Jeff's
  personal box connected; fallback?). **F.** self-sent invites will be re-imported by
  the inbound poll as stray inbox threads — suppression mechanism needed (e.g. stamp
  the sent id on the siteVisit record and skip it). **G.** on an unlinked Gmail thread
  (customerId null), does "Schedule site visit" force the adopt-customer flow first?
  **H.** does `calendar.events` go into the shared scope list (every mailbox re-consent
  asks for calendar) or a separate calendar-only connection? **I.** should the .ics
  send be recorded on the siteVisit record (it won't appear as a comms thread).

**DECIDED 2026-07-19 — Jeff answered A–I** (A: .ics phase 1 + per-user toggle; B:
Jeff-only attendees; C: personal calendar; D: picklist + add phone/street fields; E:
sender = scheduler's mailbox; F: suppress self-import; G: adopt customer first; H:
calendar scope just Jeff's + settings option later; I: record the send).

**Status:** PHASE 1 DONE (code) — commit `b2d4d91`, decision **D76**. Shipped: "Site
visit" action in the thread reader (modal prefilled from the resolved customer),
site_visits collection, Settings-editable reason picklist, .ics invite emailed to the
assignee honoring a new Account toggle, self-import suppression, sent-invite stamping,
and customer-record phone + street-address fields end-to-end. Verified in dev
(SV-5001); live invite send awaits Gmail creds (Q-A). **Phase 2 SHIPPED 2026-07-19** (commit `3a5ab2d`, D77,
from Jeff's follow-up ask): a dashboard Calendar card pulling the signed-in user's
Google Calendar (merged with their Peak site visits), quick-add writing straight to
Google Calendar, per-mailbox "Enable calendar" opt-in in Settings (per H), and site
visits now written DIRECTLY onto the assignee's calendar when their mailbox has the
grant (.ics email stays the fallback). One-time setup on the live deployment: add the
`gmail.modify` + `calendar.events` scopes to the Google Cloud consent screen, enable
the Calendar API, then use "Enable calendar" on your mailbox (DEPLOY.md). FULLY
DONE 2026-07-19: the full-page calendar module shipped as /calendar in the nav
(commit `6d0f7e3`, D81) — month grid over Google Calendar + site visits with
day-click quick-add. Nothing left on this item.

---

## 3. Remove all emoji — the software should read as professional — DONE (719812a + D75)

**Area:** app-wide (UI strings, and check generated documents/emails too)

**Reported:** 2026-07-16

**Ask:** Emoji aren't professional. Strip them out of the software.

**Actual scope (scanned 2026-07-16 — smaller than it looks):**
- **True pictographic emoji: 15 occurrences across 10 files.** That's the real target list:
  - 🔒 ×4, 📷 ×4, 👁 ×2, 📐, 📎, 📍, 👤, 🎭 ×1 each
  - Files: `portal/page.tsx`, `customers/[id]/portal-access.tsx`, `settings/page.tsx`,
    `settings/settings-client.tsx`, `inbox/thread-reader.tsx`, `estimating-rules/page.tsx`,
    `design-studio/page.tsx`, `inspections/[id]/controls.tsx`, `import/page.tsx`,
    `field-survey/[id]/controls.tsx`
- **Also in the codebase but a judgment call — typographic/dingbat glyphs used as icons:**
  ✓ ×50, ✨ ×19, ✉ ×17, ⭳ ×4, ✕ ×4, ⚠ ×3, plus one-offs (⭱ ✦ ✏ ✎ ⛶ ⚙ ⚖ ⚑ ☰ ☑ ☎).
  These are monochrome symbols, not colored emoji — ✓ and ✕ in particular are doing real UI
  work (checkmarks, close buttons) and reading them as "emoji" is a stretch. **✨ is the one
  that actually looks unprofessional** (sparkles, presumably on the AI/assistant features).
  **Needs Jeff's call — see decision A below.**

**Decisions Jeff needs to make:**
- **A. How far does "all emoji" go?** Three tiers:
  - *(i) Colored pictographs only* — the 15 occurrences above. Safe, obvious, no UI regressions.
  - *(ii) Tier i + the decorative ones* — kills ✨ and similar flourishes, keeps ✓/✕/⚠ doing
    their functional jobs.
  - *(iii) Everything non-alphanumeric* — replace ✓/✕/⚠/☰ etc. with real SVG icons. Biggest
    job, most consistent result, but it's an icon-system project, not a find-and-replace.
  - **Recommendation: (ii).** Gets the unprofessional look gone without a refactor.
  - ✅ **DECIDED 2026-07-16 — Jeff chose (ii).** Remove all 15 colored pictographs **and** the
    decorative glyphs (✨ ×19 and similar flourishes). **Leave the functional symbols alone**:
    ✓ (checkmarks), ✕ (close), ⚠ (warnings), ☰ etc. keep doing their UI jobs. Do **not** turn
    this into an icon-system refactor.
- **B. What replaces them?** Default: drop the character entirely where the text label already
  carries the meaning; only reach for an icon where the glyph was the sole affordance. Follow
  the existing convention in `src/app/(app)/inbox/icons.tsx` rather than inventing a new one.
  Resolve per-site at implementation time; no need to pre-decide each one.

**Also check when implementing (not yet scanned):**
- Generated documents, letters, and outbound emails — per [[peak-templates-feature]] the
  wording lives in `/templates`, so any emoji in customer-facing copy would be there, not in
  the component files. **Customer-facing emoji matter more than internal ones.**
- Seed data, `IDEAS.md`-driven strings, and toast/notification copy.

**Status:** DONE — implemented 2026-07-19, commit `719812a`. All 15 pictographs, all 19 ✨,
the ✦, and every U+FE0F selector removed; SVG replacements only where a glyph was a
container's sole content (admin locks, Design Studio tiles, mailbox avatars, assistant
spark); functional glyphs untouched. tsc + build + browser-verified; zero targets remain
in `src/`. Follow-up 2026-07-19 (Jeff: "just come up with standard language that we set rules
to"): the AI renewal-draft button was **removed entirely** (commit `8315b54`, D75) —
the ✉ one-click flow is the single, rules-based path, wording editable in /templates.
Templates/letters were scanned: clean.

---

## 4. Claude API integration — OPEN (long-term / deferred)

**Area:** `src/lib/ai/*` (built but inert, gated on `ANTHROPIC_API_KEY`), Site Intake Phase 2

**Reported:** 2026-07-19 (logged to this file 2026-07-19)

**Ask / decision:** Not now. Covers Site Intake Phase 2's "LLM scope skeleton" (repo item
**D7**, currently blocked on Jeff creating an Anthropic API key) and any other runtime model
calls.

**Reason for deferral:** Adds secret management, failure handling, cost monitoring, and prompt
regression risk to an app maintained by a non-developer — for features that don't yet clearly
beat a rules-based approach. Cost when revisited: ~$6–225/mo.

**Revisit only when** a rules-based approach has demonstrably hit its ceiling.

**Related decisions made 2026-07-19:**
- **Site Intake generation = rules-based for now.** Build deterministic generation off the
  existing structured intake fields instead of D7's LLM scope skeleton. Not yet scoped.
- **Customer portal: the API is NOT the answer.** Jeff's reasoning — it wouldn't give the
  customer what they're looking for. Problem acknowledged as unsolved and explicitly parked
  rather than force-fit to AI.

**Status:** OPEN (long-term)

---

## 5. Monday.com-style UI/UX — OPEN

**Area:** global interface / design system (app-wide)

**Reported:** 2026-07-19

**Ask:** Make the interface feel like Monday.com — the team's current PM tool — so adoption is
seamless. The team should feel it's the same interface they already know, just with Peak's
customizations.

**Decisions Jeff needs to make before this gets scoped:**
- **A. Which Monday paradigms actually matter?** Boards, timeline/Gantt, kanban, table view
  with colored status pills, left-nav workspace structure. Picking 2–3 makes this buildable;
  "all of it" makes it a rewrite.
- **B. Reskin or interaction patterns too?** A visual reskin (colors, type, status chips,
  board layouts) is a contained job. Interaction patterns (drag-to-update status, inline
  editing, group/collapse) are a much larger one and touch every data screen.
- **C. Any specific Monday screens to mirror?** Screenshots would settle most of A and B.

**Where the styling actually lives (verified 2026-07-19):**
- **Global tokens exist** — 23 CSS custom properties in `src/app/globals.css` (`--accent` and
  friends are used throughout, incl. both Design Studio tools). Colors and the like are
  themeable from one place already.
- **Nav structure:** `src/components/nav/nav-data.ts`. Screen specs: `docs/specs/*.json`
  (`nav-shell.json`, `settings-team.json`, …).
- **But component-level styling is duplicated inline.** `card`, `label`, `field`, `th`, `td`
  are re-declared as local `React.CSSProperties` objects per file — they differ slightly
  between `lineset-builder.tsx` and `weights-tool.tsx` (font sizes 13.5 vs 12.5, radii 8 vs 7).
  **So a token-level reskin is cheap; anything touching cards, tables, chips, or spacing is a
  find-and-replace across every screen** until those are extracted into shared components.

**Suggested first phase:** extract the duplicated component styles into shared primitives.
It's worth doing regardless of Monday, and it's what makes B affordable.

**PHASE 1 SHIPPED 2026-07-19** (commit `a204da8`, D79): a shared Monday-style
StatusPill (Monday's exact status palette — done-green, working-orange, stuck-red)
now renders the Quotes status column + switcher, the Home pipeline chips, and the
Leads Stage column, with canonical per-record tone maps so statuses color the same
everywhere. The shared-primitives layer (`components/ui.tsx`) already existed —
convergence onto it is the standing rule as screens get touched.

**Status:** TABLED (Jeff, 2026-07-19) — phase 1 (Monday-palette status pills on
Quotes / Home pipeline / Leads, commit `a204da8`) stays in; everything further is
parked. When revisited, the A/B/C questions above are still the starting point —
screenshots of the team's actual Monday boards would settle most of it. If the
phase-1 pills aren't wanted either, reverting `a204da8` is a one-commit undo.

---

## 6. Merge Lineset Weights into Lineset Builder — DONE (D78)

**Area:** `src/app/(app)/design-studio/lineset/lineset-builder.tsx` +
`src/app/(app)/design-studio/weights/weights-tool.tsx`; engines at
`src/lib/design/lineset.ts` and `src/lib/design/steel.ts`

**Reported:** 2026-07-19

**Ask:** Combine the two tabs into one screen. The team bounces between them to build a
lineset and then check its weight. Jeff's read: everything from both can live together.

**Proposed approach (discussed with Jeff):** one lineset detail view, with weight / arbor
total / brick count as a **live-calculated panel** that updates as hung items are edited, and
out-of-weight warnings shown inline.

**Code-verified 2026-07-19 (answers the open questions from intake):**

- **Weight is entered separately today — fully duplicated by hand.** The two tools share no
  data and no types. Builder input is `LinesetInputs` (stage width/depth + layout toggles);
  it *generates* a schedule of slots with `slot`, `dsPositionLabel`, `type`, `name`,
  `warning`. Weights input is a hand-keyed `WeightLine[]` (name, fabric, w, h, fullness, qty,
  gear, chain, track, batten, mode, hoist). **The only overlapping field is `name`.**
- **The demo data proves the duplication.** The Weights demo rows ("1st Border", "1st Legs
  (pair)", "1st Electric", "Cyclorama") map almost 1:1 onto the line types the Builder
  generates (`Electric`, `Shell`, `Border`, `Draw`, `Legs`, `CYC`, `Rear`, `Midstage Draw`,
  `General Purpose`). The team is retyping Builder output into the Weights tool. That *is*
  the inefficiency Jeff described.
- **Therefore the merge is clean in principle:** the Builder's generated schedule supplies the
  **rows**; weights become **additional per-row fields**. This is not two views of one dataset —
  it's one dataset that currently gets typed twice.
- **A show-wide rollup already exists** (watch-out (b) is satisfied): four KPI tiles — Total on
  batten, Peak load / support beam, With powerheads, Counterweight. These survive the merge
  unchanged.
- **Recalc flicker (watch-out (d)) is a non-issue.** Both tools are pure synchronous `useMemo`
  over local state, no debounce, no async. Warnings already compute inline per row. Strike (d).

**New problems found in code — these are the real work:**

- **P1 (biggest). Regeneration destroys hand-entered weight data.** The Builder re-runs
  `generateLineset(inp)` on *every* input change, and rows are keyed by `s.slot`. Nudge the
  stage depth by six inches and the whole schedule regenerates with shifted slots — hand-keyed
  fabric/dimension/hoist data would have nothing stable to reattach to. **The merge needs a
  stable line identity plus a reconcile strategy** (match on slot? on name? on type+ordinal?)
  and a visible answer for orphaned data. Nothing in the current code supports this.
- **P2. Blank reads as zero, and would silently understate the total.** Weights coerces with
  `w ?? 0` / `qty ?? 1`. Fine when six rows are typed deliberately; dangerous when the Builder
  auto-generates 40+ rows that all default to 0 lb and roll up into a confident-looking total.
  **Need an explicit "not yet specified" state** distinct from a real zero, and the rollup
  should refuse to present a total (or flag it) while any line is unspecified.
- **P3. Two saved-design records, two load URLs.** `SaveBar kind="lineset"` and
  `kind="weights"` save separately (`StudioDesignKind` in `save-bar.tsx`) and load via
  `?design=` on different routes. Merging forces a decision: new combined kind, and what
  happens to designs already saved under the old two. **Migration path needed — read
  `save-bar.tsx` kinds and the D71-era save format before designing this.**
- **P4. Two separate config panels would land on one screen.** Builder has "Advanced rule
  parameters" (8 fields); Weights has "Schedule defaults" (12 fields, incl. brick/pipe/safety
  config). Merged naively that's two collapsible panels of knobs. Watch-out (c) — one clear
  place for units/weight config — means **consolidating into a single settings drawer**, not
  stacking both.
- **P5. Layout is tighter than it looks.** Builder uses a 300px input rail + flexible pane.
  The Weights table is 12 columns with a 900px minimum and already scrolls horizontally on its
  own full-width screen. It will not fit into Builder's right pane. **Likely resolution:** the
  master list stays narrow (slot / type / name / weight / status), and fabric-and-dimensions
  editing moves into a detail pane or expanding row. This is watch-out (e), and it's more
  binding than intake assumed.

**Revised framing for watch-out (a):** merged rows have **three** field classes, not two —
*generated by rules* (slot, downstage position, type, default name), *hand-entered* (fabric,
W/H, fullness, qty, gear, mode, hoist), and *calculated* (weight on batten, check, brick
combo). The visual treatment should distinguish all three, and should make clear that editing
a generated field may be overwritten on the next regeneration (see P1).

**Suggested phasing:** superseded — see status below.

**Status:** DONE — implemented 2026-07-19 (commit `366fdce`, decision **D78**). One
screen at /design-studio/lineset: generated schedule supplies rows, per-row weight
editor (chain/track newly editable), live checks + KPI tiles. P1 solved with
type#ordinal line identity (verified: regenerate keeps data, orphan notice +
one-click clear, reattach-on-return); P2 unspecified lines excluded from totals and
flagged ("M of N specified"); P3 v2 combined save + legacy adapter (old weights
designs open as custom lines, saving creates a new combined record); P4 one settings
drawer; P5 narrow 8-column master table with expanding-row editing. The weights
route redirects; landing tile and nav entry removed.

---

## 7. Per-section dashboards (Sales / Design / Install / Service / General) — OPEN

**Area:** `src/components/nav/nav-data.ts`, `src/components/nav/Nav.tsx`, `src/app/(app)/page.tsx`,
new section routes

**Reported:** 2026-07-19

**Ask:** Every section should have its own customizable dashboard — Sales, Design, Install,
Service, General. Clicking the section tab goes to that dashboard.

**Code-verified 2026-07-19 — good news and bad news:**
- **The five sections already exist as nav groups** (`nav-data.ts:12-71`): Sales (Leads/Quotes/
  Reviews), Design Studio, Installs (Projects/Schedule/Field Work), Service (Flame Tests/
  Rigging Inspections/Repairs), General (Customers/Field Survey/Catalog/Reports/Templates/
  Estimating Rules/Import). Naming differs slightly from the ask ("Design Studio", "Installs").
  Home, Inbox and Assistant sit outside the five.
- **Clicking a section tab navigates nowhere today.** A group renders as a `<button>` that only
  toggles a dropdown (`Nav.tsx:211-224`); you reach a screen on the second click. There are no
  `/sales`, `/installs`, `/service`, `/general` routes. **Precedent exists:** Design Studio has
  a real overview landing page at `/design-studio` (tile grid) — the model to copy.
- **There is exactly one dashboard today** — `page.tsx`, **1861 lines**, ~9 cards, only 3 of
  which are extracted components (`HomeMyDesigns`, `HomeCalendar`, `HomeStageSheet`). The rest
  are inline JSX sharing one `Promise.all` fetch (`page.tsx:274-290`).
- **No dashboard customization infrastructure exists** — no widget registry, no card-order or
  show/hide persistence, no layout library. `appSettings` is a single global row, not per-user.
  **The one per-user preference pattern that exists** is `notifPrefs` (`doc-tables.ts:126-130`,
  `stores/notif-prefs.ts`) — userName PK + a JSON blob. That's the template to copy.
- Current Home content is almost entirely Sales/Design-flavored (quotes, leads, pipeline,
  designs). **Install, Service and General dashboards need widgets that do not exist yet.**
- `src/lib/nav-counts.ts` already computes per-section counts server-side — a ready data source
  for section tiles.

**Decisions Jeff needs to make:**
- **A. What happens to Home?** Does it stay as a personal cross-section roll-up, become the
  "General" dashboard, or go away?
- **B. Click behavior.** If the tab navigates to a dashboard, how do users reach child routes —
  hover dropdown, sub-nav on the dashboard page, or both? Real UX call, not an implementation
  detail.
- **C. How customizable is "customizable"?** Show/hide only, or reorder/resize/drag-and-drop?
  There is no layout library in the project — drag-and-drop is a net-new dependency.
- **D. Per-user, per-role, or company default with per-user override?** Roles exist
  (`users.roles`, seeded Admin/Estimator/Manager/Reviewer) but currently shape nothing in the UI.
- **E. What goes on the Install, Service and General dashboards?** Those widgets don't exist.

**Honest scale note:** the visible ask (five landing pages) is small. The real work is
extracting ~9 inline cards out of an 1861-line page into independently-fetching widgets with a
common contract, then building a per-user layout store. **Suggest phase 1 = five static section
landing pages** (Design Studio's overview as the pattern) **with no customization at all**,
which delivers the navigation win immediately and defers C/D.

**Status:** OPEN — needs A–E

---

## 8. Remove the AI panel from General Settings — DONE (D82; (ii) folded into item 4)

**Area:** `src/app/(app)/settings/settings-client.tsx:966-1070`, `src/app/(app)/settings/page.tsx:130-138`

**Reported:** 2026-07-19

**Ask:** Since we decided to remove the AI, take it out of General Settings and see what happens.

**Code-verified 2026-07-19 — this is safe and small:**
- The AI section is a **read-only status card**. No toggle, no input, no server action. It shows
  an "AI enabled / Not enabled" pill, the model id, and a list of the remaining feature cards.
- **Removal is purely cosmetic.** `AppSettingsData` has no AI field, `DEFAULT_SETTINGS` has no AI
  default, `settings/actions.ts` contains zero AI references. There is no DB column and no
  migration. Config is env-only (`aiEnabled()` = `ANTHROPIC_API_KEY` present && `AI_DISABLED !== "true"`,
  `src/lib/ai/config.ts:48-50`).
- **Nothing else reads the card's props** — the `ai` prop is built inline in `settings/page.tsx`
  and consumed only by that card. Deleting it means deleting ~105 lines, one prop, one type, one import.
- **All actual feature gating lives elsewhere and is untouched** — each consumer calls
  `aiEnabled()` independently (layout/nav, assistant, inbox, estimator, import).
- **The only thing lost:** the sole in-app display of the model id and the `ANTHROPIC_MODEL` /
  `AI_DISABLED` env hints. The card's own copy says the authoritative instructions live in
  MASTER-HOWTO §AI, so nothing becomes undiscoverable.
- Four AI features remain registered post-D75: thread/customer summaries, import extraction,
  quote scope drafting, assistant. **Removing the settings card does not disable them** — if the
  intent is "no AI visible anywhere", the Assistant nav entry and the four feature entry points
  are a separate, larger decision (that's item 4).
- Stale comment to fix while in there: `config.ts:67` still says "The five AI features"; there
  are four.

**Decision Jeff needs to make:** does "remove the AI" mean **(i)** just hide this settings card
(what's asked, ~105 lines, zero risk), or **(ii)** actually make the four AI features
unreachable app-wide? These are very different jobs. **Recommend (i) now** — it's reversible and
matches the words — and treat (ii) as part of item 4.

**Status:** DONE as (i) — card removed 2026-07-19 (`01310aa`, D82). (ii) — making the four AI features unreachable app-wide — remains item-4 territory.

---

## 9. Team members: contact-card detail, email correction, active/archived/removed — OPEN

**Area:** `src/db/schema.ts:16-27` (`users`), `src/lib/users.ts`, `src/app/(app)/settings/settings-client.tsx:1197-1341`,
`src/auth.ts:81-119`, all letter/report signature blocks

**Reported:** 2026-07-19

**Ask (three parts):**
1. Team members need more information — essentially a contact card per member, so signatures on
   all service information can be filled out from it.
2. The emails are wrong; they should be corrected when the member signs in for the first time.
3. A toggle for **active / archived / removed**.

**Code-verified 2026-07-19 — the current member record is thin:**
Complete field list (`schema.ts:16-27`): `id, name, email, googleEmail, roles[], color, initials,
active, createdAt, photoUrl`. **No phone, no job title, no department, no license/certification
number, no office assignment.**

**Finding 1 — `roles[0]` is doing double duty as a job title, inconsistently.** Every outbound
signature resolves the member and prints `roles[0]` as their title. Two different derivations
coexist: **letters** use `roles[0]` (so Jeff, whose roles are `["Admin","Estimator"]`, signs as
**"Admin"**), while **reports** strip "Admin" first and sign as **"Estimator"**. Same person,
two titles, depending on the document. A real `title` field would fix this.

**Finding 2 — the phone on service reports is not the member's.** `repairs/report/report-doc.tsx:104-105`
reads `offices[0].phone` unconditionally — the *first* office in settings, regardless of who
signed or where they work. And `offices[].phone` is a field the Locations modal **never edits**
(passthrough only). So the phone on service paperwork is effectively unmanaged.

**Finding 3 — there is no way to edit an existing member's email, anywhere.** Confirmed absent
from the UI (the edit modal hides name and email — `settings-client.tsx:1801`), from server
actions (`addUser`/`setRoles`/`setActive`/`removeUser` only), and from CSV import (update path
calls `setRoles` only). Seeded emails are **guessed** — `emailFor()` derives
`first-initial + lastname @peaksystemsgroup.com` (`src/lib/team.ts:47-56`) and is used whenever
the email field is left blank. **This is why the emails are wrong.**

**Finding 4 — a wrong email is currently a lockout, not a cosmetic issue.** `auth.ts:81-90`
looks up the signing-in Google identity by email; **no active row match ⇒ sign-in is refused**.
So a member whose guessed address is wrong cannot sign in, and no admin screen can fix it. Today
the only remedies are delete-and-re-add, a CSV import that creates rather than updates, or direct
DB access. The `googleEmail` alternate-address column exists but **no UI writes it**.
**This makes part 2 of the ask a genuine defect, not an enhancement — and it blocks the
first-sign-in flow it asks for, because a wrong-email user never reaches first sign-in.**

**Finding 5 — only `active: boolean` exists.** No archived/removed distinction. Hard delete does
exist (`removeUser` → `db.delete`) with guardrails (can't remove yourself; can't drop to zero
active admins). Archived-vs-removed semantics = a new column + migration.

**Finding 6 — everything joins members by NAME string, not id.** `quote.owner`, `job.owner`,
`thread.mailboxUser`, `visit.assignedTo` all store display names, and signature lookup is
`users.find(x => x.name === owner)`. **Consequences:** renaming a member in Settings silently
breaks their signature resolution (falls back to "Estimator" and a blank email), and a hard
delete orphans every historical record. **This argues strongly for archive-not-delete** and is
worth deciding before any team-member work.

**Decisions Jeff needs to make:**
- **A. What fields go on the contact card?** Proposed from what signatures actually need: real
  `title` (replacing the `roles[0]` hack), direct phone, mobile, office assignment, plus
  certifications/license numbers if those belong on inspection paperwork. **Jeff should confirm
  the list — especially whether certification numbers need to print on service documents.**
- **B. First-sign-in email correction — which direction?** If a member signs in with a Google
  address that doesn't match their roster row, do we (i) let them confirm/correct their own
  address, or (ii) have an admin fix it in Settings, or (iii) both? Note (i) alone can't work
  standalone: a mismatched user is refused at the door. **A likely first step is simply making
  email editable in the Settings edit modal**, which is small and unblocks everything else.
- **C. Archived vs removed — what's the difference operationally?** Suggested: *archived* = keeps
  history, can't sign in, hidden from pickers; *removed* = same but also hidden from the
  Settings list. Given finding 6, **recommend that neither ever hard-deletes the row.**
- **D. Should the signature phone be the member's direct line** instead of `offices[0].phone`?

**Status:** PART 2 FIXED (`01310aa`, D82) — name/email/google-email now editable in the Settings edit modal, ending the wrong-email lockout. Contact card (A/D) and archived-vs-removed (C) still need answers; B's first step (admin-editable email) is done.

---

## 10. Estimating Rules: display options to tame the scroll — DONE (D83)

**Area:** `src/app/(app)/estimating-rules/page.tsx`, `estimating-rules/controls.tsx:339-468`,
`src/lib/stores/pricing.ts`

**Reported:** 2026-07-19

**Ask:** Estimating rules should allow different display options so the scroll isn't as bad.

**Code-verified 2026-07-19:**
- **79 rows across 8 groups, all rendered at once**, every group always expanded, page capped at
  960px wide. 54 editable rates + 25 read-only formulas.
- **There is no search, filter, sort, collapse, or pagination** — confirmed by grep; the only
  component state is a per-row edit buffer. Existing affordances are a legend card and
  CSV/JSON/Print/Reset-all buttons.
- Groups: System design, Auto BOM & sizing, Flame-test pricing, Repair pricing, Inspection
  pricing, Travel & mileage, Catalog margin, Lighting fixtures.
- Admin-gated (`can("manage_users")`); non-admins see a lock card.

**Existing fields that could drive display options with no data model change:**
- **`kind`** — rate vs formula. **25 of 79 rows are read-only formulas**; a "hide formulas"
  toggle removes a third of the scroll instantly. Cheapest possible win.
- **`live` / `ref`** — live-and-wired vs reference-only. Already rendered as badges, not
  filterable. (Worth knowing: 4 of the 8 groups are non-live.)
- **changed-vs-default** — already computed per row (drives the amber styling) but has no
  "show only modified" filter. Likely the single most useful view for day-to-day work.
- `store` (which engine owns the rate), `unit`, and the dotted `id` (natural sub-grouping).

**Suggested (cheap → expensive):** collapsible groups with state remembered · a text search ·
"hide formulas" · "only modified" · "only live". All are client-side filters over data already
on the page — no schema change, no server work.

**Decision Jeff needs to make:** which views he actually wants, and whether groups should
default collapsed or expanded. **Recommend: collapsible groups defaulting collapsed, plus a
search box and a "only modified" chip** — that alone likely resolves the complaint.

**DONE 2026-07-19 (D83)** — built the recommendation, all client-side, no schema change:
- **Collapsible groups, default collapsed.** The page now opens as an 8-row index with a
  per-group rule count instead of 79 rows. Expand/Collapse all button.
- **Search** over label, id, unit and help/expr text.
- **"Only modified"** (with a live count of changed rates), **"Hide formulas"**, **"Only live"**.
- A filter that narrows the list **force-opens matching groups** — otherwise hits would sit
  behind collapsed headers and read as "no results". Non-matching groups drop out entirely,
  with an explicit empty state.
- View state (filters + which groups are open) **persists in localStorage**, via
  `useSyncExternalStore` — a lazy `useState` initializer reading localStorage would break
  hydration, and setState-in-effect trips the repo's lint rule.
- Browser-verified: 79 → 8 rows on load; search "mileage" → 7 of 79 across 3 auto-expanded
  groups; "Only modified" → correct empty state; group open state survives reload with no
  hydration error.

**Still Jeff's call:** default-collapsed is a guess at his preference. One constant flips it.

**Status:** DONE (D83) — pending Jeff's read on the collapsed default

---

## 11. Customer pricing tiers → default margin (incl. customer portal) — READY TO BUILD (A–C, E–G answered; D + per-tier margins open)

**Area:** `src/lib/stores/customers.ts`, `src/app/(app)/estimator/*`, `src/lib/stores/pricing.ts`,
`src/lib/curtain-pricing.ts`, `src/app/portal/*`

**Reported:** 2026-07-19

**Ask:** Customers should have a tier system linking them to a typical margin that gets applied
every time a new quote is done for them. The margin needs to apply to the customer portal too.

**Code-verified 2026-07-19 — this is the largest item on the list. Read before scoping.**

- **No tier concept exists on customers.** `CustomerDoc` has six fields: `id, name, type,
  location, locations[], contacts[]`. Customers live in the JSON doc-store, so **adding a field
  needs no migration** — that part is easy.
- **`customer.type` is NOT a pricing concept** — it's a segment picklist (Performing arts,
  Education, Worship…) used only to pick a colour chip. No pricing code reads it.
- **Nothing in the estimator reads the customer record for pricing today.** `pickCustomer` pulls
  name, contacts, locations, travel — nothing else. **A customer-level pricing mechanism would be
  the first of its kind in the app.**

**Finding 1 — margin is not one concept. There are five independent systems:**
| # | Where | How margin works |
|---|---|---|
| a | Estimator (detailed quotes) | **Not stored.** A write-only slider that rewrites every line's `price` from `cost`; read back by recomputing `(rev-cost)/rev`. No "quote margin" input exists. |
| b | Estimating Rules registry | `system.baseMargin` and `catalog.defaultMargin` are **`ref: true` — documentation only, nothing reads them.** Live margins exist per engine (flame/repair/inspection/parts, all 30%). |
| c | Labor configurator | Per-draft `margin`, 0–95%. |
| d | Curtains | **Hardcoded 38%, duplicated in two files** that must stay in sync (`estimator/pricing.ts:140`, `curtain-pricing.ts:17`). |
| e | Quick Design | Hardcoded 30%. |

**Finding 2 (the big one) — historical quotes behave in opposite ways depending on type.**
Estimator quotes bake absolute prices into the saved spec, so a later rate change does **not**
move them. Flame-test / repair / inspection quotes read the live rate blob at render time, so
they **do** reprice retroactively — and `pricing.ts:18-20` documents that as intentional.
**So a customer tier margin would silently behave one way for system quotes and the opposite way
for service quotes unless the tier margin is explicitly stamped onto the quote at creation.**
This is the single most important decision in the feature.

**Finding 3 — the portal already hardcodes 38%, with load-bearing client/server coupling.**
The portal shows three different kinds of number: stored quote `value`; catalog `list` price
(per-SKU absolute, **no percentage hook at all**); and a live drapery configurator where the
server ships **pre-marked-up coefficients** (`sellCoeffs()`, cost ÷ 0.62) that the browser
multiplies by geometry. Submission recomputes server-side and never trusts posted prices.
**Applying a tier margin in the portal means changing both the coefficient generator and the
authoritative recompute in exact agreement — the code comments flag this coupling explicitly,
because the customer's live preview must equal the quote they receive.**
Good news: the portal session already carries `customerId`, so the tier lookup key is there.

**Finding 4 — naming collision.** `tier` already means Good/Better/Best **product** level on
designs (`stores/designs.ts:84`) and in the rules registry (`system.tierGoodCost` etc.).
**Use a different term for the customer concept** (`pricingTier`, `customerClass`) or expect
confusing bugs.

**Finding 5 — no discount or price-override mechanism exists** (zero grep hits). A tier system
duplicates nothing, but it *does* collide with the estimator's manual margin slider, which is
destructive — it overwrites every line's price, leaving no way to distinguish "tier-derived"
from "hand-set".

**Decisions Jeff needs to make:**
- **A. Precedence.** Does the tier margin *seed* the section slider (overridable, one-time) or
  *enforce* it (recomputed on every change)? Seeding is far simpler and matches how estimators
  actually work.
  **ANSWERED 2026-07-19 (Jeff): it SEEDS, not enforces.**
- **B. Retroactivity.** When a customer moves tiers, do open drafts reprice? Sent quotes? Today
  the answer differs by quote type (finding 2). **Recommend stamping the tier margin onto the
  quote at creation** so history is stable and auditable.
  **ANSWERED 2026-07-19 (Jeff): stamp at creation — but a REVISION pulls current prices,**
  "so if someone asks for an updated quote we can just pull a new revision rather than build it
  from scratch." So the stamp is **per-revision, not per-quote-lineage**: each revision
  re-stamps at the tier and rates current at the moment it is cut, and earlier revisions stay
  frozen exactly as sent.

  > **BLOCKER FOUND 2026-07-19 — quotes have no revision concept at all.** This answer presumes
  > a feature that does not exist:
  > - **`DesignRevision` exists (`designs.ts:74`) — on designs, not quotes.** Quick Design has
  >   real save-revision / restore-revision / "Revision v*N*" UI. **Quotes have none of it.**
  > - `Quote.history` is **only status transitions** (`{at, from, to}` over
  >   draft/sent/won/lost, written in exactly one place, `quotes.ts:191`). Its only consumers
  >   are won/lost date extraction in Reports (`reports/page.tsx:503,507`). **It is not a
  >   revision log and cannot be read as one.**
  > - **No duplicate / clone / new-version action on quotes anywhere** (zero grep hits).
  >
  > **Quote revisions are therefore a prerequisite for item 11, and are their own feature** —
  > roughly the size of the tier work itself. The design-side pattern is the thing to copy.
  > **ANSWERED 2026-07-19 (Jeff): immutable snapshots that can be recalled, exactly the design
  > model** — "if they go in a different direction and the quote is too much we can go back a
  > revision." **Logged as item 24**, which is a hard prerequisite for this item. Note that 24
  > solves the finding-2 split for free: a revision that stamps the tier margin *and* the
  > resolved prices at cut time is the mechanism described here.
- **C. Scope.** Which of the five margin systems does the tier touch? Estimator lines only is a
  contained change; all five (incl. curtains' 38% and the portal coupling) is a much bigger job.
  **ANSWERED 2026-07-19 (Jeff): ALL FIVE** — estimator lines, rules-registry engine rates,
  labor configurator, curtains (retiring the duplicated hardcoded 38%), and Quick Design's 30%;
  includes the portal coupling (coefficient generator + authoritative recompute together).
- **D. Portal equipment prices.** Catalog `list` is a per-SKU absolute with no percentage hook.
  Does a tier discount off list, or re-derive list from cost? These expose different pricing
  philosophies to the customer.
- **E. Should the customer *see* they're on a tier** (a named discount line), or is it invisible?
  **ANSWERED 2026-07-19 (Jeff): NOT visible to the customer** — the tier only shapes pricing;
  no discount line, no tier name on quotes or in the portal.
- **F. Tier definition.** Fixed enum, or an admin-editable list with per-tier margins? The rules
  registry has `defineGroup`/`addRate` that could host per-tier margins cleanly.
  **ANSWERED 2026-07-19 (Jeff): the tiers are Base, Cooper, Silver, Gold, Platinum, Employee**
  (verbatim — confirm "Cooper" vs "Copper" before shipping copy). Per-tier MARGIN PERCENTAGES
  still need Jeff's numbers; plan is an admin-editable tier→margin table seeded with these six.
- **G. Existing customers with no tier** — default to a "Standard" tier at today's 30% so nothing
  reprices silently.
  **ANSWERED 2026-07-19 (Jeff): default is the BASE tier.**

**Suggested phasing:** (1) add `pricingTier` to the customer + an admin-editable tier→margin
table; (2) seed the estimator section margin from it and stamp it on the quote; (3) portal last,
since it carries the client/server coupling risk.

**Status:** READY TO BUILD — A (seeds), B (stamp per revision, via item 24), C (all five margin systems), E (invisible to customer), F (tiers: Base/Cooper/Silver/Gold/Platinum/Employee) and G (default Base) are answered. Still needed before/at build: **D** (portal catalog list prices: discount off list, or re-derive from cost?), the **per-tier margin percentages** (can land in the admin table), and the Cooper/Copper spelling. Identity core (D85) already provides contacts.pricingTier + companies.pricingTier per design §4.7: contact tier wins, company is fallback, stamped onto the quote at creation.

---

## 12. New Lead: pick existing customer, link contacts, use canonical contact fields — OPEN

**Area:** `src/app/(app)/leads/lead-drawer.tsx:396-552`, `leads/actions.ts:83-115`,
`src/lib/stores/leads.ts`, `src/lib/stores/customers.ts`

**Reported:** 2026-07-19

**Ask:** New Lead should let you select from an existing customer or add new. Contact Name should
link in if there are any. The contact information should be the same fields we need everywhere else.

**Code-verified 2026-07-19 — mostly already plumbed, which makes this cheaper than it looks:**
- **`LeadRecord.customerId` already exists** (`leads.ts:172`), and `create()` already accepts it
  (`leads.ts:470,512`). **But `createLeadAction` never passes it**, so every lead made in the app
  has `customerId: null`. The only writer today is the customer portal.
- `convert()` **already reuses an existing `customerId` if present** (`leads.ts:680`) and skips
  minting a duplicate customer. **That is exactly the hook a customer picker should feed** — the
  downstream half of this feature is already built.
- The lead detail view doesn't surface the customer link either (`DrawerDetailVM` has no
  customer field), so even portal leads that *do* carry a customerId don't show it.

**The field delta (the core of the ask):**
- Lead form collects: Organization/venue*, Contact name, Source, Email, Phone, City, State,
  What they need, Owner, Est. value.
- Canonical `CustomerContact` = `name, role, email, phone, primary`;
  `CustomerLocation` = `label, primary, address, city, state, venueKind, lat/lng, travel…`
- **Lead is missing `role` (contact title) and street `address`.** It has city/state but no
  street — and street address is exactly what the D76 site-visit `.ics` invite needs.
- Lead models exactly **one** contact, flattened onto the record; customers have `contacts[]`.

**Bug found in passing (independent of this feature):** `convert()` at `leads.ts:704-708` builds
the new customer's contact as `{name, role, email, primary}` — **it drops the phone**, and builds
the location with no `address`. The inline comment claims `normalizeRecord` discards phone, but
**that comment went stale at D76** — `customers.ts:150` keeps phone now. So the lead collects a
phone, and conversion silently throws it away. **Worth fixing on its own.**

**No reusable customer picker exists.** At least **12 screens each roll their own inline
`<select>` over customers** (estimator ×2, field survey, inspections ×2, repairs, flame tests,
quick design, save-bar, inbox compose, inbox log). The closest contact picker is inline inside
`site-visit-modal.tsx:236-243`. **Building a shared `<CustomerPicker>` / `<ContactPicker>` would
pay for itself immediately across those call sites** — recommend doing that rather than a
13th bespoke select. `resolveCustomerId` (`comms.ts:1245-1262`) is a reusable resolver already.

**Decisions Jeff needs to make:**
- **A. Prefill-and-lock, or prefill-and-override?** If a rep picks an existing customer and then
  edits the phone on the lead, does that write back to the customer record or hold a divergent
  snapshot?
- **B. Which contact and which location?** Should the lead store `contactId` + `locationId`
  rather than free text? Note `CustomerContact` has **no stable id** (only locations do), so
  referencing a specific contact means adding one or matching by email.
- **C. Add `role` + `address` to the lead, or stop duplicating and dereference from the customer?**
  "Same fields we need everywhere else" suggests the former; rename-safety suggests the latter.
- **D. "Add new" — create the customer immediately, or defer to convert()?** Immediate makes
  `customerId` non-null from the start and simplifies convert; deferred avoids junk customer
  records for leads that die at stage "new".

**Status:** OPEN — needs A–D. The convert() PHONE drop is FIXED (`01310aa`); street address still can't pass through because the lead form doesn't collect one (part of decision C).

---

## 13. Service records → projects (inspections, service, warranty) — OPEN

**Area:** `src/lib/stores/projects.ts`, `inspections.ts`, `repair-jobs.ts`, `flame-jobs.ts`,
`src/app/(app)/schedule/`, plus three separate scheduler UIs

**Reported:** 2026-07-19

**Ask:** The scheduler in Rigging Inspection should link to projects. Rigging Inspections will be
a project once signed off. Same for service and warranty calls. Flame Tests and Consulting are
the only projects that are **not** in the installs window.

**Code-verified 2026-07-19 — start here, because one finding may explain the whole complaint:**

**FINDING: there is a live bug in the projects sync.** `projects.ts:530`:
```js
if (q.status !== "won" || q.quoteType === "flame_test") continue;
```
**Only flame tests are excluded.** The repair and inspection syncs correctly filter to their own
types, but the *projects* sync does not — so a won **repair** quote creates both a RepairJob
**and** a phantom Project, and a won **inspection** quote creates both an Inspection **and** a
phantom Project. Those phantoms then show up on the Projects list, the Schedule Gantt, and Field
Work. A comment at `quotes/actions.ts:30-36` claims "each sync filters to its own quoteType" —
**it doesn't.** Jeff's framing ("Flame Tests and Consulting are the only projects not in the
installs window") reads like a description of these phantoms from the outside.
**Recommend fixing this first, independently — it's small, isolated, and until it's fixed nobody
can reason about what "in the installs window" means, because the data is wrong.**

**There are five parallel, non-unified record types:**
| Type | Table | Stages | Scheduler | Links to project? |
|---|---|---|---|---|
| `ProjectRecord` (kind project/order) | `projects` | 7 / 4 | `/schedule`, crew **spans** | is one |
| `InspectionRecord` | `inspections` | 4 (requested→scheduled→onsite→completed) | `/inspections/scheduling` | **no** |
| `RepairJobRecord` (warranty included) | `repair_jobs` | 3 | `/repairs/scheduling` | **no** |
| `FlameJob` | `flame_jobs` | 3 | `/flame-tests/scheduling` | **no** |
| `SiteVisit` | `site_visits` | — | calendar / ics | **no** |

**Other key findings:**
- **No project *type* field.** `kind` is only `project | order` (install-with-labor vs
  materials-only) and is load-bearing for stage selection. The real discriminator, `quoteType`
  (`system | flame_test | repair | inspection`), **exists on quotes but is dropped at conversion**
  — `fromQuote()` never copies it onto the project. So the field Jeff needs half-exists already.
- **Warranty is not a record type.** It's derived state on a repair job (`warrantyMonths` +
  computed expired/expiring/active). So "warranty calls become projects" has no record to
  convert — a warranty call today *is* a repair job.
- **Inspections have no sign-off concept.** Projects do (`signoff: {signedBy, signedAt, name,
  role, note}`). The nearest inspection equivalent is advancing stage to "completed", gated on a
  report date — and **nothing fires on that transition today.** So the hook point exists but the
  sign-off object and the spawn machinery are both net-new.
- **The schedulers use incompatible shapes.** Projects book crew **spans** (`{person, start, end}`,
  multiple crew). Inspections/repairs/flame store a single `assignedTo` + a single `scheduledDate`
  day. **Unifying the schedulers means either service records grow a crew array, or the main
  Gantt learns to render single-day single-tech bars.** This is the bulk of the work.
- **"Consulting" does not exist anywhere in the codebase** — not a quoteType, not a record type.
  It's a new concept (see the Consulting idea below).
- Nav already matches Jeff's mental model: Flame Tests / Inspections / Repairs live under
  **Service**, not **Installs**. So the *UI* grouping is already right; it's the *data* that's wrong.
- One cross-type link already exists: repairs carry `source: "inspection"` + `refId`, so a repair
  can already point back at the inspection that found it.

**Decisions Jeff needs to make:**
- **A. Dual-write or convert?** When an inspection is signed off, does it *stay* an inspection and
  gain a linked project (two rows — cheaper, and mirrors how quotes→projects already works), or
  *become* a project (one row, migrated)? **Recommend dual-write.**
- **B. What is "signed off" on an inspection?** Projects have a signoff object to copy. Does the
  customer sign, or does the tech? What happens on un-signoff?
- **C. Does the unified scheduler mean one screen, or the main Gantt reading all four sources?**
- **D. What is Consulting?** No representation exists at all — needs defining before it can be
  excluded from anything.

**Honest scale note:** this is a data-model change, not a screen change — four schedulers, four
stage vocabularies, four tables, no shared discriminator. **Suggest sequencing: (1) fix the sync
filter bug; (2) carry `quoteType` onto projects as `projectType`; (3) add `projectId` to the three
service records; (4) sign-off → spawn on inspections; (5) scheduler unification last.**

**Status:** OPEN — needs A–D. The phantom-projects sync bug is FIXED (`01310aa`, D82): won repair/inspection quotes no longer mint Projects. (Any phantoms already in a DB remain — delete from Projects manually.) The record-unification questions stand.

---

## 14. Catalog appears unlinked between dashboard, General, and the estimate window — OPEN

**Area:** `src/app/(app)/page.tsx:72-78` + `:1431-1516`, `src/app/(app)/catalog/`,
`src/app/(app)/estimator/`, `src/lib/stores/catalog.ts`

**Reported:** 2026-07-19

**Ask:** The catalog in the dashboard doesn't seem to be linked to the same catalog in General,
or the one in the estimate window.

**Code-verified 2026-07-19 — half right, and the half that's wrong is worth knowing:**

- **The General catalog and the estimate-window catalog ARE correctly linked.** Both resolve to
  the identical `list()` export in `stores/catalog.ts:44` → the `catalog_parts` doc table.
  `/catalog` reads it directly; the estimator's picker calls `searchCatalog` →
  `estimator/actions.ts:369` → the same `catalogList()`. **Same table, same rows, same prices.**
  Add a part in `/catalog` and it is immediately findable in the estimator. No divergence.
- **The dashboard card is the actual bug — and it isn't "unlinked", it's fake.** `page.tsx:72-78`
  is a hardcoded module-level array left over from the HTML prototype:
  ```js
  const BOOKS = [ { mono:"JC", name:"JR Clancy", count:214, ageDays:92 }, … ]
  ```
  The card's headline "**529 parts · 4 price books**" is `BOOKS.reduce(...)` — a literal. The
  actual seeded catalog is **27 parts**. The dashboard page never imports the catalog store at
  all; its only real connection to the catalog is the `href="/catalog"` link.
  **It will say 529 forever, no matter what is imported.** The vendor names and the "92d / 21d /
  12d / 40d ago" staleness pills are invented too.
- **The fix is straightforward** — derive the card from `list()` grouped by `mfr` (a real field,
  already faceted on `/catalog`). **One wrinkle:** `CatalogPart` has **no `updatedAt`/age field**,
  so the "book age" pills are not derivable today. Either drop them or add a timestamp to the part
  shape. **Jeff's call.**

**Second divergence found in passing — this may be what Jeff actually clicked on.** Inside the
estimator there are two hardcoded fallbacks sitting next to the real catalog reads:
- **`SUGGEST`** (`estimator/estimator-data.ts:126+`) — the one-click "suggested parts" strip in
  each section is a literal array. Those SKUs (`CL-LB-UH`, `CL-PIPE-26`, `RB-TRAV`…) **are not in
  the catalog and are never validated against it.** So on the *same screen*, the suggestions strip
  shows hardcoded prices while the "Add part from catalog" box right below it shows real ones.
  **That is a genuine "the catalog doesn't match" experience inside the estimate window.**
- **`LABOR_RATES_FALLBACK`** (`estimator-data.ts:92-101`) — a second copy of labor rates used when
  catalog `Labor` rows are missing. Documented as intentional; lower risk, but it can drift.

**Not a divergence (name collision only):** field survey's `mergedCatalog` is the survey intake
checklist, unrelated to parts. The portal's `customerCatalog()` is a deliberate filtered view of
the same store with cost/margin stripped.

**Decisions Jeff needs to make:**
- **A. Book-age pills** — drop them, or add an `updatedAt` to catalog parts to make them real?
- **B. `SUGGEST`** — retire it in favour of catalog-backed suggestions (e.g. most-used SKUs per
  section type), or curate it properly as a real, validated quick-pick list?

**Status:** DASHBOARD CARD FIXED (`01310aa`, D82) — derived from the real store (revealed the actual 10,729-part catalog the fake card hid). Age pills dropped pending A; `SUGGEST` still needs B.

---

## 15. Suggested install timeframe on the estimate → auto-fills the project goal — OPEN

**Area:** `src/app/(app)/estimator/estimator-client.tsx` (header rows), `estimator/actions.ts`
(meta allowlist), `src/lib/stores/quotes.ts`, **`src/lib/stores/projects.ts:488-490`** (the handoff)

**Reported:** 2026-07-19

**Ask:** The estimate screen needs a suggested install timeframe — a "when does the customer
need this" line — that tracks through so when an install project is opened it auto-fills that
timeline as a goal. The line should default to a number of weeks depending on project scope
(the specific defaults to be defined later).

**Code-verified 2026-07-19 — this fills a real gap, and it's bigger than a new input box:**

- **A quote has no forward-looking date field of any kind.** Every timestamp on a quote is a
  *system event stamp* (`createdAt`, `updatedAt`, review dates, history entries). There is no
  needed-by, lead time, or install window. Net-new field.
- **The project dates it would feed are currently blind guesses.** `fromQuote()` sets:
  ```js
  targetDate   = ahead(labor ? 42 : 21)   // projects.ts:488  HARDCODED
  installStart = labor ? ahead(38) : null  // :489             HARDCODED
  installEnd   = labor ? ahead(44) : null  // :490             HARDCODED
  ```
  So **every converted project's target is `now + 42 days`, ignoring the quote entirely.** The
  shape already encodes a crude scope default (42 for labor, 21 for materials-only) — it's just
  not derived from anything anyone can set. Lines 488-490 are the exact insertion point.
- **`targetDate` is load-bearing far beyond the Gantt.** It drives procurement order-by dates and
  the "Order overdue" risk flag, the "No crew scheduled, install in Nd" flag, the field-work queue
  sort, the target diamond on the schedule, and — **most consequentially — the billing forecast in
  Reports** (`reports/page.tsx:892` bills full value at target and collects net-30 after). Today
  that entire forecast is anchored on a hardcoded 42-day guess.
- **There is no write path for project dates at all.** `updateProject()` exists and has **zero
  callers app-wide**; there is no `type="date"` input anywhere under `projects/` or `estimator/`.
  The only non-conversion ingest is the CSV importer. **So a PM cannot correct a date today** —
  which means shipping this without an edit control pipes an estimator's guess straight into the
  revenue forecast with no way to fix it.
- **The meta save path is a strict allowlist.** `updateQuoteMetaAction` (`actions.ts:146-157`)
  silently drops unknown fields by design. A new field must be threaded through it plus
  `SavePayload`, `saveQuoteAction`, `InitialQuote`, and `initialFrom()`.
- **UI slot:** the estimator header already has three stacked rows — top bar, customer/venue
  context bar, and a full-width "Quote note" row. **A fourth row modeled on the quote-note row is
  the natural home.** Note the customer select's existing tooltip already says *"flows to the
  project when this quote is won"* — same conceptual slot.

**Scope signals actually available at quote time, best to worst:**
1. **`spec.mobs[]` — `{type, days, crew, discipline}`.** The richest by far: `days` and `crew` are
   literally install duration and headcount, already carried onto the project at conversion. Only
   present when the labor modal was used.
2. `spec.sections[]` labor-item count / section count.
3. `q.value` bands — always populated, the most reliable fallback.
4. `quoteHasLabor(q)` — the current 42/21 split.

**Trap to avoid:** `deriveProcurement()` branches on `q.spec.systems`, but **nothing anywhere
writes `spec.systems`** — the estimator saves only `{sections, mobs}`. It is always `[]` and the
fallback always fires. **Do not build scope defaults on `spec.systems`.**

**Decisions Jeff needs to make:**
- **A. Relative weeks or an absolute date?** "Defaults to a number of weeks" implies relative —
  but a quote can be won *months* after it's written, and `targetDate` is absolute everywhere
  downstream. **Weeks-from-what: quote date, or win date?** Recommend storing weeks *and*
  resolving from the win date at conversion, so a stale estimate doesn't produce a past-due
  project.
- **B. Does the timeframe set `targetDate` only, or the whole triplet?** Today install is
  hardcoded as target−4 → target+2. If "when they need this" means *install complete by*, the
  triplet shifts together; if it means *install begins*, the relationship inverts.
- **C. Customer-facing or internal?** A "needed by" line is arguably content for the quote PDF,
  not just internal metadata. Product call.
- **D. Back-fill.** Quotes won before this ships have no timeframe, and `syncProjectsFromQuotes`
  re-runs on every Projects page load — so the 42-day fallback stays hot. Silent default, or
  surface "no timeframe set"?
- **E. Should a PM be able to edit the date afterward?** Strongly recommend yes, given it feeds
  the billing forecast. That's a net-new write path either way.

**Status:** OPEN — needs A–E. The scope-default *rules* can be defined later (Jeff's note); A and
B gate the build regardless.

---

## 16. Notify the company when a project is sold and when it's completed — OPEN

**Area:** `src/app/(app)/quotes/actions.ts:25-43` (won), `src/app/(app)/projects/actions.ts:100-111`
(signoff), `src/lib/gmail/bridge.ts`, `src/lib/stores/comms.ts`, `src/lib/stores/notif-prefs.ts`

**Reported:** 2026-07-19

**Ask:** An automated email batch sent when a project is **sold** and when it's **completed**, so
the rest of the company can track them. **Or** it becomes a task/lead for an employee to follow up
— for an install sale the PM reaches out; for a project close, the salesperson follows up on how
it went.

**Code-verified 2026-07-19 — read this before choosing the email route.**

**What fires today:** nothing. A quote going **won** runs four record syncs and a
`revalidatePath` — **no email, no notification, no log**. A project reaching **complete** writes
the signoff and bumps the stage — **zero side effects**. So both hook points are clean.

**Five findings that argue against automated email as the first implementation:**

1. **Unattended sending already exists and is unaudited.** The Gmail cron (`vercel.json`, every
   5 min) and the boot timer both call `checkMailIfStale()`, which calls **`flushOutbox()`
   (`comms.ts:1136`) → `dispatchOutbound` → `sendRaw`**. This is not a read-only sync — it can put
   mail on the wire. Blast radius is small today (only threads with a `queued` message), but the
   machinery is live on a 5-minute cron and nobody has reviewed it. **Adding a batch would widen a
   channel that's already open, not open a new one.**
2. **The recipients are guessed addresses that cannot be corrected.** Roster emails are derived
   `firstInitial+lastName@peaksystemsgroup.com` (`team.ts:44-52`) and there is **no UI to edit an
   existing member's email** (this is punch item 9). A company-wide batch would fan out to
   addresses nobody has ever confirmed. **Note: site-visit invites have already been quietly
   mailing these guessed addresses** (`site-visit-actions.ts:92`).
3. **No dedupe on the failure path, and the triggers are re-runnable by design.**
   `syncProjectsFromQuotes()` runs on **every Projects page load**, so "sold" is detected by
   re-running a sync, not by an event. The only idempotency mechanism anywhere is the `!m.gmailId`
   filter — and on a send failure the message keeps no id and is **explicitly retried later**
   (`bridge.ts:145-148`). There is no send-attempt counter, no idempotency key, no rate limit, no
   cooldown. **Any hook here needs its own persisted "already notified" marker, which does not
   exist.**
4. **No email log or audit trail exists.** No `email_log` table, no audit table. If a batch
   double-fires or misfires, there is nothing to inspect afterward.
5. **Failures are silent.** A disconnected mailbox or revoked refresh token throws, gets caught,
   and is `console.error`'d on a serverless function. No UI surface, no alert. Also, the sending
   mailbox fallback is **non-deterministic** — "the first shared mailbox in arbitrary DB order"
   (`bridge.ts:376-381`).

**And there's no in-app channel to route to instead.** `notif-prefs` is **only a mute list** over
a bell that is recomputed from live stores on every page render (`nav-counts.ts:33`). Nothing is
persisted, nothing is marked read, there are no notification rows. **There is no notification feed
to post to — it would have to be built.**

**Recommendation: take Jeff's own alternative first — make it a task, not an email.**
It needs no send infrastructure, no verified addresses, no dedupe worries, and it produces exactly
the accountability described ("PM reaches out", "salesperson follows up"). It also composes
directly with item 17, which is being asked for anyway: **a sold project auto-creates a
"PM: reach out to customer" task; a completed project auto-creates a "Sales: follow up on how it
went" task.** Email can layer on later once item 9 fixes the addresses and a send log exists.

**Decisions Jeff needs to make:**
- **A. Task-first or email-first?** Recommend task-first, per above. If email is genuinely
  required for company-wide visibility, it should wait on item 9 (real addresses) plus a send log
  and an idempotency marker — **that's a prerequisite, not a nice-to-have.**
- **B. If email: who receives it?** Everyone, or role-based (PMs, sales, leadership)? Which
  mailbox does it send *from* — the fallback is currently arbitrary.
- **C. Batch or per-event?** "Batch" suggests a digest (e.g. daily roll-up of sold/completed),
  which is far safer than per-event sends: one scheduled job, one dedupe window, far less
  double-fire exposure. **Recommend a digest over per-event if email happens at all.**
- **D. "Completed" has two definitions.** A project can reach `complete` via signoff **or** via a
  direct stage change with no signoff. Which one triggers?
- **E. Who is "the PM"?** There is no PM role or field on a project — only `owner` (a name string,
  the estimator). Assigning a follow-up task needs someone to assign *to*.

**Status:** OPEN — needs A–E. **Do not build the email path before item 9 and a send log.**

---

## 17. Tasks on install projects and quotes (review / communication checklist) — OPEN (A answered: real table)

**Area:** `src/lib/stores/projects.ts:161-168` (`ProjectTask`), `src/app/(app)/projects/view.tsx`,
`src/app/(app)/field-work/`, `src/lib/stores/quotes.ts`

**Reported:** 2026-07-19

**Ask:** Implement tasks in general for install projects and quotes, so we can review quicker
whether the quote and project were done properly and everything was communicated.

**Code-verified 2026-07-19 — roughly 15% of this exists.**

**What's real today:**
```ts
type ProjectTask = { id, title, section, assignee, done, doneAt? }   // projects.ts:161-168
```
An array embedded on the project doc. **No due date. No status beyond a `done` boolean. No
priority, no notes, no createdBy.** `assignee` is a free-text display name, `section` a free-text
grouping (seeds use "Mobilize"/"Install"/"Closeout", nothing enforces them).

- **Only two mutators exist:** `addTask` and `toggleTask`. **No delete, no edit, no reassign.**
- **The office Projects view has no Tasks tab at all** — the tab set is
  `overview/procurement/deliveries/crew/timeline/signoff`. Tasks appear only as a derived
  "N / M tasks" progress bar. `addTaskAction` and `toggleTaskAction` exist in
  `projects/actions.ts` and are **dead code — zero callers app-wide.**
- **The only working task UI is mobile Field Work**, and it hardcodes section `"Install"` and
  assignee = the signed-in user. You cannot set an assignee, section, or due date anywhere.
- **Quotes have no tasks whatsoever.** The closest thing is `QuoteReview` — a single approval
  state (`none → in_review → approved/changes`) on the whole record, not a list of checkable
  items. Designs have the identical pattern.
- **Task creation is 100% manual.** Nothing auto-generates from stage or template; the only
  non-empty task arrays in the repo are hand-written seed fixtures.

**No generic to-do abstraction exists.** There is no tasks table, no shared `Task` type, no
assignments table. The only shared *convention* is a field named `assignedTo` holding a display
name (comms, inspections, surveys, repairs, flame jobs, site visits) — and `ProjectTask` doesn't
even use that name, it uses `assignee`.

**The template pattern to copy already exists:** `blankRubric()` (`inspections.ts:381-401`)
expands a static template constant into per-record instances with stable synthetic keys. And
`findingsFromRubricRating()` uses a **coverage-key de-dup trick** (`inspections.ts:882-886`) to
avoid re-creating items on re-runs — **directly reusable if review tasks are auto-generated**,
which matters because the sync that would trigger them re-runs on every page load (see item 16).

**Reliability note:** every assignment in the app is a **display-name string**, and several stores
hardcode `DEFAULT_ACTOR = "Jeff Chesebro"`. A proper user identity exists and is unused for
assignment (`users.id`, carried on the session). Renaming a member silently breaks name-matched
lookups — the same fragility flagged in item 9.

**Decisions Jeff needs to make:**
- **A. Embedded or promoted?** Keeping tasks embedded on the parent doc is consistent with every
  other list in this app and is cheap — **but it makes "all my open tasks across projects and
  quotes" a full scan of two collections, and gives a task no independent identity** for
  notifications or assignment queries. If the goal is "review quicker", a cross-record task list
  is probably the point. **This is the load-bearing decision.**
  **ANSWERED 2026-07-19 (Jeff): promote to a real table.** Tasks get independent identity and
  a cross-record "all my open tasks" query becomes real. Consequences to carry into scoping:
  this is the app's **first non-doc-store collection of its kind** — every other list is
  embedded on a parent doc — so it needs a table, a `Task` type, and parent pointers
  (`projectId` / `quoteId`, nullable). The two dead server actions (`addTaskAction`,
  `toggleTaskAction`) get rewritten rather than wired up, the embedded `ProjectTask[]` needs a
  migration path, and the mobile Field Work UI (the only working task surface today) has to
  move over with it. **Unblocks item 16**, which now has a durable record to hang
  notifications off.
- **B. Auto-generated checklist, manual, or both?** "Review whether the quote and project were
  done properly and everything communicated" reads like a **standard template per stage** —
  which is the `blankRubric()` pattern. **Jeff would need to define the actual checklist items.**
- **C. Assignee: name string (app convention) or user id (reliable)?** Recommend user id with a
  denormalized name for display, accepting the inconsistency — anything gating a review shouldn't
  break on a rename.
- **D. Do tasks need due dates and a status beyond done?** For a review checklist, due dates may
  be unnecessary; for the item 16 follow-ups ("PM reaches out"), they're essential.
- **E. Should overdue/open tasks surface in the bell?** `nav-counts.ts` currently aggregates only
  derived state and has **no write side** — it's the right shape to plug real tasks into.

**Net-new work:** due date + richer status on the task type; edit/delete/reassign mutators; a task
concept on quotes (currently zero); template definition + expansion + de-dup; an office-side Tasks
tab; wiring the two dead server actions; and the assignee-identity decision.

**Related:** item 16 depends on this — the recommended task-first implementation of "notify when
sold/completed" is exactly an auto-generated task with an assignee.

**Status:** OPEN — needs A–E. A is the decision that shapes everything else.

---

## 18. Opportunities board — Daylite parity — OPEN (A answered: merged concept)

**Area:** `src/app/(app)/leads/board-view.tsx`, `leads/page.tsx`, `src/lib/stores/leads.ts`

**Reported:** 2026-07-19 (Daylite screenshot)

**Ask:** Match Daylite's Opportunities Board — kanban columns per pipeline stage, each column
showing a count badge and a dollar subtotal; a board header total ("15 Opportunities •
$4,290,263.00"); cards showing title, linked people, value, a "Nothing Scheduled" warning, an
age-in-days chip, and an owner avatar; a toolbar with filters (Owners / Forecasted Dates /
Create Dates / Categories / Keywords / Types), a Sort control, and View Options.

**Code-verified 2026-07-19 — Peak is ~70% there, and the hard part is already built.**

**What already exists** — `/leads?view=board` is a real kanban with hand-rolled HTML5
drag-and-drop between columns, optimistic re-homing, and a `setStageAction` + refresh
(`board-view.tsx:98-99, 25-45`). It already renders **per-column count badges and per-column
dollar subtotals** (`board-view.tsx:77, 58, 80-82`), an owner avatar, a colored urgency strip,
and a follow-up warning chip. Stages: `new / contacted / qualified / quoted / won / lost`
(`leads.ts:43-50`) with per-stage colors already defined.

**What's missing — narrow and mostly additive:**
- **Board header total.** Not found. Peak shows four stat tiles above the columns instead
  (Open pipeline / Need follow-up / New this week / Conversion). Close in spirit, different shape.
- **Age-in-days chip.** **The data already exists** — `aging()` (`leads.ts:349-351`) computes days
  since last activity, but its detailed text gets overwritten with the generic label "Going cold"
  before display, and `BoardCardVM` has no age field. Small fix.
- **Linked people on cards.** Cards show `org` + `interest` only. **Blocked on item 20** — there
  is no person record to list.
- **The toolbar is the biggest gap.** The board currently has **no filters at all** — `seg` is
  dropped unless `view === "table"` (`leads/page.tsx:56-63`), so the board renders every lead
  unconditionally. Sort is hardcoded (`b.urg - a.urg || b.updatedAt - a.updatedAt`). Daylite's
  six filters + Sort + View Options would all be new. **There is also no owner filter on leads at
  all** (the `scope` field on leads is scope-of-work text, not ownership).

**Finding — Peak's warning is semantically inverted from Daylite's.** Peak flags *"you had a
scheduled follow-up and missed it"* (`followUpInfo`, `leads.ts:363-374`). Daylite flags *"nothing
is scheduled at all."* In Peak, `nextActionAt == null` falls through to a green **"On track"**
chip — **the exact state Daylite would warn about.** Worth fixing regardless of the board work.
**FIXED 2026-07-19 (D83)** — `fuChip()` (`leads/lib.ts`) now returns a neutral **"Nothing
scheduled"** chip instead of a green "On track" for that fallback. Deliberately display-only:
`followUpInfo()` still reports `need: false`, so the worklist, the "Needs follow-up" count and
the urgency sort are unchanged — reclassifying it as a real follow-up need would flood the
worklist, and that's Jeff's call, not a bug fix. **Not observable in the current seed data**
(all 9 open leads already carry an SLA / overdue / going-cold warning, so the branch isn't
reached) — verified by inspection, not by browser.
**Open follow-up for Jeff:** should "nothing scheduled" count as needing follow-up (i.e.
change `followUpInfo`), or stay a passive display state? Daylite treats it as a warning.

**Also:** a true "Nothing Scheduled" badge is **not currently computable** — there is no
appointments or tasks store to query (see items 17 and 21).

**Decisions Jeff needs to make:**
- **A. What is an "opportunity" in Peak?** Daylite has one entity; Peak has **two** — Leads
  (`new→lost`, 6 stages) and Quotes (`draft/sent/won/lost`). Daylite's bid-oriented stages
  (New Lead / Collect Information / Create BID / BID Sent / Awarded / PO Received / Order Product)
  span both. **Does the board sit on leads, on quotes, or on a merged concept?** This decides
  everything else.
  **ANSWERED 2026-07-19 (Jeff): the merged opportunity concept.** One pipeline spanning
  lead → bid → award. **This is a modeling change across two stores, not a UI change** — it is
  the honest answer but the most expensive of the three, and it makes 18 substantially bigger
  than the "~70% already built" framing above, which assumed the board stays on leads.
  Scoping needs to settle: whether an Opportunity is a **new record** that leads and quotes
  both point at, or a **read-time union view** over the two existing stores (much cheaper,
  no migration, but drag-between-stages has to write back to whichever store owns the row);
  what happens when one lead produces several quotes (does the opportunity fan out?); and
  which store owns the stage once the two pipelines are merged.
  **Note the coupling to item 20** — "linked people on cards" is blocked on the person model,
  which Jeff is building himself.
- **B. Should Peak's stage names change to the bid-oriented set?** That's data config, not
  architecture — cheap if A is settled.
- **C. Which filters actually matter?** Owner and date are the obvious ones; Categories /
  Keywords / Types have no Peak equivalent and would each need a new field.

**Status:** OPEN — needs A first; A is a modeling question, not a UI one

---

## 19. Projects board — Daylite parity — OPEN

**Area:** `src/app/(app)/projects/view.tsx`, `src/lib/stores/projects.ts`,
`src/app/(app)/leads/board-view.tsx` (the component to generalize)

**Reported:** 2026-07-19 (Daylite screenshot)

**Ask:** A Projects Board in the same kanban shape as the Opportunities Board — columns per
project pipeline stage, cards showing title, linked people, and a due/age chip.

**Code-verified 2026-07-19 — no board today, but the model is ready:**
- `/projects` is a **master-detail list** (left column of cards, right detail pane), not a board.
  `stage` is never used as a grouping axis — it only drives a pill and a progress percentage.
- **The stage data is well-formed:** `PROJECT_STAGES` = procurement → delivery → scheduled →
  install → training → signoff → complete, with labels (`projects.ts:77-85`); `ORDER_STAGES` is a
  4-stage path (`:87-92`). `stageIndex`, `progressPct` and a stage setter all exist.
- **The project card already renders the two signals Daylite's cards show** — a risk badge and a
  due/age chip ("Due in 12d" / "3d overdue" / "Due today", `view.tsx:501-510`). That age chip is
  the one item 18 is missing, already built here.
- **The realistic path is to generalize `board-view.tsx`**, which is currently hardcoded to
  lead-shaped VMs and `setStageAction`, into a stage-agnostic component both screens feed.

**Complication to decide:** projects have **two different stage sets keyed on `kind`**
(`stagesFor`, `projects.ts:94-96`) — 7 columns for installs, 4 for materials-only orders. A single
board must either filter to one kind or reconcile both pipelines.

**Note:** `package.json` has **no drag-and-drop or board library** (deps are pglite, drizzle,
leaflet, next, next-auth, postgres, react, three, zod). The one board in the app is hand-rolled
HTML5 drag. Generalizing it avoids a new dependency; a richer board (multi-select, keyboard
reorder) probably wouldn't.

**Decisions Jeff needs to make:**
- **A. One board filtered to `kind = project`, or both pipelines reconciled?**
- **B. Should dragging a project between stages be allowed?** Stage changes on projects have real
  downstream meaning (procurement, crew, billing forecast) — unlike leads, where a drag is
  harmless. Recommend read-only columns first, drag later.
- **C. Does this replace the master-detail list or sit alongside it as a `?view=board` toggle?**
  Recommend alongside, matching the leads pattern.

**Status:** OPEN — depends on item 18 (shared component); B is worth thinking about carefully

---

## 20. People and companies as first-class records + multi-linking — PHASE 1 LANDED (D85)

**Area:** `src/lib/stores/customers.ts`, `src/db/doc-tables.ts`, and every screen that renders
"the customer"

**Reported:** 2026-07-19 (Daylite screenshots — project and contact views)

**2026-07-19 — Jeff took this item himself.** He is building the people/companies
model; nobody else should scope or start it. Check with him before touching
anything downstream of the person model (18's linked people, 21's linked-record
rows, 23's people / opportunity fields).

**Ask:** Projects and opportunities should link to **multiple contacts and multiple accounts**
(Daylite shows one project linked to 10+ people and 5 companies — Grounded Electric, Mainstage
Theatrical Supply, Nexus Solutions, Richland Center High School, Stagewerks). Also a **contact
detail view** matching Daylite's: a person's own page listing every project and opportunity
they're linked to.

**Code-verified 2026-07-19 — read this before scoping. This is foundational, not incremental.**

**There is no person record in Peak.** A contact is an anonymous struct embedded in a customer
blob: `CustomerContact = {name, role, email, phone?, primary}` (`customers.ts:51-58`) — **with no
`id` field.** There is no `contacts`/`people` collection among the twelve doc tables, and no
`/people` or `/contacts` route. **You cannot open a contact's page, because a contact is not a
thing.**

Consequence already biting today: every contact reference is a **name string matched by equality**.
`contactByName()` does `find(c => c.name === name)`; the estimator silently falls back to the
primary contact when a stored name no longer matches (`estimator/page.tsx:101`). **Renaming a
contact silently re-points every quote to a different person.**

**There is no company record distinct from a customer.** `CUSTOMER_TYPES` are venue categories
(Performing arts / Education / Worship / Civic / Commercial) — nothing for contractor, dealer,
consultant, or architect. **Vendors are bare strings** on procurement lines (`projects.ts:122`),
values like `"Rose Brand"`, `"JR Clancy"` — no id, no address, no contacts, no page. So in the
Daylite example, Peak could hold *Richland Center High School* as a customer, but **Grounded
Electric, Mainstage, Nexus Solutions and Stagewerks have nowhere to live.**

**Every association in the app is a single scalar.** Quote: `customerId`, `locationId`,
`contactName` — all singular. Project: `customer`, `customerId`, `locationId`, `owner` — all
singular. `crew[]` is the only person-ish array and it holds **internal employee name strings**,
not customer contacts. **There is not one multi-contact or multi-company link anywhere.**

**There is no join table and the persistence layer resists one.** Every collection is
`{id, doc(jsonb), rev, seq, updatedAt, deleted}` with no foreign keys and no Drizzle `relations()`
anywhere. The architecture is deliberately document-oriented (`doc-tables.ts:26-28`). A many-to-many
must be either id arrays denormalized into both sides (hand-maintained consistency) or a genuinely
new relational join collection — which also has to be reasoned about for offline sync conflict
(two field techs adding different people to the same project).

**Honest architectural read:** Peak models a *venue-centric service business* — one customer, one
venue, one contact, one PM, your own crew. It's internally consistent and the code is clean about
it. Daylite models a *relationship graph*. **These are different products at the data layer.**
This is a foundational refactor of the customer/contact domain plus a new UI surface, not a
feature bolt-on.

**What it would require, in dependency order:**
1. **A `people` collection with stable ids.** Migrate embedded `contacts[]` out, leaving customers
   with `contactIds[]`. Breaks every name-based lookup and needs a backfill that de-duplicates the
   same human appearing under multiple customers. **Nothing else on this list is possible until
   this exists.**
2. **An `organizations` concept** — or widen `customers` with a role/kind so non-customer companies
   can exist. **Daylite's answer is that "customer" is a *role on a link*, not a record type** —
   that's the cleaner model and worth considering.
3. **A link/role model:** `{recordType, recordId, entityType, entityId, role}`. The roles carry
   real information — "Grounded Electric (electrical sub)" vs "Richland Center HS (end client)" is
   exactly what the chip list communicates.
4. **Rewrite quote/project links from scalars to collections**, keeping a denormalized
   `primaryCustomerId` so the ~dozen screens that assume one customer keep working during migration.
5. **New UI:** role-tagged chip lists on project/quote detail, a person detail page with reverse
   rollups, an org page, and a picker that searches across people and orgs. (Note item 12 already
   flags that **12 screens each roll their own customer `<select>`** — a shared picker pays for
   itself here too.)

**Decisions Jeff needs to make:**
- **A. Is this actually wanted, given the cost?** The honest question. A cheaper 80% might be:
  give contacts stable ids, add a multi-contact list to projects/quotes, and model outside
  companies as a lightweight "related organizations" list — **without** promoting people to
  first-class records with their own pages. **That gets the chip lists without the graph.**
- **B. If yes: is "customer" a record type or a role on a link?** This is the fork in the road.
- **C. What roles matter?** End client, GC, electrical sub, consultant, architect, dealer,
  vendor…? Jeff would need to define the list.
  **CONFIRMED by the company screenshot (2026-07-19):** Daylite links *do* carry roles — the
  Portage Center for the Arts record shows `opportunities: Audio System Upgrades · **Participant**`,
  and its timeline logs *"Linked to Audio System Upgrades as Participant"*. So the role isn't
  decoration; it's stored on the link and it's what the chip list communicates. **The link/role
  model in step 3 is required, not optional.**
- **D. Does a person belong to exactly one company, or many?** Daylite allows many.

**Related:** item 12 (lead→contact linkage) is a subset of this. Item 18's "linked people on
cards" and the contact-detail view both **depend on step 1**.

**Status:** PHASE 1 LANDED 2026-07-19 (D85) — A was answered by the approved Daylite-parity design (full graph, phased): companies/contacts/emails/phones/sites are real relational tables; People + Companies are in the nav; every contact is openable at /people/<id>. Junction tables + shared picker (steps 2-3 here) are Phase 2 of the design; multi-link chips on quotes/projects follow there. Item 12 remains absorbed by Phase 3.

---

## 21. Per-record activity timeline — OPEN

**Area:** `src/app/(app)/customers/[id]/page.tsx`, `projects/view.tsx`,
`src/app/(app)/leads/lead-drawer.tsx:817` (the only prior art)

**Reported:** 2026-07-19 (Daylite screenshots — timeline on project and contact views)

**Ask:** A unified Activity timeline on record detail pages, as in Daylite: reverse-chronological,
bucketed ("Last Seven Days" / "Earlier This Year" / "2025"), mixing appointments, completed tasks,
notes, "Linked to <record>" events, and status changes ("Won on Oct 23, 2025, $36,000.00",
"Abandoned", "Open, $255,800.00"), each with a type icon, subtitle and date — plus an
"All Activity" filter and a feed search.

**Code-verified 2026-07-19 — ~70% of the data exists, ~0% of the machinery.**

**The one piece of prior art:** the lead drawer (`lead-drawer.tsx:817`) renders a real
Daylite-shaped feed — icon rail, connector line, reverse-chron, "who · when" — from `LeadActivity`
(`{id, at, type, by, note}`, types `note|call|email|meeting|system|stage`). It's hardcoded to that
one array, but it's the component pattern to generalize.

**A customer-scoped timeline is mostly an aggregation exercise.** Nearly every collection already
carries a `customerId` — quotes, leads, comms, projects, flame jobs, repairs, inspections,
surveys, designs, site visits. **The customer detail page already fetches five of those sources**
and renders them as five separate stacked cards, unmerged and ungrouped. Merging them is the feature.

**Notable: the data for Daylite's status rows already exists and is thrown away at render.**
`QuoteHistoryEntry` (`{at, from, to}`, `quotes.ts:53`) is written on **every** status change
(`quotes.ts:191`) — but is never rendered as a timeline. Its only consumers treat it as a scalar
(a revision count, and won/lost date extraction in Reports). "Won on Oct 23, $36,000" is a
formatting job over data Peak is already keeping.

**Project-scoped timelines are much weaker — and there is active data loss.**
**`ProjectRecord` has no stage history at all. `setStage()` (`projects.ts:385-389`) overwrites
`p.stage` in place — the previous stage is destroyed on every write.** Flame/repair/inspection
keep only `approvedAt`/`completedAt` endpoints; inspection `setStage` likewise overwrites.
**Project stage history is unrecoverable for every existing record** — adding the array only
starts accruing from the change forward. **Worth adding the history array now even if the timeline
itself is deferred**, so the data stops being discarded.

**Other gaps:**
- **No notes system.** Three unrelated per-record fields (`ProjectNote[]` structured and
  timestamped; `SurveyDraft.notes` and `SiteVisit.notes` are single freeform strings). No
  attachable note record.
- **No attachments model.** The `blobs` table is a key/value store for settings JSON, **not** file
  storage. Real files are base64 data-URLs embedded in parent documents
  (`CommAttachment`, `SurveyPhoto`, `ProjectNote.photo`, inspection before/after photos, repair
  completion photos) with no shared model and mostly no timestamps.
- **Calendar events are not linkable.** `CalendarEvent` carries no customerId/projectId/quoteId —
  Google events are opaque. Site visits *are* linked, but once pushed to Google they're deduped out
  of local rendering and show as an opaque Google row. The agenda is also filtered to the signed-in
  user, so it's a personal agenda, not a record history.
- **No "Linked to <record>" events.** `CommLink` is the only record-to-record pointer and it's
  current-state with no timestamp of when the link was made.
- **No `projectId` on the field-work collections** — repairs, inspections, surveys and flame jobs
  link to customer and quote but not project, so a project timeline needs a `quoteId` join.

**Decisions Jeff needs to make:**
- **A. Customer timeline first?** It's much cheaper (read-time aggregation over existing docs, no
  schema change) and covers quote status changes, comms, site visits, job approvals/completions and
  project notes. **Recommend starting there.**
- **B. Add project stage history now?** Independent of the timeline, and it stops ongoing data loss.
  **Recommend yes. — DONE 2026-07-19 (D83).** `ProjectStageChange {at, from, to, by}` mirrors
  `QuoteHistoryEntry` and adds the actor. `stageHistory[]` on `ProjectRecord`, backfilled to `[]`
  on read, anchored at creation with a `from: null` opening entry. Every stage write now goes
  through one `recordStageChange()` helper — `setProjectStage()` **and** the silent
  `setSignoff()` side-write that used to move a project to `signoff` with no record. No-ops when
  the stage is unchanged. `setStageAction` / `signoffAction` now pass the signed-in user, so
  transitions are attributed to whoever made them instead of the hardcoded default actor.
  **Browser-verified** on P-3002: advancing scheduled→install then back recorded both
  transitions with actor and timestamp. **History before this change is still unrecoverable** —
  the array only accrues from here forward.
- **C. Does the timeline need true field-level change tracking** ("who changed what when"), or is
  event-level enough? Field-level is a much bigger commitment.
- **D. Do notes and attachments become real records?** Both are prerequisites for the "note added"
  / "file attached" rows Daylite shows.

**Status:** OPEN — A and B are independently useful and cheap; C and D are the expensive half

---

## 22. Navigation / module parity with Daylite's sidebar — OPEN

**Area:** `src/components/nav/nav-data.ts`, list screens across the app

**Reported:** 2026-07-19 (Daylite sidebar screenshot). **Jeff's note: "I believe we have
accomplished all of these."**

**Code-verified 2026-07-19 — parity is NOT achieved. Honest gap list below.**

| Daylite entry | Peak | Status |
|---|---|---|
| Home | `/` | **Equivalent** |
| My Mail | `/inbox` — richer (personal + shared mailboxes) | **Equivalent** |
| Team | Exists **inside Settings** only, no nav route | Partial |
| Learn | No help/docs/training screen anywhere | **Missing** |
| My Calendar | `/calendar`, strictly personal | **Equivalent** |
| All Calendars | No teammate/all-user calendar view | **Missing** |
| Peak Calendar (shared org) | Nothing (`/schedule` is crew scheduling, not a calendar feed) | **Missing** |
| People | No `/people` route, no person record — see item 20 | **Missing** |
| Companies | No company entity distinct from customers — see item 20 | **Missing** |
| Added in last 7 days | No recently-added view on any list | **Missing** |
| Opportunities Board | See item 18 | Partial |
| My Opportunities | **No owner filter on leads at all** | **Missing** |
| All / All Open Opportunities | `/leads?seg=all` / `?seg=open` — in-page pills, not nav | Partial |
| Jason's Open Opportunities | No per-person lead filter | **Missing** |
| My Lost Opportunities | `?seg=closed` bundles **won and lost together**, unsplittable, not owner-scoped | Partial |
| Projects Board | See item 19 | Partial |
| My Projects | **No owner scoping on `/projects` at all** | **Missing** |
| All / All Open Projects | `/projects?filter=` variants | Equivalent (as pills) |
| Worklist / My Tasks / Delegated / Done / All Tasks | See item 17 — tasks barely exist | **Missing** |
| Jason's / Chris' / Mark's / Mike's Task List | No tasks, no per-person views. **The fuller sidebar screenshot shows four of these** — per-person task views are a standard pattern in their workflow, not a one-off | **Missing** |

**The pattern behind most of these gaps: Peak has no scoped or saved views.** Every Peak nav entry
is a *module*, never a *filter*. The "My X vs All X" capability exists in exactly two places, both
buried in dropdowns rather than nav:
- **Quotes** is genuinely full-featured — `?who=mine|all|<Name>` × `?status=` × `?type=`, with the
  owner list built from the live roster. `/quotes?who=Jason%20Keagy&status=lost` is a real
  "Jason's Lost Quotes" today. It just isn't discoverable.
- **Customers** has `?scope=mine|all|<owner>`, where owner is *derived* from the newest
  quote/project rather than stored.

Leads, Projects, Flame Tests, Inspections and Repairs have **no owner scoping at all**.

**No saved views, custom filters, or per-user list config exist** — zero grep hits. All filter
state is ephemeral URL params, and **there is no per-user settings row** to persist them in
(`appSettings` is a single global row), so this needs a schema addition — the same `notifPrefs`
pattern flagged in item 7.

**Cheapest high-value fixes, in order:**
1. **Surface the scoping that already works** — promote the Quotes owner/status filters into nav
   entries ("My Quotes", "My Lost Quotes"). Nearly free.
2. **Add owner scoping to Leads and Projects** — the roster lookup pattern already exists in Quotes.
3. **Split won from lost** on the leads `closed` segment.
4. Then: saved views (needs per-user persistence), People/Companies (item 20), tasks (item 17),
   shared calendars.

**Decisions Jeff needs to make:**
- **A. Does Peak want nav-level scoped views, or are in-page filters fine?** Daylite's sidebar is
  essentially a saved-view list. Peak's is a module list. **This is a navigation philosophy choice**
  and it interacts with item 7 (per-section dashboards).
- **B. Are per-person views ("Jason's Task List") wanted,** or just "mine vs all"? Per-person is
  what forces real saved views.
- **C. Is "Learn" wanted** — an in-app help/docs screen?
- **D. Shared/team calendars** — item 2 shipped a personal calendar; is an all-calendars or shared
  Peak calendar view wanted next?

**Status:** OPEN — needs A–D. Items 17, 18, 19 and 20 close most of the Missing rows. **People and Companies nav entries exist since D85** (General group); the scoped-views/per-person-lists question (A/B) still stands for Phase 6.

---

## 23. Customer / company record field parity — OPEN

**Area:** `src/lib/stores/customers.ts`, `src/app/(app)/customers/`

**Reported:** 2026-07-19 (Daylite company module — "Portage Center for the Arts")

**Ask:** Match the Daylite company record's shape.

**What the screenshot shows, field by field, vs. Peak today:**

| Daylite field | Example value | Peak equivalent |
|---|---|---|
| **keywords** | `Non-profit` (chip) | **Missing** — no tagging system anywhere |
| **category** | `Prospect` (colored dot) | **Different meaning** — Peak's `type` is a *venue* category (Performing arts / Education / Worship / Civic / Commercial), used only for a colour chip. Daylite's is a **lifecycle stage** |
| Work address | 301 E. Cook St, PO Box 866, Portage WI | Partial — `CustomerLocation` has `address`/`city`/`state` (added D76), no PO box line |
| **Billing** (a URL) | portagecenterforthearts.com | **Missing** — no website or billing field |
| **"Untitled Label"** (an email) | portagecenterforthearts@frontier.com | **Missing** — this is a **user-defined custom field**; Peak has no custom fields |
| **people** | Craig Radi (linked chip) | Partial — `contacts[]` embedded, not linked records (item 20) |
| **opportunities** | Audio System Upgrades · **Participant** | **Missing** — no opportunity link, and no role on a link (item 20) |
| **Referred by** | Patrick Strain | **Missing** — no referral field. Note leads have a `source` picklist, but it's not a person link |
| **"Legrand Changed"** (a date) | 3/2/2009 | **Missing** — another user-defined custom field |
| permissions | Public | **Missing** — no per-record permissions |
| **owner** | Jason Keagy | **Weaker** — Peak has no stored owner on a customer; it's *derived* from the newest quote/project |
| created / modified | Mar 2 2009 / May 26 2019 | **Missing** — `CustomerDoc` has **no `createdAt` or `updatedAt` at all** |

**Three findings worth calling out:**

1. **`CustomerDoc` has no timestamps.** `{id, name, type, location, locations[], contacts[]}` —
   that's the whole record. No created, no modified, no owner, no notes. The Daylite record is
   showing a 17-year history (created 2009, modified 2019). **Peak cannot answer "when did this
   customer come on" or "who owns this account" from the record itself.** This is also why item 22
   has no "Added in last 7 days" view — there is no created date to filter on.
2. **"Category" means something different in each app.** Daylite's `Prospect` is a **lifecycle**
   (prospect → customer → …). Peak's `type` is a **venue segment**. These are orthogonal and Peak
   is missing the lifecycle one entirely — which matters, because a "Prospect" company with an
   opportunity but no quote is exactly what Peak's leads pipeline half-models today.
3. **Two of the visible fields are user-defined** ("Untitled Label", "Legrand Changed"). Daylite
   supports custom fields per record type. **Peak has none, and adding them is a real feature**, not
   a field addition — it needs definition storage, per-type schemas, and rendering.

**Also visible in the timeline** (relevant to item 21): the entries are heavily **manual notes** —
"left message for Patrick @ Portage Performing Arts Center", "Proposal presented/sent", "Creating
design/estimate", "First contact complete". So Daylite's activity feed is substantially a
**note-taking surface**, not just an automatic event log. That strengthens item 21's decision D
(notes as real records) — without it, a Peak timeline would only ever show system events.

**Decisions Jeff needs to make:**
- **A. Add a lifecycle category** (Prospect / Customer / Past / …) alongside the existing venue
  type? Cheap and probably high value — it's how the company screenshot is actually organised.
- **B. Keywords/tags** — wanted? They also drive the board's "All Keywords" filter (item 18).
- **C. Custom fields** — genuinely wanted, or were "Untitled Label" and "Legrand Changed" just
  legacy cruft in their data? **Worth Jeff confirming before anyone scopes this** — custom fields
  are a large feature and these two look like artifacts of a 2009-era record.
- **D. Store `owner` on the customer** instead of deriving it? Recommend yes — derived ownership
  breaks as soon as a customer has no quotes. **— DONE 2026-07-19 (D83).**
- **E. Add `createdAt`/`updatedAt` to customers?** Recommend yes regardless; it's near-free and
  unblocks "Added in last 7 days". **— DONE 2026-07-19 (D83).**

**D+E as built:** all three fields are **optional** on `CustomerDoc` — records written before
this have none and there is no way to reconstruct them, so the type says so rather than lying
with a default. Two traps handled:
1. **`normalizeRecord()` rebuilds the doc from form input**, so a naive add would reset
   `createdAt` and drop a stored `owner` on every save. A `stampMeta(next, prev, t)` helper now
   carries metadata across both write paths (`upsert` and `setDirectory`).
2. **`updatedAt` only advances when the content actually changed** (compared with the meta keys
   stripped). `setDirectory` is a full-replace; stamping unconditionally would make "modified"
   mean "last time anything saved" for every customer at once. *(Note: `setDirectory` currently
   has no callers outside the store — `upsert`/`remove` are the live paths — but the
   full-replace semantics are still there to trip over later.)*

The Customers list now prefers a stored `owner` and **falls back to the quote/project rollup**
when unset, so nothing changes visually until an owner is actually assigned.

**Still to do before this is user-visible:** no UI writes `owner` yet (the customer edit form
has no owner field), and nothing renders created/modified dates. **"Added in last 7 days" (item
22) is unblocked but not built** — and it will only see customers created from here forward.
- **F. Referral tracking** — a "Referred by" person link, or is the existing lead `source`
  picklist enough?

**Status:** LARGELY LANDED via D85 — companies now carry type, lifecycle (Daylite category), keywords, website, mainPhone, HQ address, pricingTier (fallback), ownerUserId, referredByContactId and real timestamps as columns; contacts carry title, status (active/former/do_not_contact) and pricingTier. Remaining: UI for keywords/lifecycle editing, "added in last 7 days" view (F), and C (custom fields) still waits on the export audit.

---

## 24. Quote revisions — snapshot & recall — DONE (D84)

**Area:** `src/lib/stores/quotes.ts`, `src/app/(app)/estimator/*`, and
`src/lib/stores/designs.ts` + `quick-design/actions.ts` (the pattern to copy)

**Reported:** 2026-07-19 (surfaced while answering item 11 B — Jeff's tier answer assumed this
feature already existed)

**Ask (Jeff, 2026-07-19):** Quote revisions "like design revisions where they are simply
snapshots that can be recalled, so if they go in a different direction and the quote is too much
we can go back a revision." Also the item 11 B mechanism: **a new revision pulls current prices**,
so an updated quote is a fresh revision rather than a rebuild from scratch.

**Today: quotes have no revision concept at all** (code-verified 2026-07-19).
- `DesignRevision` is real and works — but **on designs only**.
- `Quote.history` is *status transitions* (`{at, from, to}` over draft/sent/won/lost), written in
  exactly one place (`quotes.ts:191`) and consumed only for won/lost dates in Reports
  (`reports/page.tsx:503,507`). **It is not a revision log.**
- **No duplicate / clone / new-version action on quotes anywhere** (zero grep hits).

**The design pattern, exactly as it works (copy this):**
- `addDesignRevision()` (`designs.ts:208-223`) appends `{rev: revs.length+1, at, ...snap}` to an
  embedded `revisions[]` array. Immutable — nothing is ever rewritten.
- `saveRevisionAction()` (`quick-design/actions.ts:65-88`) **saves the record first**, then
  snapshots a **whitelist of fields** (not the whole doc) plus `by: user.name`.
- `restoreRevision()` (`quick-design-client.tsx:288-297`) is **client-side only** — it merges the
  snapshot into editor state and writes nothing. The current version is never destroyed; the user
  saves (and can cut a new revision) from there. **This is exactly the "go back a revision"
  behaviour Jeff described, and it is non-destructive by construction.**

**The one hard part — a quote snapshot must store computed OUTPUTS, not just inputs.**
Estimator quotes bake absolute prices into the saved spec, so snapshotting inputs is fine. But
flame-test / repair / inspection quotes **read the live rate blobs at render time** —
`stores/pricing.ts:15-17` states it outright: *"editing them here is LIVE: the engines read the
same blobs, so every flame-test / repair quote reprices immediately."* **So an input-only
snapshot of a service quote would re-price at whatever the rates are on the day you recall it —
you would not get back the number you actually sent.** The snapshot has to capture the resolved
`value`, `margin` and line-level prices for the revision to mean anything.

This is the same split flagged in item 11 finding 2, and **fixing it here fixes it for item 11** —
a revision that stamps the tier margin *and* the resolved prices at cut time is precisely the
mechanism Jeff described in 11 B.

**Other scoping notes:**
- **Snapshot size.** `spec` is the estimator's full section/line tree. N inline snapshots grow the
  quote row every time. Designs have the same shape but are smaller and fewer. Embedded matches
  every other list in the app; a side collection is cheaper per read but is the first of its kind
  (see item 17 A, which just went the other way).
- **Lifecycle interaction is the risk.** Won quotes spawn projects (`syncFromQuotes`), and a
  project carries its own `value`/`margin` copied at conversion. **Recalling an old revision on a
  won quote would silently desync the quote from the project already built from it.** Decide
  whether revisions are allowed after `won` at all.
- **The portal reads quote `value`** — recalling a revision on a sent quote changes what the
  customer sees. Needs a rule.
- Whitelist the snapshot like designs do; do **not** deep-copy the whole doc (it carries `review`,
  `history`, `portalAcceptance` and the engine subdocs, none of which should time-travel).

**Decisions Jeff needs to make:**
- **A. Manual or automatic?** Designs snapshot on an explicit "Save revision" button. Should a
  quote also auto-snapshot on send (so "what we sent them" is always recoverable)? **Recommend
  auto-snapshot on send, plus the manual button** — the send snapshot is the one with legal weight.
- **B. Revisions after won?** Recommend blocking, or warning loudly, because of the project desync.
- **C. Embedded array or side collection?** Recommend embedded (design parity, cheapest) unless
  quote specs turn out large in real data.
- **D. Does the customer/portal ever see revision history,** or is it internal only? Recommend
  internal only.

**BUILT 2026-07-19 (D84, `210a43b`).** Answers taken as recommended (A: auto-snapshot on send
*plus* a manual button; B: block recall on won; C: embedded array; D: internal only).

- `QuoteRevision {rev, at, by, reason, note, name, value, margin, status, quoteType, spec,
  flameTest, repair, inspection}` — append-only on the quote doc, `revisions?` optional so
  pre-D84 quotes are untouched.
- **The payload is stored, not recomputed** — the whole point. The engine subdocs already carry
  a resolved breakdown written at save time (rates, trip, per-venue charges, totals), and the
  customer letters already read exactly that, so snapshotting them captures what the customer
  saw. This turned out much cheaper than feared: no new resolution code was needed.
- **Auto-snapshot on send** is intercepted in `setStatus()`, not at the call sites — every
  legitimate transition funnels through it, so one interception covers all six callers.
- **Recall is non-destructive:** `restoreQuoteRevision()` snapshots the current state *first*
  (`"Auto-saved before recalling vN"`), applies the old payload, then records `"Recalled vN"`.
  Walking back never discards the direction walked away from.
- **Refuses on won quotes** — the spawned project copies `value`/`margin` once at conversion and
  derives every procurement line cost from `value`, and never re-reads. UI shows a read-only
  banner instead of Recall controls.

**Bug fixed in passing:** the estimator's `Rev N` label counted `history` — the *status*
pipeline — so it climbed on every draft→sent→won move with no revision taken. Now counts real
revisions.

**Implementation note worth keeping:** `quotes/controls.tsx` must not import from the quotes
store **even type-only** — it is a client bundle and the bundler walks the edge into
postgres/drizzle regardless. The revision row is a local VM the server maps into, matching the
`leads/types.ts` pattern.

**Browser-verified** on Q-2047: manual → v1; send → v2 auto `"Sent to customer"`; recall v1 →
v3 + v4 with nothing lost. Q-2035 (won) showed the banner and no Recall control.

**Status:** DONE (D84) — **item 11 is now unblocked.**

**Not built / deferred:** no revision UI inside the estimator itself (only on the Quotes detail
panel), no diff between revisions, and recall does not re-open the estimator — it writes the
recalled numbers straight onto the quote.

---

## IDEA (not a punch-list item) — Consulting as a project type

**Raised:** 2026-07-19. Jeff was explicit this is *"more of an idea than punch list"*.

Build out a consulting portion of a project: design build-out, tracked reviews and meetings,
spec generators and other document generation. Likely lives in the **Design Studio**.

**Context from the item 13 recon:** "Consulting" has **no representation anywhere in the codebase**
today — not a `quoteType`, not a record type. It would be net-new. It's also named in item 13 as
one of the two things that should *not* appear in the installs window, so the two items are
coupled: **item 13 can't fully answer "what's excluded from installs" until Consulting is defined.**

Existing pieces it could build on: document generation already exists (PDF letters, service
reports, flame/inspection/repair letters), `/templates` holds editable wording, and the Design
Studio already has a save-bar + per-customer saved designs.

**Note:** `IDEAS.md` (the historical feature-idea backlog, referenced from DECISIONS.md and
MASTER-QUESTIONS.md as `docs/IDEAS.md`) **no longer exists in the repo.** Parked here for now —
**Jeff: want IDEAS.md recreated as the home for this kind of thing, or keep ideas in this file
under a clearly marked section?**
