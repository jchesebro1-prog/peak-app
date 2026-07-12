"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import {
  GROUPS,
  setValue,
  resetAll,
  exportCSV,
  exportJSON,
  exportFileName,
  type PricingEntry,
} from "@/lib/stores/pricing";

/**
 * Estimating Rules mutations — the pricing registry editor.
 * All gated on manage_users (Admin), mirroring the prototype's admin-only
 * screen but enforced server-side. Invalid input is a silent no-op; the store
 * clamps every value to its own min/max, so the UI only ever renders and
 * submits legal edits.
 */

function findRate(id: string): PricingEntry | null {
  for (const g of GROUPS) for (const it of g.items) if (it.id === id) return it;
  return null;
}

export async function setValueAction(id: string, val: number) {
  await requirePerm("manage_users");
  if (typeof val !== "number" || !Number.isFinite(val)) {
    return { ok: false as const };
  }
  await setValue(id, val);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Reset a single rate to its documented default (prototype: setValue(id, def)). */
export async function resetItemAction(id: string) {
  await requirePerm("manage_users");
  const it = findRate(id);
  if (!it || it.kind !== "rate") return { ok: false as const };
  await setValue(it, it.def);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function resetAllAction() {
  await requirePerm("manage_users");
  await resetAll();
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function exportCsvAction() {
  await requirePerm("manage_users");
  return { csv: await exportCSV(), name: exportFileName("csv") };
}

export async function exportJsonAction() {
  await requirePerm("manage_users");
  return { json: await exportJSON(), name: exportFileName("json") };
}
