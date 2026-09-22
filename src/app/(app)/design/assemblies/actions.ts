"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { setSettings } from "@/lib/settings";
import { sanitizeFixtureAssemblies, type FixtureAssembly } from "@/lib/fixture-assemblies";

export async function saveFixtureAssembliesAction(value: FixtureAssembly[]) {
  await requireUser();
  const fixtureAssemblies = sanitizeFixtureAssemblies(value);
  await setSettings({ fixtureAssemblies });
  revalidatePath("/design/assemblies");
  revalidatePath("/estimator");
  return { ok: true as const, fixtureAssemblies };
}
