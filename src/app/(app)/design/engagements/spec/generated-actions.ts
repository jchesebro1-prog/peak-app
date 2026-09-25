"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { removeGeneratedSpec } from "@/lib/stores/generated-specs";

/**
 * Delete-only actions for saved bid specs. Kept out of ./actions.ts (owned
 * by the in-flight generator work) — same requireUser()-only gate as every
 * other action in that file.
 */

export async function removeGeneratedSpecAction(
  id: string,
  engagementId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  if (!id) return { ok: false, error: "Nothing to delete." };
  try {
    await removeGeneratedSpec(id);
  } catch (error) {
    console.error("removeGeneratedSpecAction: spec delete failed", error);
    return { ok: false, error: "Couldn’t delete that specification — please try again." };
  }
  revalidatePath(`/design/engagements/spec?id=${engagementId}`);
  revalidatePath(`/design/engagements/spec/${id}`);
  return { ok: true };
}
