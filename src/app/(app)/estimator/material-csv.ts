export type ImportedMaterial = {
  sku: string;
  desc: string;
  manufacturerPartNumber?: string;
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

/**
 * Two example rows (#112): a catalog part needs only sku + quantity — its
 * description, unit, cost and sell come from the catalog at import time — and
 * a custom part carries its own description and numbers.
 */
export const MATERIAL_CSV_TEMPLATE =
  "sku,description,quantity,unit,unit_cost,unit_sell,link\n" +
  "ABC-100,,4,,,,\n" +
  ",Example custom part,1,ea,100.00,142.86,https://vendor.example/item\n";

/**
 * The vendor-quote form's own example (#143 re-review). Its headers are the
 * ones that form's Materials grid shows, so a file saved from it round-trips.
 * Separate from MATERIAL_CSV_TEMPLATE on purpose: that one is the catalog
 * layout, and the spec harness asserts its parsed output line by line.
 *
 * #143: amount is the row's EXTENDED total — what its aliases (total, line
 * total, extended) mean and what the form sums — so the examples below show
 * 120 ft at $222.00 and 40 ea at $168.00, not per-unit prices.
 */
export const VENDOR_CSV_TEMPLATE =
  "description,quantity,unit,amount\n" +
  '"1/4in wire rope, 7x19 galvanized",120,ft,222.00\n' +
  '"Shackle, 3/8in screw pin",40,ea,168.00\n';

const ALIASES = {
  sku: ["sku", "part no", "part number", "part", "model", "item"],
  manufacturerPartNumber: ["mfr p/n", "mfr part number", "manufacturer part number", "manufacturer p/n"],
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

/**
 * Money as a person types or a vendor prints it — "$12,450.00" included.
 * Exported (#143 re-review) so the vendor-quote form's typed Total and line
 * Amounts parse exactly the way the same number does through a CSV; a bare
 * parseFloat("12,450.00") silently returns 12.
 */
export function parseMoney(value: string): number {
  const parsed = Number((value || "").replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * Bytes → text the way Excel actually saves a CSV. `File.text()` always
 * decodes UTF-8, which turns Excel's "UTF-16 Unicode Text" save (tab-
 * delimited, UTF-16LE with an FF FE BOM) into a NUL between every character:
 * the header still matches, but every quantity and amount reads as NaN and
 * every row is rejected. Excel's plain "Comma Separated Values" save is
 * Windows-1252, not UTF-8, so an "é" would otherwise come out as "�".
 */
export function decodeCsvBytes(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text: string;
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    text = new TextDecoder("utf-16le").decode(b.subarray(2));
  } else if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    text = new TextDecoder("utf-16be").decode(b.subarray(2));
  } else if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    text = new TextDecoder("utf-8").decode(b.subarray(3));
  } else {
    // No BOM: UTF-16 text that is mostly ASCII has a zero in every other byte.
    const sample = b.subarray(0, Math.min(b.length, 512));
    let evenZero = 0;
    let oddZero = 0;
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) {
        if (i % 2) oddZero++;
        else evenZero++;
      }
    }
    const pairs = Math.floor(sample.length / 2);
    const le = pairs > 0 && oddZero / pairs >= 0.3 && evenZero / pairs < 0.1;
    const be = pairs > 0 && evenZero / pairs >= 0.3 && oddZero / pairs < 0.1;
    if (le) text = new TextDecoder("utf-16le").decode(b);
    else if (be) text = new TextDecoder("utf-16be").decode(b);
    else {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(b);
      } catch {
        text = new TextDecoder("windows-1252").decode(b);
      }
    }
  }
  return text.replace(/^\ufeff/, "");
}

/** Read an uploaded CSV through decodeCsvBytes instead of `File.text()`. */
export function readCsvFile(file: Blob): Promise<string> {
  return file.arrayBuffer().then(decodeCsvBytes);
}

/**
 * One message for a file whose rows were all rejected. Joining every row's
 * error repeated the same sentence once per row — on an Excel save that
 * failed every row, a wall of identical text that hid the one real problem.
 */
export function summarizeCsvErrors(errors: string[]): string {
  if (!errors.length) return "";
  if (errors.length === 1) return errors[0];
  const more = errors.length - 1;
  const reason = (e: string) => e.replace(/^Row \d+:\s*/, "");
  const same = errors.every((e) => reason(e) === reason(errors[0]));
  return same
    ? `${errors[0]} (${more} more row${more === 1 ? "" : "s"} with the same kind of problem.)`
    : `${errors[0]} (+${more} more row${more === 1 ? "" : "s"} skipped.)`;
}

export type MaterialCsvOptions = {
  /**
   * #143: a vendor's own material list quotes COST, not sell. In that mode a
   * row with a description and a positive unit cost is enough — the estimator
   * never prices those lines individually (the vendor's rolled-up total is
   * the money). Omitted / false keeps the #112 catalog-import rule, which is
   * what MATERIAL_CSV_TEMPLATE and its tests describe.
   */
  costOnly?: boolean;
};

export function parseMaterialCsv(text: string, opts: MaterialCsvOptions = {}): MaterialCsvResult {
  // Excel's "Macintosh CSV" save ends lines with a bare \r.
  const lines = String(text || "")
    .replace(/^\ufeff/, "")
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim());
  if (lines.length < 2) return { items: [], errors: ["Choose a CSV with a header row and at least one material row."] };
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = splitLine(lines[0], delimiter);
  // #143 re-review: a vendor's list calls the money column what the form's
  // own grid calls it — Amount — so in costOnly mode those words map to cost.
  const costAliases = opts.costOnly
    ? [...ALIASES.cost, "amount", "total", "line total", "line amount", "extended", "ext", "ext cost"]
    : ALIASES.cost;
  const col = {
    sku: indexOf(headers, ALIASES.sku),
    manufacturerPartNumber: indexOf(headers, ALIASES.manufacturerPartNumber),
    desc: indexOf(headers, ALIASES.desc),
    qty: indexOf(headers, ALIASES.qty),
    unit: indexOf(headers, ALIASES.unit),
    cost: indexOf(headers, costAliases),
    price: indexOf(headers, ALIASES.price),
    link: indexOf(headers, ALIASES.link),
  };
  if (col.sku < 0 && col.desc < 0) {
    return { items: [], errors: ["The CSV needs a sku or description column. Download the example for the supported layout."] };
  }

  const items: ImportedMaterial[] = [];
  const errors: string[] = [];
  lines.slice(1).forEach((line, index) => {
    const cells = splitLine(line, delimiter);
    const row = index + 2;
    // #112: a row with a SKU may leave description / cost / sell blank — the
    // estimator fills those from the catalog. A custom row (no SKU) still
    // needs a description and a positive sell price, since nothing else can
    // price it.
    const sku = col.sku >= 0 ? (cells[col.sku] || "").trim() : "";
    const manufacturerPartNumber = col.manufacturerPartNumber >= 0 ? (cells[col.manufacturerPartNumber] || "").trim() : "";
    const desc = col.desc >= 0 ? (cells[col.desc] || "").trim() : "";
    const qty = col.qty >= 0 ? Number(cells[col.qty]) : 1;
    const price = col.price >= 0 ? parseMoney(cells[col.price] || "0") : 0;
    const cost = col.cost >= 0 ? parseMoney(cells[col.cost] || "0") : 0;
    const numbersOk = Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price >= 0 && Number.isFinite(cost) && cost >= 0;
    /* costOnly rows are never re-priced from the catalog, so a SKU cannot
       stand in for a missing amount the way it does for a #112 import
       (#143 re-review: a zero-amount row used to load silently and deflate
       the vendor total the form falls back to). */
    const identified = opts.costOnly
      ? (!!desc || !!sku) && (price > 0 || cost > 0)
      : sku
      ? true
      : !!desc && price > 0;
    if (!numbersOk || !identified) {
      errors.push(
        opts.costOnly
          ? `Row ${row}: a description with a positive amount, plus a positive quantity, are required.`
          : sku
          ? `Row ${row}: positive quantity and non-negative unit cost / unit sell are required.`
          : `Row ${row}: a sku, or a description with a positive unit sell, plus a positive quantity and non-negative unit cost are required.`
      );
      return;
    }
    const link = col.link >= 0 ? (cells[col.link] || "").trim() : "";
    items.push({
      sku,
      desc,
      ...(manufacturerPartNumber ? { manufacturerPartNumber } : {}),
      qty,
      // Blank stays blank so a catalog SKU can inherit the part's unit (#112);
      // the estimator falls back to "ea" for custom rows.
      unit: col.unit >= 0 ? (cells[col.unit] || "").trim() : "",
      cost,
      price,
      ...(link ? { link } : {}),
    });
  });
  return { items, errors };
}
