# Address verification + automatic drive time — design

Date: 2026-10-09 · Status: approved in brainstorm, awaiting spec review ·
Punch #: assigned at merge (recompute from origin/main — #323 is taken on
`feat/323-krisp-meetings`, #321 on `feat/321-conduit-riser`).

First of four scheduling specs from Jeff's "App ideas" list (see
[Follow-on specs](#follow-on-specs)). This one is the foundation: site-visit
scheduling and the auto task calendar both plan around drive blocks, and a
drive block is only allowed from a verified address.

## Goals

- Every address the scheduler touches is **verified, needs-check or
  unresolved** — and only a verified one gets drive time.
- Each rep's day gets drive blocks chained from base → stop → stop → base,
  with a buffer the rep sets once.
- An address that can't be resolved is **flagged, never guessed** — no
  straight-line fallback is ever shown as a drive time.
- Fixing a bad address once (retype, or drop a pin) fixes it everywhere that
  address text appears again.

## Non-goals

- Grouping visits by area, visit-vs-visit conflicts (spec 2).
- Moving tasks around fixed blocks (spec 3).
- Importing addresses from the outside bid service (own spec, once the
  source format is known).
- Live traffic. Free OSRM routing (normal speeds) stays; the buffer covers
  slack.
- Any AI (D89): all matching is deterministic.

## Current state (origin/main ac5e6751)

- `sites` has `address/city/state/zip`, `lat/lng` (text), `travelMiles/
  travelMin` overrides. No stored quality flag; `precisionOf()`
  (`src/lib/geo-backfill.ts:290`) computes `building | city` on the fly.
  Geocode failures are typed but not stored. Unresolved = null lat/lng.
- Geocoder: Nominatim (`src/lib/geo.ts`); routes: public OSRM, cached in
  `geo_cache`; `estimate()` falls back to straight-line (`TravelSource
  auto`).
- Base: `settings.offices` + per-user `officeId` ("Based out of");
  `src/lib/travel-origin.ts`.
- Site visits (`src/lib/stores/site-visits.ts`): `locationId` (venue) or
  free-text `address`, `startAt/endAt`, `assignedTo` (a name), stage.
  `googleEventId` reserved, unused; the visit reaches Google as an emailed
  `.ics` (`sv-<id>@peak-app`), which the agenda de-dupes.
- Agenda (`src/lib/agenda.ts`) reads each rep's Google Calendar.
- D144 `addTravelBlock` (`src/app/(app)/calendar-actions.ts`) adds a
  "Drive to X (auto)" event on create only, gated by a looks-like-an-address
  heuristic, with a straight-line fallback — the guessing this spec removes.

## Part 1 — Address verification

### States

| State | Meaning | Drive time? |
|---|---|---|
| `verified` | Building-level geocode, or a hand-placed pin | Yes |
| `needs_check` | Geocoder matched city/zip only | No — flagged |
| `unresolved` | No match, or no address | No — flagged |

### Venues

New `sites` columns: `geo_status`, `geo_source` (`geocode | pin |
override`), `geo_verified_by` (user id), `geo_verified_at` (epoch-ms).

- A building-level geocode auto-verifies (`geo_source = geocode`). City/zip
  → `needs_check`. No hit → `unresolved`.
- One-time backfill from current data: building-level lat/lng → `verified`,
  city-level → `needs_check`, null → `unresolved`. Idempotent.
- Editing a venue's address resets it through verification. A `pin` is
  never overwritten by the geocoder (only a deliberate re-fix replaces it).

### Place book

New table for every non-venue address — site visits without a venue, lead
addresses, Google event locations. One row per normalized address key:

- `key` (unique): lowercase, whitespace collapsed, punctuation stripped.
- `label` (original text as first seen), `lat`, `lng`, `status`, `source`
  (`geocode | pin`), `verified_by`, `verified_at`, `updated_at`.

Resolution order for free text: place book (exact key) → geocoder; a
building-level hit is written back as `verified`; anything weaker is stored
with its status so the worklist can show it. **Exact normalized-key match
only** — no fuzzy or name-based matching.

### Site visits

Linked to a venue → the venue's state. Otherwise → its own `address` text
through the place book.

### Fixing an address

Fix dialog: (1) retype the address and re-run the geocoder; (2) if still not
building-level, drop/drag a pin on a map. A dropped pin saves `verified`,
`source = pin`, with who/when. A venue fix writes the venue; anything else
writes the place book, so the same text never flags again.

### Where flags show

- **On the visit + its calendar block**: "Address not verified — no drive
  time" with a **Fix** button.
- **Addresses to verify** worklist: Settings → Data's unlocated-venues list
  grows into a saved worklist across venues, upcoming site visits and leads
  (status-filterable).
- **When scheduling**: a warning while booking a visit at an unverified
  address. Never blocks.

## Part 2 — The drive chain

### Engine

Pure module `src/lib/drive-plan/` — `planDay(input) → legs[]`, no IO. A
loader assembles input; a sync step (Part 3) writes results out.

Input: the rep's stops for one Chicago calendar day, base office (or none),
buffer minutes, route minutes per (from, to) pair (looked up by the loader
from the OSRM cache / live OSRM), the previous day's stay-over flag + last
stop, and this day's stay-over flag.

### Stops

- The rep's scheduled site visits (`assignedTo` = rep's name — the app's name convention — with
  `startAt` set; stage `scheduled`).
- The rep's Google Calendar events with a physical location.

Not stops: all-day events; events with no location; locations that are a URL
or mention Zoom/Teams/Meet/Webex or are a phone number; events the rep
declined. A visit's `.ics` copy on Google (`sv-<id>@peak-app`) is the same
stop, counted once.

### Legs

- Sorted by start: **base → first stop**, **stop → next stop**, **last stop
  → base**.
- Minutes = OSRM route minutes + the rep's buffer.
- A leg with an unverified end (either side) is flagged with no minutes.
  An unverified event location breaks the chain: the legs into and out of it
  are both flagged.
- No base set → first and last legs flagged "No base set".
- Placement: a drive-to block ends at the stop's start; the drive-back block
  starts at the last stop's end.
- **Tight**: a drive-to block that would start before the previous stop ends
  is flagged ("Tight — needs 1h 40m, has 1h 05m"). Nothing is moved.

### Buffer

New per-user field in Account (fixed minutes), with an admin-set company
default used until the rep sets their own.

### Staying over

Per-rep, per-date flag toggled from the calendar day ("Staying near last
stop"). On a stay-over day: no drive-back leg. The next day's first leg
starts from that day's last stop (if verified; else flagged).

### Display

Drive blocks render as their own blocks on `/calendar` and the agenda; each
day header shows total drive time. Flagged legs render as a flag, not a
block.

## Part 3 — Google sync, refresh, failures

### Sync

- App-written drive events carry a private extended property `peakDrive`
  plus a leg key (rep + date + from-stop + to-stop).
- A sync computes the desired legs for the rep over **today → +14 days**
  and inserts / updates / deletes **only tagged events**. Never touches
  anything the rep made.
- Flagged legs get no Google event (no minutes to place).
- A rep with no connected Google Calendar: app-only.

### Triggers

- Visit created, moved, reassigned, unscheduled or deleted → re-sync affected days for
  affected reps.
- An address verified → re-sync upcoming legs touching it.
- `/calendar` or agenda load when the rep's last sync is > 10 min old
  (catches edits made directly in Google).
- The daily cron (`/api/gmail/sync`, 7am Central) re-syncs every rep — own
  try/catch + time budget per rep, like the other riders.

### Retiring D144

- The create flow stops calling `addTravelBlock`.
- On each rep's first sync, upcoming events titled `Drive to … (auto)` whose
  description starts `Auto-added travel time` are deleted. Past ones are
  left.

### Failures

- OSRM unavailable → leg shows "Drive time unavailable — retrying", not
  written to Google. No straight-line fallback.
- Google write fails → logged, retried on next sync; never blocks saving a
  visit.

## Data / migration

One migration: the four `sites` columns + the place-book table, plus the
idempotent venue backfill. Stay-over flags and the per-user buffer live in
existing user/settings storage unless the plan finds a reason otherwise.
Migration number set at merge (0036 is taken on the #323 branch).

## Testing (`test:specs`)

- Address-key normalizer; state transitions; venue backfill mapping; pin is
  never overwritten by geocode.
- `planDay`: chaining; no base; unverified end; unverified event breaks the
  chain; tight leg; stay-over (both days); declined / video / all-day
  events skipped; `.ics` copy counted once; buffer applied.
- Google sync diff (pure): insert/update/delete only tagged events.
- D144 legacy-block matcher: matches only the exact title + description
  shape, upcoming only.

## Follow-on specs

Kept here so nothing from the original list is lost. Each gets its own
brainstorm → spec → plan.

2. **Site-visit scheduling** — written:
   `2026-10-09-site-visit-scheduling-design.md`. Adds visit attendees; a
   visit becomes a stop on the lead's **and every attendee's** day.
3. **Auto task calendar** (Motion-style, low upkeep) — inputs only due date
   + priority tier; move only unstarted work; no hand re-weighting; flex
   around visits + drive blocks. Open: how task length is known (default vs
   size tier); Jeff's Motion brainstorm rules (to paste in).
4. **Morning triage** — one ranked list (~10, "see more") from email, Krisp
   calls (needs #323 merged) and tasks; each row shows source + why it's
   ranked there; call items show the transcript line they came from
   (deterministic text match, "source line not found" otherwise). Open: one
   rep or whole team; what counts as a "waiting" email (same day / 1 / 2
   days); midday refresh (free if computed on page load); Motion rules.
