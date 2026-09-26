"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { setDrawingSet } from "@/lib/stores/grid-projects";
import type { DrawingSetSettings } from "@/lib/design/grid-drawing-set";

/** Save the drawing set's settings on the project (#GDS). Same gate as any
 *  Grid edit; the store cleans every field. */
export async function saveDrawingSetAction(
  projectId: string,
  patch: DrawingSetSettings,
  opts: { resetGeneralNotes?: boolean } = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  const p = await setDrawingSet(projectId, patch, { resetGeneralNotes: Boolean(opts.resetGeneralNotes) });
  if (!p) return { ok: false, error: "Design not found." };
  revalidatePath(`/design/grid/${encodeURIComponent(projectId)}/set`);
  return { ok: true };
}
