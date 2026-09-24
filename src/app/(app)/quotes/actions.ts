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
import { createQuoteClientPackage } from "@/lib/client-package-server";

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
  // setStatus is the single atomic quote-transition seam. It performs the
  // type-specific spawn inside the same transaction, so no caller can forget
  // downstream work or leave a won quote half-materialized.
  revalidatePath("/", "layout");
}

/** One-click quote-originated client package (#40): the quote need not be a
 * won project before its equipment/spec package can be prepared. */
export async function createQuoteClientPackageAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  if (!id) return;
  const quote = await get(id);
  if (!quote) return;
  try {
    const result = await createQuoteClientPackage(quote, user.name);
    redirect(`/api/client-packages/${encodeURIComponent(result.record.id)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not build the client package.";
    redirect(`/quotes?id=${encodeURIComponent(id)}&packageError=${encodeURIComponent(message)}`);
  }
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
