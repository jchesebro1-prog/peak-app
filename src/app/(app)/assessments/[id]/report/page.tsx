import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import AssessmentReport, { REPORT_CSS } from "@/components/assessments/assessment-report";
import { loadAssessmentReport } from "@/lib/assessments/report-data";
import ReportToolbar from "./toolbar";

export const metadata = { title: "Assessment report — Quartzite-6" };
/** Email report renders the PDF inside this page's server action. */
export const maxDuration = 120;

const TOOLBAR_CSS = `
.asr-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; max-width: 8.5in; margin: 0 auto 14px; }
`;

/**
 * The venue assessment report in the browser (#340, spec §4) — the same component the signed print route renders,
 * with photos from the session photo route, plus Download PDF and Email report.
 */
export default async function AssessmentReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const data = await loadAssessmentReport(id);
  if (!data) notFound();
  const a = data.assessment;
  const photos: Record<string, string | null> = Object.fromEntries(
    a.photos.map((p) => [p.id, p.pending ? null : `/api/assessments/${encodeURIComponent(a.id)}/photos/${encodeURIComponent(p.id)}`]),
  );
  return (
    <div className="pk-content" style={{ maxWidth: 1000 }}>
      <style>{REPORT_CSS + TOOLBAR_CSS}</style>
      <ReportToolbar id={a.id} canSend={can("send", user.roles)} />
      <AssessmentReport model={data.model} letterhead={data.letterhead} photos={photos} />
    </div>
  );
}
