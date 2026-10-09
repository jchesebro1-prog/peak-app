// SERVER ONLY.
/**
 * #318 — record a sheet the browser uploaded straight to Blob (the
 * Plans & risers order, package-files-server.ts): path scope → never a path a
 * sheet already holds → the head Blob really holds (size ≤ 25 MB, sniffed
 * type) → addSheet. The client's `blobPath` is untrusted throughout; a
 * refusal deletes the unrecorded blob. A plan-view upload (`position:
 * "first"`) runs under the design's plan lock with its upload id, so a retry
 * of one that landed returns that sheet (#314's rule). `deps` exists for the
 * spec harness.
 */
import { deleteBlob, getBlobHead } from "@/lib/blob";
import { listDocsByField } from "@/db/doc-store";
import { displayFileName, isUploadKey } from "@/lib/document-files";
import { addSheet, getProject, recordIntakePlan, type GridSheet } from "@/lib/stores/grid-projects";
import { withPlanLock } from "@/lib/design/grid-plan-intake-server";
import { attachedPlanSheet, isPlanUploadId, planSourceKey } from "@/lib/design/grid-plan-intake";
import { GRID_SHEET_DIRECT_MAX_BYTES, GRID_SHEET_SNIFF_BYTES, GRID_SHEET_UPLOAD_COPY as COPY, gridSheetPathInScope, sniffSheetFile } from "./grid-sheet-upload";

type CommitDeps = {
  head: (pathname: string, max: number) => Promise<{ bytes: Uint8Array; size: number } | null>;
  remove: (pathname: string) => Promise<void>;
};
const liveDeps: CommitDeps = { head: getBlobHead, remove: deleteBlob };

export type CommitSheetResult = { ok: true; sheetId: string; already?: true } | { ok: false; error: string };

export async function commitSheetUpload(projectId: string, input: unknown, by: string, deps: Partial<CommitDeps> = {}): Promise<CommitSheetResult> {
  const d: CommitDeps = { ...liveDeps, ...deps };
  const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const project = await getProject(String(projectId || ""));
  if (!project) return { ok: false, error: COPY.gone };
  const uploadKey = inp.uploadKey;
  if (!isUploadKey(uploadKey) || !gridSheetPathInScope(inp.blobPath, project.id, uploadKey)) return { ok: false, error: COPY.notThisDesign };
  const blobPath = inp.blobPath;
  const first = inp.position === "first";
  if (first && !isPlanUploadId(inp.planUploadId)) return { ok: false, error: COPY.badUploadId };
  const name = displayFileName(inp.name).slice(0, 120) || "Plan sheet";
  const source = first ? planSourceKey("upload", inp.planUploadId as string) : null;
  const run = () => commitLocked(project.id, blobPath, name, by, source, d);
  return source ? withPlanLock(project.id, run) : run();
}

async function referenced(blobPath: string): Promise<boolean> {
  return (await listDocsByField<GridSheet>("grid_sheets", "blobPath", [blobPath])).length > 0;
}

async function commitLocked(projectId: string, blobPath: string, name: string, by: string, source: string | null, d: CommitDeps): Promise<CommitSheetResult> {
  /** Drop this upload's blob unless some sheet already holds that path (a replay names a real file). */
  const dropOrphan = async () => {
    try {
      if (!(await referenced(blobPath))) await d.remove(blobPath);
    } catch {
      /* best effort — the answer stands either way */
    }
  };
  if (source) {
    const now = await getProject(projectId);
    const done = now ? attachedPlanSheet(now.intake, now.sheetIds || [], source) : null;
    if (done) {
      await dropOrphan();
      return { ok: true, sheetId: done, already: true };
    }
  }
  if (await referenced(blobPath)) return { ok: false, error: COPY.alreadySaved };
  const refuse = async (error: string): Promise<CommitSheetResult> => {
    await dropOrphan();
    return { ok: false, error };
  };
  let head: { bytes: Uint8Array; size: number } | null;
  try {
    head = await d.head(blobPath, GRID_SHEET_SNIFF_BYTES);
  } catch {
    return { ok: false, error: COPY.unreadable };
  }
  if (!head) return { ok: false, error: COPY.noArrival };
  if (!(head.size > 0)) return refuse(COPY.empty);
  if (head.size > GRID_SHEET_DIRECT_MAX_BYTES) return refuse(COPY.tooBig);
  const type = sniffSheetFile(head.bytes);
  if (!type) return refuse(COPY.wrongType);
  const sheet = await addSheet(projectId, { name, mime: type, blobPath, by, ...(source ? { first: true } : {}) });
  if (!sheet) return refuse(COPY.gone);
  if (source) await recordIntakePlan(projectId, sheet.id, source);
  return { ok: true, sheetId: sheet.id };
}
