"use server";

import { requireUser } from "@/lib/session";
import { readVendorPdf, type ReadVendorPdfInput, type ReadVendorPdfResult, type VendorPdfSource } from "@/lib/vendor-pdf/read-server";

/** Narrow the browser's payload to the input shape; anything malformed is refused by readVendorPdf's own checks. */
function coerce(input: unknown): ReadVendorPdfInput {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const s = (o.source && typeof o.source === "object" ? o.source : {}) as Record<string, unknown>;
  const source = (
    s.kind === "blob"
      ? { kind: "blob", blobPath: typeof s.blobPath === "string" ? s.blobPath : "" }
      : s.kind === "dataUrl"
        ? { kind: "dataUrl", dataUrl: typeof s.dataUrl === "string" ? s.dataUrl : "" }
        : { kind: "none" }
  ) as VendorPdfSource;
  return {
    vendorQuoteId: typeof o.vendorQuoteId === "string" ? o.vendorQuoteId : "",
    quoteId: typeof o.quoteId === "string" ? o.quoteId : null,
    source,
    hard: o.hard === true,
    retryOf: typeof o.retryOf === "string" ? o.retryOf : null,
  };
}

/** The deadline the model call must end by, from the action's start: under the Estimator page's maxDuration
 *  (120 s) with room for the run detail and checks after the call. Not exported: a "use server" file exports only
 *  async functions. */
const VENDOR_PDF_ACTION_BUDGET_MS = 108_000;
/** Less than this left for the call → refused before calling (couldNotRead), never a call cut off mid-read. */
const VENDOR_PDF_MIN_CALL_MS = 20_000;

/**
 * #348 slice 5 — Read the PDF (one click = one model call). Runs under the Estimator page's maxDuration (120 s):
 * the deadline is fixed at the action's start, so the time the gate, the Blob read and the page count took
 * shortens the call's timeout (the slot's 80 s / 95 s is the most it gets). Writes nothing but the Assist run row.
 */
export async function readVendorPdfAction(input: ReadVendorPdfInput): Promise<ReadVendorPdfResult> {
  const deadline = { at: Date.now() + VENDOR_PDF_ACTION_BUDGET_MS, hasFallback: false, minCallMs: VENDOR_PDF_MIN_CALL_MS };
  const me = await requireUser();
  return readVendorPdf(coerce(input), { id: me.id, name: me.name }, { deadline });
}
