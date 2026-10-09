import { GRID_SHEET_MAX_BYTES, GRID_SHEET_MAX_LABEL, sheetMimeVerdict } from "@/lib/grid-sheet-file";
import { GRID_SHEET_DIRECT_MAX_BYTES, GRID_SHEET_DIRECT_TYPES, GRID_SHEET_UPLOAD_COPY } from "@/lib/design/grid-sheet-upload";

/**
 * #314 — the Grid plan view's browser half, shared by the intake, the editor's
 * `+` tab and the notice banner: the courtesy checks run before uploading (the
 * server re-checks — this is not the rule), and the post to the 4 MB multipart
 * route `/api/grid-sheets/upload`, which is what runs when Blob is off (#318:
 * with Blob on, sheet-upload.ts goes straight to Blob up to 25 MB). A plan-view
 * upload carries an upload id and asks for the FIRST position: the route turns
 * a repeat of an upload that already landed into a no-op. Client-safe.
 */

export function planFileProblem(file: { size: number; type: string }, blobUploads = false): string | null {
  if (file.size === 0) return "That file is empty.";
  if (blobUploads) {
    if (file.size > GRID_SHEET_DIRECT_MAX_BYTES) return GRID_SHEET_UPLOAD_COPY.tooBig;
  } else if (file.size > GRID_SHEET_MAX_BYTES) {
    return `That file is larger than ${GRID_SHEET_MAX_LABEL}. Print the drawing to a smaller PDF (one sheet per file) and try again.`;
  }
  const v = sheetMimeVerdict(file.type || "");
  if (v === "svg") return "SVG plan sheets aren't supported — export the drawing as a PDF or PNG instead.";
  if (v !== "ok") return "PDF or image files only — print DWGs to PDF first.";
  // The Blob path takes five types (the token route enforces them; the commit sniffs the bytes).
  const t = file.type.toLowerCase().split(";")[0].trim();
  if (blobUploads && !(GRID_SHEET_DIRECT_TYPES as readonly string[]).includes(t)) return GRID_SHEET_UPLOAD_COPY.wrongType;
  return null;
}

/** A fresh id per picked file — the same file retried keeps its id. */
export function newPlanUploadId(): string {
  return globalThis.crypto.randomUUID();
}

/** The 4 MB multipart route (no Blob). `uploadId` = a plan-view upload: FIRST position, idempotent. */
export async function postSheetMultipart(projectId: string, file: File, uploadId?: string): Promise<{ ok: true; sheetId: string } | { ok: false; error: string }> {
  const body = new FormData();
  body.append("projectId", projectId);
  body.append("name", file.name);
  if (uploadId) {
    body.append("position", "first");
    body.append("planUploadId", uploadId);
  }
  body.append("file", file);
  try {
    const res = await fetch("/api/grid-sheets/upload", { method: "POST", body });
    const r = (await res.json()) as { ok?: boolean; sheetId?: string; error?: string };
    return r?.ok && r.sheetId ? { ok: true, sheetId: r.sheetId } : { ok: false, error: r?.error || "That plan could not be uploaded." };
  } catch {
    // A dropped connection or a non-JSON reply (a proxy's own 413 page).
    return { ok: false, error: "That plan could not be uploaded. Check your connection and try again." };
  }
}
