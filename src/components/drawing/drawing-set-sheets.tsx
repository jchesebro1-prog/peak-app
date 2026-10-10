import type { CSSProperties } from "react";
import type { GridPlacement } from "@/lib/stores/grid-projects";
import { findCalibration } from "@/lib/annotations";
import { placementQty } from "@/lib/design/grid-bom";
import { symbolLook } from "@/lib/design/grid-icons";
import { markerColor } from "@/lib/design/grid-symbols";
import { DRAWING_SYSTEMS } from "@/lib/design/grid-scopes";
import { planDesignatorMarks } from "@/lib/design/designators";
import { isSeedPlaceholder } from "@/lib/design/grid-seed";
import type { ScheduleItem } from "@/lib/design/grid-schedule";
import { SHEET_SIZES, planContent, titleBlockData, type DrawingSheetDef } from "@/lib/design/grid-drawing-set";
import { markerBox } from "@/lib/design/grid-symbol-display";
import type { DrawingSetAssets, DrawingSetData } from "@/lib/design/drawing-set-data";
import { DrawingSheet } from "@/components/drawing/drawing-sheet";
import { RiserCanvas, RiserNotes } from "@/components/drawing/riser-canvas";
import { SymbolIcon } from "@/components/design/symbol-shape";
import PlanSheetFigure, { type FigurePlacement } from "@/app/(app)/design/grid/[id]/set/plan-sheet-figure";
import RiserSheetFigure from "@/app/(app)/design/grid/[id]/set/riser-sheet-figure";

/**
 * The drawing set's sheets (#209, spec 2026-09-25 §3) — T-001 cover, one
 * plan sheet per system per source page, E-501 riser, E-60x schedules (no
 * prices) — as one server component (#301 slice C, R8a). The team set page
 * and the signed /print/grid-set/[id] route both render it; every asset URL
 * comes from `assets`.
 */

function scheduleRow(it: ScheduleItem, key: number) {
  if (it.kind === "section")
    return (
      <tr key={key}>
        <td colSpan={4} className="pk-dw-sec">{`${it.name}${it.cont ? " (cont.)" : ""}`}</td>
      </tr>
    );
  if (it.kind === "wires")
    return (
      <tr key={key}>
        <td colSpan={4} className="pk-dw-sec">{`Wire runs${it.cont ? " (cont.)" : ""}`}</td>
      </tr>
    );
  // #320: a continuation row (a designator list too tall for one column)
  // prints only its designators, under "<desc> (cont.)".
  if (it.kind === "row")
    return (
      <tr key={key}>
        <td>{it.cont ? "" : it.qty}</td>
        <td className="pk-dw-mono pk-dw-wrap">{it.designators || ""}</td>
        <td className="pk-dw-mono pk-dw-ellip">{it.cont ? "" : it.code}</td>
        <td className="pk-dw-ellip">{it.cont ? `${it.desc} (cont.)` : it.desc}</td>
      </tr>
    );
  return (
    <tr key={key}>
      <td className="pk-dw-ellip">{it.length}</td>
      <td />
      <td className="pk-dw-mono pk-dw-ellip">{it.model || it.partId}</td>
      <td className="pk-dw-ellip">{it.run}</td>
    </tr>
  );
}

export function DrawingSetSheets({ data, assets }: { data: DrawingSetData; assets: DrawingSetAssets }) {
  const { project, option, options, optionQuoteNo, slice, spaces, cals, partById, symCtx, set, size, k, area, now, symbolDisplay, symbolUrls, view,
    schedule, schedulePages, sheetById, included, revRows, notes, legend } = data;

  const tb = (d: DrawingSheetDef, i: number) =>
    titleBlockData({
      company: data.company,
      project: { id: project.id, name: project.name, customer: project.customer, siteName: project.siteName, intake: project.intake, createdBy: project.createdBy },
      option: { name: option.name, quoteId: optionQuoteNo },
      optionCount: options.length,
      revisions: revRows,
      set,
      sheet: { number: d.number, title: d.title, scale: d.kind === "plan" ? "AS NOTED" : "NTS" },
      index: i + 1,
      total: included.length,
      now,
    });

  // `desc` feeds the device key; `qty` is the marker's unit count (#211: a
  // lot stands for many) — summed into the key and shown as ×N on the symbol
  // label, as the editor draws it.
  const figPlacement = (pl: GridPlacement): { fig: FigurePlacement; desc: string; qty: number; designator?: string } => {
    const part = partById.get(pl.partId);
    const look = part ? symbolLook(part, symCtx) : symbolLook({ category: pl.category }, symCtx);
    const desc = pl.curtain ? pl.curtain.name : part?.desc || part?.sku || (isSeedPlaceholder(pl.partId) ? pl.category || pl.partId : pl.partId);
    const qty = pl.curtain ? 1 : placementQty(pl);
    const fig: FigurePlacement = {
      id: pl.id,
      x: pl.x,
      y: pl.y,
      iconId: look.iconId,
      color: pl.curtain ? symCtx.colors.Curtains : look.color,
      label: qty > 1 ? `${desc} ×${qty}` : desc,
      // One type mark per part; each named curtain is its own type.
      key: pl.curtain ? `curtain:${pl.curtain.name}` : pl.partId,
      tag: "",
      // The design's symbol size (#300) — the same box the editor draws;
      // a curtain's glyph is 22×16 at 100 %.
      ...(pl.curtain
        ? { w: 22 * symbolDisplay.scale, h: 16 * symbolDisplay.scale }
        : markerBox(part, symbolDisplay.scale)),
      curtain: Boolean(pl.curtain),
      // The design's mode (#300): Object mode prints the part's drawing where one exists.
      ...(!pl.curtain && symbolUrls[pl.partId]?.plan ? { href: symbolUrls[pl.partId].plan } : {}),
    };
    return { fig, desc, qty, designator: pl.curtain ? undefined : pl.designator };
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
          <div className="pk-dw-mono" style={{ marginTop: 4 }}>{`${project.id}${optionQuoteNo ? ` · ${optionQuoteNo}` : ""}`}</div>
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
              {symbolDisplay.mode === "object" && (
                <span style={{ gridColumn: "1 / -1", color: "#8c919c", fontStyle: "italic" }}>Product drawings shown where available</span>
              )}
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
      // #320: each device prints its designator where the type mark sat (a lot
      // by its range); a curtain keeps its type mark. Key = designators · qty · desc.
      const marks = planDesignatorMarks(
        figs.map((f) => ({ id: f.fig.id, key: f.fig.key, desc: f.desc, qty: f.qty, designator: f.designator, curtain: f.fig.curtain })),
        DRAWING_SYSTEMS.find((s) => s.key === d.system)?.prefix || "",
        data.digits
      );
      return (
        <PlanSheetFigure
          sheet={{ name: src.name, mime: src.mime, src: assets.sheet(src) }}
          page={d.page}
          areaW={area.w}
          areaH={area.h}
          captionH={Math.round(0.35 * k * 1000) / 1000}
          k={k}
          spaces={c.spaces.map((s) => ({ id: s.id, points: s.points, name: s.name, color: s.color }))}
          routes={c.routes.map((r) => ({ id: r.id, points: r.points, color: markerColor(partById.get(r.partId)?.category || "Wire") }))}
          // The collision pass sizes each mark from this text.
          placements={figs.map(({ fig }) => ({ ...fig, tag: marks.tags.get(fig.id) || "" }))}
          keyRows={marks.rows}
          cal={cal ? { scale: cal.scale, unit: cal.unit } : null}
        />
      );
    }
    if (d.kind === "riser") {
      return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: `calc(8pt * var(--dw-k))` }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            {view.nodes.length ? (
              // Joins the Print button's wait until its riser drawings have loaded (#300).
              <RiserSheetFigure hrefs={view.nodes.flatMap((n) => n.groups.flatMap((g) => (g.href ? [g.href] : [])))}>
                <RiserCanvas view={view} fill />
              </RiserSheetFigure>
            ) : (
              <p style={{ margin: 0, color: "#5b616e" }}>Nothing on the riser yet — add spaces and devices first.</p>
            )}
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
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "24%" }} />
                  <col style={{ width: "22%" }} />
                  <col />
                </colgroup>
                <tbody>{(cols[ci] || []).map((it, ri) => scheduleRow(it, ri))}</tbody>
              </table>
            ))}
          </div>
        )}
        {last && !empty && (
          <div className="pk-dw-foot">
            {`${schedule.unitCount} unit${schedule.unitCount === 1 ? "" : "s"} across ${schedule.sections.length} area${schedule.sections.length === 1 ? "" : "s"}`}
            {schedule.wireFeet.map((w) => ` · ${Math.ceil(w.ft)} ${w.unit} ${w.model || w.partId}${w.unmeasured ? ` (+${w.unmeasured} unmeasured)` : ""}`).join("")}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="pk-drawing-set" data-size={size} style={{ "--dw-screen-zoom": String(SHEET_SIZES[size].screenZoom) } as CSSProperties}>
      {included.map((d, i) => (
        <DrawingSheet key={d.key} size={size} titleBlock={tb(d, i)}>
          {body(d)}
        </DrawingSheet>
      ))}
    </div>
  );
}
