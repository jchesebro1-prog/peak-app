import peakLetterhead from "@/app/(app)/estimator/peak-letterhead.jpg";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import QuoteDocument, { QUOTE_PRINT_CSS, QUOTE_WEB_EMBED_CSS } from "@/app/(app)/estimator/quote-document";
import { bomViewProps } from "@/app/(app)/estimator/quote-document-view";
import { quoteDocumentDataFor } from "@/lib/quote-pdf/quote-document-data";
import { pdfKindForQuoteType, type PdfKind } from "@/lib/quote-pdf/state";
import { verifyPrintToken } from "@/lib/quote-pdf/token";
import { get as getCustomer } from "@/lib/stores/customers";
import { get as getQuote } from "@/lib/stores/quotes";
import { getSettings } from "@/lib/settings";
import { rewardsVisibleFor } from "@/lib/parties/addressee";
import { documentAddressee } from "@/lib/parties/addressee-server";
import { purchasePerksForCompany } from "@/lib/stores/reward-perks";
import { purchasePerksDocLine } from "@/lib/rewards/purchase-perks";
import { keyProductPhotoDataUris, loadKeyProductModels } from "@/lib/narrative/photos";
import { normalizePdfOptions } from "@/lib/quote-pdf/pdf-options";
import { quoteAsOfRevision } from "@/lib/quote-share/view";
import { loadCutSheets } from "@/lib/curtain-cut-sheets/load";
import { CUT_SHEET_APPEND_LOAD_MS, settleWithin } from "@/lib/curtain-cut-sheets/deadline";
import { CutSheetPages, CLIENT_PRINT_CSS } from "@/components/cutsheets/cut-sheet-pages";
import { printOriginFor } from "@/lib/quote-pdf/origin";
import { loadDatasheetLinkRows } from "@/lib/estimate-output/datasheet-links-server";
import DatasheetLinksPage from "@/components/estimate-output/datasheet-links-page";
import { boxSaleOf } from "@/lib/estimate-box-sale/rules";

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
 * `?view=bom` (2026-10-20) prints the BOM view instead — bomViewProps, no cut sheets, no photos — for the Build package BOM PDF.
 * A box goods sale (2026-10-21) prints that same BOM branch for its customer PDF and bidder copies.
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
  // BOM quote PDF (2026-10-20 spec): ?view=bom prints the saved BOM preview — itemized bands, no package document, no cut sheets, no photos.
  const bom = (Array.isArray(sp.view) ? sp.view[0] : sp.view) === "bom";
  // #348 2b-i: a per-bidder variant (`?bidder=pty_…`) needs a token signed for `${id}~${bidder}`; a plain-id token never unlocks it.
  // A bidder param that is present but malformed (or repeated) is a 404, never a fall-through to the plain document.
  const rawBidder = sp.bidder;
  if (rawBidder !== undefined && (typeof rawBidder !== "string" || rawBidder.length > 64 || !/^pty_[0-9a-f]{16}$/.test(rawBidder))) notFound();
  const bidder = typeof rawBidder === "string" ? rawBidder : null;
  // #348 2b-ii: `rev` renders the SENT revision a bidder received — only together with a valid bidder; a malformed, repeated or bidder-less rev is a 404.
  const rawRev = sp.rev;
  if (rawRev !== undefined && (!bidder || typeof rawRev !== "string" || !/^[1-9]\d{0,5}$/.test(rawRev))) notFound();
  const rev = typeof rawRev === "string" ? Number(rawRev) : null;
  // Spec 2026-10-16 §5: `part` splits the customer PDF around the drawings the generator merges in — "main" is the
  // document + cut sheets, "tail" only the datasheet links. Never on a bidder's PDF (no drawings, no links there).
  const rawPart = sp.part;
  if (rawPart !== undefined && (bidder || typeof rawPart !== "string" || (rawPart !== "main" && rawPart !== "tail"))) notFound();
  const part = rawPart as "main" | "tail" | undefined;
  // The BOM PDF is the plain customer quote only — never a bidder copy, a revision or a split part.
  if (bom && (rawBidder !== undefined || rawRev !== undefined || rawPart !== undefined)) notFound();
  if (!tokenOk(t, "quote", bidder ? (rev ? `${id}~${bidder}~r${rev}` : `${id}~${bidder}`) : id)) notFound();
  const q = await getQuote(id);
  if (!q || pdfKindForQuoteType(q.quoteType) !== "quote") notFound();
  // A sent revision renders as it was sent; any other rev (missing, a draft/recall cut) is a 404.
  const revision = rev ? (Array.isArray(q.revisions) ? q.revisions : []).find((r) => r.rev === rev && r.reason === "sent") : null;
  if (rev && !revision) notFound();
  const src = revision ? quoteAsOfRevision(q, revision) : q;
  // Box goods sale (spec 2026-10-21): the whole customer PDF is the BOM quote PDF's layout (#360) — no title page,
  // no cut sheets, no datasheet links, no photos. Read from the quote as printed (a revision's frozen flag).
  const bomLayout = bom || boxSaleOf(src);
  // A revision render shows what was sent: live edits since that revision (content changed after it was cut) would make the live-built cut sheets disagree, so they are skipped.
  const cutSheetsOk = !revision || !(typeof q.contentChangedAt === "number" && q.contentChangedAt > revision.at);
  // The links' absolute origin — the print origin, the Cover PDF's way (spec §5). Unresolvable → no links page.
  // A BOM render has no links page, so it needs no origin.
  let origin = "";
  if (!bomLayout) {
    const h = await headers();
    const where = printOriginFor(process.env, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"));
    origin = "origin" in where ? where.origin : "";
    if ("error" in where) console.warn("[quote-pdf] no print origin — the PDF has no datasheet links", id, where.error);
  }
  const [addressee, cust, settings, perks, cutSheets, links] = await Promise.all([
    // Strict: an explicit bidder that is no longer a live bidder on this quote (deleted since signing) is a 404, never the awarded default.
    bidder ? documentAddressee(src, bidder, { strict: true }) : documentAddressee(q),
    getCustomer(src.customerId),
    getSettings(),
    // #282 perks+points — the customer's purchase perks line (program on only).
    purchasePerksForCompany(src.customerId),
    // #292 — Client-style cut sheets after the estimate, only when the quote asks for them. A failure or a slow load (8 s) drops them, never the PDF — and says so in the server log.
    !bomLayout && part !== "tail" && cutSheetsOk && normalizePdfOptions(src.pdfOptions).pdfCutSheets ? settleWithin(loadCutSheets(id, { images: "data" }), CUT_SHEET_APPEND_LOAD_MS, `[cutsheets] estimate PDF ${id}`) : null,
    // Spec 2026-10-16 §5 — the datasheet links: the customer PDF only (never a bidder's), never in the "main" part.
    !bomLayout && !bidder && part !== "main" ? loadDatasheetLinkRows(q, origin) : [],
  ]);
  if (bidder && !addressee) notFound();
  // An empty links part would print a blank page — refuse it, so the generator's tail render fails and says the links are missing.
  if (part === "tail" && !links.length) notFound();
  const doc = quoteDocumentDataFor(src, cust, settings, addressee);
  if (bomLayout) {
    return (
      <main>
        <style>{QUOTE_PRINT_CSS}</style>
        {/* The BOM tab's own layout (web: no title page, the investment band kept) — Jeff, 2026-10-20. */}
        <style>{QUOTE_WEB_EMBED_CSS}</style>
        <QuoteDocument {...bomViewProps(doc)} layout="web" rewardsLine={rewardsVisibleFor(addressee) ? purchasePerksDocLine(perks) : ""} />
      </main>
    );
  }
  // #293: key-product photos inlined as data URIs (this route has no session).
  // Never throws — a photo that can't be read just isn't printed.
  // Phase 5: plus the package document's photo-on product blocks.
  // Photo wrap: each photo's model tag, read beside it (never throws either).
  // The "tail" part prints only the links, so it reads neither.
  const noPhotos: [Record<string, { src: string; alt: string }>, Record<string, string>] = [{}, {}];
  const [keyProductPhotos, keyProductModels] = part === "tail" ? noPhotos : await Promise.all([keyProductPhotoDataUris(doc.sections, doc.document), loadKeyProductModels(doc.sections, doc.document)]);
  return (
    <main>
      <style>{QUOTE_PRINT_CSS}</style>
      {part !== "tail" && (
        <>
          <QuoteDocument {...doc} keyProductPhotos={keyProductPhotos} keyProductModels={keyProductModels} rewardsLine={rewardsVisibleFor(addressee) ? purchasePerksDocLine(perks) : ""} />
          {/* #292 — its own page after the estimate; the Client resets (width/padding) ride along. */}
          {cutSheets?.ok && cutSheets.models.client.length > 0 && (
            <div style={{ breakBefore: "page" }}>
              <style>{CLIENT_PRINT_CSS}</style>
              <CutSheetPages models={cutSheets.models.client} style="client" photos={cutSheets.photos} letterheadSrc={peakLetterhead.src} />
            </div>
          )}
        </>
      )}
      {/* Spec 2026-10-16 §5 — last: the datasheet links (the generator moves them after any merged drawings). */}
      <DatasheetLinksPage rows={links} quoteNumber={doc.quoteId} projectName={doc.projectName} />
    </main>
  );
}
