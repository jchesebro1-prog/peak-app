import { mfrKey } from "@/lib/catalog-books";
import { cleanModel, modelSku } from "./sku";

/**
 * #302 — plan a model-number rename from a crosswalk sheet (ChatGPT's
 * "Peak model number crosswalk … filled" workbooks). Pure: every row gets
 * exactly one outcome; only `rename` rows are ever applied.
 */

export type CrosswalkRow = { rowNumber: number; manufacturer: string; mfrPart: string; sku: string; model: string; notes: string };
export const CROSSWALK_MAX_ROWS = 5000;
export const CROSSWALK_CELL_MAX = 2048;

const HEADERS: Record<keyof Omit<CrosswalkRow, "rowNumber">, string[]> = {
  manufacturer: ["manufacturer", "mfr"],
  mfrPart: ["mfr part # (order number)", "mfr part #", "mfr p/n", "mfr pn", "order number"],
  sku: ["sku"],
  model: ["model #", "model number", "mfr m/n", "model"],
  notes: ["notes", "note"],
};

export function crosswalkRowsFromGrid(grid: string[][]): { ok: true; rows: CrosswalkRow[] } | { ok: false; error: string } {
  const head = (grid[0] ?? []).map((h) => String(h ?? "").trim().toLowerCase());
  const col = (k: keyof typeof HEADERS) => head.findIndex((h) => HEADERS[k].includes(h));
  const at = { manufacturer: col("manufacturer"), mfrPart: col("mfrPart"), sku: col("sku"), model: col("model"), notes: col("notes") };
  if (at.sku < 0 || at.model < 0 || at.manufacturer < 0) return { ok: false, error: "The sheet needs Manufacturer, SKU and Model # columns (the crosswalk's own headers)." };
  const body = grid.slice(1);
  if (body.length > CROSSWALK_MAX_ROWS) return { ok: false, error: `The sheet has more than ${CROSSWALK_MAX_ROWS.toLocaleString()} rows.` };
  const rows: CrosswalkRow[] = [];
  body.forEach((cells, i) => {
    const v = (c: number) => (c < 0 ? "" : String(cells?.[c] ?? "").trim().slice(0, CROSSWALK_CELL_MAX));
    if (!v(at.sku) && !v(at.model)) return;
    rows.push({ rowNumber: i + 2, manufacturer: v(at.manufacturer), mfrPart: v(at.mfrPart), sku: v(at.sku), model: v(at.model), notes: v(at.notes) });
  });
  return { ok: true, rows };
}

export type RenameOutcome = "rename" | "already" | "skip:no-model" | "skip:not-found" | "skip:mfr-mismatch" | "skip:bad-model" | "skip:taken" | "skip:duplicate" | "skip:same";
export type PlannedRow = { row: CrosswalkRow; outcome: RenameOutcome; from: string; to: string | null; model: string; reason: string };
export type PlanPart = { sku: string; mfr?: string; formerSkus?: string[] };
export type RenamePlan = { rows: PlannedRow[]; counts: Record<RenameOutcome, number>; renames: Array<{ from: string; to: string; model: string }> };

const REASON: Record<RenameOutcome, string> = {
  rename: "",
  already: "Already renamed.",
  "skip:no-model": "No Model # on this row.",
  "skip:not-found": "No catalog part has this SKU.",
  "skip:mfr-mismatch": "The part's manufacturer doesn't match this row.",
  "skip:bad-model": "The model can't make a SKU (blank brand or over 60 characters).",
  "skip:taken": "Another part already has this SKU.",
  "skip:duplicate": "Another row gives the same SKU — give each variant its own model.",
  "skip:same": "The SKU already is the model.",
};

export function planRenames(rows: CrosswalkRow[], live: PlanPart[], retired: Array<{ sku: string; renamedTo?: string }>): RenamePlan {
  const liveBy = new Map(live.map((p) => [p.sku, p]));
  const liveUpper = new Map(live.map((p) => [p.sku.toUpperCase(), p]));
  const formerUpper = new Set(live.flatMap((p) => (p.formerSkus ?? []).map((s) => s.toUpperCase())));
  const retiredBy = new Map(retired.map((r) => [r.sku, r.renamedTo]));
  const retiredUpper = new Set(retired.map((r) => r.sku.toUpperCase()));
  const formerOwner = new Map<string, PlanPart>();
  for (const p of live) for (const s of p.formerSkus ?? []) if (!formerOwner.has(s)) formerOwner.set(s, p);
  // Some catalogs store these parts as "Brand:OrderNo" while the sheet's SKU
  // column holds the bare order number — index each live part (and each
  // former SKU) by manufacturer + the text after its first colon.
  const tail = (s: string) => {
    const i = s.indexOf(":");
    return i < 0 ? null : s.slice(i + 1).trim().toUpperCase();
  };
  const tailParts = new Map<string, PlanPart[]>();
  const tailFormer = new Map<string, PlanPart>();
  for (const p of live) {
    const mk = mfrKey(p.mfr);
    const t = tail(p.sku);
    if (t) tailParts.set(`${mk}|${t}`, [...(tailParts.get(`${mk}|${t}`) ?? []), p]);
    for (const f of p.formerSkus ?? []) {
      const ft = tail(f);
      if (ft && !tailFormer.has(`${mk}|${ft}`)) tailFormer.set(`${mk}|${ft}`, p);
    }
  }
  const first: PlannedRow[] = rows.map((row) => {
    const model = cleanModel(row.model);
    const mk = (outcome: RenameOutcome, to: string | null = null, from: string = row.sku): PlannedRow => ({ row, outcome, from, to, model, reason: REASON[outcome] });
    if (!model) return mk("skip:no-model");
    let part = liveBy.get(row.sku);
    if (!part) {
      const key = `${mfrKey(row.manufacturer)}|${row.sku.trim().toUpperCase()}`;
      const cands = tailParts.get(key) ?? [];
      if (cands.length > 1) return mk("skip:not-found");
      if (cands.length === 1) part = cands[0];
    }
    const brand = part?.mfr || row.manufacturer;
    const to = modelSku(brand, model);
    if (!part) {
      const holder = formerOwner.get(row.sku) ?? tailFormer.get(`${mfrKey(row.manufacturer)}|${row.sku.trim().toUpperCase()}`);
      if (holder) return mk("already", holder.sku);
      const target = retiredBy.get(row.sku);
      if (target && to && target.toUpperCase() === to.toUpperCase()) return mk("already", to);
      return mk("skip:not-found");
    }
    if (mfrKey(part.mfr) !== mfrKey(row.manufacturer)) return mk("skip:mfr-mismatch");
    if (!to) return mk("skip:bad-model");
    if (to.toUpperCase() === part.sku.toUpperCase()) return mk("skip:same", to, part.sku);
    const owner = liveUpper.get(to.toUpperCase());
    if ((owner && owner.sku !== part.sku) || formerUpper.has(to.toUpperCase()) || retiredUpper.has(to.toUpperCase())) return mk("skip:taken", to);
    return mk("rename", to, part.sku);
  });
  const byTo = new Map<string, number>();
  const byFrom = new Map<string, number>();
  for (const r of first) if (r.outcome === "rename" && r.to) {
    byTo.set(r.to.toUpperCase(), (byTo.get(r.to.toUpperCase()) ?? 0) + 1);
    byFrom.set(r.from, (byFrom.get(r.from) ?? 0) + 1);
  }
  const dup = (r: PlannedRow) => r.outcome === "rename" && !!r.to && ((byTo.get(r.to.toUpperCase()) ?? 0) > 1 || (byFrom.get(r.from) ?? 0) > 1);
  const out = first.map((r) => (dup(r) ? { ...r, outcome: "skip:duplicate" as const, reason: REASON["skip:duplicate"] } : r));
  const counts = Object.fromEntries(Object.keys(REASON).map((k) => [k, 0])) as Record<RenameOutcome, number>;
  for (const r of out) counts[r.outcome]++;
  const renames = out.filter((r) => r.outcome === "rename" && r.to).map((r) => ({ from: r.from, to: r.to!, model: r.model }));
  return { rows: out, counts, renames };
}
