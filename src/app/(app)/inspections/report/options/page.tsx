import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { demoInspection } from "@/db/seeds/inspections";
import {
  InspectionReportSheets,
  type ReportLayout,
} from "../../[id]/report/report-doc";

export const metadata = { title: "Inspection report — options — Peak Backend" };

/**
 * Inspection Report OPTIONS — "three directions to compare", the inspection
 * twin of the flame-test report options canvas (IDEAS #44). Renders the same
 * demo inspection in the live report's three layouts (report / dossier /
 * compact) so the office can pick a default. The live report also carries
 * per-print section toggles (Standards / Closed / Rubric) on its own toolbar.
 * Route: /inspections/report/options.
 */

const DIRECTIONS: Array<{
  key: string;
  layout: ReportLayout;
  title: string;
  note: string;
}> = [
  {
    key: "3a",
    layout: "report",
    title: "Report",
    note: "Color-coded, one finding per page · default",
  },
  {
    key: "3b",
    layout: "dossier",
    title: "Dossier",
    note: "Monochrome editorial pages — formal archive copy",
  },
  {
    key: "3c",
    layout: "compact",
    title: "Compact",
    note: "Condensed six-up findings — quick email copy",
  },
];

const CSS = `
  .iro-clip { overflow-x: auto; border: 1px solid #e4e7ec; border-radius: 12px; background: #2c2e33; padding: 18px; }
  .iro-clip > * { margin: 0 auto; width: -moz-fit-content; width: fit-content; }
`;

export default async function InspectionReportOptionsPage() {
  const [, settings] = await Promise.all([requireUser(), getSettings()]);
  const accent = settings.accent || "#7b3f8a";
  const companyName = settings.companyName || "Peak Systems Group";
  const offices = Array.isArray(settings.offices) ? settings.offices : [];
  const rec = demoInspection();

  return (
    <div className="pk-content" style={{ fontFamily: "var(--font-ui)", color: "#16181d" }}>
      <style>{CSS}</style>
      <div style={{ margin: "0 0 24px", maxWidth: 760 }}>
        <Link
          href="/inspections"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12.5,
            fontWeight: 600,
            color: "#8c919c",
            textDecoration: "none",
            marginBottom: 14,
          }}
        >
          ← Inspections
        </Link>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            color: "#8c919c",
          }}
        >
          Inspection client report
        </div>
        <div style={{ fontSize: 25, fontWeight: 600, letterSpacing: "-.015em", marginTop: 6 }}>
          Three directions to compare
        </div>
        <div style={{ fontSize: 13.5, color: "#5b616e", marginTop: 9, lineHeight: 1.65 }}>
          The same completed inspection — the Lakefront PAC demo report — shown in the live
          report&#39;s three layouts. Every completed inspection can flip between these (plus the
          Standards / Closed / Rubric section toggles) on the report&#39;s own toolbar. Tell me
          which to keep as the default (reference them as <strong>3a</strong> / <strong>3b</strong>{" "}
          / <strong>3c</strong>).
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
        {DIRECTIONS.map((d) => (
          <div key={d.key}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 11 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: 26,
                  height: 22,
                  padding: "0 7px",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#fff",
                  background: "#16181d",
                  borderRadius: 6,
                }}
              >
                {d.key}
              </span>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{d.title}</span>
              <span style={{ fontSize: 12.5, color: "#8c919c" }}>{d.note}</span>
              <Link
                href={
                  "/inspections/" +
                  encodeURIComponent(rec.id) +
                  "/report" +
                  (d.layout !== "report" ? "?layout=" + d.layout : "")
                }
                style={{
                  marginLeft: "auto",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--accent)",
                  textDecoration: "none",
                }}
              >
                Open full-size →
              </Link>
            </div>
            <div className="iro-clip">
              <div>
                <InspectionReportSheets
                  record={rec}
                  accent={accent}
                  companyName={companyName}
                  offices={offices}
                  layout={d.layout}
                  showBoiler={d.layout !== "compact"}
                  showClosed
                  showRubric={d.layout === "report"}
                  logoDark={settings.logoDark || null}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
