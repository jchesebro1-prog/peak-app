import { estimateLinkOf } from "@/lib/design/grid-options";
import { getProjects } from "@/lib/stores/grid-projects";
import { quoteNumbersFor } from "@/lib/stores/estimate-numbers";
import type { EstimateLinkInfo } from "@/lib/design/estimate-grid-link";
import { quoteBuilderHref } from "@/lib/quote-links";

/**
 * #316 — which saved designs draw an Estimator quote, for the dashboards that
 * would otherwise offer "Add to Quotes" on them (Designs, Home → My designs).
 * The rule is #314's own `estimateLinkOf` (the same one every grid→quote
 * server refusal reads) — never a second one. Batched: ONE read for every
 * linked Grid project and ONE for the quote numbers, not one per design.
 * Server-only; never fatal (a dashboard read must not fail on this).
 */
export async function estimateLinksForDesigns(
  designs: ReadonlyArray<{ id: string; gridProjectId?: string | null }>
): Promise<Record<string, EstimateLinkInfo>> {
  const out: Record<string, EstimateLinkInfo> = {};
  try {
    const linked = designs.filter((d) => !!d.gridProjectId);
    if (!linked.length) return out;
    const projects = await getProjects(Array.from(new Set(linked.map((d) => d.gridProjectId as string))));
    const links = new Map<string, string>();
    for (const [id, p] of projects) {
      const l = estimateLinkOf(p);
      if (l) links.set(id, l.quoteId);
    }
    if (!links.size) return out;
    const numbers = await quoteNumbersFor(Array.from(links.values()));
    for (const d of linked) {
      const quoteId = links.get(d.gridProjectId as string);
      if (!quoteId) continue;
      out[d.id] = { quoteId, number: numbers.get(quoteId) ?? quoteId, href: quoteBuilderHref({ id: quoteId, quoteType: "system" }) };
    }
  } catch (e) {
    console.error("[designs] estimate links failed:", e);
  }
  return out;
}
