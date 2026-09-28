"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { portalIndex } from "@/lib/portal-catalog-index";
import { saveDepartments } from "@/lib/stores/portal-departments";
import type { Department } from "@/lib/portal-departments";

/**
 * Catalog → Departments mutations (#251). Admin (manage_users) only, the
 * same permission Catalog → Device types uses for editing.
 */

type Result = { ok: true; value: Department[] } | { ok: false; error: string };

export async function saveDepartmentsAction(input: unknown): Promise<Result> {
  await requirePerm("manage_users");
  const ix = await portalIndex();
  const known = new Set<string>();
  for (const e of ix.entries) known.add(e.category || "—");
  const res = await saveDepartments(input, [...known]);
  if (!res.ok) return res;
  revalidatePath("/catalog/departments");
  revalidatePath("/portal/catalog", "layout");
  return res;
}
