import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getProject, listSheets } from "@/lib/stores/grid-projects";
import { list as listCatalog } from "@/lib/stores/catalog";
import { getSettings } from "@/lib/settings";
import { groupOf, resolveCategoryMap, tradeOf } from "@/lib/catalog-taxonomy";
import { DEFAULT_VENUE_DIMS, type VenueDims } from "@/lib/design/venue-dims";
import { linesetScheduleReport } from "@/lib/design/grid-lineset-schedule";
import { PrintButton } from "@/components/letter/print-button";

export const metadata = { title: "Lineset schedule — Quartzite-6" };
export const dynamic = "force-dynamic";

/**
 * Lineset schedule (punch #41) — READ-ONLY, derived on every load from the
 * rigging and curtain items PAINTED ON THE PLAN, in the lineset workbook's
 * own downstage-to-upstage vocabulary.
 *
 * This is NOT the lineset builder (design/lineset): that one auto-places an
 * ideal layout from venue dimensions. This one reports the layout that
 * actually exists, so it can never drift from the drawing. Everything it
 * cannot honestly derive is printed as a note on the row rather than guessed
 * — see grid-lineset-schedule.ts's header.
 */
export default async function LinesetSchedulePage({
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

  const [sheets, catalog, settings] = await Promise.all([
    listSheets(project.id),
    listCatalog(),
    getSettings(),
  ]);
  const accent = settings.accent || "#b08d4a";

  // Group/trade are resolved SERVER-SIDE against the admin-editable category
  // map, exactly as the editor route does — "Rigging" is a trade, never a
  // literal category string, so the schedule's filter depends on this.
  const categoryMap = resolveCategoryMap(settings.catalogCategoryMap);
  const parts = catalog.map((p) => ({
    id: p.id,
    desc: p.desc,
    category: p.category,
    group: groupOf(p, categoryMap),
    trade: tradeOf(p, categoryMap),
  }));

  // Dims come from the generated base sheet when the design has one (#38);
  // an uploaded-only design has no stated venue dimensions anywhere, so the
  // defaults stand in and the page says so.
  const generated = sheets.find((s) => s.kind === "generated" && s.venueDims);
  const dims: VenueDims = generated?.venueDims ?? DEFAULT_VENUE_DIMS;
  const dimsAreAssumed = !generated;

  const { rows, skipped } = linesetScheduleReport(project.placements || [], dims, parts);

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
        <div style={{ borderBottom: `3px solid ${accent}`, paddingBottom: 10, marginBottom: 18 }}>
          <div style={{ fontFamily: "var(--font-mono), monospace", fontSize: "8pt", letterSpacing: ".14em", textTransform: "uppercase", color: "#666" }}>
            {settings.companyName || "Peak Systems Group"} · Lineset schedule
          </div>
          <div style={{ fontSize: "17pt", fontWeight: 700, marginTop: 2 }}>{project.name}</div>
          <div style={{ fontSize: "11pt", color: "#444", marginTop: 1 }}>
            {project.customer || "—"}
            {" · "}
            {new Date(project.updatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
            {" · "}
            {dims.proWidthFt}′ × {dims.proHeightFt}′ opening, {dims.stageDepthFt}′ deep · {project.id}
          </div>
        </div>

        {rows.length === 0 ? (
          <p style={{ color: "#666" }}>
            No rigging or curtain items on the plan yet — paint pipe, track, hoists or drop a
            curtain and every one of them lands on this schedule.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 52 }}>Slot</th>
                <th style={{ ...th, width: 92 }}>DS</th>
                <th style={{ ...th, width: 92 }}>US</th>
                <th style={{ ...th, width: 118 }}>Type</th>
                <th style={th}>Name</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.placementId}>
                  <td style={{ ...td, fontFamily: "var(--font-mono), monospace", fontSize: "10pt" }}>{r.slot}</td>
                  <td style={td}>{r.dsPositionLabel}</td>
                  <td style={td}>{r.usPositionLabel}</td>
                  <td style={td}>{r.type || <span style={{ color: "#999" }}>—</span>}</td>
                  <td style={td}>
                    {r.name}
                    {r.unresolved.length > 0 && (
                      <div style={{ fontSize: "9.5pt", color: "#8a6d3b", marginTop: 2 }}>
                        {r.unresolved.map((u, i) => (
                          <div key={i}>· {u}</div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Nothing silently skipped — the same ethos as bid-spec's MatchReport. */}
        {skipped.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontFamily: "var(--font-ui), sans-serif", fontSize: "10.5pt", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "#1a1a1a", borderBottom: `2px solid ${accent}`, display: "inline-block", paddingBottom: 1, marginBottom: 6 }}>
              Not on this schedule
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {skipped.map((s) => (
                  <tr key={s.placementId}>
                    <td style={{ ...td, width: 150, fontFamily: "var(--font-mono), monospace", fontSize: "10pt" }}>{s.partId}</td>
                    <td style={{ ...td, color: "#666" }}>{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ borderTop: "1.5px solid #1a1a1a", marginTop: 20, paddingTop: 8, fontSize: "10.5pt", color: "#444" }}>
          <strong>{rows.length}</strong> line{rows.length === 1 ? "" : "s"} from the plan
          {skipped.length > 0 ? ` · ${skipped.length} placement${skipped.length === 1 ? "" : "s"} not scheduled` : ""}
        </div>

        {/* The honest caveats, said out loud rather than buried. The depth
            axis is only ambiguous on an UPLOADED plan — a generated base sheet
            draws the back wall at the top and the plaster line at the bottom,
            so its depths are real, not indicative. */}
        <div className="pk-no-print" style={{ marginTop: 14, fontSize: "10pt", color: "#8c919c", lineHeight: 1.55 }}>
          Positions are measured upstage of the plaster line, from each marker&rsquo;s place on
          the plan&rsquo;s depth axis (upstage 0 → downstage 1) against the{" "}
          {dims.stageDepthFt}′ stage depth
          {dimsAreAssumed
            ? " assumed for this design — it has no generated base sheet stating its dimensions. An uploaded plan also states no orientation or scale of its own, so treat these depths as indicative until the sheet is calibrated."
            : " stated by this design's generated base sheet, whose depth axis these positions follow."}{" "}
          Nothing here is typed by guess: a line reads &ldquo;—&rdquo; until the placement is
          labelled with a lineset type.
        </div>
      </div>
    </div>
  );
}
