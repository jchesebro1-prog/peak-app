# Spec Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A spec builder under Design → Specs: pick a CSI section, Parts 1/3 load from the library, add products (parts with approved specs) under their category headers, fill in `[FILL IN: …]` blanks, download an editable Word file with real Word numbering.

**Architecture:** A new `spec_documents` collection stores each spec's header, products, fill-in answers and source. A pure assembler (`assembleSection`) turns section + articles + parts + spec into one outline that both the on-screen preview and the Word writer render. The Word writer uses the `docx` package with one multi-level numbering definition. Server actions mutate the spec; a route handler streams the .docx.

**Tech Stack:** Next.js 16 App Router (server components + server actions), TypeScript, Drizzle doc-store tables on PGlite/Neon, `docx` 9.x, the pure spec harness `scripts/test-review-and-spec.ts` (`npm run test:specs`).

**Design:** `docs/superpowers/specs/2026-09-26-spec-builder-design.md` (read it first).

## Global Constraints

- Work only in the worktree `/Users/sm/Downloads/peak-app/.claude/worktrees/spec-builder` (branch `feat/spec-builder`). Prefix shell commands with `export PATH=$HOME/.local/node/bin:$PATH &&`.
- Never run `npm run dev`, never open `.data/pglite`, never run `npm run test:smoke` (the lead runs it). `npm run test:specs` is safe (own temp datadir).
- Read `AGENTS.md` first ("This is NOT the Next.js you know" — check `node_modules/next/dist/docs/` before using a Next API you're unsure of).
- `"use client"` files must not import any store (`@/lib/stores/*`), `@/db/*`, `docx`, `exceljs`, or anything that transitively does. `import type` from them is fine. `npx next build` is the gate that catches this; tsc does not.
- Every server action/route that reads data: `requireUser()`; every mutation: `requirePerm("create")` (both from `@/lib/session`).
- Timestamps are epoch-ms numbers. Ids: `SP-####` from base 1000.
- Match surrounding code style: comment density, `pk-*` classes (`pk-card`, `pk-btn-outline`, `pk-btn-accent`, `pk-input`, `pk-page-title`, `pk-page-sub`, `pk-content`), mono font `var(--font-mono)` for SKUs/numbers. Never hardcode accent colors — use `var(--accent)` / `pk-btn-accent`.
- Tests: each task appends ONE block at the very END of `scripts/test-review-and-spec.ts`, marker comment `// #205 spec builder T<n>`, using the file's existing `ok(cond, msg)` helper, messages prefixed `#205 spec builder:`. Imports for the block go at the top of the block via dynamic `await import(...)` only if the file's pattern allows; otherwise add static imports near the other `@/lib/specs/*` imports (~line 300–320). Follow what the file already does.
- Gates per task: `npx tsc --noEmit -p .` (0 errors), `npm run test:specs` (0 FAIL). Final task also: `npx eslint <changed files>` (0 errors) and `npx next build`.
- Commit at the end of each task with a message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do NOT edit DECISIONS.md / PUNCHLIST.md / AGENTS.md except in Task 6.

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/db/doc-tables.ts` | `specDocuments = docTable("spec_documents")` + `DOC_TABLES` entry | 1 |
| `drizzle/0027_spec_documents.sql` + `drizzle/meta/*` | idempotent migration + trigger | 1 |
| `src/lib/specs/spec-document.ts` | pure `SpecDocument` type, normalize, product list edits | 1 |
| `src/lib/stores/spec-documents.ts` | store: create/get/list/patch/remove | 1 |
| `src/lib/specs/outline.ts` | export `outlineLabel` (was private `labelFor`) | 2 |
| `src/lib/specs/fill-ins.ts` | pure fill-in slots, keys, substitution | 2 |
| `src/lib/specs/assemble-section.ts` | pure assembler + placement + checklist | 2 |
| `src/lib/specs/spec-docx.ts` | server-only Word writer | 3 |
| `src/lib/specs/spec-file-name.ts` | pure file name + long date | 3 |
| `src/app/api/spec-documents/[id]/docx/route.ts` | GET → .docx | 3 |
| `src/lib/specs/quote-bom.ts` | server-only `bomFromQuote` shared with D94 action | 4 |
| `src/app/(app)/design/specs/builder-actions.ts` | server actions for specs | 4 |
| `src/app/(app)/design/specs/page.tsx` | saved-spec list (replaces redirect) | 5 |
| `src/app/(app)/design/specs/new/page.tsx` + `new-spec-form.tsx` | create form | 5 |
| `src/app/(app)/design/specs/[id]/page.tsx` + `builder.tsx` + `preview.tsx` | builder | 5 |
| quotes hub, Grid editor, engagement view | entry links | 6 |

---

### Task 1: `spec_documents` collection, pure model, store

**Files:**
- Modify: `src/db/doc-tables.ts` (add after `specCurtainTemplates` line ~94; add to `DOC_TABLES` after `spec_curtain_templates`)
- Create: `drizzle/0027_spec_documents.sql`, and the meta snapshot/journal entry
- Create: `src/lib/specs/spec-document.ts`
- Create: `src/lib/stores/spec-documents.ts`
- Test: `scripts/test-review-and-spec.ts` (append block `// #205 spec builder T1`)

**Interfaces — Produces:**
```ts
// src/lib/specs/spec-document.ts (pure)
export type SpecSourceKind = "scratch" | "quote" | "grid";
export type SpecDocHeader = { projectName: string; projectNumber: string; phase: string; issueDate: string /* YYYY-MM-DD or "" */; preparedBy: string };
export type SpecDocProduct = { sku: string; qty?: number; articleId?: string };
export type SpecDocSource = { kind: SpecSourceKind; id?: string; label?: string; quoteId?: string };
export type SpecDocument = {
  id: string; sectionId: string; header: SpecDocHeader;
  customerId?: string; customer?: string; source: SpecDocSource;
  products: SpecDocProduct[]; printQuantities: boolean; fillIns: Record<string, string>;
  createdAt: number; createdBy: string; updatedAt: number; updatedBy: string;
};
export const DEFAULT_SPEC_PHASE = "Construction Documents";
export function normalizeSpecDocument(raw: unknown): SpecDocument;
export function withProduct(doc: SpecDocument, p: SpecDocProduct): SpecDocument;      // no-op if SKU already present (case-insensitive)
export function withoutProduct(doc: SpecDocument, sku: string): SpecDocument;
export function withProductOrder(doc: SpecDocument, skus: string[]): SpecDocument;    // listed SKUs first in that order, unlisted keep relative order after
export function withProductHeader(doc: SpecDocument, sku: string, articleId: string | null): SpecDocument;
export function bomProducts(rows: Array<{ sku: string; qty: number }>): SpecDocProduct[]; // blank SKUs dropped, duplicates summed (case-insensitive, first spelling kept)

// src/lib/stores/spec-documents.ts
export async function createSpecDocument(input: Omit<SpecDocument, "id" | "createdAt" | "updatedAt">): Promise<SpecDocument>;
export async function getSpecDocument(id: string): Promise<SpecDocument | null>;
export async function allSpecDocuments(): Promise<SpecDocument[]>;               // newest updatedAt first
export async function patchSpecDocument(id: string, mutate: (d: SpecDocument) => SpecDocument, by: string): Promise<SpecDocument | null>;
export async function removeSpecDocument(id: string): Promise<void>;             // soft delete
```

- [ ] **Step 1: Add the table.** In `src/db/doc-tables.ts`, after the `specCurtainTemplates` export add:
```ts
export const specDocuments = docTable("spec_documents"); // Spec builder (#205 Phase B) — one saved spec per CSI section: header, products, fill-in answers; migration 0027_spec_documents
```
and in `DOC_TABLES` after `spec_curtain_templates: specCurtainTemplates,` add `spec_documents: specDocuments,`. Check the file header comment (lines ~20–35) and any "syncable collections" list below `DOC_TABLES`: do NOT add `spec_documents` to the client-writable/syncable list.

- [ ] **Step 2: Generate and harden the migration.** Run `npm run db:generate`. It writes `drizzle/0027_<random>.sql`, a snapshot and a journal entry. Rename the SQL to `drizzle/0027_spec_documents.sql` and update the journal entry's `"tag"` to `"0027_spec_documents"`. Replace the SQL body with the idempotent form (same shape as `drizzle/0025_spec_library.sql`):
```sql
-- Spec builder (#205 Phase B) — saved specs, one per CSI section.
--
-- Idempotent per D141 (the shared Neon database is migrated by more than one
-- branch's build). Column-for-column docTable(); the _seq_bump trigger keeps
-- pull-sync's `WHERE seq > cursor` honest.
CREATE TABLE IF NOT EXISTS "spec_documents" (
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
CREATE INDEX IF NOT EXISTS "spec_documents_seq_idx" ON "spec_documents" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spec_documents_deleted_idx" ON "spec_documents" USING btree ("deleted");--> statement-breakpoint
CREATE OR REPLACE TRIGGER spec_documents_seq_bump BEFORE UPDATE ON "spec_documents" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
```
If `db:generate` emitted anything other than the `spec_documents` table (drift), stop and report it instead of committing it.

- [ ] **Step 3: Write the failing test** (append to the END of `scripts/test-review-and-spec.ts`; add `import { normalizeSpecDocument, withProduct, withoutProduct, withProductOrder, withProductHeader, bomProducts, DEFAULT_SPEC_PHASE } from "@/lib/specs/spec-document";` beside the other `@/lib/specs/*` imports):
```ts
// #205 spec builder T1
{
  const d = normalizeSpecDocument({ id: "SP-1001", sectionId: "ss-x", products: [{ sku: "A", qty: "2" }, { sku: "" }, "junk"], fillIns: { "ar#1": "30", bad: 5 } });
  ok(d.header.phase === DEFAULT_SPEC_PHASE && d.header.projectName === "" && d.source.kind === "scratch", "#205 spec builder: normalize fills header/source defaults");
  ok(d.products.length === 1 && d.products[0].qty === 2, "#205 spec builder: normalize drops blank/junk products and coerces qty");
  ok(d.printQuantities === false && d.fillIns["ar#1"] === "30" && !("bad" in d.fillIns), "#205 spec builder: printQuantities defaults off; only string fill-in answers kept");
  const d2 = withProduct(d, { sku: "a" });
  ok(d2.products.length === 1, "#205 spec builder: withProduct ignores a SKU already present (case-insensitive)");
  const d3 = withProduct(withProduct(d, { sku: "B" }), { sku: "C" });
  ok(withProductOrder(d3, ["C", "A"]).products.map((p) => p.sku).join() === "C,A,B", "#205 spec builder: withProductOrder puts listed SKUs first, keeps the rest after");
  ok(withoutProduct(d3, "b").products.map((p) => p.sku).join() === "A,C", "#205 spec builder: withoutProduct removes case-insensitively");
  ok(withProductHeader(d3, "C", "ar-1").products[2].articleId === "ar-1" && withProductHeader(withProductHeader(d3, "C", "ar-1"), "C", null).products[2].articleId === undefined, "#205 spec builder: withProductHeader sets and clears the per-spec header");
  const bp = bomProducts([{ sku: "X", qty: 2 }, { sku: "x", qty: 3 }, { sku: " ", qty: 1 }, { sku: "Y", qty: 0 }]);
  ok(bp.length === 2 && bp[0].sku === "X" && bp[0].qty === 5 && bp[1].qty === 0, "#205 spec builder: bomProducts sums duplicate SKUs and drops blanks");
}
```

- [ ] **Step 4: Run** `npm run test:specs` → expect failures/compile error for the missing module.

- [ ] **Step 5: Implement `src/lib/specs/spec-document.ts`:**
```ts
/**
 * Spec builder document (#205 Phase B) — pure, so the builder (a client
 * component) and the server actions share one normalize and one set of
 * product-list edits. Parts 1/3 are NOT stored here: they are read live from
 * the library at preview/download time (design §2).
 */

export type SpecSourceKind = "scratch" | "quote" | "grid";
export type SpecDocHeader = { projectName: string; projectNumber: string; phase: string; issueDate: string; preparedBy: string };
export type SpecDocProduct = { sku: string; qty?: number; articleId?: string };
export type SpecDocSource = { kind: SpecSourceKind; id?: string; label?: string; quoteId?: string };
export type SpecDocument = {
  id: string;
  sectionId: string;
  header: SpecDocHeader;
  customerId?: string;
  customer?: string;
  source: SpecDocSource;
  products: SpecDocProduct[];
  printQuantities: boolean;
  /** Answers keyed `${articleId}#${n}` — the n-th [FILL IN: …] in that article (src/lib/specs/fill-ins.ts). */
  fillIns: Record<string, string>;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
};

export const DEFAULT_SPEC_PHASE = "Construction Documents";
const KINDS: readonly SpecSourceKind[] = ["scratch", "quote", "grid"];

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

function product(v: unknown): SpecDocProduct | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const sku = str(o.sku);
  if (!sku) return null;
  const qty = Number(o.qty);
  const articleId = str(o.articleId);
  return { sku, ...(Number.isFinite(qty) && o.qty !== "" && o.qty != null ? { qty } : {}), ...(articleId ? { articleId } : {}) };
}

export function normalizeSpecDocument(raw: unknown): SpecDocument {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const h = (o.header && typeof o.header === "object" ? o.header : {}) as Record<string, unknown>;
  const s = (o.source && typeof o.source === "object" ? o.source : {}) as Record<string, unknown>;
  const kind = KINDS.includes(s.kind as SpecSourceKind) ? (s.kind as SpecSourceKind) : "scratch";
  const products: SpecDocProduct[] = [];
  for (const p of Array.isArray(o.products) ? o.products : []) {
    const n = product(p);
    if (n && !products.some((x) => same(x.sku, n.sku))) products.push(n);
  }
  const fillIns: Record<string, string> = {};
  if (o.fillIns && typeof o.fillIns === "object") {
    for (const [k, v] of Object.entries(o.fillIns as Record<string, unknown>)) if (typeof v === "string") fillIns[k] = v;
  }
  return {
    id: str(o.id),
    sectionId: str(o.sectionId),
    header: {
      projectName: str(h.projectName),
      projectNumber: str(h.projectNumber),
      phase: str(h.phase) || DEFAULT_SPEC_PHASE,
      issueDate: /^\d{4}-\d{2}-\d{2}$/.test(str(h.issueDate)) ? str(h.issueDate) : "",
      preparedBy: str(h.preparedBy),
    },
    ...(str(o.customerId) ? { customerId: str(o.customerId) } : {}),
    ...(str(o.customer) ? { customer: str(o.customer) } : {}),
    source: {
      kind,
      ...(str(s.id) ? { id: str(s.id) } : {}),
      ...(str(s.label) ? { label: str(s.label) } : {}),
      ...(str(s.quoteId) ? { quoteId: str(s.quoteId) } : {}),
    },
    products,
    printQuantities: o.printQuantities === true,
    fillIns,
    createdAt: Number(o.createdAt) || 0,
    createdBy: str(o.createdBy),
    updatedAt: Number(o.updatedAt) || 0,
    updatedBy: str(o.updatedBy),
  };
}

export function withProduct(doc: SpecDocument, p: SpecDocProduct): SpecDocument {
  const n = product(p);
  if (!n || doc.products.some((x) => same(x.sku, n.sku))) return doc;
  return { ...doc, products: [...doc.products, n] };
}

export function withoutProduct(doc: SpecDocument, sku: string): SpecDocument {
  return { ...doc, products: doc.products.filter((p) => !same(p.sku, sku)) };
}

export function withProductOrder(doc: SpecDocument, skus: string[]): SpecDocument {
  const first: SpecDocProduct[] = [];
  for (const s of skus) {
    const hit = doc.products.find((p) => same(p.sku, s));
    if (hit && !first.includes(hit)) first.push(hit);
  }
  return { ...doc, products: [...first, ...doc.products.filter((p) => !first.includes(p))] };
}

export function withProductHeader(doc: SpecDocument, sku: string, articleId: string | null): SpecDocument {
  return {
    ...doc,
    products: doc.products.map((p) => {
      if (!same(p.sku, sku)) return p;
      const { articleId: _drop, ...rest } = p;
      return articleId ? { ...rest, articleId } : rest;
    }),
  };
}

export function bomProducts(rows: Array<{ sku: string; qty: number }>): SpecDocProduct[] {
  const out: SpecDocProduct[] = [];
  for (const r of rows) {
    const sku = str(r.sku);
    if (!sku) continue;
    const qty = Number(r.qty) || 0;
    const hit = out.find((p) => same(p.sku, sku));
    if (hit) hit.qty = (hit.qty || 0) + qty;
    else out.push({ sku, qty });
  }
  return out;
}
```
(If eslint flags `_drop` as unused, use the repo's existing convention for omitting a key — e.g. build the object without it.)

- [ ] **Step 6: Implement `src/lib/stores/spec-documents.ts`:**
```ts
import { getDoc, insertWithPrefixedId, listDocs, patchDoc, softDeleteDoc, type Doc } from "@/db/doc-store";
import { normalizeSpecDocument, type SpecDocument } from "@/lib/specs/spec-document";

export type { SpecDocument };

/** Saved specs (#205 Phase B). Ids SP-#### from base 1000. */
export async function createSpecDocument(
  input: Omit<SpecDocument, "id" | "createdAt" | "updatedAt">
): Promise<SpecDocument> {
  const t = Date.now();
  return insertWithPrefixedId<SpecDocument & Doc>("spec_documents", "SP", 1000, (id) =>
    ({ ...normalizeSpecDocument({ ...input, id, createdAt: t, updatedAt: t }) }) as SpecDocument & Doc
  );
}

export async function getSpecDocument(id: string): Promise<SpecDocument | null> {
  const raw = await getDoc<Doc>("spec_documents", id);
  return raw ? normalizeSpecDocument(raw) : null;
}

export async function allSpecDocuments(): Promise<SpecDocument[]> {
  const list = await listDocs<Doc>("spec_documents");
  return list.map(normalizeSpecDocument).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function patchSpecDocument(
  id: string,
  mutate: (d: SpecDocument) => SpecDocument,
  by: string
): Promise<SpecDocument | null> {
  const out = await patchDoc<Doc>("spec_documents", id, (raw) => {
    const next = mutate(normalizeSpecDocument(raw));
    return { ...next, id, updatedAt: Date.now(), updatedBy: by } as unknown as Doc;
  });
  return out ? normalizeSpecDocument(out) : null;
}

export async function removeSpecDocument(id: string): Promise<void> {
  await softDeleteDoc("spec_documents", id);
}
```
Check `Doc`'s real type and `insertWithPrefixedId`'s generic bound in `src/db/doc-store.ts` and adjust the casts to compile without `any`.

- [ ] **Step 7: Add a DB-backed check** to the same T1 block (the harness already runs DB-backed checks against its temp datadir — see how the `#205 fix wave (Task 14)` block around line 250 imports stores): create a spec with `createSpecDocument`, assert id matches `/^SP-1\d{3}$/`, `getSpecDocument` round-trips, `patchSpecDocument` stamps `updatedBy`, `removeSpecDocument` then `getSpecDocument` → `null` or deleted per `getDoc`'s tombstone behaviour (read `getDoc` to see which; assert `allSpecDocuments()` no longer lists it either way).

- [ ] **Step 8: Run** `npx tsc --noEmit -p .` and `npm run test:specs` → 0 errors, 0 FAIL.

- [ ] **Step 9: Commit**
```bash
git add src/db/doc-tables.ts drizzle src/lib/specs/spec-document.ts src/lib/stores/spec-documents.ts scripts/test-review-and-spec.ts
git commit -m "feat(specs): spec_documents collection + pure spec document model (#205 Phase B T1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Fill-ins + the pure section assembler

**Files:**
- Modify: `src/lib/specs/outline.ts` (export the label helper)
- Create: `src/lib/specs/fill-ins.ts`, `src/lib/specs/assemble-section.ts`
- Test: append `// #205 spec builder T2`

**Interfaces — Consumes:** `SpecDocument`, `SpecDocProduct`, `SpecDocHeader` (Task 1); `SpecSection` (`src/lib/specs/sections.ts`); `SpecCategoryArticle`, `articleIdForPart`, `resolveSameAs`, `hasPrintableSpec`, `SpecPartLike` (`src/lib/specs/articles.ts`); `renderBody`, `OutlineLine` (`src/lib/specs/outline.ts`).

**Interfaces — Produces:**
```ts
// outline.ts
export function outlineLabel(depth: number, n: number): string;   // the existing private labelFor, renamed + exported; labelFor callers updated

// fill-ins.ts
export type FillInSlot = { key: string; part: 1 | 3; articleId: string; articleTitle: string; index: number; label: string };
export function fillInSlots(section: SpecSection): FillInSlot[];
export function applyFillIns(body: string, articleId: string, answers: Record<string, string>): string;
export function staleFillInKeys(section: SpecSection, answers: Record<string, string>): string[];

// assemble-section.ts
export type SpecBuilderPart = SpecPartLike & { desc?: string; mfr?: string; manufacturerPartNumber?: string; manufacturerModelNumber?: string; specTitle?: string };
export type LeftOutReason = "not-in-catalog" | "needs-header" | "other-section" | "no-spec";
export type Placement = { ok: true; articleId: string } | { ok: false; reason: "not-in-catalog" | "needs-header" | "other-section"; articleId?: string };
export function placeProduct(p: SpecDocProduct, part: SpecBuilderPart | undefined, sectionId: string, articles: SpecCategoryArticle[], sections: SpecSection[]): Placement;
export type AssembledArticle = { num: string; title: string; lines: OutlineLine[] };
export type AssembledProduct = { sku: string; label: string; heading: string; lines: OutlineLine[] };
export type AssembledPart2Article = { num: string; title: string; general: OutlineLine[]; products: AssembledProduct[] };
export type EquipmentRow = { sku: string; mfr: string; model: string; description: string; qty?: number };
export type SpecChecklist = {
  fillIns: Array<FillInSlot & { answered: boolean }>;
  fillInsLeft: number;
  staleAnswers: string[];
  leftOut: Array<{ sku: string; desc: string; reason: LeftOutReason; articleId?: string }>;
};
export type AssembledSection = {
  number: string; title: string; header: SpecDocHeader;
  part1: AssembledArticle[]; part3: AssembledArticle[];
  part2: { style: "paragraphs"; articles: AssembledPart2Article[] }
       | { style: "table"; articles: AssembledPart2Article[]; rows: EquipmentRow[]; showQty: boolean };
  checklist: SpecChecklist; warnings: string[];
};
export function assembleSection(input: {
  section: SpecSection; articles: SpecCategoryArticle[]; sections: SpecSection[];
  parts: Map<string, SpecBuilderPart>; // keyed by UPPERCASE sku; must include same-as targets
  doc: SpecDocument;
}): AssembledSection;
```

Rules (from the design, §3):
- Part 1/3 article `num` = `"1.1"`, `"1.2"`… / `"3.1"`…; title as stored; lines = `renderBody(applyFillIns(body, article.id, doc.fillIns), { context: "article", placeholders: { articles: usedTitles, project: { number, name, phase, issueDate }, section: { number, title } } }).lines`. Unanswered fill-ins stay as `[FILL IN: …]` text.
- Placement: missing part → `not-in-catalog`. Else `own = articleIdForPart(part, articles, sections)`; if `own` belongs to this section → place there. Else if `p.articleId` is an article of this section → place there. Else if `own` exists (other section) → `other-section` (with `articleId: own`). Else → `needs-header`.
- Printable: `specStateOf`-equivalent — a part with `specSameAs` uses its one-hop target (`resolveSameAs(part, bySku)`, error → `no-spec`), and the text part must satisfy `hasPrintableSpec`. Heading = text part's `specTitle` || the product part's `desc` || sku; body = text part's `specBody`.
- Used articles = articles of this section that received ≥1 printable product, sorted by `sort` then title; numbered `2.1`… in that order; `usedTitles` feeds `{{articles}}`.
- General = `renderBody(article.general, { context: "article", placeholders: { manufacturers: article.manufacturers, section, project } }).lines`. Product labels continue the depth-0 sequence after the General lines' depth-0 count: label = `outlineLabel(0, generalTop + i + 1)`. Product body lines = `renderBody(body, { context: "entry", placeholders: {...} }).lines`.
- Quantity: `showQty = doc.printQuantities && doc.source.kind !== "scratch"`; when true and `qty > 0`, paragraphs style heading gets `" (Quantity: N)"` appended; table rows carry `qty`.
- Table style (`section.part2Style === "table"`): `articles` = used articles with `products: []` (General only); `rows` = every printable placed product in product-list order: `mfr = part.mfr || skuPrefix || ""`, `model = manufacturerModelNumber || manufacturerPartNumber || skuTail || sku`, `description = text part specTitle || part desc || ""`.
- Checklist: `fillIns` = `fillInSlots(section)` with `answered` = trimmed answer non-empty; `fillInsLeft` = unanswered count; `staleAnswers` = `staleFillInKeys`; `leftOut` in product-list order with the reason.
- `warnings` = de-duplicated renderBody warnings from every body EXCEPT the "{{articles}} had no values" family when no article is used (that case is expected in an empty spec — suppress it).
- Fill-in keys: `${articleId}#${n}`, n = 1-based order of `[FILL IN: …]` occurrences (regex `/\[FILL IN:\s*([^\]]*)\]/g`) within that article's body. Label = captured text trimmed.

- [ ] **Step 1: Export the label helper.** In `src/lib/specs/outline.ts` rename `function labelFor(` to `export function outlineLabel(` and update its call site in `parseOutline`. Doc comment: `/** Label for the n-th (1-based) item at a depth: A. / 1. / a. / 1) / a). */`

- [ ] **Step 2: Write the failing tests** (append `// #205 spec builder T2` block; add static imports for `fillInSlots, applyFillIns, staleFillInKeys` from `@/lib/specs/fill-ins`, `assembleSection, placeProduct, type SpecBuilderPart` from `@/lib/specs/assemble-section`, `outlineLabel` from `@/lib/specs/outline`):
```ts
// #205 spec builder T2
{
  const sec = normalizeSection({
    id: "ss-t", number: "11 61 23", title: "Rigging", sort: 1,
    part1: [
      { id: "a1", title: "SECTION INCLUDES", body: "{{articles}}" },
      { id: "a2", title: "SUBMITTALS", body: "Within [FILL IN: number of days] days.\nSamples within [FILL IN: number of days] days." },
    ],
    part3: [{ id: "a3", title: "WARRANTY", body: "Project {{project.name}} for [FILL IN: owner]." }],
    part2Style: "paragraphs", quantities: "drawings", updatedAt: 0, updatedBy: "",
  } as never);
  const otherSec = normalizeSection({ id: "ss-o", number: "26 09 61", title: "Lighting", sort: 2, part1: [], part3: [], updatedAt: 0, updatedBy: "" } as never);
  const art = (id: string, sectionId: string, sort: number, title: string, general = "", manufacturers: string[] = []) =>
    ({ id, sectionId, sort, title, general, manufacturers, categoryKeys: [], updatedAt: 0, updatedBy: "" });
  const articles = [
    art("ar-d", "ss-t", 10, "DRAPES", "General:\n  Acceptable Manufacturers:\n    {{manufacturers}}", ["Rose Brand", "KM"]),
    art("ar-h", "ss-t", 20, "HOISTS", "General:\n  Purpose-built."),
    art("ar-x", "ss-t", 30, "UNUSED"),
    art("ar-l", "ss-o", 10, "LUMINAIRES"),
  ];
  const P = (o: Partial<SpecBuilderPart> & { sku: string }): SpecBuilderPart => ({ specState: "authored", ...o });
  const parts = new Map<string, SpecBuilderPart>([
    ["VAL", P({ sku: "VAL", desc: "Valance", specArticleId: "ar-d", specTitle: "VALANCE", specBody: "Material:\n  Velour" })],
    ["LEG", P({ sku: "LEG", desc: "Legs", specArticleId: "ar-d", specSameAs: "VAL" })],
    ["HST", P({ sku: "HST", desc: "Hoist", specArticleId: "ar-h", specTitle: "HOIST", specBody: "Basis of Design: P1" })],
    ["DRF", P({ sku: "DRF", desc: "Draft", specArticleId: "ar-h", specBody: "x", specState: "draft" })],
    ["FIX", P({ sku: "FIX", desc: "Fixture", specArticleId: "ar-l", specTitle: "FIX", specBody: "y" })],
    ["NOA", P({ sku: "NOA", desc: "No article", specTitle: "N", specBody: "z" })],
  ]);
  const doc = normalizeSpecDocument({
    id: "SP-1001", sectionId: "ss-t",
    header: { projectName: "North HS", projectNumber: "3580", issueDate: "2026-07-30" },
    source: { kind: "quote" }, printQuantities: true,
    products: [{ sku: "HST", qty: 2 }, { sku: "VAL", qty: 1 }, { sku: "LEG" }, { sku: "DRF" }, { sku: "FIX" }, { sku: "NOA" }, { sku: "GONE" }],
    fillIns: { "a2#1": "30", "a9#1": "stale" },
  });
  const slots = fillInSlots(sec);
  ok(slots.length === 3 && slots[0].key === "a2#1" && slots[1].key === "a2#2" && slots[2].key === "a3#1" && slots[1].label === "number of days" && slots[2].part === 3, "#205 spec builder: fill-in slots are keyed by article + position, labelled by their text");
  ok(applyFillIns("A [FILL IN: x] B [FILL IN: y]", "q", { "q#2": "TWO" }) === "A [FILL IN: x] B TWO", "#205 spec builder: applyFillIns replaces only answered blanks, by position");
  ok(staleFillInKeys(sec, doc.fillIns).join() === "a9#1", "#205 spec builder: answers whose blank no longer exists are stale");
  ok(placeProduct({ sku: "FIX" }, parts.get("FIX"), "ss-t", articles, [sec, otherSec]).ok === false, "#205 spec builder: a part in another section's article is not placed");
  const over = placeProduct({ sku: "FIX", articleId: "ar-h" }, parts.get("FIX"), "ss-t", articles, [sec, otherSec]);
  ok(over.ok === true && over.articleId === "ar-h", "#205 spec builder: a per-spec header override places a part from another section");
  const a = assembleSection({ section: sec, articles, sections: [sec, otherSec], parts, doc });
  ok(a.part1.map((x) => x.num).join() === "1.1,1.2" && a.part3[0].num === "3.1", "#205 spec builder: Part 1/3 articles number n.m");
  ok(a.part1[0].lines.map((l) => l.text).join("|") === "DRAPES|HOISTS", "#205 spec builder: {{articles}} lists only the Part 2 articles that received products, in sort order");
  ok(a.part1[1].lines[0].text === "Within 30 days." && a.part1[1].lines[1].text.includes("[FILL IN: number of days]"), "#205 spec builder: answered blank substituted, unanswered blank prints as written");
  ok(a.part3[0].lines[0].text.startsWith("Project North HS"), "#205 spec builder: {{project.name}} comes from the header");
  if (a.part2.style !== "paragraphs") throw new Error("expected paragraphs");
  ok(a.part2.articles.map((x) => `${x.num} ${x.title}`).join("|") === "2.1 DRAPES|2.2 HOISTS", "#205 spec builder: only used Part 2 articles print, numbered in sort order");
  const drapes = a.part2.articles[0];
  ok(drapes.general.some((l) => l.text === "Rose Brand") && drapes.general[0].label === "A.", "#205 spec builder: General expands {{manufacturers}} and starts at A.");
  ok(drapes.products.map((p) => `${p.label} ${p.heading}`).join("|") === "B. VALANCE (Quantity: 1)|C. VALANCE", "#205 spec builder: products continue the letters after General; same-as prints its target's text");
  ok(drapes.products[0].lines[0].label === "1." && drapes.products[0].lines[1].label === "a.", "#205 spec builder: a product body renders in entry context (1., a.)");
  ok(a.part2.articles[1].products[0].heading === "HOIST (Quantity: 2)", "#205 spec builder: Print quantities appends the BOM quantity");
  const reasons = Object.fromEntries(a.checklist.leftOut.map((x) => [x.sku, x.reason]));
  ok(reasons.DRF === "no-spec" && reasons.FIX === "other-section" && reasons.NOA === "needs-header" && reasons.GONE === "not-in-catalog" && a.checklist.leftOut.length === 4, "#205 spec builder: left-out reasons — draft, other section, no header, deleted part");
  ok(a.checklist.fillInsLeft === 2 && a.checklist.staleAnswers.join() === "a9#1", "#205 spec builder: checklist counts unanswered blanks and stale answers");
  const scratch = assembleSection({ section: sec, articles, sections: [sec, otherSec], parts, doc: { ...doc, source: { kind: "scratch" } } });
  ok(scratch.part2.style === "paragraphs" && !scratch.part2.articles[0].products[0].heading.includes("Quantity"), "#205 spec builder: a from-scratch spec never prints quantities");
  const tableSec = { ...sec, part2Style: "table" as const };
  const t = assembleSection({ section: tableSec, articles, sections: [tableSec, otherSec], parts: new Map([...parts, ["SHURE:ANX4", P({ sku: "Shure:ANX4", desc: "Receiver", mfr: "", specArticleId: "ar-h", specTitle: "Receiver", specBody: "Receiver" })]]), doc: withProduct(doc, { sku: "Shure:ANX4", qty: 3 }) });
  if (t.part2.style !== "table") throw new Error("expected table");
  const row = t.part2.rows.find((r) => r.sku === "Shure:ANX4");
  ok(!!row && row.mfr === "Shure" && row.model === "ANX4" && row.qty === 3 && t.part2.showQty, "#205 spec builder: table rows fall back to the SKU prefix/tail for Mfr/Model");
  ok(t.part2.articles.every((x) => x.products.length === 0), "#205 spec builder: table style prints General clauses only above the table");
  const empty = assembleSection({ section: sec, articles, sections: [sec], parts, doc: { ...doc, products: [] } });
  ok(!empty.warnings.some((w) => w.includes("{{articles}}")), "#205 spec builder: an empty spec does not warn about {{articles}}");
  ok(outlineLabel(0, 3) === "C." && outlineLabel(2, 1) === "a.", "#205 spec builder: outlineLabel is exported");
}
```
(`normalizeSection` and `withProduct`/`normalizeSpecDocument` are already imported — T1 and the file's existing imports.)

- [ ] **Step 3: Run** `npm run test:specs` → FAIL (missing modules).

- [ ] **Step 4: Implement `src/lib/specs/fill-ins.ts`:**
```ts
import type { SpecSection } from "@/lib/specs/sections";

/**
 * [FILL IN: …] blanks in a section's Part 1/3 (#205 Phase B, D327). Pure.
 * A blank is keyed by its article and its position in that article's body
 * (`${articleId}#${n}`, n from 1) — two "number of days" blanks in one
 * article are two fields. A saved answer whose key no longer exists is
 * "stale": shown in the builder, never applied elsewhere.
 */

const FILL_IN_RE = /\[FILL IN:\s*([^\]]*)\]/g;

export type FillInSlot = { key: string; part: 1 | 3; articleId: string; articleTitle: string; index: number; label: string };

export function fillInSlots(section: SpecSection): FillInSlot[] {
  const out: FillInSlot[] = [];
  const scan = (part: 1 | 3) => {
    for (const a of part === 1 ? section.part1 : section.part3) {
      let n = 0;
      for (const m of a.body.matchAll(FILL_IN_RE)) {
        n++;
        out.push({ key: `${a.id}#${n}`, part, articleId: a.id, articleTitle: a.title, index: n, label: m[1].trim() });
      }
    }
  };
  scan(1);
  scan(3);
  return out;
}

export function applyFillIns(body: string, articleId: string, answers: Record<string, string>): string {
  let n = 0;
  return String(body || "").replace(FILL_IN_RE, (whole) => {
    n++;
    const v = (answers[`${articleId}#${n}`] || "").trim();
    return v || whole;
  });
}

export function staleFillInKeys(section: SpecSection, answers: Record<string, string>): string[] {
  const live = new Set(fillInSlots(section).map((s) => s.key));
  return Object.keys(answers).filter((k) => !live.has(k) && (answers[k] || "").trim() !== "");
}
```

- [ ] **Step 5: Implement `src/lib/specs/assemble-section.ts`** following the Rules above. Skeleton with the non-obvious parts spelled out:
```ts
import { articleIdForPart, hasPrintableSpec, resolveSameAs, type SpecCategoryArticle, type SpecPartLike } from "@/lib/specs/articles";
import { outlineLabel, renderBody, type OutlineLine, type PlaceholderContext } from "@/lib/specs/outline";
import type { SpecSection } from "@/lib/specs/sections";
import { applyFillIns, fillInSlots, staleFillInKeys, type FillInSlot } from "@/lib/specs/fill-ins";
import type { SpecDocHeader, SpecDocProduct, SpecDocument } from "@/lib/specs/spec-document";

/**
 * The spec builder's one assembly (#205 Phase B, design §3). Pure: the
 * builder's preview (client) and the Word writer (server) render the same
 * AssembledSection, so they cannot disagree.
 */

// …types exactly as in Interfaces above…

const up = (s: string) => s.toUpperCase();
const prefix = (sku: string) => (sku.indexOf(":") > 0 ? sku.slice(0, sku.indexOf(":")) : "");
const tail = (sku: string) => (sku.indexOf(":") >= 0 ? sku.slice(sku.indexOf(":") + 1) : "");

export function placeProduct(p, part, sectionId, articles, sections): Placement {
  if (!part) return { ok: false, reason: "not-in-catalog" };
  const inSection = (id?: string | null) => !!id && articles.some((a) => a.id === id && a.sectionId === sectionId);
  const own = articleIdForPart(part, articles, sections);
  if (inSection(own)) return { ok: true, articleId: own! };
  if (inSection(p.articleId)) return { ok: true, articleId: p.articleId! };
  if (own) return { ok: false, reason: "other-section", articleId: own };
  return { ok: false, reason: "needs-header" };
}

/** The part whose text prints for `part`: itself, or its one-hop same-as target. null = nothing printable. */
function textPart(part: SpecBuilderPart, bySku: Map<string, SpecBuilderPart>): SpecBuilderPart | null {
  if ((part.specSameAs || "").trim()) {
    const { target, error } = resolveSameAs(part, bySku as unknown as Map<string, SpecPartLike>);
    if (error || !target) return null;
    return hasPrintableSpec(target) ? (target as SpecBuilderPart) : null;
  }
  return hasPrintableSpec(part) ? part : null;
}
```
`resolveSameAs` looks targets up with `bySku.get(want) || bySku.get(want.toUpperCase())` — build `bySku` with UPPERCASE keys (the `parts` input already is). Then `assembleSection`:
1. `slots`, `staleAnswers` from fill-ins.
2. Walk `doc.products` in order: part = `parts.get(up(p.sku))`; placement; if placed, `tp = textPart(...)`; not printable → leftOut `no-spec`; else collect `{ p, part, tp, articleId }`.
3. `used` = this section's articles with ≥1 collected product, sorted `sort` then `title`; `usedTitles = used.map(a => a.title)`.
4. `ctx: PlaceholderContext = { articles: usedTitles, project: { number, name, phase, issueDate }, section: { number, title } }`; collect warnings via a helper that calls `renderBody` and pushes `r.warnings` (skip any warning containing `{{articles}}` when `usedTitles.length === 0`).
5. Part 1/3 assembled per Rules. Part 2 per Rules (paragraphs vs table).
6. Return with de-duplicated warnings.

- [ ] **Step 6: Run** `npx tsc --noEmit -p .` and `npm run test:specs` → 0 errors, 0 FAIL (all existing outline tests still pass after the rename).

- [ ] **Step 7: Commit**
```bash
git add src/lib/specs/outline.ts src/lib/specs/fill-ins.ts src/lib/specs/assemble-section.ts scripts/test-review-and-spec.ts
git commit -m "feat(specs): fill-in slots + pure section assembler (#205 Phase B T2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The Word writer, file name, download route

**Files:**
- Create: `src/lib/specs/spec-file-name.ts` (pure), `src/lib/specs/spec-docx.ts` (server-only), `src/app/api/spec-documents/[id]/docx/route.ts`
- Test: append `// #205 spec builder T3`

**Interfaces — Consumes:** `AssembledSection` (Task 2); `getSpecDocument` (Task 1); stores `allSections`/`getSection` (`@/lib/stores/spec-sections`), `allArticles` (`@/lib/stores/spec-articles`), catalog `list`/`get` (`@/lib/stores/catalog`).

**Interfaces — Produces:**
```ts
// spec-file-name.ts
export function longDate(iso: string): string;                  // "2026-07-30" → "July 30, 2026"; "" → ""
export function specFileName(header: SpecDocHeader, section: { number: string; title: string }): string;
// spec-docx.ts
export async function buildSectionDocx(a: AssembledSection): Promise<Buffer>;
// shared server loader (put in spec-docx.ts's sibling `src/lib/specs/load-spec.ts`, server-only):
export async function loadAssembledSpec(id: string): Promise<{ doc: SpecDocument; section: SpecSection | null; assembled: AssembledSection | null }>;
```
`loadAssembledSpec` reads the spec, `allSections()`, `allArticles()`, and the parts it needs: the doc's product SKUs plus each found part's `specSameAs` target. Use a batch catalog getter if `src/lib/stores/catalog.ts` has one (look for `getMany`/`getParts`); otherwise `get(sku)` per SKU (specs have tens of products, not thousands). Map keys UPPERCASE. `assembled` is null when the section is gone.

- [ ] **Step 1: Failing tests** (append block; static imports `longDate, specFileName` from `@/lib/specs/spec-file-name`, `buildSectionDocx` from `@/lib/specs/spec-docx`, `JSZip` default from `"jszip"`):
```ts
// #205 spec builder T3
{
  ok(longDate("2026-07-30") === "July 30, 2026" && longDate("") === "", "#205 spec builder: long issue date, no timezone shift");
  const hdr = { projectName: "North HS: Auditorium", projectNumber: "3580", phase: "Construction Documents", issueDate: "2026-07-30", preparedBy: "" };
  ok(specFileName(hdr, { number: "11 61 23", title: "Theatrical Rigging and Curtains" }) === "3580_North HS Auditorium_Spec 11 61 23_Theatrical Rigging and Curtains_07-30-2026.docx", "#205 spec builder: file name follows the North HS pattern, illegal characters dropped");
  ok(specFileName({ ...hdr, projectName: "", projectNumber: "", issueDate: "" }, { number: "27 41 00", title: "Audio-Video Systems" }) === "Spec 27 41 00_Audio-Video Systems.docx", "#205 spec builder: blank header parts are dropped from the file name");
  // Reuse the T2 fixtures by re-assembling a small section here (copy the T2 `sec`, `articles`, `parts`, `doc` construction into this block — blocks don't share scope).
  // …fixtures…
  const buf = await buildSectionDocx(a);
  const zip = await JSZip.loadAsync(buf);
  const docXml = await zip.file("word/document.xml")!.async("string");
  const numXml = await zip.file("word/numbering.xml")!.async("string");
  const files = Object.keys(zip.files);
  const hdrXml = await zip.file(files.find((f) => /^word\/header\d*\.xml$/.test(f))!)!.async("string");
  const ftrXml = await zip.file(files.find((f) => /^word\/footer\d*\.xml$/.test(f))!)!.async("string");
  ok((docXml.match(/<w:numPr>/g) || []).length >= 10, "#205 spec builder: outline paragraphs carry real Word numbering (numPr)");
  ok(!/<w:t[^>]*>[A-Z]\.\s*<\/w:t>/.test(docXml) && !docXml.includes(">1.01<"), "#205 spec builder: no typed-in outline labels");
  ok((numXml.match(/<w:lvl /g) || []).length >= 7 && numXml.includes("PART %1"), "#205 spec builder: one multi-level list, PART → n.m → A. … a)");
  ok(docXml.includes("SECTION 11 61 23") && docXml.includes("END OF SECTION 11 61 23"), "#205 spec builder: title and END OF SECTION");
  ok(hdrXml.includes("North HS") && hdrXml.includes("Project No. 3580") && hdrXml.includes("July 30, 2026"), "#205 spec builder: running header carries project, number, date");
  ok(/PAGE/.test(ftrXml) && ftrXml.includes("11 61 23 - "), "#205 spec builder: footer carries the section number and a PAGE field");
  // Table style
  const tBuf = await buildSectionDocx(tAssembled); // a table-style assembly (copy T2's table fixture)
  const tXml = await (await JSZip.loadAsync(tBuf)).file("word/document.xml")!.async("string");
  ok(tXml.includes("<w:tbl>") && tXml.includes("ANX4"), "#205 spec builder: table style writes a real Word table");
}
```
Replace `// …fixtures…` with a real copy of the T2 fixtures (don't leave the comment). The harness body is async (check: it uses `await` at top level elsewhere) — if the block must be inside an async IIFE, follow the file's pattern.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `spec-file-name.ts`:**
```ts
import type { SpecDocHeader } from "@/lib/specs/spec-document";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-07-30" → "July 30, 2026", parsed by hand so no timezone can shift the day. */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return "";
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** `<number>_<name>_Spec <section>_<title>_<MM-DD-YYYY>.docx` (the North HS pattern); blanks dropped. */
export function specFileName(header: SpecDocHeader, section: { number: string; title: string }): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(header.issueDate || "");
  const bits = [header.projectNumber, header.projectName, `Spec ${section.number}`, section.title, m ? `${m[2]}-${m[3]}-${m[1]}` : ""];
  const name = bits.map((b) => (b || "").replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim()).filter(Boolean).join("_");
  return `${name}.docx`;
}
```

- [ ] **Step 4: Implement `spec-docx.ts`** with `docx` 9.x (`Document, Packer, Paragraph, TextRun, Header, Footer, PageNumber, AlignmentType, LevelFormat, LevelSuffix, Table, TableRow, TableCell, WidthType, TabStopType, HeadingLevel`). Requirements:
  - `numbering.config`: one reference `"spec-outline"` with 7 levels:
    - 0: `LevelFormat.DECIMAL`, text `"PART %1 –"`, suffix `LevelSuffix.SPACE`, bold, no indent.
    - 1: DECIMAL, `"%1.%2"`, suffix TAB, indent left 720 hanging 720.
    - 2: UPPER_LETTER `"%3."` left 1440 hanging 720; 3: DECIMAL `"%4."` left 2160 h 720; 4: LOWER_LETTER `"%5."` left 2880 h 720; 5: DECIMAL `"%6)"` left 3600 h 720; 6: LOWER_LETTER `"%7)"` left 4320 h 720.
  - Use ONE numbering instance for the whole document (`numbering: { reference: "spec-outline", level: n }` on every outline paragraph, same `instance`), so PART 1/2/3 count up and deeper levels restart under each new higher-level item (Word's default restart).
  - Paragraph mapping: PART heading (level 0, text `GENERAL` / `PRODUCTS` / `EXECUTION`, `HeadingLevel.HEADING_1`); article (level 1, title, `HEADING_2`); outline line depth d → level 2 + d (clamp to 6); product heading → level 2 (its letter continues after General automatically because it's the same list at the same level); product body line depth d (entry context already starts at 1) → level 2 + d.
  - Text of every numbered paragraph is the line's `text` only — never the `label`.
  - Title paragraph (centered, bold): `SECTION ${number} – ${title.toUpperCase()}`; last paragraph (centered): `END OF SECTION ${number}`.
  - Default font Times New Roman 11pt via `styles.default.document.run`; page size letter (12240 × 15840 twips), 1" margins.
  - Header: two paragraphs — `${projectName}` (bold) and `${longDate(issueDate)} · Project No. ${projectNumber} · ${phase}` (omit blank pieces; omit "Project No." if the number is blank).
  - Footer: one paragraph with a right tab stop: `${title.toUpperCase()}` + `\t` + `${number} - ` + `PageNumber.CURRENT` run.
  - Table style: after the used articles' General clauses (PART 2 still numbered), a `Table` with header row `Mfr | Model | Description` (+ `Qty` first when `showQty`), one row per `EquipmentRow`, 100% width.
  - `buildSectionDocx(a)` returns `Packer.toBuffer(doc)`.
  - File header comment: server-only (like `src/lib/bid-spec-docx.ts`), and why real numbering (Jeff's question 6: renumbers when edited in Word; deliberately unlike D94a's typed numbers).

- [ ] **Step 5: Implement `src/lib/specs/load-spec.ts`** (server-only; per Interfaces) and the route `src/app/api/spec-documents/[id]/docx/route.ts`:
```ts
import { requireUser } from "@/lib/session";
import { loadAssembledSpec } from "@/lib/specs/load-spec";
import { buildSectionDocx } from "@/lib/specs/spec-docx";
import { specFileName } from "@/lib/specs/spec-file-name";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await ctx.params;
  const { doc, section, assembled } = await loadAssembledSpec(id);
  if (!doc.id) return new Response("Spec not found.", { status: 404 });
  if (!section || !assembled) return new Response("This section is no longer in the library.", { status: 409 });
  const buf = await buildSectionDocx(assembled);
  const name = specFileName(doc.header, section);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
```
Check an existing route handler (e.g. `src/app/api/spec/` from D94) for how this repo types `params` in Next 16 and whether `requireUser()` redirects or throws in a route — match it. `loadAssembledSpec` returns `doc` normalized (id "" when missing).

- [ ] **Step 6: Run** tsc + `npm run test:specs` → 0 errors, 0 FAIL.

- [ ] **Step 7: Commit** (`feat(specs): Word writer with real multi-level numbering + download route (#205 Phase B T3)`).

---

### Task 4: Server actions + shared quote BOM

**Files:**
- Create: `src/lib/specs/quote-bom.ts` (server-only), `src/app/(app)/design/specs/builder-actions.ts`
- Modify: `src/app/(app)/design/engagements/spec/actions.ts` (`bomFromQuoteAction` delegates to `bomFromQuote`)
- Test: append `// #205 spec builder T4`

**Interfaces — Consumes:** Task 1 store + model, Task 2 `placeProduct`, `SpecBuilderPart`; `writePartSpecFieldsAction` (`src/app/(app)/catalog/actions.ts`) stays the way part spec text is written (the client calls it directly).

**Interfaces — Produces:**
```ts
// quote-bom.ts
export async function bomFromQuote(quoteId: string): Promise<{ ok: true; rows: BomRow[]; label: string } | { ok: false; error: string }>;
// builder-actions.ts ("use server"); Result<T> = ({ ok: true } & T) | { ok: false; error: string }
export async function createSpecDocumentAction(input: { sectionId: string; customerId?: string; projectName?: string; projectNumber?: string;
  source?: { kind: "quote"; quoteId: string } | { kind: "grid"; gridProjectId: string; quoteId: string } }): Promise<Result<{ id: string }>>;
export async function updateSpecHeaderAction(id: string, patch: Partial<SpecDocHeader>): Promise<Result>;
export async function setSpecCustomerAction(id: string, customerId: string | null): Promise<Result>;
export async function setSpecFillInAction(id: string, key: string, value: string): Promise<Result>;
export async function addSpecProductAction(id: string, sku: string, articleId?: string): Promise<Result>;
export async function removeSpecProductAction(id: string, sku: string): Promise<Result>;
export async function reorderSpecProductsAction(id: string, skus: string[]): Promise<Result>;
export async function setSpecProductHeaderAction(id: string, sku: string, articleId: string | null): Promise<Result>;
export async function setSpecPrintQuantitiesAction(id: string, on: boolean): Promise<Result>;
export async function deleteSpecDocumentAction(id: string): Promise<Result>;
export type SpecPickerPart = { sku: string; desc: string; mfr: string; articleId: string | null; articleTitle: string; inSection: boolean; hasSpec: boolean; specArticleId: string | null };
export async function searchSpecPartsAction(id: string, q: string, showAll: boolean): Promise<Result<{ parts: SpecPickerPart[] }>>;
```

Behaviour:
- `bomFromQuote`: move the body of `bomFromQuoteAction` (lines ~42–75 of `src/app/(app)/design/engagements/spec/actions.ts`, including the Grid flat-lines + assembly expansion) into `quote-bom.ts` unchanged; `label` = the quote's `name` or id. `bomFromQuoteAction` becomes `await requireUser(); const r = await bomFromQuote(quoteId); return r.ok ? { ok: true, bom: r.rows } : r;`.
- `createSpecDocumentAction` (`requirePerm("create")`): section must exist (`getSection`), else error "Pick a section from the library."; customer name snapshot from the customers store when `customerId` given; header defaults: phase `DEFAULT_SPEC_PHASE`, issueDate today (server local `YYYY-MM-DD`), preparedBy = user name; source quote/grid → `bomFromQuote` (error → return it), `products = bomProducts(rows)`, source `{ kind, id: quoteId | gridProjectId, label, quoteId }`. Returns the new id. `revalidatePath("/design/specs")`.
- Every mutation: `requirePerm("create")`, `patchSpecDocument(id, fn, user.name)`, null → `{ ok: false, error: "Spec not found." }`, then `revalidatePath("/design/specs")` + `revalidatePath(`/design/specs/${id}`)`. `setSpecFillInAction` stores trimmed value; empty string deletes the key. `addSpecProductAction` validates the part exists (`get(sku)` from the catalog store) → "Part <sku> not found."; stores the part's canonical SKU spelling; optional `articleId` must be an article of the spec's section.
- `searchSpecPartsAction` (`requireUser`): loads catalog `list()`, `allArticles()`, `allSections()`, the spec; for each part compute `articleIdForPart` + `hasSpec` (`hasPrintableSpec`, or a same-as whose target is printable — use `specStateOf` with a `bySku` map built once). Default (`showAll=false`): parts with `hasSpec` whose article is in this section. `showAll`: every part. Filter by `q` (case-insensitive substring over sku + desc + mfr; empty q allowed). Exclude SKUs already on the spec. Sort: in-section first, then sku. Return max 60.
- Server actions must be `"use server"` async functions only (no non-async exports from this file — types are fine).

- [ ] **Step 1: Failing tests** (append block). Actions need a session, so test by source-text checks + the pure pieces already covered; plus a DB-backed check of `bomFromQuote` refusing an unknown quote:
```ts
// #205 spec builder T4
{
  const src = read("src/app/(app)/design/specs/builder-actions.ts");
  const mutations = ["createSpecDocumentAction", "updateSpecHeaderAction", "setSpecCustomerAction", "setSpecFillInAction", "addSpecProductAction", "removeSpecProductAction", "reorderSpecProductsAction", "setSpecProductHeaderAction", "setSpecPrintQuantitiesAction", "deleteSpecDocumentAction"];
  for (const name of mutations) {
    const body = src.slice(src.indexOf(`export async function ${name}`), src.indexOf("export async function", src.indexOf(`export async function ${name}`) + 10) >>> 0 || undefined);
    ok(body.includes('requirePerm("create")'), `#205 spec builder: ${name} requires create`);
  }
  ok(src.startsWith('"use server"'), "#205 spec builder: builder-actions is a server-action module");
  const old = read("src/app/(app)/design/engagements/spec/actions.ts");
  ok(old.includes("bomFromQuote(") && !old.includes("gridSpecBomRows("), "#205 spec builder: the D94 action delegates to the shared bomFromQuote");
  const { bomFromQuote } = await import("@/lib/specs/quote-bom");
  const miss = await bomFromQuote("Q-NOPE-0000");
  ok(!miss.ok && /not found/i.test(miss.error), "#205 spec builder: bomFromQuote reports an unknown quote");
}
```
(`read` is the harness's existing file-reading helper — check its name; if the harness uses dynamic imports differently, follow it.)

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** per Behaviour. **Step 4: Run** tsc + specs → 0/0. **Step 5: Commit** (`feat(specs): spec builder server actions + shared quote BOM (#205 Phase B T4)`).

---

### Task 5: Screens — list, new, builder

**Files:**
- Replace: `src/app/(app)/design/specs/page.tsx` (list)
- Create: `src/app/(app)/design/specs/new/page.tsx`, `src/app/(app)/design/specs/new/new-spec-form.tsx` ("use client")
- Create: `src/app/(app)/design/specs/[id]/page.tsx`, `src/app/(app)/design/specs/[id]/builder.tsx` ("use client"), `src/app/(app)/design/specs/[id]/preview.tsx` (pure presentational, no "use client" needed if it has no hooks — it's rendered by builder)
- Modify: `scripts/smoke-routes.ts` (`/design/specs` already listed as a redirect-follow entry — update its comment/expectation to the list page; add `/design/specs/new` to the static list)
- Test: append `// #205 spec builder T5` (source-text checks)

**Interfaces — Consumes:** Task 1–4 exports. `CustomerCombobox` from `@/components/customer-combobox` (props: `options: {id,name,detail?,searchText?}[]`, `value`, `onChange(id)`); build options from the customers store the way `src/app/(app)/quotes/new/page.tsx` builds `customers`.

**List page** (`requireUser`): title "Specs", sub "Saved specs — one CSI section per Word file."; header buttons: `+ New spec` (`pk-btn-accent`, → `/design/specs/new`), `Library` and `Templates` (`pk-btn-outline`). Table: SP number (mono, links to builder) · Section (`number · title`, or "Section removed") · Project (name / number) · Customer · Source ("From scratch" / "Quote Q-2041" / "Grid: <label>") · Updated (relative or date) · `Download Word` link (`/api/spec-documents/<id>/docx`, `download` attribute; hidden when the section is gone). Empty state: "No specs yet — start one with + New spec."

**New page** (`requireUser`; search params `quote`, `grid`, `engagement`): resolves source: `engagement` → `getEngagement(id)`; quoteId = `installQuoteId || quoteId`; label from engagement name. `grid` needs `quote` too (the Grid option's quote). Renders `NewSpecForm` with sections (id, number, title), customer options, source summary ("From quote Q-2041 — only parts that belong to the section you pick are added"), default customer (engagement's/quote's customer when known). Form: Section `<select>` (required), Customer (`CustomerCombobox`, optional), Project name, Project number; `Create spec` → `createSpecDocumentAction` → `router.push(/design/specs/<id>)`; show the error inline. If there are no library sections: "The library has no sections yet — import or add one in the Spec library first." with a link.

**Builder page** (`requireUser`): `loadAssembledSpec(id)` (404 via `notFound()` for an unknown id); also loads articles of this section (for header pickers), and the parts on the spec (for qty + product rows). Pass to `Builder`: `doc`, `section` (or null), `assembled` (or null), `sectionArticles` `{id,title}[]`, `productRows` — one per doc product: `{ sku, desc, qty?, placedArticleId: string | null, leftOutReason: LeftOutReason | null, specArticleId: string | null, specTitle, specBody, hasOwnText }` (compute with `placeProduct` + the assembled checklist), `canEdit` (user has `create` — check how other pages test a permission without redirecting, e.g. `ROLE_PERMS`/`hasPerm` in `src/lib/team.ts` / `src/lib/session.ts`).

`Builder` (client) sections, each a `pk-card`:
1. **Header** — five inputs + Customer combobox; save on blur/change via `updateSpecHeaderAction` / `setSpecCustomerAction`; `router.refresh()` after each save. Source line (read-only).
2. **Fill-ins** — `assembled.checklist.fillIns` grouped by Part then article: label `"<ARTICLE TITLE> — <label>"`, input saving on blur via `setSpecFillInAction(key, value)`. Stale answers listed below as "No longer used: <key> = <value>" with a Clear button (`setSpecFillInAction(key, "")`).
3. **Products** — for each used article + one "Needs attention" group (left-out rows): rows show SKU (mono), heading/desc, qty (only when `doc.source.kind !== "scratch"`), ↑/↓ (within its group → `reorderSpecProductsAction` with the full new SKU order), Remove. Left-out rows show the reason in words: no-spec "No approved spec — Write spec", needs-header "Pick a header" (a `<select>` of this section's articles → `setSpecProductHeaderAction`), other-section "Belongs to <article title>'s section — Use a header here" (same select), not-in-catalog "Part no longer in catalog". **Print quantities** checkbox (only when source ≠ scratch) → `setSpecPrintQuantitiesAction`. **+ Add product** opens the picker.
4. **Picker** (modal or inline panel): search input (debounced ~250ms) → `searchSpecPartsAction(id, q, showAll)`; **Show all catalog parts** checkbox; results: SKU, desc, article title / "No spec yet"; Add → if `hasSpec && inSection`: `addSpecProductAction`; if no spec: open **Write spec** (title + textarea outline text + header `<select>` when the part has no article in this section) → `writePartSpecFieldsAction({ sku, specArticleId: <chosen or existing specArticleId>, specTitle, specBody })` then `addSpecProductAction(id, sku, chosenHeaderIfNotOwn)`. Never pass `specArticleId: undefined` for a part that already has one — pass its current `specArticleId` so the Spec panel action does not clear it.
5. **Checklist** — "N fill-ins left", "M products left out" (never blocks).
6. **Preview** — `Preview` renders `assembled`: title, PART headings, `num title`, lines with `label` + text indented by depth (padding-left `depth * 22px`), products with label + heading, table for table style; `Download Word` (`pk-btn-accent`, `href=/api/spec-documents/<id>/docx`). When `section` is null: a notice "This section is no longer in the library" and no download.
7. **Delete spec** (`ConfirmButton` if the repo has one — search `src/components` — else `window.confirm`) → `deleteSpecDocumentAction` → `router.push("/design/specs")`.
When `canEdit` is false, render inputs disabled and hide add/remove/delete.

- [ ] **Step 1: Failing tests:**
```ts
// #205 spec builder T5
{
  const b = read("src/app/(app)/design/specs/[id]/builder.tsx");
  const f = read("src/app/(app)/design/specs/new/new-spec-form.tsx");
  for (const [name, text] of [["builder", b], ["new-spec-form", f]] as const) {
    ok(text.startsWith('"use client"') && !/@\/lib\/stores\/|@\/db\/|from "docx"|exceljs/.test(text.replace(/import type[^;]*;/g, "")), `#205 spec builder: ${name} is a client file with no store/db/docx imports`);
  }
  ok(b.includes("/api/spec-documents/") && b.includes("searchSpecPartsAction") && b.includes("writePartSpecFieldsAction"), "#205 spec builder: builder downloads, searches and writes part specs");
  const list = read("src/app/(app)/design/specs/page.tsx");
  ok(!list.includes('redirect("/design/specs/library")') && list.includes("/design/specs/new"), "#205 spec builder: /design/specs is the saved-spec list with + New spec");
  const smoke = read("scripts/smoke-routes.ts");
  ok(smoke.includes('"/design/specs/new"'), "#205 spec builder: smoke covers the new-spec page");
}
```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4:** tsc + specs 0/0, then `npx next build` (must succeed — this is the client-import gate). **Step 5: Commit** (`feat(specs): spec list, new spec, builder screens (#205 Phase B T5)`).

---

### Task 6: Entry points, docs, final gates

**Files:**
- Modify: `src/app/(app)/quotes/page.tsx` (detail panel near `editHrefFor(q).label`, ~line 1035): for system quotes (`!q.quoteType || q.quoteType === "system"` — check the real system type value in `src/lib/stores/quotes.ts`), add a link `Spec from this quote →` → `/design/specs/new?quote=<id>`.
- Modify: `src/app/(app)/design/grid/[id]/page.tsx` + `editor.tsx`: `specHref` no longer requires an engagement — the editor builds `/design/specs/new?grid=<project.id>&quote=<activeOption.quoteId>` when `activeOption.quoteId` is set; link text `Spec from this design →`. Remove the now-unused engagement lookup for `specHref` if nothing else uses it.
- Modify: `src/app/(app)/design/engagements/view.tsx` (~line 461): the Bid spec link → `/design/specs/new?engagement=<id>`.
- Modify: `DECISIONS.md`, `PUNCHLIST.md` (#205 entry), `AGENTS.md` (phase 13 line). Recompute the next D number from `git show origin/main:DECISIONS.md | grep -oE "^## D[0-9]+" | tail -1` right before writing (expected D329…).
- Test: append `// #205 spec builder T6`

- [ ] **Step 1: Failing tests:**
```ts
// #205 spec builder T6
{
  ok(read("src/app/(app)/quotes/page.tsx").includes("/design/specs/new?quote="), "#205 spec builder: quotes hub offers Spec from this quote");
  const ed = read("src/app/(app)/design/grid/[id]/editor.tsx");
  ok(ed.includes("/design/specs/new?grid=") && ed.includes("Spec from this design"), "#205 spec builder: the Grid editor links to the spec builder without an engagement");
  ok(read("src/app/(app)/design/engagements/view.tsx").includes("/design/specs/new?engagement="), "#205 spec builder: the engagement's Bid spec link opens the new builder");
}
```
- [ ] **Step 2: Implement** the three links.
- [ ] **Step 3: Docs.** DECISIONS entries (plain, like D326–D328):
  - **D329** Spec builder replaces the D94 generator's entry points: one CSI section per Word file; `spec_documents` (`SP-####`); Parts 1/3 read live from the library (the downloaded file is the snapshot); old saved D94 specs stay viewable.
  - **D330** Word output uses one real multi-level numbering definition (PART → n.m → A. → 1. → a. → 1) → a)) so a spec renumbers when edited in Word — deliberately unlike D94a's typed numbers; header/footer/file name follow the North HS originals.
  - **D331** Products: picker shows approved-spec parts in the section by default, "Show all catalog parts" allows writing spec text onto a part (authored, via the Spec panel's action); per-spec header override never changes the part; left-out products (no spec / needs a header / other section / deleted) are listed, never printed, never block; quantities only from a BOM, behind Print quantities (off by default).
  - **D332** Fill-ins: `[FILL IN: …]` blanks keyed by article + position, answered per spec, unanswered print as written; stale answers shown, never re-applied.
  PUNCHLIST #205: Phase B generator DONE (list the above); remaining: spec-writer skill, curtains via curtain templates, zip of several sections. AGENTS phase 13: one sentence on the builder.
- [ ] **Step 4: Gates:** `npx tsc --noEmit -p .` (0), `npm run test:specs` (0 FAIL — report total PASS and the six blocks' counts), `npx eslint` on every changed/new file (0 errors; report warnings vs the files' pre-existing ones), `npx next build` (success; `/design/specs`, `/design/specs/new`, `/design/specs/[id]`, `/api/spec-documents/[id]/docx` listed).
- [ ] **Step 5: Commit** (`feat(specs): spec builder entry points + docs (#205 Phase B T6, D329–D332)`).
