import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/auth";
import { blobEnabled } from "@/lib/blob";
import { can } from "@/lib/team";
import { FILE_ID_RE, UPLOAD_CAPS, fileBlobPath, fileContentType, filePathMatches } from "@/lib/field-files/files";
import { get as getSurvey } from "@/lib/stores/surveys";

// Token minting only — no bytes pass through this function.
export const maxDuration = 30;

/**
 * Vercel Blob client-upload broker for survey files (#344 C4) — the assessment photo broker's pattern
 * (`/api/assessments/[id]/photos/upload`). Only `blob.generate-client-token` is handled (no onUploadCompleted, so no
 * callback and no middleware exemption). The grant is for ONE path — `surveys/<FS-id>/<fileId>.jpg|.json` of a survey
 * that exists — by content type from the id: a JPEG of at most 5 MB (photos, markups, sketches) or a JSON strokes
 * document of at most 4 MB (`k_`). The finalize action (`finalizeSurveyFile`) re-reads the real bytes before the file
 * is recorded, so a lying content type buys nothing.
 */

class UploadRefused extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
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
        if (!can("create", u.roles)) throw new UploadRefused(403, "You don't have permission to add photos.");
        let fileId = "";
        try {
          const parsed = JSON.parse(clientPayload ?? "") as { fileId?: unknown };
          if (typeof parsed.fileId === "string") fileId = parsed.fileId;
        } catch {
          /* falls through to the refusal below */
        }
        if (!FILE_ID_RE.test(fileId)) throw new UploadRefused(400, "clientPayload must be {fileId}");
        if (!/^FS-\d+$/.test(id) || !(await getSurvey(id))) throw new UploadRefused(404, "That survey no longer exists.");
        if (!filePathMatches(pathname, id, fileId) || pathname !== fileBlobPath(id, fileId)) {
          throw new UploadRefused(400, "That file path isn't allowed for this survey.");
        }
        const json = fileContentType(fileId) === "application/json";
        return {
          allowedContentTypes: json ? ["application/json"] : ["image/jpeg"],
          maximumSizeInBytes: json ? UPLOAD_CAPS.json : UPLOAD_CAPS.jpeg,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ surveyId: id, fileId }),
        };
      },
    });
    return NextResponse.json(json);
  } catch (e) {
    if (e instanceof UploadRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    // Anything else (a BlobError, a network failure inside handleUpload) is never shown to the browser.
    return NextResponse.json({ error: "Upload could not be authorized." }, { status: 400 });
  }
}
