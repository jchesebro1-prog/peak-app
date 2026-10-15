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

/**
 * #348 slice 5 — Read the PDF (one click = one model call). Runs under the Estimator page's maxDuration (120 s);
 * the Try-harder slot's worst case fits inside it. Writes nothing but the Assist run row.
 */
export async function readVendorPdfAction(input: ReadVendorPdfInput): Promise<ReadVendorPdfResult> {
  const me = await requireUser();
  return readVendorPdf(coerce(input), { id: me.id, name: me.name });
}
