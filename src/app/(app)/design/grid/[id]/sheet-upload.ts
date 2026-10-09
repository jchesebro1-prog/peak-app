import { upload } from "@vercel/blob/client";
import { newUploadKey } from "@/lib/document-files";
import { gridSheetBlobPath } from "@/lib/design/grid-sheet-upload";
import { planFileProblem, postSheetMultipart } from "@/lib/design/grid-plan-upload";
import { commitSheetUploadAction } from "./actions";

/**
 * #318 (D692) — the browser half of a plan-sheet upload, for the `+` tab, the
 * intake's plan view and the notice banner's re-upload. With Blob on
 * (`blobUploads`, the page's blobEnabled()): preflight, mint an upload key,
 * send the bytes straight to private Blob through the token broker (≤ 25 MB),
 * then commitSheetUploadAction — which re-checks everything. With Blob off:
 * the 4 MB multipart route. `planUploadId` = the intake's plan view (FIRST
 * position, idempotent per id). Never throws. Client-only.
 */
export type SheetUploadResult = { ok: true; sheetId: string } | { ok: false; error: string };

export async function uploadGridSheet(projectId: string, file: File, opts: { blobUploads: boolean; planUploadId?: string }): Promise<SheetUploadResult> {
  const problem = planFileProblem(file, opts.blobUploads);
  if (problem) return { ok: false, error: problem };
  if (!opts.blobUploads) return postSheetMultipart(projectId, file, opts.planUploadId);
  const uploadKey = newUploadKey();
  let pathname: string;
  try {
    const res = await upload(gridSheetBlobPath(projectId, uploadKey, file.name), file, {
      access: "private",
      handleUploadUrl: "/api/grid-sheets/upload-url",
      clientPayload: JSON.stringify({ uploadKey, projectId }),
      contentType: file.type || "application/octet-stream",
      multipart: file.size > 5 * 1024 * 1024,
    });
    pathname = res.pathname;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return {
      ok: false,
      error: /client token/i.test(msg)
        ? "Upload refused — file storage may not be configured, or your session ended."
        : "That sheet could not be uploaded. Check your connection and try again.",
    };
  }
  try {
    return await commitSheetUploadAction(projectId, {
      blobPath: pathname,
      uploadKey,
      name: file.name,
      ...(opts.planUploadId ? { position: "first" as const, planUploadId: opts.planUploadId } : {}),
    });
  } catch {
    return { ok: false, error: "That sheet could not be saved. Check your connection and try again." };
  }
}
