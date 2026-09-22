# Round 2 standalone items: search bars, Grid symbols, manual consulting projects, Knowledge tab

Status: approved by Jeff (brainstorming 2026-09-21). Punch #121, #131, #135, #136.
Branch `punch-2026-09-21-round-2`. Four independent items; each gets its own scoped plan.

## #121 Search bars: filters on the search row, results inline

**Context.** No shared search component (`src/components` has none); 24 screens roll their own
`<input placeholder="Search…">`. The Subassemblies part picker filters a `<select>`'s own options,
so the results are a detached dropdown you must open (`design/subassemblies/subassemblies-client.tsx:27-28`);
People and Companies put their filter `<select>`s on a second row (`people/controls.tsx:69-91`,
`companies/controls.tsx:111-131`); the estimator catalog picker is the one place results list
inline under the input (`estimator/catalog-picker.tsx:79-99`). The Catalog page's search + sort
already share a row (`catalog/controls.tsx:48`); its facet rail is a different pattern and stays.

**Design.** Two shared components in `src/components/search/`:
- `SearchFilterBar` — one flex row: the search input (grows) + any number of `<select>` filters
  passed as children, same 36px height, wraps under 560px. Props: `value`, `onChange`,
  `placeholder`, `children`.
- `Typeahead<T>` — input + inline results list rendered directly under it (absolute, max 8 rows,
  keyboard up/down/enter/escape, `aria-*` listbox), `items: T[]`, `filter(q, item)`, `render(item)`,
  `onPick(item)`; results visible while typing, no separate dropdown to open.

**Adopt** in this order: Subassemblies `PartPicker` and the Assembly Builder's component picker
(`Typeahead` over the catalog, showing SKU · description · manufacturer · list price); Grid device
palette search (`editor.tsx:1196-1206`, keeps its scope toggle buttons in the same row via
`SearchFilterBar`); People, Companies, Venues filter rows (`SearchFilterBar`). Leads/quotes tables
follow the same component when touched later — not part of this item.

**Tests.** `test:specs`: `Typeahead` filtering/ordering helper (prefix-of-SKU first, then
description contains); smoke on the touched pages; browser pass on Subassemblies.

## #131 The Grid: a symbol per placed item type

**Context.** Every placed device is the same rounded rect coloured by a hash of its category
(`design/grid/[id]/editor.tsx:123-127, 2035-2094`); curtains are the one special glyph.
`GridSymbol` (`src/lib/stores/grid-catalog.ts:17-33`) has `symbolWidth`/`symbolHeight` but no
shape. Placements store `partId` + position and resolve the part live (`editor.tsx:373, 2036`).

**Design.**
- `GridSymbol.shape?: "rect" | "circle" | "triangle" | "diamond" | "hexagon" | "speaker" |
  "light" | "camera"` — the last three are small path glyphs drawn inside a rect. Per-category
  default in `settings.gridCategoryShapes: Record<category, shape>` (Settings → Grid), seeded:
  Speakers → speaker, Lighting → light, Cameras → camera, Rigging → diamond, Control → hexagon,
  everything else → rect. Resolution: `shapeFor(part, settings)` = `part.shape ?? default[category]
  ?? "rect"` (pure).
- Rendering: one `<SymbolShape shape size color selected>` SVG component used by the plan
  (`editor.tsx:2035-2094` replaces the bare rect), the riser (`/design/grid/[id]/riser`), the
  legend, and the palette rows (so the palette shows what will be drawn). Curtains keep their
  drape glyph. The selection ring and label placement are unchanged.
- Editing: a "Symbol" `<select>` in the grid-catalog entry editor and in the placed item's
  context panel (per-entry override); the category default lives in Settings.

**Tests.** `test:specs`: `shapeFor` precedence; `SymbolShape` renders a known path per shape
(snapshot of the `d`/element kind). Smoke on the grid editor + riser; browser pass: change a
category default and see every placed speaker change.

## #135 Consulting: add a project + fee manually

**Context.** Engagements are created only by `syncEngagementsFromQuotes()` when a consulting
quote goes sent/won (`src/lib/stores/engagements.ts:527-573`); the hub (`design/engagements/view.tsx`)
has "+ Add milestone" on an existing engagement (`view.tsx:1071-1090`) but no way to create one;
`ensureEngagementForQuote()` is dead code (`engagements.ts:495`). Consulting quotes never create a
Project (`projects.ts:579`).

**Design.**
- `ConsultingEngagement.origin?: "quote" | "manual"` (default `"quote"` for existing rows) and
  `quoteId: string | null` (already nullable in practice; make the type say so).
- `createManualEngagement(input, me)` in `engagements.ts`: `{ customerId, name, architect?,
  siteId?, contactName?, fee?: { mode: "fixed"; amount } | { mode: "milestones"; milestones:
  { name; targetDate; amount }[] } }` → an engagement with `status: "awarded"`, `origin: "manual"`,
  milestones from the fee (a fixed fee becomes one milestone "Fee" with the amount, unscheduled),
  phases from `consulting-stages.ts` as for a won quote. The sweep (`syncEngagementsFromQuotes`)
  ignores `origin === "manual"` rows, so it never overwrites them.
- Hub: "+ New consulting project" opens a modal — customer (pick / `EntityQuickAdd`), name,
  architect, venue (customer's sites), fee mode + amount or milestone rows — calling
  `createManualEngagementAction` (`requirePerm("create")`), then routes to the new engagement.
- Engagement page: "Attach proposal" on a manual engagement links an existing consulting quote
  (`quoteId`) without changing milestones; after that, status changes on the quote follow the normal
  sweep rules.

**Tests.** `test:specs`: fee → milestones mapping; sweep skip rule. `test:review:regressions`:
create manual engagement → appears in the hub, sweep leaves it intact, attaching a quote sets
`quoteId`. Smoke on `/design/engagements`; browser pass creating one.

## #136 Knowledge & Information tab

**Context.** Steel Calculator and Fixture Cross-Ref live under DESIGN (`nav-data.ts:91,95`; pages
`design/steel`, `design/fixtures`); no Knowledge route exists; #27 and #56 are logged-only.

**Design.**
- New nav group `{ kind: "group", key: "knowledge", label: "KNOWLEDGE", children: [ Overview
  `/knowledge`, Steel Calculator `/knowledge/steel`, Fixture Cross-Ref `/knowledge/fixtures` ] }`
  placed after DESIGN. The two pages move (files relocate; components untouched); `/design/steel`
  and `/design/fixtures` become redirects; `activeKeyFor` maps the new paths.
- `/knowledge` landing: a short page in the app's card style — what lives here today (the two
  tools), where each dataset comes from and how it's maintained (steel: the calculator's tables and
  who owns updates; fixtures: "ported from the Peak Knowledge cross-reference workbooks" per
  `design/fixtures/page.tsx:11`), and a "Coming here" list of the #56 items (design doctrine,
  estimating rules, customer tiers) as plain text, no links to unbuilt pages.
- Nothing else moves; #56 (making Knowledge the home for company settings) stays open.

**Tests.** Smoke: `/knowledge`, `/knowledge/steel`, `/knowledge/fixtures` 200; `/design/steel`
and `/design/fixtures` redirect. `nav-data` unit check that no two entries share a key.

## Out of scope (all four)

- A global search redesign (⌘K) — untouched.
- Symbol images/uploads for the Grid (curated shapes only).
- Consulting fee proposals themselves (#35) — unchanged.
- Migrating estimating rules / doctrine under Knowledge (#56).
