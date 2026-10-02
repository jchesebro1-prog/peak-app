/**
 * #292 §5.2 — one Submittal PDF per curtain type into the client package
 * zip, through the signed print route and headless Chrome. SERVER ONLY.
 * Chrome unavailable, a bad origin or a render error becomes a gap and the
 * package still builds; past the budget the rest become gaps, so a build
 * stays inside the pages' maxDuration = 120.
 */
import { safeName } from "@/lib/blob";
import type { ClientPackageGap } from "@/lib/client-package";
import { renderPrintRouteToPdf } from "@/lib/quote-pdf/render";
import { signPrintToken } from "@/lib/quote-pdf/token";
import type { ZipFile } from "@/lib/zip";
import type { CollectResult } from "./collect";
import { loadCutSheets } from "./load";

export const CUT_SHEET_BUDGET_MS = 60_000;
export const CUT_SHEET_LATE = "Not rendered in time — print from Cut sheets";
export type PrintWhere = { origin: string } | { error: string };
export const NO_PRINT_ORIGIN: PrintWhere = { error: "No print address for this request — print from Cut sheets" };

export function cutSheetFileName(sheetNo: string, title: string): string {
  return `cutsheets/${sheetNo}-${safeName(title)}.pdf`;
}

export async function addCutSheets(
  quoteId: string,
  where: PrintWhere,
  files: ZipFile[],
  gaps: ClientPackageGap[],
  budgetMs = CUT_SHEET_BUDGET_MS
): Promise<{ sheets: Array<{ sheetNo: string; title: string; file: string | null }>; unreadable: CollectResult["unreadable"] }> {
  const loaded = await loadCutSheets(quoteId, { images: "none" });
  if (!loaded.ok) return { sheets: [], unreadable: [] };
  const started = Date.now();
  const sheets: Array<{ sheetNo: string; title: string; file: string | null }> = [];
  for (const type of loaded.result.types) {
    const gap = (reason: string) => {
      gaps.push({ kind: "missing-cutsheet", sku: type.sheetNo, description: `${type.title} — ${reason}`, qty: type.totalQty, catalogId: null });
      sheets.push({ sheetNo: type.sheetNo, title: type.title, file: null });
    };
    if ("error" in where) {
      gap(where.error);
      continue;
    }
    if (Date.now() - started > budgetMs) {
      gap(CUT_SHEET_LATE);
      continue;
    }
    try {
      const t = signPrintToken(process.env.AUTH_SECRET || "", "cutsheets", quoteId, Date.now());
      const url = `${where.origin}/print/cutsheets/${encodeURIComponent(quoteId)}?style=submittal&sheet=${encodeURIComponent(type.sheetNo)}&t=${encodeURIComponent(t)}`;
      const name = cutSheetFileName(type.sheetNo, type.title);
      files.push({ name, data: await renderPrintRouteToPdf(url) });
      sheets.push({ sheetNo: type.sheetNo, title: type.title, file: name });
    } catch (e) {
      gap(e instanceof Error ? e.message : "Could not render — print from Cut sheets");
    }
  }
  return { sheets, unreadable: loaded.result.unreadable };
}
