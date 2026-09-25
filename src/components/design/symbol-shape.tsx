import { createElement } from "react";
import { darken, iconById, LEGACY_SHAPE_ICON, type GridIconEl } from "@/lib/design/grid-icons";
import type { GridShape } from "@/lib/design/grid-symbols";

/**
 * The one symbol renderer (#131, D154 → stock symbols, spec 2026-09-25):
 * plan markers, palette rows, the per-entry picker, the riser and its
 * legend, Grid Settings previews and the plan legend all draw through here,
 * so every surface shows exactly what the plan draws. A device is a BADGE —
 * a rounded rect in its colour, a subtle darker edge, and a white Tabler
 * glyph. No "use client": a pure render used from server pages (riser) and
 * client components (editor, settings) alike. Pure SVG, no <image>.
 *
 * `iconId` is the new prop; `shape` (a D154 GridShape) still works and maps
 * through its legacy alias. Unknown/absent → the generic device glyph.
 */

type Look = { iconId?: string | null; shape?: GridShape | null; color: string };

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function resolveIcon(iconId?: string | null, shape?: GridShape | null) {
  return iconById(iconId || (shape ? LEGACY_SHAPE_ICON[shape] : null));
}

function IconEl({ el }: { el: GridIconEl }) {
  return createElement(el.t, { ...el.a, fill: el.fill ? "#fff" : undefined });
}

/** Glyph box = 78% of the badge's short side; stroke tuned in icon units so
 *  a 12px palette badge keeps a ~1px line and a plan marker keeps Tabler's
 *  own 2-unit weight. */
export function glyphMetrics(w: number, h: number): { side: number; scale: number; strokeWidth: number } {
  const side = Math.min(w, h) * 0.78;
  const scale = side / 24;
  const strokeWidth = Math.min(3, Math.max(2, 1.1 / scale));
  return { side: r3(side), scale: r3(scale), strokeWidth: r3(strokeWidth) };
}

/** An SVG <g> centered on (x, y) — render INSIDE an <svg>. `selected` draws
 *  the dashed ring the plan uses (the plan draws its own after the label,
 *  so it passes nothing here). */
export function SymbolShape({
  iconId,
  shape,
  x,
  y,
  w,
  h,
  color,
  selected = false,
  opacity = 0.95,
}: Look & {
  x: number;
  y: number;
  w: number;
  h: number;
  selected?: boolean;
  opacity?: number;
}) {
  const icon = resolveIcon(iconId, shape);
  const g = glyphMetrics(w, h);
  const rx = r3(Math.min(4, Math.min(w, h) / 4));
  return (
    <g transform={`translate(${x} ${y})`} data-icon={icon.id}>
      <rect x={r3(-w / 2)} y={r3(-h / 2)} width={w} height={h} rx={rx} fill={color} opacity={opacity} stroke={darken(color)} strokeWidth={1} />
      <g
        transform={`translate(${r3(-g.side / 2)} ${r3(-g.side / 2)}) scale(${g.scale})`}
        fill="none"
        stroke="#fff"
        strokeWidth={g.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {icon.els.map((el, i) => (
          <IconEl key={i} el={el} />
        ))}
      </g>
      {selected && (
        <circle r={Math.max(w, h) / 2 + 5} fill="none" stroke="#16181d" strokeDasharray="4 3" strokeWidth={1.5} />
      )}
    </g>
  );
}

/** A self-contained inline <svg> badge (square) for palette rows, legends,
 *  pickers and settings rows. */
export function SymbolIcon({
  iconId,
  shape,
  color,
  size = 12,
  title,
}: Look & {
  size?: number;
  title?: string;
}) {
  const pad = 1;
  const box = size + pad * 2;
  return (
    <svg
      width={box}
      height={box}
      viewBox={`${-box / 2} ${-box / 2} ${box} ${box}`}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      style={{ flex: "0 0 auto", display: "inline-block", verticalAlign: "middle" }}
    >
      {title && <title>{title}</title>}
      <SymbolShape iconId={iconId} shape={shape} x={0} y={0} w={size} h={size} color={color} opacity={1} />
    </svg>
  );
}
