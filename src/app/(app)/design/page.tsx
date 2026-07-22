import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { designRedirect } from "@/lib/design-routes";
import { allEngagements, ENGAGEMENT_STATUS_LABEL } from "@/lib/stores/engagements";
import { getAllDesigns as getSandboxDesigns } from "@/lib/stores/designs";
import { shortDate } from "@/lib/format";

export const metadata = { title: "Design — Peak Backend" };
export const dynamic = "force-dynamic";

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function DesignOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp] = await Promise.all([requireUser(), searchParams]);

  // Legacy deep link: /design?id=D-101 → /design/designs?id=D-101
  const hop = designRedirect("/design", { id: one(sp.id) });
  if (hop) redirect(hop);

  const [engagements, designs] = await Promise.all([
    allEngagements(),
    getSandboxDesigns(),
  ]);

  const activeEngagements = engagements
    .filter((e) => e.status === "active")
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const recentDesigns = designs
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8);

  const card: React.CSSProperties = { padding: "18px 20px" };
  const head: React.CSSProperties = {
    display: "flex", alignItems: "baseline", justifyContent: "space-between",
    marginBottom: 12,
  };

  return (
    <div className="pk-content" style={{ maxWidth: 1080, padding: "26px 30px 64px" }}>
      <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", marginBottom: 4 }}>
        Design
      </h1>
      <p style={{ color: "#8c919c", fontSize: 13, marginBottom: 22 }}>
        Paid consulting and budgetary designs — the same job at different stages.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 18 }}>
        <section className="pk-card" style={card}>
          <div style={head}>
            <strong style={{ fontSize: 14 }}>Active consulting</strong>
            <Link href="/design/engagements" style={{ color: "var(--accent)", fontSize: 12.5 }}>
              All consulting →
            </Link>
          </div>
          {activeEngagements.length === 0 ? (
            <p style={{ color: "#9aa0ab", fontSize: 13 }}>No active consulting.</p>
          ) : (
            activeEngagements.slice(0, 8).map((e) => (
              <Link
                key={e.id}
                href={`/design/engagements/${encodeURIComponent(e.id)}`}
                style={{ display: "block", padding: "9px 0", borderTop: "1px solid #eef0f3", textDecoration: "none", color: "inherit" }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{e.name}</div>
                <div style={{ fontSize: 12, color: "#8c919c" }}>
                  {e.customer} · {ENGAGEMENT_STATUS_LABEL[e.status] ?? e.status} · {shortDate(e.updatedAt)}
                </div>
              </Link>
            ))
          )}
        </section>

        <section className="pk-card" style={card}>
          <div style={head}>
            <strong style={{ fontSize: 14 }}>Recent designs</strong>
            <Link href="/design/designs" style={{ color: "var(--accent)", fontSize: 12.5 }}>
              All designs →
            </Link>
          </div>
          {recentDesigns.length === 0 ? (
            <p style={{ color: "#9aa0ab", fontSize: 13 }}>No designs yet.</p>
          ) : (
            recentDesigns.map((d) => (
              <Link
                key={d.id}
                href={`/design/designs?id=${encodeURIComponent(d.id)}`}
                style={{ display: "block", padding: "9px 0", borderTop: "1px solid #eef0f3", textDecoration: "none", color: "inherit" }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</div>
                <div style={{ fontSize: 12, color: "#8c919c" }}>
                  {d.customer} · {d.venue} · {shortDate(d.updatedAt)}
                </div>
              </Link>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
