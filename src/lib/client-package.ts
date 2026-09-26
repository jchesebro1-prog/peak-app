import type { SpecCatalogPart, BomRow } from "@/lib/bid-spec";
import { optionSlice, resolveOptionId } from "@/lib/design/grid-options";
import type { GridProject } from "@/lib/stores/grid-projects";
import { hasPrintableSpec } from "@/lib/specs/articles";
import type { CoverageIndex } from "@/lib/part-docs/coverage";
import { resolvePackageDocs, type PackageDocRef, type PackageDocument } from "@/lib/part-docs/package";
import { placementQty } from "@/lib/design/grid-bom";
import { gridSpecBomRows, parseVirtualPartId } from "@/lib/design/grid-virtual-parts";
import type { FixtureResolvable } from "@/lib/fixture-assemblies";

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
  /** The part's own datasheet, or the fixture datasheet covering it (#207). */
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

function addBom(map: Map<string, BomRow>, key: string, row: BomRow): void {
  const current = map.get(key);
  if (current) current.qty += row.qty;
  else map.set(key, { ...row });
}

/** True when any placement is an Auto assembly (`asm:`) — the caller loads fixtures only then. */
export function packageNeedsFixtures(placements: ReadonlyArray<{ partId: string }>): boolean {
  return placements.some((pl) => parseVirtualPartId(pl.partId)?.kind === "assembly");
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
  /** Resolves an Auto assembly (`asm:<id>`) into its members (#GEM). */
  fixtureOf?: (id: string) => FixtureResolvable | null | undefined,
): ClientPackageManifest {
  const optionId = resolveOptionId(project, requestedOptionId);
  const { placements } = optionSlice(project, optionId);
  const byId = new Map(catalog.map((part) => [part.id || part.sku, part]));
  const bySku = new Map(catalog.map((part) => [part.sku, part]));
  const bomMap = new Map<string, BomRow>();

  // Device lines carry their UNITS (a lot marker is its `qty`, #GEM) and go
  // through the same flattening as the bid spec (gridSpecBomRows, D-GEM-16):
  // an Auto assembly expands into its included members, an allowance is left
  // out — no raw `asm:` / `allow:` id reaches the customer's package.
  const deviceLines: Array<{ sku: string; desc: string; qty: number }> = [];
  for (const placement of placements) {
    if (placement.curtain) {
      // Curtains are made-to-size lines, not a reusable product datasheet line.
      // Keep them in the BOM as individual rows so the package never loses scope.
      const desc = `${placement.curtain.type} curtain${placement.curtain.fabricSku ? ` · ${placement.curtain.fabricSku}` : ""}`;
      addBom(bomMap, placement.id, { sku: placement.id, desc, qty: 1 });
      continue;
    }
    const ref = parseVirtualPartId(placement.partId);
    const part = byId.get(placement.partId) || bySku.get(placement.partId);
    const desc =
      ref?.kind === "assembly"
        ? fixtureOf?.(ref.id)?.label || `Assembly ${ref.id} (deleted)`
        : part?.desc || placement.category || placement.partId;
    deviceLines.push({ sku: placement.partId, desc, qty: placementQty(placement) });
  }
  // Final review wave 2 (M3): a row with no SKU — a deleted assembly, or one
  // with no included parts — is not equipment the customer can buy. It goes
  // to the gap report only (one line per name, units summed), never the BOM.
  const unresolved = new Map<string, BomRow>();
  for (const row of gridSpecBomRows(deviceLines, (id) => fixtureOf?.(id))) {
    if (row.sku) addBom(bomMap, row.sku, row);
    else addBom(unresolved, row.desc, row);
  }

  const bom = [...bomMap.values()].sort((a, b) => a.desc.localeCompare(b.desc) || a.sku.localeCompare(b.sku));
  const items: ClientPackageItem[] = [];
  const gaps: ClientPackageGap[] = [...unresolved.values()]
    .sort((a, b) => a.desc.localeCompare(b.desc))
    .map((row) => ({ kind: "missing-catalog" as const, sku: "", description: row.desc, qty: row.qty, catalogId: null }));
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
