# Spec Library Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One spec record per product family / system, imported from Jeff's v1 library, matched to any BOM row
(catalog, vendor-quoted, or custom) in the `/design/specs` builder, and edited from the builder or the Spec
Library screen.

**Architecture:** New doc collections `spec_records` + `spec_record_revisions` behind one write path
(`saveSpecRecord`). A pure matcher (`record-match.ts`) runs inside the existing pure `assembleSection`, so the
builder preview and the Word file render the same thing. Records print as lettered product entries under the
existing Part 2 category articles (`sourceArticleId`). Catalog `specBody` stays as a legacy fallback.

**Tech Stack:** Next.js 16 App Router (read `node_modules/next/dist/docs/` before touching routing APIs),
TypeScript, Drizzle doc-tables on Postgres/PGlite, `exceljs`, `docx`, the single-file test harness
`scripts/test-review-and-spec.ts` (`ok(cond, msg)`; new blocks are appended at EOF as `{ … }` blocks with
top-level await).

**Spec:** `docs/superpowers/specs/2026-09-28-spec-records-design.md` — read it first. §-references below point there.

## Global Constraints

- Keep the brief's field names verbatim on `SpecRecord` (spec §1.1). Timestamps epoch-ms numbers.
- No AI anywhere (D89). Same library + same spec → identical preview and identical `document.xml`.
- Never use `window.prompt()` / `window.confirm()` (D96). Inline UI only.
- `"use client"` files may only `import type` from anything that reaches the doc-store/db (`@/lib/stores/*`,
  `@/db/*`, `exceljs`, `*-io.ts`). Run `npx next build` in the task gate whenever a task touches a client file.
- Every server action: `requireUser()` for reads, `requirePerm("create")` for writes (D260), then
  `revalidatePath` (+ `router.refresh()` client side).
- PGlite is single-process: never run a db script while a dev server or another script holds `.data/pglite`.
  Tests always run via `npm run test:specs` (temp datadir). Snapshot `.data` to `.data-backup-<date>/` before any
  script that opens the real dev DB.
- Only `ready` records print; `archived` never matches; `draft` is reported, never printed.
- `#` wildcard = exactly one digit `1`–`5`.
- Worktree: `/Users/sm/Downloads/peak-app/.claude/worktrees/spec-records`, branch `feat/spec-records`. Never
  `git stash` (shared across worktrees) — commit instead. Never push from a task; the controller pushes.
- Gate for every task: `npx tsc --noEmit` clean, `npm run test:specs` = previous PASS count + new, 0 FAIL;
  `npx eslint <touched files>` clean.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/specs/records.ts` (new, pure) | `SpecRecord` types, normalize, validate, content-equality, kind/status labels, id helpers |
| `src/lib/specs/record-keys.ts` (new, pure) | part-number/key normalization, wildcard, `curtainSpecKey`, `specRowKey`, placeholder SKUs |
| `src/lib/specs/record-match.ts` (new, pure) | per-row match (steps 0–5), companions, candidates |
| `src/lib/specs/record-import.ts` (new, pure) | JSON/sheet rows → records, import plan, sheet layout constants, export rows |
| `src/lib/specs/record-io.ts` (new, server-only) | exceljs read/write of the `Spec Library` sheet |
| `src/lib/stores/spec-records.ts` (new, server) | get/list/save/revisions/restore/nextSpecId |
| `src/db/doc-tables.ts`, `drizzle/0033_spec_records.sql`, `drizzle/meta/*` | the two collections |
| `scripts/import-spec-library.ts` (new) | CLI import |
| `src/lib/specs/spec-document.ts` | `SpecDocProduct` + `SpecDocument` new fields + pure edits |
| `src/lib/specs/quote-bom.ts`, `src/lib/bid-spec.ts` (`BomRow`), `src/lib/design/grid-virtual-parts.ts`, `src/lib/design/grid-quote.ts`, `src/lib/design/grid-bom.ts`, `src/app/(app)/estimator/types.ts` | row fields through the BOM seam |
| `src/lib/specs/outline.ts`, `src/lib/specs/spec-docx.ts` | sixth level |
| `src/lib/specs/record-fill-ins.ts` (new, pure) | `[bracket]` job values |
| `src/lib/specs/assemble-section.ts`, `src/lib/specs/load-spec.ts` | records in assembly |
| `src/app/(app)/design/specs/record-actions.ts` (new) | builder + library record actions |
| `src/app/(app)/design/specs/[id]/builder.tsx` (+ new sibling components) | match report UI |
| `src/app/(app)/design/specs/library/*` | records view, editor, history, import/export |
| estimator + Grid curtain UI | `specKey` pickers |

---

### Task 1: Record model (pure)

**Files:**
- Create: `src/lib/specs/records.ts`
- Test: append block to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SpecKind = "product_catalog" | "product_vendor" | "system" | "companion";
  export type SpecStatus = "draft" | "ready" | "archived";
  export const SPEC_KINDS: readonly SpecKind[]; export const SPEC_STATUSES: readonly SpecStatus[];
  export type SpecRecord = { specId; kind; status; section; article; title; basisOfDesign: string|null;
    manufacturer: string|null; mfrNumbers: string[]; matchKey: string|null; includeWith: string[];
    specText: string; notes: string|null; sourceArticleId: string|null; revision: number; updatedAt: number; updatedBy: string };
  export function normalizeSpecRecord(raw: unknown): SpecRecord | null; // null when specId empty or kind unknown
  export function sameSpecContent(a: SpecRecord, b: SpecRecord): boolean; // ignores revision/updatedAt/updatedBy; mfrNumbers/includeWith compared in order after normalize
  export type RecordProblem = { specId: string; field: string; message: string; blocking: boolean };
  export type RecordValidationCtx = { sections: Array<{ id: string; number: string }>; articles: Array<{ id: string; sectionId: string }>; specIds: Set<string> };
  export function validateSpecRecord(r: SpecRecord, ctx: RecordValidationCtx): RecordProblem[];
  export function sectionIdForRecord(r: SpecRecord, sections: Array<{id:string;number:string}>): string | null; // csiKey match, exactly one
  export const KIND_LABELS: Record<SpecKind, string>; // workbook labels
  export function kindFromLabel(label: string): SpecKind | null;
  export function statusFromLabel(label: string): SpecStatus; // Ready/Draft/Archived, case-insensitive; unknown → "draft"
  export function nextSpecIdFor(sectionNumber: string, existing: Iterable<string>): string; // PS-<digits>-<NNN>, max+1, 3-digit pad
  ```
- Consumes: `csiKey` from `src/lib/specs/articles.ts`.

Rules (spec §1.1):
- `normalizeSpecRecord`: trim strings; `""` → `null` for the nullable fields; `mfrNumbers`/`includeWith` accept
  array or string (split on `/[\n,;]+/`), trimmed, empty dropped, de-duplicated case-insensitively keeping first
  spelling; `kind` must be one of `SPEC_KINDS` else `null`; unknown `status` → `"draft"`; `revision` ≥ 1 integer
  (default 1); `updatedAt` number (default 0); `updatedBy` string.
- `validateSpecRecord` problems (blocking unless noted): empty `title`; empty `specText`; `product_catalog` /
  `product_vendor` with no `mfrNumbers`; `system` with no `matchKey`; `companion` with empty `includeWith` or an id
  not in `ctx.specIds`; `section` not resolving to exactly one section; `status==="ready"` with missing
  `sourceArticleId`, an unknown article, or an article whose `sectionId` ≠ the record's section id. For
  `draft`/`archived` records the article problems are non-blocking.
- `KIND_LABELS`: `product_catalog: "Product – catalog"`, `product_vendor: "Product – vendor quote"`,
  `system: "System (custom, no part #)"`, `companion: "Companion"`. `kindFromLabel` matches exact label, the raw
  enum value, or on the lowercase leading text: starts with `product` + contains `vendor` → vendor; starts with
  `product` → catalog; starts with `system` → system; starts with `companion` → companion; else `null`.

- [ ] **Step 1: Write failing tests** — append at EOF:

```ts
/* ---- Spec records (spec 2026-09-28-spec-records-design.md §1) ---- */
{
  const R = await import("@/lib/specs/records");
  const base = { specId: " PS-1 ", kind: "product_vendor", status: "Ready", section: "26 09 61", article: "A", title: "T",
    basisOfDesign: "", manufacturer: "ETC", mfrNumbers: "IQ12\nIQ24; iq24", matchKey: "", includeWith: [], specText: "x",
    notes: null, sourceArticleId: "ar-1" };
  const n = R.normalizeSpecRecord(base)!;
  ok(n.specId === "PS-1" && n.basisOfDesign === null && n.matchKey === null, "records: normalize trims and nulls blanks");
  ok(JSON.stringify(n.mfrNumbers) === '["IQ12","IQ24"]', "records: mfrNumbers split on newline/semicolon and de-dup case-insensitively");
  ok(n.status === "draft", "records: an unknown status label normalizes to draft (statusFromLabel is the label reader)");
  ok(R.statusFromLabel("Ready") === "ready" && R.statusFromLabel("archived") === "archived", "records: statusFromLabel");
  ok(R.normalizeSpecRecord({ ...base, kind: "widget" }) === null, "records: unknown kind is refused, not defaulted");
  ok(R.kindFromLabel("System (custom, no part #)") === "system" && R.kindFromLabel("Product – vendor quote") === "product_vendor"
    && R.kindFromLabel("Product - catalog") === "product_catalog" && R.kindFromLabel("Companion (rides with)") === "companion"
    && R.kindFromLabel("nope") === null, "records: kindFromLabel maps workbook labels");
  const ctx = { sections: [{ id: "ss1", number: "26 09 61" }], articles: [{ id: "ar-1", sectionId: "ss1" }, { id: "ar-x", sectionId: "other" }], specIds: new Set(["PS-1"]) };
  const ready = { ...n, status: "ready" as const };
  ok(R.validateSpecRecord(ready, ctx).length === 0, "records: a complete ready vendor record validates");
  ok(R.validateSpecRecord({ ...ready, mfrNumbers: [] }, ctx).some((p) => p.blocking && p.field === "mfrNumbers"), "records: product record needs part numbers");
  ok(R.validateSpecRecord({ ...ready, kind: "system", mfrNumbers: [] }, ctx).some((p) => p.field === "matchKey"), "records: system record needs a match key");
  ok(R.validateSpecRecord({ ...ready, sourceArticleId: "ar-x" }, ctx).some((p) => p.blocking && p.field === "sourceArticleId"), "records: ready record's article must be in its section");
  ok(!R.validateSpecRecord({ ...ready, status: "archived", sourceArticleId: "gone" }, ctx).some((p) => p.blocking), "records: archived article problems are non-blocking");
  ok(R.validateSpecRecord({ ...ready, kind: "companion", mfrNumbers: [], includeWith: ["PS-9"] }, ctx).some((p) => p.field === "includeWith"), "records: companion naming an unknown spec is a problem");
  ok(R.validateSpecRecord({ ...ready, section: "11 11 11" }, ctx).some((p) => p.field === "section"), "records: unknown section is a problem");
  ok(R.sameSpecContent(ready, { ...ready, revision: 7, updatedAt: 9, updatedBy: "z" }), "records: sameSpecContent ignores revision/stamps");
  ok(!R.sameSpecContent(ready, { ...ready, specText: "y" }), "records: sameSpecContent sees text changes");
  ok(R.nextSpecIdFor("26 09 61", ["PS-260961-028", "PS-260961-007", "PS-116123-010"]) === "PS-260961-029"
    && R.nextSpecIdFor("11 61 99", []) === "PS-116199-001", "records: nextSpecIdFor");
}
```

- [ ] **Step 2: Run** `npm run test:specs 2>&1 | grep -E "records:|^FAIL" | head` — expect import failure / FAILs.
- [ ] **Step 3: Implement** `src/lib/specs/records.ts` per the interface and rules above (pure: no store imports,
  no `Date.now()`).
- [ ] **Step 4: Run** `npm run test:specs 2>&1 | tail -3` — all PASS, 0 FAIL.
- [ ] **Step 5: Commit** `feat(specs): spec record model — normalize, validate, labels`

---

### Task 2: Collections, migration, store

**Files:**
- Modify: `src/db/doc-tables.ts` (add `specRecords = docTable("spec_records")`, `specRecordRevisions =
  docTable("spec_record_revisions")` after `specDocuments`, and both in `DOC_TABLES`)
- Create: `drizzle/0033_spec_records.sql` + journal/snapshot via `npm run db:generate -- --name spec_records`,
  then hand-edit the SQL to the idempotent shape of `drizzle/0027_spec_documents.sql` (CREATE TABLE/INDEX IF NOT
  EXISTS + `CREATE OR REPLACE TRIGGER <table>_seq_bump … bump_doc_seq()`) for **both** tables.
  If `db:generate` wants to open a DB or fails, write the SQL by hand and add the journal entry
  `{ "idx": 33, "version": "7", "when": <Date.now()>, "tag": "0033_spec_records", "breakpoints": true }` and copy
  `0032_snapshot.json` → `0033_snapshot.json` adding the two tables (mirror an existing doc table's entry).
- Create: `src/lib/stores/spec-records.ts`
- Check: `DEMO_COLLECTIONS` (`src/db/seed-data.ts`) is `Object.keys(DOC_TABLES)` — records are content, not demo
  data: exclude `spec_records` and `spec_record_revisions` from the go-live wipe the same way any existing
  exclusion is done there (read the file; if there is no exclusion mechanism, add a small `KEEP_ON_GO_LIVE` set
  and filter). Log this as a decision in Task 11.
- Test: append block.

**Interfaces:**
- Consumes: Task 1 (`normalizeSpecRecord`, `sameSpecContent`, `nextSpecIdFor`, `SpecRecord`).
- Produces (`src/lib/stores/spec-records.ts`, server-only):
  ```ts
  export type SpecRecordRevision = { id: string; specId: string; revision: number; record: SpecRecord; savedAt: number; savedBy: string; why: string };
  export type SaveOutcome = "created" | "updated" | "unchanged";
  export async function getSpecRecord(specId: string): Promise<SpecRecord | null>;
  export async function allSpecRecords(): Promise<SpecRecord[]>; // sorted by specId
  export async function saveSpecRecord(next: SpecRecord, by: string, why: string): Promise<{ outcome: SaveOutcome; record: SpecRecord }>;
  export async function specRecordRevisions(specId: string): Promise<SpecRecordRevision[]>; // newest first
  export async function restoreSpecRecordRevision(specId: string, revision: number, by: string): Promise<{ ok: true; record: SpecRecord } | { ok: false; error: string }>;
  export async function nextSpecId(sectionNumber: string): Promise<string>;
  ```
  `saveSpecRecord`: read current by `specId`; none → write `{...next, revision: 1, updatedAt: now, updatedBy: by}`
  (`created`); `sameSpecContent` → `unchanged` (no write); else `upsertDoc("spec_record_revisions", { id:
  \`${specId}@${cur.revision}\`, specId, revision: cur.revision, record: cur, savedAt: now, savedBy: by, why })`
  then write `{...next, revision: cur.revision + 1, …}` (`updated`). Records are stored with `id = specId`. Read
  `src/db/doc-store.ts` `upsertDoc`/`getDoc`/`listDocs`/`listDocsByField` for exact signatures.

- [ ] **Step 1: Failing test** (DB-backed; the harness runs on a temp PGlite):

```ts
/* ---- Spec records store (§1.2) ---- */
{
  const S = await import("@/lib/stores/spec-records");
  const R = await import("@/lib/specs/records");
  const rec = R.normalizeSpecRecord({ specId: "PS-TEST-001", kind: "system", status: "ready", section: "11 61 23", article: "A",
    title: "T", matchKey: "Test – Key", specText: "Line one", mfrNumbers: [], includeWith: [], sourceArticleId: "ar-t" })!;
  const a = await S.saveSpecRecord(rec, "Tester", "first");
  ok(a.outcome === "created" && a.record.revision === 1, "spec-records store: first save creates revision 1");
  const b = await S.saveSpecRecord({ ...rec, updatedAt: 5 }, "Tester", "noop");
  ok(b.outcome === "unchanged" && (await S.specRecordRevisions("PS-TEST-001")).length === 0, "spec-records store: identical content is a no-op");
  const c = await S.saveSpecRecord({ ...rec, specText: "Line two" }, "Tester", "edit");
  const revs = await S.specRecordRevisions("PS-TEST-001");
  ok(c.outcome === "updated" && c.record.revision === 2 && revs.length === 1 && revs[0].record.specText === "Line one" && revs[0].why === "edit",
    "spec-records store: an edit bumps revision and keeps the prior version with why");
  const r = await S.restoreSpecRecordRevision("PS-TEST-001", 1, "Tester");
  ok(r.ok && r.record.revision === 3 && r.record.specText === "Line one" && (await S.specRecordRevisions("PS-TEST-001")).length === 2,
    "spec-records store: restore is a new revision, history never shrinks");
  ok((await S.nextSpecId("11 61 23")).startsWith("PS-116123-"), "spec-records store: nextSpecId uses the section digits");
  const dt = readFileSync(join(process.cwd(), "src/db/doc-tables.ts"), "utf8");
  ok(dt.includes('docTable("spec_records")') && dt.includes('docTable("spec_record_revisions")'), "spec-records: both doc tables registered");
  const sql = readFileSync(join(process.cwd(), "drizzle/0033_spec_records.sql"), "utf8");
  ok(/CREATE TABLE IF NOT EXISTS "spec_records"/.test(sql) && /spec_record_revisions_seq_bump/.test(sql), "spec-records: migration 0033 is idempotent with seq-bump triggers");
}
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** tables, migration, store.
- [ ] **Step 4: Run** `npm run test:specs` — PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(specs): spec_records + spec_record_revisions collections and store (migration 0033)`

---

### Task 3: Import planner, xlsx IO, CLI

**Files:**
- Create: `src/lib/specs/record-import.ts` (pure), `src/lib/specs/record-io.ts` (server-only, exceljs),
  `scripts/import-spec-library.ts`, npm script `"specs:import-library": "tsx scripts/import-spec-library.ts"`
- Test: append block.

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  ```ts
  // record-import.ts
  export const LIBRARY_SHEET = "Spec Library";
  export const LIBRARY_HEADERS = ["Spec ID","Spec Kind","Spec Type (match key)","Section","Article","Spec Title","Basis of Design",
    "Manufacturer","MFR #","Status","Your action","Spec Text","Notes","Article ID (source)","Include with (companion)"] as const;
  export type ParsedRecords = { records: SpecRecord[]; problems: RecordProblem[] };
  export function recordsFromJson(json: unknown): ParsedRecords;           // { records: [...] } or an array
  export function recordsFromSheetRows(rows: string[][]): ParsedRecords;    // row 0 = headers, exact header names, any column order
  export function recordToSheetRow(r: SpecRecord): string[];               // LIBRARY_HEADERS order; Your action ""; lists joined "\n"; kind via KIND_LABELS; status "Ready"/"Draft"/"Archived"
  export type ImportPlanItem = { specId: string; action: "create" | "update" | "unchanged"; record: SpecRecord };
  export type ImportPlan = { items: ImportPlanItem[]; counts: { created: number; updated: number; unchanged: number; archived: number };
    problems: RecordProblem[]; blocking: boolean; missingSections: string[] };
  export const V1_SECTION_TITLES: Record<string, string>; // the four §1.3 titles keyed by number
  export function planSpecRecordImport(parsed: ParsedRecords, ctx: { existing: SpecRecord[]; sections: Array<{id:string;number:string}>;
    articles: Array<{id:string;sectionId:string}> }): ImportPlan;
  // record-io.ts (server-only)
  export async function readLibraryWorkbook(buf: ArrayBuffer | Buffer): Promise<{ ok: true; rows: string[][] } | { ok: false; error: string }>;
  export async function writeLibraryWorkbook(records: SpecRecord[]): Promise<Buffer>;
  export async function commitSpecRecordImport(plan: ImportPlan, by: string, why: string): Promise<{ created: number; updated: number; unchanged: number; sectionsCreated: string[] }>;
  ```
Planner rules (spec §2): duplicate Spec ID in the file → blocking; `archived` count = records in the file with
status archived; `missingSections` = section numbers used by the file with no live section — **not** blocking
when the number is in `V1_SECTION_TITLES` (commit creates them via the sections store; read
`src/lib/stores/spec-sections.ts` for its create function), blocking otherwise; validation uses
`validateSpecRecord` with `specIds` = file ids ∪ existing ids and sections including the to-be-created ones
(treat a to-be-created section's articles as none → a ready record pointing at it is blocking); **duplicate part
number**: normalized (uppercase, trim, collapse spaces) number appearing in two different `ready` records of the
merged set (existing overlaid by file) → blocking problem naming both specIds. `action` via `sameSpecContent`
against existing. Records not in the file are untouched. `readLibraryWorkbook` finds the sheet named
`Spec Library` (else the first sheet whose row 1 contains `Spec ID`), uses `cellText` from
`@/lib/import/xlsx-to-csv` (see `product-spec-io.ts` for the exact loading dance), and returns rows.
`writeLibraryWorkbook`: one sheet `Spec Library`, header row bold + frozen, Spec Text column wrap.
CLI: `--file <path>` (`.json` or `.xlsx`), `--commit` (default dry run); prints counts, problems, missing
sections; exits 1 on blocking problems; refuses to run when `DATABASE_URL` is set unless
`requireHostedConfirmation` from `scripts/db-target.ts` passes (read how `scripts/seed-specs-once.ts` or
`scripts/import-catalog.ts` guard hosted DBs and copy that).

- [ ] **Step 1: Failing tests:**

```ts
/* ---- Spec record import (§2) ---- */
{
  const I = await import("@/lib/specs/record-import");
  const IO = await import("@/lib/specs/record-io");
  const v1 = JSON.parse(readFileSync(join(process.cwd(), "docs/specs-seed/spec-library-v1/spec-library-v1.json"), "utf8"));
  const parsed = I.recordsFromJson(v1);
  ok(parsed.records.length === 46 && parsed.problems.length === 0, "record import: v1 JSON parses to 46 records, no problems");
  // A context that has the v1 sections + every referenced article
  const secs = ["11 61 13", "11 61 14", "11 61 23", "26 09 61"].map((n) => ({ id: "ss-" + n.replace(/ /g, ""), number: n }));
  const arts = [...new Set(parsed.records.map((r) => r.sourceArticleId!))].map((id) => {
    const r = parsed.records.find((x) => x.sourceArticleId === id)!;
    return { id, sectionId: "ss-" + r.section.replace(/ /g, "") };
  });
  const p1 = I.planSpecRecordImport(parsed, { existing: [], sections: secs, articles: arts });
  ok(!p1.blocking && p1.counts.created === 46 && p1.counts.archived === 1, "record import: first plan creates 46 (1 archived), nothing blocking");
  const p2 = I.planSpecRecordImport(parsed, { existing: parsed.records, sections: secs, articles: arts });
  ok(p2.counts.unchanged === 46 && p2.counts.created === 0 && p2.counts.updated === 0, "record import: planning against itself = 46 unchanged");
  const dup = { records: [...parsed.records, { ...parsed.records.find((r) => r.specId === "PS-260961-028")!, specId: "PS-260961-999" }], problems: [] };
  ok(I.planSpecRecordImport(dup, { existing: [], sections: secs, articles: arts }).problems.some((p) => p.blocking && /LS-P/.test(p.message)), "record import: a part number in two ready records blocks");
  const noSec = I.planSpecRecordImport(parsed, { existing: [], sections: secs.slice(0, 3), articles: arts });
  ok(noSec.missingSections.includes("26 09 61"), "record import: a missing v1 section is listed for creation");
  // Sheet round-trip
  const rows = [[...I.LIBRARY_HEADERS], ...parsed.records.map(I.recordToSheetRow)];
  const back = I.recordsFromSheetRows(rows);
  ok(back.records.length === 46 && back.records.every((r, i) => I.planSpecRecordImport({ records: [r], problems: [] }, { existing: [parsed.records[i]], sections: secs, articles: arts }).counts.unchanged === 1),
    "record import: sheet rows round-trip every record unchanged");
  const buf = await IO.writeLibraryWorkbook(parsed.records);
  const rd = await IO.readLibraryWorkbook(buf);
  ok(rd.ok && I.recordsFromSheetRows(rd.rows).records.length === 46, "record io: workbook write → read keeps 46 records");
  const jeff = await IO.readLibraryWorkbook(readFileSync(join(process.cwd(), "docs/specs-seed/spec-library-v1/Peak Spec Library v1.xlsx")));
  const jr = jeff.ok ? I.recordsFromSheetRows(jeff.rows) : null;
  ok(!!jr && jr.records.length === 46 && jr.problems.filter((p) => p.blocking).length === 0, "record io: Jeff's v1 workbook reads 46 records");
  ok(!!jr && jr.records.every((r) => { const j = parsed.records.find((x) => x.specId === r.specId)!; return j && r.kind === j.kind && r.status === j.status && r.mfrNumbers.join("|") === j.mfrNumbers.join("|"); }),
    "record io: workbook and JSON agree on kind, status and part numbers");
  // Import twice through the real store
  const S = await import("@/lib/stores/spec-records");
  const plan = I.planSpecRecordImport(parsed, { existing: await S.allSpecRecords(), sections: secs, articles: arts });
  await IO.commitSpecRecordImport({ ...plan, missingSections: [] }, "Tester", "Import test");
  const again = I.planSpecRecordImport(parsed, { existing: await S.allSpecRecords(), sections: secs, articles: arts });
  ok(again.counts.unchanged === 46, "record import: committing then re-planning = 46 unchanged (import twice → 0 changes)");
}
```
(Where the workbook and JSON legitimately differ in text whitespace, the kind/status/part-number assertion is the
contract; if Jeff's workbook differs in part numbers from the JSON, report it to the controller rather than
weakening the test.)

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; run the CLI dry-run against a temp
  datadir: `TEST_DB=$(mktemp -d) PGLITE_PATH=$TEST_DB npx tsx scripts/import-spec-library.ts --file docs/specs-seed/spec-library-v1/spec-library-v1.json`
  (a fresh DB has no articles → expect blocking article problems listed, exit 1 — that is correct output).
- [ ] **Step 5: Commit** `feat(specs): spec library import planner, xlsx read/write, import CLI`

---

### Task 4: Matching (pure) + keys

**Files:**
- Create: `src/lib/specs/record-keys.ts`, `src/lib/specs/record-match.ts`
- Modify: `src/lib/bid-spec.ts` — export the existing `similarity` (no behavior change)
- Test: append block (the brief §10 table).

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  ```ts
  // record-keys.ts
  export const PLACEHOLDER_SKUS: ReadonlySet<string>; // "", "CUSTOM", "AI", "CURTAIN"; plus any sku starting "CRT-"
  export function isPlaceholderSku(sku: string): boolean;
  export function normPartNumber(s: string): string;  // uppercase, trim, collapse whitespace
  export function normMatchKey(s: string): string;    // lowercase, [–—-] → "-", collapse whitespace, trim
  export function wildcardMatches(stored: string, candidate: string): boolean; // both normalized; "#" ≡ [1-5], else literal
  export function partNumberCandidates(row: { sku?: string; mfrNumber?: string }, part?: { manufacturerPartNumber?: string; manufacturerModelNumber?: string } | null): string[]; // normalized, de-duped: mfrNumber, sku (if not placeholder), sku after first ":", part MPN, part model
  export function specRowKey(row: { sku?: string; mfrNumber?: string; specKey?: string; desc?: string; specId?: string; fromLibrary?: boolean }): string;
    // fromLibrary && specId → "SPEC:<id>"; real sku → "SKU:<UPPER>"; mfrNumber → "MPN:<norm>"; specKey → "KEY:<normKey>|<desc lower>"; else "DESC:<desc lower>"
  export function curtainSpecKey(type: string | undefined, name: string | undefined): string | null; // spec §6, "Stage Drapes – X"
  // record-match.ts
  export type MatchRow = { sku?: string; mfrNumber?: string; specKey?: string; desc?: string; specId?: string; waived?: { reason: string } };
  export type RowMatch =
    | { status: "matched"; specId: string; via: "pinned" | "exact" | "wildcard" | "key" }
    | { status: "legacy" } | { status: "ambiguous"; specIds: string[] } | { status: "draft"; specId: string }
    | { status: "waived"; reason: string } | { status: "no-match"; candidates: string[] };
  export function matchRow(row: MatchRow, records: SpecRecord[], part?: { manufacturerPartNumber?: string; manufacturerModelNumber?: string; desc?: string } | null, hasLegacyText?: boolean): RowMatch;
  export function companionsFor(matchedSpecIds: Iterable<string>, records: SpecRecord[]): string[]; // ready companions whose includeWith hits, unique, sorted by specId, excluding already-matched
  ```
Algorithm (spec §3.2): waived → `waived`. Pinned `specId` naming a `ready` record → matched/pinned (pinned draft →
`draft`; pinned archived/missing → fall through). For each step 1 (exact) then 2 (wildcard) then 3 (key), collect
**distinct** records among `ready`; 1 → matched; ≥2 → ambiguous; 0 → next step. If no ready hit at steps 1–3 but a
`draft` record hits at step 1/2/3 → `draft`. `hasLegacyText` → `legacy`. Else `no-match` with candidates: score =
max `similarity` of (row desc + " " + candidates.join(" ")) vs (record title + basisOfDesign + manufacturer +
mfrNumbers), over `ready` records, floor 0.2, top 4 by score then specId. Step 3 only considers `system` records.

- [ ] **Step 1: Failing tests:**

```ts
/* ---- Spec record matching — brief §10 (§3) ---- */
{
  const K = await import("@/lib/specs/record-keys");
  const M = await import("@/lib/specs/record-match");
  const I = await import("@/lib/specs/record-import");
  const recs = I.recordsFromJson(JSON.parse(readFileSync(join(process.cwd(), "docs/specs-seed/spec-library-v1/spec-library-v1.json"), "utf8"))).records;
  const m = (row: Parameters<typeof M.matchRow>[0], part?: Parameters<typeof M.matchRow>[2], legacy?: boolean) => M.matchRow(row, recs, part, legacy);
  const is = (r: ReturnType<typeof M.matchRow>, id: string) => r.status === "matched" && r.specId === id;
  ok(is(m({ sku: "LS-P-CAM" }), "PS-260961-028"), "match: LS-P-CAM → Lonestar Prime 028");
  ok(is(m({ sku: "LS-UB-MI" }), "PS-260961-022"), "match: LS-UB-MI → Lonestar 022");
  ok(is(m({ sku: "CSPARVZMV-1" }), "PS-260961-021"), "match: CSPARVZMV-1 → 021 only (017 archived)");
  const w = m({ sku: "UH10005-41F" });
  ok(is(w, "PS-260961-007") && w.status === "matched" && w.via === "wildcard", "match: UH10005-41F → 007 via wildcard");
  ok(m({ sku: "UH10005-61F" }).status === "no-match", "match: UH10005-61F → no-match (6 is not a Heritage color)");
  ok(is(m({ sku: "DIN14-P-ACP/SPS" }), "PS-260961-006"), "match: DIN14-P-ACP/SPS → 006");
  ok(is(m({ sku: "P-ACP-E Mk2" }), "PS-260961-005") && is(m({ sku: "p-acp-e  mk2" }), "PS-260961-005"), "match: P-ACP-E Mk2 normalization → 005");
  ok(is(m({ sku: "", mfrNumber: "IQ24", desc: "Sensor IQ 24" }), "PS-260961-001"), "match: vendor line IQ24 (no catalog part) → 001");
  ok(is(m({ sku: "ETC:IQ24" }), "PS-260961-001"), "match: the sku after its Mfr: prefix is a candidate");
  ok(is(m({ sku: "SOMESKU" }, { manufacturerPartNumber: "IQ48" }), "PS-260961-001"), "match: the catalog part's MPN is a candidate");
  const ion = m({ sku: "ION XE 20 2K-US" });
  ok(is(ion, "PS-260961-012") && JSON.stringify(M.companionsFor(["PS-260961-012"], recs)) === '["PS-260961-011"]', "match: ION XE 20 → 012 + companion 011");
  ok(JSON.stringify(M.companionsFor(["PS-260961-012", "PS-260961-013"], recs)) === '["PS-260961-011"]', "match: ION + ELEMENT → companion 011 once");
  ok(is(m({ sku: "CUSTOM", specKey: "Stage Drapes – Main Curtain", desc: "Main curtain" }), "PS-116123-002"), "match: estimate line keyed Stage Drapes – Main Curtain → 002");
  ok(is(m({ sku: "CUSTOM", specKey: "stage drapes - main curtain" }), "PS-116123-002"), "match: match key ignores case and dash style");
  ok(K.curtainSpecKey("Full", "Main Curtain") === "Stage Drapes – Main Curtain" && is(m({ sku: "CURTAIN", specKey: K.curtainSpecKey("Full", "Main")! }), "PS-116123-002"), "match: Grid main curtain → 002 via curtainSpecKey");
  ok(K.curtainSpecKey("Border", "") === "Stage Drapes – Borders" && K.curtainSpecKey("Leg", "") === "Stage Drapes – Legs"
    && K.curtainSpecKey("Draw", "Traveler") === "Stage Drapes – Mid and Rear Draws" && K.curtainSpecKey("Full", "Cyc") === "Stage Drapes – Cyclorama"
    && K.curtainSpecKey("Border", "Main Valance") === "Stage Drapes – Valance", "record-keys: curtainSpecKey name keywords win over type");
  const x = m({ sku: "XYZ-123", desc: "Lonestar moving light" });
  ok(x.status === "no-match" && x.candidates.length > 0 && x.candidates.includes("PS-260961-022"), "match: XYZ-123 → no-match with candidates, never assigned");
  ok(m({ sku: "NOPE" }, null, true).status === "legacy", "match: legacy specBody is step 4");
  ok(m({ sku: "LS-P", waived: { reason: "Owner furnished" } }).status === "waived", "match: waived rows report waived");
  const draftRecs = recs.map((r) => (r.specId === "PS-260961-022" ? { ...r, status: "draft" as const } : r));
  ok(M.matchRow({ sku: "LS-UB-MI" }, draftRecs).status === "draft", "match: a draft-only hit is reported as draft, not printed");
  const twin = [...recs, { ...recs.find((r) => r.specId === "PS-260961-022")!, specId: "PS-X" }];
  ok(M.matchRow({ sku: "LS-UB-MI" }, twin).status === "ambiguous", "match: two ready records on one number → ambiguous");
  // Guard: the v1 library has no ready part-number collisions
  const seen = new Map<string, string>(); let clash = "";
  for (const r of recs.filter((r) => r.status === "ready")) for (const n of r.mfrNumbers) { const k = K.normPartNumber(n); if (seen.has(k) && seen.get(k) !== r.specId) clash = `${k} ${seen.get(k)} ${r.specId}`; seen.set(k, r.specId); }
  ok(clash === "", "match guard: no two ready v1 records share a part number " + clash);
  ok(K.specRowKey({ sku: "CURTAIN", specKey: "Stage Drapes – Legs", desc: "Legs" }) === "KEY:stage drapes - legs|legs"
    && K.specRowKey({ sku: "", mfrNumber: " iq24 " }) === "MPN:IQ24" && K.specRowKey({ sku: "ls-p" }) === "SKU:LS-P"
    && K.specRowKey({ specId: "PS-1", fromLibrary: true }) === "SPEC:PS-1", "record-keys: specRowKey");
}
```

- [ ] **Step 2–4:** run (FAIL) → implement → run (PASS).
- [ ] **Step 5: Commit** `feat(specs): record matching — exact, wildcard, match key, legacy, companions`

---

### Task 5: BOM seam — rows carry part number, key, description

**Files:**
- Modify: `src/lib/bid-spec.ts` (`BomRow` += `mfrNumber?`, `manufacturer?`, `specKey?`)
- Modify: `src/lib/specs/quote-bom.ts`
- Modify: `src/lib/design/grid-virtual-parts.ts` (`gridSpecBomRows` passes `specKey` through; input line type +=
  `specKey?`)
- Modify: `src/lib/design/grid-bom.ts` (`GridCurtain.specKey?: string`; `BomLine.specKey?`, set in `curtainLines`
  to `pl.curtain.specKey || curtainSpecKey(pl.curtain.type, pl.curtain.name) || undefined`)
- Modify: `src/lib/design/grid-quote.ts` (`spec.lines` entries add `...(l.specKey ? { specKey: l.specKey } : {})`)
- Modify: `src/app/(app)/estimator/types.ts` (`SpecItem.specKey?: string` with a one-line comment)
- Modify: `src/lib/specs/spec-document.ts`: `SpecDocProduct` += `mfrNumber?`, `manufacturer?`, `specKey?`,
  `desc?`, `specId?`, `fromLibrary?: true`, `waived?: { reason: string }`; `product()` normalizer keeps them (caps:
  strings ≤ 200, reason ≤ 500) and **accepts a row with no sku** when it has mfrNumber/specKey/desc/specId;
  `normalizeSpecDocument` de-dups by `specRowKey` (not sku); `bomProducts(rows)` merges by `specRowKey`, qty summed,
  keeps first row's fields, drops rows with none of sku/mfrNumber/specKey/desc; existing `withProduct`/
  `withoutProduct`/`withProductHeader`/`withProductOrder` switch from sku to row key (read them; keep their
  signatures but the `sku` argument becomes `rowKey: string` — update all callers in `builder-actions.ts` and
  `builder.tsx`; a real SKU's row key is `SKU:<UPPER>`, so pass `specRowKey(p)`).
- Test: append block.

**Interfaces:**
- Consumes: Task 4 `specRowKey`, `curtainSpecKey`, `isPlaceholderSku`.
- Produces: the widened `BomRow` / `SpecDocProduct`; `bomFromQuote` rows now include
  `{ sku, desc, qty, mfrNumber?, manufacturer?, specKey? }`.

`bomFromQuote` changes (spec §3.1): widen the local `QuoteSpecDoc` item type with `manufacturer`,
`manufacturerPartNumber`, `specKey`, `curtain`, `vendorQuoteId`, `allowance`, `custom`; add top-level
`vendorQuotes?: Array<{ id: string; lines?: Array<{ description?: string; manufacturerPartNumber?: string; qty?: number }> }>`.
For each non-option, non-labor item: if `vendorQuoteId` and the vendor quote exists with lines → push each line as
`{ sku: "", desc: line.description, qty: line.qty, mfrNumber: line.manufacturerPartNumber }` instead of the item;
else push the item with `mfrNumber: manufacturerPartNumber`, `manufacturer`, `specKey: it.specKey ||
(it.curtain ? curtainSpecKey(undefined, it.desc) : undefined)`. Allowance/custom items with empty SKU are kept
(they carry desc). Grid lines: `specKey` passes through `gridSpecBomRows`. The `push` helper keeps a row when any
of sku/desc/mfrNumber is present.

- [ ] **Step 1: Failing tests:**

```ts
/* ---- Spec records BOM seam (§3.1) ---- */
{
  const SD = await import("@/lib/specs/spec-document");
  const { upsertDoc } = await import("@/db/doc-store");
  const { bomFromQuote } = await import("@/lib/specs/quote-bom");
  await upsertDoc("quotes", { id: "Q-SPECREC-1", name: "Spec rec test", vendorQuotes: [{ id: "vq1", lines: [{ id: 1, description: "Sensor IQ 24", manufacturerPartNumber: "IQ24", qty: 2, unit: "ea", amount: 0 }] }],
    spec: { sections: [{ items: [
      { sku: "LS-P", desc: "Lonestar Prime", qty: 4 },
      { sku: "", desc: "Acoustic shell towers", qty: 1, custom: true, allowance: true, specKey: "Acoustic Shell – Towers" },
      { sku: "CRT-9", desc: "Main Curtain — IFR velour, 40×20", qty: 1, curtain: true },
      { sku: "VQ", desc: "Vendor: Sensor IQ", qty: 1, vendorQuoteId: "vq1" },
      { sku: "LAB", desc: "Labor", qty: 1, labor: true },
    ] }] } } as never);
  const r = await bomFromQuote("Q-SPECREC-1");
  ok(r.ok && r.rows.some((x) => x.mfrNumber === "IQ24" && x.qty === 2) && !r.rows.some((x) => x.desc === "Vendor: Sensor IQ"), "bom seam: a vendor-quote roll-up expands into its lines' part numbers");
  ok(r.ok && r.rows.some((x) => x.specKey === "Acoustic Shell – Towers" && x.sku === ""), "bom seam: an allowance with no SKU is kept with its specKey");
  ok(r.ok && r.rows.some((x) => x.sku === "CRT-9" && x.specKey === "Stage Drapes – Main Curtain"), "bom seam: an estimator curtain derives its specKey from the description");
  ok(r.ok && !r.rows.some((x) => x.desc === "Labor"), "bom seam: labor still skipped");
  const prods = SD.bomProducts([{ sku: "LS-P", desc: "a", qty: 1 }, { sku: "ls-p", desc: "b", qty: 2 }, { sku: "", desc: "Shell", qty: 1, specKey: "Acoustic Shell – Towers" }, { sku: "", desc: "", qty: 1 }]);
  ok(prods.length === 2 && prods[0].qty === 3 && prods[1].specKey === "Acoustic Shell – Towers", "bom seam: bomProducts merges by row key and keeps non-catalog rows");
  const nd = SD.normalizeSpecDocument({ products: [{ sku: "", mfrNumber: "IQ24", desc: "IQ" }, { specId: "PS-1", fromLibrary: true }, { sku: "", mfrNumber: "iq24" }] });
  ok(nd.products.length === 2, "bom seam: normalize keeps sku-less rows and de-dups by row key");
  const { gridSpecBomRows } = await import("@/lib/design/grid-virtual-parts");
  ok(gridSpecBomRows([{ sku: "CURTAIN", desc: "Main", qty: 1, specKey: "Stage Drapes – Main Curtain" }], () => null)[0].specKey === "Stage Drapes – Main Curtain", "bom seam: Grid curtain lines carry specKey");
}
```

- [ ] **Step 2–4:** FAIL → implement → PASS; `npx tsc --noEmit` (the row-key switch touches builder files).
- [ ] **Step 5: Commit** `feat(specs): BOM rows carry part number, spec key and description; vendor quotes expand`

---

### Task 6: Rendering primitives — sixth level + bracket job values

**Files:**
- Modify: `src/lib/specs/outline.ts` (`OUTLINE_LABELS = ["A.", "1.", "a.", "1)", "a)", "(1)"]`; `outlineLabel` must
  produce `(n)` for depth 5 — read its implementation and extend its format switch)
- Modify: `src/lib/specs/spec-docx.ts` (`LEVELS` add `{ level: 7, format: LevelFormat.DECIMAL, text: "(%8)",
  alignment: LEFT, suffix: TAB, style: { paragraph: indent(5040) } }`; `numbered()` clamp 6 → 7)
- Create: `src/lib/specs/record-fill-ins.ts`
- Test: append block; also update any existing harness assertion that pins `MAX_OUTLINE_DEPTH === 5` or the clamp
  warning text (grep `MAX_OUTLINE_DEPTH` and `deeper than` in the harness) to the new value — say so in the report.

**Interfaces:**
- Produces:
  ```ts
  export type JobValueSlot = { key: string; specId: string; index: number; defaultText: string; context: string };
  export function jobValueSlots(specId: string, text: string): JobValueSlot[]; // `[…]` not starting "FILL IN:", key `${specId}#${n}`
  export function applyJobValues(text: string, specId: string, answers: Record<string, string>, labels?: Record<string, string>): string;
  export function staleJobValueKeys(slotsBySpec: Map<string, JobValueSlot[]>, answers: Record<string, string>, labels?: Record<string, string>): string[]; // only keys matching /^PS-|^[^#]+#\d+$/ whose specId is in the map
  export function jobValueSegments(text: string): Array<{ text: string; bracket: boolean }>; // for preview highlighting
  ```
Rules: regex `/\[(?!FILL IN:)([^\[\]\n]*)\]/g` — label key via `fillInLabelKey` (from `fill-ins.ts`) of the default
text; answered + label not mismatched → value (whitespace collapsed) replaces the whole bracket; else bracket kept.
`context` = up to 6 words before it on the line (reuse the approach in `fill-ins.ts` `contextBefore`; export that
helper from `fill-ins.ts` rather than duplicating). Stale = answer non-empty and (key gone or label mismatch).

- [ ] **Step 1: Failing tests:**

```ts
/* ---- Spec records rendering primitives (§4) ---- */
{
  const O = await import("@/lib/specs/outline");
  const J = await import("@/lib/specs/record-fill-ins");
  const deep = "L0\n  L1\n    L2\n      L3\n        L4";
  const r = O.parseOutline(deep, "entry");
  ok(r.lines.map((l) => l.label).join(" ") === "1. a. 1) a) (1)" && r.warnings.length === 0, "outline: entry context reaches a sixth level (1) without clamping");
  const docx = readFileSync(join(process.cwd(), "src/lib/specs/spec-docx.ts"), "utf8");
  ok(docx.includes('text: "(%8)"') && docx.includes("level: 7"), "spec-docx: Word list has level 7 (%8)");
  const t = "Supply [1] transporter.\nWidth: [12] feet. Must [FILL IN: days] days. Color [Cream, Ivory].";
  const slots = J.jobValueSlots("PS-1", t);
  ok(slots.length === 3 && slots[0].key === "PS-1#1" && slots[1].defaultText === "12" && slots[2].defaultText === "Cream, Ivory", "job values: [brackets] are slots, [FILL IN:] is not");
  ok(J.applyJobValues(t, "PS-1", { "PS-1#2": " 14 " }, { "PS-1#2": "12" }).includes("Width: 14 feet.") && J.applyJobValues(t, "PS-1", {}).includes("[1]"), "job values: answered replaces, unanswered prints as written");
  ok(J.applyJobValues(t, "PS-1", { "PS-1#2": "14" }, { "PS-1#2": "99" }).includes("[12]"), "job values: label mismatch never lands in the wrong bracket");
  ok(J.staleJobValueKeys(new Map([["PS-1", slots]]), { "PS-1#9": "x", "PS-1#2": "14" }, { "PS-1#2": "12" }).join() === "PS-1#9", "job values: stale = key gone or label mismatch");
  ok(J.jobValueSegments("a [1] b").filter((s) => s.bracket).length === 1, "job values: segments for highlighting");
}
```

- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(specs): sixth outline level and [bracket] job values`

---

### Task 7: Assembly — records in the builder's section

**Files:**
- Modify: `src/lib/specs/spec-document.ts` — `SpecDocument` += `overrides: Record<string, { title: string; specText:
  string; baseRevision: number }>`, `usedRecords: Record<string, number>`, `downloadedAt?: number`; normalize caps
  (title ≤ 300, specText ≤ 20000, ≤ 200 overrides); pure edits:
  `withOverride(d, specId, o)`, `withoutOverride(d, specId)`, `withWaive(d, rowKey, reason)`, `withoutWaive(d, rowKey)`,
  `withRowSpecKey(d, rowKey, specKey)`, `withRowPin(d, rowKey, specId)`, `withLibraryRow(d, specId)`,
  `withDownloadStamp(d, used, at)`.
- Modify: `src/lib/specs/assemble-section.ts`
- Modify: `src/lib/specs/load-spec.ts` (load `allSpecRecords()`; parts lookup uses skus of rows that have a real
  sku; pass `records`)
- Modify: `src/app/(app)/design/specs/[id]/...docx route` — find the route that calls `buildSectionDocx` (grep
  `buildSectionDocx(` under `src/app`) and after building, stamp `withDownloadStamp(doc, assembled.usedRecords,
  Date.now())` via `patchSpecDocument` (best-effort; a stamp failure must not fail the download).
- Test: append block incl. snapshots.

**Interfaces:**
- Consumes: Tasks 4–6.
- Produces (additions to `assemble-section.ts`):
  ```ts
  export type LeftOutReason = "not-in-catalog" | "needs-header" | "other-section" | "no-spec" | "no-match" | "ambiguous" | "draft";
  // AssembledProduct += specId?: string; revision?: number; overridden?: boolean; overrideStale?: boolean; rowKeys: string[]
  // SpecChecklist.leftOut entries += rowKey: string; match?: RowMatch; sectionNumber?: string (for other-section records)
  // SpecChecklist += jobValues: Array<JobValueSlot & { answered: boolean; title: string }>; staleJobValues: string[]; waived: Array<{ rowKey: string; desc: string; reason: string }>
  // AssembledSection += usedRecords: Record<string, number>; rowMatches: Record<string, RowMatch>
  // assembleSection input += records: SpecRecord[]
  ```
Behavior (spec §3.3, §4):
1. For each product row: compute `part` (if real sku), `hasLegacy` = today's `textPart` result non-null, then
   `matchRow(row, records, part, hasLegacy)`; record into `rowMatches[specRowKey(row)]`.
2. `matched` → record R. If R's section (`sectionIdForRecord`) ≠ this section → leftOut `other-section` with
   `sectionNumber: R.section`. Else placement article = `R.sourceArticleId` (must be in this section, else leftOut
   `needs-header`). Group by specId: one entry per record, qty = sum of its rows' qty, `rowKeys` = all rows.
3. `legacy` → today's path exactly (placeProduct + textPart), unchanged output.
4. `waived` → `checklist.waived`; `no-match`/`ambiguous`/`draft` → leftOut with that reason and `match`.
   A row with no real sku and no match → `no-match` (never `not-in-catalog`).
5. Companions: `companionsFor(matched ids in this section)`; each companion placed under its own article (same
   section rule) after the entries of that article.
6. Entry text: `overrides[specId]` (title/specText) if present, else record's; `overrideStale` when
   `record.revision > override.baseRevision`. Text → `applyJobValues` → `render(…, "entry", …)`. Heading = title
   (+ `(Quantity: N)` when showQty && qty > 0). Table-style sections: record rows use `mfr: R.manufacturer ||
   prefix`, `model`: the row's matched part number (first candidate that hits) else first `mfrNumbers`,
   `description: title`.
7. Entries within an article: legacy parts and records together in BOM row order (first row index), companions
   last. Used articles: any article that got an entry (legacy or record).
8. ITEMS NOT SPECIFIED: if `checklist.waived.length` → append a Part 2 article `{ num: 2.(n+1), title: "ITEMS NOT
   SPECIFIED", general: [], products: [] }` whose `general` lines are depth-0 lines `"<desc> — <reason>"` labeled
   via `outlineLabel(0, i+1)`; in table style append the same article (no table rows).
9. `usedRecords` = `{ specId: record.revision }` for every printed record entry (incl. companions).
10. `checklist.jobValues` from every printed record entry's final text; `staleJobValues` via `staleJobValueKeys`;
    job values never change `fillInsLeft`.

- [ ] **Step 1: Failing tests** (pure — build a section/articles/records fixture from the v1 JSON):

```ts
/* ---- Spec records assembly (§3.3, §4) ---- */
{
  const I = await import("@/lib/specs/record-import");
  const A = await import("@/lib/specs/assemble-section");
  const SD = await import("@/lib/specs/spec-document");
  const { buildSectionDocx } = await import("@/lib/specs/spec-docx");
  const recs = I.recordsFromJson(JSON.parse(readFileSync(join(process.cwd(), "docs/specs-seed/spec-library-v1/spec-library-v1.json"), "utf8"))).records;
  const sec = (num: string) => ({ id: "ss-" + num.replace(/ /g, ""), number: num, title: "T " + num, part1: [], part3: [], part2Style: "paragraphs", quantities: "drawings", sort: 0, updatedAt: 0, updatedBy: "" }) as never;
  const s260961 = sec("26 09 61"), s116123 = sec("11 61 23");
  const arts = [...new Set(recs.map((r) => r.sourceArticleId!))].map((id, i) => {
    const r = recs.find((x) => x.sourceArticleId === id)!;
    return { id, sectionId: "ss-" + r.section.replace(/ /g, ""), sort: i, title: r.article, manufacturers: [], general: "", categoryKeys: [], updatedAt: 0, updatedBy: "" };
  });
  const doc = (products: object[], extra: object = {}) => SD.normalizeSpecDocument({ id: "SP-T", sectionId: "ss-260961", header: { projectName: "P", projectNumber: "1", phase: "CD", issueDate: "2026-09-28", preparedBy: "x" }, source: { kind: "quote", id: "Q" }, products, printQuantities: true, fillIns: {}, ...extra });
  const run = (d: ReturnType<typeof doc>, section = s260961) => A.assembleSection({ section, articles: arts as never, sections: [s260961, s116123] as never, parts: new Map(), doc: d, records: recs });
  const a1 = run(doc([{ sku: "ION XE 20 2K-US", qty: 1 }, { sku: "ELEMENT 2 1K", qty: 1 }]));
  const entries = a1.part2.articles.flatMap((x) => x.products.map((p) => p.specId));
  ok(JSON.stringify(entries) === '["PS-260961-012","PS-260961-013","PS-260961-011"]', "assembly: consoles then companion 011 once, under their article");
  const a2 = run(doc([{ sku: "LS-P", qty: 2 }, { sku: "LS-P-CAM", qty: 3 }]));
  const lp = a2.part2.articles.flatMap((x) => x.products);
  ok(lp.length === 1 && lp[0].heading.includes("(Quantity: 5)") && lp[0].rowKeys.length === 2, "assembly: two rows on one record print once, quantities summed");
  const a3 = run(doc([{ sku: "", specKey: "Stage Drapes – Main Curtain", desc: "Main" }]));
  ok(a3.checklist.leftOut.some((l) => l.reason === "other-section" && l.sectionNumber === "11 61 23"), "assembly: a record from another section is listed with its section number");
  const a4 = run(doc([{ sku: "XYZ-123", desc: "mystery" }, { sku: "LS-P", waived: { reason: "Owner furnished" } }]));
  ok(a4.checklist.leftOut.some((l) => l.reason === "no-match") && a4.part2.articles.at(-1)!.title === "ITEMS NOT SPECIFIED", "assembly: no-match listed; waived row prints under ITEMS NOT SPECIFIED");
  const btn = run(doc([{ sku: "UH10005-41F" }], { fillIns: { "PS-260961-007#1": "Black (RAL 9004)" }, fillInLabels: {} }));
  ok(btn.checklist.jobValues.length > 0 && btn.usedRecords["PS-260961-007"] === 1, "assembly: job values listed; usedRecords stamps the revision");
  const ov = run(doc([{ sku: "LS-P" }], { overrides: { "PS-260961-028": { title: "CUSTOM TITLE", specText: "Only this", baseRevision: 0 } } }));
  const ovp = ov.part2.articles.flatMap((x) => x.products)[0];
  ok(ovp.heading.startsWith("CUSTOM TITLE") && ovp.overridden && ovp.overrideStale, "assembly: a project-only override prints and flags a newer library revision");
  // Snapshots: deterministic + golden
  const snap = (id: string, row: object, section = s260961) => {
    const x = run(doc([row]), section);
    const lines = x.part2.articles.flatMap((a) => a.products.flatMap((p) => [p.label + " " + p.heading, ...p.lines.map((l) => "  ".repeat(l.depth) + l.label + " " + l.text)]));
    return lines.join("\n");
  };
  for (const [id, row, s] of [["PS-260961-028", { sku: "LS-P" }, s260961], ["PS-260961-007", { sku: "UH10001-11F" }, s260961], ["PS-116123-008", { sku: "", specKey: "Rigging Hoist – Prodigy P1" }, s116123]] as const) {
    const golden = join(process.cwd(), `docs/specs-seed/spec-library-v1/snapshots/${id}.txt`);
    const now = snap(id, row, s);
    if (!existsSync(golden)) { mkdirSync(dirname(golden), { recursive: true }); writeFileSync(golden, now); }
    ok(now === readFileSync(golden, "utf8") && now === snap(id, row, s), `assembly snapshot: ${id} matches its golden and is stable`);
  }
  const d1 = await buildSectionDocx(run(doc([{ sku: "LS-P" }]))!);
  const d2 = await buildSectionDocx(run(doc([{ sku: "LS-P" }]))!);
  const JSZip = (await import("jszip")).default;
  const x1 = await (await JSZip.loadAsync(d1)).file("word/document.xml")!.async("string");
  const x2 = await (await JSZip.loadAsync(d2)).file("word/document.xml")!.async("string");
  ok(x1 === x2 && x1.includes("Lonestar"), "assembly: Word document.xml is identical across runs");
}
```
(Adapt the `sec()` fixture to the real `SpecSection` required fields — read `src/lib/specs/sections.ts`; check
`buildSectionDocx`'s real signature and return type and whether `jszip` is installed (`ls node_modules/jszip`); if
not, compare the zipped buffers after zeroing the core.xml timestamps, or use whatever the existing #205 docx tests
in the harness use — grep `buildSectionDocx` in the harness. Add `existsSync, mkdirSync, writeFileSync, dirname`
imports only if the harness lacks them. Commit the generated golden files; eyeball them in the report — the
Lonestar Prime golden must show 1./a./1) nesting and the hoist golden must reach `(1)`.)

- [ ] **Step 2–4:** FAIL → implement → PASS. Existing #205 assembly tests must stay green (legacy path unchanged).
- [ ] **Step 5: Commit** `feat(specs): records assemble into the builder's section — companions, overrides, waived, job values`

---

### Task 8: Record server actions

**Files:**
- Create: `src/app/(app)/design/specs/record-actions.ts` (`"use server"`)
- Modify: `src/app/(app)/design/specs/builder-actions.ts` only if a shared helper must move (prefer importing
  `applyPatch`-style logic locally)
- Test: append block (pure helpers + a source check that every exported action calls `requirePerm("create")` or
  `requireUser()`).

**Interfaces:**
- Consumes: Tasks 2, 5, 7 (store + pure doc edits).
- Produces (all return `{ ok: true, … } | { ok: false, error: string }`):
  ```ts
  searchSpecRecordsAction(q: string, opts?: { sectionNumber?: string; kinds?: SpecKind[] }): Promise<Result<{ records: SpecRecordHit[] }>>;
    // SpecRecordHit = { specId; title; kind; status; section; manufacturer; mfrNumbers; matchKey } — top 30, ready+draft, token match on id/title/mfr/numbers/key
  linkRowToRecordAction(docId: string, rowKey: string, specId: string): Promise<Result>;
    // row has a part number (mfrNumber or real sku) → add normPartNumber-preserving original spelling to record.mfrNumbers via saveSpecRecord(why `Linked from ${docId}`);
    // else record.kind==="system" → withRowSpecKey(record.matchKey); else withRowPin(specId). Refuses archived records.
  createRecordFromRowAction(docId: string, rowKey: string, input: { title; specText; kind; manufacturer?; basisOfDesign?; mfrNumbers: string[]; matchKey?; sourceArticleId }): Promise<Result<{ specId: string }>>;
    // nextSpecId(section number of the doc), status "ready", validateSpecRecord must pass (blocking problems → error listing them); system → also withRowSpecKey on the row
  waiveRowAction(docId, rowKey, reason) / unwaiveRowAction(docId, rowKey)
  approveDraftRecordAction(specId): Promise<Result>; // status → ready via saveSpecRecord (why "Approved"); validate first
  saveRowOverrideAction(docId, specId, { title, specText }): Promise<Result>; // baseRevision = current record revision
  clearRowOverrideAction(docId, specId): Promise<Result>;
  updateLibraryRecordAction(specId, { title, specText }, why: string): Promise<Result<{ revision: number }>>; // why required (1–300 chars)
  recordUsageAction(specId): Promise<Result<{ count: number }>>; // spec_documents whose usedRecords has specId
  addLibraryRowAction(docId, specId): Promise<Result>;
  saveSpecRecordAction(record: unknown, why: string): Promise<Result<{ specId: string; outcome: SaveOutcome }>>; // library editor; normalize + validate
  restoreSpecRecordRevisionAction(specId, revision): Promise<Result>;
  ```
  Every write: `requirePerm("create")`, caps (title ≤ 300, specText ≤ 20000, reason ≤ 500, why ≤ 300, ≤ 100 part
  numbers), `revalidatePath("/design/specs")`, `revalidatePath(\`/design/specs/${docId}\`)`,
  `revalidatePath("/design/specs/library")`. A row key that isn't on the doc → `"That row is no longer on this spec."`

- [ ] **Step 1: Failing tests** — DB-level via the store + pure edits (actions call `requirePerm`, which the
  harness can't satisfy; test the pure edits and store effects, then source-check the actions):

```ts
/* ---- Spec record actions (§5) ---- */
{
  const SD = await import("@/lib/specs/spec-document");
  let d = SD.normalizeSpecDocument({ id: "SP-A", products: [{ sku: "", mfrNumber: "ZZ-1", desc: "Mystery" }, { sku: "CUSTOM", desc: "Shell" }] });
  const k0 = "MPN:ZZ-1", k1 = "DESC:shell";
  d = SD.withWaive(d, k0, "Owner furnished");
  ok(d.products[0].waived?.reason === "Owner furnished" && !SD.withoutWaive(d, k0).products[0].waived, "record actions: waive/unwaive by row key");
  ok(SD.withRowSpecKey(d, k1, "Acoustic Shell – Towers").products[1].specKey === "Acoustic Shell – Towers", "record actions: withRowSpecKey");
  ok(SD.withRowPin(d, k1, "PS-9").products[1].specId === "PS-9", "record actions: withRowPin");
  ok(SD.withLibraryRow(d, "PS-7").products.some((p) => p.specId === "PS-7" && p.fromLibrary) && SD.withLibraryRow(SD.withLibraryRow(d, "PS-7"), "PS-7").products.filter((p) => p.specId === "PS-7").length === 1, "record actions: withLibraryRow adds once");
  const o = SD.withOverride(d, "PS-1", { title: "T", specText: "X", baseRevision: 2 });
  ok(o.overrides["PS-1"].baseRevision === 2 && !("PS-1" in SD.withoutOverride(o, "PS-1").overrides), "record actions: override set/clear");
  ok(SD.withDownloadStamp(d, { "PS-1": 3 }, 42).usedRecords["PS-1"] === 3, "record actions: download stamp");
  const src = readFileSync(join(process.cwd(), "src/app/(app)/design/specs/record-actions.ts"), "utf8");
  const exported = [...src.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
  ok(exported.length >= 12 && exported.every((name) => { const body = src.slice(src.indexOf(`export async function ${name}(`)).split(/\nexport async function /)[0]; return /require(Perm\("create"\)|User\(\))/.test(body); }),
    "record actions: every exported action checks the session");
  ok(!/window\.(confirm|prompt)/.test(src), "record actions: no window.confirm/prompt");
  // Library edit vs project edit (brief §10)
  const S = await import("@/lib/stores/spec-records");
  const before = (await S.getSpecRecord("PS-260961-028"))!;
  const proj = SD.withOverride(d, "PS-260961-028", { title: "X", specText: "Y", baseRevision: before.revision });
  ok((await S.getSpecRecord("PS-260961-028"))!.revision === before.revision && proj.overrides["PS-260961-028"], "brief §10: edit 'this project only' leaves the library revision unchanged");
  const up = await S.saveSpecRecord({ ...before, specText: before.specText + "\nAdded line." }, "Tester", "library edit");
  const hist = await S.specRecordRevisions("PS-260961-028");
  ok(up.record.revision === before.revision + 1 && hist[0].record.specText === before.specText && proj.overrides["PS-260961-028"].specText === "Y",
    "brief §10: 'update the library' bumps revision, keeps the old version, leaves other specs' overrides untouched");
}
```
(This block relies on Task 3's test having committed the v1 records into the test DB earlier in the same run;
keep it appended after Task 3's block.)

- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(specs): record actions — link, write new, waive, approve, project/library edits`

---

### Task 9: Builder UI — the match report

**Files:**
- Modify: `src/app/(app)/design/specs/[id]/builder.tsx` (863 lines — put new UI in new sibling files, not in here)
- Create: `src/app/(app)/design/specs/[id]/record-row.tsx` (row status + actions), `record-dialogs.tsx`
  (Link-to-existing search, Write-new-spec editor, Waive reason, Edit with project/library choice),
  `library-picker.tsx` (Add from Spec Library)
- Modify: `src/app/(app)/design/specs/[id]/preview.tsx` (bracket highlight via `jobValueSegments`, override /
  stale badges), `src/app/(app)/design/specs/[id]/page.tsx` (pass records needed by the client: the section's
  articles already come through; pass `recordsById` slim map `{specId, title, kind, status, revision, matchKey}`
  and system match keys)
- Test: append source-level checks (the harness can't render React): no `window.confirm|prompt` in the new
  files; `"use client"` files import only types from `@/lib/stores` / `record-io` / `@/db`; builder uses
  `linkRowToRecordAction`, `createRecordFromRowAction`, `waiveRowAction`, `saveRowOverrideAction`,
  `updateLibraryRecordAction`, `addLibraryRowAction`; the old catalog-part `writePartSpecFieldsAction` is no longer
  called from the builder's Write flow.

UI contract (spec §5, follow existing `pk-*` classes and the builder's current card styles; accent via CSS vars):
- Products card rows render from `assembled.rowMatches` + `checklist.leftOut`: status chip — **Matched** (spec id
  + via), **Legacy text**, **No spec** (+ candidates as quick-pick chips), **Pick one** (ambiguous), **Draft
  spec** (+ Approve), **Waived** (+ reason, Un-waive), **Other section 11 61 23** (+ link
  `/design/specs/new?section=<sectionId>&quote=<quoteId>` when the doc has a quote source — read `new/page.tsx`
  for the params it accepts; add `section` preselect if missing).
- Unresolved rows: **Link to existing** · **Write new spec** · **Waive**. Matched rows: **Edit** (inline panel
  under the row: title input, textarea, radio "This project only" (default) / "Update the library" (+ required
  why input, + "Used on N saved specs" from `recordUsageAction`), Save / Cancel). Overridden entries show "Changed
  for this project" + **Use library text**; stale overrides show "Library updated since you changed this".
- Records whose `usedRecords[specId]` ≠ current revision show "Library changed since your last download".
- Checklist: new **Job values** group (default, context, answer input saving through the existing fill-in save
  action — read how `[FILL IN]` answers are saved in builder.tsx/`builder-actions.ts` and reuse that action; it
  must accept `PS-…#n` keys: extend its key validation to also accept keys produced by `jobValueSlots` for records
  printed in this doc, with the label looked up server-side from the record text just like fill-ins).
- **Add from Spec Library** button beside the existing catalog picker.
- Every mutation: `useTransition`, error text inline, `router.refresh()` on success.

- [ ] **Step 1:** Write the source checks (FAIL). **Step 2:** implement. **Step 3:** `npx tsc --noEmit`, `npm run
  test:specs`, **`npx next build`** (client files touched). **Step 4:** browser check on a scratch datadir (see
  memory `peak-exercising-post-routes-safely.md` / `peak-worktree-dev-server-browser-verification-traps.md`):
  boot `PGLITE_PATH=<scratch> npx next dev -p 3217` in the worktree, dev-login, seed a quote with LS-P, IQ24
  vendor line, a CUSTOM shell line and XYZ-123, import the v1 records into the scratch DB with the CLI (server
  stopped first), create a spec from the quote for 26 09 61, and confirm the match report, a Link, a Write new, a
  Waive, a project-only edit and a library edit. Report what you saw.
- [ ] **Step 5: Commit** `feat(specs): builder match report — link, write new, waive, project vs library edits`

---

### Task 10: Spec Library screen — records view, editor, history, xlsx

**Files:**
- Modify: `src/app/(app)/design/specs/library/page.tsx` — `?view=sections` renders today's content unchanged;
  default view renders the new records view (extract today's body into `sections-view.tsx` first, no behavior
  change)
- Create: `src/app/(app)/design/specs/library/records-view.tsx` (server component: table + filter form using
  GET params `q`, `kind`, `section`, `status`, `mfr`), `library/records/[specId]/page.tsx`,
  `library/records/[specId]/record-editor.tsx` (client), `library/records/new/page.tsx`,
  `library/records-import.tsx` (client: file input → preview counts/problems → Confirm),
  `src/app/(app)/design/specs/library/records-export/route.ts` (GET → `writeLibraryWorkbook(allSpecRecords())`,
  `Content-Disposition: attachment; filename="Peak Spec Library <YYYY-MM-DD>.xlsx"`, `requireUser()`)
- Modify: `src/app/(app)/design/specs/record-actions.ts` — add `previewSpecRecordImportAction(form: FormData)` and
  `commitSpecRecordImportAction(form: FormData)` (both re-read + re-plan the uploaded file on the server; 5 MB cap;
  `.xlsx` or `.json`)
- Test: append — pure filter helper `filterSpecRecords(records, { q, kind, section, status, mfr })` (put it in
  `src/lib/specs/records.ts`) with cases; source checks: export route calls `requireUser`, import actions call
  `requirePerm("create")`, editor has no `window.confirm|prompt`, client files import stores type-only.

UI (spec §7): table columns Spec ID (link to editor) · Title · Kind (label) · Section · Status · Manufacturer ·
Part #s (count, first 3 on hover/title) · Rev · Updated; toolbar: search, kind/section/status/manufacturer selects
(options from the data), **New spec**, **Import .xlsx**, **Export .xlsx**, link **Sections & articles →**. Editor:
all fields (kind-aware: part numbers one per line for product kinds; match key for system; include-with picker for
companion; article select limited to the chosen section's articles), status select (archive), why input required
when editing an existing record, Save → `saveSpecRecordAction`, validation problems shown inline; **History**: list
newest-first (rev, when, who, why) with expandable full text and **Restore this version**
(`restoreSpecRecordRevisionAction`, inline "Restore revision N? Restore / Cancel" — no confirm()).

- [ ] **Steps:** failing checks → implement → `tsc`, `test:specs`, `next build`, browser check on the scratch
  datadir (list, filter, edit + history + restore, export then re-import the exported file = 0 changes).
- [ ] **Commit** `feat(specs): Spec Library records view, editor with revision history, xlsx import/export`

---

### Task 11: `specKey` pickers at the source + docs + final gates

**Files:**
- Modify: estimator — `src/app/(app)/estimator/estimator-client.tsx` custom-part draft/form (add `specKey` to the
  draft and to the pushed item) and the curtain add path (`specKey: curtainSpecKey(undefined, name)` default);
  line editing in `section-card.tsx` for items with `custom || curtain`: a small **Spec** select (options = system
  match keys, passed from `estimator/page.tsx` server-side via a new `specKeys: string[]` prop, loaded with
  `allSpecRecords()` filtered to `kind==="system" && status!=="archived"`), empty option "— none —". Read how
  section-card edits other item fields and follow it.
- Modify: Grid curtain editor — find where `GridCurtain` is edited (grep `fullnessPct` under
  `src/app/(app)/design/grid`); add an optional **Spec** select (same `specKeys`, default shows the derived key as
  placeholder "Auto: Stage Drapes – …"); plumb `specKeys` from the Grid page server component.
- Docs: `DECISIONS.md` — recompute the next free D number from **origin/main** right before writing
  (`git fetch && git show origin/main:DECISIONS.md | grep -o "^## D[0-9]*" | tail -1`); log: records model +
  revisions; live-with-stamps (Jeff Q1); D330 kept + sixth level (Q2); builder-written = ready (Q3); library
  screen location (Q4); vendor-only (Q5); match order & wildcard 1–5; brackets as job values keyed by specId;
  ITEMS NOT SPECIFIED for waived rows only; vendor-quote expansion + allowance rows kept; go-live wipe keeps
  records; builder Write spec now writes a record (catalog Spec panel keeps legacy editor); prod import is
  Jeff-gated via Library → Import .xlsx after `npm run db:export`. `PUNCHLIST.md` — new item (next free number
  from origin/main) with the Jeff-gated remainder. `AGENTS.md` — Phase status entry 23. Keep the harness's
  DECISIONS/PUNCHLIST structure checks green.
- Test: source checks for the pickers (estimator page passes `specKeys`; `SpecItem.specKey` written by the custom
  part path; Grid curtain editor offers the select).

- [ ] **Steps:** failing checks → implement → full gates: `npx tsc --noEmit`; `npm run test:specs` (report PASS
  count vs. baseline); `npx eslint` on all touched files vs. baseline; `npx next build`; `npm run test:smoke`
  (stop any dev server first; check `lsof -i :3000`).
- [ ] **Commit** `feat(specs): spec-key pickers on estimator lines and Grid curtains` and
  `docs: spec library records — D…, punch #…`

---

## Controller-only steps (not delegated)

1. After Task 3: local import into the real dev DB — confirm no process holds `.data/pglite` (`ps aux | grep -E
   "tsx|next"`; other sessions may run `next dev` from the main checkout), `cp -R .data .data-backup-20260928-spec-records`,
   then from the **main checkout's** `.data`? No — the worktree has no `.data`; run the CLI from the worktree with
   `PGLITE_PATH=/Users/sm/Downloads/peak-app/.data/pglite` only after the main checkout's migrations are current
   (the local DB is behind at 0026; opening it runs `migrate()` through 0033 — acceptable, that is what `next dev`
   would do). Dry run first, then `--commit`, then dry run again (expect 46 unchanged).
2. Final whole-branch review (cavecrew-reviewer or superpowers:requesting-code-review), fix round.
3. Merge `origin/main` forward (docs numbering collisions → renumber), re-run gates, fast-forward `main`, push,
   confirm the Vercel deploy is green (memory `reference-vercel-deploy-inspection.md`).
