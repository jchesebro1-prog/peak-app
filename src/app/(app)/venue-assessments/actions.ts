"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { create, get, update } from "@/lib/stores/surveys";
import { create as createQuote } from "@/lib/stores/quotes";

/**
 * Field-survey inbox mutation. `createSurvey` mirrors the prototype's
 * "New request" button (Field Survey.dc.html → Survey.dc.html?new=1): we spin
 * up a fresh `requested` survey owned by the acting user (recorded as the
 * requester) and open its capture editor. FormData-shaped so the button works
 * without client JS.
 */
export async function createSurvey(): Promise<void> {
  const user = await requireUser();
  const rec = await create({ owner: user.name, requestedBy: user.name, stage: "requested" }, user.name);
  revalidatePath("/", "layout");
  redirect(`/venue-assessments/${encodeURIComponent(rec.id)}`);
}

/**
 * "Create quote →" on a completed survey card (Field Survey.dc.html
 * createQuoteFrom): spins up a survey-sourced quote and opens the Estimator.
 * FormData-shaped — the card renders a plain form with the survey id.
 */
export async function quoteFromSurvey(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  const rec = id ? await get(id) : null;
  if (!rec) return;
  if (rec.stage !== "completed") await update(id, { stage: "completed" });
  const q = await createQuote({
    name: (rec.customer || "Venue assessment") + " — " + (rec.venue || rec.venueType || "Site"),
    customer: rec.customer || "",
    customerId: rec.customerId || null,
    locationId: rec.locationId || null,
    owner: user.name,
    source: "survey",
  });
  revalidatePath("/", "layout");
  redirect(`/estimator?id=${encodeURIComponent(q.id)}`);
}
