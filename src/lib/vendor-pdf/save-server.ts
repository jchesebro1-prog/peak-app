/**
 * #348 slice 5 — Read the PDF, at estimate save: which `VendorQuote.extracted` survives, and the one-time score.
 *
 * The browser's `extracted` is never trusted on its own. A read is kept only when the run row vouches for it (a
 * successful `vendorpdf` run read for THIS vendor quote whose stored hash matches the data), and `model` / `at`
 * always come from that row. The first save that keeps a run scores it (accuracy is scored once — Jeff 2026-10-15);
 * every later save carries the stored copy forward unchanged.
 *
 * Never fails a save: a refused read is dropped with a console.warn, a failed score is logged.
 */
import { createHash } from "node:crypto";
import type { VendorQuote, VendorQuoteExtracted, VendorQuoteLine } from "@/app/(app)/estimator/types";
import { getRun, setVendorPdfOutcome, type AssistRun } from "@/lib/stores/assist-runs";
import { VendorPdfExtractionSchema, canonicalJson } from "./extraction";
import { vendorPdfDiff, vendorPdfOutcome } from "./diff";
import { VENDOR_PDF_RUN_ID_RE } from "./read-server";

export type VendorPdfStamp = { runId: string; vendorQuoteId: string };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** No read: the `extracted` key removed and every line's extractedIndex stripped (the lines stay, now typed). */
function withoutRead<T extends VendorQuote>(vq: T): T {
  const out = { ...vq };
  delete out.extracted;
  if (Array.isArray(vq.lines)) {
    out.lines = vq.lines.map((l) => {
      if (!l || typeof l !== "object" || !("extractedIndex" in l)) return l;
      const { extractedIndex: _i, ...rest } = l;
      void _i;
      return rest as VendorQuoteLine;
    });
  }
  return out;
}

/** A kept read: extractedIndex survives only as an integer in [0, data.lines.length). */
function withRead<T extends VendorQuote>(vq: T, extracted: VendorQuoteExtracted): T {
  const n = extracted.data.lines?.length ?? 0;
  const lines = Array.isArray(vq.lines)
    ? vq.lines.map((l) => {
        if (!l || typeof l !== "object" || !("extractedIndex" in l)) return l;
        const i = l.extractedIndex;
        if (typeof i === "number" && Number.isInteger(i) && i >= 0 && i < n) return l;
        const { extractedIndex: _i, ...rest } = l;
        void _i;
        return rest as VendorQuoteLine;
      })
    : vq.lines;
  return { ...vq, lines, extracted };
}

/** The prior stored copy, when it is a well-formed read (it was verified when it was first saved). */
function storedRead(prior: VendorQuote | undefined): VendorQuoteExtracted | null {
  const x = prior?.extracted;
  if (!x || typeof x !== "object" || typeof x.runId !== "string" || !x.data || typeof x.data !== "object") return null;
  return { runId: x.runId, model: x.model, at: x.at, data: x.data };
}

/**
 * Never trusts the browser's `extracted`:
 *  - absent/null → removed, and every line's extractedIndex stripped;
 *  - same runId as the prior stored copy → the PRIOR copy (data, model, at) is kept;
 *  - otherwise kept only when VendorPdfExtractionSchema parses `data`, getRun(runId) is a `vendorpdf` run with
 *    ok === true, outcomeDetail.vendorQuoteId === vq.id and outcomeDetail.dataHash === sha256(canonicalJson(parsed));
 *    then { runId, model: run.model, at: run.createdAt, data: parsed } and the stamp is `fresh`;
 *  - else removed (console.warn, never a save failure).
 * Kept quotes: extractedIndex survives only as an integer in [0, data.lines.length).
 */
export async function verifyVendorPdfExtractions<T extends VendorQuote>(
  prior: readonly VendorQuote[],
  next: readonly T[]
): Promise<{ vendorQuotes: T[]; fresh: VendorPdfStamp[] }> {
  const priorById = new Map<string, VendorQuote>();
  for (const p of prior) if (p && typeof p.id === "string") priorById.set(p.id, p);
  const runs = new Map<string, Promise<AssistRun | null>>();
  const runOf = (id: string) => {
    let p = runs.get(id);
    if (!p) { p = getRun(id); runs.set(id, p); }
    return p;
  };
  const vendorQuotes: T[] = [];
  const fresh: VendorPdfStamp[] = [];
  for (const vq of next) {
    const x = vq?.extracted as unknown;
    if (x === undefined || x === null) { vendorQuotes.push(withoutRead(vq)); continue; }
    const refuse = (why: string) => {
      console.warn(`[vendor-pdf] save dropped the read on vendor quote ${String(vq.id).slice(0, 40)}: ${why}`);
      vendorQuotes.push(withoutRead(vq));
    };
    try {
      const runId = x && typeof x === "object" ? (x as { runId?: unknown }).runId : undefined;
      if (typeof runId !== "string" || !VENDOR_PDF_RUN_ID_RE.test(runId)) { refuse("no valid run id"); continue; }
      const kept = storedRead(priorById.get(vq.id));
      if (kept && kept.runId === runId) { vendorQuotes.push(withRead(vq, kept)); continue; }
      const parsed = VendorPdfExtractionSchema.safeParse((x as { data?: unknown }).data);
      if (!parsed.success) { refuse("data does not parse"); continue; }
      const run = await runOf(runId);
      const detail = (run?.outcomeDetail ?? {}) as Record<string, unknown>;
      if (!run || run.feature !== "vendorpdf" || run.ok !== true) { refuse("no successful Read-the-PDF run"); continue; }
      if (detail.vendorQuoteId !== vq.id) { refuse("the run read another vendor quote"); continue; }
      if (typeof detail.dataHash !== "string" || detail.dataHash !== sha256(canonicalJson(parsed.data))) { refuse("data does not match the run"); continue; }
      vendorQuotes.push(withRead(vq, { runId, model: run.model, at: run.createdAt, data: parsed.data }));
      fresh.push({ runId, vendorQuoteId: vq.id });
    } catch (e) {
      refuse(e instanceof Error ? e.message : "verification failed");
    }
  }
  return { vendorQuotes, fresh };
}

/**
 * After the write: for each fresh stamp still on the saved estimate, diff → setVendorPdfOutcome(runId,
 * vendorPdfOutcome(diff), { quoteId, vendorQuoteId, vendor, vendorCompanyId, diff }). Logs, never throws.
 */
export async function recordVendorPdfOutcomes(fresh: readonly VendorPdfStamp[], saved: readonly VendorQuote[], quoteId: string): Promise<void> {
  for (const stamp of fresh) {
    try {
      const vq = saved.find((v) => v?.id === stamp.vendorQuoteId);
      if (!vq || vq.extracted?.runId !== stamp.runId) continue;
      const diff = vendorPdfDiff(vq.extracted.data, { lines: Array.isArray(vq.lines) ? vq.lines : [], total: Number(vq.total) || 0, totalSource: vq.totalSource });
      await setVendorPdfOutcome(stamp.runId, vendorPdfOutcome(diff), {
        quoteId,
        vendorQuoteId: vq.id,
        vendor: typeof vq.vendor === "string" ? vq.vendor : "",
        vendorCompanyId: vq.vendorCompanyId ?? null,
        diff,
      });
    } catch (e) {
      console.error("[vendor-pdf] scoring a read at save failed", stamp.runId, e instanceof Error ? e.message : e);
    }
  }
}
