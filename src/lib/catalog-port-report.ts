import { PORT_RULES, matchRule, proposeForPart, type PortRule, type RulePart } from "@/lib/catalog-port-rules";
import { isModelish } from "@/lib/catalog-port-apply";
import type { Port } from "@/lib/catalog-connect";

/**
 * Port-rule report — the computation behind `npm run ports:rules`, pulled
 * out of scripts/port-rules.ts (Grid Settings build) so the CLI report and
 * the Grid Settings "Port rules review" card render from exactly one pass
 * over the catalog instead of two drifting copies.
 *
 * scripts/port-rules.ts imports `buildPortRuleReport` and prints from it —
 * its console output is unchanged. The Grid Settings page imports it too,
 * over `listCatalog()` (called once per request), and renders a VM per rule.
 *
 * Single pass (D200-adjacent perf note, prod catalog ~37,400 parts): every
 * part is visited once to bucket it by rule id, and once more for the
 * over-broad denominator — O(parts), never O(rules × parts). Do not add a
 * per-rule scan over `parts` to either caller.
 */

export type PortReportPart = RulePart & { hasPorts: boolean };

/** Brands whose descriptions are bare part numbers — reported, never guessed (D192). */
export const NO_DESC_BRANDS = ["Biamp", "JBL"];

/** One line describing a proposed port set — shared by the report's single-
 *  shape and multi-shape renderings so the two can never drift apart. */
export const renderPorts = (ports: readonly Port[]): string =>
  ports.map((p) => `${p.name} [${p.direction}${p.count ? ` ×${p.count}` : ""}: ${p.connectionType}]`).join("; ") || "(none)";

export type PortShapeGroup = { key: string; count: number; sample: PortReportPart };

export type PortRuleReportRow = {
  rule: PortRule;
  /** Parts with no ports yet that this rule would claim. */
  hits: PortReportPart[];
  /** Distinct proposed shapes across `hits`, largest first. */
  shapes: PortShapeGroup[];
  /** Manufacturers where this rule matches an outsized share of that mfr's
   *  otherwise-inferable parts (the over-broad-regex guard). */
  overBroad: { mfr: string; total: number; share: number }[];
};

export type PortRuleReport = {
  parts: PortReportPart[];
  /** One row per non-accessory PORT_RULES entry, in PORT_RULES order. */
  rows: PortRuleReportRow[];
  unmatched: PortReportPart[];
  accessoryRows: PortReportPart[];
  alreadyPorted: number;
  noDesc: number;
  /** Inferable (non-accessory, non-modelish, no existing ports) part count per mfr. */
  inferablePerMfr: Map<string, number>;
};

/**
 * Build the report from a caller-supplied part list. Callers narrow (e.g.
 * `--mfr=`) by filtering `parts` themselves before calling this — the
 * function itself never re-reads a data source, so it can be called from
 * either a CLI script (raw DB rows) or a server component (`listCatalog()`).
 */
export function buildPortRuleReport(parts: PortReportPart[]): PortRuleReport {
  const matchedBy = new Map<string, PortReportPart[]>();
  const unmatched: PortReportPart[] = [];
  const accessoryRows: PortReportPart[] = [];
  let alreadyPorted = 0;
  let noDesc = 0;

  for (const part of parts) {
    if (part.hasPorts) { alreadyPorted++; continue; }
    if (isModelish(part.desc, part.sku)) { noDesc++; continue; }
    const rule = matchRule(part);
    if (!rule) { unmatched.push(part); continue; }
    if (rule.accessory) { accessoryRows.push(part); continue; }
    const list = matchedBy.get(rule.id) || [];
    list.push(part);
    matchedBy.set(rule.id, list);
  }

  // Denominator for the over-broad guard: inferable parts per manufacturer —
  // excluding accessories and description-less rows, so the ratio measures
  // what it sounds like.
  const inferablePerMfr = new Map<string, number>();
  for (const part of parts) {
    if (part.hasPorts || isModelish(part.desc, part.sku)) continue;
    const rule = matchRule(part);
    if (rule?.accessory) continue;
    inferablePerMfr.set(part.mfr || "", (inferablePerMfr.get(part.mfr || "") || 0) + 1);
  }

  const rows: PortRuleReportRow[] = [];
  for (const rule of PORT_RULES) {
    if (rule.accessory) continue;
    const hits = matchedBy.get(rule.id) || [];

    const shapeMap = new Map<string, { count: number; sample: PortReportPart }>();
    for (const h of hits) {
      const key = renderPorts(proposeForPart(h)?.ports || []);
      const seen = shapeMap.get(key);
      if (seen) seen.count++;
      else shapeMap.set(key, { count: 1, sample: h });
    }
    const shapes: PortShapeGroup[] = [...shapeMap]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([key, v]) => ({ key, count: v.count, sample: v.sample }));

    const overBroad: { mfr: string; total: number; share: number }[] = [];
    for (const [mfr, total] of inferablePerMfr) {
      const share = hits.filter((h) => h.mfr === mfr).length / total;
      if (total >= 20 && share > 0.4) overBroad.push({ mfr, total, share });
    }

    rows.push({ rule, hits, shapes, overBroad });
  }

  return { parts, rows, unmatched, accessoryRows, alreadyPorted, noDesc, inferablePerMfr };
}
