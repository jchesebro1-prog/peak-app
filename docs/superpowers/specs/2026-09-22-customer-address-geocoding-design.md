# Customer addresses + geocoding — travel time for the imported book

- **Date:** 2026-09-22
- **Punch:** #147
- **Decisions:** D175–D180 (allocated below)
- **Status:** design approved by Jeff 2026-09-22, awaiting implementation plan
- **Related:** `daylite-export-audit-checklist.md` (2026-07-21 audit), punch #114 /
  D146 (calendar travel block), punch #137 (import hub people/venues)

---

## 1. The problem

Travel time is blank for most of the customer book, and the travel numbers that
do appear are not real driving times. This breaks quote pricing, because travel
is priced into quotes at $/mile plus drive-time labor.

### 1.1 Why

`estimate()` (`src/lib/geo.ts`) resolves travel in a fixed priority chain:

> manual override → cached OSRM route → haversine-from-office → none

Every tier except the manual override needs **lat/lng on the venue**. No
coordinates, no travel time.

The Daylite import gave venues neither coordinates nor a street address —
because the export never had one. `~/Downloads/daylite-csv/Companies.csv` has
exactly these columns:

```
Category, Name, Phone Label 1, Phone 1, Email Label 1, Email 1,
URL, City, State/Province, Industry, Owner, Details
```

City and State/Province, and nothing else. `People.csv`, `Projects.csv` and
`Opportunities.csv` carry no address either. So
`scripts/import-daylite.ts:190` writing sites with only `city` + `state` was
not a bug in the importer — there was nothing else to take.

**Jeff has confirmed Daylite itself does hold the street addresses; the export
template used on 2026-07-22 simply omitted the address fields.**

### 1.2 The damage, measured

Against the real export (1,550 company rows):

| | count |
|---|---|
| Companies imported | **1,550** |
| With a city | 1,327 |
| With no city at all | 223 |
| With a **street address** | **0** |
| Resolvable to coordinates today | **396** |
| **Showing no travel time at all** | **1,154 (74%)** |

The 396 that resolve do so only by accident: `coordsOf()` falls back to
`geocode(city, state)`, a **hardcoded table of 19 Wisconsin cities** in
`geo.ts`. Milwaukee, Madison and Green Bay are in it. Reedsburg (47 customers),
Baraboo (36), Middleton (35), Sun Prairie (19), Verona (18), Portage,
Stoughton and Wisconsin Dells are not. Neither is `lacrosse, wi` (7 records),
because the table is keyed `la crosse, wi`.

Those 396 are **not** getting real routes either. The only code that ever calls
OSRM is `companies/actions.ts:138` — the **Route** button in the venue edit
modal. Nothing warms the route cache in bulk, so the best any imported customer
achieves today is `source: "auto"`: a straight-line distance multiplied by the
road factor, from a city centroid.

### 1.3 The systemic gap

The in-app Import hub (`src/app/(app)/import/registry.ts`) accepts
`address/city/state/zip` columns but has **no lat/lng column and never
geocodes**. Every address ever imported through it produced a venue with no
coordinates. Re-importing better addresses through the hub as it stands would
not fix travel time. This is a live bug independent of the Daylite backfill.

### 1.4 Audit gap worth recording

The 2026-07-21 Daylite export audit
(`daylite-export-audit-checklist.md`) examined relationships, link roles,
notes/activity, custom fields, keywords, attachments and row counts. It never
asked whether the export carried a **mailing address**. That omission is why
1,550 customers landed with no location. Future export audits must include an
explicit address/location column check.

---

## 2. Goals

1. Every customer venue that Daylite has an address for gets that street
   address, a precise lat/lng, and a **real OSRM driving route** from the quote
   origin — accurate enough to price a quote from.
2. Future imports cannot silently drop coordinates again.
3. A day-of site visit can hand the venue address to the phone's default maps
   app.

### Non-goals

- Re-pricing existing quotes. Reported on only (§6). Jeff decides per quote.
- Recovering street addresses for companies Daylite has none for. Out of scope;
  they are reported and left alone.
- Changing the `estimate()` priority chain, the travel rate model, or anything
  in Estimating Rules.
- Replacing the Nominatim/OSRM stack with a paid geocoder. The app is
  deliberately key-free for geo and stays that way.

---

## 3. Scope decision

**Everything with an address** (Jeff, 2026-09-22). All 1,550 company rows are
candidates, not only those that got a base venue — partners and vendors have
useful addresses too. Rows Daylite has no address for are reported and skipped.

This splits across two tables, because `import-daylite.ts:166` deliberately
skips partners when building venues, so a partner has a `companies` row and no
`sites` row:

| Table | Columns | Applies to |
|---|---|---|
| `companies` | `address`, `city`, `state`, `zip` (no lat/lng) | **every** matched company — this is the mailing address, and what letters and invoices want |
| `sites` | `address`, `city`, `state`, `zip`, `lat`, `lng` | only companies that already have a primary venue — this is what travel prices off |

A company with no `sites` row gets its **company address only** and is *not*
given a venue. Manufacturing venues for vendors would pollute the venue
directory, the schedulers and the service dashboards. Those rows are reported
as `company address only (no venue)`.

Travel time is a venue concept, so only the venue half affects pricing.

---

## 4. Stage 1 — `scripts/enrich-addresses.ts`

A non-destructive enrichment pass over the existing records. It does not
re-import; it fills in fields that are empty.

### 4.1 Input

A fresh `Companies.csv` exported from Daylite **with the address fields
included**.

Daylite's exact export header spellings are unknown at design time, so the
script accepts aliases and prints the mapping it detected before doing any
work:

| Field | Accepted headers (case-insensitive, first match wins) |
|---|---|
| street | `Address 1`, `Address`, `Street 1`, `Street`, `Address Line 1` |
| city | `City` |
| state | `State/Province`, `State`, `Province` |
| zip | `Postal Code`, `Zip`, `ZIP/Postal Code`, `Zip Code`, `Postcode` |

If no street column is detected, the script **fails hard** and prints the
actual header row. A silent fallback to city-level would reintroduce exactly
the bug being fixed.

**D175 — the enrichment input is a Daylite CSV re-export, matched by name.**
Rejected alternatives: the Daylite API (needs credentials and a new
integration for a one-time job) and hand-entry (1,550 rows).

### 4.2 Matching

The original import derives ids purely from the company name
(`scripts/import-daylite.ts:71-73`):

```js
norm = s => (s || "").trim().toLowerCase().replace(/\s+/g, " ")
hash = djb2 → base36
companyId = name => "co-" + hash(norm(name))
```

The primary venue is `st-<companyId>-1`. Both are pure functions of the company
name, so a fresh export matches the existing records exactly — no fuzzy
matching — for every company whose name is unchanged since 2026-07-22.

**These helpers are currently private to `scripts/import-daylite.ts`. They move
to a shared `scripts/daylite-ids.ts` that both the importer and the enrichment
script import.** Two copies would drift and the ids would silently stop lining
up — the failure mode would be a successful-looking run that enriched nothing.

**D176 — Daylite id helpers are extracted to one shared module.** Any future
Daylite tooling imports them rather than re-deriving.

### 4.3 Writes

Targeted statements, never `saveCompany`/`saveSite`:

```sql
-- every matched company
UPDATE companies SET address = ?, city = ?, state = ?, zip = ?, updated_at = ?
WHERE id = ?;

-- only where a primary venue already exists
UPDATE sites SET address = ?, city = ?, state = ?, zip = ?,
                 lat = ?, lng = ?, updated_at = ?
WHERE id = ?;
```

Both store seams have an insert path (`onConflictDoUpdate`), so a renamed
company would silently gain a brand-new empty company or venue instead of
raising an error. A direct `UPDATE` cannot create anything: a statement that
matches no row is **reported by name** and skipped — which is also how the
partner case in §3 surfaces as `company address only (no venue)` rather than as
a mystery.

Nothing else is touched — not the company record, not contacts, leads, quotes,
projects, portal grants, `venueKind`, `legacyLocId`, `locationName`, or any
work done in the app since July.

**D177 — enrichment uses targeted UPDATEs, never an upsert.** A company whose
Daylite name changed since the export is a reported exception, not a new
record; a company with no venue gets a mailing address and stays venue-less.

### 4.4 Conflict policy

| Situation | Behaviour |
|---|---|
| Record has no street address | Write Daylite's. |
| Record already has a street address | **Skip — the app wins.** Counted and reported. |
| `--overwrite` passed | Daylite wins instead, for every row. |
| Venue has manual `travelMiles`/`travelMin` | **Never touched**, at any flag. |

The Daylite export is from 2026-07-22; anything typed into the app is newer, so
the app is the system of record by default.

Manual travel overrides outrank everything in `estimate()`'s chain
(`source: "manual"`), which means those venues will **not** reprice no matter
what coordinates are stamped. The script reports the count explicitly so the
number is visible rather than a silent surprise.

**D178 — app-entered addresses beat the Daylite export; manual travel
overrides are never modified.**

### 4.5 Geocoding

Through the existing `geo.ts` `search()` seam (Nominatim), serialized at **1
request/second** per Nominatim's usage policy — roughly 29 minutes for 1,550
rows. The `User-Agent` `search()` already sets satisfies the policy's
identification requirement.

Query: `"<street>, <city>, <state> <zip>"`.

**Sanity gate.** A hit whose resolved state does not match the row's stated
state is **rejected and reported, not written**. A wrong geocode that silently
prices a quote wrong is the one outcome worth engineering against; a reported
miss costs a minute of manual correction through the existing address picker.

### 4.6 Route warming

A separate `--routes` phase calls `route(office, coords)` for each geocoded
venue, from the quote-default office (`quoteOrigin()`), populating the
`geo_cache` table.

This phase is what upgrades travel from `source: "auto"` (straight-line ×
road factor) to `source: "routed"` (real OSRM driving miles and minutes).
Without it the backfill produces accurate coordinates and still-estimated
travel. Also ~1 req/sec against the public OSRM instance, ~29 minutes.

**Prerequisite:** Settings → Locations must have an office carrying lat/lng
with one marked as the quote default, or `quoteOrigin()` returns nothing and
every venue still reads "—". The script **verifies this first and aborts with a
clear message** rather than running for an hour to no effect.

**D179 — the backfill warms the OSRM route cache as a distinct phase.**
Coordinates alone leave travel on the haversine tier.

### 4.7 Idempotence and resumability

Both phases skip work already done — a venue that already has coordinates is
not re-geocoded, a coordinate pair already in `geo_cache` is not re-routed.
Re-running after a crash or a network drop resumes rather than restarting.
Total run is roughly an hour across the two phases.

### 4.8 Safety

- Dry-run is the **default**; `--commit` writes.
- Uses the existing `resolveDbTarget()` + `requireHostedConfirmation()` gates,
  so a hosted write additionally demands `--yes`.
- `npm run db:export` backup before any hosted commit.
- Jeff runs `vercel env pull` himself; the script reads `DATABASE_URL` from
  `.env.local` via `loadEnvLocal()`. **The Neon credential is never pasted into
  a conversation and never printed.**
- All Vercel environments share the one Neon database, so this write is live to
  anyone using the app the moment it lands.

### 4.9 Report

Printed at the end of each phase, and written to a timestamped file:

```
matched / unmatched (listed by name)
companies enriched / venues enriched / company address only (no venue)
skipped: already addressed / skipped: no address in Daylite
geocoded / geocode failed (listed) / rejected by state gate (listed)
venues with manual travel overrides (will not reprice)
routes warmed / route failures
```

---

## 5. Stage 2 — close the gap so it cannot recur

### 5.1 Shared library

The backfill logic lives in **`src/lib/geo-backfill.ts`**, not in the script:

```ts
backfillVenueCoords({ limit, dryRun }): Promise<BackfillReport>
warmRoutes({ limit }): Promise<WarmReport>
```

Both bounded, idempotent and resumable. The script becomes a thin CLI wrapper.

### 5.2 Admin action

The same functions back a **"Geocode addresses"** admin action (Settings →
Beta, beside the existing go-live reset). It processes a bounded batch per
invocation and reports how many remain, which sidesteps the server-action
timeout that makes geocoding 1,550 rows inline impossible.

One mechanism serves both the one-time backfill and every future import.

**D180 — geocoding is a bounded, resumable batch job shared by the CLI and the
admin UI**, not an inline step in an import commit. 1,550 lookups at 1 req/sec
cannot complete inside a server action.

### 5.3 Importer fixes

- `scripts/import-daylite.ts` reads the address columns it currently ignores
  (same alias table as §4.1) and writes them onto the base venue.
- The Import hub (`registry.ts`) gains `lat`/`lng` columns in the customers and
  venues templates, and a post-commit geocode enqueue for rows that arrived
  with an address but no coordinates.

---

## 6. Existing quotes

Quotes already priced against missing or city-centroid travel are **wrong**,
and the backfill does not retroactively fix them. A quote built against a venue
with no coordinates either priced travel at zero or off a city centroid.

**Decision (Jeff, 2026-09-22): report only.** The script lists open quotes
whose travel inputs would change and by how much. No automatic re-pricing —
sent quotes are customer-facing documents and re-pricing them is a business
decision, not a data-migration side effect.

---

## 7. Stage 3 — Open in Maps

A link on the venue record, the site-visit view and the field-work day view
that hands the venue address to the OS default maps app:

- Apple platforms → `https://maps.apple.com/?address=<encoded>`
- Everything else → `https://www.google.com/maps/search/?api=1&query=<encoded>`

Hidden when the venue has no street address. Depends on Stage 1 to be useful.

---

## 8. What this fixes downstream

- **Quote pricing** — travel miles and drive-time labor price off a real route
  instead of nothing or a city centroid. The reason this work was requested.
- **Punch #114 / D146 calendar travel block** — already shipped and working. It
  geocodes the typed event location live, so it never depended on stored venue
  coordinates, but today it can only resolve a venue to its town centre because
  that is all the address any customer has. It becomes accurate for free once
  venues carry street addresses.
- **Both service dashboards' renewal outreach, the three service quote
  builders, the schedulers and the Companies directory** — all read
  `travelFor*` and currently show "—" for 74% of the book.

---

## 9. Testing

- **Unit:** the header-alias resolver; the state-match sanity gate; the
  conflict policy matrix in §4.4; `companyId()` stability against a frozen
  fixture of known name→id pairs, so the extraction in §4.2 is provably
  behaviour-preserving.
- **Integration:** a full dry run against a scratch PGlite datadir seeded with
  a fixture of the real shape — matched, renamed, already-addressed,
  no-address-in-Daylite, and manual-override venues — asserting the report
  counts and that nothing outside `sites` is written.
- **Idempotence:** run the commit phase twice against the same datadir; the
  second run reports zero work and makes zero writes.
- **Gates:** the standard four — `tsc`, `test:specs`, `test:smoke`, `eslint`
  against a stashed baseline, reported with real numbers.
- **Production:** dry run against Neon and review the report **before** any
  `--commit --yes`, with a `db:export` backup taken first.

---

## 10. Open items for Jeff

1. Re-export `Companies.csv` from Daylite **with the address fields included**
   (street + postal code alongside the existing City / State/Province).
2. Confirm Settings → Locations has an office with lat/lng and one marked as
   the quote default — Stage 1's route phase aborts without it.
3. Run `vercel env pull` so the script can reach Neon from `.env.local`.
4. Review the dry-run report before authorising the hosted commit.
