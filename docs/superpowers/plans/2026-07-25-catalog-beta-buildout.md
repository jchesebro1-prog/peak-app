# Catalog Beta Build-Out Implementation Plan (punch #39, wave 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give beta testers a real multi-manufacturer catalog across six categories with trade rollups, device connection/wire-type metadata that gates Grid wiring, catalog-anchored datasheet attachments, and a six-bucket Grid palette — with the starter-set item list drafted for Jeff's review before any import.

**Architecture:** Task 0 recon (2026-07-25) found `CatalogPart.category` already exists as a load-bearing free-text field (~40 granular values across 10,702 imported parts; `Fabric`/`Labor` are semantic). So the six beta categories are a NEW grouping layer resolved through an **admin-editable mapping table keyed on the existing category strings** (appSettings sparse-map pattern) — `category → { group, trade }` — rather than rewriting 10.7k part docs. Ports/wire-types are net-new metadata on the part doc (jsonb rides free, like `SpecCatalogPart`); Grid wiring validation only engages when a drawn route's endpoints land on placed devices, so existing free routes keep working. Datasheets copy the D116 blob + authenticated-proxy pattern exactly. The starter set is drafted from the already-imported DB (ETC, Texas Scenic) plus the converted dealer sheets (`/Volumes/Claude/Peak Import/`), and is a REVIEW ARTIFACT — no import in this plan.

**Tech Stack:** Next.js app router, doc-store (jsonb) collections, appSettings sparse patch map, Vercel Blob (env-gated), `scripts/test-review-and-spec.ts` assertion harness.

## Global Constraints

- **Fabric is EXCLUDED**: never touch `category === "Fabric"` semantics, the curtain configurator's fabric join, or FABLIB. Same for `category === "Labor"`.
- **No import of starter-set items in this plan** — Jeff reviews the draft list first (locked decision). The draft + staged JSON are the deliverable.
- **Trades are exactly:** `Lighting`, `Rigging`, `AV`. **Groups are exactly:** `Lighting Controls`, `Fixtures`, `Video Controls`, `Speakers`, `Audio Controls`, `Curtains`. Jeff's rollup: Lighting Controls+Fixtures→Lighting; Video Controls+Speakers+Audio Controls→AV; Curtains(+track/hoists/rigging hardware)→Rigging.
- The mapping is DATA (admin-editable at runtime), not code — code seeds defaults only.
- Existing Grid routes (no device endpoints) must keep working unchanged; compatibility checking applies only to device-to-device wires. Compatibility v1: connectionType equal AND directions complement (out→in, io↔anything).
- Blob uploads: reuse `src/lib/blob.ts` helpers, private store, 8 MB cap, PDF-only for datasheets; proxy route requires `requireUser()`.
- Gates per task: `npx tsc --noEmit` clean + `npm run test:specs` green. Final: `npm run build` (safe post-D106; no dev server running).
- Match repo idiom: inline styles, no new npm deps, no emoji; doc-store `upsert` patterns; admin gate = `requirePerm("manage_users")`.
- Commit after every task on branch `punch-39-catalog-buildout`.

---

### Task 1: Taxonomy module — groups, trades, category mapping, resolvers

**Files:**
- Create: `src/lib/catalog-taxonomy.ts`
- Modify: `src/lib/settings.ts` (add `catalogCategoryMap` to `AppSettingsData`)
- Modify: `src/lib/stores/catalog.ts` (add `trade?: string` override field to `CatalogPart`)
- Test: `scripts/test-review-and-spec.ts` (new assertion block — resolvers are pure functions, no DB needed)

**Interfaces:**
- Produces (consumed by Tasks 2, 4, 5, 6 and the wave-2 dashboard spec):

```ts
export const TRADES = ["Lighting", "Rigging", "AV"] as const;
export type Trade = (typeof TRADES)[number];
export const GROUPS = ["Lighting Controls", "Fixtures", "Video Controls", "Speakers", "Audio Controls", "Curtains"] as const;
export type CatalogGroup = (typeof GROUPS)[number];
export type CategoryMapEntry = { group?: CatalogGroup; trade?: Trade };
export type CategoryMap = Record<string, CategoryMapEntry>;
export const GROUP_TRADES: Record<CatalogGroup, Trade>; // Jeff's locked rollup
export const DEFAULT_CATEGORY_MAP: CategoryMap;
export function resolveCategoryMap(stored?: CategoryMap): CategoryMap; // defaults ⊕ stored (stored wins per key)
export function groupOf(part: { category: string }, map: CategoryMap): CatalogGroup | null;
export function tradeOf(part: { category: string; trade?: string }, map: CategoryMap): Trade | null; // part.trade override wins; else map[category].trade ?? GROUP_TRADES[group]
```

- [ ] **Step 1: Write failing assertions** in `scripts/test-review-and-spec.ts` (new block near the bid-spec tests): `groupOf` resolves a mapped category; unmapped → null; `tradeOf` honors part-level override; `tradeOf` falls back group→trade via `GROUP_TRADES`; `resolveCategoryMap` lets a stored entry override a default AND lets a stored entry add a brand-new category key. Run `npm run test:specs` — expect FAIL (module missing).

- [ ] **Step 2: Implement `src/lib/catalog-taxonomy.ts`** with the interface above. `DEFAULT_CATEGORY_MAP` seeds every known imported category (from recon; keep this list in the file):
  - → `{ group: "Fixtures", trade: "Lighting" }`: `Fixtures`
  - → `{ trade: "Rigging" }` (no group — rigging hardware, not one of the six): `Track`, `Pipe`, `Loftblocks`, `Headblocks`, `Mule Block`, `Arbor`, `Standard Arbor`, `Front Arbor`, `Floor Block`, `Manual Hoist`, `Motorized Hoist`, `Rope Lock`, `Hardware`, `Shoes`, `Wire Mesh Strain Reliefs`, `Mounts`
  - → `{ group: "Curtains", trade: "Rigging" }`: (none yet — starter-set curtain items will use category `Curtains`; seed the identity entry `Curtains`)
  - → `{ trade: "AV" }`: `Networking`, `Racks`, `Rack Accessories`, `Rack Options`, `Connectors`, `Cable Assemblies`
  - Identity entries for the six group names themselves (`Lighting Controls` → group Lighting Controls etc.) so starter-set imports whose `category` IS the group name resolve with zero admin work.
  - `Fabric` and `Labor` get NO entry (excluded domains).

- [ ] **Step 3: Wire settings + part field.** `AppSettingsData` gains `catalogCategoryMap?: CategoryMap` (sparse patch; absent = defaults — copy the `reviewChecklistTemplates` semantics). `CatalogPart` gains `/** Trade override — normally derived via the category map. */ trade?: string;`.

- [ ] **Step 4: Run `npm run test:specs`** — all assertions pass, count went up. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit** `feat: catalog taxonomy layer — groups/trades + admin category map (#39)`

---

### Task 2: Admin "Categories & trades" mapping editor

**Files:**
- Create: `src/app/(app)/catalog/taxonomy-card.tsx` (client component)
- Modify: `src/app/(app)/catalog/page.tsx` (render the card, admin-only, above or beside the import card)
- Modify: `src/app/(app)/catalog/actions.ts` (server action `saveCategoryMapAction`)

**Interfaces:**
- Consumes: Task 1's `resolveCategoryMap`, `GROUPS`, `TRADES`, `GROUP_TRADES`.
- Produces: `saveCategoryMapAction(entries: CategoryMap): Promise<void>` — validates every `group` ∈ GROUPS and `trade` ∈ TRADES (reject otherwise), then `setSettings({ catalogCategoryMap: entries })`; admin-gated via the same permission check the import action uses.

- [ ] **Step 1: Server action** in `catalog/actions.ts`: gate, validate, persist, `revalidatePath("/catalog")`.
- [ ] **Step 2: The card.** Lists every distinct `category` in the loaded catalog (page.tsx already loads parts — pass distinct categories + current resolved map as props): one row per category → two `<select>`s (Group: blank/six; Trade: blank/three), unsaved-changes highlight, one Save button. Rows sorted: unmapped first, then alpha. A count chip "N of M categories mapped". `Fabric`/`Labor` rows render disabled with a note "excluded (curtain/labor engine)".
- [ ] **Step 3: Verify** in dev: change a mapping, save, reload — persists; non-admin sees no card. `npx tsc --noEmit` + `npm run test:specs` green.
- [ ] **Step 4: Commit** `feat: admin category→group/trade mapping editor on /catalog (#39)`

---

### Task 3: Ports + wire-type registry + compatibility rule

**Files:**
- Create: `src/lib/catalog-connect.ts`
- Modify: `src/lib/stores/catalog.ts` (add `ports?: Port[]` to `CatalogPart`)
- Modify: `src/lib/settings.ts` (add `wireTypes?: WireType[]`)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Produces (consumed by Task 4 and the metadata worksheet):

```ts
export type PortDirection = "in" | "out" | "io";
export type Port = { name: string; direction: PortDirection; connectionType: string; count?: number };
export type WireType = { id: string; label: string; connectionTypes: string[]; cableSku?: string; dollarsPerFt?: number };
export const CONNECTION_TYPES: readonly string[]; // the Jeff-prunable taxonomy, verbatim from the spec:
// power: "powerCON/True1", "Edison", "stage pin", "Socapex", "bare-end"
// lighting data: "DMX512 (5-pin XLR)", "sACN/Art-Net (etherCON/Cat6)", "RDM", "contact closure"
// audio: "XLR line/mic", "speakON NL2", "speakON NL4", "speakON NL8", "Dante/AES67 (Cat6)", "AES/EBU", "70V pair"
// video: "HDMI", "SDI/BNC", "HDBaseT (Cat6a)", "fiber"
// rigging: "motor power", "low-voltage pendant control"
export const DEFAULT_WIRE_TYPES: WireType[]; // DMX 5-pin, Cat6 (network/Dante/sACN/HDBaseT), speaker pair, XLR audio, SDI coax, HDMI, powerCON power, motor power — each mapping its connectionTypes
export function resolveWireTypes(stored?: WireType[]): WireType[]; // stored ?? defaults
export function canConnect(a: Port, b: Port): boolean; // connectionType equal AND (a.direction==="io" || b.direction==="io" || a.direction!==b.direction)
export function compatibleWireTypes(conn: string, types: WireType[]): WireType[];
```

- [ ] **Step 1: Failing assertions**: `canConnect` out→in same type = true; out→out same type = false; io↔in = true; different types = false; `compatibleWireTypes("DMX512 (5-pin XLR)", DEFAULT_WIRE_TYPES)` non-empty; every `DEFAULT_WIRE_TYPES.connectionTypes` entry ∈ `CONNECTION_TYPES`. Run — FAIL.
- [ ] **Step 2: Implement** the module per the interface. Add `ports?: Port[]` to `CatalogPart` with a doc comment noting it feeds Grid wiring validation.
- [ ] **Step 3:** `npm run test:specs` all pass; `npx tsc --noEmit` clean.
- [ ] **Step 4: Commit** `feat: device ports, wire-type registry + connection compatibility rule (#39)`

---

### Task 4: Grid wiring validation + wire types on routes + cable BOM annotation

**Files:**
- Modify: `src/lib/stores/grid-projects.ts` (`GridRoute` gains `fromPlacementId?: string; toPlacementId?: string; connectionType?: string`)
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx` (endpoint snap + validation on route completion)
- Modify: `src/app/(app)/design/grid/[id]/actions.ts` (`addRoute` accepts + persists the new fields; server-side re-validation)
- Modify: `src/lib/design/grid-bom.ts` (`routeLines()` output rows carry `connectionType?` when present)
- Test: `scripts/test-review-and-spec.ts` (pure part: endpoint-matching helper + validation fn)

**Interfaces:**
- Consumes: Task 3's `canConnect`, `Port`; existing `GridPlacement`, `GridRoute`, `polylineLength`.
- Produces: `export function validateDeviceWire(fromPart: { ports?: Port[] }, toPart: { ports?: Port[] }): { ok: true; connectionType: string } | { ok: false; reason: string }` in `src/lib/catalog-connect.ts` — first port pair (a from fromPart, b from toPart) with `canConnect(a,b)` wins; no ports on either side → `{ ok: false, reason: "no connection metadata" }` is NOT an error state for the editor (see Step 2 behavior).

**Binding behavior (spec acceptance):**
- Route whose first AND last waypoints each land within snap distance of a placed device (use the device marker's existing hit-test/rendered radius as the threshold source; a constant ~1.5× marker radius in normalized coords) = a device wire.
- Device wire between parts where BOTH have `ports` and `validateDeviceWire` fails → REFUSED: route is not added; show the existing editor notice pattern (whatever the editor uses for calibration warnings — reuse it) with the reason.
- Device wire where either part lacks `ports` → allowed (metadata not populated yet — never block the un-migrated catalog), no connectionType stamped.
- Free routes (either endpoint not on a device) → allowed exactly as today.
- On success, stamp `fromPlacementId/toPlacementId/connectionType` on the route; `routeLines()` groups unchanged but rows expose `connectionType` so the BOM table can show it (add a small muted suffix in the BOM render where route lines display).

- [ ] **Step 1: Failing assertions** for `validateDeviceWire` (ok pair; refused pair; missing-ports case) — FAIL, then implement in catalog-connect.ts, then PASS.
- [ ] **Step 2: Editor wiring.** In the route-completion handler in `editor.tsx`: hit-test first/last waypoint against placements on the same sheet/page; resolve both parts from the palette's parts prop; apply the behavior table above; pass new fields through the route-add call.
- [ ] **Step 3: Server action re-validation** in `addRoute`: if both placement ids present, re-run `validateDeviceWire` server-side (load the two parts) and reject with an error string on failure — client validation is UX, server is authority.
- [ ] **Step 4: BOM annotation** in `grid-bom.ts` + its render site.
- [ ] **Step 5:** `npx tsc --noEmit` + `npm run test:specs` green. **Step 6: Commit** `feat: Grid device-wire compatibility validation + typed cable BOM lines (#39)`

---

### Task 5: Catalog-anchored datasheet attachments (D116 pattern)

**Files:**
- Modify: `src/lib/stores/catalog.ts` (`datasheetBlobKey?: string; datasheetName?: string` on `CatalogPart`)
- Create: `src/app/api/part-datasheet/[id]/route.ts` (authenticated streaming proxy — copy `src/app/api/grid-sheets/[id]/route.ts` structure)
- Modify: `src/app/(app)/catalog/actions.ts` (`uploadPartDatasheetAction(sku, name, dataUrl)`, `removePartDatasheetAction(sku)`)
- Modify: catalog page part rows/detail UI (attach/replace/remove control, admin-gated; a small paperclip-free text link "Datasheet" — no emoji/glyph additions)
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx` (palette item + BOM row: "datasheet" link → proxy URL, target _blank, only when the part has one)

**Interfaces:**
- Consumes: `blobEnabled()`, `putBlob`, `getBlobStream`, `dataUrlToBytes`, `safeName` from `src/lib/blob.ts`; `requireUser()`.
- Produces: proxy GET `/api/part-datasheet/<sku>` streaming `application/pdf`, `cache-control: private, max-age=86400`; blob pathname convention `part-datasheets/<safeName(sku)>/<safeName(filename)>`.

**Binding rules:** PDF only, 8 MB cap (mirror the grid-sheets action's checks); when `!blobEnabled()`, the upload action returns a clear error (do NOT fall back to in-DB dataUrl — 10.7k parts × MB-scale docs in jsonb is the D116 anti-pattern); removing clears the fields but does not delete the blob (parity with grid-sheets backfill behavior; note it in a comment).

- [ ] **Step 1:** Part fields + proxy route (404 when part or key missing; `requireUser()` first).
- [ ] **Step 2:** Upload/remove actions (admin gate, validation, `putBlob`, upsert part).
- [ ] **Step 3:** Catalog UI control + Grid palette/BOM links.
- [ ] **Step 4:** Verify in dev with blob token if present; otherwise verify the disabled-path error and the wiring via tsc. `npm run test:specs` green.
- [ ] **Step 5: Commit** `feat: catalog-anchored datasheet attachments + authenticated proxy + Grid links (#39)`

---

### Task 6: Grid palette groups — six buckets

**Files:**
- Modify: `src/app/(app)/design/grid/[id]/page.tsx` (resolve the category map server-side; include each part's resolved `group` in the `PartLite` slice)
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx` (palette filter dropdown: All · the six groups · Other; filtering by resolved group; search unchanged; keep the existing 60-row cutoff)

**Interfaces:** Consumes Task 1's `groupOf`/`resolveCategoryMap`. `PartLite` gains `group: string | null`.

**Binding rules:** "Other" = parts whose group resolves null (legacy taxonomy — still reachable, never hidden); `Fabric`/`Labor` parts are EXCLUDED from the device palette entirely (they are not placeable devices; verify whether the current palette already excludes them — if it doesn't, exclude only under group filtering, keep "All" behavior identical to today to avoid breaking existing projects' workflow).

- [ ] **Step 1:** Thread `group` through `PartLite`. **Step 2:** Dropdown + filter logic. **Step 3:** tsc + test:specs green; dev-verify the palette shows six groups + Other and search still works. **Step 4: Commit** `feat: Grid palette groups by the six beta categories (#39)`

---

### Task 7: Starter-set draft + metadata worksheet (Jeff review gate — NO import)

**Files:**
- Create: `scripts/draft-starter-set.ts` (tsx script; reads `scripts/catalog-import-data.json` + `scripts/dealer-import-data.json` when present)
- Create: `docs/catalog/STARTER-SET-2026-07-DRAFT.md` (generated, then hand-tuned — the review artifact)
- Create: `docs/catalog/METADATA-WORKSHEET-2026-07.md` (connection taxonomy + per-starter-item draft ports)
- Create: `scripts/starter-import-data.json` (the machine-readable staged import, matching `import-dealer-sheets.ts` row shape + `category` set to one of the six groups + draft `ports`)

**Process (controller runs the converter; the implementer builds the script + artifacts):**
- Dealer sheets live at `/Volumes/Claude/Peak Import/` (NOT ~/Downloads — recon corrected this). If `scripts/dealer-import-data.json` does not exist, run `python3 scripts/convert-dealer-sheets.py` first (volume must be mounted); if the volume is unavailable, generate the draft from the existing DB only and mark dealer-sourced sections as PENDING VOLUME.
- Selection bar per group (breadth over depth, ≥2 manufacturers each): **Lighting Controls:** ETC consoles/dimming from existing DB + ChamSys (Chauvet sheet); **Fixtures:** ETC + Chauvet Professional; **Video Controls:** BirdDog + Matrox + AVPro Edge; **Speakers:** Meyer + Danley + Tannoy (Music Tribe rows ONLY — the June 2023 Tannoy sheet is held out/superseded); **Audio Controls:** Biamp + Shure + Allen & Heath; **Curtains:** Texas Scenic track/carriers from existing DB (NO fabric) + Thern hoists. Ape Riggers: DROPPED (Jeff). Draper: held out entirely (converter decision — stronger than "base-only"; flag in the draft for Jeff).
- ~8–15 items per group; each draft row: brand · SKU · desc · cost/list · source (DB | sheet) · proposed group · trade · draft ports.
- The draft doc's header states plainly: **"Nothing below is imported. Jeff: mark rows to drop, then say 'import the starter set'."**

- [ ] **Step 1:** Write the selection script (deterministic given inputs; picks by brand + keyword heuristics per group; emits both the .md tables and the .json).
- [ ] **Step 2:** Generate; sanity-pass the output by hand (obvious garbage rows out).
- [ ] **Step 3:** tsc + test:specs green (script is standalone; no app imports beyond types).
- [ ] **Step 4: Commit** `docs: starter-set draft + connection metadata worksheet for Jeff review (#39)`

---

### Task 8: Final gates + punch-list update

- [ ] **Step 1:** `npx tsc --noEmit` && `npm run test:specs` && `npm run build` (no dev server running).
- [ ] **Step 2:** Acceptance walk (dev): palette shows six groups; mapping editor round-trips; a device wire between two ports-carrying parts validates/refuses correctly; a part with an attached datasheet exposes it from palette + BOM; starter-set draft exists and nothing was imported.
- [ ] **Step 3:** `PUNCHLIST.md` #39 → status: infrastructure DONE; import staged AWAITING JEFF'S REVIEW of `docs/catalog/STARTER-SET-2026-07-DRAFT.md`. Commit `docs: punch #39 catalog build-out — infra complete, starter set staged for review`

## Self-Review Notes

- Spec deltas honored: mapping-table (not doc rewrites) because `category` already exists and is load-bearing; `specKey` dropped (spec text is inline on parts — recon); dealer-sheet path corrected to /Volumes/Claude; ETC sourced from DB (not in sheets); Curtains sourced from DB (no curtain vendor in sheets).
- Review gate preserved: Task 7 produces artifacts only; import is a follow-up on Jeff's word.
- Type consistency: `Port`/`WireType`/`CategoryMap` defined once (Tasks 1/3) and imported everywhere; `validateDeviceWire` lives in catalog-connect.ts, used by editor + server action.
