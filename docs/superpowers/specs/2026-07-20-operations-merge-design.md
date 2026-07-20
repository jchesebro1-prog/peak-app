# Operations — Merging Installs and Service

**Date:** 2026-07-20
**Status:** Approved by Jeff (brainstorming session 2026-07-20)
**Scope:** Merge the Installs and Service groups into **Operations**, and make
Schedule and Field Work show all four work types instead of projects only.

**Companion specs (the nav restructure):**
`2026-07-20-design-module-consolidation-design.md`,
`2026-07-20-home-tabbed-hub-design.md`,
`2026-07-20-general-dissolution-design.md`,
`2026-07-20-venues-directory-design.md`.

## Result

| Stage | Top-level items |
|-------|-----------------|
| Start of the restructure | 10 |
| After Design consolidation | 9 |
| After Home tabbed hub | 6 |
| After General dissolved | 5 |
| **After this spec** | **4** — Home, Design, Sales, Operations |

Operations children: Projects, Schedule, Field Work, Flame Tests, Rigging
Inspections, Repairs.

## Why this is not just a nav change

`/schedule` and `/field-work` import **only** from `@/lib/stores/projects`
(verified 2026-07-20). They cannot see flame tests, inspections, or repairs.

Grouping Schedule next to Flame Tests without changing that would make a
promise the app does not keep: anyone would expect a scheduled flame test to
appear on the schedule, and it would not. **The nav merge is only honest if
the aggregation happens with it.**

Meanwhile each service type already carries its own scheduler
(`/flame-tests/scheduling`, `/repairs/scheduling`, the inspections equivalent)
plus `/flame-tests/today` as a technician day-view. There is no single place to
see who is working where this week.

## Unified Schedule

`/schedule` aggregates four sources onto one calendar:

| Source | Date field | Assignment field |
|--------|-----------|------------------|
| Projects | epoch-ms (crew bookings / mobilizations) | crew |
| Flame jobs | `scheduledDate`, ISO `'YYYY-MM-DD'` or `''` | `assignedTo` |
| Inspections | `scheduledDate`, ISO `'YYYY-MM-DD'` or `''` | `assignedTo` |
| Repair jobs | `scheduledDate`, ISO `'YYYY-MM-DD'` or `''` | `assignedTo` |

Entries are colour-coded by work type, show the assigned person or crew, and
link to their own record.

**Scheduling still happens on each type's own screen.** Those screens know
their type-specific fields and keep them; this spec adds the read view only.
That is the whole payoff — "who is where this week, across everything" — at a
fraction of the cost of absorbing four scheduling models.

## Unified Field Work

`/field-work` becomes the single day-view: today's work for the signed-in
person across all four types, each row deep-linking into its existing capture
screen. `/flame-tests/today` redirects there.

## The integration detail that will bite

The three service stores are **consistent with each other** and **differ from
projects** (verified 2026-07-20): all three carry `assignedTo: string` and
`scheduledDate: string` holding ISO `'YYYY-MM-DD'`, or `''` when unset —
ported faithfully from the prototype's date inputs. Projects use epoch-ms.

Normalization happens **once, in the aggregation layer**, and must handle:

- **`''` means unset.** Naive parsing yields `Invalid Date` or epoch zero,
  which would either crash the calendar or park every unscheduled service job
  on 1 Jan 1970. Unset entries are excluded from the calendar, not defaulted.
- **Timezone.** `new Date('2026-07-20')` parses as UTC midnight and can render
  as the nineteenth in a western timezone. Parse ISO dates as local dates
  (the existing `fmtShort` helpers in the service stores already face this —
  follow whatever they do so the schedule agrees with the job's own screen).
- Unassigned jobs (`assignedTo: ''`) still appear, in an "unassigned" lane —
  they are precisely what a scheduler needs to see.

## What this does not change

No data model changes, no migrations, no change to how any job type works.
Projects keep their stages; service jobs keep their renewal cycles. Service and
install revenue stay separate in Reports, because they genuinely are different
businesses — this merges how work is *found*, not how it is *accounted*.

## Risk

Moderate, concentrated in the date normalization above. Everything else is
navigation and read-only aggregation.

Second risk: the Schedule screen becomes busier. If four types on one calendar
is noisy in real use, the fix is a type filter, not a redesign.

## Testing

- Each of the four sources appears on the **correct day**, including a service
  job whose ISO date would shift under naive UTC parsing.
- Jobs with `scheduledDate: ''` are excluded rather than landing on epoch zero.
- Unassigned jobs appear in the unassigned lane.
- Per-type schedulers still work untouched.
- Field Work shows a mixed day across all four types; `/flame-tests/today`
  redirects.
- Operations nav lights for all six children.
- `npm run test:specs` stays green.

## Out of scope

Scheduling or rescheduling from the unified view (a natural follow-on),
retiring the per-type schedulers, and any change to Reports.
