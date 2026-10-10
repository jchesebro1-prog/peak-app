/**
 * #319 — a multi-page PDF becomes one Grid sheet per page, and a real plan
 * retires the generated plan. Pure and client-safe (the editor, the intake
 * and the notices banner import it): the caps, the names, the provenance
 * stamp, the result every upload path returns, its copy, and the Adjust-sheet
 * queue rules. The bytes are split in sheet-split-bytes.ts (pdf-lib); the one
 * "store an upload as sheets" step is grid-sheet-split-server.ts.
 */

/** Most pages one upload is split into; more → kept as one sheet, with a note. */
export const GRID_SHEET_SPLIT_MAX_PAGES = 60;
/** Most bytes the one-page files of a split may add up to (pdf-lib copies shared
 *  resources into every page) — Blob on. Over → one sheet, with a note. */
export const GRID_SHEET_SPLIT_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
/** The same budget when Blob is off and every page is stored in-database. */
export const GRID_SHEET_SPLIT_DATAURL_MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const NAME_MAX = 120;
const SHEET_ID_RE = /^gs-[0-9a-f]{12}$/;

export const GRID_SHEET_SPLIT_COPY = {
  storage: "Upload to file storage failed — check the Blob token, or try again.",
  gone: "That design could not be found.",
} as const;

/** Stamped on each sheet split from a multi-page PDF (display/provenance only). */
export type SheetSplit = { from: string; page: number; pages: number };
/** What a landed plan did to the generated plan: removed it, or left it (and why). */
export type BaseSheetOutcome = "removed" | { kept: number; what: "devices" | "wires" };
/** Every sheet-creating path's success: all new sheets in order (`sheetId` = the first). */
export type SheetsLanded = { sheetId: string; sheetIds: string[]; baseSheet?: BaseSheetOutcome; note?: string };
export type SheetUploadResult = ({ ok: true } & SheetsLanded) | { ok: false; error: string };
/** Why a PDF was kept as one sheet instead of split. */
export type SplitFallback = "too-many-pages" | "encrypted" | "unreadable" | "too-big" | "failed";

/** `<file name> — p.<n>`; a 1-page PDF keeps its name. The suffix always fits the 120-character cap. */
export function splitSheetName(name: string, page: number, pages: number): string {
  const base = (name || "").trim() || "Plan sheet";
  if (pages <= 1) return base.slice(0, NAME_MAX);
  const suffix = ` — p.${page}`;
  return base.slice(0, NAME_MAX - suffix.length).trimEnd() + suffix;
}

export function cleanBaseSheetOutcome(raw: unknown): BaseSheetOutcome | null {
  if (raw === "removed") return "removed";
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { kept?: unknown; what?: unknown };
  const kept = Number(o.kept);
  return Number.isInteger(kept) && kept > 0 && (o.what === "devices" || o.what === "wires") ? { kept, what: o.what } : null;
}

export function baseSheetKeptText(o: { kept: number; what: "devices" | "wires" }): string {
  const noun = o.what === "devices" ? (o.kept === 1 ? "device" : "devices") : o.kept === 1 ? "wire" : "wires";
  return `Generated plan kept — it has ${o.kept} ${noun} on it.`;
}

export function splitFallbackNote(reason: SplitFallback, pageCount = 0): string {
  switch (reason) {
    case "too-many-pages":
      return `This PDF has ${pageCount} pages — more than ${GRID_SHEET_SPLIT_MAX_PAGES} — so it was kept as one sheet.`;
    case "encrypted":
      return "This PDF is password-protected, so it was kept as one sheet.";
    case "too-big":
      return "This PDF's pages are too large to store one by one, so it was kept as one sheet.";
    case "failed":
      return "This PDF's pages couldn't be saved one by one, so it was kept as one sheet.";
    default:
      return "This PDF couldn't be split into pages, so it was kept as one sheet.";
  }
}

/** The success shape, with empty extras left off. */
export function landed(sheetIds: readonly string[], baseSheet?: BaseSheetOutcome | null, note?: string | null): SheetsLanded {
  return { sheetId: sheetIds[0] ?? "", sheetIds: [...sheetIds], ...(baseSheet ? { baseSheet } : {}), ...(note ? { note } : {}) };
}

/** The editor's "Last action" after an upload. `intakeNotices`: the upload
 *  went through an intake-position path, which already left the kept sentence
 *  and the split note as intake notices (D698) — they are not repeated here. */
export function uploadNote(fileName: string, r: Pick<SheetsLanded, "sheetIds" | "baseSheet" | "note">, opts?: { intakeNotices?: boolean }): string {
  const n = r.sheetIds.length;
  const parts = [n > 1 ? `Uploaded ${fileName} as ${n} sheets` : `Uploaded ${fileName}`];
  if (r.baseSheet === "removed") parts.push("removed the generated plan");
  else if (r.baseSheet && !opts?.intakeNotices) parts.push(baseSheetKeptText(r.baseSheet));
  if (r.note && !opts?.intakeNotices) parts.push(r.note);
  return parts.join(" · ");
}

const isSheetId = (v: unknown): v is string => typeof v === "string" && SHEET_ID_RE.test(v);

/** The 4 MB route's JSON reply → the success shape, or null. An older single-sheet reply still reads. */
export function parseSheetsLanded(raw: unknown): SheetsLanded | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.ok !== true || !isSheetId(o.sheetId)) return null;
  const ids = Array.isArray(o.sheetIds) ? o.sheetIds.filter(isSheetId) : [];
  const note = typeof o.note === "string" ? o.note.trim().slice(0, 300) : "";
  return landed(ids.length ? ids : [o.sheetId], cleanBaseSheetOutcome(o.baseSheet), note);
}

/** `?adjust=<id>,<id>,…` → the listed ids, in the order asked, no repeats, at most 60. */
export function parseAdjustParam(raw: unknown, sheetIds: readonly string[]): string[] {
  if (typeof raw !== "string" || !raw) return [];
  const listed = new Set(sheetIds);
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (listed.has(id) && !out.includes(id)) out.push(id);
    if (out.length >= GRID_SHEET_SPLIT_MAX_PAGES) break;
  }
  return out;
}

/**
 * Adjust sheet's walk through a multi-sheet upload: where `current` sits
 * ("Sheet 2 of 5") and the next queued sheet still listed. A queue of one, or
 * a sheet not in it, is no walk.
 */
export function adjustQueueStep(
  queue: readonly string[] | null | undefined,
  current: string,
  listed: readonly string[]
): { position: { index: number; total: number } | null; next: string | null } {
  if (!queue || queue.length < 2) return { position: null, next: null };
  const index = queue.indexOf(current);
  if (index < 0) return { position: null, next: null };
  const live = new Set(listed);
  return { position: { index, total: queue.length }, next: queue.slice(index + 1).find((id) => live.has(id)) ?? null };
}
