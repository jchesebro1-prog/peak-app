import { get as getCustomer } from "@/lib/stores/customers";
import { getSettings } from "@/lib/settings";
import { purchasePerksForCompany } from "@/lib/stores/reward-perks";
import { purchasePerksDocLine } from "@/lib/rewards/purchase-perks";
import { allUsers } from "@/lib/users";
import { quoteDocumentDataFor } from "@/lib/quote-pdf/quote-document-data";
import { getEstimateOutputDefaults } from "@/lib/stores/estimate-output-defaults";
import { shareLinkView, shareSecret } from "@/lib/quote-share/links";
import { onlineEstimateState } from "@/lib/quote-share/view";
import type { Quote } from "@/lib/stores/quotes";
import { effectiveNotIncluded } from "./fields";
import { coverDocumentPropsFor, coverFooterLine, coverShareUrl, resolveCoverSigner, type CoverDocumentProps } from "./cover";

/**
 * #301 slice A — the cover PDF's props for a LIVE quote (staff can print a
 * draft — D-p). The same data path as the print route (customer, settings,
 * purchase perks → quoteDocumentDataFor), plus the roster (signer, R16), the
 * Settings → Estimate output blob (Not included default, website) and the
 * v1 client link (printed only while it is active and the online page shows
 * the estimate). No photos: the cover prints none.
 */
export async function loadCoverDocumentProps(
  q: Quote,
  opts: { origin: string | null; letterheadSrc: string; now?: number }
): Promise<CoverDocumentProps> {
  const now = opts.now ?? Date.now();
  const [cust, settings, perks, users, defaults] = await Promise.all([
    getCustomer(q.customerId),
    getSettings(),
    purchasePerksForCompany(q.customerId),
    allUsers(),
    getEstimateOutputDefaults(),
  ]);
  const doc = { ...quoteDocumentDataFor(q, cust, settings), rewardsLine: purchasePerksDocLine(perks) };
  const link = shareLinkView(q, shareSecret(), now);
  return coverDocumentPropsFor({
    doc,
    coverSummary: q.coverSummary || "",
    notIncluded: effectiveNotIncluded(q.notIncluded, defaults.notIncluded),
    signer: resolveCoverSigner(q.owner, q.preparedBy, users),
    footerLine: coverFooterLine({ companyName: doc.companyName, offices: settings.offices, website: defaults.website }),
    shareUrl: coverShareUrl(opts.origin, link, onlineEstimateState(q).kind),
    letterhead: settings.logoDark ? { src: settings.logoDark, full: false } : { src: opts.letterheadSrc, full: true },
  });
}
