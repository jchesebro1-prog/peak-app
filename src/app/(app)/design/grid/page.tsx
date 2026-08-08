import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listProjects } from "@/lib/stores/grid-projects";
import { list as listCatalog } from "@/lib/stores/catalog";
import { allCompanies } from "@/lib/identity/companies";
import { bomTotals, routeLines } from "@/lib/design/grid-bom";
import { priceGridCurtains } from "@/lib/design/grid-curtains";
import { money, timeAgo } from "@/lib/format";
import { createProjectAction } from "./actions";
import DeleteProjectButton from "./delete-button";

export const metadata = { title: "The Grid — Quartzite-6" };
export const dynamic = "force-dynamic";

/**
 * The Grid (D108) — system-design projects: plan sheets, painted catalog
 * devices, live BOM → draft quote. This is the index; the work happens in
 * /design/grid/[id].
 */
export default async function GridIndexPage() {
  await requireUser();
  const [projects, parts, companies] = await Promise.all([
    listProjects(),
    listCatalog(),
    allCompanies(),
  ]);

  const input: React.CSSProperties = {
    border: "1px solid #dfe2e8",
    borderRadius: 7,
    padding: "7px 9px",
    fontSize: 13,
    fontFamily: "inherit",
    background: "#fff",
    color: "#16181d",
  };

  return (
    <div className="pk-content" style={{ maxWidth: 1080, padding: "26px 30px 64px" }}>
      <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", marginBottom: 4 }}>
        The Grid
      </h1>
      <p style={{ color: "#8c919c", fontSize: 13, marginBottom: 22 }}>
        Lay out a system on the plans — paint catalog devices onto a drawing, watch the
        bill of materials build itself, and turn it into a draft quote.
      </p>

      <section className="pk-card" style={{ padding: "16px 20px", marginBottom: 18 }}>
        <form
          action={createProjectAction}
          style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}
        >
          <input
            name="name"
            placeholder="New design — e.g. Reedsburg HS auditorium relight"
            required
            style={{ ...input, flex: "1 1 280px" }}
          />
          <select name="companyId" defaultValue="" style={{ ...input, flex: "0 1 220px" }}>
            <option value="">No customer yet</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input name="proWidthFt" type="number" step="0.5" min="1" defaultValue={40} placeholder="Pro width (ft)" style={{ ...input, width: 130 }} />
          <input name="proHeightFt" type="number" step="0.5" min="1" defaultValue={20} placeholder="Pro height (ft)" style={{ ...input, width: 130 }} />
          <input name="stageDepthFt" type="number" step="0.5" min="1" defaultValue={30} placeholder="Stage depth (ft)" style={{ ...input, width: 130 }} />
          <input name="stageWidthFt" type="number" step="0.5" min="1" defaultValue={50} placeholder="Wall-to-wall (ft), optional" style={{ ...input, width: 170 }} />
          <button
            type="submit"
            style={{
              border: "1px solid #16181d",
              background: "#16181d",
              color: "#fff",
              borderRadius: 7,
              padding: "7px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Start design
          </button>
        </form>
      </section>

      <section className="pk-card" style={{ padding: "6px 20px 10px" }}>
        {projects.length === 0 ? (
          <p style={{ color: "#9aa0ab", fontSize: 13, padding: "14px 0" }}>
            No designs yet. Start one above, upload a plan sheet, and start painting devices.
          </p>
        ) : (
          projects.map((p) => {
            const totals = bomTotals(p.placements || [], parts);
            const wireValue = routeLines(p.routes || [], parts, p.calibrations || []).value;
            // Curtains (punch #49) price outside bomTotals, so the list total
            // has to add them or a curtains-only design would read $0. No
            // customer here, so this is the default margin, not a tier one:
            // the list is an at-a-glance figure, the quote is the authority.
            const curtainValue = [
              ...priceGridCurtains(p.placements || [], parts).values(),
            ].reduce((a, v) => a + v.priceEach, 0);
            return (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "11px 0",
                  borderTop: "1px solid #eef0f3",
                }}
              >
                <Link
                  href={`/design/grid/${encodeURIComponent(p.id)}`}
                  style={{ textDecoration: "none", color: "inherit", flex: 1, minWidth: 0 }}
                >
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {p.name}
                    <span style={{ color: "#9aa0ab", fontWeight: 500 }}> · {p.id}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#8c919c", marginTop: 1 }}>
                    {p.customer || "No customer"} · {(p.sheetIds || []).length} sheet
                    {(p.sheetIds || []).length === 1 ? "" : "s"} ·{" "}
                    {(p.placements || []).length} device
                    {(p.placements || []).length === 1 ? "" : "s"} · {timeAgo(p.updatedAt)}
                  </div>
                </Link>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#16181d" }}>
                  {money(totals.value + wireValue + curtainValue)}
                </div>
                {p.quoteId && (
                  <Link
                    href="/quotes"
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#2e7d55",
                      background: "#e8f4ee",
                      border: "1px solid #cde5d8",
                      borderRadius: 6,
                      padding: "2px 7px",
                      textDecoration: "none",
                    }}
                  >
                    {p.quoteId}
                  </Link>
                )}
                <DeleteProjectButton id={p.id} />
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
