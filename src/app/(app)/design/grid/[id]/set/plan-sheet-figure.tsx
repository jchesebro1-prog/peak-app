"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { MeasureUnit, Point } from "@/lib/annotations";
import { SymbolShape } from "@/components/design/symbol-shape";
import { pointInPolygon } from "@/lib/design/grid-geometry";
import { fitBox, scaleNote } from "@/lib/design/grid-drawing-set";
import { KEY_MAX_ROWS, placeLabels, planKeyLayout, spaceNameRect, symbolRect, type Pt, type Rect } from "@/lib/design/drawing-labels";

const PdfCanvas = dynamic(() => import("@/components/design/pdf-canvas"), { ssr: false });

export type FigurePlacement = {
  id: string;
  x: number;
  y: number;
  iconId: string;
  color: string;
  /** What the part is (the device key's description). */
  label: string;
  /** Type-mark grouping key (part id, or the curtain's name). */
  key: string;
  /** Per-sheet type mark printed beside the symbol (L1, A2 …). */
  tag: string;
  w: number;
  h: number;
  curtain: boolean;
};
export type FigureRoute = { id: string; points: Point[]; color: string };
export type FigureSpace = { id: string; points: Point[]; name: string; color: string };
export type FigureKeyRow = { tag: string; qty: number; desc: string };

/** Overlay units across the page width. The editor draws markers on a
 *  900 px-wide page, so marker sizes scale by U / 900 to keep the plan's
 *  proportions on paper. */
const U = 1000;
const K = U / 900;
const TAG_FS = 10 * K;
const SPACE_FS = 12 * K;
// Bold caps + digits run about 0.7 em; overestimating keeps the collision pass honest.
const textW = (s: string, fs: number) => s.length * fs * 0.7 + 2 * K;

/**
 * One system's plan on a drawing-set sheet (#GDS): the base sheet (image or
 * PDF page) fitted to the drawing area, that system's devices, wires and the
 * page's space outlines on top, a device key (type mark · qty · description)
 * beside or under the plan, and a caption with the printed scale (from the
 * calibration — "NTS" when uncalibrated) and orientation.
 *
 * Each symbol carries a short type mark instead of its full description
 * (final review I3): marks sit above-right of the symbol with a white halo
 * and a greedy collision pass (drawing-labels placeLabels) moves any that
 * would land on a symbol, an earlier mark, a space name or a wire.
 *
 * `data-ready` flips to "1" once the plan's aspect is known (and a PDF page
 * has painted); the print check and the Print button wait on it.
 */
export default function PlanSheetFigure({
  sheet,
  page,
  areaW,
  areaH,
  captionH,
  k,
  spaces,
  placements,
  routes,
  keyRows,
  cal,
}: {
  sheet: { name: string; mime: string; src: string };
  page: number;
  /** Drawing-area size, inches (grid-drawing-set drawingArea). */
  areaW: number;
  areaH: number;
  /** Caption strip height, inches (scaled with the sheet). */
  captionH: number;
  /** Sheet scale factor (SHEET_SIZES[size].k). */
  k: number;
  spaces: FigureSpace[];
  placements: FigurePlacement[];
  routes: FigureRoute[];
  keyRows: FigureKeyRow[];
  cal: { scale: number; unit: MeasureUnit } | null;
}) {
  const [aspect, setAspect] = useState<number | null>(null);
  const [rendered, setRendered] = useState(false);
  const [error, setError] = useState(false);
  const isPdf = sheet.mime === "application/pdf" || sheet.name.toLowerCase().endsWith(".pdf");
  // A PDF's canvas is sized (giving us the aspect) before it has actually
  // painted — an image's data-ready is fine gated on load alone, but a PDF
  // sheet also has to wait for PdfCanvas's onRendered so the print harness
  // never captures a blank page (#GDS review I2).
  const ready = isPdf ? aspect !== null && rendered : aspect !== null;
  const layout = planKeyLayout({ areaW, areaH, captionH, aspect, rows: keyRows.length, k });
  const fit = aspect ? fitBox(layout.planW, layout.planH, aspect) : null;
  const H = aspect ? U * aspect : 0;
  // The functional update returns the same value when nothing changed — the
  // img ref callback runs on every commit (the editor's own idiom).
  const onAspect = (w: number, h: number) => {
    if (!(w > 0) || !(h > 0)) return;
    const next = h / w;
    setAspect((a) => (a !== null && Math.abs(a - next) < 1e-6 ? a : next));
  };
  const pts = (ps: Point[]) => ps.map((p) => `${Math.round(p.x * U * 10) / 10},${Math.round(p.y * H * 10) / 10}`).join(" ");
  const gapIn = 0.2 * k;

  // Space-name and type-mark placement, in overlay units: names first (in
  // a corner of their space, clear of every symbol), then the marks around
  // them.
  let marks: Rect[] = [];
  const spaceNames: Rect[] = [];
  if (aspect) {
    const symbols = placements.map((pl) => ({
      x: pl.x * U,
      y: pl.y * H,
      w: (pl.curtain ? 22 : pl.w) * K,
      h: (pl.curtain ? 16 : pl.h) * K,
      tw: textW(pl.tag, TAG_FS),
      th: TAG_FS * 1.15,
    }));
    const symbolBoxes = symbols.map(symbolRect);
    for (const s of spaces) {
      const poly = s.points.map((p) => ({ x: p.x * U, y: p.y * H }));
      spaceNames.push(
        spaceNameRect(poly, textW(s.name.toUpperCase(), SPACE_FS), SPACE_FS * 1.15, [...symbolBoxes, ...spaceNames], 6 * K, (p) => pointInPolygon(p, poly))
      );
    }
    const segments: Array<[Pt, Pt]> = [];
    for (const r of routes) {
      for (let i = 1; i < r.points.length; i++) {
        segments.push([
          { x: r.points[i - 1].x * U, y: r.points[i - 1].y * H },
          { x: r.points[i].x * U, y: r.points[i].y * H },
        ]);
      }
    }
    marks = placeLabels({
      symbols,
      obstacles: spaceNames,
      segments,
      gap: 2 * K,
      bounds: { w: U, h: H },
    });
  }

  const key = keyRows.length > 0 && (
    <div
      className="pk-dw-key"
      style={
        layout.side
          ? { width: `${layout.keyW}in`, flex: "none", minHeight: 0, overflow: "hidden" }
          : { width: `${Math.min(areaW, layout.keyW * 2)}in`, height: `${layout.keyH}in`, flex: "none", overflow: "hidden" }
      }
    >
      <h2 className="pk-dw-h">Device key</h2>
      <table className="pk-dw-table">
        <colgroup>
          <col style={{ width: "20%" }} />
          <col style={{ width: "16%" }} />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th>Tag</th>
            <th>Qty</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {keyRows.slice(0, KEY_MAX_ROWS).map((r) => (
            <tr key={r.tag}>
              <td className="pk-dw-mono">{r.tag}</td>
              <td>{r.qty}</td>
              <td className="pk-dw-ellip">{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {keyRows.length > KEY_MAX_ROWS && <div style={{ marginTop: 4 }}>{`+${keyRows.length - KEY_MAX_ROWS} more — see the equipment schedule`}</div>}
    </div>
  );

  return (
    <div
      data-plan-figure=""
      data-ready={ready ? "1" : "0"}
      data-error={error ? "1" : "0"}
      style={{ width: `${areaW}in`, height: `${areaH}in`, display: "flex", flexDirection: "column" }}
    >
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: layout.side ? "row" : "column", gap: `${gapIn}in` }}>
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          <div className="pk-plan-fig" style={{ position: "relative", width: fit ? `${fit.w}in` : "100%", height: fit ? `${fit.h}in` : "100%" }}>
            {isPdf ? (
              <PdfCanvas
                dataUrl={sheet.src}
                page={page}
                zoom={2}
                // The largest box the plan can print in — stable before the
                // aspect (and so the key layout) is known.
                printBox={{ w: areaW, h: areaH - captionH }}
                onLoaded={() => {}}
                onSize={onAspect}
                onRendered={() => setRendered(true)}
                onError={() => setError(true)}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sheet.src}
                alt={sheet.name}
                ref={(el) => {
                  if (el && el.complete && el.naturalWidth) onAspect(el.naturalWidth, el.naturalHeight);
                }}
                onLoad={(e) => onAspect(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
                onError={() => setError(true)}
                style={{ display: "block", width: "100%", height: fit ? "100%" : "auto", objectFit: "contain" }}
              />
            )}
            {aspect && (
              <svg viewBox={`0 0 ${U} ${H}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
                {spaces.map((s) => (
                  <polygon
                    key={s.id}
                    points={pts(s.points)}
                    fill={s.color}
                    fillOpacity={0.07}
                    stroke={s.color}
                    strokeOpacity={0.6}
                    strokeWidth={1.4 * K}
                    strokeDasharray={`${8 * K} ${5 * K}`}
                  />
                ))}
                {routes.map((r) => (
                  <polyline key={r.id} points={pts(r.points)} fill="none" stroke={r.color} strokeWidth={2 * K} strokeDasharray={`${7 * K} ${4 * K}`} />
                ))}
                {placements.map((pl) => {
                  const x = pl.x * U;
                  const y = pl.y * H;
                  return pl.curtain ? (
                    <rect key={pl.id} x={x - 11 * K} y={y - 8 * K} width={22 * K} height={16 * K} rx={2 * K} fill={pl.color} />
                  ) : (
                    <SymbolShape key={pl.id} iconId={pl.iconId} x={x} y={y} w={pl.w * K} h={pl.h * K} color={pl.color} />
                  );
                })}
                {/* Text last, haloed, so no fill or line ever crosses it. */}
                {spaces.map((s, i) => {
                  const r = spaceNames[i];
                  if (!r) return null;
                  return (
                    <text
                      key={`n-${s.id}`}
                      x={Math.round((r.x + K) * 10) / 10}
                      y={Math.round((r.y + SPACE_FS * 0.92) * 10) / 10}
                      fontSize={SPACE_FS}
                      fontWeight={700}
                      fill={s.color}
                      stroke="#fff"
                      strokeWidth={3 * K}
                      strokeLinejoin="round"
                      paintOrder="stroke"
                    >
                      {s.name.toUpperCase()}
                    </text>
                  );
                })}
                {placements.map((pl, i) => {
                  const r = marks[i];
                  if (!r || !pl.tag) return null;
                  return (
                    <text
                      key={`t-${pl.id}`}
                      data-tag={pl.tag}
                      x={Math.round((r.x + r.w / 2) * 10) / 10}
                      y={Math.round((r.y + TAG_FS * 0.92) * 10) / 10}
                      fontSize={TAG_FS}
                      fontWeight={700}
                      fill="#16181d"
                      textAnchor="middle"
                      stroke="#fff"
                      strokeWidth={3 * K}
                      strokeLinejoin="round"
                      paintOrder="stroke"
                    >
                      {pl.tag}
                    </text>
                  );
                })}
              </svg>
            )}
          </div>
        </div>
        {key}
      </div>
      <div className="pk-plan-caption" style={{ height: `${captionH}in` }}>
        <span>{`Scale: ${scaleNote(cal, fit?.w ?? 0)}`}</span>
        <span aria-hidden>↑ N</span>
        <span>Plan north / stage as drawn on the source sheet</span>
        <span>{`Source: ${sheet.name}${page > 1 ? `, p. ${page}` : ""}`}</span>
      </div>
    </div>
  );
}
