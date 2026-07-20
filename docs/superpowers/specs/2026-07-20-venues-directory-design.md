# Venues Directory — Design

**Date:** 2026-07-20
**Status:** Approved by Jeff (brainstorming session 2026-07-20)
**Scope:** A Venues directory and venue detail page, completing the D85
identity core in the UI. A real feature, not a nav move.

**Companion spec:** `2026-07-20-general-dissolution-design.md` — Field Survey
moves beside Venues when this lands.

## Problem

The D85 identity core has three tables — `companies`, `contacts`, `sites` —
and only the first two have screens. **Sites have no home in the UI at all.**

That matters because venues are how this business actually thinks. A district
is not one place: it is a high-school auditorium, a middle-school cafetorium,
a black box. Work attaches to the venue, not the district. Today you cannot
answer *"what have we done at Bay Port's auditorium?"* anywhere in the app —
you would check quotes, projects, flame tests, inspections, and surveys
separately and assemble it yourself.

## What a venue can aggregate

`locationId` / `siteIds` are already referenced by eight stores (verified
2026-07-20): `quotes`, `projects`, `flame-jobs`, `repair-jobs`, `site-visits`,
`leads`, `engagements`, `customers`. Inspections and surveys carry venue
references too.

So the data to build a venue history already exists and is already linked —
this spec adds the surface that reads it, not new relationships.

## Structure

**`/venues`** — directory list. Columns: venue name, owning company, city,
last activity. Search by venue or company name. Filter by company.

**`/venues/[id]`** — venue detail:

- **Header** — venue name, owning company (linked), full address, travel
  info if set, primary-site flag.
- **History** — one reverse-chronological timeline of everything attached to
  this venue: quotes, projects, engagements, flame tests, inspections,
  repairs, site visits, surveys. Each row links to its record.
- **Open work** — anything not closed, pulled to the top.
- **Contacts** — people at the owning company, from the identity core.

## The matching gotcha (read before implementing)

Sites carry `legacyLocId`, and documents store `locationId` values like
`loc1`. Per D85, the composed `CustomerLocation.id` returns `legacyLocId`
when present so that stored `locationId` values and `${customerId}|${locationId}`
composite keys keep matching.

**A venue lookup that matches only on `sites.id` will silently return an empty
history for every migrated venue.** Aggregation must resolve through the same
composite-key path the stores already use. This is the single most likely way
to build this feature and have it look like it works while showing nothing.

## Nav

Venues joins Sales beside Companies and People; Field Survey moves next to it
(per the General-dissolution spec). Sales becomes: Leads, Quotes, Reviews,
Companies, People, Venues, Field Survey.

That is seven children — noted as a watch item in the dissolution spec. If the
dropdown becomes hard to scan, the fix is a Directory group, at the cost of one
header slot.

## Risk

- **Read-only feature.** No new tables, no migrations, no writes. The worst
  realistic failure is an incomplete history, not damaged data.
- Performance: the history fans out across eight-plus collections. With
  current data volumes a straightforward parallel load is fine; if it becomes
  slow, the fix is a per-venue index, not a redesign.
- Venue editing (create/rename/re-address) is **out of scope** — sites are
  currently maintained through the company record and stay that way.

## Testing

- A venue with work across several stores shows every item, newest first.
- **A migrated venue whose documents use `legacyLocId` shows its history** —
  the explicit regression test for the matching gotcha above.
- A venue with no work shows an empty state rather than an error.
- Company link and per-record links navigate correctly.
- Directory search and company filter.

## Out of scope

Creating or editing venues, merging duplicate venues, venue-level reporting or
profitability, and maps.
