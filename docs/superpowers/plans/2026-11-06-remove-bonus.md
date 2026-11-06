# Remove a bonus from a system (#375)

Jeff, Nov 6: an estimator can delete the 5% package bonus and the 2% estimator bonus from an estimate. His answers:
each bonus on its own, system by system, the customer's price drops, drafts only.

## Rules

- `SpecSection` gains two optional flags, `noPackageBonus?: true` and `noEstimatorBonus?: true`. Absent on every existing
  system, so existing numbers are byte-identical and there is no migration.
- `sectionWithBonusLines` skips a flagged line. With the 5% removed the 2% is figured with no 5% in its base (the existing
  `pkg = null` path). With a typed `sellOverride` the typed price stays; the bonus amount moves to margin.
- Any status where `repriceLocked(status)` is true (`src/lib/estimate-reprice/lock.ts`) keeps its stored flags. Client and
  server share that one rule.
- Anyone who can edit the estimate can remove or add back. No approver.
- The flags are internal and never printed.

## Pure rules: `src/lib/estimate-bonus/rules.ts`

- `bonusRemoved(sec, kind: BonusKind): boolean`
- `withBonusRemoved(sec, kind, removed: boolean): SpecSection` sets the flag to `true` or deletes the key. Returns the same
  reference when nothing changes.
- `sanitizeBonusRemovals(sec)` keeps a flag only when it is exactly `true`. Same reference when clean.
- `settleBonusRemovals(posted: SpecSection[], prior: SpecSection[] | null | undefined, priorStatus: unknown): SpecSection[]`
  - not `repriceLocked(priorStatus)`: `sanitizeBonusRemovals` each section.
  - `repriceLocked(priorStatus)`: each section's flags become the stored flags of the prior section with the same id; a section
    with no prior match has none.
  - Keep untouched sections the same reference. Never mutate input.
- `removedBonusKinds(sec): BonusKind[]` lists the flagged kinds that would otherwise produce a line, package first. Package
  needs `hasLaborLine`; estimator needs at least one base line. An empty system shows no "removed" row.
- `bonusNotFigured` returns false when both flags are set.

Import `repriceLocked` from lock.ts; it has no runtime imports. Confirm no import cycle.

## Server paths

- `saveQuoteAction` (`src/app/(app)/estimator/actions.ts`): run `settleBonusRemovals` on the normalized sections before
  `deriveEstimatorSections`, with `prior`'s sections and status (`prior ? prior.status : "draft"`).
- `placeSystemInEstimate`: both `stripBonusLines(withoutGroupMeta(placed))` call sites (around lines 1033 and 1078) also apply
  `sanitizeBonusRemovals`. Move and Copy keep the removal, so a moved system doesn't jump in price.
- `librarySectionForLoad` (`src/lib/narrative/system-library.ts`): delete both flags, beside `clientGoals` / `coverText`. Load
  system starts fresh with both bonuses.
- Revise needs no change: the flags ride on the sections through `deriveEstimatorSections`.

## Client

- `use-estimator-state.ts`: add `setBonusRemoved(secId, kind, removed)`. It returns early when `repriceLocked(status)`, otherwise
  `updateSection(secId, (s) => withBonusRemoved(s, kind, removed))`. The existing bonus effect then drops or re-adds the line.
  Expose it from the hook's return object.
- `steps/build-step.tsx`: pass to `SectionCard`
  - `bonusControls`: `null` when `!isBonusEligibleQuote({ source: initial.bonusSource, quoteType: initial.bonusQuoteType })`,
    otherwise `"locked"` when `repriceLocked(status)`, otherwise `"edit"`.
  - `onSetBonusRemoved={(kind, removed) => setBonusRemoved(sec.id, kind, removed)}`.
- `section-card.tsx`:
  - Locked bonus row: the last, empty action column becomes a ✕ button when `bonusControls` is set. Match the row-action button
    style already in this file. `aria-label` "Remove package bonus" / "Remove estimator bonus". `title` says the price drops by
    this amount; when `"locked"` it is disabled with `title={REVISE_FIRST}`.
  - For each `removedBonusKinds(sec)`, when `bonusControls` is set: a muted row in the same place and style as the bonus rows
    (`data-bonus-removed={kind}`), reading "Package bonus removed" / "Estimator bonus removed" with an **Add back** button,
    disabled with `title={REVISE_FIRST}` when `"locked"`. No amounts. Rendered after the visible lines, near the bonus rows.
  - Row order stays stable: package before estimator.
- Check no customer surface receives the flags in client props. `quote-document.tsx` is a server component. Check the package
  page view models (`src/lib/quote-share/package-view.ts`, `src/components/estimate-output/package-view.tsx`) and the portal
  online page. If raw sections reach a `"use client"` component on a customer route, strip the flags there and report it.

## Tests

Add a new function `removeBonusChecks(ok)` in `scripts/test-oct15-estimating.ts`, called beside `oct15BonusRateChecks`. Do not
edit `scripts/test-review-and-spec.ts`: another session has uncommitted changes there. Prefix messages with `#375`. Cover:

1. Each flag alone removes only its line; both remove both; no flag is byte-identical to today (same reference from
   `sectionWithBonusLines`).
2. 5% removed: the 2% line equals the 2% figured on a price without the 5%, and `systemSellTotal` drops by the right amount.
3. Typed `sellOverride` with the 2% removed: `systemSellTotal` is still the typed figure, no 2% line.
4. Add back restores byte-identical lines; ids are stable enough that `withBonusLines` settles in one pass (a second pass returns
   the same array).
5. `settleBonusRemovals`: a draft accepts `true`, drops `"yes"` / `1` / `false`; a sent / won / lost quote ignores posted changes
   both ways and restores the stored flags; a new system on a sent quote has none; an unsaved quote (no prior) accepts them.
6. `canonicalBonusSections` on a sent quote with bonus lines honors a stored flag and doesn't re-add the line.
7. `removedBonusKinds`: no package kind without a labor line; empty for an empty system; package before estimator.
8. `librarySectionForLoad` drops both flags; `withoutGroupMeta` keeps them; `copySystem` output keeps them if it is reachable
   here cheaply.
9. `buildBonusRecord` with the 2% removed on one system of two counts only the other system; with the 5% removed
   `packageBonusCost` falls accordingly.
10. `bonusNotFigured` is false when both are removed and still true when only one is removed and a line cost is junk.
11. Source-level: `actions.ts` calls `settleBonusRemovals`; `section-card.tsx` uses `REVISE_FIRST` on these controls.

## Out of scope

Docs (DECISIONS, PUNCHLIST, AGENTS) are written after review. No commit or push by the builder.
