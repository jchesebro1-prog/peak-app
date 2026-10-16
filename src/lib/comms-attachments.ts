/**
 * Estimator Phase 3 fix round 1 — how a comms attachment is resolved. An
 * attachment carries its bytes (`dataUrl`, IDEAS #36) or a reference
 * (`pdfPath` + `href`) — the estimate PDF is never copied into the thread.
 * Pure: the storage read is injected (the Gmail bridge passes
 * pdfStorage().read; the harness passes a fake).
 */

export type ResolvableAttachment = {
  name?: string;
  mime?: string;
  dataUrl?: string;
  pdfPath?: string;
  href?: string;
  /** Batch 6 #64 — a composer upload / a Documents record, by reference (lib/mail-attachments.ts). */
  blobPath?: string;
  documentId?: string;
};

/** A same-origin path (`/…`, never `//host` or `/\\host`). */
function isLocalHref(h: unknown): h is string {
  return typeof h === "string" && h.startsWith("/") && !h.startsWith("//") && !h.startsWith("/\\");
}

/** The Inbox reader's download link: the data-URL when the bytes ride along,
 *  else the team download URL; "" when there is neither. */
export function attachmentHref(a: ResolvableAttachment): string {
  if (a.dataUrl) return a.dataUrl;
  return isLocalHref(a.href) ? a.href : "";
}

export type MimeAttachment = { name: string; mime: string; dataBase64: string };

/**
 * One attachment as a raw base64 MIME part for the Gmail bridge. A data-URL
 * that isn't base64 is skipped (null), exactly as before; a by-reference
 * PDF is read from storage and a missing one THROWS — the email must not go
 * out quietly without the estimate it says is attached.
 */
export async function attachmentMimePart(
  a: ResolvableAttachment,
  readPdf: (path: string) => Promise<Buffer | null>,
  /** Batch 6 #64 — reads a composer upload / a document (mail-attachments-server readMailRefForThread). A missing or
   *  refused one THROWS, like a missing PDF: the email never goes out without a file it lists. */
  readRef?: (a: ResolvableAttachment) => Promise<Buffer | null>
): Promise<MimeAttachment | null> {
  const name = a.name || "attachment";
  if (a.dataUrl) {
    const comma = a.dataUrl.indexOf(",");
    if (comma < 0 || !/;base64,/.test(a.dataUrl)) return null;
    return { name, mime: a.mime || "application/octet-stream", dataBase64: a.dataUrl.slice(comma + 1) };
  }
  if (a.pdfPath) {
    const bytes = await readPdf(a.pdfPath);
    if (!bytes || !bytes.length) throw new Error(`attachment ${name} could not be read from storage`);
    return { name, mime: a.mime || "application/pdf", dataBase64: bytes.toString("base64") };
  }
  if (a.blobPath || a.documentId) {
    const bytes = readRef ? await readRef(a) : null;
    if (!bytes || !bytes.length) throw new Error(`attachment ${name} could not be read from storage`);
    return { name, mime: a.mime || "application/octet-stream", dataBase64: bytes.toString("base64") };
  }
  return null;
}

/** Batch 6 #64 — Gmail's 25 MB cap, before base64: the attachment bytes one outbound message may carry. */
export const OUTBOUND_ATTACH_MAX_BYTES = 25 * 1024 * 1024;

/** Refusal when the decoded attachments of one message are over the cap (never sent), else null. */
export function outboundAttachError(parts: ReadonlyArray<{ dataBase64: string }>): string | null {
  const bytes = parts.reduce((s, p) => s + Math.floor((p.dataBase64.replace(/=+$/, "").length * 3) / 4), 0);
  return bytes > OUTBOUND_ATTACH_MAX_BYTES ? "attachments are over 25 MB together" : null;
}

/**
 * Fix round 2 (defence in depth) — on a thread linked to a quote, a
 * by-reference PDF must live under THAT quote's folder
 * (`quote-pdfs/<sanitized id>/…`, quote-pdf/state.ts pdfStoragePath). Any
 * other thread is left to the storage guard alone.
 */
export function pdfPathFitsLink(path: string, link?: { type?: string | null; id?: string | null } | null): boolean {
  if (link?.type !== "quote") return true;
  const id = String(link.id ?? "").replace(/[^A-Za-z0-9_-]/g, "_");
  return !!id && typeof path === "string" && path.startsWith(`quote-pdfs/${id}/`) && !path.includes("..");
}
