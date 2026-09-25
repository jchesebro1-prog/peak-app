import { createHash } from "node:crypto";
import { listDocs } from "@/db/doc-store";
import { mfrKey } from "@/lib/catalog-books";
import { peakMfrFor } from "@/lib/catalog-davinci-apply";
import { loadExtract } from "@/lib/davinci/load";
import { list as allParts } from "@/lib/stores/catalog";
import { syncAccessoryLinksBatch } from "@/lib/stores/part-accessory-links";
import { allDocuments, createDocuments, ensureLinksBatch, type NewPartDocument } from "@/lib/stores/part-documents";
import { planDavinciPrefill, type PrefillPlan } from "./davinci-prefill";

/**
 * DaVinci pre-fill, the writing half (#DOC, spec §6). Server/script only.
 * Writes link-only `part_documents` (source "davinci", sourceUrl only — no
 * ETC file is downloaded or rehosted), their part links, and the "davinci"
 * scope of `part_accessory_links`. Idempotent: document ids derive from the
 * URL, links a human detached stay detached (ensureLinks), and the graph
 * scope is synced (a pair ETC dropped from the library is soft-deleted).
 *
 * Review fix wave 1: every phase writes DOC_BATCH_CHUNK rows per statement
 * (src/db/doc-store.ts batched writes) instead of one awaited round trip per
 * row — ~11k rows on a full ETC catalog, which on Neon ran past Vercel's
 * 60 s function limit. `opts.shouldStop` (the admin action's wall-clock
 * budget — see createPrefillStopper) is checked between chunks; a run cut
 * short returns `complete: false`, and re-running finishes the job because
 * every phase is idempotent. The CLI passes no stop and always completes.
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

export type PrefillResult = {
  documentsCreated: number;
  linksCreated: number;
  accessoryWritten: number;
  accessoryRemoved: number;
  /** False when `opts.shouldStop` cut the run short — run it again. */
  complete: boolean;
};

export type PrefillOpts = { shouldStop?: () => boolean };

/**
 * A between-chunks stop for the admin action (same shape as the fetch
 * action's createFetchBudget, src/lib/part-docs/fetch-links.ts): a chunk only
 * starts while at least `chunkWorstCaseMs` of `budgetMs` remain — except the
 * very first chunk of the call, which always runs so every click makes
 * progress. `now` is injectable for a fake clock in tests.
 */
export function createPrefillStopper(budgetMs: number, chunkWorstCaseMs: number, now: () => number = Date.now): () => boolean {
  const deadline = now() + budgetMs;
  let started = 0;
  return () => {
    if (started > 0 && deadline - now() < chunkWorstCaseMs) return true;
    started++;
    return false;
  };
}

export async function applyPrefill(plan: PrefillPlan, by: string, opts: PrefillOpts = {}): Promise<PrefillResult> {
  const result: PrefillResult = { documentsCreated: 0, linksCreated: 0, accessoryWritten: 0, accessoryRemoved: 0, complete: false };
  const batch = { shouldStop: opts.shouldStop };
  const everIds = new Set((await listDocs("part_documents", { includeDeleted: true })).map((d) => d.id));
  const byUrl = new Map<string, string>();
  for (const d of await allDocuments()) if (d.sourceUrl && !byUrl.has(d.sourceUrl)) byUrl.set(d.sourceUrl, d.id);

  // Phase 1 — the documents no run has ever minted, in one batch.
  const toCreate: NewPartDocument[] = [];
  const pairs: Array<{ partSku: string; documentId: string; kind: "datasheet" }> = [];
  for (const d of plan.documents) {
    let id = byUrl.get(d.url);
    if (!id) {
      id = davinciDocumentId(d.url);
      if (!everIds.has(id)) {
        toCreate.push({
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
        everIds.add(id);
      }
      byUrl.set(d.url, id);
    }
    for (const sku of d.skus) pairs.push({ partSku: sku, documentId: id, kind: "datasheet" });
  }
  const docs = await createDocuments(toCreate, batch);
  result.documentsCreated = docs.created.length;
  // Links are only written once every document they point at exists.
  if (!docs.complete) return result;

  // Phase 2 — part links (never re-attaching a pair a human detached).
  const links = await ensureLinksBatch(pairs, by, batch);
  result.linksCreated = links.added;
  if (!links.complete) return result;

  // Phase 3 — the "davinci" scope of the accessory graph.
  const acc = await syncAccessoryLinksBatch({ source: "davinci" }, plan.accessoryPairs, batch);
  result.accessoryWritten = acc.written;
  result.accessoryRemoved = acc.removed;
  result.complete = acc.complete;
  return result;
}
