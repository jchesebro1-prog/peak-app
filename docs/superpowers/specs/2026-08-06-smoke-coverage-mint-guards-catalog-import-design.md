# Design: dynamic-route smoke coverage, mint-throw guards, Excel catalog import

**Date:** 2026-08-06
**Punch items:** #79, #80, #81
**Branch:** `punch-60-67-defect-cluster`

## Context

Three logged-but-unbuilt engineering items, picked up together at Jeff's request
("tackle them both and let's start on the excel import stuff"). #74
(transactions) was investigated and deliberately not built (see its punch
entry) — it needs no code and is not part of this spec.

---

## 1. #79 — smoke test coverage for dynamic `[id]` routes

**Problem:** `scripts/smoke-routes.ts` (`npm run test:smoke`) boots `next dev`
against a scratch PGlite datadir and asserts 40 top-level routes return 200.
It covers zero dynamic routes — the Grid editor, the Estimator with a quote
loaded, and every record detail page are unexercised. The `"use server"`
illegal-export bug fixed in #76 lived in `design/grid/[id]/actions.ts` and
would not have been caught by the existing test.

**Design:** after the existing top-level pass boots the app and signs in,
query one seeded id per collection from the scratch DB's demo seed data, then
hit each corresponding detail route:

| Collection | Route |
|---|---|
| quote | `/quotes/<id>`, `/estimator?id=<id>` |
| project | `/projects/<id>` |
| grid design | `/design/grid/<id>` |
| inspection | `/inspections/<id>` |
| flame test | `/flame-tests/<id>` |
| repair job | `/repairs/<id>` |
| customer/company | `/companies/<id>` |
| person | `/people/<id>` |

Ids are discovered at runtime (query one row per collection after boot), not
hardcoded — the scratch datadir reseeds fresh each run, and hardcoding to the
current seed constants (`Q-2041`, `P-3001`, …) would silently stop covering
anything if the seed ever changes shape. Same pass/fail rules as the existing
test: fail on 5xx, 404, landing at `/login` after redirects, or a crash-page
marker.

**Out of scope:** Playwright / interaction testing (Jeff already declined
this in the 2026-08-01 decisions pass) — this stays a "does the route render"
check, same class of test as the existing top-level pass.

---

## 2. #80 — guard `insertWithPrefixedId` at every mint call site

**Problem:** `insertWithPrefixedId` (`src/db/doc-store.ts:284-299`) throws
after 5 failed retries on a persisted id collision. ~14 store modules mint
through it; only `saveQuoteAction` and `convertLeadAction` catch the throw.
Everywhere else it's a raw, unhandled exception from a button press.

**Design:** per the existing recommendation (already agreed, not re-litigated
here) — guard each of the remaining ~12 server actions individually, not
change `insertWithPrefixedId`'s contract to return `null`. Each guarded
action wraps its mint call in try/catch and returns the same typed failure
shape (`{ok: false, error: string}` or equivalent, matching whatever shape
that action already uses for its other failure paths) instead of letting the
exception escape. `insertWithPrefixedId` itself is unchanged — it still
throws; only the callers change.

Do NOT make it return `null` on exhaustion — that would silently reintroduce
the class of bug #62 was built to stop (a mint failure disappearing instead
of surfacing).

**Site inventory (to guard):** every store module that mints via
`insertWithPrefixedId` other than the two already-guarded call sites —
projects, designs, tasks, notes, surveys, inspections, repair jobs, flame
jobs, grid projects, engagements, comms, site visits — traced up to whichever
server action(s) call each store's create function. Exact list confirmed at
implementation time via `grep insertWithPrefixedId` cross-referenced against
`grep -r "from \"@/lib/stores/<x>\"" src/app/**/actions.ts`.

**Out of scope:** transactions/rollback of partial state (#74 — investigated,
deliberately not built). This item only makes the failure loud and typed
instead of a raw 500; it does not undo any writes that happened before the
mint that failed.

---

## 3. #81 — Excel catalog import

**Problem:** the `/import` hub has 8 types, none of them `catalog`. The hub
is paste-only (CSV/TSV text into a textarea); nothing in the app reads
`.xlsx`. The real catalog-loading path today is CLI-only
(`import-catalog.ts`, `import-dealer-sheets.ts`, `convert-dealer-sheets.py`),
a separate one-time-migration mechanism unrelated to the hub's UI.

**Decisions (confirmed with Jeff 2026-08-06):**
1. Real `.xlsx` upload, not a "save as CSV first" workaround.
2. Ships as a new `catalog` type in the `/import` hub, consistent with every
   other collection — not an extension of the CLI scripts.

### Architecture

**Parsing library:** `xlsx` (SheetJS community edition, MIT). Read-only
need; parses an `ArrayBuffer` client-side, so it fits the existing
architecture where CSV parsing happens in the browser for live preview and
only the commit crosses into a server action.

**New UI — file input alongside paste.** `parse.ts`'s docblock currently
says the prototype's `.xlsx` branch was "intentionally dropped... real
uploads feed the same paste path" — that was last session's call under the
CSV-only assumption; this design supersedes it now that Jeff has asked for
real `.xlsx` support. The import screen (`page.tsx`) gets a file-drop /
`<input type="file" accept=".xlsx">` control next to the existing textarea.
An uploaded file is parsed via `xlsx` into the *same* `ParsedTable` shape
(`headers: string[]`, `rows: string[][]`, `objects: Record<string,string>[]`)
that `parseCsv()` already produces — every downstream step (column
auto-mapping preview, field mapping UI, commit) is shared code, unchanged.
Only sheet 1 of the workbook is read for this general-purpose importer (the
multi-tab, multi-format handling in `convert-dealer-sheets.py` stays there —
see Scope boundary below).

**New type definition (`types.ts`).** `CatalogPart`'s fields, mapped with
`aliases` the same way `customers`/`leads` are:

| key | header | required | aliases (examples) |
|---|---|---|---|
| `sku` | SKU | yes | sku, part number, part #, model |
| `desc` | Description | | description, item description, product name |
| `category` | Category | | category, family, group, type |
| `unit` | Unit | | unit, uom, u/m |
| `list` | List Price | | list, list price, msrp, retail |
| `cost` | Cost | | cost, dealer, dealer price, net, wholesale |
| `mfr` | Manufacturer | | mfr, manufacturer, brand, mfg |

Dedupe key: `sku` (the natural key `CatalogPart` already uses as its
document id — same as every other catalog write path).

**New writer (`registry.ts`).** Dedupe/write logic delegates to the
existing `mergeUpsert(sku, part)` in `catalog.ts` — no new store logic. This
mirrors what `import-catalog.ts` already does, just reached through the hub
instead of a terminal.

### Error handling

- Rows missing the required `sku` field are skipped and counted, same as
  every other import type's existing skip/error accounting — no new error
  UI needed.
- `list`/`cost` parse through the same numeric coercion the other numeric
  fields (`value` on leads, `curtains`/`passed` on flame tests) already use;
  unparseable values become 0, not a hard failure, consistent with the
  existing importer's tolerance for messy source data.
- No price-plausibility heuristics (swapped columns, fused cells, headerless
  sheets) — that sophistication lives in `convert-dealer-sheets.py` for the
  52-brand migration and is explicitly out of scope here (see below).

### Scope boundary

This is the general one-sheet-at-a-time importer for the `/import` hub — the
same tool a user would reach for to import one vendor's price list, same as
they'd import one spreadsheet of customers or leads today. It is **not**
a replacement for `convert-dealer-sheets.py`, which handles 52 brands' worth
of wildly inconsistent, often headerless, sometimes-PDF-converted sheets for
the one-time #39 catalog build-out. That script keeps doing that job
separately; this item does not touch it.

### Testing

- Extend `test:specs` with a fixture `.xlsx` (a handful of rows, standard
  headers) asserting it parses to the expected `ParsedTable` and that
  required-field / numeric-coercion behavior matches the CSV path.
- `test:smoke` doesn't apply here — it asserts routes return 200 on GET, and
  file upload isn't a route-GET concern. The fixture test above is the
  verification for this item.
