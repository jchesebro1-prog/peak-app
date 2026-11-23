/**
 * #364 — the BOM view's fixed cases (bomViewProps over the #293 fixture quote,
 * layout "web" like every BOM caller), shared by the byte-for-byte baseline
 * writer (scripts/qd364-baseline.ts) and the harness. Each case takes an
 * optional pdfOptions overlay so the harness can render the same quote with
 * the Show on BOM switches set; the baseline was written with none set.
 */
import type { QuoteDocumentProps } from "@/app/(app)/estimator/quote-document";
import { bomViewProps } from "@/app/(app)/estimator/quote-document-view";
import type { SpecSection } from "@/app/(app)/estimator/types";
import { qd293Props, qd293Sections } from "./qd293-cases";

const altSection = { id: "a1", name: "LED Upgrade", kind: "materials", mfr: "", freightPct: 4, groupId: "g-x", items: [{ id: 11, sku: "SKU-11", desc: "Line 11", qty: 2, unit: "ea", cost: 10, price: 25 }, { id: 12, sku: "SKU-12", desc: "Line 12", qty: 1, unit: "ea", cost: 10, price: 30, option: true }] } as unknown as SpecSection;
const G = [{ id: "g-a", name: "Stage", alternate: false }, { id: "g-x", name: "Upgrades", alternate: true }];

/** The BOM view of each case, with `overlay` merged into the quote's pdfOptions. */
export function qd364BomCases(overlay: Record<string, unknown> = {}): Record<string, QuoteDocumentProps> {
  const web = (p: QuoteDocumentProps): QuoteDocumentProps => ({ ...bomViewProps(p), layout: "web" });
  const grouped = (): SpecSection[] => [...qd293Sections().map((s) => (s.id === "s1" ? { ...s, groupId: "g-a" } : s)), altSection];
  return {
    bom: web(qd293Props({ pdfOptions: { ...overlay } })),
    bomSectioned: web(qd293Props({ pdfOptions: { detail: "sectioned", ...overlay } })),
    bomLean: web(qd293Props({ pdfOptions: { pdfQty: false, pdfPrices: false, ...overlay } })),
    bomAlternates: web(qd293Props({ sections: grouped(), groups: G, pdfOptions: { ...overlay } })),
    // A tax line — it always prints, whatever the Show on BOM switches say.
    bomTax: (() => {
      const p = web(qd293Props({ pdfOptions: { ...overlay } }));
      return { ...p, t: { ...p.t, tax: 12.5, grand: p.t.grand + 12.5 }, taxRatePct: 5 };
    })(),
  };
}

/**
 * The stored baseline (docs/superpowers/fixtures/364-bom-view-baseline.json) as the harness compares it.
 * Its `bomRewards` entry was rendered while a quote could carry a $25 Rewards credit. The credit was removed
 * (2026-11-23) and the file is left as it was written, so that entry is read as the `bomTax` case: the same
 * render without its "Credit applied" row and with the Total $25 higher ($340.50 → $365.50). Every other entry
 * is returned untouched. A file re-written by qd364-baseline.ts (it then has `bomTax`) is returned as-is.
 */
export function qd364Baseline(json: string): Record<string, string> {
  const raw = JSON.parse(json) as Record<string, string>;
  if (!("bomRewards" in raw)) return raw;
  const { bomRewards, ...rest } = raw;
  const creditRow = bomRewards.match(/<div class="est-reward-credit"[^>]*>.*?<\/div>/)?.[0];
  if (!creditRow) throw new Error("364 baseline: the bomRewards entry has no credit row");
  return { ...rest, bomTax: bomRewards.replace(creditRow, "").split("$340.50").join("$365.50") };
}
