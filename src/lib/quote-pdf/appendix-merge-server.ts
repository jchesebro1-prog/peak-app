import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { appendPdfPages, EncryptedPdfError } from "@/lib/part-docs/datasheet-book-server";
import { ESTIMATE_PDF_TARGET_MAX_BYTES, imagePagePlacement, type DrawingSkip, type DrawingSkipReason } from "./appendix-plan";

/**
 * Spec 2026-10-16 §4–5 — Chrome's estimate pages, then each drawing in list
 * order (a PDF's pages at their own size; an image on one letter page of its
 * orientation), then the datasheet links page (`tail`), saved once. Never
 * throws. The datasheet book's load / copy / page-box rule (#329,
 * appendPdfPages).
 *
 * Images go through prepareDrawings FIRST, once (sharp: EXIF orientation
 * applied, downscaled to the fitted page at DRAWING_IMAGE_DPI, JPEG unless it
 * has alpha — WebP takes the same path), so the merge and every guard retry
 * embed small, ready bytes and never decode an image again. The merge itself
 * embeds only JPEG / PNG.
 *
 * Outcomes: `fallback: null` — the merged file (drawings that couldn't be used
 * are in `skipped`); `"unmergeable"` — pdf-lib couldn't load or save the
 * estimate, so Chrome's bytes come back untouched and the caller says so ONCE
 * (no per-drawing blame); `"late"` — the deadline passed before a file under
 * the ceiling existed, so Chrome's bytes come back with one out-of-time note.
 *
 * Amendment A1 (Jeff, Oct 16): the saved file stays ≤ `maxBytes` (14 MB). The
 * caller already leaves out what doesn't fit by stored size; a file still over
 * after save() drops drawings from the END and is merged again — at most
 * MERGE_SHRINK_TRIES times, then the estimate + links page alone — and never
 * starts a retry past `deadline`. Dropped drawings are `over-total`. Server-only.
 */

export type DrawingInput = { name: string; contentType: string; bytes: Uint8Array | null; skip?: DrawingSkipReason };

/** Re-merges allowed after a file comes out over the ceiling, before falling back to the estimate + links only. */
export const MERGE_SHRINK_TRIES = 3;
/** An image drawing is stored at this resolution of its fitted page (10 × 7.5 in landscape → 2,000 × 1,500 px). */
export const DRAWING_IMAGE_DPI = 200;
const JPEG_QUALITY = 85;

const tick = () => new Promise<void>((r) => setImmediate(r));
const warnOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One image → JPEG (or PNG with alpha) at its fitted page size, upright per its EXIF orientation. Throws on a bad image. */
export async function prepareDrawingImage(bytes: Uint8Array): Promise<{ contentType: "image/jpeg" | "image/png"; bytes: Buffer }> {
  const meta = await sharp(bytes).metadata();
  const turned = (meta.orientation ?? 1) >= 5; // EXIF 5–8 swap width and height
  const w = turned ? meta.height : meta.width;
  const h = turned ? meta.width : meta.height;
  const at = imagePagePlacement(w ?? 0, h ?? 0);
  if (!at) throw new Error("image has no size");
  const px = (pt: number) => Math.max(1, Math.round((pt / 72) * DRAWING_IMAGE_DPI));
  const img = sharp(bytes).rotate().resize({ width: px(at.w), height: px(at.h), fit: "inside", withoutEnlargement: true });
  if (meta.hasAlpha) return { contentType: "image/png", bytes: await img.png({ compressionLevel: 9 }).toBuffer() };
  return { contentType: "image/jpeg", bytes: await img.jpeg({ quality: JPEG_QUALITY }).toBuffer() };
}

/** Every image drawing converted once (PDFs and skipped drawings pass through). A bad image becomes `unreadable`;
 *  past `deadline` the rest are `late`. Never throws. */
export async function prepareDrawings(
  drawings: readonly DrawingInput[],
  o: { deadline?: number; now?: () => number } = {}
): Promise<DrawingInput[]> {
  const now = o.now ?? Date.now;
  const out: DrawingInput[] = [];
  for (const d of drawings) {
    if (d.skip || !d.bytes || d.contentType === "application/pdf" || !d.contentType.startsWith("image/")) {
      out.push(d);
      continue;
    }
    if (o.deadline !== undefined && now() >= o.deadline) {
      out.push({ ...d, bytes: null, skip: "late" });
      continue;
    }
    try {
      const p = await prepareDrawingImage(d.bytes);
      out.push({ name: d.name, contentType: p.contentType, bytes: p.bytes });
    } catch (e) {
      console.warn(`[quote-pdf] drawing "${d.name}" not converted: ${warnOf(e)}`);
      out.push({ ...d, bytes: null, skip: "unreadable" });
    }
    await tick();
  }
  return out;
}

type Built = { bytes: Buffer; skipped: DrawingSkip[]; tailAdded: boolean; included: number[] };

/** One merge, leaving out the drawings in `drop` (as over-total). Null when the estimate can't be read or the file can't be saved. */
async function mergeOnce(
  i: { main: Uint8Array; drawings: readonly DrawingInput[]; tail: Uint8Array | null; deadline?: number },
  drop: ReadonlySet<number>,
  now: () => number
): Promise<Built | null> {
  let out: PDFDocument;
  try {
    out = await PDFDocument.load(i.main, { updateMetadata: false });
  } catch (e) {
    console.warn("[quote-pdf] estimate PDF not mergeable — drawings left out", warnOf(e));
    return null;
  }
  const skipped: DrawingSkip[] = [];
  const included: number[] = [];
  for (const [n, d] of i.drawings.entries()) {
    if (d.skip) {
      skipped.push({ name: d.name, reason: d.skip });
      continue;
    }
    if (drop.has(n)) {
      skipped.push({ name: d.name, reason: "over-total" });
      continue;
    }
    if (i.deadline !== undefined && now() >= i.deadline) {
      skipped.push({ name: d.name, reason: "late" });
      continue;
    }
    if (!d.bytes || !d.bytes.byteLength) {
      skipped.push({ name: d.name, reason: "unreadable" });
      continue;
    }
    try {
      if (d.contentType === "application/pdf") {
        await appendPdfPages(out, d.bytes);
      } else {
        if (d.contentType !== "image/jpeg" && d.contentType !== "image/png") throw new Error(`${d.contentType} wasn't prepared`);
        const img = d.contentType === "image/jpeg" ? await out.embedJpg(d.bytes) : await out.embedPng(d.bytes);
        const at = imagePagePlacement(img.width, img.height);
        if (!at) throw new Error("image has no size");
        out.addPage([at.pageW, at.pageH]).drawImage(img, { x: at.x, y: at.y, width: at.w, height: at.h });
      }
      included.push(n);
    } catch (e) {
      if (e instanceof EncryptedPdfError) skipped.push({ name: d.name, reason: "encrypted" });
      else {
        console.warn(`[quote-pdf] drawing "${d.name}" not merged: ${warnOf(e)}`);
        skipped.push({ name: d.name, reason: "unreadable" });
      }
    }
    await tick(); // let other I/O through between drawings
  }
  let tailAdded = false;
  if (i.tail) {
    try {
      const src = await PDFDocument.load(i.tail, { updateMetadata: false });
      const pages = await out.copyPages(src, src.getPageIndices());
      for (const p of pages) out.addPage(p);
      tailAdded = pages.length > 0;
    } catch (e) {
      console.warn("[quote-pdf] datasheet links page not merged", warnOf(e));
    }
  }
  try {
    return { bytes: Buffer.from(await out.save()), skipped, tailAdded, included };
  } catch (e) {
    console.warn("[quote-pdf] merged PDF not saved — drawings left out", warnOf(e));
    return null;
  }
}

export type AppendixMerge = {
  bytes: Buffer;
  skipped: DrawingSkip[];
  tailAdded: boolean;
  /** The bytes are pdf-lib's merged file (false = Chrome's estimate, untouched). */
  merged: boolean;
  /** Why nothing was merged — one note for the whole appendix; `skipped` is then empty. */
  fallback: null | "late" | "unmergeable";
};

export async function mergeEstimateAppendices(i: {
  main: Uint8Array;
  drawings: readonly DrawingInput[];
  tail: Uint8Array | null;
  deadline?: number;
  now?: () => number;
  /** The saved file's ceiling (default ESTIMATE_PDF_TARGET_MAX_BYTES); a seam for the harness. */
  maxBytes?: number;
}): Promise<AppendixMerge> {
  const now = i.now ?? Date.now;
  const max = i.maxBytes ?? ESTIMATE_PDF_TARGET_MAX_BYTES;
  const pastDeadline = () => i.deadline !== undefined && now() >= i.deadline;
  const untouched = (fallback: "late" | "unmergeable"): AppendixMerge => ({ bytes: Buffer.from(i.main), skipped: [], tailAdded: false, merged: false, fallback });
  const done = (r: Built): AppendixMerge => ({ bytes: r.bytes, skipped: r.skipped, tailAdded: r.tailAdded, merged: true, fallback: null });
  try {
    const drop = new Set<number>();
    let r = await mergeOnce(i, drop, now);
    if (!r) return untouched("unmergeable");
    // A1: over the ceiling → drop drawings from the end, enough of their bytes to cover the overshoot (at least one),
    // and merge again — never starting a retry past the deadline.
    for (let t = 0; t < MERGE_SHRINK_TRIES && r.bytes.length > max && r.included.length; t++) {
      if (pastDeadline()) return untouched("late");
      const over = r.bytes.length - max;
      let freed = 0;
      for (let k = r.included.length - 1; k >= 0 && freed < over; k--) {
        drop.add(r.included[k]);
        freed += i.drawings[r.included[k]].bytes?.byteLength ?? 0;
      }
      const next = await mergeOnce(i, drop, now);
      if (!next) return untouched("unmergeable");
      r = next;
    }
    if (r.bytes.length > max && r.included.length) {
      // Still too big after the tries: the estimate + links page alone (unless time is up — then the estimate alone).
      if (pastDeadline()) return untouched("late");
      for (const n of r.included) drop.add(n);
      const floor = await mergeOnce(i, drop, now);
      if (!floor) return untouched("unmergeable");
      r = floor;
    }
    return done(r);
  } catch (e) {
    console.warn("[quote-pdf] drawings not merged", warnOf(e));
    return untouched("unmergeable");
  }
}
