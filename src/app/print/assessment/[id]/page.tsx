import { notFound } from "next/navigation";
import AssessmentReport, { REPORT_CSS, REPORT_PRINT_CSS } from "@/components/assessments/assessment-report";
import ReportReady from "@/components/assessments/report-ready";
import { inlineReportPhotos, loadAssessmentReport } from "@/lib/assessments/report-data";
import { verifyPrintToken } from "@/lib/quote-pdf/token";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assessment report", robots: { index: false, follow: false } };

/** The 120 s print token — fails closed; module-level so the clock read stays out of the component body (react-hooks/purity). */
function tokenOk(t: string | undefined, id: string): boolean {
  return !!t && verifyPrintToken(process.env.AUTH_SECRET || "", t, "assessment", id, Date.now());
}
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * #337 Task 10 — the signed print route for a venue assessment report. Outside the team login (middleware exempts
 * /print/); the token is the only key, checked before any read. Photos are read on the server (photoBytes) and inlined
 * as data URIs — headless Chrome never needs a session and the photo route never takes a token. The ReportReady island
 * sets them and marks the report ready once they have decoded (the render's `waitFor`).
 */
export default async function PrintAssessmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!tokenOk(first(sp.t), id)) notFound();
  const data = await loadAssessmentReport(id);
  if (!data) notFound();
  const { sources, overCap } = await inlineReportPhotos(data.assessment);
  return (
    <main>
      <style>{REPORT_CSS + REPORT_PRINT_CSS}</style>
      <AssessmentReport model={data.model} letterhead={data.letterhead} photos={sources} deferPhotos overCap={overCap} />
      <ReportReady sources={sources} />
    </main>
  );
}
