/**
 * #333 (spec 2026-10-12 §5.1) — what the client gets on this project: the
 * per-quote `Quote.packageSelection`. Pure and client-safe (no imports).
 *
 * Not content (never a QUOTE_CONTENT_FIELDS member): nothing here prints on
 * the estimate PDF, so a change never stales the PDF or an approval. It is
 * frozen into a revision's `docFields.packageSelection` only when the live
 * quote has one; absent always reads as DEFAULT_PACKAGE_SELECTION, which is
 * exactly today's behaviour. Every reader goes through
 * normalizePackageSelection.
 */

export type PackageSelection = {
  /** Send & track's "Estimate PDF" attachment starts ticked. */
  estimatePdf: boolean;
  /** Send & track's "Cover PDF" attachment starts ticked. */
  coverPdf: boolean;
  /** Plans & risers on the package page (and its file route) for revisions sent with this on. */
  drawings: boolean;
  /** Live catalog SKUs whose datasheet stays out of this project's package. Sorted, unique. */
  excludedDatasheets: string[];
};

export const DEFAULT_PACKAGE_SELECTION: PackageSelection = { estimatePdf: true, coverPdf: true, drawings: true, excludedDatasheets: [] };
export const PACKAGE_SELECTION_MAX_EXCLUDED = 500;
export const PACKAGE_SELECTION_SKU_MAX = 200;

const flag = (v: unknown, dflt: boolean): boolean => (typeof v === "boolean" ? v : dflt);

/** Absent / junk → defaults; a non-boolean flag → its default; SKUs trimmed,
 *  non-empty, ≤ 200 chars, deduped, sorted (code-unit order), capped at 500.
 *  Unknown keys are dropped. Always returns a fresh object. */
export function normalizePackageSelection(raw: unknown): PackageSelection {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const skus = new Set<string>();
  if (Array.isArray(r.excludedDatasheets)) {
    for (const v of r.excludedDatasheets) {
      if (typeof v !== "string") continue;
      const s = v.trim();
      if (s && s.length <= PACKAGE_SELECTION_SKU_MAX) skus.add(s);
    }
  }
  const excludedDatasheets = [...skus].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, PACKAGE_SELECTION_MAX_EXCLUDED);
  return {
    estimatePdf: flag(r.estimatePdf, DEFAULT_PACKAGE_SELECTION.estimatePdf),
    coverPdf: flag(r.coverPdf, DEFAULT_PACKAGE_SELECTION.coverPdf),
    drawings: flag(r.drawings, DEFAULT_PACKAGE_SELECTION.drawings),
    excludedDatasheets,
  };
}

/** #333 review (C, D) — why a selection write was refused. */
export const PACKAGE_SELECTION_COPY = {
  tooMany: `At most ${PACKAGE_SELECTION_MAX_EXCLUDED} datasheets can be left out of one package.`,
  skuTooLong: `That product's code is over ${PACKAGE_SELECTION_SKU_MAX} characters — its datasheet can't be left out.`,
  badList: "That list of left-out datasheets couldn't be read.",
} as const;

export type SelectionPatch = Partial<PackageSelection>;
export type SelectionPatchCheck = { kind: "ignore" } | { kind: "refuse"; error: string } | { kind: "patch"; patch: SelectionPatch };

/** #333 review (C, D) — a WRITE's input, checked before it touches the stored
 *  value. null / non-object / nothing usable → "ignore" (no write). Only the
 *  fields present are patched (mergePackageSelection keeps the rest); a
 *  non-boolean flag is dropped from the patch. An exclusion list replaces the
 *  stored one: trimmed, blanks dropped, deduped, sorted — and REFUSED (never
 *  truncated) when it is not an array of strings, names a SKU over 200 chars,
 *  or holds more than 500. Reads keep using normalizePackageSelection. */
export function checkSelectionPatch(raw: unknown): SelectionPatchCheck {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { kind: "ignore" };
  const r = raw as Record<string, unknown>;
  const patch: SelectionPatch = {};
  for (const k of ["estimatePdf", "coverPdf", "drawings"] as const) if (typeof r[k] === "boolean") patch[k] = r[k] as boolean;
  if ("excludedDatasheets" in r && r.excludedDatasheets !== undefined) {
    const list = r.excludedDatasheets;
    if (!Array.isArray(list) || list.some((v) => typeof v !== "string")) return { kind: "refuse", error: PACKAGE_SELECTION_COPY.badList };
    const skus = new Set<string>();
    for (const v of list as string[]) {
      const s = v.trim();
      if (!s) continue;
      if (s.length > PACKAGE_SELECTION_SKU_MAX) return { kind: "refuse", error: PACKAGE_SELECTION_COPY.skuTooLong };
      skus.add(s);
    }
    if (skus.size > PACKAGE_SELECTION_MAX_EXCLUDED) return { kind: "refuse", error: PACKAGE_SELECTION_COPY.tooMany };
    patch.excludedDatasheets = [...skus].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
  return Object.keys(patch).length ? { kind: "patch", patch } : { kind: "ignore" };
}

/** A checked patch over the stored value (absent → the defaults). Pure. */
export function mergePackageSelection(stored: unknown, patch: SelectionPatch): PackageSelection {
  return normalizePackageSelection({ ...normalizePackageSelection(stored), ...patch });
}

/** #333 review (D) — the Client package tab's guard: leaving `add` out on top
 *  of `current` would pass a cap → the message; else null. */
export function excludeRefusal(current: readonly string[], add: readonly string[]): string | null {
  const r = checkSelectionPatch({ excludedDatasheets: [...current, ...add] });
  return r.kind === "refuse" ? r.error : null;
}

/** Stable JSON of the normalised selection — for dirty / settled tracking. */
export function selectionKey(sel: unknown): string {
  const s = normalizePackageSelection(sel);
  return JSON.stringify([s.estimatePdf, s.coverPdf, s.drawings, s.excludedDatasheets]);
}

export function isDefaultPackageSelection(sel: unknown): boolean {
  return selectionKey(sel) === selectionKey(DEFAULT_PACKAGE_SELECTION);
}

/** Send & track's starting attachment ticks (D-TBD-e: defaults only, the sender can still change them per send). */
export function attachDefaults(sel: PackageSelection | null | undefined): { attachEstimate: boolean; attachCover: boolean } {
  const s = normalizePackageSelection(sel);
  return { attachEstimate: s.estimatePdf, attachCover: s.coverPdf };
}

export const PACKAGE_SUMMARY_LABEL = "The client gets:";

export type PackageSummaryInput = {
  sel: PackageSelection;
  pdfItemizedAppendix: boolean;
  pdfCutSheets: boolean;
  cutSheetCount: number;
  drawingCount: number;
  /** Datasheet rows that go to the client / all rows / rows with no datasheet; null while unknown. */
  datasheets: { included: number; total: number; missing: number } | null;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The Client package tab's one-line summary (after PACKAGE_SUMMARY_LABEL):
 *  "Estimate PDF · Cover PDF · Package page with 2 drawings · 41 of 45 datasheets · 3 cut sheets · Itemized appendix". */
export function packageSummaryLine(i: PackageSummaryInput): string {
  const sel = normalizePackageSelection(i.sel);
  const parts: string[] = [];
  if (sel.estimatePdf) parts.push("Estimate PDF");
  if (sel.coverPdf) parts.push("Cover PDF");
  const drawings = sel.drawings ? Math.max(0, Math.floor(i.drawingCount || 0)) : 0;
  parts.push(drawings > 0 ? `Package page with ${plural(drawings, "drawing", "drawings")}` : "Package page");
  const ds = i.datasheets;
  if (ds && ds.total > 0) {
    parts.push(ds.included < ds.total ? `${ds.included} of ${ds.total} datasheets` : plural(ds.total, "datasheet", "datasheets"));
  }
  const cuts = Math.max(0, Math.floor(i.cutSheetCount || 0));
  if (i.pdfCutSheets && cuts > 0) parts.push(plural(cuts, "cut sheet", "cut sheets"));
  if (i.pdfItemizedAppendix) parts.push("Itemized appendix");
  return parts.join(" · ");
}
