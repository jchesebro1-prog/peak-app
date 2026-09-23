"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { resetLayout, saveLayout } from "@/lib/dashboard/layout-store";
import type { Surface } from "@/lib/dashboard/registry";

/** #43 — layout mutations for the Home and Reports widget hosts. The
 *  client sends the whole id list; the store normalizes (unknown, gated,
 *  duplicate ids dropped) so nothing the client says is trusted. */

const SURFACES: readonly Surface[] = ["home", "reports"];
const pathOf = (s: Surface) => (s === "home" ? "/" : "/reports");

export async function saveLayoutAction(surface: Surface, ids: string[]): Promise<{ ok: boolean }> {
  const me = await requireUser();
  if (!SURFACES.includes(surface) || !Array.isArray(ids)) return { ok: false };
  await saveLayout(me.id, surface, ids.map(String), me.roles);
  revalidatePath(pathOf(surface));
  return { ok: true };
}

export async function resetLayoutAction(surface: Surface): Promise<{ ok: boolean }> {
  const me = await requireUser();
  if (!SURFACES.includes(surface)) return { ok: false };
  await resetLayout(me.id, surface);
  revalidatePath(pathOf(surface));
  return { ok: true };
}
