import { dataUrlBytes, jpegInfo } from "@/lib/pdf";
import { getSettings, type AppSettingsData } from "@/lib/settings";
import { peakHeaderDefault, resolvePeakHeader, type Letterhead } from "@/lib/letterhead";

/**
 * Grid notes #9 — the letterhead's bytes, server-side. `letterheadJpeg` moved
 * here from renewal-outreach.ts (which re-exports it unchanged) so spec and
 * package code can load the letterhead without importing the renewal module.
 */

/** Where the baked Peak letterhead lives; shipped with every function by
 *  next.config's outputFileTracingIncludes (file tracing can't see this read). */
export const BAKED_LETTERHEAD = "src/app/(app)/flame-tests/letter/peak-letterhead.jpg";

/** JPEG letterhead for the PDF: the uploaded dark logo when it's a JPEG,
 *  else the baked-in Peak letterhead, else null (typographic fallback —
 *  same ladder the on-screen letters use, D59). PNG logos can't be embedded
 *  without a decoder (see lib/pdf.ts), so they fall to the baked sheet.
 *  Exported so other renderLetterPdf() callers (e.g. the rentals letter
 *  route) get the same fallback ladder instead of reimplementing it. */
export async function letterheadJpeg(
  settings: AppSettingsData
): Promise<{ jpeg: Buffer | null; full: boolean }> {
  const logo = dataUrlBytes(settings.logoDark, "image/jpeg");
  if (logo && jpegInfo(logo)) return { jpeg: logo, full: false };
  try {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const file = path.join(process.cwd(), BAKED_LETTERHEAD);
    const buf = await readFile(file);
    if (jpegInfo(buf)) return { jpeg: buf, full: true };
  } catch {
    // bundled deploys may not carry source assets — typographic fallback
  }
  return { jpeg: null, full: false };
}

/** The letterhead a document prints, or null when it carries none: the
 *  document's own choice ?? the company default (Settings → Branding). */
export async function documentLetterhead(settings: AppSettingsData, perDoc?: boolean | null): Promise<Letterhead | null> {
  if (!resolvePeakHeader(perDoc, peakHeaderDefault(settings))) return null;
  const companyName = (settings.companyName || "").trim() || "Peak Systems Group";
  const { jpeg, full } = await letterheadJpeg(settings);
  const info = jpeg ? jpegInfo(jpeg) : null;
  if (!jpeg || !info || info.w <= 0 || info.h <= 0) return { companyName, image: null };
  return { companyName, image: { jpeg, full, w: info.w, h: info.h } };
}

/** documentLetterhead over the live settings. */
export async function loadDocumentLetterhead(perDoc?: boolean | null): Promise<Letterhead | null> {
  return documentLetterhead(await getSettings(), perDoc);
}

/** The company default alone (for a checkbox's initial state). */
export async function loadPeakHeaderDefault(): Promise<boolean> {
  return peakHeaderDefault(await getSettings());
}
