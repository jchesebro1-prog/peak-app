import type { CSSProperties } from "react";
import type { Shape, ShapeLabel, Stroke, Fill } from "@/lib/curtain-cut-sheets/shapes";

/**
 * Draws #292 cut-sheet shapes. Strokes are non-scaling (px), so one shape
 * list reads the same in paper inches (elevation) or detail units (240 × 300).
 * `idPrefix` keeps the hatch pattern id unique per SVG on a page.
 */
const INK = "#16181d";
const TONE = "#eceef2";
const SW: Record<Stroke, number> = { thin: 0.6, med: 1, heavy: 1.7 };

export function ShapeSvg({
  shapes,
  labels = [],
  viewBox,
  idPrefix,
  hatch,
  labelSize = 9,
  style,
  title,
}: {
  shapes: readonly Shape[];
  labels?: readonly ShapeLabel[];
  viewBox: string;
  idPrefix: string;
  /** Hatch pitch in viewBox units (0.05 for inches, 6 for detail units). */
  hatch: number;
  labelSize?: number;
  style?: CSSProperties;
  title?: string;
}) {
  const hatchId = `${idPrefix}-hatch`;
  const fill = (f: Fill | undefined) => (f === "tone" ? TONE : f === "hatch" ? `url(#${hatchId})` : f === "solid" ? INK : "none");
  const stroke = (s: Stroke | undefined, dash?: boolean) => ({
    stroke: INK,
    strokeWidth: SW[s ?? "thin"],
    vectorEffect: "non-scaling-stroke" as const,
    strokeDasharray: dash ? "4 3" : undefined,
  });
  const text = (key: string, x: number, y: number, t: string, size: number, anchor: "start" | "middle" | "end", bold?: boolean, rotate?: number) => (
    <text key={key} x={x} y={y} fontSize={size} textAnchor={anchor} fontWeight={bold ? 700 : 400} fill={INK} fontFamily="var(--font-ui), system-ui, sans-serif" transform={rotate ? `rotate(${rotate} ${x} ${y})` : undefined}>
      {t.split("\n").map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : size * 1.15}>
          {line}
        </tspan>
      ))}
    </text>
  );
  return (
    <svg viewBox={viewBox} style={style} role="img" aria-label={title} preserveAspectRatio="xMinYMin meet">
      <defs>
        <pattern id={hatchId} patternUnits="userSpaceOnUse" width={hatch} height={hatch} patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={hatch} stroke={INK} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
        </pattern>
      </defs>
      {shapes.map((s, i) => {
        switch (s.kind) {
          case "line":
            return <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...stroke(s.stroke, s.dash)} />;
          case "rect":
            return <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} fill={fill(s.fill)} {...stroke(s.stroke, s.dash)} />;
          case "circle":
            return <circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill={fill(s.fill)} {...stroke(s.stroke)} />;
          case "path":
            return <path key={i} d={s.d} fill={fill(s.fill)} {...stroke(s.stroke, s.dash)} />;
          case "text":
            return text(String(i), s.x, s.y, s.text, s.size, s.anchor ?? "start", s.bold, s.rotate);
        }
      })}
      {labels.map((l, i) => (
        <g key={`l${i}`}>
          {l.leaderTo && <line x1={l.anchor === "end" ? l.x + 2 : l.x - 2} y1={l.y - labelSize * 0.35} x2={l.leaderTo[0]} y2={l.leaderTo[1]} {...stroke("thin")} />}
          {text(`lt${i}`, l.x, l.y, l.text, labelSize, l.anchor ?? "start")}
        </g>
      ))}
    </svg>
  );
}
