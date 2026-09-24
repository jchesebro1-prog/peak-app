"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { get as getCustomer, nameFor } from "@/lib/stores/customers";
import {
  create as createQuote,
  get as getQuote,
  update as updateQuote,
  retireReplacedDraft,
} from "@/lib/stores/quotes";
import {
  create as createLead,
  logActivity as logLeadActivity,
  open as openLeads,
} from "@/lib/stores/leads";
import type { ConsultingQuotePayload } from "@/lib/stores/engagements";
import { scopesTotal, type ConsultingScope } from "@/lib/consulting-stages";
import { getSettings, mergedConsultingDisciplines } from "@/lib/settings";

/**
 * Consulting proposal mutations (#35 rebuild over the D90 lightweight
 * builder). Structured scopes (the total = scope fees), the ticked
 * assumption texts frozen at save, terms, and the phase selection that
 * seeds the engagement when the proposal is SENT (spec §1). Still no
 * engine, no travel, and NO pricing tiers (fee-based, not margin-derived —
 * pricingTier/tierMargin stay unset). Everything downstream (review gate,
 * status pipeline, D84 revisions, letters) is the ordinary quote machinery
 * driven from the Quotes hub.
 *
 * Auto-lead with dedupe (spec §1): the CREATE path (never edits) links the
 * proposal to the company's open lead when one exists (a system activity
 * notes the proposal), else creates a source-"consulting" lead. Either way
 * the payload stamps leadId for traceability.
 *
 * Client input is field-allowlisted here — review/status/owner never come
 * from the form (same self-approval guardrail as updateQuoteMetaAction).
 */

function uid(p?: string): string {
  return (p || "x") + Math.random().toString(36).slice(2, 8);
}

type PostedScope = { id?: string; title?: string; description?: string; fee?: number };

async function persist(formData: FormData): Promise<string | null> {
  const user = await requireUser();
  const editingId = String(formData.get("editingId") || "");
  const replaces = String(formData.get("replaces") || "").trim();
  const customerId = String(formData.get("customerId") || "");
  const venueCustomerId = String(formData.get("venueCustomerId") || "");
  const locationId = String(formData.get("locationId") || "");
  const quoteName = String(formData.get("quoteName") || "").trim();
  const contactName = String(formData.get("contactName") || "").trim();
  const contactRole = String(formData.get("contactRole") || "").trim();
  const contactEmail = String(formData.get("contactEmail") || "").trim();
  const terms = String(formData.get("terms") || "").trim();

  let postedScopes: PostedScope[] = [];
  try {
    postedScopes = JSON.parse(String(formData.get("scopes") || "[]"));
  } catch {
    postedScopes = [];
  }
  let postedAssumptions: unknown[] = [];
  try {
    postedAssumptions = JSON.parse(String(formData.get("assumptions") || "[]"));
  } catch {
    postedAssumptions = [];
  }
  let phases: string[] = [];
  try {
    phases = JSON.parse(String(formData.get("phases") || "[]"));
  } catch {
    phases = [];
  }
  let postedDisciplines: unknown[] = [];
  try {
    postedDisciplines = JSON.parse(String(formData.get("disciplines") || "[]"));
  } catch {
    postedDisciplines = [];
  }

  if (!customerId || !venueCustomerId) return null;

  const scopes: ConsultingScope[] = (Array.isArray(postedScopes) ? postedScopes : [])
    .map((s) => ({
      id: typeof s?.id === "string" && s.id.startsWith("sc-") ? s.id : uid("sc-"),
      title: String(s?.title || "").trim().slice(0, 120),
      description: String(s?.description || "").trim().slice(0, 2000),
      fee: Math.max(0, Math.round(Number(s?.fee) || 0)),
    }))
    .filter((s) => s.title || s.description || s.fee > 0)
    .slice(0, 40);
  const assumptions = (Array.isArray(postedAssumptions) ? postedAssumptions : [])
    .map((a) => String(a || "").trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 40);
  const cleanPhases = (Array.isArray(phases) ? phases : [])
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .slice(0, 20);

  const value = scopesTotal(scopes);

  const [architectRecord, venueRecord, settings] = await Promise.all([
    getCustomer(customerId),
    getCustomer(venueCustomerId),
    getSettings(),
  ]);
  if (!architectRecord || !venueRecord) return null;
  // #145 D165 — treat the posted disciplines as untrusted (same allowlist
  // idiom as cleanLocationId below): only a discipline actually in the
  // live vocabulary survives, so a hand-crafted POST can't stash an
  // arbitrary string onto the quote (and, at spawn, the engagement).
  const liveDisciplines = new Set(mergedConsultingDisciplines(settings.consultingDisciplines));
  const cleanDisciplines = Array.from(
    new Set(
      (Array.isArray(postedDisciplines) ? postedDisciplines : [])
        .map((d) => String(d ?? "").trim().toLowerCase())
        .filter((d) => liveDisciplines.has(d))
    )
  );
  const custName = (await nameFor(customerId)) || architectRecord.name || "";
  const venueCustomer = (await nameFor(venueCustomerId)) || venueRecord.name || "";
  const cleanLocationId = (venueRecord.locations || []).some((l) => l.id === locationId)
    ? locationId
    : "";
  const contact = contactName
    ? { name: contactName, role: contactRole, email: contactEmail }
    : null;

  // Pre-rebuild content survives an edit read-only: the legacy scope string
  // rides along; fees are superseded by scopes (revisions hold the history).
  const prior = editingId ? await getQuote(editingId) : null;
  const priorPay = (prior?.consulting || null) as ConsultingQuotePayload | null;

  const consulting: ConsultingQuotePayload = {
    scope: priorPay?.scope || "",
    feeMode: "fixed",
    fees: [],
    terms,
    phases: cleanPhases,
    disciplines: cleanDisciplines,
    scopes,
    assumptions,
    leadId: priorPay?.leadId ?? null,
    venueCustomerId: venueCustomerId || null,
    venueCustomer,
  };

  const payload = {
    name: quoteName || (venueCustomer ? venueCustomer + " — Consulting" : "Consulting"),
    customer: custName,
    customerId: customerId || null,
    locationId: cleanLocationId || null,
    value,
    margin: 0,
    source: "consulting",
    quoteType: "consulting",
    owner: user.name,
    contact,
    consulting,
  };

  const q = editingId
    ? await updateQuote(editingId, payload)
    : await createQuote(payload);
  const qid = (q && q.id) || editingId || null;
  if (!editingId && q && replaces) await retireReplacedDraft(replaces);

  /* ---- #35 auto-lead with dedupe — CREATE path only, never edits ---- */
  if (!editingId && q) {
    const existing = (await openLeads()).find((l) => l.customerId === customerId);
    let leadId: string;
    if (existing) {
      await logLeadActivity(
        existing.id,
        { type: "system", note: `Consulting proposal ${q.id} created` },
        user.name
      );
      leadId = existing.id;
    } else {
      const lead = await createLead(
        {
          org: custName,
          source: "consulting",
          owner: user.name,
          customerId,
          interest: "Consulting — " + payload.name,
          value,
        },
        user.name
      );
      leadId = lead.id;
    }
    await updateQuote(q.id, { consulting: { ...consulting, leadId } });
  }
  return qid;
}

export async function saveConsultingQuote(formData: FormData): Promise<void> {
  const editingId = String(formData.get("editingId") || "");
  let id: string | null = null;
  try {
    id = await persist(formData);
  } catch (error) {
    console.error("saveConsultingQuote: quote or lead mint failed", error);
    const target = editingId
      ? "/design/engagements/quote?id=" + encodeURIComponent(editingId)
      : "/design/engagements/quote";
    redirect(target + "&err=" + encodeURIComponent("Couldn’t save the consulting quote — please try again."));
  }
  revalidatePath("/", "layout");
  if (id)
    redirect("/design/engagements/quote?id=" + encodeURIComponent(id) + "&saved=1");
}
