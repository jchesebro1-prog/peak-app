/**
 * Opportunities (#18) — the merged lead+quote pipeline as a PURE read-time
 * model. Jeff's answer to item 18 decision A was "the merged opportunity
 * concept"; the controller-decided shape (D119) is a read-time UNION over
 * the two existing stores — no new record type, no migration. This module
 * has ZERO imports: every function takes plain lead/quote-shaped inputs
 * (structural types below), so the server page, the server-action validator
 * and the spec harness all consume the same logic.
 *
 * Column vocabulary (Daylite bid stages):
 *   new → collect → estimate → estimate_sent → closed (Won / Lost) → po_received
 * Lead cards live in the four open columns (a converted lead hands off to
 * its quote); closed holds every won/lost card; po_received is a won-quote
 * annex column driven by Quote.poReceivedAt — a field, not a fifth status.
 */

const DAY = 86400000;

export const OPP_COLUMNS = [
  { key: "new", label: "New", dot: "#c85a3c" },
  { key: "collect", label: "Collect Info", dot: "#c8a53c" },
  { key: "estimate", label: "Estimate", dot: "#3d6fd0" },
  { key: "estimate_sent", label: "Estimate Sent", dot: "#7b5fb0" },
  { key: "closed", label: "Won / Lost", dot: "#2f9d6b" },
  { key: "po_received", label: "PO Received", dot: "#1f7a52" },
] as const;
export type OppColKey = (typeof OPP_COLUMNS)[number]["key"];

export const OPEN_OPP_COLUMNS: readonly OppColKey[] = [
  "new",
  "collect",
  "estimate",
  "estimate_sent",
] as const;

/* ---- structural inputs (subsets of LeadRecord / Quote — no store imports) ---- */

export type OppLeadInput = {
  id: string;
  org: string;
  interest: string;
  stage: string;
  owner: string;
  value: number;
  createdAt: number;
  updatedAt: number;
  customerId: string | null;
  convertedCustomerId: string | null;
  convertedQuoteId: string | null;
  forecastAt: number | null;
};

export type OppQuoteInput = {
  id: string;
  name: string;
  customer: string;
  status: string;
  owner: string;
  value: number;
  createdAt: number;
  updatedAt: number;
  customerId: string | null;
  poReceivedAt: number | null;
};

export type OppRow = {
  id: string; // "L-####" | "Q-####" — the prefix is the source discriminator
  kind: "lead" | "quote";
  col: OppColKey;
  title: string; // lead.org / quote.name
  sub: string; // lead.interest / quote.customer
  value: number;
  owner: string;
  createdAt: number;
  updatedAt: number;
  /** lead: customerId ?? convertedCustomerId; quote: customerId. */
  companyId: string | null;
  /** Lead's own forecastAt; a quote card inherits its originating lead's. */
  forecastAt: number | null;
  /** lead.stage / quote.status — drives allowedMoves + the Won/Lost chip. */
  srcStage: string;
};

/* ---- stage → column mapping ---- */

export function leadColumn(stage: string): OppColKey | null {
  switch (stage) {
    case "new": return "new";
    case "contacted": return "collect";
    case "qualified": return "estimate";
    case "quoted": return "estimate_sent";
    case "won": return "closed";
    case "lost": return "closed";
    default: return null;
  }
}

export function quoteColumn(q: Pick<OppQuoteInput, "status" | "poReceivedAt">): OppColKey | null {
  switch (q.status) {
    case "draft": return "estimate";
    case "sent": return "estimate_sent";
    case "lost": return "closed";
    case "won": return q.poReceivedAt ? "po_received" : "closed";
    default: return null;
  }
}

/** Map an open board column back to the lead stage a drag should write. */
export function leadStageForCol(
  col: string
): "new" | "contacted" | "qualified" | "quoted" | null {
  switch (col) {
    case "new": return "new";
    case "collect": return "contacted";
    case "estimate": return "qualified";
    case "estimate_sent": return "quoted";
    default: return null;
  }
}

/** PO-received is only meaningful on a won quote (D119). */
export function canSetPoReceived(status: string): boolean {
  return status === "won";
}

/* ---- the union ---- */

/**
 * Build the merged board rows. A converted lead (non-null convertedQuoteId)
 * is EXCLUDED — its quote carries the opportunity from there — but its
 * forecastAt is inherited onto that quote's card. ALL quoteTypes ride the
 * board (flame_test / repair / inspection / consulting bids are pipeline
 * too — product flag for Jeff, D119).
 */
export function buildOpportunities(
  leads: OppLeadInput[],
  quotes: OppQuoteInput[]
): OppRow[] {
  const leadByQuote = new Map<string, OppLeadInput>();
  for (const l of leads) if (l.convertedQuoteId) leadByQuote.set(l.convertedQuoteId, l);

  const rows: OppRow[] = [];
  for (const l of leads) {
    if (l.convertedQuoteId) continue;
    const col = leadColumn(l.stage);
    if (!col) continue;
    rows.push({
      id: l.id,
      kind: "lead",
      col,
      title: l.org,
      sub: l.interest,
      value: l.value || 0,
      owner: l.owner || "",
      createdAt: l.createdAt || 0,
      updatedAt: l.updatedAt || 0,
      companyId: l.customerId ?? l.convertedCustomerId ?? null,
      forecastAt: l.forecastAt ?? null,
      srcStage: l.stage,
    });
  }
  for (const q of quotes) {
    const col = quoteColumn(q);
    if (!col) continue;
    rows.push({
      id: q.id,
      kind: "quote",
      col,
      title: q.name,
      sub: q.customer,
      value: q.value || 0,
      owner: q.owner || "",
      createdAt: q.createdAt || 0,
      updatedAt: q.updatedAt || 0,
      companyId: q.customerId ?? null,
      forecastAt: leadByQuote.get(q.id)?.forecastAt ?? null,
      srcStage: q.status,
    });
  }
  return rows;
}

/* ---- drag policy ---- */

/**
 * Which columns a card may be dragged to (also re-checked server-side).
 * - Lead cards move freely among the four OPEN columns; never into or out
 *   of closed by drag — won/lost keep their deliberate paths (convert flow,
 *   markLost-with-reason).
 * - Quote cards move ONLY closed ↔ po_received, and only when won.
 */
export function allowedMoves(
  row: Pick<OppRow, "kind" | "col" | "srcStage">
): OppColKey[] {
  if (row.kind === "lead") {
    return OPEN_OPP_COLUMNS.includes(row.col)
      ? OPEN_OPP_COLUMNS.filter((c) => c !== row.col)
      : [];
  }
  if (!canSetPoReceived(row.srcStage)) return [];
  if (row.col === "closed") return ["po_received"];
  if (row.col === "po_received") return ["closed"];
  return [];
}

/* ---- filters (URL params — "" = filter off) ---- */

export type OppFilters = {
  /** Resolved display name (page maps "mine" → session name); "" = everyone. */
  who: string;
  created: "" | "7d" | "30d" | "90d";
  forecast: "" | "30d" | "90d" | "past";
  /** Exact keyword tag, case-insensitive; "" = off. */
  kw: string;
  /** One of CUSTOMER_TYPES; "" = all. */
  vt: string;
};

export type CompanyFacts = Map<string, { type: string; keywords: string[] }>;

const CREATED_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;

/**
 * Apply the toolbar filters. forecast / kw / vt EXCLUDE cards that lack the
 * facet while the filter is active (no forecast date, no linked company, or
 * a company with no match) — an active filter never shows unknowable cards.
 */
export function applyOppFilters(
  rows: OppRow[],
  f: OppFilters,
  facts: CompanyFacts,
  nowMs: number
): OppRow[] {
  return rows.filter((r) => {
    if (f.who && r.owner !== f.who) return false;
    if (f.created && r.createdAt < nowMs - CREATED_DAYS[f.created] * DAY) return false;
    if (f.forecast) {
      if (r.forecastAt == null) return false;
      if (f.forecast === "past") {
        if (r.forecastAt >= nowMs) return false;
      } else {
        const horizon = f.forecast === "30d" ? 30 : 90;
        if (r.forecastAt < nowMs || r.forecastAt >= nowMs + horizon * DAY) return false;
      }
    }
    if (f.kw || f.vt) {
      const co = r.companyId ? facts.get(r.companyId) : undefined;
      if (!co) return false;
      if (f.kw && !co.keywords.some((k) => k.toLowerCase() === f.kw.toLowerCase())) return false;
      if (f.vt && co.type !== f.vt) return false;
    }
    return true;
  });
}

/* ---- header total + age chip ---- */

/** Count + $ across the four OPEN columns ("12 opportunities • $431,200 open pipeline"). */
export function openTotals(rows: OppRow[]): { count: number; value: number } {
  const open = rows.filter((r) => OPEN_OPP_COLUMNS.includes(r.col));
  return { count: open.length, value: open.reduce((a, r) => a + (r.value || 0), 0) };
}

/** Age-in-days chip from createdAt — "3d" under two weeks, then "2w" (the #18 ask). */
export function ageLabel(createdAt: number, nowMs: number): string {
  const d = Math.max(0, Math.floor((nowMs - createdAt) / DAY));
  return d < 14 ? d + "d" : Math.floor(d / 7) + "w";
}
