# Unlocated venues — worklist + fix-it sidebar in Settings → Admin

- **Date:** 2026-09-24
- **Punch:** #175
- **Decision:** D228
- **Status:** design approved by Jeff 2026-09-24; spec awaiting review
- **Builds on:** #147 (D179–D185, geocoding backfill), #166 (D222, runner stall + street cleanup +
  postal-city gate)

---

## 1. The problem

The Settings → Admin **Geocode addresses** runner resolves most of the book, but some addresses
never will by text alone. The 24-address production sample from #166 left 4 unresolved:

| address | why |
|---|---|
| `1302 South Broadway, DePere, WI` | spelling (`De Pere`) |
| `1309 Norplex Road, LaCrosse, WI` | spelling (`La Crosse`) |
| `W185 S8750 Racine Ave., Muskego, WI` | not in OpenStreetMap |
| `2516 School Street, Stevens Point, WI` | not in OpenStreetMap |

At ~17% of ~1,250 street addresses, that is roughly 200 venues with no coordinates and so no
travel time. Travel time is priced into quotes.

Today, fixing one means reading the failure list in Settings, finding the company in Customers,
opening the full-company editor, finding the right venue, correcting it, then re-running the
whole batch. The failure list itself is weak:

- it keeps only `{query, reason, got}` and **drops the venue id**, so a row cannot link anywhere;
- it holds at most 50 failures, shows 20, and **vanishes on reload** (client state only).

**Jeff's ask (2026-09-24):** click an address and have that venue open in a side bar, fix the bad
address there, then resend.

## 2. Decisions taken with Jeff

1. **Location:** Settings → Admin, directly under the Geocode button. It **replaces** today's
   20-item failure list. Admin-only, like the button.
2. **Fix paths:** edit + retry, pick a search suggestion, drop a pin on a map. **No
   "use town centre"** shortcut, so every fix is building-accurate.
3. **Resend is per venue.** A fix locates and routes that one venue immediately. Nobody has to
   re-run the batch.

## 3. Design

### 3.1 The worklist is a database query, not the run's memory

"Unlocated" means a live venue (`deleted = false`) with an address or a city, **no** usable
`lat`/`lng` (NULL or `""` count as missing, the same rule as `venuesMissingCoords()`), and **no**
manual travel override (`travelMiles`/`travelMin` blank). Override venues already have travel in
`estimate()`, so fixing them changes nothing.

Because it is a query, the list survives reloads, has no cap, and shrinks as venues are fixed,
whether the fix came from the sidebar, the batch runner, or the Companies editor.

Each row shows:

- company name. The whole row opens the sidebar, so the link to the company sits in the
  sidebar header rather than on the row, where it would fight the row click;
- venue name (`Untitled venue` when blank, matching `/venues`);
- the stored address: street · city, state zip;
- **reason**, when this browser's current run recorded one for that venue ("No match",
  "Resolved to Madison, WI: wrong city", "Wrong state"). Otherwise the cell is blank. Reasons are
  not persisted (§5).

Controls:

- a search box, which filters on company, venue, street and city, case-insensitive, server-side;
- pages of 50, with *Show more*;
- a count line: `N venues can't be located · M have no address at all`. The M venues are not
  listed, because there is nothing to fix until someone types an address. The count exists so
  the gap is visible.

Order: company name, then venue name. The list reloads after the batch runner finishes and after
every sidebar fix.

### 3.2 The runner's failures carry the venue id

`geocodeBatchAction` returns `failures[]` with `siteId` added. The client keeps them in a
`Map<siteId, reason>` for the life of the page, which is what the reason column reads. The old
20-item failure list is removed.

### 3.3 The sidebar

Clicking a row opens a right-hand slide-over panel (fixed, full height, ~420px; full-width under
640px). It closes on ×, Escape, or a click on the backdrop. It holds three fix paths and one
result area.

**Header:** company (linked to `/companies/<id>`, new tab) · venue, and the stored address as it
was when opened.

**A. Edit + retry.** Street, City, State and Zip fields, pre-filled from the venue. **Retry**
runs this one venue through exactly the batch's logic (§3.4): `cleanStreet()`, free-text versus
structured query, the state gate, and the city gate with its postal-city radius.

- Hit: saves the edited street/city/state/zip **and** the coordinates.
- Miss or rejection: shows the reason inline and saves **nothing**. The edited text stays in the
  fields so it can be tweaked and retried.

**B. Search.** A type-ahead over the existing `search()` (Nominatim, limit 6, debounced ~400ms,
minimum 3 characters). It uses a new admin action (§3.5) rather than the Companies one, because
that one drops `zip`. Picking a suggestion saves its street/city/state/zip and its exact lat/lng.
The gates are **not** applied, because a human chose the place.

**C. Pin.** A small map (~260px tall), centred on the stated town when that resolves, otherwise
on the Wisconsin default. Clicking places a draggable pin, which can be dragged to adjust.
**Save location** saves the lat/lng only; the stored address text is left as-is. This is the one
fix for addresses OSM does not have.

**After any successful save:** the server fetches the real driving route from the quote origin
through `route()`, which warms `geo_cache`, and returns the travel estimate. The sidebar shows it:

> ✓ Located · 62 mi · 1h 8m from Reedsburg (routed)

It says `(estimated)` when OSRM failed and travel fell to the haversine tier. That is still a
valid location, and the batch route phase can upgrade it later. The row disappears from the
list. A **Next venue →** button opens the following row, so the list can be worked through
without closing the panel.

**What the sidebar never does:**

- touch `travelMiles`/`travelMin`. That is the Companies "Route" button's behaviour, and it
  freezes travel as a manual override. Here travel stays live through the route cache;
- touch the `companies` row (mailing address) or any other venue.

### 3.4 One shared "locate this venue" function

The one-venue body of `backfillVenueCoords()` is extracted to `geo-backfill.ts`:

```ts
geocodeVenue(row, ctx): Promise<
  | { ok: true; lat: number; lng: number; precision: GeocodePrecision; hit: GeoSearchHit }
  | { ok: false; reason: GeocodeFailure["reason"]; got?: string }
>
```

This is the query choice plus both gates plus the postal-city radius, with the town-centre cache
and pacing passed in through `ctx`. `backfillVenueCoords()` calls it for each deduped query, and
the sidebar's Retry calls it once. That way the batch and the sidebar cannot disagree about what
counts as a good match. It is a behaviour-preserving refactor, and the existing
`test:geo-backfill` must stay green unchanged.

### 3.5 Server actions (`src/app/(app)/settings/actions.ts`)

All require `manage_users`, the same permission as the Geocode button.

| action | does |
|---|---|
| `listUnlocatedVenuesAction({ q?, offset?, limit? })` | worklist page (§3.1) joined to the company name, plus `total` and `noAddress` counts |
| `searchVenueAddressAction(query)` | `search(query, {limit: 6})` → hits **including zip** |
| `locateVenueAction(input)` | one venue, three modes (below), then route + estimate |

`locateVenueAction` input is `{ siteId, mode, … }`:

- `mode: "retry"` with `{ address, city, state, zip }`: runs `geocodeVenue()` on the edited
  fields. Writes address fields and coordinates on success; writes nothing on failure.
- `mode: "pick"` with `{ address, city, state, zip, lat, lng }`: writes all of them.
- `mode: "pin"` with `{ lat, lng }`: writes the coordinates only.

**Validation:** `siteId` must exist and not be deleted; `lat` must be in −90..90 and `lng` in
−180..180, both finite; strings are trimmed and length-capped. The write is a targeted `UPDATE
sites … WHERE id = ?` (never an upsert, per D181) setting only the listed columns plus
`updatedAt`. Then `route(office, coords)` runs when a quote origin with coordinates exists, then
`estimate()`, and the result is returned as `{ ok, miles, minutes, source, officeName }` or
`{ ok: false, reason, got? }`. Finally `revalidatePath("/", "layout")`, the same as the batch
action.

### 3.6 Map: an opt-in pick mode on the shared component

`src/components/map/LeafletMap.tsx` gains two optional props:

```ts
picked?: { lat: number; lng: number } | null;   // draws one draggable pin
onPick?: (p: { lat: number; lng: number }) => void; // map click + pin dragend
```

When `onPick` is absent, behaviour is byte-for-byte what it is today, so every existing map is
unaffected. This must be verified on at least one existing map, not assumed. When `onPick` is
present, a map click calls it and a pin `dragend` calls it. The component also stops refitting
bounds on every `picked` change, so the view does not jump while a pin is being dragged.

### 3.7 Components

- `src/app/(app)/settings/unlocated-venues.tsx` (new, client): the worklist plus the
  sidebar-open state. It receives the run's `reasons` map from `settings-client.tsx`.
- `src/app/(app)/settings/venue-locate-drawer.tsx` (new, client): the sidebar and its three fix
  paths.
- `settings-client.tsx`: removes the failure list, mounts `<UnlocatedVenues>` under the Geocode
  button, and refreshes it when the runner finishes.

`settings-client.tsx` is already about 2,000 lines, which is why the two new units are separate
files.

## 4. Errors and edge cases

| case | behaviour |
|---|---|
| Nominatim/OSRM down or slow | Retry and Search fail soft and show "Lookup failed. Try again, or drop a pin". Pin still works, because it needs no lookup |
| Retry rejected by a gate | Reason shown inline, nothing saved |
| Venue deleted meanwhile | the action returns `{ ok: false, reason: "gone" }`; the sidebar says so and the list reloads |
| Venue got coordinates elsewhere meanwhile (batch, Companies editor) | the sidebar's save still applies: an explicit human fix wins over a batch match. The list reload drops the row either way |
| No quote origin with coordinates | the venue is still located, and the result reads "Located. No quote origin set, so travel can't be computed" |
| Batch runner running at the same time | safe: both use targeted UPDATEs on different rows; a venue fixed in the sidebar simply stops being a batch candidate |
| Pin placed absurdly far away (e.g. another state) | allowed, because the human chose it; the result line shows the miles, which makes a mistake obvious |

Nominatim pacing: sidebar lookups are human-paced, one per Retry click plus a debounced
type-ahead. No extra throttle beyond the debounce.

## 5. Out of scope (YAGNI)

- **Persisting failure reasons** per venue, which needs a schema change. Reasons exist for the
  current run's page. After a reload, a Retry reproduces the reason in one click.
- A "No location" filter on `/venues`. Jeff chose Settings only.
- A "use town centre" one-click. Jeff declined it (§2).
- Bulk actions (fix many at once), and editing the company mailing address.
- The Import hub's post-commit geocode and the quote re-price report, both still open under #147.

## 6. Testing

Extend `scripts/test-geo-backfill.ts` (scratch PGlite, `fetch` stubbed):

- **Worklist query:** includes addressed, uncoordinated venues; excludes venues with coordinates,
  deleted venues, manual-override venues, and no-address venues (those counted in `noAddress`);
  search filter and paging.
- **`geocodeVenue` extraction:** existing scenarios unchanged, plus a direct single-venue call
  hitting each reason.
- **The three `locateVenue` paths:**
  - retry success writes address and coordinates;
  - retry failure writes **nothing**;
  - pick writes all fields;
  - pin writes only lat/lng;
  - out-of-range lat/lng is rejected;
  - a deleted venue returns `gone`;
  - **no other `sites` row and no `companies` row changes** (snapshot before and after);
  - a route is cached for the new coordinates.
- The library function behind `locateVenueAction` is tested directly; the action is a thin
  permission-plus-revalidate wrapper, like `geocodeBatchAction`.

**Browser (worktree dev server):**

- open the sidebar from a row;
- Retry with a corrected spelling;
- Search and pick a suggestion;
- drop and drag a pin, then save;
- the row disappears; Next works; Escape closes;
- the Companies map still renders as before (the regression check for §3.6);
- phone width.

**Gates:** tsc, `test:specs`, `test:smoke`, eslint versus the origin/main baseline, reported with
real numbers.

## 7. Shipping

**Nothing deploys while a production Geocode run is in progress.** A deploy replaces the server
actions the open Settings tab is calling, and the runner stops with "Stopped: …". The run is
resumable, but interrupting it wastes Jeff's time. Push only after Jeff confirms his run is done.
