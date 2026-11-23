import type { BomRow } from "@/lib/specs/part-spec";
import type { PackageDocRef, PackageDocument } from "@/lib/part-docs/package";

/** "missing-spec" and "missing-drawing-set" are no longer raised (packages carry no specification and no Grid drawing set); the kinds stay for stored package indexes. */
/** Grid notes #7: "missing-drawing-set" — the title-blocked drawing set couldn't be rendered (the fallback drawings ship instead). */
/** #329: "missing-datasheet-book" — the combined Datasheets.pdf was skipped (too big, late or failed); the loose datasheets still ship. */
export type PackageGapKind = "missing-catalog" | "missing-datasheet" | "missing-spec" | "missing-cutsheet" | "missing-rack" | "missing-drawing-set" | "missing-datasheet-book";

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
  /** The part's own manual, or the fixture manual covering it (#290). */
  manual: PackageDocRef | null;
  spec: { sectionId: string; body: string } | null;
};

export type ClientPackageManifest = {
  projectId: string;
  projectName: string;
  optionId: string;
  bom: BomRow[];
  items: ClientPackageItem[];
  /** Every datasheet / spec sheet / manual the package carries, ONCE, with the SKUs it serves. */
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
