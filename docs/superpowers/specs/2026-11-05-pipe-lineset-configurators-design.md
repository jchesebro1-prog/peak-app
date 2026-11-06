# Pipe and lineset configurators (#373)

Jeff, 2026-11-05: add a simple pipe input to the Estimator, for curtains and in general, that works like
track; then a way to add the hardware for a typical counterweight lineset (aircraft cable, terminations and so
on), using the logic from Quick Design and the Grid.

Punch #373. Decisions D1333 onward (provisional: recheck against `origin/main` before the docs step).

## Decisions Jeff made

| Question | Answer |
|---|---|
| How much does Pipe work out? | Sticks, splices and hanging clamps; not labor |
| What does one Lineset add? | Aircraft cable, hand line, terminations and chain wraps only |
| How is cable length worked out? | Actual routing, not Quick Design's 2G + W |
| Does Quick Design change too? | No. It keeps its formula, and the same job shows different cable in each screen |
| Where do parts come from? | New Pipe types and Lineset types in Estimating Rules, not the Equipment map |

## Not in scope

- Head blocks, floor blocks, arbors, lock rail, T-bar track, loft blocks, batten pipe, counterweight bricks and
  labor. These stay separate lines.
- Any change to Quick Design, the Grid, the Equipment map or the Lineset Builder.
- Any change to existing Track lines or Track series.
- Linking a pipe line to a curtain. A pipe is an ordinary line beside the curtain. It does not change the curtain's
  mount type or cut sheet, and it does not travel with the curtain in Move lines.
- Seeding part numbers. Both type lists start empty.

## What the estimator sees

### Pipe

- **+ Configure pipe** sits beside **+ Configure track** on every system.
- The curtain modal gains an **Add pipe** toggle beside **Add track**, for new curtains only. To add a pipe while
  editing a curtain, use **+ Configure pipe**, because no link records whether that curtain already has one.
- A new curtain can have a track, a pipe, or both. Adding pushes the curtain line, then its track line, then its
  pipe line. A pipe with a blocking error blocks the whole add, as a track does.
- The toggle pre-fills label, quantity and run from the curtain's name, quantity and width. Pre-filled fields keep
  following the curtain until edited, using the same pattern as `followCurtainPrefill`.

Fields: label, pipe type, run (ft), quantity, and hanger spacing (ft). A blank spacing uses the type's default.

### Lineset

**+ Configure lineset** sits beside **+ Configure pipe** on every system.

Fields:

| Field | Limits | Default |
|---|---|---|
| Label | | "Lineset hardware" |
| Lineset type | active types | First active type |
| Sets | whole, 1 to 300 | Required |
| Width (ft) | above 0, up to 500 | Required |
| Grid height (ft) | above 0, up to 500 | Required |
| Lift lines per set | whole, 1 to 20 | Blank uses 1 per 10' of width, rounded down, at least 1 |
| Cable allowance (ft per line) | 0 to 200 | Blank uses the type's allowance |

Both modals follow `TrackModal`: live cost, sell and parts table; any blocking error disables Add; reopening a line
shows **Update** and replaces the line in place at today's prices. A line whose type was deleted opens read-only and
shows its saved parts. With no active type, the modal shows a link to the Rules screen.

## The quantities

Pure functions with no database or React imports.

### Pipe (`pipeQuantities`)

Per pipe, then multiplied by quantity:

```
pieces  = ceil(run / longest stick)
stick   = the shortest mapped stick at least run / pieces long
splices = pieces - 1
clamps  = ceil(run / spacing) + 1
```

Limits: run above 0 and at most `MAX_RUN_FT` (Track's limit); quantity within `MAX_TRACK_QTY`; spacing above 0.

Test case: a 40' run, sticks of 21' and spacing of 10' gives 2 sticks, 1 splice and 5 clamps.

### Lineset (`linesetQuantities`)

```
lines per set = entered, else max(1, floor(width / 10))
lift lines    = sets x lines per set
cable (ft)    = ceil(lift lines x (grid height + width / 2 + allowance))
hand line (ft)= ceil(sets x 2 x grid height)
terminations  = lift lines x 2
chain wraps   = lift lines
```

Test case: 6 sets, 40' wide, 40' grid and a 10' allowance gives 24 lift lines, 1,680' of cable, 480' of hand line,
48 terminations and 24 chain wraps.

The default for lines per set, the hand line rule, the termination count and the chain wrap count all come from
`src/app/(app)/design/quick/engine.ts:570`. Only the cable length differs.

## The setup screens

Two admin screens under Estimating Rules, `/estimating-rules/pipe-types` and `/estimating-rules/lineset-types`,
limited to `manage_users` and laid out like Track series. Each is a settings blob (`pipe_types`, `lineset_types`)
with one key per type. A delete writes `null`, so an id is never reused.

```ts
type PipeType = {
  id: string; name: string; manufacturer: string;
  sticks: { lengthFt: number; sku: string }[]; // ascending
  spliceSku?: string;
  clampSku?: string;
  hangerSpacingFt: number;
  active: boolean; updatedBy?: string; updatedAt?: number;
};

type LinesetSource = { kind: "part"; sku: string } | { kind: "assembly"; id: string };

type LinesetType = {
  id: string; name: string; manufacturer: string;
  parts: Partial<Record<"cable" | "handLine" | "termination" | "chainWrap", LinesetSource>>;
  allowanceFt: number; // new types default to 10
  active: boolean; updatedBy?: string; updatedAt?: number;
};
```

Activating a type refuses a blank or duplicate name, and any required role that is unmapped or no longer exists.
Pipe requires at least one stick, a clamp and a spacing. A splice is only required once a run needs one, and a run
that needs it blocks the line and names the role. Lineset requires all four roles.

An assembly source must be a Hardware assembly. A deleted or non-hardware assembly counts as unmapped.

**Unit warnings.** A cable or hand line part whose catalog unit isn't feet, or a stick whose unit is feet, would
misprice badly (1,680 spools of cable). The Rules screen and the configurator's parts table both warn. They don't
block, because catalog unit text varies. Recognised foot units: `ft`, `foot`, `feet`, `lf`, case-insensitive.

## Pricing and the estimate line

`pipeLine` and `linesetLine` mirror `trackLine`. The line is qty 1, unit `lot`, with SKU `PIP-<TYPE ID>` or
`LNS-<TYPE ID>`, and carries its inputs in a new field:

```ts
rigging?: ({ kind: "pipe" } & PipeConfig) | ({ kind: "lineset" } & LinesetConfig);
```

- **Pricing:** each part is priced with `catalogAddPrice` at the estimate's tier, and the line sells for the sum,
  exactly as in `trackBom`. The line is therefore an ordinary tier-seeded line.
- **Assemblies:** a role sourced from a Hardware assembly expands into one component row per included member, with
  quantity = role quantity x member quantity. Optional add-ons (quantity 0) are left out.
- **Assembly prices:** members use the assembly's resolved cost but are priced at the tier, not at the assembly's own
  sell. An assembly's per-line sell override does not apply here. This keeps the whole line tier-seeded.
- **Customer documents** print the one line:
  - `Main drape pipe — 1-1/2" Sch 40, 40' run (2 pipes)`
  - `Lineset hardware — 1/4" cable, 5/8" hand line: 6 sets, 24 lift lines`
- **The parts list and datasheets** read `components`, as for a track line.

## Everywhere a line needs handling

Add `isConfiguredLine(it)` (`!!it.track || !!it.rigging`) and use it wherever the code below reads `it.track` to mean
"a tier-seeded line with parts in `components`". Places that mean an actual curtain track stay on `it.track`.

| Place | Change |
|---|---|
| `estimator/types.ts` | `rigging` field, `PipeDraft`, `LinesetDraft` |
| `estimator/page.tsx` | Load both type lists, the parts they name and their Hardware assemblies' members, as for `trackParts` |
| `section-card.tsx` | Two buttons, `InputKind` additions, reopen on click or ✎, PIPE and LINESET chips, locked ✎ on a sent estimate |
| `use-estimator-state.ts` | Drafts, open / close / seed, add, Update, and the curtain's Add pipe |
| `curtain-modal.tsx` | The Add pipe toggle and compact fields |
| `steps/build-step.tsx` | Render the two modals and pass the props |
| `estimate-steps/discard-confirm.ts` | Add `pipe` and `lineset` to the discard prompt |
| `custom-part-edit.ts` | Not a custom line |
| `tier-reprice.ts` | Parts re-seed with the line (`reseedTrackComponents`) |
| `copy-system.ts`, `copy-pricing.ts` | Same path as track, with no fixture record lookup |
| `lib/quote-line-members.ts` | `isAssemblyLine` is false, and the line still expands |
| `lib/estimate-output/bom-models.ts` | Same exclusion as `TRK-` |
| `lib/project-discounts/rules.ts` | Not discountable as a line; parts are discounted inside it |
| `lib/catalog-rename/apply.ts`, `rewrite.ts` | Rewrite SKUs in both new blobs |
| `estimating-rules/page.tsx` | Two new cards |
| `scripts/smoke-routes.ts` | Two new routes |

Sent estimates behave as Track does: the configurators stay shut until Revise, and Revise does not re-price these
lines (`estimate-reprice/rules.ts` only moves plain catalog lines).

## Code layout

```
src/lib/rigging-config/
  types.ts        PipeType, LinesetType, configs, sanitizers
  pipe.ts         pipeQuantities
  lineset.ts      linesetQuantities
src/lib/stores/rigging-types.ts          the two blobs
src/app/(app)/estimator/rigging-bom.ts   pricing, line building, draft conversion
src/app/(app)/estimator/pipe-modal.tsx
src/app/(app)/estimator/lineset-modal.tsx
src/app/(app)/estimating-rules/pipe-types/
src/app/(app)/estimating-rules/lineset-types/
```

No migration and no new environment variables. Lines live in the quote document, as Track's do.

## Errors

| Situation | Result |
|---|---|
| Bad input (blank run, sets of 0) | Named message; Add disabled |
| Role unmapped, or its part left the catalog | Names the type and role, links to the Rules screen; Add disabled |
| Assembly deleted, or no longer Hardware | Same as above |
| Parts have no cost or list price | "<type>'s parts have no cost or price in the catalog"; Add disabled |
| Type deleted after the line was added | Opens read-only with its saved parts; the line keeps its price |
| No active types | Link to the setup screen instead of the fields |
| Part unit doesn't match | Warning only; Add stays enabled |

## Testing

New `scripts/test-rigging-config.ts`, run inside `test:specs`:

- Both test cases above, plus: a run that fits one stick (no splice); a choice among several stick lengths; quantity
  above 1; a width under 10' (one line per set); typed overrides; fractional cable rounded up.
- Pricing: parts at the tier seed; a part with no cost sold at list; an assembly role expanded with members multiplied
  and add-ons left out; a deleted part or assembly blocks the line.
- The lines through tier re-price, Copy system, `expandLine` / `isAssemblyLine`, `discountSkuOf` and `bom-models`.
- Sanitizers, activation rules, id tombstones and catalog rename on both blobs.
- A no-`rigging` regression: a track line produces identical output through every changed path.

Also run the standard gates (tsc, test:specs, test:smoke, eslint, next build) and a browser pass: configure each line,
add a pipe from a curtain, reopen and update, change the tier, and print the PDF.

## Setup after deploy (Jeff)

1. Create at least one Pipe type and one Lineset type, with their parts mapped.
2. Check the cable allowance. 10' is a placeholder.
3. Decide later whether Quick Design should move to the same cable formula. Today it would show 2,880' where the
   Estimator shows 1,680' on the same job.
