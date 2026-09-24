import type { SpecCatalogPart, BomRow } from "@/lib/bid-spec";
import { optionSlice, resolveOptionId } from "@/lib/design/grid-options";
import type { GridProject, GridPlacement } from "@/lib/stores/grid-projects";

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
  datasheet: { name: string; blobKey: string } | null;
  spec: { sectionId: string; body: string } | null;
};

export type ClientPackageManifest = {
  projectId: string;
  projectName: string;
  optionId: string;
  bom: BomRow[];
  items: ClientPackageItem[];
  datasheets: Array<{ sku: string; name: string; blobKey: string }>;
  gaps: ClientPackageGap[];
  counts: { items: number; datasheets: number; gaps: number };
};

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
        spec: null,
      });
      gaps.push({ kind: "missing-catalog", sku: row.sku, description: row.desc, qty: row.qty, catalogId: null });
      continue;
    }

    const datasheet = part.datasheetBlobKey && part.datasheetName
      ? { name: part.datasheetName, blobKey: part.datasheetBlobKey }
      : part.productMetadata?.datasheets?.find((file) => file.blobKey)
        ? {
            name: part.productMetadata.datasheets.find((file) => file.blobKey)!.fileName,
            blobKey: part.productMetadata.datasheets.find((file) => file.blobKey)!.blobKey!,
          }
        : null;
    const spec = part.specSectionId && part.specBody?.trim()
      ? { sectionId: part.specSectionId, body: part.specBody.trim() }
      : null;

    items.push({
      sku: part.sku,
      description: part.desc,
      qty: row.qty,
      unit: part.unit,
      category: part.category,
      catalogId: part.id,
      datasheet,
      spec,
    });
    if (!datasheet) gaps.push({ kind: "missing-datasheet", sku: part.sku, description: part.desc, qty: row.qty, catalogId: part.id });
    if (!spec) gaps.push({ kind: "missing-spec", sku: part.sku, description: part.desc, qty: row.qty, catalogId: part.id });
  }

  return {
    projectId: project.id,
    projectName: project.name,
    optionId,
    bom,
    items,
    datasheets: items.flatMap((item) => item.datasheet ? [{ sku: item.sku, ...item.datasheet }] : []),
    gaps,
    counts: { items: items.length, datasheets: items.filter((item) => item.datasheet).length, gaps: gaps.length },
  };
}
