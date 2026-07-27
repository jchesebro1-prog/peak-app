# Peak Punch List

Running list of requested changes. Jeff adds items (often with screenshots); nothing gets
implemented until he says so. Statuses: `OPEN` → `IN PROGRESS` → `DONE`.

---

## Build log — 2026-07-22 (working tree, UNCOMMITTED; UI items need a visual check)
Built this session, all typecheck-clean: **#25** consulting rename (route kept) · **#28** lineset
default 50×30 · **#32** venue street-autofill fix · **#37** sell-price→margin (per-section margin now
fractional) · **#35** `consulting_proposal` template → Peak's Fall Creek voice · **#36** client BOM
"Prices" toggle (qty-only, all renders) + `allowance` line type (creatable via a toggle) + per-line
note (`comment`) · **#26** Fixture Cross-Reference screen under Design (`/design/fixtures`, 7 matrices,
imported to `src/lib/design/fixture-crossref.json`) · **#33** mobile foundation (fluid `--pk-h*` scale
+ `.pk-content` mobile padding + overflow guards + `useBreakpoint` hook).
**Still open (need Jeff's calls):** #36 narrative estimate proposal + T&C/warranty (Jeff: BOM-first,
deferred) · #35 structured scopes / checkable assumptions / lead+estimate logging / architect link
(ties to #20) · #29 lineset weights (A–E) · #30 laser (device) · #34 pipeline (daylite foundation
first). #27 folded into Design via #26. Session detail:
`sessions/2026-07-22-daylite-import-and-punchlist-buildout.md`.

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

## 4. Claude API integration — RESOLVED by removal (D89)

**Area:** `src/lib/ai/*` (built but inert, gated on `ANTHROPIC_API_KEY`), Site Intake Phase 2

**Reported:** 2026-07-19 (logged to this file 2026-07-19)

**Ask / decision:** Not now. Covers Site Intake Phase 2's "LLM scope skeleton" (repo item
**D7**, currently blocked on Jeff creating an Anthropic API key) and any other runtime model
calls.

**Reason for deferral:** Adds secret management, failure handling, cost monitoring, and prompt
regression risk to an app maintained by a non-developer — for features that don't yet clearly
beat a rules-based approach. Cost when revisited: ~$6–225/mo.

**Revisit only when** a rules-based approach has demonstrably hit its ceiling.

**2026-07-19 (Jeff, answering the item-8 leftover):** the four remaining AI features stay
reachable where they exist for now — no app-wide removal. But he wants a working session to
**"design ways around them"** — i.e. rules-based replacements in the D75/D86 mold (standard
language + editable templates instead of model calls), one feature at a time. A note is filed
to raise this at the next brainstorming session, alongside the Consulting definition.

**Related decisions made 2026-07-19:**
- **Site Intake generation = rules-based for now.** Build deterministic generation off the
  existing structured intake fields instead of D7's LLM scope skeleton. Not yet scoped.
- **Customer portal: the API is NOT the answer.** Jeff's reasoning — it wouldn't give the
  customer what they're looking for. Problem acknowledged as unsolved and explicitly parked
  rather than force-fit to AI.

**Status:** RESOLVED by removal 2026-07-19 (**D89**) — the four remaining AI features and
the whole `src/lib/ai/` layer were deleted per
`docs/superpowers/specs/2026-07-19-ai-removal-design.md`. Supersedes the "revisit when
rules hit their ceiling" posture above; a future return would be a fresh build, not a
re-enable. Recover via git history.

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
  **ANSWERED 2026-07-19 (Jeff): "that is a good list" — the proposed field set is confirmed as-is**
  (title, direct phone, mobile, office assignment, certification/license numbers).
- **B. First-sign-in email correction — which direction?** If a member signs in with a Google
  address that doesn't match their roster row, do we (i) let them confirm/correct their own
  address, or (ii) have an admin fix it in Settings, or (iii) both? Note (i) alone can't work
  standalone: a mismatched user is refused at the door. **A likely first step is simply making
  email editable in the Settings edit modal**, which is small and unblocks everything else.
- **C. Archived vs removed — what's the difference operationally?** Suggested: *archived* = keeps
  history, can't sign in, hidden from pickers; *removed* = same but also hidden from the
  Settings list. Given finding 6, **recommend that neither ever hard-deletes the row.**
  **ANSWERED 2026-07-19 (Jeff): correct as suggested** — archived vs removed works exactly per the
  Settings distinction above; neither ever hard-deletes the row.
- **D. Should the signature phone be the member's direct line** instead of `offices[0].phone`?
  **ANSWERED 2026-07-19 (Jeff): NO — signatures carry the standard office numbers,** not the
  member's direct line. Implementation note: that keeps `offices[].phone` as the source, which
  finding 2 shows is currently unmanaged (the Locations modal never edits it) and always reads
  `offices[0]` regardless of the signer. So the build is: make office phones editable, give each
  member an office assignment (part of A), and resolve the signature phone from the *signer's*
  office rather than `offices[0]`.

**Status:** ALL ANSWERED 2026-07-19 — ready to build. Part 2 was already fixed (`01310aa`, D82:
name/email/google-email editable, wrong-email lockout ended). Remaining build: contact-card
fields (A), archived/removed states replacing the lone `active` boolean (C), and office-number
signature resolution (D). Jeff's framing: store to run later — queued, not started.

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

## 11. Customer pricing tiers → default margin (incl. customer portal) — DONE (D88)

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
  **ANSWERED 2026-07-19 (Jeff): cost plus margin** — the customer price is re-derived from cost
  at the tier margin (fall back to list when a part has no cost).
- **E. Should the customer *see* they're on a tier** (a named discount line), or is it invisible?
  **ANSWERED 2026-07-19 (Jeff): NOT visible to the customer** — the tier only shapes pricing;
  no discount line, no tier name on quotes or in the portal.
- **F. Tier definition.** Fixed enum, or an admin-editable list with per-tier margins? The rules
  registry has `defineGroup`/`addRate` that could host per-tier margins cleanly.
  **ANSWERED 2026-07-19 (Jeff), margins included — seven tiers:** Base 30 · Copper 27 ·
  Silver 22 · Gold 20 · Platinum 15 · Reseller 10 · Employee 5 (percent margin; spelling
  confirmed "Copper", and Reseller added in the follow-up). Admin-editable tier→margin table
  seeded with these.
- **G. Existing customers with no tier** — default to a "Standard" tier at today's 30% so nothing
  reprices silently.
  **ANSWERED 2026-07-19 (Jeff): default is the BASE tier.**

**Suggested phasing:** (1) add `pricingTier` to the customer + an admin-editable tier→margin
table; (2) seed the estimator section margin from it and stamp it on the quote; (3) portal last,
since it carries the client/server coupling risk.

**Status:** DONE 2026-07-19 (**D88**) — shipped across all five margin systems per the
answered A–G. Tier set on People (authoritative) and Companies (fallback); margins
admin-editable in /estimating-rules → Customer tiers; resolved tier stamped on quotes at
creation and per revision; service-quote margin knobs are per-quote now (no more global
blob mutation from a quote builder). Portal prices at the grant customer's tier
(cost ÷ (1 − m), list fallback). See D88 for verification notes + two honest gaps.

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
  **ANSWERED 2026-07-19 (Jeff): dual-write / linked, as recommended** — the inspection stays an
  inspection and gains a linked project.
- **B. What is "signed off" on an inspection?** Projects have a signoff object to copy. Does the
  customer sign, or does the tech? What happens on un-signoff?
  **ANSWERED 2026-07-19 (Jeff): customer sign-off is purely approval of the inspection QUOTE —
  it authorizes doing the inspection.** It is not a completion signature. The inspection's output
  is a **report with a repair estimate tied to it** — an estimate for the repair that solves the
  problem the inspection found (this rides the existing `source: "inspection"` + `refId` link on
  repairs). Implication for the spawn trigger: the linked project comes into being at quote
  approval (when the inspection is authorized), not at inspection completion. Un-signoff wasn't
  addressed — settle that detail at implementation time.
- **C. Does the unified scheduler mean one screen, or the main Gantt reading all four sources?**
  **ANSWERED 2026-07-19 (Jeff): one Gantt for all four sources** — the main Gantt reads projects,
  inspections, repairs, and flame jobs; no separate unified screen.
- **D. What is Consulting? — RESOLVED (D90):** defined in the 2026-07-19 brainstorm and built —
  see `docs/superpowers/specs/2026-07-19-consulting-module-design.md`. Consulting quotes are now
  excluded from the projects/installs sync exactly like flame tests. Original note kept below.
- **D (original note). What is Consulting?** No representation exists at all — needs defining before it can be
  excluded from anything.
  **ANSWERED 2026-07-19 (Jeff): TABLED.** His working definition: consulting is **design work we
  get paid to commit to** — it requires more paperwork and much more review, but ultimately has a
  real path moving forward. He wants to explain it properly before anyone models it. **A note is
  filed to raise it at the next brainstorming session** (with the Consulting IDEA at the bottom of
  this file). Until then item 13 builds without Consulting; only flame tests are excluded from
  the installs window.

**Honest scale note:** this is a data-model change, not a screen change — four schedulers, four
stage vocabularies, four tables, no shared discriminator. **Suggest sequencing: (1) fix the sync
filter bug; (2) carry `quoteType` onto projects as `projectType`; (3) add `projectId` to the three
service records; (4) sign-off → spawn on inspections; (5) scheduler unification last.**

**Status:** ANSWERED 2026-07-19 (A dual-write; B sign-off = quote approval, report carries a
repair estimate; C one Gantt over all four sources; D Consulting tabled → brainstorming note
filed). The phantom-projects sync bug is FIXED (`01310aa`, D82): won repair/inspection quotes no
longer mint Projects. (Any phantoms already in a DB remain — delete from Projects manually.)
Queued to build later per Jeff — follow the sequencing above.

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
  **ANSWERED 2026-07-19 (Jeff): add the `updatedAt`** — so we know when a price list was last
  updated. The age pills come back as real data.
- **B. `SUGGEST`** — retire it in favour of catalog-backed suggestions (e.g. most-used SKUs per
  section type), or curate it properly as a real, validated quick-pick list?
  **ANSWERED 2026-07-19 (Jeff): retire it in favour of the catalog** — catalog-backed suggestions
  replace the hardcoded strip.

**Status:** ANSWERED 2026-07-19 (A add `updatedAt` to catalog parts; B retire `SUGGEST` for
catalog-backed suggestions) — queued to build later per Jeff. Dashboard card already FIXED
(`01310aa`, D82) — derived from the real store (revealed the actual 10,729-part catalog the fake
card hid).

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
  **ANSWERED 2026-07-19 (Jeff): as recommended** — store weeks, resolve from the win date.
- **B. Does the timeframe set `targetDate` only, or the whole triplet?** Today install is
  hardcoded as target−4 → target+2. If "when they need this" means *install complete by*, the
  triplet shifts together; if it means *install begins*, the relationship inverts.
  **ANSWERED 2026-07-19 (Jeff): "when they need it" is the target date for COMPLETION** —
  install complete by. The triplet shifts together off `targetDate`.
- **C. Customer-facing or internal?** A "needed by" line is arguably content for the quote PDF,
  not just internal metadata. Product call.
  **ANSWERED 2026-07-19 (Jeff): internal** — no needed-by line on the quote PDF. **But lead time
  should be listed in the quote's terms & assumptions** section, so the customer sees the lead
  time as a stated assumption rather than a promised date. (Templates/terms wording lives in
  `/templates` — add a lead-time line there as part of this build.)
- **D. Back-fill.** Quotes won before this ships have no timeframe, and `syncProjectsFromQuotes`
  re-runs on every Projects page load — so the 42-day fallback stays hot. Silent default, or
  surface "no timeframe set"?
  **ANSWERED 2026-07-19 (Jeff): keep the silent default rule, and the default is 12 WEEKS
  (84 days) MINIMUM.** (He said "keep the 84 day rule" — note the code's current fallback is
  actually 42 days at `projects.ts:488`; per this answer it moves to 84. "Minimum" means
  scope-based defaults may push it longer, never shorter than 12 weeks.)
- **E. Should a PM be able to edit the date afterward?** Strongly recommend yes, given it feeds
  the billing forecast. That's a net-new write path either way.
  **ANSWERED 2026-07-19 (Jeff): yes, they can.**

**Status:** ALL ANSWERED 2026-07-19 (A weeks-from-win-date; B completion date; C internal +
lead time in terms & assumptions; D silent default at 84 days / 12 weeks minimum; E PM-editable) —
queued to build later per Jeff. The per-scope default *rules* are still to be defined; the
84-day minimum stands until they are.

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
  **ANSWERED 2026-07-19 (Jeff): task-first, as recommended.**
- **B. If email: who receives it?** Everyone, or role-based (PMs, sales, leadership)? Which
  mailbox does it send *from* — the fallback is currently arbitrary.
  **MOOT for now (2026-07-19):** task-first was chosen; email can layer on later once item 9's
  addresses and a send log exist. Revisit B and C then.
- **C. Batch or per-event?** "Batch" suggests a digest (e.g. daily roll-up of sold/completed),
  which is far safer than per-event sends: one scheduled job, one dedupe window, far less
  double-fire exposure. **Recommend a digest over per-event if email happens at all.**
  **MOOT for now (2026-07-19)** — see B.
- **D. "Completed" has two definitions.** A project can reach `complete` via signoff **or** via a
  direct stage change with no signoff. Which one triggers?
  **ANSWERED 2026-07-19 (Jeff): the two definitions collapse into one.** The PM completes a job
  via the direct stage change, **but sign-off is required to complete** — a project must not be
  able to reach `complete` without a signoff. So the build is: gate the direct stage change on a
  signoff existing, and the trigger fires on that (now single) completion path.
- **E. Who is "the PM"?** There is no PM role or field on a project — only `owner` (a name string,
  the estimator). Assigning a follow-up task needs someone to assign *to*.
  **ANSWERED 2026-07-19 (Jeff) — and it's bigger than a PM field: projects need MULTIPLE people
  tied to them, each in a role** — Project Manager, Project Coordinator, Estimator, Lead Sales,
  Installer Lead, Installers, etc. That's a project-roles model (a role-tagged people list on
  the project), which slots naturally into the Daylite-parity junction work (item 20 Phase 2)
  and item 17's assignee-identity decision (use user ids, not name strings). The item-16 tasks
  then assign by role: sold → the project's Project Manager; completed → its Lead Sales.

**Status:** ANSWERED 2026-07-19 (A task-first; B/C moot until email layers on; D sign-off gates
completion, single trigger path; E project-roles model — the new prerequisite). Queued to build
later per Jeff. **Build order note:** E's roles model + item 17's task table are the
prerequisites; do not build the email path before item 9 and a send log.

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

## 18. Opportunities board — Daylite parity — DONE (2026-07-26, plan 02)

**DONE 2026-07-26 (plan 02, D119).** `/opportunities` is a read-time UNION over
leads + quotes (no new record, no migration): columns New / Collect Info /
Estimate / Estimate Sent / Won-Lost / PO Received; a converted lead hands its
card to its quote (which inherits the lead's new `forecastAt`). Header total
("N opportunities • $X open pipeline") sums the four open columns. Cards carry
the age-in-days chip, L/Q source badge, Won/Lost chip and owner avatar.
Filters: owner (`?who=`), created presets (7d/30d/90d), forecast presets
(30d/90d/past — new lead field `forecastAt`, drawer-editable), venue type via
the linked company, keyword exact-tag match (**latent until #23's keyword
authoring lands — the input only renders once a company has keywords**).
Drag policy: leads move among the four open columns only (won/lost keep the
convert / markLost paths); quotes drag only Won-Lost ↔ PO Received when won —
`Quote.poReceivedAt` is a **field**, not a fifth status (`setPoReceived`,
refuses unless won), so the won-spawn machinery is untouched. Every drag is
re-validated server-side (`moveOpportunityAction`). Linked-people-on-cards
still waits on item 20's junction UI.

**Residual minors (logged, beta-fine):** a converted lead with a soft-deleted
quote vanishes from the union (plan-mandated exclusion, not a bug); `?who=` is
not roster-validated (mirrors the quotes screen's existing idiom — an unknown
value shows the "All teammates" label while silently filtering to nobody); an
optimistic drag reverted mid-flight (sub-second window) is ignored and
self-heals on the next refresh; the forecast-date "Save forecast" action
fires even on an identical re-pick (no dirty-check, harmless extra write);
Projects board VMs are computed even when that page renders in list mode
(negligible). Also surfaced during this task's live-drive verification, **not
a plan-02 regression**: `buildOpportunities()`'s lead→quote `forecastAt`
lookup has no collision guard against a duplicate `convertedQuoteId` — a
pre-existing dangling reference in seed data (lead L-1053) collided with a
freshly generated quote id during testing and silently misattributed a
forecast date to the wrong card. Flagged separately as a follow-up
(data-hygiene pass + a defensive fix in `src/lib/opportunities.ts`).

**PRODUCT FLAG for Jeff:** quote cards age from `quote.createdAt`, so an
opportunity's age chip resets to 0 at lead→quote conversion — only
`forecastAt` is inherited, not `createdAt`. If Daylite-style age-since-lead is
wanted instead, inheriting `createdAt` the same way is a 2-line follow-up.

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
**ANSWERED 2026-07-19 (Jeff): stays a passive display state** — "Nothing scheduled" does not
count as a real follow-up need; worklist counts and urgency sort are unchanged. D83's
display-only chip is the final shape.

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

**Status:** DONE (plan 02)

---

## 19. Projects board — Daylite parity — DONE (2026-07-26, plan 02)

**DONE 2026-07-26 (plan 02).** `/projects?view=board` — List | Board toggle
beside the filter pills (decision C: alongside). Installs only (decision A);
orders keep the list — ORDER_STAGES is a different vocabulary. READ-ONLY
columns (decision B: recommended; stage changes keep `setProjectStage` and its
side effects). 7 PROJECT_STAGES columns, cards show name / customer / value /
the extracted due-age chip (`dueChipLabel`, shared with the list rows) / owner
avatar; detail back-link returns to the board. Built on the generalized
`src/components/board/board-view.tsx` (the leads board, now stage-agnostic
with injected `moveAction`).

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

**Status:** DONE (plan 02)

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

## 21. Per-record activity timeline — DONE (customer feed v1, 2026-07-26, plan 04)

**DONE 2026-07-26 (plan 04, D121) — the v1 scope: the CUSTOMER-page merged feed
+ real notes.** A full-width **Activity** card on the company page merges, at
read time (no migration, no new machinery on the sources): quote status
history + the PO-received / portal-acceptance annex stamps, comm messages
(drafts and Deleted-folder threads skipped), site visits (plan-03 lifecycle
labels), flame/repair approved/completed and inspection requested/completed
point stamps (completion via `completedAtOf`; the un-stamped "scheduled"
transitions are skipped — no ms timestamp exists), surveys, project stage
history (D83) and project notes — under Daylite-style buckets (Today /
Yesterday / This week / Last week / This month / "June 2026"; local-time,
Monday-start weeks; pure + spec-covered in `feed-buckets.ts` /
`customer-feed-rows.ts`). **Notes are now a real record**: new non-syncable
`notes` collection (migration 0010), `NoteRecord` with
`parentKind: customer|lead|project|quote` + denormalized `customerId` —
attachable by design; the v1 composer (on the card) writes customer notes
via `addCustomerNoteAction`. Product flags for Jeff: (a) the feed
**duplicates the Communications card** — fold Communications into Activity
later? (b) the feed **caps at 60 rows**, "Show more" deferred. (c)
`LeadActivity` was deliberately NOT migrated (its `logActivity` drives SLA
stamps); lead notes can adopt `NoteRecord` later via `parentKind: "lead"`.
Still open from this item's original ask: per-PROJECT/record timelines,
"All Activity" filter + feed search, attachments (decision D's second half),
and field-level change tracking (decision C — explicitly out of scope).
**Residual minors from the final review (beta-acceptable, not blocking):**
`addCustomerNoteAction`'s `revalidatePath("/", "layout")` is broader than
the single company page it needs to invalidate; the note composer calls
`router.refresh()` redundantly alongside the action's own revalidate and its
inline error banner persists until the next submit instead of clearing on
retry (no try/catch around the transition); the Activity card's row-count
chip shows the capped total with no "+" affordance to signal more rows
exist beyond the 60-row cap.

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

**Status:** DONE (plan 04) — customer feed v1 + real notes shipped; C (field-level tracking) out of scope by decision, attachments still open.

---

## 22. Navigation / module parity with Daylite's sidebar — MINE/ALL SHIPPED (2026-07-26, plan 05); saved views still open

**PARTIAL DONE 2026-07-26 (plan 05, D122) — the spec-§3 slice: Mine/All
scoped views + nav entries.** Leads and Projects gained the quotes `?who=`
idiom (mine | teammate | all; STRICT `owner === name` — unassigned leads
deliberately keep their own segment + claim flow and read 0 under any owner
scope), with every count/tile/board/worklist re-derived over the scoped set
and `who` threaded through all hrefs. The leads **closed segment split into
Won and Lost** (legacy `?seg=closed` deep links fall back to All). Nav
gained **My Quotes / My Leads / My Projects** children (EST/CRM/PM). Known
accepted wrinkles for Jeff: (a) `activeKeyFor` is pathname-only, so a My-X
entry lights its base child, not itself; (b) the nav overlay-close effect
keys on pathname, so clicking My Quotes while on /quotes leaves the dropdown
open (fixing either means useSearchParams in Nav → dynamic layout — declined);
(c) non-quote-derived projects default owner to "Jeff Chesebro"
(DEFAULT_ACTOR) and projects have no owner-editing UI, so "My projects" is
sparse for everyone else — needs an owner field on the project detail.
Still open from this item: per-person saved views (B — deferred by spec),
Learn (folds into Knowledge, wave ④), shared/team calendars (§7), tasks
views (item 17 shipped its own).

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

**Status:** MINE/ALL SHIPPED (plan 05) — A answered by spec §3 (scoped nav entries, in-page filters stay); B per-person saved views deferred; C Learn → Knowledge tab (wave ④); D team calendar wanted (§7). Residual wrinkles logged above.

---

## 23. Customer / company record field parity — DONE (custom fields + lifecycle/keywords UI + added-7d, 2026-07-26, plan 05)

**DONE 2026-07-26 (plan 05, D122).** Custom fields are REAL: admin-defined
typed definitions (text / number / date / dropdown / checkbox, per-venue-type
`appliesTo`, ≤30) live in Settings → Admin → Customer fields
(`AppSettingsData.customerFieldDefs`, full-replacement save, server-validated);
values live in a new `companies.custom` jsonb column (migration 0011) and are
authored in the company edit modal's new **Details** section — which also
finally surfaces the D85-stored **lifecycle** (Prospect/Customer/Past) and
**keywords** (chip editor). The customer page shows a lifecycle pill +
keyword chips in the header and a compact Details card of populated custom
fields. Keywords authoring makes the opportunity board's keyword filter
(item 18) live. The Companies list gained the **"New (7d)"** added-last-7-days
toggle (`?added=7d`). Caveat: legacy rows show as new for a week after any
reseed or the prod bootstrap — their `createdAt` is the D85 conversion time,
not the true creation date (every row has one; no way to backfill the real
dates).
Store semantics: lifecycle/keywords/custom are write-when-provided /
preserve-when-undefined, so the lead converter, CSV importer and seed remain
byte-identical writers (D122). Pre-existing residual (predates plan 05, not
touched): untouched modal re-saves of an OWNED company still bump Modified —
composeDoc includes `owner` in the doc (so in contentKey) but
saveCustomerAction never sends it, and empty-named sites compose
`label: undefined` while the action coerces `"Venue"` — so the D83
early-return only holds for ownerless records; a future contentKey
canonicalization pass could close it. Remaining from the original ask: **F —
referred-by as a linked person** (a custom text field holds it today; a real
contact link waits on Phase-2 junctions), per-record permissions (never
requested since), and the PO-box address line.

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

**Status:** DONE (plan 05) — custom fields + lifecycle/keywords UI + added-7d shipped; F (referred-by as a person link), per-record permissions and the PO-box line remain open.

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

## 25. Rename the "Engagements" nav item to "Consulting" — DONE (2026-07-26, plan 06)

**Area:** `src/components/nav/nav-data.ts:28` (the nav label — the actual ask). Other
user-facing "Engagements" strings if the rename should be consistent: page titles
`src/app/(app)/design/engagements/page.tsx:6` + `.../[id]/page.tsx:7`; breadcrumbs
`.../spec/page.tsx:32`, `.../spec/[id]/page.tsx:25`, `.../markup/page.tsx:33`,
`.../letter/page.tsx:106`; and the Design Overview card `src/app/(app)/design/page.tsx`.

**Reported:** 2026-07-21 (screenshot of the Design submenu)

**Ask:** In the Design group's nav, switch the **"Engagements"** item to read **"Consulting."**

**Light recon 2026-07-21 — small, and "Consulting" matches the data:**

- **The nav label is one line.** `nav-data.ts:28` is
  `{ key: "engagements", label: "Engagements", href: "/design/engagements" }`. Changing
  `label` → `"Consulting"` is the entire visible-nav change. `key` and `href` do **not**
  need to change (they're internal).
- **This is a rename back to what the domain already calls it.** Per the nav comment
  (`nav-data.ts:17-21`), D97 merged the old standalone **Consulting** link into the Design
  group and named the child "Engagements." The records behind it are `ConsultingEngagement`
  (`src/lib/stores/engagements.ts`), statuses are `ENGAGEMENT_STATUS_LABEL` — so "Consulting"
  is the more accurate label, not a new concept.
- **No collision.** The old `/consulting` route still exists but is now only a legacy
  redirect to `/design/engagements` (`src/app/(app)/consulting/page.tsx` — "Kept for
  bookmarks and deep links," D97). Relabeling to "Consulting" won't clash with a live page.
- **"Engagements" shows up in a handful of other user-facing spots** (listed under Area).
  A label-only change leaves those still saying "Engagements" — page title in the browser
  tab, "← Back to Engagements" breadcrumbs, and the Overview card heading.

**ANSWERED 2026-07-21 (Jeff): "just the name change."** No route/URL rename — keep
`/design/engagements` (B). Treat as a plain relabel. Build-time default: swap every visible
"Engagements" string for consistency (nav label + page titles + breadcrumbs + Overview card —
all display text, still trivial) unless Jeff narrows it to the nav label only.

**Status:** OPEN — queued, **not building yet.** Jeff is keeping a running list and will batch
these. Logged 2026-07-21, no code touched.

**CLOSED 2026-07-26 (plan 06).** The nav label itself had already read "Consulting"
since the D117 Q-6 rebrand (`nav-data.ts:71`); this plan swept the remaining
user-facing module-name strings — the Consulting list header/sub, KPI tiles,
roll-up title, "← All consulting" breadcrumb, builder banner copy, and the venue
history row subtitle. Prose naming the RECORD keeps "engagement" (paperwork card,
roles, error messages) per the spec's judgment note. URLs, nav keys, and the
`consulting_engagements` collection unchanged.

---

## 26. Fixture cross-reference in the app — OPEN

**Area:** new screen, home TBD — under Design or the proposed Knowledge tab (item 27). Closest
existing analog: `src/app/(app)/design/motors/page.tsx` (Motor Library — a curated ETC-reference
page). **Source data is not in the app repo** — it lives in Peak Knowledge memory
(`memory/knowledge/peak/*-cross-reference-2026-07.md` + the 7 `.xlsx` originals; project
`fixture-cross-reference`).

**Reported:** 2026-07-21

**Ask:** Surface the fixture cross-reference inside the app. Jeff first said "on the Design tab,"
then broadened to wanting a dedicated Knowledge tab for it (item 27).

**Light recon 2026-07-21 — the data already exists, curated:**

- **What it is:** 7 ETC-anchored competitive matrices — a **sales tool** mapping ETC/Eos products to
  competitor equivalents (Chauvet Pro, Elation, Vari-Lite/Strand, Altman, ADJ): LED Ellipsoidal (34
  fixtures), Console (44), LED PAR (34), LED Cyc, LED Fresnel (24), Spot Mover, Wash Mover — ~5–6
  brands each. Each workbook has **Read Me / Spec Matrix / Equivalents (class map A–E) / Sources**
  tabs, incl. street pricing ("verify before bidding"). Memory status: **all 7 built, awaiting
  Jeff's review.**
- **Internal-only.** This is competitive intelligence — do **not** expose it in the customer portal.
- **Motor Library is the build pattern.** `design/motors/page.tsx` is a hardcoded curated-reference
  page (ETC Prodigy hoist specs, card + table layout) under Design. The fixture matrices are the same
  *kind* of thing, just bigger and multi-category.
- **Getting the data in is the real work.** It's 7 spreadsheets in the Dropbox memory tree, not the
  repo — porting/parsing them is the bulk of the effort, not the screen.

**Open questions (Jeff's call):**
- **A. Home** — under Design (sibling of Motor Library) or in the new Knowledge tab (item 27)? Jeff
  is leaning Knowledge.
- **B. Static vs data-backed** — hardcode the tables like Motor Library (fast, but 7 big matrices are
  painful to update), or import the xlsx into a store/table (like the parts catalog) so it's
  searchable and Jeff can refresh pricing/brands? The matrices are explicitly expected to change
  (pricing refresh, add brands) — that argues data-backed.
- **C. Presentation** — one screen with the 7 categories as tabs/sections, or a page per category?
  Each matrix is 24–44 rows, so in-screen search/filter is likely wanted.
- **D. Start small or all 7** — ship one category first (Ellipsoidals are the flagship) or all seven?
  Pricing columns included, or equivalence-only to start?

**Status:** OPEN — logged 2026-07-21, no code touched. Home depends on item 27.

---

## 27. A dedicated "Knowledge" tab, OPEN (SUPERSEDED IN SCOPE BY #56)

> **2026-07-27:** re-scoped by Jeff into **#56**, Knowledge becomes the home for COMPANY
> settings (design doctrine, estimating rules, customer tiers) rather than just a reference
> screen. Answer this item's A, D questions there; don't build #27 standalone.

**Area:** `src/components/nav/nav-data.ts` (a new top-level group, or a Design child). Existing
in-app content of this kind: `src/app/(app)/design/motors/page.tsx` (Motor Library).

**Reported:** 2026-07-21

**Ask:** "A separate tab that just has useful information in it — basically a knowledge tab." A home
in the app for reference material, starting with the fixture cross-reference (item 26).

**Light recon 2026-07-21:**

- **Peak already has the reference-page pattern.** Motor Library (curated ETC hoist specs) is exactly
  "useful information" — it just lives as a Design child today. A Knowledge tab is the natural home
  for that class of content, and Motor Library is a candidate to move (or link) there.
- **There's a deep well of curated Peak reference material** already written up in Peak Knowledge
  memory that could feed this tab over time: the fixture cross-references (item 26), hoist/motor
  specs, the Design Doctrine (venue-class lighting/rigging standards), school reference sheets. None
  of it is in the app yet — it's all in the Dropbox memory tree.
- **It's a nav change.** A new top-level group sits alongside Design / Sales / Operations (see the
  D97 nav notes in `nav-data.ts`). A Design child is the lighter-weight alternative.

**Open questions (Jeff's call):**
- **A. Placement** — a new **top-level** nav group (his "separate tab" wording suggests this) or a
  child under Design?
- **B. Contents / vision** — beyond the fixture cross-reference, what does Jeff picture living here?
  Move Motor Library in? Add the Design Doctrine, school reference sheets, other spec docs? This
  shapes whether it's one page or a mini-section.
- **C. Static vs living** — curated static pages (Motor Library style), or a knowledge store Jeff can
  add to / edit in-app without a code change?
- **D. Audience** — internal-only, staff-wide, or is any of it customer-facing? (The fixture
  cross-reference itself is internal competitive intel.)

**Status:** OPEN — logged 2026-07-21, no code touched. Item 26 is its first intended resident.

---

## 28. Lineset Builder: default the layout to 50′ × 30′ (was 80′ × 30′), SHIPPED, STATUS STALE

> **2026-07-27 recon:** the code is DONE, `DEFAULT_LINESET_INPUTS` is 50×30
> (`src/lib/design/lineset.ts:52-72`, header note at `:5`) and the reset button reads
> "Reset layout to 50′ × 30′ defaults" (`lineset-builder.tsx:500-502`). The status line below
> was never updated. Close this out with **#50** (the lineset rework).

**Area:** `src/lib/design/lineset.ts:48` (`DEFAULT_LINESET_INPUTS.stageWidthFt`) + the reset-button
label `src/app/(app)/design/lineset/lineset-builder.tsx:367`.

**Reported:** 2026-07-21

**Ask:** Make the Lineset Builder default to **50′ wide × 30′ deep** instead of 80′ × 30′.

**Light recon 2026-07-21 — trivial, two edit points:**
- `DEFAULT_LINESET_INPUTS` is `stageWidthFt: 80, stageDepthFt: 30, …` (`lineset.ts:47-48`). Only the
  width changes: **80 → 50.** Depth is already 30.
- The reset button hardcodes the label **"Reset layout to 80′ × 30′ defaults"** (`:367`) and calls
  `setInp(DEFAULT_LINESET_INPUTS)` (`:366`). Update the label to "50′ × 30′" so it matches.
- No decision needed; no downstream math cares (auto-layout reads the live inputs, not the constant).

**Status:** OPEN — logged 2026-07-21, no code touched. Same request as item 29.

---

## 29. Lineset Builder: auto-fill line weights from venue dimensions + a shared curtain model — OPEN

**Area:** `src/lib/design/steel.ts` (`computeSetWeight`, the `FABRICS` table, `ozPerFt2`),
`src/lib/design/lineset.ts` (`LinesetInputs`), the estimator's curtain rules
(`src/app/(app)/estimator/pricing.ts` `computeCurtain`, `src/lib/curtain-geom.ts` `curtainAreas`,
`src/lib/curtain-pricing.ts`), catalog fabrics `src/db/seeds/catalog.ts`, and the two UIs
(`lineset/lineset-builder.tsx`, `estimator/curtain-modal.tsx`).

**Reported:** 2026-07-21

**Ask:** Pull in "the same information and rules we set for curtains from the design estimator tool"
so the venue **width / height / depth** help auto-fill the lineset weights — instead of hand-keying
every line (the screenshot shows all 16 lines with `—` weights, "click a row to enter them").

**Light recon 2026-07-21 — this flips the framing; read before building:**

- **The Lineset Builder ALREADY turns dimensions into weight.** `computeSetWeight` (`steel.ts:476`)
  does `flatW = w × (1+fullness)`, `cutH = h + cut`, `goods = flatW × cutH × ozPerFt2(fabric) ÷ 16`,
  plus chain weight and hardware/ft. It has its **own structured fabric table** (`steel.ts:365-376`:
  velours in oz/linear-yд @ 54″, muslin/scrim in oz/sq-yд) with a real areal-weight conversion. This
  is the more complete weight model of the two.
- **The estimator's curtain rules do NOT compute weight.** `curtainAreas`/`computeCurtain` produce
  **area + cost only**; their fabrics are the catalog seeds where the oz is just text in the
  description ("25 oz Memorable Velour") and only `costPerSqft` is structured. So "pull the weight
  rules from the estimator" isn't the shape of it — the estimator has no weight rules to pull.
- **The real gap is that curtains are modeled TWICE and never linked.** Two fabric lists (steel.ts
  `FABRICS` carrying oz vs catalog fabrics carrying cost — same fabrics, e.g. "Memorable Velour 25
  oz" ≈ "25 oz Memorable Velour", stored separately), and two spec shapes (`WeightLine` w/h/full/fab
  vs `CurtainDraft`). A curtain configured in the estimator has **no path** to a lineset weight, and
  every lineset line's fabric + dimensions are typed by hand.
- **There is no venue HEIGHT input.** `LinesetInputs` (and the screenshot) have only Width + Depth.
  Curtain vertical drop (leg/border height) can't come from depth — it needs a proscenium/trim height
  the builder doesn't capture today.

**What would actually deliver the intent (Jeff's call):**
- **A. Auto-fill source** — derive default soft-goods sizes from the venue envelope (borders ≈ width
  + overlap, legs/travelers ≈ proscenium height, full-stage ≈ W × H), OR pull the curtains already
  spec'd in the estimator/quote for that venue, OR both?
- **B. Unify the fabric list** — one fabric record carrying **both** `costPerSqft` (estimator) and
  areal `oz` (lineset), so picking a fabric anywhere yields both price and weight. Requires
  reconciling the two name sets and the two `oz`-vs-text representations.
- **C. Add a venue height / trim input** — needed to size vertical drop. Where does it come from
  (proscenium height field? per-line as today?).
- **D. Direction of truth** — does the estimator quote drive the lineset, does the lineset feed the
  estimator, or does a single shared curtain spec feed both cost and weight?
- **E. Keep overrides** — auto-filled weights must stay per-line editable; the builder already has
  per-line overrides + orphan/reattach handling (item 6), so preserve that.

**Status:** OPEN — logged 2026-07-21, no code touched. **Bigger than "copy the estimator's rules"** —
the weight rules already live in the lineset; the work is unifying the two curtain/fabric models and
auto-sizing from the venue envelope. Same request as item 28.

---

## 30. Site survey: quick-measure + Bluetooth laser sync — OPEN

**Area:** the Field Survey measure system — `src/lib/stores/surveys.ts:213` (`measureFields`) +
`:289` (`MEASURE_GROUPS`, `MeasureField`), the on-site client editor
`src/app/(app)/field-survey/[id]/controls.tsx` + `page.tsx`. No Bluetooth code exists anywhere in
the app today.

**Reported:** 2026-07-21

**Ask:** Add a "quick measure" to the site (field) survey. Jeff's ideal: a **Bluetooth laser** that
syncs to the app so a surveyor just points, then the reading drops into a field (type-in or select).

**Light recon 2026-07-21 — the target already exists; the laser is the new part:**

- **The survey already has a structured quick-measurement system.** `measureFields(venueType)` returns
  a venue-type-driven set of named measurement fields, grouped by `MEASURE_GROUPS`; the client editor
  already does "measurement entry, condition tags, photo capture" and the field set swaps as
  `venueType` changes. So a laser reading has a home — it fills the focused `MeasureField`. **No new
  data model is needed for the measurements themselves.**
- **The survey is already an offline-first client editor** (service worker + `SyncProvider`,
  `syncState` pending/syncing) — the right shape for a field tool, and it already runs in the browser
  on-site.
- **Feasibility (the real question) — possible, but platform-gated.** A web app talks to a BLE device
  via the **Web Bluetooth API**, which works in **Android Chrome and desktop Chrome/Edge** but is
  **NOT supported in Safari (iOS/iPadOS) or Firefox** (Apple declined to implement it — and every iOS
  browser is WebKit underneath, so iOS Chrome can't either). So whether the *current web app* can do
  point-and-sync depends entirely on the field device:
  - **Android phone/tablet or a laptop:** doable directly in the existing web app, no native app.
  - **iPhone/iPad:** the web app can't use Bluetooth as-is — needs a WebBLE browser (e.g. Bluefy) or
    wrapping Peak in a native shell (Capacitor + a BLE plugin) / a small companion app.
- **Hardware matters.** Leica DISTO is the most integration-friendly (official iOS/Android SDK + a
  documented/reverse-engineered BLE profile; open-source Web-Bluetooth examples exist). Bosch GLM
  (Blaze) pairs with its own app; direct third-party sync is more DIY.
- **Always-works fallback:** the manual quick-measure UI (big numeric entry, unit toggle,
  point→confirm→fill, running list) is platform-agnostic and is the *same* UI a laser would populate.
  Build that first; the laser is an enhancement layered on where the platform allows BLE.

**Open questions (Jeff's call):**
- **A. Field device** — what do surveyors carry, iPhone/iPad or Android/laptop? This decides whether a
  pure-web BLE path even exists. **Most important.**
- **B. Which laser** — Leica DISTO (easiest) vs Bosch vs other? Drives integration effort.
- **C. Scope** — ship the manual quick-measure UI first (works everywhere), laser as phase 2?
- **D. Native shell** — if iOS is required for live sync, is Peak willing to wrap the app (Capacitor)
  or build a companion app? Bigger architectural step.

**Status:** OPEN — logged 2026-07-21, no code touched. Feasible; the laser half is gated on device
platform (Web Bluetooth ≠ iOS Safari). Manual quick-measure is unblocked and platform-agnostic.

---

## 31. Native app feasibility — "make it a real app someday" (strategic note, not a change) — OPEN

**Reported:** 2026-07-21 (Jeff's question, prompted by item 30's iOS-Bluetooth gap)

**Question:** Can Peak become an actual (store-installable, native) app rather than just a web app —
or is that prohibitively expensive/complicated?

**Answer — feasible, and NOT prohibitive, because the app is already a PWA:**

- **Current state (verified 2026-07-21):** Next.js 16 / React 19, deployed on Vercel, with a web
  manifest (`public/manifest.webmanifest`, linked at `src/app/layout.tsx:22`), a service worker
  (`public/sw.js`), an app icon, and an existing **offline sync engine** (`src/lib/sync/`). This is
  ~80% of "an app" already. No Capacitor/Expo/React-Native present yet.

- **The three realistic paths, cheap → expensive:**
  1. **Installable PWA (≈ free, basically already here).** "Add to Home Screen" gives an icon +
     full-screen, no browser chrome. Gap: iOS PWAs still can't do Bluetooth, limited push, no store
     listing. Worth confirming the manifest is clean and promoting install.
  2. **Capacitor native shell (the pragmatic "real app").** Wraps the *existing* codebase in an
     iOS/Android binary → App Store + Play Store presence **and native plugin access: Bluetooth
     (solves item 30 on iOS), camera, push, GPS.** Reuses ~all the web code. Moderate effort (weeks,
     not months). Costs: Apple Developer **$99/yr**, Google Play **$25 one-time**, a Mac for iOS
     builds, some setup/maintenance eng. **Recommended path when the time comes.**
  3. **Full native rewrite (React Native / Swift-Kotlin).** Months, a parallel codebase to maintain
     forever. Overkill for a business/field CRM. **The "prohibitively expensive" path — avoid.**

- **The one real complication:** Next.js runs on a server (server components/actions on Vercel);
  Capacitor prefers static assets. Standard pattern = the shell loads the hosted app URL and the
  existing offline sync engine covers field use. Navigable, and it's the main design question if we go
  Capacitor.
- **Ties to item 30:** the Bluetooth laser is the single most compelling reason to go native (it's the
  thing iOS Safari can't do). Building genuine native features also clears Apple's "not just a
  website" review bar (guideline 4.2).

**Status:** OPEN — strategic note, no code, no decision required now. **Recommendation: stay a clean
installable PWA today; go Capacitor when a native capability (Bluetooth laser, camera, push) justifies
it — likely alongside item 30.** Not a full rewrite.

---

## 32. Adding a venue: address search doesn't autofill the street on select — OPEN (bug)

**Area:** `src/app/(app)/companies/edit-modal.tsx:209-212` (`pickAddress`) +
`src/app/(app)/companies/actions.ts:69-80` (`searchAddressAction` → `AddressHitVM`). The address
parsing itself is fine in `src/lib/geo.ts:314-341` (`normalizeHit` builds `street = house_number +
road`).

**Reported:** 2026-07-21

**Ask:** When adding a venue, the address search works great, but selecting a hit doesn't autofill the
exact street.

**Root cause — confirmed 2026-07-21:**
- Venues are locations on a company; the address picker is the company edit modal's **per-location**
  search (`pickAddress(i, h)`). On select it runs `setLoc(i, { city, state, lat, lng })` — it
  **never sets the location's `address`/street field.** City, state and coords fill in; the street
  line stays as whatever was typed.
- Compounding: `searchAddressAction` (`companies/actions.ts`) maps the geo hit to `AddressHitVM` as
  `{title, sub, city, state, lat, lng}` — it **drops `street` entirely**, even though `geo.ts`
  already parses a clean `street` onto `GeoSearchHit`. So the street never even reaches the modal.
- Why offices work but venues don't: the Settings/office picker *does* set street
  (`settings-client.tsx:335` — `street: r.street || r.title`). The company/venue modal is the one
  that omits it.

**The fix (small, two edits):**
1. `companies/actions.ts` — add `street` to `AddressHitVM` and include `street: h.street` in the map.
2. `companies/edit-modal.tsx` `pickAddress` — set it: `setLoc(i, { address: h.street, city, state,
   lat, lng })`.

**Open question:** POI/venue hits with no house number yield a road-only or empty `street` (an OSM
data gap). Acceptable (city/state/coords still fill), or add a fallback to the road / display name?
Minor — the primary defect is that street is dropped entirely.

**Status:** OPEN — logged 2026-07-21, no code touched. Small and well-isolated; ready to fix on your
go.

---

## 33. Mobile readability + per-device progressive disclosure — OPEN (program, not a one-screen fix)

**Area:** app-wide. Foundations: `src/app/globals.css` (680 lines — the place for a shared type
scale + breakpoints), `src/components/nav/Nav.tsx` (already has the hamburger/drawer pattern). The
per-screen `<style>`/`@media` blocks and inline styles across ~20+ screens.

**Reported:** 2026-07-21

**Ask:** A lot of views and titles are clunky and hard to read on iPhone. Direction Jeff floated:
**limit what's shown per device — less on mobile, more on tablet, full on computer** (progressive
disclosure by breakpoint).

**Light recon 2026-07-21 — responsive exists, but it's inconsistent and has no backbone:**

- **No shared breakpoint system.** Viewport detection is hand-rolled per screen at **three different
  thresholds**: `700px` (estimator, `estimator-client.tsx:311`), `860px` (nav → hamburger,
  `Nav.tsx:103`), `960px` (inbox, `inbox-shell.tsx:85`). "Mobile vs tablet vs desktop" is defined
  nowhere and differently everywhere.
- **Responsive CSS is scattered.** ~41 `@media` blocks across ~20 files (`page.tsx`, `quotes`,
  `leads`, `catalog`, `projects`, …), each screen solving it locally. No shared responsive utilities.
- **Inline styles dominate**, and inline styles **can't hold media queries** — so today responsive
  behaviour needs either a JS viewport hook (the 3 ad-hoc ones), a per-screen `<style>` block, or
  `globals.css`. This is the architectural constraint on any mobile pass.
- **Titles are fixed px**, so they don't scale down gracefully — the direct cause of "titles hard to
  read." Dense tables (e.g. the lineset schedule, quotes/leads grids) don't reflow on a phone.
- **The app shell is already responsive** (nav hamburger/drawer ≤860px) — a pattern to build on, not
  replace.

**Recommended shape (Jeff's call on scope/priorities):**
- **A. One shared breakpoint system** — replace the 700/860/960 sprawl with a single mobile/tablet/
  desktop definition (a `useBreakpoint()` hook + matching CSS breakpoints). **Foundational** —
  everything else builds on it.
- **B. A responsive type scale in `globals.css`** — fluid title/heading sizes (`clamp()`) so titles
  stop being fixed px. Cheap, high-impact, directly targets "hard to read."
- **C. Progressive disclosure per tier** (Jeff's idea) — decide what collapses/hides on mobile:
  dense tables → stacked cards, secondary columns hidden, fewer KPIs. This is per-view design work
  and needs Jeff's priorities — *which* views hurt most.
- **D. A responsive pattern that fits inline styles** — standardize on the `useBreakpoint()` hook +
  a small set of `globals.css` utilities, and CSS-ify the worst offenders, rather than more one-off
  `<style>` blocks.
- **E. Sequence as a program** — global foundation (A+B) first, then triage the worst screens
  (C) in priority order. **Will likely spawn per-screen sub-items** once targets are named.

**Ties in:** doubly worth it if Peak goes native for field use (Capacitor spec + items 30/31) — the
field survey on a phone is exactly where readability matters most.

**Status:** OPEN — logged 2026-07-21, no code touched. Program-level; needs Jeff's target list. **I
can turn this from vague to concrete by running the app at iPhone width and cataloguing the worst
views + titles as named sub-items — say the word.**

---

## 34. Leads → site visit → survey → estimate: wire the pipeline + a request/claim flow — DONE (2026-07-26, plan 03)

**DONE 2026-07-26 (plan 03, D120).** The thread is wired. `SiteVisit` gained the
lifecycle `requested / open / claimed / scheduled / done` + `leadId` /
`surveyId` / `preferredTiming` (decision A: extended, not a second model),
normalized on read (`deriveVisitStage` — legacy docs and past "scheduled"
records read correctly; no migration). The lead drawer's **Request site
visit** view (decision E) captures reason (default "Site survey / measure"),
preferred timing, and assign-or-open; it dedupes to one active visit per lead
and **auto-creates the linked Survey at stage `requested`** (decision C),
which rides the existing Field badge/bell. The claim flow reuses the LEAD
claim model (decision B): claim/release/schedule server actions, a "Visit
requests" section on `/field-survey` (Claim for everyone; inline scheduler +
Release for the claimer), a `site-visit` My Queue source (due = requested +
3d), and a "Site visit requests" bell group (new notif-prefs category, no nav
badge). Scheduling dispatches the D77 invite/calendar machinery via
`dispatchVisitInvite`, extracted behavior-preserving from the inbox path
(which is unchanged and still lands "scheduled"). Convert is **gated
server-side** (decision D) in `convertLeadAction` via `canConvertLead`: no
completed linked survey ⇒ `{ ok:false, reason }` unless explicitly skipped,
and skips are logged on the lead ("Converted without completed survey — …").
Lead stage itself was NOT changed by visit progress (the thread chips surface
status instead) — flag for Jeff if he wants stage coupling later. A
final-review fix wave (commit `4439458`) closed three residual gaps found in
re-review: `markLostAction` now also closes any still-open pool visit on the
lead and, if the visit's auto-created survey is still sitting untouched at
stage `requested`, soft-deletes it too (so a dead lead's survey stops
nagging the "Survey requests to schedule" bell); `convertLeadAction`
backfills the resolved `customerId` onto the lead's pre-conversion visits/
surveys so they join the customer's own history; and the lead drawer's
completed-survey chip now survives visit completion (it no longer disappears
just because `activeVisitForLead` drops the now-"done" visit), with the
"No site visit was requested." fallback text correctly gated on `!thread.survey`
too so a converted lead with a surviving survey chip doesn't show
contradictory text underneath it.

**Known limitations (deferred, logged not fixed):** scheduled visits have no
cancel/reschedule flow yet — `markLostAction` only closes still-open **pool**
visits (`requested`/`open`/`claimed`); a visit that's already `scheduled` when
its lead goes lost is left alone, matching `closeVisit`'s own docstring ("
scheduled visits are left alone — they belong to a future cancel/reschedule
flow, not this closeout"). The visit chip in the lead drawer links to the bare
`/field-survey` list (no per-record visit route exists yet), unlike the
survey chip which deep-links to `?id=`. Three seams were consciously logged
rather than fixed (see D120): an outbox/sync race could in principle clobber
the convert-time `customerId` backfill (the same last-write-wins idiom used
app-wide, not specific to this feature); `requestVisitForLead`'s one-active-
visit-per-lead dedupe is check-then-create, not atomic (the doc-store's
existing idiom, same class of race as any other doc-store uniqueness check);
and the field-survey scheduler's `doSchedule` doesn't surface it to the user
when `dispatchVisitInvite` returns `inviteStatus: "failed"` — the visit still
schedules (by design — a good schedule shouldn't get stuck on a bad invite),
but the user isn't told the invite itself failed, which is a follow-up UX
gap, not a data-integrity one.

**Area:** `src/app/(app)/leads/actions.ts` (lead actions), `src/lib/stores/site-visits.ts`
(`SiteVisit`), `src/app/(app)/inbox/site-visit-actions.ts` + `site-visit-modal.tsx` (current
create path), `src/lib/stores/surveys.ts` (`SurveyStage`), `src/app/(app)/field-survey/actions.ts`
(`createSurvey`, `quoteFromSurvey`). Reusable claim pattern: `leads/actions.ts:claimLeadAction`,
`design/designs/actions.ts:claimDesignReview` ("Claim review").

**Reported:** 2026-07-21

**Ask:** A **"Site visit requested" button on Leads** to send someone out; site visits ultimately
lead to site surveys → estimates/designs. Schedule the visit and **assign to a person, or leave it
open for others to pick up.** And refine the whole process so it's **quicker and information flows the
right direction.**

**Light recon 2026-07-21 — the pieces mostly exist but the chain isn't connected:**

- **Site visits already exist** (`SiteVisit`, D76/#2) with `assignedTo`, `customerId`, `locationId`,
  `engagementId`, a reason picklist that already includes **"Site survey / measure"**, and .ics
  invites — **but they're born in the Inbox only, have no `leadId`, and have no open/claimable
  status** (just an assignee name). There's no place open visits surface for pickup (they show on the
  company page + home calendar).
- **Leads already have the right verbs** — `assign`, **`claim`** (`claimLeadAction`), stage, convert —
  **but no "request site visit" action.** `convertLeadAction` jumps straight lead → customer + draft
  quote, **bypassing the visit/survey middle entirely.**
- **The "assign or leave open to claim" model already exists** — leads claim, and design reviews have
  the full pattern (unassigned → "Claim review" from an open pool), plus the portal's "unassigned →
  SLA response queue." **Reuse it for site visits;** don't invent it.
- **Surveys have a real lifecycle** — `SurveyStage = requested | scheduled | onsite | completed` — and
  **survey → estimate already works** (`quoteFromSurvey`). **But `createSurvey()` makes a blank
  standalone survey** (no `leadId`, no `siteVisitId`), so a survey isn't tied to the lead or the visit
  that prompted it.
- **Net:** the intended flow (intake copy even says "we schedule a site visit to measure and scope")
  is **three disconnected hops**: lead→visit (missing), visit→survey (missing — even though a visit
  reason can be "Site survey / measure"), survey→estimate (exists). "Information flowing the right
  direction" = threading `leadId` through visit → survey → quote and surfacing status back on the lead.

**Decisions Jeff needs to make (this is a design item, not a single button):**
- **A. One model or two** — is "site visit requested" the existing `SiteVisit` extended with a
  **status lifecycle (requested/open/claimed/scheduled/done) + `leadId`**, or a separate request
  object? *Recommend: extend `SiteVisit`.*
- **B. Open pool + where it lives** — reuse the claim pattern so a request can be assigned or left
  open; **needs a site-visits queue/board** for pickup (none today).
- **C. Auto-seed the survey** — does requesting a visit create the linked `Survey` at stage
  `requested` (the stages already line up), or does the surveyor create it on-site?
- **D. Lead stage integration** — should the lead's stage reflect visit requested/scheduled/done, and
  should **convert be gated on the survey** instead of bypassing it?
- **E. The button** — where on the lead, and what it captures (default reason "Site survey / measure",
  preferred timing, assign-or-open).

**Ties in:** overlaps item **2** (site visits from Inbox — extend, don't duplicate), item **30**
(survey quick-measure/laser is the on-site tool this feeds), and the **Daylite-parity design** (items
18–23: opportunities pipeline + per-record activity timeline — the same CRM flow). **Strong candidate
for a brainstorm + design spec** (like the Daylite parity work), given it spans four stores and
changes the lead lifecycle.

**Status:** DONE (plan 03).

---

## 35. Consulting proposal builder — structured scopes, checked assumptions, auto lead+estimate, architect + venue links — DONE (2026-07-26, plan 06; letter remap awaits Jeff's real letter)

**Area:** `src/app/(app)/design/engagements/quote/controls.tsx` + `quote/actions.ts` (the consulting
quote form), `src/app/(app)/design/engagements/letter/page.tsx` (`kind=proposal` generator),
`consulting_proposal` template in `/templates`, `src/lib/stores/engagements.ts`
(`ConsultingQuotePayload`, `ConsultingEngagement`). Checklist pattern to reuse: inspections
`blankRubric()` (per item 17). Architect modeling ties to **item 20** (people/companies + roles).

**Reported:** 2026-07-21

**Ask:** Use **Peak's consulting letter** as the guide to create consulting proposals. Add a **form**
to assist in creating that document. The form needs **scopes**, then **assumptions that are checked**.
Creation should **log an estimate and a lead**, and **link back to both the architect and the
venue/company.**

**Light recon 2026-07-21 — D90 built the skeleton; this is the structured layer + the CRM wiring:**

- **Already exists:** a consulting **proposal + professional-services agreement** generator
  (`letter?id=<quoteId>&kind=proposal`, wording in `/templates` → `consulting_proposal`) and a
  consulting **quote form** capturing customer, location/venue, contact, fees/phases. The consulting
  quote **is the estimate** (`source: "consulting"`, flows through the Quotes hub, review gate,
  revisions, letters). **Venue/company linking already works** (`companyId` + `siteIds`).
- **Scope is one free-text field** (`scope`) — Jeff wants **structured scopes** (line items). The
  **spec side already has scope lines with an optional flag** (`engagements/spec/actions.ts:39`,
  "Optional-scope lines are not part of the base bid") — a model to reuse.
- **Assumptions are one free-text blob** (the "Terms & assumptions" textarea → `terms`) — Jeff wants
  **checkable assumptions** (tick the standard ones that apply). No structured assumptions today;
  `blankRubric()` (inspections) is the template-expansion + checklist pattern to copy, and they could
  be Settings-editable like the visit-reason picklist.
- **No lead is created.** `persist()` in `quote/actions.ts` creates the quote only — **it never logs a
  lead.** Jeff wants creation to log a lead too (pipeline entry). Ties to item **34** ("information
  flowing the right direction").
- **No architect model.** Every "architect" hit in the code is incidental ("architectural controls",
  doc comments) — there is **no architect party/role.** Linking a proposal to an architect is net-new
  and is squarely **item 20 territory** (a person/company carrying an "architect" role on the
  engagement).
- **The actual Peak consulting letter is NOT in memory** (checked Peak Knowledge). **Dependency: Jeff
  must supply the real letter** (docx/PDF) as the format guide; the current `consulting_proposal`
  template is generic boilerplate, not Peak's letter.

**Decisions Jeff needs to make (design item, not a single form):**
- **A. Scopes** — structured scope line items; reuse the spec's `{scope line, optional?}` shape? What
  fields (title, description, included/optional)?
- **B. Assumptions** — a checklist of standard assumptions (checked), Settings-editable; what's the
  default set (from Peak's letter)?
- **C. The document** — **provide Peak's consulting letter**, then map form → `consulting_proposal`
  template so the output matches it.
- **D. Auto-log a lead** — what stage/owner; dedupe against an existing lead for that company?
- **E. Architect link** — build a minimal architect link now, or wait for item 20's people model
  (which Jeff took himself)? An architect is a role-linked party.

**Ties in:** item **20** (people/companies + roles → the architect party), item **34** (auto-log a
lead + pipeline flow), the Consulting module (D90). Converging with 20/34 on one theme: everything
links to people/companies with roles and flows into the pipeline. **Strong brainstorm + design-spec
candidate.**

**Status:** OPEN — logged 2026-07-21, no code touched. **Blocked on Jeff supplying the actual Peak
consulting letter** (needed as the format guide) and coupled to item 20 for the architect party.

**CLOSED 2026-07-26 (plan 06, D123) — with two Jeff-homework residuals.** Shipped:
six-stage lifecycle (Proposal sent → Awarded → Design → Out to bid → Construction
admin → Closed) with lazy legacy mapping and ONE open-definition; spawn on SENT
(proposal_sent), advance on won (awarded), close on lost-at-proposal_sent with a
"Proposal lost" decision; structured scopes (title/description/fee, total = scope
fees, milestones seed from scopes); Settings-editable assumptions checklist
(ticked texts frozen per proposal; letter renders them under the new
`assumptionsLead` field); auto-lead with open-lead dedupe (new "consulting"
LeadSource, payload stamps leadId); minimal architect {company, contact} on the
engagement (migrates into item 20 later); install-quote link validation + live
status chips engagement↔quote. **Residuals:** (1) `consulting_proposal` is still
the D90 boilerplate — remap to Peak's REAL letter when Jeff supplies it (spec §1
Homework 1); (2) `DEFAULT_CONSULTING_ASSUMPTIONS` is a DRAFT seed marked in-code
for the same replacement. The estimator's shared assumptions model (spec §4,
wave ③) consumes `consultingAssumptions`/`mergedConsultingAssumptions` as-is.

**Residual lines carried to the backlog (not bugs, spec-mandated or product
questions):** reopen-overrides-manual-close — a consulting quote re-sent from
"sent" after someone manually closed its engagement early reopens it to
Proposal sent (the deliberate `engagementSyncAction` reopen rule fires on any
sent-while-closed pairing); suggested follow-up guard, only reopen when the
engagement's latest decision is "Proposal lost" (distinguishes an accidental
early manual close from a genuine lost-then-resent cycle) — product call for
Jeff. Direct lost→won leaves the engagement closed (no sync path advances a
closed record on "won"; re-send first to reopen, then won advances normally).
One-way lead linkage — the proposal stamps `leadId` on itself, but the lead
carries no structured backlink to the quote/engagement (a system activity note
is the only trace); a real backlink field lands with item 20's people/roles
model. Pre-rebuild proposals edit as scopes going forward — opening an old
scope/feeMode/fees quote in the builder shows that legacy content read-only and
any edit re-enters it as structured scopes (revisions keep the original
history). Install-quote win/loss feeds the record via the status chip only (no
separate notification) — confirm the wanted behavior with Jeff alongside the
letter homework.

---

## 36. Estimator: assumptions/exceptions, BOM vs narrative quotes, and document attachments — OPEN

**Area:** `src/lib/stores/quotes.ts` (`Quote` — the target for new fields), the estimator
(`src/app/(app)/estimator/estimator-client.tsx`, `preview-doc.tsx`, `actions.ts`). Reusable
attachment infra: `src/app/(app)/design/engagements/view.tsx:1258` ("Attach document" component) +
`phase.attachments`, and the inbox `AttachmentVM` (`inbox/types.ts`).

**Reported:** 2026-07-21

**Ask (three parts):**
1. **Assumptions + exceptions** added inside the estimation portion.
2. **Both BOM quotes and narrative quotes** — either output is fine, and both will be needed.
3. **Documents attached to estimates** (vendor quotes and other items) useful for the **PM if the
   quote moves forward.**

**Light recon 2026-07-21 — all three are net-new on the quote, each with a pattern to reuse:**

- **A. Assumptions/exceptions — net-new.** The estimator has only a **hardcoded standing "terms"
  line** (`preview-doc.tsx:87-88`, the four fixed sentences, toggled via `pdfTerms`). There is **no
  per-quote editable assumptions or exceptions.** This is the **same need as item 35's consulting
  "checked assumptions"** — build it once as a shared checkable-assumptions/exceptions model usable by
  both the estimator and consulting, not twice.
- **B. BOM vs narrative — narrative is net-new.** Today the estimator is **BOM/itemized only**
  (sections → line items in `spec` → `preview-doc.tsx`). "Narrative" exists only as a *site-intake
  input* (`actions.ts:303` `kv("Narrative", …)`), **not as a quote output style.** A prose/narrative
  quote is a new render mode. (The AI-scope path already turns intake into prose, so it could draft
  the narrative from the BOM/spec.)
- **C. Attachments — net-new on quotes, but the infra exists.** The `Quote` type has **no
  `attachments`** field, but consulting phases and the inbox already use an attachments pattern
  (`phase.attachments` + the "Attach document" upload component + the doc/blob store). **Reuse it** on
  the estimate. Driver = **vendor quotes**; must **carry forward to the project on Won** (the spawn
  machinery in `stores/projects.ts`) so the PM has them. Internal-only — vendor quotes never show to
  the customer.

**Decisions Jeff needs to make:**
- **A.** One shared assumptions/exceptions model across estimator + consulting (#35)? A checkable
  standard list + free-text override? What's the default set, and are exceptions separate from
  assumptions?
- **B.** Narrative = an alternate *render* of the same BOM, a separate free-form prose field, or
  both? Per-quote toggle for which the customer receives? Should the AI draft it from the spec?
- **C.** Which file types; attachments stored on the quote doc vs a blob store; confirm carry-forward
  to the project on Won; internal-only.

**Ties in:** item **35** (consulting checked assumptions — share the model with A), item **34 / 20**
(the quote→project→PM handoff and where attachments live), item **24** (revisions — decide whether
assumptions/narrative/attachments are snapshotted per revision).

**Status:** OPEN — logged 2026-07-21, no code touched. Three separable parts (A/B/C); A and C are
smaller (patterns exist), B (narrative mode) is the larger design piece.

---

## 37. Estimator: enter a category sell price, back-calculate the margin — OPEN

**Area:** `src/app/(app)/estimator/section-card.tsx` (per-section margin input `onSetMargin`),
`src/app/(app)/estimator/pricing.ts` (`totals()` and the `sell = cost/(1−margin)` model),
`src/app/(app)/estimator/types.ts` (`SpecSection`).

**Reported:** 2026-07-21

**Ask:** Manually enter the **sell price on categories** (sections) and have the **margin update**
based on that.

**Light recon 2026-07-21 — this inverts an input that already exists:**

- **The estimator uses margin-on-price:** `sell = cost / (1 − margin)` (`pricing.ts:24,147,317`), so
  margin is the fraction of the *sell* that is profit (0.38 = 38%).
- **Each section already has a margin % input** (`section-card.tsx` `onSetMargin`, "per-system
  margin") that drives the price forward. Jeff wants the **reverse** field: type the **sell price**,
  solve `margin = (price − cost) / price`.
- **The reverse math already exists** — `totals()` computes the blended `margin = (rev − cost) / rev`
  (`pricing.ts:109`) and each line already displays `(price − cost) / price` (`section-card.tsx:356`).
  So it's wiring a new input to existing math, not new pricing logic.
- **Likely the real goal:** quote a **round number per category** ("sell this section for $10k") and
  read the implied margin — which the forward margin-% field can't do cleanly.

**Decisions Jeff needs to make:**
- **A. Distribution** — entering a section sell price should **solve for the uniform section margin
  that hits it** (mirrors the existing per-section margin field, *recommended*), **scale** existing
  line prices proportionally, or store a **section-level override** without touching line prices? This
  is the one real design choice — a section holds many lines with individual costs.
- **B. Reconcile with pricing tiers (item 11).** A manual sell price is an **override** on top of the
  tier-seeded margin; confirm it **persists across revisions (item 24)** rather than being recomputed
  from `tierMargin` when a revision is cut.
- **C. Guardrails** — warn when the entered price implies a margin below the tier/floor?
  `marginColor()` already exists to flag thin margins.

**Ties in:** item **11** (pricing tiers → default margin — this is the manual override path), item
**24** (revisions — the entered price must snapshot, not recompute).

**Status:** OPEN — logged 2026-07-21, no code touched. Contained — the math and the per-section margin
field already exist; the work is a sell-price input + deciding A (line distribution).

---

## 38. The Grid: default base plan sheet, GENERATED like the estimator plan view — OPEN

**Area:** The Grid (`/design/grid`), sheet handling; shared `VenueDims`.
**Reported:** 2026-07-25 (staged off-mini, flushed 2026-07-25)
**Spec:** `docs/superpowers/specs/2026-07-25-grid-base-sheet-and-estimator-split-design.md` (wave 2)

**Ask (Jeff):** *"we need to have a base plan sheet be default, so the user doesn't need to
upload something right away, they can just start dropping items in"* — refined same day:
*"the base sheet follows the same logic as the plan view on the design estimator."* A new Grid
project opens with a venue plan generated from dimensions (shared `VenueDims`), NOT a blank
canvas; uploading a real plan stays optional. Scale is implicit from known geometry — **no
calibration step on the base sheet**.

**Notes:** Dims trap — estimator `width` = PROSCENIUM width; lineset `stageWidthFt` =
wall-to-wall; the generated sheet must be explicit about which drives it. Open: when a real
plan uploads later, do base-sheet markers carry over or arrive as a separate sheet?

**Status:** OPEN — spec written, rides wave 2 (part of #41's architecture).

---

## 39. Catalog build-out for beta + Grid connection logic + wire types — INFRA DONE; IMPORT AWAITS JEFF (2026-07-25)

**Area:** catalog (`catalog_parts`), The Grid device palette (`/design/grid`).
**Reported:** 2026-07-25 (staged off-mini, flushed 2026-07-25)
**Spec:** `docs/superpowers/specs/2026-07-25-catalog-beta-buildout-design.md` (wave 1)

**Ask (Jeff):** *"it is becoming a problem for beta testing to not have more items."* Four
parts, one initiative: **(a)** seed real items from multiple manufacturers across six
categories — Lighting Controls · Fixtures · Video Controls · Speakers · Audio Controls ·
Curtains (**NOT Fabric** — separate discussion pending); **(b)** those items appear in The
Grid's palette (answers the slice-1 seed question); **(c)** connection metadata (ports) so
The Grid only wires compatible devices — extends the ETC metadata worksheet to all six
categories; **(d)** wire TYPES per connection ("wire times" was a typo) — DMX, Cat6, speaker
etc., one schema with (c); routed runs gain a real cable BOM line.

**Locked calls:** starter set (Claude drafts from the 52-sheet manifest in
`~/Downloads/Dealer Price Sheets/Peak Import/`, **Jeff reviews before import**); trades =
Lighting / Rigging / AV, category→trade mapping stored as admin-editable data;
Tannoy = Music Tribe, Ape Riggers dropped, Draper base-only.

**Status:** INFRA DONE 2026-07-25 (branch `punch-39-catalog-buildout`, plan
`docs/superpowers/plans/2026-07-25-catalog-beta-buildout.md`); **the starter-set IMPORT is
staged and waiting on Jeff's review** — that gate was a locked decision and was NOT bypassed.
What shipped: **(1) taxonomy layer** — six groups + three trades resolved through an
admin-editable category→{group,trade} map in appSettings (parts NOT rewritten; existing
free-text `category` untouched; Fabric/Labor excluded), seeded for all ~28 known categories,
with an admin "Categories & trades" editor card on /catalog; **(2) ports + wire types** —
`ports[]` on catalog parts, a 22-entry connection-type taxonomy, wire-type registry seeded
(8 defaults; admin UI + consumption come with the cable-BOM pricing pass), and the v1
compatibility rule (type match + direction complement);
**(3) Grid wiring validation** — device-to-device routes (endpoint snap) validate port
compatibility client-side AND server-side, refuse incompatible pairs via the editor notice,
stamp from/to placement ids + connectionType, and cable BOM lines carry the connection type
(only when every contributing route agrees); free routes and ports-less parts unaffected;
**(4) datasheet attachments** — `datasheetBlobKey` on the part, D116 private-blob upload +
authenticated `/api/part-datasheet/<sku>` proxy, attach/replace/remove in the part edit
modal, "datasheet" links in the Grid palette + BOM rows (attach once → everything inherits);
**(5) palette groups** — the Grid palette filters by All · six groups · Other; **(6) REVIEW
GATE ARTIFACTS: `docs/catalog/STARTER-SET-2026-07-DRAFT.md`** (68 items, ≥2 manufacturers per
group; Tannoy=Music Tribe; Ape Riggers dropped; Draper held out ENTIRELY — stronger than
"base-only", needs Jeff's read; Biamp rows are placeholders, sheet has no product names) and
**`docs/catalog/METADATA-WORKSHEET-2026-07.md`** (taxonomy to prune + draft ports per item;
gaps flagged: no network/NDI or RF types yet). Staged import data:
`scripts/starter-import-data.json` (inert). **Jeff: review the two docs, mark rows to drop,
then say "import the starter set."** 389 spec tests green; build green. Known beta-accepted
limitation: server route validation trusts client-supplied endpoint ids (DevTools-level
bypass yields an unlabeled or mislabeled free route — a tampered client borrowing two real,
compatible placement ids gets a labeled route stamped, not just an unlabeled one — nothing
worse). Also noted: `importCatalog` paste action has NO admin gate (pre-existing — flag for
Jeff).

---

## 40. Catalog-anchored datasheets + specs → one-click client package — OPEN

**Area:** catalog (`catalog_parts`), The Grid, estimator, designs, D94 spec engine, D116 blob store.
**Reported:** 2026-07-25 (staged off-mini, flushed 2026-07-25)
**Spec:** `docs/superpowers/specs/2026-07-25-client-package-generator-design.md` (wave 2)

**Ask (Jeff, verbatim goal):** *"if we prepare a BOM we can easily generate a datasheet, spec,
and rough drawings for the client without too much effort or work."* **(a)** datasheet
attachments anchored on the CATALOG part (attach once → every Grid drop / estimate / design
inherits; home = private Vercel Blob + authenticated proxy, D116); **(b)** spec attachment per
product — same anchor, extends the D94/D89 "locked CSI language on catalog parts" population
across the six beta categories; **(c)** the generator: one action walks a BOM and emits
datasheet package + spec + rough drawings. Much exists (Grid→D94 bridge, derived riser, .docx
output) — the missing piece is assembly; completeness depends on (a)+(b) population.

**Status:** OPEN — wave 2 (depends on #39 attachments being populated).

---

## 41. DIRECTION: split the design estimator; merge design-artifact logic into The Grid — OPEN

**Area:** design estimator, The Grid, Designs.
**Reported:** 2026-07-25 (staged off-mini, flushed 2026-07-25)
**Spec:** `docs/superpowers/specs/2026-07-25-grid-base-sheet-and-estimator-split-design.md` (wave 2)

**Direction (Jeff-confirmed):** estimation side (dims/assumptions → budget) moves under
Estimating; **Plan + equipment/lineset schedules + Control Riser logic merges into The Grid**
(one design workspace; "Schedules" = equipment/lineset schedules, NOT the Operations board).
**Architecture confirmed:** two dims-driven paths off shared `VenueDims` — estimator keeps
measurements for equation-based quick estimates (numbers only); The Grid uses the same
variables to generate the plan view when no drawings exist (#38 fully grown). Artifacts derive
from Grid instances ONLY. Estimating consumes a Grid BOM when one exists, else prices
parametrically. **Equipment scoping:** per-item optional "categories toggle" with user-defined
labels (trade packages, alternates — open-ended by design). **Naming/nav TABLED** (tabs/UI
rebuild in flight). **NO data migration** (beta, sample data only). Sequencing: #39 lands
first; this rides on top. Pricing math mostly does NOT move (budget + quote share `goods.ts`).

**Status:** OPEN — wave 2.

---

## 42. Inbox round 2: threading + Outlook three-pane + Inbox/CRM mode toggle — DONE (2026-07-25)

**Area:** Inbox (Gmail-backed, D105 rebuild 2026-07-22).
**Reported:** 2026-07-25 (staged off-mini, flushed 2026-07-25)
**Spec:** `docs/superpowers/specs/2026-07-25-inbox-round-2-design.md` (wave 1)

**Ask (Jeff):** *"The inbox still seems very clunky and rough… I thought I asked for it to
look more like outlook with threads."* First recon: verify whether D105 shipped conversation
threading at all (its record never mentions it; Gmail supplies `threadId`, so grouping is
list-rendering work). Locked: one row per conversation (count badge, latest snippet);
three-pane layout (folder rail · list · persistent reading pane, arrow-key nav); density pass
(bold-unread, hover quick actions); selection-aware command bar; **Inbox/CRM mode toggle** —
default = plain date-sorted email, CRM mode = follow-up/waiting filters, persisted per user.

**Status:** DONE 2026-07-25 (branch `punch-42-inbox-round-2`, plan
`docs/superpowers/plans/2026-07-25-inbox-round-2.md`). **Recon found threading, the
three-pane layout, and the selection-aware command bar were ALREADY BUILT** (one
`CommThread` = one Gmail conversation since the Phase-7 bridge; the reader has been an
inline pane all along) — the D105-era record just never said so. What this round actually
added: **(1) per-user Inbox/CRM mode toggle** (server-side pref, notif_prefs row; default =
plain date-sorted inbox — the old always-on waiting-first sort is now CRM-mode-only; "Needs
reply" view keeps waiting-first in both modes; CRM mode adds a Needs reply · Flagged ·
Unread chip row), **(2) conversation count badge + combined participants** on list rows,
**(3) tighter density** (9px rows, 26px channel tile, chip row only when it has content) **+
Delete/Restore in the hover quick actions**, **(4) arrow-key navigation** (clamped, guarded
against inputs/selects/search mode/compose+log modals, scroll-into-view). Verified live:
mode flip is optimistic + survives reload; date-desc default confirmed; CRM flip re-sorts
waiting-first. Carried minors: site-visit modal's open state can't gate the key handler
without a state-lift (edge case, logged); calls/flagged smart views now follow the mode's
sort (was always waiting-first) — flag to Jeff if unwanted.

---

## 43. Reports + Home rebuilt as BUILD-YOUR-OWN widget system — OPEN (supersedes #7)

**Area:** Reports, Home.
**Reported:** 2026-07-25 (staged off-mini, flushed 2026-07-25)
**Spec:** `docs/superpowers/specs/2026-07-25-dashboard-widget-system-design.md` (wave 2);
full brief in memory: `knowledge/peak/quartzite-dashboard-widget-brief-2026-07.md`

**Design (converged 2026-07-25, all decisions Jeff-confirmed):** curated widget REGISTRY
(5 primitives), NOT a query builder; one system powers Home AND Reports (Home cards become
widgets); role-gated widgets; Owner/Installer/Admin presets as starting layouts; pick+reorder
auto-layout v1; global timeframe selector (forward-looking widgets exempt).
**Pipeline/capacity widget:** capacity = $ bands per TRADE per MONTH, effective-dated; trade
mix AUTO from catalog categories (+ override) — consumes #39's trade mapping; **#15 is a
PREREQUISITE** (expected install window per quote); stage-default weights + per-deal override
+ "sits awhile" timing push; utilization v1 = scheduled load. Riskiest assumption:
category→trade mapping (no explicit Rigging category — resolved by #39's mapping table).
**Supersedes #7** — reconcile in the Daylite-parity design.

**Status:** OPEN — wave 2 (needs #39 categories + #15).

---

## 44. Projects lifecycle: delivery-driven stages + Install module + phone signoff + walkthrough task — OPEN

**Area:** Projects, Install/Field Work, Schedule, tasks.
**Reported:** 2026-07-25 (staged off-mini, flushed 2026-07-25)
**Spec:** `docs/superpowers/specs/2026-07-25-projects-lifecycle-design.md` (wave 2)

**Decisions (Jeff pop-in-confirmed 2026-07-25):** **(a)** per-shipment delivery lines
(what's coming · expected ship date · received checkbox); ALL received → auto-advance to
Scheduled with undo; scheduling never blocked by stage — expected ship dates surface on the
schedule for crew pre-booking. Full PO/procurement module explicitly NOT chosen. **(b)**
Install module: installer opens *"basically a report of everything up to that point"* —
scope/BOM by scope category · schedule + crew · site/venue + contacts · drawings/datasheets
(reuses #40) · prior notes · signoff checklist; mobile-first on Field Work. **(c)** signoff =
checkbox per SCOPE + phone-drawn signature (rework D83's silent `setSignoff()` stage write
into an explicit signoff record). **(d)** Complete → auto-task to the project's Lead Sales
role (falls back to quote owner), due ~7 days: walk the site with the end user. Depends on
#17 tasks table (plan 01 LANDED 2026-07-25) + #16E roles model.

**Status:** OPEN — wave 2.

---

## 45. Header/nav fixes for the in-flight tabs rebuild, (a) DONE 2026-07-27 via #55; (b) OPEN

> **(a) Home restored on web AND mobile, DONE 2026-07-27 (D124), see #55.** The tabs rebuild has
> landed, so this is no longer routed away from the punch-list stream. (b) the responsive full-word
> vs short-label switch is still open.

**Area:** header/nav (tabs rebuild in flight).
**Reported:** 2026-07-25 (staged off-mini late, flushed 2026-07-25)

**Ask (Jeff):**
- **(a) Home is MISSING entirely — on both web and mobile.** *"there is also no home on the
  web or mobile and that needs to be fixed."* Restore Home as a main tab on both form factors.
- **(b) Tab-label abbreviations are MOBILE-ONLY.** On web/desktop the main tabs read full
  words: **Home · Sales · Installs · Customers · Design** (Jeff's current preferred set).
  Implementation shape: responsive label switch (full label at desktop breakpoint, short label
  below) — ONE nav build, not two.

**Status:** OPEN — belongs to the tabs/UI rebuild session, not the punch-list build stream.
Do not pick up standalone; the rebuild session owns the nav.

---

## 46. Inbox round 2 polish (follow-ups from the #42 reviews) — OPEN

**Area:** Inbox. **Logged:** 2026-07-25, bundling the accepted-as-follow-up findings from the
#42 per-task and whole-branch reviews. None are defects blocking daily use; batch them.

- CRM chips row renders above the list's title/search block (needs a small `thread-list.tsx`
  change that was out of scope for the toggle task).
- Site-visit modal's open state (`visitOpen`, local to `thread-reader.tsx`) can't gate the
  arrow-key handler — needs a state lift; open Filter▾/Sort▾ menus have the same
  unguarded-BUTTON gap.
- Arrow-nav `lastIndexRef` only learns positions from key presses — sync it on click
  selections / reset on listKey change (click-then-arrow under a vanishing filter can resume
  from a stale anchor).
- CRM mode's Sort▾ menu has no "Default (waiting first)" entry to return to the mode default
  after an explicit sort; mode flips also carry an explicit sort/filter param across —
  product call (Jeff) whether flips should reset refinements.
- `crmMode` local state never reconciles with the server prop (second tab/device flips show
  a stale toggle until remount); key-repeat isn't throttled (held arrow = many navigations +
  mark-reads); scroll-into-view doesn't re-fire on list re-sorts.
- Test/seed gaps: no automated coverage for the keydown clamp/guards; no chip-less (3-line)
  seed thread; no 3+-author seed thread for the "+N" participants badge.
- **Jeff to confirm:** calls/flagged smart views now follow the mode's sort (date-desc in
  plain mode; previously always waiting-first) — intended?

**Status:** OPEN — polish batch, no urgency.

---

## 47. The Grid: move/reposition items after they are placed, BUILT 2026-07-27 (D124), BROWSER-UNVERIFIED

> **Built** on `punch-2026-07-27-wave-a`: `movePlacement()` + `movePlacementAction`, drag-to-move
> with optimistic local state, a 4-screen-pixel click/drag threshold, arrow-key nudge (Shift =
> coarse, debounced) and an x/y readout on the selected-device panel. **Attached wires follow the
> device**: the matching route endpoint is translated by the same delta inside the same patch.
> A move does not cut a revision and does not restamp `by`/`at`. Typecheck + ESLint clean.
> **NOT verified in the browser:** the Grid needs a plan sheet, and sheet upload fails in local dev
> (`Upload to file storage failed, check the Blob token`). See the note under #58.

**Area:** The Grid: `src/lib/stores/grid-projects.ts`, `src/app/(app)/design/grid/[id]/actions.ts`,
`src/app/(app)/design/grid/[id]/editor.tsx`
**Reported:** 2026-07-27

**Ask (Jeff):** *"We need to be able to move around items after they are placed."*

**Recon (2026-07-27):** confirmed missing, the only reposition workflow today is
place → select → **Remove device** → re-place.
- `GridPlacement` = `{ id, sheetId, page, x, y, partId, by, at }` (`grid-projects.ts:32-44`),
  coords normalized 0..1. Store has `addPlacement` (`:243-263`) and `removePlacement`
  (`:265-273`) only: **no `movePlacement`/`updatePlacement`**.
- Actions: `placeDeviceAction` (`grid/[id]/actions.ts:89-98`), `removePlacementAction`
  (`:100-109`). No move action.
- Client: one pointer handler `onDown` (`editor.tsx:331-465`), marker hit-test at `:424-432`
  (radius 0.012), drop at `:435-450`. `onMove` (`:467-472`) and `onUp` (`:474-482`) are
  **calibration-only**: there is no drag state for placements. Markers render as plain SVG
  `<g>` with no pointer handlers (`:1252-1271`). No keyboard path (no Delete, no arrow nudge).
- Selected-device panel (`editor.tsx:855-883`) shows partId/desc/author + Remove only, no
  X/Y readout, no nudge.

**What has to change:** `movePlacement()` in `grid-projects.ts` next to `addPlacement:243`;
`movePlacementAction` mirroring `placeDeviceAction:89`; drag state across
`onDown/onMove/onUp` in `editor.tsx`; nudge/coords in the selected panel `:855-883`.

**Traps for the implementer:**
- The editor relies on `router.refresh()` after every action and `sheetPlacements` is derived
  (`editor.tsx:247-250`): a drag needs local optimistic state or it snaps back mid-gesture.
- **Wires do not follow the device.** `GridRoute.points` is independent of
  `fromPlacementId`/`toPlacementId` (`grid-projects.ts:93-111`), so a naive move silently
  detaches drawn routes from their markers.
- Should a move cut a revision? `addRevision` (`grid-projects.ts:469-479`) is manual/quote/
  restore only: wiring drags into it would flood the snapshot array.

**Status:** OPEN: logged only, no code.

---

## 48. The Grid: per-discipline filters / layers + user-defined categories that track through Spaces, OPEN

**Area:** The Grid: `src/app/(app)/design/grid/[id]/editor.tsx`, `src/lib/design/grid-bom.ts`,
`src/lib/catalog-taxonomy.ts`, `src/app/(app)/design/grid/[id]/spaces-panel.tsx`
**Reported:** 2026-07-27

**Ask (Jeff):** *"We also need different filters for different scopes so you can drop items in
for lighting, rigging, curtains, audio, video, and then user defined categories, those
categories should track through with the spaces as well but if we don't allow different filters
then it is going to get busy quick."*

**Relationship to #41:** #41 already carries the *per-item categories toggle* (open-ended,
user-defined labels: assign now, consume later). **This item is the consumption side Jeff is
now asking for: FILTERS/LAYERS on the canvas, plus category rollup per Space.** Build them
together; don't scope #41's category field without this.

**Recon (2026-07-27):**
- Discipline exists on the **catalog part**, never on the placement. `TRADES =
  ["Lighting","Rigging","AV"]` (`catalog-taxonomy.ts:18`); six `GROUPS`, Lighting Controls,
  Fixtures, Video Controls, Speakers, Audio Controls, Curtains (`:21-28`); `GROUP_TRADES`
  (`:35-42`); resolved server-side into `PartLite.group` (`grid-bom.ts:15-42`).
  **`PartLite` has no `trade`**, a discipline-level filter needs it plumbed through.
- A placement stores only `partId` (`grid-projects.ts:41`); group/trade is joined at render
  (`editor.tsx:1253-1254`). No per-item category, no override.
- The existing `groupFilter` (`editor.tsx:198`, select at `:640-650`) filters **which parts you
  can arm in the palette** (`filteredParts:232-245`). It does **not** touch `sheetPlacements`
  (`:247-250`) or the marker layer (`:1252`), placed items are always all visible. That is
  exactly the "busy" problem.
- Marker color is a hash of `part.category` (`markerColor:95-101`), decorative, not a legend,
  not stable across category renames.
- **Spaces:** `GridSpace` (`grid-projects.ts:52-62`); membership is **computed, never stored**
  (`spaceOf` in `grid-geometry.ts:124`). Per-space rollup `bomBySpace` (`grid-bom.ts:109-127`)
  returns `{ spaceId, name, count, value }`, a flat count + dollar value, **no breakdown by
  category**. It drops the part's `group` on the floor at `:121`. That function and
  `SpaceRollup` (`:94-99`) are the exact seam for "categories track through with Spaces";
  consumers are `spaces-panel.tsx:196-210` and `editor.tsx:287-290`.

**Open questions for Jeff / the implementer:**
- Are the filter buckets the six catalog GROUPS, the three TRADES, or a separate Grid-scope
  taxonomy? Jeff's list (lighting, rigging, curtains, audio, video) matches neither exactly.
- Palette filter vs layer visibility are different concerns sharing one `groupFilter` state, 
  independent controls, or does arming a group dim the others?
- Stored-on-placement vs derived-from-part: derived is cheaper, but a curtain (#49) or custom
  item has no catalog category to derive from, and the map is admin-mutable at runtime
  (`catalog-taxonomy.ts:12-15`), so old designs can silently re-bucket.

**Status:** OPEN: logged only, no code.

---

## 49. The Grid: curtains as a first-class drop-in (Border/Draw/Full/Leg + config dialog), OPEN

**Area:** The Grid palette + a new curtain drop dialog; mirrors `src/app/(app)/estimator/curtain-modal.tsx`
**Reported:** 2026-07-27

**Ask (Jeff):** *"Curtains getting added: This should be treated as the usual types, Borders,
Draws, Fulls, Legs. Then when you drop it in you specify the Width, Height, Fullness, Name, and
Fabric Type. Similar to our curtain builder for estimates."*

**Recon (2026-07-27):**
- **"Curtains" is a palette group with no parts.** It is one of the six beta groups
  (`catalog-taxonomy.ts:27`, trade Rigging `:41`) seeded as an identity entry with the explicit
  note *"no imported parts use this category yet"* (`:71-73`). Worse, the palette **excludes
  `category === "Fabric"`** from every group bucket (`editor.tsx:241`), so the actual fabric
  SKUs the curtain math uses are not paintable. Selecting "Curtains" today yields an empty list.
- The Grid's only drop is `placeDeviceAction(partId)` (`editor.tsx:438`), carries no dimensions.
- **The estimator builder to mirror:** `estimator/curtain-modal.tsx`, Name (`:71-80`), Fabric
  from catalog category `Fabric` (`:82-102`), Qty/Width/Height (`:104-138`), Fullness segmented
  Flat/50/75/100 (`FULLNESS:15-20`, buttons `:141-155`), vendor cost override (`:157-172`).
  Draft type `CurtainDraft` (`estimator/types.ts:67-78`; `hang`/`bottom` are vestigial).
  Client math `computeCurtain` (`estimator/pricing.ts:130-158`); commit `addCurtain`
  (`estimator-client.tsx:711-733`, mints `sku: "CRT-<n>"`).
- **Fullness/goods math:** authoritative cost model `src/lib/design/curtain-pricing.ts`
  (`curtainCost:73-89`, `CURTAIN_MARGIN:43`, making rates `:45,47`); customer-safe mirror
  `src/lib/curtain-geom.ts`. Note `src/lib/design/goods.ts` is **not** the fullness calculator, 
  it is the finished-dimension recipe table for the lineset schedule (`drapeRule:55-102`).
- **Three different curtain type vocabularies already exist** and none is canonical:
  Quick Design `design/quick/engine.ts:235` (Draw/Legs/Border/Scenery/Full) · `goods.ts:83-101`
  (Draw/Midstage Draw/Rear/Legs/Border/CYC) · `lineset.ts:11,364-378` (adds Electric/Shell/GP).
  **Jeff's set here is Borders / Draws / Fulls / Legs.** Pick one shared enum first, this item,
  #50 and #48 all depend on it.

**Open question (blocking, for the implementer):** a Grid curtain is not a catalog SKU. Does it
become (a) a `GridCurtain[]` array on `GridProject`, (b) a placement with an optional `config`
blob, or (c) a synthesized `CRT-*` pseudo-part like `estimator-client.tsx:721`? That choice also
determines how `bomLines` (`grid-bom.ts:68`) prices it, since it looks up parts by id.

**Status:** OPEN: logged only, no code.

---

## 50. Lineset Builder: curtains/tracks/pipe not filling out + reduce to three dimension inputs, PARTIALLY BUILT 2026-07-27 (D124)

> **Built and browser-verified** on `punch-2026-07-27-wave-a`: (a) the silent fabric failure is now
> NAMED: per-row chip, a banner grouped by cause, a red-bordered fabric select and a
> `FABRIC UNRESOLVED` prefix on the CSV Check column, distinguishing *no Fabric parts in the
> catalog* from *this part has no oz/yd²*; (b) per-line pipe + batten-length overrides that fall
> back to the global; (c) Track gained a real "None, no track" option, so Legs/Border/CYC stop
> falsely displaying "Light-duty track" and a track can be cleared; (d) fabric tier labels
> corrected to the data (Better = 25 oz Charisma, not 21 oz Marvel). `steel.ts` untouched.
> **STILL OPEN: the three-input reduction.** Blocked on one answer from Jeff: where does
> `battenLen` come from? It is a hardcoded 44 ft (`steel.ts:471`) driving batten weight, track
> weight, the distribution allowance and the bending check, and (proW, proH, depth) cannot supply
> it. Options: `proWidth + 2×wing` · `proWidth + K` · keep stage width as a 4th input.

**Area:** `src/lib/design/lineset.ts`, `src/lib/design/goods.ts`, `src/lib/design/steel.ts`,
`src/app/(app)/design/lineset/lineset-builder.tsx`, `src/lib/design/venue-dims.ts`
**Reported:** 2026-07-27

**Ask (Jeff):** *"I don't think the curtains, or tracks or pipe are filling out. It seems like we
confused the equations a bit, we really only need three different equations, Width of Pro, Height
of Pro, and Depth of Stage, that should be enough for us to define the stage area and the
requirements for it. This isn't meant to be a full fleshed design just enough to spit out a
lineset schedule and the loads calcs for it."*

**Recon (2026-07-27): the empty rows are almost certainly a DATA problem, not an equation problem:**
- Auto-fill does run, unconditionally, on every keystroke (`lineset-builder.tsx:185-224` →
  `drapeRule` `goods.ts:55-102` → `ruleToWeightLine` `goods.ts:216-243`).
- `ruleToWeightLine` resolves fabric by SKU against `fabrics = byCategory("Fabric")`
  (`design/lineset/page.tsx:106`). **Fabric rows exist only in the demo seed**
  (`src/db/seeds/catalog.ts:12-21`), and demo seeding is skipped on a hosted DB
  (`src/db/seed-data.ts:148`). The real imported dealer catalog has **zero** `category:"Fabric"`
  rows. So `fabrics = []` → `fab: undefined` (`goods.ts:229-235`) → in `computeSetWeight`
  (`steel.ts:501`) **`goods = 0` AND `trackWt = 0`** (track lookup is gated on the fabric,
  `steel.ts:515`). That single gap reproduces "curtains and tracks not filling out."
  Secondary: seeded fabric rows with no `oz` return `null` from `fabricFromPart`
  (`steel.ts:399`): same silent zero (`RB-MARVEL`, `RB-COM-16`, `RB-SCRIM`, `RB-BOBNET`,
  `RB-POLY`).
  → **First step: confirm which DB Jeff is on and whether `byCategory("Fabric")` is empty.**
- **"Pipe not filling out" is a real UI gap:** `LoadEditor` (`lineset-builder.tsx:316-351`)
  exposes fab/w/h/full/qty/gear/chain/track/mode/hoist but has **no `pipe`/`batten` field**,
  though `WeightLine` defines both (`steel.ts:489-490`). Pipe is global-only
  (`lineset-builder.tsx:455-456`).
- **Track select bug:** `TRACKS` (`steel.ts:359-363`) has no "None" entry but the select does
  `value={value.track || "None"}` (`lineset-builder.tsx:338`), every no-track line
  (Legs/Border/CYC) displays "Light-duty track" while storing undefined, and a track can never
  be cleared.
- **Tier label lies:** UI says "Better, 21 oz Marvel" (`lineset-builder.tsx:480`) but `better`
  maps to `RB-CHAR-25`, 25 oz Charisma (`goods.ts:42`).

**On the three-input reduction.** Current inputs are `stageWidthFt/In`, `stageDepthFt/In`,
`proWidthFt`, `proHeightFt` (`lineset.ts:26-49`) plus nine rule constants in the settings drawer.
What **cannot** be satisfied by (proW, proH, depth) alone:
- `battenLen`: hardcoded 44 ft (`steel.ts:471`), and it drives batten weight, track weight, the
  distribution allowance and the bending check. Needs stage width or a proW→batten rule.
- `stageWidthFt` is **already vestigial**: `widthIn` (`lineset.ts:155`) feeds only the status
  string (`:220-225`) and the CSV filename. `venue-dims.ts:16-17` claims it "drives batten length
  and line placement": **false in code today.** So dropping it is close to free *if* batten
  length gets a rule.
- Rule constants (slot spacing 8", electric interval 10', shell interval 12', clearance 16",
  cyc offset 3', gpCount, 4 include-toggles), survivable as hidden defaults, but they are
  inputs today.
- Hardcoded goods constants that look like they should derive: Border height 5 ft, Legs width
  6 ft (`goods.ts:91,93`).
- `gridHeightFt`: in `VenueDims` (`venue-dims.ts:21`) but unused by the lineset; the estimator's
  rigging equations do need it (`quick/engine.ts:481,484`).

**Shared-dims trap (still live):** `venueDimsFromEstimator` (`venue-dims.ts:33-47`) maps
`width → proWidthFt` **unconditionally**, but `AState.width` is proscenium only for
`kind:"proscenium"`: for church/flat/blackbox/arena/gym it is wall-to-wall
(`quick/engine.ts:162-183`). Every non-proscenium venue currently oversizes drapes. Also
`venueDimsFromLineset` (`venue-dims.ts:50-61`) **has no callers in `src/`**, the builder builds
its own dims inline (`lineset-builder.tsx:172-180`).

**Housekeeping:** **#28 is stale**, the 50′×30′ defaults shipped (`lineset.ts:52-72`,
`lineset-builder.tsx:500-502`) but the item is still marked OPEN. Close it with this work.

**Status:** OPEN: logged only, no code.

---

## 51. Design tab consolidation: one design toolset + a publishable package for Consulting AND Design/Build, OPEN

**Area:** DESIGN nav group (`src/components/nav/nav-data.ts:76-79`), The Grid, Lineset Builder,
Steel Calculator, the D94 spec generator, Consulting/Engagements, Designs
**Reported:** 2026-07-27

**Ask (Jeff):** *"I think we need to consolidate this a bit, I think Lineset builder, steel
calculator, and then The Grid should be tools that Consulting or Design/Build (Designs) use to
build out a design. Ultimately the only difference between the two is whether we go out to bid on
the work, otherwise we should treat them both the same so the client gets the same amount of
information. Also we need to add Spec builder to the tools for Design. I ultimately want for
either consulting or design/build to be able to publish a spec, data sheet package, drawing
package, and estimate/budget for every single design that gets turned out."*

**This is the organizing principle behind #40 and #41, read all three together.**
- #41 = split the design estimator; artifacts merge into The Grid.
- #40 = catalog-anchored datasheets + specs → one-click client package from a BOM.
- **#51 adds the missing frame:** the tools are *shared* by Consulting and Design/Build, the two
  paths differ **only** by whether the work goes out to bid, and **every** design publishes the
  same four deliverables: **spec · datasheet package · drawing package · estimate/budget.**

**Recon (2026-07-27):**
- DESIGN tab today: Overview, Consulting, Designs, The Grid, Steel Calculator, Lineset Builder,
  Motor Library, Fixture Cross-Ref (`nav-data.ts:76-79`). So the three tools Jeff names are
  already in the group, what is missing is that they are **peers in a list, not tools attached
  to a design.**
- **Spec builder is NOT in the nav at all.** It lives at
  `src/app/(app)/design/engagements/spec/page.tsx` (+ `generator.tsx`, `actions.ts`,
  `parse-bom.ts`, `[id]/`), reachable only via engagement deep links
  (`design/engagements/view.tsx:357`) and the Grid bridge (`design/grid/[id]/page.tsx:63`).
  Word export `src/app/api/spec/[id]/docx/route.ts`; libs `src/lib/bid-spec.ts`,
  `src/lib/bid-spec-docx.ts`; stores `spec-sections.ts`, `generated-specs.ts`.
  Decisions D94 (`DECISIONS.md:1088`), D94a docx (`:1120`), D111 Grid→spec bridge (`:1677`).
- Consulting is its own module with phases/review gates/milestones (D90); Designs is separate.
  Nothing today enforces a common output set across the two.

**Open questions for Jeff:**
- Does "publish" mean one action that emits all four artifacts as a bundle, or four separate
  generators reachable from one place? (#40(c) assumes the bundle.)
- Is the **drawing package** the Grid plan + equipment/lineset schedules + control riser (per
  #41), or does it also need the DXF export that is queued from the 2026-07-25 riser brainstorm?
- If bidding is the only difference, does the *estimate* become a **budget** on the consulting
  side (different document, same math), or the same document with a different cover?

**Status:** OPEN: logged only. Direction item; sequence behind #39/#40 like #41.

---

## 52. Estimator fixture builder: light engine + lens selects, and presets that carry catalog part IDs, OPEN

**Area:** `src/app/(app)/estimator/fixture-modal.tsx`, `estimator-data.ts`, `pricing.ts`,
`estimator-client.tsx`, `types.ts`
**Reported:** 2026-07-27

**Ask (Jeff):** *"I want to review how the fixture builder works, I think I like the presets at
the top but I want to make sure that we see what the preset selecting. Ultimately there are two
option boxes that are not showing up. That is the Light Engine or the main fixture, and then the
lens, for example a ColorSource Spot V 36 Degree would pull from a CSSPOTVMVS for the Light
Engine, and then a 426LT for Lens from ETC Catalog. I like that after we build a fixture once it
is preset but it needs to have all of the different catalog items linked into the preset so when
we are working we can order the individual parts. The same principle is applied for the clamp,
accessories, power and data, and if there is a lamp the lamp cost."*

**Recon (2026-07-27): Jeff's read is correct, and the gap is deeper than two selects:**
- **The fixture builder reads ZERO catalog data.** Everything comes from a hardcoded TS array:
  `FIXTURES` (`estimator-data.ts:19-37`, 17 rows, invented SKUs like `ETC-S4-26`, `ETC-CS-SPOT`),
  `FIX_MOUNTS:41-48`, `FIX_ACC:50-57`, `FIX_PWR:59-65`, `FIX_LAMPS:67-72`. Grep finds **no
  `CSSPOTVMVS` and no `426LT` anywhere in `src/`.**
- **Light engine:** the only body picker is the `FIXTURES` select (`fixture-modal.tsx:104-109`)
: not catalog-bound. **Lens: no field at all**, no `FIX_LENS`, no `lens` key on
  `FixtureDraft` (`types.ts:86-97`). Confirmed missing.
- **Presets:** `FIX_PRESETS` (`estimator-data.ts:79-85`, 5 hardcoded entries) = `{ label,
  d: Partial<FixtureDraft> }`; applied by `applyFixturePreset`
  (`estimator-client.tsx:754-767`). Rendered as **bare label chips**
  (`fixture-modal.tsx:64-83`): **the UI never shows what the preset selected**, which is
  exactly Jeff's complaint. Presets are also not user-creatable today ("after we build a fixture
  once it is preset" describes behavior that does not exist).
- **The crux: nothing is orderable.** `addFixture` (`estimator-client.tsx:768-791`) collapses
  the whole configuration into **one** `SpecItem`: clamp, gel frame, safety cable, DMX jumper,
  lamp exist only as **words in `desc`** (`:773-782`) and dollars in `cost`/`price`.
  `SpecItem` (`types.ts:22-40`) has **no component array and no catalog-part reference**, so a
  saved quote can never be exploded into parts to order.
- Catalog access in the estimator exists only via the separate part picker
  (`estimator/catalog-picker.tsx` → `searchCatalog` `estimator/actions.ts:384-421`), which
  **loads the entire catalog into memory** (`:394` → `catalog.ts:73-75`) and JS-scores it, capped
  at 40. It accepts a `category` filter but `catalog-picker.tsx:60` never passes one, and no
  manufacturer filter is exposed. A catalog-bound fixture select would need this query path
  hardened.

**Blockers to resolve before building:**
- **Does the catalog actually contain fixture-body and lens rows, and under what
  `category`/`mfr`?** No ETC part numbers of that shape were found. If not, this depends on the
  #39 catalog build-out.
- `estimator-data.ts:3-8` states the fixture list is deliberately in-screen, not catalog
  (IDEAS #43), *"do not edit without a DECISIONS.md entry"*, **this ask reverses that
  decision**; it needs one.
- `SpecItem` field names are declared frozen (`types.ts:5-9,22`) and read back verbatim by
  `projects.ts` on quote-win. Adding `components[]` needs a back-compat story for saved quotes;
  the alternative (one `SpecItem` per component) changes how the fixture reads on the customer
  PDF (`preview-doc.tsx`).

**Status:** OPEN: logged only, no code.

---

## 53. Estimator: section sell price shows no dollar sign or comma, DONE 2026-07-27 (D124)

> **Built and browser-verified.** The Sell box is now `type="text"` rendered through the existing
> `fmt()`: reads `$84,820.00` and matches Price/Cost/Freight in the same card. Round-trip verified:
> typing `$70,000` and blurring re-prices the section and re-renders formatted. `inputMode="decimal"`
> keeps the touch numpad; the parse strips `$`, commas and spaces; empty still yields 0.
> **Visible change beyond the ask:** the box now shows cents where it used to round to whole dollars.
> Say the word if you want whole dollars in this box specifically.

**Area:** `src/app/(app)/estimator/section-card.tsx`
**Reported:** 2026-07-27

**Ask (Jeff):** *"The sell of each section should be in dollars, the price next to the margin
slider doesn't show the dollar sign or a comma."*

**Recon (2026-07-27):** the Sell box is `section-card.tsx:278-290`, a raw
`<input type="number">` (`:279`) with `defaultValue={Math.round(itemsRev)}` (`:281`). No
formatter is applied, so it renders `74200`. **A `number` input cannot hold `$` or `,`, this is
a control-type change, not just a formatter swap** (switch to `type="text"` with parse-on-blur,
or a display span that swaps to an input on focus).

Two shared formatters already exist and are used in the same file: `fmt()`
(`estimator/pricing.ts:31-39`, `$1,234.56`): already imported at `section-card.tsx:5` and used
for section Price `:219`, cost `:200`, freight `:326`, and the app-wide `money()`
(`src/lib/format.ts:6-14`). The freight readout next to *its* slider is correctly formatted, so
the Sell box is the odd one out. **Decide: `fmt()` (cents) or `money()` (no cents)?** Adjacent
readouts use `fmt()`.

**Status:** OPEN: small and self-contained.

---

## 54. Labor estimator: show the installer rates/cost, and confirm rates pull from the catalog, PARTIALLY BUILT 2026-07-27 (D124)

> **Answer to the question: YES, labor rates pull from the catalog** (`catalog_parts` where
> `category = "Labor"`), with a hardcoded fallback behind them.
> **Built and browser-verified:** a rate strip under the Scope buttons showing the resolved
> Installer / Overtime / Supervisor $/hr for the selected discipline (verified: Rigging $50/hr,
> Video $48/hr, Supervisor $72/hr), a second strip in Shop & engineering (PM $90/hr, In-house
> $40/hr, Drafting), and **a DEFAULT chip whenever a rate fell back to the hardcoded map**, a
> missing or renamed catalog row used to be invisible. Provenance rides on an optional
> `.source(sku)` on the rate function, so no caller changed and no math moved.
> **STILL OPEN: "overall this needs to be redone."** Needs Jeff to say what is wrong beyond the
> invisible rates. Also still silent: travel/equipment rates (`TVL-MIL`, `TVL-HTL`, `TVL-FOD`,
> `EQP-LIFT`): they are per-mile/night/day, not $/hr, so they did not fit the strip.

**Area:** `src/app/(app)/estimator/labor-modal.tsx`, `estimator/pricing.ts:212-347`,
`estimator/page.tsx:168-188`, `estimator-data.ts:92-115`
**Reported:** 2026-07-27

**Ask (Jeff):** *"I would like in the labor estimator to see what the cost of the installers in
the rate calculator. Overall I think this also needs to be redone and shown as I want to confirm
that labor rates are pulling from the catalog for easy long term updating."*

**Recon (2026-07-27): answer to the question first: YES, rates do come from the catalog.**
- Loaded server-side from `catalog_parts` where `category === "Labor"`
  (`estimator/page.tsx:168`), flattened to `sku → cost` (`:185-188`), passed as `laborRates`
  (`:231`). Resolver `makeLaborRate` (`pricing.ts:217-222`): live catalog value wins, else the
  hardcoded `LABOR_RATES_FALLBACK` (`estimator-data.ts:92-100`: `RIG-LBR: 50`, `LIG-LBR: 45`,
  `TVL-MIL: 1`, `EQP-LIFT: 750`, …).
- **Two caveats worth surfacing in the UI:** (1) the fallback **silently masks** a missing or
  renamed catalog row: a missing rate is invisible today; (2) estimator labor rates live in the
  **catalog**, NOT in `/estimating-rules` (whose registry `src/lib/stores/pricing.ts` covers
  flame/repair/inspection/system rates and has no `RIG-LBR`-style entries). **Two separate rate
  homes**: relevant to #56, which wants company rules in one place.
- **Installer cost is only shown in aggregate.** Footer "Cost" (`labor-modal.tsx:118`) and
  per-mob cost (`:316`) render dollars; the hours hint is at `:198`. The `rate` function is
  passed in (`:49,68`) but used **only** to feed `computeLabor` (`:85`), it is never called in
  the render, so **no $/hr is ever displayed.** The label at `:138` says "picks the rate set from
  the catalog" without showing a value.
- **Current math** (`computeMob` `pricing.ts:246-286`): `reg = people × days × 8`; OT × `-OT`
  rate; supervisor `days × 8 × -SUP`; `vehicles = ceil(people/2)`; mileage; hotel/per-diem only
  when `tripType === "travel"`; lift `ceil(days/5)`. Roll-up `computeLabor` (`:309-347`): PM and
  drafting hours **auto-default** to `totalReg × LABOR_PCT[disc]` (`estimator-data.ts:110-115`);
  sell = `cost / (1 - margin)`, margin clamped 0.95.
- `spec.mobs[]` is stamped at `estimator-client.tsx:912`, harvested at `:356-357,370`, persisted
  `actions.ts:106`, consumed on win as `project.mobilizations` (`projects.ts:555`). The portal
  path writes `mobs: []` (`portal/actions.ts:275`).

**Open questions for Jeff:** show the resolved $/hr per discipline in the modal (and flag when a
rate fell back to the hardcoded map)? And should labor rates *also* appear in `/estimating-rules`,
or is the catalog the sole home? "Redone" needs scoping, what specifically is wrong beyond the
invisible rates?

**Status:** OPEN: logged only, no code.

---

## 55. Home dashboard / Home tab, the company mark links nowhere, DONE 2026-07-27 (D124); closes #45(a)

> **Built and browser-verified on desktop AND mobile.** The company mark is now a `<Link href="/">`
> (verified: clicking it from `/quotes` lands on Home), and a **Home** group joined the nav ahead of
> EST/PM/CRM/DESIGN with the five existing sub-tabs (Dashboard · My Queue · Calendar · Inbox ·
> Reports) sourced from `home-tabs-keys.ts` rather than duplicated. The mobile drawer renders the
> same array, so it is fixed by the same change, verified at 375px, with the active row lit.
> `/inbox` is reachable from a cold start again. Two side effects: the home routes now return their
> own child keys so the pill actually lights (`parentGroupOf` only matches child keys), and the
> Inbox unread badge now has somewhere to render (shows 5 on the dev DB).
> **This closes #45(a).** #45(b), the responsive label switch, is unaffected.

**Area:** `src/components/nav/Nav.tsx`, `src/components/nav/nav-data.ts`, `src/app/(app)/page.tsx`
**Reported:** 2026-07-27

**Ask (Jeff):** *"There still needs to be a home dashboard when I click on Peak Systems Group, or
just a home Tab."*

**Recon (2026-07-27): confirmed, and the code comment claims the opposite:**
- The Home page **exists** at `/` (`src/app/(app)/page.tsx`, widgets in the `home-*.tsx` siblings).
- The company name is a plain `<div>`, `Nav.tsx:181-194`: logo + `.pk-mark` +
  `<div className="pk-company">{companyName}</div>` + BETA chip inside a non-interactive flex
  div. **No `<Link>`, no `onClick`.**
- `nav-data.ts:13-17` documents *"[Q6 mark = Home] … Home left the tab row (the mark is the
  link)"*: **that was never implemented.**
- Desktop tabs (`nav-data.ts:12-82`) are EST / PM / CRM / DESIGN, **no Home entry.** The mobile
  drawer uses the same `NAV` array plus `/account` and `/settings` (`Nav.tsx:697-738`), **no
  Home either.** The user menu (`Nav.tsx:589-595`) has only Account/Settings.
- `activeKeyFor("/")` returns `"home"` (`nav-data.ts:86`) and maps `/queue`, `/calendar`,
  `/inbox`, `/reports` → `"home"` (`:89-91,110`), but **no NAV entry has key `"home"`**, so the
  pill never lights.
- Home sub-tabs exist but are only reachable once you are already on `/`
  (`home-tabs-keys.ts:13-19`: Dashboard, My Queue, Calendar, Inbox, Reports;
  `home-tabs.tsx:48-63`): **`/inbox` is currently unreachable from a cold start.**

**Overlaps:** **#45(a)** is the same defect from the tabs-rebuild session (Home missing on web
and mobile): the cheapest fix is both: make the mark a `<Link href="/">` *and* add a Home tab.
**#43** (build-your-own widget system, supersedes #7) owns what the dashboard *contains*; this
item is only about reaching it.

**Status:** OPEN: small nav fix; coordinate with #45.

---

## 56. Knowledge tab under the company, make it the home for COMPANY settings (doctrine, estimating rules, customer tiers), OPEN

**Area:** new `/knowledge` (or a company group), `src/app/(app)/settings/`, `/estimating-rules`,
`src/lib/settings.ts`, `src/lib/stores/pricing.ts`, `src/app/(app)/account/`
**Reported:** 2026-07-27

**Ask (Jeff):** *"I also think we should have under Peak Systems Group there should be a
knowledge tab, this is where company knowledge is stored, like design doctrine, and other useful
things, I also think this is where the estimating rules and customer tiers should live. Basically
let that be where the company settings live instead of under the person."*

**This supersedes and re-scopes #27** (a dedicated Knowledge tab, logged 2026-07-21, still OPEN, 
it was **not** folded into Design; what shipped was #26, the Fixture Cross-Reference at
`/design/fixtures`). #27's unanswered A, D (`PUNCHLIST.md:2062-2073`) should be answered here.
The spec `docs/superpowers/specs/2026-07-25-remaining-items-decisions-design.md:138-140,190`
already calls Knowledge a **new top-level nav group, wave ④**.

**Recon (2026-07-27): the good news: the things Jeff wants moved are ALREADY company-scoped.
The problem is placement and discoverability, not scope.**
- **Estimating Rules / rates**, company-scoped, admin-only: `/estimating-rules`
  (`src/app/(app)/estimating-rules/page.tsx`), definitions `src/lib/stores/pricing.ts:244+`,
  stored as `blobs` singletons `pricing_rules` / `flametest_rates` / `repair_rates` /
  `inspection_rates` (`pricing.ts:116-120`, table `doc-tables.ts:136`).
- **Customer pricing tiers**, company-scoped but **buried inside Estimating Rules** as the
  `tiers` group (`pricing.ts:269-280`: base/copper/silver/gold/platinum/reseller/employee).
  Resolution `src/lib/pricing-tiers.ts:1-54`; enum `src/lib/identity/config.ts`; per-record
  columns `companies.pricingTier` (`schema.ts:104`) and the authoritative
  `contacts.pricingTier` (`schema.ts:136`). **Ties directly to #11.**
- **AppSettings**: one global row `id="main"` (`schema.ts:35-39`, pinned in
  `settings.ts:70,94,100`): accent, companyName, offices, logos, templates, visitReasons,
  consultingPhases, consultingAssumptions, reviewChecklistTemplates, catalogCategoryMap,
  wireTypes, customerFieldDefs (`settings.ts:26-81`). Sections `settings-sections.ts:10-14`
  (General / Team & Roles / Admin) + link-outs `:22-27`.
- **Genuinely per-user:** only `notif_prefs` keyed by `userName` (`doc-tables.ts:143-147`,
  `stores/notif-prefs.ts:60-75`) and the Google Calendar opt-in (`account/page.tsx:145`).
- **Doctrine content is scattered today:** consulting phases/assumptions and review checklists
  are AppSettings keys (`settings.ts:40-53`); customer field defs `settings.ts:80-81`; fixture
  and motor reference are static JSON under `/design`. Nothing holds narrative design doctrine.

**Open questions for Jeff:** is Knowledge a **top-level nav group** or a section under the
company/settings surface? Is the content **static curated docs** (like `/design/fixtures`) or an
**editable store** with authoring? Who can see it, everyone, or admin/role-gated? And does
"estimating rules and customer tiers live here" mean **moving** those screens or **linking** to
them from Knowledge?

**Status:** OPEN: logged only, no code. **Supersedes #27.**

---

## 57. Make the system company-definable, prep for other organizations (multi-tenant groundwork), OPEN

**Area:** whole schema: `src/db/schema.ts`, `src/db/doc-tables.ts`, `src/db/doc-store.ts`,
`src/lib/settings.ts`, `src/lib/session.ts`, `src/lib/portal.ts`, `src/lib/blob.ts`, sync routes
**Reported:** 2026-07-27

**Ask (Jeff):** *"I also feel like overall the system needs to be more definable by the company,
while this is built around my current company if I want to expand this and let other organizations
use the bones we should prep that implementation."*

**Recon (2026-07-27): there is ZERO tenant concept today. This is the largest structural item on
the list.**
- `grep -rn "orgId|org_id|tenantId|tenant_id|workspaceId" src drizzle` → **no matches.**
  Migrations `drizzle/0000`, `0011` have no tenant column.
- **`companies` is the CUSTOMER directory, not the tenant** (`schema.ts:84-122`);
  `sites.companyId` (`:188`) and `contacts.homeCompanyId` (`:132`) scope to a customer org.
- **`app_settings` is a single global row `id="main"`** (`schema.ts:35-39`, pinned at
  `settings.ts:70,94,100`, seeded `seed-data.ts:150-155`).
- **All 21 doc tables are tenant-less by construction**, generic `docTable(name)` gives
  `id, doc, rev, seq, updatedAt, receivedAt, review, deleted` (`doc-tables.ts:30-52`); instances
  `:55-75`; registry `DOC_TABLES:77-99`. Plus 8 relational tables (`users:16`,
  `app_settings:35`, `gmail_connections:51`, `companies:84`, `contacts:124`,
  `contact_emails:157`, `contact_phones:172`, `sites:184`) and the globals `blobs:136`,
  `notif_prefs:143`, `geo_cache:150`.
- **Blast radius if pursued:** every doc table's PK + the `listDocs`/`upsertDoc`/`clearCollection`
  seam (`doc-store.ts`), the 8 relational tables, `app_settings` (row-per-org), the rate blob
  singletons, the `seq`-based sync cursors (`api/sync/pull|push/route.ts`), session→org
  resolution (`src/lib/session.ts`), Gmail connections keyed
  `personal:<userId>`/`sales`/`installs`/`info` (`schema.ts:51-65`), portal grants
  (`portal.ts:15-45`), and Blob pathnames (`blob.ts:26-37`).

**Recommendation for Jeff before any code:** decide the *ambition level* first, 
(a) **cosmetic/config white-label** (branding, terminology, rules already in AppSettings, 
mostly free today), (b) **one-org-per-deployment** (separate DB per customer; no schema change,
an ops problem), or (c) **true multi-tenant single DB** (the full blast radius above). These are
wildly different costs and (b) may buy most of the value now. Also note the doc-store carries a
`seq`-based sync protocol and an offline PWA outbox, which makes (c) harder than a normal
Postgres app.

**Status:** OPEN: strategic. Do not start without an answer to the a/b/c question.

---

## 58. Google Drive integration for venues + file access through the customer portal, OPEN

**Area:** `sites.driveFolderId` (`src/db/schema.ts:206-207`), `src/lib/gmail/config.ts`,
`src/lib/google/`, `src/lib/blob.ts`, `src/app/(app)/venues/`, `src/app/portal/`
**Reported:** 2026-07-27

**Ask (Jeff):** *"I also need to have a Google Drive integration for venues to sync and link their
files to, so that way we can store configuration and other files on Google Drive and then
customers can access those files through their customer portal."*

**Recon (2026-07-27):**
- **The hook already exists as a dead column:** `sites.driveFolderId`
  (`schema.ts:206-207`, comment *"Placeholder for the later Drive integration (§4.4), free
  now"*). **Referenced nowhere else.**
- **No file attachment on venues or customers today**, `src/app/(app)/venues/` is just
  `page.tsx` + `[id]/page.tsx`; grep for `attachment|upload|dataUrl` under `venues/`,
  `companies/`, `customers/` → no matches.
- **The storage + auth pattern to copy (D116, `DECISIONS.md:1776`, howto §9):**
  `src/lib/blob.ts:1-67` (env-gated on `BLOB_READ_WRITE_TOKEN`, `putBlob` writes
  `access:"private"` `:26-37`, `getBlobStream` `:40-45`) behind an authenticated proxy, two
  live instances, `api/grid-sheets/[id]/route.ts:1-21` (Grid plan sheets) and
  `api/part-datasheet/[id]/route.ts:16-35` (catalog datasheets), both `requireUser()` then stream.
- **Google surface to extend:** one shared OAuth client (`AUTH_GOOGLE_ID/SECRET` reused for SSO
  and Gmail, `gmail/config.ts:1-18`); scopes `GMAIL_SCOPES:27-32`, `GMAIL_MODIFY_SCOPE:36`,
  `CALENDAR_SCOPE:44` (opt-in per mailbox, `hasCalendarScope:47`); tokens in `gmail_connections`
  (`schema.ts:51-65`); flows `api/gmail/connect|callback|sync`. **No Drive scope, no Drive
  client**: adding one means a re-consent for every connected mailbox.
- **The portal has no file surface at all.** `src/app/portal/*` shows published quotes, self-serve
  estimates, open requests, renewals, venues on file (`portal/page.tsx:562`) and can accept a
  quote (`:462-479`). Grep for `download|pdf|attachment|print` under `src/app/portal/**` → **no
  matches.** Grants are per-person tokens hard-scoped to `customerId` (`src/lib/portal.ts:1-45`)
, that scoping is the natural authorization boundary for venue files.

**Open questions for Jeff:** one Drive folder per **site/venue** (as the dead column implies) or
per **company**? Whose Drive, a Peak-owned company Drive with per-venue folders, or the
customer's own Drive? **Sync or link only?** (Linking = store the folder/file id and proxy a
signed link; syncing = mirroring, permissions, conflict handling, much bigger.) And should
portal file access reuse the existing authenticated-proxy pattern rather than exposing Drive
sharing links directly (recommended, otherwise Drive ACLs become the security boundary).

**Status:** OPEN: logged only, no code.

---

## 59. Real data in the database, begin the migration off demo seeds, JEFF ASKED TO BEGIN

**Area:** `src/db/seed-data.ts`, `src/app/(app)/import/`, catalog import scripts,
`docs/MASTER-HOWTO.md` §7
**Reported:** 2026-07-27

**Ask (Jeff):** *"I need more demo data, or we need to implement actual data into the database,
can we begin this process. I think we are getting to the point where we should do this."*
**Note: this is the one item in the 2026-07-27 batch where Jeff asked to START, not just log.**

**Recon (2026-07-27): where things actually stand:**
- **Demo seeding:** `DEMO_SEEDS` covers **11 collections** (`seed-data.ts:95-107`: customers,
  catalog_parts, quotes, leads, surveys, comms, flame_jobs, repair_jobs, inspections, projects,
  designs); `seedDemoCollections():109-120` seeds only when a collection is empty; trigger
  `seedIfEmpty():140-167`: **demo ON by default with no `DATABASE_URL` (local dev), hosted
  starts clean** (`:148`).
- **Go-live reset exists:** `clearDemoData()` (`seed-data.ts:126-138`) hard-deletes the 11
  collections and **keeps** users, app_settings, rate blobs, Gmail connections. UI: Settings →
  Beta, typed `CLEAR` (`settings-client.tsx:274-278,1211-1217`).
- **Import hub:** `/import` with **8 CSV types** (`import/registry.ts`, customers:32, leads:55,
  flametests:78, inspections:100, surveys:122, team:144, quotes:161, projects:179), plus
  export + template CSV (`:511,520`).
- **Documented path:** `MASTER-HOWTO.md` §7 (`:187`), dedupe-key table (`:211-221`), **go-live
  sequence** (`:227-244`) and cutover checklist (`:247-261`). Scripts: `npm run db:export`,
  `db:convert-identity`, `audit:daylite`, `pull:daylite`, `import:daylite` (`package.json:14-19`).
- **What is already REAL:** the **catalog**. D117 (`DECISIONS.md:1803-1838`, 2026-07-24) imported
  **14,674 parts across ~60 brands** from the dealer sheets (5,206 rows flagged "verify price"),
  on top of the earlier 10,729-part import. **BUT `DECISIONS.md:1836-1838` says "Local dev only
  so far": production has NOT had this run.**
- **What is NOT real:** Daylite is **tooling only**, `scripts/pull-daylite.ts` (needs
  `DAYLITE_TOKEN`) and `scripts/import-daylite.ts` (**dry-run by default, `--commit` required**,
  commit `cd7b9e6`). **No DECISIONS/PUNCHLIST entry records an actual `--commit` run.** Identity
  tables (`companies`/`contacts`/`sites`) hold **converted demo** data, D85's reconciliation
  reports 6 companies / 8 sites / 8 contacts, which is exactly `customersSeed`. Quotes, leads,
  surveys, comms, flame/repair/inspections, projects, designs are all demo. Users are seeded
  fixtures (the real 6-person roster is hardcoded at `seed-data.ts:26-33`, emails derived by
  `emailFor()`, D118).
- `scripts/starter-import-data.json` + `docs/catalog/STARTER-SET-2026-07-DRAFT.md`, the curated
  starter catalog subset from #39, **still awaiting Jeff's review** (that gate is unchanged).

**Questions that must be answered before anything is written to a database:**
1. **Which environment**: local dev, or the live `peak-app-six.vercel.app` deployment? (These
   have diverged: prod likely has neither the 14,674-part catalog nor demo data.)
2. **Demo-plus or go-live?** Jeff's phrasing offers both. Richer demo seeds are cheap and
   reversible; go-live means pressing Clear demo data and living with real records.
3. **What real source files exist today?** `MASTER-QUESTIONS.md` §I has been waiting on these.
   Daylite export (customers/leads/opportunities)? A real project/quote history? Team roster?
4. **Was `import:daylite -- --commit` ever run**, and is the Daylite audit checklist
   (`docs/superpowers/specs/daylite-export-audit-checklist.md`) complete?
5. **Back up first**, `npm run db:export` is the documented first step of the cutover.

**Jeff's answers, 2026-07-27:** (1) target = **the live deployment**. (2) **Inventory first,
then decide** demo-plus vs go-live. (3) [#57 parked as direction.]

**BUILT 2026-07-27: `scripts/inventory.ts` + `npm run db:inventory` (READ ONLY).** Step 0 of
the §7 sequence. Writes nothing, migrates nothing, seeds nothing (with `DATABASE_URL` set,
`getDb()` skips the dev auto-seed branch, `src/db/index.ts:70`). Prints per-collection live /
deleted / demo / real counts (demo = id overlap with `src/db/seeds/*`, the same fixtures
`clearDemoData()` wipes), catalog category breakdown, identity + config table counts, and the
`seedDemo` flag. **No secrets are read or echoed**, blob key names only, never payloads or
tokens. Loads `.env.local` by hand (the `backfill-blob-sheets.ts` pattern) so the Neon URL can
live in the gitignored env file instead of a command line. Typecheck clean.

**First run: LOCAL dev, 2026-07-27** (prod run still pending the connection string):
- 119 live rows. **10 of the 11 demo collections are still 100% demo**; `quotes` is **mixed
  (7 demo / 6 real)** and `leads` is **mixed (11 demo / 2 real)**.
- **`catalog_parts` = 29 rows, ALL demo (19 Labor + 10 Fabric).** The D117 dealer import
  (14,674 parts) is **GONE from local dev**, consistent with the 2026-07-26 dev-DB reseed
  after the 4th PGlite corruption. So *neither* environment currently holds the imported
  catalog; that import has to be re-run wherever it is wanted.
- `consulting_engagements` 3 real, `tasks` 11 real, 8 collections empty. `seedDemo = true`.
- Fabric IS present locally with 6 usable `oz` rows, so **#50 must be reproduced against the
  environment Jeff actually saw it on** (very likely prod, where Fabric will be 0).
- **Safety finding for the go-live step:** `clearDemoData()` wipes **whole collections**, not
  demo rows selectively: on the current local DB it would destroy 6 real quotes and 2 real
  leads along with the fixtures. The mixed collections must be exported (or the real rows
  re-imported) before anyone presses it, in any environment.

**Status:** OPEN: inventory tool built and proven locally. **Next: run
`npm run db:inventory` against the live Neon database** (Jeff adds `DATABASE_URL` to
`.env.local`, or runs it himself with the URL inline), then decide demo-plus vs go-live from
the numbers. Back up with `npm run db:export` before any write.

---

## IDEA (not a punch-list item) — Consulting as a project type — BUILT (D90)

**Status: BUILT 2026-07-19 (D90).** Jeff defined Consulting in the 2026-07-19 brainstorming
session; the approved design is `docs/superpowers/specs/2026-07-19-consulting-module-design.md`
and the build is D90: own top-level module (NOT Design Studio), `consulting` quote type +
lightweight builder, `ConsultingEngagement` records (`CE-####`), phases with internal review
gates in the Reviews queue, milestones feeding the Reports billing forecast, meeting/decision/
submittal tracking, document attachments, site-visit links, own timeline (never the main Gantt),
and proposal + spec-package generators in /templates. This also closes item 13-D: consulting
quotes are excluded from the projects sync alongside flame tests. The original idea text is
kept below for history.

**Raised:** 2026-07-19. Jeff was explicit this is *"more of an idea than punch list"*.

**Jeff's definition sketch (2026-07-19, answering item 13 D):** consulting is **design work the
company gets paid to commit to**. Compared with ordinary design/estimating it requires more
paperwork and much more review, but it ultimately has a real path moving forward. **Tabled until
he can explain it in full — queued as a topic for the next brainstorming session** (together with
the design-around plan for the four AI features, see item 4).

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
