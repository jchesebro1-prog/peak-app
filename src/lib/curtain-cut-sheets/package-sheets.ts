/**
 * #292 §5.2 — one Submittal PDF per curtain type into the client package
 * zip, through the signed print route and headless Chrome. SERVER ONLY.
 *
 * What is enforced, exactly: the caller passes a deadline measured from the
 * START of the package build (cutSheetDeadline). The work BEFORE the cut
 * sheets (spec, datasheets, plan sheets) is not bounded by it — it only
 * shortens the time left. loadCutSheets runs once, before any deadline check
 * (so a slow load is not cut either). After that, no render starts with less
 * than CUT_SHEET_MIN_RENDER_MS left — past the deadline every remaining sheet
 * becomes a gap without rendering. Each render gets Chrome step caps of at
 * most the time left (renderTimeoutMs), an AbortSignal that fires at the
 * deadline (a render still queued never launches Chrome; a running one has
 * its browser closed — the shared queue is released for quote PDF saves),
 * and our wait on it, queue wait included, is cut at the deadline
 * (rejectAfter — also covers a renderer that ignores the signal).
 * CUT_SHEET_DEADLINE_MS + PACKAGE_FINISH_ALLOWANCE_MS (index, zip, Blob
 * upload, record) stays inside the pages' maxDuration = 120 with margin —
 * the spec harness asserts it. A sheet not in the zip is a
 * "missing-cutsheet" gap whose reason is the one customer-safe sentence
 * CUT_SHEET_ON_REQUEST (the zip's index is customer-facing); the staff
 * detail (late, failed, no print address, unreadable sizes) goes to the
 * server log only.
 */
import { safeName } from "@/lib/blob";
import type { ClientPackageGap } from "@/lib/client-package";
import { renderPrintRouteToPdf, RENDER_STEP_TIMEOUT_MS } from "@/lib/quote-pdf/render";
import { signPrintToken } from "@/lib/quote-pdf/token";
import type { ZipFile } from "@/lib/zip";
import type { CollectResult } from "./collect";
import { CutSheetDeadlineError, rejectAfter } from "./deadline";
import { loadCutSheets } from "./load";
import { CUT_SHEETS_NO_QUOTE, CUT_SHEETS_WRONG_TYPE } from "./model";

/** From the start of the package build: no cut-sheet render runs past it. */
export const CUT_SHEET_DEADLINE_MS = 75_000;
/** A render needs at least this much time left to be worth starting. */
export const CUT_SHEET_MIN_RENDER_MS = 5_000;
/** After the deadline: the index, the zip, the Blob upload and the record save. */
export const PACKAGE_FINISH_ALLOWANCE_MS = 25_000;
/** The pages that build packages (quotes/page.tsx, design/grid/[id]/page.tsx). */
export const PACKAGE_MAX_DURATION_MS = 120_000;

/** The one reason the customer's index gives for a sheet (or set) that isn't in the zip. */
export const CUT_SHEET_ON_REQUEST = "Cut sheet available on request";
export const CUT_SHEETS_ON_REQUEST = "Cut sheets available on request";
/** Staff-only — server log lines, never the zip. */
export const CUT_SHEET_LATE = "Not rendered in time — print from Cut sheets";
export const CUT_SHEET_RENDER_FAILED = "Couldn't be rendered — print from Cut sheets";
export const CUT_SHEET_ALL_UNREADABLE = "Cut sheets — no curtain size could be read; edit the curtains, then print from Cut sheets";
export const CUT_SHEET_QUOTE_GONE = "Cut sheets — the quote they print from no longer exists";
export type PrintWhere = { origin: string } | { error: string };
export const NO_PRINT_ORIGIN: PrintWhere = { error: "No print address for this request — print from Cut sheets" };

export function cutSheetFileName(sheetNo: string, title: string): string {
  return `cutsheets/${sheetNo}-${safeName(title)}.pdf`;
}

/** The cut-sheet deadline for a package whose build started at `packageStartedAt`. */
export function cutSheetDeadline(packageStartedAt: number): number {
  return packageStartedAt + CUT_SHEET_DEADLINE_MS;
}

/** Chrome's per-step cap for a render starting at `now`: never past the deadline, never above the normal step cap. */
export function renderTimeoutMs(deadline: number, now: number): number {
  return Math.max(1, Math.min(RENDER_STEP_TIMEOUT_MS, deadline - now));
}

/** A render error → the fixed staff reason for the server log (late vs failed); the customer's index always says CUT_SHEET_ON_REQUEST. */
export function cutSheetGapReason(e: unknown): string {
  const late = e instanceof CutSheetDeadlineError || (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"));
  return late ? CUT_SHEET_LATE : CUT_SHEET_RENDER_FAILED;
}

type CutSheetSheet = { sheetNo: string; title: string; file: string | null };
export type CutSheetsAdded = { sheets: CutSheetSheet[]; unreadable: CollectResult["unreadable"] };
type LoadForPackage = (quoteId: string) => Promise<
  { ok: true; result: Pick<CollectResult, "types" | "unreadable"> } | { ok: false; error: string }
>;

export async function addCutSheets(
  quoteId: string,
  where: PrintWhere,
  files: ZipFile[],
  gaps: ClientPackageGap[],
  opts: {
    /** Epoch ms — cutSheetDeadline(<package build start>). */
    deadline: number;
    /** Harness seams; production uses the real loader, renderer and clock. */
    load?: LoadForPackage;
    render?: (url: string, o: { timeoutMs: number; signal?: AbortSignal }) => Promise<Buffer>;
    now?: () => number;
  },
): Promise<CutSheetsAdded> {
  const now = opts.now ?? Date.now;
  const render = opts.render ?? renderPrintRouteToPdf;
  // The one load for the whole set; each render's print route reads only its own sheet.
  const loaded = await (opts.load ?? ((id: string) => loadCutSheets(id, { images: "none" })))(quoteId);
  const log = (what: string, detail: string) => console.warn(`[cutsheets] package ${quoteId} ${what}: ${detail}`);
  const packageGap = (description: string) => gaps.push({ kind: "missing-cutsheet", sku: "CS", description, qty: 0, catalogId: null });
  if (!loaded.ok) {
    // Not a system quote = no curtains to sheet; anything else is a missing set.
    if (loaded.error === CUT_SHEETS_NO_QUOTE) packageGap(CUT_SHEET_QUOTE_GONE);
    else if (loaded.error !== CUT_SHEETS_WRONG_TYPE) {
      log("load", loaded.error);
      packageGap(CUT_SHEETS_ON_REQUEST);
    }
    return { sheets: [], unreadable: [] };
  }
  if (!loaded.result.types.length && loaded.result.unreadable.length) {
    log("set", CUT_SHEET_ALL_UNREADABLE);
    packageGap(CUT_SHEETS_ON_REQUEST);
  }
  // Fires at the deadline: a render still queued never launches Chrome, a running one closes its browser.
  const abort = new AbortController();
  // A real timer on the real clock (the `now` seam only steers the per-render decisions below).
  const abortTimer = setTimeout(() => abort.abort(new CutSheetDeadlineError()), Math.max(0, opts.deadline - Date.now()));
  const sheets: CutSheetSheet[] = [];
  try {
    for (const type of loaded.result.types) {
      const gap = (staffReason: string) => {
        log(type.sheetNo, staffReason);
        gaps.push({ kind: "missing-cutsheet", sku: type.sheetNo, description: `${type.title} — ${CUT_SHEET_ON_REQUEST}`, qty: type.totalQty, catalogId: null });
        sheets.push({ sheetNo: type.sheetNo, title: type.title, file: null });
      };
      if ("error" in where) {
        gap(where.error);
        continue;
      }
      const left = opts.deadline - now();
      if (left < CUT_SHEET_MIN_RENDER_MS || abort.signal.aborted) {
        gap(CUT_SHEET_LATE);
        continue;
      }
      try {
        // Signed right before its own render, so a token never ages in the loop.
        const t = signPrintToken(process.env.AUTH_SECRET || "", "cutsheets", quoteId, now());
        const url = `${where.origin}/print/cutsheets/${encodeURIComponent(quoteId)}?style=submittal&sheet=${encodeURIComponent(type.sheetNo)}&t=${encodeURIComponent(t)}`;
        const name = cutSheetFileName(type.sheetNo, type.title);
        const data = await rejectAfter(render(url, { timeoutMs: renderTimeoutMs(opts.deadline, now()), signal: abort.signal }), opts.deadline - now());
        files.push({ name, data });
        sheets.push({ sheetNo: type.sheetNo, title: type.title, file: name });
      } catch (e) {
        gap(`${cutSheetGapReason(e)} (${e instanceof Error ? e.message : String(e)})`);
      }
    }
  } finally {
    clearTimeout(abortTimer);
    // Anything still queued or running for this package is abandoned now, never left holding the Chrome queue.
    abort.abort(new CutSheetDeadlineError());
  }
  return { sheets, unreadable: loaded.result.unreadable };
}
