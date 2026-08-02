"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  STAGES,
  remove as removeQuote,
  setStatus as setQuoteStatus,
  type QuoteStatus,
} from "@/lib/stores/quotes";
import { promoteDesignToQuote } from "@/lib/stores/designs";

/**
 * Home dashboard mutations — port of Home.dc.html's Component methods
 * (setStatus / removeQuote / promoteDesign) onto server actions.
 */

/** Stage sheet "Move to stage" (prototype setStatus). */
export async function setQuoteStatusAction(id: string, status: string) {
  await requireUser();
  if (!(STAGES as readonly string[]).includes(status)) return;
  await setQuoteStatus(id, status as QuoteStatus);
  revalidatePath("/", "layout");
}

/** Stage sheet "Delete" (prototype removeQuote). */
export async function removeQuoteAction(id: string) {
  await requireUser();
  await removeQuote(id);
  revalidatePath("/", "layout");
}

/**
 * The bridge: promote a budgetary sandbox design into the formal pipeline.
 * Creates a real draft quote flagged for requote, then removes the design
 * from the sandbox (budgetary numbers do not carry forward as final).
 * Port of Home.dc.html promoteDesign().
 */
// Punch #75: shared flow lives in promoteDesignToQuote(); this used to be a near-identical duplicate of the other copy, which is how #65's missing tier stamp happened.
export async function promoteDesignAction(
  designId: string
): Promise<{ ok: true; id: string } | { ok: false }> {
  const user = await requireUser();
  const q = await promoteDesignToQuote(designId, user.name);
  if (!q) return { ok: false };
  revalidatePath("/", "layout");
  return { ok: true, id: q.id };
}
