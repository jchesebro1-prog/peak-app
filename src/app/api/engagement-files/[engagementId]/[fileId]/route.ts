import { requireUser } from "@/lib/session";
import { getBlobStream, safeName } from "@/lib/blob";
import { engagementFolderPath, fileRefKey, ownsEngagementFile, type FileRef } from "@/lib/consulting-files";
import { getEngagement } from "@/lib/stores/engagements";
import { allNotes } from "@/lib/stores/notes";
import { getSettings } from "@/lib/settings";
import { getConnectionInfo, accessTokenFor } from "@/lib/gmail/connections";
import { hasDriveScope } from "@/lib/gmail/config";
import { DRIVE_API_BASE, META_TIMEOUT_MS, UPLOAD_TIMEOUT_MS, ensureFolderPath } from "@/lib/google/drive";

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
 * an authenticated user can save any `{kind, fileId|pathname, ...}` they
 * like onto their own note, then GET it back through this route. Both
 * halves of the check run here, in this order, before a single byte of
 * storage is touched:
 *
 *  1. `ownsEngagementFile(refs, fileId, engagementId)` — is the key stored
 *     on THIS engagement's own notes, AND (for a "blob" key) does its
 *     pathname structurally sit under this exact engagement's own upload
 *     prefix, with no `..`. This is the DB-plus-shape check, same as
 *     `ownsVendorQuoteBlobPath`.
 *  2. For a "drive" key specifically: a Drive file id has no shape to
 *     bind (Google assigns it, not this app), so step 1 can only prove
 *     "some FileRef claims this id" — not "this id truly lives in this
 *     engagement's own Drive folder." A crafted note attachment could
 *     name ANY Drive file id the archive account's `drive.file` grant can
 *     see, including another engagement's files or an archived Krisp
 *     recording. So before streaming a "drive" ref, this route makes a
 *     LIVE call to Drive itself — `files/<id>?fields=parents` — and
 *     confirms the file's actual current parent is this engagement's own
 *     folder (the same id `ensureFolderPath(engagementFolderPath(...))`
 *     resolves). An attacker can forge what gets WRITTEN to a note; they
 *     cannot forge what Drive itself says a file's parent is.
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

  // ref.mime is echoed from client-supplied metadata (set at upload time).
  // A value containing CR/LF would throw inside the Response constructor
  // (an injected header) and 500 instead of refusing cleanly — clamp it.
  const safeMime = ref.mime && !/[\r\n]/.test(ref.mime) ? ref.mime : "application/octet-stream";
  const headers = {
    "content-type": safeMime,
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

  const settings = await getSettings();
  const mailbox = settings.recordingsArchiveMailbox;
  const info = mailbox ? await getConnectionInfo(mailbox) : null;
  const token = info && hasDriveScope(info.scope) ? await accessTokenFor(mailbox as string) : null;
  if (!token) return new Response("Drive is not connected", { status: 502 });

  // Gate, half 2 (drive only) — live re-check against Drive's own metadata.
  // ownsEngagementFile above only proved "some FileRef on this engagement's
  // notes claims this fileId"; a Drive id has no shape to bind, so that
  // alone is NOT sufficient (see the file header). Resolve the folder this
  // engagement's uploads actually land in, and confirm the file's live
  // `parents` names it — an attacker can forge a note's stored FileRef, but
  // not Drive's own record of where a file actually lives.
  let parents: string[];
  try {
    const [expectedFolderId, meta] = await Promise.all([
      ensureFolderPath(token, engagementFolderPath(engagement.customer, engagement.id)),
      fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(ref.fileId)}?fields=parents`, {
        headers: { Authorization: "Bearer " + token },
        signal: AbortSignal.timeout(META_TIMEOUT_MS),
      }).then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { parents?: string[] };
      }),
    ]);
    parents = meta?.parents ?? [];
    if (!parents.includes(expectedFolderId)) {
      return new Response("Not found", { status: 404 });
    }
  } catch {
    // A Drive hiccup during the re-check must refuse, never fall through
    // to streaming — "couldn't verify" is not "verified."
    return new Response("File missing from storage", { status: 404 });
  }

  const driveRes = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(ref.fileId)}?alt=media`, {
    headers: { Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!driveRes.ok || !driveRes.body) return new Response("File missing from storage", { status: 404 });
  return new Response(driveRes.body, { headers });
}
