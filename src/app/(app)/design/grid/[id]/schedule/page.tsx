import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getProject } from "@/lib/stores/grid-projects";
import { list as listCatalog } from "@/lib/stores/catalog";
import { getSettings } from "@/lib/settings";
import { formatMeasure, type MeasureUnit } from "@/lib/annotations";
import { spaceOf } from "@/lib/design/grid-geometry";
import { riserGraph } from "@/lib/design/grid-riser";
import { curtainDesc } from "@/lib/design/grid-bom";
import { PrintButton } from "@/components/letter/print-button";

export const metadata = { title: "Equipment schedule — Quartzite-6" };
export const dynamic = "force-dynamic";

/**
 * Per-space equipment schedule (D113 item 3) — the field document: what
 * hangs in which room, plus the wire runs between rooms. Deliberately NO
 * prices; this is the sheet you hand an electrician or GC, not a quote.
 * Derived on every load from the same computed assignment as the editor
 * (smallest containing polygon), so it can never drift from the plan.
 */
export default async function SchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const project = await getProject(decodeURIComponent(id));
  if (!project) {
    return (
      <div style={{ padding: 24, fontSize: 13.5 }}>
        <p style={{ marginBottom: 10 }}>That design no longer exists.</p>
        <Link href="/design/grid" style={{ color: "#3155a8" }}>← Back to The Grid</Link>
      </div>
    );
  }

  const [catalog, settings] = await Promise.all([listCatalog(), getSettings()]);
  const accent = settings.accent || "#b08d4a";
  const partById = new Map(catalog.map((p) => [p.id, p]));
  const placements = project.placements || [];
  const spaces = project.spaces || [];
  const routes = project.routes || [];

  // Devices grouped per space (same computed assignment as everywhere else).
  // `code` overrides the printed Part cell for rows with no SKU (curtains).
  type Row = { partId: string; code?: string; desc: string; qty: number };
  const bySpace = new Map<string | null, Row[]>();
  for (const pl of placements) {
    const home = spaceOf(pl, spaces);
    const key = home ? home.id : null;
    const rows = bySpace.get(key) || [];
    // Curtains (punch #49) never group: each drop is its own made-to-size
    // drape, so it gets its own row keyed by placement id, described by the
    // name/type/size/fullness/fabric the designer specced.
    if (pl.curtain) {
      rows.push({
        partId: pl.id,
        code: "CURTAIN",
        desc: curtainDesc(pl.curtain, partById.get(pl.curtain.fabricSku)?.desc),
        qty: 1,
      });
      bySpace.set(key, rows);
      continue;
    }
    const row = rows.find((r) => r.partId === pl.partId);
    if (row) row.qty += 1;
    else
      rows.push({
        partId: pl.partId,
        desc: partById.get(pl.partId)?.desc || "(no longer in the catalog)",
        qty: 1,
      });
    bySpace.set(key, rows);
  }

  // Wire runs with endpoints + lengths, via the same derivation as the riser.
  const graph = riserGraph(
    placements,
    routes,
    spaces,
    catalog.map((p) => ({ id: p.id, sku: p.sku, desc: p.desc, category: p.category, unit: p.unit, list: p.list, cost: p.cost })),
    project.calibrations || []
  );

  // Footer rollups: total devices + total footage per wire part.
  // Curtains are counted separately from devices (punch #49).
  const deviceCount = placements.filter((pl) => !pl.curtain).length;
  const wireFeet = new Map<string, { ft: number; unit: string; unmeasured: number }>();
  for (const e of graph.edges) {
    const w = wireFeet.get(e.partId) || { ft: 0, unit: e.unit, unmeasured: 0 };
    if (e.lengthFt === null) w.unmeasured += 1;
    else w.ft += e.lengthFt;
    wireFeet.set(e.partId, w);
  }

  const th: React.CSSProperties = {
    textAlign: "left",
    fontSize: "9pt",
    letterSpacing: ".08em",
    textTransform: "uppercase",
    color: "#666",
    borderBottom: "1.5px solid #1a1a1a",
    padding: "3px 8px 5px 0",
    fontFamily: "var(--font-ui), sans-serif",
  };
  const td: React.CSSProperties = {
    padding: "5px 8px 5px 0",
    borderBottom: "1px solid #e2e2e6",
    fontSize: "11.5pt",
    verticalAlign: "top",
  };

  const sections: Array<{ key: string; name: string; rows: Row[] }> = [
    ...spaces
      .filter((s) => bySpace.has(s.id))
      .map((s) => ({ key: s.id, name: s.name, rows: bySpace.get(s.id)! })),
    ...(bySpace.has(null) ? [{ key: "un", name: "Unassigned", rows: bySpace.get(null)! }] : []),
  ];

  return (
    <div className="pk-content" style={{ padding: "26px 30px 64px" }}>
      <div className="pk-doc-toolbar">
        <Link
          href={`/design/grid/${encodeURIComponent(project.id)}`}
          style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--accent)", marginRight: "auto", textDecoration: "none" }}
        >
          ← {project.name}
        </Link>
        <PrintButton accent={accent} />
      </div>

      <div className="pk-doc-page">
        {/* header */}
        <div style={{ borderBottom: `3px solid ${accent}`, paddingBottom: 10, marginBottom: 18 }}>
          <div style={{ fontFamily: "var(--font-mono), monospace", fontSize: "8pt", letterSpacing: ".14em", textTransform: "uppercase", color: "#666" }}>
            {settings.companyName || "Peak Systems Group"} · Equipment schedule
          </div>
          <div style={{ fontSize: "17pt", fontWeight: 700, marginTop: 2 }}>{project.name}</div>
          <div style={{ fontSize: "11pt", color: "#444", marginTop: 1 }}>
            {project.customer || "—"}
            {" · "}
            {new Date(project.updatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
            {" · "}
            {(project.sheetIds || []).length} sheet{(project.sheetIds || []).length === 1 ? "" : "s"} · {project.id}
          </div>
        </div>

        {sections.length === 0 && graph.edges.length === 0 ? (
          <p style={{ color: "#666" }}>Nothing on the plans yet.</p>
        ) : (
          <>
            {sections.map((sec) => (
              <div key={sec.key} style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "var(--font-ui), sans-serif", fontSize: "10.5pt", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "#1a1a1a", borderBottom: `2px solid ${accent}`, display: "inline-block", paddingBottom: 1, marginBottom: 6 }}>
                  {sec.name}
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, width: 54 }}>Qty</th>
                      <th style={{ ...th, width: 150 }}>Part</th>
                      <th style={th}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sec.rows.map((r) => (
                      <tr key={r.partId}>
                        <td style={td}>{r.qty}</td>
                        <td style={{ ...td, fontFamily: "var(--font-mono), monospace", fontSize: "10pt" }}>{r.code || r.partId}</td>
                        <td style={td}>{r.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

            {graph.edges.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "var(--font-ui), sans-serif", fontSize: "10.5pt", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "#1a1a1a", borderBottom: `2px solid ${accent}`, display: "inline-block", paddingBottom: 1, marginBottom: 6 }}>
                  Wire runs
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, width: 150 }}>Wire</th>
                      <th style={th}>Run</th>
                      <th style={{ ...th, width: 110 }}>Length</th>
                    </tr>
                  </thead>
                  <tbody>
                    {graph.edges.map((e) => (
                      <tr key={e.routeId}>
                        <td style={{ ...td, fontFamily: "var(--font-mono), monospace", fontSize: "10pt" }}>{e.partId}</td>
                        <td style={td}>{e.fromName} → {e.toName}</td>
                        <td style={td}>
                          {e.lengthFt !== null ? formatMeasure(e.lengthFt, e.unit as MeasureUnit) : "unmeasured"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* footer rollup */}
            <div style={{ borderTop: "1.5px solid #1a1a1a", marginTop: 20, paddingTop: 8, fontSize: "10.5pt", color: "#444" }}>
              <strong>{deviceCount}</strong> device{deviceCount === 1 ? "" : "s"} across{" "}
              <strong>{sections.length}</strong> area{sections.length === 1 ? "" : "s"}
              {[...wireFeet.entries()].map(([partId, w]) => (
                <span key={partId}>
                  {" · "}
                  <strong>{Math.ceil(w.ft)} {w.unit}</strong> {partId}
                  {w.unmeasured > 0 ? ` (+${w.unmeasured} unmeasured)` : ""}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
