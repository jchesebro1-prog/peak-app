/* #348 slice 6 — the portal's bidder rule (spec §5 Portal, decisions #3/#9). Pure and browser-safe: types only from
   stores, no reads. portal-access.ts composes it; portal-bid-server.ts loads the rows. */
import type { Party } from "./rules";
import type { Quote, QuoteRevision } from "@/lib/stores/quotes";
import { pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { bidDueText } from "./bids";

export type PortalBidRow = Pick<Party, "id" | "recordType" | "recordId" | "companyId" | "role" | "bid">;
export type PortalBid = {
  partyId: string;
  role: "gc" | "ec";
  result: "pending" | "awarded";
  /** The sent revision this company sees: its delivered copy (revSent) or a later sent revision addressed to it (award). */
  rev: QuoteRevision;
  via: "sent" | "award";
  /** The due date as that revision printed it (docFields.bid, else the live bid on revisions without one). */
  dueAt: number | null;
};
export type PortalBidState = { kind: "ok"; bid: PortalBid; closed: boolean } | { kind: "revising" } | { kind: "unavailable" };
type BidQuote = Pick<Quote, "id" | "customerId" | "status" | "source" | "quoteType" | "revisions" | "bid">;
type Candidate = { rev: QuoteRevision; via: "sent" | "award" };

const UNAVAILABLE: PortalBidState = { kind: "unavailable" };

/** The due date a revision printed: its frozen bid when it has one, else the live bid (older revisions). */
export function portalBidDueAt(q: Pick<Quote, "bid">, rev: Pick<QuoteRevision, "docFields">): number | null {
  const frozen = rev.docFields?.bid;
  const dueAt = frozen ? frozen.dueAt : q.bid?.dueAt;
  return typeof dueAt === "number" && Number.isFinite(dueAt) ? dueAt : null;
}

/** The sent revisions this party may see, oldest first (Jeff: the latest revision "sent OR addressed to them"):
 *  - via "sent": rev === revSent, which must be a safe integer pointing at a SENT revision (otherwise no "sent" candidate);
 *  - via "award": any sent revision frozen with docFields.awardedPartyId === party.id. These count on their own,
 *    even when revSent is null, and they survive Undo award (the revision stays addressed to that party).
 *  Whether the ROW may see anything at all (result, award match) is portalBidState's call, not this function's. */
export function portalBidCandidates(q: Pick<Quote, "revisions">, row: PortalBidRow): Candidate[] {
  const revSent = row.bid?.revSent;
  const revs = Array.isArray(q.revisions) ? q.revisions : [];
  const sentOk = typeof revSent === "number" && Number.isSafeInteger(revSent) && revs.some((r) => r && r.reason === "sent" && r.rev === revSent);
  const out: Candidate[] = [];
  for (const r of revs) {
    if (!r || r.reason !== "sent") continue;
    if (sentOk && r.rev === revSent) out.push({ rev: r, via: "sent" });
    // A row without an id never matches (undefined === undefined on a revision frozen without an award).
    else if (row.id && r.docFields?.awardedPartyId === row.id) out.push({ rev: r, via: "award" });
  }
  return out;
}

/**
 * The bidder rule. Unavailable unless ALL hold:
 *  - the row has an id;
 *  - cid non-empty and q.customerId !== cid (the customer rules decide the customer — never this one);
 *  - not Daylite history; pdf kind "quote" (system estimates);
 *  - a row with recordType "quote", recordId === q.id, companyId === cid, role gc|ec, bid set, result pending|awarded;
 *  - when q.bid.awardedPartyId is set, the row IS that party (a pending row on an awarded bid never counts);
 *  - at least one candidate revision.
 * Several qualifying rows (the same company as GC and EC): awarded first, then the latest candidate, then gc before ec.
 * Then by status: draft → revising (no content, not listed — the owner's recall rule);
 *  sent → ok (closed false); won → ok only for the awarded row (closed false), else unavailable;
 *  lost → ok closed true (pending or awarded row). The chosen revision is the LATEST candidate.
 */
export function portalBidState(q: BidQuote, cid: string, rows: readonly PortalBidRow[]): PortalBidState {
  if (!cid || q.customerId === cid) return UNAVAILABLE;
  if (q.source === "daylite") return UNAVAILABLE;
  if (pdfKindForQuoteType(q.quoteType) !== "quote") return UNAVAILABLE;
  const awardedId = q.bid?.awardedPartyId || null;
  let best: { row: PortalBidRow; cand: Candidate; at: number } | null = null;
  for (const row of rows) {
    if (!row || !row.id || row.recordType !== "quote" || row.recordId !== q.id || row.companyId !== cid) continue;
    if (row.role !== "gc" && row.role !== "ec") continue;
    const result = row.bid?.result;
    if (result !== "pending" && result !== "awarded") continue;
    if (awardedId && row.id !== awardedId) continue;
    const cands = portalBidCandidates(q, row);
    if (!cands.length) continue;
    const cand = cands[cands.length - 1];
    const at = (Array.isArray(q.revisions) ? q.revisions : []).indexOf(cand.rev);
    if (!best) { best = { row, cand, at }; continue; }
    const better =
      (row.bid!.result === "awarded") !== (best.row.bid!.result === "awarded")
        ? row.bid!.result === "awarded"
        : at !== best.at
          ? at > best.at
          : row.role === "gc" && best.row.role !== "gc";
    if (better) best = { row, cand, at };
  }
  if (!best) return UNAVAILABLE;
  if (q.status === "draft") return { kind: "revising" };
  const result = best.row.bid!.result as "pending" | "awarded";
  if (q.status === "won" && result !== "awarded") return UNAVAILABLE;
  if (q.status !== "sent" && q.status !== "won" && q.status !== "lost") return UNAVAILABLE;
  return {
    kind: "ok",
    closed: q.status === "lost",
    bid: {
      partyId: best.row.id,
      role: best.row.role as "gc" | "ec",
      result,
      rev: best.cand.rev,
      via: best.cand.via,
      dueAt: portalBidDueAt(q, best.cand.rev),
    },
  };
}

const issuedOf = (b: PortalBid): number => {
  const i = b.rev.docFields?.issuedAt;
  return typeof i === "number" && Number.isFinite(i) && i > 0 ? i : b.rev.at;
};

/** Home's Bids card: every quote with an ok state for this company (draft / unavailable dropped), newest sent first,
 *  split open (status sent) / history (won, lost). Quotes whose customerId === cid are never here (Your quotes lists them). */
export function portalBidList<T extends BidQuote>(
  quotes: readonly T[],
  cid: string,
  rows: readonly PortalBidRow[]
): { open: Array<{ q: T; bid: PortalBid; closed: boolean }>; history: Array<{ q: T; bid: PortalBid; closed: boolean }> } {
  const all: Array<{ q: T; bid: PortalBid; closed: boolean }> = [];
  for (const q of quotes) {
    const s = portalBidState(q, cid, rows);
    if (s.kind === "ok") all.push({ q, bid: s.bid, closed: s.closed });
  }
  all.sort((a, b) => issuedOf(b.bid) - issuedOf(a.bid));
  return { open: all.filter((x) => x.q.status === "sent"), history: all.filter((x) => x.q.status !== "sent") };
}

export const PORTAL_BID_COPY = {
  card: "Bids",
  cardSub: (company: string) => `bids ${company} sent you`,
  badge: "Bid",
  due: (when: string) => `Due ${when}`,
  submitted: "Bid submitted",
  awarded: "Awarded",
  closed: "Closed",
  /** Any non-404 bidder-PDF failure — the render's own text is staff-facing (env names) and is only logged. */
  pdfUnavailable: "The PDF couldn’t be made right now — try again in a minute.",
  /** Task 3 (Jeff 2026-10-15) — the owner's BOM-only view of a bid estimate: the one muted line, and its Home chip. */
  ownerBomNote: "Pricing for this project comes from your contractor.",
  ownerChip: "Scope only",
} as const;

/** #348 slice 6 Task 3 (Jeff 2026-10-15) — "has bidders": any GC/EC row on THIS quote with bid state, whatever its
 *  result (withdrew, lost, no bid all count). Owner, architect and vendor rows, a GC row with no bid state, and
 *  another record's rows never count. Once true, the owner's portal shows the estimate as a BOM with no prices. */
export function quoteHasBidders(quoteId: string, rows: readonly PortalBidRow[]): boolean {
  if (!quoteId) return false;
  return rows.some((r) => !!r && r.recordType === "quote" && r.recordId === quoteId && (r.role === "gc" || r.role === "ec") && !!r.bid);
}

/** Chip: sent+pending → due text (or "Bid submitted" with no due date); awarded (sent or won) → "Awarded"; lost → "Closed".
 *  Never "Lost", never a count or another company. */
export function portalBidChip(status: string, bid: PortalBid): string {
  if (status === "lost") return PORTAL_BID_COPY.closed;
  if (bid.result === "awarded") return PORTAL_BID_COPY.awarded;
  if (status !== "sent") return PORTAL_BID_COPY.closed;
  const when = bid.dueAt != null ? bidDueText(bid.dueAt) : "";
  return when ? PORTAL_BID_COPY.due(when) : PORTAL_BID_COPY.submitted;
}
