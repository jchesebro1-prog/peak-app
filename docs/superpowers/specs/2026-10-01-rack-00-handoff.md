# Rack assembly spec set handoff — 2026-10-01

- **ID:** specs-handoff-2026-10-01-rack
- **type:** note
- **project:** peak-app
- **status:** active
- **importance:** 4
- **created:** 2026-10-01
- **source:** brainstorm with Jeff 2026-10-01 (off-mini, no repo access). Provenance:
  `peak-assembly-builder.md` (verified main d36413ac), `projects/peak-system-designer.md`
  (Device Layouts + Enclosure editor, Submittal package), Jeff's answers in
  `sessions/2026-10-01-rack-assembly-builder-brainstorm.md`.

## What this is
Five implementation specs + one test/acceptance plan for **equipment racks in the Assembly Builder**:
a new `rack` kind with a sidebar rack-unit (RU) editor that builds the rack, and outputs that carry the
layout into a submittal / cut sheet. Authored OFF-MINI: **every spec opens with a Task 0 code-recon
step** because file names and line numbers below come from memory, not the repo. Copy into
`~/Downloads/peak-app/docs/superpowers/specs/`, then run the normal writing-plans -> subagent flow.

## Locked decisions (Jeff, 2026-10-01) — do not re-ask
- **RK-1** A new **`rack` kind** beside fixture / system / hardware.
- **RK-2** RU height / depth / weight / watts live as **optional catalog-part fields**, plus a
  **per-placement override** in the builder. Backfill common AV/control gear over time.
- **RK-3** Outputs, all four: front/rear **elevation drawing**, **equipment schedule**,
  **datasheet package**, **power/heat summary**.
- **RK-4** Build **one shared rack-elevation component**, used by the Assembly Builder and the
  Grid's Device Layouts / Enclosure editor.
- **Units:** org default is **imperial** — store inches, pounds, watts, BTU/hr. 1 RU = 1.75 in.

## Spec set and build order
| Wave | File | Why |
|---|---|---|
| 1 | `2026-10-01-rack-catalog-fields-design.md` | Everything downstream needs RU/depth/weight/watts data |
| 1 | `2026-10-01-rack-layout-engine-design.md` | Pure placement rules + totals; no UI; unit-testable first |
| 2 | `2026-10-01-rack-elevation-component-design.md` | Shared sidebar/elevation UI (RK-4) over the engine |
| 2 | `2026-10-01-rack-assembly-kind-design.md` | `rack` kind in the model, builder, pricing, consumers |
| 3 | `2026-10-01-rack-submittal-outputs-design.md` | Elevation SVG/PDF, schedule, power/heat, datasheet package |
| all | `2026-10-01-rack-test-and-acceptance-plan.md` | Test matrix + end-to-end acceptance |
Grid adoption of the shared component is **wave 4 / follow-up**, scoped at the end of the component spec.

## Cross-cutting facts (from memory — verify in Task 0)
- Assembly Builder: `/design/assemblies`; model in `src/lib/fixture-assemblies.ts` (`FixtureRecord`,
  `resolveFixture`, `sanitizeFixtureInput`, `allAssembliesFrom`); store `src/lib/stores/fixtures.ts`;
  doc table `subassemblies` (jsonb, no SQL migration). Repo `CLAUDE.md`/`AGENTS.md` is STALE about
  `fixtureAssembliesFrom()` (deleted; use `allAssembliesFrom()`).
- Lines are catalog SKUs only; **no nesting**; kind is fixed after creation (D299). Save actions use
  `requireUser`, not `requirePerm`.
- Pricing differs by surface (Builder/Estimator, Grid/Quick Design, Portal). Racks must follow the
  existing per-surface rules, not invent new ones.
- Submittal path = D94 bid-spec generator (.docx) + datasheet attachments; the client-package spec
  (`archive/specs-staging-landed-2026-07-25/2026-07-25-client-package-generator-design.md`) defines the
  bundle walker the rack outputs plug into.
- Beta = sample data: **no migrations or legacy adapters** needed for the new fields/kind.

## Consolidated Task 0 recon (do once, share results across specs)
1. Catalog part schema: is there a jsonb spec column, or fixed columns? Where do fields get edited?
2. `fixture-assemblies.ts`: exact `FixtureRecord`, `resolveFixture`, `sanitizeFixtureInput` shapes.
3. Existing zero-dep PDF writer (#36) and D94 .docx image-embedding capability; any SVG->PNG tool.
4. Part Documents (#207) data model: how to list datasheets for a SKU.
5. Grid Device Layouts/Enclosure editor: does code exist yet, or only the plan?
6. Punch-list: next free number (flush this set when first on the mini; not logged yet).

## Open questions for Jeff (collected from all specs)
See the "Open questions" section of each spec; the blocking ones are marked **[BLOCKING]**.
