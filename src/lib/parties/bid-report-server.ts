/* #348 slice 6 — Reports → "Bids by GC/EC": the loader. One bounded SQL query over `record_parties` for the
   delivered bidder rows only (a quote's GC/EC row with bid.revSent set), then one batched read of their quotes and
   one of their companies' names. Never a full quote or company scan. The pure aggregation (bid-report.ts) does
   the period and the counting; quote status is deliberately not filtered here — a sent bid counts whatever
   happened to the estimate afterwards, and a deleted quote reads null and is skipped there. */
import { listDocsWhere } from "@/db/doc-store";
import { getCompanies } from "@/lib/identity/companies";
import { getMany as getQuotes } from "@/lib/stores/quotes";
import type { Party } from "./rules";
import type { BidReportInput } from "./bid-report";

/** The most bidder rows one report reads; hitting it marks the load truncated (the widget says so). */
export const BID_REPORT_MAX = 5000;

const NAME_CHUNK = 500;

export type BidReportData = { inputs: BidReportInput[]; names: Map<string, string>; truncated: boolean };

/** `limit` exists for the harness (a cap it can reach); the dashboard always uses BID_REPORT_MAX. */
export async function loadBidReportData(opts: { limit?: number } = {}): Promise<BidReportData> {
  const limit = opts.limit ?? BID_REPORT_MAX;
  const rows = await listDocsWhere<Party>(
    "record_parties",
    {
      all: [
        { path: ["recordType"], is: "quote" },
        { path: ["role"], in: ["gc", "ec"] },
        { path: ["bid", "revSent"], filled: "text" },
      ],
    },
    { limit }
  );
  const quoteIds = [...new Set(rows.map((p) => p.recordId).filter(Boolean))];
  const companyIds = [...new Set(rows.map((p) => p.companyId).filter(Boolean))];
  const [quotes, names] = await Promise.all([getQuotes(quoteIds), loadNames(companyIds)]);
  const inputs: BidReportInput[] = rows.map((p) => {
    const q = quotes.get(p.recordId);
    return {
      party: { id: p.id, companyId: p.companyId, role: p.role, recordId: p.recordId, bid: p.bid },
      quote: q ? { id: q.id, status: q.status, bid: q.bid } : null,
    };
  });
  return { inputs, names, truncated: rows.length === limit };
}

async function loadNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += NAME_CHUNK) {
    for (const [id, c] of await getCompanies(ids.slice(i, i + NAME_CHUNK))) out.set(id, c.name);
  }
  return out;
}
