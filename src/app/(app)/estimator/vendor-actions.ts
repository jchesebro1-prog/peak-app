"use server";

/**
 * #348 slice 4 — the Inbox → Estimator hand-off (`?vq=`): prefill a vendor quote form from a PDF on an email.
 *
 * Only ids ride the URL; this action re-checks everything. `readThreadAttachment` checks the viewer can SEE the thread
 * (#341 canSeeThread — a missing thread and an invisible one get the same answer) and refuses our own estimate PDFs
 * (`vendorPdf: true`). The bytes never pass through the browser: they are copied server-side into private Blob under
 * the vendor quote's own id, or — with Blob off (dev) — returned as a data-URL only when it fits what is left of the
 * estimate's VENDOR_ATTACHMENT_BUDGET. Permission: `requireUser` (the vendor upload route's rule and the Estimator
 * save's — any estimator must be able to attach a vendor quote).
 */
import { requireUser } from "@/lib/session";
import { mailboxViewer } from "@/lib/mailbox-viewer";
import { getCompany } from "@/lib/identity/companies";
import { get as getQuote } from "@/lib/stores/quotes";
import { blobEnabled } from "@/lib/blob";
import { VENDOR_QUOTE_ID_RE } from "@/lib/vendor-quote-file";
import { copyToVendorQuoteBlob, readThreadAttachment } from "@/lib/vendor-quotes/thread-attachment-server";
import {
  VENDOR_COPY,
  isVendorPickerType,
  parseThreadAttachmentRef,
  quoteNumberFromSubject,
  threadAttachmentHref,
} from "@/lib/vendor-quotes/rules";
import type { VendorPrefill } from "@/lib/vendor-quotes/vm";
import { VENDOR_ATTACHMENT_BUDGET } from "./types";

export async function vendorQuoteFromThreadAction(input: {
  quoteId: string;
  ref: string;
  vendorQuoteId: string;
  attachedChars: number;
}): Promise<{ ok: true; prefill: VendorPrefill } | { ok: false; error: string }> {
  const user = await requireUser();
  // 1 — validate (the URL and the browser are untrusted)
  const ref = parseThreadAttachmentRef(input?.ref);
  if (!ref) return { ok: false, error: VENDOR_COPY.notOnEmail };
  const vendorQuoteId = typeof input?.vendorQuoteId === "string" ? input.vendorQuoteId : "";
  if (!VENDOR_QUOTE_ID_RE.test(vendorQuoteId)) return { ok: false, error: "Bad vendor quote id." };
  const quoteId = typeof input?.quoteId === "string" ? input.quoteId : "";
  if (!quoteId || !(await getQuote(quoteId))) return { ok: false, error: "That estimate wasn't found." };
  const rawChars = Number(input?.attachedChars);
  const attachedChars = Number.isFinite(rawChars) ? Math.min(VENDOR_ATTACHMENT_BUDGET, Math.max(0, rawChars)) : 0;

  // 2 — visibility + the bytes (never our own estimate PDF)
  const r = await readThreadAttachment(ref, await mailboxViewer(user), { vendorPdf: true });
  if (!r.ok) return r;

  // 3 — the vendor: the thread's company when it is a vendor company, else the name only
  const co = r.thread.customerId ? await getCompany(r.thread.customerId) : null;
  const vendorCompanyId = co && isVendorPickerType(co.type) ? co.id : null;
  const vendor = co?.name || r.thread.customer || r.thread.contactName || "";

  // 4 — the vendor's quote number, when the subject makes it obvious
  const quoteNumber = quoteNumberFromSubject(r.thread.subject);

  // 5 — the file: Blob under the vendor quote's own id, else a data-URL that fits the estimate's budget
  let attachment: VendorPrefill["attachment"] = null;
  let note = "";
  if (blobEnabled()) {
    try {
      const { blobPath } = await copyToVendorQuoteBlob(vendorQuoteId, r.name, r.mime, r.bytes);
      attachment = { name: r.name, mime: r.mime, blobPath };
    } catch (err) {
      console.error("[vendor-quotes] copy to Blob failed", ref.threadId, err);
      note = VENDOR_COPY.copyFailed;
    }
  } else {
    const dataUrl = `data:${r.mime};base64,${r.bytes.toString("base64")}`;
    if (dataUrl.length <= VENDOR_ATTACHMENT_BUDGET - attachedChars) attachment = { name: r.name, mime: r.mime, dataUrl };
    else note = VENDOR_COPY.noRoom;
  }

  // 6 — the email's own download route previews the file until the estimate is saved
  return {
    ok: true,
    prefill: {
      vendorCompanyId,
      vendor,
      quoteNumber,
      attachment,
      preview: threadAttachmentHref(ref),
      fromThreadId: ref.threadId,
      note,
    },
  };
}
