# Peak Punch List

Running list of requested changes. Jeff adds items (often with screenshots); nothing gets
implemented until he says so. Statuses: `OPEN` → `IN PROGRESS` → `DONE`.

---

## 1. Inbox must actively sync with Gmail state — OPEN

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

## 2. Site visits: schedule → customer link → calendar invite → in-app calendar — OPEN

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
the Calendar API, then use "Enable calendar" on your mailbox (DEPLOY.md). Remaining
slice of the original item: a full-page month/week in-app calendar view.

---

## 3. Remove all emoji — the software should read as professional — OPEN

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

## 6. Merge Lineset Weights into Lineset Builder — OPEN

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

## 8. Remove the AI panel from General Settings — OPEN

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

**Status:** OPEN — trivial once Jeff confirms (i) vs (ii)

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

**Status:** OPEN — needs A–D; note part 2 is a defect, worth fixing ahead of the rest

---

## 10. Estimating Rules: display options to tame the scroll — OPEN

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

**Status:** OPEN — small, self-contained, no data model change

---

## 11. Customer pricing tiers → default margin (incl. customer portal) — OPEN

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
- **B. Retroactivity.** When a customer moves tiers, do open drafts reprice? Sent quotes? Today
  the answer differs by quote type (finding 2). **Recommend stamping the tier margin onto the
  quote at creation** so history is stable and auditable.
- **C. Scope.** Which of the five margin systems does the tier touch? Estimator lines only is a
  contained change; all five (incl. curtains' 38% and the portal coupling) is a much bigger job.
- **D. Portal equipment prices.** Catalog `list` is a per-SKU absolute with no percentage hook.
  Does a tier discount off list, or re-derive list from cost? These expose different pricing
  philosophies to the customer.
- **E. Should the customer *see* they're on a tier** (a named discount line), or is it invisible?
- **F. Tier definition.** Fixed enum, or an admin-editable list with per-tier margins? The rules
  registry has `defineGroup`/`addRate` that could host per-tier margins cleanly.
- **G. Existing customers with no tier** — default to a "Standard" tier at today's 30% so nothing
  reprices silently.

**Suggested phasing:** (1) add `pricingTier` to the customer + an admin-editable tier→margin
table; (2) seed the estimator section margin from it and stamp it on the quote; (3) portal last,
since it carries the client/server coupling risk.

**Status:** OPEN — needs A–G. Largest item on the list; do not start without B answered.

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

**Status:** OPEN — needs A–D. The convert() phone/address drop is a standalone bug worth fixing first.

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

**Status:** OPEN — needs A–D. Item (1) is a bug fix that should not wait for the rest.

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

**Status:** OPEN — the dashboard card fix is small and self-contained; `SUGGEST` needs A/B first

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
