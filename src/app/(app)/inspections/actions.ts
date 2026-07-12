"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { create } from "@/lib/stores/inspections";

/**
 * Inspection inbox mutations. `createInspection` mirrors the prototype's
 * "New inspection" button (Inspections.dc.html → Inspection.dc.html?new=1):
 * we spin up a fresh `requested` record owned by the acting user and open its
 * capture editor. FormData-shaped so the button works without client JS.
 */
export async function createInspection(): Promise<void> {
  const user = await requireUser();
  const rec = await create({
    owner: user.name,
    requestedBy: user.name,
    stage: "requested",
  });
  revalidatePath("/", "layout");
  redirect(`/inspections/${encodeURIComponent(rec.id)}`);
}
