# Documents (#218) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Company / venue / project documents stored in private Vercel Blob. The team uploads, edits, shares and deletes them. Customers download what is shared and upload their own files through the portal. Customer uploads show up as "New" on the company page and in the to-do bell.

**Architecture:** Three pure modules hold every rule: `src/lib/document-files.ts` (blocked names and bytes, safe names, blob paths, download headers), `src/lib/document-categories.ts` (the editable category list) and `src/lib/document-rules.ts` (the record type, filters, portal access rule, scope resolution, view models). One new doc table `documents` has a store at `src/lib/stores/documents.ts`. The upload flow works like #207. The browser mints a random upload key and asks a token route for a grant on `documents/<customer>/<key>/<file>`. It uploads straight to Blob. It then calls a finalize action. That action goes through one server function, `finalizeDocumentUpload` (`src/lib/documents-upload.ts`), which re-derives the company, checks the path, reads the blob head, re-checks size and magic bytes and only then writes the record. Downloads go through two proxy routes, one for the team and one for the portal. Both always send `attachment` + `octet-stream` + `nosniff` + `no-store`.

**Tech Stack:** Next.js 16 App Router (server components, server actions, route handlers), TypeScript, Drizzle doc-store on Postgres (Neon) / PGlite in dev and tests, `@vercel/blob` 2.6 (`@vercel/blob/client` `upload` + `handleUpload`), the `scripts/test-review-and-spec.ts` harness run by `npm run test:specs`.

**Spec:** `docs/superpowers/specs/2026-09-26-documents-design.md`. Read it first. Also read `AGENTS.md`. Next.js 16 differs from your training data, so check `node_modules/next/dist/docs/` before writing a route handler. The route shape used here, `ctx: { params: Promise<{ id: string }> }`, is copied from `src/app/api/part-documents/[id]/route.ts`.

## Global Constraints

- Work only in `/Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks` (branch `feat/punch-inbox-tasks`). Prefix every shell command with `export PATH=$HOME/.local/node/bin:$PATH &&`.
- **Never run the dev server or any db script.** `npm run test:specs` is allowed because it always runs on a fresh `mktemp -d` PGlite datadir. Before running it, check that `ps aux | grep -E "tsx|next dev" | grep -v grep` is empty. Run every DB-touching command with `env -u DATABASE_URL`. Never use bare `git stash`, because the stash is shared across worktrees. Commit instead.
- **Security first (the spec's priority):**
  - Every route and action re-derives the company on the server. A team action takes the company from the stored document (edit, delete) or checks it exists (upload).
  - A portal route or action takes `customerId` **only** from `portalSession()`, never from the request body, payload or URL.
  - A client-supplied blob path is untrusted. It must sit directly under `documents/<customer segment>/<upload key>/` (`blobPathInScope`), and a path already recorded on a document is refused before anything can delete it.
  - A refused upload's blob is deleted only once it is proven to be the caller's own, unrecorded upload.
  - The portal download returns 404 for every refusal, so it never says whether a document exists.
- **Client/server boundary:** a `"use client"` file imports only pure modules (`@/lib/document-files`, `@/lib/document-categories`, `@/lib/document-rules` type-only or pure values, `@/lib/format`), `@/components/confirm-button`, `@vercel/blob/client`, and server **actions**. It never imports a value from `@/lib/stores/*`, `@/db/*`, `@/lib/blob`, `@/lib/portal` or `@/lib/identity/*`. Only `next build` catches a violation. That is why every task that touches a client file or a route runs it.
- **Files:** any type up to **100 MB**. Programs and scripts are blocked by extension (every dot-separated segment) and by magic bytes. Files are always downloaded as a file, never shown in the browser.
- **Ids:** documents are `DOC-` + a sequence starting at `DOC-1000` (`insertWithPrefixedId("documents", "DOC", 999, …)`). Upload keys are `UP-` + 16 lowercase hex, minted in the browser.
- **Timestamps** are epoch-ms numbers. **Design tokens:** `pk-*` classes, and accent only via `var(--accent)`.
- **Spec-harness assertions** are tagged `#218` and appended at the END of `scripts/test-review-and-spec.ts`. Each task adds a hoisted `import` block plus a `{ … }` block, and DB-backed checks go in an `async function …AsyncChecks()` chained just before the suite's `.finally(() => teardownFixtures())`. Import aliases carry a `d218` prefix so they can't collide. Every document a test creates is registered with `registerFixture("documents", id)`.
- **Gates** in each task's last step, with real numbers reported:
  - `npx tsc --noEmit -p .` must exit 0.
  - `env -u DATABASE_URL npm run test:specs` must end with `ALL PASSED` and have 0 `FAIL`. Report the total PASS count and the `#218` PASS count. A known flake, `redeem: tampered code -> not ok`, fails about one run in sixty. If it is the only FAIL, re-run.
  - `npx eslint <changed files>` must report 0 errors.
  - Tasks 3–5 also run `env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build`, which must succeed, then `rm -rf .next`.
- **Commits:** `feat(documents): … (#218)`, then a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only the task's files (never `git add -A`). If `git` reports `index.lock`, wait two seconds and retry. No DECISIONS.md / PUNCHLIST.md edits.

## Decisions this plan takes where the spec is open

1. **The "pending record id" in the upload path is a browser-minted upload key**, not the `DOC-` id. A `DOC-` sequence can only be minted server-side at insert time, after the bytes are checked. The path is `documents/<customerSegment>/<UP-key>/<safeFileName>`, and Blob appends its random suffix. Both token routes refuse a path whose customer segment or upload key doesn't match. Finalize refuses a path that is already recorded on a document.
2. **The portal token route lives at `/portal/documents/upload`** (spec: `api/portal/documents/upload`), and the portal download route at `/portal/documents/[id]`. Both sit inside the existing `/portal` middleware exemption, so `src/middleware.ts` is not touched. An `/api/portal/*` path would sit behind the team login and redirect every customer.
3. **Seen:** team uploads are born seen (`seenByTeamAt = uploadedAt`). A customer upload is marked seen when any team member downloads it through `/api/documents/[id]`, or when someone presses **Mark seen** on the Documents card, which acknowledges that company's new uploads. Just opening the company page does not mark anything seen, so the bell item can't vanish before anyone has looked.
4. **Categories** live in the app settings row as `documentCategories` (the `customerFieldDefs` idiom). The list is replaced whole on save. `resolveDocumentCategories` returns the seed when the list is absent.
   - Keys are minted server-side from the label and never change.
   - A row dropped from the editor is kept as archived.
   - `other` can't be archived, and any unknown key reads as Other.
   - New uploads can only pick an active category.
5. **Portal team preview** (`/portal?preview=<id>`) lists the documents with team download links (`/api/documents/<id>`) and disables upload.
6. **Deleting a document** first soft-deletes the record, then deletes the blob on a best-effort basis. A failed blob delete leaves only an orphaned private blob.
7. **Edits** go through the same scope rule as uploads. If a project is set and the venue is blank, the venue defaults to the project's venue. A venue or project of another company is refused. The company and the file can never change.

## File Structure

**Created**

| File | Responsibility |
|------|----------------|
| `src/lib/document-files.ts` | Pure. Size cap, blocked extensions/magic bytes, safe names, upload keys, blob paths + scope check, payload parsing, download headers, `formatBytes`. |
| `src/lib/document-categories.ts` | Pure. Category type, seed, resolve/merge, label/normalize helpers. |
| `src/lib/document-rules.ts` | Pure. `DocumentRecord`, filters, `portalCanSee`, `resolveDocumentScope`, row VM, portal grouping, bell rollup. |
| `drizzle/<NNNN>_documents.sql`, `drizzle/meta/<NNNN>_snapshot.json` | The `documents` table, idempotent (NNNN = next free number after 0027). |
| `src/lib/stores/documents.ts` | Server. CRUD, scoping queries, `markSeen`, categories read. |
| `src/app/(app)/settings/document-categories-card.tsx` | Client. Settings → Admin → Document categories. |
| `src/lib/documents-upload.ts` | Server. `finalizeDocumentUpload` (shared by team + portal) and `documentScopeFacts`. |
| `src/app/api/documents/upload/route.ts` | Team Blob client-upload token broker. |
| `src/app/api/documents/[id]/route.ts` | Team download proxy. |
| `src/app/(app)/documents/actions.ts` | Team server actions (finalize, edit, delete, mark seen). No page, only actions. |
| `src/components/documents/upload-client.ts` | Browser half of an upload (shared by team + portal). |
| `src/components/documents/documents-card.tsx` | Server. Loads one scope's documents and renders the client card. |
| `src/components/documents/documents-card-client.tsx` | Client. List, filters, multi-file upload, edit dialog, delete, download. |
| `src/app/portal/documents/upload/route.ts` | Portal Blob client-upload token broker. |
| `src/app/portal/documents/[id]/route.ts` | Portal download proxy. |
| `src/app/portal/documents-actions.ts` | Portal finalize action. |
| `src/app/portal/documents-section.tsx` | Server. The portal Documents card. |
| `src/app/portal/document-upload.tsx` | Client. The portal upload control. |

**Modified**

| File | Change |
|------|--------|
| `src/db/doc-tables.ts`, `drizzle/meta/_journal.json` | Register `documents`; journal entry. |
| `src/lib/settings.ts` | `AppSettingsData.documentCategories`. |
| `src/app/(app)/settings/actions.ts`, `page.tsx`, `settings-client.tsx` | Save action + card on Settings → Admin. |
| `src/app/(app)/companies/[id]/page.tsx` | Documents card. |
| `src/app/(app)/venues/[id]/page.tsx` | Documents card scoped to the venue. |
| `src/app/(app)/projects/view.tsx` | Documents tab. |
| `src/lib/stores/notif-prefs.ts`, `src/lib/nav-counts.ts` | "New documents from customers" bell group. |
| `src/app/portal/page.tsx` | Documents section. |
| `scripts/test-review-and-spec.ts` | `#218` checks. |

---

### Task 1: Pure modules — file rules, categories, access rules

**Files:**
- Create: `src/lib/document-files.ts`
- Create: `src/lib/document-categories.ts`
- Create: `src/lib/document-rules.ts`
- Test: `scripts/test-review-and-spec.ts` (append the Task 1 block)

**Interfaces:**
- Consumes: nothing.
- Produces (all pure, client-safe):
  ```ts
  // document-files.ts
  export const MAX_DOCUMENT_BYTES: number;               // 100 MB
  export const MAX_DOCUMENT_LABEL: "100 MB";
  export const DOCUMENT_SNIFF_BYTES: number;             // 16
  export const DOCUMENT_BLOB_PREFIX: "documents/";
  export const BLOCKED_EXTENSIONS: ReadonlySet<string>;
  export function baseName(raw: unknown): string;
  export function displayFileName(raw: unknown): string;
  export function safeFileName(raw: unknown): string;
  export function titleFromFileName(raw: unknown): string;
  export function blockedExtension(name: unknown): string | null;
  export function checkDocumentName(name: string, size: number): string | null;
  export function checkDocumentBytes(bytes: Uint8Array): string | null;
  export function newUploadKey(): string;
  export function isUploadKey(v: unknown): v is string;
  export function customerPathSegment(customerId: string): string;
  export function documentUploadPrefix(customerId: string, uploadKey: string): string;
  export function documentBlobPath(customerId: string, uploadKey: string, fileName: string): string;
  export function blobPathInScope(pathname: unknown, customerId: string, uploadKey: string): pathname is string;
  export function uploadGrantError(pathname: string, customerId: string, uploadKey: string): string | null;
  export function parseUploadPayload(payload: string | null): { customerId: string; uploadKey: string } | null;
  export function parseUploadKey(payload: string | null): string | null;
  export function attachmentDisposition(fileName: string): string;
  export function documentDownloadHeaders(fileName: string): Record<string, string>;
  export function formatBytes(n: number): string;
  // document-categories.ts
  export type DocumentCategory = { key: string; label: string; order: number; archived?: boolean };
  export type DocumentCategoryInput = { key?: string; label: string; archived?: boolean };
  export const OTHER_CATEGORY: "other";
  export const MAX_DOCUMENT_CATEGORIES: 40;
  export const SEED_DOCUMENT_CATEGORIES: readonly DocumentCategory[];
  export function resolveDocumentCategories(stored: unknown): DocumentCategory[];
  export function activeDocumentCategories(cats: readonly DocumentCategory[]): DocumentCategory[];
  export function categoryLabel(cats: readonly DocumentCategory[], key: string): string;
  export function normalizeCategory(cats: readonly DocumentCategory[], key: unknown): string;
  export function uploadCategory(cats: readonly DocumentCategory[], key: unknown): string;
  export function slugCategoryKey(label: string, taken: ReadonlySet<string>): string;
  export function mergeDocumentCategories(stored: readonly DocumentCategory[], input: unknown):
    { ok: true; categories: DocumentCategory[] } | { ok: false; error: string };
  // document-rules.ts
  export type DocumentVisibility = "internal" | "shared";
  export type DocumentSource = "team" | "customer";
  export type DocumentRecord = { id; title; fileName; mime; size; blobPath; category; visibility; source;
    customerId; siteId: string | null; projectId: string | null; notes; uploadedBy; uploadedAt;
    seenByTeamAt: number | null; deleted?: true };
  export const MAX_TITLE: 200; export const MAX_NOTES: 2000;
  export function isVisibility(v: unknown): v is DocumentVisibility;
  export function cleanTitle(raw: unknown, fileName: string): string;
  export function cleanNotes(raw: unknown): string;
  export function cleanMime(raw: unknown): string;
  export type DocumentFilter = { customerId?: string; siteId?: string | null; projectId?: string | null;
    visibility?: DocumentVisibility; category?: string; portal?: boolean };
  export function filterDocuments(docs: readonly DocumentRecord[], f?: DocumentFilter): DocumentRecord[];
  export function portalCanSee(doc: DocumentRecord | null | undefined, customerId: string | null | undefined): boolean;
  export type DocumentScopeFacts = { customerExists: boolean; siteIds: readonly string[];
    project: { id: string; customerId: string | null; locationId: string | null } | null };
  export function resolveDocumentScope(input: { siteId?: string | null; projectId?: string | null }, customerId: string,
    facts: DocumentScopeFacts): { ok: true; siteId: string | null; projectId: string | null } | { ok: false; error: string };
  export type DocumentOption = { id: string; label: string };
  export type DocumentRowVM = { id; title; fileName; size; sizeLabel; category; categoryLabel; siteId; siteLabel;
    projectId; projectLabel; visibility; source; isNew: boolean; uploadedBy; uploadedAt; notes };
  export function documentRows(docs, ctx: { categories; venues: readonly DocumentOption[]; projects: readonly DocumentOption[] }): DocumentRowVM[];
  export type PortalDocGroup = { venueId: string | null; venueLabel: string;
    categories: Array<{ key: string; label: string; docs: DocumentRecord[] }> };
  export function groupForPortal(docs, customerId: string, categories, venues: readonly DocumentOption[]): PortalDocGroup[];
  export function customerUploadBell(docs: readonly DocumentRecord[]): Array<{ customerId: string; count: number; latestAt: number }>;
  ```

- [ ] **Step 1: Write the failing test**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts

/* ======================================================================
   Documents (#218) — Task 1: file rules, categories, access rules. Pure.
   ====================================================================== */
import {
  MAX_DOCUMENT_BYTES as d218Max, blockedExtension as d218BlockedExt, checkDocumentBytes as d218CheckBytes,
  checkDocumentName as d218CheckName, safeFileName as d218Safe, displayFileName as d218Display,
  titleFromFileName as d218Title, attachmentDisposition as d218Disp, documentDownloadHeaders as d218Headers,
  newUploadKey as d218NewKey, isUploadKey as d218IsKey, documentBlobPath as d218Path, blobPathInScope as d218InScope,
  parseUploadPayload as d218Payload, parseUploadKey as d218PayloadKey, uploadGrantError as d218GrantErr,
  formatBytes as d218Bytes,
} from "@/lib/document-files";
import {
  SEED_DOCUMENT_CATEGORIES as d218Seed, resolveDocumentCategories as d218Resolve, mergeDocumentCategories as d218Merge,
  normalizeCategory as d218Norm, uploadCategory as d218UploadCat, activeDocumentCategories as d218Active,
  categoryLabel as d218CatLabel,
} from "@/lib/document-categories";
import {
  filterDocuments as d218Filter, portalCanSee as d218PortalSee, resolveDocumentScope as d218Scope,
  documentRows as d218Rows, groupForPortal as d218Group, customerUploadBell as d218Bell, cleanMime as d218Mime,
  type DocumentRecord as D218Doc,
} from "@/lib/document-rules";

{
  const b = (...xs: number[]) => new Uint8Array(xs);
  ok(d218Max === 100 * 1024 * 1024, "#218 files: the cap is 100 MB");
  ok(d218BlockedExt("setup.exe") === "exe" && d218BlockedExt("SETUP.EXE") === "exe", "#218 files: .exe is blocked in any case");
  ok(d218BlockedExt("plan.pdf.exe") === "exe" && d218BlockedExt("plan.exe.pdf") === "exe", "#218 files: every dot-separated suffix is checked (double extensions)");
  ok(d218BlockedExt("run.sh. ") === "sh" && d218BlockedExt(".sh") === "sh", "#218 files: trailing dots/spaces and a bare dotfile extension are still caught");
  ok(d218BlockedExt("README") === null && d218BlockedExt("Stage plot.pdf") === null && d218BlockedExt("show.d3") === null, "#218 files: no extension and ordinary files pass");
  ok(d218BlockedExt("C:\\Users\\x\\tool.ps1") === "ps1" && d218BlockedExt("dir/app.dmg") === "dmg", "#218 files: a path-shaped name is judged by its base name");
  ok(d218CheckBytes(b(0x4d, 0x5a, 0x90, 0x00))?.includes("Windows program") === true, "#218 files: MZ bytes are refused");
  ok(d218CheckBytes(b(0x7f, 0x45, 0x4c, 0x46, 2)) !== null && d218CheckBytes(b(0xcf, 0xfa, 0xed, 0xfe)) !== null && d218CheckBytes(b(0xfe, 0xed, 0xfa, 0xce)) !== null && d218CheckBytes(b(0xca, 0xfe, 0xba, 0xbe)) !== null, "#218 files: ELF, Mach-O and fat binaries are refused");
  ok(d218CheckBytes(b(0x23, 0x21, 0x2f))?.includes("script") === true, "#218 files: a #! script is refused");
  ok(d218CheckBytes(b(0x25, 0x50, 0x44, 0x46)) === null && d218CheckBytes(b()) === null && d218CheckBytes(b(0x4d)) === null, "#218 files: a PDF, empty bytes and a lone M pass");
  ok(d218CheckName("a.pdf", d218Max + 1)?.includes("over 100 MB") === true && d218CheckName("a.pdf", 0)?.includes("empty") === true && d218CheckName("a.bat", 10)?.includes("program or script") === true && d218CheckName("a.pdf", 10) === null, "#218 files: the preflight refuses size, empty and blocked names");
  ok(d218Safe("Stage Plot (v2).pdf") === "Stage_Plot_v2_.pdf" && d218Safe("../../etc/passwd") === "passwd" && d218Safe("..hidden") === "hidden" && d218Safe("") === "file", "#218 files: safeFileName is path-safe");
  ok(d218Display("a\r\nb.pdf") === "ab.pdf" && d218Display("  ") === "file", "#218 files: control characters never reach a stored name");
  ok(d218Title("Stage plot v2.pdf") === "Stage plot v2" && d218Title("README") === "README", "#218 files: the default title drops the extension");
  ok(d218Disp('Plan "A".pdf') === `attachment; filename="Plan _A_.pdf"; filename*=UTF-8''Plan%20%22A%22.pdf`, "#218 files: Content-Disposition is attachment with an escaped ASCII name and the UTF-8 name");
  ok(d218Disp("Tom's (v2).pdf").endsWith("filename*=UTF-8''Tom%27s%20%28v2%29.pdf"), "#218 files: RFC 5987 escapes ' ( )");
  const h = d218Headers("x.html");
  ok(h["content-type"] === "application/octet-stream" && h["x-content-type-options"] === "nosniff" && h["cache-control"] === "private, no-store" && h["content-disposition"].startsWith("attachment;"), "#218 files: downloads are octet-stream attachments, nosniff, no-store");

  const k = d218NewKey();
  ok(d218IsKey(k) && /^UP-[0-9a-f]{16}$/.test(k) && d218NewKey() !== k && !d218IsKey("UP-../x") && !d218IsKey(null), "#218 files: upload keys are UP- + 16 hex");
  const K = "UP-0123456789abcdef";
  ok(d218Path("lakefront", K, "Stage Plot.pdf") === `documents/lakefront/${K}/Stage_Plot.pdf`, "#218 files: the blob path is documents/<customer>/<key>/<file>");
  ok(d218Path("TEST218:co a", K, "x.pdf") === `documents/TEST218_co_a/${K}/x.pdf`, "#218 files: an odd customer id becomes one safe segment");
  ok(d218InScope(`documents/lakefront/${K}/Stage_Plot-Ab12Cd.pdf`, "lakefront", K), "#218 files: a Blob-suffixed name under the key is in scope");
  ok(!d218InScope(`documents/other/${K}/x.pdf`, "lakefront", K) && !d218InScope("documents/lakefront/UP-ffffffffffffffff/x.pdf", "lakefront", K), "#218 files: another customer's or another upload's path is refused");
  ok(!d218InScope(`documents/lakefront/${K}/../x.pdf`, "lakefront", K) && !d218InScope(`documents/lakefront/${K}/sub/x.pdf`, "lakefront", K) && !d218InScope(`documents/lakefront/${K}/`, "lakefront", K) && !d218InScope(42, "lakefront", K), "#218 files: traversal, nesting, an empty name and a non-string are refused");
  ok(d218Payload(JSON.stringify({ customerId: "lakefront", uploadKey: K }))?.customerId === "lakefront" && d218Payload("{") === null && d218Payload(JSON.stringify({ customerId: "", uploadKey: K })) === null && d218Payload(JSON.stringify({ customerId: "x", uploadKey: "PD-1" })) === null && d218Payload(null) === null, "#218 files: the upload payload must carry a company and a real upload key");
  ok(d218PayloadKey(JSON.stringify({ uploadKey: K })) === K && d218PayloadKey(JSON.stringify({ uploadKey: "x" })) === null && d218PayloadKey("null") === null, "#218 files: the portal payload needs only its upload key");
  ok(d218GrantErr(`documents/lakefront/${K}/a.pdf`, "lakefront", K) === null && d218GrantErr(`documents/northridge/${K}/a.pdf`, "lakefront", K) !== null, "#218 files: an upload grant refuses a path that does not match its company and key");
  ok(d218Bytes(512) === "512 B" && d218Bytes(1536) === "1.5 KB" && d218Bytes(d218Max) === "100 MB", "#218 files: sizes read as B / KB / MB");

  const seed = d218Resolve(undefined);
  ok(seed.map((c) => c.label).join("|") === "Drawings|Show files|User data|Forms|Photos|Contracts|Other" && seed.every((c, i) => c.order === i && !c.archived), "#218 categories: the seed list");
  ok(d218Seed.length === 7 && d218Resolve([]).length === 7, "#218 categories: an empty stored list reads as the seed");
  const cleaned = d218Resolve([{ key: "drawings", label: " Plans ", order: 1 }, { key: "BAD KEY", label: "x", order: 0 }, { key: "drawings", label: "dupe", order: 2 }, { key: "other", label: "Misc", order: 0, archived: true }]);
  ok(cleaned.map((c) => c.key).join(",") === "other,drawings" && cleaned[1].label === "Plans" && !cleaned[0].archived, "#218 categories: bad and duplicate keys drop, labels trim, Other is never archived, order re-numbers");
  ok(d218Resolve([{ key: "drawings", label: "Drawings", order: 0 }]).map((c) => c.key).join(",") === "drawings,other", "#218 categories: Other is always present");
  ok(d218Norm(seed, "photos") === "photos" && d218Norm(seed, "nope") === "other" && d218Norm(seed, 7) === "other", "#218 categories: an unknown key reads as Other");
  const withArchived = d218Resolve([{ key: "photos", label: "Photos", order: 0, archived: true }, { key: "other", label: "Other", order: 1 }]);
  ok(d218Norm(withArchived, "photos") === "photos" && d218UploadCat(withArchived, "photos") === "other" && d218Active(withArchived).map((c) => c.key).join(",") === "other", "#218 categories: an archived key still labels old files but new uploads fall back to Other");
  ok(d218CatLabel(seed, "show_files") === "Show files" && d218CatLabel(seed, "gone") === "Other", "#218 categories: labels resolve, unknown reads Other");
  const m1 = d218Merge(seed, [{ key: "other", label: "Other" }, { key: "drawings", label: "Plans & drawings" }, { label: "Rider" }]);
  ok(m1.ok && m1.categories.map((c) => c.key).join(",") === "other,drawings,rider,show_files,user_data,forms,photos,contracts" && m1.categories[1].label === "Plans & drawings", "#218 categories: rename, reorder and add; a new key is minted from the label");
  ok(m1.ok && m1.categories.slice(3).every((c) => c.archived === true) && !m1.categories[0].archived && !m1.categories[2].archived, "#218 categories: rows left out are archived, never dropped");
  const m2 = d218Merge(seed, [{ key: "drawings", label: "Drawings" }, { label: "Drawings 2" }, { label: "Drawings 2" }]);
  ok(!m2.ok && m2.error.includes("Drawings 2"), "#218 categories: two active categories can't share a name");
  const m3 = d218Merge(seed, [{ key: "other", label: "Other", archived: true }]);
  ok(!m3.ok && m3.error.includes("can't be archived"), "#218 categories: Other can't be archived");
  ok(!d218Merge(seed, [{ key: "invented", label: "X" }]).ok, "#218 categories: a key the list doesn't have is refused (keys are minted server-side)");
  const m5 = d218Merge(seed, [{ label: "Drawings" }]);
  ok(m5.ok && m5.categories[0].key === "drawings_2", "#218 categories: a minted key never reuses a stored one");
  ok(!d218Merge(seed, [{ key: "drawings", label: "" }]).ok && !d218Merge(seed, "x").ok, "#218 categories: blank names and junk input are refused");

  const base: D218Doc = { id: "DOC-1", title: "Plot", fileName: "plot.pdf", mime: "application/pdf", size: 10, blobPath: "documents/co/UP-0123456789abcdef/plot.pdf", category: "drawings", visibility: "internal", source: "team", customerId: "co", siteId: null, projectId: null, notes: "", uploadedBy: "Jeff", uploadedAt: 100, seenByTeamAt: 100 };
  const docs: D218Doc[] = [
    base,
    { ...base, id: "DOC-2", visibility: "shared", siteId: "v1", uploadedAt: 300 },
    { ...base, id: "DOC-3", source: "customer", visibility: "shared", siteId: "v1", projectId: "P-1", seenByTeamAt: null, uploadedAt: 200, category: "forms" },
    { ...base, id: "DOC-4", customerId: "other", visibility: "shared" },
    { ...base, id: "DOC-5", visibility: "shared", deleted: true },
    { ...base, id: "DOC-6", source: "customer", visibility: "internal", uploadedAt: 50, seenByTeamAt: null },
  ];
  const ids = (xs: { id: string }[]) => xs.map((d) => d.id).join(",");
  ok(ids(d218Filter(docs, { customerId: "co" })) === "DOC-1,DOC-2,DOC-3,DOC-6", "#218 rules: deleted rows and other companies drop out");
  ok(ids(d218Filter(docs, { customerId: "co", siteId: "v1" })) === "DOC-2,DOC-3" && ids(d218Filter(docs, { customerId: "co", siteId: null })) === "DOC-1,DOC-6", "#218 rules: venue filter, and null = company-wide files");
  ok(ids(d218Filter(docs, { customerId: "co", projectId: "P-1" })) === "DOC-3" && ids(d218Filter(docs, { customerId: "co", visibility: "internal" })) === "DOC-1,DOC-6" && ids(d218Filter(docs, { customerId: "co", category: "forms" })) === "DOC-3", "#218 rules: project, visibility and category filters");
  ok(ids(d218Filter(docs, { customerId: "co", portal: true })) === "DOC-2,DOC-3,DOC-6" && d218Filter(docs, { portal: true }).length === 0, "#218 rules: the portal sees shared files and the customer's own uploads, never internal team files; no company = nothing");
  ok(d218PortalSee(docs[1], "co") && d218PortalSee(docs[5], "co"), "#218 access: shared and customer-uploaded files are downloadable by that company");
  ok(!d218PortalSee(docs[0], "co") && !d218PortalSee(docs[3], "co") && !d218PortalSee(docs[4], "co") && !d218PortalSee(docs[1], "other") && !d218PortalSee(null, "co") && !d218PortalSee(docs[1], ""), "#218 access: an internal file, another company's file, a deleted file, no session are all refused");

  const facts = { customerExists: true, siteIds: ["v1", "v2"], project: { id: "P-1", customerId: "co", locationId: "v2" } };
  const s1 = d218Scope({ projectId: "P-1" }, "co", facts);
  ok(s1.ok && s1.siteId === "v2" && s1.projectId === "P-1", "#218 scope: a project file defaults to the project's venue");
  const s2 = d218Scope({ siteId: "v1", projectId: "P-1" }, "co", facts);
  ok(s2.ok && s2.siteId === "v1", "#218 scope: an explicit venue wins over the project's");
  ok(!d218Scope({ siteId: "vX" }, "co", facts).ok, "#218 scope: a venue of another company is refused");
  ok(!d218Scope({ projectId: "P-1" }, "co", { ...facts, project: { id: "P-1", customerId: "other", locationId: null } }).ok, "#218 scope: a project of another company is refused");
  ok(!d218Scope({ projectId: "P-9" }, "co", { ...facts, project: null }).ok && !d218Scope({}, "co", { ...facts, customerExists: false }).ok, "#218 scope: a missing project or company is refused");
  const s3 = d218Scope({ siteId: "", projectId: "" }, "co", facts);
  ok(s3.ok && s3.siteId === null && s3.projectId === null, "#218 scope: blanks mean company-wide");

  const rows = d218Rows(d218Filter(docs, { customerId: "co" }), { categories: seed, venues: [{ id: "v1", label: "Main Stage" }], projects: [{ id: "P-1", label: "Rigging refit" }] });
  ok(ids(rows) === "DOC-2,DOC-3,DOC-1,DOC-6", "#218 rows: newest first");
  const r3 = rows.find((r) => r.id === "DOC-3")!;
  ok(r3.isNew && r3.siteLabel === "Main Stage" && r3.projectLabel === "Rigging refit" && r3.categoryLabel === "Forms" && r3.sizeLabel === "10 B", "#218 rows: labels resolve; an unseen customer upload is New");
  const r1 = rows.find((r) => r.id === "DOC-1")!;
  ok(!r1.isNew && r1.siteLabel === "", "#218 rows: team files are never New; company-wide files carry no venue label");
  const groups = d218Group(docs, "co", seed, [{ id: "v1", label: "Main Stage" }]);
  ok(groups.map((g) => g.venueLabel).join("|") === "Company-wide|Main Stage", "#218 portal: company-wide first, then venues in order");
  ok(groups[1].categories.map((c) => c.label).join("|") === "Drawings|Forms" && ids(groups[0].categories[0].docs) === "DOC-6", "#218 portal: grouped by category within a venue; internal team files never appear");
  const bell = d218Bell([...docs, { ...base, id: "DOC-7", customerId: "b", source: "customer", seenByTeamAt: null, uploadedAt: 900 }]);
  ok(bell.map((x) => `${x.customerId}:${x.count}`).join(",") === "b:1,co:2", "#218 bell: one item per company with unseen customer uploads, newest first");
  ok(d218Mime("application/pdf") === "application/pdf" && d218Mime("text/html\r\nX: y") === "application/octet-stream" && d218Mime("") === "application/octet-stream", "#218 rules: the browser MIME is informational and sanitized");
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
export PATH=$HOME/.local/node/bin:$PATH && env -u DATABASE_URL npm run test:specs 2>&1 | grep -m1 -i 'cannot find module'
```

Expected: `Error: Cannot find module '@/lib/document-files'` (the whole harness refuses to load).

- [ ] **Step 3: Create `src/lib/document-files.ts`**

```ts
/**
 * Documents (#218) — file rules shared by the team and portal uploads.
 * Pure: no store, no `@/db`, no Node built-ins, so client components import
 * it freely. The browser's MIME type and the file's extension are only a
 * first filter; the finalize step (src/lib/documents-upload.ts) re-checks the
 * real bytes after the upload lands. Spec:
 * docs/superpowers/specs/2026-09-26-documents-design.md.
 */

export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;
export const MAX_DOCUMENT_LABEL = "100 MB";
/** Leading bytes the finalize step reads to spot a program or script. */
export const DOCUMENT_SNIFF_BYTES = 16;
/** Blob pathname prefix — every company document lives under it. */
export const DOCUMENT_BLOB_PREFIX = "documents/";

/** Programs and scripts — refused on every dot-separated segment of a name. */
export const BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  "exe", "msi", "bat", "cmd", "com", "scr", "pif", "vbs", "vbe", "js", "jse", "wsf", "wsh",
  "ps1", "psm1", "sh", "bash", "zsh", "app", "dmg", "pkg", "jar", "apk", "deb", "rpm",
  "dll", "so", "dylib",
]);

const MAGIC: ReadonlyArray<{ sig: readonly number[]; label: string }> = [
  { sig: [0x4d, 0x5a], label: "a Windows program" },
  { sig: [0x7f, 0x45, 0x4c, 0x46], label: "a Linux program" },
  { sig: [0xfe, 0xed, 0xfa, 0xce], label: "a Mac program" },
  { sig: [0xfe, 0xed, 0xfa, 0xcf], label: "a Mac program" },
  { sig: [0xce, 0xfa, 0xed, 0xfe], label: "a Mac program" },
  { sig: [0xcf, 0xfa, 0xed, 0xfe], label: "a Mac program" },
  { sig: [0xca, 0xfe, 0xba, 0xbe], label: "a Mac or Java program" },
  { sig: [0x23, 0x21], label: "a script" },
];

function stripControl(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c >= 32 && c !== 127) out += ch;
  }
  return out;
}

/** The last path segment of a name a browser (or a forged call) supplied. */
export function baseName(raw: unknown): string {
  const parts = String(raw ?? "").split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

/** The name we store and show: base name, no control characters (so it can
 *  never break a header), capped at 180. */
export function displayFileName(raw: unknown): string {
  return stripControl(baseName(raw)).trim().slice(0, 180) || "file";
}

/** A Blob pathname segment: letters, digits, `._-` only, no `..`, ≤ 80. */
export function safeFileName(raw: unknown): string {
  return (
    displayFileName(raw)
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/\.{2,}/g, ".")
      .replace(/^[_.]+|_+$/g, "")
      .slice(0, 80) || "file"
  );
}

/** Default title: the file name without its last extension. */
export function titleFromFileName(raw: unknown): string {
  const name = displayFileName(raw);
  return name.replace(/\.[^.\s]{1,10}$/, "").trim().slice(0, 200) || name;
}

/** The blocked extension this name carries, or null. Every dot-separated
 *  segment after the first counts, so `x.pdf.exe` and `x.exe.pdf` are both
 *  blocked; trailing dots and spaces are ignored the way Windows ignores them. */
export function blockedExtension(name: unknown): string | null {
  const base = baseName(name).replace(/[\s.]+$/g, "");
  for (const seg of base.split(".").slice(1)) {
    const ext = seg.trim().toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) return ext;
  }
  return null;
}

/** Browser preflight (the server re-checks): refusal text or null. */
export function checkDocumentName(name: string, size: number): string | null {
  const shown = displayFileName(name);
  if (!(size > 0)) return `${shown} is empty.`;
  if (size > MAX_DOCUMENT_BYTES) return `${shown} is over ${MAX_DOCUMENT_LABEL}.`;
  const ext = blockedExtension(shown);
  if (ext) return `${shown} is a program or script (.${ext}) — those can't be uploaded.`;
  return null;
}

/** Refusal text when the leading bytes are a program or script, else null. */
export function checkDocumentBytes(bytes: Uint8Array): string | null {
  for (const m of MAGIC) {
    if (bytes.length < m.sig.length) continue;
    if (m.sig.every((v, i) => bytes[i] === v)) return `That file is ${m.label} — programs and scripts can't be uploaded.`;
  }
  return null;
}

/** `UP-` + 16 lowercase hex. Minted in the browser; keys the upload's path. */
export function newUploadKey(): string {
  return "UP-" + globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

export function isUploadKey(v: unknown): v is string {
  return typeof v === "string" && /^UP-[0-9a-f]{16}$/.test(v);
}

/** One path segment for a company id (ids are slugs today; anything odd is
 *  folded to `_`). Access is by record, never by path, so a fold collision
 *  grants nothing. */
export function customerPathSegment(customerId: string): string {
  return String(customerId ?? "").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 64) || "_";
}

export function documentUploadPrefix(customerId: string, uploadKey: string): string {
  return `${DOCUMENT_BLOB_PREFIX}${customerPathSegment(customerId)}/${uploadKey}/`;
}

/** `documents/<customer>/<uploadKey>/<safe name>` — Blob appends a random suffix. */
export function documentBlobPath(customerId: string, uploadKey: string, fileName: string): string {
  return documentUploadPrefix(customerId, uploadKey) + safeFileName(fileName);
}

/** Does a CLIENT-SUPPLIED pathname sit directly under this company's upload
 *  key? Used by both token routes and by finalize — a client blobPath is
 *  untrusted input. */
export function blobPathInScope(pathname: unknown, customerId: string, uploadKey: string): pathname is string {
  if (typeof pathname !== "string" || !customerId || !isUploadKey(uploadKey)) return false;
  const prefix = documentUploadPrefix(customerId, uploadKey);
  if (!pathname.startsWith(prefix) || pathname.includes("..")) return false;
  const rest = pathname.slice(prefix.length);
  return rest.length > 0 && rest.length <= 200 && /^[A-Za-z0-9._-]+$/.test(rest);
}

/** Token-route refusal text, or null when the grant may be issued. */
export function uploadGrantError(pathname: string, customerId: string, uploadKey: string): string | null {
  return blobPathInScope(pathname, customerId, uploadKey)
    ? null
    : `pathname must be ${documentUploadPrefix(customerId, uploadKey)}<file>`;
}

/** The team token route's clientPayload: `{ customerId, uploadKey }`. */
export function parseUploadPayload(payload: string | null): { customerId: string; uploadKey: string } | null {
  try {
    const p = payload ? (JSON.parse(payload) as { customerId?: unknown; uploadKey?: unknown } | null) : null;
    if (!p || typeof p.customerId !== "string" || !p.customerId.trim() || p.customerId.length > 120) return null;
    if (!isUploadKey(p.uploadKey)) return null;
    return { customerId: p.customerId, uploadKey: p.uploadKey };
  } catch {
    return null;
  }
}

/** The portal token route reads only the upload key — the company comes
 *  from the portal session. */
export function parseUploadKey(payload: string | null): string | null {
  try {
    const p = payload ? (JSON.parse(payload) as { uploadKey?: unknown } | null) : null;
    return p && isUploadKey(p.uploadKey) ? p.uploadKey : null;
  } catch {
    return null;
  }
}

/** RFC 6266 attachment: an ASCII fallback plus the RFC 5987 UTF-8 name. */
export function attachmentDisposition(fileName: string): string {
  const name = displayFileName(fileName);
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const star = encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${star}`;
}

/** Every document download, team or portal: a file, never rendered. */
export function documentDownloadHeaders(fileName: string): Record<string, string> {
  return {
    "content-type": "application/octet-stream",
    "content-disposition": attachmentDisposition(fileName),
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-store",
  };
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 1024) return `${Math.max(0, Math.round(n || 0))} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}
```

- [ ] **Step 4: Create `src/lib/document-categories.ts`**

```ts
/**
 * Documents (#218) — the editable category list. Pure. Stored whole in the
 * app settings row as `documentCategories` (Settings → Admin → Document
 * categories); absent reads as the seed. Keys are minted server-side from
 * the label and never change; a row dropped in the editor is kept archived
 * (old files keep their label, new uploads can't pick it). `other` always
 * exists, can't be archived, and is what an unknown key reads as.
 */

export type DocumentCategory = { key: string; label: string; order: number; archived?: boolean };
export type DocumentCategoryInput = { key?: string; label: string; archived?: boolean };

export const OTHER_CATEGORY = "other";
export const MAX_DOCUMENT_CATEGORIES = 40;

export const SEED_DOCUMENT_CATEGORIES: readonly DocumentCategory[] = [
  { key: "drawings", label: "Drawings", order: 0 },
  { key: "show_files", label: "Show files", order: 1 },
  { key: "user_data", label: "User data", order: 2 },
  { key: "forms", label: "Forms", order: 3 },
  { key: "photos", label: "Photos", order: 4 },
  { key: "contracts", label: "Contracts", order: 5 },
  { key: OTHER_CATEGORY, label: "Other", order: 6 },
];

const KEY_RE = /^[a-z0-9_]{1,40}$/;

/** The stored list, sanitized: bad/duplicate keys dropped, labels trimmed,
 *  `other` guaranteed and never archived, `order` re-numbered 0…n-1. */
export function resolveDocumentCategories(stored: unknown): DocumentCategory[] {
  if (!Array.isArray(stored) || !stored.length) return SEED_DOCUMENT_CATEGORIES.map((c) => ({ ...c }));
  const seen = new Set<string>();
  const out: DocumentCategory[] = [];
  for (const raw of stored) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const key = typeof r.key === "string" ? r.key : "";
    const label = typeof r.label === "string" ? r.label.trim().slice(0, 40) : "";
    if (!KEY_RE.test(key) || seen.has(key) || !label) continue;
    seen.add(key);
    const c: DocumentCategory = { key, label, order: Number.isFinite(r.order) ? Number(r.order) : out.length };
    if (r.archived === true && key !== OTHER_CATEGORY) c.archived = true;
    out.push(c);
  }
  if (!seen.has(OTHER_CATEGORY)) out.push({ key: OTHER_CATEGORY, label: "Other", order: Number.MAX_SAFE_INTEGER });
  return out.sort((a, b) => a.order - b.order).map((c, i) => ({ ...c, order: i }));
}

export function activeDocumentCategories(cats: readonly DocumentCategory[]): DocumentCategory[] {
  return cats.filter((c) => !c.archived);
}

export function categoryLabel(cats: readonly DocumentCategory[], key: string): string {
  return cats.find((c) => c.key === key)?.label ?? cats.find((c) => c.key === OTHER_CATEGORY)?.label ?? "Other";
}

/** Any listed key (archived included) stays; anything else reads as Other. */
export function normalizeCategory(cats: readonly DocumentCategory[], key: unknown): string {
  return typeof key === "string" && cats.some((c) => c.key === key) ? key : OTHER_CATEGORY;
}

/** New uploads may only land in an ACTIVE category; anything else is Other. */
export function uploadCategory(cats: readonly DocumentCategory[], key: unknown): string {
  return typeof key === "string" && cats.some((c) => c.key === key && !c.archived) ? key : OTHER_CATEGORY;
}

export function slugCategoryKey(label: string, taken: ReadonlySet<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 36) || "category";
  let key = base;
  let n = 2;
  while (taken.has(key)) key = `${base}_${n++}`;
  return key;
}

/** The editor's whole-list save over the stored (resolved) list. */
export function mergeDocumentCategories(
  stored: readonly DocumentCategory[],
  input: unknown
): { ok: true; categories: DocumentCategory[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "Nothing to save." };
  const known = new Set(stored.map((c) => c.key));
  const taken = new Set(known);
  const used = new Set<string>();
  const labels = new Set<string>();
  const out: DocumentCategory[] = [];
  for (const raw of input) {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim() : "";
    if (!label) return { ok: false, error: "Every category needs a name." };
    if (label.length > 40) return { ok: false, error: `"${label.slice(0, 40)}…" is longer than 40 characters.` };
    const archived = r.archived === true;
    if (!archived) {
      const lower = label.toLowerCase();
      if (labels.has(lower)) return { ok: false, error: `Two categories are named "${label}".` };
      labels.add(lower);
    }
    let key = typeof r.key === "string" ? r.key : "";
    if (key) {
      if (!known.has(key)) return { ok: false, error: `Unknown category "${key}".` };
    } else {
      key = slugCategoryKey(label, taken);
      taken.add(key);
    }
    if (used.has(key)) return { ok: false, error: `"${label}" is listed twice.` };
    used.add(key);
    const c: DocumentCategory = { key, label, order: out.length };
    if (archived) {
      if (key === OTHER_CATEGORY) return { ok: false, error: "Other can't be archived — it holds anything without a category." };
      c.archived = true;
    }
    out.push(c);
  }
  // Keys are immutable and files may still point at a row the editor
  // dropped, so a missing stored row stays — archived (Other: active).
  for (const c of stored) {
    if (used.has(c.key)) continue;
    const kept: DocumentCategory = { key: c.key, label: c.label, order: out.length };
    if (c.key !== OTHER_CATEGORY) kept.archived = true;
    out.push(kept);
  }
  if (out.length > MAX_DOCUMENT_CATEGORIES) return { ok: false, error: `At most ${MAX_DOCUMENT_CATEGORIES} categories.` };
  return { ok: true, categories: out };
}
```

- [ ] **Step 5: Create `src/lib/document-rules.ts`**

```ts
import { categoryLabel, OTHER_CATEGORY, type DocumentCategory } from "./document-categories";
import { formatBytes, titleFromFileName } from "./document-files";

/**
 * Documents (#218) — the record and every rule about who sees what. Pure:
 * client components import the types and view models; the store, the
 * finalize step and both download routes call the same functions, so the
 * portal's access rule lives in exactly one place (`portalCanSee`).
 */

export type DocumentVisibility = "internal" | "shared";
export type DocumentSource = "team" | "customer";

export type DocumentRecord = {
  /** "DOC-" + sequence from 1000. */
  id: string;
  /** 1–200, defaults to the file name without extension. */
  title: string;
  /** Original name, control characters stripped (safe in a header). */
  fileName: string;
  /** From the browser — informational only; downloads are octet-stream. */
  mime: string;
  /** Bytes, as Blob reports them (≤ 100 MB). */
  size: number;
  /** `documents/<customer>/<uploadKey>/<file>-<suffix>` — private Blob. */
  blobPath: string;
  category: string;
  /** shared = visible on the customer portal. */
  visibility: DocumentVisibility;
  source: DocumentSource;
  /** Required — every document belongs to a company. Never changes. */
  customerId: string;
  /** Optional venue of that company (the doc-side location id, docLocId). */
  siteId: string | null;
  /** Optional project of that company. */
  projectId: string | null;
  notes: string;
  /** Team user name, or the portal person's name. */
  uploadedBy: string;
  uploadedAt: number;
  /** Customer uploads: null until a team member opens/acknowledges. */
  seenByTeamAt: number | null;
  deleted?: true;
};

export const MAX_TITLE = 200;
export const MAX_NOTES = 2000;

export function isVisibility(v: unknown): v is DocumentVisibility {
  return v === "internal" || v === "shared";
}

export function cleanTitle(raw: unknown, fileName: string): string {
  let t = "";
  for (const ch of String(raw ?? "")) {
    const c = ch.charCodeAt(0);
    if (c >= 32 && c !== 127) t += ch;
  }
  t = t.trim().slice(0, MAX_TITLE);
  return t || titleFromFileName(fileName).slice(0, MAX_TITLE);
}

export function cleanNotes(raw: unknown): string {
  return String(raw ?? "").trim().slice(0, MAX_NOTES);
}

export function cleanMime(raw: unknown): string {
  const m = String(raw ?? "").trim().toLowerCase();
  return m.length <= 120 && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(m) ? m : "application/octet-stream";
}

export type DocumentFilter = {
  customerId?: string;
  /** undefined = any venue; null = company-wide files only. */
  siteId?: string | null;
  projectId?: string | null;
  visibility?: DocumentVisibility;
  category?: string;
  /** Only what the customer portal may show for `customerId`. */
  portal?: boolean;
};

/** Keeps input order. Deleted rows never pass. */
export function filterDocuments(docs: readonly DocumentRecord[], f: DocumentFilter = {}): DocumentRecord[] {
  return docs.filter((d) => {
    if (d.deleted) return false;
    if (f.customerId !== undefined && d.customerId !== f.customerId) return false;
    if (f.siteId !== undefined && (d.siteId || null) !== f.siteId) return false;
    if (f.projectId !== undefined && (d.projectId || null) !== f.projectId) return false;
    if (f.visibility && d.visibility !== f.visibility) return false;
    if (f.category && d.category !== f.category) return false;
    if (f.portal && !portalCanSee(d, f.customerId ?? "")) return false;
    return true;
  });
}

/** THE portal rule: the session's own company, and shared or their own upload. */
export function portalCanSee(doc: DocumentRecord | null | undefined, customerId: string | null | undefined): boolean {
  if (!doc || doc.deleted || !customerId) return false;
  if (doc.customerId !== customerId) return false;
  return doc.visibility === "shared" || doc.source === "customer";
}

export type DocumentScopeFacts = {
  customerExists: boolean;
  /** The company's venues, as doc-side location ids (docLocId). */
  siteIds: readonly string[];
  project: { id: string; customerId: string | null; locationId: string | null } | null;
};

/** Venue/project for a document of `customerId`: both must belong to that
 *  company; a project file with no venue takes the project's venue. */
export function resolveDocumentScope(
  input: { siteId?: string | null; projectId?: string | null },
  customerId: string,
  facts: DocumentScopeFacts
): { ok: true; siteId: string | null; projectId: string | null } | { ok: false; error: string } {
  if (!customerId || !facts.customerExists) return { ok: false, error: "That company no longer exists." };
  const projectId = String(input.projectId ?? "").trim() || null;
  let siteId = String(input.siteId ?? "").trim() || null;
  if (projectId) {
    if (!facts.project || facts.project.id !== projectId) return { ok: false, error: "That project no longer exists." };
    if (facts.project.customerId !== customerId) return { ok: false, error: "That project belongs to another company." };
    if (!siteId && facts.project.locationId && facts.siteIds.includes(facts.project.locationId)) siteId = facts.project.locationId;
  }
  if (siteId && !facts.siteIds.includes(siteId)) return { ok: false, error: "That venue belongs to another company." };
  return { ok: true, siteId, projectId };
}

export type DocumentOption = { id: string; label: string };

/** Serializable row for the team card (never carries blobPath). */
export type DocumentRowVM = {
  id: string;
  title: string;
  fileName: string;
  size: number;
  sizeLabel: string;
  category: string;
  categoryLabel: string;
  siteId: string | null;
  siteLabel: string;
  projectId: string | null;
  projectLabel: string;
  visibility: DocumentVisibility;
  source: DocumentSource;
  isNew: boolean;
  uploadedBy: string;
  uploadedAt: number;
  notes: string;
};

export function documentRows(
  docs: readonly DocumentRecord[],
  ctx: { categories: readonly DocumentCategory[]; venues: readonly DocumentOption[]; projects: readonly DocumentOption[] }
): DocumentRowVM[] {
  const venue = new Map(ctx.venues.map((v) => [v.id, v.label]));
  const project = new Map(ctx.projects.map((p) => [p.id, p.label]));
  return docs
    .filter((d) => !d.deleted)
    .sort((a, b) => b.uploadedAt - a.uploadedAt)
    .map((d) => ({
      id: d.id,
      title: d.title,
      fileName: d.fileName,
      size: d.size,
      sizeLabel: formatBytes(d.size),
      category: d.category,
      categoryLabel: categoryLabel(ctx.categories, d.category),
      siteId: d.siteId,
      siteLabel: d.siteId ? venue.get(d.siteId) ?? "Removed venue" : "",
      projectId: d.projectId,
      projectLabel: d.projectId ? project.get(d.projectId) ?? d.projectId : "",
      visibility: d.visibility,
      source: d.source,
      isNew: d.source === "customer" && d.seenByTeamAt == null,
      uploadedBy: d.uploadedBy,
      uploadedAt: d.uploadedAt,
      notes: d.notes,
    }));
}

export type PortalDocGroup = {
  venueId: string | null;
  venueLabel: string;
  categories: Array<{ key: string; label: string; docs: DocumentRecord[] }>;
};

/** The portal list: only what `portalCanSee`, company-wide first, then the
 *  company's venues in order, each split by category in category order. A
 *  file on a venue that no longer exists reads as company-wide. */
export function groupForPortal(
  docs: readonly DocumentRecord[],
  customerId: string,
  categories: readonly DocumentCategory[],
  venues: readonly DocumentOption[]
): PortalDocGroup[] {
  const visible = docs.filter((d) => portalCanSee(d, customerId)).sort((a, b) => b.uploadedAt - a.uploadedAt);
  const known = new Set(venues.map((v) => v.id));
  const catOrder = new Map(categories.map((c, i) => [c.key, i]));
  const order: Array<{ id: string | null; label: string }> = [
    { id: null, label: "Company-wide" },
    ...venues.map((v) => ({ id: v.id, label: v.label })),
  ];
  const out: PortalDocGroup[] = [];
  for (const v of order) {
    const inVenue = visible.filter((d) => (d.siteId && known.has(d.siteId) ? d.siteId : null) === v.id);
    if (!inVenue.length) continue;
    const byCat = new Map<string, DocumentRecord[]>();
    for (const d of inVenue) {
      const key = catOrder.has(d.category) ? d.category : OTHER_CATEGORY;
      byCat.set(key, [...(byCat.get(key) || []), d]);
    }
    out.push({
      venueId: v.id,
      venueLabel: v.label,
      categories: [...byCat.entries()]
        .sort((a, b) => (catOrder.get(a[0]) ?? 999) - (catOrder.get(b[0]) ?? 999))
        .map(([key, list]) => ({ key, label: categoryLabel(categories, key), docs: list })),
    });
  }
  return out;
}

/** One bell row per company with unseen customer uploads, newest first. */
export function customerUploadBell(docs: readonly DocumentRecord[]): Array<{ customerId: string; count: number; latestAt: number }> {
  const by = new Map<string, { customerId: string; count: number; latestAt: number }>();
  for (const d of docs) {
    if (d.deleted || d.source !== "customer" || d.seenByTeamAt != null || !d.customerId) continue;
    const e = by.get(d.customerId) || { customerId: d.customerId, count: 0, latestAt: 0 };
    e.count++;
    e.latestAt = Math.max(e.latestAt, d.uploadedAt || 0);
    by.set(d.customerId, e);
  }
  return [...by.values()].sort((a, b) => b.latestAt - a.latestAt);
}
```

- [ ] **Step 6: Run the gates**

```bash
export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit -p . && echo TSC_OK
```

Expected: `TSC_OK`.

```bash
export PATH=$HOME/.local/node/bin:$PATH && ps aux | grep -E "tsx|next dev" | grep -v grep; env -u DATABASE_URL npm run test:specs > "${TMPDIR:-/tmp}/d218-specs.log" 2>&1; tail -1 "${TMPDIR:-/tmp}/d218-specs.log"; grep '^FAIL' "${TMPDIR:-/tmp}/d218-specs.log" | head -5; grep -c '^PASS' "${TMPDIR:-/tmp}/d218-specs.log"; grep -c '^PASS #218' "${TMPDIR:-/tmp}/d218-specs.log"
```

Expected: `ALL PASSED`, no `FAIL` lines, the total PASS count (report it), and `#218` PASS count **60**.

```bash
export PATH=$HOME/.local/node/bin:$PATH && npx eslint src/lib/document-files.ts src/lib/document-categories.ts src/lib/document-rules.ts scripts/test-review-and-spec.ts
```

Expected: 0 errors. Warnings in `scripts/test-review-and-spec.ts` that were already there before this task are fine.

- [ ] **Step 7: Commit**

```bash
export PATH=$HOME/.local/node/bin:$PATH && git add src/lib/document-files.ts src/lib/document-categories.ts src/lib/document-rules.ts scripts/test-review-and-spec.ts && git commit -m "feat(documents): file rules, categories and access rules (#218)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `documents` table + migration, store, categories setting and Settings card

**Files:**
- Create: `drizzle/<NNNN>_documents.sql`, `drizzle/meta/<NNNN>_snapshot.json`
- Modify: `drizzle/meta/_journal.json`, `src/db/doc-tables.ts`
- Create: `src/lib/stores/documents.ts`
- Modify: `src/lib/settings.ts`
- Create: `src/app/(app)/settings/document-categories-card.tsx`
- Modify: `src/app/(app)/settings/actions.ts`, `src/app/(app)/settings/page.tsx`, `src/app/(app)/settings/settings-client.tsx`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: Task 1 (`DocumentRecord`, `filterDocuments`, `DocumentFilter`, `isVisibility`, `MAX_TITLE`, `MAX_NOTES`, `resolveDocumentCategories`, `mergeDocumentCategories`, `DocumentCategory`, `OTHER_CATEGORY`).
- Produces (`src/lib/stores/documents.ts`, server-only):
  ```ts
  export type NewDocumentInput = { title; fileName; mime; size; blobPath; category; visibility; source; customerId;
    siteId: string | null; projectId: string | null; notes; uploadedBy; uploadedAt?: number };
  export type DocumentPatch = { title?: string; category?: string; visibility?: DocumentVisibility;
    siteId?: string | null; projectId?: string | null; notes?: string };
  export async function createDocument(input: NewDocumentInput): Promise<DocumentRecord>;
  export async function getDocument(id: string): Promise<DocumentRecord | null>;
  export async function documentsForCustomer(customerId: string, filter?: Omit<DocumentFilter, "customerId">): Promise<DocumentRecord[]>; // newest first
  export async function documentByBlobPath(blobPath: string): Promise<DocumentRecord | null>;
  export async function updateDocument(id: string, patch: DocumentPatch): Promise<DocumentRecord | null>;
  export async function removeDocument(id: string): Promise<DocumentRecord | null>;
  export async function markSeen(ids: readonly string[], at?: number): Promise<number>;
  export async function markCustomerSeen(customerId: string, at?: number): Promise<number>;
  export async function unseenCustomerDocuments(): Promise<DocumentRecord[]>;
  export async function documentCategories(): Promise<DocumentCategory[]>;
  ```
- Produces: collection name `"documents"` for every `@/db/doc-store` call; `AppSettingsData.documentCategories?: DocumentCategory[]`; `saveDocumentCategoriesAction(input) → { ok: true } | { ok: false; error }` in `settings/actions.ts`.

- [ ] **Step 1: Precondition — the spec-builder migration (0027) must already be on this branch**

```bash
export PATH=$HOME/.local/node/bin:$PATH && git fetch origin && git ls-tree --name-only origin/main drizzle/ | grep '^drizzle/0027_'; ls drizzle/0027_*.sql
```

Expected: both print `drizzle/0027_spec_documents.sql`. **If either prints nothing, STOP and report `BLOCKED: origin/main (or this branch) does not contain drizzle/0027_*; merge origin/main into feat/punch-inbox-tasks first.`** Do not pick a migration number yourself.

Then check which number is free:

```bash
export PATH=$HOME/.local/node/bin:$PATH && node -e 'const j=require("./drizzle/meta/_journal.json");const l=j.entries[j.entries.length-1];if(l.idx<27){console.error("BLOCKED: last migration is "+l.tag);process.exit(1)}console.log("next free:",String(l.idx+1).padStart(4,"0"),"after",l.tag)'
```

Expected: `next free: 0028 after 0027_spec_documents`. If #216's `sites.name_auto` migration landed first, the output is `next free: 0029 after 0028_…`. Either is fine. The steps below compute the number themselves.

- [ ] **Step 2: Write the failing test**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts

/* ======================================================================
   Documents (#218) — Task 2: the store (DB-backed) + the Settings card.
   ====================================================================== */
import {
  createDocument as d218Create, getDocument as d218Get, updateDocument as d218Update, removeDocument as d218Remove,
  documentsForCustomer as d218ForCustomer, markSeen as d218MarkSeen, markCustomerSeen as d218MarkCustomerSeen,
  unseenCustomerDocuments as d218Unseen, documentByBlobPath as d218ByPath, documentCategories as d218Cats,
} from "@/lib/stores/documents";

{
  const src218s = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  ok(src218s("src/app/(app)/settings/settings-client.tsx").includes("<DocumentCategoriesCard"), "#218 settings: the Document categories card is on Settings → Admin");
  const sa = src218s("src/app/(app)/settings/actions.ts");
  ok(/export async function saveDocumentCategoriesAction[\s\S]{0,400}await requirePerm\("manage_users"\)[\s\S]{0,400}mergeDocumentCategories\(/.test(sa), "#218 settings: saving categories is admin-only and goes through mergeDocumentCategories");
}

async function documentsStoreAsyncChecks(): Promise<void> {
  const CO = fixtureId(218, "co-a");
  const CO2 = fixtureId(218, "co-b");
  const mk = async (over: Partial<Parameters<typeof d218Create>[0]> = {}) => {
    const d = await d218Create({
      title: "Stage plot", fileName: "plot.pdf", mime: "application/pdf", size: 1234,
      blobPath: `documents/TEST218_co-a/UP-0000000000000218/plot-${Math.random().toString(36).slice(2, 8)}.pdf`,
      category: "drawings", visibility: "internal", source: "team", customerId: CO, siteId: null, projectId: null,
      notes: "", uploadedBy: "Jeff", ...over,
    });
    registerFixture("documents", d.id);
    return d;
  };
  const a = await mk();
  ok(/^DOC-\d{4,}$/.test(a.id) && Number(a.id.slice(4)) >= 1000 && a.seenByTeamAt === a.uploadedAt && !a.deleted, "#218 store: a team upload gets a DOC- id from 1000 and counts as seen");
  const c = await mk({ source: "customer", visibility: "shared", siteId: "v1", uploadedBy: "Pat Customer" });
  ok(c.seenByTeamAt === null && Number(c.id.slice(4)) > Number(a.id.slice(4)), "#218 store: a customer upload starts unseen; ids climb");
  await mk({ customerId: CO2, visibility: "shared" });
  const forCo = await d218ForCustomer(CO);
  ok(forCo.map((d) => d.id).sort().join(",") === [a.id, c.id].sort().join(","), "#218 store: documentsForCustomer never returns another company's files");
  ok((await d218ForCustomer(CO, { siteId: "v1" })).map((d) => d.id).join(",") === c.id && (await d218ForCustomer(CO, { portal: true })).map((d) => d.id).join(",") === c.id, "#218 store: venue and portal scoping");
  ok((await d218ByPath(a.blobPath))?.id === a.id && (await d218ByPath("documents/none")) === null, "#218 store: lookup by blob path");
  const up = await d218Update(a.id, { title: "  Revised plot  ", category: "photos", visibility: "shared", siteId: "v2", projectId: "P-9", notes: "n".repeat(2100), customerId: CO2, blobPath: "documents/evil" } as Parameters<typeof d218Update>[1]);
  ok(up?.title === "Revised plot" && up.category === "photos" && up.visibility === "shared" && up.siteId === "v2" && up.projectId === "P-9" && up.notes.length === 2000, "#218 store: title/category/visibility/venue/project/notes update, trimmed and capped");
  ok(up?.customerId === CO && up.blobPath === a.blobPath, "#218 store: an update can never move a file to another company or swap its blob");
  ok((await d218Update(a.id, { title: "   " }))?.title === "Revised plot", "#218 store: a blank title keeps the old one");
  const unseen = await d218Unseen();
  ok(unseen.some((d) => d.id === c.id) && !unseen.some((d) => d.id === a.id), "#218 store: unseen customer uploads are listed; team files never are");
  ok((await d218MarkSeen([c.id, a.id], 5000)) === 1 && (await d218Get(c.id))?.seenByTeamAt === 5000, "#218 store: markSeen stamps only unseen customer uploads");
  const c2 = await mk({ source: "customer", visibility: "shared" });
  ok((await d218MarkCustomerSeen(CO, 6000)) === 1 && (await d218Get(c2.id))?.seenByTeamAt === 6000, "#218 store: markCustomerSeen acknowledges one company's new uploads");
  const removed = await d218Remove(a.id);
  ok(removed?.id === a.id && (await d218Get(a.id)) === null && !(await d218ForCustomer(CO)).some((d) => d.id === a.id) && (await d218Remove(a.id)) === null, "#218 store: delete is soft, hides the file everywhere, and is idempotent");
  ok((await d218Cats()).some((x) => x.key === "other"), "#218 store: documentCategories resolves the settings list (the seed on a fresh database)");
}
```

Then register the async function on the suite's promise chain. In `scripts/test-review-and-spec.ts`, replace this exact text:

```ts
  // Before the report and before the `.catch`, so a thrown suite is torn
  // down exactly like a passing one.
  .finally(() => teardownFixtures())
```

with:

```ts
  .then(() => documentsStoreAsyncChecks())
  // Before the report and before the `.catch`, so a thrown suite is torn
  // down exactly like a passing one.
  .finally(() => teardownFixtures())
```

- [ ] **Step 3: Run it to verify it fails**

```bash
export PATH=$HOME/.local/node/bin:$PATH && env -u DATABASE_URL npm run test:specs 2>&1 | grep -m1 -i 'cannot find module'
```

Expected: `Error: Cannot find module '@/lib/stores/documents'`.

- [ ] **Step 4: Register the collection**

In `src/db/doc-tables.ts`, replace this exact text:

```ts
export const specDocuments = docTable("spec_documents"); // Spec builder (#205 Phase B) — one saved spec per CSI section: header, products, fill-in answers; migration 0027_spec_documents
```

with:

```ts
export const specDocuments = docTable("spec_documents"); // Spec builder (#205 Phase B) — one saved spec per CSI section: header, products, fill-in answers; migration 0027_spec_documents
export const documents = docTable("documents"); // Documents (#218) — company/venue/project files in private Blob, shared both ways through the portal; migration <NNNN>_documents
```

In the same file, replace this exact text:

```ts
  spec_documents: specDocuments,
} as const;
```

with:

```ts
  spec_documents: specDocuments,
  documents,
} as const;
```

After Step 5 creates the SQL file, replace `<NNNN>` in that comment with the real number (for example `0028_documents`). Do **not** add `documents` to `SYNCABLE_COLLECTIONS`. Only permission-checked server code writes it, never `/api/sync/push`.

- [ ] **Step 5: Write the idempotent migration (D141)**

This file is hand-written, never `drizzle-kit generate`d. Column-for-column it is `docTable()`, copied from `drizzle/0027_spec_documents.sql`. Without the `_seq_bump` trigger, pull-sync's `WHERE seq > cursor` never sees an UPDATE. Run from the worktree root:

```bash
export PATH=$HOME/.local/node/bin:$PATH && N=$(node -e 'const j=require("./drizzle/meta/_journal.json");const l=j.entries[j.entries.length-1];if(l.idx<27){console.error("BLOCKED: last migration is "+l.tag);process.exit(1)}process.stdout.write(String(l.idx+1).padStart(4,"0"))') && cat > "drizzle/${N}_documents.sql" <<'SQL'
-- Documents (#218, docs/superpowers/specs/2026-09-26-documents-design.md) —
-- company / venue / project files stored in private Vercel Blob and shared
-- both ways through the customer portal.
--
-- Idempotent per D141 (the shared Neon database is migrated by more than one
-- branch's build). Column-for-column docTable(); the _seq_bump trigger keeps
-- pull-sync's `WHERE seq > cursor` honest.
CREATE TABLE IF NOT EXISTS "documents" (
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
CREATE INDEX IF NOT EXISTS "documents_seq_idx" ON "documents" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_deleted_idx" ON "documents" USING btree ("deleted");--> statement-breakpoint
CREATE OR REPLACE TRIGGER documents_seq_bump BEFORE UPDATE ON "documents" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
SQL
ls drizzle/[0-9][0-9][0-9][0-9]_documents.sql
```

Expected: one line, `drizzle/0028_documents.sql` (or `0029_…`). Now fix the `<NNNN>` placeholder in the `src/db/doc-tables.ts` comment from Step 4 to that number.

- [ ] **Step 6: Chain the snapshot and the journal**

The new snapshot is the previous one plus a `documents` table cloned from `spec_documents`, with a fresh `id` and `prevId` set to the previous snapshot's id. The journal gains the tag.

```bash
export PATH=$HOME/.local/node/bin:$PATH && node <<'JS'
const fs = require("fs");
const crypto = require("crypto");
const file = fs.readdirSync("drizzle").find((n) => /^\d{4}_documents\.sql$/.test(n));
if (!file) throw new Error("no drizzle/NNNN_documents.sql — run Step 5 first");
const tag = file.replace(/\.sql$/, "");
const idx = Number(tag.slice(0, 4));
const journalPath = "drizzle/meta/_journal.json";
const j = JSON.parse(fs.readFileSync(journalPath, "utf8"));
const last = j.entries[j.entries.length - 1];
if (last.idx !== idx - 1) throw new Error(`expected the last journal entry to be idx ${idx - 1}, found ${last.tag}`);
const prevFile = `drizzle/meta/${String(idx - 1).padStart(4, "0")}_snapshot.json`;
const prev = JSON.parse(fs.readFileSync(prevFile, "utf8"));
const template = prev.tables["public.spec_documents"];
if (!template) throw new Error(prevFile + " has no public.spec_documents to clone");
if (prev.tables["public.documents"]) throw new Error(prevFile + " already has public.documents");
const next = JSON.parse(JSON.stringify(prev));
next.id = crypto.randomUUID();
next.prevId = prev.id;
next.tables["public.documents"] = JSON.parse(JSON.stringify(template).split("spec_documents").join("documents"));
fs.writeFileSync(`drizzle/meta/${tag.slice(0, 4)}_snapshot.json`, JSON.stringify(next, null, 2) + "\n");
j.entries.push({ idx, version: "7", when: Math.max(Date.now(), last.when + 1), tag, breakpoints: true });
fs.writeFileSync(journalPath, JSON.stringify(j, null, 2) + "\n");
console.log(tag, "snapshot", next.id, "chained to", prev.id);
JS
```

Expected: `0028_documents snapshot <uuid> chained to <uuid>`, and `git diff --stat drizzle/meta/_journal.json` shows `7 +++++++`.

- [ ] **Step 7: Prove the snapshot matches the schema**

```bash
export PATH=$HOME/.local/node/bin:$PATH && env -u DATABASE_URL npx drizzle-kit generate 2>&1 | tail -1
```

Expected: `No schema changes, nothing to migrate 😴`. Any other output means the snapshot is wrong. Fix the snapshot, delete any generated SQL file, and never keep one.

- [ ] **Step 8: Prove the migration applies to a fresh database and re-applies as a no-op**

Never point this at `.data/pglite`. `ps aux | grep tsx | grep -v grep` must be empty first.

```bash
export PATH=$HOME/.local/node/bin:$PATH && D=$(mktemp -d) && F=$(ls drizzle/[0-9][0-9][0-9][0-9]_documents.sql) && env -u DATABASE_URL PGLITE_PATH="$D" MIG="$F" npx tsx -e '
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb } from "./src/db";
(async () => {
  const db = await getDb(); // opening PGlite runs migrate() — the first application
  for (const stmt of readFileSync(process.env.MIG!, "utf8").split("--> statement-breakpoint")) {
    if (stmt.trim()) await db.execute(sql.raw(stmt)); // the second application: every statement must be a no-op
  }
  const r = await db.execute(sql`select tgname from pg_trigger where tgname = ${"documents_seq_bump"}`);
  console.log("re-applied documents cleanly:", JSON.stringify((r as { rows?: unknown }).rows ?? r));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
'; rm -rf "$D"
```

Expected: `re-applied documents cleanly: [{"tgname":"documents_seq_bump"}]`

- [ ] **Step 9: Create the store**

Create `src/lib/stores/documents.ts`:

```ts
import { getDoc, insertWithPrefixedId, listDocsByField, patchDoc, softDeleteDoc } from "@/db/doc-store";
import { getSettings } from "@/lib/settings";
import { resolveDocumentCategories, type DocumentCategory } from "@/lib/document-categories";
import {
  filterDocuments,
  isVisibility,
  MAX_NOTES,
  MAX_TITLE,
  type DocumentFilter,
  type DocumentRecord,
  type DocumentSource,
  type DocumentVisibility,
} from "@/lib/document-rules";

/**
 * Documents (#218) — company / venue / project files. Server-only (the doc
 * store reaches PGlite/Postgres). Every document belongs to one company
 * (`customerId`, never changed after create); the bytes live in private
 * Vercel Blob at `blobPath` and are only ever read through the two download
 * routes. NOT syncable — written only by permission-checked server code.
 *
 * Callers validate scope (venue/project belong to the company) BEFORE they
 * write here — see resolveDocumentScope in src/lib/document-rules.ts and
 * finalizeDocumentUpload in src/lib/documents-upload.ts.
 */

const COLL = "documents" as const;

export type NewDocumentInput = {
  title: string;
  fileName: string;
  mime: string;
  size: number;
  blobPath: string;
  category: string;
  visibility: DocumentVisibility;
  source: DocumentSource;
  customerId: string;
  siteId: string | null;
  projectId: string | null;
  notes: string;
  uploadedBy: string;
  uploadedAt?: number;
};

/** What an edit may change. Never the company, never the file. */
export type DocumentPatch = {
  title?: string;
  category?: string;
  visibility?: DocumentVisibility;
  siteId?: string | null;
  projectId?: string | null;
  notes?: string;
};

function normalize(d: DocumentRecord): DocumentRecord {
  d.fileName = String(d.fileName ?? "") || "file";
  d.title = String(d.title ?? "") || d.fileName;
  d.mime = String(d.mime ?? "") || "application/octet-stream";
  d.size = Number(d.size) || 0;
  d.category = String(d.category ?? "") || "other";
  d.visibility = d.visibility === "shared" ? "shared" : "internal";
  d.source = d.source === "customer" ? "customer" : "team";
  d.siteId = d.siteId || null;
  d.projectId = d.projectId || null;
  d.notes = String(d.notes ?? "");
  d.uploadedBy = String(d.uploadedBy ?? "");
  d.uploadedAt = Number(d.uploadedAt) || 0;
  d.seenByTeamAt = d.seenByTeamAt == null ? null : Number(d.seenByTeamAt);
  return d;
}

/** Mint `DOC-####` (from DOC-1000) and insert, retrying on an id collision. */
export async function createDocument(input: NewDocumentInput): Promise<DocumentRecord> {
  const at = input.uploadedAt ?? Date.now();
  const doc = await insertWithPrefixedId<DocumentRecord>(COLL, "DOC", 999, (id) => ({
    id,
    title: input.title.trim().slice(0, MAX_TITLE) || input.fileName,
    fileName: input.fileName,
    mime: input.mime,
    size: input.size,
    blobPath: input.blobPath,
    category: input.category,
    visibility: input.visibility,
    source: input.source,
    customerId: input.customerId,
    siteId: input.siteId,
    projectId: input.projectId,
    notes: input.notes.slice(0, MAX_NOTES),
    uploadedBy: input.uploadedBy,
    uploadedAt: at,
    // Team uploads are born seen; a customer upload waits for the team.
    seenByTeamAt: input.source === "customer" ? null : at,
  }));
  return normalize(doc);
}

export async function getDocument(id: string): Promise<DocumentRecord | null> {
  if (!id) return null;
  const d = await getDoc<DocumentRecord>(COLL, id);
  return d && !d.deleted ? normalize(d) : null;
}

/** One company's documents, newest first, optionally scoped. */
export async function documentsForCustomer(
  customerId: string,
  filter: Omit<DocumentFilter, "customerId"> = {}
): Promise<DocumentRecord[]> {
  if (!customerId) return [];
  const rows = (await listDocsByField<DocumentRecord>(COLL, "customerId", [customerId])).map(normalize);
  return filterDocuments(rows, { ...filter, customerId }).sort((a, b) => b.uploadedAt - a.uploadedAt);
}

/** The live document already recording this blob, if any (finalize refuses a replay). */
export async function documentByBlobPath(blobPath: string): Promise<DocumentRecord | null> {
  if (!blobPath) return null;
  const [d] = await listDocsByField<DocumentRecord>(COLL, "blobPath", [blobPath]);
  return d && !d.deleted ? normalize(d) : null;
}

export async function updateDocument(id: string, patch: DocumentPatch): Promise<DocumentRecord | null> {
  if (!(await getDocument(id))) return null;
  const next = await patchDoc<DocumentRecord>(COLL, id, (d) => {
    if (typeof patch.title === "string") {
      const t = patch.title.trim().slice(0, MAX_TITLE);
      if (t) d.title = t;
    }
    if (typeof patch.category === "string" && patch.category) d.category = patch.category;
    if (isVisibility(patch.visibility)) d.visibility = patch.visibility;
    if (patch.siteId !== undefined) d.siteId = patch.siteId || null;
    if (patch.projectId !== undefined) d.projectId = patch.projectId || null;
    if (typeof patch.notes === "string") d.notes = patch.notes.trim().slice(0, MAX_NOTES);
  });
  return next ? normalize(next) : null;
}

/** Soft delete. Returns the removed record so the caller can delete its blob. */
export async function removeDocument(id: string): Promise<DocumentRecord | null> {
  const current = await getDocument(id);
  if (!current) return null;
  await patchDoc<DocumentRecord>(COLL, id, (d) => {
    d.deleted = true;
  });
  await softDeleteDoc(COLL, id);
  return current;
}

/** Stamp unseen CUSTOMER uploads as seen. Returns how many changed. */
export async function markSeen(ids: readonly string[], at: number = Date.now()): Promise<number> {
  let n = 0;
  for (const id of [...new Set(ids)]) {
    const d = await getDocument(id);
    if (!d || d.source !== "customer" || d.seenByTeamAt != null) continue;
    const next = await patchDoc<DocumentRecord>(COLL, id, (x) => {
      x.seenByTeamAt = at;
    });
    if (next) n++;
  }
  return n;
}

/** "Mark seen" on a company's Documents card. */
export async function markCustomerSeen(customerId: string, at: number = Date.now()): Promise<number> {
  const fresh = (await documentsForCustomer(customerId)).filter((d) => d.source === "customer" && d.seenByTeamAt == null);
  return markSeen(fresh.map((d) => d.id), at);
}

/** Every unseen customer upload — the bell's input (one SQL-filtered read). */
export async function unseenCustomerDocuments(): Promise<DocumentRecord[]> {
  const rows = (await listDocsByField<DocumentRecord>(COLL, "source", ["customer"])).map(normalize);
  return rows.filter((d) => !d.deleted && d.seenByTeamAt == null);
}

/** Settings → Document categories, resolved (seed when never edited). */
export async function documentCategories(): Promise<DocumentCategory[]> {
  return resolveDocumentCategories((await getSettings()).documentCategories);
}
```

- [ ] **Step 10: Add the settings field**

In `src/lib/settings.ts`, replace this exact text:

```ts
  customerFieldDefs?: import("@/lib/customer-fields").CustomFieldDef[];
```

with:

```ts
  customerFieldDefs?: import("@/lib/customer-fields").CustomFieldDef[];
  /** Documents (#218) — the category list for company / venue / project
   *  files. FULL REPLACEMENT on save (the customerFieldDefs idiom);
   *  resolveDocumentCategories in lib/document-categories returns the seed
   *  when absent. Edited in Settings → Admin → Document categories. */
  documentCategories?: import("@/lib/document-categories").DocumentCategory[];
```

- [ ] **Step 11: The save action**

In `src/app/(app)/settings/actions.ts`, replace this exact text:

```ts
import type { DashboardLayout } from "@/lib/dashboard-layout";
import { savePipelines, moveStageRecords } from "@/lib/pipelines-server";
```

with:

```ts
import type { DashboardLayout } from "@/lib/dashboard-layout";
import { savePipelines, moveStageRecords } from "@/lib/pipelines-server";
import {
  mergeDocumentCategories,
  resolveDocumentCategories,
  type DocumentCategoryInput,
} from "@/lib/document-categories";
```

Then append to the end of `src/app/(app)/settings/actions.ts`:

```ts

/* ---- Document categories (#218) ---- */

/** Whole-list save of Settings → Admin → Document categories. Keys are
 *  minted here from the label and never change; dropped rows are archived
 *  (mergeDocumentCategories). Returns the refusal instead of throwing. */
export async function saveDocumentCategoriesAction(
  input: DocumentCategoryInput[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  const stored = resolveDocumentCategories((await getSettings()).documentCategories);
  const merged = mergeDocumentCategories(stored, input);
  if (!merged.ok) return merged;
  await setSettings({ documentCategories: merged.categories });
  revalidatePath("/", "layout");
  return { ok: true };
}
```

- [ ] **Step 12: The Settings card**

Create `src/app/(app)/settings/document-categories-card.tsx`:

```tsx
"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { OTHER_CATEGORY, type DocumentCategory } from "@/lib/document-categories";
import { saveDocumentCategoriesAction } from "./actions";

/**
 * Settings → Admin → Document categories (#218) — the CustomerFieldsCard
 * idiom: seeded from the server-resolved list, whole-list save, the server
 * validates and returns the refusal. Keys are minted server-side on first
 * save and shown read-only after (the parent keys this card by the saved
 * key set, so a save remounts it with the minted keys in place). Removing a
 * saved row is "Archived": old files keep their label, new uploads can't
 * pick it. Other can't be archived.
 */

type Row = { key: string; label: string; archived: boolean };

const inS: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "7px 10px",
  background: "#fff",
  outline: "none",
  width: "100%",
};

const iconBtn: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  color: "#5b616e",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 7,
  width: 28,
  height: 28,
  cursor: "pointer",
};

export function DocumentCategoriesCard({ categories }: { categories: DocumentCategory[] }) {
  const router = useRouter();
  const seed = (): Row[] => categories.map((c) => ({ key: c.key, label: c.label, archived: !!c.archived }));
  const [saved, setSaved] = useState<Row[]>(seed);
  const [rows, setRows] = useState<Row[]>(seed);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);

  const touch = () => {
    setJustSaved(false);
    setError(null);
  };
  const patch = (i: number, p: Partial<Row>) => {
    touch();
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    touch();
    setRows((rs) => {
      const next = rs.slice();
      const t = next[i];
      next[i] = next[j];
      next[j] = t;
      return next;
    });
  };
  const add = () => {
    touch();
    setRows((rs) => [...rs, { key: "", label: "", archived: false }]);
  };
  const drop = (i: number) => {
    touch();
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  };

  const onSave = () => {
    setError(null);
    startTransition(async () => {
      const r = await saveDocumentCategoriesAction(
        rows.map((x) => ({ key: x.key || undefined, label: x.label, archived: x.archived }))
      );
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSaved(rows);
      setJustSaved(true);
      router.refresh();
    });
  };

  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 18 }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Document categories</div>
        <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 4, lineHeight: 1.5 }}>
          How company, venue and project files are sorted — for the team and in the customer portal. Archive a
          category to stop new uploads using it; files already in it keep the label. Other can&apos;t be archived.
        </div>
      </div>
      {rows.map((r, i) => (
        <div
          key={r.key || `new-${i}`}
          style={{
            display: "grid",
            gridTemplateColumns: "28px 28px minmax(0,1fr) 120px 110px",
            gap: 8,
            alignItems: "center",
            padding: "9px 18px",
            borderBottom: "1px solid #f5f6f8",
            opacity: r.archived ? 0.6 : 1,
          }}
        >
          <button type="button" style={iconBtn} aria-label={`Move ${r.label || "category"} up`} disabled={i === 0} onClick={() => move(i, -1)}>
            ↑
          </button>
          <button type="button" style={iconBtn} aria-label={`Move ${r.label || "category"} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
            ↓
          </button>
          <input
            style={inS}
            value={r.label}
            maxLength={40}
            placeholder="Category name"
            aria-label="Category name"
            onChange={(e) => patch(i, { label: e.target.value })}
          />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#9aa0ab", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.key || "new"}
          </span>
          {r.key ? (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5b616e" }}>
              <input
                type="checkbox"
                checked={r.archived}
                disabled={r.key === OTHER_CATEGORY}
                onChange={(e) => patch(i, { archived: e.target.checked })}
              />
              Archived
            </label>
          ) : (
            <button type="button" className="pk-btn-outline" style={{ fontSize: 12 }} onClick={() => drop(i)}>
              Remove
            </button>
          )}
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", flexWrap: "wrap" }}>
        <button type="button" className="pk-btn-outline" onClick={add}>
          + Add category
        </button>
        <button type="button" className="pk-btn-accent" disabled={!dirty || pending} onClick={onSave}>
          {pending ? "Saving…" : "Save categories"}
        </button>
        {error && (
          <span role="alert" style={{ fontSize: 12, color: "#b03a2e" }}>
            {error}
          </span>
        )}
        {justSaved && !dirty && <span style={{ fontSize: 12, color: "#1f7a52" }}>Saved.</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 13: Wire the card into Settings**

In `src/app/(app)/settings/page.tsx`, replace this exact text:

```ts
import { resolveFieldDefs } from "@/lib/customer-fields";
```

with:

```ts
import { resolveFieldDefs } from "@/lib/customer-fields";
import { resolveDocumentCategories } from "@/lib/document-categories";
```

In the same file, replace this exact text:

```tsx
          customerFieldDefs={resolveFieldDefs(settings.customerFieldDefs)}
```

with:

```tsx
          customerFieldDefs={resolveFieldDefs(settings.customerFieldDefs)}
          documentCategories={resolveDocumentCategories(settings.documentCategories)}
```

In `src/app/(app)/settings/settings-client.tsx`, replace this exact text:

```ts
import { PipelinesCard } from "./pipelines-card";
```

with:

```ts
import { PipelinesCard } from "./pipelines-card";
import { DocumentCategoriesCard } from "./document-categories-card";
import type { DocumentCategory } from "@/lib/document-categories";
```

In the same file, replace this exact text:

```ts
  customerFieldDefs,
  pipelines,
  pipelineUsage,
```

with:

```ts
  customerFieldDefs,
  documentCategories,
  pipelines,
  pipelineUsage,
```

In the same file, replace this exact text:

```ts
  customerFieldDefs: CustomFieldDef[];
  /** Settings → Pipelines (Task 7). */
```

with:

```ts
  customerFieldDefs: CustomFieldDef[];
  /** #218 — Settings → Admin → Document categories (resolved, archived included). */
  documentCategories: DocumentCategory[];
  /** Settings → Pipelines (Task 7). */
```

In the same file, replace this exact text:

```tsx
          <CustomerFieldsCard
            key={customerFieldDefs.map((d) => d.id).join("|")}
            defs={customerFieldDefs}
          />
```

with:

```tsx
          <CustomerFieldsCard
            key={customerFieldDefs.map((d) => d.id).join("|")}
            defs={customerFieldDefs}
          />
          <DocumentCategoriesCard
            key={documentCategories.map((c) => c.key).join("|")}
            categories={documentCategories}
          />
```

- [ ] **Step 14: Run the gates**

```bash
export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit -p . && echo TSC_OK
```

Expected: `TSC_OK`.

```bash
export PATH=$HOME/.local/node/bin:$PATH && ps aux | grep -E "tsx|next dev" | grep -v grep; env -u DATABASE_URL npm run test:specs > "${TMPDIR:-/tmp}/d218-specs.log" 2>&1; tail -1 "${TMPDIR:-/tmp}/d218-specs.log"; grep '^FAIL' "${TMPDIR:-/tmp}/d218-specs.log" | head -5; grep -c '^PASS' "${TMPDIR:-/tmp}/d218-specs.log"; grep -c '^PASS #218' "${TMPDIR:-/tmp}/d218-specs.log"
```

Expected: `ALL PASSED`, no `FAIL`, and `#218` PASS count **75** (60 + 2 settings + 13 store).

```bash
export PATH=$HOME/.local/node/bin:$PATH && npx eslint src/lib/stores/documents.ts src/db/doc-tables.ts src/lib/settings.ts "src/app/(app)/settings/document-categories-card.tsx" "src/app/(app)/settings/actions.ts" "src/app/(app)/settings/page.tsx" "src/app/(app)/settings/settings-client.tsx"
```

Expected: 0 errors.

```bash
export PATH=$HOME/.local/node/bin:$PATH && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | tail -5; rm -rf .next
```

Expected: the build finishes with no `Error` line. The Settings card is a client file, so the client/server boundary is checked here.

- [ ] **Step 15: Commit**

```bash
export PATH=$HOME/.local/node/bin:$PATH && git add drizzle/ src/db/doc-tables.ts src/lib/stores/documents.ts src/lib/settings.ts "src/app/(app)/settings/document-categories-card.tsx" "src/app/(app)/settings/actions.ts" "src/app/(app)/settings/page.tsx" "src/app/(app)/settings/settings-client.tsx" scripts/test-review-and-spec.ts && git status --short drizzle/ && git commit -m "feat(documents): documents table + idempotent migration, store, categories setting (#218)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected from `git status --short drizzle/` before the commit: exactly three staged paths: `A  drizzle/<NNNN>_documents.sql`, `A  drizzle/meta/<NNNN>_snapshot.json` and `M  drizzle/meta/_journal.json`.

---

### Task 3: Team upload (token route + finalize) and download

**Files:**
- Create: `src/lib/documents-upload.ts`
- Create: `src/app/api/documents/upload/route.ts`
- Create: `src/app/api/documents/[id]/route.ts`
- Create: `src/app/(app)/documents/actions.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: Tasks 1–2; `getBlobHead`, `deleteBlob`, `getBlobStream`, `blobEnabled` (`src/lib/blob.ts`); `getCompany` (`src/lib/identity/companies.ts`); `sitesForCompany`, `docLocId` (`src/lib/identity/sites.ts`); `getProject` (`src/lib/stores/projects.ts`); `auth` (`@/auth`); `requireUser` (`src/lib/session.ts`).
- Produces:
  ```ts
  // src/lib/documents-upload.ts (server-only)
  export type FinalizeDocumentInput = { customerId?: string; uploadKey: string; blobPath: string; fileName: string;
    mime?: string; title?: string; category?: string; visibility?: string; siteId?: string | null;
    projectId?: string | null; notes?: string };
  export type DocumentActor = { kind: "team"; name: string } | { kind: "customer"; name: string; customerId: string };
  export type FinalizeResult = { ok: true; document: DocumentRecord } | { ok: false; error: string };
  export type FinalizeDeps = { head; remove; facts: (customerId: string, projectId: string | null) => Promise<DocumentScopeFacts>;
    categories: () => Promise<DocumentCategory[]> };
  export async function documentScopeFacts(customerId: string, projectId: string | null): Promise<DocumentScopeFacts>;
  export async function finalizeDocumentUpload(input: FinalizeDocumentInput, actor: DocumentActor, deps?: FinalizeDeps): Promise<FinalizeResult>;
  // src/app/(app)/documents/actions.ts ("use server")
  export async function finalizeTeamDocumentAction(input: FinalizeDocumentInput): Promise<{ ok: true } | { ok: false; error: string }>;
  export async function updateDocumentAction(id: string, patch: { title?; category?; visibility?; siteId?; projectId?; notes? }): Promise<…>;
  export async function deleteDocumentAction(id: string): Promise<…>;
  export async function markCustomerDocumentsSeenAction(customerId: string): Promise<…>;
  ```
- Routes: `POST /api/documents/upload` (the Blob `generate-client-token` step only) and `GET /api/documents/[id]`.

Precedent: route handlers are **not** called from the harness, because `requireUser()`/`auth()`/`cookies()` throw outside a request scope (see the `#207` fix-wave-2 comment near `partDocsUploadAsyncChecks`). All the logic lives in pure guards (Task 1) and in `finalizeDocumentUpload` with injectable `deps`, and both of those are tested directly. The route files are checked structurally.

- [ ] **Step 1: Write the failing test**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts

/* ======================================================================
   Documents (#218) — Task 3: finalize (DB-backed, fake Blob) + team routes.
   ====================================================================== */
import { finalizeDocumentUpload as d218Finalize, type FinalizeResult as D218FinalizeResult } from "@/lib/documents-upload";

{
  const src218t = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const up = src218t("src/app/api/documents/upload/route.ts");
  ok(up.includes("await auth()") && up.includes("parseUploadPayload(clientPayload)") && up.includes("getCompany(payload.customerId)") && up.includes("uploadGrantError(pathname, payload.customerId, payload.uploadKey)") && up.includes("maximumSizeInBytes: MAX_DOCUMENT_BYTES"), "#218 route: the team upload grant needs a user, a real company and a path under that company's upload key");
  const dl = src218t("src/app/api/documents/[id]/route.ts");
  ok(dl.includes("await requireUser()") && dl.includes("documentDownloadHeaders(doc.fileName)") && !dl.includes("inline"), "#218 route: team download requires a user and always sends an attachment");
  const act = src218t("src/app/(app)/documents/actions.ts");
  ok((act.match(/await requireUser\(\)/g) || []).length === 4 && act.includes('kind: "team"') && act.includes("resolveDocumentScope("), "#218 actions: every team document action requires a user; edits re-check scope");
}

async function documentsUploadAsyncChecks(): Promise<void> {
  const CO = fixtureId(218, "up-co");
  const OTHER = fixtureId(218, "up-other");
  const removed: string[] = [];
  const facts = async (customerId: string, projectId: string | null) => ({
    customerExists: customerId === CO || customerId === OTHER,
    siteIds: customerId === CO ? ["v1", "v2"] : ["o1"],
    project:
      projectId === "P-218" ? { id: "P-218", customerId: CO, locationId: "v2" }
      : projectId === "P-OTHER" ? { id: "P-OTHER", customerId: OTHER, locationId: "o1" }
      : null,
  });
  const deps = (bytes: Uint8Array | null, size = 2048) => ({
    head: async () => (bytes ? { bytes, size } : null),
    remove: async (p: string) => { removed.push(p); },
    facts,
    categories: async () => d218Resolve(undefined),
  });
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const pathFor = (cid: string, k: string, name = "plot.pdf") => d218Path(cid, k, name).replace(/\.pdf$/, "-Ab12Cd.pdf");
  const team = { kind: "team" as const, name: "Jeff" };
  const track = (r: D218FinalizeResult) => { if (r.ok) registerFixture("documents", r.document.id); return r; };

  const k1 = d218NewKey();
  const good = track(await d218Finalize({ customerId: CO, uploadKey: k1, blobPath: pathFor(CO, k1), fileName: "Stage plot.pdf", mime: "application/pdf", category: "drawings", visibility: "shared", siteId: "v1", notes: "rev B" }, team, deps(PDF)));
  ok(good.ok && good.document.source === "team" && good.document.visibility === "shared" && good.document.category === "drawings" && good.document.siteId === "v1" && good.document.size === 2048 && good.document.title === "Stage plot" && good.document.uploadedBy === "Jeff", "#218 upload: a team file under its own path is recorded with the size Blob reports");
  const again = await d218Finalize({ customerId: CO, uploadKey: k1, blobPath: pathFor(CO, k1), fileName: "Stage plot.pdf" }, team, deps(PDF));
  ok(!again.ok && !removed.includes(pathFor(CO, k1)), "#218 upload: finalizing an already-recorded blob is refused and never deletes it");
  const k2 = d218NewKey();
  const foreign = await d218Finalize({ customerId: CO, uploadKey: k2, blobPath: pathFor(OTHER, k2), fileName: "x.pdf" }, team, deps(PDF));
  ok(!foreign.ok && removed.length === 0, "#218 upload: a path under another company is refused without touching it");
  const k3 = d218NewKey();
  const exe = await d218Finalize({ customerId: CO, uploadKey: k3, blobPath: pathFor(CO, k3, "notes.pdf"), fileName: "notes.pdf" }, team, deps(new Uint8Array([0x4d, 0x5a, 0x90])));
  ok(!exe.ok && exe.error.includes("program") && removed.includes(pathFor(CO, k3, "notes.pdf")), "#218 upload: program bytes behind an innocent name are refused and the blob deleted");
  const k4 = d218NewKey();
  const dbl = await d218Finalize({ customerId: CO, uploadKey: k4, blobPath: pathFor(CO, k4, "plan.pdf"), fileName: "plan.pdf.exe" }, team, deps(PDF));
  ok(!dbl.ok && removed.includes(pathFor(CO, k4, "plan.pdf")), "#218 upload: a double extension is refused and the blob deleted");
  const k5 = d218NewKey();
  const big = await d218Finalize({ customerId: CO, uploadKey: k5, blobPath: pathFor(CO, k5), fileName: "big.pdf" }, team, deps(PDF, d218Max + 1));
  ok(!big.ok && big.error.includes("100 MB") && removed.includes(pathFor(CO, k5)), "#218 upload: over 100 MB is refused and deleted");
  const k6 = d218NewKey();
  const missing = await d218Finalize({ customerId: CO, uploadKey: k6, blobPath: pathFor(CO, k6), fileName: "a.pdf" }, team, deps(null));
  ok(!missing.ok && missing.error.includes("didn't arrive"), "#218 upload: a blob that never arrived is refused");
  const k7 = d218NewKey();
  const proj = track(await d218Finalize({ customerId: CO, uploadKey: k7, blobPath: pathFor(CO, k7), fileName: "rigging.pdf", projectId: "P-218" }, team, deps(PDF)));
  ok(proj.ok && proj.document.projectId === "P-218" && proj.document.siteId === "v2" && proj.document.visibility === "internal" && proj.document.category === "other", "#218 upload: a project file takes the project's venue; visibility defaults Internal, category Other");
  const k8 = d218NewKey();
  const wrongProj = await d218Finalize({ customerId: CO, uploadKey: k8, blobPath: pathFor(CO, k8), fileName: "a.pdf", projectId: "P-OTHER" }, team, deps(PDF));
  ok(!wrongProj.ok && removed.includes(pathFor(CO, k8)), "#218 upload: a project of another company is refused and the blob deleted");
  const k9 = d218NewKey();
  const portal = track(await d218Finalize({ customerId: OTHER, uploadKey: k9, blobPath: pathFor(CO, k9), fileName: "Signed form.pdf", visibility: "internal", projectId: "P-218", siteId: "v1", category: "forms" }, { kind: "customer", name: "Pat Customer", customerId: CO }, deps(PDF)));
  ok(portal.ok && portal.document.customerId === CO && portal.document.source === "customer" && portal.document.visibility === "shared" && portal.document.projectId === null && portal.document.siteId === "v1" && portal.document.seenByTeamAt === null && portal.document.uploadedBy === "Pat Customer", "#218 upload: a portal upload is the session's company, Shared, From customer, unseen, never on a project");
  const k10 = d218NewKey();
  const portalForeign = await d218Finalize({ uploadKey: k10, blobPath: pathFor(OTHER, k10), fileName: "a.pdf" }, { kind: "customer", name: "Pat", customerId: CO }, deps(PDF));
  ok(!portalForeign.ok && !removed.includes(pathFor(OTHER, k10)), "#218 upload: a portal session can never finalize (or delete) another company's path");
  const k11 = d218NewKey();
  const portalSite = await d218Finalize({ uploadKey: k11, blobPath: pathFor(CO, k11), fileName: "a.pdf", siteId: "o1" }, { kind: "customer", name: "Pat", customerId: CO }, deps(PDF));
  ok(!portalSite.ok, "#218 upload: a portal upload to another company's venue is refused");
  const k12 = d218NewKey();
  const down = await d218Finalize({ customerId: CO, uploadKey: k12, blobPath: pathFor(CO, k12), fileName: "a.pdf" }, team, { ...deps(PDF), head: async () => { throw new Error("BlobError: ECONNREFUSED 127.0.0.1:443"); } });
  ok(!down.ok && down.error === "Couldn't read the uploaded file — try again.", "#218 upload: a Blob read failure is a generic refusal, never the vendor's text");
}
```

Then register it on the chain. In `scripts/test-review-and-spec.ts`, replace this exact text:

```ts
  .then(() => documentsStoreAsyncChecks())
```

with:

```ts
  .then(() => documentsStoreAsyncChecks())
  .then(() => documentsUploadAsyncChecks())
```

- [ ] **Step 2: Run it to verify it fails**

```bash
export PATH=$HOME/.local/node/bin:$PATH && env -u DATABASE_URL npm run test:specs 2>&1 | grep -m1 -iE 'cannot find module|ENOENT'
```

Expected: `Error: Cannot find module '@/lib/documents-upload'`.

- [ ] **Step 3: Create `src/lib/documents-upload.ts`**

```ts
import { deleteBlob, getBlobHead } from "@/lib/blob";
import { getCompany } from "@/lib/identity/companies";
import { docLocId, sitesForCompany } from "@/lib/identity/sites";
import { getProject } from "@/lib/stores/projects";
import { createDocument, documentByBlobPath, documentCategories } from "@/lib/stores/documents";
import { uploadCategory, type DocumentCategory } from "@/lib/document-categories";
import {
  blobPathInScope,
  blockedExtension,
  checkDocumentBytes,
  displayFileName,
  DOCUMENT_SNIFF_BYTES,
  isUploadKey,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_LABEL,
} from "@/lib/document-files";
import {
  cleanMime,
  cleanNotes,
  cleanTitle,
  isVisibility,
  resolveDocumentScope,
  type DocumentRecord,
  type DocumentScopeFacts,
} from "@/lib/document-rules";

/**
 * Documents (#218) — the ONE place an uploaded blob becomes a document, for
 * the team and the portal alike. Server-only.
 *
 * The browser uploaded straight to private Blob under
 * `documents/<customer>/<uploadKey>/…` (a token route checked that path
 * first). Here, in order:
 *   1. the company comes from the actor for a portal user (never the input),
 *   2. the client-supplied path must sit under that company's upload key,
 *   3. a path already recorded on a document is refused — and never deleted,
 *   4. venue/project must belong to the company (resolveDocumentScope),
 *   5. the name must not be a program/script,
 *   6. the head Blob holds is read back: size ≤ 100 MB, no program bytes,
 *   7. only then is the record written.
 * A refusal after step 3 deletes the blob: it is provably the caller's own,
 * unrecorded upload. `deps` exists for the spec harness.
 */

export type FinalizeDocumentInput = {
  customerId?: string;
  uploadKey: string;
  blobPath: string;
  fileName: string;
  mime?: string;
  title?: string;
  category?: string;
  visibility?: string;
  siteId?: string | null;
  projectId?: string | null;
  notes?: string;
};

export type DocumentActor = { kind: "team"; name: string } | { kind: "customer"; name: string; customerId: string };

export type FinalizeResult = { ok: true; document: DocumentRecord } | { ok: false; error: string };

export type FinalizeDeps = {
  head: (pathname: string, max: number) => Promise<{ bytes: Uint8Array; size: number } | null>;
  remove: (pathname: string) => Promise<void>;
  facts: (customerId: string, projectId: string | null) => Promise<DocumentScopeFacts>;
  categories: () => Promise<DocumentCategory[]>;
};

/** Does the company exist, which venues are its, and whose is the project? */
export async function documentScopeFacts(customerId: string, projectId: string | null): Promise<DocumentScopeFacts> {
  const [co, sites, project] = await Promise.all([
    getCompany(customerId),
    sitesForCompany(customerId),
    projectId ? getProject(projectId) : Promise.resolve(null),
  ]);
  return {
    customerExists: !!co,
    siteIds: sites.map(docLocId),
    project: project ? { id: project.id, customerId: project.customerId, locationId: project.locationId } : null,
  };
}

const liveDeps: FinalizeDeps = {
  head: getBlobHead,
  remove: deleteBlob,
  facts: documentScopeFacts,
  categories: documentCategories,
};

export async function finalizeDocumentUpload(
  input: FinalizeDocumentInput,
  actor: DocumentActor,
  deps: FinalizeDeps = liveDeps
): Promise<FinalizeResult> {
  const customerId = actor.kind === "customer" ? actor.customerId : String(input.customerId ?? "").trim();
  if (!customerId) return { ok: false, error: "Pick a company first." };
  const uploadKey = input.uploadKey;
  if (!isUploadKey(uploadKey) || !blobPathInScope(input.blobPath, customerId, uploadKey)) {
    return { ok: false, error: "That upload does not belong to this company." };
  }
  const blobPath = input.blobPath;
  // Never touch a blob a document already records — it may be someone
  // else's real file (the whole point of replaying its path), or a retry.
  if (await documentByBlobPath(blobPath)) return { ok: false, error: "That file is already saved." };

  const refuse = async (error: string): Promise<FinalizeResult> => {
    try {
      await deps.remove(blobPath);
    } catch {
      /* best effort — the refusal stands either way */
    }
    return { ok: false, error };
  };

  const projectId = actor.kind === "customer" ? null : String(input.projectId ?? "").trim() || null;
  const scope = resolveDocumentScope({ siteId: input.siteId, projectId }, customerId, await deps.facts(customerId, projectId));
  if (!scope.ok) return refuse(scope.error);

  const fileName = displayFileName(input.fileName);
  if (blockedExtension(fileName)) return refuse(`${fileName} is a program or script — those can't be uploaded.`);

  let head: { bytes: Uint8Array; size: number } | null;
  try {
    head = await deps.head(blobPath, DOCUMENT_SNIFF_BYTES);
  } catch {
    // A Blob read failure is not "never arrived" — and the vendor's own
    // error text never reaches the browser.
    return { ok: false, error: "Couldn't read the uploaded file — try again." };
  }
  if (!head) return { ok: false, error: "The upload didn't arrive — try again." };
  if (!(head.size > 0)) return refuse(`${fileName} is empty.`);
  if (head.size > MAX_DOCUMENT_BYTES) return refuse(`${fileName} is over ${MAX_DOCUMENT_LABEL}.`);
  const magic = checkDocumentBytes(head.bytes);
  if (magic) return refuse(magic);

  const categories = await deps.categories();
  const document = await createDocument({
    title: cleanTitle(input.title, fileName),
    fileName,
    mime: cleanMime(input.mime),
    size: head.size,
    blobPath,
    category: uploadCategory(categories, input.category),
    visibility: actor.kind === "customer" ? "shared" : isVisibility(input.visibility) ? input.visibility : "internal",
    source: actor.kind === "customer" ? "customer" : "team",
    customerId,
    siteId: scope.siteId,
    projectId: scope.projectId,
    notes: cleanNotes(input.notes),
    uploadedBy: actor.name || (actor.kind === "customer" ? "Customer" : "Team"),
  });
  return { ok: true, document };
}
```

- [ ] **Step 4: The team token route**

Create `src/app/api/documents/upload/route.ts`:

```ts
import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/auth";
import { blobEnabled } from "@/lib/blob";
import { getCompany } from "@/lib/identity/companies";
import { MAX_DOCUMENT_BYTES, parseUploadPayload, uploadGrantError } from "@/lib/document-files";

// Token minting only — no bytes pass through this function.
export const maxDuration = 30;

/**
 * Vercel Blob client-upload broker for team documents (#218) — the #207
 * part-documents route's pattern. Only `blob.generate-client-token` is
 * handled (no onUploadCompleted, so no callback and no middleware
 * exemption). The grant is for ONE path: `documents/<company>/<uploadKey>/…`
 * of a company that exists. Any file type up to 100 MB is allowed here; the
 * finalize action (finalizeTeamDocumentAction → finalizeDocumentUpload)
 * re-checks the real bytes before anything is recorded.
 */

class UploadRefused extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
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
        const payload = parseUploadPayload(clientPayload);
        if (!payload) throw new UploadRefused(400, "clientPayload must be {customerId, uploadKey}");
        if (!(await getCompany(payload.customerId))) throw new UploadRefused(404, "That company no longer exists.");
        const bad = uploadGrantError(pathname, payload.customerId, payload.uploadKey);
        if (bad) throw new UploadRefused(400, bad);
        return {
          maximumSizeInBytes: MAX_DOCUMENT_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify(payload),
        };
      },
    });
    return NextResponse.json(json);
  } catch (e) {
    if (e instanceof UploadRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    // Anything else (a BlobError, a network failure inside handleUpload) is
    // never shown to the browser — only our own refusals are.
    return NextResponse.json({ error: "Upload could not be authorized." }, { status: 400 });
  }
}
```

- [ ] **Step 5: The team download route**

Create `src/app/api/documents/[id]/route.ts`:

```ts
import { requireUser } from "@/lib/session";
import { getBlobStream } from "@/lib/blob";
import { documentDownloadHeaders } from "@/lib/document-files";
import { getDocument, markSeen } from "@/lib/stores/documents";

/**
 * Team document download (#218). Signed-in only. Streams the private blob
 * as `application/octet-stream` + `attachment` + `nosniff` + `no-store` —
 * never rendered by the browser, whatever the file really is. Opening a
 * customer upload marks it seen (it leaves the to-do bell).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await ctx.params; // already decoded by Next's router
  const doc = await getDocument(id);
  if (!doc) return new Response("Not found", { status: 404, headers: { "cache-control": "private, no-store" } });
  let stream: ReadableStream | null;
  try {
    stream = await getBlobStream(doc.blobPath);
  } catch {
    // Never surface the Blob vendor's own error text.
    return new Response("Couldn't read the file — try again", { status: 502, headers: { "cache-control": "private, no-store" } });
  }
  if (!stream) return new Response("File missing from storage", { status: 404, headers: { "cache-control": "private, no-store" } });
  if (doc.source === "customer" && doc.seenByTeamAt == null) await markSeen([doc.id]);
  return new Response(stream, { headers: documentDownloadHeaders(doc.fileName) });
}
```

- [ ] **Step 6: The team actions**

Create `src/app/(app)/documents/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { deleteBlob } from "@/lib/blob";
import { normalizeCategory } from "@/lib/document-categories";
import { isVisibility, resolveDocumentScope } from "@/lib/document-rules";
import { documentScopeFacts, finalizeDocumentUpload, type FinalizeDocumentInput } from "@/lib/documents-upload";
import {
  documentCategories,
  getDocument,
  markCustomerSeen,
  removeDocument,
  updateDocument,
} from "@/lib/stores/documents";

/**
 * Team document actions (#218) — used by the Documents card on the company,
 * venue and project pages (src/components/documents/documents-card-client.tsx).
 * Every action requires a signed-in user. The company is never taken from
 * the browser for an edit or delete — it is the stored document's; an
 * upload's company must exist and own the path (finalizeDocumentUpload).
 * This route folder has no page on purpose — actions only.
 */

type Result = { ok: true } | { ok: false; error: string };

function revalidate(): void {
  // The card lives on three pages and the bell on every page.
  revalidatePath("/", "layout");
}

export async function finalizeTeamDocumentAction(input: FinalizeDocumentInput): Promise<Result> {
  const user = await requireUser();
  const r = await finalizeDocumentUpload(input, { kind: "team", name: user.name });
  if (!r.ok) return r;
  revalidate();
  return { ok: true };
}

export async function updateDocumentAction(
  id: string,
  patch: {
    title?: string;
    category?: string;
    visibility?: string;
    siteId?: string | null;
    projectId?: string | null;
    notes?: string;
  }
): Promise<Result> {
  await requireUser();
  const doc = await getDocument(String(id || ""));
  if (!doc) return { ok: false, error: "That document was deleted." };
  const siteId = patch.siteId !== undefined ? patch.siteId : doc.siteId;
  const projectId = patch.projectId !== undefined ? patch.projectId : doc.projectId;
  const facts = await documentScopeFacts(doc.customerId, projectId || null);
  const scope = resolveDocumentScope({ siteId, projectId }, doc.customerId, facts);
  if (!scope.ok) return scope;
  const categories = await documentCategories();
  const next = await updateDocument(doc.id, {
    title: typeof patch.title === "string" ? patch.title : undefined,
    category: patch.category !== undefined ? normalizeCategory(categories, patch.category) : undefined,
    visibility: isVisibility(patch.visibility) ? patch.visibility : undefined,
    siteId: scope.siteId,
    projectId: scope.projectId,
    notes: typeof patch.notes === "string" ? patch.notes : undefined,
  });
  if (!next) return { ok: false, error: "That document was deleted." };
  revalidate();
  return { ok: true };
}

export async function deleteDocumentAction(id: string): Promise<Result> {
  await requireUser();
  const removed = await removeDocument(String(id || ""));
  if (!removed) return { ok: false, error: "That document was already deleted." };
  try {
    await deleteBlob(removed.blobPath);
  } catch {
    /* the record is gone either way; an orphaned private blob is harmless */
  }
  revalidate();
  return { ok: true };
}

export async function markCustomerDocumentsSeenAction(customerId: string): Promise<Result> {
  await requireUser();
  await markCustomerSeen(String(customerId || ""));
  revalidate();
  return { ok: true };
}
```

- [ ] **Step 7: Run the gates**

```bash
export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit -p . && echo TSC_OK
```

Expected: `TSC_OK`.

```bash
export PATH=$HOME/.local/node/bin:$PATH && ps aux | grep -E "tsx|next dev" | grep -v grep; env -u DATABASE_URL npm run test:specs > "${TMPDIR:-/tmp}/d218-specs.log" 2>&1; tail -1 "${TMPDIR:-/tmp}/d218-specs.log"; grep '^FAIL' "${TMPDIR:-/tmp}/d218-specs.log" | head -5; grep -c '^PASS' "${TMPDIR:-/tmp}/d218-specs.log"; grep -c '^PASS #218' "${TMPDIR:-/tmp}/d218-specs.log"
```

Expected: `ALL PASSED`, no `FAIL`, and `#218` PASS count **91** (75 + 3 structural + 13 finalize).

```bash
export PATH=$HOME/.local/node/bin:$PATH && npx eslint src/lib/documents-upload.ts src/app/api/documents/upload/route.ts "src/app/api/documents/[id]/route.ts" "src/app/(app)/documents/actions.ts"
```

Expected: 0 errors.

```bash
export PATH=$HOME/.local/node/bin:$PATH && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | tail -5; rm -rf .next
```

Expected: the build succeeds, and the route table lists `/api/documents/upload` and `/api/documents/[id]`.

- [ ] **Step 8: Commit**

```bash
export PATH=$HOME/.local/node/bin:$PATH && git add src/lib/documents-upload.ts src/app/api/documents/upload/route.ts "src/app/api/documents/[id]/route.ts" "src/app/(app)/documents/actions.ts" scripts/test-review-and-spec.ts && git commit -m "feat(documents): team upload grant, checked finalize, attachment-only download (#218)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Team UI — Documents card (company, venue, project tab) + the to-do bell

**Files:**
- Create: `src/components/documents/upload-client.ts`
- Create: `src/components/documents/documents-card.tsx`
- Create: `src/components/documents/documents-card-client.tsx`
- Modify: `src/app/(app)/companies/[id]/page.tsx`
- Modify: `src/app/(app)/venues/[id]/page.tsx`
- Modify: `src/app/(app)/projects/view.tsx`
- Modify: `src/lib/stores/notif-prefs.ts`
- Modify: `src/lib/nav-counts.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: Tasks 1–3. Also `get` from `src/lib/stores/customers.ts` (its `locations[].id` is `docLocId`), `getAllProjects` from `src/lib/stores/projects.ts`, `blobEnabled`, `ConfirmButton`, `shortDate` (`src/lib/format.ts`) and `nameFor` from `src/lib/stores/customers.ts`.
- Produces:
  ```ts
  // upload-client.ts (browser; imported only by client components)
  export type PutResult = { ok: true; uploadKey: string; pathname: string } | { ok: false; error: string };
  export async function putDocumentFile(file: File, opts: { customerId: string; handleUploadUrl: string }): Promise<PutResult>;
  // documents-card.tsx (server component)
  export async function DocumentsCard(props: { customerId: string | null; siteId?: string | null; projectId?: string | null }): Promise<JSX.Element | null>;
  // documents-card-client.tsx ("use client")
  export function DocumentsCardClient(props: DocumentsCardProps): JSX.Element;
  ```
- Bell: notif category key `"documents"`, group label "New documents from customers", one item per company, `href = /companies/<id>#documents` (the card's root has `id="documents"`).

- [ ] **Step 1: Write the failing test**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts

/* ======================================================================
   Documents (#218) — Task 4: team screens + the to-do bell (structural).
   ====================================================================== */
{
  const src218u = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  ok(src218u("src/app/(app)/companies/[id]/page.tsx").includes("<DocumentsCard customerId={cust.id} />"), "#218 UI: the company page shows the Documents card");
  ok(src218u("src/app/(app)/venues/[id]/page.tsx").includes("<DocumentsCard customerId={site.companyId} siteId={locationId} />"), "#218 UI: the venue page shows the card scoped to the venue");
  const view218 = src218u("src/app/(app)/projects/view.tsx");
  ok((view218.match(/\["documents", "Documents", 0\]/g) || []).length === 2 && view218.includes("<DocumentsCard customerId={p.customerId} siteId={p.locationId} projectId={p.id} />"), "#218 UI: projects and orders gain a Documents tab");
  for (const f of ["src/components/documents/documents-card-client.tsx", "src/components/documents/upload-client.ts"]) {
    const s = src218u(f);
    ok(!/from "@\/lib\/stores\//.test(s) && !/from "@\/db\//.test(s) && !/from "@\/lib\/blob"/.test(s), `#218 UI: ${f} never imports a store, the DB or the Blob SDK's server half`);
  }
  ok(src218u("src/components/documents/documents-card-client.tsx").startsWith('"use client"') && src218u("src/components/documents/documents-card-client.tsx").includes('id="documents"'), "#218 UI: the client card is a client component and carries the bell's #documents anchor");
  ok(CATEGORIES.some((c) => c.key === "documents" && c.label === "New documents from customers"), "#218 bell: New documents from customers is a to-do category");
  ok(src218u("src/lib/nav-counts.ts").includes('push("documents", "New documents from customers"'), "#218 bell: nav-counts pushes one documents group");
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
export PATH=$HOME/.local/node/bin:$PATH && env -u DATABASE_URL npm run test:specs > "${TMPDIR:-/tmp}/d218-specs.log" 2>&1; grep -m3 -E '^FAIL #218|ENOENT' "${TMPDIR:-/tmp}/d218-specs.log"
```

Expected: `FAIL #218 UI: the company page shows the Documents card`, or an `ENOENT` for `src/components/documents/…`.

- [ ] **Step 3: The browser upload helper**

Create `src/components/documents/upload-client.ts`:

```ts
import { upload } from "@vercel/blob/client";
import { checkDocumentName, documentBlobPath, newUploadKey } from "@/lib/document-files";

/**
 * Browser half of a document upload (#218), shared by the team card and the
 * portal: preflight the name/size, mint an upload key, send the bytes
 * straight to private Blob through a token route (`/api/documents/upload`
 * for the team, `/portal/documents/upload` for a customer). The caller then
 * calls its finalize action with the returned key + pathname — the server
 * re-checks everything. Imported only by client components; everything it
 * imports is client-safe.
 */

export type PutResult = { ok: true; uploadKey: string; pathname: string } | { ok: false; error: string };

export async function putDocumentFile(
  file: File,
  opts: { customerId: string; handleUploadUrl: string }
): Promise<PutResult> {
  const refused = checkDocumentName(file.name, file.size);
  if (refused) return { ok: false, error: refused };
  const uploadKey = newUploadKey();
  try {
    const res = await upload(documentBlobPath(opts.customerId, uploadKey, file.name), file, {
      access: "private",
      handleUploadUrl: opts.handleUploadUrl,
      clientPayload: JSON.stringify({ customerId: opts.customerId, uploadKey }),
      contentType: file.type || "application/octet-stream",
      multipart: file.size > 5 * 1024 * 1024,
    });
    return { ok: true, uploadKey, pathname: res.pathname };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return {
      ok: false,
      error: /client token/i.test(msg)
        ? "Upload refused — file storage may not be configured, or your session ended."
        : msg || "Upload failed — try again.",
    };
  }
}
```

- [ ] **Step 4: The client card**

Create `src/components/documents/documents-card-client.tsx`:

```tsx
"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import type { DocumentOption, DocumentRowVM, DocumentVisibility } from "@/lib/document-rules";
import { checkDocumentName, formatBytes, MAX_DOCUMENT_LABEL } from "@/lib/document-files";
import { shortDate } from "@/lib/format";
import { putDocumentFile } from "./upload-client";
import {
  deleteDocumentAction,
  finalizeTeamDocumentAction,
  markCustomerDocumentsSeenAction,
  updateDocumentAction,
} from "@/app/(app)/documents/actions";

/**
 * The Documents card (#218) on the company page, the venue page and a
 * project's Documents tab. Everything it shows arrives as props from the
 * server wrapper (documents-card.tsx); everything it changes goes through
 * the team actions, which re-check the company, venue and project server-
 * side. Uploads go browser → private Blob (upload-client.ts) → finalize.
 * Downloads are always attachments (/api/documents/<id>).
 */

type CategoryOption = { key: string; label: string };

export type DocumentsCardProps = {
  customerId: string;
  scope: "company" | "venue" | "project";
  /** Venue scope: the venue. Project scope: the project's venue (or null). */
  fixedSiteId: string | null;
  fixedProjectId: string | null;
  rows: DocumentRowVM[];
  /** Active categories only — what an upload or edit may pick. */
  categories: CategoryOption[];
  venues: DocumentOption[];
  projects: DocumentOption[];
  blobOn: boolean;
};

type Queued = {
  id: string;
  file: File;
  category: string;
  visibility: DocumentVisibility;
  status: "ready" | "uploading" | "failed";
  error: string | null;
};

type Draft = {
  id: string;
  title: string;
  category: string;
  visibility: DocumentVisibility;
  siteId: string;
  projectId: string;
  notes: string;
};

const CARD: CSSProperties = {
  background: "#fff",
  border: "1px solid #ececf0",
  borderRadius: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
  marginBottom: 24,
  overflow: "hidden",
};
const HEAD: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  flexWrap: "wrap",
  padding: "14px 18px 12px",
  borderBottom: "1px solid #f0f1f4",
};
const SELECT: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "6px 8px",
  background: "#fff",
  maxWidth: "100%",
};
const INPUT: CSSProperties = { ...SELECT, width: "100%", padding: "7px 10px", fontSize: 12.5 };
const LINK_BTN: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--accent)",
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  textDecoration: "none",
};

function chip(ink: string, soft: string, bd: string): CSSProperties {
  return {
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: ".03em",
    textTransform: "uppercase",
    color: ink,
    background: soft,
    border: `1px solid ${bd}`,
    padding: "2px 7px",
    borderRadius: 5,
    whiteSpace: "nowrap",
  };
}

export function DocumentsCardClient({
  customerId,
  scope,
  fixedSiteId,
  fixedProjectId,
  rows,
  categories,
  venues,
  projects,
  blobOn,
}: DocumentsCardProps) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [venueF, setVenueF] = useState<string>("all");
  const [categoryF, setCategoryF] = useState<string>("all");
  const [visibilityF, setVisibilityF] = useState<"all" | DocumentVisibility>("all");
  const [queue, setQueue] = useState<Queued[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const visible = useMemo(
    () =>
      rows.filter((r) => {
        if (scope === "company" && venueF !== "all") {
          if (venueF === "none" ? r.siteId !== null : r.siteId !== venueF) return false;
        }
        if (categoryF !== "all" && r.category !== categoryF) return false;
        if (visibilityF !== "all" && r.visibility !== visibilityF) return false;
        return true;
      }),
    [rows, scope, venueF, categoryF, visibilityF]
  );

  const newCount = rows.filter((r) => r.isNew).length;
  // Company scope: each file gets the card's current venue filter as its venue.
  const uploadSiteId =
    scope === "company" ? (venueF !== "all" && venueF !== "none" ? venueF : null) : fixedSiteId;
  const uploadVenueLabel = uploadSiteId ? venues.find((v) => v.id === uploadSiteId)?.label ?? "" : "";
  const defaultCategory =
    categoryF !== "all" && categories.some((c) => c.key === categoryF) ? categoryF : "other";

  const pick = (list: FileList | null) => {
    if (!list || !list.length) return;
    setNotice(null);
    const added = [...list].map((file): Queued => {
      const refused = checkDocumentName(file.name, file.size);
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        category: defaultCategory,
        visibility: "internal",
        status: refused ? "failed" : "ready",
        error: refused,
      };
    });
    setQueue((q) => [...q, ...added]);
    if (fileInput.current) fileInput.current.value = "";
  };

  const setItem = (id: string, p: Partial<Queued>) =>
    setQueue((q) => q.map((x): Queued => (x.id === id ? { ...x, ...p } : x)));

  const uploadAll = async () => {
    const ready = queue.filter((q) => q.status === "ready");
    if (!ready.length) return;
    setBusy(true);
    setNotice(null);
    let saved = 0;
    for (const item of ready) {
      setItem(item.id, { status: "uploading", error: null });
      const put = await putDocumentFile(item.file, { customerId, handleUploadUrl: "/api/documents/upload" });
      const r = put.ok
        ? await finalizeTeamDocumentAction({
            customerId,
            uploadKey: put.uploadKey,
            blobPath: put.pathname,
            fileName: item.file.name,
            mime: item.file.type,
            category: item.category,
            visibility: item.visibility,
            siteId: uploadSiteId,
            projectId: fixedProjectId,
          })
        : put;
      if (r.ok) {
        saved++;
        setQueue((q) => q.filter((x) => x.id !== item.id));
      } else {
        setItem(item.id, { status: "failed", error: r.error });
      }
    }
    setBusy(false);
    if (saved) {
      setNotice(saved === 1 ? "1 file uploaded." : `${saved} files uploaded.`);
      router.refresh();
    }
  };

  const openEdit = (r: DocumentRowVM) => {
    setDraftError(null);
    setDraft({
      id: r.id,
      title: r.title,
      category: r.category,
      visibility: r.visibility,
      siteId: r.siteId ?? "",
      projectId: r.projectId ?? "",
      notes: r.notes,
    });
  };

  const saveEdit = async () => {
    if (!draft) return;
    setSaving(true);
    setDraftError(null);
    const r = await updateDocumentAction(draft.id, {
      title: draft.title,
      category: draft.category,
      visibility: draft.visibility,
      siteId: draft.siteId || null,
      projectId: draft.projectId || null,
      notes: draft.notes,
    });
    setSaving(false);
    if (!r.ok) {
      setDraftError(r.error);
      return;
    }
    setDraft(null);
    router.refresh();
  };

  const markSeen = async () => {
    const r = await markCustomerDocumentsSeenAction(customerId);
    if (r.ok) router.refresh();
  };

  const draftRow = draft ? rows.find((r) => r.id === draft.id) : undefined;
  const draftCategories =
    draft && !categories.some((c) => c.key === draft.category)
      ? [...categories, { key: draft.category, label: `${draftRow?.categoryLabel ?? draft.category} (archived)` }]
      : categories;
  const readyCount = queue.filter((q) => q.status === "ready").length;

  return (
    <div id="documents" style={CARD}>
      <div style={HEAD}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>Documents</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>{rows.length}</span>
          {newCount > 0 && (
            <>
              <span style={chip("#b4543a", "#f8ece7", "#eccfc4")}>{newCount} new from customer</span>
              <button type="button" style={LINK_BTN} onClick={markSeen}>
                Mark seen
              </button>
            </>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            aria-label="Choose files to upload"
            onChange={(e) => pick(e.target.files)}
          />
          <button
            type="button"
            className="pk-btn-accent"
            disabled={!blobOn || busy}
            title={blobOn ? `Any file up to ${MAX_DOCUMENT_LABEL}; programs and scripts are refused.` : "File storage isn't configured on this deployment."}
            onClick={() => fileInput.current?.click()}
          >
            + Upload
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "10px 18px", borderBottom: "1px solid #f5f6f8" }}>
        {scope === "company" && (
          <select style={SELECT} aria-label="Filter by venue" value={venueF} onChange={(e) => setVenueF(e.target.value)}>
            <option value="all">All venues</option>
            <option value="none">Company-wide only</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        )}
        <select style={SELECT} aria-label="Filter by category" value={categoryF} onChange={(e) => setCategoryF(e.target.value)}>
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          style={SELECT}
          aria-label="Filter by visibility"
          value={visibilityF}
          onChange={(e) => setVisibilityF(e.target.value as "all" | DocumentVisibility)}
        >
          <option value="all">Internal + shared</option>
          <option value="internal">Internal only</option>
          <option value="shared">Shared with customer</option>
        </select>
      </div>

      {!blobOn && (
        <div style={{ padding: "10px 18px", fontSize: 12, color: "#8a6d1f", background: "#fbf3dd", borderBottom: "1px solid #f0e2bd" }}>
          File storage isn&apos;t configured on this deployment, so uploads are off.
        </div>
      )}

      {queue.length > 0 && (
        <div style={{ padding: "12px 18px", borderBottom: "1px solid #f0f1f4", background: "#fafbfc" }}>
          <div style={{ fontSize: 11.5, color: "#5b616e", marginBottom: 8 }}>
            {"Uploading to " + (uploadVenueLabel || "company-wide") + (fixedProjectId ? " · this project" : "") + ` · up to ${MAX_DOCUMENT_LABEL} each`}
          </div>
          {queue.map((q) => (
            <div
              key={q.id}
              style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto auto", gap: 8, alignItems: "center", padding: "6px 0" }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {q.file.name}
                </div>
                <div style={{ fontSize: 11, color: q.error ? "#b03a2e" : "#9aa0ab" }}>
                  {q.error || (q.status === "uploading" ? "Uploading…" : formatBytes(q.file.size))}
                </div>
              </div>
              <select
                style={SELECT}
                aria-label={`Category for ${q.file.name}`}
                value={q.category}
                disabled={q.status === "uploading"}
                onChange={(e) => setItem(q.id, { category: e.target.value })}
              >
                {categories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
              <select
                style={SELECT}
                aria-label={`Visibility for ${q.file.name}`}
                value={q.visibility}
                disabled={q.status === "uploading"}
                onChange={(e) => setItem(q.id, { visibility: e.target.value as DocumentVisibility })}
              >
                <option value="internal">Internal</option>
                <option value="shared">Shared</option>
              </select>
              <button
                type="button"
                style={{ ...LINK_BTN, color: "#8c919c" }}
                aria-label={`Remove ${q.file.name}`}
                disabled={q.status === "uploading"}
                onClick={() => setQueue((all) => all.filter((x) => x.id !== q.id))}
              >
                ✕
              </button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" className="pk-btn-accent" disabled={busy || !readyCount} onClick={uploadAll}>
              {busy ? "Uploading…" : `Upload ${readyCount} file${readyCount === 1 ? "" : "s"}`}
            </button>
            <button type="button" className="pk-btn-outline" disabled={busy} onClick={() => setQueue([])}>
              Clear
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div role="status" style={{ padding: "8px 18px", fontSize: 12, color: "#1f7a52" }}>
          {notice}
        </div>
      )}

      {visible.map((r) => (
        <div
          key={r.id}
          style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, alignItems: "center", padding: "12px 18px", borderBottom: "1px solid #f5f6f8" }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                {r.title}
              </span>
              {r.visibility === "shared" ? (
                <span style={chip("#3155a8", "#e9eefb", "#d4ddf3")}>Shared</span>
              ) : (
                <span style={chip("#5b616e", "#f1f2f5", "#e4e7ec")}>Internal</span>
              )}
              {r.source === "customer" && <span style={chip("#8a6d1f", "#fbf3dd", "#f0e2bd")}>From customer</span>}
              {r.isNew && <span style={chip("#b4543a", "#f8ece7", "#eccfc4")}>New</span>}
            </div>
            <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 3 }}>
              {[
                r.categoryLabel,
                scope !== "venue" && r.siteLabel ? r.siteLabel : "",
                scope !== "project" && r.projectLabel ? r.projectLabel : "",
                r.sizeLabel,
                `${r.uploadedBy || "—"} · ${shortDate(r.uploadedAt)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
            {r.notes && <div style={{ fontSize: 11.5, color: "#5b616e", marginTop: 3, whiteSpace: "pre-wrap" }}>{r.notes}</div>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <a href={`/api/documents/${encodeURIComponent(r.id)}`} download style={LINK_BTN}>
              Download
            </a>
            <button type="button" style={LINK_BTN} onClick={() => openEdit(r)}>
              Edit
            </button>
            <ConfirmButton
              label="Delete"
              confirmLabel="Delete file?"
              onConfirm={async () => {
                const res = await deleteDocumentAction(r.id);
                if (!res.ok) throw new Error(res.error);
                router.refresh();
              }}
            />
          </div>
        </div>
      ))}
      {visible.length === 0 && (
        <div style={{ padding: "26px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
          {rows.length ? "Nothing matches these filters." : "No documents yet — drawings, show files, forms and photos live here."}
        </div>
      )}

      {draft && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Edit document"
          style={{ position: "fixed", inset: 0, background: "rgba(16,22,30,.46)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 60 }}
        >
          <div style={{ background: "#fff", borderRadius: 14, width: "min(520px, 100%)", maxHeight: "90vh", overflow: "auto", padding: "18px 20px" }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Edit document</div>
            <div style={{ display: "grid", gap: 10 }}>
              <label style={{ fontSize: 11.5, color: "#5b616e" }}>
                Title
                <input style={INPUT} maxLength={200} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </label>
              <label style={{ fontSize: 11.5, color: "#5b616e" }}>
                Category
                <select style={INPUT} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                  {draftCategories.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 11.5, color: "#5b616e" }}>
                Visibility
                <select style={INPUT} value={draft.visibility} onChange={(e) => setDraft({ ...draft, visibility: e.target.value as DocumentVisibility })}>
                  <option value="internal">Internal — team only</option>
                  <option value="shared">Shared — visible in the customer portal</option>
                </select>
              </label>
              <label style={{ fontSize: 11.5, color: "#5b616e" }}>
                Venue
                <select style={INPUT} value={draft.siteId} onChange={(e) => setDraft({ ...draft, siteId: e.target.value })}>
                  <option value="">Company-wide</option>
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 11.5, color: "#5b616e" }}>
                Project
                <select style={INPUT} value={draft.projectId} onChange={(e) => setDraft({ ...draft, projectId: e.target.value })}>
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 11.5, color: "#5b616e" }}>
                Notes
                <textarea
                  style={{ ...INPUT, minHeight: 70, resize: "vertical" }}
                  maxLength={2000}
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                />
              </label>
            </div>
            {draftError && (
              <div role="alert" style={{ fontSize: 12, color: "#b03a2e", marginTop: 10 }}>
                {draftError}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button type="button" className="pk-btn-outline" disabled={saving} onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="button" className="pk-btn-accent" disabled={saving} onClick={saveEdit}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: The server wrapper**

Create `src/components/documents/documents-card.tsx`:

```tsx
import { blobEnabled } from "@/lib/blob";
import { get as getCustomer } from "@/lib/stores/customers";
import { getAllProjects } from "@/lib/stores/projects";
import { documentCategories, documentsForCustomer } from "@/lib/stores/documents";
import { activeDocumentCategories } from "@/lib/document-categories";
import { documentRows } from "@/lib/document-rules";
import { DocumentsCardClient } from "./documents-card-client";

/**
 * <DocumentsCard customerId siteId? projectId?> (#218) — server component.
 * Company scope: every file of the company. Venue scope (siteId): files at
 * that venue, uploads default to it. Project scope (projectId): the
 * project's files, uploads default to the project and its venue (siteId is
 * then the project's venue, used only as the upload default). Loads
 * everything the client card needs and passes it as serializable props — the
 * client never sees a blob path.
 */
export async function DocumentsCard({
  customerId,
  siteId = null,
  projectId = null,
}: {
  customerId: string | null;
  siteId?: string | null;
  projectId?: string | null;
}) {
  if (!customerId) {
    return (
      <div
        id="documents"
        className="pk-card"
        style={{ padding: "22px 18px", marginBottom: 24, fontSize: 12.5, color: "#9aa0ab", textAlign: "center" }}
      >
        Link this project to a company to keep its documents.
      </div>
    );
  }
  const [cust, projects, categories, docs] = await Promise.all([
    getCustomer(customerId),
    getAllProjects(),
    documentCategories(),
    documentsForCustomer(customerId, projectId ? { projectId } : siteId ? { siteId } : {}),
  ]);
  if (!cust) return null;
  const venues = (cust.locations || []).flatMap((l) => (l.id ? [{ id: l.id, label: l.label || l.locationName || "Venue" }] : []));
  const custProjects = projects
    .filter((p) => p.customerId === customerId)
    .map((p) => ({ id: p.id, label: p.name || p.id }));
  return (
    <DocumentsCardClient
      customerId={customerId}
      scope={projectId ? "project" : siteId ? "venue" : "company"}
      fixedSiteId={siteId}
      fixedProjectId={projectId}
      rows={documentRows(docs, { categories, venues, projects: custProjects })}
      categories={activeDocumentCategories(categories).map((c) => ({ key: c.key, label: c.label }))}
      venues={venues}
      projects={custProjects}
      blobOn={blobEnabled()}
    />
  );
}
```

- [ ] **Step 6: Company page**

In `src/app/(app)/companies/[id]/page.tsx`, replace this exact text:

```ts
import { CustomerRecordingsCard } from "@/components/recordings/recordings-card";
```

with:

```ts
import { CustomerRecordingsCard } from "@/components/recordings/recordings-card";
import { DocumentsCard } from "@/components/documents/documents-card";
```

In the same file, replace this exact text:

```tsx
        {/* projects & orders */}
```

with:

```tsx
        {/* documents (#218) — company files; customer uploads show as New */}
        <DocumentsCard customerId={cust.id} />

        {/* projects & orders */}
```

- [ ] **Step 7: Venue page**

In `src/app/(app)/venues/[id]/page.tsx`, replace this exact text:

```ts
import VenueCalendarCard from "./calendar-card";
```

with:

```ts
import VenueCalendarCard from "./calendar-card";
import { DocumentsCard } from "@/components/documents/documents-card";
```

In the same file, replace this exact text:

```tsx
      {/* contacts */}
```

with:

```tsx
      {/* documents (#218) — this venue's files; uploads default to it */}
      <DocumentsCard customerId={site.companyId} siteId={locationId} />

      {/* contacts */}
```

- [ ] **Step 8: Project Documents tab**

In `src/app/(app)/projects/view.tsx`, replace this exact text:

```ts
import { TasksCard } from "@/components/tasks-card";
```

with:

```ts
import { TasksCard } from "@/components/tasks-card";
import { DocumentsCard } from "@/components/documents/documents-card";
```

In the same file, use Edit with **`replace_all: true`**. Replace this exact text, which appears twice (orders and installs):

```ts
        ["packet", "Handoff packet", 0],
        ["signoff", "Sign-off", 0],
```

with:

```ts
        ["packet", "Handoff packet", 0],
        ["documents", "Documents", 0],
        ["signoff", "Sign-off", 0],
```

In the same file, replace this exact text:

```tsx
        {curTab === "signoff" && <SignoffTab p={p} meta={meta} pipeline={pipeline} />}
```

with:

```tsx
        {curTab === "documents" && (
          <DocumentsCard customerId={p.customerId} siteId={p.locationId} projectId={p.id} />
        )}
        {curTab === "signoff" && <SignoffTab p={p} meta={meta} pipeline={pipeline} />}
```

- [ ] **Step 9: The bell category**

In `src/lib/stores/notif-prefs.ts`, replace this exact text:

```ts
  { key: "tasks",       label: "Tasks assigned to you or overdue", desc: "Open tasks assigned to you, plus any task past its due date." },
```

with:

```ts
  { key: "tasks",       label: "Tasks assigned to you or overdue", desc: "Open tasks assigned to you, plus any task past its due date." },
  { key: "documents",   label: "New documents from customers", desc: "Files customers sent through the portal that nobody on the team has opened yet." },
```

- [ ] **Step 10: The bell group**

In `src/lib/nav-counts.ts`, replace this exact text:

```ts
import { allTasks, taskBellItems, isOverdue } from "@/lib/stores/tasks";
```

with:

```ts
import { allTasks, taskBellItems, isOverdue } from "@/lib/stores/tasks";
import { unseenCustomerDocuments } from "@/lib/stores/documents";
import { nameFor as customerNameFor } from "@/lib/stores/customers";
import { customerUploadBell } from "@/lib/document-rules";
```

In the same file, replace this exact text:

```ts
    taskRows,
    prefs,
  ] = await Promise.all([
```

with:

```ts
    taskRows,
    prefs,
    unseenDocs,
  ] = await Promise.all([
```

In the same file, replace this exact text:

```ts
    allTasks(),
    getPrefs(me),
  ]);
```

with:

```ts
    allTasks(),
    getPrefs(me),
    // #218 — one SQL-filtered read (source = customer), usually empty.
    unseenCustomerDocuments(),
  ]);
```

In the same file, replace this exact text:

```ts
    href: t.projectId ? `/projects/${t.projectId}` : "/field-work",
    letter: "T",
    color: "#b45309",
  })));
```

with:

```ts
    href: t.projectId ? `/projects/${t.projectId}` : "/field-work",
    letter: "T",
    color: "#b45309",
  })));

  // #218 — one item per company with customer uploads nobody has opened;
  // downloading one (or "Mark seen" on the card) clears it.
  const docBell = customerUploadBell(unseenDocs);
  const docNames = await Promise.all(docBell.map((b) => customerNameFor(b.customerId)));
  push("documents", "New documents from customers", docBell.map((b, i) => ({
    id: "docs-" + b.customerId,
    title: docNames[i] || b.customerId,
    sub: b.count === 1 ? "1 new document" : `${b.count} new documents`,
    href: `/companies/${encodeURIComponent(b.customerId)}#documents`,
    letter: "D",
    color: "#3155a8",
  })));
```

- [ ] **Step 11: Run the gates**

```bash
export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit -p . && echo TSC_OK
```

Expected: `TSC_OK`.

```bash
export PATH=$HOME/.local/node/bin:$PATH && ps aux | grep -E "tsx|next dev" | grep -v grep; env -u DATABASE_URL npm run test:specs > "${TMPDIR:-/tmp}/d218-specs.log" 2>&1; tail -1 "${TMPDIR:-/tmp}/d218-specs.log"; grep '^FAIL' "${TMPDIR:-/tmp}/d218-specs.log" | head -5; grep -c '^PASS' "${TMPDIR:-/tmp}/d218-specs.log"; grep -c '^PASS #218' "${TMPDIR:-/tmp}/d218-specs.log"
```

Expected: `ALL PASSED`, no `FAIL`, and `#218` PASS count **99** (91 + 8 — the file loop asserts twice).

```bash
export PATH=$HOME/.local/node/bin:$PATH && npx eslint src/components/documents/upload-client.ts src/components/documents/documents-card.tsx src/components/documents/documents-card-client.tsx "src/app/(app)/companies/[id]/page.tsx" "src/app/(app)/venues/[id]/page.tsx" "src/app/(app)/projects/view.tsx" src/lib/stores/notif-prefs.ts src/lib/nav-counts.ts
```

Expected: 0 errors.

```bash
export PATH=$HOME/.local/node/bin:$PATH && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | tail -5; rm -rf .next
```

Expected: the build succeeds. If it fails with a `postgres`/`pglite`/`fs` module error traced to `documents-card-client.tsx`, a client file imported a server module. Fix the import, never the build config.

- [ ] **Step 12: Commit**

```bash
export PATH=$HOME/.local/node/bin:$PATH && git add src/components/documents/upload-client.ts src/components/documents/documents-card.tsx src/components/documents/documents-card-client.tsx "src/app/(app)/companies/[id]/page.tsx" "src/app/(app)/venues/[id]/page.tsx" "src/app/(app)/projects/view.tsx" src/lib/stores/notif-prefs.ts src/lib/nav-counts.ts scripts/test-review-and-spec.ts && git commit -m "feat(documents): Documents card on company, venue and project pages; bell for new customer uploads (#218)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Portal — Documents section, customer upload, scoped download

**Files:**
- Create: `src/app/portal/documents/upload/route.ts`
- Create: `src/app/portal/documents/[id]/route.ts`
- Create: `src/app/portal/documents-actions.ts`
- Create: `src/app/portal/document-upload.tsx`
- Create: `src/app/portal/documents-section.tsx`
- Modify: `src/app/portal/page.tsx`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `portalSession()` (`src/lib/portal.ts`, the ONLY source of a portal user's `customerId`), `finalizeDocumentUpload`, `portalCanSee`, `groupForPortal`, `documentsForCustomer`, `getDocument`, `putDocumentFile`, `documentDownloadHeaders`, `parseUploadKey`, `uploadGrantError`.
- Produces:
  - Routes: `POST /portal/documents/upload` (Blob token) and `GET /portal/documents/[id]`. Both sit under the existing `/portal` middleware exemption; `src/middleware.ts` is unchanged.
  - `finalizePortalDocumentAction(input: FinalizeDocumentInput): Promise<{ ok: true } | { ok: false; error: string }>` ("use server").
  - `PortalDocumentsSection` (server) and `PortalDocumentUpload` (client).

- [ ] **Step 1: Write the failing test**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts

/* ======================================================================
   Documents (#218) — Task 5: portal routes + section (structural; the
   access rule itself is portalCanSee, tested in Task 1, and the finalize
   path for a customer actor is tested in Task 3).
   ====================================================================== */
{
  const src218p = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const pup = src218p("src/app/portal/documents/upload/route.ts");
  ok(pup.includes("await portalSession()") && pup.includes("parseUploadKey(clientPayload)") && pup.includes("uploadGrantError(pathname, session.customerId, uploadKey)") && !pup.includes("payload.customerId") && !pup.includes("requireUser"), "#218 route: the portal upload grant takes the company from the session only");
  const pdl = src218p("src/app/portal/documents/[id]/route.ts");
  ok(pdl.includes("await portalSession()") && pdl.includes("portalCanSee(doc, session.customerId)") && pdl.includes("status: 404") && pdl.includes("documentDownloadHeaders(doc.fileName)") && !pdl.includes("requireUser"), "#218 route: portal download is scoped by portalCanSee and refuses with 404");
  const pact = src218p("src/app/portal/documents-actions.ts");
  ok(pact.startsWith('"use server"') && pact.includes("await portalSession()") && pact.includes('kind: "customer"') && pact.includes("customerId: session.customerId"), "#218 portal: finalize takes the company from the session");
  const pupc = src218p("src/app/portal/document-upload.tsx");
  ok(pupc.startsWith('"use client"') && !/from "@\/lib\/stores\//.test(pupc) && !/from "@\/lib\/portal"/.test(pupc) && pupc.includes('handleUploadUrl: "/portal/documents/upload"'), "#218 portal: the upload control is a client component that never imports a store or the session module");
  const ppage = src218p("src/app/portal/page.tsx");
  ok(ppage.includes("documentsForCustomer(cid, { portal: true })") && ppage.includes("<PortalDocumentsSection"), "#218 portal: the dashboard lists only portal-visible documents of the session's company");
  ok(src218p("src/middleware.ts").includes("|portal|"), "#218 portal: /portal routes stay outside the team login (existing exemption, unchanged)");
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
export PATH=$HOME/.local/node/bin:$PATH && env -u DATABASE_URL npm run test:specs 2>&1 | grep -m1 -E 'ENOENT|^FAIL #218'
```

Expected: `ENOENT: no such file or directory, open '…/src/app/portal/documents/upload/route.ts'`.

- [ ] **Step 3: The portal token route**

Create `src/app/portal/documents/upload/route.ts`:

```ts
import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { blobEnabled } from "@/lib/blob";
import { portalSession } from "@/lib/portal";
import { MAX_DOCUMENT_BYTES, parseUploadKey, uploadGrantError } from "@/lib/document-files";

// Token minting only — no bytes pass through this function.
export const maxDuration = 30;

/**
 * Vercel Blob client-upload broker for CUSTOMER uploads (#218). Lives under
 * /portal so it shares the portal's middleware exemption (customers have no
 * team session) and authenticates itself with portalSession() — the grant
 * cookie. The company comes from the session ONLY: the client payload is
 * read for its upload key and nothing else, and the path must sit under
 * `documents/<session company>/<uploadKey>/`. The portal finalize action
 * re-checks the bytes before anything is recorded.
 */

class UploadRefused extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
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
        const session = await portalSession();
        if (!session) throw new UploadRefused(401, "Your access link has expired — open the link we sent you again.");
        const uploadKey = parseUploadKey(clientPayload);
        if (!uploadKey) throw new UploadRefused(400, "clientPayload must carry an uploadKey");
        const bad = uploadGrantError(pathname, session.customerId, uploadKey);
        if (bad) throw new UploadRefused(400, bad);
        return {
          maximumSizeInBytes: MAX_DOCUMENT_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ customerId: session.customerId, uploadKey }),
        };
      },
    });
    return NextResponse.json(json);
  } catch (e) {
    if (e instanceof UploadRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Upload could not be authorized." }, { status: 400 });
  }
}
```

- [ ] **Step 4: The portal download route**

Create `src/app/portal/documents/[id]/route.ts`:

```ts
import { portalSession } from "@/lib/portal";
import { getBlobStream } from "@/lib/blob";
import { documentDownloadHeaders } from "@/lib/document-files";
import { portalCanSee } from "@/lib/document-rules";
import { getDocument } from "@/lib/stores/documents";

const NOT_FOUND = { status: 404, headers: { "cache-control": "private, no-store" } };

/**
 * Portal document download (#218). The portal session's company only, and
 * only a shared document or one the customer uploaded (portalCanSee — the
 * single rule). Every refusal is the same 404 — no session, unknown id,
 * another company's file, an internal file — so the route never confirms a
 * document exists. Always an attachment, never rendered.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await portalSession();
  const { id } = await ctx.params;
  const doc = session ? await getDocument(id) : null;
  if (!session || !doc || !portalCanSee(doc, session.customerId)) return new Response("Not found", NOT_FOUND);
  let stream: ReadableStream | null;
  try {
    stream = await getBlobStream(doc.blobPath);
  } catch {
    return new Response("Couldn't read the file — try again", { status: 502, headers: { "cache-control": "private, no-store" } });
  }
  if (!stream) return new Response("Not found", NOT_FOUND);
  return new Response(stream, { headers: documentDownloadHeaders(doc.fileName) });
}
```

- [ ] **Step 5: The portal finalize action**

Create `src/app/portal/documents-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { portalSession } from "@/lib/portal";
import { finalizeDocumentUpload, type FinalizeDocumentInput } from "@/lib/documents-upload";

/**
 * Portal document upload finalize (#218). SECURITY: runs for anonymous
 * visitors — authenticates via portalSession() and takes the company from
 * the session only. finalizeDocumentUpload forces a customer upload to
 * Shared / From customer / unseen / no project, and checks the path sits
 * under this company's upload key before it reads or deletes anything.
 */
export async function finalizePortalDocumentAction(
  input: FinalizeDocumentInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await portalSession();
  if (!session) return { ok: false, error: "Your access link has expired — open the link we sent you again." };
  const r = await finalizeDocumentUpload(
    { ...input, customerId: session.customerId, projectId: null, visibility: "shared" },
    { kind: "customer", name: session.name, customerId: session.customerId }
  );
  if (!r.ok) return r;
  revalidatePath("/portal");
  return { ok: true };
}
```

- [ ] **Step 6: The portal upload control**

Create `src/app/portal/document-upload.tsx`:

```tsx
"use client";

import { useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { checkDocumentName, MAX_DOCUMENT_LABEL } from "@/lib/document-files";
import { putDocumentFile } from "@/components/documents/upload-client";
import { finalizePortalDocumentAction } from "./documents-actions";

/**
 * Portal "Send us files" (#218). Files go browser → private Blob through
 * /portal/documents/upload, then finalizePortalDocumentAction records them.
 * The company is the portal session's (server-side); `customerId` here only
 * builds the upload path the server re-checks.
 */

const FIELD: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "8px 10px",
  background: "#fff",
  width: "100%",
};

export function PortalDocumentUpload({
  customerId,
  venues,
  categories,
  disabled,
}: {
  customerId: string;
  venues: Array<{ id: string; label: string }>;
  categories: Array<{ key: string; label: string }>;
  disabled: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [venue, setVenue] = useState("");
  const [category, setCategory] = useState("other");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (disabled) {
    return (
      <div style={{ padding: "14px 20px", fontSize: 12, color: "#9aa0ab" }}>Uploads are disabled in the team preview.</div>
    );
  }

  const pick = (list: FileList | null) => {
    setMsg(null);
    const chosen = list ? [...list] : [];
    const refused = chosen.map((f) => checkDocumentName(f.name, f.size)).filter((e): e is string => !!e);
    setFiles(chosen.filter((f) => !checkDocumentName(f.name, f.size)));
    if (refused.length) setMsg({ ok: false, text: refused.join(" ") });
  };

  const send = async () => {
    if (!files.length) return;
    setBusy(true);
    setMsg(null);
    let sent = 0;
    const errors: string[] = [];
    for (const f of files) {
      const put = await putDocumentFile(f, { customerId, handleUploadUrl: "/portal/documents/upload" });
      if (!put.ok) {
        errors.push(`${f.name}: ${put.error}`);
        continue;
      }
      const r = await finalizePortalDocumentAction({
        uploadKey: put.uploadKey,
        blobPath: put.pathname,
        fileName: f.name,
        mime: f.type,
        siteId: venue || null,
        category,
        notes: note,
      });
      if (r.ok) sent++;
      else errors.push(`${f.name}: ${r.error}`);
    }
    setBusy(false);
    setFiles([]);
    if (input.current) input.current.value = "";
    if (sent) setNote("");
    setMsg(
      errors.length
        ? { ok: false, text: errors.join(" · ") }
        : { ok: true, text: sent === 1 ? "Sent — our team has it." : `${sent} files sent — our team has them.` }
    );
    if (sent) router.refresh();
  };

  return (
    <div style={{ padding: "14px 20px", borderTop: "1px solid #f0f1f4", background: "#fafbfc" }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Send us files</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
        <input
          ref={input}
          type="file"
          multiple
          aria-label="Choose files"
          style={{ ...FIELD, padding: "6px 8px" }}
          onChange={(e) => pick(e.target.files)}
        />
        <select style={FIELD} aria-label="Venue" value={venue} onChange={(e) => setVenue(e.target.value)}>
          <option value="">Any venue / general</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
        <select style={FIELD} aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <textarea
        style={{ ...FIELD, marginTop: 8, minHeight: 56, resize: "vertical" }}
        maxLength={2000}
        placeholder="Add a note for our team (optional)"
        aria-label="Note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={busy || !files.length}
          onClick={send}
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            fontWeight: 600,
            color: "#fff",
            background: "var(--accent)",
            border: "none",
            borderRadius: 9,
            padding: "9px 14px",
            cursor: busy || !files.length ? "not-allowed" : "pointer",
            opacity: busy || !files.length ? 0.55 : 1,
          }}
        >
          {busy ? "Sending…" : files.length > 1 ? `Send ${files.length} files` : "Send file"}
        </button>
        <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>Any file up to {MAX_DOCUMENT_LABEL}. Programs and scripts can&apos;t be sent.</span>
      </div>
      {msg && (
        <div role={msg.ok ? "status" : "alert"} style={{ marginTop: 8, fontSize: 12.5, fontWeight: 600, color: msg.ok ? "#1f7a52" : "#b03a2e" }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: The portal Documents section**

Create `src/app/portal/documents-section.tsx`:

```tsx
import type { CSSProperties } from "react";
import type { PortalDocGroup } from "@/lib/document-rules";
import { formatBytes } from "@/lib/document-files";
import { PortalDocumentUpload } from "./document-upload";

/**
 * Portal Documents card (#218) — server component. `groups` is already
 * scoped by groupForPortal (the session's company; shared files + the
 * customer's own uploads; company-wide, then venue, then category). In the
 * team preview the links go to the team route and upload is off.
 */

const CARD: CSSProperties = {
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 14,
  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
  overflow: "hidden",
  marginBottom: 18,
};

const CARD_HEAD: CSSProperties = {
  padding: "15px 20px 12px",
  borderBottom: "1px solid #f0f1f4",
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 12,
};

function fmtDate(ms: number): string {
  return ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
}

export function PortalDocumentsSection({
  groups,
  preview,
  customerId,
  venues,
  categories,
  companyName,
}: {
  groups: PortalDocGroup[];
  preview: boolean;
  customerId: string;
  venues: Array<{ id: string; label: string }>;
  categories: Array<{ key: string; label: string }>;
  companyName: string;
}) {
  const count = groups.reduce((n, g) => n + g.categories.reduce((m, c) => m + c.docs.length, 0), 0);
  return (
    <div id="documents" style={CARD}>
      <div style={CARD_HEAD}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Documents</div>
        <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>
          {count ? `${count} file${count === 1 ? "" : "s"}` : `files from ${companyName} and files you send us`}
        </div>
      </div>
      {groups.map((g) => (
        <div key={g.venueId ?? "company-wide"} style={{ padding: "12px 20px", borderBottom: "1px solid #f5f6f8" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{g.venueLabel}</div>
          {g.categories.map((c) => (
            <div key={c.key} style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase" }}>
                {c.label}
              </div>
              {c.docs.map((d) => (
                <div key={d.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, alignItems: "center", padding: "7px 0" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.title}</div>
                    <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
                      {[
                        d.fileName,
                        formatBytes(d.size),
                        fmtDate(d.uploadedAt),
                        d.source === "customer" ? "sent by " + (d.uploadedBy || "you") : "from " + companyName,
                      ].join(" · ")}
                    </div>
                  </div>
                  <a
                    href={(preview ? "/api/documents/" : "/portal/documents/") + encodeURIComponent(d.id)}
                    download
                    style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none", whiteSpace: "nowrap" }}
                  >
                    Download
                  </a>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
      {groups.length === 0 && (
        <div style={{ padding: "22px 20px", fontSize: 12.5, color: "#9aa0ab", textAlign: "center" }}>
          No documents yet — anything we share with you, and anything you send us, appears here.
        </div>
      )}
      <PortalDocumentUpload customerId={customerId} venues={venues} categories={categories} disabled={preview} />
    </div>
  );
}
```

- [ ] **Step 8: Put the section on `/portal`**

In `src/app/portal/page.tsx`, replace this exact text:

```ts
import { acceptPortalQuote } from "./actions";
```

with:

```ts
import { acceptPortalQuote } from "./actions";
import { documentsForCustomer } from "@/lib/stores/documents";
import { activeDocumentCategories, resolveDocumentCategories } from "@/lib/document-categories";
import { groupForPortal } from "@/lib/document-rules";
import { PortalDocumentsSection } from "./documents-section";
```

In the same file, replace this exact text:

```ts
  const venues = cust?.locations || [];
```

with:

```ts
  const venues = cust?.locations || [];

  // #218 — documents: the session's company only, and only what the portal
  // may show (portalCanSee inside documentsForCustomer's portal filter).
  const docCategories = resolveDocumentCategories(settings.documentCategories);
  const docVenues = venues.flatMap((v) => (v.id ? [{ id: v.id, label: v.label || "Venue" }] : []));
  const docGroups = groupForPortal(
    await documentsForCustomer(cid, { portal: true }),
    cid,
    docCategories,
    docVenues
  );
```

In the same file, replace this exact text. The apostrophe in `we’ll` is the typographic `’`, exactly as the file has it:

```tsx
            No venues on file yet — mention your venue in a quote request and we’ll add it.
          </div>
        )}
      </div>
    </PortalShell>
```

with:

```tsx
            No venues on file yet — mention your venue in a quote request and we’ll add it.
          </div>
        )}
      </div>

      {/* documents (#218) — shared files + the customer's own uploads, both ways */}
      <PortalDocumentsSection
        groups={docGroups}
        preview={preview}
        customerId={cid}
        venues={docVenues}
        categories={activeDocumentCategories(docCategories).map((c) => ({ key: c.key, label: c.label }))}
        companyName={companyName}
      />
    </PortalShell>
```

- [ ] **Step 9: Run the gates**

```bash
export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit -p . && echo TSC_OK
```

Expected: `TSC_OK`.

```bash
export PATH=$HOME/.local/node/bin:$PATH && ps aux | grep -E "tsx|next dev" | grep -v grep; env -u DATABASE_URL npm run test:specs > "${TMPDIR:-/tmp}/d218-specs.log" 2>&1; tail -1 "${TMPDIR:-/tmp}/d218-specs.log"; grep '^FAIL' "${TMPDIR:-/tmp}/d218-specs.log" | head -5; grep -c '^PASS' "${TMPDIR:-/tmp}/d218-specs.log"; grep -c '^PASS #218' "${TMPDIR:-/tmp}/d218-specs.log"
```

Expected: `ALL PASSED`, no `FAIL`, and `#218` PASS count **105** (99 + 6).

```bash
export PATH=$HOME/.local/node/bin:$PATH && npx eslint src/app/portal/documents/upload/route.ts "src/app/portal/documents/[id]/route.ts" src/app/portal/documents-actions.ts src/app/portal/document-upload.tsx src/app/portal/documents-section.tsx src/app/portal/page.tsx
```

Expected: 0 errors.

```bash
export PATH=$HOME/.local/node/bin:$PATH && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | tail -5; rm -rf .next
```

Expected: the build succeeds, and the route table lists `/portal/documents/upload` and `/portal/documents/[id]`.

- [ ] **Step 10: Commit**

```bash
export PATH=$HOME/.local/node/bin:$PATH && git add src/app/portal/documents/upload/route.ts "src/app/portal/documents/[id]/route.ts" src/app/portal/documents-actions.ts src/app/portal/document-upload.tsx src/app/portal/documents-section.tsx src/app/portal/page.tsx scripts/test-review-and-spec.ts && git commit -m "feat(documents): portal Documents section, customer uploads, session-scoped download (#218)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Controller verification (after Task 5, not a subagent step)

The spec asks for a browser check on a **scratch datadir**: team upload and download, and a portal upload that shows as New on the company page. Follow the memory notes "Exercising POST routes safely" and "Worktree dev-server browser traps":

- Boot `next dev` with `PGLITE_PATH=$(mktemp -d)`, never `.data/pglite`.
- Check the port with `lsof` first.
- Unregister the service worker.
- Stop the server afterwards and confirm no stray `next dev`/`tsx` remains.

Uploads need `BLOB_READ_WRITE_TOKEN` in `.env.local`. Local Blob uploads are unreliable. If they fail locally, verify on a preview deploy instead, and remember that preview writes the production DB. Check each of these:

1. As a team user: upload two files (one Shared) on a company, download one, and confirm the response is `content-disposition: attachment` and `x-content-type-options: nosniff`.
2. Try `evil.pdf.exe`. It must be refused in the browser before upload.
3. Open `/portal/access?t=…` for a grant of that company. Only the Shared file is listed. Upload a file.
4. Back on the team side, the bell shows "New documents from customers" for that company, and the file has the New chip.
5. Download it or press Mark seen, and confirm the bell clears.
6. In the portal, request `/portal/documents/<id of the Internal file>`. It must return 404.
