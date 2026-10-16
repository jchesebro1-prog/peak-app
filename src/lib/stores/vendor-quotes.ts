import { getCompanies } from "@/lib/identity/companies";
import { addParty, listForCompany } from "@/lib/stores/parties";
import { getMany as getQuotes, get as getQuote } from "@/lib/stores/quotes";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { quoteBuilderHref } from "@/lib/quote-links";
import type { Party } from "@/lib/parties/rules";
import type { QuoteReceivedRow } from "@/lib/vendor-quotes/vm";
import {
  asVendorQuotes, isVendorPickerType, keepLiveVendorCompanies, liveVendorQuoteIds, newVendorCompanyIds, quotesReceivedRows,
  stampVendorQuotes, vendorCompanyIdsOf, vendorPartyRemovalRefusal, type VendorQuoteLike,
} from "@/lib/vendor-quotes/rules";

/**
 * #348 slice 4 — the store side of "a vendor quote links a vendor company". Server-only (reads identity, parties and
 * quotes); the pure rules live in `src/lib/vendor-quotes/rules.ts`.
 */

/** Stamp `addedAt` / sanitize ids server-side, then drop a `vendorCompanyId` that isn't a live vendor company. */
export async function prepareVendorQuotesForSave<T extends VendorQuoteLike>(prior: readonly VendorQuoteLike[], next: readonly T[], now: number): Promise<T[]> {
  const stamped = stampVendorQuotes(prior, next, now);
  const ids = vendorCompanyIdsOf(stamped);
  if (!ids.length) return stamped;
  const rows = await getCompanies(ids);
  const live = new Set<string>();
  for (const [id, c] of rows) if (isVendorPickerType(c.type)) live.add(id);
  return keepLiveVendorCompanies(stamped, live);
}

/** A company first appearing on a vendor quote joins the record as a vendor party, once. A refusal is logged, never thrown. */
export async function addVendorPartiesForSave(
  record: { type: "quote" | "project"; id: string },
  prior: readonly VendorQuoteLike[],
  next: readonly VendorQuoteLike[],
  by: string
): Promise<number> {
  let added = 0;
  for (const companyId of newVendorCompanyIds(prior, next)) {
    const r = await addParty({ recordType: record.type, recordId: record.id, companyId, role: "vendor" }, by);
    if (!r.ok) console.error("addVendorPartiesForSave: refused", record.id, companyId, r.error);
    else if (!r.existed) added++;
  }
  return added;
}

/** Removing a vendor party is refused while a LIVE vendor quote on the estimate names its company. */
export async function vendorPartyRemovalRefusalFor(party: Party): Promise<string | null> {
  if (party.recordType !== "quote" || party.role !== "vendor") return null;
  const q = await getQuote(party.recordId);
  if (!q) return null;
  const liveIds = liveVendorQuoteIds(q.spec);
  const live = asVendorQuotes(q.vendorQuotes).filter((v) => liveIds.has(v.id));
  const co = (await getCompanies([party.companyId])).get(party.companyId);
  return vendorPartyRemovalRefusal(co?.name || "", party.companyId, live);
}

/** "Quotes we've received" for one vendor company: every estimate it's a vendor on, with that company's vendor quotes. */
export async function quotesReceivedFor(companyId: string): Promise<QuoteReceivedRow[]> {
  const ids = [...new Set((await listForCompany(companyId)).filter((p) => p.recordType === "quote" && p.role === "vendor").map((p) => p.recordId))];
  if (!ids.length) return [];
  const found = await getQuotes(ids);
  return quotesReceivedRows(
    companyId,
    [...found.values()].map((q) => ({ id: q.id, number: displayQuoteNumber(q), name: q.name || "", customer: q.customer || "", status: q.status || "", href: quoteBuilderHref(q), vendorQuotes: q.vendorQuotes }))
  );
}
