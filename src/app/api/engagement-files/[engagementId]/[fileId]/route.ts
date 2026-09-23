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
 * SECURITY — read this before touching this file. `fileId` reaches this
 * route from the URL a browser typed or a client constructed: it is
 * UNTRUSTED, exactly like `blobPath` was on the vendor-quote attachment
 * proxy before that review found a signed-in user could read any file in
 * the whole private Blob store by naming someone else's path. That fix —
 * `ownsVendorQuoteBlobPath` — is actually TWO checks: is the id on the
 * record's own attachment field, AND does the path's own shape prove it
 * belongs there. Mirroring only the first half here would leave exactly
 * the hole that precedent exists to close, because this feature's own
 * writer (a note's `attachments: FileRef[]`) takes CLIENT-SUPPLIED data —
 * an authenticated user could otherwise save any `{kind, fileId|pathname,
 * ...}` they like onto their own note, then GET it back through this
 * route. Both halves of the check run here, in this order, before a
 * single byte of storage is touched:
 *
 *  1. `ownsEngagementFile(refs, fileId, engagementId)` — is the key stored
 *     on THIS engagement's own notes, AND (for a "blob" key) does its
 *     pathname structurally sit under this exact engagement's own upload
 *     prefix (`isOwnedBlobPathname`, consulting-files.ts — a POSITIVE
 *     shape check, not a `..` denylist: `@vercel/blob` interpolates a
 *     pathname raw into the blob URL, so a percent-encoded traversal
 *     segment carries no literal `..` and a denylist alone would miss it).
 *  2. For a "drive" key specifically: a Drive file id has no shape to
 *     bind (Google assigns it, not this app), so step 1 can only prove
 *     "some FileRef claims this id" — not "this id truly lives in this
 *     engagement's own Drive folder." So before streaming a "drive" ref,
 *     this route asks Drive itself, live (`driveFileHasParent`, drive.ts)
 *     — an attacker can forge what gets WRITTEN to a note; they cannot
 *     forge what Drive reports a file's actual parent to be. This is the
 *     SAME check `consulting-files-server.ts`'s `validateFileRefsForEngagement`
 *     (the writer-side half, for Task 7's note-save) uses — one
 *     implementation, not two that could drift.
 *
 * A data-URL `FileRef` has no storage key (`fileRefKey` returns ""), so it
 * can never appear as an owned match here — its bytes live in the note
 * document itself and are served to the client directly, never through
 * this route. (`validateFileRefsForEngagement` is what inspects a "data"
 * ref's `dataUrl` — the only place that happens at all, since this proxy
 * never does.)
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
  // Next.js has ALREADY URL-decoded these dynamic segments by the time
  // `params` resolves — decoding again is both unnecessary and dangerous: a
  // filename containing a literal, non-escape "%" throws URIError on a
  // second decode and would 500 instead of 404.
  const { engagementId, fileId } = await ctx.params;

  const engagement = await getEngagement(engagementId);
  if (!engagement) return new Response("Not found", { status: 404 });

  const notes = (await allNotes()).filter(
    (n) => n.parentKind === "engagement" && n.parentId === engagementId
  );
  const refs: FileRef[] = notes.flatMap((n) => n.attachments);

  // Gate, half 1 — nothing above this line has touched storage; nothing
  // below it may run unless this returns true. See the file header for
  // what this does and does not prove.
  if (!ownsEngagementFile(refs, fileId, engagementId)) {
    return new Response("Not found", { status: 404 });
  }

  const ref = refs.find((r) => fileRefKey(r) === fileId);
  // Unreachable if ownsEngagementFile returned true (its own scan just found
  // this exact key), but never trust a control-flow guarantee over a real
  // check when the alternative is streaming the wrong file.
  if (!ref) return new Response("Not found", { status: 404 });

  const headers = {
    // ref.mime is echoed from client-supplied metadata (set at upload
    // time) — positively validated, not just denylisted, so a value with
    // any out-of-grammar byte (CR/LF header injection, non-ASCII, control
    // bytes) clamps to a safe default instead of throwing inside the
    // Response constructor and 500ing.
    "content-type": safeMime(ref.mime),
    "content-disposition": `attachment; filename="${safeName(ref.name || "file")}"`,
    "cache-control": "private, max-age=86400",
    // The upload route enforces no content-type allowlist (see the Task 9
    // report — vendor-quote-file.ts, which this mirrors, doesn't either);
    // forcing "attachment" (never inline) plus this header is the
    // compensating control against a browser sniffing an HTML/SVG payload
    // into executing in this origin.
    "x-content-type-options": "nosniff",
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

  const grant = await archiveDriveGrant();
  if (!grant) return new Response("Drive is not connected", { status: 502 });

  // Gate, half 2 (drive only) — live re-check against Drive's own metadata.
  // ownsEngagementFile above only proved "some FileRef on this engagement's
  // notes claims this fileId"; a Drive id has no shape to bind, so that
  // alone is NOT sufficient (see the file header). `resolveEngagementDriveFolderId`
  // reads the engagement's PERSISTED folder id (falling back to deriving —
  // and persisting — it only when absent, never re-deriving from the
  // engagement's current, mutable customer name on every download), and
  // `driveFileHasParent` asks Drive, live, whether this file is actually
  // filed there. An attacker can forge a note's stored FileRef, but not
  // Drive's own record of where a file actually lives.
  const expectedFolderId = await resolveEngagementDriveFolderId(engagement, grant.token);
  const owns = await driveFileHasParent(grant.token, ref.fileId, expectedFolderId);
  if (!owns) return new Response("Not found", { status: 404 });

  const driveRes = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(ref.fileId)}?alt=media`, {
    headers: { Authorization: "Bearer " + grant.token },
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!driveRes.ok || !driveRes.body) return new Response("File missing from storage", { status: 404 });
  return new Response(driveRes.body, { headers });
}
