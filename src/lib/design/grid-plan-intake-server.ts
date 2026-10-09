import { blobEnabled, copyBlob, getBlobHead, isBlobNotFound, safeName } from "@/lib/blob";
import { GRID_SHEET_BLOB_PREFIX } from "@/lib/grid-sheet-file";
import { PACKAGE_FILE_SNIFF_BYTES } from "@/lib/estimate-output/package-files";
import { documentCategories, documentsForCustomer } from "@/lib/stores/documents";
import { get as getQuote } from "@/lib/stores/quotes";
import { addSheet, getProject } from "@/lib/stores/grid-projects";
import { estimateLinkOf } from "@/lib/design/grid-options";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { docLocId, sitesForCompany } from "@/lib/identity/sites";
import { GRID_PLAN_COPY, planCandidatesFrom, planCopyVerdict, type PlanCandidateFile } from "./grid-plan-intake";

/**
 * #314 — the server half of the Grid intake's plan view: which plans this job
 * already has on file, and the Blob-to-Blob copy of one of them into a new
 * FIRST plan sheet. Server-only. The candidate list is always re-derived here
 * from the server's own reads; a client names a candidate by id only.
 */

export type PlanContext = { customerId: string | null; siteLocId: string | null; quoteId: string | null };

export async function planCandidatesFor(ctx: PlanContext): Promise<PlanCandidateFile[]> {
  // No Blob store, no stored files to copy (documents and package files live only in Blob).
  if (!blobEnabled()) return [];
  const [quote, documents, categories] = await Promise.all([
    ctx.quoteId ? getQuote(ctx.quoteId) : Promise.resolve(null),
    ctx.customerId ? documentsForCustomer(ctx.customerId) : Promise.resolve([]),
    ctx.customerId ? documentCategories() : Promise.resolve([]),
  ]);
  return planCandidatesFrom({
    quoteNumber: quote ? displayQuoteNumber(quote) : null,
    packageFiles: quote?.packageFiles,
    documents,
    categories,
    siteLocId: ctx.siteLocId,
  });
}

/** The saved design's own context: its customer, its venue's doc-side id, its estimate link. */
export async function planContextOfProject(projectId: string): Promise<PlanContext | null> {
  const project = await getProject(projectId);
  if (!project) return null;
  let siteLocId: string | null = null;
  if (project.customerId && project.siteId) {
    const site = (await sitesForCompany(project.customerId)).find((s) => s.id === project.siteId);
    siteLocId = site ? docLocId(site) : null;
  }
  return { customerId: project.customerId || null, siteLocId, quoteId: estimateLinkOf(project)?.quoteId ?? null };
}

/**
 * Copy one on-file plan into the design as its FIRST sheet (calibration stays
 * manual). Re-derives the candidate list from the SAVED design, then checks
 * the source bytes (magic bytes, size) exactly like a Plans & risers upload.
 */
export async function attachPlanCandidate(projectId: string, candidateId: string, by: string): Promise<{ ok: true; sheetId: string; name: string } | { ok: false; error: string }> {
  if (!blobEnabled()) return { ok: false, error: GRID_PLAN_COPY.noStorage };
  const ctx = await planContextOfProject(projectId);
  if (!ctx) return { ok: false, error: "That design could not be found." };
  const pick = (await planCandidatesFor(ctx)).find((c) => c.id === candidateId);
  if (!pick) return { ok: false, error: GRID_PLAN_COPY.gone };
  try {
    const head = await getBlobHead(pick.blobPath, PACKAGE_FILE_SNIFF_BYTES);
    if (!head) return { ok: false, error: GRID_PLAN_COPY.gone };
    const verdict = planCopyVerdict(head.bytes, head.size);
    if (!verdict.ok) return verdict;
    const copied = await copyBlob(pick.blobPath, `${GRID_SHEET_BLOB_PREFIX}${projectId}/${safeName(pick.name)}`, verdict.type);
    const sheet = await addSheet(projectId, { name: pick.name.slice(0, 120), mime: verdict.type, url: copied.url, blobPath: copied.pathname, by, first: true });
    if (!sheet) return { ok: false, error: "That design could not be found." };
    return { ok: true, sheetId: sheet.id, name: sheet.name };
  } catch (e) {
    if (isBlobNotFound(e)) return { ok: false, error: GRID_PLAN_COPY.gone };
    console.error("[grid] plan copy failed:", e);
    return { ok: false, error: GRID_PLAN_COPY.failed };
  }
}
