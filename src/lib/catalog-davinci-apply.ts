/**
 * Write DaVinci ports and document links onto catalog rows Peak already owns
 * (#162). The ONLY module in this feature that writes.
 *
 * Plan and apply are separate so the CLI's report describes exactly the rows a
 * commit would touch — "the report does not describe the run" is the defect
 * `scripts/db-target.ts` was written to prevent, and #159's D202 is what
 * happens when a writer discovers its own scope: `applyRules` walked every row
 * of `catalog_parts`, so a test with four fixtures wrote 452 real parts.
 * `applyEnrichment` writes only the plans handed to it and never queries.
 *
 * Never creates a row, never deletes one, and never writes list/cost/pricedAt.
 */
import type { Port } from "@/lib/catalog-connect";
import { list as allParts, mergeUpsert, type CatalogPart } from "@/lib/stores/catalog";
import { buildIndex, matchSku } from "@/lib/davinci/match";
import { loadExtract } from "@/lib/davinci/load";
import type { DavinciDoc } from "@/lib/davinci/types";

export type EnrichPlan = {
  sku: string;
  displayName: string;
  typeId: string;
  ports: readonly Port[];
  docs: readonly DavinciDoc[];
  skip?: "has-ports" | "nothing-to-write";
};

export type EnrichStats = {
  scanned: number;
  matched: number;
  writable: number;
  skippedHasPorts: number;
  unmatched: string[];
};

export async function planEnrichment(opts: {
  mfr?: string;
  onlySkus?: string[];
  force?: boolean;
} = {}): Promise<{ plans: EnrichPlan[]; stats: EnrichStats }> {
  const extract = loadExtract();
  const index = buildIndex(extract.records);
  const only = opts.onlySkus?.length ? new Set(opts.onlySkus) : null;

  const parts = (await allParts()).filter(
    (p) => (!opts.mfr || p.mfr === opts.mfr) && (!only || only.has(p.sku))
  );

  const plans: EnrichPlan[] = [];
  const stats: EnrichStats = { scanned: parts.length, matched: 0, writable: 0, skippedHasPorts: 0, unmatched: [] };

  for (const p of parts) {
    const rec = matchSku(p.sku, index);
    if (!rec) {
      stats.unmatched.push(p.sku);
      continue;
    }
    stats.matched++;
    const plan: EnrichPlan = {
      sku: p.sku,
      displayName: rec.displayName,
      typeId: rec.typeId,
      ports: rec.ports,
      docs: rec.docs,
    };
    // A human's edit in the #158 ports editor outranks the library (D6).
    if (p.ports?.length && !opts.force) {
      plan.skip = "has-ports";
      stats.skippedHasPorts++;
    } else if (!rec.ports.length && !rec.docs.length) {
      plan.skip = "nothing-to-write";
    } else {
      stats.writable++;
    }
    plans.push(plan);
  }
  return { plans, stats };
}

export async function applyEnrichment(
  plans: readonly EnrichPlan[],
  opts: { commit: boolean }
): Promise<{ written: number }> {
  if (!opts.commit) return { written: 0 };
  const extract = loadExtract();
  let written = 0;
  for (const plan of plans) {
    if (plan.skip) continue;
    // mergeUpsert is `{ ...existing, ...patch }` — a key absent from the patch
    // leaves the stored value, so naming only these four keys is what keeps
    // list, cost and pricedAt untouched.
    const patch: Partial<Omit<CatalogPart, "id" | "sku">> = {
      davinci: {
        typeId: plan.typeId,
        libraryTimestamp: extract.libraryTimestamp,
        enrichedAt: Date.now(),
      },
    };
    if (plan.ports.length) patch.ports = [...plan.ports];
    if (plan.docs.length) patch.docs = [...plan.docs];
    // mergeUpsert(sku, patch) — the SKU is positional, NOT a key in the patch
    // (its type is Omit<CatalogPart, "id" | "sku">). Naming only these three
    // keys is what keeps list, cost and pricedAt untouched: writePart stamps
    // pricedAt via nextPricedAt only when list or cost actually change, and
    // the merged part carries the stored values for both. `updatedAt` DOES
    // move — every write stamps it, and that is correct.
    await mergeUpsert(plan.sku, patch);
    written++;
  }
  return { written };
}
