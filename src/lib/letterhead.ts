/**
 * Grid notes #9 — the Peak standard header on documents. Pure (no server
 * imports, no runtime imports at all) so the client-safe bid-spec module and
 * the spec harness can use it.
 *
 * "The Peak standard header" is the existing letterhead: the uploaded dark
 * logo when it is a JPEG, else the baked Peak letterhead sheet, else the
 * company name set in type (the D59 ladder — src/lib/letterhead-server.ts
 * loads the bytes). Whether a document carries it:
 *
 *   per-document choice (true / false) ?? company default (Settings →
 *   Branding, `settings.peakHeader`, absent = ON).
 *
 * Specs print it on their FIRST PAGE only (later pages keep their running
 * header); the plain-name PDFs (rough drawings, quote equipment summary,
 * the rack datasheet index) print it where they printed the company name.
 */

/** The letterhead a document prints. `image` null = the company name in type.
 *  `jpeg` is always there (flattened on white — what lib/pdf.ts can embed);
 *  `png` is the lossless raster when the uploaded logo wasn't a JPEG (PNG,
 *  WebP or SVG), for the outputs that can carry PNG (Word, pdf-lib, HTML). */
export type Letterhead = {
  companyName: string;
  image: { jpeg: Buffer; png: Buffer | null; full: boolean; w: number; h: number } | null;
};

/** The company default: ON unless Settings → Branding stored an explicit false. */
export function peakHeaderDefault(settings: { peakHeader?: unknown } | null | undefined): boolean {
  return settings?.peakHeader !== false;
}

/** A document's own choice wins (true or false); anything else (null,
 *  undefined, junk) follows the company default. */
export function resolvePeakHeader(perDoc: unknown, companyDefault: boolean): boolean {
  return typeof perDoc === "boolean" ? perDoc : companyDefault;
}

/** A stored per-document choice, normalized: a boolean, or absent. */
export function cleanPeakHeader(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

/** Content width of a Letter page with 1" margins, in CSS/Word pixels (96 dpi). */
export const LETTERHEAD_CONTENT_PX = 624;
/** The baked sheet's height cap (≈ the letter PDF's 160 pt). */
const FULL_MAX_PX = 213;
/** An uploaded logo's height cap (the on-screen letters' maxHeight: 76px). */
const LOGO_MAX_PX = 76;

/** The printed size of a letterhead image in pixels, aspect kept: the baked
 *  sheet spans the content width (height capped), a logo is logo-sized. */
export function letterheadBoxPx(
  image: { full: boolean; w: number; h: number },
  contentPx: number = LETTERHEAD_CONTENT_PX
): { width: number; height: number } {
  const w = Math.max(1, image.w);
  const h = Math.max(1, image.h);
  if (image.full) {
    let width = contentPx;
    let height = (contentPx * h) / w;
    if (height > FULL_MAX_PX) {
      height = FULL_MAX_PX;
      width = (FULL_MAX_PX * w) / h;
    }
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }
  let height = Math.min(LOGO_MAX_PX, h);
  let width = (height * w) / h;
  if (width > contentPx) {
    width = contentPx;
    height = (contentPx * h) / w;
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

/** The letterhead as a self-contained HTML block (a data-URI image, so the
 *  .doc download and the print window carry it), or "" when there is none. */
export function letterheadHtml(lh: Letterhead | null | undefined, esc: (s: string) => string): string {
  if (!lh) return "";
  if (!lh.image) return `<div class="peak-letterhead" style="font-size:18pt;font-weight:bold;margin:0 0 14pt">${esc(lh.companyName)}</div>\n`;
  const box = letterheadBoxPx(lh.image);
  const src = lh.image.png ? `data:image/png;base64,${lh.image.png.toString("base64")}` : `data:image/jpeg;base64,${lh.image.jpeg.toString("base64")}`;
  const style = lh.image.full ? "display:block;width:100%;max-width:7.5in;height:auto" : `display:block;height:${box.height}px;width:auto`;
  return `<div class="peak-letterhead" style="margin:0 0 14pt"><img src="${src}" width="${box.width}" height="${box.height}" alt="${esc(lh.companyName)}" style="${style}"></div>\n`;
}
