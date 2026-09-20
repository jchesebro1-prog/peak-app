export type ImportedMaterial = {
  sku: string;
  desc: string;
  qty: number;
  unit: string;
  cost: number;
  price: number;
  link?: string;
};

export type MaterialCsvResult = {
  items: ImportedMaterial[];
  errors: string[];
};

export const MATERIAL_CSV_TEMPLATE =
  "sku,description,quantity,unit,unit_cost,unit_sell,link\n" +
  "ABC-100,Example catalog or custom part,1,ea,100.00,142.86,https://vendor.example/item\n";

const ALIASES = {
  sku: ["sku", "part no", "part number", "part", "model", "item"],
  desc: ["description", "desc", "item name", "name", "product"],
  qty: ["quantity", "qty", "count"],
  unit: ["unit", "uom"],
  cost: ["unit cost", "unit_cost", "cost", "dealer cost"],
  price: ["unit sell", "unit_sell", "sell", "price", "unit price"],
  link: ["link", "url", "product link", "product_link"],
} as const;

function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function indexOf(headers: string[], aliases: readonly string[]): number {
  const values = headers.map(normalized);
  return aliases.map(normalized).map((alias) => values.indexOf(alias)).find((index) => index >= 0) ?? -1;
}

function money(value: string): number {
  const parsed = Number((value || "").replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function parseMaterialCsv(text: string): MaterialCsvResult {
  const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return { items: [], errors: ["Choose a CSV with a header row and at least one material row."] };
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = splitLine(lines[0], delimiter);
  const col = {
    sku: indexOf(headers, ALIASES.sku),
    desc: indexOf(headers, ALIASES.desc),
    qty: indexOf(headers, ALIASES.qty),
    unit: indexOf(headers, ALIASES.unit),
    cost: indexOf(headers, ALIASES.cost),
    price: indexOf(headers, ALIASES.price),
    link: indexOf(headers, ALIASES.link),
  };
  if (col.desc < 0 || col.price < 0) {
    return { items: [], errors: ["The CSV needs description and unit_sell columns. Download the example for the supported layout."] };
  }

  const items: ImportedMaterial[] = [];
  const errors: string[] = [];
  lines.slice(1).forEach((line, index) => {
    const cells = splitLine(line, delimiter);
    const row = index + 2;
    const desc = (cells[col.desc] || "").trim();
    const qty = col.qty >= 0 ? Number(cells[col.qty]) : 1;
    const price = money(cells[col.price] || "");
    const cost = col.cost >= 0 ? money(cells[col.cost] || "0") : 0;
    if (!desc || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0 || !Number.isFinite(cost) || cost < 0) {
      errors.push(`Row ${row}: description, positive quantity, non-negative unit cost, and positive unit sell are required.`);
      return;
    }
    const link = col.link >= 0 ? (cells[col.link] || "").trim() : "";
    items.push({
      sku: col.sku >= 0 ? (cells[col.sku] || "").trim() : "",
      desc,
      qty,
      unit: col.unit >= 0 ? (cells[col.unit] || "").trim() || "ea" : "ea",
      cost,
      price,
      ...(link ? { link } : {}),
    });
  });
  return { items, errors };
}
