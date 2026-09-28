"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { saveDepartments } from "@/lib/stores/portal-departments";
import type { Department } from "@/lib/portal-departments";

/**
 * Catalog → Departments mutations (#252). Admin (manage_users) only, the
 * same permission Catalog → Device types uses for editing. The known-
 * category derivation lives in saveDepartments itself (#252 fix round 1) —
 * this wrapper is just the cookie-reading session check + a save + refresh.
 */

type Result = { ok: true; value: Department[] } | { ok: false; error: string };

export async function saveDepartmentsAction(input: unknown): Promise<Result> {
  await requirePerm("manage_users");
  const res = await saveDepartments(input);
  if (!res.ok) return res;
  revalidatePath("/catalog/departments");
  revalidatePath("/portal/catalog", "layout");
  return res;
}
