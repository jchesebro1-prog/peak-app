"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { loadPlanContext, runRenameBatch } from "@/lib/catalog-rename/apply";
import { crosswalkRowsFromGrid, planRenames, type CrosswalkRow, type RenamePlan } from "@/lib/catalog-rename/plan";
import { cleanRenameBatchInput, type RenameBatchInput, type RenameBatchResult } from "@/lib/catalog-rename/steps";
import { MAX_SHEET_BYTES, SHEET_TOO_BIG } from "@/lib/part-docs/photo-sheet";
import { readSheetFile } from "@/lib/part-docs/photo-sheet-io";
import { FETCH_ACTION_BUDGET_MS } from "@/lib/part-docs/types";
import { invalidateSystemLibrary } from "@/lib/narrative/system-library-index";
import { invalidatePortalIndex } from "@/lib/portal-catalog-index";

/** #304 Catalog → Model numbers: preview a crosswalk sheet, then apply it in budgeted batches. */

const CROSSWALK_SHEET_NAME = "Crosswalk";

/** Read the uploaded crosswalk and plan it against the live catalog. Writes nothing. */
export async function planModelNumbersAction(form: FormData): Promise<{ ok: true; rows: CrosswalkRow[]; plan: RenamePlan } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  const file = form.get("sheet");
  if (!(file instanceof File) || !file.size) return { ok: false, error: "Pick the filled crosswalk sheet (.xlsx or .csv)." };
  if (file.size > MAX_SHEET_BYTES) return { ok: false, error: SHEET_TOO_BIG };
  const read = await readSheetFile(Buffer.from(await file.arrayBuffer()), file.name, CROSSWALK_SHEET_NAME);
  if (!read.ok) return read;
  const parsed = crosswalkRowsFromGrid(read.grid);
  if (!parsed.ok) return parsed;
  const ctx = await loadPlanContext();
  return { ok: true, rows: parsed.rows, plan: planRenames(parsed.rows, ctx.live, ctx.retired) };
}

/** One batch of the rename. The client's rows are untrusted and its plan is
 *  never used — the engine re-plans from the cleaned rows on the parts step. */
export async function runModelNumbersBatchAction(input: RenameBatchInput): Promise<RenameBatchResult> {
  const user = await requirePerm("manage_users");
  const clean = cleanRenameBatchInput(input);
  if (!clean) return { ok: false, error: "Unknown rename step." };
  const r = await runRenameBatch(clean, user.name, FETCH_ACTION_BUDGET_MS);
  // The portal catalog index and the system library cache parts by SKU: drop
  // them once parts were renamed (and the parts step is through) and again on
  // completion, when every reference has moved.
  const partsDone = clean.step === "parts" && r.ok && r.step !== "parts";
  if (r.ok && (r.renamed > 0 || partsDone || r.complete)) {
    invalidatePortalIndex();
    invalidateSystemLibrary();
  }
  if (r.ok && r.complete) {
    revalidatePath("/catalog");
    revalidatePath("/catalog/model-numbers");
  }
  return r;
}
