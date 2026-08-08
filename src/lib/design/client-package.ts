/**
 * Bundle walker (#40): turns a BOM + catalog into everything the client
 * package generator needs — which rows have a real datasheet (to merge),
 * which don't (a cover-index gap), and a frozen AssembledSpec covering
 * whatever rows DO have spec language.
 *
 * Design call: the existing D94 saveSpecAction (design/engagements/spec/
 * actions.ts) REFUSES to generate when any row is unmatched/unspecified
 * (bid-spec.ts's "finalizable" gate) — correct for an architect-facing bid
 * spec, wrong for this "without too much effort" client package. Here,
 * every non-ready row is auto-waived (reason: "client package — see gap
 * list") so assemble() always succeeds, and the SAME row shows up on the
 * datasheet cover's gap list under a "no-spec"/"no-match" reason — one gap
 * list, not two silent failure modes. This auto-waive behavior is local to
 * this module; matchBom/assemble/report in bid-spec.ts are untouched, so
 * saveSpecAction's stricter architect-facing gate keeps its original
 * behavior.
 */
import { matchBom, assemble, type BomRow, type MatchedRow, type SpecCatalogPart, type AssembledSpec } from "@/lib/bid-spec";
import { allSections } from "@/lib/stores/spec-sections";

export type PackageGap = { sku: string; desc: string; reason: "no-datasheet" | "no-spec" | "no-match" };

export type BundlePlan = {
  datasheets: Array<{ sku: string; desc: string; datasheetBlobKey: string; category: string }>;
  gaps: PackageGap[];
  spec: AssembledSpec;
  rows: MatchedRow[];
};

export async function walkBundle(input: {
  bom: BomRow[];
  catalog: SpecCatalogPart[];
  engagementId: string;
  projectName: string;
  customer: string;
  preparedBy: string;
}): Promise<BundlePlan> {
  const report = matchBom(input.bom, input.catalog);

  // Auto-waive every non-ready row so assemble() always produces a document
  // for this generator (see module doc). The SAME rows are also recorded in
  // `gaps` below — one gap list, not two silent failure modes.
  const waivedRows: MatchedRow[] = report.rows.map((r) =>
    r.bucket === "ready" || r.waived
      ? r
      : { ...r, waived: true, waiveReason: "client package — see gap list" }
  );

  // Every row in the walked BOM ends up in exactly one bucket: a datasheet
  // entry (priced-with-datasheet), or a gap (priced-no-datasheet /
  // spec-incomplete / no catalog match at all). Nothing is silently dropped.
  const gaps: PackageGap[] = [];
  const datasheets: BundlePlan["datasheets"] = [];
  for (const row of report.rows) {
    if (row.bucket === "no-match") {
      gaps.push({ sku: row.row.sku, desc: row.row.desc, reason: "no-match" });
      continue;
    }
    if (row.bucket === "no-spec") {
      gaps.push({ sku: row.row.sku, desc: row.row.desc, reason: "no-spec" });
    }
    const key = row.part?.datasheetBlobKey;
    if (key) {
      datasheets.push({ sku: row.row.sku, desc: row.row.desc, datasheetBlobKey: key, category: row.part!.category });
    } else if (row.part) {
      gaps.push({ sku: row.row.sku, desc: row.row.desc, reason: "no-datasheet" });
    }
  }

  const sections = await allSections();
  const spec = assemble(waivedRows, sections, {
    projectName: input.projectName,
    customer: input.customer,
    engagementId: input.engagementId,
    preparedBy: input.preparedBy,
    date: Date.now(),
  });

  return { datasheets, gaps, spec, rows: waivedRows };
}
