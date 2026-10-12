import Link from "next/link";
import { requireUser } from "@/lib/session";
import HomeTabs from "../home-tabs";
import WidgetHost from "../_dashboard/host";

export const metadata = { title: "Reports — Quartzite-6" };

/**
 * Reports (#43) — a widget surface. The former Sales and Installs views are
 * registry widgets (see _dashboard/widgets/sales.tsx, installs.tsx); the
 * user's saved layout decides which render and in what order. History
 * widgets follow ?range; installs widgets always look 12 months ahead.
 * ?view= and ?ir= are no longer read (D144).
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  return (
    <HomeTabs active="reports" maxWidth={1180}>
      <div style={{ marginBottom: 18, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="pk-h1">Reports</div>
          <div className="pk-page-sub">Pipeline health, quoting performance, backlog and billing forecast — pick the widgets you want.</div>
        </div>
        <Link href="/reports/estimator-bonuses" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
          Estimator bonuses →
        </Link>
      </div>
      <WidgetHost user={user} surface="reports" sp={sp} />
    </HomeTabs>
  );
}
