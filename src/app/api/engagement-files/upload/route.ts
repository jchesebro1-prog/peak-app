import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { blobEnabled, putBlob, safeName } from "@/lib/blob";
import { VENDOR_UPLOAD_MAX_BYTES, VENDOR_UPLOAD_MAX_LABEL } from "@/lib/vendor-quote-file";
import { DATA_URL_MAX_BYTES, ENGAGEMENT_FILES_BLOB_PREFIX, engagementFolderPath } from "@/lib/consulting-files";
import { ensureFolderPath, initiateResumableSession, DriveApiError } from "@/lib/google/drive";
import { getSettings } from "@/lib/settings";
import { getConnectionInfo, accessTokenFor } from "@/lib/gmail/connections";
import { hasDriveScope } from "@/lib/gmail/config";
import { getEngagement } from "@/lib/stores/engagements";

/**
 * Engagement-file upload broker (#145, D171).
 *
 * Two-phase by design, so a large drawing set never rides this route's own
 * body: the client's FIRST call carries only metadata (JSON — engagementId,
 * name, mime, size, no bytes) and asks where the file should go. When the
 * archive Drive connection is available we open a resumable session
 * (`initiateResumableSession`, drive.ts) and hand back its URL; the BROWSER
 * then PUTs the bytes straight to Google, and Drive's own PUT response
 * (`fields=id,webViewLink`, set on the session) gives the browser everything
 * it needs to build the `FileRef` itself — this route never sees those bytes.
 *
 * When Drive isn't connected but Blob storage is, the client makes a SECOND
 * call — this time multipart, carrying the bytes — which this same route
 * detects by Content-Type and stores via `putBlob`. That leg reuses
 * `VENDOR_UPLOAD_MAX_BYTES`/`VENDOR_UPLOAD_MAX_LABEL` from vendor-quote-file.ts
 * (#143) rather than restating a second ceiling that could drift from it —
 * see the note below on why NOT that module's content-type rules too.
 *
 * When neither is configured, the response says so (`{ mode: "data" }`) and
 * the client inlines a data-URL locally — nothing further to call here.
 *
 * JUDGEMENT CALL (flagged per the task brief, not resolved silently): which
 * Drive mailbox counts as "connected" for engagement files. No dedicated
 * setting exists yet — only `settings.recordingsArchiveMailbox`, built for
 * the Krisp recordings archive. Adding a second, engagement-files-specific
 * mailbox setting is a schema/Settings-UI change outside this task's file
 * list, so this reuses the SAME archive mailbox as the app's one Drive
 * connection. If Peak ever wants a different Google account backing
 * engagement files than backs the recordings archive, that needs its own
 * settings field and its own Settings UI — flagged for Jeff, not decided
 * here.
 */

// One metadata round trip, or one bounded Blob write — nowhere near this,
// but a slow uplink must not have the function expire mid-transfer.
export const maxDuration = 60;

type InitiateBody = { engagementId?: unknown; name?: unknown; mime?: unknown; size?: unknown };

const tooBig = () =>
  `That file is larger than ${VENDOR_UPLOAD_MAX_LABEL}. Connect a Drive archive mailbox in Settings for larger files, or paste a Link instead.`;

/** The archive mailbox's Drive grant, when one is connected and scoped for
 *  Drive — the same connection krisp/archive.ts uses, reused here (see the
 *  judgement-call note above) rather than inventing a second Drive mailbox
 *  concept. */
async function archiveDriveGrant(): Promise<{ token: string } | null> {
  const settings = await getSettings();
  const mailbox = settings.recordingsArchiveMailbox;
  if (!mailbox) return null;
  const info = await getConnectionInfo(mailbox);
  if (!info || !hasDriveScope(info.scope)) return null;
  const token = await accessTokenFor(mailbox);
  return token ? { token } : null;
}

/**
 * `{ mode: "data" }`, or a 413 refusal when the raw size is over
 * `DATA_URL_MAX_BYTES` — that ceiling exists because whatever saves a
 * "data" ref carries the base64 dataUrl inside ITS OWN payload (a note-save
 * server action, capped ~1200kb per AGENTS.md), and base64 inflates by
 * 4/3. Refusing here means the client hears this route's own JSON error
 * instead of a platform-level failure surfacing downstream at save time.
 */
function dataModeOrTooBig(size: number, warning?: string): NextResponse {
  if (size > DATA_URL_MAX_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: `That file is too large to store without Drive or Blob configured (limit ${Math.round(DATA_URL_MAX_BYTES / 1024)}KB). Connect a Drive archive mailbox or Blob storage in Settings, or paste a Link instead.`,
        maxBytes: DATA_URL_MAX_BYTES,
      },
      { status: 413 }
    );
  }
  return NextResponse.json(warning ? { mode: "data", warning } : { mode: "data" });
}

export async function POST(req: Request): Promise<NextResponse> {
  await requireUser();

  const contentType = req.headers.get("content-type") || "";

  /* ---- Phase 2 (Blob fallback only): the follow-up call that carries bytes ---- */
  if (contentType.includes("multipart/form-data")) {
    if (!blobEnabled()) {
      return NextResponse.json({ ok: false, error: "Blob storage is not configured on this server." }, { status: 503 });
    }
    const declared = Number(req.headers.get("content-length") || 0);
    if (declared > VENDOR_UPLOAD_MAX_BYTES + 64 * 1024) {
      return NextResponse.json({ ok: false, error: tooBig() }, { status: 413 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ ok: false, error: "Expected a file upload." }, { status: 400 });
    }

    const engagementId = String(form.get("engagementId") || "");
    const file = form.get("file");
    if (!engagementId) return NextResponse.json({ ok: false, error: "Missing engagementId." }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "No file was attached." }, { status: 400 });
    if (file.size === 0) return NextResponse.json({ ok: false, error: "That file is empty." }, { status: 400 });
    if (file.size > VENDOR_UPLOAD_MAX_BYTES) return NextResponse.json({ ok: false, error: tooBig() }, { status: 413 });

    const engagement = await getEngagement(engagementId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Engagement not found." }, { status: 404 });

    const mime = file.type || "application/octet-stream";
    const bytes = Buffer.from(await file.arrayBuffer());
    try {
      const stored = await putBlob(
        `${ENGAGEMENT_FILES_BLOB_PREFIX}${engagementId}/${safeName(file.name || "file")}`,
        bytes,
        mime
      );
      // putBlob adds a random suffix — the RETURNED pathname is the only one
      // that resolves, never the one we asked for.
      return NextResponse.json({
        mode: "blob",
        pathname: stored.pathname,
        name: file.name || "file",
        mime,
        size: file.size,
      });
    } catch (e) {
      console.error("[engagement-files] blob upload failed:", e);
      return NextResponse.json({ ok: false, error: "That file could not be stored." }, { status: 502 });
    }
  }

  /* ---- Phase 1: metadata-only — decide where the bytes should go ---- */
  let body: InitiateBody;
  try {
    body = (await req.json()) as InitiateBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Expected JSON." }, { status: 400 });
  }
  const engagementId = typeof body.engagementId === "string" ? body.engagementId : "";
  const name = typeof body.name === "string" ? body.name : "";
  const mime = typeof body.mime === "string" && body.mime ? body.mime : "application/octet-stream";
  const size = typeof body.size === "number" && body.size >= 0 ? body.size : NaN;
  if (!engagementId || !name || Number.isNaN(size)) {
    return NextResponse.json({ ok: false, error: "engagementId, name and size are required." }, { status: 400 });
  }

  const engagement = await getEngagement(engagementId);
  if (!engagement) return NextResponse.json({ ok: false, error: "Engagement not found." }, { status: 404 });

  const grant = await archiveDriveGrant();
  if (grant) {
    try {
      const folderId = await ensureFolderPath(grant.token, engagementFolderPath(engagement.customer, engagement.id));
      const sessionUrl = await initiateResumableSession(grant.token, { name, mime, parentId: folderId, size });
      return NextResponse.json({ mode: "drive", sessionUrl });
    } catch (e) {
      const msg = e instanceof DriveApiError ? e.message : "Drive could not start that upload.";
      console.error("[engagement-files] initiate failed:", e);
      // Fall through to Blob/data rather than failing the whole request —
      // a Drive hiccup should not block someone attaching a file to a note.
      if (!blobEnabled()) return dataModeOrTooBig(size, msg);
    }
  }

  if (blobEnabled()) return NextResponse.json({ mode: "blob" });
  return dataModeOrTooBig(size);
}
