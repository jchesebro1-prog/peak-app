# Estimator sample zip — design

Date: 2026-10-27 · Builds on: `2026-10-20-estimator-handoff-package-design.md` (PR 1 #359, PR 2 #361)

## 1. What changes and why

Jeff, Oct 27: the standalone Estimator should be **a downloaded zip with sample example data and
nothing else**. The catalog must work the same way as the app, and so must the auto estimators: the
in-Estimator configurators and the flame test, repair and inspection quote builders.

PR 2 (#361) already builds a working, double-click `index.html` prototype of the Estimator, Catalog,
Assemblies and Estimating Rules from the real client code. It was designed around real production
data, though. It shipped a 28-day recent sample of real estimates with real costs and names under a
CONFIDENTIAL notice, it cut the catalog down to the parts on those estimates, and it left out the
service builders.

| Question | Answer (Jeff, Oct 27) |
|---|---|
| Relation to the real-data build | **Replaces it.** One build, sample data only |
| Auto estimators | In-Estimator configurators **and** the flame / repair / inspection builders |
| Service depth | All three: quote builder + proposal letter. No schedulers, results, renewals or jobs |
| Catalog | A **made-up** sample catalog that behaves like the real one |
| Pricing rules | **Real**: Peak's current Estimating Rules values |
| Branding | Peak, as today |
| Approach | Seed invented data through the real stores into a scratch DB, then the existing pipeline |

### Non-goals

- No change to how Quartzite behaves. The only app change is a pure code move (§3), as in PR 1.
- No real records of any kind: customers, contacts, staff, parts, estimates, photos.
- No service-side workflow: Approve → job/record spawn, schedulers, results, reports, renewals,
  portal and email all show the existing "Not part of the prototype" notice.
- No hosting, no network, no install. The zip runs from `file://`.

## 2. What the zip holds

`output/peak-estimator-sample.zip` → `peak-estimator-sample/`:

```
index.html             double-click to open
app/                   the bundled real client code + estimating-core.js
data/*.js              the sample data (meta, catalog-N, customers, estimates, fixtures, rules, team)
spec/                  the readable spec + the engine's source (as PR 2)
README.md              what it is, how to run it, "the data is invented; the pricing rules are Peak's"
```

Gone compared with PR 2: `CONFIDENTIAL.txt`, real photos, `--recent-days` and the production
runbook steps for records and photos.

### Sample fixture

One committed source of truth: `handoff/estimator/sample/` (TypeScript data modules, typed against the
app's own record types so `tsc` catches drift).

- **Team:** 4 invented staff (an admin/approver, two estimators, one field lead). No real names.
- **Customers:** about 8 invented companies, each with contacts and 1–2 venues, 12 venues in all.
  Every venue carries a fixed address plus `travelMiles` / `travelMin`, so travel (drive vs. fly,
  #208) prices with no geocoding or network. The venues are spread so that at least one quote flies,
  and each one is "verified" so it reads like a normal venue.
- **Catalog:** about 300 invented parts across the real category list and real manufacturer names,
  with invented model numbers, costs and list prices. It includes every part a configurator or rule
  needs: fabric parts (with oz and flame rating), the parts each track series maps, Labor parts,
  rack-data gear (RU, depth, weight, watts), and parts for each system category's typical items.
  Photos use the app's placeholder fallback (#297). No image files ship.
- **Assemblies:** about 10 — fixtures, a System, a Hardware kit and one rack.
- **System estimates:** about 6 that exercise the Estimator: curtains with track, an assembly line,
  a rack line, system groups, an alternate group, a package document with key products, a box goods
  sale, and the hidden bonus lines. They span draft, submitted, approved and sent.
- **Service quotes:** 2 flame tests, 2 repairs, 2 inspections (one L1, one L2). One of them is
  multi-venue and one flies.

### Real rules

The rules are the settings blobs and fields the slicer already allow-lists: markup tiers, labor rates,
estimating rules, service rates, travel and fly allowances, the $25 rounding settings, curtain mounts,
system categories, track series and sewing %. They come from `handoff/estimator/sample/rules.json`.

- `npm run handoff:rules -- --in <export.json>` writes that file from a `db:export`, reading
  **settings and blobs only**. Records in the export are ignored, and the file is checked so that it
  holds only allow-listed keys. Jeff runs this once against production. The file is committed.
- Until it exists, `handoff:sample` reads the same keys from the app's code defaults and seeds. The
  build prints `rules: production capture <date>` or `rules: code defaults`, and the README says which.
- The rules file holds no SKU that isn't in the sample catalog. Any rule that names a SKU (system
  category items, track series parts, curtain mount hardware) is re-pointed to the sample part that
  stands in for it, through a map kept in the fixture. A real SKU left over fails the build.

## 3. Service engines into the core (PR 1)

`flametest-engine.ts`, `repair-engine.ts` and `inspection-engine.ts` mix pricing with settings I/O
(`updateBlob`, rate loaders). As in PR 1:

- The pure pricing (`price…`, totals, $25 rounding, typed-total back-solve, travel application) moves
  to `src/lib/estimating-core/`, along with `travel-plan.ts` and the pure venue-input half of
  `service-quote-inputs.ts`.
- The old paths keep their loaders and re-export the moved code (`export *` shims). The MOVED_TO_CORE
  pin grows to cover the new files.
- `core:check` holds the moved files to the no-server rule.
- The gate shows no behaviour change: tsc, test:specs, test:smoke, eslint and next build all pass,
  and the existing service-pricing specs pass unchanged.

## 4. The prototype (PR 2)

### Service builders

- The real builders (`src/app/(app)/{flame-tests,repairs,inspections}/quote/controls.tsx`) and letters
  (`…/letter/letter-view.tsx`) are bundled unchanged and listed in `port-sources.json`, so the drift
  guard watches them.
- Their server actions become in-browser actions in `runtime/actions/` that call the core engines:
  save, recompute, the markup knob, the typed total, the Auto · Drive · Fly travel override with crew /
  nights / airfare, venue pick and counts, and status changes short of Approve. Approve and every
  spawn-a-job path refuse with "Not part of the prototype".
- Saves go to the same IndexedDB overlay as estimates (keyed by snapshot), so Reset restores the sample.
- Routes: `#/flame/<id>`, `#/repair/<id>`, `#/inspection/<id>`, each with `/letter` and `/new`.
- The letter prints from the browser the same way the prototype's estimate document does.

### Navigation

- The Estimates list shows every quote type with its type badge and links to the right builder.
- "+ New quote" offers System estimate, Box goods sale, Flame test, Repair and Inspection.

### Catalog

The full sample catalog loads: no `selectCatalogScope` cut. Browse, search (Model # and former SKUs
included), facets, the part editor and add-to-estimate all work as in the app. Uploads, the ETC sync,
Drive photos and Datasheets fetch stay out, as in PR 2.

## 5. Building it

`npm run handoff:sample` does all of this in order:

1. Makes a fresh throwaway PGlite datadir in the scratchpad or tmp. **Never `.data/pglite`**, which
   keeps the single-process rule in AGENTS.md. It refuses to run when `DATABASE_URL` is set.
2. Migrates it, then loads the fixture **through the real stores** (the same write paths the app
   uses, so hydration, `pricingBasis` stamping and the markup conversion apply), plus `rules.json`.
3. Saves each system estimate and service quote through the store-level save functions the builders'
   server actions call (no session or HTTP), so every stored total is the app's own number.
4. Runs `db:export` on that datadir.
5. Runs the slicer in a new `--sample` mode: every record in the export, full catalog, no recency
   window. The allow-lists and secret scan are unchanged.
6. Builds and zips to `output/peak-estimator-sample.zip`, then deletes the scratch datadir, even on
   failure.

### Nothing real can leak

- **Fixture-only check:** every id in the packaged data (users, companies, contacts, sites, parts,
  assemblies, quotes) must appear in the fixture. Any other id fails the build, and nothing is written.
- **Real-SKU check:** no packaged SKU may appear outside the fixture's catalog (covers rules).
- The pipeline never opens the dev or production database for records. Only `handoff:rules` reads an
  export, and only its settings.

## 6. Checks

- **Goldens:** `core:golden` runs over the scratch export and includes service quotes. The bundled
  prototype must reproduce every estimate and service quote total to the cent (`handoff:verify`).
- **Browser check** (`handoff:verify --serve` and from `file://`): opens the zip, then one estimate of
  each kind through all four steps, the catalog search and part editor, each configurator (curtain,
  track, fixture, labor, Add a system category), each service builder (change a count, flip travel to
  Fly, type a total) and each letter. Then Reset.
- **Drift guard** covers the newly ported files.
- **Gate:** tsc, test:specs, test:smoke, eslint, next build. Real numbers get reported.

## 7. Remaining after build

- Jeff (optional): run `handoff:rules` against a production `db:export` and commit `rules.json`, so
  the rule values match today's Settings exactly. Until then the zip prices with code-default rules,
  and the README says so.
- Jeff: decide when PR 1 and PR 2 merge. Nothing reaches main before that.
