/* #348 slice 5 — Read the PDF: what a read does to the vendor-quote form, and how Try harder undoes it. Pure and
   browser-safe. A read fills the modal only (spec §7); nothing here saves. */
import type { VendorDraft, VendorLineDraft } from "@/app/(app)/estimator/types";
import { money } from "@/lib/format";
import type { VendorPdfExtraction } from "./extraction";
import { filledLine, type VendorPdfChecks } from "./checks";
import { lineFieldEdits } from "./diff";

/** What a read actually wrote into the form (null = left alone). Compared on undo so a field the user changed stays. */
export type VendorPdfFilled = {
  vendor: string | null; vendorCompanyId: string | null; quoteNumber: string | null; description: string | null;
  total: string | null; terms: string | null; notes: string | null; includesFreight: boolean;
};
/** Transient (never persisted): what the banner shows and what a later Try harder may replace. */
export type VendorPdfReadUi = { runId: string; model: string; hard: boolean; at: number; checks: VendorPdfChecks; filled: VendorPdfFilled; pages: number | null };
export type VendorPdfReadResult = { runId: string; model: string; hard: boolean; at: number; data: VendorPdfExtraction; checks: VendorPdfChecks; pages: number | null };

/** The form has no description cap of its own; the extraction's description maximum is the ceiling. */
export const VENDOR_PDF_DESCRIPTION_MAX = 200;

const usd = (n: number) => money(n, { cents: true });
const blank = (s: string) => s.trim() === "";

/** "Quote date: …\nValid until: …\nLead time: …\nShips from: …\nPayment: …\nFreight: $…\nTax: $…" — only printed rows. */
export function vendorPdfTerms(x: VendorPdfExtraction): string {
  const rows: string[] = [];
  if (x.quoteDate) rows.push(`Quote date: ${x.quoteDate}`);
  if (x.validUntil) rows.push(`Valid until: ${x.validUntil}`);
  if (x.leadTime) rows.push(`Lead time: ${x.leadTime}`);
  if (x.shipFrom) rows.push(`Ships from: ${x.shipFrom}`);
  if (x.paymentTerms) rows.push(`Payment: ${x.paymentTerms}`);
  if (x.freight !== undefined) rows.push(`Freight: ${usd(x.freight)}`);
  if (x.tax !== undefined) rows.push(`Tax: ${usd(x.tax)}`);
  return rows.join("\n");
}

/** Jeff 2026-10-15: Description is prefilled (and stays editable). One line → its description || part number;
 *  several → "<first line's> + N more item(s)"; none, or a first line with neither → "". Capped at 200. */
export function vendorPdfDescription(x: VendorPdfExtraction): string {
  const ls = x.lines ?? [];
  if (ls.length === 0) return "";
  const head = (ls[0].description || ls[0].mfrPartNumber || "").trim();
  if (!head) return "";
  if (ls.length === 1) return head.slice(0, VENDOR_PDF_DESCRIPTION_MAX).trim();
  const more = ls.length - 1;
  const suffix = ` + ${more} more item${more === 1 ? "" : "s"}`;
  return head.slice(0, VENDOR_PDF_DESCRIPTION_MAX - suffix.length).trim() + suffix;
}

const asRow = (l: VendorLineDraft) => ({ description: l.description, partNumber: l.manufacturerPartNumber, qty: l.qty, unit: l.unit, amount: l.amount });

/** Fill rules: every scalar only when blank; the vendor only when the form has neither a name nor a company;
 *  freight ticked, never unticked; lines APPENDED (typed lines stay) with fresh ids from `mint` and `fromRead: i`. */
export function applyVendorPdfRead(d: VendorDraft, r: VendorPdfReadResult, mint: () => number): VendorDraft {
  const x = r.data;
  const filled: VendorPdfFilled = { vendor: null, vendorCompanyId: null, quoteNumber: null, description: null, total: null, terms: null, notes: null, includesFreight: false };
  const out: VendorDraft = { ...d };

  if (blank(d.vendor) && !d.vendorCompanyId) {
    if (r.checks.vendor.status === "one") {
      out.vendor = r.checks.vendor.name;
      out.vendorCompanyId = r.checks.vendor.companyId;
      filled.vendor = r.checks.vendor.name;
      filled.vendorCompanyId = r.checks.vendor.companyId;
    } else if (x.vendor) {
      out.vendor = x.vendor;
      filled.vendor = x.vendor;
    }
  }
  const scalar = (key: "quoteNumber" | "description" | "total" | "terms" | "notes", value: string) => {
    if (blank(d[key]) && value !== "") { out[key] = value; filled[key] = value; }
  };
  scalar("quoteNumber", x.quoteNumber ?? "");
  scalar("total", x.total !== undefined ? String(x.total) : "");
  scalar("terms", vendorPdfTerms(x));
  scalar("notes", x.notes ?? "");
  scalar("description", vendorPdfDescription(x));
  if (r.checks.freight.tick && !d.includesFreight) { out.includesFreight = true; filled.includesFreight = true; }

  const lines: VendorLineDraft[] = (x.lines ?? []).map((l, i) => {
    const f = filledLine(l, i);
    return { id: mint(), description: f.description, manufacturerPartNumber: f.manufacturerPartNumber, qty: f.qty, unit: f.unit, amount: f.amount, fromRead: i };
  });
  out.lines = [...d.lines, ...lines];
  out.extracted = { runId: r.runId, model: r.model, at: r.at, data: x };
  out.pdfRead = { runId: r.runId, model: r.model, hard: r.hard, at: r.at, checks: r.checks, filled, pages: r.pages };
  return out;
}

/** Before a new read (Try harder or Read again): remove every line with fromRead set; blank each scalar field still
 *  equal to what the read wrote (a field the user changed stays; the vendor name and its company link go together or
 *  not at all); untick includesFreight only if the read ticked it and it is still ticked; extracted = pdfRead = null.
 *  With pdfRead null (an edit of a saved quote) only the lines go. */
export function undoVendorPdfRead(d: VendorDraft): VendorDraft {
  const out: VendorDraft = { ...d, lines: d.lines.filter((l) => l.fromRead === undefined), extracted: null, pdfRead: null };
  const f = d.pdfRead?.filled;
  if (!f) return out;
  if (f.vendor !== null && d.vendor === f.vendor && d.vendorCompanyId === f.vendorCompanyId) {
    out.vendor = "";
    out.vendorCompanyId = null;
  }
  for (const k of ["quoteNumber", "description", "total", "terms", "notes"] as const) {
    if (f[k] !== null && d[k] === f[k]) out[k] = "";
  }
  if (f.includesFreight && d.includesFreight) out.includesFreight = false;
  return out;
}

/** How many fromRead lines no longer equal filledLine(extracted.data.lines[i]) — for the replace confirm. */
export function readLinesEdited(d: VendorDraft): { read: number; edited: number } {
  const ex = d.extracted?.data.lines ?? [];
  let read = 0, edited = 0;
  for (const l of d.lines) {
    if (l.fromRead === undefined) continue;
    read++;
    const src = ex[l.fromRead];
    if (!src) { edited++; continue; }
    const e = lineFieldEdits(asRow(l), filledLine(src, l.fromRead));
    if (e.description || e.partNumber || e.qty || e.unit || e.amount) edited++;
  }
  return { read, edited };
}

/** The file was replaced or removed: the read no longer describes it — extracted = pdfRead = null, fromRead tags
 *  stripped (the lines stay, now the user's own). */
export function dropVendorPdfRead(d: VendorDraft): VendorDraft {
  return { ...d, lines: d.lines.map(({ fromRead: _fromRead, ...rest }) => (void _fromRead, rest)), extracted: null, pdfRead: null };
}

/** Line id → the hint under the row: a catalog match chip, a line whose math is off (warn), a derived amount (info).
 *  Only while pdfRead is set. Math and derived-amount hints go away once the user edits that line's qty or amount;
 *  the catalog chip goes once the part number changes. */
export function vendorPdfLineHints(d: VendorDraft): Record<number, { text: string; warn: boolean }> {
  const out: Record<number, { text: string; warn: boolean }> = {};
  const read = d.pdfRead;
  const ex = d.extracted?.data.lines;
  if (!read || !ex) return out;
  for (const l of d.lines) {
    if (l.fromRead === undefined) continue;
    const src = ex[l.fromRead];
    const lc = read.checks.lines[l.fromRead];
    if (!src || !lc) continue;
    const e = lineFieldEdits(asRow(l), filledLine(src, l.fromRead));
    const parts: string[] = [];
    let warn = false;
    if (lc.math.status === "off" && lc.math.expected !== null && src.qty !== undefined && src.unitPrice !== undefined && src.amount !== undefined && !e.qty && !e.amount) {
      parts.push(`${src.qty} × ${usd(src.unitPrice)} = ${usd(lc.math.expected)} — the PDF says ${usd(src.amount)}`);
      warn = true;
    }
    if (lc.catalog?.kind === "match" && !e.partNumber) parts.push(`In catalog: ${lc.catalog.model} · ${lc.catalog.sku}`);
    if (lc.derivedAmount && !e.qty && !e.amount) parts.push("Amount computed from qty × unit price");
    if (parts.length) out[l.id] = { text: parts.join(" — "), warn };
  }
  return out;
}
