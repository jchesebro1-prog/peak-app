"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import {
  get,
  setStatus,
  submitForReview,
  addQuoteRevision,
  restoreQuoteRevision,
  remove as removeQuote,
  statusFailureMessage,
  STAGES,
  type QuoteStatus,
} from "@/lib/stores/quotes";
import { createQuoteClientPackage } from "@/lib/client-package-server";
import { scheduleQuotePdf } from "@/lib/quote-pdf/schedule";
import { isStaleAutoApproval } from "@/lib/review-limits";
import { loadReviewLimitContext } from "@/lib/review-limits-server";

/**
 * The Quotes hub's form actions (quotes/page.tsx + controls.tsx): status
 * buttons (setQuoteStatus), submit for review, the client package, and
 * revision save/restore. FormData-shaped so the forms work without client
 * JS; malformed input is a silent no-op, and a status the approval gate
 * refuses redirects back with `statusError`. Daylite stage moves are not
 * here — they live in estimator/actions (setQuoteStageAction /
 * setQuotePipelineAction), next to the stage bar that calls them.
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
  //
  // #174: the gate is not the only thing that throws down there — a defect in
  // the spawn graph does too, and this used to show the user its raw message
  // as though the business had refused them. statusFailureMessage() is the
  // single shared branch: the gate's sentence verbatim, anything else logged
  // and shown as the generic line.
  let q: Awaited<ReturnType<typeof setStatus>>;
  try {
    // The actor is passed through so the automatic on-send revision is
    // attributed to whoever sent it (item 24).
    q = await setStatus(id, status as QuoteStatus, user.name);
  } catch (e) {
    const msg = statusFailureMessage(e, "quotes/actions setQuoteStatus: setStatus threw");
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
 * whose numbers are already baked into a project, and on lost quotes (#282:
 * out of the Rewards program).
 */
export async function restoreQuoteRevisionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  const rev = Number(formData.get("rev") || 0);
  if (!id || !Number.isFinite(rev) || rev < 1) return;
  // #282 phase 3: the recalled Rewards credit is re-clamped like a save —
  // `create` is needed to grow it.
  const res = await restoreQuoteRevision(id, rev, user.name, { mayApplyCredit: can("create", user.roles) });
  // #222 fix wave 1: a recall puts an earlier document back on the quote.
  if (res.ok) await scheduleQuotePdf(id);
  revalidatePath("/", "layout");
  // #282 phase 3: say so when the recalled credit was reduced or removed.
  if (res.ok && res.creditNotice) {
    const back = String(formData.get("back") || "/quotes");
    const safe = back.startsWith("/quotes") ? back : "/quotes";
    redirect(safe + (safe.includes("?") ? "&" : "?") + "creditNotice=" + encodeURIComponent(res.creditNotice));
  }
}

export async function submitQuoteForReview(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  const reviewer = String(formData.get("reviewer") || "queue");
  const q = id ? await get(id) : null;
  if (!q) return;
  // Server-side mirror of the Estimator's rbCanSubmit gate: owner only,
  // from draft, when not already in review / approved. #242 final: an auto
  // approval that no longer holds is not an approval — it may be submitted,
  // from draft or from sent (so a stale sent quote can still reach Won).
  if (q.owner !== user.name) return;
  const state = q.review?.state || "none";
  const staleAuto = state === "approved" && q.review?.method === "auto_limit" && isStaleAutoApproval(q, await loadReviewLimitContext());
  if (q.status !== "draft" && !(staleAuto && q.status === "sent")) return;
  if (state !== "none" && state !== "changes" && !staleAuto) return;
  await submitForReview(id, {
    by: user.name,
    reviewer: reviewer !== "queue" ? reviewer : null,
  });
  revalidatePath("/", "layout");
}

/**
 * Delete a quote (any type/status). Soft delete only. A WON quote's spawned
 * project/jobs are NOT touched — those are independent records once
 * created, and the quote-sweeps (e.g. syncEngagementsFromQuotes) only ever
 * scan the live (non-deleted) quotes list, so removing a quote here can't
 * cause a healing sweep to re-spawn or recreate anything for it.
 */
export async function deleteQuoteAction(id: string) {
  const user = await requireUser();
  await removeQuote(id, user.name);
  revalidatePath("/", "layout");
  return { ok: true as const };
}
