"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  assign,
  convert,
  create,
  get,
  logActivity,
  markLost,
  setNextAction,
  setStage,
  update,
} from "@/lib/stores/leads";

/**
 * Leads mutations — thin wrappers over LeadStore with the session user as
 * the actor (the prototype's window.Team.CURRENT becomes `me` here).
 */

export async function setStageAction(id: string, stage: string) {
  const me = await requireUser();
  await setStage(id, stage, me.name);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function assignAction(id: string, owner: string) {
  const me = await requireUser();
  await assign(id, owner, me.name);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Worklist "Claim" — assign the lead to yourself. */
export async function claimLeadAction(id: string) {
  const me = await requireUser();
  await assign(id, me.name, me.name);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Worklist "Snooze" — push the follow-up out 3 days (prototype onSnooze). */
export async function snoozeLeadAction(id: string) {
  await requireUser();
  const l = await get(id);
  if (!l) return { ok: false as const };
  await setNextAction(id, Date.now() + 3 * 86400000, l.nextActionNote || "Snoozed follow-up");
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function setNextActionAction(id: string, at: number | null, note: string) {
  await requireUser();
  await setNextAction(id, at, note);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function logActivityAction(id: string, input: { type: string; note: string }) {
  const me = await requireUser();
  await logActivity(id, { type: input.type, note: input.note, by: me.name }, me.name);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function markLostAction(id: string, reason: string) {
  const me = await requireUser();
  await markLost(id, reason, me.name);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Convert → Customer + draft Quote; returns the quote id for the success UI. */
export async function convertLeadAction(id: string, opts: { venueLabel: string; type: string }) {
  const me = await requireUser();
  const res = await convert(id, { venueLabel: opts.venueLabel, type: opts.type }, me.name);
  revalidatePath("/", "layout");
  if (!res) return { ok: false as const, quoteId: "", customerId: "" };
  return { ok: true as const, quoteId: res.quoteId || "", customerId: res.customerId || "" };
}

export async function createLeadAction(input: {
  source: string;
  org: string;
  contact: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  interest: string;
  owner?: string;
  value: number;
}) {
  const me = await requireUser();
  const rec = await create(
    {
      source: input.source,
      org: input.org,
      contact: input.contact,
      email: input.email,
      phone: input.phone,
      city: input.city,
      state: input.state || "WI",
      interest: input.interest,
      // '' (Unassigned) falls through to the store's per-source default,
      // exactly like the prototype's `owner: nf.owner || undefined`.
      owner: input.owner || undefined,
      value: input.value || 0,
    },
    me.name
  );
  revalidatePath("/", "layout");
  return { ok: true as const, id: rec.id };
}

/** #18: forecast (expected-close) date — editable from the lead drawer.
    Quote cards on the opportunity board inherit it from their lead. */
export async function setForecastAction(id: string, at: number | null) {
  await requireUser();
  await update(id, { forecastAt: at });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
