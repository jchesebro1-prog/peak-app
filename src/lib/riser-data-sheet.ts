/**
 * #328 A — the riser data sheet's pure model: which catalog parts are listed,
 * how a blank part is pre-filled from the suggestion rules, how an uploaded
 * grid is read, and the per-part changes an Apply would make. Pure (no
 * store/db imports) — the page's client half imports it.
 *
 * Cell rules on upload: blank = leave unchanged, `-` = clear, anything else is
 * cleaned (cleanTypeCode / cleanTagFields) and an invalid cell is a per-row
 * error — never guessed, never truncated.
 */
import { cleanTypeCode } from "@/lib/design/device-types";
import { cleanTagFields, TAG_LIMITS, type TagFields } from "@/lib/design/conduit-riser/tags";
import { suggestTagDefaults } from "@/lib/design/conduit-riser/suggest-tags";
import { partModel } from "@/lib/catalog-rename/sku";

/** Export and parse agree on these names. */
export const RISER_DEVICE_HEADERS = [
  "Manufacturer",
  "Model",
  "SKU",
  "Description",
  "Device type",
  "Designator code",
  "Box",
  "Face",
  "Mount",
  "Height",
  "P/D",
  "Source",
] as const;

/** The editable columns, in sheet order, and the tag field each writes. */
const EDIT_COLUMNS = [
  { header: "Designator code", key: "code" },
  { header: "Box", key: "box" },
  { header: "Face", key: "face" },
  { header: "Mount", key: "mount" },
  { header: "Height", key: "height" },
  { header: "P/D", key: "pd" },
] as const;
type EditKey = (typeof EDIT_COLUMNS)[number]["key"];
type TagKey = Exclude<EditKey, "code">;
const TAG_KEYS: readonly TagKey[] = ["box", "face", "mount", "height", "pd"];

/** Lighting-scope device types the Devices tab lists. */
export const RISER_LIGHTING_TYPES: readonly string[] = ["control-networking", "dimming-power", "racks-cases"];

export type RiserPartLike = {
  sku: string;
  manufacturer?: string;
  manufacturerModelNumber?: string;
  manufacturerPartNumber?: string;
  desc: string;
  category: string;
  designatorCode?: string;
  tagDefaults?: TagFields;
};

export type RiserSource = "current" | "suggested" | "—";
export type ExportRow = {
  sku: string;
  manufacturer: string;
  model: string;
  desc: string;
  typeKey: string;
  code: string;
  box: string;
  face: string;
  mount: string;
  height: string;
  pd: string;
  source: RiserSource;
};

const text = (v: unknown) => (typeof v === "string" ? v : "");

/** One part's editable cells: the stored value, else the rule's (never replacing a stored value). */
function cellsOf(part: RiserPartLike): { cells: Record<EditKey, string>; had: boolean; filled: boolean } {
  const sug = suggestTagDefaults({ model: partModel(part), desc: part.desc, category: part.category });
  const stored: Record<EditKey, string> = {
    code: text(part.designatorCode),
    box: text(part.tagDefaults?.box),
    face: text(part.tagDefaults?.face),
    mount: text(part.tagDefaults?.mount),
    height: text(part.tagDefaults?.height),
    pd: text(part.tagDefaults?.pd),
  };
  const cells = { ...stored };
  let had = false;
  let filled = false;
  for (const k of Object.keys(stored) as EditKey[]) {
    if (stored[k]) had = true;
    else if (text(sug[k])) {
      cells[k] = text(sug[k]);
      filled = true;
    }
  }
  return { cells, had, filled };
}

/** Devices rows: lighting-control parts, blanks pre-filled by the rules, with a Source. */
export function riserDataRows(parts: readonly RiserPartLike[], typeKeyOf: (p: RiserPartLike) => string | null | undefined): ExportRow[] {
  const out: ExportRow[] = [];
  for (const p of parts) {
    const typeKey = typeKeyOf(p) || "";
    if (!RISER_LIGHTING_TYPES.includes(typeKey)) continue;
    const { cells, had, filled } = cellsOf(p);
    out.push({
      sku: p.sku,
      manufacturer: text(p.manufacturer),
      model: partModel(p),
      desc: p.desc,
      typeKey,
      ...cells,
      source: filled ? "suggested" : had ? "current" : "—",
    });
  }
  return out;
}

/** One export row as cells, in RISER_DEVICE_HEADERS order. */
export function riserDataRowCells(r: ExportRow, typeLabelOf: (key: string) => string = (k) => k): string[] {
  return [r.manufacturer, r.model, r.sku, r.desc, typeLabelOf(r.typeKey), r.code, r.box, r.face, r.mount, r.height, r.pd, r.source];
}

// ---- parse ----

/** undefined = leave, null = clear, string = set. */
export type ParsedRow = {
  /** 1-based sheet row (the header is row 1). */
  row: number;
  sku: string;
  code?: string | null;
  tag: Partial<Record<TagKey, string | null>>;
};
export type ParseResult = {
  rows: ParsedRow[];
  errors: { row: number; message: string }[];
  /** Non-fatal: e.g. a column header that looks like a misspelled editable column (it was ignored). */
  notes: string[];
};

const headerKey = (h: unknown) => String(h ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const cellText = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
/** An editable cell: a literal em dash (the export's "nothing here" mark) reads as blank. */
const editText = (v: unknown) => {
  const t = cellText(v);
  return t === "—" ? "" : t;
};

const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Unrecognized headers (4+ letters, same first letter) that look like a misspelled editable column — "Hieght", "Designator". */
function misspelledHeaderNotes(header: readonly unknown[]): string[] {
  const known = new Set(RISER_DEVICE_HEADERS.map(headerKey));
  const notes: string[] = [];
  for (const raw of header) {
    const shown = String(raw ?? "").trim();
    if (!shown || known.has(headerKey(shown))) continue;
    const n = normHeader(shown);
    if (!n) continue;
    if (n.length < 4) continue; // "ID", "PD": too short to tell a typo from another column
    const hit = EDIT_COLUMNS.find((e) => {
      const c = normHeader(e.header);
      return n[0] === c[0] && (levenshtein(n, c) <= Math.max(1, Math.ceil(c.length / 4)) || c.includes(n));
    });
    if (hit) notes.push(`Column "${shown}" isn't recognized — did you mean "${hit.header}"? It was ignored.`);
  }
  return notes;
}

export const RISER_SHEET_NO_SKU = "The sheet needs a SKU column.";
export const RISER_SHEET_NO_COLUMNS = "The sheet needs at least one of: Designator code, Box, Face, Mount, Height, P/D.";

export function parseRiserDataSheet(grid: readonly (readonly unknown[])[]): ParseResult {
  const rows: ParsedRow[] = [];
  const errors: { row: number; message: string }[] = [];
  const header = grid[0] ?? [];
  const notes = misspelledHeaderNotes(header);
  const col = new Map<string, number>();
  header.forEach((h, i) => {
    const k = headerKey(h);
    if (k && !col.has(k)) col.set(k, i);
  });
  const skuCol = col.get(headerKey("SKU"));
  if (skuCol === undefined) return { rows, errors: [{ row: 1, message: RISER_SHEET_NO_SKU }], notes };
  const edits = EDIT_COLUMNS.filter((e) => col.has(headerKey(e.header)));
  if (!edits.length) return { rows, errors: [{ row: 1, message: RISER_SHEET_NO_COLUMNS }], notes };

  const seen = new Set<string>();
  for (let r = 1; r < grid.length; r++) {
    const raw = grid[r] ?? [];
    const rowNo = r + 1;
    const sku = cellText(raw[skuCol]);
    const values = edits.map((e) => ({ e, v: editText(raw[col.get(headerKey(e.header))!]) }));
    if (!sku && values.every((x) => !x.v)) continue;
    if (!sku) {
      errors.push({ row: rowNo, message: "Missing SKU." });
      continue;
    }
    if (seen.has(sku)) {
      errors.push({ row: rowNo, message: `Duplicate SKU ${sku} — only the first row is used.` });
      continue;
    }
    seen.add(sku);
    const parsed: ParsedRow = { row: rowNo, sku, tag: {} };
    const bad: string[] = [];
    for (const { e, v } of values) {
      if (!v) continue;
      if (v === "-") {
        if (e.key === "code") parsed.code = null;
        else parsed.tag[e.key] = null;
        continue;
      }
      if (e.key === "code") {
        const c = cleanTypeCode(v);
        if (c === null) bad.push(`Designator code "${v}" must be 1–6 letters or digits`);
        else parsed.code = c;
        continue;
      }
      if (e.key === "pd") {
        const c = cleanTagFields({ pd: v })?.pd;
        if (!c) bad.push(`P/D "${v}" must be P, D or P/D`);
        else parsed.tag.pd = c;
        continue;
      }
      const max = TAG_LIMITS[e.key];
      // A bare number in Height (a spreadsheet turns 18" into 18) is inches: store it as 18".
      const cell = e.key === "height" && /^\d+(\.\d+)?$/.test(v) ? `${v}"` : v;
      const clean = cleanTagFields({ [e.key]: cell })?.[e.key];
      if (!clean) bad.push(`${e.header} "${v}" is not valid`);
      else if (cell.replace(/\s+/g, " ").length > max) bad.push(`${e.header} "${v}" is longer than ${max} characters`);
      else parsed.tag[e.key] = clean;
    }
    if (bad.length) errors.push({ row: rowNo, message: bad.join("; ") + "." });
    else rows.push(parsed);
  }
  return { rows, errors, notes };
}

// ---- apply plan ----

export type RiserState = { designatorCode?: string; tagDefaults?: TagFields };
export type RiserChange = {
  /** The part's own (current) SKU — a renamed sheet SKU lands here. */
  sku: string;
  /** Only what changed: a string/object sets, null clears. */
  patch: { designatorCode?: string | null; tagDefaults?: TagFields | null };
  before: RiserState;
  after: RiserState;
};
export type RiserPlan = { changes: RiserChange[]; unknown: string[] };

function stateOf(p: RiserPartLike): RiserState {
  const s: RiserState = {};
  const code = cleanTypeCode(p.designatorCode);
  if (code) s.designatorCode = code;
  const tag = tagOf(p.tagDefaults);
  if (tag) s.tagDefaults = tag;
  return s;
}

/** Non-empty tag fields only; undefined when none. */
function tagOf(t: TagFields | undefined): TagFields | undefined {
  const out: TagFields = {};
  for (const k of TAG_KEYS) {
    const v = t?.[k];
    if (v) (out as Record<string, string>)[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

const sameTag = (a: TagFields | undefined, b: TagFields | undefined) => TAG_KEYS.every((k) => (a?.[k] || "") === (b?.[k] || ""));

/**
 * The changes an Apply would make. `partsBySku` maps each SHEET sku to its
 * resolved part (the caller follows renames); a sku missing from it is
 * `unknown`. A row that changes nothing is dropped.
 */
export function planRiserDataApply(parsed: readonly ParsedRow[], partsBySku: ReadonlyMap<string, RiserPartLike>): RiserPlan {
  const unknown: string[] = [];
  const order: string[] = [];
  const before = new Map<string, RiserState>();
  const after = new Map<string, RiserState>();
  for (const row of parsed) {
    const part = partsBySku.get(row.sku);
    if (!part) {
      if (!unknown.includes(row.sku)) unknown.push(row.sku);
      continue;
    }
    if (!before.has(part.sku)) {
      before.set(part.sku, stateOf(part));
      after.set(part.sku, stateOf(part));
      order.push(part.sku);
    }
    const cur = after.get(part.sku)!;
    const next: RiserState = { ...cur };
    if (row.code === null) delete next.designatorCode;
    else if (row.code !== undefined) next.designatorCode = row.code;
    const tag: TagFields = { ...(cur.tagDefaults || {}) };
    for (const k of TAG_KEYS) {
      const v = row.tag[k];
      if (v === null) delete tag[k];
      else if (v !== undefined) (tag as Record<string, string>)[k] = v;
    }
    const t = tagOf(tag);
    if (t) next.tagDefaults = t;
    else delete next.tagDefaults;
    after.set(part.sku, next);
  }
  const changes: RiserChange[] = [];
  for (const sku of order) {
    const b = before.get(sku)!;
    const a = after.get(sku)!;
    const patch: RiserChange["patch"] = {};
    if ((b.designatorCode || "") !== (a.designatorCode || "")) patch.designatorCode = a.designatorCode ?? null;
    if (!sameTag(b.tagDefaults, a.tagDefaults)) patch.tagDefaults = a.tagDefaults ?? null;
    if (Object.keys(patch).length) changes.push({ sku, patch, before: b, after: a });
  }
  return { changes, unknown };
}
