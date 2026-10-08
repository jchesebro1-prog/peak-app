import { fmt, systemSellTotal } from "@/app/(app)/estimator/pricing";
import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import type { ChipKind, PDChip } from "./types";

/**
 * Estimator Phase 5 — chips: numbers live, words yours. A chip stores only
 * WHAT it shows (kind + ref); the value is read at print/view time from the
 * same props QuoteDocument already has (`sections`, `t`, `quoteId`).
 * resolveChip → the text to print, or null when its system/line no longer
 * exists (client outputs print nothing; the editor shows amber `removed`).
 * Pure; client-safe.
 */

export type ChipCtx = {
  sections: readonly SpecSection[];
  /** QuoteTotals (only `grand` is read). */
  t?: { grand: number } | null;
  quoteId?: string | null;
  /** The totals block's Total label. Anything but "Total" means the totals
   *  block says "(excludes items pending price)" (a portal quote with a POR
   *  line), and the grand-total chip says it too. */
  totalLabel?: string;
};

/** Appended to a grand-total chip when the totals block's label carries it. */
export const GRAND_PENDING_SUFFIX = " (excludes items pending price)";

/** Editor-facing names for each kind (toolbar / gap list). */
export const CHIP_LABEL: Record<ChipKind, string> = {
  systemPrice: "System price",
  systemName: "System name",
  lineQty: "Line quantity",
  quoteNumber: "Quote number",
  grandTotal: "Grand total",
};

/** `sectionId:lineKey` → its parts (the line key is the part after the LAST colon). */
export function splitLineRef(ref: string): { sectionId: string; lineKey: string } | null {
  const at = typeof ref === "string" ? ref.lastIndexOf(":") : -1;
  if (at <= 0 || at === ref.length - 1) return null;
  return { sectionId: ref.slice(0, at), lineKey: ref.slice(at + 1) };
}
export const lineRef = (sectionId: string, lineKey: string | number): string => `${sectionId}:${lineKey}`;

export function findSection(sections: readonly SpecSection[] | null | undefined, id: string): SpecSection | undefined {
  return (Array.isArray(sections) ? sections : []).find((s) => s && s.id === id);
}
export function findLine(sec: SpecSection | undefined, lineKey: string): SpecItem | undefined {
  return sec && Array.isArray(sec.items) ? sec.items.find((it) => it && String(it.id) === lineKey) : undefined;
}

/** "4 ea", "12.5 ft", "3" (no unit). */
export function fmtQty(it: Pick<SpecItem, "qty" | "unit">): string {
  const q = typeof it.qty === "number" && Number.isFinite(it.qty) ? it.qty : 0;
  const unit = typeof it.unit === "string" ? it.unit.trim() : "";
  const n = q.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return unit ? `${n} ${unit}` : n;
}

export function resolveChip(chip: PDChip | PDChip["attrs"], ctx: ChipCtx): string | null {
  const a = "attrs" in chip ? chip.attrs : chip;
  const ref = typeof a?.ref === "string" ? a.ref : "";
  switch (a?.kind) {
    case "systemPrice": {
      const sec = findSection(ctx.sections, ref);
      return sec ? fmt(systemSellTotal(sec)) : null;
    }
    case "systemName": {
      const sec = findSection(ctx.sections, ref);
      return sec ? sec.name || "" : null;
    }
    case "lineQty": {
      const r = splitLineRef(ref);
      const it = r ? findLine(findSection(ctx.sections, r.sectionId), r.lineKey) : undefined;
      return it ? fmtQty(it) : null;
    }
    case "quoteNumber":
      return ctx.quoteId ? String(ctx.quoteId) : null;
    case "grandTotal":
      return ctx.t && typeof ctx.t.grand === "number" && Number.isFinite(ctx.t.grand)
        ? fmt(ctx.t.grand) + (ctx.totalLabel && ctx.totalLabel !== "Total" ? GRAND_PENDING_SUFFIX : "")
        : null;
    default:
      return null;
  }
}

/** Does this chip's system/line still exist? (quoteNumber / grandTotal never go missing.) */
export function chipRefExists(chip: PDChip | PDChip["attrs"], sections: readonly SpecSection[]): boolean {
  const a = "attrs" in chip ? chip.attrs : chip;
  if (a.kind === "quoteNumber" || a.kind === "grandTotal") return true;
  return resolveChip(a, { sections, t: { grand: 0 }, quoteId: "x" }) !== null;
}
