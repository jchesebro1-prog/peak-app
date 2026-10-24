/**
 * Estimator handoff — the Estimates list's rows (pure: the Node checks import it; ui/estimates-list.tsx renders it).
 * System estimates only, newest first. The total is the grand total the Estimator's header shows for the estimate
 * (runtime/estimate-totals.ts), not the stored `value`. Plan: PR 2 Task 7.
 */
import { fmt } from "@/lib/estimating-core/pricing";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { canonicalTotals, type TotalsQuote } from "./estimate-totals";

export const STATUS_FILTERS = ["all", "draft", "sent", "won", "lost"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const STATUS_LABEL: Record<Exclude<StatusFilter, "all">, string> = { draft: "Draft", sent: "Sent", won: "Won", lost: "Lost" };
export const STATUS_FILTER_LABEL: Record<StatusFilter, string> = { all: "All", ...STATUS_LABEL };

/** A stored quote, as far as the list reads it. */
export type ListQuote = TotalsQuote & {
  id: string;
  estNo?: number | null;
  estSuffix?: number | null;
  name?: string | null;
  customer?: string | null;
  customerId?: string | null;
  owner?: string | null;
  updatedAt?: number | null;
  createdAt?: number | null;
};

export type ListRow = {
  id: string;
  number: string;
  name: string;
  customer: string;
  status: Exclude<StatusFilter, "all">;
  owner: string;
  updatedAt: number;
  grand: number;
  /** The grand total as the Estimator's header prints it. */
  total: string;
};

const isStatus = (s: unknown): s is ListRow["status"] => s === "draft" || s === "sent" || s === "won" || s === "lost";

/** System estimates (a quote with no type is a system quote), newest activity first. `customerName` resolves a customer id. */
export function listRows(quotes: readonly ListQuote[], general: Record<string, unknown>, customerName: (q: ListQuote) => string = (q) => q.customer ?? ""): ListRow[] {
  return quotes
    .filter((q) => (q.quoteType ?? "system") === "system")
    .map((q): ListRow => {
      const grand = canonicalTotals(q, general).canonical;
      return {
        id: q.id,
        number: displayQuoteNumber({ ...q, id: q.id }),
        name: q.name || "Untitled estimate",
        customer: customerName(q) || q.customer || "",
        status: isStatus(q.status) ? q.status : "draft",
        owner: q.owner || "",
        updatedAt: q.updatedAt || q.createdAt || 0,
        grand,
        total: fmt(grand),
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The status filter, then a case-insensitive search over number, id, name, customer and owner. */
export function filterRows(rows: readonly ListRow[], status: StatusFilter, term: string): ListRow[] {
  const t = term.trim().toLowerCase();
  return rows.filter((r) => (status === "all" || r.status === status) && (!t || [r.number, r.id, r.name, r.customer, r.owner].some((x) => x.toLowerCase().includes(t))));
}

/** Row counts per status filter (search not applied — the tabs show the whole list's shape). */
export function statusCounts(rows: readonly ListRow[]): Record<StatusFilter, number> {
  const out: Record<StatusFilter, number> = { all: rows.length, draft: 0, sent: 0, won: 0, lost: 0 };
  for (const r of rows) out[r.status]++;
  return out;
}

/** "Oct 14, 2026" in Chicago time (Peak as-is). Blank for a missing time. */
export function updatedLabel(ms: number): string {
  return ms ? new Date(ms).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" }) : "—";
}
