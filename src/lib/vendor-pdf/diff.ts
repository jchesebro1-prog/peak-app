/* #348 slice 5 — Read the PDF: how much of a read survived to the saved vendor quote. Pure and browser-safe.
   Lines match by `extractedIndex` only — never by text. */
import type { VendorQuoteLine } from "@/app/(app)/estimator/types";
import { parseMoney } from "@/app/(app)/estimator/material-csv";
import type { VendorPdfExtraction } from "./extraction";
import { filledLine, mathFlagCount } from "./checks";

export type VendorPdfFieldEdits = { description: number; partNumber: number; qty: number; unit: number; amount: number };
export type VendorPdfDiff = {
  read: number; kept: number; edited: number; deleted: number; added: number;
  fieldEdits: VendorPdfFieldEdits; totalChanged: boolean; mathFlags: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
const unitKey = (s: string) => s.trim().toLowerCase() || "ea";
/** A saved number, or a form string: blank reads as 0 (an empty amount saves as 0); anything unparseable is NaN. */
function numberOf(v: string | number): number {
  if (typeof v === "number") return v;
  return v.trim() === "" ? 0 : parseMoney(v);
}
const sameQty = (a: string | number, b: string | number) => {
  const x = typeof a === "number" ? a : parseMoney(a);
  const y = typeof b === "number" ? b : parseMoney(b);
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
};
const sameMoney = (a: string | number, b: string | number) => {
  const x = numberOf(a);
  const y = numberOf(b);
  return Number.isFinite(x) && Number.isFinite(y) && r2(x) === r2(y);
};

/** The shape both a saved line and a form row reduce to for comparing against `filledLine`. */
export type ComparableLine = { description: string; partNumber: string; qty: string | number; unit: string; amount: string | number };

/** Which fields of a line differ from what Read the PDF filled (`filledLine`). Description is whitespace-collapsed and
 *  trimmed; part # trimmed; qty and amount compared as numbers (amount to the cent; a blank amount is 0); unit
 *  lowercased, "" = "ea". Shared by the save-time diff and the modal's "lines you edited" count. */
export function lineFieldEdits(line: ComparableLine, f: ReturnType<typeof filledLine>): Record<keyof VendorPdfFieldEdits, boolean> {
  return {
    description: collapse(line.description) !== collapse(f.description),
    partNumber: line.partNumber.trim() !== f.manufacturerPartNumber.trim(),
    qty: !sameQty(line.qty, f.qty),
    unit: unitKey(line.unit) !== unitKey(f.unit),
    amount: !sameMoney(line.amount, f.amount),
  };
}

/** For extracted line i, the FIRST saved line carrying extractedIndex i is compared with filledLine(lines[i], i).
 *  All fields equal → kept, else edited (each differing field counted once). No saved line for i → deleted. A saved
 *  line with no index, a non-integer / out-of-range index, or a second claimant of an index → added.
 *  totalChanged: a printed total → |r2(saved) − r2(printed)| > 0.005; none printed → saved.totalSource === "manual". */
export function vendorPdfDiff(x: VendorPdfExtraction, saved: { lines: readonly VendorQuoteLine[]; total: number; totalSource?: "manual" | "lines" }): VendorPdfDiff {
  const read = x.lines ?? [];
  const claimed = new Map<number, VendorQuoteLine>();
  let added = 0;
  for (const l of saved.lines) {
    const i = l.extractedIndex;
    if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= read.length || claimed.has(i)) added++;
    else claimed.set(i, l);
  }
  const fieldEdits: VendorPdfFieldEdits = { description: 0, partNumber: 0, qty: 0, unit: 0, amount: 0 };
  let kept = 0, edited = 0, deleted = 0;
  read.forEach((rl, i) => {
    const s = claimed.get(i);
    if (!s) { deleted++; return; }
    const e = lineFieldEdits({ description: s.description, partNumber: s.manufacturerPartNumber ?? "", qty: s.qty, unit: s.unit, amount: s.amount }, filledLine(rl, i));
    let any = false;
    for (const k of Object.keys(e) as Array<keyof VendorPdfFieldEdits>) if (e[k]) { fieldEdits[k]++; any = true; }
    if (any) edited++; else kept++;
  });
  const totalChanged = x.total !== undefined ? Math.abs(r2(saved.total) - r2(x.total)) > 0.005 : saved.totalSource === "manual";
  return { read: read.length, kept, edited, deleted, added, fieldEdits, totalChanged, mathFlags: mathFlagCount(x) };
}

/** accepted ⇔ nothing edited, deleted or added, and the total stands. */
export function vendorPdfOutcome(d: VendorPdfDiff): "accepted" | "edited" {
  return d.edited === 0 && d.deleted === 0 && d.added === 0 && !d.totalChanged ? "accepted" : "edited";
}
