"use server";

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
import { applyPrefill, createPrefillStopper, planPrefillFromDavinci } from "@/lib/part-docs/davinci-apply";
import { buildFetchContext, createFetchBudget, fetchSlot, type FetchOutcome, type FetchTarget } from "@/lib/part-docs/fetch-links";
import { matchFileRows, type FilenameMatch } from "@/lib/part-docs/filename-match";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { setDocNotNeeded } from "@/lib/part-docs/not-needed";
import { alsoCoversSuggestions, type Suggestion } from "@/lib/part-docs/suggest";
import {
  FETCH_ACTION_BUDGET_MS,
  FETCH_BATCH_SIZE,
  PREFILL_ACTION_BUDGET_MS,
  PREFILL_CHUNK_WORST_CASE_MS,
  isDocumentId,
  isPartDocKind,
  type PartDocKind,
} from "@/lib/part-docs/types";
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

/** How many `getPart` lookups run at once in `liveSkus` — bounded so a
 *  500-SKU drop doesn't fire 500 sequential (or 500 simultaneous) reads. */
const LIVE_SKU_BATCH = 20;

/** The SKUs among `skus` that are live catalog parts (deduped, capped).
 *  Trims BEFORE de-duplicating — a raw list with the same SKU in two
 *  different-whitespace spellings must collapse to one lookup, not two. */
async function liveSkus(skus: readonly string[]): Promise<string[]> {
  const candidates = [
    ...new Set(skus.slice(0, MAX_SKUS_PER_CALL).map((raw) => String(raw || "").trim())),
  ].filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < candidates.length; i += LIVE_SKU_BATCH) {
    const batch = candidates.slice(i, i + LIVE_SKU_BATCH);
    const parts = await Promise.all(batch.map((sku) => getPart(sku)));
    parts.forEach((part, j) => {
      if (part) out.push(batch[j]);
    });
  }
  return out;
}

/**
 * A browser finished uploading a NEW document's file: check it, record the
 * document, link it to the parts it was dropped on.
 *
 * Security review, fix wave 2: the early refusals below (bad kind, no live
 * SKUs) used to call a `cleanupOrphan` helper that deleted the uploaded
 * blob once its pathname passed `blobPathBelongsTo` for this document id —
 * but that check only proves the pathname sits under
 * `part-docs/<documentId>/…`, not that it's THIS upload's own file. Any
 * signed-in user could read an EXISTING document's real `blobKey` (or a
 * history entry's) through sync pull, then call this action with that
 * existing documentId, that real blobPathname, and a deliberately bad
 * `kind` — the pre-exists check ran AFTER the cleanup, so the live file
 * was deleted before anyone found out the document already existed. A
 * browser simply retrying after its SKUs were removed from the catalog
 * would trip the same path by accident.
 *
 * Fix: neither early refusal touches Blob at all anymore — they just
 * return `{ok:false}`. The only code that ever deletes an uploaded blob is
 * `verifyUploadedBlob`'s own refusal path, and it is only ever reached
 * below, AFTER the "does this document already exist" check has returned.
 * A blob orphaned by one of these two early refusals (a real new upload,
 * genuinely bad kind or genuinely dead SKUs) is not cleaned up by
 * anything today — see the report for the follow-up sweep this needs.
 */
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
  // A document already existing under this id is not this upload's blob to
  // touch — it may be someone else's real file (an attacker's whole point
  // in supplying this documentId), a legitimate concurrent Replace, or the
  // browser simply retrying; leave the blob alone either way. This check
  // must run before the only Blob-deleting call in this function
  // (verifyUploadedBlob's own refusal path, below).
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
  // verifyUploadedBlob's refuse() deletes the pathname, so a live or historical file of this document must never reach it.
  if (input.blobPathname === doc.blobKey || (doc.history || []).some((h) => h.blobKey === input.blobPathname)) return { ok: false, error: "That file is already on this document." };
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

/**
 * Fetch up to FETCH_BATCH_SIZE slots' links (spec §6 "batch fetch runs a
 * bounded number per request"). The page loops over a selection calling
 * this; every success and failure is persisted as it happens, so a batch
 * that is interrupted simply resumes on the next click.
 *
 * Review fix wave 1, I1: also bounded by WALL CLOCK, not just count — a
 * fetch's own timeout can be up to MAX_FETCH_TIMEOUT_MS (30s), so
 * FETCH_BATCH_SIZE slots could in principle sail well past Vercel's function
 * limit. `createFetchBudget` hands every `fetchSlot` call in this loop one
 * shared deadline (same budgetMs/worst-case pattern as
 * settings/actions.ts's geocodeBatchAction): a slot only starts a new fetch
 * attempt while there's room left for a full worst-case one, and a target
 * that never got a look in comes back with the fixed "not attempted, run
 * again" text rather than being silently dropped — the caller (the page) is
 * expected to re-submit whatever didn't get attempted. The catalog is
 * listed and `buildFetchContext` runs once for the whole call, not once per
 * target. M3: a `fetchSlot` call is wrapped too, so a thrown store/blob
 * error on one slot can't take the rest of the batch down with it.
 */
export async function fetchLinksAction(targets: FetchTarget[]): Promise<DocActionResult<{ results: FetchOutcome[] }>> {
  const user = await requireUser();
  if (!blobEnabled()) {
    return { ok: false, error: "File storage isn't configured (no BLOB_READ_WRITE_TOKEN) — nothing can be fetched on this deployment." };
  }
  const batch = (targets || []).filter((t) => t && typeof t.sku === "string" && isPartDocKind(t.kind)).slice(0, FETCH_BATCH_SIZE);
  if (!batch.length) return { ok: true, results: [] };
  const ctx = buildFetchContext(await loadPartDocsState(await listCatalog()));
  const budget = createFetchBudget(FETCH_ACTION_BUDGET_MS);
  const results: FetchOutcome[] = [];
  for (const t of batch) {
    const target = { sku: t.sku.trim(), kind: t.kind };
    try {
      results.push(await fetchSlot(ctx, target, user.name, undefined, budget));
    } catch {
      results.push({ ...target, ok: false, error: "Could not store the file." });
    }
  }
  revalidate();
  return { ok: true, results };
}

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

/** Admin: write the DaVinci pre-fill (link-only ETC datasheets + the ETC
 *  accessory graph). Idempotent — a second click writes nothing new. The
 *  same write as `npm run part-docs:davinci -- --apply --commit`.
 *
 *  Review fix wave 1: the writes are batched (500 rows per statement), and
 *  the whole call runs on a wall-clock budget (PREFILL_ACTION_BUDGET_MS,
 *  under the page's 60 s maxDuration) checked between write chunks. If the
 *  budget runs out first it stops cleanly and says so — clicking again
 *  continues where it stopped, since every phase skips what already landed. */
export async function prefillFromDavinciAction(): Promise<DocActionResult<{ summary: string; complete: boolean }>> {
  const user = await requirePerm("manage_users");
  const shouldStop = createPrefillStopper(PREFILL_ACTION_BUDGET_MS, PREFILL_CHUNK_WORST_CASE_MS);
  const plan = await planPrefillFromDavinci();
  const r = await applyPrefill(plan, user.name, { shouldStop });
  revalidate();
  return {
    ok: true,
    complete: r.complete,
    summary:
      `${r.documentsCreated} new datasheet link${r.documentsCreated === 1 ? "" : "s"}, ${r.linksCreated} part link${r.linksCreated === 1 ? "" : "s"}, ` +
      `${r.accessoryWritten} accessory link${r.accessoryWritten === 1 ? "" : "s"} written, ${r.accessoryRemoved} removed ` +
      `(${plan.stats.typesMatched} DaVinci types matched ${plan.stats.parts} ETC parts).` +
      (r.complete ? "" : " Not finished within this request's time limit — click Pre-fill from DaVinci again to continue where it stopped."),
  };
}
