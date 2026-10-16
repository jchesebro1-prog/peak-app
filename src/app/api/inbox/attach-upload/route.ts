import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/auth";
import { blobEnabled } from "@/lib/blob";
import { MAIL_ATTACH_MAX_BYTES, mailBlobPathInScope, mailUploadPrefix, parseMailUploadPayload } from "@/lib/mail-attachments";

// Token minting only — no bytes pass through this function (Batch 6 #64).
export const maxDuration = 30;

/**
 * Vercel Blob client-upload broker for the Inbox composer's Attach button
 * (Batch 6 #64) — the #218 documents route's pattern. Only
 * `blob.generate-client-token` is handled (no onUploadCompleted, so no
 * callback and no middleware exemption). The grant is for ONE path under the
 * signed-in user's own folder: `mail-attachments/<user>/<uploadKey>/…`, up to
 * 25 MB. finalizeMailUploadAction re-checks the real bytes before the file
 * can ride on an email.
 */
class UploadRefused extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
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
        const payload = parseMailUploadPayload(clientPayload);
        if (!payload) throw new UploadRefused(400, "clientPayload must be {uploadKey}");
        if (!mailBlobPathInScope(pathname, u.id, payload.uploadKey)) {
          throw new UploadRefused(400, `pathname must be ${mailUploadPrefix(u.id, payload.uploadKey)}<file>`);
        }
        return {
          maximumSizeInBytes: MAIL_ATTACH_MAX_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId: u.id, uploadKey: payload.uploadKey }),
        };
      },
    });
    return NextResponse.json(json);
  } catch (e) {
    if (e instanceof UploadRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Upload could not be authorized." }, { status: 400 });
  }
}
