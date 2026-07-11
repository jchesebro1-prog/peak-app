"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { approve, claimReview, requestChanges } from "@/lib/stores/quotes";
import {
  approveDesign,
  claimDesignReview,
  requestDesignChanges,
} from "@/lib/stores/designs";

/**
 * Review-queue decisions over quotes AND designs (Reviews.dc.html routes
 * each action to QuoteStore or SandboxStore via storeFor(kind)). All three
 * are gated on the approve permission server-side — the prototype's
 * Users.canApprove() UI gate, enforced.
 */

export type ReviewKind = "Quote" | "Design";

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
  if (kind === "Quote") await claimReview(id, user.name);
  else await claimDesignReview(id, user.name);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function approveReviewAction(
  kind: ReviewKind,
  id: string
): Promise<ActionResult> {
  const user = await requireApprover();
  if (!user) return { ok: false, error: "You need review permission to approve." };
  if (kind === "Quote") await approve(id, { by: user.name });
  else await approveDesign(id, { by: user.name });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function requestChangesAction(
  kind: ReviewKind,
  id: string,
  note: string
): Promise<ActionResult> {
  const user = await requireApprover();
  if (!user)
    return { ok: false, error: "You need review permission to request changes." };
  const clean = (note || "").trim();
  if (!clean) return { ok: false, error: "A note is required." };
  if (kind === "Quote") await requestChanges(id, { by: user.name, note: clean });
  else await requestDesignChanges(id, { by: user.name, note: clean });
  revalidatePath("/", "layout");
  return { ok: true };
}
