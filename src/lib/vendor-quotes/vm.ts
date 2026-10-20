/* #348 slice 4 — browser-facing vendor view models (pure types). */
export type VendorThreadVM = { id: string; companyId: string; subject: string; lastAt: number; lastFrom: string; unread: boolean; href: string };
export type VendorCompanyVM = { id: string; name: string; href: string };
export type VendorQuoteRowVM = { id: string; quoteNumber: string; description: string; total: number; addedAt: number | null; hasFile: boolean; fromThreadId: string | null };
export type VendorCardGroup = { key: string; companyId: string | null; name: string; href: string | null; quotes: VendorQuoteRowVM[]; threads: VendorThreadVM[] };
export type VendorsPanelResult = { ok: true; companies: VendorCompanyVM[]; threads: VendorThreadVM[] } | { ok: false; error: string };
export type QuoteReceivedRow = { key: string; quoteId: string; estimate: string; job: string; href: string; status: string; vendorQuoteNumber: string; total: number; addedAt: number | null };
export type VendorPrefill = {
  vendorCompanyId: string | null; vendor: string; quoteNumber: string;
  attachment: { name: string; mime: string; blobPath?: string; dataUrl?: string } | null;
  /** The email's own download route — the modal's Download link until the estimate is saved. */
  preview: string | null; fromThreadId: string; note: string;
};
export type FilingTargetVM = { type: "quote" | "project"; id: string; label: string; sub: string };
