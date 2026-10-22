import { revisionBoxSale } from "@/lib/estimate-box-sale/rules";
import { normalizePdfOptions } from "@/lib/quote-pdf/pdf-options";
import type { Quote, QuoteRevision } from "@/lib/stores/quotes";
import { CUT_SHEET_APPEND_LOAD_MS, settleWithin } from "./deadline";
import { loadCutSheets, type LoadedCutSheets } from "./load";

/**
 * Jeff 2026-10-15 #22 — the online estimate (the portal page, the v1 share
 * page and the v2/v3 package page) shows the Client-style curtain cut sheets
 * whenever the sent PDF carries them: the SENT revision's own Cut sheets
 * toggle (`pdfOptions.pdfCutSheets`, frozen in docFields), under the print
 * route's own rule — the sheets are built from the live quote, so once its
 * content changed after that revision they'd disagree with what was sent and
 * are left out (the PDF's own copy was frozen at the send). A slow or failed
 * load (8 s) drops them, never the page. SERVER ONLY.
 */

/** The print route's rule, pure: the sent revision asked for them, and nothing printed has changed since it was cut. */
export function onlineShowsCutSheets(revPdfOptions: unknown, contentChangedAt: number | null | undefined, revAt: number): boolean {
  if (!normalizePdfOptions(revPdfOptions).pdfCutSheets) return false;
  return !(typeof contentChangedAt === "number" && contentChangedAt > revAt);
}

/** The revision's pdfOptions as sent (docFields), else the live quote's (a revision cut before #293). */
function revisionPdfOptions(q: Quote, rev: QuoteRevision): unknown {
  const df = rev.docFields as { pdfOptions?: unknown } | undefined;
  return df && "pdfOptions" in df ? df.pdfOptions : q.pdfOptions;
}

/** The Client-style sheets the online page shows for this sent revision, or null (none asked for, none built, or slow). */
export async function onlineCutSheets(q: Quote, rev: QuoteRevision): Promise<LoadedCutSheets | null> {
  // Box goods sale (spec 2026-10-21): no cut sheets anywhere online — the portal, the v1 share page and the package
  // page all read this, from the revision's frozen flag.
  if (revisionBoxSale(rev)) return null;
  if (!onlineShowsCutSheets(revisionPdfOptions(q, rev), q.contentChangedAt, rev.at)) return null;
  const loaded = await settleWithin(loadCutSheets(q.id, { images: "data" }), CUT_SHEET_APPEND_LOAD_MS, `[cutsheets] online estimate ${q.id}`);
  return loaded && loaded.ok && loaded.models.client.length > 0 ? loaded : null;
}
