"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { rebuildBrief, type RebuildResult } from "@/lib/brief/build";

/**
 * AI daily brief — Home's Rebuild button (spec §1 "Lazy and rebuild paths"):
 * the signed-in user's current-slot brief, rebuilt and stored over the old
 * one (builtBy "rebuild"). Pilot + Daily brief only; 3 per hour per user.
 */
export async function rebuildBriefAction(): Promise<RebuildResult> {
  const user = await requireUser();
  const r = await rebuildBrief(user);
  if (r.ok) revalidatePath("/");
  return r;
}
