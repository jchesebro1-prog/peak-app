// SERVER ONLY.
/**
 * #318 — record a sheet the browser uploaded straight to Blob (the
 * Plans & risers order, package-files-server.ts): path scope → never a path a
 * sheet already holds → the head Blob really holds (size ≤ 25 MB, sniffed
 * type) → storeUploadAsSheets. The client's `blobPath` is untrusted
 * throughout; a refusal deletes the unrecorded blob. A plan-view upload
 * (`position: "first"`) runs under the design's plan lock with its upload id,
 * so a retry of one that landed returns that sheet (#314's rule).
 * #319: a multi-page PDF is read back and split into one sheet per page, and
 * the original upload's blob is then deleted — after the plan lock's
 * transaction has committed, and only if no sheet holds it (a replayed commit
 * fails its head read instead of splitting twice); a real plan retires the
 * generated plan.
 * `deps` exists for the spec harness.
 */
import { deleteBlob, getBlobHead } from "@/lib/blob";
import { baseName, cleanText, displayFileName, isUploadKey } from "@/lib/document-files";
import { getProject, recordIntakePlan } from "@/lib/stores/grid-projects";
import { withPlanLock } from "@/lib/design/grid-plan-intake-server";
import { attachedPlanSheet, isPlanUploadId, planSourceKey } from "@/lib/design/grid-plan-intake";
import { GRID_SHEET_DIRECT_MAX_BYTES, GRID_SHEET_SNIFF_BYTES, GRID_SHEET_UPLOAD_COPY as COPY, gridSheetPathInScope, sniffSheetFile } from "./grid-sheet-upload";
import { readBlobCapped } from "./sheet-adjust-server";
import { sheetHoldsBlob, sheetHoldsBlobStrict, storeUploadAsSheets } from "./grid-sheet-split-server";
import type { SheetsLanded } from "./grid-sheet-split";

type CommitDeps = {
  head: (pathname: string, max: number) => Promise<{ bytes: Uint8Array; size: number } | null>;
  remove: (pathname: string) => Promise<void>;
  /** #319: the whole uploaded file, to split a PDF (null = unreadable → one sheet). */
  read: (pathname: string) => Promise<Uint8Array | null>;
  /** Strict "does a sheet hold this path" for the pre-check (a failed lookup throws). */
  held: (pathname: string) => Promise<boolean>;
};
const liveDeps: CommitDeps = { head: getBlobHead, remove: deleteBlob, read: (p) => readBlobCapped(p), held: sheetHoldsBlobStrict };

export type CommitSheetResult = ({ ok: true; already?: true } & SheetsLanded) | { ok: false; error: string };
/** commitLocked's answer: `split` = no sheet holds the original upload any more. */
type LockedResult = ({ ok: true; already?: true; split?: boolean } & SheetsLanded) | { ok: false; error: string };

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
  // displayFileName falls back to "file" for a blank name — check the cleaned
  // base name first so a nameless upload is called "Plan sheet" (#318).
  const name = cleanText(baseName(inp.name), 180) ? displayFileName(inp.name).slice(0, 120) : "Plan sheet";
  const source = first ? planSourceKey("upload", inp.planUploadId as string) : null;
  const run = () => commitLocked(project.id, blobPath, name, by, source, d);
  const out = source ? await withPlanLock(project.id, run) : await run();
  if (!out.ok) return out;
  const { split, ...result } = out;
  // #319: after a split no page holds the original upload. It is dropped only
  // now — once the plan lock's transaction has committed (an abort rolls the
  // pages back, and a retry needs the original) — and only if no sheet holds
  // it (a concurrent double-submit may have recorded it whole).
  if (split) await dropOrphan(blobPath, d);
  return result;
}

/** Drop an upload's blob unless some sheet already holds that path (a replay names a real file). */
async function dropOrphan(blobPath: string, d: CommitDeps): Promise<void> {
  try {
    if (!(await sheetHoldsBlob(blobPath))) await d.remove(blobPath);
  } catch {
    /* best effort — the answer stands either way */
  }
}

async function commitLocked(projectId: string, blobPath: string, name: string, by: string, source: string | null, d: CommitDeps): Promise<LockedResult> {
  if (source) {
    const now = await getProject(projectId);
    const done = now ? attachedPlanSheet(now.intake, now.sheetIds || [], source) : null;
    if (done) {
      await dropOrphan(blobPath, d);
      return { ok: true, sheetId: done, sheetIds: [done], already: true };
    }
  }
  // A failed lookup is not "already saved" (nothing was stored) — say so and let them retry.
  // Deletes (dropOrphan) keep the safe reading: a failed lookup counts as held.
  let held: boolean;
  try {
    held = await d.held(blobPath);
  } catch {
    return { ok: false, error: COPY.unreadable };
  }
  if (held) return { ok: false, error: COPY.alreadySaved };
  const refuse = async (error: string): Promise<LockedResult> => {
    await dropOrphan(blobPath, d);
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
  const landed = await storeUploadAsSheets(
    projectId,
    {
      name,
      mime: type,
      readBytes: () => d.read(blobPath),
      // Not split: the uploaded blob IS the sheet's file (no `url` — provenance only, D692).
      storeWhole: async () => ({ mime: type, dataUrl: "", blobPath }),
    },
    { by, first: !!source, intakeNotices: !!source }
  );
  if (!landed.ok) return refuse(landed.reason === "gone" ? COPY.gone : landed.error);
  if (source) await recordIntakePlan(projectId, landed.sheetIds[0], source);
  return landed;
}
