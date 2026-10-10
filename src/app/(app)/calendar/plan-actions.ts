"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { handOff, markInProgress, pinBlock, pushDueDate, setTierSize, unpinBlock, type WriteResult } from "@/lib/task-plan/write";

/**
 * Spec 2026-10-09 auto task calendar — the block, popover and At risk panel
 * actions. Each is requireUser() then the write in src/lib/task-plan/write.ts
 * (which validates the untrusted input). Nothing here writes Google Calendar.
 */
const actorOf = (u: { id: string; roles: string[] }) => ({ id: u.id, admin: can("manage_users", u.roles) });

async function finish(run: () => Promise<WriteResult>): Promise<WriteResult> {
  try {
    const r = await run();
    if (r.ok) revalidatePath("/", "layout");
    return r;
  } catch (error) {
    console.error("plan-actions: write failed", error);
    return { ok: false, error: "Couldn’t save that — please try again." };
  }
}

export async function pinBlockAction(input: unknown): Promise<WriteResult> {
  const u = await requireUser();
  return finish(() => pinBlock(input, actorOf(u)));
}

export async function unpinBlockAction(input: unknown): Promise<WriteResult> {
  const u = await requireUser();
  return finish(() => unpinBlock(input, actorOf(u)));
}

export async function pushDueDateAction(input: unknown): Promise<WriteResult> {
  await requireUser();
  return finish(() => pushDueDate(input));
}

export async function handOffAction(input: unknown): Promise<WriteResult> {
  await requireUser();
  return finish(() => handOff(input));
}

export async function setTierSizeAction(input: unknown): Promise<WriteResult> {
  await requireUser();
  return finish(() => setTierSize(input));
}

export async function markInProgressAction(input: unknown): Promise<WriteResult> {
  const u = await requireUser();
  return finish(() => markInProgress(input, actorOf(u)));
}
