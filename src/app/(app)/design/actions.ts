"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import {
  approveDesign,
  claimDesignReview,
  designToQuotePartial,
  getDesign,
  removeDesign,
  requestDesignChanges,
  submitDesignForReview,
  type DesignRecord,
} from "@/lib/stores/designs";
import { create as createQuote, update as updateQuote, type Quote } from "@/lib/stores/quotes";

/**
 * Design dashboard server actions — promote-to-quote plus the design
 * review/approval workflow (shared with Quick Design's review banner).
 */

/**
 * Promote a budgetary design into the quotes pipeline: toQuotePartial →
 * QuoteStore.create (flagged requote) → remove from the sandbox.
 * Port of Design.dc.html promoteDesign(id).
 */
export async function promoteDesignAction(
  id: string
): Promise<{ ok: true; quoteId: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const partial = await designToQuotePartial(id);
  if (!partial) return { ok: false, error: "Design not found." };
  const q = await createQuote({ ...(partial as unknown as Partial<Quote>), owner: user.name });
  if (partial.requote) await updateQuote(q.id, { requote: true } as unknown as Partial<Quote>);
  await removeDesign(id);
  revalidatePath("/design");
  revalidatePath("/quotes");
  return { ok: true, quoteId: q.id };
}

/* ---- review & approval workflow (sandbox.js parity, session-actored) ---- */

export async function submitDesignReviewAction(
  id: string,
  reviewer: string | null
): Promise<{ ok: true; record: DesignRecord } | { ok: false; error: string }> {
  const user = await requireUser();
  const d = await submitDesignForReview(id, { by: user.name, reviewer: reviewer || null });
  if (!d) return { ok: false, error: "Design not found." };
  revalidatePath("/design");
  return { ok: true, record: d };
}

export async function claimDesignReviewAction(
  id: string
): Promise<{ ok: true; record: DesignRecord } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("approve", user.roles)) return { ok: false, error: "You can't review designs." };
  const d = await claimDesignReview(id, user.name);
  if (!d) return { ok: false, error: "Design not found." };
  revalidatePath("/design");
  return { ok: true, record: d };
}

export async function approveDesignAction(
  id: string
): Promise<{ ok: true; record: DesignRecord } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("approve", user.roles)) return { ok: false, error: "You can't approve designs." };
  const d = await approveDesign(id, { by: user.name });
  if (!d) return { ok: false, error: "Design not found." };
  revalidatePath("/design");
  return { ok: true, record: d };
}

export async function requestDesignChangesAction(
  id: string,
  note: string
): Promise<{ ok: true; record: DesignRecord } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("approve", user.roles)) return { ok: false, error: "You can't review designs." };
  if (!note.trim()) return { ok: false, error: "A note is required." };
  const d = await requestDesignChanges(id, { by: user.name, note: note.trim() });
  if (!d) return { ok: false, error: "Design not found." };
  revalidatePath("/design");
  return { ok: true, record: d };
}

/** Fresh record for client-side refresh after actions. */
export async function getDesignAction(id: string): Promise<DesignRecord | null> {
  await requireUser();
  return getDesign(id);
}
