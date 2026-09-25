import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/auth";
import { blobEnabled } from "@/lib/blob";
import { UPLOAD_CONTENT_TYPES } from "@/lib/part-docs/files";
import { blobPathBelongsTo, isDocumentId, MAX_PART_DOC_BYTES } from "@/lib/part-docs/types";

// Token minting only — no bytes pass through this function.
export const maxDuration = 30;

/**
 * Vercel Blob client-upload broker for part documents (#207, spec §6) — the
 * recordings route's pattern (src/app/api/recordings/upload/route.ts), so a
 * 25 MB PDF goes browser → Blob directly instead of through the ~900 KB
 * server-action ceiling the old datasheet upload hit.
 *
 * Only the `blob.generate-client-token` step is handled: there is no
 * `onUploadCompleted`, so no callback URL is issued and the route needs no
 * middleware exemption. The browser then calls attachUploadedDocumentAction /
 * replaceDocumentFileAction, which read the uploaded bytes back and check
 * them by magic number before anything is recorded — the content types
 * allowed here are only a first filter.
 */

class UploadRefused extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

function parseDocumentId(payload: string | null): string {
  try {
    const parsed = payload ? (JSON.parse(payload) as { documentId?: unknown }) : {};
    if (!isDocumentId(parsed.documentId)) throw new Error("bad id");
    return parsed.documentId;
  } catch {
    throw new UploadRefused(400, "clientPayload must be {documentId}");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!blobEnabled()) {
    return NextResponse.json({ reason: "blob-disabled", error: "File storage isn't configured on this deployment." }, { status: 503 });
  }
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (body.type !== "blob.generate-client-token") {
    return NextResponse.json({ error: "unsupported event" }, { status: 400 });
  }
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const session = await auth();
        const u = session?.user;
        if (!u?.id || !u.active) throw new UploadRefused(401, "unauthorized");
        const documentId = parseDocumentId(clientPayload);
        if (!blobPathBelongsTo(pathname, documentId)) {
          throw new UploadRefused(400, `pathname must be part-docs/${documentId}/<file>`);
        }
        return {
          allowedContentTypes: [...UPLOAD_CONTENT_TYPES],
          maximumSizeInBytes: MAX_PART_DOC_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ documentId }),
        };
      },
    });
    return NextResponse.json(json);
  } catch (e) {
    if (e instanceof UploadRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    // Anything else (a BlobError, a network failure inside handleUpload,
    // an unsigned/malformed callback) is never shown to the browser —
    // only our own UploadRefused messages are meant to be seen.
    return NextResponse.json({ error: "Upload could not be authorized." }, { status: 400 });
  }
}
