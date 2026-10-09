// SERVER ONLY — reads/writes sheet files and runs pdf-lib.
/**
 * #319 — the ONE step every sheet-creating upload path takes (the Blob
 * broker's commit, the 4 MB multipart route, the intake's copy of a plan on
 * file): store an upload as one or more Grid sheets at its position, then
 * retire the generated plan if nothing is drawn on it (retireBaseSheet).
 *
 * A PDF of 2–60 pages is read back whole and split into one-page PDFs
 * (sheet-split-bytes), each stored like any sheet (private Blob, or a
 * data-URL when Blob is off; four at a time) as "<file> — p.<n>". The result
 * then says `split: true` — no sheet holds the original — and a caller that
 * owns the original (the broker's own upload blob, never a customer's file)
 * drops it once its own transaction has committed. Anything else — an image,
 * a 1-page PDF, or a PDF that can't be split (encrypted, unreadable, over 60
 * pages, too large, a page that failed to store) — lands as ONE sheet exactly
 * as before (`storeWhole`), with a note saying why it wasn't split. An upload
 * is never refused for a split reason. Page blobs this call wrote are deleted
 * again whenever they end up unrecorded (a page failed, the design is gone,
 * or a throw). `deps` exists for the spec harness.
 */
import { sql } from "drizzle-orm";
import { getDb, inTransaction } from "@/db";
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

/** Split pages stored at once (Blob writes run in parallel; order is kept by index). */
export const GRID_SHEET_SPLIT_STORE_CONCURRENCY = 4;

export type SheetSource = {
  /** The upload's display name ("Set.pdf"). */
  name: string;
  /** What the bytes really are (sniffed / verified by the caller). Only "application/pdf" is ever split. */
  mime: string;
  /** The whole file, to split a PDF. Null (or a throw) = unreadable → one sheet. Never called for a non-PDF. */
  readBytes: () => Promise<Uint8Array | null>;
  /** Store the upload as ONE sheet's file, unchanged; null = storage failed. */
  storeWhole: () => Promise<StoredSheetFile | null>;
};

/** `split`: the upload became one sheet per page, so no sheet holds the original. */
export type StoreSheetsResult = ({ ok: true; split: boolean } & SheetsLanded) | { ok: false; reason: "storage" | "gone"; error: string };

type SplitStoreDeps = {
  storePage: (projectId: string, name: string, bytes: Uint8Array) => Promise<StoredSheetFile | null>;
  removeBlob: (pathname: string) => Promise<void>;
  blobOn: () => boolean;
  retire: (projectId: string, by: string) => Promise<BaseSheetOutcome | null>;
};
const liveDeps: SplitStoreDeps = {
  storePage: async (projectId, name, bytes) => {
    const r = await storeSheetFile(projectId, name, bytes, "application/pdf");
    return r.ok ? r.file : null;
  },
  removeBlob: deleteBlob,
  blobOn: blobEnabled,
  retire: retireBaseSheet,
};

/**
 * Whether any sheet holds this blob path — such a blob is never deleted. A
 * failed lookup counts as held (the safe direction). Shared with the broker's
 * commit (grid-sheet-upload-server).
 */
export async function sheetHoldsBlob(pathname: string): Promise<boolean> {
  try {
    return (await listDocsByField<GridSheet>("grid_sheets", "blobPath", [pathname])).length > 0;
  } catch {
    return true;
  }
}

/** Inside a transaction (the plan lock), whether a failed statement has aborted it. */
async function transactionAborted(): Promise<boolean> {
  if (!inTransaction()) return false;
  try {
    await (await getDb()).execute(sql`select 1`);
    return false;
  } catch {
    return true;
  }
}

/** Store every page, `limit` at a time, in page order; null when any page failed (the rest stop starting). */
async function storePages(
  projectId: string,
  srcName: string,
  pages: Uint8Array[],
  d: SplitStoreDeps,
  wrote: string[]
): Promise<NewSheetFile[] | null> {
  const total = pages.length;
  const out: (NewSheetFile | null)[] = new Array(total).fill(null);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < total) {
      const i = next++;
      const name = splitSheetName(srcName, i + 1, total);
      const stored = await d.storePage(projectId, name, pages[i]).catch(() => null);
      if (!stored) {
        failed = true;
        return;
      }
      if (stored.blobPath) wrote.push(stored.blobPath);
      out[i] = { name, ...stored, split: { from: srcName, page: i + 1, pages: total } };
    }
  };
  await Promise.all(Array.from({ length: Math.min(GRID_SHEET_SPLIT_STORE_CONCURRENCY, total) }, worker));
  return failed || out.some((f) => !f) ? null : (out as NewSheetFile[]);
}

export async function storeUploadAsSheets(
  projectId: string,
  src: SheetSource,
  opts: { by: string; first?: boolean; intakeNotices?: boolean },
  deps: Partial<SplitStoreDeps> = {}
): Promise<StoreSheetsResult> {
  const d: SplitStoreDeps = { ...liveDeps, ...deps };
  const wrote: string[] = [];
  const dropWritten = async () => {
    for (const p of wrote.splice(0)) await d.removeBlob(p).catch(() => {});
  };
  let added = false;
  try {
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
        files = await storePages(projectId, src.name, split.pages, d, wrote);
        if (!files) {
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
      if (wholeBlob && !(await sheetHoldsBlob(wholeBlob))) await d.removeBlob(wholeBlob).catch(() => {});
      return { ok: false, reason: "gone", error: COPY.gone };
    }
    added = true;
    // Off the plan lock the new sheets are already committed, so a failed retire or
    // notice never fails the upload (the generated plan just stays). Under the lock
    // (one transaction) a failed statement aborts it — the new sheets roll back with
    // it — so that error is rethrown and the upload fails as a whole.
    let baseSheet: BaseSheetOutcome | null = null;
    try {
      baseSheet = await d.retire(projectId, opts.by);
    } catch (e) {
      if (await transactionAborted()) throw e;
      console.error("[grid] retiring the generated plan failed:", e);
    }
    if (opts.intakeNotices) {
      const messages = [note, baseSheet && baseSheet !== "removed" ? baseSheetKeptText(baseSheet) : null].filter((m): m is string => !!m);
      if (messages.length) {
        try {
          await addIntakeNotices(projectId, messages.map((message) => ({ id: newNoticeId(), message, at: Date.now() })));
        } catch (e) {
          if (await transactionAborted()) throw e;
          console.error("[grid] adding the upload's intake notices failed:", e);
        }
      }
    }
    return { ok: true, split: didSplit, ...landed(sheets.map((s) => s.id), baseSheet, note) };
  } catch (e) {
    // Pages written but never recorded — or recorded in a transaction this throw rolls back.
    if (!added || inTransaction()) await dropWritten();
    throw e;
  }
}
