"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getOptionalUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getAssessment } from "@/lib/stores/assessments";
import { saveDraft, type CommAttachment } from "@/lib/stores/comms";
import { getCompany } from "@/lib/identity/companies";
import { getSite } from "@/lib/identity/sites";
import { renderAssessmentPdf } from "@/lib/assessments/report-pdf-server";
import { siteDisplayName } from "@/lib/assessments/report-data";
import { emailAttachmentMode, reportEmailCopy } from "@/lib/assessments/report-model";
import { assessmentPdfAttachment } from "@/lib/assessments/report-pdf-path";
import { storeAssessmentPdf } from "@/lib/assessments/report-pdf-storage";
import { blobEnabled } from "@/lib/blob";

export type EmailReportReply = { ok: false; error: string };

/**
 * Email report (#340 Task 10): render the assessment report PDF (the same render Download PDF serves) and attach it —
 * with Blob, stored at `assessment-pdfs/<id>/<ms>.pdf` and attached BY REFERENCE (≤ 10 MB; the Gmail bridge streams
 * it from Blob when sending); without Blob (local dev), inline as a data URL (≤ 1.5 MB) — then land a draft in the
 * sender's own mailbox linked to the customer and addressed to the primary contact, and open it in the Inbox
 * composer. Needs `send`. Refusals come back as `{ ok: false, error }`; success redirects.
 */
export async function emailAssessmentReportAction(id: string): Promise<EmailReportReply> {
  const user = await getOptionalUser();
  if (!user) return { ok: false, error: "Sign in again to email the report." };
  if (!can("send", user.roles)) return { ok: false, error: "You don't have permission to send email." };
  const a = typeof id === "string" ? await getAssessment(id) : null;
  if (!a) return { ok: false, error: "Assessment not found" };
  const h = await headers();
  const r = await renderAssessmentPdf(a.id, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"));
  if (!r.ok) return { ok: false, error: r.error };
  // Blob: stored and attached by reference (a multi-MB base64 PDF never sits in a comms doc — navData reads every
  // comms doc on every page). No Blob (local dev): inline, 1.5 MB at most (#340 final review I2).
  const plan = emailAttachmentMode(r.pdf.length, blobEnabled());
  if (plan.mode === "refuse") return { ok: false, error: plan.error };
  const [company, site] = await Promise.all([getCompany(a.customerId), getSite(a.siteId)]);
  const venue = siteDisplayName(site, a.siteId);
  const customer = company?.name ?? a.customerId;
  const primary = a.answers["core.contact_primary"];
  const contact = primary?.state === "answered" && primary.v && typeof primary.v === "object" ? (primary.v as { name?: string; email?: string }) : {};
  const copy = reportEmailCopy({ id: a.id, venue, customer, visitDate: a.visitDate, contactName: contact.name, senderName: user.name });
  let attachment: CommAttachment;
  if (plan.mode === "reference") {
    let path: string;
    try {
      path = await storeAssessmentPdf(a.id, r.pdf, Date.now());
    } catch (e) {
      console.error("[assessments] storing the report PDF for email failed", a.id, e);
      return { ok: false, error: "The report couldn't be stored for email. Try again, or download it instead." };
    }
    attachment = assessmentPdfAttachment(a.id, r.fileName, r.pdf.length, path);
  } else {
    attachment = { name: r.fileName, mime: "application/pdf", size: r.pdf.length, dataUrl: "data:application/pdf;base64," + r.pdf.toString("base64") };
  }
  const thread = await saveDraft({
    mailbox: "personal",
    owner: { id: user.id, name: user.name }, // #349 — owned by identity
    customerId: a.customerId,
    customer,
    contactName: contact.name ?? "",
    to: contact.email ?? "",
    subject: copy.subject,
    body: copy.body,
    attachments: [attachment],
  });
  redirect(`/inbox?draft=${encodeURIComponent(thread.id)}`);
}
