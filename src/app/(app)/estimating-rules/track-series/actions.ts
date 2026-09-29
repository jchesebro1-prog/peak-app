"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { deleteTrackSeries, saveTrackSeries } from "@/lib/stores/track-series";

/**
 * Estimating Rules → Track series mutations (#274 §1). Admin (manage_users)
 * only, like every other Estimating Rules action. saveTrackSeries
 * re-sanitizes whatever the client posts and re-runs the Active check against
 * the live catalog, so the client's own check is a convenience, never the gate.
 */

export async function saveTrackSeriesAction(input: unknown): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requirePerm("manage_users");
  const r = await saveTrackSeries(input, user.name);
  if (!r.ok) return r;
  revalidatePath("/estimating-rules/track-series");
  return { ok: true, id: r.series.id };
}

export async function deleteTrackSeriesAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  if (!(await deleteTrackSeries(String(id ?? "")))) return { ok: false, error: "This series no longer exists." };
  revalidatePath("/estimating-rules/track-series");
  return { ok: true };
}
