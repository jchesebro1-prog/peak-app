"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  STAGES,
  create as createQuote,
  remove as removeQuote,
  setStatus as setQuoteStatus,
  update as updateQuote,
  type Quote,
  type QuoteStatus,
} from "@/lib/stores/quotes";
import { designToQuotePartial, removeDesign } from "@/lib/stores/designs";

/**
 * Home dashboard mutations — port of Home.dc.html's Component methods
 * (setStatus / removeQuote / promoteDesign) onto server actions.
 */

/** `requote` lives on the quote doc (prototype QuoteStore.update({requote:true})). */
type QuotePatch = Partial<Quote> & { requote?: boolean };

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
export async function promoteDesignAction(
  designId: string
): Promise<{ ok: true; id: string } | { ok: false }> {
  const user = await requireUser();
  const partial = await designToQuotePartial(designId);
  if (!partial) return { ok: false };
  const q = await createQuote({ ...partial, owner: user.name });
  if (partial.requote) {
    const patch: QuotePatch = { requote: true };
    await updateQuote(q.id, patch);
  }
  await removeDesign(designId);
  revalidatePath("/", "layout");
  return { ok: true, id: q.id };
}
