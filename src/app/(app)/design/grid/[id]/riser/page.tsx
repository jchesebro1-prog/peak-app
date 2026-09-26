import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getProject, listSheets } from "@/lib/stores/grid-projects";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listGridSymbols } from "@/lib/stores/grid-catalog";
import { getSettings } from "@/lib/settings";
import { resolveCategoryMap } from "@/lib/catalog-taxonomy";
import { isPerLengthUnit, type PartLite } from "@/lib/design/grid-bom";
import { optionSlice, resolveOptionId } from "@/lib/design/grid-options";
import { gridPartsFrom } from "@/lib/design/grid-parts";
import { loadVirtualParts } from "@/lib/stores/equipment-map";
import { riserViewForOption } from "@/lib/design/grid-riser-view";
import { legendRows, symbolContext, type SymbolEntry } from "@/lib/design/grid-icons";
import { SymbolIcon } from "@/components/design/symbol-shape";
import { PrintButton } from "@/components/letter/print-button";
import RiserEditor from "./riser-editor";

export const metadata = { title: "Riser — Quartzite-6" };
export const dynamic = "force-dynamic";
// Virtual parts (#GEM) reach listFixtures() on this page — same budget as the editor.
export const maxDuration = 60;

/**
 * The riser (D112 → editable, #209). Devices, spaces and wire runs are still
 * DERIVED from the plan on every load; the saved riser document adds node
 * positions, level lines, conduits, notes and typed-length links. Every tool
 * writes through the Grid project's actions, so the plan, BOM and quote see
 * the same devices the riser shows.
 */
export default async function RiserPage({
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
  const base = `/design/grid/${encodeURIComponent(project.id)}`;
  const optionQuery = `?option=${encodeURIComponent(optionId)}`;

  const [sheets, catalog, gridSymbols, settings] = await Promise.all([listSheets(project.id), listCatalog(), listGridSymbols(), getSettings()]);
  const accent = settings.accent || "#b08d4a";
  const categoryMap = resolveCategoryMap(settings.catalogCategoryMap);
  const symCtx = symbolContext(settings);
  // `library` = what can be placed; `parts` also resolves pre-library placements.
  const library = gridPartsFrom(gridSymbols, catalog, categoryMap);
  const parts = [
    ...gridPartsFrom(gridSymbols, catalog, categoryMap, { catalogFallback: true }),
    ...(await loadVirtualParts((project.placements || []).map((pl) => pl.partId), catalog)),
  ];
  const view = riserViewForOption({ project, optionId, parts, symCtx });

  // Legend (#206 rule): one row per icon+colour actually drawn.
  const partById = new Map(parts.map((p) => [p.id, p]));
  const legend = legendRows(
    slice.placements
      .filter((pl) => !pl.curtain)
      .map((pl): SymbolEntry & { id?: string; desc?: string } => partById.get(pl.partId) || { category: pl.category || "", desc: pl.category || pl.partId }),
    symCtx
  );

  const label = (p: PartLite) => (p.sku && p.sku !== p.desc ? `${p.desc} · ${p.sku}` : p.desc);
  const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
  const devices = library.filter((p) => !isPerLengthUnit(p.unit)).map((p) => ({ id: p.id, label: label(p) })).sort(byLabel);
  const cables = library.filter((p) => isPerLengthUnit(p.unit)).map((p) => ({ id: p.id, label: label(p) })).sort(byLabel);

  return (
    <div className="pk-content" style={{ maxWidth: 1240, padding: "26px 30px 64px" }}>
      {/* print (D113.7): chrome hides via .pk-doc-toolbar/.pk-no-print rules */}
      <style>{`@media print { .grid-riser-card { border: none !important; box-shadow: none !important; padding: 0 !important; } }`}</style>
      <div className="pk-doc-toolbar" style={{ maxWidth: "none", justifyContent: "flex-start" }}>
        <Link
          href={`${base}${optionQuery}`}
          style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--accent)", textDecoration: "none", marginRight: "auto" }}
        >
          ← {project.name}
        </Link>
        <Link href={`${base}/set${optionQuery}`} style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--accent)", textDecoration: "none" }}>
          Drawing set →
        </Link>
        <PrintButton accent={accent} />
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
        <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Riser</h1>
        <span style={{ color: "#8c919c", fontSize: 13 }}>
          {project.name}
          {project.options!.length > 1 ? ` · ${option.name}` : ""}
          {project.customer ? ` · ${project.customer}` : ""} · {project.id}
        </span>
      </div>
      <p className="pk-no-print" style={{ color: "#8c919c", fontSize: 13, marginBottom: 16 }}>
        Devices, rooms and wire runs come live from the plan; the layout, level lines, conduit notes and typed
        cable links are saved here. Anything you add on the riser lands on the plan too.
      </p>
      <RiserEditor
        projectId={project.id}
        optionId={optionId}
        view={view}
        devices={devices}
        sheets={sheets.map((s) => ({
          id: s.id,
          name: s.name,
          mime: s.mime,
          // Blob-stored sheets stream through the authenticated proxy (D116).
          src: s.blobPath ? `/api/grid-sheets/${encodeURIComponent(s.id)}` : s.dataUrl,
        }))}
        spaces={(project.spaces || []).map((s) => ({ sheetId: s.sheetId, page: s.page }))}
        cables={cables}
        placements={slice.placements.map((pl) => ({ id: pl.id, sheetId: pl.sheetId, page: pl.page, x: pl.x, y: pl.y }))}
        calibrations={(project.calibrations || []).map((c) => ({ docId: c.docId, page: c.page }))}
      />
      {legend.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 12, fontSize: 11.5, color: "#5b616e" }}>
          <span style={{ fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", fontSize: 10, color: "#9aa0ab", alignSelf: "center" }}>Legend</span>
          {legend.map((l) => (
            <span key={l.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <SymbolIcon iconId={l.iconId} color={l.color} size={14} />
              {l.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
