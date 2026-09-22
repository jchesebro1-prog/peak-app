import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getProject } from "@/lib/stores/grid-projects";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listGridSymbols } from "@/lib/stores/grid-catalog";
import { getSettings } from "@/lib/settings";
import { formatMeasure, type MeasureUnit } from "@/lib/annotations";
import { riserGraph } from "@/lib/design/grid-riser";
import { markerColor, shapeFor, type GridShape } from "@/lib/design/grid-symbols";
import { SymbolIcon, SymbolShape } from "@/components/design/symbol-shape";
import type { PartLite } from "@/lib/design/grid-bom";
import { PrintButton } from "@/components/letter/print-button";

export const metadata = { title: "Riser sketch — Quartzite-6" };
export const dynamic = "force-dynamic";

/**
 * Riser / one-line sketch (D112) — READ-ONLY, derived from the plan on
 * every load: spaces become nodes, device counts group inside them, and
 * each wire run is an edge between the spaces its endpoints land in.
 * Redraw a space or reroute a wire and this page is already correct.
 * (DaVinci's editable riser with real auto-layout is the later phase —
 * this is the sketch that makes the design conversation possible.)
 */
export default async function RiserPage({
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
        <Link href="/design/designs" style={{ color: "#3155a8" }}>← Back to The Grid</Link>
      </div>
    );
  }

  const [catalog, gridSymbols, settings] = await Promise.all([listCatalog(), listGridSymbols(), getSettings()]);
  const accent = settings.accent || "#b08d4a";
  // #131: placements point at Grid-library entries (which carry the symbol
  // override); pricing rows fill in anything not in the library so every
  // placement still resolves a description.
  const seen = new Set<string>();
  const parts: PartLite[] = [];
  for (const s of gridSymbols) {
    seen.add(s.id);
    parts.push({ id: s.id, sku: s.modelNumber || s.id, desc: s.name, category: s.category || "Other", unit: "ea", list: 0, cost: 0, shape: s.shape ?? null });
  }
  for (const p of catalog) {
    if (seen.has(p.id)) continue;
    parts.push({ id: p.id, sku: p.sku, desc: p.desc, category: p.category, unit: p.unit, list: p.list, cost: p.cost });
  }
  const graph = riserGraph(
    project.placements || [],
    project.routes || [],
    project.spaces || [],
    parts,
    project.calibrations || []
  );
  // Legend: one row per shape actually drawn, in first-seen order. Keyed on
  // shape+category (not category alone) so a per-entry symbol override (one
  // device drawn with a different glyph than its category default) gets its
  // own row instead of being swallowed by whichever glyph was seen first for
  // that category (#131 review).
  const legend: Array<{ key: string; shape: GridShape; color: string; label: string }> = [];
  for (const n of graph.nodes) {
    for (const g of n.groups) {
      const category = g.category || "Uncategorized";
      const shape = shapeFor({ category: g.category, shape: g.shape }, settings);
      const key = `${shape}|${category}`;
      if (legend.some((l) => l.key === key)) continue;
      const categoryDefault = shapeFor({ category: g.category }, settings);
      const label = shape === categoryDefault ? category : `${category} — ${g.desc || g.partId}`;
      legend.push({ key, shape, color: markerColor(g.category), label });
    }
  }

  // ---- layout: nodes as columns, edges as arcs underneath ----
  const COL_W = 216;
  const COL_GAP = 26;
  const PAD = 24;
  const HEAD_H = 30;
  const LINE_H = 17;
  const nodeH = (g: (typeof graph.nodes)[number]) => HEAD_H + Math.max(1, g.groups.length) * LINE_H + 10;
  const maxH = Math.max(60, ...graph.nodes.map(nodeH));
  const xOf = new Map(graph.nodes.map((n, i) => [n.spaceId, PAD + i * (COL_W + COL_GAP)]));
  const width = PAD * 2 + graph.nodes.length * COL_W + Math.max(0, graph.nodes.length - 1) * COL_GAP;
  const edgeBase = PAD + maxH + 18;
  const height = edgeBase + Math.max(1, graph.edges.length) * 26 + 40;

  return (
    <div className="pk-content" style={{ maxWidth: 1160, padding: "26px 30px 64px" }}>
      {/* print (D113.7): chrome hides via .pk-doc-toolbar/.pk-no-print rules */}
      <style>{`@media print { .grid-riser-card { border: none !important; box-shadow: none !important; padding: 0 !important; } }`}</style>
      <div className="pk-doc-toolbar" style={{ maxWidth: "none", justifyContent: "flex-start" }}>
        <Link
          href={`/design/grid/${encodeURIComponent(project.id)}`}
          style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--accent)", textDecoration: "none", marginRight: "auto" }}
        >
          ← {project.name}
        </Link>
        <PrintButton accent={accent} />
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
        <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Riser sketch</h1>
        <span style={{ color: "#8c919c", fontSize: 13 }}>
          {project.name}
          {project.customer ? ` · ${project.customer}` : ""} ·{" "}
          {new Date(project.updatedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })} · {project.id}
        </span>
      </div>
      <p className="pk-no-print" style={{ color: "#8c919c", fontSize: 13, marginBottom: 22 }}>
        Derived live from the plan — devices grouped by space, wire runs as
        connections. Nothing here is drawn by hand, so it can never drift from
        the layout.
      </p>

      {graph.nodes.length === 0 ? (
        <div className="pk-card" style={{ padding: "18px 20px", fontSize: 13, color: "#8c919c" }}>
          Nothing to sketch yet — paint devices and draw spaces on the plan first.
        </div>
      ) : (
        <div className="pk-card grid-riser-card" style={{ padding: 18, overflowX: "auto" }}>
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
            {graph.nodes.map((n) => {
              const x = xOf.get(n.spaceId)!;
              const h = nodeH(n);
              return (
                <g key={n.spaceId ?? "unassigned"}>
                  <rect x={x} y={PAD} width={COL_W} height={h} rx={9} fill="#fff" stroke={n.color} strokeWidth={1.6} />
                  <rect x={x} y={PAD} width={COL_W} height={HEAD_H - 6} rx={9} fill={n.color} opacity={0.14} />
                  <text x={x + 12} y={PAD + 17} fontSize={12.5} fontWeight={700} fill="#16181d" style={{ fontFamily: "inherit" }}>
                    {n.name}
                  </text>
                  {n.groups.length === 0 ? (
                    <text x={x + 12} y={PAD + HEAD_H + 12} fontSize={11} fill="#9aa0ab" style={{ fontFamily: "inherit" }}>
                      no devices
                    </text>
                  ) : (
                    n.groups.map((g, gi) => {
                      const ly = PAD + HEAD_H + 8 + gi * LINE_H;
                      return (
                        <g key={g.partId}>
                          <SymbolShape shape={shapeFor({ category: g.category, shape: g.shape }, settings)} x={x + 19} y={ly} w={14} h={11} color={markerColor(g.category)} />
                          <text x={x + 30} y={ly + 4} fontSize={11.5} fill="#3d424e" style={{ fontFamily: "inherit" }}>
                            {g.qty}× {g.partId}
                          </text>
                        </g>
                      );
                    })
                  )}
                  {/* drop stub to the edge rail */}
                  <line x1={x + COL_W / 2} y1={PAD + h} x2={x + COL_W / 2} y2={edgeBase} stroke="#c4c9d2" strokeWidth={1} strokeDasharray="3 3" />
                </g>
              );
            })}
            {graph.edges.map((e, i) => {
              const x1 = (xOf.get(e.fromSpaceId) ?? PAD) + COL_W / 2;
              const x2 = (xOf.get(e.toSpaceId) ?? PAD) + COL_W / 2;
              const y = edgeBase + i * 26;
              const mid = (x1 + x2) / 2;
              const label = `${e.partId}${e.lengthFt !== null ? ` · ${formatMeasure(e.lengthFt, e.unit as MeasureUnit)}` : " · unmeasured"}`;
              const same = x1 === x2;
              const d = same
                ? `M ${x1 - 24} ${y} a 24 16 0 1 0 48 0`
                : `M ${x1} ${y} C ${x1} ${y + 22}, ${x2} ${y + 22}, ${x2} ${y}`;
              return (
                <g key={e.routeId}>
                  <path d={d} fill="none" stroke="#3155a8" strokeWidth={1.8} />
                  <circle cx={x1} cy={y} r={3.2} fill="#3155a8" />
                  <circle cx={x2} cy={y} r={3.2} fill="#3155a8" />
                  <rect x={mid - label.length * 3.3 - 6} y={y + 6} width={label.length * 6.6 + 12} height={16} rx={4} fill="#fff" stroke="#c4c9d2" strokeWidth={0.8} />
                  <text x={mid} y={y + 17.5} fontSize={10.5} fontWeight={600} fill="#3155a8" textAnchor="middle" style={{ fontFamily: "inherit" }}>
                    {label}
                  </text>
                </g>
              );
            })}
          </svg>
          {legend.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 12, fontSize: 11.5, color: "#5b616e" }}>
              <span style={{ fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", fontSize: 10, color: "#9aa0ab", alignSelf: "center" }}>Legend</span>
              {legend.map((l) => (
                <span key={l.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <SymbolIcon shape={l.shape} color={l.color} size={14} />
                  {l.label}
                </span>
              ))}
            </div>
          )}
          {graph.edges.length === 0 && (
            <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 8 }}>
              No wire runs yet — routed wire shows up here as connections between spaces.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
