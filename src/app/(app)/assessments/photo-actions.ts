"use server";

import { getOptionalUser } from "@/lib/session";
import { can } from "@/lib/team";
import { blobEnabled, deleteBlob, getBlobHead, isBlobNotFound } from "@/lib/blob";
import { sniffImageType } from "@/lib/part-docs/files";
import { PHOTO_ID_RE, photoPathMatches } from "@/lib/assessments/photos";
import { applyFinalizedPhoto, getAssessment, removePendingPhoto } from "@/lib/stores/assessments";

/**
 * Assessment photos (#340) — the server half of the device upload queue. Called from the browser's photo queue after
 * its bytes have gone straight to private Blob (or, in local dev with no Blob, with the shrunken JPEG as a small data
 * URL). It never redirects: the queue needs `{ ok:false, error }` to back off and try again.
 *
 * `reupload: true` on a refusal means the stored file is unusable (missing, not a JPEG — it has been deleted) and the
 * queue must upload the photo again rather than retry the finalize. `terminal: true` means no retry can ever succeed
 * (assessment gone or completed, a refused path / image, a capture rejected for good): the queue marks the photo
 * failed, keeps its bytes, and the uploaded file (when no stored ref points at it) has been deleted.
 */
export type FinalizePhotoResult =
  | { ok: true; ref: { blobPath: string } | { inline: string }; rev: number }
  | { ok: false; error: string; reupload?: true; terminal?: true };

/** Best effort: drop an uploaded file nothing refers to. The path must be this photo's own file, and no stored photo
 *  ref (of any photo) may point at it. */
async function discardOrphan(assessmentId: string, photoId: string, blobPath: string): Promise<void> {
  try {
    if (!photoPathMatches(blobPath, assessmentId, photoId)) return;
    const cur = await getAssessment(assessmentId);
    if (cur?.photos.some((p) => p.blobPath === blobPath)) return;
    await deleteBlob(blobPath);
  } catch {
    /* an orphaned file is harmless */
  }
}

export async function finalizeAssessmentPhoto(
  assessmentId: string,
  photoId: string,
  blobPath: string | null,
  inline?: string,
): Promise<FinalizePhotoResult> {
  const user = await getOptionalUser();
  if (!user) return { ok: false, error: "Sign in again to finish uploading photos." };
  if (!can("create", user.roles)) return { ok: false, error: "You don't have permission to add photos." };
  if (typeof assessmentId !== "string" || typeof photoId !== "string" || !PHOTO_ID_RE.test(photoId)) return { ok: false, error: "That photo isn't valid.", terminal: true };

  if (blobPath) {
    if (typeof blobPath !== "string" || inline || !photoPathMatches(blobPath, assessmentId, photoId)) {
      return { ok: false, error: "The file path isn't this photo's own file in this assessment", terminal: true };
    }
    let head: Awaited<ReturnType<typeof getBlobHead>>;
    try {
      head = await getBlobHead(blobPath, 16);
    } catch (e) {
      if (!isBlobNotFound(e)) return { ok: false, error: "Couldn't check the uploaded file — it will be retried." };
      head = null;
    }
    if (!head) return { ok: false, error: "The uploaded file isn't there", reupload: true };
    if (sniffImageType(head.bytes) !== "image/jpeg") {
      try {
        await deleteBlob(blobPath);
      } catch {
        /* best effort — the refusal stands either way */
      }
      return { ok: false, error: "That file isn't a JPEG photo", reupload: true };
    }
    const done = await applyFinalizedPhoto(assessmentId, photoId, { blobPath }, user);
    if (!done.ok) {
      if (done.terminal) await discardOrphan(assessmentId, photoId, blobPath);
      return done;
    }
    // A repeat upload of an already-finished photo: the first file stays, this extra one goes.
    if (done.already && done.ref.blobPath !== blobPath) {
      try {
        await deleteBlob(blobPath);
      } catch {
        /* an orphaned extra file is harmless */
      }
    }
    return { ok: true, ref: done.ref, rev: done.rev };
  }

  // Inline photos are local dev only: production (Blob configured) never stores base64 in the document.
  if (blobEnabled()) return { ok: false, error: "Photos upload to file storage on this deployment.", terminal: true };
  if (typeof inline !== "string" || !inline) return { ok: false, error: "There is no photo to save." };
  const done = await applyFinalizedPhoto(assessmentId, photoId, { inline }, user);
  return done.ok ? { ok: true, ref: done.ref, rev: done.rev } : done;
}

export type RemovePendingPhotoResult = { ok: true; rev: number } | { ok: false; error: string; terminal?: true };

/**
 * The escape hatch for a pending photo whose device copy is gone (a Mark complete blocked by "uploading" forever):
 * removes the still-pending ref and its mentions in answers. A photo that has already uploaded, or a completed
 * assessment, is refused (`terminal`). Returns the stored rev for the editor to adopt.
 */
export async function removePendingPhotoAction(assessmentId: string, photoId: string): Promise<RemovePendingPhotoResult> {
  const user = await getOptionalUser();
  if (!user) return { ok: false, error: "Sign in again to remove the photo." };
  if (!can("create", user.roles)) return { ok: false, error: "You don't have permission to change photos." };
  const done = await removePendingPhoto(assessmentId, photoId, user);
  return done.ok ? { ok: true, rev: done.rev } : { ok: false, error: done.error, ...(done.terminal ? { terminal: true as const } : {}) };
}
