import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { allUsers } from "@/lib/users";
import {
  buildReportModel,
  ReportBody,
  type ReportJob,
  type ReportVariant,
  type OrgCtx,
} from "../report-doc";

export const metadata = { title: "Flame test report — options — Peak Backend" };

/**
 * Flame Test Report OPTIONS — the "three directions to compare" canvas from
 * Flame Test Report Options.dc.html. Renders the same logged sample results
 * three ways (letter / summary / certificate) so the office can pick a
 * default. Route: /flame-tests/report/options.
 */

/* Sample job — the re-treated, two-venue test baked into the .dc.html. */
function sampleJob(): ReportJob {
  const completedAt = Date.now() - 6 * 86400000;
  return {
    id: "FT-DEMO",
    customer: "Northshore Theater",
    venue: "Main House",
    owner: "Jeff Chesebro",
    assignedTo: "Nic Trapani",
    completedAt,
    dueAt: completedAt + 365 * 86400000,
    stage: "completed",
    contact: { name: "Susan Marsh" },
    venues: [
      { id: "ns1", label: "Main House", city: "Sheboygan", state: "WI", curtains: 14 },
      { id: "ns2", label: "Studio Stage", city: "Sheboygan", state: "WI", curtains: 6 },
    ],
    results: {
      overall: "partial",
      cert: "FT-2026-057",
      performedBy: "Nic Trapani",
      venues: [
        { id: "ns1", label: "Main House", tested: 14, passed: 11, retreated: 3, failed: 0 },
        { id: "ns2", label: "Studio Stage", tested: 6, passed: 6, retreated: 0, failed: 0 },
      ],
      notes:
        "Three stage-left legs in the Main House were re-treated on site and passed on re-test.",
    },
  };
}

const DIRECTIONS: Array<{
  key: string;
  variant: ReportVariant;
  title: string;
  note: string;
}> = [
  { key: "1a", variant: "letter", title: "Letter", note: "Prose — closest to your sample docx" },
  {
    key: "1b",
    variant: "summary",
    title: "Letter + results panel",
    note: "Same letter, plus the per-venue numbers",
  },
  {
    key: "1c",
    variant: "certificate",
    title: "Certificate",
    note: "Formal compliance record · default",
  },
];

export default async function FlameTestReportOptionsPage() {
  const [, settings, users] = await Promise.all([requireUser(), getSettings(), allUsers()]);
  const org: OrgCtx = {
    accent: settings.accent || "#7b3f8a",
    companyName: settings.companyName || "Peak Systems Group",
    offices: Array.isArray(settings.offices) ? settings.offices : [],
    users: users.map((u) => ({ name: u.name, roles: u.roles, email: u.email })),
  };
  const model = buildReportModel(sampleJob(), org);

  return (
    <div className="pk-content" style={{ fontFamily: "var(--font-ui)", color: "#16181d" }}>
      <div style={{ margin: "0 0 24px", maxWidth: 760 }}>
        <Link
          href="/flame-tests"
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
          ← Flame tests
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
          Flame test results report
        </div>
        <div style={{ fontSize: 25, fontWeight: 600, letterSpacing: "-.015em", marginTop: 6 }}>
          Three directions to compare
        </div>
        <div style={{ fontSize: 13.5, color: "#5b616e", marginTop: 9, lineHeight: 1.65 }}>
          The same logged results — a re-treated, two-venue test — shown three ways. The live report
          is already wired to open when a tech logs results; you can also flip between these on the
          report’s own toolbar. Tell me which to keep as the default (reference them as{" "}
          <strong>1a</strong> / <strong>1b</strong> / <strong>1c</strong>).
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
            </div>
            <ReportBody m={model} variant={d.variant} />
          </div>
        ))}
      </div>
    </div>
  );
}
