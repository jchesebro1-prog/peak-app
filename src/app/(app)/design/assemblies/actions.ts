"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { setSettings } from "@/lib/settings";
import { sanitizeFixtureAssemblies, type FixtureAssembly } from "@/lib/fixture-assemblies";
import { ASSEMBLY_REF_PREFIX, assemblyRef, fixtureAssemblyPairs } from "@/lib/part-docs/assembly-graph";
import { setOwnDatasheet, syncAccessoryScopes } from "@/lib/stores/part-accessory-links";

export async function saveFixtureAssembliesAction(value: FixtureAssembly[]) {
  await requireUser();
  const fixtureAssemblies = sanitizeFixtureAssemblies(value);
  await setSettings({ fixtureAssemblies });
  // Part documents (#DOC): each assembly's members become the fixture's
  // accessory links; an assembly deleted from the list takes its links with it.
  await syncAccessoryScopes(
    "assembly",
    ASSEMBLY_REF_PREFIX,
    fixtureAssemblies.map((a) => ({ sourceRef: assemblyRef(a.id), pairs: fixtureAssemblyPairs(a) }))
  );
  revalidatePath("/design/assemblies");
  revalidatePath("/estimator");
  revalidatePath("/catalog/documents");
  return { ok: true as const, fixtureAssemblies };
}

/** The member's "has its own datasheet" toggle (#DOC, spec §3/§4): the pair
 *  stops (or resumes) counting the fixture's datasheet as the member's. */
export async function setOwnDatasheetAction(parentSku: string, accessorySku: string, own: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  const changed = await setOwnDatasheet(String(parentSku || ""), String(accessorySku || ""), !!own);
  if (!changed) return { ok: false, error: "Save the assembly first — this part isn't linked to the fixture yet." };
  revalidatePath("/design/assemblies");
  revalidatePath("/catalog/documents");
  return { ok: true };
}
