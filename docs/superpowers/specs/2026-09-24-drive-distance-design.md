# Drive distance on the directories + "Traveling from" on calendar appointments

- **Date:** 2026-09-24
- **Punch:** #176
- **Decision:** D229
- **Status:** design approved by Jeff 2026-09-24 ("A, and let them type any address")
- **Builds on:** #175 / D228, the explicit quote origin (Madison), which lives on branch
  `feat/geo-fix-sidebar`; D144, the calendar auto travel block

## 1. What Jeff asked for

1. "A distance to all of the locations". He chose option A: a drive column on the directories,
   measured from the quote origin, that you can sort by.
2. "All estimating and rules should be out of the central shop which is Madison". Shipped in #175:
   the quote-origin control.
3. "People can add where they are traveling from when they set up appointments via the calendar,"
   including by typing any address.

## 2. Drive column

### 2.1 Where

- **`/venues`**: a new **Drive** cell on every row.
- **`/companies`** directory: a new **Drive** cell on every row, taken from the company's
  **primary venue** (`primaryLoc()`: the location flagged primary, else the first).

On both pages, the result label (Venues) or the filter row (Companies) names the origin: "Drive
from Madison Office". When no quote origin with coordinates exists, the cells read "—" and the
label says "Set a quote origin in Settings → Locations".

### 2.2 What a cell says

| travel source | cell | notes |
|---|---|---|
| `routed` (cached OSRM route) | `62 mi · 1h 8m` | the real drive |
| `auto` (straight line × road factor) | `~62 mi · 1h 8m` | the venue has coordinates, but no route has been fetched yet; tooltip "Estimated — run Geocode addresses to fetch the real route" |
| `manual` (travelMiles override) | `62 mi · 1h 8m` | tooltip "Manual travel override" |
| `none` | `—` | not located; tooltip "Not located — fix it in Settings → Admin" |

Time uses the existing `h m` style: `1h 8m`, `45m`, `2h`.

### 2.3 Sorting

Both pages gain a sort control with three choices:

- **Venues:** *Recent activity* (today's order, the default), *Nearest first*, *Farthest first*.
- **Companies:** the same three, but the default keeps the directory's current store order,
  labelled *Default*.

The choice lives in the URL as `?sort=near|far` and is kept alongside the existing filters.
Distance sorts use **minutes**, then miles. Rows with no travel (`none`) always go last, whichever
direction is chosen. Ties fall back to the name.

### 2.4 One bulk computation, no query storm

A new server helper, `travelForPoints(points)` in `src/lib/travel-bulk.ts`, generalises the #90
`travelForCustomerVenues` pattern to any list of places:

- it reads the offices and travel rates once;
- it resolves coordinates with `coordsOf()`, the same rule as every other travel call;
- it makes one `routeCachedBulk(keys)` query for every distinct origin→venue key;
- it runs `estimateFromParts()` per point.

It returns `{ originName, byId: Map<id, { miles, minutes, source }> }`. For ~1,480 venues, that is
three database round trips in total.

Formatting and sorting are pure functions in `src/lib/drive-format.ts`: `fmtDrive()`,
`driveTitle()` and `compareDrive()`. They import nothing server-side.

## 3. Calendar "Traveling from"

### 3.1 The form

In **create** mode only, and only when the event is not all-day, the New event modal gains a
**Traveling from** select, directly under Location. Edit mode is unchanged, per D144: travel blocks
are created on create only.

- **My base — {name}** is the default. It is the person's "Based out of" office, else the quote
  origin. The text reads "My base — Madison Office".
- One option per saved location in Settings → Locations.
- **Another address…** reveals a text input: "Where are you coming from?". Plain text, no
  type-ahead (YAGNI). It is geocoded when the event is saved.

The options come from a new action, `travelOriginOptionsAction()`, which returns
`{ base: { id, name } | null, offices: [{ id, name }] }` for the signed-in user. The modal fetches
it when it opens in create mode.

### 3.2 The travel block

`EventFormInput` gains an optional `travelFrom?: { officeId?: string; address?: string }`.
`addTravelBlock` resolves the origin in this order:

1. `address` (non-blank). `search(address, {limit: 1})` gives the origin point, named after the
   typed text. If it can't be found, the block uses **My base** and notes it (§3.3).
2. `officeId` that matches a saved location with coordinates: that office.
3. Otherwise **My base**, today's behaviour.

The destination is still the event's location text, geocoded the same way as today. The existing
`looksLikePhysicalAddress` gate and the six-hour sanity cap stay.

The drive time uses a **real route**: `route(origin, target)`, which is OSRM live with a 5 s
timeout and caches the result. It falls back to `estimate()`'s straight-line tier when OSRM fails.
Today's code only ever read the cache, so an origin nobody has routed from before got a
straight-line guess.

### 3.3 What the block says

- **Title** (unchanged): `Drive to {meeting title} (auto)`.
- **Description:** "Auto-added travel time — safe to delete or edit. Estimated 42 min from
  123 Oak St, Baraboo."
- **When a typed address couldn't be found,** the description adds: "Couldn't find “{typed}”, so
  this is measured from Madison Office." The block still gets created, from the base.

### 3.4 Pure resolution, testable

Origin resolution is a server-only pure-ish helper, `resolveTravelOrigin(travelFrom, ctx)` in
`src/lib/travel-origin.ts`. `ctx` carries the offices, the person's base office id, and the
`search` function. It returns `{ origin: {name, lat, lng} | null, note?: string }`. The calendar
action calls it, and tests call it with a stubbed search.

## 4. Errors and edge cases

| case | behaviour |
|---|---|
| No quote origin with coordinates | Drive cells "—"; the label points to Settings → Locations |
| Venue on the 19-city fallback (no stored coordinates) | `coordsOf()` resolves it, so it shows `~` estimated. This is consistent with every other travel number in the app |
| Company with no locations | "—", sorts last |
| Typed origin blank after trim | treated as My base |
| `officeId` for a deleted office, or one without coordinates | My base |
| Nominatim or OSRM down | the block falls back to the straight-line estimate. If the destination can't be geocoded, no block is created (today's behaviour) |
| Travel block creation fails | swallowed, as today; the meeting itself never fails |

## 5. Out of scope

Per-shop side-by-side distances (option B), map colouring or rings (option C), type-ahead on the
typed origin, remembering typed origins, regenerating travel blocks on edit, and a return-trip
block.

## 6. Testing

A new `scripts/test-drive-distance.ts` (scratch PGlite, `fetch` stubbed), run as
`npm run test:drive-distance`:

- **`travelForPoints`:** routed / auto / manual / none per point; no origin → all none; the origin
  name is returned; duplicate coordinates share one cache key.
- **`fmtDrive` / `compareDrive`:** the formats in §2.2; nulls last in both directions; ties by name.
- **`resolveTravelOrigin`:** a typed hit; a typed miss → base plus the note; `officeId` → that
  office; an unknown `officeId` → base; blank → base; no base and no offices → null.

**Browser:**

- `/venues` shows the Drive column and all three sorts;
- `/companies` shows the column and sort;
- the calendar create form shows the Traveling from options, and the typed address field appears
  and hides correctly.

Actually creating a Google Calendar event needs a connected calendar grant, which the worktree dev
server doesn't have. So the save path is covered by the unit tests plus a code read, and that is
stated in the punch entry.

**Gates:** tsc, `test:specs`, `test:smoke`, eslint vs the origin/main baseline.

## 7. Shipping

This is branch `feat/drive-distance`, stacked on `feat/geo-fix-sidebar`. It ships after #175 and
not during Jeff's production geocode run.
