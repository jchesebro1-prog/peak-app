"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { getSettings, setSettings } from "@/lib/settings";
import { list as catalogList } from "@/lib/stores/catalog";
import { sanitizeFixtureAssemblies, type FixtureAssembly } from "@/lib/fixture-assemblies";

export async function saveFixtureAssembliesAction(value: FixtureAssembly[]) {
  await requireUser();
  const fixtureAssemblies = sanitizeFixtureAssemblies(value);
  await setSettings({ fixtureAssemblies });
  revalidatePath("/design/assemblies");
  revalidatePath("/estimator");
  return { ok: true as const, fixtureAssemblies };
}

export async function searchAssemblyCatalogAction(query: string) {
  await requireUser();
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return (await catalogList())
    .filter((part) => [part.sku, part.desc, part.mfr, part.category].some((value) => String(value || "").toLowerCase().includes(q)))
    .sort((a, b) => a.desc.localeCompare(b.desc))
    .slice(0, 20)
    .map((part) => ({ sku: part.sku, desc: part.desc, category: part.category, cost: part.cost, list: part.list }));
}
