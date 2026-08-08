/**
 * Merges every BOM row's real datasheet PDF into one document, with a
 * generated cover/index page listing category order AND every gap —
 * "Parts lacking datasheets are LISTED on the cover as gaps, never
 * silently skipped" (client-package spec, §1).
 *
 * Dual membership (Task 2 finding, walkBundle in ./client-package): a SKU
 * can legitimately appear in BOTH bundle.datasheets (real datasheet, gets
 * merged in) AND bundle.gaps (e.g. it's also missing spec text — a
 * "no-spec" gap) at the same time. buildCoverIndex cross-references both
 * lists so the cover page never lets a reader assume "Included" means
 * "no gaps anywhere" or that a gapped SKU has no datasheet at all.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getBlobStream } from "@/lib/blob";
import type { BundlePlan } from "./client-package";

const PAGE_SIZE: [number, number] = [612, 792];
const MARGIN_X = 50;
const TOP_Y = 740;
const BOTTOM_Y = 60;

async function streamToBytes(stream: ReadableStream): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export type CoverLine = { text: string; gap: boolean };

/**
 * Pure builder for the cover page's content (extracted so it's directly
 * testable — pdf-lib doesn't expose placed text back out of a loaded
 * document, so asserting the cover's actual wording requires a pure
 * function rather than round-tripping rendered PDF bytes; same pattern as
 * computeTextOrigin in plan-to-pdf.ts).
 *
 * Sorted by category (then sku) to match the order datasheets are merged
 * in below, so the index reads top-to-bottom in the same order the pages
 * appear.
 */
export function buildCoverIndex(bundle: BundlePlan): { included: CoverLine[]; gaps: CoverLine[] } {
  const gapsBySku = new Map<string, BundlePlan["gaps"]>();
  for (const g of bundle.gaps) {
    const list = gapsBySku.get(g.sku) ?? [];
    list.push(g);
    gapsBySku.set(g.sku, list);
  }
  const datasheetSkus = new Set(bundle.datasheets.map((d) => d.sku));

  const byCategory = sortedDatasheets(bundle);
  const included: CoverLine[] = byCategory.map((d) => {
    const dualGaps = gapsBySku.get(d.sku);
    const suffix = dualGaps
      ? `  [ALSO has a gap below: ${dualGaps.map((g) => g.reason).join(", ")}]`
      : "";
    return { text: `${d.category} — ${d.sku} — ${d.desc}${suffix}`, gap: false };
  });

  const gaps: CoverLine[] = bundle.gaps.map((g) => {
    const suffix = datasheetSkus.has(g.sku)
      ? "  (datasheet IS included above — this is a separate, additional gap)"
      : "";
    return { text: `${g.sku} — ${g.desc} — ${g.reason}${suffix}`, gap: true };
  });

  return { included, gaps };
}

function sortedDatasheets(bundle: BundlePlan): BundlePlan["datasheets"] {
  return [...bundle.datasheets].sort(
    (a, b) => a.category.localeCompare(b.category) || a.sku.localeCompare(b.sku)
  );
}

/** Injectable blob fetcher — production default is getBlobStream; tests
 *  inject a synthetic fetcher at this boundary rather than hitting real
 *  Blob storage (which throws when BLOB_READ_WRITE_TOKEN isn't set). */
export type BlobFetcher = (key: string) => Promise<ReadableStream | null>;

export async function mergeDatasheets(
  bundle: BundlePlan,
  deps: { fetchBlob?: BlobFetcher } = {}
): Promise<Uint8Array> {
  const fetchBlob = deps.fetchBlob ?? getBlobStream;
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);

  let page = out.addPage(PAGE_SIZE);
  let y = TOP_Y;
  const ensureRoom = () => {
    if (y < BOTTOM_Y) {
      page = out.addPage(PAGE_SIZE);
      y = TOP_Y;
    }
  };

  page.drawText("Datasheet Package", { x: MARGIN_X, y, size: 18, font, color: rgb(0.1, 0.1, 0.1) });
  y -= 30;

  const { included, gaps } = buildCoverIndex(bundle);

  page.drawText("Included:", { x: MARGIN_X, y, size: 12, font });
  y -= 18;
  if (included.length === 0) {
    page.drawText("  (none)", { x: MARGIN_X, y, size: 10, font });
    y -= 14;
  }
  for (const line of included) {
    ensureRoom();
    page.drawText(`  ${line.text}`, { x: MARGIN_X, y, size: 10, font });
    y -= 14;
  }

  if (gaps.length) {
    y -= 10;
    ensureRoom();
    page.drawText("Not included / gaps:", { x: MARGIN_X, y, size: 12, font, color: rgb(0.6, 0.1, 0.1) });
    y -= 18;
    for (const line of gaps) {
      ensureRoom();
      page.drawText(`  ${line.text}`, { x: MARGIN_X, y, size: 10, font, color: rgb(0.6, 0.1, 0.1) });
      y -= 14;
    }
  }

  for (const d of sortedDatasheets(bundle)) {
    try {
      const stream = await fetchBlob(d.datasheetBlobKey);
      if (!stream) {
        // Blob store returned "not found" for a key the catalog says is
        // set — best-effort: skip this one datasheet, don't fail the
        // whole package. The cover already lists it under Included, which
        // is a data-integrity issue to fix at the source (re-upload), not
        // a reason to withhold every OTHER part's datasheet.
        console.error(`mergeDatasheets: blob missing for ${d.sku} (${d.datasheetBlobKey})`);
        continue;
      }
      const bytes = await streamToBytes(stream);
      const src = await PDFDocument.load(bytes);
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    } catch (err) {
      // Best-effort: a thrown error (Blob storage not configured, network
      // failure, corrupt/unreadable PDF, ...) for ONE datasheet must not
      // crash the merge for every other part in the bundle.
      console.error(`mergeDatasheets: failed to merge datasheet for ${d.sku} (${d.datasheetBlobKey}):`, err);
    }
  }

  return out.save();
}
