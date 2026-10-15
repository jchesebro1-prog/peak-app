/**
 * #348 slice 5 — Read the PDF, server side: one click = one runAssist call over the vendor quote's own PDF.
 *
 * Bytes come only from (a) a Blob path this vendor quote owns (`ownsVendorQuoteBlobPath`), sized by `head()`
 * before the body is read, or (b) a `data:application/pdf;base64,` data URL (dev with Blob off). A client-named
 * URL is never fetched. The gate runs before any byte is read; size, `%PDF-` and page guards run before the call.
 *
 * Request-scope free (the server action owns requireUser) so the DB checks can drive it with fake providers.
 */
import { createHash } from "node:crypto";
import { VENDOR_ATTACHMENT_BUDGET } from "@/app/(app)/estimator/types";
import { dataUrlToBytes, getBlobBytes } from "@/lib/blob";
import { VENDOR_QUOTE_ID_RE, ownsVendorQuoteBlobPath } from "@/lib/vendor-quote-file";
import { isVendorPickerType } from "@/lib/vendor-quotes/rules";
import { vendorPdfGateFor } from "@/lib/assist/gate-server";
import { runAssist, type AssistCallDeps } from "@/lib/assist/run";
import { splitCallDeps } from "@/lib/assist/reply-server";
import { getRun, mergeRunDetail, setRunOutcome } from "@/lib/stores/assist-runs";
import { partsByLooseKeys } from "@/lib/stores/catalog";
import { allCompanies } from "@/lib/identity/companies";
import {
  VENDOR_PDF_COPY, VENDOR_PDF_MAX_FILE_BYTES, VENDOR_PDF_MAX_PAGES, VENDOR_PDF_SYSTEM, VENDOR_PDF_USER_TEXT, VendorPdfWire,
  canonicalJson, cleanExtraction, isEmptyExtraction,
} from "./extraction";
import { capTruncatedMatches, catalogLookupKeys, vendorPdfChecks, type CatalogKeyTruncation, type CatalogMatchPart, type VendorCompanyLike } from "./checks";
import type { VendorPdfReadResult } from "./fill";
import { countPdfPages } from "./pages-server";

export type VendorPdfSource = { kind: "blob"; blobPath: string } | { kind: "dataUrl"; dataUrl: string };
export type ReadVendorPdfInput = { vendorQuoteId: string; quoteId: string | null; source: VendorPdfSource; hard: boolean; retryOf: string | null };
export type ReadVendorPdfResult =
  | ({ ok: true } & VendorPdfReadResult)
  | { ok: false; error: string; tooLarge?: boolean; runId: string | null };

export const VENDOR_PDF_DATA_URL_PREFIX = "data:application/pdf;base64,";
/** A data URL longer than this can't have come from the form (its per-estimate attachment budget). */
export const VENDOR_PDF_DATA_URL_MAX = VENDOR_ATTACHMENT_BUDGET + 200;
export const VENDOR_PDF_RUN_ID_RE = /^AR-[a-z0-9]{1,16}-[a-z0-9]{1,8}$/;
export const VENDOR_PDF_QUOTE_ID_MAX = 64;

type Bytes = { ok: true; bytes: Buffer } | { ok: false; error: string; tooLarge?: boolean };

/** The vendor quote's PDF bytes, or the user-facing refusal. Never fetches a URL. */
export async function loadVendorPdfBytes(vendorQuoteId: string, source: VendorPdfSource): Promise<Bytes> {
  let bytes: Buffer;
  if (source.kind === "blob") {
    if (!ownsVendorQuoteBlobPath(source.blobPath, vendorQuoteId)) return { ok: false, error: VENDOR_PDF_COPY.notThisFile };
    const got = await getBlobBytes(source.blobPath, VENDOR_PDF_MAX_FILE_BYTES);
    if (!got.ok) return got.reason === "too-large" ? { ok: false, error: VENDOR_PDF_COPY.tooLargeBytes, tooLarge: true } : { ok: false, error: VENDOR_PDF_COPY.fileMissing };
    bytes = got.bytes;
  } else if (source.kind === "dataUrl") {
    const url = typeof source.dataUrl === "string" ? source.dataUrl : "";
    if (!url.startsWith(VENDOR_PDF_DATA_URL_PREFIX)) return { ok: false, error: VENDOR_PDF_COPY.notPdf };
    if (url.length > VENDOR_PDF_DATA_URL_MAX) return { ok: false, error: VENDOR_PDF_COPY.tooLargeBytes, tooLarge: true };
    try {
      bytes = dataUrlToBytes(url).bytes;
    } catch {
      return { ok: false, error: VENDOR_PDF_COPY.notPdf };
    }
  } else {
    return { ok: false, error: VENDOR_PDF_COPY.badRequest };
  }
  if (!bytes.subarray(0, 1024).includes("%PDF-")) return { ok: false, error: VENDOR_PDF_COPY.notPdf };
  if (bytes.length > VENDOR_PDF_MAX_FILE_BYTES) return { ok: false, error: VENDOR_PDF_COPY.tooLargeBytes, tooLarge: true };
  return { ok: true, bytes };
}

/** runAssist's error → the copy the modal shows. Gate / cap / rate-limit / key texts pass through. */
export function vendorPdfErrorFor(error: string): { error: string; tooLarge?: boolean } {
  if (error === "too long") return { error: VENDOR_PDF_COPY.tooManyLines };
  if (/^request rejected:.*(page|too large|exceed|size)/i.test(error)) return { error: VENDOR_PDF_COPY.tooLargeBytes, tooLarge: true };
  if (error.startsWith("request rejected:")) return { error: VENDOR_PDF_COPY.rejected };
  if (error === "unreadable answer" || error === "empty answer" || error === "declined") return { error: VENDOR_PDF_COPY.couldNotRead };
  return { error };
}

function validInput(input: ReadVendorPdfInput): boolean {
  if (!input || typeof input !== "object") return false;
  if (typeof input.vendorQuoteId !== "string" || !VENDOR_QUOTE_ID_RE.test(input.vendorQuoteId)) return false;
  if (input.quoteId !== null && (typeof input.quoteId !== "string" || input.quoteId.length > VENDOR_PDF_QUOTE_ID_MAX)) return false;
  if (input.retryOf !== null && (typeof input.retryOf !== "string" || !VENDOR_PDF_RUN_ID_RE.test(input.retryOf))) return false;
  if (typeof input.hard !== "boolean") return false;
  const k = input.source && typeof input.source === "object" ? input.source.kind : null;
  return k === "blob" || k === "dataUrl";
}

async function liveVendorCompanies(): Promise<VendorCompanyLike[]> {
  return (await allCompanies()).filter((c) => !c.deleted && isVendorPickerType(c.type)).map((c) => ({ id: c.id, name: c.name, type: c.type }));
}

/** The catalog candidates for a read (deps.loadParts in tests). */
export type VendorPdfPartsLookup = { parts: CatalogMatchPart[]; truncated: Record<string, CatalogKeyTruncation> };
export type ReadVendorPdfDeps = AssistCallDeps & {
  parts?: CatalogMatchPart[];
  companies?: VendorCompanyLike[];
  /** Test seams for the two loads (defaults: the live vendor companies; partsByLooseKeys). */
  loadCompanies?: () => Promise<VendorCompanyLike[]>;
  loadParts?: (keys: string[]) => Promise<VendorPdfPartsLookup>;
};

function logFailure(what: string, e: unknown): void {
  console.error(`[vendor-pdf] ${what}:`, e instanceof Error ? e.message : e);
}

/** Best-effort write: a failure is logged, never thrown — the paid read still reaches the user. */
async function tryWrite(what: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    logFailure(what, e);
  }
}

export async function readVendorPdf(
  input: ReadVendorPdfInput,
  me: { id: string; name: string },
  deps: ReadVendorPdfDeps = {}
): Promise<ReadVendorPdfResult> {
  // 1. Gate — before any byte is read.
  const refused = await vendorPdfGateFor(me.id, deps);
  if (refused) return { ok: false, error: refused, runId: null };
  // Past the gate, nothing throws out of here: an outage reads as couldNotRead (with the run, when one was made).
  const ran: { runId: string | null } = { runId: null };
  try {
    return await readAfterGate(input, me, deps, ran);
  } catch (e) {
    logFailure("read failed", e);
    return { ok: false, error: VENDOR_PDF_COPY.couldNotRead, runId: ran.runId };
  }
}

async function readAfterGate(
  input: ReadVendorPdfInput,
  me: { id: string; name: string },
  deps: ReadVendorPdfDeps,
  ran: { runId: string | null }
): Promise<ReadVendorPdfResult> {
  // 2. Validate.
  if (!validInput(input)) return { ok: false, error: VENDOR_PDF_COPY.badRequest, runId: null };
  const { vendorQuoteId, quoteId, hard, retryOf } = input;
  // 3–4. Bytes, %PDF-, size.
  const loaded = await loadVendorPdfBytes(vendorQuoteId, input.source);
  if (!loaded.ok) return { ok: false, error: loaded.error, ...(loaded.tooLarge ? { tooLarge: true } : {}), runId: null };
  const bytes = loaded.bytes;
  // 5. Pages.
  const pages = await countPdfPages(bytes);
  if (pages !== null && pages > VENDOR_PDF_MAX_PAGES) return { ok: false, error: VENDOR_PDF_COPY.tooLargePages(pages), tooLarge: true, runId: null };

  // 6. The call; the company load overlaps it and can't sink it (a failed load = no vendor match). The catalog
  //    read needs the printed part numbers, so it follows.
  const slot = hard ? "vendorpdfHard" : "vendorpdf";
  const now = deps.now ?? Date.now();
  const split = splitCallDeps({ ...deps, now }, slot);
  // Too little of the caller's deadline left for a real call (the action's 108 s, less the gate, bytes and pages):
  // refused before calling — no run, no charge.
  if (!split) return { ok: false, error: VENDOR_PDF_COPY.couldNotRead, runId: null };
  const companiesLoad: Promise<VendorCompanyLike[]> = deps.companies
    ? Promise.resolve(deps.companies)
    : (deps.loadCompanies ?? liveVendorCompanies)().catch((e: unknown) => {
        logFailure("vendor companies load failed", e);
        return [];
      });
  const [r, companies] = await Promise.all([
    runAssist(
      {
        feature: "vendorpdf",
        slot,
        user: { id: me.id, name: me.name },
        system: VENDOR_PDF_SYSTEM,
        userText: VENDOR_PDF_USER_TEXT,
        schema: VendorPdfWire,
        document: { base64: bytes.toString("base64") },
        contextRef: `vendorquote:${quoteId ?? "new"}:${vendorQuoteId}`,
        ...split.call,
      },
      split.run
    ),
    companiesLoad,
  ]);
  ran.runId = r.runId;
  const base = { vendorQuoteId, quoteId, hard, retryOf, pages, bytes: bytes.length };
  // 7. Failure → copy. A logged failed run still gets its detail (the report counts failed Try-harder runs).
  if (!r.ok) {
    const runId = r.runId;
    if (runId) await tryWrite("run detail", () => mergeRunDetail(runId, base));
    return { ok: false, ...vendorPdfErrorFor(r.error), runId };
  }
  const runId = r.runId;
  // 8. Clean; an empty read stays logged with a null outcome.
  const data = cleanExtraction(r.value);
  if (isEmptyExtraction(data)) {
    await tryWrite("run detail", () => mergeRunDetail(runId, { ...base, lines: 0, mathFlags: 0, empty: true }));
    return { ok: false, error: VENDOR_PDF_COPY.noQuote, runId };
  }
  // 9. Checks — the catalog is read only for the candidates of this read's part numbers. A failed catalog read
  //    still returns the read, its checks run against no parts (no catalog chips).
  let lookup: VendorPdfPartsLookup = { parts: [], truncated: {} };
  if (deps.parts) lookup = { parts: deps.parts, truncated: {} };
  else {
    try {
      lookup = await (deps.loadParts ?? partsByLooseKeys)(catalogLookupKeys(data));
    } catch (e) {
      logFailure("catalog lookup failed", e);
    }
  }
  const checks = capTruncatedMatches(vendorPdfChecks(data, { parts: lookup.parts, companies }), data, lookup.truncated);
  // 10. Run detail.
  await tryWrite("run detail", () =>
    mergeRunDetail(runId, {
      ...base,
      lines: data.lines?.length ?? 0,
      mathFlags: checks.mathFlags,
      dataHash: createHash("sha256").update(canonicalJson(data)).digest("hex"),
    })
  );
  // 11. A read over an earlier read of THIS vendor quote (Read again or Try harder) replaces it: discarded unless it
  //     already has a score (first write wins). Another user's run, or a run for another vendor quote, is left alone.
  if (retryOf) {
    await tryWrite("discard earlier read", async () => {
      const prev = await getRun(retryOf);
      const prevVq = (prev?.outcomeDetail as Record<string, unknown> | null | undefined)?.vendorQuoteId;
      if (prev?.feature === "vendorpdf" && prev.userId === me.id && prevVq === vendorQuoteId) {
        await setRunOutcome(retryOf, me.id, "discarded", { replacedBy: runId });
      }
    });
  }
  // 12.
  return { ok: true, runId, model: r.model, hard, at: now, data, checks, pages };
}
