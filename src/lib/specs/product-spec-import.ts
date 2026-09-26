import { hasPrintableSpec } from "@/lib/specs/articles";

/**
 * Product spec import (#205) — loads the filled North HS product-specs
 * template (scripts/specs-seed-northhs.py) back into the catalog: every row
 * carries a Spec ID, an Article ID and the MFR #(s) Jeff typed; each MFR #
 * resolves to catalog parts and the row's spec text lands on them.
 *
 * Pure: header detection, MFR # matching and the write plan run here over
 * plain rows and part records, so the preview and the import compute the
 * same plan and the rules are testable without a database. Reading the file
 * (exceljs) and writing the parts live in product-spec-io.ts (server-only).
 *
 * It never creates a part: an MFR # that matches nothing is reported, not
 * invented.
 */

/** specSource of every part this import writes: "product-specs:<Spec ID>".
 *  A part whose text came from here is re-writable without the
 *  "Replace existing" checkbox — re-importing a corrected file must work. */
export const PRODUCT_SPEC_SOURCE_PREFIX = "product-specs:";

/** One worksheet as a grid of cell text. `rows[i]` is sheet row i+1. */
export type SpecSheet = { name: string; rows: string[][] };

/** One data row of a qualifying sheet. */
export type ProductSpecRow = {
  sheet: string;
  /** 1-based row number in the sheet (CSV: in the non-empty rows). */
  line: number;
  specId: string;
  /** The raw MFR # cell. */
  mfr: string;
  manufacturer: string;
  /** Spec Title, else Description. */
  title: string;
  /** Spec Text, else Description — outline text, leading spaces kept. */
  text: string;
  articleId: string;
};

/** The subset of a catalog part the import reads. CatalogPart fits it. */
export type ProductSpecPartLike = {
  sku: string;
  desc?: string;
  mfr?: string;
  manufacturerPartNumber?: string;
  manufacturerModelNumber?: string;
  specArticleId?: string;
  specSectionId?: string;
  specTitle?: string;
  specBody?: string;
  specSameAs?: string;
  specState?: "authored" | "draft";
  specSource?: string;
};

export type ProductSpecArticleLike = { id: string; sectionId: string };

/* ---------------- Reading the sheets ---------------- */

/** "MFR #", "mfr#" and "Mfr" are one header. */
export function normalizeHeader(h: string): string {
  return String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const COLUMN_ALIASES = {
  specId: ["specid"],
  mfr: ["mfr", "mfrnumber", "mfrno", "manufacturerpartnumber"],
  manufacturer: ["manufacturer"],
  title: ["spectitle"],
  text: ["spectext"],
  description: ["description"],
  articleId: ["articleid"],
} as const;

type ColumnKey = keyof typeof COLUMN_ALIASES;

function columnIndexes(header: string[]): Partial<Record<ColumnKey, number>> {
  const norm = header.map(normalizeHeader);
  const out: Partial<Record<ColumnKey, number>> = {};
  for (const key of Object.keys(COLUMN_ALIASES) as ColumnKey[]) {
    const i = norm.findIndex((h) => (COLUMN_ALIASES[key] as readonly string[]).includes(h));
    if (i >= 0) out[key] = i;
  }
  return out;
}

/** Outline text: CRLF → LF, trailing whitespace off each line, blank lines
 *  off both ends. Leading spaces stay — they are the outline levels. */
export function cleanSpecText(s: string): string {
  const lines = String(s || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join("\n");
}

function oneLine(s: string): string {
  return String(s || "").replace(/\s+/g, " ").trim();
}

/**
 * Every sheet whose header row (its first non-empty row) has both a Spec ID
 * and an MFR # column → its data rows. Other sheets (the Instructions tab)
 * are skipped. Fully empty rows are dropped here, before any counting.
 */
export function readProductSpecRows(
  sheets: SpecSheet[]
): { rows: ProductSpecRow[]; sheetsRead: string[]; error?: string } {
  const rows: ProductSpecRow[] = [];
  const sheetsRead: string[] = [];
  for (const sheet of sheets) {
    const headerAt = sheet.rows.findIndex((r) => (r || []).some((c) => String(c || "").trim() !== ""));
    if (headerAt < 0) continue;
    const col = columnIndexes(sheet.rows[headerAt]);
    if (col.specId == null || col.mfr == null) continue;
    sheetsRead.push(sheet.name);
    const cell = (r: string[], key: ColumnKey) => {
      const i = col[key];
      return i == null ? "" : String(r[i] ?? "");
    };
    for (let i = headerAt + 1; i < sheet.rows.length; i++) {
      const r = sheet.rows[i] || [];
      if (!r.some((c) => String(c || "").trim() !== "")) continue;
      const description = cell(r, "description");
      rows.push({
        sheet: sheet.name,
        line: i + 1,
        specId: oneLine(cell(r, "specId")),
        mfr: cell(r, "mfr").trim(),
        manufacturer: oneLine(cell(r, "manufacturer")),
        title: oneLine(cell(r, "title")) || oneLine(description),
        text: cleanSpecText(cell(r, "text")) || cleanSpecText(description),
        articleId: oneLine(cell(r, "articleId")),
      });
    }
  }
  if (!sheetsRead.length) {
    return { rows, sheetsRead, error: "No sheet in that file has both a Spec ID and an MFR # column." };
  }
  return { rows, sheetsRead };
}

/** MFR # cell → tokens: split on commas, semicolons and newlines; trimmed;
 *  empties dropped; de-duplicated case-insensitively, first spelling kept. */
export function splitMfrTokens(cell: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of String(cell || "").split(/[,;\r\n]+/)) {
    const t = raw.trim();
    if (!t) continue;
    const k = t.toUpperCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/* ---------------- Matching ---------------- */

/** Trimmed, uppercased, internal whitespace collapsed. */
export function exactKey(s: string): string {
  return String(s || "").trim().replace(/\s+/g, " ").toUpperCase();
}

/** Uppercase alphanumerics only — "7460-A1011" = "7460A1011". */
export function looseKey(s: string): string {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function skuPrefix(sku: string): string {
  const i = sku.indexOf(":");
  return i > 0 ? sku.slice(0, i) : "";
}

function skuTail(sku: string): string {
  const i = sku.indexOf(":");
  return i >= 0 ? sku.slice(i + 1) : "";
}

export type ProductSpecIndex<P extends ProductSpecPartLike = ProductSpecPartLike> = {
  bySku: Map<string, P>;
  exact: Map<string, string[]>;
  loose: Map<string, string[]>;
};

/** Every part under its SKU, SKU tail (after the first ":"), manufacturer
 *  part number and model number — exact and loose. */
export function indexParts<P extends ProductSpecPartLike>(parts: P[]): ProductSpecIndex<P> {
  const bySku = new Map<string, P>();
  const exact = new Map<string, string[]>();
  const loose = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, sku: string) => {
    if (!key) return;
    const list = map.get(key);
    if (!list) map.set(key, [sku]);
    else if (!list.includes(sku)) list.push(sku);
  };
  for (const p of parts) {
    if (!p || !p.sku) continue;
    bySku.set(p.sku, p);
    for (const v of [p.sku, skuTail(p.sku), p.manufacturerPartNumber, p.manufacturerModelNumber]) {
      if (!v) continue;
      add(exact, exactKey(v), p.sku);
      add(loose, looseKey(v), p.sku);
    }
  }
  return { bySku, exact, loose };
}

/** Either loose string contains the other; false when either side is empty. */
function looselySame(a: string, b: string): boolean {
  const x = looseKey(a);
  const y = looseKey(b);
  return !!x && !!y && (x.includes(y) || y.includes(x));
}

function partMatchesMfr(p: ProductSpecPartLike, manufacturer: string): boolean {
  return looselySame(p.mfr || "", manufacturer) || looselySame(skuPrefix(p.sku), manufacturer);
}

export type TokenMatch =
  | { status: "matched"; sku: string; loose: boolean; mfrWarning?: string }
  | { status: "ambiguous"; candidates: string[]; total: number; loose: boolean }
  | { status: "not-found" };

const MAX_CANDIDATES = 5;

/** One MFR # → a part. Exact key first; the loose key only when exact finds
 *  nothing. Several hits narrow by the row's manufacturer. */
export function matchToken<P extends ProductSpecPartLike>(
  token: string,
  manufacturer: string,
  index: ProductSpecIndex<P>
): TokenMatch {
  let skus = index.exact.get(exactKey(token)) || [];
  let loose = false;
  if (!skus.length) {
    skus = index.loose.get(looseKey(token)) || [];
    loose = skus.length > 0;
  }
  if (!skus.length) return { status: "not-found" };
  let pick = skus;
  if (skus.length > 1 && manufacturer) {
    const narrowed = skus.filter((s) => partMatchesMfr(index.bySku.get(s)!, manufacturer));
    if (narrowed.length) pick = narrowed;
  }
  if (pick.length > 1) {
    const sorted = [...pick].sort();
    return { status: "ambiguous", candidates: sorted.slice(0, MAX_CANDIDATES), total: sorted.length, loose };
  }
  const part = index.bySku.get(pick[0])!;
  const partMfr = (part.mfr || "").trim() || skuPrefix(part.sku);
  const mfrWarning =
    manufacturer && partMfr && !partMatchesMfr(part, manufacturer)
      ? `The row says ${manufacturer}; this part is ${partMfr}.`
      : undefined;
  return { status: "matched", sku: part.sku, loose, ...(mfrWarning ? { mfrWarning } : {}) };
}

/* ---------------- The plan ---------------- */

/** The spec fields one part gets. The holder's `specSameAs` key is PRESENT
 *  and undefined (mergeUpsert's present-key rule clears a stale pointer); a
 *  same-as part carries no `specBody` key at all, so its stored body is left
 *  alone (the writePartSpecFieldsAction rule). Stamps are added on write. */
export type ProductSpecPatch = {
  specArticleId: string;
  specSectionId: string;
  specTitle: string | undefined;
  specBody?: string | undefined;
  specSameAs: string | undefined;
  specState: "authored";
  specSource: string;
};

export type PartRole = "holder" | "same-as";
export type PartAction = "write" | "unchanged" | "skip-existing";

export type TokenResult =
  | {
      token: string;
      status: "matched";
      sku: string;
      desc: string;
      loose: boolean;
      mfrWarning?: string;
      /** Absent when no part in the row can hold the text. */
      role?: PartRole;
      action: PartAction;
    }
  | { token: string; status: "ambiguous"; candidates: string[]; total: number; loose: boolean }
  | { token: string; status: "not-found" }
  | { token: string; status: "claimed"; sku: string; bySpecId: string };

export type RowStatus = "blank" | "error" | "ready" | "unmatched";

export type PlanRow = {
  sheet: string;
  line: number;
  specId: string;
  title: string;
  mfr: string;
  manufacturer: string;
  articleId: string;
  status: RowStatus;
  error?: string;
  tokens: TokenResult[];
  holderSku?: string;
};

export type PartWrite = { sku: string; role: PartRole; specId: string; patch: ProductSpecPatch };

export type ProductSpecCounts = {
  readyRows: number;
  partsToWrite: number;
  sameAsLinks: number;
  unchanged: number;
  skippedExisting: number;
  notFound: number;
  ambiguous: number;
  claimed: number;
  blankRows: number;
  errorRows: number;
};

export type ProductSpecPlan = { rows: PlanRow[]; writes: PartWrite[]; counts: ProductSpecCounts };

/** A part with text this import must not overwrite: printable text or a
 *  same-as pointer from somewhere else, and the checkbox is off. A draft
 *  body is not printable, so it is replaced freely. */
export function isProtectedSpec(p: ProductSpecPartLike, replaceExisting: boolean): boolean {
  if (replaceExisting) return false;
  if ((p.specSource || "").startsWith(PRODUCT_SPEC_SOURCE_PREFIX)) return false;
  return hasPrintableSpec(p) || !!(p.specSameAs || "").trim();
}

export function productSpecPatch(
  role: PartRole,
  row: { specId: string; title: string; text: string },
  article: ProductSpecArticleLike,
  holderSku?: string
): ProductSpecPatch {
  const base = {
    specArticleId: article.id,
    specSectionId: article.sectionId,
    specTitle: row.title || undefined,
    specState: "authored" as const,
    specSource: PRODUCT_SPEC_SOURCE_PREFIX + row.specId,
  };
  if (role === "holder") return { ...base, specBody: row.text || undefined, specSameAs: undefined };
  return { ...base, specSameAs: holderSku };
}

const blankish = (v: unknown) => (v == null || v === "" ? undefined : v);

/** Every field the patch would write already equals the stored value. */
export function patchUnchanged(p: ProductSpecPartLike, patch: ProductSpecPatch): boolean {
  const stored = p as Record<string, unknown>;
  return (Object.keys(patch) as Array<keyof ProductSpecPatch>).every(
    (k) => blankish(stored[k]) === blankish(patch[k])
  );
}

export function planProductSpecImport<P extends ProductSpecPartLike>(input: {
  rows: ProductSpecRow[];
  parts: P[];
  articles: ProductSpecArticleLike[];
  replaceExisting: boolean;
}): ProductSpecPlan {
  const index = indexParts(input.parts);
  const articleById = new Map(input.articles.map((a) => [a.id, a]));
  const claimedBy = new Map<string, string>(); // sku → Spec ID that matched it first
  const seenSpecIds = new Set<string>();
  const rows: PlanRow[] = [];
  const writes: PartWrite[] = [];
  const counts: ProductSpecCounts = {
    readyRows: 0,
    partsToWrite: 0,
    sameAsLinks: 0,
    unchanged: 0,
    skippedExisting: 0,
    notFound: 0,
    ambiguous: 0,
    claimed: 0,
    blankRows: 0,
    errorRows: 0,
  };

  for (const r of input.rows) {
    const out: PlanRow = {
      sheet: r.sheet,
      line: r.line,
      specId: r.specId,
      title: r.title,
      mfr: r.mfr,
      manufacturer: r.manufacturer,
      articleId: r.articleId,
      status: "ready",
      tokens: [],
    };
    rows.push(out);
    const tokens = splitMfrTokens(r.mfr);
    if (!tokens.length) {
      out.status = "blank";
      counts.blankRows++;
      continue;
    }
    const fail = (error: string) => {
      out.status = "error";
      out.error = error;
      counts.errorRows++;
    };
    if (!r.specId) {
      fail("This row has no Spec ID.");
      continue;
    }
    // Only rows with an MFR # take part — a skipped blank row never makes a
    // later filled copy of itself a "duplicate".
    const idKey = r.specId.toUpperCase();
    if (seenSpecIds.has(idKey)) {
      fail(`Spec ID ${r.specId} appears earlier in the file — only the first row is imported.`);
      continue;
    }
    seenSpecIds.add(idKey);
    if (!r.text && !r.title) {
      fail("This row has no Spec Text, Spec Title or Description.");
      continue;
    }
    if (!r.articleId) {
      fail("This row has no Article ID — it ties the spec to its place in the library.");
      continue;
    }
    const article = articleById.get(r.articleId);
    if (!article) {
      fail(`Import the spec library first — article ${r.articleId} is not in this library.`);
      continue;
    }

    // Resolve every token; keep the parts this row wins, in order.
    const matched: Array<{ result: Extract<TokenResult, { status: "matched" }>; part: P }> = [];
    for (const token of tokens) {
      const m = matchToken(token, r.manufacturer, index);
      if (m.status === "not-found") {
        out.tokens.push({ token, status: "not-found" });
        counts.notFound++;
      } else if (m.status === "ambiguous") {
        out.tokens.push({ token, ...m });
        counts.ambiguous++;
      } else {
        const by = claimedBy.get(m.sku);
        if (by != null) {
          out.tokens.push({ token, status: "claimed", sku: m.sku, bySpecId: by });
          counts.claimed++;
          continue;
        }
        claimedBy.set(m.sku, r.specId);
        const part = index.bySku.get(m.sku)!;
        const result: Extract<TokenResult, { status: "matched" }> = {
          token,
          status: "matched",
          sku: m.sku,
          desc: part.desc || "",
          loose: m.loose,
          ...(m.mfrWarning ? { mfrWarning: m.mfrWarning } : {}),
          action: "skip-existing",
        };
        out.tokens.push(result);
        matched.push({ result, part });
      }
    }
    if (!matched.length) {
      out.status = "unmatched";
      continue;
    }
    counts.readyRows++;

    // The holder gets the text; the rest point at it. A same-as must never
    // point at a part without its own text: a protected first match only
    // stays holder when it prints its own text; otherwise the next writable
    // match is promoted.
    const prot = matched.map((m) => isProtectedSpec(m.part, input.replaceExisting));
    const first = matched[0].part;
    const holderIdx =
      !prot[0] || (hasPrintableSpec(first) && !(first.specSameAs || "").trim()) ? 0 : prot.findIndex((x) => !x);
    const holderSku = holderIdx >= 0 ? matched[holderIdx].part.sku : undefined;
    if (holderSku) out.holderSku = holderSku;

    matched.forEach(({ result, part }, i) => {
      if (holderIdx >= 0) result.role = i === holderIdx ? "holder" : "same-as";
      if (prot[i]) {
        result.action = "skip-existing";
        counts.skippedExisting++;
        return;
      }
      // holderIdx >= 0 here: an unprotected match exists, so one was chosen.
      const role: PartRole = i === holderIdx ? "holder" : "same-as";
      const patch = productSpecPatch(role, r, article, holderSku);
      if (patchUnchanged(part, patch)) {
        result.action = "unchanged";
        counts.unchanged++;
        return;
      }
      result.action = "write";
      writes.push({ sku: part.sku, role, specId: r.specId, patch });
      counts.partsToWrite++;
      if (role === "same-as") counts.sameAsLinks++;
    });
  }

  return { rows, writes, counts };
}
