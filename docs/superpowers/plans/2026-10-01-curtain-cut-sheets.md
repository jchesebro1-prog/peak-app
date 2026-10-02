# Curtain cut sheets (#292) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every curtain on a system quote gets a deterministic cut sheet (front elevation, mounting detail, materials, mounting hardware), one per curtain *type*, viewable/printable at `/estimator/cut-sheets`, zipped into the client package, and optionally appended to the customer estimate PDF.

**Architecture:** Pure, client-safe modules under `src/lib/curtain-cut-sheets/` read curtains off a quote (an Estimator adapter and a Grid adapter feeding one collector), group them into types, and build a `CutSheetModel` (title block, elevation shapes, mount-detail shapes, tables). One server loader (`load.ts`) feeds three outputs: a staff page, a signed print route rendered by the existing headless-Chrome pipeline (client package + estimate PDF), and nothing else. New data is optional JSONB fields plus one settings blob (`curtain_mount_hardware`), so there is no SQL migration.

**Tech Stack:** Next.js 16 App Router (server components + server actions), TypeScript, Drizzle doc-store blobs, the single spec harness `scripts/test-review-and-spec.ts` (`npm run test:specs`), `scripts/smoke-routes.ts` (`npm run test:smoke`), headless Chrome via `src/lib/quote-pdf/render.ts`.

**Spec (approved, committed):** `docs/superpowers/specs/2026-10-01-curtain-cut-sheets-design.md`. Section references below (§1.4, §2.3 …) point into it.

## Global Constraints

- Work only in `/Users/sm/Downloads/peak-app/.claude/worktrees/cutsheets` (branch `feat/292-curtain-cut-sheets`). Use absolute paths. `export PATH="$HOME/.local/node/bin:$PATH"` before any `npx`/`npm`.
- **Never `git stash`.** The stash stack is shared across every worktree and other sessions pop it. To set work aside, make a WIP commit.
- **Never touch the main checkout's `.data/pglite`** (`/Users/sm/Downloads/peak-app/.data`). `test:specs` uses its own `mktemp` datadir; `test:smoke` boots its own scratch server. Do not run `npm run dev`, `db:*` scripts or `specs:seed`. Before a gate run, check `ps aux | grep -E "next dev|tsx" | grep cutsheets` for strays from this worktree and stop them.
- **Client components never import a server store** (`@/lib/stores/*`, `@/db/*`, `load.ts`, `package-sheets.ts`). `tsc` and `test:specs` do not catch it; only `next build` does. Client-safe modules in this feature: `vocab.ts`, `parse.ts`, `track-link.ts`, `shapes.ts`, `geometry.ts`, `mount-details.ts`, `estimator-curtains.ts`, `model.ts`, `src/lib/curtain-mounts.ts`, `src/app/(app)/estimator/curtain-line.ts`. `collect.ts` is DB-free but pulls `steel.ts` (a 233 KB shape table), so **client code never imports `collect.ts`** — the Estimator preview counts sheets through `countCutSheetTypes` in `estimator-curtains.ts`.
- **Deterministic only.** No AI, no `@anthropic-ai/*`, no `@/lib/ai` import anywhere under `src/lib/curtain-cut-sheets/` (a harness source check enforces it). No number that isn't already on the quote, in the catalog or in Estimating Rules. A blank fact prints nothing, never stand-in text.
- Copy, ids and field names are verbatim from the spec: sheet numbers `CS-1, CS-2…`; mount ids `track-batten`, `track-ceiling`, `track-structure`, `tie-batten`, `wall-hookloop` (+ fallback `track-other`, never pickable); top finishes `grommets | pipe-pocket | hook-loop`; bottom finishes `chain | pipe-pocket | hem`; blob `curtain_mount_hardware`; `SpecItem.curtainTrackKey` = `"ct-" + <curtain line id at add time>`; PDF option `pdfCutSheets` (default **false**); print-token kind `"cutsheets"`; package folder `cutsheets/`; gap kind `"missing-cutsheet"`.
- Messages that the harness matches (keep verbatim): `"Can't read size — edit the curtain"`, `"Size is 0 — edit the curtain"`, `"Track series no longer exists — hardware as quoted."`, `"The Grid design behind this quote no longer exists — sheets read the quoted lines."`, `"No hardware listed for <mount label> — Estimating Rules → Curtain mounts"`, `"Weight not set for <fabric> — Catalog"`, `"Quote not found."`, `"Cut sheets are for system quotes."`, `"This quote has no curtains."`, `"Not rendered in time — print from Cut sheets"`, `"Add this design to Quotes to include cut sheets"`, `"Track mounting per manufacturer's instructions"`.
- Permissions: viewing cut sheets = `requireUser()`; Curtain mounts page = `can("manage_users", …)`, its action = `requirePerm("manage_users")`; editing curtains rides the existing Estimator save.
- **Parallel branch #293 (narrative)** also edits `src/app/(app)/estimator/estimator-client.tsx`, `src/app/(app)/estimator/quote-document.tsx`, `src/lib/quote-pdf/pdf-options.ts` and `scripts/test-review-and-spec.ts`, and will merge around the same time. In those files keep every edit **small and localized**: add new lines next to their siblings, never reformat, reorder or rename existing code, and put new logic in new modules (`curtain-line.ts`, `estimator-curtains.ts`) instead of inline. This plan does **not** touch `quote-document.tsx` at all. The harness block is appended at the **end** of the file (a #293 block will also land there — resolve as keep-both), and the one async registration is a single `.then(...)` line after `packages289AsyncChecks()`.
- Commit after every task; every commit message ends with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Gates (run at the end of every task, from the worktree root)

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/cutsheets
export PATH="$HOME/.local/node/bin:$PATH"
npx tsc --noEmit                                     # baseline: 0 errors, no output
df -h "${TMPDIR:-/tmp}" | tail -1                    # need several GB free — test:specs leaves a tmp.* datadir
npm run test:specs > "${TMPDIR:-/tmp}/specs292.log" 2>&1; tail -2 "${TMPDIR:-/tmp}/specs292.log"
grep -c '^PASS ' "${TMPDIR:-/tmp}/specs292.log"     # baseline 10,378 before Task 1; must rise by this task's new checks
grep '^FAIL ' "${TMPDIR:-/tmp}/specs292.log"        # must print nothing
npx eslint <the task's changed src files>            # 0 problems; never whole-repo (crashes on the harness — pre-existing)
```

Report the real PASS count in the task's commit body (e.g. `test:specs 10,397 PASS / 0 FAIL`). Task 9 adds `npm run test:smoke` and `npx next build`.

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/curtain-cut-sheets/vocab.ts` | new | Finish/mount vocabulary, labels, guards, Grid type defaults, `mountTypeForTrackMounting`, `cleanCurtainFinishes` |
| `src/lib/curtain-cut-sheets/parse.ts` | new | `parseEstimatorCurtainDesc`, `parseGridCurtainDesc` |
| `src/lib/curtain-cut-sheets/track-link.ts` | new | `linkCurtainTracks`, `newCurtainTrackKey` |
| `src/lib/curtain-cut-sheets/shapes.ts` | new | `Shape`, `ShapeLabel` (pure drawing primitives) |
| `src/lib/curtain-cut-sheets/geometry.ts` | new | `ftIn`, `inchLabel`, `ARCH_SCALES`, `pickScale`, `topMarks`, `drawnPanels`, `elevation` |
| `src/lib/curtain-cut-sheets/mount-details.ts` | new | `mountDetail(key)` — the six section details |
| `src/lib/curtain-mounts.ts` | new | Blob shape, `sanitizeCurtainMounts`, `sanitizeMountRows`, `mountRowQty` |
| `src/lib/curtain-cut-sheets/estimator-curtains.ts` | new | Estimator + Grid adapters, `readCurtains`, `curtainTypeKey`, `countCutSheetTypes` (no weight math) |
| `src/lib/curtain-cut-sheets/collect.ts` | new | `collectCurtainTypes` — grouping, sizes, hardware, sewn area, weight, warnings |
| `src/lib/curtain-cut-sheets/model.ts` | new | `cutSheetModel`, `plainDescription`, `quoteRevisionRows`, `cutSheetCssVars`, page copy constants |
| `src/lib/curtain-cut-sheets/load.ts` | new (server) | `loadCutSheets` — reads quote, catalog, track series, mounts, project, settings, photos |
| `src/lib/curtain-cut-sheets/package-sheets.ts` | new (server) | `addCutSheets` — per-sheet PDFs into the client package zip |
| `src/lib/stores/curtain-mounts.ts` | new (server) | `listCurtainMounts`, `saveCurtainMount` |
| `src/components/cutsheets/shape-svg.tsx` | new | `ShapeSvg` — draws `Shape[]` + labels (no hooks, server-renderable) |
| `src/components/cutsheets/cut-sheet-pages.tsx` | new | `CutSheetPages` (Submittal + Client layouts), print CSS strings |
| `src/app/(app)/estimator/cut-sheets/page.tsx` | new | Staff page `/estimator/cut-sheets?id=&style=` |
| `src/app/(app)/estimating-rules/curtain-mounts/{page.tsx,curtain-mounts-client.tsx,actions.ts}` | new | Estimating Rules → Curtain mounts |
| `src/app/print/cutsheets/[quoteId]/page.tsx` | new | Signed print route |
| `src/app/(app)/estimator/curtain-line.ts` | new | Pure curtain-line build / edit helpers |
| `src/app/(app)/estimator/types.ts` | modify | `SpecItem.curtainTrackKey`; `CurtainDraft` gains three fields |
| `src/lib/portal-cart-types.ts` | modify | `CurtainRequest` gains three optional fields |
| `src/lib/design/grid-bom.ts` | modify | `GridCurtain` gains three optional fields |
| `src/lib/stores/catalog.ts` | modify | `CatalogPart.flameRating` |
| `src/app/(app)/estimator/track-bom.ts` | modify | `replaceCurtainLine`; `replaceTrackLine` keeps `curtainTrackKey` |
| `src/app/(app)/estimator/curtain-modal.tsx` | modify | Top/bottom finish + mount fields; edit mode |
| `src/app/(app)/estimator/section-card.tsx` | modify | ✎ on curtain lines |
| `src/app/(app)/estimator/estimator-client.tsx` | modify (shared with #293) | `addCurtain` → `curtainItem`; edit flow; Cut sheets button; `pdfCutSheets` state |
| `src/app/(app)/estimator/preview-doc.tsx` | modify | Cut sheets chip + hint card |
| `src/app/(app)/design/grid/[id]/curtain-drop.tsx`, `actions.ts` | modify | Drop-dialog fields; validation |
| `src/app/(app)/catalog/part-form.ts`, `fabric-rate-field.tsx`, `page.tsx`, `actions.ts` | modify | Weight (oz), Weight basis, Flame rating |
| `src/app/(app)/estimating-rules/page.tsx` | modify | Curtain mounts link card |
| `src/app/(app)/quotes/page.tsx` | modify | "Cut sheets →" in the action strip |
| `src/lib/quote-pdf/pdf-options.ts` | modify (shared with #293) | `pdfCutSheets` |
| `src/lib/quote-pdf/token.ts` | modify | `PrintTokenKind` gains `"cutsheets"` |
| `src/app/print/quote/[id]/page.tsx` | modify | Append Client pages when `pdfCutSheets` |
| `src/lib/client-package.ts`, `src/lib/client-package-server.ts` | modify | Gap kind; cut sheets in both package builders |
| `src/app/(app)/quotes/actions.ts`, `src/app/(app)/design/grid/[id]/actions.ts` | modify | Pass the print origin to the package builders |
| `src/app/globals.css` | modify | `pk-cs-*` classes |
| `scripts/test-review-and-spec.ts` | modify (shared with #293) | `#292` block at EOF + one `.then` line |
| `scripts/smoke-routes.ts` | modify | Four routes |
| `PUNCHLIST.md`, `DECISIONS.md`, `AGENTS.md`, spec | modify | Docs (Task 9) |

## Recorded implementation choices (log in DECISIONS in Task 9)

1. `linkCurtainTracks` keys its map by the curtain **`SpecItem` object**, not by line id (line ids can repeat across sections after copy/move), and also returns the flagged duplicates: `{ links: Map<SpecItem, SpecItem>; duplicates: SpecItem[] }`.
2. The adapters live in `estimator-curtains.ts` (no weight math) so the Estimator preview counts sheets with the **same adapters and type key** without bundling `steel.ts`; `collect.ts` adds weight/area/hardware on the server. Spec §5.3 says "computed client-side by `collectCurtainTypes`"; the count is identical by construction.
3. Photos are returned as `Map<sheetNo, string[]>` (spec wrote `Map<string, string>`), so the Client model itself carries no SKU.
4. `loadCutSheets` accepts `images: "none"` too (package renders and the Submittal style need no photos).
5. `replaceTrackLine` now also keeps `curtainTrackKey` (else Update track would silently unlink a curtain); `replaceCurtainLine` keeps the old line's `sku` too.
6. The cut-sheet package helper lives in `src/lib/curtain-cut-sheets/package-sheets.ts` and is called from `client-package-server.ts`; it takes the print origin as a parameter.
7. A Grid package with no quote adds the "Add this design to Quotes…" gap **only when the option has curtain placements**.
8. The mount-rule "per mark" count is 0 for a curtain whose top is not grommets (a pipe-pocket curtain has no ties).

---

### Task 1: Vocabulary, parsers, track link + the new optional fields

**Files:**
- Create: `src/lib/curtain-cut-sheets/vocab.ts`, `src/lib/curtain-cut-sheets/parse.ts`, `src/lib/curtain-cut-sheets/track-link.ts`
- Modify: `src/app/(app)/estimator/types.ts` (SpecItem, after `laborMobKey?: string;` ~line 94), `src/lib/portal-cart-types.ts:9-20`, `src/lib/design/grid-bom.ts:121-136`, `src/lib/stores/catalog.ts:~97` (after `curtainAreaRate`)
- Test: `scripts/test-review-and-spec.ts` (append the `#292` block at EOF)

**Interfaces:**
- Produces (later tasks import exactly these):
  - `vocab.ts`: types `CurtainTopFinish`, `CurtainBottomFinish`, `CurtainMountTypeId`, `CurtainMountKey`; consts `TOP_FINISHES`, `BOTTOM_FINISHES`, `TOP_FINISH_LABELS`, `BOTTOM_FINISH_LABELS`, `TOP_FINISH_SHORT`, `BOTTOM_FINISH_SHORT`, `CURTAIN_MOUNT_TYPES`, `MOUNT_KEY_LABELS`, `DEFAULT_MARK_SPACING_IN` (12), `DEFAULT_TOP_FINISH`, `DEFAULT_BOTTOM_FINISH`, `ASSUMED_MOUNT`, `GRID_CURTAIN_DEFAULTS`; functions `mountTypeForTrackMounting(m: string): CurtainMountKey`, `isMountTypeId`, `isTopFinish`, `isBottomFinish`, `cleanCurtainFinishes(raw: unknown): { topFinish?; bottomFinish?; mountType? }`.
  - `parse.ts`: `CurtainSize`, `ParsedEstimatorDesc`, `parseEstimatorCurtainDesc(desc: string, fabricNames: ReadonlySet<string>): ParsedEstimatorDesc | null`, `parseGridCurtainDesc(desc: string): (ParsedEstimatorDesc & { gridType: GridCurtainType }) | null`.
  - `track-link.ts`: `newCurtainTrackKey(curtainLineId: number): string`, `type CurtainTrackLinks = { links: Map<SpecItem, SpecItem>; duplicates: SpecItem[] }`, `linkCurtainTracks(sections: readonly SpecSection[]): CurtainTrackLinks`.
  - Fields: `SpecItem.curtainTrackKey?: string`; `CurtainRequest.topFinish? / bottomFinish? / mountType?`; `GridCurtain.topFinish? / bottomFinish? / mountType?`; `CatalogPart.flameRating?: string`.

- [ ] **Step 1: Write the failing harness checks.** Append at the very end of `scripts/test-review-and-spec.ts`:

```ts
/* ============================================================================
   #292 — curtain cut sheets: one sheet per curtain TYPE (elevation, mounting
   detail, materials, hardware), read from Estimator or Grid quotes. Pure
   checks run here; DB checks run in curtain292AsyncChecks() (registered on
   the promise chain after packages289AsyncChecks).
   ============================================================================ */
import {
  ASSUMED_MOUNT as c292Assumed,
  CURTAIN_MOUNT_TYPES as c292MountTypes,
  GRID_CURTAIN_DEFAULTS as c292GridDefaults,
  cleanCurtainFinishes as c292CleanFinishes,
  isMountTypeId as c292IsMount,
  mountTypeForTrackMounting as c292MountFor,
} from "@/lib/curtain-cut-sheets/vocab";
import { parseEstimatorCurtainDesc as c292ParseEst, parseGridCurtainDesc as c292ParseGrid } from "@/lib/curtain-cut-sheets/parse";
import { linkCurtainTracks as c292Link, newCurtainTrackKey as c292Key } from "@/lib/curtain-cut-sheets/track-link";
import { curtainDesc as c292CurtainDesc, type GridCurtain as C292GridCurtain } from "@/lib/design/grid-bom";
import type { SpecItem as C292Item, SpecSection as C292Section } from "@/app/(app)/estimator/types";

const C292_TRACK = { seriesId: "adc-280-black", operation: "biparting" as const, runFt: 40, curved: false, mounting: "batten" as const, qty: 1 };
function c292Sec(id: string, items: Array<Partial<C292Item> & { id: number }>): C292Section {
  return {
    id, name: id, kind: "materials", mfr: "", freightPct: 0,
    items: items.map((it) => ({ sku: "X", desc: "x", qty: 1, unit: "ea", cost: 0, price: 0, ...it }) as C292Item),
  };
}

// ---- vocabulary ----
{
  ok(c292MountFor("batten") === "track-batten" && c292MountFor("ceiling") === "track-ceiling" && c292MountFor("structure") === "track-structure",
    "#292 vocab: batten / ceiling / structure mountings map to their mount types");
  ok(c292MountFor("rafter") === "track-other" && c292MountFor("") === "track-other",
    "#292 vocab: any other mounting string is track-other (a third TrackMounting never breaks)");
  ok(c292MountTypes.map((t) => t.id).join() === "track-batten,track-ceiling,track-structure,tie-batten,wall-hookloop" && !c292IsMount("track-other") && c292IsMount("tie-batten"),
    "#292 vocab: five pickable mount types; track-other is never pickable");
  ok(c292Assumed === "tie-batten" && c292GridDefaults.Draw.mount === "track-batten" && c292GridDefaults.Border.bottom === "hem" && c292GridDefaults.Leg.mount === "tie-batten" && c292GridDefaults.Full.bottom === "chain",
    "#292 vocab: assumed mount is tie-batten; Grid type defaults per spec §1.4");
  const cf = c292CleanFinishes({ topFinish: "pipe-pocket", bottomFinish: "velcro", mountType: "track-other" });
  ok(cf.topFinish === "pipe-pocket" && !("bottomFinish" in cf) && !("mountType" in cf) && Object.keys(c292CleanFinishes(null)).length === 0,
    "#292 vocab: cleanCurtainFinishes keeps valid values and drops bad or absent ones (never refuses)");
}
// ---- parsers ----
{
  const fabs = new Set(["Charisma Velour 25 oz", "Encore Velour 22 oz"]);
  const a = c292ParseEst("Main Drape — Charisma Velour 25 oz, 21.5'W × 18'H, 50% fullness", fabs);
  ok(!!a && a.name === "Main Drape" && a.fabricName === "Charisma Velour 25 oz" && a.widthFt === 21.5 && a.heightFt === 18 && a.fullnessPct === 50,
    "#292 parse: the exact addCurtain desc round-trips, decimals included");
  const flat = c292ParseEst("Cyc — Encore Velour 22 oz, 40'W × 20'H, 0% fullness", fabs);
  ok(!!flat && flat.fullnessPct === 0, "#292 parse: 0% fullness reads as flat");
  const dash = c292ParseEst("Legs — Stage Left — Encore Velour 22 oz, 6'W × 20'H, 50% fullness", fabs);
  ok(!!dash && dash.name === "Legs — Stage Left" && dash.fabricName === "Encore Velour 22 oz", "#292 parse: a name containing ' — ' splits at the known fabric");
  const unknown = c292ParseEst("Legs — Stage Left — Mystery Cloth, 6'W × 20'H, 50% fullness", fabs);
  ok(!!unknown && unknown.name === "Legs" && unknown.fabricName === "Stage Left — Mystery Cloth", "#292 parse: with no known fabric it splits at the first ' — '");
  ok(c292ParseEst("Main Drape (black), 20 x 18 ft", fabs) === null && c292ParseEst("Main Drape — Charisma Velour 25 oz, 21.5'W × 18'H", fabs) === null && c292ParseEst("", fabs) === null,
    "#292 parse: a hand-edited desc reads as null, never a guess");
  const g: C292GridCurtain = { type: "Leg", name: "SL Leg", widthFt: 6, heightFt: 20.5, fullnessPct: 50, fabricSku: "FAB-1" };
  const gp = c292ParseGrid(c292CurtainDesc(g, "Encore Velour 22 oz"));
  ok(!!gp && gp.name === "SL Leg" && gp.gridType === "Leg" && gp.widthFt === 6 && gp.heightFt === 20.5 && gp.fullnessPct === 50 && gp.fabricName === "Encore Velour 22 oz",
    "#292 parse: curtainDesc round-trips through parseGridCurtainDesc (% fullness)");
  const gf = c292ParseGrid(c292CurtainDesc({ ...g, type: "Full", fullnessPct: 0 }));
  ok(!!gf && gf.fullnessPct === 0 && gf.gridType === "Full" && gf.fabricName === "FAB-1", "#292 parse: a flat Grid curtain round-trips (the fabric SKU when no name)");
  ok(c292ParseGrid("Truss 12in box · 10 ft") === null && c292ParseGrid("SL Leg (Tab) · 6×20 ft · flat · X") === null, "#292 parse: a non-curtain Grid line reads as null");
}
// ---- track link ----
{
  const cur = (id: number, extra: Partial<C292Item> = {}) => ({ id, curtain: true, ...extra });
  const trk = (id: number, extra: Partial<C292Item> = {}) => ({ id, track: { ...C292_TRACK }, ...extra });
  ok(c292Key(41) === "ct-41", "#292 link: newCurtainTrackKey is ct-<line id>");
  const s1 = c292Sec("a", [cur(1, { curtainTrackKey: "ct-41" })]);
  const s2 = c292Sec("b", [{ id: 9 }, trk(2, { curtainTrackKey: "ct-41" })]);
  ok(c292Link([s1, s2]).links.get(s1.items[0])?.id === 2, "#292 link: a shared key matches across sections");
  const adj = c292Sec("c", [cur(3), trk(4)]);
  ok(c292Link([adj]).links.get(adj.items[0])?.id === 4, "#292 link: a key-less curtain links to the track line right after it");
  ok(c292Link([c292Sec("d", [cur(5)]), c292Sec("e", [trk(6)])]).links.size === 0, "#292 link: no adjacency fallback across sections");
  ok(c292Link([c292Sec("f", [cur(7), { id: 8 }, trk(9)])]).links.size === 0, "#292 link: no fallback past a non-track line");
  ok(c292Link([c292Sec("g", [cur(10), trk(11, { curtainTrackKey: "ct-99" })])]).links.size === 0, "#292 link: no fallback onto a track that carries its own key");
  const dupe = c292Sec("h", [cur(12, { curtainTrackKey: "ct-12" }), cur(13, { curtainTrackKey: "ct-12" }), trk(14, { curtainTrackKey: "ct-12" })]);
  const dl = c292Link([dupe]);
  ok(dl.links.get(dupe.items[0])?.id === 14 && !dl.links.has(dupe.items[1]) && dl.duplicates.length === 1 && dl.duplicates[0] === dupe.items[1],
    "#292 link: two curtains on one key — the first links, the second is flagged");
}
```

- [ ] **Step 2: Run to verify it fails.** `npm run test:specs 2>&1 | tail -5` — Expected: tsx aborts with `Cannot find module '@/lib/curtain-cut-sheets/vocab'` (or a tsc-style resolution error). `npx tsc --noEmit` also errors on the missing modules / missing `curtainTrackKey`.

- [ ] **Step 3: Create `src/lib/curtain-cut-sheets/vocab.ts`:**

```ts
/**
 * Curtain cut sheets (#292) — the finish + mount vocabulary (spec §1.1).
 * Pure and client-safe: the Estimator curtain modal, the Grid drop dialog,
 * the cut-sheet collector and the harness all read it.
 */
import type { GridCurtainType } from "@/lib/design/grid-bom";

export type CurtainTopFinish = "grommets" | "pipe-pocket" | "hook-loop";
export type CurtainBottomFinish = "chain" | "pipe-pocket" | "hem";
export type CurtainMountTypeId = "track-batten" | "track-ceiling" | "track-structure" | "tie-batten" | "wall-hookloop";
/** `track-other` is a fallback detail for an unknown track mounting — never offered in a picker. */
export type CurtainMountKey = CurtainMountTypeId | "track-other";

export const TOP_FINISHES: readonly CurtainTopFinish[] = ["grommets", "pipe-pocket", "hook-loop"];
export const BOTTOM_FINISHES: readonly CurtainBottomFinish[] = ["chain", "pipe-pocket", "hem"];

export const TOP_FINISH_LABELS: Record<CurtainTopFinish, string> = {
  grommets: "Webbing with grommets",
  "pipe-pocket": "Pipe pocket",
  "hook-loop": "Hook-and-loop",
};
/** The prototype's Chain / Pocket / None, under clearer names. */
export const BOTTOM_FINISH_LABELS: Record<CurtainBottomFinish, string> = {
  chain: "Chain pocket (jack chain)",
  "pipe-pocket": "Pipe pocket",
  hem: "Plain hem",
};
/** Segmented-button captions (curtain modal, Grid drop dialog). */
export const TOP_FINISH_SHORT: Record<CurtainTopFinish, string> = { grommets: "Grommets", "pipe-pocket": "Pipe pocket", "hook-loop": "Hook & loop" };
export const BOTTOM_FINISH_SHORT: Record<CurtainBottomFinish, string> = { chain: "Chain pocket", "pipe-pocket": "Pipe pocket", hem: "Hem" };

/** Starter mount types — awaiting Jeff's confirmation (spec Open questions 1). */
export const CURTAIN_MOUNT_TYPES: ReadonlyArray<{ id: CurtainMountTypeId; label: string; track: boolean }> = [
  { id: "track-batten", label: "Track — batten mount", track: true },
  { id: "track-ceiling", label: "Track — ceiling mount", track: true },
  { id: "track-structure", label: "Track — structure mount (drop kit)", track: true },
  { id: "tie-batten", label: "Tie-line to pipe batten", track: false },
  { id: "wall-hookloop", label: "Wall/header — hook-and-loop", track: false },
];

export const MOUNT_KEY_LABELS: Record<CurtainMountKey, string> = {
  "track-batten": "Track — batten mount",
  "track-ceiling": "Track — ceiling mount",
  "track-structure": "Track — structure mount (drop kit)",
  "tie-batten": "Tie-line to pipe batten",
  "wall-hookloop": "Wall/header — hook-and-loop",
  "track-other": "Track — other mounting",
};

export const DEFAULT_MARK_SPACING_IN = 12;
export const DEFAULT_TOP_FINISH: CurtainTopFinish = "grommets";
export const DEFAULT_BOTTOM_FINISH: CurtainBottomFinish = "chain";
/** The mount a curtain with no track and no pick is assumed to use (flagged as assumed). */
export const ASSUMED_MOUNT: CurtainMountTypeId = "tie-batten";

/**
 * A track line's `track.mounting` → the mount detail. The parameter is a
 * plain string with a default branch on purpose: when another session adds
 * "structure" (or anything else) to TrackMounting, nothing here changes.
 */
export function mountTypeForTrackMounting(m: string): CurtainMountKey {
  switch (m) {
    case "batten":
      return "track-batten";
    case "ceiling":
      return "track-ceiling";
    case "structure":
      return "track-structure";
    default:
      return "track-other";
  }
}

export function isMountTypeId(v: unknown): v is CurtainMountTypeId {
  return typeof v === "string" && CURTAIN_MOUNT_TYPES.some((t) => t.id === v);
}
export function isTopFinish(v: unknown): v is CurtainTopFinish {
  return typeof v === "string" && (TOP_FINISHES as readonly string[]).includes(v);
}
export function isBottomFinish(v: unknown): v is CurtainBottomFinish {
  return typeof v === "string" && (BOTTOM_FINISHES as readonly string[]).includes(v);
}

/** Untrusted finishes/mount (a Grid drop, a saved line) → only the valid ones. Bad or absent values are dropped, never refused. */
export function cleanCurtainFinishes(raw: unknown): { topFinish?: CurtainTopFinish; bottomFinish?: CurtainBottomFinish; mountType?: CurtainMountTypeId } {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: { topFinish?: CurtainTopFinish; bottomFinish?: CurtainBottomFinish; mountType?: CurtainMountTypeId } = {};
  if (isTopFinish(r.topFinish)) out.topFinish = r.topFinish;
  if (isBottomFinish(r.bottomFinish)) out.bottomFinish = r.bottomFinish;
  if (isMountTypeId(r.mountType)) out.mountType = r.mountType;
  return out;
}

/** Defaults by Grid curtain type, for placed curtains and blank fields (spec §1.4; Open question 3). */
export const GRID_CURTAIN_DEFAULTS: Record<GridCurtainType, { top: CurtainTopFinish; bottom: CurtainBottomFinish; mount: CurtainMountTypeId }> = {
  Draw: { top: "grommets", bottom: "chain", mount: "track-batten" },
  Border: { top: "grommets", bottom: "hem", mount: "tie-batten" },
  Leg: { top: "grommets", bottom: "chain", mount: "tie-batten" },
  Full: { top: "grommets", bottom: "chain", mount: "tie-batten" },
};
```

- [ ] **Step 4: Create `src/lib/curtain-cut-sheets/parse.ts`:**

```ts
/**
 * Curtain cut sheets (#292) — reading a curtain back from the line text
 * (spec §2.1). Pure. A desc that doesn't match EXACTLY reads as null: the
 * collector flags the line, it never guesses a size.
 */
import { GRID_CURTAIN_TYPES, type GridCurtainType } from "@/lib/design/grid-bom";

export type CurtainSize = { widthFt: number; heightFt: number };
export type ParsedEstimatorDesc = { name: string; fabricName: string; widthFt: number; heightFt: number; fullnessPct: number };

const SEP = " — ";
/** addCurtain's tail (estimator-client.tsx): ", <W>'W × <H>'H, <F>% fullness" at the very end. */
const EST_TAIL = /, (\d+(?:\.\d+)?)'W × (\d+(?:\.\d+)?)'H, (\d+)% fullness$/;

/**
 * `<name> — <fabric>, <W>'W × <H>'H, <F>% fullness`. The head splits at the
 * LAST " — " whose right side is a known fabric name (so a name may itself
 * contain " — "); with no such match, at the first " — ".
 */
export function parseEstimatorCurtainDesc(desc: string, fabricNames: ReadonlySet<string>): ParsedEstimatorDesc | null {
  const s = (desc || "").trim();
  const m = EST_TAIL.exec(s);
  if (!m) return null;
  const head = s.slice(0, m.index);
  let cut = -1;
  let i = head.lastIndexOf(SEP);
  while (i > 0) {
    if (fabricNames.has(head.slice(i + SEP.length).trim())) {
      cut = i;
      break;
    }
    i = head.lastIndexOf(SEP, i - 1);
  }
  if (cut < 0) cut = head.indexOf(SEP);
  if (cut <= 0) return null;
  const name = head.slice(0, cut).trim();
  const fabricName = head.slice(cut + SEP.length).trim();
  if (!name || !fabricName) return null;
  return { name, fabricName, widthFt: Number(m[1]), heightFt: Number(m[2]), fullnessPct: Number(m[3]) };
}

const GRID_RE = new RegExp(
  `^(.+) \\((${GRID_CURTAIN_TYPES.join("|")})\\) · (\\d+(?:\\.\\d+)?)×(\\d+(?:\\.\\d+)?) ft · (?:(\\d+)% fullness|flat) · (.+)$`
);

/** grid-bom `curtainDesc`: `<name> (<type>) · <W>×<H> ft · <F>% fullness|flat · <fabric>`. */
export function parseGridCurtainDesc(desc: string): (ParsedEstimatorDesc & { gridType: GridCurtainType }) | null {
  const m = GRID_RE.exec((desc || "").trim());
  if (!m) return null;
  return {
    name: m[1].trim(),
    gridType: m[2] as GridCurtainType,
    widthFt: Number(m[3]),
    heightFt: Number(m[4]),
    fullnessPct: m[5] ? Number(m[5]) : 0,
    fabricName: m[6].trim(),
  };
}
```

- [ ] **Step 5: Create `src/lib/curtain-cut-sheets/track-link.ts`:**

```ts
/**
 * Curtain ↔ track link (#292 decision 5, spec §2.2). Pure.
 * By key: a track line and a curtain line sharing `curtainTrackKey` link,
 * across sections. Fallback for quotes saved before #292: a key-less curtain
 * links to the item right after it in the SAME section when that item is a
 * track line with no key of its own. One track per curtain: a second curtain
 * naming the same key is returned in `duplicates` (staff warning) and falls
 * back to its own picked mount.
 */
import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";

export function newCurtainTrackKey(curtainLineId: number): string {
  return `ct-${curtainLineId}`;
}

export type CurtainTrackLinks = { links: Map<SpecItem, SpecItem>; duplicates: SpecItem[] };

export function linkCurtainTracks(sections: readonly SpecSection[]): CurtainTrackLinks {
  const trackByKey = new Map<string, SpecItem>();
  for (const sec of sections) {
    for (const it of sec.items || []) {
      if (it.track && it.curtainTrackKey && !trackByKey.has(it.curtainTrackKey)) trackByKey.set(it.curtainTrackKey, it);
    }
  }
  const links = new Map<SpecItem, SpecItem>();
  const used = new Set<SpecItem>();
  const duplicates: SpecItem[] = [];
  for (const sec of sections) {
    const items = sec.items || [];
    items.forEach((it, i) => {
      if (!it.curtain) return;
      let track: SpecItem | undefined;
      if (it.curtainTrackKey) track = trackByKey.get(it.curtainTrackKey);
      else {
        const next = items[i + 1];
        if (next && next.track && !next.curtainTrackKey) track = next;
      }
      if (!track) return;
      if (used.has(track)) {
        duplicates.push(it);
        return;
      }
      used.add(track);
      links.set(it, track);
    });
  }
  return { links, duplicates };
}
```

- [ ] **Step 6: Add the optional fields.**
  - `src/app/(app)/estimator/types.ts`, inside `SpecItem`, directly after `laborMobKey?: string;`:
    ```ts
    /** #292: shared by a curtain line and the track line that hangs it (laborMobKey idiom) — "ct-<curtain line id at add time>". */
    curtainTrackKey?: string;
    ```
  - `src/lib/portal-cart-types.ts`: add `import type { CurtainBottomFinish, CurtainMountTypeId, CurtainTopFinish } from "@/lib/curtain-cut-sheets/vocab";` and inside `CurtainRequest` after `fullness`:
    ```ts
    /** #292 — staff Estimator only; the portal never sets these and cleanCurtainRequest never copies them into a cart. */
    topFinish?: CurtainTopFinish;
    bottomFinish?: CurtainBottomFinish;
    /** Used only when no track is linked. */
    mountType?: CurtainMountTypeId;
    ```
  - `src/lib/design/grid-bom.ts`: add the same type import and, inside `GridCurtain` after `specKey?: string;`:
    ```ts
    /** #292 — cut-sheet finishes + mount, set by the drop dialog; absent = GRID_CURTAIN_DEFAULTS for the type. */
    topFinish?: CurtainTopFinish;
    bottomFinish?: CurtainBottomFinish;
    mountType?: CurtainMountTypeId;
    ```
  - `src/lib/stores/catalog.ts`, inside `CatalogPart` after `curtainAreaRate?: number;`:
    ```ts
    /** #292 — Fabric parts only: flame rating as printed on cut sheets (e.g. "NFPA 701 (IFR)"), ≤ 120 chars. Written only through mergeUpsert. */
    flameRating?: string;
    ```
  Do **not** touch `cleanCurtainRequest` (it already rebuilds from the original seven keys).

- [ ] **Step 7: Run to verify it passes.** Run the Gates. Expected: `tsc` 0; PASS = 10,378 + 20; 0 FAIL. eslint: `npx eslint src/lib/curtain-cut-sheets/vocab.ts src/lib/curtain-cut-sheets/parse.ts src/lib/curtain-cut-sheets/track-link.ts "src/app/(app)/estimator/types.ts" src/lib/portal-cart-types.ts src/lib/design/grid-bom.ts src/lib/stores/catalog.ts`.

- [ ] **Step 8: Commit.**

```bash
git add src/lib/curtain-cut-sheets "src/app/(app)/estimator/types.ts" src/lib/portal-cart-types.ts src/lib/design/grid-bom.ts src/lib/stores/catalog.ts scripts/test-review-and-spec.ts
git commit -m "feat(cutsheets): #292 vocabulary, desc parsers, curtain-track link

test:specs <N> PASS / 0 FAIL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Drawing primitives — elevation geometry + mount-detail library + `ShapeSvg`

**Files:**
- Create: `src/lib/curtain-cut-sheets/shapes.ts`, `src/lib/curtain-cut-sheets/geometry.ts`, `src/lib/curtain-cut-sheets/mount-details.ts`, `src/components/cutsheets/shape-svg.tsx`
- Test: `scripts/test-review-and-spec.ts` (append to the `#292` block)

**Interfaces:**
- Consumes: `vocab.ts` (Task 1).
- Produces:
  - `shapes.ts`: `type Shape` (union with `kind: "line" | "rect" | "circle" | "path" | "text"` and optional `tag: "panel" | "pleat" | "mark" | "dim" | "band"`), `type ShapeLabel = { x; y; text; anchor?: "start" | "end"; leaderTo?: [number, number] }`.
  - `geometry.ts`: `ftIn(ft)`, `inchLabel(inches)`, `ARCH_SCALES`, `ELEV_DIM_IN` (0.6), `ELEV_GAP_IN` (0.5), `ELEV_TEXT_IN`, `type SizedPanel = CurtainSize & { qty?: number }`, `drawnPanels(sizes)`, `pickScale(sizes, box)`, `topMarks(widthFt, maxSpacingIn): { count; spacingIn }`, `elevation(input): { scale: string; shapes: Shape[] }` where input = `{ sizes: readonly SizedPanel[]; fullnessPct; top; bottom; markSpacingIn; markLabel: "Grommets" | "Carriers"; box: { wIn; hIn } }`.
  - `mount-details.ts`: `MOUNT_DETAIL_VIEWBOX = { w: 240, h: 300 }`, `TRACK_OTHER_NOTE`, `type MountDetail = { title: string; shapes: Shape[]; labels: ShapeLabel[]; note?: string }`, `mountDetail(key: CurtainMountKey): MountDetail`.
  - `shape-svg.tsx`: `ShapeSvg({ shapes, labels?, viewBox, idPrefix, hatch, labelSize?, style?, title? })`.

- [ ] **Step 1: Append the failing checks** to the `#292` block:

```ts
import { elevation as c292Elev, ftIn as c292FtIn, pickScale as c292Pick, topMarks as c292Marks } from "@/lib/curtain-cut-sheets/geometry";
import { mountDetail as c292Detail, TRACK_OTHER_NOTE as c292OtherNote } from "@/lib/curtain-cut-sheets/mount-details";
// ---- geometry ----
{
  const m20 = c292Marks(20, 12);
  ok(m20.count === 21 && m20.spacingIn === 12, "#292 geometry: topMarks(20, 12) → 21 marks at 12\"");
  const m205 = c292Marks(20.5, 12);
  ok(m205.count === 22 && m205.spacingIn <= 12 && Math.abs(m205.spacingIn * 21 - 246) < 1e-9, "#292 geometry: topMarks(20.5, 12) → 22 marks at ≤ 12\", both ends marked");
  ok(c292Marks(0, 12).count === 0 && c292Marks(20, 0).count === 0, "#292 geometry: topMarks of a zero width (or spacing) is 0 marks");
  ok([c292FtIn(21.5), c292FtIn(18), c292FtIn(0.75), c292FtIn(10.999), c292FtIn(6.0208)].join("|") === `21'-6"|18'-0"|0'-9"|11'-0"|6'-0 1/4"`,
    "#292 geometry: ftIn rounds to the nearest 1/4\" (spec §2.4 cases)");
  ok(c292Pick([{ widthFt: 20, heightFt: 18 }], { wIn: 6, hIn: 4 }).label === `1/8"=1'-0"`, "#292 geometry: pickScale picks the largest architectural scale that fits");
  ok(c292Pick([{ widthFt: 2, heightFt: 2 }], { wIn: 6, hIn: 4 }).label === `1"=1'-0"`, "#292 geometry: a small drop draws at 1\"=1'-0\"");
  ok(c292Pick([{ widthFt: 200, heightFt: 100 }], { wIn: 6, hIn: 4 }).label === `1/16"=1'-0"`, "#292 geometry: an oversize drop falls back to the smallest scale");
  const base = { fullnessPct: 50, top: "grommets" as const, bottom: "chain" as const, markSpacingIn: 12, markLabel: "Grommets" as const, box: { wIn: 4.6, hIn: 3.9 } };
  const three = [{ widthFt: 20, heightFt: 18, qty: 2 }, { widthFt: 10, heightFt: 18, qty: 1 }, { widthFt: 6, heightFt: 18, qty: 4 }];
  const e3 = c292Elev({ ...base, sizes: three });
  const texts = (e: { shapes: Array<{ kind: string; text?: string }> }) => e.shapes.filter((s) => s.kind === "text").map((s) => s.text as string);
  ok(e3.shapes.filter((s) => s.tag === "panel").length === 3 && !texts(e3).some((t) => t.startsWith("Typical")), "#292 geometry: up to 3 sizes are drawn side by side");
  ok(e3.shapes.filter((s) => s.tag === "mark").length === 21 + 11 + 7 && texts(e3).includes(`Grommets @ 12" o.c. max (21)`) && texts(e3).includes("Qty 2"),
    "#292 geometry: a grommet at every mark per panel, the o.c. label, and each size's qty");
  const e4 = c292Elev({ ...base, sizes: [...three, { widthFt: 4, heightFt: 18, qty: 1 }] });
  ok(e4.shapes.filter((s) => s.tag === "panel").length === 1 && texts(e4).includes("Typical — 4 sizes, see schedule"), "#292 geometry: 4+ sizes draw only the largest, captioned Typical");
  const flat = c292Elev({ ...base, fullnessPct: 0, sizes: three });
  ok(flat.shapes.every((s) => s.tag !== "pleat") && e3.shapes.some((s) => s.tag === "pleat"), "#292 geometry: pleat lines only when there is fullness");
}
// ---- mount details ----
{
  const keys = [...c292MountTypes.map((t) => t.id), "track-other" as const];
  ok(keys.every((k) => { const d = c292Detail(k); return !!d.title && d.shapes.length > 0 && d.labels.length >= 1; }), "#292 details: every mount type (and track-other) has a titled detail with ≥ 1 label");
  ok(c292Detail("track-other").note === c292OtherNote && c292OtherNote === "Track mounting per manufacturer's instructions" && !c292Detail("tie-batten").note,
    "#292 details: track-other carries the manufacturer's-instructions note");
}
```

- [ ] **Step 2: Run to verify it fails** (`npm run test:specs 2>&1 | tail -5`) — Expected: `Cannot find module '@/lib/curtain-cut-sheets/geometry'`.

- [ ] **Step 3: Create `src/lib/curtain-cut-sheets/shapes.ts`:**

```ts
/** Curtain cut sheets (#292) — drawing primitives. Pure data; components/cutsheets/shape-svg draws them. */
export type Stroke = "thin" | "med" | "heavy";
export type Fill = "none" | "tone" | "hatch" | "solid";
type Tagged = { tag?: "panel" | "pleat" | "mark" | "dim" | "band" };
export type Shape = Tagged &
  (
    | { kind: "line"; x1: number; y1: number; x2: number; y2: number; stroke?: Stroke; dash?: boolean }
    | { kind: "rect"; x: number; y: number; w: number; h: number; stroke?: Stroke; fill?: Fill; dash?: boolean }
    | { kind: "circle"; cx: number; cy: number; r: number; stroke?: Stroke; fill?: Fill }
    | { kind: "path"; d: string; stroke?: Stroke; fill?: Fill; dash?: boolean }
    | { kind: "text"; x: number; y: number; text: string; size: number; anchor?: "start" | "middle" | "end"; bold?: boolean; rotate?: number }
  );
/** A plain-language callout; "\n" breaks lines. */
export type ShapeLabel = { x: number; y: number; text: string; anchor?: "start" | "end"; leaderTo?: [number, number] };
```

- [ ] **Step 4: Create `src/lib/curtain-cut-sheets/geometry.ts`:**

```ts
/**
 * Curtain cut sheets (#292) — the front elevation as pure shapes in PAPER
 * INCHES (spec §2.4), drawn from finished dimensions (decision 2). Returns
 * shapes, never JSX.
 */
import type { Shape } from "./shapes";
import type { CurtainSize } from "./parse";
import type { CurtainBottomFinish, CurtainTopFinish } from "./vocab";

export type SizedPanel = CurtainSize & { qty?: number };

const FRACTIONS = ["", "1/4", "1/2", "3/4"];

/** Feet → ft-in to the nearest 1/4": 21.5 → 21'-6"; 0.75 → 0'-9"; 6.0208 → 6'-0 1/4". */
export function ftIn(ft: number): string {
  const q = Math.round((Number.isFinite(ft) ? ft : 0) * 48);
  const sign = q < 0 ? "-" : "";
  const a = Math.abs(q);
  const feet = Math.floor(a / 48);
  const rem = a - feet * 48;
  const frac = FRACTIONS[rem % 4];
  return `${sign}${feet}'-${Math.floor(rem / 4)}${frac ? " " + frac : ""}"`;
}

/** Inches → `12"`, `11 3/4"` (nearest 1/4"). */
export function inchLabel(inches: number): string {
  const q = Math.max(0, Math.round((Number.isFinite(inches) ? inches : 0) * 4));
  const frac = FRACTIONS[q % 4];
  return `${Math.floor(q / 4)}${frac ? " " + frac : ""}"`;
}

/** Largest first. */
export const ARCH_SCALES: ReadonlyArray<{ label: string; inPerFt: number }> = [
  { label: `1"=1'-0"`, inPerFt: 1 },
  { label: `3/4"=1'-0"`, inPerFt: 0.75 },
  { label: `1/2"=1'-0"`, inPerFt: 0.5 },
  { label: `3/8"=1'-0"`, inPerFt: 0.375 },
  { label: `1/4"=1'-0"`, inPerFt: 0.25 },
  { label: `3/16"=1'-0"`, inPerFt: 0.1875 },
  { label: `1/8"=1'-0"`, inPerFt: 0.125 },
  { label: `3/32"=1'-0"`, inPerFt: 0.09375 },
  { label: `1/16"=1'-0"`, inPerFt: 0.0625 },
];
/** Room kept on every side of the drawn panels for dimensions and labels, in. */
export const ELEV_DIM_IN = 0.6;
/** Space between side-by-side panels, in. */
export const ELEV_GAP_IN = 0.5;
export const ELEV_TEXT_IN = 0.085;
const TOP_BAND_FT = 3.5 / 12; // webbing (Open question 5)
const BOTTOM_BAND_FT = 4 / 12; // hem / pocket (Open question 5)
const MIN_BAND_IN = 0.06;

/** Up to 3 distinct sizes, largest area first; more than 3 → only the largest, flagged `typical`. */
export function drawnPanels(sizes: readonly SizedPanel[]): { panels: SizedPanel[]; typical: boolean } {
  const sorted = sizes
    .filter((s) => s.widthFt > 0 && s.heightFt > 0)
    .slice()
    .sort((a, b) => b.widthFt * b.heightFt - a.widthFt * a.heightFt || b.widthFt - a.widthFt);
  return sorted.length > 3 ? { panels: sorted.slice(0, 1), typical: true } : { panels: sorted, typical: false };
}

/** The largest architectural scale at which every drawn panel fits the box; the smallest scale when none does. */
export function pickScale(sizes: readonly SizedPanel[], box: { wIn: number; hIn: number }): { label: string; inPerFt: number } {
  const { panels } = drawnPanels(sizes);
  const sumW = panels.reduce((a, p) => a + p.widthFt, 0);
  const maxH = panels.reduce((a, p) => Math.max(a, p.heightFt), 0);
  const availW = box.wIn - 2 * ELEV_DIM_IN;
  const availH = box.hIn - 2 * ELEV_DIM_IN;
  for (const s of ARCH_SCALES) {
    const w = sumW * s.inPerFt + Math.max(0, panels.length - 1) * ELEV_GAP_IN;
    if (w <= availW + 1e-9 && maxH * s.inPerFt <= availH + 1e-9) return s;
  }
  return ARCH_SCALES[ARCH_SCALES.length - 1];
}

/** Evenly spaced marks, both ends always marked: count = ceil(W·12 ÷ s) + 1, at W·12 ÷ (count − 1) ≤ s. */
export function topMarks(widthFt: number, maxSpacingIn: number): { count: number; spacingIn: number } {
  const wIn = widthFt * 12;
  if (!(wIn > 0) || !(maxSpacingIn > 0)) return { count: 0, spacingIn: 0 };
  const count = Math.ceil(wIn / maxSpacingIn - 1e-9) + 1;
  return { count, spacingIn: wIn / (count - 1) };
}

export function elevation(input: {
  sizes: readonly SizedPanel[];
  fullnessPct: number;
  top: CurtainTopFinish;
  bottom: CurtainBottomFinish;
  markSpacingIn: number;
  markLabel: "Grommets" | "Carriers";
  box: { wIn: number; hIn: number };
}): { scale: string; shapes: Shape[] } {
  const { panels, typical } = drawnPanels(input.sizes);
  const scale = pickScale(input.sizes, input.box);
  const s = scale.inPerFt;
  const shapes: Shape[] = [];
  const y = ELEV_DIM_IN;
  let x = ELEV_DIM_IN;
  let maxH = 0;
  for (const p of panels) {
    const w = p.widthFt * s;
    const h = p.heightFt * s;
    maxH = Math.max(maxH, h);
    const topH = Math.max(MIN_BAND_IN, TOP_BAND_FT * s);
    const botH = Math.max(MIN_BAND_IN, BOTTOM_BAND_FT * s);
    shapes.push({ kind: "rect", tag: "panel", x, y, w, h, stroke: "heavy" });
    // fullness: thin pleat lines at half the mark spacing; none when flat
    if (input.fullnessPct > 0) {
      const step = Math.max(0.04, (input.markSpacingIn / 2 / 12) * s);
      for (let px = x + step, n = 0; px < x + w - 1e-6 && n < 400; px += step, n++) {
        shapes.push({ kind: "line", tag: "pleat", x1: px, y1: y + topH, x2: px, y2: y + h - botH, stroke: "thin" });
      }
    }
    // top band
    shapes.push({ kind: "rect", tag: "band", x, y, w, h: topH, stroke: "med", fill: input.top === "hook-loop" ? "hatch" : "tone" });
    if (input.top === "grommets") {
      const m = topMarks(p.widthFt, input.markSpacingIn);
      const r = Math.min(topH * 0.3, 0.03);
      for (let i = 0; i < m.count; i++) {
        shapes.push({ kind: "circle", tag: "mark", cx: x + ((i * m.spacingIn) / 12) * s, cy: y + topH / 2, r, stroke: "thin", fill: "none" });
      }
      if (m.count >= 2) {
        const x2 = x + (m.spacingIn / 12) * s;
        const dy = y - 0.1;
        shapes.push(
          { kind: "line", tag: "dim", x1: x, y1: dy, x2, y2: dy, stroke: "thin" },
          { kind: "line", tag: "dim", x1: x, y1: dy - 0.04, x2: x, y2: y, stroke: "thin" },
          { kind: "line", tag: "dim", x1: x2, y1: dy - 0.04, x2, y2: y, stroke: "thin" },
          { kind: "text", x, y: dy - 0.06, text: `${input.markLabel} @ ${inchLabel(input.markSpacingIn)} o.c. max (${m.count})`, size: ELEV_TEXT_IN }
        );
      }
    } else {
      shapes.push({ kind: "text", x, y: y - 0.1, text: input.top === "pipe-pocket" ? "Pipe pocket" : "Hook-and-loop", size: ELEV_TEXT_IN });
    }
    // bottom
    const by = y + h - botH;
    if (input.bottom === "hem") {
      shapes.push({ kind: "line", tag: "band", x1: x, y1: by, x2: x + w, y2: by, stroke: "thin" });
    } else {
      shapes.push({ kind: "rect", tag: "band", x, y: by, w, h: botH, stroke: "med", fill: "tone" });
      if (input.bottom === "chain") shapes.push({ kind: "line", tag: "band", x1: x, y1: by + botH / 2, x2: x + w, y2: by + botH / 2, stroke: "thin", dash: true });
    }
    const bottomLabel = input.bottom === "chain" ? "Chain pocket" : input.bottom === "pipe-pocket" ? "Pipe pocket" : "Hem";
    shapes.push({ kind: "text", x: x + w / 2, y: by - 0.04, text: bottomLabel, size: ELEV_TEXT_IN * 0.85, anchor: "middle" });
    // overall width, then the qty of this size, under the panel
    const wy = y + h + 0.16;
    shapes.push(
      { kind: "line", tag: "dim", x1: x, y1: wy, x2: x + w, y2: wy, stroke: "thin" },
      { kind: "line", tag: "dim", x1: x, y1: y + h + 0.03, x2: x, y2: wy + 0.04, stroke: "thin" },
      { kind: "line", tag: "dim", x1: x + w, y1: y + h + 0.03, x2: x + w, y2: wy + 0.04, stroke: "thin" },
      { kind: "text", x: x + w / 2, y: wy + 0.13, text: ftIn(p.widthFt), size: ELEV_TEXT_IN, anchor: "middle" },
      { kind: "text", x: x + w / 2, y: wy + 0.26, text: `Qty ${p.qty ?? 1}`, size: ELEV_TEXT_IN, anchor: "middle", bold: true }
    );
    // overall height, left of the panel
    const hx = x - 0.16;
    shapes.push(
      { kind: "line", tag: "dim", x1: hx, y1: y, x2: hx, y2: y + h, stroke: "thin" },
      { kind: "line", tag: "dim", x1: hx - 0.04, y1: y, x2: x - 0.03, y2: y, stroke: "thin" },
      { kind: "line", tag: "dim", x1: hx - 0.04, y1: y + h, x2: x - 0.03, y2: y + h, stroke: "thin" },
      { kind: "text", x: hx - 0.05, y: y + h / 2, text: ftIn(p.heightFt), size: ELEV_TEXT_IN, anchor: "middle", rotate: -90 }
    );
    x += w + ELEV_GAP_IN;
  }
  if (typical) {
    shapes.push({ kind: "text", x: ELEV_DIM_IN, y: y + maxH + 0.5, text: `Typical — ${input.sizes.length} sizes, see schedule`, size: ELEV_TEXT_IN, bold: true });
  }
  return { scale: scale.label, shapes };
}
```

- [ ] **Step 5: Create `src/lib/curtain-cut-sheets/mount-details.ts`** (one pure geometry function per mount type, a fixed 240 × 300 NTS viewBox, plain-language labels, never a part number):

```ts
/**
 * Curtain cut sheets (#292) — the mounting-detail library (spec §2.5). Each
 * detail is a section through the top of the curtain in a fixed 240 × 300
 * viewBox, not to scale, with leaders to plain-language labels. Never a part
 * number: the hardware table carries those. Pure.
 */
import type { Shape, ShapeLabel } from "./shapes";
import { MOUNT_KEY_LABELS, type CurtainMountKey } from "./vocab";

export const MOUNT_DETAIL_VIEWBOX = { w: 240, h: 300 } as const;
export const TRACK_OTHER_NOTE = "Track mounting per manufacturer's instructions";
export type MountDetail = { title: string; shapes: Shape[]; labels: ShapeLabel[]; note?: string };

const lab = (x: number, y: number, text: string, to: [number, number], anchor: "start" | "end" = "start"): ShapeLabel => ({ x, y, text, leaderTo: to, anchor });
const pipe = (cx: number, cy: number, r = 14): Shape => ({ kind: "circle", cx, cy, r, stroke: "heavy", fill: "none" });

/** Webbing band + grommet at `top`, three fabric folds hanging to the bottom edge. */
function curtainBelow(top: number): Shape[] {
  return [
    { kind: "rect", x: 100, y: top, w: 40, h: 18, stroke: "med", fill: "tone" },
    { kind: "circle", cx: 120, cy: top + 9, r: 5, stroke: "med", fill: "none" },
    { kind: "path", d: `M100 ${top + 18} C 90 ${top + 70}, 110 ${top + 110}, 98 290`, stroke: "med" },
    { kind: "path", d: `M120 ${top + 18} C 112 ${top + 80}, 128 ${top + 120}, 120 290`, stroke: "thin" },
    { kind: "path", d: `M140 ${top + 18} C 150 ${top + 70}, 130 ${top + 110}, 142 290`, stroke: "med" },
  ];
}

/** Track channel at `y` (open at the bottom), carrier wheels + stem, snap hook; the curtain top sits at y + 56. */
function trackBelow(y: number): Shape[] {
  return [
    { kind: "path", d: `M100 ${y} h40 v24 h-10 v-6 h-20 v6 h-10 z`, stroke: "heavy", fill: "none" },
    { kind: "circle", cx: 112, cy: y + 12, r: 4, stroke: "med", fill: "tone" },
    { kind: "circle", cx: 128, cy: y + 12, r: 4, stroke: "med", fill: "tone" },
    { kind: "rect", x: 117, y: y + 18, w: 6, h: 18, stroke: "med", fill: "tone" },
    { kind: "path", d: `M120 ${y + 36} v8 a6 6 0 1 1 -6 6`, stroke: "med" },
  ];
}

/** The labels every tracked detail shares, for a channel at `y`. */
function trackLabels(y: number): ShapeLabel[] {
  return [
    lab(72, y + 10, "Track", [100, y + 10], "end"),
    lab(72, y + 34, "Carrier", [112, y + 16], "end"),
    lab(168, y + 44, "Snap hook", [126, y + 44]),
    lab(168, y + 66, "Webbing +\ngrommet", [140, y + 65]),
    lab(168, 250, "Curtain fabric", [142, 250]),
  ];
}

export function mountDetail(key: CurtainMountKey): MountDetail {
  const title = MOUNT_KEY_LABELS[key];
  switch (key) {
    case "track-batten":
      return {
        title,
        shapes: [
          pipe(120, 36),
          { kind: "path", d: "M104 36 a16 16 0 0 1 32 0", stroke: "med" },
          { kind: "rect", x: 106, y: 48, w: 28, h: 10, stroke: "med", fill: "tone" },
          { kind: "line", x1: 120, y1: 58, x2: 120, y2: 90, stroke: "med" },
          ...trackBelow(90),
          ...curtainBelow(146),
        ],
        labels: [lab(168, 26, "Pipe batten\n(by others)", [134, 36]), lab(168, 62, "Batten clamp", [134, 53]), ...trackLabels(90)],
      };
    case "track-ceiling":
      return {
        title,
        shapes: [
          { kind: "rect", x: 20, y: 14, w: 200, h: 18, stroke: "thin", fill: "hatch" },
          { kind: "line", x1: 20, y1: 32, x2: 220, y2: 32, stroke: "heavy" },
          { kind: "line", x1: 120, y1: 14, x2: 120, y2: 32, stroke: "thin", dash: true },
          { kind: "rect", x: 106, y: 32, w: 28, h: 10, stroke: "med", fill: "tone" },
          { kind: "line", x1: 120, y1: 42, x2: 120, y2: 90, stroke: "med" },
          ...trackBelow(90),
          ...curtainBelow(146),
        ],
        labels: [lab(168, 10, "Ceiling\n(anchor by others)", [150, 24]), lab(168, 50, "Ceiling hanger / clip", [134, 38]), ...trackLabels(90)],
      };
    case "track-structure":
      return {
        title,
        shapes: [
          { kind: "rect", x: 70, y: 14, w: 100, h: 8, stroke: "heavy", fill: "tone" },
          { kind: "rect", x: 116, y: 22, w: 8, h: 24, stroke: "med", fill: "tone" },
          { kind: "rect", x: 70, y: 46, w: 100, h: 8, stroke: "heavy", fill: "tone" },
          { kind: "rect", x: 100, y: 54, w: 40, h: 10, stroke: "med", fill: "none" },
          { kind: "line", x1: 120, y1: 64, x2: 120, y2: 110, stroke: "med", dash: true },
          { kind: "text", x: 126, y: 92, text: "length varies", size: 8 },
          ...trackBelow(110),
          ...curtainBelow(166),
        ],
        labels: [lab(178, 10, "Steel beam\n(by others)", [170, 30]), lab(178, 62, "Beam clamp", [140, 59]), lab(72, 88, "Drop rod / cable", [120, 88], "end"), ...trackLabels(110)],
      };
    case "tie-batten":
      return {
        title,
        shapes: [
          pipe(120, 60),
          { kind: "path", d: "M120 159 C 152 140, 152 74, 134 62 A 14 14 0 1 0 106 64 C 90 92, 98 140, 120 159", stroke: "med" },
          { kind: "path", d: "M146 100 c 8 -6 12 2 0 4 c -12 2 -8 10 0 4", stroke: "thin" },
          ...curtainBelow(150),
        ],
        labels: [
          lab(168, 44, "Pipe batten\n(by others)", [134, 60]),
          lab(168, 100, "Tie line\n(bow knot)", [148, 100]),
          lab(168, 166, "Webbing +\ngrommet", [140, 159]),
          lab(168, 250, "Curtain fabric", [142, 250]),
        ],
      };
    case "wall-hookloop":
      return {
        title,
        shapes: [
          { kind: "rect", x: 20, y: 10, w: 28, h: 280, stroke: "med", fill: "hatch" },
          { kind: "rect", x: 48, y: 30, w: 26, h: 96, stroke: "med", fill: "tone" },
          { kind: "rect", x: 74, y: 40, w: 6, h: 76, stroke: "heavy", fill: "tone" },
          { kind: "rect", x: 80, y: 40, w: 6, h: 76, stroke: "med", fill: "none" },
          { kind: "path", d: "M86 40 C 110 90, 92 150, 104 290", stroke: "med" },
          { kind: "path", d: "M86 116 C 120 160, 100 220, 122 290", stroke: "med" },
        ],
        labels: [
          lab(168, 20, "Wall (by others)", [48, 20]),
          lab(168, 52, "Header board\n(by others)", [74, 60]),
          lab(168, 92, "Hook strip on header", [80, 90]),
          lab(168, 130, "Loop strip sewn\nto the curtain", [86, 110]),
          lab(168, 230, "Curtain fabric", [110, 230]),
        ],
      };
    default:
      return {
        title,
        shapes: [...trackBelow(70), ...curtainBelow(126)],
        labels: trackLabels(70),
        note: TRACK_OTHER_NOTE,
      };
  }
}
```

- [ ] **Step 6: Create `src/components/cutsheets/shape-svg.tsx`** (no `"use client"`, no hooks — usable from server pages and from the Curtain mounts client component):

```tsx
import type { CSSProperties } from "react";
import type { Shape, ShapeLabel, Stroke, Fill } from "@/lib/curtain-cut-sheets/shapes";

/**
 * Draws #292 cut-sheet shapes. Strokes are non-scaling (px), so one shape
 * list reads the same in paper inches (elevation) or detail units (240 × 300).
 * `idPrefix` keeps the hatch pattern id unique per SVG on a page.
 */
const INK = "#16181d";
const TONE = "#eceef2";
const SW: Record<Stroke, number> = { thin: 0.6, med: 1, heavy: 1.7 };

export function ShapeSvg({
  shapes,
  labels = [],
  viewBox,
  idPrefix,
  hatch,
  labelSize = 9,
  style,
  title,
}: {
  shapes: readonly Shape[];
  labels?: readonly ShapeLabel[];
  viewBox: string;
  idPrefix: string;
  /** Hatch pitch in viewBox units (0.05 for inches, 6 for detail units). */
  hatch: number;
  labelSize?: number;
  style?: CSSProperties;
  title?: string;
}) {
  const hatchId = `${idPrefix}-hatch`;
  const fill = (f: Fill | undefined) => (f === "tone" ? TONE : f === "hatch" ? `url(#${hatchId})` : f === "solid" ? INK : "none");
  const stroke = (s: Stroke | undefined, dash?: boolean) => ({
    stroke: INK,
    strokeWidth: SW[s ?? "thin"],
    vectorEffect: "non-scaling-stroke" as const,
    strokeDasharray: dash ? "4 3" : undefined,
  });
  const text = (key: string, x: number, y: number, t: string, size: number, anchor: string, bold?: boolean, rotate?: number) => (
    <text key={key} x={x} y={y} fontSize={size} textAnchor={anchor} fontWeight={bold ? 700 : 400} fill={INK} fontFamily="var(--font-ui), system-ui, sans-serif" transform={rotate ? `rotate(${rotate} ${x} ${y})` : undefined}>
      {t.split("\n").map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : size * 1.15}>
          {line}
        </tspan>
      ))}
    </text>
  );
  return (
    <svg viewBox={viewBox} style={style} role="img" aria-label={title} preserveAspectRatio="xMinYMin meet">
      <defs>
        <pattern id={hatchId} patternUnits="userSpaceOnUse" width={hatch} height={hatch} patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={hatch} stroke={INK} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
        </pattern>
      </defs>
      {shapes.map((s, i) => {
        switch (s.kind) {
          case "line":
            return <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...stroke(s.stroke, s.dash)} />;
          case "rect":
            return <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} fill={fill(s.fill)} {...stroke(s.stroke, s.dash)} />;
          case "circle":
            return <circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill={fill(s.fill)} {...stroke(s.stroke)} />;
          case "path":
            return <path key={i} d={s.d} fill={fill(s.fill)} {...stroke(s.stroke, s.dash)} />;
          case "text":
            return text(String(i), s.x, s.y, s.text, s.size, s.anchor ?? "start", s.bold, s.rotate);
        }
      })}
      {labels.map((l, i) => (
        <g key={`l${i}`}>
          {l.leaderTo && <line x1={l.anchor === "end" ? l.x + 2 : l.x - 2} y1={l.y - labelSize * 0.35} x2={l.leaderTo[0]} y2={l.leaderTo[1]} {...stroke("thin")} />}
          {text(`lt${i}`, l.x, l.y, l.text, labelSize, l.anchor ?? "start")}
        </g>
      ))}
    </svg>
  );
}
```

- [ ] **Step 7: Run the Gates.** Expected PASS = Task 1 count + 13, 0 FAIL. eslint the four new files.

- [ ] **Step 8: Commit** — `git add src/lib/curtain-cut-sheets src/components/cutsheets scripts/test-review-and-spec.ts` then `git commit -m "feat(cutsheets): #292 elevation geometry, mount-detail library, ShapeSvg"` (body: real PASS count + the Co-Authored-By line).

---

### Task 3: Curtain-mount rules (pure) + the collector

**Files:**
- Create: `src/lib/curtain-mounts.ts`, `src/lib/curtain-cut-sheets/estimator-curtains.ts`, `src/lib/curtain-cut-sheets/collect.ts`
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:**
- Consumes: Task 1 (vocab, parse, track-link), Task 2 (`topMarks`), `curtainCost` (`src/lib/design/curtain-pricing.ts:125`), `computeSetWeight` / `DEFAULT_WEIGHTS` / `fabricFromPart` (`src/lib/design/steel.ts`), `CHAIN_JACK` / `CHAIN_NONE` (`src/lib/design/goods.ts:36`), `hasOption` / `optionSlice` (`src/lib/design/grid-options.ts`), `isRewardCreditItem` (`src/lib/rewards/credit-line.ts`).
- Produces:
  - `src/lib/curtain-mounts.ts`: `CURTAIN_MOUNTS_BLOB = "curtain_mount_hardware"`, `MOUNT_ROWS_MAX` (30), `MOUNT_QTY_MAX` (1000), `type MountQtyRule`, `type MountHardwareRow`, `type CurtainMountHardware`, `MOUNT_RULE_LABELS`, `sanitizeMountRows(raw: unknown): MountHardwareRow[]`, `sanitizeCurtainMounts(raw: unknown): Partial<Record<CurtainMountTypeId, CurtainMountHardware>>`, `mountRowQty(rule, curtain: { widthFt: number; marks: number }): number`.
  - `estimator-curtains.ts`: constants `CURTAIN_UNREADABLE`, `CURTAIN_ZERO_SIZE`, `GRID_DESIGN_GONE`, `TRACK_SERIES_GONE_WARNING`; types `CurtainFabricRow`, `CutSheetFabric`, `CutSheetMount`, `CurtainLineRef`, `CutSheetCurtain`, `CurtainsRead`, `GridProjectLite`; functions `estimatorCurtains`, `gridCurtains`, `readCurtains(spec: unknown, fabrics, trackSeries, project: GridProjectLite | null): CurtainsRead`, `curtainTypeKey(c): string`, `countCutSheetTypes(spec: unknown, fabrics: readonly CurtainFabricRow[], trackSeries: readonly TrackSeries[]): number`.
  - `collect.ts`: `type CutSheetHardware`, `type CurtainType`, `type CollectInput`, `type CollectResult`, `sewnAreaEach(c)`, `weightEach(c)`, `collectCurtainTypes(input: CollectInput): CollectResult`.

- [ ] **Step 1: Append the failing checks:**

```ts
import { mountRowQty as c292RowQty, sanitizeCurtainMounts as c292SanitizeMounts } from "@/lib/curtain-mounts";
import { countCutSheetTypes as c292Count, GRID_DESIGN_GONE as c292GridGone } from "@/lib/curtain-cut-sheets/estimator-curtains";
import { collectCurtainTypes as c292CollectTypes, type CollectInput as C292Input } from "@/lib/curtain-cut-sheets/collect";
import { curtainCost as c292CurtainCost } from "@/lib/design/curtain-pricing";
import { computeSetWeight as c292SetWeight, DEFAULT_WEIGHTS as c292Weights, fabricFromPart as c292FabFrom } from "@/lib/design/steel";
import { CHAIN_JACK as c292ChainJack } from "@/lib/design/goods";
import type { TrackSeries as C292Series } from "@/lib/track-series";

const C292_FABS = [
  { sku: "FAB-CH25", desc: "Charisma Velour 25 oz", oz: 25, ozBasis: "lin-yd" as const, boltWidthIn: 54, flameRating: "NFPA 701 (IFR)" },
  { sku: "FAB-EN22", desc: "Encore Velour 22 oz", oz: 22, ozBasis: "lin-yd" as const, boltWidthIn: 54 },
  { sku: "FAB-NOOZ", desc: "Mystery Scrim" },
];
const C292_SERIES = [{ id: "adc-280-black", name: "ADC 280 Black", manufacturer: "ADC", stickLengthFt: 22, carrierSpacingIn: 12, hangerSpacingFt: 7, overlapFt: 2, parts: {}, active: true }] as C292Series[];
const C292_DESC = "Main Drape — Charisma Velour 25 oz, 21.5'W × 18'H, 50% fullness";
const c292Ci = (over: Record<string, unknown> = {}) => ({ name: "Main Drape", fabricSku: "FAB-CH25", fabricName: "Charisma Velour 25 oz", qty: "9", width: "21.5", height: "18", fullness: "50" as const, ...over });
const c292Cur = (id: number, over: Partial<C292Item> = {}): Partial<C292Item> & { id: number } => ({ id, desc: C292_DESC, qty: 2, curtain: true, ...over });
const c292Trk = (id: number, over: Partial<C292Item> = {}): Partial<C292Item> & { id: number } => ({
  id, sku: "TRK-ADC-280-BLACK", desc: "Main track", unit: "lot", track: { ...C292_TRACK },
  components: [
    { sku: "ADC-280-22", label: "Track (22' stick)", role: "other", qty: 4, unit: "ea", cost: 1, price: 2 },
    { sku: "ADC-2802", label: "Carrier", role: "other", qty: 40, unit: "ea", cost: 1, price: 2 },
  ],
  ...over,
});
const c292Collect = (sections: C292Section[], extra: Partial<C292Input> = {}) =>
  c292CollectTypes({ quote: { spec: { sections, mobs: [] } }, fabrics: C292_FABS, trackSeries: C292_SERIES, mounts: {}, partInfo: new Map(), grid: null, ...extra });

// ---- mount rules ----
{
  ok(c292RowQty({ kind: "perCurtain", qty: 2 }, { widthFt: 21.5, marks: 23 }) === 2, "#292 mounts: perCurtain is qty per curtain");
  ok(c292RowQty({ kind: "perFtWidth", qty: 1, everyFt: 5 }, { widthFt: 21.5, marks: 23 }) === 5, "#292 mounts: perFtWidth is qty × ceil(W ÷ everyFt)");
  ok(c292RowQty({ kind: "perMark", qty: 1 }, { widthFt: 21.5, marks: 23 }) === 23, "#292 mounts: perMark is qty × top-finish marks");
  const s = c292SanitizeMounts({
    "tie-batten": { rows: [
      { sku: " TIE ", rule: { kind: "perMark", qty: "1" } }, { sku: "", rule: { kind: "perCurtain", qty: 1 } },
      { sku: "A", rule: { kind: "bogus", qty: 1 } }, { sku: "B", rule: { kind: "perCurtain", qty: 0 } },
      { sku: "C", rule: { kind: "perCurtain", qty: 1001 } }, { sku: "D", rule: { kind: "perFtWidth", qty: 1, everyFt: 0 } },
    ] },
    "track-other": { rows: [{ sku: "X", rule: { kind: "perCurtain", qty: 1 } }] },
    nonsense: { rows: [] },
    "wall-hookloop": { rows: Array.from({ length: 40 }, (_, i) => ({ sku: `W${i}`, rule: { kind: "perCurtain", qty: 1 } })) },
  });
  ok(s["tie-batten"]?.rows.length === 1 && s["tie-batten"].rows[0].sku === "TIE" && s["tie-batten"].rows[0].rule.qty === 1,
    "#292 mounts: sanitize drops blank SKUs, unknown rule kinds, qty ≤ 0 / > 1,000 and everyFt ≤ 0; trims SKUs, reads numeric strings");
  ok(!("track-other" in s) && !("nonsense" in s) && s["wall-hookloop"]?.rows.length === 30, "#292 mounts: sanitize drops unknown mount ids (track-other included) and caps a type at 30 rows");
}
// ---- collector: Estimator ----
{
  const structured = c292Collect([c292Sec("s1", [c292Cur(1, { desc: "edited by hand", curtainInputs: c292Ci() })])]);
  ok(structured.types.length === 1 && structured.unreadable.length === 0 && structured.types[0].sizes[0].widthFt === 21.5, "#292 collect: curtainInputs are read before the desc");
  ok(structured.types[0].totalQty === 2, "#292 collect: the line qty wins over curtainInputs.qty (informational only)");
  const merged = c292Collect([c292Sec("s1", [c292Cur(1, { curtainInputs: c292Ci() }), c292Cur(2, { qty: 3 })])]);
  ok(merged.types.length === 1 && merged.types[0].totalQty === 5 && merged.types[0].sizes.length === 1 && merged.types[0].sizes[0].qty === 5,
    "#292 collect: identical curtains merge into one type (qty summed, sizes merged)");
  const split = c292Collect([c292Sec("s1", [
    c292Cur(1),
    c292Cur(2, { desc: "Main Drape — Charisma Velour 25 oz, 21.5'W × 18'H, 75% fullness" }),
    c292Cur(3, { curtainInputs: c292Ci({ bottomFinish: "hem" }) }),
    c292Cur(4, { curtainInputs: c292Ci({ mountType: "wall-hookloop" }) }),
  ])]);
  ok(split.types.length === 4, "#292 collect: a different fullness, bottom finish or mount splits into its own type");
  const opt = c292Collect([c292Sec("s1", [c292Cur(1, { option: true }), c292Cur(2)])]);
  ok(opt.types.length === 1 && opt.types[0].totalQty === 2 && opt.skippedOptional.length === 1, "#292 collect: an optional curtain line gets no sheet and is listed as left out");
  const bad = c292Collect([c292Sec("s1", [c292Cur(1, { desc: "Main Drape (black)" }), c292Cur(2, { desc: "Main Drape — Charisma Velour 25 oz, 0'W × 18'H, 50% fullness" })])]);
  ok(bad.types.length === 0 && bad.unreadable.map((u) => u.reason).join("|") === "Can't read size — edit the curtain|Size is 0 — edit the curtain",
    "#292 collect: an unparseable or zero-size line is unreadable, never guessed");
  const order = c292Collect([
    c292Sec("s1", [c292Cur(1, { desc: "Legs — Charisma Velour 25 oz, 6'W × 18'H, 50% fullness" }), c292Cur(2)]),
    c292Sec("s2", [c292Cur(3, { desc: "Border — Charisma Velour 25 oz, 40'W × 5'H, 50% fullness" })]),
  ]);
  ok(order.types.map((t) => `${t.sheetNo}:${t.title}`).join() === "CS-1:Legs,CS-2:Main Drape,CS-3:Border", "#292 collect: CS numbers follow section order, then line order");
  const twins = c292Collect([c292Sec("s1", [c292Cur(1, { desc: "Legs — Charisma Velour 25 oz, 6'W × 18'H, 50% fullness" }), c292Cur(2, { desc: "Legs — Encore Velour 22 oz, 6'W × 18'H, 50% fullness" })])]);
  ok(twins.types.map((t) => t.title).join("|") === "Legs (Charisma Velour 25 oz)|Legs (Encore Velour 22 oz)", "#292 collect: colliding titles get the fabric appended");
}
// ---- collector: hardware ----
{
  const tracked = c292Collect([c292Sec("s1", [c292Cur(1), c292Trk(2)])]);
  const t = tracked.types[0];
  ok(t.curtains[0].mount.source === "track" && t.curtains[0].mount.key === "track-batten" && t.markSpacingIn === 12,
    "#292 collect: a linked track gives the mount (from track.mounting) and the series' carrier spacing");
  ok(t.hardware.find((h) => h.sku === "ADC-2802")?.qty === 40 && t.hardware.every((h) => h.from === "track"),
    "#292 collect: track hardware is the line's stored components, counted once for a qty-2 curtain on one track");
  const over = c292Collect([c292Sec("s1", [c292Cur(1), c292Trk(2, { track: { ...C292_TRACK, carrierSpacingIn: 18 } })])]);
  ok(over.types[0].markSpacingIn === 18, "#292 collect: a line's carrier-spacing override beats the series default");
  const two = c292Collect([c292Sec("s1", [c292Cur(1, { curtainTrackKey: "ct-1" }), c292Trk(2, { curtainTrackKey: "ct-1" }), c292Cur(3, { curtainTrackKey: "ct-3" }), c292Trk(4, { curtainTrackKey: "ct-3" })])]);
  ok(two.types.length === 1 && two.types[0].hardware.find((h) => h.sku === "ADC-2802")?.qty === 80, "#292 collect: two tracks in one type sum their components by SKU");
  const gone = c292Collect([c292Sec("s1", [c292Cur(1), c292Trk(2)])], { trackSeries: [] });
  ok(gone.types[0].hardware.length === 2 && gone.types[0].warnings.includes("Track series no longer exists — hardware as quoted."),
    "#292 collect: a deleted series keeps the stored components and warns");
  const mounts = { "tie-batten": { rows: [
    { sku: "TIE", rule: { kind: "perMark" as const, qty: 1 } },
    { sku: "CLAMP", rule: { kind: "perFtWidth" as const, qty: 1, everyFt: 5 } },
    { sku: "KIT", rule: { kind: "perCurtain" as const, qty: 2 } },
  ] } };
  const partInfo = new Map([["TIE", { desc: "Tie line", unit: "ea" }]]);
  const ruled = c292Collect([c292Sec("s1", [c292Cur(1)])], { mounts, partInfo });
  const q = (sku: string) => ruled.types[0].hardware.find((h) => h.sku === sku)?.qty;
  ok(q("TIE") === 46 && q("CLAMP") === 10 && q("KIT") === 4 && ruled.types[0].hardware.find((h) => h.sku === "TIE")?.desc === "Tie line",
    "#292 collect: mount rules × curtain qty — 23 marks × 2 ties, ceil(21.5 ÷ 5) × 2 clamps, 2 × 2 kits");
  const none = c292Collect([c292Sec("s1", [c292Cur(1)])]);
  ok(none.types[0].hardware.length === 0 && none.types[0].warnings.includes("No hardware listed for Tie-line to pipe batten — Estimating Rules → Curtain mounts"),
    "#292 collect: a mount type with no rows warns and lists no hardware");
  ok(none.types[0].warnings.some((w) => w.startsWith("Mount assumed:")), "#292 collect: a defaulted mount is flagged as assumed");
}
// ---- collector: weight + area ----
{
  const t = c292Collect([c292Sec("s1", [c292Cur(1)])]).types[0];
  const fab = c292FabFrom({ desc: "Charisma Velour 25 oz", oz: 25, ozBasis: "lin-yd", boltWidthIn: 54 })!;
  const want = c292SetWeight({ name: "Main Drape", fabResolved: fab, w: 21.5, h: 18, full: 50, qty: 1, chain: c292ChainJack, batten: 0, mode: "dead" }, c292Weights).goods;
  ok(t.weightLbEach[0] === want && t.weightLbTotal === (want as number) * 2, "#292 collect: weight is computeSetWeight(...).goods for the same inputs (× qty for the total)");
  const hem = c292Collect([c292Sec("s1", [c292Cur(1, { curtainInputs: c292Ci({ bottomFinish: "hem" }) })])]).types[0];
  ok(Math.abs((t.weightLbEach[0] as number) - (hem.weightLbEach[0] as number) - 0.14 * 21.5) < 1e-9, "#292 collect: chain vs hem differs by the jack-chain weight (0.14 lb/ft × W)");
  const noOz = c292Collect([c292Sec("s1", [c292Cur(1, { desc: "Main Drape — Mystery Scrim, 21.5'W × 18'H, 50% fullness" })])]).types[0];
  ok(noOz.weightLbEach[0] === null && noOz.weightLbTotal === null && noOz.warnings.includes("Weight not set for Mystery Scrim — Catalog"), "#292 collect: a fabric with no oz weighs null and warns");
  const area = c292CurtainCost({ finishedWidthFt: 21.5, finishedHeightFt: 18, fullnessPct: 50, qty: 1 }, { fabricRate: 0, sewingPct: 0 }).sewnAreaSqft;
  ok(t.sewnAreaSqftEach[0] === area && t.sewnAreaSqftTotal === area * 2, "#292 collect: sewn area is curtainCost(...).sewnAreaSqft");
}
// ---- collector: Grid ----
{
  const main = { type: "Draw" as const, name: "Main", widthFt: 20, heightFt: 18, fullnessPct: 50, fabricSku: "FAB-CH25" };
  const project = {
    options: [{ id: "opt-a", name: "Base", quoteId: null, createdAt: 1 }],
    placements: [
      { id: "p1", optionId: "opt-a", curtain: main },
      { id: "p2", optionId: "opt-a", curtain: { type: "Border" as const, name: "Border 1", widthFt: 40, heightFt: 5, fullnessPct: 50, fabricSku: "FAB-CH25", topFinish: "pipe-pocket" as const, bottomFinish: "chain" as const, mountType: "wall-hookloop" as const } },
      { id: "p3", optionId: "opt-b", curtain: { ...main, name: "Other option" } },
      { id: "p4", optionId: "opt-a" },
    ],
    routes: [],
  };
  const spec = { kind: "grid", gridProjectId: "GRD-1", gridOptionId: "opt-a", lines: [
    { sku: "CURTAIN", desc: c292CurtainDesc(main, "Charisma Velour 25 oz"), qty: 1, unit: "ea", price: 1, ext: 1 },
    { sku: "CURTAIN", desc: "Main (hand edited)", qty: 1, unit: "ea", price: 1, ext: 1 },
  ] };
  const grid = (p: typeof project | null, s: object = spec) => c292CollectTypes({ quote: { spec: s }, fabrics: C292_FABS, trackSeries: [], mounts: {}, partInfo: new Map(), grid: { project: p as never } });
  const live = grid(project);
  const m = live.types.find((t) => t.title === "Main")!;
  const b = live.types.find((t) => t.title === "Border 1")!;
  ok(live.types.length === 2 && m.curtains[0].mount.key === "track-batten" && m.curtains[0].mount.source === "assumed" && m.curtains[0].bottomFinish === "chain",
    "#292 collect: Grid placements of the quote's option become types, with the Grid type defaults marked assumed");
  ok(b.curtains[0].topFinish === "pipe-pocket" && b.curtains[0].mount.key === "wall-hookloop" && b.curtains[0].mount.source === "picked", "#292 collect: a placement's stored finishes and mount win over the defaults");
  const goneProject = grid(null);
  ok(goneProject.notes.includes(c292GridGone) && goneProject.types.length === 1 && goneProject.unreadable.length === 1, "#292 collect: a deleted Grid project falls back to the quoted lines");
  const goneOption = grid(project, { ...spec, gridOptionId: "opt-zz" });
  ok(goneOption.notes.includes(c292GridGone) && goneOption.types.length === 1, "#292 collect: a deleted option falls back to the quoted lines too");
}
// ---- the preview count ----
{
  const secs = [c292Sec("s1", [c292Cur(1), c292Cur(2, { qty: 1 }), c292Cur(3, { desc: "Legs — Charisma Velour 25 oz, 6'W × 18'H, 50% fullness" })])];
  ok(c292Count({ sections: secs }, C292_FABS, C292_SERIES) === c292Collect(secs).types.length && c292Count({ sections: secs }, C292_FABS, C292_SERIES) === 2,
    "#292 collect: countCutSheetTypes (client-safe) equals the collector's type count");
}
```

- [ ] **Step 2: Run to verify it fails** — `Cannot find module '@/lib/curtain-mounts'`.

- [ ] **Step 3: Create `src/lib/curtain-mounts.ts`:**

```ts
/**
 * Curtain mounts (#292 §1.6) — the hardware each mount type uses when a
 * curtain has NO track: one settings blob, one top-level key per mount type
 * id (track_series idiom). Pure and client-safe; the store is
 * src/lib/stores/curtain-mounts.ts. Starts empty, never seeded, survives
 * go-live (clearDemoData never touches blobs).
 */
import { isMountTypeId, type CurtainMountTypeId } from "@/lib/curtain-cut-sheets/vocab";

export const CURTAIN_MOUNTS_BLOB = "curtain_mount_hardware";
export const MOUNT_ROWS_MAX = 30;
export const MOUNT_QTY_MAX = 1000;
const SKU_MAX = 80;

export type MountQtyRule =
  | { kind: "perCurtain"; qty: number } // qty per curtain
  | { kind: "perFtWidth"; qty: number; everyFt: number } // qty × ceil(W ÷ everyFt) per curtain
  | { kind: "perMark"; qty: number }; // qty × top-finish marks per curtain (ties, hooks)
export type MountHardwareRow = { sku: string; rule: MountQtyRule };
export type CurtainMountHardware = { rows: MountHardwareRow[]; updatedBy?: string; updatedAt?: number };

export const MOUNT_RULE_LABELS: Record<MountQtyRule["kind"], string> = {
  perCurtain: "Per curtain",
  perFtWidth: "Per feet of width",
  perMark: "Per grommet / carrier",
};

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return Number.NaN;
}

function cleanRule(raw: unknown): MountQtyRule | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r) return null;
  const qty = num(r.qty);
  if (!Number.isFinite(qty) || qty <= 0 || qty > MOUNT_QTY_MAX) return null;
  if (r.kind === "perCurtain" || r.kind === "perMark") return { kind: r.kind, qty };
  if (r.kind === "perFtWidth") {
    const everyFt = num(r.everyFt);
    if (!Number.isFinite(everyFt) || everyFt <= 0) return null;
    return { kind: "perFtWidth", qty, everyFt };
  }
  return null;
}

export function sanitizeMountRows(raw: unknown): MountHardwareRow[] {
  const out: MountHardwareRow[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const row = r && typeof r === "object" ? (r as Record<string, unknown>) : null;
    const sku = typeof row?.sku === "string" ? row.sku.trim().slice(0, SKU_MAX) : "";
    const rule = cleanRule(row?.rule);
    if (!sku || !rule) continue;
    out.push({ sku, rule });
    if (out.length >= MOUNT_ROWS_MAX) break;
  }
  return out;
}

export function sanitizeCurtainMounts(raw: unknown): Partial<Record<CurtainMountTypeId, CurtainMountHardware>> {
  const out: Partial<Record<CurtainMountTypeId, CurtainMountHardware>> = {};
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  for (const [id, v] of Object.entries(r)) {
    if (!isMountTypeId(id) || !v || typeof v !== "object") continue;
    const hw = v as Record<string, unknown>;
    const entry: CurtainMountHardware = { rows: sanitizeMountRows(hw.rows) };
    if (typeof hw.updatedBy === "string") entry.updatedBy = hw.updatedBy;
    if (typeof hw.updatedAt === "number" && Number.isFinite(hw.updatedAt)) entry.updatedAt = hw.updatedAt;
    out[id] = entry;
  }
  return out;
}

/** One curtain's quantity for one row. */
export function mountRowQty(rule: MountQtyRule, curtain: { widthFt: number; marks: number }): number {
  switch (rule.kind) {
    case "perCurtain":
      return rule.qty;
    case "perFtWidth":
      return curtain.widthFt > 0 ? rule.qty * Math.ceil(curtain.widthFt / rule.everyFt - 1e-9) : 0;
    case "perMark":
      return rule.qty * Math.max(0, curtain.marks);
  }
}
```

- [ ] **Step 4: Create `src/lib/curtain-cut-sheets/estimator-curtains.ts`:**

```ts
/**
 * Curtain cut sheets (#292 §2.3) — the two adapters that read curtains off a
 * quote, and the key that groups them into types. Pure and client-safe with
 * NO weight math: the Estimator preview counts sheets through
 * countCutSheetTypes without bundling steel.ts. collect.ts adds weights,
 * areas and hardware on the server. A quote is read by exactly one adapter:
 * non-empty spec.sections → Estimator; else spec.kind === "grid" → Grid.
 */
import { hasOption, optionSlice, type GridOption } from "@/lib/design/grid-options";
import type { GridCurtain, GridCurtainType } from "@/lib/design/grid-bom";
import { isRewardCreditItem } from "@/lib/rewards/credit-line";
import type { TrackOperation, TrackSeries } from "@/lib/track-series";
import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import { parseEstimatorCurtainDesc, parseGridCurtainDesc } from "./parse";
import { linkCurtainTracks } from "./track-link";
import {
  ASSUMED_MOUNT, DEFAULT_BOTTOM_FINISH, DEFAULT_MARK_SPACING_IN, DEFAULT_TOP_FINISH, GRID_CURTAIN_DEFAULTS,
  isBottomFinish, isMountTypeId, isTopFinish, mountTypeForTrackMounting,
  type CurtainBottomFinish, type CurtainMountKey, type CurtainTopFinish,
} from "./vocab";

export const CURTAIN_UNREADABLE = "Can't read size — edit the curtain";
export const CURTAIN_ZERO_SIZE = "Size is 0 — edit the curtain";
export const GRID_DESIGN_GONE = "The Grid design behind this quote no longer exists — sheets read the quoted lines.";
export const TRACK_SERIES_GONE_WARNING = "Track series no longer exists — hardware as quoted.";

/** The catalog fabric row slice the cut sheets read (fabricParts()). */
export type CurtainFabricRow = { sku: string; desc: string; oz?: number; ozBasis?: "lin-yd" | "sq-yd"; boltWidthIn?: number; flameRating?: string };
export type CutSheetFabric = { sku: string; name: string; oz?: number; ozBasis?: "lin-yd" | "sq-yd"; boltWidthIn?: number; flameRating?: string };
export type CutSheetMount = {
  key: CurtainMountKey;
  source: "track" | "picked" | "assumed";
  track?: { line: SpecItem; seriesId: string; seriesName: string; seriesGone: boolean; operation: TrackOperation; carrierSpacingIn: number };
};
/** Where a line sits — staff warnings and "Edit the curtain →" only. */
export type CurtainLineRef = { ref: string; where: string; desc: string; sectionId?: string; lineId?: number };
export type CutSheetCurtain = CurtainLineRef & {
  name: string;
  gridType?: GridCurtainType;
  color?: string;
  fabric: CutSheetFabric | null;
  /** What the line says — printed when `fabric` is null. */
  fabricText: string;
  widthFt: number;
  heightFt: number;
  fullnessPct: number;
  qty: number;
  topFinish: CurtainTopFinish;
  bottomFinish: CurtainBottomFinish;
  mount: CutSheetMount;
  warnings: string[];
};
export type CurtainsRead = {
  curtains: CutSheetCurtain[];
  unreadable: Array<CurtainLineRef & { reason: string }>;
  skippedOptional: CurtainLineRef[];
  notes: string[];
};
/** The Grid project slice the adapter needs (stores/grid-projects GridProject satisfies it). */
export type GridProjectLite = {
  options?: GridOption[];
  placements?: Array<{ id: string; optionId?: string; curtain?: GridCurtain | null }>;
  routes?: Array<{ optionId?: string }>;
};

const empty = (): CurtainsRead => ({ curtains: [], unreadable: [], skippedOptional: [], notes: [] });

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return Number.NaN;
}
function positiveOr(v: unknown, fallback: number): number {
  const n = num(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function fabricOf(row: CurtainFabricRow | null | undefined): CutSheetFabric | null {
  if (!row) return null;
  return { sku: row.sku, name: row.desc, oz: row.oz, ozBasis: row.ozBasis, boltWidthIn: row.boltWidthIn, flameRating: (row.flameRating || "").trim() || undefined };
}
function sizeProblem(w: number, h: number): string | null {
  if (!Number.isFinite(w) || !Number.isFinite(h)) return CURTAIN_UNREADABLE;
  if (w <= 0 || h <= 0) return CURTAIN_ZERO_SIZE;
  return null;
}

export function estimatorCurtains(sections: readonly SpecSection[], fabrics: readonly CurtainFabricRow[], trackSeries: readonly TrackSeries[]): CurtainsRead {
  const bySku = new Map(fabrics.map((f) => [f.sku, f]));
  const byName = new Map(fabrics.map((f) => [f.desc, f]));
  const names = new Set(fabrics.map((f) => f.desc));
  const { links, duplicates } = linkCurtainTracks(sections);
  const dup = new Set(duplicates);
  const read = empty();
  for (const sec of sections) {
    for (const it of sec.items || []) {
      if (!it.curtain || isRewardCreditItem(it)) continue;
      const lineRef: CurtainLineRef = { ref: `${sec.id}/line-${it.id}`, where: sec.name || "System", desc: it.desc || "", sectionId: sec.id, lineId: it.id };
      if (it.option) {
        read.skippedOptional.push(lineRef);
        continue;
      }
      const ci = it.curtainInputs;
      let name: string;
      let fabricRow: CurtainFabricRow | undefined;
      let fabricText: string;
      let w: number;
      let h: number;
      let full: number;
      if (ci) {
        name = ci.name || "";
        w = num(ci.width);
        h = num(ci.height);
        full = num(ci.fullness);
        fabricRow = (ci.fabricSku ? bySku.get(ci.fabricSku) : undefined) ?? (ci.fabricName ? byName.get(ci.fabricName) : undefined);
        fabricText = (ci.fabricName || ci.fabricSku || "").trim();
      } else {
        const p = parseEstimatorCurtainDesc(it.desc || "", names);
        if (!p) {
          read.unreadable.push({ ...lineRef, reason: CURTAIN_UNREADABLE });
          continue;
        }
        ({ name, fabricName: fabricText, widthFt: w, heightFt: h, fullnessPct: full } = p);
        fabricRow = byName.get(p.fabricName);
      }
      const problem = sizeProblem(w, h);
      if (problem) {
        read.unreadable.push({ ...lineRef, reason: problem });
        continue;
      }
      const label = name.trim() || "Curtain";
      const warnings: string[] = [];
      if (dup.has(it)) warnings.push(`${label}: its track is already linked to another curtain — mount from the curtain's own pick.`);
      const trackLine = links.get(it);
      let mount: CutSheetMount;
      if (trackLine?.track) {
        const cfg = trackLine.track;
        const series = trackSeries.find((s) => s.id === cfg.seriesId);
        if (!series) warnings.push(TRACK_SERIES_GONE_WARNING);
        mount = {
          key: mountTypeForTrackMounting(String(cfg.mounting)),
          source: "track",
          track: {
            line: trackLine,
            seriesId: cfg.seriesId,
            seriesName: series?.name || "",
            seriesGone: !series,
            operation: cfg.operation,
            carrierSpacingIn: positiveOr(cfg.carrierSpacingIn, positiveOr(series?.carrierSpacingIn, DEFAULT_MARK_SPACING_IN)),
          },
        };
      } else if (ci && isMountTypeId(ci.mountType)) mount = { key: ci.mountType, source: "picked" };
      else mount = { key: ASSUMED_MOUNT, source: "assumed" };
      read.curtains.push({
        ...lineRef,
        name: label,
        fabric: fabricOf(fabricRow),
        fabricText,
        widthFt: w,
        heightFt: h,
        fullnessPct: Number.isFinite(full) && full > 0 ? full : 0,
        qty: Math.max(1, Math.round(Number(it.qty)) || 1),
        topFinish: ci && isTopFinish(ci.topFinish) ? ci.topFinish : DEFAULT_TOP_FINISH,
        bottomFinish: ci && isBottomFinish(ci.bottomFinish) ? ci.bottomFinish : DEFAULT_BOTTOM_FINISH,
        mount,
        warnings,
      });
    }
  }
  return read;
}

export function gridCurtains(spec: { gridOptionId?: unknown; lines?: unknown }, project: GridProjectLite | null, fabrics: readonly CurtainFabricRow[]): CurtainsRead {
  const bySku = new Map(fabrics.map((f) => [f.sku, f]));
  const byName = new Map(fabrics.map((f) => [f.desc, f]));
  const read = empty();
  const optionId = typeof spec.gridOptionId === "string" ? spec.gridOptionId : "";
  if (project && optionId && hasOption(project, optionId)) {
    for (const pl of optionSlice(project, optionId).placements) {
      const c = pl.curtain;
      if (!c) continue;
      const lineRef: CurtainLineRef = { ref: `placement-${pl.id}`, where: "Grid design", desc: c.name || "" };
      const problem = sizeProblem(Number(c.widthFt), Number(c.heightFt));
      if (problem) {
        read.unreadable.push({ ...lineRef, reason: problem });
        continue;
      }
      const d = GRID_CURTAIN_DEFAULTS[c.type] ?? GRID_CURTAIN_DEFAULTS.Full;
      read.curtains.push({
        ...lineRef,
        name: (c.name || "").trim() || "Curtain",
        gridType: c.type,
        color: (c.color || "").trim() || undefined,
        fabric: fabricOf(bySku.get(c.fabricSku)),
        fabricText: c.fabricSku,
        widthFt: c.widthFt,
        heightFt: c.heightFt,
        fullnessPct: c.fullnessPct > 0 ? c.fullnessPct : 0,
        qty: 1,
        topFinish: isTopFinish(c.topFinish) ? c.topFinish : d.top,
        bottomFinish: isBottomFinish(c.bottomFinish) ? c.bottomFinish : d.bottom,
        mount: isMountTypeId(c.mountType) ? { key: c.mountType, source: "picked" } : { key: d.mount, source: "assumed" },
        warnings: [],
      });
    }
    return read;
  }
  read.notes.push(GRID_DESIGN_GONE);
  const lines = Array.isArray(spec.lines) ? spec.lines : [];
  lines.forEach((raw, i) => {
    const l = (raw && typeof raw === "object" ? raw : {}) as { sku?: unknown; desc?: unknown; qty?: unknown };
    if (l.sku !== "CURTAIN") return;
    const desc = typeof l.desc === "string" ? l.desc : "";
    const lineRef: CurtainLineRef = { ref: `line-${i + 1}`, where: "Quoted lines", desc };
    const p = parseGridCurtainDesc(desc);
    const problem = p ? sizeProblem(p.widthFt, p.heightFt) : CURTAIN_UNREADABLE;
    if (!p || problem) {
      read.unreadable.push({ ...lineRef, reason: problem || CURTAIN_UNREADABLE });
      return;
    }
    const d = GRID_CURTAIN_DEFAULTS[p.gridType];
    read.curtains.push({
      ...lineRef,
      name: p.name,
      gridType: p.gridType,
      fabric: fabricOf(byName.get(p.fabricName) ?? bySku.get(p.fabricName)),
      fabricText: p.fabricName,
      widthFt: p.widthFt,
      heightFt: p.heightFt,
      fullnessPct: p.fullnessPct,
      qty: Math.max(1, Math.round(num(l.qty)) || 1),
      topFinish: d.top,
      bottomFinish: d.bottom,
      mount: { key: d.mount, source: "assumed" },
      warnings: [],
    });
  });
  return read;
}

export function readCurtains(spec: unknown, fabrics: readonly CurtainFabricRow[], trackSeries: readonly TrackSeries[], project: GridProjectLite | null): CurtainsRead {
  const s = (spec && typeof spec === "object" ? spec : {}) as { sections?: unknown; kind?: unknown; gridOptionId?: unknown; lines?: unknown };
  if (Array.isArray(s.sections) && s.sections.length) return estimatorCurtains(s.sections as SpecSection[], fabrics, trackSeries);
  if (s.kind === "grid") return gridCurtains(s, project, fabrics);
  return empty();
}

/** lower(trim(name)) | fabric sku-or-text | fullness | top | bottom | mountKey | trackSeriesId-or-"". Size is NOT part of the type. */
export function curtainTypeKey(c: CutSheetCurtain): string {
  return [
    c.name.trim().toLowerCase(),
    c.fabric ? c.fabric.sku : `text:${c.fabricText.trim().toLowerCase()}`,
    c.fullnessPct,
    c.topFinish,
    c.bottomFinish,
    c.mount.key,
    c.mount.track?.seriesId ?? "",
  ].join("|");
}

/** The number of cut sheets a quote will print — the Estimator preview's chip and hint card. */
export function countCutSheetTypes(spec: unknown, fabrics: readonly CurtainFabricRow[], trackSeries: readonly TrackSeries[]): number {
  return new Set(readCurtains(spec, fabrics, trackSeries, null).curtains.map(curtainTypeKey)).size;
}
```

  Note: if TS rejects the destructuring-assignment line `({ name, fabricName: fabricText, ... } = p);`, replace it with five plain assignments (`name = p.name; fabricText = p.fabricName; w = p.widthFt; h = p.heightFt; full = p.fullnessPct;`).

- [ ] **Step 5: Create `src/lib/curtain-cut-sheets/collect.ts`:**

```ts
/**
 * Curtain cut sheets (#292 §2.3) — one collector over the two adapters:
 * groups curtains into types (CS-n in first-appearance order), merges sizes,
 * sums hardware, and computes sewn area / weight through the SAME functions
 * the quote prices and the lineset tool weighs with (decision 2). DB-free,
 * but imports steel.ts — server and harness only, never a client component.
 */
import { curtainCost } from "@/lib/design/curtain-pricing";
import { CHAIN_JACK, CHAIN_NONE } from "@/lib/design/goods";
import { computeSetWeight, DEFAULT_WEIGHTS, fabricFromPart } from "@/lib/design/steel";
import { mountRowQty, type CurtainMountHardware } from "@/lib/curtain-mounts";
import type { TrackSeries } from "@/lib/track-series";
import type { SpecItem } from "@/app/(app)/estimator/types";
import { topMarks } from "./geometry";
import { curtainTypeKey, readCurtains, type CurtainFabricRow, type CurtainLineRef, type CutSheetCurtain, type GridProjectLite } from "./estimator-curtains";
import { DEFAULT_MARK_SPACING_IN, MOUNT_KEY_LABELS, isMountTypeId, type CurtainMountTypeId } from "./vocab";

export type CutSheetHardware = { sku: string; desc: string; qty: number; unit: string; from: "track" | "mount-rules" };
export type CurtainType = {
  key: string;
  sheetNo: string;
  title: string;
  /** Every member, in quote order. */
  curtains: CutSheetCurtain[];
  /** Merged by exact W × H, largest area first. */
  sizes: Array<{ widthFt: number; heightFt: number; qty: number }>;
  totalQty: number;
  markSpacingIn: number;
  hardware: CutSheetHardware[];
  sewnAreaSqftEach: number[];
  sewnAreaSqftTotal: number;
  weightLbEach: Array<number | null>;
  weightLbTotal: number | null;
  warnings: string[];
};
export type CollectInput = {
  quote: { spec?: unknown };
  fabrics: readonly CurtainFabricRow[];
  trackSeries: readonly TrackSeries[];
  mounts: Partial<Record<CurtainMountTypeId, CurtainMountHardware>>;
  /** Live desc/unit for hardware SKUs (track components + mount rules). */
  partInfo: ReadonlyMap<string, { desc: string; unit: string }>;
  /** Loaded only for a grid quote. */
  grid: { project: GridProjectLite | null } | null;
};
export type CollectResult = {
  types: CurtainType[];
  unreadable: Array<CurtainLineRef & { reason: string }>;
  skippedOptional: CurtainLineRef[];
  notes: string[];
};

/** curtainCost(...).sewnAreaSqft for ONE curtain — only the area is read, no rate. */
export function sewnAreaEach(c: Pick<CutSheetCurtain, "widthFt" | "heightFt" | "fullnessPct">): number {
  return curtainCost({ finishedWidthFt: c.widthFt, finishedHeightFt: c.heightFt, fullnessPct: c.fullnessPct, qty: 1 }, { fabricRate: 0, sewingPct: 0 }).sewnAreaSqft;
}

/** computeSetWeight(...).goods for ONE curtain (fabric + 6" cut + chain + 0.5 lb/ft hardware); null when the fabric has no oz. */
export function weightEach(c: CutSheetCurtain): number | null {
  const fab = c.fabric ? fabricFromPart({ desc: c.fabric.name, oz: c.fabric.oz, ozBasis: c.fabric.ozBasis, boltWidthIn: c.fabric.boltWidthIn }) : null;
  if (!fab) return null;
  return computeSetWeight(
    { name: c.name, fabResolved: fab, w: c.widthFt, h: c.heightFt, full: c.fullnessPct, qty: 1, chain: c.bottomFinish === "chain" ? CHAIN_JACK : CHAIN_NONE, batten: 0, mode: "dead" },
    DEFAULT_WEIGHTS
  ).goods;
}

function trackHardware(curtains: CutSheetCurtain[], partInfo: CollectInput["partInfo"]): CutSheetHardware[] {
  const seen = new Set<SpecItem>();
  const out = new Map<string, CutSheetHardware>();
  for (const c of curtains) {
    const line = c.mount.track?.line;
    if (!line || seen.has(line)) continue;
    seen.add(line);
    // each component's qty already counts the line's config.qty tracks
    for (const comp of line.components || []) {
      if (!comp.sku || !(comp.qty > 0)) continue;
      const cur = out.get(comp.sku);
      if (cur) cur.qty += comp.qty;
      else out.set(comp.sku, { sku: comp.sku, desc: partInfo.get(comp.sku)?.desc || comp.label || comp.sku, qty: comp.qty, unit: comp.unit || partInfo.get(comp.sku)?.unit || "ea", from: "track" });
    }
  }
  return [...out.values()];
}

function ruleHardware(curtains: CutSheetCurtain[], spacingIn: number, input: CollectInput, warnings: string[]): CutSheetHardware[] {
  const key = curtains[0].mount.key;
  const rows = isMountTypeId(key) ? input.mounts[key]?.rows ?? [] : [];
  if (!rows.length) {
    warnings.push(`No hardware listed for ${MOUNT_KEY_LABELS[key]} — Estimating Rules → Curtain mounts`);
    return [];
  }
  const out = new Map<string, CutSheetHardware>();
  for (const row of rows) {
    let qty = 0;
    for (const c of curtains) {
      const marks = c.topFinish === "grommets" ? topMarks(c.widthFt, spacingIn).count : 0;
      qty += mountRowQty(row.rule, { widthFt: c.widthFt, marks }) * c.qty;
    }
    if (!(qty > 0)) continue;
    const info = input.partInfo.get(row.sku);
    const cur = out.get(row.sku);
    if (cur) cur.qty += qty;
    else out.set(row.sku, { sku: row.sku, desc: info?.desc || row.sku, qty, unit: info?.unit || "ea", from: "mount-rules" });
  }
  return [...out.values()];
}

export function collectCurtainTypes(input: CollectInput): CollectResult {
  const read = readCurtains(input.quote.spec, input.fabrics, input.trackSeries, input.grid?.project ?? null);
  const groups = new Map<string, CutSheetCurtain[]>();
  for (const c of read.curtains) {
    const k = curtainTypeKey(c);
    const g = groups.get(k);
    if (g) g.push(c);
    else groups.set(k, [c]);
  }
  const nameCount = new Map<string, number>();
  for (const cs of groups.values()) {
    const n = cs[0].name.trim().toLowerCase();
    nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
  }
  const types = [...groups].map(([key, curtains], i): CurtainType => {
    const first = curtains[0];
    const fabricName = first.fabric?.name || first.fabricText || "fabric";
    const title = (nameCount.get(first.name.trim().toLowerCase()) ?? 0) > 1 ? `${first.name} (${fabricName})` : first.name;
    const bySize = new Map<string, { widthFt: number; heightFt: number; qty: number }>();
    for (const c of curtains) {
      const k = `${c.widthFt}x${c.heightFt}`;
      const s = bySize.get(k);
      if (s) s.qty += c.qty;
      else bySize.set(k, { widthFt: c.widthFt, heightFt: c.heightFt, qty: c.qty });
    }
    const sizes = [...bySize.values()].sort((a, b) => b.widthFt * b.heightFt - a.widthFt * a.heightFt || b.widthFt - a.widthFt);
    const totalQty = curtains.reduce((a, c) => a + c.qty, 0);
    const markSpacingIn = Math.min(...curtains.map((c) => c.mount.track?.carrierSpacingIn ?? DEFAULT_MARK_SPACING_IN));
    const warnings = [...new Set(curtains.flatMap((c) => c.warnings))];
    const hardware = first.mount.source === "track" ? trackHardware(curtains, input.partInfo) : ruleHardware(curtains, markSpacingIn, input, warnings);
    const sewnAreaSqftEach = curtains.map(sewnAreaEach);
    const sewnAreaSqftTotal = curtains.reduce((a, c, j) => a + sewnAreaSqftEach[j] * c.qty, 0);
    const weightLbEach = curtains.map(weightEach);
    const weightLbTotal = weightLbEach.some((w) => w == null) ? null : curtains.reduce((a, c, j) => a + (weightLbEach[j] as number) * c.qty, 0);
    if (!first.fabric) warnings.push(`Fabric not in the catalog: ${first.fabricText || "—"} — Catalog`);
    else {
      if (weightLbTotal == null) warnings.push(`Weight not set for ${first.fabric.name} — Catalog`);
      if (!first.fabric.flameRating) warnings.push(`Flame rating not set for ${first.fabric.name} — Catalog`);
    }
    if (curtains.some((c) => c.mount.source === "assumed")) warnings.push(`Mount assumed: ${MOUNT_KEY_LABELS[first.mount.key]} — pick one on the curtain`);
    return { key, sheetNo: `CS-${i + 1}`, title, curtains, sizes, totalQty, markSpacingIn, hardware, sewnAreaSqftEach, sewnAreaSqftTotal, weightLbEach, weightLbTotal, warnings };
  });
  return { types, unreadable: read.unreadable, skippedOptional: read.skippedOptional, notes: read.notes };
}
```

- [ ] **Step 6: Run the Gates.** Expected PASS = Task 2 count + 30, 0 FAIL. eslint the three new files.

- [ ] **Step 7: Commit** — `feat(cutsheets): #292 curtain-mount rules + collector (adapters, types, hardware, weight)`.

---

### Task 4: The sheet model

**Files:**
- Create: `src/lib/curtain-cut-sheets/model.ts`
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:**
- Consumes: `titleBlockData`, `revLetter`, `RevisionRow`, `TitleBlockData`, `TitleBlockInput` (`src/lib/design/grid-drawing-set.ts`); `QuoteRevision` type (`src/lib/stores/quotes.ts:366`, type-only import); Tasks 1–3.
- Produces: `type CutSheetStyle = "submittal" | "client"`; constants `CUT_SHEETS_NO_QUOTE`, `CUT_SHEETS_WRONG_TYPE`, `CUT_SHEETS_NONE`, `SUBMITTAL_ELEV_BOX` (`{ wIn: 4.6, hIn: 3.9 }`), `CLIENT_ELEV_BOX` (`{ wIn: 7.3, hIn: 3.6 }`); `isCutSheetQuoteType(t)`; `type CutSheetModel`; `type CutSheetContext`; `quoteRevisionRows(revs)`; `cutSheetCssVars()`; `plainDescription(type)`; `materialRows(type)`; `cutSheetModel(type, ctx)`.

`CutSheetModel`:
```ts
export type CutSheetModel = {
  style: CutSheetStyle;
  sheetNo: string;
  title: string;
  titleBlock: TitleBlockData | null;          // Submittal only
  header: { companyName: string; logoDark: string | null; estimateNo: string };
  elevation: { scale: string; shapes: Shape[]; box: { wIn: number; hIn: number } };
  mount: { label: string; detail: MountDetail };
  materials: Array<{ label: string; value: string }>;   // Submittal only ([] for Client)
  sizes: Array<{ size: string; qty: number }>;
  hardware: Array<{ sku: string; desc: string; qty: number; unit: string }>; // Submittal only
  description: string;                       // Client only ("" for Submittal)
};
```

- [ ] **Step 1: Append the failing checks:**

```ts
import { cutSheetCssVars as c292CssVars, cutSheetModel as c292Model, plainDescription as c292Plain, quoteRevisionRows as c292RevRows } from "@/lib/curtain-cut-sheets/model";
{
  const t = c292Collect([c292Sec("s1", [c292Cur(1), c292Trk(2)])]).types[0];
  ok(c292Plain(t) === `Two Main Drape panels, each 21'-6" wide × 18'-0" tall finished, sewn from Charisma Velour 25 oz with 50% fullness. The top has webbing with grommets every 12", hung from carriers on an ADC 280 Black track mounted to a pipe batten; the bottom has a chain pocket so the curtain hangs straight.`,
    "#292 model: plainDescription is the fixed deterministic sentence (spec §2.6 sample)");
  const rows = c292RevRows([
    { rev: 2, at: 20, reason: "sent", note: "" }, { rev: 1, at: 10, reason: "manual", note: "First pass" }, { rev: 3, at: 30, reason: "manual", note: "" },
  ]);
  ok(rows.map((r) => `${r.letter}:${r.label}`).join("|") === "A:First pass|B:Issued to customer|C:Pricing snapshot", "#292 model: quoteRevisionRows letters A, B… in rev order; sent reads Issued to customer");
  const ctx = {
    quote: { id: "Q-1", number: "EST-1042", name: "Main stage", customer: "Lakefront HS", venue: "Auditorium — Lakefront", revisions: [] },
    company: { name: "Peak Systems Group", logoDark: null, offices: [] }, preparedBy: "Jeff Chesebro", index: 1, total: 1, now: 1,
  };
  const sub = c292Model(t, { ...ctx, style: "submittal" });
  ok(sub.titleBlock?.sheet.number === "CS-1" && sub.titleBlock.project.id === "EST-1042" && sub.titleBlock.status === "— Preliminary" && sub.titleBlock.optionName === null &&
      sub.titleBlock.scale === `Elev ${sub.elevation.scale} · Detail NTS` && sub.titleBlock.drawnBy === "Jeff Chesebro",
    "#292 model: the Submittal title block is filled from the quote (estimate #, CS-n, Preliminary with no revisions)");
  ok(sub.materials.map((m) => m.label).join() === "Fabric,Flame rating,Fullness,Finished size,Top finish,Bottom finish,Sewn area,Weight,Qty" &&
      sub.materials[0].value === `Charisma Velour 25 oz · 25 oz/lin yd, 54" bolt` && sub.materials[2].value === "50% (1.5×)",
    "#292 model: materials rows in spec order, with the catalog weight basis");
  ok(sub.hardware.some((h) => h.sku === "ADC-2802") && sub.description === "", "#292 model: Submittal carries the hardware table");
  const cli = c292Model(t, { ...ctx, style: "client" });
  const json = JSON.stringify(cli);
  ok(cli.titleBlock === null && cli.hardware.length === 0 && cli.materials.length === 0 && !/"sku"|"cost"|"price"/.test(json) && !json.includes("ADC-2802") && cli.description.startsWith("Two Main Drape"),
    "#292 model: the Client model has no SKU or cost fields — elevation, description, sizes and mount only");
  const v = c292CssVars();
  ok(v["--dw-w"] === "11in" && v["--dw-h"] === "8.5in" && v["--dw-strip"] === "2.1in", "#292 model: cut-sheet CSS variables are Letter landscape");
}
```

- [ ] **Step 2: Run to verify it fails** — `Cannot find module '@/lib/curtain-cut-sheets/model'`.

- [ ] **Step 3: Create `src/lib/curtain-cut-sheets/model.ts`:**

```ts
/**
 * Curtain cut sheets (#292 §2.6) — one view model per sheet, two styles from
 * one data source. Pure and client-safe. The Submittal title block reuses the
 * drawing set's titleBlockData (#209); revisions come from the QUOTE.
 */
import { revLetter, titleBlockData, type RevisionRow, type TitleBlockData, type TitleBlockInput } from "@/lib/design/grid-drawing-set";
import type { QuoteRevision } from "@/lib/stores/quotes";
import type { CurtainType } from "./collect";
import { elevation, ftIn, inchLabel } from "./geometry";
import { mountDetail, type MountDetail } from "./mount-details";
import type { Shape } from "./shapes";
import { BOTTOM_FINISH_LABELS, MOUNT_KEY_LABELS, TOP_FINISH_LABELS, type CurtainMountKey } from "./vocab";

export type CutSheetStyle = "submittal" | "client";
export const CUT_SHEETS_NO_QUOTE = "Quote not found.";
export const CUT_SHEETS_WRONG_TYPE = "Cut sheets are for system quotes.";
export const CUT_SHEETS_NONE = "This quote has no curtains.";
/** Elevation boxes in paper inches: Letter landscape drawing area (60 % × 55 %) and Letter portrait at 0.6in margins. */
export const SUBMITTAL_ELEV_BOX = { wIn: 4.6, hIn: 3.9 } as const;
export const CLIENT_ELEV_BOX = { wIn: 7.3, hIn: 3.6 } as const;

export function isCutSheetQuoteType(t: string | null | undefined): boolean {
  return !t || t === "system";
}

export type CutSheetModel = {
  style: CutSheetStyle;
  sheetNo: string;
  title: string;
  titleBlock: TitleBlockData | null;
  header: { companyName: string; logoDark: string | null; estimateNo: string };
  elevation: { scale: string; shapes: Shape[]; box: { wIn: number; hIn: number } };
  mount: { label: string; detail: MountDetail };
  materials: Array<{ label: string; value: string }>;
  sizes: Array<{ size: string; qty: number }>;
  hardware: Array<{ sku: string; desc: string; qty: number; unit: string }>;
  description: string;
};

export type CutSheetContext = {
  style: CutSheetStyle;
  quote: { id: string; number: string; name: string; customer: string; venue: string; revisions?: ReadonlyArray<Pick<QuoteRevision, "rev" | "at" | "reason" | "note">> };
  company: TitleBlockInput["company"];
  preparedBy: string;
  index: number;
  total: number;
  now: number;
};

/** QuoteRevision → the drawing set's RevisionRow: note, else "Issued to customer" (sent), else "Pricing snapshot". */
export function quoteRevisionRows(revs: CutSheetContext["quote"]["revisions"] | undefined): RevisionRow[] {
  return [...(revs || [])]
    .sort((a, b) => a.rev - b.rev)
    .map((r, i) => ({
      rev: r.rev,
      letter: revLetter(i),
      date: r.at,
      label: (r.note || "").trim() || (r.reason === "sent" ? "Issued to customer" : "Pricing snapshot"),
    }));
}

/** `.pk-drawing-sheet` variables for Letter landscape (SheetSizeKey is NOT widened — the drawing set switches on it). */
export function cutSheetCssVars(): Record<string, string> {
  return { "--dw-w": "11in", "--dw-h": "8.5in", "--dw-k": "0.85", "--dw-m": "0.3in", "--dw-strip": "2.1in", "--dw-pad": "0.15in" };
}

const COUNT_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const countWord = (n: number) => COUNT_WORDS[n] ?? String(n);
const aOrAn = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");
const MOUNT_PLACE: Record<CurtainMountKey, string> = {
  "track-batten": "a pipe batten",
  "track-ceiling": "the ceiling",
  "track-structure": "the building structure (drop kit)",
  "track-other": "its supports",
  "tie-batten": "a pipe batten",
  "wall-hookloop": "a wall header",
};
const fmt1 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt0 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** One deterministic sentence from the type (Client style). */
export function plainDescription(type: CurtainType): string {
  const c = type.curtains[0];
  const fabric = c.fabric?.name || c.fabricText || "the specified fabric";
  const n = type.totalQty;
  const size =
    type.sizes.length === 1
      ? `${n > 1 ? "each " : ""}${ftIn(type.sizes[0].widthFt)} wide × ${ftIn(type.sizes[0].heightFt)} tall finished`
      : `in ${type.sizes.length} sizes (see schedule)`;
  const fullness = c.fullnessPct > 0 ? `${c.fullnessPct}% fullness` : "no fullness (flat)";
  const first = `${countWord(n)} ${type.title} ${n === 1 ? "panel" : "panels"}, ${size}, sewn from ${fabric} with ${fullness}.`;
  const top =
    c.topFinish === "grommets"
      ? `The top has webbing with grommets every ${inchLabel(type.markSpacingIn)}`
      : c.topFinish === "pipe-pocket"
        ? "The top has a pipe pocket"
        : "The top has a hook-and-loop strip";
  const place = MOUNT_PLACE[c.mount.key];
  const t = c.mount.track;
  const hang = t
    ? t.seriesName
      ? `, hung from carriers on ${aOrAn(t.seriesName)} ${t.seriesName} track mounted to ${place}`
      : `, hung from carriers on a track mounted to ${place}`
    : c.mount.key === "tie-batten"
      ? `, tied to ${place}`
      : c.mount.key === "wall-hookloop"
        ? `, fastened to ${place}`
        : `, hung on a track mounted to ${place}`;
  const bottom =
    c.bottomFinish === "chain"
      ? "the bottom has a chain pocket so the curtain hangs straight."
      : c.bottomFinish === "pipe-pocket"
        ? "the bottom has a pipe pocket for a bottom pipe."
        : "the bottom has a plain hem.";
  return `${first} ${top}${hang}; ${bottom}`;
}

function fabricValue(type: CurtainType): string {
  const c = type.curtains[0];
  const f = c.fabric;
  if (!f) return c.fabricText || "—";
  const facts: string[] = [];
  if (f.oz) facts.push(`${f.oz} oz/${f.ozBasis === "sq-yd" ? "sq yd" : "lin yd"}`);
  if (f.oz && f.ozBasis !== "sq-yd" && f.boltWidthIn) facts.push(`${f.boltWidthIn}" bolt`);
  return facts.length ? `${f.name} · ${facts.join(", ")}` : f.name;
}

function eachTotal(each: ReadonlyArray<number>, total: number, unit: string, fmt: (n: number) => string): string {
  const distinct = new Set(each.map(fmt));
  return distinct.size === 1 ? `${[...distinct][0]} ${unit} each · ${fmt(total)} ${unit} total` : `${fmt(total)} ${unit} total`;
}

/** Fabric, Flame rating (if set), Color (Grid, if set), Fullness, Finished size, Top, Bottom, Sewn area, Weight, Qty. */
export function materialRows(type: CurtainType): Array<{ label: string; value: string }> {
  const c = type.curtains[0];
  const rows: Array<{ label: string; value: string }> = [{ label: "Fabric", value: fabricValue(type) }];
  if (c.fabric?.flameRating) rows.push({ label: "Flame rating", value: c.fabric.flameRating });
  const color = type.curtains.find((x) => x.color)?.color;
  if (color) rows.push({ label: "Color", value: color });
  rows.push({ label: "Fullness", value: c.fullnessPct > 0 ? `${c.fullnessPct}% (${1 + c.fullnessPct / 100}×)` : "Flat" });
  rows.push({ label: "Finished size", value: type.sizes.length === 1 ? `${ftIn(type.sizes[0].widthFt)} W × ${ftIn(type.sizes[0].heightFt)} H` : "See schedule" });
  rows.push({ label: "Top finish", value: TOP_FINISH_LABELS[c.topFinish] + (c.topFinish === "grommets" ? ` @ ${inchLabel(type.markSpacingIn)} o.c. max` : "") });
  rows.push({ label: "Bottom finish", value: BOTTOM_FINISH_LABELS[c.bottomFinish] });
  rows.push({ label: "Sewn area", value: eachTotal(type.sewnAreaSqftEach, type.sewnAreaSqftTotal, "sq ft", fmt1) });
  rows.push({
    label: "Weight",
    value: type.weightLbTotal == null ? "—" : eachTotal(type.weightLbEach as number[], type.weightLbTotal, "lb", fmt0),
  });
  rows.push({ label: "Qty", value: String(type.totalQty) });
  return rows;
}

export function cutSheetModel(type: CurtainType, ctx: CutSheetContext): CutSheetModel {
  const c = type.curtains[0];
  const submittal = ctx.style === "submittal";
  const box = submittal ? SUBMITTAL_ELEV_BOX : CLIENT_ELEV_BOX;
  const elev = elevation({
    sizes: type.sizes,
    fullnessPct: c.fullnessPct,
    top: c.topFinish,
    bottom: c.bottomFinish,
    markSpacingIn: type.markSpacingIn,
    markLabel: c.mount.source === "track" ? "Carriers" : "Grommets",
    box,
  });
  const t = c.mount.track;
  const mountLabel = t && t.seriesName ? `${MOUNT_KEY_LABELS[c.mount.key]} (${t.seriesName})` : MOUNT_KEY_LABELS[c.mount.key];
  return {
    style: ctx.style,
    sheetNo: type.sheetNo,
    title: type.title,
    titleBlock: submittal
      ? titleBlockData({
          company: ctx.company,
          project: { id: ctx.quote.number, name: ctx.quote.name, customer: ctx.quote.customer, siteName: ctx.quote.venue, intake: null, createdBy: ctx.preparedBy },
          option: { name: "", quoteId: ctx.quote.number },
          optionCount: 1,
          revisions: quoteRevisionRows(ctx.quote.revisions),
          set: { drawnBy: ctx.preparedBy, checkedBy: "" },
          sheet: { number: type.sheetNo, title: type.title, scale: `Elev ${elev.scale} · Detail NTS` },
          index: ctx.index,
          total: ctx.total,
          now: ctx.now,
        })
      : null,
    header: { companyName: ctx.company.name || "", logoDark: ctx.company.logoDark || null, estimateNo: ctx.quote.number },
    elevation: { scale: elev.scale, shapes: elev.shapes, box: { wIn: box.wIn, hIn: box.hIn } },
    mount: { label: mountLabel, detail: mountDetail(c.mount.key) },
    materials: submittal ? materialRows(type) : [],
    sizes: type.sizes.map((s) => ({ size: `${ftIn(s.widthFt)} W × ${ftIn(s.heightFt)} H`, qty: s.qty })),
    hardware: submittal ? type.hardware.map(({ sku, desc, qty, unit }) => ({ sku, desc, qty, unit })) : [],
    description: submittal ? "" : plainDescription(type),
  };
}
```

- [ ] **Step 4: Run the Gates.** Expected PASS = Task 3 count + 7, 0 FAIL. eslint `src/lib/curtain-cut-sheets/model.ts`.

- [ ] **Step 5: Commit** — `feat(cutsheets): #292 sheet model (title block, materials, plain description)`.

---

### Task 5: Curtain mounts store + Estimating Rules screen + catalog fabric facts

**Files:**
- Create: `src/lib/stores/curtain-mounts.ts`, `src/app/(app)/estimating-rules/curtain-mounts/page.tsx`, `.../curtain-mounts-client.tsx`, `.../actions.ts`
- Modify: `src/app/(app)/estimating-rules/page.tsx` (link card after the Track series card, ~line 157), `src/app/(app)/catalog/part-form.ts`, `src/app/(app)/catalog/fabric-rate-field.tsx`, `src/app/(app)/catalog/page.tsx:943-949`, `src/app/(app)/catalog/actions.ts:96-98`, `scripts/smoke-routes.ts` (ROUTES, after line 83)
- Test: `scripts/test-review-and-spec.ts` (append + one `.then` line)

**Interfaces:**
- Consumes: Task 3 `src/lib/curtain-mounts.ts`; Task 2 `mountDetail`, `ShapeSvg`; `PartPicker` + `EquipPartHit` (`src/app/(app)/design/grid/settings/equipment-map/part-picker.tsx`, `../actions`).
- Produces: `listCurtainMounts(): Promise<Partial<Record<CurtainMountTypeId, CurtainMountHardware>>>`; `saveCurtainMount(mountTypeId: unknown, rows: unknown, by: string, now?: number): Promise<{ ok: true; hardware: CurtainMountHardware } | { ok: false; error: string }>`; `saveCurtainMountAction(mountTypeId: string, rows: unknown)`; `OptionalPartFields` gains `oz`, `ozBasis`, `flameRating`; `FLAME_RATING_MAX = 120`; `fabricFactsProblem(category, unit, fields): string | null`; `async function curtain292AsyncChecks()` (harness).

- [ ] **Step 1: Append the failing checks** (pure + source + DB):

```ts
import { FLAME_RATING_MAX as c292FlameMax, fabricFactsProblem as c292FactsProblem, optionalPartFields as c292PartFields } from "@/app/(app)/catalog/part-form";
{
  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
  const full = c292PartFields(fd({ oz: "25", ozBasis: "sq-yd", flameRating: "  NFPA 701 (IFR)  " }));
  ok(full.oz === 25 && full.ozBasis === "sq-yd" && full.flameRating === "NFPA 701 (IFR)", "#292 catalog: weight (oz), basis and flame rating are read when submitted");
  const blank = c292PartFields(fd({ oz: "", ozBasis: "lin-yd", flameRating: "" }));
  ok("oz" in blank && blank.oz === undefined && blank.ozBasis === undefined && "flameRating" in blank && blank.flameRating === undefined,
    "#292 catalog: a submitted blank clears (basis clears with a blank oz)");
  ok(!("flameRating" in c292PartFields(fd({ desc: "x" }))) && c292PartFields(fd({ flameRating: "x".repeat(200) })).flameRating?.length === c292FlameMax && c292FlameMax === 120,
    "#292 catalog: absent fields stay out of the patch; a rating is capped at 120 chars");
  ok(c292FactsProblem("Hardware", "ea", { flameRating: "NFPA 701" }) !== null && c292FactsProblem("Fabric", "yd", { flameRating: "NFPA 701", oz: 25 }) === null && c292FactsProblem("Hardware", "ea", {}) === null,
    "#292 catalog: only a fabric part carries weight / flame rating");
}
{
  const rd292 = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  ok(rd292("src/app/(app)/estimating-rules/page.tsx").includes('href="/estimating-rules/curtain-mounts"'), "#292 source: Estimating Rules links Curtain mounts");
  const acts = rd292("src/app/(app)/estimating-rules/curtain-mounts/actions.ts");
  ok(acts.includes('requirePerm("manage_users")') && !acts.includes("requireUser("), "#292 source: the Curtain mounts action is manage_users-only");
  ok(rd292("src/app/(app)/estimating-rules/curtain-mounts/page.tsx").includes('can("manage_users"'), "#292 source: the Curtain mounts page gates on manage_users");
  ok(!/@\/lib\/stores\//.test(rd292("src/app/(app)/estimating-rules/curtain-mounts/curtain-mounts-client.tsx")), "#292 source: the Curtain mounts client imports no server store");
  ok(rd292("scripts/smoke-routes.ts").includes('"/estimating-rules/curtain-mounts"'), "#292 source: smoke covers /estimating-rules/curtain-mounts");
}

async function curtain292AsyncChecks(): Promise<void> {
  const { fixtureId: fid, registerFixture: reg } = await import("./test-fixtures");
  const { mergeUpsert } = await import("@/lib/stores/catalog");
  const { getBlob, setBlob } = await import("@/db/doc-store");
  const { CURTAIN_MOUNTS_BLOB } = await import("@/lib/curtain-mounts");
  const { listCurtainMounts, saveCurtainMount } = await import("@/lib/stores/curtain-mounts");
  const before = await getBlob<Record<string, unknown>>(CURTAIN_MOUNTS_BLOB, {});
  const TIE = fid(292, "tie-line");
  await mergeUpsert(TIE, { desc: "Test292 Tie line", category: "Test292 Hardware", unit: "ea", list: 2, cost: 1 });
  reg("catalog_parts", TIE);
  try {
    const saved = await saveCurtainMount("tie-batten", [{ sku: TIE, rule: { kind: "perMark", qty: 1 } }, { sku: "", rule: { kind: "perCurtain", qty: 1 } }], "Tester");
    ok(saved.ok && saved.hardware.rows.length === 1 && saved.hardware.updatedBy === "Tester", "#292 store: saveCurtainMount saves sanitized rows, stamped with who saved them");
    const back = await listCurtainMounts();
    ok(back["tie-batten"]?.rows[0]?.sku === TIE && back["tie-batten"]?.rows[0]?.rule.kind === "perMark", "#292 store: listCurtainMounts reads the row back");
    const gone = await saveCurtainMount("tie-batten", [{ sku: "NO-SUCH-292", rule: { kind: "perCurtain", qty: 1 } }], "Tester");
    ok(!gone.ok && gone.error.includes("NO-SUCH-292"), "#292 store: a SKU missing from the catalog is refused by name");
    const other = await saveCurtainMount("track-other", [], "Tester");
    ok(!other.ok, "#292 store: track-other (or any unknown id) is refused");
    // Task 6 appends the loadCutSheets checks here.
  } finally {
    const after = await getBlob<Record<string, unknown>>(CURTAIN_MOUNTS_BLOB, {});
    await setBlob(CURTAIN_MOUNTS_BLOB, Object.fromEntries(Object.keys(after).map((k) => [k, Object.prototype.hasOwnProperty.call(before, k) ? before[k] : null])));
  }
}
```

  And register it — add exactly one line in the promise chain (around line 10716), immediately after `.then(() => packages289AsyncChecks())`:

```ts
  .then(() => curtain292AsyncChecks())
```

  (`readFileSync` and `join` are top-level imports of the harness — `scripts/test-review-and-spec.ts:242-243` — so the `rd292*` helpers use them directly.)

- [ ] **Step 2: Run to verify it fails** — module `@/lib/stores/curtain-mounts` missing; `FLAME_RATING_MAX` not exported.

- [ ] **Step 3: Create `src/lib/stores/curtain-mounts.ts`:**

```ts
import { getBlob, setBlob } from "@/db/doc-store";
import { getMany } from "@/lib/stores/catalog";
import { CURTAIN_MOUNTS_BLOB, sanitizeCurtainMounts, sanitizeMountRows, type CurtainMountHardware } from "@/lib/curtain-mounts";
import { isMountTypeId, type CurtainMountTypeId } from "@/lib/curtain-cut-sheets/vocab";

/**
 * Curtain mounts store (#292 §1.6): blob `curtain_mount_hardware`, one
 * top-level key per mount type id, written per key through setBlob's jsonb
 * merge (track_series idiom). Starts EMPTY; nothing writes on its own.
 */
export async function listCurtainMounts(): Promise<Partial<Record<CurtainMountTypeId, CurtainMountHardware>>> {
  return sanitizeCurtainMounts(await getBlob<Record<string, unknown>>(CURTAIN_MOUNTS_BLOB, {}));
}

export type SaveCurtainMountResult = { ok: true; hardware: CurtainMountHardware } | { ok: false; error: string };

/** Re-sanitizes; refuses an unknown mount id and any SKU missing from the live catalog, by name (one getMany). */
export async function saveCurtainMount(mountTypeId: unknown, rows: unknown, by: string, now = Date.now()): Promise<SaveCurtainMountResult> {
  if (!isMountTypeId(mountTypeId)) return { ok: false, error: "Unknown mount type." };
  const clean = sanitizeMountRows(rows);
  const skus = [...new Set(clean.map((r) => r.sku))];
  const live = new Set(skus.length ? (await getMany(skus)).map((p) => p.sku) : []);
  const missing = skus.filter((s) => !live.has(s));
  if (missing.length) return { ok: false, error: `Not in the catalog: ${missing.join(", ")}.` };
  const hardware: CurtainMountHardware = { rows: clean, updatedBy: by, updatedAt: now };
  await setBlob(CURTAIN_MOUNTS_BLOB, { [mountTypeId]: hardware });
  return { ok: true, hardware };
}
```

- [ ] **Step 4: Create `src/app/(app)/estimating-rules/curtain-mounts/actions.ts`:**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { saveCurtainMount } from "@/lib/stores/curtain-mounts";

/** Estimating Rules → Curtain mounts (#292 §4.6). Admin (manage_users) only; the store re-sanitizes and re-checks the catalog. */
export async function saveCurtainMountAction(mountTypeId: string, rows: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requirePerm("manage_users");
  const r = await saveCurtainMount(mountTypeId, rows, user.name);
  if (!r.ok) return r;
  revalidatePath("/estimating-rules/curtain-mounts");
  return { ok: true };
}
```

- [ ] **Step 5: Create `src/app/(app)/estimating-rules/curtain-mounts/page.tsx`** (mirror `track-series/page.tsx`: same back link, title row, "Admin access required" card for non-admins):

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getMany } from "@/lib/stores/catalog";
import { listCurtainMounts } from "@/lib/stores/curtain-mounts";
import CurtainMountsClient, { type MountPartInfo } from "./curtain-mounts-client";

export const metadata = { title: "Curtain mounts — Estimating Rules — Quartzite-6" };
export const dynamic = "force-dynamic";

/**
 * Estimating Rules → Curtain mounts (#292 §4.6): the hardware each curtain
 * mount uses when a curtain has no track. Admin-only (manage_users). Reads
 * the blob and only its SKUs (one getMany); a SKU no longer in the catalog
 * shows as missing.
 */
export default async function CurtainMountsPage() {
  const user = await requireUser();
  const back = (
    <Link href="/estimating-rules" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>
      ← Estimating rules
    </Link>
  );
  if (!can("manage_users", user.roles)) {
    return (
      <div className="pk-content" style={{ maxWidth: 960 }}>
        {back}
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", margin: "6px 0 20px" }}>Curtain mounts</div>
        <div className="pk-card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Admin access required</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>
            Curtain mounts decide the hardware every cut sheet lists, so editing them is limited to admins.
          </div>
        </div>
      </div>
    );
  }
  const mounts = await listCurtainMounts();
  const skus = [...new Set(Object.values(mounts).flatMap((m) => (m?.rows ?? []).map((r) => r.sku)))];
  const parts: Record<string, MountPartInfo> = {};
  for (const p of skus.length ? await getMany(skus) : []) parts[p.sku] = { desc: p.desc, cost: p.cost || 0, unit: p.unit || "ea" };
  return (
    <div className="pk-content" style={{ maxWidth: 1000 }}>
      {back}
      <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", margin: "6px 0 6px" }}>Curtain mounts</div>
      <div style={{ fontSize: 13, color: "#8c919c", marginBottom: 18, lineHeight: 1.55 }}>
        The hardware each curtain mount uses when a curtain has no track. A tracked curtain lists its track&apos;s own parts instead.
      </div>
      <CurtainMountsClient mounts={mounts} parts={parts} />
    </div>
  );
}
```

- [ ] **Step 6: Create `src/app/(app)/estimating-rules/curtain-mounts/curtain-mounts-client.tsx`.** It imports only client-safe modules (`@/lib/curtain-mounts`, `@/lib/curtain-cut-sheets/vocab`, `@/lib/curtain-cut-sheets/mount-details`, `@/components/cutsheets/shape-svg`, `PartPicker`, `./actions`):

```tsx
"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { PartPicker } from "@/app/(app)/design/grid/settings/equipment-map/part-picker";
import { ShapeSvg } from "@/components/cutsheets/shape-svg";
import { MOUNT_RULE_LABELS, type CurtainMountHardware, type MountQtyRule } from "@/lib/curtain-mounts";
import { mountDetail, MOUNT_DETAIL_VIEWBOX } from "@/lib/curtain-cut-sheets/mount-details";
import { CURTAIN_MOUNT_TYPES, type CurtainMountTypeId } from "@/lib/curtain-cut-sheets/vocab";
import { saveCurtainMountAction } from "./actions";

export type MountPartInfo = { desc: string; cost: number; unit: string };
type Draft = { sku: string; kind: MountQtyRule["kind"]; qty: string; everyFt: string };

const INPUT: CSSProperties = { border: "1px solid #e4e7ec", borderRadius: 7, padding: "6px 8px", fontSize: 12.5, fontFamily: "inherit", background: "#fff", width: "100%", boxSizing: "border-box" };
const BTN: CSSProperties = { border: "1px solid #dfe2e8", background: "#fff", borderRadius: 7, padding: "6px 11px", fontSize: 12, fontWeight: 600, color: "#3d424e", cursor: "pointer", fontFamily: "inherit" };

const toDraft = (hw: CurtainMountHardware | undefined): Draft[] =>
  (hw?.rows ?? []).map((r) => ({ sku: r.sku, kind: r.rule.kind, qty: String(r.rule.qty), everyFt: r.rule.kind === "perFtWidth" ? String(r.rule.everyFt) : "" }));
const toRows = (d: Draft[]) =>
  d.filter((r) => r.sku).map((r) => ({ sku: r.sku, rule: r.kind === "perFtWidth" ? { kind: r.kind, qty: r.qty, everyFt: r.everyFt } : { kind: r.kind, qty: r.qty } }));

export default function CurtainMountsClient({ mounts, parts }: { mounts: Partial<Record<CurtainMountTypeId, CurtainMountHardware>>; parts: Record<string, MountPartInfo> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {CURTAIN_MOUNT_TYPES.map((t) => (
        <MountCard key={t.id} id={t.id} label={t.label} initial={toDraft(mounts[t.id])} parts={parts} />
      ))}
    </div>
  );
}

function MountCard({ id, label, initial, parts }: { id: CurtainMountTypeId; label: string; initial: Draft[]; parts: Record<string, MountPartInfo> }) {
  const router = useRouter();
  const [rows, setRows] = useState<Draft[]>(initial);
  const [known, setKnown] = useState<Record<string, MountPartInfo>>(parts);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const detail = mountDetail(id);
  const set = (i: number, patch: Partial<Draft>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = () =>
    start(async () => {
      const r = await saveCurtainMountAction(id, toRows(rows));
      setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
      if (r.ok) router.refresh();
    });
  return (
    <div className="pk-card" style={{ padding: "16px 18px", display: "grid", gridTemplateColumns: "120px 1fr", gap: 16 }}>
      <ShapeSvg idPrefix={`mount-${id}`} shapes={detail.shapes} labels={[]} viewBox={`0 0 ${MOUNT_DETAIL_VIEWBOX.w} ${MOUNT_DETAIL_VIEWBOX.h}`} hatch={6} style={{ width: 120, height: 150 }} title={detail.title} />
      <div>
        <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 10 }}>{label}</div>
        {rows.length === 0 && <div style={{ fontSize: 12.5, color: "#9aa0ab", marginBottom: 10 }}>No hardware yet — cut sheets for this mount print without a hardware table.</div>}
        {rows.map((r, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 70px 90px 28px", gap: 8, alignItems: "start", marginBottom: 8 }}>
            <div>
              <PartPicker sku={r.sku} showSku={false} onPick={(sku, hit) => { set(i, { sku }); setKnown((k) => ({ ...k, [sku]: { desc: hit.desc, cost: hit.cost, unit: hit.unit } })); }} />
              <div style={{ fontSize: 11.5, color: r.sku && !known[r.sku] ? "#a0442b" : "#8c919c", marginTop: 3 }}>
                {r.sku ? (known[r.sku] ? `${r.sku} · ${known[r.sku].desc}` : `${r.sku} — no longer in the catalog`) : "Pick a part"}
              </div>
            </div>
            <select value={r.kind} onChange={(e) => set(i, { kind: e.target.value as Draft["kind"] })} style={INPUT} aria-label="Quantity rule">
              {(Object.keys(MOUNT_RULE_LABELS) as Draft["kind"][]).map((k) => (
                <option key={k} value={k}>{MOUNT_RULE_LABELS[k]}</option>
              ))}
            </select>
            <input value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} inputMode="decimal" placeholder="Qty" aria-label="Qty" style={INPUT} />
            {r.kind === "perFtWidth" ? (
              <input value={r.everyFt} onChange={(e) => set(i, { everyFt: e.target.value })} inputMode="decimal" placeholder="every ft" aria-label="Every N feet" style={INPUT} />
            ) : (
              <span />
            )}
            <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} style={{ ...BTN, padding: "6px 8px" }} aria-label="Remove row">×</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
          <button type="button" style={BTN} onClick={() => setRows((rs) => [...rs, { sku: "", kind: "perCurtain", qty: "1", everyFt: "" }])}>+ Add part</button>
          <button type="button" style={{ ...BTN, background: "#16181d", color: "#fff", borderColor: "#16181d" }} disabled={pending} onClick={save}>{pending ? "Saving…" : "Save"}</button>
          {msg && <span style={{ fontSize: 12, color: msg.ok ? "#2f7a4a" : "#a0442b" }}>{msg.text}</span>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Link card** — in `src/app/(app)/estimating-rules/page.tsx`, immediately after the Track series `</Link>` (~line 168), add a sibling card copied from it with `href="/estimating-rules/curtain-mounts"`, title `Curtain mounts`, sub-copy `The hardware each curtain mount uses when a curtain has no track.`

- [ ] **Step 8: Catalog fabric facts.**
  - `part-form.ts`: extend `OptionalPartFields` with
    ```ts
    /** #292 — Fabric parts only: weight, its basis and flame rating (cut sheets). */
    oz?: number;
    ozBasis?: "lin-yd" | "sq-yd";
    flameRating?: string;
    ```
    export `export const FLAME_RATING_MAX = 120;` and, in `optionalPartFields` before the `portalVisibility` block:
    ```ts
    if (fd.has("oz")) out.oz = positive(fd.get("oz"));
    if (fd.has("ozBasis")) {
      const b = String(fd.get("ozBasis") || "");
      out.ozBasis = out.oz !== undefined && (b === "lin-yd" || b === "sq-yd") ? b : undefined;
    }
    if (fd.has("flameRating")) out.flameRating = String(fd.get("flameRating") || "").trim().slice(0, FLAME_RATING_MAX) || undefined;
    ```
    and add, next to `fabricRateProblem`:
    ```ts
    /** #292: only a fabric part carries weight / flame rating (the fields render only there; this is the server gate). */
    export function fabricFactsProblem(category: string, unit: string | null | undefined, f: Pick<OptionalPartFields, "oz" | "ozBasis" | "flameRating">): string | null {
      if (f.oz === undefined && f.ozBasis === undefined && f.flameRating === undefined) return null;
      return isFabricPart({ category, unit }) ? null : "Only a fabric part carries a weight or flame rating — clear them or change the category.";
    }
    ```
  - `actions.ts` (after the `rateProblem` redirect, ~line 98): `const factsProblem = fabricFactsProblem(category, unit, optional); if (factsProblem) redirect(\`/catalog?edit=${encodeURIComponent(sku)}&partError=${encodeURIComponent(factsProblem)}\`);` and import it.
  - `fabric-rate-field.tsx`: add props `initialOz: number | null`, `initialOzBasis: "lin-yd" | "sq-yd" | null`, `initialFlameRating: string | null`; state for each; render a third grid row before the help text: `Weight (oz)` input `name="oz"`, `Weight basis` `<select name="ozBasis">` with `lin-yd` → "per linear yard", `sq-yd` → "per square yard" (default `initialOzBasis ?? "lin-yd"`), and `Flame rating` input `name="flameRating"` `maxLength={120}` placeholder `NFPA 701 (IFR)`. Help line: "Weight and flame rating print on curtain cut sheets; blank prints nothing." Update the header comment (the named inputs are now six).
  - `catalog/page.tsx` (the `<FabricRateField …>` call ~line 943): pass `initialOz={part.oz ?? null}`, `initialOzBasis={part.ozBasis ?? null}`, `initialFlameRating={part.flameRating ?? null}`.

- [ ] **Step 9: Smoke route** — in `scripts/smoke-routes.ts` ROUTES, right after `"/estimating-rules/track-series", // #274 …`: `"/estimating-rules/curtain-mounts", // #292 — curtain-mount hardware (admin)`.

- [ ] **Step 10: Run the Gates.** Expected PASS = Task 4 count + 13 (4 catalog + 5 source + 4 DB), 0 FAIL. eslint: the 4 new files plus `"src/app/(app)/estimating-rules/page.tsx" "src/app/(app)/catalog/part-form.ts" "src/app/(app)/catalog/fabric-rate-field.tsx" "src/app/(app)/catalog/page.tsx" "src/app/(app)/catalog/actions.ts"`.

- [ ] **Step 11: Commit** — `feat(cutsheets): #292 Curtain mounts (store + Estimating Rules screen) and fabric weight/flame rating fields`.

---

### Task 6: Loader, renderer, staff Cut sheets page, Quotes hub entry

**Files:**
- Create: `src/lib/curtain-cut-sheets/load.ts`, `src/components/cutsheets/cut-sheet-pages.tsx`, `src/app/(app)/estimator/cut-sheets/page.tsx`
- Modify: `src/app/globals.css` (append a `pk-cs-*` block after the drawing-set print rules, ~line 1133), `src/app/(app)/quotes/page.tsx` (action strip, ~line 958), `scripts/smoke-routes.ts` (DYNAMIC_ROUTES, before the closing `];` ~line 314)
- Test: `scripts/test-review-and-spec.ts` (append source checks; extend `curtain292AsyncChecks`)

**Interfaces:**
- Consumes: Tasks 1–5; `get` (`stores/quotes`), `fabricParts`/`getMany` (`stores/catalog`), `listTrackSeries`, `listCurtainMounts`, `getProject` (`stores/grid-projects:324`), `get` (`stores/customers`), `getSettings`, `visibleImagesForParts` (`stores/part-documents:288`), `getBlobStream` (`@/lib/blob`), `quoteDocumentDataFor` (`src/lib/quote-pdf/quote-document-data.ts`, for custName / venueLabel / preparedByName / display number), `TitleBlock` (`src/components/drawing/title-block.tsx`), `PrintButton` (`src/components/letter/print-button.tsx`).
- Produces:
  - `load.ts`: `CUT_SHEET_PHOTOS_MAX = 6`; `type LoadedCutSheets = { ok: true; quote: Quote; result: CollectResult; models: Record<CutSheetStyle, CutSheetModel[]>; photos: Map<string, string[]> }`; `loadCutSheets(quoteId: string, opts: { images: "url" | "data" | "none" }): Promise<LoadedCutSheets | { ok: false; error: string }>`.
  - `cut-sheet-pages.tsx`: `SUBMITTAL_PRINT_CSS`, `CLIENT_PRINT_CSS`, `CutSheetPages({ models, style, photos }: { models: CutSheetModel[]; style: CutSheetStyle; photos: ReadonlyMap<string, string[]> })`.

- [ ] **Step 1: Append failing source checks** and extend `curtain292AsyncChecks` (insert before the `// Task 6 appends…` comment, replacing it):

```ts
{
  const rd292b = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  ok(rd292b("src/app/(app)/quotes/page.tsx").includes("/estimator/cut-sheets?id="), "#292 source: the Quotes hub action strip links Cut sheets");
  const pg = rd292b("src/app/(app)/estimator/cut-sheets/page.tsx");
  ok(pg.includes("requireUser()") && pg.includes("loadCutSheets("), "#292 source: the Cut sheets page is requireUser-gated and reads through loadCutSheets");
  const smoke = rd292b("scripts/smoke-routes.ts");
  ok(smoke.includes('"/estimator/cut-sheets?id=Q-2041"') && smoke.includes('"/estimator/cut-sheets?id=Q-2041&style=client"') && smoke.includes('"/estimator/cut-sheets?id=Q-0000", reject: "Application error"'),
    "#292 source: smoke covers both styles and the missing-quote page");
  const libDir = join(process.cwd(), "src/lib/curtain-cut-sheets");
  const libSrc = c292Readdir(libDir).map((f) => readFileSync(join(libDir, f), "utf8")).join("\n");
  ok(!/@anthropic-ai|@\/lib\/ai\b|from "@\/lib\/ai\//.test(libSrc), "#292 source: src/lib/curtain-cut-sheets imports no Anthropic SDK and no lib/ai (deterministic)");
}
```

  Add the import the harness's own idiom uses (each block aliases its `node:fs` names), next to the other `#292` imports: `import { readdirSync as c292Readdir } from "node:fs";`. `readFileSync` and `join` are already top-level imports (lines 242–243).

  DB checks to insert in `curtain292AsyncChecks` (inside the `try`, where the Task 5 comment sits):

```ts
    const { createFixture } = await import("./test-fixtures");
    const { loadCutSheets } = await import("@/lib/curtain-cut-sheets/load");
    const FAB = fid(292, "fabric");
    await mergeUpsert(FAB, { desc: "Test292 Velour 25 oz", category: "Fabric", unit: "yd", list: 10, cost: 5, oz: 25, ozBasis: "lin-yd", boltWidthIn: 54 });
    reg("catalog_parts", FAB);
    const QID = fid(292, "quote");
    const ci = { name: "Test292 Main", fabricSku: FAB, fabricName: "Test292 Velour 25 oz", qty: "1", width: "20", height: "18", fullness: "50" };
    const track = (key: string, id: number) => ({
      id, sku: "TRK-X", desc: "track", qty: 1, unit: "lot", cost: 1, price: 2, curtainTrackKey: key,
      track: { seriesId: "test292-gone", operation: "oneway", runFt: 20, curved: false, mounting: "batten", qty: 1 },
      components: [{ sku: "T292-CARRIER", label: "Carrier", role: "other", qty: 20, unit: "ea", cost: 1, price: 2 }],
    });
    await createFixture("quotes", {
      id: QID, name: "T292 cut sheets", customer: "", customerId: null, status: "draft", source: "estimator", quoteType: "system",
      owner: "Tester", preparedBy: "Tester", value: 0, margin: 0, history: [], createdAt: 1, updatedAt: 1,
      spec: { sections: [{ id: "s1", name: "Drapery", kind: "materials", mfr: "", freightPct: 0, items: [
        { id: 1, sku: "CRT-1", desc: "x", qty: 1, unit: "ea", cost: 1, price: 2, curtain: true, curtainInputs: ci, curtainTrackKey: "ct-1" }, track("ct-1", 2),
        { id: 3, sku: "CRT-3", desc: "x", qty: 1, unit: "ea", cost: 1, price: 2, curtain: true, curtainInputs: ci, curtainTrackKey: "ct-3" }, track("ct-3", 4),
      ] }], mobs: [] },
    } as never);
    const loaded = await loadCutSheets(QID, { images: "none" });
    ok(loaded.ok && loaded.result.types.length === 1 && loaded.result.types[0].totalQty === 2 && loaded.result.types[0].hardware.find((h) => h.sku === "T292-CARRIER")?.qty === 40,
      "#292 load: two identical keyed curtain lines read as one type with both tracks' components");
    ok(loaded.ok && loaded.models.submittal[0].titleBlock?.sheet.number === "CS-1" && loaded.models.client[0].description.startsWith("Two Test292 Main panels") && loaded.photos.size === 0,
      "#292 load: both styles are modelled; no photos when images are 'none'");
    const missing = await loadCutSheets(fid(292, "no-such-quote"), { images: "none" });
    ok(!missing.ok && missing.error === "Quote not found.", "#292 load: an unknown quote id reads 'Quote not found.'");
```

- [ ] **Step 2: Run to verify it fails** (module `load` missing / Quotes hub string absent).

- [ ] **Step 3: Create `src/lib/curtain-cut-sheets/load.ts`:**

```ts
/**
 * Curtain cut sheets (#292 §3) — the one server loader. SERVER ONLY (reads
 * stores and blobs): never import from a client component.
 */
import { getBlobStream } from "@/lib/blob";
import { fabricParts, getMany } from "@/lib/stores/catalog";
import { listCurtainMounts } from "@/lib/stores/curtain-mounts";
import { get as getCustomer } from "@/lib/stores/customers";
import { getProject } from "@/lib/stores/grid-projects";
import { visibleImagesForParts } from "@/lib/stores/part-documents";
import { get as getQuote, type Quote } from "@/lib/stores/quotes";
import { listTrackSeries } from "@/lib/stores/track-series";
import { getSettings } from "@/lib/settings";
import { quoteDocumentDataFor } from "@/lib/quote-pdf/quote-document-data";
import type { PartDocument } from "@/lib/part-docs/types";
import { collectCurtainTypes, type CollectInput, type CollectResult } from "./collect";
import { CUT_SHEETS_NO_QUOTE, CUT_SHEETS_WRONG_TYPE, cutSheetModel, isCutSheetQuoteType, type CutSheetModel, type CutSheetStyle } from "./model";

export const CUT_SHEET_PHOTOS_MAX = 6;
export type LoadedCutSheets = { ok: true; quote: Quote; result: CollectResult; models: Record<CutSheetStyle, CutSheetModel[]>; photos: Map<string, string[]> };

export async function loadCutSheets(quoteId: string, opts: { images: "url" | "data" | "none" }): Promise<LoadedCutSheets | { ok: false; error: string }> {
  const quote = quoteId ? await getQuote(quoteId) : null;
  if (!quote) return { ok: false, error: CUT_SHEETS_NO_QUOTE };
  if (!isCutSheetQuoteType(quote.quoteType)) return { ok: false, error: CUT_SHEETS_WRONG_TYPE };
  const spec = (quote.spec || {}) as { kind?: unknown; gridProjectId?: unknown; sections?: unknown };
  const isGrid = !(Array.isArray(spec.sections) && spec.sections.length) && spec.kind === "grid";
  const [fabricRows, trackSeries, mounts, settings, customer, project] = await Promise.all([
    fabricParts(),
    listTrackSeries(),
    listCurtainMounts(),
    getSettings(),
    getCustomer(quote.customerId),
    isGrid && typeof spec.gridProjectId === "string" ? getProject(spec.gridProjectId) : Promise.resolve(null),
  ]);
  const base: CollectInput = {
    quote,
    fabrics: fabricRows.map((p) => ({ sku: p.sku, desc: p.desc, oz: p.oz, ozBasis: p.ozBasis, boltWidthIn: p.boltWidthIn, flameRating: p.flameRating })),
    trackSeries,
    mounts,
    partInfo: new Map(),
    grid: isGrid ? { project } : null,
  };
  // Pass 1 names the hardware SKUs; one getMany reads their live desc/unit; pass 2 prints them.
  const first = collectCurtainTypes(base);
  const skus = [...new Set(first.types.flatMap((t) => t.hardware.map((h) => h.sku)))];
  const result = skus.length
    ? collectCurtainTypes({ ...base, partInfo: new Map((await getMany(skus)).map((p) => [p.sku, { desc: p.desc, unit: p.unit || "ea" }])) })
    : first;

  const doc = quoteDocumentDataFor(quote, customer, settings);
  const now = Date.now();
  const total = result.types.length;
  const ctx = (style: CutSheetStyle, index: number) => ({
    style,
    quote: { id: quote.id, number: doc.quoteId, name: quote.name || "", customer: doc.custName, venue: doc.venueLabel, revisions: quote.revisions },
    company: { name: settings.companyName, logoDark: settings.logoDark ?? null, offices: settings.offices },
    preparedBy: doc.preparedByName,
    index,
    total,
    now,
  });
  const models: Record<CutSheetStyle, CutSheetModel[]> = {
    submittal: result.types.map((t, i) => cutSheetModel(t, ctx("submittal", i + 1))),
    client: result.types.map((t, i) => cutSheetModel(t, ctx("client", i + 1))),
  };
  const photos = opts.images === "none" ? new Map<string, string[]>() : await cutSheetPhotos(result, opts.images);
  return { ok: true, quote, result, models, photos };
}

/** Per sheet: the fabric SKU, then the hardware SKUs — first visible image each, at most 6. A failed read drops that photo, never the page. */
async function cutSheetPhotos(result: CollectResult, mode: "url" | "data"): Promise<Map<string, string[]>> {
  const wanted = new Map(
    result.types.map((t) => [t.sheetNo, [...new Set([t.curtains[0].fabric?.sku, ...t.hardware.map((h) => h.sku)].filter((s): s is string => !!s))]] as const)
  );
  const all = [...new Set([...wanted.values()].flat())];
  const images = all.length ? await visibleImagesForParts(all) : new Map<string, PartDocument[]>();
  const cache = new Map<string, string | null>();
  const out = new Map<string, string[]>();
  for (const [sheet, skus] of wanted) {
    const urls: string[] = [];
    for (const sku of skus) {
      if (urls.length >= CUT_SHEET_PHOTOS_MAX) break;
      const doc = images.get(sku)?.[0];
      if (!doc) continue;
      let src = cache.get(doc.id);
      if (src === undefined) {
        src = mode === "url" ? `/api/part-documents/${encodeURIComponent(doc.id)}` : await dataUrlOf(doc);
        cache.set(doc.id, src);
      }
      if (src && !urls.includes(src)) urls.push(src);
    }
    if (urls.length) out.set(sheet, urls);
  }
  return out;
}

/** Headless Chrome has no session, so the print route inlines images (≤ 1600 px WebP since #283). */
async function dataUrlOf(doc: PartDocument): Promise<string | null> {
  try {
    if (!doc.blobKey) return null;
    const stream = await getBlobStream(doc.blobKey);
    if (!stream) return null;
    const bytes = Buffer.from(await new Response(stream).arrayBuffer());
    return `data:${doc.contentType || "image/webp"};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}
```

  (`PartDocument` is exported from `src/lib/part-docs/types.ts:60`; it carries `id`, `blobKey`, `contentType`.)

- [ ] **Step 4: Create `src/components/cutsheets/cut-sheet-pages.tsx`** (no `"use client"`; server-renderable; no `waitFor` needed by `PrintButton`):

```tsx
import type { CSSProperties } from "react";
import { TitleBlock } from "@/components/drawing/title-block";
import { cutSheetCssVars, type CutSheetModel, type CutSheetStyle } from "@/lib/curtain-cut-sheets/model";
import { MOUNT_DETAIL_VIEWBOX } from "@/lib/curtain-cut-sheets/mount-details";
import { ShapeSvg } from "./shape-svg";

/** Submittal: one Letter-landscape sheet per page, edge to edge. */
export const SUBMITTAL_PRINT_CSS = `@media print { @page { size: 11in 8.5in; margin: 0; } html, body { background: #fff !important; margin: 0; } nextjs-portal { display: none !important; } .pk-no-print { display: none !important; } .pk-cs-set { zoom: 1 !important; display: block !important; padding: 0 !important; } }`;
/** Client: Letter portrait at the quote's own 0.6in margins (QUOTE_PRINT_CSS), so the pages can follow the estimate. */
export const CLIENT_PRINT_CSS = `@media print { @page { size: letter; margin: 0.6in; } html, body { background: #fff !important; margin: 0; } nextjs-portal { display: none !important; } .pk-no-print { display: none !important; } .pk-cs-set { display: block !important; padding: 0 !important; } .pk-cs-client { box-shadow: none !important; padding: 0 !important; width: auto !important; margin: 0 !important; } }`;

const detailBox = `0 0 ${MOUNT_DETAIL_VIEWBOX.w} ${MOUNT_DETAIL_VIEWBOX.h}`;

export function CutSheetPages({ models, style, photos }: { models: CutSheetModel[]; style: CutSheetStyle; photos: ReadonlyMap<string, string[]> }) {
  return (
    <div className="pk-cs-set" data-style={style}>
      {models.map((m) => (style === "submittal" ? <SubmittalSheet key={m.sheetNo} m={m} /> : <ClientSheet key={m.sheetNo} m={m} photos={photos.get(m.sheetNo) ?? []} />))}
    </div>
  );
}

function Elevation({ m, maxHeight }: { m: CutSheetModel; maxHeight: string }) {
  const { box } = m.elevation;
  return (
    <ShapeSvg idPrefix={`${m.sheetNo}-${m.style}-elev`} shapes={m.elevation.shapes} viewBox={`0 0 ${box.wIn} ${box.hIn}`} hatch={0.05} style={{ width: "100%", height: "auto", maxHeight }} title={`Elevation — ${m.title}`} />
  );
}

function SizeTable({ m }: { m: CutSheetModel }) {
  return (
    <table className="pk-dw-table">
      <thead>
        <tr><th>Finished size</th><th style={{ textAlign: "right" }}>Qty</th></tr>
      </thead>
      <tbody>
        {m.sizes.map((s) => (
          <tr key={s.size}><td>{s.size}</td><td style={{ textAlign: "right" }}>{s.qty}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function SubmittalSheet({ m }: { m: CutSheetModel }) {
  return (
    <section className="pk-drawing-sheet" data-sheet={m.sheetNo} style={cutSheetCssVars() as CSSProperties}>
      <div className="pk-drawing-frame">
        <div className="pk-drawing-area">
          <div className="pk-cs-grid">
            <div className="pk-cs-cell">
              <h2 className="pk-dw-h">{`Elevation — ${m.title}`}</h2>
              <Elevation m={m} maxHeight="3.9in" />
              <div className="pk-dw-mono">{`Elevation ${m.elevation.scale}`}</div>
            </div>
            <div className="pk-cs-cell">
              <h2 className="pk-dw-h">{`Mounting detail — ${m.mount.label}`}</h2>
              <ShapeSvg idPrefix={`${m.sheetNo}-detail`} shapes={m.mount.detail.shapes} labels={m.mount.detail.labels} viewBox={detailBox} hatch={6} style={{ width: "100%", height: "auto", maxHeight: "3.4in" }} title={m.mount.detail.title} />
              {m.mount.detail.note && <div style={{ fontStyle: "italic" }}>{m.mount.detail.note}</div>}
              <div className="pk-dw-mono">NTS</div>
            </div>
            <div className="pk-cs-cell">
              <h2 className="pk-dw-h">Materials</h2>
              <table className="pk-dw-table">
                <tbody>
                  {m.materials.map((r) => (
                    <tr key={r.label}><th style={{ textAlign: "left", width: "30%" }}>{r.label}</th><td>{r.value}</td></tr>
                  ))}
                </tbody>
              </table>
              {m.sizes.length > 1 && (
                <>
                  <h2 className="pk-dw-h" style={{ marginTop: "6pt" }}>Size schedule</h2>
                  <SizeTable m={m} />
                </>
              )}
            </div>
            <div className="pk-cs-cell">
              {m.hardware.length > 0 && (
                <>
                  <h2 className="pk-dw-h">Mounting hardware</h2>
                  <table className="pk-dw-table">
                    <thead>
                      <tr><th>Part</th><th>Description</th><th style={{ textAlign: "right" }}>Qty</th><th>Unit</th></tr>
                    </thead>
                    <tbody>
                      {m.hardware.map((h) => (
                        <tr key={h.sku}><td className="pk-dw-mono">{h.sku}</td><td>{h.desc}</td><td style={{ textAlign: "right" }}>{h.qty.toLocaleString("en-US")}</td><td>{h.unit}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>
        </div>
        {m.titleBlock && <TitleBlock data={m.titleBlock} />}
      </div>
    </section>
  );
}

function ClientSheet({ m, photos }: { m: CutSheetModel; photos: string[] }) {
  return (
    <section className="pk-cs-client" data-sheet={m.sheetNo}>
      <header className="pk-cs-head">
        {m.header.logoDark ? (
          // Data-URL brand mark from Settings → Branding (title-block idiom).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.header.logoDark} alt={m.header.companyName || "Company logo"} style={{ maxHeight: "0.5in", maxWidth: "2.2in" }} />
        ) : (
          <strong>{m.header.companyName}</strong>
        )}
        <span>{`Curtain cut sheet · ${m.header.estimateNo}`}</span>
      </header>
      <h1 className="pk-cs-title">{m.title}</h1>
      <Elevation m={m} maxHeight="3.6in" />
      <p className="pk-cs-desc">{m.description}</p>
      <div className="pk-cs-row">
        <div>
          <h2 className="pk-dw-h">How it hangs</h2>
          <ShapeSvg idPrefix={`${m.sheetNo}-client-detail`} shapes={m.mount.detail.shapes} labels={m.mount.detail.labels} viewBox={detailBox} hatch={6} style={{ width: "2.4in", height: "3in" }} title={m.mount.detail.title} />
        </div>
        <div style={{ flex: 1 }}>
          <h2 className="pk-dw-h">Sizes</h2>
          <SizeTable m={m} />
        </div>
      </div>
      {photos.length > 0 && (
        <div className="pk-cs-photos">
          {photos.map((src) => (
            // Part photos from the catalog (or inlined data: URLs on the print route).
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" />
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: CSS** — append to `src/app/globals.css` after the drawing-set `@media print` block:

```css
/* Curtain cut sheets (#292). Submittal reuses .pk-drawing-sheet with its own
   Letter-landscape variables (cutSheetCssVars); Client is Letter portrait. */
.pk-cs-set { display: flex; flex-direction: column; align-items: center; gap: 28px; padding-bottom: 40px; }
@media screen { .pk-cs-set[data-style="submittal"] { zoom: 0.85; } }
.pk-cs-grid { display: grid; grid-template-columns: 60fr 40fr; grid-template-rows: 55% 45%; gap: 0.12in; height: 100%; }
.pk-cs-cell { min-width: 0; min-height: 0; overflow: hidden; }
.pk-cs-client { width: 8.5in; box-sizing: border-box; padding: 0.6in; background: #fff; color: #16181d; font-family: var(--font-ui), system-ui, sans-serif; font-size: 10pt; line-height: 1.45; box-shadow: 0 2px 14px rgba(0, 0, 0, 0.1); break-before: page; page-break-before: always; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pk-cs-head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--accent); padding-bottom: 6pt; margin-bottom: 10pt; font-size: 9pt; color: #5b616e; }
.pk-cs-title { font-size: 16pt; font-weight: 700; margin: 0 0 8pt; }
.pk-cs-desc { margin: 8pt 0 12pt; }
.pk-cs-row { display: flex; gap: 0.3in; align-items: flex-start; }
.pk-cs-photos { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12pt; }
.pk-cs-photos img { width: 1.1in; height: 1.1in; object-fit: contain; border: 1px solid #e4e7ec; border-radius: 4px; background: #fff; }
@media print {
  .pk-cs-set .pk-drawing-sheet { box-shadow: none !important; break-after: page; page-break-after: always; }
  .pk-cs-set .pk-drawing-sheet:last-child { break-after: auto; page-break-after: auto; }
}
```

- [ ] **Step 6: Create `src/app/(app)/estimator/cut-sheets/page.tsx`:**

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { quoteBuilderHref } from "@/lib/quote-links";
import { PrintButton } from "@/components/letter/print-button";
import { CutSheetPages, CLIENT_PRINT_CSS, SUBMITTAL_PRINT_CSS } from "@/components/cutsheets/cut-sheet-pages";
import { loadCutSheets } from "@/lib/curtain-cut-sheets/load";
import { CUT_SHEETS_NONE, type CutSheetStyle } from "@/lib/curtain-cut-sheets/model";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cut sheets — Quartzite-6" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";
const LINK = { fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--accent)", textDecoration: "none" } as const;

/** Curtain cut sheets (#292 §4.2): /estimator/cut-sheets?id=<quoteId>&style=submittal|client. */
export default async function CutSheetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const id = first(sp.id);
  const style: CutSheetStyle = first(sp.style) === "client" ? "client" : "submittal";
  const [loaded, settings] = await Promise.all([loadCutSheets(id, { images: style === "client" ? "url" : "none" }), getSettings()]);
  const accent = settings.accent || "#b08d4a";
  if (!loaded.ok) {
    return (
      <div className="pk-content" style={{ maxWidth: 960 }}>
        <div className="pk-card" style={{ padding: "48px 24px", textAlign: "center", fontSize: 15, fontWeight: 600 }}>{loaded.error}</div>
      </div>
    );
  }
  const { quote, result, models, photos } = loaded;
  const back = quoteBuilderHref(quote);
  const editHref = `/estimator?id=${encodeURIComponent(quote.id)}`;
  const curtains = result.types.reduce((a, t) => a + t.totalQty, 0);
  const href = (s: CutSheetStyle) => `/estimator/cut-sheets?id=${encodeURIComponent(quote.id)}&style=${s}`;
  const warnings = result.types.flatMap((t) => t.warnings.map((w) => `${t.sheetNo} ${t.title}: ${w}`));
  const hasPanel = result.unreadable.length + result.skippedOptional.length + warnings.length + result.notes.length > 0;
  return (
    <div className="pk-content" style={{ maxWidth: "none", padding: "22px 24px 64px" }}>
      <style>{style === "submittal" ? SUBMITTAL_PRINT_CSS : CLIENT_PRINT_CSS}</style>
      <div className="pk-doc-toolbar pk-no-print" style={{ maxWidth: "none", justifyContent: "flex-start", flexWrap: "wrap", gap: 14 }}>
        <Link href={back} style={LINK}>← Back to estimate</Link>
        <span style={{ display: "inline-flex", gap: 8 }}>
          <Link href={href("submittal")} style={{ ...LINK, fontWeight: style === "submittal" ? 700 : 400 }}>Submittal</Link>
          <Link href={href("client")} style={{ ...LINK, fontWeight: style === "client" ? 700 : 400 }}>Client</Link>
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: "#8c919c", fontFamily: "var(--font-ui)" }}>
          {`${result.types.length} curtain type${result.types.length === 1 ? "" : "s"} · ${curtains} curtain${curtains === 1 ? "" : "s"}`}
        </span>
        {result.types.length > 0 && <PrintButton accent={accent} />}
      </div>
      {hasPanel && (
        <div className="pk-card pk-no-print" style={{ padding: "14px 18px", margin: "12px 0 18px", fontSize: 13, lineHeight: 1.55 }}>
          {result.notes.map((n) => <div key={n} style={{ color: "#8a6d1f" }}>{n}</div>)}
          {result.unreadable.map((u) => (
            <div key={u.ref}>
              {`${u.where} — ${u.desc}: ${u.reason} `}
              <Link href={editHref} style={LINK}>Edit the curtain →</Link>
            </div>
          ))}
          {result.skippedOptional.map((o) => <div key={o.ref} style={{ color: "#5b616e" }}>{`Left out (optional line): ${o.where} — ${o.desc}`}</div>)}
          {warnings.map((w) => <div key={w} style={{ color: "#8a6d1f" }}>{w}</div>)}
        </div>
      )}
      {result.types.length === 0 ? (
        <div className="pk-card" style={{ padding: "48px 24px", textAlign: "center", fontSize: 15, fontWeight: 600 }}>{CUT_SHEETS_NONE}</div>
      ) : (
        <CutSheetPages models={models[style]} style={style} photos={photos} />
      )}
    </div>
  );
}
```

  (`quoteBuilderHref(q: { id: string; quoteType?: string | null })` — `src/lib/quote-links.ts:13-15`; a `Quote` satisfies it.)

- [ ] **Step 7: Quotes hub** — in `src/app/(app)/quotes/page.tsx`, directly after the "Spec from this quote →" `Link` block (~line 961):

```tsx
        {(!q.quoteType || q.quoteType === "system") && (
          <Link href={`/estimator/cut-sheets?id=${encodeURIComponent(q.id)}`} className="pk-btn-outline">
            Cut sheets →
          </Link>
        )}
```

- [ ] **Step 8: Smoke** — `scripts/smoke-routes.ts` DYNAMIC_ROUTES, before the closing `];`:

```ts
  // #292 — curtain cut sheets (both styles; an unknown id renders "Quote not found." with a 200).
  { route: "/estimator/cut-sheets?id=Q-2041" },
  { route: "/estimator/cut-sheets?id=Q-2041&style=client" },
  { route: "/estimator/cut-sheets?id=Q-0000", reject: "Application error" },
```

- [ ] **Step 9: Run the Gates.** Expected PASS = Task 5 count + 7 (4 source + 3 DB), 0 FAIL. eslint: `src/lib/curtain-cut-sheets/load.ts src/components/cutsheets/cut-sheet-pages.tsx "src/app/(app)/estimator/cut-sheets/page.tsx" "src/app/(app)/quotes/page.tsx"` (CSS isn't linted).

- [ ] **Step 10: Commit** — `feat(cutsheets): #292 loader, Submittal/Client renderer, /estimator/cut-sheets page, Quotes hub entry`.

---

### Task 7: Editing curtains — Estimator modal, structured inputs, keys, Edit curtain, toolbar; Grid drop dialog

**Files:**
- Create: `src/app/(app)/estimator/curtain-line.ts`
- Modify: `src/app/(app)/estimator/types.ts` (`CurtainDraft`, ~line 259), `src/app/(app)/estimator/track-bom.ts` (`replaceTrackLine` ~184 + new `replaceCurtainLine`), `src/app/(app)/estimator/curtain-modal.tsx`, `src/app/(app)/estimator/section-card.tsx` (~170, ~920, ~1300), `src/app/(app)/estimator/estimator-client.tsx` (**shared with #293 — localized edits only**: `freshCurtain` ~235, curtain edit ref/state next to `trackEditRef` ~688, `discardDraft`/`seedDraft` curtain branches ~1863/1889, `openCurtainEdit` next to `openTrackEdit` ~2007, `addCurtain` ~2249, the toolbar button next to "Customer preview →" ~2786, `<CurtainModal>` ~3970, `<SectionCard onEditCurtain>` ~3777), `src/app/(app)/design/grid/[id]/curtain-drop.tsx`, `src/app/(app)/design/grid/[id]/actions.ts:506-558`
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:**
- Consumes: Task 1 vocab + `newCurtainTrackKey` + `parseEstimatorCurtainDesc` + `linkCurtainTracks`; `computeCurtain` / `CurtainCalc` (`estimator/pricing.ts:442-488`); `curtainSpecKey` (`@/lib/specs/record-keys`).
- Produces:
  - `CurtainDraft` gains `topFinish: string; bottomFinish: string; mountType: string` (strings while editing, like every draft).
  - `curtain-line.ts`: `curtainDraftFromLine(it: SpecItem, fallbackFabric: string): CurtainDraft`; `curtainItem(d: CurtainDraft, c: Pick<CurtainCalc, "fab" | "costEach" | "priceEach">, ids: { id: number; sku: string; trackKey?: string }): SpecItem`; `applyCurtainEdit(sec: SpecSection, lineId: number, item: SpecItem, track: SpecItem | null): SpecSection`.
  - `track-bom.ts`: `replaceCurtainLine(sec: SpecSection, lineId: number, item: SpecItem): SpecSection`; `replaceTrackLine` keeps `curtainTrackKey`.
  - `section-card.tsx`: prop `onEditCurtain?: (lineId: number) => void`.
  - `curtain-modal.tsx`: props `editing` (now passed), `linkedTrack?: string | null` (the linked track's mounting label, when editing a curtain that already has a track).

- [ ] **Step 1: Append failing checks:**

```ts
import { applyCurtainEdit as c292ApplyEdit, curtainDraftFromLine as c292DraftFrom, curtainItem as c292Item } from "@/app/(app)/estimator/curtain-line";
import { replaceCurtainLine as c292ReplaceCurtain, replaceTrackLine as c292ReplaceTrack } from "@/app/(app)/estimator/track-bom";
{
  const draft = { name: "Main Drape", hang: "Pipe", fabric: "FAB-CH25", qty: "2", height: "18", width: "21.5", fullness: "50", bottom: "Chain", topFinish: "grommets", bottomFinish: "chain", mountType: "tie-batten" };
  const fab = { sku: "FAB-CH25", name: "Charisma Velour 25 oz", costPerSqft: 0 };
  const it = c292Item(draft, { fab, costEach: 100, priceEach: 150 }, { id: 7, sku: "CRT-8", trackKey: "ct-7" });
  ok(it.desc === C292_DESC && it.qty === 2 && it.curtain === true && it.curtainTrackKey === "ct-7" && it.sku === "CRT-8",
    "#292 edit: curtainItem keeps addCurtain's exact desc format and carries the track key");
  ok(it.curtainInputs?.width === "21.5" && it.curtainInputs.fabricSku === "FAB-CH25" && it.curtainInputs.topFinish === "grommets" && it.curtainInputs.bottomFinish === "chain" && it.curtainInputs.mountType === "tie-batten" && it.curtainInputs.fullness === "50",
    "#292 edit: curtainItem stores structured curtainInputs (with finishes and mount)");
  const fromStructured = c292DraftFrom(it, "FAB-X");
  ok(fromStructured.width === "21.5" && fromStructured.height === "18" && fromStructured.fabric === "FAB-CH25" && fromStructured.mountType === "tie-batten", "#292 edit: the edit draft seeds from curtainInputs");
  const legacy = c292DraftFrom({ id: 1, sku: "CRT-1", desc: C292_DESC, qty: 3, unit: "ea", cost: 1, price: 2, curtain: true }, "FAB-X");
  ok(legacy.name === "Main Drape" && legacy.width === "21.5" && legacy.fullness === "50" && legacy.qty === "3" && legacy.topFinish === "grommets", "#292 edit: a legacy line seeds from its parsed desc");
  const unreadable = c292DraftFrom({ id: 1, sku: "CRT-1", desc: "Main Drape — hand edited", qty: 1, unit: "ea", cost: 1, price: 2, curtain: true }, "FAB-X");
  ok(unreadable.name === "Main Drape" && unreadable.width === "" && unreadable.height === "", "#292 edit: an unreadable line seeds its name only, W/H blank");
  const old: C292Item = { ...it, id: 41, lineOrder: 3, comment: "c", internalNote: "n", option: true, curtainTrackKey: "ct-41", specKey: "SK", por: true, portalConfirm: true, sku: "CRT-OLD" };
  const sec = c292Sec("s", [old as C292Item & { id: number }]);
  const replaced = c292ReplaceCurtain(sec, 41, { ...it, desc: "new" }).items[0];
  ok(replaced.id === 41 && replaced.lineOrder === 3 && replaced.comment === "c" && replaced.internalNote === "n" && replaced.option === true && replaced.curtainTrackKey === "ct-41" && replaced.specKey === "SK" && replaced.por === true && replaced.portalConfirm === true && replaced.sku === "CRT-OLD" && replaced.desc === "new",
    "#292 edit: replaceCurtainLine keeps id, order, notes, option, key, specKey, por/portalConfirm and SKU");
  const withTrack = c292ApplyEdit(c292Sec("s", [{ ...it, id: 50, curtainTrackKey: undefined }, { id: 51 }]), 50, { ...it, curtainTrackKey: undefined }, { id: 99, sku: "TRK", desc: "t", qty: 1, unit: "lot", cost: 1, price: 2, track: { ...C292_TRACK } });
  ok(withTrack.items.map((x) => x.id).join() === "50,99,51" && withTrack.items[0].curtainTrackKey === "ct-50" && withTrack.items[1].curtainTrackKey === "ct-50",
    "#292 edit: Add track while editing inserts a keyed track line right after the curtain");
  const t2 = c292ReplaceTrack(c292Sec("s", [{ id: 5, track: { ...C292_TRACK }, curtainTrackKey: "ct-4" }]), 5, { sku: "TRK", desc: "t", qty: 1, unit: "lot", cost: 1, price: 2, track: { ...C292_TRACK } });
  ok(t2.items[0].curtainTrackKey === "ct-4", "#292 edit: Update track keeps the curtain-track key");
  const rd292c = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const est = rd292c("src/app/(app)/estimator/estimator-client.tsx");
  ok(/curtainItem\(/.test(est) && /newCurtainTrackKey\(/.test(est), "#292 source: addCurtain writes curtainInputs + curtainTrackKey through curtainItem");
  ok(/<CurtainModal[\s\S]{0,400}editing=\{/.test(est), "#292 source: CurtainModal receives editing");
  ok(rd292c("src/app/(app)/estimator/section-card.tsx").includes("onEditCurtain"), "#292 source: curtain lines get an ✎ (onEditCurtain)");
  ok(/cleanCurtainFinishes\(/.test(rd292c("src/app/(app)/design/grid/[id]/actions.ts")), "#292 source: placeCurtainAction validates finishes/mount through cleanCurtainFinishes");
}
```

- [ ] **Step 2: Run to verify it fails** (`curtain-line` missing, `replaceCurtainLine` not exported).

- [ ] **Step 3: `types.ts`** — `CurtainDraft` gains (after `bottom: string;`):

```ts
  /** #292 — "grommets" | "pipe-pocket" | "hook-loop" (vocab.ts). `hang` and `bottom` above are legacy and read by nothing. */
  topFinish: string;
  /** #292 — "chain" | "pipe-pocket" | "hem". */
  bottomFinish: string;
  /** #292 — a CURTAIN_MOUNT_TYPES id; used only when no track is linked. */
  mountType: string;
```

- [ ] **Step 4: `track-bom.ts`.** In `replaceTrackLine`, after `if (old.option) next.option = old.option;` add `if (old.curtainTrackKey) next.curtainTrackKey = old.curtainTrackKey;`. Then add below it:

```ts
/**
 * #292 Update curtain: the curtain line `lineId` replaced IN PLACE by `item`
 * (re-priced at today's rates). Kept from the old line: id, lineOrder, SKU,
 * customer comment, internal note, optional flag, curtain-track key, spec key,
 * and por / portalConfirm (clearPricedPor still decides those on Save). A line
 * no longer there is appended instead. Pure.
 */
export function replaceCurtainLine(sec: SpecSection, lineId: number, item: SpecItem): SpecSection {
  const at = sec.items.findIndex((it) => it.id === lineId);
  if (at < 0) return { ...sec, items: [...sec.items, { ...item, id: lineId }] };
  const old = sec.items[at];
  const next: SpecItem = { ...item, id: old.id, sku: old.sku || item.sku };
  if (typeof old.lineOrder === "number") next.lineOrder = old.lineOrder;
  for (const k of ["comment", "internalNote", "curtainTrackKey", "specKey"] as const) {
    if (old[k]) next[k] = old[k];
    else delete next[k];
  }
  for (const k of ["option", "por", "portalConfirm"] as const) {
    if (old[k]) next[k] = true;
    else delete next[k];
  }
  const items = sec.items.slice();
  items[at] = next;
  return { ...sec, items };
}
```

  Also extend the existing `curtainTrackPrefill`-related code only if tsc requires it (adding fields to `CurtainDraft` may need the three new keys anywhere a `CurtainDraft` literal is built — fix each site tsc names).

- [ ] **Step 5: Create `src/app/(app)/estimator/curtain-line.ts`:**

```ts
/**
 * #292 — building and editing an Estimator curtain line. Pure and
 * client-safe; kept out of estimator-client.tsx so that file's edits stay
 * small. The desc format is UNCHANGED (parse.ts reads it back); the line now
 * also stores structured `curtainInputs` and, with a track, a shared
 * `curtainTrackKey`.
 */
import type { CurtainRequest } from "@/lib/portal-cart-types";
import { parseEstimatorCurtainDesc } from "@/lib/curtain-cut-sheets/parse";
import { newCurtainTrackKey } from "@/lib/curtain-cut-sheets/track-link";
import { ASSUMED_MOUNT, DEFAULT_BOTTOM_FINISH, DEFAULT_TOP_FINISH, isBottomFinish, isMountTypeId, isTopFinish } from "@/lib/curtain-cut-sheets/vocab";
import { curtainSpecKey } from "@/lib/specs/record-keys";
import type { CurtainCalc } from "./pricing";
import { replaceCurtainLine } from "./track-bom";
import type { CurtainDraft, SpecItem, SpecSection } from "./types";

const FULLNESS: ReadonlyArray<CurtainRequest["fullness"]> = ["0", "50", "75", "100"];
const fullnessOf = (v: string): CurtainRequest["fullness"] => (FULLNESS as readonly string[]).includes(v) ? (v as CurtainRequest["fullness"]) : "0";

/** The modal draft for an existing curtain line: curtainInputs, else the parsed desc, else the name only (W/H blank). */
export function curtainDraftFromLine(it: SpecItem, fallbackFabric: string): CurtainDraft {
  const qty = String(Math.max(1, Math.round(Number(it.qty)) || 1));
  const ci = it.curtainInputs;
  const finishes = {
    topFinish: ci && isTopFinish(ci.topFinish) ? ci.topFinish : DEFAULT_TOP_FINISH,
    bottomFinish: ci && isBottomFinish(ci.bottomFinish) ? ci.bottomFinish : DEFAULT_BOTTOM_FINISH,
    mountType: ci && isMountTypeId(ci.mountType) ? ci.mountType : ASSUMED_MOUNT,
  };
  const base = { hang: "Pipe", bottom: "Chain", qty, ...finishes };
  if (ci) return { ...base, name: ci.name || "", fabric: ci.fabricSku || fallbackFabric, width: String(ci.width ?? ""), height: String(ci.height ?? ""), fullness: fullnessOf(String(ci.fullness ?? "0")) };
  const p = parseEstimatorCurtainDesc(it.desc || "", new Set());
  if (p) return { ...base, name: p.name, fabric: fallbackFabric, width: String(p.widthFt), height: String(p.heightFt), fullness: fullnessOf(String(p.fullnessPct)) };
  return { ...base, name: (it.desc || "").split(" — ")[0].trim(), fabric: fallbackFabric, width: "", height: "", fullness: "50" };
}

/** The curtain line addCurtain / Update curtain writes. */
export function curtainItem(d: CurtainDraft, c: Pick<CurtainCalc, "fab" | "costEach" | "priceEach">, ids: { id: number; sku: string; trackKey?: string }): SpecItem {
  const name = (d.name || "").trim();
  let qty = parseInt(d.qty, 10);
  if (isNaN(qty) || qty < 1) qty = 1;
  const width = parseFloat(d.width) || 0;
  const height = parseFloat(d.height) || 0;
  const curtainInputs: CurtainRequest = {
    name,
    fabricSku: c.fab.sku,
    fabricName: c.fab.name,
    qty: String(qty),
    width: String(width),
    height: String(height),
    fullness: fullnessOf(d.fullness),
  };
  if (isTopFinish(d.topFinish)) curtainInputs.topFinish = d.topFinish;
  if (isBottomFinish(d.bottomFinish)) curtainInputs.bottomFinish = d.bottomFinish;
  if (isMountTypeId(d.mountType)) curtainInputs.mountType = d.mountType;
  const item: SpecItem = {
    id: ids.id,
    sku: ids.sku,
    desc: name + " — " + c.fab.name + ", " + width + "'W × " + height + "'H, " + d.fullness + "% fullness",
    qty,
    unit: "ea",
    cost: c.costEach,
    price: c.priceEach,
    curtain: true,
    curtainInputs,
    specKey: curtainSpecKey(undefined, name) || undefined,
  };
  if (ids.trackKey) item.curtainTrackKey = ids.trackKey;
  return item;
}

/** Update curtain (+ optional Add track): replace in place; a new track goes right after the curtain, both keyed. */
export function applyCurtainEdit(sec: SpecSection, lineId: number, item: SpecItem, track: SpecItem | null): SpecSection {
  let next = replaceCurtainLine(sec, lineId, item);
  if (!track) return next;
  const at = next.items.findIndex((it) => it.id === lineId);
  const curtain = next.items[at];
  const key = curtain.curtainTrackKey || newCurtainTrackKey(lineId);
  const items = next.items.slice();
  items[at] = { ...curtain, curtainTrackKey: key };
  items.splice(at + 1, 0, { ...track, curtainTrackKey: key });
  next = { ...next, items };
  return next;
}
```

  (Note `desc` must byte-match addCurtain's: `(parseFloat(d.width) || 0) + "'W × " + (parseFloat(d.height) || 0) + "'H"` → `width + "'W × " + height + "'H"` is identical.)

- [ ] **Step 6: `curtain-modal.tsx`.** Import `BOTTOM_FINISHES, BOTTOM_FINISH_SHORT, CURTAIN_MOUNT_TYPES, TOP_FINISHES, TOP_FINISH_SHORT, mountTypeForTrackMounting, MOUNT_KEY_LABELS` from vocab. Add prop `linkedTrack?: string | null` (a mounting value, e.g. `"batten"`, when editing a curtain whose track already exists). After the fullness block, add two segmented rows built exactly like fullness (`segBtn(draft.topFinish === v)` → `onSet("topFinish", v)`, captions from `TOP_FINISH_SHORT` / `BOTTOM_FINISH_SHORT`, labels "Top finish" / "Bottom finish"), then a mount row:

```tsx
      <div style={{ marginBottom: 16 }}>
        <label style={LBL}>Mount</label>
        {track || linkedTrack ? (
          <div style={{ fontSize: 12.5, color: "#5b616e" }}>
            {`Mount: from the track (${MOUNT_KEY_LABELS[mountTypeForTrackMounting(String(track ? track.mounting : linkedTrack))]})`}
          </div>
        ) : (
          <select className="est-field" value={draft.mountType} onChange={(e) => onSet("mountType", e.target.value)} style={{ ...FIELD, background: "#fff", cursor: "pointer" }}>
            {CURTAIN_MOUNT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        )}
      </div>
```

  Show the Add track block only when `!linkedTrack` (wrap the existing `{onToggleTrack && onSetTrack && (` condition: `{onToggleTrack && onSetTrack && !linkedTrack && (`). Update the header comment (finishes + mount are back; they don't affect price). The footer button already reads `editing ? "Update curtain" : …`.

- [ ] **Step 7: `section-card.tsx`.** Add the prop next to `onEditTrack` (~170): `/** #292: reopen the curtain configurator on a curtain line (by line id). */ onEditCurtain?: (lineId: number) => void;`. Next to `trackEditable` (~920):

```tsx
              const curtainEditable = isInternal && !!p.onEditCurtain && !!it.curtain;
              const openCurtain = (e: { detail: number }) => {
                if (e.detail > 1) return;
                if (curtainEditable) p.onEditCurtain?.(it.id);
              };
```

  (curtain lines are never Rewards credit lines, so no credit guard is needed). Extend `lineEditable`/`openLine` to include it: `const lineEditable = laborEditable || trackEditable || curtainEditable; const openLine = laborEditable ? openLabor : trackEditable ? openTrack : openCurtain;` and the `title` ternary gains `curtainEditable ? lineDesc + " — click to edit this curtain"`. In the actions cell, after the track ✎ (~1305): `{curtainEditable && (<button type="button" className="est-action-btn" onClick={openCurtain} title="Edit curtain — reopens the curtain configurator" aria-label={\`Edit curtain ${it.desc}\`} style={ACTION_BTN}>✎</button>)}`.

- [ ] **Step 8: `estimator-client.tsx` — small, localized edits only** (shared with #293):
  1. Imports: add `import { applyCurtainEdit, curtainDraftFromLine, curtainItem } from "./curtain-line";` and `import { linkCurtainTracks, newCurtainTrackKey } from "@/lib/curtain-cut-sheets/track-link";` next to the existing `./track-bom` import.
  2. `freshCurtain` (~235): add `topFinish: "grommets", bottomFinish: "chain", mountType: "tie-batten",`.
  3. Next to `trackEditRef` (~688): 
     ```ts
     /* #292: Edit curtain — the same close-then-seed dance as the track edit. */
     const curtainEditRef = useRef<{ lineId: number; draft: CurtainDraft; linkedTrack: string | null } | null>(null);
     const [curtainEdit, setCurtainEdit] = useState<{ lineId: number; linkedTrack: string | null } | null>(null);
     ```
  4. `discardDraft` curtain branch: add `curtainEditRef.current = null; setCurtainEdit(null);`. `seedDraft` curtain branch: replace its two lines with
     ```ts
      const edit = curtainEditRef.current;
      curtainEditRef.current = null;
      setCurtainEdit(edit ? { lineId: edit.lineId, linkedTrack: edit.linkedTrack } : null);
      setCurtainDraft(edit ? edit.draft : freshCurtain(defaultFabric));
      setCurtainTrack(null);
     ```
  5. After `openTrackEdit` (~2019):
     ```ts
     /** #292: reopen the curtain configurator on a curtain line. */
     const openCurtainEdit = (secId: string, lineId: number) => {
       const it = sections.find((s) => s.id === secId)?.items.find((x) => x.id === lineId);
       if (!it?.curtain) return;
       const linked = linkCurtainTracks(sections).links.get(it);
       closeInput();
       curtainEditRef.current = { lineId, draft: curtainDraftFromLine(it, defaultFabric), linkedTrack: linked?.track ? String(linked.track.mounting) : null };
       openInputMethod("curtain", secId);
     };
     ```
  6. `addCurtain` (~2249): keep its guards and track build; replace the `pushItems(secId, [{ … curtain line … }, ...(track ? [track] : [])]);` body with:
     ```ts
     if (curtainEdit) {
       if (track) track.id = nextId();
       const item = curtainItem(d, c, { id: curtainEdit.lineId, sku: "" });
       setSections((ss) => ss.map((s) => (s.id === secId ? applyCurtainEdit(s, curtainEdit.lineId, item, curtainEdit.linkedTrack ? null : track) : s)));
       closeInput();
       return;
     }
     const idN = nextId();
     const skuN = nextId();
     if (track) track.id = nextId();
     const key = track ? newCurtainTrackKey(idN) : undefined;
     pushItems(secId, [curtainItem(d, c, { id: idN, sku: "CRT-" + skuN, trackKey: key }), ...(track ? [{ ...track, curtainTrackKey: key }] : [])]);
     closeInput();
     ```
     (and delete the now-unused local `qty`/`dims`/`name` re-derivations only if eslint flags them unused; `name` is still used by the guard.)
  7. `<CurtainModal …>` (~3970): add `editing={!!curtainEdit}` directly after `secName={…}` (the harness regex looks within 400 chars of `<CurtainModal`), and `linkedTrack={curtainEdit?.linkedTrack ?? null}`.
  8. `<SectionCard …>` (~3777): add `onEditCurtain={(lineId) => openCurtainEdit(sec.id, lineId)}` next to `onEditTrack`.
  9. Toolbar (directly before the "Customer preview →" `<button>`, ~2786):
     ```tsx
              {loadedId && (
                <button
                  type="button"
                  onClick={async () => {
                    const href = `/estimator/cut-sheets?id=${encodeURIComponent(loadedId)}`;
                    if (!pdfDirty) {
                      window.open(href, "_blank", "noopener");
                      return;
                    }
                    // Opened inside the click so it isn't popup-blocked; navigated after the save lands.
                    const w = window.open("", "_blank");
                    const saved = await saveNow();
                    if (!w) return;
                    if (saved === false) w.close();
                    else w.location.href = href;
                  }}
                  style={{ fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, color: "#cfd3da", background: "#2b2e35", padding: "9px 14px", borderRadius: 8, border: "none", cursor: "pointer" }}
                >
                  Cut sheets
                </button>
              )}
     ```

- [ ] **Step 9: Grid drop dialog.**
  - `actions.ts` `placeCurtainAction`: widen `input.curtain` with `topFinish?: string; bottomFinish?: string; mountType?: string;`, import `cleanCurtainFinishes` from vocab, and spread `...cleanCurtainFinishes(c),` into the `curtain: GridCurtain` literal (after `specKey`). Bad/absent values drop, never refuse.
  - `curtain-drop.tsx`: import `BOTTOM_FINISHES, BOTTOM_FINISH_SHORT, CURTAIN_MOUNT_TYPES, GRID_CURTAIN_DEFAULTS, TOP_FINISHES, TOP_FINISH_SHORT` and the three types. State holds only the user's **touched** choice (null = follow the type default — no effect, no setState-in-effect):
    ```ts
    const [topPick, setTopPick] = useState<CurtainTopFinish | null>(null);
    const [bottomPick, setBottomPick] = useState<CurtainBottomFinish | null>(null);
    const [mountPick, setMountPick] = useState<CurtainMountTypeId | null>(null);
    const def = GRID_CURTAIN_DEFAULTS[type];
    const topFinish = topPick ?? def.top;
    const bottomFinish = bottomPick ?? def.bottom;
    const mountType = mountPick ?? def.mount;
    ```
    add `topFinish, bottomFinish, mountType` to the `draft: GridCurtain`, and render two segmented rows (styled like the fullness buttons, `LBL` labels "Top" / "Bottom") and a `<select style={INPUT}>` "Mount" over `CURTAIN_MOUNT_TYPES` — placed after the fullness row. `editor.tsx` needs no change (it forwards the whole `GridCurtain`).

- [ ] **Step 10: Run the Gates.** Expected PASS = Task 6 count + 12, 0 FAIL. eslint: `"src/app/(app)/estimator/curtain-line.ts" "src/app/(app)/estimator/types.ts" "src/app/(app)/estimator/track-bom.ts" "src/app/(app)/estimator/curtain-modal.tsx" "src/app/(app)/estimator/section-card.tsx" "src/app/(app)/estimator/estimator-client.tsx" "src/app/(app)/design/grid/[id]/curtain-drop.tsx" "src/app/(app)/design/grid/[id]/actions.ts"` — compare against a base-commit run if `estimator-client.tsx` reports pre-existing warnings (`git show HEAD~1:<file>` into the scratchpad and lint it the same way; report only new problems).

- [ ] **Step 11: Commit** — `feat(cutsheets): #292 curtain finishes/mount in the Estimator and Grid, Edit curtain, structured curtain lines, Cut sheets button`.

---

### Task 8: Print route, estimate-PDF toggle, client package

**Files:**
- Create: `src/app/print/cutsheets/[quoteId]/page.tsx`, `src/lib/curtain-cut-sheets/package-sheets.ts`
- Modify: `src/lib/quote-pdf/token.ts:16` (**one line**), `src/lib/quote-pdf/pdf-options.ts` (**shared with #293 — add-only lines**), `src/app/print/quote/[id]/page.tsx`, `src/app/(app)/estimator/preview-doc.tsx`, `src/app/(app)/estimator/estimator-client.tsx` (**shared — four localized additions**), `src/lib/client-package.ts:11`, `src/lib/client-package-server.ts`, `src/app/(app)/quotes/actions.ts:69-83`, `src/app/(app)/design/grid/[id]/actions.ts:427-447`
- Test: `scripts/test-review-and-spec.ts` (append)

**Interfaces:**
- Consumes: `loadCutSheets`, `CutSheetPages`, `CLIENT_PRINT_CSS`, `SUBMITTAL_PRINT_CSS` (Task 6); `countCutSheetTypes` (Task 3); `signPrintToken` / `verifyPrintToken`; `renderPrintRouteToPdf(url, { timeoutMs? })` (`render.ts:100`); `printOriginFor(env, host, proto)` (`src/lib/quote-pdf/origin.ts:39`); `safeName` (`@/lib/blob`).
- Produces: `PrintTokenKind` includes `"cutsheets"`; `QuotePdfOptions.pdfCutSheets: boolean` (default false, in `PDF_TOGGLE_KEYS`); `PackageGapKind` includes `"missing-cutsheet"`; `package-sheets.ts`: `CUT_SHEET_BUDGET_MS = 60_000`, `CUT_SHEET_LATE`, `NO_PRINT_ORIGIN`, `type PrintWhere = { origin: string } | { error: string }`, `cutSheetFileName(sheetNo, title)`, `addCutSheets(quoteId, where, files, gaps, budgetMs?) → Promise<{ sheets: Array<{ sheetNo; title; file: string | null }>; unreadable: CollectResult["unreadable"] }>`; `createClientPackage(project, by, optionId?, opts?: { printWhere?: PrintWhere })`, `createQuoteClientPackage(quote, by, opts?: { printWhere?: PrintWhere })`.

- [ ] **Step 1: Append failing checks:**

```ts
import { DEFAULT_PDF_OPTIONS as c292PdfDefaults, PDF_TOGGLE_KEYS as c292PdfKeys, normalizePdfOptions as c292NormPdf } from "@/lib/quote-pdf/pdf-options";
import { signPrintToken as c292Sign, verifyPrintToken as c292Verify } from "@/lib/quote-pdf/token";
import { cutSheetFileName as c292FileName } from "@/lib/curtain-cut-sheets/package-sheets";
{
  ok(c292PdfDefaults.pdfCutSheets === false && (c292PdfKeys as readonly string[]).includes("pdfCutSheets") && c292NormPdf(undefined).pdfCutSheets === false && c292NormPdf({ pdfCutSheets: true }).pdfCutSheets === true,
    "#292 pdf: pdfCutSheets defaults off, is a toggle key, and a stored true is kept");
  const now = 1_700_000_000_000;
  const tok = c292Sign("s3cret", "cutsheets", "Q-1", now);
  ok(c292Verify("s3cret", tok, "cutsheets", "Q-1", now) && !c292Verify("s3cret", tok, "cutsheets", "Q-2", now), "#292 token: a cutsheets token verifies for its own quote id only");
  ok(!c292Verify("s3cret", c292Sign("s3cret", "quote", "Q-1", now), "cutsheets", "Q-1", now), "#292 token: a quote token does not verify as cutsheets");
  ok(c292FileName("CS-2", "Legs (Encore Velour 22 oz)") === "cutsheets/CS-2-Legs_Encore_Velour_22_oz.pdf", "#292 package: one Submittal PDF per type under cutsheets/");
  const rd292d = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const pr = rd292d("src/app/print/cutsheets/[quoteId]/page.tsx");
  const prBody = pr.slice(pr.indexOf("export default"));
  ok(/verifyPrintToken\([^)]*"cutsheets"/.test(pr) && prBody.indexOf("tokenOk(") >= 0 && prBody.indexOf("tokenOk(") < prBody.indexOf("loadCutSheets("),
    "#292 source: the print route verifies a cutsheets token before loadCutSheets");
  const pkg = rd292d("src/lib/client-package-server.ts");
  ok(pkg.includes("addCutSheets(") && rd292d("src/lib/curtain-cut-sheets/package-sheets.ts").includes("cutsheets/"), "#292 source: client packages write the cutsheets/ folder");
  ok(/pdfCutSheets/.test(rd292d("src/app/print/quote/[id]/page.tsx")) && /CutSheetPages/.test(rd292d("src/app/print/quote/[id]/page.tsx")), "#292 source: the estimate print route appends Client pages behind pdfCutSheets");
  ok(!/curtain-cut-sheets\/(collect|load|package-sheets)/.test(rd292d("src/app/(app)/estimator/estimator-client.tsx") + rd292d("src/app/(app)/estimator/preview-doc.tsx")),
    "#292 source: the Estimator client never imports the collector, loader or package helper (bundle/boundary)");
}
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Token + PDF option.**
  - `token.ts`: `export type PrintTokenKind = PdfKind | "part-thumb" | "cutsheets";` and extend its comment ("…plus #245's datasheet-thumbnail render and #292's cut sheets, neither of which prints a quote document"). `PdfKind` stays unwidened.
  - `pdf-options.ts` (add-only): in `QuotePdfOptions` add `/** #292 — append Client-style curtain cut sheets after the estimate. Off by default. */ pdfCutSheets: boolean;`; append `"pdfCutSheets"` as the **last** element of `PDF_TOGGLE_KEYS`; add `pdfCutSheets: false,` as the last key of `DEFAULT_PDF_OPTIONS`. `normalizePdfOptions` already loops `PDF_TOGGLE_KEYS` — no change. (`quoteDocumentDataFor` spreads `normalizePdfOptions(...)` into `QuoteDocumentProps`; the extra key is harmless and `quote-document.tsx` is not touched.)

- [ ] **Step 4: Create `src/app/print/cutsheets/[quoteId]/page.tsx`:**

```tsx
import { notFound } from "next/navigation";
import { CutSheetPages, CLIENT_PRINT_CSS, SUBMITTAL_PRINT_CSS } from "@/components/cutsheets/cut-sheet-pages";
import { loadCutSheets } from "@/lib/curtain-cut-sheets/load";
import { verifyPrintToken } from "@/lib/quote-pdf/token";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cut sheets", robots: { index: false, follow: false } };

/** The 120 s print token — fails closed; module-level so the clock read stays out of the component body (react-hooks/purity). */
function tokenOk(t: string | undefined, id: string): boolean {
  return !!t && verifyPrintToken(process.env.AUTH_SECRET || "", t, "cutsheets", id, Date.now());
}
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Signed print route for curtain cut sheets (#292 §5.1). Outside the team
 * login (middleware exempts /print/); the token is the only key, checked
 * before any read. `?style=submittal|client&sheet=CS-n` (sheet optional).
 */
export default async function PrintCutSheetsPage({
  params,
  searchParams,
}: {
  params: Promise<{ quoteId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ quoteId }, sp] = await Promise.all([params, searchParams]);
  if (!tokenOk(first(sp.t), quoteId)) notFound();
  const style = first(sp.style) === "client" ? "client" : "submittal";
  const sheet = first(sp.sheet) || "";
  const loaded = await loadCutSheets(quoteId, { images: style === "client" ? "data" : "none" });
  if (!loaded.ok) notFound();
  const models = loaded.models[style].filter((m) => !sheet || m.sheetNo === sheet);
  if (!models.length) notFound();
  return (
    <main>
      <style>{style === "submittal" ? SUBMITTAL_PRINT_CSS : CLIENT_PRINT_CSS}</style>
      <CutSheetPages models={models} style={style} photos={loaded.photos} />
    </main>
  );
}
```

- [ ] **Step 5: Estimate PDF.** In `src/app/print/quote/[id]/page.tsx`: import `normalizePdfOptions`, `loadCutSheets`, `CutSheetPages`. After the existing `Promise.all`, add:

```ts
  // #292 — Client-style cut sheets after the estimate, only when the quote asks for them. A failure never breaks the PDF.
  const cutSheets = normalizePdfOptions(q.pdfOptions).pdfCutSheets ? await loadCutSheets(id, { images: "data" }).catch(() => null) : null;
```

  and render after `<QuoteDocument … />`:

```tsx
      {cutSheets?.ok && cutSheets.models.client.length > 0 && <CutSheetPages models={cutSheets.models.client} style="client" photos={cutSheets.photos} />}
```

  (`.pk-cs-client` carries `break-before: page`; it prints under the existing `QUOTE_PRINT_CSS` Letter / 0.6in rule.)

- [ ] **Step 6: Preview chip.** `preview-doc.tsx`: `PdfToggle` gains `| "pdfCutSheets"`; `PreviewProps` gains `pdfCutSheets: boolean;` and `/** #292 — sheets the saved PDF would append (countCutSheetTypes over the live sections). */ cutSheetCount: number;`. After the Terms button add:

```tsx
            <button
              type="button"
              disabled={p.cutSheetCount === 0}
              title={p.cutSheetCount === 0 ? "This quote has no curtains." : undefined}
              onClick={() => p.togglePdf("pdfCutSheets")}
              style={{ ...(p.pdfCutSheets && p.cutSheetCount > 0 ? segOn : segOff), ...(p.cutSheetCount === 0 ? { cursor: "not-allowed", opacity: 0.55 } : {}) }}
            >
              {(p.pdfCutSheets && p.cutSheetCount > 0 ? "✓ " : "") + "Cut sheets"}
            </button>
            {p.pdfCutSheets && p.cutSheetCount > 0 && (
              <div style={{ fontSize: 11.5, color: "#5b616e", lineHeight: 1.45, padding: "2px 4px" }}>
                {`+ ${p.cutSheetCount} cut sheet page${p.cutSheetCount === 1 ? "" : "s"} (Client style) print after the estimate — `}
                {p.savedQuoteId ? (
                  <a href={`/estimator/cut-sheets?id=${encodeURIComponent(p.savedQuoteId)}&style=client`} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                    View cut sheets →
                  </a>
                ) : (
                  "save to view them"
                )}
              </div>
            )}
```

  `estimator-client.tsx` (four localized additions, nothing else):
  1. next to `const [pdfPrices, …]` (~615): `const [pdfCutSheets, setPdfCutSheets] = useState(initial.pdfOptions.pdfCutSheets);`
  2. `pdfOpts` memo: add `pdfCutSheets` to the object and to the deps array.
  3. next to it: `const cutSheetCount = useMemo(() => countCutSheetTypes({ sections }, fabrics.map((f) => ({ sku: f.sku, desc: f.name })), trackSeries), [sections, fabrics, trackSeries]);` with `import { countCutSheetTypes } from "@/lib/curtain-cut-sheets/estimator-curtains";`
  4. `<PreviewDoc …>`: add `pdfCutSheets={pdfCutSheets}` and `cutSheetCount={cutSheetCount}`; in `togglePdf`, add `else if (flag === "pdfCutSheets") setPdfCutSheets((v) => !v);` **before** the final `else setPdfTerms(...)`.

- [ ] **Step 7: Client package.**
  - `client-package.ts:11`: `export type PackageGapKind = "missing-catalog" | "missing-datasheet" | "missing-spec" | "missing-cutsheet";`
  - Create `src/lib/curtain-cut-sheets/package-sheets.ts`:

```ts
/**
 * #292 §5.2 — one Submittal PDF per curtain type into the client package
 * zip, through the signed print route and headless Chrome. SERVER ONLY.
 * Chrome unavailable, a bad origin or a render error becomes a gap and the
 * package still builds; past the budget the rest become gaps, so a build
 * stays inside the pages' maxDuration = 120.
 */
import { safeName } from "@/lib/blob";
import type { ClientPackageGap } from "@/lib/client-package";
import { renderPrintRouteToPdf } from "@/lib/quote-pdf/render";
import { signPrintToken } from "@/lib/quote-pdf/token";
import type { ZipFile } from "@/lib/zip";
import type { CollectResult } from "./collect";
import { loadCutSheets } from "./load";

export const CUT_SHEET_BUDGET_MS = 60_000;
export const CUT_SHEET_LATE = "Not rendered in time — print from Cut sheets";
export type PrintWhere = { origin: string } | { error: string };
export const NO_PRINT_ORIGIN: PrintWhere = { error: "No print address for this request — print from Cut sheets" };

export function cutSheetFileName(sheetNo: string, title: string): string {
  return `cutsheets/${sheetNo}-${safeName(title)}.pdf`;
}

export async function addCutSheets(
  quoteId: string,
  where: PrintWhere,
  files: ZipFile[],
  gaps: ClientPackageGap[],
  budgetMs = CUT_SHEET_BUDGET_MS
): Promise<{ sheets: Array<{ sheetNo: string; title: string; file: string | null }>; unreadable: CollectResult["unreadable"] }> {
  const loaded = await loadCutSheets(quoteId, { images: "none" });
  if (!loaded.ok) return { sheets: [], unreadable: [] };
  const started = Date.now();
  const sheets: Array<{ sheetNo: string; title: string; file: string | null }> = [];
  for (const type of loaded.result.types) {
    const gap = (reason: string) => {
      gaps.push({ kind: "missing-cutsheet", sku: type.sheetNo, description: `${type.title} — ${reason}`, qty: type.totalQty, catalogId: null });
      sheets.push({ sheetNo: type.sheetNo, title: type.title, file: null });
    };
    if ("error" in where) {
      gap(where.error);
      continue;
    }
    if (Date.now() - started > budgetMs) {
      gap(CUT_SHEET_LATE);
      continue;
    }
    try {
      const t = signPrintToken(process.env.AUTH_SECRET || "", "cutsheets", quoteId, Date.now());
      const url = `${where.origin}/print/cutsheets/${encodeURIComponent(quoteId)}?style=submittal&sheet=${encodeURIComponent(type.sheetNo)}&t=${encodeURIComponent(t)}`;
      const name = cutSheetFileName(type.sheetNo, type.title);
      files.push({ name, data: await renderPrintRouteToPdf(url) });
      sheets.push({ sheetNo: type.sheetNo, title: type.title, file: name });
    } catch (e) {
      gap(e instanceof Error ? e.message : "Could not render — print from Cut sheets");
    }
  }
  return { sheets, unreadable: loaded.result.unreadable };
}
```

  - `client-package-server.ts`:
    - Imports: `import { addCutSheets, NO_PRINT_ORIGIN, type PrintWhere } from "@/lib/curtain-cut-sheets/package-sheets";` and `import { ensureOptions, optionSlice, resolveOptionId } from "@/lib/design/grid-options";`.
    - `createClientPackage(project, by, requestedOptionId?, opts: { printWhere?: PrintWhere } = {})`: after the plan-sheet loop and before `files.unshift(index)`:
      ```ts
      // #292 — cut sheets for the option's quote; a design with curtains but no quote gets one gap.
      const optId = resolveOptionId(project, requestedOptionId);
      const optQuoteId = ensureOptions(project).options.find((o) => o.id === optId)?.quoteId ?? null;
      let cutSheets: Awaited<ReturnType<typeof addCutSheets>> = { sheets: [], unreadable: [] };
      if (optQuoteId) cutSheets = await addCutSheets(optQuoteId, opts.printWhere ?? NO_PRINT_ORIGIN, files, gaps);
      else if (optionSlice(project, optId).placements.some((p) => !!p.curtain))
        gaps.push({ kind: "missing-cutsheet", sku: "CS", description: "Add this design to Quotes to include cut sheets", qty: 0, catalogId: null });
      ```
      and add `cutSheets` to the `00-package-index.json` object (`{ ...publicManifest, cutSheets, generatedAt, specSections }`). Note `publicManifest` is built from `gaps` — build it **after** this block.
    - `createQuoteClientPackage(quote, by, opts: { printWhere?: PrintWhere } = {})`: after `addDocuments(...)`, `const cutSheets = await addCutSheets(quote.id, opts.printWhere ?? NO_PRINT_ORIGIN, files, gaps);` and add `cutSheets` to its index JSON object.
  - `quotes/actions.ts` `createQuoteClientPackageAction`: before the `try`, 
    ```ts
    const h = await headers();
    const printWhere = printOriginFor(process.env, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"));
    ```
    and call `createQuoteClientPackage(quote, user.name, { printWhere })` (imports: `headers` from `next/headers`, `printOriginFor` from `@/lib/quote-pdf/origin`).
  - `design/grid/[id]/actions.ts` `createClientPackageAction`: same two lines; call `createClientPackage(project, user.name, optionId, { printWhere })`.

- [ ] **Step 8: Run the Gates.** Expected PASS = Task 7 count + 8, 0 FAIL — and the existing `#222 normalizePdfOptions` checks still pass (the default object still equals `normalizePdfOptions(undefined)`). eslint: the two new files plus `src/lib/quote-pdf/token.ts src/lib/quote-pdf/pdf-options.ts "src/app/print/quote/[id]/page.tsx" "src/app/(app)/estimator/preview-doc.tsx" "src/app/(app)/estimator/estimator-client.tsx" src/lib/client-package.ts src/lib/client-package-server.ts "src/app/(app)/quotes/actions.ts" "src/app/(app)/design/grid/[id]/actions.ts"`.

- [ ] **Step 9: Commit** — `feat(cutsheets): #292 signed print route, estimate-PDF toggle (off by default), cut sheets in client packages`.

---

### Task 9: Whole-branch gates + docs (PUNCHLIST, DECISIONS, AGENTS)

**Files:**
- Modify: `PUNCHLIST.md`, `DECISIONS.md`, `AGENTS.md` (phase list), `docs/superpowers/specs/2026-10-01-curtain-cut-sheets-design.md` (decision-number line)

**Interfaces:** none (docs + verification).

- [ ] **Step 1: Full gates.**

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/cutsheets
export PATH="$HOME/.local/node/bin:$PATH"
ps aux | grep -E "next dev|tsx" | grep -v grep | grep cutsheets   # must be empty (stop strays first)
npx tsc --noEmit
npm run test:specs > "${TMPDIR:-/tmp}/specs292.log" 2>&1; tail -2 "${TMPDIR:-/tmp}/specs292.log"; grep -c '^PASS ' "${TMPDIR:-/tmp}/specs292.log"; grep '^FAIL ' "${TMPDIR:-/tmp}/specs292.log"
npm run test:smoke 2>&1 | tail -15                                   # all PASS, including the 4 new #292 routes
npx next build 2>&1 | tail -25                                       # must succeed — the only gate that catches a client→server-store import
git diff --name-only "$(git merge-base HEAD origin/main)" -- 'src/**/*.ts' 'src/**/*.tsx' | xargs npx eslint
```

  Expected: tsc 0; test:specs = 10,378 + 110 new PASS (20 + 13 + 30 + 7 + 13 + 7 + 12 + 8), 0 FAIL; smoke all PASS; build OK; eslint 0 problems on changed src files (any `estimator-client.tsx` warning that also appears on `origin/main` is pre-existing — say so with the numbers). If `next build` fails with a `postgres`/`drizzle`/`node:` module in a client chunk, trace which `"use client"` file imports a store and route it through a pure module.

- [ ] **Step 2: Recompute numbers from origin/main right before writing** (other sessions land items within the hour; the #293 branch will also add D-numbers):

```bash
git fetch origin
git show origin/main:PUNCHLIST.md | grep -oE '^## [0-9]+\.' | tr -dc '0-9\n' | sort -n | tail -1   # today: 291 → this feature is #292
git show origin/main:DECISIONS.md | grep -oE '^## D[0-9]+' | tr -dc '0-9\n' | sort -n | tail -1    # today: 538 → this feature starts at D539
git branch -a | grep -i 293 ; for b in $(git branch -a --format='%(refname:short)' | grep -i 293); do git show "$b":DECISIONS.md 2>/dev/null | grep -oE '^## D[0-9]+' | tail -3; done
```

  If `#292` is already taken on origin/main, take the next free number and rename it in the commit messages' docs only (code says `#292` in comments — update them with one `grep -rln "#292" src scripts | xargs sed -i '' 's/#292/#NNN/g'` only if the number actually changed). Start D-numbers after the highest on origin/main **and** on the #293 branch if it is already pushed.

- [ ] **Step 3: DECISIONS.md** — append eight entries in the house format (`## D<n>. <title> (#292, 2026-10-01)` + a paragraph), numbered from the recomputed start (shown here as D539–D546):
  1. **D539. One cut sheet per curtain type.** Type = name (trimmed, case-insensitive) + fabric + fullness + top + bottom + mount (track series + mounting when linked, else the picked mount type). Size is not part of the type; a sheet lists total qty and a size schedule. `CS-1, CS-2…` in first-appearance order (section, then line; Grid placement order). Optional-scope lines get no sheet and are listed as left out (`bomFromQuote` rule).
  2. **D540. Drawn from finished dimensions; area and weight from the pricing/weights functions.** Sewn area = `curtainCost(...).sewnAreaSqft`; weight = `computeSetWeight(...).goods` (fabric with 6" cut + jack chain on a chain bottom + 0.5 lb/ft hardware; track weight excluded); a fabric with no `oz` prints "—" and warns. Elevation at one architectural scale (largest that fits), ≤ 3 panels else "Typical", 3-1/2" webbing and 4" hem/pocket bands (open question), marks evenly spaced at ≤ 12" o.c. (carriers at the line override, else the series spacing).
  3. **D541. Two sources, one collector; structured curtain lines; never guess.** Non-empty `spec.sections` → Estimator adapter, else `spec.kind === "grid"` → Grid adapter (option placements, else the frozen `spec.lines` with a note). Estimator curtain lines now store `curtainInputs` (+ top/bottom finish and mount type); legacy lines are read by a pure desc parser; an unreadable or zero-size line is flagged "Edit the curtain →", never guessed. `curtainInputs.qty` stays informational — the line qty counts.
  4. **D542. Curtain ↔ track link is a shared key.** `curtainTrackKey = "ct-<curtain line id at add>"` on both lines (laborMobKey idiom); fallback for older quotes: the next item in the same section when it is an unkeyed track line; one track per curtain (a second curtain is flagged). Implementation: the link map is keyed by the curtain line object, not its id; Update track (`replaceTrackLine`) now keeps the key.
  5. **D543. Mount from the track, else picked; the detail library is code; Curtain mounts blob.** `mountTypeForTrackMounting(string)` maps batten/ceiling/structure and sends anything else to a generic `track-other` (so a third `TrackMounting` value never breaks); tracked hardware = the track lines' stored components summed by SKU; untracked = Estimating Rules → Curtain mounts (`curtain_mount_hardware`, per-curtain / per-ft-of-width / per-mark rules, starts empty, manage_users, refuses a SKU not in the catalog); five starter mount types pending Jeff; old untracked lines assume `tie-batten` and say so; Grid type defaults per spec §1.4. "Per mark" counts grommets only.
  6. **D544. Fabric facts from the catalog.** Fabric parts gain `flameRating` (≤ 120 chars) and an editor for the existing `oz` / `ozBasis` beside the fabric rate (blank clears; basis clears with a blank oz; server refuses them on a non-fabric part). A blank fact prints nothing. No import column yet.
  7. **D545. Two styles, three outputs.** Submittal (Letter landscape, drawing-set title block filled from the quote: estimate #, quote revisions lettered A, B…, "Elev <scale> · Detail NTS") and Client (Letter portrait, plain-language sentence, part photos, no SKUs or costs) from one model. Outputs: the staff page `/estimator/cut-sheets` (requireUser; Estimator toolbar + Quotes hub entries; Estimator saves first when dirty), a `cutsheets/` folder in client packages (one Submittal PDF per type via a new `"cutsheets"` print-token kind; failures and a 60 s budget become `missing-cutsheet` gaps; package actions now pass the request origin), and the estimate PDF's new **Cut sheets** toggle, `pdfCutSheets`, **off by default**, appending Client pages (the portal serves the same PDF). Catalog / track-series / Curtain-mounts edits don't reschedule a PDF — they show on the next save.
  8. **D546. Implementation choices.** Adapters in `estimator-curtains.ts` (no weight math) so the preview's sheet count uses the same adapters and key without bundling `steel.ts`; photos keyed by sheet number; loader `images: "none"`; cut-sheet package helper in `src/lib/curtain-cut-sheets/package-sheets.ts`; a Grid package with no quote adds the "Add this design to Quotes…" gap only when the option has curtains; `replaceCurtainLine` keeps the SKU too. No migration; instant rollback past #292 is safe (older code ignores the new fields and blob).

- [ ] **Step 4: PUNCHLIST.md** — append `## 292. Curtain cut sheets — one sheet per curtain type for submittals and estimates — DONE 2026-10-01 (D539–D546)` in the #290/#291 format: **Reported** (Jeff, 2026-10-01: every curtain on a quote gets a cut sheet — elevation, how it mounts, all mounting hardware, materials; deterministic), **Done** (one paragraph summarizing D539–D545), **Gates** (real numbers from Step 1), and:
  - **Remaining (Jeff-gated).** 1. Confirm the five mount types. 2. Fill Estimating Rules → Curtain mounts (until then untracked sheets print without a hardware table). 3. Set Weight (oz) and Flame rating on the real fabric rows (production's Rose Brand `RB-FAB-…` rows likely have no `oz` — weight prints "—"). 4. Open one real quote's cut sheets and compare each sheet to the quote. 5. `QUOTE_PDF_ORIGIN` must already be set in production (the #222 requirement) for package and PDF renders.
  - **Open questions for Jeff** (verbatim from the spec's Open questions 1–5: mount types; `tie-batten` as the assumption for old lines; the Grid type defaults — Border hem? Draw track-batten?; 12" o.c. max everywhere?; 3-1/2" webbing and 4" hems/pockets as shop standards?).
  - **Out of scope** (from the spec: import column, Grid curtain edit dialog, bi-parting pairs as lapped panels, track weight, rentals/portal cut sheets, a Client-style zip, per-curtain color on Estimator lines).

  **Repo pattern check:** MASTER-QUESTIONS.md/QUESTIONS.md have not taken a feature's open questions since #245 (`git log --oneline -5 -- MASTER-QUESTIONS.md QUESTIONS.md`); recent items (#283–#291) keep them in the PUNCHLIST item's "Remaining"/"For Jeff" sections. Follow that — add nothing to MASTER-QUESTIONS/QUESTIONS unless the log shows a newer pattern.

- [ ] **Step 5: AGENTS.md** — append to the Phase status list after item 31:

```markdown
32. ✅ **Curtain cut sheets** (#292, D539–D546) — every curtain type on a
    system quote gets a deterministic cut sheet: front elevation from the
    finished size (architectural scale, grommet/carrier marks ≤ 12" o.c.),
    a mounting-detail section, materials (fabric, flame rating, fullness,
    finishes, sewn area from `curtainCost`, weight from `computeSetWeight`)
    and mounting hardware (the linked track line's components, else
    Estimating Rules → Curtain mounts). `src/lib/curtain-cut-sheets/` reads
    Estimator (`curtainInputs`, legacy desc parser, `curtainTrackKey`) and
    Grid quotes; Submittal (Letter landscape, title block) and Client
    (Letter portrait, plain language, photos) styles at
    `/estimator/cut-sheets`, a `cutsheets/` folder in client packages, and
    an off-by-default **Cut sheets** toggle on the estimate PDF. The
    Estimator curtain modal gains top/bottom finish, mount and Edit curtain;
    the Grid drop dialog the same fields. Remaining is Jeff-gated: confirm
    the mount types, fill Curtain mounts, set fabric oz + flame ratings,
    check a real quote (PUNCHLIST #292).
```

- [ ] **Step 6: Spec** — under the spec's Decisions heading, replace "These become DECISIONS.md entries **D539+**. The exact numbers are assigned at docs time…" with "Logged as DECISIONS.md D539–D546 (2026-10-01)." (using the real numbers).

- [ ] **Step 7: Commit.**

```bash
git add PUNCHLIST.md DECISIONS.md AGENTS.md docs/superpowers/specs/2026-10-01-curtain-cut-sheets-design.md
git commit -m "docs: #292 curtain cut sheets (D539-D546)

tsc 0; test:specs <N> PASS / 0 FAIL; test:smoke <M>/<M>; next build OK

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review (done while writing)

- **Spec coverage:** decisions 1–14 → Tasks 3 (1, 3, 5, 6, 7, 11, 13), 2 (2, 8, 11), 4 (9), 5 (6, 12, 14), 6 (10a, 14), 7 (4, 5, 6), 8 (10b, 10c); §1.1–1.6 → Tasks 1, 3, 5; §2.1–2.6 → Tasks 1–4; §3 → Task 6; §4.1–4.7 → Tasks 5–7; §5.1–5.3 → Task 8; §6 edge cases → checks in Tasks 3, 6, 8; §7.1/7.2 → every task's checks + Tasks 5/6 smoke; §8 rollout + open questions → Task 9.
- **Deviations from the spec** are listed under "Recorded implementation choices" and logged as D546.
- **Shared files with #293:** `estimator-client.tsx` (Task 7 steps 8.1–8.9, Task 8 step 6 — additions next to siblings only), `pdf-options.ts` (three add-only lines), harness (EOF block + one `.then` line). `quote-document.tsx` is not touched.
