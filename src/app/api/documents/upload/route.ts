import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/auth";
import { blobEnabled } from "@/lib/blob";
import { getCompany } from "@/lib/identity/companies";
import { MAX_DOCUMENT_BYTES, parseUploadPayload, uploadGrantError } from "@/lib/document-files";

// Token minting only — no bytes pass through this function.
export const maxDuration = 30;

/**
 * Vercel Blob client-upload broker for team documents (#218) — the #207
 * part-documents route's pattern. Only `blob.generate-client-token` is
 * handled (no onUploadCompleted, so no callback and no middleware
 * exemption). The grant is for ONE path: `documents/<company>/<uploadKey>/…`
 * of a company that exists. Any file type up to 100 MB is allowed here; the
 * finalize action (finalizeTeamDocumentAction → finalizeDocumentUpload)
 * re-checks the real bytes before anything is recorded.
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
        const payload = parseUploadPayload(clientPayload);
        if (!payload) throw new UploadRefused(400, "clientPayload must be {customerId, uploadKey}");
        if (!(await getCompany(payload.customerId))) throw new UploadRefused(404, "That company no longer exists.");
        const bad = uploadGrantError(pathname, payload.customerId, payload.uploadKey);
        if (bad) throw new UploadRefused(400, bad);
        return {
          maximumSizeInBytes: MAX_DOCUMENT_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify(payload),
        };
      },
    });
    return NextResponse.json(json);
  } catch (e) {
    if (e instanceof UploadRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    // Anything else (a BlobError, a network failure inside handleUpload) is
    // never shown to the browser — only our own refusals are.
    return NextResponse.json({ error: "Upload could not be authorized." }, { status: 400 });
  }
}
