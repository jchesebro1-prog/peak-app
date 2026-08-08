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

export const metadata = { title: "Repair report — options — Quartzite-6" };

/**
 * Repair Report OPTIONS — "three directions to compare", the repair twin of
 * the flame-test report options canvas. Renders the same logged sample repair
 * three ways (letter / summary / service report) so the office can pick a
 * default. Route: /repairs/report/options.
 */

/* Sample job — a completed rigging repair sourced from an inspection finding. */
function sampleJob(): ReportJob {
  const completedAt = Date.now() - 4 * 86400000;
  return {
    id: "RP-DEMO",
    customer: "Northshore Theater",
    venue: "Main House",
    owner: "Jeff Chesebro",
    assignedTo: "Nic Trapani",
    completedAt,
    stage: "completed",
    category: "rigging",
    priority: "urgent",
    title: "Replace worn rope locks",
    scope: "",
    items: [
      { label: "Replace worn rope locks", qty: 6, note: "line sets 4–9" },
      { label: "Re-terminate hand lines over thimbles", qty: 2, note: "" },
    ],
    parts: [
      { name: "Rope lock assembly", qty: 6, cost: 118 },
      { name: "Wire rope thimble kit", qty: 2, cost: 14 },
    ],
    laborHours: 14,
    crew: ["Nic Trapani", "Jack Miller"],
    warrantyMonths: 12,
    contact: { name: "Susan Marsh" },
    venues: [{ id: "ns1", label: "Main House", city: "Sheboygan", state: "WI" }],
    source: { kind: "inspection", refId: "RI-2042", label: "From inspection RI-2042" },
    completion: {
      performedBy: "Nic Trapani",
      workPerformed:
        "Removed the six worn rope locks on line sets 4–9 and installed new assemblies; jaws set to the house hand line diameter and torque-checked. Both hand lines re-terminated over thimbles. All six sets cycled under load and holding cleanly.",
      partsUsed: ["6× Rope lock assembly", "2× Wire rope thimble kit"],
      followUp:
        "The rope locks on line sets 10–14 show early cam wear — recommend replacing them at the next annual inspection before they reach the same state.",
    },
  };
}

const DIRECTIONS: Array<{
  key: string;
  variant: ReportVariant;
  title: string;
  note: string;
}> = [
  { key: "2a", variant: "letter", title: "Letter", note: "Prose — matches the flame-test letter voice" },
  {
    key: "2b",
    variant: "summary",
    title: "Letter + service panel",
    note: "Same letter, plus the scope & warranty numbers",
  },
  {
    key: "2c",
    variant: "report",
    title: "Service report",
    note: "Formal completion record · default",
  },
];

export default async function RepairReportOptionsPage() {
  const [, settings, users] = await Promise.all([requireUser(), getSettings(), allUsers()]);
  const org: OrgCtx = {
    accent: settings.accent || "#7b3f8a",
    companyName: settings.companyName || "Peak Systems Group",
    offices: Array.isArray(settings.offices) ? settings.offices : [],
    users: users.map((u) => ({ name: u.name, roles: u.roles, email: u.email, officeId: u.officeId })),
    letterhead: settings.logoDark || null,
  };
  const model = buildReportModel(sampleJob(), org);

  return (
    <div className="pk-content" style={{ fontFamily: "var(--font-ui)", color: "#16181d" }}>
      <div style={{ margin: "0 0 24px", maxWidth: 760 }}>
        <Link
          href="/repairs"
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
          ← Repairs
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
          Repair service report
        </div>
        <div style={{ fontSize: 25, fontWeight: 600, letterSpacing: "-.015em", marginTop: 6 }}>
          Three directions to compare
        </div>
        <div style={{ fontSize: 13.5, color: "#5b616e", marginTop: 9, lineHeight: 1.65 }}>
          The same completed repair — six rope locks replaced off an inspection finding — shown
          three ways. The live report opens from any completed repair; you can also flip between
          these on the report’s own toolbar. Tell me which to keep as the default (reference them
          as <strong>2a</strong> / <strong>2b</strong> / <strong>2c</strong>).
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
