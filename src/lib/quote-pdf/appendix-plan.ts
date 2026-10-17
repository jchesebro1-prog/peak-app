import { MAX_PACKAGE_FILE_BYTES, type PackageFile } from "@/lib/estimate-output/package-files";
import { PDF_NOTES_MAX } from "./state";

export { PDF_NOTES_MAX };

/**
 * Spec 2026-10-16 §4 — the drawings merged into the customer PDF, the pure
 * half: which Plans & risers files are taken (list order, 25 MB each, and only
 * what fits the PDF's 14 MB ceiling), where an image sits on its page, and the
 * notes a skipped drawing leaves on the PDF state. Never decides to fail the
 * PDF. Client-safe.
 *
 * Amendment A1 (Jeff, Oct 16): the finished estimate PDF — estimate pages,
 * drawings and the datasheet links page — stays ≤ 14 MB, headroom under the
 * 15 MB email attachment limit (ESTIMATE_EMAIL_ATTACH_MAX), so Send can still
 * attach it. A drawing that doesn't fit is left out with a note and stays on
 * the client package page.
 */

export const ESTIMATE_PDF_TARGET_MAX_BYTES = 14 * 1024 * 1024;
const NOTE_MAX = 200;

export type DrawingSkipReason = "too-big" | "over-total" | "unreadable" | "encrypted" | "late";
export type DrawingSkip = { name: string; reason: DrawingSkipReason };

/** What the drawings may add: the 14 MB ceiling less the estimate and links pages already rendered (never negative). */
export function drawingsBudget(mainBytes: number, tailBytes: number): number {
  if (!Number.isFinite(mainBytes) || mainBytes < 0) return 0;
  const tail = Number.isFinite(tailBytes) && tailBytes > 0 ? tailBytes : 0;
  return Math.max(0, ESTIMATE_PDF_TARGET_MAX_BYTES - mainBytes - tail);
}

/** List order: a file with no usable size is `unreadable`, one over the per-file cap `too-big`; then each file is
 *  taken while the running total stays inside `total` — one that doesn't fit is `over-total` and a smaller one
 *  after it may still (skip and continue, confirmed in review). */
export function planDrawings(
  files: readonly PackageFile[],
  caps: { perFile: number; total: number } = { perFile: MAX_PACKAGE_FILE_BYTES, total: ESTIMATE_PDF_TARGET_MAX_BYTES }
): Array<{ file: PackageFile; skip: DrawingSkipReason | null }> {
  let total = 0;
  return files.map((file) => {
    if (!(file.size > 0)) return { file, skip: "unreadable" as const };
    if (file.size > caps.perFile) return { file, skip: "too-big" as const };
    if (total + file.size > caps.total) return { file, skip: "over-total" as const };
    total += file.size;
    return { file, skip: null };
  });
}

export const LETTER_PT = { w: 612, h: 792 } as const;
export const DRAWING_MARGIN_PT = 36;

/** One image per page: a letter page in the image's orientation (landscape when wider than tall), the image
 *  fitted inside 0.5in margins and centred. Null for an image with no usable size. */
export function imagePagePlacement(imgW: number, imgH: number): { pageW: number; pageH: number; x: number; y: number; w: number; h: number } | null {
  if (!Number.isFinite(imgW) || !Number.isFinite(imgH) || imgW <= 0 || imgH <= 0) return null;
  const landscape = imgW > imgH;
  const pageW = landscape ? LETTER_PT.h : LETTER_PT.w;
  const pageH = landscape ? LETTER_PT.w : LETTER_PT.h;
  const k = Math.min((pageW - 2 * DRAWING_MARGIN_PT) / imgW, (pageH - 2 * DRAWING_MARGIN_PT) / imgH);
  const w = imgW * k;
  const h = imgH * k;
  return { pageW, pageH, x: (pageW - w) / 2, y: (pageH - h) / 2, w, h };
}

/** How each skip finishes "Drawing “name” was …". */
const LEFT_OUT: Record<DrawingSkipReason, string> = {
  "too-big": "left out of the PDF: it is over 25 MB",
  "over-total": "left out to keep the PDF under 15 MB for email; it’s on the client package page",
  unreadable: "left out of the PDF: it couldn’t be read",
  encrypted: "left out of the PDF: it is a password-protected PDF",
  late: "left out of the PDF: the PDF ran out of time",
};

/** PDF-level notes say only what is true: the links are named only when this PDF would have had a links page. */
export const APPENDIX_COPY = {
  late: "The drawings and datasheet links were left out — the PDF ran out of time. Use Retry to make it again.",
  lateDrawings: "The drawings were left out — the PDF ran out of time. Use Retry to make it again.",
  notMerged: "The drawings and datasheet links couldn’t be added to this PDF. Use Retry to make it again.",
  notMergedDrawings: "The drawings couldn’t be added to this PDF. Use Retry to make it again.",
  linksMissing: "The datasheet links page couldn’t be added. Use Retry to make it again.",
  /** Defensive only (A1): drawings never push the PDF past 14 MB, so this is an estimate that is too large on its own. */
  tooLargeToEmail: (mb: string) => `This PDF is ${mb} MB — too large to attach to an email; send the link instead.`,
  more: (n: number) => `…and ${n} more.`,
} as const;

/** The notes a fresh render can clear (out of time, a merge that failed, a missing links page): the PDF viewer
 *  offers its Retry (retryQuotePdfAction) beside the first one, so the copy's "Use Retry" is always there. */
export const RETRYABLE_PDF_NOTES: readonly string[] = [APPENDIX_COPY.late, APPENDIX_COPY.lateDrawings, APPENDIX_COPY.notMerged, APPENDIX_COPY.notMergedDrawings, APPENDIX_COPY.linksMissing];

/** The one note for the whole appendix when it didn't happen (out of time, or the estimate pdf-lib couldn't merge). */
export function appendixLeftOutNote(why: "late" | "unmergeable", hasLinks: boolean): string {
  if (why === "late") return hasLinks ? APPENDIX_COPY.late : APPENDIX_COPY.lateDrawings;
  return hasLinks ? APPENDIX_COPY.notMerged : APPENDIX_COPY.notMergedDrawings;
}

export function drawingSkipNote(s: DrawingSkip): string {
  return `Drawing “${s.name}” was ${LEFT_OUT[s.reason]}.`;
}

/** Trimmed, de-duplicated, each ≤ 200 chars, at most PDF_NOTES_MAX (the last says how many more). Callers put the
 *  PDF-level notes first, so only per-drawing notes ever fold into "…and N more". */
export function pdfNotesOf(lines: readonly string[]): string[] {
  const clean = [...new Set(lines.map((l) => String(l ?? "").trim().slice(0, NOTE_MAX)).filter(Boolean))];
  return clean.length <= PDF_NOTES_MAX ? clean : [...clean.slice(0, PDF_NOTES_MAX - 1), APPENDIX_COPY.more(clean.length - (PDF_NOTES_MAX - 1))];
}

export function sizeMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}
