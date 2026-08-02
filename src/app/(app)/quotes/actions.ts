"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  get,
  setStatus,
  submitForReview,
  addQuoteRevision,
  restoreQuoteRevision,
  STAGES,
  type QuoteStatus,
} from "@/lib/stores/quotes";
import { syncFromQuotes } from "@/lib/stores/flame-jobs";
import { syncFromQuotes as syncRepairsFromQuotes } from "@/lib/stores/repair-jobs";
import { syncFromQuotes as syncInspectionsFromQuotes } from "@/lib/stores/inspections";
import { syncProjectsFromQuotes } from "@/lib/stores/projects";
import { syncEngagementsFromQuotes } from "@/lib/stores/engagements";

/**
 * Quote pipeline mutations — the QuoteStore calls the prototype makes from
 * the Estimator's top bar + review banner, surfaced on the Quotes list's
 * expanded row. FormData-shaped so the forms work without client JS; invalid
 * input is a silent no-op (the UI only renders legal actions, mirroring the
 * prototype's gates).
 */

export async function setQuoteStatus(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  const status = String(formData.get("status") || "");
  // Where to send the user back (current list filters + the row still
  // selected) — the forms that call this action embed the page's own
  // computed hrefFor() as a hidden field so a refusal can redirect back to
  // the exact view the user was on, not a bare "/quotes".
  const back = String(formData.get("back") || "/quotes");
  if (!id || !(STAGES as readonly string[]).includes(status)) return;
  // Punch #60 (the actual hole the product owner reproduced): this used to
  // call setStatus() with no gate at all — any signed-in user could push an
  // unapproved quote straight to Won from the plain list buttons, no review
  // required. setStatus() now enforces the approval gate itself and THROWS
  // on refusal; catch it here and send the user back with a clear message
  // instead of letting a raw exception 500 the page.
  let q: Awaited<ReturnType<typeof setStatus>>;
  try {
    // The actor is passed through so the automatic on-send revision is
    // attributed to whoever sent it (item 24).
    q = await setStatus(id, status as QuoteStatus, user.name);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "That status change was refused.";
    redirect(back + (back.includes("?") ? "&" : "?") + "statusError=" + encodeURIComponent(msg));
  }
  if (!q) return;
  if (status === "sent" && q.quoteType === "consulting") {
    // Spec §1 spawn model: SENDING a consulting proposal opens the
    // engagement at Proposal sent — winning later advances it to Awarded.
    // Routed through the sweep (not ensureEngagementForQuote) so the
    // "sent while closed" reopen rule in engagementSyncAction fires
    // immediately on re-send, instead of waiting for the next
    // loadConsultingData safety-net pass. Idempotent either way.
    await syncEngagementsFromQuotes();
  }
  if (status === "lost" && q.quoteType === "consulting") {
    // A proposal lost while still at Proposal sent closes its engagement
    // with a "Proposal lost" decision — the sweep owns that rule.
    await syncEngagementsFromQuotes();
  }
  if (status === "won") {
    // Acceptance auto-spawns downstream work exactly like the prototype:
    // won flame-test quotes become FT jobs, won repair quotes become repair
    // jobs, won inspection quotes become requested inspections, won system
    // quotes become Installs projects, and won consulting quotes ensure /
    // advance ConsultingEngagements (spec §1: proposal_sent → awarded).
    // Each sync filters to its own quoteType and is idempotent, so calling
    // all five is safe.
    await syncFromQuotes();
    await syncRepairsFromQuotes();
    await syncInspectionsFromQuotes();
    await syncProjectsFromQuotes();
    await syncEngagementsFromQuotes();
  }
  revalidatePath("/", "layout");
}

/* ---- revisions (punch item 24) ---- */

/** Snapshot the quote as it stands right now. */
export async function saveQuoteRevisionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  const note = String(formData.get("note") || "").trim();
  if (!id) return;
  await addQuoteRevision(id, { by: user.name, reason: "manual", note });
  revalidatePath("/", "layout");
}

/**
 * Recall an earlier revision. The store snapshots the current state before
 * applying, so this never discards work; it refuses outright on won quotes,
 * whose numbers are already baked into a project.
 */
export async function restoreQuoteRevisionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  const rev = Number(formData.get("rev") || 0);
  if (!id || !Number.isFinite(rev) || rev < 1) return;
  await restoreQuoteRevision(id, rev, user.name);
  revalidatePath("/", "layout");
}

export async function submitQuoteForReview(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  const reviewer = String(formData.get("reviewer") || "queue");
  const q = id ? await get(id) : null;
  if (!q) return;
  // Server-side mirror of the Estimator's rbCanSubmit gate: owner only,
  // from draft, when not already in review / approved.
  if (q.owner !== user.name) return;
  if (q.status !== "draft") return;
  const state = q.review?.state || "none";
  if (state !== "none" && state !== "changes") return;
  await submitForReview(id, {
    by: user.name,
    reviewer: reviewer !== "queue" ? reviewer : null,
  });
  revalidatePath("/", "layout");
}
