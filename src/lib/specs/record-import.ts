/**
 * Spec Library import planner (#205 follow-on, spec 2026-09-28-spec-records-
 * design.md §2) — pure. Reads the JSON export or the `Spec Library` sheet of
 * Jeff's workbook into `SpecRecord`s, and plans an upsert-keyed-on-`specId`
 * import against whatever is already live, without ever touching the
 * database. `record-io.ts` (server-only) reads/writes the actual .xlsx
 * bytes and commits a plan through the store.
 *
 * Pure on purpose — this is what lets the CLI, the Spec Library screen's
 * Import .xlsx preview, and the test suite all run the identical planner.
 */

import { csiKey } from "@/lib/specs/articles";
import {
  KIND_LABELS,
  kindFromLabel,
  normalizeSpecRecord,
  sameSpecContent,
  statusFromLabel,
  validateSpecRecord,
  type RecordProblem,
  type SpecRecord,
} from "@/lib/specs/records";

export const LIBRARY_SHEET = "Spec Library";

export const LIBRARY_HEADERS = [
  "Spec ID",
  "Spec Kind",
  "Spec Type (match key)",
  "Section",
  "Article",
  "Spec Title",
  "Basis of Design",
  "Manufacturer",
  "MFR #",
  "Status",
  "Your action",
  "Spec Text",
  "Notes",
  "Article ID (source)",
  "Include with (companion)",
] as const;

export type ParsedRecords = { records: SpecRecord[]; problems: RecordProblem[] };

/** The four v1 sections (spec §1.3), keyed by CSI number, titled for the
 *  importer to create on demand — the only sections a missing-section
 *  problem is ever non-blocking for. */
export const V1_SECTION_TITLES: Record<string, string> = {
  "11 61 13": "Acoustic Shell Enclosure",
  "11 61 14": "Orchestra Pit Filler",
  "11 61 23": "Theatrical Rigging and Curtains",
  "26 09 61": "Theatrical Lighting Controls and Fixtures",
};

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function normalizePartNumber(s: string): string {
  return str(s).trim().toUpperCase().replace(/\s+/g, " ");
}

/** `{ records: [...] }` or a bare array — the JSON already carries exact
 *  enum values for `kind`/`status` (spec §2), so this is a thin normalize +
 *  problem-collect pass. A record `normalizeSpecRecord` refuses (empty
 *  `specId`, unknown `kind`) becomes a blocking problem, not a crash. */
export function recordsFromJson(json: unknown): ParsedRecords {
  const arr: unknown[] = Array.isArray(json)
    ? json
    : json && typeof json === "object" && Array.isArray((json as { records?: unknown }).records)
      ? ((json as { records: unknown[] }).records)
      : [];

  const records: SpecRecord[] = [];
  const problems: RecordProblem[] = [];
  arr.forEach((raw, i) => {
    const rec = normalizeSpecRecord(raw);
    if (!rec) {
      const specId = raw && typeof raw === "object" && typeof (raw as { specId?: unknown }).specId === "string"
        ? (raw as { specId: string }).specId
        : `(item ${i + 1})`;
      problems.push({ specId, field: "specId", message: "Record could not be read — check specId and kind.", blocking: true });
      return;
    }
    records.push(rec);
  });
  return { records, problems };
}

/** The `Spec Library` sheet's rows (row 0 = exact headers, any column
 *  order). A row whose `Spec Kind` label doesn't map is a blocking problem
 *  and the row is skipped, not defaulted. Fully blank rows are skipped
 *  silently. */
export function recordsFromSheetRows(rows: string[][]): ParsedRecords {
  const records: SpecRecord[] = [];
  const problems: RecordProblem[] = [];
  if (!rows.length) return { records, problems };

  const header = rows[0] ?? [];
  const col = (name: string): number => header.indexOf(name);
  const idx = {
    specId: col("Spec ID"),
    kind: col("Spec Kind"),
    matchKey: col("Spec Type (match key)"),
    section: col("Section"),
    article: col("Article"),
    title: col("Spec Title"),
    basisOfDesign: col("Basis of Design"),
    manufacturer: col("Manufacturer"),
    mfrNumbers: col("MFR #"),
    status: col("Status"),
    specText: col("Spec Text"),
    notes: col("Notes"),
    sourceArticleId: col("Article ID (source)"),
    includeWith: col("Include with (companion)"),
  };
  const cell = (row: string[], i: number): string => (i >= 0 ? str(row[i]) : "");

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((c) => !str(c).trim())) continue; // fully blank row

    const specId = cell(row, idx.specId).trim();
    const kindLabel = cell(row, idx.kind);
    const kind = kindFromLabel(kindLabel);
    if (!kind) {
      problems.push({
        specId: specId || `(row ${r + 1})`,
        field: "kind",
        message: `"${kindLabel}" is not a known spec kind.`,
        blocking: true,
      });
      continue;
    }

    const rec = normalizeSpecRecord({
      specId,
      kind,
      status: statusFromLabel(cell(row, idx.status)),
      section: cell(row, idx.section),
      article: cell(row, idx.article),
      title: cell(row, idx.title),
      basisOfDesign: cell(row, idx.basisOfDesign),
      manufacturer: cell(row, idx.manufacturer),
      mfrNumbers: cell(row, idx.mfrNumbers),
      matchKey: cell(row, idx.matchKey),
      includeWith: cell(row, idx.includeWith),
      specText: cell(row, idx.specText),
      notes: cell(row, idx.notes),
      sourceArticleId: cell(row, idx.sourceArticleId),
    });
    if (!rec) {
      problems.push({
        specId: specId || `(row ${r + 1})`,
        field: "specId",
        message: "Row could not be read as a spec record.",
        blocking: true,
      });
      continue;
    }
    records.push(rec);
  }
  return { records, problems };
}

/** `LIBRARY_HEADERS` order. `Your action` is always blank on export; lists
 *  join with real newlines; `kind`/`status` render as their workbook
 *  labels. The inverse of `recordsFromSheetRows` for a record that came
 *  from one — export → import of an unchanged file is 0 changes. */
export function recordToSheetRow(r: SpecRecord): string[] {
  const statusLabel = r.status === "ready" ? "Ready" : r.status === "archived" ? "Archived" : "Draft";
  const byHeader: Record<(typeof LIBRARY_HEADERS)[number], string> = {
    "Spec ID": r.specId,
    "Spec Kind": KIND_LABELS[r.kind],
    "Spec Type (match key)": r.matchKey ?? "",
    Section: r.section,
    Article: r.article,
    "Spec Title": r.title,
    "Basis of Design": r.basisOfDesign ?? "",
    Manufacturer: r.manufacturer ?? "",
    "MFR #": r.mfrNumbers.join("\n"),
    Status: statusLabel,
    "Your action": "",
    "Spec Text": r.specText,
    Notes: r.notes ?? "",
    "Article ID (source)": r.sourceArticleId ?? "",
    "Include with (companion)": r.includeWith.join("\n"),
  };
  return LIBRARY_HEADERS.map((h) => byHeader[h]);
}

export type ImportPlanItem = { specId: string; action: "create" | "update" | "unchanged"; record: SpecRecord };

export type ImportPlan = {
  items: ImportPlanItem[];
  counts: { created: number; updated: number; unchanged: number; archived: number };
  problems: RecordProblem[];
  blocking: boolean;
  missingSections: string[];
};

export type ImportPlanCtx = {
  existing: SpecRecord[];
  sections: Array<{ id: string; number: string }>;
  articles: Array<{ id: string; sectionId: string }>;
};

/** Plans an upsert-keyed-on-`specId` import (spec §2). Records absent from
 *  the file are left entirely alone — they're only consulted for the
 *  duplicate-part-number check against the merged (existing overlaid by
 *  file) set of `ready` records. */
export function planSpecRecordImport(parsed: ParsedRecords, ctx: ImportPlanCtx): ImportPlan {
  const problems: RecordProblem[] = [...parsed.problems];
  const fileRecords = parsed.records;

  // Duplicate Spec ID within the file — blocking.
  const idCounts = new Map<string, number>();
  for (const r of fileRecords) idCounts.set(r.specId, (idCounts.get(r.specId) ?? 0) + 1);
  for (const [id, count] of idCounts) {
    if (count > 1) {
      problems.push({ specId: id, field: "specId", message: `"${id}" appears ${count} times in the file.`, blocking: true });
    }
  }

  // Missing sections: CSI numbers the file uses that no live section
  // resolves to. Creatable (a v1 starter) → listed, not blocking (the
  // commit step creates it). Anything else → blocking.
  const liveSectionKeys = new Set(ctx.sections.map((s) => csiKey(s.number)));
  const usedByKey = new Map<string, string>();
  for (const r of fileRecords) {
    const key = csiKey(r.section);
    if (key && !usedByKey.has(key)) usedByKey.set(key, r.section);
  }
  const missingSections: string[] = [];
  const syntheticSections: Array<{ id: string; number: string }> = [];
  for (const [key, number] of usedByKey) {
    if (liveSectionKeys.has(key)) continue;
    missingSections.push(number);
    const creatable = Object.keys(V1_SECTION_TITLES).some((n) => csiKey(n) === key);
    if (creatable) {
      // A to-be-created section has no articles yet — this synthetic id
      // never matches any real article's sectionId, so a `ready` record
      // pointing here is correctly blocked below as "no source article".
      syntheticSections.push({ id: `__pending-section__${key}`, number });
    } else {
      problems.push({
        specId: "",
        field: "section",
        message: `Section "${number}" does not exist and is not a v1 starter section.`,
        blocking: true,
      });
    }
  }
  const sectionsForValidation = [...ctx.sections, ...syntheticSections];

  const existingById = new Map(ctx.existing.map((r) => [r.specId, r] as const));
  const specIds = new Set<string>([...existingById.keys(), ...fileRecords.map((r) => r.specId)]);

  for (const r of fileRecords) {
    problems.push(...validateSpecRecord(r, { sections: sectionsForValidation, articles: ctx.articles, specIds }));
  }

  // Duplicate part number across two different `ready` records of the
  // merged set (existing overlaid by file).
  const merged = new Map<string, SpecRecord>(existingById);
  for (const r of fileRecords) merged.set(r.specId, r);
  const ownerByNumber = new Map<string, string>();
  for (const r of merged.values()) {
    if (r.status !== "ready") continue;
    for (const num of r.mfrNumbers) {
      const norm = normalizePartNumber(num);
      if (!norm) continue;
      const owner = ownerByNumber.get(norm);
      if (owner && owner !== r.specId) {
        problems.push({
          specId: r.specId,
          field: "mfrNumbers",
          message: `Part number "${num}" is used by both ${owner} and ${r.specId}.`,
          blocking: true,
        });
      } else {
        ownerByNumber.set(norm, r.specId);
      }
    }
  }

  const items: ImportPlanItem[] = [];
  const counts = { created: 0, updated: 0, unchanged: 0, archived: 0 };
  for (const r of fileRecords) {
    if (r.status === "archived") counts.archived++;
    const existingRec = existingById.get(r.specId);
    let action: ImportPlanItem["action"];
    if (!existingRec) {
      action = "create";
      counts.created++;
    } else if (sameSpecContent(existingRec, r)) {
      action = "unchanged";
      counts.unchanged++;
    } else {
      action = "update";
      counts.updated++;
    }
    items.push({ specId: r.specId, action, record: r });
  }

  return {
    items,
    counts,
    problems,
    blocking: problems.some((p) => p.blocking),
    missingSections,
  };
}

/* ---- Spec Library screen's Import .xlsx (design §2, §7) ---- */

/** 5 MB — the Spec Library import's own file cap (a real library is ~30 KB).
 *  Pure so the client component can mirror it. */
export const SPEC_RECORD_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/** `null` when the file may be imported, else the refusal to show: only
 *  `.xlsx` or `.json`, at most 5 MB. */
export function checkSpecRecordImportFile(name: string, size: number): string | null {
  const lower = str(name).trim().toLowerCase();
  if (!lower.endsWith(".xlsx") && !lower.endsWith(".json")) return "Choose an .xlsx or .json file.";
  if (!(size >= 0) || size > SPEC_RECORD_IMPORT_MAX_BYTES) return "That file is too large — the Spec Library import limit is 5 MB.";
  return null;
}
