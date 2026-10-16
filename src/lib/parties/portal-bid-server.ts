/* #348 slice 6 — the ONLY portal code that reads `record_parties`. Portal routes and pages import this module, never
   stores/parties, stores/bids or addressee-server (pinned). The rule itself is pure (portal-bid.ts, composed by
   quote-pdf/portal-access.ts); this module loads the rows it decides over and serves the bidder's own PDF. */
import { attachmentDisposition } from "@/lib/document-files";
import { getCompany } from "@/lib/identity/companies";
import { bidderPdfFileName } from "@/lib/parties/addressee";
import { bidderPartyFor } from "@/lib/parties/addressee-server";
import { catalogFor } from "@/lib/estimate-output/package-loader";
import { PORTAL_BID_COPY, quoteIsScopeOnly, type PortalBidRow } from "@/lib/parties/portal-bid";
import { ownerBom, ownerBomSkus, type OwnerBom } from "@/lib/parties/portal-owner-bom";
import type { Party } from "@/lib/parties/rules";
import { renderBidderPdf } from "@/lib/quote-pdf/bidder-pdf-server";
import { rateLimit } from "@/lib/rate-limit";
import { listFor, listForCompany, listForRecordsIncludingDeleted } from "@/lib/stores/parties";
import type { Quote, QuoteRevision } from "@/lib/stores/quotes";

/** Only the fields the rule reads — the portal never holds a party's contact, author or timestamps. */
function toRow(p: Party): PortalBidRow {
  return { id: p.id, recordType: p.recordType, recordId: p.recordId, companyId: p.companyId, role: p.role, bid: p.bid };
}

/** A live GC/EC quote bidder row of this company (the pure rule re-checks every one of these). */
function isCompanyBidRow(p: Party, cid: string): boolean {
  return !!p && !!p.id && p.recordType === "quote" && p.companyId === cid && (p.role === "gc" || p.role === "ec") && !!p.bid;
}

/** This company's bidder rows on one quote — [] without a read when cid is the quote's customer (or empty). */
export async function portalBidRowsFor(q: Pick<Quote, "id" | "customerId">, cid: string): Promise<PortalBidRow[]> {
  if (!cid || !q?.id || q.customerId === cid) return [];
  const rows = await listFor("quote", q.id);
  return rows.filter((p) => p.recordId === q.id && isCompanyBidRow(p, cid)).map(toRow);
}

/** Every quote bidder row of this company (listForCompany — indexed), for Home. */
export async function portalBidRowsForCompany(cid: string): Promise<PortalBidRow[]> {
  if (!cid) return [];
  return (await listForCompany(cid)).filter((p) => isCompanyBidRow(p, cid)).map(toRow);
}

/** The quote fields the Scope-only rule reads: its id and its own stamp. */
type ScopeQuote = Pick<Quote, "id" | "bidScopeOnly">;

/** Task 3 + final fix (Jeff 2026-10-15) — which of these quotes are "Scope only" for their owner, for good:
 *  quoteIsScopeOnly (the stamp, else a GC/EC bidder row INCLUDING removed ones). Stamped quotes need no read; the
 *  rest are one read bounded to their ids (listForRecordsIncludingDeleted, chunked). The ONE server check: the page,
 *  PDF and photo routes, the owner-portal writes (portalOwnerHasBidders), Home and My quotes all come through here. */
export async function portalBidderQuoteIds(quotes: readonly ScopeQuote[]): Promise<Set<string>> {
  const out = new Set<string>();
  const unstamped: string[] = [];
  for (const q of quotes) {
    if (!q || typeof q.id !== "string" || !q.id) continue;
    if (quoteIsScopeOnly(q, [])) out.add(q.id);
    else unstamped.push(q.id);
  }
  const ids = [...new Set(unstamped)];
  if (!ids.length) return out;
  for (const [id, rows] of await listForRecordsIncludingDeleted("quote", ids)) {
    if (quoteIsScopeOnly({ id }, rows.map(toRow))) out.add(id);
  }
  return out;
}

/** Task 3 — whether this quote is Scope only (portalBidderQuoteIds over one quote). Takes no company: the caller
 *  decides it is the owner (q.customerId === cid); a bidder company is the bidder rule's call. */
export async function portalQuoteHasBidders(q: ScopeQuote): Promise<boolean> {
  if (!q?.id) return false;
  return (await portalBidderQuoteIds([q])).has(q.id);
}

/** Task 3 — the ONE owner check every portal route and write spells the same way: the session company is this
 *  quote's customer AND the quote is Scope only. Any other company (or an empty cid) → false without a read. */
export async function portalOwnerHasBidders(q: Pick<Quote, "id" | "customerId" | "bidScopeOnly">, cid: string): Promise<boolean> {
  if (!cid || !q?.id || q.customerId !== cid) return false;
  return portalQuoteHasBidders(q);
}

/** Final fix (Jeff 2026-10-15) — a NEW estimate made from another one (Move system → New estimate, Copy system → New
 *  estimate) inherits "Scope only" from its source through the same rule (portalQuoteHasBidders), but only when it
 *  is for the SAME customer: a different owner never saw the bid. Fails closed: a source read that failed, or a rule
 *  read that throws, stamps it (an owner seeing no prices is recoverable; prices shown after a bid are not) and
 *  reports `failedClosed` so the caller logs both quote ids once the new one exists. No source (unsaved) → false. */
export async function newEstimateScopeOnly(
  source: Pick<Quote, "id" | "bidScopeOnly" | "customerId"> | null,
  sourceReadFailed: boolean,
  targetCustomerId: string | null
): Promise<{ stamp: boolean; failedClosed: boolean }> {
  if (sourceReadFailed) return { stamp: true, failedClosed: true };
  if (!source?.id) return { stamp: false, failedClosed: false };
  if ((source.customerId || null) !== (targetCustomerId || null)) return { stamp: false, failedClosed: false };
  try {
    return { stamp: await portalQuoteHasBidders(source), failedClosed: false };
  } catch (e) {
    console.error(`newEstimateScopeOnly(${source.id}): the bidder read failed — stamping the new estimate Scope only`, e);
    return { stamp: true, failedClosed: true };
  }
}

/** Task 3 — the owner's BOM-only view of a bid estimate's sent revision: the pure ownerBom over the package page's
 *  catalog read (catalogFor never fails the page — a read error leaves Manufacturer / Model blank). */
export async function portalOwnerBom(q: Quote, rev: QuoteRevision, preparedFor: string): Promise<OwnerBom> {
  return ownerBom(q, rev, await catalogFor(ownerBomSkus(rev)), preparedFor);
}

export const PORTAL_BID_PDF_PER_MIN = 6;

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });

async function bidderCompanyName(partyId: string, quoteId: string): Promise<string> {
  const party = await bidderPartyFor(quoteId, partyId);
  return party ? ((await getCompany(party.companyId))?.name ?? "") : "";
}

/** The bidder's PDF response: rate limit (key by grant, or `preview:<cid>`) → render(q.id, partyId, host, proto, { rev })
 *  → inline application/pdf, nosniff, private no-store, file name bidderPdfFileName(src.name, companyName, src.rev)
 *  (the revision's name — never a later one). 404 → "Not found"; 503/500 → PORTAL_BID_COPY.pdfUnavailable with the same
 *  status (controller decision: the render's own text can name server env vars, so it is logged, never shown). */
export async function portalBidPdfResponse(
  req: Request,
  src: { partyId: string; rev: number; name: string },
  ctx: { quoteId: string; rlKey: string },
  deps: { render?: typeof renderBidderPdf; companyName?: (partyId: string) => Promise<string> } = {}
): Promise<Response> {
  if (!rateLimit(ctx.rlKey, PORTAL_BID_PDF_PER_MIN, 60_000).ok) return text("Too many requests", 429);
  const h = req.headers;
  const render = deps.render ?? renderBidderPdf;
  const r = await render(ctx.quoteId, src.partyId, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"), { rev: src.rev });
  if (!r.ok) {
    if (r.status === 404) return text("Not found", 404);
    console.error(`[portal-bid-pdf] ${ctx.quoteId}: render failed (${r.status})`, r.error);
    return text(PORTAL_BID_COPY.pdfUnavailable, r.status);
  }
  const companyName = deps.companyName ? await deps.companyName(src.partyId) : await bidderCompanyName(src.partyId, ctx.quoteId);
  // The revision's own name and number — the render's file name follows the live quote, so it is never used here.
  const disposition = attachmentDisposition(bidderPdfFileName(src.name, companyName, src.rev));
  return new Response(new Uint8Array(r.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": "inline" + disposition.slice("attachment".length),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
