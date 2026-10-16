# Estimator — move lines between systems (#357)

Jeff, Oct 16: "the ability to move each individual line in the estimator to
different packages — or select multiple and move them to different systems."

Today a line only moves ↑/↓ inside its own system (`moveItem`), and a whole
system moves or copies to another estimate (`moveSystem` / `copySystem`, #266).
Nothing moves a line across systems.

## Decisions (Jeff, Oct 16)

| Question | Answer |
| --- | --- |
| How | Checkboxes on every line + a per-line **Move to…**; a selection bar. No drag. |
| Price | A moved line keeps its own cost and sell — never re-priced. |
| Destinations | Another system on this estimate · a **New system…** · **Another estimate…** |
| Another estimate | The lines land there as ONE new system, "<source system name> (moved)" |
| Linked lines | Partners come along (curtain ↔ track; a whole labor group) — the bar says so first |
| Typed system sell | Cleared on every system that lost or gained a line |

## UX (Build step only)

- Every **movable** line row gets a checkbox at its left edge and a
  **Move to…** button beside ↑ ↓ ×. Not movable (no checkbox, no button):
  bonus lines (`bonus`, hidden anyway) and the Rewards credit (`rewardCredit`).
  A built (collapsed) system shows no rows, so nothing there can be ticked.
- Ticking a line opens a sticky bar at the bottom of the Build canvas:
  **N selected · Move to ▾ · Clear**. A selection may span systems.
  Per-line **Move to…** opens the same menu for just that line (it does not
  disturb the current ticks).
- The **Move to** menu:
  1. this estimate's systems, in rail order under their group headings
     (alternates included); a target that holds *every* selected line is
     disabled;
  2. **New system…** — asks a name (default "New System"); the new system is
     inserted right after the first selected line's system, in that system's
     group, with that system's freight % and price rounding;
  3. **Another estimate…** — the existing Move system estimate picker
     (search existing / new estimate).
- After choosing a target the bar shows a **preview** before anything moves —
  one line per effect, then **Move** / **Cancel**:
  - "+1 linked track will move too" / "+3 lines in the same labor group"
  - "Typed price cleared on Stage Lighting, Rigging"
  - "1 key-product star dropped (Rigging already has 20 / already stars that part)"
  - "Stage Lighting will be empty" (it is kept, never auto-deleted)
- After a move: selection clears, the target system is selected and scrolled
  to, and a dismissable notice says "Moved 4 lines to Rigging". Saved by the
  next Save, like ↑/↓.
- Selection clears on step change, on load of another quote, and drops any
  line that no longer exists (deleted line, moved system) or whose system was
  marked built (collapsed).

## Rules — one pure module `src/lib/estimate-line-move/`

`planLineMove(sections, selected, target) → LineMovePlan` and
`applyLineMove(sections, selected, target, opts) → { sections, plan }`, both
pure, both unit-tested. A line is addressed by `LineRef = { sectionId, id }`
(never a bare id — see rule 9); the plan's `lines`, `added` and `droppedStars`
are LineRefs, the Build selection is a set of `"<sectionId>:<id>"` keys, and
`removeLinesFromSources(sections, lines)` removes by LineRef.
`target` = `{ kind: "system", sectionId }` | `{ kind: "new", section: { id, name } }`.
For another estimate, `extractLinesAsSection(sections, plan)` builds the
outgoing section instead (see below).

1. **Expand partners** (closure, repeat until stable):
   - curtain ↔ track: the pairs `linkCurtainTracks(sections)` resolves
     (`src/lib/curtain-cut-sheets/track-link.ts`) — keyed pairs AND its
     legacy adjacency pairs, so the cut sheet still finds the track after the
     move. A legacy key-less pair that moves together is stamped with one
     fresh `newCurtainTrackKey(curtainId)` on both lines, so it can't re-pair
     by adjacency in the target. Non-moving legacy lines are left alone, so
     one source-side case remains: a key-less curtain that stays behind can
     re-pair by adjacency with a different key-less track that the move left
     right after it;
   - labor group: every line in the source system with the same `laborGroup`
     (labor partners never cross systems).
   - Never added: bonus lines, the Rewards credit.
   The plan lists which ids were added and why.
2. **Price:** items are carried byte-for-byte (cost, price, sellOverride,
   extSellOverride, option, every flag). Nothing re-prices. System totals
   recompute as usual, so freight % and $25 rounding per system can shift the
   grand total by a little; line prices never change.
3. **Typed system sell** (`SpecSection.sellOverride`): cleared (via the
   existing `clearSellOverride`) on every source system that lost a line and on
   the target.
4. **Labor group drafts** (`SpecSection.laborGroups[id]`): a group whose lines
   all left travels to the target (removed from the source). Partner expansion
   guarantees a group never splits. If the target already uses that id — a
   `laborGroups` record key OR a target line's `laborGroup` with no record
   (copies share ids) — the moving group's id is re-minted on its lines and
   record, so it never merges with target lines that a later Edit labor
   (`withLaborGroup`) would replace.
5. **Key-product stars** (`SpecSection.keyProducts`, anchored by
   `lineKey = String(item.id)` + sku): a moving line's block moves with it,
   appended to the target's list. It is dropped (and listed in the preview)
   when the target already has a block for that sku or already has
   `MAX_KEY_PRODUCTS` (20). Source lists lose the moved blocks.
6. **Order:** moved lines append to the end of the target in their original
   order (system order, then line order); `lineOrder` renumbered on every
   touched system.
7. **Empty source:** kept. **Built:** the existing un-mark-on-edit rule clears
   `built` on every touched system (no new code).
8. **Bonus lines:** not moved; the existing bonus re-derive rebuilds both
   systems' bonus lines on the next derive (as on any edit).
9. **Item ids are unique per system, not per quote** — Copy/Move system into
   an existing estimate (#266) keeps them, so one estimate can hold id 105 in
   two systems. A moved line keeps its id unless that id is already used in
   the target (or by an earlier moving line from another system); then it is
   re-minted (`opts.mintItemId`, the Estimator's `nextId`) and its key-product
   star follows (`remapKeyProducts`, which also re-points a `line:<id>`
   token). `curtainTrackKey` strings are untouched. `extractLinesAsSection`
   de-duplicates ids across sources the same way, and on the server
   `placeSystemInEstimate`'s existing-target branch (Move lines → another
   estimate and #266 Move/Copy system alike) re-ids any incoming line whose id
   the target estimate already uses anywhere, from max(target ids,
   `docIdFloor(target document)`) + 1 upward, remapping that system's stars
   and keeping everything else byte-for-byte (`reIdIncomingSection`,
   `src/lib/estimate-line-move/reid.ts`). Review comments pin to a system, not a
   line, so a move doesn't affect them. On an in-estimate move,
   `applyLineMove` reports each landed line's `from → to` (`moved`) and
   `reanchorPackageDoc` (`src/lib/package-doc/reanchor.ts`) re-points the Build
   package document's product blocks, product images and `lineQty` chips to
   the line's new system and (re-minted) id, through the editor's own setter,
   so the next Save stores it. Lines moved to another estimate leave this one
   like a deleted line: their anchors resolve to nothing (the editor's
   "removed"), exactly as today.
10. **Vendor lines** (`vendorQuoteId`): the VendorQuote record is quote-level;
    a move inside the estimate leaves it alone.

## Another estimate

Client-side: `extractLinesAsSection(sections, plan)` returns a section shaped
like the source system (name, kind, mfr, freightPct, priceRound, discipline;
NO sellOverride, groupId, built, alternate, clientGoals, coverText) holding the
expanded lines, their labor-group records and their key-product blocks. It is
posted through the existing `moveSystemToEstimateAction` — no new server
action — which sanitizes it like a save, names it "<name> (moved)", carries
the VendorQuote records the lines name, and (for a new estimate) applies the
#348 split-from-source and Scope-only rules exactly as Move system does.

Only after `ok: true` does the client remove the lines from the source (rules
3, 4, 5 applied to the source side) and drop a VendorQuote record from local
state when **no remaining** line names it. The notice reuses Move system's
"Moved to EST-1042 →" with Save to make it stick. On failure nothing changes
and the error shows in the bar.

## Not in scope

Drag and drop; copying lines (only move); moving into a specific system of
another estimate; moving lines in Quick Design / Grid / service builders;
re-pricing at the target's margin. The estimate move posts a click-time
snapshot of the lines: an edit made to them during the server round trip is
lost, the same as Move system today (accepted).

## Tests

- `scripts/test-estimate-line-move.ts` (joins `test:specs`): partner closure
  (keyed + adjacency curtain/track, labor groups, never bonus/credit),
  sellOverride clearing on both sides, labor-group record travel + id
  re-mint on collision, key-product carry / sku-conflict drop / cap drop,
  ordering + lineOrder, empty source kept, target holding all selected ⇒ no-op,
  extractLinesAsSection field whitelist, prices unchanged; duplicate ids
  across systems (A:105 + C:105 + B:107: only the ticked line moves, A:105 → C
  is a real move, C:105 → A never leaves two 105s), landing re-id + star
  remap, extract de-dup, a record-less target labor-group id, legacy pair
  re-key, and the server's `reIdIncomingSection`.
- Browser pass on a real estimate: tick across two systems → Move to → existing,
  New system…, Another estimate (new) → Save → reload shows the move.
