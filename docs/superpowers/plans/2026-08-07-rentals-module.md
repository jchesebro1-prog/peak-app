# Gear Rentals Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Rentals module — equipment inventory with per-location stock, availability-checked bookings, and a standalone "Rental" quote type — mirroring the app's existing repair/flame-test quote builders.

**Architecture:** Three new doc-store collections (`equipment_items`, `equipment_locations`, `equipment_bookings`) following the exact pattern `catalog_parts`/`repair_jobs` already use — NOT new relational Drizzle tables. A `rentals/quote/*` builder mirrors `repairs/quote/*` file-for-file: pick gear + date range → live availability check → auto-priced by day/week/month → "Won" auto-spawns confirmed bookings via the same idempotent `syncFromQuotes()` sweep pattern already wired into `quotes/actions.ts`.

**Tech Stack:** Next.js 16 App Router (TypeScript), Drizzle doc-store (`@/db/doc-store`), server actions.

## Global Constraints

- Storage: use the doc-store collection pattern (`getDoc`/`listDocs`/`upsertDoc`/`mergeUpsert` from `@/db/doc-store`), matching `catalog_parts`/`repair_jobs` — **not** new Drizzle `pgTable`s with individual columns. (Deviates from the literal wording of `docs/superpowers/specs/2026-08-07-rentals-module-design.md`'s Data Model section, which sketched relational tables before this plan's codebase investigation found the real convention. Same entities, correct storage mechanism.)
- Permissions: reuse the existing closed 4-value `Perm` union (`manage_users`/`approve`/`create`/`send` in `src/lib/team.ts`) — do **not** add `manageRentals`/`viewRentals`. Nothing else in the app perm-gates by module (nav has no perm field), so Rentals follows suit: inventory CRUD gated by `requirePerm("create")`, quote actions gated by `create`/`send` exactly like the repair quote builder. Browsing `/rentals` requires only `requireUser()`.
- IDs: sequential prefixed strings matching existing store conventions — `eq-<n>` (items), `loc-<n>` (locations), `bk-<n>` (bookings).
- Timestamps: epoch-ms numbers (`Date.now()`), per AGENTS.md convention.
- No test framework exists in this repo (confirmed: no Jest/Vitest, no `*.test.ts`). Pure-logic assertions go into `scripts/test-review-and-spec.ts` using its existing `ok(condition, message)` PASS/FAIL pattern. UI/server-action tasks are verified manually via `npm run dev`.
- UI: use existing `pk-*` CSS classes and CSS var `--accent` — never hardcode colors, per AGENTS.md.
- Log deviations from the spec's literal wording in `DECISIONS.md` (Task 1).

---

### Task 1: Equipment items + locations data layer

**Files:**
- Modify: `src/db/doc-tables.ts` (add three collection tables)
- Create: `src/lib/stores/equipment-items.ts`
- Create: `src/lib/stores/equipment-locations.ts`
- Create: `src/db/seeds/equipment.ts`
- Modify: `src/db/seed-data.ts` (register new seeds in `DEMO_SEEDS`)
- Modify: `DECISIONS.md`
- Modify: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Produces: `EquipmentItem = { id: string; sku: string; name: string; category: "speakers"|"monitors"|"lighting"|"consoles"|"control-io"|"other"; subcategory?: string; manufacturer?: string; description?: string; dayRate: number; weekRate: number; monthRate: number; active: boolean; stock: Array<{ locationId: string; qty: number }> }`
- Produces: `equipmentItemsStore.list(): Promise<EquipmentItem[]>`, `.get(id): Promise<EquipmentItem|null>`, `.byCategory(category): Promise<EquipmentItem[]>`, `.upsert(item): Promise<EquipmentItem>`, `.mergeUpsert(id, patch): Promise<EquipmentItem>`, `.qtyOwned(itemId, locationId): Promise<number>`
- Produces: `EquipmentLocation = { id: string; name: string; address?: string }`
- Produces: `equipmentLocationsStore.list(): Promise<EquipmentLocation[]>`, `.get(id): Promise<EquipmentLocation|null>`, `.upsert(loc): Promise<EquipmentLocation>`

- [ ] **Step 1: Read the existing pattern**

Read `src/db/doc-tables.ts` in full. Find the `repairJobs` pgTable export (backs the `"repair_jobs"` collection, per `src/db/doc-tables.ts:151`). Also read `src/lib/stores/catalog.ts` in full (already have its type/signatures from research — read to see the doc-store import lines and how `list()`/`upsert()` call `getDoc`/`listDocs`/`upsertDoc`).

- [ ] **Step 2: Add the three new doc-tables**

In `src/db/doc-tables.ts`, add three new `pgTable` exports, copying `repairJobs`'s exact column structure and index pattern verbatim except for the table name string and export identifier:

```ts
export const equipmentItems = pgTable("equipment_items", { /* same columns as repairJobs */ });
export const equipmentLocations = pgTable("equipment_locations", { /* same columns as repairJobs */ });
export const equipmentBookings = pgTable("equipment_bookings", { /* same columns as repairJobs */ }); // used by Task 2
```

- [ ] **Step 3: Generate + apply migration**

Run: `npm run db:generate`
Expected: new SQL file appears under `drizzle/` referencing `equipment_items`, `equipment_locations`, `equipment_bookings`.

Run: `npm run db:migrate`
Expected: exits 0, no errors. (Per AGENTS.md: confirm no other `tsx`/dev-server process is holding `.data/pglite` open before running this.)

- [ ] **Step 4: Write `src/lib/stores/equipment-locations.ts`**

```ts
import { getDoc, listDocs, upsertDoc } from "@/db/doc-store";

export type EquipmentLocation = {
  id: string;
  name: string;
  address?: string;
};

const COLLECTION = "equipment_locations";

export async function list(): Promise<EquipmentLocation[]> {
  return listDocs<EquipmentLocation>(COLLECTION);
}

export async function get(id: string): Promise<EquipmentLocation | null> {
  return getDoc<EquipmentLocation>(COLLECTION, id);
}

export async function upsert(
  loc: Omit<EquipmentLocation, "id"> & { id?: string }
): Promise<EquipmentLocation> {
  const all = await list();
  const id = loc.id || `loc-${all.length + 1}`;
  const doc: EquipmentLocation = { ...loc, id };
  await upsertDoc(COLLECTION, doc);
  return doc;
}
```

- [ ] **Step 5: Write `src/lib/stores/equipment-items.ts`**

```ts
import { getDoc, listDocs, upsertDoc, mergeUpsertDoc } from "@/db/doc-store";

export type EquipmentCategory =
  | "speakers"
  | "monitors"
  | "lighting"
  | "consoles"
  | "control-io"
  | "other";

export type EquipmentItem = {
  id: string;
  sku: string;
  name: string;
  category: EquipmentCategory;
  subcategory?: string;
  manufacturer?: string;
  description?: string;
  dayRate: number;
  weekRate: number;
  monthRate: number;
  active: boolean;
  stock: Array<{ locationId: string; qty: number }>;
};

const COLLECTION = "equipment_items";

export async function list(): Promise<EquipmentItem[]> {
  return listDocs<EquipmentItem>(COLLECTION);
}

export async function get(id: string): Promise<EquipmentItem | null> {
  return getDoc<EquipmentItem>(COLLECTION, id);
}

export async function byCategory(category: EquipmentCategory): Promise<EquipmentItem[]> {
  const all = await list();
  return all.filter((i) => i.category === category);
}

export async function upsert(
  item: Omit<EquipmentItem, "id"> & { id?: string }
): Promise<EquipmentItem> {
  const all = await list();
  const id = item.id || `eq-${all.length + 1}`;
  const doc: EquipmentItem = { ...item, id };
  await upsertDoc(COLLECTION, doc);
  return doc;
}

export async function mergeUpsert(
  id: string,
  patch: Partial<Omit<EquipmentItem, "id">>
): Promise<EquipmentItem> {
  return mergeUpsertDoc<EquipmentItem>(COLLECTION, id, patch);
}

export async function qtyOwned(itemId: string, locationId: string): Promise<number> {
  const item = await get(itemId);
  if (!item) return 0;
  const row = item.stock.find((s) => s.locationId === locationId);
  return row ? row.qty : 0;
}
```

If `mergeUpsertDoc` doesn't exist under that exact name in `@/db/doc-store`, grep for the function `mergeUpsert` uses in `catalog.ts` (its `mergeUpsert` at `catalog.ts:100-ish` per research) and import whatever the real helper is named instead.

- [ ] **Step 6: Seed fixtures**

Create `src/db/seeds/equipment.ts`, following the exact shape of `src/db/seeds/customers.ts`:

```ts
import type { EquipmentItem } from "@/lib/stores/equipment-items";
import type { EquipmentLocation } from "@/lib/stores/equipment-locations";

export function equipmentLocationsSeed(): EquipmentLocation[] {
  return [
    { id: "loc-1", name: "Main Warehouse", address: "" },
    { id: "loc-2", name: "Job Trailer", address: "" },
  ];
}

export function equipmentItemsSeed(): EquipmentItem[] {
  return [
    { id: "eq-1", sku: "SPK-QSC-K12", name: "QSC K12.2 Speaker", category: "speakers", manufacturer: "QSC", dayRate: 45, weekRate: 180, monthRate: 500, active: true, stock: [{ locationId: "loc-1", qty: 8 }] },
    { id: "eq-2", sku: "MON-JBL-EON", name: "JBL EON Monitor", category: "monitors", manufacturer: "JBL", dayRate: 35, weekRate: 140, monthRate: 400, active: true, stock: [{ locationId: "loc-1", qty: 6 }] },
    { id: "eq-3", sku: "LT-CHV-ROGUE", name: "Chauvet Rogue R2 Wash", category: "lighting", manufacturer: "Chauvet Professional", dayRate: 60, weekRate: 240, monthRate: 700, active: true, stock: [{ locationId: "loc-1", qty: 12 }, { locationId: "loc-2", qty: 4 }] },
    { id: "eq-4", sku: "CON-YAM-CL5", name: "Yamaha CL5 Console", category: "consoles", manufacturer: "Yamaha", dayRate: 200, weekRate: 800, monthRate: 2200, active: true, stock: [{ locationId: "loc-1", qty: 2 }] },
    { id: "eq-5", sku: "IO-ETC-NET3", name: "ETC Net3 Gateway", category: "control-io", manufacturer: "ETC", dayRate: 25, weekRate: 100, monthRate: 280, active: true, stock: [{ locationId: "loc-1", qty: 4 }] },
  ];
}
```

- [ ] **Step 7: Wire fixtures into `DEMO_SEEDS`**

In `src/db/seed-data.ts`, add to the `DEMO_SEEDS` tuple array (following the exact `["catalog_parts", catalogSeed as unknown as () => Doc[]]` pattern):

```ts
["equipment_locations", equipmentLocationsSeed as unknown as () => Doc[]],
["equipment_items", equipmentItemsSeed as unknown as () => Doc[]],
```

Import `equipmentLocationsSeed, equipmentItemsSeed` from `./seeds/equipment` at the top of the file.

- [ ] **Step 8: Reseed and verify**

Run: `npm run db:reset-local`
Expected: exits 0. Then start the dev server (`npm run dev`) and confirm no startup errors in the terminal — the seed ran without throwing.

- [ ] **Step 9: Add pure-logic assertions**

In `scripts/test-review-and-spec.ts`, add (following the file's existing `ok(condition, message)` pattern — read the file first to match import/call style exactly):

```ts
import { list as listEquipmentItems, byCategory as equipmentByCategory } from "../src/lib/stores/equipment-items";

const eqItems = await listEquipmentItems();
ok(eqItems.length === 5, "equipment-items: seed produced 5 items");
const lighting = await equipmentByCategory("lighting");
ok(lighting.length === 1 && lighting[0].id === "eq-3", "equipment-items: byCategory filters correctly");
```

Run: `npm run test:specs`
Expected: both new lines print `PASS`.

- [ ] **Step 10: Log the deviation in DECISIONS.md**

Add an entry to `DECISIONS.md` (check the file's existing numbering convention, e.g. `D###`, and use the next free number):

```
D###. Rentals module (2026-08-07): equipment inventory stored as doc-store
collections (equipment_items, equipment_locations, equipment_bookings),
matching catalog_parts/repair_jobs — not new relational tables as the
initial design spec sketched. Permissions reuse the existing closed
create/send/approve set rather than adding manageRentals/viewRentals —
nothing else in the app perm-gates by module. See
docs/superpowers/specs/2026-08-07-rentals-module-design.md and
docs/superpowers/plans/2026-08-07-rentals-module.md.
```

- [ ] **Step 11: Commit**

```bash
git add src/db/doc-tables.ts src/lib/stores/equipment-items.ts src/lib/stores/equipment-locations.ts src/db/seeds/equipment.ts src/db/seed-data.ts scripts/test-review-and-spec.ts DECISIONS.md drizzle/
git commit -m "feat(rentals): add equipment items + locations data layer"
```

---

### Task 2: Equipment bookings + availability logic

**Files:**
- Create: `src/lib/stores/equipment-bookings.ts`
- Modify: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `equipmentItemsStore.get(id)`, `.qtyOwned(itemId, locationId)` from Task 1
- Produces: `EquipmentBooking = { id: string; itemId: string; locationId: string; qty: number; quoteId: string; startDate: number; endDate: number; status: "confirmed"|"out"|"returned"|"cancelled"; rate: number }` (no `"reserved"` state — per the design spec, editing/quoting doesn't lock stock, so no booking row exists until a quote is Won, at which point it's created directly as `confirmed`)
- Produces: `overlaps(aStart, aEnd, bStart, bEnd): boolean`
- Produces: `availableQty(itemId, locationId, start, end): Promise<number>`
- Produces: `bookingsStore.list()`, `.byQuote(quoteId)`, `.create(booking)`, `.setStatus(id, status)`, `.createFromQuote(quoteId)`, `.syncFromQuotes()` — signatures mirror `src/lib/stores/repair-jobs.ts`'s `byQuote`/`createFromQuote`/`syncFromQuotes` exactly (read that file's full implementation first, since Task 2's `syncFromQuotes` must match its idempotent full-sweep pattern to be safely callable alongside the other four sync functions in `quotes/actions.ts`).

- [ ] **Step 1: Read the pattern to mirror**

Read `src/lib/stores/repair-jobs.ts` in full (already have the `createFromQuote`/`syncFromQuotes`/`byQuote` excerpts from research — read the surrounding `fromQuote` mapper and `create`/`setStatus` functions too, since those aren't yet pasted into this plan).

- [ ] **Step 2: Write the overlap + availability helpers**

```ts
// in src/lib/stores/equipment-bookings.ts, above the store functions

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}
```

- [ ] **Step 3: Add overlap assertions to `scripts/test-review-and-spec.ts`**

```ts
import { overlaps } from "../src/lib/stores/equipment-bookings";

ok(overlaps(1000, 2000, 1500, 2500) === true, "overlaps: partial overlap detected");
ok(overlaps(1000, 2000, 2000, 3000) === true, "overlaps: touching boundary counts as overlap");
ok(overlaps(1000, 2000, 2001, 3000) === false, "overlaps: adjacent non-touching is not overlap");
ok(overlaps(1000, 5000, 2000, 3000) === true, "overlaps: fully contained overlap detected");
```

Run: `npm run test:specs`
Expected: all four new lines print `PASS`.

- [ ] **Step 4: Write the full store module**

```ts
import { getDoc, listDocs, upsertDoc } from "@/db/doc-store";
import { get as getItem, qtyOwned } from "./equipment-items";

export type BookingStatus = "confirmed" | "out" | "returned" | "cancelled";

export type EquipmentBooking = {
  id: string;
  itemId: string;
  locationId: string;
  qty: number;
  quoteId: string;
  startDate: number;
  endDate: number;
  status: BookingStatus;
  rate: number;
};

const COLLECTION = "equipment_bookings";

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}

export async function list(): Promise<EquipmentBooking[]> {
  return listDocs<EquipmentBooking>(COLLECTION);
}

export async function byQuote(quoteId: string): Promise<EquipmentBooking[]> {
  const all = await list();
  return all.filter((b) => b.quoteId === quoteId);
}

export async function availableQty(
  itemId: string,
  locationId: string,
  start: number,
  end: number
): Promise<number> {
  const owned = await qtyOwned(itemId, locationId);
  const all = await list();
  const committed = all
    .filter(
      (b) =>
        b.itemId === itemId &&
        b.locationId === locationId &&
        (b.status === "confirmed" || b.status === "out") &&
        overlaps(b.startDate, b.endDate, start, end)
    )
    .reduce((sum, b) => sum + b.qty, 0);
  return owned - committed;
}

export async function create(
  booking: Omit<EquipmentBooking, "id">
): Promise<EquipmentBooking> {
  const all = await list();
  const id = `bk-${all.length + 1}`;
  const doc: EquipmentBooking = { ...booking, id };
  await upsertDoc(COLLECTION, doc);
  return doc;
}

export async function setStatus(id: string, status: BookingStatus): Promise<void> {
  const booking = await getDoc<EquipmentBooking>(COLLECTION, id);
  if (!booking) return;
  await upsertDoc(COLLECTION, { ...booking, status });
}

/** Reads quote.rental (written by the rentals/quote builder) and creates one
 *  booking per line, each `confirmed`. Mirrors repair-jobs.ts's createFromQuote. */
export async function createFromQuote(quoteId: string): Promise<EquipmentBooking[]> {
  const existing = await byQuote(quoteId);
  if (existing.length) return existing;
  const q = await getDoc<{ id: string; quoteType: string; rental?: { lines: Array<{ itemId: string; locationId: string; qty: number; startDate: number; endDate: number; rate: number }> } }>("quotes", quoteId);
  if (!q || q.quoteType !== "rental" || !q.rental) return [];
  const created: EquipmentBooking[] = [];
  for (const line of q.rental.lines) {
    created.push(
      await create({
        itemId: line.itemId,
        locationId: line.locationId,
        qty: line.qty,
        quoteId,
        startDate: line.startDate,
        endDate: line.endDate,
        status: "confirmed",
        rate: line.rate,
      })
    );
  }
  return created;
}

/** Idempotent sweep — scan won rental quotes, create bookings for any not yet made.
 *  Safe to call alongside the other four sync* functions in quotes/actions.ts. */
export async function syncFromQuotes(): Promise<number> {
  const quotes = await listDocs<{ id: string; quoteType: string; status: string }>("quotes");
  let made = 0;
  for (const q of quotes) {
    if (q.quoteType !== "rental" || q.status !== "won") continue;
    const existing = await byQuote(q.id);
    if (existing.length) continue;
    const created = await createFromQuote(q.id);
    made += created.length;
  }
  return made;
}
```

- [ ] **Step 5: Add booking-lifecycle assertions**

In `scripts/test-review-and-spec.ts`:

```ts
import { availableQty, create as createBooking } from "../src/lib/stores/equipment-bookings";

const before = await availableQty("eq-1", "loc-1", Date.now(), Date.now() + 86400000);
ok(before === 8, "equipment-bookings: eq-1 starts fully available at loc-1");
await createBooking({ itemId: "eq-1", locationId: "loc-1", qty: 3, quoteId: "test-quote", startDate: Date.now(), endDate: Date.now() + 86400000, status: "confirmed", rate: 45 });
const after = await availableQty("eq-1", "loc-1", Date.now(), Date.now() + 86400000);
ok(after === 5, "equipment-bookings: confirmed booking reduces availability");
```

Run: `npm run test:specs`
Expected: both new lines print `PASS`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/equipment-bookings.ts scripts/test-review-and-spec.ts
git commit -m "feat(rentals): add equipment bookings store with availability check"
```

---

### Task 3: Wire rental quotes into the quote-status sync pipeline

**Files:**
- Modify: `src/lib/stores/quotes.ts`
- Modify: `src/app/(app)/quotes/actions.ts:69-82`

**Interfaces:**
- Consumes: `syncFromQuotes` from Task 2's `equipment-bookings.ts`
- Produces: `quoteType` union now includes `"rental"`; `SetStatusOpts.bypassApprovalGate` doc comment now names `rentals/quote` as a fourth allowed caller.

- [ ] **Step 1: Read the exact current state**

Read `src/lib/stores/quotes.ts` around line 513 (the `bypassApprovalGate` type + comment) and wherever `quoteType` is typed (grep `quoteType` in that file). Read `src/app/(app)/quotes/actions.ts` in full.

- [ ] **Step 2: Add "rental" to the quoteType union**

Wherever `quoteType` is declared as a string-literal union (e.g. `"flame_test" | "repair" | "inspection" | "consulting"`), add `| "rental"`.

- [ ] **Step 3: Update the bypassApprovalGate comment**

At `src/lib/stores/quotes.ts:513-515`, update the comment listing allowed `"engine-owned-flow"` callers to include `rentals/quote` as a fourth (repairs/quote, inspections/quote, flame-tests/quote, rentals/quote).

- [ ] **Step 4: Wire the sync call**

In `src/app/(app)/quotes/actions.ts`, inside the `if (status === "won") { ... }` block (currently lines 69-82), add the import and call:

```ts
import { syncFromQuotes as syncBookingsFromQuotes } from "@/lib/stores/equipment-bookings";
```

```ts
if (status === "won") {
  // Acceptance auto-spawns downstream work exactly like the prototype:
  // won flame-test quotes become FT jobs, won repair quotes become repair
  // jobs, won inspection quotes become requested inspections, won system
  // quotes become Installs projects, won consulting quotes ensure /
  // advance ConsultingEngagements, and won rental quotes become confirmed
  // equipment bookings. Each sync filters to its own quoteType and is
  // idempotent, so calling all six is safe.
  await syncFromQuotes();
  await syncRepairsFromQuotes();
  await syncInspectionsFromQuotes();
  await syncProjectsFromQuotes();
  await syncEngagementsFromQuotes();
  await syncBookingsFromQuotes();
}
```

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/quotes.ts src/app/(app)/quotes/actions.ts
git commit -m "feat(rentals): wire rental quotes into the won-quote sync pipeline"
```

---

### Task 4: Rentals hub screen (inventory browse + CRUD)

**Files:**
- Create: `src/app/(app)/rentals/page.tsx`
- Create: `src/app/(app)/rentals/actions.ts`

**Interfaces:**
- Consumes: `list`, `byCategory`, `upsert` from `equipment-items.ts` (Task 1); `list`, `upsert` from `equipment-locations.ts` (Task 1); `requireUser`, `requirePerm` from `@/lib/session.ts`

- [ ] **Step 1: Read a UI reference**

Read `src/app/(app)/catalog/page.tsx` in full (the existing browse-list screen with category filter — closest analog for the Rentals hub's layout, `pk-*` classes, and filter-pill pattern).

- [ ] **Step 2: Write `src/app/(app)/rentals/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import * as equipmentItems from "@/lib/stores/equipment-items";
import * as equipmentLocations from "@/lib/stores/equipment-locations";
import type { EquipmentCategory } from "@/lib/stores/equipment-items";

export async function upsertEquipmentItem(formData: FormData): Promise<void> {
  await requirePerm("create");
  const id = String(formData.get("id") || "");
  await equipmentItems.upsert({
    id: id || undefined,
    sku: String(formData.get("sku") || ""),
    name: String(formData.get("name") || ""),
    category: String(formData.get("category") || "other") as EquipmentCategory,
    manufacturer: String(formData.get("manufacturer") || ""),
    dayRate: Number(formData.get("dayRate") || 0),
    weekRate: Number(formData.get("weekRate") || 0),
    monthRate: Number(formData.get("monthRate") || 0),
    active: true,
    stock: [],
  });
  revalidatePath("/rentals");
}

export async function upsertEquipmentLocation(formData: FormData): Promise<void> {
  await requirePerm("create");
  await equipmentLocations.upsert({
    id: String(formData.get("id") || "") || undefined,
    name: String(formData.get("name") || ""),
  });
  revalidatePath("/rentals");
}
```

- [ ] **Step 3: Write `src/app/(app)/rentals/page.tsx`**

Server component: call `requireUser()`, `equipmentItems.list()`, `equipmentLocations.list()`. Render a category-filterable table (name, manufacturer, day/week/month rate, total qty across locations) following the exact `pk-*` table/filter-pill markup from `src/app/(app)/catalog/page.tsx` (read in Step 1) — copy its structure, swap the data source and columns. Each row links to an edit form using `upsertEquipmentItem`.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open `http://localhost:3000/rentals`.
Expected: page loads, shows the 5 seeded items grouped/filterable by category (speakers/monitors/lighting/consoles/control-io), no console errors.

Edit one item's day rate through the form, submit, reload.
Expected: new rate persists and displays.

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/rentals/page.tsx src/app/(app)/rentals/actions.ts
git commit -m "feat(rentals): add Rentals hub inventory screen"
```

---

### Task 5: Rental quote builder

**Files:**
- Create: `src/app/(app)/rentals/quote/page.tsx`
- Create: `src/app/(app)/rentals/quote/controls.tsx`
- Create: `src/app/(app)/rentals/quote/actions.ts`
- Create: `src/lib/pricing/rental.ts`
- Modify: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `equipmentItems.list()`/`byCategory()` (Task 1), `equipmentBookings.availableQty()` (Task 2), `setStatus` from `quotes.ts`
- Produces: `priceRental(days: number, rates: { dayRate: number; weekRate: number; monthRate: number }): number`
- Produces: `approveRentalQuote(formData: FormData): Promise<void>` (called by the builder's submit — persists, sets status `won` with `bypassApprovalGate: "engine-owned-flow"`, calls `createFromQuote`)

- [ ] **Step 1: Read the file to mirror**

Read `src/app/(app)/repairs/quote/page.tsx`, `controls.tsx`, and `actions.ts` in full. This is the exact structure to copy: server component loads initial data → client `QuoteBuilder` holds ephemeral line-item state and live-previews pricing → `actions.ts` persists + approves.

- [ ] **Step 2: Write the pricing formula**

Rentman's own docs don't specify a mixed-period rule (flagged as an open question in the design spec); default to billing whichever of day/week/month math is cheapest for the customer — simple, deterministic, no waiting on a rate-card decision:

```ts
// src/lib/pricing/rental.ts

export function priceRental(
  days: number,
  rates: { dayRate: number; weekRate: number; monthRate: number }
): number {
  if (days <= 0) return 0;
  const byDay = days * rates.dayRate;
  const byWeek = Math.ceil(days / 7) * rates.weekRate;
  const byMonth = Math.ceil(days / 30) * rates.monthRate;
  return Math.min(byDay, byWeek, byMonth);
}
```

- [ ] **Step 3: Add pricing assertions**

In `scripts/test-review-and-spec.ts`:

```ts
import { priceRental } from "../src/lib/pricing/rental";

const rates = { dayRate: 50, weekRate: 200, monthRate: 600 };
ok(priceRental(3, rates) === 150, "priceRental: 3 days bills at day rate (150)");
ok(priceRental(10, rates) === 400, "priceRental: 10 days bills at week rate (2 weeks = 400)");
ok(priceRental(30, rates) === 600, "priceRental: 30 days bills at month rate (600)");
ok(priceRental(0, rates) === 0, "priceRental: 0 days bills 0");
```

Run: `npm run test:specs`
Expected: all four new lines print `PASS`.

- [ ] **Step 4: Write `actions.ts`**

Mirror `repairs/quote/actions.ts`'s `persist()`/`saveRepairQuote()`/`approveRepairQuote()` shape exactly. The quote's `rental` subdoc shape must match what `equipment-bookings.ts`'s `createFromQuote` (Task 2, Step 4) reads:

```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { setStatus } from "@/lib/stores/quotes";
import { createFromQuote } from "@/lib/stores/equipment-bookings";
import { priceRental } from "@/lib/pricing/rental";
// import persist-a-draft-quote helper matching repairs/quote/actions.ts's `persist()` —
// read that function fully in Step 1 and adapt it for quoteType "rental" and
// a `rental: { lines: [...] }` subdoc instead of `repair: {...}`.

export async function approveRentalQuote(formData: FormData): Promise<void> {
  const id = await persist(formData); // adapt from repairs/quote/actions.ts
  if (!id) {
    revalidatePath("/", "layout");
    return;
  }
  await requirePerm("send");
  await setStatus(id, "won", undefined, { bypassApprovalGate: "engine-owned-flow" });
  await createFromQuote(id);
  revalidatePath("/", "layout");
  redirect("/rentals/quote?id=" + encodeURIComponent(id) + "&approved=1");
}
```

- [ ] **Step 5: Write `page.tsx` + `controls.tsx`**

Mirror `repairs/quote/page.tsx` (server component: load customer + settings + any existing quote by `?id=`) and `controls.tsx` (`"use client"` `QuoteBuilder`: date-range pickers, a category/manufacturer/search gear picker built from `equipmentItems.list()` — replacing the "massive dropdown" per the original pain point — line items with qty, live `priceRental()` preview per line, and an inline availability warning per line computed by calling a new small server action wrapping `availableQty()` from Task 2).

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, open `http://localhost:3000/rentals/quote`.
Expected: builder loads, gear picker shows all 5 seeded items filterable by category/manufacturer (not a flat dropdown), adding a line with a date range shows a live price matching `priceRental()`, submitting persists a draft.

Approve the quote (send it to `won`).
Expected: redirect with `approved=1`; check `/rentals` or query the `equipment_bookings` collection (e.g. via `db:studio`) to confirm a `confirmed` booking was created.

Create a second rental quote for the same item overlapping the same dates.
Expected: the picker shows a reduced/zero availability warning for that item.

- [ ] **Step 7: Commit**

```bash
git add src/app/(app)/rentals/quote/ src/lib/pricing/rental.ts scripts/test-review-and-spec.ts
git commit -m "feat(rentals): add rental quote builder with availability-aware pricing"
```

---

### Task 6: Rental agreement PDF letter

**Files:**
- Create: `src/app/(app)/rentals/quote/letter/route.ts` (default path — Step 1 finds the exact existing route to mirror; rename/relocate this file to match that module's actual path and type, e.g. `page.tsx` instead of `route.ts` if that's what flame-tests/inspections use)

**Interfaces:**
- Consumes: `renderLetterPdf(doc: LetterDoc): Buffer` and the `LetterDoc` type from `src/lib/pdf.ts`

- [ ] **Step 1: Find the exact route to mirror**

Run: `grep -rl "renderLetterPdf" src/app`
Expected: hits in the flame-tests and/or inspections letter routes. Read whichever file(s) come back in full — this shows the exact `LetterDoc` construction and how `renderLetterPdf`'s returned `Buffer` becomes an HTTP response (headers, content-type).

- [ ] **Step 2: Write the rental letter route**

Mirror the file type (route handler vs. server action) and response wiring found in Step 1 exactly. Construct a `LetterDoc` from the rental quote's customer, gear lines (name, qty, date range, rate), and total (sum of each line's `priceRental()` result) — matching the `LetterDoc` shape:

```ts
type LetterDoc = {
  companyName: string;
  accent: string;
  headerJpeg?: Buffer | null;
  headerFull?: boolean;
  tag: string; // "Rental Agreement"
  tagNote?: string;
  meta: Array<{ label: string; value: string; strong?: boolean }>;
  re: string;
  greeting: string;
  blocks: LetterBlock[]; // one block per gear line
  costLine: string; // "The above equipment rental will cost $X."
  costTail: string;
  taxNote: string;
  signer: { name: string; title: string; email?: string };
};
```

- [ ] **Step 3: Manual verification**

From a rental quote's builder page, trigger the letter/PDF action.
Expected: a PDF downloads or renders, showing company letterhead, gear line items with dates/rates, and the correct total.

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/rentals/quote/letter/
git commit -m "feat(rentals): add rental agreement PDF letter"
```

---

### Task 7: Quotes hub wiring (badge, filter, edit link, new-quote menu)

**Files:**
- Modify: `src/app/(app)/quotes/page.tsx`
- Modify: `src/app/(app)/quotes/controls.tsx`

**Interfaces:**
- Consumes: nothing new — this task only adds `"rental"` handling to existing dispatch tables.

- [ ] **Step 1: Add the badge**

In `src/app/(app)/quotes/page.tsx`, add to the `TYPE_BADGE` map (currently `page.tsx:41-50`):

```ts
rental: { label: "Rental", ink: "#2f7a52", soft: "#e6f4ec", bd: "#cde7d8" },
```

- [ ] **Step 2: Add the edit-link case**

In `editHrefFor` (`page.tsx:52-63`), add before the fallback `return`:

```ts
if (q.quoteType === "rental")
  return { href: `/rentals/quote?id=${encodeURIComponent(q.id)}`, label: "Open rental quote →" };
```

- [ ] **Step 3: Add to TYPE_KEYS and the filter pill array**

In `TYPE_KEYS` (`page.tsx:140`), add `"rental"` to the array. In the filter pill array (`page.tsx:405-413`), add:

```ts
["rental", "Rental", TYPE_BADGE.rental],
```

- [ ] **Step 4: Add to the New Quote menu**

Read `src/app/(app)/quotes/controls.tsx` around lines 125 and 160 (the repair/inspection entries) and add a matching entry:

```tsx
<Link href="/rentals/quote">+ New rental quote</Link>
```

(match the exact JSX/className pattern of the neighboring entries)

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open `/quotes`.
Expected: a "Rental" filter pill appears with the correct count; the rental quote created in Task 5 shows a green "Rental" badge and its edit link opens `/rentals/quote?id=...`; the "+ New rental quote" link appears in the New Quote menu and opens the builder.

- [ ] **Step 6: Commit**

```bash
git add src/app/(app)/quotes/page.tsx src/app/(app)/quotes/controls.tsx
git commit -m "feat(rentals): wire rental quotes into the Quotes hub"
```

---

### Task 8: Booking/status board

**Files:**
- Create: `src/app/(app)/rentals/board/page.tsx`
- Create: `src/app/(app)/rentals/board/actions.ts`

**Interfaces:**
- Consumes: `list`, `setStatus` from `equipment-bookings.ts` (Task 2); `get` from `equipment-items.ts` (Task 1)

- [ ] **Step 1: Read a reference**

Read `src/app/(app)/flame-tests/today/page.tsx` (the "today" day-sheet pattern referenced in the design spec) if it exists — grep first: `find src/app/(app)/flame-tests -iname "*today*"`. If it doesn't exist under that exact path, read `src/app/(app)/schedule/page.tsx`'s row-grouping logic instead as the fallback reference for grouping bookings by date.

- [ ] **Step 2: Write `actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { setStatus, type BookingStatus } from "@/lib/stores/equipment-bookings";

export async function toggleBookingStatus(formData: FormData): Promise<void> {
  await requirePerm("create");
  const id = String(formData.get("id") || "");
  const status = String(formData.get("status") || "") as BookingStatus;
  await setStatus(id, status);
  revalidatePath("/rentals/board");
}
```

- [ ] **Step 3: Write `page.tsx`**

Server component: `requireUser()`, load `equipmentBookings.list()` + `equipmentItems.list()` (for names), group bookings by `startDate` (upcoming load-ins) and by overdue-`out` (today > `endDate` and status still `out`). Render each booking with item name, qty, date range, and status-toggle buttons (`confirmed → out`, `out → returned`) posting to `toggleBookingStatus`. Overdue bookings get a visually distinct flag (reuse whatever overdue-styling convention the flame/repair dashboards use — grep `overdue` in `src/app/(app)/repairs/` for the class name).

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open `/rentals/board`.
Expected: the booking created in Task 5 appears, grouped correctly. Toggle it `confirmed → out`, reload — status persists. Manually backdate a test booking's `endDate` (via `db:studio`) to before today while status is `out`; reload the board.
Expected: it now shows the overdue flag.

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/rentals/board/
git commit -m "feat(rentals): add booking status board with overdue flag"
```

---

### Task 9: Nav entry + Import/Export wiring

**Files:**
- Modify: `src/components/nav/nav-data.ts`
- Modify: `src/app/(app)/import/types.ts`
- Modify: `src/app/(app)/import/registry.ts`

**Interfaces:**
- Consumes: `equipmentItems` store (Task 1) for the import/export writer

- [ ] **Step 1: Add the nav entry**

In `src/components/nav/nav-data.ts`, add to the "PM" group's `children` array (currently ending with the `repairs` entry around line 55-61):

```ts
{ key: "rentals", label: "Rentals", href: "/rentals" },
```

Then find `activeKeyFor`'s `map` (`nav-data.ts:104-132`, e.g. `"/repairs": "repairs",`) and add:

```ts
"/rentals": "rentals",
```

- [ ] **Step 2: Manual verification of nav**

Run: `npm run dev`, check the nav bar.
Expected: "Rentals" tab appears in the PM group; clicking it navigates to `/rentals` and the tab highlights active; it also stays highlighted when on `/rentals/quote` or `/rentals/board` if those routes are added to the same map key (add `"/rentals/quote": "rentals"` and `"/rentals/board": "rentals"` too).

- [ ] **Step 3: Add the Import/Export type config**

In `src/app/(app)/import/types.ts`, read the full `leads` entry (already pasted in this plan's research) and the `catalog` entry, then add a new entry to `IMPORT_TYPES` following the same shape:

```ts
{
  key: "equipment",
  label: "Equipment",
  mono: "EQ",
  color: "#2f7a52",
  blurb: "Rentable gear — category, manufacturer, and day/week/month rates.",
  dedupeLabel: "SKU",
  viewHref: "/rentals",
  viewLabel: "View in Rentals",
  fields: [
    { key: "sku", header: "SKU", label: "SKU", required: true, aliases: ["sku", "id"], example: "SPK-QSC-K12" },
    { key: "name", header: "Name", label: "Name", required: true, aliases: ["name", "item", "description"], example: "QSC K12.2 Speaker" },
    { key: "category", header: "Category", label: "Category", kind: "enum", options: ["speakers", "monitors", "lighting", "consoles", "control-io", "other"], aliases: ["category", "type"], example: "speakers" },
    { key: "manufacturer", header: "Manufacturer", label: "Manufacturer", aliases: ["manufacturer", "mfr", "brand"], example: "QSC" },
    { key: "dayRate", header: "Day Rate", label: "Day rate", kind: "number", aliases: ["dayrate", "day rate", "daily"], example: "45" },
    { key: "weekRate", header: "Week Rate", label: "Week rate", kind: "number", aliases: ["weekrate", "week rate", "weekly"], example: "180" },
    { key: "monthRate", header: "Month Rate", label: "Month rate", kind: "number", aliases: ["monthrate", "month rate", "monthly"], example: "500" },
  ],
},
```

- [ ] **Step 4: Add the Writer entry**

In `src/app/(app)/import/registry.ts`, find the `WRITERS: Record<string, Writer>` object (`registry.ts:118`) and read one existing `Writer` implementation in full (e.g. the `catalog` or `leads` entry) to match its `count`/`load`/`find`/`create`/`update`/`exportObjects` shape exactly. Add an `equipment` entry wired to `src/lib/stores/equipment-items.ts`'s `list`/`upsert`/`mergeUpsert`, deduping on `sku`.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open the Import/Export hub.
Expected: "Equipment" appears as an importable/exportable type with a nonzero count (5, from seed data); exporting produces a CSV with the seeded items; importing a CSV with a new SKU adds a new equipment item visible at `/rentals`.

- [ ] **Step 6: Commit**

```bash
git add src/components/nav/nav-data.ts src/app/(app)/import/types.ts src/app/(app)/import/registry.ts
git commit -m "feat(rentals): add nav entry and Import/Export support for equipment"
```

---

## Explicitly out of scope (per the design spec)

Serialized/per-unit tracking, barcode/QR scanning, damage/maintenance workflow, stock transfers between locations, utilization/revenue reporting, and Grid plan-view integration. None of the tasks above create structures that would need to be reworked to add these later.
