import { requireUser } from "@/lib/session";
import { getBlobStream, safeName } from "@/lib/blob";
import { fileRefKey, ownsEngagementFile, safeMime, type FileRef } from "@/lib/consulting-files";
import { archiveDriveGrant, resolveEngagementDriveFolderId } from "@/lib/consulting-files-server";
import { getEngagement } from "@/lib/stores/engagements";
import { allNotes } from "@/lib/stores/notes";
import { DRIVE_API_BASE, UPLOAD_TIMEOUT_MS, driveFileHasParent } from "@/lib/google/drive";

/**
 * Authenticated engagement-file proxy (#145, D171).
 *
 * The URL addresses the persisted note and attachment slot, never a
 * client-supplied storage key. The server resolves the FileRef from that
 * note, then applies the existing positive blob-path and live Drive-parent
 * ownership checks before touching storage.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ engagementId: string; noteId: string; attachmentIndex: string }> }
): Promise<Response> {
  await requireUser();
  const { engagementId, noteId, attachmentIndex: rawIndex } = await ctx.params;
  const attachmentIndex = Number(rawIndex);
  if (!Number.isInteger(attachmentIndex) || attachmentIndex < 0) {
    return new Response("Not found", { status: 404 });
  }

  const engagement = await getEngagement(engagementId);
  if (!engagement) return new Response("Not found", { status: 404 });
  const note = (await allNotes()).find(
    (n) => n.id === noteId && n.parentKind === "engagement" && n.parentId === engagementId
  );
  const ref = note?.attachments[attachmentIndex] as FileRef | undefined;
  if (!ref || ref.kind === "data") return new Response("Not found", { status: 404 });

  const refs = (await allNotes())
    .filter((n) => n.parentKind === "engagement" && n.parentId === engagementId)
    .flatMap((n) => n.attachments);
  const requestedKey = fileRefKey(ref);
  if (!ownsEngagementFile(refs, requestedKey, engagementId)) {
    return new Response("Not found", { status: 404 });
  }

  const headers = {
    "content-type": safeMime(ref.mime),
    "content-disposition": `attachment; filename="${safeName(ref.name || "file")}"`,
    "cache-control": "private, max-age=86400",
    "x-content-type-options": "nosniff",
  };

  if (ref.kind === "blob") {
    const stream = await getBlobStream(ref.pathname);
    if (!stream) return new Response("File missing from storage", { status: 404 });
    return new Response(stream, { headers });
  }

  const grant = await archiveDriveGrant();
  if (!grant) return new Response("Drive is not connected", { status: 502 });
  const expectedFolderId = await resolveEngagementDriveFolderId(engagement, grant.token);
  if (!(await driveFileHasParent(grant.token, ref.fileId, expectedFolderId))) {
    return new Response("Not found", { status: 404 });
  }
  const driveRes = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(ref.fileId)}?alt=media`, {
    headers: { Authorization: "Bearer " + grant.token },
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!driveRes.ok || !driveRes.body) return new Response("File missing from storage", { status: 404 });
  return new Response(driveRes.body, { headers });
}
