# Drive Distance + Calendar "Traveling from" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a sortable drive-from-the-quote-origin column on `/venues` and `/companies`, and let a new calendar appointment say where the person is traveling from (a saved location or any typed address).

**Architecture:** One bulk server helper, `travelForPoints()`, computes travel for any list of places in three DB round trips. Two pure client-safe helpers format a cell and sort by it. Both directory pages call the bulk helper and add a `?sort=` control. On the calendar side, a pure-ish `resolveTravelOrigin()` picks the origin (typed address → saved office → the person's base). A new options action feeds a "Traveling from" select in the create form, and `addTravelBlock` routes from the chosen origin with a live OSRM call.

**Tech Stack:** Next.js 16 App Router (server components + server actions), Drizzle/PGlite, TypeScript, tsx scenario tests.

**Spec:** `docs/superpowers/specs/2026-09-24-drive-distance-design.md`

## Global Constraints

- Worktree: `/Users/sm/Downloads/peak-app-worktree-geo-fix`, branch `feat/drive-distance` (stacked on `feat/geo-fix-sidebar`). Never touch `/Users/sm/Downloads/peak-app` or its `.data`.
- Prefix commands with `export PATH=$HOME/.local/node/bin:$PATH`.
- Travel is measured from the **quote origin** (`quoteOrigin(offices)`), resolving coordinates with `coordsOf()`. It uses the manual > routed > auto > none chain via `estimateFromParts()`. Do not invent a new rule.
- Cell text: routed `62 mi · 1h 8m`; auto `~62 mi · 1h 8m`; manual `62 mi · 1h 8m`; none `—`. Time format: `1h 8m`, `45m`, `2h`.
- Sort param: `?sort=near|far`, sorted by minutes then miles. `none` always sorts last. Ties sort by name.
- Client components must not import `@/lib/geo`, `@/lib/geo-backfill`, `@/lib/travel-bulk`, `@/lib/travel-origin` or `@/db` at runtime (`import type` is fine). `src/lib/drive-format.ts` must import nothing server-side.
- Button classes: `pk-btn-accent` (primary) and `pk-btn-outline` (secondary). **`pk-btn` and `pk-btn-quiet` do not exist.**
- No hardcoded accent colours: use `var(--accent)`.
- eslint-plugin-react-hooks 7.x: no synchronous setState in an effect body, no ref writes during render. The repo is at 0 eslint errors.
- Punch #176, decision D229. **Do not push.**
- Commit with `git -c user.name="SM" commit`, ending the message with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Pure formatting/sort helpers + bulk travel helper

**Files:**
- Create: `src/lib/drive-format.ts`, `src/lib/travel-bulk.ts`, `scripts/test-drive-distance.ts`
- Modify: `package.json` (add a script after `test:geo-backfill`)

**Interfaces:**
- Produces:
  ```ts
  // src/lib/drive-format.ts  (client-safe, no imports)
  export type DriveSource = "manual" | "routed" | "auto" | "none";
  export type Drive = { miles: number | null; minutes: number | null; source: DriveSource };
  export function fmtDrive(d: Drive | null | undefined): string;
  export function driveTitle(d: Drive | null | undefined): string;
  export type DriveSort = "near" | "far";
  export function parseDriveSort(v: string | null | undefined): DriveSort | "";
  export function compareDrive(a: Drive | null | undefined, b: Drive | null | undefined, dir: DriveSort): number; // 0 on tie
  // src/lib/travel-bulk.ts  (server)
  export type TravelPoint = { id: string; lat?: number | string | null; lng?: number | string | null;
    city?: string | null; state?: string | null; travelMiles?: number | string | null; travelMin?: number | string | null };
  export async function travelForPoints(points: TravelPoint[]):
    Promise<{ originName: string | null; byId: Map<string, Drive> }>;
  ```

- [ ] **Step 1: Write the failing test.** Create `scripts/test-drive-distance.ts`:

```ts
/**
 * Drive distance (#176) — scenario on a SCRATCH PGlite, fetch stubbed.
 * Run only via `npm run test:drive-distance`. Never point at .data/pglite.
 */
import assert from "node:assert/strict";
import { getDb } from "@/db";
import { seedIfEmpty } from "@/db/seed-data";
import { geoCache } from "@/db/schema";
import { setSettings } from "@/lib/settings";
import { routeKey } from "@/lib/geo";
import { compareDrive, driveTitle, fmtDrive, parseDriveSort, type Drive } from "@/lib/drive-format";
import { travelForPoints } from "@/lib/travel-bulk";

globalThis.fetch = (async () => new Response("[]", { status: 200 })) as typeof fetch;

async function main() {
  if (!process.env.PGLITE_PATH) throw new Error("Refusing to run without PGLITE_PATH (scratch db).");
  const db = await getDb();
  await seedIfEmpty(db);

  /* ---- fmtDrive / driveTitle ---- */
  assert.equal(fmtDrive({ miles: 62, minutes: 68, source: "routed" }), "62 mi · 1h 8m");
  assert.equal(fmtDrive({ miles: 62, minutes: 68, source: "auto" }), "~62 mi · 1h 8m");
  assert.equal(fmtDrive({ miles: 40, minutes: 45, source: "manual" }), "40 mi · 45m");
  assert.equal(fmtDrive({ miles: 120, minutes: 120, source: "routed" }), "120 mi · 2h");
  assert.equal(fmtDrive({ miles: null, minutes: null, source: "none" }), "—");
  assert.equal(fmtDrive(null), "—");
  assert.equal(fmtDrive({ miles: 1300, minutes: 1200, source: "routed" }), "1,300 mi · 20h");
  assert.match(driveTitle({ miles: 1, minutes: 1, source: "auto" }), /Estimated/);
  assert.match(driveTitle({ miles: 1, minutes: 1, source: "manual" }), /Manual/);
  assert.match(driveTitle(null), /Not located/);
  console.log("PASS drive: fmtDrive + driveTitle");

  /* ---- parseDriveSort / compareDrive ---- */
  assert.equal(parseDriveSort("near"), "near");
  assert.equal(parseDriveSort("far"), "far");
  assert.equal(parseDriveSort("x"), "");
  assert.equal(parseDriveSort(undefined), "");
  const A: Drive = { miles: 10, minutes: 15, source: "routed" };
  const B: Drive = { miles: 50, minutes: 60, source: "auto" };
  const N: Drive = { miles: null, minutes: null, source: "none" };
  const list = [N, B, A, null];
  assert.deepEqual([...list].sort((x, y) => compareDrive(x, y, "near")).slice(0, 2), [A, B]);
  assert.deepEqual([...list].sort((x, y) => compareDrive(x, y, "far")).slice(0, 2), [B, A]);
  for (const dir of ["near", "far"] as const) {
    const s = [...list].sort((x, y) => compareDrive(x, y, dir));
    assert.ok(s.slice(2).every((d) => !d || d.source === "none"), `unlocated last (${dir})`);
  }
  assert.equal(compareDrive({ miles: 9, minutes: 15, source: "routed" }, A, "near") < 0, true, "tie on minutes → miles");
  assert.equal(compareDrive(A, { ...A }, "near"), 0, "full tie → 0 so the caller can break by name");
  console.log("PASS drive: parseDriveSort + compareDrive");

  /* ---- travelForPoints ---- */
  await setSettings({ offices: [] } as never);
  const none = await travelForPoints([{ id: "p1", lat: 43, lng: -89 }]);
  assert.equal(none.originName, null);
  assert.equal(none.byId.get("p1")?.source, "none", "no origin → none");

  const madison = { id: "o-mad", name: "Madison Office", street: "", city: "Madison", state: "WI", zip: "", lat: 43.0731, lng: -89.4012, quoteDefault: true };
  const milw = { id: "o-mil", name: "Milwaukee Remote", street: "", city: "Milwaukee", state: "WI", zip: "", lat: 43.0389, lng: -87.9065 };
  await setSettings({ offices: [milw, madison] } as never);
  // A cached real route for point "routed" only.
  const routedTarget = { lat: 43.5, lng: -89.0 };
  await db.delete(geoCache);
  await db.insert(geoCache).values({
    key: routeKey(madison, routedTarget),
    data: { miles: 38, minutes: 44, ts: Date.now() },
    updatedAt: Date.now(),
  });
  const r = await travelForPoints([
    { id: "routed", ...routedTarget },
    { id: "dup", ...routedTarget },
    { id: "auto", lat: 44.0, lng: -89.5 },
    { id: "manual", lat: 44.0, lng: -89.5, travelMiles: 12, travelMin: 20 },
    { id: "city-table", city: "Green Bay", state: "WI" },
    { id: "nowhere", city: "Nowhereville", state: "WI" },
  ]);
  assert.equal(r.originName, "Madison Office", "the quote origin, not the first-listed office");
  assert.deepEqual(r.byId.get("routed"), { miles: 38, minutes: 44, source: "routed" });
  assert.deepEqual(r.byId.get("dup"), { miles: 38, minutes: 44, source: "routed" }, "shared key reused");
  assert.equal(r.byId.get("auto")?.source, "auto");
  assert.ok((r.byId.get("auto")?.miles ?? 0) > 0);
  assert.deepEqual(r.byId.get("manual"), { miles: 12, minutes: 20, source: "manual" });
  assert.equal(r.byId.get("city-table")?.source, "auto", "19-city fallback via coordsOf, same as elsewhere");
  assert.equal(r.byId.get("nowhere")?.source, "none");
  assert.equal((await travelForPoints([])).byId.size, 0);
  console.log("PASS drive: travelForPoints");

  console.log("ALL PASSED");
}

main().then(() => process.exit(0), (e) => { console.error("FAIL", e); process.exit(1); });
```

  Add to `package.json` after the `test:geo-backfill` line:
  `"test:drive-distance": "TEST_DB=$(mktemp -d) && PGLITE_PATH=\"$TEST_DB\" tsx scripts/test-drive-distance.ts",`
  Use a line edit: the file has duplicate keys, so a JSON rewrite would drop two `davinci:*` scripts.

- [ ] **Step 2: Run it and confirm it fails.** `npm run -s test:drive-distance` → cannot resolve `@/lib/drive-format`.

- [ ] **Step 3: Implement.** Create `src/lib/drive-format.ts`:

```ts
/**
 * Drive-distance cell formatting + sorting (#176, D229). Pure and
 * client-safe — imports nothing — so server pages and client components can
 * both use it. The numbers come from lib/travel-bulk.ts.
 */
export type DriveSource = "manual" | "routed" | "auto" | "none";
export type Drive = { miles: number | null; minutes: number | null; source: DriveSource };
export type DriveSort = "near" | "far";

function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h <= 0) return m + "m";
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "62 mi · 1h 8m"; "~" prefix when it is a straight-line estimate; "—" when unlocated. */
export function fmtDrive(d: Drive | null | undefined): string {
  if (!d || d.source === "none" || d.miles == null) return "—";
  const mi = Math.round(d.miles).toLocaleString("en-US") + " mi";
  const t = d.minutes == null ? "" : " · " + fmtMinutes(d.minutes);
  return (d.source === "auto" ? "~" : "") + mi + t;
}

/** Hover text explaining where a cell's number came from. */
export function driveTitle(d: Drive | null | undefined): string {
  if (!d || d.source === "none" || d.miles == null)
    return "Not located — fix it in Settings → Admin";
  if (d.source === "auto") return "Estimated — run Geocode addresses to fetch the real route";
  if (d.source === "manual") return "Manual travel override";
  return "Driving route";
}

export function parseDriveSort(v: string | null | undefined): DriveSort | "" {
  return v === "near" || v === "far" ? v : "";
}

/**
 * Order two drives nearest- or farthest-first by minutes, then miles.
 * Unlocated ("none"/null) always sorts LAST in both directions. Returns 0 on
 * a full tie so the caller can break it by name.
 */
export function compareDrive(
  a: Drive | null | undefined,
  b: Drive | null | undefined,
  dir: DriveSort
): number {
  const has = (d: Drive | null | undefined): d is Drive =>
    !!d && d.source !== "none" && d.miles != null;
  if (!has(a) && !has(b)) return 0;
  if (!has(a)) return 1;
  if (!has(b)) return -1;
  const sign = dir === "far" ? -1 : 1;
  const am = a.minutes ?? Infinity;
  const bm = b.minutes ?? Infinity;
  if (am !== bm) return sign * (am - bm);
  if (a.miles !== b.miles) return sign * ((a.miles as number) - (b.miles as number));
  return 0;
}
```

  Create `src/lib/travel-bulk.ts`:

```ts
/**
 * Travel for MANY places in a fixed number of queries (#176, D229) — the
 * punch-#90 travelForCustomerVenues pattern generalised to any list, so the
 * Venues and Companies directories can show a drive column for ~1,500 rows
 * without a query per row: offices + travel rates once, one routeCachedBulk
 * for every distinct origin→place key, then estimateFromParts per place.
 *
 * Measured from the QUOTE ORIGIN (Settings → Locations), with coordinates
 * resolved by coordsOf() — the same rules every other travel number in the
 * app uses. Reads only the route cache; it never calls OSRM.
 */
import {
  coordsOf,
  estimateFromParts,
  hasCoords,
  officesFromSettings,
  quoteOrigin,
  routeCachedBulk,
  routeKey,
} from "@/lib/geo";
import { getTravelRates } from "@/lib/stores/pricing";
import type { Drive } from "@/lib/drive-format";

export type TravelPoint = {
  id: string;
  lat?: number | string | null;
  lng?: number | string | null;
  city?: string | null;
  state?: string | null;
  travelMiles?: number | string | null;
  travelMin?: number | string | null;
};

export async function travelForPoints(
  points: TravelPoint[]
): Promise<{ originName: string | null; byId: Map<string, Drive> }> {
  const byId = new Map<string, Drive>();
  if (!points.length) return { originName: null, byId };
  const [offices, rates] = await Promise.all([officesFromSettings(), getTravelRates()]);
  const origin = quoteOrigin(offices);
  const office = origin && hasCoords(origin) ? origin : null;

  const targets = points.map((p) => {
    const c = coordsOf(p);
    return { id: p.id, target: c ? { ...p, lat: c.lat, lng: c.lng } : p };
  });
  const keyOf = (t: TravelPoint) => (office && hasCoords(t) ? routeKey(office, t) : null);
  const keys = Array.from(
    new Set(targets.map((t) => keyOf(t.target)).filter((k): k is string => k != null))
  );
  const cache = await routeCachedBulk(keys);

  for (const t of targets) {
    const k = keyOf(t.target);
    const est = estimateFromParts(office, t.target, rates, k ? cache.get(k) ?? null : null);
    byId.set(t.id, { miles: est.miles, minutes: est.minutes, source: est.source });
  }
  return { originName: office ? office.name || "the quote origin" : null, byId };
}
```

- [ ] **Step 4: Run the tests and confirm they pass.** `npm run -s test:drive-distance` → four PASS lines and ALL PASSED. Then `npx tsc --noEmit` (expect no output) and `npx eslint src/lib/drive-format.ts src/lib/travel-bulk.ts scripts/test-drive-distance.ts` (expect 0 problems).
  - If `estimateFromParts`' manual branch returns `minutes: 20` for `travelMin: 20`, the test holds.
  - If the "auto" case unexpectedly reads `none` because `hasCoords` on string or number lat fails, check `hasCoords` in `geo.ts` and report it. Do not weaken the test.

- [ ] **Step 5: Commit.** `feat(geo): travelForPoints bulk travel + pure drive formatting/sort (#176)`

---

### Task 2: Calendar origin resolution (pure) + options action + travel block

**Files:**
- Create: `src/lib/travel-origin.ts`
- Modify: `src/app/(app)/calendar-actions.ts` (`EventFormInput`, `addTravelBlock`, `addCalendarEventAction`; add `travelOriginOptionsAction`)
- Test: `scripts/test-drive-distance.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/lib/travel-origin.ts
  export type TravelFrom = { officeId?: string; address?: string };
  export type OriginPoint = { name: string; lat: number; lng: number };
  export type OriginOffice = { id: string; name: string; lat: number | null; lng: number | null; quoteDefault?: boolean };
  export async function resolveTravelOrigin(
    from: TravelFrom | null | undefined,
    ctx: { offices: OriginOffice[]; baseOfficeId?: string | null;
           search: (q: string) => Promise<Array<{ lat: number; lng: number }>> }
  ): Promise<{ origin: OriginPoint | null; note?: string }>;
  export function baseOffice(offices: OriginOffice[], baseOfficeId?: string | null): OriginOffice | null;
  // calendar-actions.ts
  export type EventFormInput = { …existing…; travelFrom?: TravelFrom };
  export async function travelOriginOptionsAction():
    Promise<{ base: { id: string; name: string } | null; offices: Array<{ id: string; name: string }> }>;
  ```

- [ ] **Step 1: Write the failing test.** In `scripts/test-drive-distance.ts`, add `import { baseOffice, resolveTravelOrigin } from "@/lib/travel-origin";`, and append before `console.log("ALL PASSED")`:

```ts
  /* ---- resolveTravelOrigin ---- */
  {
    const offs = [
      { id: "o-mil", name: "Milwaukee Remote", lat: 43.0389, lng: -87.9065 },
      { id: "o-mad", name: "Madison Office", lat: 43.0731, lng: -89.4012, quoteDefault: true },
      { id: "o-nocoords", name: "Pop-up", lat: null, lng: null },
    ];
    const hit = async (q: string) => (q.includes("Baraboo") ? [{ lat: 43.47, lng: -89.74 }] : []);
    assert.equal(baseOffice(offs, null)?.id, "o-mad", "no based-out-of → quote origin");
    assert.equal(baseOffice(offs, "o-mil")?.id, "o-mil", "based-out-of wins");
    assert.equal(baseOffice(offs, "o-gone")?.id, "o-mad", "unknown based-out-of → quote origin");

    const typed = await resolveTravelOrigin({ address: "  123 Oak St, Baraboo, WI " }, { offices: offs, search: hit });
    assert.deepEqual(typed, { origin: { name: "123 Oak St, Baraboo, WI", lat: 43.47, lng: -89.74 } });

    const miss = await resolveTravelOrigin({ address: "Nowhere Rd" }, { offices: offs, baseOfficeId: "o-mil", search: hit });
    assert.equal(miss.origin?.name, "Milwaukee Remote");
    assert.equal(miss.note, "Couldn’t find “Nowhere Rd”, so this is measured from Milwaukee Remote.");

    const office = await resolveTravelOrigin({ officeId: "o-mil" }, { offices: offs, search: hit });
    assert.equal(office.origin?.name, "Milwaukee Remote");
    const noCoords = await resolveTravelOrigin({ officeId: "o-nocoords" }, { offices: offs, search: hit });
    assert.equal(noCoords.origin?.name, "Madison Office", "office without coords → base");
    const blank = await resolveTravelOrigin({ address: "   " }, { offices: offs, search: hit });
    assert.equal(blank.origin?.name, "Madison Office");
    assert.equal(blank.note, undefined);
    assert.deepEqual(await resolveTravelOrigin(undefined, { offices: [], search: hit }), { origin: null });
    console.log("PASS drive: resolveTravelOrigin");
  }
```

- [ ] **Step 2: Run it and confirm it fails.** Cannot resolve `@/lib/travel-origin`.

- [ ] **Step 3: Implement `src/lib/travel-origin.ts`:**

```ts
/**
 * Where a calendar appointment's auto travel block starts from (#176, D229).
 * Order: a typed address (geocoded) → a chosen saved location → the person's
 * base ("Based out of", else the quote origin). A typed address that can't
 * be found falls back to the base WITH a note, so the block still appears
 * and says honestly what it measured from. `search` is injected so this is
 * testable without the network.
 */
export type TravelFrom = { officeId?: string; address?: string };
export type OriginPoint = { name: string; lat: number; lng: number };
export type OriginOffice = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  quoteDefault?: boolean;
};

const located = (o: OriginOffice | null | undefined): o is OriginOffice & { lat: number; lng: number } =>
  !!o && o.lat != null && o.lng != null && Number.isFinite(Number(o.lat)) && Number.isFinite(Number(o.lng));

const point = (o: OriginOffice & { lat: number; lng: number }): OriginPoint => ({
  name: o.name || "your base office",
  lat: Number(o.lat),
  lng: Number(o.lng),
});

/** The person's base: their "Based out of" office, else the quote origin (flagged, else first). */
export function baseOffice(offices: OriginOffice[], baseOfficeId?: string | null): OriginOffice | null {
  const mine = baseOfficeId ? offices.find((o) => o.id === baseOfficeId) : undefined;
  return mine || offices.find((o) => o.quoteDefault) || offices[0] || null;
}

export async function resolveTravelOrigin(
  from: TravelFrom | null | undefined,
  ctx: {
    offices: OriginOffice[];
    baseOfficeId?: string | null;
    search: (q: string) => Promise<Array<{ lat: number; lng: number }>>;
  }
): Promise<{ origin: OriginPoint | null; note?: string }> {
  const base = baseOffice(ctx.offices, ctx.baseOfficeId);
  const fallback = located(base) ? point(base) : null;

  const typed = (from?.address || "").trim().slice(0, 200);
  if (typed) {
    const [hit] = await ctx.search(typed).catch(() => []);
    if (hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lng))
      return { origin: { name: typed, lat: hit.lat, lng: hit.lng } };
    return fallback
      ? { origin: fallback, note: `Couldn’t find “${typed}”, so this is measured from ${fallback.name}.` }
      : { origin: null };
  }
  if (from?.officeId) {
    const chosen = ctx.offices.find((o) => o.id === from.officeId);
    if (located(chosen)) return { origin: point(chosen) };
  }
  return { origin: fallback };
}
```

- [ ] **Step 4: Run the tests and confirm they pass.** `npm run -s test:drive-distance` → the new PASS line and ALL PASSED.

- [ ] **Step 5: Wire it into `src/app/(app)/calendar-actions.ts`.**
  1. Add `import type { TravelFrom } from "@/lib/travel-origin";` at the top, and add `travelFrom?: TravelFrom;` to `EventFormInput`, with a comment `/** #176 — where the auto travel block starts from (create only). */`.
  2. Change `addTravelBlock`'s signature to add a final parameter `travelFrom?: TravelFrom`. Replace its body's origin logic, the whole section from `const settings = await getSettings();` through `const est = await estimate([office], { lat: hit.lat, lng: hit.lng });`, with:
```ts
    const [{ resolveTravelOrigin }, { route }] = await Promise.all([
      import("@/lib/travel-origin"),
      import("@/lib/geo"),
    ]);
    const settings = await getSettings();
    const offices = settings.offices || [];
    const me = await getUser(userId);
    const { origin, note } = await resolveTravelOrigin(travelFrom, {
      offices,
      baseOfficeId: me?.officeId,
      search: (q) => search(q, { limit: 1 }),
    });
    if (!origin) return; // no office configured anywhere and nothing typed — nothing to estimate from

    // The location is free text, not lat/lng, so it needs geocoding first.
    const hits = await search(location, { limit: 1 });
    const hit = hits[0];
    if (!hit) return;

    // #176: a real route (OSRM, cached) rather than only reading the cache —
    // a typed origin has never been routed from before. Falls back to the
    // straight-line estimate when OSRM is unavailable.
    const target = { lat: hit.lat, lng: hit.lng };
    const live = await route(origin, target);
    const est = live
      ? { minutes: live.minutes }
      : await estimate([{ ...origin, quoteDefault: true }], target);
```
     Keep the existing six-hour sanity cap line unchanged. Then change the description to:
```ts
      description:
        "Auto-added travel time — safe to delete or edit. Estimated " +
        est.minutes +
        " min from " +
        origin.name +
        "." +
        (note ? " " + note : ""),
```
     Remove the now-unused `quoteOrigin` from the destructured `@/lib/geo` import there, if it is unused. Keep `search` and `estimate`.
  3. In `addCalendarEventAction`, pass `input.travelFrom` as the new last argument to `addTravelBlock(...)`. Sanitize it first: `const travelFrom = input.travelFrom && typeof input.travelFrom === "object" ? { officeId: typeof input.travelFrom.officeId === "string" ? input.travelFrom.officeId.slice(0, 80) : undefined, address: typeof input.travelFrom.address === "string" ? input.travelFrom.address.slice(0, 200) : undefined } : undefined;`
  4. Add the options action, next to `addCalendarEventAction`:
```ts
/** #176 — the "Traveling from" choices for the New event form. */
export async function travelOriginOptionsAction(): Promise<{
  base: { id: string; name: string } | null;
  offices: Array<{ id: string; name: string }>;
}> {
  const me = await requireUser();
  const [{ getSettings }, { getUser }, { baseOffice }] = await Promise.all([
    import("@/lib/settings"),
    import("@/lib/users"),
    import("@/lib/travel-origin"),
  ]);
  const offices = (await getSettings()).offices || [];
  const user = await getUser(me.id);
  const base = baseOffice(offices, user?.officeId);
  return {
    base: base ? { id: base.id, name: base.name } : null,
    offices: offices.map((o) => ({ id: o.id, name: o.name })),
  };
}
```
     Check how `getSettings`, `getUser` and `search` are imported in this file today (static or dynamic), and follow the file's existing pattern. `requireUser` is already imported (it is used by `requireCalendarGrant`).

- [ ] **Step 6: Typecheck and lint, then commit.** Run `npx tsc --noEmit` and `npx eslint "src/app/(app)/calendar-actions.ts" src/lib/travel-origin.ts scripts/test-drive-distance.ts`, both clean. Commit: `feat(calendar): travel block starts from a chosen location or typed address (#176)`

---

### Task 3: `/venues` Drive column + sort

**Files:** Modify `src/app/(app)/venues/page.tsx`

**Interfaces:** Consumes `travelForPoints`, `fmtDrive`, `driveTitle`, `compareDrive` and `parseDriveSort` from Task 1.

- [ ] **Step 1: Implement.**
  1. Imports: `import { travelForPoints } from "@/lib/travel-bulk";` and `import { compareDrive, driveTitle, fmtDrive, parseDriveSort } from "@/lib/drive-format";`.
  2. After the `rows` load, compute travel for every row (all rows, not just the visible page, so sorting is correct across the whole set):
     `const travel = await travelForPoints(rows.map((r) => ({ id: r.site.id, lat: r.site.lat, lng: r.site.lng, city: r.site.city, state: r.site.state, travelMiles: r.site.travelMiles, travelMin: r.site.travelMin })));`
  3. `const sort = parseDriveSort(one(sp.sort));`. Replace the sort block so that when `sort` is set it sorts by `compareDrive(travel.byId.get(a.site.id), travel.byId.get(b.site.id), sort) || a.site.name.localeCompare(b.site.name)`. Otherwise keep the existing recent-activity comparator exactly.
  4. Make `linkWith` accept and preserve `sort`: extend the patch type to `{ company?: string; sort?: string }`, and set `p.set("sort", …)` when non-empty. Also add `<input type="hidden" name="sort" value={sort} />` inside the GET `<form>` when `sort` is set, so a search keeps the sort.
  5. Under the result label, add a sort row of three links (`Recent activity` → `linkWith({ sort: "" })`, `Nearest first` → `near`, `Farthest first` → `far`), styled like small pills. The active one gets `border: 1px solid var(--accent)` and bold weight; inactive ones get `#e4e7ec`. Append ` · Drive from ${travel.originName}` to the result label text when `travel.originName`, else ` · Set a quote origin in Settings → Locations to see drive times`.
  6. In each row, add a Drive cell after the city/state span:
     `<span className="ve-row-drive" title={driveTitle(d)} style={{ width: 118, flexShrink: 0, textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11.5, color: d && d.source !== "none" ? "#3a3f4a" : "#b0b5bf", whiteSpace: "nowrap" }}>{fmtDrive(d)}</span>`
     where `const d = travel.byId.get(row.site.id);`. In the page's `CSS` string, inside the existing `@media (max-width: 720px)`, hide the city column instead of the drive column on phones: give the city span `className="ve-row-city"` and add `.ve-row-city { display: none !important; }`.
- [ ] **Step 2: Check.** Run `rm -rf .next && npx tsc --noEmit` and `npx eslint "src/app/(app)/venues"`, both clean. Commit: `feat(venues): drive-from-origin column + nearest/farthest sort (#176)`

---

### Task 4: `/companies` Drive column + sort

**Files:** Modify `src/app/(app)/companies/page.tsx` and `src/app/(app)/companies/controls.tsx` (`FilterBar`)

- [ ] **Step 1: Implement.**
  1. In `page.tsx`, import `travelForPoints`, `primaryLoc` (from `@/lib/stores/customers`, alongside `allCustomers`), and `compareDrive`, `driveTitle`, `fmtDrive`, `parseDriveSort`.
  2. Compute the travel after the `customers` load:
     `const travel = await travelForPoints(customers.map((c) => { const l = primaryLoc(c.locations); return { id: c.id, lat: l?.lat, lng: l?.lng, city: l?.city, state: l?.state, travelMiles: l?.travelMiles, travelMin: l?.travelMin }; }));`
     A company with no locations gives an empty point, which comes out `none`.
  3. `const sort = parseDriveSort(one(sp.sort));`. After `filtered` is built, if `sort` is set: `filtered.sort((a, b) => compareDrive(travel.byId.get(a.c.id), travel.byId.get(b.c.id), sort) || a.c.name.localeCompare(b.c.name));`. `filtered` may be a reference to `preAdded`; sort a copy (`[...filtered]`) so nothing else is mutated, and render from that copy.
  4. Pass `sort={sort}` and `originName={travel.originName}` to `<FilterBar>`.
  5. In each row, insert a Drive cell before the owner avatar span. Use the same markup as the Venues cell, with `width: 110`, `const d = travel.byId.get(c.id)`, and `className="cu-row-drive"`. Keep it visible on phones; the owner column already hides under 720px.
  6. In `controls.tsx` `FilterBar`:
     - add props `sort: string; originName: string | null`;
     - extend `pushWith`'s patch type with `sort?: string`: `const nso = patch.sort !== undefined ? patch.sort : sort; if (nso) p.set("sort", nso);`;
     - add a `<select className="pk-searchbar-select" aria-label="Sort" value={sort} onChange={(e) => pushWith({ sort: e.target.value })}>` with options `""` → "Default order", `"near"` → "Nearest first", `"far"` → "Farthest first". Put it inside the `SearchFilterBar` children after the owner select;
     - add a line under the chips row: `<div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 8 }}>{originName ? `Drive times from ${originName}` : "Set a quote origin in Settings → Locations to see drive times"}</div>`.
- [ ] **Step 2: Check.** Run `rm -rf .next && npx tsc --noEmit` and `npx eslint "src/app/(app)/companies"`, both clean. Commit: `feat(companies): drive-from-origin column + nearest/farthest sort (#176)`

---

### Task 5: "Traveling from" in the New event form

**Files:** Modify `src/app/(app)/calendar/event-modal.tsx`

**Interfaces:** Consumes `travelOriginOptionsAction` and `EventFormInput.travelFrom` from Task 2.

- [ ] **Step 1: Implement.**
  1. Import `travelOriginOptionsAction` from `"../calendar-actions"`.
  2. Add state:
     - `const [originOpts, setOriginOpts] = useState<{ base: { id: string; name: string } | null; offices: Array<{ id: string; name: string }> } | null>(null);`
     - `const [originChoice, setOriginChoice] = useState("");`. `""` means My base, `"__addr"` means Another address, anything else is an office id.
     - `const [originAddress, setOriginAddress] = useState("");`
  3. Add an effect that, only when `target.mode === "create"`, calls `travelOriginOptionsAction().then((o) => { if (live) setOriginOpts(o); }).catch(() => {})`, with a `live` flag in the cleanup. It sets state inside the promise, so it is lint-safe.
  4. Directly after the Location `<input>`, when `target.mode === "create" && !allDay`, render:
```tsx
<label style={label}>Traveling from</label>
<select style={field} value={originChoice} onChange={(e) => setOriginChoice(e.target.value)}>
  <option value="">{originOpts?.base ? `My base — ${originOpts.base.name}` : "My base"}</option>
  {(originOpts?.offices || [])
    .filter((o) => o.id !== originOpts?.base?.id)
    .map((o) => (
      <option key={o.id} value={o.id}>{o.name}</option>
    ))}
  <option value="__addr">Another address…</option>
</select>
{originChoice === "__addr" && (
  <input
    style={{ ...field, marginTop: 6 }}
    value={originAddress}
    onChange={(e) => setOriginAddress(e.target.value)}
    placeholder="Where are you coming from?"
  />
)}
<div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 4 }}>
  Used for the automatic “Drive to …” block when the location is a street address.
</div>
```
  5. In `save()`, add `travelFrom` to `input` for create mode only:
     `travelFrom: target.mode === "create" ? (originChoice === "__addr" ? { address: originAddress.trim() } : originChoice ? { officeId: originChoice } : undefined) : undefined,`
     Update then receives the same object type, and the field is ignored there. Make sure the TypeScript object literal still satisfies both actions' input types.
- [ ] **Step 2: Check.** Run `npx tsc --noEmit` and `npx eslint "src/app/(app)/calendar"`, both clean. Commit: `feat(calendar): "Traveling from" choice on new appointments (#176)`

---

### Task 6: Browser verification, gates, PUNCHLIST + DECISIONS (controller)

- [ ] Run the worktree dev server through a temporary `.claude/launch.json` entry in the main checkout, and restore that file afterwards. Check:
  - `/venues`: the Drive column, all three sorts, sort kept through a search, unlocated rows last;
  - `/companies`: the column, the sort select, the origin line;
  - the calendar New event form: the Traveling from options and the typed-address field showing and hiding. Saving needs a Google Calendar grant, which is absent on the worktree, so say so;
  - phone width on `/venues`.
- [ ] `preview_stop`, then confirm no stray processes remain.
- [ ] Gates, with real numbers: `rm -rf .next && npx tsc --noEmit`, `npm run -s test:drive-distance`, `npm run -s test:geo-backfill`, `npm run -s test:specs`, `npm run -s test:smoke`, `npx eslint` (baseline 124 / 0).
- [ ] Re-check that #176 and D229 are free on a freshly fetched origin/main and all branches, then append the PUNCHLIST and DECISIONS entries and commit. **Do not push.**
