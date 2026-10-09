import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { blobEnabled } from "@/lib/blob";
import { getOptionalUser } from "@/lib/session";
import { getProject } from "@/lib/stores/grid-projects";
import {
  GRID_SHEET_DIRECT_MAX_BYTES,
  GRID_SHEET_DIRECT_TYPES,
  GRID_SHEET_UPLOAD_COPY,
  gridSheetPathInScope,
  parseSheetUploadPayload,
} from "@/lib/design/grid-sheet-upload";

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
 * #318 (D692) — Vercel Blob client-upload broker for Grid plan sheets up to
 * 25 MB (the Plans & risers route's pattern, #301). Only
 * `blob.generate-client-token` (no completion callback, so no middleware
 * exemption). The grant is for ONE path: `grid-sheets/<design>/<uploadKey>/…`
 * of an existing design, to a signed-in user (any designer may add a sheet —
 * the legacy route's rule), ≤ 25 MB, private. commitSheetUploadAction
 * re-checks the real bytes before a sheet is recorded. This static segment
 * sits beside the `[id]` proxy; sheet ids are `gs-<hex>`, so they never collide.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!blobEnabled()) return NextResponse.json({ reason: "blob-disabled", error: GRID_SHEET_UPLOAD_COPY.noStorage }, { status: 503 });
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
        const p = parseSheetUploadPayload(clientPayload);
        if (!p) throw new UploadRefused(400, "clientPayload must be {uploadKey, projectId}");
        const project = await getProject(p.projectId);
        if (!project) throw new UploadRefused(404, GRID_SHEET_UPLOAD_COPY.gone);
        if (!gridSheetPathInScope(pathname, project.id, p.uploadKey)) throw new UploadRefused(400, GRID_SHEET_UPLOAD_COPY.notThisDesign);
        return {
          maximumSizeInBytes: GRID_SHEET_DIRECT_MAX_BYTES,
          allowedContentTypes: [...GRID_SHEET_DIRECT_TYPES, "application/octet-stream"],
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ projectId: project.id, uploadKey: p.uploadKey }),
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
