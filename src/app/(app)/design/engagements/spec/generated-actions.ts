"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { removeGeneratedSpec, setGeneratedSpecPeakHeader } from "@/lib/stores/generated-specs";

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

/** Grid notes #9 — this saved spec's "Include Peak header" (true/false; null
 *  = follow the company default). Same requireUser()-only gate as delete. */
export async function setGeneratedSpecPeakHeaderAction(
  id: string,
  on: boolean | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  if (!id) return { ok: false, error: "Specification not found." };
  const value = typeof on === "boolean" ? on : null;
  try {
    const out = await setGeneratedSpecPeakHeader(String(id), value);
    if (!out) return { ok: false, error: "That specification no longer exists." };
  } catch (error) {
    console.error("setGeneratedSpecPeakHeaderAction: save failed", error);
    return { ok: false, error: "Couldn’t save that — please try again." };
  }
  revalidatePath(`/design/engagements/spec/${id}`);
  return { ok: true };
}
