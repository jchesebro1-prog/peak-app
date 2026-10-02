"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { MAX_SHEET_BYTES, SHEET_TOO_BIG, MAX_SHEET_ROWS, PHOTO_SLOTS, rowsFromGrid, type ImportRow, type PhotoSheetRow } from "@/lib/part-docs/photo-sheet";
import { loadPhotoSheetContext, readSheetFile, writePhotoSheet } from "@/lib/part-docs/photo-sheet-io";
import { runPhotoSheetBatch, type SheetBatchInput, type SheetBatchResult } from "@/lib/part-docs/photo-sheet-import";
import { planPhotoSheet, type DroppedFile, type PhotoSheetPlan } from "@/lib/part-docs/photo-sheet-plan";
import { FETCH_ACTION_BUDGET_MS } from "@/lib/part-docs/types";

/** Catalog → Datasheets → Photo sheet: plan, import batches, results sheet. */

async function readUploadedSheet(form: FormData): Promise<{ ok: true; rows: PhotoSheetRow[] } | { ok: false; error: string }> {
  const file = form.get("sheet");
  if (!(file instanceof File) || !file.size) return { ok: false, error: "Pick the filled photo sheet (.xlsx or .csv)." };
  if (file.size > MAX_SHEET_BYTES) return { ok: false, error: SHEET_TOO_BIG };
  const read = await readSheetFile(Buffer.from(await file.arrayBuffer()), file.name);
  if (!read.ok) return read;
  return rowsFromGrid(read.grid);
}

function cleanDropped(raw: unknown): DroppedFile[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((f) => ({ name: String((f as DroppedFile)?.name ?? "").slice(0, 255), size: Number((f as DroppedFile)?.size) || 0 }))
    .filter((f) => f.name)
    .slice(0, 2000);
}

function cleanRows(raw: unknown): ImportRow[] {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_SHEET_ROWS) : [];
  const s = (v: unknown) => String(v ?? "").slice(0, 2048);
  return list.map((r) => {
    const row = (r ?? {}) as Partial<ImportRow>;
    const photos = Array.isArray(row.photos) ? row.photos : [];
    return { rowNumber: Number(row.rowNumber) || 0, manufacturer: s(row.manufacturer), mfrPart: s(row.mfrPart), sku: s(row.sku), photos: Array.from({ length: PHOTO_SLOTS }, (_, i) => s(photos[i])) };
  });
}

export async function planPhotoSheetAction(form: FormData): Promise<{ ok: true; rows: PhotoSheetRow[]; plan: PhotoSheetPlan; driveReason: string } | { ok: false; error: string }> {
  await requirePerm("create");
  const parsed = await readUploadedSheet(form);
  if (!parsed.ok) return parsed;
  let dropped: DroppedFile[] = [];
  try {
    dropped = cleanDropped(JSON.parse(String(form.get("dropped") ?? "[]")));
  } catch {
    dropped = [];
  }
  const ctx = await loadPhotoSheetContext();
  const plan = planPhotoSheet({ rows: parsed.rows, match: ctx.match, imagesBySku: ctx.imagesBySku, imageByUrl: ctx.imageByUrl, imageByDriveId: ctx.imageByDriveId, removedBySku: ctx.removedBySku, dropped, drive: ctx.drive, driveReason: ctx.driveReason });
  return { ok: true, rows: parsed.rows, plan, driveReason: ctx.driveReason };
}

export async function importPhotoSheetBatchAction(input: SheetBatchInput): Promise<SheetBatchResult> {
  const user = await requirePerm("create");
  const r = await runPhotoSheetBatch(
    { rows: cleanRows(input?.rows), dropped: cleanDropped(input?.dropped), failedKeys: (Array.isArray(input?.failedKeys) ? input.failedKeys : []).map(String).slice(0, 10_000) },
    user.name,
    FETCH_ACTION_BUDGET_MS
  );
  if (r.ok && r.outcomes.some((o) => o.ok)) {
    revalidatePath("/catalog/documents");
    revalidatePath("/catalog");
  }
  return r;
}

/** The uploaded sheet again, Status filled per row — so it can be fixed and re-uploaded. */
export async function photoSheetResultsAction(form: FormData): Promise<{ ok: true; base64: string; fileName: string } | { ok: false; error: string }> {
  await requirePerm("create");
  const parsed = await readUploadedSheet(form);
  if (!parsed.ok) return parsed;
  let statuses = new Map<number, string>();
  try {
    const raw = JSON.parse(String(form.get("statuses") ?? "[]"));
    if (Array.isArray(raw)) statuses = new Map(raw.map((e) => [Number(e?.[0]) || 0, String(e?.[1] ?? "").slice(0, 2000)] as [number, string]));
  } catch {
    /* no statuses — the sheet comes back as uploaded */
  }
  const buf = await writePhotoSheet(parsed.rows, statuses);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  return { ok: true, base64: buf.toString("base64"), fileName: `Peak photo sheet results ${day}.xlsx` };
}
