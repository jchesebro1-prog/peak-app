/* A by-reference attachment's PDF (`pdfPath`) read for one thread — the single reader the Gmail send path and the
   attachment broker share, so the same defence-in-depth applies to both: a quote PDF is read only on a thread linked to
   that quote (pdfPathFitsLink), and an emailed assessment report only on a thread for that assessment's customer or an
   unlinked one (assessmentPdfFitsThread). A refused path reads as missing (null). Server-only. */
import { pdfPathFitsLink } from "@/lib/comms-attachments";
import { pdfStorage } from "@/lib/quote-pdf/storage";
import { assessmentIdOfPdfPath, assessmentPdfFitsThread, isAssessmentPdfPath } from "@/lib/assessments/report-pdf-path";
import { readAssessmentPdf } from "@/lib/assessments/report-pdf-storage";
import type { CommThread } from "@/lib/stores/comms";

async function readQuotePdf(path: string): Promise<Buffer | null> {
  const store = pdfStorage();
  return "unavailable" in store ? null : store.read(path);
}

export async function readPdfForThread(path: string, t: CommThread): Promise<Buffer | null> {
  // #340: an emailed assessment report rides by reference too — read only on a thread for that assessment's
  // customer (or an unlinked one), streamed from Blob.
  if (isAssessmentPdfPath(path)) {
    const { getAssessment } = await import("@/lib/stores/assessments");
    const a = await getAssessment(assessmentIdOfPdfPath(path) ?? "");
    return assessmentPdfFitsThread(path, t, a?.customerId ?? null) ? readAssessmentPdf(path) : null;
  }
  // A quote-linked thread only reads that quote's own PDFs.
  return pdfPathFitsLink(path, t.link) ? readQuotePdf(path) : null;
}
