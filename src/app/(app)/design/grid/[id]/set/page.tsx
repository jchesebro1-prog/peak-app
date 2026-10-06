import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getProject } from "@/lib/stores/grid-projects";
import { SHEET_SIZES, printPageCss, toggleableSheets } from "@/lib/design/grid-drawing-set";
import { loadDrawingSetData, TEAM_DRAWING_SET_ASSETS } from "@/lib/design/drawing-set-data";
import { DrawingSetSheets } from "@/components/drawing/drawing-set-sheets";
import { PrintButton } from "@/components/letter/print-button";
import SetSettingsPanel from "./set-settings-panel";

export const metadata = { title: "Drawing set — Quartzite-6" };
export const dynamic = "force-dynamic";
// Virtual parts (#211) reach listFixtures() on this page — same budget as the editor.
export const maxDuration = 60;

/**
 * The drawing set (#209, spec 2026-09-25 §3): every sheet is one printed
 * page with the architectural title strip — T-001 cover (project, sheet
 * index, symbol legend, general notes), one plan sheet per system per source
 * page, E-501 riser (the saved riser layout), E-60x equipment schedules (no
 * prices). `?size=b|d` overrides the saved size; `?option=` resolves like
 * the riser and schedule. Printed with the shared PrintButton. #301 slice C:
 * the data and the sheets are shared with /print/grid-set/[id].
 */
export default async function DrawingSetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ option?: string; size?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const { option: requestedOption, size: requestedSize } = await searchParams;
  const project = await getProject(decodeURIComponent(id));
  if (!project) {
    return (
      <div style={{ padding: 24, fontSize: 13.5 }}>
        <p style={{ marginBottom: 10 }}>That design no longer exists.</p>
        <Link href="/design/designs" style={{ color: "#3155a8" }}>← Back to The Grid</Link>
      </div>
    );
  }

  const data = await loadDrawingSetData(project, { requestedOption, requestedSize, assets: TEAM_DRAWING_SET_ASSETS });
  const { optionId, options, option, size, set, all, included, revRows, accent } = data;
  const base = `/design/grid/${encodeURIComponent(project.id)}`;
  const optionQuery = `?option=${encodeURIComponent(optionId)}`;

  return (
    <div className="pk-content" style={{ maxWidth: "none", padding: "22px 24px 64px" }}>
      <style>{printPageCss(size)}</style>
      <div className="pk-doc-toolbar" style={{ maxWidth: "none", justifyContent: "flex-start", flexWrap: "wrap" }}>
        <Link href={`${base}${optionQuery}`} style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--accent)", textDecoration: "none" }}>
          ← {project.name}
        </Link>
        <Link href={`${base}/riser${optionQuery}`} style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--accent)", textDecoration: "none", marginLeft: 14 }}>
          Riser editor →
        </Link>
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: "#8c919c", fontFamily: "var(--font-ui)" }}>
          {`${SHEET_SIZES[size].label} · ${included.length} sheet${included.length === 1 ? "" : "s"}${options.length > 1 ? ` · ${option.name}` : ""}`}
        </span>
        {/* Disabled until every plan figure has painted (or failed). */}
        <PrintButton accent={accent} waitFor="[data-plan-figure]" />
      </div>
      <SetSettingsPanel
        projectId={project.id}
        optionId={optionId}
        size={size}
        set={set}
        defaultDrawnBy={project.createdBy}
        toggles={toggleableSheets(all)}
        revisions={revRows.map((r) => ({ rev: r.rev, letter: r.letter, note: (project.revisions || []).find((x) => x.rev === r.rev)?.note || "" }))}
        standardNotes={data.gridStandardNotes}
      />
      <DrawingSetSheets data={data} assets={TEAM_DRAWING_SET_ASSETS} />
    </div>
  );
}
