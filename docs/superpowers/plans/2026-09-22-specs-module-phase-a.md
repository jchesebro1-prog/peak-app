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
- **Only `specState: "authored"` ever prints.** `draft` is treated exactly like missing.
- **D141 — hand-written idempotent migrations.** `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE TRIGGER`. A new `docTable()` gets no `_seq_bump` trigger unless the migration creates one, and without it pull-sync's `WHERE seq > cursor` goes blind.
- **Outline convention (spec §2).** Plain text, one item per line, two spaces per level, a tab counts as one level. Labels by depth: `A.` `1.` `a.` `1)` `a)`. Depth beyond the fifth level clamps to the fifth and raises a warning. Blank lines are ignored. A line already starting with a label such as `A. ` or `1. ` has it stripped. Inside a product entry the product letter consumes the first level, so a body's top level prints as `1.`; inside a Part 1 or Part 3 article it prints as `A.`.
- **Article numbering is `1.1` / `2.1` / `3.1`**, never D94's `2.01`.
- **Permissions.** Reads call `requireUser()`. Every library, template, curtain-template or part-spec write calls `requirePerm("create")`. (The existing D94 actions gate on `requireUser()` only; leave them alone — changing them is out of scope for this phase.)
- **Catalog writes go through `Catalog.mergeUpsert(sku, patch)`, never `upsert`.** `upsert` replaces the whole document and will silently wipe `ports`, `trade`, datasheet fields and spec fields. See the warning comment at `src/lib/stores/catalog.ts:30-36`.
- **Timestamps are epoch-ms numbers.** Never `Date` objects, never ISO strings in stored documents.
- **Design tokens.** `pk-*` component classes and the CSS variables in `src/app/globals.css`. Accent is user-configurable and arrives as `--accent`; never hardcode an accent-coloured pixel.
- **Dev DB is single-process.** Never leave a `tsx` script running; check `ps aux | grep tsx` before starting a dev server. Never point a script at `.data/pglite` — use `PGLITE_PATH=$(mktemp -d)`.
- **Gates.** Every task ends green on `npx tsc --noEmit -p .` and `npx tsx scripts/test-review-and-spec.ts`. The branch ends green on those plus `npm run test:smoke`, `npx next build`, `npx eslint`, and `npx drizzle-kit generate` reporting "No schema changes".

## Decisions this plan takes (log them in Task 13)

These are deviations from, or refinements of, the approved spec. Each gets a `DECISIONS.md` entry under **D161**.

1. **The `spec-library` JSON import/export does NOT go through the Import hub.** Spec §4 asks for a `spec-library` import type there. The hub is strictly columnar — `parse.ts`'s header comment says so, the only file input accepts `.xlsx/.xlsm`, and every other path is the CSV paste box (see recon §5). A four-collection library document is not a table. It lands instead as **Export library / Import library** controls on `/design/specs/library`, reading and writing the same JSON shape the spec describes, so the `spec-writer` skill's output still loads unchanged. The *catalog* spec columns stay in the hub exactly as specified, because those are rows.
2. **`/design/specs` redirects to `/design/specs/library` in Phase A.** The Generated list is Phase B; a nav entry pointing at an empty placeholder is worse than one pointing at the screen that does something.
3. **Starter templates seed outside the demo-data flag.** `DEMO_COLLECTIONS` is `Object.keys(DOC_TABLES)` (`src/db/seed-data.ts:145-147`), so the go-live reset wipes every doc collection including `spec_templates`. The starter formulas are configuration, not demo data, so `seedIfEmpty()` calls an idempotent `seedStarterTemplates()` regardless of the demo flag, and the Templates screen carries a **Restore starter templates** button for after a go-live reset.
4. **Spec fields are declared on `CatalogPart` itself**, and `PartSpecFields` in `src/lib/bid-spec.ts` becomes a `Pick<>` of those, so `SpecCatalogPart` stays assignable and every existing D94 call site keeps compiling.

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
| `drizzle/0025_spec_library.sql` | The three new tables, idempotent. |
| `drizzle/meta/0025_snapshot.json` | Chained snapshot. |

**Modified**

| File | Change |
|------|--------|
| `src/db/doc-tables.ts` | Three `docTable()` registrations + `DOC_TABLES` entries. |
| `src/db/seed-data.ts` | Call `seedStarterTemplates()` from `seedIfEmpty()`. |
| `src/lib/stores/spec-sections.ts` | `SpecArticle`, `part1`/`part3` as articles with legacy-string reads, `part2Style`, `quantities`, article CRUD helpers. |
| `src/lib/bid-spec.ts` | `PartSpecFields` becomes a `Pick<CatalogPart>`; `assemble`/`renderSpecHtml` read Part 1/Part 3 as articles. |
| `src/lib/bid-spec-docx.ts` | Same article read. |
| `src/lib/stores/catalog.ts` | `CatalogPart` gains `model?` and the eight spec fields. |
| `src/app/(app)/catalog/page.tsx` | `model` input in the part form; mount `<SpecPanel>` beside `<PartDatasheetControl>`. |
| `src/app/(app)/catalog/actions.ts` | `upsertPart` carries `model`; new `writePartSpecFieldsAction`. |
| `src/lib/design/grid-bom.ts` | `GridCurtain.color?`. |
| `src/app/(app)/design/grid/[id]/curtain-drop.tsx` | Optional Colour field. |
| `src/app/(app)/import/types.ts` | Seven new `catalog` columns. |
| `src/app/(app)/import/registry.ts` | Write those columns through `catalogPatch`. |
| `src/components/nav/nav-data.ts` | `specs` entry + `activeKeyFor` exception. |
| `scripts/test-review-and-spec.ts` | New assertion blocks per task. |
| `scripts/smoke-routes.ts` | The module's GET routes. |
| `DECISIONS.md`, `PUNCHLIST.md` | D161 and #142. |

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

Run: `npx tsx scripts/test-review-and-spec.ts`
Expected: the run aborts before printing any PASS/FAIL with `Cannot find module '@/lib/specs/outline'` (the harness is one file with a single import block at the top, so a missing module is a resolution error, not a FAIL line).

- [ ] **Step 3: Write the implementation**

Create `src/lib/specs/outline.ts`:

```ts
/**
 * The Specs module's text engine (Phase A, D161).
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

Run: `npx tsx scripts/test-review-and-spec.ts`
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
export const specArticles = docTable("spec_articles"); // Specs module (D161) — Part 2 category articles: manufacturers + the "A. General" clause; migration 0025_spec_library
export const specTemplates = docTable("spec_templates"); // Specs module (D161) — per-category authoring formulas (headings + guidance + a worked example); migration 0025_spec_library
export const specCurtainTemplates = docTable("spec_curtain_templates"); // Specs module (D161) — one document per Grid curtain type; migration 0025_spec_library
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
-- Specs module (D161), Phase A — the three new library collections.
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
- Modify: `src/lib/bid-spec-docx.ts` (only if it reads `section.part1`/`part3` directly — check with `grep -n 'part1\|part3' src/lib/bid-spec-docx.ts`)
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
  `src/lib/stores/spec-sections.ts` re-exports every one of those types so existing `import type { SpecSection } from "@/lib/stores/spec-sections"` lines keep working, and adds `getSection(id)`.

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

Run: `npx tsx scripts/test-review-and-spec.ts`
Expected: aborts with `Cannot find module '@/lib/specs/sections'`.

- [ ] **Step 3: Write the pure module**

Create `src/lib/specs/sections.ts`:

```ts
/**
 * Section shape for the Specs module (D161), split out of the store so it
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
import { getDoc, listDocs, patchDoc, upsertDoc } from "@/db/doc-store";
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

/** Idempotent — safe to call from the library screen's "add the starter sections" button. */
export async function seedStarterSections(by: string): Promise<number> {
  const existing = await allSections();
  const have = new Set(existing.map((s) => s.number));
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

Run `grep -n 'part1\|part3\|spec-sections' src/lib/bid-spec-docx.ts src/app/\(app\)/design/engagements/spec/*.tsx src/app/\(app\)/design/engagements/spec/*.ts` and apply the same `partText(...)` treatment anywhere else a `SpecSection`'s part is used as a string. `AssembledSection.part1` stays `string` — nothing downstream of `assemble` changes in this phase.

- [ ] **Step 6: Run the tests and typecheck**

```bash
npx tsx scripts/test-review-and-spec.ts
npx tsc --noEmit -p .
```
Expected: `ALL PASSED` including every new `sections:` line, and tsc exit 0. The pre-existing `/* --- assembly --- */` block must still pass — if its fixture builds a section with string parts, it is exercising exactly the legacy path this task added, so leave it as it is.

- [ ] **Step 7: Commit**

```bash
git add src/lib/specs/sections.ts src/lib/stores/spec-sections.ts src/lib/bid-spec.ts src/lib/bid-spec-docx.ts scripts/test-review-and-spec.ts
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

Run: `npx tsx scripts/test-review-and-spec.ts` — aborts with `Cannot find module '@/lib/specs/articles'`.

- [ ] **Step 3: Write the pure module**

Create `src/lib/specs/articles.ts`:

```ts
import type { SpecSection } from "@/lib/specs/sections";

/**
 * Part 2 category articles (D161) — "2.1 Stage Drapes", "2.3 Packaged Hoists".
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

Create `src/lib/stores/spec-articles.ts`:

```ts
import { getDoc, listDocs, patchDoc, softDeleteDoc, upsertDoc } from "@/db/doc-store";
import { normalizeArticle, type SpecCategoryArticle } from "@/lib/specs/articles";

export type { SpecCategoryArticle };

function uid(): string {
  return "ar-" + Math.random().toString(36).slice(2, 10);
}

export async function allArticles(): Promise<SpecCategoryArticle[]> {
  const list = await listDocs<unknown>("spec_articles");
  return list
    .map(normalizeArticle)
    .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
}

export async function getArticle(id: string): Promise<SpecCategoryArticle | null> {
  const raw = await getDoc<unknown>("spec_articles", id);
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
npx tsx scripts/test-review-and-spec.ts
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
  const made = await SpecTemplates.seedStarterTemplates("Seed");
  assert(made === SpecTemplates.STARTER_TEMPLATES.length, "templates: the first seed writes every starter");
  const again = await SpecTemplates.seedStarterTemplates("Seed");
  assert(again === 0, "templates: seeding twice writes nothing");
  const all = await SpecTemplates.allTemplates();
  assert(all.length === SpecTemplates.STARTER_TEMPLATES.length, "templates: the collection holds exactly the starters");

  await SpecTemplates.saveTemplate({ key: "Fixtures", title: "Lighting Fixture", headings: [{ label: "X", guidance: "Y" }], rules: "R", example: "E" }, "Jeff");
  const edited = await SpecTemplates.getTemplate(SpecTemplates.templateId("Fixtures"));
  assert(edited?.headings.length === 1 && edited.example === "E", "templates: saving by an existing key replaces that formula, not a duplicate");
  assert((await SpecTemplates.allTemplates()).length === all.length, "templates: saving an existing key adds no row");
  assert((await SpecTemplates.seedStarterTemplates("Seed")) === 0, "templates: re-seeding never overwrites an edited formula");

  const curtains = await SpecCurtainTemplates.seedStarterCurtainTemplates("Seed");
  assert(curtains === 4, "curtain templates: one starter per Grid curtain type");
  const leg = await SpecCurtainTemplates.getCurtainTemplate("Leg");
  assert(!!leg && leg.id === "Leg", "curtain templates: the id is the curtain type");
  assert(!!leg && ["0", "50", "75", "100"].every((k) => !!leg.fullnessClauses[k as "0"]), "curtain templates: all four fullness clauses ship");
  assert(!!leg && leg.body.includes("{{material}}") && leg.body.includes("{{fullnessClause}}"), "curtain templates: the starter body carries its slots");
  assert((await SpecCurtainTemplates.seedStarterCurtainTemplates("Seed")) === 0, "curtain templates: seeding twice writes nothing");
}
```

Add the two imports to that harness's import block (`import * as SpecTemplates from "@/lib/stores/spec-templates";` and the curtain equivalent), following whatever namespace-import style the surrounding lines use.

- [ ] **Step 2: Run both to verify they fail**

```bash
npx tsx scripts/test-review-and-spec.ts
PGLITE_PATH=$(mktemp -d) npx tsx scripts/test-review-regressions.ts
```
Expected: both abort on the missing modules. Check `ps aux | grep tsx` afterwards and kill anything still alive.

- [ ] **Step 3: Write the template store**

Create `src/lib/stores/spec-templates.ts`:

```ts
import { getDoc, listDocs, upsertDoc, softDeleteDoc } from "@/db/doc-store";

/**
 * Authoring formulas (D161). A template is not spec text — it is the shape of
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
  const list = await listDocs<unknown>("spec_templates");
  return list.map(normalize).sort((a, b) => a.key.localeCompare(b.key));
}

export async function getTemplate(id: string): Promise<SpecTemplate | null> {
  const raw = await getDoc<unknown>("spec_templates", id);
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
```

- [ ] **Step 4: Write the curtain-template store**

Create `src/lib/stores/spec-curtain-templates.ts`:

```ts
import { getDoc, listDocs, upsertDoc } from "@/db/doc-store";
import { GRID_CURTAIN_TYPES, type GridCurtainType } from "@/lib/design/grid-bom";

/**
 * One template per Grid curtain type (D161). The Grid mints SKU "CURTAIN" for
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
  const list = await listDocs<unknown>("spec_curtain_templates");
  return list.map(normalize).sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
}

export async function getCurtainTemplate(type: GridCurtainType): Promise<SpecCurtainTemplate | null> {
  const raw = await getDoc<unknown>("spec_curtain_templates", type);
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

In `src/db/seed-data.ts`, inside `seedIfEmpty(db)` and **after** the settings row is ensured, add:

```ts
  // The starter formulas are configuration, not demo data: DEMO_COLLECTIONS is
  // Object.keys(DOC_TABLES), so the go-live reset wipes spec_templates too.
  // Both seeds are idempotent by key, so this is safe on every open.
  await seedStarterTemplates();
  await seedStarterCurtainTemplates();
```
with the two imports at the top of the file. Do **not** add either collection to `DEMO_SEEDS` — that array only runs when demo data is on.

- [ ] **Step 6: Run both harnesses, typecheck, commit**

```bash
npx tsx scripts/test-review-and-spec.ts
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
- Modify: `src/lib/bid-spec.ts` (`PartSpecFields` becomes a `Pick<>`)
- Modify: `src/app/(app)/catalog/actions.ts` (`model` on `upsertPart`; new `writePartSpecFieldsAction`)
- Modify: `src/app/(app)/catalog/page.tsx` (a `model` input in the part form)
- Test: `scripts/test-review-regressions.ts`

**Interfaces:**
- Consumes: `PartSpecState` and the resolution helpers from Task 4.
- Produces: `CatalogPart` with `model?` and the eight spec fields; `writePartSpecFieldsAction(input): Promise<Result>` for Task 11's panel.

- [ ] **Step 1: Declare the fields**

In `src/lib/stores/catalog.ts`, add to the `CatalogPart` type (keep each field's comment — these are the only documentation an importer or a future reader gets):

```ts
  /** Manufacturer model number. Catalog SKUs are Peak's own ids, so the
   *  table-style Model column needs the real one; it falls back to the SKU. */
  model?: string;

  /* --- Specs module (D161). All additive JSONB, no migration. --- */
  /** The Part 2 category article this part's entry prints under. Replaces
   *  D94's specSectionId, which is still read as a fallback. */
  specArticleId?: string;
  /** D94's pointer, kept so old parts still resolve. Never written again. */
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
  /** draft = imported from the skill and not yet reviewed. Only "authored"
   *  text ever prints. */
  specState?: "authored" | "draft";
  /** Provenance: "authored", "seed:northhs-2026-07-30", "skill:<date>". */
  specSource?: string;
  specUpdatedAt?: number;
  specUpdatedBy?: string;
```

In `src/lib/bid-spec.ts`, replace the `PartSpecFields` declaration with a `Pick<>` so `SpecCatalogPart = CatalogPart & PartSpecFields` stays assignable and every existing call site keeps compiling:

```ts
/** Spec fields carried on a catalog part (D94, extended by D161). Declared on
 *  CatalogPart itself now — this alias is kept so the D94 call sites read the
 *  same. */
export type PartSpecFields = Pick<
  CatalogPart,
  "specArticleId" | "specSectionId" | "specTitle" | "specBody" | "specSameAs" | "specSort" | "specState" | "specSource"
>;
```

- [ ] **Step 2: Carry `model` through the part form**

In `src/app/(app)/catalog/actions.ts`, add `model` to `upsertPart`'s `mergeUpsert` patch alongside `mfr` (the action is at `catalog/actions.ts:38-55`; its comment at 30-36 explains why the patch must stay a merge). In `src/app/(app)/catalog/page.tsx`'s `PartFormModal`, add a **Model** text input beside the existing Manufacturer input, `name="model"`, `defaultValue={part?.model ?? ""}`.

- [ ] **Step 3: Add the spec write action**

Append to `src/app/(app)/catalog/actions.ts`, following that file's existing `Result` idiom:

```ts
export async function writePartSpecFieldsAction(input: {
  sku: string;
  specArticleId?: string;
  specTitle?: string;
  specBody?: string;
  specSameAs?: string;
  specSort?: number;
}): Promise<Result> {
  await requirePerm("create");
  const sku = String(input.sku || "").trim();
  if (!sku) return { ok: false, error: "A part is required." };
  const part = await Catalog.get(sku);
  if (!part) return { ok: false, error: `Part ${sku} not found.` };

  const sameAs = String(input.specSameAs || "").trim();
  if (sameAs && sameAs.toUpperCase() === sku.toUpperCase()) {
    return { ok: false, error: "A part cannot be the same spec as itself." };
  }
  if (sameAs) {
    const target = await Catalog.get(sameAs);
    if (!target) return { ok: false, error: `Same spec as ${sameAs} — no such part.` };
    if ((target.specSameAs || "").trim()) {
      return { ok: false, error: `${sameAs} is itself a "same spec as" pointer — point at the part that holds the text.` };
    }
  }

  const user = await requireUser();
  try {
    // mergeUpsert, never upsert: the part carries ports, trade, pricing and
    // datasheet fields this action knows nothing about.
    await Catalog.mergeUpsert(sku, {
      specArticleId: String(input.specArticleId || "").trim() || undefined,
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

Check the surrounding file for the exact names of the `Catalog` namespace import, `Result`, `requirePerm`, `requireUser` and `revalidatePath`, and match them.

- [ ] **Step 4: Write the regression assertions**

In `scripts/test-review-regressions.ts`:

```ts
/* --- specs: part spec fields --- */
{
  await Catalog.upsert({ sku: "SPEC-1", desc: "Profile fixture", category: "Fixtures", unit: "ea", list: 100, cost: 50, mfr: "ETC", ports: [{ kind: "dmx", n: 1 }] } as never);
  const before = await Catalog.get("SPEC-1");
  assert(!!before?.ports?.length, "part spec: the fixture starts with ports");

  const r = await writePartSpecFieldsAction({ sku: "SPEC-1", specArticleId: "ar-fix", specTitle: "LED PROFILE FIXTURE", specBody: "Basis of Design: ETC ColorSource Spot" });
  assert(r.ok, "part spec: the write succeeds");
  const after = await Catalog.get("SPEC-1");
  assert(after?.specTitle === "LED PROFILE FIXTURE", "part spec: the title lands");
  assert(after?.specState === "authored" && after?.specSource === "authored", "part spec: saving stamps authored");
  assert(!!after?.specUpdatedAt && !!after?.specUpdatedBy, "part spec: saving stamps who and when");
  assert(!!after?.ports?.length, "part spec: mergeUpsert left ports alone");
  assert(after?.list === 100 && after?.cost === 50, "part spec: mergeUpsert left pricing alone");

  const self = await writePartSpecFieldsAction({ sku: "SPEC-1", specSameAs: "SPEC-1" });
  assert(!self.ok, "part spec: a part cannot be the same spec as itself");
  const missing = await writePartSpecFieldsAction({ sku: "SPEC-1", specSameAs: "NOPE" });
  assert(!missing.ok, "part spec: same-as to a missing SKU is refused at the action boundary");

  await Catalog.upsert({ sku: "SPEC-2", desc: "Second", category: "Fixtures", unit: "ea", list: 1, cost: 1 } as never);
  await writePartSpecFieldsAction({ sku: "SPEC-2", specSameAs: "SPEC-1" });
  const chain = await writePartSpecFieldsAction({ sku: "SPEC-1", specSameAs: "SPEC-2" });
  assert(!chain.ok, "part spec: pointing at a pointer is refused");
}
```

If the harness runs without a signed-in user, `requirePerm` will redirect — follow whatever the surrounding regression blocks already do to call a permission-gated action (grep the file for `requirePerm` or for an existing action call), and if there is no precedent, call `Catalog.mergeUpsert` directly in the assertions and cover the action's validation branches by exporting a pure `validateSameAs(sku, sameAs, target)` helper from the actions file's sibling module instead. State in your report which route you took and why.

- [ ] **Step 5: Run, typecheck, commit**

```bash
PGLITE_PATH=$(mktemp -d) npx tsx scripts/test-review-regressions.ts
npx tsc --noEmit -p .
git add src/lib/stores/catalog.ts src/lib/bid-spec.ts src/app/\(app\)/catalog/actions.ts src/app/\(app\)/catalog/page.tsx scripts/test-review-regressions.ts
git commit -m "feat(specs): catalog parts carry model and their own approved spec language"
```

---

### Task 7: Curtains — a colour on the placement, a filler for the template

**Files:**
- Create: `src/lib/specs/curtains.ts` (pure)
- Modify: `src/lib/design/grid-bom.ts` (one optional field on `GridCurtain`)
- Modify: `src/app/(app)/design/grid/[id]/curtain-drop.tsx` (one optional input)
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

- [ ] **Step 2: Run to verify it fails.** `npx tsx scripts/test-review-and-spec.ts` — aborts on the missing module.

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

In `src/app/(app)/design/grid/[id]/curtain-drop.tsx`, add an optional **Color** text input to the form, placed after the fabric picker and before the confirm row, labelled `Color (optional)` with placeholder `Black`. Carry its value into the object the component passes to `onConfirm`, as `color: value.trim() || undefined`. Leave every existing field, the fullness picker and the pricing preview untouched — nothing about the BOM or a curtain's price may change in this task. Verify by reading `editor.tsx`'s `<CurtainDrop` call site (around line 2169) that `onConfirm`'s parameter type flows from `GridCurtain`, so the new field needs no separate prop plumbing; if it does not, widen the callback's type rather than casting.

- [ ] **Step 6: Run, typecheck, commit**

```bash
npx tsx scripts/test-review-and-spec.ts
npx tsc --noEmit -p .
git add src/lib/specs/curtains.ts src/lib/design/grid-bom.ts src/app/\(app\)/design/grid/\[id\]/curtain-drop.tsx scripts/test-review-and-spec.ts
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

**Idiom to follow:** `src/app/(app)/vendors/page.tsx` (server component: `requireUser()`, parallel `Promise.all` loads, `searchParams` awaited) and `src/app/(app)/vendors/[id]/overview-tab.tsx` (client: `useTransition`, `run()` helper, `{ok:false}` rendered as an error line under the control). Read both before writing.

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
import type { SpecArticle, SpecPart2Style, SpecQuantities } from "@/lib/specs/sections";

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

function revalidate(sectionId?: string) {
  revalidatePath("/design/specs/library");
  if (sectionId) revalidatePath(`/design/specs/library/${sectionId}`);
}

export async function createSectionAction(input: { number: string; title: string; sort?: number }): Promise<Result<{ id: string }>> {
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
    console.error("createSectionAction", e);
    return { ok: false, error: "Could not create the section. Try again." };
  }
}

export async function updateSectionAction(
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
    console.error("updateSectionAction", e);
    return { ok: false, error: "Could not save the section. Try again." };
  }
}

export async function seedSectionsAction(): Promise<Result<{ made: number }>> { /* Sections.seedStarterSections, same shape */ }

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

Write out every one of the stubbed bodies in full, each exactly like `createSectionAction`: validate the required strings, wrap the store call in try/catch, `console.error` with the action's name, return a plain-English error, `revalidate()` the affected paths on success. `deleteArticleAction` additionally refuses when any catalog part still points at the article:

```ts
  const parts = await Catalog.list();
  const used = parts.filter((p) => p.specArticleId === id);
  if (used.length) {
    return { ok: false, error: `${used.length} part${used.length === 1 ? "" : "s"} still print under this article — move them first.` };
  }
```

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
2. A **Sections** table — number, title, how many Part 1 and Part 3 articles it has, its Part 2 style, its quantities policy, and how many category articles sit under it. Each row links to `/design/specs/library/<id>`. Above it, an **+ Add section** inline form (number, title, sort) calling `createSectionAction`, and, only when there are no sections at all, an **Add the starter sections** button calling `seedSectionsAction`.
3. A **Part 2 articles** table grouped by section — article title, the number it will print as (`2.1`, `2.2`… computed from its position in its section's `sort` order), its manufacturers joined with `·`, its category keys as chips, and a count of parts that resolve to it. Each row links to its section editor.
4. Task 12's coverage table (leave a clearly-marked mount point; that task fills it).
5. Task 11's import/export controls (same).

`controls.tsx` is `"use client"` and holds the add-section form and the seed button. Use `useTransition`, disable the control while pending, and render `{ok:false}`'s `error` as a line under the form — never a toast, never a silent failure. Follow `src/app/(app)/vendors/controls.tsx` for the exact shape.

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
- Consumes: `updateSectionAction`, `createArticleAction`, `updateArticleAction`, `deleteArticleAction` (Task 8); `parseOutline` / `outlineToText` / `substitutePlaceholders` (Task 1).
- Produces: nothing new.

- [ ] **Step 1: The server component**

`page.tsx` awaits `params` (Next 16 — `{ params }: { params: Promise<{ sectionId: string }> }`), calls `requireUser()`, loads the section with `Sections.getSection(id)` (404 via `notFound()` when null), its articles with `Articles.articlesForSection(id)`, and `Catalog.list()` for the per-article part counts. It renders `<SectionEditor section={...} articles={...} partCounts={...} />`.

- [ ] **Step 2: The client editor**

`editor.tsx` is `"use client"` and has four regions:

1. **Header card** — number, title and sort as inputs; two selects, `Part 2 style` (`paragraphs` / `table`) and `Quantities` (`drawings` — "per drawings and schedules" — / `inline` — "printed on each entry"); a **Save** button calling `updateSectionAction`. Each select carries a one-line explainer beneath it; a reviewer must be able to tell what the choice does without opening the spec.
2. **Part 1 — General** and **Part 3 — Execution**: an ordered list of articles, each a title input (placeholder `SUBMITTALS`) and a body textarea (`rows={8}`, monospace via the `pk-mono` class so indentation is legible). Controls per article: move up, move down, remove. An **+ Add article** button appends `{ id: newArticleId(), title: "", body: "" }`. The whole array is sent on **Save** through `updateSectionAction(id, { part1 })` — the editor owns the array; there is no per-article endpoint.
3. **Live preview** beside each body: run `substitutePlaceholders(body, { section: { number, title }, manufacturers: [], articles: [] })` then `parseOutline(text, "article")`, render `outlineToText(lines, "  ")` in a `<pre>`, and list `warnings` beneath it in the muted style. Recompute on change with `useMemo` — this is pure and cheap, no debounce needed.
4. **Part 2 — category articles**: one card per article with title, sort, a manufacturers editor (one per line in a textarea, split on newline, blanks dropped), a category-keys editor (comma-separated), and a `general` body textarea with its own preview, this time passing `manufacturers` so `{{manufacturers}}` renders. Each card's **Save** calls `updateArticleAction`; **Remove** calls `deleteArticleAction` and surfaces the "parts still print under this article" refusal verbatim.

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

`templates/page.tsx` — `requireUser()`, `Templates.allTemplates()` and `Curtains.allCurtainTemplates()` in one `Promise.all`. Renders a table of formulas (key, title, heading count, whether an example is written, when and by whom it was last saved), each linking to `/design/specs/templates/<id>`; then a second table of the four curtain templates, each linking to `/design/specs/templates/curtain-<type>`. A **Restore starter templates** button calls `seedTemplatesAction` and reports `made` ("Added 6 formulas" / "Everything was already there") — this is the after-a-go-live-reset path, so say plainly that it never overwrites an edited formula.

- [ ] **Step 2: The editor**

`templates/[key]/page.tsx` awaits `params`, and routes on the segment: a segment starting `curtain-` loads the curtain template for that type, anything else loads `Templates.getTemplate(segment)`; `notFound()` when neither exists.

`editor.tsx` has two exported components:

- `<TemplateEditor template={...} />` — key (read-only once created, because the id is its slug and the route depends on it), title, an ordered heading list (label + guidance per row, add/remove/move), a `rules` textarea and an `example` textarea with a live `parseOutline(example, "entry")` preview — an example is a product entry, so it must preview as `1.`, `a.`, not `A.`. Save calls `saveTemplateAction`.
- `<CurtainTemplateEditor template={...} articles={...} />` — title, the article picker (`articleId`, from the Part 2 articles across all sections, so a curtain entry knows where it prints), sort, the body textarea, the four fullness clauses, `hang`, `defaultColor`. Beneath the body, a **Preview with a sample curtain** block calling `fillCurtainTemplate(template, sample, "22oz Velour")` with `sample = { type, name: "Sample " + type, widthFt: 10, heightFt: 24, fullnessPct: 50, fabricSku: "SAMPLE" }`, then `parseOutline(body, "entry")`. Any slot left unfilled shows up as literal `{{…}}` in that preview, which is the point. Save calls `saveCurtainTemplateAction`.

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
}>;
```

- [ ] **Step 1: Write the failing regression assertions**

```ts
/* --- specs: library import/export --- */
{
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
}
```

- [ ] **Step 2: Write the module**

`exportLibrary()` reads all four collections in one `Promise.all` and returns the object above.

`parseLibraryFile(text)` `JSON.parse`es inside a try/catch, checks `kind === "peak-spec-library"` and `version === 1`, checks each of the four keys is an array (missing arrays default to `[]` — a skill-produced file may carry only articles), and returns `{file, error}`. It never throws.

`importLibrary(file, by)` upserts each record by its own id: sections through `Sections.updateSection` when `getSection(id)` finds one and `upsertDoc` otherwise, articles through `Articles.updateArticle`/`createArticle` the same way, templates through `Templates.saveTemplate` (already keyed by slug, so idempotent), curtain templates through `Curtains.saveCurtainTemplate` (keyed by type). Every record gets `updatedBy: by` and a fresh `updatedAt`. It returns the four counts. **It never deletes** — an import adds and updates, so a partial file from the skill cannot destroy the library.

- [ ] **Step 3: Wire the export route and the two controls**

`src/app/api/spec-library/route.ts` — `GET` calls `requireUser()`, then `exportLibrary()`, and returns the JSON with
`Content-Disposition: attachment; filename="peak-spec-library-<YYYY-MM-DD>.json"`. Follow `src/app/api/spec/[id]/docx/route.ts` for the response idiom, but gate with `requireUser()` rather than a bare `auth()`.

In `actions.ts`, add:

```ts
export async function importLibraryAction(text: string): Promise<Result<{ sections: number; articles: number; templates: number; curtainTemplates: number }>> {
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

In `controls.tsx`, add an **Import / Export** card: an `Export library` link to `/api/spec-library`, and an `Import library` control — a `<input type="file" accept="application/json,.json">` that reads the file with `await file.text()` in the browser and passes the string to `importLibraryAction`, then reports `Imported 5 sections, 12 articles, 6 formulas, 4 curtain templates.` or the error. Size-guard the read at 5 MB with a clear message, mirroring the catalog importer's 1 MB cap in spirit (`src/lib/catalog-import-guard.ts`).

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
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
```ts
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
 *  real CatalogPart is structurally assignable with no cast. */
export type CoveragePart = SpecPartLike & { desc?: string; datasheetName?: string };
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
import { skusFromQuoteSpec, skusOnBomSince, coverageRows, filterCoverage, ON_BOM_WINDOW_MS } from "@/app/(app)/design/specs/coverage";
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

`coverageRows` maps every catalog part through `articleIdForPart(part, articles, sections)` and `specStateOf(part, bySku)` from Task 4, where `bySku` is built once from `parts`.

`filterCoverage` applies, in order: `articleId` (exact, `null` matching only when the filter asks for the literal string `"none"`), `state` (skipped when `"all"` or absent), `onBomOnly`, `datasheetOnly`, then `q` as a case-insensitive substring over `sku + " " + desc`.

- [ ] **Step 3: Mount it**

In `library/page.tsx`, extend the `Promise.all` with `Quotes.list()`, `GridProjects.list()` and the generated-specs list (grep for the existing list helpers on each store; do not reach into `listDocs` directly from a page). Compute `onBom = skusOnBomSince({...}, Date.now() - ON_BOM_WINDOW_MS)` and `rows = coverageRows(...)`, read the filters from `searchParams` (`article`, `state`, `bom`, `datasheet`, `q`), and render a table: SKU (linking to `/catalog?sku=<sku>` so the part opens where it is edited — check the catalog page actually honours a `sku` query param, and if it does not, link to `/catalog` and say so in your report), description, article, state chip, "on a BOM" tick, datasheet tick. Cap the rendered rows at 300 with a "showing 300 of N — narrow the filters" line; the catalog is ~10.7k rows and this table must never try to render all of them.

The filter controls go in `controls.tsx` as a `SearchFilterBar` (`src/components/search/search-filter-bar.tsx`) so the search box and the dropdowns share one line, per #121 — that component exists precisely for this.

- [ ] **Step 4: Run, typecheck, commit**

```bash
npx tsx scripts/test-review-and-spec.ts
npx tsc --noEmit -p .
git add src/app/\(app\)/design/specs scripts/test-review-and-spec.ts
git commit -m "feat(specs): per-article coverage table with on-a-BOM and datasheet filters"
```

---

### Task 13: The Spec panel on the part editor

**Files:**
- Create: `src/app/(app)/catalog/spec-panel.tsx`
- Modify: `src/app/(app)/catalog/page.tsx` (load articles + templates; mount the panel)

**Interfaces:**
- Consumes: `writePartSpecFieldsAction` (Task 6), `articleIdForPart` / `specStateOf` (Task 4), `parseOutline` / `substitutePlaceholders` (Task 1), `scaffoldFrom` (Task 5).

- [ ] **Step 1: Pass the data down**

`catalog/page.tsx` is already a server component. Add `Articles.allArticles()`, `Sections.allSections()` and `Templates.allTemplates()` to its existing parallel load, and pass them into `PartFormModal`. Keep the payload small: map articles to `{ id, title, sectionNumber, manufacturers }` and templates to `{ id, key, headings }` before they cross into the client component — the full records carry text no panel renders.

- [ ] **Step 2: The panel**

`spec-panel.tsx` is `"use client"`:

```tsx
export default function SpecPanel({ part, articles, templates }: {
  part: { sku: string; category?: string; specArticleId?: string; specSectionId?: string;
          specTitle?: string; specBody?: string; specSameAs?: string; specSort?: number;
          specState?: "authored" | "draft"; specSource?: string; specUpdatedAt?: number; specUpdatedBy?: string };
  articles: Array<{ id: string; title: string; sectionNumber: string; manufacturers: string[] }>;
  templates: Array<{ id: string; key: string; headings: Array<{ label: string; guidance: string }> }>;
})
```

Controls, top to bottom:

1. **State line** — a chip reading `Authored`, `Draft — not printing yet`, `Same spec as <SKU>` or `No spec language`, with `specSource` and `specUpdatedBy`/`specUpdatedAt` beside it when present. A draft says plainly that the match report treats it as missing until it is saved here.
2. **Article** — a `<select>` of the articles, each option labelled `<sectionNumber> · <title>`, plus a first option `— default from category —` whose value is `""`. When the part has no explicit `specArticleId`, show which article the category default resolves to (`articleIdForPart` with `specArticleId` blanked) as helper text beneath.
3. **Entry title** — text input, placeholder `COLOR MIXING LIGHT EMITTING DIODE PROFILE FIXTURE`.
4. **Same spec as** — text input for a SKU. When non-empty, disable the body textarea and say `This part prints <SKU>'s text.`
5. **Body** — a `pk-mono` textarea, `rows={14}`. When it is empty, an **Insert template** row of buttons, one per template, that writes `scaffoldFrom(t)` into the body. Preselect the button whose `key` matches the part's `category` case-insensitively.
6. **Sort** — number input, `specSort`.
7. **Live preview** — `substitutePlaceholders(body, { manufacturers: <the chosen article's manufacturers> })` then `parseOutline(text, "entry")`, rendered as `outlineToText(lines, "  ")` in a `<pre>` under the heading the entry will print with (`B. <specTitle or desc>`), with the warnings listed beneath. This is the whole point of the panel: the author sees the numbering they will get.
8. **Save** — calls `writePartSpecFieldsAction`, renders `{ok:false}`'s error inline, and on success calls `router.refresh()`.

Do **not** key the panel on `specUpdatedAt` (PUNCHLIST #141). Seed state from props once; after a successful save, let `router.refresh()` bring the chip up to date without remounting the textarea.

- [ ] **Step 3: Mount it**

In `PartFormModal` (`catalog/page.tsx:569-785`), directly after the existing `PartDatasheetControl` block (`:741-745`), add a matching block with the same `isAdmin && editing && part` gate:

```tsx
{isAdmin && editing && part && (
  <div style={{ marginTop: 16, paddingTop: 13, borderTop: "1px solid #f0f1f4" }}>
    <SpecPanel part={part} articles={specArticles} templates={specTemplates} />
  </div>
)}
```

The panel lives **outside** the `<form action={upsertPart}>` element (or its Save must not be a submit button), because `upsertPart` is a `FormData` action that redirects, and the spec write is a separate action with its own error surface. Verify by reading the JSX which element the datasheet control sits inside, and match it — the datasheet control has exactly this constraint and already solves it.

- [ ] **Step 4: Verify by hand**

With `npm run dev`, open `/catalog`, edit a part, write a two-level body, confirm the preview numbers it `1.` / `a.` (entry context, not `A.`), insert a template into an empty body, set **Same spec as** to a SKU that is itself a pointer and confirm the refusal shows, then save and reload and confirm the chip reads `Authored`.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit -p .
git add src/app/\(app\)/catalog/spec-panel.tsx src/app/\(app\)/catalog/page.tsx
git commit -m "feat(specs): the part editor's Spec panel — article, title, body, same-as, and a live entry preview"
```

---

### Task 14: The catalog importer carries spec columns

**Files:**
- Modify: `src/app/(app)/import/types.ts` (seven new `catalog` fields)
- Modify: `src/app/(app)/import/registry.ts` (`catalogPatch` writes them)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: nothing new; `mergeUpsert` already preserves untouched fields, which is exactly why a spec import cannot disturb pricing and a price re-import cannot disturb spec text.

- [ ] **Step 1: Declare the columns**

In `src/app/(app)/import/types.ts`, append to the `"catalog"` type's `fields` array (the type is at `types.ts:255-273`), matching the surrounding `FieldDef` style and giving each a generous alias list:

```ts
  { key: "model", header: "Model", label: "Model number", kind: "text", aliases: ["model", "model number", "model no", "mfr model", "manufacturer model", "part number", "part no"], example: "CSSPOT" },
  { key: "spec_article", header: "Spec Article", label: "Spec article", kind: "text", aliases: ["spec article", "spec_article", "article", "spec article id"], example: "ar-fixtures" },
  { key: "spec_title", header: "Spec Title", label: "Spec entry title", kind: "text", aliases: ["spec title", "spec_title", "entry title", "generic name"], example: "COLOR MIXING LED PROFILE FIXTURE" },
  { key: "spec_body", header: "Spec Body", label: "Spec text", kind: "text", aliases: ["spec body", "spec_body", "spec text", "specification"], example: "Basis of Design: ETC ColorSource Spot" },
  { key: "spec_same_as", header: "Spec Same As", label: "Same spec as SKU", kind: "text", aliases: ["spec same as", "spec_same_as", "same spec as", "same as"], example: "CS-SPOT-1" },
  { key: "spec_state", header: "Spec State", label: "Spec state", kind: "enum", options: ["authored", "draft"], aliases: ["spec state", "spec_state", "state"], example: "draft" },
  { key: "spec_source", header: "Spec Source", label: "Spec source", kind: "text", aliases: ["spec source", "spec_source", "source"], example: "skill:2026-09-22" },
```

None of them is `hidden` — the template and the export must carry them, because "export → hand to the skill → re-import" is the whole authoring loop.

Mention in the type's `blurb` that `Spec Body` is multi-line: a quoted CSV cell keeps its newlines and its interior indentation (`parse.ts`'s `parseCsv` is a real quoted-CSV state machine), but leading and trailing whitespace on the outermost edges is trimmed.

- [ ] **Step 2: Write them**

In `registry.ts`, extend `catalogPatch(v, ex, sku)` (`:162-177`). Follow its existing `num(v.x) || num(ex.x)` idiom for the shape, but note the semantics these fields need:

```ts
  // Spec columns (D161). A column absent from the file must not blank the
  // field — this is the same "column absent vs. empty" limitation catalogPatch
  // already documents for pricing, and it matters more here: a price
  // re-import must never wipe authored spec text.
  ...(v.model !== undefined ? { model: str(v.model) || undefined } : {}),
  ...(v.spec_article !== undefined ? { specArticleId: str(v.spec_article) || undefined } : {}),
  ...(v.spec_title !== undefined ? { specTitle: str(v.spec_title) || undefined } : {}),
  ...(v.spec_body !== undefined ? { specBody: String(v.spec_body ?? "") } : {}),
  ...(v.spec_same_as !== undefined ? { specSameAs: str(v.spec_same_as) || undefined } : {}),
  ...(v.spec_state !== undefined ? { specState: str(v.spec_state) === "authored" ? "authored" : "draft" } : {}),
  ...(v.spec_source !== undefined ? { specSource: str(v.spec_source) || undefined } : {}),
  ...(v.spec_body !== undefined || v.spec_title !== undefined ? { specUpdatedAt: ctx.effectiveAt ?? Date.now() } : {}),
```

Read the real signature before writing this — `catalogPatch` may not currently receive `ctx`; if it does not, thread the timestamp the same way `WRITERS.catalog` already threads `pricedAt` rather than calling `Date.now()` inside a pure patch builder. **An imported row without an explicit `spec_state` lands as `draft`**, per spec §4: unreviewed text must not print.

- [ ] **Step 3: Assert the column contract**

```ts
/* --- specs: catalog import columns --- */
{
  const cat = IMPORT_TYPES.find((t) => t.key === "catalog")!;
  const keys = cat.fields.map((f) => f.key);
  for (const k of ["model", "spec_article", "spec_title", "spec_body", "spec_same_as", "spec_state", "spec_source"]) {
    ok(keys.includes(k), `catalog import: the ${k} column exists`);
  }
  ok(cat.fields.filter((f) => f.key.startsWith("spec_") || f.key === "model").every((f) => !f.hidden), "catalog import: every spec column is advertised in the template and the export");
  ok(cat.fields.find((f) => f.key === "spec_state")!.options?.join(",") === "authored,draft", "catalog import: spec_state is an enum of exactly the two states");
  const aliases = cat.fields.flatMap((f) => f.aliases.map((a) => a.toLowerCase()));
  ok(new Set(aliases).size === aliases.length, "catalog import: no two catalog columns claim the same alias");
}
```

Use whatever the harness already imports for the import types (grep for `IMPORT_TYPES` in `scripts/test-review-and-spec.ts` — the #137 work added assertions there and the import name is already in the file).

- [ ] **Step 4: Round-trip it by hand**

```bash
npm run dev
```
Download the catalog template from `/import`, confirm the seven columns are present, paste back two rows — one with a multi-line quoted `Spec Body`, one with only `SKU` and `List` — and confirm on commit that the first lands as `draft` with its indentation intact and that the second leaves the first row's spec text alone.

- [ ] **Step 5: Run, typecheck, commit**

```bash
npx tsx scripts/test-review-and-spec.ts
npx tsc --noEmit -p .
git add src/app/\(app\)/import/types.ts src/app/\(app\)/import/registry.ts scripts/test-review-and-spec.ts
git commit -m "feat(specs): the catalog importer carries model and the spec columns, landing unreviewed rows as drafts"
```

---

### Task 15: Nav, smoke routes and the record

**Files:**
- Modify: `src/components/nav/nav-data.ts`
- Modify: `scripts/smoke-routes.ts`
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md`

- [ ] **Step 1: The nav entry**

In `src/components/nav/nav-data.ts`, add to the DESIGN group's `children` (at `nav-data.ts:79-96`), after `The Grid`:

```ts
      { key: "specs", label: "Specs", href: "/design/specs" },
```

`activeKeyFor` (`:113-157`) maps the **first path segment only**, so `/design/specs` would otherwise light up `designoverview`. Add an explicit exception beside the existing `/design/assemblies` one (`:118-121`):

```ts
  if (pathname.startsWith("/design/specs")) return "specs";
```

Do not touch the `/design/engagements` fallthrough — that Consulting pill has never lit on its own pages and fixing it is a separate change with its own blast radius.

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

Confirm `checkRoute` follows redirects (read its implementation); if it does not, give `/design/specs` a `reject` the way `/design/grid/GRD-5001` does, or drop it and note why in your report.

- [ ] **Step 3: D161**

Append to `DECISIONS.md`, following the house heading style (`## D161. <one-line summary> (<punch ref>, 2026-09-22)`) and the length of the recent entries (D156-D160 are the models). It must cover, each in its own short paragraph:

- The module and its anchor: the library lives under `/design/specs`; product language lives on the catalog part; only `authored` text prints.
- The outline convention verbatim, and that article numbers are `1.1`/`2.1`/`3.1`, superseding D94's `2.01` for anything this module renders.
- `specSameAs` resolves one hop; a chain or a cycle reports "no spec" naming the target, because following chains would make a spec's provenance unknowable from the part alone.
- Category articles and the resolution order (explicit → category default → legacy `specSectionId` → nothing), and that a category default is a pre-placement, not language.
- Imported rows land as `draft` and are gated until someone opens the part and saves; the seed rows are the exception and land `authored` because they came from a finished bid document a human signed off on.
- The four deviations from "Decisions this plan takes" above, each with its reason: the library JSON lives on the library screen rather than the Import hub (the hub is columnar); `/design/specs` redirects until Phase B; starter templates seed outside the demo flag because the go-live reset wipes every doc collection; and the spec fields are declared on `CatalogPart` itself.
- Explicitly out of scope for Phase A, so a later reader does not think it was missed: the generator, the four doors, docx/zip output, the `spec-writer` skill and the North HS seed — all Phase B and C of the same spec.

- [ ] **Step 4: #142**

Append to `PUNCHLIST.md`:

```
## 142. Specs module — Phase A (library) — DONE 2026-09-22 (D161)
```
with a paragraph naming what shipped, and a short **Still open** list: Phase B (generator, four doors, docx per section, zip, print view) and Phase C (the `spec-writer` skill and the North HS seed), plus any Minor a reviewer carried during this branch.

- [ ] **Step 5: Phase status**

In `AGENTS.md`, extend the phase list with a Specs-module line in the same voice as the existing entries, marked 🚧 with Phase A done.

- [ ] **Step 6: Commit**

```bash
git add src/components/nav/nav-data.ts scripts/smoke-routes.ts DECISIONS.md PUNCHLIST.md AGENTS.md
git commit -m "feat(specs): Specs in the DESIGN nav, smoke routes, D161 and #142"
```

---

## Branch gates

Run all six on the branch HEAD before the whole-branch review. Report real numbers, not "passed".

```bash
ps aux | grep tsx                                   # must be empty first
npx tsc --noEmit -p .                               # 0 errors
npx tsx scripts/test-review-and-spec.ts             # ALL PASSED, note the PASS count
PGLITE_PATH=$(mktemp -d) npx tsx scripts/test-review-regressions.ts
npm run test:smoke                                  # ALL PASSED, incl. the new routes
npx next build                                      # exit 0
npx drizzle-kit generate                            # "No schema changes, nothing to migrate"
npx eslint src scripts                              # compare against a pre-branch baseline
```

Verify the tsc binary is real before believing it: `readlink node_modules/.bin/tsc` must print `../typescript/bin/tsc`. A fresh worktree with no `node_modules` makes `npx` download a stub that exits 0 on anything.
