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
import {
  activeVisitForLead,
  closeVisit,
  requestVisitForLead,
  setVisitCustomer,
  visitsForLead,
} from "@/lib/stores/site-visits";
import {
  get as getSurvey,
  remove as removeSurvey,
  surveysForLead,
  update as updateSurvey,
} from "@/lib/stores/surveys";
import { canConvertLead } from "@/lib/lead-thread";

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
  // #34 final-review fix: a still-unscheduled pool visit has nowhere to go
  // once the lead is lost — close it out and note it on the lead.
  const visit = await activeVisitForLead(id);
  if (visit && (visit.stage === "requested" || visit.stage === "open" || visit.stage === "claimed")) {
    await closeVisit(visit.id);
    let note = "Site visit request closed — lead marked lost";
    // #34 task-6 fix: the auto-created survey that rode along with this
    // visit has nowhere to go either. If it's still untouched at
    // "requested" and still points back at this lead, soft-delete it so a
    // dead lead's survey stops nagging the "Survey requests to schedule"
    // bell / field-survey list. A survey someone has already started
    // working (stage moved past requested) is left alone.
    if (visit.surveyId) {
      const survey = await getSurvey(visit.surveyId);
      if (survey && survey.stage === "requested" && survey.leadId === id) {
        await removeSurvey(survey.id);
        note += "; linked survey request removed";
      }
    }
    await logActivity(id, { type: "system", note, by: me.name }, me.name);
  }
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Convert → Customer + draft Quote; returns the quote id for the success UI.
 *  #34: the SERVER-SIDE survey gate lives here (the drawer's disabled button
 *  is not the gate). The linked survey resolves via surveysForLead (newest
 *  first) — the SAME path the drawer's gate preview uses, so gate and
 *  preview can never disagree. Deliberately NOT the active visit's surveyId:
 *  a "scheduled" visit whose end time has passed derives to "done" on read
 *  and drops out of activeVisitForLead, so the canonical flow (visit
 *  happened → survey completed → convert) has no active visit while the
 *  completed survey still exists (see deviations note / D120). Skipping
 *  requires an explicit opts.skipSurvey and logs the bypass on the lead.
 *  Tolerance: the gate reads the survey's CURRENT stage — backwards pill
 *  jumps before convert are respected by design. */
export async function convertLeadAction(
  id: string,
  opts: { venueLabel: string; type: string; skipSurvey?: boolean; skipReason?: string }
) {
  const me = await requireUser();

  const linked = await surveysForLead(id); // newest first (getAll is updatedAt-desc)
  const survey: { stage: string } | null = linked[0]
    ? { stage: (linked[0].stage || "requested") as string }
    : null;
  const gate = canConvertLead(survey, !!opts.skipSurvey);
  if (!gate.ok)
    return { ok: false as const, reason: gate.reason, quoteId: "", customerId: "" };

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
  if (res && opts.skipSurvey) {
    await logActivity(
      id,
      {
        type: "system",
        note:
          "Converted without completed survey — " +
          (opts.skipReason?.trim() || "no reason given"),
        by: me.name,
      },
      me.name
    );
  }
  // #34 final-review fix: thread continuity — the visits/surveys this lead
  // spawned pre-date the customer record (customerId null); backfill it now
  // so the customer's own visit/survey history picks them up.
  if (res && res.customerId) {
    const customerId = res.customerId;
    const [visits, surveys] = await Promise.all([visitsForLead(id), surveysForLead(id)]);
    await Promise.all([
      ...visits
        .filter((v) => v.customerId == null)
        .map((v) => setVisitCustomer(v.id, customerId)),
      ...surveys
        .filter((s) => s.customerId == null)
        .map((s) => updateSurvey(s.id, { customerId })),
    ]);
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

/** #34: "Request site visit" from the lead drawer. Dedupe + visit + auto-
    linked Survey live in the store orchestration (requestVisitForLead);
    this wraps it with the session user and the lead activity entry. */
export async function requestSiteVisitAction(
  id: string,
  input: { reason: string; timing: string; assignee: string }
) {
  const me = await requireUser();
  const l = await get(id);
  if (!l) return { ok: false as const, reason: "not-found" as const, visitId: "" };
  const res = await requestVisitForLead(
    {
      id: l.id,
      org: l.org,
      contact: l.contact,
      email: l.email,
      phone: l.phone,
      city: l.city,
      state: l.state,
      customerId: l.customerId ?? null,
    },
    input,
    me.name
  );
  if (!res.ok) return { ok: false as const, reason: "exists" as const, visitId: res.visitId };
  await logActivity(
    id,
    { type: "system", note: "Requested site visit — " + input.reason, by: me.name },
    me.name
  );
  revalidatePath("/", "layout");
  return { ok: true as const, visitId: res.visitId, surveyId: res.surveyId };
}
