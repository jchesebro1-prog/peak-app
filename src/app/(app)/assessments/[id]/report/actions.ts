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
import { EMAIL_PDF_MAX_BYTES, EMAIL_TOO_LARGE, reportEmailCopy } from "@/lib/assessments/report-model";

export type EmailReportReply = { ok: false; error: string };

/**
 * Email report (#337 Task 10): render the assessment report PDF (the same render Download PDF serves), attach it
 * inline as a data URL (the renewal-outreach pattern) when it is 10 MB or less, land a draft in the sender's own
 * mailbox linked to the customer and addressed to the primary contact, then open it in the Inbox composer. Needs
 * `send`. Refusals come back as `{ ok: false, error }`; success redirects.
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
  if (r.pdf.length > EMAIL_PDF_MAX_BYTES) return { ok: false, error: EMAIL_TOO_LARGE };
  const [company, site] = await Promise.all([getCompany(a.customerId), getSite(a.siteId)]);
  const venue = siteDisplayName(site, a.siteId);
  const customer = company?.name ?? a.customerId;
  const primary = a.answers["core.contact_primary"];
  const contact = primary?.state === "answered" && primary.v && typeof primary.v === "object" ? (primary.v as { name?: string; email?: string }) : {};
  const copy = reportEmailCopy({ id: a.id, venue, customer, visitDate: a.visitDate, contactName: contact.name, senderName: user.name });
  const attachment: CommAttachment = {
    name: r.fileName,
    mime: "application/pdf",
    size: r.pdf.length,
    dataUrl: "data:application/pdf;base64," + r.pdf.toString("base64"),
  };
  const thread = await saveDraft({
    mailbox: "personal",
    mailboxUser: user.name,
    customerId: a.customerId,
    customer,
    contactName: contact.name ?? "",
    to: contact.email ?? "",
    subject: copy.subject,
    body: copy.body,
    attachments: [attachment],
    me: user.name,
  });
  redirect(`/inbox?draft=${encodeURIComponent(thread.id)}`);
}
