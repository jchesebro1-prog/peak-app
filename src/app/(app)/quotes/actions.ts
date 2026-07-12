"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  get,
  setStatus,
  submitForReview,
  STAGES,
  type QuoteStatus,
} from "@/lib/stores/quotes";
import { syncFromQuotes } from "@/lib/stores/flame-jobs";
import { syncFromQuotes as syncRepairsFromQuotes } from "@/lib/stores/repair-jobs";
import { syncFromQuotes as syncInspectionsFromQuotes } from "@/lib/stores/inspections";
import { syncProjectsFromQuotes } from "@/lib/stores/projects";

/**
 * Quote pipeline mutations — the QuoteStore calls the prototype makes from
 * the Estimator's top bar + review banner, surfaced on the Quotes list's
 * expanded row. FormData-shaped so the forms work without client JS; invalid
 * input is a silent no-op (the UI only renders legal actions, mirroring the
 * prototype's gates).
 */

export async function setQuoteStatus(formData: FormData): Promise<void> {
  await requireUser();
  const id = String(formData.get("id") || "");
  const status = String(formData.get("status") || "");
  if (!id || !(STAGES as readonly string[]).includes(status)) return;
  const q = await setStatus(id, status as QuoteStatus);
  if (!q) return;
  if (status === "won") {
    // Acceptance auto-spawns downstream work exactly like the prototype:
    // won flame-test quotes become FT jobs, won repair quotes become repair
    // jobs, won inspection quotes become requested inspections, won system
    // quotes become Installs projects. Each sync filters to its own
    // quoteType and is idempotent, so calling all four is safe.
    await syncFromQuotes();
    await syncRepairsFromQuotes();
    await syncInspectionsFromQuotes();
    await syncProjectsFromQuotes();
  }
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
