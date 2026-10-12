import { createHash } from "node:crypto";
import type { Letterhead } from "@/lib/letterhead";
import { getSettings } from "@/lib/settings";
import { allUsers } from "@/lib/users";
import { get as getCustomer } from "@/lib/stores/customers";
import { getCompanyLogo } from "@/lib/stores/company-logos";
import { getSite } from "@/lib/identity/sites";
import { resolveCoverSigner } from "@/lib/estimate-output/cover";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { sentDocumentStamp } from "@/lib/quote-share/view";
import type { GridProject } from "@/lib/stores/grid-projects";
import { get as getQuote, type Quote, type QuoteRevision } from "@/lib/stores/quotes";
import { addressLines, coverContact, coverImageFromDataUrl, type BookCover, type BookCoverPerson } from "./datasheet-book-cover";

/**
 * Grid notes #8 — the datasheet book's job-cover facts, read from the stores.
 * SERVER ONLY. Peak's letterhead is NOT here — the book draws the letterhead
 * its caller passes (Grid notes #9, the document-header choice). The
 * customer's side is read live: the company, its logo, the job's contact and
 * venue; "Prepared by" is the lead estimator off the roster.
 */

async function preparedBy(owner: string | null | undefined, prepared: string | null | undefined): Promise<{ peakName: string; person: BookCoverPerson | null }> {
  const [settings, users] = await Promise.all([getSettings(), allUsers()]);
  const signer = resolveCoverSigner(owner, prepared, users);
  const fallback = (owner || "").trim() || (prepared || "").trim();
  return {
    peakName: (settings.companyName || "").trim() || "Peak Systems Group",
    person: signer ? { name: signer.name, title: signer.title, email: signer.email, phone: signer.phone } : fallback ? { name: fallback } : null,
  };
}

async function customerLogo(customerId: string | null | undefined) {
  return coverImageFromDataUrl((await getCompanyLogo(customerId))?.dataUrl);
}

/**
 * A quote's cover — the live quote (staff downloads, the staff client
 * package) or, with `rev`, a SENT revision as frozen (the share page and
 * the estimate package zip): name, customer, venue, contact and estimator
 * from the revision's docFields, its issued date; the company's logo and
 * the contact's details read live.
 */
export async function quoteBookCover(q: Quote, opts: { rev?: QuoteRevision; now?: number } = {}): Promise<BookCover> {
  const df = opts.rev?.docFields;
  const customerId = (opts.rev && opts.rev.customerId !== undefined ? opts.rev.customerId : q.customerId) ?? null;
  const [cust, logo, peak] = await Promise.all([
    getCustomer(customerId),
    customerLogo(customerId),
    preparedBy(df ? df.owner : q.owner, df ? df.preparedBy : q.preparedBy),
  ]);
  const locations = cust?.locations || [];
  // The estimate document's venue ladder: the stored venue, else the company's primary one.
  const locId = (df ? df.locationId : q.locationId) || (cust ? (locations.find((l) => l.primary) || locations[0])?.id : null) || null;
  const loc = locId ? locations.find((l) => l.id === locId) : undefined;
  let jobRef = displayQuoteNumber(q);
  let date = opts.now ?? Date.now();
  if (opts.rev) {
    const stamp = sentDocumentStamp(q, opts.rev);
    jobRef = `${jobRef} · Rev ${stamp.revNo}`;
    date = stamp.issuedAt;
  }
  return {
    jobName: (opts.rev?.name || q.name || "").trim(),
    jobRef: `Estimate ${jobRef}`,
    customerName: (customerId && cust?.name) || (df ? df.customer : q.customer) || "",
    customerLogo: logo,
    venueName: loc ? loc.label || loc.locationName || "" : "",
    venueAddress: addressLines(loc),
    preparedFor: coverContact(cust?.contacts || [], df ? df.contactName : q.contactName, true),
    preparedBy: peak.person,
    peakName: peak.peakName,
    date,
  };
}

/**
 * A Grid design option's cover: the design's name and customer, its venue
 * (the linked site, else the intake's venue + address), its contact read
 * exactly, and the option's quote's lead estimator (else whoever drew the
 * design, else whoever is building).
 */
export async function gridBookCover(project: GridProject, opts: { quoteId?: string | null; by?: string; now?: number } = {}): Promise<BookCover> {
  const estimator = opts.quoteId ? await getQuote(opts.quoteId) : null;
  const [cust, logo, peak, site] = await Promise.all([
    getCustomer(project.customerId),
    customerLogo(project.customerId),
    preparedBy(estimator?.owner || project.createdBy || opts.by || "", estimator?.preparedBy ?? null),
    project.siteId ? getSite(project.siteId) : Promise.resolve(null),
  ]);
  const intake = project.intake;
  return {
    jobName: project.name || project.id,
    jobRef: `Design ${project.id}`,
    customerName: (project.customerId && cust?.name) || project.customer || "",
    customerLogo: logo,
    venueName: site ? site.name || site.locationName || "" : project.siteName || intake?.venueName || "",
    venueAddress: site ? addressLines(site) : [intake?.address || ""],
    preparedFor: coverContact(cust?.contacts || [], project.contactName ?? "", false),
    preparedBy: peak.person,
    peakName: peak.peakName,
    date: opts.now ?? Date.now(),
  };
}

/**
 * Eight hex characters naming the front matter as it would print: every
 * cover fact plus digests of the customer logo and the letterhead (its
 * name, image and band/logo kind). Any edit that changes the printed cover
 * changes the key (bookCachePath, and the estimate zip's packageZipCachePath).
 * A null cover (the book's plain cover) has its own key.
 */
export function bookCoverFingerprint(cover: BookCover | null, letterhead: Letterhead | null): string {
  const digest = (b: Uint8Array | null | undefined) => (b ? createHash("sha256").update(b).digest("hex") : null);
  const facts = {
    cover: cover ? { ...cover, customerLogo: cover.customerLogo ? { f: cover.customerLogo.format, d: digest(cover.customerLogo.bytes) } : null } : null,
    letterhead: letterhead ? { name: letterhead.companyName, d: digest(letterhead.image?.png ?? letterhead.image?.jpeg), full: !!letterhead.image?.full } : null,
  };
  return createHash("sha256").update(JSON.stringify(facts)).digest("hex").slice(0, 8);
}
