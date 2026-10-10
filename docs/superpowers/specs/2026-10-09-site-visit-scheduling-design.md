# Site-visit scheduling — design

Date: 2026-10-09 · Status: approved in brainstorm, awaiting spec review ·
Punch #: assigned at merge (recompute from origin/main).

Spec 2 of 4 from Jeff's "App ideas" list. **Depends on spec 1**
(`2026-10-09-address-verification-drive-time-design.md`): verified
addresses, the `planDay` drive chain, and the per-person buffer.

## Goals

- Site visits are **fixed appointments** — a start–end, a location, one lead
  rep plus optional Peak attendees. Nothing in the app ever moves one.
- While booking, the rep sees **nearby days** — days they're already in the
  area — so visits in the same area land on the same day when possible.
- Conflicts are **flagged, never silently resolved**, and never block
  booking.

## Non-goals

- Auto-moving visits, or auto-picking a time.
- Clustering the unscheduled request backlog into day plans.
- A bell group for conflicts.
- Arrival windows ("arrive 9–11"); a visit stays a fixed start–end.
- The auto task calendar (spec 3) — it must schedule around visits, never
  move them.

## Current state (origin/main ac5e6751)

- `SiteVisit` (`src/lib/stores/site-visits.ts`, doc collection
  `site_visits`, `SV-####`): `assignedTo` (one name), `startAt/endAt`,
  `locationId`/`address`, stage `requested → open → claimed → scheduled →
  done`, `invite` stamp. `scheduleVisit(id, startAt, endAt)`.
- Scheduling UI: the visit-requests list
  (`src/app/(app)/venue-assessments/visit-requests.tsx`, two
  `datetime-local` inputs → "Schedule + invite",
  `visit-actions.ts:scheduleVisitAction`) and the Inbox create path
  (`src/app/(app)/inbox/site-visit-actions.ts`).
- Invite: an emailed `.ics` to the assignee (`src/lib/visit-invite.ts`),
  UID `sv-<id>@peak-app`, which the agenda de-dupes.

## Part 1 — Attendees, invites, settings

### Attendees

- `assignedTo` stays the **lead rep**.
- New `attendees: string[]` — additional Peak people, names (app
  convention). Normalized on read (`?? []`); no migration (doc collection).
- The visit form gains a people multi-picker; the lead is excluded from the
  attendee list.
- **Spec 1 change:** a visit is a stop on the day of its lead **and every
  attendee** — each person gets their own drive chain.

### Invites

- Every attendee (lead included) gets the `.ics`.
- Adding a person sends them the invite; removing a person sends them a
  cancellation (`METHOD:CANCEL`, same UID); moving the visit sends an update
  to all.
- UID stays `sv-<id>@peak-app` so the agenda still counts it once.
- `invite` stamp grows to record per-recipient sends (shape decided in the
  plan; existing single-recipient stamps read as one entry).

### Settings

| Setting | Default | Who |
|---|---|---|
| Work hours | Mon–Fri 8:00–5:00 | Admin default, per-person override in Account |
| Same-area drive time | 45 min | Admin |
| Daily drive limit (buffer included) | 5 h | Admin |
| Nearby-day look-ahead | 21 days | Admin |

(The drive buffer itself is spec 1's.)

## Part 2 — Planner, booking screen, flags

### Engine

Pure module `src/lib/visit-plan/`, built on spec 1's `planDay`. Computed
live (booking screen, calendar load); **nothing stored**.

#### `checkVisit(candidate, attendeeDays) → conflicts per attendee`

- **Double-booked** — the visit or its drive-to block overlaps another
  visit or an accepted, timed Google event for that attendee (all-day events
  ignored, as in spec 1).
- **Tight drive** — spec 1's tight leg, surfaced before booking.
- **Outside work hours** — the visit or any of its drives (drive back
  included) falls outside the person's hours, or on a non-work day.
- **Too much driving** — the day's total drive (buffer included) with this
  visit exceeds the limit; shown as "5 h 40 m of 5 h".
- **Unverified address** is not a conflict: spec 1's flag shows, and the
  check runs without drive blocks and says "checked without drive time".

#### `suggestDays(candidate, leadDays) → up to 5 days`

- Days in the look-ahead where the **lead** already has a verified stop
  within the same-area drive time of the candidate's location.
- Ranked by nearest drive minutes, then soonest.
- Each row: date, nearest stop + minutes, the lead's busy times ("Tue Oct 14
  · 18 min from Lone Pine Elementary · busy 9–11:30"), and each other
  attendee's status that day (free / conflict).
- A straight-line distance may pre-filter far-away stops before routing;
  it is **never shown** as a drive time.
- Candidate address not verified → the strip reads "Verify the address to
  see nearby days".

### Booking screen

The visit-requests scheduler, the Inbox scheduling dialog, and editing an
existing visit each gain:

- the attendee picker;
- a **Nearby days** strip — one click fills the date; the rep still picks
  the time;
- a live **conflicts panel** that refreshes (debounced server action) as
  times or people change.

Nothing blocks **Schedule**.

### Calendar + visit

A conflict badge on the visit and its block on `/calendar` and the agenda,
computed on load.

### Failures

- An attendee's Google Calendar can't be read → "Couldn't check Dana's
  calendar" — never presented as "no conflicts".
- OSRM unavailable → "Nearby days unavailable".

## Testing (`test:specs`)

- Each conflict type, one and several attendees; overlap caused only by the
  drive block; work hours on a non-work day; drive limit with buffer.
- `suggestDays`: ranking, 5-day cap, unverified-address path, other-attendee
  status, straight-line pre-filter never surfaces as minutes.
- Invite add / remove (cancel) / move (update) per recipient; UID unchanged.
- Attendees normalized on read for pre-existing visits.
