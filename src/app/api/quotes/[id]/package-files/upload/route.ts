import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { blobEnabled } from "@/lib/blob";
import { parseUploadKey } from "@/lib/document-files";
import { MAX_PACKAGE_FILE_BYTES, PACKAGE_FILE_TYPES, PACKAGE_FILES_COPY, packageFilePathInScope } from "@/lib/estimate-output/package-files";
import { pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { ONLINE_COPY } from "@/lib/quote-share/view";
import { getOptionalUser } from "@/lib/session";
import { get as getQuote } from "@/lib/stores/quotes";
import { can } from "@/lib/team";

// Token minting only — no bytes pass through this function.
export const maxDuration = 30;

class UploadRefused extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * #301 slice C (D-j) — Vercel Blob client-upload broker for an estimate's
 * drawings (the #218 documents route's pattern). Only
 * `blob.generate-client-token` (no completion callback, so no
 * middleware exemption). The grant is for ONE path:
 * `estimate-files/<quote>/<uploadKey>/…` of a system quote, to a signed-in
 * Send holder, ≤ 25 MB. finalize (addPackageFileAction) re-checks the real
 * bytes before anything is recorded.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!blobEnabled()) return NextResponse.json({ reason: "blob-disabled", error: PACKAGE_FILES_COPY.noStorage }, { status: 503 });
  const { id } = await ctx.params;
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (body.type !== "blob.generate-client-token") return NextResponse.json({ error: "unsupported event" }, { status: 400 });
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const u = await getOptionalUser();
        if (!u) throw new UploadRefused(401, "unauthorized");
        if (!can("send", u.roles)) throw new UploadRefused(403, ONLINE_COPY.needsSend);
        const uploadKey = parseUploadKey(clientPayload);
        if (!uploadKey) throw new UploadRefused(400, "clientPayload must be {uploadKey}");
        const q = await getQuote(id);
        if (!q || pdfKindForQuoteType(q.quoteType) !== "quote") throw new UploadRefused(404, ONLINE_COPY.gone);
        if (!packageFilePathInScope(pathname, q.id, uploadKey)) throw new UploadRefused(400, PACKAGE_FILES_COPY.notThisQuote);
        return {
          maximumSizeInBytes: MAX_PACKAGE_FILE_BYTES,
          allowedContentTypes: [...PACKAGE_FILE_TYPES, "application/octet-stream"],
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ quoteId: q.id, uploadKey }),
        };
      },
    });
    return NextResponse.json(json);
  } catch (e) {
    if (e instanceof UploadRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    // Never show the vendor's own error to the browser — only our refusals.
    return NextResponse.json({ error: "Upload could not be authorized." }, { status: 400 });
  }
}
