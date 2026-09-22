# Catalog: price dates + outdated banner, import guards, 1 MB cap; Assemblies: live re-pricing on one tab

Status: approved by Jeff (brainstorming 2026-09-21). Punch #129, #130, #132, #133, #134.
Branch `punch-2026-09-21-round-2`. Feeds the Vendors module (#122, separate spec).

## Context

`CatalogPart` (`src/lib/stores/catalog.ts:21-76`) has `mfr?: string` (free text), `list`, `cost`,
and `updatedAt` — a last-write stamp set on every `upsert()` (`catalog.ts:101`), including
non-price edits. The Home "Catalog glance" card (`src/app/(app)/home-catalog.tsx`) shows a raw
age per manufacturer from `priceBooks()` (`src/lib/catalog-books.ts:20-46`), which uses the oldest
`updatedAt` in the group and hides the age entirely if one part lacks a stamp. No threshold, no
effective date.

Two importers disagree: the Catalog page (`src/app/(app)/catalog/actions.ts:66-108`) stamps ONE
manufacturer over the whole file (hidden field from `controls.tsx:242-290`, optional) and upserts
by SKU (`actions.ts:91`); the Import hub `catalog` type (`src/app/(app)/import/registry.ts:487-515`,
`catalogPatch()` `:111-126`) takes `mfr` per row, falling back to the existing part's value. Neither
checks file size (`actions.ts:72` only checks `> 0`); the xlsx route caps at 10 MB
(`src/app/api/import/xlsx/route.ts:15`).

Assemblies resolve live: `resolveFixtureAssemblies()` (`src/lib/fixture-assemblies.ts:60-89`) joins
component SKUs against the current catalog on every read — a price-list import changes them at
once. Subassemblies do not: `saveFixtureAction` (`src/app/(app)/design/subassemblies/actions.ts:45-46`)
snapshots `cost`/`price` at save time. They are two nav entries (`nav-data.ts:93,96`).

Jeff's asks (2026-09-21): assemblies auto-update when price lists change (#129); Assemblies +
Subassemblies on one tab (#130); mandatory manufacturer on import with a wrong-manufacturer double
check (#132); per-line price dates, an 18-month "outdated" banner by manufacturer like the
dashboard's but editable, and an effective date on price lists (#133); a 1 MB import cap that
errors clearly (#134).

## 1. Data model

- `CatalogPart.pricedAt?: number` — epoch ms of the price list this price came from (the
  *effective date*). Set only when `list` or `cost` actually changes on upsert, from the importer's
  effective-date field (default: import day). Any other code path that changes `list`/`cost`
  through `upsert()` stamps `pricedAt = now` unless it passes an explicit date. `updatedAt` keeps
  its last-write meaning.
- `settings.priceListEffective?: Record<string, number>` — per-manufacturer effective date
  (normalized manufacturer key → epoch ms). The one-time backfill and the "edit" affordance on the
  banner; a fallback for parts that predate `pricedAt`.
- Pure `effectivePriceDate(part, settings): number | null` = `part.pricedAt ??
  settings.priceListEffective[key(part.mfr)] ?? null`.
- `OUTDATED_AFTER_MS = 18 months` (548 days) in `src/lib/catalog-books.ts`; `isOutdated(at, now)`.
- Manufacturer key: `mfrKey(name)` = lowercase, strip non-alphanumerics — the same `norm()`
  the importer uses (`import/parse.ts:127-131`) — so "Meyer Sound" / "meyer-sound" are one book.

No schema change: parts and settings are JSON documents.

## 2. `priceBooks()` and the banner (`catalog-books.ts`, `home-catalog.tsx`, `catalog/page.tsx`)

`priceBooks()` returns per manufacturer: `count`, `effectiveAt` (the **oldest** effective date
among its parts, `null` only when no part and no override has one), `outdated: boolean`,
`unknown: boolean` (no date at all). The Home card renders the same pill as today plus an
"Outdated" red state and an "Unknown" grey one; the Catalog page gets a banner above the table
listing outdated + unknown manufacturers, each with an inline date input ("Price list effective
…") that writes `settings.priceListEffective[key]` via `setPriceListEffectiveAction(mfr, at)`.
Clicking a manufacturer in the banner applies that facet filter.

## 3. Importers (`catalog/actions.ts`, `import/registry.ts`, `catalog/controls.tsx`, `import/controls.tsx`)

Shared `src/lib/catalog-import-guard.ts` (pure, tested):

- `checkManufacturer({ mfr, fileSkus, catalog })` →
  `{ ok: true, normalizedMfr }` | `{ ok: false, reason, detail }`:
  - empty `mfr` → `reason: "missing"`;
  - `mfr` normalizes to an existing manufacturer → use that spelling (`normalizedMfr`);
  - existing manufacturer with ≥1 part and **zero** SKU overlap with the file → `reason:
    "no-overlap"` ("None of the N SKUs in this file belong to ‹mfr›; pick the right
    manufacturer");
  - any file SKU that exists under a **different** manufacturer → `reason: "foreign-skus"` with up
    to 10 examples ("‹sku› is filed under ‹other›");
  - new manufacturer (no parts) → ok.
- `MAX_CATALOG_IMPORT_BYTES = 1_048_576`; `checkSize(bytes)`.

Catalog page: the manufacturer picker becomes required (the form won't submit empty; server
re-checks); the guard runs before any upsert; failures go through the existing `fail()` →
`importError=` banner (#111) with the guard's message. Effective date: a date input next to the
manufacturer, default today, applied as `pricedAt` to rows whose price changed.

Import hub `catalog` type: per-row `mfr` required (rows without one fail validation in the preview,
with the existing per-row error rendering); the guard runs per manufacturer group in the preview
step and blocks commit on `no-overlap` / `foreign-skus`; an "Effective date" field on the type's
options (default today). Size: the paste/textarea path and the xlsx route enforce 1 MB for the
`catalog` type (the xlsx route keeps 10 MB for other types).

Client side: `<input type="file">` handlers check `file.size` first and show the error inline
without uploading.

## 4. Assemblies (`fixture-assemblies.ts`, `design/assemblies/*`, `design/subassemblies/*`)

- Subassemblies resolve live: `resolveSubassembly(sub, catalog)` computes `cost`/`price` from the
  stored SKUs (`lightEngineSku`, `lensSku`, `options[*].sku`) exactly as `saveFixtureAction`
  does today; the saved numbers stay on the record as `snapshot: { cost, price, pricedAt }` for
  "was ‹$› when built". Every consumer of a subassembly's `cost`/`price` (find them by grepping
  `lightEngineCost` / `lensCost` / `options[*].cost` readers — `subassemblies-client.tsx` and any
  estimator fixture path) switches to the resolved value and shows a "prices as of ‹date›" note =
  the newest `effectivePriceDate` among its parts.
- Assemblies: no pricing change; the same "prices as of" note is added to the builder.
- One tab (#130): `/design/assemblies?tab=assemblies|subassemblies` renders both client
  components under a two-button switch (URL param, so deep links and the nav `active` key keep
  working); `/design/subassemblies` becomes a redirect to `/design/assemblies?tab=subassemblies`;
  `nav-data.ts` drops the Subassemblies entry and `activeKeyFor` maps the old path.

## 5. Testing

- `test:specs`: `effectivePriceDate` precedence; `isOutdated` at 17/18/19 months; `mfrKey`
  equivalences; `checkManufacturer` for missing / normalized / no-overlap / foreign-skus / new;
  `checkSize` at the boundary; `priceBooks()` outdated + unknown flags on a fixture catalog;
  `resolveSubassembly` equals the legacy save-time formula on a fixture.
- `test:review:regressions`: an import whose price didn't change leaves `pricedAt` alone; one whose
  price changed stamps the effective date; `setPriceListEffectiveAction` round-trips; the catalog
  page action rejects an over-size upload and a wrong manufacturer with the right `importError`.
- `test:smoke`: `/catalog`, `/design/assemblies`, `/design/assemblies?tab=subassemblies`,
  `/design/subassemblies` (redirect) 200/3xx.
- Browser pass: banner shows an outdated manufacturer, editing its date clears it; import with the
  wrong manufacturer is rejected with the SKU list; a 2 MB CSV is refused before upload; a price
  change on a light engine updates the subassembly's shown price; the tab switch works.

## Out of scope

- A manufacturers table (still free text + normalization; the Vendors module adds aliases).
- Price history per part (only the current effective date).
- Changing how the estimator prices lines.
