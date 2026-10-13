"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { runAiPass } from "@/lib/inbox-org/ai-pass";
import { isOrgPilot, loadOrgContext } from "@/lib/inbox-org/pipeline";

/** #335 Inbox organization — run the time-boxed AI pass over my own
 *  pendingAi threads now (the Organize view's "Sync now"-style button).
 *  Pilot only; suggestions and promise-tasks only — nothing is sent. */
export async function runAiPassAction(): Promise<
  { ok: true; looked: number; filed: number; courts: number; tasks: number; more: boolean } | { ok: false; error: string }
> {
  const me = await requireUser();
  const ctx = await loadOrgContext();
  if (!isOrgPilot(me.id, "file", ctx) && !isOrgPilot(me.id, "promise", ctx)) return { ok: false, error: "Assist isn't enabled for you." };
  // leases make it safe beside a sync pass running for the same threads
  const r = await runAiPass({ ownerIds: [me.id] }, { ctx });
  if (r.changed) revalidatePath("/inbox");
  return { ok: true, looked: r.looked, filed: r.filed, courts: r.courts, tasks: r.tasks, more: r.stoppedByBudget };
}
