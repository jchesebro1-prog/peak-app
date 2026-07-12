import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { get, counts } from "@/lib/stores/inspections";
import { getSettings } from "@/lib/settings";
import { PrintButton, RenovationQuoteButton } from "./controls";
import { InspectionReportSheets, type ReportLayout } from "./report-doc";

export const metadata = { title: "Inspection report — Peak Backend" };

const LAYOUTS: ReportLayout[] = ["report", "dossier", "compact"];
const LAYOUT_LABEL: Record<ReportLayout, string> = {
  report: "Report",
  dossier: "Field dossier",
  compact: "Compact",
};

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const CSS = `
  .rp-desk { background: #2c2e33; padding: 30px 20px 90px; display: flex; flex-direction: column; align-items: center; gap: 24px; }
  .rp-sheet { box-shadow: 0 8px 30px rgba(0,0,0,.30); break-after: page; }
  .rp-sheet:last-of-type { break-after: auto; }
  @media print {
    .rp-desk { background: #fff !important; padding: 0 !important; gap: 0 !important; }
    .rp-sheet { box-shadow: none !important; margin: 0 !important; }
    @page { size: letter; margin: 0; }
  }
`;

export default async function InspectionReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, { id }, sp, settings] = await Promise.all([requireUser(), params, searchParams, getSettings()]);
  const rec = await get(id);
  if (!rec) notFound();

  const layoutParam = one(sp.layout) as ReportLayout;
  const layout: ReportLayout = LAYOUTS.includes(layoutParam) ? layoutParam : "report";
  const showBoiler = one(sp.boiler) !== "0";
  const showClosed = one(sp.closed) !== "0";
  const showRubric = one(sp.rubric) !== "0";

  const accent = settings.accent || "#7b3f8a";
  const companyName = settings.companyName || "Peak Systems Group";
  const offices = Array.isArray(settings.offices) ? settings.offices : [];
  const c = counts(rec);

  const base = `/inspections/${encodeURIComponent(id)}/report`;
  const hrefWith = (over: Partial<{ layout: string; boiler: string; closed: string; rubric: string }>) => {
    const qs = new URLSearchParams();
    const ly = over.layout ?? layout;
    const b = over.boiler ?? (showBoiler ? "1" : "0");
    const cl = over.closed ?? (showClosed ? "1" : "0");
    const rb = over.rubric ?? (showRubric ? "1" : "0");
    if (ly !== "report") qs.set("layout", ly);
    if (b === "0") qs.set("boiler", "0");
    if (cl === "0") qs.set("closed", "0");
    if (rb === "0") qs.set("rubric", "0");
    const s = qs.toString();
    return base + (s ? "?" + s : "");
  };

  const toggleChip = (on: boolean, label: string, href: string) => (
    <Link
      href={href}
      scroll={false}
      style={{
        fontFamily: "var(--font-ui)",
        fontSize: 12,
        fontWeight: 600,
        borderRadius: 9,
        padding: "9px 12px",
        minHeight: 40,
        display: "inline-flex",
        alignItems: "center",
        textDecoration: "none",
        border: "1px solid #2f323a",
        background: on ? "#23262d" : "transparent",
        color: on ? "#e7e9ee" : "#8b909a",
      }}
    >
      {label} {on ? "✓" : ""}
    </Link>
  );

  return (
    <div style={{ minHeight: "100vh", fontFamily: "var(--font-ui)", color: "#16181d", background: "#2c2e33" }}>
      <style>{CSS}</style>

      {/* toolbar (screen only) */}
      <div
        className="pk-no-print"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 40,
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "11px 16px",
          background: "#16181d",
          color: "#fff",
          flexWrap: "wrap",
          rowGap: 10,
        }}
      >
        <Link
          href="/inspections"
          style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0, fontSize: 13, fontWeight: 600, color: "#cfd3da", background: "#23262d", border: "1px solid #2f323a", borderRadius: 9, padding: "9px 13px", textDecoration: "none", minHeight: 40, boxSizing: "border-box" }}
        >
          ‹ Inspections
        </Link>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {(rec.customer || "Inspection") + " — " + (rec.venue || "")}
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#8b909a", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {rec.id + " · " + LAYOUT_LABEL[layout] + " layout · " + c.total + " logs"}
          </div>
        </div>

        <div style={{ display: "flex", background: "#23262d", border: "1px solid #2f323a", borderRadius: 10, padding: 3, flexShrink: 0 }}>
          {LAYOUTS.map((k) => {
            const on = k === layout;
            return (
              <Link
                key={k}
                href={hrefWith({ layout: k })}
                scroll={false}
                style={{ fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, borderRadius: 8, padding: "7px 12px", whiteSpace: "nowrap", textDecoration: "none", color: on ? "#16181d" : "#9aa0ab", background: on ? "#fff" : "transparent" }}
              >
                {LAYOUT_LABEL[k]}
              </Link>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0, flexWrap: "wrap" }}>
          {toggleChip(showBoiler, "Standards", hrefWith({ boiler: showBoiler ? "0" : "1" }))}
          {toggleChip(showClosed, "Closed", hrefWith({ closed: showClosed ? "0" : "1" }))}
          {toggleChip(showRubric, "Rubric", hrefWith({ rubric: showRubric ? "0" : "1" }))}
          <RenovationQuoteButton id={rec.id} />
          <PrintButton />
        </div>
      </div>

      {/* desk */}
      <div className="rp-desk">
        <InspectionReportSheets
          record={rec}
          accent={accent}
          companyName={companyName}
          offices={offices}
          layout={layout}
          showBoiler={showBoiler}
          showClosed={showClosed}
          showRubric={showRubric}
        />
      </div>
    </div>
  );
}
