import { getDoc, listDocs, nextPrefixedId, patchDoc, upsertDoc } from "@/db/doc-store";
import { deriveVisitStage, requestStageFor, type VisitStage } from "@/lib/lead-thread";

/**
 * Site visits (D76, Jeff 2026-07-19 — PUNCHLIST #2 phase 1). A visit links a
 * customer + venue + contact to a scheduled time and reason, and records the
 * .ics calendar-invite email sent for it. No prototype ancestor — this is the
 * first post-rebuild collection (drizzle migration 0004).
 *
 * Phase 2 (deferred): direct Google Calendar write (googleEventId is already
 * reserved here) and the in-app calendar.
 */

export type SiteVisitInvite = {
  sentAt: number;
  to: string; // assignee email the .ics went to
  fromMailbox: string; // connection key it was sent from
  gmailId?: string;
  gmailThreadId?: string;
};

export type SiteVisit = {
  id: string; // 'SV-####'
  /** null while the visit is a lead-borne request that pre-dates the
   *  customer record (#34). Pre-#34 docs always carry one. */
  customerId: string | null;
  customer: string; // denormalized name (lead requests: the lead's org)
  locationId: string | null;
  venue: string; // denormalized venue label
  address: string; // street + city/state at time of scheduling
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  reason: string; // one of the Settings picklist values
  /** epoch-ms; null until scheduled (#34). Pre-#34 docs always carry both. */
  startAt: number | null;
  endAt: number | null;
  notes: string;
  /** team-member NAME (app convention); "" until claimed (#34). */
  assignedTo: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  invite?: SiteVisitInvite | null;
  googleEventId?: string; // phase 2
  /** Optional consulting-engagement link (D90) — oversight visits list
   *  under the engagement's Oversight tab. */
  engagementId?: string | null;
  /** #34 lifecycle — requested/open/claimed/scheduled/done. Backfilled on
   *  read (normalizeVisit → deriveVisitStage) for pre-#34 docs, and a
   *  stored "scheduled" past its end reads as "done". */
  stage: VisitStage;
  /** The lead this visit was requested from (#34); null for inbox-born visits. */
  leadId: string | null;
  /** The auto-created linked Survey (#34); null for inbox-born visits. */
  surveyId: string | null;
  /** Free-text preferred timing captured on the lead's request form (#34). */
  preferredTiming: string;
};

/** Default reason picklist (Jeff: picklist, not free text). Editable in
 *  Settings — stored overrides live in AppSettingsData.visitReasons. */
export const DEFAULT_VISIT_REASONS: string[] = [
  "Site survey / measure",
  "Sales call",
  "Punch walk",
  "Install check-in",
  "Warranty check",
  "Flame test",
  "Rigging inspection",
  "Service call",
];

/** Stored list if non-empty, else the defaults (mirrors mergedCatalog). */
export function mergedVisitReasons(stored?: string[] | null): string[] {
  const list = (stored || []).map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_VISIT_REASONS;
}

/** Normalize-on-read (#34): backfill the lifecycle fields on pre-#34 docs
 *  and derive stage (a stored "scheduled" past its end reads "done"). */
function normalizeVisit(v: SiteVisit): SiteVisit {
  v.startAt = v.startAt ?? null;
  v.endAt = v.endAt ?? null;
  v.customerId = v.customerId ?? null;
  v.stage = deriveVisitStage(v, Date.now());
  v.leadId = v.leadId ?? null;
  v.surveyId = v.surveyId ?? null;
  v.preferredTiming = v.preferredTiming ?? "";
  return v;
}

export async function allVisits(): Promise<SiteVisit[]> {
  const list = await listDocs<SiteVisit>("site_visits");
  return list.map(normalizeVisit).sort((a, b) => (b.startAt || 0) - (a.startAt || 0));
}

export async function visitsForCustomer(customerId: string): Promise<SiteVisit[]> {
  return (await allVisits()).filter((v) => v.customerId === customerId);
}

export async function visitsForEngagement(engagementId: string): Promise<SiteVisit[]> {
  return (await allVisits()).filter((v) => v.engagementId === engagementId);
}

export async function getVisit(id: string): Promise<SiteVisit | null> {
  const v = await getDoc<SiteVisit>("site_visits", id);
  return v ? normalizeVisit(v) : null;
}

export async function visitsForLead(leadId: string): Promise<SiteVisit[]> {
  return (await allVisits()).filter((v) => v.leadId === leadId);
}

/** The lead's one ACTIVE visit (stage not "done") — the request-dedupe and
 *  drawer-thread read. */
export async function activeVisitForLead(leadId: string): Promise<SiteVisit | null> {
  return (await visitsForLead(leadId)).find((v) => v.stage !== "done") ?? null;
}

/** Link/unlink a visit to a consulting engagement (D90). */
export async function linkVisitToEngagement(
  id: string,
  engagementId: string | null
): Promise<void> {
  await patchDoc<SiteVisit>("site_visits", id, (d) => {
    d.engagementId = engagementId;
    d.updatedAt = Date.now();
  });
}

export type SiteVisitInput = Omit<
  SiteVisit,
  "id" | "createdAt" | "updatedAt" | "invite"
>;

export async function createVisit(input: SiteVisitInput): Promise<SiteVisit> {
  const id = await nextPrefixedId("site_visits", "SV", 5000);
  const now = Date.now();
  const rec: SiteVisit = {
    ...input,
    id,
    createdAt: now,
    updatedAt: now,
    invite: null,
  };
  await upsertDoc<SiteVisit>("site_visits", rec);
  return rec;
}

/** Record the sent .ics invite on the visit (D76-I). */
export async function stampInvite(
  id: string,
  invite: SiteVisitInvite
): Promise<void> {
  await patchDoc<SiteVisit>("site_visits", id, (d) => {
    d.invite = invite;
    d.updatedAt = Date.now();
  });
}

/** Record the directly-created Google Calendar event (D77). The dashboard
 *  agenda uses this to dedup: a visit with a googleEventId shows via Google,
 *  not as a second local row. */
export async function stampGoogleEvent(
  id: string,
  googleEventId: string
): Promise<void> {
  await patchDoc<SiteVisit>("site_visits", id, (d) => {
    d.googleEventId = googleEventId;
    d.updatedAt = Date.now();
  });
}

/* ---- #34 lifecycle mutations (the LEAD claim model — no approver gate) ---- */

/** Claim: assign-to-self. No claimedAt anywhere in the app — stage +
 *  updatedAt suffice (house rule). */
export async function claimVisit(id: string, me: string): Promise<void> {
  await patchDoc<SiteVisit>("site_visits", id, (d) => {
    d.assignedTo = me;
    d.stage = "claimed";
    d.updatedAt = Date.now();
  });
}

/** Release an existing visit back to the pool — stage "open" (distinct from
 *  "requested" = born open, per the lifecycle semantics). */
export async function releaseVisit(id: string): Promise<void> {
  await patchDoc<SiteVisit>("site_visits", id, (d) => {
    d.assignedTo = "";
    d.stage = "open";
    d.updatedAt = Date.now();
  });
}

export async function scheduleVisit(id: string, startAt: number, endAt: number): Promise<void> {
  await patchDoc<SiteVisit>("site_visits", id, (d) => {
    d.startAt = startAt;
    d.endAt = endAt;
    d.stage = "scheduled";
    d.updatedAt = Date.now();
  });
}

/* ---- #34 request orchestration (lead drawer's "Request site visit") ---- */

export type VisitRequestOpts = { reason: string; timing: string; assignee: string };

export type VisitRequestResult =
  | { ok: true; visitId: string; surveyId: string }
  | { ok: false; reason: "exists"; visitId: string };

/**
 * Create the visit request + the auto-linked Survey (#34, decision C).
 * Dedupe FIRST: one active (non-done) visit per lead. The visit is born
 * claimed or requested per assign-or-open; the Survey is born "requested"
 * (it rides the existing field badge + "Survey requests to schedule" bell
 * group automatically). Surveys are dynamic-imported — the leads.ts
 * cross-store idiom — so the store layer stays acyclic.
 */
export async function requestVisitForLead(
  lead: {
    id: string;
    org: string;
    contact: string;
    email: string;
    phone: string;
    city: string;
    state: string;
    customerId: string | null;
  },
  opts: VisitRequestOpts,
  me: string
): Promise<VisitRequestResult> {
  const existing = (await allVisits()).find((v) => v.leadId === lead.id && v.stage !== "done");
  if (existing) return { ok: false, reason: "exists", visitId: existing.id };

  const rec = await createVisit({
    customerId: lead.customerId ?? null,
    customer: lead.org,
    locationId: null,
    venue: "",
    address: [lead.city, lead.state].filter(Boolean).join(", "),
    contactName: lead.contact,
    contactEmail: lead.email,
    contactPhone: lead.phone,
    reason: opts.reason,
    startAt: null,
    endAt: null,
    notes: "",
    assignedTo: opts.assignee.trim(),
    createdBy: me,
    engagementId: null,
    stage: requestStageFor(opts.assignee),
    leadId: lead.id,
    surveyId: null,
    preferredTiming: opts.timing.trim(),
  });

  const { create: createSurvey } = await import("./surveys");
  const survey = await createSurvey(
    {
      customer: lead.org,
      customerId: lead.customerId ?? null,
      contact: lead.contact,
      contactPhone: lead.phone,
      contactEmail: lead.email,
      reason: opts.reason,
      stage: "requested",
      leadId: lead.id,
      visitId: rec.id,
    },
    me
  );

  await patchDoc<SiteVisit>("site_visits", rec.id, (d) => {
    d.surveyId = survey.id;
    d.updatedAt = Date.now();
  });
  return { ok: true, visitId: rec.id, surveyId: survey.id };
}
