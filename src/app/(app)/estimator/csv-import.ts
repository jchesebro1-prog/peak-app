import { autoMap, parseCsv, prepareRows, type FieldDef } from "../import/parse";
import type { SpecItem } from "./types";

/**
 * CSV import for estimate line items (punch #93a). Store-free — reuses the
 * import hub's parser/auto-mapper (`../import/parse.ts`) but writes directly
 * into the estimator's own section state (`pushItems`) rather than through
 * the hub's global-collection `Writer` model, which doesn't fit a value
 * nested inside one quote's `spec.sections[].items[]`.
 */

/** Column definitions for a SpecItem row. Only `desc` is required — the app
 *  already lets a line item carry no price ("price TBD", see the AI-scope
 *  draft flow) so qty/cost/price all default rather than reject the row. */
export const SPEC_ITEM_FIELDS: FieldDef[] = [
  {
    key: "category",
    header: "Category",
    label: "Category / System",
    aliases: ["category", "section", "system", "group"],
    kind: "text",
    example: "Rigging — Counterweight System",
  },
  {
    key: "sku",
    header: "SKU",
    label: "SKU",
    aliases: ["sku", "part", "partnumber", "itemnumber", "itemno", "code"],
    kind: "text",
    example: "CL-SPL-26",
  },
  {
    key: "desc",
    header: "Description",
    label: "Description",
    required: true,
    aliases: ["description", "desc", "item", "itemdescription", "name"],
    kind: "text",
    example: "Single-purchase line set, complete, 26' batten",
  },
  {
    key: "qty",
    header: "Qty",
    label: "Qty",
    aliases: ["qty", "quantity", "count"],
    kind: "number",
    example: "1",
  },
  {
    key: "unit",
    header: "Unit",
    label: "Unit",
    aliases: ["unit", "uom", "units"],
    kind: "text",
    example: "ea",
  },
  {
    key: "cost",
    header: "Cost",
    label: "Cost (each)",
    aliases: ["cost", "unitcost", "ourcost"],
    kind: "number",
    example: "1439.00",
  },
  {
    key: "price",
    header: "Price",
    label: "Price (each)",
    aliases: ["price", "sell", "sellprice", "unitprice"],
    kind: "number",
    example: "2180.00",
  },
];

function csvCell(s: unknown): string {
  const str = s == null ? "" : String(s);
  return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
}

/** Downloadable template: header row + one worked example (mirrors
 *  import/registry.ts's templateCsv, minus the store dependency). */
export function specItemTemplateCsv(): string {
  const header = SPEC_ITEM_FIELDS.map((f) => csvCell(f.header)).join(",");
  const example = SPEC_ITEM_FIELDS.map((f) => csvCell(f.example || "")).join(",");
  return header + "\n" + example + "\n";
}

export type ParsedSpecRow = {
  category: string;
  sku: string;
  desc: string;
  qty: number;
  unit: string;
  cost: number;
  price: number;
  valid: boolean;
  errors: string[];
};

export type ParsedSpecCsv = {
  ok: boolean;
  error?: string;
  headers: string[];
  rows: ParsedSpecRow[];
  stats: { total: number; valid: number; invalid: number };
};

/** Parse pasted/uploaded CSV text into SpecItem-shaped rows (validation only
 *  — does not mint ids or decide which section a row lands in). */
export function parseSpecItemsCsv(text: string): ParsedSpecCsv {
  const table = parseCsv(text);
  if (!table.ok) {
    return {
      ok: false,
      error: table.error,
      headers: [],
      rows: [],
      stats: { total: 0, valid: 0, invalid: 0 },
    };
  }
  const mapping = autoMap(table.headers, SPEC_ITEM_FIELDS);
  const prepared = prepareRows(table.rows, mapping, SPEC_ITEM_FIELDS);
  const rows: ParsedSpecRow[] = prepared.rows.map((r) => ({
    category: String(r.values.category ?? ""),
    sku: String(r.values.sku ?? ""),
    desc: String(r.values.desc ?? ""),
    qty: Number(r.values.qty) || 0,
    unit: String(r.values.unit ?? "") || "ea",
    cost: Number(r.values.cost) || 0,
    price: Number(r.values.price) || 0,
    valid: r.valid,
    errors: r.errors,
  }));
  return { ok: true, headers: table.headers, rows, stats: prepared.stats };
}

/** A validated row, ready to become a SpecItem once an id is minted. */
export function toSpecItemInput(row: ParsedSpecRow): Omit<SpecItem, "id"> {
  return {
    sku: row.sku,
    desc: row.desc,
    qty: row.qty > 0 ? row.qty : 1,
    unit: row.unit,
    cost: row.cost,
    price: row.price,
  };
}
