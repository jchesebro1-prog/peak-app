import { CROSSWALK_CELL_MAX, CROSSWALK_MAX_ROWS, type CrosswalkRow, type RenameOutcome, type RenamePlan } from "./plan";

/**
 * #304 — the rename's step list and batch shapes, pure so the Catalog →
 * Model numbers client can name each step without importing the server-only
 * engine (./apply re-exports these). One call runs one step:
 *
 *   parts → parts-refs → doc-links → accessory-links → quotes → projects →
 *   portal-carts → spec-documents → subassemblies → grid-symbols →
 *   grid-projects → blobs → done
 */
export const REF_STEPS = [
  "parts-refs",
  "doc-links",
  "accessory-links",
  "quotes",
  "projects",
  "portal-carts",
  "spec-documents",
  "subassemblies",
  "grid-symbols",
  "grid-projects",
  "blobs",
] as const;
export type RefStep = (typeof REF_STEPS)[number];
export type RenameStep = "parts" | RefStep | "done";
export type RenameBatchInput = { rows: CrosswalkRow[]; step: RenameStep; refsOnly?: boolean };
export type RenameBatchResult =
  | { ok: true; step: RenameStep; complete: boolean; renamed: number; changed: number; plan: RenamePlan | null }
  | { ok: false; error: string };

/** What the page shows while a step runs. */
export const RENAME_STEP_LABEL: Record<RenameStep, string> = {
  parts: "Renaming parts",
  "parts-refs": "Updating other parts that point at a renamed part",
  "doc-links": "Moving datasheet, photo and document links",
  "accessory-links": "Moving accessory links",
  quotes: "Updating quotes",
  projects: "Updating projects",
  "portal-carts": "Updating portal carts",
  "spec-documents": "Updating spec documents",
  subassemblies: "Updating fixtures and assemblies",
  "grid-symbols": "Updating Grid symbols",
  "grid-projects": "Updating Grid designs",
  blobs: "Updating settings, favorites and maps",
  done: "Done",
};

export function isRenameStep(v: unknown): v is RenameStep {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(RENAME_STEP_LABEL, v);
}

/** A batch action's input is untrusted: at most CROSSWALK_MAX_ROWS rows (the
 *  rest dropped), every cell a trimmed string ≤ CROSSWALK_CELL_MAX, rowNumber
 *  a positive whole number (else its position + 2, the sheet's own row). */
export function cleanCrosswalkRows(raw: unknown): CrosswalkRow[] {
  const list = Array.isArray(raw) ? raw.slice(0, CROSSWALK_MAX_ROWS) : [];
  const s = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "").trim().slice(0, CROSSWALK_CELL_MAX);
  return list
    .map((r, i) => ({ r: (r && typeof r === "object" && !Array.isArray(r) ? r : null) as Partial<Record<keyof CrosswalkRow, unknown>> | null, i }))
    .filter((x): x is { r: Partial<Record<keyof CrosswalkRow, unknown>>; i: number } => !!x.r)
    .map(({ r, i }) => {
      const n = Number(r.rowNumber);
      return {
        rowNumber: Number.isSafeInteger(n) && n > 0 ? n : i + 2,
        manufacturer: s(r.manufacturer),
        mfrPart: s(r.mfrPart),
        sku: s(r.sku),
        model: s(r.model),
        notes: s(r.notes),
        newManufacturer: s(r.newManufacturer),
      };
    });
}

/** The whole batch input, cleaned; null when `step` is not a rename step. */
export function cleanRenameBatchInput(raw: unknown): RenameBatchInput | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof RenameBatchInput, unknown>>;
  if (!isRenameStep(o.step)) return null;
  return { rows: cleanCrosswalkRows(o.rows), step: o.step, refsOnly: o.refsOnly === true };
}

/** The preview's count chips, one per plan outcome. */
export const RENAME_OUTCOME_LABEL: Record<RenameOutcome, string> = {
  rename: "To rename",
  already: "Already renamed",
  "skip:no-model": "No Model #",
  "skip:not-found": "SKU not found",
  "skip:mfr-mismatch": "Manufacturer mismatch",
  "skip:bad-model": "Model can't make a SKU",
  "skip:taken": "New SKU taken",
  "skip:duplicate": "Duplicate",
  "skip:same": "Already the model",
};
