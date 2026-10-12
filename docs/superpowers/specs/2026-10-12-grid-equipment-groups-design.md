# Grid equipment groups — design (Grid notes #4, 2026-10-12)

Jeff: "select the rack, place equipment inside it, grouped for this design, shown that way on the
spreadsheet." All product decisions below are Jeff's (Oct 12); the engineering defaults are marked
**default** and logged in DECISIONS.md.

## 1. Data model

One optional field on `GridPlacement`:

```ts
/** Grid notes #4: the HOLDER placement's id when this device sits inside another device
 *  (a rack, a booth, a panel…). Absent = on the plan on its own. */
groupId?: string;
```

There is **no groups list**. A holder is simply a placement that at least one other placement names
in `groupId`; it stops being a holder when its last member leaves. No migration (JSONB documents,
absent = not grouped).

### Invariants (enforced by every write, repaired by `settleGroups`)

1. The holder exists in the same design and the **same option** (`optionId`, after `ensureOptions`).
2. **One level only**: a holder is never itself a member; a member never holds.
3. **Curtains** never hold and are never held.
4. A holder holds at most **200** members (`MAX_GROUP_MEMBERS`) — **default**.
5. **Same page, mirrored spot**: a member is on its holder's `sheetId` + `page` (a link across pages
   is dropped, never followed — review fix), and its `x`, `y` and `spaceId` (pin) always equal its holder's.
   So every consumer that reads a placement's position (spaces, schedule sections, riser rooms,
   reading order, drawing-set plan sheets, wires, BOM by space) puts the member exactly where its
   holder is with no change of its own.

`settleGroups(placements, defaultOptionId)` (pure, `src/lib/design/grid-groups.ts`) is the single
repair rule, run at the end of every store write that touches placements: a member whose link breaks
an invariant loses `groupId` and stays where it is (it shows on the plan at the holder's last spot);
a valid member is mirrored onto its holder. Writes that ADD links (paste, an undo that puts devices back)
check the 200 cap first (`groupCapRefusal`) and refuse with the reason, so the repair never trims a
group the person asked for. Precedence when a doc is inconsistent (only reachable by
tampered or racing data): a placement that has members keeps them and loses its own `groupId`; past
200, the later members (stored order) drop out.

Wires: a member keeps its own wires. Whenever a write (or the mirror) moves a member, attached wire
ends translate by the member's delta on the same sheet/page (`translateRouteEnds`, the move rule) — so
a device moved into a rack drags its wire ends onto the rack, and they follow the rack afterwards.

## 2. Pure rules — `src/lib/design/grid-groups.ts`

Client-safe (type-only store import).

| Function | What |
|---|---|
| `MAX_GROUP_MEMBERS` | 200 |
| `memberCounts(placements)` | holderId → member count |
| `membersOf(placements, holderId)` | the members, stored order |
| `isMemberOf(pl, byId)` / `holderOf` | the live holder, or null |
| `holdRefusal(holder, placements)` | why a device can't hold (curtain, is a member) or null |
| `groupRefusal(placements, holderId, memberIds, defaultOpt)` | the all-or-nothing check for putting devices in: holder exists/eligible; each member exists, isn't the holder, isn't a curtain, doesn't hold, is the same option, the **same sheet + page** (**default** — a wire can't follow across pages), and the count stays ≤ 200 |
| `takeOutPositions(holder, n)` | n spots beside the holder: a row to the right (step 0.025 of the page), wrapping every 8, flipping left when the right edge is near, clamped 0..1 |
| `deletePlan(placements, ids, mode)` | which ids go and which members are taken out: `"delete"` adds every member of a removed holder; `"keep"` takes them out beside it |
| `membersLeftBehind(placements, ids)` | members of a holder in `ids` that aren't in `ids` — when > 0 the editor asks |
| `withMembers(placements, ids)` | ids + members of any holder among them (copy, Cut) |
| `settleGroups(placements, defaultOpt)` | §1 repair + mirror; returns the new array |
| `dropHolderAt(at, candidates, draggedIds, …)` | the marker a drag would drop into, or null |
| `nestRows(rows)` | spreadsheet nesting (§5) |

## 3. Store writes (`src/lib/stores/grid-projects.ts`)

- **`setPlacementsGroup(projectId, items: {id, groupId: string | null, x?, y?}[])`** — one
  `batchEdit`, all-or-nothing. `groupId` = put in (checked by `groupRefusal`, per target holder);
  `null` = take out, to `x,y` when given (undo) else `takeOutPositions` beside the holder. A grouped
  member and its holder lose their #211 `auto` tag (a hand edit — a re-fill then keeps both).
  Returns the previous `{id, groupId|null, x, y}` for undo. Taking out a device that isn't in a group
  is a no-op for it.
- **`addPlacementInside(projectId, {holderId, partId, by})`** — "Place inside": a new placement at the
  holder's sheet/page/x/y/option with `groupId`, designator stamped like any new device; refused when
  the holder is gone, a curtain, a member, or full.
- **`removePlacements(projectId, ids, {members?: "delete" | "keep"})`** — `deletePlan` decides; absent
  mode = `"keep"` (**default** — nothing is ever deleted that wasn't named). The returned
  `RemovedBundle` gains `regroup?: {id, groupId}[]` (members taken out); deleted members ride in
  `placements` with their `groupId`.
- **`restoreItems`** — puts records back (members' `groupId` kept; a holder restored in the same
  bundle counts), then re-links `regroup` items whose holder is back, then `settleGroups`.
- **`pastePlacements`** — a `PasteItem` may carry `groupSrcId` (its holder's `srcId` in the same
  paste); the copy joins the pasted holder. A member pasted without its holder lands as a plain
  device.
- **`copyOptionMembers`** remaps `groupId` through the id map (second pass — a member may precede
  its holder). Revisions snapshot/restore `placements` verbatim, so groups ride along; restore ends
  with `settleGroups`.
- `movePlacement(s)`, `setPlacementsSpace`, `removePlacement`, `replaceAutoPlacements` and
  `restoreRevision` end with `settleGroups` (members follow; orphans are released).
- Removals with no question — `removePlacement` and the riser editor's row delete / qty cut
  (`removeNodeDevices`, `setNodeDeviceQty`) — keep a removed holder's devices on the plan beside it
  (`keepMembersBeside`, the "keep" answer). The unused `removePlacementAction` was deleted (review).
- `setPlacementsPart` on a holder: unchanged (the holder keeps its id, its members stay).

Actions (`grid/[id]/actions.ts`): `setPlacementsGroupAction`, `placeInsideAction` (same part gate as
`placeDeviceAction`, adopts a catalog result into the library), `removePlacementsAction(…, members?)`;
`cleanRestoredPlacement` carries a well-formed `groupId`; `restoreItemsAction` cleans `regroup`.

## 4. Undo

| Step | forward | inverse |
|---|---|---|
| Move in (button or drag) | `group` items `{id, groupId: holder}` | `group` previous `{id, groupId: null, x, y}` (back to the old spot) |
| Take out | `group` `{id, groupId: null}` | `group` `{id, groupId: holder}` |
| Place inside | `restore` bundle (record with `groupId`) | `remove` ids |
| Delete holder (either answer) | `remove` ids + `members` | `restore` bundle (+ `regroup`) |

New `GridCommand`: `{ kind: "group"; items: {id; groupId: string | null; x?; y?}[] }`;
`remove` gains `members?: "delete" | "keep"`.

## 5. UI

- **Plan**: members are not drawn, hit-tested, marquee-selected or wire-snapped. A holder's label
  reads `RK-1 · 6` (member placements, not units — **default**) and its hover lists "6 devices
  inside". Members stay in the plan legend.
- **Place inside**: Property Editor (one device that can hold) → **Place inside**. A banner over the
  plan says "Placing inside RK-1 — click parts in the Product Library; each click adds one." with
  **Done**; every library click (tiles, catalog results, the estimate tray) adds a member instead of
  arming; Esc / Done / picking a tool ends it. The holder's ring is drawn in the accent colour.
- **Move existing in**: several devices selected → **Move into <holder>** (the one selected device
  that already holds, else a menu of the eligible selected devices). Refusals come back as the
  server's sentence.
- **Drag onto holder**: while dragging markers, an eligible holder under the dragged marker gets an
  accent ring and "Drop into RK-1" hint; releasing there groups the dragged devices (their old spots
  are the undo). Anything else is a normal move.
- **Take out**: a member selected (Spreadsheet, Browser) → "Inside RK-1 · **Take out**"; a holder →
  "Holds 6 · **Take all out**". Several → **Take out of group**.
- **Delete a holder** (Property Editor, toolbar, Delete key): a banner asks every time — **Delete the
  6 devices inside too** · **Keep them on the plan beside it** · Cancel. **Cut** of a holder copies
  and removes the whole group, no question (**default**).
- **Copy / duplicate** a holder copies its members too (pasted as a new group).
- **Nudge / align / distribute** skip members (they have no spot of their own).
- **Spreadsheet → Devices**: a holder row, then its members indented with "↳"; a member's Space
  cell reads its holder's room ("with RK-1"), not a pin control. Sorting and filtering keep members
  directly under their holder (members sorted among themselves by the same column); a member whose
  holder is filtered out stays on its own row with "in RK-1" after its designator (**default**).
- **Schedule** (`/schedule`, editor Spreadsheet → Schedule, drawing-set E-60x): within the holder's
  space section, a holder that has members gets its own row and its members follow, indented, merged
  by part among themselves; everything else still merges by part. Units unchanged.
- **Browser tree**: members are child devices of their holder's node.
- **Drawing set plan sheets**: members are not drawn (no spot); they print on the schedule.

## 6. Unchanged

Pricing and BOM (merged by part, members count as normal placements), designators (members keep
their own), risers (members sit in the holder's room), Auto fill (makes no groups), rack assemblies'
own RU layout (not coupled — open question for Jeff).

## 7. Edge cases

| Case | Behaviour |
|---|---|
| Lot (`qty`) member | allowed; counts its units in the BOM/schedule; the badge counts it once |
| Curtain | refused as holder and as member |
| Holder on another option / sheet / page | refused (`groupRefusal`) |
| A holder into another holder | refused ("A device that holds others can't go inside another") |
| Paste of a holder | its members come along as the new holder's members |
| Replace part on a holder | members stay |
| Holder deleted through an old path / revision / re-fill | `settleGroups` releases orphans where they stand |
| 201st member | refused ("RK-1 already holds 200 devices") |
| Grouping moves a member with wires | wire ends follow onto the holder; back on undo |
