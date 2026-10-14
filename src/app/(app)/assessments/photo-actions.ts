"use server";

import { getOptionalUser } from "@/lib/session";
import { can } from "@/lib/team";
import { deleteBlob, getBlobHead, isBlobNotFound } from "@/lib/blob";
import { sniffImageType } from "@/lib/part-docs/files";
import { photoPathInScope } from "@/lib/assessments/photos";
import { applyFinalizedPhoto } from "@/lib/stores/assessments";

/**
 * Assessment photos (#337) — the server half of the device upload queue. Called from the browser's photo queue after
 * its bytes have gone straight to private Blob (or, in local dev with no Blob, with the shrunken JPEG as a small data
 * URL). It never redirects: the queue needs `{ ok:false, error }` to back off and try again.
 *
 * `reupload: true` on a refusal means the stored file is unusable (missing, not a JPEG — it has been deleted) and the
 * queue must upload the photo again rather than retry the finalize.
 */
export type FinalizePhotoResult =
  | { ok: true; ref: { blobPath: string } | { inline: string } }
  | { ok: false; error: string; reupload?: true };

const PHOTO_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

export async function finalizeAssessmentPhoto(
  assessmentId: string,
  photoId: string,
  blobPath: string | null,
  inline?: string,
): Promise<FinalizePhotoResult> {
  const user = await getOptionalUser();
  if (!user) return { ok: false, error: "Sign in again to finish uploading photos." };
  if (!can("create", user.roles)) return { ok: false, error: "You don't have permission to add photos." };
  if (typeof assessmentId !== "string" || typeof photoId !== "string" || !PHOTO_ID_RE.test(photoId)) return { ok: false, error: "That photo isn't valid." };

  if (blobPath) {
    if (typeof blobPath !== "string" || inline || !photoPathInScope(blobPath, assessmentId)) return { ok: false, error: "The file path is outside this assessment" };
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
    if (!done.ok) return done;
    // A repeat upload of an already-finished photo: the first file stays, this extra one goes.
    if (done.already && done.ref.blobPath !== blobPath) {
      try {
        await deleteBlob(blobPath);
      } catch {
        /* an orphaned extra file is harmless */
      }
    }
    return { ok: true, ref: done.ref };
  }

  if (typeof inline !== "string" || !inline) return { ok: false, error: "There is no photo to save." };
  const done = await applyFinalizedPhoto(assessmentId, photoId, { inline }, user);
  return done.ok ? { ok: true, ref: done.ref } : done;
}
