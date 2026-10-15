"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { getSite } from "@/lib/identity/sites";
import { setNextAssessmentAt } from "@/lib/stores/venue-profiles";
import { MIN_NEXT_ASSESSMENT_MS } from "@/lib/assessments/next-assessment-input";

/**
 * Jeff 2026-10-15 #10 — set or clear a venue's next assessment date (the reminder goes to the account rep 30 days
 * before it). `create` permission, like starting an assessment. `at` is epoch ms (noon local of the picked day) or null.
 */
export async function setNextAssessmentAction(siteId: string, at: number | null): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePerm("create");
  if (typeof siteId !== "string" || !siteId || siteId.length > 200) return { ok: false, error: "Missing venue." };
  // #353 review I1: a year before 1900 is a half-typed date, never a real one.
  if (at !== null && !(typeof at === "number" && Number.isFinite(at) && at >= MIN_NEXT_ASSESSMENT_MS && at < 8_640_000_000_000)) return { ok: false, error: "Pick a date (year 1900 or later)." };
  const site = await getSite(siteId);
  if (!site) return { ok: false, error: "That venue could not be found." };
  await setNextAssessmentAt(site.id, site.companyId, at);
  revalidatePath(`/venues/${encodeURIComponent(site.id)}`);
  return { ok: true };
}
