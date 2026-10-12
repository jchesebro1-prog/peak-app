// SERVER ONLY — imports sharp (native). Never import from a "use client" file.
import sharp from "sharp";
import { checkLogoUpload, COMPANY_LOGO_COPY, COMPANY_LOGO_MAX_EDGE, type CompanyLogo } from "@/lib/company-logo";

/** A logo never needs more than 25 megapixels; a decompression bomb past it is refused, never decoded ("error" = truncated/corrupt refuses too). */
export const COMPANY_LOGO_MAX_INPUT_PIXELS = 25_000_000;

/**
 * Grid notes #8 — an uploaded company logo, checked (size, then the bytes'
 * own type — SVG refused) and re-encoded by sharp: EXIF orientation applied,
 * metadata dropped, longest side ≤ COMPANY_LOGO_MAX_EDGE (never enlarged),
 * PNG with a palette (transparency kept; pdf-lib embeds PNG).
 */
export async function prepareCompanyLogo(
  bytes: Uint8Array,
  by: string,
  at: number = Date.now(),
): Promise<{ ok: true; logo: CompanyLogo } | { ok: false; error: string }> {
  const gate = checkLogoUpload(bytes);
  if (!gate.ok) return gate;
  try {
    const { data, info } = await sharp(bytes, { failOn: "error", limitInputPixels: COMPANY_LOGO_MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: COMPANY_LOGO_MAX_EDGE, height: COMPANY_LOGO_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer({ resolveWithObject: true });
    return { ok: true, logo: { dataUrl: `data:image/png;base64,${data.toString("base64")}`, width: info.width, height: info.height, updatedAt: at, updatedBy: by } };
  } catch {
    return { ok: false, error: COMPANY_LOGO_COPY.unreadable };
  }
}
