import Link from "next/link";

/** The report page's toolbar (#340 Task 10): back to the editor, Download PDF. */
export default function ReportToolbar({ id }: { id: string }) {
  return (
    <div className="asr-toolbar">
      <Link href={`/assessments/${encodeURIComponent(id)}`} style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← {id}</Link>
      <span style={{ flex: 1 }} />
      <a className="pk-btn-outline" style={{ textDecoration: "none" }} href={`/api/assessments/${encodeURIComponent(id)}/report-pdf?download=1`}>Download PDF</a>
    </div>
  );
}
