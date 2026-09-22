import { symbolGeometry, type GridShape } from "@/lib/design/grid-symbols";

/**
 * The one symbol renderer (#131, D154): the plan, the riser, the legend and
 * the palette rows all draw through here, so the palette shows exactly what
 * the plan will draw. No "use client" — it is a pure render used from both
 * the server-rendered riser page and the client editor.
 */

function Outline({ o }: { o: ReturnType<typeof symbolGeometry>["outline"] }) {
  if (o.kind === "circle") return <circle r={o.r} />;
  if (o.kind === "polygon") return <polygon points={o.points} />;
  return <rect x={-o.w / 2} y={-o.h / 2} width={o.w} height={o.h} rx={o.rx} />;
}

/** An SVG <g> centered on (x, y) — render INSIDE an <svg>. Fill + white
 *  stroke exactly like the rect it replaces; `selected` draws the same dashed
 *  ring the plan uses (the plan keeps drawing its own ring after the label,
 *  so it passes nothing here). */
export function SymbolShape({
  shape,
  x,
  y,
  w,
  h,
  color,
  selected = false,
  opacity = 0.92,
}: {
  shape: GridShape;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  selected?: boolean;
  opacity?: number;
}) {
  const g = symbolGeometry(shape, w, h);
  return (
    <g transform={`translate(${x} ${y})`}>
      <g fill={color} opacity={opacity}>
        <Outline o={g.outline} />
      </g>
      <g fill="none" stroke="#fff" strokeWidth={1.5} strokeLinejoin="round">
        <Outline o={g.outline} />
      </g>
      {g.glyph && (
        <path d={g.glyph} fill="none" stroke="#fff" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" opacity={0.95} />
      )}
      {selected && (
        <circle r={Math.max(w, h) / 2 + 5} fill="none" stroke="#16181d" strokeDasharray="4 3" strokeWidth={1.5} />
      )}
    </g>
  );
}

/** A self-contained inline <svg> for palette rows, legends and selects. */
export function SymbolIcon({
  shape,
  color,
  size = 12,
  title,
}: {
  shape: GridShape;
  color: string;
  size?: number;
  title?: string;
}) {
  const w = size;
  const h = Math.round(size * 0.78 * 100) / 100;
  const pad = 1.5;
  return (
    <svg
      width={w + pad * 2}
      height={h + pad * 2}
      viewBox={`${-(w / 2 + pad)} ${-(h / 2 + pad)} ${w + pad * 2} ${h + pad * 2}`}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      style={{ flex: "0 0 auto", display: "inline-block", verticalAlign: "middle" }}
    >
      {title && <title>{title}</title>}
      <SymbolShape shape={shape} x={0} y={0} w={w} h={h} color={color} />
    </svg>
  );
}
