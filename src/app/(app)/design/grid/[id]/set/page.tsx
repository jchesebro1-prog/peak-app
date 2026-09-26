import type { CSSProperties } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getProject, listSheets, type GridPlacement } from "@/lib/stores/grid-projects";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listGridSymbols } from "@/lib/stores/grid-catalog";
import { getSettings } from "@/lib/settings";
import { findCalibration } from "@/lib/annotations";
import { resolveCategoryMap } from "@/lib/catalog-taxonomy";
import { optionSlice, resolveOptionId } from "@/lib/design/grid-options";
import { gridPartsFrom } from "@/lib/design/grid-parts";
import { legendRows, symbolContext, symbolLook, type SymbolEntry } from "@/lib/design/grid-icons";
import { markerColor } from "@/lib/design/grid-symbols";
import { DRAWING_SYSTEMS } from "@/lib/design/grid-scopes";
import { assignTypeMarks } from "@/lib/design/drawing-labels";
import { isSeedPlaceholder } from "@/lib/design/grid-seed";
import { riserViewForOption } from "@/lib/design/grid-riser-view";
import { buildSchedule, paginateSchedule, scheduleGroups, scheduleWiresFromView, type ScheduleItem } from "@/lib/design/grid-schedule";
import {
  SHEET_SIZES,
  buildSheetList,
  drawingArea,
  planContent,
  planSheetGroups,
  printPageCss,
  resolveGeneralNotes,
  resolveSheetSize,
  revisionRows,
  titleBlockData,
  toggleableSheets,
  type DrawingSheetDef,
} from "@/lib/design/grid-drawing-set";
import { DrawingSheet } from "@/components/drawing/drawing-sheet";
import { RiserCanvas, RiserNotes } from "@/components/drawing/riser-canvas";
import { SymbolIcon } from "@/components/design/symbol-shape";
import { PrintButton } from "@/components/letter/print-button";
import PlanSheetFigure, { type FigurePlacement } from "./plan-sheet-figure";
import SetSettingsPanel from "./set-settings-panel";

export const metadata = { title: "Drawing set — Quartzite-6" };
export const dynamic = "force-dynamic";

/** Schedule rows per column; two columns per E-60x sheet (the whole sheet,
 *  type included, scales with the size, so this holds at 24×36 too). */
const SCHEDULE_ROWS_PER_COLUMN = 30;

function scheduleRow(it: ScheduleItem, key: number) {
  if (it.kind === "section")
    return (
      <tr key={key}>
        <td colSpan={3} className="pk-dw-sec">{`${it.name}${it.cont ? " (cont.)" : ""}`}</td>
      </tr>
    );
  if (it.kind === "wires")
    return (
      <tr key={key}>
        <td colSpan={3} className="pk-dw-sec">{`Wire runs${it.cont ? " (cont.)" : ""}`}</td>
      </tr>
    );
  if (it.kind === "row")
    return (
      <tr key={key}>
        <td>{it.qty}</td>
        <td className="pk-dw-mono pk-dw-ellip">{it.code}</td>
        <td className="pk-dw-ellip">{it.desc}</td>
      </tr>
    );
  return (
    <tr key={key}>
      <td className="pk-dw-ellip">{it.length}</td>
      <td className="pk-dw-mono pk-dw-ellip">{it.partId}</td>
      <td className="pk-dw-ellip">{it.run}</td>
    </tr>
  );
}

/**
 * The drawing set (#209, spec 2026-09-25 §3): every sheet is one printed
 * page with the architectural title strip — T-001 cover (project, sheet
 * index, symbol legend, general notes), one plan sheet per system per source
 * page, E-501 riser (the saved riser layout), E-60x equipment schedules (no
 * prices). `?size=b|d` overrides the saved size; `?option=` resolves like
 * the riser and schedule. Printed with the shared PrintButton.
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

  const optionId = resolveOptionId(project, requestedOption);
  const options = project.options!;
  const option = options.find((o) => o.id === optionId)!;
  const slice = optionSlice(project, optionId);
  const spaces = project.spaces || [];
  const cals = project.calibrations || [];
  const base = `/design/grid/${encodeURIComponent(project.id)}`;
  const optionQuery = `?option=${encodeURIComponent(optionId)}`;

  const [sheets, catalog, gridSymbols, settings] = await Promise.all([listSheets(project.id), listCatalog(), listGridSymbols(), getSettings()]);
  const accent = settings.accent || "#b08d4a";
  const symCtx = symbolContext(settings);
  const parts = gridPartsFrom(gridSymbols, catalog, resolveCategoryMap(settings.catalogCategoryMap), { catalogFallback: true });
  const partById = new Map(parts.map((p) => [p.id, p]));
  const set = project.drawingSet || {};
  const size = resolveSheetSize(requestedSize, set.size);
  const k = SHEET_SIZES[size].k;
  const area = drawingArea(size);
  // Print date for the title strip — a server-render-time clock read, same
  // accepted pattern as the rest of the app's print pages (eslint.config.ts).
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  // E-501 + E-60x
  const view = riserViewForOption({ project, optionId, parts, symCtx });
  const schedule = buildSchedule({
    placements: slice.placements,
    spaces,
    descOf: (pid) => partById.get(pid)?.desc,
    wires: scheduleWiresFromView(view),
  });
  const schedulePages = paginateSchedule(scheduleGroups(schedule), SCHEDULE_ROWS_PER_COLUMN, 2);

  // The set
  const groups = planSheetGroups({ sheetOrder: project.sheetIds || [], placements: slice.placements, routes: slice.routes, partById });
  const sourceNames = Object.fromEntries(sheets.map((s) => [s.id, s.name]));
  const sheetById = new Map(sheets.map((s) => [s.id, s]));
  const { all, included } = buildSheetList({ planGroups: groups, sourceNames, schedulePages: schedulePages.length, excluded: set.excluded });
  const revRows = revisionRows(project.revisions, set.revisionLabels);
  const notes = resolveGeneralNotes(set, settings.gridStandardNotes);
  const legend = legendRows(
    slice.placements
      .filter((pl) => !pl.curtain)
      .map((pl): SymbolEntry & { id?: string; desc?: string } => partById.get(pl.partId) || { category: pl.category || "", desc: pl.category || pl.partId }),
    symCtx
  );

  const tb = (d: DrawingSheetDef, i: number) =>
    titleBlockData({
      company: { name: settings.companyName, logoDark: settings.logoDark, offices: settings.offices },
      project: { id: project.id, name: project.name, customer: project.customer, siteName: project.siteName, intake: project.intake, createdBy: project.createdBy },
      option: { name: option.name, quoteId: option.quoteId },
      optionCount: options.length,
      revisions: revRows,
      set,
      sheet: { number: d.number, title: d.title, scale: d.kind === "plan" ? "AS NOTED" : "NTS" },
      index: i + 1,
      total: included.length,
      now,
    });

  const figPlacement = (pl: GridPlacement): FigurePlacement => {
    const part = partById.get(pl.partId);
    const look = part ? symbolLook(part, symCtx) : symbolLook({ category: pl.category }, symCtx);
    return {
      id: pl.id,
      x: pl.x,
      y: pl.y,
      iconId: look.iconId,
      color: pl.curtain ? symCtx.colors.Curtains : look.color,
      label: pl.curtain ? pl.curtain.name : part?.desc || part?.sku || (isSeedPlaceholder(pl.partId) ? pl.category || pl.partId : pl.partId),
      // One type mark per part; each named curtain is its own type.
      key: pl.curtain ? `curtain:${pl.curtain.name}` : pl.partId,
      tag: "",
      w: part?.symbolWidth || 44,
      h: part?.symbolHeight || 30,
      curtain: Boolean(pl.curtain),
    };
  };

  const cover = (
    <div className="pk-dw-cols" style={{ height: "100%" }}>
      <div>
        <div className="pk-dw-block">
          <div style={{ fontSize: `calc(20pt * var(--dw-k))`, fontWeight: 700, lineHeight: 1.15 }}>{project.name}</div>
          {options.length > 1 && <div style={{ fontWeight: 600, marginTop: 4 }}>{`Option: ${option.name}`}</div>}
          {project.customer && <div style={{ marginTop: 4 }}>{project.customer}</div>}
          {(project.siteName || project.intake?.venueName) && <div>{project.siteName || project.intake?.venueName}</div>}
          {project.intake?.address && <div>{project.intake.address}</div>}
          <div className="pk-dw-mono" style={{ marginTop: 4 }}>{`${project.id}${option.quoteId ? ` · ${option.quoteId}` : ""}`}</div>
        </div>
        <div className="pk-dw-block">
          <h2 className="pk-dw-h">General notes</h2>
          {notes.length ? (
            <ol className="pk-dw-notes">
              {notes.map((n, i) => (
                <li key={i}>
                  <span className="pk-dw-num">{`${i + 1}.`}</span> {n}
                </li>
              ))}
            </ol>
          ) : (
            <p style={{ margin: 0, color: "#5b616e" }}>—</p>
          )}
        </div>
      </div>
      <div>
        <div className="pk-dw-block">
          <h2 className="pk-dw-h">Sheet index</h2>
          <table className="pk-dw-table">
            <colgroup>
              <col style={{ width: "22%" }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>Sheet</th>
                <th>Title</th>
              </tr>
            </thead>
            <tbody>
              {included.map((d) => (
                <tr key={d.key}>
                  <td className="pk-dw-mono">{d.number}</td>
                  <td>{d.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {legend.length > 0 && (
          <div className="pk-dw-block">
            <h2 className="pk-dw-h">Symbol legend</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: `calc(4pt * var(--dw-k)) calc(10pt * var(--dw-k))` }}>
              {legend.map((l) => (
                <span key={l.key} style={{ display: "flex", alignItems: "center", gap: `calc(5pt * var(--dw-k))` }}>
                  <SymbolIcon iconId={l.iconId} color={l.color} size={Math.round(14 * k)} />
                  {l.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const body = (d: DrawingSheetDef) => {
    if (d.kind === "cover") return cover;
    if (d.kind === "plan" && d.system && d.sheetId && d.page) {
      const src = sheetById.get(d.sheetId);
      if (!src) return <p>That plan sheet is no longer on this design.</p>;
      const c = planContent({ group: { system: d.system, sheetId: d.sheetId, page: d.page }, placements: slice.placements, routes: slice.routes, spaces, partById });
      const cal = findCalibration(cals, d.sheetId, d.page);
      const figs = c.placements.map(figPlacement);
      const marks = assignTypeMarks(
        figs.map((f) => ({ key: f.key, desc: f.label })),
        DRAWING_SYSTEMS.find((s) => s.key === d.system)?.prefix || ""
      );
      return (
        <PlanSheetFigure
          // Every sheet streams through the authenticated proxy — Blob and
          // in-database alike — so a sheet shared by several plan pages is
          // one cached download, never a data-URL inlined once per page.
          sheet={{ name: src.name, mime: src.mime, src: `/api/grid-sheets/${encodeURIComponent(src.id)}` }}
          page={d.page}
          areaW={area.w}
          areaH={area.h}
          captionH={Math.round(0.35 * k * 1000) / 1000}
          k={k}
          spaces={c.spaces.map((s) => ({ id: s.id, points: s.points, name: s.name, color: s.color }))}
          routes={c.routes.map((r) => ({ id: r.id, points: r.points, color: markerColor(partById.get(r.partId)?.category || "Wire") }))}
          placements={figs.map((f) => ({ ...f, tag: marks.tags.get(f.key) || "" }))}
          keyRows={marks.rows.map((r) => ({ tag: r.tag, qty: r.qty, desc: r.desc }))}
          cal={cal ? { scale: cal.scale, unit: cal.unit } : null}
        />
      );
    }
    if (d.kind === "riser") {
      return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: `calc(8pt * var(--dw-k))` }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            {view.nodes.length ? <RiserCanvas view={view} fill /> : <p style={{ margin: 0, color: "#5b616e" }}>Nothing on the riser yet — add spaces and devices first.</p>}
          </div>
          {view.notes.length > 0 && (
            <div>
              <h2 className="pk-dw-h">Riser notes</h2>
              <RiserNotes notes={view.notes} />
            </div>
          )}
        </div>
      );
    }
    const pageIdx = d.schedulePage ?? 0;
    const cols = schedulePages[pageIdx] || [[]];
    const last = pageIdx === schedulePages.length - 1;
    const empty = schedule.sections.length === 0 && schedule.wires.length === 0;
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        {empty ? (
          <p style={{ margin: 0, color: "#5b616e" }}>Nothing on the plans yet.</p>
        ) : (
          <div className="pk-dw-cols" style={{ flex: 1, minHeight: 0, alignItems: "start" }}>
            {[0, 1].map((ci) => (
              <table key={ci} className="pk-dw-table">
                <colgroup>
                  <col style={{ width: "13%" }} />
                  <col style={{ width: "27%" }} />
                  <col />
                </colgroup>
                <tbody>{(cols[ci] || []).map((it, ri) => scheduleRow(it, ri))}</tbody>
              </table>
            ))}
          </div>
        )}
        {last && !empty && (
          <div className="pk-dw-foot">
            {`${schedule.deviceCount} device${schedule.deviceCount === 1 ? "" : "s"} across ${schedule.sections.length} area${schedule.sections.length === 1 ? "" : "s"}`}
            {schedule.wireFeet.map((w) => ` · ${Math.ceil(w.ft)} ${w.unit} ${w.partId}${w.unmeasured ? ` (+${w.unmeasured} unmeasured)` : ""}`).join("")}
          </div>
        )}
      </div>
    );
  };

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
        standardNotes={settings.gridStandardNotes || ""}
      />
      <div className="pk-drawing-set" data-size={size} style={{ "--dw-screen-zoom": String(SHEET_SIZES[size].screenZoom) } as CSSProperties}>
        {included.map((d, i) => (
          <DrawingSheet key={d.key} size={size} titleBlock={tb(d, i)}>
            {body(d)}
          </DrawingSheet>
        ))}
      </div>
    </div>
  );
}
