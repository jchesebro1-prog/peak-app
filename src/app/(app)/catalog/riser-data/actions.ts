"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { buildRiserPreview, MAX_RISER_SHEET_BYTES, RISER_SHEET_TOO_BIG, type RiserPreview } from "@/lib/riser-data-preview";
import { applyRiserChanges, planCablesSheet, planRiserSheet, readRiserSheetFile, resolveSheetParts } from "@/lib/riser-data-sheet-server";
import { FETCH_ACTION_BUDGET_MS } from "@/lib/part-docs/types";

/** Catalog → Riser data (#328 A2): preview (no writes) and apply. Admin only. */

async function readUpload(form: FormData) {
  const file = form.get("sheet");
  if (!(file instanceof File) || !file.size) return { ok: false as const, error: "Pick the riser data sheet (.xlsx)." };
  if (file.size > MAX_RISER_SHEET_BYTES) return { ok: false as const, error: RISER_SHEET_TOO_BIG };
  return readRiserSheetFile(Buffer.from(await file.arrayBuffer()), file.name);
}

/** Dry run — reads the uploaded sheet against the live catalog and writes nothing. */
export async function previewRiserDataAction(form: FormData): Promise<{ ok: true; preview: RiserPreview } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  const read = await readUpload(form);
  if (!read.ok) return read;
  const cables = read.cables ? { parse: read.cables, partsBySku: await resolveSheetParts(read.cables) } : undefined;
  return { ok: true, preview: buildRiserPreview(read.parse, await resolveSheetParts(read.parse), cables) };
}

export type ApplyBatch = { ok: true; applied: number; failed: { sku: string; error: string }[]; remaining: number } | { ok: false; error: string };

/**
 * One budgeted batch: the sheet is re-read and re-planned against the live
 * catalog (already-applied parts drop out), so a call is resumable and never
 * trusts the browser's preview. `failedSkus` are parts that failed earlier this
 * run and are skipped. Rows the parse refused write nothing.
 */
export async function applyRiserDataBatchAction(form: FormData): Promise<ApplyBatch> {
  await requirePerm("manage_users");
  const read = await readUpload(form);
  if (!read.ok) return read;
  let skip: string[] = [];
  try {
    const raw = JSON.parse(String(form.get("failedSkus") ?? "[]"));
    if (Array.isArray(raw)) skip = raw.map((s) => String(s).slice(0, 200)).slice(0, 10_000);
  } catch {
    skip = [];
  }
  const plan = await planRiserSheet(read.parse, new Set(skip));
  const cablePlan = await planCablesSheet(read.cables, new Set(skip));
  const out = await applyRiserChanges(plan.changes, FETCH_ACTION_BUDGET_MS, undefined, cablePlan.changes);
  if (out.applied) {
    revalidatePath("/catalog");
    revalidatePath("/catalog/riser-data");
  }
  return { ok: true, ...out };
}
