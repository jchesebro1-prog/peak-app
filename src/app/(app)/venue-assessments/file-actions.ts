"use server";

import { getOptionalUser } from "@/lib/session";
import { can } from "@/lib/team";
import { blobEnabled, deleteBlob, getBlobHead, getBlobStream, isBlobNotFound } from "@/lib/blob";
import { sniffImageType } from "@/lib/part-docs/files";
import { FILE_ID_RE, UPLOAD_CAPS, fileContentType, filePathMatches, fileSlotOf } from "@/lib/field-files/files";
import { isJsonBytes, readCapped } from "@/lib/field-files/file-bytes";
import { applyFinalizedSurveyFile, get } from "@/lib/stores/surveys";
import type { FinalizePhotoResult } from "@/app/(app)/assessments/photo-actions";

/**
 * Survey files (#344 C4) — the server half of the device queue for a survey's photos, markups, strokes and sketches,
 * mirroring `finalizeAssessmentPhoto` (same result union): called after the bytes went straight to private Blob, or,
 * in local dev with no Blob, with the file as a small data URL. Never redirects.
 *
 * `reupload: true` = the stored file is unusable (missing, or the wrong kind of file — deleted) and the queue must
 * upload again. `terminal: true` = no retry can succeed (survey gone, a refused path / file, an inline file on a Blob
 * deployment or past the dev caps): the queue marks the file failed and keeps its bytes.
 */
export type FinalizeFileResult = FinalizePhotoResult;

/** Best effort: drop an uploaded file nothing refers to (this file's own path, no stored slot pointing at it). */
async function discardOrphan(surveyId: string, fileId: string, blobPath: string): Promise<void> {
  try {
    if (!filePathMatches(blobPath, surveyId, fileId)) return;
    const cur = await get(surveyId);
    if (cur && fileSlotOf(cur, fileId)?.blobPath === blobPath) return;
    await deleteBlob(blobPath);
  } catch {
    /* an orphaned file is harmless */
  }
}

/** Is the uploaded file what its id says (a JPEG, or a JSON strokes document)? null = couldn't check (retry). */
async function uploadedFileOk(blobPath: string, fileId: string): Promise<{ ok: boolean; missing?: true } | null> {
  try {
    if (fileContentType(fileId) === "application/json") {
      const stream = await getBlobStream(blobPath);
      if (!stream) return { ok: false, missing: true };
      const bytes = await readCapped(stream, UPLOAD_CAPS.json);
      return { ok: !!bytes && isJsonBytes(bytes) };
    }
    const head = await getBlobHead(blobPath, 16);
    if (!head) return { ok: false, missing: true };
    return { ok: sniffImageType(head.bytes) === "image/jpeg" };
  } catch (e) {
    return isBlobNotFound(e) ? { ok: false, missing: true } : null;
  }
}

export async function finalizeSurveyFile(surveyId: string, fileId: string, blobPath: string | null, inline?: string): Promise<FinalizeFileResult> {
  const user = await getOptionalUser();
  if (!user) return { ok: false, error: "Sign in again to finish uploading photos." };
  if (!can("create", user.roles)) return { ok: false, error: "You don't have permission to add photos." };
  if (typeof surveyId !== "string" || typeof fileId !== "string" || !FILE_ID_RE.test(fileId)) return { ok: false, error: "That file isn't valid.", terminal: true };

  if (blobPath) {
    if (typeof blobPath !== "string" || inline || !filePathMatches(blobPath, surveyId, fileId)) {
      return { ok: false, error: "The file path isn't this file's own path in this survey", terminal: true };
    }
    const checked = await uploadedFileOk(blobPath, fileId);
    if (!checked) return { ok: false, error: "Couldn't check the uploaded file — it will be retried." };
    if (checked.missing) return { ok: false, error: "The uploaded file isn't there", reupload: true };
    if (!checked.ok) {
      try {
        await deleteBlob(blobPath);
      } catch {
        /* best effort — the refusal stands either way */
      }
      return { ok: false, error: fileContentType(fileId) === "application/json" ? "That file isn't a drawing's strokes" : "That file isn't a JPEG photo", reupload: true };
    }
    const done = await applyFinalizedSurveyFile(surveyId, fileId, { blobPath }, user);
    if (!done.ok) {
      if (done.terminal) await discardOrphan(surveyId, fileId, blobPath);
      return done;
    }
    // A repeat upload of an already-finished file: the first file stays, this extra one goes.
    if (done.already && done.ref.blobPath !== blobPath) {
      try {
        await deleteBlob(blobPath);
      } catch {
        /* an orphaned extra file is harmless */
      }
    }
    return { ok: true, ref: done.ref, rev: done.rev };
  }

  // Inline files are local dev only: production (Blob configured) never stores base64 in the document.
  if (blobEnabled()) return { ok: false, error: "Photos upload to file storage on this deployment.", terminal: true };
  if (typeof inline !== "string" || !inline) return { ok: false, error: "There is no file to save." };
  const done = await applyFinalizedSurveyFile(surveyId, fileId, { inline }, user);
  return done.ok ? { ok: true, ref: done.ref, rev: done.rev } : done;
}
