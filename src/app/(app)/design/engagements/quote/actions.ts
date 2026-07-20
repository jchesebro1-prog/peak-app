"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { nameFor } from "@/lib/stores/customers";
import {
  create as createQuote,
  update as updateQuote,
} from "@/lib/stores/quotes";
import type { ConsultingQuotePayload } from "@/lib/stores/engagements";

/**
 * Consulting quote mutations (D90). A LIGHTWEIGHT builder on purpose (spec
 * §"The consulting quote") — scope-of-work text, a fixed fee OR a milestone
 * fee schedule, terms, and the phase selection that later seeds the
 * engagement. No engine, no travel, and NO pricing tiers (fee-based, not
 * margin-derived — pricingTier/tierMargin stay unset). Everything downstream
 * (review gate, status pipeline, D84 revisions, letters) is the ordinary
 * quote machinery driven from the Quotes hub.
 *
 * Client input is field-allowlisted here — review/status/owner never come
 * from the form (same self-approval guardrail as updateQuoteMetaAction).
 */

type PostedFee = { name?: string; amount?: number };

async function persist(formData: FormData): Promise<string | null> {
  const user = await requireUser();
  const editingId = String(formData.get("editingId") || "");
  const customerId = String(formData.get("customerId") || "");
  const locationId = String(formData.get("locationId") || "");
  const quoteName = String(formData.get("quoteName") || "").trim();
  const contactName = String(formData.get("contactName") || "").trim();
  const contactRole = String(formData.get("contactRole") || "").trim();
  const contactEmail = String(formData.get("contactEmail") || "").trim();
  const scope = String(formData.get("scope") || "").trim();
  const terms = String(formData.get("terms") || "").trim();
  const feeModeRaw = String(formData.get("feeMode") || "fixed");
  const feeMode: ConsultingQuotePayload["feeMode"] =
    feeModeRaw === "milestones" ? "milestones" : "fixed";

  let postedFees: PostedFee[] = [];
  try {
    postedFees = JSON.parse(String(formData.get("fees") || "[]"));
  } catch {
    postedFees = [];
  }
  let phases: string[] = [];
  try {
    phases = JSON.parse(String(formData.get("phases") || "[]"));
  } catch {
    phases = [];
  }

  if (!customerId) return null;

  const fees = (Array.isArray(postedFees) ? postedFees : [])
    .map((f) => ({
      name: String(f?.name || "").trim(),
      amount: Math.max(0, Math.round(Number(f?.amount) || 0)),
    }))
    .filter((f) => f.name || f.amount > 0)
    .slice(0, 40);
  const cleanPhases = (Array.isArray(phases) ? phases : [])
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .slice(0, 20);

  const value =
    feeMode === "fixed"
      ? fees[0]?.amount || 0
      : fees.reduce((a, f) => a + f.amount, 0);

  const custName = (await nameFor(customerId)) || "";
  const contact = contactName
    ? { name: contactName, role: contactRole, email: contactEmail }
    : null;

  const consulting: ConsultingQuotePayload = {
    scope,
    feeMode,
    fees,
    terms,
    phases: cleanPhases,
  };

  const payload = {
    name: quoteName || (custName ? custName + " — Consulting" : "Consulting"),
    customer: custName,
    customerId: customerId || null,
    locationId: locationId || null,
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
  return (q && q.id) || editingId || null;
}

export async function saveConsultingQuote(formData: FormData): Promise<void> {
  const id = await persist(formData);
  revalidatePath("/", "layout");
  if (id)
    redirect("/design/engagements/quote?id=" + encodeURIComponent(id) + "&saved=1");
}
