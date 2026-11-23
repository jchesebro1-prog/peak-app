"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import {
  assign,
  convert,
  create,
  get,
  logActivity,
  markLost,
  remove as removeLead,
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
  // A missing lead writes nothing — say so (Ask AI's note card records only a real ok).
  const lead = await logActivity(id, { type: input.type, note: input.note, by: me.name }, me.name);
  if (!lead) return { ok: false as const, error: "That lead no longer exists." };
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
export async function convertLeadAction(
  id: string,
  opts: { venueLabel: string; type: string }
) {
  const me = await requireUser();

  // convert() writes in three steps with no transaction between them (#74):
  // upsertCustomer() into the relational identity core, THEN the quote mint,
  // THEN the lead patch. The mint goes through insertWithPrefixedId, which
  // THROWS once an id collision outlasts its retry budget (#62). Unguarded,
  // that escaped as a raw exception from a button press, leaving a customer
  // row created while the lead still looked unconverted.
  //
  // Nothing here can roll the identity write back, but it does not need to:
  // upsertCustomer is keyed on a deterministic customerId, so a retry re-upserts
  // the same customer and finishes the conversion. Hence "try again" rather
  // than "contact support" — the half-state is genuinely recoverable.
  let res: Awaited<ReturnType<typeof convert>>;
  try {
    res = await convert(id, { venueLabel: opts.venueLabel, type: opts.type }, me.name);
  } catch (e) {
    return {
      ok: false as const,
      reason:
        (e instanceof Error ? e.message : "The conversion could not be completed") +
        " — nothing was lost, please try again.",
      quoteId: "",
      customerId: "",
    };
  }
  revalidatePath("/", "layout");
  if (!res)
    return { ok: false as const, reason: "not-found" as const, quoteId: "", customerId: "" };
  return { ok: true as const, quoteId: res.quoteId || "", customerId: res.customerId || "" };
}

export async function createLeadAction(input: {
  source: string;
  org: string;
  contact: string;
  contactRole?: string;
  email: string;
  phone: string;
  address?: string;
  city: string;
  state: string;
  interest: string;
  owner?: string;
  value: number;
  /** #12 — set when the New Lead form's "pick an existing customer" picker
   *  was used; null (the default) keeps current behavior exactly — every
   *  lead from this form has customerId: null unless a customer was picked.
   *  Minting a new customer eagerly from this form stays out of scope
   *  (Decision D default) — that's convert()'s job, unchanged. */
  customerId?: string | null;
}): Promise<
  { ok: true; id: string } | { ok: false; id: null; error: string }
> {
  const me = await requireUser();
  // #80: create()'s mint (insertWithPrefixedId) THROWS once an id collision
  // outlasts its retry budget (doc-store.ts). Rare, but this is the New Lead
  // button — report it as a typed message instead of letting a raw exception
  // escape as a 500.
  let rec;
  try {
    rec = await create(
      {
        source: input.source,
        org: input.org,
        contact: input.contact,
        contactRole: input.contactRole,
        email: input.email,
        phone: input.phone,
        address: input.address,
        city: input.city,
        state: input.state || "WI",
        interest: input.interest,
        // '' (Unassigned) falls through to the store's per-source default,
        // exactly like the prototype's `owner: nf.owner || undefined`.
        owner: input.owner || undefined,
        value: input.value || 0,
        customerId: input.customerId || null,
      },
      me.name
    );
  } catch (err) {
    console.error("createLeadAction: lead mint failed", err);
    return { ok: false, id: null, error: "Couldn’t create that lead — please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true, id: rec.id };
}

/** #18: forecast (expected-close) date — editable from the lead drawer.
    Quote cards on the opportunity board inherit it from their lead. */
export async function setForecastAction(id: string, at: number | null) {
  await requireUser();
  await update(id, { forecastAt: at });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * Delete a lead. Soft delete only — linked site visits / surveys are NOT
 * cascade-deleted: once created they can outlive the lead (a visit/survey
 * backfills customerId on convert, and surveys feed the venue-assessments
 * list independently — see markLostAction's comment above), so the lead
 * does not exclusively own them. Gated on `create`, like deleting a design,
 * consulting project, project or company (#280).
 */
export async function deleteLeadAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("create", user.roles)) return { ok: false as const, error: "You can't delete leads." };
  if (!id) return { ok: false as const, error: "Missing lead id." };
  await removeLead(id);
  revalidatePath("/", "layout");
  return { ok: true as const };
}
