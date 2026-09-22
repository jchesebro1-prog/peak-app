import { requireUser } from "@/lib/session";
import { getBlobStream, safeName } from "@/lib/blob";
import { fileRefKey, ownsEngagementFile, type FileRef } from "@/lib/consulting-files";
import { getEngagement } from "@/lib/stores/engagements";
import { allNotes } from "@/lib/stores/notes";
import { getSettings } from "@/lib/settings";
import { getConnectionInfo, accessTokenFor } from "@/lib/gmail/connections";
import { hasDriveScope } from "@/lib/gmail/config";
import { DRIVE_API_BASE } from "@/lib/google/drive";

/**
 * Authenticated engagement-file proxy (#145, D171).
 *
 * SECURITY — read this before touching this file. `fileId` reaches this
 * route from the URL a browser typed or a client constructed: it is
 * UNTRUSTED, exactly like `blobPath` was on the vendor-quote attachment
 * proxy before that review found a signed-in user could read any file in
 * the whole private Blob store by naming someone else's path. The fix
 * there — `ownsVendorQuoteBlobPath` — is mirrored here as `ownsEngagementFile`
 * (src/lib/consulting-files.ts): every `FileRef` actually stored on THIS
 * engagement is collected first, and `fileId` must match one of their
 * storage keys before a single byte of storage is touched. There is no
 * earlier return, no "trust the URL" shortcut, and no code path that reads
 * `getBlobStream`/Drive `alt=media` before that check has run.
 *
 * A data-URL `FileRef` has no storage key (`fileRefKey` returns ""), so it
 * can never appear as an owned match here — its bytes live in the note
 * document itself and are served to the client directly, never through
 * this route.
 *
 * Collection scope: every `FileRef` on every note attached to this
 * engagement (`parentKind: "engagement"`, `parentId: engagementId`). The
 * engagement's own `documents`/phase `attachments` fields (`EngagementDoc`,
 * stores/engagements.ts) are a separate, pre-#145 data-URL-only shape with
 * no storage key at all — they are not `FileRef`s and are not, and cannot
 * be, part of this ownership set. See the Task 9 report for why that is a
 * deliberate scope call rather than an oversight.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ engagementId: string; fileId: string }> }
): Promise<Response> {
  await requireUser();
  const { engagementId, fileId } = await ctx.params;
  const decodedEngagementId = decodeURIComponent(engagementId);
  const decodedFileId = decodeURIComponent(fileId);

  const engagement = await getEngagement(decodedEngagementId);
  if (!engagement) return new Response("Not found", { status: 404 });

  const notes = (await allNotes()).filter(
    (n) => n.parentKind === "engagement" && n.parentId === decodedEngagementId
  );
  const refs: FileRef[] = notes.flatMap((n) => n.attachments);

  // THE gate — nothing above this line has touched storage; nothing below
  // it may run unless this returns true.
  if (!ownsEngagementFile(refs, decodedFileId)) {
    return new Response("Not found", { status: 404 });
  }

  const ref = refs.find((r) => fileRefKey(r) === decodedFileId);
  // Unreachable if ownsEngagementFile returned true (its own scan just found
  // this exact key), but never trust a control-flow guarantee over a real
  // check when the alternative is streaming the wrong file.
  if (!ref) return new Response("Not found", { status: 404 });

  const headers = {
    "content-type": ref.mime || "application/octet-stream",
    "content-disposition": `attachment; filename="${safeName(ref.name || "file")}"`,
    "cache-control": "private, max-age=86400",
  };

  if (ref.kind === "blob") {
    const stream = await getBlobStream(ref.pathname);
    if (!stream) return new Response("File missing from storage", { status: 404 });
    return new Response(stream, { headers });
  }

  // A "data" ref has no storage key and can therefore never pass
  // ownsEngagementFile above — but the type checker doesn't know that, so
  // this is a real narrowing check, not just documentation of one.
  if (ref.kind !== "drive") return new Response("Not found", { status: 404 });

  const settings = await getSettings();
  const mailbox = settings.recordingsArchiveMailbox;
  const info = mailbox ? await getConnectionInfo(mailbox) : null;
  const token = info && hasDriveScope(info.scope) ? await accessTokenFor(mailbox as string) : null;
  if (!token) return new Response("Drive is not connected", { status: 502 });

  const driveRes = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(ref.fileId)}?alt=media`, {
    headers: { Authorization: "Bearer " + token },
  });
  if (!driveRes.ok || !driveRes.body) return new Response("File missing from storage", { status: 404 });
  return new Response(driveRes.body, { headers });
}
