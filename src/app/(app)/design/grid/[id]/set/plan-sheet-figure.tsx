"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { MeasureUnit, Point } from "@/lib/annotations";
import { SymbolShape } from "@/components/design/symbol-shape";
import { polygonCentroid } from "@/lib/design/grid-geometry";
import { fitBox, scaleNote } from "@/lib/design/grid-drawing-set";

const PdfCanvas = dynamic(() => import("@/components/design/pdf-canvas"), { ssr: false });

export type FigurePlacement = { id: string; x: number; y: number; iconId: string; color: string; label: string; w: number; h: number; curtain: boolean };
export type FigureRoute = { id: string; points: Point[]; color: string };
export type FigureSpace = { id: string; points: Point[]; name: string; color: string };

/** Overlay units across the page width. The editor draws markers on a
 *  900 px-wide page, so marker sizes scale by U / 900 to keep the plan's
 *  proportions on paper. */
const U = 1000;
const K = U / 900;

/**
 * One system's plan on a drawing-set sheet (#GDS): the base sheet (image or
 * PDF page) fitted to the drawing area, that system's devices, wires and the
 * page's space outlines on top, and a caption with the printed scale (from
 * the calibration — "NTS" when uncalibrated) and orientation. `data-ready`
 * flips to "1" once the plan's aspect is known; the print check waits on it.
 */
export default function PlanSheetFigure({
  sheet,
  page,
  areaW,
  areaH,
  captionH,
  spaces,
  placements,
  routes,
  cal,
}: {
  sheet: { name: string; mime: string; src: string };
  page: number;
  /** Drawing-area size, inches (grid-drawing-set drawingArea). */
  areaW: number;
  areaH: number;
  /** Caption strip height, inches (scaled with the sheet). */
  captionH: number;
  spaces: FigureSpace[];
  placements: FigurePlacement[];
  routes: FigureRoute[];
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
  const fit = aspect ? fitBox(areaW, areaH - captionH, aspect) : null;
  const H = aspect ? U * aspect : 0;
  // The functional update returns the same value when nothing changed — the
  // img ref callback runs on every commit (the editor's own idiom).
  const onAspect = (w: number, h: number) => {
    if (!(w > 0) || !(h > 0)) return;
    const next = h / w;
    setAspect((a) => (a !== null && Math.abs(a - next) < 1e-6 ? a : next));
  };
  const pts = (ps: Point[]) => ps.map((p) => `${Math.round(p.x * U * 10) / 10},${Math.round(p.y * H * 10) / 10}`).join(" ");

  return (
    <div
      data-plan-figure=""
      data-ready={ready ? "1" : "0"}
      data-error={error ? "1" : "0"}
      style={{ width: `${areaW}in`, height: `${areaH}in`, display: "flex", flexDirection: "column" }}
    >
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        <div className="pk-plan-fig" style={{ position: "relative", width: fit ? `${fit.w}in` : "100%", height: fit ? `${fit.h}in` : "100%" }}>
          {isPdf ? (
            <PdfCanvas
              dataUrl={sheet.src}
              page={page}
              zoom={2}
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
              {spaces.map((s) => {
                const c = polygonCentroid(s.points);
                return (
                  <g key={s.id}>
                    <polygon points={pts(s.points)} fill={s.color} fillOpacity={0.07} stroke={s.color} strokeOpacity={0.6} strokeWidth={1.4 * K} strokeDasharray={`${8 * K} ${5 * K}`} />
                    <text x={c.x * U} y={c.y * H} fontSize={12 * K} fontWeight={700} fill={s.color} textAnchor="middle">
                      {s.name.toUpperCase()}
                    </text>
                  </g>
                );
              })}
              {routes.map((r) => (
                <polyline key={r.id} points={pts(r.points)} fill="none" stroke={r.color} strokeWidth={2 * K} strokeDasharray={`${7 * K} ${4 * K}`} />
              ))}
              {placements.map((pl) => {
                const x = pl.x * U;
                const y = pl.y * H;
                return (
                  <g key={pl.id}>
                    {pl.curtain ? (
                      <rect x={x - 11 * K} y={y - 8 * K} width={22 * K} height={16 * K} rx={2 * K} fill={pl.color} />
                    ) : (
                      <SymbolShape iconId={pl.iconId} x={x} y={y} w={pl.w * K} h={pl.h * K} color={pl.color} />
                    )}
                    <text x={x + (pl.curtain ? 14 : pl.w / 2 + 4) * K} y={y + 3.5 * K} fontSize={9.5 * K} fontWeight={600} fill="#16181d">
                      {pl.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
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
