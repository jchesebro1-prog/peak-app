/**
 * Minimal CSV/TSV parsing + catalog column mapping for the price-book import.
 * Self-contained (no store imports) so both the client paste-preview and the
 * server import action can use it. A trimmed port of the prototype's
 * import-parse.js CSV path; xlsx/pdf uploads are out of scope (see the stubbed
 * upload affordance — real files funnel through paste).
 */

export type CatalogRow = {
  sku: string;
  desc: string;
  category: string;
  unit: string;
  list: number;
  cost: number;
  valid: boolean;
};

export type CatalogParse = {
  ok: boolean;
  error?: string;
  rows: CatalogRow[];
  stats: { total: number; valid: number; invalid: number };
};

const ALIASES: Record<keyof Omit<CatalogRow, "valid">, string[]> = {
  sku: ["sku", "item", "itemnumber", "item number", "part", "partnumber", "part number", "partno", "itemno", "code", "catalog"],
  desc: ["description", "desc", "productdescription", "product description", "name", "itemdescription", "item description", "product"],
  category: ["category", "cat", "productfamily", "product family", "family", "group", "class"],
  unit: ["unit", "uom", "units", "u/m", "um"],
  list: ["list", "listprice", "list price", "list$", "list $", "price", "msrp", "retail", "unitprice"],
  cost: ["cost", "dealernet", "dealer net", "net", "dealer", "wholesale", "ourcost", "our cost", "netprice"],
};

function norm(s: unknown): string {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function toNum(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}

function detectDelimiter(text: string): string {
  const head = text.slice(0, 4000).split(/\r?\n/).slice(0, 5).join("\n");
  const counts: Record<string, number> = { ",": 0, "\t": 0, ";": 0, "|": 0 };
  let inQ = false;
  for (let i = 0; i < head.length; i++) {
    const ch = head[i];
    if (ch === '"') inQ = !inQ;
    else if (!inQ && counts[ch] != null) counts[ch]++;
  }
  let best = ",";
  let n = -1;
  for (const d in counts)
    if (counts[d] > n) {
      n = counts[d];
      best = d;
    }
  return best;
}

function parseGrid(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const d = detectDelimiter(text);
  const grid: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === d) {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        grid.push(row);
        row = [];
        field = "";
      } else if (ch === "\r") {
        if (text[i + 1] !== "\n") {
          row.push(field);
          grid.push(row);
          row = [];
          field = "";
        }
      } else field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    grid.push(row);
  }
  return grid
    .map((r) => r.map((c) => (c == null ? "" : String(c)).trim()))
    .filter((r) => r.some((c) => c !== ""));
}

/** Does the row look like a header (matches known column names)? */
function looksLikeHeader(row: string[]): boolean {
  const hits = row.filter((c) => {
    const nc = norm(c);
    return Object.values(ALIASES).some((al) => al.some((a) => norm(a) === nc));
  }).length;
  return hits >= 2;
}

/**
 * Parse a pasted price book into catalog rows. If the first row is a header we
 * map columns by name; otherwise we fall back to positional order
 * SKU, Description, Category, Unit, List, Cost. `defaultCategory` fills rows
 * whose category is blank/absent.
 */
export function parseCatalog(text: string, defaultCategory = ""): CatalogParse {
  if (!text || !text.trim())
    return { ok: false, error: "Nothing pasted yet.", rows: [], stats: { total: 0, valid: 0, invalid: 0 } };

  const grid = parseGrid(text);
  if (!grid.length)
    return { ok: false, error: "No rows found — paste at least one part.", rows: [], stats: { total: 0, valid: 0, invalid: 0 } };

  let dataRows = grid;
  const map: Record<keyof Omit<CatalogRow, "valid">, number> = {
    sku: 0,
    desc: 1,
    category: 2,
    unit: 3,
    list: 4,
    cost: 5,
  };

  if (looksLikeHeader(grid[0])) {
    const header = grid[0].map(norm);
    (Object.keys(ALIASES) as Array<keyof typeof ALIASES>).forEach((k) => {
      const al = ALIASES[k].map(norm);
      const idx = header.findIndex((h) => h && al.indexOf(h) >= 0);
      map[k] = idx; // -1 when absent
    });
    dataRows = grid.slice(1);
  }

  const rows: CatalogRow[] = dataRows.map((r) => {
    const at = (i: number) => (i >= 0 && i < r.length ? r[i] : "");
    const sku = at(map.sku).trim();
    const desc = at(map.desc).trim();
    const category = at(map.category).trim() || defaultCategory;
    const unit = at(map.unit).trim() || "ea";
    const list = toNum(at(map.list));
    const cost = toNum(at(map.cost));
    const valid = !!sku && !!desc;
    return { sku, desc, category, unit, list, cost, valid };
  });

  return {
    ok: true,
    rows,
    stats: {
      total: rows.length,
      valid: rows.filter((r) => r.valid).length,
      invalid: rows.filter((r) => !r.valid).length,
    },
  };
}
