# Address Verification + Automatic Drive Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every address the scheduler touches is `verified`, `needs_check` or `unresolved`; each rep's day gets drive blocks chained base → stop → stop → base (OSRM minutes + the rep's buffer) from verified addresses only, written to Google as tagged events, and the D144 guessing travel block is retired.

**Architecture:** Two pure engines — `src/lib/address-verify/` (address keys, verification states, venue stamp rules) and `src/lib/drive-plan/` (`planDay(input) → legs[]`, no IO) — sit behind thin server loaders. Venues carry four new `sites` columns; every non-venue address lives in a new `place_book` table keyed by an exact normalized key. A loader (`drive-plan/load.ts`) assembles a rep's stops (site visits via `visitPeople()`, Google events with a physical location) in `cache` mode for page views and `live` mode for syncs; `drive-sync/sync.ts` diffs desired legs against Google events tagged with the private extended property `peakDrive` and touches only those.

**Tech Stack:** Next.js 16 App Router (server actions, `after()` from `next/server`), TypeScript, Drizzle ORM on Postgres/PGlite, doc-store blobs (`getBlob`/`setBlob`), Nominatim + public OSRM via `src/lib/geo.ts`, Google Calendar v3 via `src/lib/google/calendar.ts`, Leaflet (`src/components/map/LeafletMap.tsx`) for the drop-a-pin map, the spec harness `scripts/test-review-and-spec.ts`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-09-address-verification-drive-time-design.md` (read it before Task 1). Follow-on specs 2 and 3 consume `planDay`, the address-state lookups and the per-user buffer — keep the names in each task's **Interfaces** block exactly.
- States are exactly `verified` · `needs_check` · `unresolved`. Only `verified` gets drive time.
- **No straight-line fallback for drive time, ever.** Nothing under `src/lib/drive-plan/` or `src/lib/drive-sync/` may call `estimate`, `estimateFromParts`, `driveMinutes`, `driveMiles` or `haversineMiles` (a source pin in Task 7 enforces it). Route minutes come only from `geo_cache` (`routeCachedBulk`) or live OSRM (`route()`).
- An address that can't be resolved is flagged, never guessed. Place-book matching is **exact normalized key only** (lowercase, whitespace collapsed, punctuation stripped) — no fuzzy or name matching.
- A hand-placed pin (`source = pin`) is never overwritten by the geocoder; only a deliberate fix replaces it.
- Flag copy, verbatim: `Address not verified — no drive time` · `No base set` · `Drive time unavailable — retrying` · `Tight — needs 1h 40m, has 1h 05m` (format `Xh MMm` when hours > 0, `Mm` otherwise) · stay-over toggle `Staying near last stop`.
- Leg minutes = OSRM route minutes + the rep's buffer. Drive-to block ends at the stop's start; drive-back block starts at the last stop's end. Nothing is ever moved.
- Days are **Chicago calendar days** (`America/Chicago`). Sync window: **today → +14 days**. Stale-on-load threshold: **10 min**.
- Google: write/update/delete **only events whose private extended property `peakDrive` = `"1"`**. Flagged legs get no Google event. A rep with no connected calendar is app-only. A Google write failure is logged and retried on the next sync; it never blocks saving a visit.
- D144 retirement: on each rep's first sync, delete upcoming events whose title matches `Drive to … (auto)` **and** whose description starts `Auto-added travel time`. Past ones are left.
- No AI anywhere (D89). Timestamps are epoch-ms numbers.
- `requireUser()` / `requirePerm()` first in every server action; validate every action input as untrusted.
- Client components (`"use client"`) import only from `src/lib/address-verify/types.ts`, `src/lib/drive-plan/plan.ts` (pure, type-only imports) and server-action files — never from a module that reaches `@/db` (`next build` fails otherwise; Task 12 runs it).
- Migration: generate with `npm run db:generate -- --name address_verification`, then harden it per D141 (`IF NOT EXISTS` everywhere). It will be `0036_address_verification` on this branch; **if another branch lands a 0036 first, renumber at merge** (regenerate on the merged schema and re-harden — the #323 branch already holds a 0036).
- Never open `.data/pglite`, never run a `tsx`/db script or a dev server against it. `npm run test:specs`, `npm run test:geo-backfill` and `npm run test:drive-distance` each make their own temp datadir and are safe.
- Per-task gates (all must pass, report real numbers): `npx tsc --noEmit` · `npm run test:specs` · `npx eslint --ignore-pattern scripts/test-review-and-spec.ts <changed files>`. Task 12 adds `npm run build` and `npm run test:smoke`.
- Tests live in a NEW module `scripts/test-drive-time.ts`, exporting `async function driveTime<Name>Checks(ok: Ok): Promise<void>` functions, imported by the harness right after the line `import { registerFixture } from "./test-fixtures";` and chained right after `.then(() => square322Pins())` (the #323 branch's `test-meetings-323.ts` pattern). Relational rows (`sites`, `place_book`, `blobs`) are hard-deleted in each check's own `finally` (ids/labels prefixed `TESTdrive`); doc fixtures use `registerFixture`.
- Don't assign D/punch numbers. Only Task 12 writes DECISIONS/PUNCHLIST/AGENTS entries, as `D-next…`/`#next` placeholders recomputed from `git show origin/main:DECISIONS.md` and `git show origin/main:PUNCHLIST.md` at merge time.

---

## File structure

**Create**

| File | Responsibility |
|---|---|
| `src/lib/address-verify/types.ts` | Zero-import types: `LatLng`, `GeoStatus`, `GeoSource`, `FixTarget`, `AddressState`, `PlaceRow`. Client-safe. |
| `src/lib/address-verify/keys.ts` | Pure: `addressKey()`, `isPhysicalLocation()`. Client-safe. |
| `src/lib/address-verify/state.ts` | Pure rules: status from precision / free-text hit, venue backfill status, `venueAddressState`, `placeAddressState`, `geoStampForSave`, `placeRowFromHit`. Server-side (imports `precisionOf`). |
| `src/lib/address-verify/venue-geo.ts` | `ensureVenueGeoStatus()` — idempotent JS backfill of `sites.geo_status`. |
| `src/lib/address-verify/place-book.ts` | `getPlaces`, `placeStatesFor(texts, mode)`, `fixPlace`. |
| `src/lib/address-verify/targets.ts` | `matchVisitSite`, `addressStatesForVisits(visits, mode)`. |
| `src/lib/address-verify/fix.ts` | `fixAddress(input, by)`, `loadFixTarget(target)`, `cleanFixInput(raw)`. |
| `src/lib/address-verify/worklist.ts` | `listAddressesToVerify(opts)` — venues + upcoming visits + open leads. |
| `src/lib/drive-plan/day.ts` | Pure Chicago day helpers. Client-safe. |
| `src/lib/drive-plan/stops.ts` | Pure: `visitPeople`, `isVisitIcsCopy`, `stopsForDay`. |
| `src/lib/drive-plan/plan.ts` | Pure: `planDay`, `neededRoutes`, `dayDriveTotal`, `pairKey`, `fmtDur`, `FLAG_TEXT`. Client-safe. |
| `src/lib/drive-plan/index.ts` | Re-exports the pure engine. |
| `src/lib/drive-plan/load.ts` | Server loader `planDriveDays(args)` + `routeMinutesFor`. |
| `src/lib/drive-sync/diff.ts` | Pure: prop names, `desiredFromLegs`, `existingFromCalendar`, `diffDriveEvents`, `isLegacyTravelBlock`. |
| `src/lib/drive-sync/sync.ts` | `syncDriveDays`, `syncDriveForUser`, `syncDriveIfStale`, `syncAllDrivers`, `resyncForVisitChange`, `resyncForAddress`. |
| `src/lib/drive-sync/agenda.ts` | `driveAgendaLayer()` — drive items + address flags for `loadAgendaRange`. |
| `src/lib/stores/schedule-prefs.ts` | Company buffer default, per-user buffer, stay-over flags, per-user sync state (all blobs; no migration). |
| `src/components/address-fix/address-fix-drawer.tsx` | The Fix dialog (retype → search → drop a pin), generalized from the Settings venue drawer. |
| `src/components/address-fix/address-flag.tsx` | "Address not verified — no drive time" badge with a **Fix** button. |
| `src/app/(app)/address-actions.ts` | Server actions for fixing/looking up addresses and the worklist. |
| `src/app/(app)/settings/addresses-to-verify.tsx` | Settings → Data worklist (replaces `unlocated-venues.tsx`). |
| `src/app/(app)/settings/drive-defaults-card.tsx` | Admin company default buffer. |
| `src/app/(app)/account/drive-buffer-card.tsx` | Per-user buffer. |
| `drizzle/0036_address_verification.sql` (+ meta snapshot/journal) | Four `sites` columns + `place_book`. |
| `scripts/test-drive-time.ts` | All new spec checks. |

**Modify**

`src/db/schema.ts` · `src/lib/geo.ts` (`searchOrThrow`) · `src/lib/geo-backfill.ts` · `src/lib/venue-locate.ts` · `src/lib/identity/sites.ts` (`saveSite`) · `src/lib/google/calendar.ts` · `src/lib/agenda.ts` · `src/app/(app)/calendar-actions.ts` · `src/app/(app)/calendar/event-modal.tsx` · `src/app/(app)/calendar/page.tsx` · `src/app/(app)/calendar/calendar-client.tsx` · `src/app/(app)/home-calendar.tsx` · `src/app/(app)/page.tsx` · `src/app/(app)/venue-assessments/visit-actions.ts` · `src/app/(app)/venue-assessments/visit-requests.tsx` · `src/app/(app)/venue-assessments/page.tsx` · `src/app/(app)/inbox/site-visit-actions.ts` · `src/app/(app)/inbox/site-visit-modal.tsx` · `src/app/(app)/companies/[id]/page.tsx` · `src/app/api/gmail/sync/route.ts` · `src/app/(app)/account/page.tsx` · `src/app/(app)/account/actions.ts` · `src/app/(app)/account/office-picker.tsx` · `src/app/(app)/settings/{page.tsx,settings-client.tsx,groups/field.tsx,groups/types.ts,groups/data.tsx,actions.ts}` · `scripts/test-review-and-spec.ts` · `DECISIONS.md` · `PUNCHLIST.md` · `AGENTS.md`.

**Delete** (moved/replaced in Task 9): `src/app/(app)/settings/unlocated-venues.tsx`, `src/app/(app)/settings/venue-locate-drawer.tsx`.

---

### Task 1: Address-verify pure core + test module

**Files:**
- Create: `src/lib/address-verify/types.ts`, `src/lib/address-verify/keys.ts`, `src/lib/address-verify/state.ts`, `scripts/test-drive-time.ts`
- Modify: `scripts/test-review-and-spec.ts` (one import line, one chain line)

**Interfaces:**
- Consumes: `precisionOf(row: { address?: string | null }): "building" | "city"` from `src/lib/geo-backfill.ts`.
- Produces:
  - `types.ts`: `type LatLng = { lat: number; lng: number }`; `type GeoStatus = "verified" | "needs_check" | "unresolved"`; `const GEO_STATUSES: readonly GeoStatus[]`; `type GeoSource = "geocode" | "pin" | "override"`; `type FixTarget = { kind: "venue"; siteId: string } | { kind: "place"; key: string; label: string }`; `type AddressState = { status: GeoStatus; label: string; point: LatLng | null; pointKey: string | null; fix: FixTarget | null }` (`point` is non-null **only** when `status === "verified"`; `pointKey` is `"site:<siteId>"` or `"place:<key>"`); `type PlaceRow = { key: string; label: string; lat: number | null; lng: number | null; status: GeoStatus; source: "geocode" | "pin"; verifiedBy: string | null; verifiedAt: number | null; updatedAt: number }`.
  - `keys.ts`: `addressKey(text: string | null | undefined): string`; `isPhysicalLocation(text: string | null | undefined): boolean`.
  - `state.ts`: `isGeoStatus(v: unknown): v is GeoStatus`; `isGeoSource(v: unknown): v is GeoSource`; `statusFromPrecision(p: "building" | "city"): GeoStatus`; `statusOfFreeTextHit(hit: { street: string } | null | undefined): GeoStatus`; `type VenueSpot = { address?: string | null; city?: string | null; state?: string | null; zip?: string | null; lat?: string | number | null; lng?: string | number | null }`; `backfillStatus(row: VenueSpot): GeoStatus`; `venueGeoStatus(row: VenueSpot & { geoStatus?: string | null }): GeoStatus`; `formatVenueAddress(row: VenueSpot): string`; `venueAddressState(row: VenueSpot & { id: string; geoStatus?: string | null }): AddressState`; `placeAddressState(text: string, row: PlaceRow | null | undefined): AddressState`; `type GeoStamp = { geoStatus: GeoStatus; geoSource: GeoSource | null; geoVerifiedBy: string | null; geoVerifiedAt: number | null }`; `type StampedSpot = VenueSpot & { geoStatus?: string | null; geoSource?: string | null; geoVerifiedBy?: string | null; geoVerifiedAt?: number | null }`; `geoStampForSave(prev: StampedSpot | null, next: VenueSpot, now: number): { stamp: GeoStamp; keepPrevCoords: boolean }`; `placeRowFromHit(key: string, label: string, hit: { street: string; lat: number; lng: number } | null | undefined, now: number): PlaceRow`.
  - `scripts/test-drive-time.ts`: `export type Ok = (c: boolean, m: string) => void;` and `driveTimeKeysChecks(ok)`, `driveTimeStateChecks(ok)`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/test-drive-time.ts`:

```ts
/* Address verification + automatic drive time — spec checks
   (docs/superpowers/specs/2026-10-09-address-verification-drive-time-design.md).
   Chained from test-review-and-spec.ts. Relational rows use TESTdrive ids and
   are hard-deleted in each check's own finally. */
import { addressKey, isPhysicalLocation } from "@/lib/address-verify/keys";
import {
  backfillStatus,
  geoStampForSave,
  placeAddressState,
  placeRowFromHit,
  statusFromPrecision,
  statusOfFreeTextHit,
  venueAddressState,
  venueGeoStatus,
} from "@/lib/address-verify/state";

export type Ok = (c: boolean, m: string) => void;

export async function driveTimeKeysChecks(ok: Ok): Promise<void> {
  ok(addressKey("  123 Main St.,  Madison, WI 53703 ") === "123 main st madison wi 53703",
    "drive-time: addressKey lowercases, strips punctuation, collapses whitespace");
  ok(addressKey("123 MAIN ST, MADISON WI 53703") === addressKey("123 main st madison, wi  53703"),
    "drive-time: two spellings differing only in case/punctuation/spacing share one key");
  ok(addressKey("123 Main St") !== addressKey("123 Main Street"), "drive-time: exact key only — no abbreviation folding");
  ok(addressKey(null) === "" && addressKey("  ,. ") === "", "drive-time: blank or punctuation-only text has no key");

  ok(isPhysicalLocation("123 Main St, Madison, WI"), "drive-time: a street address is a physical location");
  ok(isPhysicalLocation("Meeting House Rd 12, Verona WI"), "drive-time: 'Meeting' is not the word 'meet'");
  ok(!isPhysicalLocation(""), "drive-time: no location → not a stop");
  ok(!isPhysicalLocation("https://us02web.zoom.us/j/123"), "drive-time: a URL is not a stop");
  ok(!isPhysicalLocation("Zoom") && !isPhysicalLocation("Microsoft Teams Meeting") && !isPhysicalLocation("Google Meet") && !isPhysicalLocation("Webex"),
    "drive-time: Zoom/Teams/Meet/Webex mentions are not stops");
  ok(!isPhysicalLocation("meet.google.com/abc-defg-hij"), "drive-time: a bare meet.google link is not a stop");
  ok(!isPhysicalLocation("(608) 555-1212") && !isPhysicalLocation("+1 608-555-1212 x12"), "drive-time: a phone number is not a stop");
}

export async function driveTimeStateChecks(ok: Ok): Promise<void> {
  ok(statusFromPrecision("building") === "verified" && statusFromPrecision("city") === "needs_check",
    "drive-time: building-level geocode verifies; city/zip → needs_check");
  ok(statusOfFreeTextHit({ street: "123 Main St" }) === "verified" && statusOfFreeTextHit({ street: "Main St" }) === "needs_check" &&
     statusOfFreeTextHit({ street: "" }) === "needs_check" && statusOfFreeTextHit(null) === "unresolved",
    "drive-time: a free-text hit verifies only with a house number; no hit → unresolved");

  // One-time venue backfill mapping.
  ok(backfillStatus({ address: "605 Erie Ave", lat: "43.7", lng: "-87.7" }) === "verified", "drive-time backfill: building-level lat/lng → verified");
  ok(backfillStatus({ address: "", city: "Madison", lat: "43.07", lng: "-89.4" }) === "needs_check", "drive-time backfill: city-level lat/lng → needs_check");
  ok(backfillStatus({ address: "605 Erie Ave", lat: null, lng: null }) === "unresolved" && backfillStatus({ address: "605 Erie Ave", lat: "", lng: "" }) === "unresolved",
    "drive-time backfill: null or blank lat/lng → unresolved");
  ok(venueGeoStatus({ address: "605 Erie Ave", lat: "43.7", lng: "-87.7", geoStatus: "needs_check" }) === "needs_check" &&
     venueGeoStatus({ address: "605 Erie Ave", lat: "43.7", lng: "-87.7", geoStatus: null }) === "verified",
    "drive-time: a stored status wins; an unstamped row reads through the backfill rule");

  const v = venueAddressState({ id: "st-1", address: "605 Erie Ave", city: "Sheboygan", state: "WI", zip: "53081", lat: "43.75", lng: "-87.71", geoStatus: "verified" });
  ok(v.status === "verified" && v.point?.lat === 43.75 && v.pointKey === "site:st-1" && v.fix?.kind === "venue" && v.label === "605 Erie Ave, Sheboygan, WI 53081",
    "drive-time: a verified venue state carries its point, site key and venue fix target");
  const vn = venueAddressState({ id: "st-2", address: "", city: "Madison", state: "WI", lat: "43.07", lng: "-89.4", geoStatus: "needs_check" });
  ok(vn.status === "needs_check" && vn.point === null, "drive-time: only a verified state carries a point");

  const row = placeRowFromHit("1 main st x", "1 Main St X", { street: "1 Main St", lat: 43, lng: -89 }, 1000);
  ok(row.status === "verified" && row.source === "geocode" && row.lat === 43 && row.verifiedAt === 1000 && row.verifiedBy === null,
    "drive-time: a building-level free-text hit writes back as verified (source geocode)");
  const miss = placeRowFromHit("nowhere", "Nowhere", null, 1000);
  ok(miss.status === "unresolved" && miss.lat === null && miss.verifiedAt === null, "drive-time: no hit is stored as unresolved, no coordinates");
  const ps = placeAddressState("1 Main St X", row);
  ok(ps.status === "verified" && ps.pointKey === "place:1 main st x" && ps.fix?.kind === "place" && ps.point?.lng === -89,
    "drive-time: a place state keys on the normalized text");
  ok(placeAddressState("1 Main St X", undefined).status === "unresolved" && placeAddressState("", undefined).fix === null,
    "drive-time: an unknown place is unresolved; no text → nothing to fix");

  // geoStampForSave — editing an address resets verification; a pin is never overwritten.
  const pinned = { address: "605 Erie Ave", city: "Sheboygan", state: "WI", lat: "43.7501", lng: "-87.7102", geoStatus: "verified", geoSource: "pin", geoVerifiedBy: "u1", geoVerifiedAt: 5 };
  const sameAddrNewCoords = geoStampForSave(pinned, { ...pinned, lat: "43.70", lng: "-87.70" }, 99);
  ok(sameAddrNewCoords.keepPrevCoords && sameAddrNewCoords.stamp.geoSource === "pin" && sameAddrNewCoords.stamp.geoVerifiedBy === "u1",
    "drive-time: a save with the same address never overwrites a pin's coordinates or stamp");
  const moved = geoStampForSave(pinned, { address: "1 New St", city: "Sheboygan", state: "WI", lat: null, lng: null }, 99);
  ok(!moved.keepPrevCoords && moved.stamp.geoStatus === "unresolved" && moved.stamp.geoSource === null,
    "drive-time: editing the address resets verification (no coordinates → unresolved)");
  const movedWithCoords = geoStampForSave(pinned, { address: "1 New St", city: "Sheboygan", state: "WI", lat: "43.1", lng: "-87.1" }, 99);
  ok(movedWithCoords.stamp.geoStatus === "verified" && movedWithCoords.stamp.geoSource === "override" && movedWithCoords.stamp.geoVerifiedAt === 99,
    "drive-time: a new address arriving with form coordinates is re-judged by precision (source override)");
  const untouched = geoStampForSave({ ...pinned, geoSource: "geocode" }, { ...pinned }, 99);
  ok(untouched.stamp.geoSource === "geocode" && untouched.stamp.geoVerifiedAt === 5 && !untouched.keepPrevCoords,
    "drive-time: an unchanged save keeps the stored stamp");
  const legacy = geoStampForSave({ address: "605 Erie Ave", lat: "43.7", lng: "-87.7" }, { address: "605 Erie Ave", lat: 43.7, lng: -87.7 }, 99);
  ok(legacy.stamp.geoStatus === "verified" && legacy.stamp.geoSource === "geocode",
    "drive-time: an unstamped row saved unchanged gets its backfill stamp (numeric vs text coords compare equal)");
  const fresh = geoStampForSave(null, { address: "", city: "Madison", lat: "43.07", lng: "-89.4" }, 99);
  ok(fresh.stamp.geoStatus === "needs_check" && fresh.stamp.geoVerifiedAt === null, "drive-time: a new city-level venue starts needs_check");
}
```

- [ ] **Step 2: Wire the module into the harness**

In `scripts/test-review-and-spec.ts`, directly below the line `import { registerFixture } from "./test-fixtures";` add:

```ts
import { driveTimeKeysChecks, driveTimeStateChecks } from "./test-drive-time";
```

and directly below `.then(() => square322Pins())` add:

```ts
  .then(() => driveTimeKeysChecks(ok))
  .then(() => driveTimeStateChecks(ok))
```

(Every later task adds its names to this same import line and its `.then(...)` lines after the previous task's.)

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: fails to start — `Cannot find module '@/lib/address-verify/keys'`.

- [ ] **Step 4: Write `src/lib/address-verify/types.ts`**

```ts
/**
 * Address verification (spec 2026-10-09 address-verification-drive-time) —
 * shared types. Zero imports: client components import from here.
 */
export type LatLng = { lat: number; lng: number };

export type GeoStatus = "verified" | "needs_check" | "unresolved";
export const GEO_STATUSES: readonly GeoStatus[] = ["verified", "needs_check", "unresolved"];

/** Where a venue's coordinates came from: the geocoder, a hand-dropped pin,
 *  or a person supplying coordinates on a venue form / import. */
export type GeoSource = "geocode" | "pin" | "override";

/** What a Fix dialog edits: a venue row, or a place-book entry keyed by the
 *  exact normalized text (label = the text as the record holds it). */
export type FixTarget = { kind: "venue"; siteId: string } | { kind: "place"; key: string; label: string };

/** One address as the scheduler sees it. `point` is set ONLY when verified. */
export type AddressState = {
  status: GeoStatus;
  label: string;
  point: LatLng | null;
  /** "site:<siteId>" | "place:<key>" — the identity re-syncs match on. */
  pointKey: string | null;
  fix: FixTarget | null;
};

/** One place_book row (non-venue addresses). */
export type PlaceRow = {
  key: string;
  label: string;
  lat: number | null;
  lng: number | null;
  status: GeoStatus;
  source: "geocode" | "pin";
  verifiedBy: string | null;
  verifiedAt: number | null;
  updatedAt: number;
};
```

- [ ] **Step 5: Write `src/lib/address-verify/keys.ts`**

```ts
/**
 * Pure address-text rules. Client-safe (no imports).
 *
 * addressKey — the place book's ONLY match rule: lowercase, every run of
 * non-letter/non-digit characters becomes one space, trimmed. Exact key
 * match only — no abbreviation folding, no fuzzy or name matching (spec).
 */
export function addressKey(text: string | null | undefined): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const URL_RE = /https?:\/\/|^www\./i;
const VIDEO_RE = /\b(zoom|teams|meet|webex)\b/i;

/**
 * A Google event location that can be driven to. Not stops: blank, a URL,
 * anything mentioning Zoom/Teams/Meet/Webex, or a bare phone number. Whether
 * it can actually be FOUND is the verifier's job, not this one's.
 */
export function isPhysicalLocation(text: string | null | undefined): boolean {
  const s = String(text ?? "").trim();
  if (!s) return false;
  if (URL_RE.test(s)) return false;
  if (VIDEO_RE.test(s)) return false;
  const noExt = s.replace(/\s*\b(ext|x)\.?\s*\d+\s*$/i, "");
  if (/^[\d\s().+-]+$/.test(noExt) && (noExt.match(/\d/g) || []).length >= 7) return false;
  return true;
}
```

- [ ] **Step 6: Write `src/lib/address-verify/state.ts`**

```ts
/**
 * Address verification rules — pure (no IO), server-side (imports
 * precisionOf from geo-backfill). Client code imports ./types instead.
 */
import { precisionOf } from "@/lib/geo-backfill";
import { addressKey } from "./keys";
import type { AddressState, GeoSource, GeoStatus, LatLng, PlaceRow } from "./types";
import { GEO_STATUSES } from "./types";

export function isGeoStatus(v: unknown): v is GeoStatus {
  return typeof v === "string" && (GEO_STATUSES as readonly string[]).includes(v);
}
export function isGeoSource(v: unknown): v is GeoSource {
  return v === "geocode" || v === "pin" || v === "override";
}

export function statusFromPrecision(p: "building" | "city"): GeoStatus {
  return p === "building" ? "verified" : "needs_check";
}

/** Free text has no stated city to gate on: a hit verifies only when it
 *  resolved to a house number; any other hit is town/street level. */
export function statusOfFreeTextHit(hit: { street: string } | null | undefined): GeoStatus {
  if (!hit) return "unresolved";
  return /\d/.test(hit.street || "") ? "verified" : "needs_check";
}

export type VenueSpot = {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  lat?: string | number | null;
  lng?: string | number | null;
};

const t = (v: unknown) => String(v ?? "").trim();

function coordsOf(row: VenueSpot): LatLng | null {
  const lat = t(row.lat);
  const lng = t(row.lng);
  if (!lat || !lng) return null;
  const a = Number(lat);
  const b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) ? { lat: a, lng: b } : null;
}

/** The one-time backfill mapping (spec): building-level lat/lng → verified,
 *  city-level → needs_check, none → unresolved. */
export function backfillStatus(row: VenueSpot): GeoStatus {
  if (!coordsOf(row)) return "unresolved";
  return statusFromPrecision(precisionOf({ address: row.address ?? null }));
}

/** Stored status, else the backfill rule (a row stamped before this feature
 *  shipped reads correctly before ensureVenueGeoStatus has run). */
export function venueGeoStatus(row: VenueSpot & { geoStatus?: string | null }): GeoStatus {
  return isGeoStatus(row.geoStatus) ? row.geoStatus : backfillStatus(row);
}

export function formatVenueAddress(row: VenueSpot): string {
  return [t(row.address), t(row.city), [t(row.state), t(row.zip)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

export function venueAddressState(row: VenueSpot & { id: string; geoStatus?: string | null }): AddressState {
  const status = venueGeoStatus(row);
  const c = coordsOf(row);
  return {
    status,
    label: formatVenueAddress(row),
    point: status === "verified" && c ? c : null,
    pointKey: "site:" + row.id,
    fix: { kind: "venue", siteId: row.id },
  };
}

export function placeAddressState(text: string, row: PlaceRow | null | undefined): AddressState {
  const label = t(text);
  const key = addressKey(label);
  if (!key) return { status: "unresolved", label, point: null, pointKey: null, fix: null };
  const status: GeoStatus = row ? row.status : "unresolved";
  const point = status === "verified" && row && row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : null;
  return { status: point ? "verified" : status === "verified" ? "unresolved" : status, label, point, pointKey: "place:" + key, fix: { kind: "place", key, label } };
}

export function placeRowFromHit(
  key: string,
  label: string,
  hit: { street: string; lat: number; lng: number } | null | undefined,
  now: number
): PlaceRow {
  const status = statusOfFreeTextHit(hit);
  return {
    key,
    label,
    lat: hit ? hit.lat : null,
    lng: hit ? hit.lng : null,
    status,
    source: "geocode",
    verifiedBy: null,
    verifiedAt: status === "verified" ? now : null,
    updatedAt: now,
  };
}

export type GeoStamp = {
  geoStatus: GeoStatus;
  geoSource: GeoSource | null;
  geoVerifiedBy: string | null;
  geoVerifiedAt: number | null;
};
export type StampedSpot = VenueSpot & {
  geoStatus?: string | null;
  geoSource?: string | null;
  geoVerifiedBy?: string | null;
  geoVerifiedAt?: number | null;
};

const lower = (v: unknown) => t(v).toLowerCase();
const sameNum = (a: LatLng | null, b: LatLng | null) =>
  (!a && !b) || (!!a && !!b && Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lng - b.lng) < 1e-7);

/**
 * The stamp saveSite writes. Same address (street/city/state — zip edits
 * don't move a venue, matching venueMoveRule) keeps the stored stamp, and a
 * pin keeps its coordinates even when the caller sends different ones.
 * Any address change resets verification: no coordinates → unresolved,
 * caller-supplied coordinates → judged by the address's precision.
 */
export function geoStampForSave(
  prev: StampedSpot | null,
  next: VenueSpot,
  now: number
): { stamp: GeoStamp; keepPrevCoords: boolean } {
  const sameAddress =
    !!prev && lower(prev.address) === lower(next.address) && lower(prev.city) === lower(next.city) && lower(prev.state) === lower(next.state);
  const pc = prev ? coordsOf(prev) : null;
  const nc = coordsOf(next);
  const prevStamp: GeoStamp | null =
    prev && isGeoStatus(prev.geoStatus)
      ? {
          geoStatus: prev.geoStatus,
          geoSource: isGeoSource(prev.geoSource) ? prev.geoSource : null,
          geoVerifiedBy: prev.geoVerifiedBy ?? null,
          geoVerifiedAt: prev.geoVerifiedAt ?? null,
        }
      : null;
  if (prev && sameAddress && prevStamp?.geoSource === "pin" && pc) {
    return { stamp: prevStamp, keepPrevCoords: !sameNum(pc, nc) };
  }
  if (prev && sameAddress && sameNum(pc, nc)) {
    return {
      stamp: prevStamp ?? { geoStatus: backfillStatus(prev), geoSource: pc ? "geocode" : null, geoVerifiedBy: null, geoVerifiedAt: null },
      keepPrevCoords: false,
    };
  }
  if (!nc) return { stamp: { geoStatus: "unresolved", geoSource: null, geoVerifiedBy: null, geoVerifiedAt: null }, keepPrevCoords: false };
  const status = backfillStatus(next);
  return {
    stamp: { geoStatus: status, geoSource: "override", geoVerifiedBy: null, geoVerifiedAt: status === "verified" ? now : null },
    keepPrevCoords: false,
  };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "drive-time|FAILED|ALL PASSED" | tail -40`
Expected: every `drive-time` line `PASS`, final line `ALL PASSED`.

- [ ] **Step 8: Gates + commit**

```bash
npx tsc --noEmit
npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/address-verify scripts/test-drive-time.ts
git add src/lib/address-verify scripts/test-drive-time.ts scripts/test-review-and-spec.ts
git commit -m "feat(drive-time): address keys + verification state rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Schema, migration, venue stamping and the venue backfill

**Files:**
- Modify: `src/db/schema.ts`, `src/lib/identity/sites.ts` (`saveSite`), `src/lib/geo-backfill.ts` (`backfillVenueCoords` write), `src/lib/venue-locate.ts` (`locateVenue`)
- Create: `drizzle/0036_address_verification.sql` (+ `drizzle/meta/0036_snapshot.json`, journal entry), `src/lib/address-verify/venue-geo.ts`
- Test: `scripts/test-drive-time.ts` (`driveTimeVenueStampChecks`)

**Interfaces:**
- Consumes: `geoStampForSave`, `backfillStatus`, `statusFromPrecision` (Task 1).
- Produces:
  - `sites` columns `geoStatus: text("geo_status")`, `geoSource: text("geo_source")`, `geoVerifiedBy: text("geo_verified_by")`, `geoVerifiedAt: bigint("geo_verified_at", { mode: "number" })`; table `placeBook` (`place_book`) with `key` PK, `label`, `lat`/`lng` doublePrecision, `status`, `source`, `verifiedBy`, `verifiedAt`, `updatedAt`.
  - `ensureVenueGeoStatus(opts?: { limit?: number }): Promise<{ stamped: number }>`.
  - `locateVenue(input: LocateInput, opts?: { delayMs?: number; by?: string | null }): Promise<LocateResult>` — `LocateResult` ok branch gains `status: GeoStatus`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-drive-time.ts` (add imports at top of file):

```ts
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { sites } from "@/db/schema";
import { saveSite } from "@/lib/identity/sites";
import { ensureVenueGeoStatus } from "@/lib/address-verify/venue-geo";
import { locateVenue } from "@/lib/venue-locate";

export async function driveTimeVenueStampChecks(ok: Ok): Promise<void> {
  const db = await getDb();
  const ID = "TESTdrive:site-1";
  const CO = "TESTdrive:co";
  // locateVenue warms an OSRM route after a fix — keep the suite offline.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("offline in test");
  }) as typeof fetch;
  try {
    await saveSite({ id: ID, companyId: CO, name: "Stage", address: "605 Erie Ave", city: "Sheboygan", state: "WI", zip: "53081", lat: "43.75", lng: "-87.71", venueKind: "proscenium" });
    let [r] = await db.select().from(sites).where(eq(sites.id, ID));
    ok(r.geoStatus === "verified" && r.geoSource === "override", "drive-time saveSite: a new building-level venue with form coords stamps verified");

    // Pin it through the Fix path, then re-save the same address with other coords.
    const pin = await locateVenue({ siteId: ID, mode: "pin", lat: 43.7512, lng: -87.7133 }, { by: "u1" });
    ok(pin.ok && pin.status === "verified", "drive-time locateVenue: a dropped pin reports verified");
    [r] = await db.select().from(sites).where(eq(sites.id, ID));
    ok(r.geoSource === "pin" && r.geoVerifiedBy === "u1" && typeof r.geoVerifiedAt === "number", "drive-time locateVenue: pin stamps source/who/when");
    await saveSite({ ...r, lat: "43.1", lng: "-87.1" });
    [r] = await db.select().from(sites).where(eq(sites.id, ID));
    ok(r.lat === "43.7512" && r.geoSource === "pin", "drive-time saveSite: the same address never overwrites a pin");

    // A save that omits lat/lng keys treats them as unchanged.
    await saveSite({ id: ID, companyId: CO, name: "Stage renamed", venueKind: "proscenium" });
    [r] = await db.select().from(sites).where(eq(sites.id, ID));
    ok(r.geoSource === "pin" && r.lat === "43.7512", "drive-time saveSite: a partial save keeps the stamp and coords");

    // Editing the address resets verification.
    await saveSite({ ...r, address: "1 New St", lat: null, lng: null });
    [r] = await db.select().from(sites).where(eq(sites.id, ID));
    ok(r.geoStatus === "unresolved" && r.geoSource === null, "drive-time saveSite: editing the address resets to unresolved");

    // Backfill: only NULL rows, idempotent.
    await db.update(sites).set({ geoStatus: null, geoSource: null, address: "605 Erie Ave", lat: "43.75", lng: "-87.71" }).where(eq(sites.id, ID));
    const first = await ensureVenueGeoStatus();
    [r] = await db.select().from(sites).where(eq(sites.id, ID));
    ok(first.stamped >= 1 && r.geoStatus === "verified" && r.geoSource === "geocode", "drive-time backfill: an unstamped building-level venue becomes verified");
    const second = await ensureVenueGeoStatus();
    ok(second.stamped === 0, "drive-time backfill: a second run stamps nothing");
  } finally {
    globalThis.fetch = realFetch;
    await db.delete(sites).where(eq(sites.id, ID));
  }
}
```

Add `driveTimeVenueStampChecks` to the harness import line and `.then(() => driveTimeVenueStampChecks(ok))` to the chain.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: TypeScript/tsx error — `placeBook` not exported / `geoStatus` does not exist.

- [ ] **Step 3: Edit `src/db/schema.ts`**

Change the import line to add `doublePrecision`:

```ts
import { pgTable, text, boolean, bigint, integer, jsonb, index, primaryKey, doublePrecision } from "drizzle-orm/pg-core";
```

In the `sites` table, after `travelMin: text("travel_min"),` add:

```ts
    /** Address verification (spec 2026-10-09): "verified" | "needs_check" |
     *  "unresolved". NULL = never stamped — readers fall back to
     *  venueGeoStatus() and ensureVenueGeoStatus() stamps it. Only
     *  "verified" gets drive time. */
    geoStatus: text("geo_status"),
    /** "geocode" | "pin" | "override" — where lat/lng came from. A pin is
     *  never overwritten by the geocoder. */
    geoSource: text("geo_source"),
    /** users.id of the person who verified it (a pin or a hand Fix). */
    geoVerifiedBy: text("geo_verified_by"),
    geoVerifiedAt: bigint("geo_verified_at", { mode: "number" }),
```

and add `index("sites_geo_status_idx").on(t.geoStatus),` to the sites index list. After the `NewSiteRow` type export add:

```ts
/**
 * Place book (spec 2026-10-09) — every non-venue address the scheduler
 * touches (site visits without a venue, lead addresses, Google event
 * locations), one row per EXACT normalized key (lib/address-verify/keys
 * addressKey). Fixing an address once fixes every record carrying that text.
 * Not a doc collection: never wiped by the go-live reset, never synced.
 */
export const placeBook = pgTable(
  "place_book",
  {
    key: text("key").primaryKey(),
    /** Original text as first seen. */
    label: text("label").notNull(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    status: text("status").notNull(),
    /** "geocode" | "pin" */
    source: text("source").notNull(),
    verifiedBy: text("verified_by"),
    verifiedAt: bigint("verified_at", { mode: "number" }),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [index("place_book_status_idx").on(t.status)]
);
export type PlaceBookRow = typeof placeBook.$inferSelect;
```

- [ ] **Step 4: Generate and harden the migration**

Run: `npm run db:generate -- --name address_verification`
Expected: `drizzle/0036_address_verification.sql` plus `drizzle/meta/0036_snapshot.json` and a journal entry. (drizzle-kit reads the schema only — it does not open `.data/pglite`.)

Replace the SQL file's contents with the hardened form (keep the generated meta files as-is):

```sql
-- Address verification + drive time (spec
-- docs/superpowers/specs/2026-10-09-address-verification-drive-time-design.md):
-- four sites columns for the venue verification stamp and the place_book
-- table for every non-venue address. The one-time venue backfill runs in JS
-- (src/lib/address-verify/venue-geo.ts ensureVenueGeoStatus) because the
-- building/city rule is geo-backfill's precisionOf, which SQL would drift
-- from; until it runs, readers fall back to the same rule.
--
-- Generated by drizzle-kit, then hardened so it is idempotent per D141 (the
-- shared Neon database is migrated by more than one branch's build).
-- Renumber at merge if another branch lands a 0036 first.
CREATE TABLE IF NOT EXISTS "place_book" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"verified_by" text,
	"verified_at" bigint,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "geo_status" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "geo_source" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "geo_verified_by" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "geo_verified_at" bigint;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "place_book_status_idx" ON "place_book" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sites_geo_status_idx" ON "sites" USING btree ("geo_status");
```

If drizzle-kit emitted statements in a different order or with different index names, keep its names but make every statement `IF NOT EXISTS`.

- [ ] **Step 5: Stamp in `saveSite` (`src/lib/identity/sites.ts`)**

Add `import { geoStampForSave } from "@/lib/address-verify/state";` and replace `saveSite` with:

```ts
/**
 * Upsert one venue. Address verification (spec 2026-10-09): the geo stamp is
 * always computed here from the stored row — callers' geo fields are ignored
 * — so every write path (venue dialog, company modal, convert) resets
 * verification on an address edit and can never overwrite a pin. Keys the
 * caller omits (undefined) count as unchanged.
 */
export async function saveSite(
  row: Omit<NewSiteRow, "createdAt" | "updatedAt"> & {
    createdAt?: number;
    updatedAt?: number;
  }
): Promise<void> {
  const db = await getDb();
  const t = Date.now();
  const [prev] = await db.select().from(sites).where(eq(sites.id, row.id)).limit(1);
  const given = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
  const merged = prev ? { ...prev, ...given } : row;
  const { stamp, keepPrevCoords } = geoStampForSave(prev ?? null, merged, t);
  const full = { ...row, ...stamp, ...(keepPrevCoords && prev ? { lat: prev.lat, lng: prev.lng } : {}) };
  const rest: Partial<NewSiteRow> = { ...full };
  delete rest.id;
  delete rest.createdAt;
  delete rest.updatedAt;
  await db
    .insert(sites)
    .values({ ...full, createdAt: row.createdAt ?? t, updatedAt: t })
    .onConflictDoUpdate({
      target: sites.id,
      set: { ...rest, deleted: rest.deleted ?? false, updatedAt: t },
    });
}
```

- [ ] **Step 6: Stamp the batch geocoder (`src/lib/geo-backfill.ts`)**

Do **not** import from `@/lib/address-verify/state` here — `state.ts` imports `precisionOf` from this file, so that would be an import cycle. Inline the one-line rule instead. In `backfillVenueCoords`, replace the per-row update:

```ts
      if (!dryRun) {
        const verified = out.precision === "building";
        await db
          .update(sites)
          .set({
            lat: String(out.lat),
            lng: String(out.lng),
            // Address verification (spec 2026-10-09): building → verified,
            // city → needs_check. Same rule as address-verify/state
            // statusFromPrecision (not imported: state.ts imports this file).
            geoStatus: verified ? "verified" : "needs_check",
            geoSource: "geocode",
            geoVerifiedBy: null,
            geoVerifiedAt: verified ? Date.now() : null,
            updatedAt: Date.now(),
          })
          // A pin always has coordinates, so it is never a candidate here —
          // this guard keeps it that way if candidate selection ever changes.
          .where(and(eq(sites.id, r.id), or(isNull(sites.geoSource), ne(sites.geoSource, "pin"))));
      }
```

(`and`, `or`, `isNull`, `ne` are already imported in that file.)

- [ ] **Step 7: Stamp the one-venue fixer (`src/lib/venue-locate.ts`)**

Add imports `import { statusFromPrecision } from "@/lib/address-verify/state";` and `import type { GeoStatus } from "@/lib/address-verify/types";`. Change the ok branch of `LocateResult` to include `status: GeoStatus;`. Change the signature to `opts?: { delayMs?: number; by?: string | null }`. Just before `set.lat = String(lat);` add:

```ts
  // Address verification (spec 2026-10-09). A Fix is deliberate, so it may
  // replace a pin; a pin is always verified; retry/pick are judged by
  // precision and credited to the person who ran them when they verify.
  const status: GeoStatus = input.mode === "pin" ? "verified" : statusFromPrecision(precision);
  const by = opts?.by ?? null;
  Object.assign(set, {
    geoStatus: status,
    geoSource: input.mode === "pin" ? "pin" : "geocode",
    geoVerifiedBy: status === "verified" ? by : null,
    geoVerifiedAt: status === "verified" ? Date.now() : null,
  });
```

and add `status,` to the returned ok object.

- [ ] **Step 8: Write `src/lib/address-verify/venue-geo.ts`**

```ts
/**
 * One-time, idempotent venue backfill (spec 2026-10-09): stamps
 * sites.geo_status on every row that has none, by backfillStatus (building
 * lat/lng → verified, city → needs_check, none → unresolved). Touches only
 * NULL rows, so a second run is a no-op; leaves updatedAt alone (metadata
 * stamp, not an edit). Called by the worklist, the drive loader's cron rider
 * and anything that filters on geo_status in SQL.
 */
import { and, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { sites } from "@/db/schema";
import { backfillStatus } from "./state";
import type { GeoStatus } from "./types";

export async function ensureVenueGeoStatus(opts?: { limit?: number }): Promise<{ stamped: number }> {
  const db = await getDb();
  const rows = await db
    .select({ id: sites.id, address: sites.address, lat: sites.lat, lng: sites.lng })
    .from(sites)
    .where(isNull(sites.geoStatus))
    .limit(opts?.limit ?? 5000);
  const byStatus = new Map<GeoStatus, string[]>();
  for (const r of rows) {
    const s = backfillStatus(r);
    const list = byStatus.get(s) ?? [];
    list.push(r.id);
    byStatus.set(s, list);
  }
  let stamped = 0;
  for (const [status, ids] of byStatus) {
    for (let i = 0; i < ids.length; i += 500) {
      const done = await db
        .update(sites)
        .set({ geoStatus: status, geoSource: status === "unresolved" ? null : "geocode" })
        .where(and(inArray(sites.id, ids.slice(i, i + 500)), isNull(sites.geoStatus)))
        .returning({ id: sites.id });
      stamped += done.length;
    }
  }
  return { stamped };
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "drive-time|FAILED|ALL PASSED" | tail -40` → all PASS, `ALL PASSED`.
Run: `npm run test:geo-backfill 2>&1 | tail -3` and `npm run test:drive-distance 2>&1 | tail -3` → both end in their PASS summary (fetch is stubbed, scratch datadir).

- [ ] **Step 10: Gates + commit**

```bash
npx tsc --noEmit
npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/db/schema.ts src/lib/identity/sites.ts src/lib/geo-backfill.ts src/lib/venue-locate.ts src/lib/address-verify scripts/test-drive-time.ts
git add src/db/schema.ts drizzle src/lib/identity/sites.ts src/lib/geo-backfill.ts src/lib/venue-locate.ts src/lib/address-verify scripts/test-drive-time.ts scripts/test-review-and-spec.ts
git commit -m "feat(drive-time): venue geo stamp columns, place_book table, venue backfill

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Place book, strict geocoder, visit address states, the fix service

**Files:**
- Modify: `src/lib/geo.ts` (add `searchOrThrow`; `search` wraps it)
- Create: `src/lib/address-verify/place-book.ts`, `src/lib/address-verify/targets.ts`, `src/lib/address-verify/fix.ts`
- Test: `scripts/test-drive-time.ts` (`driveTimePlaceBookChecks`, `driveTimeFixChecks`)

**Interfaces:**
- Consumes: Task 1 (`addressKey`, `placeAddressState`, `placeRowFromHit`, `statusOfFreeTextHit`, `venueAddressState`, types), Task 2 (`placeBook`, `locateVenue(input, { by })`, `sites` geo columns).
- Produces:
  - `geo.ts`: `searchOrThrow(query: string | null | undefined, opts?: { limit?: number }): Promise<GeoSearchHit[]>` — throws when Nominatim is unreachable/erroring; `[]` only for a real empty answer.
  - `place-book.ts`: `type PlaceDeps = { search: (q: string) => Promise<GeoSearchHit[]>; delayMs: number; budgetMs: number; now: () => number; sleep: (ms: number) => Promise<void> }`; `getPlaces(keys: string[]): Promise<Map<string, PlaceRow>>`; `writePlace(row: PlaceRow, opts: { overwritePin: boolean }): Promise<void>`; `placeStatesFor(texts: string[], mode: "cache" | "live", deps?: Partial<PlaceDeps>): Promise<Map<string, AddressState>>` (keyed by `addressKey(text)`); `type PlaceFixInput`; `type FixResult = { ok: true; status: GeoStatus; lat: number; lng: number } | { ok: false; reason: "no-hit" | "unavailable" | "invalid" }`; `fixPlace(input: PlaceFixInput, by: string, deps?: Partial<PlaceDeps>): Promise<FixResult>`.
  - `targets.ts`: `matchVisitSite<T extends { id: string; companyId: string; legacyLocId: string | null }>(v: { customerId: string | null; locationId: string | null }, rows: T[]): T | null`; `type VisitAddressInput = { id: string; customerId: string | null; locationId: string | null; address: string }`; `addressStatesForVisits(visits: VisitAddressInput[], mode: "cache" | "live", deps?: Partial<PlaceDeps>): Promise<Map<string, AddressState>>` (keyed by visit id).
  - `fix.ts`: `type FixAddressInput` (6-variant union below); `type FixAddressResult = { ok: true; status: GeoStatus; pointKey: string } | { ok: false; reason: string; got?: string }`; `cleanFixInput(raw: unknown): FixAddressInput | null`; `fixAddress(input: FixAddressInput, by: string, deps?: Partial<PlaceDeps>): Promise<FixAddressResult>`; `type FixTargetDetails = { title: string; sub: string; href: string; status: GeoStatus; venue: { address: string; city: string; state: string; zip: string } | null; placeText: string | null }`; `loadFixTarget(target: FixTarget): Promise<FixTargetDetails | null>`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-drive-time.ts` (merge imports into the existing import lines at the top: `like` into the drizzle import, `placeBook` into the schema import):

```ts
import { getPlaces, placeStatesFor, writePlace, fixPlace } from "@/lib/address-verify/place-book";
import { addressStatesForVisits, matchVisitSite } from "@/lib/address-verify/targets";
import { cleanFixInput, fixAddress } from "@/lib/address-verify/fix";
import type { GeoSearchHit } from "@/lib/geo";

const hit = (street: string, lat = 44.3, lng = -88.6): GeoSearchHit => ({
  title: street, sub: street, name: "", street, city: "Hortonville", state: "WI", zip: "54944", lat, lng, display: street,
});
const fastDeps = (search: (q: string) => Promise<GeoSearchHit[]>) => ({
  search, delayMs: 0, budgetMs: 60_000, now: () => 1_790_000_000_000, sleep: async () => {},
});

export async function driveTimePlaceBookChecks(ok: Ok): Promise<void> {
  const db = await getDb();
  try {
    const A = "TESTdrive 1 School Rd, Hortonville WI";
    const B = "TESTdrive Main St, Hortonville WI";
    const C = "TESTdrive Down Server Rd";
    const cache = await placeStatesFor([A], "cache");
    ok(cache.get(addressKey(A))?.status === "unresolved" && (await getPlaces([addressKey(A)])).size === 0,
      "drive-time place book: cache mode never geocodes and never writes");

    let calls = 0;
    const search = async (q: string) => {
      calls++;
      if (q.includes("Down Server")) throw new Error("Nominatim 503");
      return q.includes("1 School") ? [hit("1 School Rd")] : [hit("Main St")];
    };
    const live = await placeStatesFor([A, B, C, "  " + A.toUpperCase() + "  "], "live", fastDeps(search));
    ok(calls === 3, "drive-time place book: duplicate spellings of one key geocode once");
    ok(live.get(addressKey(A))?.status === "verified" && live.get(addressKey(A))?.point?.lat === 44.3,
      "drive-time place book: a building-level hit writes back verified");
    ok(live.get(addressKey(B))?.status === "needs_check", "drive-time place book: a street-only hit is stored needs_check");
    const rows = await getPlaces([addressKey(A), addressKey(B), addressKey(C)]);
    ok(rows.get(addressKey(B))?.status === "needs_check" && !rows.has(addressKey(C)) && live.get(addressKey(C))?.status === "unresolved",
      "drive-time place book: a geocoder outage writes nothing (unresolved for now, retried next sync)");
    calls = 0;
    await placeStatesFor([A, B], "live", fastDeps(search));
    ok(calls === 0, "drive-time place book: known keys are read from the book, not re-geocoded");

    // Pin, then a geocode write must not overwrite it.
    const pin = await fixPlace({ key: addressKey(B), label: B, mode: "pin", lat: 44.31, lng: -88.61 }, "u1", fastDeps(search));
    ok(pin.ok && pin.status === "verified", "drive-time place book: a dropped pin verifies");
    await writePlace({ ...rows.get(addressKey(B))!, lat: 1, lng: 1, status: "needs_check", source: "geocode" }, { overwritePin: false });
    const afterPin = (await getPlaces([addressKey(B)])).get(addressKey(B));
    ok(afterPin?.source === "pin" && afterPin.lat === 44.31 && afterPin.verifiedBy === "u1",
      "drive-time place book: a geocode write never overwrites a pin");

    // Retype under the ORIGINAL key — the same text never flags again.
    const D = "TESTdrive Lone Pine School";
    const fixed = await fixPlace({ key: addressKey(D), label: D, mode: "retry", text: "1 School Rd, Hortonville WI" }, "u2", fastDeps(search));
    const dRow = (await getPlaces([addressKey(D)])).get(addressKey(D));
    ok(fixed.ok && dRow?.status === "verified" && dRow.label === D && dRow.verifiedBy === "u2",
      "drive-time place book: a retyped fix is stored under the original text's key");
    const none = await fixPlace({ key: addressKey(D), label: D, mode: "retry", text: "TESTdrive Down Server Rd" }, "u2", fastDeps(search));
    ok(!none.ok && none.reason === "unavailable" && (await getPlaces([addressKey(D)])).get(addressKey(D))?.status === "verified",
      "drive-time place book: a failed retry leaves the stored row alone");
    const bad = await fixPlace({ key: "Not A Key!", label: D, mode: "pin", lat: 44, lng: -88 }, "u2", fastDeps(search));
    ok(!bad.ok && bad.reason === "invalid", "drive-time place book: a key that isn't its own normalized form is refused");
  } finally {
    await db.delete(placeBook).where(like(placeBook.key, "testdrive%"));
  }
}

export async function driveTimeFixChecks(ok: Ok): Promise<void> {
  const db = await getDb();
  const SITE = "TESTdrive:site-fix";
  const CO = "TESTdrive:co-fix";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("offline in test");
  }) as typeof fetch;
  try {
    await saveSite({ id: SITE, companyId: CO, legacyLocId: "loc7", name: "Gym", address: "", city: "Hortonville", state: "WI", lat: "44.33", lng: "-88.63", venueKind: "proscenium" });
    ok(matchVisitSite({ customerId: CO, locationId: "loc7" }, [{ id: SITE, companyId: CO, legacyLocId: "loc7" }])?.id === SITE &&
       matchVisitSite({ customerId: "other", locationId: "loc7" }, [{ id: SITE, companyId: CO, legacyLocId: "loc7" }]) === null,
      "drive-time: a visit's venue matches by legacyLocId or id, within its own company");
    const states = await addressStatesForVisits(
      [
        { id: "SV-T1", customerId: CO, locationId: "loc7", address: "ignored" },
        { id: "SV-T2", customerId: null, locationId: null, address: "TESTdrive 9 Elm St" },
        { id: "SV-T3", customerId: null, locationId: null, address: "" },
      ],
      "cache"
    );
    ok(states.get("SV-T1")?.status === "needs_check" && states.get("SV-T1")?.fix?.kind === "venue",
      "drive-time: a venue-linked visit takes the venue's state (city-level → needs_check)");
    ok(states.get("SV-T2")?.fix?.kind === "place" && states.get("SV-T2")?.status === "unresolved",
      "drive-time: a visit without a venue goes through the place book");
    ok(states.get("SV-T3")?.status === "unresolved" && states.get("SV-T3")?.fix === null, "drive-time: a visit with no address has nothing to fix");

    const r = await fixAddress({ target: { kind: "venue", siteId: SITE }, mode: "pin", lat: 44.3301, lng: -88.6302 }, "u1");
    const [row] = await db.select().from(sites).where(eq(sites.id, SITE));
    ok(r.ok && r.status === "verified" && r.pointKey === "site:" + SITE && row.geoSource === "pin",
      "drive-time fixAddress: a venue pin writes the venue (verified, source pin)");

    ok(cleanFixInput({ target: { kind: "venue", siteId: SITE }, mode: "pin", lat: 44, lng: -88 }) !== null, "drive-time cleanFixInput: a well-formed pin passes");
    ok(cleanFixInput({ target: { kind: "venue", siteId: SITE }, mode: "pin", lat: 200, lng: -88 }) === null &&
       cleanFixInput({ target: { kind: "place", key: "x" }, mode: "retry" }) === null &&
       cleanFixInput({ target: { kind: "bogus" }, mode: "pin", lat: 1, lng: 1 }) === null &&
       cleanFixInput("junk") === null,
      "drive-time cleanFixInput: out-of-range coords, missing fields and unknown kinds are refused");
  } finally {
    globalThis.fetch = realFetch;
    await db.delete(sites).where(eq(sites.id, SITE));
  }
}
```

Add both names to the harness import and chain (`.then(() => driveTimePlaceBookChecks(ok))`, `.then(() => driveTimeFixChecks(ok))`).

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: `Cannot find module '@/lib/address-verify/place-book'`.

- [ ] **Step 3: Add `searchOrThrow` to `src/lib/geo.ts`**

Replace the existing `search` function with:

```ts
/**
 * Like search(), but THROWS when Nominatim can't be reached or answers with
 * an error, and returns [] only for a real "no match". The place book
 * (lib/address-verify/place-book.ts) needs the difference: an outage must
 * never be stored as "unresolved" (spec 2026-10-09 — flag, never guess).
 */
export async function searchOrThrow(
  query: string | null | undefined,
  opts?: { limit?: number }
): Promise<GeoSearchHit[]> {
  const q = (query || "").trim();
  if (q.length < 3) return [];
  if (!online()) throw new Error("offline");
  const limit = (opts && opts.limit) || 5;
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=us&limit=" +
    limit + "&q=" + encodeURIComponent(q);
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      // Nominatim usage policy asks server clients to identify themselves.
      "User-Agent": "peak-app/1.0 (Peak Systems Group travel estimates)",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error("Nominatim " + res.status);
  const j = (await res.json()) as NominatimHit[] | null;
  return (j || []).map(normalizeHit).filter((x): x is GeoSearchHit => !!x);
}

/**
 * Search an address string -> up to `limit` normalized suggestions.
 * Empty array on short query / failure / timeout (fail soft).
 */
export async function search(
  query: string | null | undefined,
  opts?: { limit?: number }
): Promise<GeoSearchHit[]> {
  try {
    return await searchOrThrow(query, opts);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Write `src/lib/address-verify/place-book.ts`**

```ts
/**
 * Place book (spec 2026-10-09) — every non-venue address, one row per EXACT
 * normalized key. Resolution order for free text: book (exact key) →
 * geocoder; every answer is written back with its status so the worklist can
 * show it; a geocoder OUTAGE writes nothing (the next live pass retries).
 * Geocode writes never overwrite a pin; a Fix (retry/pick/pin) is deliberate
 * and may.
 */
import { inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { placeBook, type PlaceBookRow } from "@/db/schema";
import { FETCH_TIMEOUT_MS, searchOrThrow, type GeoSearchHit } from "@/lib/geo";
import { addressKey } from "./keys";
import { isGeoStatus, placeAddressState, placeRowFromHit, statusOfFreeTextHit } from "./state";
import type { AddressState, GeoStatus, PlaceRow } from "./types";

/** Nominatim asks for <= 1 request/second. */
export const PLACE_DELAY_MS = 1100;

export type PlaceDeps = {
  search: (q: string) => Promise<GeoSearchHit[]>;
  delayMs: number;
  budgetMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

function defaultDeps(): PlaceDeps {
  return {
    search: (q) => searchOrThrow(q, { limit: 1 }),
    delayMs: PLACE_DELAY_MS,
    budgetMs: 20_000,
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

function toRow(r: PlaceBookRow): PlaceRow {
  return {
    key: r.key,
    label: r.label,
    lat: r.lat ?? null,
    lng: r.lng ?? null,
    status: isGeoStatus(r.status) ? r.status : "unresolved",
    source: r.source === "pin" ? "pin" : "geocode",
    verifiedBy: r.verifiedBy ?? null,
    verifiedAt: r.verifiedAt ?? null,
    updatedAt: r.updatedAt,
  };
}

export async function getPlaces(keys: string[]): Promise<Map<string, PlaceRow>> {
  const out = new Map<string, PlaceRow>();
  const uniq = [...new Set(keys.filter(Boolean))];
  if (!uniq.length) return out;
  const db = await getDb();
  for (let i = 0; i < uniq.length; i += 500) {
    const rows = await db.select().from(placeBook).where(inArray(placeBook.key, uniq.slice(i, i + 500)));
    for (const r of rows) out.set(r.key, toRow(r));
  }
  return out;
}

/** Upsert one row. The label is the text as FIRST seen — never replaced. */
export async function writePlace(row: PlaceRow, opts: { overwritePin: boolean }): Promise<void> {
  const db = await getDb();
  const set = {
    lat: row.lat,
    lng: row.lng,
    status: row.status,
    source: row.source,
    verifiedBy: row.verifiedBy,
    verifiedAt: row.verifiedAt,
    updatedAt: row.updatedAt,
  };
  await db
    .insert(placeBook)
    .values({ key: row.key, label: row.label, ...set })
    .onConflictDoUpdate({
      target: placeBook.key,
      set,
      ...(opts.overwritePin ? {} : { setWhere: sql`${placeBook.source} <> 'pin'` }),
    });
}

/**
 * Address states for free texts, keyed by addressKey(text). "cache" reads
 * the book only (page views); "live" geocodes unknown keys serially, paced
 * and budgeted (syncs, booking checks).
 */
export async function placeStatesFor(
  texts: string[],
  mode: "cache" | "live",
  deps?: Partial<PlaceDeps>
): Promise<Map<string, AddressState>> {
  const d = { ...defaultDeps(), ...deps };
  const byKey = new Map<string, string>();
  for (const raw of texts) {
    const label = String(raw ?? "").trim().slice(0, 300);
    const k = addressKey(label);
    if (k && !byKey.has(k)) byKey.set(k, label);
  }
  const known = await getPlaces([...byKey.keys()]);
  if (mode === "live") {
    const start = d.now();
    let n = 0;
    for (const [key, label] of byKey) {
      if (known.has(key)) continue;
      if (n > 0 && d.now() - start + d.delayMs + FETCH_TIMEOUT_MS > d.budgetMs) break;
      if (n > 0) await d.sleep(d.delayMs);
      n++;
      let hits: GeoSearchHit[];
      try {
        hits = await d.search(label);
      } catch {
        continue; // outage: write nothing, the next live pass retries
      }
      const row = placeRowFromHit(key, label, hits[0], d.now());
      await writePlace(row, { overwritePin: false });
      known.set(key, (await getPlaces([key])).get(key) ?? row);
    }
  }
  const out = new Map<string, AddressState>();
  for (const [key, label] of byKey) out.set(key, placeAddressState(label, known.get(key)));
  return out;
}

export type PlaceFixInput =
  | { key: string; label: string; mode: "retry"; text: string }
  | { key: string; label: string; mode: "pick"; street: string; lat: number; lng: number }
  | { key: string; label: string; mode: "pin"; lat: number; lng: number };

export type FixResult =
  | { ok: true; status: GeoStatus; lat: number; lng: number }
  | { ok: false; reason: "no-hit" | "unavailable" | "invalid" };

const validCoord = (lat: unknown, lng: unknown): boolean =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) &&
  lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

/** A Fix on a place-book entry. Always written under the ORIGINAL key, so
 *  the record's own text never flags again (spec "Fixing an address"). */
export async function fixPlace(input: PlaceFixInput, by: string, deps?: Partial<PlaceDeps>): Promise<FixResult> {
  const d = { ...defaultDeps(), ...deps };
  const key = String(input.key ?? "");
  if (!key || addressKey(key) !== key) return { ok: false, reason: "invalid" };
  const label = String(input.label ?? "").trim().slice(0, 300) || key;
  const now = d.now();
  let lat: number;
  let lng: number;
  let status: GeoStatus;
  let source: "geocode" | "pin" = "geocode";
  if (input.mode === "retry") {
    const text = String(input.text ?? "").trim().slice(0, 300);
    if (text.length < 3) return { ok: false, reason: "invalid" };
    let hits: GeoSearchHit[];
    try {
      hits = await d.search(text);
    } catch {
      return { ok: false, reason: "unavailable" };
    }
    if (!hits[0]) return { ok: false, reason: "no-hit" };
    lat = hits[0].lat;
    lng = hits[0].lng;
    status = statusOfFreeTextHit(hits[0]);
  } else if (input.mode === "pick" || input.mode === "pin") {
    if (!validCoord(input.lat, input.lng)) return { ok: false, reason: "invalid" };
    lat = input.lat;
    lng = input.lng;
    if (input.mode === "pin") {
      status = "verified";
      source = "pin";
    } else {
      status = statusOfFreeTextHit({ street: String(input.street ?? "") });
    }
  } else {
    return { ok: false, reason: "invalid" };
  }
  await writePlace(
    {
      key,
      label,
      lat,
      lng,
      status,
      source,
      verifiedBy: status === "verified" ? by : null,
      verifiedAt: status === "verified" ? now : null,
      updatedAt: now,
    },
    { overwritePin: true }
  );
  return { ok: true, status, lat, lng };
}
```

- [ ] **Step 5: Write `src/lib/address-verify/targets.ts`**

```ts
/**
 * Address states for site visits (spec "Site visits"): linked to a venue →
 * the venue's state; otherwise its own address text through the place book.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { sites } from "@/db/schema";
import { addressKey } from "./keys";
import { placeStatesFor, type PlaceDeps } from "./place-book";
import { placeAddressState, venueAddressState } from "./state";
import type { AddressState } from "./types";

/** A visit's locationId is the company-scoped CustomerLocation id —
 *  sites.legacyLocId when present, else sites.id (D85). */
export function matchVisitSite<T extends { id: string; companyId: string; legacyLocId: string | null }>(
  v: { customerId: string | null; locationId: string | null },
  rows: T[]
): T | null {
  if (!v.locationId) return null;
  return (
    rows.find(
      (s) => (!v.customerId || s.companyId === v.customerId) && (s.legacyLocId === v.locationId || s.id === v.locationId)
    ) ?? null
  );
}

export type VisitAddressInput = { id: string; customerId: string | null; locationId: string | null; address: string };

export async function addressStatesForVisits(
  visits: VisitAddressInput[],
  mode: "cache" | "live",
  deps?: Partial<PlaceDeps>
): Promise<Map<string, AddressState>> {
  const out = new Map<string, AddressState>();
  if (!visits.length) return out;
  const companyIds = [...new Set(visits.filter((v) => v.locationId && v.customerId).map((v) => v.customerId as string))];
  const db = await getDb();
  const siteRows = companyIds.length
    ? await db.select().from(sites).where(and(inArray(sites.companyId, companyIds), eq(sites.deleted, false)))
    : [];
  const venueFor = new Map<string, (typeof siteRows)[number]>();
  const texts: string[] = [];
  for (const v of visits) {
    const site = matchVisitSite(v, siteRows);
    if (site) venueFor.set(v.id, site);
    else texts.push(v.address || "");
  }
  const places = await placeStatesFor(texts, mode, deps);
  for (const v of visits) {
    const site = venueFor.get(v.id);
    out.set(
      v.id,
      site ? venueAddressState(site) : places.get(addressKey(v.address)) ?? placeAddressState(v.address || "", null)
    );
  }
  return out;
}
```

- [ ] **Step 6: Write `src/lib/address-verify/fix.ts`**

```ts
/**
 * The Fix dialog's server side (spec "Fixing an address"): (1) retype and
 * re-run the geocoder; (2) pick a suggestion; (3) drop a pin. A venue fix
 * writes the venue (locateVenue); anything else writes the place book.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { companies, sites } from "@/db/schema";
import { locateVenue } from "@/lib/venue-locate";
import { addressKey } from "./keys";
import { fixPlace, getPlaces, type PlaceDeps } from "./place-book";
import { venueGeoStatus } from "./state";
import type { FixTarget, GeoStatus } from "./types";

type VenueT = { kind: "venue"; siteId: string };
type PlaceT = { kind: "place"; key: string; label: string };

export type FixAddressInput =
  | { target: VenueT; mode: "retry"; address: string; city: string; state: string; zip: string }
  | { target: VenueT; mode: "pick"; address: string; city: string; state: string; zip: string; lat: number; lng: number }
  | { target: VenueT; mode: "pin"; lat: number; lng: number }
  | { target: PlaceT; mode: "retry"; text: string }
  | { target: PlaceT; mode: "pick"; street: string; lat: number; lng: number }
  | { target: PlaceT; mode: "pin"; lat: number; lng: number };

export type FixAddressResult = { ok: true; status: GeoStatus; pointKey: string } | { ok: false; reason: string; got?: string };

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : null);
const coord = (lat: unknown, lng: unknown) =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) &&
  lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

/** Untrusted server-action input → a well-formed FixAddressInput, or null. */
export function cleanFixInput(raw: unknown): FixAddressInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const t = r.target as Record<string, unknown> | undefined;
  if (!t || typeof t !== "object") return null;
  const mode = r.mode;
  if (t.kind === "venue") {
    const siteId = str(t.siteId, 200);
    if (!siteId) return null;
    const target: VenueT = { kind: "venue", siteId };
    if (mode === "pin") return coord(r.lat, r.lng) ? { target, mode, lat: r.lat as number, lng: r.lng as number } : null;
    const f = { address: str(r.address, 300), city: str(r.city, 120), state: str(r.state, 60), zip: str(r.zip, 20) };
    if (f.address == null || f.city == null || f.state == null || f.zip == null) return null;
    const fields = f as { address: string; city: string; state: string; zip: string };
    if (mode === "retry") return { target, mode, ...fields };
    if (mode === "pick") return coord(r.lat, r.lng) ? { target, mode, ...fields, lat: r.lat as number, lng: r.lng as number } : null;
    return null;
  }
  if (t.kind === "place") {
    const key = str(t.key, 300);
    const label = str(t.label, 300);
    if (!key || label == null) return null;
    const target: PlaceT = { kind: "place", key, label };
    if (mode === "pin") return coord(r.lat, r.lng) ? { target, mode, lat: r.lat as number, lng: r.lng as number } : null;
    if (mode === "retry") {
      const text = str(r.text, 300);
      return text ? { target, mode, text } : null;
    }
    if (mode === "pick") {
      const street = str(r.street, 300);
      return street != null && coord(r.lat, r.lng) ? { target, mode, street, lat: r.lat as number, lng: r.lng as number } : null;
    }
  }
  return null;
}

export async function fixAddress(input: FixAddressInput, by: string, deps?: Partial<PlaceDeps>): Promise<FixAddressResult> {
  if (input.target.kind === "venue") {
    const siteId = input.target.siteId;
    const r =
      input.mode === "pin"
        ? await locateVenue({ siteId, mode: "pin", lat: input.lat, lng: input.lng }, { by })
        : input.mode === "pick"
          ? await locateVenue({ siteId, mode: "pick", address: input.address, city: input.city, state: input.state, zip: input.zip, lat: input.lat, lng: input.lng }, { by })
          : await locateVenue({ siteId, mode: "retry", address: input.address, city: input.city, state: input.state, zip: input.zip }, { by });
    return r.ok ? { ok: true, status: r.status, pointKey: "site:" + siteId } : { ok: false, reason: r.reason, ...(r.got ? { got: r.got } : {}) };
  }
  const { key, label } = input.target;
  const r =
    input.mode === "pin"
      ? await fixPlace({ key, label, mode: "pin", lat: input.lat, lng: input.lng }, by, deps)
      : input.mode === "pick"
        ? await fixPlace({ key, label, mode: "pick", street: input.street, lat: input.lat, lng: input.lng }, by, deps)
        : await fixPlace({ key, label, mode: "retry", text: input.text }, by, deps);
  return r.ok ? { ok: true, status: r.status, pointKey: "place:" + key } : { ok: false, reason: r.reason };
}

export type FixTargetDetails = {
  title: string;
  sub: string;
  href: string;
  status: GeoStatus;
  venue: { address: string; city: string; state: string; zip: string } | null;
  placeText: string | null;
};

export async function loadFixTarget(target: FixTarget): Promise<FixTargetDetails | null> {
  if (target.kind === "venue") {
    const db = await getDb();
    const [row] = await db
      .select({ site: sites, companyName: companies.name })
      .from(sites)
      .leftJoin(companies, eq(companies.id, sites.companyId))
      .where(and(eq(sites.id, target.siteId), eq(sites.deleted, false)))
      .limit(1);
    if (!row) return null;
    const s = row.site;
    return {
      title: row.companyName || "(unknown company)",
      sub: s.name || "Untitled venue",
      href: "/companies/" + encodeURIComponent(s.companyId),
      status: venueGeoStatus(s),
      venue: { address: s.address || "", city: s.city || "", state: s.state || "", zip: s.zip || "" },
      placeText: null,
    };
  }
  const key = addressKey(target.label);
  if (!key || key !== target.key) return null;
  const row = (await getPlaces([key])).get(key);
  return { title: target.label, sub: "Address", href: "", status: row?.status ?? "unresolved", venue: null, placeText: target.label };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "drive-time|FAILED|ALL PASSED" | tail -60` → all PASS, `ALL PASSED`.
Run: `npm run test:geo-backfill 2>&1 | tail -3` → still passes (search behaviour unchanged).

- [ ] **Step 8: Gates + commit**

```bash
npx tsc --noEmit
npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/geo.ts src/lib/address-verify scripts/test-drive-time.ts
git add src/lib/geo.ts src/lib/address-verify scripts/test-drive-time.ts scripts/test-review-and-spec.ts
git commit -m "feat(drive-time): place book, strict geocoder, visit address states, fix service

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The pure drive engine (`planDay`)

**Files:**
- Create: `src/lib/drive-plan/day.ts`, `src/lib/drive-plan/stops.ts`, `src/lib/drive-plan/plan.ts`, `src/lib/drive-plan/index.ts`
- Test: `scripts/test-drive-time.ts` (`driveTimePlanChecks`)

**Interfaces:**
- Consumes: `addressKey`, `isPhysicalLocation` (Task 1 `keys.ts`), types from `address-verify/types.ts`. **No other imports** — these files are pure and `plan.ts`/`day.ts` are client-safe.
- Produces:
  - `day.ts`: `DRIVE_TZ = "America/Chicago"`; `isDayKey(v: unknown): v is string`; `chicagoDayKey(ms: number): string`; `chicagoDayStart(dayKey: string): number`; `addDays(dayKey: string, n: number): string`; `dayKeysBetween(minMs: number, maxMs: number): string[]`.
  - `stops.ts`: `visitPeople(v: { assignedTo: string; attendees?: readonly string[] | null }): string[]` (**the spec-2 seam**: when `SiteVisit.attendees` lands, every loader/trigger picks it up through this one function); `isVisitIcsCopy(ev: { id: string; iCalUID: string }, visits: ReadonlyArray<{ id: string; googleEventId?: string | null }>): boolean`; `type StopSourceVisit = { id: string; label: string; startAt: number | null; endAt: number | null; stage: string; people: string[]; googleEventId?: string | null; address: AddressState }`; `type StopSourceEvent = { id: string; iCalUID: string; title: string; startMs: number; endMs: number; allDay: boolean; location: string; selfDeclined: boolean; peakDriveKey: string; address: AddressState | null }`; `type DriveStop = { key: string; kind: "visit" | "event"; label: string; startMs: number; endMs: number; address: AddressState }` (key `sv:<visitId>` / `g:<eventId>`); `stopsForDay(args: { person: string; dayKey: string; visits: StopSourceVisit[]; events: StopSourceEvent[] }): DriveStop[]`.
  - `plan.ts`: `type DriveBase = { name: string; lat: number; lng: number }`; `type DriveFlagKind = "no_base" | "unverified" | "route_unavailable"`; `FLAG_TEXT: Record<DriveFlagKind, string>`; `type LegEnd = { kind: "base" | "stop" | "prev_stop"; key: string; label: string; point: LatLng | null; verified: boolean; fix: FixTarget | null }`; `type DriveLeg = { key: string; userId: string; dayKey: string; from: LegEnd; to: LegEnd; direction: "to_stop" | "back"; routeMin: number | null; bufferMin: number; minutes: number | null; startMs: number | null; endMs: number | null; anchorMs: number; flag: { kind: DriveFlagKind; text: string } | null; fix: FixTarget | null; tight: { needMin: number; haveMin: number; text: string } | null }` (leg key `${userId}|${dayKey}|${from.key}|${to.key}`); `type PlanDayInput = { userId: string; dayKey: string; stops: DriveStop[]; base: DriveBase | null; bufferMin: number; routeMinutes: ReadonlyMap<string, number>; prevDay: { stayOver: boolean; lastStop: DriveStop | null }; stayOver: boolean }`; `pairKey(a: LatLng, b: LatLng): string` (byte-identical to `geo.ts routeKey`); `fmtDur(min: number): string`; `planDay(input: PlanDayInput): DriveLeg[]`; `neededRoutes(input: Omit<PlanDayInput, "routeMinutes">): Array<{ from: LatLng; to: LatLng }>`; `dayDriveTotal(legs: DriveLeg[]): number`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-drive-time.ts`:

```ts
import { addDays, chicagoDayKey, chicagoDayStart, dayKeysBetween } from "@/lib/drive-plan/day";
import { isVisitIcsCopy, stopsForDay, visitPeople, type DriveStop, type StopSourceEvent, type StopSourceVisit } from "@/lib/drive-plan/stops";
import { dayDriveTotal, fmtDur, neededRoutes, pairKey, planDay, type PlanDayInput } from "@/lib/drive-plan/plan";
import { routeKey } from "@/lib/geo";
import type { AddressState } from "@/lib/address-verify/types";

const DAY = "2026-10-14"; // a Wednesday, CDT (UTC-5)
const at = (hh: number, mm = 0) => Date.UTC(2026, 9, 14, hh + 5, mm);
const okAddr = (lat: number, lng: number, key: string): AddressState => ({ status: "verified", label: key, point: { lat, lng }, pointKey: "place:" + key, fix: null });
const badAddr = (key: string): AddressState => ({ status: "needs_check", label: key, point: null, pointKey: "place:" + key, fix: { kind: "place", key, label: key } });
const stop = (key: string, start: number, end: number, address: AddressState): DriveStop => ({ key, kind: "visit", label: key, startMs: start, endMs: end, address });
const BASE = { name: "Madison Office", lat: 43.0731, lng: -89.4012 };
const P1 = { lat: 44.0, lng: -88.0 };
const P2 = { lat: 44.5, lng: -88.5 };
function routes(...pairs: Array<[{ lat: number; lng: number }, { lat: number; lng: number }, number]>) {
  return new Map(pairs.map(([a, b, m]) => [pairKey(a, b), m]));
}
function input(over: Partial<PlanDayInput>): PlanDayInput {
  return { userId: "u1", dayKey: DAY, stops: [], base: BASE, bufferMin: 15, routeMinutes: new Map(), prevDay: { stayOver: false, lastStop: null }, stayOver: false, ...over };
}

export async function driveTimePlanChecks(ok: Ok): Promise<void> {
  // Chicago days
  ok(chicagoDayKey(Date.UTC(2026, 9, 15, 4, 30)) === "2026-10-14", "drive-time day: 23:30 CDT is still that Chicago day");
  ok(chicagoDayStart("2026-10-14") === Date.UTC(2026, 9, 14, 5) && chicagoDayStart("2026-12-01") === Date.UTC(2026, 11, 1, 6) &&
     chicagoDayStart("2026-11-01") === Date.UTC(2026, 10, 1, 5),
    "drive-time day: midnight Chicago in CDT, CST and on the fall-back day");
  ok(addDays("2026-10-31", 1) === "2026-11-01" && addDays("2026-01-01", -1) === "2025-12-31", "drive-time day: addDays crosses months and years");
  ok(dayKeysBetween(at(9), at(9) + 2 * 86_400_000).join(",") === "2026-10-14,2026-10-15,2026-10-16", "drive-time day: dayKeysBetween is inclusive");
  ok(pairKey(P1, BASE) === routeKey(P1, BASE), "drive-time: pairKey is byte-identical to the geo_cache routeKey");
  ok(fmtDur(100) === "1h 40m" && fmtDur(65) === "1h 05m" && fmtDur(42) === "42m" && fmtDur(60) === "1h 00m", "drive-time: durations print as the spec's examples");

  // Stops
  ok(visitPeople({ assignedTo: "Dana", attendees: ["Jeff", "Dana", " "] }).join("|") === "Dana|Jeff" && visitPeople({ assignedTo: "" }).length === 0,
    "drive-time: visitPeople = lead + attendees, deduped (the spec-2 seam)");
  const visits: StopSourceVisit[] = [
    { id: "SV-1", label: "Lone Pine", startAt: at(9), endAt: at(10), stage: "scheduled", people: ["Dana"], address: okAddr(P1.lat, P1.lng, "a") },
    { id: "SV-2", label: "Past one", startAt: at(7), endAt: at(8), stage: "done", people: ["Dana"], address: okAddr(P2.lat, P2.lng, "b") },
    { id: "SV-3", label: "Unscheduled", startAt: null, endAt: null, stage: "claimed", people: ["Dana"], address: okAddr(1, 1, "c") },
    { id: "SV-4", label: "Someone else", startAt: at(11), endAt: at(12), stage: "scheduled", people: ["Jeff"], address: okAddr(1, 1, "d") },
    { id: "SV-5", label: "Requested w/ time", startAt: at(13), endAt: at(14), stage: "requested", people: ["Dana"], address: okAddr(1, 1, "e") },
  ];
  const ev = (id: string, over: Partial<StopSourceEvent>): StopSourceEvent => ({
    id, iCalUID: id + "@google.com", title: id, startMs: at(15), endMs: at(16), allDay: false, location: "123 Main St, Madison WI", selfDeclined: false, peakDriveKey: "", address: okAddr(43.1, -89.3, id), ...over,
  });
  const events = [
    ev("meet", {}),
    ev("allday", { allDay: true }),
    ev("noloc", { location: "" }),
    ev("zoom", { location: "https://zoom.us/j/1" }),
    ev("declined", { selfDeclined: true }),
    ev("drive", { peakDriveKey: "u1|x|a|b" }),
    ev("ics", { iCalUID: "sv-SV-1@peak-app", startMs: at(9), endMs: at(10) }),
  ];
  ok(isVisitIcsCopy({ id: "x", iCalUID: "sv-SV-1@peak-app" }, visits) && isVisitIcsCopy({ id: "g9", iCalUID: "" }, [{ id: "SV-9", googleEventId: "g9" }]) &&
     !isVisitIcsCopy({ id: "x", iCalUID: "other" }, visits), "drive-time: a visit's .ics copy (or mirrored event) is recognised");
  const stops = stopsForDay({ person: "Dana", dayKey: DAY, visits, events });
  ok(stops.map((s) => s.key).join(",") === "sv:SV-2,sv:SV-1,g:meet",
    "drive-time stops: own scheduled/done visits + timed physical events; all-day, no-location, video, declined, drive and .ics copies skipped");

  // planDay — chaining, buffer, placement
  const sA = stop("sv:A", at(9), at(10), okAddr(P1.lat, P1.lng, "A"));
  const sB = stop("sv:B", at(13), at(14), okAddr(P2.lat, P2.lng, "B"));
  const full = routes([BASE, P1, 60], [P1, P2, 40], [P2, BASE, 70]);
  const legs = planDay(input({ stops: [sB, sA], routeMinutes: full }));
  ok(legs.length === 3 && legs[0].from.kind === "base" && legs[0].to.key === "sv:A" && legs[1].to.key === "sv:B" && legs[2].to.kind === "base",
    "drive-time planDay: base → first stop → next stop → base, sorted by start");
  ok(legs[0].minutes === 75 && legs[0].endMs === at(9) && legs[0].startMs === at(9) - 75 * 60_000,
    "drive-time planDay: minutes = route + buffer; a drive-to block ends at the stop's start");
  ok(legs[2].startMs === at(14) && legs[2].endMs === at(14) + 85 * 60_000 && legs[2].direction === "back",
    "drive-time planDay: the drive-back block starts at the last stop's end");
  ok(legs[0].key === `u1|${DAY}|base|sv:A` && dayDriveTotal(legs) === 75 + 55 + 85, "drive-time planDay: leg keys + day total (buffer included)");

  // No base
  const nb = planDay(input({ stops: [sA, sB], base: null, routeMinutes: full }));
  ok(nb[0].flag?.text === "No base set" && nb[2].flag?.text === "No base set" && nb[0].minutes === null && nb[1].flag === null,
    "drive-time planDay: no base → first and last legs flagged 'No base set'");

  // Unverified end breaks the chain into and out of it
  const sBad = stop("g:bad", at(11), at(12), badAddr("bad"));
  const ub = planDay(input({ stops: [sA, sBad, sB], routeMinutes: full }));
  ok(ub[1].flag?.text === "Address not verified — no drive time" && ub[2].flag?.kind === "unverified" && ub[1].minutes === null &&
     ub[1].fix?.kind === "place" && ub[0].flag === null && ub[3].flag === null,
    "drive-time planDay: an unverified stop flags the legs into and out of it, with its Fix target");

  // Route unavailable
  const ru = planDay(input({ stops: [sA, sB], routeMinutes: routes([BASE, P1, 60]) }));
  ok(ru[1].flag?.text === "Drive time unavailable — retrying" && ru[1].startMs === null, "drive-time planDay: a missing OSRM route is flagged, never estimated");
  ok(neededRoutes(input({ stops: [sA, sB] })).length === 3, "drive-time neededRoutes: every verified pair is requested once");

  // Tight
  const sC = stop("sv:C", at(10, 30), at(11), okAddr(P2.lat, P2.lng, "C"));
  const tight = planDay(input({ stops: [sA, sC], routeMinutes: routes([BASE, P1, 60], [P1, P2, 85], [P2, BASE, 70]) }));
  ok(tight[1].tight?.text === "Tight — needs 1h 40m, has 30m" && tight[1].endMs === at(10, 30),
    "drive-time planDay: a drive-to that would start before the previous stop ends is flagged Tight; nothing moves");

  // Same location back-to-back → no leg
  const sA2 = stop("sv:A2", at(10, 15), at(11), okAddr(P1.lat, P1.lng, "A2"));
  ok(planDay(input({ stops: [sA, sA2], routeMinutes: full })).length === 2, "drive-time planDay: consecutive stops at the same point have no leg between them");

  // Stay-over, both days
  const stay = planDay(input({ stops: [sA, sB], routeMinutes: full, stayOver: true }));
  ok(stay.length === 2 && stay.every((l) => l.direction === "to_stop"), "drive-time planDay: a stay-over day has no drive-back leg");
  const next = planDay(input({ dayKey: addDays(DAY, 1), stops: [stop("sv:D", at(9) + 86_400_000, at(10) + 86_400_000, okAddr(P1.lat, P1.lng, "D"))], routeMinutes: routes([P2, P1, 40], [P1, BASE, 65]), prevDay: { stayOver: true, lastStop: sB } }));
  ok(next[0].from.kind === "prev_stop" && next[0].from.key === "sv:B" && next[0].routeMin === 40,
    "drive-time planDay: the day after a stay-over starts from that day's last stop");
  const nextBad = planDay(input({ dayKey: addDays(DAY, 1), stops: [sA], routeMinutes: full, prevDay: { stayOver: true, lastStop: sBad } }));
  ok(nextBad[0].flag?.kind === "unverified", "drive-time planDay: …and is flagged when that stop isn't verified");
  ok(planDay(input({ stops: [] })).length === 0, "drive-time planDay: a day with no stops has no legs");
}
```

Wire `driveTimePlanChecks` into the harness import + chain.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5` → `Cannot find module '@/lib/drive-plan/day'`.

- [ ] **Step 3: Write `src/lib/drive-plan/day.ts`**

```ts
/** Chicago calendar days for the drive chain (spec: "one Chicago calendar
 *  day"). Pure and client-safe. */
export const DRIVE_TZ = "America/Chicago";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isDayKey(v: unknown): v is string {
  return typeof v === "string" && DAY_RE.test(v);
}

function wallParts(ms: number): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DRIVE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(ms);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

export function chicagoDayKey(ms: number): string {
  const p = wallParts(ms);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Epoch-ms of 00:00 Chicago on `dayKey`. The offset is read at 06:00 UTC,
 *  which is 00:00–01:00 local — before the 02:00 DST switch either way. */
export function chicagoDayStart(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  const probe = Date.UTC(y, m - 1, d, 6);
  const p = wallParts(probe);
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Date.UTC(y, m - 1, d) - (wall - probe);
}

export function addDays(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Every Chicago day touched by [minMs, maxMs], inclusive. */
export function dayKeysBetween(minMs: number, maxMs: number): string[] {
  const out: string[] = [];
  const last = chicagoDayKey(maxMs);
  for (let k = chicagoDayKey(minMs); k <= last && out.length < 400; k = addDays(k, 1)) out.push(k);
  return out;
}
```

- [ ] **Step 4: Write `src/lib/drive-plan/stops.ts`**

```ts
/**
 * A rep's stops for one Chicago day (spec Part 2 "Stops"). Pure.
 * Stops: the rep's scheduled site visits with a start, and Google events
 * with a physical location. Not stops: all-day events, events with no
 * location / a URL / a video-call mention / a phone number, events the rep
 * declined, the app's own drive events, and a visit's .ics copy
 * (sv-<id>@peak-app) — the same stop, counted once.
 */
import { isPhysicalLocation } from "@/lib/address-verify/keys";
import type { AddressState } from "@/lib/address-verify/types";
import { chicagoDayKey } from "./day";

/** Everyone a visit is a stop for. Spec 2 adds `attendees` to SiteVisit —
 *  this is the ONE place that knows, so loaders and triggers follow. */
export function visitPeople(v: { assignedTo: string; attendees?: readonly string[] | null }): string[] {
  const out: string[] = [];
  for (const n of [v.assignedTo, ...(v.attendees ?? [])]) {
    const s = (n || "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export function isVisitIcsCopy(
  ev: { id: string; iCalUID: string },
  visits: ReadonlyArray<{ id: string; googleEventId?: string | null }>
): boolean {
  return visits.some((v) => ev.iCalUID === `sv-${v.id}@peak-app` || (!!v.googleEventId && v.googleEventId === ev.id));
}

export type StopSourceVisit = {
  id: string;
  label: string;
  startAt: number | null;
  endAt: number | null;
  stage: string;
  people: string[];
  googleEventId?: string | null;
  address: AddressState;
};

export type StopSourceEvent = {
  id: string;
  iCalUID: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  location: string;
  selfDeclined: boolean;
  peakDriveKey: string;
  address: AddressState | null;
};

export type DriveStop = {
  key: string;
  kind: "visit" | "event";
  label: string;
  startMs: number;
  endMs: number;
  address: AddressState;
};

export function stopsForDay(args: {
  person: string;
  dayKey: string;
  visits: StopSourceVisit[];
  events: StopSourceEvent[];
}): DriveStop[] {
  const out: DriveStop[] = [];
  for (const v of args.visits) {
    if (!v.people.includes(args.person) || v.startAt == null) continue;
    // A stored "scheduled" visit reads "done" once it has ended
    // (deriveVisitStage) — still the same stop on today's chain.
    if (v.stage !== "scheduled" && v.stage !== "done") continue;
    if (chicagoDayKey(v.startAt) !== args.dayKey) continue;
    out.push({ key: `sv:${v.id}`, kind: "visit", label: v.label, startMs: v.startAt, endMs: Math.max(v.endAt ?? v.startAt, v.startAt), address: v.address });
  }
  for (const e of args.events) {
    if (e.allDay || e.selfDeclined || e.peakDriveKey) continue;
    if (!isPhysicalLocation(e.location)) continue;
    if (isVisitIcsCopy(e, args.visits)) continue;
    if (chicagoDayKey(e.startMs) !== args.dayKey) continue;
    out.push({
      key: `g:${e.id}`,
      kind: "event",
      label: e.title,
      startMs: e.startMs,
      endMs: Math.max(e.endMs, e.startMs),
      address: e.address ?? { status: "unresolved", label: e.location, point: null, pointKey: null, fix: null },
    });
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.key.localeCompare(b.key));
}
```

- [ ] **Step 5: Write `src/lib/drive-plan/plan.ts`**

```ts
/**
 * planDay — the drive chain for one rep's Chicago day (spec Part 2). Pure,
 * no IO, client-safe (type-only imports). Route minutes come in through
 * `routeMinutes` (keyed by pairKey); a missing pair is FLAGGED, never
 * estimated — there is no straight-line fallback anywhere on this path.
 */
import type { FixTarget, LatLng } from "@/lib/address-verify/types";
import type { DriveStop } from "./stops";

export type DriveBase = { name: string; lat: number; lng: number };
export type DriveFlagKind = "no_base" | "unverified" | "route_unavailable";

export const FLAG_TEXT: Record<DriveFlagKind, string> = {
  no_base: "No base set",
  unverified: "Address not verified — no drive time",
  route_unavailable: "Drive time unavailable — retrying",
};

export type LegEnd = {
  kind: "base" | "stop" | "prev_stop";
  key: string;
  label: string;
  point: LatLng | null;
  verified: boolean;
  fix: FixTarget | null;
};

export type DriveLeg = {
  key: string;
  userId: string;
  dayKey: string;
  from: LegEnd;
  to: LegEnd;
  direction: "to_stop" | "back";
  routeMin: number | null;
  bufferMin: number;
  /** route + buffer; null when flagged */
  minutes: number | null;
  startMs: number | null;
  endMs: number | null;
  /** Where a flag shows: the stop's start (drive-to) or the last stop's end (back). */
  anchorMs: number;
  flag: { kind: DriveFlagKind; text: string } | null;
  fix: FixTarget | null;
  tight: { needMin: number; haveMin: number; text: string } | null;
};

export type PlanDayInput = {
  userId: string;
  dayKey: string;
  stops: DriveStop[];
  base: DriveBase | null;
  bufferMin: number;
  routeMinutes: ReadonlyMap<string, number>;
  prevDay: { stayOver: boolean; lastStop: DriveStop | null };
  stayOver: boolean;
};

function r4(n: number): string {
  return (Math.round(n * 1e4) / 1e4).toFixed(4);
}

/** Same string as geo.ts routeKey, so geo_cache lookups use it directly. */
export function pairKey(a: LatLng, b: LatLng): string {
  return r4(a.lat) + "," + r4(a.lng) + "|" + r4(b.lat) + "," + r4(b.lng);
}

export function fmtDur(min: number): string {
  const total = Math.max(0, Math.round(min));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

function stopEnd(s: DriveStop, kind: "stop" | "prev_stop" = "stop"): LegEnd {
  const verified = s.address.status === "verified" && !!s.address.point;
  return { kind, key: s.key, label: s.label, point: verified ? s.address.point : null, verified, fix: verified ? null : s.address.fix };
}

function baseEnd(b: DriveBase | null): LegEnd {
  return b
    ? { kind: "base", key: "base", label: b.name, point: { lat: b.lat, lng: b.lng }, verified: true, fix: null }
    : { kind: "base", key: "base", label: FLAG_TEXT.no_base, point: null, verified: false, fix: null };
}

const samePoint = (a: LegEnd, b: LegEnd) => !!a.point && !!b.point && pairKey(a.point, a.point) === pairKey(b.point, b.point);

function makeLeg(
  input: PlanDayInput,
  from: LegEnd,
  to: LegEnd,
  direction: "to_stop" | "back",
  anchorMs: number,
  prevStopEndMs: number | null
): DriveLeg {
  let flagKind: DriveFlagKind | null = null;
  if ((from.kind === "base" && !from.verified) || (to.kind === "base" && !to.verified)) flagKind = "no_base";
  else if (!from.verified || !to.verified) flagKind = "unverified";
  let routeMin: number | null = null;
  if (!flagKind) {
    const r = input.routeMinutes.get(pairKey(from.point!, to.point!));
    if (r == null || !Number.isFinite(r)) flagKind = "route_unavailable";
    else routeMin = Math.max(0, Math.round(r));
  }
  const bufferMin = Math.max(0, Math.round(input.bufferMin));
  const minutes = routeMin == null ? null : routeMin + bufferMin;
  let startMs: number | null = null;
  let endMs: number | null = null;
  if (minutes != null) {
    if (direction === "to_stop") {
      endMs = anchorMs;
      startMs = anchorMs - minutes * 60_000;
    } else {
      startMs = anchorMs;
      endMs = anchorMs + minutes * 60_000;
    }
  }
  let tight: DriveLeg["tight"] = null;
  if (minutes != null && startMs != null && direction === "to_stop" && prevStopEndMs != null && startMs < prevStopEndMs) {
    const haveMin = Math.max(0, Math.round((anchorMs - prevStopEndMs) / 60_000));
    tight = { needMin: minutes, haveMin, text: `Tight — needs ${fmtDur(minutes)}, has ${fmtDur(haveMin)}` };
  }
  return {
    key: `${input.userId}|${input.dayKey}|${from.key}|${to.key}`,
    userId: input.userId,
    dayKey: input.dayKey,
    from,
    to,
    direction,
    routeMin,
    bufferMin,
    minutes,
    startMs,
    endMs,
    anchorMs,
    flag: flagKind ? { kind: flagKind, text: FLAG_TEXT[flagKind] } : null,
    fix: flagKind === "unverified" ? (!to.verified ? to.fix : from.fix) : null,
    tight,
  };
}

export function planDay(input: PlanDayInput): DriveLeg[] {
  const stops = [...input.stops].sort((a, b) => a.startMs - b.startMs || a.key.localeCompare(b.key));
  if (!stops.length) return [];
  const base = baseEnd(input.base);
  const legs: DriveLeg[] = [];
  const push = (from: LegEnd, to: LegEnd, direction: "to_stop" | "back", anchorMs: number, prevEnd: number | null) => {
    if (samePoint(from, to)) return; // same place back-to-back: no drive
    legs.push(makeLeg(input, from, to, direction, anchorMs, prevEnd));
  };
  const origin = input.prevDay.stayOver && input.prevDay.lastStop ? stopEnd(input.prevDay.lastStop, "prev_stop") : base;
  push(origin, stopEnd(stops[0]), "to_stop", stops[0].startMs, null);
  for (let i = 1; i < stops.length; i++) push(stopEnd(stops[i - 1]), stopEnd(stops[i]), "to_stop", stops[i].startMs, stops[i - 1].endMs);
  if (!input.stayOver) {
    const last = stops[stops.length - 1];
    push(stopEnd(last), base, "back", last.endMs, null);
  }
  return legs;
}

/** The OSRM pairs a day needs — verified ends, not yet in routeMinutes. */
export function neededRoutes(input: Omit<PlanDayInput, "routeMinutes">): Array<{ from: LatLng; to: LatLng }> {
  const out = new Map<string, { from: LatLng; to: LatLng }>();
  for (const l of planDay({ ...input, routeMinutes: new Map() })) {
    if (l.flag?.kind === "route_unavailable" && l.from.point && l.to.point) out.set(pairKey(l.from.point, l.to.point), { from: l.from.point, to: l.to.point });
  }
  return [...out.values()];
}

/** The day header's total drive time (buffer included; flagged legs count 0). */
export function dayDriveTotal(legs: DriveLeg[]): number {
  return legs.reduce((s, l) => s + (l.flag || l.minutes == null ? 0 : l.minutes), 0);
}
```

- [ ] **Step 6: Write `src/lib/drive-plan/index.ts`**

```ts
/** The pure drive engine (spec 2026-10-09 Part 2). The server loader is ./load. */
export * from "./day";
export * from "./stops";
export * from "./plan";
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "drive-time|FAILED|ALL PASSED" | tail -60` → all PASS.

- [ ] **Step 8: Gates + commit**

```bash
npx tsc --noEmit
npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/drive-plan scripts/test-drive-time.ts
git add src/lib/drive-plan scripts/test-drive-time.ts scripts/test-review-and-spec.ts
git commit -m "feat(drive-time): pure planDay drive chain, stops and Chicago days

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Buffer, stay-over and sync-state storage + the two buffer settings

**Files:**
- Create: `src/lib/stores/schedule-prefs.ts`, `src/app/(app)/account/drive-buffer-card.tsx`, `src/app/(app)/settings/drive-defaults-card.tsx`
- Modify: `src/app/(app)/account/actions.ts`, `src/app/(app)/account/page.tsx`, `src/app/(app)/account/office-picker.tsx` (copy only), `src/app/(app)/settings/actions.ts`, `src/app/(app)/settings/page.tsx`, `src/app/(app)/settings/settings-client.tsx`, `src/app/(app)/settings/groups/types.ts`, `src/app/(app)/settings/groups/field.tsx`
- Test: `scripts/test-drive-time.ts` (`driveTimePrefsChecks`)

**Interfaces:**
- Consumes: `getBlob`/`setBlob` (`src/db/doc-store.ts`), `isDayKey` (Task 4).
- Produces (spec 2 adds work hours / same-area / daily limit / look-ahead to these same two blobs — keep the shapes open with optional fields only):
  - `SCHEDULE_DEFAULTS_BLOB = "schedule_defaults"`; `DEFAULT_DRIVE_BUFFER_MIN = 15`; `MAX_DRIVE_BUFFER_MIN = 120`.
  - `type ScheduleDefaults = { driveBufferMin: number }`; `type UserSchedulePrefs = { driveBufferMin: number | null }`; `type DriveSyncState = { lastSyncAt: number; legacyCleanedAt: number | null }`.
  - `cleanBufferMin(v: unknown): number | null`; `bufferMinFor(defaults: ScheduleDefaults, prefs: UserSchedulePrefs): number`.
  - `getScheduleDefaults(): Promise<ScheduleDefaults>`; `saveScheduleDefaults(input: { driveBufferMin: unknown }): Promise<ScheduleDefaults>`.
  - `getUserSchedulePrefs(userId: string): Promise<UserSchedulePrefs>`; `saveUserSchedulePrefs(userId: string, input: { driveBufferMin: unknown }): Promise<UserSchedulePrefs>`; `driveBufferFor(userId: string): Promise<number>`.
  - `getStayOvers(userId: string): Promise<Record<string, boolean>>` (only `true` days); `setStayOver(userId: string, dayKey: string, on: boolean): Promise<boolean>` (false = refused bad day key).
  - `getDriveSyncState(userId: string): Promise<DriveSyncState>`; `setDriveSyncState(userId: string, patch: Partial<DriveSyncState>): Promise<void>`; `markDriveStale(userIds: string[]): Promise<void>`.
  - Blob ids: `schedule_prefs:<userId>`, `stay_over:<userId>` (one top-level key per day, so `setBlob`'s atomic merge never loses a concurrent toggle), `drive_sync:<userId>`.
  - Server actions: `saveMyDriveBufferAction(minutes: number | null)` (account), `saveDriveDefaultsAction(input: { driveBufferMin: unknown })` (settings, `manage_users`).

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-drive-time.ts` (merge `blobs` into the schema import):

```ts
import {
  bufferMinFor,
  cleanBufferMin,
  driveBufferFor,
  getDriveSyncState,
  getScheduleDefaults,
  getStayOvers,
  markDriveStale,
  saveScheduleDefaults,
  saveUserSchedulePrefs,
  setDriveSyncState,
  setStayOver,
} from "@/lib/stores/schedule-prefs";

export async function driveTimePrefsChecks(ok: Ok): Promise<void> {
  const db = await getDb();
  const U = "TESTdrive:u1";
  try {
    ok(cleanBufferMin("20") === 20 && cleanBufferMin(-5) === 0 && cleanBufferMin(500) === 120 && cleanBufferMin("") === null && cleanBufferMin("x") === null,
      "drive-time prefs: buffer minutes are whole, clamped 0–120, blank = unset");
    ok(bufferMinFor({ driveBufferMin: 15 }, { driveBufferMin: null }) === 15 && bufferMinFor({ driveBufferMin: 15 }, { driveBufferMin: 0 }) === 0,
      "drive-time prefs: the company default applies until the rep sets their own (0 is a real choice)");
    const before = await getScheduleDefaults();
    ok(before.driveBufferMin >= 0, "drive-time prefs: company default reads (15 when never set)");
    await saveUserSchedulePrefs(U, { driveBufferMin: 25 });
    ok((await driveBufferFor(U)) === 25, "drive-time prefs: a rep's own buffer wins");
    await saveUserSchedulePrefs(U, { driveBufferMin: null });
    ok((await driveBufferFor(U)) === before.driveBufferMin, "drive-time prefs: clearing it falls back to the company default");

    ok(await setStayOver(U, "2026-10-14", true), "drive-time prefs: a stay-over saves");
    await setStayOver(U, "2026-10-15", true);
    await setStayOver(U, "2026-10-15", false);
    ok(!(await setStayOver(U, "Oct 14", true)), "drive-time prefs: a malformed day key is refused");
    const stays = await getStayOvers(U);
    ok(stays["2026-10-14"] === true && !("2026-10-15" in stays), "drive-time prefs: stay-overs are per date; turning one off removes it");

    await setDriveSyncState(U, { lastSyncAt: 123, legacyCleanedAt: 99 });
    await markDriveStale([U]);
    const st = await getDriveSyncState(U);
    ok(st.lastSyncAt === 0 && st.legacyCleanedAt === 99, "drive-time prefs: markDriveStale zeroes lastSyncAt and keeps the legacy-cleanup stamp");
    await saveScheduleDefaults({ driveBufferMin: before.driveBufferMin });
  } finally {
    await db.delete(blobs).where(like(blobs.id, "%TESTdrive:%"));
  }
}
```

Wire into the harness import + chain.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5` → `Cannot find module '@/lib/stores/schedule-prefs'`.

- [ ] **Step 3: Write `src/lib/stores/schedule-prefs.ts`**

```ts
/**
 * Scheduling preferences (spec 2026-10-09 "Buffer", "Staying over"; specs 2
 * and 3 extend the same blobs). No table, no migration — the
 * dashboard_layouts:<userId> idiom:
 *   schedule_defaults            { driveBufferMin }        admin, Settings → Field
 *   schedule_prefs:<userId>      { driveBufferMin | null } the rep, Account
 *   stay_over:<userId>           { "YYYY-MM-DD": true }    one key per day
 *   drive_sync:<userId>          { lastSyncAt, legacyCleanedAt }
 * Blobs survive the go-live demo wipe.
 */
import { getBlob, setBlob } from "@/db/doc-store";
import { isDayKey } from "@/lib/drive-plan/day";

export const SCHEDULE_DEFAULTS_BLOB = "schedule_defaults";
export const DEFAULT_DRIVE_BUFFER_MIN = 15;
export const MAX_DRIVE_BUFFER_MIN = 120;

export type ScheduleDefaults = { driveBufferMin: number };
export type UserSchedulePrefs = { driveBufferMin: number | null };
export type DriveSyncState = { lastSyncAt: number; legacyCleanedAt: number | null };

const prefsId = (userId: string) => `schedule_prefs:${userId}`;
const stayId = (userId: string) => `stay_over:${userId}`;
const syncId = (userId: string) => `drive_sync:${userId}`;

export function cleanBufferMin(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_DRIVE_BUFFER_MIN, Math.max(0, Math.round(n)));
}

export function bufferMinFor(defaults: ScheduleDefaults, prefs: UserSchedulePrefs): number {
  return prefs.driveBufferMin ?? defaults.driveBufferMin;
}

export async function getScheduleDefaults(): Promise<ScheduleDefaults> {
  const raw = await getBlob<Record<string, unknown>>(SCHEDULE_DEFAULTS_BLOB, {});
  return { driveBufferMin: cleanBufferMin(raw.driveBufferMin) ?? DEFAULT_DRIVE_BUFFER_MIN };
}

export async function saveScheduleDefaults(input: { driveBufferMin: unknown }): Promise<ScheduleDefaults> {
  const driveBufferMin = cleanBufferMin(input?.driveBufferMin) ?? DEFAULT_DRIVE_BUFFER_MIN;
  await setBlob(SCHEDULE_DEFAULTS_BLOB, { driveBufferMin });
  return { driveBufferMin };
}

export async function getUserSchedulePrefs(userId: string): Promise<UserSchedulePrefs> {
  const raw = await getBlob<Record<string, unknown>>(prefsId(userId), {});
  return { driveBufferMin: cleanBufferMin(raw.driveBufferMin) };
}

export async function saveUserSchedulePrefs(userId: string, input: { driveBufferMin: unknown }): Promise<UserSchedulePrefs> {
  const driveBufferMin = cleanBufferMin(input?.driveBufferMin);
  await setBlob(prefsId(userId), { driveBufferMin });
  return { driveBufferMin };
}

export async function driveBufferFor(userId: string): Promise<number> {
  const [defaults, prefs] = await Promise.all([getScheduleDefaults(), getUserSchedulePrefs(userId)]);
  return bufferMinFor(defaults, prefs);
}

export async function getStayOvers(userId: string): Promise<Record<string, boolean>> {
  const raw = await getBlob<Record<string, unknown>>(stayId(userId), {});
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw)) if (isDayKey(k) && v === true) out[k] = true;
  return out;
}

export async function setStayOver(userId: string, dayKey: string, on: boolean): Promise<boolean> {
  if (!isDayKey(dayKey)) return false;
  await setBlob(stayId(userId), { [dayKey]: on === true });
  return true;
}

export async function getDriveSyncState(userId: string): Promise<DriveSyncState> {
  const raw = await getBlob<Record<string, unknown>>(syncId(userId), {});
  return {
    lastSyncAt: typeof raw.lastSyncAt === "number" ? raw.lastSyncAt : 0,
    legacyCleanedAt: typeof raw.legacyCleanedAt === "number" ? raw.legacyCleanedAt : null,
  };
}

export async function setDriveSyncState(userId: string, patch: Partial<DriveSyncState>): Promise<void> {
  await setBlob(syncId(userId), patch as Record<string, unknown>);
}

/** Force the next calendar view / cron pass to re-sync these reps. */
export async function markDriveStale(userIds: string[]): Promise<void> {
  for (const id of userIds) await setDriveSyncState(id, { lastSyncAt: 0 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "drive-time prefs|FAILED|ALL PASSED" | tail -20` → all PASS.

- [ ] **Step 5: Account action + card**

In `src/app/(app)/account/actions.ts` add:

```ts
/** Spec 2026-10-09 "Buffer" — the signed-in rep's own drive buffer (null =
 *  use the company default). A buffer change moves every leg, so the rep's
 *  drive events are marked stale and re-sync on the next calendar view. */
export async function saveMyDriveBufferAction(minutes: number | null) {
  const me = await requireUser();
  const { saveUserSchedulePrefs, markDriveStale } = await import("@/lib/stores/schedule-prefs");
  const prefs = await saveUserSchedulePrefs(me.id, { driveBufferMin: minutes });
  await markDriveStale([me.id]);
  revalidatePath("/", "layout");
  return { ok: true as const, driveBufferMin: prefs.driveBufferMin };
}
```

Create `src/app/(app)/account/drive-buffer-card.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveMyDriveBufferAction } from "./actions";

/** Spec 2026-10-09 "Buffer" — fixed minutes added to every drive leg. */
export default function DriveBufferCard({ initial, companyDefault }: { initial: number | null; companyDefault: number }) {
  const router = useRouter();
  const [useDefault, setUseDefault] = useState(initial == null);
  const [value, setValue] = useState(String(initial ?? companyDefault));
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");

  function save(nextUseDefault: boolean, nextValue: string) {
    setMsg("");
    startTransition(async () => {
      const n = nextUseDefault ? null : Number(nextValue);
      const r = await saveMyDriveBufferAction(n != null && Number.isFinite(n) ? n : null);
      if (r.ok) {
        setMsg("Saved");
        router.refresh();
      }
    });
  }

  return (
    <div className="pk-card" style={{ padding: "17px 18px", marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Drive buffer</div>
          <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3, lineHeight: 1.5 }}>
            Extra minutes added to every drive on your calendar — parking, walking in, slack.
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
          <input
            type="checkbox"
            checked={useDefault}
            disabled={pending}
            onChange={(e) => {
              setUseDefault(e.target.checked);
              save(e.target.checked, value);
            }}
          />
          Company default ({companyDefault} min)
        </label>
        <input
          type="number"
          min={0}
          max={120}
          className="pk-input"
          style={{ width: 72, fontSize: 12.5 }}
          value={value}
          disabled={useDefault || pending}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => !useDefault && save(false, value)}
        />
        <span style={{ fontSize: 12, color: "#9aa0ab" }}>min</span>
        {msg && !pending && <span style={{ fontSize: 11, color: "#1f7a52" }}>{msg}</span>}
      </div>
    </div>
  );
}
```

In `src/app/(app)/account/page.tsx`: add imports `import DriveBufferCard from "./drive-buffer-card";` and `import { getScheduleDefaults, getUserSchedulePrefs } from "@/lib/stores/schedule-prefs";`; extend the existing `Promise.all` with `getScheduleDefaults()` and `getUserSchedulePrefs(user.id)` (destructure as `scheduleDefaults`, `schedulePrefs`), and render directly after the `<OfficePicker … />` element:

```tsx
<DriveBufferCard initial={schedulePrefs.driveBufferMin} companyDefault={scheduleDefaults.driveBufferMin} />
```

In `src/app/(app)/account/office-picker.tsx` replace the description text with: `Where you drive from. Your calendar's drive time starts and ends here.` and update the doc comment's last sentence to `Feeds the drive chain's base (lib/drive-plan/load.ts).`

- [ ] **Step 6: Settings default card**

In `src/app/(app)/settings/actions.ts` add:

```ts
/** Spec 2026-10-09 "Buffer" — the company default drive buffer. Every rep
 *  without their own buffer moves, so all reps re-sync on next view. */
export async function saveDriveDefaultsAction(input: { driveBufferMin: unknown }) {
  await requirePerm("manage_users");
  const { saveScheduleDefaults, markDriveStale } = await import("@/lib/stores/schedule-prefs");
  const { activeUsers } = await import("@/lib/users");
  const saved = await saveScheduleDefaults({ driveBufferMin: input?.driveBufferMin });
  await markDriveStale((await activeUsers()).map((u) => u.id));
  revalidatePath("/", "layout");
  return { ok: true as const, driveBufferMin: saved.driveBufferMin };
}
```

Create `src/app/(app)/settings/drive-defaults-card.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { saveDriveDefaultsAction } from "./actions";

/** Spec 2026-10-09 — company default drive buffer (used until a rep sets their own in Account). */
export function DriveDefaultsCard({ initial }: { initial: number }) {
  const [value, setValue] = useState(String(initial));
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <div className="pk-card" style={{ padding: "17px 18px", marginBottom: 16 }}>
      <div style={{ fontSize: 14.5, fontWeight: 600 }}>Drive time</div>
      <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3, lineHeight: 1.5 }}>
        Default buffer added to every drive leg. Each person can set their own in Account.
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <input
          type="number"
          min={0}
          max={120}
          className="pk-input"
          style={{ width: 80, fontSize: 12.5 }}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
        />
        <span style={{ fontSize: 12, color: "#9aa0ab" }}>min</span>
        <button
          className="pk-btn-accent"
          style={{ fontSize: 12.5 }}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await saveDriveDefaultsAction({ driveBufferMin: value });
              if (r.ok) {
                setValue(String(r.driveBufferMin));
                setSaved(true);
              }
            })
          }
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {saved && <span style={{ fontSize: 11, color: "#1f7a52" }}>Saved</span>}
      </div>
    </div>
  );
}
```

Wire it:
- `groups/types.ts` — add to `SettingsData`: `/** Spec 2026-10-09 — Settings → Field → Drive time. */ driveDefaults: { driveBufferMin: number };`
- `settings/page.tsx` — import `getScheduleDefaults, DEFAULT_DRIVE_BUFFER_MIN` from `@/lib/stores/schedule-prefs`; after the `estimateOutput` line add `const driveDefaults = isAdmin ? await getScheduleDefaults() : { driveBufferMin: DEFAULT_DRIVE_BUFFER_MIN };`; pass `driveDefaults={driveDefaults}` to `<SettingsClient>`.
- `settings-client.tsx` — in the `case "field":` `<FieldGroup>` add `driveDefaults={data.driveDefaults}`.
- `groups/field.tsx` — import `{ DriveDefaultsCard } from "../drive-defaults-card"`; add prop `driveDefaults: { driveBufferMin: number };` to `FieldGroup`'s props type and destructuring; render `<DriveDefaultsCard initial={driveDefaults.driveBufferMin} />` as the first child inside the returned fragment (before `<VenueTypesCard`).

- [ ] **Step 7: Gates + commit**

```bash
npx tsc --noEmit
npm run test:specs 2>&1 | tail -3
npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/stores/schedule-prefs.ts "src/app/(app)/account" "src/app/(app)/settings/drive-defaults-card.tsx" "src/app/(app)/settings/actions.ts" "src/app/(app)/settings/page.tsx" "src/app/(app)/settings/settings-client.tsx" "src/app/(app)/settings/groups/types.ts" "src/app/(app)/settings/groups/field.tsx" scripts/test-drive-time.ts
git add src/lib/stores/schedule-prefs.ts "src/app/(app)/account" "src/app/(app)/settings" scripts/test-drive-time.ts scripts/test-review-and-spec.ts
git commit -m "feat(drive-time): drive buffer (company + per rep), stay-over and sync-state blobs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Google Calendar client extensions + the pure sync diff

**Files:**
- Create: `src/lib/drive-sync/diff.ts`
- Modify: `src/lib/google/calendar.ts`
- Test: `scripts/test-drive-time.ts` (`driveTimeDiffChecks`)

**Interfaces:**
- Consumes: `DriveLeg` (Task 4).
- Produces:
  - `diff.ts`: `DRIVE_PROP = "peakDrive"`, `DRIVE_KEY_PROP = "peakDriveKey"`, `DRIVE_DAY_PROP = "peakDriveDay"`, `LEGACY_DESCRIPTION_PREFIX = "Auto-added travel time"`; `type DesiredDriveEvent = { key: string; dayKey: string; title: string; description: string; startMs: number; endMs: number }`; `type ExistingDriveEvent = { id: string; key: string; dayKey: string; title: string; startMs: number; endMs: number }`; `type DriveDiff = { insert: DesiredDriveEvent[]; update: Array<{ id: string; ev: DesiredDriveEvent }>; remove: ExistingDriveEvent[] }`; `driveEventTitle(leg: DriveLeg): string`; `desiredFromLegs(legs: DriveLeg[]): DesiredDriveEvent[]`; `existingFromCalendar(events: ReadonlyArray<{ id: string; title: string; startMs: number; endMs: number; peakDriveKey: string; peakDriveDay: string }>): ExistingDriveEvent[]`; `diffDriveEvents(desired: DesiredDriveEvent[], existing: ExistingDriveEvent[], days: ReadonlySet<string>): DriveDiff`; `isLegacyTravelBlock(ev: { title: string; description: string; startMs: number; peakDriveKey?: string }, nowMs: number): boolean`; `drivePrivateProps(ev: DesiredDriveEvent): Record<string, string>`.
  - `calendar.ts`: `CalendarEvent` gains `selfDeclined: boolean; peakDriveKey: string; peakDriveDay: string` (`peakDriveKey`/`peakDriveDay` are `""` unless the event's private `peakDrive` = `"1"`); `type SyncCalendarEvent = CalendarEvent & { description: string }`; `listEventsForSync(mailboxKey: string, opts: { timeMinMs: number; timeMaxMs: number }): Promise<SyncCalendarEvent[]>` (pages up to 1,000 events); `EventWriteInput` gains `privateProps?: Record<string, string>`; exported for the harness: `toCalendarEvents(items)` and `eventWriteBody(ev)`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-drive-time.ts`:

```ts
import {
  desiredFromLegs,
  diffDriveEvents,
  drivePrivateProps,
  existingFromCalendar,
  isLegacyTravelBlock,
  type DesiredDriveEvent,
  type ExistingDriveEvent,
} from "@/lib/drive-sync/diff";
import { eventWriteBody, toCalendarEvents } from "@/lib/google/calendar";

export async function driveTimeDiffChecks(ok: Ok): Promise<void> {
  const sA = stop("sv:A", at(9), at(10), okAddr(P1.lat, P1.lng, "A"));
  const legs = planDay(input({ stops: [sA, stop("g:bad", at(11), at(12), badAddr("bad"))], routeMinutes: routes([BASE, P1, 60]) }));
  const desired = desiredFromLegs(legs);
  ok(desired.length === 1 && desired[0].title === "Drive to sv:A" && desired[0].endMs === at(9) && desired[0].description.includes("60 min drive + 15 min buffer"),
    "drive-time diff: only unflagged legs become Google events");

  const d = (key: string, day: string, s: number, e: number, title = "Drive to X"): DesiredDriveEvent => ({ key, dayKey: day, title, description: "", startMs: s, endMs: e });
  const x = (id: string, key: string, day: string, s: number, e: number, title = "Drive to X"): ExistingDriveEvent => ({ id, key, dayKey: day, title, startMs: s, endMs: e });
  const want = [d("k1", DAY, 1, 2), d("k2", DAY, 3, 4), d("k3", DAY, 5, 6)];
  const have = [x("e1", "k1", DAY, 1, 2), x("e2", "k2", DAY, 3, 9), x("e3", "gone", DAY, 7, 8), x("e4", "other", "2026-10-20", 1, 2), x("e5", "k1", DAY, 1, 2)];
  const diff = diffDriveEvents(want, have, new Set([DAY]));
  ok(diff.insert.map((i) => i.key).join() === "k3" && diff.update.map((u) => u.id).join() === "e2" &&
     diff.remove.map((r) => r.id).sort().join() === "e3,e5",
    "drive-time diff: insert new, update moved, delete orphans + duplicates; unchanged left alone");
  ok(!diff.remove.some((r) => r.id === "e4"), "drive-time diff: tagged events on days outside this sync are never touched");

  const cal = existingFromCalendar([
    { id: "a", title: "Drive to X", startMs: 1, endMs: 2, peakDriveKey: "k", peakDriveDay: DAY },
    { id: "b", title: "Drive to X", startMs: 1, endMs: 2, peakDriveKey: "", peakDriveDay: "" },
  ]);
  ok(cal.length === 1 && cal[0].id === "a", "drive-time diff: only tagged (peakDrive) events count as ours");

  const now = 1_000_000;
  const legacy = { title: "Drive to Board meeting (auto)", description: "Auto-added travel time — safe to delete or edit. Estimated 40 min from Madison.", startMs: now + 1, peakDriveKey: "" };
  ok(isLegacyTravelBlock(legacy, now), "drive-time D144: an upcoming exact-shape auto block matches");
  ok(!isLegacyTravelBlock({ ...legacy, startMs: now - 1 }, now), "drive-time D144: past blocks are left");
  ok(!isLegacyTravelBlock({ ...legacy, description: "My own note" }, now) && !isLegacyTravelBlock({ ...legacy, title: "Drive to Board meeting" }, now),
    "drive-time D144: the title AND the description prefix must both match");
  ok(!isLegacyTravelBlock({ ...legacy, peakDriveKey: "k" }, now), "drive-time D144: one of our own tagged events is never a legacy block");

  const mapped = toCalendarEvents([
    { id: "g1", summary: "Site walk", start: { dateTime: "2026-10-14T14:00:00Z" }, end: { dateTime: "2026-10-14T15:00:00Z" }, attendees: [{ email: "me@x.com", self: true, responseStatus: "declined" }] },
    { id: "g2", summary: "Drive to X", start: { dateTime: "2026-10-14T13:00:00Z" }, end: { dateTime: "2026-10-14T14:00:00Z" }, extendedProperties: { private: { peakDrive: "1", peakDriveKey: "k9", peakDriveDay: DAY } } },
    { id: "g3", summary: "Spoof", start: { dateTime: "2026-10-14T13:00:00Z" }, end: { dateTime: "2026-10-14T14:00:00Z" }, extendedProperties: { private: { peakDriveKey: "k9" } } },
  ]);
  ok(mapped[0].selfDeclined && mapped[0].peakDriveKey === "" && mapped[1].peakDriveKey === "k9" && mapped[1].peakDriveDay === DAY && mapped[2].peakDriveKey === "",
    "drive-time calendar: declined-by-me and our private drive tag are read; a key without peakDrive=1 isn't ours");
  const body = eventWriteBody({ title: "Drive to X", startMs: 1, endMs: 2, privateProps: drivePrivateProps(d("k1", DAY, 1, 2)) }) as { extendedProperties?: { private?: Record<string, string> } };
  ok(body.extendedProperties?.private?.peakDrive === "1" && body.extendedProperties.private.peakDriveKey === "k1" && body.extendedProperties.private.peakDriveDay === DAY,
    "drive-time calendar: app-written drive events carry peakDrive + leg key + day");
  ok((eventWriteBody({ title: "Mine", startMs: 1, endMs: 2 }) as { extendedProperties?: unknown }).extendedProperties === undefined,
    "drive-time calendar: ordinary event writes carry no extended properties");
}
```

Wire into the harness import + chain.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5` → `Cannot find module '@/lib/drive-sync/diff'`.

- [ ] **Step 3: Write `src/lib/drive-sync/diff.ts`**

```ts
/**
 * Google sync diff (spec Part 3) — pure. The app only ever touches events
 * carrying the private extended property peakDrive = "1"; everything the
 * rep made is invisible here. Leg key = rep + date + from-stop + to-stop.
 */
import type { DriveLeg } from "@/lib/drive-plan/plan";

export const DRIVE_PROP = "peakDrive";
export const DRIVE_KEY_PROP = "peakDriveKey";
export const DRIVE_DAY_PROP = "peakDriveDay";
export const LEGACY_DESCRIPTION_PREFIX = "Auto-added travel time";
const LEGACY_TITLE = /^Drive to .+ \(auto\)$/;

export type DesiredDriveEvent = { key: string; dayKey: string; title: string; description: string; startMs: number; endMs: number };
export type ExistingDriveEvent = { id: string; key: string; dayKey: string; title: string; startMs: number; endMs: number };
export type DriveDiff = {
  insert: DesiredDriveEvent[];
  update: Array<{ id: string; ev: DesiredDriveEvent }>;
  remove: ExistingDriveEvent[];
};

export function driveEventTitle(leg: DriveLeg): string {
  return leg.direction === "back" ? `Drive back to ${leg.to.label}` : `Drive to ${leg.to.label}`;
}

/** Flagged legs have no minutes to place — they never reach Google. */
export function desiredFromLegs(legs: DriveLeg[]): DesiredDriveEvent[] {
  return legs
    .filter((l) => !l.flag && l.minutes != null && l.startMs != null && l.endMs != null)
    .map((l) => ({
      key: l.key,
      dayKey: l.dayKey,
      title: driveEventTitle(l),
      description: `Drive time added by Quartzite — it updates on its own. ${l.routeMin} min drive + ${l.bufferMin} min buffer, from ${l.from.label}.`,
      startMs: l.startMs as number,
      endMs: l.endMs as number,
    }));
}

export function drivePrivateProps(ev: DesiredDriveEvent): Record<string, string> {
  return { [DRIVE_PROP]: "1", [DRIVE_KEY_PROP]: ev.key, [DRIVE_DAY_PROP]: ev.dayKey };
}

export function existingFromCalendar(
  events: ReadonlyArray<{ id: string; title: string; startMs: number; endMs: number; peakDriveKey: string; peakDriveDay: string }>
): ExistingDriveEvent[] {
  return events
    .filter((e) => !!e.peakDriveKey)
    .map((e) => ({ id: e.id, key: e.peakDriveKey, dayKey: e.peakDriveDay, title: e.title, startMs: e.startMs, endMs: e.endMs }));
}

/** Insert / update / delete ONLY tagged events on the given days. Two
 *  events with one key (a concurrent double-sync) collapse to one. */
export function diffDriveEvents(desired: DesiredDriveEvent[], existing: ExistingDriveEvent[], days: ReadonlySet<string>): DriveDiff {
  const byKey = new Map<string, ExistingDriveEvent[]>();
  for (const e of existing) {
    if (!days.has(e.dayKey)) continue;
    const list = byKey.get(e.key) ?? [];
    list.push(e);
    byKey.set(e.key, list);
  }
  const out: DriveDiff = { insert: [], update: [], remove: [] };
  const wanted = new Set<string>();
  for (const ev of desired) {
    if (!days.has(ev.dayKey) || wanted.has(ev.key)) continue;
    wanted.add(ev.key);
    const [keep, ...extra] = [...(byKey.get(ev.key) ?? [])].sort((a, b) => a.id.localeCompare(b.id));
    out.remove.push(...extra);
    if (!keep) out.insert.push(ev);
    else if (keep.title !== ev.title || keep.startMs !== ev.startMs || keep.endMs !== ev.endMs) out.update.push({ id: keep.id, ev });
  }
  for (const [key, list] of byKey) if (!wanted.has(key)) out.remove.push(...list);
  return out;
}

/** D144's "Drive to … (auto)" block, upcoming only, exact shape only. */
export function isLegacyTravelBlock(ev: { title: string; description: string; startMs: number; peakDriveKey?: string }, nowMs: number): boolean {
  return !ev.peakDriveKey && LEGACY_TITLE.test(ev.title) && ev.description.startsWith(LEGACY_DESCRIPTION_PREFIX) && ev.startMs >= nowMs;
}
```

- [ ] **Step 4: Extend `src/lib/google/calendar.ts`**

1. Add `import { DRIVE_DAY_PROP, DRIVE_KEY_PROP, DRIVE_PROP } from "@/lib/drive-sync/diff";` with the other imports.
2. `type GoogleAttendee` → add `self?: boolean;`. `type GoogleEvent` → add `extendedProperties?: { private?: Record<string, string> };`.
3. `export type CalendarEvent` → add:

```ts
  /** The signed-in account declined it (spec: declined events aren't stops). */
  selfDeclined: boolean;
  /** Set only on the app's own drive events (private peakDrive = "1"). */
  peakDriveKey: string;
  peakDriveDay: string;
```

4. Replace `function toCalendarEvents` with an exported version:

```ts
/** Shared items→CalendarEvent[] mapping — exported for the spec harness. */
export function toCalendarEvents(items: GoogleEvent[] | undefined): CalendarEvent[] {
  return (items || [])
    .filter((e) => e.status !== "cancelled")
    .map((e) => {
      const priv = e.extendedProperties?.private || {};
      const ours = priv[DRIVE_PROP] === "1";
      return {
        id: e.id,
        iCalUID: e.iCalUID || "",
        title: e.summary || "(no title)",
        startMs: toMs(e.start, 0),
        endMs: toMs(e.end, toMs(e.start, 0)),
        allDay: !!e.start?.date,
        location: e.location || "",
        htmlLink: e.htmlLink || "",
        meetingUrl: findMeetingLink(e.location, e.description),
        selfDeclined: (e.attendees || []).some((a) => a.self && a.responseStatus === "declined"),
        peakDriveKey: ours ? priv[DRIVE_KEY_PROP] || "" : "",
        peakDriveDay: ours ? priv[DRIVE_DAY_PROP] || "" : "",
      };
    })
    .filter((e) => e.startMs > 0);
}
```

(`GoogleEvent` must become `export type GoogleEvent` only if tsc complains about an exported function using a private type — if so, export it.)

5. After `listUpcomingEvents` add:

```ts
export type SyncCalendarEvent = CalendarEvent & { description: string };

/** Every event in a window, with descriptions — the drive sync's read
 *  (tagged-event diff, stops, D144 cleanup). Pages up to 4 × 250. */
export async function listEventsForSync(
  mailboxKey: string,
  opts: { timeMinMs: number; timeMaxMs: number }
): Promise<SyncCalendarEvent[]> {
  const out: SyncCalendarEvent[] = [];
  let pageToken = "";
  for (let page = 0; page < 4; page++) {
    const params = eventsListParams({ ...opts, maxResults: 250 });
    if (pageToken) params.set("pageToken", pageToken);
    const r = await gcal<{ items?: GoogleEvent[]; nextPageToken?: string }>(
      mailboxKey,
      "/calendars/primary/events?" + params.toString()
    );
    const desc = new Map((r.items || []).map((e) => [e.id, e.description || ""]));
    for (const ev of toCalendarEvents(r.items)) out.push({ ...ev, description: desc.get(ev.id) || "" });
    if (!r.nextPageToken) break;
    pageToken = r.nextPageToken;
  }
  return out;
}
```

6. `EventWriteInput` → add `/** Private extended properties (the drive sync's peakDrive tag). */ privateProps?: Record<string, string>;`. Rename `function writeBody` to `export function eventWriteBody` (update its two callers in `insertEvent`/`updateEvent`) and add to the returned object:

```ts
    extendedProperties: ev.privateProps ? { private: ev.privateProps } : undefined,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "drive-time|FAILED|ALL PASSED" | tail -30` → all PASS.

- [ ] **Step 6: Gates + commit**

```bash
npx tsc --noEmit
npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/drive-sync src/lib/google/calendar.ts scripts/test-drive-time.ts
git add src/lib/drive-sync src/lib/google/calendar.ts scripts/test-drive-time.ts scripts/test-review-and-spec.ts
git commit -m "feat(drive-time): tagged Google drive events, sync diff, D144 block matcher

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The drive loader and the Google sync engine

**Files:**
- Create: `src/lib/drive-plan/load.ts`, `src/lib/drive-sync/sync.ts`
- Test: `scripts/test-drive-time.ts` (`driveTimeLoaderChecks`, `driveTimeSyncChecks`, `driveTimeNoStraightLinePins`)

**Interfaces:**
- Consumes: Task 3 (`addressStatesForVisits`, `placeStatesFor`), Task 4 (engine), Task 5 (`driveBufferFor`, `getStayOvers`, `getDriveSyncState`, `setDriveSyncState`), Task 6 (`listEventsForSync`, `insertEvent`, `updateEvent`, `deleteEvent`, diff), `baseOffice` (`src/lib/travel-origin.ts`), `officesFromSettings`/`routeCachedBulk`/`route`/`FETCH_TIMEOUT_MS` (`src/lib/geo.ts`), `ROUTE_DELAY_MS` (`src/lib/geo-backfill.ts`), `allVisits` (`src/lib/stores/site-visits.ts`), `getUser`/`allUsers` (`src/lib/users.ts`), `gmailEnabled`/`hasCalendarScope`/`personalKey` (`src/lib/gmail/config.ts`), `getConnectionInfo` (`src/lib/gmail/connections.ts`).
- Produces:
  - `load.ts`: `type DriveLoadMode = "cache" | "live"`; `type DriveUser = { id: string; name: string; officeId: string | null }`; `type DriveLoadDeps = { getUser(id: string): Promise<DriveUser | null>; offices(): Promise<Office[]>; visits(): Promise<SiteVisit[]>; bufferMin(userId: string): Promise<number>; stayOvers(userId: string): Promise<Record<string, boolean>>; visitStates(visits: VisitAddressInput[], mode: DriveLoadMode): Promise<Map<string, AddressState>>; placeStates(texts: string[], mode: DriveLoadMode): Promise<Map<string, AddressState>>; routes(pairs: Array<{ from: LatLng; to: LatLng }>, mode: DriveLoadMode): Promise<Map<string, number>> }`; `type DriveDayPlan = { dayKey: string; stops: DriveStop[]; legs: DriveLeg[]; totalMin: number }`; `planDriveDays(args: { userId: string; dayKeys: string[]; events: CalendarEvent[] | null; mode: DriveLoadMode; deps?: Partial<DriveLoadDeps> }): Promise<DriveDayPlan[]>`; `type RouteDeps`; `routeMinutesFor(pairs, mode, deps?: Partial<RouteDeps>): Promise<Map<string, number>>`.
  - `sync.ts`: `STALE_SYNC_MS = 600_000`; `SYNC_WINDOW_DAYS = 15`; `LEGACY_LOOKAHEAD_MS = 180 * 86_400_000`; `syncWindowDays(nowMs: number): string[]`; `type VisitLike = { startAt: number | null; assignedTo: string; attendees?: readonly string[] | null }`; `type DriveSyncDeps`; `type DriveSyncResult = { userId: string; days: string[]; google: "written" | "no-calendar" | "read-failed" | "none"; inserted: number; updated: number; removed: number; legacyRemoved: number; flagged: number; errors: string[] }`; `syncDriveDays(userId: string, dayKeys: string[], deps?: Partial<DriveSyncDeps>): Promise<DriveSyncResult>`; `syncDriveForUser(userId: string, deps?): Promise<DriveSyncResult>`; `syncDriveIfStale(userId: string, deps?): Promise<DriveSyncResult | null>`; `syncAllDrivers(opts: { budgetMs: number }, deps?): Promise<{ synced: number; skipped: number; errors: string[] }>`; `resyncForVisitChange(before: VisitLike | null, after: VisitLike | null, deps?): Promise<void>`; `resyncForAddress(pointKey: string, deps?): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-drive-time.ts`:

```ts
import { planDriveDays, routeMinutesFor, type DriveLoadDeps } from "@/lib/drive-plan/load";
import { resyncForVisitChange, syncDriveDays, syncDriveIfStale, syncWindowDays, type DriveSyncDeps } from "@/lib/drive-sync/sync";
import type { SiteVisit } from "@/lib/stores/site-visits";
import type { CalendarEvent, SyncCalendarEvent } from "@/lib/google/calendar";
import type { Office } from "@/lib/settings";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const visit = (id: string, over: Partial<SiteVisit>): SiteVisit => ({
  id, customerId: null, customer: "Cust " + id, locationId: null, venue: "Venue " + id, address: "addr " + id, contactName: "", contactEmail: "", contactPhone: "",
  reason: "Site survey / measure", startAt: at(9), endAt: at(10), notes: "", assignedTo: "Dana", createdBy: "x", createdAt: 1, updatedAt: 1,
  stage: "scheduled", leadId: null, surveyId: null, preferredTiming: "", ...over,
}) as SiteVisit;
const office: Office = { id: "o1", name: "Madison Office", street: "", city: "Madison", state: "WI", zip: "", lat: BASE.lat, lng: BASE.lng, quoteDefault: true };
const gEv = (id: string, over: Partial<CalendarEvent>): CalendarEvent => ({
  id, iCalUID: id + "@google.com", title: id, startMs: at(13), endMs: at(14), allDay: false, location: "1 Elm St, Appleton WI", htmlLink: "", meetingUrl: "",
  selfDeclined: false, peakDriveKey: "", peakDriveDay: "", ...over,
});
function loadDeps(over: Partial<DriveLoadDeps> = {}): Partial<DriveLoadDeps> {
  return {
    getUser: async (id) => (id === "u1" ? { id: "u1", name: "Dana", officeId: null } : null),
    offices: async () => [office],
    visits: async () => [visit("SV-1", {}), visit("SV-OTHER", { assignedTo: "Jeff" })],
    bufferMin: async () => 15,
    stayOvers: async () => ({}),
    visitStates: async (vs) => new Map(vs.map((v) => [v.id, okAddr(P1.lat, P1.lng, v.id)])),
    placeStates: async (texts) => new Map(texts.map((t) => [addressKey(t), okAddr(P2.lat, P2.lng, t)])),
    routes: async (pairs) => new Map(pairs.map((p) => [pairKey(p.from, p.to), 30])),
    ...over,
  };
}

export async function driveTimeLoaderChecks(ok: Ok): Promise<void> {
  const plans = await planDriveDays({ userId: "u1", dayKeys: [DAY], events: [gEv("meet", {}), gEv("zoom", { location: "Zoom" })], mode: "cache", deps: loadDeps() });
  ok(plans.length === 1 && plans[0].stops.map((s) => s.key).join() === "sv:SV-1,g:meet",
    "drive-time loader: the rep's own visit + their physical Google event are the stops");
  ok(plans[0].legs.length === 3 && plans[0].legs.every((l) => l.minutes === 45) && plans[0].totalMin === 135,
    "drive-time loader: base → visit → event → base, route + buffer each");
  const noOffice = await planDriveDays({ userId: "u1", dayKeys: [DAY], events: [], mode: "cache", deps: loadDeps({ offices: async () => [] }) });
  ok(noOffice[0].legs[0].flag?.text === "No base set", "drive-time loader: no office anywhere → No base set");
  const noRoutes = await planDriveDays({ userId: "u1", dayKeys: [DAY], events: [], mode: "cache", deps: loadDeps({ routes: async () => new Map() }) });
  ok(noRoutes[0].legs.every((l) => l.flag?.kind === "route_unavailable"), "drive-time loader: no cached route → 'retrying' flag, never a guess");
  let seenMode = "";
  const stays = await planDriveDays({
    userId: "u1", dayKeys: [addDays(DAY, 1)], events: [], mode: "live",
    deps: loadDeps({
      stayOvers: async () => ({ [DAY]: true }),
      visits: async () => [visit("SV-1", {}), visit("SV-2", { startAt: at(9) + 86_400_000, endAt: at(10) + 86_400_000 })],
      // Different points, or the same-place rule would drop the leg.
      visitStates: async (vs) => new Map(vs.map((v) => [v.id, v.id === "SV-1" ? okAddr(P2.lat, P2.lng, v.id) : okAddr(P1.lat, P1.lng, v.id)])),
      routes: async (pairs, mode) => { seenMode = mode; return new Map(pairs.map((p) => [pairKey(p.from, p.to), 30])); },
    }),
  });
  ok(stays[0].legs[0].from.kind === "prev_stop" && stays[0].legs[0].from.key === "sv:SV-1" && seenMode === "live",
    "drive-time loader: the previous day's stay-over + last stop are loaded; the mode reaches the route lookup");
  ok((await planDriveDays({ userId: "nobody", dayKeys: [DAY], events: null, mode: "cache", deps: loadDeps() })).length === 0,
    "drive-time loader: an unknown rep has no plan");

  // routeMinutesFor: cache only vs live
  let liveCalls = 0;
  const rdeps = {
    cached: async (keys: string[]) => new Map(keys.filter((k) => k === pairKey(BASE, P1)).map((k) => [k, { miles: 50, minutes: 60 }])),
    live: async (a: { lat: number; lng: number }) => { liveCalls++; return a.lat === P1.lat ? { miles: 30, minutes: 40 } : null; },
    delayMs: 0, budgetMs: 60_000, now: () => 0, sleep: async () => {},
  };
  const pairs = [{ from: BASE, to: P1 }, { from: P1, to: P2 }, { from: P2, to: BASE }];
  const cachedOnly = await routeMinutesFor(pairs, "cache", rdeps);
  ok(cachedOnly.size === 1 && liveCalls === 0, "drive-time routes: cache mode never calls OSRM");
  const live = await routeMinutesFor(pairs, "live", rdeps);
  ok(live.get(pairKey(P1, P2)) === 40 && !live.has(pairKey(P2, BASE)) && liveCalls === 2,
    "drive-time routes: live mode routes the misses; an OSRM failure stays missing");
}

export async function driveTimeSyncChecks(ok: Ok): Promise<void> {
  const NOW = at(6); // 06:00 on DAY
  const calls: string[] = [];
  let state = { lastSyncAt: 0, legacyCleanedAt: null as number | null };
  const tagged = (id: string, key: string, s: number, e: number, title: string, day = DAY): SyncCalendarEvent =>
    ({ ...gEv(id, { title, startMs: s, endMs: e, location: "", peakDriveKey: key, peakDriveDay: day }), description: "Drive time added by Quartzite" });
  const legKeep = `u1|${DAY}|base|sv:SV-1`;
  const events: SyncCalendarEvent[] = [
    tagged("keep", legKeep, at(9) - 45 * 60_000, at(9), "Drive to Venue SV-1"),
    tagged("orphan", `u1|${DAY}|base|sv:GONE`, at(7), at(8), "Drive to Gone"),
    tagged("far", `u1|2026-11-30|base|sv:X`, 1, 2, "Drive to X", "2026-11-30"),
    { ...gEv("mine", { title: "Lunch", location: "" }), description: "" },
    { ...gEv("legacy", { title: "Drive to Board (auto)", startMs: NOW + 3_600_000, location: "" }), description: "Auto-added travel time — safe to delete or edit." },
    { ...gEv("legacy-past", { title: "Drive to Old (auto)", startMs: NOW - 3_600_000, location: "" }), description: "Auto-added travel time — old" },
  ];
  const deps = (over: Partial<DriveSyncDeps> = {}): Partial<DriveSyncDeps> => ({
    now: () => NOW,
    calendarKeyFor: async () => "personal:u1",
    listEvents: async () => events,
    insertEvent: async (_k, ev) => { calls.push("insert:" + ev.title + ":" + ev.privateProps?.peakDriveKey); return { id: "new" }; },
    updateEvent: async (_k, id) => { calls.push("update:" + id); return {}; },
    deleteEvent: async (_k, id) => { calls.push("delete:" + id); },
    plan: (a) => planDriveDays({ ...a, deps: loadDeps({ visits: async () => [visit("SV-1", {})] }) }),
    getState: async () => state,
    setState: async (_u, p) => { state = { ...state, ...p }; },
    users: async () => [{ id: "u1", name: "Dana", status: "active" }],
    visits: async () => [visit("SV-1", {})],
    visitStates: async (vs) => new Map(vs.map((v) => [v.id, okAddr(P1.lat, P1.lng, v.id)])),
    log: () => {},
    ...over,
  });

  ok(syncWindowDays(NOW).length === 15 && syncWindowDays(NOW)[0] === DAY && syncWindowDays(NOW)[14] === addDays(DAY, 14), "drive-time sync: window is today → +14");

  const r = await syncDriveDays("u1", [DAY], deps());
  ok(r.google === "written" && calls.includes("delete:orphan") && !calls.some((c) => c.endsWith(":far") || c === "delete:far" || c === "delete:mine" || c === "update:keep"),
    "drive-time sync: orphans deleted; untagged, unchanged and out-of-scope events untouched");
  ok(calls.filter((c) => c.startsWith("insert:")).length === 1 && calls.some((c) => c.startsWith("insert:Drive back to Madison Office:")),
    "drive-time sync: the missing drive-back leg is inserted with its leg key");
  ok(calls.includes("delete:legacy") && !calls.includes("delete:legacy-past") && r.legacyRemoved === 1 && typeof state.legacyCleanedAt === "number",
    "drive-time sync: first sync deletes upcoming D144 blocks only, then remembers it did");
  calls.length = 0;
  await syncDriveDays("u1", [DAY], deps());
  ok(!calls.includes("delete:legacy"), "drive-time sync: the D144 cleanup runs once per rep");

  calls.length = 0;
  const ro = await syncDriveDays("u1", [DAY], deps({ listEvents: async () => { throw new Error("401"); } }));
  ok(ro.google === "read-failed" && calls.length === 0, "drive-time sync: a calendar read failure writes nothing");
  const app = await syncDriveDays("u1", [DAY], deps({ calendarKeyFor: async () => null }));
  ok(app.google === "no-calendar" && calls.length === 0, "drive-time sync: no connected calendar → app-only");
  const wf = await syncDriveDays("u1", [DAY], deps({ insertEvent: async () => { throw new Error("quota"); } }));
  ok(wf.errors.length >= 1 && wf.google === "written", "drive-time sync: a Google write failure is logged and counted, never thrown");
  const past = await syncDriveDays("u1", [addDays(DAY, -1), addDays(DAY, 30)], deps());
  ok(past.days.length === 0, "drive-time sync: past days and days beyond +14 are never written");

  state = { lastSyncAt: NOW - 60_000, legacyCleanedAt: 1 };
  ok((await syncDriveIfStale("u1", deps())) === null, "drive-time sync: a sync under 10 min old is not repeated");
  state = { lastSyncAt: NOW - 11 * 60_000, legacyCleanedAt: 1 };
  const stale = await syncDriveIfStale("u1", deps());
  ok(!!stale && stale.days.length === 15 && state.lastSyncAt === NOW, "drive-time sync: a stale rep re-syncs the whole window and is stamped");

  const seen: string[][] = [];
  await resyncForVisitChange(
    { startAt: at(9), assignedTo: "Dana" },
    { startAt: at(9) + 2 * 86_400_000, assignedTo: "Dana", attendees: ["Ghost"] },
    deps({ plan: async (a) => { seen.push(a.dayKeys); return []; } })
  );
  ok(seen.length === 1 && seen[0].join() === [DAY, addDays(DAY, 1), addDays(DAY, 2), addDays(DAY, 3)].join(),
    "drive-time sync: a moved visit re-syncs the old and new days (+ the day after each, for stay-overs) for each person on it");
}

export async function driveTimeNoStraightLinePins(ok: Ok): Promise<void> {
  const dirs = ["src/lib/drive-plan", "src/lib/drive-sync"];
  const banned = /\b(estimate|estimateFromParts|driveMinutes|driveMiles|haversineMiles|minutesFromMiles)\b\s*\(/;
  const offenders: string[] = [];
  for (const dir of dirs) for (const f of readdirSync(dir)) if (banned.test(readFileSync(join(dir, f), "utf8"))) offenders.push(join(dir, f));
  ok(offenders.length === 0, "drive-time pin: nothing on the drive path calls a straight-line estimate" + (offenders.length ? " — " + offenders.join(", ") : ""));
}
```

Wire the three names into the harness import + chain.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5` → `Cannot find module '@/lib/drive-plan/load'`.

- [ ] **Step 3: Write `src/lib/drive-plan/load.ts`**

```ts
/**
 * Drive loader (spec Part 2): assembles planDay input for one rep over a set
 * of Chicago days. "cache" mode (page views) reads the place book and
 * geo_cache only; "live" mode (syncs) geocodes unknown addresses and routes
 * missing pairs through OSRM. Route minutes come ONLY from geo_cache or
 * OSRM — never a straight-line estimate.
 */
import { isPhysicalLocation, addressKey } from "@/lib/address-verify/keys";
import { placeStatesFor } from "@/lib/address-verify/place-book";
import { addressStatesForVisits, type VisitAddressInput } from "@/lib/address-verify/targets";
import type { AddressState, LatLng } from "@/lib/address-verify/types";
import { FETCH_TIMEOUT_MS, officesFromSettings, route, routeCachedBulk, type RouteResult } from "@/lib/geo";
import { ROUTE_DELAY_MS } from "@/lib/geo-backfill";
import type { CalendarEvent } from "@/lib/google/calendar";
import type { Office } from "@/lib/settings";
import { driveBufferFor, getStayOvers } from "@/lib/stores/schedule-prefs";
import { allVisits, type SiteVisit } from "@/lib/stores/site-visits";
import { baseOffice } from "@/lib/travel-origin";
import { getUser } from "@/lib/users";
import { addDays, chicagoDayStart, isDayKey } from "./day";
import { dayDriveTotal, neededRoutes, pairKey, planDay, type DriveBase, type DriveLeg, type PlanDayInput } from "./plan";
import { stopsForDay, visitPeople, type DriveStop, type StopSourceEvent, type StopSourceVisit } from "./stops";

export type DriveLoadMode = "cache" | "live";
export type DriveUser = { id: string; name: string; officeId: string | null };

export type DriveLoadDeps = {
  getUser(id: string): Promise<DriveUser | null>;
  offices(): Promise<Office[]>;
  visits(): Promise<SiteVisit[]>;
  bufferMin(userId: string): Promise<number>;
  stayOvers(userId: string): Promise<Record<string, boolean>>;
  visitStates(visits: VisitAddressInput[], mode: DriveLoadMode): Promise<Map<string, AddressState>>;
  placeStates(texts: string[], mode: DriveLoadMode): Promise<Map<string, AddressState>>;
  routes(pairs: Array<{ from: LatLng; to: LatLng }>, mode: DriveLoadMode): Promise<Map<string, number>>;
};

export type DriveDayPlan = { dayKey: string; stops: DriveStop[]; legs: DriveLeg[]; totalMin: number };

export type RouteDeps = {
  cached: (keys: string[]) => Promise<Map<string, RouteResult>>;
  live: (a: LatLng, b: LatLng) => Promise<RouteResult | null>;
  delayMs: number;
  budgetMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

/** geo_cache first (pairKey === geo routeKey); in live mode, OSRM for the
 *  misses, paced and budgeted. A failed route stays missing → flagged. */
export async function routeMinutesFor(
  pairs: Array<{ from: LatLng; to: LatLng }>,
  mode: DriveLoadMode,
  deps?: Partial<RouteDeps>
): Promise<Map<string, number>> {
  const d: RouteDeps = {
    cached: routeCachedBulk,
    live: route,
    delayMs: ROUTE_DELAY_MS,
    budgetMs: 20_000,
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    ...deps,
  };
  const out = new Map<string, number>();
  if (!pairs.length) return out;
  for (const [k, r] of await d.cached(pairs.map((p) => pairKey(p.from, p.to)))) out.set(k, r.minutes);
  if (mode === "live") {
    const start = d.now();
    let n = 0;
    for (const p of pairs) {
      const k = pairKey(p.from, p.to);
      if (out.has(k)) continue;
      if (n > 0 && d.now() - start + d.delayMs + FETCH_TIMEOUT_MS > d.budgetMs) break;
      if (n > 0) await d.sleep(d.delayMs);
      n++;
      const r = await d.live(p.from, p.to);
      if (r) out.set(k, r.minutes);
    }
  }
  return out;
}

function defaultDeps(): DriveLoadDeps {
  return {
    getUser: async (id) => {
      const u = await getUser(id);
      return u ? { id: u.id, name: u.name, officeId: u.officeId ?? null } : null;
    },
    offices: officesFromSettings,
    visits: allVisits,
    bufferMin: driveBufferFor,
    stayOvers: getStayOvers,
    visitStates: (visits, mode) => addressStatesForVisits(visits, mode),
    placeStates: (texts, mode) => placeStatesFor(texts, mode),
    routes: (pairs, mode) => routeMinutesFor(pairs, mode),
  };
}

const unresolved = (label: string): AddressState => ({ status: "unresolved", label, point: null, pointKey: null, fix: null });

export async function planDriveDays(args: {
  userId: string;
  dayKeys: string[];
  events: CalendarEvent[] | null;
  mode: DriveLoadMode;
  deps?: Partial<DriveLoadDeps>;
}): Promise<DriveDayPlan[]> {
  const d = { ...defaultDeps(), ...args.deps };
  const days = [...new Set(args.dayKeys.filter(isDayKey))].sort();
  if (!days.length) return [];
  const user = await d.getUser(args.userId);
  if (!user) return [];
  // Each day also needs the day before (stay-over origin).
  const span = [...new Set(days.flatMap((k) => [addDays(k, -1), k]))].sort();
  const minMs = chicagoDayStart(span[0]);
  const maxMs = chicagoDayStart(addDays(span[span.length - 1], 1));

  const mine = (await d.visits()).filter(
    (v) => v.startAt != null && v.startAt >= minMs && v.startAt < maxMs && visitPeople(v).includes(user.name)
  );
  const vStates = await d.visitStates(
    mine.map((v) => ({ id: v.id, customerId: v.customerId, locationId: v.locationId, address: v.address })),
    args.mode
  );
  const evs = (args.events ?? []).filter((e) => e.startMs >= minMs && e.startMs < maxMs);
  const physical = evs.filter((e) => !e.allDay && !e.selfDeclined && !e.peakDriveKey && isPhysicalLocation(e.location));
  const pStates = await d.placeStates(physical.map((e) => e.location), args.mode);

  const visitSrc: StopSourceVisit[] = mine.map((v) => ({
    id: v.id,
    label: v.venue || v.customer || v.id,
    startAt: v.startAt,
    endAt: v.endAt,
    stage: v.stage,
    people: visitPeople(v),
    googleEventId: v.googleEventId ?? null,
    address: vStates.get(v.id) ?? unresolved(v.address || ""),
  }));
  const eventSrc: StopSourceEvent[] = evs.map((e) => ({
    id: e.id,
    iCalUID: e.iCalUID,
    title: e.title,
    startMs: e.startMs,
    endMs: e.endMs,
    allDay: e.allDay,
    location: e.location,
    selfDeclined: e.selfDeclined,
    peakDriveKey: e.peakDriveKey,
    address: pStates.get(addressKey(e.location)) ?? null,
  }));
  const stopsBy = new Map(span.map((k) => [k, stopsForDay({ person: user.name, dayKey: k, visits: visitSrc, events: eventSrc })]));

  const b = baseOffice(await d.offices(), user.officeId);
  const base: DriveBase | null =
    b && b.lat != null && b.lng != null && Number.isFinite(Number(b.lat)) && Number.isFinite(Number(b.lng))
      ? { name: b.name || "your base office", lat: Number(b.lat), lng: Number(b.lng) }
      : null;
  const [bufferMin, stays] = await Promise.all([d.bufferMin(user.id), d.stayOvers(user.id)]);

  const inputs: Array<Omit<PlanDayInput, "routeMinutes">> = days.map((k) => {
    const prev = addDays(k, -1);
    const prevStops = stopsBy.get(prev) ?? [];
    return {
      userId: user.id,
      dayKey: k,
      stops: stopsBy.get(k) ?? [],
      base,
      bufferMin,
      prevDay: { stayOver: !!stays[prev], lastStop: prevStops[prevStops.length - 1] ?? null },
      stayOver: !!stays[k],
    };
  });
  const pairs = new Map<string, { from: LatLng; to: LatLng }>();
  for (const i of inputs) for (const p of neededRoutes(i)) pairs.set(pairKey(p.from, p.to), p);
  const routeMinutes = pairs.size ? await d.routes([...pairs.values()], args.mode) : new Map<string, number>();
  return inputs.map((i) => {
    const legs = planDay({ ...i, routeMinutes });
    return { dayKey: i.dayKey, stops: i.stops, legs, totalMin: dayDriveTotal(legs) };
  });
}
```

- [ ] **Step 4: Write `src/lib/drive-sync/sync.ts`**

```ts
/**
 * Drive sync (spec Part 3): computes a rep's desired legs (live loader) and
 * inserts / updates / deletes ONLY Google events tagged peakDrive. Never
 * touches anything the rep made; flagged legs get no event; a rep with no
 * connected calendar is app-only; a write failure is logged and retried on
 * the next sync. Callers run these inside after() (next/server) — never on
 * the request's critical path.
 */
import { addressStatesForVisits, type VisitAddressInput } from "@/lib/address-verify/targets";
import type { AddressState } from "@/lib/address-verify/types";
import { addDays, chicagoDayKey, chicagoDayStart, isDayKey } from "@/lib/drive-plan/day";
import { planDriveDays, type DriveDayPlan, type DriveLoadMode } from "@/lib/drive-plan/load";
import { visitPeople } from "@/lib/drive-plan/stops";
import { gmailEnabled, hasCalendarScope, personalKey } from "@/lib/gmail/config";
import { getConnectionInfo } from "@/lib/gmail/connections";
import {
  deleteEvent,
  insertEvent,
  listEventsForSync,
  updateEvent,
  type EventWriteInput,
  type SyncCalendarEvent,
} from "@/lib/google/calendar";
import { getDriveSyncState, setDriveSyncState, type DriveSyncState } from "@/lib/stores/schedule-prefs";
import { allVisits, type SiteVisit } from "@/lib/stores/site-visits";
import { allUsers } from "@/lib/users";
import { desiredFromLegs, diffDriveEvents, drivePrivateProps, existingFromCalendar, isLegacyTravelBlock, type DesiredDriveEvent } from "./diff";

export const STALE_SYNC_MS = 10 * 60_000;
export const SYNC_WINDOW_DAYS = 15;
export const LEGACY_LOOKAHEAD_MS = 180 * 86_400_000;

export function syncWindowDays(nowMs: number): string[] {
  const today = chicagoDayKey(nowMs);
  return Array.from({ length: SYNC_WINDOW_DAYS }, (_, i) => addDays(today, i));
}

export type VisitLike = { startAt: number | null; assignedTo: string; attendees?: readonly string[] | null };

export type DriveSyncDeps = {
  now(): number;
  calendarKeyFor(userId: string): Promise<string | null>;
  listEvents(key: string, range: { timeMinMs: number; timeMaxMs: number }): Promise<SyncCalendarEvent[]>;
  insertEvent(key: string, ev: EventWriteInput): Promise<{ id: string }>;
  updateEvent(key: string, id: string, ev: EventWriteInput): Promise<unknown>;
  deleteEvent(key: string, id: string): Promise<void>;
  plan(args: Parameters<typeof planDriveDays>[0]): Promise<DriveDayPlan[]>;
  getState(userId: string): Promise<DriveSyncState>;
  setState(userId: string, patch: Partial<DriveSyncState>): Promise<void>;
  users(): Promise<Array<{ id: string; name: string; status: string }>>;
  visits(): Promise<SiteVisit[]>;
  visitStates(visits: VisitAddressInput[], mode: DriveLoadMode): Promise<Map<string, AddressState>>;
  log(msg: string, err?: unknown): void;
};

export type DriveSyncResult = {
  userId: string;
  days: string[];
  google: "written" | "no-calendar" | "read-failed" | "none";
  inserted: number;
  updated: number;
  removed: number;
  legacyRemoved: number;
  flagged: number;
  errors: string[];
};

function defaultDeps(): DriveSyncDeps {
  return {
    now: Date.now,
    calendarKeyFor: async (userId) => {
      if (!gmailEnabled()) return null;
      const key = personalKey(userId);
      const info = await getConnectionInfo(key);
      return info && hasCalendarScope(info.scope) ? key : null;
    },
    listEvents: listEventsForSync,
    insertEvent,
    updateEvent,
    deleteEvent,
    plan: planDriveDays,
    getState: getDriveSyncState,
    setState: setDriveSyncState,
    users: async () => (await allUsers()).map((u) => ({ id: u.id, name: u.name, status: u.status })),
    visits: allVisits,
    visitStates: (visits, mode) => addressStatesForVisits(visits, mode),
    log: (msg, err) => console.error(msg, err),
  };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

function toWrite(ev: DesiredDriveEvent): EventWriteInput {
  return { title: ev.title, startMs: ev.startMs, endMs: ev.endMs, description: ev.description, privateProps: drivePrivateProps(ev) };
}

export async function syncDriveDays(userId: string, dayKeys: string[], deps?: Partial<DriveSyncDeps>): Promise<DriveSyncResult> {
  const d = { ...defaultDeps(), ...deps };
  const now = d.now();
  const window = new Set(syncWindowDays(now));
  // Past days are history; days past +14 wait for the window to reach them.
  const days = [...new Set(dayKeys.filter((k) => isDayKey(k) && window.has(k)))].sort();
  const res: DriveSyncResult = { userId, days, google: "none", inserted: 0, updated: 0, removed: 0, legacyRemoved: 0, flagged: 0, errors: [] };
  if (!days.length) return res;

  const key = await d.calendarKeyFor(userId);
  let events: SyncCalendarEvent[] | null = null;
  if (key) {
    try {
      events = await d.listEvents(key, {
        timeMinMs: chicagoDayStart(addDays(days[0], -1)),
        timeMaxMs: chicagoDayStart(addDays(days[days.length - 1], 1)),
      });
    } catch (err) {
      d.log("[drive-sync] calendar read failed " + userId, err);
      res.google = "read-failed";
      return res; // can't see our tagged events — writing now could duplicate
    }
  } else {
    res.google = "no-calendar";
  }

  const plans = await d.plan({ userId, dayKeys: days, events, mode: "live" });
  const legs = plans.flatMap((p) => p.legs);
  res.flagged = legs.filter((l) => l.flag).length;
  if (!key || !events) return res;

  // D144 retirement — once per rep, upcoming exact-shape blocks only.
  const state = await d.getState(userId);
  if (!state.legacyCleanedAt) {
    let clean = true;
    try {
      const ahead = await d.listEvents(key, { timeMinMs: now, timeMaxMs: now + LEGACY_LOOKAHEAD_MS });
      for (const ev of ahead) {
        if (!isLegacyTravelBlock(ev, now)) continue;
        try {
          await d.deleteEvent(key, ev.id);
          res.legacyRemoved++;
        } catch (err) {
          clean = false;
          res.errors.push("legacy " + ev.id + ": " + errText(err));
        }
      }
    } catch (err) {
      clean = false;
      res.errors.push("legacy list: " + errText(err));
    }
    if (clean) await d.setState(userId, { legacyCleanedAt: now });
  }

  const diff = diffDriveEvents(desiredFromLegs(legs), existingFromCalendar(events), new Set(days));
  for (const ev of diff.insert) {
    try {
      await d.insertEvent(key, toWrite(ev));
      res.inserted++;
    } catch (err) {
      res.errors.push("insert " + ev.key + ": " + errText(err));
    }
  }
  for (const u of diff.update) {
    try {
      await d.updateEvent(key, u.id, toWrite(u.ev));
      res.updated++;
    } catch (err) {
      res.errors.push("update " + u.id + ": " + errText(err));
    }
  }
  for (const r of diff.remove) {
    try {
      await d.deleteEvent(key, r.id);
      res.removed++;
    } catch (err) {
      res.errors.push("delete " + r.id + ": " + errText(err));
    }
  }
  if (res.errors.length) d.log("[drive-sync] " + userId + " write errors", res.errors);
  res.google = "written";
  return res;
}

export async function syncDriveForUser(userId: string, deps?: Partial<DriveSyncDeps>): Promise<DriveSyncResult> {
  const d = { ...defaultDeps(), ...deps };
  const res = await syncDriveDays(userId, syncWindowDays(d.now()), d);
  await d.setState(userId, { lastSyncAt: d.now() });
  return res;
}

/** /calendar + Home: re-sync when the last one is > 10 min old (catches
 *  edits made directly in Google). Claims first so rapid reloads don't stack. */
export async function syncDriveIfStale(userId: string, deps?: Partial<DriveSyncDeps>): Promise<DriveSyncResult | null> {
  const d = { ...defaultDeps(), ...deps };
  const state = await d.getState(userId);
  if (d.now() - state.lastSyncAt < STALE_SYNC_MS) return null;
  await d.setState(userId, { lastSyncAt: d.now() });
  return syncDriveForUser(userId, d);
}

/** The daily cron rider: every active rep with a connected calendar, least
 *  recently synced first, own try/catch each, no new rep after the budget. */
export async function syncAllDrivers(opts: { budgetMs: number }, deps?: Partial<DriveSyncDeps>): Promise<{ synced: number; skipped: number; errors: string[] }> {
  const d = { ...defaultDeps(), ...deps };
  const start = d.now();
  const out = { synced: 0, skipped: 0, errors: [] as string[] };
  const reps: Array<{ id: string; lastSyncAt: number }> = [];
  for (const u of await d.users()) {
    if (u.status !== "active") continue;
    if (!(await d.calendarKeyFor(u.id))) continue;
    reps.push({ id: u.id, lastSyncAt: (await d.getState(u.id)).lastSyncAt });
  }
  reps.sort((a, b) => a.lastSyncAt - b.lastSyncAt);
  for (const r of reps) {
    if (d.now() - start > opts.budgetMs) {
      out.skipped++;
      continue;
    }
    try {
      await syncDriveForUser(r.id, d);
      out.synced++;
    } catch (err) {
      out.errors.push(r.id + ": " + errText(err));
    }
  }
  return out;
}

function addPersonDays(map: Map<string, Set<string>>, v: VisitLike | null): void {
  if (!v || v.startAt == null) return;
  const day = chicagoDayKey(v.startAt);
  for (const p of visitPeople(v)) {
    const set = map.get(p) ?? new Set<string>();
    set.add(day);
    set.add(addDays(day, 1)); // the next day's first leg may start from this day's last stop
    map.set(p, set);
  }
}

async function syncPeopleDays(map: Map<string, Set<string>>, d: DriveSyncDeps): Promise<void> {
  if (!map.size) return;
  const users = await d.users();
  for (const [name, days] of map) {
    const u = users.find((x) => x.name === name && x.status === "active");
    if (!u) continue;
    try {
      await syncDriveDays(u.id, [...days], d);
    } catch (err) {
      d.log("[drive-sync] visit re-sync failed " + u.id, err);
    }
  }
}

/** Visit created / moved / reassigned / unscheduled / deleted. */
export async function resyncForVisitChange(before: VisitLike | null, after: VisitLike | null, deps?: Partial<DriveSyncDeps>): Promise<void> {
  const d = { ...defaultDeps(), ...deps };
  const map = new Map<string, Set<string>>();
  addPersonDays(map, before);
  addPersonDays(map, after);
  await syncPeopleDays(map, d);
}

/** An address was verified: re-sync upcoming visit legs touching it now; a
 *  place-book key may also be a Google event location on anyone's calendar,
 *  so every active rep is marked stale (next view / cron picks it up). */
export async function resyncForAddress(pointKey: string, deps?: Partial<DriveSyncDeps>): Promise<void> {
  const d = { ...defaultDeps(), ...deps };
  const window = syncWindowDays(d.now());
  const minMs = chicagoDayStart(window[0]);
  const maxMs = chicagoDayStart(addDays(window[window.length - 1], 1));
  const upcoming = (await d.visits()).filter((v) => v.startAt != null && v.startAt >= minMs && v.startAt < maxMs);
  const states = await d.visitStates(
    upcoming.map((v) => ({ id: v.id, customerId: v.customerId, locationId: v.locationId, address: v.address })),
    "cache"
  );
  const map = new Map<string, Set<string>>();
  for (const v of upcoming) if (states.get(v.id)?.pointKey === pointKey) addPersonDays(map, v);
  await syncPeopleDays(map, d);
  if (pointKey.startsWith("place:")) {
    for (const u of await d.users()) if (u.status === "active") await d.setState(u.id, { lastSyncAt: 0 });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "drive-time|FAILED|ALL PASSED" | tail -60` → all PASS.

- [ ] **Step 6: Gates + commit**

```bash
npx tsc --noEmit
npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/drive-plan src/lib/drive-sync scripts/test-drive-time.ts
git add src/lib/drive-plan src/lib/drive-sync scripts/test-drive-time.ts scripts/test-review-and-spec.ts
git commit -m "feat(drive-time): drive loader and tagged Google sync engine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Triggers, D144 retirement, cron riders, stale-on-load, stay-over action

**Files:**
- Modify: `src/app/(app)/venue-assessments/visit-actions.ts`, `src/app/(app)/inbox/site-visit-actions.ts`, `src/app/(app)/calendar-actions.ts`, `src/app/(app)/calendar/event-modal.tsx`, `src/app/(app)/calendar/page.tsx`, `src/app/(app)/page.tsx`, `src/app/api/gmail/sync/route.ts`
- Test: `scripts/test-drive-time.ts` (`driveTimeTriggerPins`)

**Interfaces:**
- Consumes: Task 7 (`resyncForVisitChange`, `syncDriveDays`, `syncDriveForUser`, `syncDriveIfStale`, `syncAllDrivers`), Task 2 (`ensureVenueGeoStatus`), Task 5 (`setStayOver`), Task 4 (`chicagoDayKey`, `addDays`, `isDayKey`).
- Produces: server action `setStayOverAction(dayKey: string, on: boolean): Promise<{ ok: true } | { ok: false; error: string }>` in `src/app/(app)/calendar-actions.ts` (consumed by Task 10). `addTravelBlock`, `looksLikePhysicalAddress`, `travelOriginOptionsAction` and `EventFormInput.travelFrom` are removed.

- [ ] **Step 1: Write the failing pins**

Append to `scripts/test-drive-time.ts`:

```ts
export async function driveTimeTriggerPins(ok: Ok): Promise<void> {
  const read = (p: string) => readFileSync(p, "utf8");
  const cal = read("src/app/(app)/calendar-actions.ts");
  ok(!cal.includes("addTravelBlock") && !cal.includes("Auto-added travel time") && !cal.includes("travelOriginOptionsAction"),
    "drive-time D144: the create flow no longer adds a guessed travel block");
  ok(/export async function setStayOverAction[\s\S]*?requireUser\(\)/.test(cal) && cal.includes("syncDriveDays"),
    "drive-time: the stay-over toggle is signed-in only and re-syncs that day and the next");
  ok(!read("src/app/(app)/calendar/event-modal.tsx").includes("Traveling from"), "drive-time D144: the 'Traveling from' picker is gone");
  const va = read("src/app/(app)/venue-assessments/visit-actions.ts");
  ok((va.match(/resyncForVisitChange/g) || []).length >= 3, "drive-time: scheduling and deleting a visit re-sync the affected days");
  ok(read("src/app/(app)/inbox/site-visit-actions.ts").includes("resyncForVisitChange(null, rec)"), "drive-time: creating a visit from the Inbox re-syncs its day");
  const cron = read("src/app/api/gmail/sync/route.ts");
  ok(cron.includes("syncAllDrivers") && cron.includes("ensureVenueGeoStatus") && cron.indexOf("syncAllDrivers") < cron.indexOf("syncDrivePhotos("),
    "drive-time: the daily cron re-syncs every rep (before the photo rider eats the budget) and stamps venue status");
  ok(read("src/app/(app)/calendar/page.tsx").includes("syncDriveIfStale") && read("src/app/(app)/page.tsx").includes("syncDriveIfStale"),
    "drive-time: /calendar and Home re-sync a rep whose last sync is over 10 min old");
}
```

Wire into the harness import + chain.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:specs 2>&1 | grep -E "drive-time (D144|:)|FAIL" | tail -10` → the new pins FAIL.

- [ ] **Step 3: Visit triggers**

`src/app/(app)/venue-assessments/visit-actions.ts` — add `import { after } from "next/server";`. In `removeVisitAction`, right after `await removeVisit(id);` add:

```ts
  const removed = v;
  after(async () => {
    const { resyncForVisitChange } = await import("@/lib/drive-sync/sync");
    await resyncForVisitChange(removed, null).catch((err) => console.error("[drive-sync] visit delete re-sync failed:", err));
  });
```

In `scheduleVisitAction`, right after the `inviteStatus` line add:

```ts
  // Spec 2026-10-09 triggers: re-sync the old and new day for everyone on it.
  const prevVisit = v;
  const nextVisit = fresh;
  after(async () => {
    const { resyncForVisitChange } = await import("@/lib/drive-sync/sync");
    await resyncForVisitChange(prevVisit, nextVisit).catch((err) => console.error("[drive-sync] visit re-sync failed:", err));
  });
```

`src/app/(app)/inbox/site-visit-actions.ts` — add `import { after } from "next/server";` and after the `inviteStatus` line:

```ts
  after(async () => {
    const { resyncForVisitChange } = await import("@/lib/drive-sync/sync");
    await resyncForVisitChange(null, rec).catch((err) => console.error("[drive-sync] visit re-sync failed:", err));
  });
```

- [ ] **Step 4: Retire D144 in `src/app/(app)/calendar-actions.ts`**

1. Delete `looksLikePhysicalAddress`, `addTravelBlock`, `travelOriginOptionsAction`, the `import type { TravelFrom } …` line, and the `travelFrom?: TravelFrom;` field of `EventFormInput`.
2. In `addCalendarEventAction`, replace the whole `if (!input.allDay && input.location) { … after(…addTravelBlock…) }` block and the comment after it with:

```ts
  // Spec 2026-10-09 retires D144's guessed travel block: a new timed event
  // with a location is just another stop — re-sync that day's drive chain
  // (and the next, for a stay-over) after the response.
  if (!input.allDay) {
    const userId = grant.userId;
    const day = chicagoDayKey(input.startAt);
    after(async () => {
      const { syncDriveDays } = await import("@/lib/drive-sync/sync");
      await syncDriveDays(userId, [day, addDays(day, 1)]).catch((err) => console.error("[drive-sync] event add re-sync failed:", err));
    });
  }
```

3. In `updateCalendarEventAction` and `deleteCalendarEventAction`, just before `revalidatePath("/", "layout");` add (an edit or delete may move a stop off any day):

```ts
  const syncUser = grant.userId;
  after(async () => {
    const { syncDriveForUser } = await import("@/lib/drive-sync/sync");
    await syncDriveForUser(syncUser).catch((err) => console.error("[drive-sync] event edit re-sync failed:", err));
  });
```

and replace the D144 doc comment above `updateCalendarEventAction` with `/** Edits an event on the user's own calendar, then re-syncs their drive chain (spec 2026-10-09). */`.

4. Add `import { addDays, chicagoDayKey, isDayKey } from "@/lib/drive-plan/day";` and, after `deleteCalendarEventAction`, the stay-over action:

```ts
/** Spec 2026-10-09 "Staying over" — per rep, per date, from the calendar
 *  day: no drive-back that day, and the next day starts from its last stop. */
export async function setStayOverAction(
  dayKey: string,
  on: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!isDayKey(dayKey)) return { ok: false, error: "Bad date" };
  const { setStayOver } = await import("@/lib/stores/schedule-prefs");
  await setStayOver(me.id, dayKey, on === true);
  const userId = me.id;
  after(async () => {
    const { syncDriveDays } = await import("@/lib/drive-sync/sync");
    await syncDriveDays(userId, [dayKey, addDays(dayKey, 1)]).catch((err) => console.error("[drive-sync] stay-over re-sync failed:", err));
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
```

- [ ] **Step 5: Remove the picker from `src/app/(app)/calendar/event-modal.tsx`**

Remove `travelOriginOptionsAction` from the `../calendar-actions` import; delete the `originOpts`, `originChoice` and `originAddress` `useState` declarations; delete the `useEffect` that calls `travelOriginOptionsAction()`; delete the `travelFrom: …` property from the `input` object in `save()`; delete the whole `{target.mode === "create" && !allDay && ( <> <label style={label}>Traveling from</label> … </> )}` block.

- [ ] **Step 6: Stale-on-load**

`src/app/(app)/calendar/page.tsx` — add `import { after } from "next/server";`; right after `const [user, sp] = await Promise.all(...)` add:

```ts
  // Spec 2026-10-09: catch edits made directly in Google — re-sync this rep's
  // drive events when the last sync is over 10 min old (after the response).
  after(async () => {
    const { syncDriveIfStale } = await import("@/lib/drive-sync/sync");
    await syncDriveIfStale(user.id).catch((err) => console.error("[drive-sync] stale re-sync failed:", err));
  });
```

and change the `maxDuration` comment to `// The after() drive re-sync (geocode + OSRM + Google writes) runs inside this invocation — keep the 60s ceiling.`

`src/app/(app)/page.tsx` — add `import { after } from "next/server";` and directly below the existing `void reconcileRecordingsIfStale().catch(() => {});` line add:

```ts
  after(async () => {
    const { syncDriveIfStale } = await import("@/lib/drive-sync/sync");
    await syncDriveIfStale(user.id).catch((err) => console.error("[drive-sync] stale re-sync failed:", err));
  });
```

- [ ] **Step 7: Cron riders in `src/app/api/gmail/sync/route.ts`**

Add imports `import { ensureVenueGeoStatus } from "@/lib/address-verify/venue-geo";` and `import { syncAllDrivers } from "@/lib/drive-sync/sync";`. Append to the doc comment: `Spec 2026-10-09 adds the venue geo-status backfill and the drive-time re-sync (every rep, own try/catch + time budget), placed before the photo rider so it can't be starved.` Directly before the `// #283 — Peak Product Photos` block add:

```ts
  // Spec 2026-10-09 — stamp any venue still missing a verification status
  // (idempotent; a no-op once every row is stamped).
  let venueGeo: unknown;
  try {
    venueGeo = await ensureVenueGeoStatus();
  } catch (err) {
    venueGeo = { error: (err as Error).message };
  }

  // Spec 2026-10-09 — re-sync every rep's drive events, least recently synced
  // first, ≤ 15 s and never past 40 s into this run. Own try/catch per rep
  // inside syncAllDrivers, and one here around the whole rider.
  let driveTime: unknown;
  try {
    const budget = Math.min(15_000, 40_000 - (Date.now() - started));
    driveTime = budget > 0 ? await syncAllDrivers({ budgetMs: budget }) : { skipped: "no time left" };
  } catch (err) {
    driveTime = { error: (err as Error).message };
  }
```

and add `venueGeo, driveTime` to the returned JSON object.

- [ ] **Step 8: Run tests + gates**

Run: `npm run test:specs 2>&1 | grep -E "drive-time|FAILED|ALL PASSED" | tail -20` → all PASS.
Run: `npm run test:drive-distance 2>&1 | tail -3` → still passes (travel-origin.ts is untouched; only its calendar caller left).

```bash
npx tsc --noEmit
npx eslint --ignore-pattern scripts/test-review-and-spec.ts "src/app/(app)/venue-assessments/visit-actions.ts" "src/app/(app)/inbox/site-visit-actions.ts" "src/app/(app)/calendar-actions.ts" "src/app/(app)/calendar/event-modal.tsx" "src/app/(app)/calendar/page.tsx" "src/app/(app)/page.tsx" src/app/api/gmail/sync/route.ts scripts/test-drive-time.ts
git add "src/app/(app)/venue-assessments/visit-actions.ts" "src/app/(app)/inbox/site-visit-actions.ts" "src/app/(app)/calendar-actions.ts" "src/app/(app)/calendar/event-modal.tsx" "src/app/(app)/calendar/page.tsx" "src/app/(app)/page.tsx" src/app/api/gmail/sync/route.ts scripts/test-drive-time.ts scripts/test-review-and-spec.ts
git commit -m "feat(drive-time): visit/event/stay-over triggers, cron riders, retire D144 travel block

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: The Fix dialog, address actions and the "Addresses to verify" worklist

**Files:**
- Create: `src/components/address-fix/address-fix-drawer.tsx`, `src/components/address-fix/address-flag.tsx`, `src/app/(app)/address-actions.ts`, `src/lib/address-verify/worklist.ts`, `src/app/(app)/settings/addresses-to-verify.tsx`
- Modify: `src/lib/address-verify/fix.ts` (add `cleanFixTarget`), `src/app/(app)/settings/groups/data.tsx`, `src/app/(app)/settings/actions.ts` (remove the four venue-locate actions + `VenueAddressHit`)
- Delete: `src/app/(app)/settings/unlocated-venues.tsx`, `src/app/(app)/settings/venue-locate-drawer.tsx`
- Test: `scripts/test-drive-time.ts` (`driveTimeWorklistChecks`, `driveTimeFixUiPins`)

**Interfaces:**
- Consumes: Task 3 (`fixAddress`, `cleanFixInput`, `loadFixTarget`, `FixTargetDetails`, `placeStatesFor`, `getPlaces`, `matchVisitSite`, `addressStatesForVisits`), Task 2 (`ensureVenueGeoStatus`), Task 7 (`resyncForAddress`), `search`/`searchCity` (`geo.ts`), `samePlace` (`geo-backfill.ts`), `LeafletMap` pick mode (`picked`, `onPick`).
- Produces:
  - `fix.ts`: `cleanFixTarget(raw: unknown): FixTarget | null`.
  - `worklist.ts`: `type VerifyKind = "venue" | "visit" | "lead"`; `type VerifyStatusFilter = "unverified" | "needs_check" | "unresolved"`; `type VerifyRow = { id: string; kind: VerifyKind; status: GeoStatus; title: string; sub: string; address: string; href: string; fix: FixTarget; checked: boolean }`; `type VerifyList = { rows: VerifyRow[]; total: number; counts: Record<VerifyKind, number>; noAddress: number }`; `listAddressesToVerify(opts?: { kind?: VerifyKind | "all"; status?: VerifyStatusFilter; q?: string; offset?: number; limit?: number; now?: number }): Promise<VerifyList>`.
  - `address-actions.ts` (`"use server"`): `fixAddressAction(raw: unknown): Promise<FixAddressResult>` (requireUser; on success schedules `resyncForAddress(pointKey)` in `after()`); `loadFixTargetAction(raw: unknown): Promise<FixTargetDetails | null>` (requireUser); `searchAddressAction(query: string): Promise<AddressHit[]>` (requireUser); `townCentreForFixAction(city: string, state: string): Promise<LatLng | null>` (requireUser); `addressStatusAction(input: { customerId?: unknown; locationId?: unknown; address?: unknown }): Promise<{ status: GeoStatus; label: string; fix: FixTarget | null }>` (requireUser, live lookup — the booking warning); `listAddressesToVerifyAction(input?: unknown): Promise<VerifyList>` (requirePerm `manage_users`); `type AddressHit = { title: string; sub: string; street: string; city: string; state: string; zip: string; lat: number; lng: number }`.
  - `address-fix-drawer.tsx`: `default AddressFixDrawer(props: { target: FixTarget; reason?: string; hasNext?: boolean; onNext?: () => void; onClose: () => void; onFixed?: (status: GeoStatus) => void; onGone?: () => void })`; `reasonLabel(reason: string, got?: string): string`.
  - `address-flag.tsx`: `type AddressFlagVM = { text: string; fix: FixTarget | null }`; `default AddressFlagBadge(props: { flag: AddressFlagVM; compact?: boolean; style?: CSSProperties })` — shows the flag text and a **Fix** button that opens the drawer, then `router.refresh()`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-drive-time.ts`:

```ts
import { createFixture, fixtureId } from "./test-fixtures";
import { listAddressesToVerify } from "@/lib/address-verify/worklist";
import { cleanFixTarget } from "@/lib/address-verify/fix";

export async function driveTimeWorklistChecks(ok: Ok): Promise<void> {
  const db = await getDb();
  const SITE = "TESTdrive:site-wl";
  const NOW = Date.UTC(2026, 9, 14, 15);
  const visitText = "TESTdrive 12 Pine St, Appleton WI";
  try {
    await saveSite({ id: SITE, companyId: "TESTdrive:co-wl", name: "TESTdrive Hall", address: "", city: "Appleton", state: "WI", lat: "44.26", lng: "-88.41", venueKind: "proscenium" });
    await createFixture("site_visits", {
      id: fixtureId("drive", "sv-wl"), customerId: null, customer: "TESTdrive Cust", locationId: null, venue: "", address: visitText,
      contactName: "", contactEmail: "", contactPhone: "", reason: "Sales call", startAt: NOW + 86_400_000, endAt: NOW + 90_000_000,
      notes: "", assignedTo: "Dana", createdBy: "x", createdAt: 1, updatedAt: 1, stage: "scheduled", leadId: null, surveyId: null, preferredTiming: "",
    });
    await createFixture("site_visits", {
      id: fixtureId("drive", "sv-old"), customerId: null, customer: "TESTdrive Old", locationId: null, venue: "", address: "TESTdrive 1 Gone Rd",
      contactName: "", contactEmail: "", contactPhone: "", reason: "Sales call", startAt: NOW - 3 * 86_400_000, endAt: NOW - 3 * 86_400_000 + 3_600_000,
      notes: "", assignedTo: "Dana", createdBy: "x", createdAt: 1, updatedAt: 1, stage: "scheduled", leadId: null, surveyId: null, preferredTiming: "",
    });
    await createFixture("leads", { id: fixtureId("drive", "lead-wl"), org: "TESTdrive Org", contact: "", email: "", phone: "", address: "TESTdrive 9 Oak St", city: "Appleton", state: "WI", stage: "new", createdAt: 1, updatedAt: 1 });

    const all = await listAddressesToVerify({ q: "testdrive", now: NOW });
    const kinds = all.rows.map((r) => r.kind).join(",");
    ok(kinds === "visit,lead,venue" && all.counts.visit === 1 && all.counts.lead === 1 && all.counts.venue === 1,
      "drive-time worklist: upcoming visits, open leads and venues in one list (visits first); past visits left out");
    const venueRow = all.rows.find((r) => r.kind === "venue")!;
    ok(venueRow.status === "needs_check" && venueRow.fix.kind === "venue", "drive-time worklist: a city-level venue shows needs_check with a venue fix");
    const visitRow = all.rows.find((r) => r.kind === "visit")!;
    ok(visitRow.status === "unresolved" && !visitRow.checked && visitRow.fix.kind === "place", "drive-time worklist: an unchecked visit address shows unresolved, not yet looked up");
    ok((await listAddressesToVerify({ q: "testdrive", kind: "lead", now: NOW })).rows.every((r) => r.kind === "lead"), "drive-time worklist: kind filter");
    ok((await listAddressesToVerify({ q: "testdrive", status: "needs_check", now: NOW })).rows.map((r) => r.kind).join() === "venue", "drive-time worklist: status filter");

    // Verifying the visit's text drops it from the list.
    await fixPlace({ key: addressKey(visitText), label: visitText, mode: "pin", lat: 44.27, lng: -88.42 }, "u1");
    ok(!(await listAddressesToVerify({ q: "testdrive", now: NOW })).rows.some((r) => r.kind === "visit"), "drive-time worklist: a verified address leaves the worklist");

    ok(cleanFixTarget({ kind: "venue", siteId: "st-1" })?.kind === "venue" && cleanFixTarget({ kind: "place", key: "a b", label: "A B" })?.kind === "place" &&
       cleanFixTarget({ kind: "place", key: "a" }) === null && cleanFixTarget(null) === null, "drive-time cleanFixTarget validates untrusted targets");
  } finally {
    await db.delete(sites).where(eq(sites.id, SITE));
    await db.delete(placeBook).where(like(placeBook.key, "testdrive%"));
  }
}

export async function driveTimeFixUiPins(ok: Ok): Promise<void> {
  const read = (p: string) => readFileSync(p, "utf8");
  const actions = read("src/app/(app)/address-actions.ts");
  for (const fn of ["fixAddressAction", "loadFixTargetAction", "searchAddressAction", "townCentreForFixAction", "addressStatusAction"]) {
    ok(new RegExp(`export async function ${fn}[\\s\\S]*?await requireUser\\(\\)`).test(actions), `drive-time pin: ${fn} is signed-in only`);
  }
  ok(/export async function listAddressesToVerifyAction[\s\S]*?await requirePerm\("manage_users"\)/.test(actions), "drive-time pin: the worklist is admin-only");
  ok(actions.includes("resyncForAddress"), "drive-time pin: verifying an address re-syncs the legs touching it");
  const drawer = read("src/components/address-fix/address-fix-drawer.tsx");
  ok(drawer.includes("LeafletMap") && drawer.includes("onPick") && drawer.includes("createPortal"), "drive-time pin: the Fix dialog drops/drags a pin on the shared Leaflet map");
  ok(read("src/app/(app)/settings/groups/data.tsx").includes("AddressesToVerify"), "drive-time pin: Settings → Data shows Addresses to verify");
}
```

Wire both into the harness import + chain.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5` → `Cannot find module '@/lib/address-verify/worklist'`.

- [ ] **Step 3: Add `cleanFixTarget` to `src/lib/address-verify/fix.ts`**

```ts
/** Untrusted target → FixTarget, or null. */
export function cleanFixTarget(raw: unknown): FixTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (t.kind === "venue") {
    const siteId = str(t.siteId, 200);
    return siteId ? { kind: "venue", siteId } : null;
  }
  if (t.kind === "place") {
    const key = str(t.key, 300);
    const label = str(t.label, 300);
    return key && label != null ? { kind: "place", key, label } : null;
  }
  return null;
}
```

- [ ] **Step 4: Write `src/lib/address-verify/worklist.ts`**

```ts
/**
 * "Addresses to verify" (spec "Where flags show"): Settings → Data's
 * unlocated-venues list grown into a live worklist across venues, upcoming
 * site visits and open leads, status-filterable. A live query — it survives
 * reloads and shrinks as addresses are fixed from anywhere. Visits linked to
 * a venue are represented by the venue row.
 */
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import { companies, sites } from "@/db/schema";
import { chicagoDayKey, chicagoDayStart } from "@/lib/drive-plan/day";
import { open as openLeads } from "@/lib/stores/leads";
import { allVisits } from "@/lib/stores/site-visits";
import { addressKey } from "./keys";
import { getPlaces, placeStatesFor } from "./place-book";
import { formatVenueAddress } from "./state";
import { matchVisitSite } from "./targets";
import type { FixTarget, GeoStatus } from "./types";
import { ensureVenueGeoStatus } from "./venue-geo";

export type VerifyKind = "venue" | "visit" | "lead";
export type VerifyStatusFilter = "unverified" | "needs_check" | "unresolved";
export type VerifyRow = {
  id: string;
  kind: VerifyKind;
  status: GeoStatus;
  title: string;
  sub: string;
  address: string;
  href: string;
  fix: FixTarget;
  /** false = never looked up yet (no place-book row). */
  checked: boolean;
};
export type VerifyList = { rows: VerifyRow[]; total: number; counts: Record<VerifyKind, number>; noAddress: number };

const KIND_ORDER: Record<VerifyKind, number> = { visit: 0, lead: 1, venue: 2 };
const present = (col: AnyPgColumn) => sql`coalesce(trim(${col}), '') <> ''`;
const blank = (col: AnyPgColumn) => sql`coalesce(trim(${col}), '') = ''`;
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });

export async function listAddressesToVerify(
  opts: { kind?: VerifyKind | "all"; status?: VerifyStatusFilter; q?: string; offset?: number; limit?: number; now?: number } = {}
): Promise<VerifyList> {
  await ensureVenueGeoStatus();
  const db = await getDb();
  const now = opts.now ?? Date.now();
  const limit = Math.max(1, Math.min(200, Math.floor(Number(opts.limit) || 50)));
  const offset = Math.max(0, Math.floor(Number(opts.offset) || 0));
  const q = String(opts.q ?? "").trim().toLowerCase().slice(0, 100);
  const rows: VerifyRow[] = [];

  const venues = await db
    .select({
      siteId: sites.id,
      companyId: sites.companyId,
      companyName: companies.name,
      venueName: sites.name,
      address: sites.address,
      city: sites.city,
      state: sites.state,
      zip: sites.zip,
      geoStatus: sites.geoStatus,
    })
    .from(sites)
    .leftJoin(companies, eq(companies.id, sites.companyId))
    .where(and(eq(sites.deleted, false), inArray(sites.geoStatus, ["needs_check", "unresolved"]), or(present(sites.address), present(sites.city))))
    .orderBy(asc(sql`lower(coalesce(${companies.name}, ''))`), asc(sites.id));
  for (const r of venues) {
    rows.push({
      id: "venue:" + r.siteId,
      kind: "venue",
      status: r.geoStatus === "needs_check" ? "needs_check" : "unresolved",
      title: `${r.companyName || "(unknown company)"} · ${r.venueName || "Untitled venue"}`,
      sub: "Venue",
      address: formatVenueAddress(r),
      href: "/companies/" + encodeURIComponent(r.companyId),
      fix: { kind: "venue", siteId: r.siteId },
      checked: true,
    });
  }
  const [{ n: noAddress }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sites)
    .where(and(eq(sites.deleted, false), blank(sites.address), blank(sites.city)));

  const todayStart = chicagoDayStart(chicagoDayKey(now));
  const visits = (await allVisits()).filter(
    (v) => v.stage !== "done" && (v.startAt == null || v.startAt >= todayStart) && !!addressKey(v.address)
  );
  const companyIds = [...new Set(visits.filter((v) => v.locationId && v.customerId).map((v) => v.customerId as string))];
  const siteRows = companyIds.length
    ? await db
        .select({ id: sites.id, companyId: sites.companyId, legacyLocId: sites.legacyLocId })
        .from(sites)
        .where(and(inArray(sites.companyId, companyIds), eq(sites.deleted, false)))
    : [];
  const freeVisits = visits.filter((v) => !matchVisitSite(v, siteRows));
  const leads = (await openLeads()).filter((l) => (l.address || "").trim());
  const leadText = (l: { address: string; city: string; state: string }) =>
    [l.address, l.city, l.state].map((s) => (s || "").trim()).filter(Boolean).join(", ");
  const texts = [...freeVisits.map((v) => v.address), ...leads.map(leadText)];
  const states = await placeStatesFor(texts, "cache");
  const known = await getPlaces(texts.map(addressKey));

  for (const v of freeVisits) {
    const st = states.get(addressKey(v.address));
    if (!st || st.status === "verified" || !st.fix) continue;
    rows.push({
      id: "visit:" + v.id,
      kind: "visit",
      status: st.status,
      title: `${v.customer || v.id} — ${v.reason}`,
      sub: v.startAt != null ? "Visit " + fmtDay(v.startAt) : "Visit (not scheduled)",
      address: v.address,
      href: v.customerId ? "/companies/" + encodeURIComponent(v.customerId) : "/venue-assessments",
      fix: st.fix,
      checked: known.has(addressKey(v.address)),
    });
  }
  for (const l of leads) {
    const text = leadText(l);
    const st = states.get(addressKey(text));
    if (!st || st.status === "verified" || !st.fix) continue;
    rows.push({
      id: "lead:" + l.id,
      kind: "lead",
      status: st.status,
      title: l.org || l.id,
      sub: "Lead " + l.id,
      address: text,
      href: "/leads?lead=" + encodeURIComponent(l.id),
      fix: st.fix,
      checked: known.has(addressKey(text)),
    });
  }

  const statusOk = (r: VerifyRow) => !opts.status || opts.status === "unverified" || r.status === opts.status;
  const qOk = (r: VerifyRow) => !q || (r.title + " " + r.address).toLowerCase().includes(q);
  const filtered = rows.filter((r) => statusOk(r) && qOk(r));
  const counts: Record<VerifyKind, number> = { venue: 0, visit: 0, lead: 0 };
  for (const r of filtered) counts[r.kind]++;
  const kind = opts.kind && opts.kind !== "all" ? opts.kind : null;
  const shown = filtered
    .filter((r) => !kind || r.kind === kind)
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.title.localeCompare(b.title));
  return { rows: shown.slice(offset, offset + limit), total: shown.length, counts, noAddress: Number(noAddress) || 0 };
}
```

- [ ] **Step 5: Write `src/app/(app)/address-actions.ts`**

```ts
"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requirePerm, requireUser } from "@/lib/session";
import type { FixAddressResult, FixTargetDetails } from "@/lib/address-verify/fix";
import type { FixTarget, GeoStatus, LatLng } from "@/lib/address-verify/types";
import type { VerifyKind, VerifyList, VerifyStatusFilter } from "@/lib/address-verify/worklist";

/**
 * Address verification actions (spec 2026-10-09 "Fixing an address", "Where
 * flags show"). Fixing is open to any signed-in user — reps fix the
 * addresses on their own visits; the worklist lives in admin Settings.
 */

export type AddressHit = { title: string; sub: string; street: string; city: string; state: string; zip: string; lat: number; lng: number };

export async function fixAddressAction(raw: unknown): Promise<FixAddressResult> {
  const me = await requireUser();
  const { cleanFixInput, fixAddress } = await import("@/lib/address-verify/fix");
  const input = cleanFixInput(raw);
  if (!input) return { ok: false, reason: "invalid" };
  const r = await fixAddress(input, me.id);
  if (r.ok) {
    const pointKey = r.pointKey;
    after(async () => {
      const { resyncForAddress } = await import("@/lib/drive-sync/sync");
      await resyncForAddress(pointKey).catch((err) => console.error("[drive-sync] address re-sync failed:", err));
    });
    revalidatePath("/", "layout");
  }
  return r;
}

export async function loadFixTargetAction(raw: unknown): Promise<FixTargetDetails | null> {
  await requireUser();
  const { cleanFixTarget, loadFixTarget } = await import("@/lib/address-verify/fix");
  const target = cleanFixTarget(raw);
  return target ? loadFixTarget(target) : null;
}

export async function searchAddressAction(query: string): Promise<AddressHit[]> {
  await requireUser();
  const { search } = await import("@/lib/geo");
  const hits = await search(String(query || "").slice(0, 200), { limit: 6 });
  return hits.map((h) => ({ title: h.title, sub: h.sub, street: h.street, city: h.city, state: h.state, zip: h.zip, lat: h.lat, lng: h.lng }));
}

/** Map centre for the pin — the gated structured town lookup (#175 item 3). */
export async function townCentreForFixAction(city: string, state: string): Promise<LatLng | null> {
  await requireUser();
  const { searchCity } = await import("@/lib/geo");
  const { samePlace } = await import("@/lib/geo-backfill");
  const c = String(city || "").trim().slice(0, 100);
  const st = String(state || "").trim().slice(0, 40);
  if (!c) return null;
  const [hit] = await searchCity(c, st, { limit: 1 });
  return hit && samePlace(c, hit.city) ? { lat: hit.lat, lng: hit.lng } : null;
}

/** The booking warning: is the address this visit will use verified? Never blocks. */
export async function addressStatusAction(input: {
  customerId?: unknown;
  locationId?: unknown;
  address?: unknown;
}): Promise<{ status: GeoStatus; label: string; fix: FixTarget | null }> {
  await requireUser();
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const { addressStatesForVisits } = await import("@/lib/address-verify/targets");
  const states = await addressStatesForVisits(
    [{ id: "check", customerId: s(input?.customerId, 200) || null, locationId: s(input?.locationId, 200) || null, address: s(input?.address, 300) }],
    "live"
  );
  const st = states.get("check");
  return st ? { status: st.status, label: st.label, fix: st.fix } : { status: "unresolved", label: "", fix: null };
}

export async function listAddressesToVerifyAction(input?: unknown): Promise<VerifyList> {
  await requirePerm("manage_users");
  const { listAddressesToVerify } = await import("@/lib/address-verify/worklist");
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const kind = (["venue", "visit", "lead"] as const).find((k) => k === r.kind) as VerifyKind | undefined;
  const status = (["unverified", "needs_check", "unresolved"] as const).find((k) => k === r.status) as VerifyStatusFilter | undefined;
  return listAddressesToVerify({
    kind: kind ?? "all",
    status: status ?? "unverified",
    q: typeof r.q === "string" ? r.q : "",
    offset: Number(r.offset) || 0,
    limit: Number(r.limit) || 50,
  });
}
```

- [ ] **Step 6: Write `src/components/address-fix/address-fix-drawer.tsx`**

Generalized from `src/app/(app)/settings/venue-locate-drawer.tsx` (same three sections, same map and type-ahead behaviour), rendered through a portal so it can open from inside calendar blocks.

```tsx
"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FixTargetDetails } from "@/lib/address-verify/fix";
import type { FixTarget, GeoStatus } from "@/lib/address-verify/types";
import {
  fixAddressAction,
  loadFixTargetAction,
  searchAddressAction,
  townCentreForFixAction,
  type AddressHit,
} from "@/app/(app)/address-actions";

const LeafletMap = dynamic(() => import("@/components/map/LeafletMap"), {
  ssr: false,
  loading: () => <div style={{ height: 260, background: "#f1f2f5", borderRadius: 10 }} />,
});

/** Human wording for a lookup failure — shared with the Settings worklist. */
export function reasonLabel(reason: string, got?: string): string {
  if (reason === "no-hit") return "No match";
  if (reason === "state-mismatch") return `Resolved to ${got || "another state"} — wrong state`;
  if (reason === "city-mismatch") return `Resolved to ${got || "another town"} — wrong city`;
  if (reason === "gone") return "This venue was deleted";
  if (reason === "invalid") return "That didn’t look like a usable address or point";
  if (reason === "unavailable") return "The address lookup is unavailable right now";
  return reason;
}

/** Wisconsin default when the stated town can't be resolved. */
const WI: [number, number] = [44.5, -89.5];
type Busy = "" | "retry" | "pick" | "pin";

/**
 * The Fix dialog (spec "Fixing an address"): retype and re-run the geocoder,
 * pick a suggestion, or drop/drag a pin. A venue fix writes the venue; any
 * other address writes the place book, so the same text never flags again.
 */
export default function AddressFixDrawer({
  target,
  reason,
  hasNext,
  onNext,
  onClose,
  onFixed,
  onGone,
}: {
  target: FixTarget;
  reason?: string;
  hasNext?: boolean;
  onNext?: () => void;
  onClose: () => void;
  onFixed?: (status: GeoStatus) => void;
  onGone?: () => void;
}) {
  const [details, setDetails] = useState<FixTargetDetails | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [f, setF] = useState({ address: "", city: "", state: "", zip: "" });
  const [text, setText] = useState(target.kind === "place" ? target.label : "");
  const [busy, setBusy] = useState<Busy>("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(reason ? { ok: false, text: reason } : null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AddressHit[]>([]);
  const [hitsFor, setHitsFor] = useState("");
  const [searching, setSearching] = useState(false);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [centre, setCentre] = useState<{ c: [number, number]; z: number }>({ c: WI, z: 6 });
  const [done, setDone] = useState(false);
  const noPins = useMemo(() => [], []);
  const pinPlacedRef = useRef(false);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  useEffect(() => {
    let live = true;
    loadFixTargetAction(target)
      .then((d) => {
        if (!live) return;
        if (!d) {
          setLoadFailed(true);
          return;
        }
        setDetails(d);
        if (d.venue) {
          setF(d.venue);
          if (d.venue.city)
            townCentreForFixAction(d.venue.city, d.venue.state)
              .then((p) => {
                if (live && !pinPlacedRef.current && p) setCentre({ c: [p.lat, p.lng], z: 13 });
              })
              .catch(() => {});
        }
      })
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
  }, [target]);

  const trimmedQuery = query.trim();
  const shown = hitsFor === trimmedQuery ? hits : [];
  const showSearching = trimmedQuery.length >= 3 && hitsFor !== trimmedQuery;
  const showNoMatches = trimmedQuery.length >= 3 && hitsFor === trimmedQuery && !searching && hits.length === 0;
  useEffect(() => {
    if (query.trim().length < 3) return;
    let live = true;
    const t = setTimeout(async () => {
      setSearching(true);
      const q = query.trim();
      const h = await searchAddressAction(query).catch(() => []);
      if (live) {
        setHits(h);
        setHitsFor(q);
        setSearching(false);
      }
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  const mapCenter = useMemo<[number, number]>(() => centre.c, [centre]);

  async function run(mode: Busy, input: Record<string, unknown>) {
    setBusy(mode);
    setMsg(null);
    try {
      const r = await fixAddressAction({ target, mode, ...input });
      if (r.ok && r.status === "verified") {
        setMsg({ ok: true, text: "✓ Verified — drive time will use this address." });
        setDone(true);
        onFixed?.(r.status);
      } else if (r.ok) {
        setMsg({ ok: false, text: "Found the town or street only — drop a pin on the building to verify." });
        onFixed?.(r.status);
      } else {
        setMsg({ ok: false, text: reasonLabel(r.reason, r.got) + "." + (r.reason === "no-hit" ? " Try again, or drop a pin." : "") });
        if (r.reason === "gone") {
          setDone(true);
          onGone?.();
        }
      }
    } catch {
      setMsg({ ok: false, text: "Lookup failed. Try again, or drop a pin." });
    } finally {
      setBusy("");
    }
  }

  const field = (k: keyof typeof f, label: string, w: string) => (
    <label style={{ display: "block", flex: w, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "#9aa0ab", marginBottom: 2 }}>{label}</div>
      <input className="pk-input" style={{ width: "100%", fontSize: 13 }} value={f[k]} disabled={done} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );
  const h3 = { fontSize: 12, fontWeight: 600, letterSpacing: 0.3, color: "#5d636e", margin: "18px 0 6px" } as const;
  const addressLine = details?.venue
    ? [details.venue.address, details.venue.city, [details.venue.state, details.venue.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")
    : details?.placeText || "";

  const ui = (
    <div onClick={(e) => e.stopPropagation()} style={{ position: "fixed", inset: 0, zIndex: 60, fontFamily: "var(--font-ui)", color: "#16181d" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(22,24,29,.28)" }} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Fix address"
        className="pk-locate-drawer"
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, background: "#fff", boxShadow: "-8px 0 24px rgba(0,0,0,.12)", overflowY: "auto", padding: "16px 18px 28px" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            {details?.href ? (
              <a href={details.href} target="_blank" rel="noopener" style={{ fontSize: 15, fontWeight: 600, color: "inherit" }}>
                {details.title}
              </a>
            ) : (
              <div style={{ fontSize: 15, fontWeight: 600 }}>{details?.title || (loadFailed ? "This address is no longer here" : "Loading…")}</div>
            )}
            <div style={{ fontSize: 12.5, color: "#9aa0ab" }}>{details?.sub}</div>
            <div style={{ fontSize: 12, color: "#5d636e", marginTop: 4 }}>{addressLine || "No address"}</div>
          </div>
          <button ref={closeBtnRef} type="button" aria-label="Close" onClick={onClose} style={{ marginLeft: "auto", fontSize: 18, lineHeight: 1, background: "none", border: 0, cursor: "pointer" }}>
            ×
          </button>
        </div>

        {msg && (
          <div style={{ marginTop: 12, padding: "8px 10px", borderRadius: 8, fontSize: 12.5, background: msg.ok ? "#eef7f0" : "#fbf0ee", color: msg.ok ? "#1f6b3a" : "#8a3a2a" }}>
            {msg.text}
          </div>
        )}
        {done && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {hasNext && onNext && (
              <button type="button" className="pk-btn-accent" onClick={onNext}>
                Next address →
              </button>
            )}
            <button type="button" className="pk-btn-outline" onClick={onClose}>
              Close
            </button>
          </div>
        )}

        {!done && details && (
          <>
            <div style={h3}>RETYPE + RETRY</div>
            {details.venue ? (
              <>
                {field("address", "Street", "1 1 100%")}
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  {field("city", "City", "2 1 0")}
                  {field("state", "State", "0 0 64px")}
                  {field("zip", "Zip", "0 0 84px")}
                </div>
              </>
            ) : (
              <input className="pk-input" style={{ width: "100%", fontSize: 13 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Street, city, state" />
            )}
            <button
              type="button"
              className="pk-btn-accent"
              style={{ marginTop: 8 }}
              disabled={!!busy || (details.venue ? !(f.address.trim() || f.city.trim()) : text.trim().length < 3)}
              onClick={() => void run("retry", details.venue ? { ...f } : { text })}
            >
              {busy === "retry" ? "Looking up…" : "Retry"}
            </button>

            <div style={h3}>SEARCH</div>
            <input className="pk-input" style={{ width: "100%", fontSize: 13 }} placeholder="Type an address or place name" value={query} onChange={(e) => setQuery(e.target.value)} />
            {showSearching && <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 4 }}>Searching…</div>}
            {showNoMatches && <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 4 }}>No matches — try a shorter query, or drop a pin.</div>}
            {shown.map((h, i) => (
              <button
                key={`${h.lat},${h.lng},${i}`}
                type="button"
                disabled={!!busy}
                onClick={() =>
                  void run(
                    "pick",
                    details.venue
                      ? { address: h.street, city: h.city, state: h.state, zip: h.zip, lat: h.lat, lng: h.lng }
                      : { street: h.street, lat: h.lat, lng: h.lng }
                  )
                }
                style={{ display: "block", width: "100%", textAlign: "left", marginTop: 4, padding: "6px 8px", border: "1px solid #ececf0", borderRadius: 6, background: "#fff", cursor: "pointer" }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{h.title}</div>
                <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>{h.sub}</div>
                {!/\d/.test(h.street || "") && <div style={{ fontSize: 11, color: "#b7bcc4", marginTop: 2 }}>(town / area — no street number)</div>}
              </button>
            ))}

            <div style={h3}>DROP A PIN</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginBottom: 6 }}>Click the building on the map; drag the pin to adjust.</div>
            <LeafletMap
              pins={noPins}
              height={260}
              center={mapCenter}
              zoom={centre.z}
              picked={pin}
              onPick={(p) => {
                pinPlacedRef.current = true;
                setPin(p);
              }}
            />
            <button type="button" className="pk-btn-accent" style={{ marginTop: 8 }} disabled={!pin || !!busy} onClick={() => pin && void run("pin", { ...pin })}>
              {busy === "pin" ? "Saving…" : "Save location"}
            </button>
          </>
        )}
      </aside>
    </div>
  );
  return createPortal(ui, document.body);
}
```

- [ ] **Step 7: Write `src/components/address-fix/address-flag.tsx`**

```tsx
"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { FixTarget } from "@/lib/address-verify/types";
import AddressFixDrawer from "./address-fix-drawer";

export type AddressFlagVM = { text: string; fix: FixTarget | null };

/** "Address not verified — no drive time" + Fix (spec "Where flags show"). */
export default function AddressFlagBadge({ flag, compact = false, style }: { flag: AddressFlagVM; compact?: boolean; style?: CSSProperties }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <span
      onClick={(e) => e.stopPropagation()}
      title={flag.text}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: compact ? 10 : 11.5, fontWeight: 600, color: "#8a3a2a", ...style }}
    >
      <span>⚠ {compact ? "Not verified" : flag.text}</span>
      {flag.fix && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          style={{ fontSize: compact ? 10 : 11, fontWeight: 600, padding: compact ? "0 5px" : "1px 7px", borderRadius: 5, border: "1px solid #e8c9c0", background: "#fbf0ee", color: "#8a3a2a", cursor: "pointer" }}
        >
          Fix
        </button>
      )}
      {open && flag.fix && (
        <AddressFixDrawer
          target={flag.fix}
          onClose={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </span>
  );
}
```

- [ ] **Step 8: Write `src/app/(app)/settings/addresses-to-verify.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VerifyKind, VerifyList, VerifyRow, VerifyStatusFilter } from "@/lib/address-verify/worklist";
import AddressFixDrawer from "@/components/address-fix/address-fix-drawer";
import { listAddressesToVerifyAction } from "../address-actions";

/**
 * Settings → Data — Addresses to verify (spec 2026-10-09), grown from the
 * #175 unlocated-venues worklist: venues, upcoming site visits and open
 * leads whose address isn't verified. Live query; rows leave as they're fixed.
 */
const PAGE = 50;
const KINDS: Array<{ key: VerifyKind | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "visit", label: "Visits" },
  { key: "lead", label: "Leads" },
  { key: "venue", label: "Venues" },
];
const STATUS_LABEL: Record<string, string> = { needs_check: "Needs check", unresolved: "Unresolved" };

export default function AddressesToVerify({
  reasons,
  refreshKey,
  onChanged,
}: {
  /** Batch-geocoder failure reasons, keyed by venue site id. */
  reasons: Record<string, string>;
  refreshKey: number;
  onChanged: () => void;
}) {
  const [list, setList] = useState<VerifyList | null>(null);
  const [rows, setRows] = useState<VerifyRow[]>([]);
  const [kind, setKind] = useState<VerifyKind | "all">("all");
  const [status, setStatus] = useState<VerifyStatusFilter>("unverified");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<{ row: VerifyRow; idx: number; fixed: boolean } | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (offset: number) => {
    const mine = ++seq.current;
    setLoading(true);
    setError("");
    try {
      const r = await listAddressesToVerifyAction({ kind, status, q, offset, limit: PAGE });
      if (mine !== seq.current) return;
      setList(r);
      setRows((prev) => (offset ? [...prev, ...r.rows] : r.rows));
    } catch (e) {
      if (mine === seq.current) setError(e instanceof Error ? e.message : "Could not load the list");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [kind, status, q]);

  useEffect(() => {
    const t = setTimeout(() => void load(0), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q, refreshKey]);

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setOpen((o) => (o && o.row.id === id ? { ...o, fixed: true } : o));
    onChanged();
  }

  const nextRow = open ? rows[open.fixed ? open.idx : open.idx + 1] : undefined;
  const reasonFor = (r: VerifyRow) => (r.fix.kind === "venue" ? reasons[r.fix.siteId] : undefined);

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {list ? (
            <>
              Addresses to verify · {list.total.toLocaleString()}
              <span style={{ fontWeight: 400, color: "#9aa0ab" }}> · {list.noAddress.toLocaleString()} venues have no address at all</span>
            </>
          ) : (
            "Loading addresses…"
          )}
        </div>
        <div style={{ display: "flex", border: "1px solid #e4e7ec", borderRadius: 8, overflow: "hidden" }}>
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              className={kind === k.key ? "pk-btn-accent" : "pk-btn-outline"}
              style={{ fontSize: 12, padding: "4px 10px", border: "none", borderRadius: 0 }}
              onClick={() => setKind(k.key)}
            >
              {k.label}
              {list && k.key !== "all" ? ` (${list.counts[k.key]})` : ""}
            </button>
          ))}
        </div>
        <select className="pk-input" style={{ fontSize: 12.5, width: 150 }} value={status} onChange={(e) => setStatus(e.target.value as VerifyStatusFilter)}>
          <option value="unverified">All unverified</option>
          <option value="needs_check">Needs check</option>
          <option value="unresolved">Unresolved</option>
        </select>
        <input className="pk-input" style={{ marginLeft: "auto", width: 220, fontSize: 12.5 }} placeholder="Search name or address" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <div style={{ marginTop: 6, fontSize: 12, color: "#8a3a2a" }}>{error}</div>}
      {rows.length > 0 && (
        <div style={{ marginTop: 8, border: "1px solid #ececf0", borderRadius: 8, overflow: "hidden" }}>
          {rows.map((r, i) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setOpen({ row: r, idx: i, fixed: false })}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1.4fr) minmax(0,0.8fr)",
                gap: 10,
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                border: 0,
                borderTop: i ? "1px solid #f3f4f7" : 0,
                background: open?.row.id === r.id ? "#f6f7fb" : "#fff",
                cursor: "pointer",
                fontSize: 12.5,
                color: "#16181d",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <strong style={{ fontWeight: 600 }}>{r.title}</strong>
                <span style={{ color: "#9aa0ab" }}> · {r.sub}</span>
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#5d636e" }}>{r.address}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#8a3a2a" }}>
                {reasonFor(r) || (r.checked ? STATUS_LABEL[r.status] : "Not checked yet")}
              </span>
            </button>
          ))}
        </div>
      )}
      {list && rows.length < list.total && (
        <button type="button" className="pk-btn-outline" style={{ marginTop: 6, fontSize: 12 }} disabled={loading} onClick={() => void load(rows.length)}>
          {loading ? "Loading…" : `Show more (${(list.total - rows.length).toLocaleString()} left)`}
        </button>
      )}
      {open && (
        <AddressFixDrawer
          key={open.row.id}
          target={open.row.fix}
          reason={reasonFor(open.row)}
          hasNext={!!nextRow}
          onNext={() => nextRow && setOpen({ row: nextRow, idx: rows.indexOf(nextRow), fixed: false })}
          onClose={() => setOpen(null)}
          onFixed={(s) => s === "verified" && removeRow(open.row.id)}
          onGone={() => removeRow(open.row.id)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 9: Swap Settings over and delete the old files**

- `src/app/(app)/settings/groups/data.tsx`: replace `import UnlocatedVenues from "../unlocated-venues";` with `import AddressesToVerify from "../addresses-to-verify";`, replace `import { reasonLabel } from "../venue-locate-drawer";` with `import { reasonLabel } from "@/components/address-fix/address-fix-drawer";`, and replace the `<UnlocatedVenues … />` element with `<AddressesToVerify reasons={geoReasons} refreshKey={geoListKey} onChanged={() => void refreshGeoCoverage()} />`.
- `src/app/(app)/settings/actions.ts`: delete `listUnlocatedVenuesAction`, `type VenueAddressHit`, `searchVenueAddressAction`, `locateVenueAction` and `townCentreAction` (no other callers — confirm with `grep -rn "locateVenueAction\|searchVenueAddressAction\|townCentreAction\|listUnlocatedVenuesAction" src`).
- `git rm "src/app/(app)/settings/unlocated-venues.tsx" "src/app/(app)/settings/venue-locate-drawer.tsx"`.
- `src/lib/venue-locate.ts` keeps `listUnlocatedVenues` (the `test:geo-backfill` suite uses it).

- [ ] **Step 10: Run tests + gates + commit**

Run: `npm run test:specs 2>&1 | grep -E "drive-time|FAILED|ALL PASSED" | tail -30` → all PASS.
Run: `npm run test:geo-backfill 2>&1 | tail -3` → passes.

```bash
npx tsc --noEmit
npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/components/address-fix "src/app/(app)/address-actions.ts" src/lib/address-verify "src/app/(app)/settings/addresses-to-verify.tsx" "src/app/(app)/settings/groups/data.tsx" "src/app/(app)/settings/actions.ts" scripts/test-drive-time.ts
git add -A src/components/address-fix "src/app/(app)/address-actions.ts" src/lib/address-verify "src/app/(app)/settings" scripts/test-drive-time.ts scripts/test-review-and-spec.ts
git commit -m "feat(drive-time): Fix dialog, address actions, Addresses to verify worklist

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Drive blocks, flags and day totals on /calendar and the Home agenda

**Files:**
- Create: `src/lib/drive-sync/agenda.ts`
- Modify: `src/lib/agenda.ts`, `src/app/(app)/calendar/page.tsx`, `src/app/(app)/calendar/calendar-client.tsx`, `src/app/(app)/home-calendar.tsx`
- Test: `scripts/test-drive-time.ts` (`driveTimeAgendaChecks`)

**Interfaces:**
- Consumes: Task 7 (`planDriveDays`, `DriveLoadDeps`), Task 4 (`FLAG_TEXT`, `fmtDur`, `dayKeysBetween`, `DriveLeg`), Task 6 (`driveEventTitle`, `CalendarEvent.peakDriveKey`), Task 9 (`AddressFlagBadge`), Task 8 (`setStayOverAction`), Task 5 (`getStayOvers`).
- Produces:
  - `AgendaItem.source` gains `"drive"`; new optional fields `drive?: { dayKey: string; minutes: number | null; routeMin: number | null; bufferMin: number; flag: string | null; tight: string | null; fix: FixTarget | null; fromLabel: string; toLabel: string }` and `addressFlag?: { text: string; fix: FixTarget | null }`.
  - `drive-sync/agenda.ts`: `type AddressFlag = { text: string; fix: FixTarget | null }`; `driveItemFromLeg(leg: DriveLeg): AgendaItem`; `driveAgendaLayer(args: { userId: string; minMs: number; maxMs: number; googleEvents: CalendarEvent[] | null; deps?: Partial<DriveLoadDeps> }): Promise<{ items: AgendaItem[]; addressFlags: Map<string, AddressFlag> }>` (flag map keyed by agenda item key: `v-<visitId>`, `g-<eventId>`; a visit's `.ics` copy gets its visit's flag).
  - `CalendarClient` gains prop `stayOvers: Record<string, boolean>`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-drive-time.ts`:

```ts
import { driveAgendaLayer, driveItemFromLeg } from "@/lib/drive-sync/agenda";

export async function driveTimeAgendaChecks(ok: Ok): Promise<void> {
  const layer = await driveAgendaLayer({
    userId: "u1",
    minMs: at(0),
    maxMs: at(23),
    googleEvents: [gEv("ics1", { iCalUID: "sv-SV-1@peak-app", startMs: at(9), endMs: at(10) }), gEv("meet", {})],
    deps: loadDeps({ visitStates: async (vs) => new Map(vs.map((v) => [v.id, badAddr(v.id)])) }),
  });
  const flags = layer.items.filter((i) => i.drive?.flag);
  ok(layer.items.every((i) => i.source === "drive") && flags.length === 2 && flags.every((i) => i.drive?.flag === "Address not verified — no drive time" && i.drive?.fix?.kind === "place"),
    "drive-time agenda: legs into/out of an unverified visit render as flags with its Fix target");
  ok(layer.addressFlags.get("v-SV-1")?.fix?.kind === "place" && layer.addressFlags.get("g-ics1")?.text === "Address not verified — no drive time" && !layer.addressFlags.has("g-meet"),
    "drive-time agenda: the visit and its Google .ics copy both carry the address flag; verified stops don't");
  const okLayer = await driveAgendaLayer({ userId: "u1", minMs: at(0), maxMs: at(23), googleEvents: null, deps: loadDeps() });
  const blocks = okLayer.items.filter((i) => !i.drive?.flag);
  ok(blocks.length === 2 && blocks[0].title === "Drive to Venue SV-1" && blocks[0].endMs === at(9) && blocks[0].drive?.minutes === 45 && blocks[1].title === "Drive back to Madison Office",
    "drive-time agenda: verified legs render as timed drive blocks (no calendar connected → visits only)");
  const flagged = driveItemFromLeg(planDay(input({ stops: [stop("sv:Z", at(9), at(10), badAddr("z"))] }))[0]);
  ok(flagged.startMs === at(9) && flagged.endMs === at(9) && flagged.drive?.minutes === null, "drive-time agenda: a flag sits at its anchor with no minutes");
  const agendaSrc = readFileSync("src/lib/agenda.ts", "utf8");
  ok(agendaSrc.includes("peakDriveKey") && agendaSrc.includes("driveAgendaLayer"), "drive-time agenda: Google copies of our drive events are hidden; computed legs are shown instead");
  const client = readFileSync("src/app/(app)/calendar/calendar-client.tsx", "utf8");
  ok(client.includes("Staying near last stop") && client.includes("fmtDur(") && client.includes("AddressFlagBadge"),
    "drive-time calendar: stay-over toggle, day drive totals and Fix flags are on /calendar");
  ok(readFileSync("src/app/(app)/home-calendar.tsx", "utf8").includes('source === "drive"'), "drive-time agenda: the Home card renders drive rows");
}
```

Wire into the harness import + chain.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5` → `Cannot find module '@/lib/drive-sync/agenda'`.

- [ ] **Step 3: Write `src/lib/drive-sync/agenda.ts`**

```ts
/**
 * The drive layer of the merged agenda (spec "Display"): drive blocks as
 * their own items, flagged legs as zero-length flags at their anchor, and
 * the address flag for each unverified stop. Computed in "cache" mode on
 * every view — no geocoding or OSRM calls on a page render.
 */
import type { FixTarget } from "@/lib/address-verify/types";
import type { AgendaItem } from "@/lib/agenda";
import { dayKeysBetween } from "@/lib/drive-plan/day";
import { planDriveDays, type DriveLoadDeps } from "@/lib/drive-plan/load";
import { FLAG_TEXT, type DriveLeg } from "@/lib/drive-plan/plan";
import type { CalendarEvent } from "@/lib/google/calendar";
import { driveEventTitle } from "./diff";

export type AddressFlag = { text: string; fix: FixTarget | null };

export function driveItemFromLeg(leg: DriveLeg): AgendaItem {
  return {
    key: "d-" + leg.key,
    id: leg.key,
    title: leg.flag ? leg.flag.text : driveEventTitle(leg),
    startMs: leg.startMs ?? leg.anchorMs,
    endMs: leg.endMs ?? leg.anchorMs,
    allDay: false,
    location: "",
    href: "",
    source: "drive",
    drive: {
      dayKey: leg.dayKey,
      minutes: leg.minutes,
      routeMin: leg.routeMin,
      bufferMin: leg.bufferMin,
      flag: leg.flag?.text ?? null,
      tight: leg.tight?.text ?? null,
      fix: leg.fix,
      fromLabel: leg.from.label,
      toLabel: leg.to.label,
    },
  };
}

export async function driveAgendaLayer(args: {
  userId: string;
  minMs: number;
  maxMs: number;
  googleEvents: CalendarEvent[] | null;
  deps?: Partial<DriveLoadDeps>;
}): Promise<{ items: AgendaItem[]; addressFlags: Map<string, AddressFlag> }> {
  const plans = await planDriveDays({
    userId: args.userId,
    dayKeys: dayKeysBetween(args.minMs, args.maxMs),
    events: args.googleEvents,
    mode: "cache",
    deps: args.deps,
  });
  const items = plans.flatMap((p) => p.legs.map(driveItemFromLeg));
  const addressFlags = new Map<string, AddressFlag>();
  for (const p of plans) {
    for (const s of p.stops) {
      if (s.address.status === "verified") continue;
      const flag: AddressFlag = { text: FLAG_TEXT.unverified, fix: s.address.fix };
      if (s.kind === "visit") {
        const id = s.key.slice("sv:".length);
        addressFlags.set("v-" + id, flag);
        for (const e of args.googleEvents ?? []) if (e.iCalUID === `sv-${id}@peak-app`) addressFlags.set("g-" + e.id, flag);
      } else {
        addressFlags.set("g-" + s.key.slice("g:".length), flag);
      }
    }
  }
  return { items, addressFlags };
}
```

- [ ] **Step 4: Wire the layer into `src/lib/agenda.ts`**

1. Add `import type { FixTarget } from "@/lib/address-verify/types";`.
2. In `AgendaItem`: change `source` to `"google" | "visit" | "external" | "drive";` and add:

```ts
  /** Spec 2026-10-09 — set only for source "drive" (computed legs, never the
   *  Google copy). `flag` set = no minutes, render as a flag, not a block. */
  drive?: {
    dayKey: string;
    minutes: number | null;
    routeMin: number | null;
    bufferMin: number;
    flag: string | null;
    tight: string | null;
    fix: FixTarget | null;
    fromLabel: string;
    toLabel: string;
  };
  /** Spec 2026-10-09 — this visit/event's address isn't verified. */
  addressFlag?: { text: string; fix: FixTarget | null };
```

3. In `loadAgendaRange`, declare `const googleEvents: import("@/lib/google/calendar").CalendarEvent[] = [];` next to `fetchedIds`; inside the `for (const e of evs)` loop of the google source, first record ids as today, then add `googleEvents.push(e);` and `if (e.peakDriveKey) continue; // our own drive event — the computed leg shows instead` **before** the `items.push(...)`.
4. After the site-visits loop and before `items.sort(...)` add:

```ts
  // Spec 2026-10-09 — drive blocks + address flags, from the same stops.
  try {
    const { driveAgendaLayer } = await import("@/lib/drive-sync/agenda");
    const layer = await driveAgendaLayer({ userId, minMs, maxMs, googleEvents: calendarOn ? googleEvents : null });
    items.push(...layer.items);
    for (const it of items) {
      const f = layer.addressFlags.get(it.key);
      if (f) it.addressFlag = f;
    }
  } catch (err) {
    console.error("[agenda] drive layer failed:", err);
  }
```

- [ ] **Step 5: Pass stay-overs from `src/app/(app)/calendar/page.tsx`**

Add `getStayOvers(user.id)` (import from `@/lib/stores/schedule-prefs`) as a fourth entry in the page's `Promise.all`, destructured as `stayOvers`, and pass `stayOvers={stayOvers}` to `<CalendarClient>`.

- [ ] **Step 6: Render in `src/app/(app)/calendar/calendar-client.tsx`**

1. Imports: change the React import to `import { useMemo, useState, useSyncExternalStore, useTransition, type CSSProperties } from "react";`, add `import { useRouter } from "next/navigation";`, `import { fmtDur } from "@/lib/drive-plan/plan";`, `import AddressFlagBadge from "@/components/address-fix/address-flag";`, and add `setStayOverAction` to the `../calendar-actions` import (`import { setStayOverAction, type CalendarConnectionView } from "../calendar-actions";`).
2. Module helpers (below `isExternal`):

```ts
const isDrive = (it: AgendaItem) => it.source === "drive";
const isDriveFlag = (it: AgendaItem) => it.source === "drive" && !!it.drive?.flag;
/** Spec 2026-10-09 — the day header's total drive time (buffer included). */
function driveTotal(list: AgendaItem[]): number {
  return list.reduce((s, it) => s + (isDrive(it) && !it.drive?.flag ? it.drive?.minutes ?? 0 : 0), 0);
}
function blockColors(it: AgendaItem, tint: (hex: string, a: number) => string): { bg: string; bd: string; ink: string } {
  if (isExternal(it)) { const c = it.external!.color; return { bg: tint(c, 0.14), bd: tint(c, 0.4), ink: c }; }
  if (isDrive(it)) return it.drive?.tight ? { bg: "#fdf3e7", bd: "#f0d3a8", ink: "#8a5a1a" } : { bg: "#f1f2f5", bd: "#d9dce2", ink: "#5b616e" };
  if (it.source === "visit") return { bg: "#e8f3ee", bd: "#cfe6db", ink: "#1f7a52" };
  return { bg: "#e9eefb", bd: "#d4ddf3", ink: "#3155a8" };
}
```

3. Props: add `stayOvers` to the destructuring and `stayOvers: Record<string, boolean>;` to the props type. Inside the component add:

```ts
  const router = useRouter();
  const [stayPending, startStay] = useTransition();
  function toggleStay(k: string) {
    startStay(async () => {
      await setStayOverAction(k, !stayOvers[k]);
      router.refresh();
    });
  }
  function renderDriveFlag(it: AgendaItem) {
    return (
      <div key={it.key} onClick={(e) => e.stopPropagation()} style={{ fontSize: 10.5, lineHeight: 1.35, marginBottom: 3, padding: "2px 6px", borderRadius: 5, background: "#fbf0ee", border: "1px dashed #e8c9c0" }}>
        {it.drive?.fix ? (
          <AddressFlagBadge flag={{ text: it.drive.flag || "", fix: it.drive.fix }} compact />
        ) : (
          <span style={{ fontWeight: 600, color: "#8a3a2a" }} title={`Drive to ${it.drive?.toLabel}`}>⚠ {it.drive?.flag}</span>
        )}
      </div>
    );
  }
```

4. `chipStyle(it)`: replace the color/background/border ternaries with `const c = blockColors(it, tint);` and use `color: c.ink, background: c.bg, border: \`1px solid ${c.bd}\``.
5. `renderMonthChip(it)`: as the first line add `if (isDriveFlag(it)) return renderDriveFlag(it);`; after the chip text add `{it.addressFlag && <AddressFlagBadge flag={it.addressFlag} compact style={{ marginLeft: 4 }} />}` inside the chip div.
6. Month cell: replace `{list.slice(0, 3).map(renderMonthChip)}` and the `+N more` block with:

```tsx
                      {driveTotal(list) > 0 && (
                        <div style={{ fontSize: 10, color: "#5b616e", fontWeight: 600, marginBottom: 2 }}>Drive {fmtDur(driveTotal(list))}</div>
                      )}
                      {(() => {
                        const shownList = list.filter((it) => !isDrive(it) || isDriveFlag(it));
                        return (
                          <>
                            {shownList.slice(0, 3).map(renderMonthChip)}
                            {shownList.length > 3 && (
                              <div style={{ fontSize: 10, color: "#9aa0ab", fontWeight: 600 }}>+{shownList.length - 3} more</div>
                            )}
                          </>
                        );
                      })()}
```

7. `renderTimeGrid` day header: below the date-number `<div>` add:

```tsx
                {driveTotal(byDay.get(k) || []) > 0 && (
                  <div style={{ fontSize: 10, color: "#5b616e", fontWeight: 600, marginTop: 2 }}>Drive {fmtDur(driveTotal(byDay.get(k) || []))}</div>
                )}
                <button
                  type="button"
                  disabled={stayPending}
                  onClick={() => toggleStay(k)}
                  title="No drive back to base today; tomorrow starts from your last stop"
                  style={{ marginTop: 3, fontSize: 9.5, fontWeight: 600, padding: "1px 6px", borderRadius: 10, border: "1px solid #e4e7ec", background: stayOvers[k] ? "var(--accent)" : "#fff", color: stayOvers[k] ? "#fff" : "#9aa0ab", cursor: "pointer" }}
                >
                  {stayOvers[k] ? "✓ Staying near last stop" : "Staying near last stop"}
                </button>
```

8. All-day strip: after `{allDayItems.map(...)}` add `{(byDay.get(k) || []).filter(isDriveFlag).map(renderDriveFlag)}`.
9. Hourly grid: change `const timed = (byDay.get(k) || []).filter((it) => !it.allDay);` to `.filter((it) => !it.allDay && !isDriveFlag(it));`. In the positioned block, replace the three color ternaries with `const c = blockColors(it, tint);` → `background: c.bg, border: \`1px ${isDrive(it) ? "dashed" : "solid"} ${c.bd}\`, color: c.ink`; extend the `title` with `(it.drive?.tight ? " · " + it.drive.tight : "")`; and change the block's text to:

```tsx
                          {timeLabel(it)} {it.title}
                          {isDrive(it) && it.drive?.minutes != null ? ` · ${fmtDur(it.drive.minutes)}` : ""}
                          {it.drive?.tight && <div style={{ fontWeight: 700 }}>{it.drive.tight}</div>}
                          {it.addressFlag && <div><AddressFlagBadge flag={it.addressFlag} compact /></div>}
```

10. Header subtitle: append ` Drive time between stops is added automatically.` to each of the three strings.

- [ ] **Step 7: Render in `src/app/(app)/home-calendar.tsx`**

Add `import { fmtDur } from "@/lib/drive-plan/plan";` and `import AddressFlagBadge from "@/components/address-fix/address-flag";`. In the day-group header replace `{day}` with:

```tsx
              {day}
              {(() => {
                const total = list.reduce((s, it) => s + (it.source === "drive" && !it.drive?.flag ? it.drive?.minutes ?? 0 : 0), 0);
                return total > 0 ? <span style={{ textTransform: "none", letterSpacing: 0 }}> · Drive {fmtDur(total)}</span> : null;
              })()}
```

Inside `list.map((it) => …)`, as the first statement add:

```tsx
              if (it.source === "drive") {
                return (
                  <div key={it.key} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "4px 17px" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#9aa0ab", flexShrink: 0, width: 62 }}>{it.drive?.flag ? "" : timeLabel(it)}</span>
                    <span style={{ minWidth: 0, flex: 1, fontSize: 11.5, color: it.drive?.flag ? "#8a3a2a" : "#5b616e" }}>
                      {it.drive?.flag && it.drive.fix ? (
                        <AddressFlagBadge flag={{ text: it.drive.flag, fix: it.drive.fix }} />
                      ) : (
                        <>
                          {it.drive?.flag ? "⚠ " + it.drive.flag : it.title}
                          {it.drive?.minutes != null ? ` · ${fmtDur(it.drive.minutes)}` : ""}
                          {it.drive?.tight ? ` · ${it.drive.tight}` : ""}
                        </>
                      )}
                    </span>
                  </div>
                );
              }
```

and after the location `<span>` inside the normal row add `{it.addressFlag && <AddressFlagBadge flag={it.addressFlag} compact style={{ marginTop: 2 }} />}`.

- [ ] **Step 8: Run tests + gates + commit**

Run: `npm run test:specs 2>&1 | grep -E "drive-time|FAILED|ALL PASSED" | tail -30` → all PASS.

```bash
npx tsc --noEmit
npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/drive-sync/agenda.ts src/lib/agenda.ts "src/app/(app)/calendar/page.tsx" "src/app/(app)/calendar/calendar-client.tsx" "src/app/(app)/home-calendar.tsx" scripts/test-drive-time.ts
git add src/lib/drive-sync/agenda.ts src/lib/agenda.ts "src/app/(app)/calendar" "src/app/(app)/home-calendar.tsx" scripts/test-drive-time.ts scripts/test-review-and-spec.ts
git commit -m "feat(drive-time): drive blocks, flags, day totals and stay-over on calendar + agenda

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Booking warnings and flags on the visit

**Files:**
- Modify: `src/app/(app)/venue-assessments/page.tsx`, `src/app/(app)/venue-assessments/visit-requests.tsx`, `src/app/(app)/inbox/site-visit-modal.tsx`, `src/app/(app)/companies/[id]/page.tsx`
- Test: `scripts/test-drive-time.ts` (`driveTimeBookingPins`)

**Interfaces:**
- Consumes: Task 3 (`addressStatesForVisits`), Task 9 (`addressStatusAction`, `AddressFlagBadge`, `AddressFlagVM`), Task 4 (`FLAG_TEXT`).
- Produces: `VisitRequestVM.addressFlag: AddressFlagVM | null`.

- [ ] **Step 1: Write the failing pins**

Append to `scripts/test-drive-time.ts`:

```ts
export async function driveTimeBookingPins(ok: Ok): Promise<void> {
  const read = (p: string) => readFileSync(p, "utf8");
  const vr = read("src/app/(app)/venue-assessments/visit-requests.tsx");
  ok(vr.includes("addressFlag: AddressFlagVM | null") && vr.includes("<AddressFlagBadge"), "drive-time booking: the visit-requests scheduler shows the address flag with Fix");
  ok(read("src/app/(app)/venue-assessments/page.tsx").includes("addressStatesForVisits"), "drive-time booking: visit rows get their address state server-side");
  const modal = read("src/app/(app)/inbox/site-visit-modal.tsx");
  ok(modal.includes("addressStatusAction") && modal.includes("You can still schedule it"), "drive-time booking: the Inbox scheduler warns about an unverified address but never blocks");
  ok(read("src/app/(app)/companies/[id]/page.tsx").includes("addressStatesForVisits"), "drive-time booking: the company record's visit list flags unverified addresses");
}
```

Wire into the harness import + chain.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:specs 2>&1 | grep -E "drive-time booking" | head` → FAIL lines.

- [ ] **Step 3: Visit-requests rows**

`src/app/(app)/venue-assessments/visit-requests.tsx`: add `import AddressFlagBadge, { type AddressFlagVM } from "@/components/address-fix/address-flag";`; add to `VisitRequestVM`: `/** Spec 2026-10-09 — set when the visit's address isn't verified (no drive time). */ addressFlag: AddressFlagVM | null;`. In the row, directly after the `{row.reason}…{row.requestedLine}` line's `</div>`, add:

```tsx
          {row.addressFlag && (
            <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <AddressFlagBadge flag={row.addressFlag} />
              {row.mine && <span style={{ fontSize: 11, color: "#9aa0ab" }}>You can still schedule it — it just won’t get drive time.</span>}
            </div>
          )}
```

`src/app/(app)/venue-assessments/page.tsx`: import `addressStatesForVisits` from `@/lib/address-verify/targets` and `FLAG_TEXT` from `@/lib/drive-plan/plan`; before `const visitRows` add:

```ts
  const visitAddr = await addressStatesForVisits(
    queueVisits.map((v) => ({ id: v.id, customerId: v.customerId, locationId: v.locationId, address: v.address })),
    "cache"
  );
```

and in the row object add:

```ts
      addressFlag: (() => {
        const st = visitAddr.get(v.id);
        return st && st.status !== "verified" ? { text: FLAG_TEXT.unverified, fix: st.fix } : null;
      })(),
```

- [ ] **Step 4: Inbox scheduling dialog**

`src/app/(app)/inbox/site-visit-modal.tsx`: change the React import to include `useEffect`; add `import { addressStatusAction } from "../address-actions";`, `import AddressFlagBadge from "@/components/address-fix/address-flag";`, `import type { FixTarget, GeoStatus } from "@/lib/address-verify/types";`. After the `venueId` state add:

```tsx
  // Spec 2026-10-09 — warn while booking at an unverified address. Never blocks.
  const [addr, setAddr] = useState<{ status: GeoStatus; fix: FixTarget | null } | null>(null);
  useEffect(() => {
    let live = true;
    const venue = visit.venues.find((v) => v.id === venueId);
    addressStatusAction({ customerId, locationId: venueId || null, address: venue?.address || "" })
      .then((r) => {
        if (live) setAddr({ status: r.status, fix: r.fix });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [venueId, customerId, visit.venues]);
```

Directly below the Venue `<select>…</select>` add:

```tsx
            {addr && addr.status !== "verified" && (
              <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <AddressFlagBadge flag={{ text: "Address not verified — no drive time", fix: addr.fix }} />
                <span style={{ fontSize: 11, color: "#9aa0ab" }}>You can still schedule it.</span>
              </div>
            )}
```

- [ ] **Step 5: Company record visit list**

`src/app/(app)/companies/[id]/page.tsx`: import `addressStatesForVisits` (`@/lib/address-verify/targets`), `FLAG_TEXT` (`@/lib/drive-plan/plan`) and `AddressFlagBadge` (`@/components/address-fix/address-flag`). After `const visits = await visitsForCustomer(cust.id);` add:

```ts
  const visitAddr = await addressStatesForVisits(
    visits.map((v) => ({ id: v.id, customerId: v.customerId, locationId: v.locationId, address: v.address })),
    "cache"
  );
```

In the visit item, after the date/assignee `<div>` add:

```tsx
                        {v.stage !== "done" && visitAddr.get(v.id) && visitAddr.get(v.id)!.status !== "verified" && (
                          <div style={{ marginTop: 3 }}>
                            <AddressFlagBadge flag={{ text: FLAG_TEXT.unverified, fix: visitAddr.get(v.id)!.fix }} />
                          </div>
                        )}
```

- [ ] **Step 6: Run tests + gates + commit**

Run: `npm run test:specs 2>&1 | grep -E "drive-time|FAILED|ALL PASSED" | tail -20` → all PASS.

```bash
npx tsc --noEmit
npx eslint --ignore-pattern scripts/test-review-and-spec.ts "src/app/(app)/venue-assessments/page.tsx" "src/app/(app)/venue-assessments/visit-requests.tsx" "src/app/(app)/inbox/site-visit-modal.tsx" "src/app/(app)/companies/[id]/page.tsx" scripts/test-drive-time.ts
git add "src/app/(app)/venue-assessments" "src/app/(app)/inbox/site-visit-modal.tsx" "src/app/(app)/companies/[id]/page.tsx" scripts/test-drive-time.ts scripts/test-review-and-spec.ts
git commit -m "feat(drive-time): unverified-address warnings while booking and on the visit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Docs, build and smoke

**Files:**
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md`

**Interfaces:**
- Consumes: everything above. Produces: no code.

- [ ] **Step 1: Recompute numbers from main**

Run: `git fetch origin && git show origin/main:DECISIONS.md | grep -oE "^## D[0-9]+" | tail -1` and `git show origin/main:PUNCHLIST.md | grep -oE "#[0-9]+" | sort -t'#' -k2 -n | tail -1`. Use the next free D numbers (eleven of them) and the next free punch number; **re-run both right before committing** (sibling branches land numbers within the hour — memory `project-peak-two-sessions-on-main-merge-hazard`). Below, `D-next+0 … D-next+10` and `#next` are those numbers.

- [ ] **Step 2: DECISIONS.md entries (append, one `##` per decision)**

- `D-next+0` Verification states + venue columns: `verified`/`needs_check`/`unresolved` on four `sites` columns; the one-time venue backfill is JS (`ensureVenueGeoStatus`, idempotent, run by the worklist and the daily cron) because the building/city rule is `precisionOf`, which SQL would drift from; NULL rows read through the same rule meanwhile.
- `D-next+1` `geo_source = override` means coordinates a person supplied on a venue form/import (judged by the address's precision), distinct from `geocode` and `pin`.
- `D-next+2` Place book: exact normalized key only; a free-text hit verifies only with a house number (no stated city to gate on); a geocoder outage writes nothing (new `searchOrThrow`), so it is never stored as unresolved; a Fix is stored under the record's original text.
- `D-next+3` Base = the rep's "Based out of" office, else the company default office (`baseOffice`, as the Account picker already says); "No base set" only when no office has coordinates.
- `D-next+4` Buffer default 15 min (admin, Settings → Field → Drive time); per-user buffer, stay-over flags and sync state live in blobs (`schedule_defaults`, `schedule_prefs:<id>`, `stay_over:<id>`, `drive_sync:<id>`) — no migration.
- `D-next+5` Consecutive stops at the same point get no leg; a scheduled visit past its end (derived `done`) is still a stop on its day.
- `D-next+6` Page views compute legs in cache mode (place book + `geo_cache` only); a missing route reads "Drive time unavailable — retrying" until a live sync routes it. Syncs run in `after()`.
- `D-next+7` D144 retired: `addTravelBlock`, the "Traveling from" picker and `travelOriginOptionsAction` removed; creating/editing/deleting an in-app event re-syncs the rep's drive chain instead; the legacy-block sweep looks 180 days ahead on each rep's first sync.
- `D-next+8` Syncs never write past days or days beyond +14; a tagged-event read failure writes nothing; duplicate tagged events for one leg collapse to one.
- `D-next+9` Verifying an address re-syncs upcoming visits on it immediately; a place-book key may also be any rep's Google event location, so every active rep is marked stale (next view / cron).
- `D-next+10` Worklist: visits linked to a venue are covered by the venue row; unchecked visit/lead addresses show "Not checked yet"; fixing is open to any signed-in user, the worklist is admin-only.

- [ ] **Step 3: PUNCHLIST.md + AGENTS.md**

PUNCHLIST: add `#next — Address verification + automatic drive time` (spec + plan paths, ✅ shipped, Jeff-gated follow-ups: connect calendars per rep, set the company buffer, work through Addresses to verify, check one real day's drive events in Google). AGENTS.md phase list: append item 43 (`✅ **Address verification + drive time** (#next, D-next+0…D-next+10)`) summarising: `sites` geo stamp + `place_book` (migration 0036 — renumber at merge if taken), pure `src/lib/address-verify/` and `src/lib/drive-plan/` (`planDay`), cache/live loader, tagged `peakDrive` Google sync with the D144 sweep, triggers (visits, events, stay-over, address fixes, stale-on-load, daily cron), the Fix dialog + Addresses to verify worklist, drive blocks/flags/day totals on /calendar and Home; specs 2–3 consume `planDay`, `visitPeople`, `addressStatesForVisits` and the `schedule_*` blobs.

- [ ] **Step 4: Final gates**

```bash
npx tsc --noEmit
npm run test:specs 2>&1 | tail -3
npx eslint --ignore-pattern scripts/test-review-and-spec.ts $(git diff --name-only origin/main...HEAD -- '*.ts' '*.tsx' | grep -v '^scripts/test-review-and-spec.ts$')
npm run build
npm run test:smoke
```

Expected: tsc clean; `ALL PASSED`; eslint clean vs. the baseline; `next build` succeeds (proves no `"use client"` file pulls `@/db` — the drawer, badge, calendar client and Home card import only `address-verify/types`, `drive-plan/plan` and server-action files); smoke passes. Before `test:smoke`, check `df -h /` and clear stale `tmp.*` PGlite datadirs if the disk is tight (memory `peak-temp-pglite-dirs-fill-disk`), and make sure no dev server holds the port.

- [ ] **Step 5: Commit**

```bash
git add DECISIONS.md PUNCHLIST.md AGENTS.md
git commit -m "docs(drive-time): decisions, punch item, phase entry for address verification + drive time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec requirement | Task |
|---|---|
| States verified / needs_check / unresolved; only verified gets drive time | 1, 4 |
| Venue columns, auto-verify on building geocode, idempotent backfill, address edit resets, pin never overwritten | 1, 2 |
| Place book, exact key, resolution order, weaker results stored | 1, 3 |
| Site visits: venue state or place book | 3 |
| Fix dialog: retype → pin; venue writes venue, else place book | 3, 9 |
| Flags on visit + calendar block; worklist; warning while booking (never blocks) | 9, 10, 11 |
| `planDay` pure; stops incl. exclusions and .ics de-dupe; legs, placement, no base, unverified breaks chain, tight | 4, 7 |
| Buffer (user + company default) | 5 |
| Staying over (both days) | 4, 5, 8, 10 |
| Display: drive blocks, flags not blocks, day totals | 10 |
| Google sync: peakDrive tag + leg key, today → +14, only tagged events, flagged legs never written, app-only reps | 6, 7 |
| Triggers: visit changes, address verified, stale > 10 min on load, daily cron with per-rep try/catch + budget | 7, 8, 9 |
| Retire D144 + one-time legacy sweep (upcoming, exact shape) | 6, 7, 8 |
| Failures: OSRM → "retrying", no straight line; Google write fails → logged, retried, never blocks | 4, 7 |
| One migration | 2 |
| Testing list (normalizer, transitions, backfill, pin, planDay cases, sync diff, D144 matcher) | 1–7 |
