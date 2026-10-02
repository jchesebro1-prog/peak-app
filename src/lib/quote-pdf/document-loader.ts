import { get as getCustomer } from "@/lib/stores/customers";
import { getSettings } from "@/lib/settings";
import { purchasePerksForCompany } from "@/lib/stores/reward-perks";
import { purchasePerksDocLine } from "@/lib/rewards/purchase-perks";
import { keyProductPhotoDataUris, keyProductPhotoDocs, PHOTO_TYPES } from "@/lib/narrative/photos";
import { quoteAsOfRevision } from "@/lib/quote-share/view";
import { quoteDocumentDataFor } from "./quote-document-data";
import type { Quote, QuoteRevision } from "@/lib/stores/quotes";
import type { QuoteDocumentProps } from "@/app/(app)/estimator/quote-document";
import type { SpecSection } from "@/app/(app)/estimator/types";

/**
 * #293 slice 3 (spec §5.1) — the customer QuoteDocument's props, for the
 * portal estimate page and the share page. Built from exactly the calls the
 * print route makes (customer, settings, purchase perks → the pure
 * quoteDocumentDataFor; the photos module), so the PDF and the web pages
 * can't drift. The print route keeps its own copy of those calls (it also
 * loads #292's cut sheets in the same Promise.all) — a harness check pins the
 * two to the same calls.
 *
 * With `revision`, the document is the quote AS SENT (quoteAsOfRevision):
 * the revision's spec / vendor quotes / name / value / date / Rev N and its
 * frozen header (docFields; the live header on pre-#293 revisions).
 * Photos: "inline" = data URIs (the print route's way); { href } = scoped
 * URLs the photo routes serve.
 *
 * Fails CLOSED for the web pages: with { href } photos it renders only a
 * SENT revision that is one of this quote's own (the very object from
 * `q.revisions`), and returns null otherwise — never the live quote. The
 * caller then shows its generic card. "inline" keeps the print route's
 * behaviour (no revision = the live quote).
 */

export type DocPhotos = "inline" | { href: (docId: string) => string };

export type LoadQuoteDocumentOpts =
  | { revision?: QuoteRevision | null; photos: "inline" }
  | { revision: QuoteRevision; photos: { href: (docId: string) => string } };

/** A web page may render only a sent revision of this very quote. */
function webRevisionOk(q: Quote, rev: QuoteRevision | null | undefined): boolean {
  return !!rev && rev.reason === "sent" && Array.isArray(q.revisions) && q.revisions.includes(rev);
}

/** sku → { src: href(docId), alt } for the printed photo-on blocks. Never throws. */
export async function keyProductPhotoLinks(sections: SpecSection[], href: (docId: string) => string): Promise<Record<string, { src: string; alt: string }>> {
  try {
    const docs = await keyProductPhotoDocs(sections);
    const out: Record<string, { src: string; alt: string }> = {};
    for (const [sku, d] of docs) if (d.blobKey && PHOTO_TYPES.has(d.contentType)) out[sku] = { src: href(d.id), alt: d.title || sku };
    return out;
  } catch (e) {
    console.warn("[narrative] key-product photo links unavailable", e instanceof Error ? e.message : e);
    return {};
  }
}

export async function loadQuoteDocumentProps(q: Quote, opts: LoadQuoteDocumentOpts): Promise<QuoteDocumentProps | null> {
  if (opts.photos !== "inline" && !webRevisionOk(q, opts.revision)) return null;
  const src = opts.revision ? quoteAsOfRevision(q, opts.revision) : q;
  const [cust, settings, perks] = await Promise.all([
    getCustomer(src.customerId),
    getSettings(),
    // #282 perks+points — the customer's purchase perks line (program on only).
    purchasePerksForCompany(src.customerId),
  ]);
  const doc = quoteDocumentDataFor(src, cust, settings);
  const keyProductPhotos =
    opts.photos === "inline" ? await keyProductPhotoDataUris(doc.sections) : await keyProductPhotoLinks(doc.sections, opts.photos.href);
  return { ...doc, keyProductPhotos, rewardsLine: purchasePerksDocLine(perks) };
}
