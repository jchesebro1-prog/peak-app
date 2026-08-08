/**
 * Renders a PlanData primitive list (the same flat rects/lines/circles/
 * texts/paths shape <PlanSvg> consumes — see design/quick/plan-svg.tsx)
 * directly into a pdf-lib page. This is deliberately NOT an SVG-to-PDF
 * conversion — PlanData is already a flat primitive list, so mapping each
 * primitive to its pdf-lib draw call is simpler and needs no headless
 * browser / SVG parser dependency (#40).
 *
 * Text rotation (used for vertical dimension labels) is approximated, not
 * pixel-perfect — "rough" is the promise for this artifact (client-package
 * spec, §"Rough drawings"). Paths (door-swing arcs, seating-row curves,
 * etc.) are skipped in v1: `buildGridBaseSheetPlan` — the only PlanData
 * source this plan currently feeds into the drawings PDF — never populates
 * `paths` at all (it draws only the house floor, the proscenium opening,
 * and dimension lines), so skipping them costs nothing for the real input
 * this renderer sees today. Revisit if a later task starts feeding it
 * PlanData from the full `buildPlan` (quick/plan-svg.tsx), which DOES use
 * paths for door arcs and seating curves.
 */
import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts, degrees } from "pdf-lib";
import type { PlanData } from "@/app/(app)/design/quick/plan-svg";

// PlanData's texts array is typed inline on PlanData (see plan-svg.tsx's
// `TextEl`); pull the element shape out structurally so this module doesn't
// need a duplicate import of a type plan-svg.tsx doesn't export directly.
type TextEl = PlanData["texts"][number];

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/**
 * Pure anchor-offset calculation, extracted out of the drawText loop below
 * so it can be unit-tested directly (#40 review finding: the anchor-aware
 * positioning is the one substantive correctness fix in this file — pdf-lib's
 * drawText always start/baseline-anchors at (x,y), so without this offset
 * every anchor: "middle" (and "end") label would render shifted off the
 * center/end of the line it's meant to caption). See the loop below for the
 * rationale on why "middle" is the dominant, load-bearing case.
 */
export function computeTextOrigin(
  t: TextEl,
  font: PDFFont,
  margin: number,
  flipY: (y: number) => number
): { x: number; y: number; rotated: boolean } {
  const rotated = t.transform?.includes("rotate(-90") ?? false;
  const width = font.widthOfTextAtSize(t.t, t.size);
  const f = t.anchor === "middle" ? 0.5 : t.anchor === "end" ? 1 : 0;
  const x = margin + t.x - (rotated ? 0 : f * width);
  const y = flipY(t.y) - (rotated ? f * width : 0);
  return { x, y, rotated };
}

export async function drawPlanDataPage(
  pdfDoc: PDFDocument,
  plan: PlanData,
  opts: { title: string }
): Promise<PDFPage> {
  const margin = 40;
  const page = pdfDoc.addPage([plan.W + margin * 2, plan.H + margin * 2 + 24]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const flipY = (y: number) => page.getHeight() - margin - 24 - y; // PlanData's y grows downward; PDF's grows upward

  page.drawText(opts.title, { x: margin, y: page.getHeight() - margin + 6, size: 13, font, color: rgb(0.1, 0.1, 0.1) });

  for (const r of plan.rects) {
    page.drawRectangle({
      x: margin + r.x,
      y: flipY(r.y + r.h),
      width: r.w,
      height: r.h,
      color: r.fill && r.fill !== "none" ? hexToRgb(r.fill) : undefined,
      borderColor: r.stroke && r.stroke !== "none" ? hexToRgb(r.stroke) : undefined,
      borderWidth: r.sw || 0,
    });
  }
  for (const l of plan.lines) {
    page.drawLine({
      start: { x: margin + l.x1, y: flipY(l.y1) },
      end: { x: margin + l.x2, y: flipY(l.y2) },
      thickness: l.sw || 1,
      color: hexToRgb(l.stroke),
    });
  }
  for (const c of plan.circles) {
    page.drawEllipse({ x: margin + c.cx, y: flipY(c.cy), xScale: c.r, yScale: c.r, color: hexToRgb(c.fill) });
  }
  for (const t of plan.texts) {
    // pdf-lib's drawText always start-anchors at (x, y) and flows along the
    // rotation direction; PlanData's `anchor` ("start"/"middle"/"end") is a
    // real, load-bearing field here — every dimension label the real
    // generators emit (buildGridBaseSheetPlan's "Pro width"/"Depth" labels,
    // and every dimH/dimV label in plan-svg.tsx) is anchor: "middle", so
    // ignoring it would visibly shift every dimension string off the center
    // of the line it labels. computeTextOrigin shifts the start point
    // backward along the flow direction by the anchored fraction of the
    // text's measured width (see its own doc comment + unit tests).
    const { x, y, rotated } = computeTextOrigin(t, font, margin, flipY);
    page.drawText(t.t, {
      x,
      y,
      size: t.size,
      font,
      color: hexToRgb(t.fill),
      rotate: rotated ? degrees(90) : undefined,
    });
  }
  // paths (door-swing arcs etc.) are skipped in v1 — rects/lines/texts carry
  // all the load-bearing geometry; arcs are decorative. Revisit if a "rough"
  // drawing without them reads as confusing rather than just plain.

  return page;
}
