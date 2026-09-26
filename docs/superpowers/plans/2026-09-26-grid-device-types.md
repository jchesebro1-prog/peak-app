# Grid Device Types (#226) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Grid's hundreds of raw vendor categories with ~25 curated device types, so the palette, Grid Settings, Layers/legends and the Catalog taxonomy screen become usable again. Confident category→type matches apply on their own.

**Architecture:** A pure, client-safe module (`src/lib/design/device-types.ts`) owns the type vocabulary, the keyword suggestion rules, the category→type map rules and the scope fallback fix. A server store (`src/lib/stores/device-types.ts`) keeps the type list, the type map, per-user favorites and per-user recent in doc-store **blobs** (the `getBlob`/`setBlob` precedent from `dashboard_layouts:<userId>` and `grid_equipment_map`). Each Grid surface reads the map through `loadDeviceTypeContext(catalog)`, which auto-applies high-confidence matches. `gridPartsFrom` stamps every `PartLite` with its `deviceType` + label and the type's scope, so every surface downstream (palette, Layers, legends, drawing set) sees the same answer.

**Tech Stack:** Next.js 16 App Router (server components + server actions), TypeScript, Drizzle on Postgres/PGlite (`blobs` table via `src/db/doc-store.ts`), harness `scripts/test-review-and-spec.ts` (tsx, `ok()` assertions, tag `#226`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-26-grid-device-types-design.md` (as amended by commit 000dd7fe: **auto-apply**).
- Type list blob id `gridDeviceTypes` (`{ types: DeviceType[] }`); type map blob id `gridTypeMap` (one top-level key per normalized raw category → `{ typeKey, by: "auto" | "admin", at }`); per-user blobs `gridFavorites:<userId>` (cap **300**) and `gridRecent:<userId>` (last **40** distinct, most recent first). All four are doc-store blobs (`src/db/doc-store.ts` `getBlob`/`setBlob`), not the `app_settings` row.
- The 25 seeded types, keys = slugs of the labels, in this order: Lighting: Fixtures · Dimming & Power · Control & Networking · Lighting Accessories — Rigging: Hoists & Motors · Truss & Pipe · Rigging Hardware · Rigging Control — Curtains: Drapery · Tracks & Hardware — Audio: Speakers · Microphones · Mixing & Processing · Amplifiers · Assistive Listening · Intercom — Video: Displays & Projectors · Screens & Lifts · Cameras · Switching & Distribution — General (Unscoped): Cable & Connectors · Racks & Cases · Power Distribution · Networking · Parts & Consumables.
- Normalized raw category = trimmed, lowercased, whitespace collapsed.
- **Auto-apply:** whenever the map is read for a catalog category that has no entry, a `"high"` suggestion is written as an `auto` entry. `"low"`/no suggestion stays unmapped for review. An `admin` entry is **never** overwritten by auto. The review screen marks auto rows with an "auto" chip. "Accept all suggestions" also applies the low-confidence ones.
- Unmapped → `null` type → scope **Unscoped**. The old `scopeFor()` Lighting fallback becomes Unscoped.
- Existing per-raw-category icon settings (`settings.gridCategoryIcons`) are kept as the "Advanced: per-category overrides". Icon resolution: raw-category override → device-type icon → existing defaults → generic glyph. Colours keep the #206 rules.
- Palette: tabs **Favorites · Recent · All**; in All: scope chips → type chips for that scope (+ counts), manufacturer `<select>`, search. Without a search, unmapped parts are hidden ("N unmapped parts hidden — map them in Catalog → Device types" link for admins). With a search, all parts match; unmapped rows show an "Unmapped" chip. Row cap stays **60** with "narrow the search".
- Catalog → Device types is `manage_users` only. The old group/trade map stays available as "Estimating groups & trades".
- Not in scope: renaming catalog categories, changing importers, server-side palette search/paging, the Equipment map.
- **Client components never import a store module** (`@/lib/stores/*` or `@/db*`), not even transitively through a non-pure lib.
- No DECISIONS.md / PUNCHLIST.md edits.
- Shell: every command starts with `export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks`. Never run `npm run dev` or any `db:*` script, and never open `.data/pglite`. `npm run test:specs` uses its own throwaway PGlite dir.
- Gates per task: `npx tsc --noEmit` (0 errors), `npm run test:specs` (0 `FAIL`, report the PASS count), `npx eslint <changed files>` (0 errors). Tasks 2–4 (UI) also need `npx next build` to pass.
- Commit per task: `feat(grid): <summary> (#226)` + blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. If `.git/index.lock` exists, wait 2 s and retry. Never `git stash`. Commit instead.
- Other in-flight work on this branch touches `editor.tsx`, `actions.ts` and the harness. **Find insertion points by the landmark text quoted in each step.** Line numbers are hints from commit `000dd7fe`.

## Before Task 1 (once)

- [ ] **Check the toolchain and record the baseline**

```bash
export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
ls node_modules/.bin/tsc node_modules/.bin/next || npm ci
ps aux | grep -E "tsx|next dev" | grep -v grep   # must print nothing touching this worktree's .data
npm run test:specs 2>&1 | tee /tmp/claude-226-baseline.txt | tail -3
grep -c '^PASS ' /tmp/claude-226-baseline.txt
```
Expected: `ALL PASSED`. Note the PASS count as `BASE`.

## File map

| File | Task | Responsibility |
|---|---|---|
| `src/lib/design/device-types.ts` (new) | 1 | Pure: types, seeds, default icons, slug/normalize, suggestion rules, map rules, review rows, list helpers, layer rows, keyword scope fallback |
| `src/lib/stores/grid-catalog.ts` | 1 | `scopeFor` delegates to `keywordScopeOf` (Unscoped fallback) |
| `src/lib/design/grid-bom.ts` | 1 | `PartLite.deviceType` / `deviceTypeLabel` |
| `src/lib/design/grid-parts.ts` | 1 | `opts.deviceTypes`: stamp type, label, type scope |
| `src/db/doc-store.ts` | 2 | `setBlobKeysIfAbsent` (atomic, existing keys win) |
| `src/lib/stores/device-types.ts` (new) | 2 | Blob store: types, map + auto-apply, assign, accept, merge, icons, favorites, recent |
| `src/app/(app)/catalog/device-types/{page.tsx,device-types-client.tsx,actions.ts}` (new) | 2 | Catalog → Device types screen |
| `src/app/(app)/catalog/page.tsx`, `taxonomy-card.tsx` | 2 | Link + "Estimating groups & trades" rename |
| `src/app/(app)/design/grid/settings/page.tsx` | 2, 4 | Related link (2); type icons + Advanced overrides (4) |
| `scripts/smoke-routes.ts` | 2 | `/catalog/device-types` |
| `src/lib/design/grid-palette.ts` (new) | 3 | Pure palette filter (`paletteView`) |
| `src/app/(app)/design/grid/[id]/device-palette.tsx` (new) | 3 | Client palette: tabs, chips, manufacturer, stars |
| `src/app/(app)/design/grid/[id]/{editor.tsx,page.tsx,actions.ts}` | 3, 4 | Wire palette, favorites/recent (3); layers + legend + symbol ctx (4) |
| `src/lib/design/grid-icons.ts` | 4 | Type icons in `SymbolContext`, icon order, legend labels by type |
| `src/lib/design/grid-scopes.ts` | 4 | `typeLayerKey`, `isLayerVisible(..., typeKey)` |
| `src/app/(app)/design/grid/[id]/layers-panel.tsx` | 4 | Type rows under each scope |
| `src/app/(app)/design/grid/[id]/{riser,set,schedule}/page.tsx` | 4 | Resolve device types |
| `src/app/(app)/design/grid/settings/{device-type-icons-card.tsx (new),category-icons-card.tsx,actions.ts}` | 4 | Per-type icons; Advanced overrides |
| `scripts/test-review-and-spec.ts` | 1–4 | `#226` assertions (append at the very end of the file; async functions chained before `.finally(() => teardownFixtures())`) |

---

### Task 1: Pure device-types module + scope fallback fix

**Files:**
- Create: `src/lib/design/device-types.ts`
- Modify: `src/lib/stores/grid-catalog.ts` (`scopeFor`, ~lines 44-51)
- Modify: `src/lib/design/grid-bom.ts` (`PartLite`, after the `trade?: string | null;` field, ~line 54)
- Modify: `src/lib/design/grid-parts.ts` (whole `gridPartsFrom`)
- Test: `scripts/test-review-and-spec.ts` (append at end)

**Interfaces:**
- Consumes: `isGridLayer`, `UNSCOPED`, `GridLayer` from `src/lib/design/grid-scopes.ts`.
- Produces (all exported from `@/lib/design/device-types`):
  - `type DeviceType = { key: string; label: string; scope: GridLayer; order: number; archived?: boolean; icon?: string | null }`
  - `type TypeMapEntry = { typeKey: string | null; by: "auto" | "admin"; at: number }`, `type TypeMap = Record<string, TypeMapEntry>`, `type DeviceTypeContext = { types: DeviceType[]; map: TypeMap }`, `type Suggestion = { typeKey: string; confidence: "high" | "low" }`
  - `type TypeReviewRow = { key: string; category: string; count: number; suggestion: Suggestion | null; entry: TypeMapEntry | null; typeKey: string | null; status: "unmapped" | "auto" | "admin" }`, `type TypeLayerRow = { key: string; label: string; count: number; subs: string[] }`
  - consts `DEVICE_TYPES_BLOB = "gridDeviceTypes"`, `TYPE_MAP_BLOB = "gridTypeMap"`, `favoritesBlobId(userId)`, `recentBlobId(userId)`, `FAVORITES_CAP = 300`, `RECENT_CAP = 40`, `MAX_DEVICE_TYPES = 60`, `UNMAPPED_TYPE = "__unmapped"`, `ASSEMBLY_TYPE = "__assembly"`, `ALLOWANCE_TYPE = "__allowance"`, `UNMAPPED_LABEL = "Unmapped"`, `SEED_DEVICE_TYPES`, `DEFAULT_TYPE_ICONS`
  - `slugOf(label): string`, `normalizeRawCategory(raw): string`, `deviceTypesFrom(raw: unknown): DeviceType[]`, `suggestDeviceType(category, sampleDescs?): Suggestion | null`, `sanitizeTypeMap(raw: unknown): TypeMap`, `typeOfCategory(category, map, types): string | null`, `typeOfPart(part: { category: string }, map, types): string | null`, `scopeOfType(key, types): GridLayer`, `typeLabel(key, types): string`, `keywordScopeOf(p): GridLayer`, `autoTypeEntries(parts, map, types, now): TypeMap`, `typeReviewRows(parts, map, types): TypeReviewRow[]`, `acceptSuggestionEntries(rows, types, now): TypeMap`, `assignEntries(categories, typeKey | null, now): TypeMap`, `mergeTypeEntries(map, fromKey, toKey, now): TypeMap`, `cleanDeviceTypesInput(input, current): { ok: true; types } | { ok: false; error }`, `withTypeIcons(types, icons: Record<string, string | null>): DeviceType[]`, `deviceTypeIcons(types): Record<string, string>`, `typeKeyOfPart(p): string`, `typeLayerRows(items, types): Map<GridLayer, TypeLayerRow[]>`, `cleanIdList(raw, cap): string[]`, `withRecent(list, id, cap?): string[]`, `toggleInList(list, id, cap?): { ok: true; list: string[]; on: boolean } | { ok: false; error: string }`
  - `PartLite` gains `deviceType?: string | null` and `deviceTypeLabel?: string | null`.
  - `gridPartsFrom(symbols, catalog, categoryMap, opts)` accepts `opts.deviceTypes?: DeviceTypeContext`.

> Naming note: the spec calls the normalizer `normalizeCategory`, but `grid-scopes.ts` already exports a `normalizeCategory` for the placement label, and the editor imports it. This plan names the new one `normalizeRawCategory` so the two never collide.

- [ ] **Step 1: Write the failing tests** — append to the very end of `scripts/test-review-and-spec.ts`:

```ts
/* ======================================================================
   #226 Grid device types — Task 1: the pure model (seeds, suggestion
   rules on realistic raw categories incl. the dealer-sheet per-brand
   defaults, the map rules, review rows, list helpers, the scope fix).
   ====================================================================== */
import {
  SEED_DEVICE_TYPES as dt226Seed, DEFAULT_TYPE_ICONS as dt226Icons, deviceTypesFrom as dt226From, slugOf as dt226Slug,
  normalizeRawCategory as dt226Norm, suggestDeviceType as dt226Suggest, typeOfPart as dt226TypeOf, scopeOfType as dt226ScopeOf,
  keywordScopeOf as dt226Keyword, autoTypeEntries as dt226Auto, sanitizeTypeMap as dt226Sanitize, typeReviewRows as dt226Rows,
  acceptSuggestionEntries as dt226Accept, assignEntries as dt226Assign, mergeTypeEntries as dt226Merge,
  cleanDeviceTypesInput as dt226Clean, typeLayerRows as dt226Layers, typeKeyOfPart as dt226KeyOf, typeLabel as dt226Label,
  deviceTypeIcons as dt226TypeIcons, withTypeIcons as dt226WithIcons, cleanIdList as dt226Ids, withRecent as dt226Recent,
  toggleInList as dt226Toggle, UNMAPPED_TYPE as DT226_UNMAPPED, ASSEMBLY_TYPE as DT226_ASM, type TypeMap as DT226Map,
} from "@/lib/design/device-types";
import { gridPartsFrom as dt226Parts } from "@/lib/design/grid-parts";
import { scopeOfPart as dt226ScopeOfPart } from "@/lib/design/grid-scopes";
import { isGridIconId as dt226IsIcon } from "@/lib/design/grid-icons";

{
  const j = (x: unknown) => JSON.stringify(x);
  ok(dt226Seed.length === 25 && new Set(dt226Seed.map((t) => t.key)).size === 25, "#226 model: 25 seeded device types with unique keys");
  ok(
    dt226Seed.map((t) => t.key).join(",") ===
      "fixtures,dimming-power,control-networking,lighting-accessories,hoists-motors,truss-pipe,rigging-hardware,rigging-control,drapery,tracks-hardware,speakers,microphones,mixing-processing,amplifiers,assistive-listening,intercom,displays-projectors,screens-lifts,cameras,switching-distribution,cable-connectors,racks-cases,power-distribution,networking,parts-consumables",
    "#226 model: seed keys are slugs of the labels, in the spec's order"
  );
  ok(dt226Seed.filter((t) => t.scope === "Unscoped").map((t) => t.label).join("|") === "Cable & Connectors|Racks & Cases|Power Distribution|Networking|Parts & Consumables",
    "#226 model: the General five are Unscoped");
  ok(dt226Seed.every((t) => dt226IsIcon(dt226Icons[t.key])), "#226 model: every seeded type has a registered default icon");
  ok(dt226Slug("Dimming & Power") === "dimming-power" && dt226Slug("  A/V  Racks!! ") === "a-v-racks", "#226 model: slugOf");
  ok(dt226Norm("  Motorized   HOIST ") === "motorized hoist" && dt226Norm(null) === "" && dt226Norm("__proto__") === "",
    "#226 model: normalizeRawCategory trims, lowercases, collapses whitespace (and refuses __proto__)");

  // seed / sanitize / merge
  ok(j(dt226From(undefined)) === j(dt226Seed) && dt226From(undefined) !== dt226From(undefined), "#226 model: absent → fresh seed copies");
  const stored = dt226From([
    { key: "fixtures", label: "Luminaires", scope: "Lighting", order: 5, icon: "wash" },
    { key: "fixtures", label: "Dup", scope: "Lighting", order: 1 },
    { key: "Bad Key", label: "x", scope: "Lighting", order: 1 },
    { key: "fog", label: "Fog & Haze", scope: "Lighting", order: 900, archived: true },
    { key: "x", label: "", scope: "Lighting", order: 2 },
    { key: "y", label: "Y", scope: "Nope", order: 2 },
  ]);
  ok(stored[0].key === "fixtures" && stored[0].label === "Luminaires" && stored[0].icon === "wash", "#226 model: a stored type keeps its rename and icon");
  ok(stored.filter((t) => t.key === "fixtures").length === 1 && !stored.some((t) => ["Bad Key", "x", "y"].includes(t.key)),
    "#226 model: duplicate keys, bad keys, blank labels and unknown scopes are dropped");
  ok(stored.length === 26 && stored.some((t) => t.key === "fog" && t.archived) && stored.some((t) => t.key === "parts-consumables"),
    "#226 model: seeds missing from a stored list are merged back in; archived customs stay");

  // suggestion rules — realistic raw categories (scripts/catalog-import-data.json,
  // the dealer-sheet BRAND_CATEGORY defaults in scripts/convert-dealer-sheets.py,
  // and common vendor-sheet section names)
  const CASES: Array<[string, string | null, "high" | "low" | null]> = [
    ["Fixtures", "fixtures", "high"], ["Track", "tracks-hardware", "high"], ["Pipe", "truss-pipe", "high"],
    ["Loftblocks", "rigging-hardware", "high"], ["Headblocks", "rigging-hardware", "high"], ["Mule Block", "rigging-hardware", "high"],
    ["Arbor", "rigging-hardware", "high"], ["Standard Arbor", "rigging-hardware", "high"], ["Front Arbor", "rigging-hardware", "high"],
    ["Floor Block", "rigging-hardware", "high"], ["Manual Hoist", "hoists-motors", "high"], ["Motorized Hoist", "hoists-motors", "high"],
    ["Rope Lock", "rigging-hardware", "high"], ["Hardware", "rigging-hardware", "high"], ["Shoes", "rigging-hardware", "high"],
    ["Wire Mesh Strain Reliefs", "rigging-hardware", "high"], ["Mounts", "rigging-hardware", "high"], ["Curtains", "drapery", "high"],
    ["Networking", "networking", "high"], ["Racks", "racks-cases", "high"], ["Rack Accessories", "racks-cases", "high"],
    ["Rack Options", "racks-cases", "high"], ["Connectors", "cable-connectors", "high"], ["Cable Assemblies", "cable-connectors", "high"],
    ["Lighting Controls", "control-networking", "high"], ["Video Controls", "switching-distribution", "high"], ["Speakers", "speakers", "high"],
    ["Audio Controls", "mixing-processing", "high"], ["Power Distribution", "power-distribution", "high"], ["Power Controls", "dimming-power", "high"],
    ["Cable", "cable-connectors", "high"], ["Lamp", "parts-consumables", "high"], ["Cases", "racks-cases", "high"], ["Carts", "racks-cases", "high"],
    ["Parts", "parts-consumables", "high"], ["Distro Boxes", "power-distribution", "high"], ["Cable Crossovers", "cable-connectors", "high"],
    ["Wire", "cable-connectors", "high"], ["Control", "control-networking", "low"], ["Architectural", "fixtures", "low"],
    ["Uncategorized", null, null], ["Accessory", null, null], ["Atmospherics", null, null], ["Fabric", null, null], ["Labor", null, null],
    // dealer-sheet per-brand defaults
    ["Audio", null, null], ["AV Control", null, null], ["Networked AV", null, null], ["Video", null, null],
    ["Displays", "displays-projectors", "high"], ["LED Video", "displays-projectors", "high"], ["Screens & Lifts", "screens-lifts", "high"],
    ["AV Distribution", "switching-distribution", "high"], ["AV Infrastructure", null, null], ["Power", "power-distribution", "low"],
    ["Assistive Listening", "assistive-listening", "high"], ["Comms", "intercom", "high"], ["Stage Accessories", null, null],
    ["Rigging", "rigging-hardware", "low"], ["Staging", null, null], ["Lighting Control", "control-networking", "high"], ["Lighting", "fixtures", "low"],
    // common section names
    ["Moving Lights", "fixtures", "high"], ["Wireless Microphones", "microphones", "high"], ["Wireless", "microphones", "low"],
    ["Wireless Access Points", "networking", "high"], ["Power Amplifiers", "amplifiers", "high"], ["Digital Mixing Consoles", "mixing-processing", "high"],
    ["Lighting Consoles", "control-networking", "high"], ["PTZ Cameras", "cameras", "high"], ["Projection Screens", "screens-lifts", "high"],
    ["HDBaseT Extenders", "switching-distribution", "high"], ["Dimmers", "dimming-power", "high"], ["Chain Hoists", "hoists-motors", "high"],
    ["Motor Controllers", "rigging-control", "high"], ["Truss", "truss-pipe", "high"], ["Velour Curtains", "drapery", "high"],
    ["Travelers", "tracks-hardware", "high"], ["Clear-Com", "intercom", "high"], ["Gobos", "lighting-accessories", "high"],
    ["Clamps", "lighting-accessories", "low"], ["Network Switches", "networking", "high"], ["Stage Monitors", "speakers", "high"],
    ["Monitors", "displays-projectors", "low"], ["  motorized   HOIST ", "hoists-motors", "high"],
  ];
  for (const [cat, key, conf] of CASES) {
    const s = dt226Suggest(cat);
    ok(key === null ? s === null : s?.typeKey === key && s.confidence === conf,
      `#226 suggest: "${cat}" → ${key ?? "null"}${conf ? ` (${conf})` : ""} (got ${j(s)})`);
  }
  ok(j(dt226Suggest("Audio", ["QSC K12.2 powered loudspeaker", "QSC KS118 subwoofer", "Shure SM58 microphone"])) === j({ typeKey: "speakers", confidence: "low" }),
    "#226 suggest: sample descriptions vote a LOW-confidence type when the category says nothing");
  ok(dt226Suggest("Uncategorized", ["ETC Source Four ellipsoidal"]) === null && dt226Suggest("Fabric", ["velour"]) === null,
    "#226 suggest: generic and excluded categories never get a suggestion, whatever the parts say");
  ok(j(dt226Suggest("Fixtures", ["QSC loudspeaker"])) === j({ typeKey: "fixtures", confidence: "high" }), "#226 suggest: a category match beats the descriptions");

  // typeOfPart / scopes
  const types = dt226From(undefined);
  const map: DT226Map = {
    "motorized hoist": { typeKey: "hoists-motors", by: "auto", at: 1 },
    widgets: { typeKey: null, by: "admin", at: 2 },
    gone: { typeKey: "no-such-type", by: "admin", at: 3 },
  };
  ok(dt226TypeOf({ category: " Motorized  Hoist" }, map, types) === "hoists-motors", "#226 typeOfPart: matches the normalized category");
  ok(dt226TypeOf({ category: "Widgets" }, map, types) === null && dt226TypeOf({ category: "Gone" }, map, types) === null && dt226TypeOf({ category: "Nothing" }, map, types) === null,
    "#226 typeOfPart: an admin 'unmapped', an unknown type and no entry are all null");
  ok(dt226TypeOf({ category: "Motorized Hoist" }, map, types.map((t) => (t.key === "hoists-motors" ? { ...t, archived: true } : t))) === null,
    "#226 typeOfPart: an archived type maps nothing");
  ok(dt226TypeOf({ category: "Fabric" }, { fabric: { typeKey: "drapery", by: "admin", at: 1 } }, types) === null, "#226 typeOfPart: Fabric/Labor never take a device type");
  ok(dt226ScopeOf("hoists-motors", types) === "Rigging" && dt226ScopeOf("networking", types) === "Unscoped" && dt226ScopeOf(null, types) === "Unscoped" && dt226ScopeOf("nope", types) === "Unscoped",
    "#226 scopeOfType: the type's scope; unmapped → Unscoped");
  ok(dt226Keyword({ category: "Widgets", desc: "Blue thing" }) === "Unscoped" && dt226Keyword({ category: "X", desc: "Velour curtain" }) === "Curtains" && dt226Keyword({ category: "Speakers", desc: "" }) === "Audio",
    "#226 scope fix: the keyword fallback ends in Unscoped, not Lighting");
  const gc226 = readFileSync(join(process.cwd(), "src/lib/stores/grid-catalog.ts"), "utf8");
  ok(gc226.includes("keywordScopeOf(") && !/return "Lighting";/.test(gc226), "#226 scope fix: grid-catalog's scopeFor delegates to keywordScopeOf (no Lighting fallback)");

  // the map
  ok(j(dt226Sanitize({ "  Motorized HOIST ": { typeKey: "hoists-motors", by: "auto", at: 5 }, a: { typeKey: "Bad Key", by: "admin", at: 1 }, b: { typeKey: "speakers", by: "robot", at: 1 }, c: null, d: { typeKey: null, by: "admin" } }))
      === j({ "motorized hoist": { typeKey: "hoists-motors", by: "auto", at: 5 }, d: { typeKey: null, by: "admin", at: 0 } }),
    "#226 map: sanitizeTypeMap normalizes keys, keeps admin 'unmapped', drops bad entries");
  const auto = dt226Auto([{ category: "Truss" }, { category: "truss " }, { category: "Motorized Hoist" }, { category: "Control" }, { category: "Uncategorized" }, { category: "Widgets" }], map, types, 1000);
  ok(j(auto) === j({ truss: { typeKey: "truss-pipe", by: "auto", at: 1000 } }),
    "#226 auto: only unmapped categories with a HIGH suggestion become auto entries (existing entries — even an admin 'unmapped' — untouched; low/none skipped)");
  ok(j(dt226Auto([{ category: "Truss" }], {}, types.map((t) => (t.key === "truss-pipe" ? { ...t, archived: true } : t)), 1)) === "{}", "#226 auto: never auto-maps to an archived type");

  // review rows + accept
  const rows = dt226Rows([
    { category: "Truss", desc: "12in box truss" }, { category: "Truss", desc: "Corner block" },
    { category: "Motorized Hoist", desc: "CM Lodestar" },
    { category: "Audio", desc: "QSC loudspeaker" },
    { category: "Widgets", desc: "Loudspeaker stand" },
    { category: "Rigging", desc: "Shackle" },
    { category: "Fabric", desc: "Velour" }, { category: "", desc: "blank" },
  ], { ...map, truss: { typeKey: "truss-pipe", by: "admin", at: 9 } }, types);
  ok(rows.map((r) => r.category).join("|") === "Audio|Rigging|Widgets|Motorized Hoist|Truss", "#226 review: unmapped first, then auto, then admin; Fabric and blanks left out");
  const audio = rows.find((r) => r.category === "Audio")!;
  ok(audio.status === "unmapped" && j(audio.suggestion) === j({ typeKey: "speakers", confidence: "low" }) && audio.entry === null, "#226 review: an unmapped row carries its (description-voted) suggestion");
  ok(rows.find((r) => r.category === "Truss")!.count === 2 && rows.find((r) => r.category === "Motorized Hoist")!.status === "auto", "#226 review: counts parts per category; auto entries flagged");
  ok(j(dt226Accept(rows, types, 77)) === j({ audio: { typeKey: "speakers", by: "admin", at: 77 }, rigging: { typeKey: "rigging-hardware", by: "admin", at: 77 } }),
    "#226 review: Accept all suggestions writes admin entries for unmapped rows with any suggestion — never over an admin 'unmapped' (Widgets)");

  // assign / merge / type-list edits
  ok(j(dt226Assign([" Widgets ", "", "Labor", "Gizmos"], "speakers", 5)) === j({ widgets: { typeKey: "speakers", by: "admin", at: 5 }, gizmos: { typeKey: "speakers", by: "admin", at: 5 } }),
    "#226 assign: normalized keys, admin entries, blanks/Labor skipped");
  ok(j(dt226Assign(["Widgets"], null, 5)) === j({ widgets: { typeKey: null, by: "admin", at: 5 } }), "#226 assign: null = deliberately unmapped (auto never re-maps it)");
  ok(j(dt226Merge({ a: { typeKey: "speakers", by: "auto", at: 1 }, b: { typeKey: "amplifiers", by: "admin", at: 1 }, c: { typeKey: "speakers", by: "admin", at: 1 } }, "speakers", "amplifiers", 9))
      === j({ a: { typeKey: "amplifiers", by: "admin", at: 9 }, c: { typeKey: "amplifiers", by: "admin", at: 9 } }),
    "#226 merge: every category of the merged type moves to the target as an admin entry");
  const edited = dt226Clean(
    [
      ...types.filter((t) => t.key !== "intercom").map((t) => (t.key === "speakers" ? { ...t, label: "Loudspeakers" } : t)),
      { label: "Fog & Haze", scope: "Lighting" },
      { label: "Speakers", scope: "Audio" },
    ],
    types.map((t) => (t.key === "fixtures" ? { ...t, icon: "wash" } : t))
  );
  ok(edited.ok && edited.types.find((t) => t.key === "speakers")!.label === "Loudspeakers" && edited.types.find((t) => t.key === "fog-haze")?.scope === "Lighting",
    "#226 types: rename keeps the key; a new type gets a slug key");
  ok(edited.ok && edited.types.some((t) => t.key === "speakers-2") && edited.types.find((t) => t.key === "intercom")?.archived === true && edited.types.find((t) => t.key === "fixtures")?.icon === "wash",
    "#226 types: a colliding slug gets a suffix; a dropped type is archived, never deleted; icons survive a list save");
  ok(edited.ok && edited.types.map((t) => t.order).slice(0, 3).join() === "10,20,30", "#226 types: order follows the submitted list");
  ok(!dt226Clean([{ label: "A", scope: "Lighting" }, { label: "a", scope: "Audio" }], []).ok && !dt226Clean([{ label: " ", scope: "Lighting" }], []).ok && !dt226Clean([{ label: "A", scope: "Nope" }], []).ok,
    "#226 types: duplicate names, blank names and unknown scopes are refused");

  // icons, labels, layer rows
  const tIcons = dt226TypeIcons(dt226WithIcons(types, { speakers: "horn", amplifiers: null }).map((t) => (t.key === "cameras" ? { ...t, archived: true } : t)));
  ok(tIcons.speakers === "horn" && tIcons.amplifiers === "amplifier" && !("cameras" in tIcons), "#226 icons: a type's own icon wins over the default; archived types have none");
  ok(dt226KeyOf({ id: "GASM-1", kind: "assembly" }) === DT226_ASM && dt226KeyOf({ id: "asm:fa-1" }) === DT226_ASM && dt226KeyOf({ id: "x", deviceType: "speakers" }) === "speakers"
      && dt226KeyOf({ id: "y", deviceType: null }) === DT226_UNMAPPED && dt226KeyOf(undefined) === DT226_UNMAPPED,
    "#226 typeKeyOfPart: assemblies, typed parts, unmapped");
  ok(dt226Label(DT226_UNMAPPED, types) === "Unmapped" && dt226Label("speakers", types) === "Speakers", "#226 typeLabel");
  const lr = dt226Layers([
    { scope: "Audio", typeKey: "amplifiers" }, { scope: "Audio", typeKey: DT226_UNMAPPED, sub: "Speakers" },
    { scope: "Audio", typeKey: "speakers" }, { scope: "Audio", typeKey: "speakers" }, { scope: "Audio", typeKey: DT226_UNMAPPED, sub: "Speakers" },
  ], types);
  ok(j(lr.get("Audio")) === j([{ key: "speakers", label: "Speakers", count: 2, subs: [] }, { key: "amplifiers", label: "Amplifiers", count: 1, subs: [] }, { key: DT226_UNMAPPED, label: "Unmapped", count: 2, subs: ["Speakers"] }]),
    "#226 layers: rows in type order, Unmapped last with its seeded categories as sub-labels");

  // favorites / recent list rules
  ok(j(dt226Ids(["a", "a", "", 5, "b", "x".repeat(121)], 10)) === j(["a", "b"]) && j(dt226Ids(null, 3)) === "[]", "#226 lists: cleanIdList dedupes and drops junk");
  ok(j(dt226Recent(["b", "a", "c"], "a", 3)) === j(["a", "b", "c"]) && j(dt226Recent(["a", "b", "c"], "d", 3)) === j(["d", "a", "b"]), "#226 recent: moves to the front, capped");
  const t1 = dt226Toggle(["a"], "b", 3);
  const t2 = dt226Toggle(["b", "a"], "a", 3);
  const t3 = dt226Toggle(["a", "b", "c"], "d", 3);
  ok(t1.ok && t1.on && j(t1.list) === j(["b", "a"]) && t2.ok && !t2.on && j(t2.list) === j(["b"]) && !t3.ok && /3 favorites/.test(t3.error),
    "#226 favorites: toggle adds to the front, removes, and refuses past the cap");

  // gridPartsFrom stamps the type and the type's scope
  const dtCtx = { types, map: { fixtures: { typeKey: "fixtures", by: "auto", at: 1 } } as DT226Map };
  const sym226 = (id: string, scope: string, category: string, kind?: "assembly") => ({
    id, name: id, manufacturer: "ETC", modelNumber: id, scope, category, width: 40, height: 30, ports: [],
    pricingPartId: kind ? null : id, kind: kind ?? "device", createdBy: "t", createdAt: 1, updatedAt: 1,
  });
  const cat226 = [
    { id: "P-FIX", sku: "P-FIX", desc: "Source Four", category: "Fixtures", unit: "ea", list: 1, cost: 1 },
    { id: "P-WID", sku: "P-WID", desc: "Blue widget", category: "Widgets", unit: "ea", list: 1, cost: 1 },
  ];
  const lib226 = dt226Parts([sym226("P-FIX", "Lighting", "Fixtures"), sym226("P-WID", "Lighting", "Widgets"), sym226("GASM-1", "Audio", "Assembly", "assembly")] as never, cat226 as never, {}, { deviceTypes: dtCtx });
  const by226 = new Map(lib226.map((p) => [p.id, p]));
  ok(by226.get("P-FIX")!.deviceType === "fixtures" && by226.get("P-FIX")!.deviceTypeLabel === "Fixtures" && dt226ScopeOfPart(by226.get("P-FIX")) === "Lighting",
    "#226 parts: a mapped part carries its type and the type's scope");
  ok(by226.get("P-WID")!.deviceType === null && dt226ScopeOfPart(by226.get("P-WID")) === "Unscoped",
    "#226 scope fix: an unmapped part stored with the old Lighting fallback now resolves Unscoped");
  ok(by226.get("GASM-1")!.deviceType === null && dt226ScopeOfPart(by226.get("GASM-1")) === "Audio", "#226 parts: an assembly keeps its own scope");
  ok(dt226Parts([sym226("P-WID", "Lighting", "Widgets")] as never, cat226 as never, {})[0].deviceType === undefined, "#226 parts: without a device-type context nothing changes (back-compat callers)");
}
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: the run aborts with an error resolving `@/lib/design/device-types` (module not found).

- [ ] **Step 3: Create `src/lib/design/device-types.ts`**

```ts
/* ------------------------------------------------------------------ *
 * The Grid — curated device types (#226, spec 2026-09-26).
 *
 * CatalogPart.category is free text copied from ~52 vendor sheets; the
 * Grid stopped being usable once every surface listed those raw strings.
 * A DEVICE TYPE is the Grid's own ~25-row vocabulary: each raw category
 * maps (through the `gridTypeMap` blob — auto-applied when the match is
 * confident, admin-confirmed otherwise) to at most one type, and a type
 * carries the Grid scope. Nothing here rewrites a catalog part.
 *
 * Pure and client-safe (the grid-bom rule): no doc-store, no DB. The
 * store is src/lib/stores/device-types.ts; the palette, Layers, legends,
 * Grid Settings and the harness all import this file.
 * ------------------------------------------------------------------ */
import { isGridLayer, UNSCOPED, type GridLayer } from "./grid-scopes";

export type DeviceType = {
  key: string;
  label: string;
  scope: GridLayer;
  order: number;
  archived?: boolean;
  /** grid-icons id; checked with isGridIconId where it is resolved
   *  (grid-icons symbolContext) — this file cannot import the registry. */
  icon?: string | null;
};

export type TypeMapEntry = { typeKey: string | null; by: "auto" | "admin"; at: number };
/** normalized raw category → entry. `typeKey: null` + `by: "admin"` is a
 *  deliberate "not a Grid device type" that auto-apply never touches. */
export type TypeMap = Record<string, TypeMapEntry>;
export type DeviceTypeContext = { types: DeviceType[]; map: TypeMap };
export type Suggestion = { typeKey: string; confidence: "high" | "low" };

export const DEVICE_TYPES_BLOB = "gridDeviceTypes";
export const TYPE_MAP_BLOB = "gridTypeMap";
export const favoritesBlobId = (userId: string) => `gridFavorites:${userId}`;
export const recentBlobId = (userId: string) => `gridRecent:${userId}`;
export const FAVORITES_CAP = 300;
export const RECENT_CAP = 40;
export const MAX_DEVICE_TYPES = 60;
/** Pseudo type keys for the palette chips and the Layers rows. */
export const UNMAPPED_TYPE = "__unmapped";
export const ASSEMBLY_TYPE = "__assembly";
export const ALLOWANCE_TYPE = "__allowance";
export const UNMAPPED_LABEL = "Unmapped";

const SEED: ReadonlyArray<[string, GridLayer]> = [
  ["Fixtures", "Lighting"], ["Dimming & Power", "Lighting"], ["Control & Networking", "Lighting"], ["Lighting Accessories", "Lighting"],
  ["Hoists & Motors", "Rigging"], ["Truss & Pipe", "Rigging"], ["Rigging Hardware", "Rigging"], ["Rigging Control", "Rigging"],
  ["Drapery", "Curtains"], ["Tracks & Hardware", "Curtains"],
  ["Speakers", "Audio"], ["Microphones", "Audio"], ["Mixing & Processing", "Audio"], ["Amplifiers", "Audio"], ["Assistive Listening", "Audio"], ["Intercom", "Audio"],
  ["Displays & Projectors", "Video"], ["Screens & Lifts", "Video"], ["Cameras", "Video"], ["Switching & Distribution", "Video"],
  ["Cable & Connectors", UNSCOPED], ["Racks & Cases", UNSCOPED], ["Power Distribution", UNSCOPED], ["Networking", UNSCOPED], ["Parts & Consumables", UNSCOPED],
];

export function slugOf(label: string): string {
  return label
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export const SEED_DEVICE_TYPES: readonly DeviceType[] = SEED.map(([label, scope], i) => ({ key: slugOf(label), label, scope, order: (i + 1) * 10 }));

/** Shipped glyph per seeded type (grid-icons ids; the harness pins each). */
export const DEFAULT_TYPE_ICONS: Record<string, string> = {
  fixtures: "fixture",
  "dimming-power": "dimmer",
  "control-networking": "lighting-controls",
  "lighting-accessories": "spotlight",
  "hoists-motors": "motor",
  "truss-pipe": "pipe",
  "rigging-hardware": "hardware",
  "rigging-control": "control-panel",
  drapery: "curtain",
  "tracks-hardware": "track",
  speakers: "speaker",
  microphones: "microphone",
  "mixing-processing": "faders",
  amplifiers: "amplifier",
  "assistive-listening": "assistive-listening",
  intercom: "intercom",
  "displays-projectors": "display",
  "screens-lifts": "screen",
  cameras: "camera",
  "switching-distribution": "distribution",
  "cable-connectors": "cable",
  "racks-cases": "rack",
  "power-distribution": "power",
  networking: "network",
  "parts-consumables": "kit",
};

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ICON_RE = /^[a-z0-9-]{1,40}$/;
const byOrder = (a: DeviceType, b: DeviceType) => a.order - b.order || a.label.localeCompare(b.label);

/** Trimmed, lower-cased, whitespace collapsed; "" for nothing (and for
 *  "__proto__", which must never become an object key). */
export function normalizeRawCategory(raw: string | null | undefined): string {
  const k = (raw || "").trim().toLowerCase().replace(/\s+/g, " ");
  return k === "__proto__" ? "" : k;
}

function cleanType(raw: unknown): DeviceType | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const key = typeof r.key === "string" ? r.key.trim() : "";
  const label = typeof r.label === "string" ? r.label.trim().replace(/\s+/g, " ").slice(0, 40) : "";
  const scope = r.scope;
  if (!KEY_RE.test(key) || !label || !isGridLayer(scope)) return null;
  const t: DeviceType = { key, label, scope, order: typeof r.order === "number" && Number.isFinite(r.order) ? r.order : 0 };
  if (r.archived === true) t.archived = true;
  if (typeof r.icon === "string" && ICON_RE.test(r.icon)) t.icon = r.icon;
  return t;
}

/** Stored list (full replacement) sanitized; any seeded type missing from it
 *  is appended so a type shipped later still appears. Never deletes: a type
 *  leaves the palette only by being archived. Absent/invalid → fresh seeds. */
export function deviceTypesFrom(raw: unknown): DeviceType[] {
  if (!Array.isArray(raw)) return SEED_DEVICE_TYPES.map((t) => ({ ...t }));
  const out: DeviceType[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const t = cleanType(r);
    if (!t || seen.has(t.key)) continue;
    seen.add(t.key);
    out.push(t);
    if (out.length >= MAX_DEVICE_TYPES) break;
  }
  let max = out.reduce((m, t) => Math.max(m, t.order), 0);
  for (const s of SEED_DEVICE_TYPES) {
    if (seen.has(s.key)) continue;
    max += 10;
    out.push({ ...s, order: max });
  }
  return out.sort(byOrder);
}

/* ------------------------- suggestion rules ------------------------- */

type Rule = { typeKey: string; conf: "high" | "low"; re: RegExp };
const H = (typeKey: string, re: RegExp): Rule => ({ typeKey, conf: "high", re });
const L = (typeKey: string, re: RegExp): Rule => ({ typeKey, conf: "low", re });

/** Categories that name no device at all. */
const EXCLUDED = new Set(["fabric", "labor"]);
const GENERIC = new Set(["uncategorized", "other", "misc", "miscellaneous", "general", "accessory", "accessories", "n/a", "none", "unknown"]);
/** Dealer-sheet brand buckets too broad to guess from (convert-dealer-sheets.py BRAND_CATEGORY). */
const BLOCK = /\b(av control|av infrastructure|networked av|staging|stage accessories)\b/;

/** First match wins, so the order is load-bearing: specific phrases before
 *  the single words they contain ("motor control" before "motor", "led
 *  video" before "led", "power controls" before "power", "safety cables"
 *  before "cables"). High rules are unambiguous on their own; low rules are
 *  single words that often but not always mean that type. */
const RULES: readonly Rule[] = [
  H("rigging-control", /\b(rigging|motor|hoist) control(s|ler|lers)?\b/),
  H("hoists-motors", /\b(hoists?|motors?|motorized|winch(es)?)\b/),
  H("truss-pipe", /\b(truss(es|ing)?|pipes?|battens?)\b/),
  H("tracks-hardware", /\b(tracks?|carriers?|travell?ers?)\b/),
  H("drapery", /\b(drapes?|drapery|curtains?|scrims?|velour|cyc fabric|masking)\b/),
  H("rigging-hardware", /\b(shackles?|wire rope|slings?|loft ?blocks?|head ?blocks?|mule blocks?|floor blocks?|arbors?|rope locks?|shoes|strain reliefs?|hardware|mounts?|hooks?|turnbuckles?)\b/),
  H("assistive-listening", /\b(assistive|als|hearing loops?|induction loops?|listening)\b/),
  H("intercom", /\b(intercoms?|comms?|clear ?com|party ?line|beltpacks?)\b/),
  H("microphones", /\b(mics?|microphones?)\b/),
  H("amplifiers", /\b(amps?|amplifiers?|amplification)\b/),
  H("mixing-processing", /\b(dsps?|mixers?|mixing|audio consoles?|processors?|processing|audio controls?)\b/),
  H("speakers", /\b(speakers?|loudspeakers?|subs?|subwoofers?|line arrays?|stage monitors?)\b/),
  H("cameras", /\b(cameras?|ptz|camcorders?)\b/),
  H("screens-lifts", /\b(screens?|lifts?)\b/),
  H("displays-projectors", /\b(displays?|projectors?|projection|led video|video walls?|led walls?|tvs?)\b/),
  H("switching-distribution", /\b(switchers?|switching|matrix|matrices|av distribution|video distribution|distribution amps?|extenders?|hdbaset|scalers?|video controls?|encoders?|decoders?)\b/),
  H("dimming-power", /\b(dimmers?|dimming|relays?|relay panels?|power controls?)\b/),
  H("power-distribution", /\b(power distribution|distro|distro boxes?|pdus?|power strips?|surge|power conditioners?|sequencers?)\b/),
  H("networking", /\b(network|networking|network switch(es)?|routers?|access points?|ethernet|fiber)\b/),
  H("control-networking", /\b(lighting controls?|lighting consoles?|dmx|sacn|gateways?|nodes?)\b/),
  H("lighting-accessories", /\b(lens(es)?|iris(es)?|gobos?|yokes?|lighting accessories|color frames?|top hats?|barn ?doors?|safety cables?)\b/),
  H("fixtures", /\b(fixtures?|luminaires?|leds?|spots?|spotlights?|wash(es)?|ellipsoidals?|fresnels?|pars?|cyc|moving lights?|followspots?|house ?lights?|work ?lights?)\b/),
  H("parts-consumables", /\b(lamps?|parts|consumables?|filters?|gels?|batteries|fluids?)\b/),
  H("cable-connectors", /\b(cables?|cabling|connectors?|adapters?|wire|wiring|cable assemblies|crossovers?|snakes?|multicores?)\b/),
  H("racks-cases", /\b(racks?|cases?|carts?)\b/),
  L("control-networking", /\b(controls?|controllers?|consoles?)\b/),
  L("fixtures", /\b(lighting|lights?|architectural)\b/),
  L("displays-projectors", /\bmonitors?\b/),
  L("microphones", /\bwireless\b/),
  L("power-distribution", /\bpower\b/),
  L("rigging-hardware", /\brigging\b/),
  L("lighting-accessories", /\bclamps?\b/),
];

const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
const firstRule = (text: string) => RULES.find((r) => r.re.test(text)) ?? null;

/**
 * The category string decides (its rule's confidence). Only when it matches
 * nothing do up to 20 sample part descriptions vote, and a vote is never
 * better than "low" — auto-apply acts on category evidence alone. Generic,
 * excluded and brand-bucket categories never get a suggestion.
 */
export function suggestDeviceType(category: string, sampleDescs: readonly string[] = []): Suggestion | null {
  const key = normalizeRawCategory(category);
  if (!key || EXCLUDED.has(key) || GENERIC.has(key) || BLOCK.test(words(key))) return null;
  const hit = firstRule(words(key));
  if (hit) return { typeKey: hit.typeKey, confidence: hit.conf };
  const votes = new Map<string, number>();
  for (const d of sampleDescs.slice(0, 20)) {
    const r = firstRule(words(d || ""));
    if (r) votes.set(r.typeKey, (votes.get(r.typeKey) || 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const r of RULES) {
    const n = votes.get(r.typeKey) || 0;
    if (n > bestN) {
      best = r.typeKey;
      bestN = n;
    }
  }
  return best ? { typeKey: best, confidence: "low" } : null;
}

/* ------------------------------ the map ------------------------------ */

export function sanitizeTypeMap(raw: unknown): TypeMap {
  const out: TypeMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = normalizeRawCategory(k);
    if (!key || key.length > 120 || !v || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    const typeKey = e.typeKey === null ? null : typeof e.typeKey === "string" && KEY_RE.test(e.typeKey) ? e.typeKey : undefined;
    if (typeKey === undefined || (e.by !== "auto" && e.by !== "admin")) continue;
    out[key] = { typeKey, by: e.by, at: typeof e.at === "number" && Number.isFinite(e.at) ? e.at : 0 };
  }
  return out;
}

/** The ACTIVE type a raw category maps to, or null (no entry, an admin
 *  "unmapped", an unknown or archived type, Fabric/Labor). */
export function typeOfCategory(category: string, map: TypeMap, types: readonly DeviceType[]): string | null {
  const key = normalizeRawCategory(category);
  if (!key || EXCLUDED.has(key)) return null;
  const e = Object.hasOwn(map, key) ? map[key] : undefined;
  if (!e || !e.typeKey) return null;
  const t = types.find((x) => x.key === e.typeKey);
  return t && !t.archived ? t.key : null;
}

export function typeOfPart(part: { category: string }, map: TypeMap, types: readonly DeviceType[]): string | null {
  return typeOfCategory(part.category, map, types);
}

export function scopeOfType(typeKey: string | null | undefined, types: readonly DeviceType[]): GridLayer {
  const t = typeKey ? types.find((x) => x.key === typeKey) : undefined;
  return t ? t.scope : UNSCOPED;
}

export function typeLabel(key: string, types: readonly DeviceType[]): string {
  if (key === UNMAPPED_TYPE) return UNMAPPED_LABEL;
  if (key === ASSEMBLY_TYPE) return "Assemblies";
  if (key === ALLOWANCE_TYPE) return "Allowances";
  return types.find((t) => t.key === key)?.label ?? key;
}

/**
 * The pre-#226 grid-catalog scopeFor() text heuristic, with its Lighting
 * fallback replaced by Unscoped (#48 intent: an unknown part is visible and
 * countable in Unscoped, never dumped into Lighting).
 */
export function keywordScopeOf(p: { category?: string; desc?: string; discipline?: string }): GridLayer {
  const text = `${p.category || ""} ${p.desc || ""} ${p.discipline || ""}`.toLowerCase();
  if (text.includes("curtain") || text.includes("fabric")) return "Curtains";
  if (text.includes("rig") || text.includes("truss")) return "Rigging";
  if (text.includes("video") || text.includes("sdi") || text.includes("hdmi")) return "Video";
  if (text.includes("audio") || text.includes("speaker") || text.includes("microphone")) return "Audio";
  return UNSCOPED;
}

/** Auto-apply (spec, Jeff 2026-09-26): every distinct category with NO map
 *  entry whose category string earns a HIGH suggestion for an active type. */
export function autoTypeEntries(parts: ReadonlyArray<{ category: string }>, map: TypeMap, types: readonly DeviceType[], now: number): TypeMap {
  const active = new Set(types.filter((t) => !t.archived).map((t) => t.key));
  const out: TypeMap = {};
  const seen = new Set<string>();
  for (const p of parts) {
    const key = normalizeRawCategory(p.category);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (Object.hasOwn(map, key)) continue;
    const s = suggestDeviceType(key);
    if (s && s.confidence === "high" && active.has(s.typeKey)) out[key] = { typeKey: s.typeKey, by: "auto", at: now };
  }
  return out;
}

export type TypeReviewRow = {
  key: string;
  category: string;
  count: number;
  suggestion: Suggestion | null;
  entry: TypeMapEntry | null;
  typeKey: string | null;
  status: "unmapped" | "auto" | "admin";
};

const STATUS_RANK: Record<TypeReviewRow["status"], number> = { unmapped: 0, auto: 1, admin: 2 };

/** Catalog → Device types rows: one per distinct raw category (first
 *  spelling wins), Fabric/Labor/blank left out; unmapped first, then auto,
 *  then admin; most parts first within each. */
export function typeReviewRows(parts: ReadonlyArray<{ category: string; desc?: string }>, map: TypeMap, types: readonly DeviceType[]): TypeReviewRow[] {
  const groups = new Map<string, { category: string; count: number; descs: string[] }>();
  for (const p of parts) {
    const key = normalizeRawCategory(p.category);
    if (!key || EXCLUDED.has(key)) continue;
    let g = groups.get(key);
    if (!g) {
      g = { category: (p.category || "").trim().replace(/\s+/g, " "), count: 0, descs: [] };
      groups.set(key, g);
    }
    g.count += 1;
    if (p.desc && g.descs.length < 5) g.descs.push(p.desc);
  }
  const rows: TypeReviewRow[] = [];
  for (const [key, g] of groups) {
    const entry = Object.hasOwn(map, key) ? map[key] : null;
    const typeKey = typeOfCategory(key, map, types);
    const status: TypeReviewRow["status"] = !typeKey || !entry ? "unmapped" : entry.by;
    rows.push({ key, category: g.category, count: g.count, suggestion: suggestDeviceType(key, g.descs), entry, typeKey, status });
  }
  return rows.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.count - a.count || a.category.localeCompare(b.category));
}

/** "Accept all suggestions": admin entries for every unmapped row that has
 *  no entry at all (an admin "unmapped" is a decision, not a gap) and any
 *  suggestion, low included, for an active type. */
export function acceptSuggestionEntries(rows: readonly TypeReviewRow[], types: readonly DeviceType[], now: number): TypeMap {
  const active = new Set(types.filter((t) => !t.archived).map((t) => t.key));
  const out: TypeMap = {};
  for (const r of rows) {
    if (r.status !== "unmapped" || r.entry || !r.suggestion || !active.has(r.suggestion.typeKey)) continue;
    out[r.key] = { typeKey: r.suggestion.typeKey, by: "admin", at: now };
  }
  return out;
}

export function assignEntries(categories: readonly string[], typeKey: string | null, now: number): TypeMap {
  const out: TypeMap = {};
  for (const c of categories) {
    const key = normalizeRawCategory(String(c ?? ""));
    if (!key || EXCLUDED.has(key) || key.length > 120) continue;
    out[key] = { typeKey, by: "admin", at: now };
  }
  return out;
}

export function mergeTypeEntries(map: TypeMap, fromKey: string, toKey: string, now: number): TypeMap {
  const out: TypeMap = {};
  for (const [k, e] of Object.entries(map)) if (e.typeKey === fromKey) out[k] = { typeKey: toKey, by: "admin", at: now };
  return out;
}

/**
 * The Device types list editor's save. Input is the whole ordered list
 * (existing rows carry `key`, new rows don't). Rename keeps the key; a new
 * row gets a unique slug key; a row missing from the input is archived,
 * never deleted (the map may still point at it); icons are Grid Settings'
 * business and always carried over from `current`.
 */
export function cleanDeviceTypesInput(
  input: unknown,
  current: readonly DeviceType[]
): { ok: true; types: DeviceType[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "Nothing to save." };
  if (input.length > MAX_DEVICE_TYPES) return { ok: false, error: `At most ${MAX_DEVICE_TYPES} device types.` };
  const byKey = new Map(current.map((t) => [t.key, t]));
  const out: DeviceType[] = [];
  const keys = new Set<string>();
  const labels = new Set<string>();
  for (const [i, raw] of input.entries()) {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim().replace(/\s+/g, " ") : "";
    if (!label) return { ok: false, error: "Every device type needs a name." };
    if (label.length > 40) return { ok: false, error: `"${label.slice(0, 40)}…" is longer than 40 characters.` };
    const scope = r.scope;
    if (!isGridLayer(scope)) return { ok: false, error: `Pick a scope for "${label}".` };
    const existing = typeof r.key === "string" ? byKey.get(r.key) ?? null : null;
    let key = existing ? existing.key : slugOf(label);
    if (!existing) {
      if (!key) return { ok: false, error: `"${label}" needs at least one letter or number.` };
      const base = key.slice(0, 36);
      let n = 2;
      while (keys.has(key) || byKey.has(key)) key = `${base}-${n++}`;
    }
    if (keys.has(key)) return { ok: false, error: "The same device type appears twice." };
    const archived = r.archived === true;
    const lower = label.toLowerCase();
    if (!archived && labels.has(lower)) return { ok: false, error: `Two device types are called "${label}".` };
    keys.add(key);
    if (!archived) labels.add(lower);
    const t: DeviceType = { key, label, scope, order: (i + 1) * 10 };
    if (archived) t.archived = true;
    if (existing?.icon) t.icon = existing.icon;
    out.push(t);
  }
  for (const t of current) if (!keys.has(t.key)) out.push({ ...t, archived: true, order: (out.length + 1) * 10 });
  return { ok: true, types: out };
}

/** Set (string) or clear (null) the icon of the named types; others untouched. */
export function withTypeIcons(types: readonly DeviceType[], icons: Record<string, string | null>): DeviceType[] {
  return types.map((t) => {
    const next: DeviceType = { ...t };
    if (!Object.hasOwn(icons, t.key)) return next;
    const v = icons[t.key];
    if (typeof v === "string" && ICON_RE.test(v)) next.icon = v;
    else delete next.icon;
    return next;
  });
}

/** Active type key → icon id (own icon, else the shipped default). */
export function deviceTypeIcons(types: readonly DeviceType[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of types) {
    if (t.archived) continue;
    const id = t.icon || (Object.hasOwn(DEFAULT_TYPE_ICONS, t.key) ? DEFAULT_TYPE_ICONS[t.key] : undefined);
    if (id) out[t.key] = id;
  }
  return out;
}

/** The palette-chip / layer key of a resolved part. Assemblies and
 *  allowances are Grid-owned and never "unmapped". */
export function typeKeyOfPart(
  p: { id?: string; deviceType?: string | null; kind?: string; allowance?: boolean } | null | undefined
): string {
  if (!p) return UNMAPPED_TYPE;
  if (p.allowance) return ALLOWANCE_TYPE;
  if (p.kind === "assembly" || (p.id || "").startsWith("asm:")) return ASSEMBLY_TYPE;
  return p.deviceType || UNMAPPED_TYPE;
}

export type TypeLayerRow = { key: string; label: string; count: number; subs: string[] };

/** Layers: per scope, one row per device type in type order; Assemblies,
 *  Allowances, then Unmapped last. `sub` (an unmapped item's raw/seeded
 *  category) collects up to three distinct sub-labels — never a layer. */
export function typeLayerRows(
  items: ReadonlyArray<{ scope: GridLayer; typeKey: string; sub?: string | null }>,
  types: readonly DeviceType[]
): Map<GridLayer, TypeLayerRow[]> {
  const order = new Map(types.map((t, i) => [t.key, i]));
  const rank = (k: string) =>
    k === UNMAPPED_TYPE ? 3e6 : k === ALLOWANCE_TYPE ? 2e6 + 1 : k === ASSEMBLY_TYPE ? 2e6 : order.get(k) ?? 1e6;
  const byScope = new Map<GridLayer, Map<string, TypeLayerRow>>();
  for (const it of items) {
    let m = byScope.get(it.scope);
    if (!m) {
      m = new Map();
      byScope.set(it.scope, m);
    }
    let r = m.get(it.typeKey);
    if (!r) {
      r = { key: it.typeKey, label: typeLabel(it.typeKey, types), count: 0, subs: [] };
      m.set(it.typeKey, r);
    }
    r.count += 1;
    const sub = (it.sub || "").trim();
    if (sub && !r.subs.includes(sub) && r.subs.length < 3) r.subs.push(sub);
  }
  const out = new Map<GridLayer, TypeLayerRow[]>();
  for (const [scope, m] of byScope) out.set(scope, [...m.values()].sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label)));
  return out;
}

/* ------------------------ favorites / recent ------------------------ */

export function cleanIdList(raw: unknown, cap: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !v.trim() || v.length > 120 || out.includes(v)) continue;
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

export function withRecent(list: readonly string[], id: string, cap = RECENT_CAP): string[] {
  if (!id || !id.trim() || id.length > 120) return [...list];
  return [id, ...list.filter((x) => x !== id)].slice(0, cap);
}

export function toggleInList(
  list: readonly string[],
  id: string,
  cap = FAVORITES_CAP
): { ok: true; list: string[]; on: boolean } | { ok: false; error: string } {
  if (!id || !id.trim() || id.length > 120) return { ok: false, error: "That part can't be starred." };
  if (list.includes(id)) return { ok: true, list: list.filter((x) => x !== id), on: false };
  if (list.length >= cap) return { ok: false, error: `You have ${cap} favorites — unstar one first.` };
  return { ok: true, list: [id, ...list], on: true };
}
```

- [ ] **Step 4: Fix the Lighting fallback in `src/lib/stores/grid-catalog.ts`**

Add to the imports at the top:

```ts
import { keywordScopeOf } from "@/lib/design/device-types";
```

Replace the whole `function scopeFor(p: CatalogPart): string { … return "Lighting"; }` block (landmark: `function scopeFor(p: CatalogPart): string {`) with:

```ts
/** #226: the text heuristic lives in lib/design/device-types (pure) and now
 *  ends in Unscoped, not Lighting — an unknown part must never flood the
 *  Lighting chip (#48). Device types override this at read time
 *  (gridPartsFrom), so this is only the seed-time fallback. */
function scopeFor(p: CatalogPart): string {
  return keywordScopeOf(p);
}
```

- [ ] **Step 5: Add the PartLite fields in `src/lib/design/grid-bom.ts`**

Directly after the `trade?: string | null;` field of `PartLite` (landmark: the comment ending `…the other PartLite-shaped callers never resolve it. */` then `trade?: string | null;`), insert:

```ts
  /** #226 device type key (lib/design/device-types), resolved server-side by
   *  gridPartsFrom; null = unmapped. ABSENT (undefined) when the caller
   *  resolved no device types — legendRows keeps its old per-category
   *  labels for those callers. */
  deviceType?: string | null;
  /** #226 the type's display label, null when unmapped. */
  deviceTypeLabel?: string | null;
```

- [ ] **Step 6: Stamp types in `src/lib/design/grid-parts.ts`**

Replace the whole file with:

```ts
import type { CategoryMap } from "@/lib/catalog-taxonomy";
import type { CatalogPart } from "@/lib/stores/catalog";
import type { GridSymbol } from "@/lib/stores/grid-catalog";
import type { PartLite } from "./grid-bom";
import { gridSymbolEntry } from "./grid-icons";
import { keywordScopeOf, scopeOfType, typeLabel, typeOfPart, type DeviceTypeContext } from "./device-types";

/**
 * The ONE Grid-library → PartLite builder (#209): the plan editor, the riser,
 * the drawing set and the schedule all price, name and badge a device the
 * same way. Pure (type-only store imports); callers load the rows.
 *
 * `catalogFallback` appends pricing-catalog rows that are not Grid-library
 * entries, so a placement made before the library existed still resolves a
 * description (what the old riser page did inline).
 *
 * `hasDatasheet` decides the PartLite flag. The Grid editor passes the #207
 * part-documents check (a stored datasheet document of the part's own, via
 * loadPartDocsState + ownFiles) — a replaced or detached legacy file no
 * longer counts. The default is the legacy blob check, kept only for pure
 * callers that never render the datasheet link (riser, set, schedule).
 *
 * `deviceTypes` (#226) stamps each part with its device type + label and
 * writes the TYPE's scope into `gridScope` — the field scopeOfPart reads
 * first — so every surface files the part the same way. A catalog-linked
 * device with no type re-derives its scope from the keyword fallback (now
 * Unscoped, not Lighting) instead of trusting the `scope` its Grid-library
 * entry snapshotted at first seed. Assemblies keep their own scope.
 */
export function gridPartsFrom(
  symbols: GridSymbol[],
  catalog: CatalogPart[],
  categoryMap: CategoryMap,
  opts: { catalogFallback?: boolean; hasDatasheet?: (p: CatalogPart) => boolean; deviceTypes?: DeviceTypeContext } = {}
): PartLite[] {
  const hasDatasheet = opts.hasDatasheet ?? ((p: CatalogPart) => !!p.datasheetBlobKey);
  const dt = opts.deviceTypes;
  const pricingById = new Map(catalog.map((p) => [p.id, p]));
  const typed = (s: GridSymbol, p: CatalogPart | undefined) => {
    if (!dt) return {};
    const device = !!p && s.kind !== "assembly";
    const key = device ? typeOfPart(p, dt.map, dt.types) : null;
    return {
      deviceType: key,
      deviceTypeLabel: key ? typeLabel(key, dt.types) : null,
      gridScope: key ? scopeOfType(key, dt.types) : device ? keywordScopeOf(p) : s.scope,
    };
  };
  const parts: PartLite[] = symbols.map((s) => {
    const p = s.pricingPartId ? pricingById.get(s.pricingPartId) : undefined;
    // Prefer the LIVE catalog part's ports over the grid_catalog symbol's
    // seed-time snapshot (`s.ports`): grid-catalog.ts only ever copies
    // `ports` from the pricing catalog once, at first seed, and never
    // refreshes it. Fall back to the symbol's snapshot only when there's no
    // linked pricing part with its own ports.
    const ports = p?.ports?.length ? p.ports : s.ports;
    return {
      id: s.id,
      sku: s.modelNumber || s.id,
      desc: s.name,
      unit: p?.unit || "ea",
      list: p?.list || 0,
      cost: p?.cost || 0,
      ...(ports.length > 0 ? { ports } : {}),
      ...(p && hasDatasheet(p) ? { hasDatasheet: true } : {}),
      // Category, icon/colour/shape overrides, Grid scope and the pricing
      // part's group/trade (final fix wave #3).
      ...gridSymbolEntry(s, p, categoryMap),
      // #226: device type + the type's scope (overrides gridScope above).
      ...typed(s, p),
      manufacturer: s.manufacturer,
      modelNumber: s.modelNumber,
      symbolWidth: s.width,
      symbolHeight: s.height,
      kind: s.kind || "device",
      assemblyMembers: s.members,
      pricingPartId: s.pricingPartId,
    };
  });
  if (!opts.catalogFallback) return parts;
  const seen = new Set(parts.map((p) => p.id));
  for (const p of catalog) {
    if (seen.has(p.id)) continue;
    const key = dt ? typeOfPart(p, dt.map, dt.types) : undefined;
    parts.push({
      id: p.id,
      sku: p.sku,
      desc: p.desc,
      category: p.category,
      unit: p.unit,
      list: p.list,
      cost: p.cost,
      ...(dt ? { deviceType: key ?? null, deviceTypeLabel: key ? typeLabel(key, dt.types) : null } : {}),
      ...(dt && key ? { gridScope: scopeOfType(key, dt.types) } : {}),
    });
  }
  return parts;
}
```

- [ ] **Step 7: Run the gates**

```bash
npx tsc --noEmit
npm run test:specs 2>&1 | tee /tmp/claude-226-t1.txt | tail -3; grep -c '^PASS ' /tmp/claude-226-t1.txt; grep '^FAIL' /tmp/claude-226-t1.txt
npx eslint src/lib/design/device-types.ts src/lib/stores/grid-catalog.ts src/lib/design/grid-bom.ts src/lib/design/grid-parts.ts scripts/test-review-and-spec.ts
```
Expected: tsc 0 errors; `ALL PASSED`, PASS count = BASE + the new `#226` assertions, no `FAIL` lines; eslint 0 errors. If a `#226 suggest:` case fails, fix the RULES order or regex. Do not change the expected value; the table is the spec's fixture.

- [ ] **Step 8: Commit**

```bash
git add src/lib/design/device-types.ts src/lib/stores/grid-catalog.ts src/lib/design/grid-bom.ts src/lib/design/grid-parts.ts scripts/test-review-and-spec.ts
git commit -m "$(printf 'feat(grid): pure device-type model, suggestion rules, Unscoped scope fallback (#226)\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 2: Device-types store + Catalog → Device types screen

**Files:**
- Modify: `src/db/doc-store.ts` (add `setBlobKeysIfAbsent` right after `setBlob`, landmark `export async function setBlob(`)
- Create: `src/lib/stores/device-types.ts`
- Create: `src/app/(app)/catalog/device-types/actions.ts`, `page.tsx`, `device-types-client.tsx`
- Modify: `src/app/(app)/catalog/page.tsx` (header links, landmark `Datasheets\n          </Link>`)
- Modify: `src/app/(app)/catalog/taxonomy-card.tsx` (title, landmark `Categories &amp; trades`)
- Modify: `src/app/(app)/design/grid/settings/page.tsx` (`RELATED`, landmark `Catalog — Categories & trades`)
- Modify: `scripts/smoke-routes.ts` (after `"/catalog/documents/upload",`)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: everything Task 1 exports from `@/lib/design/device-types`; `getBlob`, `setBlob` from `@/db/doc-store`; `list` from `@/lib/stores/catalog`; `requireUser`/`requirePerm` from `@/lib/session`; `can` from `@/lib/team`.
- Produces:
  - `setBlobKeysIfAbsent(id: string, patch: Record<string, unknown>): Promise<void>` (`@/db/doc-store`)
  - `@/lib/stores/device-types`: `getDeviceTypes(): Promise<DeviceType[]>`, `saveDeviceTypes(input: unknown)`, `setDeviceTypeIcons(icons: Record<string, string | null>): Promise<DeviceType[]>`, `getTypeMap(): Promise<TypeMap>`, `loadDeviceTypeContext(parts: ReadonlyArray<{ category: string }>, now?: number): Promise<DeviceTypeContext>`, `assignDeviceType(categories: string[], typeKey: string | null, now?)`, `acceptAllSuggestions(parts, now?): Promise<number>`, `mergeDeviceType(fromKey, toKey, now?)`, `getGridFavorites(userId): Promise<string[]>`, `toggleGridFavorite(userId, partId): Promise<{ ok: true; favorites: string[]; on: boolean } | { ok: false; error: string }>`, `getGridRecent(userId): Promise<string[]>`, `pushGridRecent(userId, partId): Promise<string[]>`
  - Route `/catalog/device-types`.

- [ ] **Step 1: Write the failing tests** — append to the end of `scripts/test-review-and-spec.ts`:

```ts
/* ======================================================================
   #226 Grid device types — Task 2: the store (auto-apply on read, admin
   entries never overwritten, idempotent re-read, preview guard, merge,
   accept, favorites/recent caps) and the Catalog → Device types screen.
   Blob fixtures are snapshotted and put back in the async function's
   finally (blobs aren't CollectionName docs, so no fixture sweep).
   ====================================================================== */
{
  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const page = read("src/app/(app)/catalog/device-types/page.tsx");
  const client = read("src/app/(app)/catalog/device-types/device-types-client.tsx");
  const acts = read("src/app/(app)/catalog/device-types/actions.ts");
  const clientImports = [...client.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  ok(page.includes('can("manage_users", user.roles)') && page.includes("loadDeviceTypeContext(") && page.includes("typeReviewRows("),
    "#226 screen: Catalog → Device types is admin-gated and reads through the auto-applying context");
  ok(client.startsWith('"use client"') && clientImports.every((s) => !s.startsWith("@/lib/stores/") && !s.startsWith("@/db")),
    "#226 screen: the client imports no store");
  ok(["saveDeviceTypesAction", "assignDeviceTypeAction", "acceptAllSuggestionsAction", "mergeDeviceTypeAction"].every((n) => {
    const i = acts.indexOf(`export async function ${n}`);
    return i >= 0 && acts.slice(i, acts.indexOf("\n}\n", i)).includes('await requirePerm("manage_users")');
  }), "#226 screen: every mapping action requires manage_users");
  ok(client.includes("Accept all suggestions") && client.includes('r.status === "auto"') && client.includes("mergeDeviceTypeAction("),
    "#226 screen: bulk accept, the auto chip and merge are on the screen");
  ok(read("src/app/(app)/catalog/page.tsx").includes('href="/catalog/device-types"') && read("src/app/(app)/catalog/taxonomy-card.tsx").includes("Estimating groups &amp; trades"),
    "#226 screen: Catalog links to Device types; the group/trade card is now 'Estimating groups & trades'");
  ok(read("scripts/smoke-routes.ts").includes('"/catalog/device-types"'), "#226 screen: the route is in the smoke list");
}

async function deviceTypesAsyncChecks(): Promise<void> {
  const DT = await import("../src/lib/stores/device-types");
  const { getBlob, setBlob, setBlobKeysIfAbsent } = await import("../src/db/doc-store");
  const { getDb: getDb226 } = await import("../src/db");
  const { blobs: blobs226 } = await import("../src/db/doc-tables");
  const { inArray } = await import("drizzle-orm");
  const U = "TEST226-user";
  const ids = ["gridTypeMap", "gridDeviceTypes", `gridFavorites:${U}`, `gridRecent:${U}`];
  const db = await getDb226();
  const snapshot = await db.select().from(blobs226).where(inArray(blobs226.id, ids));
  try {
    await db.delete(blobs226).where(inArray(blobs226.id, ids));
    const parts = [{ category: "Truss" }, { category: "Motorized Hoist" }, { category: "Control" }, { category: "Uncategorized" }, { category: "Widgets" }];

    await DT.assignDeviceType(["Motorized Hoist"], "speakers", 500);
    const first = await DT.loadDeviceTypeContext(parts, 1000);
    const raw1 = await getBlob<Record<string, unknown>>("gridTypeMap", {});
    // Field by field: jsonb re-orders object keys, so never compare a stored
    // entry to a literal with JSON.stringify.
    const t1raw = raw1.truss as { typeKey?: string; by?: string; at?: number } | undefined;
    ok(t1raw?.typeKey === "truss-pipe" && t1raw.by === "auto" && t1raw.at === 1000,
      "#226 store: reading the map writes a HIGH-confidence auto entry for an unmapped category");
    ok(first.map["motorized hoist"]?.typeKey === "speakers" && first.map["motorized hoist"]?.by === "admin",
      "#226 store: an admin entry is never overwritten by auto (Motorized Hoist would auto-map to Hoists & Motors)");
    ok(!("control" in raw1) && !("uncategorized" in raw1) && !("widgets" in raw1), "#226 store: low-confidence and unsuggested categories stay unmapped for review");
    const second = await DT.loadDeviceTypeContext(parts, 2000);
    const raw2 = await getBlob<Record<string, unknown>>("gridTypeMap", {});
    ok(JSON.stringify(raw2) === JSON.stringify(raw1) && second.map.truss?.at === 1000,
      "#226 store: a second read writes nothing (idempotent — the auto entry keeps its first timestamp)");

    await setBlobKeysIfAbsent("gridTypeMap", { "motorized hoist": { typeKey: "hoists-motors", by: "auto", at: 3000 }, pipe: { typeKey: "truss-pipe", by: "auto", at: 3000 } });
    const raw3 = await getBlob<Record<string, { typeKey: string; by: string }>>("gridTypeMap", {});
    ok(raw3["motorized hoist"].by === "admin" && raw3.pipe?.typeKey === "truss-pipe",
      "#226 store: setBlobKeysIfAbsent fills missing keys and never replaces an existing one (the atomic guard auto-apply writes through)");

    const prevEnv = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "preview";
    try {
      const pv = await DT.loadDeviceTypeContext([{ category: "Dimmers" }], 4000);
      const rawPv = await getBlob<Record<string, unknown>>("gridTypeMap", {});
      ok(pv.map.dimmers?.typeKey === "dimming-power" && !("dimmers" in rawPv),
        "#226 store: a Vercel preview applies auto matches in memory but never writes them (previews share production's DB)");
    } finally {
      if (prevEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = prevEnv;
    }

    const cleared = await DT.assignDeviceType(["Truss"], null, 5000);
    const afterClear = await DT.loadDeviceTypeContext(parts, 6000);
    ok(cleared.ok && afterClear.map.truss?.typeKey === null && afterClear.map.truss?.by === "admin", "#226 store: an admin 'unmapped' sticks — auto never re-maps it");
    ok(!(await DT.assignDeviceType(["Truss"], "no-such-type")).ok && !(await DT.assignDeviceType([], "speakers")).ok,
      "#226 store: assign refuses an unknown type or an empty selection");

    await DT.assignDeviceType(["Gizmos", "Widgets"], "amplifiers", 7000);
    const merged = await DT.mergeDeviceType("amplifiers", "speakers", 8000);
    const mm = await DT.getTypeMap();
    const mt = await DT.getDeviceTypes();
    ok(merged.ok && merged.moved === 2 && mm.gizmos?.typeKey === "speakers" && mm.widgets?.typeKey === "speakers" && mt.find((t) => t.key === "amplifiers")?.archived === true,
      "#226 store: merge moves every category of a type to the target and archives the merged type");
    ok(!(await DT.mergeDeviceType("speakers", "speakers")).ok && !(await DT.mergeDeviceType("speakers", "amplifiers")).ok,
      "#226 store: merge refuses the same type or an archived target");

    const acc = await DT.acceptAllSuggestions([{ category: "Control", desc: "ETC Ion" }, { category: "Architectural", desc: "x" }], 9000);
    const ma = await DT.getTypeMap();
    ok(acc === 2 && ma.control?.typeKey === "control-networking" && ma.control?.by === "admin" && ma.architectural?.typeKey === "fixtures",
      "#226 store: Accept all suggestions applies the low-confidence ones as admin entries");

    const saved = await DT.saveDeviceTypes([...mt.map((t) => (t.key === "cameras" ? { ...t, label: "PTZ & Cameras" } : t)), { label: "Fog & Haze", scope: "Lighting" }]);
    const re = await DT.getDeviceTypes();
    ok(saved.ok && re.find((t) => t.key === "cameras")?.label === "PTZ & Cameras" && re.some((t) => t.key === "fog-haze"), "#226 store: the type list round-trips (rename + add)");
    ok(!(await DT.saveDeviceTypes([{ label: "", scope: "Lighting" }])).ok, "#226 store: an invalid list is refused whole");

    const f1 = await DT.toggleGridFavorite(U, "P-1");
    const f2 = await DT.toggleGridFavorite(U, "P-2");
    ok(f1.ok && f2.ok && (await DT.getGridFavorites(U)).join() === "P-2,P-1", "#226 favorites: newest star first, per user");
    const f3 = await DT.toggleGridFavorite(U, "P-1");
    ok(f3.ok && !f3.on && (await DT.getGridFavorites(U)).join() === "P-2", "#226 favorites: starring again removes it");
    ok((await DT.getGridFavorites("TEST226-other")).length === 0, "#226 favorites: another user's list is separate");
    await setBlob(`gridFavorites:${U}`, { ids: Array.from({ length: 300 }, (_, i) => `F-${i}`) });
    const full = await DT.toggleGridFavorite(U, "P-9");
    ok(!full.ok && /300/.test(full.error), "#226 favorites: capped at 300 — a 301st star is refused with a message");

    for (let i = 0; i < 45; i++) await DT.pushGridRecent(U, `R-${i}`);
    await DT.pushGridRecent(U, "R-40");
    const rec = await DT.getGridRecent(U);
    ok(rec.length === 40 && rec[0] === "R-40" && rec[1] === "R-44" && rec.filter((x) => x === "R-40").length === 1 && !rec.includes("R-4"),
      "#226 recent: last 40 distinct, most recent first");
  } finally {
    await db.delete(blobs226).where(inArray(blobs226.id, ids));
    for (const row of snapshot) await db.insert(blobs226).values(row);
  }
}
```

Then add to the async chain. Landmark: the block of `.then(() => …AsyncChecks())` lines ending just above `// Before the report and before the \`.catch\`, so a thrown suite is torn`. Insert as the **last** `.then` line before that comment:

```ts
  .then(() => deviceTypesAsyncChecks())
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: the run aborts: `src/app/(app)/catalog/device-types/page.tsx` not found (ENOENT from `readFileSync`).

- [ ] **Step 3: Add `setBlobKeysIfAbsent` to `src/db/doc-store.ts`**

Immediately after the closing `}` of `export async function setBlob(…)`, add:

```ts
/**
 * #226: merge `patch` into blob `id` WITHOUT replacing any key already
 * there — the mirror image of setBlob's `||` (here the EXISTING row is the
 * right-hand side, so it wins per top-level key), in one atomic statement.
 * The Grid type map's auto-apply writes through this, so an admin entry can
 * never be replaced by an auto one, even when the two writes race.
 */
export async function setBlobKeysIfAbsent(
  id: string,
  patch: Record<string, unknown>
): Promise<void> {
  if (!Object.keys(patch).length) return;
  const db = await getDb();
  const json = JSON.stringify(patch);
  await db
    .insert(blobs)
    .values({ id, data: patch, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: blobs.id,
      set: {
        data: sql`${json}::jsonb || ${blobs.data}`,
        updatedAt: Date.now(),
      },
    });
}
```

- [ ] **Step 4: Create `src/lib/stores/device-types.ts`**

```ts
import { getBlob, setBlob, setBlobKeysIfAbsent } from "@/db/doc-store";
import {
  DEVICE_TYPES_BLOB,
  FAVORITES_CAP,
  RECENT_CAP,
  TYPE_MAP_BLOB,
  acceptSuggestionEntries,
  assignEntries,
  autoTypeEntries,
  cleanDeviceTypesInput,
  cleanIdList,
  deviceTypesFrom,
  favoritesBlobId,
  mergeTypeEntries,
  recentBlobId,
  sanitizeTypeMap,
  toggleInList,
  typeReviewRows,
  withRecent,
  withTypeIcons,
  type DeviceType,
  type DeviceTypeContext,
  type TypeMap,
} from "@/lib/design/device-types";

/**
 * Grid device types store (#226). Four doc-store blobs, no table and no
 * migration (the dashboard_layouts:<userId> / grid_equipment_map idiom):
 *   gridDeviceTypes        { types: DeviceType[] }   full replacement
 *   gridTypeMap            one top-level key per normalized raw category
 *   gridFavorites:<userId> { ids: string[] }         cap 300
 *   gridRecent:<userId>    { ids: string[] }         last 40 distinct
 * Survives the go-live reset (clearDemoData never touches blobs).
 */

export async function getDeviceTypes(): Promise<DeviceType[]> {
  const row = await getBlob<Record<string, unknown>>(DEVICE_TYPES_BLOB, {});
  return deviceTypesFrom(row.types);
}

export async function saveDeviceTypes(input: unknown): Promise<{ ok: true; types: DeviceType[] } | { ok: false; error: string }> {
  const res = cleanDeviceTypesInput(input, await getDeviceTypes());
  if (!res.ok) return res;
  await setBlob(DEVICE_TYPES_BLOB, { types: res.types });
  return res;
}

/** Grid Settings → Device type icons. Validation (isGridIconId) is the action's job. */
export async function setDeviceTypeIcons(icons: Record<string, string | null>): Promise<DeviceType[]> {
  const next = withTypeIcons(await getDeviceTypes(), icons);
  await setBlob(DEVICE_TYPES_BLOB, { types: next });
  return next;
}

export async function getTypeMap(): Promise<TypeMap> {
  return sanitizeTypeMap(await getBlob<Record<string, unknown>>(TYPE_MAP_BLOB, {}));
}

/**
 * THE read every Grid surface uses (spec: auto-apply). Categories in
 * `parts` with no map entry and a HIGH suggestion are written as `auto`
 * entries through setBlobKeysIfAbsent — an admin entry always wins, even
 * against a racing write — and the map is re-read so the caller sees what
 * actually landed. A second read with nothing new writes nothing. On a
 * Vercel preview (which shares production's database) the matches apply in
 * memory only.
 */
export async function loadDeviceTypeContext(parts: ReadonlyArray<{ category: string }>, now = Date.now()): Promise<DeviceTypeContext> {
  const [types, stored] = await Promise.all([getDeviceTypes(), getTypeMap()]);
  const auto = autoTypeEntries(parts, stored, types, now);
  if (!Object.keys(auto).length) return { types, map: stored };
  if (process.env.VERCEL_ENV === "preview") return { types, map: { ...stored, ...auto } };
  await setBlobKeysIfAbsent(TYPE_MAP_BLOB, auto);
  return { types, map: await getTypeMap() };
}

/** Admin assignment (one row or a bulk selection). `null` = deliberately
 *  unmapped: auto-apply never touches that category again. */
export async function assignDeviceType(
  categories: string[],
  typeKey: string | null,
  now = Date.now()
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const types = await getDeviceTypes();
  if (typeKey !== null && !types.some((t) => t.key === typeKey && !t.archived)) return { ok: false, error: "Pick an active device type." };
  const patch = assignEntries(categories, typeKey, now);
  const count = Object.keys(patch).length;
  if (!count) return { ok: false, error: "Pick at least one category." };
  await setBlob(TYPE_MAP_BLOB, patch);
  return { ok: true, count };
}

/** "Accept all suggestions" — low ones included — for categories that still
 *  have no entry. Fills gaps only (setBlobKeysIfAbsent), so an admin edit
 *  made meanwhile is never replaced. Returns how many it wrote. */
export async function acceptAllSuggestions(parts: ReadonlyArray<{ category: string; desc?: string }>, now = Date.now()): Promise<number> {
  const { types, map } = await loadDeviceTypeContext(parts, now);
  const patch = acceptSuggestionEntries(typeReviewRows(parts, map, types), types, now);
  const n = Object.keys(patch).length;
  if (n) await setBlobKeysIfAbsent(TYPE_MAP_BLOB, patch);
  return n;
}

/** Merge = reassign every category of `fromKey` to `toKey` (admin), then
 *  archive `fromKey`. */
export async function mergeDeviceType(
  fromKey: string,
  toKey: string,
  now = Date.now()
): Promise<{ ok: true; moved: number } | { ok: false; error: string }> {
  const types = await getDeviceTypes();
  const from = types.find((t) => t.key === fromKey);
  const to = types.find((t) => t.key === toKey);
  if (!from || !to || from.key === to.key) return { ok: false, error: "Pick two different device types." };
  if (to.archived) return { ok: false, error: `"${to.label}" is archived — restore it first.` };
  const patch = mergeTypeEntries(await getTypeMap(), fromKey, toKey, now);
  const moved = Object.keys(patch).length;
  if (moved) await setBlob(TYPE_MAP_BLOB, patch);
  await setBlob(DEVICE_TYPES_BLOB, { types: types.map((t) => (t.key === fromKey ? { ...t, archived: true } : t)) });
  return { ok: true, moved };
}

export async function getGridFavorites(userId: string): Promise<string[]> {
  const row = await getBlob<Record<string, unknown>>(favoritesBlobId(userId), {});
  return cleanIdList(row.ids, FAVORITES_CAP);
}

export async function toggleGridFavorite(
  userId: string,
  partId: string
): Promise<{ ok: true; favorites: string[]; on: boolean } | { ok: false; error: string }> {
  const res = toggleInList(await getGridFavorites(userId), partId, FAVORITES_CAP);
  if (!res.ok) return res;
  await setBlob(favoritesBlobId(userId), { ids: res.list });
  return { ok: true, favorites: res.list, on: res.on };
}

export async function getGridRecent(userId: string): Promise<string[]> {
  const row = await getBlob<Record<string, unknown>>(recentBlobId(userId), {});
  return cleanIdList(row.ids, RECENT_CAP);
}

export async function pushGridRecent(userId: string, partId: string): Promise<string[]> {
  const next = withRecent(await getGridRecent(userId), partId, RECENT_CAP);
  await setBlob(recentBlobId(userId), { ids: next });
  return next;
}
```

- [ ] **Step 5: Create `src/app/(app)/catalog/device-types/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { list as listCatalog } from "@/lib/stores/catalog";
import { acceptAllSuggestions, assignDeviceType, mergeDeviceType, saveDeviceTypes } from "@/lib/stores/device-types";

/**
 * Catalog → Device types mutations (#226). Admin (manage_users) only, like
 * every other data-administration screen. Each one refreshes this page and
 * every Grid page, whose palette/Layers/legends read the same map.
 */

type Result = { ok: true; message?: string } | { ok: false; error: string };

function touched() {
  revalidatePath("/catalog/device-types");
  revalidatePath("/design/grid", "layout");
}

export async function saveDeviceTypesAction(types: unknown): Promise<Result> {
  await requirePerm("manage_users");
  const res = await saveDeviceTypes(types);
  if (!res.ok) return res;
  touched();
  return { ok: true, message: "Device types saved." };
}

export async function assignDeviceTypeAction(categories: string[], typeKey: string | null): Promise<Result> {
  await requirePerm("manage_users");
  if (!Array.isArray(categories) || categories.length > 2000) return { ok: false, error: "Pick at most 2,000 categories at once." };
  const res = await assignDeviceType(categories.map((c) => String(c ?? "")), typeKey === null ? null : String(typeKey));
  if (!res.ok) return res;
  touched();
  return { ok: true, message: `${res.count} ${res.count === 1 ? "category" : "categories"} updated.` };
}

export async function acceptAllSuggestionsAction(): Promise<Result> {
  await requirePerm("manage_users");
  const n = await acceptAllSuggestions(await listCatalog());
  touched();
  return { ok: true, message: n ? `${n} ${n === 1 ? "suggestion" : "suggestions"} accepted.` : "Nothing left to accept." };
}

export async function mergeDeviceTypeAction(fromKey: string, toKey: string): Promise<Result> {
  await requirePerm("manage_users");
  const res = await mergeDeviceType(String(fromKey ?? ""), String(toKey ?? ""));
  if (!res.ok) return res;
  touched();
  return { ok: true, message: `Merged — ${res.moved} ${res.moved === 1 ? "category" : "categories"} moved.` };
}
```

- [ ] **Step 6: Create `src/app/(app)/catalog/device-types/page.tsx`**

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { list as listCatalog } from "@/lib/stores/catalog";
import { loadDeviceTypeContext } from "@/lib/stores/device-types";
import { typeReviewRows } from "@/lib/design/device-types";
import DeviceTypesClient from "./device-types-client";

export const metadata = { title: "Device types — Quartzite-6" };
export const dynamic = "force-dynamic";

/**
 * Catalog → Device types (#226, spec §Screens 1): the curated ~25-type list
 * and the mapping of every distinct raw catalog category to one of them.
 * Reading through loadDeviceTypeContext auto-applies confident matches, so
 * the first visit maps the whole existing catalog on its own; what is left
 * unmapped is listed first.
 */
export default async function DeviceTypesPage() {
  const user = await requireUser();
  if (!can("manage_users", user.roles)) {
    return (
      <div className="pk-content" style={{ maxWidth: 960 }}>
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", marginBottom: 20 }}>Device types</div>
        <div className="pk-card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Admin access required</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>
            Mapping catalog categories to Grid device types is limited to admins.
          </div>
        </div>
      </div>
    );
  }

  const catalog = await listCatalog();
  const { types, map } = await loadDeviceTypeContext(catalog);
  const rows = typeReviewRows(catalog, map, types);
  const partCounts: Record<string, number> = {};
  for (const r of rows) if (r.typeKey) partCounts[r.typeKey] = (partCounts[r.typeKey] || 0) + r.count;
  const unmapped = rows.filter((r) => r.status === "unmapped").length;

  return (
    <div className="pk-content" style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: 18 }}>
        <Link href="/catalog" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>
          ← Catalog
        </Link>
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", marginTop: 6 }}>Device types</div>
        <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5, lineHeight: 1.5, maxWidth: 780 }}>
          The Grid&apos;s palette, layers and legends group parts by these types instead of the{" "}
          {rows.length.toLocaleString("en-US")} raw catalog categories. Confident matches apply on their own (marked{" "}
          <em>auto</em>); {unmapped.toLocaleString("en-US")} {unmapped === 1 ? "category needs" : "categories need"} a
          decision. Estimating groups &amp; trades stay on the{" "}
          <Link href="/catalog" style={{ color: "var(--accent)" }}>
            Catalog
          </Link>{" "}
          page.
        </div>
      </div>
      <DeviceTypesClient key={JSON.stringify(types)} types={types} rows={rows} partCounts={partCounts} />
    </div>
  );
}
```

- [ ] **Step 7: Create `src/app/(app)/catalog/device-types/device-types-client.tsx`**

```tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GRID_LAYERS, type GridLayer } from "@/lib/design/grid-scopes";
import type { DeviceType, TypeReviewRow } from "@/lib/design/device-types";
import { acceptAllSuggestionsAction, assignDeviceTypeAction, mergeDeviceTypeAction, saveDeviceTypesAction } from "./actions";

/**
 * Catalog → Device types editor (#226). Two cards: the type list (rename,
 * reorder, add, archive, merge) and the category mapping table (unmapped
 * first, per-row type select, bulk assign, "Accept all suggestions"). The
 * page keys this component by the type list, so a save that changes types
 * resets the drafts to what the server now holds.
 */

type Result = { ok: true; message?: string } | { ok: false; error: string };
type Draft = { key?: string; label: string; scope: GridLayer; archived?: boolean };
type Show = "unmapped" | "auto" | "all";

const INPUT: React.CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12.5, border: "1px solid #e4e7ec", borderRadius: 8, padding: "6px 8px", background: "#fff", color: "#16181d", outline: "none", minWidth: 0 };
const BTN: React.CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600, border: "1px solid #e4e7ec", borderRadius: 8, padding: "7px 12px", background: "#fff", color: "#16181d", cursor: "pointer", whiteSpace: "nowrap" };
const PRIMARY: React.CSSProperties = { ...BTN, border: "1px solid transparent", background: "var(--accent)", color: "#fff" };
const OFF: React.CSSProperties = { ...BTN, color: "#aab0bb", cursor: "not-allowed" };
const MINI: React.CSSProperties = { ...BTN, padding: "3px 7px", fontSize: 11.5 };
const TAG: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 5, marginLeft: 6 };
const CARD: React.CSSProperties = { overflow: "hidden", marginBottom: 18 };
const HEAD: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", rowGap: 10, padding: "14px 18px", borderBottom: "1px solid #ececf0" };
const TYPE_GRID = "56px minmax(0, 1fr) 150px 90px 80px";
const ROW_GRID = "26px minmax(0, 1fr) 70px 210px 210px";
const scopeName = (s: GridLayer) => (s === "Unscoped" ? "General (Unscoped)" : s);

export default function DeviceTypesClient({
  types,
  rows,
  partCounts,
}: {
  types: DeviceType[];
  rows: TypeReviewRow[];
  partCounts: Record<string, number>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const initial = useMemo<Draft[]>(() => types.map((t) => ({ key: t.key, label: t.label, scope: t.scope, archived: !!t.archived })), [types]);
  const [drafts, setDrafts] = useState<Draft[]>(initial);
  const [newLabel, setNewLabel] = useState("");
  const [newScope, setNewScope] = useState<GridLayer>("Lighting");
  const [mergeFrom, setMergeFrom] = useState("");
  const [mergeTo, setMergeTo] = useState("");
  const [mergeArmed, setMergeArmed] = useState(false);
  const [show, setShow] = useState<Show>(rows.some((r) => r.status === "unmapped") ? "unmapped" : "all");
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [bulkType, setBulkType] = useState("");

  const active = useMemo(() => types.filter((t) => !t.archived), [types]);
  const labelOf = (key: string | null | undefined) => (key ? types.find((t) => t.key === key)?.label ?? key : "");
  const dirty = JSON.stringify(drafts) !== JSON.stringify(initial);
  const needle = filter.trim().toLowerCase();
  const shown = rows.filter((r) => (show === "all" || r.status === show) && (!needle || r.category.toLowerCase().includes(needle)));
  const tally: Record<Show, number> = {
    unmapped: rows.filter((r) => r.status === "unmapped").length,
    auto: rows.filter((r) => r.status === "auto").length,
    all: rows.length,
  };
  const acceptable = rows.filter((r) => r.status === "unmapped" && !r.entry && r.suggestion && active.some((t) => t.key === r.suggestion!.typeKey)).length;
  const pickedSet = new Set(picked);
  const allShownPicked = shown.length > 0 && shown.every((r) => pickedSet.has(r.category));

  const run = (fn: () => Promise<Result>, after?: () => void) => {
    setMsg(null);
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setMsg({ ok: true, text: r.message || "Saved." });
        after?.();
        router.refresh();
      } else setMsg({ ok: false, text: r.error });
    });
  };
  const edit = (i: number, patch: Partial<Draft>) => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, by: -1 | 1) =>
    setDrafts((d) => {
      const j = i + by;
      if (j < 0 || j >= d.length) return d;
      const next = [...d];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const add = () => {
    const label = newLabel.trim();
    if (!label) return;
    setDrafts((d) => [...d, { label, scope: newScope }]);
    setNewLabel("");
  };
  const togglePick = (category: string) => setPicked((p) => (p.includes(category) ? p.filter((c) => c !== category) : [...p, category]));
  const togglePickShown = () =>
    setPicked((p) => (allShownPicked ? p.filter((c) => !shown.some((r) => r.category === c)) : [...new Set([...p, ...shown.map((r) => r.category)])]));
  const typeOptions = active.map((t) => (
    <option key={t.key} value={t.key}>
      {t.label}
    </option>
  ));

  return (
    <>
      {msg && (
        <div
          role="status"
          style={{ marginBottom: 12, fontSize: 12.5, borderRadius: 8, padding: "9px 12px", color: msg.ok ? "#1f7a52" : "#b4543a", background: msg.ok ? "#eaf6ef" : "#f9ece8", border: `1px solid ${msg.ok ? "#cfe9da" : "#f0d6cd"}` }}
        >
          {msg.text}
        </div>
      )}

      <section className="pk-card" style={CARD}>
        <div style={HEAD}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Types</div>
            <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4 }}>
              Rename, reorder, add or archive. An archived type maps nothing; its categories show as unmapped.
            </div>
          </div>
          <button type="button" disabled={!dirty || pending} onClick={() => run(() => saveDeviceTypesAction(drafts))} style={dirty && !pending ? PRIMARY : OFF}>
            {pending ? "Saving…" : "Save types"}
          </button>
        </div>
        <div style={{ padding: "12px 18px", display: "grid", gap: 6 }}>
          {drafts.map((d, i) => (
            <div key={d.key ?? `new-${i}`} style={{ display: "grid", gridTemplateColumns: TYPE_GRID, gap: 8, alignItems: "center", opacity: d.archived ? 0.55 : 1 }}>
              <span style={{ display: "flex", gap: 3 }}>
                <button type="button" aria-label={`Move ${d.label} up`} onClick={() => move(i, -1)} disabled={i === 0} style={MINI}>
                  ↑
                </button>
                <button type="button" aria-label={`Move ${d.label} down`} onClick={() => move(i, 1)} disabled={i === drafts.length - 1} style={MINI}>
                  ↓
                </button>
              </span>
              <input value={d.label} onChange={(e) => edit(i, { label: e.target.value })} aria-label="Type name" maxLength={40} style={INPUT} />
              <select value={d.scope} onChange={(e) => edit(i, { scope: e.target.value as GridLayer })} aria-label={`Scope for ${d.label}`} style={INPUT}>
                {GRID_LAYERS.map((s) => (
                  <option key={s} value={s}>
                    {scopeName(s)}
                  </option>
                ))}
              </select>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#8c919c", textAlign: "right" }}>
                {d.key ? `${(partCounts[d.key] || 0).toLocaleString("en-US")} parts` : "new"}
              </span>
              <button type="button" onClick={() => edit(i, { archived: !d.archived })} style={MINI}>
                {d.archived ? "Restore" : "Archive"}
              </button>
            </div>
          ))}
          <div style={{ display: "grid", gridTemplateColumns: TYPE_GRID, gap: 8, alignItems: "center", marginTop: 6 }}>
            <span />
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
              placeholder="New type, e.g. Fog & Haze"
              aria-label="New type name"
              maxLength={40}
              style={INPUT}
            />
            <select value={newScope} onChange={(e) => setNewScope(e.target.value as GridLayer)} aria-label="New type scope" style={INPUT}>
              {GRID_LAYERS.map((s) => (
                <option key={s} value={s}>
                  {scopeName(s)}
                </option>
              ))}
            </select>
            <span />
            <button type="button" onClick={add} disabled={!newLabel.trim()} style={MINI}>
              + Add
            </button>
          </div>
        </div>
        <div style={{ padding: "12px 18px 16px", borderTop: "1px solid #ececf0", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Merge</span>
          <select
            value={mergeFrom}
            onChange={(e) => {
              setMergeFrom(e.target.value);
              setMergeArmed(false);
            }}
            aria-label="Type to merge"
            style={INPUT}
          >
            <option value="">Type to merge…</option>
            {typeOptions}
          </select>
          <span style={{ fontSize: 12.5, color: "#8c919c" }}>into</span>
          <select
            value={mergeTo}
            onChange={(e) => {
              setMergeTo(e.target.value);
              setMergeArmed(false);
            }}
            aria-label="Merge into"
            style={INPUT}
          >
            <option value="">Target type…</option>
            {active
              .filter((t) => t.key !== mergeFrom)
              .map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
          </select>
          {!mergeArmed ? (
            <button
              type="button"
              disabled={!mergeFrom || !mergeTo || mergeFrom === mergeTo || pending || dirty}
              title={dirty ? "Save or undo the type edits first" : undefined}
              onClick={() => setMergeArmed(true)}
              style={!mergeFrom || !mergeTo || mergeFrom === mergeTo || dirty ? OFF : BTN}
            >
              Merge…
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(
                    () => mergeDeviceTypeAction(mergeFrom, mergeTo),
                    () => {
                      setMergeArmed(false);
                      setMergeFrom("");
                      setMergeTo("");
                    }
                  )
                }
                style={PRIMARY}
              >
                Move every {labelOf(mergeFrom)} category to {labelOf(mergeTo)} and archive {labelOf(mergeFrom)}
              </button>
              <button type="button" onClick={() => setMergeArmed(false)} style={BTN}>
                Cancel
              </button>
            </>
          )}
        </div>
      </section>

      <section className="pk-card" style={CARD}>
        <div style={HEAD}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Catalog categories</div>
            <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4 }}>
              Every raw category in the catalog. <strong>auto</strong> = applied by a confident match; change it to make it yours.
            </div>
          </div>
          <button type="button" disabled={!acceptable || pending} onClick={() => run(() => acceptAllSuggestionsAction())} style={acceptable && !pending ? PRIMARY : OFF}>
            Accept all suggestions ({acceptable})
          </button>
        </div>
        <div style={{ padding: "12px 18px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid #ececf0" }}>
          {(["unmapped", "auto", "all"] as Show[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setShow(s)}
              aria-pressed={show === s}
              style={{ ...MINI, background: show === s ? "#16181d" : "#fff", color: show === s ? "#fff" : "#3d424e", borderColor: show === s ? "#16181d" : "#e4e7ec" }}
            >
              {s === "unmapped" ? "Unmapped" : s === "auto" ? "Auto" : "All"} {tally[s]}
            </button>
          ))}
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter categories" aria-label="Filter categories" style={{ ...INPUT, width: 220 }} />
          <span style={{ flex: 1 }} />
          <select value={bulkType} onChange={(e) => setBulkType(e.target.value)} aria-label="Type for the selected categories" style={INPUT}>
            <option value="">— Unmapped —</option>
            {typeOptions}
          </select>
          <button
            type="button"
            disabled={!picked.length || pending}
            onClick={() => run(() => assignDeviceTypeAction(picked, bulkType || null), () => setPicked([]))}
            style={picked.length && !pending ? PRIMARY : OFF}
          >
            Assign to {picked.length} selected
          </button>
        </div>
        <div style={{ padding: "6px 18px 14px" }}>
          <div style={{ display: "grid", gridTemplateColumns: ROW_GRID, gap: 8, alignItems: "center", fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", padding: "8px 0" }}>
            <input type="checkbox" aria-label="Select every shown category" checked={allShownPicked} onChange={togglePickShown} />
            <span>Category</span>
            <span style={{ textAlign: "right" }}>Parts</span>
            <span>Suggested</span>
            <span>Device type</span>
          </div>
          {shown.map((r) => (
            <div key={r.key} style={{ display: "grid", gridTemplateColumns: ROW_GRID, gap: 8, alignItems: "center", padding: "5px 0", borderTop: "1px solid #f3f4f6" }}>
              <input type="checkbox" aria-label={`Select ${r.category}`} checked={pickedSet.has(r.category)} onChange={() => togglePick(r.category)} />
              <span title={r.category} style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.category}
                {r.status === "auto" && <span style={{ ...TAG, color: "#1f5fa8", background: "#e8f0fb" }}>auto</span>}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#5b616e", textAlign: "right" }}>{r.count.toLocaleString("en-US")}</span>
              <span style={{ fontSize: 12, color: "#5b616e", minWidth: 0 }}>
                {r.suggestion ? (
                  <>
                    {labelOf(r.suggestion.typeKey)}
                    <span
                      style={{
                        ...TAG,
                        color: r.suggestion.confidence === "high" ? "#1f7a52" : "#8a6d1f",
                        background: r.suggestion.confidence === "high" ? "#eaf6ef" : "#fbf3dd",
                      }}
                    >
                      {r.suggestion.confidence}
                    </span>
                  </>
                ) : (
                  <span style={{ color: "#b7bcc6" }}>—</span>
                )}
              </span>
              <select
                value={r.typeKey ?? ""}
                disabled={pending}
                onChange={(e) => run(() => assignDeviceTypeAction([r.category], e.target.value || null))}
                aria-label={`Device type for ${r.category}`}
                style={INPUT}
              >
                <option value="">— Unmapped —</option>
                {typeOptions}
              </select>
            </div>
          ))}
          {shown.length === 0 && (
            <div style={{ padding: "18px 0", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
              {show === "unmapped" && !needle ? "Every category has a device type." : "No category matches."}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
```

- [ ] **Step 8: Link it from the Catalog, rename the taxonomy card, update Grid Settings' related link, add the smoke route**

`src/app/(app)/catalog/page.tsx`: find the Datasheets link (landmark: `href="/catalog/documents"` … `Datasheets` … `</Link>`). Directly after that `</Link>`, insert:

```tsx
          {/* #226 — the Grid's device types (admin). */}
          {isAdmin && (
            <Link
              href="/catalog/device-types"
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#16181d",
                background: "#fff",
                border: "1px solid #e4e7ec",
                borderRadius: 9,
                padding: "10px 15px",
                textDecoration: "none",
              }}
            >
              Device types
            </Link>
          )}
```

`src/app/(app)/catalog/taxonomy-card.tsx`: replace
`<span style={{ fontSize: 14.5, fontWeight: 600 }}>Categories &amp; trades</span>` with
`<span style={{ fontSize: 14.5, fontWeight: 600 }}>Estimating groups &amp; trades</span>`
and replace the description line
`Map each imported category to a beta Group and Trade so parts roll up correctly.` with
`Map each imported category to a Group and Trade so estimates roll up correctly. The Grid groups parts by Device types instead.`
In the file's header comment, change `Admin "Categories & trades" mapping editor` to `Admin "Estimating groups & trades" mapping editor (was "Categories & trades"; #226 moved the Grid onto Device types)`.

`src/app/(app)/design/grid/settings/page.tsx`: in `RELATED`, replace
`{ label: "Catalog — Categories & trades", href: "/catalog", desc: "Category → group/trade mapping the Grid editor reads." },` with
`{ label: "Catalog — Device types", href: "/catalog/device-types", desc: "The ~25 device types the Grid palette, layers and legends group parts by." },`

`scripts/smoke-routes.ts`: after the line `"/catalog/documents/upload", // #207 — bulk drop` add:

```ts
  "/catalog/device-types", // #226 — Grid device types (admin; auto-applies confident matches on read)
```

- [ ] **Step 9: Run the gates**

```bash
npx tsc --noEmit
npm run test:specs 2>&1 | tee /tmp/claude-226-t2.txt | tail -3; grep -c '^PASS ' /tmp/claude-226-t2.txt; grep '^FAIL' /tmp/claude-226-t2.txt
npx eslint src/db/doc-store.ts src/lib/stores/device-types.ts "src/app/(app)/catalog/device-types/" "src/app/(app)/catalog/page.tsx" "src/app/(app)/catalog/taxonomy-card.tsx" "src/app/(app)/design/grid/settings/page.tsx" scripts/smoke-routes.ts scripts/test-review-and-spec.ts
npx next build 2>&1 | tail -15
```
Expected: 0 tsc errors; `ALL PASSED`, no `FAIL`; eslint 0 errors; build succeeds and lists `/catalog/device-types`.

- [ ] **Step 10: Commit**

```bash
git add src/db/doc-store.ts src/lib/stores/device-types.ts "src/app/(app)/catalog/device-types" "src/app/(app)/catalog/page.tsx" "src/app/(app)/catalog/taxonomy-card.tsx" "src/app/(app)/design/grid/settings/page.tsx" scripts/smoke-routes.ts scripts/test-review-and-spec.ts
git commit -m "$(printf 'feat(grid): device-types store with auto-apply + Catalog → Device types screen (#226)\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 3: Palette — tabs, type chips, manufacturer filter, hidden unmapped, stars, Recent

**Files:**
- Create: `src/lib/design/grid-palette.ts`
- Create: `src/app/(app)/design/grid/[id]/device-palette.tsx`
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx` (imports ~36-92, props ~242-296, palette state ~365-372, `filteredParts` ~441-457, main `return (` ~1167, palette JSX ~1371-1478)
- Modify: `src/app/(app)/design/grid/[id]/page.tsx` (loads + props)
- Modify: `src/app/(app)/design/grid/[id]/actions.ts` (`placeDeviceAction` ~353; new `toggleGridFavoriteAction`)
- Test: `scripts/test-review-and-spec.ts` (new block + two existing assertions updated)

**Interfaces:**
- Consumes: Task 1 `typeKeyOfPart`, `typeLabel`, `UNMAPPED_TYPE`, `ASSEMBLY_TYPE`, `ALLOWANCE_TYPE`, `DeviceType`; Task 2 `loadDeviceTypeContext`, `getGridFavorites`, `getGridRecent`, `pushGridRecent`, `toggleGridFavorite`.
- Produces:
  - `@/lib/design/grid-palette`: `type PaletteTab = "favorites" | "recent" | "all"`, `PALETTE_ROW_CAP = 60`, `type PaletteQuery = { tab: PaletteTab; search: string; scope: GridLayer | ""; typeKey: string; mfr: string }`, `type PaletteChip = { key: string; label: string; count: number }`, `type PaletteView = { rows: PartLite[]; hiddenUnmapped: number; scopeCounts: Record<string, number>; typeChips: PaletteChip[]; manufacturers: string[] }`, `isMapped(p: PartLite): boolean`, `paletteView(parts, query, types, favorites, recent): PaletteView`
  - `toggleGridFavoriteAction(partId: string): Promise<{ ok: true; favorites: string[]; on: boolean } | { ok: false; error: string }>` in `design/grid/[id]/actions.ts`
  - `GridEditor` props `deviceTypes: DeviceType[]; favorites: string[]; recent: string[]`
  - Editor callbacks `armPart(partId: string | null)` and `partLayerHidden(p: PartLite): boolean` (Task 4 extends the latter).

- [ ] **Step 1: Write the failing tests** — append to the end of `scripts/test-review-and-spec.ts`:

```ts
/* ======================================================================
   #226 Grid device types — Task 3: the palette (pure filter + wiring).
   ====================================================================== */
import { paletteView as pal226View, isMapped as pal226Mapped, PALETTE_ROW_CAP as PAL226_CAP } from "@/lib/design/grid-palette";
import type { PartLite as PL226 } from "@/lib/design/grid-bom";

{
  const j = (x: unknown) => JSON.stringify(x);
  const types = dt226From(undefined);
  const P = (id: string, extra: Partial<PL226>): PL226 => ({ id, sku: id, desc: id, category: "X", unit: "ea", list: 0, cost: 0, ...extra });
  const parts: PL226[] = [
    P("spk-a", { desc: "Alpha speaker", manufacturer: "QSC", deviceType: "speakers", gridScope: "Audio" }),
    P("spk-b", { desc: "Beta speaker", manufacturer: "Meyer", deviceType: "speakers", gridScope: "Audio" }),
    P("amp-a", { desc: "Amp", manufacturer: "QSC", deviceType: "amplifiers", gridScope: "Audio" }),
    P("wid", { desc: "Widget speaker bracket", manufacturer: "Acme", deviceType: null, gridScope: "Audio" }),
    P("asm", { desc: "Rack assembly", kind: "assembly", deviceType: null, gridScope: "Audio" }),
    P("fab", { desc: "Velour", category: "Fabric", deviceType: null }),
    P("virt", { desc: "Virtual", virtual: true, deviceType: "speakers", gridScope: "Audio" }),
    P("fix", { desc: "Source Four", manufacturer: "ETC", deviceType: "fixtures", gridScope: "Lighting" }),
  ];
  const view = (over: Partial<{ tab: "favorites" | "recent" | "all"; search: string; scope: "" | "Audio" | "Lighting"; typeKey: string; mfr: string }>) =>
    pal226View(parts, { tab: "all", search: "", scope: "", typeKey: "", mfr: "", ...over }, types, ["fix", "gone", "spk-b"], ["amp-a"]);
  const ids = (v: ReturnType<typeof view>) => v.rows.map((p) => p.id).join(",");

  const all = view({});
  ok(ids(all) === "spk-a,amp-a,spk-b,asm,fix" && all.hiddenUnmapped === 1, "#226 palette: without a search, unmapped parts are hidden (and counted); virtual and Fabric rows never show");
  ok(all.scopeCounts[""] === 5 && all.scopeCounts.Audio === 4 && all.scopeCounts.Lighting === 1, "#226 palette: scope chip counts cover what the chip would show");
  ok(view({ scope: "Audio" }).typeChips.map((c) => c.key).join(",") === "speakers,amplifiers,__assembly", "#226 palette: a scope shows its type chips in type order, assemblies after");
  const spk = view({ scope: "Audio", typeKey: "speakers" });
  ok(ids(spk) === "spk-a,spk-b" && j(spk.manufacturers) === j(["Meyer", "QSC"]), "#226 palette: a type chip narrows the rows and the manufacturer list");
  ok(ids(view({ scope: "Audio", typeKey: "speakers", mfr: "QSC" })) === "spk-a", "#226 palette: the manufacturer filter narrows further");
  const found = view({ search: "speaker" });
  ok(ids(found) === "spk-a,spk-b,wid" && found.hiddenUnmapped === 0 && !pal226Mapped(found.rows[2]), "#226 palette: a search finds unmapped parts too");
  ok(view({ scope: "Audio", search: "speaker" }).typeChips.map((c) => c.key).join(",") === "speakers,__unmapped", "#226 palette: while searching, an Unmapped chip appears last");
  ok(ids(view({ tab: "favorites" })) === "fix,spk-b" && ids(view({ tab: "favorites", search: "beta" })) === "spk-b" && ids(view({ tab: "recent" })) === "amp-a",
    "#226 palette: Favorites and Recent keep their stored order, skip parts no longer in the library, and honour the search");
  ok(PAL226_CAP === 60, "#226 palette: the row cap stays 60");

  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const pal = read("src/app/(app)/design/grid/[id]/device-palette.tsx");
  const palImports = [...pal.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  ok(pal.startsWith('"use client"') && palImports.every((s) => !s.startsWith("@/lib/stores/") && !s.startsWith("@/db")) && pal.includes("paletteView(") && pal.includes("toggleGridFavoriteAction(") && pal.includes('href="/catalog/device-types"'),
    "#226 palette: a client component on pure modules; stars through the action; admins get a link to Device types");
  const ed = read("src/app/(app)/design/grid/[id]/editor.tsx");
  ok(ed.includes("<DevicePalette") && !ed.includes("filteredParts") && !ed.includes("scopeFilter"), "#226 palette: the editor delegates the palette");
  const pg = read("src/app/(app)/design/grid/[id]/page.tsx");
  ok(pg.includes("loadDeviceTypeContext(catalog)") && pg.includes("getGridFavorites(user.id)") && pg.includes("getGridRecent(user.id)") && pg.includes("favorites={favorites}") && pg.includes("recent={recent}"),
    "#226 palette: the page loads types, favorites and recent for the signed-in user");
  const acts = read("src/app/(app)/design/grid/[id]/actions.ts");
  const body = (name: string) => acts.slice(acts.indexOf(`export async function ${name}`), acts.indexOf("\n}\n", acts.indexOf(`export async function ${name}`)));
  ok(body("placeDeviceAction").includes("pushGridRecent(user.id, input.partId)"), "#226 recent: placing a device updates the placer's Recent");
  ok(body("toggleGridFavoriteAction").includes("await requireUser()") && body("toggleGridFavoriteAction").includes("toggleGridFavorite(user.id"), "#226 favorites: the star action is per signed-in user");
}
```

Then update two existing assertions whose source moved:

1. Landmark `#209 parts: the plan editor flags datasheets from part documents` — in the `ok(gpPlanSrc.includes(…` line just above it, replace
   `gpPlanSrc.includes("gridPartsFrom(gridSymbols, catalog, categoryMap, { hasDatasheet: hasDatasheetFile })")`
   with
   `gpPlanSrc.includes("gridPartsFrom(gridSymbols, catalog, categoryMap, { hasDatasheet: hasDatasheetFile, deviceTypes })")`
2. Landmark `#211 T6: the palette hides virtual parts` — replace `ok(ed6.includes("!p.virtual") &&` with
   `ok(readFileSync(join(process.cwd(), "src/lib/design/grid-palette.ts"), "utf8").includes("!p.virtual") &&`
   and change the message's start to `"#211 T6 (moved by #226): the palette (grid-palette.ts) hides virtual parts;`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: the run aborts resolving `@/lib/design/grid-palette`.

- [ ] **Step 3: Create `src/lib/design/grid-palette.ts`**

```ts
import type { PartLite } from "./grid-bom";
import { scopeOfPart, type GridLayer } from "./grid-scopes";
import { ALLOWANCE_TYPE, ASSEMBLY_TYPE, UNMAPPED_TYPE, typeKeyOfPart, typeLabel, type DeviceType } from "./device-types";

/**
 * The Grid device palette's filter (#226, spec §Screens 2). Pure and
 * client-safe; device-palette.tsx renders what this returns.
 *
 * Favorites / Recent: the user's stored order, parts no longer in the
 * library skipped, the search applied. All: scope chip → type chips for
 * that scope → manufacturer → search. Without a search an unmapped part
 * (no device type; assemblies and allowances never count as unmapped) is
 * hidden and counted; with a search every part matches. Virtual parts and
 * Fabric/Labor rows are never placeable here (curtains arrive through the
 * curtain drop-in).
 */

export type PaletteTab = "favorites" | "recent" | "all";
export const PALETTE_ROW_CAP = 60;
export type PaletteQuery = { tab: PaletteTab; search: string; scope: GridLayer | ""; typeKey: string; mfr: string };
export type PaletteChip = { key: string; label: string; count: number };
export type PaletteView = {
  rows: PartLite[];
  hiddenUnmapped: number;
  scopeCounts: Record<string, number>;
  typeChips: PaletteChip[];
  manufacturers: string[];
};

const placeable = (p: PartLite) => !p.virtual && p.category !== "Fabric" && p.category !== "Labor";
const matches = (p: PartLite, q: string) => (p.desc + " " + (p.modelNumber || p.sku) + " " + (p.manufacturer || "")).toLowerCase().includes(q);
const byName = (a: PartLite, b: PartLite) => a.desc.localeCompare(b.desc) || a.sku.localeCompare(b.sku);

export function isMapped(p: PartLite): boolean {
  return typeKeyOfPart(p) !== UNMAPPED_TYPE;
}

export function paletteView(
  parts: readonly PartLite[],
  query: PaletteQuery,
  types: readonly DeviceType[],
  favorites: readonly string[],
  recent: readonly string[]
): PaletteView {
  const base = parts.filter(placeable);
  const q = query.search.trim().toLowerCase();

  if (query.tab !== "all") {
    const byId = new Map(base.map((p) => [p.id, p]));
    const rows = (query.tab === "favorites" ? favorites : recent)
      .map((id) => byId.get(id))
      .filter((p): p is PartLite => !!p && (!q || matches(p, q)));
    return { rows, hiddenUnmapped: 0, scopeCounts: {}, typeChips: [], manufacturers: [] };
  }

  const visible = (p: PartLite) => (q ? matches(p, q) : isMapped(p));
  const scopeCounts: Record<string, number> = { "": 0 };
  for (const p of base) {
    if (!visible(p)) continue;
    const s = scopeOfPart(p);
    scopeCounts[s] = (scopeCounts[s] || 0) + 1;
    scopeCounts[""] += 1;
  }

  const inScope = query.scope ? base.filter((p) => scopeOfPart(p) === query.scope) : base;
  const typeCount = new Map<string, number>();
  if (query.scope) {
    for (const p of inScope) {
      if (!visible(p)) continue;
      const k = typeKeyOfPart(p);
      typeCount.set(k, (typeCount.get(k) || 0) + 1);
    }
  }
  const order = new Map(types.map((t, i) => [t.key, i]));
  const rank = (k: string) => (k === UNMAPPED_TYPE ? 3e6 : k === ALLOWANCE_TYPE ? 2e6 + 1 : k === ASSEMBLY_TYPE ? 2e6 : order.get(k) ?? 1e6);
  const typeChips = [...typeCount.entries()]
    .map(([key, count]) => ({ key, label: typeLabel(key, types), count }))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label));

  const inType = query.scope && query.typeKey ? inScope.filter((p) => typeKeyOfPart(p) === query.typeKey) : inScope;
  const manufacturers = [...new Set(inType.filter(visible).map((p) => (p.manufacturer || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const inMfr = query.mfr ? inType.filter((p) => (p.manufacturer || "").trim() === query.mfr) : inType;
  const rows = inMfr.filter(visible).sort(byName);
  const hiddenUnmapped = q ? 0 : inMfr.filter((p) => !isMapped(p)).length;
  return { rows, hiddenUnmapped, scopeCounts, typeChips, manufacturers };
}
```

- [ ] **Step 4: Create `src/app/(app)/design/grid/[id]/device-palette.tsx`**

```tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { PartLite } from "@/lib/design/grid-bom";
import type { SymbolLook } from "@/lib/design/grid-icons";
import type { DeviceType } from "@/lib/design/device-types";
import { GRID_LAYERS, type GridLayer } from "@/lib/design/grid-scopes";
import { PALETTE_ROW_CAP, isMapped, paletteView, type PaletteTab } from "@/lib/design/grid-palette";
import { SymbolIcon } from "@/components/design/symbol-shape";
import { SearchFilterBar } from "@/components/search/search-filter-bar";
import { useCanMap } from "@/components/design/equipment-map-link";
import { toggleGridFavoriteAction } from "./actions";

/**
 * The Grid's device palette (#226, spec §Screens 2) — moved out of
 * editor.tsx. Tabs Favorites · Recent · All; in All, scope chips → type
 * chips (+ counts) → manufacturer → search; unmapped parts hidden until you
 * search (admins get a link to map them). The star toggle writes the
 * signed-in user's favorites; Recent comes from the server (placeDeviceAction
 * updates it) and refreshes with the page. Filtering is pure
 * (lib/design/grid-palette); this file only renders it.
 */

const BTN: React.CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  background: "#fff",
  borderRadius: 7,
  padding: "5px 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "#3d424e",
  cursor: "pointer",
  fontFamily: "inherit",
};
const PANEL: React.CSSProperties = { background: "#fff", border: "1px solid #edeff3", borderRadius: 10, padding: 12 };
const PANEL_LABEL: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 7 };

function chip(on: boolean): React.CSSProperties {
  return { ...BTN, padding: "4px 7px", fontSize: 10.5, background: on ? "#16181d" : "#fff", color: on ? "#fff" : "#5b616e", borderColor: on ? "#16181d" : "#dfe2e8" };
}

function moneyFmt(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

const TABS: Array<{ key: PaletteTab; label: string }> = [
  { key: "favorites", label: "Favorites" },
  { key: "recent", label: "Recent" },
  { key: "all", label: "All" },
];

export default function DevicePalette({
  parts,
  types,
  favorites: initialFavorites,
  recent,
  armedPartId,
  onArm,
  onDisarm,
  isHidden,
  lookOf,
}: {
  parts: PartLite[];
  types: DeviceType[];
  favorites: string[];
  recent: string[];
  armedPartId: string | null;
  /** Arm (or, with null, disarm) a part and clear every other armed tool. */
  onArm: (partId: string | null) => void;
  /** The "Done" button: disarm only. */
  onDisarm: () => void;
  /** True when a part's layer is hidden on the plan. */
  isHidden: (p: PartLite) => boolean;
  lookOf: (p: PartLite) => SymbolLook;
}) {
  const canMap = useCanMap();
  const [tab, setTab] = useState<PaletteTab>("all");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<GridLayer | "">("");
  const [typeKey, setTypeKey] = useState("");
  const [mfr, setMfr] = useState("");
  const [favorites, setFavorites] = useState<string[]>(initialFavorites);
  const [starErr, setStarErr] = useState<string | null>(null);
  const [, startStar] = useTransition();

  const activeTypes = useMemo(() => types.filter((t) => !t.archived), [types]);
  const favSet = useMemo(() => new Set(favorites), [favorites]);
  const view = useMemo(
    () => paletteView(parts, { tab, search, scope, typeKey, mfr }, activeTypes, favorites, recent),
    [parts, tab, search, scope, typeKey, mfr, activeTypes, favorites, recent]
  );
  const armedPart = armedPartId ? parts.find((p) => p.id === armedPartId) ?? null : null;

  const pickScope = (s: GridLayer | "") => {
    setScope(s);
    setTypeKey("");
    setMfr("");
  };
  const pickType = (k: string) => {
    setTypeKey((cur) => (cur === k ? "" : k));
    setMfr("");
  };
  const star = (id: string) => {
    const before = favorites;
    setStarErr(null);
    setFavorites(favSet.has(id) ? before.filter((x) => x !== id) : [id, ...before]);
    startStar(async () => {
      const r = await toggleGridFavoriteAction(id);
      if (r.ok) setFavorites(r.favorites);
      else {
        setFavorites(before);
        setStarErr(r.error);
      }
    });
  };

  const emptyText =
    tab === "favorites"
      ? search ? "No favorite matches." : "Star a part (☆) to keep it here."
      : tab === "recent"
        ? search ? "No recent part matches." : "Parts you place show up here."
        : "Nothing matches.";

  return (
    <div style={PANEL}>
      <div style={PANEL_LABEL}>Devices</div>
      <div role="tablist" aria-label="Device lists" style={{ display: "flex", gap: 4, marginBottom: 7 }}>
        {TABS.map((t) => {
          const n = t.key === "favorites" ? favorites.length : t.key === "recent" ? recent.length : null;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} style={{ ...chip(tab === t.key), flex: 1 }}>
              {t.label}
              {n !== null && <span style={{ opacity: 0.65 }}> {n}</span>}
            </button>
          );
        })}
      </div>
      {/* #121: search + scope filter on ONE row (the chips wrap under the box inside this 252px column). */}
      <SearchFilterBar value={search} onChange={setSearch} placeholder="Search names or Manufacturer #" ariaLabel="Search devices">
        {tab === "all" && (
          <div className="pk-searchbar-group">
            {(["", ...GRID_LAYERS] as Array<GridLayer | "">).map((s) => (
              <button key={s || "all"} type="button" onClick={() => pickScope(s)} style={chip(scope === s)}>
                {s || "All"} <span style={{ opacity: 0.65 }}>{view.scopeCounts[s] || 0}</span>
              </button>
            ))}
          </div>
        )}
      </SearchFilterBar>
      {tab === "all" && scope && view.typeChips.length > 0 && (
        <div aria-label={`${scope} device types`} style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 6 }}>
          {view.typeChips.map((c) => (
            <button key={c.key} type="button" onClick={() => pickType(c.key)} aria-pressed={typeKey === c.key} style={chip(typeKey === c.key)}>
              {c.label} <span style={{ opacity: 0.65 }}>{c.count}</span>
            </button>
          ))}
        </div>
      )}
      {tab === "all" && (view.manufacturers.length > 1 || mfr) && (
        <select
          aria-label="Manufacturer"
          value={mfr}
          onChange={(e) => setMfr(e.target.value)}
          style={{ ...BTN, width: "100%", marginTop: 6, fontWeight: 500, padding: "4px 6px" }}
        >
          <option value="">All manufacturers</option>
          {mfr && !view.manufacturers.includes(mfr) && <option value={mfr}>{mfr}</option>}
          {view.manufacturers.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      )}
      {armedPart && isHidden(armedPart) && (
        <div style={{ marginTop: 6, fontSize: 10.5, color: "#a0442b", lineHeight: 1.4 }}>
          That part&apos;s layer is hidden, so what you place won&apos;t show until you turn it back on.
        </div>
      )}
      {armedPart ? (
        <div style={{ marginTop: 8, fontSize: 11.5, color: "#2e7d55", fontWeight: 600 }}>
          Painting: {armedPart.sku} — click the plan to place.{" "}
          <button style={{ ...BTN, padding: "2px 7px", fontSize: 10.5, marginLeft: 2 }} onClick={onDisarm}>
            Done
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 8, fontSize: 11, color: "#8c919c" }}>Pick a part, then click the plan for each unit.</div>
      )}
      <div style={{ marginTop: 8, maxHeight: 300, overflowY: "auto", display: "grid", gap: 3 }}>
        {view.rows.slice(0, PALETTE_ROW_CAP).map((p) => {
          const on = p.id === armedPartId;
          const look = lookOf(p);
          const starred = favSet.has(p.id);
          return (
            <div key={p.id}>
              <div style={{ display: "flex", gap: 3, alignItems: "stretch" }}>
                <button
                  onClick={() => onArm(on ? null : p.id)}
                  title={p.desc}
                  style={{
                    ...BTN,
                    flex: 1,
                    minWidth: 0,
                    textAlign: "left",
                    padding: "5px 8px",
                    fontWeight: 500,
                    display: "grid",
                    gap: 1,
                    background: on ? "#16181d" : "#fff",
                    color: on ? "#fff" : "#3d424e",
                    borderColor: on ? "#16181d" : "#dfe2e8",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <SymbolIcon iconId={look.iconId} color={look.color} size={16} />
                    <strong style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.desc}</strong>
                    <span style={{ marginLeft: "auto", fontSize: 11 }}>{moneyFmt(p.list)}</span>
                  </span>
                  <span style={{ fontSize: 10.5, color: on ? "#c9cdd6" : "#8c919c", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {!isMapped(p) && <span style={{ fontWeight: 700, color: on ? "#f3c9bd" : "#a0442b" }}>Unmapped · </span>}
                    {p.manufacturer ? `${p.manufacturer} · ` : ""}
                    {p.modelNumber || p.sku}
                    {p.kind === "assembly" ? " · assembly" : ""}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => star(p.id)}
                  aria-pressed={starred}
                  aria-label={starred ? `Unstar ${p.desc}` : `Star ${p.desc}`}
                  title={starred ? "Remove from Favorites" : "Add to Favorites"}
                  style={{ ...BTN, padding: "0 7px", fontSize: 14, color: starred ? "#b88a00" : "#b7bcc6" }}
                >
                  {starred ? "★" : "☆"}
                </button>
              </div>
              {/* Datasheet link (Task 5, punch #39) — a sibling of the arm
                  button, never nested: an <a> inside a <button> is invalid. */}
              {p.hasDatasheet && (
                <a
                  href={`/api/part-datasheet/${encodeURIComponent(p.sku)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "block", marginTop: 2, padding: "0 8px", fontSize: 10, color: "var(--accent)", textDecoration: "none" }}
                >
                  Datasheet
                </a>
              )}
            </div>
          );
        })}
        {view.rows.length > PALETTE_ROW_CAP && (
          <div style={{ fontSize: 10.5, color: "#9aa0ab", padding: "3px 2px" }}>{view.rows.length - PALETTE_ROW_CAP} more — narrow the search.</div>
        )}
        {view.rows.length === 0 && <div style={{ fontSize: 11.5, color: "#9aa0ab", padding: "3px 2px" }}>{emptyText}</div>}
      </div>
      {view.hiddenUnmapped > 0 && (
        <div style={{ marginTop: 6, fontSize: 10.5, color: "#8c919c", lineHeight: 1.4 }}>
          {view.hiddenUnmapped} unmapped {view.hiddenUnmapped === 1 ? "part" : "parts"} hidden —{" "}
          {canMap ? (
            <Link href="/catalog/device-types" style={{ color: "var(--accent)" }}>
              map them in Catalog → Device types
            </Link>
          ) : (
            "search to find them"
          )}
          .
        </div>
      )}
      {starErr && <div style={{ marginTop: 6, fontSize: 10.5, color: "#a0442b" }}>{starErr}</div>}
    </div>
  );
}
```

- [ ] **Step 5: Add the favorite action and the Recent write in `src/app/(app)/design/grid/[id]/actions.ts`**

Add to the imports (near `import { createGridAssembly, removeGridAssembly, setGridSymbolLook } from "@/lib/stores/grid-catalog";`):

```ts
import { pushGridRecent, toggleGridFavorite } from "@/lib/stores/device-types";
```

In `placeDeviceAction`, directly after `if (!p) return { ok: false, error: "Design not found." };` and before `revalidatePath(editorPath(projectId));`, insert:

```ts
  // #226: Recent is the placer's own last-40 list — a convenience, so a
  // failed write never fails the placement that already landed.
  try {
    await pushGridRecent(user.id, input.partId);
  } catch {
    /* best-effort */
  }
```

Directly after the closing `}` of `placeDeviceAction`, add:

```ts
/** #226: star / unstar a part in the palette — the signed-in user's own
 *  favorites (cap 300, refused past it). No revalidate: the palette keeps
 *  the returned list; a reload reads the same blob. */
export async function toggleGridFavoriteAction(
  partId: string
): Promise<{ ok: true; favorites: string[]; on: boolean } | { ok: false; error: string }> {
  const user = await requireUser();
  return toggleGridFavorite(user.id, String(partId || ""));
}
```

- [ ] **Step 6: Wire the page — `src/app/(app)/design/grid/[id]/page.tsx`**

Add to the imports:

```ts
import { getGridFavorites, getGridRecent, loadDeviceTypeContext } from "@/lib/stores/device-types";
```

Directly after `const categoryMap = resolveCategoryMap(settings.catalogCategoryMap);`, insert:

```ts
  // #226: curated device types. Reading the map auto-applies confident
  // category matches (spec); every PartLite then carries its type + the
  // type's scope. Favorites/Recent are the signed-in user's own lists.
  const [deviceTypes, favorites, recent] = await Promise.all([
    loadDeviceTypeContext(catalog),
    getGridFavorites(user.id),
    getGridRecent(user.id),
  ]);
```

Replace `...gridPartsFrom(gridSymbols, catalog, categoryMap, { hasDatasheet: hasDatasheetFile }),` with:

```ts
    ...gridPartsFrom(gridSymbols, catalog, categoryMap, { hasDatasheet: hasDatasheetFile, deviceTypes }),
```

In the `<GridEditor` props, after `customLines={customLines}` add:

```tsx
      deviceTypes={deviceTypes.types}
      favorites={favorites}
      recent={recent}
```

- [ ] **Step 7: Delegate the palette in `src/app/(app)/design/grid/[id]/editor.tsx`**

a) Imports. In the `@/lib/design/grid-scopes` import, delete the `GRID_LAYERS,` line (it was only used by the palette). Change `import { SymbolIcon, SymbolShape } from "@/components/design/symbol-shape";` to `import { SymbolShape } from "@/components/design/symbol-shape";`. Delete `import { SearchFilterBar } from "@/components/search/search-filter-bar";`. After `import CustomItemsSection from "./custom-items";` add:

```ts
import DevicePalette from "./device-palette";
import type { DeviceType } from "@/lib/design/device-types";
```
(Before deleting each import, `grep -n` the symbol in the file to confirm the palette was its only use.)

b) Props. In the destructured parameter list, after `customLines,` add `deviceTypes, favorites, recent,`. In the props type, after `customLines: BomLine[];` add:

```ts
  /** #226: the curated device types (palette chips, Layers). */
  deviceTypes: DeviceType[];
  /** #226: this user's starred parts and last-placed parts (newest first). */
  favorites: string[];
  recent: string[];
```

c) State. Delete `const [search, setSearch] = useState("");`, the `// Palette SCOPE filter (punch #48 …` comment block under it, and `const [scopeFilter, setScopeFilter] = useState("");`. Keep `const [armedPartId, setArmedPartId] = useState<string | null>(null);`.

d) Delete the whole `const filteredParts = useMemo(() => { … }, [parts, search, scopeFilter]);` block.

e) Directly above the component's main JSX return (landmark: `  return (` immediately followed by `    <div style={{ display: "grid", gap: 10 }}>` and `      {/* header */}`), insert:

```ts
  /** #226: arming from the palette clears every other armed tool — exactly
   *  what the palette row's inline onClick did before the palette moved to
   *  device-palette.tsx. */
  const armPart = useCallback((partId: string | null) => {
    setArmedPartId(partId);
    setArmedCurtainType(null);
    setSelected(null);
    setSpaceDrawing(false);
    setSpaceDraft([]);
    setSelectedSpaceId(null);
    setWireDrawing(false);
    setWireDraft([]);
    setSelectedRouteId(null);
  }, []);
  /** The palette's "that layer is hidden" warning. */
  const partLayerHidden = useCallback(
    (p: PartLite) => hiddenSet.has(scopeLayerKey(scopeOfPart(p))),
    [hiddenSet]
  );
```

f) Replace the palette JSX. Delete everything from the line `          {/* device palette */}` down to, but not including, the blank line that precedes `          <AssembliesPanel parts={parts} onChanged={() => router.refresh()} />`. That covers the `<div style={PANEL}>` holding `Devices`, the `SearchFilterBar`, the warning, the "Painting:" line, the rows list and the "narrow the search" and "Nothing matches." lines. Put this in its place:

```tsx
          {/* device palette (#226: tabs, device-type chips, manufacturer filter, stars) */}
          <DevicePalette
            parts={parts}
            types={deviceTypes}
            favorites={favorites}
            recent={recent}
            armedPartId={armedPartId}
            onArm={armPart}
            onDisarm={() => setArmedPartId(null)}
            isHidden={partLayerHidden}
            lookOf={lookOf}
          />
```

Then `grep -n "search\b\|setSearch\|scopeFilter\|filteredParts\|SearchFilterBar\|SymbolIcon\|GRID_LAYERS" "src/app/(app)/design/grid/[id]/editor.tsx"` and confirm nothing references a deleted name. The `// this editor (… palette search …)` comment is fine.

- [ ] **Step 8: Run the gates**

```bash
npx tsc --noEmit
npm run test:specs 2>&1 | tee /tmp/claude-226-t3.txt | tail -3; grep -c '^PASS ' /tmp/claude-226-t3.txt; grep '^FAIL' /tmp/claude-226-t3.txt
npx eslint src/lib/design/grid-palette.ts "src/app/(app)/design/grid/[id]/device-palette.tsx" "src/app/(app)/design/grid/[id]/editor.tsx" "src/app/(app)/design/grid/[id]/page.tsx" "src/app/(app)/design/grid/[id]/actions.ts" scripts/test-review-and-spec.ts
npx next build 2>&1 | tail -15
```
Expected: all clean. `next build` must pass: it is the gate that catches a client file pulling a store transitively (memory: *client import of a store breaks only next build*).

- [ ] **Step 9: Commit**

```bash
git add src/lib/design/grid-palette.ts "src/app/(app)/design/grid/[id]/device-palette.tsx" "src/app/(app)/design/grid/[id]/editor.tsx" "src/app/(app)/design/grid/[id]/page.tsx" "src/app/(app)/design/grid/[id]/actions.ts" scripts/test-review-and-spec.ts
git commit -m "$(printf 'feat(grid): device palette with Favorites, Recent, type chips and manufacturer filter (#226)\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 4: Per-type icons, Advanced overrides, Layers + legends grouped by type

**Files:**
- Modify: `src/lib/design/grid-icons.ts` (`SymbolContext`/`symbolContext` ~266-294, `SymbolEntry` ~297-308, `symbolLook` icon block ~386-394, `legendRows` ~421-445, `SymbolCategoryRow` ~449)
- Modify: `src/lib/design/grid-scopes.ts` (layer keys ~140-168)
- Modify: `src/app/(app)/design/grid/[id]/layers-panel.tsx` (whole file)
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx` (imports, `scopeOfPlacement`/`placementVisible`/`scopeCounts` ~463-487, `visibleRoutes` ~587-593, `planLegendRows` ~551-558, `partLayerHidden`, `<LayersPanel`)
- Modify: `src/app/(app)/design/grid/[id]/page.tsx`, `riser/page.tsx`, `set/page.tsx`, `schedule/page.tsx`
- Create: `src/app/(app)/design/grid/settings/device-type-icons-card.tsx`
- Modify: `src/app/(app)/design/grid/settings/category-icons-card.tsx` (whole file), `settings/actions.ts`, `settings/page.tsx`
- Test: `scripts/test-review-and-spec.ts` (new block + async function + one existing assertion updated)

**Interfaces:**
- Consumes: Task 1 `deviceTypeIcons`, `typeKeyOfPart`, `typeLayerRows`, `typeOfCategory`, `UNMAPPED_TYPE`, `UNMAPPED_LABEL`, `DEFAULT_TYPE_ICONS`, `DeviceType`, `TypeLayerRow`; Task 2 `loadDeviceTypeContext`, `setDeviceTypeIcons`; Task 3 `partLayerHidden`.
- Produces: `symbolContext(settings, types?: readonly DeviceType[] | null)`; `SymbolContext.categoryIconOverrides?` / `typeIcons?`; `SymbolEntry.deviceType?` / `deviceTypeLabel?`; `SymbolCategoryRow.deviceType?`; `typeLayerKey(scope: GridLayer, typeKey: string): string`; `isLayerVisible(scope, category, hidden, typeKey?)`; `saveDeviceTypeIconsAction(icons: Record<string, string | null>)`; `LayersPanel` prop `typeRows: Map<GridLayer, TypeLayerRow[]>`; `CategoryIconsCard` prop `used: string[]`.

- [ ] **Step 1: Write the failing tests** — append to the end of `scripts/test-review-and-spec.ts` (`dt226From`/`dt226WithIcons` are Task 1's imports):

```ts
/* ======================================================================
   #226 Grid device types — Task 4: icon order, legend labels, layers,
   Grid Settings cards, every drawing surface resolving types.
   ====================================================================== */
import { symbolContext as dt4Ctx, symbolLook as dt4Look, legendRows as dt4Legend, DEFAULT_SYMBOL_COLORS as DT4_COLORS } from "@/lib/design/grid-icons";
import { typeLayerKey as dt4LayerKey, isLayerVisible as dt4Visible } from "@/lib/design/grid-scopes";

{
  const ctx = dt4Ctx({ gridCategoryIcons: { Widgets: "wifi" } }, dt226WithIcons(dt226From(undefined), { speakers: "horn" }));
  ok(dt4Look({ category: "Widgets", deviceType: "speakers" }, ctx).iconId === "wifi", "#226 icons: a raw-category override beats the device-type icon");
  ok(dt4Look({ category: "Loudspeakers", deviceType: "speakers" }, ctx).iconId === "horn", "#226 icons: the device-type icon (admin-set) comes next");
  ok(dt4Look({ category: "Track", deviceType: "amplifiers" }, ctx).iconId === "amplifier", "#226 icons: a type's default icon beats the shipped per-category default");
  ok(dt4Look({ category: "Track" }, ctx).iconId === "track" && dt4Look({ category: "Nope", deviceType: null }, ctx).iconId === "device",
    "#226 icons: no type → the existing category defaults, then the generic glyph");
  ok(dt4Look({ category: "Loudspeakers", deviceType: "speakers", icon: "bell" }, ctx).iconId === "bell", "#226 icons: a per-entry icon still wins over everything");
  ok(dt4Look({ category: "X", deviceType: "speakers", gridScope: "Audio" }, ctx).color === DT4_COLORS.AV, "#226 colours: the #206 rules are unchanged (scope → AV)");
  ok(dt4Look({ category: "X", deviceType: "constructor" }, ctx).iconId === "device", "#226 icons: an inherited-prototype type key never resolves an icon");

  const rows = dt4Legend([
    { id: "a", category: "Loudspeakers", deviceType: "speakers", deviceTypeLabel: "Speakers", desc: "A" },
    { id: "g", category: "Speakers", deviceType: null, desc: "Speakers" },
    { id: "b", category: "Loudspeakers", deviceType: "speakers", deviceTypeLabel: "Speakers", desc: "B" },
    { id: "c", category: "Rack", deviceType: "racks-cases", deviceTypeLabel: "Racks & Cases", desc: "C" },
  ], ctx);
  ok(rows.map((r) => r.label).join("|") === "Speakers|Racks & Cases|Unmapped · Speakers",
    "#226 legend: rows are labelled by device type, Unmapped last with its raw/seeded category only as a sub-label");

  ok(dt4LayerKey("Audio", "speakers") === "type:Audio:speakers" && !dt4Visible("Audio", null, new Set(["type:Audio:speakers"]), "speakers")
      && dt4Visible("Audio", null, new Set(["type:Audio:amplifiers"]), "speakers") && dt4Visible("Audio", null, new Set(["type:Audio:speakers"])),
    "#226 layers: a device-type layer (namespaced by scope) hides its placements only");

  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const lp = read("src/app/(app)/design/grid/[id]/layers-panel.tsx");
  ok(lp.includes("typeLayerKey(s, t.key)") && lp.includes("typeRows"), "#226 layers: the Layers panel lists device types under each scope");
  const ed = read("src/app/(app)/design/grid/[id]/editor.tsx");
  ok(ed.includes("typeLayerRows(") && ed.includes("typeKeyOfPlacement") && ed.includes("typeRows={typeRows}") && ed.includes("deviceType: null"),
    "#226 layers: the editor groups placements by type and hides by type; partless legend entries are typed Unmapped");
  for (const d of ["riser", "set", "schedule"]) {
    const s = read(`src/app/(app)/design/grid/[id]/${d}/page.tsx`);
    ok(s.includes("loadDeviceTypeContext(catalog)") && s.includes("deviceTypes })"), `#226: the ${d} page resolves device types (scope fix + labels)`);
  }
  for (const d of ["riser", "set"]) {
    const s = read(`src/app/(app)/design/grid/[id]/${d}/page.tsx`);
    ok(s.includes("symbolContext(settings, deviceTypes.types)") && s.includes("deviceType: null"), `#226: the ${d} legend is grouped by device type`);
  }
  ok(read("src/app/(app)/design/grid/[id]/page.tsx").includes("symbolContext(settings, deviceTypes.types)"), "#226: the plan editor resolves type icons");
  const gs = read("src/app/(app)/design/grid/settings/page.tsx");
  ok(gs.includes("<DeviceTypeIconsCard") && gs.indexOf("<DeviceTypeIconsCard") < gs.indexOf("<CategoryIconsCard") && gs.includes("used={used}") && gs.includes("symbolContext(settings, deviceTypes.types)"),
    "#226 settings: icons are set per device type first; per-category icons follow");
  const cic = read("src/app/(app)/design/grid/settings/category-icons-card.tsx");
  ok(cic.includes("Advanced: per-category overrides") && cic.includes("useState(false)") && cic.includes("Show all"),
    "#226 settings: per-category icons are demoted to a collapsed Advanced section (overridden or used categories, with Show all)");
  for (const f of ["src/app/(app)/design/grid/settings/device-type-icons-card.tsx", "src/app/(app)/design/grid/[id]/layers-panel.tsx"]) {
    const s = read(f);
    const imps = [...s.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    ok(s.startsWith('"use client"') && imps.every((x) => !x.startsWith("@/lib/stores/") && !x.startsWith("@/db")), `#226: ${f} imports no store`);
  }
}

async function deviceTypeIconsAsyncChecks(): Promise<void> {
  const DT = await import("../src/lib/stores/device-types");
  const { getDb: getDb226b } = await import("../src/db");
  const { blobs: blobs226b } = await import("../src/db/doc-tables");
  const { eq } = await import("drizzle-orm");
  const db = await getDb226b();
  const snap = await db.select().from(blobs226b).where(eq(blobs226b.id, "gridDeviceTypes"));
  try {
    await db.delete(blobs226b).where(eq(blobs226b.id, "gridDeviceTypes"));
    const t1 = await DT.setDeviceTypeIcons({ speakers: "horn", "no-such": "bell" });
    const t2 = await DT.setDeviceTypeIcons({ speakers: null });
    ok(t1.find((t) => t.key === "speakers")?.icon === "horn" && !t1.some((t) => t.key === "no-such") && t2.find((t) => t.key === "speakers")?.icon === undefined,
      "#226 store: type icons set and clear per type; unknown keys are ignored");
  } finally {
    await db.delete(blobs226b).where(eq(blobs226b.id, "gridDeviceTypes"));
    for (const row of snap) await db.insert(blobs226b).values(row);
  }
}
```

Add to the async chain directly after `.then(() => deviceTypesAsyncChecks())`:

```ts
  .then(() => deviceTypeIconsAsyncChecks())
```

Update one existing #206 assertion (landmark `the Category icons card's row baseline is symbolLook over a stored-override-free context`): replace
`categoryIconsCardSrc.includes("symbolLook({ category, gridScope }, baseCtx)")` with
`categoryIconsCardSrc.includes("symbolLook({ category, gridScope, deviceType }, baseCtx)")`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: tsx aborts on the `symbolContext(…, types)` / `typeLayerKey` imports or on the missing `device-type-icons-card.tsx` (ENOENT).

- [ ] **Step 3: `src/lib/design/grid-scopes.ts` — type layer keys**

After `export function categoryLayerKey(category: string): string { … }` add:

```ts
/** #226: a device-type layer, namespaced by scope — "Unmapped" (and
 *  Assemblies) can sit under several scopes, and hiding it under Audio must
 *  not hide it under Lighting. */
export function typeLayerKey(scope: GridLayer, typeKey: string): string {
  return `type:${scope}:${typeKey}`;
}
```

Replace the whole `isLayerVisible` function with:

```ts
/**
 * Layer visibility for one item. The axes AND together: hiding a scope
 * hides everything in it whatever its type or category; hiding a device
 * type (#226) hides that type within its scope; hiding a category hides
 * that label across every scope. An item with no category is never
 * affected by a category toggle - categories are opt-in labels, not a
 * partition. `typeKey` is optional so pre-#226 callers are unchanged.
 */
export function isLayerVisible(
  scope: GridLayer,
  category: string | null,
  hidden: ReadonlySet<string>,
  typeKey?: string | null
): boolean {
  if (hidden.has(scopeLayerKey(scope))) return false;
  if (typeKey && hidden.has(typeLayerKey(scope, typeKey))) return false;
  if (category && hidden.has(categoryLayerKey(category))) return false;
  return true;
}
```

- [ ] **Step 4: `src/lib/design/grid-icons.ts` — type icons, icon order, legend labels**

a) Add to the imports:

```ts
import { deviceTypeIcons, UNMAPPED_LABEL, type DeviceType } from "./device-types";
```

b) Replace the `SymbolContext` type and the `symbolContext` function with:

```ts
/** Everything symbolLook needs, resolved once per request on the server and
 *  passed (plain JSON) to client components. */
export type SymbolContext = {
  categoryIcons: Record<string, string>;
  colors: Record<SymbolColorKey, string>;
  categoryMap: CategoryMap;
  /** RAW stored settings.gridCategoryShapes (never the old seed) — only an
   *  admin's explicit D154 choice is honoured as a fallback. */
  legacyCategoryShapes: Record<string, string> | null;
  /** #226: ONLY the admin's stored per-category icons (the "Advanced"
   *  overrides) — they beat the device-type icon; the shipped defaults in
   *  `categoryIcons` do not. */
  categoryIconOverrides?: Record<string, string>;
  /** #226: active device type key → icon id (own icon, else the default). */
  typeIcons?: Record<string, string>;
};

export function symbolContext(
  settings:
    | {
        gridCategoryIcons?: Record<string, string> | null;
        gridSymbolColors?: Record<string, string> | null;
        catalogCategoryMap?: CategoryMap;
        gridCategoryShapes?: Record<string, string> | null;
      }
    | null
    | undefined,
  types?: readonly DeviceType[] | null
): SymbolContext {
  const typeIcons: Record<string, string> = {};
  for (const [k, v] of Object.entries(deviceTypeIcons(types ?? []))) if (isGridIconId(v)) typeIcons[k] = v;
  return {
    categoryIcons: resolveCategoryIcons(settings?.gridCategoryIcons),
    colors: resolveSymbolColors(settings?.gridSymbolColors),
    categoryMap: resolveCategoryMap(settings?.catalogCategoryMap),
    legacyCategoryShapes: settings?.gridCategoryShapes ?? null,
    categoryIconOverrides: cleanCategoryIcons(settings?.gridCategoryIcons) ?? {},
    typeIcons,
  };
}
```

c) In `SymbolEntry`, after `gridScope?: string | null;` add:

```ts
  /** #226: the part's device type (null = unmapped; absent = the caller
   *  resolved no types) and its label. */
  deviceType?: string | null;
  deviceTypeLabel?: string | null;
```

d) In `symbolLook`, replace the `else { const cat = lookup(ctx.categoryIcons, e.category); … }` branch of the icon resolution with:

```ts
  else {
    // #226 order: stored raw-category override → device-type icon → shipped
    // category default → stored legacy category shape → generic.
    const override = lookup(ctx.categoryIconOverrides, e.category);
    const typeIcon =
      e.deviceType && ctx.typeIcons && Object.hasOwn(ctx.typeIcons, e.deviceType) ? ctx.typeIcons[e.deviceType] : undefined;
    const cat = lookup(ctx.categoryIcons, e.category);
    if (isGridIconId(override)) iconId = override;
    else if (isGridIconId(typeIcon)) iconId = typeIcon;
    else if (isGridIconId(cat)) iconId = cat;
    else if (isGridShape(legacyCat)) iconId = LEGACY_SHAPE_ICON[legacyCat];
    else iconId = GENERIC_ICON_ID;
  }
```

Also update the file header comment's "Icon:" line to: `Icon:   entry.icon → entry.shape (legacy alias) → stored category override → device type icon (#226) → category default → stored settings.gridCategoryShapes[category] (legacy alias) → "device".`

e) Replace the whole `legendRows` function (keep its doc comment, adding the #226 sentence) with:

```ts
/** One row per distinct icon+colour actually drawn, first-seen order. An
 *  entry whose look differs from its default is labelled "<label> — <desc>"
 *  (the #131 riser rule). #226: an entry that carries `deviceType` (every
 *  Grid surface now) is labelled by its device type; an unmapped one reads
 *  "Unmapped · <raw category>" and those rows go last. Entries without the
 *  field keep the old per-category label. A real plan repeats the same part
 *  dozens of times, so `symbolLook` is resolved once per DISTINCT entry
 *  (keyed by `id` when a caller has one, e.g. a PartLite — otherwise by its
 *  symbol-relevant fields) and reused for every repeat (final fix wave). */
export function legendRows(
  entries: Array<SymbolEntry & { id?: string | null; desc?: string | null }>,
  ctx: SymbolContext
): LegendRow[] {
  const rows: LegendRow[] = [];
  const unmapped: LegendRow[] = [];
  const seenBadges = new Set<string>();
  const lookCache = new Map<string, SymbolLook>();
  for (const e of entries) {
    const identity =
      e.id ??
      `${e.category ?? ""}|${e.icon ?? ""}|${e.color ?? ""}|${e.shape ?? ""}|${e.group ?? ""}|${e.trade ?? ""}|${e.gridScope ?? ""}|${e.deviceType ?? ""}`;
    let look = lookCache.get(identity);
    if (!look) {
      look = symbolLook(e, ctx);
      lookCache.set(identity, look);
    }
    const key = `${look.iconId}|${look.color}`;
    if (seenBadges.has(key)) continue;
    seenBadges.add(key);
    const category = (e.category || "").trim();
    const typed = e.deviceType !== undefined;
    const isUnmapped = typed && !e.deviceType;
    const head = !typed
      ? category || "Uncategorized"
      : e.deviceType
        ? e.deviceTypeLabel || e.deviceType
        : category
          ? `${UNMAPPED_LABEL} · ${category}`
          : UNMAPPED_LABEL;
    const base = symbolLook({ category: e.category, group: e.group, trade: e.trade, gridScope: e.gridScope, deviceType: e.deviceType }, ctx);
    const differs = base.iconId !== look.iconId || base.color !== look.color;
    (isUnmapped ? unmapped : rows).push({ key, iconId: look.iconId, color: look.color, label: differs && e.desc ? `${head} — ${e.desc}` : head });
  }
  return [...rows, ...unmapped];
}
```

f) Change `export type SymbolCategoryRow = { category: string; gridScope: string | null };` to:

```ts
export type SymbolCategoryRow = { category: string; gridScope: string | null; deviceType?: string | null };
```

- [ ] **Step 5: Replace `src/app/(app)/design/grid/[id]/layers-panel.tsx`**

```tsx
"use client";

import { GRID_LAYERS, categoryLayerKey, scopeLayerKey, typeLayerKey, type GridLayer } from "@/lib/design/grid-scopes";
import type { TypeLayerRow } from "@/lib/design/device-types";

/**
 * Layer visibility (punch #48) - the actual ask behind Jeff's "if we don't
 * allow different filters then it is going to get busy quick": these toggles
 * show and hide what is ALREADY PLACED on the plan, per scope, per device
 * type within a scope (#226 — never per raw catalog category: an unmapped
 * item's raw/seeded category is only a sub-label on the Unmapped row), and
 * per user-defined category.
 *
 * Deliberately NOT the palette filter. The palette filter answers "what can I
 * arm"; this answers "what do I want to look at". Turning a layer off never
 * disarms a part, and arming a part never turns a layer on - the two controls
 * share the taxonomy and nothing else. Visibility is a view state and is not
 * persisted: it is how one person is reading the drawing right now, not a
 * property of the design.
 */

const BTN: React.CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  background: "#fff",
  borderRadius: 7,
  padding: "5px 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "#3d424e",
  cursor: "pointer",
  fontFamily: "inherit",
};

export type LayerCount = { key: string; count: number };

function Row({
  label,
  sub,
  count,
  hidden,
  swatch,
  indent = false,
  onToggle,
}: {
  label: string;
  sub?: string;
  count: number;
  hidden: boolean;
  swatch?: string;
  indent?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      title={hidden ? `Show ${label}` : `Hide ${label}`}
      style={{
        ...BTN,
        display: "flex",
        alignItems: "center",
        gap: 7,
        fontWeight: 500,
        padding: indent ? "3px 8px" : "4px 8px",
        marginLeft: indent ? 14 : 0,
        fontSize: indent ? 11.5 : 12,
        opacity: hidden ? 0.5 : 1,
        background: hidden ? "#f5f6f8" : "#fff",
      }}
    >
      <span
        aria-hidden
        style={{
          width: indent ? 9 : 11, height: indent ? 9 : 11, borderRadius: 3, flex: "0 0 auto",
          background: hidden ? "transparent" : swatch || "#5b616e",
          borderWidth: 1, borderStyle: "solid", borderColor: swatch || "#5b616e",
        }}
      />
      <span
        style={{
          flex: 1, textAlign: "left", whiteSpace: "nowrap",
          overflow: "hidden", textOverflow: "ellipsis",
          textDecoration: hidden ? "line-through" : "none",
        }}
      >
        {label}
        {sub && <span style={{ color: "#9aa0ab" }}> · {sub}</span>}
      </span>
      <span style={{ fontSize: 11, color: "#8c919c" }}>{count}</span>
    </button>
  );
}

export default function LayersPanel({
  scopeCounts,
  typeRows,
  categoryCounts,
  hidden,
  scopeColor,
  onToggle,
  onShowAll,
}: {
  /** Placed-item count per scope, whole project. */
  scopeCounts: Map<GridLayer, number>;
  /** #226: per scope, placed-item count per device type (Unmapped last). */
  typeRows: Map<GridLayer, TypeLayerRow[]>;
  /** Placed-item count per user-defined category, whole project. */
  categoryCounts: LayerCount[];
  hidden: ReadonlySet<string>;
  scopeColor: (scope: GridLayer) => string;
  onToggle: (key: string) => void;
  onShowAll: () => void;
}) {
  const anyHidden = hidden.size > 0;
  const scopes = GRID_LAYERS.filter((s) => (scopeCounts.get(s) || 0) > 0);

  return (
    <div style={{ background: "#fff", border: "1px solid #edeff3", borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 7 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#9aa0ab" }}>
          Layers
        </div>
        <span style={{ flex: 1 }} />
        {anyHidden && (
          <button
            onClick={onShowAll}
            style={{ ...BTN, padding: "1px 7px", fontSize: 10.5, borderColor: "transparent", color: "var(--accent)" }}
          >
            Show all
          </button>
        )}
      </div>

      {scopes.length === 0 && categoryCounts.length === 0 ? (
        <div style={{ fontSize: 11, color: "#8c919c" }}>
          Place something and its scope shows up here to hide or show.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 3 }}>
          {scopes.map((s) => (
            <div key={s} style={{ display: "grid", gap: 3 }}>
              <Row
                label={s}
                count={scopeCounts.get(s) || 0}
                hidden={hidden.has(scopeLayerKey(s))}
                swatch={scopeColor(s)}
                onToggle={() => onToggle(scopeLayerKey(s))}
              />
              {(typeRows.get(s) || []).map((t) => (
                <Row
                  key={t.key}
                  indent
                  label={t.label}
                  sub={t.subs.length ? t.subs.join(", ") : undefined}
                  count={t.count}
                  hidden={hidden.has(typeLayerKey(s, t.key))}
                  swatch={scopeColor(s)}
                  onToggle={() => onToggle(typeLayerKey(s, t.key))}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {categoryCounts.length > 0 && (
        <div style={{ marginTop: 9, borderTop: "1px solid #edeff3", paddingTop: 8, display: "grid", gap: 3 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab" }}>
            Your categories
          </div>
          {categoryCounts.map((c) => (
            <Row
              key={c.key}
              label={c.key}
              count={c.count}
              hidden={hidden.has(categoryLayerKey(c.key))}
              swatch="#8a6d3b"
              onToggle={() => onToggle(categoryLayerKey(c.key))}
            />
          ))}
        </div>
      )}

      <div style={{ fontSize: 10.5, color: "#9aa0ab", marginTop: 7, lineHeight: 1.45 }}>
        Hiding a layer only hides it on the plan: a hidden marker can&apos;t be
        clicked or dragged, and nothing leaves the BOM.
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Editor — type layers, type-aware hiding, typed legend entries**

In `src/app/(app)/design/grid/[id]/editor.tsx`:

a) In the `@/lib/design/grid-scopes` import add `typeLayerKey,`. Replace Task 3's `import type { DeviceType } from "@/lib/design/device-types";` with:

```ts
import { typeKeyOfPart, typeLayerRows, UNMAPPED_TYPE, type DeviceType } from "@/lib/design/device-types";
```

b) Directly after the `scopeOfPlacement` `useCallback` (landmark `pl.curtain ? "Curtains" : scopeOfPart(partById.get(pl.partId)),`), add:

```ts
  /** #226: the device-type layer a placement belongs to — a curtain drop-in
   *  is Drapery by construction, the way its scope is Curtains. */
  const typeKeyOfPlacement = useCallback(
    (pl: GridPlacement): string => (pl.curtain ? "drapery" : typeKeyOfPart(partById.get(pl.partId))),
    [partById]
  );
```

c) Replace the `placementVisible` `useCallback` with:

```ts
  const placementVisible = useCallback(
    (pl: GridPlacement) =>
      isLayerVisible(scopeOfPlacement(pl), normalizeCategory(pl.category), hiddenSet, typeKeyOfPlacement(pl)),
    [scopeOfPlacement, hiddenSet, typeKeyOfPlacement]
  );
```

d) Directly after the `scopeCounts` `useMemo` (landmark `}, [placements, routes, scopeOfPlacement, partById]);`), add:

```ts
  /** #226: Layers groups each scope's items by device type (Unmapped last;
   *  an unmapped item's raw/seeded category rides along as a sub-label, never
   *  as a layer of its own). Same items as scopeCounts, so the numbers agree. */
  const typeRows = useMemo(() => {
    const items: Array<{ scope: GridLayer; typeKey: string; sub: string | null }> = [];
    for (const pl of placements) {
      const typeKey = typeKeyOfPlacement(pl);
      const part = partById.get(pl.partId);
      items.push({ scope: scopeOfPlacement(pl), typeKey, sub: typeKey === UNMAPPED_TYPE ? part?.category ?? pl.category ?? null : null });
    }
    for (const r of routes || []) {
      const part = partById.get(r.partId);
      const typeKey = typeKeyOfPart(part);
      items.push({ scope: scopeOfPart(part), typeKey, sub: typeKey === UNMAPPED_TYPE ? part?.category ?? null : null });
    }
    return typeLayerRows(items, deviceTypes);
  }, [placements, routes, partById, scopeOfPlacement, typeKeyOfPlacement, deviceTypes]);
```

e) In `planLegendRows`, replace `if (!distinct.has(key)) distinct.set(key, part ?? { category: pl.category });` with:

```ts
      if (!distinct.has(key)) distinct.set(key, part ?? { category: pl.category, deviceType: null });
```

f) Replace the `visibleRoutes` `useMemo` body's filter (landmark `(r) => !hiddenSet.has(scopeLayerKey(scopeOfPart(partById.get(r.partId))))`) with:

```ts
      pageRoutes.filter((r) => {
        const part = partById.get(r.partId);
        const s = scopeOfPart(part);
        return !hiddenSet.has(scopeLayerKey(s)) && !hiddenSet.has(typeLayerKey(s, typeKeyOfPart(part)));
      }),
```

g) Replace Task 3's `partLayerHidden` with:

```ts
  /** The palette's "that layer is hidden" warning — scope or type layer. */
  const partLayerHidden = useCallback(
    (p: PartLite) => {
      const s = scopeOfPart(p);
      return hiddenSet.has(scopeLayerKey(s)) || hiddenSet.has(typeLayerKey(s, typeKeyOfPart(p)));
    },
    [hiddenSet]
  );
```

h) In `<LayersPanel`, after `scopeCounts={scopeCounts}` add `typeRows={typeRows}`.

- [ ] **Step 7: Resolve types on every drawing surface**

`src/app/(app)/design/grid/[id]/page.tsx`: replace `symbolCtx={symbolContext(settings)}` with `symbolCtx={symbolContext(settings, deviceTypes.types)}`.

`src/app/(app)/design/grid/[id]/riser/page.tsx`: add `import { loadDeviceTypeContext } from "@/lib/stores/device-types";`. Directly after the `const [sheets, catalog, gridSymbols, settings] = await Promise.all(…)` line add:

```ts
  // #226: device types — the scope fix and type-grouped legend labels.
  const deviceTypes = await loadDeviceTypeContext(catalog);
```

Replace `const symCtx = symbolContext(settings);` with `const symCtx = symbolContext(settings, deviceTypes.types);`, `const library = gridPartsFrom(gridSymbols, catalog, categoryMap);` with `const library = gridPartsFrom(gridSymbols, catalog, categoryMap, { deviceTypes });`, and `...gridPartsFrom(gridSymbols, catalog, categoryMap, { catalogFallback: true }),` with `...gridPartsFrom(gridSymbols, catalog, categoryMap, { catalogFallback: true, deviceTypes }),`. In the legend fallback, replace `|| { category: pl.category || "", desc: pl.category || pl.partId })` with `|| { category: pl.category || "", desc: pl.category || pl.partId, deviceType: null })`.

`src/app/(app)/design/grid/[id]/set/page.tsx`: add the same import and the same `const deviceTypes = await loadDeviceTypeContext(catalog);` after its `Promise.all` line. Replace `const symCtx = symbolContext(settings);` with `const symCtx = symbolContext(settings, deviceTypes.types);` and `...gridPartsFrom(gridSymbols, catalog, resolveCategoryMap(settings.catalogCategoryMap), { catalogFallback: true }),` with `...gridPartsFrom(gridSymbols, catalog, resolveCategoryMap(settings.catalogCategoryMap), { catalogFallback: true, deviceTypes }),`. In the legend fallback, add `deviceType: null` exactly as in the riser.

`src/app/(app)/design/grid/[id]/schedule/page.tsx`: add the import. After `const [catalog, gridSymbols, settings] = await Promise.all([listCatalog(), listGridSymbols(), getSettings()]);` add `const deviceTypes = await loadDeviceTypeContext(catalog);`, and change its `gridPartsFrom(…, { catalogFallback: true })` to `gridPartsFrom(…, { catalogFallback: true, deviceTypes })`.

- [ ] **Step 8: Grid Settings — the type icons card and its action**

`src/app/(app)/design/grid/settings/actions.ts`: change `import { cleanCategoryIcons, cleanSymbolColors } from "@/lib/design/grid-icons";` to `import { cleanCategoryIcons, cleanSymbolColors, isGridIconId } from "@/lib/design/grid-icons";`, add `import { setDeviceTypeIcons } from "@/lib/stores/device-types";`, and after `saveCategoryIconsAction` add:

```ts
/** #226: Device type icons — one glyph per device type. `null` = that
 *  type's shipped default; an unknown icon id also falls back to null.
 *  Unknown type keys are ignored by withTypeIcons. */
export async function saveDeviceTypeIconsAction(icons: Record<string, string | null>) {
  await requirePerm("manage_users");
  const clean: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(icons || {})) {
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(k)) continue;
    clean[k] = typeof v === "string" && isGridIconId(v) ? v : null;
  }
  await setDeviceTypeIcons(clean);
  revalidatePath("/", "layout");
}
```

Create `src/app/(app)/design/grid/settings/device-type-icons-card.tsx`:

```tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GENERIC_ICON_ID, symbolLook, type SymbolContext } from "@/lib/design/grid-icons";
import { DEFAULT_TYPE_ICONS, type DeviceType } from "@/lib/design/device-types";
import { SymbolIcon } from "@/components/design/symbol-shape";
import { IconPicker } from "@/components/design/icon-picker";
import { saveDeviceTypeIconsAction } from "./actions";

/**
 * "Device type icons" (#226, spec §Screens 3) — the primary icon editor:
 * one row per active device type (~25) instead of one per raw catalog
 * category. Preview colour is what the plan draws for that type (#206
 * colour rules, via its scope). Only types whose icon differs from the
 * shipped default are stored; ↺ returns a row to the default.
 */

const defaultFor = (key: string) => (Object.hasOwn(DEFAULT_TYPE_ICONS, key) ? DEFAULT_TYPE_ICONS[key] : GENERIC_ICON_ID);

export function DeviceTypeIconsCard({ types, ctx }: { types: DeviceType[]; ctx: SymbolContext }) {
  const router = useRouter();
  const saved = useMemo(() => {
    const out: Record<string, string> = {};
    for (const t of types) if (t.icon && t.icon !== defaultFor(t.key)) out[t.key] = t.icon;
    return out;
  }, [types]);
  const [icons, setIcons] = useState<Record<string, string>>(saved);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const dirty = JSON.stringify(icons) !== JSON.stringify(saved);
  const canSave = dirty && !pending;

  const setRow = (key: string, iconId: string | null) => {
    setJustSaved(false);
    setError(null);
    setIcons((m) => {
      const next = { ...m };
      if (!iconId || iconId === defaultFor(key)) delete next[key];
      else next[key] = iconId;
      return next;
    });
  };
  const save = () => {
    const payload: Record<string, string | null> = {};
    for (const t of types) payload[t.key] = Object.hasOwn(icons, t.key) ? icons[t.key] : null;
    setError(null);
    startTransition(async () => {
      try {
        await saveDeviceTypeIconsAction(payload);
        setJustSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed — please try again.");
      }
    });
  };

  return (
    <div className="pk-card" style={{ overflow: "visible", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", rowGap: 10, padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>Device type icons</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".06em", color: "#8a6d1f", background: "#fbf3dd", border: "1px solid #f0e2bd", padding: "3px 9px", borderRadius: 6 }}>
              ADMIN
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
            The glyph The Grid draws for each device type, on the plan, the riser and the legends. A per-category override
            (Advanced, below) or an icon set on a single Grid entry wins.
          </div>
        </div>
        <button
          type="button"
          disabled={!canSave}
          onClick={save}
          style={{ fontSize: 13, fontWeight: 600, border: "none", borderRadius: 9, padding: "9px 16px", cursor: canSave ? "pointer" : "not-allowed", color: canSave ? "#fff" : "#aab0bb", background: canSave ? "var(--accent)" : "#eef0f3", whiteSpace: "nowrap" }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {error && (
        <div style={{ margin: "12px 18px 0", fontSize: 12, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "9px 12px" }}>{error}</div>
      )}
      {justSaved && !dirty && <div style={{ margin: "12px 18px 0", fontSize: 11.5, color: "#1f7a52", fontWeight: 600 }}>✓ Saved</div>}
      <div style={{ padding: "12px 18px 16px" }}>
        {types.map((t) => {
          const custom = Object.hasOwn(icons, t.key);
          const iconId = custom ? icons[t.key] : defaultFor(t.key);
          const color = symbolLook({ deviceType: t.key, gridScope: t.scope }, ctx).color;
          return (
            <div key={t.key} style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) auto 30px", gap: 9, alignItems: "center", marginBottom: 7 }}>
              <SymbolIcon iconId={iconId} color={color} size={20} />
              <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.label}
                <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 500, color: "#9aa0ab" }}>{t.scope === "Unscoped" ? "General" : t.scope}</span>
                {custom && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: "#8a6d1f" }}>custom</span>}
              </span>
              <IconPicker value={iconId} color={color} label={`Icon for ${t.label}`} onChange={(id) => setRow(t.key, id)} />
              <button
                type="button"
                onClick={() => setRow(t.key, null)}
                disabled={!custom}
                title="Back to the shipped default"
                aria-label={`Reset ${t.label} to its default icon`}
                style={{ width: 30, height: 30, border: "1px solid #e4e7ec", background: "#fff", borderRadius: 8, color: custom ? "#5b616e" : "#d5d9e0", fontSize: 14, cursor: custom ? "pointer" : "default" }}
              >
                ↺
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Demote per-category icons to "Advanced" — replace `src/app/(app)/design/grid/settings/category-icons-card.tsx`**

```tsx
"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveCategoryIcons, symbolLook, type SymbolCategoryRow, type SymbolContext } from "@/lib/design/grid-icons";
import { SymbolIcon } from "@/components/design/symbol-shape";
import { IconPicker } from "@/components/design/icon-picker";
import { saveCategoryIconsAction } from "./actions";

/**
 * "Advanced: per-category overrides" (#226; was the "Category icons" card,
 * stock symbols spec 2026-09-25 §2). Device type icons are the primary
 * editor now; a stored per-raw-category icon still WINS over its type's
 * icon, so every override an admin already configured keeps working.
 * Collapsed by default, and it lists only categories that have an override
 * or are used in a Grid design ("Show all" lists every live category).
 * Sparse save: only rows that differ from their baseline are posted
 * (settings.gridCategoryIcons merges per category). "Reset to defaults"
 * clears the key; ↺ on a row returns just that row.
 *
 * A row's baseline — what ↺ returns to and what an untouched row previews —
 * is computed with the SAME resolver the plan uses (`symbolLook` over
 * `{category, gridScope, deviceType}`), against a context with every stored
 * override removed, so it shows the device-type icon the plan would draw
 * (final fix wave #2 rule, extended by #226).
 */

const norm = (s: string) => s.trim().toLowerCase();

export function CategoryIconsCard({
  rows,
  stored,
  ctx,
  used,
}: {
  rows: SymbolCategoryRow[];
  stored: Record<string, string> | null;
  ctx: SymbolContext;
  /** Raw categories placed in any Grid design. */
  used: string[];
}) {
  const router = useRouter();
  const baseCtx = useMemo<SymbolContext>(() => ({ ...ctx, categoryIcons: resolveCategoryIcons(null), categoryIconOverrides: {} }), [ctx]);
  const baseIconFor = useCallback(
    (category: string, gridScope: string | null, deviceType: string | null) => symbolLook({ category, gridScope, deviceType }, baseCtx).iconId,
    [baseCtx]
  );
  const rowByCategory = useMemo(() => new Map(rows.map((r) => [r.category, r])), [rows]);
  const usedSet = useMemo(() => new Set(used.map(norm)), [used]);

  const saved = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(stored || {})) {
      const row = rows.find((r) => norm(r.category) === norm(k));
      if (row && v !== baseIconFor(row.category, row.gridScope, row.deviceType ?? null)) out[row.category] = v;
    }
    return out;
  }, [rows, stored, baseIconFor]);
  const [overrides, setOverrides] = useState<Record<string, string>>(saved);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = JSON.stringify(overrides) !== JSON.stringify(saved);
  const canSave = dirty && !pending;
  const relevant = rows.filter((r) => showAll || Object.hasOwn(overrides, r.category) || Object.hasOwn(saved, r.category) || usedSet.has(norm(r.category)));
  const shown = relevant.filter((r) => !filter.trim() || norm(r.category).includes(norm(filter)));

  const setRow = (category: string, iconId: string | null) => {
    setJustSaved(false);
    setError(null);
    setOverrides((o) => {
      const next = { ...o };
      const row = rowByCategory.get(category);
      if (!iconId || iconId === baseIconFor(category, row?.gridScope ?? null, row?.deviceType ?? null)) delete next[category];
      else next[category] = iconId;
      return next;
    });
  };

  const save = (map: Record<string, string>) => {
    setError(null);
    startTransition(async () => {
      try {
        await saveCategoryIconsAction(map);
        setOverrides(map);
        setJustSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed — please try again.");
      }
    });
  };

  return (
    <div className="pk-card" style={{ overflow: "visible", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", rowGap: 10, padding: "14px 18px", borderBottom: open ? "1px solid #ececf0" : "none" }}>
        <div style={{ minWidth: 0 }}>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            style={{ display: "flex", alignItems: "center", gap: 9, background: "transparent", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", color: "inherit" }}
          >
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>Advanced: per-category overrides</span>
            <span style={{ fontSize: 12, color: "#8c919c" }}>
              {open ? "▾" : "▸"} {Object.keys(saved).length} set
            </span>
          </button>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
            A raw catalog category&apos;s own glyph, which beats its device type&apos;s icon. Most categories never need one.
          </div>
        </div>
        {open && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <button type="button" disabled={pending} onClick={() => save({})} style={{ fontSize: 12, fontWeight: 600, color: "#5b616e", background: "transparent", border: "none", cursor: "pointer" }}>
              Reset to defaults
            </button>
            <button
              type="button"
              disabled={!canSave}
              onClick={() => save(overrides)}
              style={{ fontSize: 13, fontWeight: 600, border: "none", borderRadius: 9, padding: "9px 16px", cursor: canSave ? "pointer" : "not-allowed", color: canSave ? "#fff" : "#aab0bb", background: canSave ? "var(--accent)" : "#eef0f3", whiteSpace: "nowrap" }}
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </div>
      {open && error && (
        <div style={{ margin: "12px 18px 0", fontSize: 12, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "9px 12px" }}>{error}</div>
      )}
      {open && justSaved && !dirty && <div style={{ margin: "12px 18px 0", fontSize: 11.5, color: "#1f7a52", fontWeight: 600 }}>✓ Saved</div>}
      {open && (
        <div style={{ padding: "12px 18px 16px" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Filter ${relevant.length} categories`}
              aria-label="Filter categories"
              style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, border: "1px solid #e4e7ec", borderRadius: 8, padding: "7px 10px", width: "100%", maxWidth: 320, outline: "none" }}
            />
            <label style={{ fontSize: 12, color: "#5b616e", display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show all {rows.length} categories
            </label>
          </div>
          {shown.map((r) => {
            const hasOverride = Object.hasOwn(overrides, r.category);
            const iconId = hasOverride ? overrides[r.category] : baseIconFor(r.category, r.gridScope, r.deviceType ?? null);
            const color = symbolLook({ category: r.category, gridScope: r.gridScope, deviceType: r.deviceType ?? null }, ctx).color;
            return (
              <div key={r.category} style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) auto 30px", gap: 9, alignItems: "center", marginBottom: 7 }}>
                <SymbolIcon iconId={iconId} color={color} size={20} />
                <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.category}
                  {hasOverride && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: "#8a6d1f" }}>custom</span>}
                </span>
                <IconPicker value={iconId} color={color} label={`Icon for ${r.category}`} onChange={(id) => setRow(r.category, id)} />
                <button
                  type="button"
                  onClick={() => setRow(r.category, null)}
                  disabled={!hasOverride}
                  title="Back to the device type's icon"
                  aria-label={`Reset ${r.category} to its default icon`}
                  style={{ width: 30, height: 30, border: "1px solid #e4e7ec", background: "#fff", borderRadius: 8, color: hasOverride ? "#5b616e" : "#d5d9e0", fontSize: 14, cursor: hasOverride ? "pointer" : "default" }}
                >
                  ↺
                </button>
              </div>
            );
          })}
          {shown.length === 0 && (
            <div style={{ padding: "12px 0", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
              {filter.trim() ? `No category matches “${filter}”.` : "No overrides yet, and no Grid design uses a category — tick Show all to add one."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 10: Grid Settings page — types, `used`, both cards**

In `src/app/(app)/design/grid/settings/page.tsx`:

Add imports:

```ts
import { listProjects } from "@/lib/stores/grid-projects";
import { loadDeviceTypeContext } from "@/lib/stores/device-types";
import { typeOfCategory } from "@/lib/design/device-types";
import { DeviceTypeIconsCard } from "./device-type-icons-card";
```

Replace the block from `const symCtx = symbolContext(settings);` through the end of the `const categoryRows = symbolCategoryRows({ … });` statement with:

```ts
  // #226: device types drive the icons; the per-category card is now the
  // Advanced override list (overridden or used-in-a-design categories).
  const [deviceTypes, projects] = await Promise.all([loadDeviceTypeContext(catalog), listProjects()]);
  const symCtx = symbolContext(settings, deviceTypes.types);
  const categoryRows = symbolCategoryRows({
    catalogCategories: Array.from(new Set(catalog.map((p) => p.category || ""))),
    grid: gridSymbols.map((s) => ({ category: s.category || "Other", scope: s.scope })),
    stored: settings.gridCategoryIcons ?? null,
    taxonomy: Object.keys(DEFAULT_CATEGORY_MAP),
  }).map((r) => ({ ...r, deviceType: typeOfCategory(r.category, deviceTypes.map, deviceTypes.types) }));
  const symById = new Map(gridSymbols.map((s) => [s.id, s]));
  const partById = new Map(catalog.map((p) => [p.id, p]));
  const usedSet = new Set<string>();
  for (const pr of projects) {
    for (const pl of pr.placements || []) {
      const sym = symById.get(pl.partId);
      const pricing = sym?.pricingPartId ? partById.get(sym.pricingPartId) : partById.get(pl.partId);
      const c = pricing?.category || sym?.category || pl.category;
      if (c) usedSet.add(c);
    }
  }
  const used = [...usedSet];
```

Replace the `<CategoryIconsCard … />` element with:

```tsx
      <DeviceTypeIconsCard
        key={JSON.stringify(deviceTypes.types.map((t) => [t.key, t.icon ?? null]))}
        types={deviceTypes.types.filter((t) => !t.archived)}
        ctx={symCtx}
      />

      <CategoryIconsCard
        key={JSON.stringify(settings.gridCategoryIcons ?? null) + "::" + categoryRows.length}
        rows={categoryRows}
        stored={settings.gridCategoryIcons ?? null}
        ctx={symCtx}
        used={used}
      />
```

Also update the page's header description to: `Symbol colours, device-type icons, port rules, wire types, and install labor — the settings specific to The Grid.`

- [ ] **Step 11: Run the gates**

```bash
npx tsc --noEmit
npm run test:specs 2>&1 | tee /tmp/claude-226-t4.txt | tail -3; grep -c '^PASS ' /tmp/claude-226-t4.txt; grep '^FAIL' /tmp/claude-226-t4.txt
npx eslint src/lib/design/grid-icons.ts src/lib/design/grid-scopes.ts "src/app/(app)/design/grid/[id]/layers-panel.tsx" "src/app/(app)/design/grid/[id]/editor.tsx" "src/app/(app)/design/grid/[id]/page.tsx" "src/app/(app)/design/grid/[id]/riser/page.tsx" "src/app/(app)/design/grid/[id]/set/page.tsx" "src/app/(app)/design/grid/[id]/schedule/page.tsx" "src/app/(app)/design/grid/settings/" scripts/test-review-and-spec.ts
npx next build 2>&1 | tail -15
```
Expected: 0 tsc errors; `ALL PASSED` with every existing `#206`/`#48`/`#209` assertion still passing; eslint 0 errors; build succeeds.

- [ ] **Step 12: Commit**

```bash
git add src/lib/design/grid-icons.ts src/lib/design/grid-scopes.ts "src/app/(app)/design/grid/[id]/layers-panel.tsx" "src/app/(app)/design/grid/[id]/editor.tsx" "src/app/(app)/design/grid/[id]/page.tsx" "src/app/(app)/design/grid/[id]/riser/page.tsx" "src/app/(app)/design/grid/[id]/set/page.tsx" "src/app/(app)/design/grid/[id]/schedule/page.tsx" "src/app/(app)/design/grid/settings" scripts/test-review-and-spec.ts
git commit -m "$(printf 'feat(grid): per-type icons, Advanced category overrides, layers and legends by device type (#226)\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

## Spec coverage check

| Spec item | Task |
|---|---|
| `gridDeviceTypes` seeded list, slug keys, archive, icon | 1 (model), 2 (store/screen) |
| `gridTypeMap` `{ typeKey, by, at }`, normalized keys | 1, 2 |
| Auto-apply on read (high only), admin never overwritten, idempotent, review "auto" chip, Accept-all includes low | 1 (`autoTypeEntries`, `acceptSuggestionEntries`), 2 (`loadDeviceTypeContext` + `setBlobKeysIfAbsent`, async tests, client chip) |
| `suggestDeviceType` keyword rules, ≥ 40 realistic strings incl. per-brand defaults, "Uncategorized" → null | 1 (85 cases) |
| `typeOfPart`, `scopeOfType`, unmapped → Unscoped; `scopeFor` fallback fix for every surface | 1 (+ `gridPartsFrom`), 4 (riser/set/schedule wiring) |
| Catalog → Device types: list (rename/add/reorder/archive/merge), mapping table w/ counts, suggestion + confidence, current type, unmapped first, bulk accept, select → assign; "Estimating groups & trades" kept | 2 |
| Palette: tabs, scope → type chips w/ counts, manufacturer select, search, hide unmapped + admin link, Unmapped chip on search, cap 60 | 3 |
| Favorites per user (cap 300, star toggle); Recent per user (40, any design, updated by placement) | 1 (rules), 2 (store + tests), 3 (UI + actions) |
| Grid Settings: per-type icons; per-category as collapsed Advanced (overridden or used, show all); resolution order; colours unchanged | 4 |
| Layers + plan legend by device type, Unmapped last, seeded category as sub-label only | 1 (`typeLayerRows`), 4 |
| "No Grid surface lists raw categories as top-level entries" | 4 (legend/layers/settings source checks) |

## Risks

- **Auto-apply writes on a GET render** (the Grid pages, Grid Settings and Device types). Writes are gap-fill only, atomic and idempotent. They are skipped on Vercel previews, which share production's Neon DB. A wrong auto-match is visible but it does apply without a click. The "auto" filter on the review screen is how the admin spot-checks it.
- **Keyword rules decide real mappings.** "Track" maps to Tracks & Hardware (Curtains), while `DEFAULT_CATEGORY_MAP` treats "Track" as rigging trade. Bare "Hardware" and "Mounts" map to Rigging Hardware. Jeff should skim the Auto list after the first production visit.
- **The editor and the harness are shared with other in-flight tasks.** Every step names a text landmark. Expect conflicts at the async chain and the end of the harness. Resolve them keep-both (memory: spec-harness keep-both merges).
- **The `#206` harness block depends on literals** that this plan changes: the `symbolLook({ category, gridScope, deviceType }, baseCtx)` card baseline, the `gridPartsFrom(…deviceTypes })` page call, and `!p.virtual`, which moved to `grid-palette.ts`. Each one is updated in the same task that changes it.
