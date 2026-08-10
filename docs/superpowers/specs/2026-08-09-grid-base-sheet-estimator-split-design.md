# The Grid: generated base sheet + estimator split (update)

**Supersedes the build scope of** `2026-07-25-grid-base-sheet-and-estimator-split-design.md`
**(#38/#41) for this pass.** That spec's architecture is still correct and is carried forward
unchanged below. This document exists because two weeks passed between that spec being written
and picked up for a plan, and re-verifying it against the current tree surfaced real drift —
this is the corrected, narrowed version to actually build from.

## What changed since 2026-07-25 (why this doc exists)

1. **The categories toggle already shipped.** #38's original spec called for building a
   per-item, open-ended category label as part of this work. #48 (2026-07-27, D125) already
   built the consumption side of that — filters/layers on the Grid canvas, per-Space category
   rollups, verified working — and along with it, the *assignment* side (per-placement user
   categories) that #38 was going to add. **Not part of this build. Nothing to do here.**
   One correction to the original vision: Jeff's actual answer wasn't a fully open-ended
   taxonomy — it's **five fixed Grid-specific scopes (Lighting / Rigging / Curtains / Audio /
   Video) plus user-defined categories on top**, a hybrid, not pure open-ended.
2. **The "dims trap" is already resolved in code**, independent of this spec.
   `src/lib/design/venue-dims.ts` is the canonical `VenueDims` block the original spec asked
   for — no bare `width` field exists, `proWidthFt` (proscenium) and `stageWidthFt`
   (wall-to-wall) are already distinct, documented fields. Confirmed unchanged architecture,
   nothing to build.
3. **Nav placement is already settled**, contrary to the original spec's "TABLED, avoid
   header/tab decisions" caveat. `/estimator` is already reachable under the top-level "EST"
   nav group (`nav-data.ts`); the Grid is already under "DESIGN". The estimation side does not
   need to "move" anywhere — it's already where the direction wants it.
4. **Two open questions from the original spec are now answered** (2026-08-09, this session)
   — see below.
5. **#40 (client package generator) and #51's broader "shared tools" framing are explicitly
   OUT OF SCOPE for this build**, per Jeff, 2026-08-09 — held off for a later pass, not decided
   against. Do not build the "publish spec/datasheets/drawings/estimate" actions as part of
   this work. (For whenever that pass happens: Jeff has already answered #51's three open
   questions — publish is four separate, user-selected generators, not one bundled action;
   "drawing package" is the Grid plan + equipment/lineset schedules + riser, DXF is a separate
   export; the Consulting-side "budget" and Design/Build-side "estimate" are the same
   underlying math/engine, different document/name, and both are distinct from Consulting's
   own existing engagement-level quote. That's recorded here so it isn't re-litigated later,
   but none of it is this build's job.)

## Direction (Jeff-locked, 2026-07-25, unchanged)

Split the design estimator. The **estimation side** (dims/assumptions in → budget out) is a
quick, numbers-only path — no drawings — and already lives under the EST nav group today. The
**Plan + equipment/lineset schedules + Control Riser logic** live in **The Grid**, which becomes
the single spatial design workspace. "Schedules" means the drawing-package kind (equipment
schedule, lineset schedule) — not the Operations Schedule board.

## Architecture: two paths, one `VenueDims`

1. **Estimator (numbers path):** measurement inputs for quick equation-based budgets. No
   drawings. Unchanged by this work.
2. **The Grid (spatial path):** consumes the same `VenueDims` to generate the plan view when no
   drawings exist yet.

- **Base sheet:** a new Grid project opens with a venue plan **generated from `VenueDims`**
  following the estimator's plan-view logic — scale implicit (geometry known), **no upload, no
  calibration step** required to start painting. Uploading a real plan stays optional, and does
  not block starting work.
- **Seeding action:** an explicit "generate starting layout from dims" action paints real,
  editable device instances (drapes, electrics, etc.) from the parametric rules already used
  elsewhere. Re-running it is **additive with a confirm prompt, never a silent replace** — it
  must not blow away a user's edits.
- **From the moment a Grid project has instances, all artifacts (Plan, equipment schedule,
  lineset schedule, Control Riser) derive from those Grid instances ONLY.** No parallel
  parametric artifact path — nothing to drift between two sources of truth.
- Estimating consumes a Grid BOM when one exists for the linked design, else prices
  parametrically as it does today — this kills the standing `dBlk` quantity-guessing problem.

## Resolved this session (2026-08-09)

**Real plan upload, after a base sheet already has placements:** the uploaded plan arrives as a
**separate sheet** within the same Grid project. The generated base sheet and everything placed
on it are untouched — no automatic carry-over of markers onto the new sheet. Rationale: the
generated sheet's geometry is derived exactly from `VenueDims`; a real plan may not match it
precisely, and silently re-projecting placements onto different geometry risks misplacing
equipment without the user noticing. The user decides, per sheet, whether to redo the layout.

**Lineset Builder's relationship to Grid:** stays its **own linked tool**, sharing the same
`VenueDims` record — it does **not** get absorbed into Grid's canvas as another sheet type. Only
its *output* (the lineset schedule, as a derived artifact) merges into Grid's artifact set, the
same way the estimator's BOM does. The interactive lineset-diagram editor itself is unaffected by
this work. (Matches Jeff's #51 framing, two days after the original spec: Lineset Builder, Steel
Calculator, and The Grid are three separate tools shared by both Consulting and Design/Build —
not one tool swallowing another.)

## Migration

None. Beta, sample data only (Jeff, 2026-07-25, reconfirmed no change). Existing Designs need no
adapter.

## Build tasks

0. **Recon** (do this first, in the implementation plan): current estimator plan-view render
   logic and parametric seeding rules (what exactly generates from dims today, and where it
   lives); current Grid sheet model — confirm a Grid project can already hold more than one
   sheet, since the "separate sheet on real-plan-upload" decision depends on that; existing
   derived-riser slice (built already, per #40's spec — confirm what's reusable here); Lineset
   Builder's current output shape (what "lineset schedule" needs to look like as an artifact
   Grid can consume).
1. **Generated base sheet:** `VenueDims` entry form on a new Grid project → rendered venue plan
   sheet, correctly scaled, zero calibration steps required before painting.
2. **Seeding action:** "generate starting layout from dims" → editable instances from the
   parametric rules. Additive re-run with confirm, never silent replace.
3. **Real-plan-upload path:** uploading a plan PDF on a project that already has a base sheet
   creates a new, separate sheet in the same project. The base sheet and its placements are
   never modified by this action.
4. **Artifact derivation:** equipment schedule + lineset schedule computed from Grid instances;
   Control Riser logic relocated onto / merged with the existing derived-riser slice so it also
   reads Grid instances.
5. **Estimator seam:** "use Grid BOM if present, else price parametrically" wiring on the
   estimation side.
6. **Retire estimator-side drawing outputs** once Grid artifacts reach parity — needs an
   explicit parity checklist in the implementation plan (what the estimator currently renders
   that Grid must match before the old path can go away).

Not a build task here, noted for provenance only: categories toggle (#48, already shipped);
publish/client-package actions (#40, held off); broader tool-consolidation nav framing (#51,
held off).

## Acceptance

- New Grid project → enter `VenueDims` → base plan appears, correctly scaled, ready for painting
  with zero uploads.
- "Generate starting layout" seeds editable drapes/electrics/etc. from the parametric rules;
  running it again adds rather than silently replacing, and asks for confirmation first.
- Equipment schedule, lineset schedule, and the Control Riser all regenerate correctly after an
  edit to Grid instances.
- Uploading a real plan PDF onto a project with an existing base sheet produces a second,
  separate sheet; the original base sheet and its placements are unchanged.
- The Lineset Builder is unaffected — same tool, same page, still reads/writes the same
  `VenueDims` — its schedule output now also appears among Grid's derived artifacts.
- The quick estimator still produces a budget from dims alone when no Grid BOM exists, and uses
  the Grid BOM when one does.
