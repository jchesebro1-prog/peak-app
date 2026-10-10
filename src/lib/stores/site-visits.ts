import { getDoc, insertWithPrefixedId, listDocs, listDocsByField, patchDoc, softDeleteDoc } from "@/db/doc-store";
import { deriveVisitStage, requestStageFor, type VisitStage } from "@/lib/lead-thread";
import { normalizeInvites, type VisitInviteRecipient } from "@/lib/visit-invite-plan";
import { readAttendees } from "@/lib/visit-plan/people";

/**
 * Site visits (D76, Jeff 2026-07-19 — PUNCHLIST #2 phase 1). A visit links a
 * customer + venue + contact to a scheduled time and reason, and records the
 * .ics calendar-invite email sent for it. No prototype ancestor — this is the
 * first post-rebuild collection (drizzle migration 0004).
 *
 * Invites are per person since spec 2026-10-09 site-visit scheduling
 * (`invites`, written by src/lib/visit-invite.ts through setVisitInvites).
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
  /** Spec 2026-10-09 site-visit scheduling — other Peak people on the visit
   *  (names; never the lead). The visit is a stop on each one's day
   *  (visitPeople). Normalized to [] on read; no migration. */
  attendees: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  invite?: SiteVisitInvite | null;
  /** Spec 2026-10-09 site-visit scheduling — what each person on the visit
   *  was sent (calendar event or .ics, and the times they were told).
   *  Normalized on read: a pre-spec-2 `invite` / `googleEventId` reads as one
   *  entry for the lead. `invite` / `googleEventId` keep mirroring the lead's
   *  entry for older readers. */
  invites: VisitInviteRecipient[];
  googleEventId?: string; // the lead's direct calendar copy (D77)
  /** Gmail ids of invite mail sent to people since removed from the visit
   *  (their entry is gone) — the Gmail import never re-fetches them. */
  inviteGmailIds?: string[];
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

/** The lead is never also an attendee (trimmed, case-sensitive — the same
 *  match cleanAttendees uses). */
function withoutLead(names: string[], lead: string | null | undefined): string[] {
  const leadName = (lead || "").trim();
  return leadName ? names.filter((n) => n !== leadName) : names;
}

/** Normalize-on-read (#34): backfill the lifecycle fields on pre-#34 docs
 *  and derive stage (a stored "scheduled" past its end reads "done"). */
function normalizeVisit(v: SiteVisit): SiteVisit {
  v.startAt = v.startAt ?? null;
  v.endAt = v.endAt ?? null;
  v.customerId = v.customerId ?? null;
  v.attendees = withoutLead(readAttendees(v.attendees), v.assignedTo);
  v.invites = normalizeInvites(v);
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

/** #323 — ids of the visits linked to one survey, filtered in SQL (the survey page's Meetings card). */
export async function visitIdsForSurvey(surveyId: string): Promise<string[]> {
  if (!surveyId) return [];
  return (await listDocsByField<SiteVisit>("site_visits", "surveyId", [surveyId])).map((v) => v.id);
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
  "id" | "createdAt" | "updatedAt" | "invite" | "invites" | "attendees"
> & { attendees?: string[] };

export async function createVisit(input: SiteVisitInput): Promise<SiteVisit> {
  const now = Date.now();
  return insertWithPrefixedId<SiteVisit>("site_visits", "SV", 5000, (id) => ({
    ...input,
    attendees: withoutLead(readAttendees(input.attendees), input.assignedTo),
    id,
    createdAt: now,
    updatedAt: now,
    invite: null,
    invites: [],
  }));
}

/** Most removed-recipient Gmail ids kept on one visit (the latest win). */
const MAX_RETIRED_GMAIL_IDS = 200;

/** Record what each person was sent (spec 2026-10-09 site-visit scheduling).
 *  The lead's entry is mirrored into the old single fields for older readers
 *  (the agenda's googleEventId dedupe, "invite sent" on the company record) —
 *  exactly: a lead holding no copy of that kind clears the old field, so a
 *  deleted or moved-away calendar copy never lingers as a dedupe key. */
export async function setVisitInvites(id: string, invites: VisitInviteRecipient[], lead: VisitInviteRecipient | null, retiredGmailIds: string[] = []): Promise<void> {
  await patchDoc<SiteVisit>("site_visits", id, (d) => {
    d.invites = invites;
    if (retiredGmailIds.length) {
      const kept = Array.isArray(d.inviteGmailIds) ? d.inviteGmailIds.filter((x) => typeof x === "string" && !!x) : [];
      d.inviteGmailIds = [...new Set([...kept, ...retiredGmailIds])].slice(-MAX_RETIRED_GMAIL_IDS);
    }
    if (lead?.channel === "calendar" && lead.eventId) d.googleEventId = lead.eventId;
    else delete d.googleEventId;
    d.invite =
      lead?.channel === "ics"
        ? { sentAt: lead.sentAt, to: lead.to, fromMailbox: lead.fromMailbox ?? "", ...(lead.gmailId ? { gmailId: lead.gmailId } : {}) }
        : null;
    d.updatedAt = Date.now();
  });
}

/** A pre-spec-2 doc has only the old single stamp, read as "told the visit's
 *  current times". Pin it to those times BEFORE a write changes them, so the
 *  dispatch that follows sees a move and updates the lead's copy. */
function pinLegacyInvites(d: SiteVisit): void {
  if (!Array.isArray(d.invites)) d.invites = normalizeInvites(d);
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

export async function scheduleVisit(id: string, startAt: number, endAt: number, attendees?: string[]): Promise<void> {
  await patchDoc<SiteVisit>("site_visits", id, (d) => {
    pinLegacyInvites(d);
    d.startAt = startAt;
    d.endAt = endAt;
    if (attendees) d.attendees = withoutLead(readAttendees(attendees), d.assignedTo);
    d.stage = "scheduled";
    d.updatedAt = Date.now();
  });
}

export type VisitBookingPatch = { startAt: number; endAt: number; assignedTo: string; attendees: string[] };

/** Editing a scheduled visit (spec 2026-10-09 site-visit scheduling): time,
 *  lead and attendees in one write. The caller cleans the names. */
export async function updateVisitBooking(id: string, patch: VisitBookingPatch): Promise<SiteVisit | null> {
  const saved = await patchDoc<SiteVisit>("site_visits", id, (d) => {
    pinLegacyInvites(d);
    d.startAt = patch.startAt;
    d.endAt = patch.endAt;
    d.assignedTo = patch.assignedTo;
    d.attendees = withoutLead(readAttendees(patch.attendees), patch.assignedTo);
    d.stage = "scheduled";
    d.updatedAt = Date.now();
  });
  return saved ? normalizeVisit(saved) : null;
}

/** Close out a still-unscheduled visit (final-review fix #34): the lead it
 *  was requested from just went lost, so the pool request has nowhere to
 *  go. Scheduled visits are left alone — they belong to a future
 *  cancel/reschedule flow, not this closeout. */
export async function closeVisit(id: string): Promise<void> {
  await patchDoc<SiteVisit>("site_visits", id, (d) => {
    d.stage = "done";
    d.updatedAt = Date.now();
  });
}

/**
 * Delete a site visit (soft delete). Visits are never quote-spawned or
 * swept by a reconciliation job (unlike flame/repair/inspection jobs), so
 * there is no tombstone-coverage concern here — nothing recreates a
 * deleted visit. Cancelling everyone's invite (calendar copies + .ics,
 * cancelVisitInvites) is the caller's job first, same
 * separation the crew-booking removeBooking action keeps from
 * projects.removeCrew (src/app/(app)/schedule/actions.ts).
 */
export async function removeVisit(id: string): Promise<void> {
  await softDeleteDoc("site_visits", id);
}

/** Backfill the resolved customerId onto a lead-borne visit once its lead
 *  converts (final-review fix #34) — only ever called for records still
 *  null (pre-convert lead requests carry no customer yet). */
export async function setVisitCustomer(id: string, customerId: string): Promise<void> {
  await patchDoc<SiteVisit>("site_visits", id, (d) => {
    d.customerId = customerId;
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
    address: string;
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
    address: [lead.address, lead.city, lead.state].filter(Boolean).join(", "),
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
