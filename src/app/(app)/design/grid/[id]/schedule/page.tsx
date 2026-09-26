import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getProject } from "@/lib/stores/grid-projects";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listGridSymbols } from "@/lib/stores/grid-catalog";
import { getSettings } from "@/lib/settings";
import { resolveCategoryMap } from "@/lib/catalog-taxonomy";
import { formatMeasure, type MeasureUnit } from "@/lib/annotations";
import { optionSlice, resolveOptionId } from "@/lib/design/grid-options";
import { gridPartsFrom } from "@/lib/design/grid-parts";
import { loadVirtualParts } from "@/lib/stores/equipment-map";
import { symbolContext } from "@/lib/design/grid-icons";
import { riserViewForOption } from "@/lib/design/grid-riser-view";
import { buildSchedule, scheduleWiresFromView } from "@/lib/design/grid-schedule";
import { PrintButton } from "@/components/letter/print-button";

export const metadata = { title: "Equipment schedule — Quartzite-6" };
export const dynamic = "force-dynamic";
// Virtual parts (#211) reach listFixtures() on this page — same budget as the editor.
export const maxDuration = 60;

/**
 * Per-space equipment schedule (D113 item 3) — the field document: what
 * hangs in which room, plus the wire runs (routes and typed riser links,
 * #209) between rooms. Deliberately NO prices. Built by the same
 * buildSchedule the drawing set's E-60x sheets use, so the two never differ.
 */
export default async function SchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ option?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const { option: requestedOption } = await searchParams;
  const project = await getProject(decodeURIComponent(id));
  if (!project) {
    return (
      <div style={{ padding: 24, fontSize: 13.5 }}>
        <p style={{ marginBottom: 10 }}>That design no longer exists.</p>
        <Link href="/design/designs" style={{ color: "#3155a8" }}>← Back to The Grid</Link>
      </div>
    );
  }

  const optionId = resolveOptionId(project, requestedOption);
  const option = project.options!.find((o) => o.id === optionId)!;
  const slice = optionSlice(project, optionId);
  const optionQuery = `?option=${encodeURIComponent(optionId)}`;

  const [catalog, gridSymbols, settings] = await Promise.all([listCatalog(), listGridSymbols(), getSettings()]);
  const accent = settings.accent || "#b08d4a";
  const parts = [
    ...gridPartsFrom(gridSymbols, catalog, resolveCategoryMap(settings.catalogCategoryMap), { catalogFallback: true }),
    ...(await loadVirtualParts((project.placements || []).map((pl) => pl.partId), catalog)),
  ];
  const partById = new Map(parts.map((p) => [p.id, p]));
  const spaces = project.spaces || [];
  const view = riserViewForOption({ project, optionId, parts, symCtx: symbolContext(settings) });
  const { sections, wires, unitCount, wireFeet } = buildSchedule({
    placements: slice.placements,
    spaces,
    descOf: (pid) => partById.get(pid)?.desc,
    wires: scheduleWiresFromView(view),
  });

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
  const sectionHead: React.CSSProperties = {
    fontFamily: "var(--font-ui), sans-serif",
    fontSize: "10.5pt",
    fontWeight: 700,
    letterSpacing: ".04em",
    textTransform: "uppercase",
    color: "#1a1a1a",
    borderBottom: `2px solid ${accent}`,
    display: "inline-block",
    paddingBottom: 1,
    marginBottom: 6,
  };

  return (
    <div className="pk-content" style={{ padding: "26px 30px 64px" }}>
      <div className="pk-doc-toolbar">
        <Link
          href={`/design/grid/${encodeURIComponent(project.id)}${optionQuery}`}
          style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--accent)", marginRight: "auto", textDecoration: "none" }}
        >
          ← {project.name}
        </Link>
        <PrintButton accent={accent} />
      </div>

      <div className="pk-doc-page">
        <div style={{ borderBottom: `3px solid ${accent}`, paddingBottom: 10, marginBottom: 18 }}>
          <div style={{ fontFamily: "var(--font-mono), monospace", fontSize: "8pt", letterSpacing: ".14em", textTransform: "uppercase", color: "#666" }}>
            {settings.companyName || "Peak Systems Group"} · Equipment schedule
          </div>
          <div style={{ fontSize: "17pt", fontWeight: 700, marginTop: 2 }}>{project.name}{project.options!.length > 1 ? ` · ${option.name}` : ""}</div>
          <div style={{ fontSize: "11pt", color: "#444", marginTop: 1 }}>
            {project.customer || "—"}
            {" · "}
            {new Date(project.updatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
            {" · "}
            {(project.sheetIds || []).length} sheet{(project.sheetIds || []).length === 1 ? "" : "s"} · {project.id}
          </div>
        </div>

        {sections.length === 0 && wires.length === 0 ? (
          <p style={{ color: "#666" }}>Nothing on the plans yet.</p>
        ) : (
          <>
            {sections.map((sec) => (
              <div key={sec.key} style={{ marginBottom: 16 }}>
                <div style={sectionHead}>{sec.name}</div>
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

            {wires.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={sectionHead}>Wire runs</div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, width: 150 }}>Wire</th>
                      <th style={th}>Run</th>
                      <th style={{ ...th, width: 110 }}>Length</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wires.map((e) => (
                      <tr key={e.id}>
                        <td style={{ ...td, fontFamily: "var(--font-mono), monospace", fontSize: "10pt" }}>{e.partId}</td>
                        <td style={td}>{e.fromName} → {e.toName}</td>
                        <td style={td}>{e.lengthFt !== null ? formatMeasure(e.lengthFt, e.unit as MeasureUnit) : "unmeasured"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ borderTop: "1.5px solid #1a1a1a", marginTop: 20, paddingTop: 8, fontSize: "10.5pt", color: "#444" }}>
              <strong>{unitCount}</strong> unit{unitCount === 1 ? "" : "s"} across{" "}
              <strong>{sections.length}</strong> area{sections.length === 1 ? "" : "s"}
              {wireFeet.map((w) => (
                <span key={w.partId}>
                  {" · "}
                  <strong>{Math.ceil(w.ft)} {w.unit}</strong> {w.partId}
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
