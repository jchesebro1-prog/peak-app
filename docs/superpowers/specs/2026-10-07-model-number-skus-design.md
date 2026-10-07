# Model-number SKUs (#302) — design

**Date:** 2026-10-07 · **Punch item:** #302 · **Status:** approved by Jeff in chat

## Problem

Biamp, EAW, Meyer Sound and Symetrix parts are in the catalog under their
**order numbers** (`80-0043`, `901.0302`, `0008955-90`, `09.084.001.07`): that
string is the SKU, the doc id, and usually the MFR P/N. Nobody knows those
numbers. Everyone knows the **model** (`Jupiter 4`, `Tesira SIC-4`,
`RSX218`, `UPM-1P`). The catalog already has a Model # field
(`manufacturerModelNumber`, "MFR M/N" in the part editor). However, almost no
search, picker or document reads it.

Jeff's rule (2026-10-07): **the easier-to-remember value is always the model
number.** Replace the SKU with the model, keep the old number searchable,
and have estimates show only Model #s.

## Decisions (Jeff, in chat)

1. **The SKU itself is replaced** (not just the display). New SKU = `Brand:Model`,
   e.g. `Symetrix:Jupiter 4`. This is the same shape as the Import hub's
   `ETC:S4LED-S2` and can't collide across brands.
2. **The old number stays searchable** everywhere a part is searched.
3. **Customer documents print the Model # only**, never the order number.
   Staff screens lead with the model and show the order # beside it.
4. **Data:** ChatGPT's filled crosswalk sheets
   (`output/Peak model number crosswalk - <Mfr> filled <date>.xlsx`, sheet
   "Crosswalk") are the source. Symetrix is done (88/89). Biamp, EAW and Meyer
   load through the same tool when their sheets arrive. My unconfirmed Biamp
   pre-fills do not load until they are confirmed.

## Approach

A **real rename with a one-time reference rewrite**, plus a read-time
redirect for frozen history. The alternative, an alias layer that translates at
~60 read sites, was rejected: every future feature would have to know about
it.

## 1. Data model (JSONB, no migration)

On `CatalogPart`:

- `formerSkus?: string[]`: every SKU this part has had. Searchable, and
  importers match on it.
- `renamedTo?: string`: set **only on the retired (soft-deleted) old doc**.
  It points at the new SKU.

On a rename, the new doc is a copy of the old one with:

- `id = sku = newSku`
- `manufacturerModelNumber = model`
- `manufacturerPartNumber = old.manufacturerPartNumber || oldSku`, so the
  order # survives for price lists, photo/spec matching and the staff label
- `formerSkus = dedupe([...old.formerSkus, oldSku])`
- `pricedAt`, documents, ports, rack data, narrative, spec fields: all carried
  verbatim (a direct doc write, not `writePart`, so `pricedAt` is never
  re-stamped)

The old doc gets `renamedTo = newSku` and is then soft-deleted.

A blob `catalog_sku_renames` (`{ renames: [{ from, to, at, by }] }`) is
both the audit log and the **rename map** the reference passes read.

## 2. SKU rule — `src/lib/catalog-rename/sku.ts` (pure)

`modelSku(mfr, model)`:

- trim and collapse whitespace in both
- replace `/ \ # ? %` and control characters in the model with `-`
- join as `${mfr}:${model}`
- `null` when either part is blank or the result is over **60 chars** (the
  tightest SKU cap elsewhere in the app is wire types at 60)

The Model # field keeps the manufacturer's exact spelling. Only the SKU is
sanitized.

## 3. The plan — `src/lib/catalog-rename/plan.ts` (pure)

Input: crosswalk rows (`Manufacturer`, `MFR Part # (order number)` / `MFR
Part #` / `MFR P/N`, `SKU`, `Model #`, `Notes`, matched by header,
case-insensitive) and the catalog. Each row resolves to exactly one outcome:

| Outcome | When |
|---|---|
| `rename` | SKU found live, model present, new SKU free, not a duplicate |
| `already` | the part at `SKU` is already retired with `renamedTo` equal to the new SKU, or the live part's `formerSkus` holds `SKU` and its SKU equals the new SKU |
| `skip:no-model` | Model # blank (covers `accessory: no model name`, `not found`, `unsure`) |
| `skip:not-found` | no live part at `SKU` |
| `skip:mfr-mismatch` | the part's `mfr` (by `mfrKey`) ≠ the row's Manufacturer |
| `skip:bad-model` | `modelSku` returns null |
| `skip:taken` | the new SKU (case-insensitive) is a live part that isn't this one, or another rename's former SKU |
| `skip:duplicate` | two or more rows produce the same new SKU (case-insensitive). **All** of them are skipped and listed together, since the variants need distinct models |
| `skip:same` | new SKU equals the current SKU |

The plan reports counts per outcome, per-row reasons, and the rename map.

## 4. Apply — server, batched, resumable, idempotent

`src/lib/catalog-rename/apply.ts`. Each server-action call works under the
shared 45 s budget (`FETCH_ACTION_BUDGET_MS`) and returns
`{ complete, step, done }`. The client loops until `complete`.

1. **Parts step.** For each `rename` row (re-planned server-side, never
   trusting client rows): write the new part, retire the old one, append to
   `catalog_sku_renames`. A row whose new SKU appeared since planning is
   skipped as `taken`.
2. **Reference steps.** One pass per area, each over the **whole** rename
   map from the blob (so a re-run fixes stragglers and later renames). Each
   pass writes only docs that actually change. Live data only:
   - `catalog_parts`: `specSameAs`, `productMetadata.accessories[].sku`
   - `part_document_links`, `part_accessory_links`: re-created under the
     new SKU (their ids hash the SKU), keeping order/primary, with old rows
     soft-deleted
   - `quotes` (live `spec`, **not** `revisions`): section items `sku`,
     `components[].sku`, `fixtureOptions` keys `slot:sku`,
     `curtainInputs.fabricSku`, `keyProducts[].sku`
   - `projects.procurement[].sku`, `portal_carts` lines (same fields as
     quote items), `spec_documents.products[].sku`
   - `subassemblies`: fixture `lightEngineSku`, `lensSku`, `lines.*[].sku`,
     `parts[].sku`; rack `placements[].sku`
   - `grid_catalog`: a symbol whose id or `pricingPartId` is a former SKU
     moves to the new id (`modelNumber` = model). `members[].symbolId` is
     rewritten.
   - `grid_projects` (live fields, **not** `revisions`): placements
     `partId` and `curtain.fabricSku`, routes `partId`, riser links
     `partId`, option accessories `partId`, auto-estimate overrides `sku`
   - blobs: `grid_equipment_map`, `track_series`, `curtain_mounts`,
     `rack_defaults`, every `gridFavorites:*` / `gridRecent:*`,
     `drive_photo_sync`; `app_settings.wireTypes[].cableSku`
3. **Frozen, by design:** quote revisions (sent copies), Grid revisions,
   `generated_specs`, `spec_record_revisions`, the legacy
   `settings.fixtureAssemblies` backup. They keep old SKUs and resolve through §5.

## 5. Old SKUs keep resolving

- `catalog.get(sku)`: a missing or retired doc with `renamedTo` follows it
  (≤ 8 hops, cycle-safe) and returns the live part.
- `getMany` / `getManyAnyCase` do the same for their misses.
- New `getManyBySku(skus): Map<requestedSku, CatalogPart>` is for callers
  that key results by the SKU they asked for. The frozen-revision readers
  (sent-revision package/online estimate, its photos and datasheets, the
  `/share` and `/portal/quotes` pages, cut sheets, the Displays API
  `[sku]` routes, `/catalog?edit=`, `/api/part-datasheet/[sku]`) use it
  or get. They then find photos and documents by the **resolved** SKU.

## 6. Search and display

- One pure `partSearchHaystack(part)`: SKU, desc, mfr, MFR P/N, Model #,
  former SKUs. It's used by the catalog page search, Estimator add-part,
  ⌘K, Assembly Builder picker, Equipment map picker, portal search,
  Datasheets search and the Grid library.
- `partModel(part)` = Model # → MFR P/N → SKU after any `Brand:` prefix →
  SKU. **Every customer document prints `partModel`, never the SKU or order
  #.** This covers the estimate PDF and customer preview, the cover, the
  package page and BOM, the online estimate, narrative, cut sheets, rack
  submittal, drawing-set schedules, the portal catalog / cart, the spec Word
  model column and the parts CSV.
- Staff rows (catalog list, Estimator picker, ⌘K) show
  **`Jupiter 4 · 80-0043`**: `partModel` first, then the MFR P/N when it
  differs.

## 7. Importers

Both catalog importers (`catalog/import.ts`, Import hub `registry.ts`)
resolve an incoming row to an existing live part in this order:

1. exact SKU
2. a part whose `formerSkus` holds it
3. a renamed part (via `catalog_sku_renames`)
4. the **unique** live part of the same manufacturer (`mfrKey`) whose MFR P/N
   equals the row's SKU or MFR P/N (punctuation-insensitive)

The row is then merged into **that** part's SKU. A soft-deleted old SKU is
never revived. The manufacturer import guard counts those matches as overlap.
So next year's Biamp price list (keyed by order number) updates the renamed
parts instead of creating duplicates or being refused.

## 8. UI — Catalog → Model numbers (`/catalog/model-numbers`, admin)

- `requirePerm("manage_users")`; linked from the catalog page's admin tools.
- Upload `.xlsx`/`.csv` → **Preview**:
  - outcome counts
  - a table of `old SKU → new SKU` with the model
  - skipped rows with reasons
- A backup note: run `npm run db:export` against production first.
- **Apply** runs the batches with progress. A **Fix references** button
  re-runs the reference steps alone, which is safe any time.
- Every sheet value is untrusted: strings are capped, rows are capped at
  5,000, and the sheet is capped at 800 KB (same caps as the photo sheet).

## 9. Testing

`test:specs` adds checks for:

- `modelSku` and the planner outcomes
- the DB apply on fixtures: a part with docs, an accessory link, a fixture,
  an open quote with a sent revision, a Grid placement, the Equipment map,
  a favorite
- the redirect, including `getManyBySku` on a frozen revision's SKU
- importer matching by former SKU and by order #, with no revive and no
  duplicate
- `partModel` on customer docs

Plus a dry run against a copy of the local DB, which has the real book. The
four gates (tsc, test:specs, test:smoke, eslint vs baseline) and
`next build` also run.

## Not in scope

- Renaming parts of other brands. The tool works for any manufacturer's
  sheet, but only these four are planned.
- Changing the SKU automatically when someone edits Model # in the part
  editor. The tool is the one rename path.
- Rewriting frozen history.
