# Venue Assessments — pickup notes

Stopped mid-build 2026-08-18. **Tasks 1–8 of 16 are done, reviewed, and verified.**
Task 9 was dispatched and killed before it wrote anything.

Read these two first — they are the contract, and this file only says where the
work stopped:

- Spec: `docs/superpowers/specs/2026-08-18-venue-assessments-design.md`
- Plan: `docs/superpowers/plans/2026-08-18-venue-assessments.md` (16 tasks)

## State at the stop

| | |
|---|---|
| HEAD | `5686988` |
| Build | `npm run build` exit 0 |
| Tests | `npm run test:specs` → **882 PASS / 0 FAIL** |
| Smoke | `npm run test:smoke` → 50 PASS |
| Working tree | 28 pre-existing modified files, untouched, unstaged |
| Stray processes | none |

The app builds and runs. The rename is complete with working redirects, and the
site-visit layer is functional end to end. Nothing is half-written.

## What shipped

| Commit | Task | What |
|---|---|---|
| `6b9eb1e` | — | Spec |
| `352a637` | — | Plan |
| `4be1233` | 1 | `venue-classes.ts` — 6 classes, subtypes, per-class field sets, migration maps |
| `3fbc7b5` | 2 | `linesets.ts` — Theatre-superset row model, D/M/R/L/B/C/S/E/T/O + G/F/P/X legends |
| `b01554a` | 3 | `assessment.ts` — 10 condition categories, usage vocabularies, findings engine |
| `477632a` | — | Plan fix: forbid `git add -A`; record the seed-fixture retyping |
| `1237d53` | 4 | Record shape + read-time migration in `normalize()` |
| `c8f0421` | 5 | Route move `/field-survey` → `/venue-assessments` + redirects |
| `c4f19fc` | 6 | ~20 call sites and labels repointed |
| `8c160fb` | — | Plan fix: `scripts/` route assertions; bulk-sed substring hazard |
| `c75c714` | 7 | Editor split into `sections/` |
| `40cab7e` | 8 | Venue class + subtype drive the measurement set; sheet fields on screen |
| `5686988` | — | Fix: 3D archetype off `venueClass`, not legacy `venueType` |

### Files now in play

New pure model modules (no DB imports, safe on server and client):

```
src/lib/stores/venue-classes.ts   247
src/lib/stores/linesets.ts         77
src/lib/stores/assessment.ts      232
```

The module, post-split:

```
src/app/(app)/venue-assessments/
  page.tsx                        621   list + class badges
  actions.ts                       44
  visit-actions.ts                 58
  visit-requests.tsx              214
  [id]/
    page.tsx                       74   builds `meta`, server-side
    controls.tsx                 1218   draft state, save/stage, layout, section list
    actions.ts                    157
    venue-3d.tsx                  422   now takes venueClass + venueSubtype
    sections/
      types.ts                    142   Draft, FieldDef, SectionDef, EditorCustomer, EditorMeta
      styles.ts                    37   ACCENT tints + input/label/textarea styles
      fields.tsx                  121   renderField switch + FieldsSection
      custvenue.tsx               146   customer/venue/class/subtype
      conditions.tsx               28
      photos.tsx                   45
```

## Pick up here: Task 9

`docs/superpowers/plans/2026-08-18-venue-assessments.md` → **Task 9: Systems
sections with PRESENT gates**. It was dispatched once and killed during its read
phase; nothing was written, so start it clean.

Task 9 folds the sheets' CURTAINS / LIGHTING / AV & POWER / RIGGING blocks into
the four existing discipline sections, each gated by the sheet's own PRESENT
checkbox row, with auditorium-only fields hidden on other classes. The
authoritative field list is the spec's §"Systems — four gated sections", not the
plan's summary.

Then: 10 linesets → 11–13 assessment layer → 14 certs → 15 doctrine → 16
printable sheet.

### Three things Task 9 must handle

**1. A live placeholder is waiting for it.** `src/lib/stores/surveys.ts:539`:

```ts
if (!Array.isArray(branch.present)) branch.present = ["__migrated__"];
```

Task 4 left this deliberately. Task 9 replaces it with the real first PRESENT
option for that discipline and class:

```ts
branch.present = [presentOptionsFor(key as DisciplineKey, s.venueClass)[0]].filter(Boolean)
```

Watch the import direction — `surveys.ts` already imports from
`venue-classes.ts`, and `survey-intake.ts` imports a *type* from `surveys.ts`.
Adding a value import may cycle. Check before restructuring.

**2. Retire Tier-3 from the editor only.** Remove the `systems` section from the
editor's section list, but keep `systemsState` and `SYSTEM_KEYS` on the type and
in the store. Old records carry that data and `normalize()` folds it forward.
Deleting them loses data.

**3. Do not touch Tier-1.** `tier1Items`, `tier1Complete`, `intakeStatus`, and
`intakeReady` stay exactly as they are.

### Still inline in controls.tsx, moving in Task 9

`renderDiscField` (line ~799) and `renderInventory` (line ~832), plus the
`tier1` / `systems` / `discipline` render blocks in the section loop. Task 9
moves the discipline ones into `sections/systems.tsx`.

## Rules that bit us, in order of how much they cost

**1. Never `git add -A`, `git add .`, or `git commit -a`.** The working tree
carries 28 pre-existing modified files from unrelated in-flight work — the whole
`src/app/(app)/estimator/` directory, `flame-tests/quote/`,
`design/engagements/quote/`, `schedule/actions.ts`, `venues/page.tsx`,
`db/seed-data.ts`, `db/seeds/catalog.ts`, `lib/stores/{engagements,pricing,projects}.ts`,
`lib/{inspection-engine,repair-engine,flametest-engine}.ts`,
`lib/google/calendar.ts`, `PUNCHLIST.md`. Stage only the exact paths a task
touched, and run `git status --short` before every commit.

This already cost something once — see "Known blemish" below.

**2. PGlite is single-process, and opening it writes.** `npm run test:specs`,
`npm run test:smoke`, and `npm run dev` all open the dev DB. Never run two at
once, and never run two agents that both run them. After every such command,
`pgrep -fl "node.*tsx"` must print nothing. This is why the build ran one agent
at a time rather than fanning out — it has destroyed this dev DB three times.
`npm run build` is safe concurrently; each worker gets a throwaway datadir.

**3. Don't bulk-sed `field-survey` → `venue-assessments`.** It corrupts the
import specifier `./home-field-surveys` into `./home-venue-assessmentss`.

**4. The `src/`-scoped grep is not enough.** `scripts/smoke-routes.ts` and
`scripts/test-review-and-spec.ts` both hard-code routes.

## Decisions that are settled — don't relitigate

Twelve locked with Jeff on 2026-08-18, all recorded in the spec's "Locked
decisions". The ones most likely to get second-guessed mid-build:

- **Record ids stay `FS-####`.** No `VA-` prefix, no second id base.
- **The nav `active` key stays `"field"`.** AGENTS.md requires preserving the
  prototype's active keys; only the label and href changed.
- **Migration is read-time only**, inside `normalize()`. No stored rewrite, no
  drizzle migration — the record is a JSONB document.
- **Never rename an existing measurement key.** 17 reserved keys are listed in
  the plan's Global Constraints. This is what keeps the 3D preview working.
- **Electrical gets notes only, never a condition rating.** Explicit in the
  brief — outside Peak's lane.
- **Findings never spawn quotes, repair jobs, or tasks.** Budget tiers are a
  planning range, not a quote.
- **Two rating scales on purpose**: Good/Monitor/Replace in the assessment
  layer, G/F/P/X on lineset rows.

## Open questions for Jeff

**1. Usage-profile vocabularies (blocks nothing, but Task 11 bakes them in).**
The event types, staff capability tiers, and growth goals in the spec's
§Assessment layer came from the brief, not from a form anyone has carried on a
site visit. They're cheap to change now and annoying to change once they're on
screen and in saved records. Worth ten minutes before Task 11.

**2. Two defaults taken without confirmation**, both raised on 2026-08-18 and
passed on rather than answered:
- Findings stay advisory — no auto-spawn of repair jobs the way inspection
  findings do.
- `other` is the sixth class, covering outdoor/amphitheater and arena with a
  generic field set, rather than either getting its own sheet.

**3. From the brief's own §6**, answered as recommendations rather than by
Jeff directly: findings roll-up granularity, sign-off structure, and revision
numbering. All three are implemented per the spec's locked decisions.

## Known blemish

Jeff's uncommitted **PUNCHLIST #94** work — the go-live-reset coverage block
(`DEMO_COLLECTIONS` / `DOC_TABLES`) in `scripts/test-review-and-spec.ts` — was
swept into commit `4be1233` under a venue-class commit message. Nothing was
lost; it's mislabeled. It happened because that file was already dirty and Task 1
had to commit it to record its own tests.

Fixable with a history rewrite if the log matters. Not fixed, because rewriting
history under 28 uncommitted files is a worse risk than a wrong commit message.

## Verification checklist before calling the whole thing done

From the spec, plus what execution added:

- [ ] `npm run build` clean
- [ ] `npm run test:specs` → ALL PASSED
- [ ] `npm run test:smoke` passes
- [ ] `pgrep -fl "node.*tsx"` empty
- [ ] `grep -rn "field-survey" src/` returns only the deliberately-skipped
      comment in `src/app/(app)/estimator/types.ts:190`
- [ ] `/field-survey?id=FS-1053` → `/venue-assessments?id=FS-1053`, query intact
      (verified working at `5686988`)
- [ ] Every seeded survey opens and shows a venue class
- [ ] A record saved before this work still shows its original measurements
- [ ] Print a sheet for each of the six classes; check pagination and sign-off
- [ ] Log **D132** in `DECISIONS.md` — the twelve locked decisions plus the two
      flagged defaults. **Not yet written.**
