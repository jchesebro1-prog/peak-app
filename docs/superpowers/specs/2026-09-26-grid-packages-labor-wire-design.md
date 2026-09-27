# Punch #228–#233 — Grid packages: hardware assemblies, "not included", BOM accessories, wire pull + labor by tier, relabels

Date: 2026-09-26 · Batch 2 (`feat/punch-inbox-tasks`; #230 after `feat/punch-lane-b`'s #226 merges).

Jeff (2026-09-26):

> We need to add hardware as an assembly. So we can have the Chain Wrap be an Assembly termination
> method. This ultimately will be a catalog item that loads as batten terminations. But Assemblies for
> Hardware should exist. We also need the option on some of these that end up just not having a
> solution in certain categories. This would mostly pertain to the good tier. In the BOM, we should add
> a line item in all of the categories that just allow for additional accessories from the catalog if
> needed for that category. […] We also need to add the option for every package that defines wire
> pull based on an equation and then with a multiplier for each tier as the higher tiers do require
> extra costs. Labor needs to be defined via a calculation with a cost multiplier per tier as the higher
> tiers do require extra labor for every system. [Relabels below.]

Picks (chat): relabels as below (Battery backup → Emergency; Processor → Power Controls – Production;
Distro system → Labor); wire pull footage from **venue size**; labor = **% of system material**;
both apply to **Grid Auto and Quick Design**.

Constraints from #211 decisions: stable `system:itemKey` keys (D301), map-only pricing (D303), the
engine carries no dollars (D304 — `equipment-pricing.ts` is the only pricing step), Incomplete gate
(D310/D322), per-option choices (D312), Quick Design overrides keyed by label (D324).

## #233 — Relabels (keys unchanged except the one move)
| key | old label | new label |
|---|---|---|
| rigging:aircraftCable | Aircraft cable | Suspension Method |
| rigging:chainWrap | Chain wrap, 3 ft | Batten Termination |
| rigging:terminationKit | Termination kit | Beginning Termination |
| controls:consoleTouch | Console touch screen | Console Accessories |
| controls:batteryBackup | Battery backup | Emergency |
| controls:processor | Processor | Power Controls – Production |
| controls:button | Button | Power Controls – Architectural |
| controls:archTouch | Architectural touch screen | Architectural Controls |
| controls:inputStation | Input station | DMX Distribution |
| controls:outputStation → **lighting:cablePackage** | Output station | Cable Package (moves to Lighting/"Fixtures") |
| controls:distro | Distro system | Labor |
- Labels live in `equipment-vocab.ts` and are duplicated in `quick/engine.ts` `eq(key, desc…)` — change both (one source of truth if practical: engine reads the vocab label by key).
- Saved Quick Design qty overrides keyed by the old label keep working: a read-time alias map
  old label → new label (and old key → new key for the moved row). Equipment-map entries for
  `controls:outputStation` are read as `lighting:cablePackage` (alias on read; next save writes the
  new key). The equation for Cable Package keeps Output station's formula, now under Lighting.
- The Controls "Labor" row stays an ordinary mapped row (Jeff's pick); it can be set to "Not included"
  (#229) when #232's calculated labor covers it.

## #229 — "Not included" per row per tier
- New `EquipCell` kind `{ kind: "none" }` ("Not included"), admin-set in Grid Settings → Equipment map
  like the other kinds. It counts as resolved (never "Incomplete", never refuses a quote), prices $0,
  places nothing, emits no quote line; Auto cards / Quick Design show "Not included" for that item.

## #228 — Hardware assemblies
- `FixtureKind` gains `"hardware"` (alongside fixture/system) through every place that today treats
  non-system as fixture (types, sanitize, normalize/convert, `fixtureAssembliesFrom`, builder tabs/
  buttons + form, Equipment-map picker labels, swap candidates). A hardware assembly's virtual part
  scope comes from the row/system it's mapped on (Rigging for terminations), not the Lighting default.
- Equipment-map rigging rows (Suspension Method, Batten Termination, Beginning Termination, …) accept
  hardware assemblies; e.g. Batten Termination → "Chain Wrap" hardware assembly.

## #230 — BOM grouped by category, "+ Add accessory" per category
- The Grid editor BOM groups lines under category headings: Rigging, Curtains, Lighting, Audio, Video,
  Controls, General (device scope via #226 device types when present, else the existing scope rules);
  wires/curtains/custom items/labor land in their group.
- Each heading has "+ Add accessory": a catalog search (limited to parts of that category's device
  types, with "search all" fallback) that adds a **non-placed BOM line** `{ id, partId, qty, scope }`
  stored option-scoped (like `customItems`), priced exactly like a placed part of the same partId
  (tier price), editable qty, removable, carried by option copies and revisions, included in the draft
  quote.

## #231 — Wire pull per system, by venue size × tier
- Per system (Lighting, Audio, Video, Controls, Rigging) a wire-pull footage:
  `feet = (stageWidth + stageDepth + houseDepth) × runsPerSystem × tierMultiplier`, using the design's
  venue dimensions (whatever dims the intake/Quick Design already carry; a missing dimension counts 0 and
  the line notes it).
- Estimating Rules gain, per system: `runs` (default **0 = off**, so nothing changes until Jeff sets it),
  and tier multipliers Good/Better/Best (defaults 1.0 / 1.15 / 1.3).
- Priced through a new Equipment-map row per system "Wire pull" (unit ft; tier cells map to a
  per-ft wire part, allowance, or Not included). Shows on Auto cards / Quick Design / the BOM group.

## #232 — Labor per system, % of material × tier
- Per system: `labor$ = systemMaterial$ × laborPct × tierMultiplier`, where system material = that
  system's priced equipment (+ wire pull + accessories), excluding labor.
- Estimating Rules per system: `laborPct` (default 18% — today's Quick Design install %) and tier
  multipliers Good/Better/Best (defaults 1.0 / 1.15 / 1.3). The tier used is the system's chosen Auto
  tier (Grid) / the design tier (Quick Design); none chosen → 1.0.
- Quick Design's flat install % is replaced by this per-system calc. In the Grid, the BOM's
  "Labor (suggested)" hours-per-device section is replaced by one labor line per system group
  (`Labor — Lighting`, …) with the computed $, editable (a typed $ overrides), included in the quote as
  a priced line. The old hours-per-device suggestion is removed.

## Testing
Relabels + alias migration (old labels/keys still resolve); "none" cell through sanitize/merge/price/
status/summary/quote gate; hardware kind through the fixture pipeline and Equipment-map picker; BOM
grouping + accessory lines (store, pricing, option copy/revision, quote); wire-pull and labor formulas
per system/tier incl. defaults (runs 0 → no wire line) and missing dims; Quick Design totals change only
by the labor model (list expected deltas). Four gates + `next build`.
