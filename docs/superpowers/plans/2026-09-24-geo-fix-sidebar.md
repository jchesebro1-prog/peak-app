# Unlocated Venues Worklist + Fix-it Sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Settings → Admin, list every venue that can't be located and let an admin fix one in a right-hand sidebar (edit + retry, pick a search suggestion, or drop a pin), locating and routing it immediately.

**Architecture:** The one-venue geocode logic is extracted from `backfillVenueCoords()` into `geocodeVenue()`, so the batch and the sidebar share the same checks. A new `src/lib/venue-locate.ts` owns the worklist query and the single-venue `locateVenue()` write+route. Three thin admin server actions wrap those. Two new client components (`unlocated-venues.tsx`, `venue-locate-drawer.tsx`) replace the old 20-item failure list, and `LeafletMap` gains an opt-in pick mode.

**Tech Stack:** Next.js 16 App Router (server actions), Drizzle ORM on Postgres/PGlite, Leaflet, TypeScript, tsx scenario tests.

**Spec:** `docs/superpowers/specs/2026-09-24-geo-fix-sidebar-design.md`

## Global Constraints

- Worktree: `/Users/sm/Downloads/peak-app-worktree-geo-fix` (branch `feat/geo-fix-sidebar`). Never touch `/Users/sm/Downloads/peak-app/.data`.
- Node is at `~/.local/node/bin`, so prefix commands with `export PATH=$HOME/.local/node/bin:$PATH`.
- All server actions require `requirePerm("manage_users")`.
- Writes are targeted `UPDATE sites … WHERE id = ?`, never an upsert (D181). They never touch `travelMiles`/`travelMin`, the `companies` row, or any other venue.
- Client components must NOT import `@/lib/geo` or `@/lib/geo-backfill`, because those pull in `@/db`. Type-only imports (`import type`) are fine.
- Timestamps are epoch-ms numbers. `lat`/`lng` are stored as strings (text columns).
- Punch #169, decision D225.
- **Do not push.** Jeff's production geocode run must finish first, and pushing to main deploys.

---

### Task 1: Extract `geocodeVenue()` from the batch loop

**Files:**
- Modify: `src/lib/geo-backfill.ts` (the per-query body of `backfillVenueCoords`, ~lines 300–378)
- Test: `scripts/test-geo-backfill.ts`

**Interfaces:**
- Produces (exported from `src/lib/geo-backfill.ts`):
  ```ts
  export type GeocodeCtx = { delayMs: number; townCentres: Map<string, GeoSearchHit | null> };
  export type GeocodeOutcome =
    | { ok: true; lat: number; lng: number; precision: GeocodePrecision; hit: GeoSearchHit }
    | { ok: false; reason: GeocodeFailure["reason"]; got?: string };
  export function newGeocodeCtx(delayMs?: number): GeocodeCtx;
  export async function geocodeVenue(
    row: { address?: string | null; city?: string | null; state?: string | null; zip?: string | null },
    ctx: GeocodeCtx
  ): Promise<GeocodeOutcome>;
  ```

- [ ] **Step 1: Write the failing test.** In `scripts/test-geo-backfill.ts`, change the import line to
  `import { backfillVenueCoords, cleanStreet, geocodeVenue, newGeocodeCtx, warmRoutes } from "@/lib/geo-backfill";`
  and append this block inside `main()`, just before the final `console.log(\`ALL PASSED …\`)`:

```ts
  /* ---- 5. geocodeVenue: the one-venue path the sidebar's Retry uses ---- */
  {
    const ctx = newGeocodeCtx(0);
    const ok = await geocodeVenue({ address: "605 Erie Avenue Suite 101", city: "Sheboygan", state: "WI" }, ctx);
    assert.ok(ok.ok && ok.precision === "building", "suite address resolves at building precision");
    const miss = await geocodeVenue({ address: "9 Nowhere Ln", city: "Deadville", state: "WI" }, ctx);
    assert.deepEqual(miss, { ok: false, reason: "no-hit" });
    nominatim.push({
      when: (u) => q(u).startsWith("1 wrongstate rd"),
      hit: { lat: 41.9, lng: -87.6, city: "Chicago", state: "Illinois" },
    });
    const st = await geocodeVenue({ address: "1 Wrongstate Rd", city: "Madison", state: "WI" }, ctx);
    assert.ok(!st.ok && st.reason === "state-mismatch" && st.got === "Chicago, IL");
    const far = await geocodeVenue({ address: "100 Main St", city: "Portage", state: "WI" }, ctx);
    assert.ok(!far.ok && far.reason === "city-mismatch", "far same-name street still rejected");
    const town = await geocodeVenue({ address: "P.O. Box 615", city: "Reedsburg", state: "WI" }, ctx);
    assert.ok(town.ok && town.precision === "city");
    console.log("PASS geo-backfill: geocodeVenue single-venue outcomes");
  }
```

- [ ] **Step 2: Run it and confirm it fails.**
  Run: `cd /Users/sm/Downloads/peak-app-worktree-geo-fix && export PATH=$HOME/.local/node/bin:$PATH && npm run -s test:geo-backfill`
  Expected: `FAIL TypeError: … newGeocodeCtx is not a function`.

- [ ] **Step 3: Implement.** In `src/lib/geo-backfill.ts`, add the following above `backfillVenueCoords` (after `venuesMissingCoords`):

```ts
/** Per-run state for geocodeVenue(): pacing + the stated-town centre cache. */
export type GeocodeCtx = { delayMs: number; townCentres: Map<string, GeoSearchHit | null> };

export function newGeocodeCtx(delayMs: number = GEOCODE_DELAY_MS): GeocodeCtx {
  return { delayMs, townCentres: new Map() };
}

export type GeocodeOutcome =
  | { ok: true; lat: number; lng: number; precision: GeocodePrecision; hit: GeoSearchHit }
  | { ok: false; reason: GeocodeFailure["reason"]; got?: string };

/**
 * Geocode ONE venue's address through exactly the checks the batch applies —
 * query choice, the state gate, the city gate and its postal-city radius.
 * Shared by backfillVenueCoords() and the Settings sidebar's Retry (#169) so
 * the two can never disagree about what a good match is. Writes nothing.
 */
export async function geocodeVenue(
  row: { address?: string | null; city?: string | null; state?: string | null; zip?: string | null },
  ctx: GeocodeCtx
): Promise<GeocodeOutcome> {
  const q = geocodeQuery(row);
  if (!q) return { ok: false, reason: "no-hit" };
  const precision = precisionOf(row);
  // A venue with a street address wants a free-text lookup — that is how you
  // resolve a building. A venue with only a city wants Nominatim's
  // STRUCTURED form, because free text quietly returns the wrong place: the
  // #147 fixture run got "Portage County" (64 mi out) for "Portage, WI" and
  // "Town of Baraboo" (80 mi out) for "LaCrosse, WI". Structured resolves
  // Portage correctly and returns nothing for LaCrosse — a reported miss
  // beats a confident wrong answer that misprices every quote on that venue.
  const hits =
    precision === "building"
      ? await search(q, { limit: 1 })
      : await searchCity(row.city, row.state, { limit: 1 });
  const hit = hits[0];
  if (!hit) return { ok: false, reason: "no-hit" };

  // Sanity gate: a hit in the wrong state is a bad match, and a bad match
  // silently misprices a quote. Rows with no stated state can't be checked.
  const want = stateAbbr(row.state) || (row.state || "").trim().toUpperCase();
  if (want && hit.state && hit.state !== want)
    return { ok: false, reason: "state-mismatch", got: `${hit.city}, ${hit.state}` };

  // Second gate: the right state is not the right place ("Portage" -> Portage
  // County, "LaCrosse" -> Town of Baraboo, both in Wisconsin). Require the
  // resolved city to BE the stated city — except a street-level hit within
  // POSTAL_CITY_RADIUS_MI of the stated town's centre, because a mailing city
  // is postal, not municipal (Old Sauk Rd, Middleton is filed under Madison).
  if (
    (row.city || "").trim() &&
    !samePlace(row.city, hit.city) &&
    !(precision === "building" && (await nearStatedTown(hit, row, ctx.townCentres, ctx.delayMs)))
  )
    return { ok: false, reason: "city-mismatch", got: `${hit.city}, ${hit.state}` };

  return { ok: true, lat: hit.lat, lng: hit.lng, precision, hit };
}
```

  Then replace the body of the `for (const q of toRun) { … }` loop in `backfillVenueCoords` with the version below. Also delete the now-unused `const townCentres = …` line above the loop and replace it with `const ctx: GeocodeCtx = { delayMs, townCentres: new Map() };`.

```ts
  for (const q of toRun) {
    const rows = byQuery.get(q)!;
    if (done > 0) await sleep(delayMs);
    report.queriesIssued++;
    const out = await geocodeVenue(rows[0], ctx);
    done++;
    opts?.onProgress?.(done, toRun.length);

    if (!out.ok) {
      for (const r of rows)
        report.failures.push({
          siteId: r.id,
          companyId: r.companyId,
          query: q,
          reason: out.reason,
          ...(out.got ? { got: out.got } : {}),
        });
      continue;
    }

    for (const r of rows) {
      if (!dryRun) {
        await db
          .update(sites)
          .set({ lat: String(out.lat), lng: String(out.lng), updatedAt: Date.now() })
          .where(eq(sites.id, r.id));
      }
      report.geocoded++;
      if (precisionOf(r) === "building") report.geocodedBuilding++;
      else report.geocodedCity++;
    }
  }
```

- [ ] **Step 4: Run the tests and confirm they pass.** Same command. Expected: every existing `PASS geo-backfill:` line, plus `PASS geo-backfill: geocodeVenue single-venue outcomes`, plus `ALL PASSED`. Also run `npx tsc --noEmit` and expect no output.

- [ ] **Step 5: Commit.**
```bash
git add src/lib/geo-backfill.ts scripts/test-geo-backfill.ts
git commit -m "refactor(geo): extract geocodeVenue() so the batch and the fix sidebar share one set of gates (#169)"
```

---

### Task 2: `src/lib/venue-locate.ts`: the worklist query and the single-venue fix

**Files:**
- Create: `src/lib/venue-locate.ts`
- Test: `scripts/test-geo-backfill.ts`

**Interfaces:**
- Consumes: `geocodeVenue`, `newGeocodeCtx`, `GeocodeFailure` from Task 1; `route`, `estimate`, `officesFromSettings`, `quoteOrigin`, `hasCoords`, `TravelSource` from `@/lib/geo`.
- Produces:
  ```ts
  export type UnlocatedVenue = { siteId: string; companyId: string; companyName: string; venueName: string;
    address: string; city: string; state: string; zip: string };
  export async function listUnlocatedVenues(opts?: { q?: string; offset?: number; limit?: number }):
    Promise<{ rows: UnlocatedVenue[]; total: number; noAddress: number }>;
  export type LocateInput =
    | { siteId: string; mode: "retry"; address: string; city: string; state: string; zip: string }
    | { siteId: string; mode: "pick"; address: string; city: string; state: string; zip: string; lat: number; lng: number }
    | { siteId: string; mode: "pin"; lat: number; lng: number };
  export type LocateResult =
    | { ok: true; lat: number; lng: number; miles: number | null; minutes: number | null;
        source: TravelSource; officeName: string | null }
    | { ok: false; reason: GeocodeFailure["reason"] | "gone" | "invalid"; got?: string };
  export async function locateVenue(input: LocateInput, opts?: { delayMs?: number }): Promise<LocateResult>;
  ```

- [ ] **Step 1: Write the failing tests.** In `scripts/test-geo-backfill.ts`, change the schema import to
  `import { companies, geoCache, sites } from "@/db/schema";`, add
  `import { listUnlocatedVenues, locateVenue } from "@/lib/venue-locate";` and
  `import { seedIfEmpty } from "@/db/seed-data";`. At the top of `main()`, directly after
  `const db = await getDb();`, add `await seedIfEmpty(db);`. `getDb()` fires an un-awaited background
  auto-seed, which `scripts/test-grid-options.ts` also awaits. Without this, demo sites and companies can
  land mid-test and make the worklist counts flaky. Then append inside `main()` after the Task 1 block (the Reedsburg quote-default office from section 4 is still set):

```ts
  /* ---- 6. worklist query ---- */
  await db.delete(sites);
  await db.delete(companies);
  const now = Date.now();
  await db.insert(companies).values([
    { id: "co-a", name: "Acme Theatre", createdAt: now, updatedAt: now },
    { id: "co-b", name: "Beta School", createdAt: now, updatedAt: now },
  ]);
  const site = (id: string, companyId: string, f: Partial<typeof sites.$inferInsert>) =>
    db.insert(sites).values({ id, companyId, createdAt: now, updatedAt: now, ...f });
  await site("st-w1", "co-b", { name: "Gym", address: "1302 South Broadway", city: "DePere", state: "WI" });
  await site("st-w2", "co-a", { name: "", address: "", city: "Muskego", state: "WI", lat: "" });
  await site("st-located", "co-a", { address: "1 A St", city: "X", state: "WI", lat: "43", lng: "-89" });
  await site("st-deleted", "co-a", { address: "2 A St", city: "X", state: "WI", deleted: true });
  await site("st-manual", "co-a", { address: "3 A St", city: "X", state: "WI", travelMiles: "40" });
  await site("st-noaddr", "co-a", { address: "", city: "" });
  const wl = await listUnlocatedVenues({});
  assert.deepEqual(wl.rows.map((r) => r.siteId), ["st-w2", "st-w1"], "ordered by company then venue; only fixable rows");
  assert.equal(wl.total, 2);
  assert.equal(wl.noAddress, 1, "the address-less venue is counted, not listed");
  assert.equal(wl.rows[1].companyName, "Beta School");
  assert.deepEqual((await listUnlocatedVenues({ q: "broadway" })).rows.map((r) => r.siteId), ["st-w1"]);
  assert.deepEqual((await listUnlocatedVenues({ q: "acme" })).rows.map((r) => r.siteId), ["st-w2"]);
  assert.deepEqual((await listUnlocatedVenues({ offset: 1, limit: 1 })).rows.map((r) => r.siteId), ["st-w1"]);
  console.log("PASS geo-backfill: unlocated worklist query");

  /* ---- 7. locateVenue: retry / pick / pin, and nothing else changes ---- */
  const snapshot = async () =>
    JSON.stringify({
      s: (await db.select().from(sites)).sort((a, b) => a.id.localeCompare(b.id)),
      c: (await db.select().from(companies)).sort((a, b) => a.id.localeCompare(b.id)),
    });
  const others = async (exceptId: string) =>
    JSON.stringify({
      s: (await db.select().from(sites)).filter((r) => r.id !== exceptId).sort((a, b) => a.id.localeCompare(b.id)),
      c: (await db.select().from(companies)).sort((a, b) => a.id.localeCompare(b.id)),
    });

  // retry failure writes NOTHING
  const before = await snapshot();
  const rf = await locateVenue(
    { siteId: "st-w1", mode: "retry", address: "1302 South Broadway", city: "DePere", state: "WI", zip: "" },
    { delayMs: 0 }
  );
  assert.deepEqual(rf, { ok: false, reason: "no-hit" });
  assert.equal(await snapshot(), before, "a failed retry writes nothing");

  // retry success writes the corrected address + coordinates, routes, touches nothing else
  nominatim.push({
    when: (u) => q(u).startsWith("1302 south broadway, de pere"),
    hit: { lat: 44.4486, lng: -88.0604, city: "De Pere", state: "Wisconsin" },
  });
  const othersBefore = await others("st-w1");
  const rs = await locateVenue(
    { siteId: "st-w1", mode: "retry", address: "1302 South Broadway", city: "De Pere", state: "WI", zip: "54115" },
    { delayMs: 0 }
  );
  assert.ok(rs.ok && rs.source === "routed" && rs.officeName === "Reedsburg", JSON.stringify(rs));
  const [w1] = await db.select().from(sites).where(eq(sites.id, "st-w1"));
  assert.equal(w1.city, "De Pere");
  assert.equal(w1.zip, "54115");
  assert.equal(w1.lat, "44.4486");
  assert.equal(w1.travelMiles, null, "manual override untouched");
  assert.equal(await others("st-w1"), othersBefore, "no other venue and no company changed");
  const cached = await db.select().from(geoCache);
  assert.ok(cached.some((r) => r.key.endsWith("|44.4486,-88.0604")), "route warmed for the new coordinates");

  // pin writes ONLY lat/lng
  const pinned = await locateVenue({ siteId: "st-w2", mode: "pin", lat: 42.9, lng: -88.13 });
  assert.ok(pinned.ok);
  const [w2] = await db.select().from(sites).where(eq(sites.id, "st-w2"));
  assert.equal(w2.lat, "42.9");
  assert.equal(w2.city, "Muskego", "pin leaves the address text alone");

  // pick writes every field
  const pick = await locateVenue({
    siteId: "st-w2", mode: "pick", address: "W185 S8750 Racine Ave", city: "Muskego", state: "WI",
    zip: "53150", lat: 42.8923, lng: -88.1301,
  });
  assert.ok(pick.ok);
  const [w2b] = await db.select().from(sites).where(eq(sites.id, "st-w2"));
  assert.equal(w2b.address, "W185 S8750 Racine Ave");
  assert.equal(w2b.zip, "53150");
  assert.equal(w2b.lng, "-88.1301");

  // validation
  assert.deepEqual(await locateVenue({ siteId: "st-w2", mode: "pin", lat: 91, lng: 0 }), { ok: false, reason: "invalid" });
  assert.deepEqual(await locateVenue({ siteId: "st-w2", mode: "pin", lat: NaN, lng: 0 }), { ok: false, reason: "invalid" });
  assert.deepEqual(await locateVenue({ siteId: "st-deleted", mode: "pin", lat: 43, lng: -89 }), { ok: false, reason: "gone" });
  assert.deepEqual(await locateVenue({ siteId: "nope", mode: "pin", lat: 43, lng: -89 }), { ok: false, reason: "gone" });
  assert.equal((await listUnlocatedVenues({})).total, 0, "both fixed venues left the worklist");
  console.log("PASS geo-backfill: locateVenue retry / pick / pin");
```

- [ ] **Step 2: Run it and confirm it fails.** `npm run -s test:geo-backfill`. Expected: an error that `@/lib/venue-locate` cannot be resolved.

- [ ] **Step 3: Implement.** Create `src/lib/venue-locate.ts`:

```ts
/**
 * Unlocated venues — the Settings → Admin worklist and its one-venue fix
 * (punch #169, D225). Spec: docs/superpowers/specs/2026-09-24-geo-fix-sidebar-design.md
 *
 * The worklist is a live query, not the batch run's memory: every venue that
 * has an address (or a city) but no coordinates and no manual travel
 * override. It survives reloads, has no cap, and shrinks as venues are fixed
 * from anywhere. locateVenue() fixes ONE venue three ways — retry an edited
 * address through the batch's own gates (geocodeVenue), take a search
 * suggestion a human picked, or take a pin a human dropped — then warms its
 * OSRM route so travel reads "routed" immediately.
 *
 * Writes are targeted UPDATEs of that one `sites` row (D181): never an
 * insert, never the company's mailing address, never travelMiles/travelMin —
 * the Companies "Route" button copies miles into those manual-override
 * fields and so freezes travel; here travel stays live via the route cache.
 */
import { and, asc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import { companies, sites } from "@/db/schema";
import {
  estimate,
  hasCoords,
  officesFromSettings,
  quoteOrigin,
  route,
  type TravelSource,
} from "@/lib/geo";
import { geocodeVenue, newGeocodeCtx, type GeocodeFailure } from "@/lib/geo-backfill";

export type UnlocatedVenue = {
  siteId: string;
  companyId: string;
  companyName: string;
  venueName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
};

const blank = (col: AnyPgColumn) => sql`coalesce(trim(${col}), '') = ''`;
const present = (col: AnyPgColumn) => sql`coalesce(trim(${col}), '') <> ''`;

/** No usable coordinates — NULL and "" both count as missing (see venuesMissingCoords). */
const noCoords = or(isNull(sites.lat), eq(sites.lat, ""), isNull(sites.lng), eq(sites.lng, ""))!;

export async function listUnlocatedVenues(opts?: {
  q?: string;
  offset?: number;
  limit?: number;
}): Promise<{ rows: UnlocatedVenue[]; total: number; noAddress: number }> {
  const db = await getDb();
  const limit = Math.max(1, Math.min(200, Math.floor(Number(opts?.limit) || 50)));
  const offset = Math.max(0, Math.floor(Number(opts?.offset) || 0));
  const q = (opts?.q || "").trim().slice(0, 100);

  const fixable = and(
    eq(sites.deleted, false),
    noCoords,
    or(present(sites.address), present(sites.city)),
    // A manual override already gives estimate() a travel number.
    blank(sites.travelMiles),
    blank(sites.travelMin)
  )!;
  const like = `%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
  const where = q
    ? and(
        fixable,
        or(
          ilike(companies.name, like),
          ilike(sites.name, like),
          ilike(sites.address, like),
          ilike(sites.city, like)
        )
      )!
    : fixable;

  const rows = await db
    .select({
      siteId: sites.id,
      companyId: sites.companyId,
      companyName: companies.name,
      venueName: sites.name,
      address: sites.address,
      city: sites.city,
      state: sites.state,
      zip: sites.zip,
    })
    .from(sites)
    .leftJoin(companies, eq(companies.id, sites.companyId))
    .where(where)
    .orderBy(asc(sql`coalesce(${companies.name}, '')`), asc(sites.name), asc(sites.id))
    .limit(limit)
    .offset(offset);

  const [{ n: total }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sites)
    .leftJoin(companies, eq(companies.id, sites.companyId))
    .where(where);
  const [{ n: noAddress }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sites)
    .where(and(eq(sites.deleted, false), noCoords, blank(sites.address), blank(sites.city)));

  return {
    rows: rows.map((r) => ({
      siteId: r.siteId,
      companyId: r.companyId,
      companyName: r.companyName || "(unknown company)",
      venueName: r.venueName || "",
      address: r.address || "",
      city: r.city || "",
      state: r.state || "",
      zip: r.zip || "",
    })),
    total: Number(total) || 0,
    noAddress: Number(noAddress) || 0,
  };
}

export type LocateInput =
  | { siteId: string; mode: "retry"; address: string; city: string; state: string; zip: string }
  | {
      siteId: string;
      mode: "pick";
      address: string;
      city: string;
      state: string;
      zip: string;
      lat: number;
      lng: number;
    }
  | { siteId: string; mode: "pin"; lat: number; lng: number };

export type LocateResult =
  | {
      ok: true;
      lat: number;
      lng: number;
      miles: number | null;
      minutes: number | null;
      source: TravelSource;
      officeName: string | null;
    }
  | { ok: false; reason: GeocodeFailure["reason"] | "gone" | "invalid"; got?: string };

const clip = (v: unknown, n = 200) => String(v ?? "").trim().slice(0, n);
const orNull = (s: string) => (s ? s : null);
const validCoord = (lat: unknown, lng: unknown) =>
  typeof lat === "number" && typeof lng === "number" &&
  Number.isFinite(lat) && Number.isFinite(lng) &&
  lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

export async function locateVenue(
  input: LocateInput,
  opts?: { delayMs?: number }
): Promise<LocateResult> {
  const db = await getDb();
  const siteId = clip(input?.siteId, 120);
  const [row] = siteId
    ? await db.select().from(sites).where(and(eq(sites.id, siteId), eq(sites.deleted, false))).limit(1)
    : [];
  if (!row) return { ok: false, reason: "gone" };

  let lat: number;
  let lng: number;
  const set: Partial<typeof sites.$inferInsert> = { updatedAt: Date.now() };

  if (input.mode === "retry") {
    const fields = {
      address: clip(input.address),
      city: clip(input.city, 100),
      state: clip(input.state, 40),
      zip: clip(input.zip, 20),
    };
    const out = await geocodeVenue(fields, newGeocodeCtx(opts?.delayMs));
    if (!out.ok) return { ok: false, reason: out.reason, ...(out.got ? { got: out.got } : {}) };
    lat = out.lat;
    lng = out.lng;
    Object.assign(set, {
      address: orNull(fields.address),
      city: orNull(fields.city),
      state: orNull(fields.state),
      zip: orNull(fields.zip),
    });
  } else if (input.mode === "pick" || input.mode === "pin") {
    if (!validCoord(input.lat, input.lng)) return { ok: false, reason: "invalid" };
    lat = input.lat;
    lng = input.lng;
    if (input.mode === "pick")
      Object.assign(set, {
        address: orNull(clip(input.address)),
        city: orNull(clip(input.city, 100)),
        state: orNull(clip(input.state, 40)),
        zip: orNull(clip(input.zip, 20)),
      });
  } else {
    return { ok: false, reason: "invalid" };
  }

  set.lat = String(lat);
  set.lng = String(lng);
  await db.update(sites).set(set).where(and(eq(sites.id, row.id), eq(sites.deleted, false)));

  // Warm the real route now so travel reads "routed", not the haversine tier.
  // route() fails soft to null; estimate() then falls back on its own.
  const offices = await officesFromSettings();
  const office = quoteOrigin(offices);
  const target = { lat, lng };
  if (office && hasCoords(office)) await route(office, target);
  const est = await estimate(offices, { ...target, travelMiles: row.travelMiles, travelMin: row.travelMin });
  return {
    ok: true,
    lat,
    lng,
    miles: est.miles,
    minutes: est.minutes,
    source: est.source,
    officeName: office && hasCoords(office) ? office.name || "the quote origin" : null,
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass.** `npm run -s test:geo-backfill`. Expected: `PASS geo-backfill: unlocated worklist query`, `PASS geo-backfill: locateVenue retry / pick / pin`, `ALL PASSED`. Then `npx tsc --noEmit` with no output.
  If the route-cache assertion fails because of key formatting: `routeKey` renders coordinates with `toFixed(4)`, so `44.4486,-88.0604` is exact. Check `r4()` in `geo.ts` before changing the test.

- [ ] **Step 5: Commit.**
```bash
git add src/lib/venue-locate.ts scripts/test-geo-backfill.ts
git commit -m "feat(geo): unlocated-venue worklist query + one-venue locateVenue (retry/pick/pin) (#169)"
```

---

### Task 3: Server actions, plus runner failures that carry the venue id

**Files:**
- Modify: `src/app/(app)/settings/actions.ts` (the `geocodeBatchAction` geocode return, and new actions after it)

**Interfaces:**
- Consumes: Task 2's `listUnlocatedVenues`, `locateVenue`, `LocateInput`, `LocateResult`.
- Produces:
  ```ts
  export async function listUnlocatedVenuesAction(input?: { q?: string; offset?: number; limit?: number }):
    Promise<{ rows: UnlocatedVenue[]; total: number; noAddress: number }>;
  export type VenueAddressHit = { title: string; sub: string; street: string; city: string; state: string;
    zip: string; lat: number; lng: number };
  export async function searchVenueAddressAction(query: string): Promise<VenueAddressHit[]>;
  export async function locateVenueAction(input: LocateInput): Promise<LocateResult>;
  ```
  `geocodeBatchAction`'s geocode-phase `failures` items become `{ siteId: string; query: string; reason: string; got?: string }`, uncapped.

- [ ] **Step 1: Edit the geocode return.** In `geocodeBatchAction`, replace
  `failures: r.failures.slice(0, 25).map((f) => ({ query: f.query, reason: f.reason, got: f.got })),`
  with:
```ts
    // Every failing venue (with its id) — the Settings worklist shows the
    // reason beside the venue, so nothing here may be capped or anonymous.
    failures: r.failures.map((f) => ({ siteId: f.siteId, query: f.query, reason: f.reason, got: f.got })),
```

- [ ] **Step 2: Add the three actions** directly after `geocodeBatchAction`:
```ts
/* ---------------- Unlocated venues worklist (#169, D225) ---------------- */

export async function listUnlocatedVenuesAction(input?: { q?: string; offset?: number; limit?: number }) {
  await requirePerm("manage_users");
  const { listUnlocatedVenues } = await import("@/lib/venue-locate");
  return listUnlocatedVenues({
    q: typeof input?.q === "string" ? input.q : "",
    offset: Number(input?.offset) || 0,
    limit: Number(input?.limit) || 50,
  });
}

export type VenueAddressHit = {
  title: string;
  sub: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
};

/** Address type-ahead for the fix sidebar — like the Companies one, but keeps zip. */
export async function searchVenueAddressAction(query: string): Promise<VenueAddressHit[]> {
  await requirePerm("manage_users");
  const { search } = await import("@/lib/geo");
  const hits = await search(String(query || "").slice(0, 200), { limit: 6 });
  return hits.map((h) => ({
    title: h.title,
    sub: h.sub,
    street: h.street,
    city: h.city,
    state: h.state,
    zip: h.zip,
    lat: h.lat,
    lng: h.lng,
  }));
}

/** Locate ONE venue from the sidebar (retry / pick / pin), then route it. */
export async function locateVenueAction(input: import("@/lib/venue-locate").LocateInput) {
  await requirePerm("manage_users");
  const { locateVenue } = await import("@/lib/venue-locate");
  const r = await locateVenue(input);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
```

- [ ] **Step 3: Typecheck.** `npx tsc --noEmit`. Expected: an error in `settings-client.tsx` if it relies on the old failure shape; otherwise no output. Leave any `settings-client.tsx` error for Task 5, which replaces that code, but record it.

- [ ] **Step 4: Commit.**
```bash
git add "src/app/(app)/settings/actions.ts"
git commit -m "feat(settings): admin actions for the unlocated-venue worklist; batch failures carry siteId (#169)"
```

---

### Task 4: `LeafletMap` opt-in pick mode

**Files:**
- Modify: `src/components/map/LeafletMap.tsx`

**Interfaces:**
- Produces: two new optional props on the default export:
  `picked?: { lat: number; lng: number } | null`, `onPick?: (p: { lat: number; lng: number }) => void`.
  Callers must pass a memoized `pins` array and `center` tuple, or the main effect re-runs each render.

- [ ] **Step 1: Implement.** In `LeafletMap.tsx`:
  1. Extend the props destructure and type:
```ts
  picked,
  onPick,
}: {
  pins: MapPin[];
  height?: number;
  center?: [number, number];
  zoom?: number;
  /** Pick mode (#169): one draggable pin at `picked`; a map click or a pin
   *  drag reports the point through `onPick`. Absent => display-only, as
   *  every other map in the app uses it. */
  picked?: { lat: number; lng: number } | null;
  onPick?: (p: { lat: number; lng: number }) => void;
}) {
```
  2. Next to the other refs, add the block below. The refs are synced in an effect, not during render,
     because eslint-plugin-react-hooks 7's `refs` rule flags writes to `ref.current` during render.
     This effect must be declared **before** the existing main effect, so it runs first in every commit.
```ts
  const pickMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const onPickRef = useRef(onPick);
  const pickedRef = useRef(picked);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  useEffect(() => {
    onPickRef.current = onPick;
    pickedRef.current = picked;
  });
```
  3. Inside the main effect, right after `const L = (await import("leaflet")).default;`, add `leafletRef.current = L;`. Inside the `if (!mapRef.current) { … }` block, after `layerRef.current = …`, add:
```ts
        // Only reacts when a caller passed onPick; display maps ignore clicks.
        mapRef.current.on("click", (e) => {
          const cb = onPickRef.current;
          if (cb) cb({ lat: e.latlng.lat, lng: e.latlng.lng });
        });
```
     At the very end of the async IIFE, after the `setView`/`fitBounds` branch, add `syncPick();`.
  4. Add this stable callback inside the component, above the effects. It only reads refs, so `[]` deps are correct.
     Add `useCallback` to the `react` import, and add `syncPick` to the main effect's dependency array
     (`[pins, center, zoom, syncPick]`). It is stable, so this changes nothing for existing maps.
```ts
  /** Draw / move / remove the single pick-mode pin to match `picked`. */
  const syncPick = useCallback(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const p = pickedRef.current;
    if (!p || !onPickRef.current) {
      pickMarkerRef.current?.remove();
      pickMarkerRef.current = null;
      return;
    }
    if (pickMarkerRef.current) {
      pickMarkerRef.current.setLatLng([p.lat, p.lng]);
      return;
    }
    // A divIcon, not L.marker's default icon — the default needs image
    // assets the bundler does not ship.
    const icon = L.divIcon({
      className: "",
      html: '<div style="width:18px;height:18px;border-radius:50%;background:var(--accent);border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    const m = L.marker([p.lat, p.lng], { icon, draggable: true }).addTo(map);
    m.on("dragend", () => {
      const ll = m.getLatLng();
      onPickRef.current?.({ lat: ll.lat, lng: ll.lng });
    });
    pickMarkerRef.current = m;
  }, []);
```
  5. Add a new effect after the main one. It deliberately does NOT refit or re-centre, so the view doesn't jump while a pin is dragged:
```ts
  useEffect(() => {
    syncPick();
    if (elRef.current) elRef.current.style.cursor = onPick ? "crosshair" : "";
  }, [picked?.lat, picked?.lng, onPick, syncPick]);
```

- [ ] **Step 2: Typecheck and lint.** Run `npx tsc --noEmit` and `npx eslint src/components/map/LeafletMap.tsx`, and expect no errors. Existing maps are verified in the browser in Task 6.

- [ ] **Step 3: Commit.**
```bash
git add src/components/map/LeafletMap.tsx
git commit -m "feat(map): opt-in pick mode on LeafletMap — click or drag one pin (#169)"
```

---

### Task 5: Worklist + sidebar UI, wired into Settings → Admin

**Files:**
- Create: `src/app/(app)/settings/unlocated-venues.tsx`
- Create: `src/app/(app)/settings/venue-locate-drawer.tsx`
- Modify: `src/app/(app)/settings/settings-client.tsx` (imports ~line 13–36; state ~266–269; `runGeocode` ~415–446; the failure list render ~1696–1712)

**Interfaces:**
- Consumes: Task 3's actions and `VenueAddressHit`; Task 2's types (as `import type` only); Task 4's `LeafletMap` props.
- Produces:
  - `export default function UnlocatedVenues(props: { reasons: Record<string, string>; refreshKey: number; onChanged: () => void })`
  - `export function reasonLabel(reason: string, got?: string): string` (in `venue-locate-drawer.tsx`)
  - `export default function VenueLocateDrawer(props: { venue: UnlocatedVenue; reason?: string; hasNext: boolean; onNext: () => void; onClose: () => void; onLocated: (siteId: string) => void })`

- [ ] **Step 1: Create `unlocated-venues.tsx`:**
```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UnlocatedVenue } from "@/lib/venue-locate";
import { listUnlocatedVenuesAction } from "./actions";
import VenueLocateDrawer from "./venue-locate-drawer";

/**
 * Settings → Admin worklist of venues that can't be located (#169, D225).
 * A live query (see lib/venue-locate.ts), so it survives reloads and shrinks
 * as venues are fixed. Clicking a row opens the fix-it sidebar.
 */

const PAGE = 50;

export default function UnlocatedVenues({
  reasons,
  refreshKey,
  onChanged,
}: {
  reasons: Record<string, string>;
  refreshKey: number;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<UnlocatedVenue[]>([]);
  const [total, setTotal] = useState(0);
  const [noAddress, setNoAddress] = useState(0);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<{ venue: UnlocatedVenue; idx: number; located: boolean } | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (query: string, offset: number) => {
    const mine = ++seq.current;
    setLoading(true);
    setError("");
    try {
      const r = await listUnlocatedVenuesAction({ q: query, offset, limit: PAGE });
      if (mine !== seq.current) return;
      setRows((prev) => (offset ? [...prev, ...r.rows] : r.rows));
      setTotal(r.total);
      setNoAddress(r.noAddress);
    } catch (e) {
      if (mine === seq.current) setError(e instanceof Error ? e.message : "Could not load the list");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  // Initial load, after every batch run (refreshKey), and on search (debounced).
  useEffect(() => {
    const t = setTimeout(() => void load(q, 0), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, refreshKey, load]);

  function located(siteId: string) {
    setRows((prev) => prev.filter((r) => r.siteId !== siteId));
    setTotal((t) => Math.max(0, t - 1));
    setOpen((o) => (o && o.venue.siteId === siteId ? { ...o, located: true } : o));
    onChanged();
  }

  // After a fix the row is gone, so the next venue has slid into its index.
  const nextVenue = open ? rows[open.located ? open.idx : open.idx + 1] : undefined;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {total.toLocaleString()} venue{total === 1 ? "" : "s"} can’t be located
          <span style={{ fontWeight: 400, color: "#9aa0ab" }}>
            {" "}· {noAddress.toLocaleString()} have no address at all
          </span>
        </div>
        <input
          className="pk-input"
          style={{ marginLeft: "auto", width: 220, fontSize: 12.5 }}
          placeholder="Search company, venue, street, city"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {error && <div style={{ marginTop: 6, fontSize: 12, color: "#8a3a2a" }}>{error}</div>}
      {rows.length > 0 && (
        <div style={{ marginTop: 8, border: "1px solid #ececf0", borderRadius: 8, overflow: "hidden" }}>
          {rows.map((r, i) => {
            const why = reasons[r.siteId];
            return (
              <button
                key={r.siteId}
                type="button"
                onClick={() => setOpen({ venue: r, idx: i, located: false })}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1.4fr) minmax(0,1fr)",
                  gap: 10,
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 12px",
                  border: 0,
                  borderTop: i ? "1px solid #f3f4f7" : 0,
                  background: open?.venue.siteId === r.siteId ? "#f6f7fb" : "#fff",
                  cursor: "pointer",
                  fontSize: 12.5,
                  color: "#16181d",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <strong style={{ fontWeight: 600 }}>{r.companyName}</strong>
                  <span style={{ color: "#9aa0ab" }}> · {r.venueName || "Untitled venue"}</span>
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#5d636e" }}>
                  {[r.address, [r.city, [r.state, r.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#8a3a2a" }}>
                  {why || ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {rows.length < total && (
        <button
          type="button"
          className="pk-btn-quiet"
          style={{ marginTop: 6, fontSize: 12 }}
          disabled={loading}
          onClick={() => void load(q, rows.length)}
        >
          {loading ? "Loading…" : `Show more (${(total - rows.length).toLocaleString()} left)`}
        </button>
      )}
      {open && (
        <VenueLocateDrawer
          key={open.venue.siteId}
          venue={open.venue}
          reason={reasons[open.venue.siteId]}
          hasNext={!!nextVenue}
          onNext={() => {
            if (!nextVenue) return;
            setOpen({ venue: nextVenue, idx: rows.indexOf(nextVenue), located: false });
          }}
          onClose={() => setOpen(null)}
          onLocated={located}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `venue-locate-drawer.tsx`:**
```tsx
"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { LocateResult, UnlocatedVenue } from "@/lib/venue-locate";
import { locateVenueAction, searchVenueAddressAction, type VenueAddressHit } from "./actions";

const LeafletMap = dynamic(() => import("@/components/map/LeafletMap"), {
  ssr: false,
  loading: () => <div style={{ height: 260, background: "#f1f2f5", borderRadius: 10 }} />,
});

/** Human wording for a geocode failure — shared by the worklist and this sidebar. */
export function reasonLabel(reason: string, got?: string): string {
  if (reason === "no-hit") return "No match";
  if (reason === "state-mismatch") return `Resolved to ${got || "another state"} — wrong state`;
  if (reason === "city-mismatch") return `Resolved to ${got || "another town"} — wrong city`;
  if (reason === "gone") return "This venue was deleted";
  if (reason === "invalid") return "Coordinates out of range";
  return reason;
}

/** Wisconsin default when the stated town can't be resolved. */
const WI: [number, number] = [44.5, -89.5];

function fmtTravel(r: Extract<LocateResult, { ok: true }>): string {
  if (!r.officeName || r.source === "none" || r.miles == null)
    return "✓ Located. No quote origin set, so travel can't be computed.";
  const m = r.minutes ?? 0;
  const h = Math.floor(m / 60);
  const t = h ? `${h}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`;
  const how = r.source === "routed" ? "routed" : r.source === "manual" ? "manual" : "estimated";
  return `✓ Located · ${Math.round(r.miles).toLocaleString()} mi · ${t} from ${r.officeName} (${how})`;
}

/**
 * The fix-it sidebar (#169, D225): three ways to locate ONE venue — edit the
 * address and retry it through the batch's own gates, pick a search
 * suggestion, or drop a pin — each saved + routed immediately.
 */
export default function VenueLocateDrawer({
  venue,
  reason,
  hasNext,
  onNext,
  onClose,
  onLocated,
}: {
  venue: UnlocatedVenue;
  reason?: string;
  hasNext: boolean;
  onNext: () => void;
  onClose: () => void;
  onLocated: (siteId: string) => void;
}) {
  const [f, setF] = useState({ address: venue.address, city: venue.city, state: venue.state, zip: venue.zip });
  const [busy, setBusy] = useState<"" | "retry" | "pick" | "pin">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(
    reason ? { ok: false, text: reason } : null
  );
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<VenueAddressHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [centre, setCentre] = useState<{ c: [number, number]; z: number }>({ c: WI, z: 6 });
  const [done, setDone] = useState(false);
  const noPins = useMemo(() => [], []);

  // Escape closes.
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  // Centre the pin map on the stated town when it resolves.
  useEffect(() => {
    if (!venue.city) return;
    let live = true;
    void searchVenueAddressAction([venue.city, venue.state].filter(Boolean).join(", ")).then((h) => {
      if (live && h[0]) setCentre({ c: [h[0].lat, h[0].lng], z: 13 });
    });
    return () => {
      live = false;
    };
  }, [venue.city, venue.state]);

  // Debounced type-ahead. Short queries show nothing via `shown` below —
  // no synchronous setState in the effect (react-hooks/set-state-in-effect).
  const shown = query.trim().length >= 3 ? hits : [];
  useEffect(() => {
    if (query.trim().length < 3) return;
    let live = true;
    const t = setTimeout(async () => {
      setSearching(true);
      const h = await searchVenueAddressAction(query).catch(() => []);
      if (live) {
        setHits(h);
        setSearching(false);
      }
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  const mapCenter = useMemo<[number, number]>(() => centre.c, [centre]);

  async function run(mode: "retry" | "pick" | "pin", input: Parameters<typeof locateVenueAction>[0]) {
    setBusy(mode);
    setMsg(null);
    try {
      const r = await locateVenueAction(input);
      if (r.ok) {
        setMsg({ ok: true, text: fmtTravel(r) });
        setDone(true);
        onLocated(venue.siteId);
      } else {
        const hint = r.reason === "no-hit" ? " Try again, or drop a pin." : "";
        setMsg({ ok: false, text: reasonLabel(r.reason, r.got) + "." + hint });
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
      <input
        className="pk-input"
        style={{ width: "100%", fontSize: 13 }}
        value={f[k]}
        disabled={done}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
      />
    </label>
  );
  const h3 = { fontSize: 12, fontWeight: 600, letterSpacing: 0.3, color: "#5d636e", margin: "18px 0 6px" } as const;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, fontFamily: "var(--font-ui)", color: "#16181d" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(22,24,29,.28)" }} />
      <aside
        role="dialog"
        aria-label="Locate venue"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(420px, 100vw)",
          background: "#fff",
          boxShadow: "-8px 0 24px rgba(0,0,0,.12)",
          overflowY: "auto",
          padding: "16px 18px 28px",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <a
              href={`/companies/${encodeURIComponent(venue.companyId)}`}
              target="_blank"
              rel="noopener"
              style={{ fontSize: 15, fontWeight: 600, color: "inherit" }}
            >
              {venue.companyName}
            </a>
            <div style={{ fontSize: 12.5, color: "#9aa0ab" }}>{venue.venueName || "Untitled venue"}</div>
            <div style={{ fontSize: 12, color: "#5d636e", marginTop: 4 }}>
              {[venue.address, venue.city, [venue.state, venue.zip].filter(Boolean).join(" ")]
                .filter(Boolean)
                .join(", ") || "No address"}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="pk-btn-quiet"
            style={{ marginLeft: "auto", fontSize: 18, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {msg && (
          <div
            style={{
              marginTop: 12,
              padding: "8px 10px",
              borderRadius: 8,
              fontSize: 12.5,
              background: msg.ok ? "#eef7f0" : "#fbf0ee",
              color: msg.ok ? "#1f6b3a" : "#8a3a2a",
            }}
          >
            {msg.text}
          </div>
        )}
        {done && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {hasNext && (
              <button type="button" className="pk-btn" onClick={onNext}>
                Next venue →
              </button>
            )}
            <button type="button" className="pk-btn-quiet" onClick={onClose}>
              Close
            </button>
          </div>
        )}

        {!done && (
          <>
            <div style={h3}>EDIT + RETRY</div>
            {field("address", "Street", "1 1 100%")}
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              {field("city", "City", "2 1 0")}
              {field("state", "State", "0 0 64px")}
              {field("zip", "Zip", "0 0 84px")}
            </div>
            <button
              type="button"
              className="pk-btn"
              style={{ marginTop: 8 }}
              disabled={!!busy || !(f.address.trim() || f.city.trim())}
              onClick={() => void run("retry", { siteId: venue.siteId, mode: "retry", ...f })}
            >
              {busy === "retry" ? "Looking up…" : "Retry"}
            </button>

            <div style={h3}>SEARCH</div>
            <input
              className="pk-input"
              style={{ width: "100%", fontSize: 13 }}
              placeholder="Type an address or place name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {searching && <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 4 }}>Searching…</div>}
            {!searching && query.trim().length >= 3 && shown.length === 0 && (
              <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 4 }}>
                No matches — try a shorter query, or drop a pin.
              </div>
            )}
            {shown.map((h, i) => (
              <button
                key={i}
                type="button"
                disabled={!!busy}
                onClick={() =>
                  void run("pick", {
                    siteId: venue.siteId,
                    mode: "pick",
                    address: h.street,
                    city: h.city,
                    state: h.state,
                    zip: h.zip,
                    lat: h.lat,
                    lng: h.lng,
                  })
                }
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  marginTop: 4,
                  padding: "6px 8px",
                  border: "1px solid #ececf0",
                  borderRadius: 6,
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{h.title}</div>
                <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>{h.sub}</div>
              </button>
            ))}

            <div style={h3}>DROP A PIN</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginBottom: 6 }}>
              Click the building on the map; drag the pin to adjust.
            </div>
            <LeafletMap
              pins={noPins}
              height={260}
              center={mapCenter}
              zoom={centre.z}
              picked={pin}
              onPick={setPin}
            />
            <button
              type="button"
              className="pk-btn"
              style={{ marginTop: 8 }}
              disabled={!pin || !!busy}
              onClick={() => pin && void run("pin", { siteId: venue.siteId, mode: "pin", ...pin })}
            >
              {busy === "pin" ? "Saving…" : "Save location"}
            </button>
          </>
        )}
      </aside>
    </div>
  );
}
```

- [ ] **Step 3: Wire it into `settings-client.tsx`.**
  1. Add `import UnlocatedVenues from "./unlocated-venues";` and `import { reasonLabel } from "./venue-locate-drawer";` after the `./actions` import block.
  2. Replace the state line
     `const [geoFails, setGeoFails] = useState<Array<{ query: string; reason: string; got?: string }>>([]);`
     with:
```ts
  // Why each venue failed in THIS page's run, keyed by site id — read by the
  // unlocated-venues worklist. Not persisted (spec §5).
  const [geoReasons, setGeoReasons] = useState<Record<string, string>>({});
  const [geoListKey, setGeoListKey] = useState(0);
```
  3. In `runGeocode`, replace `setGeoFails([]);` with `setGeoReasons({});`, and replace
```ts
          if (phase === "geocode" && "failures" in r && r.failures?.length) {
            setGeoFails((prev) => [...prev, ...r.failures].slice(0, 50));
          }
```
     with:
```ts
          if (phase === "geocode" && "failures" in r && r.failures?.length) {
            const add: Record<string, string> = {};
            for (const f of r.failures) add[f.siteId] = reasonLabel(f.reason, f.got);
            setGeoReasons((prev) => ({ ...prev, ...add }));
          }
```
     Also, directly after `await refreshGeoCoverage();` (the one following `setGeoMsg("Done.")`), add `setGeoListKey((k) => k + 1);`.
  4. Replace the whole `{geoFails.length > 0 && ( … )}` block (the "could not be resolved safely" list) with:
```tsx
            <UnlocatedVenues
              reasons={geoReasons}
              refreshKey={geoListKey}
              onChanged={() => void refreshGeoCoverage()}
            />
```

- [ ] **Step 4: Typecheck and lint.** `rm -rf .next && npx tsc --noEmit` and expect no output. Then `npx eslint "src/app/(app)/settings" src/components/map src/lib/venue-locate.ts src/lib/geo-backfill.ts` and expect 0 errors, with no new warnings compared to the same files on `origin/main`.

- [ ] **Step 5: Commit.**
```bash
git add "src/app/(app)/settings/unlocated-venues.tsx" "src/app/(app)/settings/venue-locate-drawer.tsx" "src/app/(app)/settings/settings-client.tsx"
git commit -m "feat(settings): unlocated-venues worklist + fix-it sidebar (retry / search / pin) (#169)"
```

---

### Task 6: Browser verification, gates, PUNCHLIST + DECISIONS

**Files:**
- Modify: `PUNCHLIST.md` (append #169), `DECISIONS.md` (append D225)

- [ ] **Step 1: Seed the unlocated case in the worktree's OWN dev DB.** The worktree's `.data` is its own, never the main checkout's. Start the dev server through `preview_start` with a temporary `.claude/launch.json` entry in the main checkout, and restore that file afterwards. The launch entry must `cd` to the worktree and run `npm run dev` with `autoPort: true`. In the Settings → Admin section, confirm the list renders. The demo seed may have no unlocated venues. If so, edit a demo venue in Companies and clear its coordinates by removing and retyping the address without picking a suggestion, then reload Settings.
- [ ] **Step 2: Exercise every path in the browser:**
  - a row opens the sidebar; Escape closes it; the backdrop click closes it;
  - Retry with a corrected spelling locates the venue, shows a `✓ Located · … (routed|estimated)` line, and the row disappears;
  - Search, then picking a suggestion, locates the next venue;
  - on a third venue, clicking the map drops a pin, dragging moves it, and Save location locates it;
  - **Next venue →** opens the following row;
  - at phone width (375), the sidebar is full-width;
  - **regression check:** `/companies?view=map` still renders pins and fits bounds, and clicking the map does nothing.
  Take a screenshot of the open sidebar as proof.
- [ ] **Step 3: `preview_stop`**, then confirm no dev server remains for this worktree (`ps aux | grep peak-app-worktree-geo-fix`). Restore `.claude/launch.json` in the main checkout with `git checkout .claude/launch.json`.
- [ ] **Step 4: Run the four gates plus the geo test, and record real numbers:**
  `rm -rf .next && npx tsc --noEmit` → 0 errors; `npm run -s test:geo-backfill` → ALL PASSED; `npm run -s test:specs` → PASS/FAIL counts; `npm run -s test:smoke` → ALL PASSED; `npx eslint` → problems/errors, compared with the origin/main baseline of 124 problems / 0 errors.
- [ ] **Step 5: Append PUNCHLIST #169 and DECISIONS D225.** Use the same shape as #166/D222: reported, what shipped, tests, gates with real numbers, anything open. D225 records the decisions from spec §2 and §3.3: worklist is a live query; no town-centre fix; a human pick or pin bypasses the gates; the sidebar never writes manual travel overrides; reasons aren't persisted.
- [ ] **Step 6: Commit.**
```bash
git add PUNCHLIST.md DECISIONS.md
git commit -m "docs: punch #169 and D225 — unlocated-venues worklist + fix-it sidebar"
```
- [ ] **Step 7: Do NOT push.** Report to Jeff and wait for him to confirm his production geocode run has finished.
