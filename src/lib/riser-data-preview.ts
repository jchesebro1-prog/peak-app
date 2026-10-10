/**
 * #328 A2 — the riser data sheet's preview model and Apply patch: pure (no
 * store/db imports), so the page's client half and the harness share it.
 * Built on A1's parse + plan (`riser-data-sheet.ts`); a sheet row that resolves
 * to a part but changes nothing is "unchanged", a row whose SKU is not in the
 * catalog is "unknown", and a row with a refused cell never reaches here (it is
 * in the parse's `errors`).
 */
import type { TagFields } from "@/lib/design/conduit-riser/tags";
import { planRiserDataApply, type ParseResult, type RiserChange, type RiserPartLike, type RiserState } from "@/lib/riser-data-sheet";
import { partModel } from "@/lib/catalog-rename/sku";

/** Sheet-size guards (the Photo sheet's byte cap; rows counted as data rows). */
export const MAX_RISER_SHEET_BYTES = 800 * 1024;
export const MAX_RISER_SHEET_ROWS = 10_000;
export const RISER_SHEET_TOO_BIG = "That sheet is over 800 KB — delete the rows you didn't change (or split it) and upload it again.";
export const RISER_SHEET_TOO_MANY_ROWS = `That sheet has more than ${MAX_RISER_SHEET_ROWS.toLocaleString("en-US")} rows — split it and upload it in pieces.`;

export type FieldChange = { label: string; from: string; to: string };
export type PreviewRow = {
  /** 1-based sheet row. */
  row: number;
  /** The SKU as written on the sheet. */
  sku: string;
  /** The part's own SKU when the sheet SKU was renamed (#304); otherwise absent. */
  renamedTo?: string;
  label: string;
  changes: FieldChange[];
};
export type RiserPreview = {
  notes: string[];
  /** Rows refused at parse time — they write nothing. */
  errors: { row: number; message: string }[];
  changed: PreviewRow[];
  unchanged: Omit<PreviewRow, "changes">[];
  unknown: { row: number; sku: string }[];
};

const FIELDS: readonly { label: string; get: (s: RiserState) => string }[] = [
  { label: "Designator code", get: (s) => s.designatorCode || "" },
  { label: "Box", get: (s) => s.tagDefaults?.box || "" },
  { label: "Face", get: (s) => s.tagDefaults?.face || "" },
  { label: "Mount", get: (s) => s.tagDefaults?.mount || "" },
  { label: "Height", get: (s) => s.tagDefaults?.height || "" },
  { label: "P/D", get: (s) => s.tagDefaults?.pd || "" },
];

/** Field-by-field old → new for one change (only the fields that differ). */
export function fieldChanges(c: Pick<RiserChange, "before" | "after">): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of FIELDS) {
    const from = f.get(c.before);
    const to = f.get(c.after);
    if (from !== to) out.push({ label: f.label, from, to });
  }
  return out;
}

const labelOf = (p: RiserPartLike) => [p.manufacturer, partModel(p)].filter(Boolean).join(" ") || p.sku;

/** The preview of a parsed sheet against the parts its SKUs resolve to (renames already followed). */
export function buildRiserPreview(parse: ParseResult, partsBySku: ReadonlyMap<string, RiserPartLike>): RiserPreview {
  const plan = planRiserDataApply(parse.rows, partsBySku);
  const changeOf = new Map(plan.changes.map((c) => [c.sku, c] as const));
  const shown = new Set<string>();
  const changed: PreviewRow[] = [];
  const unchanged: RiserPreview["unchanged"] = [];
  const unknown: RiserPreview["unknown"] = [];
  for (const r of parse.rows) {
    const part = partsBySku.get(r.sku);
    if (!part) {
      unknown.push({ row: r.row, sku: r.sku });
      continue;
    }
    const base = { row: r.row, sku: r.sku, ...(part.sku !== r.sku ? { renamedTo: part.sku } : {}), label: labelOf(part) };
    const change = changeOf.get(part.sku);
    if (change && !shown.has(part.sku)) {
      shown.add(part.sku);
      changed.push({ ...base, changes: fieldChanges(change) });
    } else if (!change) unchanged.push(base);
  }
  return { notes: parse.notes, errors: parse.errors, changed, unchanged, unknown };
}

/** The `mergeUpsert` patch for one change: ONLY designatorCode / tagDefaults; null → undefined (clears). */
export function upsertPatchOf(c: Pick<RiserChange, "patch">): { designatorCode?: string | undefined; tagDefaults?: TagFields | undefined } {
  const out: { designatorCode?: string | undefined; tagDefaults?: TagFields | undefined } = {};
  if (c.patch.designatorCode !== undefined) out.designatorCode = c.patch.designatorCode ?? undefined;
  if (c.patch.tagDefaults !== undefined) out.tagDefaults = c.patch.tagDefaults ?? undefined;
  return out;
}
