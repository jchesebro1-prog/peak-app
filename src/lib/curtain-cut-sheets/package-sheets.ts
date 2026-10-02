/**
 * #292 §5.2 — one Submittal PDF per curtain type into the client package
 * zip, through the signed print route and headless Chrome. SERVER ONLY.
 *
 * What is enforced: the caller passes a deadline measured from the START of
 * the package build (cutSheetDeadline). No render starts with less than
 * CUT_SHEET_MIN_RENDER_MS left; each render gets Chrome step caps of at most
 * the time left (renderTimeoutMs) and our wait on it — queue wait included —
 * is cut at the deadline (rejectAfter). So everything before the cut sheets,
 * every render and the one in flight all end by the deadline, and
 * CUT_SHEET_DEADLINE_MS + PACKAGE_FINISH_ALLOWANCE_MS (index, zip, Blob
 * upload, record) stays inside the pages' maxDuration = 120 with margin —
 * the spec harness asserts it. A late, failed or impossible render becomes a
 * "missing-cutsheet" gap with a fixed customer-safe reason (the zip's index
 * is customer-facing); the raw reason goes to the server log only.
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

export const CUT_SHEET_LATE = "Not rendered in time — print from Cut sheets";
export const CUT_SHEET_RENDER_FAILED = "Couldn't be rendered — print from Cut sheets";
export const CUT_SHEET_QUOTE_GONE = "Cut sheets — the quote they print from no longer exists";
export const CUT_SHEET_ALL_UNREADABLE = "Cut sheets — no curtain size could be read; edit the curtains, then print from Cut sheets";
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

/** A render error → the fixed reason the customer's index may carry. */
export function cutSheetGapReason(e: unknown): string {
  const late = e instanceof CutSheetDeadlineError || (e instanceof Error && e.name === "TimeoutError");
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
    render?: (url: string, o: { timeoutMs: number }) => Promise<Buffer>;
    now?: () => number;
  },
): Promise<CutSheetsAdded> {
  const now = opts.now ?? Date.now;
  const render = opts.render ?? renderPrintRouteToPdf;
  const loaded = await (opts.load ?? ((id: string) => loadCutSheets(id, { images: "none" })))(quoteId);
  const packageGap = (description: string) => gaps.push({ kind: "missing-cutsheet", sku: "CS", description, qty: 0, catalogId: null });
  if (!loaded.ok) {
    // Not a system quote = no curtains to sheet; anything else is a missing set.
    if (loaded.error !== CUT_SHEETS_WRONG_TYPE) packageGap(loaded.error === CUT_SHEETS_NO_QUOTE ? CUT_SHEET_QUOTE_GONE : CUT_SHEET_RENDER_FAILED);
    return { sheets: [], unreadable: [] };
  }
  if (!loaded.result.types.length && loaded.result.unreadable.length) packageGap(CUT_SHEET_ALL_UNREADABLE);
  const sheets: CutSheetSheet[] = [];
  for (const type of loaded.result.types) {
    const gap = (reason: string) => {
      gaps.push({ kind: "missing-cutsheet", sku: type.sheetNo, description: `${type.title} — ${reason}`, qty: type.totalQty, catalogId: null });
      sheets.push({ sheetNo: type.sheetNo, title: type.title, file: null });
    };
    if ("error" in where) {
      if (where !== NO_PRINT_ORIGIN) console.warn(`[cutsheets] package ${quoteId} ${type.sheetNo}: ${where.error}`);
      gap(where === NO_PRINT_ORIGIN ? where.error : CUT_SHEET_RENDER_FAILED);
      continue;
    }
    const left = opts.deadline - now();
    if (left < CUT_SHEET_MIN_RENDER_MS) {
      gap(CUT_SHEET_LATE);
      continue;
    }
    try {
      // Signed right before its own render, so a token never ages in the loop.
      const t = signPrintToken(process.env.AUTH_SECRET || "", "cutsheets", quoteId, now());
      const url = `${where.origin}/print/cutsheets/${encodeURIComponent(quoteId)}?style=submittal&sheet=${encodeURIComponent(type.sheetNo)}&t=${encodeURIComponent(t)}`;
      const name = cutSheetFileName(type.sheetNo, type.title);
      const data = await rejectAfter(render(url, { timeoutMs: renderTimeoutMs(opts.deadline, now()) }), opts.deadline - now());
      files.push({ name, data });
      sheets.push({ sheetNo: type.sheetNo, title: type.title, file: name });
    } catch (e) {
      console.warn(`[cutsheets] package ${quoteId} ${type.sheetNo}: ${e instanceof Error ? e.message : String(e)}`);
      gap(cutSheetGapReason(e));
    }
  }
  return { sheets, unreadable: loaded.result.unreadable };
}
