/* Assessments engine (#337, Task 9) — the findings register's loader, shared by the page and the CSV route.
   Server-only (stores). The rules (filters, sort, cells) are the pure ones in register.ts. */
import { listFindings, type Finding } from "@/lib/stores/findings";
import { getMany as getQuotes } from "@/lib/stores/quotes";
import { getCompanies } from "@/lib/identity/companies";
import { docLocId, sitesForCompanies } from "@/lib/identity/sites";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { quoteBuilderHref } from "@/lib/quote-links";
import { registerCells, registerList, type RegisterFilters, type RegisterRow } from "./register";

export type { RegisterRow } from "./register";

export interface RegisterData {
  rows: RegisterRow[];
  /** every live finding's customers / venues (the filter pick lists) */
  customers: { id: string; name: string }[];
  venues: { id: string; name: string; customerId: string }[];
  total: number;
}

/** Quote id → label + builder link, for every id given (a quote that's gone keeps its id, linking nowhere useful). */
async function quoteLinksFor(ids: string[]): Promise<Map<string, { id: string; label: string; href: string }>> {
  const uniq = [...new Set(ids)];
  const qs = await getQuotes(uniq).catch(() => new Map<string, Awaited<ReturnType<typeof getQuotes>> extends Map<string, infer Q> ? Q : never>());
  return new Map(uniq.map((id) => {
    const q = qs.get(id);
    return [id, { id, label: q ? displayQuoteNumber(q) : id, href: quoteBuilderHref({ id, quoteType: q?.quoteType ?? null }) }];
  }));
}

/** The register for these filters. `extraKeys` are findings to include as rows even when the filters leave them out
 *  (the ?focus= finding). */
export async function loadRegister(filters: RegisterFilters, extraKeys: string[] = []): Promise<RegisterData> {
  const all = await listFindings({ includeVoided: true });
  const list = registerList(all, filters);
  for (const k of extraKeys) {
    if (list.some((f) => f.key === k)) continue;
    const f = all.find((x) => x.key === k);
    if (f) list.push(f);
  }
  const customerIds = [...new Set(all.map((f) => f.customerId))];
  const [companies, siteMap, quoteMap] = await Promise.all([
    getCompanies(customerIds),
    sitesForCompanies(customerIds),
    quoteLinksFor(list.flatMap((f) => f.quoteRefs)),
  ]);
  const siteById = new Map([...siteMap.values()].flat().map((s) => [s.id, s]));
  const siteName = (id: string) => siteById.get(id)?.name || siteById.get(id)?.locationName || id;
  const rows: RegisterRow[] = list.map((f) => {
    const s = siteById.get(f.siteId);
    const quoteLinks = f.quoteRefs.map((id) => quoteMap.get(id) ?? { id, label: id, href: quoteBuilderHref({ id }) });
    return {
      finding: JSON.parse(JSON.stringify(f)) as Finding,
      cells: registerCells(f, { siteName: siteName(f.siteId), quoteLabels: Object.fromEntries(quoteLinks.map((q) => [q.id, q.label])) }),
      customerName: companies.get(f.customerId)?.name ?? f.customerId,
      siteName: siteName(f.siteId),
      venueLocId: s ? docLocId(s) : null,
      quoteLinks,
    };
  });
  const live = all.filter((f) => filters.voided || !f.voided);
  const customers = [...new Set(live.map((f) => f.customerId))]
    .map((id) => ({ id, name: companies.get(id)?.name ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const venueKeys = new Map<string, string>();
  for (const f of live) venueKeys.set(f.siteId, f.customerId);
  const venues = [...venueKeys].map(([id, customerId]) => ({ id, customerId, name: siteName(id) })).sort((a, b) => a.name.localeCompare(b.name));
  return { rows, customers, venues, total: live.length };
}
