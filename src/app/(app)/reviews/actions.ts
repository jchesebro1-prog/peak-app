"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { approveQuoteReview, sendBackQuoteReview } from "@/lib/quote-review-ops";
import {
  approveDesign,
  claimDesignReview,
  requestDesignChanges,
} from "@/lib/stores/designs";
import {
  approvePhaseReview,
  claimPhaseReview,
  getEngagement,
  requestPhaseChanges,
} from "@/lib/stores/engagements";
import { freezeApprovalSnapshot } from "@/lib/stores/review-snapshots";

/**
 * Review-queue decisions over quotes AND designs (Reviews.dc.html routes
 * each action to QuoteStore or SandboxStore via storeFor(kind)). All three
 * are gated on the approve permission server-side — the prototype's
 * Users.canApprove() UI gate, enforced.
 */

export type ReviewKind = "Quote" | "Design" | "Engagement";

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
  if (kind === "Quote") return { ok: false, error: "Quotes don't need claiming — approve or send back directly." };
  if (kind === "Engagement") {
    const [engId, phaseId] = id.split(":");
    await claimPhaseReview(engId, phaseId, user.name);
  } else await claimDesignReview(id, user.name);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** `asOf` — a quote row's updatedAt when the page rendered (#284: approve only the version shown). */
export async function approveReviewAction(
  kind: ReviewKind,
  id: string,
  asOf?: number
): Promise<ActionResult> {
  const user = await requireApprover();
  if (!user) return { ok: false, error: "You need review permission to approve." };
  if (kind === "Quote") {
    const r = await approveQuoteReview(id, user, asOf);
    if (!r.ok) return r;
  }
  else if (kind === "Engagement") {
    const [engId, phaseId] = id.split(":");
    // Freeze the artifacts BEFORE flipping state: an approval that cannot
    // record what it approved should not happen at all (D92).
    const eng = await getEngagement(engId);
    const phase = eng?.phases.find((p) => p.id === phaseId);
    if (!eng || !phase) return { ok: false, error: "Phase not found." };
    const snapshotId = await freezeApprovalSnapshot(eng.id, phase, user.name);
    const res = await approvePhaseReview(engId, phaseId, user.name, snapshotId);
    if (!res.ok) return res;
  } else await approveDesign(id, { by: user.name });
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
  if (kind === "Quote") {
    const r = await sendBackQuoteReview(id, user, clean, asOf);
    if (!r.ok) return r;
  }
  else if (kind === "Engagement") {
    const [engId, phaseId] = id.split(":");
    await requestPhaseChanges(engId, phaseId, user.name, clean);
  } else await requestDesignChanges(id, { by: user.name, note: clean });
  revalidatePath("/", "layout");
  return { ok: true };
}
