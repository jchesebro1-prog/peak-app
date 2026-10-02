# Manufacturer Images + Placeholders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a part has no photo of its own, customers see a kind placeholder (Allowance / Custom Device), the manufacturer's image, a pricing placeholder (Contact Us) or "Image Coming Soon" — portal full chain, documents stop after the manufacturer image — and staff upload one image per manufacturer on Catalog → Manufacturers.

**Architecture:** One pure fallback rule (`src/lib/part-image-fallback.ts`). A new `manufacturers` doc collection keyed by `mfrKey`, whose image is an ordinary **unlinked** `part_documents` image with source `manufacturer` — so upload, sniffing, shrink, history, serving and every photo route are reused unchanged, and nothing counts it as a part photo (all counts go through links). The portal index learns which manufacturers have images and makes those documents servable; tiles and the part sidebar carry a computed `fallback`. Documents reuse `keyProductPhotoDocs` (manufacturer doc for a sku without its own photo) and print static placeholders for allowance/custom key products.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle doc-store (Postgres/PGlite), Vercel Blob, sharp (`shrinkImage`), `scripts/test-review-and-spec.ts` harness.

**Spec:** `docs/superpowers/specs/2026-10-02-manufacturer-images-placeholders-design.md`

## Global Constraints

- Placeholder files, exactly: `public/placeholders/allowance.webp`, `custom-device.webp`, `contact-us.webp`, `coming-soon.webp` (Jeff's four 1254×1254 WebP files, copied unchanged).
- **Portal chain:** own photo → `allowance` → `custom-device` → manufacturer image → `contact-us` (POR) → `coming-soon`. Never null.
- **Document chain:** own photo → `allowance` → `custom-device` → manufacturer image → null (prints full width). Documents never print `contact-us` or `coming-soon`.
- **Custom:** catalog category `Custom Parts`; quote line `custom: true`. **Allowance:** quote line `allowance: true`. **POR:** portal `por`.
- A fallback is never stored on a part and never counts as a photo (photo counts, Photo sheet, Datasheets to-do, portal visibility read only linked images).
- Manufacturer key = `mfrKey(name)` from `src/lib/catalog-books.ts` (lowercase, a–z0–9 only). One record per key. Record id `"MF-" + 10 hex`.
- Manufacturer image = `part_documents` record, `kind: "image"`, `source: "manufacturer"`, `sourceRef: "mfr:<key>"`, **no links**. New `PartDocumentSource` value `"manufacturer"`, label "Manufacturer", `IMAGE_SOURCE_RANK` 0.
- Set image keeps the previous id in `imageHistory`; Remove clears `imageDocumentId` and keeps the document. Nothing is ever deleted.
- Permissions: view `/catalog/manufacturers` = signed in; set/remove/upload-many = `requirePerm("create")`.
- Upload-many match: `mfrKey(file name without extension) === row.key` exactly; never substring.
- Key-product token for allowance/custom lines: `KeyProduct.sku = "line:" + line id`.
- Copy: sentence case, em dashes, no exclamation marks.

## Before you start (worktree)

Fresh worktree off `origin/main` (`git worktree add .claude/worktrees/mfr-images -b feat/mfr-images origin/main`), then `npm ci` (never symlink), copy `.env.local` and `next-env.d.ts` from the main checkout. `export PATH="$HOME/.local/node/bin:$PATH"`. Never open `.data/pglite`; never `git stash`. Record the baseline: `npm run test:specs > /tmp/claude-501/mfr-base.txt 2>&1; grep -c "^PASS" /tmp/claude-501/mfr-base.txt`. Gates per task: `npx tsc --noEmit` (0), `npm run test:specs` (ALL PASSED, PASS = previous + new), `npx eslint <touched source files>` (0; never lint the 43k-line harness). Check `df -h /System/Volumes/Data | tail -1` before suites; under 3 GB stop.

**Harness conventions** (`scripts/test-review-and-spec.ts`): `ok(cond, msg)`; append blocks at the END with uniquely-aliased imports right above; async DB blocks are `async function xxxAsyncChecks()` added to the promise chain (search `.finally(() => teardownFixtures())` and insert the `.then(...)` line just before it, after the last existing `.then`). Fixtures: `fixtureId(scope, slug)`, `registerFixture(coll, id)`, `upsertPart` (already imported). Prefix check messages `"mfr images: …"`.

## File structure

| File | Responsibility |
|---|---|
| `public/placeholders/*.webp` (create ×4) | the placeholder images |
| `src/lib/part-image-fallback.ts` (create, pure) | placeholder names/URLs, both chains, custom detection |
| `src/db/doc-tables.ts`, `src/db/schema*` via drizzle, `drizzle/0035_manufacturers.sql` (create) | the `manufacturers` table |
| `src/lib/part-docs/types.ts`, `src/app/(app)/catalog/part-documents-section.tsx` (modify) | `manufacturer` source, rank, label |
| `src/lib/stores/manufacturers.ts` (create, server) | records: list/get by key, set/remove image |
| `src/lib/manufacturer-rows.ts` (create, pure) | the page's rows + upload-many matcher |
| `src/app/(app)/catalog/manufacturers/{page.tsx,actions.ts,manufacturers-client.tsx}` (create) | the page |
| `src/app/(app)/catalog/documents/upload-client.ts` (modify) | export `putFile` |
| `src/app/(app)/catalog/documents/actions.ts` (modify) | search excludes manufacturer images |
| `src/app/(app)/catalog/page.tsx` (modify) | header link |
| `src/lib/portal-catalog-index.ts`, `portal-catalog-view.ts`, `portal-part-view.ts`, `portal-catalog-browse.ts`, `portal-part-detail.ts` (modify) | portal fallback data |
| `src/app/portal/catalog/{panel-ui.tsx,catalog-client.tsx,part-sidebar.tsx}` (modify) | portal rendering |
| `src/app/(app)/estimator/narrative.ts`, `quote-document.tsx`, `narrative-column.tsx`, `src/lib/narrative/{photos.ts,library.ts,merge.ts}` (modify) | documents |
| `src/lib/curtain-cut-sheets/load.ts` (modify) | cut-sheet fallback |
| `scripts/smoke-routes.ts`, `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` (modify) | smoke + docs |

---

### Task 1: Placeholder files + the pure fallback rule

**Files:** Create `src/lib/part-image-fallback.ts` (the four `public/placeholders/*.webp` files are already committed); test: append to harness.

**Interfaces — Produces:**
- `type PlaceholderName = "allowance" | "custom-device" | "contact-us" | "coming-soon"`
- `const PLACEHOLDER_SRC: Record<PlaceholderName, string>`
- `type ImageFallback = { kind: "image"; documentId: string; label: string } | { kind: "placeholder"; name: PlaceholderName }`
- `type FallbackInput = { allowance?: boolean; custom?: boolean; mfr?: string | null; por?: boolean }`
- `type MfrImageLookup = (mfr: string) => string | null` (manufacturer name → image document id)
- `portalFallback(input: FallbackInput, mfrImage: MfrImageLookup): ImageFallback` (never null)
- `documentFallback(input: FallbackInput, mfrImage: MfrImageLookup): ImageFallback | null`
- `const CUSTOM_PARTS_CATEGORY = "Custom Parts"`; `isCustomCategory(category: string | null | undefined): boolean`
- `fallbackSrc(f: ImageFallback, docSrc: (id: string) => string): string`

- [ ] **Step 1: The images are already committed** with the spec (Jeff's four files, unchanged): `public/placeholders/allowance.webp`, `contact-us.webp`, `custom-device.webp`, `coming-soon.webp`. Confirm they exist (`ls public/placeholders`); do not modify them.

- [ ] **Step 2: Failing tests** — append:

```ts
/* ======================================================================
   Manufacturer images — the pure fallback rule (part-image-fallback.ts).
   ====================================================================== */
import { portalFallback as mfiPortal, documentFallback as mfiDoc, PLACEHOLDER_SRC as mfiSrc, isCustomCategory as mfiIsCustom, fallbackSrc as mfiFallbackSrc } from "@/lib/part-image-fallback";
import { existsSync as mfiExists } from "node:fs";
{
  const img = (m: string) => (m.trim().toLowerCase() === "etc" ? "PD-etc-logo" : null);
  const p = (i: Parameters<typeof mfiPortal>[0]) => JSON.stringify(mfiPortal(i, img));
  const d = (i: Parameters<typeof mfiDoc>[0]) => JSON.stringify(mfiDoc(i, img));
  ok(p({ allowance: true, mfr: "ETC" }) === JSON.stringify({ kind: "placeholder", name: "allowance" }), "mfr images: an allowance shows the Allowance placeholder even with a manufacturer image");
  ok(p({ custom: true, mfr: "ETC" }) === JSON.stringify({ kind: "placeholder", name: "custom-device" }), "mfr images: a custom item shows Custom Device even with a manufacturer image");
  ok(p({ mfr: "ETC", por: true }) === JSON.stringify({ kind: "image", documentId: "PD-etc-logo", label: "ETC" }), "mfr images: a manufacturer image beats Contact Us");
  ok(p({ mfr: "Chauvet", por: true }) === JSON.stringify({ kind: "placeholder", name: "contact-us" }), "mfr images: price on request without a manufacturer image shows Contact Us");
  ok(p({ mfr: "", por: false }) === JSON.stringify({ kind: "placeholder", name: "coming-soon" }) && p({}) === JSON.stringify({ kind: "placeholder", name: "coming-soon" }), "mfr images: nothing else applies → Image Coming Soon");
  ok(d({ allowance: true }) === JSON.stringify({ kind: "placeholder", name: "allowance" }) && d({ custom: true }) === JSON.stringify({ kind: "placeholder", name: "custom-device" }), "mfr images: documents print the kind placeholders");
  ok(d({ mfr: "ETC" }) === JSON.stringify({ kind: "image", documentId: "PD-etc-logo", label: "ETC" }), "mfr images: documents print the manufacturer image");
  ok(mfiDoc({ mfr: "Chauvet", por: true }, img) === null && mfiDoc({}, img) === null, "mfr images: documents never print Contact Us or Coming Soon");
  ok(mfiIsCustom("Custom Parts") && mfiIsCustom(" custom parts ") && !mfiIsCustom("Lighting") && !mfiIsCustom(null), "mfr images: the Custom Parts category marks a custom catalog part");
  ok(mfiFallbackSrc({ kind: "placeholder", name: "coming-soon" }, (id) => "/d/" + id) === "/placeholders/coming-soon.webp" && mfiFallbackSrc({ kind: "image", documentId: "X", label: "" }, (id) => "/d/" + id) === "/d/X", "mfr images: fallbackSrc maps placeholders to static files and images through the caller's doc URL");
  ok(Object.values(mfiSrc).every((s) => mfiExists("public" + s)), "mfr images: all four placeholder files ship in public/placeholders");
}
```

- [ ] **Step 3: Run** `npm run test:specs 2>&1 | tail -3` → module-not-found.

- [ ] **Step 4: Implement `src/lib/part-image-fallback.ts`**

```ts
/**
 * What shows where a part photo belongs when the part has none of its own
 * (spec 2026-10-02-manufacturer-images-placeholders-design.md). Pure; safe in
 * client components. The caller checks the part's own photo first.
 *
 * Portal chain:   allowance → custom-device → manufacturer image → contact-us (POR) → coming-soon
 * Document chain: allowance → custom-device → manufacturer image → nothing (prints full width)
 *
 * A fallback is never stored on a part and never counts as a photo.
 */

export type PlaceholderName = "allowance" | "custom-device" | "contact-us" | "coming-soon";

export const PLACEHOLDER_SRC: Record<PlaceholderName, string> = {
  allowance: "/placeholders/allowance.webp",
  "custom-device": "/placeholders/custom-device.webp",
  "contact-us": "/placeholders/contact-us.webp",
  "coming-soon": "/placeholders/coming-soon.webp",
};

export type ImageFallback = { kind: "image"; documentId: string; label: string } | { kind: "placeholder"; name: PlaceholderName };
export type FallbackInput = { allowance?: boolean; custom?: boolean; mfr?: string | null; por?: boolean };
/** Manufacturer name → its image document id, or null. */
export type MfrImageLookup = (mfr: string) => string | null;

export const CUSTOM_PARTS_CATEGORY = "Custom Parts";

export function isCustomCategory(category: string | null | undefined): boolean {
  return String(category ?? "").trim().toLowerCase() === CUSTOM_PARTS_CATEGORY.toLowerCase();
}

function kindOrManufacturer(input: FallbackInput, mfrImage: MfrImageLookup): ImageFallback | null {
  if (input.allowance) return { kind: "placeholder", name: "allowance" };
  if (input.custom) return { kind: "placeholder", name: "custom-device" };
  const mfr = String(input.mfr ?? "").trim();
  const id = mfr ? mfrImage(mfr) : null;
  return id ? { kind: "image", documentId: id, label: mfr } : null;
}

export function portalFallback(input: FallbackInput, mfrImage: MfrImageLookup): ImageFallback {
  return kindOrManufacturer(input, mfrImage) ?? { kind: "placeholder", name: input.por ? "contact-us" : "coming-soon" };
}

export function documentFallback(input: FallbackInput, mfrImage: MfrImageLookup): ImageFallback | null {
  return kindOrManufacturer(input, mfrImage);
}

/** The <img src> for a fallback; an image goes through the caller's own document URL. */
export function fallbackSrc(f: ImageFallback, docSrc: (documentId: string) => string): string {
  return f.kind === "image" ? docSrc(f.documentId) : PLACEHOLDER_SRC[f.name];
}
```

- [ ] **Step 5: Run** the suite → all PASS. **Step 6: Gates + commit:**

```bash
npx tsc --noEmit && npx eslint src/lib/part-image-fallback.ts
git add src/lib/part-image-fallback.ts scripts/test-review-and-spec.ts
git commit -m "feat(catalog): placeholder images + the image fallback rule"
```

---

### Task 2: `manufacturers` table, `manufacturer` image source, the store

**Files:** Modify `src/db/doc-tables.ts`; create `drizzle/0035_manufacturers.sql` (+ drizzle meta via `npm run db:generate`); modify `src/lib/part-docs/types.ts:49,136`, `src/app/(app)/catalog/part-documents-section.tsx` (label), `src/app/(app)/catalog/documents/actions.ts` (`searchDocumentsAction`); create `src/lib/stores/manufacturers.ts`; test: harness async block.

**Interfaces — Produces** (`src/lib/stores/manufacturers.ts`, server-only):
- `type Manufacturer = { id: string; key: string; name: string; imageDocumentId: string | null; imageHistory: string[]; createdAt: number; updatedAt: number; updatedBy: string }`
- `listManufacturers(): Promise<Manufacturer[]>`
- `manufacturerByKey(key: string): Promise<Manufacturer | null>`
- `setManufacturerImage(input: { name: string; documentId: string; by: string; at?: number }): Promise<Manufacturer>` (creates the record when missing; previous image → history)
- `removeManufacturerImage(key: string, by: string, at?: number): Promise<Manufacturer | null>`
- `manufacturerImageLookup(rows: readonly Manufacturer[]): (mfr: string) => string | null` (pure helper, exported from the store file — keyed by `mfrKey`)

- [ ] **Step 1: Table.** In `src/db/doc-tables.ts`, after `rewardLedger`:

```ts
export const manufacturers = docTable("manufacturers"); // Manufacturer section Part 1 — one record per mfrKey with its image (an unlinked part_documents image); spec 2026-10-02-manufacturer-images-placeholders-design.md; migration 0035_manufacturers
```

and add `manufacturers,` to `DOC_TABLES` after `reward_ledger: rewardLedger,`. Do NOT add it to the sync-push allowlist.

- [ ] **Step 2: Migration.** Run `npm run db:generate`, then make the generated `drizzle/0035_*.sql` (rename the file to `0035_manufacturers.sql` and the journal tag to match, if drizzle named it differently) idempotent exactly like `drizzle/0032_portal_carts.sql`: header comment, `CREATE TABLE IF NOT EXISTS "manufacturers" (…8 docTable columns…)`, `CREATE INDEX IF NOT EXISTS "manufacturers_seq_idx" … ("seq")`, `CREATE INDEX IF NOT EXISTS "manufacturers_deleted_idx" … ("deleted")`, and `CREATE OR REPLACE TRIGGER manufacturers_seq_bump BEFORE UPDATE ON "manufacturers" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();`. If `origin/main` already has a 0035 by now, use the next number and say so in the report.

- [ ] **Step 3: Source value.** `src/lib/part-docs/types.ts:49` add `| "manufacturer"` to `PartDocumentSource`; `IMAGE_SOURCE_RANK` add `manufacturer: 0,`. `part-documents-section.tsx` `IMAGE_SOURCE_LABEL` add `manufacturer: "Manufacturer",`. In `searchDocumentsAction` (`catalog/documents/actions.ts`), filter `d.source !== "manufacturer"` before the token filter (a manufacturer image is never offered as "attach existing" to a part).

- [ ] **Step 4: Failing tests** — append, and add `.then(() => mfrStoreAsyncChecks())` to the chain:

```ts
/* ======================================================================
   Manufacturer images — the manufacturers store (PGlite).
   ====================================================================== */
import { listManufacturers as mfsList, manufacturerByKey as mfsByKey, setManufacturerImage as mfsSet, removeManufacturerImage as mfsRemove, manufacturerImageLookup as mfsLookup } from "@/lib/stores/manufacturers";
import { createDocument as mfsCreateDoc, attachDocument as mfsAttach, visibleImagesForParts as mfsVisible } from "@/lib/stores/part-documents";
import { searchDocumentsAction as mfsSearch } from "@/app/(app)/catalog/documents/actions";
async function mfrStoreAsyncChecks(): Promise<void> {
  const mkDoc = async (title: string) => {
    const d = await mfsCreateDoc({ kind: "image", title, fileName: title + ".webp", contentType: "image/webp", size: 10, blobKey: null, sourceUrl: null, source: "manufacturer", sourceRef: "mfr:testmfrimg", by: "mfr test" });
    if (d) registerFixture("part_documents", d.id);
    return d!;
  };
  const a = await mkDoc("TestMfrImg logo A");
  const m1 = await mfsSet({ name: "TestMfrImg", documentId: a.id, by: "mfr test" });
  registerFixture("manufacturers", m1.id);
  ok(/^MF-[0-9a-f]{10}$/.test(m1.id) && m1.key === "testmfrimg" && m1.imageDocumentId === a.id && m1.imageHistory.length === 0, "mfr images: the first image creates the record lazily, keyed by mfrKey");
  const b = await mkDoc("TestMfrImg logo B");
  const m2 = await mfsSet({ name: "Test-Mfr Img", documentId: b.id, by: "mfr test" });
  ok(m2.id === m1.id && m2.imageDocumentId === b.id && m2.imageHistory[0] === a.id, "mfr images: a second spelling with the same key updates the same record; the old image moves to history");
  ok((await mfsList()).filter((m) => m.key === "testmfrimg").length === 1, "mfr images: one record per key");
  const m3 = await mfsRemove("testmfrimg", "mfr test");
  ok(!!m3 && m3.imageDocumentId === null && m3.imageHistory.slice(0, 2).join() === [b.id, a.id].join(), "mfr images: remove clears the image and keeps it in history");
  await mfsSet({ name: "TestMfrImg", documentId: b.id, by: "mfr test" });
  const look = mfsLookup(await mfsList());
  ok(look("TEST MFR IMG") === b.id && look("Nobody") === null, "mfr images: the lookup matches any spelling with the same key");
  ok((await mfsByKey("testmfrimg"))?.imageDocumentId === b.id, "mfr images: manufacturerByKey reads the record");
  const SKU = fixtureId("MFI", "PART-1");
  await upsertPart({ id: SKU, sku: SKU, desc: "mfr img part", category: "Lighting", unit: "ea", list: 1, cost: 1, mfr: "TestMfrImg" });
  registerFixture("catalog_parts", SKU);
  ok(!((await mfsVisible([SKU])).get(SKU)?.length), "mfr images: an unlinked manufacturer image never appears in a part's images");
  void mfsAttach;
  const hits = await mfsSearch("TestMfrImg logo").catch(() => null);
  ok(hits === null || (hits.ok && !hits.hits.some((h) => h.id === a.id || h.id === b.id)), "mfr images: attach-existing search never offers a manufacturer image");
}
```

(`mfsSearch` needs a session; if it throws in the harness the check passes vacuously — then add a source-level check instead: `readFileSync("src/app/(app)/catalog/documents/actions.ts","utf8").includes('source !== "manufacturer"')`.)

- [ ] **Step 5: Implement `src/lib/stores/manufacturers.ts`**

```ts
// SERVER ONLY — the manufacturers collection (Manufacturer section Part 1).
import { randomBytes } from "node:crypto";
import { getDoc, listDocs, upsertDoc } from "@/db/doc-store";
import { mfrKey } from "@/lib/catalog-books";

/**
 * One record per manufacturer key (mfrKey: lowercase, a–z0–9). Created
 * lazily the first time an image is set. The image is an ordinary
 * part_documents image with source "manufacturer" and NO part links, so it
 * never counts as a part photo. Nothing here deletes anything: a replaced
 * or removed image id moves to imageHistory. Parts 2–3 add company/vendor
 * links and cost data to this same record.
 */

export type Manufacturer = {
  id: string;
  key: string;
  name: string;
  imageDocumentId: string | null;
  imageHistory: string[];
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
};

const COLL = "manufacturers" as const;
const newId = () => "MF-" + randomBytes(5).toString("hex");

function clean(raw: Record<string, unknown>): Manufacturer {
  return {
    id: String(raw.id),
    key: String(raw.key ?? ""),
    name: String(raw.name ?? ""),
    imageDocumentId: typeof raw.imageDocumentId === "string" && raw.imageDocumentId ? raw.imageDocumentId : null,
    imageHistory: Array.isArray(raw.imageHistory) ? raw.imageHistory.filter((s): s is string => typeof s === "string") : [],
    createdAt: Number(raw.createdAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
    updatedBy: String(raw.updatedBy ?? ""),
  };
}

export async function listManufacturers(): Promise<Manufacturer[]> {
  return (await listDocs<Record<string, unknown> & { id: string }>(COLL)).map(clean);
}

export async function manufacturerByKey(key: string): Promise<Manufacturer | null> {
  const k = mfrKey(key);
  if (!k) return null;
  return (await listManufacturers()).find((m) => m.key === k) ?? null;
}

async function save(m: Manufacturer): Promise<Manufacturer> {
  await upsertDoc(COLL, m as unknown as { id: string } & Record<string, unknown>);
  return m;
}

export async function setManufacturerImage(input: { name: string; documentId: string; by: string; at?: number }): Promise<Manufacturer> {
  const key = mfrKey(input.name);
  if (!key) throw new Error("A manufacturer needs a name.");
  const at = input.at ?? Date.now();
  const cur = await manufacturerByKey(key);
  if (!cur) {
    return save({ id: newId(), key, name: input.name.trim(), imageDocumentId: input.documentId, imageHistory: [], createdAt: at, updatedAt: at, updatedBy: input.by });
  }
  const history = cur.imageDocumentId && cur.imageDocumentId !== input.documentId ? [cur.imageDocumentId, ...cur.imageHistory] : cur.imageHistory;
  return save({ ...cur, imageDocumentId: input.documentId, imageHistory: history, updatedAt: at, updatedBy: input.by });
}

export async function removeManufacturerImage(key: string, by: string, at: number = Date.now()): Promise<Manufacturer | null> {
  const cur = await manufacturerByKey(key);
  if (!cur) return null;
  if (!cur.imageDocumentId) return cur;
  return save({ ...cur, imageHistory: [cur.imageDocumentId, ...cur.imageHistory], imageDocumentId: null, updatedAt: at, updatedBy: by });
}

/** name → image document id for every manufacturer with an image (pure over `rows`). */
export function manufacturerImageLookup(rows: readonly Manufacturer[]): (mfr: string) => string | null {
  const byKey = new Map(rows.filter((m) => m.imageDocumentId).map((m) => [m.key, m.imageDocumentId as string] as const));
  return (mfr) => byKey.get(mfrKey(mfr)) ?? null;
}
```

Check `upsertDoc`'s real signature in `src/db/doc-store.ts` and adapt the call (it is used by `src/lib/stores/vendors.ts` — copy that usage). If `getDoc` is unused after adapting, drop the import.

- [ ] **Step 6: Run** suite → PASS (count = previous + new). **Step 7: Gates + commit:**

```bash
npx tsc --noEmit && npx eslint src/lib/stores/manufacturers.ts src/db/doc-tables.ts src/lib/part-docs/types.ts "src/app/(app)/catalog/part-documents-section.tsx" "src/app/(app)/catalog/documents/actions.ts"
git add src/db drizzle src/lib/stores/manufacturers.ts src/lib/part-docs/types.ts "src/app/(app)/catalog/part-documents-section.tsx" "src/app/(app)/catalog/documents/actions.ts" scripts/test-review-and-spec.ts
git commit -m "feat(catalog): manufacturers table + unlinked manufacturer image documents"
```

---

### Task 3: Catalog → Manufacturers page

**Files:** Create `src/lib/manufacturer-rows.ts` (pure), `src/app/(app)/catalog/manufacturers/{page.tsx,actions.ts,manufacturers-client.tsx}`; modify `src/app/(app)/catalog/documents/upload-client.ts` (export `putFile`), `src/app/(app)/catalog/page.tsx` (header link), `scripts/smoke-routes.ts`; test: harness.

**Interfaces — Produces:**
- `src/lib/manufacturer-rows.ts`:
  - `type ManufacturerRow = { key: string; name: string; spellings: string[]; parts: number; withoutPhoto: number; imageDocumentId: string | null }`
  - `manufacturerRows(parts: readonly { mfr?: string; category?: string; sku: string }[], hasOwnPhoto: (sku: string) => boolean, records: readonly { key: string; imageDocumentId: string | null }[]): ManufacturerRow[]` — Labor excluded, blank mfr excluded, name = most common spelling (ties → alphabetical), `spellings` = other spellings sorted, sorted by parts desc then name.
  - `matchManufacturerFile(fileName: string, rows: readonly Pick<ManufacturerRow, "key">[]): string | null` — `mfrKey(name without extension)` equal to a row key, else null.
- `actions.ts` (`"use server"`): `setManufacturerImageAction(input: { name: string; documentId: string; blobPathname: string; fileName: string }): Promise<{ ok: true } | { ok: false; error: string }>`, `removeManufacturerImageAction(key: string)`.

- [ ] **Step 1: Failing pure tests** — append:

```ts
/* ======================================================================
   Manufacturer images — page rows + upload-many matcher (pure).
   ====================================================================== */
import { manufacturerRows as mfrRows, matchManufacturerFile as mfrMatch } from "@/lib/manufacturer-rows";
{
  const parts = [
    { sku: "A1", mfr: "ETC", category: "Lighting" }, { sku: "A2", mfr: "E.T.C.", category: "Lighting" }, { sku: "A3", mfr: "ETC", category: "Lighting" },
    { sku: "B1", mfr: "Allen and Heath", category: "Audio" }, { sku: "B2", mfr: "Allen & Heath", category: "Audio" },
    { sku: "L1", mfr: "ETC", category: "Labor" }, { sku: "N1", mfr: "", category: "Lighting" },
  ];
  const rows = mfrRows(parts, (s) => s === "A1", [{ key: "etc", imageDocumentId: "PD-1" }]);
  const etc = rows.find((r) => r.key === "etc");
  ok(rows[0].key === "etc" && !!etc && etc.name === "ETC" && etc.spellings.join() === "E.T.C." && etc.parts === 3 && etc.withoutPhoto === 2 && etc.imageDocumentId === "PD-1", "mfr images: rows group spellings by key, count parts (no Labor) and parts without a photo, carry the image");
  ok(rows.some((r) => r.key === "allenandheath") && rows.some((r) => r.key === "allenheath") && !rows.some((r) => r.key === ""), "mfr images: '&' vs 'and' stay separate rows (Part 2 merges); blank manufacturers are left out");
  ok(mfrMatch("ETC.jpg", rows) === "etc" && mfrMatch("e.t.c.PNG", rows) === "etc" && mfrMatch("Allen and Heath.webp", rows) === "allenandheath", "mfr images: a file name matches a manufacturer by key, any case or punctuation");
  ok(mfrMatch("ETC Lighting.jpg", rows) === null && mfrMatch("photo.jpg", rows) === null, "mfr images: a file name never matches by substring");
}
```

- [ ] **Step 2: Implement `src/lib/manufacturer-rows.ts`**

```ts
import { mfrKey } from "@/lib/catalog-books";

/** Catalog → Manufacturers rows (pure). One row per mfrKey; Labor and blank
 *  manufacturers left out; the shown name is the most common spelling. */
export type ManufacturerRow = { key: string; name: string; spellings: string[]; parts: number; withoutPhoto: number; imageDocumentId: string | null };

export function manufacturerRows(
  parts: readonly { mfr?: string; category?: string; sku: string }[],
  hasOwnPhoto: (sku: string) => boolean,
  records: readonly { key: string; imageDocumentId: string | null }[]
): ManufacturerRow[] {
  const acc = new Map<string, { counts: Map<string, number>; parts: number; withoutPhoto: number }>();
  for (const p of parts) {
    if (p.category === "Labor") continue;
    const name = String(p.mfr ?? "").trim();
    const key = mfrKey(name);
    if (!key) continue;
    let a = acc.get(key);
    if (!a) acc.set(key, (a = { counts: new Map(), parts: 0, withoutPhoto: 0 }));
    a.counts.set(name, (a.counts.get(name) ?? 0) + 1);
    a.parts++;
    if (!hasOwnPhoto(p.sku)) a.withoutPhoto++;
  }
  const image = new Map(records.map((r) => [r.key, r.imageDocumentId] as const));
  const rows: ManufacturerRow[] = [];
  for (const [key, a] of acc) {
    const names = [...a.counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
    rows.push({ key, name: names[0][0], spellings: names.slice(1).map((n) => n[0]).sort((x, y) => x.localeCompare(y)), parts: a.parts, withoutPhoto: a.withoutPhoto, imageDocumentId: image.get(key) ?? null });
  }
  return rows.sort((x, y) => y.parts - x.parts || x.name.localeCompare(y.name));
}

/** Upload many: a file name (extension dropped) matches the row whose key it equals — never a substring. */
export function matchManufacturerFile(fileName: string, rows: readonly Pick<ManufacturerRow, "key">[]): string | null {
  const base = String(fileName ?? "").split(/[\\/]/).pop() || "";
  const key = mfrKey(base.replace(/\.[A-Za-z0-9]{1,5}$/, ""));
  return key && rows.some((r) => r.key === key) ? key : null;
}
```

- [ ] **Step 3: Export `putFile`** in `upload-client.ts` (change `async function putFile` to `export async function putFile`).

- [ ] **Step 4: `actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { invalidatePortalIndex } from "@/lib/portal-catalog-index";
import { createDocument } from "@/lib/stores/part-documents";
import { removeManufacturerImage, setManufacturerImage } from "@/lib/stores/manufacturers";
import { verifyUploadedBlob } from "@/lib/part-docs/verify-upload";
import { shrinkStoredImage } from "@/lib/part-docs/shrink-upload";
import { isDocumentId } from "@/lib/part-docs/types";
import { mfrKey } from "@/lib/catalog-books";

type Res = { ok: true } | { ok: false; error: string };

function refresh() {
  invalidatePortalIndex();
  revalidatePath("/catalog/manufacturers");
  revalidatePath("/portal/catalog");
}

/** The browser uploaded the file straight to Blob (putFile); check the bytes, shrink, record an UNLINKED image document, point the manufacturer at it. */
export async function setManufacturerImageAction(input: { name: string; documentId: string; blobPathname: string; fileName: string }): Promise<Res> {
  const user = await requirePerm("create");
  const name = String(input?.name ?? "").trim().slice(0, 200);
  if (!mfrKey(name)) return { ok: false, error: "Pick a manufacturer." };
  if (!isDocumentId(input?.documentId)) return { ok: false, error: "Not a document id." };
  const checked = await verifyUploadedBlob({ documentId: input.documentId, blobPathname: input.blobPathname, fileName: input.fileName, kind: "image" });
  if (!checked.ok) return checked;
  const shrunk = await shrinkStoredImage(input.documentId, checked.file);
  if (!shrunk.ok) return shrunk;
  const doc = await createDocument({ id: input.documentId, kind: "image", title: `${name} (manufacturer)`, ...shrunk.file, sourceUrl: null, source: "manufacturer", sourceRef: `mfr:${mfrKey(name)}`, by: user.name });
  if (!doc) return { ok: false, error: "That document already exists — try again." };
  await setManufacturerImage({ name, documentId: doc.id, by: user.name });
  refresh();
  return { ok: true };
}

export async function removeManufacturerImageAction(key: string): Promise<Res> {
  const user = await requirePerm("create");
  if (!mfrKey(key)) return { ok: false, error: "Pick a manufacturer." };
  await removeManufacturerImage(key, user.name);
  refresh();
  return { ok: true };
}
```

(Confirm `verifyUploadedBlob` / `shrinkStoredImage` / `createDocument` field names against `attachUploadedDocumentAction` in `catalog/documents/actions.ts` ~lines 124–165 and mirror it.)

- [ ] **Step 5: `page.tsx`** — server component, `export const maxDuration = 60;`, `await requireUser()`; load `listCatalog()`, `loadPartDocsState(parts)` → `buildImageIndex(state.documents, state.links)`, `listManufacturers()`; `rows = manufacturerRows(parts, (sku) => (images.get(sku) ?? []).some((r) => r.source !== "datasheet-render"), records)`; `canEdit = can("create", user.roles)`; render the header ("← Catalog", h1 "Manufacturers", one-line description: "One image per manufacturer. Customers see it on any of that manufacturer's parts that have no photo of their own."), a Blob-not-configured banner (copy the Upload many page's), and `<ManufacturersClient rows={rows} canEdit={canEdit} />`.

- [ ] **Step 6: `manufacturers-client.tsx`** (`"use client"`; imports only `@/lib/manufacturer-rows`, `@/lib/part-docs/types` (`newDocumentId`), `../documents/upload-client` (`preflight`, `putFile`), `./actions`). State: filter (`all|missing|has`), search, per-row busy/error, upload-many review list. Per row: thumbnail `<img src={"/api/part-documents/" + id}>` 48×48 contain, or "No image"; name + "+N spellings" (title tooltip lists them); "N parts · M without a photo"; when `canEdit`: a hidden file input (accept `image/png,image/jpeg,image/webp`) behind "Upload"/"Replace", and "Remove". Upload of one file:

```ts
async function uploadFor(name: string, file: File): Promise<string | null> {
  const refused = preflight(file, "image");
  if (refused) return refused;
  const documentId = newDocumentId();
  const put = await putFile(file, documentId);
  if (!put.ok) return put.error;
  const r = await setManufacturerImageAction({ name, documentId, blobPathname: put.pathname, fileName: file.name });
  return r.ok ? null : r.error;
}
```

Wrap every await in try/catch → row error "The server didn't answer — try again." Then `router.refresh()`. **Upload many:** a multiple file input + drop zone; build the review list `files.map(f => ({ file, key: matchManufacturerFile(f.name, rows) }))`; unmatched rows get a `<select>` of manufacturers (name); "Upload N images" runs `uploadFor(row.name, file)` one at a time with progress, then refresh. Filters: `missing` = `!imageDocumentId`, `has` = `!!imageDocumentId`; search matches name and spellings (case-insensitive). Sentence-case copy, no exclamation marks.

- [ ] **Step 7: Header link + smoke.** In `src/app/(app)/catalog/page.tsx`, add a "Manufacturers" `<Link href="/catalog/manufacturers">` styled exactly like the "Datasheets" link, right after it, visible to everyone. In `scripts/smoke-routes.ts` add `"/catalog/manufacturers", // Manufacturer section Part 1` after `"/catalog/departments"`.

- [ ] **Step 8: Gates + commit** (include `npm run build` — a client component next to server actions; check `df` first, delete the worktree's `.next` after):

```bash
npx tsc --noEmit && npx eslint src/lib/manufacturer-rows.ts "src/app/(app)/catalog/manufacturers" "src/app/(app)/catalog/page.tsx" "src/app/(app)/catalog/documents/upload-client.ts" scripts/smoke-routes.ts
npm run build 2>&1 | grep -E "catalog/manufacturers|rror" ; rm -rf .next
git add src/lib/manufacturer-rows.ts "src/app/(app)/catalog/manufacturers" "src/app/(app)/catalog/page.tsx" "src/app/(app)/catalog/documents/upload-client.ts" scripts/smoke-routes.ts scripts/test-review-and-spec.ts
git commit -m "feat(catalog): Catalog → Manufacturers page with image upload and upload many"
```

---

### Task 4: Portal fallbacks

**Files:** Modify `src/lib/portal-catalog-index.ts` (index field + servable ids), `src/lib/portal-catalog-view.ts` (`TileVM.fallback`), `src/lib/portal-part-view.ts` (`PartDetailPart.fallback`, `PartDetailFixture.fallback`), `src/lib/portal-catalog-browse.ts` (`tilesFor`), `src/lib/portal-part-detail.ts`, `src/app/portal/catalog/{panel-ui.tsx,catalog-client.tsx,part-sidebar.tsx}`; test: harness async block.

**Interfaces:**
- Consumes: `portalFallback`, `isCustomCategory`, `fallbackSrc`, `ImageFallback` (Task 1); `listManufacturers`, `manufacturerImageLookup` (Task 2).
- Produces: `PortalIndex.mfrImageDocs: Map<string, string>` (mfrKey → document id, only documents with a `blobKey` and a PNG/JPEG/WebP type); `portalMfrImage(ix: PortalIndex): (mfr: string) => string | null`; `TileVM.fallback: ImageFallback | null`; `PartDetailPart.fallback`, `PartDetailFixture.fallback: ImageFallback | null`; `panel-ui.tsx` `FallbackImg({ fallback, previewCid, size? })`.

- [ ] **Step 1: Index.** In `buildIndex()` add `listManufacturers()` to the first `Promise.all`. After `state` is loaded:

```ts
const mfrImageDocs = new Map<string, string>();
for (const m of manufacturerRows) {
  const d = m.imageDocumentId ? state.index.docsById.get(m.imageDocumentId) : undefined;
  if (d && d.kind === "image" && d.blobKey && ["image/png", "image/jpeg", "image/webp"].includes(d.contentType)) mfrImageDocs.set(m.key, d.id);
}
```

Add every `mfrImageDocs` value to `servableDocIds` right after `servableDocIdsFrom(...)` is computed, and put `mfrImageDocs` on the returned `PortalIndex` (add the field with a doc comment: "Manufacturer section Part 1 — mfrKey → that manufacturer's image document (unlinked; servable); used only as a fallback for parts with no photo of their own"). Export:

```ts
export function portalMfrImage(ix: Pick<PortalIndex, "mfrImageDocs">): (mfr: string) => string | null {
  return (mfr) => ix.mfrImageDocs.get(mfrKey(mfr)) ?? null;
}
```

Confirm `state.index.docsById` holds unlinked documents (it is built from `allDocuments()` — check `buildCoverageIndex`); if not, read the manufacturer image documents with `getDocuments(ids)` instead.

- [ ] **Step 2: VMs.** `TileVM` gets `fallback: ImageFallback | null`. `toTileVM` gains a 5th optional param `fallback: ImageFallback | null = null` and sets `fallback: imageId ? null : fallback` (where `imageId` is the computed `media?.imageIds?.[0] ?? null`). `PartDetailPart`/`PartDetailFixture` get `fallback: ImageFallback | null`; `toPartDetailVM` and `toFixtureDetailVM` take a trailing `fallback: ImageFallback | null = null` and set `fallback: images.length ? null : fallback`.

- [ ] **Step 3: Callers.** In `tilesFor` (`portal-catalog-browse.ts`):

```ts
const look = portalMfrImage(ix);
// fixture:
const fb = portalFallback({ mfr: engine?.mfr, custom: isCustomCategory(engine?.category), por: !price || price.por }, look);
return toTileVM(e, engine, price, fx, fb);
// part:
const part = ix.parts.get(e.sku);
const pr = await priceSku(e.sku, ctx);
return toTileVM(e, part, pr, undefined, portalFallback({ mfr: part?.mfr ?? e.mfr, custom: isCustomCategory(part?.category ?? e.category), por: !pr || pr.por }, look));
```

In `partDetailFor` pass `portalFallback({ mfr: part.mfr, custom: isCustomCategory(part.category), por: !price || price.por }, portalMfrImage(ix))` to `toPartDetailVM`, and for a fixture `portalFallback({ mfr: engine?.mfr, custom: isCustomCategory(engine?.category), por: !fixturePrice || fixturePrice.por }, portalMfrImage(ix))` to `toFixtureDetailVM` (hold the awaited `priceFixture` result in a variable). Check the real shape of `priceSku`'s return (`{ unitPrice, por }` or null) and adapt `por`.

- [ ] **Step 4: Rendering.** In `panel-ui.tsx`:

```tsx
export function FallbackImg({ fallback, previewCid, className }: { fallback: ImageFallback; previewCid: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={fallbackSrc(fallback, (id) => docSrc(id, previewCid))} alt="" loading="lazy" decoding="async" />;
}
```

(import `fallbackSrc`, `ImageFallback` from `@/lib/part-image-fallback`; `panel-ui.tsx` must stay client-safe). Replace:
- `catalog-client.tsx` `Tile`: when `!showImage`, render `t.fallback ? <FallbackImg fallback={t.fallback} previewCid={previewCid} /> : <PlaceholderArt />` (drop the `DatasheetArt` branch; keep `PlaceholderArt` only as the null-fallback guard). Keep the `pc-media` box; when a fallback renders, don't add `pc-media-empty`.
- Department tiles: `t.imageId ? <img …/> : <FallbackImg fallback={{ kind: "placeholder", name: "coming-soon" }} previewCid={previewCid} />`.
- `part-sidebar.tsx` `Gallery`: give it a `fallback` prop; when `!cur`, render `<div className="ps-gallery-main">{fallback ? <FallbackImg … /> : <PlaceholderArt size={56} datasheet={hasDocs} />}</div>`; pass `detail.fallback` from both the part and fixture sidebars. "Goes with" rows: `t.imageId && !broken ? <img…/> : t.fallback ? <FallbackImg …/> : <PlaceholderArt size={24} … />`.
Ensure fallback images fit their boxes (they already style child `img` with object-fit; check `PANEL_CSS` / the tile CSS and add `object-fit: contain` for the fallback if needed).

- [ ] **Step 5: Tests** — append, chain `.then(() => mfrPortalAsyncChecks())`:

```ts
/* ======================================================================
   Manufacturer images — portal fallbacks (PGlite).
   ====================================================================== */
import { portalIndex as mfpIndex, invalidatePortalIndex as mfpInvalidate, portalMfrImage as mfpLook } from "@/lib/portal-catalog-index";
import { toTileVM as mfpTile } from "@/lib/portal-catalog-view";
import { setManufacturerImage as mfpSetImg } from "@/lib/stores/manufacturers";
import { createDocument as mfpCreateDoc } from "@/lib/stores/part-documents";
async function mfrPortalAsyncChecks(): Promise<void> {
  const SKU = fixtureId("MFP", "PART-1");
  await upsertPart({ id: SKU, sku: SKU, desc: "mfr portal part", category: "Lighting", unit: "ea", list: 10, cost: 5, mfr: "MfpBrand", portalVisibility: "show" } as never);
  registerFixture("catalog_parts", SKU);
  mfpInvalidate();
  const before = await mfpIndex({ fresh: true });
  const doc = await mfpCreateDoc({ kind: "image", title: "MfpBrand (manufacturer)", fileName: "m.webp", contentType: "image/webp", size: 10, blobKey: "part-docs/x/m.webp", sourceUrl: null, source: "manufacturer", sourceRef: "mfr:mfpbrand", by: "mfr test" });
  if (doc) registerFixture("part_documents", doc.id);
  const m = await mfpSetImg({ name: "MfpBrand", documentId: doc!.id, by: "mfr test" });
  registerFixture("manufacturers", m.id);
  mfpInvalidate();
  const ix = await mfpIndex({ fresh: true });
  ok(ix.mfrImageDocs.get("mfpbrand") === doc!.id && ix.servableDocIds.has(doc!.id), "mfr images: the portal index knows the manufacturer image and may serve it");
  ok(mfpLook(ix)("MFP-BRAND") === doc!.id, "mfr images: portalMfrImage matches by key");
  const bp = before.parts.get(SKU), ap = ix.parts.get(SKU);
  ok(!!bp && !!ap && bp.imageIds.length === 0 && ap.imageIds.length === 0 && bp.visibility === ap.visibility, "mfr images: a manufacturer image never becomes a part image or changes visibility");
  const tile = mfpTile({ key: SKU, kind: "part", title: "t", sku: SKU, mfr: "MfpBrand", category: "Lighting" } as never, ap, { unitPrice: 12, por: false }, undefined, { kind: "image", documentId: doc!.id, label: "MfpBrand" });
  ok(tile.imageId === null && tile.fallback?.kind === "image", "mfr images: a tile without a photo carries the fallback");
  const withPhoto = mfpTile({ key: SKU, kind: "part", title: "t", sku: SKU, mfr: "MfpBrand", category: "Lighting" } as never, { imageIds: ["PD-own"] }, { unitPrice: 12, por: false }, undefined, { kind: "placeholder", name: "coming-soon" });
  ok(withPhoto.fallback === null, "mfr images: a tile with its own photo has no fallback");
}
```

(Adapt `upsertPart` fields / `portalVisibility` to what `normalizeVisibility` accepts; if the fixture part isn't quotable in the test catalog, assert only on `ix.mfrImageDocs`/`servableDocIds` and the pure `toTileVM` checks.)

- [ ] **Step 6: Gates + commit** (tsc, specs, eslint on touched files, `npm run build`, delete `.next`):

```bash
git commit -m "feat(portal): manufacturer images and placeholders where a part has no photo"
```

---

### Task 5: Documents — key products and the narrative hint

**Files:** Modify `src/app/(app)/estimator/narrative.ts`, `src/app/(app)/estimator/quote-document.tsx`, `src/app/(app)/estimator/narrative-column.tsx`, `src/lib/narrative/photos.ts`, `src/lib/narrative/library.ts`, `src/lib/narrative/merge.ts`; test: harness (pure + async).

**Interfaces:**
- `narrative.ts`: module-private `skuOf(it)` now returns `"line:" + it.id` for `it.allowance || it.custom`; `PrintableKeyProduct` gains `placeholder?: "allowance" | "custom-device"`; exported `isLineToken(sku: string): boolean`.
- `KeyProductLibraryRow` gains `fallbackDocId: string | null; fallbackLabel: string | null` (manufacturer image).
- `keyProductPhotoDocs(sections)` returns, for a catalog sku with no own image, its manufacturer's image document.

- [ ] **Step 1: Failing tests** — append (pure block + async block, chain `.then(() => mfrDocsAsyncChecks())`):

```ts
/* ======================================================================
   Manufacturer images — key products for allowance/custom lines (pure).
   ====================================================================== */
import { isKeyProductEligible as mfdElig, keyProductStar as mfdStar, toggleKeyProduct as mfdToggle, printableKeyProducts as mfdPrintable, remapKeyProducts as mfdRemap, photoSkusOf as mfdPhotoSkus, isLineToken as mfdIsLine, sanitizeKeyProducts as mfdSanitize } from "@/app/(app)/estimator/narrative";
{
  const sec = { id: 1, name: "Sys", presentation: "narrative", items: [
    { id: 11, sku: "", desc: "Lighting allowance", qty: 1, allowance: true },
    { id: 12, sku: "CUSTOM", desc: "Custom truss", qty: 1, custom: true },
    { id: 13, sku: "CUSTOM", desc: "Custom bracket", qty: 1, custom: true },
  ], keyProducts: [] } as never;
  ok(mfdElig((sec as { items: never[] }).items[0]) && mfdElig((sec as { items: never[] }).items[1]), "mfr images: allowance and custom lines can be key products");
  let s = mfdToggle(sec, 11, ""); s = mfdToggle(s, 12, ""); s = mfdToggle(s, 13, "");
  const kps = (s as { keyProducts: { sku: string; lineKey: string }[] }).keyProducts;
  ok(kps.map((k) => k.sku).join() === "line:11,line:12,line:13", "mfr images: their blocks anchor on line tokens, so two CUSTOM lines can both be featured");
  ok(mfdSanitize(kps).length === 3 && mfdIsLine("line:11") && !mfdIsLine("S4-19"), "mfr images: line tokens survive sanitize");
  const pr = mfdPrintable(s);
  ok(pr.map((p) => p.placeholder).join() === "allowance,custom-device,custom-device", "mfr images: printable blocks carry their placeholder");
  ok(mfdStar(s, (s as { items: never[] }).items[0]) === "on", "mfr images: the star reads on for a featured allowance line");
  ok(mfdPhotoSkus([s]).every((k) => !mfdIsLine(k)), "mfr images: line tokens never trigger a catalog photo read");
  const re = mfdRemap(kps as never, new Map([[11, 21], [12, 22], [13, 23]]));
  ok(re?.map((k) => `${k.lineKey}:${k.sku}`).join() === "21:line:21,22:line:22,23:line:23", "mfr images: a remap rewrites the line token with the new id");
}
```

```ts
/* ======================================================================
   Manufacturer images — documents fall back to the manufacturer image (PGlite).
   ====================================================================== */
import { keyProductPhotoDocs as mfdPhotoDocs } from "@/lib/narrative/photos";
import { keyProductLibrary as mfdLibrary } from "@/lib/narrative/library";
import { setManufacturerImage as mfdSetImg } from "@/lib/stores/manufacturers";
import { createDocument as mfdCreateDoc } from "@/lib/stores/part-documents";
async function mfrDocsAsyncChecks(): Promise<void> {
  const SKU = fixtureId("MFD", "PART-1");
  await upsertPart({ id: SKU, sku: SKU, desc: "mfr doc part", category: "Lighting", unit: "ea", list: 10, cost: 5, mfr: "MfdBrand" });
  registerFixture("catalog_parts", SKU);
  const doc = await mfdCreateDoc({ kind: "image", title: "MfdBrand (manufacturer)", fileName: "m.webp", contentType: "image/webp", size: 10, blobKey: "part-docs/y/m.webp", sourceUrl: null, source: "manufacturer", sourceRef: "mfr:mfdbrand", by: "mfr test" });
  if (doc) registerFixture("part_documents", doc.id);
  const m = await mfdSetImg({ name: "MfdBrand", documentId: doc!.id, by: "mfr test" });
  registerFixture("manufacturers", m.id);
  const sec = { id: 1, name: "S", presentation: "narrative", items: [{ id: 5, sku: SKU, desc: "d", qty: 1, unitPrice: 100, cost: 50 }], keyProducts: [{ lineKey: "5", sku: SKU, text: "Para", photo: true }] } as never;
  const docs = await mfdPhotoDocs([sec]);
  ok(docs.get(SKU)?.id === doc!.id, "mfr images: a key product with no photo resolves its manufacturer image document");
  const lib = await mfdLibrary([SKU]);
  ok(lib[SKU]?.photoDocId === null && lib[SKU]?.fallbackDocId === doc!.id && lib[SKU]?.fallbackLabel === "MfdBrand", "mfr images: the narrative column learns what will print instead");
}
```

(If a key product only prints for a section whose total is non-zero — `systemPrintsInBody` — give the item a price as above; adapt fields to `SpecItem`.)

- [ ] **Step 2: `narrative.ts`.**
  - Replace `skuOf`:

```ts
/** A key product's anchor sku: the line's real sku, or `line:<id>` for an
 *  allowance or custom line (no catalog sku — Manufacturer section Part 1). */
const skuOf = (it: Pick<SpecItem, "sku" | "id" | "allowance" | "custom"> | null | undefined): string => {
  if (!it) return "";
  if (it.allowance || it.custom) return `line:${it.id}`;
  const s = typeof it.sku === "string" ? it.sku.trim() : "";
  return s.length > MAX_SKU ? "" : s;
};
export const isLineToken = (sku: string): boolean => /^line:\d+$/.test(String(sku || ""));
```

  - `PrintableKeyProduct` add `placeholder?: "allowance" | "custom-device"`; in `printableKeyProducts` add `...(r.item.allowance ? { placeholder: "allowance" as const } : r.item.custom ? { placeholder: "custom-device" as const } : {})`.
  - `photoSkusOf`: skip `isLineToken(p.sku)`.
  - `remapKeyProducts`: when `isLineToken(kp.sku)`, push `{ ...kp, lineKey: String(next), sku: "line:" + next }`.
  - Leave `isKeyProductEligible`'s body as is (it calls `skuOf`, which is now non-empty for these lines).
- [ ] **Step 3: `merge.ts`** — skip a source block whose sku `isLineToken` (no line in another system can match it); count it nowhere.
- [ ] **Step 4: `photos.ts` `keyProductPhotoDocs`** — after the own-image loop, for each requested sku that is a live catalog part with no own image, look up its manufacturer image:

```ts
const missing = skus.filter((s) => live.has(s) && !out.has(s));
if (missing.length) {
  const look = manufacturerImageLookup(await listManufacturers());
  const want = new Map<string, string>();
  for (const p of parts) if (missing.includes(p.sku)) { const id = look(p.mfr || ""); if (id) want.set(p.sku, id); }
  if (want.size) {
    const byId = new Map((await getDocuments([...new Set(want.values())])).map((d) => [d.id, d]));
    for (const [sku, id] of want) { const d = byId.get(id); if (d && d.kind === "image") out.set(sku, d); }
  }
}
```

Update the header comment (manufacturer fallback). The online photo routes serve whatever `keyProductPhotoDocs` returns for the latest sent revision, so they serve the manufacturer image with no further change; confirm by reading `src/lib/quote-share/photo-response.ts`.
- [ ] **Step 5: `quote-document.tsx`** — in the key-product render: `const photo = kp.photo ? p.keyProductPhotos?.[kp.sku] : undefined; const ph = !photo && kp.photo && kp.placeholder ? { src: PLACEHOLDER_SRC[kp.placeholder], alt: "" } : undefined;` and render `photo ?? ph` with the existing `<img>` styling. Import `PLACEHOLDER_SRC` from `@/lib/part-image-fallback`. A quote with no `line:` blocks and no manufacturer fallbacks must print byte-for-byte as before — run the #293 baseline check already in the harness (it must stay PASS).
- [ ] **Step 6: `library.ts`** — after computing rows, for parts with no own image: `fallbackDocId = look(p.mfr)`, `fallbackLabel = p.mfr`; else both null (add the two fields to `KeyProductLibraryRow` in `narrative.ts`). Skip `line:` tokens in the wanted list (return no row for them).
- [ ] **Step 7: `narrative-column.tsx`** — replace the hint branch:

```tsx
) : r.item?.allowance ? (
  <div style={HINT}>Prints the Allowance placeholder</div>
) : r.item?.custom ? (
  <div style={HINT}>Prints the Custom Device placeholder</div>
) : row?.fallbackDocId ? (
  <div style={HINT}>{`Prints the manufacturer image (${row.fallbackLabel})`}</div>
) : row ? (
  <div style={HINT}>No photo — prints full width</div>
) : null}
```

(use whatever variable holds the resolution in that component; the allowance/custom hints should also show the Photo checkbox so the placeholder can be turned off — mirror the photo branch's checkbox.) Hide "Save to library" for `line:` blocks.
- [ ] **Step 8: Gates + commit** (tsc, specs incl. the #293 baseline, eslint on touched files, `npm run build`):

```bash
git commit -m "feat(estimator): allowance/custom key products with placeholders; manufacturer image fallback in documents"
```

---

### Task 6: Cut sheets

**Files:** Modify `src/lib/curtain-cut-sheets/load.ts` (`cutSheetPhotos`); test: harness async.

- [ ] **Step 1:** In `cutSheetPhotos`, after `images` is loaded: for skus with no `images.get(sku)?.[0]`, load their parts (`getMany`) and `manufacturerImageLookup(await listManufacturers())`, then `getDocuments` for those ids; in the per-sku loop use `const doc = images.get(sku)?.[0] ?? mfrDocs.get(sku)`. URL mode (`/api/part-documents/<id>`) and data mode (`dataUrlOf(doc)`) work unchanged for a manufacturer image document. Keep the 6-photo cap and the dedupe by `src`.
- [ ] **Step 2: Test** — a DB check: a fabric fixture part with mfr "MfcBrand" and no image + a manufacturer image document → the loader's photos for that sheet include `/api/part-documents/<mfr doc id>`. If constructing a full cut-sheet quote is heavy, extract the sku→doc resolution into an exported helper `cutSheetPhotoDocs(skus): Promise<Map<string, PartDocument>>` and test that instead.
- [ ] **Step 3: Gates + commit** — `git commit -m "feat(cutsheets): fall back to the manufacturer image"`.

---

### Task 7: Docs, full gates, browser check

- [ ] **Step 1:** Recompute numbers from `origin/main` (`git fetch`; next free `## N.` in PUNCHLIST.md, next `## D…` in DECISIONS.md, next migration). Write:
  - `DECISIONS.md`: (a) the two fallback chains and why documents stop after the manufacturer image; (b) manufacturer images as unlinked `part_documents` (source `manufacturer`) and why nothing counts them as part photos; (c) `manufacturers` keyed by `mfrKey`, lazy, one per key, history kept, Part 2 merges aliases; (d) allowance/custom key products anchored by `line:<id>` tokens.
  - `PUNCHLIST.md`: `## <N>. Catalog — manufacturer images + placeholders (Manufacturer section, Part 1) — DONE <date> (D…)` in the style of `## 294.`, with Reported (Jeff 2026-10-02), what shipped, real Gates numbers, **For Jeff** (upload manufacturer images on Catalog → Manufacturers; Upload many matches file names exactly), **Rollback** (pre-change code: an unknown `PartDocumentSource` rank → NaN → falls through to upload time, as #294 documented; unlinked manufacturer docs are invisible to it; `line:` key-product blocks resolve as "changed"/unprinted on old code — say exactly what happens after checking).
  - `AGENTS.md`: the next phase item in the style of 34.
- [ ] **Step 2: Full gates:** tsc 0; eslint 0 on every touched source file; `npm run test:specs` ALL PASSED with the real count; `npm run test:smoke` (no dev server running) ALL PASSED incl. `/catalog/manufacturers`; `npm run build` OK.
- [ ] **Step 3: Commit:** `docs: manufacturer images + placeholders (#N)`.
- [ ] **Browser check (controller):** scratch datadir dev server (see memory `peak-preview-start-reads-main-checkout-launch-json` and `peak-dev-server-always-loads-real-blob-token` — **do not upload**: the dev server loads the real Blob token). Verify the Manufacturers page lists rows with counts and filters, and that a portal catalog tile for a part with no photo shows the Image Coming Soon / Contact Us placeholder.
