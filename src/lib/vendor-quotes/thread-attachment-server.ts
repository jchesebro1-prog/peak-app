/* #348 slice 4 — the attachment broker's read half: one attachment's bytes off an email thread, for anyone who can
   SEE the thread (#341 canSeeThread — own, assigned or deliberately linked). Visibility is checked before anything
   else, and a missing thread answers exactly like an invisible one. Bytes come from the stored data-URL, Gmail (by the
   stored part id — never stored on import), or the quote / assessment PDF store. Server-only. */
import { dataUrlToBytes, putBlob, safeName } from "@/lib/blob";
import { VENDOR_QUOTE_BLOB_PREFIX, VENDOR_QUOTE_ID_RE, ownsVendorQuoteBlobPath } from "@/lib/vendor-quote-file";
import { gmailEnabled } from "@/lib/gmail/config";
import { readPdfForThread } from "@/lib/thread-pdf-read";
import { readMailRefForThread } from "@/lib/mail-attachments-server";
import { canSeeThread, get as getThread, type CommAttachment, type CommThread, type MailboxViewer } from "@/lib/stores/comms";
import { VENDOR_COPY, VENDOR_FROM_EMAIL_MAX_BYTES, type ThreadAttachmentRef } from "./rules";

export type ThreadAttachmentRead =
  | { ok: true; thread: CommThread; att: CommAttachment; bytes: Buffer; name: string; mime: string }
  | { ok: false; error: string };

const fail = (error: string): ThreadAttachmentRead => ({ ok: false, error });

export async function readThreadAttachment(
  ref: ThreadAttachmentRef,
  viewer: MailboxViewer,
  opts: { maxBytes?: number; vendorPdf?: boolean } = {}
): Promise<ThreadAttachmentRead> {
  // 1 — visibility first: missing and invisible are the same answer (no oracle)
  const t = await getThread(ref.threadId);
  if (!t || !canSeeThread(t, viewer)) return fail(VENDOR_COPY.notAvailable);
  // 2 — the message must be on THIS thread, and the attachment on that message
  const m = (t.messages || []).find((x) => x.id === ref.messageId);
  const att = m ? (m.attachments || [])[ref.index] : undefined;
  if (!m || !att) return fail(VENDOR_COPY.notOnEmail);
  // 3 — our own estimate PDF (by reference) is never a vendor quote
  if (opts.vendorPdf && att.pdfPath) return fail(VENDOR_COPY.notVendorPdf);
  // 4 — the stored size, before any fetch
  const max = opts.maxBytes ?? VENDOR_FROM_EMAIL_MAX_BYTES;
  if ((att.size || 0) > max) return fail(VENDOR_COPY.tooBig);
  // 5 — the bytes
  let bytes: Buffer | null = null;
  let mime = att.mime || "";
  if (att.dataUrl) {
    try {
      const d = dataUrlToBytes(att.dataUrl);
      bytes = d.bytes;
      mime = mime || d.mime;
    } catch {
      return fail(VENDOR_COPY.copyFailed);
    }
  } else if (att.fwdFrom && att.gmailPartId) {
    // #356 review — a forwarded Gmail attachment: read from its source message (same-mailbox checked)
    try {
      bytes = await readMailRefForThread(att, t);
    } catch {
      bytes = null;
    }
    if (!bytes) return fail(VENDOR_COPY.copyFailed);
  } else if (att.gmailPartId) {
    if (!gmailEnabled()) return fail(VENDOR_COPY.noGmail);
    try {
      // Lazy import — the bridge (and the Gmail client) only loads when the env gate is on.
      const { fetchMessageAttachment } = await import("@/lib/gmail/bridge");
      const r = await fetchMessageAttachment(t.id, m.id, att.gmailPartId, max);
      if (!Buffer.isBuffer(r)) return fail(r.error === "too-big" ? VENDOR_COPY.tooBig : VENDOR_COPY.copyFailed);
      bytes = r;
    } catch (err) {
      console.error("[vendor-quotes] Gmail attachment read failed", t.id, m.id, err);
      return fail(VENDOR_COPY.copyFailed);
    }
  } else if (att.pdfPath) {
    try {
      // The same guarded reader the send path uses: quote PDFs only on that quote's thread, assessment reports only on
      // that customer's (or an unlinked) thread; a refused path reads as missing.
      bytes = await readPdfForThread(att.pdfPath, t);
    } catch {
      bytes = null;
    }
    if (!bytes) return fail(VENDOR_COPY.copyFailed);
    mime = mime || "application/pdf";
  } else if (att.blobPath || att.documentId) {
    // Batch 6 #64 — a composer upload / a document, read by reference with the send path's own checks.
    try {
      bytes = await readMailRefForThread(att, t);
    } catch {
      bytes = null;
    }
    if (!bytes) return fail(VENDOR_COPY.copyFailed);
  }
  if (!bytes) return fail(VENDOR_COPY.copyFailed);
  // 6 — the fetched bytes, again
  if (bytes.length > max) return fail(VENDOR_COPY.tooBig);
  return { ok: true, thread: t, att, bytes, name: att.name || "attachment", mime: mime || "application/octet-stream" };
}

/** The copy half: write fetched bytes to private Blob at `vendor-quotes/<vqId>-<safeName>` (the shape
 *  `ownsVendorQuoteBlobPath` admits). putBlob adds a random suffix, so the RETURNED pathname is the only one that
 *  resolves — never the requested one. */
export async function copyToVendorQuoteBlob(vqId: string, name: string, mime: string, bytes: Buffer): Promise<{ blobPath: string }> {
  if (!VENDOR_QUOTE_ID_RE.test(vqId)) throw new Error("Bad vendor quote id.");
  const stored = await putBlob(`${VENDOR_QUOTE_BLOB_PREFIX}${vqId}-${safeName(name || "quote.pdf")}`, bytes, mime || "application/pdf");
  // A name that slipped a ".." (or any shape the owner check refuses) fails here, not later at read time.
  if (!ownsVendorQuoteBlobPath(stored.pathname, vqId)) throw new Error("The stored file path isn't a valid vendor quote path.");
  return { blobPath: stored.pathname };
}
