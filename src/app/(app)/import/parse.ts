/**
 * Minimal CSV / TSV parsing + field auto-mapping for the Import hub.
 *
 * Self-contained port of the pieces of the prototype's `import-parse.js`
 * (CSV path only) and `importkit.js` (autoMap / coerce / prepare) that this
 * screen needs. Kept INSIDE the import route folder and free of any store
 * imports so it is safe to run in a client component (live preview) AND in a
 * server action (the authoritative write). The `.xlsx` branch of the
 * prototype parser is intentionally dropped — uploads are converted to CSV
 * server-side first (see `/api/import/xlsx`), and the result still feeds the
 * same paste path this module parses.
 */

export type FieldKind = "text" | "number" | "date" | "email" | "enum";

export type FieldDef = {
  key: string;
  header: string;
  label: string;
  required?: boolean;
  kind?: FieldKind;
  aliases: string[];
  example?: string;
  options?: string[];
};

export type ParsedTable = {
  ok: boolean;
  error?: string;
  headers: string[];
  rows: string[][];
  objects: Record<string, string>[];
};

/* ---------------- CSV / TSV ---------------- */

export function detectDelimiter(text: string): string {
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

export function parseCsv(text: string, delim?: string): ParsedTable {
  if (!text) return { ok: false, error: "Nothing pasted yet.", headers: [], rows: [], objects: [] };
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const d = delim || detectDelimiter(text);
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
  const clean = grid
    .map((r) => r.map((c) => (c == null ? "" : String(c)).trim()))
    .filter((r) => r.some((c) => c !== ""));
  return finalizeGrid(clean);
}

function finalizeGrid(grid: string[][]): ParsedTable {
  const nonEmpty = grid.filter((r) => r && r.some((c) => (c || "").trim() !== ""));
  if (!nonEmpty.length)
    return { ok: false, error: "No rows found — paste a header row plus at least one data row.", headers: [], rows: [], objects: [] };
  const width = nonEmpty.reduce((m, r) => Math.max(m, r.length), 0);
  const pad = (r: string[]) => {
    const a = r.slice();
    while (a.length < width) a.push("");
    return a.map((c) => (c == null ? "" : String(c)));
  };
  const headers = pad(nonEmpty[0]).map((h, i) => (h && h.trim() ? h.trim() : "Column " + (i + 1)));
  const rows = nonEmpty.slice(1).map(pad);
  const objects = rows.map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => {
      o[h] = r[i] != null ? r[i] : "";
    });
    return o;
  });
  return { ok: true, headers, rows, objects };
}

/* ---------------- coercion ---------------- */

export function norm(s: unknown): string {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function toNum(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : "" + n;
}

export function toISO(v: unknown): string {
  if (!v) return "";
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return m[1] + "-" + pad2(+m[2]) + "-" + pad2(+m[3]);
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(s);
  if (m) {
    const mo = +m[1];
    const da = +m[2];
    let yr = +m[3];
    if (yr < 100) yr += 2000;
    return yr + "-" + pad2(mo) + "-" + pad2(da);
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  return "";
}

export function isoToMs(iso: string): number | null {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null;
}

export function coerce(field: FieldDef, v: unknown): string | number {
  const s = v == null ? "" : String(v).trim();
  if (field.kind === "number") return toNum(s);
  if (field.kind === "date") return toISO(s);
  if (field.kind === "email") return s.toLowerCase();
  return s;
}

/* ---------------- auto-map headers -> fields ---------------- */
/**
 * Two passes so specific columns win: (1) EXACT normalized matches, (2) fuzzy
 * "contains" for longer aliases only. Direct port of importkit.autoMap.
 * Returns a field-key -> column-index map (index -1 == unmapped).
 */
export function autoMap(headers: string[], fields: FieldDef[]): Record<string, number> {
  const H = (headers || []).map(norm);
  const used: Record<number, boolean> = {};
  const map: Record<string, number> = {};
  const candsOf = (f: FieldDef) =>
    [f.header, f.label, f.key].concat(f.aliases || []).map(norm).filter(Boolean);
  fields.forEach((f) => {
    map[f.key] = -1;
  });
  fields.forEach((f) => {
    if (map[f.key] >= 0) return;
    const cands = candsOf(f);
    for (let i = 0; i < H.length; i++) {
      if (used[i] || !H[i]) continue;
      if (cands.indexOf(H[i]) >= 0) {
        map[f.key] = i;
        used[i] = true;
        break;
      }
    }
  });
  fields.forEach((f) => {
    if (map[f.key] >= 0) return;
    const cands = candsOf(f).filter((c) => c.length >= 4);
    for (let i = 0; i < H.length; i++) {
      if (used[i] || !H[i] || H[i].length < 3) continue;
      if (cands.some((c) => H[i].indexOf(c) >= 0 || c.indexOf(H[i]) >= 0)) {
        map[f.key] = i;
        used[i] = true;
        break;
      }
    }
  });
  return map;
}

/* ---------------- prepare + validate (no dedupe) ---------------- */

export type PreparedRow = {
  i: number;
  values: Record<string, string | number>;
  valid: boolean;
  errors: string[];
};

export type PreparedTable = {
  rows: PreparedRow[];
  stats: { total: number; valid: number; invalid: number };
};

/**
 * Coerce every raw row against the mapping + field defs and flag validity
 * (required fields present). Duplicate detection is NOT done here — it needs
 * the live store and happens server-side at commit against the chosen mode.
 */
export function prepareRows(
  rows: string[][],
  mapping: Record<string, number>,
  fields: FieldDef[]
): PreparedTable {
  const prepared = rows.map((raw, i) => {
    const values: Record<string, string | number> = {};
    fields.forEach((f) => {
      const idx = mapping[f.key];
      const v = idx != null && idx >= 0 ? raw[idx] : "";
      values[f.key] = coerce(f, v);
    });
    const errors: string[] = [];
    fields.forEach((f) => {
      if (f.required && !String(values[f.key] == null ? "" : values[f.key]).trim())
        errors.push("Missing " + f.label);
    });
    return { i, values, valid: errors.length === 0, errors };
  });
  return {
    rows: prepared,
    stats: {
      total: prepared.length,
      valid: prepared.filter((r) => r.valid).length,
      invalid: prepared.filter((r) => !r.valid).length,
    },
  };
}
