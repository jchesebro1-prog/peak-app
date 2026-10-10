import type { CSSProperties } from "react";
import type { Metadata } from "next";
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
import { loadDeviceTypeContext } from "@/lib/stores/device-types";
import { sortedLevels } from "@/lib/design/grid-levels";
import { conduitRiserPagesOf, conduitRiserSheetPages, loadConduitRiser } from "@/lib/design/conduit-riser-server";
import { conduitRiserSheetNumber, drawingArea, resolveSheetSize } from "@/lib/design/grid-drawing-set";
import { layoutDetail } from "@/lib/design/conduit-riser/layout";
import { detailGeometry, tableGeometry } from "@/lib/design/conduit-riser/drawing";
import type { ConduitRiserSystem } from "@/lib/design/conduit-riser/model";
import { alwaysShowTypeOptions, conduitRiserHref, RISER_TITLE } from "@/lib/design/conduit-riser/editor-rules";
import { isSystem } from "@/lib/stores/grid-conduit-riser";
import { cleanPlacementTag } from "@/lib/design/conduit-riser/tags";
import { ConduitRiserFigure } from "@/components/drawing/conduit-riser-figure";
import ConduitRiserEditor, { type SuggestionRow } from "./conduit-riser-editor";

type SearchParams = Promise<{ option?: string; detail?: string; system?: string | string[] }>;

/** `?system=av` is the A/V conduit riser (#328 C3); anything else, the lighting control riser. */
const systemOf = (v: unknown): ConduitRiserSystem => (isSystem(v) ? v : "lighting");

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  return { title: `${RISER_TITLE[systemOf((await searchParams).system)]} — Quartzite-6` };
}

export const dynamic = "force-dynamic";
// The loader reads the catalog, fixtures and virtual parts — same budget as the editor.
export const maxDuration = 60;

const TAB: CSSProperties = { fontSize: 12.5, padding: "5px 11px", borderRadius: 7, textDecoration: "none", border: "1px solid #e4e7ec" };

/**
 * The conduit riser page (#321) — Bray's device-level conduit riser,
 * drawn from the plan. Devices and wires are derived from the plan on every
 * load; the riser document adds details, pinned positions, stubs, conduit
 * runs, level-line positions, power types, notes and pricing defaults.
 * `?option=` picks the design option, `?detail=` the detail being edited.
 * #328 C3: `?system=av` opens the A/V conduit riser instead — the same
 * page, editor and engine over the option's second riser document.
 */
export default async function ConduitRiserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  await requireUser();
  const { id } = await params;
  const { option: requestedOption, detail: requestedDetail, system: requestedSystem } = await searchParams;
  const system = systemOf(requestedSystem);
  const title = RISER_TITLE[system];
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
  const options = project.options!;
  const option = options.find((o) => o.id === optionId)!;
  const base = `/design/grid/${encodeURIComponent(project.id)}`;
  const optionQuery = `?option=${encodeURIComponent(optionId)}`;
  // This riser's own URL for the option — lighting keeps the bare one.
  const riserHref = conduitRiserHref(base, optionId, system);

  // Loaded once and handed to the loader, so nothing reads the catalog twice.
  const [sheets, catalog, gridSymbols, settings] = await Promise.all([listSheets(project.id), listCatalog(), listGridSymbols(), getSettings()]);
  const deviceTypes = await loadDeviceTypeContext(catalog);
  const data = await loadConduitRiser(project, optionId, system, { catalog, gridSymbols, settings, deviceTypes });

  const details = data.view.details;
  const active = details.find((d) => d.detail.id === requestedDetail) ?? details[0];
  // Laid out once: the editor draws the active detail, the DXF links count the sheets.
  const layouts = details.map((d) => layoutDetail(d, data.doc));
  const layout = layouts[details.indexOf(active)];
  const figure = detailGeometry(layout, active);
  const tables = data.tables.map((t) => ({ key: `${t.key}:${t.title}`, ...tableGeometry(t, { x: 0.05, y: 0.05 }) }));

  // Plan-side lookups for the "From the plan" list and the Connect tool.
  const label = new Map(data.input.devices.map((d) => [d.id, d.label]));
  const wireByKey = new Map(data.input.wires.map((w) => [`${w.kind}:${w.id}`, w]));
  const suggestions: SuggestionRow[] = data.suggestions.items.map((s) => {
    const members = [...s.routeIds.map((x) => wireByKey.get(`route:${x}`)), ...s.linkIds.map((x) => wireByKey.get(`link:${x}`))];
    const symbols = [...new Set(members.map((w) => w?.signal?.symbol || "?"))].sort();
    return { key: s.key, kind: s.kind, a: s.a, b: s.b, aLabel: label.get(s.a) || s.a, bLabel: label.get(s.b) || s.b, symbols, wires: members.length };
  });
  const loose = data.suggestions.loose.map((wid) => ({ id: wid, cable: wireByKey.get(`route:${wid}`)?.cable || wid }));

  const categoryMap = resolveCategoryMap(settings.catalogCategoryMap);
  const library = gridPartsFrom(gridSymbols, catalog, categoryMap, { deviceTypes });
  const partLabel = (p: PartLite) => (p.sku && p.sku !== p.desc ? `${p.desc} · ${p.sku}` : p.desc);
  const cables = library
    .filter((p) => isPerLengthUnit(p.unit))
    .map((p) => ({ id: p.id, label: partLabel(p) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  // Lighting types for the lighting riser; audio + video types for A/V.
  const typeOptions = alwaysShowTypeOptions(deviceTypes.types, system, data.doc.alwaysShow);

  // #321: E-502… as the drawing set prints them at its saved size — one DXF per page.
  // #328 C4: the A/V riser's sheets follow lighting's, so its numbers count
  // lighting's pages at the same size (nothing to count without a lighting run).
  const sheetSize = resolveSheetSize(null, project.drawingSet?.size);
  const sheetPages = conduitRiserPagesOf(data, drawingArea(sheetSize), layouts);
  const lightingPages =
    system === "av" && sheetPages.length
      ? (await conduitRiserSheetPages(project, optionId, "lighting", sheetSize, { catalog, gridSymbols, settings, deviceTypes })).length
      : 0;
  const sheetNo = (i: number) => conduitRiserSheetNumber(i, system, lightingPages);
  const dxfHref = (page: number) =>
    `/api/grid/${encodeURIComponent(project.id)}/conduit-riser/dxf${optionQuery}&size=${sheetSize}&page=${page}${system === "av" ? "&system=av" : ""}`;

  const slice = optionSlice(project, optionId);
  const detailHref = (detailId: string) => `${riserHref}&detail=${encodeURIComponent(detailId)}`;
  const other: ConduitRiserSystem = system === "av" ? "lighting" : "av";

  return (
    <div className="pk-content" style={{ maxWidth: 1480, padding: "26px 30px 64px" }}>
      <div className="pk-doc-toolbar" style={{ maxWidth: "none", justifyContent: "flex-start" }}>
        <Link href={`${base}${optionQuery}`} style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--accent)", textDecoration: "none", marginRight: "auto" }}>
          ← {project.name}
        </Link>
        <Link href={`${base}/riser${optionQuery}`} style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--accent)", textDecoration: "none" }}>
          System riser →
        </Link>
        <Link href={`${base}/set${optionQuery}`} style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--accent)", textDecoration: "none" }}>
          Drawing set →
        </Link>
        {sheetPages.map((_, i) => (
          // A file download, not a page — a plain link.
          <a
            key={i}
            href={dxfHref(i + 1)}
            title={`${sheetNo(i)} as a CAD file (DXF), without the title block`}
            style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none", border: "1px solid #e4e7ec", borderRadius: 7, padding: "4px 10px" }}
          >
            {sheetPages.length > 1 ? `Download DXF · ${sheetNo(i)}` : "Download DXF"}
          </a>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>{title}</h1>
        <span style={{ color: "#8c919c", fontSize: 13 }}>
          {project.name}
          {options.length > 1 ? ` · ${option.name}` : ""}
          {project.customer ? ` · ${project.customer}` : ""} · {project.id}
        </span>
        {/* #328 C3: the option's other conduit riser, one click away. */}
        <Link
          className="pk-no-print"
          href={conduitRiserHref(base, optionId, other)}
          style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--accent)", textDecoration: "none", border: "1px solid #e4e7ec", borderRadius: 7, padding: "4px 10px" }}
        >
          {RISER_TITLE[other]} →
        </Link>
      </div>
      <p className="pk-no-print" style={{ color: "#8c919c", fontSize: 13, marginBottom: 14 }}>
        Devices and wires come live from the plan. Accept the conduit runs the plan suggests, drag tags, stubs, lanes and level lines to
        tidy the drawing, and fill in each tag. Everything here is saved with this design option.
      </p>

      {options.length > 1 && (
        <div className="pk-no-print" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10, alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab" }}>Option</span>
          {options.map((o) => (
            <Link
              key={o.id}
              href={conduitRiserHref(base, o.id, system)}
              aria-current={o.id === optionId ? "page" : undefined}
              style={{ ...TAB, ...(o.id === optionId ? { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" } : { color: "#3b404a" }) }}
            >
              {o.name}
            </Link>
          ))}
        </div>
      )}
      <div className="pk-no-print" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12, alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab" }}>Detail</span>
        {details.map((d) => (
          <Link
            key={d.detail.id}
            href={detailHref(d.detail.id)}
            aria-current={d.detail.id === active.detail.id ? "page" : undefined}
            style={{ ...TAB, ...(d.detail.id === active.detail.id ? { background: "#16181d", color: "#fff", borderColor: "#16181d" } : { color: "#3b404a" }) }}
          >
            {d.detail.n} · {d.detail.name}
          </Link>
        ))}
      </div>

      <ConduitRiserEditor
        // A new detail or option is a fresh editor (drag state, undo stack, selection).
        key={`${system}:${optionId}:${active.detail.id}`}
        projectId={project.id}
        optionId={optionId}
        system={system}
        // The layout-undo stack is tied to this version (#321 polish).
        version={project.updatedAt}
        planHref={`${base}${optionQuery}`}
        view={active}
        layout={layout}
        figure={figure}
        doc={data.doc}
        placementIds={[...data.placementIds]}
        detailCount={details.length}
        warnings={data.view.warnings}
        suggestions={suggestions}
        loose={loose}
        levels={sortedLevels(project.levels)}
        spaces={(project.spaces || []).map((s) => ({ id: s.id, name: s.name }))}
        boxTypes={data.boxTypes}
        sizes={data.sizes.map((s) => s.size)}
        wireTypes={data.wireTypes}
        deviceTypes={typeOptions}
        cables={cables}
        estimateOwned={data.estimateOwned}
        sheets={sheets.map((s) => ({
          id: s.id,
          name: s.name,
          mime: s.mime,
          // Blob-stored sheets stream through the authenticated proxy (D116).
          src: s.blobPath ? `/api/grid-sheets/${encodeURIComponent(s.id)}` : s.dataUrl,
        }))}
        placements={slice.placements.filter((pl) => !pl.curtain).map((pl) => ({ id: pl.id, sheetId: pl.sheetId, page: pl.page, x: pl.x, y: pl.y }))}
        calibrations={(project.calibrations || []).map((c) => ({ docId: c.docId, page: c.page }))}
        tagOverrides={Object.fromEntries(
          slice.placements.flatMap((pl) => {
            const t = pl.curtain ? undefined : cleanPlacementTag(pl.tag);
            return t ? [[pl.id, t] as const] : [];
          })
        )}
      />

      {tables.length > 0 && (
        <section style={{ marginTop: 22 }}>
          <h2 style={{ fontSize: 14, fontWeight: 650, marginBottom: 8 }}>Sheet tables</h2>
          <p className="pk-no-print" style={{ color: "#8c919c", fontSize: 12, marginBottom: 10 }}>
            Built from the riser and Settings — they print beside the details on the drawing set.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "flex-start" }}>
            {tables.map((t) => (
              <div key={t.key} className="pk-card" style={{ padding: 8, overflowX: "auto", maxWidth: "100%" }}>
                <ConduitRiserFigure geo={t.geo} w={t.w + 0.1} h={t.h + 0.1} scale={110} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
