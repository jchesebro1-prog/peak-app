import { redirect } from "next/navigation";
import { placementQty } from "@/lib/design/grid-bom";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { designRedirect } from "@/lib/design-routes";
import { allEngagements, ENGAGEMENT_STATUS_LABEL } from "@/lib/stores/engagements";
import { isOpenEngagement } from "@/lib/consulting-review";
import { getAllDesigns as getSandboxDesigns } from "@/lib/stores/designs";
import { listProjects as listGridProjects } from "@/lib/stores/grid-projects";
import { shortDate } from "@/lib/format";

export const metadata = { title: "Design — Quartzite-6" };
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

  const [engagements, designs, gridProjects] = await Promise.all([
    allEngagements(),
    getSandboxDesigns(),
    listGridProjects(),
  ]);

  const activeEngagements = engagements
    .filter(isOpenEngagement)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  /* One list, not two (D-grid-merge): The Grid stopped being a standalone
   * tool, so a manual design is BOTH a design record and a grid project and
   * was being listed twice here. Rows are design records, plus any grid
   * project no design record points at — pre-merge projects (the GRD-5001
   * seed among them) that predate the "a grid project always has a design
   * record" invariant. Those orphans have no other route into the UI now the
   * standalone Grid index is gone, so they are adopted into this list rather
   * than dropped; backfilling real design records for them is a separate job. */
  const linkedGridIds = new Set(
    designs.map((d) => d.gridProjectId).filter((id): id is string => !!id)
  );
  const recentDesigns = [
    ...designs.map((d) => ({
      key: d.id,
      name: d.name,
      href: `/design/designs?id=${encodeURIComponent(d.id)}`,
      meta: [d.customer, d.venue, shortDate(d.updatedAt)].filter(Boolean).join(" · "),
      updatedAt: d.updatedAt,
    })),
    ...gridProjects
      .filter((p) => !linkedGridIds.has(p.id))
      .map((p) => {
        // Units, not markers: an Auto lot marker stands for `qty` units (#GEM).
        const n = (p.placements || []).reduce((sum, pl) => sum + (pl.curtain ? 1 : placementQty(pl)), 0);
        return {
          key: p.id,
          name: p.name || "Untitled design",
          href: `/design/grid/${encodeURIComponent(p.id)}`,
          meta: [p.customer || "No customer", `${n} unit${n === 1 ? "" : "s"}`, shortDate(p.updatedAt)].join(" · "),
          updatedAt: p.updatedAt,
        };
      }),
  ]
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

      <div className="pk-design-hub-grid">
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
            <p style={{ color: "#9aa0ab", fontSize: 13 }}>
              No designs yet — start one on a blank canvas or a plan sheet.
            </p>
          ) : (
            recentDesigns.map((d) => (
              <Link
                key={d.key}
                href={d.href}
                style={{ display: "block", padding: "9px 0", borderTop: "1px solid #eef0f3", textDecoration: "none", color: "inherit" }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</div>
                <div style={{ fontSize: 12, color: "#8c919c" }}>{d.meta}</div>
              </Link>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
