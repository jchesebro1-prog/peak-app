import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { VISIT_TYPES } from "@/lib/assessments/defs";
import { listAssessments } from "@/lib/stores/assessments";
import { listFindings } from "@/lib/stores/findings";
import { getCompanies } from "@/lib/identity/companies";
import { getSite } from "@/lib/identity/sites";
import { allUsers } from "@/lib/users";
import type { AssessmentListRow } from "./types";

export const metadata = { title: "Assessments — Quartzite-6" };

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const STATUS_META: Record<string, { label: string; ink: string; soft: string; bd: string }> = {
  draft: { label: "Draft", ink: "#5b616e", soft: "#f1f2f5", bd: "#e4e7ec" },
  onsite: { label: "On site", ink: "#1f5f9a", soft: "#eaf2fb", bd: "#cfe0f3" },
  completed: { label: "Completed", ink: "#2f6b3d", soft: "#e9f5ec", bd: "#cbe6d2" },
};
const STATUSES = ["draft", "onsite", "completed"] as const;

const CSS = `
  .as-row:hover { background: #fafbff; }
  .as-grid { display: grid; grid-template-columns: 82px minmax(0,1.2fr) minmax(0,1.4fr) 92px 96px 104px minmax(0,.9fr) 64px; gap: 10px; align-items: center; }
  @media (max-width: 900px) {
    .as-grid { grid-template-columns: 74px minmax(0,1fr) 96px; }
    .as-wide { display: none !important; }
  }
`;

const fmtDate = (ms: number) => (ms ? new Date(ms).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "—");

/** The assessment list (#340, spec §2): newest visit first, filtered by ?status= and ?customer=. */
export default async function AssessmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const statusParam = one(sp.status);
  const status = (STATUSES as readonly string[]).includes(statusParam) ? statusParam : "";
  const customer = one(sp.customer);

  const [all, findings, users] = await Promise.all([listAssessments(customer ? { customerId: customer } : {}), listFindings(), allUsers()]);
  const list = status ? all.filter((a) => a.status === status) : all;
  const companies = await getCompanies([...new Set(all.map((a) => a.customerId))]);
  const siteIds = [...new Set(list.map((a) => a.siteId))];
  const siteRows = await Promise.all(siteIds.map((id) => getSite(id)));
  const siteName = new Map(siteIds.map((id, i) => [id, siteRows[i]?.name || siteRows[i]?.locationName || id]));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const openByAssessment = new Map<string, number>();
  for (const f of findings) if (f.status !== "closed") openByAssessment.set(f.assessmentId, (openByAssessment.get(f.assessmentId) ?? 0) + 1);
  const vtTitle = new Map(VISIT_TYPES.map((v) => [v.key, v.title]));

  const rows: AssessmentListRow[] = list.map((a) => ({
    id: a.id,
    customerId: a.customerId,
    customerName: companies.get(a.customerId)?.name ?? a.customerId,
    siteName: siteName.get(a.siteId) ?? a.siteId,
    ...(a.spaceLabel ? { spaceLabel: a.spaceLabel } : {}),
    visitType: vtTitle.get(a.visitType) ?? a.visitType,
    status: a.status,
    visitDate: a.visitDate,
    assessorName: userName.get(a.assessorId) ?? a.assessorId,
    openFindings: openByAssessment.get(a.id) ?? 0,
  }));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, all.filter((a) => a.status === s).length])) as Record<string, number>;
  const href = (o: { status?: string; customer?: string }) => {
    const u = new URLSearchParams();
    const st = o.status ?? status;
    const cu = o.customer ?? customer;
    if (st) u.set("status", st);
    if (cu) u.set("customer", cu);
    const s = u.toString();
    return s ? `/assessments?${s}` : "/assessments";
  };
  const customerName = customer ? companies.get(customer)?.name ?? customer : "";

  const th: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: "#aab0bb", textTransform: "uppercase", letterSpacing: ".04em" };
  const cell: React.CSSProperties = { fontSize: 12.5, color: "#3a3f4a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  const chip = (on: boolean): React.CSSProperties => ({
    fontSize: 12, fontWeight: 600, padding: "5px 11px", borderRadius: 20, textDecoration: "none", whiteSpace: "nowrap",
    color: on ? "var(--accent-contrast, #16181b)" : "#5b616e", background: on ? "var(--accent)" : "#fff", border: `1px solid ${on ? "var(--accent)" : "#e4e7ec"}`,
  });

  return (
    <div className="pk-content" style={{ maxWidth: 1080, margin: "0 auto" }}>
      <style>{CSS}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
          <span style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Assessments</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "#9aa0ab" }}>{all.length}</span>
        </div>
        <span style={{ flex: 1 }} />
        {can("manage_users", user.roles) && (
          <Link href="/assessments/pick-lists" style={{ fontSize: 12.5, fontWeight: 600, color: "#5b616e", textDecoration: "none" }}>
            Pick lists
          </Link>
        )}
        <Link href={customer ? `/assessments/findings?customer=${encodeURIComponent(customer)}` : "/assessments/findings"} style={{ fontSize: 12.5, fontWeight: 600, color: "#5b616e", textDecoration: "none" }}>
          Findings →
        </Link>
        <Link
          href={customer ? `/assessments/new?company=${encodeURIComponent(customer)}` : "/assessments/new"}
          style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent-contrast, #16181b)", background: "var(--accent)", borderRadius: 8, padding: "9px 14px", textDecoration: "none" }}
        >
          + New
        </Link>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <Link href={href({ status: "" })} style={chip(!status)}>All <span style={{ fontFamily: "var(--font-mono)", fontWeight: 400 }}>{all.length}</span></Link>
        {STATUSES.map((s) => (
          <Link key={s} href={href({ status: s })} style={chip(status === s)}>
            {STATUS_META[s].label} <span style={{ fontFamily: "var(--font-mono)", fontWeight: 400 }}>{counts[s]}</span>
          </Link>
        ))}
        {customer && (
          <span style={{ fontSize: 12, color: "#5b616e", marginLeft: 8 }}>
            Customer: <b>{customerName}</b>{" "}
            <Link href={href({ customer: "" })} style={{ color: "var(--accent)", textDecoration: "none" }}>clear</Link>
          </span>
        )}
      </div>

      <div className="pk-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="as-grid" style={{ padding: "9px 18px", background: "#fafbfc", borderBottom: "1px solid #f0f1f4" }}>
          <span style={th}>ID</span>
          <span style={th}>Customer</span>
          <span className="as-wide" style={th}>Venue</span>
          <span className="as-wide" style={th}>Visit type</span>
          <span style={th}>Status</span>
          <span className="as-wide" style={th}>Visit date</span>
          <span className="as-wide" style={th}>Assessor</span>
          <span className="as-wide" style={{ ...th, textAlign: "right" }}>Open findings</span>
        </div>
        {rows.map((r) => {
          const sm = STATUS_META[r.status];
          return (
            <div key={r.id} className="as-row as-grid" style={{ padding: "11px 18px", borderBottom: "1px solid #f5f6f8" }}>
              <Link href={`/assessments/${encodeURIComponent(r.id)}`} style={{ ...cell, fontFamily: "var(--font-mono)", color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>{r.id}</Link>
              <Link href={href({ customer: r.customerId })} title="Show this customer's assessments" style={{ ...cell, fontWeight: 600, color: "#24272e", textDecoration: "none" }}>{r.customerName}</Link>
              <span className="as-wide" style={cell}>{r.siteName}{r.spaceLabel ? <span style={{ color: "#8c919c" }}> · {r.spaceLabel}</span> : null}</span>
              <span className="as-wide" style={cell}>{r.visitType}</span>
              <span>
                <span style={{ display: "inline-block", fontSize: 10.5, fontWeight: 600, color: sm.ink, background: sm.soft, border: `1px solid ${sm.bd}`, padding: "3px 9px", borderRadius: 20, whiteSpace: "nowrap" }}>{sm.label}</span>
              </span>
              <span className="as-wide" style={cell}>{fmtDate(r.visitDate)}</span>
              <span className="as-wide" style={cell}>{r.assessorName}</span>
              <span className="as-wide" style={{ ...cell, fontFamily: "var(--font-mono)", textAlign: "right", color: r.openFindings ? "#3a3f4a" : "#aab0bb" }}>{r.openFindings}</span>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div style={{ padding: "44px 22px", textAlign: "center", color: "#9aa0ab", fontSize: 13 }}>
            {all.length === 0 ? "No assessments yet. Start one with + New." : "No assessments match these filters."}
          </div>
        )}
      </div>
    </div>
  );
}
