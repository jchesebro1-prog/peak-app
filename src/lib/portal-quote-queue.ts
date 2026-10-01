/**
 * Staff Portal quotes work queue (#288, spec §1.7) — `/quotes/portal`. Pure
 * and client-safe: the page hands in the quotes it already loaded (and how to
 * name a quote's company); this module classifies, filters, counts and sorts.
 * No pricing here — a row's total is the quote's own `value`, as on the hub.
 */
import { displayQuoteNumber, quoteMatchesSearch } from "@/lib/estimate-number";
import { isCustomerBuiltQuote } from "@/lib/portal-quote-names";
import { approveKeepsAcceptedPrice } from "@/lib/portal-quote-mode";

export type PortalQueueStatus = "review" | "accepted" | "sent" | "expired" | "won" | "lost" | "draft";
export const PORTAL_QUEUE_STATUSES: readonly PortalQueueStatus[] = ["review", "accepted", "sent", "expired", "won", "lost", "draft"];
export const PORTAL_QUEUE_STATUS_LABEL: Record<PortalQueueStatus, string> = {
  review: "Needs review",
  accepted: "Accepted — confirm",
  sent: "Sent",
  expired: "Expired",
  won: "Won",
  lost: "Lost",
  draft: "Draft",
};

/** The status chips: Needs action (the default), All, then each status. */
export type PortalQueueFilter = "action" | "all" | PortalQueueStatus;
const FILTERS: readonly PortalQueueFilter[] = ["action", "all", ...PORTAL_QUEUE_STATUSES];

export type PortalQueueType = "catalog" | "flame_test" | "inspection";
export type PortalQueueTypeFilter = "all" | PortalQueueType;
export const PORTAL_QUEUE_TYPES: readonly PortalQueueType[] = ["catalog", "flame_test", "inspection"];
export const PORTAL_QUEUE_TYPE_LABEL: Record<PortalQueueType, string> = {
  catalog: "Catalog",
  flame_test: "Flame test",
  inspection: "Inspection",
};

/** Which existing approve an Accepted — confirm row runs. */
export type PortalQueueApprove = "catalog" | "flame" | "inspection";

/** The fields the queue reads — a `Quote` satisfies it. */
export type PortalQueueFields = {
  id: string;
  name?: string | null;
  customer?: string | null;
  status: string;
  source?: string | null;
  quoteType?: string | null;
  estNo?: number;
  estSuffix?: number;
  createdAt?: number;
  updatedAt?: number;
  portalAcceptance?: unknown;
  portalReview?: unknown;
  portalFirm?: { validUntil: number } | null;
};

export type PortalQueueRow<T> = {
  q: T;
  status: PortalQueueStatus;
  statusLabel: string;
  type: PortalQueueType;
  typeLabel: string;
  company: string;
  estNo: string;
  needsAction: boolean;
  /** Set only on Accepted — confirm rows whose type has an approve path. */
  approve: PortalQueueApprove | null;
  /** Decline the customer's acceptance — Accepted — confirm rows only. */
  decline: boolean;
};

/** Where a bell item (or anything else) points staff at one portal quote. */
export function portalQueueHref(id: string): string {
  return "/quotes/portal?focus=" + encodeURIComponent(id);
}

export function parsePortalQueueFilter(raw: string): PortalQueueFilter {
  return (FILTERS as readonly string[]).includes(raw) ? (raw as PortalQueueFilter) : "action";
}

export function parsePortalQueueType(raw: string): PortalQueueTypeFilter {
  return (PORTAL_QUEUE_TYPES as readonly string[]).includes(raw) ? (raw as PortalQueueType) : "all";
}

/**
 * Won / Lost first (decided is decided); then a customer acceptance on a sent
 * quote awaiting Peak; a price-on-request generation not yet sent; a sent
 * quote, Expired once now is past a firm quote's `validUntil`; else Draft.
 */
export function portalQueueStatus(q: PortalQueueFields, now: number): PortalQueueStatus {
  if (q.status === "won") return "won";
  if (q.status === "lost") return "lost";
  if (q.status === "sent" && q.portalAcceptance) return "accepted";
  if (q.portalReview && q.status !== "sent") return "review";
  if (q.status === "sent") return q.portalFirm && now > q.portalFirm.validUntil ? "expired" : "sent";
  return "draft";
}

/** Flame test / Inspection by quoteType; everything else (the portal
 *  catalog and the legacy self-serve estimate) is Catalog. */
export function portalQueueType(q: { quoteType?: string | null }): PortalQueueType {
  return q.quoteType === "flame_test" ? "flame_test" : q.quoteType === "inspection" ? "inspection" : "catalog";
}

function approveFor(q: PortalQueueFields, type: PortalQueueType): PortalQueueApprove | null {
  if (type === "catalog") return "catalog";
  // The flame/inspection approve keeps the accepted price only for an
  // accepted portal-service quote; anything else would need the builder's
  // full form, so it's Open-only here.
  if (!approveKeepsAcceptedPrice({ source: q.source, status: q.status, portalAcceptance: q.portalAcceptance })) return null;
  return type === "flame_test" ? "flame" : "inspection";
}

export function portalQueueView<T extends PortalQueueFields>(
  quotes: readonly T[],
  opts: {
    now: number;
    status?: PortalQueueFilter;
    type?: PortalQueueTypeFilter;
    q?: string;
    /** `?focus=<id>` — forces the status filter to All. */
    focus?: string | null;
    /** The company name the page shows (the hub's customerLabel); default `q.customer`. */
    companyOf?: (q: T) => string;
  }
): {
  status: PortalQueueFilter;
  type: PortalQueueTypeFilter;
  rows: PortalQueueRow<T>[];
  counts: Record<PortalQueueFilter, number>;
} {
  const status: PortalQueueFilter = opts.focus ? "all" : opts.status ?? "action";
  const type: PortalQueueTypeFilter = opts.type ?? "all";
  const term = (opts.q || "").trim();
  const companyOf = opts.companyOf ?? ((q: T) => q.customer || "");

  const rows: PortalQueueRow<T>[] = [];
  for (const q of quotes) {
    if (!isCustomerBuiltQuote(q)) continue;
    const t = portalQueueType(q);
    if (type !== "all" && t !== type) continue;
    const company = companyOf(q) || q.customer || "";
    if (term && !quoteMatchesSearch(q, term) && !company.toLowerCase().includes(term.toLowerCase())) continue;
    const st = portalQueueStatus(q, opts.now);
    const accepted = st === "accepted";
    rows.push({
      q,
      status: st,
      statusLabel: PORTAL_QUEUE_STATUS_LABEL[st],
      type: t,
      typeLabel: PORTAL_QUEUE_TYPE_LABEL[t],
      company,
      estNo: displayQuoteNumber(q),
      needsAction: st === "review" || accepted,
      approve: accepted ? approveFor(q, t) : null,
      // Legacy portal-self-serve acceptances predate the Decline flow
      // (declinePortalAcceptance) — approve only.
      decline: accepted && q.source !== "portal-self-serve",
    });
  }

  const counts = { action: 0, all: rows.length } as Record<PortalQueueFilter, number>;
  for (const s of PORTAL_QUEUE_STATUSES) counts[s] = 0;
  for (const r of rows) {
    counts[r.status]++;
    if (r.needsAction) counts.action++;
  }

  const created = (q: T) => q.createdAt || q.updatedAt || 0;
  const shown = rows
    .filter((r) => status === "all" || (status === "action" ? r.needsAction : r.status === status))
    .sort((a, b) => Number(b.needsAction) - Number(a.needsAction) || created(b.q) - created(a.q));
  return { status, type, rows: shown, counts };
}
