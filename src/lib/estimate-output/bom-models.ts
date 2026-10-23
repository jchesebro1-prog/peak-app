import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import { lineModel, lineOwnModel } from "@/lib/catalog-rename/sku";
import { isBonusItem } from "@/lib/estimate-bonus/flags";
import { isRewardCreditItem } from "@/lib/rewards/credit-line";
import { isPlaceholderSku } from "@/lib/specs/record-keys";

/**
 * #365 (Jeff 2026-10-22) — the model number on a BOM quote line: "Model —
 * Description" inline, in the BOM view only (bomViewProps sets `showModels`;
 * the four BOM callers pass the catalog facts as `bomModelParts`). Pure and
 * client-safe: the live BOM tab runs it in the browser, the print route,
 * saved preview and online BOM on the server.
 *
 * A line prints a model only when it is a plain catalog line: a real SKU
 * (never CUSTOM / AI / CURTAIN / CRT-n), and not a vendor-quote line, an
 * allowance, a curtain, a labor line (labor / overhead / travel), a bonus or
 * Rewards credit line, or an assembly / rack / track line (its SKU is an
 * assembly id). The model is `lineModel(line, part)` (the line's own frozen
 * Model # → the catalog part's Model # → the line's MFR P/N → partModel) when
 * the catalog knows the SKU; otherwise only what the line itself carries
 * (`lineOwnModel`) — never the order number or SKU of an unknown part.
 */

/** The catalog facts a BOM line's model reads — keyed by the line's trimmed SKU. */
export type BomModelPart = { sku: string; manufacturerModelNumber?: string; manufacturerPartNumber?: string };
export type BomModelParts = Record<string, BomModelPart>;

/** "Model — Description". */
export const BOM_MODEL_SEP = " — ";

/** Most SKUs one model read takes (the live tab's action and the server loader). */
export const BOM_MODEL_SKUS_MAX = 2000;

const oneLine = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** An assembly / rack / track line: its SKU names an assembly, not a part. */
function isAssemblyish(it: SpecItem): boolean {
  const sku = String(it.sku ?? "").trim();
  return (
    !!oneLine(it.rackId) ||
    it.track != null ||
    sku.toUpperCase().startsWith("TRK-") ||
    sku.startsWith("asm:") ||
    it.fixture === true ||
    !!oneLine(it.fixtureId) ||
    (Array.isArray(it.components) && it.components.length > 0)
  );
}

/** True when the line may print a model (a plain catalog line — header above). */
export function bomModelEligible(it: SpecItem | null | undefined): it is SpecItem {
  if (!it || typeof it !== "object") return false;
  if (it.labor || it.laborOverhead || it.laborTravel) return false;
  if (it.vendorQuoteId || it.allowance || it.curtain) return false;
  if (isBonusItem(it) || isRewardCreditItem(it)) return false;
  const sku = String(it.sku ?? "").trim();
  if (!sku || isPlaceholderSku(sku)) return false;
  return !isAssemblyish(it);
}

/** The distinct trimmed SKUs whose catalog facts the BOM view needs, in order (≤ BOM_MODEL_SKUS_MAX). */
export function bomModelSkus(sections: readonly SpecSection[] | null | undefined): string[] {
  const out = new Set<string>();
  for (const sec of Array.isArray(sections) ? sections : []) {
    if (!sec || sec.kind === "labor" || !Array.isArray(sec.items)) continue;
    for (const it of sec.items) {
      if (!bomModelEligible(it)) continue;
      const sku = String(it.sku).trim();
      if (sku === "__proto__") continue;
      out.add(sku);
      if (out.size >= BOM_MODEL_SKUS_MAX) return [...out];
    }
  }
  return [...out];
}

/** The model a BOM line prints, or "" (not a plain catalog line, or nothing to print). */
export function bomLineModel(it: SpecItem | null | undefined, parts: BomModelParts): string {
  if (!bomModelEligible(it)) return "";
  const sku = String(it.sku).trim();
  const part = sku !== "__proto__" && Object.prototype.hasOwnProperty.call(parts, sku) ? parts[sku] : undefined;
  return oneLine(part ? lineModel(it, part) : lineOwnModel(it));
}

/** "Model — Description"; the description alone when there's no model or it
 *  already starts with the model (case-insensitive, trimmed — no doubling);
 *  the model alone when there's no description. */
export function bomLineText(desc: string | null | undefined, model: string): string {
  const d = String(desc ?? "");
  const m = oneLine(model);
  if (!m) return d;
  const t = d.trim();
  if (!t) return m;
  if (t.toLowerCase().startsWith(m.toLowerCase())) return d;
  return m + BOM_MODEL_SEP + t;
}

/** Only the model fields of a catalog part — what crosses to the browser / into the document props. */
export function bomModelPartOf(p: { sku: string; manufacturerModelNumber?: string; manufacturerPartNumber?: string }): BomModelPart {
  const mmn = oneLine(p.manufacturerModelNumber);
  const mpn = oneLine(p.manufacturerPartNumber);
  return { sku: p.sku, ...(mmn ? { manufacturerModelNumber: mmn } : {}), ...(mpn ? { manufacturerPartNumber: mpn } : {}) };
}
