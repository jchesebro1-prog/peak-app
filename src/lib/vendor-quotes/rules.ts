/* #348 slice 4 — vendors: the pure rules. Browser-safe: the vendor quote modal, the Inbox reader and the Vendors card
   import this. The stores (src/lib/stores/vendor-quotes.ts) and the broker (thread-attachment-server.ts) call it. */
import { ATTACHMENTS_PER_MESSAGE_MAX } from "@/lib/attachment-limits";
import type { VendorCardGroup, VendorCompanyVM, VendorQuoteRowVM, VendorThreadVM, QuoteReceivedRow } from "./vm";

export const VENDOR_PICKER_TYPES = ["vendor/manufacturer", "vendor", "manufacturer"] as const;
export const VENDOR_FROM_EMAIL_MAX_BYTES = 25 * 1024 * 1024;
export const VENDOR_FROM_EMAIL_MAX_LABEL = "25 MB";
export { ATTACHMENTS_PER_MESSAGE_MAX };
export const VENDOR_FROM_EMAIL_PARAM = "vq";

export const VENDOR_COPY = {
  fileButton: "File to estimate / project…",
  fileTitle: "File to estimate / project",
  fileShares: "Filing shares this email with the team — it shows on the estimate's Vendors card.",
  fileNoVendor: "No vendor picked — the email is filed without adding a vendor.",
  replaceLink: (label: string) => `This replaces the link to ${label}.`,
  filed: (label: string) => `Filed to ${label}.`,
  addButton: "Add as vendor quote…",
  addTitle: "Add as vendor quote",
  alsoFile: "Also file this email to the estimate",
  searchTargets: "Search estimates and projects…",
  searchVendors: "Search vendors…",
  typedFallback: "Not listed? Type the name",
  searchInstead: "Search vendors instead",
  linkVendor: "Link to a vendor company",
  noSystem: "Add a system first — a vendor quote adds to a system.",
  copying: "Copying the PDF from the email…",
  copyFailed: "Couldn't copy the PDF from the email — attach it by hand.",
  tooBig: `That PDF is larger than 25 MB — attach a smaller file, or paste a Link instead.`,
  noRoom: "That PDF is too large to keep with this estimate here — paste a Link instead.",
  notAvailable: "That email isn't available.",
  notOnEmail: "That attachment isn't on this email.",
  notVendorPdf: "That's one of our own estimate PDFs, not a vendor quote.",
  noGmail: "Gmail isn't connected here — download the PDF and attach it by hand.",
  pickVendor: "Pick a vendor company.",
  cardTitle: "Vendors",
  cardEmpty: "No vendor quotes or vendor emails on this estimate yet.",
  unlinked: "Not linked to a vendor company",
  noneYet: "No quotes or emails yet.",
  receivedTitle: "Quotes we've received",
  procurementTitle: "Vendor quotes & emails",
  fromEmail: "From email",
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

const SUBJECT_QUOTE_RE = /\b(?:quote|quotation|qte?|proposal)\b\.?\s*(?:#|no\.?|number|num\.?|nbr\.?)?\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]{0,39})/gi;

/** The vendor's quote number when the subject makes it obvious (a token with a digit after quote/quotation/qt/proposal), else "". */
export function quoteNumberFromSubject(subject: string | null | undefined): string {
  for (const m of (subject || "").matchAll(SUBJECT_QUOTE_RE)) {
    const tok = m[1].replace(/[._/-]+$/, "");
    if (/\d/.test(tok)) return tok;
  }
  return "";
}

export function isPdfAttachment(a: { name?: string | null; mime?: string | null }): boolean {
  return (a.mime || "").toLowerCase().split(";")[0].trim() === "application/pdf" || /\.pdf$/i.test((a.name || "").trim());
}

export type ThreadAttachmentRef = { threadId: string; messageId: string; index: number };
export function threadAttachmentRef(r: ThreadAttachmentRef): string {
  return `${r.threadId}~${r.messageId}~${r.index}`;
}
export function parseThreadAttachmentRef(raw: unknown): ThreadAttachmentRef | null {
  if (typeof raw !== "string" || raw.length > 140) return null;
  const parts = raw.split("~");
  if (parts.length !== 3) return null;
  const [threadId, messageId, i] = parts;
  if (!REF_PART.test(threadId) || !REF_PART.test(messageId) || !/^\d{1,2}$/.test(i)) return null;
  const index = Number(i);
  return index < ATTACHMENTS_PER_MESSAGE_MAX ? { threadId, messageId, index } : null;
}
/** The Inbox → Estimator hand-off (D-next-6): only ids ride the URL. */
export function vendorFromEmailHref(quoteId: string, ref: ThreadAttachmentRef): string {
  return `/estimator?id=${encodeURIComponent(quoteId)}&${VENDOR_FROM_EMAIL_PARAM}=${encodeURIComponent(threadAttachmentRef(ref))}`;
}
export function threadAttachmentHref(ref: ThreadAttachmentRef): string {
  return `/api/inbox/attachments/${encodeURIComponent(ref.threadId)}/${encodeURIComponent(ref.messageId)}/${ref.index}`;
}

/** The thread's work-link label — the Inbox link picker's own format (inbox/page.tsx linkOptions). */
export function filingLinkLabel(t: { type: "quote"; number: string; name: string } | { type: "project"; id: string; name: string }): string {
  return t.type === "quote" ? `${t.number} · ${t.name || "Quote"}` : `${t.id} · ${t.name || "Project"}`;
}

/** Listed on a Vendors card / Procurement (visibility is checked separately with canSeeThread). */
export function isListedVendorThread(t: { customerId?: string | null; status?: string; deleted?: boolean }, vendorCompanyIds: ReadonlySet<string>): boolean {
  return !t.deleted && t.status !== "draft" && !!t.customerId && vendorCompanyIds.has(t.customerId);
}

/** A thread's card row — subject, last message's author/time, unread. Never the body. */
export function vendorThreadRow(t: { id: string; customerId: string; subject?: string; unread?: boolean; messages?: ReadonlyArray<{ at?: number; author?: string }> }): VendorThreadVM {
  let last: { at?: number; author?: string } | null = null;
  for (const m of t.messages || []) if (!last || (m.at || 0) >= (last.at || 0)) last = m;
  return { id: t.id, companyId: t.customerId, subject: (t.subject || "").trim() || "(no subject)", lastAt: last?.at || 0, lastFrom: last?.author || "", unread: !!t.unread, href: `/inbox?thread=${encodeURIComponent(t.id)}` };
}

function quoteRow(v: VendorQuoteLike): VendorQuoteRowVM {
  return {
    id: v.id, quoteNumber: v.quoteNumber || "", description: v.description || "", total: typeof v.total === "number" ? v.total : 0,
    addedAt: typeof v.addedAt === "number" ? v.addedAt : null, hasFile: !!(v.attachment && (v.attachment.blobPath || v.attachment.dataUrl)),
    fromThreadId: v.fromThreadId || null,
  };
}

/** Per vendor company: its vendor quotes + filed threads. Companies by name; typed-only (legacy) groups last. */
export function vendorCardGroups(input: { vendorQuotes: readonly VendorQuoteLike[]; companies: readonly VendorCompanyVM[]; threads: readonly VendorThreadVM[] }): VendorCardGroup[] {
  const byCo = new Map<string, VendorCardGroup>();
  const typed = new Map<string, VendorCardGroup>();
  const co = (id: string, name: string) => {
    let g = byCo.get(id);
    if (!g) byCo.set(id, (g = { key: `co:${id}`, companyId: id, name, href: `/companies/${encodeURIComponent(id)}`, quotes: [], threads: [] }));
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
    if (!g) typed.set(k, (g = { key: `typed:${k}`, companyId: null, name, href: null, quotes: [], threads: [] }));
    g.quotes.push(quoteRow(v));
  }
  for (const t of input.threads) byCo.get(t.companyId)?.threads.push(t);
  for (const g of byCo.values()) g.threads.sort((a, b) => b.lastAt - a.lastAt);
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
