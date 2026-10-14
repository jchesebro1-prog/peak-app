import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/auth";
import { blobEnabled } from "@/lib/blob";
import { can } from "@/lib/team";
import { photoBlobPath, photoPathInScope } from "@/lib/assessments/photos";
import { getAssessment } from "@/lib/stores/assessments";

// Token minting only — no bytes pass through this function.
export const maxDuration = 30;

/**
 * Vercel Blob client-upload broker for assessment photos (#337), the team-documents route's pattern. Only
 * `blob.generate-client-token` is handled (no onUploadCompleted, so no callback and no middleware exemption).
 * The grant is for ONE path — `assessments/<AS-id>/<photoId>.jpg` of an assessment that exists — a JPEG of at most
 * 5 MB (photos are already shrunk on the device). The finalize action (finalizeAssessmentPhoto) re-reads the real
 * bytes before the photo is recorded, so a lying content type buys nothing.
 */

class UploadRefused extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

const PHOTO_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_PHOTO_UPLOAD_BYTES = 5 * 1024 * 1024;

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
        let photoId = "";
        try {
          const parsed = JSON.parse(clientPayload ?? "") as { photoId?: unknown };
          if (typeof parsed.photoId === "string") photoId = parsed.photoId;
        } catch {
          /* falls through to the refusal below */
        }
        if (!PHOTO_ID_RE.test(photoId)) throw new UploadRefused(400, "clientPayload must be {photoId}");
        if (!(await getAssessment(id))) throw new UploadRefused(404, "That assessment no longer exists.");
        if (!photoPathInScope(pathname, id) || pathname !== photoBlobPath(id, photoId)) {
          throw new UploadRefused(400, "That file path isn't allowed for this assessment.");
        }
        return {
          allowedContentTypes: ["image/jpeg"],
          maximumSizeInBytes: MAX_PHOTO_UPLOAD_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ assessmentId: id, photoId }),
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
