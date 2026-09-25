# One fixture builder — the Subassemblies form with the Assemblies logic

**Date:** 2026-09-25 · **Status:** approved by Jeff (brainstorm, 2026-09-25) · **Sequenced after:** Part documents
(`feat/part-documents`, PUNCHLIST #207) — this build starts from main once that has merged.

## 1. Goal

Jeff: "Can we use the form from subassemblies, but the logic from Assemblies and merge them together into one form and
input."

Today `/design/assemblies` shows two tabs over two unrelated record types (D156/#130):
- **Assemblies** — `settings.fixtureAssemblies` (a full-replace JSON array on the settings singleton,
  `src/lib/settings.ts`), ids `fa-<ts36>` minted client-side, a flat list of role-tagged components
  `{ sku, label, role, defaultQty, costOverride? }` (`src/lib/fixture-assemblies.ts`), live cost **and** sell from the
  catalog, any signed-in user may edit. Consumed by the **Estimator** fixture configurator, **Quick Design** (5 auto
  buckets) and the **Grid** scope panel / intake (`fixtureAssemblies` selection map).
- **Subassemblies** — doc-store collection `subassemblies` (`src/lib/stores/subassemblies.ts`), ids `SA-<TS36>`
  server-minted collision-safe, a structured form (label, description, light engine, lens, lamp, position, circuit, four
  option boxes data/power/mounting/accessories), `price = cost`, requires light engine + lens, refuses missing catalog
  parts, `manage_users` only. Consumed by nothing outside its own screen.

The result is **one record type, one form, one tab ("Fixtures")**, used everywhere assemblies are used today.

## 2. Decisions (from the brainstorm)

1. **Form = the Subassemblies form**, extended: label, description, light engine, lens, lamp/wattage, default hang
   position, default circuit, and four boxes (Data / Power / Mounting / Accessories).
2. **Logic = Assemblies**: live pricing from the catalog, **cost and sell** separately, per-line **cost override**;
   consumed by Estimator, Quick Design and Grid.
3. **Box lines carry a default qty.** Qty ≥ 1 = included when the fixture is placed; **qty 0 = compatible optional
   add-on**, offered (off by default) in the Estimator / Quick Design / Grid.
4. **Required:** label + light engine. Lens optional. A catalog part that no longer exists shows a warning and prices
   as missing but **does not block save**.
5. **Permission:** anyone signed in (`requireUser()`); every save stamps `updatedAt` / `updatedBy`.
6. **Storage:** one doc-store collection; existing records convert **keeping their ids** (`fa-…` and `SA-…`).

## 3. Data

Collection: keep the existing **`subassemblies`** doc table (already registered, soft-delete, `_seq_bump`) — no new
table, no SQL migration. Record shape (`FixtureRecord`, `src/lib/stores/fixtures.ts`, replacing
`FixtureSubassembly`'s module; the old export names stay as aliases so older readers compile):

```
{ id, kind: "fixture", label, description,
  lightEngineSku, lensSku | null, lamp?, position?, circuit?,
  lines: Record<"data"|"power"|"mounting"|"accessories", FixtureLine[]>,
  snapshot?: { cost, price, pricedAt },            // build-time, for the "was $X" badge
  createdAt, createdBy, updatedAt, updatedBy,
  legacy?: { from: "assembly"|"subassembly" } }

FixtureLine = { sku, label?, qty: number /* ≥ 0; 0 = optional */, costOverride?: number }
```

Stored names (`lightEngineName`, `lensName`, per-option `name`/`cost`) are no longer the source of truth — names and
prices resolve live from the catalog on read; the old stored values remain on converted rows only as fallback display
for a missing part.

**Ids.** New fixtures: `SA-<TS36>` via the existing collision-safe `insertDocIfAbsent`. Converted assemblies keep
`fa-…` verbatim so Estimator BOM lines (`sku: assembly.id`) and Grid `fixtureAssemblies` maps keep resolving.

**Conversion (idempotent, one-time, on first read and via `scripts/fixtures-convert.ts`):**
- Each `settings.fixtureAssemblies` entry → a fixture row with the same id (skip if a row with that id exists).
  Role mapping: first `fixture` → light engine; first `lens` → lens; `data`/`power` → those boxes; `mount` → Mounting;
  `accessory`, `cable`, `lamp`, `other`, and any additional `fixture`/`lens` members → Accessories. `defaultQty` →
  `qty`; `label` and `costOverride` carried over; component order kept. An assembly with **no** fixture-role member
  keeps its first component as the light engine (so it still satisfies the required field) and is flagged
  `needsReview` in the list.
- Each existing `subassemblies` row → rewritten in place to the new shape (`options[cat][] {sku,qty}` → `lines`).
- After conversion `settings.fixtureAssemblies` is no longer read (left in place, untouched, as a backup).

## 4. Pricing (pure, `src/lib/fixture-assemblies.ts`)

`resolveFixture(record, catalog)`:
- Parts = light engine (qty 1), lens (qty 1, if any), then every box line.
- For each part: `cost = costOverride ?? catalog.cost`, `sell = catalog.price` (the Assemblies rule); missing part →
  `found: false`, contributes 0, warning shown.
- **Included total** = Σ over parts with qty ≥ 1 of `qty × cost` / `qty × sell`. Optional (qty 0) lines are listed with
  their unit cost/sell but add nothing until switched on.
- `fixtureDescription()` keeps `assemblyDescription()`'s "Name — label×qty; …" format over included parts.

## 5. Consumers

- **Estimator** fixture configurator: lists fixtures (same picker); included parts pre-filled at default qty and
  editable per quote exactly as today; optional parts listed with an off switch (turning one on sets qty 1). The BOM
  line is unchanged in shape (`sku: fixture.id`, description, aggregate cost/price, `components[]`).
- **Quick Design** (5 buckets) and **Grid** scope panel / intake: pick fixtures instead of assemblies; included parts
  only (optional add-ons are an Estimator-level choice).
- **Accessory graph** (Part documents, `syncAccessoryLinks`): scope `fixture:<id>`; parent = light engine SKU;
  accessories = lens + every box line (included or optional); the per-line **"has its own datasheet"** toggle lives on
  each line in this form. The part-documents branch's `assembly:<id>` / `subassembly:<id>` scopes are re-synced to the
  single scope and their old rows soft-deleted.

## 6. What the user sees

- `/design/assemblies` → one **Fixtures** view (the `?tab=` switch goes; `?tab=subassemblies` and
  `/design/subassemblies` keep redirecting to it).
- The form (§2.1) with, per box line: part, qty (0 labelled "optional"), cost override, ↑/↓, ×, and the datasheet
  coverage chip/toggle. Footer: live included cost and sell + "prices as of…". Saved list below: Edit, delete via
  `ConfirmButton`, "was $X when built" drift badge, and a "needs review" badge on converted assemblies that had no
  fixture-role member.

## 7. Testing

Pure: role mapping (every role; multiple fixture/lens members; no fixture member), ids preserved, conversion twice =
no change; `resolveFixture` (override beats catalog, qty 0 excluded from totals, missing part = found:false and 0).
Store: create/update/delete, save rules (label + light engine required; missing part allowed), who/when stamps.
Consumers: a converted assembly yields the same Estimator BOM line totals, Quick Design and Grid picks as before
conversion; optional add-on switched on adds qty 1. Accessory graph: one `fixture:` scope, old scopes cleared. Gates:
tsc, eslint (baseline), test:specs, regressions harness, test:smoke, `next build`.

## 8. Out of scope

Non-fixture assemblies (racks, panels); per-quote editing of the fixture record itself; margin rules beyond the
catalog's sell price.
