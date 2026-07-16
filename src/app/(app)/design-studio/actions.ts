"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { nameFor } from "@/lib/stores/customers";
import { saveDesign, removeDesign, type StudioDesignKind } from "@/lib/stores/studio-designs";

/**
 * Design Studio save actions (IDEAS — save per venue). Any signed-in team
 * member can save/reopen a design; the design carries its tool state + an
 * optional customer link.
 */

export async function saveDesignAction(input: {
  id?: string | null;
  name: string;
  kind: StudioDesignKind;
  customerId: string | null;
  data: unknown;
}): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!input.name?.trim()) return { ok: false, error: "Give the design a name." };
  const customer = input.customerId ? await nameFor(input.customerId) : "";
  const d = await saveDesign({
    id: input.id ?? null,
    name: input.name,
    kind: input.kind,
    customerId: input.customerId,
    customer,
    data: input.data,
    by: user.name,
  });
  revalidatePath("/design-studio");
  return { ok: true, id: d.id, name: d.name };
}

export async function deleteDesignAction(id: string): Promise<{ ok: true }> {
  await requireUser();
  await removeDesign(String(id || ""));
  revalidatePath("/design-studio");
  return { ok: true };
}
