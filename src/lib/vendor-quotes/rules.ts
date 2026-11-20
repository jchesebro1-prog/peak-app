/* #348 slice 4 — vendors: the pure rules. Browser-safe: the vendor quote modal and the Vendors card import this. */
import type { VendorCardGroup, VendorCompanyVM, VendorQuoteRowVM, QuoteReceivedRow } from "./vm";

export const VENDOR_PICKER_TYPES = ["vendor/manufacturer", "vendor", "manufacturer"] as const;
export const VENDOR_COPY = {
  searchVendors: "Search vendors…",
  typedFallback: "Not listed? Type the name",
  searchInstead: "Search vendors instead",
  linkVendor: "Link to a vendor company",
  pickVendor: "Pick a vendor company.",
  cardTitle: "Vendors",
  cardEmpty: "No vendor quotes on this estimate yet.",
  unlinked: "Not linked to a vendor company",
  noneYet: "No quotes yet.",
  receivedTitle: "Quotes we've received",
  removeRefusal: (company: string) => `${company} has a vendor quote on this estimate — delete that vendor quote first.`,
} as const;

export function isVendorPickerType(type: string | null | undefined): boolean {
  return (VENDOR_PICKER_TYPES as readonly string[]).includes((type || "").trim().toLowerCase());
}

export type VendorQuoteLike = {
  id: string;
  vendor?: string;
  vendorCompanyId?: string | null;
  quoteNumber?: string;
  description?: string;
  total?: number;
  addedAt?: number;
  fromThreadId?: string | null;
  attachment?: { name?: string; blobPath?: string; dataUrl?: string } | null;
};

const COMPANY_ID_RE = /^\S{1,120}$/;
const REF_PART = /^[A-Za-z0-9_-]{1,64}$/;

/** Narrow a stored `quote.vendorQuotes` blob (typed `unknown` on Quote). */
export function asVendorQuotes(raw: unknown): VendorQuoteLike[] {
  return Array.isArray(raw) ? (raw as VendorQuoteLike[]).filter((v) => !!v && typeof v === "object" && typeof v.id === "string") : [];
}

/** Distinct vendor company ids, first-appearance order, blanks ignored. */
export function vendorCompanyIdsOf(vqs: readonly VendorQuoteLike[]): string[] {
  const out: string[] = [];
  for (const v of vqs) {
    const id = typeof v.vendorCompanyId === "string" ? v.vendorCompanyId.trim() : "";
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Companies this save introduces (D-next-2: the vendor party is added once — when a company first appears). */
export function newVendorCompanyIds(prior: readonly VendorQuoteLike[], next: readonly VendorQuoteLike[]): string[] {
  const had = new Set(vendorCompanyIdsOf(prior));
  return vendorCompanyIdsOf(next).filter((id) => !had.has(id));
}

/** Server-side stamping (D-next-3): addedAt is the prior record's (absent stays absent — legacy untouched), `now` for a
 *  new id; a malformed vendorCompanyId / fromThreadId is dropped. Never trusts the browser's addedAt. */
export function stampVendorQuotes<T extends VendorQuoteLike>(prior: readonly VendorQuoteLike[], next: readonly T[], now: number): T[] {
  const priorAt = new Map(prior.map((v) => [v.id, v.addedAt] as const));
  return next.map((v) => {
    const out: T = { ...v };
    const at = priorAt.has(v.id) ? priorAt.get(v.id) : now;
    if (typeof at === "number" && Number.isFinite(at) && at > 0) out.addedAt = at;
    else delete out.addedAt;
    const co = typeof v.vendorCompanyId === "string" ? v.vendorCompanyId.trim() : "";
    if (co && COMPANY_ID_RE.test(co)) out.vendorCompanyId = co;
    else delete out.vendorCompanyId;
    const th = typeof v.fromThreadId === "string" ? v.fromThreadId.trim() : "";
    if (th && REF_PART.test(th)) out.fromThreadId = th;
    else delete out.fromThreadId;
    return out;
  });
}

/** Drop a vendorCompanyId that isn't a live vendor company (the typed `vendor` name stays). */
export function keepLiveVendorCompanies<T extends VendorQuoteLike>(vqs: readonly T[], live: ReadonlySet<string>): T[] {
  return vqs.map((v) => {
    if (!v.vendorCompanyId || live.has(v.vendorCompanyId)) return v;
    const out: T = { ...v };
    delete out.vendorCompanyId;
    return out;
  });
}

/** Vendor-quote ids the live lines of a stored spec reference (sections[].items[].vendorQuoteId). */
export function liveVendorQuoteIds(spec: unknown): Set<string> {
  const out = new Set<string>();
  const sections = (spec as { sections?: Array<{ items?: Array<{ vendorQuoteId?: unknown }> }> } | null | undefined)?.sections;
  for (const s of Array.isArray(sections) ? sections : []) for (const it of s?.items || []) if (typeof it?.vendorQuoteId === "string") out.add(it.vendorQuoteId);
  return out;
}

/** Removing a vendor party while a LIVE vendor quote names its company is refused (D-next-2). */
export function vendorPartyRemovalRefusal(companyName: string, companyId: string, liveVendorQuotes: readonly VendorQuoteLike[]): string | null {
  return liveVendorQuotes.some((v) => v.vendorCompanyId === companyId) ? VENDOR_COPY.removeRefusal(companyName || companyId) : null;
}

export function isPdfAttachment(a: { name?: string | null; mime?: string | null }): boolean {
  return (a.mime || "").toLowerCase().split(";")[0].trim() === "application/pdf" || /\.pdf$/i.test((a.name || "").trim());
}

function quoteRow(v: VendorQuoteLike): VendorQuoteRowVM {
  return {
    id: v.id, quoteNumber: v.quoteNumber || "", description: v.description || "", total: typeof v.total === "number" ? v.total : 0,
    addedAt: typeof v.addedAt === "number" ? v.addedAt : null, hasFile: !!(v.attachment && (v.attachment.blobPath || v.attachment.dataUrl)),
  };
}

/** Per vendor company: its vendor quotes. Companies by name; typed-only (legacy) groups last. */
export function vendorCardGroups(input: { vendorQuotes: readonly VendorQuoteLike[]; companies: readonly VendorCompanyVM[] }): VendorCardGroup[] {
  const byCo = new Map<string, VendorCardGroup>();
  const typed = new Map<string, VendorCardGroup>();
  const co = (id: string, name: string) => {
    let g = byCo.get(id);
    if (!g) byCo.set(id, (g = { key: `co:${id}`, companyId: id, name, href: `/companies/${encodeURIComponent(id)}`, quotes: [] }));
    return g;
  };
  for (const c of input.companies) co(c.id, c.name);
  for (const v of input.vendorQuotes) {
    if (v.vendorCompanyId) {
      co(v.vendorCompanyId, (v.vendor || "").trim() || v.vendorCompanyId).quotes.push(quoteRow(v));
      continue;
    }
    const name = (v.vendor || "").trim() || "Vendor";
    const k = name.toLowerCase();
    let g = typed.get(k);
    if (!g) typed.set(k, (g = { key: `typed:${k}`, companyId: null, name, href: null, quotes: [] }));
    g.quotes.push(quoteRow(v));
  }
  const byName = (a: VendorCardGroup, b: VendorCardGroup) => a.name.localeCompare(b.name);
  return [...[...byCo.values()].sort(byName), ...[...typed.values()].sort(byName)];
}

/** "Quotes we've received" rows for one vendor company, newest first (undated last). */
export function quotesReceivedRows(
  companyId: string,
  quotes: ReadonlyArray<{ id: string; number: string; name: string; customer: string; status: string; href: string; vendorQuotes: unknown }>
): QuoteReceivedRow[] {
  const out: QuoteReceivedRow[] = [];
  for (const q of quotes)
    for (const v of asVendorQuotes(q.vendorQuotes))
      if (v.vendorCompanyId === companyId)
        out.push({
          key: `${q.id}:${v.id}`, quoteId: q.id, estimate: q.number, job: [q.name, q.customer].filter(Boolean).join(" — "), href: q.href,
          status: q.status, vendorQuoteNumber: v.quoteNumber || "", total: typeof v.total === "number" ? v.total : 0, addedAt: typeof v.addedAt === "number" ? v.addedAt : null,
        });
  return out.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0) || a.estimate.localeCompare(b.estimate));
}
