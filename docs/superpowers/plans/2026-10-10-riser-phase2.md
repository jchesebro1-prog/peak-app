# Conduit riser phase 2 (#328) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Build spec `docs/superpowers/specs/2026-10-10-riser-phase2-design.md`: **A** the riser data sheet + wire-type
symbol fill, **B** computed conduit fill, **C** the A/V conduit riser. Each piece is pushed on its own after review.

**Architecture:** Extends #321 (`src/lib/design/conduit-riser/`, `conduit-riser-server.ts`, `stores/grid-conduit-riser.ts`,
`/design/grid/[id]/conduit-riser`). Pure rules first, then store/loader, then UI. No migration — new fields live in
JSONB documents/catalog parts.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` first), TypeScript, the spec harness.

## Global Constraints

- Branch `feat/328-riser-phase2` in worktree `/Users/sm/Downloads/peak-app/.claude/worktrees/riser-polish` (created
  from main after the polish merges). Never `git stash`; never touch `.data/pglite`; never leave a dev server or tsx
  running.
- Harness: one `async function riserPhase2<Task>Checks()` per task appended at the END of
  `scripts/test-review-and-spec.ts`, chained after the last `.then` entry; messages start "#328".
- Gates per task with real numbers: tsc (0 errors); `npm run -s test:specs` (ALL PASSED; PASS = previous + new);
  eslint on changed source files; `npm run -s test:smoke` when a route/page is added; `npm run build` at the end of
  each piece (A3, B2, C4).
- Admin pages/actions `requirePerm("manage_users")`; Grid actions `await requireUser()`; catalog part writes only
  through `mergeUpsert`; follow renames (`renamedTo`, `getManyBySku`) when matching SKUs.
- Commits `feat(grid): #328 <title>` / `docs: #328 …` with trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  Stage only source/test/doc files.
- Docs per piece: recompute the next free D number from `origin/main` (headings and inline `**D…`) right before
  writing; PUNCHLIST `## 328.` entry created in A3 and extended in B2/C4; AGENTS.md phase entry in C4.

---

### Task A1: Suggestion rules + riser data sheet model (pure)

**Files:** new `src/lib/design/conduit-riser/suggest-tags.ts`, new `src/lib/riser-data-sheet.ts`.

- [ ] `suggestTagDefaults(part: { model?: string; desc?: string; category?: string }): { code?: string } & TagFields`
  — the spec §A rule table exactly (first match wins, case-insensitive over model + description + category;
  `—` = leave the field undefined; Box never suggested).
- [ ] `riserDataRows(parts, typeKeyOf): ExportRow[]` — Devices rows for parts whose device type is
  `control-networking` | `dimming-power` | `racks-cases`; blank part values pre-filled from `suggestTagDefaults`;
  `source` = `current` | `suggested` | `—` per the spec.
- [ ] `parseRiserDataSheet(rows: unknown[][]): { rows: ParsedRow[]; errors: { row: number; message: string }[] }` —
  header-matched (exact column names from the export), cell rules: blank = leave, `-` = clear, else cleaned
  (`cleanTypeCode`, `cleanTagFields`); invalid cells → a per-row error, never guessed.
- [ ] `planRiserDataApply(parsed, partsBySku): { changes: { sku: string; patch: { designatorCode?: string | null;
  tagDefaults?: TagFields | null } ; before; after }[]; unknown: string[] }` — renamed SKUs resolved by the caller
  (pass the resolved map); no-op rows dropped.
- [ ] Harness: every rule row of the table (incl. CRON beating CRO, a rack, a junction box, no match); export pre-fill
  and Source values; parse (header mismatch, `-`, blank, invalid code/pd); plan (no-op dropped, clear, unknown SKU).
- [ ] Gates; commit `feat(grid): #328 riser data rules and sheet model`.

### Task A2: Catalog → Riser data page (export / upload / preview / apply)

**Files:** new `src/app/(app)/catalog/riser-data/{page.tsx,actions.ts,riser-data-client.tsx}`, an export route if the
Photo/Rack sheets use one (copy their pattern: `/catalog/rack-data` and Catalog → Datasheets → Photo sheet #294 —
reuse their xlsx library, upload size limits, Preview → Apply flow and resumable batches), the Catalog nav/landing link.

- [ ] Export .xlsx (Devices tab) from the live catalog + device-type map; Upload (xlsx only, the same size cap as the
  Photo sheet) → Preview table (part, field: old → new, errors) → Apply (`mergeUpsert` only `designatorCode` and
  `tagDefaults`; results summary). Admin only.
- [ ] Harness (scratch DB): export rows for a seeded DMX outlet + dimmer + speaker (speaker excluded); upload of the
  edited sheet → plan → apply writes only those two fields and follows a renamed SKU; a refused row writes nothing.
- [ ] Gates incl. smoke; browser check on a scratch datadir (export, edit one row, upload, preview, apply). Commit.

### Task A3: Wire-type "Fill symbols from Bray's legend" + docs + push A

**Files:** `src/app/(app)/design/grid/settings/wire-types-card.tsx`, a pure helper (e.g. `src/lib/design/conduit-riser/
wire-symbols.ts`), DECISIONS/PUNCHLIST.

- [ ] `brayWireSymbols(wireTypes): WireType[]` fills only empty Symbol/Signal by connection types per spec §A; the card
  button applies it to the form (user Saves). Harness on the helper.
- [ ] Docs: D entries for the sheet, the rule table, the wire-type fill; PUNCHLIST `## 328.` (piece A done; Jeff:
  export the sheet, review, upload). Gates incl. `npm run build`. Commit. **Push A:** merge `origin/main` in, re-run
  tsc + test:specs, `git push origin HEAD:main`, watch the Vercel production deploy to Ready.

### Task B1: Cable outside diameter field + researched suggestions + Cables tab

**Files:** `src/lib/stores/catalog.ts`, `src/app/(app)/catalog/part-form.ts`, the part editor (`catalog/page.tsx`),
`src/lib/design/grid-parts.ts`, `src/lib/design/grid-bom.ts` (PartLite), new `src/lib/design/conduit-riser/cable-od.ts`,
`src/lib/riser-data-sheet.ts` + the riser data page.

- [ ] `CatalogPart.cableOdIn?: number` (positive, ≤ 3.0, 3 decimals; part editor field shown for per-length parts;
  copied through `gridPartsFrom` both branches into `PartLite`).
- [ ] `CABLE_OD_SUGGESTIONS` from the research file
  `/private/tmp/claude-501/-Users-sm-Downloads-peak-app/93de6900-0583-4173-8278-57e4c02b32d0/scratchpad/risers/cable-od-research.json`
  — only `resolved: true` rows, each with its `source` URL in a comment/field; keyed by normalized manufacturer + model;
  `suggestCableOd(part)` matches by model (and manufacturer when present).
- [ ] Cables tab on the export (spec §A Cables) and its parse/plan/apply (`cableOdIn` only).
- [ ] Harness: field round-trip; suggestions only from resolved rows; Cables tab parse/plan/apply. Gates; commit.

### Task B2: Fill math + display + docs + push B

**Files:** new `src/lib/design/conduit-riser/fill.ts`, the loader (members' OD), the riser editor Run panel + size-label
⚠ + warnings, DECISIONS/PUNCHLIST.

- [ ] `EMT_AREAS` (NEC Chapter 9 Table 4, EMT, total internal area in² for 1/2" … 4" — verify each value against the
  table and cite it in the module), `allowedFillPct(count)` = 53 / 31 / 40, `runFill(memberOds: (number|null)[],
  size: string) → { pct; allowed; over; suggested } | { unknown: string[] } | null` per spec §B (non-EMT size → the
  suggestion only; no members → null).
- [ ] Loader adds each member wire's cable OD; the view/Run panel shows `Fill N % · suggests X"` / amber overfilled
  text; the editor's size label gets ⚠ when over (editor only — never the sheet or DXF); warnings list overfilled runs.
- [ ] Harness: 53/31/40 breaks; exact pct for a known OD pair; suggested size steps; unknown listing; sheet/DXF never
  carry the ⚠. Docs (D entries; PUNCHLIST #328 B done; Jeff: confirm the pre-filled diameters). Gates incl. build.
  **Push B** as in A3.

### Task C1: Engine — system-aware riser (A/V)

**Files:** `src/lib/design/conduit-riser/{model,tables,layout,derive}.ts`.

- [ ] `ConduitRiserSystem = "lighting" | "av"`; `emptyConduitRiserDoc(system)` (A/V: detail "Audio/Visual",
  `alwaysShow` = the spec §C list, `showSignals: false`; lighting unchanged with `showSignals: true`);
  `normalizeConduitRiserDoc(raw, system)` keeps the doc's system and defaults `showSignals` per system;
  `setDefaults` op gains `showSignals?: boolean`.
- [ ] Tables per system (A/V: box types, line legend, rack contents, wire legend only when `showSignals`; no power
  tables). Layout/drawing: no bubbles when `showSignals` is false.
- [ ] Harness: A/V defaults; lighting unchanged (all existing #321 checks still pass); bubbles/wire legend off↔on.
  Gates; commit.

### Task C2: Storage, store, loader and pricing for two risers

**Files:** `src/lib/stores/grid-projects.ts`, `src/lib/stores/grid-conduit-riser.ts`, `src/lib/design/conduit-riser/
live.ts`, `src/lib/design/conduit-riser-server.ts`, `src/lib/design/conduit-riser/bom.ts`, `src/lib/design/grid-quote.ts`.

- [ ] `GridProject.avRiser?: Record<optionId, ConduitRiserDoc>` and `GridRevision.avRiser`; one list
  `CONDUIT_RISER_FIELDS` drives every carry/prune/copy/restore/delete-undo path (refactor the existing lighting-only
  code onto it — behaviour for lighting identical).
- [ ] Store functions and the loader take `system`; system membership per spec §C (audio|video → av).
- [ ] `riserBom` and `buildGridQuote` read both risers.
- [ ] Harness (scratch DB): A/V doc carried through option copy, revision restore, delete-undo and pruning; an audio
  wire suggests on the A/V riser and not on lighting; quote excludes A/V by-others wire; lighting results unchanged.
  Gates; commit.

### Task C3: Page, editor, plan prompt for A/V

**Files:** `src/app/(app)/design/grid/[id]/conduit-riser/*`, `workspace/outputs-menu.tsx`, `workspace/riser-prompt.tsx`,
`use-grid-editor.ts`, the prompt server helper.

- [ ] `?system=av` on the riser page (header names the riser; actions take `system`, whitelisted to the two values);
  Defaults panel gains **Show signal bubbles**; Outputs menu gains **A/V conduit riser →**.
- [ ] Plan prompt: an A/V device pair asks "Add … to the A/V conduit riser?" and accepts on that riser.
- [ ] Harness + smoke (route listed) + browser check (scratch datadir). Commit.

### Task C4: Drawing set + DXF for A/V, docs, push C

**Files:** `src/lib/design/grid-drawing-set.ts`, `src/lib/design/drawing-set-data.ts`,
`src/components/drawing/drawing-set-sheets.tsx`, the DXF helper/route, DECISIONS/PUNCHLIST/AGENTS.md.

- [ ] A/V pages follow the lighting pages (next E-50x numbers, "A/V conduit riser", "(cont.)"), included when the A/V
  riser has ≥ 1 run; exclusion key `av-riser`; DXF `system=av` with file name `…-E-50n-av-conduit-riser.dxf`.
- [ ] Harness: numbering with/without each riser; exclusion; DXF parse. Docs: D entries for piece C; PUNCHLIST #328
  complete; AGENTS.md phase entry. Gates incl. build. **Push C** as in A3.
