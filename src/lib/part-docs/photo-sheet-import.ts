// SERVER ONLY — the photo-sheet import's server lane (URL + Drive items).
import { blobEnabled, deleteBlob, putBlob } from "@/lib/blob";
import { DOWNLOAD_TIMEOUT_MS, downloadDriveFile } from "@/lib/google/drive-photos";
import { invalidatePortalIndex } from "@/lib/portal-catalog-index";
import { attachDocument, createDocument, documentLinksForParts, getDocuments, setImageOrder } from "@/lib/stores/part-documents";
import { drivePhotosToken } from "./drive-photo-sync";
import { fetchImageBytes } from "./fetch";
import { fileNameForFetched, sniffImageType } from "./files";
import { placeNewImage, type ImportRow } from "./photo-sheet";
import { loadPhotoSheetContext, type ListDrive } from "./photo-sheet-io";
import { planPhotoSheet, type DroppedFile, type PlannedDoc, type SheetDocOutcome } from "./photo-sheet-plan";
import { shrinkImage, webpFileName } from "./shrink";
import { MAX_FETCH_TIMEOUT_MS, MAX_PART_IMAGE_BYTES, newDocumentId, partDocBlobPath } from "./types";
import { buildImageIndex } from "./views";

/**
 * Catalog photo sheet — one import batch: re-plan from the rows (so a call
 * after a closed tab, or a second upload of the same sheet, only does what's
 * left), then fetch / download → shrink → store → link each URL or Drive
 * photo under the wall-clock budget. One photo's failure is that photo's
 * outcome; the batch carries on. Dropped files are the browser's lane
 * (uploadNewDocument with sheet provenance), never this one.
 */

/** A fetch + shrink + store rarely takes more than a few seconds; don't
 *  START another with less than this left (the first always runs). */
const PER_DOC_WORST_MS = 12_000;
/** The page's maxDuration is 60 s and the budget is 45 s: this much past the
 *  budget is the most one call may run, and no photo — the first included —
 *  starts with less than MIN_DOC_START_MS of it left. Same numbers as
 *  drive-photo-sync's hard deadline. */
const HARD_DEADLINE_SLACK_MS = 10_000;
const MIN_DOC_START_MS = 5_000;

export type PhotoSheetDeps = {
  listDrive?: ListDrive;
  downloadDrive?: (fileId: string, timeoutMs: number) => Promise<Uint8Array>;
  fetchImage?: (url: string, timeoutMs: number) => ReturnType<typeof fetchImageBytes>;
  putFile?: (pathname: string, bytes: Buffer, contentType: string) => Promise<{ pathname: string }>;
  /** Removes a stored file when its document can't be recorded (default: deleteBlob). */
  deleteFile?: (pathname: string) => Promise<void>;
  clock?: () => number;
  now?: () => number;
};
export type SheetBatchInput = { rows: ImportRow[]; dropped: DroppedFile[]; failedKeys: string[] };
export type SheetBatchResult = { ok: true; outcomes: SheetDocOutcome[]; remaining: number } | { ok: false; error: string };

/** Put a just-linked image where the sheet asked: front for Photo 1, else
 *  last among real photos. One order write (setImageOrder, D536); false when
 *  the order couldn't be written. */
export async function placeSheetImage(documentId: string, sku: string, primary: boolean): Promise<boolean> {
  const links = (await documentLinksForParts([sku])).filter((l) => l.kind === "image");
  const docs = await getDocuments(links.map((l) => l.documentId));
  const ordered = buildImageIndex(docs, links).get(sku) ?? [];
  if (!ordered.some((i) => i.id === documentId)) return true;
  return setImageOrder(sku, placeNewImage(ordered, documentId, primary));
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const titleOf = (name: string) => name.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim();

export async function runPhotoSheetBatch(input: SheetBatchInput, by: string, budgetMs: number, deps: PhotoSheetDeps = {}): Promise<SheetBatchResult> {
  const clock = deps.clock ?? Date.now;
  const now = deps.now ?? Date.now;
  const deadline = clock() + Math.max(0, budgetMs);
  const hardDeadline = deadline + HARD_DEADLINE_SLACK_MS;
  const put = deps.putFile ?? putBlob;
  if (!deps.putFile && !blobEnabled()) return { ok: false, error: "File storage isn't configured (no BLOB_READ_WRITE_TOKEN) — photos can't be stored on this deployment." };
  const deleteFile = deps.deleteFile ?? deleteBlob;
  const fetchImage = deps.fetchImage ?? ((url: string, timeoutMs: number) => fetchImageBytes(url, { timeoutMs }));

  const ctx = await loadPhotoSheetContext(deps.listDrive);
  const plan = planPhotoSheet({
    rows: input.rows,
    match: ctx.match,
    imagesBySku: ctx.imagesBySku,
    imageByUrl: ctx.imageByUrl,
    imageByDriveId: ctx.imageByDriveId,
    dropped: input.dropped,
    drive: ctx.drive,
    driveReason: ctx.driveReason,
  });
  const failed = new Set(input.failedKeys);
  const work = plan.docs.filter((d): d is Exclude<PlannedDoc, { via: "dropped" }> => d.via !== "dropped" && !failed.has(d.key));

  let token: string | null | undefined;
  const downloadDrive = deps.downloadDrive ?? (async (fileId: string, timeoutMs: number) => {
    if (token === undefined) token = await drivePhotosToken();
    if (!token) throw new Error("Drive photos aren't connected");
    return downloadDriveFile(token, fileId, MAX_PART_IMAGE_BYTES, undefined, timeoutMs);
  });

  /** True when every placement wrote its order. */
  const link = async (documentId: string, d: PlannedDoc): Promise<boolean> => {
    const skus = [...new Set(d.links.map((l) => l.sku))];
    const primary = new Set(d.links.filter((l) => l.primary).map((l) => l.sku));
    await attachDocument(documentId, skus, by, now());
    let placed = true;
    for (const sku of skus) if (!(await placeSheetImage(documentId, sku, primary.has(sku)))) placed = false;
    return placed;
  };
  const linked = async (documentId: string, d: PlannedDoc): Promise<SheetDocOutcome> =>
    (await link(documentId, d))
      ? { key: d.key, ok: true, documentId }
      : { key: d.key, ok: true, documentId, error: "attached, but couldn't reorder the part's photos" };

  const importOne = async (d: Exclude<PlannedDoc, { via: "dropped" }>): Promise<SheetDocOutcome> => {
    const fail = (error: string): SheetDocOutcome => ({ key: d.key, ok: false, error });
    if (d.existingId) {
      return linked(d.existingId, d);
    }
    let bytes: Uint8Array;
    let baseName: string;
    let sourceUrl: string | null;
    let sourceRef: string | undefined;
    if (d.via === "url") {
      const got = await fetchImage(d.url, Math.min(MAX_FETCH_TIMEOUT_MS, hardDeadline - clock()));
      if (!got.ok) return fail(got.error);
      const type = sniffImageType(got.file.bytes);
      if (!type) return fail("That link is not a PNG, JPEG, or WebP image.");
      bytes = got.file.bytes;
      baseName = fileNameForFetched(got.file.contentDisposition, got.file.finalUrl, "image", type === "image/png" ? "png" : type === "image/jpeg" ? "jpeg" : "webp");
      sourceUrl = d.url;
    } else {
      try {
        bytes = await downloadDrive(d.file.id, Math.min(DOWNLOAD_TIMEOUT_MS, hardDeadline - clock()));
      } catch (e) {
        return fail(`Drive download failed: ${errorText(e)}`);
      }
      baseName = d.file.name;
      sourceUrl = d.file.webViewLink || null;
      sourceRef = `drive:${d.file.id}`;
    }
    const shrunk = await shrinkImage(bytes);
    if (!shrunk.ok) return fail(shrunk.error);
    const documentId = newDocumentId();
    const fileName = webpFileName(baseName);
    const stored = await put(partDocBlobPath(documentId, fileName), shrunk.bytes, shrunk.contentType);
    let created: Awaited<ReturnType<typeof createDocument>> = null;
    try {
      created = await createDocument({
        id: documentId,
        kind: "image",
        title: titleOf(baseName),
        fileName,
        contentType: shrunk.contentType,
        size: shrunk.bytes.byteLength,
        blobKey: stored.pathname,
        sourceUrl,
        source: "sheet",
        ...(sourceRef ? { sourceRef } : {}),
        by,
        at: now(),
      });
    } catch {
      created = null;
    }
    if (!created) {
      // The file is stored but nothing points at it: take it back out.
      await deleteFile(stored.pathname).catch(() => undefined);
      return fail("Could not record the document.");
    }
    return linked(created.id, d);
  };

  const outcomes: SheetDocOutcome[] = [];
  let processed = 0;
  for (const d of work) {
    const t = clock();
    if (hardDeadline - t < MIN_DOC_START_MS) break;
    if (processed > 0 && deadline - t < PER_DOC_WORST_MS) break;
    processed++;
    try {
      outcomes.push(await importOne(d));
    } catch (e) {
      outcomes.push({ key: d.key, ok: false, error: `Stopped on this photo: ${errorText(e)}` });
    }
  }
  if (outcomes.some((o) => o.ok)) invalidatePortalIndex();
  return { ok: true, outcomes, remaining: work.length - processed };
}
