# Punch #226 — The Grid: curated device types replace raw vendor categories

Date: 2026-09-26 · Branch `feat/punch-inbox-tasks`. Brainstormed with Jeff in chat.

Jeff: "Can we brainstorm how we solve the fact that there are too many categories in the grid? I need
to resolve that as it is too many to be functional." It hurts in **all four** places: finding a part
to place, Grid Settings lists, Layers/legend, and the Catalog taxonomy screen.

Picks: **curated device types** (not a catalog rename, not a palette-only fix); the 25-type starting
list below as-is; palette gets **favorites, recently used, a manufacturer filter, and hides unmapped
parts** (search still finds them).

## Recon (why)
- `CatalogPart.category` (`src/lib/stores/catalog.ts` ~66) is one free-text field copied from vendor
  sheets (52 dealer brands via `scripts/convert-dealer-sheets.py`, sheet columns / section rows /
  per-brand defaults); prod has 37,403 parts → likely hundreds of distinct categories. No
  subcategory. `src/lib/catalog-taxonomy.ts` maps ~28 categories to 6 groups / 3 trades.
- Palette (`design/grid/[id]/editor.tsx` ~1371-1480): 6 scope chips, substring search, 60-row cap,
  flat list; the Grid library copies every catalog part 1:1 on first use (`grid-catalog.ts` 83-102).
- Bug: `scopeFor()` (`grid-catalog.ts` ~48-55) falls back to **Lighting**, and `scopeOfPart`
  (`grid-scopes.ts` ~104) trusts it first → unknown parts flood the Lighting chip instead of
  Unscoped (#48 intent).
- Raw categories are listed in Grid Settings → Category icons (`grid-icons.ts` `symbolCategoryRows`
  ~457), Catalog "Categories & trades" (`taxonomy-card.tsx`), and Layers/legend
  (`layers-panel.tsx`, placement `category`).

## Model
- Settings blob `gridDeviceTypes`: `{ key, label, scope: GridScope, order, archived?, icon? }[]`,
  seeded (keys are slugs of the labels):
  - Lighting: Fixtures · Dimming & Power · Control & Networking · Lighting Accessories
  - Rigging: Hoists & Motors · Truss & Pipe · Rigging Hardware · Rigging Control
  - Curtains: Drapery · Tracks & Hardware
  - Audio: Speakers · Microphones · Mixing & Processing · Amplifiers · Assistive Listening · Intercom
  - Video: Displays & Projectors · Screens & Lifts · Cameras · Switching & Distribution
  - General (Unscoped): Cable & Connectors · Racks & Cases · Power Distribution · Networking ·
    Parts & Consumables
- Settings blob `gridTypeMap`: `{ [normalizedRawCategory]: { typeKey, by: "auto" | "admin", at } }`
  (normalized = trimmed, lowercased, whitespace collapsed).
- **Auto-apply (Jeff, 2026-09-26):** confident matches apply without a click. Whenever the map is
  read for a catalog category that has no entry, a `"high"` confidence suggestion is written as an
  `auto` entry (first run maps the whole existing catalog; new categories from later imports get the
  same treatment). `"low"` / no suggestion stays unmapped and appears in the review list. An admin
  edit writes `admin` and is never overwritten by auto. The review screen shows auto entries with an
  "auto" chip so they can be spot-checked.
- Existing per-raw-category icon settings are kept as the "Advanced" overrides, so nothing already
  configured is lost.
- Pure `src/lib/design/device-types.ts`: `deviceTypesFrom(raw)` (seed/sanitize/merge like other
  settings lists), `normalizeCategory`, `suggestDeviceType(category, sampleDescs?) → { typeKey,
  confidence: "high" | "low" } | null` (keyword rules per type, e.g. hoist/motor/chain → Hoists &
  Motors; truss/pipe/batten → Truss & Pipe; speaker/loudspeaker/sub → Speakers; mic/wireless →
  Microphones; dsp/mixer/console(audio) → Mixing & Processing; amp → Amplifiers; assistive/ALS/loop
  → Assistive Listening; intercom/comms/clear-com → Intercom; display/projector/monitor → Displays &
  Projectors; screen/lift → Screens & Lifts; camera/PTZ → Cameras; switcher/matrix/distribution/
  extender/HDBaseT → Switching & Distribution; fixture/luminaire/LED/spot/wash/ellipsoidal/fresnel/
  PAR/cyc → Fixtures; dimmer/relay/power(lighting) → Dimming & Power; console(lighting)/gateway/node/
  DMX/sACN → Control & Networking; lens/iris/gobo/clamp/yoke → Lighting Accessories; drape/curtain/
  scrim/cyc fabric/velour → Drapery; track/carrier/traveler → Tracks & Hardware; shackle/wire rope/
  sling/clamp(rigging) → Rigging Hardware; rigging controller/motor control → Rigging Control;
  cable/connector/adapter → Cable & Connectors; rack/case/cart → Racks & Cases; power distro/PDU →
  Power Distribution; network switch/router/access point → Networking; lamp/parts/consumable/
  filter/gel → Parts & Consumables), `typeOfPart(part, map, types) → typeKey | null`,
  `scopeOfType`. Unmapped → `null` → scope **Unscoped**.
- `scopeOfPart` uses the device type's scope first; the `scopeFor()` Lighting fallback becomes
  Unscoped (fixes the bug for every surface).

## Screens
1. **Catalog → Device types** (replaces the raw list in "Categories & trades" as the primary
   editor; `manage_users`): the type list (rename, add, reorder, archive, merge = reassign a type's
   categories to another then archive), and the mapping table of every distinct raw category with
   part count, suggested type + confidence, current type (with an "auto" chip when auto-applied).
   Unmapped first. Bulk actions: "Accept all suggestions" (applies the low-confidence ones too), select
   rows → assign type. The old group/trade map stays available
   under an "Estimating groups & trades" section (it feeds estimating, not the Grid).
2. **Palette**: tabs **Favorites · Recent · All**; in All: scope chips → type chips for that scope
   (+ counts), manufacturer `<select>` (manufacturers present in the current scope/type), search box.
   Without a search, parts with no device type are hidden ("N unmapped parts hidden — map them in
   Catalog → Device types" link for admins). With a search, all parts match (unmapped shown with an
   "Unmapped" chip). Row cap stays 60 with "narrow the search".
   - **Favorites**: per user, star toggle on each palette row; stored in a per-user settings blob
     `gridFavorites:<userId>` (list of part ids, cap 300).
   - **Recent**: per user, the last 40 distinct part ids the user placed (any design), most recent
     first, updated by the placement server action(s); blob `gridRecent:<userId>`.
3. **Grid Settings → Symbols**: icons are set per **device type** (≈25 rows). The existing
   per-raw-category icon map stays as "Advanced: per-category overrides" (collapsed, filterable, only
   categories that have an override or are used in Grid designs, with "show all"). Resolution order:
   raw-category override → device-type icon → existing defaults → generic glyph. Colours keep the
   #206 rules (scope/group/trade).
4. **Layers panel + plan legend**: group placements by device type (label), with "Unmapped" last;
   seeded placements' free-text `category` still shows as a sub-label, never as its own layer.

## Not in scope
Renaming catalog categories; changing importers; server-side palette search/paging (the palette still
receives the part list it receives today); Equipment map (already a curated 46-row vocabulary).

## Testing
Pure: seed/merge rules, normalization, suggestion rules on ≥ 40 realistic raw category strings (incl.
the dealer-sheet per-brand defaults and "Uncategorized" → null), `typeOfPart`, scope fallback now
Unscoped. Async: map save/merge, favorites/recent caps and ordering, placement updates Recent.
Source: no Grid surface lists raw categories as top-level entries. Four gates + `next build`.
