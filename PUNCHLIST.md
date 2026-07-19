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
- **Open question for Jeff:** want a faster/slower background cadence, or server-side
  sync (cron on Vercel / Gmail push) so Peak stays fresh even with no tab open? Current
  build only syncs while someone has the inbox open. Also: Peak→Gmail archive push
  (archiving in Peak archives in Gmail) needs the `gmail.modify` scope + re-consenting
  every mailbox — deliberately not done; say the word if you want it.

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

**Status:** OPEN — blocked on decisions A–I (A–D from Jeff's ask, E–I found in code)

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
in `src/`. One copy judgment to sign off: the Flame Tests renewal button now reads
**"AI draft"** instead of "Draft ✨" (bare "Draft" was ambiguous next to the ✉ one-click
flow) — say the word if you want plain "Draft". Templates/letters were scanned: clean.

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
