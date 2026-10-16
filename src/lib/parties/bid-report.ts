/* #348 slice 6 — Reports → "Bids by GC/EC": the pure per-bidder aggregation. Types only from the stores (no reads);
   the loader and the widget (Task 6) feed it rows. Jeff 2026-10-15: the awarded-to-us rate is awarded ÷ decided,
   decided = awarded + lost, and "—" (null) when nothing is decided. */
import type { Party } from "./rules";
import type { BidderState } from "./rules";
import type { Quote } from "@/lib/stores/quotes";

export type BidReportInput = {
  party: Pick<Party, "id" | "companyId" | "role" | "recordId" | "bid">;
  /** null = the quote is gone (orphan row) → skipped */
  quote: Pick<Quote, "id" | "status" | "bid"> | null;
};
export type BidReportRow = {
  companyId: string;
  name: string;
  role: "gc" | "ec";
  /** delivered: bid.revSent is a number (email or website) */
  sent: number;
  /** sent and result pending */
  open: number;
  /** spec "GC awarded": sent and result awarded | lost */
  decided: number;
  /** sent and result awarded — the work came to us through this company */
  awarded: number;
  /** sent and result withdrew | no_bid */
  out: number;
  /** awarded ÷ decided, %, rounded; null when decided = 0 */
  rate: number | null;
  lastSentAt: number | null;
};
export type BidReportTotal = Omit<BidReportRow, "companyId" | "role"> & { companies: number };

export const BID_REPORT_COPY = {
  title: "Bids by GC/EC",
  sub: "Bids we sent each general and electrical contractor in this period — how many were decided and how often the award came to us",
  cols: ["Company", "Role", "Sent", "Open", "GC awarded", "Awarded to us", "Withdrew / no bid", "Awarded-to-us rate", "Last sent"],
  empty: "No bids sent in this period.",
  total: "All GCs and ECs",
} as const;

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** The date a bid falls on for the period: the estimate's bid due date, else the row's last send. null = skipped. */
export function bidReportAnchor(q: Pick<Quote, "bid">, bid: BidderState): number | null {
  const due = q.bid?.dueAt;
  if (isNum(due)) return due;
  return isNum(bid.sentAt) ? bid.sentAt : null;
}

const rateOf = (awarded: number, decided: number): number | null => (decided > 0 ? Math.round((awarded / decided) * 100) : null);

type Acc = { companyId: string; role: "gc" | "ec"; sent: number; open: number; decided: number; awarded: number; out: number; lastSentAt: number | null };

/** One row per (company, role) with ≥ 1 sent bid anchored in [start, end); a total row over all of them
 *  (`name` = "All GCs and ECs"; `companies` = distinct companies). Sorted sent desc, then name. */
export function bidsByBidder(
  inputs: readonly BidReportInput[],
  names: ReadonlyMap<string, string>,
  period: { start: number; end: number }
): { rows: BidReportRow[]; total: BidReportTotal } {
  const acc = new Map<string, Acc>();
  for (const { party, quote } of inputs) {
    if (!quote) continue;
    if (party.role !== "gc" && party.role !== "ec") continue;
    const bid = party.bid;
    if (!bid || !isNum(bid.revSent)) continue; // not delivered → counts nowhere
    const at = bidReportAnchor(quote, bid);
    if (at === null || at < period.start || at >= period.end) continue;
    const key = `${party.companyId}\u0000${party.role}`;
    let a = acc.get(key);
    if (!a) {
      a = { companyId: party.companyId, role: party.role, sent: 0, open: 0, decided: 0, awarded: 0, out: 0, lastSentAt: null };
      acc.set(key, a);
    }
    a.sent++;
    if (bid.result === "pending") a.open++;
    else if (bid.result === "awarded") { a.decided++; a.awarded++; }
    else if (bid.result === "lost") a.decided++;
    else if (bid.result === "withdrew" || bid.result === "no_bid") a.out++;
    if (isNum(bid.sentAt) && (a.lastSentAt === null || bid.sentAt > a.lastSentAt)) a.lastSentAt = bid.sentAt;
  }
  const rows: BidReportRow[] = [...acc.values()].map((a) => ({
    ...a,
    name: names.get(a.companyId) || "Unknown company",
    rate: rateOf(a.awarded, a.decided),
  }));
  rows.sort((x, y) => y.sent - x.sent || x.name.localeCompare(y.name) || x.role.localeCompare(y.role) || x.companyId.localeCompare(y.companyId));
  const t = { sent: 0, open: 0, decided: 0, awarded: 0, out: 0 };
  let last: number | null = null;
  for (const r of rows) {
    t.sent += r.sent; t.open += r.open; t.decided += r.decided; t.awarded += r.awarded; t.out += r.out;
    if (r.lastSentAt !== null && (last === null || r.lastSentAt > last)) last = r.lastSentAt;
  }
  return {
    rows,
    total: { name: BID_REPORT_COPY.total, ...t, rate: rateOf(t.awarded, t.decided), lastSentAt: last, companies: new Set(rows.map((r) => r.companyId)).size },
  };
}
