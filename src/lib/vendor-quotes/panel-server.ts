/* The Vendors card's server half: the vendor companies on an estimate (its vendor parties and the companies its
   vendor quotes name). Server-only. */
import { getCompanies } from "@/lib/identity/companies";
import { listFor } from "@/lib/stores/parties";
import { get as getQuote } from "@/lib/stores/quotes";
import { asVendorQuotes, vendorCompanyIdsOf } from "./rules";
import type { VendorCompanyVM } from "./vm";

export async function loadVendorCompanies(quoteId: string): Promise<VendorCompanyVM[]> {
  const quote = await getQuote(quoteId);
  const vendorQuotes = asVendorQuotes((quote as { vendorQuotes?: unknown } | null)?.vendorQuotes);
  const ids = new Set<string>();
  for (const p of await listFor("quote", quoteId)) if (p.role === "vendor") ids.add(p.companyId);
  for (const id of vendorCompanyIdsOf(vendorQuotes)) ids.add(id);
  const names = await getCompanies([...ids]);
  return [...ids].map((id) => ({ id, name: names.get(id)?.name || id, href: `/companies/${encodeURIComponent(id)}` }));
}
