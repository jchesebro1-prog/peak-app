"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { MAX_RACK_SHEET_BYTES, MAX_RACK_SHEET_ROWS, RACK_SHEET_TOO_BIG, rackSheetRows, type RackImportResult } from "@/lib/rack/part-facts-sheet";
import { applyRackRows } from "@/lib/rack/part-facts-sheet-server";
import { parseCsv } from "@/app/(app)/import/parse";

/** Catalog → Rack data sheet: preview (no writes) and import (additive). */

type SheetResult = { ok: true; results: RackImportResult[] } | { ok: false; error: string };

function readRows(csvText: unknown) {
  const text = typeof csvText === "string" ? csvText.replace(/^﻿/, "") : "";
  if (!text.trim()) return { ok: false as const, error: "Pick the filled rack data sheet (.csv)." };
  if (text.length > MAX_RACK_SHEET_BYTES) return { ok: false as const, error: RACK_SHEET_TOO_BIG };
  const t = parseCsv(text);
  if (!t.ok) return { ok: false as const, error: t.error || "That CSV couldn't be read." };
  const rows = rackSheetRows([t.headers, ...t.rows]);
  if (!rows.ok) return rows;
  if (rows.rows.length > MAX_RACK_SHEET_ROWS) return { ok: false as const, error: RACK_SHEET_TOO_BIG };
  return rows;
}

/** Dry run — reports what Import would do and writes nothing. */
export async function previewRackDataAction(csvText: string): Promise<SheetResult> {
  await requirePerm("create");
  const rows = readRows(csvText);
  if (!rows.ok) return rows;
  return { ok: true, results: await applyRackRows(rows.rows, { dryRun: true }) };
}

/** Writes each changed row through mergeUpsert; blank cells never clear a saved value. */
export async function applyRackDataAction(csvText: string): Promise<SheetResult> {
  await requirePerm("create");
  const rows = readRows(csvText);
  if (!rows.ok) return rows;
  const results = await applyRackRows(rows.rows);
  if (results.some((r) => r.status === "updated")) revalidatePath("/catalog");
  return { ok: true, results };
}
