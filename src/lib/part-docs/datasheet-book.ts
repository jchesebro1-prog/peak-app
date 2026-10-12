import { mfrKey } from "@/lib/catalog-books";
import { partModel } from "@/lib/catalog-rename/sku";

/**
 * #329 — the datasheet book's pure rules: one merged `Datasheets.pdf` per
 * package (a cover + index, then every datasheet A→Z by manufacturer), the
 * index's rows (one per BOM part, a shared datasheet printed once with every
 * part it covers pointing at the same page), and the loose datasheet files'
 * manufacturer-first names. No server imports — the spec harness loads it.
 * The PDF itself is drawn by datasheet-book-server.ts.
 */

export const BOOK_FILE_NAME = "Datasheets.pdf";
export const BOOK_TITLE = "Product Datasheets";
/** A finished book over this is not shipped (the loose files still are). */
export const BOOK_MAX_BYTES = 100 * 1024 * 1024;
/**
 * #329 review — every datasheet ships twice (loose + in the book) and a zip is
 * one in-memory buffer: the loose datasheets plus the book stay under this.
 * Twice the 60 MB datasheet total the estimate zip and the rack submittal
 * already cap their reads at (PACKAGE_ZIP_TOTAL_MAX_BYTES,
 * RACK_DATASHEETS_TOTAL_BYTES).
 */
export const BOOK_ZIP_CEILING_BYTES = 120 * 1024 * 1024;

/** The bytes a book may take next to `looseBytes` of loose datasheets (≤ 0 = skip the book, "package size limit"). */
export function bookByteBudget(looseBytes: number): number {
  return Math.min(BOOK_MAX_BYTES, BOOK_ZIP_CEILING_BYTES - Math.max(0, looseBytes));
}
export const UNKNOWN_MANUFACTURER = "Unknown manufacturer";

/** Customer-facing "Not included" reasons. */
export const BOOK_REASON = {
  noDatasheet: "No datasheet on file",
  notNeeded: "Datasheet not required",
  notCatalog: "Not a catalog part",
  unreadable: "Could not be read",
  missing: "File missing",
  tooBig: "Left out — package size limit",
  late: "Left out — ran out of time",
} as const;

/** One BOM part as the book sees it. */
export type BookPart = {
  sku: string;
  /** Display manufacturer as on the part ("" = unknown). */
  mfr: string;
  /** Printed model (#304 — Model # first, then MFR P/N, then the SKU's model tail); "" = none. */
  model: string;
  desc: string;
  /** The datasheet this part rides on — its own, or the fixture's covering it. */
  docId: string | null;
  /** Fixture SKUs whose datasheet covers this part (#207). */
  coveredBy?: string[];
  /** Why there is no datasheet (docId null). */
  reason?: string;
};

export type SortedBookPart = BookPart & {
  /** Case/punctuation-insensitive manufacturer group (mfrKey); "" = unknown. */
  group: string;
  /** The group's one printed name (so "Etc" and "ETC" print alike). */
  mfrLabel: string;
};

type PartLike = { sku: string; desc?: string; mfr?: string; manufacturerModelNumber?: string; manufacturerPartNumber?: string };
type SkuDocsLike = { datasheet: { documentId: string } | null; datasheetCoveredBy?: string[]; datasheetOk: boolean };

/**
 * A BOM row → its book part. `part` is the catalog row (absent = not a
 * catalog part); `docs` is the row's resolvePackageDocs entry. A covered
 * accessory's `datasheet` IS its fixture's document, so it points at the
 * fixture's page with no extra step.
 */
export function bookPartOf(row: { sku: string; desc: string }, part: PartLike | null | undefined, docs: SkuDocsLike | null | undefined): BookPart {
  if (!part) return { sku: row.sku, mfr: "", model: "", desc: row.desc, docId: null, reason: BOOK_REASON.notCatalog };
  const docId = docs?.datasheet?.documentId ?? null;
  return {
    sku: part.sku,
    mfr: String(part.mfr ?? "").trim(),
    model: partModel({ sku: part.sku, manufacturerModelNumber: part.manufacturerModelNumber, manufacturerPartNumber: part.manufacturerPartNumber }),
    desc: part.desc || row.desc,
    docId,
    ...(docs?.datasheetCoveredBy?.length ? { coveredBy: [...docs.datasheetCoveredBy] } : {}),
    ...(docId ? {} : { reason: docs?.datasheetOk ? BOOK_REASON.notNeeded : BOOK_REASON.noDatasheet }),
  };
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const cmp = (a: string, b: string) => collator.compare(a, b);
const raw = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Each manufacturer group's printed name: its most common spelling, ties to the smallest (so "ETC" beats "Etc"). */
function groupLabels(parts: readonly BookPart[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const p of parts) {
    const g = mfrKey(p.mfr);
    if (!g) continue;
    let m = counts.get(g);
    if (!m) counts.set(g, (m = new Map()));
    m.set(p.mfr, (m.get(p.mfr) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const [g, m] of counts) {
    const best = [...m.entries()].sort((a, b) => b[1] - a[1] || raw(a[0], b[0]))[0][0];
    out.set(g, best);
  }
  return out;
}

/**
 * Manufacturer A→Z (case- and punctuation-insensitive; a blank manufacturer
 * sorts LAST as "Unknown manufacturer"), then model (numeric-aware: "S4 2" <
 * "S4 10"), then SKU. Pure, stable, total.
 */
export function sortPartsForBook(parts: readonly BookPart[]): SortedBookPart[] {
  const labels = groupLabels(parts);
  const rows: SortedBookPart[] = parts.map((p) => {
    const group = mfrKey(p.mfr);
    return { ...p, group, mfrLabel: group ? labels.get(group)! : UNKNOWN_MANUFACTURER };
  });
  return rows.sort((a, b) => {
    if (!a.group !== !b.group) return a.group ? -1 : 1;
    return (
      cmp(a.mfrLabel, b.mfrLabel) || raw(a.group, b.group) ||
      cmp(a.model || a.sku, b.model || b.sku) || cmp(a.sku, b.sku) || raw(a.sku, b.sku) || cmp(a.desc, b.desc)
    );
  });
}

export type BookPlan = {
  parts: SortedBookPart[];
  /** Each datasheet ONCE, at its owner's place in book order (the owner: see docMfr). */
  docOrder: string[];
  /**
   * A document's manufacturer — its OWNER's printed manufacturer ("" when
   * unknown): the first part (book order) the document is linked to directly
   * (no `coveredBy`), so a fixture sheet that also covers another maker's
   * accessory keeps the fixture maker's name; else the first part it serves.
   */
  docMfr: Map<string, string>;
};

export function planDatasheetBook(parts: readonly BookPart[]): BookPlan {
  const sorted = sortPartsForBook(parts);
  const owner = new Map<string, { at: number; part: SortedBookPart; direct: boolean }>();
  sorted.forEach((p, at) => {
    if (!p.docId) return;
    const direct = !p.coveredBy?.length;
    const cur = owner.get(p.docId);
    if (!cur || (direct && !cur.direct)) owner.set(p.docId, { at, part: p, direct });
  });
  const ranked = [...owner.entries()].sort((a, b) => a[1].at - b[1].at);
  const docMfr = new Map(ranked.map(([id, o]) => [id, o.part.group ? o.part.mfrLabel : ""] as const));
  return { parts: sorted, docOrder: ranked.map(([id]) => id), docMfr };
}

export type BookIndexRow = {
  sku: string;
  mfr: string;
  model: string;
  desc: string;
  /** The page this part's datasheet starts on (1-based, the cover counts); null = not included. */
  page: number | null;
  reason?: string;
  /** First row of a manufacturer group within its section. */
  groupStart: boolean;
};

export type BookIndex = {
  included: BookIndexRow[];
  notIncluded: BookIndexRow[];
  /** Document id → the page it starts on. */
  startPage: Map<string, number>;
  /** Datasheets actually in the book. */
  datasheets: number;
  totalPages: number;
};

/**
 * The index for a plan once the documents are merged: `pages` holds each
 * merged document's page count (absent / 0 = not in the book, with
 * `docReason` saying why). Page numbers count the `frontPages` (cover +
 * index) first. Parts sharing a document all point at its one start page.
 */
export function bookIndex(
  plan: BookPlan,
  pages: ReadonlyMap<string, number>,
  docReason: ReadonlyMap<string, string>,
  frontPages: number,
): BookIndex {
  const startPage = new Map<string, number>();
  let page = frontPages + 1;
  for (const id of plan.docOrder) {
    const n = pages.get(id) ?? 0;
    if (n <= 0) continue;
    startPage.set(id, page);
    page += n;
  }
  const included: BookIndexRow[] = [];
  const notIncluded: BookIndexRow[] = [];
  for (const p of plan.parts) {
    const start = p.docId ? startPage.get(p.docId) : undefined;
    const base = { sku: p.sku, mfr: p.mfrLabel, model: p.model, desc: p.desc };
    if (start !== undefined) {
      included.push({ ...base, page: start, groupStart: !included.length || included[included.length - 1].mfr !== p.mfrLabel });
    } else {
      const reason = p.docId ? docReason.get(p.docId) ?? BOOK_REASON.unreadable : p.reason ?? BOOK_REASON.noDatasheet;
      notIncluded.push({ ...base, page: null, reason, groupStart: !notIncluded.length || notIncluded[notIncluded.length - 1].mfr !== p.mfrLabel });
    }
  }
  return { included, notIncluded, startPage, datasheets: startPage.size, totalPages: page - 1 };
}

/** The index as plain lines (`Mfr — Model — Description — page N` / `… — reason`) — what the cover prints, for tests and logs. */
export function bookIndexLines(index: BookIndex): string[] {
  const line = (r: BookIndexRow) => [r.mfr, r.model || "—", r.desc, r.page !== null ? `page ${r.page}` : r.reason ?? ""].join(" — ");
  return [
    "Included",
    ...(index.included.length ? index.included.map(line) : ["None."]),
    "",
    "Not included",
    ...(index.notIncluded.length ? index.notIncluded.map(line) : ["None."]),
  ];
}

/** "12 parts · 8 datasheets · 64 pages". */
export function bookSummary(parts: number, datasheets: number, pages: number): string {
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  return `${n(parts, "part")} · ${n(datasheets, "datasheet")} · ${n(pages, "page")}`;
}

const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "long", day: "numeric" });
/** The cover's date, America/Chicago ("October 12, 2026"). */
export function bookDate(ms: number): string {
  return dateFmt.format(new Date(ms));
}

/* ---------- loose datasheet file names ---------- */

/** A zip entry segment: no path separators or reserved/control characters, spaces kept, ≤ 140 chars (extension kept). */
export function zipEntrySafe(name: string): string {
  let s = String(name ?? "").replace(/[/\\:*?"<>|\u0000-\u001f\u007f]+/g, "_").replace(/\s+/g, " ").trim().replace(/^[.\s]+/, "");
  if (s.length > 140) {
    const ext = /\.[A-Za-z0-9]{1,5}$/.exec(s)?.[0] ?? "";
    s = s.slice(0, 140 - ext.length).trimEnd() + ext;
  }
  return s || "file";
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * "ETC" + "ColorSource Spot.pdf" → "ETC - ColorSource Spot.pdf", so the loose
 * datasheets/ folder sorts by manufacturer. A file name that already starts
 * with the manufacturer isn't doubled ("ETC_S4.pdf" → "ETC - S4.pdf"); a
 * blank manufacturer keeps the file's own name.
 */
export function datasheetLooseName(mfr: string, fileName: string): string {
  const m = zipEntrySafe(mfr).replace(/^file$/, "");
  const f = zipEntrySafe(fileName);
  if (!String(mfr ?? "").trim() || !m) return f;
  const ext = /\.[A-Za-z0-9]{1,5}$/.exec(f)?.[0] ?? "";
  const base = f.slice(0, f.length - ext.length);
  const lead = new RegExp(`^${m.split(/[\s_-]+/).map(escapeRe).join("[\\s_-]*")}(?:[\\s_.\\-–—]+|$)`, "i");
  const rest = base.replace(lead, "").trim();
  return zipEntrySafe(`${m} - ${rest || base}${ext}`);
}
