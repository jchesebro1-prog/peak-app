"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { ASSESSMENT_DEF } from "@/lib/assessments/defs";
import type { Depth, ScopeCode } from "@/lib/assessments/defs/types";
import type { ScopeSel } from "@/lib/assessments/evaluate";
import { dateInputToMs } from "@/lib/assessments/editor-model";
import { createAssessment } from "@/lib/stores/assessments";
import type { CreateState } from "../types";

const str = (fd: FormData, k: string): string => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

/** Starts an assessment (online only — the form refuses offline, and /api/sync/push never creates one), then opens
 *  its editor. Refusals come back as `{ error }` for the form to show. */
export async function createAssessmentAction(_prev: CreateState, fd: FormData): Promise<CreateState> {
  const user = await requirePerm("create");
  const visitDate = dateInputToMs(str(fd, "visitDate"));
  if (visitDate === null) return { error: "Enter the visit date" };
  const scopes: ScopeSel[] = ASSESSMENT_DEF.scopes.map((s) => {
    const on = s.code === "S0" || fd.get(`scope_${s.code}`) === "on";
    const depths = s.depths ?? [];
    if (!depths.length) return { code: s.code as ScopeCode, on };
    // Slice 1 allows the screen depth only: "full" (or anything else) is normalised, never stored.
    const d = str(fd, `depth_${s.code}`) as Depth;
    return { code: s.code as ScopeCode, on, depth: d === "screen" && depths.includes(d) ? d : "screen" };
  });
  let id: string;
  try {
    const a = await createAssessment(
      {
        visitType: str(fd, "visitType") || "condition",
        customerId: str(fd, "customerId"),
        siteId: str(fd, "siteId"),
        spaceLabel: str(fd, "spaceLabel") || undefined,
        leadId: str(fd, "leadId") || undefined,
        visitId: str(fd, "visitId") || undefined,
        projectId: str(fd, "projectId") || undefined,
        visitDate,
        assessorId: str(fd, "assessorId") || user.id,
        scopes,
      },
      user.id,
    );
    id = a.id;
  } catch (e) {
    return { error: e instanceof Error && e.message ? e.message : "The assessment couldn't be started" };
  }
  revalidatePath("/assessments");
  redirect(`/assessments/${id}`);
}
