// SERVER ONLY — reads sheet files, runs pdf-lib / sharp, writes Blob.
/**
 * #318 — Adjust sheet, end to end: check the gate, read the ROOT sheet's file
 * (Blob or data-URL), transform it (sheet-adjust-bytes), store the result
 * (private Blob, or a data-URL when Blob is off and it fits), then swap the
 * new sheet in for the old one (grid-projects.replaceSheetWithAdjusted, which
 * re-checks the gate on the doc it patches). A refusal after a Blob write
 * deletes that blob again. "Reset everything" (an empty spec) writes no bytes:
 * the new sheet points at the root's own file.
 */
import { getDoc } from "@/db/doc-store";
import { blobEnabled, deleteBlob, getBlobStream, putBlob, safeName } from "@/lib/blob";
import { decodeDataUrl, GRID_SHEET_BLOB_PREFIX } from "@/lib/grid-sheet-file";
import { getProject, replaceSheetWithAdjusted, type GridSheet } from "@/lib/stores/grid-projects";
import { adjustSheetBytes } from "./sheet-adjust-bytes";
import { blockedPages, changedPages, isBaseSheet, sanitizeAdjustPages, type AdjustRefusal } from "./sheet-adjust";

/** Largest root file read back (the 25 MB upload cap, with room). */
export const SHEET_ADJUST_READ_MAX_BYTES = 30 * 1024 * 1024;
/** Largest adjusted file stored in-database when Blob is off (local dev): the
 *  4 MB upload cap plus room for pdf-lib's re-save growing a file. */
export const SHEET_ADJUST_DATAURL_MAX_BYTES = 6 * 1024 * 1024;

export type AdjustSheetResult = { ok: true; sheetId: string; unchanged?: true } | { ok: false; reason: AdjustRefusal; pages?: number[] };
type StoredFile = { mime: string; dataUrl: string; url?: string; blobPath?: string };

export async function adjustSheet(projectId: string, sheetId: string, rawPages: unknown, by: string): Promise<AdjustSheetResult> {
  const project = await getProject(projectId);
  if (!project) return { ok: false, reason: "not-found" };
  if (!(project.sheetIds || []).includes(sheetId)) return { ok: false, reason: "no-such-sheet" };
  const cur = await getDoc<GridSheet>("grid_sheets", sheetId);
  if (!cur) return { ok: false, reason: "no-such-sheet" };
  if (isBaseSheet(cur, project.intake)) return { ok: false, reason: "base-sheet" };
  const next = sanitizeAdjustPages(rawPages);
  const changed = changedPages(sanitizeAdjustPages(cur.adjust?.pages), next);
  if (!changed.length) return { ok: true, sheetId: cur.id, unchanged: true };
  const blocked = blockedPages(project, cur.id, changed);
  if (blocked.length) return { ok: false, reason: "in-use", pages: blocked };
  const rootId = cur.adjust?.fromSheetId || cur.id;
  const root = rootId === cur.id ? cur : await getDoc<GridSheet>("grid_sheets", rootId);
  if (!root) return { ok: false, reason: "unreadable" };

  let file: StoredFile;
  let wrote: string | null = null;
  if (!Object.keys(next).length) {
    file = { mime: root.mime, dataUrl: root.dataUrl || "", ...(root.url ? { url: root.url } : {}), ...(root.blobPath ? { blobPath: root.blobPath } : {}) };
  } else {
    const bytes = await readSheetBytes(root);
    if (!bytes) return { ok: false, reason: "unreadable" };
    const out = await adjustSheetBytes(bytes, next);
    if (!out.ok) return { ok: false, reason: out.reason };
    const put = await storeSheetFile(projectId, cur.name, out.bytes, out.mime);
    if (!put.ok) return { ok: false, reason: put.reason };
    file = put.file;
    wrote = put.file.blobPath ?? null;
  }
  const r = await replaceSheetWithAdjusted(projectId, cur.id, { name: cur.name, ...file, adjust: { fromSheetId: rootId, pages: next }, by }, changed);
  if (!r.ok) {
    if (wrote) await deleteBlob(wrote).catch(() => {});
    return { ok: false, reason: r.reason, ...(r.pages ? { pages: r.pages } : {}) };
  }
  return { ok: true, sheetId: r.sheet.id };
}

/** The whole root file — a local reader, not rack/submittal-server's readCapped, so the
 *  Grid editor's actions don't pull the rack submittal's import graph. */
async function readSheetBytes(sheet: GridSheet): Promise<Uint8Array | null> {
  if (!sheet.blobPath) return decodeDataUrl(sheet.dataUrl)?.bytes ?? null;
  try {
    const stream = await getBlobStream(sheet.blobPath);
    if (!stream) return null;
    const reader = (stream as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > SHEET_ADJUST_READ_MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    return new Uint8Array(Buffer.concat(chunks));
  } catch {
    return null;
  }
}

async function storeSheetFile(projectId: string, name: string, bytes: Uint8Array, mime: string): Promise<{ ok: true; file: StoredFile } | { ok: false; reason: "too-big" | "failed" }> {
  if (blobEnabled()) {
    try {
      const up = await putBlob(`${GRID_SHEET_BLOB_PREFIX}${projectId}/${safeName(name)}`, Buffer.from(bytes), mime);
      return { ok: true, file: { mime, dataUrl: "", url: up.url, blobPath: up.pathname } };
    } catch (e) {
      console.error("[grid] adjusted sheet upload failed:", e);
      return { ok: false, reason: "failed" };
    }
  }
  if (bytes.byteLength > SHEET_ADJUST_DATAURL_MAX_BYTES) return { ok: false, reason: "too-big" };
  return { ok: true, file: { mime, dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` } };
}
