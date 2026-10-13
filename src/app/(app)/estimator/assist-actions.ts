"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { dismissAssistDraft } from "@/lib/stores/quotes";

/** #334 (D877) — hide the "Drafted from an email by Assist" banner on this
 *  estimate. Only flips `assistDraft.dismissedAt`; nothing else changes. */
export async function dismissAssistDraftAction(quoteId: string): Promise<{ ok: boolean }> {
  await requireUser();
  const ok = await dismissAssistDraft(String(quoteId || ""));
  if (ok) revalidatePath("/estimator");
  return { ok };
}
