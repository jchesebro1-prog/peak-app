# Specs Module — Phase A (Library) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the library half of the Specs module — the three new collections, the article/template/curtain-template data model, the spec fields on catalog parts, the outline renderer, the library and template editors, the part Spec panel with a live preview, the coverage table, import/export, and the nav entry — so that Phase B's generator has approved product language to assemble from.

**Architecture:** One pure text engine (`src/lib/specs/outline.ts`) turns indented plain text into labelled outline lines and substitutes placeholders; everything that prints goes through it. Three new doc-store collections (`spec_articles`, `spec_templates`, `spec_curtain_templates`) join the existing `spec_sections`, which gains titled Part 1/Part 3 articles, a Part 2 style and a quantities policy while still reading records whose `part1`/`part3` are plain strings. Catalog parts carry their own approved spec language as additive JSONB fields written through `mergeUpsert`. Screens live under `/design/specs` and are built on the Companies/Vendors screen idioms. Spec: `docs/superpowers/specs/2026-09-21-spec-from-bom-module-design.md` (§1, §2, §4, §8, §9 and the Phase A bullet in §10).

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle on Postgres/PGlite, doc-store JSON documents, server actions, `tsx` test harnesses.

**Recon:** `/private/tmp/claude-501/-Users-sm-Downloads-peak-app-worktree-task5-link-actions/d4dc57d9-6334-47c6-ac8b-fe5681b1a55f/scratchpad/specs-recon.md` — verified `path:line` anchors for every file this plan touches. Read it when a step says "see recon".

---

## Global Constraints

Every task's requirements implicitly include this section.

- **D89 — no AI in the app.** Nothing in this module calls a model. Text is authored by a human or imported from a file a human reviewed. There is no `ANTHROPIC_API_KEY` anywhere in the tree and this plan must not add one.
- **D94 — the completeness rule stands.** A part with no approved spec language blocks finalize; the match report is the guarantee. Product language lives on the catalog part.
- **Only `specState: "authored"` ever prints — everywhere.** `draft` is treated exactly like missing, in this module AND in every consumer that already reads `specBody` (D94 `matchBom`, the D94 engagement actions, the Displays API, the Grid client package). Task 6 routes all of them through one pure predicate, `hasPrintableSpec()` (owner decision, 2026-09-25).
- **D141 — hand-written idempotent migrations.** `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE TRIGGER`. A new `docTable()` gets no `_seq_bump` trigger unless the migration creates one, and without it pull-sync's `WHERE seq > cursor` goes blind.
- **Outline convention (spec §2).** Plain text, one item per line, two spaces per level, a tab counts as one level. Labels by depth: `A.` `1.` `a.` `1)` `a)`. Depth beyond the fifth level clamps to the fifth and raises a warning. Blank lines are ignored. A line already starting with a label such as `A. ` or `1. ` has it stripped. Inside a product entry the product letter consumes the first level, so a body's top level prints as `1.`; inside a Part 1 or Part 3 article it prints as `A.`.
- **Article numbering is `1.1` / `2.1` / `3.1`**, never D94's `2.01`.
- **Permissions.** Reads call `requireUser()`. Every library, template, curtain-template or part-spec write calls `requirePerm("create")` — which returns the `SessionUser`, so never call `requireUser()` a second time after it. (The existing D94 actions gate on `requireUser()` only; leave their **permission gates** alone — changing them is out of scope for this phase. The one sanctioned change to those actions is draft gating, Task 6 Step 6.)
- **Catalog writes go through `mergeUpsert(sku, patch)`, never `upsert`.** `upsert` replaces the whole document and will silently wipe `ports`, `trade`, datasheet fields and spec fields. See the warning comment at `src/lib/stores/catalog.ts:191-206`. `src/app/(app)/catalog/actions.ts` uses named imports (`get as getPart`, `upsert`, `mergeUpsert`, `remove as removePart`) — there is no `Catalog` namespace in that file.
- **Destructive UI uses the shared `ConfirmButton`** (`src/components/confirm-button.tsx`) — never `window.confirm`. Its `onConfirm` must `throw new Error(r.error)` when an action returns `{ ok: false }`; the button catches the throw and renders the message beside itself (`confirm-button.tsx:60-66`, rendered at `:90`). Returning the result without throwing swallows the refusal.
- **One set of spec fields on a catalog part.** The canonical pointers are `CatalogPart.specSectionId` / `specArticleId` (Task 6). The Displays-API research metadata from commit 2e284665 (`productMetadata.specSection` / `.specArticle`) is *legacy input*: it is adopted into the canonical fields only when it resolves to exactly one live record, it never overwrites a canonical value, and it is never deleted. See Task 6 Step 5 and Task 14.
- **Timestamps are epoch-ms numbers.** Never `Date` objects, never ISO strings in stored documents.
- **Design tokens.** `pk-*` component classes and the CSS variables in `src/app/globals.css`. Accent is user-configurable and arrives as `--accent`; never hardcode an accent-coloured pixel.
- **Dev DB is single-process.** Never leave a `tsx` script running; check `ps aux | grep tsx` before starting a dev server. Never point a script at `.data/pglite` — use `PGLITE_PATH=$(mktemp -d)`.
- **Gates.** Every task ends green on `npx tsc --noEmit -p .` and `npm run test:specs`. (Never run `npx tsx scripts/test-review-and-spec.ts` bare: the harness refuses to run without `PGLITE_PATH`, and the npm script supplies a throwaway one.) The branch ends green on those plus `npm run test:smoke`, `npx next build`, `npx eslint`, and `npx drizzle-kit generate` reporting "No schema changes".
- **Numbering placeholders.** D161 and #142 are taken. This plan writes `D-SPEC-1`, `D-SPEC-2`, … for its decision entries and `#SPEC` for its punch item; the lead renumbers at merge time. Code comments say `D-SPEC` (see `src/db/doc-tables.ts:92-94`, `drizzle/0025_spec_library.sql:1`, `src/lib/specs/outline.ts:2`).

## Decisions this plan takes (log them in Task 15)

These are deviations from, or refinements of, the approved spec. Each gets its own `DECISIONS.md` entry, `D-SPEC-1` … `D-SPEC-8`, in the order below.

1. **The `spec-library` JSON import/export does NOT go through the Import hub.** Spec §4 asks for a `spec-library` import type there. The hub is strictly columnar — `parse.ts`'s header comment says so, the only file input accepts `.xlsx/.xlsm`, and every other path is the CSV paste box (see recon §5). A four-collection library document is not a table. It lands instead as **Export library / Import library** controls on `/design/specs/library`, reading and writing the same JSON shape the spec describes, so the `spec-writer` skill's output still loads unchanged. The *catalog* spec columns stay in the hub exactly as specified, because those are rows.
2. **`/design/specs` redirects to `/design/specs/library` in Phase A.** The Generated list is Phase B; a nav entry pointing at an empty placeholder is worse than one pointing at the screen that does something.
3. **Starter templates seed outside the demo-data flag, on every environment.** `DEMO_COLLECTIONS` is `Object.keys(DOC_TABLES)` (`src/db/seed-data.ts:148-150`), so the go-live reset wipes every doc collection including `spec_templates`. The starter formulas are configuration, not demo data. `seedIfEmpty()` only runs on local dev, so it is not enough on its own (owner decision, 2026-09-25): every read path that needs the formulas (the Templates screen, the part editor's Spec panel, the library export) calls an idempotent `ensureStarterTemplates()`, which seeds only when the collection holds no live formula at all. The dev `seedIfEmpty()` hook stays, and the Templates screen keeps its **Restore starter templates** button.
4. **Spec fields are declared on `CatalogPart` itself**, and `PartSpecFields` in `src/lib/bid-spec.ts` becomes a `Pick<>` of those, so `SpecCatalogPart` stays assignable and every existing D94 call site keeps compiling.
5. **One set of spec pointers (owner decision, 2026-09-25).** Commit 2e284665 (Displays API) added `productMetadata.specSection` / `.specArticle` / `.specLanguageKey` as free text, such as `"11 61 13"` and `"Stage Lighting Instruments"`. This plan's `specSectionId` / `specArticleId` are the canonical fields. The legacy text is adopted into them (Task 6 Step 5) only when it resolves to exactly one live section or article. Adoption happens at read time inside `articleIdForPart`, so it needs no write. It is persisted by an idempotent **Adopt legacy pointers** button that fills absent canonical fields and never overwrites one. The import hub's `Spec Section` / `Spec Article` columns become the canonical `specSectionId` / `specArticleId` columns under the same headers (Task 14). The Displays API reads the canonical fields and falls back to legacy text only where no canonical value exists. `specLanguageKey` has no canonical counterpart; it stays research metadata, untouched. No DB migration, because the fields are doc-store JSON.
6. **Drafts are gated everywhere, not just in this module (owner decision, 2026-09-25).** `matchBom`, `remapRowAction`, `saveSpecAction`, the Displays API and the client-package manifest all read through `hasPrintableSpec()`. A D94 inline write (`writePartSpecAction`) counts as the review step and stamps `authored`.
7. **The part editor's Spec panel shows for anyone with `create`** (owner decision, 2026-09-25), unlike the admin-only datasheet control beside it. Every write stays `requirePerm("create")`.
8. **No `model` field.** `CatalogPart.manufacturerModelNumber` (import column `MFR M/N`) already is the manufacturer's model number. A table-style Part 2 prints `manufacturerModelNumber`, then `manufacturerPartNumber`, then the SKU. The part modal gains inputs for both manufacturer numbers, which fixes the existing bug where every modal save wiped them.

---

## File Structure

**Created**

| File | Responsibility |
|------|----------------|
| `src/lib/specs/outline.ts` | Pure. Indented text → labelled `OutlineLine[]`; label stripping; depth clamping; slot filling; placeholder substitution. Nothing else formats spec text. |
| `src/lib/specs/articles.ts` | Pure. Resolve a part to its article (explicit → category default → legacy section), resolve `specSameAs` one hop with chain/cycle detection, and classify a part's spec state. |
| `src/lib/specs/curtains.ts` | Pure. Fill a curtain template from a `GridCurtain` + fabric name; the grouping key (type + fabric + colour + fullness). |
| `src/lib/stores/spec-articles.ts` | `spec_articles` CRUD. |
| `src/lib/stores/spec-templates.ts` | `spec_templates` CRUD + starter formulas. |
| `src/lib/stores/spec-curtain-templates.ts` | `spec_curtain_templates` CRUD + starters for the four Grid curtain types. |
| `src/lib/specs/library-io.ts` | Server. Export the whole library to one JSON document; import one back, upserting by stable key. |
| `src/app/(app)/design/specs/page.tsx` | Redirect to the library (Phase A). |
| `src/app/(app)/design/specs/actions.ts` | All Phase A server actions. |
| `src/app/(app)/design/specs/coverage.ts` | Pure. Derive the per-article coverage rows and their filters. |
| `src/app/(app)/design/specs/library/page.tsx` | Library index: sections, their articles, the coverage table, library import/export. |
| `src/app/(app)/design/specs/library/controls.tsx` | Client controls for the library index. |
| `src/app/(app)/design/specs/library/[sectionId]/page.tsx` | Section editor. |
| `src/app/(app)/design/specs/library/[sectionId]/editor.tsx` | Client section editor (Part 1/Part 3 articles, style switches, category articles). |
| `src/app/(app)/design/specs/templates/page.tsx` | Template list. |
| `src/app/(app)/design/specs/templates/[key]/page.tsx` | One template's editor. |
| `src/app/(app)/design/specs/templates/editor.tsx` | Client template editor. |
| `src/app/(app)/catalog/spec-panel.tsx` | Client Spec panel for the part modal. |
| `src/app/(app)/catalog/part-form.ts` | Pure. `validateSameAs` and `optionalPartFields` — testable halves of the catalog actions (a `"use server"` file may only export async functions). |
| `src/lib/specs/legacy-pointers.ts` | Server. `adoptAllLegacySpecPointers(by)` — the one-shot, idempotent write of decision 5. |
| `drizzle/0025_spec_library.sql` | The three new tables, idempotent. |
| `drizzle/meta/0025_snapshot.json` | Chained snapshot. |

**Modified**

| File | Change |
|------|--------|
| `src/db/doc-tables.ts` | Three `docTable()` registrations + `DOC_TABLES` entries. |
| `src/db/seed-data.ts` | Call `seedStarterTemplates()` from `seedIfEmpty()` (dynamic import). |
| `src/lib/stores/spec-sections.ts` | `SpecArticle`, `part1`/`part3` as articles with legacy-string reads, `part2Style`, `quantities`, `removeSection`, tombstone-aware starter seeding. |
| `src/lib/bid-spec.ts` | `PartSpecFields` becomes a `Pick<CatalogPart>`; `assemble` flattens Part 1/Part 3 articles; `matchBom` gates drafts. |
| `src/lib/bid-spec-docx.ts` | No change expected — it reads the assembled (string) parts. |
| `src/lib/stores/catalog.ts` | `CatalogPart` gains the spec fields (no `model` — decision 8). |
| `src/lib/stores/generated-specs.ts` | `allGeneratedSpecs()` for the coverage table. |
| `src/lib/displays-api.ts`, `src/app/api/v1/displays/**/route.ts` | Read canonical spec fields; draft gating. |
| `src/lib/client-package.ts` | Draft gating. |
| `src/app/(app)/design/engagements/spec/actions.ts` | `updateSectionAction` compiles against articles; draft gating in `remapRowAction`/`saveSpecAction`; `writePartSpecAction` stamps authored. |
| `src/app/(app)/catalog/page.tsx` | Manufacturer P/N + M/N inputs in the part form; mount `<SpecPanel>` inside the form beside `<PartDatasheetControl>`. |
| `src/app/(app)/catalog/actions.ts` | `upsertPart` stops wiping fields the form did not submit; new `writePartSpecFieldsAction`. |
| `src/app/(app)/catalog/import.ts` | Price-book `Spec Section`/`Spec Article` resolve to the canonical pointers when they can. |
| `src/lib/design/grid-bom.ts` | `GridCurtain.color?`. |
| `src/app/(app)/design/grid/[id]/curtain-drop.tsx`, `src/app/(app)/design/grid/[id]/actions.ts` | Optional Colour field, carried through `placeCurtainAction`. |
| `src/app/(app)/import/types.ts` | Canonical spec columns (two re-keyed under their existing headers, five new). |
| `src/app/(app)/import/registry.ts` | Write those columns through `catalogPatch`; export them. |
| `src/components/nav/nav-data.ts` | `specs` entry + `activeKeyFor` exception. |
| `scripts/test-review-and-spec.ts` | New assertion blocks per task; `DESIGN_CHILDREN` gains `specs`. |
| `scripts/smoke-routes.ts` | The module's GET routes. |
| `DECISIONS.md`, `PUNCHLIST.md` | `D-SPEC-1`…`D-SPEC-8` and `#SPEC` (placeholders — the lead renumbers). |

---

### Task 1: The outline engine

**Files:**
- Create: `src/lib/specs/outline.ts`
- Test: `scripts/test-review-and-spec.ts` (new `/* --- specs: outline --- */` block, appended at the end of the file)

**Interfaces:**
- Consumes: nothing. This is the first task and the module is pure — no store imports, no `Date.now()`, no environment access, so it is safe in a client component and in a server action.
- Produces:
  ```ts
  export const OUTLINE_LABELS: readonly ["A.", "1.", "a.", "1)", "a)"];
  export const MAX_OUTLINE_DEPTH: number;                     // 5
  export type OutlineLine = { depth: number; label: string; text: string };
  export type OutlineResult = { lines: OutlineLine[]; warnings: string[] };
  export type OutlineContext = "article" | "entry";
  export type PlaceholderContext = {
    articles?: string[];
    manufacturers?: string[];
    project?: { number?: string; name?: string; phase?: string; issueDate?: string };
    section?: { number?: string; title?: string };
  };
  export function stripLabel(text: string): string;
  export function parseOutline(body: string, context?: OutlineContext): OutlineResult;
  export function outlineToText(lines: OutlineLine[], indent?: string): string;
  export function fillSlots(text: string, slots: Record<string, string>): string;
  export function substitutePlaceholders(body: string, ctx: PlaceholderContext): { text: string; warnings: string[] };
  ```

- [ ] **Step 1: Write the failing tests**

Append to the very end of `scripts/test-review-and-spec.ts`, and add the import to the import block at the top of that file (the block ends around line 155):

```ts
import {
  parseOutline,
  stripLabel,
  outlineToText,
  fillSlots,
  substitutePlaceholders,
  MAX_OUTLINE_DEPTH,
} from "@/lib/specs/outline";
```

```ts
/* --- specs: outline --- */
{
  const a = parseOutline("Top one\n  Sub one\n  Sub two\nTop two");
  ok(a.lines.length === 4, "outline: four lines");
  ok(a.lines[0].label === "A." && a.lines[0].depth === 0, "outline: article top level is A.");
  ok(a.lines[1].label === "1." && a.lines[1].depth === 1, "outline: two spaces is one level, labelled 1.");
  ok(a.lines[2].label === "2.", "outline: siblings increment");
  ok(a.lines[3].label === "B." && a.lines[3].depth === 0, "outline: returning to the top level continues A., B.");
  ok(a.warnings.length === 0, "outline: a four-level-shallow body warns about nothing");

  const e = parseOutline("Top one\n  Sub one", "entry");
  ok(e.lines[0].label === "1." && e.lines[0].depth === 1, "outline: a product entry's top level prints 1., not A.");
  ok(e.lines[1].label === "a.", "outline: the entry's second level prints a.");

  const tab = parseOutline("Top\n\tSub");
  ok(tab.lines[1].depth === 1, "outline: a tab counts as one level");

  const reset = parseOutline("One\n  a\n  b\nTwo\n  c");
  ok(reset.lines[4].label === "1.", "outline: a deeper counter resets under a new parent");

  ok(stripLabel("A. Basis of Design") === "Basis of Design", "outline: strips an A. label");
  ok(stripLabel("1) Amperage") === "Amperage", "outline: strips a 1) label");
  ok(stripLabel("(a) Colour") === "Colour", "outline: strips a parenthesised label");
  ok(stripLabel("1.1 Section Includes") === "1.1 Section Includes", "outline: 1.1 is an article number, not a label");
  ok(stripLabel("110V supply") === "110V supply", "outline: leaves ordinary text alone");

  const blank = parseOutline("One\n\n\n  Two\n   \n");
  ok(blank.lines.length === 2, "outline: blank and whitespace-only lines are ignored");

  const deep = parseOutline("1\n  2\n    3\n      4\n        5\n          6");
  ok(deep.lines.length === 6, "outline: every line still prints when clamped");
  ok(deep.lines[5].depth === MAX_OUTLINE_DEPTH - 1, "outline: depth beyond the fifth level clamps to the fifth");
  ok(deep.warnings.some((w) => w.includes("deeper")), "outline: clamping raises a warning");

  const jump = parseOutline("One\n      Way too deep");
  ok(jump.lines[1].depth === 1, "outline: a level jump of more than one is pulled back to one");

  ok(
    outlineToText(parseOutline("One\n  Two").lines, "  ") === "A. One\n  1. Two",
    "outline: outlineToText indents by depth"
  );

  ok(
    fillSlots("{{material}} in {{color}}", { material: "22oz velour", color: "Black" }) === "22oz velour in Black",
    "outline: fillSlots replaces known slots"
  );
  ok(fillSlots("{{unknown}}", { a: "b" }) === "{{unknown}}", "outline: fillSlots leaves unknown slots for the placeholder pass");

  const solo = substitutePlaceholders("Acceptable manufacturers:\n  {{manufacturers}}", {
    manufacturers: ["ETC", "Chauvet"],
  });
  ok(
    solo.text === "Acceptable manufacturers:\n    ETC\n    Chauvet",
    "outline: a placeholder alone on a line expands one item per line, one level deeper"
  );
  ok(solo.warnings.length === 0, "outline: a filled list warns about nothing");

  const inline = substitutePlaceholders("Approved: {{manufacturers}}.", { manufacturers: ["ETC", "Chauvet"] });
  ok(inline.text === "Approved: ETC, Chauvet.", "outline: an inline list placeholder joins with commas");

  const scalar = substitutePlaceholders("Section {{section.number}} — {{section.title}}", {
    section: { number: "11 61 23", title: "Stage Curtains" },
  });
  ok(scalar.text === "Section 11 61 23 — Stage Curtains", "outline: scalar placeholders substitute");

  const unknown = substitutePlaceholders("See {{project.architect}}", {});
  ok(unknown.text === "See {{project.architect}}", "outline: an unknown placeholder prints literally");
  ok(unknown.warnings.some((w) => w.includes("project.architect")), "outline: an unknown placeholder warns by name");

  const empty = substitutePlaceholders("Manufacturers:\n  {{manufacturers}}", { manufacturers: [] });
  ok(empty.text === "Manufacturers:", "outline: an empty list placeholder drops its own line");
  ok(empty.warnings.length === 1, "outline: an empty list placeholder warns once");

  const dupes = substitutePlaceholders("{{nope}} and {{nope}}", {});
  ok(dupes.warnings.length === 1, "outline: repeated identical warnings are reported once");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:specs`
Expected: the run aborts before printing any PASS/FAIL with `Cannot find module '@/lib/specs/outline'` (the harness is one file with a single import block at the top, so a missing module is a resolution error, not a FAIL line).

- [ ] **Step 3: Write the implementation**

Create `src/lib/specs/outline.ts`:

```ts
/**
 * The Specs module's text engine (Phase A, D-SPEC).
 *
 * Bodies in the spec library are plain text, one item per line, indented two
 * spaces per level (a tab counts as one level). This module is the ONLY place
 * that turns that text into numbered outline lines, so the part editor's live
 * preview, the section editor's preview and Phase B's docx builder cannot
 * disagree about what a body prints as.
 *
 * Pure on purpose: no store imports, no Date.now(), no environment. That is
 * what lets the same function run in a client component and in a server
 * action, and what makes every rule below testable in the pure harness.
 */

export const OUTLINE_LABELS = ["A.", "1.", "a.", "1)", "a)"] as const;
export const MAX_OUTLINE_DEPTH = OUTLINE_LABELS.length;

export type OutlineLine = { depth: number; label: string; text: string };
export type OutlineResult = { lines: OutlineLine[]; warnings: string[] };

/**
 * "article" — a Part 1 / Part 3 article body, whose top level prints A., B., C.
 * "entry"   — a product entry body. The product's own letter has already
 *             consumed the first level, so the body's top level prints 1., 2.
 */
export type OutlineContext = "article" | "entry";

export type PlaceholderContext = {
  /** Part 2 article titles present in the document being assembled. */
  articles?: string[];
  /** The enclosing article's acceptable manufacturers, in order. */
  manufacturers?: string[];
  project?: { number?: string; name?: string; phase?: string; issueDate?: string };
  section?: { number?: string; title?: string };
};

/** 1 → A, 26 → Z, 27 → AA. */
function alpha(n: number): string {
  let out = "";
  let x = Math.max(1, Math.floor(n));
  while (x > 0) {
    const r = (x - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    x = Math.floor((x - 1) / 26);
  }
  return out;
}

function labelFor(depth: number, n: number): string {
  switch (depth) {
    case 0:
      return alpha(n) + ".";
    case 1:
      return String(n) + ".";
    case 2:
      return alpha(n).toLowerCase() + ".";
    case 3:
      return String(n) + ")";
    default:
      return alpha(n).toLowerCase() + ")";
  }
}

/**
 * A label the author (or Word) already typed. Matches `A.` `a.` `1.` `1)`
 * `(a)` `(1)` followed by whitespace — and deliberately NOT `1.1 `, which is
 * an article number, not an outline label.
 */
const LABEL_RE = /^\(?(?:[A-Za-z]|\d{1,2})[.)]\s+/;

export function stripLabel(text: string): string {
  return text.replace(LABEL_RE, "");
}

/** Leading whitespace → level. A tab is one level; every two spaces is one. */
function depthOf(line: string): number {
  let levels = 0;
  let spaces = 0;
  for (const ch of line) {
    if (ch === "\t") levels++;
    else if (ch === " ") spaces++;
    else break;
  }
  return levels + Math.floor(spaces / 2);
}

export function parseOutline(body: string, context: OutlineContext = "article"): OutlineResult {
  const offset = context === "entry" ? 1 : 0;
  const counters = new Array<number>(MAX_OUTLINE_DEPTH).fill(0);
  const lines: OutlineLine[] = [];
  const warnings: string[] = [];
  let prev = -1;
  let clamped = false;

  for (const raw of String(body || "").split(/\r?\n/)) {
    const text = stripLabel(raw.trim());
    if (!text) continue;

    // A jump of more than one level is an authoring slip, not an intent to
    // skip a numbering level — pull it back so the outline stays legible.
    let level = depthOf(raw);
    if (level > prev + 1) level = prev + 1;
    prev = level;

    let depth = offset + level;
    if (depth >= MAX_OUTLINE_DEPTH) {
      depth = MAX_OUTLINE_DEPTH - 1;
      clamped = true;
    }

    counters[depth]++;
    for (let j = depth + 1; j < MAX_OUTLINE_DEPTH; j++) counters[j] = 0;
    lines.push({ depth, label: labelFor(depth, counters[depth]), text });
  }

  if (clamped) {
    warnings.push(
      `Outline deeper than ${MAX_OUTLINE_DEPTH} levels — the deepest items print at level ${MAX_OUTLINE_DEPTH}.`
    );
  }
  return { lines, warnings };
}

export function outlineToText(lines: OutlineLine[], indent = "  "): string {
  return lines.map((l) => indent.repeat(l.depth) + l.label + " " + l.text).join("\n");
}

/**
 * Curtain-template slots. Replaces only the keys it is given and leaves every
 * other `{{…}}` untouched, so `substitutePlaceholders` can have the last word
 * (and warn) about anything nobody filled.
 */
export function fillSlots(text: string, slots: Record<string, string>): string {
  return String(text || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(slots, key) ? slots[key] : whole
  );
}

const SOLO_RE = /^\{\{\s*([\w.]+)\s*\}\}$/;
const ANY_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

export function substitutePlaceholders(
  body: string,
  ctx: PlaceholderContext
): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  const lists: Record<string, string[] | undefined> = {
    articles: ctx.articles,
    manufacturers: ctx.manufacturers,
  };
  const scalars: Record<string, string | undefined> = {
    "project.number": ctx.project?.number,
    "project.name": ctx.project?.name,
    "project.phase": ctx.project?.phase,
    "project.issueDate": ctx.project?.issueDate,
    "section.number": ctx.section?.number,
    "section.title": ctx.section?.title,
  };

  const out: string[] = [];
  for (const raw of String(body || "").split(/\r?\n/)) {
    const lead = /^[ \t]*/.exec(raw)?.[0] ?? "";
    const solo = SOLO_RE.exec(raw.trim());
    if (solo && solo[1] in lists) {
      const items = lists[solo[1]] ?? [];
      if (!items.length) {
        warnings.push(`{{${solo[1]}}} had no values — the line was dropped.`);
        continue;
      }
      // One level deeper than the placeholder's own line.
      for (const item of items) out.push(lead + "  " + item);
      continue;
    }
    out.push(
      raw.replace(ANY_RE, (whole, key: string) => {
        if (key in lists) {
          const items = lists[key] ?? [];
          if (!items.length) {
            warnings.push(`{{${key}}} had no values — printed as written.`);
            return whole;
          }
          return items.join(", ");
        }
        if (key in scalars) {
          const v = scalars[key];
          if (v == null || v === "") {
            warnings.push(`{{${key}}} has no value yet — printed as written.`);
            return whole;
          }
          return v;
        }
        warnings.push(`Unknown placeholder {{${key}}} — printed as written.`);
        return whole;
      })
    );
  }
  return { text: out.join("\n"), warnings: [...new Set(warnings)] };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:specs`
Expected: every new `outline:` line prints PASS, the run ends `ALL PASSED`, exit 0.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/specs/outline.ts scripts/test-review-and-spec.ts
git commit -m "feat(specs): the outline engine — indented text to labelled lines, slots, placeholders"
```

---

### Task 2: Three collections and migration 0025

**Files:**
- Modify: `src/db/doc-tables.ts`
- Create: `drizzle/0025_spec_library.sql`
- Create: `drizzle/meta/0025_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: the collection names `"spec_articles"`, `"spec_templates"`, `"spec_curtain_templates"`, valid as the first argument to every `doc-store` function from Task 4 onward.

- [ ] **Step 1: Register the three tables**

In `src/db/doc-tables.ts`, immediately after the `vendorProfiles` line (see recon §2 — the existing `specSections` / `generatedSpecs` lines are around 78-79 and `vendorProfiles` around 91), add:

```ts
export const specArticles = docTable("spec_articles"); // Specs module (D-SPEC) — Part 2 category articles: manufacturers + the "A. General" clause; migration 0025_spec_library
export const specTemplates = docTable("spec_templates"); // Specs module (D-SPEC) — per-category authoring formulas (headings + guidance + a worked example); migration 0025_spec_library
export const specCurtainTemplates = docTable("spec_curtain_templates"); // Specs module (D-SPEC) — one document per Grid curtain type; migration 0025_spec_library
```

and in the `DOC_TABLES` object, after `vendor_profiles`:

```ts
  spec_articles: specArticles,
  spec_templates: specTemplates,
  spec_curtain_templates: specCurtainTemplates,
```

Do **not** add them to `SYNCABLE_COLLECTIONS` — like `spec_sections` and `generated_specs`, these are server-action-only.

- [ ] **Step 2: Write the migration**

Create `drizzle/0025_spec_library.sql`. Copy `drizzle/0024_vendor_profiles.sql` column-for-column three times. Idempotent per D141 — `IF NOT EXISTS` on the table and both indexes, `CREATE OR REPLACE TRIGGER` for the `_seq_bump`:

```sql
-- Specs module (D-SPEC), Phase A — the three new library collections.
--
-- Hand-rewritten from the generated DDL so it is idempotent per D141: this
-- file runs against a shared Neon database that more than one branch's build
-- migrates, and the 2026-07 production failure on 0020 was exactly a
-- non-idempotent CREATE. Column-for-column `docTable()`; each table needs its
-- own `_seq_bump` trigger or pull-sync's `WHERE seq > cursor` goes blind.
CREATE TABLE IF NOT EXISTS "spec_articles" (
	"id" text PRIMARY KEY NOT NULL,
	"doc" jsonb NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"seq" bigserial NOT NULL,
	"updated_at" bigint NOT NULL,
	"received_at" bigint NOT NULL,
	"review" jsonb,
	"deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spec_articles_seq_idx" ON "spec_articles" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spec_articles_deleted_idx" ON "spec_articles" USING btree ("deleted");--> statement-breakpoint
CREATE OR REPLACE TRIGGER spec_articles_seq_bump BEFORE UPDATE ON "spec_articles" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "spec_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"doc" jsonb NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"seq" bigserial NOT NULL,
	"updated_at" bigint NOT NULL,
	"received_at" bigint NOT NULL,
	"review" jsonb,
	"deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spec_templates_seq_idx" ON "spec_templates" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spec_templates_deleted_idx" ON "spec_templates" USING btree ("deleted");--> statement-breakpoint
CREATE OR REPLACE TRIGGER spec_templates_seq_bump BEFORE UPDATE ON "spec_templates" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "spec_curtain_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"doc" jsonb NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"seq" bigserial NOT NULL,
	"updated_at" bigint NOT NULL,
	"received_at" bigint NOT NULL,
	"review" jsonb,
	"deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spec_curtain_templates_seq_idx" ON "spec_curtain_templates" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spec_curtain_templates_deleted_idx" ON "spec_curtain_templates" USING btree ("deleted");--> statement-breakpoint
CREATE OR REPLACE TRIGGER spec_curtain_templates_seq_bump BEFORE UPDATE ON "spec_curtain_templates" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
```

- [ ] **Step 3: Chain the snapshot and the journal**

Do **not** run `drizzle-kit generate` to produce these — it writes non-idempotent DDL. Build them by hand:

```bash
node -e '
const fs=require("fs");
const j=JSON.parse(fs.readFileSync("drizzle/meta/_journal.json","utf8"));
const last=j.entries[j.entries.length-1];
console.log("last journal entry:", JSON.stringify(last));
const prev=JSON.parse(fs.readFileSync("drizzle/meta/"+String(last.idx).padStart(4,"0")+"_snapshot.json","utf8"));
console.log("prev snapshot id:", prev.id);
'
```

Then:
1. Copy the previous snapshot to `drizzle/meta/0025_snapshot.json`.
2. In the copy, set `"id"` to a fresh uuid (`node -e 'console.log(require("crypto").randomUUID())'`) and `"prevId"` to the previous snapshot's `id`.
3. Add the three tables to the copy's `tables` object, each copied from the `vendor_profiles` entry with the name and index names changed.
4. Append to `drizzle/meta/_journal.json`'s `entries`:
   ```json
   { "idx": 25, "version": "7", "when": <Date.now() — must be greater than the previous entry's "when">, "tag": "0025_spec_library", "breakpoints": true }
   ```

- [ ] **Step 4: Prove the snapshot matches the schema**

Run: `npx drizzle-kit generate`
Expected: `No schema changes, nothing to migrate 😴`. Anything else means the snapshot does not describe the three tables correctly — fix the snapshot, never accept a generated file.

- [ ] **Step 5: Prove the migration applies to a fresh database and is re-runnable**

`scripts/test-review-regressions.ts` opens PGlite, which runs `migrate()` — so running it twice against the same scratch datadir exercises both the first application and the re-run:

```bash
ps aux | grep tsx                 # must be empty before you start
D=$(mktemp -d)
PGLITE_PATH=$D npx tsx scripts/test-review-regressions.ts
PGLITE_PATH=$D npx tsx scripts/test-review-regressions.ts
rm -rf "$D"
```
Expected: both runs pass. The first proves the three tables and their triggers are created; the second proves every statement is idempotent, which is the D141 rule that the 2026-07 production failure on 0020 broke. **Never point this at `.data/pglite`.**

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit -p .
git add src/db/doc-tables.ts drizzle/0025_spec_library.sql drizzle/meta/0025_snapshot.json drizzle/meta/_journal.json
git commit -m "feat(specs): spec_articles, spec_templates and spec_curtain_templates collections + migration 0025"
```

---

### Task 3: Sections gain titled articles, a Part 2 style and a quantities policy

**Files:**
- Create: `src/lib/specs/sections.ts` (pure)
- Modify: `src/lib/stores/spec-sections.ts`
- Modify: `src/lib/bid-spec.ts` (two lines — the import and `assemble`'s `part1`/`part3`)
- Modify: `src/app/(app)/design/engagements/spec/actions.ts` (`updateSectionAction`, lines 165-172 — see Step 5)
- No change: `src/lib/bid-spec-docx.ts` reads the *assembled* sections, whose `part1`/`part3` stay strings; `src/lib/client-package-server.ts` never reads a section's parts. Both keep working unchanged.
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1-2 at runtime.
- Produces:
  ```ts
  // src/lib/specs/sections.ts — PURE. bid-spec.ts already imports the SpecSection
  // type from the store; it must not import anything at RUNTIME from a store
  // module, because generator.tsx is a client component that calls matchBom().
  export type SpecArticle = { id: string; title: string; body: string };
  export type SpecPart2Style = "paragraphs" | "table";
  export type SpecQuantities = "drawings" | "inline";
  export type SpecSection = {
    id: string; number: string; title: string; sort: number;
    part1: SpecArticle[]; part3: SpecArticle[];
    part2Style: SpecPart2Style; quantities: SpecQuantities;
    updatedAt: number; updatedBy: string;
  };
  export type RawSpecSection = { /* what may actually be in the database */ };
  export function toArticles(v: unknown): SpecArticle[];
  export function normalizeSection(raw: RawSpecSection): SpecSection;
  export function partText(articles: SpecArticle[]): string;
  export function newArticleId(): string;
  ```
  `src/lib/stores/spec-sections.ts` re-exports every one of those types so existing `import type { SpecSection } from "@/lib/stores/spec-sections"` lines keep working, and adds `getSection(id)` and `removeSection(id)` (soft delete — the owner asked for a delete on every record; Task 8 wraps it in a refusing action, Task 9 surfaces it).

- [ ] **Step 1: Write the failing tests**

Add to the import block of `scripts/test-review-and-spec.ts`:

```ts
import { toArticles, normalizeSection, partText } from "@/lib/specs/sections";
```

Append:

```ts
/* --- specs: sections --- */
{
  const legacy = normalizeSection({
    id: "ss-1", number: "11 61 23", title: "Stage Curtains", sort: 10,
    part1: "Scope of this section.\nSubmit shop drawings.",
    part3: "", updatedAt: 1, updatedBy: "Jeff",
  } as never);
  ok(Array.isArray(legacy.part1), "sections: a legacy string part1 reads as an array");
  ok(legacy.part1.length === 1, "sections: a legacy string is exactly one article");
  ok(legacy.part1[0].title === "", "sections: the legacy article is untitled");
  ok(legacy.part1[0].body.includes("Submit shop drawings"), "sections: the legacy text survives verbatim");
  ok(legacy.part3.length === 0, "sections: an empty legacy string is no articles at all");
  ok(legacy.part2Style === "paragraphs", "sections: part2Style defaults to paragraphs");
  ok(legacy.quantities === "drawings", "sections: quantities defaults to drawings");

  const modern = normalizeSection({
    id: "ss-2", number: "26 09 61", title: "Controls", sort: 20,
    part1: [{ id: "sa-1", title: "SECTION INCLUDES", body: "Dimming." }],
    part3: [], part2Style: "table", quantities: "inline",
    updatedAt: 2, updatedBy: "Jeff",
  } as never);
  ok(modern.part1[0].title === "SECTION INCLUDES", "sections: an article array passes through");
  ok(modern.part2Style === "table" && modern.quantities === "inline", "sections: stored style and quantities survive");

  const junk = normalizeSection({ id: "ss-3", number: "x", title: "y", sort: 0, part2Style: "nonsense", quantities: 7 } as never);
  ok(junk.part2Style === "paragraphs" && junk.quantities === "drawings", "sections: an unknown style falls back to the default");
  ok(junk.part1.length === 0 && junk.part3.length === 0, "sections: a missing part is no articles");

  ok(toArticles(undefined).length === 0, "sections: toArticles(undefined) is empty");
  ok(toArticles("   ").length === 0, "sections: a whitespace-only legacy string is empty");

  ok(
    partText([{ id: "a", title: "SUBMITTALS", body: "One." }, { id: "b", title: "", body: "Two." }]) ===
      "SUBMITTALS\nOne.\n\nTwo.",
    "sections: partText flattens titled and untitled articles for the D94 renderer"
  );
  ok(partText([]) === "", "sections: partText of no articles is the empty string");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:specs`
Expected: aborts with `Cannot find module '@/lib/specs/sections'`.

- [ ] **Step 3: Write the pure module**

Create `src/lib/specs/sections.ts`:

```ts
/**
 * Section shape for the Specs module (D-SPEC), split out of the store so it
 * stays pure: `src/lib/bid-spec.ts` runs inside a client component
 * (`design/engagements/spec/generator.tsx` calls `matchBom`), so it cannot
 * import anything at runtime that reaches the database.
 *
 * D94 wrote `part1` / `part3` as one flat text block each. The specimen (and
 * every real project manual) writes titled articles — 1.1 SECTION INCLUDES,
 * 1.2 SUBMITTALS — so a section now carries an article array. A saved record
 * whose part is still a string reads as one untitled article; the section
 * editor rewrites it on first save. There is no data migration: JSONB fields
 * are read through `normalizeSection`.
 */

export type SpecArticle = {
  id: string;
  /** e.g. "SUBMITTALS". May be empty — a legacy body has no title. */
  title: string;
  /** Outline text, per the convention in src/lib/specs/outline.ts. */
  body: string;
};

export type SpecPart2Style = "paragraphs" | "table";
export type SpecQuantities = "drawings" | "inline";

export const SPEC_PART2_STYLES: readonly SpecPart2Style[] = ["paragraphs", "table"];
export const SPEC_QUANTITIES: readonly SpecQuantities[] = ["drawings", "inline"];

export type SpecSection = {
  id: string;
  /** CSI number, e.g. "11 61 23". Free text — Peak decides its own numbering. */
  number: string;
  title: string;
  /** Ordering within the assembled package. */
  sort: number;
  part1: SpecArticle[];
  part3: SpecArticle[];
  part2Style: SpecPart2Style;
  quantities: SpecQuantities;
  updatedAt: number;
  updatedBy: string;
};

/** What may actually be sitting in the database, D94 records included. */
export type RawSpecSection = Omit<SpecSection, "part1" | "part3" | "part2Style" | "quantities"> & {
  part1?: unknown;
  part3?: unknown;
  part2Style?: unknown;
  quantities?: unknown;
};

export function newArticleId(): string {
  return "sa-" + Math.random().toString(36).slice(2, 10);
}

function articleFrom(v: unknown, i: number): SpecArticle | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title : "";
  const body = typeof o.body === "string" ? o.body : "";
  if (!title.trim() && !body.trim()) return null;
  return { id: typeof o.id === "string" && o.id ? o.id : `sa-legacy-${i + 1}`, title, body };
}

export function toArticles(v: unknown): SpecArticle[] {
  if (Array.isArray(v)) return v.map(articleFrom).filter((a): a is SpecArticle => a !== null);
  if (typeof v === "string") {
    const body = v.trim();
    return body ? [{ id: "sa-legacy-1", title: "", body }] : [];
  }
  return [];
}

export function normalizeSection(raw: RawSpecSection): SpecSection {
  const style = SPEC_PART2_STYLES.includes(raw.part2Style as SpecPart2Style)
    ? (raw.part2Style as SpecPart2Style)
    : "paragraphs";
  const qty = SPEC_QUANTITIES.includes(raw.quantities as SpecQuantities)
    ? (raw.quantities as SpecQuantities)
    : "drawings";
  return {
    id: String(raw.id || ""),
    number: String(raw.number || "").trim(),
    title: String(raw.title || "").trim(),
    sort: Number(raw.sort) || 0,
    part1: toArticles(raw.part1),
    part3: toArticles(raw.part3),
    part2Style: style,
    quantities: qty,
    updatedAt: Number(raw.updatedAt) || 0,
    updatedBy: String(raw.updatedBy || ""),
  };
}

/**
 * Flatten a part's articles back to the single text block D94's renderer and
 * docx builder still expect. Phase B replaces those readers with article-aware
 * ones; until then this keeps the existing bid-spec generator working against
 * the new shape without a second code path.
 */
export function partText(articles: SpecArticle[]): string {
  return articles
    .map((a) => [a.title.trim(), a.body.trim()].filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n\n");
}
```

- [ ] **Step 4: Rewrite the store over it**

Replace the body of `src/lib/stores/spec-sections.ts` below its header comment with:

```ts
import { getDoc, listDocs, patchDoc, softDeleteDoc, upsertDoc } from "@/db/doc-store";
import {
  normalizeSection,
  type RawSpecSection,
  type SpecArticle,
  type SpecPart2Style,
  type SpecQuantities,
  type SpecSection,
} from "@/lib/specs/sections";

export type { SpecArticle, SpecPart2Style, SpecQuantities, SpecSection };
export { SPEC_PART2_STYLES, SPEC_QUANTITIES, newArticleId, partText, toArticles } from "@/lib/specs/sections";

function uid(p: string): string {
  return p + Math.random().toString(36).slice(2, 10);
}

export const STARTER_SECTIONS: Array<Pick<SpecSection, "number" | "title" | "sort">> = [
  { number: "11 61 33", title: "Rigging Systems and Controls", sort: 10 },
  { number: "11 61 43", title: "Stage Curtains", sort: 20 },
  { number: "26 09 61", title: "Theatrical Lighting Controls", sort: 30 },
  { number: "26 55 61", title: "Theatrical Lighting Fixtures", sort: 40 },
  { number: "27 41 16", title: "Performance Audio-Video Systems", sort: 50 },
];

export async function allSections(): Promise<SpecSection[]> {
  const list = await listDocs<RawSpecSection>("spec_sections");
  return list
    .map(normalizeSection)
    .sort((a, b) => a.sort - b.sort || a.number.localeCompare(b.number));
}

export async function getSection(id: string): Promise<SpecSection | null> {
  const raw = await getDoc<RawSpecSection>("spec_sections", id);
  return raw ? normalizeSection(raw) : null;
}

export async function createSection(input: {
  number: string;
  title: string;
  sort?: number;
  part1?: SpecArticle[];
  part3?: SpecArticle[];
  part2Style?: SpecPart2Style;
  quantities?: SpecQuantities;
  by: string;
}): Promise<SpecSection> {
  const rec = normalizeSection({
    id: uid("ss-"),
    number: input.number,
    title: input.title,
    sort: Number(input.sort) || 100,
    part1: input.part1 ?? [],
    part3: input.part3 ?? [],
    part2Style: input.part2Style,
    quantities: input.quantities,
    updatedAt: Date.now(),
    updatedBy: input.by,
  } as RawSpecSection);
  await upsertDoc<SpecSection>("spec_sections", rec);
  return rec;
}

export async function updateSection(
  id: string,
  patch: Partial<Pick<SpecSection, "number" | "title" | "sort" | "part1" | "part3" | "part2Style" | "quantities">>,
  by: string
): Promise<void> {
  await patchDoc<RawSpecSection>("spec_sections", id, (d) => {
    const next = normalizeSection({ ...d, ...patch } as RawSpecSection);
    next.updatedAt = Date.now();
    next.updatedBy = by;
    return next as unknown as RawSpecSection;
  });
}

/** Soft delete. The refusal rules (parts or articles still pointing here)
 *  live in the action, which can read the catalog; the store just deletes. */
export async function removeSection(id: string): Promise<void> {
  await softDeleteDoc("spec_sections", id);
}

/**
 * Idempotent — safe to call from the library screen's "add the starter
 * sections" button. Tombstone-aware: a section id is random, so re-creating
 * a starter someone deliberately deleted would mint a NEW id and quietly
 * undo their delete. A starter number present on any record, live OR
 * soft-deleted, is skipped (`listDocs(..., { includeDeleted: true })`).
 * Someone who really wants a deleted starter back adds it by hand.
 */
export async function seedStarterSections(by: string): Promise<number> {
  const everything = await listDocs<RawSpecSection>("spec_sections", { includeDeleted: true });
  const have = new Set(everything.map((s) => String(s.number || "").trim()));
  let made = 0;
  for (const s of STARTER_SECTIONS) {
    if (have.has(s.number)) continue;
    await createSection({ ...s, by });
    made++;
  }
  return made;
}
```

- [ ] **Step 5: Keep the D94 generator compiling**

In `src/lib/bid-spec.ts`, change the section import to the pure module and flatten the two parts where `assemble` builds an `AssembledSection`:

```ts
import { partText, type SpecSection } from "@/lib/specs/sections";
```
```ts
    out.push({ number: s.number, title: s.title, part1: partText(s.part1), part3: partText(s.part3), parts });
```

`AssembledSection.part1` stays `string` — nothing downstream of `assemble` changes in this phase. **Do not** use `partText` anywhere else.

The one other caller that breaks is `updateSectionAction` in `src/app/(app)/design/engagements/spec/actions.ts:165-172`: it types `part1?: string; part3?: string` and passes them straight to `updateSection`, which now wants `SpecArticle[]`, so tsc fails. It has **no callers** (`grep -rn updateSectionAction src` finds only its definition — Task 8's new action gets a distinct name). Keep its string-typed signature and convert at the boundary, so a legacy string still lands as one untitled article:

```ts
import { toArticles } from "@/lib/specs/sections";
// …
export async function updateSectionAction(
  id: string,
  patch: { number?: string; title?: string; sort?: number; part1?: string; part3?: string }
): Promise<Result> {
  const user = await requireUser();
  const { part1, part3, ...rest } = patch;
  await updateSection(
    id,
    {
      ...rest,
      ...(part1 !== undefined ? { part1: toArticles(part1) } : {}),
      ...(part3 !== undefined ? { part3: toArticles(part3) } : {}),
    },
    user.name
  );
  revalidatePath("/", "layout");
  return { ok: true };
}
```

(Deleting it would also compile; converting keeps the D94 file's public surface unchanged, which is the smaller diff.) Its `requireUser()` gate stays — see Global Constraints.

- [ ] **Step 6: Run the tests and typecheck**

```bash
npm run test:specs
npx tsc --noEmit -p .
```
Expected: `ALL PASSED` including every new `sections:` line, and tsc exit 0. The pre-existing `/* --- assembly --- */` block must still pass — if its fixture builds a section with string parts, it is exercising exactly the legacy path this task added, so leave it as it is.

- [ ] **Step 7: Commit**

```bash
git add src/lib/specs/sections.ts src/lib/stores/spec-sections.ts src/lib/bid-spec.ts "src/app/(app)/design/engagements/spec/actions.ts" scripts/test-review-and-spec.ts
git commit -m "feat(specs): sections carry titled Part 1/Part 3 articles, a Part 2 style and a quantities policy"
```

---

### Task 4: Category articles — store and resolution

**Files:**
- Create: `src/lib/specs/articles.ts` (pure)
- Create: `src/lib/stores/spec-articles.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `SpecSection` from `@/lib/specs/sections` (Task 3).
- Produces:
  ```ts
  // src/lib/specs/articles.ts — PURE
  export type SpecCategoryArticle = {
    id: string; sectionId: string; sort: number; title: string;
    manufacturers: string[]; general: string; categoryKeys: string[];
    updatedAt: number; updatedBy: string;
  };
  export type PartSpecState = "authored" | "same-as" | "draft" | "missing";
  export type SameAsResult = { target: SpecPartLike | null; error: string | null };
  export type SpecPartLike = {
    sku: string; category?: string;
    specArticleId?: string; specSectionId?: string; specBody?: string;
    specSameAs?: string; specState?: "authored" | "draft";
  };
  export function normalizeCategoryKey(key: string): string;
  export function normalizeArticle(raw: unknown): SpecCategoryArticle;
  export function articleIdForPart(part, articles, sections): string | null;
  export function resolveSameAs(part, bySku): SameAsResult;
  export function specStateOf(part, bySku): PartSpecState;
  // src/lib/stores/spec-articles.ts
  export async function allArticles(): Promise<SpecCategoryArticle[]>;
  export async function getArticle(id: string): Promise<SpecCategoryArticle | null>;
  export async function articlesForSection(sectionId: string): Promise<SpecCategoryArticle[]>;
  export async function createArticle(input, by): Promise<SpecCategoryArticle>;
  export async function updateArticle(id, patch, by): Promise<void>;
  export async function deleteArticle(id: string): Promise<void>;
  ```

- [ ] **Step 1: Write the failing tests**

Import in the harness:
```ts
import {
  normalizeCategoryKey, normalizeArticle, articleIdForPart, resolveSameAs, specStateOf,
  type SpecCategoryArticle, type SpecPartLike,
} from "@/lib/specs/articles";
```

Append:

```ts
/* --- specs: category articles --- */
{
  const arts: SpecCategoryArticle[] = [
    { id: "ar-drapes", sectionId: "ss-1", sort: 10, title: "Theatrical Stage Drapes", manufacturers: ["Rose Brand"], general: "A. General", categoryKeys: ["Curtains", "Soft Goods"], updatedAt: 1, updatedBy: "Jeff" },
    { id: "ar-hoists", sectionId: "ss-1", sort: 20, title: "Packaged Hoists", manufacturers: [], general: "", categoryKeys: ["Rigging"], updatedAt: 1, updatedBy: "Jeff" },
    { id: "ar-fix", sectionId: "ss-2", sort: 10, title: "Fixtures", manufacturers: ["ETC"], general: "", categoryKeys: ["Fixtures"], updatedAt: 1, updatedBy: "Jeff" },
  ];
  const sections = [
    { id: "ss-1", number: "11 61 43", title: "Curtains", sort: 10, part1: [], part3: [], part2Style: "paragraphs" as const, quantities: "drawings" as const, updatedAt: 1, updatedBy: "Jeff" },
    { id: "ss-2", number: "26 55 61", title: "Fixtures", sort: 20, part1: [], part3: [], part2Style: "paragraphs" as const, quantities: "drawings" as const, updatedAt: 1, updatedBy: "Jeff" },
  ];

  ok(normalizeCategoryKey("  Soft   Goods ") === "soft goods", "articles: category keys normalize case and whitespace");

  ok(articleIdForPart({ sku: "A", specArticleId: "ar-hoists" }, arts, sections) === "ar-hoists", "articles: an explicit article wins");
  ok(articleIdForPart({ sku: "A", specArticleId: "ar-gone" }, arts, sections) === null, "articles: an explicit article that no longer exists resolves to nothing");
  ok(articleIdForPart({ sku: "B", category: "soft goods" }, arts, sections) === "ar-drapes", "articles: the category default is case-insensitive");
  ok(articleIdForPart({ sku: "C", category: "Nothing" }, arts, sections) === null, "articles: an unmapped category has no default");
  ok(articleIdForPart({ sku: "D", specSectionId: "ss-1" }, arts, sections) === "ar-drapes", "articles: a legacy specSectionId resolves to that section's first article");
  ok(articleIdForPart({ sku: "E", specSectionId: "ss-gone" }, arts, sections) === null, "articles: a legacy pointer to a missing section resolves to nothing");
  ok(
    articleIdForPart({ sku: "F", specArticleId: "ar-fix", category: "Curtains" }, arts, sections) === "ar-fix",
    "articles: an explicit article beats the category default"
  );

  const bySku = new Map<string, SpecPartLike>([
    ["BASE", { sku: "BASE", specBody: "Body.", specState: "authored" }],
    ["PTR", { sku: "PTR", specSameAs: "BASE" }],
    ["CHAIN", { sku: "CHAIN", specSameAs: "PTR" }],
    ["LOOP", { sku: "LOOP", specSameAs: "LOOP" }],
    ["GONE", { sku: "GONE", specSameAs: "NOPE" }],
    ["DRAFT", { sku: "DRAFT", specBody: "Body.", specState: "draft" }],
    ["BLANK", { sku: "BLANK" }],
    ["LEGACY", { sku: "LEGACY", specBody: "Body." }],
  ]);

  ok(resolveSameAs(bySku.get("PTR")!, bySku).target?.sku === "BASE", "articles: same-as resolves one hop");
  ok(resolveSameAs(bySku.get("PTR")!, bySku).error === null, "articles: a good same-as has no error");
  ok((resolveSameAs(bySku.get("CHAIN")!, bySku).error || "").includes("PTR"), "articles: a same-as chain is an error naming the target");
  ok(resolveSameAs(bySku.get("CHAIN")!, bySku).target === null, "articles: a chain resolves to nothing");
  ok((resolveSameAs(bySku.get("LOOP")!, bySku).error || "").includes("LOOP"), "articles: a same-as cycle is an error");
  ok((resolveSameAs(bySku.get("GONE")!, bySku).error || "").includes("NOPE"), "articles: a same-as to a missing SKU names it");
  ok(resolveSameAs(bySku.get("BASE")!, bySku).target === null && resolveSameAs(bySku.get("BASE")!, bySku).error === null, "articles: a part with no same-as is neither a target nor an error");

  ok(specStateOf(bySku.get("BASE")!, bySku) === "authored", "articles: authored body is authored");
  ok(specStateOf(bySku.get("LEGACY")!, bySku) === "authored", "articles: a D94 body with no specState counts as authored");
  ok(specStateOf(bySku.get("DRAFT")!, bySku) === "draft", "articles: a draft body is draft, never authored");
  ok(specStateOf(bySku.get("PTR")!, bySku) === "same-as", "articles: a resolved pointer is same-as");
  ok(specStateOf(bySku.get("CHAIN")!, bySku) === "missing", "articles: a chain is missing");
  ok(specStateOf(bySku.get("BLANK")!, bySku) === "missing", "articles: no body is missing");

  const junk = normalizeArticle({ id: "ar-x", sectionId: "ss-1", title: " Drapes ", manufacturers: ["Rose Brand", "", "Rose Brand"], categoryKeys: [" Curtains ", "curtains"] });
  ok(junk.title === "Drapes", "articles: normalize trims the title");
  ok(junk.manufacturers.length === 1, "articles: normalize drops blank and duplicate manufacturers");
  ok(junk.categoryKeys.length === 1 && junk.categoryKeys[0] === "Curtains", "articles: normalize keeps one spelling per normalized category key");
  ok(junk.sort === 0 && junk.general === "", "articles: normalize defaults sort and general");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:specs` — aborts with `Cannot find module '@/lib/specs/articles'`.

- [ ] **Step 3: Write the pure module**

Create `src/lib/specs/articles.ts`:

```ts
import type { SpecSection } from "@/lib/specs/sections";

/**
 * Part 2 category articles (D-SPEC) — "2.1 Stage Drapes", "2.3 Packaged Hoists".
 * Each opens with an "A. General" clause carrying the acceptable-manufacturers
 * list, then the products that landed in the BOM print as B., C., D…
 *
 * Pure: the resolution rules run in the part editor's live preview (a client
 * component) and in Phase B's server-side assembly, and they must agree.
 */

export type SpecCategoryArticle = {
  id: string;
  sectionId: string;
  sort: number;
  /** e.g. "Theatrical Stage Drapes". */
  title: string;
  /** Acceptable manufacturers, in order. Feeds {{manufacturers}}. */
  manufacturers: string[];
  /** The "A. General" outline. May use {{manufacturers}}. */
  general: string;
  /** Catalog categories that default into this article. */
  categoryKeys: string[];
  updatedAt: number;
  updatedBy: string;
};

/** The subset of a catalog part the spec rules actually read. */
export type SpecPartLike = {
  sku: string;
  category?: string;
  specArticleId?: string;
  /** D94's pointer, still on older parts. */
  specSectionId?: string;
  specBody?: string;
  specSameAs?: string;
  specState?: "authored" | "draft";
};

export type PartSpecState = "authored" | "same-as" | "draft" | "missing";
export type SameAsResult = { target: SpecPartLike | null; error: string | null };

export function normalizeCategoryKey(key: string): string {
  return String(key || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeArticle(raw: unknown): SpecCategoryArticle {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x || "").trim()).filter(Boolean) : [];

  const seenMfr = new Set<string>();
  const manufacturers: string[] = [];
  for (const m of strings(o.manufacturers)) {
    const k = m.toLowerCase();
    if (seenMfr.has(k)) continue;
    seenMfr.add(k);
    manufacturers.push(m);
  }

  // One spelling per normalized key — "Curtains" and "curtains" are one
  // mapping, and keeping both would make the category default ambiguous.
  const seenKey = new Set<string>();
  const categoryKeys: string[] = [];
  for (const c of strings(o.categoryKeys)) {
    const k = normalizeCategoryKey(c);
    if (!k || seenKey.has(k)) continue;
    seenKey.add(k);
    categoryKeys.push(c);
  }

  return {
    id: String(o.id || ""),
    sectionId: String(o.sectionId || ""),
    sort: Number(o.sort) || 0,
    title: String(o.title || "").trim(),
    manufacturers,
    general: typeof o.general === "string" ? o.general : "",
    categoryKeys,
    updatedAt: Number(o.updatedAt) || 0,
    updatedBy: String(o.updatedBy || ""),
  };
}

/**
 * Which article a part belongs under. Explicit pointer, then the category
 * default, then D94's section pointer resolved to that section's first
 * article. Returns null when nothing resolves — a pre-placement only; the part
 * is still "no spec" until text exists.
 */
export function articleIdForPart(
  part: SpecPartLike,
  articles: SpecCategoryArticle[],
  sections: SpecSection[]
): string | null {
  if (part.specArticleId) {
    return articles.some((a) => a.id === part.specArticleId) ? part.specArticleId : null;
  }
  const key = normalizeCategoryKey(part.category || "");
  if (key) {
    const hit = [...articles]
      .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title))
      .find((a) => a.categoryKeys.some((c) => normalizeCategoryKey(c) === key));
    if (hit) return hit.id;
  }
  if (part.specSectionId && sections.some((s) => s.id === part.specSectionId)) {
    const first = articles
      .filter((a) => a.sectionId === part.specSectionId)
      .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title))[0];
    if (first) return first.id;
  }
  return null;
}

/**
 * `specSameAs` resolves ONE hop. A chain or a cycle is an error, and the
 * pointing part reports "no spec" naming the target — following chains would
 * make a spec's provenance unknowable from the part alone.
 */
export function resolveSameAs(part: SpecPartLike, bySku: Map<string, SpecPartLike>): SameAsResult {
  const want = (part.specSameAs || "").trim();
  if (!want) return { target: null, error: null };
  if (want.toUpperCase() === part.sku.toUpperCase()) {
    return { target: null, error: `${part.sku} points its spec at itself.` };
  }
  const target = bySku.get(want) || bySku.get(want.toUpperCase()) || null;
  if (!target) return { target: null, error: `Same spec as ${want} — no such part.` };
  if ((target.specSameAs || "").trim()) {
    return { target: null, error: `Same spec as ${target.sku}, which is itself a "same spec as" pointer.` };
  }
  return { target, error: null };
}

export function specStateOf(part: SpecPartLike, bySku: Map<string, SpecPartLike>): PartSpecState {
  if ((part.specSameAs || "").trim()) {
    const { target, error } = resolveSameAs(part, bySku);
    if (error || !target) return "missing";
    return specStateOf(target, bySku) === "authored" ? "same-as" : "missing";
  }
  if (!(part.specBody || "").trim()) return "missing";
  return part.specState === "draft" ? "draft" : "authored";
}
```

Note the recursion in `specStateOf` terminates: `resolveSameAs` returns a target only when that target has no `specSameAs` of its own, so the recursive call always takes the non-pointer branch.

- [ ] **Step 4: Write the store**

`listDocs` / `getDoc` are declared `<T extends Doc = Doc>` (`src/db/doc-store.ts:24`, `:32`, `:71`), so `<unknown>` does not compile — read as `Doc` and let `normalizeArticle` shape it. The same applies to both stores in Task 5.

Create `src/lib/stores/spec-articles.ts`:

```ts
import { getDoc, listDocs, patchDoc, softDeleteDoc, upsertDoc, type Doc } from "@/db/doc-store";
import { normalizeArticle, type SpecCategoryArticle } from "@/lib/specs/articles";

export type { SpecCategoryArticle };

function uid(): string {
  return "ar-" + Math.random().toString(36).slice(2, 10);
}

export async function allArticles(): Promise<SpecCategoryArticle[]> {
  const list = await listDocs<Doc>("spec_articles");
  return list
    .map(normalizeArticle)
    .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
}

export async function getArticle(id: string): Promise<SpecCategoryArticle | null> {
  const raw = await getDoc<Doc>("spec_articles", id);
  return raw ? normalizeArticle(raw) : null;
}

export async function articlesForSection(sectionId: string): Promise<SpecCategoryArticle[]> {
  return (await allArticles()).filter((a) => a.sectionId === sectionId);
}

export async function createArticle(
  input: Partial<Omit<SpecCategoryArticle, "id" | "updatedAt" | "updatedBy">> & { sectionId: string; title: string },
  by: string
): Promise<SpecCategoryArticle> {
  const rec = normalizeArticle({ ...input, id: uid(), updatedAt: Date.now(), updatedBy: by });
  await upsertDoc<SpecCategoryArticle>("spec_articles", rec);
  return rec;
}

export async function updateArticle(
  id: string,
  patch: Partial<Omit<SpecCategoryArticle, "id">>,
  by: string
): Promise<void> {
  await patchDoc<SpecCategoryArticle>("spec_articles", id, (d) => {
    const next = normalizeArticle({ ...d, ...patch, id });
    next.updatedAt = Date.now();
    next.updatedBy = by;
    return next;
  });
}

export async function deleteArticle(id: string): Promise<void> {
  await softDeleteDoc("spec_articles", id);
}
```

- [ ] **Step 5: Run the tests, typecheck, commit**

```bash
npm run test:specs
npx tsc --noEmit -p .
git add src/lib/specs/articles.ts src/lib/stores/spec-articles.ts scripts/test-review-and-spec.ts
git commit -m "feat(specs): Part 2 category articles — store plus explicit/category/legacy resolution and same-as rules"
```

---

### Task 5: Templates and curtain templates — the formulas

**Files:**
- Create: `src/lib/stores/spec-templates.ts`
- Create: `src/lib/stores/spec-curtain-templates.ts`
- Modify: `src/db/seed-data.ts`
- Test: `scripts/test-review-and-spec.ts` and `scripts/test-review-regressions.ts`

**Interfaces:**
- Consumes: the collections from Task 2.
- Produces:
  ```ts
  export type SpecTemplateHeading = { label: string; guidance: string };
  export type SpecTemplate = {
    id: string; key: string; title: string;
    headings: SpecTemplateHeading[]; rules: string; example: string;
    updatedAt: number; updatedBy: string;
  };
  export function templateId(key: string): string;      // slug — also the /templates/[key] segment
  export function scaffoldFrom(t: SpecTemplate): string; // headings → an empty numbered body
  export async function allTemplates(): Promise<SpecTemplate[]>;
  export async function getTemplate(id: string): Promise<SpecTemplate | null>;
  export async function saveTemplate(input, by): Promise<SpecTemplate>;
  export async function deleteTemplate(id: string): Promise<void>;
  export async function seedStarterTemplates(by?: string): Promise<number>;  // idempotent, by key
  export async function ensureStarterTemplates(by?: string): Promise<number>; // seeds formulas/curtain templates only when that collection is EMPTY
  export const STARTER_TEMPLATES: Array<Omit<SpecTemplate, "id" | "updatedAt" | "updatedBy">>;

  export type SpecCurtainTemplate = {
    id: GridCurtainType; articleId: string; sort: number; title: string;
    body: string; fullnessClauses: Record<"0" | "50" | "75" | "100", string>;
    hang: string; defaultColor: string; updatedAt: number; updatedBy: string;
  };
  export async function allCurtainTemplates(): Promise<SpecCurtainTemplate[]>;
  export async function getCurtainTemplate(type: GridCurtainType): Promise<SpecCurtainTemplate | null>;
  export async function saveCurtainTemplate(input, by): Promise<SpecCurtainTemplate>;
  export async function seedStarterCurtainTemplates(by?: string): Promise<number>;
  ```

- [ ] **Step 1: Write the failing tests**

In `scripts/test-review-and-spec.ts` (pure assertions only — these two touch no database):

```ts
import { STARTER_TEMPLATES, templateId, scaffoldFrom } from "@/lib/stores/spec-templates";
```
```ts
/* --- specs: templates --- */
{
  ok(templateId("Lighting Controls") === "lighting-controls", "templates: the id is a slug of the key");
  ok(templateId("  AV / Comms  ") === "av-comms", "templates: slugs collapse punctuation and whitespace");
  ok(STARTER_TEMPLATES.length >= 5, "templates: at least five starter formulas ship");
  ok(new Set(STARTER_TEMPLATES.map((t) => templateId(t.key))).size === STARTER_TEMPLATES.length, "templates: starter keys are unique");
  ok(STARTER_TEMPLATES.every((t) => t.headings.length > 0), "templates: every starter has headings");
  ok(STARTER_TEMPLATES.every((t) => t.headings.every((h) => h.label && h.guidance)), "templates: every heading carries guidance");
  ok(STARTER_TEMPLATES.every((t) => t.example === ""), "templates: starters ship without a worked example — the North HS seed supplies those");
  const fixtures = STARTER_TEMPLATES.find((t) => t.key === "Fixtures")!;
  ok(!!fixtures, "templates: a Fixtures formula ships");
  ok(fixtures.headings[0].label === "Basis of Design", "templates: a formula opens with Basis of Design");
  const scaffold = scaffoldFrom({ ...fixtures, id: "x", updatedAt: 0, updatedBy: "" });
  ok(scaffold.split("\n").length === fixtures.headings.length, "templates: the scaffold is one line per heading");
  ok(scaffold.startsWith("Basis of Design:"), "templates: the scaffold labels each line with its heading");
  ok(!scaffold.includes("  "), "templates: the scaffold is flat — the author indents what belongs deeper");
}
```

In `scripts/test-review-regressions.ts` (this one has a database — it boots PGlite on a scratch datadir):

```ts
/* --- specs: template + curtain-template stores --- */
{
  // getDb() awaits the dev auto-seed, which has ALREADY run
  // seedStarterTemplates() by the time this block executes — so the first
  // call here legitimately returns 0. Assert the end state, not the count.
  await SpecTemplates.seedStarterTemplates("Seed");
  const all = await SpecTemplates.allTemplates();
  const ids = new Set(all.map((t) => t.id));
  assert(
    SpecTemplates.STARTER_TEMPLATES.every((t) => ids.has(SpecTemplates.templateId(t.key))),
    "templates: after seeding, the collection holds every starter"
  );
  assert((await SpecTemplates.seedStarterTemplates("Seed")) === 0, "templates: seeding again writes nothing");
  assert((await SpecTemplates.ensureStarterTemplates("Seed")) === 0, "templates: ensure is a no-op on a collection that already holds formulas");

  await SpecTemplates.saveTemplate({ key: "Fixtures", title: "Lighting Fixture", headings: [{ label: "X", guidance: "Y" }], rules: "R", example: "E" }, "Jeff");
  const edited = await SpecTemplates.getTemplate(SpecTemplates.templateId("Fixtures"));
  assert(edited?.headings.length === 1 && edited.example === "E", "templates: saving by an existing key replaces that formula, not a duplicate");
  assert((await SpecTemplates.allTemplates()).length === all.length, "templates: saving an existing key adds no row");
  assert((await SpecTemplates.seedStarterTemplates("Seed")) === 0, "templates: re-seeding never overwrites an edited formula");

  await SpecCurtainTemplates.seedStarterCurtainTemplates("Seed");
  const curtainIds = new Set((await SpecCurtainTemplates.allCurtainTemplates()).map((t) => t.id));
  assert(["Border", "Leg", "Draw", "Full"].every((t) => curtainIds.has(t as never)), "curtain templates: one starter per Grid curtain type is present");
  const leg = await SpecCurtainTemplates.getCurtainTemplate("Leg");
  assert(!!leg && leg.id === "Leg", "curtain templates: the id is the curtain type");
  assert(!!leg && ["0", "50", "75", "100"].every((k) => !!leg.fullnessClauses[k as "0"]), "curtain templates: all four fullness clauses ship");
  assert(!!leg && leg.body.includes("{{material}}") && leg.body.includes("{{fullnessClause}}"), "curtain templates: the starter body carries its slots");
  assert((await SpecCurtainTemplates.seedStarterCurtainTemplates("Seed")) === 0, "curtain templates: seeding twice writes nothing");
}
```

`scripts/test-review-regressions.ts` has no namespace imports and pulls store modules in **inside** the block with a dynamic import (e.g. `:795` `const { get: getPart, mergeUpsert } = await import("@/lib/stores/catalog");`). Open the block the same way:

```ts
  const SpecTemplates = await import("@/lib/stores/spec-templates");
  const SpecCurtainTemplates = await import("@/lib/stores/spec-curtain-templates");
```

The harness's `assert` is `node:assert/strict`'s default export, which is callable as `assert(cond, msg)`.

- [ ] **Step 2: Run both to verify they fail**

```bash
npm run test:specs
PGLITE_PATH=$(mktemp -d) npx tsx scripts/test-review-regressions.ts
```
Expected: both abort on the missing modules. Check `ps aux | grep tsx` afterwards and kill anything still alive.

- [ ] **Step 3: Write the template store**

Create `src/lib/stores/spec-templates.ts`:

```ts
import { getDoc, listDocs, upsertDoc, softDeleteDoc, type Doc } from "@/db/doc-store";

/**
 * Authoring formulas (D-SPEC). A template is not spec text — it is the shape of
 * a spec entry for one kind of product: which headings to write, what to pull
 * from the cut sheet for each, and the phrasing rules. "Insert template" in
 * the part editor writes the headings as a scaffold into an empty body, and
 * `Export templates` writes this collection to the JSON file the spec-writer
 * skill reads. No template text ever prints in a document.
 */

export type SpecTemplateHeading = { label: string; guidance: string };

export type SpecTemplate = {
  /** Slug of `key` — also the /design/specs/templates/[key] segment. */
  id: string;
  /** Display key the author matches a part against, e.g. "Fixtures". */
  key: string;
  title: string;
  headings: SpecTemplateHeading[];
  /** Phrasing rules: "shall", basis-of-design clause, listings first… */
  rules: string;
  /** One worked entry in outline text. Empty on the starters. */
  example: string;
  updatedAt: number;
  updatedBy: string;
};

export function templateId(key: string): string {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Headings → an empty scaffold the author fills in. Flat on purpose: the
 *  author indents whatever belongs deeper. */
export function scaffoldFrom(t: Pick<SpecTemplate, "headings">): string {
  return t.headings.map((h) => `${h.label}:`).join("\n");
}

function normalize(raw: unknown): SpecTemplate {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const headings = Array.isArray(o.headings)
    ? o.headings
        .map((h) => {
          const x = (h && typeof h === "object" ? h : {}) as Record<string, unknown>;
          return { label: String(x.label || "").trim(), guidance: String(x.guidance || "").trim() };
        })
        .filter((h) => h.label)
    : [];
  const key = String(o.key || "").trim();
  return {
    id: String(o.id || "") || templateId(key),
    key,
    title: String(o.title || "").trim(),
    headings,
    rules: typeof o.rules === "string" ? o.rules : "",
    example: typeof o.example === "string" ? o.example : "",
    updatedAt: Number(o.updatedAt) || 0,
    updatedBy: String(o.updatedBy || ""),
  };
}

export const STARTER_TEMPLATES: Array<Omit<SpecTemplate, "id" | "updatedAt" | "updatedBy">> = [
  {
    key: "Fixtures",
    title: "Lighting Fixture",
    headings: [
      { label: "Basis of Design", guidance: "Manufacturer and model exactly as the cut sheet names them." },
      { label: "Standards Compliance", guidance: "Listings and standards the sheet claims — UL/ETL, IP rating, photobiological safety." },
      { label: "Source", guidance: "Emitter type and count, rated life, lumen output and field angle range." },
      { label: "Color", guidance: "Colour system, CCT range, CRI/TM-30 figures, and the colour-mixing engine." },
      { label: "Control", guidance: "Protocols (DMX512-A, RDM, sACN, Art-Net), dimming curves, resolution, onboard UI." },
      { label: "Electrical", guidance: "Input voltage range, power draw at full, connector type, power-through limits." },
      { label: "Physical", guidance: "Weight, yoke and clamp arrangement, accessory slot size, finish." },
      { label: "Accessories", guidance: "Only what is being purchased with the fixture; everything else belongs on its own line." },
    ],
    rules: "Every clause is a requirement: use \"shall\". Name the basis of design first, then the standards it must meet, then performance. Never print a price, a quantity or a lead time. If the cut sheet does not answer a heading, leave a [VERIFY: …] line rather than guessing.",
    example: "",
  },
  {
    key: "Lighting Controls",
    title: "Lighting Control Console or Processor",
    headings: [
      { label: "Basis of Design", guidance: "Manufacturer and model; note the software version if the sheet pins one." },
      { label: "Standards Compliance", guidance: "Listings, and the control standards implemented." },
      { label: "Capacity", guidance: "Parameter/universe count, playback count, cue and show storage." },
      { label: "Control Protocols", guidance: "DMX512-A, sACN, Art-Net, RDM, OSC, contact closures, network topology." },
      { label: "User Interface", guidance: "Faders, encoders, touchscreens, external display support." },
      { label: "Electrical", guidance: "Supply, UPS expectations, connector types." },
      { label: "Accessories", guidance: "Wings, remotes, racks, licences bought with the unit." },
    ],
    rules: "Same voice as fixtures. Describe capability, not configuration — the show file is not a spec.",
    example: "",
  },
  {
    key: "Hoists",
    title: "Packaged Hoist",
    headings: [
      { label: "Basis of Design", guidance: "Manufacturer and model." },
      { label: "Standards Compliance", guidance: "ANSI E1.6 series, ASME, UL listings, and the AHJ requirements the sheet claims." },
      { label: "Capacity and Travel", guidance: "Working load, batten length served, travel, speed." },
      { label: "Machine", guidance: "Motor, gearbox, brake arrangement (including the secondary brake), drum or chain type." },
      { label: "Control", guidance: "Controller family, position feedback, limits, E-stop chain." },
      { label: "Safety", guidance: "Overload sensing, slack-line detection, secondary brake test, load-cell monitoring." },
      { label: "Finish", guidance: "Paint or plating and the colour." },
    ],
    rules: "Safety clauses are requirements, never options. Cite the standard by number.",
    example: "",
  },
  {
    key: "Rigging Hardware",
    title: "Rigging Hardware",
    headings: [
      { label: "Basis of Design", guidance: "Manufacturer and model or part number." },
      { label: "Standards Compliance", guidance: "ANSI E1.x, ASME B30, and any listing the sheet claims." },
      { label: "Material and Finish", guidance: "Alloy, plating or paint, and corrosion requirements." },
      { label: "Working Load", guidance: "Working load limit and design factor as stated by the manufacturer." },
      { label: "Fabrication", guidance: "Welds, swages, and what must be shop-assembled rather than field-made." },
    ],
    rules: "Never state a working load the cut sheet does not. Design factor belongs beside the load.",
    example: "",
  },
  {
    key: "Speakers",
    title: "Loudspeaker",
    headings: [
      { label: "Basis of Design", guidance: "Manufacturer and model." },
      { label: "Standards Compliance", guidance: "Listings, and the suspension standard where the sheet claims one." },
      { label: "Transducers", guidance: "Driver complement, sizes, voice-coil diameters." },
      { label: "Performance", guidance: "Frequency range, sensitivity, maximum SPL, nominal coverage, impedance or amplifier pairing." },
      { label: "Rigging and Mounting", guidance: "Integral rigging, bracket options, safety requirements." },
      { label: "Connections", guidance: "Connector type and count, passive/bi-amp wiring." },
      { label: "Finish", guidance: "Enclosure material, grille, colour options." },
    ],
    rules: "Quote performance figures only as the sheet measures them; name the measurement condition when the sheet does.",
    example: "",
  },
  {
    key: "Soft Goods",
    title: "Soft Goods",
    headings: [
      { label: "Basis of Design", guidance: "Fabric by name and weight; the fabricator where the project names one." },
      { label: "Material", guidance: "Fibre, weight in ounces, weave, and the flame-retardant treatment or inherent rating." },
      { label: "Color", guidance: "Colour by the mill's name; say when it is to be selected." },
      { label: "Fabrication", guidance: "Fullness, seams, hems, lining, chain pocket or sandbag pockets, webbing and grommets." },
      { label: "Hang Method", guidance: "Tie lines, snap hooks, carriers, or velcro — and their spacing." },
    ],
    rules: "Flame-retardant compliance is NFPA 701; say which test and whether the treatment is inherent or applied. Curtains dropped in The Grid use their own curtain templates — this formula is for everything else sewn.",
    example: "",
  },
];

export async function allTemplates(): Promise<SpecTemplate[]> {
  const list = await listDocs<Doc>("spec_templates");
  return list.map(normalize).sort((a, b) => a.key.localeCompare(b.key));
}

export async function getTemplate(id: string): Promise<SpecTemplate | null> {
  const raw = await getDoc<Doc>("spec_templates", id);
  return raw ? normalize(raw) : null;
}

export async function saveTemplate(
  input: Omit<SpecTemplate, "id" | "updatedAt" | "updatedBy">,
  by: string
): Promise<SpecTemplate> {
  const rec = normalize({ ...input, id: templateId(input.key), updatedAt: Date.now(), updatedBy: by });
  if (!rec.id) throw new Error("A template needs a key.");
  await upsertDoc<SpecTemplate>("spec_templates", rec);
  return rec;
}

export async function deleteTemplate(id: string): Promise<void> {
  await softDeleteDoc("spec_templates", id);
}

/**
 * Idempotent by key — never overwrites a formula someone edited. Called from
 * `seedIfEmpty()` regardless of the demo-data flag, because the go-live reset
 * wipes every doc collection (`DEMO_COLLECTIONS` is `Object.keys(DOC_TABLES)`)
 * and the formulas are configuration, not demo data.
 */
export async function seedStarterTemplates(by = "Peak"): Promise<number> {
  const have = new Set((await allTemplates()).map((t) => t.id));
  let made = 0;
  for (const t of STARTER_TEMPLATES) {
    if (have.has(templateId(t.key))) continue;
    await saveTemplate(t, by);
    made++;
  }
  return made;
}

/**
 * Owner decision (2026-09-25): the formulas auto-seed when empty on ANY
 * environment — `seedIfEmpty()` only runs on local dev, and a hosted database
 * (or one after a go-live reset) would otherwise show an empty Templates
 * screen and an empty "Insert template" row. Seeds a collection only when it
 * holds no live record at all, so deleting one formula does not bring it
 * back; deleting every formula does (the Restore button is the explicit path).
 * Called from read paths (server components), so it must not call
 * revalidatePath. Cheap on the hot path: one listDocs per collection.
 */
export async function ensureStarterTemplates(by = "Peak"): Promise<number> {
  const { allCurtainTemplates, seedStarterCurtainTemplates } = await import("@/lib/stores/spec-curtain-templates");
  let made = 0;
  if ((await allTemplates()).length === 0) made += await seedStarterTemplates(by);
  if ((await allCurtainTemplates()).length === 0) made += await seedStarterCurtainTemplates(by);
  return made;
}
```

- [ ] **Step 4: Write the curtain-template store**

Create `src/lib/stores/spec-curtain-templates.ts`:

```ts
import { getDoc, listDocs, upsertDoc, type Doc } from "@/db/doc-store";
import { GRID_CURTAIN_TYPES, type GridCurtainType } from "@/lib/design/grid-bom";

/**
 * One template per Grid curtain type (D-SPEC). The Grid mints SKU "CURTAIN" for
 * every curtain, so a curtain row can never match a catalog part — it resolves
 * to its type's template instead, and the placement's own configuration fills
 * the slots. The specimen's seven drape entries collapse into these four types
 * plus fabric: a valance is a Border in velour, a scrim or cyclorama is a Full
 * drop in scrim or muslin.
 */

export type CurtainFullnessKey = "0" | "50" | "75" | "100";

export type SpecCurtainTemplate = {
  id: GridCurtainType;
  /** The Part 2 article these entries print under. */
  articleId: string;
  sort: number;
  title: string;
  /** Outline text with {{name}} {{material}} {{color}} {{fullness}}
   *  {{fullnessClause}} {{hang}} {{width}} {{height}} slots. */
  body: string;
  fullnessClauses: Record<CurtainFullnessKey, string>;
  hang: string;
  defaultColor: string;
  updatedAt: number;
  updatedBy: string;
};

const FULLNESS_KEYS: CurtainFullnessKey[] = ["0", "50", "75", "100"];

function normalize(raw: unknown): SpecCurtainTemplate {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const src = (o.fullnessClauses && typeof o.fullnessClauses === "object"
    ? o.fullnessClauses
    : {}) as Record<string, unknown>;
  const fullnessClauses = {} as Record<CurtainFullnessKey, string>;
  for (const k of FULLNESS_KEYS) fullnessClauses[k] = String(src[k] || "").trim();
  const id = GRID_CURTAIN_TYPES.includes(o.id as GridCurtainType)
    ? (o.id as GridCurtainType)
    : GRID_CURTAIN_TYPES[0];
  return {
    id,
    articleId: String(o.articleId || ""),
    sort: Number(o.sort) || 0,
    title: String(o.title || "").trim(),
    body: typeof o.body === "string" ? o.body : "",
    fullnessClauses,
    hang: String(o.hang || "").trim(),
    defaultColor: String(o.defaultColor || "").trim(),
    updatedAt: Number(o.updatedAt) || 0,
    updatedBy: String(o.updatedBy || ""),
  };
}

const BODY = [
  "Basis of Design: {{name}}",
  "  Material: {{material}}",
  "  Color: {{color}}",
  "  Size: {{width}} feet wide by {{height}} feet high, finished.",
  "  Fabrication: {{fullnessClause}}",
  "  Hang Method: {{hang}}",
].join("\n");

const CLAUSES: Record<CurtainFullnessKey, string> = {
  "0": "Flat, seamed and hemmed without fullness.",
  "50": "Sewn to 50 percent fullness, with vertical seams sewn flat and interlocked.",
  "75": "Sewn to 75 percent fullness, with vertical seams sewn flat and interlocked.",
  "100": "Sewn to 100 percent fullness, with vertical seams sewn flat and interlocked.",
};

export const STARTER_CURTAIN_TEMPLATES: Array<Omit<SpecCurtainTemplate, "updatedAt" | "updatedBy">> = [
  { id: "Border", articleId: "", sort: 10, title: "Borders", body: BODY, fullnessClauses: CLAUSES, hang: "Webbing and grommets on 12 inch centers along the top edge, with tie lines at each grommet.", defaultColor: "Black unless noted otherwise" },
  { id: "Leg", articleId: "", sort: 20, title: "Legs", body: BODY, fullnessClauses: CLAUSES, hang: "Webbing and grommets on 12 inch centers along the top edge, with tie lines at each grommet.", defaultColor: "Black unless noted otherwise" },
  { id: "Draw", articleId: "", sort: 30, title: "Draw Curtains", body: BODY, fullnessClauses: CLAUSES, hang: "Webbing and grommets on 12 inch centers, hung from carriers on the track specified in this section, with an overlap arm at the center.", defaultColor: "Black unless noted otherwise" },
  { id: "Full", articleId: "", sort: 40, title: "Full Stage Drops", body: BODY, fullnessClauses: CLAUSES, hang: "Webbing and grommets on 12 inch centers along the top edge, with a chain pocket along the bottom hem.", defaultColor: "Black unless noted otherwise" },
];

export async function allCurtainTemplates(): Promise<SpecCurtainTemplate[]> {
  const list = await listDocs<Doc>("spec_curtain_templates");
  return list.map(normalize).sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
}

export async function getCurtainTemplate(type: GridCurtainType): Promise<SpecCurtainTemplate | null> {
  const raw = await getDoc<Doc>("spec_curtain_templates", type);
  return raw ? normalize(raw) : null;
}

export async function saveCurtainTemplate(
  input: Omit<SpecCurtainTemplate, "updatedAt" | "updatedBy">,
  by: string
): Promise<SpecCurtainTemplate> {
  const rec = normalize({ ...input, updatedAt: Date.now(), updatedBy: by });
  await upsertDoc<SpecCurtainTemplate>("spec_curtain_templates", rec);
  return rec;
}

/** Idempotent by curtain type. */
export async function seedStarterCurtainTemplates(by = "Peak"): Promise<number> {
  const have = new Set((await allCurtainTemplates()).map((t) => t.id));
  let made = 0;
  for (const t of STARTER_CURTAIN_TEMPLATES) {
    if (have.has(t.id)) continue;
    await saveCurtainTemplate(t, by);
    made++;
  }
  return made;
}
```

- [ ] **Step 5: Seed the formulas on every database**

In `src/db/seed-data.ts`, inside `seedIfEmpty(db)` and **after** the settings row is ensured, add — using the file's own dynamic-import idiom (see `:200`, `const { convertCustomersToIdentity } = await import("@/lib/identity/convert");`), not a top-of-file import: the store modules import `@/db/doc-store` → `@/db`, and `@/db` (`src/db/index.ts:90`) loads this file lazily on open, so a static import would pull the stores into module init:

```ts
  // The starter formulas are configuration, not demo data: DEMO_COLLECTIONS is
  // Object.keys(DOC_TABLES), so the go-live reset wipes spec_templates too.
  // Both seeds are idempotent by key, so this is safe on every open.
  const { seedStarterTemplates } = await import("@/lib/stores/spec-templates");
  const { seedStarterCurtainTemplates } = await import("@/lib/stores/spec-curtain-templates");
  await seedStarterTemplates();
  await seedStarterCurtainTemplates();
```
Do **not** add either collection to `DEMO_SEEDS` — that array only runs when demo data is on. This dev hook stays; hosted environments get their formulas from `ensureStarterTemplates()`, which Task 10 (Templates screen), Task 11 (`exportLibrary`) and Task 13 (catalog page load) call.

- [ ] **Step 6: Run both harnesses, typecheck, commit**

```bash
npm run test:specs
PGLITE_PATH=$(mktemp -d) npx tsx scripts/test-review-regressions.ts
npx tsc --noEmit -p .
ps aux | grep tsx   # must be empty
git add src/lib/stores/spec-templates.ts src/lib/stores/spec-curtain-templates.ts src/db/seed-data.ts scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
git commit -m "feat(specs): authoring formulas and per-type curtain templates, seeded outside the demo flag"
```

---

### Task 6: Catalog parts carry their spec language

**Files:**
- Modify: `src/lib/stores/catalog.ts` (the `CatalogPart` type only)
- Modify: `src/lib/specs/articles.ts` (`hasPrintableSpec`, the legacy-pointer resolvers, read-time adoption in `articleIdForPart`)
- Modify: `src/lib/bid-spec.ts` (`PartSpecFields` becomes a `Pick<>`; `matchBom` draft gate at `:99`)
- Create: `src/app/(app)/catalog/part-form.ts` (pure: `validateSameAs`, `optionalPartFields`)
- Modify: `src/app/(app)/catalog/actions.ts` (`upsertPart` at `:69-107` stops wiping unsubmitted fields; new `writePartSpecFieldsAction`)
- Modify: `src/app/(app)/catalog/page.tsx` (Manufacturer P/N + M/N inputs in `PartFormModal`)
- Create: `src/lib/specs/legacy-pointers.ts` (server — the one-shot adoption write)
- Modify: `src/app/(app)/design/engagements/spec/actions.ts` (draft gating at `:88`, `:97-111`, and in `saveSpecAction`)
- Modify: `src/lib/displays-api.ts` (`:71` and the metadata block), `src/app/api/v1/displays/specs/route.ts` (`:23`), `src/app/api/v1/displays/specs/[id]/route.ts` (`:16`), `src/app/api/v1/displays/catalog/route.ts`, `src/app/api/v1/displays/catalog/[sku]/route.ts`
- Modify: `src/lib/client-package.ts` (`:103`)
- Test: `scripts/test-review-and-spec.ts` (pure) and `scripts/test-review-regressions.ts` (database)

**Interfaces:**
- Consumes: `PartSpecState`, `articleIdForPart` and `normalizeCategoryKey` from Task 4.
- Produces:
  ```ts
  // CatalogPart gains the spec fields below — NO `model` (decision 8).
  // src/lib/specs/articles.ts — PURE additions
  export function hasPrintableSpec(p: { specBody?: string; specState?: "authored" | "draft" } | null | undefined): boolean;
  export type LegacySpecMetadata = { specSection?: string; specArticle?: string };
  export function csiKey(s: string): string;
  export function resolveSectionRef(ref: string | undefined, sections: SpecSection[]): string | null;
  export function resolveArticleRef(ref: string | undefined, articles: SpecCategoryArticle[], sectionId: string | null): string | null;
  export function adoptLegacySpecPointers(part: SpecPartLike, articles: SpecCategoryArticle[], sections: SpecSection[]): { specSectionId?: string; specArticleId?: string };
  // SpecPartLike gains `productMetadata?: LegacySpecMetadata`.
  // src/app/(app)/catalog/part-form.ts — PURE
  export function validateSameAs(sku: string, sameAs: string, target: { sku: string; specSameAs?: string } | null): string | null;
  export function optionalPartFields(fd: FormData): { manufacturerPartNumber?: string; manufacturerModelNumber?: string; mapPrice?: number };
  // src/lib/specs/legacy-pointers.ts — server
  export async function adoptAllLegacySpecPointers(): Promise<{ adopted: number; unresolved: number }>;
  // src/app/(app)/catalog/actions.ts
  export async function writePartSpecFieldsAction(input): Promise<Result>; // for Task 13's panel
  // src/lib/displays-api.ts
  export type SpecLookup = { sections: SpecSection[]; articles: SpecCategoryArticle[] };
  export function publicCatalogPart(part: CatalogPart & PartSpecFields, lib?: SpecLookup): …;
  ```

- [ ] **Step 1: Declare the fields**

In `src/lib/stores/catalog.ts`, add to the `CatalogPart` type (keep each field's comment — these are the only documentation an importer or a future reader gets):

```ts
  /* --- Specs module (D-SPEC). All additive JSONB, no migration. ---
   * These are the ONE canonical set (D-SPEC-5). productMetadata.specSection /
   * .specArticle (Displays API, 2e284665) are legacy free text, adopted into
   * specSectionId / specArticleId only when they resolve — see
   * adoptLegacySpecPointers in src/lib/specs/articles.ts. A table-style Part 2
   * prints manufacturerModelNumber → manufacturerPartNumber → sku as the
   * model; there is no separate model field (D-SPEC-8). */
  /** The Part 2 category article this part's entry prints under. Replaces
   *  D94's specSectionId as the placement pointer. */
  specArticleId?: string;
  /** D94's pointer. Still read as a fallback. Written only as a MIRROR of the
   *  effective article's section (so D94's assemble, which groups by it,
   *  keeps placing the part) and by legacy-pointer adoption. */
  specSectionId?: string;
  /** Generic name printed as the entry heading, e.g. "COLOR MIXING LIGHT
   *  EMITTING DIODE PROFILE FIXTURE". */
  specTitle?: string;
  /** Outline text — see src/lib/specs/outline.ts for the convention. */
  specBody?: string;
  /** SKU whose specTitle/specBody/specArticleId this part reuses. One hop. */
  specSameAs?: string;
  /** Order within the article. */
  specSort?: number;
  /** draft = imported and not yet reviewed. Only "authored" text ever
   *  prints, anywhere (hasPrintableSpec). No state + a body = a D94 part,
   *  which counts as authored. */
  specState?: "authored" | "draft";
  /** Provenance: "authored", "seed:northhs-2026-07-30", "skill:<date>". */
  specSource?: string;
  specUpdatedAt?: number;
  specUpdatedBy?: string;
```

In `src/lib/bid-spec.ts`, replace the `PartSpecFields` declaration (`:16-26`) with a `Pick<>` so `SpecCatalogPart = CatalogPart & PartSpecFields` stays assignable and every existing call site keeps compiling:

```ts
/** Spec fields carried on a catalog part (D94, extended by D-SPEC). Declared on
 *  CatalogPart itself now — this alias is kept so the D94 call sites read the
 *  same. */
export type PartSpecFields = Pick<
  CatalogPart,
  "specArticleId" | "specSectionId" | "specTitle" | "specBody" | "specSameAs" | "specSort" | "specState" | "specSource"
>;
```

- [ ] **Step 2: Stop the part modal wiping what it never showed**

Existing bug, fixed here because it is the same class as the spec-field hazard. `upsertPart` (`src/app/(app)/catalog/actions.ts:69-107`; its contract comment is `:44-67`) writes `manufacturerPartNumber`, `manufacturerModelNumber` and `mapPrice` on every save. `PartFormModal` (`catalog/page.tsx:593-881`) has no input for any of the three, so `formData.get(...)` is null. The first two are written as `undefined`, and `mapPrice` is written as `undefined` whenever the field is absent (`:103`). mergeUpsert treats an explicit `undefined` as "clear", so every modal save wipes all three.

Create `src/app/(app)/catalog/part-form.ts` (pure — a `"use server"` file may only export async functions, and the harness cannot call session-gated actions, see `scripts/test-review-regressions.ts:1046-1048`):

```ts
/**
 * Pure halves of catalog/actions.ts, so the harness can test them.
 */

function num(v: FormDataEntryValue | null): number {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}

/**
 * Fields the part modal may or may not render. A key the form did NOT submit
 * stays out of the patch, so mergeUpsert keeps the stored value; a submitted
 * blank clears it (an explicit undefined wins in mergeUpsert). Same rule
 * upsertPart already applies to `ports`.
 */
export function optionalPartFields(fd: FormData): {
  manufacturerPartNumber?: string;
  manufacturerModelNumber?: string;
  mapPrice?: number;
} {
  const text = (k: string) => String(fd.get(k) || "").trim() || undefined;
  const out: { manufacturerPartNumber?: string; manufacturerModelNumber?: string; mapPrice?: number } = {};
  if (fd.has("manufacturerPartNumber")) out.manufacturerPartNumber = text("manufacturerPartNumber");
  if (fd.has("manufacturerModelNumber")) out.manufacturerModelNumber = text("manufacturerModelNumber");
  if (fd.has("mapPrice")) out.mapPrice = num(fd.get("mapPrice"));
  return out;
}

/** The same-as rules the Spec panel's save enforces. null = fine. */
export function validateSameAs(
  sku: string,
  sameAs: string,
  target: { sku: string; specSameAs?: string } | null
): string | null {
  const want = String(sameAs || "").trim();
  if (!want) return null;
  if (want.toUpperCase() === String(sku || "").trim().toUpperCase()) return "A part cannot be the same spec as itself.";
  if (!target) return `Same spec as ${want} — no such part.`;
  if ((target.specSameAs || "").trim()) {
    return `${want} is itself a "same spec as" pointer — point at the part that holds the text.`;
  }
  return null;
}
```

In `upsertPart`, replace the three lines `manufacturerPartNumber: …`, `manufacturerModelNumber: …` and `mapPrice: …` (`:101-103`) with one spread, `...optionalPartFields(formData),`, and import it from `./part-form`. In `PartFormModal`, add two text inputs beside the Manufacturer input (`:765-773`, the `label("Manufacturer")` block): **MFR P/N** (`name="manufacturerPartNumber"`, `defaultValue={part?.manufacturerPartNumber ?? ""}`) and **MFR M/N** (`name="manufacturerModelNumber"`, `defaultValue={part?.manufacturerModelNumber ?? ""}`), labelled with the same headers the import hub uses. Do not add a MAP input — the modal does not own MAP; preserve-when-omitted keeps it.

- [ ] **Step 3: Add the spec write action**

Append to `src/app/(app)/catalog/actions.ts`. The file uses named imports (`get as getPart`, `mergeUpsert`, …) and its own `type Result` (`:16`) — there is no `Catalog` namespace:

```ts
import { validateSameAs, optionalPartFields } from "./part-form";
import { articleIdForPart } from "@/lib/specs/articles";
import { allArticles } from "@/lib/stores/spec-articles";
import { allSections } from "@/lib/stores/spec-sections";
// …
export async function writePartSpecFieldsAction(input: {
  sku: string;
  specArticleId?: string;
  specTitle?: string;
  specBody?: string;
  specSameAs?: string;
  specSort?: number;
}): Promise<Result> {
  const user = await requirePerm("create"); // returns the user — no second requireUser()
  const sku = String(input.sku || "").trim();
  if (!sku) return { ok: false, error: "A part is required." };
  const part = await getPart(sku);
  if (!part) return { ok: false, error: `Part ${sku} not found.` };

  const sameAs = String(input.specSameAs || "").trim();
  const sameAsError = validateSameAs(sku, sameAs, sameAs ? await getPart(sameAs) : null);
  if (sameAsError) return { ok: false, error: sameAsError };

  const [articles, sections] = await Promise.all([allArticles(), allSections()]);
  const articleId = String(input.specArticleId || "").trim();
  if (articleId && !articles.some((a) => a.id === articleId)) {
    return { ok: false, error: "That article no longer exists — pick another." };
  }
  // D-SPEC-5 mirror: D94's assemble groups by specSectionId, so keep it equal
  // to the section of the article this part will actually print under
  // (explicit, else category default, else adopted legacy pointer). When
  // nothing resolves, leave the stored specSectionId alone.
  const effective = articleIdForPart({ ...part, specArticleId: articleId || undefined }, articles, sections);
  const mirrorSectionId = articles.find((a) => a.id === effective)?.sectionId;

  try {
    // mergeUpsert, never upsert: the part carries ports, trade, pricing and
    // datasheet fields this action knows nothing about.
    await mergeUpsert(sku, {
      specArticleId: articleId || undefined,
      ...(mirrorSectionId ? { specSectionId: mirrorSectionId } : {}),
      specTitle: String(input.specTitle || "").trim() || undefined,
      specBody: String(input.specBody || ""),
      specSameAs: sameAs || undefined,
      specSort: Number(input.specSort) || undefined,
      // Saving here is the review step: whatever the row's provenance was, a
      // human has now read it, so it becomes authored.
      specState: "authored",
      specSource: "authored",
      specUpdatedAt: Date.now(),
      specUpdatedBy: user.name,
    });
  } catch (e) {
    console.error("writePartSpecFieldsAction", e);
    return { ok: false, error: "Could not save the spec text. Try again." };
  }
  revalidatePath("/catalog");
  revalidatePath("/design/specs/library");
  return { ok: true };
}
```

(`optionalPartFields` is imported for Step 2's `upsertPart` change; merge the two import lines.)

- [ ] **Step 4: One set of spec pointers — adopt the Displays metadata (owner decision 1, D-SPEC-5)**

**The mapping.** Commit 2e284665 stores free text under `productMetadata`. It arrives from the price-book importer (`catalog/import.ts:59-60`) or the import hub (`import/registry.ts:190-197`).

| Legacy field | Example value | Canonical target | Rule |
|---|---|---|---|
| `productMetadata.specSection` | `"11 61 13"` | `specSectionId` | Adopt when the value is a live section **id**, or a CSI number matching exactly **one** live section. Compare with `csiKey`, which drops everything but letters and digits, so `"11-61-13"` = `"116113"`. |
| `productMetadata.specArticle` | `"Stage Lighting Instruments"` | `specArticleId` | Adopt when the value is a live article **id**, or a title (case- and whitespace-insensitive) matching exactly **one** live article. The search is restricted to the part's section when that is known (canonical, or adopted in the same pass). An adopted article with no section also fills `specSectionId` with that article's section (the mirror). |
| `productMetadata.specLanguageKey` | `"lighting.instrument"` | none | Research tag with no canonical counterpart. It stays in `productMetadata`, untouched. |

Invariants: adoption only **fills an absent** canonical key. It never overwrites one, so an authored value always wins. It never deletes the legacy text. Running it twice is a no-op. Ambiguity never guesses: two sections sharing a number, or one title in two sections with no section known, adopt nothing.

Add to `src/lib/specs/articles.ts` (pure). On `SpecPartLike` add `productMetadata?: LegacySpecMetadata;` — `CatalogPart.productMetadata` (`CatalogProductMetadata`) is structurally assignable, so no call site needs a cast:

```ts
/* --- Legacy Displays metadata (D-SPEC-5) --- */

/** What commit 2e284665 stored under productMetadata: free text, not ids. */
export type LegacySpecMetadata = { specSection?: string; specArticle?: string };

/** "11 61 13", "116113" and "11-61-13" are one CSI number. */
export function csiKey(s: string): string {
  return String(s || "").replace(/[^0-9a-z]/gi, "").toLowerCase();
}

/** A live section id, or a CSI number matching exactly ONE live section. */
export function resolveSectionRef(ref: string | undefined, sections: SpecSection[]): string | null {
  const r = String(ref || "").trim();
  if (!r) return null;
  if (sections.some((s) => s.id === r)) return r;
  const key = csiKey(r);
  if (!key) return null;
  const hits = sections.filter((s) => csiKey(s.number) === key);
  return hits.length === 1 ? hits[0].id : null;
}

/** A live article id, or a title matching exactly ONE live article — inside
 *  `sectionId` when one is known. Ambiguity never guesses. */
export function resolveArticleRef(
  ref: string | undefined,
  articles: SpecCategoryArticle[],
  sectionId: string | null
): string | null {
  const r = String(ref || "").trim();
  if (!r) return null;
  if (articles.some((a) => a.id === r)) return r;
  const key = normalizeCategoryKey(r);
  const pool = sectionId ? articles.filter((a) => a.sectionId === sectionId) : articles;
  const hits = pool.filter((a) => normalizeCategoryKey(a.title) === key);
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * The canonical pointers the legacy metadata would FILL on this part. Never
 * returns a key the part already holds (so it cannot overwrite an authored
 * value, and applying its result twice is a no-op). `{}` = nothing to adopt.
 */
export function adoptLegacySpecPointers(
  part: SpecPartLike,
  articles: SpecCategoryArticle[],
  sections: SpecSection[]
): { specSectionId?: string; specArticleId?: string } {
  const md = part.productMetadata || {};
  const out: { specSectionId?: string; specArticleId?: string } = {};
  let sectionId =
    part.specSectionId && sections.some((s) => s.id === part.specSectionId) ? part.specSectionId : null;
  if (!part.specSectionId) {
    const s = resolveSectionRef(md.specSection, sections);
    if (s) {
      out.specSectionId = s;
      sectionId = s;
    }
  }
  if (!part.specArticleId) {
    const a = resolveArticleRef(md.specArticle, articles, sectionId);
    if (a) {
      out.specArticleId = a;
      if (!part.specSectionId && !out.specSectionId) {
        out.specSectionId = articles.find((x) => x.id === a)!.sectionId;
      }
    }
  }
  return out;
}
```

Make `articleIdForPart` adopt at read time. The first line of its body becomes:

```ts
  // D-SPEC-5: legacy Displays text fills absent canonical pointers at read
  // time, so the panel, coverage and Phase B are right before any write runs.
  part = { ...part, ...adoptLegacySpecPointers(part, articles, sections) };
```

Every Task 4 assertion still holds, because none of those fixtures carries `productMetadata`.

Create `src/lib/specs/legacy-pointers.ts` (server). This is the one-shot write, which Task 8 exposes as an **Adopt legacy pointers** button:

```ts
import { list as listCatalog, mergeUpsert } from "@/lib/stores/catalog";
import { allSections } from "@/lib/stores/spec-sections";
import { allArticles } from "@/lib/stores/spec-articles";
import { adoptLegacySpecPointers } from "@/lib/specs/articles";

/**
 * D-SPEC-5, persisted. Fills absent canonical pointers from the Displays
 * metadata so readers that do not adopt at read time (the Displays API, D94's
 * assemble, the catalog export) see ids. Idempotent: a second run writes
 * nothing. Never overwrites a canonical value and never deletes the legacy
 * text. mergeUpsert stamps `updatedAt` on the parts it touches (correct — the
 * Displays cursor should see them change); `pricedAt` does not move.
 */
export async function adoptAllLegacySpecPointers(): Promise<{ adopted: number; unresolved: number }> {
  const [parts, sections, articles] = await Promise.all([listCatalog(), allSections(), allArticles()]);
  let adopted = 0;
  let unresolved = 0;
  for (const p of parts) {
    const md = p.productMetadata;
    if (!md?.specSection && !md?.specArticle) continue;
    const patch = adoptLegacySpecPointers(p, articles, sections);
    if (Object.keys(patch).length) {
      await mergeUpsert(p.sku, patch);
      adopted++;
    }
    const after = { ...p, ...patch };
    if ((md.specSection && !after.specSectionId) || (md.specArticle && !after.specArticleId)) unresolved++;
  }
  return { adopted, unresolved };
}
```

**The Displays API reads the canonical fields.** In `src/lib/displays-api.ts`:

- Export `type SpecLookup = { sections: SpecSection[]; articles: SpecCategoryArticle[] }`, using type-only imports from `@/lib/specs/sections` and `@/lib/specs/articles`. Give `publicCatalogPart(part, lib?: SpecLookup)` and `publicProductMetadata(part, lib?)` an optional second parameter.
- In `publicProductMetadata`, emit `specSection` as the CSI **number** of `part.specSectionId` (from `lib.sections`), falling back to `metadata.specSection`. Emit `specArticle` as the **title** of `part.specArticleId` (from `lib.articles`), falling back to `metadata.specArticle`. The response keeps the same keys and value kinds, so the external contract does not change, and the legacy text shows only where no canonical pointer exists. `specLanguageKey` is unchanged.
- The `spec` object (`:71`) becomes `hasPrintableSpec(part) ? { sectionId: part.specSectionId || null, articleId: part.specArticleId || null, title: part.specTitle || null, body: part.specBody!.trim() } : null`. The fields are additive; `sectionId` and `body` keep their meaning.
- In all four v1 routes (`displays/specs/route.ts`, `displays/specs/[id]/route.ts`, `displays/catalog/route.ts`, `displays/catalog/[sku]/route.ts`), load `const [sections, articles] = await Promise.all([allSections(), allArticles()])` after the auth and rate-limit checks. Call `publicCatalogPart(p, { sections, articles })`. **Replace `page.map(publicCatalogPart)` with `page.map((p) => publicCatalogPart(p, lib))`.** Passing the function directly would hand `map`'s index in as `lib`.
- `src/app/api/displays/catalog/route.ts` (the pre-v1 route) passes `productMetadata` through verbatim and prints no spec body. Leave it alone and note that in the report.

- [ ] **Step 5: Gate drafts in every existing consumer (owner decision 2, D-SPEC-6)**

This overrides "leave the D94 actions alone" **for draft gating only**. Their `requireUser()` permission gates stay as they are.

Add the predicate to `src/lib/specs/articles.ts` (pure — `bid-spec.ts` runs inside the client component `generator.tsx`, and `articles.ts` imports only a type from `sections.ts`):

```ts
/** THE print predicate (D-SPEC-6). Only authored text prints; a draft is
 *  missing. A D94 part with a body and no specState predates drafts and
 *  counts as authored. Every consumer that used to test `specBody?.trim()`
 *  calls this instead. */
export function hasPrintableSpec(
  p: { specBody?: string; specState?: "authored" | "draft" } | null | undefined
): boolean {
  return !!p && !!(p.specBody || "").trim() && p.specState !== "draft";
}
```

and make `specStateOf`'s last two lines read it, so the two can never disagree:

```ts
  if (!(part.specBody || "").trim()) return "missing";
  return hasPrintableSpec(part) ? "authored" : "draft";
```

Then change each consumer:

| File:line | Today | Change to |
|---|---|---|
| `src/lib/bid-spec.ts:99` (`matchBom`) | `direct.specBody?.trim() ? "ready" : "no-spec"` | `hasPrintableSpec(direct) ? "ready" : "no-spec"` |
| `src/app/(app)/design/engagements/spec/actions.ts:88` (`remapRowAction`) | `part.specBody?.trim() ? … "ready" : … "no-spec"` | `hasPrintableSpec(part) ? … : …` |
| same file `:97-111` (`writePartSpecAction`) | writes `specSectionId` + `specBody` only | Keep the `requireUser()` gate but capture it (`const user = await requireUser();`). Add `specState: "authored", specSource: "authored", specUpdatedAt: Date.now(), specUpdatedBy: user.name` to the object at `:109`. An inline D94 write is a human writing the text, which is the review step. Without this, a draft part edited in the generator would stay `no-spec` forever. |
| same file, `saveSpecAction` (after the `unresolved` check) | trusts the client-sent `rows[].bucket` | Re-read the catalog: `const stored = new Map(((await listCatalog()) as SpecCatalogPart[]).map((p) => [p.sku.toLowerCase(), p]));`. Then refuse when any non-waived row's stored part fails `hasPrintableSpec`, with the error ``${n} item${n === 1 ? "" : "s"} no longer ha${n === 1 ? "s" : "ve"} approved spec text — re-run the match.``. A part can be demoted to draft (Task 14's importer) between match and save. |
| `src/lib/displays-api.ts:71` | `part.specBody?.trim() ? {…} : null` | `hasPrintableSpec(part) ? {…} : null` (Step 4's shape) |
| `src/app/api/v1/displays/specs/route.ts:23` | `.filter((part) => !!part.specBody?.trim())` | `.filter((part) => hasPrintableSpec(part))` |
| `src/app/api/v1/displays/specs/[id]/route.ts:16` | `if (!part?.specBody?.trim())` → 404 | `if (!hasPrintableSpec(part))` → 404 |
| `src/lib/client-package.ts:103` | `part.specSectionId && part.specBody?.trim()` | `part.specSectionId && hasPrintableSpec(part)`. The `body` at `:104` becomes `part.specBody!.trim()`. A draft is now a `missing-spec` gap. |

`assemble` (`bid-spec.ts:165`) already skips everything but `bucket === "ready"`, and the bucket now comes from `hasPrintableSpec`. Leave it.

- [ ] **Step 6: Write the tests**

In `scripts/test-review-and-spec.ts` (pure). Add the imports to the top block: `hasPrintableSpec, csiKey, resolveSectionRef, resolveArticleRef, adoptLegacySpecPointers` join Task 4's `@/lib/specs/articles` import. Also add `import { validateSameAs, optionalPartFields } from "@/app/(app)/catalog/part-form";`, `import { publicCatalogPart } from "@/lib/displays-api";` and `import { buildClientPackageManifest } from "@/lib/client-package";`. `matchBom` is already imported at `:10`.

```ts
/* --- specs: draft gating (D-SPEC-6) --- */
{
  ok(hasPrintableSpec({ specBody: "Text.", specState: "authored" }), "gating: authored text prints");
  ok(hasPrintableSpec({ specBody: "Text." }), "gating: a D94 body with no state prints");
  ok(!hasPrintableSpec({ specBody: "Text.", specState: "draft" }), "gating: a draft never prints");
  ok(!hasPrintableSpec({ specBody: "   " }) && !hasPrintableSpec(null), "gating: blank or absent never prints");

  const drafty = { id: "DRAFTY", sku: "DRAFTY", desc: "Draft part", category: "Lighting", unit: "ea", list: 1, cost: 1, specSectionId: "ss-g", specBody: "Text.", specState: "draft" as const };
  const authd = { id: "AUTHD", sku: "AUTHD", desc: "Authored part", category: "Lighting", unit: "ea", list: 1, cost: 1, specSectionId: "ss-g", specBody: "Text.", specState: "authored" as const };
  const gated = matchBom([{ sku: "DRAFTY", desc: "x", qty: 1 }, { sku: "AUTHD", desc: "y", qty: 1 }], [drafty, authd] as any[]);
  ok(gated.rows[0].bucket === "no-spec", "gating: matchBom files a draft as no-spec, never ready");
  ok(gated.rows[1].bucket === "ready", "gating: matchBom still files authored text as ready");
  ok(!gated.finalizable, "gating: a draft blocks finalize like a missing spec");

  ok(publicCatalogPart(drafty as never).spec === null, "gating: the Displays API publishes no spec for a draft");
  const pub = publicCatalogPart(
    { ...authd, specArticleId: "ar-g", productMetadata: { specSection: "legacy text" } } as never,
    { sections: [{ id: "ss-g", number: "26 55 61", title: "Fixtures", sort: 1, part1: [], part3: [], part2Style: "paragraphs", quantities: "drawings", updatedAt: 1, updatedBy: "t" }],
      articles: [{ id: "ar-g", sectionId: "ss-g", sort: 1, title: "LED Fixtures", manufacturers: [], general: "", categoryKeys: [], updatedAt: 1, updatedBy: "t" }] }
  );
  ok(pub.spec?.body === "Text." && pub.spec?.articleId === "ar-g", "displays: authored text publishes with its canonical pointers");
  ok(pub.productMetadata?.specSection === "26 55 61", "displays: specSection reads the canonical section's number over the legacy text");
  ok(pub.productMetadata?.specArticle === "LED Fixtures", "displays: specArticle reads the canonical article's title");

  const manifest = buildClientPackageManifest(
    { id: "GRD-T", name: "T", createdAt: 1, quoteId: null,
      options: [{ id: "opt-a", name: "Base", quoteId: null, createdAt: 1 }],
      placements: [{ id: "gp-a", optionId: "opt-a", partId: "DRAFTY" }, { id: "gp-b", optionId: "opt-a", partId: "AUTHD" }] } as never,
    [drafty, authd] as never,
    "opt-a"
  );
  ok(manifest.gaps.some((g) => g.kind === "missing-spec" && g.sku === "DRAFTY"), "gating: the client package reports a draft as a missing spec");
  ok(!manifest.gaps.some((g) => g.kind === "missing-spec" && g.sku === "AUTHD"), "gating: an authored part is not a spec gap");
}

/* --- specs: legacy Displays pointers (D-SPEC-5) --- */
{
  const secs = [
    { id: "ss-a", number: "11 61 13", title: "A", sort: 1, part1: [], part3: [], part2Style: "paragraphs" as const, quantities: "drawings" as const, updatedAt: 1, updatedBy: "t" },
    { id: "ss-b", number: "26 55 61", title: "B", sort: 2, part1: [], part3: [], part2Style: "paragraphs" as const, quantities: "drawings" as const, updatedAt: 1, updatedBy: "t" },
    { id: "ss-d1", number: "27 41 16", title: "Dup 1", sort: 3, part1: [], part3: [], part2Style: "paragraphs" as const, quantities: "drawings" as const, updatedAt: 1, updatedBy: "t" },
    { id: "ss-d2", number: "27-41-16", title: "Dup 2", sort: 4, part1: [], part3: [], part2Style: "paragraphs" as const, quantities: "drawings" as const, updatedAt: 1, updatedBy: "t" },
  ];
  const arts = [
    { id: "ar-a", sectionId: "ss-a", sort: 1, title: "Stage Lighting Instruments", manufacturers: [], general: "", categoryKeys: [], updatedAt: 1, updatedBy: "t" },
    { id: "ar-b", sectionId: "ss-b", sort: 1, title: "Stage Lighting Instruments", manufacturers: [], general: "", categoryKeys: [], updatedAt: 1, updatedBy: "t" },
    { id: "ar-c", sectionId: "ss-b", sort: 2, title: "Fixtures", manufacturers: [], general: "", categoryKeys: [], updatedAt: 1, updatedBy: "t" },
  ];
  ok(csiKey("11-61-13") === csiKey("116113"), "legacy: CSI numbers compare without punctuation");
  ok(resolveSectionRef("11 61 13", secs) === "ss-a", "legacy: a CSI number resolves to its one section");
  ok(resolveSectionRef("ss-b", secs) === "ss-b", "legacy: a section id resolves to itself");
  ok(resolveSectionRef("27 41 16", secs) === null, "legacy: a number two sections share never guesses");
  ok(resolveSectionRef("Stage stuff", secs) === null, "legacy: unresolvable text resolves to nothing");
  ok(resolveArticleRef("stage lighting instruments", arts, null) === null, "legacy: a title in two sections is ambiguous without a section");
  ok(resolveArticleRef("Stage Lighting Instruments", arts, "ss-a") === "ar-a", "legacy: the section narrows the title");

  const both = adoptLegacySpecPointers({ sku: "L1", productMetadata: { specSection: "11 61 13", specArticle: "Stage Lighting Instruments" } }, arts, secs);
  ok(both.specSectionId === "ss-a" && both.specArticleId === "ar-a", "legacy: section and article both adopt");
  ok(
    Object.keys(adoptLegacySpecPointers({ sku: "L2", specSectionId: "ss-b", specArticleId: "ar-c", productMetadata: { specSection: "11 61 13", specArticle: "Stage Lighting Instruments" } }, arts, secs)).length === 0,
    "legacy: a canonical value is never overwritten"
  );
  const onlyArt = adoptLegacySpecPointers({ sku: "L3", productMetadata: { specArticle: "Fixtures" } }, arts, secs);
  ok(onlyArt.specArticleId === "ar-c" && onlyArt.specSectionId === "ss-b", "legacy: an adopted article mirrors its section");
  ok(Object.keys(adoptLegacySpecPointers({ sku: "L4", productMetadata: { specSection: "Stage stuff" } }, arts, secs)).length === 0, "legacy: unresolvable text stays legacy");
  ok(
    Object.keys(adoptLegacySpecPointers({ sku: "L5", productMetadata: { specSection: "11 61 13", specArticle: "Stage Lighting Instruments" }, ...both }, arts, secs)).length === 0,
    "legacy: adopting twice is a no-op"
  );
  ok(articleIdForPart({ sku: "L6", productMetadata: { specArticle: "Fixtures" } }, arts, secs) === "ar-c", "legacy: articleIdForPart adopts at read time");
  ok(articleIdForPart({ sku: "L7", specArticleId: "ar-a", productMetadata: { specArticle: "Fixtures" } }, arts, secs) === "ar-a", "legacy: an explicit article beats the legacy text");
}

/* --- specs: part form + same-as --- */
{
  ok(validateSameAs("A", "", null) === null, "same-as: blank is fine");
  ok((validateSameAs("A", "a", null) || "").includes("itself"), "same-as: a part cannot point at itself");
  ok((validateSameAs("A", "NOPE", null) || "").includes("NOPE"), "same-as: a missing target is named");
  ok((validateSameAs("A", "B", { sku: "B", specSameAs: "C" }) || "").includes("pointer"), "same-as: pointing at a pointer is refused");
  ok(validateSameAs("A", "B", { sku: "B" }) === null, "same-as: pointing at a part with text is fine");

  const fd = new FormData();
  fd.set("sku", "X");
  ok(Object.keys(optionalPartFields(fd)).length === 0, "part form: unsubmitted manufacturer numbers and MAP stay out of the patch");
  fd.set("manufacturerPartNumber", " 7060A ");
  fd.set("manufacturerModelNumber", "");
  const o = optionalPartFields(fd);
  ok(o.manufacturerPartNumber === "7060A", "part form: a submitted P/N is trimmed");
  ok("manufacturerModelNumber" in o && o.manufacturerModelNumber === undefined, "part form: a submitted blank M/N clears it");
}
```

The client-package fixture passes `as never`, as the grid-options block does (`:4625`). If `buildClientPackageManifest` needs another project field to run, add that field rather than weakening the assertion.

In `scripts/test-review-regressions.ts` (database). Use the harness's dynamic-import idiom inside the block:

```ts
/* --- specs: part spec fields + legacy adoption --- */
{
  const { get: getPart, upsert, mergeUpsert } = await import("@/lib/stores/catalog");
  const { createSection } = await import("@/lib/stores/spec-sections");
  const { createArticle } = await import("@/lib/stores/spec-articles");
  const { adoptAllLegacySpecPointers } = await import("@/lib/specs/legacy-pointers");

  await upsert({ sku: "SPEC-1", desc: "Profile fixture", category: "Fixtures", unit: "ea", list: 100, cost: 50, mfr: "ETC", manufacturerPartNumber: "7060A", mapPrice: 90, ports: [{ kind: "dmx", n: 1 }] } as never);
  // The action's body minus the session gate (requirePerm cannot run here — :1046-1048).
  await mergeUpsert("SPEC-1", { specArticleId: "ar-fix", specTitle: "LED PROFILE FIXTURE", specBody: "Basis of Design: ETC ColorSource Spot", specState: "authored", specSource: "authored", specUpdatedAt: Date.now(), specUpdatedBy: "Tester" });
  const after = await getPart("SPEC-1");
  assert(after?.specTitle === "LED PROFILE FIXTURE" && after?.specState === "authored", "part spec: the fields land");
  assert(!!after?.ports?.length, "part spec: mergeUpsert left ports alone");
  assert(after?.list === 100 && after?.cost === 50 && after?.mapPrice === 90 && after?.manufacturerPartNumber === "7060A", "part spec: pricing and manufacturer numbers are untouched");

  const sec = await createSection({ number: "99 01 13", title: "Legacy Adoption Test", by: "Tester" });
  const art = await createArticle({ sectionId: sec.id, title: "Legacy Instruments" }, "Tester");
  await upsert({ sku: "LEG-1", desc: "Legacy one", category: "X", unit: "ea", list: 1, cost: 1, productMetadata: { specSection: "99-01-13", specArticle: "legacy instruments" } } as never);
  await upsert({ sku: "LEG-2", desc: "Legacy two", category: "X", unit: "ea", list: 1, cost: 1, specArticleId: "ar-authored", productMetadata: { specArticle: "Legacy Instruments" } } as never);
  const first = await adoptAllLegacySpecPointers();
  const leg1 = await getPart("LEG-1");
  assert(leg1?.specSectionId === sec.id && leg1?.specArticleId === art.id, "legacy: resolvable Displays text lands in the canonical pointers");
  assert(leg1?.productMetadata?.specSection === "99-01-13", "legacy: the Displays text itself is kept");
  assert((await getPart("LEG-2"))?.specArticleId === "ar-authored", "legacy: adoption never overwrites a canonical value");
  assert(first.adopted >= 1, "legacy: the first run reports what it adopted");
  assert((await adoptAllLegacySpecPointers()).adopted === 0, "legacy: a second run writes nothing");
}
```

- [ ] **Step 7: Run, typecheck, commit**

```bash
npm run test:specs
PGLITE_PATH=$(mktemp -d) npx tsx scripts/test-review-regressions.ts
npx tsc --noEmit -p .
ps aux | grep tsx   # must be empty
git add src/lib/stores/catalog.ts src/lib/specs/articles.ts src/lib/specs/legacy-pointers.ts src/lib/bid-spec.ts \
  "src/app/(app)/catalog/part-form.ts" "src/app/(app)/catalog/actions.ts" "src/app/(app)/catalog/page.tsx" \
  "src/app/(app)/design/engagements/spec/actions.ts" src/lib/displays-api.ts src/app/api/v1/displays src/lib/client-package.ts \
  scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
git commit -m "feat(specs): parts carry one canonical set of spec fields; drafts never print anywhere"
```

---

### Task 7: Curtains — a colour on the placement, a filler for the template

**Files:**
- Create: `src/lib/specs/curtains.ts` (pure)
- Modify: `src/lib/design/grid-bom.ts` (one optional field on `GridCurtain`)
- Modify: `src/app/(app)/design/grid/[id]/curtain-drop.tsx` (one optional input)
- Modify: `src/app/(app)/design/grid/[id]/actions.ts` (`placeCurtainAction`, `:294-350` — carry `color` through its whitelist)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `fillSlots` from Task 1, `SpecCurtainTemplate` from Task 5, `GridCurtain`/`GridCurtainType` from `@/lib/design/grid-bom`.
- Produces:
  ```ts
  export type CurtainRow = { curtain: GridCurtain; fabricName: string; qty: number };
  export function fullnessKey(pct: number): "0" | "50" | "75" | "100";
  export function curtainGroupKey(c: GridCurtain, fabricName: string): string;
  export function fillCurtainTemplate(
    tpl: SpecCurtainTemplate, curtain: GridCurtain, fabricName: string
  ): { title: string; body: string };
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { fullnessKey, curtainGroupKey, fillCurtainTemplate } from "@/lib/specs/curtains";
```
```ts
/* --- specs: curtains --- */
{
  const tpl = {
    id: "Leg" as const, articleId: "ar-drapes", sort: 20, title: "Legs",
    body: "Basis of Design: {{name}}\n  Material: {{material}}\n  Color: {{color}}\n  Size: {{width}} by {{height}}\n  Fabrication: {{fullnessClause}}\n  Hang Method: {{hang}}",
    fullnessClauses: { "0": "Flat.", "50": "Fifty.", "75": "Seventy-five.", "100": "Hundred." },
    hang: "Tie lines.", defaultColor: "Black unless noted otherwise",
    updatedAt: 1, updatedBy: "Jeff",
  };
  const leg = { type: "Leg" as const, name: "SL Leg 1", widthFt: 10, heightFt: 24, fullnessPct: 50, fabricSku: "VEL-22" };

  ok(fullnessKey(0) === "0" && fullnessKey(50) === "50" && fullnessKey(75) === "75" && fullnessKey(100) === "100", "curtains: the four fullness keys map straight through");
  ok(fullnessKey(60) === "50", "curtains: an off-scale fullness snaps down to the nearest defined clause");
  ok(fullnessKey(999) === "100", "curtains: an absurd fullness clamps to 100");
  ok(fullnessKey(-5) === "0", "curtains: a negative fullness clamps to 0");

  const out = fillCurtainTemplate(tpl, leg, "22oz Velour");
  ok(out.body.includes("22oz Velour"), "curtains: {{material}} is the fabric row's description");
  ok(out.body.includes("Black unless noted otherwise"), "curtains: an uncoloured curtain takes the template's default colour");
  ok(out.body.includes("Fifty."), "curtains: the fullness clause is chosen by the placement's fullness");
  ok(out.body.includes("Tie lines."), "curtains: {{hang}} comes from the template");
  ok(out.body.includes("10") && out.body.includes("24"), "curtains: width and height are substituted");
  ok(out.title === "Legs", "curtains: the entry takes the template's title");
  ok(!out.body.includes("{{"), "curtains: a fully configured curtain leaves no unfilled slot");

  const red = fillCurtainTemplate(tpl, { ...leg, color: "Red" }, "22oz Velour");
  ok(red.body.includes("Red") && !red.body.includes("Black unless"), "curtains: a placement colour beats the template default");

  ok(
    curtainGroupKey(leg, "22oz Velour") === curtainGroupKey({ ...leg, name: "SL Leg 2", widthFt: 12 }, "22oz Velour"),
    "curtains: two legs of the same fabric, colour and fullness are one entry whatever their size"
  );
  ok(
    curtainGroupKey(leg, "22oz Velour") !== curtainGroupKey({ ...leg, fullnessPct: 75 }, "22oz Velour"),
    "curtains: a different fullness is a different entry"
  );
  ok(
    curtainGroupKey(leg, "22oz Velour") !== curtainGroupKey(leg, "16oz Velour"),
    "curtains: a different fabric is a different entry"
  );
  ok(
    curtainGroupKey(leg, "22oz Velour") !== curtainGroupKey({ ...leg, color: "Red" }, "22oz Velour"),
    "curtains: a different colour is a different entry"
  );
  ok(
    curtainGroupKey(leg, "22oz Velour") !== curtainGroupKey({ ...leg, type: "Border" as const }, "22oz Velour"),
    "curtains: a different type is a different entry"
  );
}
```

- [ ] **Step 2: Run to verify it fails.** `npm run test:specs` — aborts on the missing module.

- [ ] **Step 3: Add the colour to the placement**

In `src/lib/design/grid-bom.ts`, add to `GridCurtain` (the type is at `grid-bom.ts:93-102`):

```ts
  /** Optional. Empty means the curtain template's defaultColor prints. */
  color?: string;
```
Nothing else in `grid-bom.ts` changes — `curtainLines` does not read it, and a BOM line's price does not depend on colour.

- [ ] **Step 4: Write the filler**

Create `src/lib/specs/curtains.ts`:

```ts
import { fillSlots } from "@/lib/specs/outline";
import type { GridCurtain } from "@/lib/design/grid-bom";
import type { CurtainFullnessKey, SpecCurtainTemplate } from "@/lib/stores/spec-curtain-templates";

/**
 * Curtains never match a catalog part — The Grid mints SKU "CURTAIN" for every
 * one of them — so a curtain row resolves to its type's template and the
 * placement's own configuration fills the slots. Pure, so the part editor's
 * preview and Phase B's assembly cannot disagree.
 *
 * `import type` only from the store module: this runs in a client component.
 */

const FULLNESS_STOPS: Array<[number, CurtainFullnessKey]> = [
  [0, "0"],
  [50, "50"],
  [75, "75"],
  [100, "100"],
];

/** The nearest defined clause at or below the placement's fullness. */
export function fullnessKey(pct: number): CurtainFullnessKey {
  const n = Number(pct);
  if (!Number.isFinite(n) || n <= 0) return "0";
  let key: CurtainFullnessKey = "0";
  for (const [stop, k] of FULLNESS_STOPS) if (n >= stop) key = k;
  return key;
}

/**
 * One entry per type + fabric + colour + fullness. Sizes and quantities are
 * deliberately NOT in the key: the specimen defers both to the curtain
 * schedule, so two legs of the same goods are one spec entry.
 */
export function curtainGroupKey(c: GridCurtain, fabricName: string): string {
  return [
    c.type,
    String(fabricName || c.fabricSku || "").trim().toLowerCase(),
    String(c.color || "").trim().toLowerCase(),
    fullnessKey(c.fullnessPct),
  ].join("|");
}

function feet(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function fillCurtainTemplate(
  tpl: SpecCurtainTemplate,
  curtain: GridCurtain,
  fabricName: string
): { title: string; body: string } {
  const key = fullnessKey(curtain.fullnessPct);
  const body = fillSlots(tpl.body, {
    name: String(curtain.name || tpl.title || "").trim(),
    material: String(fabricName || curtain.fabricSku || "").trim(),
    color: String(curtain.color || "").trim() || tpl.defaultColor,
    fullness: `${key}%`,
    fullnessClause: tpl.fullnessClauses[key] || "",
    hang: tpl.hang,
    width: feet(curtain.widthFt),
    height: feet(curtain.heightFt),
  });
  return { title: tpl.title, body };
}
```

- [ ] **Step 5: Offer the colour in the curtain modal**

In `src/app/(app)/design/grid/[id]/curtain-drop.tsx`, add an optional **Color** text input to the form, placed after the fabric picker and before the confirm row, labelled `Color (optional)` with placeholder `Black`. Carry its value into the draft the component passes to `onConfirm`, as `color: value.trim() || undefined`. Leave every existing field, the fullness picker and the pricing preview untouched — nothing about the BOM or a curtain's price may change in this task. `onConfirm` is typed `(curtain: GridCurtain) => void` (`curtain-drop.tsx:69`), so once Step 3 adds `color?` to `GridCurtain` the field flows to the `<CurtainDrop` call site (`editor.tsx:2230`) with no prop plumbing.

**The server drops it unless you carry it.** `placeCurtainAction` (`src/app/(app)/design/grid/[id]/actions.ts:294-350`) whitelists the curtain's fields twice: its `input.curtain` type (`:301-308`) and the `GridCurtain` it builds (`:334-341`). Add `color?: string;` to the input type, and add one line to the built object:

```ts
    color: (c.color || "").trim().slice(0, 40) || undefined,
```

(40 characters matches the `category` clamp at `:348`.) The editor's `dropCurtain` (`editor.tsx:1009-1024`) already passes the whole `GridCurtain` through, so nothing else changes on the client.

- [ ] **Step 6: Run, typecheck, commit**

```bash
npm run test:specs
npx tsc --noEmit -p .
git add src/lib/specs/curtains.ts src/lib/design/grid-bom.ts "src/app/(app)/design/grid/[id]/curtain-drop.tsx" "src/app/(app)/design/grid/[id]/actions.ts" scripts/test-review-and-spec.ts
git commit -m "feat(specs): curtain templates fill from the placement, which now carries an optional colour"
```

---

### Task 8: The module shell — routes, actions, and the library index

**Files:**
- Create: `src/app/(app)/design/specs/page.tsx`
- Create: `src/app/(app)/design/specs/actions.ts`
- Create: `src/app/(app)/design/specs/library/page.tsx`
- Create: `src/app/(app)/design/specs/library/controls.tsx`

**Interfaces:**
- Consumes: the four stores from Tasks 3-5.
- Produces: the server actions every later screen calls.

**Idiom to follow:** `src/app/(app)/vendors/page.tsx` (server component: `requireUser()`, parallel `Promise.all` loads, `searchParams` awaited) and `src/app/(app)/vendors/[id]/overview-tab.tsx` (client: `const [pending, start] = useTransition()`, `{ok:false}` rendered as an error line under the control). There is no shared `run()` helper: `overview-tab.tsx:62` defines `run` as a **local closure** over `start` that clears the error, awaits the action, sets the error on `{ok:false}` and `router.refresh()`es on success. Write the same local closure in each client component that needs one. Read both files before writing.

**Names.** `src/app/(app)/design/engagements/spec/actions.ts` (D94) already exports `createSectionAction`, `updateSectionAction` and `seedSectionsAction`. Two server-action modules with the same export names compile, but they make every import and every stack trace ambiguous. This module's section actions are therefore `createLibrarySectionAction`, `saveLibrarySectionAction`, `seedLibrarySectionsAction` and `removeLibrarySectionAction`. The article, template and curtain names below collide with nothing.

- [ ] **Step 1: The redirect**

`src/app/(app)/design/specs/page.tsx`:

```tsx
import { redirect } from "next/navigation";

/**
 * Phase A ships the library; the Generated list is Phase B (the generator).
 * Pointing the nav entry at the screen that does something beats pointing it
 * at an empty placeholder — Phase B replaces this file.
 */
export default function SpecsIndex() {
  redirect("/design/specs/library");
}
```

- [ ] **Step 2: The actions**

`src/app/(app)/design/specs/actions.ts` — `"use server"`, one `Result` type, `requirePerm("create")` on every write, every store call wrapped so a database failure reports rather than leaving a button re-enabled with no message (the Vendors I3 finding):

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import * as Sections from "@/lib/stores/spec-sections";
import * as Articles from "@/lib/stores/spec-articles";
import * as Templates from "@/lib/stores/spec-templates";
import * as Curtains from "@/lib/stores/spec-curtain-templates";
import { list as listCatalog } from "@/lib/stores/catalog";
import { adoptAllLegacySpecPointers } from "@/lib/specs/legacy-pointers";
import type { SpecArticle, SpecPart2Style, SpecQuantities } from "@/lib/specs/sections";

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

function revalidate(sectionId?: string) {
  revalidatePath("/design/specs/library");
  if (sectionId) revalidatePath(`/design/specs/library/${sectionId}`);
}

export async function createLibrarySectionAction(input: { number: string; title: string; sort?: number }): Promise<Result<{ id: string }>> {
  const user = await requirePerm("create");
  const number = String(input.number || "").trim();
  const title = String(input.title || "").trim();
  if (!number) return { ok: false, error: "A section needs a CSI number." };
  if (!title) return { ok: false, error: "A section needs a title." };
  try {
    const rec = await Sections.createSection({ number, title, sort: input.sort, by: user.name });
    revalidate();
    return { ok: true, id: rec.id };
  } catch (e) {
    console.error("createLibrarySectionAction", e);
    return { ok: false, error: "Could not create the section. Try again." };
  }
}

export async function saveLibrarySectionAction(
  id: string,
  patch: { number?: string; title?: string; sort?: number; part1?: SpecArticle[]; part3?: SpecArticle[]; part2Style?: SpecPart2Style; quantities?: SpecQuantities }
): Promise<Result> {
  const user = await requirePerm("create");
  if (!id) return { ok: false, error: "A section is required." };
  try {
    await Sections.updateSection(id, patch, user.name);
    revalidate(id);
    return { ok: true };
  } catch (e) {
    console.error("saveLibrarySectionAction", e);
    return { ok: false, error: "Could not save the section. Try again." };
  }
}

export async function seedLibrarySectionsAction(): Promise<Result<{ made: number }>> { /* Sections.seedStarterSections, same shape */ }

export async function removeLibrarySectionAction(id: string): Promise<Result> { /* Sections.removeSection — refuses first, see below */ }

export async function adoptLegacyPointersAction(): Promise<Result<{ adopted: number; unresolved: number }>> { /* adoptAllLegacySpecPointers() (Task 6), same shape; revalidate() + revalidatePath("/catalog") */ }

export async function createArticleAction(input: { sectionId: string; title: string; sort?: number }): Promise<Result<{ id: string }>> { /* Articles.createArticle */ }

export async function updateArticleAction(
  id: string,
  patch: { title?: string; sort?: number; manufacturers?: string[]; general?: string; categoryKeys?: string[]; sectionId?: string }
): Promise<Result> { /* Articles.updateArticle */ }

export async function deleteArticleAction(id: string): Promise<Result> { /* Articles.deleteArticle */ }

export async function saveTemplateAction(input: { key: string; title: string; headings: Array<{ label: string; guidance: string }>; rules: string; example: string }): Promise<Result<{ id: string }>> { /* Templates.saveTemplate */ }

export async function deleteTemplateAction(id: string): Promise<Result> { /* Templates.deleteTemplate */ }

export async function seedTemplatesAction(): Promise<Result<{ made: number }>> { /* Templates.seedStarterTemplates + Curtains.seedStarterCurtainTemplates, summed */ }

export async function saveCurtainTemplateAction(input: { id: string; articleId: string; sort: number; title: string; body: string; fullnessClauses: Record<string, string>; hang: string; defaultColor: string }): Promise<Result> { /* Curtains.saveCurtainTemplate */ }
```

Write out every one of the stubbed bodies in full, each exactly like `createLibrarySectionAction`: validate the required strings, wrap the store call in try/catch, `console.error` with the action's name, return a plain-English error, `revalidate()` the affected paths on success. `deleteArticleAction` additionally refuses when any catalog part still points at the article:

```ts
  const parts = await listCatalog();
  const used = parts.filter((p) => p.specArticleId === id);
  if (used.length) {
    return { ok: false, error: `${used.length} part${used.length === 1 ? "" : "s"} still print under this article — move them first.` };
  }
```

`removeLibrarySectionAction` (the delete the owner asked for on every record — Task 3's `removeSection`) refuses the same way, checking two things before it deletes. First, any catalog part whose `specSectionId` is this section: report the count, as in `${n} part${n === 1 ? "" : "s"} still print in this section — move them first.`. Second, any category article under it (`Articles.articlesForSection(id)`): `This section still holds ${n} Part 2 article${n === 1 ? "" : "s"} — delete or move them first.`. Only when both counts are zero does it call `Sections.removeSection(id)`, `revalidate()`, and return `{ ok: true }`. Task 9 surfaces it through `ConfirmButton`.

- [ ] **Step 3: The library index**

`src/app/(app)/design/specs/library/page.tsx` — a server component:

```tsx
export default async function SpecLibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const [sections, articles, parts, templates] = await Promise.all([
    Sections.allSections(),
    Articles.allArticles(),
    Catalog.list(),
    Templates.allTemplates(),
  ]);
  ...
}
```

It renders, in this order:

1. A page header: `Spec library`, a one-line explainer (`Sections, the Part 2 articles inside them, and which catalog parts have approved language.`), and links to **Templates** (`/design/specs/templates`) and **Import / Export** (Task 11's controls).
2. A **Sections** table — number, title, how many Part 1 and Part 3 articles it has, its Part 2 style, its quantities policy, and how many category articles sit under it. Each row links to `/design/specs/library/<id>`. Above it, an **+ Add section** inline form (number, title, sort) calling `createLibrarySectionAction`, and, only when there are no sections at all, an **Add the starter sections** button calling `seedLibrarySectionsAction`.
3. A **Part 2 articles** table grouped by section — article title, the number it will print as (`2.1`, `2.2`… computed from its position in its section's `sort` order), its manufacturers joined with `·`, its category keys as chips, and a count of parts that resolve to it. Each row links to its section editor.
4. Task 12's coverage table (leave a clearly-marked mount point; that task fills it).
5. Task 11's import/export controls (same).
6. A **Displays metadata** card, rendered only while at least one part carries legacy `productMetadata.specSection`/`.specArticle` text with no canonical pointer. Compute the count on the page from the `parts` already loaded. It explains in one line that these are research pointers from the Displays API that have not been linked to the library yet (the panel and coverage already read them), and offers an **Adopt legacy pointers** button calling `adoptLegacyPointersAction`. The button reports `Linked 12 parts · 3 left as text (no single matching section or article).`. It is idempotent: it only fills canonical pointers that are empty, so clicking it twice is harmless (D-SPEC-5).

`controls.tsx` is `"use client"` and holds the add-section form, the seed button and the adopt button. Use `useTransition`, disable the control while pending, and render `{ok:false}`'s `error` as a line under the form — never a toast, never a silent failure. Follow `src/app/(app)/vendors/controls.tsx` for the exact shape.

- [ ] **Step 4: Verify by hand**

```bash
ps aux | grep tsx       # must be empty
npm run dev             # in this worktree; it uses this worktree's own .data
```
Open `/design/specs` and confirm it lands on `/design/specs/library`; add a section; add an article; confirm both appear and that a deliberately blank title is refused with a visible message. Stop the server when done.

- [ ] **Step 5: Typecheck, build, commit**

```bash
npx tsc --noEmit -p .
git add src/app/\(app\)/design/specs
git commit -m "feat(specs): the Specs module shell — library index, section and article actions"
```

---

### Task 9: The section editor

**Files:**
- Create: `src/app/(app)/design/specs/library/[sectionId]/page.tsx`
- Create: `src/app/(app)/design/specs/library/[sectionId]/editor.tsx`

**Interfaces:**
- Consumes: `saveLibrarySectionAction`, `removeLibrarySectionAction`, `createArticleAction`, `updateArticleAction`, `deleteArticleAction` (Task 8); `renderBody` / `outlineToText` (Task 1); `ConfirmButton` (`src/components/confirm-button.tsx`).
- Produces: nothing new.

- [ ] **Step 1: The server component**

`page.tsx` awaits `params` (Next 16 — `{ params }: { params: Promise<{ sectionId: string }> }`), calls `requireUser()`, loads the section with `Sections.getSection(id)` (404 via `notFound()` when null), its articles with `Articles.articlesForSection(id)`, and `Catalog.list()` for the per-article part counts. It renders `<SectionEditor section={...} articles={...} partCounts={...} />`.

- [ ] **Step 2: The client editor**

`editor.tsx` is `"use client"` and has four regions plus the section delete:

1. **Header card** — number, title and sort as inputs; two selects, `Part 2 style` (`paragraphs` / `table`) and `Quantities` (`drawings` — "per drawings and schedules" — / `inline` — "printed on each entry"); a **Save** button calling `saveLibrarySectionAction`. Each select carries a one-line explainer beneath it; a reviewer must be able to tell what the choice does without opening the spec.
2. **Part 1 — General** and **Part 3 — Execution**: an ordered list of articles, each a title input (placeholder `SUBMITTALS`) and a body textarea (`rows={8}`, monospace via the `pk-mono` class so indentation is legible). Controls per article: move up, move down, remove. **Remove** is a `ConfirmButton` (`label="Remove"`, `confirmLabel="Remove article"`) whose `onConfirm` drops the article from local state. The removal only persists on **Save**, but a titled article with a long body is too much to lose to one stray click. An **+ Add article** button appends `{ id: newArticleId(), title: "", body: "" }`. The whole array is sent on **Save** through `saveLibrarySectionAction(id, { part1 })` — the editor owns the array; there is no per-article endpoint.
3. **Live preview** beside each body: run `renderBody(body, { context: "article", placeholders: { section: { number, title }, manufacturers: [], articles: [] } })`, render `outlineToText(lines, "  ")` in a `<pre>`, and list `warnings` beneath it in the muted style. Recompute on change with `useMemo` — this is pure and cheap, no debounce needed.
4. **Part 2 — category articles**: one card per article with title, sort, a manufacturers editor (one per line in a textarea, split on newline, blanks dropped), a category-keys editor (comma-separated), and a `general` body textarea with its own preview, this time passing `manufacturers` so `{{manufacturers}}` renders. Each card's **Save** calls `updateArticleAction`. **Remove** is a `ConfirmButton` whose `onConfirm` is:

   ```tsx
   async () => {
     const r = await deleteArticleAction(article.id);
     if (!r.ok) throw new Error(r.error); // ConfirmButton renders the thrown message — "3 parts still print under this article — move them first."
     router.refresh();
   }
   ```

   Returning `r` without throwing would swallow the refusal (Global Constraints).
5. **Delete section** — a `ConfirmButton` in the header card (`label="Delete section"`, `confirmLabel="Delete this section"`), calling `removeLibrarySectionAction(section.id)` with the same throw-on-`{ok:false}` shape. It surfaces Task 8's two refusals verbatim: parts still in the section, or Part 2 articles still under it. On success, `router.push("/design/specs/library")`.

State rule, learned from PUNCHLIST #141: do **not** key this component on `section.updatedAt`. Seed `useState` from props once, and after a successful save call `router.refresh()` without discarding the user's in-progress edits in the other regions.

- [ ] **Step 3: Verify by hand**

With `npm run dev`: add two Part 1 articles, save, reload, confirm they persist and print `A.`/`B.` correctly in the preview; paste a body whose lines already start with `A. ` and confirm the preview does not double-number; indent a line six levels and confirm the clamp warning appears; set Part 2 style to `table` and confirm it survives a reload.

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit -p .
git add src/app/\(app\)/design/specs/library/\[sectionId\]
git commit -m "feat(specs): section editor — titled Part 1/Part 3 articles, style switches, category articles, live preview"
```

---

### Task 10: The template editors

**Files:**
- Create: `src/app/(app)/design/specs/templates/page.tsx`
- Create: `src/app/(app)/design/specs/templates/[key]/page.tsx`
- Create: `src/app/(app)/design/specs/templates/editor.tsx`

- [ ] **Step 1: The list**

`templates/page.tsx` — `requireUser()`, then `await Templates.ensureStarterTemplates()` (owner decision 4 — a hosted database, or one after a go-live reset, never shows an empty screen; it writes only when a collection holds no live record, and it must not call `revalidatePath` from render), then `Templates.allTemplates()` and `Curtains.allCurtainTemplates()` in one `Promise.all`. Renders a table of formulas (key, title, heading count, whether an example is written, when and by whom it was last saved), each linking to `/design/specs/templates/<id>`; then a second table of the four curtain templates, each linking to `/design/specs/templates/curtain-<type>`. A **Restore starter templates** button calls `seedTemplatesAction` and reports `made` ("Added 6 formulas" / "Everything was already there") — this is the after-a-go-live-reset path, so say plainly that it never overwrites an edited formula.

- [ ] **Step 2: The editor**

`templates/[key]/page.tsx` awaits `params`, and routes on the segment: a segment starting `curtain-` loads the curtain template for that type, anything else loads `Templates.getTemplate(segment)`; `notFound()` when neither exists.

`editor.tsx` has two exported components:

- `<TemplateEditor template={...} />` — key (read-only once created, because the id is its slug and the route depends on it), title, an ordered heading list (label + guidance per row, add/remove/move), a `rules` textarea and an `example` textarea with a live `parseOutline(example, "entry")` preview — an example is a product entry, so it must preview as `1.`, `a.`, not `A.`. Save calls `saveTemplateAction`. A **Delete formula** `ConfirmButton` (`confirmLabel="Delete this formula"`) calls `deleteTemplateAction(template.id)`. It throws `new Error(r.error)` on `{ok:false}` so the button shows the message, and on success does `router.push("/design/specs/templates")`. `deleteTemplateAction` exists from Task 8 but had no UI until now. The page says, under the button, that **Restore starter templates** brings a deleted starter formula back.
- `<CurtainTemplateEditor template={...} articles={...} />` — title, the article picker (`articleId`, from the Part 2 articles across all sections, so a curtain entry knows where it prints), sort, the body textarea, the four fullness clauses, `hang`, `defaultColor`. Beneath the body, a **Preview with a sample curtain** block calling `fillCurtainTemplate(template, sample, "22oz Velour")` with `sample = { type, name: "Sample " + type, widthFt: 10, heightFt: 24, fullnessPct: 50, fabricSku: "SAMPLE" }`, then `parseOutline(body, "entry")`. Any slot left unfilled shows up as literal `{{…}}` in that preview, which is the point. Save calls `saveCurtainTemplateAction`. There is **no** delete here, by design: there is exactly one curtain template per `GRID_CURTAIN_TYPES` entry, the Grid resolves every curtain of that type through it, and Task 8 defines no curtain delete action.

- [ ] **Step 3: Verify, typecheck, commit**

Check both editors save and reload; check the curtain preview changes when you change a fullness clause.

```bash
npx tsc --noEmit -p .
git add src/app/\(app\)/design/specs/templates
git commit -m "feat(specs): template and curtain-template editors with entry-context previews"
```

---

### Task 11: Library export and import

**Files:**
- Create: `src/lib/specs/library-io.ts`
- Create: `src/app/api/spec-library/route.ts`
- Modify: `src/app/(app)/design/specs/actions.ts` (an import action)
- Modify: `src/app/(app)/design/specs/library/controls.tsx` (the two controls)
- Test: `scripts/test-review-regressions.ts`

**Why not the Import hub:** see "Decisions this plan takes" #1. The hub is columnar; a four-collection library document is not a table.

**Interfaces:**
```ts
export type SpecLibraryFile = {
  kind: "peak-spec-library";
  version: 1;
  exportedAt: number;
  sections: SpecSection[];
  articles: SpecCategoryArticle[];
  templates: SpecTemplate[];
  curtainTemplates: SpecCurtainTemplate[];
};
export async function exportLibrary(): Promise<SpecLibraryFile>;
export function parseLibraryFile(text: string): { file: SpecLibraryFile | null; error: string | null };
export async function importLibrary(file: SpecLibraryFile, by: string): Promise<{
  sections: number; articles: number; templates: number; curtainTemplates: number;
  /** Curtain templates whose id is not a GRID_CURTAIN_TYPES entry — refused, never coerced. */
  skipped: number;
}>;
```

- [ ] **Step 1: Write the failing regression assertions**

```ts
/* --- specs: library import/export --- */
{
  // The harness's dynamic-import idiom (see Task 5):
  const Sections = await import("@/lib/stores/spec-sections");
  const Articles = await import("@/lib/stores/spec-articles");
  const Curtains = await import("@/lib/stores/spec-curtain-templates");
  const { exportLibrary, parseLibraryFile, importLibrary } = await import("@/lib/specs/library-io");

  await Sections.createSection({ number: "11 61 43", title: "Stage Curtains", sort: 10, by: "Jeff" });
  const [sec] = await Sections.allSections();
  await Articles.createArticle({ sectionId: sec.id, title: "Theatrical Stage Drapes", manufacturers: ["Rose Brand"], categoryKeys: ["Curtains"], general: "A. General" }, "Jeff");

  const file = await exportLibrary();
  assert(file.kind === "peak-spec-library" && file.version === 1, "library io: the export is stamped and versioned");
  assert(file.sections.length >= 1 && file.articles.length >= 1, "library io: the export carries sections and articles");
  assert(file.templates.length > 0, "library io: the export carries the formulas");

  const round = parseLibraryFile(JSON.stringify(file));
  assert(!!round.file && round.error === null, "library io: an exported file parses back");
  assert(parseLibraryFile("not json").error !== null, "library io: junk is an error, not a throw");
  assert(parseLibraryFile(JSON.stringify({ kind: "something-else" })).error !== null, "library io: a foreign file is refused by kind");
  assert(parseLibraryFile(JSON.stringify({ ...file, version: 99 })).error !== null, "library io: an unknown version is refused");

  const counts = await importLibrary(round.file!, "Jeff");
  assert(counts.sections >= 1, "library io: importing reports what it wrote");
  const after = await Sections.allSections();
  assert(after.length === file.sections.length, "library io: re-importing the same file creates no duplicate section");
  const afterArticles = await Articles.allArticles();
  assert(afterArticles.length === file.articles.length, "library io: re-importing creates no duplicate article");

  const edited = { ...round.file!, sections: round.file!.sections.map((s) => ({ ...s, title: "Renamed" })) };
  await importLibrary(edited, "Jeff");
  assert((await Sections.allSections())[0].title === "Renamed", "library io: an import overwrites the record it matches by id");

  // Catalog parts point at articles by id (specArticleId), so an import must
  // keep the file's ids — a fresh id would orphan every part that pointed at it.
  const fromFile = { ...file.articles[0], id: "ar-from-file", title: "Imported Drapes" };
  await importLibrary({ ...round.file!, articles: [fromFile] }, "Jeff");
  const kept = await Articles.getArticle("ar-from-file");
  assert(kept?.title === "Imported Drapes", "library io: an imported article keeps the id the file gave it");
  await importLibrary({ ...round.file!, articles: [{ ...fromFile, title: "Imported Drapes v2" }] }, "Jeff");
  assert((await Articles.allArticles()).filter((a) => a.id === "ar-from-file").length === 1, "library io: re-importing an article updates it in place");
  assert((await Articles.getArticle("ar-from-file"))?.title === "Imported Drapes v2", "library io: the re-import's text wins");

  const junkCurtain = await importLibrary({ ...round.file!, curtainTemplates: [{ ...round.file!.curtainTemplates[0], id: "Valance" as never, title: "Should not land" }] }, "Jeff");
  assert(junkCurtain.skipped === 1, "library io: a curtain template for an unknown Grid type is skipped");
  assert(!(await Curtains.allCurtainTemplates()).some((t) => t.title === "Should not land"), "library io: a skipped curtain template never overwrites the Border template");
}
```

- [ ] **Step 2: Write the module**

`exportLibrary()` first `await ensureStarterTemplates()` (owner decision 4: the file handed to the `spec-writer` skill must carry the formulas even on a hosted database that was never dev-seeded), then reads all four collections in one `Promise.all` and returns the object above.

`parseLibraryFile(text)` `JSON.parse`es inside a try/catch, checks `kind === "peak-spec-library"` and `version === 1`, checks each of the four keys is an array (missing arrays default to `[]` — a skill-produced file may carry only articles), and returns `{file, error}`. It never throws.

`importLibrary(file, by)` upserts each record **under the id the file gives it**:

- **Sections:** `Sections.updateSection` when `getSection(id)` finds one; otherwise `upsertDoc("spec_sections", normalizeSection({ ...rec, updatedAt: Date.now(), updatedBy: by }))`.
- **Articles:** the same shape, and **never** through `createArticle`, which mints a new id. A new id would break every catalog part's `specArticleId` link to that article and duplicate the article on every re-import. Use `Articles.updateArticle` when `getArticle(id)` finds one, and otherwise `upsertDoc("spec_articles", normalizeArticle({ ...rec, updatedAt: Date.now(), updatedBy: by }))`. Skip a record whose normalized `id` or `sectionId` is empty; count it as skipped.
- **Templates:** `Templates.saveTemplate`, which is already keyed by slug and so idempotent.
- **Curtain templates:** `Curtains.saveCurtainTemplate`, keyed by type. First **skip** any record whose `id` is not in `GRID_CURTAIN_TYPES`. The store's `normalize` coerces an unknown id to `GRID_CURTAIN_TYPES[0]` (`"Border"`), so an unknown type would otherwise silently overwrite the Border template.

Every record gets `updatedBy: by` and a fresh `updatedAt`. It returns the four counts plus `skipped`. `upsertDoc` revives a soft-deleted id (its `onConflictDoUpdate` sets `deleted: false` — `src/db/doc-store.ts:83`). Re-importing a file therefore restores a record someone deleted, and that is the point of importing a whole library. **It never deletes** — an import adds and updates, so a partial file from the skill cannot destroy the library.

- [ ] **Step 3: Wire the export route and the two controls**

`src/app/api/spec-library/route.ts` — `GET` calls `requireUser()`, then `exportLibrary()`, and returns the JSON with
`Content-Disposition: attachment; filename="peak-spec-library-<YYYY-MM-DD>.json"`. Follow `src/app/api/spec/[id]/docx/route.ts` for the response idiom, but gate with `requireUser()` rather than a bare `auth()`.

In `actions.ts`, add:

```ts
export async function importLibraryAction(text: string): Promise<Result<{ sections: number; articles: number; templates: number; curtainTemplates: number; skipped: number }>> {
  const user = await requirePerm("create");
  const { file, error } = parseLibraryFile(text);
  if (!file) return { ok: false, error: error || "That file is not a Peak spec library." };
  try {
    const counts = await importLibrary(file, user.name);
    revalidate();
    return { ok: true, ...counts };
  } catch (e) {
    console.error("importLibraryAction", e);
    return { ok: false, error: "Could not import the library. Nothing was changed after the last record it reported." };
  }
}
```

In `controls.tsx`, add an **Import / Export** card: an `Export library` link to `/api/spec-library`, and an `Import library` control — a `<input type="file" accept="application/json,.json">` that reads the file with `await file.text()` in the browser and passes the string to `importLibraryAction`, then reports `Imported 5 sections, 12 articles, 6 formulas, 4 curtain templates.` (plus `· 1 skipped` when `skipped > 0`) or the error. Size-guard the read at 5 MB with a clear message, mirroring the catalog importer's 1 MB cap in spirit (`src/lib/catalog-import-guard.ts`).

- [ ] **Step 4: Run, typecheck, commit**

```bash
PGLITE_PATH=$(mktemp -d) npx tsx scripts/test-review-regressions.ts
npx tsc --noEmit -p .
git add src/lib/specs/library-io.ts src/app/api/spec-library src/app/\(app\)/design/specs scripts/test-review-regressions.ts
git commit -m "feat(specs): export and import the whole library as one JSON file"
```

---

### Task 12: The coverage table

**Files:**
- Create: `src/app/(app)/design/specs/coverage.ts` (pure)
- Modify: `src/app/(app)/design/specs/library/page.tsx` (load the three sources, mount the table)
- Modify: `src/app/(app)/design/specs/library/controls.tsx` (the filter controls)
- Modify: `src/lib/stores/generated-specs.ts` (add `allGeneratedSpecs()` — only `specsForEngagement`, `getGeneratedSpec` and `saveGeneratedSpec` exist today)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
```ts
// src/lib/stores/generated-specs.ts
export async function allGeneratedSpecs(): Promise<GeneratedSpec[]>; // listDocs<GeneratedSpec>("generated_specs"), newest first
// src/app/(app)/design/specs/coverage.ts
export const ON_BOM_WINDOW_MS: number;          // 90 days
export type CoverageState = "authored" | "same-as" | "draft" | "missing";
export type CoverageRow = {
  sku: string; desc: string; category: string;
  articleId: string | null; state: CoverageState;
  onBom: boolean; hasDatasheet: boolean;
};
export function skusFromQuoteSpec(spec: unknown): string[];
export function skusOnBomSince(
  sources: { quotes: unknown[]; gridProjects: unknown[]; generated: unknown[] },
  since: number
): Set<string>;
/** What coverage needs off a catalog part — a superset of SpecPartLike, so a
 *  real CatalogPart is structurally assignable with no cast. A datasheet is
 *  any of: a Peak-uploaded PDF (`datasheetName`), a manufacturer datasheet
 *  link from DaVinci (#162, `docs[].kind === "datasheet"`), or a researched
 *  datasheet/cut sheet on the Displays metadata (`productMetadata.datasheets`). */
export type CoveragePart = SpecPartLike & {
  desc?: string;
  datasheetName?: string;
  docs?: Array<{ kind: string }>;
  productMetadata?: { datasheets?: Array<{ kind: string }> };
};
export function hasDatasheet(p: CoveragePart): boolean;
export function coverageRows(
  parts: CoveragePart[],
  articles: SpecCategoryArticle[],
  sections: SpecSection[],
  onBom: Set<string>
): CoverageRow[];
export function filterCoverage(rows, f: { articleId?: string; state?: CoverageState | "all"; onBomOnly?: boolean; datasheetOnly?: boolean; q?: string }): CoverageRow[];
```

- [ ] **Step 1: Write the failing tests**

```ts
import { skusFromQuoteSpec, skusOnBomSince, coverageRows, filterCoverage, hasDatasheet, ON_BOM_WINDOW_MS } from "@/app/(app)/design/specs/coverage";
```

(Check how the harness imports other files that live under `src/app` — `scripts/test-review-and-spec.ts` already imports route-folder modules such as the import hub's `link.ts`; copy that path style exactly.)

```ts
/* --- specs: coverage --- */
{
  ok(ON_BOM_WINDOW_MS === 90 * 86_400_000, "coverage: the on-a-BOM window is 90 days");

  ok(
    skusFromQuoteSpec({ sections: [{ items: [{ sku: "A" }, { sku: "B" }] }, { items: [{ sku: "C" }] }] }).join(",") === "A,B,C",
    "coverage: the estimator's nested spec yields every item SKU"
  );
  ok(skusFromQuoteSpec({ kind: "grid", lines: [{ sku: "D" }, { sku: "CURTAIN" }] }).join(",") === "D,CURTAIN", "coverage: the Grid's flat spec yields its line SKUs");
  ok(skusFromQuoteSpec(null).length === 0 && skusFromQuoteSpec("nope").length === 0, "coverage: a missing or junk spec yields nothing");
  ok(skusFromQuoteSpec({ sections: [{ items: [{}, { sku: "  E  " }] }] }).join(",") === "E", "coverage: blank SKUs are dropped and the rest trimmed");

  const now = 1_800_000_000_000;
  const since = now - ON_BOM_WINDOW_MS;
  const on = skusOnBomSince(
    {
      quotes: [
        { updatedAt: now - 1000, spec: { sections: [{ items: [{ sku: "RECENT" }] }] } },
        { updatedAt: since - 1000, spec: { sections: [{ items: [{ sku: "OLD" }] }] } },
      ],
      gridProjects: [{ updatedAt: now - 2000, placements: [{ partId: "GRID" }, { partId: "" }] }],
      generated: [{ createdAt: now - 3000, bom: [{ sku: "D94" }] }, { createdAt: now - 3000, rows: [{ row: { sku: "PHASEB" } }] }],
    },
    since
  );
  ok(on.has("RECENT") && on.has("GRID") && on.has("D94") && on.has("PHASEB"), "coverage: all four sources count as a BOM appearance");
  ok(!on.has("OLD"), "coverage: anything older than the window does not count");
  ok(!on.has(""), "coverage: a blank partId is not a SKU");

  const articles = [{ id: "ar-fix", sectionId: "ss-1", sort: 10, title: "Fixtures", manufacturers: [], general: "", categoryKeys: ["Fixtures"], updatedAt: 1, updatedBy: "J" }];
  const sections = [{ id: "ss-1", number: "26 55 61", title: "Fixtures", sort: 10, part1: [], part3: [], part2Style: "paragraphs" as const, quantities: "drawings" as const, updatedAt: 1, updatedBy: "J" }];
  const parts = [
    { sku: "P1", desc: "Authored", category: "Fixtures", specBody: "Text.", specState: "authored" as const, datasheetName: "p1.pdf" },
    { sku: "P2", desc: "Draft", category: "Fixtures", specBody: "Text.", specState: "draft" as const },
    { sku: "P3", desc: "Missing", category: "Fixtures" },
    { sku: "P4", desc: "Pointer", category: "Fixtures", specSameAs: "P1" },
    { sku: "P5", desc: "Unmapped", category: "Nothing" },
  ];
  ok(hasDatasheet({ sku: "D1", docs: [{ kind: "datasheet" }] }), "coverage: a DaVinci datasheet link counts as a datasheet");
  ok(!hasDatasheet({ sku: "D2", docs: [{ kind: "manual" }] }), "coverage: a manual alone is not a datasheet");
  ok(hasDatasheet({ sku: "D3", productMetadata: { datasheets: [{ kind: "cut-sheet" }] } }), "coverage: a researched cut sheet counts");
  ok(!hasDatasheet({ sku: "D4", productMetadata: { datasheets: [{ kind: "guide-spec" }] } }), "coverage: a guide spec alone is not a datasheet");
  const rows = coverageRows(parts as never, articles, sections, new Set(["P1", "P3"]));
  ok(rows.length === 5, "coverage: every part gets a row, mapped or not");
  ok(rows.find((r) => r.sku === "P1")!.state === "authored", "coverage: an authored part reads authored");
  ok(rows.find((r) => r.sku === "P2")!.state === "draft", "coverage: a draft reads draft, never authored");
  ok(rows.find((r) => r.sku === "P3")!.state === "missing", "coverage: a part with no text reads missing");
  ok(rows.find((r) => r.sku === "P4")!.state === "same-as", "coverage: a resolved pointer reads same-as");
  ok(rows.find((r) => r.sku === "P5")!.articleId === null, "coverage: an unmapped category has no article");
  ok(rows.find((r) => r.sku === "P1")!.hasDatasheet === true, "coverage: a datasheet is reported");
  ok(rows.find((r) => r.sku === "P2")!.hasDatasheet === false, "coverage: no datasheet is reported too");
  ok(rows.find((r) => r.sku === "P1")!.onBom === true && rows.find((r) => r.sku === "P2")!.onBom === false, "coverage: the on-a-BOM set drives the flag");

  ok(filterCoverage(rows, { onBomOnly: true }).length === 2, "coverage: the on-a-BOM filter keeps only those two");
  ok(filterCoverage(rows, { datasheetOnly: true }).length === 1, "coverage: the datasheet filter keeps only P1");
  ok(filterCoverage(rows, { state: "missing" }).length === 1, "coverage: the state filter narrows to one");
  ok(filterCoverage(rows, { state: "all" }).length === 5, "coverage: state 'all' narrows nothing");
  ok(filterCoverage(rows, { articleId: "ar-fix" }).length === 4, "coverage: the article filter keeps its four parts");
  ok(filterCoverage(rows, { q: "point" }).length === 1, "coverage: the search matches the description, case-insensitively");
  ok(filterCoverage(rows, { q: "p3" }).length === 1, "coverage: the search matches the SKU too");
  ok(filterCoverage(rows, { onBomOnly: true, state: "missing" }).length === 1, "coverage: filters compose");
}
```

- [ ] **Step 2: Run to verify it fails, then write `coverage.ts`**

`skusFromQuoteSpec` walks `spec.sections[].items[].sku` and `spec.lines[].sku`, guarding every level with `Array.isArray` and `typeof`, trimming and dropping blanks, and never throwing on a junk shape.

`skusOnBomSince` unions three passes: quotes whose `updatedAt ?? createdAt ?? 0` is `>= since` contribute `skusFromQuoteSpec(q.spec)`; grid projects in the window contribute every non-blank `placements[].partId`; generated specs in the window contribute `bom[].sku` (the D94 shape) and `rows[].row.sku` (Phase B's). Returns a `Set<string>`.

`coverageRows` maps every catalog part through `articleIdForPart(part, articles, sections)` (which adopts legacy Displays pointers at read time — Task 6) and `specStateOf(part, bySku)` from Task 4, where `bySku` is built once from `parts`. `hasDatasheet(p)` is `!!p.datasheetName || (p.docs ?? []).some((d) => d.kind === "datasheet") || (p.productMetadata?.datasheets ?? []).some((d) => d.kind === "datasheet" || d.kind === "cut-sheet")`, and `CoverageRow.hasDatasheet` is its result.

`filterCoverage` applies, in order: `articleId` (exact, `null` matching only when the filter asks for the literal string `"none"`), `state` (skipped when `"all"` or absent), `onBomOnly`, `datasheetOnly`, then `q` as a case-insensitive substring over `sku + " " + desc`.

- [ ] **Step 3: Mount it**

In `library/page.tsx`, extend the `Promise.all` with `getAll()` from `@/lib/stores/quotes` (`quotes.ts:372` — there is no `list()`), `listProjects()` from `@/lib/stores/grid-projects` (`grid-projects.ts:235`), and the new `allGeneratedSpecs()`. Do not reach into `listDocs` directly from a page. Compute `onBom = skusOnBomSince({...}, Date.now() - ON_BOM_WINDOW_MS)` and `rows = coverageRows(...)`, read the filters from `searchParams` (`article`, `state`, `bom`, `datasheet`, `q`), and render a table with these columns: SKU, description, article, state chip, an "on a BOM" tick and a datasheet tick. The SKU links to `/catalog?edit=<encodeURIComponent(sku)>`, which opens the part modal where the Spec panel lives (`catalog/page.tsx:74` reads `sp.edit`; there is no `sku` param). Cap the rendered rows at 300 with a "showing 300 of N — narrow the filters" line; the catalog is ~10.7k rows and this table must never try to render all of them.

The filter controls go in `controls.tsx` as a `SearchFilterBar` (`src/components/search/search-filter-bar.tsx`) so the search box and the dropdowns share one line, per #121 — that component exists precisely for this.

- [ ] **Step 4: Run, typecheck, commit**

```bash
npm run test:specs
npx tsc --noEmit -p .
git add src/app/\(app\)/design/specs src/lib/stores/generated-specs.ts scripts/test-review-and-spec.ts
git commit -m "feat(specs): per-article coverage table with on-a-BOM and datasheet filters"
```

---

### Task 13: The Spec panel on the part editor

**Files:**
- Create: `src/app/(app)/catalog/spec-panel.tsx`
- Modify: `src/app/(app)/catalog/page.tsx` (load articles + sections + templates; mount the panel)

**Interfaces:**
- Consumes: `writePartSpecFieldsAction` (Task 6), `articleIdForPart` / `specStateOf` (Task 4), `renderBody` (Task 1), `scaffoldFrom` / `ensureStarterTemplates` (Task 5).

- [ ] **Step 1: Pass the data down**

`catalog/page.tsx` is already a server component. Add three loads to the **existing** `Promise.all` at `:46-54` (don't start a second one): `allArticles()`, `allSections()`, and `ensureStarterTemplates().then(() => allTemplates())`. The last one is owner decision 4: the "Insert template" row must never be empty on a hosted database. Beside `isAdmin` at `:55`, add `const canCreate = can("create", user.roles);`; `can` is already imported at `:3`.

Pass the following into `PartFormModal` (rendered at `:486-493`):
- `canCreate`.
- The articles, mapped to `{ id, title, sectionNumber, manufacturers }`.
- The templates, mapped to `{ id, key, headings }`.
- `defaultArticleId`: `editingPart ? articleIdForPart({ ...editingPart, specArticleId: undefined }, articles, sections) : null`.

Computing the default on the server keeps the client payload small, because the full article and section records carry text no panel renders. It also means the panel never needs `categoryKeys` or the legacy Displays metadata in order to show "the category default resolves to …".

- [ ] **Step 2: The panel**

`spec-panel.tsx` is `"use client"`:

```tsx
export default function SpecPanel({ part, articles, templates }: {
  part: { sku: string; category?: string; specArticleId?: string; specSectionId?: string;
          specTitle?: string; specBody?: string; specSameAs?: string; specSort?: number;
          specState?: "authored" | "draft"; specSource?: string; specUpdatedAt?: number; specUpdatedBy?: string };
  articles: Array<{ id: string; title: string; sectionNumber: string; manufacturers: string[] }>;
  templates: Array<{ id: string; key: string; headings: Array<{ label: string; guidance: string }> }>;
  /** Server-computed: what the part resolves to with no explicit article
   *  (category default, else an adopted legacy Displays pointer, else D94's
   *  section). null = nothing resolves. */
  defaultArticleId: string | null;
})
```

Controls, top to bottom:

1. **State line** — a chip reading `Authored`, `Draft — not printing yet`, `Same spec as <SKU>` or `No spec language`, with `specSource` and `specUpdatedBy`/`specUpdatedAt` beside it when present. A draft says plainly that the match report treats it as missing until it is saved here.
2. **Article** — a `<select>` of the articles, each option labelled `<sectionNumber> · <title>`, plus a first option `— default from category —` whose value is `""`. When the part has no explicit `specArticleId`, show which article `defaultArticleId` names as helper text beneath (or "nothing resolves — pick one" when it is null).
3. **Entry title** — text input, placeholder `COLOR MIXING LIGHT EMITTING DIODE PROFILE FIXTURE`.
4. **Same spec as** — text input for a SKU. When non-empty, disable the body textarea and say `This part prints <SKU>'s text.`
5. **Body** — a `pk-mono` textarea, `rows={14}`. When it is empty, an **Insert template** row of buttons, one per template, that writes `scaffoldFrom(t)` into the body. Preselect the button whose `key` matches the part's `category` case-insensitively.
6. **Sort** — number input, `specSort`.
7. **Live preview** — `renderBody(body, { context: "entry", placeholders: { manufacturers: <the chosen article's manufacturers> } })`, rendered as `outlineToText(lines, "  ")` in a `<pre>` under the heading the entry will print with (`B. <specTitle or desc>`), with the warnings listed beneath. This is the whole point of the panel: the author sees the numbering they will get.
8. **Save** — calls `writePartSpecFieldsAction`, renders `{ok:false}`'s error inline, and on success calls `router.refresh()`.

Do **not** key the panel on `specUpdatedAt` (PUNCHLIST #141). Seed state from props once; after a successful save, let `router.refresh()` bring the chip up to date without remounting the textarea.

- [ ] **Step 3: Mount it**

In `PartFormModal` (`catalog/page.tsx:593-881`), directly after the existing `PartDatasheetControl` block (`:837-841`), add a matching block. The gate is **`canCreate`**, not `isAdmin` (owner decision 3). The datasheet control stays admin-only because it writes Peak's own blob storage. The spec write is gated by `requirePerm("create")` inside `writePartSpecFieldsAction`.

```tsx
{canCreate && editing && part && (
  <div style={{ marginTop: 16, paddingTop: 13, borderTop: "1px solid #f0f1f4" }}>
    <SpecPanel part={part} articles={specArticles} templates={specTemplates} defaultArticleId={defaultArticleId} />
  </div>
)}
```

The panel sits **inside** the `<form action={upsertPart}>` (`:700`), exactly as the datasheet control does. That form element is the modal's scroll container (`overflowY: "auto"`), so mounting outside it would put the panel below the fold and outside the scroll. `upsertPart` is a `FormData` action that redirects, so the panel must never submit it or feed it:

- every `<button>` in the panel is `type="button"`, including Save, Insert template and the template buttons;
- no panel input, select or textarea has a `name`, so nothing leaks into `upsertPart`'s `FormData`. Note that `specSort` must not become a stray `name="specSort"`;
- every single-line `<input>` gets `onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}`, so Enter in the title, same-as or sort box never submits the part form (Enter in the body `<textarea>` is a newline and needs nothing).

- [ ] **Step 4: Verify by hand**

With `npm run dev`, open `/catalog` as a user with `create` but not `manage_users` (an Estimator), confirm the Spec panel shows and the datasheet control does not; press Enter in the entry-title box and confirm the modal does not submit; edit a part, write a two-level body, confirm the preview numbers it `1.` / `a.` (entry context, not `A.`), insert a template into an empty body, set **Same spec as** to a SKU that is itself a pointer and confirm the refusal shows, then save and reload and confirm the chip reads `Authored`.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit -p .
git add src/app/\(app\)/catalog/spec-panel.tsx src/app/\(app\)/catalog/page.tsx
git commit -m "feat(specs): the part editor's Spec panel — article, title, body, same-as, and a live entry preview"
```

---

### Task 14: The catalog importer carries spec columns

**Files:**
- Modify: `src/app/(app)/import/types.ts` (the `catalog` type at `:259-289`, fields `:269-288`: two re-keyed columns, five new ones)
- Modify: `src/app/(app)/import/registry.ts` (`catalogPatch` at `:179-238`, the catalog writer at `:1059-1087`, its exporter at `:1088-1112`)
- Modify: `src/app/(app)/catalog/import.ts` (the price-book importer's `Spec Section`/`Spec Article` at `:58-79`)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `resolveSectionRef` / `resolveArticleRef` (Task 6), `allSections` / `allArticles` (Tasks 3-4). `mergeUpsert` already preserves untouched fields, which is exactly why a spec import cannot disturb pricing and a price re-import cannot disturb spec text — **provided the patch never carries a spec key the row did not actually supply** (Step 2).
- Produces: `catalogPatch(v, ex, sku, opts?: { now?: number; by?: string; specLib?: SpecLookup })` — the fourth parameter is optional so the existing pure assertions (`scripts/test-review-and-spec.ts:4925-4954`) keep compiling unchanged. `SpecLookup` is Task 6's type from `@/lib/displays-api`; import it as a type, or declare the same `{ sections; articles }` shape locally.

- [ ] **Step 1: Declare the columns — one set, no duplicates (D-SPEC-5)**

In `src/app/(app)/import/types.ts`, the catalog type already has three Displays-API columns from commit 2e284665 (`:280-282`): `specSection` ("Spec Section"), `specArticle` ("Spec Article") and `specLanguageKey`. Per owner decision 1, the first two **become** the canonical pointer columns. Keep their headers, so every existing file and template still maps. Re-key them, and do not add a second pair:

```ts
      { key: "specSectionId", header: "Spec Section", label: "Spec section", aliases: ["spec section", "specification section", "csi section", "spec section id"], example: "11 61 43" },
      { key: "specArticleId", header: "Spec Article", label: "Spec article", aliases: ["spec article", "specification article", "csi article", "spec article id"], example: "ar-drapes or Theatrical Stage Drapes" },
```

`specLanguageKey` stays exactly as it is, as research metadata with no canonical counterpart. Append the five new columns after `sourceDocumentDate`. Keys are camelCase like every other catalog key. There is **no `model` column**: `MFR M/N` (`manufacturerModelNumber`) already is the model number, and the proposed `model`/`part number` aliases collide with `sku`'s.

```ts
      { key: "specTitle", header: "Spec Title", label: "Spec entry title", aliases: ["spec title", "spec entry title", "spec heading"], example: "COLOR MIXING LED PROFILE FIXTURE" },
      { key: "specBody", header: "Spec Body", label: "Spec text", aliases: ["spec body", "spec text", "specification text"], example: "Basis of Design: ETC ColorSource Spot" },
      { key: "specSameAs", header: "Spec Same As", label: "Same spec as SKU", aliases: ["spec same as", "same spec as"], example: "CS-SPOT-1" },
      { key: "specState", header: "Spec State", label: "Spec state", kind: "enum", options: ["authored", "draft"], aliases: ["spec state", "spec status"], example: "draft" },
      { key: "specSource", header: "Spec Source", label: "Spec source", aliases: ["spec source", "spec provenance"], example: "skill:2026-09-22" },
```

Keep the aliases specific. `autoMap`'s second pass (`parse.ts:248-266`) fuzzy-matches with "contains" in **both** directions, so a bare alias such as `state`, `source`, `article`, `title` or `same as` would let an unrelated vendor column claim a spec field. A spec field claimed that way can demote authored text to draft. Even with specific aliases, a vendor sheet whose header is exactly `Title` fuzzy-matches `specTitle` through its `"spectitle"` candidate. The import preview's mapping step is where a human catches that; say so in the blurb.

None of the new columns is `hidden`. The template and the export must carry them, because "export → hand to the skill → re-import" is the whole authoring loop. Extend the type's `blurb` to say three things. `Spec Body` is multi-line: a quoted CSV cell keeps its newlines and its interior indentation (`parseCsv` is a real quoted-CSV state machine), but `coerce()` trims the outermost edges (`parse.ts:206`). A row that changes spec text lands as a draft. And a blank spec cell never clears stored text; clearing is done in the part editor.

- [ ] **Step 2: Write them without the wipe bug**

**The wipe bug the first draft of this step had.** `prepareRows` sets **every** field on every row, and turns an absent column into `""` (`parse.ts:298-301`: `const v = idx != null && idx >= 0 ? raw[idx] : ""; values[f.key] = coerce(f, v);`). So `v.specBody !== undefined` is always true. A price-only re-import would blank every `specBody` and demote every part to draft. Use the file's own `str(v.x) ? {…} : {}` idiom (`registry.ts:42`, used at `:231-233`) for every spec key, so a blank cell and an absent column both mean "leave it alone".

Add to `registry.ts`'s imports: `import { resolveArticleRef, resolveSectionRef } from "@/lib/specs/articles";`, `import { allSections } from "@/lib/stores/spec-sections";`, `import { allArticles } from "@/lib/stores/spec-articles";` and `import type { SpecLookup } from "@/lib/displays-api";`. The file already imports the `Catalog` namespace (`:18`) and `norm` (`:26`).

Give `catalogPatch` an optional fourth parameter and replace the three legacy-metadata lines for the pointers (`:190-191` and `:195-196`; the `specLanguageKey` lines stay):

```ts
export function catalogPatch(
  v: Values,
  ex: Record<string, unknown> | null,
  sku: string,
  opts: { now?: number; by?: string; specLib?: SpecLookup } = {}
): Partial<Omit<Catalog.CatalogPart, "id" | "sku">> {
  // … existing body down to the metadata block …

  // D-SPEC-5: "Spec Section" / "Spec Article" are the canonical pointer
  // columns. A value that resolves — a live id, or a CSI number / title that
  // matches exactly one live record — sets the canonical pointer (an explicit
  // import value is an instruction, so it may replace a stored pointer). One
  // that does not resolve is kept as legacy Displays text in productMetadata,
  // exactly as 2e284665's columns stored it, so no imported value is lost.
  const secRef = str(v.specSectionId);
  const artRef = str(v.specArticleId);
  const lib = opts.specLib;
  const secId = lib ? resolveSectionRef(secRef, lib.sections) : null;
  const artId = lib ? resolveArticleRef(artRef, lib.articles, secId ?? (str(e.specSectionId) || null)) : null;
  if (secRef && !secId) { metadata.specSection = secRef; hasMetadata = true; }
  if (artRef && !artId) { metadata.specArticle = artRef; hasMetadata = true; }
  const artSection = artId ? lib!.articles.find((a) => a.id === artId)!.sectionId : null;

  // Spec text. A column absent from the file — or a blank cell — must not
  // blank the field (prepareRows turns both into ""), and a price re-import
  // must never wipe authored spec text.
  const body = str(v.specBody);
  const title = str(v.specTitle);
  const changed = (!!body && body !== str(e.specBody)) || (!!title && title !== str(e.specTitle));
  const explicit = str(v.specState);
  // Only a row that carries text sets a state. An explicit column wins; with
  // no explicit state, CHANGED text lands as draft (spec §4 — unreviewed text
  // must not print) and unchanged text keeps its state, so export → re-import
  // of untouched rows never demotes authored parts.
  const state =
    body || title
      ? explicit === "authored" || explicit === "draft"
        ? explicit
        : changed
          ? "draft"
          : undefined
      : undefined;
```

and add to the returned object, beside the existing `...(hasMetadata ? …)` line:

```ts
    ...(secId ? { specSectionId: secId } : artSection ? { specSectionId: artSection } : {}),
    ...(artId ? { specArticleId: artId } : {}),
    ...(title ? { specTitle: title } : {}),
    ...(body ? { specBody: body } : {}),
    ...(str(v.specSameAs) ? { specSameAs: str(v.specSameAs) } : {}),
    ...(str(v.specSource) ? { specSource: str(v.specSource) } : {}),
    ...(state ? { specState: state } : {}),
    ...(changed ? { specUpdatedAt: opts.now ?? Date.now(), specUpdatedBy: opts.by || "import" } : {}),
```

Note `artSection` is the mirror rule from Task 6: an article pointer also carries its section, because D94's `assemble` groups by `specSectionId`.

**The writer supplies `now`, `by` and `specLib`, not `ctx.effectiveAt`.** `effectiveAt` is the price list's effective date and has nothing to do with when spec text changed. `catalogPatch` has no `ctx` (`:179-183`). In the catalog writer (`:1059-1087`), load the library once per commit, memoised on the commit context:

```ts
const SPEC_LIB = new WeakMap<CommitContext, Promise<SpecLookup>>();
function specLibFor(ctx: CommitContext): Promise<SpecLookup> {
  let p = SPEC_LIB.get(ctx);
  if (!p) {
    p = Promise.all([allSections(), allArticles()]).then(([sections, articles]) => ({ sections, articles }));
    SPEC_LIB.set(ctx, p);
  }
  return p;
}
```

Both `create` and `update` then call `catalogPatch(v, ex, sku, { now: Date.now(), by: ctx.me?.name, specLib: await specLibFor(ctx) })`.

**The exporter must emit the canonical columns** (`:1088-1112`), or export → skill → re-import breaks. `exportCsv` writes `o[f.key]` for every visible field (`:1402-1410`). Rename the two existing keys and add the five new ones:

```ts
        // D-SPEC-5: the canonical id when there is one (it re-imports exactly);
        // otherwise the legacy Displays text, which re-imports as legacy text.
        specSectionId: p.specSectionId || p.productMetadata?.specSection || "",
        specArticleId: p.specArticleId || p.productMetadata?.specArticle || "",
        specLanguageKey: p.productMetadata?.specLanguageKey || "",
        // …
        specTitle: p.specTitle || "",
        specBody: p.specBody || "",
        specSameAs: p.specSameAs || "",
        // Deliberately blank. The state is a review stamp, not data: a file
        // that has left Peak comes back unreviewed. With the column blank,
        // Step 2's rule keeps untouched rows' state and lands edited rows as
        // draft. Emitting "authored" would let a skill-edited row print
        // unreviewed text.
        specState: "",
        specSource: p.specSource || "",
```

**The price-book importer** (`src/app/(app)/catalog/import.ts:58-79`, fed by `catalog/parse.ts`'s `specSection`/`specArticle` aliases) gets the same resolution. It is the other path that writes Displays text. Load `allSections()` + `allArticles()` once before the loop in `runCatalogImport`. For each row, put the canonical `specSectionId`/`specArticleId` (with the mirror) in the `mergeUpsert` patch when `resolveSectionRef`/`resolveArticleRef` resolve. Otherwise keep today's `productMetadata.specSection`/`.specArticle` spread (`:59-60`) unchanged. It writes no spec text, so it never touches `specState`.

- [ ] **Step 3: Assert the column contract and the wipe fix**

The harness already imports `IMPORT_TYPES` (`:130`), `prepareRows`/`autoMap` (`:131-137`) and `catalogPatch` (`:155`). Add `norm` to the `@/app/(app)/import/parse` import.

```ts
/* --- specs: catalog import columns --- */
{
  const cat = IMPORT_TYPES.find((t) => t.key === "catalog")!;
  const keys = cat.fields.map((f) => f.key);
  const SPEC_KEYS = ["specSectionId", "specArticleId", "specTitle", "specBody", "specSameAs", "specState", "specSource"];
  for (const k of SPEC_KEYS) ok(keys.includes(k), `catalog import: the ${k} column exists`);
  ok(!keys.includes("specSection") && !keys.includes("specArticle") && !keys.includes("model"), "catalog import: one set of pointer columns, and no model column");
  ok(
    cat.fields.find((f) => f.key === "specSectionId")!.header === "Spec Section" &&
      cat.fields.find((f) => f.key === "specArticleId")!.header === "Spec Article",
    "catalog import: the canonical pointers keep the headers existing files already use"
  );
  ok(cat.fields.filter((f) => SPEC_KEYS.includes(f.key)).every((f) => !f.hidden), "catalog import: every spec column is advertised in the template and the export");
  ok(cat.fields.find((f) => f.key === "specState")!.options?.join(",") === "authored,draft", "catalog import: specState is an enum of exactly the two states");

  // Scoped to the spec columns: the pre-existing catalog fields already repeat
  // aliases among themselves (family, series, model number), which is not
  // this task's to fix.
  const candsOf = (f: { header: string; label: string; key: string; aliases?: string[] }) =>
    [f.header, f.label, f.key, ...(f.aliases || [])].map(norm).filter(Boolean);
  const others = new Set(cat.fields.filter((f) => !SPEC_KEYS.includes(f.key)).flatMap(candsOf));
  const mine = cat.fields.filter((f) => SPEC_KEYS.includes(f.key)).flatMap((f) => [...new Set(candsOf(f))]);
  ok(mine.every((a) => !others.has(a)), "catalog import: no spec column claims a header or alias another catalog column owns");
  ok(new Set(mine).size === mine.length, "catalog import: no two spec columns claim the same alias");

  // The wipe bug: a price-only row must carry no spec key at all.
  const lib = {
    sections: [{ id: "ss-i", number: "11 61 43", title: "Curtains", sort: 1, part1: [], part3: [], part2Style: "paragraphs" as const, quantities: "drawings" as const, updatedAt: 1, updatedBy: "t" }],
    articles: [{ id: "ar-i", sectionId: "ss-i", sort: 1, title: "Theatrical Stage Drapes", manufacturers: [], general: "", categoryKeys: [], updatedAt: 1, updatedBy: "t" }],
  };
  const stored = { sku: "SP-1", desc: "Drape", category: "Curtains", unit: "ea", list: 10, cost: 5, mfr: "Rose Brand", specBody: "Authored text.", specState: "authored" };
  const priceOnly = prepareRows([["SP-1", "12"]], autoMap(["SKU", "List Price"], cat.fields), cat.fields);
  const pricePatch = catalogPatch(priceOnly.rows[0].values, stored, "SP-1", { now: 1, specLib: lib });
  ok(SPEC_KEYS.every((k) => !(k in pricePatch)), "catalog import: a price-only row carries no spec key, so it cannot wipe or demote");

  const withText = prepareRows([["SP-1", "New text."]], autoMap(["SKU", "Spec Body"], cat.fields), cat.fields);
  const textPatch = catalogPatch(withText.rows[0].values, stored, "SP-1", { now: 7, by: "Jeff", specLib: lib });
  ok(textPatch.specBody === "New text." && textPatch.specState === "draft" && textPatch.specUpdatedAt === 7, "catalog import: changed text lands as draft, stamped by the writer's clock");
  const same = prepareRows([["SP-1", "Authored text."]], autoMap(["SKU", "Spec Body"], cat.fields), cat.fields);
  ok(!("specState" in catalogPatch(same.rows[0].values, stored, "SP-1", { specLib: lib })), "catalog import: re-importing unchanged text keeps its state");

  const ptr = prepareRows([["SP-1", "11-61-43", "theatrical stage drapes"]], autoMap(["SKU", "Spec Section", "Spec Article"], cat.fields), cat.fields);
  const ptrPatch = catalogPatch(ptr.rows[0].values, stored, "SP-1", { specLib: lib });
  ok(ptrPatch.specSectionId === "ss-i" && ptrPatch.specArticleId === "ar-i", "catalog import: Spec Section / Spec Article resolve to the canonical pointers");
  const legacy = prepareRows([["SP-1", "Stage Lighting Instruments"]], autoMap(["SKU", "Spec Article"], cat.fields), cat.fields);
  const legacyPatch = catalogPatch(legacy.rows[0].values, stored, "SP-1", { specLib: lib });
  ok(!("specArticleId" in legacyPatch) && legacyPatch.productMetadata?.specArticle === "Stage Lighting Instruments", "catalog import: an unresolvable Spec Article is kept as legacy text, never dropped");
}
```

If `prepareRows`' `rows[i].values` is named differently, match the existing catalogPatch assertions at `:4898-4960`, which build rows the same way.

- [ ] **Step 4: Round-trip it by hand**

```bash
npm run dev
```
Download the catalog template from `/import` and confirm the seven spec columns are present, with `Spec Section` and `Spec Article` each appearing **once**. Paste back two rows: one with a multi-line quoted `Spec Body`, and one with only `SKU` and `List`. On commit, confirm the first lands as `draft` with its indentation intact, and that the second leaves the first row's spec text **and state** alone. Export the catalog, re-import the file unchanged, and confirm no authored part turned into a draft.

- [ ] **Step 5: Run, typecheck, commit**

```bash
npm run test:specs
PGLITE_PATH=$(mktemp -d) npx tsx scripts/test-review-regressions.ts   # the #133/#137 catalog import blocks at :795-930 must stay green
npx tsc --noEmit -p .
git add "src/app/(app)/import/types.ts" "src/app/(app)/import/registry.ts" "src/app/(app)/catalog/import.ts" scripts/test-review-and-spec.ts
git commit -m "feat(specs): the catalog importer carries the canonical spec columns, landing changed text as drafts"
```

---

### Task 15: Nav, smoke routes and the record

**Files:**
- Modify: `src/components/nav/nav-data.ts`
- Modify: `scripts/test-review-and-spec.ts` (the Design nav assertions at `:1510-1545`)
- Modify: `scripts/smoke-routes.ts`
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md`

- [ ] **Step 1: The nav entry**

In `src/components/nav/nav-data.ts`, add to the DESIGN group's `children` (`nav-data.ts:87-98`), after `The Grid` (the `designs` key, `:95`):

```ts
      { key: "specs", label: "Specs", href: "/design/specs" },
```

`activeKeyFor` (`:118`) maps the **first path segment only**, so `/design/specs` would otherwise light up `designoverview`. Add an explicit exception directly below the existing `/design/assemblies` one (`:124-126`):

```ts
  if (pathname.startsWith("/design/specs")) return "specs";
```

Do not touch the `/design/engagements` fallthrough — that Consulting pill has never lit on its own pages and fixing it is a separate change with its own blast radius.

**The harness pins the Design children.** `scripts/test-review-and-spec.ts:1538-1545` asserts the exact `DESIGN_CHILDREN` array, so adding `specs` fails it. A parallel branch also adds a "Grid Settings" child after "The Grid", and the lead reconciles the two at merge. Write the check so it tolerates that: it asserts that `specs` is present and positioned per this plan, not the whole array. Replace the exact-equality `ok(...)` with:

```ts
const DESIGN_CHILDREN = [
  "designoverview", "engagements", "designs",
  "lineset", "assemblies", "motors",
];
const designKeys = designGroup && designGroup.kind === "group" ? designGroup.children.map((c) => c.key) : [];
const inOrder = DESIGN_CHILDREN.map((k) => designKeys.indexOf(k));
ok(
  inOrder.every((i) => i >= 0) && inOrder.every((i, n) => n === 0 || i > inOrder[n - 1]),
  `Design keeps [${DESIGN_CHILDREN.join(", ")}] in order (other children may sit between them)`
);
ok(
  designKeys.includes("specs") &&
    designKeys.indexOf("specs") > designKeys.indexOf("designs") &&
    designKeys.indexOf("specs") < designKeys.indexOf("lineset"),
  "Design carries Specs after The Grid and before the Lineset Builder"
);
ok(activeKeyFor("/design/specs") === "specs" && activeKeyFor("/design/specs/library") === "specs",
  "/design/specs/* lights the Specs child, not the Design overview");
```

Keep the comment block above it (`:1529-1537`), and add one line to it: `specs` joined in the Specs module (D-SPEC); the check became order-tolerant so parallel additions don't collide.

- [ ] **Step 2: Smoke routes**

In `scripts/smoke-routes.ts`, add to `ROUTES`:

```ts
  "/design/specs/library",
  "/design/specs/templates",
```

and to `DYNAMIC_ROUTES` — pick a section id that the starter sections actually mint by reading one at runtime is not possible in a static array, so instead add the two routes whose ids are stable:

```ts
  { route: "/design/specs" },                              // redirects to the library
  { route: "/design/specs/templates/fixtures" },           // the starter formula's slug
  { route: "/design/specs/templates/curtain-Leg" },        // the starter curtain template
```

The harness follows redirects: see the `/design/fixtures` entry's comment at `smoke-routes.ts:107`, and `looksLikeErrorPage` judges the *final* path. So `/design/specs` needs **no** `reject`. It passes as long as the redirect lands on a 200 library page, not on `/login` or a 5xx.

- [ ] **Step 3: D-SPEC-1 … D-SPEC-8**

D161 and #142 are taken. Write **placeholder** numbers — the lead renumbers at merge time. Append to `DECISIONS.md`, following the house heading style (`## D-SPEC-1. <one-line summary> (#SPEC, <date>)`) and the length of the recent entries (D245-D250 are the models). There is one entry per numbered item in "Decisions this plan takes" above, `D-SPEC-1` … `D-SPEC-8` in that order, and each entry states its reason. Entries 5-8 must carry: the exact legacy→canonical mapping table and its invariants from Task 6 Step 4, plus the import-column aliasing and the blank-`Spec State` export rule from Task 14; the full list of gated consumers from Task 6 Step 5; the `create` visibility of the Spec panel; and why there is no `model` field. `D-SPEC-1`'s body additionally covers, each in its own short paragraph:

- The module and its anchor: the library lives under `/design/specs`; product language lives on the catalog part; only `authored` text prints.
- The outline convention verbatim, and that article numbers are `1.1`/`2.1`/`3.1`, superseding D94's `2.01` for anything this module renders.
- `specSameAs` resolves one hop; a chain or a cycle reports "no spec" naming the target, because following chains would make a spec's provenance unknowable from the part alone.
- Category articles and the resolution order (explicit → category default → legacy `specSectionId` → nothing), and that a category default is a pre-placement, not language.
- Imported rows land as `draft` and are gated until someone opens the part and saves; the seed rows are the exception and land `authored` because they came from a finished bid document a human signed off on.
- Pointers to `D-SPEC-2` … `D-SPEC-8` (the redirect, starter seeding on every environment, fields on `CatalogPart`, one set of spec pointers, drafts gated everywhere, the panel's `create` visibility, no `model` field), so a reader landing on the module entry finds them.
- Explicitly out of scope for Phase A, so a later reader does not think it was missed: the generator, the four doors, docx/zip output, the `spec-writer` skill and the North HS seed — all Phase B and C of the same spec.

- [ ] **Step 4: #SPEC**

Append to `PUNCHLIST.md` (placeholder number — the lead renumbers):

```
## SPEC. Specs module — Phase A (library) — DONE <date> (D-SPEC-1…D-SPEC-8)
```
with a paragraph naming what shipped, and a short **Still open** list: Phase B (generator, four doors, docx per section, zip, print view) and Phase C (the `spec-writer` skill and the North HS seed), plus any Minor a reviewer carried during this branch.

- [ ] **Step 5: Phase status**

In `AGENTS.md`, extend the phase list with a Specs-module line in the same voice as the existing entries, marked 🚧 with Phase A done.

- [ ] **Step 6: Commit**

```bash
git add src/components/nav/nav-data.ts scripts/smoke-routes.ts scripts/test-review-and-spec.ts DECISIONS.md PUNCHLIST.md AGENTS.md
git commit -m "feat(specs): Specs in the DESIGN nav, smoke routes, D-SPEC decisions and the #SPEC punch entry"
```

---

## Branch gates

Run all six on the branch HEAD before the whole-branch review. Report real numbers, not "passed".

```bash
ps aux | grep tsx                                   # must be empty first
npx tsc --noEmit -p .                               # 0 errors
npm run test:specs                                  # ALL PASSED, note the PASS count
PGLITE_PATH=$(mktemp -d) npx tsx scripts/test-review-regressions.ts
npm run test:smoke                                  # ALL PASSED, incl. the new routes
npx next build                                      # exit 0
npx drizzle-kit generate                            # "No schema changes, nothing to migrate"
npx eslint src scripts                              # compare against a pre-branch baseline
```

Verify the tsc binary is real before believing it: `readlink node_modules/.bin/tsc` must print `../typescript/bin/tsc`. A fresh worktree with no `node_modules` makes `npx` download a stub that exits 0 on anything.
