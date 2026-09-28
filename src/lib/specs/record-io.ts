import ExcelJS from "exceljs";
import { cellText } from "@/lib/import/xlsx-to-csv";
import { csiKey } from "@/lib/specs/articles";
import { allSpecRecords, saveSpecRecord } from "@/lib/stores/spec-records";
import { allSections, createSection } from "@/lib/stores/spec-sections";
import { allArticles } from "@/lib/stores/spec-articles";
import {
  LIBRARY_HEADERS,
  LIBRARY_SHEET,
  V1_SECTION_TITLES,
  checkSpecRecordImportFile,
  planSpecRecordImport,
  recordToSheetRow,
  recordsFromJson,
  recordsFromSheetRows,
  type ImportPlan,
  type ParsedRecords,
} from "@/lib/specs/record-import";
import type { SpecRecord } from "@/lib/specs/records";

/**
 * Spec Library workbook read/write + commit (#205 follow-on, spec
 * 2026-09-28-spec-records-design.md §2) — the server half of `record-import.ts`.
 *
 * SERVER-ONLY. exceljs pulls Node stream internals and the stores pull the
 * database driver; import this only from server actions, route handlers and
 * scripts — never from a "use client" module (AGENTS.md).
 */

export type ReadLibraryWorkbookResult = { ok: true; rows: string[][] } | { ok: false; error: string };

function sheetToRows(ws: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cells[col - 1] = cellText(cell.value);
    });
    for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = "";
    rows[rowNumber - 1] = cells;
  });
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

/** Finds the sheet named `Spec Library`, else the first sheet whose row 1
 *  contains a `Spec ID` cell — so a renamed tab or a workbook someone
 *  re-ordered still reads. */
export async function readLibraryWorkbook(buf: ArrayBuffer | Buffer): Promise<ReadLibraryWorkbookResult> {
  const wb = new ExcelJS.Workbook();
  try {
    const ab = Buffer.isBuffer(buf) ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf;
    await wb.xlsx.load(ab as ArrayBuffer);
  } catch {
    return { ok: false, error: "That file couldn’t be read as an Excel workbook." };
  }
  if (!wb.worksheets.length) return { ok: false, error: "That workbook has no sheets." };

  let ws = wb.worksheets.find((w) => w.name === LIBRARY_SHEET);
  if (!ws) {
    ws = wb.worksheets.find((w) => {
      let found = false;
      w.getRow(1).eachCell({ includeEmpty: true }, (cell) => {
        if (cellText(cell.value).trim() === "Spec ID") found = true;
      });
      return found;
    });
  }
  if (!ws) return { ok: false, error: `No "${LIBRARY_SHEET}" sheet found.` };

  return { ok: true, rows: sheetToRows(ws) };
}

/** One `Spec Library` sheet, header row bold + frozen, `Spec Text` wrapped —
 *  the exact column layout of Jeff's workbook, so export → import round-trips. */
export async function writeLibraryWorkbook(records: SpecRecord[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(LIBRARY_SHEET);

  ws.addRow([...LIBRARY_HEADERS]);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  for (const r of records) ws.addRow(recordToSheetRow(r));

  const specTextCol = LIBRARY_HEADERS.indexOf("Spec Text") + 1;
  ws.getColumn(specTextCol).alignment = { wrapText: true, vertical: "top" };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

export type CommitResult = { created: number; updated: number; unchanged: number; sectionsCreated: string[] };

/** Commits a plan: creates any missing v1 sections first, then upserts every
 *  item through `saveSpecRecord` — `unchanged` items are skipped entirely so
 *  running an import twice writes no new revisions. Refuses a blocking plan.
 *
 *  Section creation re-reads the LIVE sections right before creating, rather
 *  than trusting `plan.missingSections` at face value: `createSection` mints
 *  a fresh random id every call, so a stale plan (built before an earlier
 *  commit, or simply committed twice) would otherwise create a second
 *  section with the same CSI number. Only a number with no live match (by
 *  `csiKey`) at commit time is actually created, and `sectionsCreated` names
 *  only those. */
export async function commitSpecRecordImport(plan: ImportPlan, by: string, why: string): Promise<CommitResult> {
  if (plan.blocking) {
    throw new Error("commitSpecRecordImport: refusing to commit a plan with blocking problems.");
  }

  const liveKeys = new Set((await allSections()).map((s) => csiKey(s.number)));

  const sectionsCreated: string[] = [];
  for (const number of plan.missingSections) {
    const key = csiKey(number);
    if (liveKeys.has(key)) continue; // already exists — a stale/repeated plan, not actually missing
    const title = V1_SECTION_TITLES[number];
    if (!title) continue; // a non-creatable missing section would already be blocking, above
    await createSection({ number, title, by });
    liveKeys.add(key); // guard a duplicate number within the same plan.missingSections list too
    sectionsCreated.push(number);
  }

  const result: CommitResult = { created: 0, updated: 0, unchanged: 0, sectionsCreated };
  for (const item of plan.items) {
    if (item.action === "unchanged") {
      result.unchanged++;
      continue;
    }
    const saved = await saveSpecRecord(item.record, by, why);
    if (saved.outcome === "created") result.created++;
    else if (saved.outcome === "updated") result.updated++;
    else result.unchanged++;
  }
  return result;
}

/** Reads an uploaded Spec Library file (`.xlsx` → the `Spec Library` sheet,
 *  `.json` → `{ records: [...] }`) and plans it against the LIVE library,
 *  sections and articles. Both of the screen's import actions (preview and
 *  commit) come through here, so a commit always re-plans from the file
 *  itself and never trusts a plan from the client (design §2, D328). */
export async function planSpecRecordImportFile(
  name: string,
  buf: ArrayBuffer | Buffer
): Promise<{ ok: true; plan: ImportPlan } | { ok: false; error: string }> {
  const refused = checkSpecRecordImportFile(name, buf.byteLength);
  if (refused) return { ok: false, error: refused };

  let parsed: ParsedRecords;
  if (name.trim().toLowerCase().endsWith(".json")) {
    let json: unknown;
    try {
      const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
      json = JSON.parse(bytes.toString("utf8"));
    } catch {
      return { ok: false, error: "That file couldn’t be read as JSON." };
    }
    parsed = recordsFromJson(json);
    if (!parsed.records.length && !parsed.problems.length) {
      return { ok: false, error: "That JSON file has no spec records." };
    }
  } else {
    const read = await readLibraryWorkbook(buf);
    if (!read.ok) return read;
    parsed = recordsFromSheetRows(read.rows);
    if (!parsed.records.length && !parsed.problems.length) {
      return { ok: false, error: `The "${LIBRARY_SHEET}" sheet has no spec rows.` };
    }
  }

  const [existing, sections, articles] = await Promise.all([allSpecRecords(), allSections(), allArticles()]);
  const plan = planSpecRecordImport(parsed, {
    existing,
    sections: sections.map((s) => ({ id: s.id, number: s.number })),
    articles: articles.map((a) => ({ id: a.id, sectionId: a.sectionId })),
  });
  return { ok: true, plan };
}
