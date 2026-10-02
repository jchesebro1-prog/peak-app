/**
 * #296 — deterministic SVG string for a rack elevation. A hand-built string
 * (no react-dom/server, same reason as `renderPlanSvgMarkup`) so the builder
 * sidebar and the printed submittal draw byte-identical markup. No randomness;
 * every number goes through `fmt`; text and attribute values are escaped.
 */
import type { Fill, Shape, Stroke } from "@/lib/curtain-cut-sheets/shapes";
import { rackGeometry, type RackGeometryOpts } from "./geometry";
import type { RackLayout, RackPartLookup } from "./types";

const SW: Record<Stroke, number> = { thin: 0.6, med: 1, heavy: 1.6 };
const TONE = "#00000014";
/** Non-scaling strokes measure dashes in screen px, so the pattern is px, not inches. */
const DASH = "4 3";
const HATCH_PITCH = 0.12;

const fmt = (n: number) => String(+n.toFixed(3));
// XML 1.0 forbids most control characters; drop them rather than emit a broken file.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const esc = (s: string) =>
  s
    .replace(CONTROL, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function shapesToSvg(
  shapes: readonly Shape[],
  viewBox: { w: number; h: number },
  opts: { title?: string; className?: string; idPrefix?: string } = {}
): string {
  const hatchId = `${opts.idPrefix ?? "rk"}-hatch`;
  const fillOf = (f: Fill | undefined) => (f === "tone" ? TONE : f === "hatch" ? `url(#${hatchId})` : f === "solid" ? "currentColor" : "none");
  const strokeAttrs = (s: Stroke | undefined, dash?: boolean) =>
    ` stroke="currentColor" stroke-width="${SW[s ?? "thin"]}" vector-effect="non-scaling-stroke"${dash ? ` stroke-dasharray="${DASH}"` : ""}`;

  let usesHatch = false;
  const body = shapes
    .map((s) => {
      switch (s.kind) {
        case "line":
          return `<line x1="${fmt(s.x1)}" y1="${fmt(s.y1)}" x2="${fmt(s.x2)}" y2="${fmt(s.y2)}"${strokeAttrs(s.stroke, s.dash)} />`;
        case "rect":
          if (s.fill === "hatch") usesHatch = true;
          return `<rect x="${fmt(s.x)}" y="${fmt(s.y)}" width="${fmt(s.w)}" height="${fmt(s.h)}" fill="${fillOf(s.fill)}"${strokeAttrs(s.stroke, s.dash)} />`;
        case "circle":
          if (s.fill === "hatch") usesHatch = true;
          return `<circle cx="${fmt(s.cx)}" cy="${fmt(s.cy)}" r="${fmt(s.r)}" fill="${fillOf(s.fill)}"${strokeAttrs(s.stroke)} />`;
        case "path":
          if (s.fill === "hatch") usesHatch = true;
          return `<path d="${esc(s.d)}" fill="${fillOf(s.fill)}"${strokeAttrs(s.stroke, s.dash)} />`;
        case "text": {
          const anchor = s.anchor && s.anchor !== "start" ? ` text-anchor="${s.anchor}"` : "";
          const weight = s.bold ? ` font-weight="bold"` : "";
          const rot = s.rotate ? ` transform="rotate(${fmt(s.rotate)} ${fmt(s.x)} ${fmt(s.y)})"` : "";
          const lines = s.text.split("\n");
          const inner =
            lines.length === 1
              ? esc(s.text)
              : lines.map((l, i) => `<tspan x="${fmt(s.x)}"${i === 0 ? "" : ` dy="${fmt(s.size * 1.15)}"`}>${esc(l)}</tspan>`).join("");
          return `<text x="${fmt(s.x)}" y="${fmt(s.y)}" font-size="${fmt(s.size)}"${anchor}${weight} fill="currentColor"${rot}>${inner}</text>`;
        }
      }
    })
    .join("");

  const defs = usesHatch
    ? `<defs><pattern id="${esc(hatchId)}" patternUnits="userSpaceOnUse" width="${HATCH_PITCH}" height="${HATCH_PITCH}" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="${HATCH_PITCH}" stroke="currentColor" stroke-width="0.5" vector-effect="non-scaling-stroke" /></pattern></defs>`
    : "";
  const cls = opts.className ? ` class="${esc(opts.className)}"` : "";
  const title = opts.title ? `<title>${esc(opts.title)}</title>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(viewBox.w)} ${fmt(viewBox.h)}" font-family="Arial, Helvetica, sans-serif" role="img"${cls}>${title}${defs}${body}</svg>`;
}

/** The rack elevation for one face as an SVG string. */
export function renderRackElevationSvg(layout: RackLayout, lookup: RackPartLookup, opts: RackGeometryOpts): string {
  const g = rackGeometry(layout, lookup, opts);
  return shapesToSvg(g.shapes, g.viewBox, { title: opts.title, idPrefix: opts.idPrefix });
}
