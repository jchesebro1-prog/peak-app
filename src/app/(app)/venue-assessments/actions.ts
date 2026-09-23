"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { create, get, update, type SurveyStage } from "@/lib/stores/surveys";
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
  let rec;
  try {
    rec = await create({ owner: user.name, requestedBy: user.name, stage: "requested" }, user.name);
  } catch (error) {
    console.error("createSurvey: record mint failed", error);
    redirect("/venue-assessments?err=" + encodeURIComponent("Couldn’t create the venue assessment — please try again."));
  }
  revalidatePath("/", "layout");
  redirect(`/venue-assessments/${encodeURIComponent(rec.id)}`);
}

function csvCells(line: string): string[] {
  const out: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { out.push(cell.trim()); cell = ""; }
    else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

export async function importSurveyCsv(formData: FormData): Promise<void> {
  const user = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) return;
  const lines = (await file.text()).split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return;
  const headers = csvCells(lines[0]).map((h) => h.toLowerCase());
  let imported = 0;
  for (const line of lines.slice(1)) {
    const cells = csvCells(line); const row = Object.fromEntries(headers.map((h, i) => [h, cells[i] || ""]));
    const id = row.survey_id?.trim();
    const patch = {
      customer: row.customer || "", venue: row.venue || "", venueType: row.venue_type || "",
      address: row.address || "", reason: row.reason || "", scopeOfWork: row.scope_of_work || "",
      notes: row.notes || "", stage: (["requested", "scheduled", "onsite", "completed"].includes(row.stage) ? row.stage : "requested") as SurveyStage,
      measurements: Object.fromEntries(Object.entries(row).filter(([key, value]) => key.startsWith("measure_") && value).map(([key, value]) => [key.slice(8), value])),
    } as const;
    if (id) {
      const existing = await get(id);
      if (existing) { await update(id, patch); imported++; continue; }
    }
    await create({ ...patch, owner: user.name, requestedBy: user.name }, user.name);
    imported++;
  }
  revalidatePath("/venue-assessments");
  redirect(`/venue-assessments?imported=${imported}`);
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
  let q;
  try {
    q = await createQuote({
      name: (rec.customer || "Venue assessment") + " — " + (rec.venue || rec.venueType || "Site"),
      customer: rec.customer || "",
      customerId: rec.customerId || null,
      locationId: rec.locationId || null,
      owner: user.name,
      source: "survey",
    });
  } catch (error) {
    console.error("quoteFromSurvey: quote mint failed", error);
    redirect("/venue-assessments?err=" + encodeURIComponent("Couldn’t create the quote — please try again."));
  }
  revalidatePath("/", "layout");
  redirect(`/estimator?id=${encodeURIComponent(q.id)}`);
}
