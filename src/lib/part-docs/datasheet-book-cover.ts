/**
 * Grid notes #8 — the datasheet book's JOB cover (built onto #329's book):
 * the customer's logo (or name set large) top-right below Peak's letterhead
 * band, the job name and number, the venue and its address, "Prepared for"
 * (the customer's contact on the job) and "Prepared by" (Peak's lead
 * estimator), and the date. Pure: the facts and the words (no server imports).
 * The book's renderer (datasheet-book-server.ts) draws them when a caller
 * passes `cover`; without it the book's cover is unchanged.
 */
import { bookDate } from "./datasheet-book";

export type BookCoverImage = { bytes: Uint8Array; format: "png" | "jpeg" };
export type BookCoverPerson = { name: string; title?: string; email?: string; phone?: string };

/** Everything the loaders gather for one job's cover. */
export type BookCover = {
  jobName: string;
  /** "EST-1042 · Rev 2" / "GRD-5001" — blank prints nothing. */
  jobRef?: string;
  /** The customer company (blank → no Prepared for company line, no name mark). */
  customerName: string;
  customerLogo: BookCoverImage | null;
  venueName?: string;
  /** Street / "City, ST zip" lines, blanks dropped. */
  venueAddress?: string[];
  /** The customer's contact on the job, or null (the company still prints). */
  preparedFor: BookCoverPerson | null;
  /** Peak's lead estimator, or null (Peak's name still prints). */
  preparedBy: BookCoverPerson | null;
  /** Peak's name, the Prepared by block's first line. */
  peakName: string;
  date: number;
};

export const BOOK_COVER_COPY = {
  venue: "Venue",
  preparedFor: "Prepared for",
  preparedBy: "Prepared by",
  button: "Download all datasheets (PDF)",
  nothing: "There are no datasheets on this job yet.",
  tooBig: "These datasheets are too large to combine into one PDF — download them one at a time instead.",
  late: "The datasheet PDF took too long to build — try again.",
  failed: "The datasheet PDF couldn’t be built — try again.",
} as const;

const clean = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();

function personLines(company: string, p: BookCoverPerson | null): string[] {
  const out = [clean(company)];
  if (p) out.push(clean(p.name), clean(p.title), clean(p.email), clean(p.phone));
  return out.filter(Boolean);
}

/** The cover's text, resolved: blanks dropped, the customer mark chosen. */
export type BookCoverText = {
  job: string;
  jobRef: string;
  /** Top-right when there is no logo: the company name set large ("" = nothing). */
  customerName: string;
  /** Venue name then its address lines; [] = no venue column. */
  venue: string[];
  /** First line = the company, then contact name, title, email, phone. */
  preparedFor: string[];
  preparedBy: string[];
  /** "October 12, 2026" (the book's own date format, Chicago). */
  dateLine: string;
};

export function bookCoverText(c: BookCover): BookCoverText {
  const customer = clean(c.customerName);
  return {
    job: clean(c.jobName) || "Untitled job",
    jobRef: clean(c.jobRef),
    customerName: customer,
    venue: [clean(c.venueName), ...(c.venueAddress || []).map(clean)].filter(Boolean),
    preparedFor: personLines(customer, c.preparedFor),
    preparedBy: personLines(clean(c.peakName) || "Peak Systems Group", c.preparedBy),
    dateLine: bookDate(c.date),
  };
}

/** A venue's address as cover lines: street, then "City, ST zip". */
export function addressLines(a: { address?: string | null; city?: string | null; state?: string | null; zip?: string | null } | null | undefined): string[] {
  if (!a) return [];
  const stateZip = [clean(a.state), clean(a.zip)].filter(Boolean).join(" ");
  const cityLine = [clean(a.city), stateZip].filter(Boolean).join(", ");
  return [clean(a.address), cityLine].filter(Boolean);
}

export type CoverContactLike = { name: string; role?: string; email?: string; phone?: string; mobile?: string; primary?: boolean };

/**
 * "Prepared for": the customer's contact on the job. A quote follows the
 * estimate document's own Attn ladder (quoteDocumentDataFor) — a never-set
 * contact (null / undefined) or one no longer on the company reads as the
 * primary contact (Jeff confirmed); "" is an explicit "no contact" (null: the
 * company still prints). A Grid design passes `ladder: false` — its
 * contactName is read exactly. A name that matches no person prints alone.
 */
export function coverContact(contacts: readonly CoverContactLike[], contactName: string | null | undefined, ladder = true): BookCoverPerson | null {
  let name = contactName;
  if (ladder && (name == null || (name && contacts.length && !contacts.some((c) => c.name === name)))) {
    name = (contacts.find((c) => c.primary) || contacts[0])?.name ?? "";
  }
  const wanted = clean(name);
  if (!wanted) return null;
  const hit = contacts.find((c) => clean(c.name) === wanted);
  if (!hit) return { name: wanted };
  return { name: wanted, title: clean(hit.role), email: clean(hit.email), phone: clean(hit.phone) || clean(hit.mobile) };
}

/** A stored logo's "data:image/png;base64,…" → the image for pdf-lib; anything else → null. */
export function coverImageFromDataUrl(dataUrl: string | null | undefined): BookCoverImage | null {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ""));
  if (!m) return null;
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  return bytes.length ? { bytes, format: m[1] === "png" ? "png" : "jpeg" } : null;
}

/** The download's file name: "<ref> <job> Datasheets.pdf" (characters a file name can't carry dropped). */
export function bookDownloadName(job: string, ref?: string): string {
  const base = [clean(ref), clean(job)].filter(Boolean).join(" ").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${base ? `${base} ` : ""}Datasheets.pdf`;
}

/**
 * The share page's per-revision cache, beside the package zip's (Rebuild
 * package clears both). `coverKey` fingerprints the cover + letterhead as
 * they would print now (the cover reads live data), so an edit names a fresh file.
 */
export function bookCachePath(zipCacheDir: string, rev: number, coverKey: string): string {
  return `${zipCacheDir}rev-${rev}-${coverKey}-Datasheets.pdf`;
}
