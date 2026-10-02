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
import { MAX_PART_IMAGE_BYTES, newDocumentId, partDocBlobPath } from "./types";
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

export type PhotoSheetDeps = {
  listDrive?: ListDrive;
  downloadDrive?: (fileId: string, timeoutMs: number) => Promise<Uint8Array>;
  fetchImage?: (url: string) => ReturnType<typeof fetchImageBytes>;
  putFile?: (pathname: string, bytes: Buffer, contentType: string) => Promise<{ pathname: string }>;
  clock?: () => number;
  now?: () => number;
};
export type SheetBatchInput = { rows: ImportRow[]; dropped: DroppedFile[]; failedKeys: string[] };
export type SheetBatchResult = { ok: true; outcomes: SheetDocOutcome[]; remaining: number } | { ok: false; error: string };

/** Put a just-linked image where the sheet asked: front for Photo 1, else
 *  last among real photos. One order write (setImageOrder, D536). */
export async function placeSheetImage(documentId: string, sku: string, primary: boolean): Promise<void> {
  const links = (await documentLinksForParts([sku])).filter((l) => l.kind === "image");
  const docs = await getDocuments(links.map((l) => l.documentId));
  const ordered = buildImageIndex(docs, links).get(sku) ?? [];
  if (!ordered.some((i) => i.id === documentId)) return;
  await setImageOrder(sku, placeNewImage(ordered, documentId, primary));
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const titleOf = (name: string) => name.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim();

export async function runPhotoSheetBatch(input: SheetBatchInput, by: string, budgetMs: number, deps: PhotoSheetDeps = {}): Promise<SheetBatchResult> {
  const clock = deps.clock ?? Date.now;
  const now = deps.now ?? Date.now;
  const deadline = clock() + Math.max(0, budgetMs);
  const put = deps.putFile ?? putBlob;
  if (!deps.putFile && !blobEnabled()) return { ok: false, error: "File storage isn't configured (no BLOB_READ_WRITE_TOKEN) — photos can't be stored on this deployment." };
  const fetchImage = deps.fetchImage ?? ((url: string) => fetchImageBytes(url));

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

  const link = async (documentId: string, d: PlannedDoc) => {
    const skus = [...new Set(d.links.map((l) => l.sku))];
    const primary = new Set(d.links.filter((l) => l.primary).map((l) => l.sku));
    await attachDocument(documentId, skus, by, now());
    for (const sku of skus) await placeSheetImage(documentId, sku, primary.has(sku));
  };

  const importOne = async (d: Exclude<PlannedDoc, { via: "dropped" }>): Promise<SheetDocOutcome> => {
    const fail = (error: string): SheetDocOutcome => ({ key: d.key, ok: false, error });
    if (d.existingId) {
      await link(d.existingId, d);
      return { key: d.key, ok: true, documentId: d.existingId };
    }
    let bytes: Uint8Array;
    let baseName: string;
    let sourceUrl: string | null;
    let sourceRef: string | undefined;
    if (d.via === "url") {
      const got = await fetchImage(d.url);
      if (!got.ok) return fail(got.error);
      const type = sniffImageType(got.file.bytes);
      if (!type) return fail("That link is not a PNG, JPEG, or WebP image.");
      bytes = got.file.bytes;
      baseName = fileNameForFetched(got.file.contentDisposition, got.file.finalUrl, "image", type === "image/png" ? "png" : type === "image/jpeg" ? "jpeg" : "webp");
      sourceUrl = d.url;
    } else {
      try {
        bytes = await downloadDrive(d.file.id, Math.min(DOWNLOAD_TIMEOUT_MS, Math.max(5_000, deadline + 10_000 - clock())));
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
    const created = await createDocument({
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
    if (!created) {
      if (!deps.putFile) await deleteBlob(stored.pathname).catch(() => undefined);
      return fail("Could not record the document.");
    }
    await link(created.id, d);
    return { key: d.key, ok: true, documentId: created.id };
  };

  const outcomes: SheetDocOutcome[] = [];
  let processed = 0;
  for (const d of work) {
    if (processed > 0 && deadline - clock() < PER_DOC_WORST_MS) break;
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
