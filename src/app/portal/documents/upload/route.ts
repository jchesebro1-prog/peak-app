import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { blobEnabled } from "@/lib/blob";
import { portalSession } from "@/lib/portal";
import { MAX_DOCUMENT_BYTES, parseUploadKey, uploadGrantError } from "@/lib/document-files";

// Token minting only — no bytes pass through this function.
export const maxDuration = 30;

/**
 * Vercel Blob client-upload broker for CUSTOMER uploads (#218). Lives under
 * /portal so it shares the portal's middleware exemption (customers have no
 * team session) and authenticates itself with portalSession() — the grant
 * cookie. The company comes from the session ONLY: the client payload is
 * read for its upload key and nothing else, and the path must sit under
 * `documents/<session company>/<uploadKey>/`. The portal finalize action
 * re-checks the bytes before anything is recorded.
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
        const session = await portalSession();
        if (!session) throw new UploadRefused(401, "Your access link has expired — open the link we sent you again.");
        const uploadKey = parseUploadKey(clientPayload);
        if (!uploadKey) throw new UploadRefused(400, "clientPayload must carry an uploadKey");
        const bad = uploadGrantError(pathname, session.customerId, uploadKey);
        if (bad) throw new UploadRefused(400, bad);
        return {
          maximumSizeInBytes: MAX_DOCUMENT_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ customerId: session.customerId, uploadKey }),
        };
      },
    });
    return NextResponse.json(json);
  } catch (e) {
    if (e instanceof UploadRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Upload could not be authorized." }, { status: 400 });
  }
}
