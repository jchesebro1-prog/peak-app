"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { getCompany } from "@/lib/identity/companies";
import { addSheet, createProject, removeProject, setSheetCalibration } from "@/lib/stores/grid-projects";
import { generatedBaseSheet } from "@/lib/design/grid-base-sheet";
import type { VenueDims } from "@/lib/design/venue-dims";

/**
 * The Grid index actions (D108) — create a system-design project and land
 * straight in its editor; delete soft-removes the project + its sheets.
 */

export async function createProjectAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const name = String(formData.get("name") || "").trim();
  const companyId = String(formData.get("companyId") || "").trim();
  const company = companyId ? await getCompany(companyId) : null;
  const number = (key: string) => Number(formData.get(key));
  const wantsBasePlan = formData.get("createBasePlan") === "on";
  const candidate: VenueDims = {
    proWidthFt: number("proWidthFt"),
    proHeightFt: number("proHeightFt"),
    stageWidthFt: number("stageWidthFt"),
    stageDepthFt: number("stageDepthFt"),
    gridHeightFt: number("gridHeightFt"),
  };
  const venueDims = wantsBasePlan && Object.values(candidate).every((n) => Number.isFinite(n) && n > 0)
    ? candidate
    : undefined;
  const p = await createProject({
    name,
    customer: company?.name || "",
    customerId: company?.id || null,
    by: user.name,
    venueDims,
  });
  if (venueDims) {
    const base = generatedBaseSheet(venueDims);
    const sheet = await addSheet(p.id, {
      name: base.name,
      mime: "image/svg+xml",
      dataUrl: base.dataUrl,
      by: user.name,
    });
    if (sheet) {
      await setSheetCalibration(p.id, {
        docId: sheet.id,
        page: 1,
        // The SVG viewBox is 1,200 units wide and the stage is 1,000 units
        // wide, so one normalized page width spans 120% of the stage width.
        scale: (venueDims.stageWidthFt || venueDims.proWidthFt) * 1.2,
        unit: "ft",
        refLength: venueDims.stageWidthFt || venueDims.proWidthFt,
        by: user.name,
        at: Date.now(),
      });
    }
  }
  revalidatePath("/design/grid");
  redirect(`/design/grid/${encodeURIComponent(p.id)}`);
}

export async function deleteProjectAction(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  await removeProject(id);
  revalidatePath("/design/grid");
  return { ok: true };
}
