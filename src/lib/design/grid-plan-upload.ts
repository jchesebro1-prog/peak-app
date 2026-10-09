import { GRID_SHEET_MAX_BYTES, GRID_SHEET_MAX_LABEL, sheetMimeVerdict } from "@/lib/grid-sheet-file";

/**
 * #314 — the Grid plan view's browser half, shared by the intake and the
 * editor's notice banner: the courtesy checks the editor's own sheet upload
 * runs before posting (the route re-checks — this is not the rule), and the
 * post to the existing `/api/grid-sheets/upload` route asking for the FIRST
 * position. Every attempt carries an upload id: the route turns a repeat of an
 * upload that already landed (its response was lost) into a no-op. Client-safe.
 */

export function planFileProblem(file: File): string | null {
  if (file.size === 0) return "That file is empty.";
  if (file.size > GRID_SHEET_MAX_BYTES) return `That file is larger than ${GRID_SHEET_MAX_LABEL}. Print the drawing to a smaller PDF (one sheet per file) and try again.`;
  const v = sheetMimeVerdict(file.type || "");
  if (v === "svg") return "SVG plan sheets aren't supported — export the drawing as a PDF or PNG instead.";
  if (v !== "ok") return "PDF or image files only — print DWGs to PDF first.";
  return null;
}

/** A fresh id per picked file — the same file retried keeps its id. */
export function newPlanUploadId(): string {
  return globalThis.crypto.randomUUID();
}

export async function uploadPlanFirst(projectId: string, file: File, uploadId: string): Promise<{ ok: true; sheetId: string } | { ok: false; error: string }> {
  const body = new FormData();
  body.append("projectId", projectId);
  body.append("name", file.name);
  body.append("position", "first");
  body.append("planUploadId", uploadId);
  body.append("file", file);
  try {
    const res = await fetch("/api/grid-sheets/upload", { method: "POST", body });
    const r = (await res.json()) as { ok?: boolean; sheetId?: string; error?: string };
    return r?.ok && r.sheetId ? { ok: true, sheetId: r.sheetId } : { ok: false, error: r?.error || "That plan could not be uploaded." };
  } catch {
    return { ok: false, error: "That plan could not be uploaded. Check your connection and try again." };
  }
}
