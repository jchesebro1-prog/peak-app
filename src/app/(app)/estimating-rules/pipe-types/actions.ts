"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { deletePipeType, savePipeType } from "@/lib/stores/rigging-types";

/** Estimating Rules → Pipe types (#373). Admin only; the store re-sanitizes and re-checks Active against the live catalog. */
export async function savePipeTypeAction(input: unknown): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requirePerm("manage_users");
  const r = await savePipeType(input, user.name);
  if (!r.ok) return r;
  revalidatePath("/estimating-rules/pipe-types");
  return { ok: true, id: r.type.id };
}

export async function deletePipeTypeAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  if (!(await deletePipeType(String(id ?? "")))) return { ok: false, error: "This type no longer exists." };
  revalidatePath("/estimating-rules/pipe-types");
  return { ok: true };
}
