# Part Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a datasheet and a spec sheet on every part Peak actually quotes — shared documents, attached once and reused, with accessories covered by their fixture's document through a DaVinci-style accessory graph — and make Specs coverage, client packages and the Displays API read the same rule.

**Architecture:** Three new doc-store collections (`part_documents`, `part_document_links`, `part_accessory_links`, migration 0026) hold shared document records, part↔document links and the fixture → accessory graph. One pure coverage rule (`src/lib/part-docs/coverage.ts`) turns those plus the catalog into a per-slot answer — own / not needed / covered / link only / missing — optionally in the context of one quote or design; one server loader (`loadPartDocsState`) builds that index once per request from the catalog the caller already listed. Files go browser → private Vercel Blob directly (`handleUpload`), are checked by magic bytes before anything is recorded, and are served by one signed-in viewer route; manufacturer links are fetched through the venue-calendar SSRF guard.

**Tech Stack:** Next.js 16 App Router (server components, server actions, route handlers), TypeScript, Drizzle doc-store on Postgres (Neon) / PGlite in dev and tests, `@vercel/blob` 2.6 (`put`/`get`/`del`, `@vercel/blob/client` `upload` + `handleUpload`), `tsx` test harnesses.

**Spec:** `docs/superpowers/specs/2026-09-25-part-documents-design.md` — read it first. Also read `AGENTS.md` (Next.js 16 differs from your training data: check `node_modules/next/dist/docs/` before writing a route handler or config).

**Verified:** every task below was built and gated in a throwaway copy of this branch before the plan was written — tsc, eslint (111 → 110 warnings, 0 errors), `npm run test:specs` (125 new `part docs` + 11 `#DOC` assertions), `npm run test:review:regressions`, `npx drizzle-kit generate` ("No schema changes") and `next build`. `test:smoke` was not run there (it boots a dev server); Task 12 runs it.

## Global Constraints

Every task's requirements implicitly include this section.

- **Scope = parts ever quoted (spec §2.1):** every SKU on any quote (any status), any Grid design placement, any saved bid spec — **no time window**. Ranked by how many quotes use it.
- **Two document kinds per part (§2.2):** **Datasheet** (PDF) and **Spec sheet** (PDF or Word — the manufacturer's A&E guide spec). A slot is satisfied by a document of that kind linked to the part.
- **Anyone signed in (§2.4)** can upload, attach, replace and remove; every change records who/when; **nothing is ever hard-deleted** (replaced files are kept in history). Server actions call `requireUser()`; only the DaVinci pre-fill is `requirePerm("manage_users")`.
- **DaVinci model (§2.5):** documents are shared records attached to many parts; accessory coverage comes from a fixture → accessory graph, **computed in context, never stored on the accessory**.
- **Coverage rule (§4):** own → not needed → covered (parents with their own document of that kind; in a quote/package context only parents present on it; "has its own datasheet" excludes that parent link) → link only (not satisfied) → missing. "Covered on N fixture datasheets" — N = distinct parent documents; **collapse the list above 5**.
- **Files:** Vercel Blob **private**, path `part-docs/<documentId>/<fileName>`; direct-to-Blob client uploads (the recordings route's `handleUpload` pattern); **cap 25 MB**; PDF for a datasheet, PDF/DOC/DOCX for a spec sheet, **checked by magic bytes after upload, before attaching**; the token route requires a signed-in user.
- **Fetch (§6):** reuse `src/lib/venue-calendar-fetch.ts`'s guards — http/https only, every redirect hop re-validated, private/loopback/link-local refused after DNS, streaming size cap, timeout; batch fetch runs a bounded number per request and is resumable.
- **DaVinci pre-fill (§6):** ETC only; `part_accessory_links` (source "davinci") only where both ends match Peak SKUs (duplicate SKUs across classifications merged); `part_documents` with **`sourceUrl` only — no ETC file is downloaded or rehosted** by the pre-fill.
- **Migration:** additive, new tables only, hand-written and idempotent per D141 (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE TRIGGER … bump_doc_seq()`); after it, `npx drizzle-kit generate` must report `No schema changes, nothing to migrate 😴`.
- **Client/server boundary:** a `"use client"` file imports only pure modules (`src/lib/part-docs/{types,coverage,views,files,assembly-graph,suggest}.ts`, `src/lib/format.ts`, …), `type`-only imports from anywhere, and server **actions**. Never a value from `@/lib/stores/*` or `@/db/*`. Every task that touches a `"use client"` file runs `env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build` and then `rm -rf .next`.
- **Catalog writes go through `mergeUpsert(sku, patch)`**, never `upsert` (a full replace wipes ports, spec fields, datasheet fields…). Guard with `get(sku)` first — `mergeUpsert` creates a part that does not exist.
- **Destructive UI uses the shared `ConfirmButton`** (`src/components/confirm-button.tsx`); its `onConfirm` must `throw new Error(r.error)` on `{ ok: false }` so the refusal shows.
- **Scale:** production has ~37,400 catalog parts. One load of each collection per request (`loadPartDocsState(parts)` takes the catalog the caller already listed); single-pass Maps; never a scan of one collection per element of another; the catalog never ships to the browser (bulk drop sends file names; part search is a server action over `searchDocs`).
- **Numbering placeholders:** `#DOC` for the punch item and `D-DOC-1`…`D-DOC-11` for decisions, in code comments and docs. The lead renumbers at merge time.
- **Timestamps** are epoch-ms numbers. **Design tokens:** `pk-*` classes; accent only via `var(--accent)`.
- **Environment:** run every command from `/Users/sm/Downloads/peak-app/.claude/worktrees/part-docs` after `export PATH=$HOME/.local/node/bin:$PATH`. Never touch `/Users/sm/Downloads/peak-app` (the main checkout) except to **read** the DaVinci `library.json` in Task 10, never open any real `.data/` (every DB command here uses `PGLITE_PATH=$(mktemp -d)` or an npm script that does), never run `next dev` yourself (only `npm run test:smoke` in Task 12 boots one), never `git stash` (the stash is shared across worktrees — commit instead), and check `ps aux | grep tsx` is empty before any DB script.
- **Gates per task:** `npx tsc --noEmit -p .` clean; `npx eslint` 0 errors and no new warnings (baseline **111**); `env -u DATABASE_URL npm run test:specs` → `ALL PASSED`; `env -u DATABASE_URL npm run test:review:regressions` whenever the task is DB-backed; the build when it touches a client file. A known pre-existing flake — `redeem: tampered code -> not ok` — fails about one run in sixty (it flips a character that is sometimes already the flipped value); if it is the only FAIL, re-run.

## Decisions this plan takes (logged in Task 12 as D-DOC-1…D-DOC-11)

1. **Ids.** `PD-` + 12 random hex for uploads/fetches (browser-mintable, no scan); deterministic `PD-L…` (legacy, per SKU) and `PD-D…` (DaVinci, per URL); link ids `PDL-…` per (part, document); accessory ids `PAL-…` per (source, scope, parent, accessory). A URL is one document, shared.
2. **"Has its own datasheet"** is a pair-level flag on the graph links, applies to both kinds, and any link of the pair setting it opts the pair out.
3. **Fetch failures persist** on the document as additive `lastFetch`; a failing catalog URL becomes a link-only document carrying the reason.
4. **Filename matching** uses `normalizeSku` keys (SKU, MFR P/N, MFR M/N), longest length wins, keys < 4 characters ignored, ambiguous rows not pre-ticked, whole catalog.
5. **"Quoted"**: distinct quotes count; Grid/bid-spec use break ties; labor lines, labor sections, `Labor`-category parts and curtain placements are out.
6. **The part editor's Documents section replaces the admin-only single-datasheet control**; its actions are deleted; `datasheetBlobKey` stays readable (backfill + the `/api/part-datasheet/<sku>` bridge).
7. **Both Assembly Builder tabs feed the graph** (`assembly:<id>` and `subassembly:<id>` scopes); the toggle needs a saved member.
8. **DaVinci**: English Datasheet documents only, keyed by URL; the committed extract gains the accessory graph (~1.39 → ~2.65 MB, records unchanged); admin button (extract traced into the route) + CLI.
9. **Client packages** zip each document once; coverage in the package's own context; only a missing **datasheet** is a gap; `covered[]` carries "covered by <fixture>"; the manifest's `datasheets` array becomes `documents`.
10. **A rejected upload's blob is deleted** (it never became a document).
11. **Displays API** datasheet links come from documents (viewer URL, else the catalog's manufacturer URL); the ETag folds in documents.

## File Structure

**Created**

| File | Responsibility |
|------|----------------|
| `drizzle/0026_part_documents.sql`, `drizzle/meta/0026_snapshot.json` | The three tables, idempotent; chained snapshot. |
| `src/lib/part-docs/types.ts` | Pure. Shapes, kinds, limits, id minting, blob paths. |
| `src/lib/part-docs/coverage.ts` | Pure. The coverage rule and its index. The single source of "is this slot satisfied". |
| `src/lib/part-docs/quoted-parts.ts` | Pure. Which parts are quoted and how often. |
| `src/lib/part-docs/filename-match.ts` | Pure. Bulk-drop matching and the kind guesser. |
| `src/lib/part-docs/files.ts` | Pure. Magic bytes, content types, accept lists, dispositions, fetched-file names. |
| `src/lib/part-docs/views.ts` | Pure. Serializable view models for the to-do page and the part editor. |
| `src/lib/part-docs/suggest.ts` | Pure. "Also covers…" suggestions. |
| `src/lib/part-docs/assembly-graph.ts` | Pure. Assembly ↔ graph pairs and member coverage. |
| `src/lib/part-docs/package.ts` | Pure. Which documents a client package carries. |
| `src/lib/part-docs/davinci-prefill.ts` | Pure. DaVinci → documents + graph plan. |
| `src/lib/stores/part-documents.ts` | Server. `part_documents` + `part_document_links` CRUD. |
| `src/lib/stores/part-accessory-links.ts` | Server. The graph: scoped sync, own-datasheet toggle. |
| `src/lib/part-docs/legacy.ts` | Server. Idempotent `datasheetBlobKey` backfill. |
| `src/lib/part-docs/not-needed.ts` | Server. Not-needed marks via `mergeUpsert`. |
| `src/lib/part-docs/load.ts` | Server. `loadPartDocsState` — the one load per request. |
| `src/lib/part-docs/verify-upload.ts` | Server. Accept an uploaded blob (path + bytes + size). |
| `src/lib/part-docs/fetch.ts` | Server. Guarded download of a manufacturer URL. |
| `src/lib/part-docs/fetch-links.ts` | Server. Fetch a slot's links, one document per URL, share it. |
| `src/lib/part-docs/davinci-apply.ts` | Server. Write the DaVinci pre-fill. |
| `src/app/api/part-documents/upload/route.ts` | Client-upload token broker. |
| `src/app/api/part-documents/[id]/route.ts` | Signed-in viewer (stream / redirect / history). |
| `src/app/(app)/catalog/documents/actions.ts` | Every part-document server action. |
| `src/app/(app)/catalog/documents/page.tsx` | Catalog → Datasheets (server). |
| `src/app/(app)/catalog/documents/{documents-client,slot-cell,also-covers,davinci-prefill-button}.tsx` | Client UI. |
| `src/app/(app)/catalog/documents/upload-client.ts` | Browser upload helper. |
| `src/app/(app)/catalog/documents/upload/{page,bulk-drop}.tsx` | Upload many. |
| `src/app/(app)/catalog/part-documents-section.tsx` | The part editor's Documents section. |
| `src/app/(app)/design/assemblies/member-coverage.tsx` | A member's coverage chip + toggle. |
| `scripts/part-docs-backfill.ts`, `scripts/part-docs-davinci.ts` | CLI: legacy backfill; DaVinci pre-fill. |

**Modified**

| File | Change |
|------|--------|
| `src/db/doc-tables.ts`, `drizzle/meta/_journal.json` | Register the collections; journal entry 26. |
| `src/lib/stores/catalog.ts` | `docNotNeeded`; `datasheetBlobKey` documented as legacy. |
| `src/lib/blob.ts` | `getBlobHead`. |
| `src/lib/venue-calendar-fetch.ts` | Export `hostnameIsUnsafe` (guard reused unchanged). |
| `src/app/(app)/catalog/page.tsx`, `controls.tsx`, `actions.ts`, `spec-panel.tsx` | Datasheets link; Documents section; the legacy control and its actions removed. |
| `src/app/(app)/design/assemblies/{actions,assembly-builder,page}.tsx`, `src/app/(app)/design/subassemblies/{actions,subassemblies-client}.tsx` | Graph sync on save; coverage chips. |
| `src/lib/davinci/{types,extract}.ts`, `scripts/davinci-extract.ts`, `data/davinci-extract.json` | The accessory graph. |
| `src/app/(app)/design/specs/coverage.ts`, `…/specs/library/page.tsx` | Datasheet column = the rule. |
| `src/lib/client-package.ts`, `src/lib/client-package-server.ts`, `src/app/api/grid/[id]/package-manifest/route.ts` | Documents once, coverage in context. |
| `src/lib/displays-api.ts`, `src/app/api/v1/displays/**` | Datasheet links from documents; ETag. |
| `src/app/api/part-datasheet/[id]/route.ts` | Bridge to the viewer. |
| `src/app/(app)/design/grid/[id]/page.tsx`, `src/lib/design/grid-bom.ts` | `hasDatasheet` from documents. |
| `next.config.ts`, `package.json` | Trace the extract; two scripts. |
| `scripts/test-review-and-spec.ts`, `scripts/test-review-regressions.ts`, `scripts/smoke-routes.ts` | Tests. |
| `DECISIONS.md`, `PUNCHLIST.md` | D-DOC-1…11, `#DOC`, #40 status. |

---

### Task 1: Collections, migration 0026 and the shared types

**Files:**
- Create: `src/lib/part-docs/types.ts`
- Create: `drizzle/0026_part_documents.sql`
- Create: `drizzle/meta/0026_snapshot.json` (generated by the script in Step 6)
- Modify: `drizzle/meta/_journal.json` (same script)
- Modify: `src/db/doc-tables.ts` (three registrations + three `DOC_TABLES` entries)
- Modify: `src/lib/stores/catalog.ts` (`CatalogPart.docNotNeeded`)
- Test: `scripts/test-review-and-spec.ts` (append a `Task 1` block)

**Interfaces:**
- Consumes: nothing.
- Produces (all in `src/lib/part-docs/types.ts`, pure, client-safe):
  ```ts
  export type PartDocKind = "datasheet" | "specsheet";
  export const PART_DOC_KINDS: readonly PartDocKind[];
  export const PART_DOC_KIND_LABEL: Record<PartDocKind, string>;      // "Datasheet" | "Spec sheet"
  export function isPartDocKind(v: unknown): v is PartDocKind;
  export type PartDocumentSource = "upload" | "fetch" | "davinci" | "legacy";
  export type PartDocumentHistoryEntry = { blobKey: string; fileName: string; size: number; replacedAt: number; replacedBy: string };
  export type PartDocument = { id; kind; title; fileName; contentType; size; blobKey: string | null; sourceUrl: string | null;
    source: PartDocumentSource; sourceRef?; language?; uploadedAt: number; uploadedBy: string; history: PartDocumentHistoryEntry[];
    lastFetch?: { at: number; ok: boolean; error?: string } };
  export type PartDocumentLink = { id; partSku; documentId; kind: PartDocKind; createdAt: number; createdBy: string };
  export type AccessoryLinkSource = "assembly" | "davinci" | "manual";
  export type PartAccessoryLink = { id; parentSku; accessorySku; maxQty?; included?; ownDatasheet?: boolean; source: AccessoryLinkSource; sourceRef? };
  export type AccessoryPair = { parentSku: string; accessorySku: string; maxQty?: number; included?: boolean; sourceRef?: string };
  export type DocNotNeeded = { datasheet?: true; specsheet?: true };
  export const MAX_PART_DOC_BYTES: number;       // 25 MB
  export const FETCH_BATCH_SIZE: number;         // 4
  export const PART_DOC_PREFIX: "part-docs/";
  export function newDocumentId(): string;       // "PD-" + 12 hex, random
  export function isDocumentId(v: unknown): v is string;   // /^PD-[A-Za-z0-9]{6,40}$/
  export function safeDocFileName(name: string): string;
  export function partDocBlobPath(documentId: string, fileName: string): string;   // part-docs/<id>/<safe name>
  export function blobPathBelongsTo(pathname: unknown, documentId: string): pathname is string;
  ```
- Produces: collection names `"part_documents"`, `"part_document_links"`, `"part_accessory_links"` for every `@/db/doc-store` call; `CatalogPart.docNotNeeded?: DocNotNeeded`.

- [ ] **Step 1: Write the failing test**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts

/* ======================================================================
   Part documents (#DOC) — Task 1: document ids and blob paths. Pure.
   ====================================================================== */
import { newDocumentId, isDocumentId, partDocBlobPath, blobPathBelongsTo, safeDocFileName } from "@/lib/part-docs/types";

{
  const id = newDocumentId();
  ok(/^PD-[0-9a-f]{12}$/.test(id) && isDocumentId(id) && newDocumentId() !== id, "part docs ids: PD- + 12 hex, random");
  ok(!isDocumentId("PD-../x") && !isDocumentId("Q-2041") && !isDocumentId(null), "part docs ids: anything else is refused");
  ok(safeDocFileName("ETC S4 / Datasheet (EN).pdf") === "ETC_S4_Datasheet_EN_.pdf" && safeDocFileName("") === "file", "part docs ids: file names are made path-safe");
  ok(partDocBlobPath("PD-abcdef123456", "a b.pdf") === "part-docs/PD-abcdef123456/a_b.pdf", "part docs ids: the blob path is part-docs/<id>/<file>");
  ok(blobPathBelongsTo("part-docs/PD-abcdef123456/a_b-Xy12.pdf", "PD-abcdef123456"), "part docs ids: a suffixed pathname under the id belongs to it");
  ok(!blobPathBelongsTo("part-docs/PD-other123456/a.pdf", "PD-abcdef123456") && !blobPathBelongsTo("part-docs/PD-abcdef123456/../x", "PD-abcdef123456") && !blobPathBelongsTo("part-docs/PD-abcdef123456/sub/x.pdf", "PD-abcdef123456"), "part docs ids: another document's path, traversal and nesting are refused");
}
```


- [ ] **Step 2: Run it to verify it fails**

```bash
env -u DATABASE_URL npm run test:specs 2>&1 | grep -m1 -i 'cannot find module'
```

Expected: `Error: Cannot find module '@/lib/part-docs/types'` (the whole harness refuses to load).


- [ ] **Step 3: Create the shared types**

Create `src/lib/part-docs/types.ts`:

```ts
/**
 * Part documents (#DOC) — the shared shapes. Pure: no store, no `@/db`, no
 * Node built-ins, so client components import this freely.
 *
 * A document is a SHARED record (DaVinci's model): one datasheet PDF is
 * linked to many parts through `part_document_links`, and accessories are
 * covered by their fixture's document through `part_accessory_links` —
 * computed in context (src/lib/part-docs/coverage.ts), never stored on the
 * accessory. Spec: docs/superpowers/specs/2026-09-25-part-documents-design.md §5.
 */

export type PartDocKind = "datasheet" | "specsheet";
export const PART_DOC_KINDS: readonly PartDocKind[] = ["datasheet", "specsheet"];
export const PART_DOC_KIND_LABEL: Record<PartDocKind, string> = { datasheet: "Datasheet", specsheet: "Spec sheet" };

export function isPartDocKind(v: unknown): v is PartDocKind {
  return v === "datasheet" || v === "specsheet";
}

export type PartDocumentSource = "upload" | "fetch" | "davinci" | "legacy";

/** A file this document used to hold. Replacing never deletes the blob (§2.4). */
export type PartDocumentHistoryEntry = {
  blobKey: string;
  fileName: string;
  size: number;
  replacedAt: number;
  replacedBy: string;
};

export type PartDocument = {
  id: string;
  kind: PartDocKind;
  title: string;
  fileName: string;
  contentType: string;
  size: number;
  /** Private Vercel Blob pathname (`part-docs/<id>/<file>`); null = link only. */
  blobKey: string | null;
  /** The manufacturer URL this document came from (or can be fetched from). */
  sourceUrl: string | null;
  source: PartDocumentSource;
  /** DaVinci documentId, legacy SKU, … — provenance only. */
  sourceRef?: string;
  language?: string;
  uploadedAt: number;
  uploadedBy: string;
  history: PartDocumentHistoryEntry[];
  /** The last fetch attempt of `sourceUrl` (D-DOC-3): failures stay listed
   *  with their reason until a later fetch succeeds. */
  lastFetch?: { at: number; ok: boolean; error?: string };
};

export type PartDocumentLink = {
  id: string;
  partSku: string;
  documentId: string;
  kind: PartDocKind;
  createdAt: number;
  createdBy: string;
};

export type AccessoryLinkSource = "assembly" | "davinci" | "manual";

export type PartAccessoryLink = {
  id: string;
  parentSku: string;
  accessorySku: string;
  maxQty?: number;
  included?: boolean;
  /** The accessory ships its own datasheet — this parent link never covers it (§4). */
  ownDatasheet?: boolean;
  source: AccessoryLinkSource;
  sourceRef?: string;
};

/** One parent → accessory pair a writer wants in the graph. */
export type AccessoryPair = {
  parentSku: string;
  accessorySku: string;
  maxQty?: number;
  included?: boolean;
  /** Provenance for this one pair (a DaVinci parent typeId). */
  sourceRef?: string;
};

/** Per-kind "this part needs no document" marks, stored on the catalog part. */
export type DocNotNeeded = { datasheet?: true; specsheet?: true };

/** Upload and fetch ceiling (§6). */
export const MAX_PART_DOC_BYTES = 25 * 1024 * 1024;

/** Slots fetched per server-action call — each can take up to the fetcher's
 *  30 s timeout, so the page loops over a selection in batches this size. */
export const FETCH_BATCH_SIZE = 4;

/** Blob pathname prefix — every part document lives under it. */
export const PART_DOC_PREFIX = "part-docs/";

/** `PD-` + 12 lowercase hex. Random, so minting one needs no collection scan
 *  and a browser can mint the id its upload path is keyed under. The legacy
 *  backfill uses its own deterministic `PD-L…` ids (see legacyDocumentId). */
export function newDocumentId(): string {
  return "PD-" + globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

/** Every id this module mints: `PD-` + 6-40 letters/digits. Blocks path
 *  traversal in the upload route and the attach actions. */
export function isDocumentId(v: unknown): v is string {
  return typeof v === "string" && /^PD-[A-Za-z0-9]{6,40}$/.test(v);
}

/** Same rule as src/lib/blob.ts `safeName` (which is server-only because it
 *  shares a module with the Blob SDK), duplicated here so the browser can
 *  build the exact pathname the upload route will accept. */
export function safeDocFileName(name: string): string {
  return (
    String(name ?? "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "file"
  );
}

/** `part-docs/<documentId>/<fileName>` (§5). The Blob SDK appends a random
 *  suffix, so a replace under the same document id never overwrites. */
export function partDocBlobPath(documentId: string, fileName: string): string {
  return `${PART_DOC_PREFIX}${documentId}/${safeDocFileName(fileName)}`;
}

/** Does `pathname` belong to `documentId`? Used on every client-supplied
 *  pathname before the server reads or records it — a client blobPath is
 *  untrusted input. */
export function blobPathBelongsTo(pathname: unknown, documentId: string): pathname is string {
  if (typeof pathname !== "string" || !isDocumentId(documentId)) return false;
  const prefix = `${PART_DOC_PREFIX}${documentId}/`;
  return pathname.startsWith(prefix) && pathname.length > prefix.length && !pathname.includes("..") && !pathname.slice(prefix.length).includes("/");
}
```


- [ ] **Step 4: Put the not-needed marks on the catalog part**

In `src/lib/stores/catalog.ts`, replace this exact text:

```ts
import type { Port } from "@/lib/catalog-connect";
```

with:

```ts
import type { Port } from "@/lib/catalog-connect";
import type { DocNotNeeded } from "@/lib/part-docs/types";
```

In `src/lib/stores/catalog.ts`, replace this exact text:

```ts
  /** Original filename of the attached datasheet, for display. */
  datasheetName?: string;
```

with:

```ts
  /** Original filename of the attached datasheet, for display. */
  datasheetName?: string;
  /** Part documents (#DOC): "this part needs no datasheet / spec sheet" —
   *  satisfies that slot in the coverage rule (src/lib/part-docs/coverage.ts).
   *  Written only through mergeUpsert (setDocNotNeeded). */
  docNotNeeded?: DocNotNeeded;
```


- [ ] **Step 5: Register the three collections**

In `src/db/doc-tables.ts`, replace this exact text:

```ts
export const specCurtainTemplates = docTable("spec_curtain_templates"); // Specs module (#205) — one document per Grid curtain type; migration 0025_spec_library
```

with:

```ts
export const specCurtainTemplates = docTable("spec_curtain_templates"); // Specs module (#205) — one document per Grid curtain type; migration 0025_spec_library
export const partDocuments = docTable("part_documents"); // Part documents (#DOC) — shared datasheet/spec-sheet records, one file attached to many parts; migration 0026_part_documents
export const partDocumentLinks = docTable("part_document_links"); // Part documents (#DOC) — one row per part↔document, soft-deleted to detach; migration 0026_part_documents
export const partAccessoryLinks = docTable("part_accessory_links"); // Part documents (#DOC) — the fixture→accessory graph that computes accessory coverage; migration 0026_part_documents
```

In `src/db/doc-tables.ts`, replace this exact text:

```ts
  spec_curtain_templates: specCurtainTemplates,
```

with:

```ts
  spec_curtain_templates: specCurtainTemplates,
  part_documents: partDocuments,
  part_document_links: partDocumentLinks,
  part_accessory_links: partAccessoryLinks,
```

Do **not** add them to `SYNCABLE_COLLECTIONS` — like `spec_sections`, these are written only by permission-checked server code, never by `/api/sync/push`.


- [ ] **Step 6: Write the idempotent migration (D141)**

Hand-written, never `drizzle-kit generate`d: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and a `CREATE OR REPLACE TRIGGER … bump_doc_seq()` per table (without the trigger, pull-sync's `WHERE seq > cursor` never sees an UPDATE). Column-for-column `docTable()`, copied from `drizzle/0025_spec_library.sql`.

Create `drizzle/0026_part_documents.sql`:

```sql
-- Part documents (#DOC, docs/superpowers/specs/2026-09-25-part-documents-design.md §5) —
-- shared datasheet/spec-sheet records, the part↔document links, and the
-- fixture→accessory graph that computes accessory coverage.
--
-- Hand-rewritten from the generated DDL so it is idempotent per D141: this
-- file runs against a shared Neon database that more than one branch's build
-- migrates, and the 2026-07 production failure on 0020 was exactly a
-- non-idempotent CREATE. Column-for-column `docTable()`; each table needs its
-- own `_seq_bump` trigger or pull-sync's `WHERE seq > cursor` goes blind.
CREATE TABLE IF NOT EXISTS "part_documents" (
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
CREATE INDEX IF NOT EXISTS "part_documents_seq_idx" ON "part_documents" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_documents_deleted_idx" ON "part_documents" USING btree ("deleted");--> statement-breakpoint
CREATE OR REPLACE TRIGGER part_documents_seq_bump BEFORE UPDATE ON "part_documents" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "part_document_links" (
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
CREATE INDEX IF NOT EXISTS "part_document_links_seq_idx" ON "part_document_links" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_document_links_deleted_idx" ON "part_document_links" USING btree ("deleted");--> statement-breakpoint
CREATE OR REPLACE TRIGGER part_document_links_seq_bump BEFORE UPDATE ON "part_document_links" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "part_accessory_links" (
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
CREATE INDEX IF NOT EXISTS "part_accessory_links_seq_idx" ON "part_accessory_links" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_accessory_links_deleted_idx" ON "part_accessory_links" USING btree ("deleted");--> statement-breakpoint
CREATE OR REPLACE TRIGGER part_accessory_links_seq_bump BEFORE UPDATE ON "part_accessory_links" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
```


- [ ] **Step 7: Chain the snapshot and the journal**

The snapshot is the previous one plus three tables cloned from `spec_articles`, with a fresh `id` and `prevId` = 0025's id; the journal gains `0026_part_documents`. Run from the worktree root:

```bash
node <<'JS'
const fs = require("fs");
const crypto = require("crypto");
const journalPath = "drizzle/meta/_journal.json";
const j = JSON.parse(fs.readFileSync(journalPath, "utf8"));
const last = j.entries[j.entries.length - 1];
if (last.tag !== "0025_spec_library") throw new Error("expected 0025_spec_library as the last journal entry, found " + last.tag);
const prev = JSON.parse(fs.readFileSync("drizzle/meta/0025_snapshot.json", "utf8"));
const next = JSON.parse(JSON.stringify(prev));
next.id = crypto.randomUUID();
next.prevId = prev.id;
const template = prev.tables["public.spec_articles"];
for (const name of ["part_documents", "part_document_links", "part_accessory_links"]) {
  const t = JSON.parse(JSON.stringify(template).split("spec_articles").join(name));
  next.tables["public." + name] = t;
}
fs.writeFileSync("drizzle/meta/0026_snapshot.json", JSON.stringify(next, null, 2) + "\n");
j.entries.push({ idx: 26, version: "7", when: Math.max(Date.now(), last.when + 1), tag: "0026_part_documents", breakpoints: true });
fs.writeFileSync(journalPath, JSON.stringify(j, null, 2) + "\n");
console.log("0026 snapshot", next.id, "chained to", prev.id);
JS
```

Expected: `0026 snapshot <uuid> chained to 90cdb71d-eda3-41bb-ba82-c5290e0c5872`, and `git diff --stat drizzle/meta/_journal.json` shows `7 +++++++`.


- [ ] **Step 8: Prove the snapshot matches the schema**

```bash
npx drizzle-kit generate 2>&1 | tail -1
```

Expected: `No schema changes, nothing to migrate 😴`. Anything else means the snapshot is wrong — fix the snapshot; never keep a generated SQL file.


- [ ] **Step 9: Prove the migration applies to a fresh database and re-applies as a no-op**

Never point this at `.data/pglite`. `ps aux | grep tsx` must show no stray `tsx` first.

```bash
D=$(mktemp -d)
env -u DATABASE_URL PGLITE_PATH="$D" npx tsx -e '
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb } from "./src/db";
(async () => {
  const db = await getDb(); // opening PGlite runs migrate() — the first application
  for (const stmt of readFileSync("drizzle/0026_part_documents.sql", "utf8").split("--> statement-breakpoint")) {
    if (stmt.trim()) await db.execute(sql.raw(stmt)); // the second application: every statement must be a no-op
  }
  const r = await db.execute(sql`select tgname from pg_trigger where tgname like ${"part_%_seq_bump"} order by 1`);
  console.log("re-applied 0026 cleanly:", JSON.stringify((r as { rows?: unknown }).rows ?? r));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
'
rm -rf "$D"
```

Expected: `re-applied 0026 cleanly: [{"tgname":"part_accessory_links_seq_bump"},{"tgname":"part_document_links_seq_bump"},{"tgname":"part_documents_seq_bump"}]`


- [ ] **Step 10: Run the gates**

```bash
npx tsc --noEmit -p .
```

Expected: no output, exit 0.

```bash
env -u DATABASE_URL npm run test:specs > "${TMPDIR:-/tmp}/pd-specs.log" 2>&1; tail -1 "${TMPDIR:-/tmp}/pd-specs.log"; grep '^FAIL' "${TMPDIR:-/tmp}/pd-specs.log" | head -5
```

Expected: `ALL PASSED` and no `FAIL` lines. (One pre-existing flake exists — `redeem: tampered code -> not ok`, a random-code test that fails about one run in sixty; if it is the only FAIL, re-run.)

Expected additionally: `grep -c '^PASS part docs ids' "${TMPDIR:-/tmp}/pd-specs.log"` prints `6`.


- [ ] **Step 11: Commit**

```bash
git add src/lib/part-docs/types.ts src/lib/stores/catalog.ts src/db/doc-tables.ts drizzle/0026_part_documents.sql drizzle/meta/0026_snapshot.json drizzle/meta/_journal.json scripts/test-review-and-spec.ts
git commit -m "feat(part-docs): part_documents, part_document_links, part_accessory_links + migration 0026 + shared types" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 2: The coverage rule, the quoted-parts counter and the filename matcher (pure)

**Files:**
- Create: `src/lib/part-docs/coverage.ts`
- Create: `src/lib/part-docs/quoted-parts.ts`
- Create: `src/lib/part-docs/filename-match.ts`
- Test: `scripts/test-review-and-spec.ts` (append a `Task 2` block)

**Interfaces:**
- Consumes: Task 1 types; `normalizeSku` from `src/lib/davinci/sku.ts` (pure).
- Produces (`coverage.ts`, pure):
  ```ts
  export type CoveragePartInput = { sku: string; docNotNeeded?: DocNotNeeded; docs?: Array<{ kind: string; url: string }>;
    productMetadata?: { datasheets?: Array<{ kind: string; sourceUrl?: string }> } };
  export type CoverageIndex = { docsById: Map<string, PartDocument>; docsBySku: Map<string, { datasheet: PartDocument[]; specsheet: PartDocument[] }>;
    parentsOf: Map<string, Array<{ parentSku: string; ownDatasheet: boolean }>>; childrenOf: Map<string, string[]>;
    notNeeded: Map<string, DocNotNeeded>; catalogUrls: Map<string, { datasheet: string[]; specsheet: string[] }> };
  export type DocRef = { id: string; title: string; fileName: string; hasFile: boolean; sourceUrl: string | null };
  export type SlotCoverage = { state: "own"; docs: DocRef[] } | { state: "not-needed" } | { state: "covered"; parents: string[]; docs: DocRef[] }
    | { state: "link-only"; docs: DocRef[]; urls: string[] } | { state: "missing" };
  export type SlotState = SlotCoverage["state"];
  export const COVERED_COLLAPSE = 5;
  export function urlKindOf(kind: string): PartDocKind | null;
  export function toDocRef(d: PartDocument): DocRef;
  export function buildCoverageIndex(input: { documents; links; accessoryLinks; parts: CoveragePartInput[] }): CoverageIndex;
  export function linkedDocuments(index, sku, kind): PartDocument[];
  export function ownFiles(index, sku, kind): PartDocument[];
  export function coveringParents(index, sku, kind): string[];
  export function slotCoverage(index, sku, kind, context?: ReadonlySet<string> | null): SlotCoverage;
  export function slotSatisfied(s: SlotCoverage): boolean;
  export function datasheetSatisfiedSkus(index, skus: Iterable<string>): Set<string>;
  export function collapseList<T>(items: readonly T[], max?: number): { shown: T[]; more: number };
  export function coveredLabel(n: number, kind: PartDocKind): string;
  ```
- Produces (`quoted-parts.ts`, pure): `type QuotedPartStat = { sku; quotes; lastQuotedAt: number | null; grid; bidSpecs }`, `quoteLineSkus(spec: unknown): string[]`, `quotedPartStats(sources: { quotes: unknown[]; gridProjects: unknown[]; generated: unknown[] }, isPart: (sku: string) => boolean): Map<string, QuotedPartStat>`, `rankQuotedParts(stats: Iterable<QuotedPartStat>): QuotedPartStat[]`.
- Produces (`filename-match.ts`, pure): `MIN_MATCH_KEY = 4`, `type FilenameIndex`, `type MatchablePart = { sku; manufacturerPartNumber?; manufacturerModelNumber? }`, `type FilenameMatch = { keys: string[]; skus: string[]; confidence: "high" | "ambiguous" | "none" }`, `buildFilenameIndex(parts)`, `normalizeFileName(name)`, `matchFileName(name, index): FilenameMatch`, `guessKind(name): PartDocKind`. (Task 7 appends `matchFileRows`.)

- [ ] **Step 1: Write the failing test**

The block below covers all five coverage outcomes, the context preference, the own-datasheet opt-out, the collapse above 5, the quoted-parts counter (every quote status, Grid placements, both bid-spec shapes, no window, labor skipped), longest-match filename matching with ambiguity, and the kind guesser.

Append to the end of `scripts/test-review-and-spec.ts`:

```ts

/* ======================================================================
   Part documents (#DOC) — Task 2: the coverage rule, the quoted-parts
   counter, the filename matcher and the kind guesser. All pure.
   ====================================================================== */
import {
  buildCoverageIndex, slotCoverage, slotSatisfied, coveredLabel, collapseList, datasheetSatisfiedSkus, urlKindOf,
  COVERED_COLLAPSE,
} from "@/lib/part-docs/coverage";
import { quoteLineSkus, quotedPartStats, rankQuotedParts } from "@/lib/part-docs/quoted-parts";
import { buildFilenameIndex, matchFileName, guessKind, normalizeFileName, MIN_MATCH_KEY } from "@/lib/part-docs/filename-match";
import type { PartDocument as PdDoc, PartDocumentLink as PdLink, PartAccessoryLink as PdAcc } from "@/lib/part-docs/types";

{
  const doc = (id: string, kind: "datasheet" | "specsheet", file: boolean, url: string | null = null): PdDoc => ({
    id, kind, title: id, fileName: `${id}.pdf`, contentType: "application/pdf", size: 1,
    blobKey: file ? `part-docs/${id}/${id}.pdf` : null, sourceUrl: url, source: file ? "upload" : "davinci",
    uploadedAt: 1, uploadedBy: "t", history: [],
  });
  const link = (partSku: string, d: PdDoc): PdLink => ({ id: `L-${partSku}-${d.id}`, partSku, documentId: d.id, kind: d.kind, createdAt: 1, createdBy: "t" });
  const acc = (parentSku: string, accessorySku: string, ownDatasheet = false): PdAcc => ({ id: `A-${parentSku}-${accessorySku}`, parentSku, accessorySku, source: "assembly", ownDatasheet });

  const F1 = doc("PD-fix1aaaaaaa", "datasheet", true);
  const F2 = doc("PD-fix2aaaaaaa", "datasheet", true);
  const LENS = doc("PD-lensaaaaaaa", "datasheet", true);
  const LINK = doc("PD-linkaaaaaaa", "datasheet", false, "https://example.com/x.pdf");
  const SPEC = doc("PD-specaaaaaaa", "specsheet", true);
  const index = buildCoverageIndex({
    documents: [F1, F2, LENS, LINK, SPEC],
    links: [link("FIX1", F1), link("FIX1", SPEC), link("FIX2", F2), link("LENSOWN", LENS), link("LINKY", LINK), link("FIX1", F1)],
    accessoryLinks: [
      acc("FIX1", "LENS"), acc("FIX2", "LENS"), acc("FIX1", "CLAMP"), acc("FIX1", "LENSOWN"),
      acc("FIX1", "OPTOUT", true), acc("NODOC", "ORPHAN"), acc("FIX1", "FIX1"),
    ],
    parts: [
      { sku: "NN", docNotNeeded: { datasheet: true } },
      { sku: "URLONLY", docs: [{ kind: "datasheet", url: "https://etc.example/ds.pdf" }, { kind: "manual", url: "https://etc.example/m.pdf" }] },
      { sku: "GUIDE", productMetadata: { datasheets: [{ kind: "guide-spec", sourceUrl: "https://mfr.example/guide.docx" }] } },
      { sku: "LINKY", docs: [{ kind: "datasheet", url: "https://example.com/x.pdf" }] },
    ],
  });

  // 1. own
  const own = slotCoverage(index, "FIX1", "datasheet");
  ok(own.state === "own" && own.docs.length === 1, "part docs coverage: an own file is 'own' (a duplicate link row counts once)");
  ok(slotCoverage(index, "FIX1", "specsheet").state === "own", "part docs coverage: kinds are independent slots");
  // 2. not needed
  ok(slotCoverage(index, "NN", "datasheet").state === "not-needed", "part docs coverage: a not-needed mark satisfies its kind");
  ok(slotCoverage(index, "NN", "specsheet").state === "missing", "part docs coverage: …and only its kind");
  // 3. covered
  const lens = slotCoverage(index, "LENS", "datasheet");
  ok(lens.state === "covered" && lens.parents.join(",") === "FIX1,FIX2" && lens.docs.length === 2, "part docs coverage: an accessory is covered by every parent's own datasheet, N = distinct parent documents");
  ok(slotCoverage(index, "LENSOWN", "datasheet").state === "own", "part docs coverage: an accessory's own file wins over coverage");
  ok(slotCoverage(index, "OPTOUT", "datasheet").state === "missing", "part docs coverage: an ownDatasheet pair never covers");
  ok(slotCoverage(index, "ORPHAN", "datasheet").state === "missing", "part docs coverage: a parent without a file covers nothing");
  ok(slotCoverage(index, "CLAMP", "specsheet").state === "covered", "part docs coverage: spec sheets ride the same graph");
  ok(slotCoverage(index, "FIX1", "datasheet").state === "own" && !index.parentsOf.has("FIX1"), "part docs coverage: a self-link is dropped");
  // context
  const inQuote = slotCoverage(index, "LENS", "datasheet", new Set(["LENS", "FIX2"]));
  ok(inQuote.state === "covered" && inQuote.parents.join(",") === "FIX2", "part docs coverage: in a quote only parents on that quote cover");
  ok(slotCoverage(index, "LENS", "datasheet", new Set(["LENS"])).state === "missing", "part docs coverage: an accessory quoted without any fixture is not covered on that quote");
  // 4. link only
  const urlOnly = slotCoverage(index, "URLONLY", "datasheet");
  ok(urlOnly.state === "link-only" && urlOnly.urls.join(",") === "https://etc.example/ds.pdf", "part docs coverage: a catalog datasheet URL is link-only (a manual is not)");
  ok(slotCoverage(index, "GUIDE", "specsheet").state === "link-only", "part docs coverage: a Guide Spec URL feeds the spec-sheet slot");
  const linky = slotCoverage(index, "LINKY", "datasheet");
  ok(linky.state === "link-only" && linky.docs.length === 1 && linky.urls.length === 0, "part docs coverage: a URL already on a linked document is not listed twice");
  // 5. missing
  ok(slotCoverage(index, "NOTHING", "datasheet").state === "missing", "part docs coverage: nothing at all is missing");
  // helpers
  ok(slotSatisfied(own) && slotSatisfied(lens) && !slotSatisfied(urlOnly) && !slotSatisfied({ state: "missing" }), "part docs coverage: own/covered satisfy, link-only/missing do not");
  ok(slotSatisfied({ state: "not-needed" }), "part docs coverage: not-needed satisfies");
  const sat = datasheetSatisfiedSkus(index, ["FIX1", "LENS", "URLONLY", "NN", "NOTHING"]);
  ok([...sat].sort().join(",") === "FIX1,LENS,NN", "part docs coverage: datasheetSatisfiedSkus applies the rule, link-only excluded");
  ok(COVERED_COLLAPSE === 5, "part docs coverage: the covered list collapses above 5");
  const c = collapseList([1, 2, 3, 4, 5, 6, 7]);
  ok(c.shown.length === 5 && c.more === 2 && collapseList([1, 2]).more === 0, "part docs coverage: collapseList shows 5 and counts the rest");
  ok(coveredLabel(1, "datasheet") === "Covered on 1 fixture datasheet" && coveredLabel(3, "specsheet") === "Covered on 3 fixture spec sheets", "part docs coverage: the covered label pluralizes");
  ok(urlKindOf("cut-sheet") === "datasheet" && urlKindOf("guide-spec") === "specsheet" && urlKindOf("manual") === null, "part docs coverage: URL kinds map to slots");
}

{
  ok(quoteLineSkus({ sections: [{ kind: "labor", items: [{ sku: "LAB" }] }, { items: [{ sku: "A" }, { sku: "A" }, { sku: "MOB", labor: true }, { sku: " B " }] }] }).join(",") === "A,B", "part docs quoted: labor sections and labor lines are skipped, SKUs are distinct and trimmed");
  ok(quoteLineSkus({ kind: "grid", lines: [{ sku: "G1" }, {}] }).join(",") === "G1", "part docs quoted: the Grid's flat lines count");
  ok(quoteLineSkus(null).length === 0 && quoteLineSkus("junk").length === 0, "part docs quoted: junk yields nothing");

  const catalog = new Set(["A", "B", "C", "G", "S"]);
  const stats = quotedPartStats(
    {
      quotes: [
        { updatedAt: 100, status: "lost", spec: { sections: [{ items: [{ sku: "A" }, { sku: "B" }] }] } },
        { createdAt: 300, spec: { sections: [{ items: [{ sku: "A" }, { sku: "A" }, { sku: "NOT-IN-CATALOG" }] }] } },
        { updatedAt: 1, spec: { kind: "grid", lines: [{ sku: "C" }] } },
      ],
      gridProjects: [
        { placements: [{ partId: "G" }, { partId: "G" }, { partId: "A" }, { partId: "CURT", curtain: { type: "Border" } }] },
        { placements: [{ partId: "G" }] },
      ],
      generated: [{ bom: [{ sku: "S" }] }, { rows: [{ row: { sku: "S" } }, { row: { sku: "S" } }] }],
    },
    (sku) => catalog.has(sku)
  );
  ok(stats.get("A")?.quotes === 2 && stats.get("A")?.lastQuotedAt === 300, "part docs quoted: quotes of any status count once each; lastQuotedAt is the newest");
  ok(stats.get("A")?.grid === 1 && stats.get("G")?.grid === 2 && stats.get("G")?.quotes === 0, "part docs quoted: Grid placements count once per project");
  ok(stats.get("S")?.bidSpecs === 2, "part docs quoted: both bid-spec shapes count, once per spec");
  ok(!stats.has("NOT-IN-CATALOG") && !stats.has("CURT"), "part docs quoted: only catalog parts, never a curtain placement");
  const ranked = rankQuotedParts(stats.values()).map((s) => s.sku);
  ok(ranked.join(",") === "A,B,C,G,S", "part docs quoted: most-quoted first, then Grid/bid-spec use, then SKU");
}

{
  const idx = buildFilenameIndex([
    { sku: "ETC:S4LED-S3-LUSTR", manufacturerModelNumber: "S4LED S3 Lustr" },
    { sku: "ETC:S4LED", manufacturerPartNumber: "7460A1001" },
    { sku: "450" },
    { sku: "DUP-A", manufacturerPartNumber: "SHARED-99" },
    { sku: "DUP-B", manufacturerPartNumber: "SHARED-99" },
  ]);
  ok(MIN_MATCH_KEY === 4 && !idx.keys.has("450"), "part docs filenames: keys under 4 characters are never indexed");
  ok(normalizeFileName("folder/S4LED-S3 Lustr_Datasheet.pdf") === "S4LEDS3LUSTRDATASHEET", "part docs filenames: path, extension and punctuation are dropped");
  const long = matchFileName("S4LED-S3-Lustr_Datasheet.pdf", idx);
  ok(long.confidence === "high" && long.skus.join(",") === "ETC:S4LED-S3-LUSTR", "part docs filenames: the longest match wins over a shorter prefix");
  const pn = matchFileName("7460A1001 spec.pdf", idx);
  ok(pn.confidence === "high" && pn.skus.join(",") === "ETC:S4LED", "part docs filenames: a MFR P/N matches");
  const amb = matchFileName("shared_99.pdf", idx);
  ok(amb.confidence === "ambiguous" && amb.skus.join(",") === "DUP-A,DUP-B", "part docs filenames: one key on two parts is ambiguous");
  ok(matchFileName("brochure.pdf", idx).confidence === "none", "part docs filenames: nothing found is none");
  ok(guessKind("S4LED Guide Spec.pdf") === "specsheet" && guessKind("x-specification.PDF") === "specsheet", "part docs kind: spec/guide/specification → spec sheet");
  ok(guessKind("anything.docx") === "specsheet" && guessKind("anything.DOC") === "specsheet", "part docs kind: Word → spec sheet");
  ok(guessKind("S4LED Datasheet.pdf") === "datasheet", "part docs kind: everything else → datasheet");
}
```


- [ ] **Step 2: Run it to verify it fails**

```bash
env -u DATABASE_URL npm run test:specs 2>&1 | grep -m1 -i 'cannot find module'
```

Expected: `Error: Cannot find module '@/lib/part-docs/coverage'`.


- [ ] **Step 3: Write the coverage rule**

Create `src/lib/part-docs/coverage.ts`:

```ts
import type { DocNotNeeded, PartAccessoryLink, PartDocKind, PartDocument, PartDocumentLink } from "./types";

/**
 * The coverage rule (#DOC, spec §4) — pure, so the to-do page, the part
 * editor, the Assembly Builder, the Specs coverage table and the client
 * package all read one answer. Every pass is a single walk over its input
 * into Maps: production has ~37,400 catalog parts, so nothing here may scan
 * one collection per element of another.
 *
 * For a part P and a kind K:
 *  1. P has its OWN document of kind K with a stored file → "own".
 *  2. Else P is marked not needed for K → "not-needed".
 *  3. Else P is an accessory of parents that have their own K document →
 *     "covered". With a context (the SKUs on one quote), only parents present
 *     in it count; none present → P is not covered on that quote. A pair
 *     marked `ownDatasheet` never covers (for either kind — D-DOC-2).
 *  4. Else P has only a URL nobody has fetched → "link-only" (not satisfied).
 *  5. Else → "missing".
 */

export type CoveragePartInput = {
  sku: string;
  docNotNeeded?: DocNotNeeded;
  /** DaVinci manufacturer links (#162). */
  docs?: Array<{ kind: string; url: string }>;
  /** Imported Datasheet URL / Guide Spec URL columns. */
  productMetadata?: { datasheets?: Array<{ kind: string; sourceUrl?: string }> };
};

type ByKind<T> = { datasheet: T[]; specsheet: T[] };

export type CoverageIndex = {
  docsById: Map<string, PartDocument>;
  /** Live documents linked to each part, split by kind. */
  docsBySku: Map<string, ByKind<PartDocument>>;
  /** Accessory SKU → its parents, one entry per parent (pairs collapsed). */
  parentsOf: Map<string, Array<{ parentSku: string; ownDatasheet: boolean }>>;
  /** Parent SKU → its accessory SKUs. */
  childrenOf: Map<string, string[]>;
  notNeeded: Map<string, DocNotNeeded>;
  /** URLs the catalog row itself carries, not yet on any linked document. */
  catalogUrls: Map<string, ByKind<string>>;
};

export type DocRef = { id: string; title: string; fileName: string; hasFile: boolean; sourceUrl: string | null };

export type SlotCoverage =
  | { state: "own"; docs: DocRef[] }
  | { state: "not-needed" }
  | { state: "covered"; parents: string[]; docs: DocRef[] }
  | { state: "link-only"; docs: DocRef[]; urls: string[] }
  | { state: "missing" };

export type SlotState = SlotCoverage["state"];

/** "Covered on N fixture datasheets" lists at most this many before collapsing (§4). */
export const COVERED_COLLAPSE = 5;

const empty = <T,>(): ByKind<T> => ({ datasheet: [], specsheet: [] });

/** Which slot a catalog-held URL feeds. Manuals and "other" feed neither. */
export function urlKindOf(kind: string): PartDocKind | null {
  if (kind === "datasheet" || kind === "cut-sheet") return "datasheet";
  if (kind === "guide-spec") return "specsheet";
  return null;
}

export function toDocRef(d: PartDocument): DocRef {
  return { id: d.id, title: d.title, fileName: d.fileName, hasFile: !!d.blobKey, sourceUrl: d.sourceUrl };
}

export function buildCoverageIndex(input: {
  documents: PartDocument[];
  links: PartDocumentLink[];
  accessoryLinks: PartAccessoryLink[];
  parts: CoveragePartInput[];
}): CoverageIndex {
  const docsById = new Map<string, PartDocument>();
  for (const d of input.documents) docsById.set(d.id, d);

  const docsBySku = new Map<string, ByKind<PartDocument>>();
  const seenLink = new Set<string>();
  for (const l of input.links) {
    const doc = docsById.get(l.documentId);
    if (!doc) continue; // a link to a removed document covers nothing
    const key = `${l.partSku}\u0000${doc.id}`;
    if (seenLink.has(key)) continue;
    seenLink.add(key);
    let slot = docsBySku.get(l.partSku);
    if (!slot) docsBySku.set(l.partSku, (slot = empty()));
    slot[doc.kind].push(doc);
  }

  const pair = new Map<string, { parentSku: string; accessorySku: string; ownDatasheet: boolean }>();
  for (const a of input.accessoryLinks) {
    if (!a.parentSku || !a.accessorySku || a.parentSku === a.accessorySku) continue;
    const key = `${a.parentSku}\u0000${a.accessorySku}`;
    const current = pair.get(key);
    if (current) current.ownDatasheet = current.ownDatasheet || !!a.ownDatasheet;
    else pair.set(key, { parentSku: a.parentSku, accessorySku: a.accessorySku, ownDatasheet: !!a.ownDatasheet });
  }
  const parentsOf = new Map<string, Array<{ parentSku: string; ownDatasheet: boolean }>>();
  const childrenOf = new Map<string, string[]>();
  for (const p of pair.values()) {
    const ps = parentsOf.get(p.accessorySku);
    if (ps) ps.push({ parentSku: p.parentSku, ownDatasheet: p.ownDatasheet });
    else parentsOf.set(p.accessorySku, [{ parentSku: p.parentSku, ownDatasheet: p.ownDatasheet }]);
    const cs = childrenOf.get(p.parentSku);
    if (cs) cs.push(p.accessorySku);
    else childrenOf.set(p.parentSku, [p.accessorySku]);
  }

  const notNeeded = new Map<string, DocNotNeeded>();
  const catalogUrls = new Map<string, ByKind<string>>();
  for (const part of input.parts) {
    if (part.docNotNeeded && (part.docNotNeeded.datasheet || part.docNotNeeded.specsheet)) notNeeded.set(part.sku, part.docNotNeeded);
    const known = new Set<string>();
    const linked = docsBySku.get(part.sku);
    for (const d of [...(linked?.datasheet ?? []), ...(linked?.specsheet ?? [])]) if (d.sourceUrl) known.add(d.sourceUrl);
    let urls: ByKind<string> | null = null;
    const add = (kind: PartDocKind | null, url: string | undefined) => {
      const u = (url || "").trim();
      if (!kind || !/^https?:\/\//i.test(u) || known.has(u)) return;
      known.add(u);
      if (!urls) urls = empty();
      urls[kind].push(u);
    };
    for (const d of part.docs ?? []) add(d.kind === "datasheet" ? "datasheet" : null, d.url);
    for (const d of part.productMetadata?.datasheets ?? []) add(urlKindOf(d.kind), d.sourceUrl);
    if (urls) catalogUrls.set(part.sku, urls);
  }

  return { docsById, docsBySku, parentsOf, childrenOf, notNeeded, catalogUrls };
}

/** Every live document of kind K linked to this part, file or not. */
export function linkedDocuments(index: CoverageIndex, sku: string, kind: PartDocKind): PartDocument[] {
  return index.docsBySku.get(sku)?.[kind] ?? [];
}

/** The part's own documents of kind K that hold a stored file. */
export function ownFiles(index: CoverageIndex, sku: string, kind: PartDocKind): PartDocument[] {
  return linkedDocuments(index, sku, kind).filter((d) => !!d.blobKey);
}

/** The SKUs whose documents cover `sku` for kind K — before any context filter. */
export function coveringParents(index: CoverageIndex, sku: string, kind: PartDocKind): string[] {
  const out: string[] = [];
  for (const p of index.parentsOf.get(sku) ?? []) {
    if (p.ownDatasheet) continue;
    if (ownFiles(index, p.parentSku, kind).length) out.push(p.parentSku);
  }
  return out;
}

export function slotCoverage(
  index: CoverageIndex,
  sku: string,
  kind: PartDocKind,
  context?: ReadonlySet<string> | null
): SlotCoverage {
  const own = ownFiles(index, sku, kind);
  if (own.length) return { state: "own", docs: own.map(toDocRef) };

  if (index.notNeeded.get(sku)?.[kind]) return { state: "not-needed" };

  let parents = coveringParents(index, sku, kind);
  if (context) parents = parents.filter((p) => context.has(p));
  if (parents.length) {
    const docs = new Map<string, DocRef>();
    for (const p of parents) for (const d of ownFiles(index, p, kind)) if (!docs.has(d.id)) docs.set(d.id, toDocRef(d));
    return { state: "covered", parents, docs: [...docs.values()] };
  }

  const linkOnly = linkedDocuments(index, sku, kind).filter((d) => !d.blobKey && !!d.sourceUrl);
  const urls = index.catalogUrls.get(sku)?.[kind] ?? [];
  if (linkOnly.length || urls.length) return { state: "link-only", docs: linkOnly.map(toDocRef), urls: [...urls] };

  return { state: "missing" };
}

/** own, not-needed and covered satisfy the slot; link-only and missing do not. */
export function slotSatisfied(s: SlotCoverage): boolean {
  return s.state === "own" || s.state === "not-needed" || s.state === "covered";
}

/** The SKUs among `skus` whose datasheet slot is satisfied with no context —
 *  the Specs coverage table's "datasheet" column (§7). */
export function datasheetSatisfiedSkus(index: CoverageIndex, skus: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const sku of skus) if (slotSatisfied(slotCoverage(index, sku, "datasheet"))) out.add(sku);
  return out;
}

/** Show the first `max`, count the rest (§4 — collapse the list above 5). */
export function collapseList<T>(items: readonly T[], max = COVERED_COLLAPSE): { shown: T[]; more: number } {
  return { shown: items.slice(0, max), more: Math.max(0, items.length - max) };
}

/** "Covered on 1 fixture datasheet" / "Covered on 3 fixture spec sheets". */
export function coveredLabel(n: number, kind: PartDocKind): string {
  const noun = kind === "datasheet" ? "datasheet" : "spec sheet";
  return `Covered on ${n} fixture ${noun}${n === 1 ? "" : "s"}`;
}
```


- [ ] **Step 4: Write the quoted-parts counter**

Create `src/lib/part-docs/quoted-parts.ts`:

```ts
/**
 * Which parts Peak actually quotes (#DOC, spec §2.1) — the to-do list's
 * scope. Every SKU on any quote (any status), any Grid design placement, any
 * saved bid spec; no time window. Pure and single-pass: one walk per source,
 * one Map keyed by SKU.
 */

export type QuotedPartStat = {
  sku: string;
  /** Distinct quotes carrying the SKU — the ranking key (§2.1). */
  quotes: number;
  /** Newest `updatedAt` (else `createdAt`) among those quotes. */
  lastQuotedAt: number | null;
  /** Distinct Grid projects placing it. */
  grid: number;
  /** Distinct generated bid specs listing it. */
  bidSpecs: number;
};

type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag | null => (v && typeof v === "object" ? (v as Bag) : null);
const skuOf = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * The distinct equipment SKUs on one saved quote spec: the estimator's nested
 * `sections[].items[]` or the Grid's flat `lines[]`. Labor is not a part that
 * takes a datasheet — a `kind: "labor"` section and a `labor: true` line are
 * skipped, the same rule the quote client package's BOM applies.
 */
export function quoteLineSkus(spec: unknown): string[] {
  const out = new Set<string>();
  const s = bag(spec);
  if (!s) return [];
  if (Array.isArray(s.sections)) {
    for (const rawSection of s.sections) {
      const sec = bag(rawSection);
      if (!sec || sec.kind === "labor" || !Array.isArray(sec.items)) continue;
      for (const rawItem of sec.items) {
        const item = bag(rawItem);
        if (!item || item.labor === true) continue;
        const sku = skuOf(item.sku);
        if (sku) out.add(sku);
      }
    }
  }
  if (Array.isArray(s.lines)) {
    for (const rawLine of s.lines) {
      const line = bag(rawLine);
      const sku = line ? skuOf(line.sku) : "";
      if (sku) out.add(sku);
    }
  }
  return [...out];
}

export function quotedPartStats(
  sources: { quotes: unknown[]; gridProjects: unknown[]; generated: unknown[] },
  isPart: (sku: string) => boolean
): Map<string, QuotedPartStat> {
  const stats = new Map<string, QuotedPartStat>();
  const statFor = (sku: string): QuotedPartStat | null => {
    if (!isPart(sku)) return null;
    let s = stats.get(sku);
    if (!s) stats.set(sku, (s = { sku, quotes: 0, lastQuotedAt: null, grid: 0, bidSpecs: 0 }));
    return s;
  };

  for (const raw of sources.quotes || []) {
    const q = bag(raw);
    if (!q) continue;
    const at = Number(q.updatedAt ?? q.createdAt ?? 0);
    for (const sku of quoteLineSkus(q.spec)) {
      const s = statFor(sku);
      if (!s) continue;
      s.quotes++;
      if (Number.isFinite(at) && at > 0 && (s.lastQuotedAt == null || at > s.lastQuotedAt)) s.lastQuotedAt = at;
    }
  }

  for (const raw of sources.gridProjects || []) {
    const p = bag(raw);
    if (!p || !Array.isArray(p.placements)) continue;
    const seen = new Set<string>();
    for (const rawPl of p.placements) {
      const pl = bag(rawPl);
      if (!pl || pl.curtain) continue; // a made-to-size curtain is not a catalog product
      const sku = skuOf(pl.partId);
      if (sku) seen.add(sku);
    }
    for (const sku of seen) {
      const s = statFor(sku);
      if (s) s.grid++;
    }
  }

  for (const raw of sources.generated || []) {
    const g = bag(raw);
    if (!g) continue;
    const seen = new Set<string>();
    if (Array.isArray(g.bom)) for (const row of g.bom) { const sku = skuOf(bag(row)?.sku); if (sku) seen.add(sku); }
    if (Array.isArray(g.rows)) for (const row of g.rows) { const sku = skuOf(bag(bag(row)?.row)?.sku); if (sku) seen.add(sku); }
    for (const sku of seen) {
      const s = statFor(sku);
      if (s) s.bidSpecs++;
    }
  }

  return stats;
}

/** Most-quoted first; then Grid + bid-spec use; then newest; then SKU. */
export function rankQuotedParts(stats: Iterable<QuotedPartStat>): QuotedPartStat[] {
  return [...stats].sort(
    (a, b) =>
      b.quotes - a.quotes ||
      b.grid + b.bidSpecs - (a.grid + a.bidSpecs) ||
      (b.lastQuotedAt ?? 0) - (a.lastQuotedAt ?? 0) ||
      a.sku.localeCompare(b.sku)
  );
}
```


- [ ] **Step 5: Write the filename matcher and kind guesser**

Create `src/lib/part-docs/filename-match.ts`:

```ts
import { normalizeSku } from "@/lib/davinci/sku";
import type { PartDocKind } from "./types";

/**
 * Bulk-drop filename matching (#DOC, spec §3 "Bulk drop"). Pure.
 *
 * Every part contributes up to three keys — its SKU, MFR P/N and MFR M/N —
 * each through `normalizeSku` (drop a leading `MFR:` segment, uppercase,
 * keep only A-Z0-9), the one identifier normalizer the DaVinci matcher also
 * uses. A filename is normalized the same way and every substring is looked
 * up, longest first: the longest length with any hit wins, so
 * `S4LED-S3-Lustr_Datasheet.pdf` matches `S4LEDS3LUSTR` over `S4LED`.
 * Keys shorter than MIN_MATCH_KEY never match (D-DOC-4) — a 3-character
 * model number appears by accident inside too many filenames.
 */

export const MIN_MATCH_KEY = 4;

export type FilenameIndex = { keys: Map<string, Set<string>>; maxLen: number };

export type MatchablePart = { sku: string; manufacturerPartNumber?: string; manufacturerModelNumber?: string };

export type FilenameMatch = {
  /** The winning normalized key(s), longest length. */
  keys: string[];
  skus: string[];
  confidence: "high" | "ambiguous" | "none";
};

export function buildFilenameIndex(parts: readonly MatchablePart[]): FilenameIndex {
  const keys = new Map<string, Set<string>>();
  let maxLen = 0;
  for (const p of parts) {
    for (const raw of [p.sku, p.manufacturerPartNumber, p.manufacturerModelNumber]) {
      const k = normalizeSku(raw || "");
      if (k.length < MIN_MATCH_KEY) continue;
      let set = keys.get(k);
      if (!set) keys.set(k, (set = new Set()));
      set.add(p.sku);
      if (k.length > maxLen) maxLen = k.length;
    }
  }
  return { keys, maxLen };
}

/** The filename without its extension, uppercased, letters and digits only. */
export function normalizeFileName(fileName: string): string {
  const base = String(fileName ?? "").split(/[\\/]/).pop() || "";
  return base.replace(/\.[A-Za-z0-9]{1,5}$/, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function matchFileName(fileName: string, index: FilenameIndex): FilenameMatch {
  const n = normalizeFileName(fileName);
  for (let len = Math.min(index.maxLen, n.length); len >= MIN_MATCH_KEY; len--) {
    const hitKeys = new Set<string>();
    const skus = new Set<string>();
    for (let i = 0; i + len <= n.length; i++) {
      const k = n.slice(i, i + len);
      const set = index.keys.get(k);
      if (!set) continue;
      hitKeys.add(k);
      for (const s of set) skus.add(s);
    }
    if (skus.size) {
      const list = [...skus].sort();
      return { keys: [...hitKeys].sort(), skus: list, confidence: list.length === 1 ? "high" : "ambiguous" };
    }
  }
  return { keys: [], skus: [], confidence: "none" };
}

/** Spec sheet when the name says spec/guide/specification or the file is
 *  Word; otherwise Datasheet (spec §3). */
export function guessKind(fileName: string): PartDocKind {
  const name = String(fileName ?? "").toLowerCase();
  if (/\.docx?$/.test(name)) return "specsheet";
  const base = name.replace(/\.[a-z0-9]{1,5}$/, "");
  return /spec|guide/.test(base) ? "specsheet" : "datasheet";
}
```


- [ ] **Step 6: Run the gates**

```bash
npx tsc --noEmit -p .
```

Expected: no output, exit 0.

```bash
env -u DATABASE_URL npm run test:specs > "${TMPDIR:-/tmp}/pd-specs.log" 2>&1; tail -1 "${TMPDIR:-/tmp}/pd-specs.log"; grep '^FAIL' "${TMPDIR:-/tmp}/pd-specs.log"
```

Expected: `ALL PASSED` and no `FAIL` lines. (One pre-existing flake exists — `redeem: tampered code -> not ok`, a random-code test that fails about one run in sixty; if it is the only FAIL, re-run.)

Expected additionally: `grep -c '^PASS part docs' "${TMPDIR:-/tmp}/pd-specs.log"` prints `46` (6 from Task 1 + 40 here).

```bash
npx eslint 2>&1 | grep problems
```

Expected: `✖ N problems (0 errors, N warnings)` with N ≤ 111 (the baseline is 111; Task 8 removes one).


- [ ] **Step 7: Commit**

```bash
git add src/lib/part-docs/coverage.ts src/lib/part-docs/quoted-parts.ts src/lib/part-docs/filename-match.ts scripts/test-review-and-spec.ts
git commit -m "feat(part-docs): pure coverage rule, quoted-parts counter, filename matcher and kind guesser" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 3: Stores, legacy backfill, not-needed marks and the one-load loader

**Files:**
- Create: `src/lib/stores/part-documents.ts`
- Create: `src/lib/stores/part-accessory-links.ts`
- Create: `src/lib/part-docs/legacy.ts`
- Create: `src/lib/part-docs/not-needed.ts`
- Create: `src/lib/part-docs/load.ts`
- Create: `scripts/part-docs-backfill.ts` + `package.json` script `part-docs:backfill`
- Test: `scripts/test-review-regressions.ts` (a DB-backed block before the final `console.log`)

**Interfaces:**
- Consumes: Task 1 types and collections; Task 2 `buildCoverageIndex`, `slotCoverage`, `CoverageIndex`, `CoveragePartInput`; `get`/`mergeUpsert` from `src/lib/stores/catalog.ts`.
- Produces (`src/lib/stores/part-documents.ts`, server):
  ```ts
  export function documentLinkId(partSku: string, documentId: string): string;          // "PDL-" + 20 hex, deterministic
  export function titleFromFileName(fileName: string): string;
  export async function allDocuments(): Promise<PartDocument[]>;
  export async function getDocument(id: string): Promise<PartDocument | null>;          // null for a non-id
  export async function allDocumentLinks(): Promise<PartDocumentLink[]>;                // live only
  export type NewPartDocument = { id?; kind; title?; fileName; contentType; size; blobKey: string | null; sourceUrl: string | null;
    source: PartDocumentSource; sourceRef?; language?; by: string; at?: number };
  export async function createDocument(input: NewPartDocument): Promise<PartDocument | null>;   // null when the id exists
  export type StoredFile = { blobKey: string; fileName: string; contentType: string; size: number };
  export async function replaceDocumentFile(id: string, file: StoredFile, by: string, at?: number): Promise<PartDocument | null>;
  export async function recordFetchResult(id: string, result: { ok: boolean; error?: string }, at?: number): Promise<void>;
  export async function attachDocument(documentId: string, skus: readonly string[], by: string, at?: number): Promise<number>;  // new links
  export async function ensureLinks(pairs: ReadonlyArray<{ partSku; documentId; kind }>, by: string, at?: number): Promise<number>;
  export async function detachDocument(documentId: string, partSku: string): Promise<boolean>;
  ```
- Produces (`src/lib/stores/part-accessory-links.ts`, server): `accessoryLinkId(source, scopeRef, parentSku, accessorySku): string` ("PAL-" + 20 hex), `allAccessoryLinks()`, `syncAccessoryLinks(scope: { source: AccessoryLinkSource; sourceRef?: string }, pairs: readonly AccessoryPair[]): Promise<{ written: number; removed: number }>`, `setOwnDatasheet(parentSku, accessorySku, own: boolean): Promise<number>`. (Task 9 adds `syncAccessoryScopes`.)
- Produces (`src/lib/part-docs/legacy.ts`): `type LegacyPart = { sku; datasheetBlobKey?; datasheetName?; updatedAt? }`, `legacyDocumentId(sku): string` ("PD-L" + 15 hex), `backfillLegacyDatasheets(parts, opts?: { by?: string; knownIds?: ReadonlySet<string> }): Promise<{ created: number }>`.
- Produces (`src/lib/part-docs/not-needed.ts`): `setDocNotNeeded(skus: readonly string[], kind: PartDocKind, on: boolean): Promise<number>`.
- Produces (`src/lib/part-docs/load.ts`): `type PartDocsState = { documents; links; accessoryLinks; index: CoverageIndex }`, `loadPartDocsState(parts: ReadonlyArray<CoveragePartInput & LegacyPart>): Promise<PartDocsState>` — the ONE load per request every later consumer calls with the catalog it already listed.

- [ ] **Step 1: Write the failing DB-backed test**

`scripts/test-review-regressions.ts` runs on a fresh `mktemp -d` datadir (the npm script supplies it). Insert this block immediately before its final `console.log("review regression checks passed");`:

In `scripts/test-review-regressions.ts`, insert the following immediately before the line `console.log("review regression checks passed");`:

```ts
  /* --- part documents (#DOC): stores, links, accessory graph, legacy backfill --- */
  {
    const Docs = await import("@/lib/stores/part-documents");
    const Acc = await import("@/lib/stores/part-accessory-links");
    const { backfillLegacyDatasheets, legacyDocumentId } = await import("@/lib/part-docs/legacy");
    const { loadPartDocsState } = await import("@/lib/part-docs/load");
    const { slotCoverage } = await import("@/lib/part-docs/coverage");
    const { setDocNotNeeded } = await import("@/lib/part-docs/not-needed");
    const { upsert: upsertPart, get: getPart } = await import("@/lib/stores/catalog");
    const { listDocs } = await import("@/db/doc-store");

    const d = await Docs.createDocument({
      kind: "datasheet", fileName: "S4_LED_Datasheet.pdf", contentType: "application/pdf", size: 10,
      blobKey: "part-docs/PD-x/S4_LED_Datasheet.pdf", sourceUrl: null, source: "upload", by: "Jeff",
    });
    assert(d && /^PD-[0-9a-f]{12}$/.test(d.id), "part docs store: createDocument mints a PD- id");
    assert.equal(d!.title, "S4 LED Datasheet", "part docs store: the title defaults from the file name");
    assert.equal(await Docs.createDocument({ id: d!.id, kind: "datasheet", fileName: "x.pdf", contentType: "application/pdf", size: 1, blobKey: null, sourceUrl: null, source: "upload", by: "Jeff" }), null, "part docs store: an existing id is never overwritten");

    assert.equal(await Docs.attachDocument(d!.id, ["DOC-FIX", "DOC-FIX", "DOC-LENS2"], "Jeff"), 2, "part docs store: attach links each part once");
    assert.equal(await Docs.attachDocument(d!.id, ["DOC-FIX"], "Jeff"), 0, "part docs store: attaching again is a no-op");
    assert.equal((await Docs.allDocumentLinks()).filter((l) => l.documentId === d!.id).length, 2, "part docs store: one link row per part↔document");
    assert.equal(await Docs.detachDocument(d!.id, "DOC-LENS2"), true, "part docs store: detach removes a live link");
    assert.equal(await Docs.detachDocument(d!.id, "DOC-LENS2"), false, "part docs store: detaching twice reports nothing removed");
    assert.equal((await Docs.allDocumentLinks()).filter((l) => l.documentId === d!.id).length, 1, "part docs store: a detached link leaves the live list");
    assert.equal(await Docs.attachDocument(d!.id, ["DOC-LENS2"], "Jeff"), 1, "part docs store: re-attaching revives the same row");
    assert.equal(await Docs.ensureLinks([{ partSku: "DOC-OTHER", documentId: d!.id, kind: "datasheet" }], "Jeff"), 1, "part docs store: ensureLinks adds a new pair");
    await Docs.detachDocument(d!.id, "DOC-OTHER");
    assert.equal(await Docs.ensureLinks([{ partSku: "DOC-OTHER", documentId: d!.id, kind: "datasheet" }], "Jeff"), 0, "part docs store: ensureLinks never re-attaches a pair a human detached");

    const replaced = await Docs.replaceDocumentFile(d!.id, { blobKey: "part-docs/PD-x/v2.pdf", fileName: "v2.pdf", contentType: "application/pdf", size: 20 }, "Chris", 5000);
    assert.equal(replaced?.blobKey, "part-docs/PD-x/v2.pdf", "part docs store: replace points at the new file");
    assert.deepEqual(replaced?.history, [{ blobKey: "part-docs/PD-x/S4_LED_Datasheet.pdf", fileName: "S4_LED_Datasheet.pdf", size: 10, replacedAt: 5000, replacedBy: "Chris" }], "part docs store: the replaced file is kept in history");
    await Docs.recordFetchResult(d!.id, { ok: false, error: "HTTP 404" }, 6000);
    assert.deepEqual((await Docs.getDocument(d!.id))?.lastFetch, { at: 6000, ok: false, error: "HTTP 404" }, "part docs store: a fetch failure is remembered with its reason");
    assert.equal(await Docs.getDocument("../etc"), null, "part docs store: a non-id never reaches the table");

    // accessory graph
    const r1 = await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "fa-doc-1" }, [
      { parentSku: "DOC-FIX", accessorySku: "DOC-LENS" },
      { parentSku: "DOC-FIX", accessorySku: "DOC-CLAMP", included: true },
      { parentSku: "DOC-FIX", accessorySku: "DOC-FIX" },
    ]);
    assert.deepEqual(r1, { written: 2, removed: 0 }, "part docs graph: sync writes each pair once and drops a self-link");
    assert.deepEqual(await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "fa-doc-1" }, [
      { parentSku: "DOC-FIX", accessorySku: "DOC-LENS" },
      { parentSku: "DOC-FIX", accessorySku: "DOC-CLAMP", included: true },
    ]), { written: 0, removed: 0 }, "part docs graph: an unchanged re-sync writes nothing");
    assert.equal(await Acc.setOwnDatasheet("DOC-FIX", "DOC-CLAMP", true), 1, "part docs graph: the own-datasheet toggle flags the pair");
    const r2 = await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "fa-doc-1" }, [{ parentSku: "DOC-FIX", accessorySku: "DOC-CLAMP", included: true }]);
    assert.deepEqual(r2, { written: 0, removed: 1 }, "part docs graph: a pair the assembly dropped is removed");
    assert.equal((await Acc.allAccessoryLinks()).find((l) => l.accessorySku === "DOC-CLAMP")?.ownDatasheet, true, "part docs graph: re-saving keeps the own-datasheet flag");
    await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "fa-doc-2" }, [{ parentSku: "DOC-FIX", accessorySku: "DOC-LENS" }]);
    assert.equal((await Acc.allAccessoryLinks()).filter((l) => l.sourceRef === "fa-doc-1").length, 1, "part docs graph: another assembly's sync never touches this one's links");

    // coverage over the stored graph, via the one-load loader
    await upsertPart({ sku: "DOC-FIX", desc: "Fixture", category: "Lighting", unit: "ea", list: 1, cost: 1 });
    await upsertPart({ sku: "DOC-LENS", desc: "Lens", category: "Lighting", unit: "ea", list: 1, cost: 1 });
    const parts = [(await getPart("DOC-FIX"))!, (await getPart("DOC-LENS"))!];
    const state = await loadPartDocsState(parts);
    assert.equal(slotCoverage(state.index, "DOC-LENS", "datasheet").state, "covered", "part docs graph: an assembly member is covered by the fixture's datasheet");

    // not-needed marks ride on the catalog part through mergeUpsert
    assert.equal(await setDocNotNeeded(["DOC-LENS", "NO-SUCH-PART"], "specsheet", true), 1, "part docs not-needed: marks live parts only");
    const lens = await getPart("DOC-LENS");
    assert.deepEqual(lens?.docNotNeeded, { specsheet: true }, "part docs not-needed: the mark is on the part");
    assert.equal(lens?.desc, "Lens", "part docs not-needed: mergeUpsert leaves the rest of the part alone");
    assert.equal(await getPart("NO-SUCH-PART"), null, "part docs not-needed: never creates a part");
    await setDocNotNeeded(["DOC-LENS"], "specsheet", false);
    assert.equal((await getPart("DOC-LENS"))?.docNotNeeded, undefined, "part docs not-needed: clearing the last mark removes the field");

    // legacy backfill
    await upsertPart({ sku: "DOC-LEGACY", desc: "Legacy", category: "Lighting", unit: "ea", list: 1, cost: 1, datasheetBlobKey: "part-datasheets/DOC-LEGACY/old.pdf", datasheetName: "old.pdf" });
    const legacy = (await getPart("DOC-LEGACY"))!;
    assert.deepEqual(await backfillLegacyDatasheets([legacy]), { created: 1 }, "part docs legacy: a datasheetBlobKey becomes a shared document");
    const ldoc = await Docs.getDocument(legacyDocumentId("DOC-LEGACY"));
    assert(ldoc?.source === "legacy" && ldoc.blobKey === "part-datasheets/DOC-LEGACY/old.pdf" && ldoc.fileName === "old.pdf", "part docs legacy: the document keeps the old blob and name");
    assert.equal((await Docs.allDocumentLinks()).filter((l) => l.partSku === "DOC-LEGACY").length, 1, "part docs legacy: and is linked to its part");
    assert.deepEqual(await backfillLegacyDatasheets([legacy]), { created: 0 }, "part docs legacy: a second run writes nothing");
    await Docs.detachDocument(legacyDocumentId("DOC-LEGACY"), "DOC-LEGACY");
    await backfillLegacyDatasheets([legacy]);
    assert.equal((await Docs.allDocumentLinks()).filter((l) => l.partSku === "DOC-LEGACY").length, 0, "part docs legacy: a detached legacy document stays detached");
    assert.equal((await getPart("DOC-LEGACY"))?.datasheetBlobKey, "part-datasheets/DOC-LEGACY/old.pdf", "part docs legacy: datasheetBlobKey stays readable");
    assert((await listDocs("part_documents")).some((x) => x.id === legacyDocumentId("DOC-LEGACY")), "part docs legacy: the document itself is never deleted");
  }

```


- [ ] **Step 2: Run it to verify it fails**

```bash
env -u DATABASE_URL npm run test:review:regressions 2>&1 | grep -m1 ERR_MODULE_NOT_FOUND
```

Expected: `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/lib' imported from …/scripts/test-review-regressions.ts` — the block's dynamic `import("@/lib/stores/part-documents")` has nothing to resolve yet.


- [ ] **Step 3: Write the documents store**

Create `src/lib/stores/part-documents.ts`:

```ts
import { createHash } from "node:crypto";
import { getDoc, insertDocIfAbsent, listDocs, patchDoc, softDeleteDoc, upsertDoc } from "@/db/doc-store";
import {
  isDocumentId,
  newDocumentId,
  type PartDocKind,
  type PartDocument,
  type PartDocumentLink,
  type PartDocumentSource,
} from "@/lib/part-docs/types";

/**
 * Part documents (#DOC, spec §5) — `part_documents` + `part_document_links`.
 *
 * A document is shared: one row, linked to any number of parts. Nothing is
 * ever hard-deleted — a replace pushes the old file onto `history`, a detach
 * soft-deletes the link row. Link ids are deterministic per (part, document)
 * so attaching twice is a no-op and re-attaching revives the same row.
 */

const hash = (s: string, n: number) => createHash("sha1").update(s).digest("hex").slice(0, n);

/** One row per part↔document (spec §5). */
export function documentLinkId(partSku: string, documentId: string): string {
  return `PDL-${hash(`${partSku}\u0000${documentId}`, 20)}`;
}

/** "ETC_S4LED_Datasheet.pdf" → "ETC S4LED Datasheet". */
export function titleFromFileName(fileName: string): string {
  const base = String(fileName ?? "").split(/[\\/]/).pop() || "";
  return base.replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() || "Document";
}

export async function allDocuments(): Promise<PartDocument[]> {
  return listDocs<PartDocument>("part_documents");
}

export async function getDocument(id: string): Promise<PartDocument | null> {
  if (!isDocumentId(id)) return null;
  return getDoc<PartDocument>("part_documents", id);
}

/** Live links only (detached rows are soft-deleted). */
export async function allDocumentLinks(): Promise<PartDocumentLink[]> {
  return listDocs<PartDocumentLink>("part_document_links");
}

export type NewPartDocument = {
  id?: string;
  kind: PartDocKind;
  title?: string;
  fileName: string;
  contentType: string;
  size: number;
  blobKey: string | null;
  sourceUrl: string | null;
  source: PartDocumentSource;
  sourceRef?: string;
  language?: string;
  by: string;
  at?: number;
};

/** Insert a new document. Returns null when the id is already taken — never
 *  overwrites (a fetched or replaced document must survive a re-run). */
export async function createDocument(input: NewPartDocument): Promise<PartDocument | null> {
  const id = input.id ?? newDocumentId();
  if (!isDocumentId(id)) throw new Error(`Not a document id: ${id}`);
  const doc: PartDocument = {
    id,
    kind: input.kind,
    title: (input.title || "").trim() || titleFromFileName(input.fileName),
    fileName: input.fileName,
    contentType: input.contentType,
    size: input.size,
    blobKey: input.blobKey,
    sourceUrl: input.sourceUrl,
    source: input.source,
    ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
    ...(input.language ? { language: input.language } : {}),
    uploadedAt: input.at ?? Date.now(),
    uploadedBy: input.by,
    history: [],
  };
  return (await insertDocIfAbsent("part_documents", doc)) ? doc : null;
}

export type StoredFile = { blobKey: string; fileName: string; contentType: string; size: number };

/**
 * Point a document at a new stored file. The file it held (if any) moves to
 * `history` — the blob itself is never deleted (spec §2.4). Also how a
 * link-only document becomes a stored one after a fetch.
 */
export async function replaceDocumentFile(id: string, file: StoredFile, by: string, at = Date.now()): Promise<PartDocument | null> {
  return patchDoc<PartDocument>("part_documents", id, (d) => {
    const history = [...(d.history || [])];
    if (d.blobKey) history.push({ blobKey: d.blobKey, fileName: d.fileName, size: d.size, replacedAt: at, replacedBy: by });
    return {
      ...d,
      blobKey: file.blobKey,
      fileName: file.fileName,
      contentType: file.contentType,
      size: file.size,
      uploadedAt: at,
      uploadedBy: by,
      history,
    };
  });
}

/** Remember how the last fetch of `sourceUrl` went (D-DOC-3). */
export async function recordFetchResult(id: string, result: { ok: boolean; error?: string }, at = Date.now()): Promise<void> {
  await patchDoc<PartDocument>("part_documents", id, (d) => ({
    ...d,
    lastFetch: result.ok ? { at, ok: true } : { at, ok: false, error: result.error || "Fetch failed." },
  }));
}

/**
 * Link a document to parts. Returns how many links are NEW. A link that
 * exists (live) is left alone; one that was detached is revived.
 */
export async function attachDocument(documentId: string, skus: readonly string[], by: string, at = Date.now()): Promise<number> {
  const doc = await getDocument(documentId);
  if (!doc) return 0;
  let added = 0;
  for (const raw of new Set(skus)) {
    const partSku = String(raw || "").trim();
    if (!partSku) continue;
    const id = documentLinkId(partSku, documentId);
    if (await getDoc("part_document_links", id)) continue;
    await upsertDoc<PartDocumentLink>("part_document_links", { id, partSku, documentId, kind: doc.kind, createdAt: at, createdBy: by });
    added++;
  }
  return added;
}

/**
 * Bulk link for writers that already hold the whole picture (DaVinci
 * pre-fill, legacy backfill). Skips any pair that has EVER been linked —
 * a detached link stays detached, so a re-run never undoes a human's
 * detach. One read of the link table, one insert per new pair.
 */
export async function ensureLinks(
  pairs: ReadonlyArray<{ partSku: string; documentId: string; kind: PartDocKind }>,
  by: string,
  at = Date.now()
): Promise<number> {
  const ever = new Set((await listDocs("part_document_links", { includeDeleted: true })).map((l) => l.id));
  let added = 0;
  for (const p of pairs) {
    const id = documentLinkId(p.partSku, p.documentId);
    if (ever.has(id)) continue;
    ever.add(id);
    if (await insertDocIfAbsent<PartDocumentLink>("part_document_links", { id, partSku: p.partSku, documentId: p.documentId, kind: p.kind, createdAt: at, createdBy: by })) added++;
  }
  return added;
}

/** Detach (soft delete). True when a live link was removed. */
export async function detachDocument(documentId: string, partSku: string): Promise<boolean> {
  const id = documentLinkId(partSku, documentId);
  if (!(await getDoc("part_document_links", id))) return false;
  await softDeleteDoc("part_document_links", id);
  return true;
}
```


- [ ] **Step 4: Write the accessory-graph store**

Create `src/lib/stores/part-accessory-links.ts`:

```ts
import { createHash } from "node:crypto";
import { listDocs, patchDoc, softDeleteDoc, upsertDoc } from "@/db/doc-store";
import type { AccessoryLinkSource, AccessoryPair, PartAccessoryLink } from "@/lib/part-docs/types";

/**
 * The fixture → accessory graph (#DOC, spec §5) — `part_accessory_links`.
 * Written by the Assembly Builder (source "assembly", sourceRef = the
 * assembly id) and the DaVinci pre-fill (source "davinci"); coverage is
 * computed from it (src/lib/part-docs/coverage.ts), never stored.
 */

/** Deterministic per (source, scope, parent, accessory): a re-sync rewrites
 *  the same row instead of piling up duplicates. */
export function accessoryLinkId(source: AccessoryLinkSource, scopeRef: string, parentSku: string, accessorySku: string): string {
  return `PAL-${createHash("sha1").update([source, scopeRef, parentSku, accessorySku].join("\u0000")).digest("hex").slice(0, 20)}`;
}

/** Field-wise, because jsonb does not keep key order. */
function sameLink(a: PartAccessoryLink, b: PartAccessoryLink): boolean {
  return (
    a.parentSku === b.parentSku &&
    a.accessorySku === b.accessorySku &&
    (a.maxQty ?? null) === (b.maxQty ?? null) &&
    !!a.included === !!b.included &&
    !!a.ownDatasheet === !!b.ownDatasheet &&
    a.source === b.source &&
    (a.sourceRef ?? null) === (b.sourceRef ?? null)
  );
}

export async function allAccessoryLinks(): Promise<PartAccessoryLink[]> {
  return listDocs<PartAccessoryLink>("part_accessory_links");
}

/**
 * Make the links of one scope exactly `pairs`: a scope is every live link of
 * `source` (DaVinci) or of `source` + `sourceRef` (one assembly). Missing
 * pairs are written, stale ones soft-deleted, unchanged ones untouched. The
 * human's "has its own datasheet" flag is carried over from ANY live link of
 * the same parent/accessory pair, so re-saving an assembly never clears it.
 */
export async function syncAccessoryLinks(
  scope: { source: AccessoryLinkSource; sourceRef?: string },
  pairs: readonly AccessoryPair[]
): Promise<{ written: number; removed: number }> {
  return syncScopes(
    scope.source,
    (l) => scope.sourceRef === undefined || l.sourceRef === scope.sourceRef,
    [{ sourceRef: scope.sourceRef, pairs }]
  );
}

async function syncScopes(
  source: AccessoryLinkSource,
  owns: (l: PartAccessoryLink) => boolean,
  scopes: ReadonlyArray<{ sourceRef?: string; pairs: readonly AccessoryPair[] }>
): Promise<{ written: number; removed: number }> {
  const all = await allAccessoryLinks();
  const own = new Map(all.filter((l) => l.source === source && owns(l)).map((l) => [l.id, l]));
  const ownFlag = new Set(all.filter((l) => l.ownDatasheet).map((l) => `${l.parentSku}\u0000${l.accessorySku}`));

  const desired = new Map<string, PartAccessoryLink>();
  for (const scope of scopes) {
    for (const p of scope.pairs) {
      const parentSku = p.parentSku.trim();
      const accessorySku = p.accessorySku.trim();
      if (!parentSku || !accessorySku || parentSku === accessorySku) continue;
      const id = accessoryLinkId(source, scope.sourceRef ?? "", parentSku, accessorySku);
      const prior = desired.get(id);
      const maxQty = Math.max(prior?.maxQty ?? 0, p.maxQty ?? 0) || undefined;
      const sourceRef = scope.sourceRef ?? prior?.sourceRef ?? p.sourceRef;
      desired.set(id, {
        id,
        parentSku,
        accessorySku,
        ...(maxQty ? { maxQty } : {}),
        ...(p.included || prior?.included ? { included: true } : {}),
        ...(ownFlag.has(`${parentSku}\u0000${accessorySku}`) ? { ownDatasheet: true } : {}),
        source,
        ...(sourceRef ? { sourceRef } : {}),
      });
    }
  }

  let written = 0;
  for (const [id, link] of desired) {
    const current = own.get(id);
    if (current && sameLink(current, link)) continue;
    await upsertDoc<PartAccessoryLink>("part_accessory_links", link);
    written++;
  }
  let removed = 0;
  for (const id of own.keys()) {
    if (desired.has(id)) continue;
    await softDeleteDoc("part_accessory_links", id);
    removed++;
  }
  return { written, removed };
}

/**
 * The Assembly Builder's "has its own datasheet" toggle: set or clear the
 * flag on every live link of the pair (a pair can be linked by several
 * assemblies and by DaVinci at once — coverage reads them as one). Returns
 * the number of rows changed.
 */
export async function setOwnDatasheet(parentSku: string, accessorySku: string, own: boolean): Promise<number> {
  const rows = (await allAccessoryLinks()).filter((l) => l.parentSku === parentSku && l.accessorySku === accessorySku);
  let changed = 0;
  for (const l of rows) {
    if (!!l.ownDatasheet === own) continue;
    await patchDoc<PartAccessoryLink>("part_accessory_links", l.id, (d) => {
      const next = { ...d };
      if (own) next.ownDatasheet = true;
      else delete next.ownDatasheet;
      return next;
    });
    changed++;
  }
  return changed;
}
```


- [ ] **Step 5: Write the legacy backfill**

Create `src/lib/part-docs/legacy.ts`:

```ts
import { createHash } from "node:crypto";
import { listDocs } from "@/db/doc-store";
import { createDocument, ensureLinks } from "@/lib/stores/part-documents";

/**
 * Legacy backfill (#DOC, spec §5): every part that still carries the old
 * single-file `datasheetBlobKey` gets a shared `part_documents` row (source
 * "legacy") and a link. Server-only.
 *
 * Idempotent by construction: the document id is derived from the SKU, and
 * a part is only backfilled when that id has never existed (live or not) —
 * so a second run writes nothing, and a human who later detaches the legacy
 * document is never overruled. `datasheetBlobKey` itself is left in place for
 * the readers that have not switched yet.
 */

export type LegacyPart = { sku: string; datasheetBlobKey?: string; datasheetName?: string; updatedAt?: number };

export function legacyDocumentId(sku: string): string {
  return `PD-L${createHash("sha1").update(sku).digest("hex").slice(0, 15)}`;
}

export async function backfillLegacyDatasheets(
  parts: readonly LegacyPart[],
  opts: { by?: string; knownIds?: ReadonlySet<string> } = {}
): Promise<{ created: number }> {
  const by = opts.by ?? "Legacy datasheet backfill";
  const candidates = parts.filter((p) => !!p.datasheetBlobKey);
  if (!candidates.length) return { created: 0 };
  // Documents are never deleted, so a caller that already listed them can
  // hand their ids over and save this read.
  const known = opts.knownIds ?? new Set((await listDocs("part_documents", { includeDeleted: true })).map((d) => d.id));
  if (candidates.every((p) => known.has(legacyDocumentId(p.sku)))) return { created: 0 };
  const pairs: Array<{ partSku: string; documentId: string; kind: "datasheet" }> = [];
  for (const p of candidates) {
    const id = legacyDocumentId(p.sku);
    if (known.has(id)) continue;
    const fileName = p.datasheetName || `${p.sku}.pdf`;
    const doc = await createDocument({
      id,
      kind: "datasheet",
      fileName,
      contentType: "application/pdf",
      size: 0, // the legacy action never recorded it
      blobKey: p.datasheetBlobKey!,
      sourceUrl: null,
      source: "legacy",
      sourceRef: p.sku,
      by,
      at: p.updatedAt,
    });
    if (doc) pairs.push({ partSku: p.sku, documentId: id, kind: "datasheet" });
  }
  await ensureLinks(pairs, by);
  return { created: pairs.length };
}
```


- [ ] **Step 6: Write the not-needed marks (through mergeUpsert)**

Create `src/lib/part-docs/not-needed.ts`:

```ts
import { get as getPart, mergeUpsert } from "@/lib/stores/catalog";
import type { DocNotNeeded, PartDocKind } from "./types";

/**
 * Set or clear a part's "not needed" mark for one kind (#DOC, spec §4 step 2).
 * Server-only. Goes through `mergeUpsert` — never `upsert`, which would wipe
 * every field this write does not carry — and skips SKUs that are not in the
 * catalog, because mergeUpsert would otherwise create a malformed part.
 * Returns how many parts changed.
 */
export async function setDocNotNeeded(skus: readonly string[], kind: PartDocKind, on: boolean): Promise<number> {
  let changed = 0;
  for (const sku of new Set(skus)) {
    const part = await getPart(sku);
    if (!part) continue;
    const current: DocNotNeeded = part.docNotNeeded ?? {};
    if (!!current[kind] === on) continue;
    const next: DocNotNeeded = { ...current };
    if (on) next[kind] = true;
    else delete next[kind];
    await mergeUpsert(sku, { docNotNeeded: next.datasheet || next.specsheet ? next : undefined });
    changed++;
  }
  return changed;
}
```


- [ ] **Step 7: Write the one-load loader**

Create `src/lib/part-docs/load.ts`:

```ts
import { allAccessoryLinks } from "@/lib/stores/part-accessory-links";
import { allDocumentLinks, allDocuments } from "@/lib/stores/part-documents";
import { buildCoverageIndex, type CoverageIndex, type CoveragePartInput } from "./coverage";
import { backfillLegacyDatasheets, type LegacyPart } from "./legacy";
import type { PartAccessoryLink, PartDocument, PartDocumentLink } from "./types";

/**
 * One load of everything coverage needs (#DOC) — the three collections, once
 * per request, plus the idempotent legacy backfill (which writes only when a
 * part still has an un-backfilled `datasheetBlobKey`). Server-only. Callers
 * pass the catalog they already loaded; this never lists it again.
 */
export type PartDocsState = {
  documents: PartDocument[];
  links: PartDocumentLink[];
  accessoryLinks: PartAccessoryLink[];
  index: CoverageIndex;
};

export async function loadPartDocsState(parts: ReadonlyArray<CoveragePartInput & LegacyPart>): Promise<PartDocsState> {
  const [docs0, links0, accessoryLinks] = await Promise.all([allDocuments(), allDocumentLinks(), allAccessoryLinks()]);
  const { created } = await backfillLegacyDatasheets(parts, { knownIds: new Set(docs0.map((d) => d.id)) });
  const [documents, links] = created ? await Promise.all([allDocuments(), allDocumentLinks()]) : [docs0, links0];
  const index = buildCoverageIndex({ documents, links, accessoryLinks, parts: [...parts] });
  return { documents, links, accessoryLinks, index };
}
```


- [ ] **Step 8: Add the explicit backfill script (spec §5: "on first read … and a script")**

Create `scripts/part-docs-backfill.ts`:

```ts
/**
 * Legacy datasheet backfill (#DOC, spec §5): every part still carrying the
 * old `datasheetBlobKey` gets a shared `part_documents` row (source
 * "legacy") and a link. The Datasheets page runs the same idempotent step on
 * every read; this is the explicit, reportable version.
 *
 *   npm run part-docs:backfill              → report, writes nothing
 *   npm run part-docs:backfill -- --commit  → write (hosted also needs --yes)
 */
import { resolveDbTarget, requireHostedConfirmation } from "./db-target";
import { list as allParts } from "../src/lib/stores/catalog";
import { backfillLegacyDatasheets, legacyDocumentId } from "../src/lib/part-docs/legacy";
import { allDocuments } from "../src/lib/stores/part-documents";

const args = process.argv.slice(2);
const commit = args.includes("--commit");

async function main() {
  const { hosted } = resolveDbTarget(commit ? "part-docs:backfill (WRITE)" : "part-docs:backfill (read-only)");
  if (commit) requireHostedConfirmation(hosted, args);
  const parts = (await allParts()).filter((p) => !!p.datasheetBlobKey);
  const known = new Set((await allDocuments()).map((d) => d.id));
  const pending = parts.filter((p) => !known.has(legacyDocumentId(p.sku)));
  console.log(`\n  parts with a legacy datasheet  ${parts.length}`);
  console.log(`  not yet backfilled             ${pending.length}\n`);
  if (!commit) {
    console.log("  Report only. To write: npm run part-docs:backfill -- --commit\n");
    return;
  }
  const r = await backfillLegacyDatasheets(pending);
  console.log(`  WROTE ${r.created} legacy document(s) + link(s).\n`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
```

In `package.json`, replace this exact text:

```json
    "davinci:enrich": "tsx scripts/davinci-enrich.ts",
    "db:inventory"
```

with:

```json
    "davinci:enrich": "tsx scripts/davinci-enrich.ts",
    "part-docs:backfill": "tsx scripts/part-docs-backfill.ts",
    "db:inventory"
```

```bash
D=$(mktemp -d); env -u DATABASE_URL PGLITE_PATH="$D" npm run part-docs:backfill 2>&1 | tail -5; rm -rf "$D"
```

Expected: `parts with a legacy datasheet  0`, `not yet backfilled             0`, `Report only. To write: npm run part-docs:backfill -- --commit` (a throwaway datadir — never `.data/pglite`).


- [ ] **Step 9: Run the gates**

```bash
npx tsc --noEmit -p .
```

Expected: no output, exit 0.

```bash
env -u DATABASE_URL npm run test:review:regressions 2>&1 | tail -2
```

Expected: `review regression checks passed` then `quote email regression checks passed`.

```bash
env -u DATABASE_URL npm run test:specs > "${TMPDIR:-/tmp}/pd-specs.log" 2>&1; tail -1 "${TMPDIR:-/tmp}/pd-specs.log"; grep '^FAIL' "${TMPDIR:-/tmp}/pd-specs.log"
```

Expected: `ALL PASSED` and no `FAIL` lines. (One pre-existing flake exists — `redeem: tampered code -> not ok`, a random-code test that fails about one run in sixty; if it is the only FAIL, re-run.)

```bash
npx eslint 2>&1 | grep problems
```

Expected: `✖ N problems (0 errors, N warnings)` with N ≤ 111 (the baseline is 111; Task 8 removes one).


- [ ] **Step 10: Commit**

```bash
git add src/lib/stores/part-documents.ts src/lib/stores/part-accessory-links.ts src/lib/part-docs/legacy.ts src/lib/part-docs/not-needed.ts src/lib/part-docs/load.ts scripts/part-docs-backfill.ts package.json scripts/test-review-regressions.ts
git commit -m "feat(part-docs): document/link/accessory stores, legacy backfill, not-needed marks, one-load loader" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 4: Direct-to-Blob upload, magic bytes, the viewer, and attach/replace/detach

**Files:**
- Modify: `src/lib/blob.ts` (add `getBlobHead`)
- Create: `src/lib/part-docs/files.ts` (pure file-type rules; Task 5 appends `fileNameForFetched`)
- Create: `src/lib/part-docs/verify-upload.ts`
- Create: `src/app/api/part-documents/upload/route.ts`
- Create: `src/app/api/part-documents/[id]/route.ts`
- Create: `src/app/(app)/catalog/documents/actions.ts`
- Test: `scripts/test-review-and-spec.ts` (append a `Task 4` block + one line in the async chain)

**Interfaces:**
- Consumes: Task 1 (`isDocumentId`, `blobPathBelongsTo`, `MAX_PART_DOC_BYTES`, `isPartDocKind`), Task 3 (`createDocument`, `attachDocument`, `replaceDocumentFile`, `detachDocument`, `getDocument`, `StoredFile`, `setDocNotNeeded`).
- Produces (`src/lib/blob.ts`): `getBlobHead(pathname: string, max: number): Promise<{ bytes: Uint8Array; size: number } | null>`.
- Produces (`src/lib/part-docs/files.ts`, pure): `type SniffedType = "pdf" | "doc" | "docx"`, `CONTENT_TYPES`, `ALLOWED_TYPES`, `acceptFor(kind): string`, `UPLOAD_CONTENT_TYPES`, `sniffDocumentType(bytes): SniffedType | null`, `SNIFF_BYTES`, `checkDocumentBytes(kind, bytes): { ok: true; type; contentType } | { ok: false; error }`, `contentTypeForFileName(name)`, `withExtension(name, type)`, `contentDisposition(name)`.
- Produces (`verify-upload.ts`, server): `type VerifyDeps`, `displayFileName(raw, type)`, `verifyUploadedBlob(input: { documentId; blobPathname; fileName; kind }, deps?): Promise<{ ok: true; file: StoredFile } | { ok: false; error }>`.
- Produces routes: `POST /api/part-documents/upload` (token only, signed-in, `part-docs/<PD-id>/<file>` only, 25 MB), `GET /api/part-documents/[id]` (signed-in; streams; link-only → 302 to `sourceUrl`; `?history=<n>` streams a replaced file).
- Produces (`src/app/(app)/catalog/documents/actions.ts`, `"use server"`): `type DocActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string }`, `attachUploadedDocumentAction({ documentId, blobPathname, fileName, kind, skus }): Promise<DocActionResult<{ documentId: string; linked: number }>>`, `replaceDocumentFileAction({ documentId, blobPathname, fileName }): Promise<DocActionResult>`, `detachDocumentAction(documentId, sku): Promise<DocActionResult>`, `attachExistingDocumentAction(documentId, skus): Promise<DocActionResult<{ linked: number }>>`, `setNotNeededAction(skus, kind, on): Promise<DocActionResult<{ changed: number }>>`.

- [ ] **Step 1: Write the failing test**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts

/* ======================================================================
   Part documents (#DOC) — Task 4: magic bytes and the upload check.
   verifyUploadedBlob runs against fake Blob deps — no token, no network.
   ====================================================================== */
import {
  sniffDocumentType, checkDocumentBytes, contentDisposition, contentTypeForFileName, acceptFor, CONTENT_TYPES,
} from "@/lib/part-docs/files";
import { verifyUploadedBlob, displayFileName } from "@/lib/part-docs/verify-upload";

const pdDocBytes = (s: string, pad = 0) => new Uint8Array([...new Array(pad).fill(0x20), ...[...s].map((c) => c.charCodeAt(0))]);
const pdDocx = () => {
  const b = new Uint8Array(200);
  b.set([0x50, 0x4b, 0x03, 0x04], 0);
  b.set([..."word/document.xml"].map((c) => c.charCodeAt(0)), 30);
  return b;
};
const pdXlsx = () => {
  const b = new Uint8Array(200);
  b.set([0x50, 0x4b, 0x03, 0x04], 0);
  b.set([..."xl/workbook.xml"].map((c) => c.charCodeAt(0)), 30);
  return b;
};
const pdOle = () => new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);

ok(sniffDocumentType(pdDocBytes("%PDF-1.7\n")) === "pdf", "part docs bytes: %PDF- is a PDF");
ok(sniffDocumentType(pdDocBytes("%PDF-1.4", 500)) === "pdf", "part docs bytes: %PDF- after leading junk (inside 1 KB) is still a PDF");
ok(sniffDocumentType(pdDocBytes("%PDF-1.4", 2000)) === null, "part docs bytes: …but not past the first 1 KB");
ok(sniffDocumentType(pdOle()) === "doc", "part docs bytes: the OLE2 magic is a Word .doc");
ok(sniffDocumentType(pdDocx()) === "docx", "part docs bytes: a ZIP naming word/ is a .docx");
ok(sniffDocumentType(pdXlsx()) === null, "part docs bytes: a ZIP that is not Word is refused");
ok(sniffDocumentType(pdDocBytes("<!DOCTYPE html><html>")) === null, "part docs bytes: an HTML error page is refused");
const pdCheck = checkDocumentBytes("datasheet", pdDocx());
ok(!pdCheck.ok && pdCheck.error === "Datasheets must be PDF files.", "part docs bytes: a datasheet slot refuses Word");
ok(checkDocumentBytes("specsheet", pdDocx()).ok && checkDocumentBytes("specsheet", pdOle()).ok, "part docs bytes: a spec-sheet slot takes Word");
ok(contentTypeForFileName("A.DOCX") === CONTENT_TYPES.docx && contentTypeForFileName("a.pdf") === "application/pdf", "part docs bytes: content type by name for history files");
ok(contentDisposition('Ünïcode "x".pdf') === `inline; filename="_n_code _x_.pdf"; filename*=UTF-8''${encodeURIComponent('Ünïcode "x".pdf')}`, "part docs bytes: the disposition carries an ASCII fallback and the UTF-8 name");
ok(acceptFor("datasheet") === ".pdf,application/pdf" && acceptFor("specsheet").includes(".docx"), "part docs bytes: the file picker accept list follows the slot");
ok(displayFileName("S4 Datasheet", "pdf") === "S4 Datasheet.pdf" && displayFileName("guide.PDF", "pdf") === "guide.PDF" && displayFileName("guide.pdf", "docx") === "guide.docx", "part docs bytes: the display name ends in the real extension");

async function partDocsUploadAsyncChecks(): Promise<void> {
  const removed: string[] = [];
  const fake = (bytes: Uint8Array | null, size = 1000) => ({
    head: async () => (bytes ? { bytes, size } : null),
    remove: async (p: string) => { removed.push(p); },
  });
  const ID = "PD-abcdef123456";
  const good = await verifyUploadedBlob({ documentId: ID, blobPathname: `part-docs/${ID}/ds-Ab12.pdf`, fileName: "ds.pdf", kind: "datasheet" }, fake(pdDocBytes("%PDF-1.7")));
  ok(good.ok && good.file.blobKey === `part-docs/${ID}/ds-Ab12.pdf` && good.file.size === 1000 && good.file.contentType === "application/pdf", "part docs upload: a real PDF under its own path is accepted");
  const foreign = await verifyUploadedBlob({ documentId: ID, blobPathname: "part-docs/PD-000000000000/x.pdf", fileName: "x.pdf", kind: "datasheet" }, fake(pdDocBytes("%PDF-1.7")));
  ok(!foreign.ok && removed.length === 0, "part docs upload: another document's pathname is refused without touching it");
  const missing = await verifyUploadedBlob({ documentId: ID, blobPathname: `part-docs/${ID}/x.pdf`, fileName: "x.pdf", kind: "datasheet" }, fake(null));
  ok(!missing.ok && missing.error.includes("didn't arrive"), "part docs upload: a blob that isn't there is refused");
  const html = await verifyUploadedBlob({ documentId: ID, blobPathname: `part-docs/${ID}/x.pdf`, fileName: "x.pdf", kind: "datasheet" }, fake(pdDocBytes("<html>")));
  ok(!html.ok && removed.includes(`part-docs/${ID}/x.pdf`), "part docs upload: a file that is not a PDF is refused and its blob deleted");
  const big = await verifyUploadedBlob({ documentId: ID, blobPathname: `part-docs/${ID}/big.pdf`, fileName: "big.pdf", kind: "datasheet" }, fake(pdDocBytes("%PDF-1.7"), 26 * 1024 * 1024));
  ok(!big.ok && big.error === "That file is over 25 MB.", "part docs upload: over 25 MB is refused");
  const word = await verifyUploadedBlob({ documentId: ID, blobPathname: `part-docs/${ID}/g.docx`, fileName: "Guide Spec.docx", kind: "specsheet" }, fake(pdDocx()));
  ok(word.ok && word.file.contentType === CONTENT_TYPES.docx && word.file.fileName === "Guide Spec.docx", "part docs upload: a Word spec sheet is accepted");
}
```

Then register the async half in the suite's chain (search for `.then(() => deleteRound2AsyncChecks())` near the end of `seeded()`):

In `scripts/test-review-and-spec.ts`, replace this exact text:

```ts
  .then(() => deleteRound2AsyncChecks())
```

with:

```ts
  .then(() => deleteRound2AsyncChecks())
  .then(() => partDocsUploadAsyncChecks())
```


- [ ] **Step 2: Run it to verify it fails**

```bash
env -u DATABASE_URL npm run test:specs 2>&1 | grep -m1 -i 'cannot find module'
```

Expected: `Error: Cannot find module '@/lib/part-docs/files'`.


- [ ] **Step 3: Add the blob head reader**

Sniffing needs only the first 64 KB; this reads that much of a private blob and cancels the stream, so a 25 MB file never passes through the function.

In `src/lib/blob.ts`, insert the following immediately before the line `/**`:

```ts
/**
 * The first `max` bytes of a private blob, plus its stored size — enough to
 * sniff what a client-uploaded file really is (part documents, #DOC) without
 * pulling a 25 MB file through the function. Null when the blob is missing.
 */
export async function getBlobHead(
  pathname: string,
  max: number
): Promise<{ bytes: Uint8Array; size: number } | null> {
  const res = await get(pathname, { access: "private" });
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  const reader = res.stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }
  const bytes = new Uint8Array(Math.min(total, max));
  let at = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, bytes.length - at);
    if (take <= 0) break;
    bytes.set(c.subarray(0, take), at);
    at += take;
  }
  return { bytes, size: res.blob.size };
}

```


- [ ] **Step 4: Write the file-type rules**

Create `src/lib/part-docs/files.ts`:

```ts
import type { PartDocKind } from "./types";

/**
 * File-type rules for part documents (#DOC, spec §6). Pure — the upload
 * route, the attach actions and the fetcher all call `sniffDocumentType` on
 * the real bytes; the extension and the browser's MIME are never trusted.
 */

export type SniffedType = "pdf" | "doc" | "docx";

export const CONTENT_TYPES: Record<SniffedType, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** What each slot accepts: a datasheet is a PDF; a spec sheet is PDF or Word (§2.2). */
export const ALLOWED_TYPES: Record<PartDocKind, readonly SniffedType[]> = {
  datasheet: ["pdf"],
  specsheet: ["pdf", "doc", "docx"],
};

/** The `accept` attribute for a slot's file input. */
export function acceptFor(kind: PartDocKind): string {
  return kind === "datasheet" ? ".pdf,application/pdf" : ".pdf,.doc,.docx,application/pdf,application/msword," + CONTENT_TYPES.docx;
}

/** Every content type the upload token may be issued for (the bytes are checked after). */
export const UPLOAD_CONTENT_TYPES: readonly string[] = [...Object.values(CONTENT_TYPES), "application/octet-stream"];

const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function startsWith(bytes: Uint8Array, sig: readonly number[], at = 0): boolean {
  if (bytes.length < at + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[at + i] !== sig[i]) return false;
  return true;
}

function indexOfAscii(bytes: Uint8Array, text: string, limit: number): number {
  const codes = [...text].map((c) => c.charCodeAt(0));
  const end = Math.min(bytes.length, limit) - codes.length;
  outer: for (let i = 0; i <= end; i++) {
    for (let j = 0; j < codes.length; j++) if (bytes[i + j] !== codes[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * What the bytes really are. PDF: `%PDF-` within the first 1,024 bytes (the
 * PDF spec allows leading junk there). DOC: the OLE2 compound-file magic.
 * DOCX: a ZIP whose entry names include `word/` in the first 64 KB — every
 * Word-written .docx lists `word/document.xml` there; a plain ZIP or an
 * .xlsx does not.
 */
export function sniffDocumentType(bytes: Uint8Array): SniffedType | null {
  if (indexOfAscii(bytes, "%PDF-", 1024) >= 0) return "pdf";
  if (startsWith(bytes, OLE2)) return "doc";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) && indexOfAscii(bytes, "word/", 64 * 1024) >= 0) return "docx";
  return null;
}

/** How many leading bytes sniffing needs. */
export const SNIFF_BYTES = 64 * 1024;

/** Refusal text for bytes a slot does not accept, or null when they fit. */
export function checkDocumentBytes(kind: PartDocKind, bytes: Uint8Array): { ok: true; type: SniffedType; contentType: string } | { ok: false; error: string } {
  const type = sniffDocumentType(bytes);
  if (!type) return { ok: false, error: kind === "datasheet" ? "That file is not a PDF." : "That file is not a PDF or Word document." };
  if (!ALLOWED_TYPES[kind].includes(type)) return { ok: false, error: "Datasheets must be PDF files." };
  return { ok: true, type, contentType: CONTENT_TYPES[type] };
}

export function contentTypeForFileName(fileName: string): string {
  const n = fileName.toLowerCase();
  if (n.endsWith(".docx")) return CONTENT_TYPES.docx;
  if (n.endsWith(".doc")) return CONTENT_TYPES.doc;
  return CONTENT_TYPES.pdf;
}

/** Make a file name end in the extension its bytes actually have. */
export function withExtension(fileName: string, type: SniffedType): string {
  const base = fileName.replace(/\.(pdf|docx?|aspx|php|html?)$/i, "");
  return `${base || "document"}.${type}`;
}

/** RFC 6266 inline disposition: an ASCII fallback plus the UTF-8 name. */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
```


- [ ] **Step 5: Write the upload verifier**

Create `src/lib/part-docs/verify-upload.ts`:

```ts
import { deleteBlob, getBlobHead } from "@/lib/blob";
import type { StoredFile } from "@/lib/stores/part-documents";
import { checkDocumentBytes, CONTENT_TYPES, SNIFF_BYTES } from "./files";
import { blobPathBelongsTo, MAX_PART_DOC_BYTES, type PartDocKind } from "./types";

/**
 * Accept a browser-uploaded blob as a part document's file (#DOC, spec §6).
 * Server-only. The pathname comes from the client and is untrusted: it must
 * sit under `part-docs/<documentId>/`, and the bytes Blob actually holds must
 * sniff as a type the slot accepts. A rejected upload never became a
 * document, so its blob is deleted rather than left orphaned.
 *
 * `deps` exists for the spec harness — production passes nothing.
 */
export type VerifyDeps = {
  head: (pathname: string, max: number) => Promise<{ bytes: Uint8Array; size: number } | null>;
  remove: (pathname: string) => Promise<void>;
};

const liveDeps: VerifyDeps = { head: getBlobHead, remove: deleteBlob };

/** Keep the user's name for display, capped, with an extension that matches the bytes. */
export function displayFileName(raw: string, type: "pdf" | "doc" | "docx"): string {
  const name = String(raw ?? "").split(/[\\/]/).pop()!.trim().slice(0, 180) || "document";
  return new RegExp(`\\.${type}$`, "i").test(name) ? name : `${name.replace(/\.(pdf|docx?)$/i, "")}.${type}`;
}

export async function verifyUploadedBlob(
  input: { documentId: string; blobPathname: string; fileName: string; kind: PartDocKind },
  deps: VerifyDeps = liveDeps
): Promise<{ ok: true; file: StoredFile } | { ok: false; error: string }> {
  if (!blobPathBelongsTo(input.blobPathname, input.documentId)) {
    return { ok: false, error: "That upload does not belong to this document." };
  }
  const head = await deps.head(input.blobPathname, SNIFF_BYTES);
  if (!head) return { ok: false, error: "The upload didn't arrive — try again." };
  const refuse = async (error: string) => {
    try {
      await deps.remove(input.blobPathname);
    } catch {
      /* best effort — the refusal stands either way */
    }
    return { ok: false as const, error };
  };
  if (head.size > MAX_PART_DOC_BYTES) return refuse("That file is over 25 MB.");
  const check = checkDocumentBytes(input.kind, head.bytes);
  if (!check.ok) return refuse(check.error);
  return {
    ok: true,
    file: {
      blobKey: input.blobPathname,
      fileName: displayFileName(input.fileName, check.type),
      contentType: CONTENT_TYPES[check.type],
      size: head.size,
    },
  };
}
```


- [ ] **Step 6: Write the client-upload token route**

The recordings route's pattern (`src/app/api/recordings/upload/route.ts`) minus the completion callback: with no `onUploadCompleted`, `handleUpload` issues no callback URL, so this route needs no middleware exemption — the browser's own session cookie authenticates the token request.

Create `src/app/api/part-documents/upload/route.ts`:

```ts
import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/auth";
import { blobEnabled } from "@/lib/blob";
import { UPLOAD_CONTENT_TYPES } from "@/lib/part-docs/files";
import { blobPathBelongsTo, isDocumentId, MAX_PART_DOC_BYTES } from "@/lib/part-docs/types";

// Token minting only — no bytes pass through this function.
export const maxDuration = 30;

/**
 * Vercel Blob client-upload broker for part documents (#DOC, spec §6) — the
 * recordings route's pattern (src/app/api/recordings/upload/route.ts), so a
 * 25 MB PDF goes browser → Blob directly instead of through the ~900 KB
 * server-action ceiling the old datasheet upload hit.
 *
 * Only the `blob.generate-client-token` step is handled: there is no
 * `onUploadCompleted`, so no callback URL is issued and the route needs no
 * middleware exemption. The browser then calls attachUploadedDocumentAction /
 * replaceDocumentFileAction, which read the uploaded bytes back and check
 * them by magic number before anything is recorded — the content types
 * allowed here are only a first filter.
 */

class UploadRefused extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

function parseDocumentId(payload: string | null): string {
  try {
    const parsed = payload ? (JSON.parse(payload) as { documentId?: unknown }) : {};
    if (!isDocumentId(parsed.documentId)) throw new Error("bad id");
    return parsed.documentId;
  } catch {
    throw new UploadRefused(400, "clientPayload must be {documentId}");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!blobEnabled()) {
    return NextResponse.json({ reason: "blob-disabled", error: "File storage isn't configured on this deployment." }, { status: 503 });
  }
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (body.type !== "blob.generate-client-token") {
    return NextResponse.json({ error: "unsupported event" }, { status: 400 });
  }
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const session = await auth();
        const u = session?.user;
        if (!u?.id || !u.active) throw new UploadRefused(401, "unauthorized");
        const documentId = parseDocumentId(clientPayload);
        if (!blobPathBelongsTo(pathname, documentId)) {
          throw new UploadRefused(400, `pathname must be part-docs/${documentId}/<file>`);
        }
        return {
          allowedContentTypes: [...UPLOAD_CONTENT_TYPES],
          maximumSizeInBytes: MAX_PART_DOC_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ documentId }),
        };
      },
    });
    return NextResponse.json(json);
  } catch (e) {
    if (e instanceof UploadRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: (e as Error)?.message ?? "upload refused" }, { status: 400 });
  }
}
```


- [ ] **Step 7: Write the viewer route**

Create `src/app/api/part-documents/[id]/route.ts`:

```ts
import { requireUser } from "@/lib/session";
import { getBlobStream } from "@/lib/blob";
import { getDocument } from "@/lib/stores/part-documents";
import { contentDisposition, contentTypeForFileName } from "@/lib/part-docs/files";

/**
 * Part-document viewer (#DOC, spec §7): signed-in only. Streams the private
 * blob; a link-only document (no stored file yet) redirects to its source
 * URL instead. `?history=<n>` streams the n-th replaced file — nothing is
 * ever deleted, so every earlier version stays viewable.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await ctx.params;
  const doc = await getDocument(decodeURIComponent(id));
  if (!doc) return new Response("Not found", { status: 404 });

  let blobKey = doc.blobKey;
  let fileName = doc.fileName;
  const h = new URL(req.url).searchParams.get("history");
  if (h !== null) {
    const entry = /^\d+$/.test(h) ? doc.history?.[Number(h)] : undefined;
    if (!entry) return new Response("Not found", { status: 404 });
    blobKey = entry.blobKey;
    fileName = entry.fileName;
  }

  if (!blobKey) {
    if (h === null && doc.sourceUrl && /^https?:\/\//i.test(doc.sourceUrl)) return Response.redirect(doc.sourceUrl, 302);
    return new Response("Not found", { status: 404 });
  }
  const stream = await getBlobStream(blobKey);
  if (!stream) return new Response("File missing from storage", { status: 404 });
  return new Response(stream, {
    headers: {
      "content-type": h === null ? doc.contentType || contentTypeForFileName(fileName) : contentTypeForFileName(fileName),
      "content-disposition": contentDisposition(fileName),
      // A replace writes a NEW blob and moves the old one to history, so the
      // bytes behind one (id, history) pair never change — but the current
      // file of an id does, so the cache stays short.
      "cache-control": h === null ? "private, max-age=300" : "private, max-age=86400",
    },
  });
}
```


- [ ] **Step 8: Write the attach / replace / detach / not-needed actions**

A `"use server"` file may export only async functions (and types). Every action is `requireUser()` — anyone signed in (spec §2.4).

Create `src/app/(app)/catalog/documents/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { get as getPart } from "@/lib/stores/catalog";
import {
  attachDocument,
  createDocument,
  detachDocument,
  getDocument,
  replaceDocumentFile,
} from "@/lib/stores/part-documents";
import { setDocNotNeeded } from "@/lib/part-docs/not-needed";
import { isDocumentId, isPartDocKind, type PartDocKind } from "@/lib/part-docs/types";
import { verifyUploadedBlob } from "@/lib/part-docs/verify-upload";

/**
 * Part documents (#DOC) — every write from the Datasheets page, the bulk
 * drop and the part editor's Documents section. Anyone signed in may upload,
 * attach, replace, detach and mark not-needed (spec §2.4); every change
 * records who and when; nothing is hard-deleted.
 */

export type DocActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const MAX_SKUS_PER_CALL = 500;

function revalidate(): void {
  revalidatePath("/catalog/documents");
  revalidatePath("/catalog");
}

/** The SKUs among `skus` that are live catalog parts (deduped, capped). */
async function liveSkus(skus: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const raw of new Set(skus.slice(0, MAX_SKUS_PER_CALL))) {
    const sku = String(raw || "").trim();
    if (sku && (await getPart(sku))) out.push(sku);
  }
  return out;
}

/** A browser finished uploading a NEW document's file: check it, record the
 *  document, link it to the parts it was dropped on. */
export async function attachUploadedDocumentAction(input: {
  documentId: string;
  blobPathname: string;
  fileName: string;
  kind: PartDocKind;
  skus: string[];
}): Promise<DocActionResult<{ documentId: string; linked: number }>> {
  const user = await requireUser();
  if (!isDocumentId(input.documentId)) return { ok: false, error: "Not a document id." };
  if (!isPartDocKind(input.kind)) return { ok: false, error: "Pick Datasheet or Spec sheet." };
  const skus = await liveSkus(input.skus || []);
  if (!skus.length) return { ok: false, error: "Those parts are no longer in the catalog." };
  if (await getDocument(input.documentId)) return { ok: false, error: "That document already exists — use Replace." };

  const checked = await verifyUploadedBlob(input);
  if (!checked.ok) return checked;
  const doc = await createDocument({
    id: input.documentId,
    kind: input.kind,
    ...checked.file,
    sourceUrl: null,
    source: "upload",
    by: user.name,
  });
  if (!doc) return { ok: false, error: "That document already exists — use Replace." };
  const linked = await attachDocument(doc.id, skus, user.name);
  revalidate();
  return { ok: true, documentId: doc.id, linked };
}

/** A browser finished uploading a REPLACEMENT file for an existing document.
 *  The old file moves to history; every part linked to it sees the new one. */
export async function replaceDocumentFileAction(input: {
  documentId: string;
  blobPathname: string;
  fileName: string;
}): Promise<DocActionResult> {
  const user = await requireUser();
  const doc = await getDocument(input.documentId);
  if (!doc) return { ok: false, error: "That document no longer exists." };
  const checked = await verifyUploadedBlob({ ...input, kind: doc.kind });
  if (!checked.ok) return checked;
  await replaceDocumentFile(doc.id, checked.file, user.name);
  revalidate();
  return { ok: true };
}

/** Unlink one part from a document. The document and its file stay. */
export async function detachDocumentAction(documentId: string, sku: string): Promise<DocActionResult> {
  await requireUser();
  if (!isDocumentId(documentId)) return { ok: false, error: "Not a document id." };
  if (!(await detachDocument(documentId, String(sku || "").trim()))) return { ok: false, error: "That part was not linked to this document." };
  revalidate();
  return { ok: true };
}

/** Link an existing document to more parts ("Also covers…", bulk "Attach an
 *  existing document"). */
export async function attachExistingDocumentAction(documentId: string, skus: string[]): Promise<DocActionResult<{ linked: number }>> {
  const user = await requireUser();
  const doc = await getDocument(documentId);
  if (!doc) return { ok: false, error: "That document no longer exists." };
  const live = await liveSkus(skus || []);
  if (!live.length) return { ok: false, error: "Pick at least one catalog part." };
  const linked = await attachDocument(doc.id, live, user.name);
  revalidate();
  return { ok: true, linked };
}

/** Mark (or unmark) parts as needing no document of one kind. */
export async function setNotNeededAction(skus: string[], kind: PartDocKind, on: boolean): Promise<DocActionResult<{ changed: number }>> {
  await requireUser();
  if (!isPartDocKind(kind)) return { ok: false, error: "Pick Datasheet or Spec sheet." };
  const changed = await setDocNotNeeded((skus || []).slice(0, MAX_SKUS_PER_CALL), kind, !!on);
  revalidate();
  return { ok: true, changed };
}
```


- [ ] **Step 9: Run the gates**

```bash
npx tsc --noEmit -p .
```

Expected: no output, exit 0.

```bash
env -u DATABASE_URL npm run test:specs > "${TMPDIR:-/tmp}/pd-specs.log" 2>&1; tail -1 "${TMPDIR:-/tmp}/pd-specs.log"; grep '^FAIL' "${TMPDIR:-/tmp}/pd-specs.log"
```

Expected: `ALL PASSED` and no `FAIL` lines. (One pre-existing flake exists — `redeem: tampered code -> not ok`, a random-code test that fails about one run in sixty; if it is the only FAIL, re-run.)

Expected additionally: `grep -cE '^PASS part docs (bytes|upload)' "${TMPDIR:-/tmp}/pd-specs.log"` prints `19`.

```bash
npx eslint 2>&1 | grep problems
```

Expected: `✖ N problems (0 errors, N warnings)` with N ≤ 111 (the baseline is 111; Task 8 removes one).


- [ ] **Step 10: Commit**

```bash
git add src/lib/blob.ts src/lib/part-docs/files.ts src/lib/part-docs/verify-upload.ts src/app/api/part-documents 'src/app/(app)/catalog/documents/actions.ts' scripts/test-review-and-spec.ts
git commit -m "feat(part-docs): direct-to-Blob upload route, magic-byte check, viewer route, attach/replace/detach actions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 5: Fetch from links — the guarded fetcher and batch fetch

**Files:**
- Modify: `src/lib/venue-calendar-fetch.ts` (export `hostnameIsUnsafe`)
- Modify: `src/lib/part-docs/files.ts` (append `fileNameForFetched`)
- Create: `src/lib/part-docs/fetch.ts`
- Create: `src/lib/part-docs/fetch-links.ts`
- Modify: `src/app/(app)/catalog/documents/actions.ts` (imports + `fetchLinksAction`)
- Test: `scripts/test-review-and-spec.ts` (append a `Task 5` block + a chain line), `scripts/test-review-regressions.ts` (a DB block)

**Interfaces:**
- Consumes: `validateIcsUrlSync`, `resolveRedirectHop`, `hostnameIsUnsafe` from `src/lib/venue-calendar-fetch.ts` (reused unchanged — only the export is added); Task 3 store functions and `PartDocsState`; Task 4 `checkDocumentBytes`; `putBlob` from `src/lib/blob.ts`.
- Produces (`files.ts`): `fileNameForFetched(contentDisposition: string | null, url: string, fallback: string, type: SniffedType): string`.
- Produces (`fetch.ts`, server): `type FetchedFile = { bytes: Uint8Array; contentDisposition: string | null; finalUrl: string }`, `type FetchDeps = { fetchImpl?; isUnsafeHost?; timeoutMs?; maxBytes? }`, `fetchDocumentBytes(rawUrl: string, deps?: FetchDeps): Promise<{ ok: true; file: FetchedFile } | { ok: false; error: string }>`.
- Produces (`fetch-links.ts`, server): `type FetchTarget = { sku: string; kind: PartDocKind }`, `type FetchOutcome = FetchTarget & { ok: boolean; documentId?: string; error?: string; alsoLinked?: number }`, `type FetchLinksDeps`, `type FetchContext`, `buildFetchContext(state: PartDocsState): FetchContext`, `fetchSlot(ctx, target, by, deps?): Promise<FetchOutcome>`.
- Produces (actions): `fetchLinksAction(targets: FetchTarget[]): Promise<DocActionResult<{ results: FetchOutcome[] }>>` — at most `FETCH_BATCH_SIZE` per call.

- [ ] **Step 1: Write the failing tests**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts

/* ======================================================================
   Part documents (#DOC) — Task 5: the guarded fetcher. A fake fetch and
   IP-literal hosts keep every case offline (a public literal IP needs no
   DNS; a private one is refused before any request).
   ====================================================================== */
import { fetchDocumentBytes } from "@/lib/part-docs/fetch";
import { fileNameForFetched } from "@/lib/part-docs/files";

ok(fileNameForFetched(`attachment; filename="S4 LED.pdf"`, "https://x.example/a", "t", "pdf") === "S4 LED.pdf", "part docs fetch names: Content-Disposition filename wins");
ok(fileNameForFetched(`attachment; filename*=UTF-8''Gu%C3%ADa.pdf`, "https://x.example/a", "t", "pdf") === "Guía.pdf", "part docs fetch names: the RFC 5987 name is decoded");
ok(fileNameForFetched(null, "https://x.example/docs/S4_Datasheet.pdf?v=2", "t", "pdf") === "S4_Datasheet.pdf", "part docs fetch names: else the URL's file name");
ok(fileNameForFetched(null, "https://www.etcconnect.com/WorkArea/DownloadAsset.aspx?id=1", "Source Four LED", "pdf") === "Source Four LED.pdf", "part docs fetch names: an .aspx endpoint falls back to the title");
ok(fileNameForFetched(`inline; filename="guide.pdf"`, "https://x.example/a", "t", "docx") === "guide.docx", "part docs fetch names: the extension follows the real bytes");

async function partDocsFetchAsyncChecks(): Promise<void> {
  const pdf = new TextEncoder().encode("%PDF-1.7\n...");
  const calls: string[] = [];
  const fakeFetch = (routes: Record<string, () => Response>) =>
    (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      const r = routes[url];
      return r ? r() : new Response("nope", { status: 404 });
    }) as typeof fetch;
  const neverUnsafe = async () => false;

  const scheme = await fetchDocumentBytes("file:///etc/passwd");
  ok(!scheme.ok && scheme.error === "Only http(s) links can be fetched.", "part docs fetch: a non-http scheme is refused");
  const loop = await fetchDocumentBytes("http://127.0.0.1/x.pdf", { fetchImpl: fakeFetch({}) });
  ok(!loop.ok && calls.length === 0, "part docs fetch: a loopback literal is refused before any request (venue-calendar guard)");
  const meta = await fetchDocumentBytes("http://169.254.169.254/latest", { fetchImpl: fakeFetch({}) });
  ok(!meta.ok && calls.length === 0, "part docs fetch: the cloud metadata address is refused");

  const hop = await fetchDocumentBytes("http://93.184.216.34/ds.pdf", {
    fetchImpl: fakeFetch({ "http://93.184.216.34/ds.pdf": () => new Response(null, { status: 302, headers: { location: "http://10.0.0.5/ds.pdf" } }) }),
  });
  ok(!hop.ok && !calls.includes("http://10.0.0.5/ds.pdf"), "part docs fetch: a redirect to a private address is refused and never requested");

  const rebind = await fetchDocumentBytes("https://docs.example.com/ds.pdf", { fetchImpl: fakeFetch({}), isUnsafeHost: async () => true });
  ok(!rebind.ok && rebind.error === "That host isn't reachable from the server.", "part docs fetch: a hostname resolving to a private address is refused");

  const good = await fetchDocumentBytes("http://93.184.216.34/a", {
    isUnsafeHost: neverUnsafe,
    fetchImpl: fakeFetch({
      "http://93.184.216.34/a": () => new Response(null, { status: 301, headers: { location: "/files/ds.pdf" } }),
      "http://93.184.216.34/files/ds.pdf": () => new Response(pdf, { status: 200, headers: { "content-disposition": 'attachment; filename="ds.pdf"' } }),
    }),
  });
  ok(good.ok && good.file.finalUrl === "http://93.184.216.34/files/ds.pdf" && good.file.bytes.byteLength === pdf.byteLength && good.file.contentDisposition!.includes("ds.pdf"), "part docs fetch: a relative redirect is re-validated, followed, and the bytes returned");

  const big = await fetchDocumentBytes("http://93.184.216.34/big", {
    isUnsafeHost: neverUnsafe,
    maxBytes: 4,
    fetchImpl: fakeFetch({ "http://93.184.216.34/big": () => new Response(pdf, { status: 200 }) }),
  });
  ok(!big.ok && big.error === "That file is over 25 MB.", "part docs fetch: the streaming size cap refuses an oversized body");
  const missing = await fetchDocumentBytes("http://93.184.216.34/404", { isUnsafeHost: neverUnsafe, fetchImpl: fakeFetch({}) });
  ok(!missing.ok && missing.error === "The link returned HTTP 404.", "part docs fetch: an HTTP error is reported with its status");
  const loops = await fetchDocumentBytes("http://93.184.216.34/r0", {
    isUnsafeHost: neverUnsafe,
    fetchImpl: (async (input: string | URL | Request) => {
      const n = Number(String(input).split("/r").pop()) + 1;
      return new Response(null, { status: 302, headers: { location: `/r${n}` } });
    }) as typeof fetch,
  });
  ok(!loops.ok && loops.error === "Too many redirects.", "part docs fetch: a redirect loop stops");
}
```

In `scripts/test-review-and-spec.ts`, replace this exact text:

```ts
  .then(() => partDocsUploadAsyncChecks())
```

with:

```ts
  .then(() => partDocsUploadAsyncChecks())
  .then(() => partDocsFetchAsyncChecks())
```

and the DB-backed half, immediately before the final `console.log("review regression checks passed");` of `scripts/test-review-regressions.ts`:

In `scripts/test-review-regressions.ts`, insert the following immediately before the line `console.log("review regression checks passed");`:

```ts
  /* --- part documents (#DOC): fetch from links, shared per URL --- */
  {
    const { upsert: upsertPart, list: listParts } = await import("@/lib/stores/catalog");
    const { loadPartDocsState } = await import("@/lib/part-docs/load");
    const { buildFetchContext, fetchSlot } = await import("@/lib/part-docs/fetch-links");
    const { slotCoverage } = await import("@/lib/part-docs/coverage");
    const Docs = await import("@/lib/stores/part-documents");
    const U1 = "https://etc.example/s4-datasheet.pdf";
    const U2 = "https://etc.example/broken.pdf";
    await upsertPart({ sku: "FETCH-A", desc: "A", category: "Lighting", unit: "ea", list: 1, cost: 1, docs: [{ kind: "datasheet", label: "DS", url: U1 }] });
    await upsertPart({ sku: "FETCH-B", desc: "B", category: "Lighting", unit: "ea", list: 1, cost: 1, productMetadata: { datasheets: [{ kind: "datasheet", fileName: "ds.pdf", sourceUrl: U1 }] } });
    await upsertPart({ sku: "FETCH-C", desc: "C", category: "Lighting", unit: "ea", list: 1, cost: 1, docs: [{ kind: "datasheet", label: "DS", url: U2 }] });
    await upsertPart({ sku: "FETCH-D", desc: "D", category: "Lighting", unit: "ea", list: 1, cost: 1 });

    const fetched: string[] = [];
    let brokenWorks = false;
    const deps = {
      fetchDoc: async (url: string) => {
        fetched.push(url);
        if (url === U2 && !brokenWorks) return { ok: true as const, file: { bytes: new TextEncoder().encode("<html>error</html>"), contentDisposition: null, finalUrl: url } };
        return { ok: true as const, file: { bytes: new TextEncoder().encode("%PDF-1.7 x"), contentDisposition: null, finalUrl: url } };
      },
      putFile: async (pathname: string) => ({ pathname: pathname.replace(/\.pdf$/, "-rnd.pdf") }),
    };
    const ctxFor = async () => buildFetchContext(await loadPartDocsState(await listParts()));

    const a = await fetchSlot(await ctxFor(), { sku: "FETCH-A", kind: "datasheet" }, "Jeff", deps);
    assert(a.ok && a.documentId && a.alsoLinked === 2, "part docs fetch: a fetched URL is attached to every part that referenced it");
    const doc = await Docs.getDocument(a.documentId!);
    assert(doc?.source === "fetch" && doc.sourceUrl === U1 && doc.blobKey?.startsWith(`part-docs/${doc.id}/`) && doc.lastFetch?.ok === true, "part docs fetch: the document stores the file privately under part-docs/<id>/ and remembers the URL");
    const state = await loadPartDocsState(await listParts());
    assert.equal(slotCoverage(state.index, "FETCH-B", "datasheet").state, "own", "part docs fetch: the other part is satisfied without a second download");
    const b = await fetchSlot(await ctxFor(), { sku: "FETCH-B", kind: "datasheet" }, "Jeff", deps);
    assert(b.ok && fetched.filter((u) => u === U1).length === 1, "part docs fetch: a URL is downloaded once, ever");

    const c1 = await fetchSlot(await ctxFor(), { sku: "FETCH-C", kind: "datasheet" }, "Jeff", deps);
    assert(!c1.ok && c1.error === "That file is not a PDF.", "part docs fetch: bytes that aren't a PDF are refused with the reason");
    const cState = await loadPartDocsState(await listParts());
    const cSlot = slotCoverage(cState.index, "FETCH-C", "datasheet");
    assert(cSlot.state === "link-only" && cSlot.docs.length === 1, "part docs fetch: the failed URL becomes a link-only document on the part");
    const failedDoc = await Docs.getDocument(cSlot.state === "link-only" ? cSlot.docs[0].id : "");
    assert.deepEqual([failedDoc?.lastFetch?.ok, failedDoc?.lastFetch?.error], [false, "That file is not a PDF."], "part docs fetch: …carrying the failure reason for the page to list");
    brokenWorks = true;
    const c2 = await fetchSlot(await ctxFor(), { sku: "FETCH-C", kind: "datasheet" }, "Jeff", deps);
    assert(c2.ok && c2.documentId === failedDoc?.id, "part docs fetch: a retry that succeeds fills the same document");
    assert.equal((await Docs.getDocument(failedDoc!.id))?.lastFetch?.ok, true, "part docs fetch: …and clears the failure");

    const d = await fetchSlot(await ctxFor(), { sku: "FETCH-D", kind: "datasheet" }, "Jeff", deps);
    assert(!d.ok && d.error === "No link to fetch.", "part docs fetch: a part with no link says so");
  }

```


- [ ] **Step 2: Run them to verify they fail**

```bash
env -u DATABASE_URL npm run test:specs 2>&1 | grep -m1 -i 'cannot find module'
```

Expected: `Error: Cannot find module '@/lib/part-docs/fetch'`.


- [ ] **Step 3: Export the venue-calendar DNS guard**

The whole SSRF guard is reused unchanged; only this function was module-private.

In `src/lib/venue-calendar-fetch.ts`, replace this exact text:

```ts
 *  verify" is never treated as "safe". */
async function hostnameIsUnsafe(hostname: string): Promise<boolean> {
```

with:

```ts
 *  verify" is never treated as "safe". Exported for the part-document
 *  fetcher (src/lib/part-docs/fetch.ts), which reuses this whole guard. */
export async function hostnameIsUnsafe(hostname: string): Promise<boolean> {
```


- [ ] **Step 4: Name fetched files**

Append to the end of `src/lib/part-docs/files.ts`:

```ts

/**
 * The name to store a fetched file under: the server's Content-Disposition
 * name, else the URL's last path segment when it looks like a document, else
 * `fallback` (the document title). Always ends in the sniffed extension.
 */
export function fileNameForFetched(contentDisposition: string | null, url: string, fallback: string, type: SniffedType): string {
  let name = "";
  const cd = contentDisposition || "";
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(cd);
  if (star) {
    try {
      name = decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      name = "";
    }
  }
  if (!name) {
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
    if (plain) name = plain[1].trim();
  }
  if (!name) {
    try {
      const last = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
      if (/\.(pdf|docx?)$/i.test(last)) name = last;
    } catch {
      /* unparsable URL — fall through */
    }
  }
  name = (name || fallback || "document").split(/[\\/]/).pop()!.trim().slice(0, 180) || "document";
  return withExtension(name, type);
}
```


- [ ] **Step 5: Write the guarded fetcher**

Create `src/lib/part-docs/fetch.ts`:

```ts
import { hostnameIsUnsafe, resolveRedirectHop, validateIcsUrlSync } from "@/lib/venue-calendar-fetch";
import { MAX_PART_DOC_BYTES } from "./types";

/**
 * Server-side download of a manufacturer document URL (#DOC, spec §6).
 * Server-only. It reuses src/lib/venue-calendar-fetch.ts's SSRF guard
 * unchanged — http(s) only, the literal-host check, DNS resolution with
 * private/loopback/link-local refusal, and BOTH re-applied to every redirect
 * hop (`redirect: "manual"`) — and adds a document-sized body cap and
 * timeout. It never throws: every failure is `{ ok: false, error }` with a
 * reason the Datasheets page lists.
 *
 * `deps` exists for the spec harness (a fake fetch and a fake DNS check);
 * production passes nothing.
 */

export type FetchedFile = { bytes: Uint8Array; contentDisposition: string | null; finalUrl: string };
export type FetchDeps = {
  fetchImpl?: typeof fetch;
  isUnsafeHost?: (hostname: string) => Promise<boolean>;
  timeoutMs?: number;
  maxBytes?: number;
};

const FETCH_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

export async function fetchDocumentBytes(rawUrl: string, deps: FetchDeps = {}): Promise<{ ok: true; file: FetchedFile } | { ok: false; error: string }> {
  const doFetch = deps.fetchImpl ?? fetch;
  const unsafe = deps.isUnsafeHost ?? hostnameIsUnsafe;
  const maxBytes = deps.maxBytes ?? MAX_PART_DOC_BYTES;
  if (!/^https?:\/\//i.test(String(rawUrl ?? "").trim())) return { ok: false, error: "Only http(s) links can be fetched." };
  const first = validateIcsUrlSync(rawUrl);
  if (!first.ok) return first;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? FETCH_TIMEOUT_MS);
  try {
    let url = first.url;
    if (await unsafe(new URL(url).hostname)) return { ok: false, error: "That host isn't reachable from the server." };
    let res: Response;
    for (let hop = 0; ; hop++) {
      res = await doFetch(url, {
        headers: {
          Accept: "application/pdf, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document, */*",
          "User-Agent": "peak-app/1.0 (Peak Systems Group part documents)",
        },
        signal: controller.signal,
        redirect: "manual",
      });
      const location = res.headers.get("location");
      if (!(res.status >= 300 && res.status < 400) || !location) break;
      if (hop >= MAX_REDIRECTS) return { ok: false, error: "Too many redirects." };
      const next = resolveRedirectHop(location, url);
      if (!next.ok) return next;
      if (await unsafe(new URL(next.url).hostname)) return { ok: false, error: "Redirected to a host that isn't reachable from the server." };
      url = next.url;
    }
    if (!res.ok) return { ok: false, error: `The link returned HTTP ${res.status}.` };
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > maxBytes) return { ok: false, error: "That file is over 25 MB." };

    const chunks: Uint8Array[] = [];
    let total = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          controller.abort();
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          return { ok: false, error: "That file is over 25 MB." };
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.byteLength;
    }
    return { ok: true, file: { bytes, contentDisposition: res.headers.get("content-disposition"), finalUrl: url } };
  } catch {
    if (controller.signal.aborted) return { ok: false, error: "The link took too long to respond." };
    return { ok: false, error: "Could not reach that link." };
  } finally {
    clearTimeout(timer);
  }
}
```


- [ ] **Step 6: Write the fetch-and-share step**

Create `src/lib/part-docs/fetch-links.ts`:

```ts
import { putBlob } from "@/lib/blob";
import {
  attachDocument,
  createDocument,
  recordFetchResult,
  replaceDocumentFile,
  titleFromFileName,
} from "@/lib/stores/part-documents";
import { linkedDocuments, ownFiles } from "./coverage";
import { fetchDocumentBytes } from "./fetch";
import { checkDocumentBytes, fileNameForFetched } from "./files";
import type { PartDocsState } from "./load";
import { newDocumentId, partDocBlobPath, type PartDocKind, type PartDocument } from "./types";

/**
 * "Fetch from links" (#DOC, spec §3/§6). Server-only. For one part and one
 * kind: try each URL the part has but hasn't fetched — its link-only
 * documents first, then the catalog's own Datasheet/Guide Spec/DaVinci
 * URLs — download it through the SSRF guard, check the bytes, store the file
 * privately and attach it. A URL already fetched for ANY part is reused, not
 * downloaded again, and a successful fetch is attached to every part that
 * referenced the same URL: one document per URL (spec §3).
 *
 * A failure is recorded on the document (creating a link-only one for a
 * catalog URL that had none) so the page can list it with its reason.
 */

export type FetchTarget = { sku: string; kind: PartDocKind };
export type FetchOutcome = FetchTarget & { ok: boolean; documentId?: string; error?: string; alsoLinked?: number };

export type FetchLinksDeps = {
  fetchDoc: typeof fetchDocumentBytes;
  putFile: (pathname: string, bytes: Buffer, contentType: string) => Promise<{ pathname: string }>;
};

const liveDeps: FetchLinksDeps = { fetchDoc: fetchDocumentBytes, putFile: putBlob };

/** Per-request lookups over one loaded state: documents by URL, and which
 *  parts reference each URL (catalog fields or a linked document). */
export type FetchContext = {
  state: PartDocsState;
  byUrl: Map<string, PartDocument>;
  skusByUrl: Map<string, Set<string>>;
};

export function buildFetchContext(state: PartDocsState): FetchContext {
  const byUrl = new Map<string, PartDocument>();
  for (const d of state.documents) {
    if (!d.sourceUrl) continue;
    const current = byUrl.get(d.sourceUrl);
    if (!current || (!current.blobKey && d.blobKey)) byUrl.set(d.sourceUrl, d);
  }
  const skusByUrl = new Map<string, Set<string>>();
  const add = (url: string, sku: string) => {
    let s = skusByUrl.get(url);
    if (!s) skusByUrl.set(url, (s = new Set()));
    s.add(sku);
  };
  for (const [sku, urls] of state.index.catalogUrls) for (const u of [...urls.datasheet, ...urls.specsheet]) add(u, sku);
  for (const l of state.links) {
    const d = state.index.docsById.get(l.documentId);
    if (d?.sourceUrl) add(d.sourceUrl, l.partSku);
  }
  return { state, byUrl, skusByUrl };
}

function candidateUrls(ctx: FetchContext, t: FetchTarget): string[] {
  const out: string[] = [];
  for (const d of linkedDocuments(ctx.state.index, t.sku, t.kind)) if (!d.blobKey && d.sourceUrl) out.push(d.sourceUrl);
  for (const u of ctx.state.index.catalogUrls.get(t.sku)?.[t.kind] ?? []) out.push(u);
  return [...new Set(out)];
}

function urlFileName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || "") || "document";
  } catch {
    return "document";
  }
}

async function shareWith(ctx: FetchContext, doc: PartDocument, sku: string, by: string): Promise<number> {
  const skus = new Set([sku, ...(ctx.skusByUrl.get(doc.sourceUrl || "") ?? [])]);
  return attachDocument(doc.id, [...skus], by);
}

export async function fetchSlot(ctx: FetchContext, t: FetchTarget, by: string, deps: FetchLinksDeps = liveDeps): Promise<FetchOutcome> {
  if (ownFiles(ctx.state.index, t.sku, t.kind).length) return { ...t, ok: true };
  const urls = candidateUrls(ctx, t);
  if (!urls.length) return { ...t, ok: false, error: "No link to fetch." };

  let lastError = "Fetch failed.";
  for (const url of urls) {
    const found = ctx.byUrl.get(url);
    const existing = found && found.kind === t.kind ? found : null;
    if (existing?.blobKey) {
      const alsoLinked = await shareWith(ctx, existing, t.sku, by);
      return { ...t, ok: true, documentId: existing.id, alsoLinked };
    }

    const got = await deps.fetchDoc(url);
    const check = got.ok ? checkDocumentBytes(t.kind, got.file.bytes) : null;
    if (!got.ok || !check?.ok) {
      lastError = !got.ok ? got.error : check && !check.ok ? check.error : lastError;
      let failed = existing;
      if (!failed) {
        failed = await createDocument({
          kind: t.kind,
          fileName: urlFileName(url),
          contentType: "application/pdf",
          size: 0,
          blobKey: null,
          sourceUrl: url,
          source: "fetch",
          by,
        });
        if (failed) {
          await attachDocument(failed.id, [t.sku], by);
          ctx.byUrl.set(url, failed);
        }
      }
      if (failed) await recordFetchResult(failed.id, { ok: false, error: lastError });
      continue;
    }

    const docId = existing?.id ?? newDocumentId();
    const fileName = fileNameForFetched(got.file.contentDisposition, got.file.finalUrl, existing?.title || urlFileName(url), check.type);
    const stored = await deps.putFile(partDocBlobPath(docId, fileName), Buffer.from(got.file.bytes), check.contentType);
    const file = { blobKey: stored.pathname, fileName, contentType: check.contentType, size: got.file.bytes.byteLength };
    const doc = existing
      ? await replaceDocumentFile(existing.id, file, by)
      : await createDocument({ id: docId, kind: t.kind, title: titleFromFileName(fileName), ...file, sourceUrl: url, source: "fetch", by });
    if (!doc) return { ...t, ok: false, error: "Could not record the document." };
    await recordFetchResult(doc.id, { ok: true });
    ctx.byUrl.set(url, doc);
    const alsoLinked = await shareWith(ctx, doc, t.sku, by);
    return { ...t, ok: true, documentId: doc.id, alsoLinked };
  }
  return { ...t, ok: false, error: lastError };
}
```


- [ ] **Step 7: Add the batch action**

In `src/app/(app)/catalog/documents/actions.ts`, replace this exact text (the whole import block):

```ts
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { get as getPart } from "@/lib/stores/catalog";
import {
  attachDocument,
  createDocument,
  detachDocument,
  getDocument,
  replaceDocumentFile,
} from "@/lib/stores/part-documents";
import { setDocNotNeeded } from "@/lib/part-docs/not-needed";
import { isDocumentId, isPartDocKind, type PartDocKind } from "@/lib/part-docs/types";
import { verifyUploadedBlob } from "@/lib/part-docs/verify-upload";
```

with:

```ts
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { blobEnabled } from "@/lib/blob";
import { get as getPart, list as listCatalog } from "@/lib/stores/catalog";
import {
  attachDocument,
  createDocument,
  detachDocument,
  getDocument,
  replaceDocumentFile,
} from "@/lib/stores/part-documents";
import { buildFetchContext, fetchSlot, type FetchOutcome, type FetchTarget } from "@/lib/part-docs/fetch-links";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { setDocNotNeeded } from "@/lib/part-docs/not-needed";
import { FETCH_BATCH_SIZE, isDocumentId, isPartDocKind, type PartDocKind } from "@/lib/part-docs/types";
import { verifyUploadedBlob } from "@/lib/part-docs/verify-upload";
```

Append to the end of `src/app/(app)/catalog/documents/actions.ts`:

```ts

/**
 * Fetch up to FETCH_BATCH_SIZE slots' links (spec §6 "batch fetch runs a
 * bounded number per request"). The page loops over a selection calling
 * this; every success and failure is persisted as it happens, so a batch
 * that is interrupted simply resumes on the next click.
 */
export async function fetchLinksAction(targets: FetchTarget[]): Promise<DocActionResult<{ results: FetchOutcome[] }>> {
  const user = await requireUser();
  if (!blobEnabled()) {
    return { ok: false, error: "File storage isn't configured (no BLOB_READ_WRITE_TOKEN) — nothing can be fetched on this deployment." };
  }
  const batch = (targets || []).filter((t) => t && typeof t.sku === "string" && isPartDocKind(t.kind)).slice(0, FETCH_BATCH_SIZE);
  if (!batch.length) return { ok: true, results: [] };
  const ctx = buildFetchContext(await loadPartDocsState(await listCatalog()));
  const results: FetchOutcome[] = [];
  for (const t of batch) results.push(await fetchSlot(ctx, { sku: t.sku.trim(), kind: t.kind }, user.name));
  revalidate();
  return { ok: true, results };
}
```


- [ ] **Step 8: Run the gates**

```bash
npx tsc --noEmit -p .
```

Expected: no output, exit 0.

```bash
env -u DATABASE_URL npm run test:specs > "${TMPDIR:-/tmp}/pd-specs.log" 2>&1; tail -1 "${TMPDIR:-/tmp}/pd-specs.log"; grep '^FAIL' "${TMPDIR:-/tmp}/pd-specs.log"
```

Expected: `ALL PASSED` and no `FAIL` lines. (One pre-existing flake exists — `redeem: tampered code -> not ok`, a random-code test that fails about one run in sixty; if it is the only FAIL, re-run.)

Expected additionally: `grep -c '^PASS part docs fetch' "${TMPDIR:-/tmp}/pd-specs.log"` prints `14`.

```bash
env -u DATABASE_URL npm run test:review:regressions 2>&1 | tail -2
```

Expected: `review regression checks passed` then `quote email regression checks passed`.

```bash
npx eslint 2>&1 | grep problems
```

Expected: `✖ N problems (0 errors, N warnings)` with N ≤ 111 (the baseline is 111; Task 8 removes one).


- [ ] **Step 9: Commit**

```bash
git add src/lib/venue-calendar-fetch.ts src/lib/part-docs/files.ts src/lib/part-docs/fetch.ts src/lib/part-docs/fetch-links.ts 'src/app/(app)/catalog/documents/actions.ts' scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
git commit -m "feat(part-docs): fetch from links through the venue-calendar SSRF guard, one document per URL, batch action" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 6: The Datasheets to-do page (list, filters, slot cells, drop zones, Also covers…, bulk actions)

**Files:**
- Create: `src/lib/part-docs/views.ts` (pure view models; Task 8 appends `partDocsView`)
- Create: `src/lib/part-docs/suggest.ts` (pure)
- Modify: `src/app/(app)/catalog/documents/actions.ts` (imports + `suggestAlsoCoversAction`, `searchDocumentsAction`)
- Create: `src/app/(app)/catalog/documents/upload-client.ts` (browser upload helper)
- Create: `src/app/(app)/catalog/documents/slot-cell.tsx` (`"use client"`)
- Create: `src/app/(app)/catalog/documents/also-covers.tsx` (`"use client"`)
- Create: `src/app/(app)/catalog/documents/documents-client.tsx` (`"use client"`)
- Create: `src/app/(app)/catalog/documents/page.tsx`
- Modify: `src/app/(app)/catalog/page.tsx` (a "Datasheets" header link)
- Test: `scripts/test-review-and-spec.ts` (append a `Task 6` block)

**Interfaces:**
- Consumes: Task 2 (`slotCoverage`, `collapseList`, `coveredLabel`, `DocRef`, `SlotState`, `QuotedPartStat`, `quotedPartStats`, `rankQuotedParts`), Task 3 (`loadPartDocsState`), Task 4 actions, Task 5 `fetchLinksAction` / `FetchOutcome` / `FetchTarget` (type-only in the client), `normalizeSku`, `mfrKey`.
- Produces (`views.ts`, pure): `type PartRef = { sku; desc }`, `type SlotView` (as `SlotCoverage`, with covered `parents: PartRef[]` and link-only `error: string | null`), `toSlotView`, `slotViewFor(index, sku, kind, descOf)`, `viewSatisfied(v)`, `type DocumentRow = { sku; mfr; model; desc; category; quotes; lastQuotedAt; datasheet: SlotView; specsheet: SlotView }`, `type RowPart`, `documentRow(stat, part, index, descOf)`, `type DocumentsShow`, `DOCUMENTS_SHOW`, `type DocumentsFilter`, `parseDocumentsFilter(sp)`, `documentRowMatches(row, f)`, `progressLine(rows, kind)`.
- Produces (`suggest.ts`, pure): `type SuggestPart`, `type Suggestion = { sku; desc; reason: "accessory" | "family" }`, `familyKey`, `commonPrefixLength`, `isSameFamily`, `alsoCoversSuggestions(target, parts, accessorySkus, exclude, limit?)`.
- Produces (actions): `suggestAlsoCoversAction(sku, documentId): Promise<DocActionResult<{ suggestions: Suggestion[] }>>`, `type DocumentHit = { id; title; fileName; kind; hasFile }`, `searchDocumentsAction(q): Promise<DocActionResult<{ hits: DocumentHit[] }>>`.
- Produces (client): `upload-client.ts` → `preflight(file, kind): string | null`, `uploadNewDocument(file, kind, skus): Promise<{ ok: true; documentId } | { ok: false; error }>`, `uploadReplacement(file, documentId, kind)`; `slot-cell.tsx` → default `SlotCell({ sku, kind, view, onUploaded? })` and `docHref(id)`; `also-covers.tsx` → default `AlsoCovers({ sku, documentId, fileName, onDone })`.

- [ ] **Step 1: Write the failing test**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts

/* ======================================================================
   Part documents (#DOC) — Task 6: the to-do list's view models and the
   "Also covers…" suggestions. Pure.
   ====================================================================== */
import {
  documentRow, documentRowMatches, parseDocumentsFilter, progressLine, slotViewFor, viewSatisfied, type DocumentRow,
} from "@/lib/part-docs/views";
import { alsoCoversSuggestions, commonPrefixLength, familyKey, isSameFamily } from "@/lib/part-docs/suggest";

{
  const docs: PdDoc[] = [
    { id: "PD-ownaaaaaaaa", kind: "datasheet", title: "Own", fileName: "own.pdf", contentType: "application/pdf", size: 1, blobKey: "part-docs/PD-ownaaaaaaaa/own.pdf", sourceUrl: null, source: "upload", uploadedAt: 1, uploadedBy: "t", history: [] },
    { id: "PD-failaaaaaaa", kind: "datasheet", title: "Broken", fileName: "b.pdf", contentType: "application/pdf", size: 0, blobKey: null, sourceUrl: "https://x.example/b.pdf", source: "fetch", uploadedAt: 1, uploadedBy: "t", history: [], lastFetch: { at: 9, ok: false, error: "HTTP 404" } },
  ];
  const idx = buildCoverageIndex({
    documents: docs,
    links: [
      { id: "l1", partSku: "FIXV", documentId: "PD-ownaaaaaaaa", kind: "datasheet", createdAt: 1, createdBy: "t" },
      { id: "l2", partSku: "LINKV", documentId: "PD-failaaaaaaa", kind: "datasheet", createdAt: 1, createdBy: "t" },
    ],
    accessoryLinks: [{ id: "a", parentSku: "FIXV", accessorySku: "LENSV", source: "assembly" }],
    parts: [],
  });
  const descOf = (s: string) => ({ FIXV: "Fixture V" } as Record<string, string>)[s] ?? "";
  const covered = slotViewFor(idx, "LENSV", "datasheet", descOf);
  ok(covered.state === "covered" && covered.parents[0].desc === "Fixture V", "part docs views: a covered slot names its parents with descriptions");
  const linkOnly = slotViewFor(idx, "LINKV", "datasheet", descOf);
  ok(linkOnly.state === "link-only" && linkOnly.error === "HTTP 404", "part docs views: a link-only slot carries the last fetch failure");
  ok(viewSatisfied(covered) && !viewSatisfied(linkOnly), "part docs views: satisfied matches the coverage rule");

  const stat = (sku: string, quotes: number) => ({ sku, quotes, lastQuotedAt: 5, grid: 0, bidSpecs: 0 });
  const rows: DocumentRow[] = [
    documentRow(stat("FIXV", 9), { sku: "FIXV", desc: "Fixture V", category: "Lighting", mfr: "ETC", manufacturerModelNumber: "S4V" }, idx, descOf),
    documentRow(stat("LENSV", 4), { sku: "LENSV", desc: "Lens V", category: "Lenses", mfr: "ETC" }, idx, descOf),
    documentRow(stat("LINKV", 2), { sku: "LINKV", desc: "Link V", category: "Lighting", mfr: "Altman" }, idx, descOf),
    documentRow(stat("NONEV", 1), { sku: "NONEV", desc: "None V", category: "Lighting", mfr: "Altman" }, idx, descOf),
  ];
  ok(rows[0].model === "S4V" && rows[0].datasheet.state === "own" && rows[0].specsheet.state === "missing", "part docs views: a row carries both slots");
  const f = (sp: Record<string, string>) => rows.filter((r) => documentRowMatches(r, parseDocumentsFilter(sp))).map((r) => r.sku).join(",");
  ok(f({}) === "FIXV,LENSV,LINKV,NONEV", "part docs views: no filter keeps every quoted part");
  ok(f({ show: "missing-datasheet" }) === "LINKV,NONEV", "part docs views: missing datasheet = link-only or missing");
  ok(f({ show: "link" }) === "LINKV" && f({ show: "covered" }) === "LENSV", "part docs views: link and covered filters");
  ok(f({ mfr: "Altman", q: "none" }) === "NONEV" && f({ cat: "Lenses" }) === "LENSV", "part docs views: manufacturer, category and search compose");
  ok(parseDocumentsFilter({ show: "bogus" }).show === "all", "part docs views: an unknown show falls back to all");
  ok(progressLine(rows, "datasheet") === "2 of 4 quoted parts have a datasheet", "part docs views: the progress line counts satisfied slots");
}

{
  ok(familyKey({ sku: "ETC:S4LED-S3-L", manufacturerModelNumber: "" }) === "S4LEDS3L", "part docs suggest: the family key is the normalized model, else SKU");
  ok(commonPrefixLength("S4LEDS3LUSTR", "S4LEDS3DAYLT") === 7, "part docs suggest: common prefix");
  ok(isSameFamily("S4LEDS3LUSTR", "S4LEDS3DAYLT") && !isSameFamily("S4LED", "S4PAR") && !isSameFamily("ABCDEFGHIJKL", "ABCDEZZZZZZZ"), "part docs suggest: family needs ≥5 shared and at least half the shorter key");
  const parts = [
    { sku: "S4LED-S3-LUSTR", desc: "Lustr", mfr: "ETC" },
    { sku: "S4LED-S3-DAYLT", desc: "Daylight", mfr: "ETC" },
    { sku: "S4LED-S3-TUNGS", desc: "Tungsten", mfr: "E.T.C." },
    { sku: "S4LED-S3-OTHER", desc: "Other brand", mfr: "Altman" },
    { sku: "LENS-19", desc: "19 deg lens", mfr: "ETC" },
    { sku: "S4PAR", desc: "PAR", mfr: "ETC" },
  ];
  const s = alsoCoversSuggestions(parts[0], parts, ["LENS-19", "GHOST"], new Set(["S4LED-S3-TUNGS"]));
  ok(s.map((x) => `${x.sku}:${x.reason}`).join(",") === "LENS-19:accessory,S4LED-S3-DAYLT:family", "part docs suggest: accessories first, then same-manufacturer family; linked, other-brand and unrelated parts are left out");
  ok(alsoCoversSuggestions(parts[0], parts, [], new Set(), 1).length === 1, "part docs suggest: the list is capped");
}
```


- [ ] **Step 2: Run it to verify it fails**

```bash
env -u DATABASE_URL npm run test:specs 2>&1 | grep -m1 -i 'cannot find module'
```

Expected: `Error: Cannot find module '@/lib/part-docs/views'`.


- [ ] **Step 3: Write the view models**

Create `src/lib/part-docs/views.ts`:

```ts
import {
  slotCoverage,
  type CoverageIndex,
  type DocRef,
  type SlotCoverage,
} from "./coverage";
import type { QuotedPartStat } from "./quoted-parts";
import type { PartDocKind } from "./types";

/**
 * Serializable view models for the Datasheets page and the part editor
 * (#DOC). Pure. The server computes these from one CoverageIndex; client
 * components receive only these small objects, never the collections.
 */

export type PartRef = { sku: string; desc: string };

export type SlotView =
  | { state: "own"; docs: DocRef[] }
  | { state: "not-needed" }
  | { state: "covered"; docs: DocRef[]; parents: PartRef[] }
  | { state: "link-only"; docs: DocRef[]; urls: string[]; error: string | null }
  | { state: "missing" };

export function toSlotView(s: SlotCoverage, index: CoverageIndex, descOf: (sku: string) => string): SlotView {
  switch (s.state) {
    case "own":
    case "not-needed":
    case "missing":
      return s;
    case "covered":
      return { state: "covered", docs: s.docs, parents: s.parents.map((sku) => ({ sku, desc: descOf(sku) })) };
    case "link-only": {
      let error: string | null = null;
      let at = -1;
      for (const d of s.docs) {
        const f = index.docsById.get(d.id)?.lastFetch;
        if (f && !f.ok && f.at > at) {
          at = f.at;
          error = f.error || "Fetch failed.";
        }
      }
      return { state: "link-only", docs: s.docs, urls: s.urls, error };
    }
  }
}

export function slotViewFor(index: CoverageIndex, sku: string, kind: PartDocKind, descOf: (sku: string) => string): SlotView {
  return toSlotView(slotCoverage(index, sku, kind), index, descOf);
}

/** The same answer as coverage.slotSatisfied, on a view. */
export function viewSatisfied(v: SlotView): boolean {
  return v.state === "own" || v.state === "not-needed" || v.state === "covered";
}

export type DocumentRow = {
  sku: string;
  mfr: string;
  model: string;
  desc: string;
  category: string;
  quotes: number;
  lastQuotedAt: number | null;
  datasheet: SlotView;
  specsheet: SlotView;
};

export type RowPart = { sku: string; desc: string; category: string; mfr?: string; manufacturerModelNumber?: string; manufacturerPartNumber?: string };

export function documentRow(stat: QuotedPartStat, part: RowPart, index: CoverageIndex, descOf: (sku: string) => string): DocumentRow {
  return {
    sku: part.sku,
    mfr: part.mfr || "",
    model: part.manufacturerModelNumber || part.manufacturerPartNumber || "",
    desc: part.desc,
    category: part.category || "",
    quotes: stat.quotes,
    lastQuotedAt: stat.lastQuotedAt,
    datasheet: slotViewFor(index, part.sku, "datasheet", descOf),
    specsheet: slotViewFor(index, part.sku, "specsheet", descOf),
  };
}

export type DocumentsShow = "all" | "missing-datasheet" | "missing-specsheet" | "link" | "covered";
export const DOCUMENTS_SHOW: Array<{ value: DocumentsShow; label: string }> = [
  { value: "all", label: "All quoted parts" },
  { value: "missing-datasheet", label: "Missing datasheet" },
  { value: "missing-specsheet", label: "Missing spec sheet" },
  { value: "link", label: "Link to fetch" },
  { value: "covered", label: "Covered by a fixture" },
];

export type DocumentsFilter = { show: DocumentsShow; mfr: string; cat: string; q: string };

export function parseDocumentsFilter(sp: Record<string, string | string[] | undefined>): DocumentsFilter {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? "" : v ?? "");
  const show = one(sp.show) as DocumentsShow;
  return {
    show: DOCUMENTS_SHOW.some((s) => s.value === show) ? show : "all",
    mfr: one(sp.mfr).trim(),
    cat: one(sp.cat).trim(),
    q: one(sp.q).trim(),
  };
}

export function documentRowMatches(r: DocumentRow, f: DocumentsFilter): boolean {
  if (f.mfr && r.mfr !== f.mfr) return false;
  if (f.cat && r.category !== f.cat) return false;
  if (f.show === "missing-datasheet" && viewSatisfied(r.datasheet)) return false;
  if (f.show === "missing-specsheet" && viewSatisfied(r.specsheet)) return false;
  if (f.show === "link" && r.datasheet.state !== "link-only" && r.specsheet.state !== "link-only") return false;
  if (f.show === "covered" && r.datasheet.state !== "covered" && r.specsheet.state !== "covered") return false;
  if (f.q) {
    const hay = `${r.sku} ${r.mfr} ${r.model} ${r.desc}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t))) return false;
  }
  return true;
}

/** "412 of 1,180 quoted parts have a datasheet" (spec §3). */
export function progressLine(rows: readonly DocumentRow[], kind: PartDocKind): string {
  const done = rows.filter((r) => viewSatisfied(r[kind])).length;
  const noun = kind === "datasheet" ? "a datasheet" : "a spec sheet";
  return `${done.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} quoted parts have ${noun}`;
}
```


- [ ] **Step 4: Write the Also-covers suggestions**

Create `src/lib/part-docs/suggest.ts`:

```ts
import { mfrKey } from "@/lib/catalog-books";
import { normalizeSku } from "@/lib/davinci/sku";

/**
 * "Also covers…" (#DOC, spec §3): after a file lands on one part, the other
 * parts it probably describes. Pure. Two sources, in this order:
 *  1. the part's accessories from the graph (the fixture datasheet covers
 *     them anyway — attaching makes it explicit), then
 *  2. the same manufacturer's model family: a normalized model number
 *     (MFR M/N, else the SKU) sharing a prefix of at least 5 characters and
 *     half of the shorter one — `S4LEDS3LUSTR` and `S4LEDS3DAYLT`, not
 *     `S4LED` and `S4PAR`.
 */

export type SuggestPart = { sku: string; desc: string; mfr?: string; manufacturerModelNumber?: string };
export type Suggestion = { sku: string; desc: string; reason: "accessory" | "family" };

export function familyKey(p: { sku: string; manufacturerModelNumber?: string }): string {
  return normalizeSku(p.manufacturerModelNumber || p.sku);
}

export function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

export function isSameFamily(a: string, b: string): boolean {
  if (!a || !b) return false;
  const n = commonPrefixLength(a, b);
  return n >= 5 && n >= Math.ceil(0.5 * Math.min(a.length, b.length));
}

export function alsoCoversSuggestions(
  target: SuggestPart,
  parts: readonly SuggestPart[],
  accessorySkus: readonly string[],
  exclude: ReadonlySet<string>,
  limit = 25
): Suggestion[] {
  const out: Suggestion[] = [];
  const taken = new Set<string>([target.sku, ...exclude]);
  const bySku = new Map(parts.map((p) => [p.sku, p]));
  for (const sku of accessorySkus) {
    if (taken.has(sku)) continue;
    const p = bySku.get(sku);
    if (!p) continue;
    taken.add(sku);
    out.push({ sku, desc: p.desc, reason: "accessory" });
  }
  const tMfr = mfrKey(target.mfr);
  const tKey = familyKey(target);
  if (tMfr && tKey) {
    const family: Array<{ p: SuggestPart; n: number }> = [];
    for (const p of parts) {
      if (taken.has(p.sku) || mfrKey(p.mfr) !== tMfr) continue;
      const k = familyKey(p);
      if (isSameFamily(tKey, k)) family.push({ p, n: commonPrefixLength(tKey, k) });
    }
    family.sort((a, b) => b.n - a.n || a.p.sku.localeCompare(b.p.sku));
    for (const { p } of family) out.push({ sku: p.sku, desc: p.desc, reason: "family" });
  }
  return out.slice(0, limit);
}
```


- [ ] **Step 5: Add the suggestion and document-search actions**

In `src/app/(app)/catalog/documents/actions.ts`, replace this exact text (the whole import block):

```ts
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { blobEnabled } from "@/lib/blob";
import { get as getPart, list as listCatalog } from "@/lib/stores/catalog";
import {
  attachDocument,
  createDocument,
  detachDocument,
  getDocument,
  replaceDocumentFile,
} from "@/lib/stores/part-documents";
import { buildFetchContext, fetchSlot, type FetchOutcome, type FetchTarget } from "@/lib/part-docs/fetch-links";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { setDocNotNeeded } from "@/lib/part-docs/not-needed";
import { FETCH_BATCH_SIZE, isDocumentId, isPartDocKind, type PartDocKind } from "@/lib/part-docs/types";
import { verifyUploadedBlob } from "@/lib/part-docs/verify-upload";
```

with:

```ts
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { blobEnabled } from "@/lib/blob";
import { get as getPart, list as listCatalog } from "@/lib/stores/catalog";
import {
  allDocuments,
  attachDocument,
  createDocument,
  detachDocument,
  getDocument,
  replaceDocumentFile,
} from "@/lib/stores/part-documents";
import { buildFetchContext, fetchSlot, type FetchOutcome, type FetchTarget } from "@/lib/part-docs/fetch-links";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { setDocNotNeeded } from "@/lib/part-docs/not-needed";
import { alsoCoversSuggestions, type Suggestion } from "@/lib/part-docs/suggest";
import { FETCH_BATCH_SIZE, isDocumentId, isPartDocKind, type PartDocKind } from "@/lib/part-docs/types";
import { verifyUploadedBlob } from "@/lib/part-docs/verify-upload";
```

Append to the end of `src/app/(app)/catalog/documents/actions.ts`:

```ts

/** "Also covers…" — after `documentId` landed on `sku`, the other parts it
 *  likely describes (the part's accessories, then its model family), minus
 *  the parts already linked to it. */
export async function suggestAlsoCoversAction(sku: string, documentId: string): Promise<DocActionResult<{ suggestions: Suggestion[] }>> {
  await requireUser();
  const parts = await listCatalog();
  const target = parts.find((p) => p.sku === sku);
  if (!target) return { ok: false, error: "That part is no longer in the catalog." };
  const state = await loadPartDocsState(parts);
  const linked = new Set(state.links.filter((l) => l.documentId === documentId).map((l) => l.partSku));
  const suggestions = alsoCoversSuggestions(target, parts, state.index.childrenOf.get(sku) ?? [], linked);
  return { ok: true, suggestions };
}

export type DocumentHit = { id: string; title: string; fileName: string; kind: PartDocKind; hasFile: boolean };

/** Title / file-name search over the shared documents (bulk "Attach an
 *  existing document"). Documents with a stored file first. */
export async function searchDocumentsAction(q: string): Promise<DocActionResult<{ hits: DocumentHit[] }>> {
  await requireUser();
  const tokens = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { ok: true, hits: [] };
  const hits = (await allDocuments())
    .filter((d) => {
      const hay = `${d.title} ${d.fileName}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    })
    .sort((a, b) => Number(!!b.blobKey) - Number(!!a.blobKey) || a.title.localeCompare(b.title))
    .slice(0, 20)
    .map((d) => ({ id: d.id, title: d.title, fileName: d.fileName, kind: d.kind, hasFile: !!d.blobKey }));
  return { ok: true, hits };
}
```


- [ ] **Step 6: Write the browser upload helper**

Imported only by client components. It imports `upload` from `@vercel/blob/client`, pure modules, and server ACTIONS (which are allowed in client code) — never a store or `@/db`.

Create `src/app/(app)/catalog/documents/upload-client.ts`:

```ts
import { upload } from "@vercel/blob/client";
import { contentTypeForFileName } from "@/lib/part-docs/files";
import { MAX_PART_DOC_BYTES, newDocumentId, partDocBlobPath, type PartDocKind } from "@/lib/part-docs/types";
import { attachUploadedDocumentAction, replaceDocumentFileAction } from "./actions";

/**
 * Browser half of a part-document upload (#DOC, spec §6): bytes go straight
 * to private Blob through /api/part-documents/upload, then a server action
 * checks what actually landed and records it. Imported only by client
 * components; everything it imports is client-safe.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Quick refusals before any bytes move. The server re-checks the real bytes. */
export function preflight(file: File, kind: PartDocKind): string | null {
  if (file.size > MAX_PART_DOC_BYTES) return `${file.name} is over 25 MB.`;
  const ok = kind === "datasheet" ? /\.pdf$/i.test(file.name) : /\.(pdf|docx?)$/i.test(file.name);
  if (!ok) return kind === "datasheet" ? `${file.name} is not a PDF.` : `${file.name} is not a PDF or Word file.`;
  return null;
}

async function putFile(file: File, documentId: string): Promise<Result<{ pathname: string }>> {
  try {
    const res = await upload(partDocBlobPath(documentId, file.name), file, {
      access: "private",
      handleUploadUrl: "/api/part-documents/upload",
      clientPayload: JSON.stringify({ documentId }),
      contentType: file.type || contentTypeForFileName(file.name),
      multipart: file.size > 5 * 1024 * 1024,
    });
    return { ok: true, pathname: res.pathname };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return {
      ok: false,
      error: /client token/i.test(msg)
        ? "Upload refused — file storage may not be configured on this deployment."
        : msg || "Upload failed — try again.",
    };
  }
}

/** A new shared document, linked to `skus`. */
export async function uploadNewDocument(file: File, kind: PartDocKind, skus: string[]): Promise<Result<{ documentId: string }>> {
  const refused = preflight(file, kind);
  if (refused) return { ok: false, error: refused };
  const documentId = newDocumentId();
  const put = await putFile(file, documentId);
  if (!put.ok) return put;
  const r = await attachUploadedDocumentAction({ documentId, blobPathname: put.pathname, fileName: file.name, kind, skus });
  return r.ok ? { ok: true, documentId: r.documentId } : r;
}

/** A new file for an existing document — every linked part sees it. */
export async function uploadReplacement(file: File, documentId: string, kind: PartDocKind): Promise<Result> {
  const refused = preflight(file, kind);
  if (refused) return { ok: false, error: refused };
  const put = await putFile(file, documentId);
  if (!put.ok) return put;
  return replaceDocumentFileAction({ documentId, blobPathname: put.pathname, fileName: file.name });
}
```


- [ ] **Step 7: Write the slot cell (shared with the part editor in Task 8)**

Destructive detach goes through `ConfirmButton`, whose `onConfirm` throws on `{ ok: false }` so the button shows the refusal. Every button is `type="button"` (the part editor mounts this inside a `<form>`).

Create `src/app/(app)/catalog/documents/slot-cell.tsx`:

```tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { acceptFor } from "@/lib/part-docs/files";
import { collapseList, coveredLabel } from "@/lib/part-docs/coverage";
import type { SlotView } from "@/lib/part-docs/views";
import type { PartDocKind } from "@/lib/part-docs/types";
import { detachDocumentAction, fetchLinksAction, setNotNeededAction } from "./actions";
import { uploadNewDocument, uploadReplacement } from "./upload-client";

/**
 * One document slot (#DOC, spec §3) — shared by the Datasheets to-do list and
 * the part editor. Shows one of: ✓ file (view · replace · detach), Covered on
 * N fixture datasheets, Link only (Fetch), Not needed, or an empty drop zone.
 * A file dropped on ANY state becomes the part's own document.
 */

const link: React.CSSProperties = { border: "none", background: "none", padding: 0, color: "var(--accent)", fontWeight: 600, fontSize: 11.5, cursor: "pointer", fontFamily: "var(--font-ui)" };
const muted: React.CSSProperties = { fontSize: 11, color: "#8c919c" };

export function docHref(id: string): string {
  return `/api/part-documents/${encodeURIComponent(id)}`;
}

export default function SlotCell({
  sku,
  kind,
  view,
  onUploaded,
}: {
  sku: string;
  kind: PartDocKind;
  view: SlotView;
  /** Called after a NEW document lands (the "Also covers…" step). */
  onUploaded?: (sku: string, documentId: string, fileName: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const replaceFor = useRef<string | null>(null);

  const run = (label: string, fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setError(null);
    setBusy(label);
    startTransition(async () => {
      const r = await fn();
      setBusy(null);
      if (!r.ok) setError(r.error || "That didn't work.");
      else {
        after?.();
        router.refresh();
      }
    });
  };

  const onFile = (file: File) => {
    const target = replaceFor.current;
    replaceFor.current = null;
    if (target) {
      run("Replacing…", () => uploadReplacement(file, target, kind));
      return;
    }
    let newId = "";
    run(
      "Uploading…",
      async () => {
        const r = await uploadNewDocument(file, kind, [sku]);
        if (r.ok) newId = r.documentId;
        return r;
      },
      () => newId && onUploaded?.(sku, newId, file.name)
    );
  };

  const pick = (documentId: string | null) => {
    replaceFor.current = documentId;
    fileRef.current?.click();
  };

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) onFile(f);
    },
  };

  const body = (() => {
    switch (view.state) {
      case "own":
        return (
          <div style={{ display: "grid", gap: 3 }}>
            {view.docs.map((d) => (
              <div key={d.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <a href={docHref(d.id)} target="_blank" rel="noopener noreferrer" title={d.fileName} style={{ fontSize: 12, color: "#1f7a52", fontWeight: 600, textDecoration: "none", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  ✓ {d.title}
                </a>
                <button type="button" style={link} disabled={!!busy} onClick={() => pick(d.id)}>
                  Replace
                </button>
                <ConfirmButton
                  label="Detach"
                  confirmLabel="Detach from this part?"
                  pendingLabel="Detaching…"
                  className="pk-btn-outline"
                  style={{ fontSize: 11, padding: "2px 8px" }}
                  onConfirm={async () => {
                    const r = await detachDocumentAction(d.id, sku);
                    if (!r.ok) throw new Error(r.error);
                    router.refresh();
                  }}
                />
              </div>
            ))}
          </div>
        );
      case "covered": {
        const { shown, more } = collapseList(view.parents);
        return (
          <div>
            <button type="button" style={{ ...link, color: "#3a5fb4" }} onClick={() => setOpen((o) => !o)}>
              {coveredLabel(view.docs.length, kind)}
            </button>
            {open && (
              <div style={{ marginTop: 4, display: "grid", gap: 2 }}>
                {(open ? view.parents : shown).map((p) => (
                  <span key={p.sku} style={muted}>
                    on <b style={{ color: "#3d424e" }}>{p.sku}</b> {p.desc}
                  </span>
                ))}
                {view.docs.map((d) => (
                  <a key={d.id} href={docHref(d.id)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--accent)" }}>
                    {d.title}
                  </a>
                ))}
              </div>
            )}
            {!open && more > 0 && <span style={muted}> · {shown.map((p) => p.sku).join(", ")} +{more} more</span>}
          </div>
        );
      }
      case "link-only":
        return (
          <div style={{ display: "grid", gap: 3 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <a href={view.docs[0] ? docHref(view.docs[0].id) : view.urls[0]} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#9a6b12", fontWeight: 600, textDecoration: "none" }}>
                Link only
              </a>
              <button type="button" style={link} disabled={!!busy} onClick={() => run("Fetching…", async () => {
                const r = await fetchLinksAction([{ sku, kind }]);
                if (!r.ok) return r;
                const res = r.results[0];
                return res && !res.ok ? { ok: false, error: res.error } : { ok: true };
              })}>
                Fetch
              </button>
            </div>
            {view.error && <span style={{ fontSize: 11, color: "#b4543a" }}>Last fetch: {view.error}</span>}
          </div>
        );
      case "not-needed":
        return (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={muted}>Not needed</span>
            <button type="button" style={link} disabled={!!busy} onClick={() => run("Saving…", () => setNotNeededAction([sku], kind, false))}>
              Undo
            </button>
          </div>
        );
      case "missing":
        return (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={() => pick(null)} disabled={!!busy} style={{ border: "1px dashed #c9cdd5", borderRadius: 7, background: over ? "#f4f6fb" : "#fff", color: "#6b7079", fontSize: 11.5, padding: "5px 10px", cursor: "pointer" }}>
              Drop file or click
            </button>
            <button type="button" style={{ ...link, color: "#8c919c", fontWeight: 500 }} disabled={!!busy} onClick={() => run("Saving…", () => setNotNeededAction([sku], kind, true))}>
              Not needed
            </button>
          </div>
        );
    }
  })();

  return (
    <div {...dropProps} style={{ minWidth: 0, borderRadius: 8, outline: over ? "2px dashed var(--accent)" : "none", outlineOffset: 2, padding: 2 }}>
      <input
        ref={fileRef}
        type="file"
        accept={acceptFor(kind)}
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
      {busy ? <span style={muted}>{busy}</span> : body}
      {view.state !== "missing" && view.state !== "own" && !busy && (
        <button type="button" style={{ ...link, fontWeight: 500, color: "#8c919c", marginTop: 3 }} onClick={() => pick(null)}>
          Upload own file
        </button>
      )}
      {error && <div role="alert" style={{ marginTop: 3, fontSize: 11, color: "#b4543a" }}>{error}</div>}
    </div>
  );
}
```


- [ ] **Step 8: Write the Also-covers step**

Create `src/app/(app)/catalog/documents/also-covers.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Suggestion } from "@/lib/part-docs/suggest";
import { attachExistingDocumentAction, suggestAlsoCoversAction } from "./actions";

/**
 * The "Also covers…" step (#DOC, spec §3): right after a file lands on one
 * part, offer the parts it likely also describes — the part's accessories
 * first (pre-ticked), then its model family (unticked). Confirm attaches the
 * same shared document to the ticked parts.
 */
export default function AlsoCovers({
  sku,
  documentId,
  fileName,
  onDone,
}: {
  sku: string;
  documentId: string;
  fileName: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    suggestAlsoCoversAction(sku, documentId).then((r) => {
      if (!live) return;
      if (!r.ok) {
        setError(r.error);
        setItems([]);
        return;
      }
      setItems(r.suggestions);
      setPicked(new Set(r.suggestions.filter((s) => s.reason === "accessory").map((s) => s.sku)));
    });
    return () => {
      live = false;
    };
  }, [sku, documentId]);

  const toggle = (s: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const confirm = async () => {
    setBusy(true);
    const r = await attachExistingDocumentAction(documentId, [...picked]);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.refresh();
    onDone();
  };

  return (
    <div className="pk-card" style={{ padding: 14, marginBottom: 14, borderColor: "var(--accent)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 650 }}>
          Also covers… <span style={{ fontWeight: 400, color: "#8c919c" }}>{fileName} is on {sku}. Tick the other parts it describes.</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="pk-btn-outline" onClick={onDone}>Done</button>
          <button type="button" className="pk-btn-accent" disabled={busy || !picked.size} onClick={confirm}>
            {busy ? "Attaching…" : `Attach to ${picked.size} part${picked.size === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
      {items === null && <div style={{ marginTop: 8, fontSize: 12, color: "#8c919c" }}>Looking for related parts…</div>}
      {items && !items.length && !error && <div style={{ marginTop: 8, fontSize: 12, color: "#8c919c" }}>No related parts found — attach more from the list below.</div>}
      {!!items?.length && (
        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 6 }}>
          {items.map((s) => (
            <label key={s.sku} style={{ display: "flex", gap: 7, alignItems: "baseline", fontSize: 12, cursor: "pointer" }}>
              <input type="checkbox" checked={picked.has(s.sku)} onChange={() => toggle(s.sku)} />
              <span style={{ minWidth: 0 }}>
                <b>{s.sku}</b> <span style={{ color: "#6b7079" }}>{s.desc}</span>
                <span style={{ marginLeft: 6, fontSize: 10.5, color: s.reason === "accessory" ? "#3a5fb4" : "#8c919c" }}>
                  {s.reason === "accessory" ? "accessory" : "same family"}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
      {error && <div role="alert" style={{ marginTop: 8, fontSize: 12, color: "#b4543a" }}>{error}</div>}
    </div>
  );
}
```


- [ ] **Step 9: Write the table with bulk actions**

Fetch links loops over the selection in `FETCH_BATCH_SIZE` chunks and lists failures with their reasons; each chunk persists as it goes, so an interrupted run resumes on the next click.

Create `src/app/(app)/catalog/documents/documents-client.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dateYear } from "@/lib/format";
import { FETCH_BATCH_SIZE, PART_DOC_KINDS, PART_DOC_KIND_LABEL, type PartDocKind } from "@/lib/part-docs/types";
import type { DocumentRow } from "@/lib/part-docs/views";
import type { FetchOutcome, FetchTarget } from "@/lib/part-docs/fetch-links";
import AlsoCovers from "./also-covers";
import SlotCell from "./slot-cell";
import {
  attachExistingDocumentAction,
  fetchLinksAction,
  searchDocumentsAction,
  setNotNeededAction,
  type DocumentHit,
} from "./actions";

/**
 * The Datasheets to-do table (#DOC, spec §3): one row per quoted part,
 * most-quoted first, two slot cells, multi-select with bulk actions.
 */

const TH: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: "#aab0bb", textTransform: "uppercase", letterSpacing: ".04em", textAlign: "left", padding: "8px 8px" };
const TD: React.CSSProperties = { fontSize: 12.5, color: "#3a3f4a", padding: "9px 8px", verticalAlign: "top", borderTop: "1px solid #f0f1f4" };

export default function DocumentsClient({ rows }: { rows: DocumentRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [justUploaded, setJustUploaded] = useState<{ sku: string; documentId: string; fileName: string } | null>(null);
  const [bulkKind, setBulkKind] = useState<PartDocKind>("datasheet");
  const [progress, setProgress] = useState<string | null>(null);
  const [failures, setFailures] = useState<FetchOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [docQuery, setDocQuery] = useState("");
  const [docHits, setDocHits] = useState<DocumentHit[]>([]);

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.sku));
  const toggle = (sku: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  const picked = rows.filter((r) => selected.has(r.sku));

  const fetchSelected = async () => {
    const targets: FetchTarget[] = [];
    for (const r of picked) for (const k of PART_DOC_KINDS) if (r[k].state === "link-only") targets.push({ sku: r.sku, kind: k });
    if (!targets.length) {
      setError("None of the selected parts has a link to fetch.");
      return;
    }
    setError(null);
    setFailures([]);
    const failed: FetchOutcome[] = [];
    let done = 0;
    for (let i = 0; i < targets.length; i += FETCH_BATCH_SIZE) {
      setProgress(`Fetching ${Math.min(done + FETCH_BATCH_SIZE, targets.length)} of ${targets.length}…`);
      const r = await fetchLinksAction(targets.slice(i, i + FETCH_BATCH_SIZE));
      if (!r.ok) {
        setError(r.error);
        break;
      }
      done += r.results.length;
      failed.push(...r.results.filter((x) => !x.ok));
    }
    setProgress(`Fetched ${done - failed.length} of ${targets.length}${failed.length ? ` · ${failed.length} failed` : ""}.`);
    setFailures(failed);
    router.refresh();
  };

  const markNotNeeded = async () => {
    setError(null);
    const r = await setNotNeededAction(picked.map((p) => p.sku), bulkKind, true);
    if (!r.ok) setError(r.error);
    else {
      setProgress(`${r.changed} part${r.changed === 1 ? "" : "s"} marked ${PART_DOC_KIND_LABEL[bulkKind].toLowerCase()} not needed.`);
      router.refresh();
    }
  };

  const searchDocs = async (q: string) => {
    setDocQuery(q);
    if (q.trim().length < 2) {
      setDocHits([]);
      return;
    }
    const r = await searchDocumentsAction(q);
    if (r.ok) setDocHits(r.hits);
  };

  const attachExisting = async (hit: DocumentHit) => {
    setError(null);
    const r = await attachExistingDocumentAction(hit.id, picked.map((p) => p.sku));
    if (!r.ok) setError(r.error);
    else {
      setProgress(`${hit.title} attached to ${r.linked} part${r.linked === 1 ? "" : "s"}.`);
      setDocQuery("");
      setDocHits([]);
      router.refresh();
    }
  };

  return (
    <div>
      {justUploaded && <AlsoCovers {...justUploaded} onDone={() => setJustUploaded(null)} />}

      {picked.length > 0 && (
        <div className="pk-card" style={{ padding: 12, marginBottom: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", position: "sticky", top: 8, zIndex: 5 }}>
          <b style={{ fontSize: 12.5 }}>{picked.length} selected</b>
          <button type="button" className="pk-btn-outline" onClick={fetchSelected}>Fetch links</button>
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <select aria-label="Kind to mark" value={bulkKind} onChange={(e) => setBulkKind(e.target.value as PartDocKind)} style={{ fontSize: 12, padding: "5px 8px", borderRadius: 7, border: "1px solid #dfe2e8" }}>
              {PART_DOC_KINDS.map((k) => <option key={k} value={k}>{PART_DOC_KIND_LABEL[k]}</option>)}
            </select>
            <button type="button" className="pk-btn-outline" onClick={markNotNeeded}>Mark not needed</button>
          </span>
          <span style={{ position: "relative" }}>
            <input
              aria-label="Attach an existing document"
              placeholder="Attach an existing document…"
              value={docQuery}
              onChange={(e) => searchDocs(e.target.value)}
              style={{ fontSize: 12, padding: "6px 9px", borderRadius: 7, border: "1px solid #dfe2e8", minWidth: 240 }}
            />
            {!!docHits.length && (
              <div className="pk-card" style={{ position: "absolute", top: "110%", left: 0, zIndex: 10, minWidth: 320, padding: 4 }}>
                {docHits.map((h) => (
                  <button key={h.id} type="button" onClick={() => attachExisting(h)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "none", padding: "6px 8px", fontSize: 12, cursor: "pointer" }}>
                    <b>{h.title}</b> <span style={{ color: "#8c919c" }}>{PART_DOC_KIND_LABEL[h.kind]}{h.hasFile ? "" : " · link only"}</span>
                  </button>
                ))}
              </div>
            )}
          </span>
          <button type="button" className="pk-btn-outline" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {progress && <div style={{ fontSize: 12, color: "#1f7a52", marginBottom: 8 }}>{progress}</div>}
      {error && <div role="alert" style={{ fontSize: 12, color: "#b4543a", marginBottom: 8 }}>{error}</div>}
      {!!failures.length && (
        <div className="pk-card" style={{ padding: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 650, marginBottom: 4 }}>Could not fetch</div>
          {failures.map((f) => (
            <div key={`${f.sku}-${f.kind}`} style={{ fontSize: 11.5, color: "#5b616e" }}>
              <b>{f.sku}</b> · {PART_DOC_KIND_LABEL[f.kind]} — {f.error}
            </div>
          ))}
        </div>
      )}

      <div className="pk-card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
          <thead>
            <tr>
              <th style={{ ...TH, width: 28 }}>
                <input
                  type="checkbox"
                  aria-label="Select every row on this page"
                  checked={allOnPage}
                  onChange={() => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.sku)))}
                />
              </th>
              <th style={TH}>Part</th>
              <th style={{ ...TH, textAlign: "right" }}>Quoted</th>
              <th style={TH}>Last quoted</th>
              <th style={TH}>Datasheet</th>
              <th style={TH}>Spec sheet</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sku}>
                <td style={TD}>
                  <input type="checkbox" aria-label={`Select ${r.sku}`} checked={selected.has(r.sku)} onChange={() => toggle(r.sku)} />
                </td>
                <td style={{ ...TD, maxWidth: 320 }}>
                  <a href={`/catalog?edit=${encodeURIComponent(r.sku)}`} style={{ fontWeight: 650, color: "#16181d", textDecoration: "none" }}>{r.sku}</a>
                  <div style={{ fontSize: 11.5, color: "#6b7079" }}>{[r.mfr, r.model].filter(Boolean).join(" · ")}</div>
                  <div style={{ fontSize: 11.5, color: "#8c919c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.desc}</div>
                </td>
                <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.quotes}</td>
                <td style={{ ...TD, whiteSpace: "nowrap", color: "#8c919c" }}>{r.lastQuotedAt ? dateYear(r.lastQuotedAt) : "—"}</td>
                {PART_DOC_KINDS.map((k) => (
                  <td key={k} style={{ ...TD, minWidth: 200 }}>
                    <SlotCell sku={r.sku} kind={k} view={r[k]} onUploaded={(sku, documentId, fileName) => setJustUploaded({ sku, documentId, fileName })} />
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} style={{ ...TD, textAlign: "center", color: "#8c919c", padding: 28 }}>Nothing matches these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```


- [ ] **Step 10: Write the page**

One load of every collection per request (catalog, quotes, Grid projects, bid specs, then `loadPartDocsState` with the catalog already in hand — which also runs the idempotent legacy backfill on first read, spec §5). Rows exclude `Labor`-category parts. The **Upload many** link targets Task 7's route.

Create `src/app/(app)/catalog/documents/page.tsx`:

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { blobEnabled } from "@/lib/blob";
import { list as listCatalog } from "@/lib/stores/catalog";
import { getAll as allQuotes } from "@/lib/stores/quotes";
import { listProjects } from "@/lib/stores/grid-projects";
import { allGeneratedSpecs } from "@/lib/stores/generated-specs";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { quotedPartStats, rankQuotedParts } from "@/lib/part-docs/quoted-parts";
import {
  DOCUMENTS_SHOW,
  documentRow,
  documentRowMatches,
  parseDocumentsFilter,
  progressLine,
  type DocumentRow,
} from "@/lib/part-docs/views";
import DocumentsClient from "./documents-client";

export const metadata = { title: "Datasheets — Quartzite-6" };
export const dynamic = "force-dynamic";
// Batch fetch runs through this route's server actions — up to
// FETCH_BATCH_SIZE downloads of up to 30 s each per call.
export const maxDuration = 300;

/** Rows rendered per page — production quotes over a thousand distinct parts. */
const PAGE = 200;

/**
 * Catalog → Datasheets (#DOC, spec §3): the to-do list. Every part Peak has
 * ever quoted (any quote status, any Grid placement, any bid spec), most
 * quoted first, with a Datasheet and a Spec sheet slot each. One load of
 * every collection per request; everything below is single-pass Maps.
 */
export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [, sp] = await Promise.all([requireUser(), searchParams]);
  const [parts, quotes, gridProjects, generated] = await Promise.all([listCatalog(), allQuotes(), listProjects(), allGeneratedSpecs()]);
  const state = await loadPartDocsState(parts);

  const bySku = new Map(parts.map((p) => [p.sku, p]));
  // Labor rows are rates, not products — they never take a datasheet.
  const stats = quotedPartStats({ quotes, gridProjects, generated }, (sku) => {
    const p = bySku.get(sku);
    return !!p && p.category !== "Labor";
  });
  const descOf = (sku: string) => bySku.get(sku)?.desc ?? "";
  const all: DocumentRow[] = rankQuotedParts(stats.values()).map((s) => documentRow(s, bySku.get(s.sku)!, state.index, descOf));

  const filter = parseDocumentsFilter(sp);
  const filtered = all.filter((r) => documentRowMatches(r, filter));
  const pageRaw = Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const page = Math.min(Math.max(1, Math.floor(pageRaw)), pages);
  const visible = filtered.slice((page - 1) * PAGE, page * PAGE);

  const mfrs = [...new Set(all.map((r) => r.mfr).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const cats = [...new Set(all.map((r) => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const hrefFor = (over: Record<string, string>) => {
    const qs = new URLSearchParams();
    const merged = { show: filter.show, mfr: filter.mfr, cat: filter.cat, q: filter.q, ...over };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "show" && v === "all")) qs.set(k, v);
    const s = qs.toString();
    return "/catalog/documents" + (s ? `?${s}` : "");
  };
  const select: React.CSSProperties = { fontSize: 12.5, padding: "7px 9px", borderRadius: 8, border: "1px solid #dfe2e8", background: "#fff" };

  return (
    <div className="pk-content" style={{ maxWidth: 1240 }}>
      <Link href="/catalog" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← Catalog</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", margin: "7px 0 14px" }}>
        <div>
          <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", margin: 0 }}>Datasheets</h1>
          <p style={{ color: "#8c919c", fontSize: 13, margin: "5px 0 0", maxWidth: 720 }}>
            Every part Peak has quoted, most-quoted first. Drop a PDF on a cell to attach it; accessories ride on their fixture&apos;s datasheet.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/catalog/documents/upload" className="pk-btn-accent" style={{ textDecoration: "none" }}>Upload many</Link>
        </div>
      </div>

      {!blobEnabled() && (
        <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 10, background: "#fdf3df", border: "1px solid #f3e0b5", color: "#9a6b12", fontSize: 12.5 }}>
          File storage isn&apos;t configured on this deployment (no BLOB_READ_WRITE_TOKEN) — uploads and fetches will be refused.
        </div>
      )}

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
        <span>{progressLine(all, "datasheet")}</span>
        <span style={{ color: "#6b7079" }}>{progressLine(all, "specsheet")}</span>
      </div>

      <form method="get" action="/catalog/documents" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <select name="show" defaultValue={filter.show} aria-label="Show" style={select}>
          {DOCUMENTS_SHOW.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select name="mfr" defaultValue={filter.mfr} aria-label="Manufacturer" style={select}>
          <option value="">All manufacturers</option>
          {mfrs.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select name="cat" defaultValue={filter.cat} aria-label="Category" style={select}>
          <option value="">All categories</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input name="q" defaultValue={filter.q} placeholder="Search SKU, model, description" aria-label="Search" style={{ ...select, minWidth: 240 }} />
        <button type="submit" className="pk-btn-outline">Apply</button>
        {(filter.show !== "all" || filter.mfr || filter.cat || filter.q) && (
          <Link href="/catalog/documents" style={{ fontSize: 12.5, color: "#8c919c", alignSelf: "center" }}>Clear</Link>
        )}
      </form>

      <div style={{ fontSize: 12, color: "#8c919c", marginBottom: 8 }}>
        {filtered.length.toLocaleString("en-US")} of {all.length.toLocaleString("en-US")} quoted parts
        {pages > 1 ? ` · page ${page} of ${pages}` : ""}
      </div>

      <DocumentsClient rows={visible} />

      {pages > 1 && (
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14, fontSize: 12.5 }}>
          {page > 1 && <Link href={hrefFor({ page: String(page - 1) })}>← Previous</Link>}
          {page < pages && <Link href={hrefFor({ page: String(page + 1) })}>Next →</Link>}
        </div>
      )}
    </div>
  );
}
```


- [ ] **Step 11: Link it from the Catalog header**

In `src/app/(app)/catalog/page.tsx`, replace this exact text:

```tsx
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <Link
            href="/catalog?new=1"
```

with:

```tsx
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          {/* Part documents (#DOC) — the datasheet / spec-sheet to-do list. */}
          <Link
            href="/catalog/documents"
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
            Datasheets
          </Link>
          <Link
            href="/catalog?new=1"
```


- [ ] **Step 12: Run the gates (this task touches client files, so the build too)**

```bash
npx tsc --noEmit -p .
```

Expected: no output, exit 0.

```bash
env -u DATABASE_URL npm run test:specs > "${TMPDIR:-/tmp}/pd-specs.log" 2>&1; tail -1 "${TMPDIR:-/tmp}/pd-specs.log"; grep '^FAIL' "${TMPDIR:-/tmp}/pd-specs.log"
```

Expected: `ALL PASSED` and no `FAIL` lines. (One pre-existing flake exists — `redeem: tampered code -> not ok`, a random-code test that fails about one run in sixty; if it is the only FAIL, re-run.)

Expected additionally: `grep -cE '^PASS part docs (views|suggest)' "${TMPDIR:-/tmp}/pd-specs.log"` prints `15`.

```bash
npx eslint 2>&1 | grep problems
```

Expected: `✖ N problems (0 errors, N warnings)` with N ≤ 111 (the baseline is 111; Task 8 removes one).

```bash
env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build > "${TMPDIR:-/tmp}/pd-build.log" 2>&1; echo "build exit: $?"; tail -3 "${TMPDIR:-/tmp}/pd-build.log"; rm -rf .next
```

Expected: `build exit: 0`, the route table's legend (`ƒ  (Dynamic)  server-rendered on demand`) in the tail, and `.next` removed afterwards. A client component that imports a store or `@/db` value fails here, not in tsc.


- [ ] **Step 13: Commit**

```bash
git add src/lib/part-docs/views.ts src/lib/part-docs/suggest.ts 'src/app/(app)/catalog/documents' 'src/app/(app)/catalog/page.tsx' scripts/test-review-and-spec.ts
git commit -m "feat(part-docs): Catalog → Datasheets to-do list with slot cells, drop zones, Also covers… and bulk actions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 7: Bulk drop — filename matching review and confirm

**Files:**
- Modify: `src/lib/part-docs/filename-match.ts` (append `matchFileRows`)
- Modify: `src/app/(app)/catalog/documents/actions.ts` (imports + `matchFilesAction`, `searchPartsAction`)
- Create: `src/app/(app)/catalog/documents/upload/page.tsx`
- Create: `src/app/(app)/catalog/documents/upload/bulk-drop.tsx` (`"use client"`)
- Test: `scripts/test-review-and-spec.ts` (append a `Task 7` block)

**Interfaces:**
- Consumes: Task 2 `buildFilenameIndex`/`matchFileName`/`guessKind`/`FilenameMatch`, Task 6 `preflight`/`uploadNewDocument`, `searchDocs` from `src/db/doc-store.ts` (server action only).
- Produces (`filename-match.ts`): `matchFileRows(fileNames: readonly string[], parts: readonly MatchablePart[]): Array<{ fileName; kind: PartDocKind; confidence; skus: string[] }>`.
- Produces (actions): `type PartHit = { sku; desc; mfr }`, `type FileMatchRow = { fileName; kind; confidence; parts: PartHit[] }`, `matchFilesAction(fileNames: string[]): Promise<DocActionResult<{ rows: FileMatchRow[] }>>` (≤ 500 names; only names cross the wire), `searchPartsAction(q): Promise<DocActionResult<{ hits: PartHit[] }>>`.
- Produces route: `/catalog/documents/upload`.

- [ ] **Step 1: Write the failing test**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts

/* --- Part documents (#DOC) — Task 7: bulk-drop review rows --- */
import { matchFileRows } from "@/lib/part-docs/filename-match";
{
  const rows = matchFileRows(
    ["ColorSource PAR Datasheet.pdf", "CSPAR guide spec.docx", "random.pdf"],
    [{ sku: "ETC:CSPAR", manufacturerModelNumber: "ColorSource PAR" }]
  );
  ok(rows.map((r) => `${r.confidence}:${r.kind}:${r.skus.join("|")}`).join(",") === "high:datasheet:ETC:CSPAR,high:specsheet:ETC:CSPAR,none:datasheet:", "part docs bulk: one review row per file, in order, with kind and matched SKUs");
}
```


- [ ] **Step 2: Run it to verify it fails**

```bash
npx tsc --noEmit -p . 2>&1 | head -2
```

Expected: `error TS2305: Module '"@/lib/part-docs/filename-match"' has no exported member 'matchFileRows'.`


- [ ] **Step 3: Add the review-row builder**

Append to the end of `src/lib/part-docs/filename-match.ts`:

```ts

/** Bulk-drop review rows (spec §3): one per file, in order. */
export function matchFileRows(
  fileNames: readonly string[],
  parts: readonly MatchablePart[]
): Array<{ fileName: string; kind: PartDocKind; confidence: FilenameMatch["confidence"]; skus: string[] }> {
  const index = buildFilenameIndex(parts);
  return fileNames.map((fileName) => {
    const m = matchFileName(fileName, index);
    return { fileName, kind: guessKind(fileName), confidence: m.confidence, skus: m.skus };
  });
}
```


- [ ] **Step 4: Add the match and part-search actions**

In `src/app/(app)/catalog/documents/actions.ts`, replace this exact text (the whole import block):

```ts
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { blobEnabled } from "@/lib/blob";
import { get as getPart, list as listCatalog } from "@/lib/stores/catalog";
import {
  allDocuments,
  attachDocument,
  createDocument,
  detachDocument,
  getDocument,
  replaceDocumentFile,
} from "@/lib/stores/part-documents";
import { buildFetchContext, fetchSlot, type FetchOutcome, type FetchTarget } from "@/lib/part-docs/fetch-links";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { setDocNotNeeded } from "@/lib/part-docs/not-needed";
import { alsoCoversSuggestions, type Suggestion } from "@/lib/part-docs/suggest";
import { FETCH_BATCH_SIZE, isDocumentId, isPartDocKind, type PartDocKind } from "@/lib/part-docs/types";
import { verifyUploadedBlob } from "@/lib/part-docs/verify-upload";
```

with:

```ts
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { blobEnabled } from "@/lib/blob";
import { searchDocs } from "@/db/doc-store";
import { get as getPart, list as listCatalog, type CatalogPart } from "@/lib/stores/catalog";
import {
  allDocuments,
  attachDocument,
  createDocument,
  detachDocument,
  getDocument,
  replaceDocumentFile,
} from "@/lib/stores/part-documents";
import { buildFetchContext, fetchSlot, type FetchOutcome, type FetchTarget } from "@/lib/part-docs/fetch-links";
import { matchFileRows, type FilenameMatch } from "@/lib/part-docs/filename-match";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { setDocNotNeeded } from "@/lib/part-docs/not-needed";
import { alsoCoversSuggestions, type Suggestion } from "@/lib/part-docs/suggest";
import { FETCH_BATCH_SIZE, isDocumentId, isPartDocKind, type PartDocKind } from "@/lib/part-docs/types";
import { verifyUploadedBlob } from "@/lib/part-docs/verify-upload";
```

Append to the end of `src/app/(app)/catalog/documents/actions.ts`:

```ts

export type PartHit = { sku: string; desc: string; mfr: string };
export type FileMatchRow = { fileName: string; kind: PartDocKind; confidence: FilenameMatch["confidence"]; parts: PartHit[] };

const MAX_FILES_PER_MATCH = 500;
const hitOf = (p: Pick<CatalogPart, "sku" | "desc" | "mfr">): PartHit => ({ sku: p.sku, desc: p.desc, mfr: p.mfr || "" });

/** Bulk drop: match each file name to catalog part(s) by SKU / MFR P/N / MFR
 *  M/N (longest match wins) and guess its kind. Only names cross the wire —
 *  the catalog never ships to the browser. */
export async function matchFilesAction(fileNames: string[]): Promise<DocActionResult<{ rows: FileMatchRow[] }>> {
  await requireUser();
  const names = (fileNames || []).map((n) => String(n || "")).filter(Boolean).slice(0, MAX_FILES_PER_MATCH);
  const parts = await listCatalog();
  const bySku = new Map(parts.map((p) => [p.sku, p]));
  const rows = matchFileRows(names, parts).map(({ skus, ...m }) => ({ ...m, parts: skus.map((s) => hitOf(bySku.get(s)!)) }));
  return { ok: true, rows };
}

/** Part search for an unmatched or ambiguous bulk-drop row. SQL-side
 *  candidate filter (never materializes the catalog), then a token match. */
export async function searchPartsAction(q: string): Promise<DocActionResult<{ hits: PartHit[] }>> {
  await requireUser();
  const query = String(q || "").trim();
  if (query.length < 2) return { ok: true, hits: [] };
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const candidates = await searchDocs<CatalogPart>("catalog_parts", tokens[0], 200);
  const hits = candidates
    .filter((p) => {
      const hay = `${p.sku} ${p.desc} ${p.mfr || ""} ${p.manufacturerPartNumber || ""} ${p.manufacturerModelNumber || ""}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    })
    .slice(0, 20)
    .map(hitOf);
  return { ok: true, hits };
}
```


- [ ] **Step 5: Write the bulk-drop page**

Create `src/app/(app)/catalog/documents/upload/page.tsx`:

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { blobEnabled } from "@/lib/blob";
import BulkDrop from "./bulk-drop";

export const metadata = { title: "Upload datasheets — Quartzite-6" };

/** Bulk drop (#DOC, spec §3): drop a folder, review the matches, confirm. */
export default async function BulkUploadPage() {
  await requireUser();
  return (
    <div className="pk-content" style={{ maxWidth: 1100 }}>
      <Link href="/catalog/documents" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← Datasheets</Link>
      <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", margin: "7px 0 4px" }}>Upload many</h1>
      <p style={{ color: "#8c919c", fontSize: 13, margin: "0 0 16px", maxWidth: 720 }}>
        Drop a folder of PDFs and Word files. Each is matched to parts by the model number, MFR P/N or SKU in its file
        name; names with spec, guide or specification (and Word files) are filed as spec sheets. Review, fix any row, then confirm.
      </p>
      {!blobEnabled() && (
        <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 10, background: "#fdf3df", border: "1px solid #f3e0b5", color: "#9a6b12", fontSize: 12.5 }}>
          File storage isn&apos;t configured on this deployment (no BLOB_READ_WRITE_TOKEN) — uploads will be refused.
        </div>
      )}
      <BulkDrop />
    </div>
  );
}
```


- [ ] **Step 6: Write the bulk-drop client**

Files stay in the browser: only names go to `matchFilesAction`; a folder drop is walked with the entries API; Confirm uploads each file straight to Blob with `uploadNewDocument` (Task 6) and attaches it to the ticked parts. A row with no part is skipped and says so.

Create `src/app/(app)/catalog/documents/upload/bulk-drop.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { PART_DOC_KINDS, PART_DOC_KIND_LABEL, type PartDocKind } from "@/lib/part-docs/types";
import { matchFilesAction, searchPartsAction, type FileMatchRow, type PartHit } from "../actions";
import { preflight, uploadNewDocument } from "../upload-client";

/**
 * Bulk drop (#DOC, spec §3). Files stay in the browser; only their names go
 * to the server for matching. The review table shows file → matched part(s)
 * + kind with confidence; an unmatched or ambiguous row gets a part search.
 * Confirm uploads each file straight to Blob and attaches it.
 */

type Row = FileMatchRow & {
  key: string;
  file: File;
  picked: Set<string>;
  status: "pending" | "uploading" | "done" | "skipped" | "failed";
  message?: string;
};

const DOC_FILE = /\.(pdf|docx?)$/i;

/** Every file under a dropped folder (Chrome/Safari/Firefox entries API). */
async function filesFromEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) => (entry as FileSystemFileEntry).file((f) => resolve([f]), () => resolve([])));
  }
  if (!entry.isDirectory) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
    if (!batch.length) break;
    all.push(...batch);
  }
  return (await Promise.all(all.map(filesFromEntry))).flat();
}

async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (entries.length) return (await Promise.all(entries.map(filesFromEntry))).flat();
  return [...dt.files];
}

function PartSearch({ onPick }: { onPick: (hit: PartHit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PartHit[]>([]);
  const search = async (v: string) => {
    setQ(v);
    if (v.trim().length < 2) return setHits([]);
    const r = await searchPartsAction(v);
    if (r.ok) setHits(r.hits);
  };
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <input value={q} onChange={(e) => search(e.target.value)} placeholder="Find a part…" aria-label="Find a part" style={{ fontSize: 12, padding: "5px 8px", borderRadius: 7, border: "1px solid #dfe2e8", width: 200 }} />
      {!!hits.length && (
        <div className="pk-card" style={{ position: "absolute", top: "110%", left: 0, zIndex: 10, minWidth: 320, padding: 4 }}>
          {hits.map((h) => (
            <button key={h.sku} type="button" onClick={() => { onPick(h); setQ(""); setHits([]); }} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "none", padding: "5px 8px", fontSize: 12, cursor: "pointer" }}>
              <b>{h.sku}</b> <span style={{ color: "#6b7079" }}>{h.desc}</span> <span style={{ color: "#8c919c" }}>{h.mfr}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export default function BulkDrop() {
  const [rows, setRows] = useState<Row[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patch = (key: string, change: Partial<Row>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));

  const addFiles = async (files: File[]) => {
    setError(null);
    const docs = files.filter((f) => DOC_FILE.test(f.name));
    setIgnored(files.filter((f) => !DOC_FILE.test(f.name)).map((f) => f.name));
    if (!docs.length) return;
    setBusy("Matching file names…");
    const r = await matchFilesAction(docs.map((f) => f.name));
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setRows(
      r.rows.map((m, i) => ({
        ...m,
        key: `${Date.now()}-${i}`,
        file: docs[i],
        picked: new Set(m.confidence === "high" ? m.parts.map((p) => p.sku) : []),
        status: "pending" as const,
      }))
    );
  };

  const confirm = async () => {
    setError(null);
    const todo = rows.filter((r) => r.status === "pending" || r.status === "failed");
    let n = 0;
    for (const r of todo) {
      n++;
      setBusy(`Uploading ${n} of ${todo.length}…`);
      if (!r.picked.size) {
        patch(r.key, { status: "skipped", message: "No part — skipped." });
        continue;
      }
      const refused = preflight(r.file, r.kind);
      if (refused) {
        patch(r.key, { status: "failed", message: refused });
        continue;
      }
      patch(r.key, { status: "uploading" });
      const res = await uploadNewDocument(r.file, r.kind, [...r.picked]);
      patch(r.key, res.ok ? { status: "done", message: `Attached to ${r.picked.size}` } : { status: "failed", message: res.error });
    }
    setBusy(null);
  };

  const counts = {
    high: rows.filter((r) => r.confidence === "high").length,
    ambiguous: rows.filter((r) => r.confidence === "ambiguous").length,
    none: rows.filter((r) => r.confidence === "none").length,
    ready: rows.filter((r) => r.picked.size && (r.status === "pending" || r.status === "failed")).length,
    done: rows.filter((r) => r.status === "done").length,
  };
  const CONF: Record<Row["confidence"], { label: string; color: string }> = {
    high: { label: "Matched", color: "#1f7a52" },
    ambiguous: { label: "Ambiguous", color: "#9a6b12" },
    none: { label: "No match", color: "#b4543a" },
  };

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={async (e) => { e.preventDefault(); setOver(false); await addFiles(await filesFromDrop(e.dataTransfer)); }}
        className="pk-card"
        style={{ padding: 28, textAlign: "center", border: over ? "2px dashed var(--accent)" : "2px dashed #d7dbe2", marginBottom: 14 }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>Drop a folder or files here</div>
        <div style={{ fontSize: 12, color: "#8c919c", margin: "6px 0 12px" }}>PDF, DOC, DOCX · up to 25 MB each</div>
        <label className="pk-btn-outline" style={{ cursor: "pointer", marginRight: 8 }}>
          Choose files
          <input type="file" multiple accept=".pdf,.doc,.docx" style={{ display: "none" }} onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; addFiles(f); }} />
        </label>
        <label className="pk-btn-outline" style={{ cursor: "pointer" }}>
          Choose a folder
          <input
            type="file"
            multiple
            style={{ display: "none" }}
            ref={(el) => { if (el) el.setAttribute("webkitdirectory", ""); }}
            onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; addFiles(f); }}
          />
        </label>
      </div>

      {busy && <div style={{ fontSize: 12.5, color: "#5b616e", marginBottom: 8 }}>{busy}</div>}
      {error && <div role="alert" style={{ fontSize: 12.5, color: "#b4543a", marginBottom: 8 }}>{error}</div>}
      {!!ignored.length && <div style={{ fontSize: 12, color: "#8c919c", marginBottom: 8 }}>Ignored {ignored.length} file{ignored.length === 1 ? "" : "s"} that aren&apos;t PDF or Word.</div>}

      {!!rows.length && (
        <>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginBottom: 10, fontSize: 12.5 }}>
            <span><b>{rows.length}</b> files · {counts.high} matched · {counts.ambiguous} ambiguous · {counts.none} unmatched</span>
            {counts.done > 0 && <span style={{ color: "#1f7a52" }}>{counts.done} uploaded</span>}
            <button type="button" className="pk-btn-accent" disabled={!!busy || !counts.ready} onClick={confirm}>
              Confirm — upload {counts.ready}
            </button>
            {counts.done > 0 && <Link href="/catalog/documents">Back to Datasheets</Link>}
          </div>
          <div className="pk-card" style={{ padding: 0, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
              <thead>
                <tr>
                  {["File", "Kind", "Match", "Parts", "Status"].map((h) => (
                    <th key={h} style={{ fontSize: 10, fontWeight: 600, color: "#aab0bb", textTransform: "uppercase", letterSpacing: ".04em", textAlign: "left", padding: "8px" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td style={{ padding: 8, borderTop: "1px solid #f0f1f4", fontSize: 12, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.fileName}>{r.fileName}</td>
                    <td style={{ padding: 8, borderTop: "1px solid #f0f1f4" }}>
                      <select aria-label={`Kind for ${r.fileName}`} value={r.kind} disabled={r.status === "done"} onChange={(e) => patch(r.key, { kind: e.target.value as PartDocKind })} style={{ fontSize: 12, padding: "4px 6px", borderRadius: 6, border: "1px solid #dfe2e8" }}>
                        {PART_DOC_KINDS.map((k) => <option key={k} value={k}>{PART_DOC_KIND_LABEL[k]}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: 8, borderTop: "1px solid #f0f1f4", fontSize: 12, color: CONF[r.confidence].color, fontWeight: 600 }}>{CONF[r.confidence].label}</td>
                    <td style={{ padding: 8, borderTop: "1px solid #f0f1f4", fontSize: 12 }}>
                      <div style={{ display: "grid", gap: 3 }}>
                        {r.parts.map((p) => (
                          <label key={p.sku} style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                            <input
                              type="checkbox"
                              disabled={r.status === "done"}
                              checked={r.picked.has(p.sku)}
                              onChange={() => {
                                const next = new Set(r.picked);
                                if (next.has(p.sku)) next.delete(p.sku);
                                else next.add(p.sku);
                                patch(r.key, { picked: next });
                              }}
                            />
                            <span><b>{p.sku}</b> <span style={{ color: "#6b7079" }}>{p.desc}</span></span>
                          </label>
                        ))}
                        {r.status !== "done" && (
                          <PartSearch
                            onPick={(hit) =>
                              patch(r.key, {
                                parts: r.parts.some((p) => p.sku === hit.sku) ? r.parts : [...r.parts, hit],
                                picked: new Set([...r.picked, hit.sku]),
                              })
                            }
                          />
                        )}
                      </div>
                    </td>
                    <td style={{ padding: 8, borderTop: "1px solid #f0f1f4", fontSize: 12, color: r.status === "failed" ? "#b4543a" : r.status === "done" ? "#1f7a52" : "#8c919c" }}>
                      {r.status === "uploading" ? "Uploading…" : r.message || (r.picked.size ? "Ready" : "Pick a part")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
```


- [ ] **Step 7: Run the gates**

```bash
npx tsc --noEmit -p .
```

Expected: no output, exit 0.

```bash
env -u DATABASE_URL npm run test:specs > "${TMPDIR:-/tmp}/pd-specs.log" 2>&1; tail -1 "${TMPDIR:-/tmp}/pd-specs.log"; grep '^FAIL' "${TMPDIR:-/tmp}/pd-specs.log"
```

Expected: `ALL PASSED` and no `FAIL` lines. (One pre-existing flake exists — `redeem: tampered code -> not ok`, a random-code test that fails about one run in sixty; if it is the only FAIL, re-run.)

Expected additionally: `grep -c '^PASS part docs bulk' "${TMPDIR:-/tmp}/pd-specs.log"` prints `1`.

```bash
npx eslint 2>&1 | grep problems
```

Expected: `✖ N problems (0 errors, N warnings)` with N ≤ 111 (the baseline is 111; Task 8 removes one).

```bash
env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build > "${TMPDIR:-/tmp}/pd-build.log" 2>&1; echo "build exit: $?"; tail -3 "${TMPDIR:-/tmp}/pd-build.log"; rm -rf .next
```

Expected: `build exit: 0`, the route table's legend (`ƒ  (Dynamic)  server-rendered on demand`) in the tail, and `.next` removed afterwards. A client component that imports a store or `@/db` value fails here, not in tsc.


- [ ] **Step 8: Commit**

```bash
git add src/lib/part-docs/filename-match.ts 'src/app/(app)/catalog/documents' scripts/test-review-and-spec.ts
git commit -m "feat(part-docs): bulk drop with filename matching, review table and confirm" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 8: The part editor's Documents section (replaces the admin-only datasheet control)

**Files:**
- Modify: `src/lib/part-docs/views.ts` (append `PartDocRow`, `PartDocsView`, `partDocsView`)
- Create: `src/app/(app)/catalog/part-documents-section.tsx` (`"use client"`)
- Modify: `src/app/(app)/catalog/page.tsx` (compute the view when a part is open; mount the section; drop the datasheet control)
- Modify: `src/app/(app)/catalog/controls.tsx` (delete `PartDatasheetControl`)
- Modify: `src/app/(app)/catalog/actions.ts` (delete `uploadPartDatasheetAction`, `removePartDatasheetAction`, `MAX_DATASHEET_BYTES`)
- Modify: `src/app/(app)/catalog/spec-panel.tsx` (comment), `src/lib/stores/catalog.ts` (comment on `datasheetBlobKey`)
- Test: `scripts/test-review-and-spec.ts` (append a `Task 8` block)

**Interfaces:**
- Consumes: Task 2 (`CoverageIndex`), Task 3 (`loadPartDocsState`), Task 6 (`slotViewFor`, `SlotView`, `PartRef`, `SlotCell`, `docHref`, `AlsoCovers`).
- Produces (`views.ts`): `type PartDocRow = { id; kind; title; fileName; hasFile; sourceUrl; source; uploadedAt; uploadedBy; history: Array<{ index; fileName; replacedAt; replacedBy }> }`, `type PartDocsView = { sku; slots: Record<PartDocKind, SlotView>; documents: PartDocRow[]; coveredBy: Array<PartRef & { kinds: PartDocKind[] }>; accessories: PartRef[] }`, `partDocsView(index, sku, descOf): PartDocsView`.
- Produces (client): default `PartDocumentsSection({ view }: { view: PartDocsView })`.
- Removes: `PartDatasheetControl`, `uploadPartDatasheetAction`, `removePartDatasheetAction` (nothing else imports them — verify with `grep -rnE "PartDatasheetControl|uploadPartDatasheetAction|removePartDatasheetAction" src` → no output after this task).

- [ ] **Step 1: Write the failing test**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts

/* --- Part documents (#DOC) — Task 8: the part editor's Documents view --- */
import { partDocsView } from "@/lib/part-docs/views";
{
  const file = (id: string, kind: "datasheet" | "specsheet", at: number): PdDoc => ({
    id, kind, title: id, fileName: `${id}.pdf`, contentType: "application/pdf", size: 1, blobKey: `part-docs/${id}/f.pdf`, sourceUrl: null,
    source: "upload", uploadedAt: at, uploadedBy: "Jeff",
    history: [{ blobKey: `part-docs/${id}/old.pdf`, fileName: "old.pdf", size: 1, replacedAt: at - 1, replacedBy: "Chris" }],
  });
  const idx = buildCoverageIndex({
    documents: [file("PD-edfixds0000", "datasheet", 10), file("PD-edfixss0000", "specsheet", 20), file("PD-edlens00000", "datasheet", 5)],
    links: [
      { id: "1", partSku: "EDFIX", documentId: "PD-edfixds0000", kind: "datasheet", createdAt: 1, createdBy: "t" },
      { id: "2", partSku: "EDFIX", documentId: "PD-edfixss0000", kind: "specsheet", createdAt: 1, createdBy: "t" },
    ],
    accessoryLinks: [
      { id: "a", parentSku: "EDFIX", accessorySku: "EDLENS", source: "assembly" },
      { id: "b", parentSku: "EDFIX", accessorySku: "EDCLAMP", source: "davinci" },
      { id: "c", parentSku: "EDBARE", accessorySku: "EDLENS", source: "davinci" },
    ],
    parts: [],
  });
  const desc = (s: string) => `${s} desc`;
  const fix = partDocsView(idx, "EDFIX", desc);
  ok(fix.documents.map((d) => d.id).join(",") === "PD-edfixss0000,PD-edfixds0000", "part docs editor: the part's documents, newest first");
  ok(fix.documents[0].history[0].fileName === "old.pdf" && fix.documents[0].history[0].index === 0, "part docs editor: replaced files are listed for viewing");
  ok(fix.accessories.map((a) => a.sku).join(",") === "EDLENS,EDCLAMP" && fix.coveredBy.length === 0, "part docs editor: a fixture lists the accessories it covers");
  const lens = partDocsView(idx, "EDLENS", desc);
  ok(lens.coveredBy.length === 1 && lens.coveredBy[0].sku === "EDFIX" && lens.coveredBy[0].kinds.join(",") === "datasheet,specsheet", "part docs editor: an accessory shows which fixtures cover it, and for which kinds (a parent without a file is left out)");
  ok(lens.slots.datasheet.state === "covered" && lens.slots.specsheet.state === "covered" && lens.documents.length === 0, "part docs editor: both slots read covered");
}
```


- [ ] **Step 2: Run it to verify it fails**

```bash
npx tsc --noEmit -p . 2>&1 | head -2
```

Expected: `error TS2305: Module '"@/lib/part-docs/views"' has no exported member 'partDocsView'.`


- [ ] **Step 3: Add the editor's view model**

Append to the end of `src/lib/part-docs/views.ts`:

```ts

export type PartDocRow = {
  id: string;
  kind: PartDocKind;
  title: string;
  fileName: string;
  hasFile: boolean;
  sourceUrl: string | null;
  source: string;
  uploadedAt: number;
  uploadedBy: string;
  history: Array<{ index: number; fileName: string; replacedAt: number; replacedBy: string }>;
};

/** The part editor's Documents section (#DOC, spec §3). */
export type PartDocsView = {
  sku: string;
  slots: Record<PartDocKind, SlotView>;
  /** Every document linked to this part, either kind, newest first. */
  documents: PartDocRow[];
  /** Fixtures whose documents cover this part, and for which kinds. */
  coveredBy: Array<PartRef & { kinds: PartDocKind[] }>;
  /** Parts this one covers (its accessories). */
  accessories: PartRef[];
};

export function partDocsView(index: CoverageIndex, sku: string, descOf: (sku: string) => string): PartDocsView {
  const linked = index.docsBySku.get(sku);
  const documents = [...(linked?.datasheet ?? []), ...(linked?.specsheet ?? [])]
    .sort((a, b) => b.uploadedAt - a.uploadedAt)
    .map((d) => ({
      id: d.id,
      kind: d.kind,
      title: d.title,
      fileName: d.fileName,
      hasFile: !!d.blobKey,
      sourceUrl: d.sourceUrl,
      source: d.source,
      uploadedAt: d.uploadedAt,
      uploadedBy: d.uploadedBy,
      history: (d.history || []).map((h, i) => ({ index: i, fileName: h.fileName, replacedAt: h.replacedAt, replacedBy: h.replacedBy })),
    }));
  const coveredBy: PartDocsView["coveredBy"] = [];
  for (const p of index.parentsOf.get(sku) ?? []) {
    if (p.ownDatasheet) continue;
    const kinds = (["datasheet", "specsheet"] as const).filter((k) => (index.docsBySku.get(p.parentSku)?.[k] ?? []).some((d) => !!d.blobKey));
    if (kinds.length) coveredBy.push({ sku: p.parentSku, desc: descOf(p.parentSku), kinds: [...kinds] });
  }
  return {
    sku,
    slots: { datasheet: slotViewFor(index, sku, "datasheet", descOf), specsheet: slotViewFor(index, sku, "specsheet", descOf) },
    documents,
    coveredBy,
    accessories: (index.childrenOf.get(sku) ?? []).map((s) => ({ sku: s, desc: descOf(s) })),
  };
}
```


- [ ] **Step 4: Write the Documents section**

Mounted inside `<form action={upsertPart}>`: every button is `type="button"` and nothing carries a `name`.

Create `src/app/(app)/catalog/part-documents-section.tsx`:

```tsx
"use client";

import { useState } from "react";
import { dateYear } from "@/lib/format";
import { collapseList } from "@/lib/part-docs/coverage";
import { PART_DOC_KINDS, PART_DOC_KIND_LABEL } from "@/lib/part-docs/types";
import type { PartDocsView } from "@/lib/part-docs/views";
import AlsoCovers from "./documents/also-covers";
import SlotCell, { docHref } from "./documents/slot-cell";

/**
 * The part editor's Documents section (#DOC, spec §3): the two slots (same
 * cell as the Datasheets page), every document linked to the part with its
 * replaced versions, and the computed "Covered by" / "Covers" context from
 * the accessory graph. Any signed-in user (spec §2.4).
 *
 * Lives inside `<form action={upsertPart}>`: every button is type="button"
 * and nothing here has a `name`, so none of it reaches upsertPart.
 */

const H: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 };

export default function PartDocumentsSection({ view }: { view: PartDocsView }) {
  const [justUploaded, setJustUploaded] = useState<{ sku: string; documentId: string; fileName: string } | null>(null);
  const [showAllAcc, setShowAllAcc] = useState(false);
  const acc = collapseList(view.accessories);

  return (
    <div>
      <div style={H}>Documents</div>
      {justUploaded && <AlsoCovers {...justUploaded} onDone={() => setJustUploaded(null)} />}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {PART_DOC_KINDS.map((k) => (
          <div key={k}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "#5b616e", marginBottom: 4 }}>{PART_DOC_KIND_LABEL[k]}</div>
            <SlotCell sku={view.sku} kind={k} view={view.slots[k]} onUploaded={(sku, documentId, fileName) => setJustUploaded({ sku, documentId, fileName })} />
          </div>
        ))}
      </div>

      {!!view.documents.length && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "#5b616e", marginBottom: 4 }}>This part&apos;s documents</div>
          {view.documents.map((d) => (
            <div key={d.id} style={{ fontSize: 12, marginBottom: 4 }}>
              <a href={docHref(d.id)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>{d.title}</a>
              <span style={{ color: "#8c919c" }}>
                {" "}· {PART_DOC_KIND_LABEL[d.kind]} · {d.hasFile ? `${d.source === "upload" ? "uploaded" : d.source} by ${d.uploadedBy} ${dateYear(d.uploadedAt)}` : "link only"}
              </span>
              {d.history.map((h) => (
                <div key={h.index} style={{ marginLeft: 12, fontSize: 11, color: "#8c919c" }}>
                  replaced {dateYear(h.replacedAt)} by {h.replacedBy}:{" "}
                  <a href={`${docHref(d.id)}?history=${h.index}`} target="_blank" rel="noopener noreferrer" style={{ color: "#6b7079" }}>{h.fileName}</a>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {!!view.coveredBy.length && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "#5b616e", marginBottom: 4 }}>Covered by</div>
          {view.coveredBy.map((p) => (
            <div key={p.sku} style={{ fontSize: 12, color: "#3d424e" }}>
              <a href={`/catalog?edit=${encodeURIComponent(p.sku)}`} style={{ color: "#16181d", fontWeight: 600 }}>{p.sku}</a> {p.desc}
              <span style={{ color: "#8c919c" }}> · {p.kinds.map((k) => PART_DOC_KIND_LABEL[k].toLowerCase()).join(" + ")}</span>
            </div>
          ))}
        </div>
      )}

      {!!view.accessories.length && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "#5b616e", marginBottom: 4 }}>Covers {view.accessories.length} accessor{view.accessories.length === 1 ? "y" : "ies"}</div>
          {(showAllAcc ? view.accessories : acc.shown).map((p) => (
            <div key={p.sku} style={{ fontSize: 12, color: "#3d424e" }}>
              <b>{p.sku}</b> <span style={{ color: "#6b7079" }}>{p.desc}</span>
            </div>
          ))}
          {acc.more > 0 && !showAllAcc && (
            <button type="button" onClick={() => setShowAllAcc(true)} style={{ border: "none", background: "none", padding: 0, color: "var(--accent)", fontSize: 11.5, cursor: "pointer" }}>
              +{acc.more} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```


- [ ] **Step 5: Compute the view on the Catalog page and mount the section**

In `src/app/(app)/catalog/page.tsx`, replace this exact text:

```tsx
import { CatalogControls, CatalogImportPanel, PartDatasheetControl } from "./controls";
```

with:

```tsx
import { CatalogControls, CatalogImportPanel } from "./controls";
```

In `src/app/(app)/catalog/page.tsx`, replace this exact text:

```tsx
import { articleIdForPart } from "@/lib/specs/articles";
```

with:

```tsx
import { articleIdForPart } from "@/lib/specs/articles";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { partDocsView, type PartDocsView } from "@/lib/part-docs/views";
import PartDocumentsSection from "./part-documents-section";
```

In `src/app/(app)/catalog/page.tsx`, replace this exact text:

```tsx
  const defaultArticleId = editingPart
    ? articleIdForPart({ ...editingPart, specArticleId: undefined }, specArticleDocs, specSections)
    : null;
```

with:

```tsx
  const defaultArticleId = editingPart
    ? articleIdForPart({ ...editingPart, specArticleId: undefined }, specArticleDocs, specSections)
    : null;
  // Part documents (#DOC): the Documents section's view, computed only when a
  // part is open — one load of the three document collections.
  const descBySku = editingPart ? new Map(parts.map((p) => [p.sku, p.desc])) : null;
  const partDocs = editingPart
    ? partDocsView((await loadPartDocsState(parts)).index, editingPart.sku, (s) => descBySku!.get(s) ?? "")
    : null;
```

In `src/app/(app)/catalog/page.tsx`, replace this exact text:

```tsx
          specTemplates={specTemplates}
          defaultArticleId={defaultArticleId}
          error={partError}
        />
```

with:

```tsx
          specTemplates={specTemplates}
          defaultArticleId={defaultArticleId}
          partDocs={partDocs}
          error={partError}
        />
```

In `src/app/(app)/catalog/page.tsx`, replace this exact text:

```tsx
  defaultArticleId,
  error,
}: {
```

with:

```tsx
  defaultArticleId,
  partDocs,
  error,
}: {
```

In `src/app/(app)/catalog/page.tsx`, replace this exact text:

```tsx
  /** Datasheet attach/replace/remove (punch #39, Task 5) is admin-gated —
   *  same convention as the Categories & trades card. */
  isAdmin: boolean;
  /** Task 13 — the Spec panel shows for anyone who can `create` (owner
   *  decision 3), not admin-only like the datasheet control above, because
   *  the datasheet control writes Peak's own blob storage and the spec
   *  write is gated by requirePerm("create") inside the action itself. */
```

with:

```tsx
  /** Deleting a part is admin-gated — same convention as the Categories &
   *  trades card. (Documents are not: anyone signed in, D-DOC-6.) */
  isAdmin: boolean;
  /** Task 13 — the Spec panel shows for anyone who can `create` (owner
   *  decision 3); the spec write is gated by requirePerm("create") inside
   *  the action itself. */
```

In `src/app/(app)/catalog/page.tsx`, replace this exact text:

```tsx
  defaultArticleId: string | null;
  /** #158
```

with:

```tsx
  defaultArticleId: string | null;
  /** Part documents (#DOC) — null for a new, unsaved part. */
  partDocs: PartDocsView | null;
  /** #158
```

In `src/app/(app)/catalog/page.tsx`, replace this exact text:

```tsx
            {/* Datasheet attach/replace/remove (punch #39, Task 5) — admin
                only, and only once the part exists (its SKU is the doc id
                the blob pathname is keyed under). */}
            {isAdmin && editing && part && (
              <div style={{ marginTop: 16, paddingTop: 13, borderTop: "1px solid #f0f1f4" }}>
                <PartDatasheetControl sku={part.sku} datasheetName={part.datasheetName} />
              </div>
            )}
```

with:

```tsx
            {/* Part documents (#DOC) — the datasheet / spec-sheet slots,
                this part's documents and its accessory coverage. Anyone
                signed in (spec §2.4); only once the part exists. Replaces
                the admin-only single-datasheet control (D-DOC-6). */}
            {editing && part && partDocs && (
              <div style={{ marginTop: 16, paddingTop: 13, borderTop: "1px solid #f0f1f4" }}>
                <PartDocumentsSection key={part.sku} view={partDocs} />
              </div>
            )}
```


- [ ] **Step 6: Delete the legacy single-datasheet control and its actions**

In `src/app/(app)/catalog/controls.tsx`, delete everything from `const dsLinkStyle: React.CSSProperties = {` to the end of the file (the style object and `PartDatasheetControl`). Run exactly:

```bash
python3 - <<'PY'
p = 'src/app/(app)/catalog/controls.tsx'
s = open(p).read()
open(p, 'w').write(s[: s.index('const dsLinkStyle: React.CSSProperties = {')].rstrip() + "\n")
PY
```

In `src/app/(app)/catalog/controls.tsx`, replace this exact text:

```tsx
import { importCatalog, removePartDatasheetAction, uploadPartDatasheetAction } from "./actions";
```

with:

```tsx
import { importCatalog } from "./actions";
```

In `src/app/(app)/catalog/actions.ts`, delete `MAX_DATASHEET_BYTES`, `uploadPartDatasheetAction` and `removePartDatasheetAction` (from the `/** ~8 MB data-URL cap…` comment through the closing brace of `removePartDatasheetAction` and the blank line after it). Run exactly:

```bash
python3 - <<'PY'
p = 'src/app/(app)/catalog/actions.ts'
s = open(p).read()
start = s.index('/** ~8 MB data-URL cap on the upload transport')
end = s.index('  const { datasheetBlobKey: _key, datasheetName: _name, ...rest } = part;\n  await upsert(rest);\n  revalidatePath("/catalog");\n  return { ok: true };\n}\n\n') + len('  const { datasheetBlobKey: _key, datasheetName: _name, ...rest } = part;\n  await upsert(rest);\n  revalidatePath("/catalog");\n  return { ok: true };\n}\n\n')
open(p, 'w').write(s[:start] + s[end:])
PY
```

In `src/app/(app)/catalog/actions.ts`, replace this exact text:

```ts
import { clearCatalogPriceList, get as getPart, upsert, mergeUpsert, remove as removePart } from "@/lib/stores/catalog";
```

with:

```ts
import { clearCatalogPriceList, get as getPart, mergeUpsert, remove as removePart } from "@/lib/stores/catalog";
```

In `src/app/(app)/catalog/actions.ts`, replace this exact text:

```ts
import { blobEnabled, dataUrlToBytes, putBlob, safeName } from "@/lib/blob";
```

with:

```ts

```

In `src/app/(app)/catalog/spec-panel.tsx`, replace this exact text:

```tsx
 * Lives inside `<form action={upsertPart}>` like PartDatasheetControl
 * beside it:
```

with:

```tsx
 * Lives inside `<form action={upsertPart}>` like the Documents section
 * (part-documents-section.tsx) beside it:
```

In `src/lib/stores/catalog.ts`, replace this exact text:

```ts
   *  /api/part-datasheet/<sku> proxy. Always set/cleared together with
   *  datasheetName by uploadPartDatasheetAction/removePartDatasheetAction. */
```

with:

```ts
   *  /api/part-datasheet/<sku> proxy. LEGACY since part documents (#DOC):
   *  nothing writes it any more; the backfill (src/lib/part-docs/legacy.ts)
   *  turns it into a shared `part_documents` row, and it stays readable
   *  for the readers that have not switched. */
```

```bash
grep -rnE "PartDatasheetControl|uploadPartDatasheetAction|removePartDatasheetAction" src
```

Expected: no output.


- [ ] **Step 7: Run the gates**

```bash
npx tsc --noEmit -p .
```

Expected: no output, exit 0.

```bash
env -u DATABASE_URL npm run test:specs > "${TMPDIR:-/tmp}/pd-specs.log" 2>&1; tail -1 "${TMPDIR:-/tmp}/pd-specs.log"; grep '^FAIL' "${TMPDIR:-/tmp}/pd-specs.log"
```

Expected: `ALL PASSED` and no `FAIL` lines. (One pre-existing flake exists — `redeem: tampered code -> not ok`, a random-code test that fails about one run in sixty; if it is the only FAIL, re-run.)

Expected additionally: `grep -c '^PASS part docs editor' "${TMPDIR:-/tmp}/pd-specs.log"` prints `5`.

```bash
npx eslint 2>&1 | grep problems
```

Expected: `✖ N problems (0 errors, N warnings)` with N ≤ 111 (the baseline is 111; Task 8 removes one).

```bash
env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build > "${TMPDIR:-/tmp}/pd-build.log" 2>&1; echo "build exit: $?"; tail -3 "${TMPDIR:-/tmp}/pd-build.log"; rm -rf .next
```

Expected: `build exit: 0`, the route table's legend (`ƒ  (Dynamic)  server-rendered on demand`) in the tail, and `.next` removed afterwards. A client component that imports a store or `@/db` value fails here, not in tsc.


- [ ] **Step 8: Commit**

```bash
git add src/lib/part-docs/views.ts 'src/app/(app)/catalog/part-documents-section.tsx' 'src/app/(app)/catalog/page.tsx' 'src/app/(app)/catalog/controls.tsx' 'src/app/(app)/catalog/actions.ts' 'src/app/(app)/catalog/spec-panel.tsx' src/lib/stores/catalog.ts scripts/test-review-and-spec.ts
git commit -m "feat(part-docs): part editor Documents section; retire the admin-only single-datasheet control" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 9: Assembly Builder ↔ accessory graph (members' coverage + has-its-own-datasheet, sync on save)

**Files:**
- Modify: `src/lib/stores/part-accessory-links.ts` (add `syncAccessoryScopes`)
- Create: `src/lib/part-docs/assembly-graph.ts` (pure)
- Modify: `src/app/(app)/design/assemblies/actions.ts` (sync on save + `setOwnDatasheetAction`)
- Create: `src/app/(app)/design/assemblies/member-coverage.tsx` (`"use client"`)
- Modify: `src/app/(app)/design/assemblies/assembly-builder.tsx`, `src/app/(app)/design/assemblies/page.tsx`
- Modify: `src/app/(app)/design/subassemblies/actions.ts`, `src/app/(app)/design/subassemblies/subassemblies-client.tsx`
- Test: `scripts/test-review-and-spec.ts` (append a `Task 9` block), `scripts/test-review-regressions.ts` (a DB block)

**Interfaces:**
- Consumes: Task 2 (`ownFiles`, `slotCoverage`, `CoverageIndex`, `SlotState`), Task 3 (`syncAccessoryLinks`, `setOwnDatasheet`, `loadPartDocsState`), `type FixtureAssembly` (`src/lib/fixture-assemblies.ts`), `type FixtureSubassembly` (`src/lib/stores/subassemblies.ts`, type-only).
- Produces (store): `syncAccessoryScopes(source: AccessoryLinkSource, refPrefix: string, scopes: ReadonlyArray<{ sourceRef: string; pairs: readonly AccessoryPair[] }>): Promise<{ written: number; removed: number }>` — one load, and links under the prefix whose scope is gone are soft-deleted.
- Produces (`assembly-graph.ts`, pure): `ASSEMBLY_REF_PREFIX = "assembly:"`, `SUBASSEMBLY_REF_PREFIX = "subassembly:"`, `assemblyRef(id)`, `subassemblyRef(id)`, `fixtureParentSku(a): string | null`, `fixtureAssemblyPairs(a): AccessoryPair[]`, `subassemblyPairs(s): AccessoryPair[]`, `type MemberCoverage = { linked; own; parentHasDatasheet; state: SlotState }`, `pairKey(parentSku, accessorySku): string`, `memberCoverageFor(index, pairs): Record<string, MemberCoverage>`, `memberCoverageLabel(c?): string`.
- Produces (actions): `setOwnDatasheetAction(parentSku, accessorySku, own): Promise<{ ok: true } | { ok: false; error: string }>`; `AssemblyBuilder` and `SubassembliesClient` gain a required `coverage: Record<string, MemberCoverage>` prop.

- [ ] **Step 1: Write the failing tests**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts

/* ======================================================================
   Part documents (#DOC) — Task 9: Assembly Builder ↔ accessory graph. Pure.
   ====================================================================== */
import {
  assemblyRef, subassemblyRef, fixtureParentSku, fixtureAssemblyPairs, subassemblyPairs, memberCoverageFor, memberCoverageLabel, pairKey,
} from "@/lib/part-docs/assembly-graph";
{
  const asm = {
    components: [
      { sku: "S4LED", label: "Engine", role: "fixture" as const, defaultQty: 1 },
      { sku: "LENS19", label: "Lens", role: "lens" as const, defaultQty: 1 },
      { sku: "CLAMP", label: "Clamp", role: "mount" as const, defaultQty: 0 },
      { sku: "S4LED", label: "dup", role: "other" as const, defaultQty: 1 },
    ],
  };
  ok(fixtureParentSku(asm) === "S4LED" && fixtureParentSku({ components: [] }) === null, "part docs assemblies: the fixture component is the parent");
  const pairs = fixtureAssemblyPairs(asm);
  ok(pairs.map((p) => `${p.parentSku}>${p.accessorySku}:${p.included ? "in" : "opt"}`).join(",") === "S4LED>LENS19:in,S4LED>CLAMP:opt", "part docs assemblies: every other component is an accessory; qty 0 is optional, the fixture itself is skipped");
  ok(fixtureAssemblyPairs({ components: [{ sku: "X", label: "x", role: "lens", defaultQty: 1 }] }).length === 0, "part docs assemblies: no fixture, no links");
  const sub = subassemblyPairs({ lightEngineSku: "ENG", lensSku: "L1", options: { data: [{ sku: "D1", name: "d", cost: 1, qty: 2 }], power: [], mounting: [{ sku: "M1", name: "m", cost: 1, qty: 1 }], accessories: [] } });
  ok(sub.map((p) => `${p.accessorySku}x${p.maxQty}`).join(",") === "L1x1,D1x2,M1x1" && sub.every((p) => p.parentSku === "ENG"), "part docs assemblies: a subassembly's lens and options are the light engine's accessories");
  ok(assemblyRef("fa-1") === "assembly:fa-1" && subassemblyRef("SA-1") === "subassembly:SA-1", "part docs assemblies: the two builders keep separate sourceRef namespaces");

  const idx = buildCoverageIndex({
    documents: [{ id: "PD-engds000000", kind: "datasheet", title: "E", fileName: "e.pdf", contentType: "application/pdf", size: 1, blobKey: "part-docs/PD-engds000000/e.pdf", sourceUrl: null, source: "upload", uploadedAt: 1, uploadedBy: "t", history: [] }],
    links: [{ id: "1", partSku: "S4LED", documentId: "PD-engds000000", kind: "datasheet", createdAt: 1, createdBy: "t" }],
    accessoryLinks: [
      { id: "a", parentSku: "S4LED", accessorySku: "LENS19", source: "assembly", sourceRef: "assembly:fa-1" },
      { id: "b", parentSku: "S4LED", accessorySku: "CLAMP", source: "assembly", sourceRef: "assembly:fa-1", ownDatasheet: true },
    ],
    parts: [],
  });
  const cov = memberCoverageFor(idx, [...pairs, { parentSku: "S4LED", accessorySku: "NEW" }]);
  ok(memberCoverageLabel(cov[pairKey("S4LED", "LENS19")]) === "Covered by fixture datasheet", "part docs assemblies: a member reads covered by the fixture datasheet by default");
  ok(memberCoverageLabel(cov[pairKey("S4LED", "CLAMP")]) === "Has its own datasheet — none attached yet", "part docs assemblies: the own-datasheet toggle opts the member out");
  ok(memberCoverageLabel(cov[pairKey("S4LED", "NEW")]) === "Save to link it to the fixture" && !cov[pairKey("S4LED", "NEW")].linked, "part docs assemblies: an unsaved member is not linked yet");
}
```

In `scripts/test-review-regressions.ts`, insert the following immediately before the line `console.log("review regression checks passed");`:

```ts
  /* --- part documents (#DOC): Assembly Builder saves sync the graph in one pass --- */
  {
    const Acc = await import("@/lib/stores/part-accessory-links");
    const first = await Acc.syncAccessoryScopes("assembly", "assembly:", [
      { sourceRef: "assembly:fa-sync-1", pairs: [{ parentSku: "SYNC-FIX", accessorySku: "SYNC-LENS" }] },
      { sourceRef: "assembly:fa-sync-2", pairs: [{ parentSku: "SYNC-FIX2", accessorySku: "SYNC-CLAMP" }] },
    ]);
    assert.deepEqual(first, { written: 2, removed: 0 }, "part docs graph: one save writes every assembly's links");
    await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "subassembly:SA-sync" }, [{ parentSku: "SYNC-FIX", accessorySku: "SYNC-OPT" }]);
    const second = await Acc.syncAccessoryScopes("assembly", "assembly:", [
      { sourceRef: "assembly:fa-sync-1", pairs: [{ parentSku: "SYNC-FIX", accessorySku: "SYNC-LENS" }] },
    ]);
    assert.deepEqual(second, { written: 0, removed: 1 }, "part docs graph: an assembly deleted from the list loses its links");
    assert((await Acc.allAccessoryLinks()).some((l) => l.sourceRef === "subassembly:SA-sync"), "part docs graph: a subassembly's links are outside the assemblies prefix and survive");
  }

```


- [ ] **Step 2: Run them to verify they fail**

```bash
env -u DATABASE_URL npm run test:specs 2>&1 | grep -m1 -i 'cannot find module'
```

Expected: `Error: Cannot find module '@/lib/part-docs/assembly-graph'`.


- [ ] **Step 3: Sync many assembly scopes in one pass**

In `src/lib/stores/part-accessory-links.ts`, insert the following immediately before the line `async function syncScopes(`:

```ts
/**
 * Sync many scopes that share a sourceRef prefix in ONE pass — the Assembly
 * Builder saves every fixture assembly at once. Links under the prefix whose
 * scope is not in `scopes` (a deleted assembly) are soft-deleted too.
 */
export async function syncAccessoryScopes(
  source: AccessoryLinkSource,
  refPrefix: string,
  scopes: ReadonlyArray<{ sourceRef: string; pairs: readonly AccessoryPair[] }>
): Promise<{ written: number; removed: number }> {
  return syncScopes(source, (l) => (l.sourceRef ?? "").startsWith(refPrefix), scopes);
}

```


- [ ] **Step 4: Write the pure assembly ↔ graph mapping**

Create `src/lib/part-docs/assembly-graph.ts`:

```ts
import type { FixtureAssembly } from "@/lib/fixture-assemblies";
import type { FixtureSubassembly } from "@/lib/stores/subassemblies";
import { ownFiles, slotCoverage, type CoverageIndex, type SlotState } from "./coverage";
import type { AccessoryPair } from "./types";

/**
 * Assembly Builder ↔ accessory graph (#DOC, spec §3). Pure — the builders'
 * client components import it. Each assembly's light engine is the parent;
 * its lens and every option/accessory part are the parent's accessory links.
 * The two builders keep separate sourceRef namespaces so a save of one never
 * prunes the other's links.
 */

export const ASSEMBLY_REF_PREFIX = "assembly:";
export const SUBASSEMBLY_REF_PREFIX = "subassembly:";
export const assemblyRef = (id: string) => `${ASSEMBLY_REF_PREFIX}${id}`;
export const subassemblyRef = (id: string) => `${SUBASSEMBLY_REF_PREFIX}${id}`;

/** The fixture (light engine) of an Assemblies-tab assembly, if it has one. */
export function fixtureParentSku(a: Pick<FixtureAssembly, "components">): string | null {
  return a.components.find((c) => c.role === "fixture")?.sku || null;
}

/** Every non-fixture component is an accessory of the fixture. A default
 *  quantity above zero means it ships with the fixture ("included"). */
export function fixtureAssemblyPairs(a: Pick<FixtureAssembly, "components">): AccessoryPair[] {
  const parentSku = fixtureParentSku(a);
  if (!parentSku) return [];
  return a.components
    .filter((c) => c.role !== "fixture" && c.sku !== parentSku)
    .map((c) => ({ parentSku, accessorySku: c.sku, ...(c.defaultQty > 0 ? { maxQty: c.defaultQty, included: true } : {}) }));
}

/** A subassembly's lens and data/power/mounting/accessory options. */
export function subassemblyPairs(s: Pick<FixtureSubassembly, "lightEngineSku" | "lensSku" | "options">): AccessoryPair[] {
  const parentSku = s.lightEngineSku;
  if (!parentSku) return [];
  const out: AccessoryPair[] = [];
  if (s.lensSku) out.push({ parentSku, accessorySku: s.lensSku, maxQty: 1, included: true });
  for (const list of Object.values(s.options || {})) {
    for (const o of list || []) if (o?.sku) out.push({ parentSku, accessorySku: o.sku, maxQty: Math.max(1, o.qty || 1), included: true });
  }
  return out.filter((p) => p.accessorySku !== parentSku);
}

export type MemberCoverage = {
  /** The pair is in the stored graph (an unsaved member is not yet). */
  linked: boolean;
  /** "Has its own datasheet" is set on the pair. */
  own: boolean;
  parentHasDatasheet: boolean;
  /** The member's datasheet slot, no context. */
  state: SlotState;
};

/** Stable key for one parent → accessory pair in a props record. */
export function pairKey(parentSku: string, accessorySku: string): string {
  return `${parentSku}\u0001${accessorySku}`;
}

export function memberCoverageFor(index: CoverageIndex, pairs: readonly AccessoryPair[]): Record<string, MemberCoverage> {
  const out: Record<string, MemberCoverage> = {};
  for (const p of pairs) {
    const link = index.parentsOf.get(p.accessorySku)?.find((x) => x.parentSku === p.parentSku);
    out[pairKey(p.parentSku, p.accessorySku)] = {
      linked: !!link,
      own: !!link?.ownDatasheet,
      parentHasDatasheet: ownFiles(index, p.parentSku, "datasheet").length > 0,
      state: slotCoverage(index, p.accessorySku, "datasheet").state,
    };
  }
  return out;
}

export function memberCoverageLabel(c: MemberCoverage | undefined): string {
  if (!c || !c.linked) return "Save to link it to the fixture";
  if (c.own) return c.state === "own" ? "Has its own datasheet" : "Has its own datasheet — none attached yet";
  if (c.state === "own") return "Own datasheet attached";
  if (c.parentHasDatasheet) return "Covered by fixture datasheet";
  return "Fixture has no datasheet yet";
}
```


- [ ] **Step 5: Sync on save, and the toggle action**

In `src/app/(app)/design/assemblies/actions.ts`, replace this exact text (the whole file):

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { setSettings } from "@/lib/settings";
import { sanitizeFixtureAssemblies, type FixtureAssembly } from "@/lib/fixture-assemblies";

export async function saveFixtureAssembliesAction(value: FixtureAssembly[]) {
  await requireUser();
  const fixtureAssemblies = sanitizeFixtureAssemblies(value);
  await setSettings({ fixtureAssemblies });
  revalidatePath("/design/assemblies");
  revalidatePath("/estimator");
  return { ok: true as const, fixtureAssemblies };
}
```

with:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { setSettings } from "@/lib/settings";
import { sanitizeFixtureAssemblies, type FixtureAssembly } from "@/lib/fixture-assemblies";
import { ASSEMBLY_REF_PREFIX, assemblyRef, fixtureAssemblyPairs } from "@/lib/part-docs/assembly-graph";
import { setOwnDatasheet, syncAccessoryScopes } from "@/lib/stores/part-accessory-links";

export async function saveFixtureAssembliesAction(value: FixtureAssembly[]) {
  await requireUser();
  const fixtureAssemblies = sanitizeFixtureAssemblies(value);
  await setSettings({ fixtureAssemblies });
  // Part documents (#DOC): each assembly's members become the fixture's
  // accessory links; an assembly deleted from the list takes its links with it.
  await syncAccessoryScopes(
    "assembly",
    ASSEMBLY_REF_PREFIX,
    fixtureAssemblies.map((a) => ({ sourceRef: assemblyRef(a.id), pairs: fixtureAssemblyPairs(a) }))
  );
  revalidatePath("/design/assemblies");
  revalidatePath("/estimator");
  revalidatePath("/catalog/documents");
  return { ok: true as const, fixtureAssemblies };
}

/** The member's "has its own datasheet" toggle (#DOC, spec §3/§4): the pair
 *  stops (or resumes) counting the fixture's datasheet as the member's. */
export async function setOwnDatasheetAction(parentSku: string, accessorySku: string, own: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  const changed = await setOwnDatasheet(String(parentSku || ""), String(accessorySku || ""), !!own);
  if (!changed) return { ok: false, error: "Save the assembly first — this part isn't linked to the fixture yet." };
  revalidatePath("/design/assemblies");
  revalidatePath("/catalog/documents");
  return { ok: true };
}
```


- [ ] **Step 6: Write the member coverage chip**

Create `src/app/(app)/design/assemblies/member-coverage.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { memberCoverageLabel, type MemberCoverage } from "@/lib/part-docs/assembly-graph";
import { setOwnDatasheetAction } from "./actions";

/**
 * One assembly member's datasheet coverage (#DOC, spec §3): "Covered by
 * fixture datasheet" by default, with the "has its own datasheet" toggle.
 * Disabled until the assembly is saved (the pair isn't in the graph yet).
 */
export default function MemberCoverageChip({ parentSku, accessorySku, coverage }: { parentSku: string; accessorySku: string; coverage?: MemberCoverage }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const linked = !!coverage?.linked;
  const covered = linked && !coverage!.own && (coverage!.parentHasDatasheet || coverage!.state === "own");
  return (
    <div style={{ fontSize: 11, color: covered ? "#3a5fb4" : "#8c919c", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span>{memberCoverageLabel(coverage)}</span>
      <label style={{ display: "inline-flex", gap: 4, alignItems: "center", color: "#6b7079", cursor: linked ? "pointer" : "default" }} title={linked ? "" : "Save the assembly first"}>
        <input
          type="checkbox"
          disabled={!linked || pending}
          checked={!!coverage?.own}
          onChange={(e) => {
            const own = e.target.checked;
            setError(null);
            start(async () => {
              const r = await setOwnDatasheetAction(parentSku, accessorySku, own);
              if (!r.ok) setError(r.error);
              else router.refresh();
            });
          }}
        />
        has its own datasheet
      </label>
      {error && <span role="alert" style={{ color: "#b4543a" }}>{error}</span>}
    </div>
  );
}
```


- [ ] **Step 7: Show coverage on the Assemblies tab**

In `src/app/(app)/design/assemblies/assembly-builder.tsx`, replace this exact text:

```tsx
import { saveFixtureAssembliesAction } from "./actions";
```

with:

```tsx
import { saveFixtureAssembliesAction } from "./actions";
import { fixtureParentSku, pairKey, type MemberCoverage } from "@/lib/part-docs/assembly-graph";
import MemberCoverageChip from "./member-coverage";
```

In `src/app/(app)/design/assemblies/assembly-builder.tsx`, replace this exact text:

```tsx
export default function AssemblyBuilder({ initial, parts, priceDates }: { initial: FixtureAssembly[]; parts: Hit[]; priceDates: Record<string, number | null> }) {
```

with:

```tsx
export default function AssemblyBuilder({
  initial,
  parts,
  priceDates,
  coverage,
}: {
  initial: FixtureAssembly[];
  parts: Hit[];
  priceDates: Record<string, number | null>;
  /** #DOC — each saved member's datasheet coverage, keyed by pairKey(). */
  coverage: Record<string, MemberCoverage>;
}) {
```

In `src/app/(app)/design/assemblies/assembly-builder.tsx`, replace this exact text:

```tsx
                <div><div style={{ fontSize: 12.5, fontWeight: 650 }}>{component.sku}</div><div style={{ fontSize: 11, color: "#999fa9" }}>Catalog component</div></div>
```

with:

```tsx
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 650 }}>{component.sku}</div>
                  {component.role === "fixture" || !fixtureParentSku(assembly) ? (
                    <div style={{ fontSize: 11, color: "#999fa9" }}>{component.role === "fixture" ? "Fixture — its datasheet covers the members" : "Catalog component"}</div>
                  ) : (
                    <MemberCoverageChip
                      parentSku={fixtureParentSku(assembly)!}
                      accessorySku={component.sku}
                      coverage={coverage[pairKey(fixtureParentSku(assembly)!, component.sku)]}
                    />
                  )}
                </div>
```


- [ ] **Step 8: Compute coverage on the page (active tab only, one load)**

In `src/app/(app)/design/assemblies/page.tsx`, replace this exact text:

```tsx
import { pricesAsOf, sanitizeFixtureAssemblies } from "@/lib/fixture-assemblies";
```

with:

```tsx
import { pricesAsOf, sanitizeFixtureAssemblies } from "@/lib/fixture-assemblies";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { fixtureAssemblyPairs, memberCoverageFor, subassemblyPairs } from "@/lib/part-docs/assembly-graph";
```

In `src/app/(app)/design/assemblies/page.tsx`, replace this exact text:

```tsx
  const priceDates = Object.fromEntries(
    sanitizeFixtureAssemblies(settings.fixtureAssemblies).map((a) => [a.id, pricesAsOf(a.components.map((c) => c.sku), parts, settings)])
  );
```

with:

```tsx
  const assemblies = sanitizeFixtureAssemblies(settings.fixtureAssemblies);
  const priceDates = Object.fromEntries(assemblies.map((a) => [a.id, pricesAsOf(a.components.map((c) => c.sku), parts, settings)]));
  // Part documents (#DOC): each member's datasheet coverage, for the active tab only.
  const { index } = await loadPartDocsState(parts);
  const coverage = memberCoverageFor(
    index,
    tab === "assemblies" ? assemblies.flatMap(fixtureAssemblyPairs) : (saved as FixtureSubassembly[]).flatMap(subassemblyPairs)
  );
```

In `src/app/(app)/design/assemblies/page.tsx`, replace this exact text:

```tsx
<AssemblyBuilder initial={settings.fixtureAssemblies || []} parts={builderParts} priceDates={priceDates} />
```

with:

```tsx
<AssemblyBuilder initial={settings.fixtureAssemblies || []} parts={builderParts} priceDates={priceDates} coverage={coverage} />
```

In `src/app/(app)/design/assemblies/page.tsx`, replace this exact text:

```tsx
<SubassembliesClient parts={parts} initial={saved as FixtureSubassembly[]} priceListEffective={settings.priceListEffective || {}} />
```

with:

```tsx
<SubassembliesClient parts={parts} initial={saved as FixtureSubassembly[]} priceListEffective={settings.priceListEffective || {}} coverage={coverage} />
```


- [ ] **Step 9: Sync subassemblies on save and delete; show their members' coverage**

In `src/app/(app)/design/subassemblies/actions.ts`, replace this exact text:

```ts
import { create, remove, save, type FixtureOptionCategory, type FixtureSubassembly } from "@/lib/stores/subassemblies";
```

with:

```ts
import { create, remove, save, type FixtureOptionCategory, type FixtureSubassembly } from "@/lib/stores/subassemblies";
import { subassemblyPairs, subassemblyRef } from "@/lib/part-docs/assembly-graph";
import { syncAccessoryLinks } from "@/lib/stores/part-accessory-links";
```

In `src/app/(app)/design/subassemblies/actions.ts`, replace this exact text:

```ts
  const saved = input.id ? await save(item) : await create(item);
  revalidatePath("/design/assemblies");
```

with:

```ts
  const saved = input.id ? await save(item) : await create(item);
  // Part documents (#DOC): the lens and options become the light engine's accessory links.
  await syncAccessoryLinks({ source: "assembly", sourceRef: subassemblyRef(saved.id) }, subassemblyPairs(saved));
  revalidatePath("/design/assemblies");
```

In `src/app/(app)/design/subassemblies/actions.ts`, replace this exact text:

```ts
  await requirePerm("manage_users");
  await remove(id);
```

with:

```ts
  await requirePerm("manage_users");
  await remove(id);
  await syncAccessoryLinks({ source: "assembly", sourceRef: subassemblyRef(id) }, []);
```

In `src/app/(app)/design/subassemblies/subassemblies-client.tsx`, replace this exact text:

```tsx
import { ConfirmButton } from "@/components/confirm-button";
```

with:

```tsx
import { ConfirmButton } from "@/components/confirm-button";
import { pairKey, subassemblyPairs, type MemberCoverage } from "@/lib/part-docs/assembly-graph";
import MemberCoverageChip from "../assemblies/member-coverage";
```

In `src/app/(app)/design/subassemblies/subassemblies-client.tsx`, replace this exact text:

```tsx
export default function SubassembliesClient({ parts, initial, priceListEffective }: { parts: CatalogPart[]; initial: FixtureSubassembly[]; priceListEffective: Record<string, number> }) {
```

with:

```tsx
export default function SubassembliesClient({
  parts,
  initial,
  priceListEffective,
  coverage,
}: {
  parts: CatalogPart[];
  initial: FixtureSubassembly[];
  priceListEffective: Record<string, number>;
  /** #DOC — each saved member's datasheet coverage, keyed by pairKey(). */
  coverage: Record<string, MemberCoverage>;
}) {
```

In `src/app/(app)/design/subassemblies/subassemblies-client.tsx`, replace this exact text:

```tsx
        <div style={{ color: "#9aa0ab", fontSize: 11.5, marginTop: 5 }}>{item.lightEngineName} + {item.lensName}</div>
```

with:

```tsx
        <div style={{ color: "#9aa0ab", fontSize: 11.5, marginTop: 5 }}>{item.lightEngineName} + {item.lensName}</div>
        {/* #DOC — each member's datasheet coverage from the fixture. */}
        <div style={{ marginTop: 6, display: "grid", gap: 3 }}>
          {subassemblyPairs(item).map((p) => (
            <div key={p.accessorySku} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "#5b616e" }}>{p.accessorySku}</span>
              <MemberCoverageChip parentSku={p.parentSku} accessorySku={p.accessorySku} coverage={coverage[pairKey(p.parentSku, p.accessorySku)]} />
            </div>
          ))}
        </div>
```


- [ ] **Step 10: Run the gates**

```bash
npx tsc --noEmit -p .
```

Expected: no output, exit 0.

```bash
env -u DATABASE_URL npm run test:specs > "${TMPDIR:-/tmp}/pd-specs.log" 2>&1; tail -1 "${TMPDIR:-/tmp}/pd-specs.log"; grep '^FAIL' "${TMPDIR:-/tmp}/pd-specs.log"
```

Expected: `ALL PASSED` and no `FAIL` lines. (One pre-existing flake exists — `redeem: tampered code -> not ok`, a random-code test that fails about one run in sixty; if it is the only FAIL, re-run.)

Expected additionally: `grep -c '^PASS part docs assemblies' "${TMPDIR:-/tmp}/pd-specs.log"` prints `8`.

```bash
env -u DATABASE_URL npm run test:review:regressions 2>&1 | tail -2
```

Expected: `review regression checks passed` then `quote email regression checks passed`.

```bash
npx eslint 2>&1 | grep problems
```

Expected: `✖ N problems (0 errors, N warnings)` with N ≤ 111 (the baseline is 111; Task 8 removes one).

```bash
env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build > "${TMPDIR:-/tmp}/pd-build.log" 2>&1; echo "build exit: $?"; tail -3 "${TMPDIR:-/tmp}/pd-build.log"; rm -rf .next
```

Expected: `build exit: 0`, the route table's legend (`ƒ  (Dynamic)  server-rendered on demand`) in the tail, and `.next` removed afterwards. A client component that imports a store or `@/db` value fails here, not in tsc.


- [ ] **Step 11: Commit**

```bash
git add src/lib/stores/part-accessory-links.ts src/lib/part-docs/assembly-graph.ts 'src/app/(app)/design/assemblies' 'src/app/(app)/design/subassemblies' scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
git commit -m "feat(part-docs): Assembly Builder feeds the accessory graph; members show coverage + has-its-own-datasheet" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 10: DaVinci pre-fill — the accessory graph in the extract, link-only ETC datasheets, admin apply

**Files:**
- Modify: `src/lib/davinci/types.ts` (`DavinciAccessoryType`, `DavinciAccessoryLink`, two optional extract fields)
- Modify: `src/lib/davinci/extract.ts` (emit the accessory graph; share `typeModelNumbers`)
- Modify: `scripts/davinci-extract.ts` (report line)
- Regenerate: `data/davinci-extract.json` (committed; records unchanged, graph added)
- Create: `src/lib/part-docs/davinci-prefill.ts` (pure plan)
- Create: `src/lib/part-docs/davinci-apply.ts` (server apply)
- Create: `scripts/part-docs-davinci.ts` + `package.json` script `part-docs:davinci`
- Create: `src/app/(app)/catalog/documents/davinci-prefill-button.tsx` (`"use client"`)
- Modify: `src/app/(app)/catalog/documents/actions.ts` (`prefillFromDavinciAction`), `src/app/(app)/catalog/documents/page.tsx` (admin button), `next.config.ts` (trace the extract into the route)
- Test: `scripts/test-review-and-spec.ts` (append a `Task 10` block), `scripts/test-review-regressions.ts` (a DB block)

**Interfaces:**
- Consumes: `normalizeSku`, `loadExtract`, `peakMfrFor` (`src/lib/catalog-davinci-apply.ts` — the manufacturer allowlist), `mfrKey`, Task 3 (`createDocument`, `ensureLinks`, `allDocuments`, `syncAccessoryLinks`).
- Produces (`src/lib/davinci/types.ts`): `DavinciAccessoryType = { manufacturer; classification; modelNumbers: readonly string[] }`, `DavinciAccessoryLink = { parentTypeId; accessoryTypeId; maxQuantity: number; userDefinable: boolean }`, `DavinciExtract.accessoryTypes?`, `DavinciExtract.accessoryLinks?`.
- Produces (`davinci-prefill.ts`, pure): `type PrefillDoc = { url; label; typeId; skus: string[] }`, `type PrefillStats`, `type PrefillPlan = { libraryTimestamp; documents: PrefillDoc[]; accessoryPairs: AccessoryPair[]; stats }`, `planDavinciPrefill(extract, parts: ReadonlyArray<{ sku }>, allowed: (davinciManufacturer: string) => boolean): PrefillPlan`.
- Produces (`davinci-apply.ts`, server): `davinciDocumentId(url): string` ("PD-D" + 15 hex), `planPrefillFromDavinci(): Promise<PrefillPlan>`, `type PrefillResult = { documentsCreated; linksCreated; accessoryWritten; accessoryRemoved }`, `applyPrefill(plan, by): Promise<PrefillResult>`.
- Produces (actions): `prefillFromDavinciAction(): Promise<DocActionResult<{ summary: string }>>` (`requirePerm("manage_users")`).

- [ ] **Step 1: Write the failing tests**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts

/* ======================================================================
   Part documents (#DOC) — Task 10: the DaVinci accessory graph in the
   extract, and the pre-fill plan. Pure.
   ====================================================================== */
import { planDavinciPrefill } from "@/lib/part-docs/davinci-prefill";
{
  const LIBDOC = {
    ...LIB162,
    constants: {
      ...LIB162.constants,
      productClassifications: [{ productClassificationId: "PC-P", text: "Product" }, { productClassificationId: "PC-A", text: "Accessory" }],
    },
    types: [
      { ...LIB162.types[0], typeInformation: { ...LIB162.types[0].typeInformation, productClassificationId: "PC-P" },
        accessories: [{ typeId: "TY-LENS", maxQuantity: 2, userDefinable: true }, { typeId: "TY-LENS", maxQuantity: 2, userDefinable: true }, { typeId: "TY-X", maxQuantity: 1, userDefinable: false }, { typeId: "TY-GHOST", maxQuantity: 1 }] },
      LIB162.types[1],
      // A lens tube: no ports, no documents — dropped from records, kept for the graph.
      { typeId: "TY-LENS", typeInformation: { displayName: "19 deg lens tube", categoryId: "C-1", manufacturerId: "M-ETC", productClassificationId: "PC-A" },
        partInformation: { generatorData: { lookupData: [{ modelNumber: "419LT", partNumber: "7060A1017" }] } }, documents: [], ports: [], accessories: [] },
    ],
  };
  const ex = extractLibrary(LIBDOC);
  ok(ex.records.length === 1 && !ex.records.some((r) => r.typeId === "TY-LENS"), "#DOC extract: records still drop contentless types");
  ok(JSON.stringify(ex.accessoryLinks) === JSON.stringify([{ parentTypeId: "TY-1", accessoryTypeId: "TY-LENS", maxQuantity: 2, userDefinable: true }]), "#DOC extract: accessory links are kept once, never to the internal category or an unknown type");
  ok(ex.accessoryTypes?.["TY-LENS"]?.classification === "Accessory" && ex.accessoryTypes["TY-LENS"].modelNumbers.join(",") === "419LT,7060A1017", "#DOC extract: both ends carry classification and normalized model numbers");
  ok(ex.accessoryTypes?.["TY-1"]?.manufacturer === "ETC" && !ex.accessoryTypes["TY-X"], "#DOC extract: the parent is described too; the excluded type is not");
  ok(extractLibrary(LIB162).accessoryLinks?.length === 0, "#DOC extract: a library with no accessories yields an empty graph");

  const allowEtc = (m: string) => m === "ETC" || m === "High End Systems";
  const plan = planDavinciPrefill(ex, [{ sku: "ETC:CSPAR" }, { sku: "CSPAR" }, { sku: "419LT" }, { sku: "ETC:7060A1017" }, { sku: "UNRELATED" }], allowEtc);
  ok(plan.documents.length === 1 && plan.documents[0].url === "https://example.test/ds-en.pdf", "#DOC prefill: one document per English datasheet URL (the reissued duplicate is one)");
  ok(plan.documents[0].skus.join(",") === "CSPAR,ETC:CSPAR", "#DOC prefill: the document links to every Peak SKU of the type");
  ok(
    plan.accessoryPairs.map((p) => `${p.parentSku}>${p.accessorySku}x${p.maxQty}`).sort().join(",") ===
      "CSPAR>419LTx2,CSPAR>ETC:7060A1017x2,ETC:CSPAR>419LTx2,ETC:CSPAR>ETC:7060A1017x2",
    "#DOC prefill: a DaVinci link fans out to every matching Peak SKU on both ends"
  );
  ok(plan.stats.typesMatched === 2 && plan.stats.accessoryPairs === 4 && plan.stats.accessoryLinksUnmatched === 0, "#DOC prefill: the report counts matched types and pairs");
  const gated = planDavinciPrefill(ex, [{ sku: "CSPAR" }, { sku: "419LT" }], () => false);
  ok(gated.documents.length === 0 && gated.accessoryPairs.length === 0 && gated.stats.accessoryLinksUnmatched === 1, "#DOC prefill: the manufacturer gate refuses every record");
  const noLens = planDavinciPrefill(ex, [{ sku: "CSPAR" }], allowEtc);
  ok(noLens.accessoryPairs.length === 0 && noLens.stats.accessoryLinksUnmatched === 1, "#DOC prefill: a link with no Peak part on one end writes nothing");
}
```

In `scripts/test-review-regressions.ts`, insert the following immediately before the line `console.log("review regression checks passed");`:

```ts
  /* --- part documents (#DOC): DaVinci pre-fill apply is idempotent --- */
  {
    const { applyPrefill, davinciDocumentId } = await import("@/lib/part-docs/davinci-apply");
    const Docs = await import("@/lib/stores/part-documents");
    const Acc = await import("@/lib/stores/part-accessory-links");
    const url = "https://etc.example/prefill-ds.pdf";
    const plan = {
      libraryTimestamp: "t",
      documents: [{ url, label: "CSPAR Datasheet", typeId: "TY-1", skus: ["PF-CSPAR", "PF-CSPAR2"] }],
      accessoryPairs: [{ parentSku: "PF-CSPAR", accessorySku: "PF-LENS", maxQty: 2, sourceRef: "TY-1" }],
      stats: { parts: 3, typesMatched: 2, documents: 1, documentLinks: 2, accessoryPairs: 1, accessoryLinksUnmatched: 0 },
    };
    const first = await applyPrefill(plan, "DaVinci pre-fill");
    assert.deepEqual(first, { documentsCreated: 1, linksCreated: 2, accessoryWritten: 1, accessoryRemoved: 0 }, "part docs prefill: documents, links and the graph are written");
    const doc = await Docs.getDocument(davinciDocumentId(url));
    assert(doc && doc.source === "davinci" && doc.blobKey === null && doc.sourceUrl === url && doc.language === "en" && doc.title === "CSPAR Datasheet", "part docs prefill: a link-only DaVinci document — nothing downloaded");
    assert.deepEqual(await applyPrefill(plan, "DaVinci pre-fill"), { documentsCreated: 0, linksCreated: 0, accessoryWritten: 0, accessoryRemoved: 0 }, "part docs prefill: a second run writes nothing");
    await Docs.detachDocument(doc!.id, "PF-CSPAR2");
    await applyPrefill(plan, "DaVinci pre-fill");
    assert(!(await Docs.allDocumentLinks()).some((l) => l.partSku === "PF-CSPAR2"), "part docs prefill: a human's detach survives a re-run");
    const dropped = await applyPrefill({ ...plan, accessoryPairs: [] }, "DaVinci pre-fill");
    assert.equal(dropped.accessoryRemoved, 1, "part docs prefill: a pair ETC dropped from the library is removed");
    assert(!(await Acc.allAccessoryLinks()).some((l) => l.source === "davinci" && l.accessorySku === "PF-LENS"), "part docs prefill: …from the live graph");

    const fetchedUrl = "https://etc.example/already-fetched.pdf";
    const fetched = await Docs.createDocument({ kind: "datasheet", fileName: "f.pdf", contentType: "application/pdf", size: 5, blobKey: "part-docs/x/f.pdf", sourceUrl: fetchedUrl, source: "fetch", by: "Jeff" });
    await applyPrefill({ ...plan, documents: [{ url: fetchedUrl, label: "F", typeId: "TY-2", skus: ["PF-F"] }] }, "DaVinci pre-fill");
    assert.equal(await Docs.getDocument(davinciDocumentId(fetchedUrl)), null, "part docs prefill: a URL someone already fetched gets no second document");
    assert((await Docs.allDocumentLinks()).some((l) => l.partSku === "PF-F" && l.documentId === fetched!.id), "part docs prefill: …the part is linked to the fetched one instead");
  }

```


- [ ] **Step 2: Run them to verify they fail**

```bash
env -u DATABASE_URL npm run test:specs 2>&1 | grep -m1 -i 'cannot find module'
```

Expected: `Error: Cannot find module '@/lib/part-docs/davinci-prefill'`.


- [ ] **Step 3: Type the accessory graph**

In `src/lib/davinci/types.ts`, replace this exact text:

```ts
export type DavinciExtract = {
  libraryTimestamp: string;
  generatedAt: number;
  records: readonly DavinciRecord[];
};
```

with:

```ts
/**
 * One end of a DaVinci accessory link (#DOC). Kept for EVERY type a link
 * touches — unlike `records`, which drops types with neither ports nor
 * documents, and lens tubes, clamps and cables are exactly those types.
 */
export type DavinciAccessoryType = {
  manufacturer: string;
  /** `typeInformation.productClassificationId` label: "Product", "Accessory", … */
  classification: string;
  /** Through normalizeSku, like DavinciRecord.modelNumbers. */
  modelNumbers: readonly string[];
};

/** `types[].accessories[]` — a fixture (parent) and a part it accepts. */
export type DavinciAccessoryLink = {
  parentTypeId: string;
  accessoryTypeId: string;
  maxQuantity: number;
  userDefinable: boolean;
};

export type DavinciExtract = {
  libraryTimestamp: string;
  generatedAt: number;
  records: readonly DavinciRecord[];
  /** Part documents (#DOC). Optional so an extract written before it still loads. */
  accessoryTypes?: Readonly<Record<string, DavinciAccessoryType>>;
  accessoryLinks?: readonly DavinciAccessoryLink[];
};
```


- [ ] **Step 4: Emit it from the extractor**

In `src/lib/davinci/extract.ts`, replace this exact text:

```ts
import type { DavinciDoc, DavinciExtract, DavinciRecord } from "./types";
```

with:

```ts
import type { DavinciAccessoryLink, DavinciAccessoryType, DavinciDoc, DavinciExtract, DavinciRecord } from "./types";
```

In `src/lib/davinci/extract.ts`, replace this exact text:

```ts
  const mfrs = labelIndex(C.manufacturers, "manufacturerId");
  const now = Date.now();
```

with:

```ts
  const mfrs = labelIndex(C.manufacturers, "manufacturerId");
  const classes = labelIndex(C.productClassifications, "productClassificationId");
  const now = Date.now();
```

In `src/lib/davinci/extract.ts`, replace this exact text:

```ts
    const ids = new Set<string>();
    for (const rawLut of arr(bag(bag(t.partInformation).generatorData).lookupData)) {
      const l = bag(rawLut);
      for (const k of ["modelNumber", "partNumber"] as const) {
        const v = normalizeSku(str(l[k]));
        if (v) ids.add(v);
      }
    }
    if (!ids.size) continue;
```

with:

```ts
    const ids = typeModelNumbers(t);
    if (!ids.length) continue;
```

In `src/lib/davinci/extract.ts`, replace this exact text:

```ts
      modelNumbers: [...ids],
```

with:

```ts
      modelNumbers: ids,
```

In `src/lib/davinci/extract.ts`, replace this exact text (the last two lines of the file):

```ts
  return { libraryTimestamp: str(L.timestamp), generatedAt: Date.now(), records };
}
```

with:

```ts
  const { accessoryTypes, accessoryLinks } = extractAccessoryGraph(arr(L.types), cats, mfrs, classes);
  return { libraryTimestamp: str(L.timestamp), generatedAt: Date.now(), records, accessoryTypes, accessoryLinks };
}

/** Every model and part number of a type, through normalizeSku. */
function typeModelNumbers(t: Bag): string[] {
  const ids = new Set<string>();
  for (const rawLut of arr(bag(bag(t.partInformation).generatorData).lookupData)) {
    const l = bag(rawLut);
    for (const k of ["modelNumber", "partNumber"] as const) {
      const v = normalizeSku(str(l[k]));
      if (v) ids.add(v);
    }
  }
  return [...ids];
}

/**
 * The fixture → accessory graph (#DOC, spec §6): `types[].accessories[]`
 * `{ typeId, maxQuantity, userDefinable }`, 7,937 links in the 2026-04-21
 * library. Both ends are kept by typeId, and every type a link touches gets
 * its model numbers here — records[] cannot serve, because it drops types
 * with neither ports nor documents, which is what most accessories are. A
 * link touching ETC's internal scratch category, or a type with no
 * identifiers (nothing a Peak SKU could ever match), is dropped.
 */
function extractAccessoryGraph(
  types: unknown[],
  cats: Map<string, string>,
  mfrs: Map<string, string>,
  classes: Map<string, string>
): { accessoryTypes: Record<string, DavinciAccessoryType>; accessoryLinks: DavinciAccessoryLink[] } {
  const byId = new Map<string, Bag>();
  for (const raw of types) {
    const t = bag(raw);
    const id = str(t.typeId);
    if (id && !EXCLUDED_CATEGORIES.has(cats.get(str(bag(t.typeInformation).categoryId)) || "")) byId.set(id, t);
  }
  const accessoryTypes: Record<string, DavinciAccessoryType> = {};
  const describe = (id: string): boolean => {
    if (accessoryTypes[id]) return true;
    const t = byId.get(id);
    if (!t) return false;
    const modelNumbers = typeModelNumbers(t);
    if (!modelNumbers.length) return false;
    const ti = bag(t.typeInformation);
    accessoryTypes[id] = {
      manufacturer: mfrs.get(str(ti.manufacturerId)) || "",
      classification: classes.get(str(ti.productClassificationId)) || "",
      modelNumbers,
    };
    return true;
  };
  const accessoryLinks: DavinciAccessoryLink[] = [];
  const seen = new Set<string>();
  for (const [parentTypeId, t] of byId) {
    for (const rawAcc of arr(t.accessories)) {
      const a = bag(rawAcc);
      const accessoryTypeId = str(a.typeId);
      if (!accessoryTypeId || accessoryTypeId === parentTypeId) continue;
      const key = `${parentTypeId}\u0000${accessoryTypeId}`;
      if (seen.has(key)) continue;
      if (!describe(parentTypeId) || !describe(accessoryTypeId)) continue;
      seen.add(key);
      const max = Number(a.maxQuantity);
      accessoryLinks.push({
        parentTypeId,
        accessoryTypeId,
        maxQuantity: Number.isFinite(max) && max > 0 ? max : 1,
        userDefinable: a.userDefinable === true,
      });
    }
  }
  return { accessoryTypes, accessoryLinks };
}
```

In `src/lib/davinci/extract.ts`, replace this exact text:

```ts
 * `library.json` into the ~1.39 MB `data/davinci-extract.json` that ships in
 * the repo: 1,720 device types, 14,108 indexed identifiers, 6,168 ports and
 * 2,828 document links.
```

with:

```ts
 * `library.json` into the ~2.65 MB `data/davinci-extract.json` that ships in
 * the repo: 1,720 device types, 14,108 indexed identifiers, 6,168 ports,
 * 2,828 document links and — since part documents (#DOC) — the fixture →
 * accessory graph: 6,702 links over 1,753 types.
```

In `scripts/davinci-extract.ts`, replace this exact text:

```ts
      `${extract.records.reduce((a, r) => a + r.docs.length, 0)} docs · ` +
```

with:

```ts
      `${extract.records.reduce((a, r) => a + r.docs.length, 0)} docs · ` +
      `${extract.accessoryLinks?.length ?? 0} accessory links over ${Object.keys(extract.accessoryTypes ?? {}).length} types · ` +
```

In `scripts/davinci-extract.ts`, replace this exact text:

```ts
 * gitignored, this machine only, and writes the ~1.39 MB extract that IS
```

with:

```ts
 * gitignored, this machine only, and writes the ~2.65 MB extract that IS
```


- [ ] **Step 5: Regenerate the committed extract**

The 44 MB `library.json` lives only in the main checkout's gitignored `data/davinci/`. Copy it (read-only source; `data/davinci/` is gitignored here too), regenerate, and prove `records` did not move:

```bash
mkdir -p data/davinci/source/2026-09-02T01-37-52-850Z
cp /Users/sm/Downloads/peak-app/data/davinci/source/2026-09-02T01-37-52-850Z/library.json data/davinci/source/2026-09-02T01-37-52-850Z/
git show HEAD:data/davinci-extract.json > "${TMPDIR:-/tmp}/pd-extract-before.json"
npm run davinci:extract 2>&1 | tail -1
node -e 'const a=require(process.argv[1]),b=require("./data/davinci-extract.json");console.log("records identical:",JSON.stringify(a.records)===JSON.stringify(b.records),"links:",b.accessoryLinks.length,"types:",Object.keys(b.accessoryTypes).length)' "${TMPDIR:-/tmp}/pd-extract-before.json"
git status --short data/
```

Expected: `[davinci] 1720 records · 14108 identifiers · 6168 ports · 2828 docs · 6702 accessory links over 1753 types · 440 contested identifiers · 2.65 MB → data/davinci-extract.json`, then `records identical: true links: 6702 types: 1753`, and `git status` lists only ` M data/davinci-extract.json` (never `data/davinci/`).


- [ ] **Step 6: Write the pure pre-fill plan**

Create `src/lib/part-docs/davinci-prefill.ts`:

```ts
import { normalizeSku } from "@/lib/davinci/sku";
import type { DavinciExtract } from "@/lib/davinci/types";
import type { AccessoryPair } from "./types";

/**
 * DaVinci pre-fill plan (#DOC, spec §6) — pure. Maps ETC's library onto
 * Peak's catalog:
 *  - every English DaVinci datasheet becomes ONE shared, link-only document
 *    (keyed by URL — the same URL on several types is one document) linked
 *    to every Peak part whose SKU matches one of those types;
 *  - every `types[].accessories` link becomes parent → accessory pairs
 *    between the matching Peak SKUs. A Peak SKU claimed by several DaVinci
 *    types (a Product and an Accessory classification of one model) is
 *    simply the same SKU on both ends — pairs are merged per (parent,
 *    accessory), keeping the larger maxQty.
 * No file is downloaded here or anywhere in the pre-fill: fetching is a
 * separate, explicit step.
 *
 * `parts` must already be scoped to the manufacturer DaVinci may enrich, and
 * `allowed` is that manufacturer gate on the DaVinci side
 * (catalog-davinci-apply.peakMfrFor) — SKU matching alone is not
 * brand-aware (#162: Draper "450" normalizes to ETC's "450").
 */

export type PrefillDoc = { url: string; label: string; typeId: string; skus: string[] };

export type PrefillStats = {
  parts: number;
  typesMatched: number;
  documents: number;
  documentLinks: number;
  accessoryPairs: number;
  accessoryLinksUnmatched: number;
};

export type PrefillPlan = {
  libraryTimestamp: string;
  documents: PrefillDoc[];
  accessoryPairs: AccessoryPair[];
  stats: PrefillStats;
};

export function planDavinciPrefill(
  extract: DavinciExtract,
  parts: ReadonlyArray<{ sku: string }>,
  allowed: (davinciManufacturer: string) => boolean
): PrefillPlan {
  const bySku = new Map<string, string[]>();
  for (const p of parts) {
    const k = normalizeSku(p.sku);
    if (!k) continue;
    const list = bySku.get(k);
    if (list) list.push(p.sku);
    else bySku.set(k, [p.sku]);
  }
  const matchedTypes = new Set<string>();
  const skusFor = (typeId: string, modelNumbers: readonly string[]): string[] => {
    const out = new Set<string>();
    for (const m of modelNumbers) for (const s of bySku.get(m) ?? []) out.add(s);
    if (out.size) matchedTypes.add(typeId);
    return [...out];
  };

  const docs = new Map<string, { url: string; label: string; typeId: string; skus: Set<string> }>();
  for (const r of extract.records) {
    if (!allowed(r.manufacturer)) continue;
    const datasheets = r.docs.filter((d) => d.kind === "datasheet" && d.url);
    if (!datasheets.length) continue;
    const skus = skusFor(r.typeId, r.modelNumbers);
    if (!skus.length) continue;
    for (const d of datasheets) {
      let entry = docs.get(d.url);
      if (!entry) docs.set(d.url, (entry = { url: d.url, label: d.label || r.displayName, typeId: r.typeId, skus: new Set() }));
      for (const s of skus) entry.skus.add(s);
    }
  }

  const types = extract.accessoryTypes ?? {};
  const pairs = new Map<string, AccessoryPair>();
  let unmatched = 0;
  for (const l of extract.accessoryLinks ?? []) {
    const parent = types[l.parentTypeId];
    const accessory = types[l.accessoryTypeId];
    if (!parent || !accessory || !allowed(parent.manufacturer) || !allowed(accessory.manufacturer)) {
      unmatched++;
      continue;
    }
    const ps = skusFor(l.parentTypeId, parent.modelNumbers);
    const as = skusFor(l.accessoryTypeId, accessory.modelNumbers);
    if (!ps.length || !as.length) {
      unmatched++;
      continue;
    }
    for (const parentSku of ps) {
      for (const accessorySku of as) {
        if (parentSku === accessorySku) continue;
        const key = `${parentSku}\u0000${accessorySku}`;
        const prior = pairs.get(key);
        if (prior) prior.maxQty = Math.max(prior.maxQty ?? 0, l.maxQuantity);
        else pairs.set(key, { parentSku, accessorySku, maxQty: l.maxQuantity, sourceRef: l.parentTypeId });
      }
    }
  }

  const documents = [...docs.values()].map((d) => ({ url: d.url, label: d.label, typeId: d.typeId, skus: [...d.skus].sort() }));
  return {
    libraryTimestamp: extract.libraryTimestamp,
    documents,
    accessoryPairs: [...pairs.values()],
    stats: {
      parts: parts.length,
      typesMatched: matchedTypes.size,
      documents: documents.length,
      documentLinks: documents.reduce((n, d) => n + d.skus.length, 0),
      accessoryPairs: pairs.size,
      accessoryLinksUnmatched: unmatched,
    },
  };
}
```


- [ ] **Step 7: Write the apply step**

Create `src/lib/part-docs/davinci-apply.ts`:

```ts
import { createHash } from "node:crypto";
import { listDocs } from "@/db/doc-store";
import { mfrKey } from "@/lib/catalog-books";
import { peakMfrFor } from "@/lib/catalog-davinci-apply";
import { loadExtract } from "@/lib/davinci/load";
import { list as allParts } from "@/lib/stores/catalog";
import { syncAccessoryLinks } from "@/lib/stores/part-accessory-links";
import { allDocuments, createDocument, ensureLinks } from "@/lib/stores/part-documents";
import { planDavinciPrefill, type PrefillPlan } from "./davinci-prefill";

/**
 * DaVinci pre-fill, the writing half (#DOC, spec §6). Server/script only.
 * Writes link-only `part_documents` (source "davinci", sourceUrl only — no
 * ETC file is downloaded or rehosted), their part links, and the "davinci"
 * scope of `part_accessory_links`. Idempotent: document ids derive from the
 * URL, links a human detached stay detached (ensureLinks), and the graph
 * scope is synced (a pair ETC dropped from the library is soft-deleted).
 */

/** Deterministic per URL, so a re-run never mints a second document. */
export function davinciDocumentId(url: string): string {
  return `PD-D${createHash("sha1").update(url).digest("hex").slice(0, 15)}`;
}

/** Plan against the committed extract and the ETC-scoped catalog. */
export async function planPrefillFromDavinci(): Promise<PrefillPlan> {
  const wanted = mfrKey("ETC");
  const parts = (await allParts()).filter((p) => mfrKey(p.mfr) === wanted);
  return planDavinciPrefill(loadExtract(), parts, (m) => {
    const peak = peakMfrFor({ manufacturer: m });
    return !!peak && mfrKey(peak) === wanted;
  });
}

export type PrefillResult = { documentsCreated: number; linksCreated: number; accessoryWritten: number; accessoryRemoved: number };

export async function applyPrefill(plan: PrefillPlan, by: string): Promise<PrefillResult> {
  const everIds = new Set((await listDocs("part_documents", { includeDeleted: true })).map((d) => d.id));
  const byUrl = new Map<string, string>();
  for (const d of await allDocuments()) if (d.sourceUrl && !byUrl.has(d.sourceUrl)) byUrl.set(d.sourceUrl, d.id);

  let documentsCreated = 0;
  const pairs: Array<{ partSku: string; documentId: string; kind: "datasheet" }> = [];
  for (const d of plan.documents) {
    let id = byUrl.get(d.url);
    if (!id) {
      id = davinciDocumentId(d.url);
      if (!everIds.has(id)) {
        const created = await createDocument({
          id,
          kind: "datasheet",
          title: d.label,
          fileName: `${d.label.replace(/[\\/]+/g, "-").trim() || "Datasheet"}.pdf`,
          contentType: "application/pdf",
          size: 0,
          blobKey: null,
          sourceUrl: d.url,
          source: "davinci",
          sourceRef: d.typeId,
          language: "en",
          by,
        });
        if (created) documentsCreated++;
        everIds.add(id);
      }
      byUrl.set(d.url, id);
    }
    for (const sku of d.skus) pairs.push({ partSku: sku, documentId: id, kind: "datasheet" });
  }
  const linksCreated = await ensureLinks(pairs, by);
  const acc = await syncAccessoryLinks({ source: "davinci" }, plan.accessoryPairs);
  return { documentsCreated, linksCreated, accessoryWritten: acc.written, accessoryRemoved: acc.removed };
}
```


- [ ] **Step 8: Add the script**

Create `scripts/part-docs-davinci.ts`:

```ts
/**
 * DaVinci → part documents pre-fill: report, dry run, apply (#DOC, spec §6).
 *
 *   npm run part-docs:davinci                     → the report, writes nothing
 *   npm run part-docs:davinci -- --apply          → dry run, writes nothing
 *   npm run part-docs:davinci -- --apply --commit → write (hosted also needs --yes)
 *
 * Writes link-only datasheet documents (source "davinci", sourceUrl only —
 * nothing is downloaded), their links to ETC parts, and the DaVinci
 * accessory graph. The same write is the Datasheets page's admin
 * "Pre-fill from DaVinci" button. Scoped to ETC like davinci:enrich.
 */
import { resolveDbTarget, requireHostedConfirmation } from "./db-target";
import { applyPrefill, planPrefillFromDavinci } from "../src/lib/part-docs/davinci-apply";

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const n = (x: number) => x.toLocaleString("en-US");

async function main() {
  const { hosted } = resolveDbTarget(commit ? "part-docs:davinci (WRITE)" : "part-docs:davinci (read-only)");
  if (commit) requireHostedConfirmation(hosted, args);
  const plan = await planPrefillFromDavinci();
  const s = plan.stats;
  console.log(`\n  library                ${plan.libraryTimestamp}`);
  console.log(`  ETC parts scanned      ${n(s.parts)}`);
  console.log(`  DaVinci types matched  ${n(s.typesMatched)}`);
  console.log(`  datasheet documents    ${n(s.documents)} (${n(s.documentLinks)} part links)`);
  console.log(`  accessory pairs        ${n(s.accessoryPairs)} (${n(s.accessoryLinksUnmatched)} DaVinci links with no Peak part on one end)\n`);
  if (!args.includes("--apply")) {
    console.log("  Report only. To apply: npm run part-docs:davinci -- --apply --commit");
    console.log("  (a hosted DATABASE_URL target also needs --yes)\n");
    return;
  }
  if (!commit) {
    console.log("  DRY RUN — nothing written. Add --commit.\n");
    return;
  }
  const r = await applyPrefill(plan, "DaVinci pre-fill");
  console.log(`  WROTE ${n(r.documentsCreated)} documents, ${n(r.linksCreated)} links, ${n(r.accessoryWritten)} accessory links (${n(r.accessoryRemoved)} removed).\n`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
```

In `package.json`, replace this exact text:

```json
    "part-docs:backfill": "tsx scripts/part-docs-backfill.ts",
```

with:

```json
    "part-docs:backfill": "tsx scripts/part-docs-backfill.ts",
    "part-docs:davinci": "tsx scripts/part-docs-davinci.ts",
```

Prove the report runs, on a throwaway datadir only (never `.data/pglite`):

```bash
D=$(mktemp -d); env -u DATABASE_URL PGLITE_PATH="$D" npm run part-docs:davinci 2>&1 | tail -8; rm -rf "$D"
```

Expected: the report with `library 2026-04-21T13:53:05.816Z`, `ETC parts scanned 0`, `accessory pairs 0 (6,702 DaVinci links with no Peak part on one end)` and `Report only. To apply: …` — nothing written.


- [ ] **Step 9: Add the admin action and button**

In `src/app/(app)/catalog/documents/actions.ts`, replace this exact text (the whole import block):

```ts
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { blobEnabled } from "@/lib/blob";
import { searchDocs } from "@/db/doc-store";
import { get as getPart, list as listCatalog, type CatalogPart } from "@/lib/stores/catalog";
import {
  allDocuments,
  attachDocument,
  createDocument,
  detachDocument,
  getDocument,
  replaceDocumentFile,
} from "@/lib/stores/part-documents";
import { buildFetchContext, fetchSlot, type FetchOutcome, type FetchTarget } from "@/lib/part-docs/fetch-links";
import { matchFileRows, type FilenameMatch } from "@/lib/part-docs/filename-match";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { setDocNotNeeded } from "@/lib/part-docs/not-needed";
import { alsoCoversSuggestions, type Suggestion } from "@/lib/part-docs/suggest";
import { FETCH_BATCH_SIZE, isDocumentId, isPartDocKind, type PartDocKind } from "@/lib/part-docs/types";
import { verifyUploadedBlob } from "@/lib/part-docs/verify-upload";
```

with:

```ts
import { revalidatePath } from "next/cache";
import { requirePerm, requireUser } from "@/lib/session";
import { blobEnabled } from "@/lib/blob";
import { searchDocs } from "@/db/doc-store";
import { get as getPart, list as listCatalog, type CatalogPart } from "@/lib/stores/catalog";
import {
  allDocuments,
  attachDocument,
  createDocument,
  detachDocument,
  getDocument,
  replaceDocumentFile,
} from "@/lib/stores/part-documents";
import { applyPrefill, planPrefillFromDavinci } from "@/lib/part-docs/davinci-apply";
import { buildFetchContext, fetchSlot, type FetchOutcome, type FetchTarget } from "@/lib/part-docs/fetch-links";
import { matchFileRows, type FilenameMatch } from "@/lib/part-docs/filename-match";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { setDocNotNeeded } from "@/lib/part-docs/not-needed";
import { alsoCoversSuggestions, type Suggestion } from "@/lib/part-docs/suggest";
import { FETCH_BATCH_SIZE, isDocumentId, isPartDocKind, type PartDocKind } from "@/lib/part-docs/types";
import { verifyUploadedBlob } from "@/lib/part-docs/verify-upload";
```

Append to the end of `src/app/(app)/catalog/documents/actions.ts`:

```ts

/** Admin: write the DaVinci pre-fill (link-only ETC datasheets + the ETC
 *  accessory graph). Idempotent — a second click writes nothing new. The
 *  same write as `npm run part-docs:davinci -- --apply --commit`. */
export async function prefillFromDavinciAction(): Promise<DocActionResult<{ summary: string }>> {
  const user = await requirePerm("manage_users");
  const plan = await planPrefillFromDavinci();
  const r = await applyPrefill(plan, user.name);
  revalidate();
  return {
    ok: true,
    summary:
      `${r.documentsCreated} new datasheet link${r.documentsCreated === 1 ? "" : "s"}, ${r.linksCreated} part link${r.linksCreated === 1 ? "" : "s"}, ` +
      `${r.accessoryWritten} accessory link${r.accessoryWritten === 1 ? "" : "s"} written, ${r.accessoryRemoved} removed ` +
      `(${plan.stats.typesMatched} DaVinci types matched ${plan.stats.parts} ETC parts).`,
  };
}
```

Create `src/app/(app)/catalog/documents/davinci-prefill-button.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { prefillFromDavinciAction } from "./actions";

/** Admin-only (#DOC, spec §6): write ETC's DaVinci datasheet links and
 *  accessory graph. Nothing is downloaded — Fetch is a separate step. */
export default function DavinciPrefillButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button
        type="button"
        className="pk-btn-outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await prefillFromDavinciAction();
            setMsg(r.ok ? { ok: true, text: r.summary } : { ok: false, text: r.error });
            if (r.ok) router.refresh();
          })
        }
      >
        {pending ? "Pre-filling…" : "Pre-fill from DaVinci"}
      </button>
      {msg && <span role={msg.ok ? "status" : "alert"} style={{ fontSize: 12, color: msg.ok ? "#1f7a52" : "#b4543a" }}>{msg.text}</span>}
    </span>
  );
}
```

In `src/app/(app)/catalog/documents/page.tsx`, replace this exact text:

```tsx
import { requireUser } from "@/lib/session";
```

with:

```tsx
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
```

In `src/app/(app)/catalog/documents/page.tsx`, replace this exact text:

```tsx
import DocumentsClient from "./documents-client";
```

with:

```tsx
import DocumentsClient from "./documents-client";
import DavinciPrefillButton from "./davinci-prefill-button";
```

In `src/app/(app)/catalog/documents/page.tsx`, replace this exact text:

```tsx
  const [, sp] = await Promise.all([requireUser(), searchParams]);
```

with:

```tsx
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
```

In `src/app/(app)/catalog/documents/page.tsx`, replace this exact text:

```tsx
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/catalog/documents/upload"
```

with:

```tsx
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {can("manage_users", user.roles) && <DavinciPrefillButton />}
          <Link href="/catalog/documents/upload"
```

`loadExtract` reads the JSON with `fs` at run time, which output file tracing cannot see — without this the admin action would fail on Vercel with ENOENT:

In `next.config.ts`, replace this exact text:

```ts
  experimental: { serverActions: { bodySizeLimit: "1200kb" } },
```

with:

```ts
  experimental: { serverActions: { bodySizeLimit: "1200kb" } },
  // Part documents (#DOC): the Datasheets page's admin "Pre-fill from
  // DaVinci" action reads the committed extract with fs at run time, which
  // file tracing cannot see — ship it with that route's function.
  outputFileTracingIncludes: { "/catalog/documents": ["./data/davinci-extract.json"] },
```


- [ ] **Step 10: Run the gates, and prove the extract ships with the route**

```bash
npx tsc --noEmit -p .
```

Expected: no output, exit 0.

```bash
env -u DATABASE_URL npm run test:specs > "${TMPDIR:-/tmp}/pd-specs.log" 2>&1; tail -1 "${TMPDIR:-/tmp}/pd-specs.log"; grep '^FAIL' "${TMPDIR:-/tmp}/pd-specs.log"
```

Expected: `ALL PASSED` and no `FAIL` lines. (One pre-existing flake exists — `redeem: tampered code -> not ok`, a random-code test that fails about one run in sixty; if it is the only FAIL, re-run.)

Expected additionally: `grep -c '^PASS #DOC' "${TMPDIR:-/tmp}/pd-specs.log"` prints `11`, and the existing `#162` DaVinci assertions still all pass.

```bash
env -u DATABASE_URL npm run test:review:regressions 2>&1 | tail -2
```

Expected: `review regression checks passed` then `quote email regression checks passed`.

```bash
npx eslint 2>&1 | grep problems
```

Expected: `✖ N problems (0 errors, N warnings)` with N ≤ 111 (the baseline is 111; Task 8 removes one).

```bash
env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build > "${TMPDIR:-/tmp}/pd-build.log" 2>&1; echo "build exit: $?"
grep -o "davinci-extract.json" ".next/server/app/(app)/catalog/documents/page.js.nft.json"
rm -rf .next
```

Expected: `build exit: 0` and `davinci-extract.json` (the trace includes it).


- [ ] **Step 11: Commit**

```bash
git add src/lib/davinci/types.ts src/lib/davinci/extract.ts scripts/davinci-extract.ts data/davinci-extract.json src/lib/part-docs/davinci-prefill.ts src/lib/part-docs/davinci-apply.ts scripts/part-docs-davinci.ts package.json 'src/app/(app)/catalog/documents' next.config.ts scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
git commit -m "feat(part-docs): DaVinci accessory graph in the extract; link-only ETC datasheets + graph pre-fill (admin + CLI)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 11: Consumers I — Specs coverage and the client package (once per document, coverage in context)

**Files:**
- Modify: `src/app/(app)/design/specs/coverage.ts` (drop `hasDatasheet`; `coverageRows` takes the rule's answer)
- Modify: `src/app/(app)/design/specs/library/page.tsx`
- Create: `src/lib/part-docs/package.ts` (pure)
- Modify: `src/lib/client-package.ts` (manifest carries `documents`, `covered`, per-item `datasheet`/`datasheetCoveredBy`/`specsheet`)
- Modify: `src/lib/client-package-server.ts` (zip each document once; Grid and quote packages; no more `catalog.find` inside loops)
- Modify: `src/app/api/grid/[id]/package-manifest/route.ts`
- Test: `scripts/test-review-and-spec.ts` (edit the existing Specs coverage assertions; append a `Task 11` block)

**Interfaces:**
- Consumes: Task 2 (`slotCoverage`, `datasheetSatisfiedSkus`, `CoverageIndex`), Task 3 (`loadPartDocsState`).
- Produces (`src/app/(app)/design/specs/coverage.ts`): `coverageRows(parts, articleIdBySku, onBom, datasheetOk: ReadonlySet<string>)`; `hasDatasheet` and the `docs`/`productMetadata`/`datasheetName` fields of `CoveragePart` are gone ("link only" no longer counts, spec §7).
- Produces (`package.ts`, pure): `type PackageDocRef = { documentId; name }`, `type PackageDocument = PackageDocRef & { kind; skus: string[] }`, `type PackageSkuDocs = { datasheet; datasheetCoveredBy: string[]; datasheetOk: boolean; specsheet }`, `resolvePackageDocs(index | null | undefined, skus): { bySku: Map<string, PackageSkuDocs>; documents: PackageDocument[] }`, `packageEntryName(doc, used, safe): string`.
- Produces (`client-package.ts`): `coveredNote(sku, by): { sku; by; note }`; `buildClientPackageManifest(project, catalog, requestedOptionId?, docs?: CoverageIndex | null)`; `ClientPackageItem.datasheet: PackageDocRef | null`, `.datasheetCoveredBy: string[]`, `.specsheet: PackageDocRef | null`; `ClientPackageManifest.documents: PackageDocument[]`, `.covered`; `ClientPackageManifest.datasheets` is removed (its only readers are the two files changed here).

- [ ] **Step 1: Write the failing test**

First point the existing Specs coverage assertions at the new contract — whether a part "has a datasheet" is the coverage rule's answer, handed in as a set:

In `scripts/test-review-and-spec.ts`, replace this exact text:

```ts
  ON_BOM_WINDOW_MS, skusFromQuoteSpec, skusOnBomSince, hasDatasheet, coverageRows, filterCoverage, articleIdMapForParts,
```

with:

```ts
  ON_BOM_WINDOW_MS, skusFromQuoteSpec, skusOnBomSince, coverageRows, filterCoverage, articleIdMapForParts,
```

In `scripts/test-review-and-spec.ts`, replace this exact text:

```ts
  ok(hasDatasheet({ sku: "D1", docs: [{ kind: "datasheet" }] }), "coverage: a DaVinci datasheet link counts as a datasheet");
  ok(!hasDatasheet({ sku: "D2", docs: [{ kind: "manual" }] }), "coverage: a manual alone is not a datasheet");
  ok(hasDatasheet({ sku: "D3", productMetadata: { datasheets: [{ kind: "cut-sheet" }] } }), "coverage: a researched cut sheet counts");
  ok(!hasDatasheet({ sku: "D4", productMetadata: { datasheets: [{ kind: "guide-spec" }] } }), "coverage: a guide spec alone is not a datasheet");
  const articleIdBySku = articleIdMapForParts(parts as never, articles, sections);
  const rows = coverageRows(parts as never, articleIdBySku, new Set(["P1", "P3"]));
```

with:

```ts
  // #DOC: whether a part "has a datasheet" is the part-documents coverage
  // rule's answer (datasheetSatisfiedSkus, tested in the #DOC blocks); the
  // table only reports the set it is handed. A link-only URL no longer counts.
  const articleIdBySku = articleIdMapForParts(parts as never, articles, sections);
  const rows = coverageRows(parts as never, articleIdBySku, new Set(["P1", "P3"]), new Set(["P1"]));
```

then append the package block:

Append to the end of `scripts/test-review-and-spec.ts`:

```ts

/* ======================================================================
   Part documents (#DOC) — Task 11: the client package carries each
   document once, covers accessories only in context, and says so.
   ====================================================================== */
import { resolvePackageDocs, packageEntryName } from "@/lib/part-docs/package";
import { coveredNote } from "@/lib/client-package";
{
  const file = (id: string, kind: "datasheet" | "specsheet", name: string): PdDoc => ({
    id, kind, title: name, fileName: name, contentType: "application/pdf", size: 1, blobKey: `part-docs/${id}/${name}`, sourceUrl: null,
    source: "upload", uploadedAt: 1, uploadedBy: "t", history: [],
  });
  const idx = buildCoverageIndex({
    documents: [file("PD-pkgfix00000", "datasheet", "S4 Datasheet.pdf"), file("PD-pkgspec0000", "specsheet", "S4 Guide.docx")],
    links: [
      { id: "1", partSku: "PKG-FIX", documentId: "PD-pkgfix00000", kind: "datasheet", createdAt: 1, createdBy: "t" },
      { id: "2", partSku: "PKG-FIX", documentId: "PD-pkgspec0000", kind: "specsheet", createdAt: 1, createdBy: "t" },
    ],
    accessoryLinks: [
      { id: "a", parentSku: "PKG-FIX", accessorySku: "PKG-LENS", source: "assembly" },
      { id: "b", parentSku: "PKG-FIX", accessorySku: "PKG-CLAMP", source: "davinci" },
    ],
    parts: [{ sku: "PKG-NN", docNotNeeded: { datasheet: true } }],
  });
  const withFix = resolvePackageDocs(idx, ["PKG-FIX", "PKG-LENS", "PKG-CLAMP", "PKG-NN"]);
  ok(withFix.documents.length === 2 && withFix.documents.find((d) => d.kind === "datasheet")!.skus.join(",") === "PKG-FIX,PKG-LENS,PKG-CLAMP", "part docs package: the fixture datasheet is listed once, serving the fixture and its accessories");
  ok(withFix.bySku.get("PKG-LENS")!.datasheetCoveredBy.join(",") === "PKG-FIX" && withFix.bySku.get("PKG-LENS")!.datasheetOk, "part docs package: an accessory on the same quote is covered by its fixture");
  ok(withFix.bySku.get("PKG-NN")!.datasheetOk && !withFix.bySku.get("PKG-NN")!.datasheet, "part docs package: not-needed is no gap and no file");
  const alone = resolvePackageDocs(idx, ["PKG-LENS"]);
  ok(!alone.bySku.get("PKG-LENS")!.datasheetOk && alone.documents.length === 0, "part docs package: an accessory quoted without its fixture is not covered on that quote");
  ok(!resolvePackageDocs(null, ["PKG-FIX"]).bySku.get("PKG-FIX")!.datasheetOk, "part docs package: no index means no documents");
  const used = new Set<string>();
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, "_");
  ok(packageEntryName({ documentId: "PD-a", kind: "datasheet", name: "S4 Datasheet.pdf" }, used, safe) === "datasheets/S4_Datasheet.pdf", "part docs package: datasheets go under datasheets/");
  ok(packageEntryName({ documentId: "PD-b", kind: "datasheet", name: "S4 Datasheet.pdf" }, used, safe) === "datasheets/PD-b-S4_Datasheet.pdf", "part docs package: a clashing name is prefixed with its id");
  ok(packageEntryName({ documentId: "PD-c", kind: "specsheet", name: "g.docx" }, used, safe) === "specsheets/g.docx", "part docs package: spec sheets go under specsheets/");
  ok(coveredNote("PKG-LENS", ["PKG-FIX"]).note === "covered by PKG-FIX", "part docs package: the gap report says covered by <fixture>");

  const part = (sku: string) => ({ id: sku, sku, desc: sku, category: "Lighting", unit: "ea", list: 1, cost: 1 });
  const grid = (placements: string[]) => ({
    id: "GRD-PKG", name: "P", createdAt: 1, quoteId: null,
    options: [{ id: "opt-a", name: "Base", quoteId: null, createdAt: 1 }],
    placements: placements.map((partId, i) => ({ id: `gp-${i}`, optionId: "opt-a", partId })),
  });
  const m = buildClientPackageManifest(grid(["PKG-FIX", "PKG-LENS", "PKG-LENS"]) as never, [part("PKG-FIX"), part("PKG-LENS")] as never, "opt-a", idx);
  ok(!m.gaps.some((g) => g.kind === "missing-datasheet"), "part docs package: a Grid design with the fixture has no datasheet gap for its lens");
  ok(m.covered.length === 1 && m.covered[0].note === "covered by PKG-FIX" && m.documents.length === 2 && m.counts.datasheets === 1, "part docs package: the manifest lists the covered accessory and each document once");
  const lensOnly = buildClientPackageManifest(grid(["PKG-LENS"]) as never, [part("PKG-FIX"), part("PKG-LENS")] as never, "opt-a", idx);
  ok(lensOnly.gaps.some((g) => g.kind === "missing-datasheet" && g.sku === "PKG-LENS"), "part docs package: a lens placed without its fixture is a missing-datasheet gap on that design");
}
```


- [ ] **Step 2: Run it to verify it fails**

```bash
env -u DATABASE_URL npm run test:specs 2>&1 | grep -m1 -i 'cannot find module'
```

Expected: `Error: Cannot find module '@/lib/part-docs/package'`.


- [ ] **Step 3: Specs coverage reads the rule**

In `src/app/(app)/design/specs/coverage.ts`, replace this exact text (the `CoveragePart` type and `hasDatasheet`):

```ts
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

export function hasDatasheet(p: CoveragePart): boolean {
  if (p.datasheetName) return true;
  if ((p.docs ?? []).some((d) => d.kind === "datasheet")) return true;
  if ((p.productMetadata?.datasheets ?? []).some((d) => d.kind === "datasheet" || d.kind === "cut-sheet")) return true;
  return false;
}

```

with:

```ts
/** What coverage needs off a catalog part — a superset of SpecPartLike, so a
 *  real CatalogPart is structurally assignable with no cast. */
export type CoveragePart = SpecPartLike & { desc?: string };

```

In `src/app/(app)/design/specs/coverage.ts`, replace this exact text:

```ts
/** One row per catalog part — mapped to an article or not, spec'd or not.
 *  `bySku` (for specStateOf's same-as resolution) is built once here, not
 *  per part. `articleIdBySku` is the shared, already-computed map from
 *  `articleIdMapForParts` — see final fix wave item 10. */
export function coverageRows(
  parts: CoveragePart[],
  articleIdBySku: Map<string, string | null>,
  onBom: Set<string>
): CoverageRow[] {
```

with:

```ts
/** One row per catalog part — mapped to an article or not, spec'd or not.
 *  `bySku` (for specStateOf's same-as resolution) is built once here, not
 *  per part. `articleIdBySku` is the shared, already-computed map from
 *  `articleIdMapForParts` — see final fix wave item 10. `datasheetOk` is
 *  the part-documents coverage rule's answer (#DOC, spec §7 —
 *  datasheetSatisfiedSkus): own file, not needed, or covered by a fixture;
 *  a link nobody has fetched no longer counts. */
export function coverageRows(
  parts: CoveragePart[],
  articleIdBySku: Map<string, string | null>,
  onBom: Set<string>,
  datasheetOk: ReadonlySet<string>
): CoverageRow[] {
```

In `src/app/(app)/design/specs/coverage.ts`, replace this exact text:

```ts
    hasDatasheet: hasDatasheet(p),
```

with:

```ts
    hasDatasheet: datasheetOk.has(p.sku),
```

In `src/app/(app)/design/specs/library/page.tsx`, replace this exact text:

```tsx
import type { SpecCategoryArticle } from "@/lib/specs/articles";
```

with:

```tsx
import type { SpecCategoryArticle } from "@/lib/specs/articles";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { datasheetSatisfiedSkus } from "@/lib/part-docs/coverage";
```

In `src/app/(app)/design/specs/library/page.tsx`, replace this exact text:

```tsx
  const coverageAll = coverageRows(parts, articleIdBySku, onBom);
```

with:

```tsx
  // #DOC: the datasheet column is the part-documents coverage rule.
  const { index: docIndex } = await loadPartDocsState(parts);
  const datasheetOk = datasheetSatisfiedSkus(docIndex, parts.map((p) => p.sku));
  const coverageAll = coverageRows(parts, articleIdBySku, onBom, datasheetOk);
```


- [ ] **Step 4: Write the pure package-document resolver**

Create `src/lib/part-docs/package.ts`:

```ts
import { slotCoverage, type CoverageIndex } from "./coverage";
import type { PartDocKind } from "./types";

/**
 * Which documents a client package carries (#DOC, spec §3 "Client
 * package"). Pure. The context is the package's own SKU list: an accessory
 * is covered only by a fixture that is on the same quote/design; one quoted
 * without any of its fixtures is a `missing-datasheet` gap on that package
 * only. Every document is listed ONCE with every SKU it serves, so a fixture
 * datasheet that also covers its lens and clamps goes in the zip one time.
 */

export type PackageDocRef = { documentId: string; name: string };
export type PackageDocument = PackageDocRef & { kind: PartDocKind; skus: string[] };

export type PackageSkuDocs = {
  datasheet: PackageDocRef | null;
  /** Fixture SKUs whose datasheet covers this part on this package. */
  datasheetCoveredBy: string[];
  /** True when no datasheet is needed (own, covered, or marked not needed). */
  datasheetOk: boolean;
  specsheet: PackageDocRef | null;
};

export function resolvePackageDocs(
  index: CoverageIndex | null | undefined,
  skus: readonly string[]
): { bySku: Map<string, PackageSkuDocs>; documents: PackageDocument[] } {
  const bySku = new Map<string, PackageSkuDocs>();
  const documents = new Map<string, PackageDocument>();
  const context = new Set(skus);
  const take = (kind: PartDocKind, sku: string, id: string, name: string): PackageDocRef => {
    let d = documents.get(id);
    if (!d) documents.set(id, (d = { documentId: id, name, kind, skus: [] }));
    if (!d.skus.includes(sku)) d.skus.push(sku);
    return { documentId: id, name };
  };
  for (const sku of context) {
    if (!index) {
      bySku.set(sku, { datasheet: null, datasheetCoveredBy: [], datasheetOk: false, specsheet: null });
      continue;
    }
    const ds = slotCoverage(index, sku, "datasheet", context);
    const ss = slotCoverage(index, sku, "specsheet", context);
    const firstFile = (s: typeof ds) => (s.state === "own" || s.state === "covered" ? s.docs[0] ?? null : null);
    const dsDoc = firstFile(ds);
    const ssDoc = firstFile(ss);
    bySku.set(sku, {
      datasheet: dsDoc ? take("datasheet", sku, dsDoc.id, dsDoc.fileName) : null,
      datasheetCoveredBy: ds.state === "covered" ? ds.parents : [],
      datasheetOk: ds.state === "own" || ds.state === "covered" || ds.state === "not-needed",
      specsheet: ssDoc ? take("specsheet", sku, ssDoc.id, ssDoc.fileName) : null,
    });
  }
  return { bySku, documents: [...documents.values()] };
}

/** A zip entry name per document, unique within one package. */
export function packageEntryName(doc: Pick<PackageDocument, "documentId" | "kind" | "name">, used: Set<string>, safe: (s: string) => string): string {
  const folder = doc.kind === "datasheet" ? "datasheets" : "specsheets";
  let name = `${folder}/${safe(doc.name)}`;
  if (used.has(name)) name = `${folder}/${doc.documentId}-${safe(doc.name)}`;
  used.add(name);
  return name;
}
```


- [ ] **Step 5: The manifest carries documents once and says what is covered**

In `src/lib/client-package.ts`, replace this exact text (the whole file):

```ts
import type { SpecCatalogPart, BomRow } from "@/lib/bid-spec";
import { optionSlice, resolveOptionId } from "@/lib/design/grid-options";
import type { GridProject, GridPlacement } from "@/lib/stores/grid-projects";
import { hasPrintableSpec } from "@/lib/specs/articles";

export type PackageGapKind = "missing-catalog" | "missing-datasheet" | "missing-spec";

export type ClientPackageGap = {
  kind: PackageGapKind;
  sku: string;
  description: string;
  qty: number;
  /** Catalog editor can use this stable key when the row is present. */
  catalogId: string | null;
};

export type ClientPackageItem = {
  sku: string;
  description: string;
  qty: number;
  unit: string;
  category: string;
  catalogId: string | null;
  datasheet: { name: string; blobKey: string } | null;
  spec: { sectionId: string; body: string } | null;
};

export type ClientPackageManifest = {
  projectId: string;
  projectName: string;
  optionId: string;
  bom: BomRow[];
  items: ClientPackageItem[];
  datasheets: Array<{ sku: string; name: string; blobKey: string }>;
  gaps: ClientPackageGap[];
  counts: { items: number; datasheets: number; gaps: number };
};

function addBom(map: Map<string, BomRow>, placement: GridPlacement, desc: string): void {
  // Curtains are made-to-size lines, not a reusable product datasheet line.
  // Keep them in the BOM as individual rows so the package never loses scope.
  const key = placement.curtain ? placement.id : placement.partId;
  const current = map.get(key);
  if (current && !placement.curtain) current.qty += 1;
  else map.set(key, { sku: placement.curtain ? placement.id : placement.partId, desc, qty: 1 });
}

/**
 * Build the completeness manifest for a Grid client package.
 *
 * This is deliberately pure and does not read Blob or mutate records. The
 * caller can use the same result for the package writer, a readiness panel,
 * and tests. Every BOM line survives: an absent catalog row and every missing
 * attachment becomes an explicit gap rather than being silently omitted.
 */
export function buildClientPackageManifest(
  project: GridProject,
  catalog: SpecCatalogPart[],
  requestedOptionId?: string | null,
): ClientPackageManifest {
  const optionId = resolveOptionId(project, requestedOptionId);
  const { placements } = optionSlice(project, optionId);
  const byId = new Map(catalog.map((part) => [part.id || part.sku, part]));
  const bySku = new Map(catalog.map((part) => [part.sku, part]));
  const bomMap = new Map<string, BomRow>();

  for (const placement of placements) {
    const part = byId.get(placement.partId) || bySku.get(placement.partId);
    const desc = placement.curtain
      ? `${placement.curtain.type} curtain${placement.curtain.fabricSku ? ` · ${placement.curtain.fabricSku}` : ""}`
      : part?.desc || placement.category || placement.partId;
    addBom(bomMap, placement, desc);
  }

  const bom = [...bomMap.values()].sort((a, b) => a.desc.localeCompare(b.desc) || a.sku.localeCompare(b.sku));
  const items: ClientPackageItem[] = [];
  const gaps: ClientPackageGap[] = [];

  for (const row of bom) {
    const part = byId.get(row.sku) || bySku.get(row.sku);
    if (!part) {
      items.push({
        sku: row.sku,
        description: row.desc,
        qty: row.qty,
        unit: "ea",
        category: "Unknown",
        catalogId: null,
        datasheet: null,
        spec: null,
      });
      gaps.push({ kind: "missing-catalog", sku: row.sku, description: row.desc, qty: row.qty, catalogId: null });
      continue;
    }

    const datasheet = part.datasheetBlobKey && part.datasheetName
      ? { name: part.datasheetName, blobKey: part.datasheetBlobKey }
      : part.productMetadata?.datasheets?.find((file) => file.blobKey)
        ? {
            name: part.productMetadata.datasheets.find((file) => file.blobKey)!.fileName,
            blobKey: part.productMetadata.datasheets.find((file) => file.blobKey)!.blobKey!,
          }
        : null;
    const spec = part.specSectionId && hasPrintableSpec(part)
      ? { sectionId: part.specSectionId, body: part.specBody!.trim() }
      : null;

    items.push({
      sku: part.sku,
      description: part.desc,
      qty: row.qty,
      unit: part.unit,
      category: part.category,
      catalogId: part.id,
      datasheet,
      spec,
    });
    if (!datasheet) gaps.push({ kind: "missing-datasheet", sku: part.sku, description: part.desc, qty: row.qty, catalogId: part.id });
    if (!spec) gaps.push({ kind: "missing-spec", sku: part.sku, description: part.desc, qty: row.qty, catalogId: part.id });
  }

  return {
    projectId: project.id,
    projectName: project.name,
    optionId,
    bom,
    items,
    datasheets: items.flatMap((item) => item.datasheet ? [{ sku: item.sku, ...item.datasheet }] : []),
    gaps,
    counts: { items: items.length, datasheets: items.filter((item) => item.datasheet).length, gaps: gaps.length },
  };
}
```

with:

```ts
import type { SpecCatalogPart, BomRow } from "@/lib/bid-spec";
import { optionSlice, resolveOptionId } from "@/lib/design/grid-options";
import type { GridProject, GridPlacement } from "@/lib/stores/grid-projects";
import { hasPrintableSpec } from "@/lib/specs/articles";
import type { CoverageIndex } from "@/lib/part-docs/coverage";
import { resolvePackageDocs, type PackageDocRef, type PackageDocument } from "@/lib/part-docs/package";

export type PackageGapKind = "missing-catalog" | "missing-datasheet" | "missing-spec";

export type ClientPackageGap = {
  kind: PackageGapKind;
  sku: string;
  description: string;
  qty: number;
  /** Catalog editor can use this stable key when the row is present. */
  catalogId: string | null;
};

export type ClientPackageItem = {
  sku: string;
  description: string;
  qty: number;
  unit: string;
  category: string;
  catalogId: string | null;
  /** The part's own datasheet, or the fixture datasheet covering it (#DOC). */
  datasheet: PackageDocRef | null;
  /** Fixture SKUs on this package whose datasheet covers this part. */
  datasheetCoveredBy: string[];
  specsheet: PackageDocRef | null;
  spec: { sectionId: string; body: string } | null;
};

export type ClientPackageManifest = {
  projectId: string;
  projectName: string;
  optionId: string;
  bom: BomRow[];
  items: ClientPackageItem[];
  /** Every datasheet / spec sheet the package carries, ONCE, with the SKUs it serves. */
  documents: PackageDocument[];
  /** Items whose datasheet is a fixture's — the gap report's "covered by <fixture>". */
  covered: Array<{ sku: string; by: string[]; note: string }>;
  gaps: ClientPackageGap[];
  counts: { items: number; datasheets: number; gaps: number };
};

/** A gap-report line for an accessory that rides on its fixture's datasheet. */
export function coveredNote(sku: string, by: string[]): { sku: string; by: string[]; note: string } {
  return { sku, by, note: `covered by ${by.join(", ")}` };
}

function addBom(map: Map<string, BomRow>, placement: GridPlacement, desc: string): void {
  // Curtains are made-to-size lines, not a reusable product datasheet line.
  // Keep them in the BOM as individual rows so the package never loses scope.
  const key = placement.curtain ? placement.id : placement.partId;
  const current = map.get(key);
  if (current && !placement.curtain) current.qty += 1;
  else map.set(key, { sku: placement.curtain ? placement.id : placement.partId, desc, qty: 1 });
}

/**
 * Build the completeness manifest for a Grid client package.
 *
 * This is deliberately pure and does not read Blob or mutate records. The
 * caller can use the same result for the package writer, a readiness panel,
 * and tests. Every BOM line survives: an absent catalog row and every missing
 * attachment becomes an explicit gap rather than being silently omitted.
 */
export function buildClientPackageManifest(
  project: GridProject,
  catalog: SpecCatalogPart[],
  requestedOptionId?: string | null,
  docs?: CoverageIndex | null,
): ClientPackageManifest {
  const optionId = resolveOptionId(project, requestedOptionId);
  const { placements } = optionSlice(project, optionId);
  const byId = new Map(catalog.map((part) => [part.id || part.sku, part]));
  const bySku = new Map(catalog.map((part) => [part.sku, part]));
  const bomMap = new Map<string, BomRow>();

  for (const placement of placements) {
    const part = byId.get(placement.partId) || bySku.get(placement.partId);
    const desc = placement.curtain
      ? `${placement.curtain.type} curtain${placement.curtain.fabricSku ? ` · ${placement.curtain.fabricSku}` : ""}`
      : part?.desc || placement.category || placement.partId;
    addBom(bomMap, placement, desc);
  }

  const bom = [...bomMap.values()].sort((a, b) => a.desc.localeCompare(b.desc) || a.sku.localeCompare(b.sku));
  const items: ClientPackageItem[] = [];
  const gaps: ClientPackageGap[] = [];
  const catalogSkus = bom.map((row) => (byId.get(row.sku) || bySku.get(row.sku))?.sku).filter((s): s is string => !!s);
  const packageDocs = resolvePackageDocs(docs, catalogSkus);

  for (const row of bom) {
    const part = byId.get(row.sku) || bySku.get(row.sku);
    if (!part) {
      items.push({
        sku: row.sku,
        description: row.desc,
        qty: row.qty,
        unit: "ea",
        category: "Unknown",
        catalogId: null,
        datasheet: null,
        datasheetCoveredBy: [],
        specsheet: null,
        spec: null,
      });
      gaps.push({ kind: "missing-catalog", sku: row.sku, description: row.desc, qty: row.qty, catalogId: null });
      continue;
    }

    const partDocs = packageDocs.bySku.get(part.sku);
    const spec = part.specSectionId && hasPrintableSpec(part)
      ? { sectionId: part.specSectionId, body: part.specBody!.trim() }
      : null;

    items.push({
      sku: part.sku,
      description: part.desc,
      qty: row.qty,
      unit: part.unit,
      category: part.category,
      catalogId: part.id,
      datasheet: partDocs?.datasheet ?? null,
      datasheetCoveredBy: partDocs?.datasheetCoveredBy ?? [],
      specsheet: partDocs?.specsheet ?? null,
      spec,
    });
    if (!partDocs?.datasheetOk) gaps.push({ kind: "missing-datasheet", sku: part.sku, description: part.desc, qty: row.qty, catalogId: part.id });
    if (!spec) gaps.push({ kind: "missing-spec", sku: part.sku, description: part.desc, qty: row.qty, catalogId: part.id });
  }

  return {
    projectId: project.id,
    projectName: project.name,
    optionId,
    bom,
    items,
    documents: packageDocs.documents,
    covered: items.filter((item) => item.datasheetCoveredBy.length).map((item) => coveredNote(item.sku, item.datasheetCoveredBy)),
    gaps,
    counts: { items: items.length, datasheets: packageDocs.documents.filter((d) => d.kind === "datasheet").length, gaps: gaps.length },
  };
}
```


- [ ] **Step 6: The package zips each document once, Grid and quote alike**

In `src/lib/client-package-server.ts`, replace this exact text:

```ts
import { buildClientPackageManifest, type ClientPackageGap } from "@/lib/client-package";
```

with:

```ts
import { buildClientPackageManifest, coveredNote, type ClientPackageGap } from "@/lib/client-package";
```

In `src/lib/client-package-server.ts`, replace this exact text:

```ts
import { createStoredZip, type ZipFile } from "@/lib/zip";
```

with:

```ts
import { createStoredZip, type ZipFile } from "@/lib/zip";
import type { CoverageIndex } from "@/lib/part-docs/coverage";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { packageEntryName, resolvePackageDocs, type PackageDocument } from "@/lib/part-docs/package";
```

In `src/lib/client-package-server.ts`, replace this exact text (the whole `addDatasheets` function):

```ts
async function addDatasheets(
  items: Array<{ sku: string; description: string; qty: number; catalogId: string | null; datasheet: { name: string; blobKey: string } | null }>,
  catalog: SpecCatalogPart[],
  files: ZipFile[],
  gaps: ClientPackageGap[],
): Promise<void> {
  for (const item of items) {
    if (!item.datasheet) continue;
    const part = catalog.find((candidate) => candidate.id === item.catalogId || candidate.sku === item.sku);
    const metadataFile = part?.productMetadata?.datasheets?.find((file) => file.blobKey);
    const blobKey = part?.datasheetBlobKey || metadataFile?.blobKey;
    const stream = blobKey ? await getBlobStream(blobKey) : null;
    if (!stream) {
      gaps.push({ kind: "missing-datasheet", sku: item.sku, description: item.description, qty: item.qty, catalogId: item.catalogId });
      continue;
    }
    files.push({ name: `datasheets/${safeName(item.sku)}-${safeName(item.datasheet.name)}`, data: await bytesFromStream(stream) });
  }
}

```

with:

```ts
/**
 * Put every package document in the zip ONCE (#DOC): a fixture datasheet
 * that also covers its lens and clamps is one file. A document whose blob is
 * missing from storage turns into a gap for each SKU it was meant to serve.
 */
async function addDocuments(
  documents: PackageDocument[],
  index: CoverageIndex,
  describe: (sku: string) => { description: string; qty: number; catalogId: string | null },
  files: ZipFile[],
  gaps: ClientPackageGap[],
): Promise<void> {
  const used = new Set<string>();
  for (const doc of documents) {
    const blobKey = index.docsById.get(doc.documentId)?.blobKey;
    const stream = blobKey ? await getBlobStream(blobKey) : null;
    if (!stream) {
      if (doc.kind === "datasheet") for (const sku of doc.skus) gaps.push({ kind: "missing-datasheet", sku, ...describe(sku) });
      continue;
    }
    files.push({ name: packageEntryName(doc, used, safeName), data: await bytesFromStream(stream) });
  }
}

```

In `src/lib/client-package-server.ts`, replace this exact text (the whole `createClientPackage` function):

```ts
export async function createClientPackage(
  project: GridProject,
  by: string,
  requestedOptionId?: string | null,
): Promise<BuiltClientPackage> {
  if (!blobEnabled()) throw new Error("Client packages require Blob storage on this deployment.");
  const catalog = (await listCatalog()) as SpecCatalogPart[];
  const manifest = buildClientPackageManifest(project, catalog, requestedOptionId);
  const matched = matchBom(manifest.bom, catalog);
  const sections = await allSections();
  const spec = assemble(matched.rows, sections, {
    projectName: project.name,
    customer: project.customer,
    engagementId: `grid:${project.id}`,
    preparedBy: by,
    date: Date.now(),
  });
  const packageName = `${safeName(project.name || project.id)}-${project.id}`;
  const files: ZipFile[] = [
    { name: "specification.docx", data: await buildSpecDocx(spec) },
    { name: "drawings/rough-drawings.pdf", data: roughDrawings(project, catalog, packageName) },
  ];
  const gaps = [...manifest.gaps];
  await addDatasheets(manifest.items, catalog, files, gaps);
  for (const [index, sheet] of (await listSheets(project.id)).entries()) {
    let bytes: Buffer | null = null;
    if (sheet.dataUrl) {
      try { bytes = dataUrlToBytes(sheet.dataUrl).bytes; } catch { bytes = null; }
    } else if (sheet.blobPath) {
      const stream = await getBlobStream(sheet.blobPath);
      if (stream) bytes = await bytesFromStream(stream);
    }
    if (bytes) files.push({ name: `drawings/plan-${String(index + 1).padStart(2, "0")}-${safeName(sheet.name)}`, data: bytes });
  }
  const publicManifest = {
    ...manifest,
    datasheets: manifest.datasheets.map(({ sku, name }) => ({ sku, name })),
    items: manifest.items.map(({ datasheet, ...item }) => ({ ...item, datasheet: datasheet ? { name: datasheet.name } : null })),
    gaps,
  };
  files.unshift({ name: "00-package-index.json", data: Buffer.from(JSON.stringify({ ...publicManifest, generatedAt: Date.now(), specSections: spec.sections.length }, null, 2), "utf8") });
  const zip = createStoredZip(files);
  const fileName = `${packageName}.zip`;
  const stored = await putBlob(`client-packages/${safeName(project.id)}/${fileName}`, zip, "application/zip");
  const record = await saveClientPackage({
    projectId: project.id,
    fileName,
    blobPath: stored.pathname,
    createdBy: by,
    itemCount: manifest.counts.items,
    datasheetCount: files.filter((file) => file.name.startsWith("datasheets/")).length,
    gapCount: gaps.length,
  });
  return { record, gaps, spec };
}

```

with:

```ts
export async function createClientPackage(
  project: GridProject,
  by: string,
  requestedOptionId?: string | null,
): Promise<BuiltClientPackage> {
  if (!blobEnabled()) throw new Error("Client packages require Blob storage on this deployment.");
  const catalog = (await listCatalog()) as SpecCatalogPart[];
  const { index: docIndex } = await loadPartDocsState(catalog);
  const manifest = buildClientPackageManifest(project, catalog, requestedOptionId, docIndex);
  const matched = matchBom(manifest.bom, catalog);
  const sections = await allSections();
  const spec = assemble(matched.rows, sections, {
    projectName: project.name,
    customer: project.customer,
    engagementId: `grid:${project.id}`,
    preparedBy: by,
    date: Date.now(),
  });
  const packageName = `${safeName(project.name || project.id)}-${project.id}`;
  const files: ZipFile[] = [
    { name: "specification.docx", data: await buildSpecDocx(spec) },
    { name: "drawings/rough-drawings.pdf", data: roughDrawings(project, catalog, packageName) },
  ];
  const gaps = [...manifest.gaps];
  const itemBySku = new Map(manifest.items.map((item) => [item.sku, item]));
  await addDocuments(manifest.documents, docIndex, (sku) => {
    const item = itemBySku.get(sku);
    return { description: item?.description ?? sku, qty: item?.qty ?? 0, catalogId: item?.catalogId ?? null };
  }, files, gaps);
  for (const [index, sheet] of (await listSheets(project.id)).entries()) {
    let bytes: Buffer | null = null;
    if (sheet.dataUrl) {
      try { bytes = dataUrlToBytes(sheet.dataUrl).bytes; } catch { bytes = null; }
    } else if (sheet.blobPath) {
      const stream = await getBlobStream(sheet.blobPath);
      if (stream) bytes = await bytesFromStream(stream);
    }
    if (bytes) files.push({ name: `drawings/plan-${String(index + 1).padStart(2, "0")}-${safeName(sheet.name)}`, data: bytes });
  }
  const publicManifest = { ...manifest, gaps };
  files.unshift({ name: "00-package-index.json", data: Buffer.from(JSON.stringify({ ...publicManifest, generatedAt: Date.now(), specSections: spec.sections.length }, null, 2), "utf8") });
  const zip = createStoredZip(files);
  const fileName = `${packageName}.zip`;
  const stored = await putBlob(`client-packages/${safeName(project.id)}/${fileName}`, zip, "application/zip");
  const record = await saveClientPackage({
    projectId: project.id,
    fileName,
    blobPath: stored.pathname,
    createdBy: by,
    itemCount: manifest.counts.items,
    datasheetCount: files.filter((file) => file.name.startsWith("datasheets/")).length,
    gapCount: gaps.length,
  });
  return { record, gaps, spec };
}

```

In `src/lib/client-package-server.ts`, replace this exact text (the whole `createQuoteClientPackage` function, to the end of the file):

```ts
export async function createQuoteClientPackage(quote: Quote, by: string): Promise<BuiltClientPackage> {
  if (!blobEnabled()) throw new Error("Client packages require Blob storage on this deployment.");
  const catalog = (await listCatalog()) as SpecCatalogPart[];
  const bom = quoteBom(quote);
  const matched = matchBom(bom, catalog);
  const sections = await allSections();
  const spec = assemble(matched.rows, sections, {
    projectName: quote.name,
    customer: quote.customer,
    engagementId: `quote:${quote.id}`,
    preparedBy: by,
    date: Date.now(),
  });
  const items = bom.map((row) => {
    const part = catalog.find((candidate) => candidate.sku === row.sku);
    const datasheet = part?.datasheetBlobKey && part.datasheetName ? { name: part.datasheetName, blobKey: part.datasheetBlobKey } : part?.productMetadata?.datasheets?.find((file) => file.blobKey) ? { name: part.productMetadata.datasheets.find((file) => file.blobKey)!.fileName, blobKey: part.productMetadata.datasheets.find((file) => file.blobKey)!.blobKey! } : null;
    return { sku: row.sku, description: row.desc, qty: row.qty, catalogId: part?.id || null, datasheet };
  });
  const gaps: ClientPackageGap[] = matched.rows.filter((row) => row.bucket !== "ready").map((row) => ({ kind: row.bucket === "no-match" ? "missing-catalog" : "missing-spec", sku: row.row.sku, description: row.row.desc, qty: row.row.qty, catalogId: row.part?.id || null }));
  for (const item of items) {
    if (!item.datasheet) gaps.push({ kind: "missing-datasheet", sku: item.sku, description: item.description, qty: item.qty, catalogId: item.catalogId });
  }
  const packageName = `${safeName(quote.name || quote.id)}-${quote.id}`;
  const files: ZipFile[] = [
    { name: "specification.docx", data: await buildSpecDocx(spec) },
    { name: "drawings/quote-equipment-summary.pdf", data: roughQuoteDrawing(quote, packageName) },
  ];
  await addDatasheets(items, catalog, files, gaps);
  files.unshift({ name: "00-package-index.json", data: Buffer.from(JSON.stringify({ quoteId: quote.id, quoteName: quote.name, items, gaps, generatedAt: Date.now(), specSections: spec.sections.length }, null, 2), "utf8") });
  const fileName = `${packageName}.zip`;
  const stored = await putBlob(`client-packages/quote-${safeName(quote.id)}/${fileName}`, createStoredZip(files), "application/zip");
  const record = await saveClientPackage({ projectId: `quote:${quote.id}`, fileName, blobPath: stored.pathname, createdBy: by, itemCount: items.length, datasheetCount: files.filter((file) => file.name.startsWith("datasheets/")).length, gapCount: gaps.length });
  return { record, gaps, spec };
}
```

with:

```ts
export async function createQuoteClientPackage(quote: Quote, by: string): Promise<BuiltClientPackage> {
  if (!blobEnabled()) throw new Error("Client packages require Blob storage on this deployment.");
  const catalog = (await listCatalog()) as SpecCatalogPart[];
  const { index: docIndex } = await loadPartDocsState(catalog);
  const bySku = new Map(catalog.map((part) => [part.sku, part]));
  const bom = quoteBom(quote);
  const matched = matchBom(bom, catalog);
  const sections = await allSections();
  const spec = assemble(matched.rows, sections, {
    projectName: quote.name,
    customer: quote.customer,
    engagementId: `quote:${quote.id}`,
    preparedBy: by,
    date: Date.now(),
  });
  // #DOC: the quote's own SKUs are the coverage context — an accessory rides
  // on a fixture only when that fixture is on this quote.
  const packageDocs = resolvePackageDocs(docIndex, bom.filter((row) => bySku.has(row.sku)).map((row) => row.sku));
  const items = bom.map((row) => {
    const part = bySku.get(row.sku);
    const docs = packageDocs.bySku.get(row.sku);
    return {
      sku: row.sku,
      description: row.desc,
      qty: row.qty,
      catalogId: part?.id || null,
      datasheet: docs?.datasheet ?? null,
      datasheetCoveredBy: docs?.datasheetCoveredBy ?? [],
      specsheet: docs?.specsheet ?? null,
    };
  });
  const gaps: ClientPackageGap[] = matched.rows.filter((row) => row.bucket !== "ready").map((row) => ({ kind: row.bucket === "no-match" ? "missing-catalog" : "missing-spec", sku: row.row.sku, description: row.row.desc, qty: row.row.qty, catalogId: row.part?.id || null }));
  for (const item of items) {
    if (item.catalogId && !packageDocs.bySku.get(item.sku)?.datasheetOk) gaps.push({ kind: "missing-datasheet", sku: item.sku, description: item.description, qty: item.qty, catalogId: item.catalogId });
  }
  const covered = items.filter((item) => item.datasheetCoveredBy.length).map((item) => coveredNote(item.sku, item.datasheetCoveredBy));
  const packageName = `${safeName(quote.name || quote.id)}-${quote.id}`;
  const files: ZipFile[] = [
    { name: "specification.docx", data: await buildSpecDocx(spec) },
    { name: "drawings/quote-equipment-summary.pdf", data: roughQuoteDrawing(quote, packageName) },
  ];
  const itemBySku = new Map(items.map((item) => [item.sku, item]));
  await addDocuments(packageDocs.documents, docIndex, (sku) => {
    const item = itemBySku.get(sku);
    return { description: item?.description ?? sku, qty: item?.qty ?? 0, catalogId: item?.catalogId ?? null };
  }, files, gaps);
  files.unshift({ name: "00-package-index.json", data: Buffer.from(JSON.stringify({ quoteId: quote.id, quoteName: quote.name, items, documents: packageDocs.documents, covered, gaps, generatedAt: Date.now(), specSections: spec.sections.length }, null, 2), "utf8") });
  const fileName = `${packageName}.zip`;
  const stored = await putBlob(`client-packages/quote-${safeName(quote.id)}/${fileName}`, createStoredZip(files), "application/zip");
  const record = await saveClientPackage({ projectId: `quote:${quote.id}`, fileName, blobPath: stored.pathname, createdBy: by, itemCount: items.length, datasheetCount: files.filter((file) => file.name.startsWith("datasheets/")).length, gapCount: gaps.length });
  return { record, gaps, spec };
}
```

In `src/app/api/grid/[id]/package-manifest/route.ts`, replace this exact text (the whole file):

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { getProject } from "@/lib/stores/grid-projects";
import { list as listCatalog } from "@/lib/stores/catalog";
import { buildClientPackageManifest } from "@/lib/client-package";

/**
 * Read-only package readiness seam (punch #40). Private Blob pathnames never
 * leave the server; consumers receive the existing authenticated datasheet
 * proxy URL instead. The eventual PDF/ZIP writer and the readiness UI use the
 * same manifest builder.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireUser();
  const { id } = await params;
  const project = await getProject(decodeURIComponent(id));
  if (!project) return NextResponse.json({ error: "Design not found." }, { status: 404 });
  const manifest = buildClientPackageManifest(project, await listCatalog());
  return NextResponse.json({
    ...manifest,
    datasheets: manifest.datasheets.map(({ sku, name }) => ({
      sku,
      name,
      url: `/api/part-datasheet/${encodeURIComponent(sku)}`,
    })),
    items: manifest.items.map(({ datasheet, ...item }) => ({
      ...item,
      datasheet: datasheet ? { name: datasheet.name, url: `/api/part-datasheet/${encodeURIComponent(item.sku)}` } : null,
    })),
  });
}
```

with:

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { getProject } from "@/lib/stores/grid-projects";
import { list as listCatalog } from "@/lib/stores/catalog";
import { buildClientPackageManifest } from "@/lib/client-package";
import { loadPartDocsState } from "@/lib/part-docs/load";

/**
 * Read-only package readiness seam (punch #40). Private Blob pathnames never
 * leave the server; consumers receive the authenticated part-document
 * viewer URL instead (#DOC). The eventual PDF/ZIP writer and the readiness UI use the
 * same manifest builder.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireUser();
  const { id } = await params;
  const project = await getProject(decodeURIComponent(id));
  if (!project) return NextResponse.json({ error: "Design not found." }, { status: 404 });
  const catalog = await listCatalog();
  const { index } = await loadPartDocsState(catalog);
  const manifest = buildClientPackageManifest(project, catalog, null, index);
  const url = (documentId: string) => `/api/part-documents/${encodeURIComponent(documentId)}`;
  return NextResponse.json({
    ...manifest,
    documents: manifest.documents.map((d) => ({ ...d, url: url(d.documentId) })),
    items: manifest.items.map((item) => ({
      ...item,
      datasheet: item.datasheet ? { ...item.datasheet, url: url(item.datasheet.documentId) } : null,
      specsheet: item.specsheet ? { ...item.specsheet, url: url(item.specsheet.documentId) } : null,
    })),
  });
}
```


- [ ] **Step 7: Run the gates**

```bash
npx tsc --noEmit -p .
```

Expected: no output, exit 0.

```bash
env -u DATABASE_URL npm run test:specs > "${TMPDIR:-/tmp}/pd-specs.log" 2>&1; tail -1 "${TMPDIR:-/tmp}/pd-specs.log"; grep '^FAIL' "${TMPDIR:-/tmp}/pd-specs.log"
```

Expected: `ALL PASSED` and no `FAIL` lines. (One pre-existing flake exists — `redeem: tampered code -> not ok`, a random-code test that fails about one run in sixty; if it is the only FAIL, re-run.)

Expected additionally: `grep -c '^PASS part docs package' "${TMPDIR:-/tmp}/pd-specs.log"` prints `12`, and every existing `coverage:` / `gating:` assertion still passes.

```bash
env -u DATABASE_URL npm run test:review:regressions 2>&1 | tail -2
```

Expected: `review regression checks passed` then `quote email regression checks passed`.

```bash
npx eslint 2>&1 | grep problems
```

Expected: `✖ N problems (0 errors, N warnings)` with N ≤ 111 (the baseline is 111; Task 8 removes one).

```bash
env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build > "${TMPDIR:-/tmp}/pd-build.log" 2>&1; echo "build exit: $?"; tail -3 "${TMPDIR:-/tmp}/pd-build.log"; rm -rf .next
```

Expected: `build exit: 0`, the route table's legend (`ƒ  (Dynamic)  server-rendered on demand`) in the tail, and `.next` removed afterwards. A client component that imports a store or `@/db` value fails here, not in tsc.


- [ ] **Step 8: Commit**

```bash
git add 'src/app/(app)/design/specs/coverage.ts' 'src/app/(app)/design/specs/library/page.tsx' src/lib/part-docs/package.ts src/lib/client-package.ts src/lib/client-package-server.ts 'src/app/api/grid/[id]/package-manifest/route.ts' scripts/test-review-and-spec.ts
git commit -m "feat(part-docs): Specs coverage and client packages use the coverage rule; each document packaged once" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 12: Consumers II — Displays API links, the old datasheet route as a bridge, Grid, smoke, docs, full gates

**Files:**
- Modify: `src/lib/displays-api.ts` (`publicDatasheets`, `SpecLookup.docs`, ETag folds documents)
- Modify: `src/app/api/v1/displays/catalog/route.ts`, `catalog/[sku]/route.ts`, `specs/route.ts`, `specs/[id]/route.ts`
- Modify: `src/app/api/part-datasheet/[id]/route.ts` (legacy blob, else redirect to the document viewer)
- Modify: `src/app/(app)/design/grid/[id]/page.tsx`, `src/lib/design/grid-bom.ts` (comment)
- Modify: `scripts/smoke-routes.ts`
- Modify: `DECISIONS.md` (D-DOC-1…D-DOC-11), `PUNCHLIST.md` (`#DOC`, #40 status)
- Test: `scripts/test-review-and-spec.ts` (append a `Task 12` block)

**Interfaces:**
- Consumes: Task 2 (`linkedDocuments`, `ownFiles`, `CoverageIndex`), Task 3 (`loadPartDocsState`, `allDocuments`, `allDocumentLinks`).
- Produces (`displays-api.ts`): `SpecLookup = { sections; articles; docs?: CoverageIndex }`, `publicDatasheets(sku: string, docs?: CoverageIndex): Array<{ name: string; url: string }>`; `publicCatalogPart(part, lib).datasheets` now comes from it; `catalogEtag(parts, lib)` hashes `lib.docs` too.
- Produces: `GET /api/part-datasheet/[id]` keeps streaming a legacy `datasheetBlobKey`, else 302 → `/api/part-documents/<id>`; the Grid palette's `hasDatasheet` is true for a stored datasheet document or the legacy blob.

- [ ] **Step 1: Write the failing test**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts

/* --- Part documents (#DOC) — Task 12: Displays API datasheet links --- */
import { publicDatasheets } from "@/lib/displays-api";
{
  const idx = buildCoverageIndex({
    documents: [
      { id: "PD-dispds00000", kind: "datasheet", title: "S4", fileName: "S4.pdf", contentType: "application/pdf", size: 1, blobKey: "part-docs/PD-dispds00000/S4.pdf", sourceUrl: null, source: "upload", uploadedAt: 1, uploadedBy: "t", history: [] },
    ],
    links: [{ id: "1", partSku: "DISP-A", documentId: "PD-dispds00000", kind: "datasheet", createdAt: 1, createdBy: "t" }],
    accessoryLinks: [],
    parts: [{ sku: "DISP-B", productMetadata: { datasheets: [{ kind: "datasheet", sourceUrl: "https://mfr.example/b.pdf" }] } }],
  });
  ok(JSON.stringify(publicDatasheets("DISP-A", idx)) === JSON.stringify([{ name: "S4.pdf", url: "/api/part-documents/PD-dispds00000" }]), "part docs displays: a linked datasheet points at the document viewer");
  ok(JSON.stringify(publicDatasheets("DISP-B", idx)) === JSON.stringify([{ name: "b.pdf", url: "https://mfr.example/b.pdf" }]), "part docs displays: an unfetched researched link is the manufacturer URL, not a 404 proxy");
  ok(publicDatasheets("DISP-C", idx).length === 0 && publicDatasheets("DISP-A").length === 0, "part docs displays: nothing linked, nothing listed");
  const part = { id: "DISP-A", sku: "DISP-A", desc: "A", category: "Lighting", unit: "ea", list: 1, cost: 1, updatedAt: 5 };
  const noDocs = catalogEtag([part] as never, { sections: [], articles: [] });
  ok(catalogEtag([part] as never, { sections: [], articles: [], docs: idx }) !== noDocs, "part docs displays: attaching a document changes the catalog ETag with no part touched");
  ok(publicCatalogPart(part as never, { sections: [], articles: [], docs: idx }).datasheets[0].url === "/api/part-documents/PD-dispds00000", "part docs displays: publicCatalogPart carries the viewer links");
}
```


- [ ] **Step 2: Run it to verify it fails**

```bash
npx tsc --noEmit -p . 2>&1 | head -2
```

Expected: `error TS2305: Module '"@/lib/displays-api"' has no exported member 'publicDatasheets'.`


- [ ] **Step 3: Displays API datasheet links come from documents**

In `src/lib/displays-api.ts`, replace this exact text:

```ts
import type { SpecSection } from "@/lib/specs/sections";

/** Sections + articles the Displays API needs to resolve canonical ids to the
 *  printable CSI number / title it has always returned (D258). */
export type SpecLookup = { sections: SpecSection[]; articles: SpecCategoryArticle[] };
```

with:

```ts
import type { SpecSection } from "@/lib/specs/sections";
import { linkedDocuments, type CoverageIndex } from "@/lib/part-docs/coverage";

/** Sections + articles the Displays API needs to resolve canonical ids to the
 *  printable CSI number / title it has always returned (D258), plus the part
 *  documents index (#DOC) its datasheet links now come from. */
export type SpecLookup = { sections: SpecSection[]; articles: SpecCategoryArticle[]; docs?: CoverageIndex };

/**
 * A part's datasheet links for external consumers (#DOC, spec §7): every
 * linked datasheet document through the authenticated viewer route (which
 * streams the file, or redirects a link-only one to its source), else the
 * manufacturer URLs the catalog row carries. Never a private blob key, and
 * never the old /api/part-datasheet/<sku> URL that 404'd for a part whose
 * only "datasheet" was a researched link.
 */
export function publicDatasheets(sku: string, docs?: CoverageIndex): Array<{ name: string; url: string }> {
  if (!docs) return [];
  const linked = linkedDocuments(docs, sku, "datasheet");
  if (linked.length) return linked.map((d) => ({ name: d.fileName, url: `/api/part-documents/${encodeURIComponent(d.id)}` }));
  return (docs.catalogUrls.get(sku)?.datasheet ?? []).map((url) => ({ name: url.split("/").pop() || "Datasheet", url }));
}
```

In `src/lib/displays-api.ts`, replace this exact text:

```ts
    datasheets: part.datasheetName
      ? [{ name: part.datasheetName, url: `/api/part-datasheet/${encodeURIComponent(part.sku)}` }]
      : (part.productMetadata?.datasheets || []).map((file) => ({ name: file.fileName, url: `/api/part-datasheet/${encodeURIComponent(part.sku)}` })),
```

with:

```ts
    datasheets: publicDatasheets(part.sku, lib?.docs),
```

In `src/lib/displays-api.ts`, replace this exact text:

```ts
  const source = `${partsPart}::${sectionsPart}::${articlesPart}`;
```

with:

```ts
  // #DOC: attaching or fetching a document moves no part's updatedAt, so the
  // documents and their links are folded in too.
  const docsPart = lib?.docs
    ? [...lib.docs.docsBySku]
        .map(([sku, k]) => `${sku}:${[...k.datasheet, ...k.specsheet].map((d) => `${d.id}.${d.uploadedAt}.${d.blobKey ? 1 : 0}`).join(",")}`)
        .sort()
        .join("|")
    : "";
  const source = `${partsPart}::${sectionsPart}::${articlesPart}::${docsPart}`;
```

Each v1 route loads the index once, with the parts it already has:

In `src/app/api/v1/displays/catalog/route.ts`, replace this exact text:

```ts
import { allArticles } from "@/lib/stores/spec-articles";
```

with:

```ts
import { allArticles } from "@/lib/stores/spec-articles";
import { loadPartDocsState } from "@/lib/part-docs/load";
```

In `src/app/api/v1/displays/catalog/route.ts`, replace this exact text:

```ts
  const [sections, articles] = await Promise.all([allSections(), allArticles()]);
  const lib = { sections, articles };
  const parts = (await listCatalog()) as SpecCatalogPart[];
```

with:

```ts
  const [sections, articles] = await Promise.all([allSections(), allArticles()]);
  const parts = (await listCatalog()) as SpecCatalogPart[];
  const lib = { sections, articles, docs: (await loadPartDocsState(parts)).index };
```

In `src/app/api/v1/displays/specs/route.ts`, replace this exact text:

```ts
import { allArticles } from "@/lib/stores/spec-articles";
```

with:

```ts
import { allArticles } from "@/lib/stores/spec-articles";
import { loadPartDocsState } from "@/lib/part-docs/load";
```

In `src/app/api/v1/displays/specs/route.ts`, replace this exact text:

```ts
  const [sections, articles] = await Promise.all([allSections(), allArticles()]);
  const lib = { sections, articles };
  const parts = (await listCatalog() as SpecCatalogPart[])
```

with:

```ts
  const [sections, articles] = await Promise.all([allSections(), allArticles()]);
  const all = (await listCatalog()) as SpecCatalogPart[];
  const lib = { sections, articles, docs: (await loadPartDocsState(all)).index };
  const parts = all
```

In `src/app/api/v1/displays/catalog/[sku]/route.ts`, replace this exact text:

```ts
import { allArticles } from "@/lib/stores/spec-articles";
```

with:

```ts
import { allArticles } from "@/lib/stores/spec-articles";
import { loadPartDocsState } from "@/lib/part-docs/load";
```

In `src/app/api/v1/displays/catalog/[sku]/route.ts`, replace this exact text:

```ts
  if (!part) return NextResponse.json({ error: "Catalog item not found." }, { status: 404 });
  return NextResponse.json(apiEnvelope(publicCatalogPart(part, { sections, articles }), { readOnly: true })
```

with:

```ts
  if (!part) return NextResponse.json({ error: "Catalog item not found." }, { status: 404 });
  const docs = (await loadPartDocsState([part])).index;
  return NextResponse.json(apiEnvelope(publicCatalogPart(part, { sections, articles, docs }), { readOnly: true })
```

In `src/app/api/v1/displays/specs/[id]/route.ts`, replace this exact text:

```ts
import { allArticles } from "@/lib/stores/spec-articles";
```

with:

```ts
import { allArticles } from "@/lib/stores/spec-articles";
import { loadPartDocsState } from "@/lib/part-docs/load";
```

In `src/app/api/v1/displays/specs/[id]/route.ts`, replace this exact text:

```ts
  return NextResponse.json(apiEnvelope(publicCatalogPart(part!, { sections, articles }), { readOnly: true }), {
```

with:

```ts
  const docs = (await loadPartDocsState([part!])).index;
  return NextResponse.json(apiEnvelope(publicCatalogPart(part!, { sections, articles, docs }), { readOnly: true }), {
```


- [ ] **Step 4: Keep the old datasheet route as a bridge**

In `src/app/api/part-datasheet/[id]/route.ts`, replace this exact text (the whole file):

```ts
import { requireUser } from "@/lib/session";
import { get as getPart } from "@/lib/stores/catalog";
import { getBlobStream } from "@/lib/blob";

/**
 * Authenticated part-datasheet proxy (D116, punch #39 Task 5) — same shape
 * as /api/grid-sheets/[id]: the Blob store is PRIVATE, so the browser only
 * ever reaches the file through a signed-in session, streamed server-side.
 *
 * The [id] segment is the part's SKU (== its catalog doc id, see
 * lib/stores/catalog.ts). SKUs can contain colons (e.g. "Brand:Model"), so
 * every link into this route URL-encodes the segment (encodeURIComponent)
 * and this handler decodes it before lookup — the same contract
 * /api/grid-sheets/[id] uses for its id.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  await requireUser();
  const { id } = await ctx.params;
  const sku = decodeURIComponent(id);
  const part = await getPart(sku);
  if (!part || !part.datasheetBlobKey) return new Response("Not found", { status: 404 });
  const stream = await getBlobStream(part.datasheetBlobKey);
  if (!stream) return new Response("File missing from storage", { status: 404 });
  return new Response(stream, {
    headers: {
      "content-type": "application/pdf",
      // Private to the signed-in user's browser; datasheets are immutable
      // once uploaded (a replace mints a new blob), so a day of caching is
      // safe and keeps re-opens from re-fetching the whole file.
      "cache-control": "private, max-age=86400",
    },
  });
}
```

with:

```ts
import { requireUser } from "@/lib/session";
import { get as getPart } from "@/lib/stores/catalog";
import { getBlobStream } from "@/lib/blob";
import { allDocumentLinks, allDocuments } from "@/lib/stores/part-documents";

/**
 * Authenticated part-datasheet proxy (D116, punch #39 Task 5) — kept as a
 * bridge for the older readers that still link here by SKU (the Grid
 * editor, the pre-v1 Displays route, bookmarks). Part documents (#DOC):
 * a part still carrying the legacy `datasheetBlobKey` streams it exactly as
 * before; otherwise this redirects to the part's own datasheet document in
 * the new viewer (`/api/part-documents/<id>`) — a stored file first, else a
 * link-only one (which the viewer sends on to its source URL).
 *
 * The [id] segment is the part's SKU (== its catalog doc id). SKUs can
 * contain colons, so every link into this route URL-encodes the segment.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await ctx.params;
  const sku = decodeURIComponent(id);
  const part = await getPart(sku);
  if (!part) return new Response("Not found", { status: 404 });
  if (part.datasheetBlobKey) {
    const stream = await getBlobStream(part.datasheetBlobKey);
    if (!stream) return new Response("File missing from storage", { status: 404 });
    return new Response(stream, {
      headers: { "content-type": "application/pdf", "cache-control": "private, max-age=86400" },
    });
  }
  const linked = new Set((await allDocumentLinks()).filter((l) => l.partSku === sku && l.kind === "datasheet").map((l) => l.documentId));
  const docs = (await allDocuments()).filter((d) => linked.has(d.id));
  const best = docs.find((d) => d.blobKey) ?? docs.find((d) => d.sourceUrl);
  if (!best) return new Response("Not found", { status: 404 });
  return Response.redirect(new URL(`/api/part-documents/${encodeURIComponent(best.id)}`, req.url), 302);
}
```


- [ ] **Step 5: The Grid palette knows about documents**

In `src/app/(app)/design/grid/[id]/page.tsx`, replace this exact text:

```tsx
import { list as listCatalog } from "@/lib/stores/catalog";
```

with:

```tsx
import { list as listCatalog } from "@/lib/stores/catalog";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { ownFiles } from "@/lib/part-docs/coverage";
```

In `src/app/(app)/design/grid/[id]/page.tsx`, replace this exact text:

```tsx
  const pricingById = new Map(catalog.map((p) => [p.id, p]));
```

with:

```tsx
  const pricingById = new Map(catalog.map((p) => [p.id, p]));
  // #DOC: "has a datasheet" = a stored datasheet document (or the legacy
  // blob); the editor's link goes through /api/part-datasheet/<sku>, which
  // bridges to the part-document viewer.
  const { index: docIndex } = await loadPartDocsState(catalog);
  const hasDatasheetFile = (p: (typeof catalog)[number]) => !!p.datasheetBlobKey || ownFiles(docIndex, p.sku, "datasheet").length > 0;
```

In `src/app/(app)/design/grid/[id]/page.tsx`, replace this exact text:

```tsx
      ...(p?.datasheetBlobKey ? { hasDatasheet: true } : {}),
```

with:

```tsx
      ...(p && hasDatasheetFile(p) ? { hasDatasheet: true } : {}),
```

In `src/lib/design/grid-bom.ts`, replace this exact text:

```ts
  /** Datasheet attachment flag (Task 5, punch #39, D116) — true only when
   *  the catalog part has a datasheet blob attached. Deliberately just a
   *  boolean (not the blob key): the editor only needs to know whether to
   *  render a link to the authenticated /api/part-datasheet/<sku> proxy. */
```

with:

```ts
  /** Datasheet attachment flag (Task 5, punch #39, D116) — true when the
   *  catalog part has a stored datasheet: a part-document file (#DOC) or the
   *  legacy blob. Deliberately just a boolean (not the blob key): the editor
   *  only needs to know whether to render a link to the authenticated
   *  /api/part-datasheet/<sku> proxy, which bridges to the document viewer. */
```


- [ ] **Step 6: Smoke the new routes**

In `scripts/smoke-routes.ts`, replace this exact text:

```ts
  "/catalog",
```

with:

```ts
  "/catalog",
  "/catalog/documents", // #DOC — the Datasheets to-do list
  "/catalog/documents?show=missing-datasheet",
  "/catalog/documents/upload", // #DOC — bulk drop
```

In `scripts/smoke-routes.ts`, replace this exact text:

```ts
  { route: "/design/grid/GRD-5001", reject: "no longer exists" },
```

with:

```ts
  { route: "/design/grid/GRD-5001", reject: "no longer exists" },
  // #DOC: the part editor with its Documents section (a seeded fabric SKU).
  { route: "/catalog?edit=RB-MV-MN" },
```


- [ ] **Step 7: Record the decisions and the punch item**

The lead renumbers `#DOC` / `D-DOC-n` at merge time — recompute free numbers from `origin/main` right before merging, never from this branch.

Append to the end of `DECISIONS.md`:

```markdown
## D-DOC-1. Part documents are shared records with deterministic link ids (#DOC, 2026-09-25)

A datasheet or spec sheet is one `part_documents` row linked to many parts through `part_document_links` (spec §2.5,
DaVinci's model). Ids: a new upload or fetch mints `PD-` + 12 random hex (`newDocumentId`, so the browser can mint the
id its Blob path is keyed under without a collection scan); the legacy backfill uses `PD-L` + sha1(SKU) and the
DaVinci pre-fill `PD-D` + sha1(URL), so both are idempotent. Link ids are `PDL-` + sha1(SKU, document) — one row per
part↔document, soft-deleted to detach and revived by re-attaching; accessory links are `PAL-` + sha1(source, scope,
parent, accessory). A document fetched or pre-filled from a URL is keyed by that URL: every part that referenced it
shares the one document (spec §3).

## D-DOC-2. "Has its own datasheet" opts a pair out for both kinds, across sources (#DOC, 2026-09-25)

The Assembly Builder's toggle lives on `part_accessory_links.ownDatasheet`, set on every live link of that
parent/accessory pair (assembly and DaVinci alike), and coverage reads the pair as opted out if any of its links says
so. It excludes the pair from step 3 of the coverage rule for spec sheets too — an accessory with its own datasheet is
documented on its own. Re-saving an assembly carries the flag over.

## D-DOC-3. Fetch failures are remembered on the document (#DOC, 2026-09-25)

Spec §6 says fetch failures are "listed with the reason" and batch fetch is resumable. `part_documents` gains an
additive `lastFetch: { at, ok, error? }`. A catalog-held URL that fails to fetch becomes a link-only document (source
`fetch`) linked to the part, carrying the failure, so the Datasheets page shows it until a retry succeeds and fills
the same document. The fetcher reuses `src/lib/venue-calendar-fetch.ts`'s guard unchanged (only `hostnameIsUnsafe`
became an export) with a 25 MB streaming cap, a 30 s timeout and five redirect hops, and batch fetch runs
`FETCH_BATCH_SIZE` = 4 slots per server-action call.

## D-DOC-4. Filename matching: normalizeSku keys, 4-character floor, any catalog part (#DOC, 2026-09-25)

Bulk drop matches each file name against every catalog part's SKU, MFR P/N and MFR M/N through the DaVinci matcher's
own `normalizeSku`; the longest matching length wins, and keys under 4 characters never match (a 3-character model
number appears by accident in too many file names). A key two parts share is "ambiguous" and nothing is pre-ticked.
Matching covers the whole catalog, not only quoted parts, and runs server-side from file names alone — the catalog
never ships to the browser.

## D-DOC-5. What "quoted" means on the Datasheets page (#DOC, 2026-09-25)

Scope is every catalog part on any quote (any status), any Grid placement or any generated bid spec, no time window
(spec §2.1). "Times quoted" counts distinct quotes; Grid and bid-spec use break ties, then the newest quote, then the
SKU. Labor lines and `kind: "labor"` sections are skipped (the quote client package's own BOM rule), `Labor`-category
parts are excluded, and a Grid curtain placement is not a catalog product.

## D-DOC-6. The part editor's Documents section replaces the admin-only datasheet control (#DOC, 2026-09-25)

Spec §2.4 lets anyone signed in upload, attach, replace and remove. The single-file, admin-only
`PartDatasheetControl` and its `uploadPartDatasheetAction` / `removePartDatasheetAction` (8 MB data-URL transport,
wrote `datasheetBlobKey`) are removed; the Documents section uploads direct to Blob (25 MB) into shared documents.
Nothing writes `datasheetBlobKey` any more. It stays readable: the idempotent backfill turns it into a `legacy`
document on first read, and `/api/part-datasheet/<sku>` keeps streaming it — and otherwise redirects to the part's
datasheet document — so older links (the Grid editor, the pre-v1 Displays route, bookmarks) keep working.

## D-DOC-7. Both Assembly Builder tabs feed the accessory graph (#DOC, 2026-09-25)

Assemblies tab: the `fixture`-role component is the parent and every other component an accessory (default quantity
above zero = `included`), scoped `assembly:<id>`; a save syncs every assembly in one pass and soft-deletes the links of
assemblies removed from the list. Subassemblies tab: the light engine is the parent, the lens and every option an
accessory, scoped `subassembly:<id>`, synced on save and cleared on delete. The toggle is enabled once a member is
saved (the pair must exist in the graph).

## D-DOC-8. DaVinci pre-fill: English datasheets keyed by URL, the graph in the committed extract (#DOC, 2026-09-25)

`extract.ts` now also emits `accessoryTypes` / `accessoryLinks` (6,702 links over 1,753 types from the 2026-04-21
library; records are byte-identical), growing `data/davinci-extract.json` from ~1.39 MB to ~2.65 MB — the graph needs
every type a link touches, including the lens tubes and clamps `records` drops. The pre-fill writes link-only
documents for English DaVinci **Datasheet** documents only (manuals and other languages are not a slot; `language:
"en"`), links them to every Peak ETC SKU of the type, and writes the DaVinci graph scope; both ends pass the #162
manufacturer allowlist. Nothing is downloaded. It runs from an admin button on the Datasheets page (the extract is
traced into that route with `outputFileTracingIncludes`) or `npm run part-docs:davinci -- --apply --commit`.

## D-DOC-9. Client packages: every document once; only a missing datasheet is a gap (#DOC, 2026-09-25)

A package zips each needed document once (`datasheets/…`, `specsheets/…`) with the SKUs it serves. Coverage is
computed in the package's own context — the Grid option's placements or the quote's lines — so an accessory rides on a
fixture only when that fixture is in the same package; alone, it is a `missing-datasheet` gap there. Covered
accessories are listed as `covered: [{ sku, by, note: "covered by <fixture>" }]`. A missing spec sheet is not a gap
(the spec names only `missing-datasheet`). The manifest's old `datasheets` array (which carried private blob keys
internally) is replaced by `documents`.

## D-DOC-10. A rejected upload's blob is deleted (#DOC, 2026-09-25)

"Nothing is ever hard-deleted" (spec §2.4) governs documents. An upload whose bytes fail the magic-number check (not a
PDF, or Word on a datasheet slot) or exceed 25 MB never became a document, so its blob is deleted rather than left
orphaned.

## D-DOC-11. Displays API datasheet links come from part documents (#DOC, 2026-09-25)

`publicCatalogPart(...).datasheets` lists the part's linked datasheet documents through `/api/part-documents/<id>`
(which streams, or redirects a link-only document to its source), else the manufacturer URLs the catalog row carries —
never the old `/api/part-datasheet/<sku>` URL that 404'd for a part whose only datasheet was a researched link. The
catalog ETag folds in documents and links, since attaching one moves no part's `updatedAt`.
```

Append to the end of `PUNCHLIST.md`:

```markdown
## #DOC. Part documents — datasheets and spec sheets, shared, with accessory coverage — DONE 2026-09-25 (D-DOC-1…D-DOC-11)

**Spec:** `docs/superpowers/specs/2026-09-25-part-documents-design.md` · **Plan:**
`docs/superpowers/plans/2026-09-25-part-documents.md` · **Closes:** #40 (a) and the population half of (c).

**Shipped.** Three doc-store collections (`part_documents`, `part_document_links`, `part_accessory_links`, migration
0026, idempotent per D141); a pure coverage rule (`src/lib/part-docs/coverage.ts`: own → not needed → covered by a
fixture → link only → missing, with context for quotes/packages); **Catalog → Datasheets** (`/catalog/documents`), the
to-do list of every quoted part with Datasheet / Spec sheet slots, drop zones, Also covers…, filters and bulk Fetch /
Mark not needed / Attach existing; **Upload many** (`/catalog/documents/upload`) with filename matching; direct-to-Blob
uploads (25 MB, magic-byte checked); fetch from links through the venue-calendar SSRF guard, one document per URL; the
part editor's Documents section for anyone signed in (the admin-only single-datasheet control is retired, D-DOC-6);
the Assembly Builder feeding the fixture → accessory graph with per-member coverage and a has-its-own-datasheet
toggle; the DaVinci accessory graph in the committed extract plus an admin/CLI pre-fill of link-only ETC datasheets;
Specs coverage, client packages (once per document, coverage in context, "covered by <fixture>") and the Displays API
reading the rule.

**Still open (Jeff-gated).** Run **Pre-fill from DaVinci** on production (admin button on `/catalog/documents`) and
confirm on a Vercel preview that the traced `data/davinci-extract.json` is present (the build's `.nft.json` lists it;
the function itself has not run hosted yet); then **Fetch links** in batches. Blob uploads in local dev remain
unreliable (see MASTER-HOWTO §9) — verify drag-and-drop on a preview deploy.
```

In `PUNCHLIST.md`, replace this exact text:

```markdown
**Status:** OPEN — wave 2 (depends on #39 attachments being populated).
```

with:

```markdown
**Status:** (a) and the population half of (c) DONE via #DOC (part documents, 2026-09-25); (b) is the Specs module (#205); the generator half of (c) remains — wave 2.
```


- [ ] **Step 8: Run every gate**

```bash
npx tsc --noEmit -p .
```

Expected: no output, exit 0.

```bash
env -u DATABASE_URL npm run test:specs > "${TMPDIR:-/tmp}/pd-specs.log" 2>&1; tail -1 "${TMPDIR:-/tmp}/pd-specs.log"; grep '^FAIL' "${TMPDIR:-/tmp}/pd-specs.log"
```

Expected: `ALL PASSED` and no `FAIL` lines. (One pre-existing flake exists — `redeem: tampered code -> not ok`, a random-code test that fails about one run in sixty; if it is the only FAIL, re-run.)

Expected additionally: `grep -c '^PASS part docs' "${TMPDIR:-/tmp}/pd-specs.log"` prints `125` and `grep -c '^PASS #DOC' "${TMPDIR:-/tmp}/pd-specs.log"` prints `11`.

```bash
env -u DATABASE_URL npm run test:review:regressions 2>&1 | tail -2
```

Expected: `review regression checks passed` then `quote email regression checks passed`.

```bash
npx eslint 2>&1 | grep problems
```

Expected: `✖ N problems (0 errors, N warnings)` with N ≤ 111 (the baseline is 111; Task 8 removes one).

```bash
npx drizzle-kit generate 2>&1 | tail -1
```

Expected: `No schema changes, nothing to migrate 😴`.

```bash
env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build > "${TMPDIR:-/tmp}/pd-build.log" 2>&1; echo "build exit: $?"; tail -3 "${TMPDIR:-/tmp}/pd-build.log"; rm -rf .next
```

Expected: `build exit: 0`, the route table's legend (`ƒ  (Dynamic)  server-rendered on demand`) in the tail, and `.next` removed afterwards. A client component that imports a store or `@/db` value fails here, not in tsc.

Smoke boots a real `next dev` on a throwaway datadir. Before it: `ps aux | grep -E 'tsx|next dev' | grep -v grep` must be empty (stop anything of yours; never kill another session's server), and `lsof -i :3000` must be free.

```bash
env -u DATABASE_URL npm run test:smoke 2>&1 | tail -4
```

Expected: every route `PASS`, including `/catalog/documents`, `/catalog/documents?show=missing-datasheet`, `/catalog/documents/upload` and `/catalog?edit=RB-MV-MN`, and a final all-passed line with 0 failures.

```bash
ps aux | grep -E 'tsx|next dev' | grep -v grep
```

Expected: no output — nothing left holding a datadir.


- [ ] **Step 9: Commit**

```bash
git add src/lib/displays-api.ts src/app/api/v1/displays 'src/app/api/part-datasheet/[id]/route.ts' 'src/app/(app)/design/grid/[id]/page.tsx' src/lib/design/grid-bom.ts scripts/smoke-routes.ts DECISIONS.md PUNCHLIST.md scripts/test-review-and-spec.ts
git commit -m "feat(part-docs): Displays API links via the document viewer, datasheet-route bridge, Grid flag, smoke, docs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

---

## Self-Review

**Spec coverage.**
- §2.1 scope/ranking → Task 2 (`quotedPartStats`, `rankQuotedParts`), Task 6 page. §2.2 two kinds → Task 1 types, Task 4 `ALLOWED_TYPES`. §2.3 three ways in → Task 6 (to-do + drop zones), Task 7 (bulk drop), Task 5 (fetch). §2.4 anyone signed in / who+when / never hard-deleted → Task 3 stores (`uploadedBy`, `createdBy`, history, soft-delete detach), Task 4 actions (`requireUser`), D-DOC-10. §2.5 DaVinci model → Tasks 2, 9, 10.
- §3 to-do list (rows, five cell states, progress line, filters, search, multi-select, Fetch links / Mark not needed / Attach an existing document, drop → Also covers… with family + accessories) → Task 6. Bulk drop (normalization, longest match, kind guess, confidence, part search for unmatched/ambiguous, Confirm) → Tasks 2 + 7. Fetch from links (both sources, server-side, byte check, private storage, failures with reason, shared per URL) → Task 5 (+ Task 10 for DaVinci URLs). Part editor (slots, own documents, Covered by with context) → Task 8. Assembly Builder (members = accessory links, coverage, toggle, edit updates graph) → Task 9. Client package (once, context coverage, `missing-datasheet` only when no fixture present, "covered by") → Task 11.
- §4 coverage rule, all five outcomes, context, opt-out, collapse > 5 → Task 2 (tested), used by Tasks 6, 8, 9, 11, 12.
- §5 data: three collections via one idempotent migration with `_seq_bump` triggers → Task 1; not-needed marks on the part via `mergeUpsert` → Tasks 1 + 3; legacy backfill on first read + a script, `datasheetBlobKey` still readable → Task 3 (+ Task 8, Task 12 bridge); `part-docs/<documentId>/<fileName>` → Task 1 `partDocBlobPath`.
- §6 direct-to-Blob, 25 MB, magic bytes, signed-in token route → Task 4; fetch guard reuse, bounded + resumable batch → Task 5; DaVinci extract + admin/script, both ends matched, merged duplicates, sourceUrl only → Task 10.
- §7 `hasDatasheet` + client package use the rule (link only no longer counts) → Task 11; Displays API links → Task 12; viewer route → Task 4.
- §8 testing: every pure item named there has assertions (coverage, filename matcher, kind guesser, quoted-parts counter, DaVinci mapping with merged duplicates); store CRUD, idempotent backfill and history-on-replace → Task 3 regressions; fetch guard reuse and magic bytes → Tasks 4–5; gates including smoke, build and drizzle "no changes" → Task 12.
- §9 out of scope respected: no public rehosting, no OCR, `language` stored only.

**Placeholder scan.** No TBD/TODO/"similar to". `#DOC` / `D-DOC-n` are the deliberate numbering placeholders the lead renumbers.

**Type consistency.** Checked across tasks: `SlotCoverage` / `SlotView` / `DocRef`, `CoverageIndex` fields (`docsBySku`, `parentsOf`, `childrenOf`, `catalogUrls`, `docsById`, `notNeeded`), `PartDocsState`, `FetchTarget` / `FetchOutcome`, `DocActionResult`, `AccessoryPair` (defined once in `types.ts`, used by the store, `assembly-graph.ts` and `davinci-prefill.ts`), `MemberCoverage`, `PackageDocRef` / `PackageDocument`, `PrefillPlan`. The actions file's import block is rebuilt whole at each task that grows it (Tasks 5, 6, 7, 10), so an implementer never has to merge imports by hand.
