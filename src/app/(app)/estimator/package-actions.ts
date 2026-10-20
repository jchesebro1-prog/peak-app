"use server";

import { headers } from "next/headers";
import { finalizePackageFileUpload, generateGridDrawingSet, removePackageFileAndBlob } from "@/lib/estimate-output/package-files-server";
import { GRID_SET_COPY } from "@/lib/design/grid-set-print";
import { PACKAGE_FILES_COPY } from "@/lib/estimate-output/package-files";
import { clearPackageZipCache } from "@/lib/estimate-output/package-zip-server";
import { loadPackagePanel, type PackagePanel } from "@/lib/estimate-output/package-panel-server";
import { printOriginFor } from "@/lib/quote-pdf/origin";
import { pdfAppendixKey } from "@/lib/quote-pdf/appendix-key";
import { markQuotePdfStale, scheduleQuotePdf } from "@/lib/quote-pdf/schedule";
import type { QuotePdfView } from "@/lib/quote-pdf/state";
import { ONLINE_COPY } from "@/lib/quote-share/view";
import { requireUser } from "@/lib/session";
import { get as getQuote, setPackagePeakHeader } from "@/lib/stores/quotes";
import { loadPeakHeaderDefault } from "@/lib/letterhead-server";
import { can } from "@/lib/team";

/**
 * #301 slice C — the staff package panel's server actions (Slice C
 * adaptation 15: share-actions.ts stays #293's). Reading needs a session;
 * every write needs Send (the drawings and the zip are what the client
 * link shows), answered with a message, never requirePerm's redirect.
 */

/** Spec 2026-10-16 §4 — the drawings print in the customer PDF: re-render it when the shown list moved. */
async function rerenderIfAppendixMoved(quoteId: string, beforeKey: string): Promise<QuotePdfView | undefined> {
  try {
    const q = await getQuote(quoteId);
    if (!q || pdfAppendixKey(q) === beforeKey) return undefined;
    return (await scheduleQuotePdf(q.id)) ?? undefined;
  } catch (e) {
    // The drawing write already landed — a failed re-read never reports it as failed (the PDF offers Retry).
    console.error("[package] PDF re-render check failed", quoteId, e);
    return undefined;
  }
}

export async function addPackageFileAction(quoteId: string, input: { uploadKey: string; blobPath: string; fileName: string; kind: string }): Promise<{ ok: true; pdf?: QuotePdfView } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("send", user.roles)) return { ok: false, error: ONLINE_COPY.needsSend };
  try {
    const before = pdfAppendixKey(await getQuote(String(quoteId || "")));
    const r = await finalizePackageFileUpload(String(quoteId || ""), input, user.name);
    if (!r.ok) return { ok: false, error: r.error };
    const pdf = await rerenderIfAppendixMoved(String(quoteId || ""), before);
    return { ok: true, ...(pdf ? { pdf } : {}) };
  } catch (e) {
    console.error("[package] add drawing failed", e);
    return { ok: false, error: PACKAGE_FILES_COPY.failed };
  }
}

export async function removePackageFileAction(quoteId: string, fileId: string): Promise<{ ok: true; pdf?: QuotePdfView } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("send", user.roles)) return { ok: false, error: ONLINE_COPY.needsSend };
  try {
    const before = pdfAppendixKey(await getQuote(String(quoteId || "")));
    const r = await removePackageFileAndBlob(String(quoteId || ""), String(fileId || ""));
    if (!r.ok) return { ok: false, error: r.error };
    const pdf = await rerenderIfAppendixMoved(String(quoteId || ""), before);
    return { ok: true, ...(pdf ? { pdf } : {}) };
  } catch (e) {
    console.error("[package] remove drawing failed", e);
    return { ok: false, error: PACKAGE_FILES_COPY.failed };
  }
}

/** The panel's read: any signed-in user; Send decides which buttons work. */
export async function packagePanelAction(quoteId: string): Promise<{ ok: true; panel: PackagePanel } | { ok: false; error: string }> {
  const user = await requireUser();
  try {
    const q = await getQuote(String(quoteId || ""));
    if (!q) return { ok: false, error: ONLINE_COPY.gone };
    // #314: the panel's "Design in the Grid" needs create.
    const panel = await loadPackagePanel(q, can("send", user.roles));
    return { ok: true, panel: { ...panel, canCreate: can("create", user.roles) } };
  } catch (e) {
    console.error("[package] panel read failed", e);
    return { ok: false, error: PACKAGE_FILES_COPY.failed };
  }
}

/** R10 — "Rebuild package": the next download builds a fresh zip. */
export async function rebuildPackageZipAction(quoteId: string): Promise<{ ok: true; removed: number } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("send", user.roles)) return { ok: false, error: ONLINE_COPY.needsSend };
  try {
    const q = await getQuote(String(quoteId || ""));
    if (!q) return { ok: false, error: ONLINE_COPY.gone };
    return { ok: true, removed: await clearPackageZipCache(q.id) };
  } catch (e) {
    console.error("[package] rebuild failed", e);
    return { ok: false, error: PACKAGE_FILES_COPY.failed };
  }
}

/** Grid notes #9 — the estimate's "Include Peak header" for its package
 *  documents: true/false, or null to follow the company default. A boolean
 *  matching the default stores nothing (the estimate keeps following it);
 *  anything else is refused. The zip cache is keyed by the resolved header,
 *  so correctness never depends on the clear below — it only frees storage. */
export async function setPackagePeakHeaderAction(quoteId: string, on: boolean | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("send", user.roles)) return { ok: false, error: ONLINE_COPY.needsSend };
  if (typeof on !== "boolean" && on !== null) return { ok: false, error: "Choose on or off." };
  try {
    const q = await getQuote(String(quoteId || ""));
    if (!q) return { ok: false, error: ONLINE_COPY.gone };
    const saved = await setPackagePeakHeader(q.id, on === null || on === (await loadPeakHeaderDefault()) ? null : on);
    if (!saved) return { ok: false, error: ONLINE_COPY.gone };
    await clearPackageZipCache(q.id);
    return { ok: true };
  } catch (e) {
    console.error("[package] header choice failed", e);
    return { ok: false, error: PACKAGE_FILES_COPY.failed };
  }
}

/**
 * Spec 2026-10-16 §4, Generate from Grid: the drawing set can use up to 105 s of this request's 120 s
 * (GRID_SET_DEADLINE_MS), so the customer PDF is NOT rendered here — an after() render would inherit what is left.
 * The PDF is only marked out of date (a quick locked write: "Out of date" with Retry if nothing follows), and
 * `appendixMoved` tells the panel to start the render in a NEW request through the PDF's own Retry
 * (retryQuotePdfAction → pdfRetryPlan → scheduleQuotePdf), which gets the page's full budget.
 */
async function markStaleIfAppendixMoved(quoteId: string, beforeKey: string): Promise<{ pdf?: QuotePdfView; moved: boolean }> {
  try {
    const q = await getQuote(quoteId);
    if (!q || pdfAppendixKey(q) === beforeKey) return { moved: false };
    return { moved: true, pdf: (await markQuotePdfStale(q.id)) ?? undefined };
  } catch (e) {
    // The drawing write already landed — a failed re-read never reports it as failed (the PDF offers Retry).
    console.error("[package] PDF re-render check failed", quoteId, e);
    return { moved: false };
  }
}

/** D-j — "Generate from Grid". Runs under the Estimator page's maxDuration (120 s); one render with 25 s steps fits. */
export async function generateGridDrawingsAction(quoteId: string): Promise<{ ok: true; pdf?: QuotePdfView; appendixMoved?: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("send", user.roles)) return { ok: false, error: ONLINE_COPY.needsSend };
  try {
    const h = await headers();
    const where = printOriginFor(process.env, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"));
    if ("error" in where) return { ok: false, error: where.error };
    const before = pdfAppendixKey(await getQuote(String(quoteId || "")));
    const r = await generateGridDrawingSet(String(quoteId || ""), user.name, where.origin);
    if (!r.ok) return { ok: false, error: r.error };
    const { moved, pdf } = await markStaleIfAppendixMoved(String(quoteId || ""), before);
    return { ok: true, ...(pdf ? { pdf } : {}), ...(moved ? { appendixMoved: true as const } : {}) };
  } catch (e) {
    console.error("[package] generate from grid failed", e);
    return { ok: false, error: GRID_SET_COPY.failed };
  }
}
