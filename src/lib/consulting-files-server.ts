/**
 * Server-only counterpart to `consulting-files.ts` (#145, D171). Everything
 * here touches the DB, Drive, or the archive mailbox connection, so unlike
 * that module this one is NOT importable from a client component or spec-
 * tested with no DB — it is exercised against the real (test) stores in
 * scripts/test-review-and-spec.ts's async harness instead.
 *
 * Holds:
 *  - `archiveDriveGrant` — the app's one Drive connection (the archive
 *    mailbox, reused for engagement files — see the Task 9 report's
 *    judgement-call note), hoisted here so the upload route, the download
 *    proxy, and `validateFileRefsForEngagement` share one implementation
 *    instead of each resolving/casting it themselves.
 *  - `resolveEngagementDriveFolderId` — the engagement's persisted Drive
 *    folder id when one exists, else derives (and persists) it. Persisting
 *    means a later customer-name edit can't move where the download proxy
 *    expects an already-uploaded file to live, and a read never has the
 *    side effect of creating a Drive folder (`ensureFolderPath` does, on a
 *    miss) just to check something.
 *  - `validateFileRefsForEngagement` — the writer-side half of the #145
 *    security fix: a note-save writer (Task 7) takes client-supplied
 *    `FileRef[]` for its attachments, so THIS is where each one gets
 *    proven to actually belong to the named engagement before it is ever
 *    stored — mirroring the same two-kind split as the download proxy
 *    (structural for "blob", live-Drive for "drive") and additionally
 *    covering "data" refs, which the proxy never touches at all.
 */

import {
  engagementFolderPath,
  isOwnedBlobPathname,
  isValidDataRef,
  type FileRef,
} from "@/lib/consulting-files";
import { driveFileHasParent, ensureFolderPath } from "@/lib/google/drive";
import { getConnectionInfo, accessTokenFor } from "@/lib/gmail/connections";
import { hasDriveScope } from "@/lib/gmail/config";
import { getSettings } from "@/lib/settings";
import { getEngagement, patchEngagement, type ConsultingEngagement } from "@/lib/stores/engagements";

export type DriveGrant = { token: string };

/**
 * The archive mailbox's Drive grant, when one is connected and scoped for
 * Drive. JUDGEMENT CALL (Task 9 report): no dedicated "engagement files"
 * mailbox setting exists, so this reuses `settings.recordingsArchiveMailbox`
 * — the same connection krisp/archive.ts uses — rather than inventing a
 * second Drive-mailbox concept. Flagged for Jeff if that ever needs to
 * differ.
 */
export async function archiveDriveGrant(): Promise<DriveGrant | null> {
  const settings = await getSettings();
  const mailbox = settings.recordingsArchiveMailbox;
  if (!mailbox) return null;
  const info = await getConnectionInfo(mailbox);
  if (!info || !hasDriveScope(info.scope)) return null;
  const token = await accessTokenFor(mailbox);
  return token ? { token } : null;
}

/**
 * This engagement's Drive folder id — the persisted `driveFolderId` when
 * present, else derived via `ensureFolderPath` (which may create it) and
 * written back so no later call re-derives it. Re-deriving on every read
 * was the bug: `ensureFolderPath` walks the engagement's CURRENT customer
 * name, so an ordinary rename would move where the download proxy expects
 * an already-uploaded file to live, and a Drive miss during that walk
 * creates an empty folder as a side effect of a mere READ. Persisting once
 * fixes both, and drops four of the five Drive round trips a download used
 * to cost (folder resolution collapses to a single stored-field read).
 */
export async function resolveEngagementDriveFolderId(
  engagement: ConsultingEngagement,
  token: string
): Promise<string> {
  if (engagement.driveFolderId) return engagement.driveFolderId;
  const folderId = await ensureFolderPath(token, engagementFolderPath(engagement.customer, engagement.id));
  await patchEngagement(engagement.id, (d) => {
    d.driveFolderId = folderId;
  });
  return folderId;
}

/**
 * Validate every `FileRef` a note-save writer is about to attach to
 * `engagementId`, THROWING on the first one that doesn't actually belong
 * there. Returns the same refs unchanged on success — callers pass those
 * straight through to the write, never `refs` itself, so a caller can't
 * accidentally skip the check by holding onto the original array.
 *
 * This is the writer-side half of the #145 fix: `ownsEngagementFile` (the
 * reader-side half, in the download proxy) only ever sees refs a writer
 * ALREADY stored. Without this function, a crafted save is exactly what
 * lets a forged ref pass that reader-side check in the first place — see
 * the Task 9 report's Critical-fix section for the full attack.
 */
export async function validateFileRefsForEngagement(
  refs: readonly FileRef[],
  engagementId: string
): Promise<FileRef[]> {
  const engagement = await getEngagement(engagementId);
  if (!engagement) {
    throw new Error(`Engagement "${engagementId}" was not found — cannot validate its attachments.`);
  }

  // Resolved lazily, and at most once per call, even across several
  // "drive" refs in the same save.
  let driveCtx: { token: string; folderId: string } | null = null;

  for (const ref of refs) {
    if (ref.kind === "blob") {
      if (!isOwnedBlobPathname(ref.pathname, engagementId)) {
        throw new Error(`"${ref.name}" has a storage path that does not belong to this engagement.`);
      }
    } else if (ref.kind === "drive") {
      if (!driveCtx) {
        const grant = await archiveDriveGrant();
        if (!grant) {
          throw new Error(`"${ref.name}" is a Drive file, but no Drive connection is configured to verify it against.`);
        }
        const folderId = await resolveEngagementDriveFolderId(engagement, grant.token);
        driveCtx = { token: grant.token, folderId };
      }
      const owns = await driveFileHasParent(driveCtx.token, ref.fileId, driveCtx.folderId);
      if (!owns) {
        throw new Error(`"${ref.name}" does not belong to this engagement's Drive folder.`);
      }
    } else {
      if (!isValidDataRef(ref)) {
        throw new Error(`"${ref.name}" is not a safely inlineable attachment.`);
      }
    }
  }

  return refs.slice();
}
