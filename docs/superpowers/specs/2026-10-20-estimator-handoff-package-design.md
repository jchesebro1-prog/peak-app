# Estimator handoff package — design

**Date:** 2026-10-20 · **Status:** approved in brainstorm, awaiting spec review
**Asked by:** Jeff — *"I ultimately feel it is in a pretty good place that I can share the HTML with
our founder for him to implement into his software."*

## 1. Goal

Give the founder a self-contained, **fully working HTML prototype** of Peak's estimating software
plus a written spec. With it, the founder can rebuild the estimator inside their own software without
access to this repo, its database or its hosting. This is the same kind of package Quartzite itself
was built from: a prototype whose JS modules are authoritative for field names, lifecycles and
pricing math.

This is **a handoff, not multi-tenancy.** Punch item #57 (multi-tenant groundwork) stays "NOT NOW".
Nothing here adds an org concept to Quartzite.

### Decisions taken in the brainstorm

| Question | Answer |
|---|---|
| Deliverable | HTML prototype + written spec |
| Scope | Estimator core, Catalog + assemblies, Client output |
| Out of scope | Grid designer, Specs builder (and everything non-estimating) |
| Fidelity | Fully working in the browser; the bundled engine is the reference |
| Data | Real Peak data |
| Data source | A one-time production export (`npm run db:export` against `DATABASE_URL`) |
| Branding | Peak as-is: baked letterhead, Chicago time, Peak copy |
| Approach | A: extract the real pricing engine into `src/lib/estimating-core/`, bundle it, and build a lean client-only UI on top |

### Non-goals

- No change to how Quartzite behaves. The only change in this app is a pure code move (§3).
- No company-configurable settings, no rebranding, no tenant model.
- Not included: service quotes (flame / repair / inspection / rental / consulting), portal, Grid,
  Specs, Gmail / Inbox, Assist / Ask AI, tasks, triage, calendar, projects, Daylite import.
- No hosting. The package runs from `file://`.
- Claude never sends the package anywhere. Jeff decides how it reaches the founder.

## 2. What the founder receives

One zipped folder, `peak-estimator-handoff/`. You open it by double-clicking `index.html`; there is
no server, install or network.

```
peak-estimator-handoff/
  index.html                 the working prototype (Peak-branded, as-is)
  app/
    estimating-core.js       the real pricing engine, bundled unchanged from src/lib/estimating-core
    prototype.js             client-only UI: screens, local store, fake ports
    ports.js                 the seams to the founder's own system, with fake implementations
    prototype.css            compiled from Quartzite's Tailwind + pk-* styles
  data/
    catalog.js               production catalog parts (estimator-read fields only)
    rules.js                 Estimating Rules, rates, tiers, fixtures/assemblies, racks,
                             track series, fabrics, curtain mounts, system categories
    estimates.js             real production system estimates (§5)
    customers.js             only the companies / venues / contacts those estimates reference
    team.js                  staff names + roles
  images/                    letterhead + primary photo per part on a bundled estimate
  spec/
    README.md                start here: what it is, how to run it, what's real, what's faked
    data-model.md            every quote / system / line / group field, statuses, revisions
    pricing.md               every formula in words, each pointing into estimating-core.js
    ports.md                 what the founder must supply (§4)
    golden/*.json            per estimate: input → expected totals, to the cent
    screenshots/             the real app's screens, for pixel reference
```

Data files are plain `<script>` files that set globals (`window.PEAK_CATALOG = …`), because
`fetch()` of JSON does not work from `file://`.

Edits persist in **IndexedDB**, since the catalog is too large for localStorage. A **Reset to
production snapshot** control wipes the edits. If IndexedDB is unavailable (some private windows),
the prototype still runs and shows a "changes won't be saved" banner.

The README and the zip's top-level `CONFIDENTIAL.txt` mark the package
**Confidential — Peak Systems Group**, because it carries real costs, margins and customer names.

## 3. Engine extraction in Quartzite (its own PR, merged first)

Today the pricing domain lives in a route folder:
- `src/app/(app)/estimator/types.ts` (776 lines; `SpecSection`, `SpecItem`, …)
- `src/app/(app)/estimator/pricing.ts` (1,213 lines; `totals`, `lineExtSellOf`, `systemSellTotal`, `fmt`)
- `estimator-data`

61 files import them there. This step makes the domain a real library.

**Move into `src/lib/estimating-core/`**, with one public `index.ts`:
- `types.ts`, `pricing.ts`, `estimator-data`
- the pure modules they depend on today:
  - curtain pricing and geometry (`lib/design/curtain-pricing`, `curtain-geom`, `curtain-mounts`)
  - track engine and series
  - fixture-assembly resolve (`fixture-assemblies`, `quote-line-members`)
  - rack rules and geometry (`lib/rack/` minus the drag / UI pieces)
  - estimate bonus
  - estimate groups / alternates
  - estimate line move
  - `approval-snapshot`
  - the `service-pricing` rounding helpers (`ceilToStep`, `PRICE_OVERRIDE_MAX`, `typedPriceWarning`)
  - reward credit-line math

  The final list is whatever the purity gate needs to pass. The plan step confirms it.

**Old paths keep working.** Each moved file leaves a one-line `export * from "@/lib/estimating-core/…"`
at its old path, so none of the 61 importers change in this PR. Re-pointing them is optional, later
work.

**Remove store dependencies from the type definitions.** `types.ts` imports types from
`stores/quotes` (`QuoteStatus`, `QuoteReview`), `stores/tasks`, `stores/pricing`, `pipelines`,
`quote-next-step` and similar modules. The core must not import a store, even type-only. Each such
type either moves into the core (with the store re-exporting it) or is replaced by a narrow
structural type with only the fields the core reads.

**Purity gate, `npm run core:check`.** It runs an esbuild bundle of `src/lib/estimating-core/index.ts`
for `platform: "browser"`. It fails if any import resolves to `@/db`, `src/lib/stores/`,
`server-only`, `next/*`, `node:*` or a Node built-in. Its output also feeds the handoff build. It runs
inside `test:specs`.

**No behaviour change.** It must pass the full gate: `tsc`, `test:specs` (base + new PASS count),
`test:smoke`, `eslint` and `next build`. The golden cases (§6) are generated from the real app
**before** the move and re-checked after, and must be identical.

## 4. The prototype app

**Source:** `handoff/estimator/` in this repo.
**Build:** `npm run handoff:build` bundles everything with esbuild into
`output/peak-estimator-handoff/` (gitignored), then zips it to `output/peak-estimator-handoff.zip`.

**UI.** The UI is client-only React. Presentational components from Quartzite are imported directly
when they pass the same purity gate as the core: the quote document, the package view, the rack
elevation, cut-sheet SVGs and the TipTap narrative editor. A component that drags in a server action,
`next/*` or a store gets a slim prototype copy under `handoff/estimator/ui/`; the plan lists which
ones. Server actions become calls into a local store module with the same function names, so a
reader can match the prototype to Quartzite.

**Screens (Peak as-is):**
- **Estimates:** list of the bundled system estimates (number, customer, status, total), plus new estimate.
- **Estimator, four steps on one page (`?step=`):**
  - **Build:** systems, lines, catalog search, groups rail, alternates, mark built, move lines,
    assemblies, curtain and track configurators, the hidden bonus lines, and tiers/margins.
  - **Build package:** Narrative, BOM quote, and Client package choices.
  - **Customer review:** Document, Package page, BOM and Cut sheets tabs, with numbered review comments.
  - **Send & track:** the approval next-step control, status, and simulated send and activity.
- **Catalog:** browse/search across the full catalog, plus the part editor (bundled photos only, no uploads).
- **Assemblies:** fixtures/systems, and racks with the RU elevation.
- **Estimating Rules:** the rate, formula, track series, fabric, curtain mount and system category editors.
- **PDF:** the browser's Print → Save as PDF, using print CSS for the quote document. This replaces
  Quartzite's headless-Chrome renderer; `spec/README.md` says so.

**Ports** (`app/ports.js`, documented in `spec/ports.md`). Each is a small interface the founder
implements in their own software; the prototype ships a fake.

| Port | Contract | Prototype fake |
|---|---|---|
| `customers` | search/get company, venues, contacts; pricing tier; travel distance from office | bundled `customers.js` |
| `users` | current user, `can(perm)`, approvers, lead estimator / prepared-by | role switcher in the header (Peak's 4 roles) |
| `numbering` | next estimate number (`EST-####`) | local counter starting after production's highest |
| `email` | send the estimate PDF to recipients and record it | composer, then "Sent (simulated)" in Activity |
| `onWon` | what happens when an estimate is won (Quartzite: create the install project) | Activity entry "Would create project …" |
| `clock` | now + timezone | real now, fixed `America/Chicago` |

Pipeline stages appear as a fixed list (Peak's current system-quote stages). Service quotes share
Quartzite's `quotes` table; `spec/data-model.md` names that, so the founder knows the prototype only
shows `quoteType: "system"`.

## 5. Production data slice

**Export (Jeff runs once).**
```bash
DATABASE_URL=<prod> OUT=~/peak-prod-export.json npm run db:export
```
The export stays outside the repo.

**Slicer.** `handoff/estimator/slice.ts` (`npm run handoff:slice -- <export.json>`) writes `data/*.js`.
It works from an **allow-list**: only named collections, blob keys and fields are copied, so a field
added to Quartzite later never flows in by accident. It copies:
- **Catalog:** catalog parts (only the fields the estimator reads), fixtures/assemblies/racks
  (`subassemblies`), manufacturers (name, key, image ref), and part-document records for the bundled
  primary photos.
- **Rules:** the named pricing/rule blobs: rates, tiers, fabrics, track series, curtain mounts, system
  categories, estimate-output defaults, review limits, freight rule.
- **Estimates:** quotes with `quoteType: "system"` that are app-era Estimator estimates with at least
  one line and are not deleted. Each carries its notes, review comments, bonus record and revisions.
- **Customers:** only the companies, venues and contacts those estimates reference.
- **Team:** each staff member's name and role. No emails beyond what the quotes already print.

**Never copied:**
- Gmail connections and tokens
- `assist_secrets` or any secret blob
- comms / inbox mail
- service jobs, portal grants and carts, tasks, meetings, assessments
- notification prefs, geo cache

**Safety net.** The slicer fails if its output contains anything shaped like a token, secret, API key
or OAuth credential. The patterns are checked in `slice.ts` and covered by a unit test.

**Photos.** The primary image of each part on a bundled estimate, plus the letterhead, is downloaded
from Blob into `images/` (already WebP ≤ 1600 px). Parts without a photo use Quartzite's placeholder
fallback (`public/placeholders/`). Catalog browse shows the placeholder for parts not on a bundled
estimate.

**Size.** The zip should stay **under 150 MB**. If the full catalog pushes past that, the slicer drops
non-estimator fields first. Dropping parts would come only with Jeff's say-so, and the README would
note it.

## 6. Verification

1. **Golden cases.** Before the §3 move, a script runs Quartzite's own pricing over every bundled
   estimate and writes `spec/golden/<estimate#>.json`: per-system sell, bonus lines, alternates,
   grand total and the printed totals lines. The same script after the move must produce
   byte-identical files.
2. **Bundle parity.** The built `app/estimating-core.js`, loaded in Node, prices every bundled
   estimate and must match the golden files to the cent.
3. **Browser check (headless Chrome).**
   - Open `index.html` from `file://` and open a sample of 20 estimates, including at least one with
     an alternate, a rack, a curtain + track and a bonus. Read each grand total from the page and
     compare it to golden.
   - Add a catalog line, change its quantity, reload, and confirm the edit persisted.
   - Confirm no network request left the page.
4. **Quartzite gate on the §3 PR:** `tsc`, `test:specs` (incl. `core:check`), `test:smoke`, `eslint`,
   `next build`. Real numbers get reported.
5. **Slicer test:** the allow-list and the secret scan are unit-tested on a small synthetic export
   that contains a fake token.

## 7. Delivery and bookkeeping

- `output/peak-estimator-handoff.zip` is handed to Jeff in this app as a file. Claude does not
  upload, email or publish it.
- New DECISIONS entries cover the extraction, the ports and the slice allow-list. A punch item is
  numbered at merge time, recomputed against main right before the docs commit. #57 gets a one-line
  note that this is a handoff, not multi-tenancy.
- An AGENTS.md phase entry is added once the §3 PR merges.

## 8. Build order

1. **PR 1, engine extraction (§3).** Golden generator first, then the move, shims, type
   decoupling, `core:check`, and the full gate. Merged to main on its own.
2. **Slicer (§5)** plus its tests; Jeff runs the production export.
3. **Prototype UI (§4)** on the extracted core, screen by screen.
4. **Spec docs (§2 `spec/`)**, screenshots and the golden set.
5. **Verification (§6)**, then the zip goes to Jeff.

Steps 2–5 live under `handoff/` and touch no app code, so they can land as a second PR.

## 9. Risks

- **Hidden server dependencies in the "pure" modules.** `core:check` surfaces them on day one. The
  fix is moving the offending piece out, not loosening the gate.
- **Components that aren't browser-safe.** The fix is a slim prototype copy. The cost is duplicated UI
  in `handoff/`, accepted because only the engine has to be authoritative.
- **Production export access.** This is Jeff-gated (the prod env pull is his). Everything up to the
  slicer can be built and tested on a local-dev export first, then re-cut from production.
- **Confidential data in a portable zip.** This is Jeff's call by design. The package is clearly
  marked, and the slicer's allow-list keeps secrets out.
