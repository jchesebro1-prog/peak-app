/**
 * Customer Rewards — lifetime spend (#282, spec §2). Pure and client-safe.
 *
 * A company's purchases, each sale counted ONCE:
 *   - every won quote (any quoteType, any source, not soft-deleted) with a
 *     value > 0, dated by its last `history` entry to "won" (fallback
 *     updatedAt, then createdAt);
 *   - every project whose `quoteId` is empty or does not point to a counted
 *     won quote — this is where Daylite won history lives (and where a quote
 *     that was won then un-won leaves its project) — with a known value > 0,
 *     dated by its close (the last stage change into a done stage, supplied
 *     by the loader as `closedAt`) ?? `startedAt` ?? `createdAt`. Several
 *     projects pointing at the same uncounted quote count once;
 *   - every Daylite-imported repair record on the same rule.
 * `valueUnknown` (UKN) records never count. A won quote counts `value` PLUS
 * the Rewards credit applied on it (#282 phase 2 — `value` is net of credit,
 * and credit doesn't reduce spend).
 *
 * Company-level: a purchase belongs to its `customerId`; records without one
 * are dropped (a contact's purchases already carry their company's id).
 */

export type SpendQuote = {
  id: string;
  /** What people see (the estimate number); falls back to the id. */
  ref?: string;
  name?: string;
  customerId: string | null;
  status: string;
  /** Net of any Rewards credit (what the customer pays). */
  value: number;
  /** #282 phase 2: the Rewards credit applied on the quote (added back). */
  credit?: number;
  quoteType?: string;
  source?: string;
  history?: { at: number; from?: string; to: string }[];
  createdAt?: number;
  updatedAt?: number;
  deleted?: boolean;
};

export type SpendProject = {
  id: string;
  name?: string;
  customerId: string | null;
  quoteId: string | null;
  value: number;
  valueUnknown?: boolean;
  closedAt?: number | null;
  startedAt?: number | null;
  createdAt?: number;
  imported?: boolean;
  deleted?: boolean;
};

export type SpendRepair = {
  id: string;
  title?: string;
  customerId: string | null;
  quoteId: string | null;
  value: number;
  valueUnknown?: boolean;
  completedAt?: number | null;
  approvedAt?: number | null;
  createdAt?: number;
  /** Only Daylite-imported repairs count (spec §2); the loader sets this. */
  imported: boolean;
  deleted?: boolean;
};

export type PurchaseKind = "quote" | "project" | "repair";

export type Purchase = {
  kind: PurchaseKind;
  id: string;
  /** Display reference — a quote's estimate number, else the record id. */
  ref: string;
  companyId: string;
  name: string;
  amount: number;
  at: number;
  /** Daylite history (import), as opposed to a sale made in this app. */
  imported: boolean;
  quoteType?: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** When a quote was won: the last history entry to "won", else updatedAt, else createdAt. */
export function wonAt(q: Pick<SpendQuote, "history" | "updatedAt" | "createdAt">): number {
  const h = Array.isArray(q.history) ? q.history : [];
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i]?.to === "won" && typeof h[i].at === "number") return h[i].at;
  }
  return q.updatedAt || q.createdAt || 0;
}

function known(v: { value: number; valueUnknown?: boolean }): boolean {
  return v.valueUnknown !== true && typeof v.value === "number" && Number.isFinite(v.value) && v.value > 0;
}

/** Every counted purchase across all companies, newest first. */
export function purchasesFrom(input: {
  quotes: SpendQuote[];
  projects?: SpendProject[];
  repairs?: SpendRepair[];
}): Purchase[] {
  const out: Purchase[] = [];
  const counted = new Set<string>();
  for (const q of input.quotes) {
    const credit = typeof q.credit === "number" && Number.isFinite(q.credit) && q.credit > 0 ? q.credit : 0;
    const gross = { value: (Number.isFinite(q.value) ? q.value : 0) + credit };
    if (q.deleted || q.status !== "won" || !q.customerId || !known(gross)) continue;
    counted.add(q.id);
    out.push({
      kind: "quote",
      id: q.id,
      ref: q.ref || q.id,
      companyId: q.customerId,
      name: q.name || q.id,
      amount: round2(gross.value),
      at: wonAt(q),
      imported: q.source === "daylite",
      quoteType: q.quoteType || "system",
    });
  }
  // One sale per uncounted quote id across projects AND repairs.
  const claimed = new Set<string>();
  const takesQuote = (quoteId: string | null): boolean => {
    const qid = (quoteId || "").trim();
    if (!qid) return true;
    if (counted.has(qid) || claimed.has(qid)) return false;
    claimed.add(qid);
    return true;
  };
  for (const p of input.projects || []) {
    if (p.deleted || !p.customerId || !known(p)) continue;
    if (!takesQuote(p.quoteId)) continue;
    out.push({
      kind: "project",
      id: p.id,
      ref: p.id,
      companyId: p.customerId,
      name: p.name || p.id,
      amount: round2(p.value),
      at: p.closedAt ?? p.startedAt ?? p.createdAt ?? 0,
      imported: !!p.imported,
    });
  }
  for (const r of input.repairs || []) {
    if (r.deleted || !r.imported || !r.customerId || !known(r)) continue;
    if (!takesQuote(r.quoteId)) continue;
    out.push({
      kind: "repair",
      id: r.id,
      ref: r.id,
      companyId: r.customerId,
      name: r.title || r.id,
      amount: round2(r.value),
      at: r.completedAt ?? r.approvedAt ?? r.createdAt ?? 0,
      imported: true,
    });
  }
  return out.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}

export function lifetimeSpend(purchases: Pick<Purchase, "amount">[]): number {
  return round2(purchases.reduce((s, p) => s + p.amount, 0));
}

/** Purchases grouped by company (each list keeps the input's order). */
export function purchasesByCompany(purchases: Purchase[]): Map<string, Purchase[]> {
  const out = new Map<string, Purchase[]>();
  for (const p of purchases) {
    const list = out.get(p.companyId);
    if (list) list.push(p);
    else out.set(p.companyId, [p]);
  }
  return out;
}
