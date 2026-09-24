import { list, mergeUpsert, type CatalogPart } from "@/lib/stores/catalog";
import { buildIndex, matchPart } from "@/lib/davinci/match";
import type { DavinciDoc, DavinciRecord } from "@/lib/davinci/extract";

export type EnrichPlan = {
  sku: string;
  displayName: string;
  ports: CatalogPart["ports"];
  docs: DavinciDoc[];
  record: DavinciRecord | null;
  skipped?: "has-ports" | "no-match" | "nothing-to-write";
};

export type EnrichStats = { considered: number; matched: number; ported: number; documented: number; skipped: number; unmatched: number };

export async function planEnrichment(opts: {
  records: DavinciRecord[];
  mfr?: string;
  onlySkus?: string[];
}): Promise<{ plans: EnrichPlan[]; stats: EnrichStats }> {
  const index = buildIndex(opts.records);
  const only = opts.onlySkus?.length ? new Set(opts.onlySkus.map((s) => s.toUpperCase())) : null;
  const mfr = opts.mfr?.trim().toLowerCase();
  const parts = (await list()).filter((p) => (!mfr || (p.mfr || "").toLowerCase() === mfr) && (!only || only.has(p.sku.toUpperCase())));
  const stats: EnrichStats = { considered: parts.length, matched: 0, ported: 0, documented: 0, skipped: 0, unmatched: 0 };
  const plans = parts.map((part): EnrichPlan => {
    const record = matchPart(part, index);
    if (!record) { stats.unmatched++; return { sku: part.sku, displayName: part.desc, ports: [], docs: [], record: null, skipped: "no-match" }; }
    stats.matched++;
    if (part.ports?.length) { stats.skipped++; return { sku: part.sku, displayName: record.displayName, ports: record.ports, docs: record.docs, record, skipped: "has-ports" }; }
    if (!record.ports.length && !record.docs.length) { stats.skipped++; return { sku: part.sku, displayName: record.displayName, ports: [], docs: [], record, skipped: "nothing-to-write" }; }
    if (record.ports.length) stats.ported++;
    if (record.docs.length) stats.documented++;
    return { sku: part.sku, displayName: record.displayName, ports: record.ports, docs: record.docs, record };
  });
  return { plans, stats };
}

export async function applyEnrichment(
  plans: EnrichPlan[],
  opts: { commit: boolean; force?: boolean }
): Promise<{ written: number; skipped: number }> {
  if (!opts.commit) return { written: 0, skipped: plans.length };
  let written = 0;
  let skipped = 0;
  for (const plan of plans) {
    if (!plan.record || (!opts.force && plan.skipped) || (!plan.ports?.length && !plan.docs.length)) { skipped++; continue; }
    await mergeUpsert(plan.sku, {
      ...(plan.ports?.length ? { ports: plan.ports } : {}),
      ...(plan.docs.length ? { docs: plan.docs } : {}),
      davinci: { typeId: plan.record.typeId, libraryTimestamp: plan.record.libraryTimestamp, enrichedAt: Date.now() },
    });
    written++;
  }
  return { written, skipped };
}
