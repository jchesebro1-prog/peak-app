// SERVER ONLY — reads/writes sheet files and runs pdf-lib.
/**
 * #319 — the ONE step every sheet-creating upload path takes (the Blob
 * broker's commit, the 4 MB multipart route, the intake's copy of a plan on
 * file): store an upload as one or more Grid sheets at its position, then
 * retire the generated plan if nothing is drawn on it (retireBaseSheet).
 *
 * A PDF of 2–60 pages is read back whole and split into one-page PDFs
 * (sheet-split-bytes), each stored like any sheet (private Blob, or a
 * data-URL when Blob is off) as "<file> — p.<n>"; the caller's original is
 * then dropped (`dropOriginal` — the broker's own upload blob, never a
 * customer's file). Anything else — an image, a 1-page PDF, or a PDF that
 * can't be split (encrypted, unreadable, over 60 pages, too large, a page
 * that failed to store) — lands as ONE sheet exactly as before
 * (`storeWhole`), with a note saying why it wasn't split. An upload is never
 * refused for a split reason. `deps` exists for the spec harness.
 */
import { blobEnabled, deleteBlob } from "@/lib/blob";
import { listDocsByField } from "@/db/doc-store";
import { addIntakeNotices, addSheets, retireBaseSheet, type GridSheet, type NewSheetFile } from "@/lib/stores/grid-projects";
import { newNoticeId } from "./grid-plan-intake";
import { splitPdfPages } from "./sheet-split-bytes";
import { storeSheetFile, type StoredSheetFile } from "./sheet-adjust-server";
import {
  baseSheetKeptText,
  GRID_SHEET_SPLIT_COPY as COPY,
  GRID_SHEET_SPLIT_DATAURL_MAX_TOTAL_BYTES,
  GRID_SHEET_SPLIT_MAX_TOTAL_BYTES,
  landed,
  splitFallbackNote,
  splitSheetName,
  type BaseSheetOutcome,
  type SheetsLanded,
} from "./grid-sheet-split";

export type SheetSource = {
  /** The upload's display name ("Set.pdf"). */
  name: string;
  /** What the bytes really are (sniffed / verified by the caller). Only "application/pdf" is ever split. */
  mime: string;
  /** The whole file, to split a PDF. Null (or a throw) = unreadable → one sheet. Never called for a non-PDF. */
  readBytes: () => Promise<Uint8Array | null>;
  /** Store the upload as ONE sheet's file, unchanged; null = storage failed. */
  storeWhole: () => Promise<StoredSheetFile | null>;
  /** After a successful split only: drop the original upload (best effort). */
  dropOriginal?: () => Promise<void>;
};

export type StoreSheetsResult = ({ ok: true } & SheetsLanded) | { ok: false; reason: "storage" | "gone"; error: string };

type SplitStoreDeps = {
  storePage: (projectId: string, name: string, bytes: Uint8Array) => Promise<StoredSheetFile | null>;
  removeBlob: (pathname: string) => Promise<void>;
  blobOn: () => boolean;
};
const liveDeps: SplitStoreDeps = {
  storePage: async (projectId, name, bytes) => {
    const r = await storeSheetFile(projectId, name, bytes, "application/pdf");
    return r.ok ? r.file : null;
  },
  removeBlob: deleteBlob,
  blobOn: blobEnabled,
};

/** Whether any sheet holds this blob path — such a blob is never deleted (an error counts as held). */
async function heldBySheet(pathname: string): Promise<boolean> {
  try {
    return (await listDocsByField<GridSheet>("grid_sheets", "blobPath", [pathname])).length > 0;
  } catch {
    return true;
  }
}

export async function storeUploadAsSheets(
  projectId: string,
  src: SheetSource,
  opts: { by: string; first?: boolean; intakeNotices?: boolean },
  deps: Partial<SplitStoreDeps> = {}
): Promise<StoreSheetsResult> {
  const d: SplitStoreDeps = { ...liveDeps, ...deps };
  let wrote: string[] = [];
  const dropWritten = async () => {
    for (const p of wrote) await d.removeBlob(p).catch(() => {});
    wrote = [];
  };
  let files: NewSheetFile[] | null = null;
  let note: string | null = null;
  if (src.mime === "application/pdf") {
    let bytes: Uint8Array | null = null;
    try {
      bytes = await src.readBytes();
    } catch {
      bytes = null;
    }
    const split = bytes
      ? await splitPdfPages(bytes, { maxTotalBytes: d.blobOn() ? GRID_SHEET_SPLIT_MAX_TOTAL_BYTES : GRID_SHEET_SPLIT_DATAURL_MAX_TOTAL_BYTES })
      : null;
    if (!split) note = splitFallbackNote("unreadable");
    else if (split.ok) {
      const pages = split.pages.length;
      const out: NewSheetFile[] = [];
      for (let i = 0; i < pages; i++) {
        const name = splitSheetName(src.name, i + 1, pages);
        const stored = await d.storePage(projectId, name, split.pages[i]).catch(() => null);
        if (!stored) break;
        if (stored.blobPath) wrote.push(stored.blobPath);
        out.push({ name, ...stored, split: { from: src.name, page: i + 1, pages } });
      }
      if (out.length === pages) files = out;
      else {
        await dropWritten();
        note = splitFallbackNote("failed");
      }
    } else if (split.reason !== "not-pdf" && split.reason !== "single") note = splitFallbackNote(split.reason, split.pageCount);
  }
  const didSplit = files !== null;
  let wholeBlob: string | null = null;
  if (!files) {
    const whole = await src.storeWhole();
    if (!whole) return { ok: false, reason: "storage", error: COPY.storage };
    wholeBlob = whole.blobPath ?? null;
    files = [{ name: src.name, ...whole }];
  }
  const sheets = await addSheets(projectId, files, { by: opts.by, first: opts.first });
  if (!sheets) {
    await dropWritten();
    // The whole file's blob is never recorded now (a copy made for this upload, or
    // the broker's own upload) — drop it unless some sheet already holds that path.
    if (wholeBlob && !(await heldBySheet(wholeBlob))) await d.removeBlob(wholeBlob).catch(() => {});
    return { ok: false, reason: "gone", error: COPY.gone };
  }
  if (didSplit && src.dropOriginal) await src.dropOriginal().catch(() => {});
  let baseSheet: BaseSheetOutcome | null = null;
  try {
    baseSheet = await retireBaseSheet(projectId, opts.by);
  } catch (e) {
    // The plan is in; a failed retire never fails the upload (the generated plan just stays).
    console.error("[grid] retiring the generated plan failed:", e);
  }
  if (opts.intakeNotices) {
    const messages = [note, baseSheet && baseSheet !== "removed" ? baseSheetKeptText(baseSheet) : null].filter((m): m is string => !!m);
    if (messages.length) await addIntakeNotices(projectId, messages.map((message) => ({ id: newNoticeId(), message, at: Date.now() }))).catch(() => null);
  }
  return { ok: true, ...landed(sheets.map((s) => s.id), baseSheet, note) };
}
