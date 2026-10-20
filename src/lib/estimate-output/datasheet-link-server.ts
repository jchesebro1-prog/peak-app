import { getBlobStream } from "@/lib/blob";
import { attachmentDisposition, inlineDisposition } from "@/lib/document-files";
import { isDocumentId, type PartDocument } from "@/lib/part-docs/types";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { SHARE_DOC_PER_MIN } from "@/lib/quote-share/links";
import { get as getQuote, type Quote } from "@/lib/stores/quotes";
import { DATASHEET_LINK_QUOTE_MAX, verifyDatasheetLinkSig } from "./datasheet-link";
import { packageDocForSpec } from "./package-docs-server";

/**
 * Spec 2026-10-16 §5 — GET /d/ds/<quoteId>/<docId>/<sig>: no session (the
 * route is outside the team login, middleware.ts). Per-IP rate limit first,
 * then the signature, then the quote (a soft-deleted quote reads as missing)
 * and its CURRENT datasheet list (specPackageDocs with the live selection).
 * Every refusal is the same 404; a storage error is a 502 with no vendor
 * text. A PDF is served inline; anything else downloads, sandboxed.
 * Server-only; deps are seams for the spec harness.
 */

export type DatasheetLinkDeps = {
  secret: string;
  allow: (req: Request) => boolean;
  getQuote: (id: string) => Promise<Quote | null>;
  docFor: (q: Quote, docId: string) => Promise<PartDocument | null>;
  stream: (blobKey: string) => Promise<ReadableStream | null>;
};

const DATASHEET_ONLY: ReadonlySet<string> = new Set(["datasheet"]);
/** A fresh Response per call — a body can be read only once. */
const notFound = () => new Response("Not found", { status: 404 });

export async function serveEstimateDatasheet(req: Request, p: { quoteId: string; docId: string; sig: string }, deps: Partial<DatasheetLinkDeps> = {}): Promise<Response> {
  const allow = deps.allow ?? ((r: Request) => rateLimit("est-ds:" + (clientIp(r) || "unknown"), SHARE_DOC_PER_MIN, 60_000).ok);
  if (!allow(req)) return new Response("Too many requests", { status: 429 });
  const quoteId = typeof p?.quoteId === "string" ? p.quoteId : "";
  const docId = typeof p?.docId === "string" ? p.docId : "";
  const sig = typeof p?.sig === "string" ? p.sig : "";
  if (!quoteId || quoteId.length > DATASHEET_LINK_QUOTE_MAX || !isDocumentId(docId)) return notFound();
  if (!verifyDatasheetLinkSig(deps.secret ?? process.env.AUTH_SECRET ?? "", quoteId, docId, sig)) return notFound();
  let doc: PartDocument | null = null;
  try {
    const q = await (deps.getQuote ?? getQuote)(quoteId);
    if (!q) return notFound();
    doc = await (deps.docFor ?? ((qq: Quote, id: string) => packageDocForSpec(qq.spec, qq.packageSelection ?? null, id, DATASHEET_ONLY)))(q, docId);
  } catch (e) {
    // A DB error is the same uniform 404 as a bad link — never a 500 that tells a prober the link is real.
    console.warn("[ds-link] lookup failed", e instanceof Error ? e.message : e);
    return notFound();
  }
  if (!doc || !doc.blobKey) return notFound();
  let stream: ReadableStream | null;
  try {
    stream = await (deps.stream ?? ((k: string) => getBlobStream(k)))(doc.blobKey);
  } catch {
    // Never surface the vendor's own error text to the browser.
    return new Response("Couldn't read the file — try again", { status: 502 });
  }
  if (!stream) return notFound();
  const pdf = doc.contentType === "application/pdf";
  return new Response(stream, {
    headers: {
      "content-type": pdf ? "application/pdf" : "application/octet-stream",
      "content-disposition": pdf ? inlineDisposition(doc.fileName) : attachmentDisposition(doc.fileName),
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=300",
      ...(pdf ? {} : { "content-security-policy": "sandbox; default-src 'none'" }),
    },
  });
}
