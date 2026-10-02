/**
 * #296 (D577) — a rack elevation SVG as a PNG for the D94 .docx, through
 * sharp (librsvg). SERVER ONLY. librsvg ignores `vector-effect`, so the SVG
 * must be drawn with `strokeMode: "absolute"`; and the serializer writes no
 * width/height, so librsvg would read viewBox inches as pixels — the root
 * gets explicit pixel dimensions first. Any failure is null (the caller
 * prints a pointer to the package's elevation.pdf instead) — including a
 * drawing whose text didn't render (no fonts on the server). Rack elevations
 * always carry RU numbers, so an SVG with no text at all also reads as
 * "nothing lettered" and returns null.
 */
import sharp from "sharp";
import type { RackLayout, RackPartLookup } from "./types";
import { renderRackElevationSvg } from "./svg";

/** Taller than this is refused rather than rasterized (a 60 RU rack at 1400 px wide is ~6,700 px). */
const MAX_HEIGHT_PX = 12_000;
/** Every text element, tspans included (the serializer never nests <text>). */
const TEXT_EL = /<text\b[^>]*>[\s\S]*?<\/text>/g;

export async function svgToPng(svg: string, widthPx = 1400): Promise<Buffer | null> {
  try {
    const vb = /^<svg\b[^>]*\bviewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
    if (!vb) throw new Error("no viewBox on the root <svg>");
    const w = Number(vb[1]);
    const h = Number(vb[2]);
    if (!(w > 0 && h > 0)) throw new Error("empty viewBox");
    const heightPx = Math.max(1, Math.round((widthPx * h) / w));
    if (heightPx > MAX_HEIGHT_PX) throw new Error(`too tall (${heightPx} px)`);
    const sized = svg.replace(/^<svg\b/, `<svg width="${widthPx}" height="${heightPx}"`);
    const draw = (markup: string) => sharp(Buffer.from(markup, "utf8")).flatten({ background: "#ffffff" });
    // A server without fonts (Vercel's Lambda image) draws blank labels instead of failing:
    // if the drawing is pixel-identical with every <text> removed, nothing was lettered.
    const [withText, withoutText] = await Promise.all([
      draw(sized).raw().toBuffer({ resolveWithObject: true }),
      draw(sized.replace(TEXT_EL, "")).raw().toBuffer(),
    ]);
    if (withText.data.equals(withoutText)) {
      console.warn("[rack] elevation raster: no fonts — falling back to the PDF pointer");
      return null;
    }
    // Encode the pixels already drawn (no third SVG render).
    const { width, height, channels } = withText.info;
    return await sharp(withText.data, { raw: { width, height, channels } }).png().toBuffer();
  } catch (e) {
    console.warn(`[rack] elevation raster failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** The front elevation as a PNG, or null. */
export function rackElevationPng(layout: RackLayout, lookup: RackPartLookup, idPrefix = "rk"): Promise<Buffer | null> {
  return svgToPng(renderRackElevationSvg(layout, lookup, { face: "front", strokeMode: "absolute", idPrefix }));
}

export { pngSize } from "./png-size";
