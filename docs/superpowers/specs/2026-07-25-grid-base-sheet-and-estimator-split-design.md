# The Grid: generated base sheet, estimator split, categories toggle

**Wave 2 · the big one.** Authored off-mini 2026-07-25; direction + seeding
architecture Jeff-confirmed in-session. **Nav names/placement TABLED** —
tabs/UI rebuild is in flight; spec deliberately avoids header/tab decisions.

## Direction (Jeff, locked)
Split the design estimator. The *estimation* side (dims/assumptions in →
budget out) moves under Estimating (wherever the nav rebuild puts it). The
**Plan + equipment/lineset schedules + Control Riser logic merges into The
Grid**, which becomes the single design workspace. "Schedules" = the
drawing-package kind (equipment schedule, lineset schedule) — NOT the
Operations Schedule board; use "equipment schedule" wording everywhere.

## Architecture (Jeff-confirmed): two paths, one `VenueDims`
1. **Estimator (numbers path):** keeps measurement inputs for quick
   equation-based budgets. No drawings.
2. **The Grid (spatial path):** consumes the SAME variables to generate the
   plan view when no drawings exist.
- **Base sheet:** a new Grid project opens with a venue plan GENERATED from
  `VenueDims` following the estimator's plan-view logic — scale implicit
  (geometry known), **no upload, no calibration** required to start
  painting. Uploading a real plan stays optional.
- **Seeding action:** "generate starting layout from dims" paints real,
  editable device instances (drapes, electrics, etc. from the parametric
  rules). From then on **all artifacts (Plan, equipment schedule, lineset
  schedule, Control Riser) derive from Grid instances ONLY** — no parallel
  parametric artifact path, nothing to drift.
- Estimating consumes a Grid BOM when one exists, else prices parametrically
  — kills `dBlk` quantity guessing (standing requirement in [[peak-app]]).
- **Dims trap (recorded):** estimator `width` = PROSCENIUM width; lineset
  `stageWidthFt` = wall-to-wall. The generated base sheet must declare which
  dims drive it; `VenueDims` is the canonical block — extend it, never add a
  second "width."

## Categories toggle (Jeff, locked)
Per placed item, an OPTIONAL category. Taxonomy is **open-ended by design** —
user-defined labels, not an enum (Jeff: trade packages, alternates — *"hard
to know until the customer asks"*). Assign now, consume later: per-category
equipment schedules/specs/quotes, and the projects-lifecycle spec's
**per-scope signoff checkboxes read this same taxonomy.**

## Migration
**None.** Beta, sample data only (Jeff). Old Designs need no adapter.

## Build tasks
0. Recon: estimator plan-view render logic + parametric rules (what exactly
   generates from dims); `VenueDims` current shape/persistence; Grid sheet
   model (can a "generated" sheet coexist with uploaded sheets?); riser
   derivation (built slice) and lineset builder outputs.
1. Generated base sheet: `VenueDims` entry form on new Grid project →
   rendered venue plan sheet (no calibration step).
2. Seeding action → editable instances; re-run behavior = additive with
   confirm, never silent replace.
3. Categories toggle on placed items (+ label management).
4. Artifact derivation in The Grid: equipment schedule + lineset schedule
   from instances; Control Riser logic relocated/merged with the existing
   derived-riser slice.
5. Estimation side relocation (placement per nav rebuild) + "use Grid BOM if
   present" seam.
6. Retire estimator-side drawing outputs once Grid artifacts reach parity
   (parity checklist in the plan).

## Open questions
- When a real plan PDF is uploaded later: do base-sheet markers carry over
  onto it, or does it arrive as a separate sheet alongside? (Still open from
  the punch item — one pop-in to Jeff at plan time.)
- Whether lineset-builder rendering itself merges into Grid sheets or stays
  a linked tool sharing `VenueDims` (Task 0 informs; Jeff decides).

## Acceptance
New Grid project → enter dims → base plan appears, correctly scaled, ready
for painting with zero uploads; "generate starting layout" seeds editable
drapes/electrics; equipment + lineset schedules and riser all regenerate
after an edit; any item takes a user-defined category; the quick estimator
still produces a budget from dims alone, and uses the Grid BOM when told to.
