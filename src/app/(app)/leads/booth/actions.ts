"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { recordBoothCapture } from "@/lib/booth/capture-server";

/**
 * Booth mode's one write. The whole capture document comes from the device (or the sync engine's replay of it);
 * who captured it is taken from the signed-in user inside `recordBoothCapture`, never from the payload. A refusal
 * (including the "still saving this visitor" busy answer) comes back as `{ ok:false, error }`.
 */
export async function saveBoothCaptureAction(doc: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requirePerm("create");
  const r = await recordBoothCapture(doc, { id: me.id, name: me.name });
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/leads/booth");
  revalidatePath("/leads");
  return { ok: true };
}
