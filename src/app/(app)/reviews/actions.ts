"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { approveQuoteReview, sendBackQuoteReview } from "@/lib/quote-review-ops";

/**
 * Review-queue decisions over quotes. Gated on the approve permission
 * server-side — the prototype's Users.canApprove() UI gate, enforced.
 * (Design and consulting-phase reviews went with those features; `kind`
 * stays on the actions so the list's calls read the same.)
 */

export type ReviewKind = "Quote";

type ActionResult = { ok: true } | { ok: false; error: string };

async function requireApprover() {
  const user = await requireUser();
  if (!can("approve", user.roles)) return null;
  return user;
}

export async function claimReviewAction(
  kind: ReviewKind,
  id: string
): Promise<ActionResult> {
  const user = await requireApprover();
  if (!user) return { ok: false, error: "You need review permission to claim." };
  // #284: any approver decides an in-review quote directly — there is no claim step.
  void kind;
  void id;
  return { ok: false, error: "Quotes don't need claiming — approve or send back directly." };
}

/** `asOf` — a quote row's updatedAt when the page rendered (#284: approve only the version shown). */
export async function approveReviewAction(
  kind: ReviewKind,
  id: string,
  asOf?: number
): Promise<ActionResult> {
  const user = await requireApprover();
  if (!user) return { ok: false, error: "You need review permission to approve." };
  void kind;
  const r = await approveQuoteReview(id, user, asOf);
  if (!r.ok) return r;
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function requestChangesAction(
  kind: ReviewKind,
  id: string,
  note: string,
  asOf?: number
): Promise<ActionResult> {
  const user = await requireApprover();
  if (!user)
    return { ok: false, error: "You need review permission to request changes." };
  const clean = (note || "").trim();
  if (!clean) return { ok: false, error: "A note is required." };
  void kind;
  const r = await sendBackQuoteReview(id, user, clean, asOf);
  if (!r.ok) return r;
  revalidatePath("/", "layout");
  return { ok: true };
}
