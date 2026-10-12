// SERVER ONLY — imports sharp (native) for non-JPEG logos.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { jpegInfo } from "@/lib/pdf";
import { getSettings, type AppSettingsData } from "@/lib/settings";
import { peakHeaderDefault, resolvePeakHeader, type Letterhead } from "@/lib/letterhead";
import { BAKED_LETTERHEAD } from "@/lib/letterhead-path";

/**
 * Grid notes #9 — the letterhead's bytes, server-side. `letterheadJpeg` moved
 * here from renewal-outreach.ts (which re-exports it) so spec and package code
 * can load the letterhead without importing the renewal module.
 *
 * The ladder (D59): the uploaded dark logo, in whatever format Settings →
 * Branding accepts (JPEG, PNG, WebP, SVG — sniffed by magic bytes, never by
 * the data URL's label), else the baked Peak letterhead, else null (the
 * company name in type). A JPEG logo is used as-is; any other format is
 * rasterised with sharp to PNG (kept for Word / pdf-lib / HTML) and to a JPEG
 * flattened on white (for lib/pdf.ts, which embeds JPEG only).
 */

export { BAKED_LETTERHEAD };

export type LogoKind = "jpeg" | "png" | "webp" | "svg";

/** The logo's real format, from its bytes. */
export function sniffLogo(bytes: Buffer): LogoKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  const head = bytes.subarray(0, 1024).toString("utf8").replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return "svg";
  return null;
}

type LogoRaster = { jpeg: Buffer; png: Buffer | null };

/** The last converted logo, keyed by its data URL — conversions are per upload, not per document. */
let memo: { key: string; raster: LogoRaster | null } | null = null;

/** The uploaded dark logo as a raster, or null when there is none / it can't be read. */
export async function logoRaster(dataUrl: string | null | undefined): Promise<LogoRaster | null> {
  if (!dataUrl) return null;
  if (memo && memo.key === dataUrl) return memo.raster;
  let raster: LogoRaster | null = null;
  const m = /^data:[^;,]*;base64,/.exec(dataUrl);
  const bytes = m ? Buffer.from(dataUrl.slice(m[0].length), "base64") : null;
  const kind = bytes ? sniffLogo(bytes) : null;
  if (bytes && kind === "jpeg") {
    raster = jpegInfo(bytes) ? { jpeg: bytes, png: null } : null;
  } else if (bytes && kind) {
    try {
      const { default: sharp } = await import("sharp");
      // SVG has no pixel size of its own — rasterise at 4× (288 dpi) so a small wordmark stays crisp in print.
      const png = await sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000, ...(kind === "svg" ? { density: 288 } : {}) })
        .resize({ width: 2400, height: 800, fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer();
      const jpeg = await sharp(png).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
      raster = jpegInfo(jpeg) ? { jpeg, png } : null;
    } catch (err) {
      console.error(`[letterhead] the uploaded ${kind} logo could not be converted — using the baked letterhead`, err instanceof Error ? err.message : err);
      raster = null;
    }
  }
  memo = { key: dataUrl, raster };
  return raster;
}

let bakedLogged = false;

/** The baked Peak letterhead sheet, or null (logged once) when the file isn't there. */
async function bakedLetterhead(): Promise<Buffer | null> {
  try {
    // A LITERAL path (static fs/path imports): file tracing resolves it to the one file. A variable here
    // makes Turbopack trace the whole project. The harness checks it equals BAKED_LETTERHEAD (letterhead-path.ts).
    const buf = await readFile(path.join(process.cwd(), "src/app/(app)/flame-tests/letter/peak-letterhead.jpg"));
    if (jpegInfo(buf)) return buf;
    throw new Error("not a readable JPEG");
  } catch (err) {
    if (!bakedLogged) {
      bakedLogged = true;
      console.error(`[letterhead] ${BAKED_LETTERHEAD} could not be read — documents fall back to the company name in type (check next.config.ts outputFileTracingIncludes)`, err instanceof Error ? err.message : err);
    }
    return null;
  }
}

/** JPEG letterhead for lib/pdf.ts: the uploaded dark logo (any accepted
 *  format, converted to JPEG on white when it isn't one), else the baked-in
 *  Peak letterhead, else null (typographic fallback — the same ladder the
 *  on-screen letters use, D59). Exported so other renderLetterPdf() callers
 *  (renewal letters, the rentals letter route) get the same ladder. */
export async function letterheadJpeg(
  settings: AppSettingsData
): Promise<{ jpeg: Buffer | null; full: boolean }> {
  const logo = await logoRaster(settings.logoDark);
  if (logo) return { jpeg: logo.jpeg, full: false };
  const baked = await bakedLetterhead();
  return baked ? { jpeg: baked, full: true } : { jpeg: null, full: false };
}

/** The letterhead a document prints, or null when it carries none: the
 *  document's own choice ?? the company default (Settings → Branding). */
export async function documentLetterhead(settings: AppSettingsData, perDoc?: boolean | null): Promise<Letterhead | null> {
  if (!resolvePeakHeader(perDoc, peakHeaderDefault(settings))) return null;
  const companyName = (settings.companyName || "").trim() || "Peak Systems Group";
  const logo = await logoRaster(settings.logoDark);
  const jpeg = logo?.jpeg ?? (await bakedLetterhead());
  const info = jpeg ? jpegInfo(jpeg) : null;
  if (!jpeg || !info || info.w <= 0 || info.h <= 0) return { companyName, image: null };
  return { companyName, image: { jpeg, png: logo?.png ?? null, full: !logo, w: info.w, h: info.h } };
}

/** documentLetterhead over the live settings. */
export async function loadDocumentLetterhead(perDoc?: boolean | null): Promise<Letterhead | null> {
  return documentLetterhead(await getSettings(), perDoc);
}

/** The company default alone (for a checkbox's initial state). */
export async function loadPeakHeaderDefault(): Promise<boolean> {
  return peakHeaderDefault(await getSettings());
}
