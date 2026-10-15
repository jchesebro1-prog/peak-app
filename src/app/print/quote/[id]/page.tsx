import { notFound } from "next/navigation";
import QuoteDocument, { QUOTE_PRINT_CSS } from "@/app/(app)/estimator/quote-document";
import { quoteDocumentDataFor } from "@/lib/quote-pdf/quote-document-data";
import { pdfKindForQuoteType, type PdfKind } from "@/lib/quote-pdf/state";
import { verifyPrintToken } from "@/lib/quote-pdf/token";
import { get as getCustomer } from "@/lib/stores/customers";
import { get as getQuote } from "@/lib/stores/quotes";
import { getSettings } from "@/lib/settings";
import { documentAddressee } from "@/lib/parties/addressee-server";
import { purchasePerksForCompany } from "@/lib/stores/reward-perks";
import { purchasePerksDocLine } from "@/lib/rewards/purchase-perks";
import { keyProductPhotoDataUris } from "@/lib/narrative/photos";
import { normalizePdfOptions } from "@/lib/quote-pdf/pdf-options";
import { quoteAsOfRevision } from "@/lib/quote-share/view";
import { loadCutSheets } from "@/lib/curtain-cut-sheets/load";
import { CUT_SHEET_APPEND_LOAD_MS, settleWithin } from "@/lib/curtain-cut-sheets/deadline";
import { CutSheetPages, CLIENT_PRINT_CSS } from "@/components/cutsheets/cut-sheet-pages";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quote", robots: { index: false, follow: false } };

/** The 120 s print token (#222) — fails closed on anything but a valid,
 *  unexpired signature for exactly this kind + id. Module-level so the
 *  clock read stays out of the component body (react-hooks/purity). */
function tokenOk(t: string | undefined, kind: PdfKind, id: string): boolean {
  return !!t && verifyPrintToken(process.env.AUTH_SECRET || "", t, kind, id, Date.now());
}

/**
 * Signed print route for an Estimator quote (#222). Headless Chrome loads this
 * with a 120 s token and prints it to the saved PDF. Outside the team login
 * (middleware exempts /print/); the token is the only key, checked before any
 * read. Renders from saved data only — the same QuoteDocument the team sees.
 */
export default async function PrintQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const t = Array.isArray(sp.t) ? sp.t[0] : sp.t;
  // #348 2b-i: a per-bidder variant (`?bidder=pty_…`) needs a token signed for `${id}~${bidder}`; a plain-id token never unlocks it.
  // A bidder param that is present but malformed (or repeated) is a 404, never a fall-through to the plain document.
  const rawBidder = sp.bidder;
  if (rawBidder !== undefined && (typeof rawBidder !== "string" || rawBidder.length > 64 || !/^pty_[0-9a-f]{16}$/.test(rawBidder))) notFound();
  const bidder = typeof rawBidder === "string" ? rawBidder : null;
  // #348 2b-ii: `rev` renders the SENT revision a bidder received — only together with a valid bidder; a malformed, repeated or bidder-less rev is a 404.
  const rawRev = sp.rev;
  if (rawRev !== undefined && (!bidder || typeof rawRev !== "string" || !/^[1-9]\d{0,5}$/.test(rawRev))) notFound();
  const rev = typeof rawRev === "string" ? Number(rawRev) : null;
  if (!tokenOk(t, "quote", bidder ? (rev ? `${id}~${bidder}~r${rev}` : `${id}~${bidder}`) : id)) notFound();
  const q = await getQuote(id);
  if (!q || pdfKindForQuoteType(q.quoteType) !== "quote") notFound();
  // A sent revision renders as it was sent; any other rev (missing, a draft/recall cut) is a 404.
  const revision = rev ? (Array.isArray(q.revisions) ? q.revisions : []).find((r) => r.rev === rev && r.reason === "sent") : null;
  if (rev && !revision) notFound();
  const src = revision ? quoteAsOfRevision(q, revision) : q;
  const [addressee, cust, settings, perks, cutSheets] = await Promise.all([
    // Strict: an explicit bidder that is no longer a live bidder on this quote (deleted since signing) is a 404, never the awarded default.
    bidder ? documentAddressee(src, bidder, { strict: true }) : documentAddressee(q),
    getCustomer(src.customerId),
    getSettings(),
    // #282 perks+points — the customer's purchase perks line (program on only).
    purchasePerksForCompany(src.customerId),
    // #292 — Client-style cut sheets after the estimate, only when the quote asks for them. A failure or a slow load (8 s) drops them, never the PDF — and says so in the server log.
    normalizePdfOptions(src.pdfOptions).pdfCutSheets ? settleWithin(loadCutSheets(id, { images: "data" }), CUT_SHEET_APPEND_LOAD_MS, `[cutsheets] estimate PDF ${id}`) : null,
  ]);
  if (bidder && !addressee) notFound();
  const doc = quoteDocumentDataFor(src, cust, settings, addressee);
  // #293: key-product photos inlined as data URIs (this route has no session).
  // Never throws — a photo that can't be read just isn't printed.
  // Phase 5: plus the package document's photo-on product blocks.
  const keyProductPhotos = await keyProductPhotoDataUris(doc.sections, doc.document);
  return (
    <main>
      <style>{QUOTE_PRINT_CSS}</style>
      <QuoteDocument {...doc} keyProductPhotos={keyProductPhotos} rewardsLine={purchasePerksDocLine(perks)} />
      {/* #292 — its own page after the estimate; the Client resets (width/padding) ride along. */}
      {cutSheets?.ok && cutSheets.models.client.length > 0 && (
        <div style={{ breakBefore: "page" }}>
          <style>{CLIENT_PRINT_CSS}</style>
          <CutSheetPages models={cutSheets.models.client} style="client" photos={cutSheets.photos} />
        </div>
      )}
    </main>
  );
}
