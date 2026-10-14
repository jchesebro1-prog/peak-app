import type { ReportLetterhead } from "@/lib/assessments/report-data";
import type { FindingsReportModel } from "@/lib/assessments/report-model";
import { RegisterTable, ReportFrame } from "./assessment-report";

/**
 * #337 Task 10 — the findings-only report (spec §4): the open findings across visits for one venue or one company,
 * for the rigger or the district facilities lead. Same letterhead and table as the assessment report; no photos.
 * Printed by /print/assessment-findings/[scope].
 */
export default function FindingsReport({ model, letterhead }: { model: FindingsReportModel; letterhead: ReportLetterhead }) {
  return (
    <div className="asr" data-findings-report="">
      <ReportFrame letterhead={letterhead}>
        <h1>{model.title}</h1>
        <div className="asr-sub">{model.subject} · {model.dateLong}</div>
        <p>
          {model.counts.map((c) => `${c.label}: ${c.n}`).join(" · ")}
        </p>
        {model.rows.length === 0 ? <p>No open findings.</p> : <RegisterTable rows={model.rows} withAssessment />}
      </ReportFrame>
    </div>
  );
}
