import { notFound } from "next/navigation";
import { REPORT_CSS, REPORT_PRINT_CSS } from "@/components/assessments/assessment-report";
import FindingsReport from "@/components/assessments/findings-report";
import { loadFindingsReport } from "@/lib/assessments/report-data";
import { verifyPrintToken } from "@/lib/quote-pdf/token";

export const dynamic = "force-dynamic";
export const metadata = { title: "Findings report", robots: { index: false, follow: false } };

/** The segment may arrive URL-encoded (`site%3A<id>`) or already decoded; either reads the same. */
function scopeOf(raw: string): string | null {
  if (!raw.includes("%")) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** The 120 s print token over the decoded scope — fails closed; module-level so the clock read stays out of the body. */
function tokenOk(t: string | undefined, scope: string): boolean {
  return !!t && verifyPrintToken(process.env.AUTH_SECRET || "", t, "assessment-findings", scope, Date.now());
}
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * #337 Task 10 — the signed print route for the findings-only report: the open findings for one venue
 * (`site:<id>`) or one company (`company:<id>`), URL-encoded in the segment. Outside the team login (middleware
 * exempts /print/); the token is the only key, checked before any read.
 */
export default async function PrintAssessmentFindingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ scope: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ scope: raw }, sp] = await Promise.all([params, searchParams]);
  const scope = scopeOf(raw);
  if (!scope || !tokenOk(first(sp.t), scope)) notFound();
  const data = await loadFindingsReport(scope);
  if (!data) notFound();
  return (
    <main>
      <style>{REPORT_CSS + REPORT_PRINT_CSS}</style>
      <FindingsReport model={data.model} letterhead={data.letterhead} />
    </main>
  );
}
