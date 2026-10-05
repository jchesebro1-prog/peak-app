# The Grid — object symbols + scale slider (#300) Implementation Plan

**Status:** Shipped 2026-10-05 (D605–D612).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-design symbol size slider and Generic/Object switch for The Grid; object drawings (SVG/PNG) per catalog
part and per device type, drawn on the plan, drawing sets, Product Library tiles and the riser; and a DaVinci import that
attaches ETC's product drawings to matched catalog parts.

**Architecture:** Pure rules in `src/lib/design/grid-symbol-display.ts`, `src/lib/part-docs/svg-sanitize.ts`,
`src/lib/design/object-symbols.ts`, `src/lib/davinci/symbols-plan.ts`. Drawings are part documents of two new kinds
(`symbol`, `riser`) in the existing `part_documents` / private-Blob pipeline, always rendered as images (never inlined).
Servers resolve a `symbolUrls` map for the parts in view; clients only draw.

**Tech Stack:** Next.js 16 App Router (read `node_modules/next/dist/docs/` before any Next API you're unsure of), Drizzle
doc-store, Vercel Blob (private), sharp, `tsx` harness.

**Spec:** `docs/superpowers/specs/2026-10-05-grid-object-symbols-design.md` — read it first.

## Global Constraints

- Worktree `/Users/sm/Downloads/peak-app-299`, branch `feat/300-object-symbols`. `export PATH=~/.local/node/bin:$PATH`.
- Never open `.data/pglite`. `npm run test:specs` uses a mktemp datadir. Browser checks use the scratch dev server on
  :3299 (`PGLITE_PATH=…/scratchpad/pglite-299`) — never start/stop it in a task; **never upload to Blob from the dev
  server** (it loads the real Blob token) — UI upload paths are verified by tests + a manual check by the controller.
- `SymbolShape` stays pure SVG; the harness asserts it never emits `<image` (`scripts/test-review-and-spec.ts` ~5505).
  Object drawings render through a NEW component only.
- **SVG is never inlined into a page.** Only `<image href>` (SVG overlays) or `<img src>` (HTML). Every stored SVG passed
  `sanitizeSvg`.
- Keep every existing action and signature; harness source-text literals byte-identical (repoint, never weaken).
- Inline styles + the Grid palette (`#16181d`, `#dfe2e8`, `#9aa0ab`, `#8c919c`); accent via `var(--accent)`.
- Gates per code task: `npx tsc --noEmit -p .` clean; `npm run test:specs` → `ALL PASSED`, PASS count = previous + new
  checks (`grep -c "^PASS " log`); `npx eslint <touched src files>` 0 problems (never lint the harness — the react-hooks
  plugin crashes on it); `npx next build` for any task touching client components or server/client boundaries.
- Commits: explicit `git add`; never `git stash`; end messages with a blank line then
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Baseline at plan time: 12,085 PASS (origin/main 6ff2d2f9).

---

# Slice 1 — Scale + mode

## Task 1: Symbol display rules (pure)

**Files:** Create `src/lib/design/grid-symbol-display.ts`; test: append to `scripts/test-review-and-spec.ts`.

**Produces:**
```ts
export type SymbolMode = "generic" | "object";
export type SymbolDisplay = { scale: number; mode: SymbolMode };
export const SYMBOL_SCALE_MIN = 0.25; export const SYMBOL_SCALE_MAX = 4; export const SYMBOL_SCALE_STEP = 0.05;
export const DEFAULT_SYMBOL_DISPLAY: SymbolDisplay; // { scale: 1, mode: "generic" }
export function cleanSymbolDisplay(raw: unknown): SymbolDisplay;   // non-object → default; scale: finite → clamp → round to step; else 1; mode: "object" | else "generic"
export const DEFAULT_MARKER = { w: 44, h: 30 } as const;
export function markerBox(part: { symbolWidth?: number; symbolHeight?: number } | null | undefined, scale: number): { w: number; h: number };
  // (symbolWidth || 44) × scale, (symbolHeight || 30) × scale; scale cleaned through cleanSymbolDisplay rules (invalid → 1)
export function hitRadius(base: number, scale: number): number; // base × clamp(scale), floor base × 0.5 so a tiny symbol stays grabbable
```

- [ ] **Step 1: failing checks** (append at END of harness)
```ts
/* #300 object symbols — display rules (Task 1) */
import * as GSD from "@/lib/design/grid-symbol-display";
{
  ok(JSON.stringify(GSD.cleanSymbolDisplay(null)) === JSON.stringify({ scale: 1, mode: "generic" }), "#300 display: default");
  ok(GSD.cleanSymbolDisplay({ scale: 9, mode: "object" }).scale === 4 && GSD.cleanSymbolDisplay({ scale: 0.01 }).scale === 0.25, "#300 display: scale clamps 0.25–4");
  ok(GSD.cleanSymbolDisplay({ scale: 1.234 }).scale === 1.25 && GSD.cleanSymbolDisplay({ scale: NaN }).scale === 1, "#300 display: scale rounds to 0.05; NaN → 1");
  ok(GSD.cleanSymbolDisplay({ mode: "object" }).mode === "object" && GSD.cleanSymbolDisplay({ mode: "weird" }).mode === "generic", "#300 display: mode");
  const b = GSD.markerBox({ symbolWidth: 48, symbolHeight: 34 }, 0.5);
  ok(b.w === 24 && b.h === 17 && GSD.markerBox(null, 2).w === 88 && GSD.markerBox({}, 1).h === 30, "#300 display: marker box scales, 44×30 fallback");
  ok(GSD.markerBox({ symbolWidth: 44 }, NaN).w === 44, "#300 display: bad scale → 1");
  ok(GSD.hitRadius(0.028, 2) === 0.056 && GSD.hitRadius(0.028, 0.25) === 0.014, "#300 display: hit radius scales, floor at half");
}
```
- [ ] **Step 2:** run → FAIL. **Step 3:** implement (round: `Math.round(x / STEP) * STEP` then `Math.round(v*100)/100`;
  hitRadius: `base * Math.max(0.5, clampedScale)` rounded to 6 decimals). **Step 4:** run → PASS (+7 → 12,092).
- [ ] **Step 5: commit** `feat(grid): symbol display rules (#300)`.

## Task 2: Store + action + page plumbing

**Files:** `src/lib/stores/grid-projects.ts` (GridProject `symbolDisplay?: SymbolDisplay`; `setSymbolDisplay(projectId, raw)`
using `patchDoc` + `cleanSymbolDisplay`, bumps `updatedAt`); `src/app/(app)/design/grid/[id]/actions.ts`
(`setSymbolDisplayAction(projectId, raw)` → requireUser, store, revalidate editor + `/set` + `/riser`); editor
`page.tsx` passes `symbolDisplay: cleanSymbolDisplay(project.symbolDisplay)` in the project payload (`ProjectLite` gains
it, `use-grid-editor.ts`); `set/page.tsx` and `riser/page.tsx` read it the same way. Harness: async check in a new
`gridSymbolDisplayAsyncChecks300` chained after the last `.then(...)` before `.finally(teardownFixtures)`: create a project
(pattern: `gridBatchAsyncChecks299`), `setSymbolDisplay(id, { scale: 9, mode: "object" })` → stored `{ scale: 4, mode:
"object" }`; plus a source-text check that `setSymbolDisplayAction` calls `requireUser()` and `revalidatePath(` (+2).

- [ ] Steps: failing checks → implement → PASS (+2 → 12,094) → tsc/eslint/build → commit `feat(grid): per-design symbol display setting (#300)`.

## Task 3: Toolbar slider + toggle; scale on canvas and drawing sets

**Files:** `use-grid-editor.ts`, `workspace/toolbar.tsx` (+ a small `workspace/symbol-controls.tsx` if toolbar.tsx would
grow > ~40 lines), `plan-canvas.tsx`, `set/page.tsx`, `set/plan-sheet-figure.tsx`.

- Hook: `symbolDisplay` state from props; `setSymbolScale(v)` paints live, saves via `setSymbolDisplayAction` debounced
  400 ms (last value wins; on failure revert + `err`); `setSymbolMode(m)` saves immediately; no undo entry; does not clear
  the undo stack. Hit-testing (`onDown`, `snappedPlacement`, marquee unaffected) uses `hitRadius(DEVICE_HIT_RADIUS, scale)`
  and `DEVICE_SNAP_RADIUS` × same factor.
- Toolbar (View group, after Snap): `Size` range input 25–400 step 5 showing `NN%`, double-click → 100%; a two-button
  Generic / Object segmented toggle (`aria-pressed`). Disabled in Spreadsheet view? No — it's a display setting; keep
  enabled.
- Canvas: replace the `|| 44` / `|| 30` fallback with `markerBox(part, scale)`; assembly children 10×8 × scale; label chip
  offset and selection ring radius (15) × scale (ring min 6). Curtain glyph 22×16 × scale.
- Drawing set: `figPlacement` uses `markerBox(part, scale)`; `plan-sheet-figure.tsx` collision boxes use the scaled size
  (they already use `pl.w/pl.h`, so passing scaled w/h is enough — verify).
- Mode toggle has no visual effect yet (Task 9 draws object drawings) — that's expected.
- Browser check (:3299 GRD-5002): slider 50%/200% shrinks/grows markers live, persists on reload, click targets follow
  (a 25% marker is still selectable by clicking its centre), `/design/grid/GRD-5002/set` reflects the size.
- Gates incl. build; repoint any harness literal that moved (e.g. `const w = part?.symbolWidth || 44;` if asserted —
  grep first). Commit `feat(grid): symbol size slider and Generic/Object switch (#300 slice 1)`.

---

# Slice 2 — Object drawings

## Task 4: SVG sanitizer + sniffing (pure)

**Files:** Create `src/lib/part-docs/svg-sanitize.ts`; modify `src/lib/part-docs/files.ts` (`SniffedType` gains `"svg"`;
`sniffDocumentType` recognises SVG text: after an optional UTF-8 BOM, whitespace, `<?xml …?>`, comments and a `<!DOCTYPE
svg…>`, the first element is `<svg`); fixture: copy ONE real DaVinci SVG that has an Illustrator `<style>` block (≤ 30 KB,
pick with `ls -S`) to `docs/test-fixtures/davinci-symbol-sample.svg` and the one with `<script>`
(`data/davinci/source/2026-09-02T01-37-52-850Z/images/{2c3fcb96-0755-4899-b320-30f5ca63692f}.svg`) to
`docs/test-fixtures/davinci-symbol-script.svg` (harness fixtures must be committed under docs/).

**Produces:**
```ts
export const SVG_MAX_BYTES = 1_000_000;
export type SanitizeResult = { ok: true; svg: string; removed: string[] } | { ok: false; error: string };
export function sanitizeSvg(text: string): SanitizeResult;
```
Rules (regex/structural, no DOM dependency): reject `> SVG_MAX_BYTES` ("That drawing is over 1 MB."); strip BOM, `<?xml
…?>` declarations (keep none), `<!DOCTYPE…>`, `<?xml-stylesheet…?>`; require exactly one root `<svg …>…</svg>` (else
"That file is not an SVG drawing."); remove whole elements `script`, `foreignObject`, `iframe`, `embed`, `object`, `audio`,
`video`, `handler`, `listener` (incl. self-closing, case-insensitive); remove attributes matching `/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi`;
for `href` / `xlink:href` keep only values starting `#` or `data:image/(png|jpeg|webp);base64,`; in `<style>` blocks and
`style=""` remove `@import …;` and `url(` targets that aren't `#…`; finally refuse if `/javascript:|vbscript:/i` remains.
`removed` lists what was stripped (`"script"`, `"on* attributes"`, …) for the import report.

- [ ] **Step 1: failing checks**
```ts
/* #300 object symbols — SVG sanitizer (Task 4) */
import { sanitizeSvg, SVG_MAX_BYTES } from "@/lib/part-docs/svg-sanitize";
import { sniffDocumentType as sniff300 } from "@/lib/part-docs/files";
{
  const enc = (s: string) => new TextEncoder().encode(s);
  const S = (inner: string, attrs = "") => `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"${attrs}>${inner}</svg>`;
  const a = sanitizeSvg(S('<script>alert(1)</script><rect width="5" height="5" onclick="x()"/>'));
  ok(a.ok && !/script|onclick/i.test(a.svg) && a.svg.includes("<rect"), "#300 svg: script element and on* attributes removed");
  const b = sanitizeSvg(S('<foreignObject><div>x</div></foreignObject><image href="https://evil/x.png"/><use xlink:href="#a"/>'));
  ok(b.ok && !/foreignObject|evil/i.test(b.svg) && b.svg.includes('xlink:href="#a"'), "#300 svg: foreignObject + external href removed, #fragment kept");
  const c = sanitizeSvg(S('<style>@import url(https://x/y.css); .st0{fill:url(https://x/p)}</style><a href="javascript:alert(1)"><rect/></a>'));
  ok(c.ok && !/@import|https:\/\/x|javascript:/i.test(c.svg), "#300 svg: style imports, external url() and javascript: hrefs removed");
  ok(!sanitizeSvg("<html><body>hi</body></html>").ok && !sanitizeSvg("x".repeat(SVG_MAX_BYTES + 1)).ok, "#300 svg: non-svg root and oversize refused");
  ok(!sanitizeSvg(S("") + S("")).ok, "#300 svg: two roots refused");
  const real = readFileSync(join(process.cwd(), "docs/test-fixtures/davinci-symbol-sample.svg"), "utf8");
  const r = sanitizeSvg(real);
  ok(r.ok && r.svg.includes("<style") && r.svg.includes("viewBox"), "#300 svg: a real DaVinci drawing survives with its styles and viewBox");
  const scr = sanitizeSvg(readFileSync(join(process.cwd(), "docs/test-fixtures/davinci-symbol-script.svg"), "utf8"));
  ok(scr.ok && !/<script/i.test(scr.svg) && scr.removed.includes("script"), "#300 svg: DaVinci's one scripted drawing is cleaned");
  ok(sniff300(enc("﻿  <?xml version='1.0'?>\n<!-- c --><svg xmlns='http://www.w3.org/2000/svg'/>")) === "svg" && sniff300(enc("<html></html>")) !== "svg", "#300 svg: sniffing recognises SVG text");
}
```
- [ ] Steps 2–4: FAIL → implement → PASS (+8 → 12,102). Existing part-doc checks must still pass (`ALLOWED_TYPES` must not
  admit `svg` for datasheet/specsheet/manual/image — sniffing returns "svg" but those kinds still refuse it).
- [ ] Commit `feat(part-docs): SVG sanitizer and sniffing (#300)`.

## Task 5: `symbol` / `riser` document kinds — upload, sanitize, serve

**Files:** `src/lib/part-docs/types.ts` (`PartDocKind` += `"symbol" | "riser"`; `ALL_PART_DOC_KINDS` += both;
`PART_DOC_KIND_LABEL` "Symbol drawing" / "Riser drawing"; `isPartDocKind`; size cap 5 MB for both; NOT in
`DOC_SLOT_KINDS`); `files.ts` (`ALLOWED_TYPES.symbol = ALLOWED_TYPES.riser = ["svg","png","jpeg","webp"]`; `acceptFor`);
the upload token route (`src/app/api/part-documents/upload/route.ts` — add `image/svg+xml` to the allowed content types
ONLY for symbol/riser paths if the route distinguishes, else globally — `checkDocumentBytes` is the authority);
`verify-upload.ts` / the attach + replace actions (`src/app/(app)/catalog/documents/actions.ts`): for kind symbol/riser,
SVG → read the whole blob (≤ 1 MB), `sanitizeSvg`, write the sanitized text to a NEW blob path, delete the original;
raster → `shrinkImage` at ≤ 1024 px WebP keeping alpha (add a `maxPx` parameter to `shrinkImage`, default 1600);
**one current link per part per kind** for symbol/riser (attaching unlinks the previous symbol link; the old document keeps
its history); `src/app/api/part-documents/[id]/route.ts`: for `image/svg+xml` add `Content-Security-Policy: sandbox;
default-src 'none'; img-src data:; style-src 'unsafe-inline'` (keep `nosniff`, private cache). Grep every
`switch`/`Record` over `PartDocKind` (`grep -rn "PartDocKind" src`) and make each handle the new kinds (the Datasheets
to-do list, coverage, portal sidebar, client packages must NOT start listing symbol/riser — mirror how `image` is excluded).

Harness: store-level async (`partDocSymbolAsyncChecks300`): attach a symbol doc to a fixture part twice → only the second
is linked; `isPartDocKind("symbol")`; `checkDocumentBytes("symbol", svgBytes).ok` and `checkDocumentBytes("datasheet",
svgBytes).ok === false`; source-text: the serve route contains `sandbox` and `image/svg+xml` (+5 → 12,107).
- [ ] Gates incl. build. Commit `feat(part-docs): symbol and riser drawing kinds (#300)`.

## Task 6: Resolution + server URL map + device-type drawings

**Files:** create `src/lib/design/object-symbols.ts` (pure); `src/lib/design/device-types.ts` (`DeviceType.symbolDocId?:
string` kept by `cleanType`, id shape `^PD-[A-Za-z0-9_-]{1,60}$`); store `src/lib/stores/device-types.ts`
(`setDeviceTypeSymbol(typeKey, docId | null)`); create `src/lib/design/object-symbols-server.ts` (server-only).

**Produces (pure):**
```ts
export type SymbolDocs = { partSymbol?: string; partRiser?: string; typeSymbol?: string }; // document ids
export type ObjectSymbolUrls = { plan?: string; riser?: string };
export function resolveObjectSymbol(d: SymbolDocs): ObjectSymbolUrls;
  // plan = partSymbol ?? typeSymbol; riser = partRiser ?? plan; urls are `/api/part-documents/${encodeURIComponent(id)}`
```
**Produces (server):** `symbolUrlsFor(parts: PartLite[], types: DeviceType[]): Promise<Record<string, ObjectSymbolUrls>>`
— one query for current symbol/riser links of the parts' skus (`pricingPartId ?? id` → catalog sku, the same key part
documents use; check `part_document_links.partSku` semantics), then the type fallback via `typeKeyOfPart`. Only parts
with at least one url appear in the map.

Harness: pure checks of `resolveObjectSymbol` (part wins; type fallback; riser falls back to plan; empty → `{}`) (+4);
async: `setDeviceTypeSymbol` round-trip + `cleanType` keeps a valid id and drops a bad one (+2) → 12,113.
- [ ] Commit `feat(grid): object symbol resolution and device-type drawings (#300)`.

## Task 7: Draw object symbols — canvas, drawing set, Product Library

**Files:** create `src/components/design/object-symbol.tsx` (`ObjectSymbol({ href, x, y, w, h, selected? })` → SVG `<g>`
with `<image href preserveAspectRatio="xMidYMid meet" x y w h>` centred on x/y, a faint `#dfe2e8` outline only when
selected; and `ObjectSymbolImg({ src, size })` → `<img>` with `object-fit: contain`, `alt=""`, `draggable={false}`);
editor `page.tsx` / `set/page.tsx` compute `symbolUrls` via `symbolUrlsFor` (try/catch → `{}` + console.error) and pass
it; `use-grid-editor.ts` exposes `symbolUrls`; `plan-canvas.tsx`: in Object mode, a placement whose part has `plan` url
draws `ObjectSymbol` at `markerBox(part, scale)` instead of `SymbolShape` (assembly: the assembly's own drawing if any,
else its generic children as today; curtains unchanged); legend rows unchanged (generic key) — add a "Drawings shown"
note row in Object mode; `plan-sheet-figure.tsx` + `set/page.tsx`: `FigurePlacement.href?` drawn with `ObjectSymbol` when
the design is in Object mode; `workspace/product-library.tsx`: tiles use `ObjectSymbolImg` when the part has a `plan`
url (always, regardless of mode), else `SymbolIcon`. Client boundary: `object-symbol.tsx` is a plain component (no
server imports); add it to the harness client-boundary lists that enumerate grid client files if those lists are exact.

Harness: source-text checks — `symbol-shape.tsx` still has no `<image` (existing), `object-symbol.tsx` uses `<image`
and `preserveAspectRatio`, plan-canvas renders `<ObjectSymbol` only under the object-mode branch (`mode === "object"`
appears in the condition) (+3 → 12,116).
- [ ] Browser: the controller attaches one test drawing to a scratch part via the store (no Blob upload) — skip in-task;
  verify Generic/Object toggling doesn't break rendering when no drawings exist. Gates incl. build. Commit
  `feat(grid): draw object symbols on the plan, drawing sets and library tiles (#300)`.

## Task 8: Riser in Object mode

**Files:** `src/lib/design/grid-riser-view.ts` / `grid-riser-doc.ts` (`RiserViewGroup.href?`), `riser/page.tsx` (pass
`symbolUrls` riser urls + mode), `src/components/drawing/riser-canvas.tsx`: in Object mode, a device row with a riser
url draws `ObjectSymbol` at a 28-unit row height instead of the 12×12 badge; node heights computed with the taller row
(`NODE_ROW_OBJECT = 28` beside `NODE_ROW = 16`; one pure helper `nodeRowHeight(mode)`); generic rows unchanged. The set's
E-501 riser follows the design mode too. Harness: pure check of `nodeRowHeight` (+1) and existing riser checks still pass
(→ 12,117). Gates incl. build. Commit `feat(grid): riser drawings in Object mode (#300)`.

## Task 9: Build-out UI — part editor + device types

**Files:** the catalog part editor's Documents section (find with `grep -rn "Documents" src/app/(app)/catalog --include=*.tsx | grep -i section` — the #207/#290 section that renders Datasheet/Spec sheet/Manual slots and the Images gallery): add **Symbol drawing** and **Riser drawing** single slots (upload via the existing direct-to-Blob client with kind `symbol`/`riser`, accept from `acceptFor`, replace, remove, preview `ObjectSymbolImg` on a checkerboard); Grid Settings → Device types card (`settings/device-type-icons-card.tsx`): a drawing slot per type (upload as a `symbol` part document NOT linked to any part — like manufacturer images — then `setDeviceTypeSymbolAction(typeKey, docId|null)` requiring `manage_users`; NOTE the harness asserts `settings/actions.ts` has exactly 10 exported actions with `requirePerm("manage_users")` — update that check's expected count to 11 explicitly (this is a deliberate change, say so in the commit body)).
- Harness: source-text checks that both UIs use kind `"symbol"` and the settings action requires `manage_users` (+2 →
  12,119). Gates incl. build. The controller does the real upload check on a preview deploy (dev server must not upload).
  Commit `feat(grid): upload symbol and riser drawings per part and per device type (#300 slice 2)`.

---

# Slice 3 — DaVinci import

## Task 10: Extract image ids

**Files:** `src/lib/davinci/types.ts` (`DavinciRecord.planImageId?`, `riserImageId?`), `src/lib/davinci/extract.ts`
(read `visuals.data.imageId` / `riserImageId`, strip braces, lower-case, drop empty), regenerate
`data/davinci-extract.json` with `npm run davinci:extract` (reads the newest source folder on this Mac; commit the
regenerated file). Harness: the #162 extract tests keep passing; add checks against `LIB162`-style fixture: a type with
`visuals.data.imageId "{ABC-…}"` → `planImageId "abc-…"`; riser too; empty → absent (+3 → 12,122).
- [ ] Commit `feat(davinci): extract plan and riser image ids (#300)`.

## Task 11: Import plan + `symbols:davinci` script

**Files:** create `src/lib/davinci/symbols-plan.ts` (pure):
```ts
export type SymbolImportCandidate = { partSku: string; kind: "symbol" | "riser"; imageId: string; typeId: string };
export type ExistingSymbol = { partSku: string; kind: "symbol" | "riser"; source: string; sourceRef?: string };
export type SymbolImportPlan = { attach: SymbolImportCandidate[]; skipped: { reason: "not-downloaded" | "already-present" | "hand-uploaded"; c: SymbolImportCandidate }[] };
export function planSymbolImport(candidates: SymbolImportCandidate[], onDisk: ReadonlySet<string>, existing: ExistingSymbol[]): SymbolImportPlan;
  // not on disk → not-downloaded; existing for same part+kind with source !== "davinci" → hand-uploaded; existing davinci with same sourceRef → already-present; existing davinci with different sourceRef → attach (replaces the older DaVinci drawing); else attach
export function candidatesFor(extract: DavinciExtract, catalog: { id: string; sku: string; manufacturer?: string }[]): SymbolImportCandidate[];
  // match exactly as #207 prefill does (buildIndexWithStats + matchSku + peakMfrFor); one candidate per (part, kind) with an image id
```
and `scripts/symbols-davinci.ts` + `package.json` script `symbols:davinci`: loads the extract, the catalog, existing
symbol/riser docs; lists `data/davinci/source/<newest>/images/` (`{uuid}.svg|png`, braces); prints the plan summary; with
`--apply` (and `--yes` on a hosted DB via `scripts/db-target.ts`): for each attach — SVG → `sanitizeSvg` (log `removed`),
PNG → `shrinkImage(…, 1024)`; upload to Blob at `part-docs/<PD-id>/<name>`; create the document `source: "davinci"`,
`sourceRef: imageId`, title "DaVinci <displayName>"; link with the one-current rule. When no Blob token is set (local
dev), store nothing and say "Blob storage is not configured — dry run only." Harness: pure checks of `planSymbolImport`
(4 reasons) and `candidatesFor` on a tiny fixture (+5 → 12,127). Run `npm run symbols:davinci` (dry run) against the
local scratch datadir (`PGLITE_PATH=…/pglite-299`, dev server STOPPED first by the controller) and record the summary in
the report. Commit `feat(davinci): symbols:davinci import (#300 slice 3)`.

## Task 12: Docs, gates, merge

- DECISIONS D605–D612 (spec §1–4), PUNCHLIST `## 300.`, AGENTS item 39, spec/plan Status lines; renumber if origin/main
  moved. Full gates (tsc, specs, eslint, build, test:smoke with the dev server stopped). Browser walk on :3299. Merge +
  push after Jeff's go; production `symbols:davinci --apply --yes` is Jeff-gated.
