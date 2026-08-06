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

**Corrections to the first draft of this section (verified 2026-08-06 against
the actual route tree):**

- **`/quotes/[id]`, `/flame-tests/[id]` and `/repairs/[id]` do not exist.**
  Those are list-only screens; a quote is opened in the Estimator via
  `/estimator?id=…`. The full dynamic-route inventory under `src/app/(app)`
  is: `companies/[id]`, `consulting/[id]`, `consulting/spec/[id]`,
  `customers/[id]`, `design/engagements/[id]`,
  `design/engagements/spec/[id]`, `design/grid/[id]`, `field-survey/[id]`,
  `inspections/[id]`, `people/[id]`, `projects/[id]`, `venues/[id]`.
- **Runtime id discovery by querying the DB is not possible.** PGlite is
  single-writer/single-process; the smoke-test process cannot open the
  scratch datadir while `next dev` holds it. Use the alternative #79 itself
  named — assert against the seed constants directly. This is safe *because*
  every one of these routes calls `notFound()` on an unknown id, producing a
  real 404 that the existing `looksLikeErrorPage` already fails on. A seed
  id that drifts therefore fails loudly rather than silently covering
  nothing.

**Design:** after the existing top-level pass boots the app and signs in, hit
each detail route using its seeded id:

| Route | Id | Source |
|---|---|---|
| `/projects/<id>` | `P-3001` | `seeds/projects.ts` |
| `/inspections/<id>` | `RI-2042` | `seeds/inspections.ts` |
| `/field-survey/<id>` | `FS-1055` | `seeds/surveys.ts` |
| `/companies/<id>` | `lakefront` | `seeds/customers.ts` (company id = customer doc id) |
| `/customers/<id>` | `lakefront` | redirects to `/companies/lakefront` |
| `/venues/<id>` | `st-lakefront-1` | `identity/convert.ts` — deterministic `st-${docId}-${n}` |
| `/people/<id>` | `ct-lakefront-1` | `identity/convert.ts` — deterministic `ct-${docId}-${m}` |
| `/estimator?id=<id>` | `Q-2041` | `seeds/quotes.ts` |
| `/design/grid/<id>` | `GRD-5001` | new seed — see below |
| `/design/engagements/<id>` | `CE-<n>` | new seed — see below |

Same pass/fail rules as the existing test: fail on 5xx, 404, landing at
`/login` after redirects, or a crash-page marker.

**The Grid problem, and why it needs new seed data.** `design/grid/[id]`
does *not* call `notFound()` on an unknown id — it renders a friendly 200
*"That design no longer exists."* page and never mounts `GridEditor`. So
pointing the smoke test at a made-up grid id would **pass while compiling
none of the editor's client bundle** — exactly the false-green #79 exists to
eliminate, on the single highest-value target in the item (#76's
`"use server"` illegal-export bug lived in `design/grid/[id]/actions.ts`,
which the editor imports). `grid_projects` and `consulting_engagements` have
no demo seed at all — they are not in `DEMO_SEEDS`.

**Decision (Jeff, 2026-08-06): add demo seed records.** One grid project and
one consulting engagement join `DEMO_SEEDS`, making both routes genuinely
reachable — and giving local dev a Grid example it currently lacks. Demo data
is wiped by the #59 go-live reset, so this adds nothing a real deployment
keeps.

**Assert on content, not just status.** Because the Grid route can return 200
without rendering the editor, its check additionally asserts the response
body does *not* contain "no longer exists". Status alone is not a sufficient
signal for this one route.

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

**Site inventory — traced and verified 2026-08-06** (not "to be confirmed at
implementation time"):

| # | Call site | Mints |
|---|---|---|
| 1 | `design/grid/actions.ts:19` | grid project |
| 2 | `design/quick/actions.ts:48` | design |
| 3 | `field-work/actions.ts:38` | task |
| 4 | `projects/actions.ts:175` | task |
| 5 | `companies/actions.ts:183` | note |
| 6 | `inbox/site-visit-actions.ts:62` | site visit |
| 7 | `inbox/actions.ts:452` | comm thread |
| 8 | `inspections/actions.ts:23` | inspection |
| 9 | `field-survey/actions.ts:18` | survey |
| 10 | `leads/actions.ts:207` | lead |
| 11 | `src/app/api/leads/intake/route.ts:73` | lead (public intake route) |

**Already guarded, leave alone:** `estimator/actions.ts:129`
(`saveQuoteAction`) and `convertLeadAction` in `leads/actions.ts`.

**Discovered and explicitly OUT of scope — `import/registry.ts`.** Its ~7
mint calls (`Quotes.create`, `Leads.create`, `Surveys.create`,
`Inspections.create`, `Flame.create`, `Projects.createProject`, …) are
already covered: `commitImport` wraps every row in try/catch and converts a
throw into `res.errored++`. No change needed there. The original punch entry's
"~14 store modules, only 2 guarded" framing counted store modules, not
reachable unguarded call sites; the real number is the 11 above.

**Also noted, NOT fixed here:** `syncFromQuotes` (flame), `syncProjectsFromQuotes`
(projects) and `syncEngagementsFromQuotes` mint from *page-load sync
functions*, not server actions — a throw there breaks a page render rather
than a button press, and the fix shape is different (a page can't return a
typed failure). Logged as a follow-up rather than silently half-addressed.

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

**Parsing library — `exceljs` 4.4.0, NOT `xlsx`/SheetJS.** The obvious
choice, SheetJS, is **abandoned on npm**: `xlsx@0.18.5` (published
2022-03-24) is the newest version the registry has, because SheetJS moved
distribution to their own CDN. That npm copy never received the fix for
CVE-2023-30533 (prototype pollution, high severity, patched in 0.19.3+,
which is not on npm). Adding it would put a known-unpatched advisory in the
dependency tree of an app heading toward real customer data.
`exceljs` is MIT, on npm, maintained, and carries no equivalent advisory.
**Decision (Jeff, 2026-08-06): exceljs, parsed server-side.**

**Architecture — server-side parse, CSV back into the existing flow.**
`exceljs` runs in Node, where it needs no browser polyfills and costs the
client bundle nothing. The flow:

1. The import screen gets `<input type="file" accept=".xlsx,.xls">`
   alongside the existing textarea.
2. Picking a file POSTs it to a new route handler, `POST /api/import/xlsx`,
   which parses sheet 1 with `exceljs` and returns the rows as **CSV text**.
3. The client drops that CSV into the existing `text` state — the same state
   the textarea binds to.
4. **Everything downstream is untouched.** Live preview, column auto-mapping,
   the stats pills, the confirm button, and the authoritative server-side
   re-parse in `importRecords` all run exactly as they do for pasted CSV.

This is deliberately the smallest possible change: `parse.ts`, `actions.ts`
and the commit path need no modification at all, and the user sees their
spreadsheet arrive as reviewable rows rather than an opaque "file attached"
state. `parse.ts`'s docblock (which says the `.xlsx` branch was
"intentionally dropped… real uploads feed the same paste path") stays
literally true — uploads still feed the paste path; they just get converted
on the way in now.

Only sheet 1 of the workbook is read (the multi-tab, per-vendor heuristics in
`convert-dealer-sheets.py` stay there — see Scope boundary below).

**Route handler auth:** `POST /api/import/xlsx` gates on the same
`requirePerm("manage_users")` that `importRecords` already uses. It only
converts a file to text — it writes nothing — but it must not be an open
parser endpoint.

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
  headers) asserting the sheet→CSV conversion produces the expected text, and
  that feeding that text through `parseCsv` → `autoMap` → `prepareRows`
  against the new `catalog` field set yields the expected mapped values,
  required-field enforcement, and numeric coercion.
- The fixture `.xlsx` is generated by the test itself via `exceljs` (write a
  workbook in memory, read it back), so no binary file is committed to the
  repo and the round-trip is what's actually verified.
- `test:smoke` doesn't apply here — it asserts routes return 200 on GET, and
  file upload isn't a route-GET concern. The fixture test above is the
  verification for this item.
