"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { saveCurtainMount } from "@/lib/stores/curtain-mounts";

/** Estimating Rules → Curtain mounts (#292 §4.6). Admin (manage_users) only; the store re-sanitizes and re-checks the catalog. */
export async function saveCurtainMountAction(mountTypeId: string, rows: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requirePerm("manage_users");
  const r = await saveCurtainMount(mountTypeId, rows, user.name);
  if (!r.ok) return r;
  revalidatePath("/estimating-rules/curtain-mounts");
  return { ok: true };
}
