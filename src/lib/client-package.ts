import type { SpecCatalogPart, BomRow } from "@/lib/bid-spec";
import { optionSlice, resolveOptionId } from "@/lib/design/grid-options";
import type { GridProject, GridPlacement } from "@/lib/stores/grid-projects";
import { hasPrintableSpec } from "@/lib/specs/articles";
import type { CoverageIndex } from "@/lib/part-docs/coverage";
import { resolvePackageDocs, type PackageDocRef, type PackageDocument } from "@/lib/part-docs/package";

export type PackageGapKind = "missing-catalog" | "missing-datasheet" | "missing-spec";

export type ClientPackageGap = {
  kind: PackageGapKind;
  sku: string;
  description: string;
  qty: number;
  /** Catalog editor can use this stable key when the row is present. */
  catalogId: string | null;
};

export type ClientPackageItem = {
  sku: string;
  description: string;
  qty: number;
  unit: string;
  category: string;
  catalogId: string | null;
  /** The part's own datasheet, or the fixture datasheet covering it (#DOC). */
  datasheet: PackageDocRef | null;
  /** Fixture SKUs on this package whose datasheet covers this part. */
  datasheetCoveredBy: string[];
  specsheet: PackageDocRef | null;
  spec: { sectionId: string; body: string } | null;
};

export type ClientPackageManifest = {
  projectId: string;
  projectName: string;
  optionId: string;
  bom: BomRow[];
  items: ClientPackageItem[];
  /** Every datasheet / spec sheet the package carries, ONCE, with the SKUs it serves. */
  documents: PackageDocument[];
  /** Items whose datasheet is a fixture's — the gap report's "covered by <fixture>". */
  covered: Array<{ sku: string; by: string[]; note: string }>;
  gaps: ClientPackageGap[];
  counts: { items: number; datasheets: number; gaps: number };
};

/** A gap-report line for an accessory that rides on its fixture's datasheet. */
export function coveredNote(sku: string, by: string[]): { sku: string; by: string[]; note: string } {
  return { sku, by, note: `covered by ${by.join(", ")}` };
}

function addBom(map: Map<string, BomRow>, placement: GridPlacement, desc: string): void {
  // Curtains are made-to-size lines, not a reusable product datasheet line.
  // Keep them in the BOM as individual rows so the package never loses scope.
  const key = placement.curtain ? placement.id : placement.partId;
  const current = map.get(key);
  if (current && !placement.curtain) current.qty += 1;
  else map.set(key, { sku: placement.curtain ? placement.id : placement.partId, desc, qty: 1 });
}

/**
 * Build the completeness manifest for a Grid client package.
 *
 * This is deliberately pure and does not read Blob or mutate records. The
 * caller can use the same result for the package writer, a readiness panel,
 * and tests. Every BOM line survives: an absent catalog row and every missing
 * attachment becomes an explicit gap rather than being silently omitted.
 */
export function buildClientPackageManifest(
  project: GridProject,
  catalog: SpecCatalogPart[],
  requestedOptionId?: string | null,
  docs?: CoverageIndex | null,
): ClientPackageManifest {
  const optionId = resolveOptionId(project, requestedOptionId);
  const { placements } = optionSlice(project, optionId);
  const byId = new Map(catalog.map((part) => [part.id || part.sku, part]));
  const bySku = new Map(catalog.map((part) => [part.sku, part]));
  const bomMap = new Map<string, BomRow>();

  for (const placement of placements) {
    const part = byId.get(placement.partId) || bySku.get(placement.partId);
    const desc = placement.curtain
      ? `${placement.curtain.type} curtain${placement.curtain.fabricSku ? ` · ${placement.curtain.fabricSku}` : ""}`
      : part?.desc || placement.category || placement.partId;
    addBom(bomMap, placement, desc);
  }

  const bom = [...bomMap.values()].sort((a, b) => a.desc.localeCompare(b.desc) || a.sku.localeCompare(b.sku));
  const items: ClientPackageItem[] = [];
  const gaps: ClientPackageGap[] = [];
  const catalogSkus = bom.map((row) => (byId.get(row.sku) || bySku.get(row.sku))?.sku).filter((s): s is string => !!s);
  const packageDocs = resolvePackageDocs(docs, catalogSkus);

  for (const row of bom) {
    const part = byId.get(row.sku) || bySku.get(row.sku);
    if (!part) {
      items.push({
        sku: row.sku,
        description: row.desc,
        qty: row.qty,
        unit: "ea",
        category: "Unknown",
        catalogId: null,
        datasheet: null,
        datasheetCoveredBy: [],
        specsheet: null,
        spec: null,
      });
      gaps.push({ kind: "missing-catalog", sku: row.sku, description: row.desc, qty: row.qty, catalogId: null });
      continue;
    }

    const partDocs = packageDocs.bySku.get(part.sku);
    const spec = part.specSectionId && hasPrintableSpec(part)
      ? { sectionId: part.specSectionId, body: part.specBody!.trim() }
      : null;

    items.push({
      sku: part.sku,
      description: part.desc,
      qty: row.qty,
      unit: part.unit,
      category: part.category,
      catalogId: part.id,
      datasheet: partDocs?.datasheet ?? null,
      datasheetCoveredBy: partDocs?.datasheetCoveredBy ?? [],
      specsheet: partDocs?.specsheet ?? null,
      spec,
    });
    if (!partDocs?.datasheetOk) gaps.push({ kind: "missing-datasheet", sku: part.sku, description: part.desc, qty: row.qty, catalogId: part.id });
    if (!spec) gaps.push({ kind: "missing-spec", sku: part.sku, description: part.desc, qty: row.qty, catalogId: part.id });
  }

  return {
    projectId: project.id,
    projectName: project.name,
    optionId,
    bom,
    items,
    documents: packageDocs.documents,
    covered: items.filter((item) => item.datasheetCoveredBy.length).map((item) => coveredNote(item.sku, item.datasheetCoveredBy)),
    gaps,
    counts: { items: items.length, datasheets: packageDocs.documents.filter((d) => d.kind === "datasheet").length, gaps: gaps.length },
  };
}
