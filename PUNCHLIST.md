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
(4) add the unspecified-vs-zero state and rollup guard (P2).

**Status:** OPEN — approach agreed, P1 needs a decision before build
