/* Assessments engine (#340) final review I2 — where an emailed report PDF lives, as pure rules. Email report stores
   the rendered PDF in private Blob at `assessment-pdfs/<AS-id>/<ms>.pdf` (Blob adds a random suffix) and the Inbox
   draft carries it BY REFERENCE (`pdfPath` + `href`), the way Estimator Phase 3 attaches quote PDFs — a multi-MB
   base64 PDF never sits in a comms doc (navData reads every comms doc on every page). Every path is checked here
   before any storage I/O. */

const ID_RE = /^AS-\d{4,6}$/;
/** `<ms>[-<Blob suffix>].pdf` — no directory part. */
const FILE_RE = /^\d{10,16}(?:-[A-Za-z0-9]{1,64})?\.pdf$/;
const PATH_RE = /^assessment-pdfs\/(AS-\d{4,6})\/(\d{10,16}(?:-[A-Za-z0-9]{1,64})?\.pdf)$/;

/** True for a stored assessment report PDF path (`assessment-pdfs/AS-1001/1760000000000[-suffix].pdf`). */
export function isAssessmentPdfPath(p: unknown): p is string {
  return typeof p === "string" && PATH_RE.test(p);
}

/** True for a stored report's file name (the download route's `?file=`). */
export function isAssessmentPdfFile(name: unknown): name is string {
  return typeof name === "string" && FILE_RE.test(name);
}

/** The assessment a stored report PDF belongs to, or null for any other path. */
export function assessmentIdOfPdfPath(p: unknown): string | null {
  const m = typeof p === "string" ? PATH_RE.exec(p) : null;
  return m ? m[1] : null;
}

/** Where a new report PDF for `assessmentId` is stored (before Blob's suffix). Throws for a malformed id. */
export function assessmentPdfPath(assessmentId: string, now: number): string {
  if (!ID_RE.test(assessmentId)) throw new Error("Refusing a report path for a malformed assessment id");
  return `assessment-pdfs/${assessmentId}/${Math.max(0, Math.floor(now))}.pdf`;
}

/** The team download URL of a stored report (api/assessments/[id]/report-pdf?file=…), linked by the Inbox reader. */
export function assessmentPdfHref(assessmentId: string, path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return `/api/assessments/${encodeURIComponent(assessmentId)}/report-pdf?file=${encodeURIComponent(base)}&download=1`;
}

/** The Inbox draft's attachment for a stored report: by reference only — `pdfPath` for the Gmail bridge, `href` for
 *  the reader's download link, never the bytes. */
export function assessmentPdfAttachment(assessmentId: string, fileName: string, size: number, path: string): { name: string; mime: string; size: number; pdfPath: string; href: string } {
  if (!isAssessmentPdfPath(path) || assessmentIdOfPdfPath(path) !== assessmentId) throw new Error("Refusing a report attachment outside its assessment's folder");
  return { name: fileName, mime: "application/pdf", size, pdfPath: path, href: assessmentPdfHref(assessmentId, path) };
}

/**
 * May the Gmail bridge read this by-reference assessment PDF for this thread? Only a real assessment PDF path whose
 * assessment exists (`assessmentCustomerId` non-null), and only on a thread for that assessment's customer — or on a
 * thread with no customer and no link at all. A quote-linked thread never reads one (it reads only its own quote's
 * PDFs). As narrow as the quote rule (comms-attachments pdfPathFitsLink).
 */
export function assessmentPdfFitsThread(
  path: string,
  thread: { customerId?: string | null; link?: { type?: string | null; id?: string | null } | null },
  assessmentCustomerId: string | null,
): boolean {
  if (!isAssessmentPdfPath(path) || !assessmentCustomerId) return false;
  if (thread.link?.type === "quote") return false;
  if (thread.customerId) return thread.customerId === assessmentCustomerId;
  return !thread.link;
}
