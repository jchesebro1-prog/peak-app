"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { deleteLinesetType, saveLinesetType } from "@/lib/stores/rigging-types";

/** Estimating Rules → Lineset types (#373). Admin only; the store re-sanitizes and re-checks Active. */
export async function saveLinesetTypeAction(input: unknown): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requirePerm("manage_users");
  const r = await saveLinesetType(input, user.name);
  if (!r.ok) return r;
  revalidatePath("/estimating-rules/lineset-types");
  return { ok: true, id: r.type.id };
}

export async function deleteLinesetTypeAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  if (!(await deleteLinesetType(String(id ?? "")))) return { ok: false, error: "This type no longer exists." };
  revalidatePath("/estimating-rules/lineset-types");
  return { ok: true };
}
