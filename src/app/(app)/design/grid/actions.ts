"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { getCompany } from "@/lib/identity/companies";
import { createProject, removeProject } from "@/lib/stores/grid-projects";

/**
 * The Grid index actions (D108) — create a system-design project and land
 * straight in its editor; delete soft-removes the project + its sheets.
 */

export async function createProjectAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const name = String(formData.get("name") || "").trim();
  const companyId = String(formData.get("companyId") || "").trim();
  const company = companyId ? await getCompany(companyId) : null;
  const p = await createProject({
    name,
    customer: company?.name || "",
    customerId: company?.id || null,
    by: user.name,
  });
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
