// SERVER ONLY — Blob + sharp.
/**
 * #322 — the one-time "Make photos uniform" batch. Every product photo that
 * was stored before photos were squared (kind image, a stored file, not
 * `squared`, not a manufacturer logo) is read, squared (squareProductImage),
 * stored as a NEW blob and swapped in with replaceDocumentFile — which moves
 * the old file onto `history` and never deletes a blob, so the originals
 * stay. Links, gallery order, primary and visibility live on the link rows
 * and `uploadedAt` is kept, so nothing about the gallery changes but the
 * pixels. Idempotent: a squared document is never a candidate again.
 */
import { getBlobStream, putBlob } from "@/lib/blob";
import { getDocument, replaceDocumentFile, type StoredFile } from "@/lib/stores/part-documents";
import { squareProductImage, webpFileName } from "./shrink";
import { partDocBlobPath, type PartDocument } from "./types";

/** One photo's worst case: a 25 MB download, the square, a store and a record. */
export const SQUARE_ITEM_WORST_CASE_MS = 10_000;

/** Documents still to square, oldest id first. `skip` = ids that already failed in this run. */
export function squareCandidates(docs: readonly PartDocument[], skip: readonly string[] = []): PartDocument[] {
  const skipped = new Set(skip);
  return docs
    .filter((d) => d.kind === "image" && !!d.blobKey && !d.squared && d.source !== "manufacturer" && !skipped.has(d.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export type SquareBatchDeps = {
  read(pathname: string): Promise<Uint8Array | null>;
  put(pathname: string, bytes: Buffer, contentType: string): Promise<{ pathname: string }>;
  get(id: string): Promise<PartDocument | null>;
  replace(id: string, file: StoredFile, by: string, at: number, opts: { keepStamp: boolean }): Promise<PartDocument | null>;
  now(): number;
};

export const liveSquareBatchDeps: SquareBatchDeps = {
  read: async (pathname) => {
    const stream = await getBlobStream(pathname);
    return stream ? new Uint8Array(await new Response(stream).arrayBuffer()) : null;
  },
  put: putBlob,
  get: getDocument,
  replace: replaceDocumentFile,
  now: Date.now,
};

export type SquareBatchResult = { done: number; failed: number; remaining: number; failedIds: string[] };

/** One budgeted pass over `docs` (the caller loads them). `remaining` = candidates not yet tried. */
export async function squareExistingPhotos(
  docs: readonly PartDocument[],
  by: string,
  opts: { budgetMs: number; skip?: readonly string[] },
  deps: SquareBatchDeps = liveSquareBatchDeps
): Promise<SquareBatchResult> {
  const todo = squareCandidates(docs, opts.skip);
  const started = deps.now();
  let done = 0;
  const failedIds: string[] = [];
  let i = 0;
  for (; i < todo.length; i++) {
    // The very first photo of a call always runs; later ones need room for a worst case.
    if (i > 0 && opts.budgetMs - (deps.now() - started) < SQUARE_ITEM_WORST_CASE_MS) break;
    const doc = todo[i];
    try {
      const bytes = await deps.read(doc.blobKey!);
      if (!bytes) throw new Error("unreadable");
      const squared = await squareProductImage(bytes);
      if (!squared.ok) throw new Error(squared.error);
      const fileName = webpFileName(doc.fileName);
      const stored = await deps.put(partDocBlobPath(doc.id, fileName), squared.bytes, squared.contentType);
      // Someone replaced the photo while this one was being squared: theirs wins.
      const current = await deps.get(doc.id);
      if (!current || current.blobKey !== doc.blobKey || current.squared) continue;
      const file: StoredFile = { blobKey: stored.pathname, fileName, contentType: squared.contentType, size: squared.bytes.byteLength, squared: true };
      if (!(await deps.replace(doc.id, file, by, deps.now(), { keepStamp: true }))) throw new Error("not recorded");
      done++;
    } catch {
      failedIds.push(doc.id);
    }
  }
  return { done, failed: failedIds.length, remaining: todo.length - i, failedIds };
}
