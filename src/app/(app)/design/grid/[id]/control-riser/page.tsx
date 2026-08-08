import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getProject } from "@/lib/stores/grid-projects";
import { list as listCatalog } from "@/lib/stores/catalog";
import { getSettings } from "@/lib/settings";
import { groupOf, resolveCategoryMap, tradeOf } from "@/lib/catalog-taxonomy";
import { controlRiserGraph } from "@/lib/design/grid-control-riser";
import { PrintButton } from "@/components/letter/print-button";

export const metadata = { title: "Control Riser — Quartzite-6" };
export const dynamic = "force-dynamic";

/**
 * Control Riser (punch #41) — READ-ONLY, derived on every load: the
 * lighting/rigging CIRCUITING one-line. Each node is a circuit (a dimmer /
 * relay feed, a DMX universe, a motor-power run), and the fixtures and
 * rigging devices painted on the plan hang off the circuits their declared
 * ports put them on.
 *
 * Distinct from "Riser sketch" (the AV signal one-line, grouped by space)
 * and from the Quick estimator's parametric "Control riser" — see
 * grid-control-riser.ts's header for why all three exist.
 */
export default async function ControlRiserPage({
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

  // Group/trade resolved server-side against the admin-editable map, as the
  // editor route does — the Lighting/Rigging filter depends on it.
  const categoryMap = resolveCategoryMap(settings.catalogCategoryMap);
  const parts = catalog.map((p) => ({
    id: p.id,
    desc: p.desc,
    category: p.category,
    group: groupOf(p, categoryMap),
    trade: tradeOf(p, categoryMap),
    ...(p.ports && p.ports.length > 0 ? { ports: p.ports } : {}),
  }));

  const graph = controlRiserGraph(project.placements || [], project.routes || [], parts);
  const deviceTotal = graph.nodes.reduce((n, c) => n + c.deviceCount, 0);

  // ---- layout: a distribution bus across the top, one column per circuit ----
  const COL_W = 220;
  const COL_GAP = 26;
  const PAD = 24;
  const BUS_Y = PAD + 16;
  const TOP = BUS_Y + 30;
  const HEAD_H = 34;
  const LINE_H = 17;
  const runsOf = (conn: string) => graph.edges.filter((e) => e.connectionType === conn);
  const nodeH = (n: (typeof graph.nodes)[number]) =>
    HEAD_H + Math.max(1, n.devices.length) * LINE_H + 10;
  const maxH = Math.max(60, ...graph.nodes.map(nodeH));
  const maxRuns = Math.max(0, ...graph.nodes.map((n) => runsOf(n.connectionType).length));
  const xOf = new Map(graph.nodes.map((n, i) => [n.connectionType, PAD + i * (COL_W + COL_GAP)]));
  const width = PAD * 2 + graph.nodes.length * COL_W + Math.max(0, graph.nodes.length - 1) * COL_GAP;
  const runBase = TOP + maxH + 20;
  const height = runBase + maxRuns * 22 + 30;

  return (
    <div className="pk-content" style={{ maxWidth: 1160, padding: "26px 30px 64px" }}>
      <style>{`@media print { .grid-control-riser-card { border: none !important; box-shadow: none !important; padding: 0 !important; } }`}</style>
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
        <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Control Riser</h1>
        <span style={{ color: "#8c919c", fontSize: 13 }}>
          {project.name}
          {project.customer ? ` · ${project.customer}` : ""} ·{" "}
          {new Date(project.updatedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })} · {project.id}
        </span>
      </div>
      <p className="pk-no-print" style={{ color: "#8c919c", fontSize: 13, marginBottom: 22 }}>
        Lighting and rigging circuiting, derived live from the plan — one column per circuit,
        fed by the connectors each painted device declares. A fixture with both power and data
        appears on both circuits, because that is two home runs. AV signal lives on the{" "}
        <Link href={`/design/grid/${encodeURIComponent(project.id)}/riser`} style={{ color: "#3155a8" }}>
          Riser sketch
        </Link>
        , not here.
      </p>

      {graph.nodes.length === 0 ? (
        <div className="pk-card" style={{ padding: "18px 20px", fontSize: 13, color: "#8c919c" }}>
          No circuited lighting or rigging devices on the plan yet — paint a fixture whose
          catalog part declares its connectors and its circuits show up here.
        </div>
      ) : (
        <div className="pk-card grid-control-riser-card" style={{ padding: 18, overflowX: "auto" }}>
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
            {/* distribution bus — every circuit is fed from one service */}
            <line x1={PAD} y1={BUS_Y} x2={width - PAD} y2={BUS_Y} stroke="#16181d" strokeWidth={2.2} />
            <text x={PAD} y={BUS_Y - 8} fontSize={11} fontWeight={700} fill="#16181d" style={{ fontFamily: "inherit" }}>
              CONTROL DISTRIBUTION
            </text>
            {graph.nodes.map((n) => {
              const x = xOf.get(n.connectionType)!;
              const h = nodeH(n);
              const runs = runsOf(n.connectionType);
              return (
                <g key={n.connectionType}>
                  <line x1={x + COL_W / 2} y1={BUS_Y} x2={x + COL_W / 2} y2={TOP} stroke={n.color} strokeWidth={1.6} />
                  <circle cx={x + COL_W / 2} cy={BUS_Y} r={3.4} fill="#16181d" />
                  <rect x={x} y={TOP} width={COL_W} height={h} rx={9} fill="#fff" stroke={n.color} strokeWidth={1.6} />
                  <rect x={x} y={TOP} width={COL_W} height={HEAD_H - 6} rx={9} fill={n.color} opacity={0.14} />
                  <text x={x + 12} y={TOP + 14} fontSize={12} fontWeight={700} fill="#16181d" style={{ fontFamily: "inherit" }}>
                    {n.name}
                  </text>
                  <text x={x + 12} y={TOP + 26} fontSize={9.5} fill="#5b616e" style={{ fontFamily: "inherit" }}>
                    {n.family.toUpperCase()} · {n.deviceCount} device{n.deviceCount === 1 ? "" : "s"}
                  </text>
                  {n.devices.map((d, di) => (
                    <text key={d.partId} x={x + 12} y={TOP + HEAD_H + 12 + di * LINE_H} fontSize={11.5} fill="#3d424e" style={{ fontFamily: "inherit" }}>
                      {d.qty}× {d.desc.length > 28 ? `${d.desc.slice(0, 27)}…` : d.desc}
                    </text>
                  ))}
                  {runs.map((e, ri) => (
                    <g key={e.routeId}>
                      <line x1={x + 16} y1={runBase + ri * 22} x2={x + COL_W - 16} y2={runBase + ri * 22} stroke={n.color} strokeWidth={1.4} strokeDasharray="4 3" />
                      <text x={x + 16} y={runBase + ri * 22 - 4} fontSize={10} fill="#5b616e" style={{ fontFamily: "inherit" }}>
                        run · {e.partId}
                      </text>
                    </g>
                  ))}
                  {runs.length === 0 && (
                    <line x1={x + COL_W / 2} y1={TOP + h} x2={x + COL_W / 2} y2={runBase} stroke="#e2e2e6" strokeWidth={1} strokeDasharray="3 3" />
                  )}
                </g>
              );
            })}
          </svg>
          <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 8 }}>
            {deviceTotal} circuit connection{deviceTotal === 1 ? "" : "s"} across {graph.nodes.length}{" "}
            circuit{graph.nodes.length === 1 ? "" : "s"}
            {graph.edges.length > 0
              ? ` · ${graph.edges.length} routed run${graph.edges.length === 1 ? "" : "s"}`
              : " · no routed runs yet"}
            . A device on two circuits is counted once per circuit.
          </div>
        </div>
      )}

      {/* Nothing silently skipped. */}
      {graph.skipped.length > 0 && (
        <div className="pk-card" style={{ padding: "14px 18px", marginTop: 16 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Not on this riser</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <tbody>
              {graph.skipped.map((s) => (
                <tr key={`${s.kind}-${s.id}`}>
                  <td style={{ padding: "3px 10px 3px 0", width: 70, color: "#9aa0ab" }}>{s.kind}</td>
                  <td style={{ padding: "3px 10px 3px 0", width: 160, fontFamily: "var(--font-mono), monospace", fontSize: 11.5 }}>{s.partId}</td>
                  <td style={{ padding: "3px 0", color: "#5b616e" }}>{s.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
