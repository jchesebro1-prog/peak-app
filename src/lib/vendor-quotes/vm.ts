/* #348 slice 4 — browser-facing vendor view models (pure types). */
export type VendorCompanyVM = { id: string; name: string; href: string };
export type VendorQuoteRowVM = { id: string; quoteNumber: string; description: string; total: number; addedAt: number | null; hasFile: boolean };
export type VendorCardGroup = { key: string; companyId: string | null; name: string; href: string | null; quotes: VendorQuoteRowVM[] };
export type VendorsPanelResult = { ok: true; companies: VendorCompanyVM[] } | { ok: false; error: string };
export type QuoteReceivedRow = { key: string; quoteId: string; estimate: string; job: string; href: string; status: string; vendorQuoteNumber: string; total: number; addedAt: number | null };
