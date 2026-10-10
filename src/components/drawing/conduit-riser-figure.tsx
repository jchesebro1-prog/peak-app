import type { ReactNode, Ref, SVGProps } from "react";
import { BLOCKS, type Geo } from "@/lib/design/conduit-riser/drawing";

/**
 * Conduit riser (#321) — the drawing's primitives as React SVG, so the
 * editor can lay clickable targets over it and the drawing set (#321 Task 9)
 * can reuse it. Draws exactly what svg.ts writes as a string — same units
 * (100 per sheet inch), strokes, block expansion and text placement — so
 * the screen and the printed sheet never disagree. No hooks: usable from a
 * server page or inside the client editor.
 */

/** SVG user units per sheet inch (svg.ts's U). */
export const CR_UNITS = 100;
const n = (v: number) => Math.round(v * CR_UNITS * 100) / 100;

const STROKE: Record<string, string> = {
  TAG: "#222",
  CONDUIT: "#222",
  CABLEMGMT: "#222",
  SIGNAL: "#222",
  LEVEL: "#888",
  TEXT: "#111",
  TABLE: "#222",
};
const SW = n(0.008);
const DASH = `${n(0.08)} ${n(0.05)}`;

function Prim({ g, layer }: { g: Geo; layer: string }): ReactNode {
  const stroke = STROKE[layer] || "#222";
  switch (g.t) {
    case "line":
      return <line x1={n(g.a.x)} y1={n(g.a.y)} x2={n(g.b.x)} y2={n(g.b.y)} stroke={stroke} strokeWidth={SW} strokeDasharray={g.dashed ? DASH : undefined} />;
    case "poly": {
      const pts = g.pts.map((p) => `${n(p.x)},${n(p.y)}`).join(" ");
      return g.closed ? (
        <polygon points={pts} fill="#fff" stroke={stroke} strokeWidth={SW} strokeDasharray={g.dashed ? DASH : undefined} />
      ) : (
        <polyline points={pts} fill="none" stroke={stroke} strokeWidth={SW} strokeDasharray={g.dashed ? DASH : undefined} />
      );
    }
    case "rect":
      return <rect x={n(g.r.x)} y={n(g.r.y)} width={n(g.r.w)} height={n(g.r.h)} fill={g.fill ? "#c8c8c8" : "none"} stroke={stroke} strokeWidth={SW} />;
    case "circle":
      return <circle cx={n(g.c.x)} cy={n(g.c.y)} r={n(g.r)} fill="#fff" stroke={stroke} strokeWidth={SW} />;
    case "text":
      if (!g.s) return null;
      return (
        <text
          x={n(g.at.x)}
          y={n(g.at.y)}
          fontSize={n(g.h * 1.4)}
          textAnchor={g.anchor}
          dominantBaseline="central"
          fontFamily="Arial, Helvetica, sans-serif"
          fill="#111"
        >
          {g.s}
        </text>
      );
    case "insert": {
      const def = BLOCKS[g.block];
      return (
        <g data-block={g.block} transform={`translate(${n(g.at.x)} ${n(g.at.y)})${g.scale === 1 ? "" : ` scale(${g.scale})`}`}>
          {def.geo.map((b, i) => (
            <Prim key={`g${i}`} g={b} layer={g.layer} />
          ))}
          {def.attrs.map((a, i) => (
            <Prim key={`a${i}`} g={{ t: "text", at: a.at, s: g.attrs[a.tag] ?? "", h: a.h, anchor: a.anchor, layer: g.layer }} layer={g.layer} />
          ))}
        </g>
      );
    }
  }
}

/** The primitives alone, for composing into a bigger <svg>. */
export function ConduitRiserGeo({ geo }: { geo: readonly Geo[] }) {
  return (
    <>
      {geo.map((g, i) => (
        <Prim key={i} g={g} layer={g.layer} />
      ))}
    </>
  );
}

/**
 * One drawing (a detail, a table) `w` × `h` sheet inches, shown at `scale`
 * pixels per inch. `children` draw on top in the same units — the editor's
 * hit targets and selection outline.
 */
export function ConduitRiserFigure({
  geo,
  w,
  h,
  scale = 96,
  svgRef,
  svgProps,
  children,
}: {
  geo: readonly Geo[];
  w: number;
  h: number;
  scale?: number;
  svgRef?: Ref<SVGSVGElement>;
  svgProps?: Omit<SVGProps<SVGSVGElement>, "ref" | "viewBox" | "width" | "height">;
  children?: ReactNode;
}) {
  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${n(w)} ${n(h)}`}
      width={Math.round(w * scale)}
      height={Math.round(h * scale)}
      data-conduit-riser-figure=""
      {...svgProps}
      style={{ display: "block", background: "#fff", ...(svgProps?.style || {}) }}
    >
      <ConduitRiserGeo geo={geo} />
      {children}
    </svg>
  );
}
